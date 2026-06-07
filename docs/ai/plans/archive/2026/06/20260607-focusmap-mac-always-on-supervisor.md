# Focusmap Macアプリ常時Supervisor化

- Task ID: `TASK-20260607-020`
- Status: `completed`
- Created: `2026-06-07`
- Parent: `TASK-20260607-004`
- Branch: `main`

## 目的

Codex.app Remote Controlと同じ使用感に近づける。Macをスリープさせず、Focusmap Macアプリを開いておけば、Next 3001、Codex app-server、Focusmap agent/runnerがローカルで生き続け、スマホ/Cloudflare側から作ったCodex taskをMacが拾って状態を書き戻せる状態にする。

スマホ側はMac内のsqlite/rolloutやファイルを直接読まない。スマホからの操作はSupabase/Tursoへ「指示」「watch」「状態確認要求」として置き、スリープしていないMac側のFocusmap SupervisorだけがローカルCodex.app、`~/.codex/state_5.sqlite`、rollout JSONLを読み、トークン/ログ量を抑えた状態・可視チャット断片だけを書き戻す。

## 現状の停止点

- `scripts/task-runner.paused` が残ると、launchd runnerは毎回即終了し、Codex sqlite/rollout監視とtask claimが止まる。
- `focusmap-agent` launchdは `~/.focusmap/config.json` の `api_url=https://focusmap-official.com/api` に向いており、production API側の `SUPABASE_SERVICE_ROLE_KEY is not set` で登録に失敗している。
- Macアプリの設定カードは手動接続ボタンを持つが、Macアプリ起動時に自動で接続・復旧する常時Supervisor挙動ではない。
- Turso未設定時、`/api/task-progress/runner-heartbeats` は空を返すため、スマホUIはMacが起きていてもrunner onlineを見られない。

## 受け入れ条件

- Macアプリ起動時、ローカルNext、Codex app-server、focusmap-agentを自動確認し、可能なら起動する。
- Macアプリから起動するagentは、ローカルdev中は `http://localhost:3001/api` を優先して使い、ローカル `.env.local` のAPI設定と整合する。
- `task-runner.paused` はstatus上で明示され、Macアプリの接続操作で安全に解除できる。解除後にrunnerを1回kickできる。
- 設定 > 自動化カードで、agent、Codex app-server、legacy runner pause状態、heartbeat sourceを見られる。
- スマホから作ったCodex taskや詳細open watchは、Macが起きていてSupervisor/agent/runnerが動いていればMac側で拾える。Macが完全スリープ中、またはMac側常駐プロセスが一切無い状態から、スマホ単体でMacアプリを起動できるとは扱わない。
- 本番Cloud Run/通常ブラウザ/スマホからローカルMacを起動停止するAPIは追加しない。
- secret値はdocs/log/statusへ出さない。

## 作業方針

- 実装は単一チャットで統合する。readonly explorer 2本でMac supervisorとagent/runnerの既存構造だけ調査する。
- MacアプリのElectron IPCだけにローカル制御を閉じる。
- launchd plistやユーザー環境を破壊的に変更せず、Macアプリ管理下のchild processを標準経路にする。
- 既存 `task-runner.ts` のCodex監視は今回すぐ移管しない。pause解除/kickと状態表示を先に入れる。

## 検証

- `node --check desktop/focusmap-mac/main.cjs && node --check desktop/focusmap-mac/preload.cjs`
- `npm run lint -- src/components/settings/automation-settings.tsx`
- `git diff --check`
- 可能なら `npm run mac:dev` または直接IPC相当の状態確認で、Next/Codex/agent/runner statusを確認する。

## 完了メモ

- Macアプリ起動時に `startAutomationSupervisor('app-ready')` を実行し、Next 3001、focusmap-agent、Codex app-server、互換 `task-runner` を自動確認するようにした。
- Electron `powerSaveBlocker` で `prevent-app-suspension` を開始し、明示的な切断時だけSupervisor/keep-awake/管理child processを止める。
- `focusmap-agent` はMacアプリ管理下ではruntime configでローカル `http://127.0.0.1:3001/api` / `http://localhost:3001/api` を優先する。
- `/api/task-progress/runner-heartbeats` はTurso未設定または設定エラー時にSupabase `ai_runners` へfallbackする。POST fallbackも `last_heartbeat_at` と `metadata.current_task_id` を更新する。
- `focusmap-agent` のGoogle Drive/CloudStorage capability収集にtimeoutを入れ、権限確認で詰まってもrunner登録・heartbeatが止まらないようにした。
- production Cloud Run deployに `SUPABASE_SERVICE_ROLE_KEY` secret参照を追加し、agent token検証が本番APIで落ちないようにした。
- このMacでは旧 `com.focusmap.agent` / `com.focusmap.task-runner` をunload済み。Codex app-serverは既存 `com.focusmap.codex-app-server` が稼働中。

## 実行確認

- `node --check desktop/focusmap-mac/main.cjs`
- `node --check desktop/focusmap-mac/preload.cjs`
- `npm run lint -- src/components/settings/automation-settings.tsx src/lib/external-auth-launch.ts src/app/api/task-progress/runner-heartbeats/route.ts src/components/workspace/agent-install-panel.tsx scripts/task-runner.ts`
- `npm --prefix scripts/focusmap-agent run build`
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- `npm run codex-monitoring:migrate-turso`
- `curl -I http://localhost:3001/dashboard/settings/automation` → 200
- Cloudflare `https://editorial-discretion-spy-dancing.trycloudflare.com/dashboard?desktop=1&view=map` → 200
- `/api/task-progress/runner-heartbeats?limit=3` → `source=supabase`, `naonomac-playwright.local` / `naonomac.local` が `online`
