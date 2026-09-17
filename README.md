[sample.webm](https://github.com/user-attachments/assets/e4da0f3d-a063-4f95-96aa-b6c5842fa5de)

# What

Next.js × Vercel × Supabase × Cloudflare で構築したフォトギャラリーアプリです。  
画像はGoogle Driveに格納したものをサービスアカウント経由で取得しています。

# Why

フォトウェディングで撮った写真を友人や家族に共有したかったのですが、都度ドライブの権限を更新するのは面倒。
せっかくなのでフォトライブラリーを作って見てほしい人たちだけに共有したいと思ったのがきっかけです。

# How

Geminiと壁打ちしながら初期の環境構築やアーキテクチャを固めていきました。  
その後のコーディングや修正をCodexに任せました。  

# Hsitory

最初はVercelのRoute HandlerがGoogle Driveの画像プロキシを担う設計にしていたため、画像本体の転送量がVercelのFast Origin Transferが無料枠の上限に達し、アプリが表示されない事象が発生しました。  
そこで毎度おなじみCloudflare Workersを導入。なかなかカオスな仕組みになってしまいました。画像のストレージ変えればええやんって話ですが、Googleドライブに保存するという縛りと、学習がてらゴニョゴニョしてたらこうなりました。
  
# Architecture

画像ファイルは **Google Driveだけ** に保存します。Supabaseには検索・表示に必要なメタデータだけを保存し、通常時の画像本体はVercelを通りません。

```text
通常の認可・一覧取得

[閲覧者のブラウザ] ←── Cookie / 一覧JSON / チケット ──→ [Vercel / Next.js]
                                                          │ メタデータ・予備予算
                                                          ▼
                                                    [Supabase]

通常の画像取得（Vercelを通らない）

[閲覧者のブラウザ] ── Authorization: Bearer ──→ [Cloudflare Worker]
       ▲                                                │ サービスアカウント認証
       └─────────────── 画像本体 ───────────────────────┘
                                                        ▼
                                                  [Google Drive]
                                                  ・非公開の画像原本

※ VercelがGoogle Driveへ接続するのは、管理者の同期とWorker障害時の限定フォールバックだけです。
```

### 通常時の画像表示

1. 閲覧者が共通パスワードでログインすると、VercelがHTTP-only Cookieを発行します。
2. ギャラリーはVercelからSupabase上のメタデータだけを取得します。画像バイナリは含みません。
3. ブラウザが `/api/images/{fileId}` を呼ぶと、VercelはCookieと画像登録を確認し、画像ID・用途・寸法・5分の有効期限に限定した署名チケットをJSONで返します。
4. ブラウザはチケットを`Authorization`ヘッダーに入れ、Cloudflare Workerの `/image` を直接呼びます。
5. Workerがチケットを検証してGoogle Driveから画像をストリーミングし、ブラウザへ返します。したがって通常の画像転送量はVercel Fast Origin Transferに計上されません。

### Worker障害時だけの予備経路

Workerが通信エラー・5xx・429・上限エラーになった時だけ、表示用の縮小画像をVercelが一度だけ中継します。原本ダウンロードは予備経路を使いません。

- 1画像あたり最大2MB、直近30日で既定1GBまでをSupabaseで原子的に予約・精算します。
- 予算切れまたはDB障害時は画像を返さず、ログイン・一覧・タグ操作は維持します。
- Workerが連続2回失敗したブラウザでは5分間だけ予備経路を使い、その後Workerを再試行します。

### 役割と非公開性

| コンポーネント | 担当 | 画像本体を通常時に送るか | ブラウザへ渡さないもの |
| --- | --- | --- | --- |
| Vercel / Next.js | パスワード認可、一覧、チケット発行、限定フォールバック | いいえ | Google認証情報、Supabaseサービスロール、チケット署名鍵 |
| Cloudflare Worker | チケット検証、Google Driveからのストリーミング | はい | Google認証情報、チケット署名鍵 |
| Google Drive | 画像原本の保存 | Workerだけへ送る | ファイルへの恒久的な公開URL |
| Supabase | 画像メタデータ、予備転送の予約・精算 | いいえ | ブラウザからの直接DBアクセス |

チケットはURLに含めず、ブラウザからWorkerへ`Authorization`ヘッダーで渡します。画像レスポンスはブラウザ専用キャッシュであり、共有CDNにはキャッシュしません。

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
  tags text[] not null default '{}'::text[],
  folder_order integer not null default 2147483647,
  created_at timestamptz default now()
);

