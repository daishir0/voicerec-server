import { NextRequest, NextResponse } from 'next/server';
import { validateAndConsume } from '@/lib/ott';
import { sign } from '@/lib/auth';

function getBaseUrl(req: NextRequest): string {
  const host = req.headers.get('host') || req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const base = getBaseUrl(req);

  if (!token) {
    return NextResponse.redirect(`${base}/user/login`);
  }

  const result = validateAndConsume(token);
  if (!result) {
    return NextResponse.redirect(`${base}/user/login`);
  }

  const data = JSON.stringify({ userId: result.userId, username: result.username, ts: Date.now() });
  const signed = sign(Buffer.from(data).toString('base64url'));

  const response = NextResponse.redirect(`${base}/user/recordings`);
  response.cookies.set('user_session', signed, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
  return response;
}
