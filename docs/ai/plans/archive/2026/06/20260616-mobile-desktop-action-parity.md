# スマホ詳細シートのPC導線追従

- Task ID: TASK-20260616-003
- Status: completed
- Created: 2026-06-16
- Completed: 2026-06-16
- Board: `docs/ai/task-board.md`

## Goal

PC側にあるノード/メモ詳細の予定化、Codex送信、進捗確認、再コピー系の導線を、スマホでも同じFocusmapの見た目と密度で使えるようにする。

## Scope

- スマホのマップ/メモ詳細シート
- 予定化/カレンダー選択/所要時間導線
- Codex handoff、再コピー、状態表示
- 必要な `docs/CONTEXT.md` 更新

## Non-goals

- 新しいDBスキーマ追加
- Codex auto dispatch の追加
- PC UIの大幅な再設計
- ユーザー明示なしのテスト/ブラウザ検証実行

## Plan

1. PC側で成立している予定化・Codex送受信導線を確認する。
2. スマホ側で欠けているUI/props/イベント接続を特定する。
3. 既存コンポーネントとデザイントークンを優先してスマホ下部シートへ移植する。
4. 仕様変更があれば `docs/CONTEXT.md` に追記する。
5. 差分確認後、自分の作業分だけコミットする。

## Parallelization

SINGLE_CHAT。UI導線と状態表示が同じコンポーネント周辺に集中し、複数worktreeに分けると解釈差と統合コストが高い。

## Verification

ユーザー明示がないため自動テスト、lint、build、ブラウザ確認は実行しない。差分確認のみ行った。

## Result

スマホ `MobileMindMap` から開く `CodexNodePanel` にも、デスクトップと同じ `onSaveTaskDetails` を接続した。これにより、所要時間、カレンダー、Google予定同期後の `scheduled_at` / `calendar_id` / `google_event_id` がPC導線と同じ親task stateへ即時反映される。回帰テストを追加し、`docs/CONTEXT.md` にスマホ詳細シートも同じ保存経路を使う仕様を追記した。

## Links
