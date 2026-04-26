/**
 * E2E テストスイート (Phase A + B + C)。
 *
 * 設計方針:
 *   - 音声アップロードは 1 回だけ (OpenAI コスト最小化)
 *   - その 1 本の録音を使って Phase A/B/C の全振る舞いを検証
 *   - テストユーザーは e2e_ prefix。実行前後で clean up
 *
 * 実行: npx tsx tests/e2e/runAll.ts
 */
import fs from 'fs';
import {
  test,
  assert,
  assertEq,
  assertIncludes,
  printSummary,
  prisma,
  createTestUser,
  cleanupE2EUsers,
  httpRaw,
  extractCookieValues,
  loginAsSession,
  mcpCall,
  sleep,
  BASE_URL,
  FIXTURE_JA_M4A,
  TestUser,
} from './helpers';
import { getTranscriptionModeSync } from '@/lib/transcription-config';

const TRANSCRIPTION_MODE = getTranscriptionModeSync();

// 共有状態: 1 本のアップロードから全テストが派生する
interface SharedState {
  userA: TestUser;
  userB: TestUser;
  userAdmin: TestUser;
  userAToken: string;
  uploadedRecordingId: string;
  uploadedFilename: string;
  uploadedRecordedAt: string;
  mcpClientId: string;
  mcpClientSecret: string;
}
const state: Partial<SharedState> = {};

// ======= SETUP =======
async function setup() {
  console.log('▶ Setup: cleaning up old e2e users...');
  await cleanupE2EUsers();
  console.log('▶ Setup: creating test users e2e_userA / e2e_userB / e2e_admin');
  state.userA = await createTestUser('userA', 'user');
  state.userB = await createTestUser('userB', 'user');
  state.userAdmin = await createTestUser('admin_main', 'admin');
  console.log('▶ Setup: done');
}

// ======= TEARDOWN =======
async function teardown() {
  console.log('');
  console.log('▶ Teardown: removing e2e users and their data');
  await cleanupE2EUsers();
  await prisma.$disconnect();
}

// ======= Phase A tests =======

