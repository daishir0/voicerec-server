import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAdminSession, getImpersonatedUserId } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * 管理者用録音一覧（カーソルベース無限スクロール対応）。
 *
 * Query params:
 * - userId:  特定ユーザーで絞り込み（impersonated > explicit の優先順）
 * - limit:   1 件あたりの取得件数（既定 50、上限 200）
 * - before:  カーソル（録音 ID）。これより古い順に取得
 * - search:  displayName / filename / transcriptionText / user.username に対する大文字小文字無視 contains
 *
 * Response: { items: Recording[], nextCursor: string | null }
 */
export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  // 明示的な ?userId= が最優先、なければ impersonatedUserId、両方なければ全件
  const explicitUserId = sp.get('userId');
  const impersonatedUserId = await getImpersonatedUserId();
  const effectiveUserId = explicitUserId || impersonatedUserId;

  const limitRaw = parseInt(sp.get('limit') ?? '', 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT));
  const before = sp.get('before') || null;
  const search = (sp.get('search') ?? '').trim();

  const where: Prisma.RecordingWhereInput = {};
  if (effectiveUserId) where.userId = effectiveUserId;
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: 'insensitive' } },
      { filename: { contains: search, mode: 'insensitive' } },
      { transcriptionText: { contains: search, mode: 'insensitive' } },
      { user: { username: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const items = await prisma.recording.findMany({
    where,
    include: { user: { select: { username: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

  return NextResponse.json({ items: sliced, nextCursor });
}
