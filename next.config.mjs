/** @type {import('next').NextConfig} */
const nextConfig = {
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
