import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSession, clearSession } from '@/lib/auth';
import {
  AUTH_CODE_TTL_SEC,
  OAUTH_ISSUER,
  generateOpaqueToken,
  hashSha256,
  isAllowedRedirectUri,
} from '@/lib/oauth';

/**
 * OAuth 2.0 Authorization Endpoint (RFC 6749 §3.1, RFC 7636 PKCE)
 *
 * クエリ:
 *   response_type=code
 *   client_id=voicerec-xxxxxxxx (User.mcpClientId)
 *   redirect_uri=https://claude.ai/api/mcp/auth_callback
 *   code_challenge=...
 *   code_challenge_method=S256
 *   state=...
 *   scope=mcp (オプション)
 *
 * 動作:
 *   1. session cookie がなければ /login?next=<このURL> にリダイレクト
 *   2. ログイン中のユーザーが client_id の所有者と一致しなければエラー
 *   3. 認可コードを発行して redirect_uri に code+state でリダイレクト
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const responseType = url.searchParams.get('response_type');
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const state = url.searchParams.get('state') ?? '';
  const scope = url.searchParams.get('scope') ?? 'mcp';

  // バリデーション
  if (responseType !== 'code') {
    return errorPage('unsupported_response_type', 'response_type must be "code"');
  }
  if (!clientId) {
    return errorPage('invalid_request', 'client_id is required');
  }
  if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
    return errorPage('invalid_request', `redirect_uri not allowed: ${redirectUri}`);
  }
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return errorPage('invalid_request', 'PKCE S256 code_challenge is required');
  }

  // client_id 所有者の確認
  const ownerUser = await prisma.user.findUnique({
    where: { mcpClientId: clientId },
  });
  if (!ownerUser) {
    return errorPage('invalid_client', `Unknown client_id: ${clientId}`);
  }

  // ログインチェック
  const session = await getSession();
  if (!session) {
    // 未ログイン → ログインページへ。next で戻り先を指定
    // OAUTH_ISSUER を base にして公開URLにする (Apache proxy 経由でも安定)
    const fullPath = url.pathname + url.search;
    const base = OAUTH_ISSUER || `${url.protocol}//${url.host}`;
    const loginUrl = new URL('/login', base);
    loginUrl.searchParams.set('next', fullPath);
    return NextResponse.redirect(loginUrl);
  }

  // ログイン中ユーザーが client_id 所有者と一致しない場合は
  // 現在のセッションを破棄してログインページへ (正しいユーザーで入り直せる)
  if (session.userId !== ownerUser.id) {
    await clearSession();
    const fullPath = url.pathname + url.search;
    const base = OAUTH_ISSUER || `${url.protocol}//${url.host}`;
    const loginUrl = new URL('/login', base);
    loginUrl.searchParams.set('next', fullPath);
    loginUrl.searchParams.set(
      'hint',
      `MCP連携には "${ownerUser.username}" でログインしてください (現在は ${session.username} でログイン中)`,
    );
    return NextResponse.redirect(loginUrl);
  }

  // 認可コード発行
  const code = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000);
  await prisma.oAuthAuthCode.create({
    data: {
      code: hashSha256(code),
      userId: session.userId,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      scope,
      expiresAt,
    },
  });

  // redirect_uri に code+state を付けてリダイレクト
  const redirect = new URL(redirectUri);
  redirect.searchParams.set('code', code);
  if (state) redirect.searchParams.set('state', state);
  return NextResponse.redirect(redirect);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function errorPage(error: string, description: string) {
  const safeError = escapeHtml(error);
  const safeDescription = escapeHtml(description);
  return new NextResponse(
    `<html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto;">
      <h1 style="color:#d00;">OAuth Error</h1>
      <p><strong>${safeError}</strong></p>
      <p>${safeDescription}</p>
      <p style="color:#666;font-size:12px;">Close this window and retry from Claude.ai.</p>
    </body></html>`,
    {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    },
  );
}
