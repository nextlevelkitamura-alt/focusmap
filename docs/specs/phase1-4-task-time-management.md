# Phase 1.4: タスク所要時間管理

## 📋 概要

### 目的
タスクに所要時間を設定し、カレンダー上で時間を確保することで、計画的なタスク管理を実現する。

### 背景
- タスクを計画する際、「どのくらい時間がかかるか」を見積もることが重要
- 見積もった時間をカレンダー上で確保することで、実行可能な計画が立てられる
- 実績時間を記録することで、見積もり精度が向上する

### スコープ
- タスクに所要時間（見積もり時間）を追加
- タスクをカレンダーにドラッグ&ドロップで配置
- 配置時に所要時間分のイベントを自動作成
- 時間の可視化（週ビュー、日ビュー）
- 実績時間の記録

---

## 🎯 要件定義

### 機能要件

#### FR-1: タスクに時間属性を追加
- 所要時間（estimated_duration）を分単位で設定
- タスク編集UIに時間入力欄を追加
- 時間のフォーマット表示（例: 1h 30m、2h）

#### FR-2: カレンダーへのドラッグ&ドロップ
- タスクリストからカレンダーへドラッグ&ドロップ
- ドロップ時に所要時間分のイベントを作成
- イベントはGoogleカレンダーにも同期
- タスクとイベントを紐付け

#### FR-3: 空き時間の自動検出
- ドロップ時に既存のイベントと重複しないように開始時間を調整
- 空き時間が不足している場合は警告

#### FR-4: 時間の可視化
- 週ビューでタスクの時間をブロック表示
- 日ビューで詳細な時間配分を表示
- タスクとイベントを区別して表示

#### FR-5: 実績時間の記録
- タスク完了時に実際にかかった時間を記録
- 見積もり時間との差分を表示
- タイマー機能との統合

#### FR-6: 重複チェック・警告
- 同じ時間帯に複数のタスク/イベントがある場合に警告
- オーバーブッキングの可視化

---

## 🗄️ データベース設計

### tasks テーブル（既存に追加）

```sql
ALTER TABLE tasks
  ADD COLUMN estimated_duration INTEGER,           -- 所要時間（分単位）
  ADD COLUMN actual_duration INTEGER,              -- 実績時間（分単位）
  ADD COLUMN calendar_event_id UUID REFERENCES calendar_events(id),  -- 紐付けられたイベント
  ADD COLUMN scheduled_at TIMESTAMPTZ,             -- カレンダーに配置された開始時間
  ADD COLUMN completed_duration INTEGER;           -- タイマーで記録された実績時間

-- インデックス
CREATE INDEX idx_tasks_scheduled ON tasks(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX idx_tasks_calendar_event ON tasks(calendar_event_id) WHERE calendar_event_id IS NOT NULL;
```

---

### task_time_logs テーブル（実績記録用）

```sql
CREATE TABLE task_time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) NOT NULL,
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- 作業時間
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration INTEGER,                    -- 分単位（ended_at - started_at）

  -- メモ
  note TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),

  INDEX idx_task_id (task_id),
  INDEX idx_user_time (user_id, started_at)
);

-- RLS
ALTER TABLE task_time_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own time logs"
  ON task_time_logs
  FOR ALL
  USING (auth.uid() = user_id);
```

---

## 🔌 API設計

### 1. タスクに時間を設定

**Endpoint:** `PATCH /api/tasks/:taskId/time`

**Request Body:**
```typescript
{
  estimatedDuration: number;  // 分単位
}
```

**Response:**
```typescript
{
  success: true,
  task: {
    id: string;
    estimatedDuration: number;
  }
}
```

---

### 2. タスクをカレンダーに配置

**Endpoint:** `POST /api/tasks/:taskId/schedule`

**Request Body:**
```typescript
{
  scheduledAt: string;        // ISO 8601形式
  calendarId?: string;        // GoogleカレンダーID（省略時はプライマリ）
  createCalendarEvent?: boolean;  // デフォルト: true
}
```

**Response:**
```typescript
{
  success: true,
  task: {
    id: string;
    scheduledAt: string;
    calendarEventId?: string;  // Googleカレンダーイベントが作成された場合
  },
  event?: {
    id: string;
    googleEventId: string;
    title: string;
    startTime: string;
    endTime: string;
  }
}
```

