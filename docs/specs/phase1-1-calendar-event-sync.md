# Phase 1.1: カレンダーイベントの双方向同期

## 📋 概要

### 目的
Googleカレンダーの予定を完全に取り込み、Shikumika App上で表示・編集・作成し、変更を双方向で同期する。

### 背景
- ユーザーは既にGoogleカレンダーで予定を管理している
- 予定とタスクを一つの画面で統合して管理したい
- 予定の変更をリアルタイムに近い形で反映したい

### スコープ
- Googleカレンダーからのイベント取得
- イベントの表示（週ビュー・月ビュー）
- イベントの編集（ドラッグ&ドロップ含む）
- イベントの作成・削除
- 双方向同期（Shikumika ⇄ Google Calendar）

---

## 🎯 要件定義

### 機能要件

#### FR-1: イベント取得
- Googleカレンダーから過去1ヶ月〜未来3ヶ月のイベントを取得
- 複数のカレンダーに対応
- 繰り返しイベント（recurring events）に対応
- 全日イベントに対応

#### FR-2: イベント表示
- 週ビューにイベントを時間軸で表示
- 月ビューにイベントをカレンダー形式で表示
- カレンダーごとに色分け
- イベントの詳細情報をポップオーバーで表示
- タイムゾーンを考慮した表示

#### FR-3: イベント編集
- ドラッグ&ドロップで日時を変更
- フォームで詳細情報を編集（タイトル、説明、開始/終了時間、場所）
- 編集内容を即座にGoogle Calendar APIに反映
- オプティミスティックUI（楽観的UI更新）

#### FR-4: イベント作成
- カレンダー上でクリック/ダブルクリックで新規イベント作成
- タスクからイベントへの変換（ドラッグ&ドロップ）
- 作成内容をGoogle Calendar APIに送信

#### FR-5: イベント削除
- イベント削除機能
- 削除をGoogle Calendar APIに反映
- 削除確認ダイアログ

#### FR-6: 同期
- 5分間隔での自動同期（バックグラウンド）
- 手動同期ボタン
- Google Calendar Push Notifications（Webhook）の実装準備

### 非機能要件

#### NFR-1: パフォーマンス
- イベント取得: 3秒以内
- イベント表示: 1秒以内
- イベント編集の反映: 2秒以内

#### NFR-2: 信頼性
- APIエラー時のリトライ処理（最大3回）
- オフライン対応（ローカルキャッシュ）
- 同期エラー時のユーザー通知

#### NFR-3: セキュリティ
- OAuth 2.0によるセキュアな認証
- トークンの暗号化保存
- ユーザーごとのデータ分離

---

## 🏗️ 技術仕様

### システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js)                      │
├─────────────────────────────────────────────────────────────┤
│  CalendarView Component                                      │
│    ├─ CalendarWeekView                                       │
│    └─ CalendarMonthView                                      │
├─────────────────────────────────────────────────────────────┤
│  useCalendarEvents Hook                                      │
│  useCalendarSync Hook                                        │
├─────────────────────────────────────────────────────────────┤
│                    API Routes (Next.js)                      │
│  ├─ /api/calendar/events/list       (GET)                   │
│  ├─ /api/calendar/events/create     (POST)                  │
│  ├─ /api/calendar/events/update     (PATCH)                 │
│  ├─ /api/calendar/events/delete     (DELETE)                │
│  └─ /api/calendar/sync              (POST)                  │
├─────────────────────────────────────────────────────────────┤
│                 Google Calendar API                          │
│  ├─ calendar.events.list()                                  │
│  ├─ calendar.events.insert()                                │
│  ├─ calendar.events.update()                                │
│  ├─ calendar.events.delete()                                │
│  └─ calendar.calendarList.list()                            │
├─────────────────────────────────────────────────────────────┤
│                  Database (Supabase)                         │
│  ├─ calendar_events (キャッシュ)                             │
│  ├─ user_calendars (設定)                                    │
│  └─ calendar_tokens (OAuth トークン)                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ データベース設計

### calendar_events テーブル

