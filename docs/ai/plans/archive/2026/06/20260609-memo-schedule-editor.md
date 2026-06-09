# メモ編集シートの予定入力UI改善

- Task ID: TASK-20260609-003
- Status: completed
- Created: 2026-06-09
- Completed: 2026-06-09
- Board: `docs/ai/task-board.md`

## Goal

メモ編集シートのPC配置を、左にメモ詳細、右に画像・時間・予定へ入れ替える。カレンダー選択はGoogle連携済みカレンダーをプルダウンで選び、日時・所要時間・カレンダーが揃ったらカレンダー登録できる状態にする。所要時間は解除を専用操作にし、時間/分のホイール型カスタム選択を追加する。

## Scope

- `WishlistCardDetail` / `CodexNodePanel` 周辺のメモ編集UI
- 既存Googleカレンダー一覧取得、予定登録APIとの接続
- `docs/CONTEXT.md` の現行仕様確認

## Non-goals

- Google OAuth設定やDBスキーマの変更
- 本番デプロイ、push
- 既存 `useMindMapSync` 未コミット差分への介入

## Plan

1. 既存のメモ編集UI、所要時間/時刻ホイール、カレンダー登録APIを確認する。
2. PCレイアウトを左右入れ替え、モバイルは既存順序を崩さない。
3. カレンダー選択と登録ボタンの状態管理を、連携済みカレンダー候補に合わせて調整する。
4. 所要時間のカスタムホイールを実装し、解除操作を独立ボタン化する。
5. 型チェック/対象テスト/実画面で確認し、docsとtask-router記録を更新してコミットする。

## Parallelization

`SINGLE_CHAT`。UIと予定登録の状態が同じコンポーネント内で強く結合しており、既存未コミット差分もあるため分割しない。

## Verification

- `npm run test:run -- src/components/wishlist/wishlist-card-detail.test.tsx src/app/api/calendar/sync-task/route.test.ts`
- `npm run lint -- src/components/wishlist/wishlist-card-detail.tsx src/components/wishlist/wishlist-card-detail.test.tsx src/components/codex/codex-node-panel.tsx src/components/ui/ios-wheel-column.tsx src/components/ui/duration-wheel-popover.tsx src/components/dashboard/mind-map.tsx 'src/app/api/wishlist/[id]/calendar/route.ts' src/app/api/calendar/sync-task/route.ts`
- `git diff --check`
- `npx tsc --noEmit --pretty false` は今回差分の型エラーは解消したが、既存の `src/lib/codex-app-launch.ts` 4件で失敗
- Browser `http://localhost:3001/dashboard?desktop=1&source=mac` は検証用ブラウザにログインセッションがなく `/login?desktop=1&source=mac` へリダイレクトされたため、実画面の到達確認は未完了

## Result

- `WishlistCardDetail` と `CodexNodePanel` のPC配置を、左にメモ詳細、右に画像・時間・予定へ寄せた。
- 所要時間の `カスタム` は時間/分ホイールPopoverに変更し、`解除` は所要時間が入っている時だけ独立ボタンとして表示する。
- カレンダー欄は `useCalendars` の選択済み/書き込み可能なGoogleカレンダーを優先したプルダウンにし、日時・所要時間・カレンダーが揃った時だけ予定登録/更新できるようにした。
- `/api/calendar/sync-task` のPOSTは既存イベント更新時に元 `calendar_id` を `source_calendar_id` として渡し、カレンダー移動時の二重作成を避けるようにした。

## Links

- `docs/CONTEXT.md`
