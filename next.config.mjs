/** @type {import('next').NextConfig} */
const nextConfig = {
  // 画像最適化 API は使わない (next/image 未使用)。GHSA-2xp9-vwfh-vxw4 (AVIF 処理経由の
  // 未認証 RCE) は next 15.5.24 で修正済みだが、使わない機能は攻撃面を残さないため無効のまま。
  images: {
    unoptimized: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
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
