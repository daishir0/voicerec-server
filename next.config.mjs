/** @type {import('next').NextConfig} */
const nextConfig = {
  // GHSA-2xp9-vwfh-vxw4 (画像最適化APIのAVIF処理経由の未認証RCE) の応急対応。
  // next 14系に修正版が無く 15.5.24 へのメジャー更新が必要なため、当該APIを無効化して回避する。
  // このアプリは next/image を使用していないため機能影響なし。next更新後はこの行を外してよい。
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  api: {
    bodyParser: {
      sizeLimit: '500mb',
    },
  },
  async rewrites() {
    return [
      // OAuth Discovery (Claude.ai Remote MCP)
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/authorization-server',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/api/mcp',
        destination: '/api/oauth/protected-resource',
      },
    ];
  },
};

export default nextConfig;
