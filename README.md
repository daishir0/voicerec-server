# voicerec-server

## Overview
voicerec-server is a Next.js server for receiving, storing, and managing voice recordings uploaded from mobile devices. It serves as the backend companion for [voicerec](https://github.com/daishir0/voicerec), an Expo-based mobile recording app.

Key features:
- REST API for recording upload, listing, and deletion with Basic Auth
- Admin panel with secure HMAC-signed cookie session authentication
- User management (create, edit, delete) via admin panel
- Recording management with in-browser audio playback
- Admin user management with role-based access
- SQLite database via Prisma ORM
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
#   SESSION_SECRET - generate with: openssl rand -hex 32
#   SEED_USER_PASSWORD - password for test users (test1, test2, test3)
#   SEED_ADMIN_PASSWORD - password for admin user
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

## Usage

### Mobile App API
All endpoints require Basic Auth (`Authorization: Basic base64(username:password)`).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/test` | Test connection and verify credentials |
| POST | `/api/recordings/upload` | Upload a recording (multipart/form-data) |
| GET | `/api/recordings` | List the authenticated user's recordings |
| DELETE | `/api/recordings/[id]` | Delete a recording |

#### Upload Parameters (form-data)
- `file` (required): The audio file
- `originalName`: Original filename (used to extract timestamp)
- `displayName`: Display name for the recording
- `duration`: Recording duration in milliseconds (auto-converted to seconds)

### Admin Panel
Access at `http://your-server-address/admin/login`.

| Page | Description |
|------|-------------|
| `/admin/users` | Manage app users — create, edit, delete |
| `/admin/recordings` | View all recordings with user filter, in-browser playback, delete |
| `/admin/admins` | Manage admin users — create, edit, delete |

### File Storage
Uploaded recordings are saved to `./data/<username>/` with filenames in `yyyymmdd-hhmmss.m4a` format based on the recording start time. If a filename already exists, a numeric suffix is appended (e.g., `20260303-143022_1.m4a`).

## Notes
- `SESSION_SECRET` must be set in `.env` — the server will refuse to start without it
- Seed passwords are read from environment variables (`SEED_USER_PASSWORD`, `SEED_ADMIN_PASSWORD`); defaults to `changeme` if not set
- The default seed creates 3 test users (test1, test2, test3) and 1 admin user
- For production, change all default passwords immediately after first setup
- Duration values sent from the mobile app in milliseconds are automatically converted to seconds on upload
- Audio files are served with proper MIME types for in-browser playback on the admin panel

## License
This project is licensed under the MIT License - see the LICENSE file for details.

---

# voicerec-server

## 概要
voicerec-serverは、モバイルデバイスからアップロードされた音声録音を受信・保存・管理するNext.jsサーバーです。Expoベースのモバイル録音アプリ[voicerec](https://github.com/daishir0/voicerec)のバックエンドコンパニオンとして機能します。

主な機能:
- Basic Auth付きの録音アップロード・一覧・削除用REST API
- HMAC署名Cookie Session認証による安全な管理パネル
- 管理パネルからのユーザー管理（作成・編集・削除）
- ブラウザ内音声再生付きの録音管理
- ロールベースアクセスの管理者ユーザー管理
- Prisma ORMによるSQLiteデータベース
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
#   SESSION_SECRET - 生成方法: openssl rand -hex 32
#   SEED_USER_PASSWORD - テストユーザー（test1, test2, test3）のパスワード
#   SEED_ADMIN_PASSWORD - 管理者ユーザーのパスワード
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

## 使い方

### モバイルアプリAPI
すべてのエンドポイントにBasic Auth認証が必要です（`Authorization: Basic base64(ユーザー名:パスワード)`）。

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/auth/test` | 接続テスト・認証情報の検証 |
| POST | `/api/recordings/upload` | 録音アップロード（multipart/form-data） |
| GET | `/api/recordings` | 認証ユーザーの録音一覧 |
| DELETE | `/api/recordings/[id]` | 録音削除 |

#### アップロードパラメータ（form-data）
- `file`（必須）: 音声ファイル
- `originalName`: 元のファイル名（タイムスタンプ抽出に使用）
- `displayName`: 録音の表示名
- `duration`: 録音時間（ミリ秒、サーバーで自動的に秒に変換）

### 管理パネル
`http://サーバーアドレス/admin/login` でアクセス。

| ページ | 説明 |
|--------|------|
| `/admin/users` | アプリユーザー管理 — 作成・編集・削除 |
| `/admin/recordings` | 全録音表示、ユーザー絞り込み、ブラウザ内再生、削除 |
| `/admin/admins` | 管理者ユーザー管理 — 作成・編集・削除 |

### ファイルストレージ
アップロードされた録音は `./data/<ユーザー名>/` に `yyyymmdd-hhmmss.m4a` 形式のファイル名で保存されます（録音開始時刻基準）。同名ファイルが存在する場合は連番が付与されます（例: `20260303-143022_1.m4a`）。

## 注意点
- `SESSION_SECRET` は `.env` に必ず設定してください — 未設定の場合サーバーは起動を拒否します
- Seedパスワードは環境変数（`SEED_USER_PASSWORD`, `SEED_ADMIN_PASSWORD`）から読み取ります。未設定の場合は `changeme` がデフォルト
- デフォルトのSeedは3つのテストユーザー（test1, test2, test3）と1つの管理者ユーザーを作成
- 本番環境では、初期セットアップ後に直ちにすべてのデフォルトパスワードを変更してください
- モバイルアプリからミリ秒で送信されるDuration値は、アップロード時に自動的に秒に変換されます
- 音声ファイルは管理パネルでのブラウザ内再生用に適切なMIMEタイプで配信されます

## ライセンス
このプロジェクトはMITライセンスの下でライセンスされています。詳細はLICENSEファイルを参照してください。
