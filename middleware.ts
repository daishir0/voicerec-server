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

/**
 * 旧 URL → 新 URL への永続リダイレクト (308 = メソッド維持)。
 * モバイルが叩く /user/api/auto-login だけは中身が変わったので残置（リダイレクトしない）。
 */
const LEGACY_REDIRECTS: Record<string, string> = {
  '/user/login': '/login',
  '/admin/login': '/login',
  '/user/recordings': '/recordings',
  '/admin/recordings': '/recordings',
  '/user/settings': '/settings',
};

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 旧 URL の永続リダイレクト
  const target = LEGACY_REDIRECTS[pathname];
  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.redirect(url, { status: 308 });
  }

  // Public pages: login + auto-login
  const isPublic =
    pathname === '/login' ||
    pathname.startsWith('/api/session/login') ||
    pathname.startsWith('/user/api/auto-login') ||
    // OAuth エンドポイントは内部で session 検査するので middleware では通す
    pathname.startsWith('/.well-known/') ||
    pathname.startsWith('/authorize') ||
    pathname.startsWith('/token');

  if (isPublic) {
    return NextResponse.next();
  }

  // 認証必須ゾーン: /recordings, /settings, /admin, /api/session/{logout,me}, /api/web/*, /api/admin/*
  const requiresSession =
    pathname === '/recordings' ||
    pathname === '/settings' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/session/me') ||
    pathname.startsWith('/api/session/logout') ||
    pathname.startsWith('/api/web/') ||
    pathname.startsWith('/api/admin/');

  if (!requiresSession) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get('session')?.value;
  const session = await parseSessionCookie(sessionCookie);

  if (!session) {
    // ページなら /login にリダイレクト、API なら 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    if (pathname !== '/login') {
      loginUrl.searchParams.set('next', pathname + search);
    }
    return NextResponse.redirect(loginUrl);
  }

  // /admin/* は admin role 必須
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin/')) {
    if (session.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // 旧 URL リダイレクト用
    '/user/:path*',
    '/admin/:path*',
    // 新 URL の認証ガード
    '/recordings',
    '/settings',
    '/login',
    '/api/session/:path*',
    '/api/web/:path*',
    '/api/admin/:path*',
  ],
};
