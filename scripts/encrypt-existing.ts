/**
 * 既存の平文録音ファイルを一括で at-rest 暗号化する移行スクリプト。
 *
 * 実行: npx tsx scripts/encrypt-existing.ts [--dry-run]
 *
 * - 全 Recording を走査し、ファイルが存在＆未暗号化なら encryptInPlace で暗号化
 * - 既に暗号化済みのファイルはスキップ
 * - DB スキーマ変更なし（マジックバイトで判別）
 * - サービス停止不要（読み取り側は両対応）
 */

import path from 'path';
import { promises as fsp } from 'fs';
import { prisma } from '@/lib/db';
import { isEncrypted, encryptInPlace } from '@/lib/file-crypto';

interface Stats {
  total: number;
  alreadyEncrypted: number;
  encrypted: number;
  missing: number;
  errors: number;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`▶ Encrypt-Existing migration ${dryRun ? '(DRY RUN)' : ''}`);

  if (!process.env.STORAGE_ENCRYPTION_KEY) {
    console.error('Error: STORAGE_ENCRYPTION_KEY is not set');
    process.exit(1);
  }

  const stats: Stats = { total: 0, alreadyEncrypted: 0, encrypted: 0, missing: 0, errors: 0 };

  const recordings = await prisma.recording.findMany({
    select: { id: true, filePath: true, filename: true, userId: true },
    orderBy: { createdAt: 'asc' },
  });
  stats.total = recordings.length;
  console.log(`  Found ${stats.total} recording rows`);

  for (const rec of recordings) {
    const abs = path.isAbsolute(rec.filePath)
      ? rec.filePath
      : path.join(process.cwd(), rec.filePath);

    try {
      const exists = await fsp.access(abs).then(() => true).catch(() => false);
      if (!exists) {
        console.warn(`  [missing] ${rec.id} ${abs}`);
        stats.missing++;
        continue;
      }

      const enc = await isEncrypted(abs);
      if (enc) {
        stats.alreadyEncrypted++;
        continue;
      }

      if (dryRun) {
        console.log(`  [would-encrypt] ${rec.id} ${abs}`);
        stats.encrypted++;
        continue;
      }

      await encryptInPlace(abs);
      stats.encrypted++;
      console.log(`  [encrypted] ${rec.id} ${rec.filename}`);
    } catch (err) {
      stats.errors++;
      console.error(`  [error] ${rec.id} ${abs}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Total recordings: ${stats.total}`);
  console.log(`  Already encrypted: ${stats.alreadyEncrypted}`);
  console.log(`  ${dryRun ? 'Would encrypt' : 'Encrypted'}: ${stats.encrypted}`);
  console.log(`  Missing files: ${stats.missing}`);
  console.log(`  Errors: ${stats.errors}`);

  await prisma.$disconnect();
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
