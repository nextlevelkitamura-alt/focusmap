# Cloud Run デプロイ情報

## 本番環境

| 項目 | 値 |
|---|---|
| **公開URL** | https://focusmap-official.com |
| **Cloud Run Service URL** | https://shikumika-app-364jgme3ja-an.a.run.app |
| **GCP プロジェクト** | `shikumika-app` (466617344999) |
| **リージョン** | `asia-northeast1` (東京) |
| **Node.js** | 22 (Alpine) |
| **メモリ / CPU** | 512Mi / 1 vCPU |
| **インスタンス** | 0〜10 (min 0 で無料枠最大活用) |

## 外部サービス設定

### Supabase (Authentication → URL Configuration)
- **Site URL**: `https://focusmap-official.com`
- **Redirect URLs**:
  - `https://focusmap-official.com/**`
  - `https://shikumika-app-364jgme3ja-an.a.run.app/**`（Cloud Run直接URLで確認する場合の予備）

### Google Cloud Console (OAuth 2.0 クライアント)
- **承認済みの JavaScript 生成元**: `https://focusmap-official.com`
- **承認済みのリダイレクト URI**:
  - `https://focusmap-official.com/api/calendar/callback` (本番カレンダー連携用)
  - `https://shikumika-app-364jgme3ja-an.a.run.app/api/calendar/callback` (Cloud Run直接URLで確認する場合の予備)
  - `http://localhost:3001/api/calendar/callback` (ローカル開発用)
  - `https://whsjsscgmkkkzgcwxjko.supabase.co/auth/v1/callback` (Supabase Auth用)

### Cloud Run 環境変数（必須）
- `NEXTAUTH_URL=https://focusmap-official.com`
- `NEXTAUTH_SECRET=<固定値>`
- `SUPABASE_SERVICE_ROLE_KEY=<Supabase service role key>`（agent token検証・runner heartbeat登録用。GitHub Secrets経由で渡す）
- `GOOGLE_CLIENT_ID=<Google OAuth Client ID>`
- `GOOGLE_CLIENT_SECRET=<Google OAuth Client Secret>`
- `GOOGLE_REDIRECT_URI=https://focusmap-official.com/api/calendar/callback`

### Codex監視/Turso/R2 環境変数

Codex監視の軽量progressとスクショpreviewを有効にする場合は、GitHub Secretsに以下を入れる。
未設定でも既存Supabase fallbackで起動するが、Turso/R2側の新APIは503を返す。

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_SCREENSHOT_BUCKET`
- `FOCUSMAP_TURSO_ACTIVITY_PRIMARY=1`
- `FOCUSMAP_TURSO_OBSERVATIONS_PRIMARY=1`

`FOCUSMAP_TURSO_ACTIVITY_PRIMARY` / `FOCUSMAP_TURSO_OBSERVATIONS_PRIMARY` は非secretの固定値としてGitHub Actionsと `deploy-cloudrun.sh` からCloud Runへ渡す。手動で `gcloud run services update --update-env-vars ...` だけ実行すると、次回のGitHub Actions deployで消える可能性があるため、永続化が必要なenvはdeploy設定にも必ず入れる。

ローカルで値を取得したら、リポジトリ直下の `.env.monitoring.local` に同名で一時保存し、以下を実行する。
`.env.monitoring.local` は `.env*` ignore対象なのでコミットしない。

```bash
npm run codex-monitoring:set-secrets
npm run codex-monitoring:migrate-turso
```

`codex-monitoring:set-secrets` は `gh secret set` でGitHub Secretsへ登録する。値は標準出力へ表示しない。
`codex-monitoring:migrate-turso` は `db/turso/migrations/20260605000000_codex_monitoring.sql` をTursoへ適用する。

### Supabase secret rotation / 漏洩対応

tracked docs やチャットに Supabase access token / service role key / JWT secret を貼らない。
漏洩または漏洩疑いがある場合は、アプリ停止を避けるため次の順番で進める。

1. Supabase dashboard で新しい `anon` / `service_role` / JWT関連設定を取得する。旧値はまだ無効化しない。
2. GitHub Secrets の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` を新値へ更新する。
3. ローカル `.env.local`、Macアプリ用 `~/.focusmap/desktop.env`、必要なら `.env.monitoring.local` も新値へ更新する。
4. `NEXT_PUBLIC_SUPABASE_ANON_KEY` はNext.jsのビルド時にクライアントJSへ埋め込まれるため、`git push origin main` でGitHub ActionsのCloud Run再ビルド/再デプロイを通す。手動Cloud Run env更新だけでは古いビルド済みJSが残る。
5. Focusmap Macアプリや常駐agentがローカルenvを読む場合は、再起動して新値を読ませる。
6. 本番ログイン、Google Calendar callback、agent heartbeat、`/api/v1/*` API key認証、Stripe webhook、task-runner系のservice role依存機能を確認する。
7. 新値で動くことを確認してから、Supabase dashboard 側で旧値を失効する。

