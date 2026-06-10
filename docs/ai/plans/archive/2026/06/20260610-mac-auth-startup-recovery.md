# Macアプリ認証復元と起動失敗復旧

- Task ID: TASK-20260610-004
- Status: completed
- Created: 2026-06-10
- Completed: 2026-06-10
- Board: `docs/ai/task-board.md`

## Goal

Focusmap Macアプリが毎日ログインを求めたり、起動画面のまま止まったりする状態を減らす。

## Scope

- Macアプリの保存済みSupabaseセッション復元
- 外部ブラウザログイン後のMac側セッション受け取り
- 起動ローディング画面の失敗表示と再試行導線
- Mac agentの二重起動抑止
- `docs/CONTEXT.md`

## Result

- `auth-session.json` のrefresh tokenから起動直前にSupabaseセッションを必要時だけ更新し、`sb-*-auth-token` Cookieを固定プロファイルへ復元してから `/dashboard` を開くようにした。
- `focusmap://auth-complete` のpayloadをsnake_case / camelCase両対応にし、保存直後にCookie復元とダッシュボード復帰を試すようにした。
- ローディング画面はremote/localの表示を分け、15秒以上進まない時や読み込み失敗時に「もう一度開く」「ブラウザで開く」を出すようにした。
- 既存の `focusmap-agent` が動いている場合、Macアプリは新しいagentを重ねて起動しない。
- `/Applications/Focusmap.app` を再ビルド/再インストールし、再起動時に保存セッションからCookieが復元されることを確認した。

## Verification

- `node --check desktop/focusmap-mac/main.cjs && node --check desktop/focusmap-mac/preload.cjs`
- `npx eslint src/lib/desktop-auth-session.ts src/app/api/auth/desktop-session/route.ts src/app/auth/callback/route.ts src/app/login/page.tsx`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- in-app Browser `http://localhost:3001/dashboard`: title `ダッシュボード | Focusmap`, console errors 0
- `npm run mac:build:install`
- `/Applications/Focusmap.app` 起動後、window title `ダッシュボード | Focusmap`
- Macアプリ再起動後、`~/.focusmap/logs/desktop-app.log` に `seeded Supabase auth cookies from desktop session` を確認
- `~/Library/Application Support/focusmap-desktop-shell/auth-session.json` が `safeStorage` で保存されることを確認
- `nohup npm run dev:desktop` で `http://localhost:3001/dashboard` 200、Arcで同URLを開いた

## Notes

- `npm run mac:build:install` では既存のTurbopack dynamic fs pattern warningsが出たが、buildとinstallは成功した。
- 作業中に別タスクの `docs/ai/task-board.md` / `src/components/task-progress/task-progress-kanban.tsx` / `docs/ai/plans/active/20260610-codex-kanban-resize-card-actions.md` 差分が存在したため、今回のコミットには混ぜない。