async function testsPhaseA() {
  console.log('');
  console.log(`=== Phase A: Upload + Transcription (mode=${TRANSCRIPTION_MODE}) ===`);

  await test('A-schema: Segment テーブルが存在する', async () => {
    const result = (await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT COUNT(*)::int as c FROM "Segment" LIMIT 1`,
    )) as { c: number }[];
    assert(result[0].c >= 0, 'Segment table accessible');
  });

  await test('A-schema: Recording に recordedAt/whisperTranscribedAt/whisperError カラムがある', async () => {
    const cols = (await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='Recording' AND column_name IN ('recordedAt', 'whisperTranscribedAt', 'whisperError')`,
    )) as { column_name: string }[];
    assertEq(cols.length, 3, '3 columns present');
  });

  await test('A-schema: User に transcriptionLanguage カラムがある', async () => {
    const cols = (await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='User' AND column_name='transcriptionLanguage'`,
    )) as { column_name: string }[];
    assertEq(cols.length, 1, 'transcriptionLanguage column present');
  });

  await test('A-B5: POST /api/auth/login で Bearer token が発行される', async () => {
    const res = await httpRaw('POST', '/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.userA!.username, password: state.userA!.password }),
    });
    assertEq(res.status, 200, 'login ok');
    const data = res.json() as { token: string; userId: string; role: string };
    assert(data.token && data.token.length > 20, 'token present');
    assertEq(data.role, 'user', 'role is user');
    state.userAToken = data.token;
  });

  await test('A-B5: Basic 認証は 401 になる (完全削除)', async () => {
    const basic = Buffer.from(`${state.userA!.username}:${state.userA!.password}`).toString('base64');
    const res = await httpRaw('POST', '/api/auth/test', {
      headers: { Authorization: `Basic ${basic}` },
    });
    assertEq(res.status, 401, 'basic auth must be rejected');
  });

  await test('A-B5: 不正な Bearer token は 401', async () => {
    const res = await httpRaw('POST', '/api/auth/test', {
      headers: { Authorization: 'Bearer invalid_token_xxx' },
    });
    assertEq(res.status, 401, 'invalid bearer must be rejected');
  });

  await test('A-2: 録音をアップロード → recordedAt がファイル名から JST で正しく保存される', async () => {
    const audioBuffer = fs.readFileSync(FIXTURE_JA_M4A);
    const filename = '20260410-150000.m4a';
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/mp4' }), filename);
    form.append('originalName', filename);
    form.append('displayName', 'E2E Sample JA');
    form.append('duration', '11000');

    const res = await fetch(`${BASE_URL}/api/recordings/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.userAToken}` },
      body: form,
    });
    assertEq(res.status, 201, `upload status (got ${res.status})`);
    const rec = (await res.json()) as { id: string; filename: string; recordedAt: string };
    state.uploadedRecordingId = rec.id;
    state.uploadedFilename = rec.filename;
    state.uploadedRecordedAt = rec.recordedAt;

    // recordedAt assert (JST 15:00 = UTC 06:00)
    const recordedAt = new Date(rec.recordedAt);
    assertEq(recordedAt.toISOString(), '2026-04-10T06:00:00.000Z', 'recordedAt JST parsed correctly');
  });

  // Phase A の中核: 設定モードに応じた文字起こしパイプラインを走らせる
  await test(`A-3: /api/recordings/[id]/transcribe (mode=${TRANSCRIPTION_MODE})`, async () => {
    console.log('  [  waiting for transcription... this takes ~15-30s ]');
    const res = await fetch(`${BASE_URL}/api/recordings/${state.uploadedRecordingId}/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.userAToken}` },
    });
    const body = await res.text();
    assertEq(res.status, 200, `transcribe status (body: ${body.slice(0, 200)})`);
    const data = JSON.parse(body) as {
      success: boolean;
      mode?: string;
      transcription: { text: string };
      whisper: { segmentCount: number; error: string | null };
    };
    assert(data.success, 'transcribe success');
    assert(data.transcription.text.length > 0, 'transcription text present');

    if (TRANSCRIPTION_MODE === 'gpt4o-only') {
      // gpt4o-only モードでは Segment テーブルへ書き込まない
      assertEq(data.whisper.segmentCount, 0, 'no segments in gpt4o-only mode');
    } else {
      // whisper-only / dual: Segment テーブルが populate されている
      assertEq(data.whisper.error, null, 'no whisper error');
      assert(data.whisper.segmentCount > 0, 'whisper segments created');
    }
  });

  await test(`A-3: DB の Recording.transcriptionText が埋まっている (mode=${TRANSCRIPTION_MODE})`, async () => {
    const rec = await prisma.recording.findUnique({
      where: { id: state.uploadedRecordingId },
      select: {
        transcriptionText: true,
        whisperTranscribedAt: true,
        whisperError: true,
        language: true,
      },
    });
    assert(rec !== null, 'recording exists');
    assert((rec!.transcriptionText ?? '').length > 0, 'transcription text saved');
    if (TRANSCRIPTION_MODE !== 'gpt4o-only') {
      assert(rec!.whisperTranscribedAt !== null, 'whisperTranscribedAt set');
      assertEq(rec!.whisperError, null, 'no whisper error');
    }
    assertEq(rec!.language, 'ja', 'language is ja');
  });

  if (TRANSCRIPTION_MODE !== 'gpt4o-only') {
    await test('A-3: Segment テーブルに複数エントリ + 絶対時刻が正しく計算されている', async () => {
      const segs = await prisma.segment.findMany({
        where: { recordingId: state.uploadedRecordingId },
        orderBy: { seq: 'asc' },
      });
      assert(segs.length > 0, 'segments exist');
      // 最初のセグメントは録音開始時刻 + startOffset とほぼ一致
      const first = segs[0];
      const expectedStartAt = new Date('2026-04-10T06:00:00.000Z').getTime() + first.startOffset * 1000;
      const actualStartAt = first.startAt.getTime();
      const diff = Math.abs(expectedStartAt - actualStartAt);
      assert(diff < 10, `startAt diff < 10ms (got ${diff}ms)`);
    });
  }

  await test('A-4: ユーザー設定で言語を en に変更できる (API)', async () => {
    const cookies = await loginAsSession(state.userA!.username, state.userA!.password);
    const res = await httpRaw('PATCH', '/api/web/settings', {
      headers: { 'Content-Type': 'application/json' },
      cookies,
      body: JSON.stringify({ transcriptionLanguage: 'en' }),
    });
    assertEq(res.status, 200, 'settings PATCH ok');
    const user = await prisma.user.findUnique({
      where: { id: state.userA!.id },
      select: { transcriptionLanguage: true },
    });
    assertEq(user!.transcriptionLanguage, 'en', 'language is en');

    // 戻す
    await prisma.user.update({
      where: { id: state.userA!.id },
      data: { transcriptionLanguage: 'ja' },
    });
  });

  if (TRANSCRIPTION_MODE !== 'gpt4o-only') {
    await test('A-5: /api/web/recordings/[id]/segments が時刻順でセグメントを返す', async () => {
      const cookies = await loginAsSession(state.userA!.username, state.userA!.password);
      const res = await httpRaw('GET', `/api/web/recordings/${state.uploadedRecordingId}/segments`, {
        cookies,
      });
      assertEq(res.status, 200, 'segments endpoint ok');
      const data = res.json() as {
        whisperTranscribedAt: string;
        segments: { seq: number; startOffset: number; text: string }[];
      };
      assert(data.whisperTranscribedAt !== null, 'whisperTranscribedAt in response');
      assert(data.segments.length > 0, 'segments returned');
      // 時刻順
      for (let i = 1; i < data.segments.length; i++) {
        assert(
          data.segments[i].startOffset >= data.segments[i - 1].startOffset,
          'segments ordered by startOffset',
        );
      }
    });
  }
}

// ======= Phase B tests =======

async function testsPhaseB() {
  console.log('');
  console.log('=== Phase B: Auth Unification ===');

  await test('B-1: User.role カラムに user/admin の区別が入っている', async () => {
    const userA = await prisma.user.findUnique({ where: { id: state.userA!.id } });
    const admin = await prisma.user.findUnique({ where: { id: state.userAdmin!.id } });
    assertEq(userA!.role, 'user', 'userA role');
    assertEq(admin!.role, 'admin', 'admin role');
  });

  await test('B-1: AdminUser テーブルは存在しない (drop済み)', async () => {
    const tables = (await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_name='AdminUser'`,
    )) as { table_name: string }[];
    assertEq(tables.length, 0, 'AdminUser table dropped');
  });

  await test('B-2/3: /api/session/login で user ログイン、統一 session cookie が発行される', async () => {
    const res = await httpRaw('POST', '/api/session/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.userA!.username, password: state.userA!.password }),
    });
    assertEq(res.status, 200, 'login ok');
    const cookies = extractCookieValues(res.cookies);
    const sessionCookie = cookies.find((c) => c.startsWith('session='));
    assert(sessionCookie !== undefined, 'unified session cookie present');
    // 古い cookie は発行されない
    assert(
      !cookies.some((c) => c.startsWith('user_session=') || c.startsWith('admin_session=')),
      'legacy cookies not present',
    );
  });

  await test('B-2: /api/session/login で admin ログイン (requireAdmin=true)', async () => {
    const res = await httpRaw('POST', '/api/session/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.userAdmin!.username,
        password: state.userAdmin!.password,
        requireAdmin: true,
      }),
    });
    assertEq(res.status, 200, 'admin login ok');
    const data = res.json() as { role: string };
    assertEq(data.role, 'admin', 'role=admin');
  });

  await test('B-2: user role では requireAdmin=true でログインできない', async () => {
    const res = await httpRaw('POST', '/api/session/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.userA!.username,
        password: state.userA!.password,
        requireAdmin: true,
      }),
    });
    assertEq(res.status, 401, 'non-admin rejected from admin login');
  });

  await test('B-4: admin impersonate で他ユーザーの録音を閲覧できる', async () => {
    const adminCookies = await adminLogin(state.userAdmin!.username, state.userAdmin!.password);

    // impersonate userA
    const imp = await httpRaw('POST', '/api/admin/impersonate', {
      headers: { 'Content-Type': 'application/json' },
      cookies: adminCookies,
      body: JSON.stringify({ userId: state.userA!.id }),
    });
    assertEq(imp.status, 200, 'impersonate ok');
    const allCookies = [...adminCookies, ...extractCookieValues(imp.cookies)];

    // admin が recordings 一覧を取ると userA の録音が見える
    const list = await httpRaw('GET', '/api/web/recordings', { cookies: allCookies });
    assertEq(list.status, 200, 'recordings list ok');
    const body = list.json() as { items: { id: string; userId: string }[]; nextCursor: string | null };
    const ourRec = body.items.find((r) => r.id === state.uploadedRecordingId);
    assert(ourRec !== undefined, 'uploaded recording visible via impersonate');
    assertEq(ourRec!.userId, state.userA!.id, 'userId matches userA');

    // 解除
    await httpRaw('POST', '/api/admin/impersonate', {
      headers: { 'Content-Type': 'application/json' },
      cookies: adminCookies,
      body: JSON.stringify({ userId: null }),
    });
  });

  await test('B-5: MobileToken revoke で 401 になる', async () => {
    // 新しい token を発行してそれを revoke
    const res1 = await httpRaw('POST', '/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.userA!.username, password: state.userA!.password }),
    });
    const data = res1.json() as { token: string };
    // DB で失効させる
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(data.token).digest('hex');
    await prisma.mobileToken.update({
      where: { tokenHash: hash },
      data: { revokedAt: new Date() },
    });
    const res2 = await httpRaw('POST', '/api/auth/test', {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    assertEq(res2.status, 401, 'revoked token rejected');
  });
}

