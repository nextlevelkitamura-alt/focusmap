# カレンダー予定入力機能 設計書 V2（改良版）

## ユーザーフィードバック反映

### 新規要件
1. ✅ **複数カレンダー対応**: 仕事用・プライベート用などカレンダーを切り替え
2. ✅ **親タスクの一括スケジューリング**: 親をドロップ→子タスクも全て反映
3. ✅ **重複防止**: 同じタスクを2回予定に入れない（ID管理）
4. ✅ **完全双方向同期**: カレンダー上での変更がタスクに即座に反映

---

## 1. 複数カレンダー対応

### 1.1 カレンダー選択UI

**右サイドバーのカレンダービュー**:
```
┌──────────────────────────────────────────────┐
│  Googleカレンダー                             │
│  ┌─────────────────────────────────────┐     │
│  │ [✓] 仕事    [✓] プライベート  [ ] 家族 │  ← カレンダー選択
│  └─────────────────────────────────────┘     │
│  [今週▼]                    [設定]           │
├──────────────────────────────────────────────┤
│  月25  火26  水27  木28  金29                │
│ ┌────┬────┬────┬────┬────┐               │
│ │🟦🟦│🟣🟣│    │    │🟦🟦│ 9:00          │
│ │仕事│MTG│    │    │振返│               │
│ │    │🟢🟢│    │    │    │               │  ← 🟦仕事 🟣プライベート
│ │    │ジム│    │    │    │               │     🟢家族
│ └────┴────┴────┴────┴────┘               │
└──────────────────────────────────────────────┘
```

### 1.2 データモデル

#### user_calendar_settings テーブル拡張
```sql
ALTER TABLE user_calendar_settings ADD COLUMN IF NOT EXISTS calendars JSONB;

-- 例:
{
  "calendars": [
    {
      "id": "primary",
      "name": "仕事",
      "color": "#1E88E5",
      "enabled": true,
      "is_default": true
    },
    {
      "id": "private@gmail.com",
      "name": "プライベート",
      "color": "#8E24AA",
      "enabled": true,
      "is_default": false
    },
    {
      "id": "family@group.calendar.google.com",
      "name": "家族",
      "color": "#43A047",
      "enabled": false,
      "is_default": false
    }
  ]
}
```

#### tasks テーブル拡張
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS target_calendar_id TEXT DEFAULT 'primary';

-- タスクごとにどのカレンダーに入れるかを保存
-- デフォルトは 'primary' (メインカレンダー)
```

### 1.3 API: カレンダーリスト取得

```typescript
// GET /api/calendar/list
export async function GET(request: NextRequest) {
  const { calendar } = await getCalendarClient(userId);

  // Googleから全カレンダーを取得
  const response = await calendar.calendarList.list();

  const calendars = response.data.items?.map(cal => ({
    id: cal.id,
    name: cal.summary,
    color: cal.backgroundColor,
    accessRole: cal.accessRole, // owner, writer, reader
    primary: cal.primary || false
  })) || [];

  // user_calendar_settingsに保存
  await supabase
    .from('user_calendar_settings')
    .update({ calendars })
    .eq('user_id', userId);

  return NextResponse.json({ calendars });
}
```

### 1.4 カレンダー選択UI

**設定モーダル**:
```
┌──────────────────────────────────────────┐
│  カレンダー設定                           │
├──────────────────────────────────────────┤
│                                          │
│  表示するカレンダー:                      │
│  ┌────────────────────────────────────┐  │
│  │ [✓] 🟦 仕事 (primary)              │  │
│  │     デフォルト: [●]                │  │
│  │                                    │  │
│  │ [✓] 🟣 プライベート                │  │
│  │     デフォルト: [ ]                │  │
│  │                                    │  │
│  │ [ ] 🟢 家族カレンダー              │  │
│  │     デフォルト: [ ]                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  新規タスクのデフォルトカレンダー:        │
│  [仕事 ▼]                               │
│                                          │
│  [キャンセル]              [保存]        │
└──────────────────────────────────────────┘
```

### 1.5 タスク作成時のカレンダー選択

**QuickScheduleModal改良版**:
```
┌─────────────────────────────────────────────────┐
│  「資料作成」タスクの予定を設定                  │
├─────────────────────────────────────────────────┤
│                                                 │
│  📅 カレンダー                                   │
│  ┌─────────────────────────────────┐            │
│  │ 🟦 仕事 (primary)      [▼]     │  ← NEW!    │
│  └─────────────────────────────────┘            │
│                                                 │
│  📅 日付時刻                                     │
│  ┌─────────────────────────────────┐            │
│  │ 2026年1月27日(月) 14:00        │            │
│  └─────────────────────────────────┘            │
│                                                 │
│  ⏱️ 所要時間                                     │
│  [ 30分 ] [ 1時間 ] [ 2時間 ] [ カスタム ]     │
│                                                 │
│  [ キャンセル ]              [ 予定を設定 ]     │
└─────────────────────────────────────────────────┘
```

---

## 2. 親タスクの一括スケジューリング

### 2.1 ユースケース

**シナリオ**:
```
プロジェクト計画
├─ 要件定義 (2h)
├─ 設計 (3h)
│  ├─ DB設計 (1h)
│  └─ API設計 (2h)
└─ 実装 (5h)
   ├─ フロントエンド (3h)
   └─ バックエンド (2h)
