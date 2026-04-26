import { NextRequest, NextResponse } from 'next/server';
import { validateAndConsume } from '@/lib/ott';
import { setSession } from '@/lib/auth';
import { OAUTH_ISSUER } from '@/lib/oauth';

function getBaseUrl(req: NextRequest): string {
  if (OAUTH_ISSUER) return OAUTH_ISSUER;
  const host = req.headers.get('host') || req.nextUrl.host;
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  const base = getBaseUrl(req);

  if (!token) {
    return NextResponse.redirect(`${base}/login`);
  }

  const result = validateAndConsume(token);
  if (!result) {
    return NextResponse.redirect(`${base}/login`);
  }

  // 統一 session Cookie を発行 (role='user', Cookie名='session')
  await setSession(result.userId, result.username, 'user');

  return NextResponse.redirect(`${base}/recordings`);
}