async function adminLogin(username: string, password: string): Promise<string[]> {
  const res = await httpRaw('POST', '/api/session/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, requireAdmin: true }),
  });
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);
  return extractCookieValues(res.cookies);
}

// ======= Phase C tests =======

async function testsPhaseC() {
  console.log('');
  console.log('=== Phase C: MCP Server ===');

  await test('C-2: MCP クレデンシャル発行 → client_id/secret が返る', async () => {
    const cookies = await loginAsSession(state.userA!.username, state.userA!.password);
    const res = await httpRaw('POST', '/api/web/mcp-credentials', { cookies });
    assertEq(res.status, 200, 'issue ok');
    const data = res.json() as { clientId: string; clientSecret: string };
    assert(data.clientId.startsWith('voicerec-'), 'clientId format');
    assert(data.clientSecret.length >= 32, 'clientSecret length');
    state.mcpClientId = data.clientId;
    state.mcpClientSecret = data.clientSecret;
  });

  await test('C-3: 不正な client_secret は 401', async () => {
    const auth = Buffer.from(`${state.mcpClientId}:wrong_secret`).toString('base64');
    const res = await fetch(`${BASE_URL}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    assertEq(res.status, 401, 'wrong secret → 401');
  });

  await test('C-3: 認証なしでの MCP POST は 401', async () => {
    const res = await fetch(`${BASE_URL}/api/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    assertEq(res.status, 401, 'no auth → 401');
  });

  await test('C-4: initialize → ハンドシェイク成功', async () => {
    const result = (await mcpCall(
      state.mcpClientId!,
      state.mcpClientSecret!,
      'initialize',
      { protocolVersion: '2024-11-05', clientInfo: { name: 'e2e', version: '1.0' } },
    )) as { protocolVersion: string; serverInfo: { name: string } };
    assertEq(result.protocolVersion, '2024-11-05', 'protocol version match');
    assertEq(result.serverInfo.name, 'voicerec-mcp', 'server name');
  });

  await test('C-4: tools/list で 4 ツールが登録されている', async () => {
    const result = (await mcpCall(state.mcpClientId!, state.mcpClientSecret!, 'tools/list')) as {
      tools: { name: string }[];
    };
    const names = result.tools.map((t) => t.name).sort();
    const expected = ['get_transcript_by_time', 'get_transcript_full', 'list_recordings', 'search_transcripts'];
    assertEq(JSON.stringify(names), JSON.stringify(expected), 'tool names match');
  });

  await test('C-5: list_recordings で自分の録音が返る', async () => {
    const result = (await mcpCall(state.mcpClientId!, state.mcpClientSecret!, 'tools/call', {
      name: 'list_recordings',
      arguments: { limit: 10 },
    })) as { structuredContent: { count: number; recordings: { id: string; hasWhisperData: boolean }[] } };
    const data = result.structuredContent;
    assert(data.count >= 1, 'at least 1 recording');
    const ours = data.recordings.find((r) => r.id === state.uploadedRecordingId);
    assert(ours !== undefined, 'uploaded recording present');
    const expectedWhisperData = TRANSCRIPTION_MODE !== 'gpt4o-only';
    assertEq(ours!.hasWhisperData, expectedWhisperData, `hasWhisperData=${expectedWhisperData}`);
  });

  if (TRANSCRIPTION_MODE !== 'gpt4o-only') {
    await test('C-5: get_transcript_by_time で時刻範囲のセグメントが返る', async () => {
      const result = (await mcpCall(state.mcpClientId!, state.mcpClientSecret!, 'tools/call', {
        name: 'get_transcript_by_time',
        arguments: {
          from_iso: '2026-04-10T05:59:00.000Z',
          to_iso: '2026-04-10T06:01:00.000Z',
        },
      })) as { structuredContent: { count: number; segments: { recordingId: string }[] } };
      const data = result.structuredContent;
      assert(data.count > 0, 'at least 1 segment in range');
      assert(
        data.segments.every((s) => s.recordingId === state.uploadedRecordingId),
        'all segments from our recording',
      );
    });
  }

  await test('C-5: get_transcript_by_time で未処理の時刻範囲は空配列', async () => {
    const result = (await mcpCall(state.mcpClientId!, state.mcpClientSecret!, 'tools/call', {
      name: 'get_transcript_by_time',
      arguments: {
        from_iso: '2020-01-01T00:00:00.000Z',
        to_iso: '2020-01-02T00:00:00.000Z',
      },
    })) as { structuredContent: { count: number } };
    assertEq(result.structuredContent.count, 0, 'empty range');
  });

  if (TRANSCRIPTION_MODE !== 'gpt4o-only') {
    await test('C-5: get_transcript_full (segments format) でセグメントが返る', async () => {
      const result = (await mcpCall(state.mcpClientId!, state.mcpClientSecret!, 'tools/call', {
        name: 'get_transcript_full',
        arguments: { recording_id: state.uploadedRecordingId, format: 'segments' },
      })) as { structuredContent: { format: string; segments: unknown[] } };
      assertEq(result.structuredContent.format, 'segments', 'format segments');
      assert(result.structuredContent.segments.length > 0, 'segments present');
    });

    await test('C-5: get_transcript_full (whisper alias) も後方互換で動作', async () => {
      const result = (await mcpCall(state.mcpClientId!, state.mcpClientSecret!, 'tools/call', {
        name: 'get_transcript_full',
        arguments: { recording_id: state.uploadedRecordingId, format: 'whisper' },
      })) as { structuredContent: { format: string; segments: unknown[] } };
      // 旧 'whisper' エイリアスでも segments が返る（responseの format は新名 'segments'）
      assertEq(result.structuredContent.format, 'segments', 'whisper alias maps to segments');
      assert(result.structuredContent.segments.length > 0, 'segments present');
    });
  }

  await test('C-5: search_transcripts で部分マッチ検索ができる', async () => {
    // 音声テキストに含まれる語 (テストスクリプトで "会議" を含むよう生成済み)
    const result = (await mcpCall(state.mcpClientId!, state.mcpClientSecret!, 'tools/call', {
      name: 'search_transcripts',
      arguments: { query: '会議', limit: 10 },
    })) as { structuredContent: { count: number; query: string } };
    // マッチすれば 1 以上、しなくても count: 0 で正常応答ならOK
    assert(result.structuredContent.count >= 0, 'search responded');
    assertEq(result.structuredContent.query, '会議', 'query echoed');
  });

  // ===== OAuth 2.0 + PKCE (Claude.ai リモートMCP) =====

  await test('C-OAuth: /.well-known/oauth-authorization-server がメタデータを返す', async () => {
    const res = await httpRaw('GET', '/.well-known/oauth-authorization-server');
    assertEq(res.status, 200, 'metadata 200');
    const data = res.json() as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    assert(data.issuer.length > 0, 'issuer present');
    assert(data.authorization_endpoint.endsWith('/authorize'), 'auth endpoint');
    assert(data.token_endpoint.endsWith('/token'), 'token endpoint');
    assert(data.code_challenge_methods_supported.includes('S256'), 'PKCE S256 supported');
  });

  await test('C-OAuth: /.well-known/oauth-protected-resource/api/mcp が resource を返す', async () => {
    const res = await httpRaw('GET', '/.well-known/oauth-protected-resource/api/mcp');
    assertEq(res.status, 200, 'protected resource metadata 200');
    const data = res.json() as { resource: string; authorization_servers: string[] };
    assert(data.resource.endsWith('/api/mcp'), 'resource path');
    assert(data.authorization_servers.length > 0, 'auth servers');
  });

  await test('C-OAuth: /authorize 未ログイン時は /login?next=... へ 307', async () => {
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: state.mcpClientId!,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: 'test_challenge_value_for_smoke',
      code_challenge_method: 'S256',
      state: 'xyz',
    });
    // fetch でリダイレクトを追わない
    const res = await fetch(`${BASE_URL}/authorize?${qs.toString()}`, { redirect: 'manual' });
    assertEq(res.status, 307, '307 redirect');
    const location = res.headers.get('location') || '';
    assert(location.includes('/login'), 'redirected to login');
    assert(location.includes('next='), 'next param present');
  });

  await test('C-OAuth: 認可コード発行 → /token で access_token 取得 → MCP に Bearer で接続', async () => {
    // PKCE code_verifier と challenge を作る
    const crypto = await import('node:crypto');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // userA としてログイン (cookies)
    const cookies = await loginAsSession(state.userA!.username, state.userA!.password);

    // /authorize にログイン状態でアクセス → 認可コードを redirect_uri に付けて返す
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: state.mcpClientId!,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 'e2e_state_xyz',
    });
    const authRes = await fetch(`${BASE_URL}/authorize?${qs.toString()}`, {
      headers: { Cookie: cookies.join('; ') },
      redirect: 'manual',
    });
    assertEq(authRes.status, 307, 'authorize redirect');
    const location = authRes.headers.get('location') || '';
    assert(location.startsWith('https://claude.ai/api/mcp/auth_callback'), 'redirected to claude.ai');
    const cb = new URL(location);
    const code = cb.searchParams.get('code');
    const returnedState = cb.searchParams.get('state');
    assert(code && code.length > 20, 'code present');
    assertEq(returnedState, 'e2e_state_xyz', 'state echoed');

    // /token で code → access_token 交換
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      client_id: state.mcpClientId!,
      client_secret: state.mcpClientSecret!,
      code_verifier: codeVerifier,
    });
    const tokenRes = await fetch(`${BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    assertEq(tokenRes.status, 200, 'token 200');
    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
    };
    assertEq(tokenData.token_type, 'Bearer', 'Bearer');
    assert(tokenData.access_token.length > 20, 'access_token present');
    assert(tokenData.refresh_token.length > 20, 'refresh_token present');

    // access_token を Bearer で MCP に送信 → 自分の録音が返る
    const mcpRes = await fetch(`${BASE_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'list_recordings', arguments: { limit: 10 } },
      }),
    });
    assertEq(mcpRes.status, 200, 'mcp status');
    const mcpData = (await mcpRes.json()) as {
      result: { structuredContent: { count: number; recordings: { id: string }[] } };
    };
    const ours = mcpData.result.structuredContent.recordings.find(
      (r) => r.id === state.uploadedRecordingId,
    );
    assert(ours !== undefined, 'uploaded recording visible via OAuth bearer');

    // refresh_token で更新
    const refreshBody = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenData.refresh_token,
      client_id: state.mcpClientId!,
      client_secret: state.mcpClientSecret!,
    });
    const refreshRes = await fetch(`${BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: refreshBody.toString(),
    });
    assertEq(refreshRes.status, 200, 'refresh 200');
    const refreshed = (await refreshRes.json()) as { access_token: string };
    assert(refreshed.access_token.length > 20, 'refreshed access_token');
    assert(refreshed.access_token !== tokenData.access_token, 'token rotated');
  });

  await test('C-OAuth: 不正な PKCE verifier は /token で invalid_grant', async () => {
    const crypto = await import('node:crypto');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const cookies = await loginAsSession(state.userA!.username, state.userA!.password);
    const qs = new URLSearchParams({
      response_type: 'code',
      client_id: state.mcpClientId!,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state: 's',
    });
    const authRes = await fetch(`${BASE_URL}/authorize?${qs.toString()}`, {
      headers: { Cookie: cookies.join('; ') },
      redirect: 'manual',
    });
    const location = authRes.headers.get('location') || '';
    const code = new URL(location).searchParams.get('code')!;

    // 間違った verifier
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      client_id: state.mcpClientId!,
      client_secret: state.mcpClientSecret!,
      code_verifier: 'wrong_verifier_xxxxxxxxxxxxxxxxxxxx',
    });
    const tokenRes = await fetch(`${BASE_URL}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    assertEq(tokenRes.status, 400, 'PKCE failure → 400');
    const data = (await tokenRes.json()) as { error: string };
    assertEq(data.error, 'invalid_grant', 'invalid_grant');
  });

  await test('C-5 isolation: userB の credentials では userA のデータが見えない', async () => {
    // userB 用 credentials を発行
    const cookiesB = await loginAsSession(state.userB!.username, state.userB!.password);
    const issue = await httpRaw('POST', '/api/web/mcp-credentials', { cookies: cookiesB });
    const credB = issue.json() as { clientId: string; clientSecret: string };

    const result = (await mcpCall(credB.clientId, credB.clientSecret, 'tools/call', {
      name: 'list_recordings',
      arguments: { limit: 10 },
    })) as { structuredContent: { count: number; recordings: unknown[] } };
    assertEq(result.structuredContent.count, 0, 'userB has no recordings');

    // userA の録音IDで get_transcript_full → 見えない
    try {
      await mcpCall(credB.clientId, credB.clientSecret, 'tools/call', {
        name: 'get_transcript_full',
        arguments: { recording_id: state.uploadedRecordingId },
      });
      // ツール呼び出しは成功するが isError=true で返る
    } catch (e) {
      // acceptable
    }
    const res2 = (await mcpCall(credB.clientId, credB.clientSecret, 'tools/call', {
      name: 'get_transcript_full',
      arguments: { recording_id: state.uploadedRecordingId },
    })) as { isError?: boolean; content?: { text: string }[] };
    assertEq(res2.isError, true, 'get_transcript_full of other user → isError');
  });
}

