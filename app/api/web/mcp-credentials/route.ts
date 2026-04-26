import { NextResponse } from 'next/server';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { OAUTH_ISSUER } from '@/lib/oauth';

function getMcpUrl(): string | null {
  if (process.env.MCP_BASE_URL) return process.env.MCP_BASE_URL;
  if (OAUTH_ISSUER) return `${OAUTH_ISSUER}/api/mcp`;
  return null;
}

// GET: 現在のクレデンシャルの存在確認のみ (secret は返さない)
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      mcpClientId: true,
      mcpCredentialsCreatedAt: true,
      mcpLastUsedAt: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  return NextResponse.json({
    hasCredentials: !!user.mcpClientId,
    clientId: user.mcpClientId,
    createdAt: user.mcpCredentialsCreatedAt,
    lastUsedAt: user.mcpLastUsedAt,
    mcpUrl: getMcpUrl(),
  });
}

// POST: 新規発行 (既存があれば上書き)。secret は平文で1回だけ返す
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const clientId = `voicerec-${crypto.randomBytes(8).toString('hex')}`;
  const clientSecret = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(clientSecret, 10);

  await prisma.user.update({
    where: { id: session.userId },
    data: {
      mcpClientId: clientId,
      mcpClientSecretHash: hash,
      mcpCredentialsCreatedAt: new Date(),
      mcpLastUsedAt: null,
    },
  });

  return NextResponse.json({
    clientId,
    clientSecret, // 平文は1回だけ
    mcpUrl: getMcpUrl(),
    createdAt: new Date(),
  });
}

// DELETE: 失効
export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  await prisma.user.update({
    where: { id: session.userId },
    data: {
      mcpClientId: null,
      mcpClientSecretHash: null,
      mcpCredentialsCreatedAt: null,
      mcpLastUsedAt: null,
    },
  });
  return NextResponse.json({ ok: true });
}
