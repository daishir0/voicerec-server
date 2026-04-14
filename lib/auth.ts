import { cookies } from 'next/headers';
import crypto from 'crypto';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not set. Please configure it in .env file.');
}
const SECRET = process.env.SESSION_SECRET;

const SESSION_COOKIE = 'session';
const IMPERSONATE_COOKIE = 'impersonated_user_id';

export function sign(value: string): string {
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(value);
  return value + '.' + hmac.digest('base64url');
}

function unsign(signed: string): string | null {
  const lastDot = signed.lastIndexOf('.');
  if (lastDot === -1) return null;
  const value = signed.slice(0, lastDot);
  if (sign(value) === signed) return value;
  return null;
}

export interface Session {
  userId: string;
  username: string;
  role: 'user' | 'admin';
  ts: number;
}

// --- Unified session ---

export async function setSession(userId: string, username: string, role: 'user' | 'admin') {
  const data = JSON.stringify({ userId, username, role, ts: Date.now() });
  const signed = sign(Buffer.from(data).toString('base64url'));
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signed, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE);
  if (!cookie) return null;

  const value = unsign(cookie.value);
  if (!value) return null;

  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString()) as Session;
    if (!data.userId || !data.username || !data.role) return null;
    return data;
  } catch {
    return null;
  }
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(IMPERSONATE_COOKIE);
}

// --- Impersonation (admin only) ---

export async function setImpersonatedUserId(userId: string | null) {
  const cookieStore = await cookies();
  if (userId === null) {
    cookieStore.delete(IMPERSONATE_COOKIE);
  } else {
    cookieStore.set(IMPERSONATE_COOKIE, userId, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });
  }
}

export async function getImpersonatedUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(IMPERSONATE_COOKIE);
  return cookie?.value ?? null;
}

/**
 * admin ユーザーがデータ閲覧に使う "実効 userId" を返す。
 * - admin で impersonate 中: impersonatedUserId
 * - それ以外: session.userId
 */
export async function getEffectiveUserId(session: Session): Promise<string> {
  if (session.role === 'admin') {
    const impersonated = await getImpersonatedUserId();
    if (impersonated) return impersonated;
  }
  return session.userId;
}

// --- Back-compat aliases (既存コードを壊さないため) ---

export async function setAdminSession(adminId: string, username: string) {
  await setSession(adminId, username, 'admin');
}

export async function getAdminSession(): Promise<{ adminId: string; username: string } | null> {
  const s = await getSession();
  if (!s || s.role !== 'admin') return null;
  return { adminId: s.userId, username: s.username };
}

export async function clearAdminSession() {
  await clearSession();
}

export async function setUserSession(userId: string, username: string, role: 'user' | 'admin' = 'user') {
  await setSession(userId, username, role);
}

export async function getUserSession(): Promise<{ userId: string; username: string; role?: 'user' | 'admin' } | null> {
  const s = await getSession();
  if (!s) return null;
  return { userId: s.userId, username: s.username, role: s.role };
}

export async function clearUserSession() {
  await clearSession();
}
