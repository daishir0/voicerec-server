import { cookies } from 'next/headers';
import crypto from 'crypto';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not set. Please configure it in .env file.');
}
const SECRET = process.env.SESSION_SECRET;

const SESSION_COOKIE = 'session';
const IMPERSONATE_COOKIE = 'impersonated_user_id';

// 本番では HTTPS のみで cookie を送信。next start (NODE_ENV=production) を想定。
// 開発時 (npm run dev) は localhost HTTP でも動くよう false。
const SECURE_COOKIE = process.env.NODE_ENV === 'production';

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
    secure: SECURE_COOKIE,
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
      secure: SECURE_COOKIE,
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

