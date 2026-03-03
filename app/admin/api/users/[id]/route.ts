import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAdminSession } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const { username, password } = await req.json();
  const data: Record<string, string> = {};
  if (username) data.username = username;
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.update({ where: { id }, data });
  return NextResponse.json(user);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
