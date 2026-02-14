---
feature: calendar-drag-drop-time-change
type: feature
method: impl
created: 2026-02-12
status: planning
---

# 設計プラン: カレンダードラッグ&ドロップ時間変更

## 要件

カレンダー上でイベントをドラッグ&ドロップして時間を変更した際に、対応するタスクの `scheduled_at` も自動的に更新し、Google Calendar と同期する機能。

### ユーザーストーリー

#### パターンA: イベント全体の移動（開始時刻変更）
1. ユーザーがイベントカードの**中央部分**をドラッグする
2. 新しい時間帯にドロップする
3. タスクの `scheduled_at` が自動更新される
4. `estimated_time` は維持される（終了時刻は自動計算）
5. Google Calendar の予定も自動更新される
6. UIに即座に反映される

#### パターンB: エッジリサイズ（所要時間変更）
1. ユーザーがイベントカードの**下端（リサイズハンドル）**をドラッグする
2. 新しい終了時刻までドラッグする
3. タスクの `estimated_time` が自動更新される
4. `scheduled_at` は維持される
5. Google Calendar の予定も自動更新される
6. UIに即座に反映される

## 現状分析

### 既存の実装
- カレンダーコンポーネントは `react-big-calendar` 風の実装
- ドラッグ機能は部分的に実装済み
- `useTaskCalendarSync` hook でタスク↔カレンダー同期
- PATCH `/api/calendar/sync-task` でカレンダー更新API

### 不足している部分
- イベントドロップ時のタスク更新処理
- ドロップ後のカレンダー再フェッチ
- 楽観的UI更新

## リスク評価

**MEDIUM**
- ドラッグ中の視覚的フィードバック（既存実装あり）
- 時刻計算の精度（15分単位スナップ）
- 複数日をまたぐドラッグの処理
- 同期エラー時のロールバック

## 依存関係

- **既存**: `useTaskCalendarSync.ts`（タスク更新ロジック）
- **既存**: `/api/calendar/sync-task`（PATCH エンドポイント）
- **既存**: カレンダービューコンポーネント（week/day/3day）
- **ライブラリ**: なし（既存のDnD実装を利用）

## 実装フェーズ

### Phase 1: イベント移動（開始時刻変更）
- [ ] イベントカードのドラッグ検知（中央部分）
- [ ] ドロップ位置から新しい時刻を計算（15分単位スナップ）
- [ ] calendar-week-view.tsx にドロップハンドラー追加
- [ ] calendar-day-view.tsx にドロップハンドラー追加
- [ ] calendar-3day-view.tsx にドロップハンドラー追加
- [ ] scheduled_at の更新（onUpdateTask呼び出し）
- [ ] Google Calendar への自動同期

### Phase 2: エッジリサイズ（所要時間変更）
- [ ] イベントカード下端にリサイズハンドルを追加
- [ ] リサイズハンドルのホバー検知
- [ ] リサイズハンドルのドラッグ検知
- [ ] ドラッグ中の高さ変更（視覚的フィードバック）
- [ ] ドロップ時の新しい終了時刻を計算
- [ ] estimated_time の更新（終了時刻 - 開始時刻）
- [ ] Google Calendar への自動同期

### Phase 3: UIフィードバックの改善
- [ ] ドラッグ中のカーソル変更（move / ns-resize）
- [ ] ドラッグ中の半透明表示
- [ ] ドロップ成功時のトースト通知
- [ ] ドロップ失敗時のロールバック＆エラー表示

### Phase 4: エラーハンドリング＆最適化
- [ ] ネットワークエラー時のロールバック
- [ ] 楽観的UI更新
- [ ] 複数日をまたぐドラッグの対応
- [ ] 同期中のローディング表示

## 実装対象ファイル

### 変更
- `src/components/calendar/calendar-week-view.tsx` - ドロップ＆リサイズハンドラー追加
- `src/components/calendar/calendar-day-view.tsx` - ドロップ＆リサイズハンドラー追加
- `src/components/calendar/calendar-3day-view.tsx` - ドロップ＆リサイズハンドラー追加
- `src/components/calendar/calendar-event-card.tsx` - リサイズハンドルUI追加
- `src/components/dashboard/right-sidebar.tsx` - onUpdateTask prop 追加
- `src/components/calendar/calendar-view.tsx` - onUpdateTask prop の伝播

### 新規作成
- `src/hooks/useEventDragResize.ts`（オプション）- ドラッグ＆リサイズのロジックを共通化

## 技術仕様

### 1. ドラッグ検知の区別

```typescript
// イベントカードのどの部分がドラッグされたか判定
function getDragType(
  event: React.MouseEvent,
  cardElement: HTMLElement
): 'move' | 'resize' {
  const rect = cardElement.getBoundingClientRect()
  const relativeY = event.clientY - rect.top
  const cardHeight = rect.height

  // 下端10pxはリサイズハンドル
  if (cardHeight - relativeY <= 10) {
    return 'resize'
  }

  return 'move'
}
```

