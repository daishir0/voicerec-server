import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';
import { writeEncrypted } from '@/lib/file-crypto';
import { groupSegments, type RawSegment } from '@/lib/group-segments';
import fs from 'fs/promises';
import path from 'path';

/**
 * 端末が作った文字起こしを録音に書き込み、Segment を作り直す。
 *
 * ⚠️ `whisperTranscribedAt` も必ず入れる。画面はこの列だけを見て
 * 「セグメント（時刻つき）」タブを出すか決めているので、空のままだと
 * 行は入っているのに時刻が一切見えない（2026-10-24 に実際にこうなった）。
 * 列名は whisper 由来だが、意味は「時刻つきの発話データがある」。
 */
async function applyDeviceTranscript(opts: {
  recordingId: string;
  userId: string;
  recordedAt: Date;
  text: string;
  segments: RawSegment[];
  source: string;
  locale: string;
}): Promise<number> {
  const grouped = groupSegments(opts.segments);
  const now = new Date();

  await prisma.recording.update({
    where: { id: opts.recordingId },
    data: {
      transcriptionStatus: 'completed',
      transcriptionText: opts.text,
      transcriptionSegments: JSON.stringify(
        grouped.map((s) => ({ start: s.startSec, end: s.endSec, text: s.text })),
      ),
      transcriptionSource: opts.source || 'device',
      transcriptionAt: now,
      transcriptionError: null,
      whisperTranscribedAt: grouped.length > 0 ? now : null,
      whisperError: null,
      ...(opts.locale ? { language: opts.locale.split('-')[0] } : {}),
    },
  });

  // ⚠️ 端末が送ってくる秒は「この録音の先頭から」の値。絶対時刻は recordedAt から作る。
  // 送り直しに備えて、作る前に必ず消す（残っていると seq が重複する）。
  await prisma.segment.deleteMany({ where: { recordingId: opts.recordingId } });
  if (grouped.length > 0) {
    const base = opts.recordedAt.getTime();
    await prisma.segment.createMany({
      data: grouped.map((s, i) => ({
        recordingId: opts.recordingId,
        userId: opts.userId,
        seq: i,
        startOffset: s.startSec,
        endOffset: s.endSec,
        startAt: new Date(base + s.startSec * 1000),
        endAt: new Date(base + s.endSec * 1000),
        text: s.text,
      })),
    });
  }
  return grouped.length;
}

// originalNameから yyyymmdd-hhmmss を抽出、なければ現在日時で生成
function buildFilename(originalName: string, ext: string): string {
  const match = originalName.match(/(\d{8}-\d{6})/);
  const timestamp = match ? match[1] : formatNow();
  return `${timestamp}${ext}`;
}

// ファイル名 yyyymmdd-hhmmss を JST 解釈で絶対時刻 Date 化
function parseRecordedAtFromFilename(name: string): Date | null {
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
}

function formatNow(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const se = String(now.getSeconds()).padStart(2, '0');
  return `${y}${mo}${d}-${h}${mi}${se}`;
}