```

**ユーザー操作**:
「プロジェクト計画」タスクをカレンダーの月曜9:00にドラッグ&ドロップ

**期待される結果**:
```
月曜 9:00-11:00  要件定義
月曜 11:00-14:00 設計
    └ 11:00-12:00 DB設計
    └ 12:00-14:00 API設計
月曜 14:00-19:00 実装
    └ 14:00-17:00 フロントエンド
    └ 17:00-19:00 バックエンド
```

### 2.2 アルゴリズム: 子タスク展開

```typescript
async function scheduleTaskWithChildren(
  taskId: string,
  startTime: Date,
  calendarId: string
) {
  const task = await getTaskById(taskId);
  const children = await getChildTasks(taskId);

  let currentTime = startTime;
  const scheduledTasks: ScheduledTask[] = [];

  // 親タスクに子タスクがある場合
  if (children.length > 0) {
    // 子タスクを順番にスケジュール
    for (const child of children) {
      const childDuration = child.estimated_time || 60; // 分
      const childEnd = new Date(currentTime.getTime() + childDuration * 60000);

      // 子タスクをスケジュール
      await scheduleTask(child.id, currentTime, childEnd, calendarId);
      scheduledTasks.push({
        taskId: child.id,
        start: currentTime,
        end: childEnd
      });

      // 孫タスクがある場合は再帰的に処理
      const grandChildren = await getChildTasks(child.id);
      if (grandChildren.length > 0) {
        const grandScheduled = await scheduleTaskWithChildren(
          child.id,
          currentTime,
          calendarId
        );
        scheduledTasks.push(...grandScheduled);
      }

      currentTime = childEnd;
    }

    // 親タスク自体は scheduled_at を設定しない（または最初の子の時間）
    await updateTask(taskId, {
      scheduled_at: startTime.toISOString(),
      estimated_time: 0, // 親は自動集計
      target_calendar_id: calendarId
    });

  } else {
    // 子タスクがない場合は通常通りスケジュール
    const duration = task.estimated_time || 60;
    const endTime = new Date(startTime.getTime() + duration * 60000);
    await scheduleTask(taskId, startTime, endTime, calendarId);
    scheduledTasks.push({
      taskId: task.id,
      start: startTime,
      end: endTime
    });
  }

  return scheduledTasks;
}
```

### 2.3 UI: 一括スケジューリング確認

**ドロップ後の確認ダイアログ**:
```
┌──────────────────────────────────────────────┐
│  親タスクを一括スケジュール                   │
├──────────────────────────────────────────────┤
│                                              │
│  「プロジェクト計画」とその子タスク3件を      │
│  1/27(月) 9:00から順番に予定します。         │
│                                              │
│  予定一覧:                                   │
│  ├─ 9:00-11:00   要件定義 (2h)             │
│  ├─ 11:00-14:00  設計 (3h)                 │
│  │  ├─ 11:00-12:00  DB設計 (1h)           │
│  │  └─ 12:00-14:00  API設計 (2h)          │
│  └─ 14:00-19:00  実装 (5h)                 │
│     ├─ 14:00-17:00  フロントエンド (3h)   │
│     └─ 17:00-19:00  バックエンド (2h)     │
│                                              │
│  カレンダー: 🟦 仕事                         │
│                                              │
│  ⚠️ この時間帯に既存予定があります:           │
│  • 12:30-13:00  ランチMTG                   │
│                                              │
│  [ 時間調整 ]  [ キャンセル ]  [ 予定設定 ] │
└──────────────────────────────────────────────┘
```

---

## 3. 重複防止機能

### 3.1 現状の課題

**問題**: 同じタスクを何度もカレンダーにドロップすると、重複した予定が作成される

### 3.2 解決策: google_event_id による管理

#### データフロー
```typescript
// タスクをカレンダーにスケジュール
async function scheduleTask(
  taskId: string,
  startTime: Date,
  endTime: Date,
  calendarId: string
) {
  const task = await getTaskById(taskId);

  // 既に google_event_id が存在する場合は更新
  if (task.google_event_id) {
    console.log('既存イベントを更新:', task.google_event_id);

    // Googleカレンダーのイベントを更新
    await updateCalendarEvent(
      task.google_event_id,
      {
        start: startTime,
        end: endTime,
        calendarId: calendarId
      }
    );

    // タスクの scheduled_at, target_calendar_id を更新
    await updateTask(taskId, {
      scheduled_at: startTime.toISOString(),
      estimated_time: (endTime.getTime() - startTime.getTime()) / 60000,
      target_calendar_id: calendarId
    });

    return { action: 'updated', eventId: task.google_event_id };
  }

  // google_event_id がない場合は新規作成
  console.log('新規イベントを作成');
  const eventId = await createCalendarEvent({
    title: task.title,
    start: startTime,
    end: endTime,
    calendarId: calendarId
  });

  // google_event_id をタスクに保存
  await updateTask(taskId, {
    scheduled_at: startTime.toISOString(),
    estimated_time: (endTime.getTime() - startTime.getTime()) / 60000,
    google_event_id: eventId,
    target_calendar_id: calendarId
  });

  return { action: 'created', eventId };
}
```

### 3.3 UI: 既存予定の確認

**ドロップ時の挙動**:
```typescript
// ドロップハンドラ
const handleDropTask = (taskId: string, dropTime: Date) => {
  const task = tasks.find(t => t.id === taskId);

  if (task.google_event_id) {
    // 既に予定がある場合は確認ダイアログ
    showConfirmDialog({
      title: '既存の予定を移動しますか？',
      message: `「${task.title}」は既にカレンダーに予定があります。\n現在: ${task.scheduled_at}\n新しい時間: ${dropTime}`,
      actions: [
        {
          label: '移動',
          onClick: () => scheduleTask(taskId, dropTime, ...)
        },
        {
          label: 'キャンセル',
          onClick: () => {}
        }
      ]
    });
  } else {
    // 予定がない場合はそのままスケジュール
    scheduleTask(taskId, dropTime, ...);
  }
};
```

### 3.4 カレンダー切り替え時の動作

**シナリオ**: 「仕事」カレンダーに予定がある状態で、「プライベート」カレンダーにドロップ

```typescript
async function moveTaskToAnotherCalendar(
  taskId: string,
  newCalendarId: string,
  newStartTime: Date
) {
  const task = await getTaskById(taskId);

  if (task.google_event_id && task.target_calendar_id) {
    // 古いカレンダーのイベントを削除
    await deleteCalendarEvent(
      task.target_calendar_id,
      task.google_event_id
    );

    // 新しいカレンダーにイベントを作成
    const newEventId = await createCalendarEvent({
      title: task.title,
      start: newStartTime,
      end: new Date(newStartTime.getTime() + task.estimated_time * 60000),
      calendarId: newCalendarId
    });

    // タスクを更新
    await updateTask(taskId, {
      google_event_id: newEventId,
      target_calendar_id: newCalendarId,
      scheduled_at: newStartTime.toISOString()
    });

    return { moved: true, newEventId };
  }
}
```

---

## 4. 完全双方向同期

### 4.1 カレンダー上での変更を検知

#### 方法1: Webhookによるリアルタイム同期（推奨）

**Google Calendar API: Push Notifications**
```typescript
// カレンダーのWebhookを登録
async function setupCalendarWebhook(userId: string, calendarId: string) {
  const { calendar } = await getCalendarClient(userId);

  const channelId = crypto.randomUUID();
  const expiration = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7日間

  const response = await calendar.events.watch({
    calendarId: calendarId,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: `${process.env.NEXTAUTH_URL}/api/calendar/webhook`,
      expiration: expiration.toString()
    }
  });

  // channel情報を保存
  await supabase.from('calendar_channels').insert({
    user_id: userId,
    channel_id: channelId,
    calendar_id: calendarId,
    resource_id: response.data.resourceId,
    expires_at: new Date(expiration)
  });

  return response.data;
}
```

**Webhookエンドポイント**:
```typescript
// POST /api/calendar/webhook
export async function POST(request: NextRequest) {
  const channelId = request.headers.get('X-Goog-Channel-ID');
  const resourceId = request.headers.get('X-Goog-Resource-ID');
  const state = request.headers.get('X-Goog-Resource-State'); // sync, exists, not_exists

  if (state === 'sync') {
    // 初回同期確認
    return new NextResponse('OK', { status: 200 });
  }

  // チャンネル情報からユーザーを特定
  const { data: channel } = await supabase
    .from('calendar_channels')
    .select('*')
    .eq('channel_id', channelId)
    .single();

  if (!channel) {
    return new NextResponse('Channel not found', { status: 404 });
  }

  // カレンダーイベントを取得して同期
  await syncCalendarEvents(channel.user_id, channel.calendar_id);

  return new NextResponse('OK', { status: 200 });
}
```

#### 方法2: ポーリング（Webhookが使えない場合）

```typescript
// 30秒ごとにポーリング
useEffect(() => {
  const interval = setInterval(async () => {
    await fetch('/api/calendar/sync-from-calendar', {
      method: 'POST',
      body: JSON.stringify({
        lastSyncedAt: lastSyncTime
      })
    });
  }, 30000);

  return () => clearInterval(interval);
}, []);
```

### 4.2 イベント変更の検知と同期

```typescript
// カレンダーイベント同期
async function syncCalendarEvents(userId: string, calendarId: string) {
  const { calendar } = await getCalendarClient(userId);
  const lastSyncedAt = await getLastSyncTime(userId, calendarId);

  // updatedMin で差分取得
  const response = await calendar.events.list({
    calendarId: calendarId,
    updatedMin: lastSyncedAt,
    singleEvents: true,
    orderBy: 'updated'
  });

  const events = response.data.items || [];

  for (const event of events) {
    // google_event_id でタスクを検索
    const { data: task } = await supabase
      .from('tasks')
      .select('*')
      .eq('google_event_id', event.id)
      .eq('user_id', userId)
      .single();

    if (task) {
      // タスクが存在する場合は更新
      if (event.status === 'cancelled') {
        // イベントが削除された場合
        await updateTask(task.id, {
          scheduled_at: null,
          google_event_id: null
        });

        // 通知: 「カレンダーの予定が削除されました」
        await notifyUser(userId, {
          type: 'calendar_event_deleted',
          taskTitle: task.title
        });
      } else {
        // イベントが更新された場合
        const startTime = new Date(event.start.dateTime || event.start.date);
        const endTime = new Date(event.end.dateTime || event.end.date);
        const duration = (endTime.getTime() - startTime.getTime()) / 60000;

        await updateTask(task.id, {
          scheduled_at: startTime.toISOString(),
          estimated_time: duration,
          title: event.summary || task.title // タイトルも同期
        });

        // 通知: 「タスクの時間が変更されました」
        await notifyUser(userId, {
          type: 'task_time_updated',
          taskTitle: task.title,
          newTime: startTime
        });
      }
    } else {
      // タスクが存在しない場合は新規作成（カレンダーからのインポート）
      if (event.status !== 'cancelled') {
        await createTaskFromEvent(event, userId, calendarId);

        // 通知: 「新しい予定をインポートしました」
        await notifyUser(userId, {
          type: 'calendar_event_imported',
          eventTitle: event.summary
        });
      }
    }
  }

  // 最終同期時刻を更新
  await updateLastSyncTime(userId, calendarId, new Date());
}
```

### 4.3 カレンダーUI上でのドラッグ&ドロップ編集

**react-big-calendar を使用**:
```typescript
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';

