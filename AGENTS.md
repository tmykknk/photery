# Photery 開発ガイド

このファイルはリポジトリ全体に適用する。Photery は Google Drive の非公開写真を、共通パスワードで共有するギャラリーアプリ。

## 作業前に確認するもの

- 構成・セットアップ・SQL・運用手順は `README.md`、コマンドと依存関係は `package.json` を確認する。バージョンはこれらと `pnpm-lock.yaml` に従い、作業に不要な更新をしない。
- UI、ギャラリー、認証、同期、画像配信を変更するときは [.agents/skills/photery-overview/SKILL.md](.agents/skills/photery-overview/SKILL.md) を読む。デザインと機能別の指針はこのスキルで管理する。
- ドキュメントと実装に差がある場合は関連コードを確認し、古い記述に合わせて既存機能を戻さない。仕様・環境変数・運用方法を変更したら関連ドキュメントも更新する。

## 技術構成と編集方針

- Next.js App Router / React / TypeScript strict / Tailwind CSS を使用する。アニメーションは既存の Framer Motion を利用する。
- パッケージ管理は pnpm。別のパッケージマネージャーのロックファイルを追加しない。
- `app/` は Next.js、`workers/images/` は画像配信用 Cloudflare Worker、`shared/` は両ランタイムで使う画像プロトコルと Drive メディア取得処理。共有コードには Next.js 専用・Node.js 専用の依存を安易に持ち込まない。
- `any` は使用せず、外部入力は `unknown`、型ガード、明示的な型で検証する。
- 明示的な依頼なしに既存のファイル名・関数名・ルート名・環境変数名を変更しない。
- 既存の責務分割と Prettier 設定に従い、変更対象だけを整形する。`pnpm format` は全体を書き換えるため、局所修正には使用しない。
- `next-env.d.ts` と `workers/images/worker-configuration.d.ts` は生成物として扱う。Worker の環境変数の型は `workers/images/src/env.d.ts`、生成は `pnpm worker:types` で管理する。

## 秘密情報と認証

- `.env.local` を直接読まない。`workers/images/.dev.vars` はそのシンボリックリンクなので、こちらからも読まない。環境変数の構造は `.env.local.sample` とコードから確認する。
- 秘密値をコード、サンプル、ログ、回答に含めない。Google 秘密鍵・アクセストークン、Supabase サービスロール、Cookie・チケットの署名鍵はサーバーだけで扱う。
- `wrangler.jsonc` に環境ごとの値を埋め込まない。ローカルの秘密値は既存の `.env.local` / `.dev.vars` の構成、本番の Worker の値は Cloudflare Secrets で管理する。
- テストのために `proxy.ts` や API の認証を無効化・弱体化しない。`/api/*` はルーティングガードの対象外なので、各 API で認可する。
- 閲覧は `site_auth`、同期はそれに加えて `site_admin` を検証する。管理者ボタンを隠すだけで権限を制御しない。Cron は `CRON_SECRET` による Bearer 認証を維持する。
- Cookie には生パスワードを保存せず、既存の派生トークンを用いる。`site_auth` / `site_admin` は `httpOnly: true`、`sameSite: "strict"`、`secure: process.env.NODE_ENV === "production"` を維持する。
- Supabase へのアクセスはサーバーのサービスロール経由とする。ブラウザ向けロールのアクセスを開放したり、RLS を無効化したりしない。

## 画像配信で守る制約

- 画像原本の保存先は Google Drive のみ。Supabase はメタデータと予備転送量の予約・精算に使う。R2、Supabase Storage、画像変換サービスへのコピーを追加しない。
- 通常の `/api/images/[fileId]` は Cookie と DB の画像登録を確認し、短命チケットを JSON で返す。画像本体はブラウザが Worker `/image` から直接取得し、Vercel や `/_next/image` を経由させない。
- ブラウザへ渡す認可情報は画像 ID・用途・寸法・有効期限に限定したチケットのみ。チケットは `Authorization` ヘッダーで送り、URL やログには含めない。Worker の署名・期限・用途の検証を維持し、CORS だけで認可しない。
- 表示には Drive のサムネイルを使い、原本は明示的な保存操作時だけ取得する。サムネイルのサイズ指定と取得は `shared/drive-media.ts` に集約し、クライアントで Google URL を書き換えたり公開 URL に依存したりしない。
- Vercel のフォールバックは Worker の通信エラー・5xx・429・上限エラー時の表示画像に限定する。401/403/404 を予備経路で回避しない。原本ダウンロードを中継しない。
- 予備転送は 1 画像 2,000,000 バイト、直近 30 日で既定 1,000,000,000 バイトの制約を維持する。DB で送信前に原子的に予約・精算し、予算切れ・DB 障害時は画像を送らない。予算 0 による無効化を維持する。
- 無限リトライを追加しない。現行の予備経路への切替は 1 回、期限切れチケットの再発行は 1 回、Worker が連続 2 回失敗した後の再試行は 5 分後。
- チケット API・画像認証エラーは `private, no-store`、Worker の表示画像はチケット期限までの private キャッシュ、予備画像は最大 5 分、ダウンロードは `no-store`。共有 CDN に画像をキャッシュしない。Worker の `Vary: Origin, Authorization` を維持する。

## 検証

変更範囲に応じて以下を実行し、失敗・未実施は理由とともに報告する。

| 変更範囲                                   | 検証コマンド                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| ドキュメントのみ                           | 変更ファイルの Prettier チェックとリンク・記述の整合性確認                                     |
| アプリのコード                             | `pnpm lint`、`pnpm exec tsc --noEmit`                                                          |
| Next.js のルート・サーバー処理・ビルド設定 | 上記に加え `pnpm build`                                                                        |
| Worker のコード・設定                      | `pnpm worker:check`、`pnpm worker:build`。型生成に影響する設定変更時は先に `pnpm worker:types` |
| `shared/`                                  | アプリと Worker の両方の検証・ビルド                                                           |

- ルートの TypeScript 設定は `workers/` を除外するため、ルートの型チェックだけでは Worker を検証できない。
- 整形確認は `pnpm exec prettier --check <変更ファイル>`。`.agents/` は通常の対象外なので、スキルは `--ignore-path /dev/null` を指定して確認する。
- 画像配信変更時は README の「検証・本番切替の確認」に沿い、未認証・不正/期限切れチケット、通常時の Worker 直接取得、予算 0、原本の予備中継拒否を確認する。
- ギャラリー変更時はページ境界（60 件目から 61 件目）、タグ切替、ライトボックス、モバイル操作、空一覧・取得失敗を確認する。キャッシュ変更時はカードの開閉・スクロール往復で重複取得と Blob URL の解放も確認する。
- `pnpm worker:build` は dry-run。`pnpm worker:deploy`、本番 DB の SQL 実行、実データを変更する同期は検証コマンドとして実行しない。
