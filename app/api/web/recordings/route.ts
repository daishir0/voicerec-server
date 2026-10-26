import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, getImpersonatedUserId } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * 録音一覧（Web 用、Cookie 認証、role で分岐、カーソルベース無限スクロール）。
 *
 * 挙動:
 * - role='user': 自分の録音のみ（deletedByUser=false）
 * - role='admin': 全件 OR ?userId= で絞り込み (impersonated > explicit 優先)
 *
 * Query params:
 * - limit:   1 件あたりの取得件数（既定 50、上限 200）
 * - before:  カーソル（録音 ID）。これより古い順に取得
 * - search:  displayName / filename / transcriptionText に対する大文字小文字無視 contains
 *            （admin は user.username にも一致）
 * - userId:  admin のみ。特定ユーザーで絞り込み
 * - detail:  '1' のとき transcriptionText / transcriptionSegments も返す（1件取得用）
 *
 * Response: { items: Recording[], nextCursor: string | null }
 *
 * ⚠️ 既定では本文と区間 JSON を返さない。
 * 以前は select を書いておらず全列を返していたため、50件の初回表示で **7.1MB** になっていた。
 * うち transcriptionSegments が 5.0MB で、一覧画面はこの列を一度も読んでいない
 * （区間は /api/web/recordings/[id]/segments から取る）。本文も行を開くまで使わない。
 * 本文の有無だけは一覧で要るので、長さを別途まとめて引いて transcriptionTextLength で返す。
 */

/** 一覧に出すのに必要な列だけ。重い本文と区間 JSON は入れない */
const LIST_SELECT = {
  id: true,
  userId: true,
  filename: true,
  originalName: true,
  displayName: true,
  fileSize: true,
  duration: true,
  mimeType: true,
  transcriptionStatus: true,
  transcriptionSource: true,
  language: true,
  recordedAt: true,
  whisperTranscribedAt: true,
  whisperError: true,
  deletedByUser: true,
  deletedByUserAt: true,
  createdAt: true,
} as const;
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const limitRaw = parseInt(sp.get('limit') ?? '', 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT));
  const before = sp.get('before') || null;
  const search = (sp.get('search') ?? '').trim();
  const id = sp.get('id') || null;
  // 1件を開くときだけ、本文と区間 JSON も返す
  const detail = sp.get('detail') === '1';

  const where: Prisma.RecordingWhereInput = {};
  // ?id= で特定録音を直接取得（URL直接リンク用）
  if (id) where.id = id;
  const isAdmin = session.role === 'admin';

  if (isAdmin) {
    // 明示的な ?userId= が最優先、なければ impersonatedUserId、両方なければ全件
    const explicitUserId = sp.get('userId');
    const impersonatedUserId = await getImpersonatedUserId();
    const effectiveUserId = explicitUserId || impersonatedUserId;
    if (effectiveUserId) where.userId = effectiveUserId;
  } else {
    where.userId = session.userId;
    where.deletedByUser = false;
  }

  if (search) {
    const orClauses: Prisma.RecordingWhereInput[] = [
      { displayName: { contains: search, mode: 'insensitive' } },
      { filename: { contains: search, mode: 'insensitive' } },
      { transcriptionText: { contains: search, mode: 'insensitive' } },
    ];
    if (isAdmin) {
      orClauses.push({ user: { username: { contains: search, mode: 'insensitive' } } });
    }
    where.OR = orClauses;
  }

  const items = await prisma.recording.findMany({
    where,
    select: {
      ...LIST_SELECT,
      ...(detail ? { transcriptionText: true, transcriptionSegments: true, transcriptionAt: true } : {}),
      ...(isAdmin ? { user: { select: { username: true } } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

  // 本文そのものは送らないが「何文字あるか」は一覧で要る（有無のバッジ、議事録一覧の文字数）。
  // 長さだけを DB 側で計算させるので、本文は一切サーバーの外に出ない。
  let withLength: unknown[] = sliced;
  if (!detail && sliced.length > 0) {
    const ids = sliced.map((r) => r.id);
    const rows = await prisma.$queryRaw<{ id: string; len: number }[]>`
      SELECT id, length(coalesce("transcriptionText", ''))::int AS len
      FROM "Recording" WHERE id = ANY(${ids})
    `;
    const lenOf = new Map(rows.map((r) => [r.id, Number(r.len)]));
    withLength = sliced.map((r) => ({ ...r, transcriptionTextLength: lenOf.get(r.id) ?? 0 }));
  }

  return NextResponse.json({ items: withLength, nextCursor });
}
