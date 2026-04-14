# voicerec-server

## Overview
voicerec-server is a Next.js server for receiving, storing, and managing voice recordings uploaded from mobile devices. It serves as the backend companion for [voicerec](https://github.com/daishir0/voicerec), an Expo-based mobile recording app.

Key features:
- REST API for recording upload, listing, and deletion with Basic Auth
- Automatic speech-to-text transcription via OpenAI Whisper API
- Ontology-based domain-specific text correction (Layer 1 / Layer 2)
- User portal with session-based login for viewing own recordings and transcriptions
- Admin panel with full management capabilities (users, recordings, ontology, evaluation)
- HMAC-signed cookie session authentication for both user and admin portals
- PostgreSQL database via Prisma ORM
- File storage organized by username with timestamp-based filenames

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
# Edit .env:
#   DATABASE_URL       - PostgreSQL connection string (e.g., postgresql://user:password@localhost:5432/voicerec)
#   SESSION_SECRET     - generate with: openssl rand -hex 32
#   SEED_USER_PASSWORD - password for test users (test1, test2, test3)
#   SEED_ADMIN_PASSWORD - password for admin user
#   OPENAI_API_KEY     - OpenAI API key for Whisper transcription
```

4. Initialize the database:
```bash
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
```

5. Start the server:
```bash
npm run dev -- --port 18083
```

## Authentication

This server uses three separate authentication methods depending on the access point:

| Access Point | Method | Details |
|---|---|---|
| Mobile App API (`/api/*`) | HTTP Basic Auth | `Authorization: Basic base64(username:password)` per request |
| User Portal (`/user/*`) | Cookie Session | HMAC-SHA256 signed cookie, 24h expiry |
| Admin Panel (`/admin/*`) | Cookie Session | HMAC-SHA256 signed cookie, 24h expiry |

User and admin sessions are independent — logging in as a user does not grant admin access, and vice versa.

## Usage

### Mobile App API

All endpoints require Basic Auth.

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/test` | Test connection and verify credentials |
| POST | `/api/recordings/upload` | Upload a recording (multipart/form-data) |
| GET | `/api/recordings` | List the authenticated user's recordings |
| DELETE | `/api/recordings/[id]` | Delete a recording |
| POST | `/api/recordings/[id]/transcribe` | Start Whisper transcription |
| GET | `/api/recordings/[id]/transcription` | Get transcription result |
| POST | `/api/recordings/[id]/correct/layer1` | Run Layer 1 correction |
| POST | `/api/recordings/[id]/correct/layer2` | Run Layer 2 correction |
| POST | `/api/recordings/[id]/feedback` | Submit feedback |
| POST | `/api/recordings/[id]/ground-truth` | Register ground truth |
| POST | `/api/recordings/[id]/experiment` | Run experiment |
| GET | `/api/ontology/domains` | List domains |
| POST | `/api/ontology/domains` | Create domain |
| GET | `/api/ontology/domains/[id]/entities` | List entities (searchable) |
| POST | `/api/ontology/domains/[id]/entities` | Create entity |
| POST | `/api/ontology/domains/[id]/evolve` | Run ontology evolution |
| GET | `/api/ontology/domains/[id]/snapshots` | List snapshots |
| GET/POST | `/api/ontology/relations` | Manage relations |
| GET | `/api/evaluation/[recordingId]` | Get evaluation results |
| POST | `/api/evaluation/[recordingId]` | Calculate evaluation |

#### Upload Parameters (form-data)
- `file` (required): The audio file
- `originalName`: Original filename (used to extract timestamp)
- `displayName`: Display name for the recording
- `duration`: Recording duration in milliseconds (auto-converted to seconds)

Uploaded recordings are automatically transcribed via Whisper API after upload.

### User Portal

Access at `/user/login`. General users can log in to view their own data only.

| Page | Description |
|---|---|
| `/user/login` | User login page |
| `/user/recordings` | View own recordings — playback, transcription results |

**User permissions:**
- View and play own recordings
- View own transcription results
- Cannot delete recordings
- Cannot view other users' data
- Cannot access admin functions (user management, ontology, evaluation, etc.)

### Admin Panel

Access at `/admin/login`. Administrators have full access to all features.

| Page | Description |
|---|---|
| `/admin/login` | Admin login page |
| `/admin/users` | Manage app users — create, edit, delete |
| `/admin/recordings` | View all recordings — user filter, playback, delete, transcribe |
| `/admin/admins` | Manage admin users — create, edit, delete |
| `/admin/minutes` | Meeting minutes — list and detail view |
| `/admin/ontology` | Ontology management — domains, entities, relations, snapshots, export |
| `/admin/evaluation` | Evaluation results — CER metrics, DKDP ratio analysis |

**Admin permissions:**
- All user permissions, plus:
- View and manage all users' recordings
- Delete recordings
- Create, edit, and delete users and admin users
- Manage ontology (domains, entities, relations, evolution)
- View evaluation results
- Trigger transcription and corrections

### Permission Comparison

| Feature | General User | Admin |
|---|---|---|
| View own recordings | o | o |
| Play own recordings | o | o |
| View own transcriptions | o | o |
| Delete recordings | x | o |
| View other users' recordings | x | o |
| User management | x | o |
| Admin management | x | o |
| Ontology management | x | o |
| Evaluation results | x | o |
| Meeting minutes | x | o |

## Data Models

### Core Models
- **User** — App users (Basic Auth + User Portal login)
- **AdminUser** — Admin panel users with role field
- **Recording** — Audio files with metadata, transcription status, and results
- **Domain** — Discourse domains (e.g., multi-client maintenance, university systems)
- **OntologyEntity** — Domain-specific terms with labels, phonetic hints, definitions
- **OntologyRelation** — Relationships between entities (isUsedIn, controls, relatedTo, etc.)
- **OntologySnapshot** — Weekly snapshots of ontology state
- **CorrectionResult** — Layer 1/2 correction outputs per recording/domain/condition
- **GroundTruth** — Annotator reference data for evaluation
- **Feedback** — User feedback on transcription quality
- **EvaluationResult** — CER, DKDP metrics per recording/domain/condition

## File Storage

Uploaded recordings are saved to `./data/<username>/` with filenames in `yyyymmdd-hhmmss.ext` format based on the recording start time. If a filename already exists, a numeric suffix is appended (e.g., `20260303-143022_1.m4a`).

## Default Seed Data

The seed script creates:
- **3 test users**: test1, test2, test3 (password from `SEED_USER_PASSWORD`)
- **1 admin user**: admin (password from `SEED_ADMIN_PASSWORD`)
- **4 domains**: A (multi-client maintenance), B (specific client development), C (HQ leader), D (university systems)
- **Domain-specific entities and relations** with phonetic hints and co-occurrence weights
- **Week 0 snapshots** for each domain

## Notes
- `SESSION_SECRET` must be set in `.env` — the server will refuse to start without it
- `OPENAI_API_KEY` is required for Whisper transcription functionality
- Seed passwords default to `changeme` if environment variables are not set
- For production, change all default passwords immediately after first setup
- Duration values sent from the mobile app in milliseconds are automatically converted to seconds on upload
- Audio files are served with proper MIME types for in-browser playback

## License
This project is licensed under the MIT License - see the LICENSE file for details.

---

# voicerec-server

## 概要
voicerec-serverは、モバイルデバイスからアップロードされた音声録音を受信・保存・管理するNext.jsサーバーです。Expoベースのモバイル録音アプリ[voicerec](https://github.com/daishir0/voicerec)のバックエンドコンパニオンとして機能します。

主な機能:
- Basic Auth付きの録音アップロード・一覧・削除用REST API
- OpenAI Whisper APIによる自動文字起こし
- オントロジーベースのドメイン特化テキスト補正（Layer 1 / Layer 2）
- セッションベースのユーザーポータル（自分の録音・文字起こし閲覧）
- 全管理機能を持つ管理パネル（ユーザー・録音・オントロジー・評価）
- HMAC署名Cookie Session認証（ユーザー・管理者それぞれ独立）
- Prisma ORMによるPostgreSQLデータベース
- ユーザー名別のファイルストレージとタイムスタンプベースのファイル名

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
# .envを編集:
#   DATABASE_URL       - PostgreSQL接続文字列（例: postgresql://user:password@localhost:5432/voicerec）
#   SESSION_SECRET     - 生成方法: openssl rand -hex 32
#   SEED_USER_PASSWORD - テストユーザー（test1, test2, test3）のパスワード
#   SEED_ADMIN_PASSWORD - 管理者ユーザーのパスワード
#   OPENAI_API_KEY     - Whisper文字起こし用OpenAI APIキー
```

4. データベースを初期化:
```bash
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts
```

5. サーバーを起動:
```bash
npm run dev -- --port 18083
```

## 認証方式

アクセスポイントに応じて3つの認証方式を使い分けます:

| アクセスポイント | 方式 | 詳細 |
|---|---|---|
| モバイルアプリAPI (`/api/*`) | HTTP Basic Auth | リクエスト毎に `Authorization: Basic base64(ユーザー名:パスワード)` |
| ユーザーポータル (`/user/*`) | Cookie Session | HMAC-SHA256署名Cookie、24時間有効 |
| 管理パネル (`/admin/*`) | Cookie Session | HMAC-SHA256署名Cookie、24時間有効 |

ユーザーセッションと管理者セッションは独立しています。ユーザーとしてログインしても管理者権限は付与されず、その逆も同様です。

## 使い方

### モバイルアプリAPI

すべてのエンドポイントにBasic Auth認証が必要です。

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/auth/test` | 接続テスト・認証情報の検証 |
| POST | `/api/recordings/upload` | 録音アップロード（multipart/form-data） |
| GET | `/api/recordings` | 認証ユーザーの録音一覧 |
| DELETE | `/api/recordings/[id]` | 録音削除 |
| POST | `/api/recordings/[id]/transcribe` | Whisper文字起こし開始 |
| GET | `/api/recordings/[id]/transcription` | 文字起こし結果取得 |
| POST | `/api/recordings/[id]/correct/layer1` | Layer 1補正実行 |
| POST | `/api/recordings/[id]/correct/layer2` | Layer 2補正実行 |
| POST | `/api/recordings/[id]/feedback` | フィードバック送信 |
| POST | `/api/recordings/[id]/ground-truth` | 教師データ登録 |
| POST | `/api/recordings/[id]/experiment` | 実験実行 |
| GET | `/api/ontology/domains` | ドメイン一覧 |
| POST | `/api/ontology/domains` | ドメイン作成 |
| GET | `/api/ontology/domains/[id]/entities` | エンティティ一覧（検索可） |
| POST | `/api/ontology/domains/[id]/entities` | エンティティ作成 |
| POST | `/api/ontology/domains/[id]/evolve` | オントロジー進化実行 |
| GET | `/api/ontology/domains/[id]/snapshots` | スナップショット一覧 |
| GET/POST | `/api/ontology/relations` | 関係管理 |
| GET | `/api/evaluation/[recordingId]` | 評価結果取得 |
| POST | `/api/evaluation/[recordingId]` | 評価計算 |

#### アップロードパラメータ（form-data）
- `file`（必須）: 音声ファイル
- `originalName`: 元のファイル名（タイムスタンプ抽出に使用）
- `displayName`: 録音の表示名
- `duration`: 録音時間（ミリ秒、サーバーで自動的に秒に変換）

アップロード後、Whisper APIによる文字起こしが自動実行されます。

### ユーザーポータル

`/user/login` からアクセス。一般ユーザーは自分のデータのみ閲覧可能です。

| ページ | 説明 |
|---|---|
| `/user/login` | ユーザーログインページ |
| `/user/recordings` | 自分の録音一覧 — 再生、文字起こし結果閲覧 |

**ユーザー権限:**
- 自分の録音の閲覧・再生
- 自分の文字起こし結果の閲覧
- 録音の削除は不可
- 他ユーザーのデータ閲覧は不可
- 管理機能（ユーザー管理、オントロジー、評価等）へのアクセスは不可

### 管理パネル

`/admin/login` からアクセス。管理者はすべての機能にフルアクセスできます。

| ページ | 説明 |
|---|---|
| `/admin/login` | 管理者ログインページ |
| `/admin/users` | アプリユーザー管理 — 作成・編集・削除 |
| `/admin/recordings` | 全録音表示 — ユーザー絞り込み、再生、削除、文字起こし |
| `/admin/admins` | 管理者ユーザー管理 — 作成・編集・削除 |
| `/admin/minutes` | 議事録 — 一覧・詳細表示 |
| `/admin/ontology` | オントロジー管理 — ドメイン、エンティティ、関係、スナップショット、エクスポート |
| `/admin/evaluation` | 評価結果 — CER指標、DKDP比分析 |

**管理者権限:**
- ユーザー権限のすべてに加えて:
- 全ユーザーの録音の閲覧・管理
- 録音の削除
- ユーザー・管理者の作成・編集・削除
- オントロジー管理（ドメイン、エンティティ、関係、進化）
- 評価結果の閲覧
- 文字起こし・補正の実行

### 権限比較表

| 機能 | 一般ユーザー | 管理者 |
|---|---|---|
| 自分の録音閲覧 | o | o |
| 自分の録音再生 | o | o |
| 文字起こし結果閲覧 | o | o |
| 録音削除 | x | o |
| 他ユーザーの録音閲覧 | x | o |
| ユーザー管理 | x | o |
| 管理者管理 | x | o |
| オントロジー管理 | x | o |
| 評価結果 | x | o |
| 議事録 | x | o |

## データモデル

### 主要モデル
- **User** — アプリユーザー（Basic Auth + ユーザーポータルログイン）
- **AdminUser** — 管理パネルユーザー（roleフィールド付き）
- **Recording** — 音声ファイルとメタデータ、文字起こしステータス・結果
- **Domain** — 談話ドメイン（例: 複数顧客保守、大学システム）
- **OntologyEntity** — ドメイン特化用語（ラベル、音韻ヒント、定義）
- **OntologyRelation** — エンティティ間の関係（isUsedIn, controls, relatedTo等）
- **OntologySnapshot** — オントロジー状態の週次スナップショット
- **CorrectionResult** — 録音/ドメイン/条件ごとのLayer 1/2補正結果
- **GroundTruth** — 評価用アノテーター教師データ
- **Feedback** — 文字起こし品質に対するユーザーフィードバック
- **EvaluationResult** — 録音/ドメイン/条件ごとのCER、DKDP指標

## ファイルストレージ

アップロードされた録音は `./data/<ユーザー名>/` に `yyyymmdd-hhmmss.拡張子` 形式のファイル名で保存されます（録音開始時刻基準）。同名ファイルが存在する場合は連番が付与されます（例: `20260303-143022_1.m4a`）。

## デフォルトシードデータ

Seedスクリプトは以下を作成します:
- **テストユーザー3名**: test1, test2, test3（パスワードは `SEED_USER_PASSWORD`）
- **管理者1名**: admin（パスワードは `SEED_ADMIN_PASSWORD`）
- **ドメイン4つ**: A（複数顧客保守）、B（特定顧客開発）、C（本部リーダー）、D（大学システム）
- **ドメイン別エンティティ・関係**: 音韻ヒント・共起度付き
- **各ドメインのWeek 0スナップショット**

## 注意点
- `SESSION_SECRET` は `.env` に必ず設定してください — 未設定の場合サーバーは起動を拒否します
- `OPENAI_API_KEY` はWhisper文字起こし機能に必要です
- Seedパスワードは環境変数未設定の場合 `changeme` がデフォルト
- 本番環境では、初期セットアップ後に直ちにすべてのデフォルトパスワードを変更してください
- モバイルアプリからミリ秒で送信されるDuration値は、アップロード時に自動的に秒に変換されます
- 音声ファイルはブラウザ内再生用に適切なMIMEタイプで配信されます

## ライセンス
このプロジェクトはMITライセンスの下でライセンスされています。詳細はLICENSEファイルを参照してください。