const localizer = momentLocalizer(moment);

function CalendarView() {
  const [events, setEvents] = useState([]);

  // イベントのドロップ（時間変更）
  const handleEventDrop = async ({ event, start, end }) => {
    // タスクを検索
    const task = tasks.find(t => t.google_event_id === event.id);

    if (task) {
      // タスクを更新
      await updateTask(task.id, {
        scheduled_at: start.toISOString(),
        estimated_time: (end.getTime() - start.getTime()) / 60000
      });

      // Googleカレンダーを更新
      await updateCalendarEvent(event.id, {
        start: start,
        end: end
      });

      // UIを更新
      setEvents(prev => prev.map(e =>
        e.id === event.id ? { ...e, start, end } : e
      ));

      // 通知
      toast.success('予定時間を変更しました');
    }
  };

  // イベントのリサイズ（所要時間変更）
  const handleEventResize = async ({ event, start, end }) => {
    await handleEventDrop({ event, start, end });
  };

  return (
    <Calendar
      localizer={localizer}
      events={events}
      onEventDrop={handleEventDrop}
      onEventResize={handleEventResize}
      resizable
      draggableAccessor={() => true}
      style={{ height: '100%' }}
    />
  );
}
```

### 4.4 リアルタイム通知

**Supabase Realtime を使用**:
```typescript
// リアルタイムでタスク変更を監視
useEffect(() => {
  const subscription = supabase
    .channel('tasks-changes')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'tasks',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        const updatedTask = payload.new;

        // UIを更新
        setTasks(prev => prev.map(t =>
          t.id === updatedTask.id ? updatedTask : t
        ));

        // カレンダービューも更新
        if (updatedTask.scheduled_at) {
          updateCalendarView(updatedTask);
        }

        // トースト通知
        toast.info(`「${updatedTask.title}」の時間が変更されました`, {
          action: {
            label: '確認',
            onClick: () => focusOnTask(updatedTask.id)
          }
        });
      }
    )
    .subscribe();

  return () => {
    subscription.unsubscribe();
  };
}, [userId]);
```

---

## 5. データモデル（完全版）

### 5.1 tasks テーブル（拡張版）
```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS target_calendar_id TEXT DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'synced'; -- 'synced', 'pending', 'error'

