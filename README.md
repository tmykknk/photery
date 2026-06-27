# What

Next.js × Supabaseで構築したフォトギャラリーアプリです。
画像はGoogle Driveに格納したものをサービスアカウント経由で取得しています。

# Why

フォトウェディングで撮った写真を友人や家族に共有したかったのですが、都度ドライブの権限を更新するのは面倒。
せっかくなのでフォトライブラリーを作って見てほしい人たちだけに共有したいと思ったのがきっかけです。

# How

Geminiと壁打ちしながら初期の環境構築やアーキテクチャを固めていきました。
その後のコーディングや修正をCodexに任せました。

---

# Googleドライブ画像同期・認証システム 構築手順

## 1. Google Cloudの設定

1. Google Cloud Consoleでプロジェクトを作成
2. 「Google Drive API」を有効化
3. 「サービス アカウント」を作成し、認証キー（JSONファイル）をダウンロード
4. サービスアカウントのメールアドレスをコピー
5. Google ドライブに対象フォルダを作成し、上記メールアドレスへ「閲覧者」権限で共有
6. フォルダのURLから「フォルダID」を控える。複数フォルダを表示したい場合は、各フォルダを同じサービスアカウントへ共有し、IDをすべて控える

## 2. Supabaseの設定

1. Supabaseでプロジェクトを作成
2. 設定メニュー（API）から「Project URL」と「service_role（秘密鍵）」をコピー
3. SQL Editorを開き、新規クエリを作成
4. 以下のSQLを貼り付けて「Run」を実行

```sql
-- 1. 正しい構造でテーブルを作成
create table if not exists public.drive_images (
  drive_file_id text primary key,
  name text,
  thumbnail_url text,
  created_at timestamptz default now()
);

-- 2. 行レベルセキュリティ（RLS）を有効化して警告を解決
alter table public.drive_images enable row level security;

-- 3. Next.jsのサーバー（service_role）からの全操作を許可するポリシー
create policy "Allow all operations for service role"
on public.drive_images
for all
to service_role
using (true)
with check (true);
```

## 3. Next.jsの環境設定と配置

1. `.env.local.sample` を参考に、プロジェクトルートへ `.env.local` を作成
2. Google Drive、Supabase、閲覧用パスワード（`VIEW_PASSWORD`）、Cookie署名用の `SITE_AUTH_SECRET` を `.env.local` に記述。1つのフォルダだけ表示する場合は `GOOGLE_DRIVE_FOLDER_ID="folder_id"`、複数フォルダをまとめて表示する場合は `GOOGLE_DRIVE_FOLDER_ID="old_folder_id,new_folder_id"` のようにカンマ区切りで指定
3. `proxy.ts` で未認証時のリダイレクトを制御
4. `app/login/page.tsx` でパスワード入力画面を表示
5. `app/api/auth/route.ts` でパスワード検証・クッキー発行
6. `app/api/sync/route.ts` でGoogle DriveからSupabaseへデータ同期
7. `app/api/images/[fileId]/route.ts` でGoogle Drive画像を認証付きでストリーミング
8. `app/page.tsx` と `app/components/*` で画像ギャラリーを表示

## 4. 動作確認

1. ターミナルで `pnpm dev` を実行し、開発サーバーを起動（起動済みの場合は再起動）
2. `http://localhost:3000/` にアクセスし、ログイン画面へリダイレクトされるか確認
3. 設定したパスワードを入力してログイン
4. ブラウザで `http://localhost:3000/api/sync` にアクセスし、データ同期を実行（画面に success が出ればOK）
5. `http://localhost:3000/` に戻り、画像一覧が表示されるか確認。`GOOGLE_DRIVE_FOLDER_ID` を1つに戻して再同期すると、そのフォルダ以外の古い同期済み画像はギャラリーから削除されます

## 5. Vercelにデプロイ

