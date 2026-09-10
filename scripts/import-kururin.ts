/**
 * kururin (旧システム) の録音を voicerec-server へ一括インポートするスクリプト。
 *
 * 旧システムは音声を 1 分ごとの mp3 (yyyymmdd-hhmmss.mp3) と、同名の
 * 文字起こし txt (yyyymmdd-hhmmss.txt) で保持している。
 * 本スクリプトは:
 *   1. 指定の開始時刻から「3 分以内の間隔で連続するファイル群」を 1 録音として束ね
 *      (= kururin 本体 get_continuous_files と同じ録音単位判定)
 *   2. 束ねた mp3 を ffmpeg で 1 本に無劣化結合 (-c copy)
 *   3. AES-256-GCM で暗号化して data/<username>/<start>.mp3 に保存
 *   4. 既存の 1 分 txt を「1 分粒度の Segment」として DB 登録
 *      → Whisper API を一切呼ばずに文字起こし結果を移行 (コスト 0)
 *
 * 実行例 (必ずキーを持つログインシェル経由で):
 *   bash -lc 'cd srv18083 && npx tsx scripts/import-kururin.ts \
 *       --start=20260118-100000 --user=test1 --kururin-dir=<path> [--dry-run]'
 *
 * オプション:
 *   --start=YYYYMMDD-HHMMSS  録音単位の開始ファイル (必須)
 *   --user=<username>        取り込み先 voicerec ユーザー名 (必須)
 *   --kururin-dir=<path>     kururin のユーザーディレクトリ (必須)
 *   --dry-run                DB / ファイルに書き込まず、対象内容のみ表示
 */

import path from 'path';
import os from 'os';
import { promises as fsp } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { prisma } from '@/lib/db';
import { moveAndEncrypt } from '@/lib/file-crypto';

const execFileP = promisify(execFile);

const GROUP_GAP_MINUTES = 3; // kururin と同じ閾値
const SEGMENT_SECONDS = 60; // 1 ファイル = 1 分

const EXCLUDE_YEARS = ['1960', '1969']; // 異常日付 (移行対象外)

interface Args {
  start?: string;
  all: boolean;
  limit: number;
  user: string;
  kururinDir: string;
  dryRun: boolean;
  deleteSource: boolean;
}

function parseArgs(): Args {
  const get = (k: string) =>
    process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
  const start = get('start');
  const user = get('user');
  const all = process.argv.includes('--all');
  if (!all && (!start || !/^\d{8}-\d{6}$/.test(start))) {
    throw new Error('--start=YYYYMMDD-HHMMSS または --all が必要です');
  }
  if (!user) throw new Error('--user=<username> が必要です');
  // 既定値は持たない (環境固有パス・個人情報をリポジトリに残さないため)
  const kururinDir = get('kururin-dir');
  if (!kururinDir) throw new Error('--kururin-dir=<path> が必要です (kururin のユーザーディレクトリ)');
  return {
    start,
    all,
    limit: parseInt(get('limit') || '0', 10) || 0,
    user,
    kururinDir,
    dryRun: process.argv.includes('--dry-run'),
    deleteSource: process.argv.includes('--delete-source'),
  };
}

/** ディレクトリ全体を 3 分ルールでグループ化し、各録音単位の開始スタンプを返す */
async function enumerateGroupStarts(dir: string): Promise<string[]> {
  const all = (await fsp.readdir(dir))
    .filter((f) => /^\d{8}-\d{6}\.mp3$/.test(f))
    .map((f) => f.slice(0, -4))
    .sort();
  const starts: string[] = [];
  let prev: Date | null = null;
  for (const s of all) {
    const cur = parseJst(s);
    if (!prev || (cur.getTime() - prev.getTime()) / 1000 > GROUP_GAP_MINUTES * 60) {
      starts.push(s);
    }
    prev = cur;
  }
  return starts;
}

/** "YYYYMMDD-HHMMSS" を JST(+09:00) の Date として解釈 */
function parseJst(stamp: string): Date {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`invalid stamp: ${stamp}`);
  const [, y, mo, d, h, mi, s] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
}

