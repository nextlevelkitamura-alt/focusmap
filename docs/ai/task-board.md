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
| TASK-20260608-004 | 2026-06-08 | メモ詳細UIのマップ風統一とノードメニュー重なり修正 | - | `WishlistCardDetail` をPC/スマホ共通でマップの詳細パネル風に寄せ、通常画面を `メモ見出し` / `メモ詳細` / `保存して閉じる` に整理。プロジェクト・画像・時間・タグ・Codexログは三本線メニューで一括展開し、主ボタン文言を `Codexを開く` に変更。自作マップのノードメニューは開いたノードごと前面化して下のノードに潜らないようにした |
| TASK-20260608-003 | 2026-06-08 | PC版メモ本文操作ボタンの見出し行集約 | - | `WishlistCardDetail` のメモ本文操作を、メモ見出し行右側へ `音声入力` / `見出し生成` / `コピーアイコン` の順で集約。コピーの表示文言を消し、本文枠下部は保存状態表示だけにした |
| TASK-20260608-002 | 2026-06-08 | PC版メモ編集UIの下段配置と時刻Popover修正 | - | `WishlistCardDetail` のPC下段を左に時間・予定、右にCodex送信/ログ、最下段にタグ1列へ再配置。画像/時間/Codex/タグの見出しを外側に出し、画像ヘッダー右の追加ボタンを削除。画像追加後のサムネイルは追加タイルより上に出す。Codex送信payloadは見出しとメモ本文だけに戻し、PCの日付/時刻Popoverは上方向表示、時刻ホイールは二本指/マウスホイール操作で確定できるようにした |
| TASK-20260608-001 | 2026-06-08 | PC版メモ編集UIの左画像・Codexログ・下段2カラム化 | - | `WishlistCardDetail` のPC配置を画像左/メモ右、Codex依頼と簡易実行ログ、その下に時間・予定/タグの2カラムへ変更。サブタスク候補入力は通常UIから外し、Codex状態は最新 `ai_tasks` を `未送信` / `送信済み` / `実行中` / `確認待ち` / `完了` / `失敗` に丸めて表示 |
| TASK-20260607-021 | 2026-06-07 | Codex手動/自動dispatch境界の仕様ずれ修正 | [plan](plans/archive/2026/06/20260607-codex-dispatch-manual-boundary.md) | 通常のCodex導線を `dispatch_mode='manual'` に戻し、メモ詳細・マップノード詳細・リンクメモ詳細の主操作は追跡task作成、promptコピー、Codexを開くまでに限定。UI通常操作から `Macへ再送` / `dispatch_mode='auto'` へ暗黙昇格しないよう修正し、仕様文書もmanual handoff標準へ戻した |
