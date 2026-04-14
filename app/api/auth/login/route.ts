import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { issueMobileToken } from '@/lib/bearer-auth';

/**
 * モバイル初回ログイン: username/password → Bearer token を返す。
 * トークンは MobileToken テーブルに hash で保存され、平文は返却時の1回のみ。
 */
export async function POST(req: NextRequest) {
  const { username, password, deviceLabel } = await req.json().catch(() => ({}));
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

  const token = await issueMobileToken(user.id, typeof deviceLabel === 'string' ? deviceLabel : undefined);
  return NextResponse.json({
    token,
    userId: user.id,
    username: user.username,
    role: user.role,
  });
}
