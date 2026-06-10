# マップノードのカレンダーD&D予定化

- Task ID: TASK-20260610-006
- Status: completed
- Created: 2026-06-10
- Completed: 2026-06-10
- Board: `docs/ai/task-board.md`

## Goal

マップ上のノードを右ペインの日次カレンダーへドラッグし、ドロップした時間に予定登録できるようにする。ドラッグ中は、マップ領域ではノード形状、カレンダー領域へ入ったら予定カード形状へ滑らかに変わり、戻るとノード形状へ戻る。

## Scope

- デスクトップのダッシュボード内マップ/日次カレンダー間D&D。
- 既存のタスク予定化・Google Calendar同期フローを再利用する。
- 今日のメモとカレンダー登録時の操作感に寄せる。
- ドラッグ中の視覚フィードバック、drop preview、失敗時の戻し。
- 関連する `docs/CONTEXT.md` 仕様更新。

## Non-goals

- DBスキーマ変更。
- 新しいカレンダーAPI契約の追加。
- React Flow版マップの置き換え。
- モバイル長押しD&Dの本格追加。

## Plan

1. 既存のメモ/タスクからカレンダーへ予定化するD&Dと同期処理を調査する。完了。
2. マップノードをdrag sourceにし、task id/title/duration/calendar idなどの最小データを渡す。完了。
3. 日次カレンダー側でdrag over/dropを受け、時刻previewと楽観的予定化を既存更新処理へ接続する。完了。
4. ドラッグ中の共有overlayを追加し、カレンダー領域内外でノードUI/予定UIを切り替える。完了。
5. lint/typecheck/実画面で確認し、docsとtask-router記録を更新する。完了。

## Parallelization

Decision: SINGLE_CHAT

Reason: マップノード、日次カレンダー、既存タスク予定化のUI契約が密結合で、同じコンポーネント群をまたいで調整する必要があるため。並列化するとdrag payloadや楽観更新の解釈が割れやすい。

## Verification

- `npx eslint src/lib/calendar-constants.ts src/components/mindmap/custom-mind-map-view.tsx src/components/today/today-timeline-calendar.tsx src/components/dashboard/desktop-today-panel.tsx`
- `npm run test:run -- src/components/mindmap/custom-mind-map-view.test.tsx`
- `npm run test:run -- src/components/today/today-timeline-calendar.test.tsx`
- `npx eslint src/lib/calendar-constants.ts src/components/mindmap/custom-mind-map-view.tsx src/components/today/today-timeline-calendar.tsx src/components/dashboard/desktop-today-panel.tsx src/hooks/useMultiTaskCalendarSync.ts src/hooks/useTodayViewLogic.ts src/lib/today-range-blocks.ts src/hooks/useTouchDrag.ts src/components/today/today-timeline-calendar.test.tsx`（既存警告のみ、error 0）
- `npx tsc --noEmit --pretty false`
- `git diff --check`
- `curl -I --max-time 8 http://localhost:3001/dashboard`
- in-app Browser `http://localhost:3001/dashboard?desktop=1&source=mac` でマップとDayカレンダー同時表示、`data-focusmap-mindmap-node-calendar-target` 1件、console error 0を確認
- Arcで `http://localhost:3001/dashboard` を開いた

## Result

デスクトップ自作マップの単一タスクノードを右ペインDayカレンダーへドラッグし、カレンダー領域内では予定カードUIのoverlayと15分スナップpreview、領域外ではノードUIへ戻るoverlayを表示するようにした。drop時は既存の `onUpdateTask` 経由で `scheduled_at` / `estimated_time` / `calendar_id` を更新し、既存task calendar syncへ載せる。同一dropの短時間dedupe、`useMultiTaskCalendarSync` の画面インスタンス横断lock、同一カレンダー/タイトル/開始分のイベント表示除外で、タスク本体・optimistic event・Google eventが2つ3つ並ぶ状態を抑制した。日次カレンダーD&D中は通常の指スクロールをロックし、タイムライン端56px以内だけ最大2px/frameで当日内オートスクロールする。複数選択やカレンダー外dropは従来のマップ内移動を維持する。

## Links

- `docs/CONTEXT.md`
