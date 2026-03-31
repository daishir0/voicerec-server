import crypto from 'crypto';

interface OttEntry {
  userId: string;
  username: string;
  expiresAt: number;
}

const store = new Map<string, OttEntry>();

export function generateOtt(userId: string, username: string): string {
  cleanup();
  const token = crypto.randomBytes(32).toString('hex');
  store.set(token, { userId, username, expiresAt: Date.now() + 30_000 });
  return token;
}

export function validateAndConsume(token: string): { userId: string; username: string } | null {
  cleanup();
  const entry = store.get(token);
  if (!entry || entry.expiresAt < Date.now()) {
    store.delete(token);
    return null;
  }
  store.delete(token);
  return { userId: entry.userId, username: entry.username };
}

function cleanup() {
  const now = Date.now();
  store.forEach((val, key) => {
    if (val.expiresAt < now) store.delete(key);
  });
}
