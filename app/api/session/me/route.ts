import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

/**
 * 現在ログイン中のユーザー情報を返す（user / admin 共用）。
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json({
    userId: session.userId,
    username: session.username,
    role: session.role,
  });
}