export async function POST(req: NextRequest) {
  const reqStartedAt = Date.now();
  const user = await authenticateBearer(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  console.log(`[upload] auth ok userId=${user.id} +${Date.now() - reqStartedAt}ms`);
  console.log(`[upload] headers: content-length=${req.headers.get('content-length')} content-type=${req.headers.get('content-type')} transfer-encoding=${req.headers.get('transfer-encoding') ?? '(none)'} forwarded-for=${req.headers.get('x-forwarded-for') ?? '(none)'}`);

  let formData: FormData;
  try {
    formData = await req.formData();
    console.log(`[upload] formData parsed +${Date.now() - reqStartedAt}ms keys=${Array.from(formData.keys()).join(',')}`);
  } catch (err) {
    console.error(`[upload] formData PARSE FAILED +${Date.now() - reqStartedAt}ms`, err);
    return NextResponse.json({ error: 'Bad multipart body' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    console.error(`[upload] file field missing. all keys=[${Array.from(formData.keys()).join(',')}]`);
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  console.log(`[upload] file received: name="${file.name}" size=${file.size} type="${file.type}"`);

  const originalName = (formData.get('originalName') as string) || file.name;
  const displayName = (formData.get('displayName') as string) || originalName;
  // アプリからミリ秒で送られるので秒に変換
  const durationRaw = parseFloat((formData.get('duration') as string) || '0');
  const duration = durationRaw > 1000 ? durationRaw / 1000 : durationRaw;

  // 端末で作った文字起こし。付いていればサーバーでは作り直さない。
  // 端末は選んだ範囲を既に文字にしているので、同じ音声に Whisper をもう一度かけるのは
  // CPU と待ち時間の無駄になる。
  const deviceText = (formData.get('transcriptText') as string) || '';
  const deviceSource = (formData.get('transcriptSource') as string) || '';
  const deviceLocale = (formData.get('transcriptLocale') as string) || '';
  let deviceSegments: { startSec: number; endSec: number; text: string }[] = [];
  const rawSegments = formData.get('transcriptSegments') as string | null;
  if (rawSegments) {
    try {
      const parsed = JSON.parse(rawSegments);
      if (Array.isArray(parsed)) {
        deviceSegments = parsed
          .filter((s) => s && typeof s.text === 'string')
          .map((s) => ({
            startSec: Number(s.startSec) || 0,
            endSec: Number(s.endSec) || 0,
            text: String(s.text),
          }));
      }
    } catch (err) {
      console.warn(`[upload] transcriptSegments を読めませんでした: ${err}`);
    }
  }
  const hasDeviceTranscript = deviceText.trim().length > 0;

  // 重複チェック: 同じユーザー・同じoriginalNameが既にあれば既存を返す
  const existing = await prisma.recording.findFirst({
    where: { userId: user.id, originalName, deletedByUser: false },
  });
  if (existing) {
    // 同じものを送り直したとき。音声は変わらないので作り直さないが、
    // 文字起こしが付いてきたなら反映する（付いていなかった録音を後から直せる）。
    if (hasDeviceTranscript) {
      try {
        const n = await applyDeviceTranscript({
          recordingId: existing.id,
          userId: user.id,
          recordedAt: existing.recordedAt ?? existing.createdAt,
          text: deviceText,
          segments: deviceSegments,
          source: deviceSource,
          locale: deviceLocale,
        });
        console.log(`[upload] 既存の録音に端末の文字起こしを反映: ${n}区間 id=${existing.id}`);
        const updated = await prisma.recording.findUnique({ where: { id: existing.id } });
        return NextResponse.json(updated ?? existing, { status: 200 });
      } catch (err) {
        console.error('[upload] 既存録音への反映に失敗', err);
        return NextResponse.json(existing, { status: 200 });
      }
    }
    return NextResponse.json(existing, { status: 200 });
  }

  const ext = path.extname(originalName) || path.extname(file.name) || '.m4a';
  let filename = buildFilename(originalName, ext);

  const userDir = path.join(process.cwd(), 'data', user.username);
  await fs.mkdir(userDir, { recursive: true });

  // 同名ファイルが存在する場合は連番を付与
  let filePath = path.join(userDir, filename);
  let counter = 1;
  while (await fileExists(filePath)) {
    const base = filename.replace(ext, '');
    filePath = path.join(userDir, `${base}_${counter}${ext}`);
    counter++;
  }
  // 最終的なファイル名を更新
  filename = path.basename(filePath);

  const buffer = Buffer.from(await file.arrayBuffer());
  // ディスク上は暗号化（at-rest encryption）。Recording.fileSize は平文サイズで維持。
  await writeEncrypted(filePath, buffer);

  const recordedAt = parseRecordedAtFromFilename(filename) ?? parseRecordedAtFromFilename(originalName) ?? new Date();

  let recording;
  try {
    recording = await prisma.recording.create({
      data: {
        userId: user.id,
        filename,
        originalName,
        displayName,
        filePath: `data/${user.username}/${filename}`,
        fileSize: buffer.length,
        duration,
        mimeType: file.type || 'audio/mp4',
        recordedAt,
      },
    });
  } catch (err: any) {
    // Unique constraint violation (レース条件で同時アップロード時)
    if (err.code === 'P2002') {
      await fs.unlink(filePath).catch(() => {});
      const dup = await prisma.recording.findFirst({
        where: { userId: user.id, originalName },
      });
      if (dup) return NextResponse.json(dup, { status: 200 });
    }
    throw err;
  }

  // 端末で作った文字起こしがあるなら書き込む。Segment も作って検索と時刻の逆引きに乗せる。
  if (hasDeviceTranscript) {
    try {
      const n = await applyDeviceTranscript({
        recordingId: recording.id,
        userId: user.id,
        recordedAt,
        text: deviceText,
        segments: deviceSegments,
        source: deviceSource,
        locale: deviceLocale,
      });
      console.log(`[upload] 端末の文字起こしを採用: ${deviceSegments.length}区間 → ${n}区間にまとめた source=${deviceSource}`);
      recording = (await prisma.recording.findUnique({ where: { id: recording.id } })) ?? recording;
    } catch (err) {
      console.error('[upload] 端末の文字起こしの書き込みに失敗', err);
    }
  }

  // 端末の文字起こしが無いときだけ、サーバー側で文字起こしする（fire-and-forget）
  if (!hasDeviceTranscript) {
    const baseUrl = req.nextUrl.origin;
    const authHeader = req.headers.get('authorization') ?? '';
    fetch(`${baseUrl}/api/recordings/${recording.id}/transcribe`, {
      method: 'POST',
      headers: { authorization: authHeader },
    }).catch(() => {});
  } else {
    console.log(`[upload] サーバー側の文字起こしは省略しました id=${recording.id}`);
  }

  return NextResponse.json(recording, { status: 201 });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
