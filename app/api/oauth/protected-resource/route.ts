import { NextResponse } from 'next/server';
import { OAUTH_ISSUER } from '@/lib/oauth';

/**
 * RFC 9728: OAuth 2.0 Protected Resource Metadata
 * Claude.ai が /.well-known/oauth-protected-resource (および /api/mcp suffix) から取得する
 */
export async function GET() {
  return NextResponse.json(
    {
      resource: `${OAUTH_ISSUER}/api/mcp`,
      authorization_servers: [OAUTH_ISSUER],
      bearer_methods_supported: ['header'],
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
