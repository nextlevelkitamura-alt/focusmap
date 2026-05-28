# Cloud Run デプロイ情報

## 本番環境

| 項目 | 値 |
|---|---|
| **Service URL** | https://shikumika-app-364jgme3ja-an.a.run.app |
| **GCP プロジェクト** | `shikumika-app` (466617344999) |
| **リージョン** | `asia-northeast1` (東京) |
| **Node.js** | 22 (Alpine) |
| **メモリ / CPU** | 512Mi / 1 vCPU |
| **インスタンス** | 0〜10 (min 0 で無料枠最大活用) |

## 外部サービス設定

### Supabase (Authentication → URL Configuration)
- **Site URL**: `https://shikumika-app-364jgme3ja-an.a.run.app`
- **Redirect URLs**: `https://shikumika-app-364jgme3ja-an.a.run.app/**`

### Google Cloud Console (OAuth 2.0 クライアント)
- **承認済みの JavaScript 生成元**: `https://shikumika-app-364jgme3ja-an.a.run.app`
- **承認済みのリダイレクト URI**:
  - `https://shikumika-app-364jgme3ja-an.a.run.app/api/calendar/callback` (本番カレンダー連携用)
  - `http://localhost:3001/api/calendar/callback` (ローカル開発用)
  - `https://whsjsscgmkkkzgcwxjko.supabase.co/auth/v1/callback` (Supabase Auth用)

### Cloud Run 環境変数（必須）
- `NEXTAUTH_URL=https://shikumika-app-364jgme3ja-an.a.run.app`
- `NEXTAUTH_SECRET=<固定値>`
- `GOOGLE_CLIENT_ID=<Google OAuth Client ID>`
- `GOOGLE_CLIENT_SECRET=<Google OAuth Client Secret>`
- `GOOGLE_REDIRECT_URI=https://shikumika-app-364jgme3ja-an.a.run.app/api/calendar/callback`

---

## 本番デプロイ運用ルール

本番 Cloud Run は **origin/main の内容だけをデプロイする**。

今回のように「別の場所で main からデプロイしたら機能が消える」事故は、ローカルの feature ブランチや未pushコミットを手動デプロイした後、古い `origin/main` の自動デプロイで上書きされることで起きる。

### 原則
- 機能が動いたら必ず commit する。
- 本番に出す前に `main` へ fast-forward/merge する。
- `git push origin main` を本番デプロイの起点にする。
- Cloud Run に直接デプロイする場合も、クリーンな `main` かつ `HEAD == origin/main` の状態だけ許可する。
- feature ブランチや未コミット差分を本番に直接出さない。

### 推奨フロー
```bash
git status
npm run build
npm test -- <関連テスト>
git checkout main
git merge --ff-only <作業ブランチ>
git push origin main
```

`origin/main` への push 後、GitHub Actions の `Deploy to Cloud Run` が自動で本番へ反映する。

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
