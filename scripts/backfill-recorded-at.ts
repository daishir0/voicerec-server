/**
 * `recordedAt` が空の録音を、ファイル名の yyyymmdd-hhmmss から埋める。
 *
 * ファイル名から録音時刻を取る処理はアップロード経路に後から入ったもので、
 * それ以前（2026年3〜4月）の48件だけが空のまま残っている。ファイル名は当時から
 * 同じ形式で付いているので、アップロード経路と同じ解釈（JST）で復元できる。
 *
 *   npx tsx scripts/backfill-recorded-at.ts            # 何が入るか見るだけ
 *   npx tsx scripts/backfill-recorded-at.ts --apply    # 実際に書き込む
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

/** app/api/recordings/upload/route.ts の parseRecordedAtFromFilename と同じ解釈 */
function parseRecordedAtFromFilename(name: string): Date | null {
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
}

async function main() {
  const targets = await prisma.recording.findMany({
    where: { recordedAt: null },
    select: { id: true, filename: true, originalName: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`recordedAt が空の録音: ${targets.length}件${apply ? '' : '（まだ書き込みません）'}`);

  let ok = 0;
  let skipped = 0;
  for (const r of targets) {
    const at = parseRecordedAtFromFilename(r.filename)
      ?? parseRecordedAtFromFilename(r.originalName);
    if (!at) {
      console.log(`  ${r.filename}: ファイル名に日時が無いので飛ばします`);
      skipped++;
      continue;
    }
    // アップロードは録音の直後なので、ここが大きく離れていたら解釈を疑う
    const gapMin = Math.round((r.createdAt.getTime() - at.getTime()) / 60000);
    const warn = gapMin < -5 || gapMin > 60 * 24 ? '  ⚠️ アップロードとの差が大きい' : '';
    console.log(`  ${r.filename}: → ${at.toISOString()}（アップロードとの差 ${gapMin}分）${warn}`);
    ok++;
    if (apply) {
      await prisma.recording.update({ where: { id: r.id }, data: { recordedAt: at } });
    }
  }
  console.log(`${apply ? '書き込んだ' : '書き込める'}: ${ok}件 / 飛ばす: ${skipped}件`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
