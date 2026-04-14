import { NextRequest, NextResponse } from 'next/server';
import { authenticateMcp } from '@/lib/mcp-auth';
import { TOOL_DEFINITIONS, callTool } from '@/lib/mcp-tools';

/**
 * MCP HTTP Streamable サーバー (シンプル実装)。
 *
 * プロトコル:
 *   - JSON-RPC 2.0 over HTTP POST
 *   - 認証: Authorization: Basic base64(clientId:clientSecret)
 *   - サポートするメソッド: initialize, tools/list, tools/call, ping
 *
 * Claude.ai のリモートMCP接続から直接呼べる。
 */

const SERVER_INFO = {
  name: 'voicerec-mcp',
  version: '1.0.0',
};

const PROTOCOL_VERSION = '2024-11-05';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

export async function POST(req: NextRequest) {
  const user = await authenticateMcp(req);
  if (!user) {
    return NextResponse.json(
      rpcError(null, -32000, 'Unauthorized'),
      { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="mcp"' } },
    );
  }

  let body: JsonRpcRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 });
  }

  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return NextResponse.json(rpcError(body?.id ?? null, -32600, 'Invalid Request'), { status: 400 });
  }

  const id = body.id ?? null;
  const method = body.method;
  const params = body.params ?? {};

  try {
    switch (method) {
      case 'initialize': {
        return NextResponse.json(
          rpcResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: {},
            },
            serverInfo: SERVER_INFO,
          }),
        );
      }
      case 'notifications/initialized':
      case 'initialized': {
        // Notifications have no response
        return new NextResponse(null, { status: 204 });
      }
      case 'ping': {
        return NextResponse.json(rpcResult(id, {}));
      }
      case 'tools/list': {
        return NextResponse.json(
          rpcResult(id, {
            tools: TOOL_DEFINITIONS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          }),
        );
      }
      case 'tools/call': {
        const toolName = typeof params.name === 'string' ? params.name : '';
        const toolArgs =
          params.arguments && typeof params.arguments === 'object'
            ? (params.arguments as Record<string, unknown>)
            : {};
        if (!toolName) {
          return NextResponse.json(rpcError(id, -32602, 'Missing tool name'), { status: 400 });
        }
        try {
          const result = await callTool(user.id, toolName, toolArgs);
          return NextResponse.json(
            rpcResult(id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
              structuredContent: result,
              isError: false,
            }),
          );
        } catch (toolErr) {
          const msg = toolErr instanceof Error ? toolErr.message : 'Unknown tool error';
          return NextResponse.json(
            rpcResult(id, {
              content: [{ type: 'text', text: `Error: ${msg}` }],
              isError: true,
            }),
          );
        }
      }
      default:
        return NextResponse.json(rpcError(id, -32601, `Method not found: ${method}`), {
          status: 404,
        });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json(rpcError(id, -32603, msg), { status: 500 });
  }
}

// GET は一部の MCP クライアントが capability 確認に使う場合があるため簡易応答を返す
export async function GET() {
  return NextResponse.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocolVersion: PROTOCOL_VERSION,
    transport: 'http-jsonrpc',
    tools: TOOL_DEFINITIONS.map((t) => t.name),
  });
}