-- 2. 既存テーブルにもフォルダ名タグ用カラムを追加
alter table public.drive_images
add column if not exists tags text[] not null default '{}'::text[];

-- 3. 既存テーブルにも環境変数のフォルダID順を保存するカラムを追加
alter table public.drive_images
add column if not exists folder_order integer not null default 2147483647;

-- 4. 「すべて」のフォルダ順・ファイル名順を支える複合インデックス
create index if not exists drive_images_folder_order_name_id_idx
on public.drive_images (folder_order asc, name asc, drive_file_id asc);

-- 5. 統計情報を更新して、クエリプランへインデックスを反映
analyze public.drive_images;

-- 6. ブラウザ向けロールからメタデータを直接読めないようにする
alter table public.drive_images enable row level security;

revoke all on table public.drive_images from anon, authenticated;
grant all on table public.drive_images to service_role;
```

続けて以下のSQLを実行します。画像の寸法、タグ一覧関数、予備転送量の予約・精算テーブルを追加します。

```sql
begin;

alter table public.drive_images add column if not exists width integer;
alter table public.drive_images add column if not exists height integer;
create index if not exists drive_images_tags_idx on public.drive_images using gin(tags);

create or replace function public.photery_gallery_tags()
returns table(tag text, folder_order integer)
language sql stable security invoker set search_path = '' as $$
  select t.tag, min(d.folder_order)::integer
  from public.drive_images d
  cross join lateral unnest(d.tags) as t(tag)
  where t.tag <> '' group by t.tag
  order by min(d.folder_order) nulls last, t.tag;
$$;
revoke all on function public.photery_gallery_tags() from public, anon, authenticated;
grant execute on function public.photery_gallery_tags() to service_role;

create table if not exists public.image_transfer_reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bytes bigint not null check (bytes between 0 and 2000000),
  settled boolean not null default false
);
create index if not exists image_transfer_time_idx on public.image_transfer_reservations(created_at);
alter table public.image_transfer_reservations enable row level security;
revoke all on public.image_transfer_reservations from anon, authenticated;
grant all on public.image_transfer_reservations to service_role;

