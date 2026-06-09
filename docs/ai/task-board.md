# Task Board

Last updated: 2026-06-09

task-router の現在地を示す軽量ボード。詳細は各 Plan を正とし、このファイルは見出し・状態・リンク・次アクションを一覧する。

## Active

| ID | Status | Task | Plan | Scope | Owner/Chat | Branch | Next | Updated |
|---|---|---|---|---|---|---|---|---|
| TASK-20260607-004 | in_progress | Codex/Macローカル連携の一本化計画 | [plan](plans/active/20260607-codex-mac-agent-unification.md) | Mac app / focusmap-agent / Codex monitoring / task-progress UI | task-router parent chat | main | 設定画面は `AI` としてMacエージェントheartbeat中心に簡素化済み。次はUI read-only pollingとsync-node fallback範囲の縮小を分割実装 | 2026-06-09 |

## Waiting / Blocked

| ID | Status | Task | Plan | Blocker | Needed Decision | Updated |
|---|---|---|---|---|---|---|

## Recently Completed

直近の完了だけ最大5件。月別の正本は `docs/ai/task-archive/YYYY/MM.md`。

| ID | Completed | Task | Plan | Result |
|---|---|---|---|---|
| TASK-20260609-008 | 2026-06-09 | 長文マップノードのメモ化とAI見出し生成 | - | 自作マップで表示上3行以上のタスクノード右下にSparklesボタンを追加。押すとタイトル全文をメモ本文へ保存し、既存メモは空行区切りで保持しつつ、同じ本文からAI見出しを生成してノードタイトルへ反映する。デスクトップ/モバイル共通UIとデータフロー、回帰テストを追加 |
| TASK-20260609-007 | 2026-06-09 | Mac agent依存同梱とTurso heartbeat復旧 | [parent plan](plans/active/20260607-codex-mac-agent-unification.md) | packaged `Focusmap.app` の `focusmap-agent` がruntime依存不足で落ちていた原因を修正。`mac:prepare-agent` で依存とbuildを必ず準備し、runner heartbeatは状態変化即時upsertと正常終了offline送信に対応。現行 `/Applications/Focusmap.app` へagent依存も反映し、Turso heartbeatでMac agent onlineを確認。Macアプリ内Codex導線は今後もmanual handoff固定 |
| TASK-20260609-006 | 2026-06-09 | AI設定画面のMacエージェント中心化 | [parent plan](plans/active/20260607-codex-mac-agent-unification.md) | 設定サイドバー/ページ名を `AI` に変更。通常表示を `/api/task-progress/runner-heartbeats` のMacエージェントheartbeat正本にし、オンライン/オフライン、最終更新、巡回状態、Codex連携だけへ簡素化。旧task-runner、Playwright/GWS説明、重複runner一覧は通常UIから外した |
| TASK-20260609-005 | 2026-06-09 | Mac/Codex接続カードのCodex Desktop未導入導線追加 | [parent plan](plans/active/20260607-codex-mac-agent-unification.md) | Focusmap Macアプリが `/Applications/Codex.app` を確認し、未導入なら `codex app` でCodex Desktopインストーラーを開く。CLIも無い場合は既定ブラウザーでOpenAI Codexページを開く。設定 > 自動化にも `要インストール` と `Codexを入れる` ボタンを追加した |
| TASK-20260609-004 | 2026-06-09 | マップ右上操作とノード選択案内の整理 | - | デスクトップマップ右上は設定ボタンだけを残し、Codex snapshot更新ボタンと全画面拡大/縮小ボタンを削除。ノード選択時に下部へ出るキーボードショートカット案内を非表示にした。完了時にArcでローカルdashboardを開く運用もAGENTS.mdへ追記した |
| TASK-20260609-003 | 2026-06-09 | メモ編集シートの予定入力UI改善 | [plan](plans/archive/2026/06/20260609-memo-schedule-editor.md) | PC版メモ編集は左をメモ詳細、右を画像・時間予定へ寄せた。カレンダーはGoogle連携済みカレンダーのプルダウンにし、日時・所要時間・カレンダーが揃った時だけ予定登録/更新できる。所要時間のカスタムは時間/分ホイールにし、解除は独立ボタン化した |
| TASK-20260609-002 | 2026-06-09 | MacアプリFocusmapログインのローカル保存復元強化 | - | MacアプリのGoogle外部ブラウザログイン完了時、既存の `/api/auth/desktop-session` ポーリングに加えて `focusmap://auth-complete` deep linkでセッションを直接受け取り、pending nonce一致時だけ `auth-session.json` へ保存するようにした。全ページの `DesktopAuthSessionBridge` がダッシュボード表示後の既存セッション/トークン更新もローカル保存へ同期し、明示ログアウト時は保存セッションも削除する |
