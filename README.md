# voicerec-server

## Overview
voicerec-server is a Next.js 14 backend for recording ingestion, dual transcription, and programmatic access via MCP (Model Context Protocol). It is the companion server to [voicerec](https://github.com/daishir0/voicerec), an Expo-based mobile recording app, and also exposes a Claude.ai-compatible MCP endpoint so that recorded audio can be queried in natural language from Claude.ai.

Key features:
- Mobile upload API with **Bearer token** authentication (Basic Auth has been removed)
- **Dual transcription pipeline**: gpt-4o-transcribe for high-quality full text + whisper-1 (verbose_json) for sentence-level segments with absolute wall-clock timestamps
- **MCP server** for Claude.ai remote connectors with **OAuth 2.0 + PKCE** authorization code flow
- Per-user transcription language setting (ja / en / zh / ko / es / fr / de / it / pt / ru)
- Ontology-based domain-specific text correction (Layer 1 / Layer 2)
- Unified User model with `role` column (user / admin) backed by a single HMAC-signed `session` cookie
- Admin impersonation for viewing another user's data
- PostgreSQL database via Prisma ORM
- File storage organized by username with timestamp-based filenames
- E2E test suite (`npm run test:e2e`) covering upload / transcription / auth / OAuth / MCP (35 cases)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/daishir0/voicerec-server.git
cd voicerec-server
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env (see "Environment Variables" below)
```

4. Initialize the database:
```bash
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
```

5. Start the server:
```bash
npm run dev          # dev (port 18083)
# or
npm run build && npm run start   # production
```

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SESSION_SECRET` | ✅ | HMAC key for signing session cookies (`openssl rand -hex 32`) |
| `OPENAI_API_KEY` | ✅ | Used by both gpt-4o-transcribe and whisper-1 |
| `OAUTH_ISSUER` | ✅ (for MCP) | Public base URL (e.g. `https://voicerec-server.example.com`) |
| `MCP_BASE_URL` | Optional | Displayed on the user settings screen (defaults to `${OAUTH_ISSUER}/api/mcp`) |
| `OAUTH_ALLOWED_REDIRECT_URIS` | Optional | Comma-separated allow-list for additional OAuth `redirect_uri` prefixes (Claude.ai's default is always allowed) |
| `SEED_USER_PASSWORD` | Optional | Password for seeded test users |
| `SEED_ADMIN_PASSWORD` | Optional | Password for seeded admin user |

## Authentication

Three access paths, each with its own authentication scheme — **Basic Auth has been completely removed**.

| Access Point | Method | Details |
|---|---|---|
| Mobile app / external API (`/api/*`) | **Bearer token** | `Authorization: Bearer <token>` where token is issued by `POST /api/auth/login` (stored as SHA-256 hash in `MobileToken` table) |
| Web portal (`/user/*`, `/admin/*`) | **Cookie session** | Unified `session` cookie, HMAC-SHA256 signed, 24h expiry, `role=user` or `role=admin` |
| Claude.ai MCP (`/api/mcp`) | **OAuth 2.0 + PKCE** (Bearer) or Basic (Client ID / Secret for curl testing) | Full authorization code flow with SHA-256 PKCE S256 |

Admin access is determined by `User.role === 'admin'` — the previous separate `AdminUser` table has been merged into `User`. A single unified `/user/login` or `/admin/login` page produces the same `session` cookie with role embedded.

## Mobile Upload API

All endpoints below require `Authorization: Bearer <token>`.

### Getting a token (initial login)
```http
POST /api/auth/login
Content-Type: application/json

{"username": "test1", "password": "...", "deviceLabel": "iPhone"}
```
Returns `{token, userId, username, role}`. The plaintext token is returned **once only** — the app should save it in `SecureStore` / `AsyncStorage` and use it for subsequent requests. The server stores only the SHA-256 hash.

### Recording endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/test` | Verify token (returns 200 if valid) |
| POST | `/api/recordings/upload` | Upload a recording (multipart/form-data) |
| GET | `/api/recordings` | List the authenticated user's recordings |
| DELETE | `/api/recordings/[id]` | Delete a recording |
| POST | `/api/recordings/[id]/transcribe` | Run the dual transcription pipeline |
| GET | `/api/recordings/[id]/transcription` | Get gpt-4o transcription result |
| POST | `/api/recordings/[id]/correct/layer1` | Run Layer 1 correction |
| POST | `/api/recordings/[id]/correct/layer2` | Run Layer 2 correction |
| POST | `/api/recordings/[id]/feedback` | Submit feedback |
| POST | `/api/recordings/[id]/ground-truth` | Register ground truth |
| POST | `/api/recordings/[id]/experiment` | Run evaluation experiment |
| GET/POST | `/api/ontology/domains`, `/entities`, `/relations`, `/snapshots` | Ontology CRUD |
| GET/POST | `/api/evaluation/*` | Evaluation results |

### Upload parameters (multipart/form-data)
- `file` (required) — the audio file
- `originalName` — original filename in `yyyymmdd-hhmmss.ext` format (used to parse `recordedAt` in JST)
- `displayName` — display name
- `duration` — duration in milliseconds (auto-converted to seconds)

On successful upload, the server:
1. Stores the file under `./data/<username>/<filename>`
2. Parses `recordedAt` from the filename (JST)
3. **Fires the dual transcription pipeline asynchronously**

## Dual Transcription Pipeline

Every recording goes through **two transcription passes** and the results are stored in **two different places**:

### Pass 1 — gpt-4o-transcribe (high-quality full text)
- Model: `gpt-4o-transcribe`
- Output: a single combined text string per recording (no per-utterance timestamps; gpt-4o doesn't return them)
- Saved to `Recording.transcriptionText` (plain string) and `Recording.transcriptionSegments` (JSON, chunk-level pseudo segments)

### Pass 2 — whisper-1 (sentence-level segments with absolute timestamps)
- Model: `whisper-1`
- Response format: `verbose_json` (returns per-segment start/end offsets)
- Runs **after** gpt-4o completes, in an isolated try/catch — if whisper-1 fails, gpt-4o's result is preserved and `Recording.whisperError` is populated
- Each returned segment is stored as a row in the `Segment` table with:
  - `startOffset` / `endOffset` — seconds from the start of the recording
  - `startAt` / `endAt` — **absolute wall-clock timestamps** computed as `recordedAt + offset`
  - `userId` (denormalized for indexed time-range queries across recordings)

The `Recording.whisperTranscribedAt` field is set to the completion timestamp (null if not yet processed).

### Language selection
- The uploader's `User.transcriptionLanguage` field determines the language passed to both OpenAI calls (default: `ja`)
- Users can change their own language at `/user/settings`
- Admins can change any user's language from `/admin/users`

## MCP Server (Claude.ai Remote Connector)

voicerec-server exposes a Model Context Protocol endpoint so that Claude.ai can query recordings in natural language.

### Transport
JSON-RPC 2.0 over HTTP POST at `/api/mcp` (compatible with Claude.ai's Custom Connector feature).

### OAuth 2.0 + PKCE Flow
1. Claude.ai discovers OAuth metadata at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/api/mcp`
2. The user's browser is redirected to `/authorize` (requires session cookie; redirects to `/user/login?next=...` if not logged in)
3. After login as the client's owner, an authorization code is issued and the browser is redirected back to `https://claude.ai/api/mcp/auth_callback` with `code` + `state`
4. Claude.ai exchanges the code at `POST /token` with PKCE `code_verifier` (SHA-256 S256), `client_id`, `client_secret` → receives `access_token` (1h) + `refresh_token` (30d)
5. Claude.ai sends `Authorization: Bearer <access_token>` to `POST /api/mcp`

All tokens and auth codes are stored as SHA-256 hashes only — plaintext values are never persisted.

### Issuing MCP credentials
Users go to `/user/settings`, click "発行" (issue), and receive a one-time display of:
1. **Remote MCP server URL**
2. **OAuth Client ID**
3. **OAuth Client Secret** (shown once, never again)

These are then pasted into Claude.ai's Custom Connector setup dialog.

### MCP Tools
All tools are scoped to the authenticated user — no cross-user data exposure.

| Tool | Purpose |
|---|---|
| `list_recordings` | List recordings in a date range (with `hasWhisperData` flag) |
| `get_transcript_by_time` | Return whisper segments spanning an absolute time range (e.g. "yesterday 15:50–15:55"), crossing multiple recordings |
| `get_transcript_full` | Return full transcription for a specific recording (`format=gpt4o` default, or `format=whisper` for timestamped segments) |
| `search_transcripts` | Keyword search across whisper segments |

Time-based queries only match recordings where `whisperTranscribedAt IS NOT NULL`. Unprocessed recordings are invisible to time-range queries (returns empty arrays).

## Web Portals

### User Portal (`/user/*`)

| Page | Description |
|---|---|
| `/user/login` | Login (supports `?next=` and `?hint=` parameters for OAuth redirects) |
| `/user/recordings` | Own recordings — playback, GPT-4o transcription, whisper segments viewer |
| `/user/settings` | Transcription language + MCP credential issuance / revocation |

### Admin Panel (`/admin/*`)

| Page | Description |
|---|---|
| `/admin/login` | Admin login (rejects non-admin users) |
| `/admin/users` | Manage app users, edit per-user transcription language |
| `/admin/recordings` | View all recordings, impersonation-aware, whisper segments viewer |
| `/admin/admins` | Manage other admin users |
| `/admin/minutes` | Meeting minutes |
| `/admin/ontology` | Ontology CRUD — domains, entities, relations, snapshots, export |
| `/admin/evaluation` | CER / DKDP evaluation results |

### Impersonation
Admins can call `POST /admin/api/impersonate` with `{userId}` to set an `impersonated_user_id` cookie. While set, admin-side recording listings are filtered to the impersonated user's data. Pass `{userId: null}` to clear.

## Data Models

### Core
- **User** — unified user table with `role` (user/admin), `transcriptionLanguage`, and optional MCP client credentials (`mcpClientId`, `mcpClientSecretHash`). Replaces the legacy separate AdminUser table.
- **Recording** — audio metadata + gpt-4o transcription + `recordedAt` (absolute start time) + `whisperTranscribedAt` (null = whisper-1 not yet run) + `whisperError`.
- **Segment** — 1 row per whisper-1 utterance segment with absolute `startAt`/`endAt` timestamps. Indexed by `(userId, startAt)` and `(userId, endAt)` for efficient time-range queries across recordings.
- **MobileToken** — Bearer tokens for the mobile app / external API. Hashed with SHA-256.
- **OAuthAuthCode** — short-lived (5 min) authorization codes for the OAuth flow. SHA-256 hashed, single-use (`consumedAt`).
- **OAuthAccessToken** — OAuth access tokens (1h) and refresh tokens (30d), both SHA-256 hashed.

### Ontology / Correction
- **Domain**, **OntologyEntity**, **OntologyRelation**, **OntologySnapshot**
- **CorrectionResult**, **GroundTruth**, **Feedback**, **EvaluationResult**

## File Storage

Uploaded recordings are saved to `./data/<username>/` with filenames in `yyyymmdd-hhmmss.ext` format. Duplicates get a numeric suffix (e.g. `20260414-143022_1.m4a`).

## E2E Tests

```bash
npm run test:e2e
```

Runs 35 test cases covering the full upload → dual transcription → auth → OAuth → MCP pipeline against the live server and database (creates and cleans up test users prefixed with `e2e_`). One 11-second Japanese audio fixture (auto-generated via OpenAI TTS into `tests/fixtures/audio/`, gitignored) is used for all cases to minimize OpenAI API cost (~$0.02 per run).

## Default Seed Data

- **3 test users**: test1, test2, test3 (password from `SEED_USER_PASSWORD`)
- **1 admin user**: admin (`role=admin`, password from `SEED_ADMIN_PASSWORD`)
- **4 domains**: A (multi-client maintenance), B (specific client development), C (HQ leader), D (university systems)
- **Domain entities and relations** with phonetic hints and co-occurrence weights
- **Week 0 ontology snapshots** per domain

## Notes

- `SESSION_SECRET` and `OAUTH_ISSUER` must be set for OAuth to work correctly
- Basic Auth has been **completely removed** from `/api/*` — old mobile app builds that use Basic Auth will receive 401
- `whisper-1` is significantly more tolerant of low-bitrate audio than gpt-4o's transcribe model; however, the mobile app's default preset (12kHz / 16kbps) can still trigger whisper-1 hallucinations on very quiet audio. Use the "high quality" recording mode (16kHz / 32kbps) in the mobile app's settings for improved results.
- Transcription cost: ~$0.006/min for gpt-4o-transcribe + ~$0.006/min for whisper-1 (runs in parallel in spirit but sequentially in code). Total approximately $0.012/min of audio.
- For production, change default passwords immediately after first setup.

## License
MIT — see the LICENSE file.

---

# voicerec-server

## 概要
voicerec-server は Next.js 14 製のバックエンドサーバーで、録音アップロード受信、二重文字起こし、および MCP (Model Context Protocol) によるプログラマブルアクセスを提供します。Expo 製モバイル録音アプリ [voicerec](https://github.com/daishir0/voicerec) のコンパニオンサーバーであり、さらに Claude.ai 互換の MCP エンドポイントを公開することで、録音データを自然言語で問い合わせることができます。

主な機能:
- モバイルアップロード API は **Bearer トークン認証** (Basic 認証は完全削除)
- **二重文字起こしパイプライン**: gpt-4o-transcribe で高品質な全文、whisper-1 (`verbose_json`) で絶対時刻付きの発話単位セグメント
- **MCP サーバー**: Claude.ai リモートコネクタ向けに **OAuth 2.0 + PKCE** 認可コードフロー実装
- ユーザー単位の文字起こし言語設定 (ja / en / zh / ko / es / fr / de / it / pt / ru)
- オントロジーベースのドメイン特化補正 (Layer 1 / Layer 2)
- `role` カラムで統合された User モデルと HMAC 署名付き `session` Cookie
- 管理者による他ユーザーデータ閲覧 (impersonation)
- Prisma ORM + PostgreSQL
- ユーザー名別のファイルストレージとタイムスタンプベースのファイル名
- E2E テストスイート (`npm run test:e2e`) — アップロード/文字起こし/認証/OAuth/MCP の 35 ケース

## インストール方法

1. リポジトリをクローン:
```bash
git clone https://github.com/daishir0/voicerec-server.git
cd voicerec-server
```

2. 依存関係をインストール:
```bash
npm install
```

3. 環境変数を設定:
```bash
cp .env.example .env
# .env を編集 (下記「環境変数」を参照)
```

4. データベースを初期化:
```bash
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
```

5. サーバーを起動:
```bash
npm run dev          # 開発モード (port 18083)
# または
npm run build && npm run start   # 本番モード
```

## 環境変数

| 変数名 | 必須 | 用途 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 接続文字列 |
| `SESSION_SECRET` | ✅ | Cookie 署名用の HMAC キー (`openssl rand -hex 32`) |
| `OPENAI_API_KEY` | ✅ | gpt-4o-transcribe と whisper-1 の両方で使用 |
| `OAUTH_ISSUER` | ✅ (MCP 使用時) | 公開ベース URL (例: `https://voicerec-server.example.com`) |
| `MCP_BASE_URL` | 任意 | ユーザー設定画面に表示するURL (未設定時は `${OAUTH_ISSUER}/api/mcp`) |
| `OAUTH_ALLOWED_REDIRECT_URIS` | 任意 | カンマ区切りで追加の OAuth `redirect_uri` プレフィックスを許可 (Claude.ai の既定は常に許可) |
| `SEED_USER_PASSWORD` | 任意 | Seed テストユーザーのパスワード |
| `SEED_ADMIN_PASSWORD` | 任意 | Seed 管理者のパスワード |

## 認証方式

3 つのアクセスパスごとに認証方式が分かれています。**Basic 認証は完全に削除済みです。**

| アクセスポイント | 方式 | 詳細 |
|---|---|---|
| モバイルアプリ / 外部 API (`/api/*`) | **Bearer トークン** | `Authorization: Bearer <token>` 。トークンは `POST /api/auth/login` で発行され、DB には SHA-256 ハッシュのみ保存 |
| Web ポータル (`/user/*`, `/admin/*`) | **Cookie セッション** | 統一 `session` Cookie、HMAC-SHA256 署名、24時間有効、`role=user` or `role=admin` |
| Claude.ai MCP (`/api/mcp`) | **OAuth 2.0 + PKCE** (Bearer) または Basic (curl テスト互換) | PKCE S256 認可コードフロー |

管理者権限は `User.role === 'admin'` で判定されます。旧 `AdminUser` テーブルは `User` に統合され、ログイン画面は `/user/login` または `/admin/login` から同じ `session` Cookie を発行します。

## モバイルアップロード API

以下のエンドポイントはすべて `Authorization: Bearer <token>` が必須です。

### 初回ログイン (トークン取得)
```http
POST /api/auth/login
Content-Type: application/json

{"username": "test1", "password": "...", "deviceLabel": "iPhone"}
```
`{token, userId, username, role}` を返します。平文トークンは **1回だけ** 返却され、アプリ側で `SecureStore` / `AsyncStorage` に保存してください。サーバーには SHA-256 ハッシュのみ保存されます。

### 録音系エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/auth/test` | トークン検証 (成功時 200) |
| POST | `/api/recordings/upload` | 録音アップロード (multipart/form-data) |
| GET | `/api/recordings` | 認証ユーザーの録音一覧 |
| DELETE | `/api/recordings/[id]` | 録音削除 |
| POST | `/api/recordings/[id]/transcribe` | 二重文字起こし実行 |
| GET | `/api/recordings/[id]/transcription` | gpt-4o 結果取得 |
| POST | `/api/recordings/[id]/correct/layer1` | Layer 1 補正 |
| POST | `/api/recordings/[id]/correct/layer2` | Layer 2 補正 |
| POST | `/api/recordings/[id]/feedback` | フィードバック送信 |
| POST | `/api/recordings/[id]/ground-truth` | 教師データ登録 |
| POST | `/api/recordings/[id]/experiment` | 評価実験実行 |
| GET/POST | `/api/ontology/domains`, `/entities`, `/relations`, `/snapshots` | オントロジーCRUD |
| GET/POST | `/api/evaluation/*` | 評価結果 |

### アップロードパラメータ (multipart/form-data)
- `file` (必須) — 音声ファイル
- `originalName` — `yyyymmdd-hhmmss.ext` 形式の元ファイル名 (`recordedAt` を JST でパース)
- `displayName` — 表示名
- `duration` — 録音時間 (ミリ秒、サーバーで秒に自動変換)

アップロード成功時、サーバーは:
1. ファイルを `./data/<username>/<filename>` に保存
2. ファイル名から `recordedAt` を JST 解釈でパース
3. **二重文字起こしパイプラインを非同期実行**

## 二重文字起こしパイプライン

すべての録音は **2 つの文字起こしパス** を通過し、結果は **2 つの異なる場所** に保存されます。

### パス1 — gpt-4o-transcribe (高品質な全文)
- モデル: `gpt-4o-transcribe`
- 出力: 録音単位で1つの結合済みテキスト文字列 (gpt-4o は発話単位のタイムスタンプを返さない)
- 保存先: `Recording.transcriptionText` (平文) と `Recording.transcriptionSegments` (JSON、チャンク単位の擬似セグメント)

### パス2 — whisper-1 (絶対時刻付き発話単位セグメント)
- モデル: `whisper-1`
- レスポンス形式: `verbose_json` (セグメントごとの start/end オフセットあり)
- gpt-4o 完了後に **隔離された try/catch 内で実行**。失敗しても gpt-4o の結果は壊さず、`Recording.whisperError` に記録
- 各セグメントは `Segment` テーブルの1行として保存:
  - `startOffset` / `endOffset` — 録音先頭からの秒数
  - `startAt` / `endAt` — **絶対時刻** (`recordedAt + offset` で計算)
  - `userId` (複数録音をまたぐ時刻範囲クエリを高速化するため非正規化)

`Recording.whisperTranscribedAt` が完了時刻に設定されます (未処理時は null)。

### 言語選択
- アップロード時、uploader の `User.transcriptionLanguage` を両方の OpenAI 呼び出しに渡します (デフォルト `ja`)
- ユーザーは `/user/settings` で自分の言語を変更可能
- 管理者は `/admin/users` で任意ユーザーの言語を変更可能

## MCP サーバー (Claude.ai リモートコネクタ)

voicerec-server は Model Context Protocol エンドポイントを公開し、Claude.ai から自然言語で録音データを検索できるようにします。

### トランスポート
`/api/mcp` で JSON-RPC 2.0 over HTTP POST (Claude.ai の Custom Connector 機能互換)。

### OAuth 2.0 + PKCE フロー
1. Claude.ai が `/.well-known/oauth-authorization-server` と `/.well-known/oauth-protected-resource/api/mcp` でメタデータを取得
2. ユーザーのブラウザが `/authorize` にリダイレクトされる (session Cookie 必須。未ログインなら `/user/login?next=...`)
3. Client 所有者としてログインすると認可コードが発行され、`https://claude.ai/api/mcp/auth_callback?code=...&state=...` にリダイレクト
4. Claude.ai が `POST /token` で PKCE `code_verifier` (SHA-256 S256)、`client_id`、`client_secret` を付けてコードを交換し、`access_token` (1時間) と `refresh_token` (30日) を取得
5. Claude.ai が `Authorization: Bearer <access_token>` で `POST /api/mcp` を呼び出す

トークンと認可コードはすべて SHA-256 ハッシュでのみ保存され、平文は永続化されません。

### MCP クレデンシャル発行
ユーザーが `/user/settings` で「発行」ボタンを押すと、**1回限り** 以下の3つが表示されます:
1. **Remote MCP server URL**
2. **OAuth Client ID**
3. **OAuth Client Secret** (このときのみ表示、以降は取得不可)

これらを Claude.ai の Custom Connector 設定ダイアログに貼り付けます。

### MCP ツール
すべてのツールは認証ユーザー ID でスコープされ、他ユーザーのデータは一切返しません。

| ツール | 用途 |
|---|---|
| `list_recordings` | 期間内の録音一覧 (`hasWhisperData` フラグ付き) |
| `get_transcript_by_time` | 絶対時刻範囲にかかる whisper セグメントを時系列順に返す (例:「昨日 15:50〜15:55 の発言」)、複数録音を横断 |
| `get_transcript_full` | 特定録音の全文 (`format=gpt4o` デフォルト、`format=whisper` で時刻付きセグメント) |
| `search_transcripts` | whisper セグメントの全文キーワード検索 |

時刻ベースクエリは `whisperTranscribedAt IS NOT NULL` の録音のみヒットします。未処理録音は空配列で返ります。

## Web ポータル

### ユーザーポータル (`/user/*`)

| ページ | 説明 |
|---|---|
| `/user/login` | ログイン (`?next=` と `?hint=` パラメータを OAuth リダイレクト用にサポート) |
| `/user/recordings` | 自分の録音一覧 — 再生、GPT-4o 文字起こし、whisper セグメントビュー |
| `/user/settings` | 文字起こし言語 + MCP クレデンシャル発行/失効 |

### 管理パネル (`/admin/*`)

| ページ | 説明 |
|---|---|
| `/admin/login` | 管理者ログイン (非 admin ロールは拒否) |
| `/admin/users` | アプリユーザー管理、ユーザー別の文字起こし言語編集 |
| `/admin/recordings` | 全録音表示 (impersonation 対応)、whisper セグメントビュー |
| `/admin/admins` | 管理者ユーザー管理 |
| `/admin/minutes` | 議事録 |
| `/admin/ontology` | オントロジー CRUD (ドメイン、エンティティ、関係、スナップショット、エクスポート) |
| `/admin/evaluation` | CER / DKDP 評価結果 |

### Impersonation (管理者の他ユーザーデータ閲覧)
管理者は `POST /admin/api/impersonate` に `{userId}` を送ると `impersonated_user_id` Cookie がセットされ、以降の `/admin/recordings` などは指定ユーザーのデータだけに絞られます。`{userId: null}` で解除。

## データモデル

### コア
- **User** — 統合ユーザーテーブル。`role` (user/admin)、`transcriptionLanguage`、オプショナルな MCP クライアントクレデンシャル (`mcpClientId` / `mcpClientSecretHash`)。旧 `AdminUser` テーブルは統合済み。
- **Recording** — 音声メタデータ + gpt-4o 文字起こし + `recordedAt` (絶対開始時刻) + `whisperTranscribedAt` (null = whisper-1 未処理) + `whisperError`
- **Segment** — whisper-1 発話単位のセグメント1行ずつ。`startAt`/`endAt` は絶対時刻。`(userId, startAt)` と `(userId, endAt)` にインデックス付き
- **MobileToken** — モバイル/外部 API 用 Bearer トークン (SHA-256 ハッシュ)
- **OAuthAuthCode** — OAuth 認可コード (5分 TTL)、SHA-256 ハッシュ、`consumedAt` で1回限り使用を強制
- **OAuthAccessToken** — OAuth アクセストークン (1時間) と リフレッシュトークン (30日)、両方とも SHA-256 ハッシュ

### オントロジー / 補正
- **Domain**, **OntologyEntity**, **OntologyRelation**, **OntologySnapshot**
- **CorrectionResult**, **GroundTruth**, **Feedback**, **EvaluationResult**

## ファイルストレージ

アップロードされた録音は `./data/<username>/` に `yyyymmdd-hhmmss.ext` 形式で保存されます。同名ファイルは連番付与 (例: `20260414-143022_1.m4a`)。

## E2E テスト

```bash
npm run test:e2e
```

アップロード → 二重文字起こし → 認証 → OAuth → MCP の全パイプラインを実サーバー/実 DB に対して実行する 35 ケース (プレフィックス `e2e_` のテストユーザーを実行ごとに作成/クリーンアップ)。OpenAI API コスト最小化のため 1 本の 11 秒日本語音声フィクスチャ (OpenAI TTS で自動生成、`tests/fixtures/audio/` 配下・gitignore) で全ケースを回します。1 回あたり約 $0.02。

## デフォルト Seed データ

- **テストユーザー3名**: test1, test2, test3 (`SEED_USER_PASSWORD`)
- **管理者1名**: admin (`role=admin`, `SEED_ADMIN_PASSWORD`)
- **ドメイン4つ**: A (複数顧客保守), B (特定顧客開発), C (本部リーダー), D (大学システム)
- **ドメイン別エンティティ・関係** (音韻ヒント・共起度付き)
- **各ドメインの Week 0 スナップショット**

## 注意点

- `SESSION_SECRET` と `OAUTH_ISSUER` は OAuth を動かすために必須
- Basic 認証は `/api/*` から **完全削除済み**。古いアプリ (Basic 認証版) からのリクエストは全て 401 になります
- `whisper-1` は低ビットレート音声への耐性が比較的高いですが、モバイルアプリのデフォルトプリセット (12kHz/16kbps) では静かな音声で whisper-1 がハルシネーションを起こすことがあります。モバイル側の設定で「高品質録音」モード (16kHz/32kbps) に切り替えると改善します
- 文字起こしコスト: gpt-4o-transcribe ~$0.006/分 + whisper-1 ~$0.006/分 = 合計 約 $0.012/音声分
- 本番環境では、初期セットアップ後に直ちにすべてのデフォルトパスワードを変更してください

## ライセンス
MIT — LICENSE ファイルを参照してください。
