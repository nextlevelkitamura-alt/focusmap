# Codex看板の高さ調整とカード完了/削除操作

- Task ID: TASK-20260610-003
- Status: completed
- Created: 2026-06-10
- Completed: 2026-06-10
- Board: `docs/ai/task-board.md`

## Goal

デスクトップのCodex看板をドラッグで上へ広げられるようにし、看板カードから元マップノードを完了チェック・削除できるようにする。

## Scope

- `src/components/task-progress/task-progress-kanban.tsx`
- マップ側の `TaskProgressKanban` 呼び出しと既存タスク更新/削除ハンドラ
- 必要なテスト
- `docs/CONTEXT.md`

## Non-goals

- Codex runner / Mac agent の監視ロジック変更
- 新しいDBテーブルやschema migration
- React Flow版の置き換え

## Plan

1. 既存の看板propsとマップ側のタスク更新/削除ハンドラを確認する。
2. デスクトップ看板に上端ドラッグリサイズを追加し、広げた高さをlocalStorageへ保存する。
3. カード左側に完了チェック、右側に削除ボタンを追加し、元マップノードの `status=done` / 削除処理へ委譲する。
4. 操作後の看板表示・ノード除外・完了済みレーンの挙動をテストする。
5. `docs/CONTEXT.md` とtask-router記録を更新する。

## Parallelization

SINGLE_CHAT。Codex看板、マップタスク状態、既存完了/削除契約が密結合なので、実装分割せず同じチャットで確認する。

## Verification

- `npm test -- --run src/components/task-progress/task-progress-kanban.test.tsx`
- `npx eslint src/components/task-progress/task-progress-kanban.tsx src/components/task-progress/task-progress-kanban.test.tsx src/components/dashboard/mind-map.tsx src/components/mobile/mobile-mind-map.tsx`
- `npx tsc --noEmit`
- in-app Browser `http://localhost:3001/dashboard?desktop=1&source=mac&taskProgressFixture=1` で看板表示、カードの完了/削除/詳細ボタン、上端ドラッグによる高さ 260px -> 400px を確認
- `npm run lint` は既存の全体lintエラーで失敗

## Result

- デスクトップCodex看板に上端ドラッグの高さ調整を追加し、表示高さをlocalStorageに保存するようにした。
- Codex看板カードに元ノードの完了チェックと削除ボタンを追加し、既存のノード完了/削除ハンドラへ委譲した。
- モバイル看板でも同じカード操作を使えるようにした。

## Links

- `docs/CONTEXT.md`