```sql
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  google_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL, -- GoogleカレンダーのID

  -- イベント情報
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,

  -- 時間情報
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN DEFAULT false,
  timezone TEXT DEFAULT 'Asia/Tokyo',

  -- 繰り返し情報
  recurrence TEXT[], -- RRULE配列
  recurring_event_id TEXT, -- 繰り返しイベントの親ID

  -- 表示情報
  color TEXT,
  background_color TEXT,

  -- メタ情報
  google_created_at TIMESTAMPTZ,
  google_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- インデックス
  UNIQUE(user_id, google_event_id),
  INDEX idx_user_calendar (user_id, calendar_id),
  INDEX idx_time_range (user_id, start_time, end_time)
);

-- RLS (Row Level Security)
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own events"
  ON calendar_events
  FOR ALL
  USING (auth.uid() = user_id);
```

### calendar_tokens テーブル

```sql
CREATE TABLE calendar_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL UNIQUE,

  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  expiry_date TIMESTAMPTZ NOT NULL,

  scope TEXT[], -- 許可されたスコープ

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  INDEX idx_user_id (user_id)
);

-- RLS
ALTER TABLE calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own tokens"
  ON calendar_tokens
  FOR ALL
  USING (auth.uid() = user_id);
```

---

## 🔌 API設計

### 1. イベント一覧取得

**Endpoint:** `GET /api/calendar/events/list`

**Query Parameters:**
```typescript
{
  calendarId?: string;      // 特定のカレンダーのみ（省略時は全て）
  timeMin: string;          // ISO 8601形式（例: 2026-01-01T00:00:00Z）
  timeMax: string;          // ISO 8601形式
  forceSync?: boolean;      // trueの場合、キャッシュを無視してGoogle APIから取得
}
```

**Response:**
```typescript
{
  success: true,
  events: [
    {
      id: string;                    // Supabase UUID
      googleEventId: string;         // Google Event ID
      calendarId: string;            // Google Calendar ID
      title: string;
      description?: string;
      location?: string;
      startTime: string;             // ISO 8601
      endTime: string;               // ISO 8601
      isAllDay: boolean;
      timezone: string;
      color?: string;
      backgroundColor?: string;
      recurrence?: string[];
      recurringEventId?: string;
      googleCreatedAt: string;
      googleUpdatedAt: string;
      syncedAt: string;
    }
  ],
  syncedAt: string;
}
```

**Error Response:**
```typescript
{
  success: false,
  error: {
    code: string;        // 'UNAUTHORIZED' | 'TOKEN_EXPIRED' | 'API_ERROR'
    message: string;
  }
}
```

---

### 2. イベント作成

**Endpoint:** `POST /api/calendar/events/create`

**Request Body:**
```typescript
{
  calendarId: string;        // 作成先のカレンダーID
  title: string;
  description?: string;
  location?: string;
  startTime: string;         // ISO 8601
  endTime: string;           // ISO 8601
  isAllDay?: boolean;
  timezone?: string;         // デフォルト: 'Asia/Tokyo'
  color?: string;
}
```

**Response:**
```typescript
{
  success: true,
  event: {
    id: string;              // Supabase UUID
    googleEventId: string;   // Google Event ID
    // ... 他のフィールドは list と同じ
  }
}
```

---

### 3. イベント更新

**Endpoint:** `PATCH /api/calendar/events/update`

**Request Body:**
```typescript
{
  id: string;                // Supabase UUID
  calendarId: string;        // GoogleカレンダーID
  googleEventId: string;     // Google Event ID

  // 更新するフィールド（部分更新）
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  color?: string;
}
```

**Response:**
```typescript
{
  success: true,
  event: { /* 更新後のイベント */ }
}
```

---

### 4. イベント削除

**Endpoint:** `DELETE /api/calendar/events/delete`

**Request Body:**
```typescript
{
  id: string;                // Supabase UUID
  calendarId: string;        // GoogleカレンダーID
  googleEventId: string;     // Google Event ID
}
```

**Response:**
```typescript
{
  success: true,
  message: "Event deleted successfully"
}
```

---

### 5. 手動同期

**Endpoint:** `POST /api/calendar/sync`

**Request Body:**
```typescript
{
  calendarIds?: string[];    // 特定のカレンダーのみ同期（省略時は全て）
}
```

**Response:**
```typescript
{
  success: true,
  syncedCount: number,
  syncedAt: string;
}
```

---

## 🎨 UIコンポーネント設計

### 1. CalendarEventCard

