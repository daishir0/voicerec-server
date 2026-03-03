import { cookies } from 'next/headers';
import crypto from 'crypto';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not set. Please configure it in .env file.');
}
const SECRET = process.env.SESSION_SECRET;

function sign(value: string): string {
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

export async function setAdminSession(adminId: string, username: string) {
  const data = JSON.stringify({ adminId, username, ts: Date.now() });
  const signed = sign(Buffer.from(data).toString('base64url'));
  const cookieStore = await cookies();
  cookieStore.set('admin_session', signed, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24,
  });
}

export async function getAdminSession(): Promise<{ adminId: string; username: string } | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get('admin_session');
  if (!cookie) return null;

  const value = unsign(cookie.value);
  if (!value) return null;

  try {
    const data = JSON.parse(Buffer.from(value, 'base64url').toString());
    return { adminId: data.adminId, username: data.username };
  } catch {
    return null;
  }
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete('admin_session');
}
