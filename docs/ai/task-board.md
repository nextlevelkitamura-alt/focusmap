# Task Board

Last updated: 2026-06-09

task-router の現在地を示す軽量ボード。詳細は各 Plan を正とし、このファイルは見出し・状態・リンク・次アクションを一覧する。

## Active

| ID | Status | Task | Plan | Scope | Owner/Chat | Branch | Next | Updated |
|---|---|---|---|---|---|---|---|---|
| TASK-20260607-004 | in_progress | Codex/Macローカル連携の一本化計画 | [plan](plans/active/20260607-codex-mac-agent-unification.md) | Mac app / focusmap-agent / Codex monitoring / task-progress UI | task-router parent chat | main | `focusmap-agent` は固定済み `codex_thread_id` を2秒監視し、Turso heartbeat/snapshotは2秒最短・変化時write、監視対象リスト取得は10秒キャッシュでSupabase readを抑える。次はUI read-only pollingとsync-node fallback範囲の縮小を分割実装 | 2026-06-09 |

## Waiting / Blocked

| ID | Status | Task | Plan | Blocker | Needed Decision | Updated |
|---|---|---|---|---|---|---|

## Recently Completed

直近の完了だけ最大5件。月別の正本は `docs/ai/task-archive/YYYY/MM.md`。

| ID | Completed | Task | Plan | Result |
|---|---|---|---|---|
| TASK-20260609-004 | 2026-06-09 | マップ右上操作とノード選択案内の整理 | - | デスクトップマップ右上は設定ボタンだけを残し、Codex snapshot更新ボタンと全画面拡大/縮小ボタンを削除。ノード選択時に下部へ出るキーボードショートカット案内を非表示にした。完了時にArcでローカルdashboardを開く運用もAGENTS.mdへ追記した |
| TASK-20260609-003 | 2026-06-09 | メモ編集シートの予定入力UI改善 | [plan](plans/archive/2026/06/20260609-memo-schedule-editor.md) | PC版メモ編集は左をメモ詳細、右を画像・時間予定へ寄せた。カレンダーはGoogle連携済みカレンダーのプルダウンにし、日時・所要時間・カレンダーが揃った時だけ予定登録/更新できる。所要時間のカスタムは時間/分ホイールにし、解除は独立ボタン化した |
| TASK-20260609-002 | 2026-06-09 | MacアプリFocusmapログインのローカル保存復元強化 | - | MacアプリのGoogle外部ブラウザログイン完了時、既存の `/api/auth/desktop-session` ポーリングに加えて `focusmap://auth-complete` deep linkでセッションを直接受け取り、pending nonce一致時だけ `auth-session.json` へ保存するようにした。全ページの `DesktopAuthSessionBridge` がダッシュボード表示後の既存セッション/トークン更新もローカル保存へ同期し、明示ログアウト時は保存セッションも削除する |
| TASK-20260609-001 | 2026-06-09 | スマホ起動時の白画面抑制と前回表示キャッシュ | - | Focusmap iOS WebViewの内部ロード面と注入前document背景を黒へ統一し、初回後は全画面ローディングへ戻さない制御を補強。`/dashboard/loading.tsx` / dynamic fallbackで暗色の `DashboardStartupFallback` を表示し、localStorage/sessionStorageのカレンダー・マップキャッシュがあれば前回相当の予定/ノードを先出し。`useMindMapSync` はプロジェクト単位のマップタスクを12時間localStorageへ保存し、キャッシュ表示後にsilent refreshでDB正へ更新する |
| TASK-20260608-005 | 2026-06-08 | マップノード詳細のフル編集UI復帰と三点直行化 | - | 前回の簡易 `メモ見出し` / `メモ詳細` UIを戻し、`WishlistCardDetail` は画像・日時・タグ・Codexを常時扱える以前のフル編集UIへ復帰。上部は見出し半幅、右側にプロジェクト/タグ操作を配置。マップノードの三点ボタンは小メニューを出さず、`CodexNodePanel` のフル編集パネルへ直接開く。`CodexNodePanel` にはタスク添付画像、日時/所要時間/カレンダーID、メモ詳細、Codex導線、右上の状態タグ領域をPC/スマホ共通で追加した |
| TASK-20260608-003 | 2026-06-08 | PC版メモ本文操作ボタンの見出し行集約 | - | `WishlistCardDetail` のメモ本文操作を、メモ見出し行右側へ `音声入力` / `見出し生成` / `コピーアイコン` の順で集約。コピーの表示文言を消し、本文枠下部は保存状態表示だけにした |