/** 開始ファイルから 3 分ルールで連続する分ファイル群を取得 */
async function buildGroup(dir: string, start: string): Promise<string[]> {
  const all = (await fsp.readdir(dir))
    .filter((f) => /^\d{8}-\d{6}\.mp3$/.test(f))
    .map((f) => f.slice(0, -4))
    .sort();
  const startIdx = all.indexOf(start);
  if (startIdx === -1) throw new Error(`開始ファイルが見つかりません: ${start}.mp3`);

  const group: string[] = [all[startIdx]];
  let prev = parseJst(all[startIdx]);
  for (let i = startIdx + 1; i < all.length; i++) {
    const cur = parseJst(all[i]);
    if ((cur.getTime() - prev.getTime()) / 1000 <= GROUP_GAP_MINUTES * 60) {
      group.push(all[i]);
      prev = cur;
    } else break;
  }
  return group;
}

async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  return parseFloat(stdout.trim()) || 0;
}

/** mp3 の codec|sample_rate|channels を取得 */
async function ffprobeFormat(file: string): Promise<string> {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,channels',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  return stdout.trim().replace(/\s+/g, '|');
}

/**
 * mp3 群を結合。グループ内フォーマットが一致すれば -c copy (無劣化・高速)、
 * 異なれば 44.1kHz/stereo/128k に再エンコードして結合 (壊れ防止)。
 * @returns 'copy' | 'reencode'
 */
async function concatMp3(dir: string, stamps: string[], outPath: string): Promise<string> {
  // 先頭・末尾のフォーマットを比較 (1 録音内で形式が変わるのは稀)
  const first = await ffprobeFormat(path.join(dir, stamps[0] + '.mp3'));
  const last = await ffprobeFormat(path.join(dir, stamps[stamps.length - 1] + '.mp3'));
  const uniform = first === last;

  const listPath = path.join(os.tmpdir(), `kururin-concat-${process.pid}.txt`);
  const lines = stamps
    .map((s) => `file '${path.join(dir, s + '.mp3').replace(/'/g, "'\\''")}'`)
    .join('\n');
  await fsp.writeFile(listPath, lines);
  try {
    const codecArgs = uniform
      ? ['-c', 'copy']
      : ['-c:a', 'libmp3lame', '-ar', '44100', '-ac', '2', '-b:a', '128k'];
    await execFileP('ffmpeg', [
      '-v', 'error', '-y', '-f', 'concat', '-safe', '0',
      '-i', listPath, ...codecArgs, outPath,
    ]);
  } finally {
    await fsp.unlink(listPath).catch(() => {});
  }
  return uniform ? 'copy' : 'reencode';
}

/** 各分 txt を読み、空でないものだけ返す */
async function readTexts(dir: string, stamps: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const s of stamps) {
    const p = path.join(dir, s + '.txt');
    try {
      const t = (await fsp.readFile(p, 'utf-8')).trim();
      if (t) map.set(s, t);
    } catch {
      /* txt 欠損はスキップ */
    }
  }
  return map;
}

type ImportStatus = 'imported' | 'skipped' | 'error';
interface ImportResult { status: ImportStatus; start: string; detail: string; }