-- インデックス追加（パフォーマンス最適化）
CREATE INDEX IF NOT EXISTS idx_tasks_google_event_id ON tasks(google_event_id);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_at ON tasks(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tasks_target_calendar ON tasks(target_calendar_id);
```

### 5.2 calendar_channels テーブル（Webhook管理）
```sql
CREATE TABLE IF NOT EXISTS calendar_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  calendar_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- インデックス
  INDEX idx_calendar_channels_user_id (user_id),
  INDEX idx_calendar_channels_expires_at (expires_at)
);
```

### 5.3 sync_log テーブル（同期履歴）
```sql
CREATE TABLE IF NOT EXISTS sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  task_id UUID REFERENCES tasks ON DELETE SET NULL,
  google_event_id TEXT,
  calendar_id TEXT,
  action TEXT NOT NULL, -- 'create', 'update', 'delete', 'import'
  direction TEXT NOT NULL, -- 'to_calendar', 'from_calendar'
  status TEXT NOT NULL, -- 'success', 'error', 'conflict'
  error_message TEXT,
  changes JSONB, -- 変更内容のスナップショット
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- インデックス
  INDEX idx_sync_log_user_id (user_id),
  INDEX idx_sync_log_task_id (task_id),
  INDEX idx_sync_log_synced_at (synced_at)
);
```

---

## 6. UI/UXフロー（完全版）

### フロー1: 複数カレンダー対応のドラッグ&ドロップ

```
1. ユーザー: 右サイドバーでカレンダー表示を選択
   [✓] 仕事  [✓] プライベート  [ ] 家族
   ↓