### 2. ドロップ位置から時刻を計算

```typescript
// ドロップ位置 (Y座標) から時刻を計算
function calculateTimeFromDropPosition(
  dropY: number,
  containerTop: number,
  hourHeight: number
): { hours: number; minutes: number } {
  const relativeY = dropY - containerTop
  const totalMinutes = Math.floor((relativeY / hourHeight) * 60)

  // 15分単位にスナップ
  const snappedMinutes = Math.round(totalMinutes / 15) * 15

  const hours = Math.floor(snappedMinutes / 60)
  const minutes = snappedMinutes % 60

  return { hours, minutes }
}
```

### 3. リサイズ時の所要時間計算

```typescript
// リサイズハンドルのドラッグ量から所要時間を計算
function calculateDurationFromResize(
  startY: number,
  endY: number,
  hourHeight: number,
  originalDuration: number // minutes
): number {
  const deltaY = endY - startY
  const deltaMinutes = Math.floor((deltaY / hourHeight) * 60)

  // 15分単位にスナップ
  const snappedDelta = Math.round(deltaMinutes / 15) * 15

  const newDuration = originalDuration + snappedDelta

  // 最小15分、最大24時間
  return Math.max(15, Math.min(newDuration, 24 * 60))
}
```

### 4. タスク更新フロー（イベント移動）

```typescript
async function handleEventMove(
  event: CalendarEvent,
  newStartTime: Date
) {
  // 1. 楽観的UI更新
  updateEventLocally(event.id, { startTime: newStartTime })

  try {
    // 2. タスクのscheduled_atを更新
    await onUpdateTask(event.taskId, {
      scheduled_at: newStartTime.toISOString()
    })

    // 3. Google Calendar同期は useTaskCalendarSync が自動処理

    // 4. カレンダー再フェッチ
    await refreshCalendar()

    // 5. 成功トースト
    showToast('予定を移動しました')
  } catch (error) {
    // 6. ロールバック
    revertEventLocally(event.id)
    showToast('予定の移動に失敗しました', 'error')
  }
}
```

### 5. タスク更新フロー（リサイズ）

```typescript
async function handleEventResize(
  event: CalendarEvent,
  newDurationMinutes: number
) {
  // 1. 楽観的UI更新
  updateEventLocally(event.id, { duration: newDurationMinutes })

  try {
    // 2. タスクのestimated_timeを更新
    await onUpdateTask(event.taskId, {
      estimated_time: newDurationMinutes
    })

    // 3. Google Calendar同期は useTaskCalendarSync が自動処理

    // 4. カレンダー再フェッチ
    await refreshCalendar()

    // 5. 成功トースト
    showToast('所要時間を変更しました')
  } catch (error) {
    // 6. ロールバック
    revertEventLocally(event.id)
    showToast('所要時間の変更に失敗しました', 'error')
  }
}
```

### Props 拡張

```typescript
// RightSidebar に追加
interface RightSidebarProps {
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
}

// CalendarView に追加
interface CalendarViewProps {
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
}
```

## テストシナリオ

### 手動テスト
1. **週ビューでのドラッグ**
   - イベントを同じ日の異なる時間にドラッグ
   - タスクリストで scheduled_at が更新されることを確認
   - Google Calendar で予定が更新されることを確認

2. **日ビューでのドラッグ**
   - イベントを異なる時間にドラッグ
   - 15分単位でスナップすることを確認

3. **複数日をまたぐドラッグ**
   - イベントを別の日にドラッグ
   - 日付と時刻が正しく更新されることを確認

4. **エラーハンドリング**
   - ネットワークエラー時にロールバックされることを確認
   - エラートーストが表示されることを確認

5. **同期済みイベントのドラッグ**
   - Google Calendar と同期済みのイベントをドラッグ
   - Google Calendar 側も更新されることを確認

## 懸念事項

### 1. 複数日をまたぐドラッグ
- 現在のカレンダーUIは週/日ビュー
- 日付変更を伴うドラッグは week ビューでのみ可能
- → 日付変更も scheduled_at に反映する必要あり

### 2. estimated_time の扱い
- ドラッグで開始時刻のみ変更
- estimated_time は変更しない（終了時刻は自動計算）
- → ユーザーが期待する動作か確認が必要

### 3. 同期タイミング
- ドロップ直後に同期開始
- useTaskCalendarSync が scheduled_at の変更を検知して自動同期
- → 二重同期を防ぐ必要あり

## 実装順序

1. **Phase 1**: ドロップハンドラーの基本実装（時刻計算）
2. **Phase 2**: タスク更新ロジック（scheduled_at更新）
3. **Phase 3**: カレンダー同期（Google Calendar更新）
4. **Phase 4**: UIフィードバック（トースト、ロールバック）

## 推奨実装方式

→ **/impl** （UI機能、既存APIを利用）

ドラッグ&ドロップは主にUIロジックで、既存のAPIとhookを組み合わせるだけなので、テストなしの軽量実装で十分。