/** 1 録音単位をインポート */
async function importOne(
  user: { id: string; transcriptionLanguage: string | null },
  args: Args,
  start: string,
): Promise<ImportResult> {
  const group = await buildGroup(args.kururinDir, start);
  const recordedAt = parseJst(start);

  let title = '';
  try {
    title = (await fsp.readFile(
      path.join(args.kururinDir, `${start}_title.txt`), 'utf-8',
    )).trim();
  } catch { /* タイトル無し */ }

  const filename = `${start}.mp3`;
  const originalName = filename;
  const displayName = title || recordedAt.toISOString();
  const filePath = `data/${args.user}/${filename}`;
  const absDest = path.join(process.cwd(), filePath);

  // 重複チェック (バッチではスキップ)
  const dup = await prisma.recording.findUnique({
    where: { userId_originalName: { userId: user.id, originalName } },
  });
  if (dup) return { status: 'skipped', start, detail: `既存 (recordingId=${dup.id})` };

  // Segment 構築 (1 分粒度・空テキストは除外)
  const texts = await readTexts(args.kururinDir, group);
  const segments = group
    .filter((s) => texts.has(s))
    .map((s, i) => {
      const offset = (parseJst(s).getTime() - recordedAt.getTime()) / 1000;
      return {
        seq: i,
        startOffset: offset,
        endOffset: offset + SEGMENT_SECONDS,
        startAt: new Date(recordedAt.getTime() + offset * 1000),
        endAt: new Date(recordedAt.getTime() + (offset + SEGMENT_SECONDS) * 1000),
        text: texts.get(s)!,
      };
    });
  const fullText = segments.map((s) => s.text).join('\n');
  const pseudoSegments = segments.map((s) => ({
    start: s.startOffset, end: s.endOffset, text: s.text,
  }));

  if (args.dryRun) {
    return {
      status: 'imported',
      start,
      detail: `[DRY] ${group.length}分 / Segment ${segments.length} / "${displayName}"`,
    };
  }

  // mp3 結合 → 暗号化保存
  const tmpConcat = path.join(os.tmpdir(), `kururin-${process.pid}-${start}.mp3`);
  const mode = await concatMp3(args.kururinDir, group, tmpConcat);
  const duration = await ffprobeDuration(tmpConcat);
  const fileSize = (await fsp.stat(tmpConcat)).size; // 平文サイズ
  await fsp.mkdir(path.dirname(absDest), { recursive: true });
  await moveAndEncrypt(tmpConcat, absDest); // tmpConcat は内部で削除される

  const now = new Date();
  const recording = await prisma.$transaction(async (tx) => {
    const rec = await tx.recording.create({
      data: {
        userId: user.id,
        filename, originalName, displayName, filePath, fileSize, duration,
        mimeType: 'audio/mpeg',
        transcriptionStatus: 'completed',
        transcriptionText: fullText,
        transcriptionSegments: JSON.stringify(pseudoSegments),
        transcriptionAt: now,
        whisperTranscribedAt: now,
        language: user.transcriptionLanguage || 'ja',
        recordedAt,
      },
    });
    if (segments.length) {
      await tx.segment.createMany({
        data: segments.map((s) => ({ ...s, recordingId: rec.id, userId: user.id })),
      });
    }
    return rec;
  });

  // --delete-source: 検証後フェーズ用。元 mp3/txt 群を削除して容量を解放
  let deleted = 0;
  if (args.deleteSource) {
    for (const s of group) {
      for (const ext of ['.mp3', '.txt']) {
        await fsp.unlink(path.join(args.kururinDir, s + ext)).then(() => { deleted++; }).catch(() => {});
      }
    }
  }

  return {
    status: 'imported',
    start,
    detail: `${(fileSize / 1024 / 1024).toFixed(1)}MB / ${duration.toFixed(0)}s / seg=${segments.length} / concat=${mode} / "${displayName}"`
      + (args.deleteSource ? ` / 元削除=${deleted}` : ''),
  };
}

async function main() {
  const args = parseArgs();
  console.log(`▶ kururin import ${args.dryRun ? '(DRY RUN)' : ''}  user=${args.user}`
    + (args.deleteSource ? '  [元データ削除あり]' : ''));

  if (!process.env.STORAGE_ENCRYPTION_KEY) {
    throw new Error('STORAGE_ENCRYPTION_KEY 未設定。bash -lc 経由で実行してください');
  }

  const user = await prisma.user.findUnique({ where: { username: args.user } });
  if (!user) throw new Error(`ユーザーが存在しません: ${args.user}`);

  // 対象スタンプ一覧を決定
  let starts: string[];
  if (args.all) {
    starts = (await enumerateGroupStarts(args.kururinDir))
      .filter((s) => !EXCLUDE_YEARS.includes(s.slice(0, 4)));
    if (args.limit > 0) starts = starts.slice(0, args.limit);
    console.log(`対象録音: ${starts.length} 件 (1960/1969除外${args.limit ? ` / 先頭${args.limit}件` : ''})`);
  } else {
    starts = [args.start!];
  }

  const counts = { imported: 0, skipped: 0, error: 0 };
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    try {
      const r = await importOne(user, args, s);
      counts[r.status]++;
      console.log(`[${i + 1}/${starts.length}] ${r.status === 'imported' ? '✅' : r.status === 'skipped' ? '⏭ ' : '✗'} ${s}  ${r.detail}`);
    } catch (e: any) {
      counts.error++;
      console.error(`[${i + 1}/${starts.length}] ✗ ${s}  エラー: ${e.message}`);
    }
  }

  console.log(`\n=== 完了: imported=${counts.imported} skipped=${counts.skipped} error=${counts.error} ===`);
}

main()
  .catch((e) => { console.error('✗ エラー:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