**Props:**
```typescript
interface CalendarEventCardProps {
  event: CalendarEvent;
  onEdit: (eventId: string) => void;
  onDelete: (eventId: string) => void;
  isDraggable: boolean;
}
```

**機能:**
- イベントの基本情報を表示（タイトル、時間、場所）
- ホバー時に編集・削除ボタンを表示
- ドラッグ可能（isDraggable=true時）
- クリックで詳細ポップオーバーを表示

---

### 2. CalendarEventPopover

**Props:**
```typescript
interface CalendarEventPopoverProps {
  event: CalendarEvent;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}
```

**機能:**
- イベントの詳細情報を表示
- 編集ボタン → EventEditDialog を開く
- 削除ボタン → 確認ダイアログ → 削除実行

---

### 3. CalendarEventEditDialog

**Props:**
```typescript
interface CalendarEventEditDialogProps {
  event?: CalendarEvent;     // 新規作成時はundefined
  isOpen: boolean;
  onClose: () => void;
  onSave: (event: Partial<CalendarEvent>) => Promise<void>;
}
```

**機能:**
- イベントの作成・編集フォーム
- フィールド: タイトル、説明、場所、開始時間、終了時間、終日フラグ
- バリデーション（開始時間 < 終了時間）
- 保存時にAPI呼び出し

---

### 4. CalendarSyncButton

**Props:**
```typescript
interface CalendarSyncButtonProps {
  onSync: () => Promise<void>;
}
```

**機能:**
- 手動同期ボタン
- クリック時に同期APIを呼び出し
- ローディング状態を表示
- 最終同期時刻を表示

---

## 🔗 統合ポイント

### 既存コンポーネントとの統合

#### 1. CalendarWeekView との統合

**ファイル:** `src/components/calendar/calendar-week-view.tsx`

**変更点:**
```typescript
// Before
export function CalendarWeekView({ currentDate, onTaskDrop }: CalendarWeekViewProps) {
  // タスクのみ表示
}

// After
export function CalendarWeekView({
  currentDate,
  onTaskDrop,
  events,              // 追加: カレンダーイベント
  onEventDrop,         // 追加: イベントのドロップハンドラ
  onEventEdit,         // 追加: イベント編集ハンドラ
  onEventDelete        // 追加: イベント削除ハンドラ
}: CalendarWeekViewProps) {
  // タスクとイベントを両方表示
}
```

**実装:**
- タスクとイベントを時間軸に統合表示
- イベントは異なるスタイル（背景色、ボーダー）で区別
- ドラッグ&ドロップでイベントの日時を変更

---

#### 2. CalendarMonthView との統合

**ファイル:** `src/components/calendar/calendar-month-view.tsx`

**変更点:**
```typescript
export function CalendarMonthView({
  currentDate,
  onTaskDrop,
  events,              // 追加
  onEventClick         // 追加
}: CalendarMonthViewProps) {
  // 各日のセルにイベントを表示
}
```

**実装:**
- 各日のセルにイベントを最大3件表示
- 4件以上の場合は「+N more」を表示
- クリックで日ビューに展開 or ポップオーバー表示

---

## 🪝 Custom Hooks設計

### useCalendarEvents

**目的:** イベントの取得・管理

```typescript
import { useState, useEffect, useCallback } from 'react';
import { CalendarEvent } from '@/types/calendar';

interface UseCalendarEventsOptions {
  timeMin: Date;
  timeMax: Date;
  calendarIds?: string[];
  autoSync?: boolean;
  syncInterval?: number;  // ミリ秒（デフォルト: 300000 = 5分）
}

export function useCalendarEvents(options: UseCalendarEventsOptions) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // イベント取得
  const fetchEvents = useCallback(async (forceSync = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/events/list?' + new URLSearchParams({
        timeMin: options.timeMin.toISOString(),
        timeMax: options.timeMax.toISOString(),
        forceSync: forceSync.toString(),
        ...(options.calendarIds && { calendarId: options.calendarIds.join(',') })
      }));

      if (!response.ok) throw new Error('Failed to fetch events');

      const data = await response.json();
      setEvents(data.events);
      setLastSyncedAt(new Date(data.syncedAt));
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [options.timeMin, options.timeMax, options.calendarIds]);

  // 自動同期
  useEffect(() => {
    if (!options.autoSync) return;

    fetchEvents();
    const interval = setInterval(
      () => fetchEvents(),
      options.syncInterval || 300000
    );

    return () => clearInterval(interval);
  }, [fetchEvents, options.autoSync, options.syncInterval]);

  // 手動同期
  const syncNow = useCallback(() => {
    return fetchEvents(true);
  }, [fetchEvents]);

  return {
    events,
    isLoading,
    error,
    lastSyncedAt,
    syncNow,
    refetch: fetchEvents
  };
}
```

