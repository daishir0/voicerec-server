/**
 * 端末の文字起こしで取り込んだ録音を、いまの保存形に作り直す。
 *
 * 2026-10-24 以前に取り込んだものは
 *   - `whisperTranscribedAt` が空 → 画面に時刻つきタブが出ない
 *   - Segment が1文字ずつ → 読めないし、語をまたぐ検索が当たらない
 * という状態で入っている。`transcriptionSegments` に端末が送ってきた元データが
 * そのまま残っているので、音声を送り直さなくてもここから作り直せる。
 *
 *   npx tsx scripts/repair-device-segments.ts            # 何が変わるか見るだけ
 *   npx tsx scripts/repair-device-segments.ts --apply    # 実際に書き込む
 */
import { PrismaClient } from '@prisma/client';
import { groupSegments, type RawSegment } from '../lib/group-segments';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const targets = await prisma.recording.findMany({
    where: { transcriptionSource: { startsWith: 'device-' } },
    select: {
      id: true, userId: true, filename: true, recordedAt: true, createdAt: true,
      transcriptionSegments: true, whisperTranscribedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`端末由来の録音: ${targets.length}件${apply ? '' : '（まだ書き込みません）'}`);

  for (const r of targets) {
    if (!r.transcriptionSegments) {
      console.log(`  ${r.filename}: 元データが無いので飛ばします`);
      continue;
    }
    let raw: RawSegment[];
    try {
      raw = (JSON.parse(r.transcriptionSegments) as any[]).map((s) => ({
        startSec: Number(s.start ?? s.startSec) || 0,
        endSec: Number(s.end ?? s.endSec) || 0,
        text: String(s.text ?? ''),
      }));
    } catch (err) {
      console.log(`  ${r.filename}: 元データを読めません (${err})`);
      continue;
    }

    const grouped = groupSegments(raw);
    const before = await prisma.segment.count({ where: { recordingId: r.id } });
    console.log(
      `  ${r.filename}: Segment ${before} → ${grouped.length}件 / ` +
      `whisperTranscribedAt ${r.whisperTranscribedAt ? 'あり' : 'なし→入れる'}`,
    );
    if (!apply) continue;

    const base = (r.recordedAt ?? r.createdAt).getTime();
    const now = new Date();
    await prisma.$transaction([
      prisma.segment.deleteMany({ where: { recordingId: r.id } }),
      prisma.segment.createMany({
        data: grouped.map((s, i) => ({
          recordingId: r.id,
          userId: r.userId,
          seq: i,
          startOffset: s.startSec,
          endOffset: s.endSec,
          startAt: new Date(base + s.startSec * 1000),
          endAt: new Date(base + s.endSec * 1000),
          text: s.text,
        })),
      }),
      prisma.recording.update({
        where: { id: r.id },
        data: {
          transcriptionSegments: JSON.stringify(
            grouped.map((s) => ({ start: s.startSec, end: s.endSec, text: s.text })),
          ),
          whisperTranscribedAt: grouped.length > 0 ? (r.whisperTranscribedAt ?? now) : null,
        },
      }),
    ]);
    console.log(`    → 書き込みました`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
