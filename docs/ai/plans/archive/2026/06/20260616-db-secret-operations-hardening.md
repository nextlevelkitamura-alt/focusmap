# DB / Secret Operations Hardening

- Task ID: TASK-20260616-001
- Status: completed
- Created: 2026-06-16
- Completed: 2026-06-16
- Board: `docs/ai/task-board.md`

## Goal

DB / secret 周りの運用改善を、既存機能を止めない順序で進める。

## Scope

- tracked docs に残っている Supabase access token / service role key の実値を削除する。
- 今後の git 混入を検出する軽量 secret scan を追加する。
- Cloud Run / GitHub Secrets / local env / Mac desktop env の更新順を docs に固定する。
- 既存 runtime の DB 接続挙動は、このタスクでは変更しない。

## Non-goals

- Supabase dashboard での key rotation 実行。
- GitHub Secrets / Cloud Run runtime env の実値更新。
- git history rewrite。
- `NEXT_PUBLIC_SUPABASE_*` fallback の削除。
- Supabase 型生成や migration 適用。

## Plan

1. Supabase 管理トークンと service role key の実値を docs から除去する。
2. `scripts/check-no-secrets.mjs` と GitHub Actions の secret scan を追加する。
3. 無停止に近い rotation 手順を `docs/DEPLOY_CLOUDRUN.md` / `docs/CONTEXT.md` に記録する。
4. 変更範囲を確認し、外部で必要な作業を明確に残す。

## Parallelization

SEQUENTIAL。secret / auth / DB 接続は更新順の事故が大きいため、並列実装しない。

## Verification

AGENTS.md の自動検証ポリシーに従い、test / lint / build / secret scan 実行は行っていない。
差分確認と、今回触った主要ファイル内の Supabase access token / JWT形式実値の残存検索のみ実施。

## Result

tracked docsからSupabase access token / service role keyの実値を除去し、環境変数参照へ置換した。
`scripts/check-no-secrets.mjs` と GitHub Actions `Secret Scan` を追加し、README / Cloud Run docs / CONTEXTへ無停止に近いrotation順を記録した。
runtime接続挙動、Supabase dashboardでのkey rotation、GitHub Secrets実値更新、git history rewriteは未実施。

## Links

- `docs/SUPABASE_CLI.md`
- `docs/plans/handoff-ideal-self.md`
- `docs/DEPLOY_CLOUDRUN.md`
- `docs/CONTEXT.md`