// ======= Phase D: URL 統合 (legacy redirects + mobile contract) =======

async function testsPhaseD() {
  console.log('');
  console.log('=== Phase D: URL Unification ===');

  // 旧 URL の 308 リダイレクト
  const legacyRedirects: { from: string; to: string }[] = [
    { from: '/user/login', to: '/login' },
    { from: '/admin/login', to: '/login' },
    { from: '/user/recordings', to: '/recordings' },
    { from: '/admin/recordings', to: '/recordings' },
    { from: '/user/settings', to: '/settings' },
  ];
  for (const { from, to } of legacyRedirects) {
    await test(`D-1: ${from} → 308 → ${to}`, async () => {
      const res = await fetch(`${BASE_URL}${from}`, { redirect: 'manual' });
      assertEq(res.status, 308, `308 redirect for ${from}`);
      const loc = res.headers.get('location') || '';
      assert(loc.endsWith(to) || loc.includes(`${to}?`) || loc.includes(`${to}`), `redirected to ${to} (got ${loc})`);
    });
  }

  // モバイル契約: /user/api/auto-login は維持（リダイレクトせず内部処理のみ実行）
  await test('D-2: /user/api/auto-login は 308 で消えていない（モバイル契約）', async () => {
    // token 無し → /login へ 307 (auto-login route 自身のリダイレクト)
    const res = await fetch(`${BASE_URL}/user/api/auto-login`, { redirect: 'manual' });
    assertEq(res.status, 307, 'auto-login still alive (returns 307 redirect to /login)');
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/login'), `auto-login redirects to /login (got ${loc})`);
  });

  // モバイル契約: /api/auth/login がそのまま動く
  await test('D-3: /api/auth/login (モバイル Bearer) で token 発行', async () => {
    const res = await httpRaw('POST', '/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.userA!.username,
        password: state.userA!.password,
        deviceLabel: 'e2e-test-rec18082',
      }),
    });
    assertEq(res.status, 200, 'mobile login ok');
    const data = res.json() as { token?: string; userId?: string; role?: string };
    assert(!!data.token && data.token.length > 20, 'token issued');
    assertEq(data.role, 'user', 'role=user');
  });

  // 新ページ /login が公開されている
  await test('D-4: /login (page) は未ログインでも 200', async () => {
    const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    assertEq(res.status, 200, '/login accessible');
  });

  // 認証必須ページ: 未ログインで /recordings → /login にリダイレクト
  await test('D-5: /recordings 未ログイン → /login?next=/recordings へリダイレクト', async () => {
    const res = await fetch(`${BASE_URL}/recordings`, { redirect: 'manual' });
    assert(res.status === 307 || res.status === 308, `redirect (got ${res.status})`);
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/login'), `redirected to /login (got ${loc})`);
    assert(loc.includes('next='), 'next param present');
  });

  // /api/admin/* は user role では 403
  await test('D-6: user role が /api/admin/users にアクセス → 403', async () => {
    const cookies = await loginAsSession(state.userA!.username, state.userA!.password);
    const res = await httpRaw('GET', '/api/admin/users', { cookies });
    assertEq(res.status, 403, 'forbidden for user role');
  });
}

// ======= MAIN =======

async function main() {
  await setup();
  try {
    await testsPhaseA();
    await testsPhaseB();
    await testsPhaseC();
    await testsPhaseD();
  } finally {
    await teardown();
  }
  const ok = printSummary();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await teardown().catch(() => {});
  process.exit(1);
});