---

### useCalendarEventMutations

**目的:** イベントの作成・更新・削除

```typescript
import { useState, useCallback } from 'react';
import { CalendarEvent, CreateEventInput, UpdateEventInput } from '@/types/calendar';

export function useCalendarEventMutations() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // イベント作成
  const createEvent = useCallback(async (input: CreateEventInput): Promise<CalendarEvent> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/events/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });

      if (!response.ok) throw new Error('Failed to create event');

      const data = await response.json();
      return data.event;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // イベント更新
  const updateEvent = useCallback(async (input: UpdateEventInput): Promise<CalendarEvent> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/events/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });

      if (!response.ok) throw new Error('Failed to update event');

      const data = await response.json();
      return data.event;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // イベント削除
  const deleteEvent = useCallback(async (
    id: string,
    calendarId: string,
    googleEventId: string
  ): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/events/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, calendarId, googleEventId })
      });

      if (!response.ok) throw new Error('Failed to delete event');
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    createEvent,
    updateEvent,
    deleteEvent,
    isLoading,
    error
  };
}
```

---

## 🧪 テスト観点

### 単体テスト

#### API Routes
- [ ] イベント取得: 正常系（200 OK）
- [ ] イベント取得: 認証エラー（401 Unauthorized）
- [ ] イベント取得: トークン期限切れ → リフレッシュ → 再試行
- [ ] イベント作成: 正常系
- [ ] イベント作成: バリデーションエラー
- [ ] イベント更新: 正常系
- [ ] イベント削除: 正常系

#### Custom Hooks
- [ ] useCalendarEvents: 初回フェッチ
- [ ] useCalendarEvents: 自動同期（5分間隔）
- [ ] useCalendarEvents: 手動同期
- [ ] useCalendarEventMutations: 作成成功
- [ ] useCalendarEventMutations: エラーハンドリング

#### コンポーネント
- [ ] CalendarEventCard: 表示
- [ ] CalendarEventCard: ドラッグ開始
- [ ] CalendarEventPopover: 表示
- [ ] CalendarEventEditDialog: 新規作成
- [ ] CalendarEventEditDialog: 編集
- [ ] CalendarEventEditDialog: バリデーション

---

### 統合テスト

- [ ] イベント取得 → 表示 → 編集 → Google側に反映
- [ ] タスクをカレンダーにドロップ → イベント作成
- [ ] イベントをドラッグ → 日時変更 → Google側に反映
- [ ] カレンダーセレクターで非表示 → イベントが消える

---

### E2Eテスト

- [ ] ユーザーログイン → カレンダー連携 → イベント表示
- [ ] イベント作成 → Googleカレンダーで確認
- [ ] Googleカレンダーで編集 → Shikumika Appに反映（5分以内）

---

## 📦 実装の優先順位

### Phase 1-1-1: イベント取得の実装（最優先）
1. `calendar_events`テーブル作成
2. `calendar_tokens`テーブル作成
3. `/api/calendar/events/list` 実装
4. `useCalendarEvents` Hook 実装
5. 週ビューにイベント表示

### Phase 1-1-2: イベント表示の強化
1. 月ビューにイベント表示
2. カレンダーごとの色分け
3. イベント詳細ポップオーバー

### Phase 1-1-3: イベント編集機能
1. `/api/calendar/events/update` 実装
2. ドラッグ&ドロップで日時変更
3. 編集フォーム

### Phase 1-1-4: イベント作成機能
1. `/api/calendar/events/create` 実装
2. 新規作成フォーム
3. タスクからの変換

---

## 📚 参考資料

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/v3/reference)
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [@hello-pangea/dnd Documentation](https://github.com/hello-pangea/dnd)

---

**作成日:** 2026-01-28
**対象バージョン:** v1.0.0
**担当:** Architect AI (Sonnet 4.5)
