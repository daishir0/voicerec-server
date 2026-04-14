import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import {
  ACCESS_TOKEN_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  generateOpaqueToken,
  hashSha256,
  verifyPkceS256,
} from '@/lib/oauth';

/**
 * OAuth 2.0 Token Endpoint (RFC 6749 §3.2 + §6 refresh)
 *
 * Body (form-encoded or JSON):
 *   grant_type=authorization_code
 *   code=...
 *   redirect_uri=...
 *   client_id=voicerec-xxxxxxxx
 *   client_secret=...     (Basic ヘッダでも可)
 *   code_verifier=...
 *
 *   または
 *   grant_type=refresh_token
 *   refresh_token=...
 *   client_id=...
 *   client_secret=...
 */

interface TokenParams {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
}

function tokenError(error: string, description?: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    },
  );
}

async function readParams(req: NextRequest): Promise<TokenParams> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries()) as TokenParams;
  }
  if (ct.includes('application/json')) {
    return (await req.json().catch(() => ({}))) as TokenParams;
  }
  // 念のため両方試す
  try {
    return (await req.json()) as TokenParams;
  } catch {
    return {};
  }
}

function readBasicClient(req: NextRequest): { id?: string; secret?: string } {
  const auth = req.headers.get('authorization');
  if (!auth || !auth.startsWith('Basic ')) return {};
  try {
    const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf-8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return {};
    return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
  } catch {
    return {};
  }
}

async function authenticateClient(
  req: NextRequest,
  params: TokenParams,
): Promise<{ ok: false; res: NextResponse } | { ok: true; userId: string; clientId: string }> {
  const basic = readBasicClient(req);
  const clientId = basic.id || params.client_id;
  const clientSecret = basic.secret || params.client_secret;
  if (!clientId || !clientSecret) {
    return { ok: false, res: tokenError('invalid_client', 'client credentials required', 401) };
  }
  const user = await prisma.user.findUnique({ where: { mcpClientId: clientId } });
  if (!user || !user.mcpClientSecretHash) {
    return { ok: false, res: tokenError('invalid_client', 'unknown client_id', 401) };
  }
  const ok = await bcrypt.compare(clientSecret, user.mcpClientSecretHash);
  if (!ok) {
    return { ok: false, res: tokenError('invalid_client', 'invalid client_secret', 401) };
  }
  // fire-and-forget
  prisma.user
    .update({ where: { id: user.id }, data: { mcpLastUsedAt: new Date() } })
    .catch(() => {});
  return { ok: true, userId: user.id, clientId };
}

export async function POST(req: NextRequest) {
  const params = await readParams(req);
  const grantType = params.grant_type;

  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
    return tokenError('unsupported_grant_type', `grant_type=${grantType ?? 'missing'}`);
  }

  const auth = await authenticateClient(req, params);
  if (!auth.ok) return auth.res;

  if (grantType === 'authorization_code') {
    return handleAuthorizationCode(auth.userId, auth.clientId, params);
  }
  return handleRefreshToken(auth.userId, auth.clientId, params);
}

async function handleAuthorizationCode(
  userId: string,
  clientId: string,
  params: TokenParams,
): Promise<NextResponse> {
  const { code, redirect_uri, code_verifier } = params;
  if (!code || !redirect_uri || !code_verifier) {
    return tokenError('invalid_request', 'code, redirect_uri, code_verifier are required');
  }

  const codeHash = hashSha256(code);
  const stored = await prisma.oAuthAuthCode.findUnique({ where: { code: codeHash } });
  if (!stored) {
    return tokenError('invalid_grant', 'unknown code');
  }
  if (stored.consumedAt) {
    // 二重使用検知 → 既存のトークンも全部失効させるべきだが、ここでは拒否のみ
    return tokenError('invalid_grant', 'code already used');
  }
  if (stored.expiresAt.getTime() < Date.now()) {
    return tokenError('invalid_grant', 'code expired');
  }
  if (stored.userId !== userId || stored.clientId !== clientId) {
    return tokenError('invalid_grant', 'code does not match client');
  }
  if (stored.redirectUri !== redirect_uri) {
    return tokenError('invalid_grant', 'redirect_uri mismatch');
  }
  if (stored.codeChallengeMethod !== 'S256') {
    return tokenError('invalid_grant', 'unsupported code_challenge_method');
  }
  if (!verifyPkceS256(code_verifier, stored.codeChallenge)) {
    return tokenError('invalid_grant', 'PKCE verification failed');
  }

  // コード消費
  await prisma.oAuthAuthCode.update({
    where: { id: stored.id },
    data: { consumedAt: new Date() },
  });

  // access_token + refresh_token 発行
  return issueTokens(userId, clientId, stored.scope);
}

async function handleRefreshToken(
  userId: string,
  clientId: string,
  params: TokenParams,
): Promise<NextResponse> {
  const refreshToken = params.refresh_token;
  if (!refreshToken) {
    return tokenError('invalid_request', 'refresh_token is required');
  }
  const refreshHash = hashSha256(refreshToken);
  const stored = await prisma.oAuthAccessToken.findUnique({ where: { refreshHash } });
  if (!stored || stored.userId !== userId || stored.clientId !== clientId) {
    return tokenError('invalid_grant', 'unknown refresh_token');
  }
  if (stored.revokedAt || (stored.refreshExpAt && stored.refreshExpAt.getTime() < Date.now())) {
    return tokenError('invalid_grant', 'refresh_token expired or revoked');
  }
  // 旧トークンを revoke して新規発行
  await prisma.oAuthAccessToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });
  return issueTokens(userId, clientId, stored.scope);
}

async function issueTokens(
  userId: string,
  clientId: string,
  scope: string | null,
): Promise<NextResponse> {
  const accessToken = generateOpaqueToken(32);
  const refreshToken = generateOpaqueToken(32);
  const now = Date.now();
  await prisma.oAuthAccessToken.create({
    data: {
      tokenHash: hashSha256(accessToken),
      refreshHash: hashSha256(refreshToken),
      userId,
      clientId,
      scope,
      expiresAt: new Date(now + ACCESS_TOKEN_TTL_SEC * 1000),
      refreshExpAt: new Date(now + REFRESH_TOKEN_TTL_SEC * 1000),
    },
  });
  return NextResponse.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      refresh_token: refreshToken,
      scope: scope ?? 'mcp',
    },
    {
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    },
  );
}
