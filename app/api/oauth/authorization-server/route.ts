import { NextResponse } from 'next/server';
import { OAUTH_ISSUER } from '@/lib/oauth';

/**
 * RFC 8414: OAuth 2.0 Authorization Server Metadata
 * Claude.ai が /.well-known/oauth-authorization-server から取得する
 */
export async function GET() {
  return NextResponse.json(
    {
      issuer: OAUTH_ISSUER,
      authorization_endpoint: `${OAUTH_ISSUER}/authorize`,
      token_endpoint: `${OAUTH_ISSUER}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: ['mcp'],
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
