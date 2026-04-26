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
 *
 * Response: { items: Recording[], nextCursor: string | null }
 */
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

  const where: Prisma.RecordingWhereInput = {};
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
    include: isAdmin ? { user: { select: { username: true } } } : undefined,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

  return NextResponse.json({ items: sliced, nextCursor });
}
