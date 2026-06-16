# Desktop Todo Calendar Controls

- Task ID: TASK-20260617-003
- Status: completed
- Created: 2026-06-17
- Completed: 2026-06-17
- Board: `docs/ai/task-board.md`

## Goal

PC版 `Todo` を3日カレンダー主画面に寄せ、ヘッダー操作を実際の表示カレンダー選択と時間軸表示に合わせる。

## Scope

- `src/app/dashboard/dashboard-client.tsx`
- `src/components/dashboard/desktop-today-panel.tsx`
- `src/components/today/today-3days-calendar.tsx`
- `src/components/calendar/calendar-selector.tsx`
- `docs/CONTEXT.md`
- task-router 記録ファイル

## Non-goals

- Google Calendar API / DB schema の変更
- モバイルTodayの3days省略表示変更
- 予定編集を読み取り専用へ変更する判断

## Plan

1. desktop `Todo` の主領域へ `DesktopTodayPanel` を直接表示し、右サイドバー重複をなくす。
2. Todo主領域の初期表示を `3days` にする。
3. 3daysのPC主表示では `+N` overflow chip を出さず、重なりは横レーンで全件表示する。
4. standalone refresh icon と `ノード追加先` select を外す。
5. 既存 `useCalendars` / `/api/calendars/[id]` の `selected` PATCHを使い、表示カレンダーをチェックリストで切り替える。
6. 時間軸表示ボタンを右側の操作群へ寄せ、3daysでも時間軸表示の意味で表示する。
7. 実装に合わせて `docs/CONTEXT.md` を更新する。

## Parallelization

SINGLE_CHAT。UI、表示カレンダー選択、3days衝突表示が同じコンポーネント境界で密結合しているため、同一チャットで直列実装する。

## Verification

リポジトリ方針により、ユーザー明示なしでは `npm run lint` / `npm run build` / ブラウザ確認は実行しない。差分確認のみ行う。

## Result

PC版 `Todo` の主画面を `DesktopTodayPanel` へ寄せ、初期表示を `3days` にした。PC主画面では3日分を横並びの時間軸として表示し、重なり予定は `+N` 省略ではなく横レーンで全件表示する。

ヘッダーから単独更新ボタンと旧 `ノード追加先` select を外し、表示カレンダーは既存 `useCalendars` / `user_calendars.selected` / `/api/calendars/[id]` のチェックリストで切り替える。三本線の時間軸表示ボタンと表示カレンダー切替は右側操作群へ寄せた。

リポジトリ方針により、lint / build / ブラウザ確認は未実行。

## Links

- `docs/specs/desktop-todo-calendar-only/requirements.md`