2. UI: 選択されたカレンダーのイベントを色分けで表示
   - 🟦 仕事のイベント
   - 🟣 プライベートのイベント
   ↓
3. ユーザー: MindMapから「資料作成」タスクをドラッグ
   ↓
4. UI: ドラッグ中、カレンダー上にドロップ可能エリアをハイライト
   ↓
5. ユーザー: 仕事カレンダーの月曜14:00にドロップ
   ↓
6. システム: google_event_id をチェック
   - 存在する → 確認ダイアログ「既存の予定を移動しますか？」
   - 存在しない → そのまま新規作成
   ↓
7. システム: カレンダー「仕事」に予定を作成
   - Google Calendar API: events.insert({ calendarId: 'primary' })
   - tasks.google_event_id = eventId
   - tasks.target_calendar_id = 'primary'
   ↓
8. UI: 即座に反映
   - カレンダービューに🟦「資料作成 14:00-16:00」表示
   - MindMapのタスクノードに青いカレンダーアイコン
   - トースト: 「仕事カレンダーに予定を追加しました」
```

### フロー2: 親タスクの一括スケジューリング

```
1. ユーザー: 親タスク「プロジェクト計画」をドラッグ
   - 子タスク: 要件定義(2h), 設計(3h), 実装(5h)
   ↓
