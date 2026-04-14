/**
 * E2E テスト基盤: シンプルな assertion ヘルパー、HTTP クライアント、DB アクセス、cleanup。
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

export const prisma = new PrismaClient();

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:18083';
export const FIXTURE_JA_M4A = path.join(__dirname, '..', 'fixtures', 'audio', 'e2e_sample_ja.m4a');

export interface TestResult {
  name: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

// Colors
const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

export async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ name, ok: true, durationMs });
    console.log(`${C.green}✓${C.reset} ${name} ${C.gray}(${durationMs}ms)${C.reset}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, error: msg, durationMs });
    console.log(`${C.red}✗${C.reset} ${name} ${C.gray}(${durationMs}ms)${C.reset}`);
    console.log(`  ${C.red}${msg}${C.reset}`);
    if (err instanceof Error && err.stack) {
      const lines = err.stack.split('\n').slice(1, 4);
      for (const line of lines) console.log(`  ${C.gray}${line.trim()}${C.reset}`);
    }
  }
}

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

export function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertIncludes(haystack: string, needle: string, msg: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`${msg}: "${haystack}" does not include "${needle}"`);
  }
}

export function printSummary(): boolean {
  console.log('');
  console.log(`${C.bold}Results:${C.reset}`);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  console.log(
    `  ${C.green}${passed} passed${C.reset} / ${failed > 0 ? C.red : C.gray}${failed} failed${C.reset} / ${total} total ${C.gray}(${totalMs}ms)${C.reset}`
  );
  return failed === 0;
}

// --- Test user management ---

export interface TestUser {
  id: string;
  username: string;
  password: string;
  role: 'user' | 'admin';
}

const E2E_PREFIX = 'e2e_';

export async function createTestUser(
  usernameSuffix: string,
  role: 'user' | 'admin' = 'user',
): Promise<TestUser> {
  const username = `${E2E_PREFIX}${usernameSuffix}`;
  const password = `pass_${Math.random().toString(36).slice(2, 10)}`;
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role, transcriptionLanguage: 'ja' },
    create: { username, passwordHash, role, transcriptionLanguage: 'ja' },
  });
  return { id: user.id, username, password, role };
}

export async function cleanupE2EUsers(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: E2E_PREFIX } },
    select: { id: true, username: true },
  });
  // recordings ディスクファイルも物理削除
  for (const u of users) {
    const dir = path.join(process.cwd(), 'data', u.username);
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }
  await prisma.user.deleteMany({ where: { username: { startsWith: E2E_PREFIX } } });
}

// --- HTTP helpers ---

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: string;
  json<T = unknown>(): T;
  cookies: string[];
}

export async function httpRaw(
  method: string,
  path: string,
  opts: {
    headers?: Record<string, string>;
    body?: string | FormData;
    cookies?: string[];
  } = {},
): Promise<HttpResponse> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.cookies && opts.cookies.length > 0) {
    headers.Cookie = opts.cookies.join('; ');
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: opts.body,
  });
  const body = await res.text();
  const setCookies: string[] = [];
  // Node fetch exposes set-cookie via res.headers.getSetCookie() in modern versions
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') {
    for (const c of anyHeaders.getSetCookie()) setCookies.push(c);
  } else {
    const raw = res.headers.get('set-cookie');
    if (raw) setCookies.push(raw);
  }
  return {
    status: res.status,
    headers: res.headers,
    body,
    cookies: setCookies,
    json<T = unknown>(): T {
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new Error(`Response is not JSON: ${body.slice(0, 200)}`);
      }
    },
  };
}

export function extractCookieValues(setCookies: string[]): string[] {
  // "session=abc.def; Path=/; HttpOnly" → "session=abc.def"
  return setCookies.map((c) => c.split(';')[0]);
}

// --- Session login helpers ---

export async function loginAsSession(username: string, password: string): Promise<string[]> {
  const res = await httpRaw('POST', '/user/api/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${res.body}`);
  return extractCookieValues(res.cookies);
}

// --- MCP client ---

export async function mcpCall(
  clientId: string,
  clientSecret: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const auth = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 100000),
      method,
      params,
    }),
  });
  if (res.status === 401) throw new Error('MCP: Unauthorized');
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MCP: HTTP ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    result?: unknown;
    error?: { code: number; message: string };
  };
  if (body.error) throw new Error(`MCP: ${body.error.message}`);
  return body.result;
}

// --- Sleep ---

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