**処理内容:**
1. タスクの`scheduled_at`を更新
2. `estimated_duration`がある場合、Googleカレンダーにイベントを作成
3. イベントのタイトル: 「🎯 {タスクタイトル}」
4. イベントの時間: `scheduledAt` 〜 `scheduledAt + estimatedDuration`
5. `calendar_event_id`でタスクとイベントを紐付け

---

### 3. タスクのスケジュールを解除

**Endpoint:** `DELETE /api/tasks/:taskId/schedule`

**Request Body:**
```typescript
{
  deleteCalendarEvent?: boolean;  // デフォルト: true
}
```

**Response:**
```typescript
{
  success: true,
  task: {
    id: string;
    scheduledAt: null;
    calendarEventId: null;
  }
}
```

---

### 4. 空き時間を検索

**Endpoint:** `POST /api/calendar/find-free-time`

**Request Body:**
```typescript
{
  date: string;               // ISO 8601形式（日付）
  duration: number;           // 必要な時間（分単位）
  workingHours?: {            // 検索する時間帯（省略時は9:00-18:00）
    start: string;            // "09:00"
    end: string;              // "18:00"
  };
}
```

**Response:**
```typescript
{
  success: true,
  freeSlots: [
    {
      start: string;          // ISO 8601
      end: string;            // ISO 8601
      duration: number;       // 分単位
    }
  ]
}
```

**処理内容:**
1. 指定日のイベントを取得
2. 空き時間を計算
3. 指定された`duration`以上の空き時間をリストアップ

---

### 5. 実績時間の記録

**Endpoint:** `POST /api/tasks/:taskId/time-log`

**Request Body:**
```typescript
{
  startedAt: string;          // ISO 8601
  endedAt?: string;           // ISO 8601（省略時は現在時刻）
  note?: string;
}
```

**Response:**
```typescript
{
  success: true,
  log: {
    id: string;
    taskId: string;
    startedAt: string;
    endedAt: string;
    duration: number;         // 分単位
  },
  task: {
    id: string;
    actualDuration: number;   // 累積実績時間
  }
}
```

---

## 🎨 UIコンポーネント設計

### 1. TaskTimeInput

**ファイル:** `src/components/tasks/task-time-input.tsx`

**Props:**
```typescript
interface TaskTimeInputProps {
  value?: number;             // 分単位
  onChange: (minutes: number) => void;
}
```

**機能:**
- 時間と分を分けて入力（例: 1h 30m）
- プリセットボタン（15m、30m、1h、2h、4h）
- フォーマット表示

**実装例:**
```typescript
'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PRESETS = [
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
];

export function TaskTimeInput({ value = 0, onChange }: TaskTimeInputProps) {
  const [hours, setHours] = useState(Math.floor(value / 60));
  const [minutes, setMinutes] = useState(value % 60);

  useEffect(() => {
    const totalMinutes = hours * 60 + minutes;
    onChange(totalMinutes);
  }, [hours, minutes, onChange]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          value={hours}
          onChange={(e) => setHours(parseInt(e.target.value) || 0)}
          className="w-16"
          placeholder="0"
        />
        <span className="text-sm">時間</span>
        <Input
          type="number"
          min="0"
          max="59"
          value={minutes}
          onChange={(e) => setMinutes(parseInt(e.target.value) || 0)}
          className="w-16"
          placeholder="0"
        />
        <span className="text-sm">分</span>
      </div>

      <div className="flex gap-1">
        {PRESETS.map((preset) => (
          <Button
            key={preset.label}
            variant="outline"
            size="sm"
            onClick={() => {
              setHours(Math.floor(preset.minutes / 60));
              setMinutes(preset.minutes % 60);
            }}
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
```

---

### 2. TaskScheduleCard

**ファイル:** `src/components/tasks/task-schedule-card.tsx`

**Props:**
```typescript
interface TaskScheduleCardProps {
  task: Task;
  onScheduleChange: (scheduledAt: Date | null) => void;
}
```

