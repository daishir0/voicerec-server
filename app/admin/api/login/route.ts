import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { setAdminSession } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  const admin = await prisma.user.findUnique({ where: { username } });
  if (!admin || admin.role !== 'admin') {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  await setAdminSession(admin.id, admin.username);
  return NextResponse.json({ ok: true, username: admin.username });
}
