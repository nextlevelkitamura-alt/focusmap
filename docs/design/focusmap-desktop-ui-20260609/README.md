# Focusmap desktop UI mockups - 2026-06-09

目的: 現行のマップ / メモ / AI実行 / Codex看板 / カレンダーを前提に、デスクトップで「俯瞰・承認・計画」を早くするUI案を3つ作る。

## 調査メモ

- プロダクトの軸は `docs/plans/focusmap-pivot.md` の「AIが働き、人間が舵を取る」。
- 現行実装では `src/app/dashboard/dashboard-client.tsx` が `Todo` / `メモ` / `マップ` / `チャット` / `設定` を切り替え、`src/components/dashboard/mind-map.tsx` が自作マップ、Codexノードパネル、Codex看板、進捗詳細を束ねている。
- `src/components/mindmap/custom-mind-map-view.tsx` にはノード上のCodex状態バッジ、複数選択、ドラッグ、折りたたみがある。
- `src/components/codex/codex-node-panel.tsx` と `src/components/task-progress/*` には、確認待ち、実行中、未送信、接続失敗、チャット風ログ、再コピー、Codex起動がある。
- `WishlistView` / `MemoToMindmapDialog` / カレンダー分割により、メモからマップ化して予定へ落とす導線がある。
- 今回の環境ではOS Screen Recording権限が無く、実デスクトップ画面のスクリーンショットは取得できなかった。in-appブラウザでは未ログインのローカル画面だけ取得できた。

## モックアップ案

### 1. Morning Command Center

ファイル: `mockup-01-morning-command-center.png`

朝に開く俯瞰画面。中央をマップに固定し、右に確認キュー、下にAI実行パルスを置く。ユーザーは「どれを承認するか」「AIが何をしているか」「今日の判断は何か」を1画面で見られる。

### 2. Approval Review Mode

ファイル: `mockup-02-approval-review-mode.png`

確認待ちノードを開いた状態。Codex出力、根拠、変更プレビュー、人間の判断、追加指示、承認/修正/却下、予定化を1つの作業面にまとめる。目的は、確認待ちを安全に短時間で処理すること。

### 3. Memo to Map Planning Mode

ファイル: `mockup-03-memo-to-map-planning.png`

未整理メモをAIで分類し、マップ候補とカレンダー配置候補へ変換する状態。左にメモ、中央に生成プレビュー、右に今日の余白と予定、下に反映前の候補/除外/既存ノード紐付けを置く。

## 次に検討する機能

- マップ上部に常時表示するAI状態サマリー: 実行中、未送信、確認待ち、接続失敗。
- 右側の確認キュー: `awaiting_approval` / `needs_input` だけを優先表示し、承認・修正指示・却下を近接配置する。
- ノード詳細のレビュー面: Codexログ全文ではなく、要約、根拠、変更差分、リスク、追加指示に分解する。
- メモからマップ生成の反映前プレビュー: 生成候補、除外、既存ノードへの紐付けを反映前に選べるようにする。
- カレンダー連携: 承認後に自動で予定化するか、空き時間候補だけ出すかを選べるようにする。
