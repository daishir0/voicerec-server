import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from "@/lib/bearer-auth";
import { prisma } from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

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
  const user = await authenticateBearer(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const originalName = (formData.get('originalName') as string) || file.name;
  const displayName = (formData.get('displayName') as string) || originalName;
  // アプリからミリ秒で送られるので秒に変換
  const durationRaw = parseFloat((formData.get('duration') as string) || '0');
  const duration = durationRaw > 1000 ? durationRaw / 1000 : durationRaw;

  // 重複チェック: 同じユーザー・同じoriginalNameが既にあれば既存を返す
  const existing = await prisma.recording.findFirst({
    where: { userId: user.id, originalName, deletedByUser: false },
  });
  if (existing) {
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
  await fs.writeFile(filePath, buffer);

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

  // 非同期で文字起こしを自動開始（fire-and-forget）
  const baseUrl = req.nextUrl.origin;
  const authHeader = req.headers.get('authorization') ?? '';
  fetch(`${baseUrl}/api/recordings/${recording.id}/transcribe`, {
    method: 'POST',
    headers: { authorization: authHeader },
  }).catch(() => {});

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
