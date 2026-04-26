import { NextRequest, NextResponse } from 'next/server';
import { getSession, setImpersonatedUserId, getImpersonatedUserId } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST: { userId: string | null } — null で解除
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userId } = await req.json();

  if (userId === null || userId === undefined) {
    await setImpersonatedUserId(null);
    return NextResponse.json({ ok: true, impersonatedUserId: null });
  }

  if (typeof userId !== 'string') {
    return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  });
  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  await setImpersonatedUserId(target.id);
  return NextResponse.json({ ok: true, impersonatedUserId: target.id, username: target.username });
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = await getImpersonatedUserId();
  if (!id) return NextResponse.json({ impersonatedUserId: null });
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true },
  });
  return NextResponse.json({
    impersonatedUserId: id,
    username: user?.username ?? null,
  });
}
