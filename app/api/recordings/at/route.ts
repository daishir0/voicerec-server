import { NextRequest, NextResponse } from 'next/server';
import { authenticateBearer } from '@/lib/bearer-auth';
import { prisma } from '@/lib/db';
import { OAUTH_ISSUER } from '@/lib/oauth';

/**
 * GET /api/recordings/at?t=<ISO8601>[&all=1]
 *
 * 指定した絶対時刻 T を含む録音を返す。Papernote の付箋（貼り付け日時）から
 * 「その瞬間の音声」へジャンプするための逆引き API。
 *
 * 判定: recordedAt <= T < recordedAt + duration   （offset = T - recordedAt 秒）
 *
 * 注意:
 *   - 静的セグメント 'at' は Next.js の優先順位で [id] より先にマッチするため、
 *     /api/recordings/[id] とは衝突しない。
 *   - 対象は Bearer が指すユーザーの録音のみ（role に関わらず横断しない）。
 *   - deletedByUser=true と recordedAt=null と duration<=0 は対象外。
 *     duration<=0 は録音長が不明で範囲判定ができないため。
 */

const MAX_ALL_RESULTS = 20;

interface AtRow {
  id: string;
  displayName: string;
  recordedAt: Date;
  duration: number;
}

function buildPageUrl(id: string, offset: number): string {
  // 再生画面は Cookie セッション必須のため、別タブ導線は公開 URL を返す。
  // OAUTH_ISSUER 未設定時のみ相対パスにフォールバック。
  const path = `/recordings?r=${encodeURIComponent(id)}&t=${offset}`;
  return OAUTH_ISSUER ? `${OAUTH_ISSUER}${path}` : path;
}

function toPayload(row: AtRow, t: Date) {
  const offset = (t.getTime() - row.recordedAt.getTime()) / 1000;
  const rounded = Math.round(offset * 1000) / 1000;
  return {
    id: row.id,
    displayName: row.displayName,
    recordedAt: row.recordedAt.toISOString(),
    duration: row.duration,
    offset: rounded,
    playUrl: `/api/recordings/${row.id}/audio`,
    pageUrl: buildPageUrl(row.id, rounded),
  };
}

export async function GET(req: NextRequest) {
  const user = await authenticateBearer(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get('t');
  if (!raw) {
    return NextResponse.json({ error: "Missing required query parameter 't'" }, { status: 400 });
  }

  // '+09:00' が空白へデコードされた場合（URL エンコード漏れ）を救済する
  const normalised = raw.includes('+') || !/ \d{2}:\d{2}$/.test(raw)
    ? raw
    : raw.replace(/ (\d{2}:\d{2})$/, '+$1');

  const t = new Date(normalised);
  if (isNaN(t.getTime())) {
    return NextResponse.json(
      { error: `Invalid timestamp 't': ${raw}. Use ISO 8601 (e.g. 2026-09-10T14:32:50+09:00).` },
      { status: 400 },
    );
  }

  const all = req.nextUrl.searchParams.get('all') === '1';

  // recordedAt + duration 秒 の比較は Prisma のカラム同士演算では書けないため raw SQL。
  const rows = await prisma.$queryRaw<AtRow[]>`
    SELECT id, "displayName", "recordedAt", duration
    FROM "Recording"
    WHERE "userId" = ${user.id}
      AND "deletedByUser" = false
      AND "recordedAt" IS NOT NULL
      AND duration > 0
      AND "recordedAt" <= ${t}
      AND "recordedAt" + (duration * interval '1 second') > ${t}
    ORDER BY "recordedAt" DESC
    LIMIT ${all ? MAX_ALL_RESULTS : 1}
  `;

  if (rows.length === 0) {
    return NextResponse.json({ found: false });
  }

  if (all) {
    return NextResponse.json({
      found: true,
      count: rows.length,
      recordings: rows.map((r) => toPayload(r, t)),
    });
  }

  return NextResponse.json({ found: true, recording: toPayload(rows[0], t) });
}