**機能:**
- タスクのスケジュール状態を表示
- カレンダーアイコン + 日時表示
- 「スケジュールを解除」ボタン
- ドラッグ可能

---

### 3. CalendarTaskBlock

**ファイル:** `src/components/calendar/calendar-task-block.tsx`

**Props:**
```typescript
interface CalendarTaskBlockProps {
  task: Task;
  startTime: Date;
  endTime: Date;
  onEdit: () => void;
  onDelete: () => void;
}
```

**機能:**
- カレンダー上にタスクをブロック表示
- イベントとは異なるスタイル（例: 点線ボーダー、タスクアイコン）
- ホバー時に編集・削除ボタン
- ドラッグで時間変更

---

### 4. TimeConflictWarning

**ファイル:** `src/components/calendar/time-conflict-warning.tsx`

**Props:**
```typescript
interface TimeConflictWarningProps {
  conflicts: {
    time: Date;
    items: Array<{ type: 'task' | 'event'; title: string }>;
  }[];
  onResolve?: () => void;
}
```

**機能:**
- 時間の重複を警告
- 重複している項目のリスト表示
- 「再配置」ボタン

---

## 🪝 Custom Hooks設計

### useTaskScheduling

**目的:** タスクのスケジュール管理

```typescript
import { useCallback, useState } from 'react';
import { Task } from '@/types/task';

export function useTaskScheduling() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // タスクをスケジュール
  const scheduleTask = useCallback(async (
    taskId: string,
    scheduledAt: Date,
    calendarId?: string
  ): Promise<{ task: Task; eventId?: string }> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledAt: scheduledAt.toISOString(),
          calendarId,
          createCalendarEvent: true
        })
      });

      if (!response.ok) throw new Error('Failed to schedule task');

      const data = await response.json();
      return { task: data.task, eventId: data.event?.id };
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // スケジュール解除
  const unscheduleTask = useCallback(async (taskId: string): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/schedule`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteCalendarEvent: true })
      });

      if (!response.ok) throw new Error('Failed to unschedule task');
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 時間を設定
  const setTaskDuration = useCallback(async (
    taskId: string,
    estimatedDuration: number
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/time`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimatedDuration })
      });

      if (!response.ok) throw new Error('Failed to set duration');
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    scheduleTask,
    unscheduleTask,
    setTaskDuration,
    isLoading,
    error
  };
}
```

---

### useFreeTimeSlots

**目的:** 空き時間の検索

```typescript
import { useState, useCallback } from 'react';

interface FreeSlot {
  start: Date;
  end: Date;
  duration: number;
}

export function useFreeTimeSlots() {
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const findFreeSlots = useCallback(async (
    date: Date,
    duration: number,
    workingHours?: { start: string; end: string }
  ): Promise<FreeSlot[]> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/find-free-time', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: date.toISOString(),
          duration,
          workingHours
        })
      });

      if (!response.ok) throw new Error('Failed to find free time');

      const data = await response.json();
      const freeSlots = data.freeSlots.map((slot: any) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
        duration: slot.duration
      }));

      setSlots(freeSlots);
      return freeSlots;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    slots,
    isLoading,
    error,
    findFreeSlots
  };
}
```

---

### useTimeConflictDetection

**目的:** 時間の重複検出

```typescript
import { useMemo } from 'react';
import { Task } from '@/types/task';
import { CalendarEvent } from '@/types/calendar';

interface TimeConflict {
  time: Date;
  items: Array<{ type: 'task' | 'event'; id: string; title: string }>;
}

export function useTimeConflictDetection(
  tasks: Task[],
  events: CalendarEvent[]
) {
  const conflicts = useMemo(() => {
    const timeMap = new Map<number, TimeConflict>();

    // タスクを追加
    tasks.forEach(task => {
      if (!task.scheduledAt) return;

      const time = new Date(task.scheduledAt).getTime();
      if (!timeMap.has(time)) {
        timeMap.set(time, { time: new Date(time), items: [] });
      }
      timeMap.get(time)!.items.push({
        type: 'task',
        id: task.id,
        title: task.title
      });
    });

    // イベントを追加
    events.forEach(event => {
      const time = new Date(event.startTime).getTime();
      if (!timeMap.has(time)) {
        timeMap.set(time, { time: new Date(time), items: [] });
      }
      timeMap.get(time)!.items.push({
        type: 'event',
        id: event.id,
        title: event.title
      });
    });

    // 重複（2つ以上のアイテム）のみ返す
    return Array.from(timeMap.values()).filter(conflict => conflict.items.length > 1);
  }, [tasks, events]);

  return {
    conflicts,
    hasConflicts: conflicts.length > 0
  };
}
```

---

## 🔗 統合ポイント

### CalendarWeekView への統合

**ファイル:** `src/components/calendar/calendar-week-view.tsx`

**変更点:**
```typescript
// タスクのドロップハンドラを拡張
const handleTaskDrop = async (taskId: string, dateTime: Date) => {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  // タスクに所要時間が設定されている場合
  if (task.estimatedDuration) {
    // カレンダーイベントを作成
    await scheduleTask(taskId, dateTime);

    // 通知を表示
    toast.success(`タスク「${task.title}」をスケジュールしました`);
  } else {
    // 所要時間が未設定の場合、設定を促す
    toast.info('所要時間を設定してからスケジュールしてください');
  }
};
```

---

### タスク編集ダイアログへの統合

**ファイル:** `src/components/tasks/task-edit-dialog.tsx`

**変更点:**
```typescript
// フォームに時間入力欄を追加
<FormField
  control={form.control}
  name="estimatedDuration"
  render={({ field }) => (
    <FormItem>
      <FormLabel>所要時間</FormLabel>
      <FormControl>
        <TaskTimeInput
          value={field.value}
          onChange={field.onChange}
        />
      </FormControl>
      <FormDescription>
        このタスクに必要な時間を見積もってください
      </FormDescription>
    </FormItem>
  )}
/>
```

---

## 🧪 テスト観点

### 単体テスト

#### API Routes
- [ ] タスクに時間設定: 正常系
- [ ] タスクをスケジュール: 正常系
- [ ] タスクをスケジュール: Googleカレンダーイベント作成
- [ ] スケジュール解除: 正常系
- [ ] 空き時間検索: 正常系
- [ ] 実績時間記録: 正常系

#### Custom Hooks
- [ ] useTaskScheduling: scheduleTask
- [ ] useTaskScheduling: unscheduleTask
- [ ] useFreeTimeSlots: findFreeSlots
- [ ] useTimeConflictDetection: 重複検出

#### コンポーネント
- [ ] TaskTimeInput: 時間入力
- [ ] TaskTimeInput: プリセットボタン
- [ ] CalendarTaskBlock: 表示
- [ ] TimeConflictWarning: 警告表示

---

### 統合テスト

- [ ] タスク作成 → 時間設定 → カレンダーにドロップ → イベント作成
- [ ] タスクをドラッグで時間変更 → イベントも更新
- [ ] タスク削除 → 紐付けられたイベントも削除
- [ ] 空き時間検索 → 提案された時間にスケジュール

---

## 📦 実装の優先順位

### Phase 1-4-1: タスクに時間属性を追加（最優先）
1. `tasks`テーブルに`estimated_duration`カラム追加
2. `TaskTimeInput`コンポーネント実装
3. タスク編集ダイアログに統合
4. `/api/tasks/:taskId/time` 実装

### Phase 1-4-2: カレンダーへのドラッグ&ドロップ
1. `/api/tasks/:taskId/schedule` 実装
2. `useTaskScheduling` Hook 実装
3. ドロップハンドラの拡張
4. `CalendarTaskBlock` コンポーネント実装

### Phase 1-4-3: 時間の可視化
1. 週ビューにタスクブロック表示
2. 日ビューにタスクブロック表示
3. `useTimeConflictDetection` 実装
4. `TimeConflictWarning` コンポーネント実装

---

## 📚 参考資料

- [date-fns Documentation](https://date-fns.org/)
- [Google Calendar API - Events](https://developers.google.com/calendar/api/v3/reference/events)
- [Time Management Best Practices](https://www.atlassian.com/time-management)

---

**作成日:** 2026-01-28
**対象バージョン:** v1.0.0
**担当:** Architect AI (Sonnet 4.5)
