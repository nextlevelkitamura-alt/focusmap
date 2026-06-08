# Task Board

Last updated: 2026-06-08

task-router の現在地を示す軽量ボード。詳細は各 Plan を正とし、このファイルは見出し・状態・リンク・次アクションを一覧する。

## Active

| ID | Status | Task | Plan | Scope | Owner/Chat | Branch | Next | Updated |
|---|---|---|---|---|---|---|---|---|
| TASK-20260607-004 | in_progress | Codex/Macローカル連携の一本化計画 | [plan](plans/active/20260607-codex-mac-agent-unification.md) | Mac app / focusmap-agent / Codex monitoring / task-progress UI | task-router parent chat | main | manual handoffは外部アプリ起動だけでは未送信のままに修正。次はUI read-only pollingとsync-node fallback範囲の縮小を分割実装 | 2026-06-08 |

## Waiting / Blocked

| ID | Status | Task | Plan | Blocker | Needed Decision | Updated |
|---|---|---|---|---|---|---|

## Recently Completed

直近の完了だけ最大5件。月別の正本は `docs/ai/task-archive/YYYY/MM.md`。

| ID | Completed | Task | Plan | Result |
|---|---|---|---|---|
| TASK-20260608-001 | 2026-06-08 | PC版メモ編集UIの左画像・Codexログ・下段2カラム化 | - | `WishlistCardDetail` のPC配置を画像左/メモ右、Codex依頼と簡易実行ログ、その下に時間・予定/タグの2カラムへ変更。サブタスク候補入力は通常UIから外し、Codex状態は最新 `ai_tasks` を `未送信` / `送信済み` / `実行中` / `確認待ち` / `完了` / `失敗` に丸めて表示 |
| TASK-20260607-021 | 2026-06-07 | Codex手動/自動dispatch境界の仕様ずれ修正 | [plan](plans/archive/2026/06/20260607-codex-dispatch-manual-boundary.md) | 通常のCodex導線を `dispatch_mode='manual'` に戻し、メモ詳細・マップノード詳細・リンクメモ詳細の主操作は追跡task作成、promptコピー、Codexを開くまでに限定。UI通常操作から `Macへ再送` / `dispatch_mode='auto'` へ暗黙昇格しないよう修正し、仕様文書もmanual handoff標準へ戻した |
| TASK-20260607-020 | 2026-06-07 | Focusmap Macアプリ常時Supervisor化 | [plan](plans/archive/2026/06/20260607-focusmap-mac-always-on-supervisor.md) | Macアプリ起動時にNext 3001、focusmap-agent、Codex app-serverのSupervisor化を追加。互換task-runnerの通常自動起動は後続のsingle monitor整理で停止し、スマホCloudflare URLからMac online状態を取得可能にした |
| TASK-20260607-019 | 2026-06-07 | スマホ詳細open中のCodex履歴watch同期補強 | - | 詳細open中の `task_progress_watches` をMac互換runnerが先に読み、通常巡回とは別にwatch対象taskをIDで追加取得するように変更。既存manual handoffはメモ詳細から「Macへ再送」で `dispatch_mode='auto'` へ昇格できるようにし、スマホChatGPT側の履歴を直接読めない前提もUI/docsに明記 |
| TASK-20260607-018 | 2026-06-07 | スマホCodex送信のオンラインAIタスク化とMac接続表示 | - | メモ詳細/リンクメモ詳細の主ボタンを `dispatch_mode='auto'` のオンラインAIタスク作成に寄せ、Mac runnerがCodex.appへ送る設計へ変更。スマホCodex看板ボタンにMac online/offlineを表示し、runner heartbeatは30秒読み取り/90秒判定に変更。Cloudflareスマホプレビューのdev auth許可も追加 |
