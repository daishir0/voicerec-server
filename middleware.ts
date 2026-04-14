import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware は Edge Runtime で動くため Node.js の crypto は使えない。
 * Web Crypto API (globalThis.crypto.subtle) で HMAC-SHA256 を検証する。
 * lib/auth.ts と同じキー/フォーマットで署名された cookie を検証する。
 */

const SECRET = process.env.SESSION_SECRET || '';

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const enc = new TextEncoder();
  cachedKey = await globalThis.crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return cachedKey;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const normalized = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function unsign(signed: string): Promise<string | null> {
  const lastDot = signed.lastIndexOf('.');
  if (lastDot === -1) return null;
  const value = signed.slice(0, lastDot);
  const sig = signed.slice(lastDot + 1);
  try {
    const key = await getKey();
    const enc = new TextEncoder();
    const expected = await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(value));
    const expectedStr = base64UrlEncode(new Uint8Array(expected));
    if (expectedStr !== sig) return null;
    return value;
  } catch {
    return null;
  }
}

interface MwSession {
  userId: string;
  username: string;
  role: 'user' | 'admin';
}

async function parseSessionCookie(cookieValue: string | undefined): Promise<MwSession | null> {
  if (!cookieValue) return null;
  const value = await unsign(cookieValue);
  if (!value) return null;
  try {
    const bytes = base64UrlDecode(value);
    const jsonStr = new TextDecoder().decode(bytes);
    const data = JSON.parse(jsonStr) as MwSession;
    if (!data.userId || !data.username || !data.role) return null;
    return data;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public pages: login endpoints
  const isLoginPath =
    pathname.startsWith('/admin/login') ||
    pathname.startsWith('/admin/api/login') ||
    pathname.startsWith('/user/login') ||
    pathname.startsWith('/user/api/login') ||
    pathname.startsWith('/user/api/auto-login');

  if (isLoginPath) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get('session')?.value;
  const session = await parseSessionCookie(sessionCookie);

  // Admin area: require admin role
  if (pathname.startsWith('/admin')) {
    if (!session) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    if (session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }
  }

  // User area: any authenticated session
  if (pathname.startsWith('/user')) {
    if (!session) {
      return NextResponse.redirect(new URL('/user/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/user/:path*'],
};