1. GitHubにpush
2. Vercelでのプロジェクト作成
3. 対象のGitHubリポジトリをImport
4. 環境変数の設定値を入力（本番環境では `SITE_AUTH_SECRET` を必ず設定）
5. HEIC変換で使う `sharp` のLinux x64/libvips optional dependencyが必要なため、`pnpm-workspace.yaml` の `supportedArchitectures` と `allowBuilds`、および `package.json` の `@img/sharp-*` optionalDependencies を維持する

## 6. コード整形と検証

- `pnpm format`: Prettierでコード全体を整形します。
- `pnpm format:check`: Prettierの整形差分がないか確認します。
- `pnpm lint`: ESLintで静的検査を実行します。
- `pnpm exec tsc --noEmit`: TypeScriptの型チェックを実行します。
- `pnpm build`: Next.jsの本番ビルドでルートやサーバー処理を含めて検証します。

Prettierは `prettier-plugin-tailwindcss`、`prettier-plugin-classnames`、`prettier-plugin-merge` を使い、Tailwind CSSのクラス順序や長い `className` の整形を自動化しています。

## 7. ファイルツリー

```text
photery/
├── app/
│   ├── api/
│   │   ├── auth/
│   │   │   └── route.ts
│   │   ├── images/
│   │   │   └── [fileId]/
│   │   │       └── route.ts
│   │   └── sync/
│   │       └── route.ts
│   ├── components/
│   │   ├── Lightbox.tsx
│   │   ├── MasonryGallery.tsx
│   │   ├── gallery-types.ts
│   │   └── gallery-utils.ts
│   ├── lib/
│   │   ├── drive-images/
│   │   │   ├── google-drive.ts
│   │   │   ├── heic.ts
│   │   │   ├── store.ts
│   │   │   └── thumbnail.ts
│   │   └── auth-token.ts
│   ├── login/
│   │   ├── LoginForm.tsx
│   │   ├── PasswordInput.tsx
│   │   └── page.tsx
│   ├── favicon.ico
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── .env.local.sample
├── .gitignore
├── .prettierignore
├── README.md
├── eslint.config.mjs
├── next-env.d.ts
├── next.config.ts
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── postcss.config.mjs
├── prettier.config.mjs
├── proxy.ts
├── tsconfig.json
└── vercel.json
```

## 8. ファイルごとのメモ

### App Router

- `app/layout.tsx`: アプリ全体のHTML構造、メタデータ、フォント設定を定義します。
- `app/globals.css`: Tailwind CSSの読み込み、グローバルカラー、フォント変数、基本背景を定義します。
- `app/page.tsx`: Supabaseから画像メタデータを取得し、表示名の拡張子除去や画像プロキシURLの生成を行ってギャラリーへ渡します。
- `app/login/page.tsx`: 閲覧用パスワード入力画面です。認証済みの場合はギャラリーへ戻します。
- `app/favicon.ico`: ブラウザタブなどで使われるファビコンです。

### API Routes

- `app/api/auth/route.ts`: `VIEW_PASSWORD` と入力値を照合し、成功時に生パスワードではなく派生トークンを `site_auth` Cookieへ発行します。
- `app/api/sync/route.ts`: Google Drive APIで指定フォルダ内の画像を取得し、`drive_images` テーブルへupsertします。`GOOGLE_DRIVE_FOLDER_ID` は1つ、またはカンマ区切りの複数フォルダを指定できます。同期後は現在指定されていないフォルダ由来の古い行を削除し、ギャラリー内容を設定値に合わせます。
- `app/api/images/[fileId]/route.ts`: Google Driveの非公開画像をサービスアカウント認証で取得し、クライアントへ安全にストリーミングします。HEIC/HEIFはサーバー側でWebPへ変換して返します。`sharp` は変換時だけ遅延読み込みし、変換できない場合や本番環境でnative moduleを読めない場合はGoogle Driveの高解像度サムネイル候補へフォールバックします。変換とフォールバックは認証済み・同期済みファイルに限定し、入力サイズ上限を設けています。