2. UI: ドラッグ中、「3件の子タスクも含む」バッジ表示
   ↓
3. ユーザー: カレンダーの月曜9:00にドロップ
   ↓
4. UI: 確認ダイアログを表示
   ┌──────────────────────────────────────┐
   │ 「プロジェクト計画」とその子タスク3件を│
   │ 1/27(月) 9:00から順番に予定します。   │
   │                                      │
   │ 予定一覧:                             │
   │ ├─ 9:00-11:00   要件定義 (2h)       │
   │ ├─ 11:00-14:00  設計 (3h)           │
   │ └─ 14:00-19:00  実装 (5h)           │
   │                                      │
   │ カレンダー: 🟦 仕事                  │
   │ [ キャンセル ]         [ 予定設定 ]  │
   └──────────────────────────────────────┘
   ↓
5. ユーザー: 「予定設定」をクリック
   ↓
6. システム: 子タスクを順番にスケジュール
   - for each child:
     - Google Calendar API: events.insert()
     - tasks.google_event_id = eventId
     - tasks.scheduled_at = startTime
   ↓
7. UI: 3件の予定がカレンダーに一気に表示される
   - アニメーション: 1つずつ順番にフェードイン
   - トースト: 「3件の予定を追加しました」
```

### フロー3: カレンダー上での時間変更

```
1. ユーザー: カレンダービューで「資料作成 14:00-16:00」をドラッグ
   ↓
2. UI: ドラッグ中、時間をリアルタイム表示
   「15:00-17:00」← ドラッグ先の時間
   ↓
3. ユーザー: 15:00の位置でドロップ
   ↓
4. システム: 双方向同期開始
   a. タスクを更新（Supabase）
      - tasks.scheduled_at = '2026-01-27 15:00'
      - tasks.last_synced_at = NOW()

   b. Googleカレンダーを更新
      - calendar.events.update({
          eventId: task.google_event_id,
          start: { dateTime: '2026-01-27T15:00:00+09:00' },
          end: { dateTime: '2026-01-27T17:00:00+09:00' }
        })

   c. MindMapを更新（Realtime経由）
      - Supabase Realtimeでタスク変更を検知
      - MindMapのタスクノードの表示時刻を更新
   ↓
5. UI: 全画面で即座に反映
   - カレンダービュー: 新しい時間に移動
   - MindMap: scheduled_at が 15:00 に更新
   - トースト: 「予定時間を 15:00 に変更しました」
   ↓
6. システム: 同期ログを記録
   - sync_log に記録
     - action: 'update'
     - direction: 'from_calendar'
     - changes: { scheduled_at: { old: '14:00', new: '15:00' } }
```

### フロー4: Googleカレンダー側での変更検知

```
1. ユーザー: Googleカレンダーアプリで「資料作成」の時間を変更
   14:00-16:00 → 16:00-18:00
   ↓
2. Google: Webhook通知を送信
   POST /api/calendar/webhook
   ↓
