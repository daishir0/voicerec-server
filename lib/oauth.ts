import crypto from 'crypto';

/**
 * OAuth 2.0 + PKCE 共通ヘルパー
 * - 認可サーバー issuer URL は OAUTH_ISSUER 環境変数から取得
 * - access_token / auth code は SHA-256 でハッシュして DB 保存
 * - PKCE は S256 のみサポート
 */

export const OAUTH_ISSUER = (process.env.OAUTH_ISSUER || '').replace(/\/+$/, '');

if (!OAUTH_ISSUER) {
  console.warn('[oauth] OAUTH_ISSUER is not set. OAuth endpoints will not work correctly.');
}

export const AUTH_CODE_TTL_SEC = 5 * 60; // 5 分
export const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 時間
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60; // 30 日

export function hashSha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * PKCE S256 の検証: SHA256(verifier) を base64url した値が challenge と一致するか
 */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  const computed = crypto.createHash('sha256').update(codeVerifier).digest();
  const computedB64 = computed
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return computedB64 === codeChallenge;
}

/**
 * Claude.ai のリダイレクトURIを許可するか判定
 * 厳格には事前登録するべきだが、デフォルトは https://claude.ai/api/mcp/auth_callback と
 * 同一プレフィックスを許可する。環境変数で追加可能。
 */
export function isAllowedRedirectUri(uri: string): boolean {
  if (!uri) return false;
  const allowed = [
    'https://claude.ai/api/mcp/auth_callback',
    ...(process.env.OAUTH_ALLOWED_REDIRECT_URIS || '').split(',').map((s) => s.trim()).filter(Boolean),
  ];
  return allowed.some((prefix) => uri === prefix || uri.startsWith(prefix + '?'));
}
