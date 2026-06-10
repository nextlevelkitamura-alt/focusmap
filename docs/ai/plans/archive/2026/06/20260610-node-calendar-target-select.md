# TASK-20260610-007 マップノード予定化の追加先カレンダー選択

## 目的
マップノードを右ペインのDayカレンダーへドラッグして予定化する時、ユーザーが事前に追加先Googleカレンダーを選べるようにする。

## Scope
- `DesktopTodayPanel` のカレンダー右上操作群に、書き込み可能カレンダーのコンパクトなプルダウンを追加する。
- 選択したカレンダーIDを、ノードdrop時の `onUpdateTask(..., { calendar_id })` に優先適用する。
- カレンダー一覧の変更時は、無効な選択を既定の書き込み可能カレンダーへ戻す。
- `docs/CONTEXT.md` のマップノードD&D仕様を更新する。

## Verification
- `npx eslint src/components/dashboard/desktop-today-panel.tsx src/components/dashboard/desktop-today-panel.test.tsx`
- `npm run test:run -- src/components/dashboard/desktop-today-panel.test.tsx`
- `npm run test:run -- src/components/today/today-timeline-calendar.test.tsx`
- `npx tsc --noEmit --pretty false`
- `curl -I --max-time 8 http://localhost:3001/dashboard`
- in-app Browser `http://127.0.0.1:3001/dashboard?desktop=1&source=mac` でマップ+Dayカレンダーを表示し、`ノード予定の追加先カレンダー` combobox 1件、選択変更、console error 0、ヘッダー表示を確認

## Result
- 右ペインDayカレンダーの右上操作群に、書き込み可能Googleカレンダーの追加先プルダウンを追加した。
- マップノードdrop時は、プルダウンで選択したカレンダーIDを `calendar_id` として優先保存する。
- カレンダー候補が更新されて選択値が無効になった場合は、既定の書き込み可能カレンダーへ戻す。
