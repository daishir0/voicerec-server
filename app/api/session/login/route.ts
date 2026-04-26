import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { setSession } from '@/lib/auth';
import bcrypt from 'bcryptjs';

/**
 * Cookie ログイン（user / admin 共用）。role は User.role から判定。
 * Bearer トークン用の `/api/auth/login` (モバイル) とは別系統。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { username, password, requireAdmin } = body as {
    username?: string;
    password?: string;
    requireAdmin?: boolean;
  };
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // requireAdmin=true（旧 /admin/api/login 互換）の場合は admin role 必須
  if (requireAdmin && user.role !== 'admin') {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const role: 'user' | 'admin' = user.role === 'admin' ? 'admin' : 'user';
  await setSession(user.id, user.username, role);
  return NextResponse.json({ ok: true, userId: user.id, username: user.username, role });
}