3. システム: Webhookを受信
   - channel_id からユーザーを特定
   - calendar.events.get() で最新情報を取得
   ↓
4. システム: google_event_id でタスクを検索
   - tasks.google_event_id = event.id で検索
   ↓
5. システム: タスクを更新
   - tasks.scheduled_at = '2026-01-27 16:00'
   - tasks.estimated_time = 120
   - tasks.last_synced_at = NOW()
   ↓
6. Supabase Realtime: タスク変更をブロードキャスト
   ↓
7. UI: リアルタイムで反映（ユーザーがアプリを開いている場合）
   - MindMap: タスクの時刻表示が 16:00 に更新
   - カレンダービュー: イベントが 16:00-18:00 に移動
   - トースト通知: 「『資料作成』の時間が変更されました (Googleカレンダーから同期)」
   ↓
8. ユーザー: 通知をクリック
   ↓
9. UI: 該当タスクにフォーカス
   - MindMapでタスクをハイライト
   - 詳細パネルを表示
```

---

## 7. 技術実装詳細

### 7.1 フロントエンド

#### コンポーネント構成
```
src/components/calendar/
├── CalendarView.tsx          // メインカレンダーコンポーネント
├── CalendarSelector.tsx      // カレンダー選択UI
├── EventCard.tsx             // カレンダーイベント表示
├── TaskDropZone.tsx          // ドロップ可能エリア
├── QuickScheduleModal.tsx    // クイックスケジュールモーダル
└── BulkScheduleDialog.tsx    // 一括スケジュール確認ダイアログ

src/hooks/
├── useCalendarSync.ts        // カレンダー同期ロジック
├── useCalendarDragDrop.ts    // ドラッグ&ドロップ処理
└── useRealtimeSync.ts        // Realtime同期
```

#### useCalendarDragDrop.ts
```typescript
import { useDrag, useDrop } from 'react-dnd';

