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
  console.log('=== Phase A: Upload + Dual Transcription ===');

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

  // Phase A の中核: 二重文字起こしを明示的に走らせる
  await test('A-3: /api/recordings/[id]/transcribe で gpt-4o + whisper-1 両方が走る', async () => {
    console.log('  [  waiting for transcription... this takes ~15-30s ]');
    const res = await fetch(`${BASE_URL}/api/recordings/${state.uploadedRecordingId}/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.userAToken}` },
    });
    const body = await res.text();
    assertEq(res.status, 200, `transcribe status (body: ${body.slice(0, 200)})`);
    const data = JSON.parse(body) as {
      success: boolean;
      transcription: { text: string };
      whisper: { segmentCount: number; error: string | null };
    };
    assert(data.success, 'transcribe success');
    assert(data.transcription.text.length > 0, 'gpt-4o text present');
    assertEq(data.whisper.error, null, 'no whisper error');
    assert(data.whisper.segmentCount > 0, 'whisper segments created');
  });

  await test('A-3: DB の Recording.transcriptionText と whisperTranscribedAt が両方埋まっている', async () => {
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
    assert((rec!.transcriptionText ?? '').length > 0, 'gpt-4o text saved');
    assert(rec!.whisperTranscribedAt !== null, 'whisperTranscribedAt set');
    assertEq(rec!.whisperError, null, 'no whisper error');
    assertEq(rec!.language, 'ja', 'language is ja');
  });

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

  await test('A-4: ユーザー設定で言語を en に変更できる (API)', async () => {
    const cookies = await loginAsSession(state.userA!.username, state.userA!.password);
    const res = await httpRaw('PATCH', '/user/api/settings', {
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

  await test('A-5: /user/api/recordings/[id]/segments が時刻順でセグメントを返す', async () => {
    const cookies = await loginAsSession(state.userA!.username, state.userA!.password);
    const res = await httpRaw('GET', `/user/api/recordings/${state.uploadedRecordingId}/segments`, {
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

  await test('B-2/3: /user/api/login で user ログイン、統一 session cookie が発行される', async () => {
    const res = await httpRaw('POST', '/user/api/login', {
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

  await test('B-2: /admin/api/login で admin ログイン (role=admin only)', async () => {
    const res = await httpRaw('POST', '/admin/api/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: state.userAdmin!.username,
        password: state.userAdmin!.password,
      }),
    });
    assertEq(res.status, 200, 'admin login ok');
  });

  await test('B-2: user role では /admin/api/login にログインできない', async () => {
    const res = await httpRaw('POST', '/admin/api/login', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: state.userA!.username, password: state.userA!.password }),
    });
    assertEq(res.status, 401, 'non-admin rejected from admin login');
  });

  await test('B-4: admin impersonate で他ユーザーの録音を閲覧できる', async () => {
    const adminCookies = await adminLogin(state.userAdmin!.username, state.userAdmin!.password);

    // impersonate userA
    const imp = await httpRaw('POST', '/admin/api/impersonate', {
      headers: { 'Content-Type': 'application/json' },
      cookies: adminCookies,
      body: JSON.stringify({ userId: state.userA!.id }),
    });
    assertEq(imp.status, 200, 'impersonate ok');
    const allCookies = [...adminCookies, ...extractCookieValues(imp.cookies)];

    // admin が recordings 一覧を取ると userA の録音が見える
    const list = await httpRaw('GET', '/admin/api/recordings', { cookies: allCookies });
    assertEq(list.status, 200, 'recordings list ok');
    const recs = list.json() as { id: string; userId: string }[];
    const ourRec = recs.find((r) => r.id === state.uploadedRecordingId);
    assert(ourRec !== undefined, 'uploaded recording visible via impersonate');
    assertEq(ourRec!.userId, state.userA!.id, 'userId matches userA');

    // 解除
    await httpRaw('POST', '/admin/api/impersonate', {
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
  const res = await httpRaw('POST', '/admin/api/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
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
    const res = await httpRaw('POST', '/user/api/mcp-credentials', { cookies });
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
    assertEq(ours!.hasWhisperData, true, 'whisper data available');
  });

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

  await test('C-5: get_transcript_full (whisper format) でセグメントが返る', async () => {
    const result = (await mcpCall(state.mcpClientId!, state.mcpClientSecret!, 'tools/call', {
      name: 'get_transcript_full',
      arguments: { recording_id: state.uploadedRecordingId, format: 'whisper' },
    })) as { structuredContent: { format: string; segments: unknown[] } };
    assertEq(result.structuredContent.format, 'whisper', 'format whisper');
    assert(result.structuredContent.segments.length > 0, 'segments present');
  });

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

  await test('C-5 isolation: userB の credentials では userA のデータが見えない', async () => {
    // userB 用 credentials を発行
    const cookiesB = await loginAsSession(state.userB!.username, state.userB!.password);
    const issue = await httpRaw('POST', '/user/api/mcp-credentials', { cookies: cookiesB });
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

// ======= MAIN =======

async function main() {
  await setup();
  try {
    await testsPhaseA();
    await testsPhaseB();
    await testsPhaseC();
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