このリポジトリ側で行えるのは、実値をtracked filesから消すこと、GitHub Actionsのsecret scanを通すこと、運用手順を残すことまで。Supabase dashboardでの実際のkey rotation、GitHub Secretsへの実値登録、必要なgit history rewriteは外部作業として扱う。

tracked files に混入しやすい値は `npm run security:secrets` で確認できる。GitHub Actionsの `Secret Scan` も `main` push / pull request で同じチェックを実行する。

---

## 本番デプロイ運用ルール

本番 Cloud Run は **origin/main の内容だけをデプロイする**。

今回のように「別の場所で main からデプロイしたら機能が消える」事故は、ローカルの feature ブランチや未pushコミットを手動デプロイした後、古い `origin/main` の自動デプロイで上書きされることで起きる。

### 原則
- 機能が動いたら必ず commit する。
- 小さな修正は `main` に直接コミットしてよい。毎回ブランチを切らない。
- 大きな機能、破壊的変更、本番に出すタイミングを分けたい変更だけブランチを使う。
- ブランチで作業した場合は、本番に出す前に `main` へ fast-forward/merge する。
- `git push origin main` を本番デプロイの起点にする。
- Cloud Run に直接デプロイする場合も、クリーンな `main` かつ `HEAD == origin/main` の状態だけ許可する。
- feature ブランチや未コミット差分を本番に直接出さない。
- `main` が `origin/main` より ahead の状態では、ローカルで見えている変更はまだ本番デプロイ対象ではない。

### 推奨フロー

小さな修正:

```bash
git fetch --prune origin
git status --short --branch
npm run build
git add <自分が触ったファイル>
git commit -m "<変更内容>"
git push origin main
```

ブランチを使った変更:

```bash
git fetch --prune origin
git status --short --branch
npm run build
npm test -- <関連テスト>
git checkout main
git merge --ff-only <作業ブランチ>
git push origin main
```

`origin/main` への push 後、GitHub Actions の `Deploy to Cloud Run` が自動で本番へ反映する。
GitHub Actionsは `TURSO_*` / `R2_*` のSecretsが存在すればCloud Run runtime envへ渡す。Codex監視履歴のTurso primary化env（`FOCUSMAP_TURSO_ACTIVITY_PRIMARY=1` / `FOCUSMAP_TURSO_OBSERVATIONS_PRIMARY=1`）も同じdeployで渡す。

### 手動デプロイ
通常は使わない。使う場合も以下の条件を `deploy-cloudrun.sh` が検査する。

- 現在ブランチが `main`
- 未コミット/未追跡の変更がない
- ローカル `HEAD` が `origin/main` と一致している

緊急時の上書き用に `ALLOW_NON_MAIN_DEPLOY=1` / `ALLOW_DIRTY_DEPLOY=1` / `ALLOW_UNPUSHED_DEPLOY=1` は残しているが、使った場合は直後に必ず `main` へ同じコミットを push する。

## デプロイ手順

### 前提条件
- Google Cloud SDK (`gcloud`) インストール済み
- Docker は不要 (Cloud Build がクラウド上でビルド)

### 通常デプロイ

```bash
git push origin main
gh run watch --repo nextlevelkitamura-alt/focusmap "$(gh run list --repo nextlevelkitamura-alt/focusmap --branch main --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

### 例外的な手動デプロイ

```bash
git checkout main
git pull --ff-only origin main
./deploy-cloudrun.sh
```

### 重要: NEXT_PUBLIC_* 変数について
`NEXT_PUBLIC_*` 環境変数は Next.js がビルド時に JS へ埋め込むため、**ランタイムでは上書きできない**。
必ず `cloudbuild.yaml` の `--substitutions` でビルド引数として渡すこと。

---

## 運用コマンド

```bash
# ログ確認
gcloud run logs read shikumika-app --region asia-northeast1

# サービス詳細
gcloud run services describe shikumika-app --region asia-northeast1

# 環境変数確認
gcloud run services describe shikumika-app \
  --region asia-northeast1 \
  --format 'value(spec.template.spec.containers[0].env)'
```

## コスト
無料枠: 月200万リクエスト、360,000 vCPU秒、180,000 GiB秒