export function useCalendarDragDrop() {
  // タスクをドラッグ可能にする
  const [{ isDragging }, drag] = useDrag({
    type: 'TASK',
    item: (task: Task) => ({
      id: task.id,
      title: task.title,
      estimatedTime: task.estimated_time,
      hasChildren: task.has_children,
      childCount: task.child_count
    }),
    collect: (monitor) => ({
      isDragging: monitor.isDragging()
    })
  });

  // カレンダーのタイムスロットをドロップゾーンにする
  const [{ isOver }, drop] = useDrop({
    accept: 'TASK',
    drop: async (item: DraggedTask, monitor) => {
      const dropPosition = monitor.getClientOffset();
      const dropTime = calculateDropTime(dropPosition);

      // 親タスクの場合は確認ダイアログ
      if (item.hasChildren) {
        const confirmed = await showBulkScheduleDialog(item, dropTime);
        if (confirmed) {
          await scheduleTaskWithChildren(item.id, dropTime);
        }
      } else {
        await scheduleTask(item.id, dropTime);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver()
    })
  });

  return { drag, drop, isDragging, isOver };
}
```

### 7.2 バックエンド

#### API Routes

**1. GET /api/calendar/list** - カレンダーリスト取得
**2. GET /api/calendar/events** - イベント取得（複数カレンダー対応）
**3. POST /api/calendar/schedule-task** - タスクをスケジュール（重複防止機能付き）
**4. POST /api/calendar/schedule-bulk** - 親タスクの一括スケジュール
**5. PUT /api/calendar/update-event** - カレンダーイベント更新
**6. POST /api/calendar/webhook** - Google Webhook受信
**7. POST /api/calendar/sync-from-calendar** - カレンダー→タスク同期

#### schedule-task API（重複防止付き）
```typescript
// POST /api/calendar/schedule-task
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const {
    taskId,
    startTime,
    endTime,
    calendarId = 'primary'
  } = await request.json();

  // タスクを取得
  const { data: task } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();

  const { calendar } = await getCalendarClient(user.id);

  // 既に google_event_id がある場合
  if (task.google_event_id) {
    try {
      // 既存イベントを更新
      await calendar.events.update({
        calendarId: task.target_calendar_id || calendarId,
        eventId: task.google_event_id,
        requestBody: {
          summary: task.title,
          start: { dateTime: startTime },
          end: { dateTime: endTime }
        }
      });

      // タスクを更新
      await supabase.from('tasks').update({
        scheduled_at: startTime,
        estimated_time: calculateDuration(startTime, endTime),
        target_calendar_id: calendarId,
        last_synced_at: new Date().toISOString(),
        sync_status: 'synced'
      }).eq('id', taskId);

      return NextResponse.json({
        action: 'updated',
        eventId: task.google_event_id
      });

    } catch (error) {
      // イベントが削除されている場合は新規作成
      if (error.code === 404) {
        const newEventId = await createNewEvent();
        return NextResponse.json({
          action: 'recreated',
          eventId: newEventId
        });
      }
      throw error;
    }
  }

  // google_event_id がない場合は新規作成
  const response = await calendar.events.insert({
    calendarId: calendarId,
    requestBody: {
      summary: task.title,
      start: { dateTime: startTime },
      end: { dateTime: endTime }
    }
  });

  const eventId = response.data.id;

  // タスクに google_event_id を保存
  await supabase.from('tasks').update({
    google_event_id: eventId,
    scheduled_at: startTime,
    estimated_time: calculateDuration(startTime, endTime),
    target_calendar_id: calendarId,
    last_synced_at: new Date().toISOString(),
    sync_status: 'synced'
  }).eq('id', taskId);

  // 同期ログ
  await supabase.from('sync_log').insert({
    user_id: user.id,
    task_id: taskId,
    google_event_id: eventId,
    calendar_id: calendarId,
    action: 'create',
    direction: 'to_calendar',
    status: 'success'
  });

  return NextResponse.json({
    action: 'created',
    eventId
  });
}
```

---

## 8. 実装優先順位

### Phase 2A: 複数カレンダー対応（2週間）
1. ✅ GET /api/calendar/list 実装
2. ✅ CalendarSelector コンポーネント
3. ✅ tasks.target_calendar_id カラム追加
4. ✅ カレンダー別色分け表示

### Phase 2B: 重複防止機能（1週間）
5. ✅ google_event_id チェックロジック
6. ✅ 既存予定の確認ダイアログ
7. ✅ イベント更新処理

### Phase 2C: 親タスク一括スケジュール（2週間）
8. ✅ POST /api/calendar/schedule-bulk 実装
9. ✅ 子タスク展開アルゴリズム
10. ✅ BulkScheduleDialog コンポーネント

### Phase 2D: カレンダーUI上のドラッグ&ドロップ（2週間）
11. ✅ react-big-calendar 導入
12. ✅ イベントのドラッグ&ドロップ編集
13. ✅ イベントのリサイズ（所要時間変更）

### Phase 2E: 完全双方向同期（3週間）
14. ✅ POST /api/calendar/webhook 実装
15. ✅ Google Calendar Push Notifications設定
16. ✅ Supabase Realtime統合
17. ✅ リアルタイム通知UI

---

## 9. テスト計画

### 単体テスト
- [ ] 重複防止ロジック
- [ ] 子タスク展開アルゴリズム
- [ ] 時間計算ロジック

### 統合テスト
- [ ] タスク→カレンダー同期
- [ ] カレンダー→タスク同期
- [ ] 複数カレンダー間の移動

### E2Eテスト
- [ ] ドラッグ&ドロップフロー
- [ ] 親タスク一括スケジュール
- [ ] Webhook受信→UI更新

---

## 10. まとめ

この改良版設計により、Shikumikaは以下の価値を提供します：

### ✨ 新機能
1. **複数カレンダー対応**: 仕事・プライベートを分けて管理
2. **親タスク一括スケジュール**: 子タスクも含めて一気に予定化
3. **重複防止**: 同じタスクを2回予定に入れない安全機構
4. **完全双方向同期**: カレンダーでの変更がタスクに即座に反映

### 🎯 ユーザー価値
- **効率的**: ドラッグ&ドロップで素早く予定設定
- **柔軟**: カレンダーを切り替えて用途別に管理
- **安心**: 重複や競合を自動検知
- **シームレス**: どこで変更してもすぐに同期

次のステップ: Phase 2Aから実装を開始します。
