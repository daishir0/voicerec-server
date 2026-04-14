import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import type { User } from '@prisma/client';

/**
 * MCPリクエストの Authorization: Basic base64(clientId:clientSecret) を検証し、
 * 対応するUser を返す。無効なら null。
 */
export async function authenticateMcp(req: Request): Promise<User | null> {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Basic ')) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf-8');
  } catch {
    return null;
  }

  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  const clientId = decoded.slice(0, idx);
  const clientSecret = decoded.slice(idx + 1);
  if (!clientId || !clientSecret) return null;

  const user = await prisma.user.findUnique({ where: { mcpClientId: clientId } });
  if (!user || !user.mcpClientSecretHash) return null;

  const ok = await bcrypt.compare(clientSecret, user.mcpClientSecretHash);
  if (!ok) return null;

  // fire-and-forget lastUsedAt update
  prisma.user
    .update({ where: { id: user.id }, data: { mcpLastUsedAt: new Date() } })
    .catch(() => {});

  return user;
}