create or replace function public.reserve_image_transfer(p_budget bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare used bigint; reservation uuid;
begin
  if p_budget < 2000000 or p_budget > 8000000000 then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(74682159);
  delete from public.image_transfer_reservations where created_at < now() - interval '31 days';
  select coalesce(sum(bytes), 0) into used from public.image_transfer_reservations
    where created_at >= now() - interval '30 days' or not settled;
  if used + 2000000 > p_budget then return null; end if;
  insert into public.image_transfer_reservations(bytes) values (2000000) returning id into reservation;
  return reservation;
end;
$$;

create or replace function public.settle_image_transfer(p_id uuid, p_bytes bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_bytes < 0 or p_bytes > 2000000 then raise exception 'Invalid byte count'; end if;
  perform pg_catalog.pg_advisory_xact_lock(74682159);
  update public.image_transfer_reservations set bytes = p_bytes, settled = true, created_at = now()
    where id = p_id and not settled and p_bytes <= bytes;
end;
$$;
revoke all on function public.reserve_image_transfer(bigint) from public, anon, authenticated;
revoke all on function public.settle_image_transfer(uuid, bigint) from public, anon, authenticated;
grant execute on function public.reserve_image_transfer(bigint) to service_role;
grant execute on function public.settle_image_transfer(uuid, bigint) to service_role;

commit;
```

### 既存Supabase環境の扱い

- この構成をまだ導入していない場合は、上の2つのSQLブロックを順にSQL Editorで実行します。
- 既存の`drive_images`テーブルがある場合も、上の2つのSQLブロックを順に実行します。`create table if not exists`と`add column if not exists`は既存テーブルや行を上書き・削除しません。追加されるのは`width`・`height`列、インデックス、タグ関数、予備転送量テーブルと関数だけです。
- 既存の`thumbnail_url`列は現行アプリから参照されませんが、動作にも費用にも影響しないため、削除は必須ではありません。
- `anon`または`authenticated`ロールで別のアプリが`drive_images`へ直接アクセスしている場合は、`revoke`を実行する前にその利用を切り替えます。このアプリはVercelの`service_role`だけでアクセスします。
- 整理する場合は、バックアップと他の利用箇所を確認したうえで、次のSQLを**手動で**実行します。これは画像本体を削除しません。`thumbnail_url`に保存されているのはDriveサムネイルURLというメタデータだけです。

```sql
alter table public.drive_images drop column if exists thumbnail_url;
```

## 3. Next.jsの環境設定

1. `.env.local.sample` を参考に、プロジェクトルートへ `.env.local` を作成
2. Google Drive、Supabase、閲覧用パスワード（`VIEW_PASSWORD`）、管理者用パスワード（`ADMIN_PASSWORD`）、Cookie署名用の`SITE_AUTH_SECRET`、Worker URLと同じ`IMAGE_TICKET_SECRET`、`IMAGE_WORKER_URL`、`IMAGE_FALLBACK_BUDGET_BYTES`を`.env.local`に記述
3. 1つのフォルダだけ表示する場合は `GOOGLE_DRIVE_FOLDER_ID="folder_id"`、複数フォルダをまとめて表示する場合は `GOOGLE_DRIVE_FOLDER_ID="old_folder_id,new_folder_id"` のようにIDだけをカンマ区切りで指定。左からのフォルダID順が「すべて」の表示順になります。各フォルダ名は同期時にGoogle Driveから取得され、ギャラリーのタグとして使われます

## 4. Cloudflare Workerの設定

- Workerは無料の `workers.dev` ドメインを使います。R2、Supabase Storage、画像変換サービスは使いません。
- Googleのアクセストークン・サービスアカウント秘密鍵をブラウザへ渡しません。チケットは画像ID・用途・サイズ・期限に限定し、Authorizationヘッダーで渡します。
- 通常時のVercel応答は小さいJSONのみです。画像の `/_next/image` 最適化も通しません。
- 一覧は60件ずつ取得、可視領域付近のみ画像取得、同時取得は4件までです。ライトボックスの次ページ境界でも追加取得します。
- 一覧は表示領域・画像の縦横比・画面密度に応じて320 / 640 / 800 / 1600px、拡大表示は1600pxをDriveサムネイルに要求します（長辺の目安）。カードの縦横比は画像IDから決め、高さに変化を付けます。これはGoogle側のベストエフォートであり、厳密な寸法保証ではありません。縮小指定が失敗した場合も既存サムネイルだけを使い、表示用に原本を取得しません。
- 原本は保存操作時だけWorker経由で取得します。Worker障害時は保存を一時停止し、Vercelで原本を中継しません。

### 導入手順

1. 前述のSQLをSupabase SQL Editorで実行します。
2. CloudflareアカウントをWorkers Freeで用意し、`pnpm exec wrangler login` で認証します。
3. `openssl rand -hex 32` とかで `IMAGE_TICKET_SECRET` を作ります。
4. 以下を実行し、プロンプトでWorkerの値を設定します。Cloudflare Dashboardで設定する場合は、対象Workerの **Settings > Variables and Secrets** で同じ名前のSecretを追加します。

```bash
# 実際のVercelアプリOrigin（例: `https://example.vercel.app`、末尾スラッシュなし）を入力
pnpm exec wrangler secret put ALLOWED_ORIGINS --config workers/images/wrangler.jsonc

# .env.local の値を設定
pnpm exec wrangler secret put IMAGE_TICKET_SECRET --config workers/images/wrangler.jsonc
pnpm exec wrangler secret put GOOGLE_CLIENT_EMAIL --config workers/images/wrangler.jsonc
pnpm exec wrangler secret put GOOGLE_PRIVATE_KEY --config workers/images/wrangler.jsonc

# 型チェックしてデプロイ
pnpm worker:types
pnpm worker:check
pnpm worker:deploy
```

5. Vercelに `IMAGE_WORKER_URL=https://photery-images.<account>.workers.dev`、`IMAGE_TICKET_SECRET`、`IMAGE_FALLBACK_BUDGET_BYTES=1000000000` を設定します。転送枠が既に逼迫している場合は、最初は `IMAGE_FALLBACK_BUDGET_BYTES=0` として予備転送を無効にします。

> `wrangler.jsonc`には環境ごとの値を保存しません。Workerが参照する変数名は`workers/images/src/env.d.ts`で型としてだけ宣言し、値はCloudflare側にのみ保存されます。


## 5. 動作確認

ローカル開発では、プロジェクトルートの `.env.local` を唯一の秘密値ファイルとして使います。  
Wranglerが設定ファイルと同じディレクトリの `.dev.vars` を読むため、次のシンボリックリンクを一度だけ作成します。

1. プロジェクトルートの `.env.local` に以下の値を設定します。

   ```dotenv
   ALLOWED_ORIGINS=http://localhost:3000
   IMAGE_WORKER_URL=http://localhost:8787
   IMAGE_TICKET_SECRET=Next.jsとWorkerで同じ秘密値
   IMAGE_FALLBACK_BUDGET_BYTES=1000000000
   ```

2. プロジェクトルートの `.env.local` を `workers/images/.dev.vars` にシンボリックリンクを作成します。

   ```bash
   ln -s ../../.env.local workers/images/.dev.vars
   ```

3. ターミナルを2つ開き、WorkerとNext.jsを別々に起動します。

   ターミナルA:

   ```bash
   pnpm worker:dev
   ```

   ターミナルB:

   ```bash
   pnpm dev
   ```

   Workerは `http://localhost:8787`、Next.jsは `http://localhost:3000` で待ち受けます。

4. ブラウザで `http://localhost:3000` を開き、共通パスワードでログインします。管理者ログインの場合は `Sync` を一度実行してからギャラリーを再読み込みします。

5. ブラウザの開発者ツール（F12）の **Network** タブを開き、**Preserve log** と **Disable cache** を有効にしてページを再読み込みします。

6. Networkの検索欄に `/api/images/` と入力し、画像表示時のリクエストを確認します。ステータスは `200`、レスポンスは画像本体ではなく、`url`・`token`・`expiresAt`・`fileName` を含むJSONです。`token` は秘密値なのでコピー・共有しません。

7. Networkの検索欄を `localhost:8787` に変更し、`http://localhost:8787/image` のリクエストを確認します。ステータスが `200` で、レスポンスヘッダーに `Content-Type: image/...`、`X-Image-Route: worker`、`Access-Control-Allow-Origin: http://localhost:3000` があれば、画像本体はWorkerから配信されています。通常は `/api/images/...` から画像本体が返らず、`/_next/image` も発生しません。

8. 予備経路を確認する場合はWorkerのターミナルで `Ctrl+C` を押して停止し、ギャラリーを再読み込みします。表示画像だけが `/api/images/{fileId}?fallback=1` から返り、`X-Image-Route: fallback` になります。予算を `0` にしている場合は予備画像も返らずエラー表示になります。原本ダウンロードはWorker停止時にVercel経由へ切り替わりません。

9. CORSだけを確認する場合は、Worker起動中に次を実行します。

   ```bash
   curl -i -X OPTIONS http://localhost:8787/image \
     -H 'Origin: http://localhost:3000'
   ```

   `204` が返れば、ローカルの許可Origin設定は機能しています。Worker停止後は `pnpm worker:dev` を再実行して復旧します。

### 非公開画像の配信構成

画像の保存先はGoogle Driveのみです。閲覧者は共通パスワードでログインし、Googleアカウントは不要です。

```text
ブラウザ → Vercel: Cookie認可・登録画像の確認・5分有効のチケット発行
ブラウザ → Cloudflare Worker: チケット検証 → 非公開Drive画像をストリーミング
通信障害時のみ → Vercel: 予算内の表示用サムネイルを中継
```

### 自動復帰と転送量の安全弁

- Workerの通信エラー・5xx・429・上限エラーで予備経路へ1回だけ切り替えます。401/403/404などの認可・存在エラーでは切り替えません。期限切れチケットだけ1回再発行します。
- Workerが続けて2回失敗すると、そのブラウザでは5分間予備経路を使い、その後Workerを再試行します。
- 予備経路は1画像2,000,000バイトまで、直近30日で既定1,000,000,000バイトまでです。DBで最大送信量を原子的に予約し、読み込み後に実バイトを精算します。上限超過は429、DB障害時も画像を送らず停止します。
- 予算切れでは画像の一部をエラー表示に留め、ログイン・一覧・タグ操作を維持します。自動の無限リトライはしません。
- これはアプリ独自の画像本文の計測で、Vercel全体の転送量ではありません。HTML、API応答、他のプロジェクト、既存消費、プラットフォームの集計期間との差は含みません。「費用ゼロ」「絶対に停止しない」を無制限に保証する構成ではありません。
- Workers Freeは日次リクエスト数やCPU時間に制限があります。画像リクエストに加えてCORSの事前確認も計上対象です。本番のCPU時間・使用量を確認してください。[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/) / [制限](https://developers.cloudflare.com/workers/platform/limits/)

VercelのFast Origin TransferとWorkerの使用量を各ダッシュボードで確認します。アプリログの `image_delivery` は経路・ステータス・既知のバイト数のみを記録します（Workerのストリーム中断後の実転送量はログでは確定できません）。トークンやDrive URLをログに追加しないでください。

予備予算の消費・予約量はSQLで確認できます。

```sql
select coalesce(sum(bytes), 0) as used_or_reserved_bytes
from public.image_transfer_reservations
where created_at >= now() - interval '30 days' or not settled;
```

### 非公開性とキャッシュ

チケットAPI・認証エラーは `private, no-store`。Worker画像はチケット期限までのブラウザ専用キャッシュ、予備画像は最大5分のブラウザ専用キャッシュです。共有CDNにはキャッシュしません。Workerは `Vary: Origin, Authorization` で画像ごとのチケットを区別します。ダウンロードは `no-store` です。

チケットを取得した人は最大5分再利用できます。パスワード変更や一覧からの削除は既発行チケットを即時失効させません。緊急停止時は両環境のチケット秘密値を交換してください。既に保存された写真・ブラウザ内の取得済みデータは回収できません。CORSだけでは認可にならず、署名検証を必ず維持します。

旧実装を既に本番で実行してStorageに画像をコピーしていた場合、そのオブジェクトは本変更では削除しません。バックアップ・保存要件を確認して別途整理してください。

### 検証・本番切替の確認

```bash
pnpm worker:types
pnpm worker:check
pnpm worker:build
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

本番で次を確認してから切替を完了してください。

- 未ログインの画像APIは401、不正チケットは403、期限切れは401。
- Networkで通常の `/api/images/...` はJSONのみ、画像本体はWorkerから取得され、`/_next/image` やSupabase Storageには流れない。
- 共通パスワードだけで一覧・拡大・原本保存が動作する。60件目から61件目への移動、タグ切替、スマホも確認する。
- DevToolsでWorker通信をブロックすると表示画像だけ予備経路へ切り替わる。予算0ではエラー表示になり、原本はVercelへ流れない。通信復旧後5分でWorkerへ戻る。
- 実際のDriveのJPEG/HEIC等のサムネイル互換性とWorkers FreeのCPU時間を確認する。

## 6. Vercelにデプロイ

1. GitHubにpush
2. Vercelでプロジェクトを作成
3. 対象のGitHubリポジトリをImport
4. `.env.local.sample`にある値をVercel Environment Variablesへ設定する。本番では`SITE_AUTH_SECRET`、`ADMIN_PASSWORD`、`IMAGE_TICKET_SECRET`、`IMAGE_WORKER_URL`を必ず設定する
5. Supabaseの自動停止を防ぐため、Vercelの **Settings > Environment Variables** に `CRON_SECRET` を追加（ランダムな長めの文字列を設定）

### Firewall Rules

Vercelの **Firewall** で、次のCustom Ruleを設定します。

| ルール名                         | 条件                                                                                      | アクション                                                             | 目的                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Brute Force Attacks Protection` | `Request Path equals /api/auth`                                                           | Fixed Window: 60秒、10リクエスト、キー: IP Address。上限超過時は `429` | パスワード総当たり攻撃を抑制する                                              |
| `Allow Access Only Japan`        | `Country does not equal Japan` **AND** `Request Path does not equal /api/cron/keep-alive` | Deny                                                                   | 日本国外からのアクセスを拒否しつつ、Vercel CronのKeep-alive実行だけを許可する |

Vercel Cronは日本国外のVercel基盤から実行されるため、`/api/cron/keep-alive` を国別拒否の対象外にします。このパスは `CRON_SECRET` のBearer認証を必須としているため、パスを例外にしても第三者は実行できません。

Cronの動作確認は **Settings > Cron Jobs** で `/api/cron/keep-alive` の `Run` を実行し、`View Logs` でHTTP `200` と `Keep-alive: Supabase connection pinged successfully.` を確認します。

## 7. コード整形と検証

- `pnpm format`: Prettierでコード全体を整形します。
- `pnpm format:check`: Prettierの整形差分がないか確認します。
- `pnpm lint`: ESLintで静的検査を実行します。
- `pnpm exec tsc --noEmit`: TypeScriptの型チェックを実行します。
- `pnpm build`: Next.jsの本番ビルドでルートやサーバー処理を含めて検証します。

Prettierは `prettier-plugin-tailwindcss`、`prettier-plugin-classnames`、`prettier-plugin-merge` を使い、Tailwind CSSのクラス順序や長い `className` の整形を自動化しています。

## 8. ファイルツリー

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
│   │   ├── gallery/
│   │   │   └── route.ts
│   │   └── sync/
│   │       └── route.ts
│   ├── components/
│   │   ├── AdminSyncButton.tsx
│   │   ├── GalleryShell.tsx
│   │   ├── IntroOverlay.tsx
│   │   ├── Lightbox.tsx
│   │   ├── LightboxControls.tsx
│   │   ├── MasonryGallery.tsx
│   │   ├── PrivateImage.tsx
│   │   ├── image-client.ts
│   │   ├── ZoomableImage.tsx
│   │   ├── gallery-types.ts
│   │   ├── useFullscreen.ts
│   │   ├── useImageDownload.ts
│   │   └── gallery-utils.ts
│   ├── lib/
│   │   ├── auth-token.ts
│   │   ├── gallery-data.ts
│   │   └── drive-images/
│   │       ├── google-drive.ts
│   │       ├── store.ts
│   │       └── image-response.ts
│   ├── login/
│   │   ├── LoginForm.tsx
│   │   ├── PasswordInput.tsx
│   │   └── page.tsx
│   ├── favicon.ico
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── shared/
│   ├── drive-media.ts
│   └── image-protocol.ts
├── workers/images/
│   ├── src/
│   │   ├── env.d.ts
│   │   └── index.ts
│   ├── .dev.vars                    # .env.localへのローカル専用リンク
│   ├── wrangler.jsonc
│   └── worker-configuration.d.ts
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

## 9. ファイルごとのメモ

### App Router

- `app/layout.tsx`: アプリ全体のHTML構造、メタデータ、フォント設定を定義します。
- `app/globals.css`: Tailwind CSSの読み込み、グローバルカラー、フォント変数、基本背景を定義します。
- `app/page.tsx`: 認証確認後、最初の60件・タグ一覧・管理者判定を並列取得します。全件の画像メタデータやWorkerチケットをHTMLへ埋め込みません。
- `app/login/page.tsx`: 閲覧用パスワード入力画面です。認証済みの場合はギャラリーへ戻します。
- `app/favicon.ico`: ブラウザタブなどで使われるファビコンです。

### API Routes

- `app/api/auth/route.ts`: `VIEW_PASSWORD` / `ADMIN_PASSWORD` と入力値を照合し、成功時に生パスワードではなく派生トークンをCookieへ発行します。通常ログインでは `site_auth`、管理者ログインでは `site_auth` と `site_admin` を発行します。
- `app/api/sync/route.ts`: Google Drive APIで指定フォルダ内の画像とフォルダ名を取得し、フォルダ名タグと`GOOGLE_DRIVE_FOLDER_ID`の配列順を `drive_images` テーブルへupsertします。通常の `site_auth` Cookieに加えて、`ADMIN_PASSWORD` ログイン時だけ発行される `site_admin` Cookieを検証するため、閲覧者だけでは同期や削除を実行できません。`GOOGLE_DRIVE_FOLDER_ID` は1つ、またはカンマ区切りの複数フォルダIDを指定できます。同期後は現在指定されていないフォルダ由来の古い行を削除し、ギャラリー内容を設定値に合わせます。
- `app/api/cron/keep-alive/route.ts`: Supabaseの無料プラン自動停止を防ぐためのKeep-alive用APIです。Vercel Cronから定期的に実行され、環境変数 `CRON_SECRET` に基づく認証が行われます。
- `app/api/gallery/route.ts`: 認証済みユーザーへ、タグ別を含む60件単位のギャラリーメタデータだけを返します。
- `app/api/images/[fileId]/route.ts`: Cookie認可後に5分有効のWorker用チケットをJSONで返します。`fallback=1` の表示画像だけ、DB予算内でVercel中継します。原本の予備中継は拒否します。

### Components

- `app/components/GalleryShell.tsx`: ヘッダー、フォルダタグ、管理者用メタデータSyncを表示します。全体・タグ別に60件ずつ認証付きAPIから取得し、フィルタ切替時は古いリクエストを中止します。
- `app/components/IntroOverlay.tsx`: 最低2秒表示し、画面内の画像のデコード完了後に0.55秒で退出します。退出を含め最大5秒で解除し、遅い画像は裏で取得を継続します。
- `app/components/GalleryIntro.tsx`: イントロ中もギャラリーをマウントし、画面内の画像の準備状態を共有します。空一覧・取得失敗も待機終了として扱い、イントロ中は背景操作を抑止します。画像取得は画面内を優先し、同時4件までです。
- `app/components/MasonryGallery.tsx`: 読み込んだ写真を自然な縦横比で配置します。先頭の少数のみeager、それ以外はlazyで、`PrivateImage` が表示幅とDPRからDriveサムネイルの要求サイズを選びます。
- `app/components/PrivateImage.tsx`: 可視領域にある画像だけを取得し、表示終了時にはBlob URLを解放します。
- `app/components/image-client.ts`: チケット取得、同時取得数の制限、Worker障害時の限定フォールバック、期限切れチケットの再発行を担当します。
- `app/components/Lightbox.tsx`: 1600pxを要求したDriveサムネイルを使うモーダルです。スワイプ・ズーム・キーボード操作に対応し、原本は保存操作でのみ取得します。
- `app/components/LightboxControls.tsx`: ライトボックスの操作ボタンとSVGアイコンをまとめた表示専用コンポーネントです。
- `app/components/ZoomableImage.tsx`: ダブルタップ／ダブルクリックでの拡大、ピンチ操作、拡大中のパン、未拡大時のスワイプを担当します。
- `app/components/useImageDownload.ts`: ダウンロード処理を担当します。対応スマホではWeb Share APIで共有シートを開き、未対応ブラウザではファイルダウンロードへフォールバックします。
- `app/components/useFullscreen.ts`: Fullscreen APIの開始・終了と状態同期を担当します。非対応ブラウザでは全画面ボタンを表示しません。
- `app/components/gallery-types.ts`: ギャラリーで使う共有TypeScript型を定義します。
- `app/components/gallery-utils.ts`: JST基準の日付表示など、ギャラリー用の小さなユーティリティ関数を定義します。

### Login

- `app/login/LoginForm.tsx`: パスワード送信フォーム、送信中モーダル、認証エラー表示を担当します。
- `app/login/PasswordInput.tsx`: パスワード入力欄と表示/非表示のアイコン切り替えを担当します。

### Lib

- `app/lib/auth-token.ts`: `VIEW_PASSWORD` / `ADMIN_PASSWORD` と `SITE_AUTH_SECRET` からHMAC-SHA256の派生トークンを生成・検証する共通ヘルパーです。Cookieには生パスワードではなく、この派生トークンを保存します。`SITE_AUTH_SECRET` が未設定の場合もログイン不能にならないよう各パスワードをフォールバックに使いますが、本番環境では `SITE_AUTH_SECRET` の設定を推奨します。
- `app/lib/drive-images/google-drive.ts`: Google DriveのJWT認証、Driveクライアント生成、フォルダID解析、画像一覧取得を担当します。
- `app/lib/drive-images/store.ts`: Supabaseの `drive_images` 読み書き、フォルダ順を含むupsert、現在の同期対象から外れた画像の削除を担当します。
- `app/lib/drive-images/image-response.ts`: 登録画像の認可、短命チケット発行、予備転送の予約・精算を担当します。
- `shared/`: VercelとWorkerで共有するチケット検証と安全なDriveメディア取得処理です。
- `workers/images/`: Cloudflare Worker本体・設定・ローカル開発用の秘密値サンプルです。

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

- `package.json`: 依存関係と `pnpm dev` / `pnpm build` / `pnpm lint` / `pnpm format` / `pnpm format:check` などのスクリプトを管理します。画像配信での変換ライブラリやストレージSDKは含めません。
- `pnpm-lock.yaml`: pnpmの依存バージョン固定ファイルです。
- `pnpm-workspace.yaml`: pnpm workspace設定です。Next.jsの任意依存とWorker開発用のネイティブ依存をビルド許可しています。アプリの画像配信ではsharpを使いません。
- `next-env.d.ts`: Next.jsが生成・参照する型定義ファイルです。通常は手動編集しません。

### Environment / Git

- `.env.local.sample`: 必要な環境変数名を示すサンプルです。秘密値はここに書きません。`ADMIN_PASSWORD` は管理者ログインと同期ボタンの表示・実行権限に使います。
- `.gitignore`: `.env.local` やビルド成果物など、Git管理しないファイルを指定します。
