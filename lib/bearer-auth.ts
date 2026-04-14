import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { prisma } from './db';
import type { User } from '@prisma/client';

/**
 * モバイル/外部クライアント向け Bearer token 認証。
 * POST /api/auth/login で発行されたトークンを検証する。
 *
 * Basic 認証は完全削除済み。このモジュールが /api/* の唯一の認証経路。
 */

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function authenticateBearer(req: NextRequest): Promise<User | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const tokenHash = hashToken(token);
  const mobileToken = await prisma.mobileToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!mobileToken) return null;
  if (mobileToken.revokedAt) return null;

  // fire-and-forget lastUsedAt update
  prisma.mobileToken
    .update({ where: { id: mobileToken.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return mobileToken.user;
}

/**
 * 新規トークン発行。戻り値は保存済みトークンの平文 (クライアントに1回だけ返す)。
 */
export async function issueMobileToken(userId: string, deviceLabel?: string): Promise<string> {
  // 32バイトのランダムを base64url (=43 chars)
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  await prisma.mobileToken.create({
    data: {
      userId,
      tokenHash,
      deviceLabel: deviceLabel ?? null,
    },
  });
  return token;
}

export { hashToken };