### Components

- `app/components/MasonryGallery.tsx`: Masonryレイアウト、カード表示、イントロアニメーション、カードクリック時のLightbox起動を担当します。
- `app/components/Lightbox.tsx`: 全画面画像モーダルです。キーボード操作、左右ナビゲーション、モバイルスワイプに対応します。
- `app/components/gallery-types.ts`: ギャラリーで使う共有TypeScript型を定義します。
- `app/components/gallery-utils.ts`: JST基準の日付表示など、ギャラリー用の小さなユーティリティ関数を定義します。

### Login

- `app/login/LoginForm.tsx`: パスワード送信フォーム、送信中モーダル、認証エラー表示を担当します。
- `app/login/PasswordInput.tsx`: パスワード入力欄と表示/非表示のアイコン切り替えを担当します。

### Lib

- `app/lib/auth-token.ts`: `VIEW_PASSWORD` と `SITE_AUTH_SECRET` からHMAC-SHA256の派生トークンを生成・検証する共通ヘルパーです。Cookieには生パスワードではなく、この派生トークンを保存します。`SITE_AUTH_SECRET` が未設定の場合もログイン不能にならないよう `VIEW_PASSWORD` をフォールバックに使いますが、本番環境では `SITE_AUTH_SECRET` の設定を推奨します。
- `app/lib/drive-images/google-drive.ts`: Google DriveのJWT認証、Driveクライアント生成、フォルダID解析、画像一覧取得を担当します。
- `app/lib/drive-images/store.ts`: Supabaseの `drive_images` 読み書き、upsert、現在の同期対象から外れた画像の削除を担当します。
- `app/lib/drive-images/heic.ts`: HEIC/HEIF判定、サイズ上限付きバッファリング、WebP変換を担当します。
- `app/lib/drive-images/thumbnail.ts`: HEIC変換失敗時にGoogle Driveの高解像度サムネイル候補を認証付きで取得します。

### Routing / Config

- `proxy.ts`: 未認証ユーザーを `/login` にリダイレクトするルーティングガードです。`/api/*` や静的ファイルは除外します。
- `next.config.ts`: Next.js設定です。ローカル開発時のHMR origin許可などを管理します。
- `tsconfig.json`: TypeScript設定です。strict modeやパスエイリアスを管理します。
- `eslint.config.mjs`: ESLint設定です。`pnpm lint` で利用されます。
- `postcss.config.mjs`: Tailwind CSS v4向けのPostCSS設定です。
- `prettier.config.mjs`: Prettier本体とTailwind/className整形プラグインの設定です。
- `.prettierignore`: Prettierの対象外にする生成物やローカル設定ファイルを指定します。
- `vercel.json`: Vercelデプロイ時のプロジェクト設定です。

### Package / Workspace

- `package.json`: 依存関係と `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm format` / `pnpm format:check` などのスクリプトを管理します。画像変換には `sharp` を使い、`packageManager` でpnpmバージョンを固定しています。Vercelでlibvipsが欠落しないよう、`sharp` とLinux x64向け `@img/sharp-*` のバージョンを揃えて固定しています。
- `pnpm-lock.yaml`: pnpmの依存バージョン固定ファイルです。
- `pnpm-workspace.yaml`: pnpm workspace設定です。VercelのLinux x64環境で `sharp` とlibvipsのoptional dependencyを確実に入れるため、`supportedArchitectures` と `allowBuilds` を設定しています。
- `next-env.d.ts`: Next.jsが生成・参照する型定義ファイルです。通常は手動編集しません。

### Environment / Git

- `.env.local.sample`: 必要な環境変数名を示すサンプルです。秘密値はここに書きません。
- `.gitignore`: `.env.local` やビルド成果物など、Git管理しないファイルを指定します。
