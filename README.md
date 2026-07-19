[sample.webm](https://github.com/user-attachments/assets/e4da0f3d-a063-4f95-96aa-b6c5842fa5de)

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
  tags text[] not null default '{}'::text[],
  created_at timestamptz default now()
);

-- 2. 既存テーブルにもフォルダ名タグ用カラムを追加
alter table public.drive_images
add column if not exists tags text[] not null default '{}'::text[];

-- 3. 全件取得の順序を安定させ、画像数増加時の取得を支える複合インデックス
create index if not exists drive_images_created_at_id_idx
on public.drive_images (created_at asc, drive_file_id asc);

-- 4. 統計情報を更新して、クエリプランへインデックスを反映
analyze public.drive_images;

-- 5. 行レベルセキュリティ（RLS）を有効化して警告を解決
alter table public.drive_images enable row level security;

-- 6. Next.jsのサーバー（service_role）からの全操作を許可するポリシー
create policy "Allow all operations for service role"
on public.drive_images
for all
to service_role
using (true)
with check (true);
```

タグ絞り込みはクライアント側で行うため、`tags` 用のGINインデックスは追加しません。SQLでタグ検索する構成へ変更した時点で検討します。

## 3. Next.jsの環境設定

1. `.env.local.sample` を参考に、プロジェクトルートへ `.env.local` を作成
2. Google Drive、Supabase、閲覧用パスワード（`VIEW_PASSWORD`）、管理者用パスワード（`ADMIN_PASSWORD`）、Cookie署名用の `SITE_AUTH_SECRET` を `.env.local` に記述
3. 1つのフォルダだけ表示する場合は `GOOGLE_DRIVE_FOLDER_ID="folder_id"`、複数フォルダをまとめて表示する場合は `GOOGLE_DRIVE_FOLDER_ID="old_folder_id,new_folder_id"` のようにIDだけをカンマ区切りで指定。各フォルダ名は同期時にGoogle Driveから取得され、ギャラリーのタグとして使われます

## 4. 動作確認

1. ターミナルで `pnpm dev` を実行し、開発サーバーを起動（起動済みの場合は再起動）
2. `http://localhost:3000/` にアクセスし、ログイン画面へリダイレクトされるか確認
3. 設定したパスワードを入力してログイン
4. 管理者用パスワード（`ADMIN_PASSWORD`）でログインすると表示される `Sync` ボタンを押し、データ同期を実行（成功メッセージが出ればOK）
5. 画像一覧と、ヘッダーの「すべて」およびフォルダ名タグが表示されるか確認。「すべて」は最初の120枚を表示し、下端へ近づくと120枚ずつ自動で追加します。フォルダ名タグを選択した場合は、そのフォルダの画像を全件表示します。`GOOGLE_DRIVE_FOLDER_ID` を1つに戻して再同期すると、そのフォルダ以外の古い同期済み画像はギャラリーから削除されます

## 5. Vercelにデプロイ

1. GitHubにpush
2. Vercelでプロジェクトを作成
3. 対象のGitHubリポジトリをImport
4. 環境変数の設定値を入力（本番環境では `SITE_AUTH_SECRET` と `ADMIN_PASSWORD` を必ず設定）
5. Supabaseの自動停止を防ぐため、Vercelの **Settings > Environment Variables** に `CRON_SECRET` を追加（ランダムな長めの文字列を設定）

### Firewall Rules

Vercelの **Firewall** で、次のCustom Ruleを設定します。

