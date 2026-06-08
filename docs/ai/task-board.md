# Task Board

Last updated: 2026-06-09

task-router の現在地を示す軽量ボード。詳細は各 Plan を正とし、このファイルは見出し・状態・リンク・次アクションを一覧する。

## Active

| ID | Status | Task | Plan | Scope | Owner/Chat | Branch | Next | Updated |
|---|---|---|---|---|---|---|---|---|
| TASK-20260607-004 | in_progress | Codex/Macローカル連携の一本化計画 | [plan](plans/active/20260607-codex-mac-agent-unification.md) | Mac app / focusmap-agent / Codex monitoring / task-progress UI | task-router parent chat | main | `focusmap-agent` が固定済み `codex_thread_id` を3秒監視し、追加プロンプトを `running` へ戻す経路を追加。次はUI read-only pollingとsync-node fallback範囲の縮小を分割実装 | 2026-06-09 |

## Waiting / Blocked

| ID | Status | Task | Plan | Blocker | Needed Decision | Updated |
|---|---|---|---|---|---|---|

## Recently Completed

直近の完了だけ最大5件。月別の正本は `docs/ai/task-archive/YYYY/MM.md`。

| ID | Completed | Task | Plan | Result |
|---|---|---|---|---|
| TASK-20260609-001 | 2026-06-09 | スマホ起動時の白画面抑制と前回表示キャッシュ | - | Focusmap iOS WebViewの内部ロード面と注入前document背景を黒へ統一し、初回後は全画面ローディングへ戻さない制御を補強。`/dashboard/loading.tsx` / dynamic fallbackで暗色の `DashboardStartupFallback` を表示し、localStorage/sessionStorageのカレンダー・マップキャッシュがあれば前回相当の予定/ノードを先出し。`useMindMapSync` はプロジェクト単位のマップタスクを12時間localStorageへ保存し、キャッシュ表示後にsilent refreshでDB正へ更新する |
| TASK-20260608-005 | 2026-06-08 | マップノード詳細のフル編集UI復帰と三点直行化 | - | 前回の簡易 `メモ見出し` / `メモ詳細` UIを戻し、`WishlistCardDetail` は画像・日時・タグ・Codexを常時扱える以前のフル編集UIへ復帰。上部は見出し半幅、右側にプロジェクト/タグ操作を配置。マップノードの三点ボタンは小メニューを出さず、`CodexNodePanel` のフル編集パネルへ直接開く。`CodexNodePanel` にはタスク添付画像、日時/所要時間/カレンダーID、メモ詳細、Codex導線、右上の状態タグ領域をPC/スマホ共通で追加した |
| TASK-20260608-003 | 2026-06-08 | PC版メモ本文操作ボタンの見出し行集約 | - | `WishlistCardDetail` のメモ本文操作を、メモ見出し行右側へ `音声入力` / `見出し生成` / `コピーアイコン` の順で集約。コピーの表示文言を消し、本文枠下部は保存状態表示だけにした |
| TASK-20260608-002 | 2026-06-08 | PC版メモ編集UIの下段配置と時刻Popover修正 | - | `WishlistCardDetail` のPC下段を左に時間・予定、右にCodex送信/ログ、最下段にタグ1列へ再配置。画像/時間/Codex/タグの見出しを外側に出し、画像ヘッダー右の追加ボタンを削除。画像追加後のサムネイルは追加タイルより上に出す。Codex送信payloadは見出しとメモ本文だけに戻し、PCの日付/時刻Popoverは上方向表示、時刻ホイールは二本指/マウスホイール操作で確定できるようにした |
| TASK-20260608-001 | 2026-06-08 | PC版メモ編集UIの左画像・Codexログ・下段2カラム化 | - | `WishlistCardDetail` のPC配置を画像左/メモ右、Codex依頼と簡易実行ログ、その下に時間・予定/タグの2カラムへ変更。サブタスク候補入力は通常UIから外し、Codex状態は最新 `ai_tasks` を `未送信` / `送信済み` / `実行中` / `確認待ち` / `完了` / `失敗` に丸めて表示 |
