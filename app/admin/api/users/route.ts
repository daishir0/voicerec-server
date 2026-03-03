import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAdminSession } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const users = await prisma.user.findMany({
    include: { _count: { select: { recordings: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { username, passwordHash } });
  return NextResponse.json(user, { status: 201 });
}
