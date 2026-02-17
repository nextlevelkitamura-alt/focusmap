---
fix: マインドマップのカレンダー同期修正
type: fix
created: 2026-02-16
status: planning
---

# 修正計画: マインドマップのカレンダー同期修正

## 問題の概要
マインドマップのTaskNodeで「scheduled_at（日時）」「estimated_time（所要時間）」「calendar_id（カレンダー）」の3つを設定しても、Googleカレンダーに予定が反映されない。

## 根本原因

### 🔴 Critical: center-pane.tsx で enabled パラメータが渡されていない
- **場所**: `src/components/dashboard/center-pane.tsx` 行200-215
- **問題**: `useTaskCalendarSync` に `enabled` を渡していないため、グループもタスクも同期対象になる
- **影響**: グループ（is_group=true）のタスクも同期しようとしてエラー、または不要な同期が発生

### 🟡 Medium: DB更新と同期実行のタイミングズレ
- **場所**: `src/hooks/useMindMapSync.ts` の `updateTask`
- **問題**:
  1. `setAllTasks` でローカルステートを即座に更新（楽観的更新）
  2. 同時に `useTaskCalendarSync` の useEffect が発火
  3. しかし、Supabase への DB 更新は非同期で独立
  4. DB 更新完了前に同期が開始される可能性
- **影響**: 古いデータで同期APIが呼ばれる、または競合状態

### 🟡 Medium: エラーメッセージがユーザーに表示されない
- **場所**: `src/hooks/useTaskCalendarSync.ts`
- **問題**: API エラーやリトライ失敗が silent failure
- **影響**: ユーザーが同期失敗に気づかない

### 🟢 Minor: estimated_time=0 の場合の扱い
- **場所**: `src/hooks/useTaskCalendarSync.ts` 行180-184
- **問題**: `hasAllFields = scheduled_at && estimated_time && calendar_id` のチェックで、`estimated_time=0` が false と判定される
- **影響**: 0分の予定が作成できない（実際は1分以上必須かも）

## 修正方針

### Phase 1: Critical 問題の修正（最優先）

#### 1-1. center-pane.tsx で enabled パラメータを明示的に設定
```typescript
const { status: syncStatus, error: syncError, retry: syncRetry } = useTaskCalendarSync({
    taskId: task.id,
    scheduled_at: task.scheduled_at,
    estimated_time: task.estimated_time,
    calendar_id: task.calendar_id,
    google_event_id: task.google_event_id,
    enabled: !task.is_group, // ← 追加: グループは同期しない
    onSyncSuccess: async () => {
        await onRefreshCalendar?.()
    },
    onGoogleEventIdChange: (googleEventId) => {
        onUpdateTask?.(task.id, { google_event_id: googleEventId })
    }
});
```

#### 1-2. 3つの条件チェックを厳密化
```typescript
// estimated_time は 0 でも OK とする（Googleカレンダーは最低1分必要なので、API側で調整）
const hasAllFields = !!(scheduled_at && calendar_id && estimated_time !== null && estimated_time !== undefined)
```

### Phase 2: Medium 問題の修正

#### 2-1. エラー表示の改善
- TaskItem に同期ステータスを表示
- エラー時にリトライボタンを表示
- エラーメッセージをユーザーフレンドリーに

```typescript
{syncStatus === 'error' && syncError && (
  <div className="text-xs text-red-500 flex items-center gap-1">
    <AlertCircle className="w-3 h-3" />
    <span>カレンダー同期失敗: {syncError}</span>
    <button onClick={syncRetry} className="underline">再試行</button>
  </div>
)}
```

#### 2-2. ローディング状態の表示
```typescript
{syncStatus === 'syncing' && (
  <div className="text-xs text-muted-foreground flex items-center gap-1">
    <Loader2 className="w-3 h-3 animate-spin" />
    <span>同期中...</span>
  </div>
)}
```

### Phase 3: マインドマップへの統合

#### 3-1. mind-map.tsx の TaskNode に useTaskCalendarSync を追加
**問題**: 現在 TaskNode は center-pane.tsx の TaskItem でのみ同期されている
**影響**: マインドマップのノードで3つの情報を入力しても同期されない

**修正**:
- mind-map.tsx の MindMapContent コンポーネントレベルで useTaskCalendarSync を呼び出す
- または、TaskNode の data に syncStatus を渡して表示

```typescript
// MindMapContent 内で全タスクに対して useTaskCalendarSync を呼ぶ
const taskSyncStates = useMemo(() => {
  return tasks.map(task => ({
    taskId: task.id,
    syncHook: useTaskCalendarSync({
      taskId: task.id,
      scheduled_at: task.scheduled_at,
      estimated_time: task.estimated_time,
      calendar_id: task.calendar_id,
      google_event_id: task.google_event_id,
      enabled: !task.is_group,
      onSyncSuccess: async () => { /* refresh */ },
      onGoogleEventIdChange: (googleEventId) => {
        onUpdateTask?.(task.id, { google_event_id: googleEventId })
      }
    })
  }))
}, [tasks])
```

**注意**: React Hooks のルールにより、ループ内で useTaskCalendarSync を呼ぶことはできない
**代替案**: カスタムフックを作成して内部で管理

#### 3-2. useMultiTaskCalendarSync カスタムフックの作成
```typescript
// src/hooks/useMultiTaskCalendarSync.ts
export function useMultiTaskCalendarSync(tasks: Task[], options: {...}) {
  // 各タスクの同期状態を管理
  // useEffect で変更を検知して同期
}
```

## 修正対象ファイル

### Phase 1 (Critical)
1. `src/components/dashboard/center-pane.tsx` - enabled パラメータ追加
2. `src/hooks/useTaskCalendarSync.ts` - 条件チェック厳密化

### Phase 2 (Medium)
3. `src/components/dashboard/center-pane.tsx` - エラー表示・ローディング表示追加

### Phase 3 (マインドマップ統合)
4. `src/hooks/useMultiTaskCalendarSync.ts` - 新規作成
5. `src/components/dashboard/mind-map.tsx` - useMultiTaskCalendarSync 統合
6. `src/components/dashboard/center-pane.tsx` - useMultiTaskCalendarSync 使用

## 検証方法

### Phase 1
1. center-pane.tsx のタスクリストでタスクを選択
2. カレンダー・日時・所要時間を設定
3. Googleカレンダーに予定が作成されることを確認
4. ブラウザコンソールで `[sync-task POST]` ログを確認

### Phase 2
1. カレンダー未連携の状態でタスクに3つの情報を設定
2. エラーメッセージが表示されることを確認
3. リトライボタンをクリックして再試行できることを確認

### Phase 3
1. マインドマップのノードを選択
2. カレンダー・日時・所要時間を設定
3. Googleカレンダーに予定が作成されることを確認
4. 同期中のローディング表示を確認
5. 同期成功後に google_event_id が設定されることを確認

## 注意事項
- グループ（is_group=true）は同期対象外
- estimated_time=0 の場合の挙動はGoogleカレンダーAPIの仕様に依存（最低1分必要）
- DB 更新とカレンダー同期の競合を避けるため、楽観的更新のタイミングを調整する必要があるかもしれない
