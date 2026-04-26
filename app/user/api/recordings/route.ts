import { NextRequest, NextResponse } from 'next/server';
import { getUserSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * 録音一覧（カーソルベース無限スクロール対応）。
 *
 * Query params:
 * - limit:   1 件あたりの取得件数（既定 50、上限 200）
 * - before:  カーソル（録音 ID）。これより古い順に取得
 * - search:  displayName / filename / transcriptionText に対する大文字小文字無視 contains
 *
 * Response: { items: Recording[], nextCursor: string | null }
 */
export async function GET(req: NextRequest) {
  const session = await getUserSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const limitRaw = parseInt(sp.get('limit') ?? '', 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT));
  const before = sp.get('before') || null;
  const search = (sp.get('search') ?? '').trim();

  const where: Prisma.RecordingWhereInput = {
    userId: session.userId,
    deletedByUser: false,
  };
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: 'insensitive' } },
      { filename: { contains: search, mode: 'insensitive' } },
      { transcriptionText: { contains: search, mode: 'insensitive' } },
    ];
  }

  const items = await prisma.recording.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(before ? { cursor: { id: before }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const sliced = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? sliced[sliced.length - 1].id : null;

  return NextResponse.json({ items: sliced, nextCursor });
}
