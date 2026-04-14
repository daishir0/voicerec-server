import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAdminSession, getImpersonatedUserId } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 明示的な ?userId= が最優先、なければ impersonatedUserId、両方なければ全件
  const explicitUserId = req.nextUrl.searchParams.get('userId');
  const impersonatedUserId = await getImpersonatedUserId();
  const effectiveUserId = explicitUserId || impersonatedUserId;
  const where = effectiveUserId ? { userId: effectiveUserId } : {};

  const recordings = await prisma.recording.findMany({
    where,
    include: { user: { select: { username: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(recordings);
}
