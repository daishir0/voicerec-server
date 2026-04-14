import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import type { User } from '@prisma/client';
import { hashSha256 } from '@/lib/oauth';

/**
 * MCP リクエスト認証。次の2方式を受け付ける:
 *
 *   1. Authorization: Bearer <access_token>
 *      OAuth 2.0 で発行された access_token (Claude.ai リモートMCP用)
 *
 *   2. Authorization: Basic base64(clientId:clientSecret)
 *      事前共有 credentials (curl テスト等の互換用)
 *
 * いずれも対応する User を返す。無効なら null。
 */
export async function authenticateMcp(req: Request): Promise<User | null> {
  const auth = req.headers.get('authorization');
  if (!auth) return null;

  if (auth.startsWith('Bearer ')) {
    return authenticateBearer(auth.slice(7).trim());
  }
  if (auth.startsWith('Basic ')) {
    return authenticateBasic(auth.slice(6).trim());
  }
  return null;
}

async function authenticateBearer(token: string): Promise<User | null> {
  if (!token) return null;
  const tokenHash = hashSha256(token);
  const stored = await prisma.oAuthAccessToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!stored) return null;
  if (stored.revokedAt) return null;
  if (stored.expiresAt.getTime() < Date.now()) return null;

  // fire-and-forget
  prisma.oAuthAccessToken
    .update({ where: { id: stored.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  prisma.user
    .update({ where: { id: stored.userId }, data: { mcpLastUsedAt: new Date() } })
    .catch(() => {});

  return stored.user;
}

async function authenticateBasic(b64: string): Promise<User | null> {
  let decoded: string;
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf-8');
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

  prisma.user
    .update({ where: { id: user.id }, data: { mcpLastUsedAt: new Date() } })
    .catch(() => {});
  return user;
}
