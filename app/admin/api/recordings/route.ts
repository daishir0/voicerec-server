import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAdminSession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = req.nextUrl.searchParams.get('userId');
  const where = userId ? { userId } : {};

  const recordings = await prisma.recording.findMany({
    where,
    include: { user: { select: { username: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(recordings);
}
