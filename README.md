# Focusmap

AIが管理・実行し、人間は俯瞰・承認するダッシュボード。

## Local Development

```bash
npm run dev
```

ローカルWebは `http://localhost:3001` 固定で使う。3001が埋まっている場合は別ポートへ逃がさず、古いNext dev serverを確認して再起動する。

必要な環境変数は `.env.example` を元に `.env.local` へ置く。`.env.local`、`.env.monitoring.local`、service role key、access token、JWT secret、GCP service account JSONはコミットしない。

## Production

本番は Cloud Run。`origin/main` への push 後、GitHub Actions が Docker build と Cloud Run deploy を行う。

`NEXT_PUBLIC_SUPABASE_ANON_KEY` はNext.jsのビルド時にクライアントJSへ埋め込まれるため、Supabase key rotation後はGitHub Secrets更新だけでなく、Cloud Runの再ビルド/再デプロイが必要。

## Database / Monitoring

- Main DB: Supabase PostgreSQL
- High-frequency Codex progress: Turso/libSQL
- Screenshot preview objects: Cloudflare R2
- Google Calendar actual events: Google Calendar

DB境界と運用詳細は `docs/CONTEXT.md`、Cloud Run設定は `docs/DEPLOY_CLOUDRUN.md`、Supabase CLI/Management API手順は `docs/SUPABASE_CLI.md` を参照。

## Safety Checks

```bash
npm run security:secrets
```

tracked files に Supabase personal access token、Supabase `service_role` JWT、private key PEM が混入していないか確認する。GitHub Actions の `Secret Scan` も `main` push / pull request で同じチェックを実行する。