| ルール名                         | 条件                                                                                      | アクション                                                             | 目的                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Brute Force Attacks Protection` | `Request Path equals /api/auth`                                                           | Fixed Window: 60秒、10リクエスト、キー: IP Address。上限超過時は `429` | パスワード総当たり攻撃を抑制する                                              |
| `Allow Access Only Japan`        | `Country does not equal Japan` **AND** `Request Path does not equal /api/cron/keep-alive` | Deny                                                                   | 日本国外からのアクセスを拒否しつつ、Vercel CronのKeep-alive実行だけを許可する |

Vercel Cronは日本国外のVercel基盤から実行されるため、`/api/cron/keep-alive` を国別拒否の対象外にします。このパスは `CRON_SECRET` のBearer認証を必須としているため、パスを例外にしても第三者は実行できません。

Cronの動作確認は **Settings > Cron Jobs** で `/api/cron/keep-alive` の `Run` を実行し、`View Logs` でHTTP `200` と `Keep-alive: Supabase connection pinged successfully.` を確認します。

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
│   │   ├── cron/
│   │   │   └── keep-alive/
│   │   │       └── route.ts
│   │   ├── images/
│   │   │   ├── [fileId]/
│   │   │   │   └── route.ts
│   │   │   └── health/
│   │   │       └── route.ts
│   │   └── sync/
│   │       └── route.ts
│   ├── components/
│   │   ├── AdminSyncButton.tsx
│   │   ├── Lightbox.tsx
│   │   ├── MasonryGallery.tsx
│   │   ├── gallery-types.ts
│   │   └── gallery-utils.ts
│   ├── lib/
│   │   ├── auth-token.ts
│   │   └── drive-images/
│   │       ├── google-drive.ts
│   │       ├── heic.ts
│   │       ├── store.ts
│   │       └── thumbnail.ts
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
- `app/page.tsx`: イントロを先にストリーミングし、`Suspense`内でSupabaseの画像メタデータ取得と管理者判定を並列実行します。画像は1,000件単位で全件取得し、`created_at` と `drive_file_id` で順序を安定させます。表示名の拡張子除去や画像プロキシURLの生成を行ってギャラリーへ渡します。
- `app/login/page.tsx`: 閲覧用パスワード入力画面です。認証済みの場合はギャラリーへ戻します。
- `app/favicon.ico`: ブラウザタブなどで使われるファビコンです。

### API Routes

- `app/api/auth/route.ts`: `VIEW_PASSWORD` / `ADMIN_PASSWORD` と入力値を照合し、成功時に生パスワードではなく派生トークンをCookieへ発行します。通常ログインでは `site_auth`、管理者ログインでは `site_auth` と `site_admin` を発行します。
- `app/api/sync/route.ts`: Google Drive APIで指定フォルダ内の画像とフォルダ名を取得し、フォルダ名をタグとして `drive_images` テーブルへupsertします。通常の `site_auth` Cookieに加えて、`ADMIN_PASSWORD` ログイン時だけ発行される `site_admin` Cookieを検証するため、閲覧者だけでは同期や削除を実行できません。`GOOGLE_DRIVE_FOLDER_ID` は1つ、またはカンマ区切りの複数フォルダIDを指定できます。同期後は現在指定されていないフォルダ由来の古い行を削除し、ギャラリー内容を設定値に合わせます。
- `app/api/cron/keep-alive/route.ts`: Supabaseの無料プラン自動停止を防ぐためのKeep-alive用APIです。Vercel Cronから定期的に実行され、環境変数 `CRON_SECRET` に基づく認証が行われます。
- `app/api/images/[fileId]/route.ts`: Google Driveの非公開画像をサービスアカウント認証で取得し、クライアントへ安全にストリーミングします。`?variant=card` では最大800pxのDriveサムネイルを変換せずにストリーミングし、Vercel上でカードごとにSharpを実行する負荷を避けます。Lightboxでは原寸画像を使い、HEIC/HEIFだけWebP変換またはGoogle Driveの高解像度サムネイル候補へフォールバックします。
- `app/api/images/health/route.ts`: 認証済みユーザー向けの診断APIです。Supabase接続とGoogle Driveサービスアカウント認証を確認します。

### Components

- `app/components/GalleryShell.tsx`: ヘッダー、フォルダ名タグによる表示切替、管理者用Syncボタンを担当します。
- `app/components/IntroOverlay.tsx`: 2秒のイントロアニメーションと0.55秒の退出を担当します。ギャラリーデータ取得から独立して先に描画され、Supabase待ち時間とイントロ表示時間を重ねます。
- `app/components/MasonryGallery.tsx`: Masonryレイアウト、フォルダタグ付きカード表示、カードクリック時のLightbox起動を担当します。「すべて」は単一のアシンメトリーなMasonryへ120枚ずつ自動追加し、初期DOMの肥大化を抑えます。フォルダ名タグ選択時は対象画像を同じMasonryへ全件表示します。カード比率はDriveファイルIDから安定して決定し、規則的な反復を避けます。列先頭候補だけを即時表示・高優先度にし、それ以外の画像はlazy読み込みします。
- `app/components/Lightbox.tsx`: 全画面画像モーダルです。キーボード操作、左右ナビゲーション、モバイルスワイプに対応します。
- `app/components/gallery-types.ts`: ギャラリーで使う共有TypeScript型を定義します。
- `app/components/gallery-utils.ts`: JST基準の日付表示など、ギャラリー用の小さなユーティリティ関数を定義します。

### Login

- `app/login/LoginForm.tsx`: パスワード送信フォーム、送信中モーダル、認証エラー表示を担当します。
- `app/login/PasswordInput.tsx`: パスワード入力欄と表示/非表示のアイコン切り替えを担当します。

### Lib

- `app/lib/auth-token.ts`: `VIEW_PASSWORD` / `ADMIN_PASSWORD` と `SITE_AUTH_SECRET` からHMAC-SHA256の派生トークンを生成・検証する共通ヘルパーです。Cookieには生パスワードではなく、この派生トークンを保存します。`SITE_AUTH_SECRET` が未設定の場合もログイン不能にならないよう各パスワードをフォールバックに使いますが、本番環境では `SITE_AUTH_SECRET` の設定を推奨します。
- `app/lib/drive-images/google-drive.ts`: Google DriveのJWT認証、Driveクライアント生成、フォルダID解析、画像一覧取得を担当します。
- `app/lib/drive-images/store.ts`: Supabaseの `drive_images` 読み書き、upsert、現在の同期対象から外れた画像の削除を担当します。
- `app/lib/drive-images/heic.ts`: HEIC/HEIF判定、サイズ上限付きバッファリング、WebP変換を担当します。`sharp` はHEIC/HEIF変換時だけ遅延読み込みします。
- `app/lib/drive-images/thumbnail.ts`: HEIC変換失敗時にGoogle Driveの高解像度サムネイル候補を認証付きで取得します。

### Routing / Config

- `proxy.ts`: 未認証ユーザーを `/login` にリダイレクトするルーティングガードです。`/api/*` や静的ファイルは除外します。
- `next.config.ts`: Next.js設定です。ローカル開発時のHMR origin許可などを管理します。
- `tsconfig.json`: TypeScript設定です。strict modeやパスエイリアスを管理します。
- `eslint.config.mjs`: ESLint設定です。`pnpm lint` で利用されます。
- `postcss.config.mjs`: Tailwind CSS v4向けのPostCSS設定です。
- `prettier.config.mjs`: Prettier本体とTailwind/className整形プラグインの設定です。
- `.prettierignore`: Prettierの対象外にする生成物やローカル設定ファイルを指定します。
- `vercel.json`: Vercelデプロイ時のプロジェクト設定です。SupabaseのKeep-alive用Cron Jobスケジュール（3日おき）が定義されています。

### Package / Workspace

- `package.json`: 依存関係と `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm format` / `pnpm format:check` などのスクリプトを管理します。画像変換には `sharp` を使い、`packageManager` でpnpmバージョンを固定しています。Vercelでlibvipsが欠落しないよう、`sharp` とLinux x64向け `@img/sharp-*` のバージョンを揃えて固定しています。
- `pnpm-lock.yaml`: pnpmの依存バージョン固定ファイルです。
- `pnpm-workspace.yaml`: pnpm workspace設定です。VercelのLinux x64環境で `sharp` とlibvipsのoptional dependencyを確実に入れるため、`supportedArchitectures` と `allowBuilds` を設定しています。
- `next-env.d.ts`: Next.jsが生成・参照する型定義ファイルです。通常は手動編集しません。

### Environment / Git

- `.env.local.sample`: 必要な環境変数名を示すサンプルです。秘密値はここに書きません。`ADMIN_PASSWORD` は管理者ログインと同期ボタンの表示・実行権限に使います。
- `.gitignore`: `.env.local` やビルド成果物など、Git管理しないファイルを指定します。
