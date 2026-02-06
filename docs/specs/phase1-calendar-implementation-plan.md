# Phase 1: Googleカレンダー完全連携 - 統合実装計画

**作成日:** 2026-01-28
**対象バージョン:** v1.0.0
**ステータス:** 実装中

---

## 📊 実装状況サマリー

| サブフェーズ | ステータス | 進捗 | 備考 |
|------------|----------|------|------|
| 1.1 イベント同期 | 一部完了 | 60% | イベント取得・表示は実装済み |
| 1.2 マルチカレンダー対応 | 未着手 | 0% | これから実装 |
| 1.3 通知機能 | 完了 | 100% | Phase 1-3完了済み |
| 1.4 タスク所要時間管理 | 一部完了 | 70% | 基本機能実装済み、統合待ち |

---

## 🎯 今回実装する範囲（優先順位順）

### 即時実装（Sprint 1）
1. **カレンダー表示の修正** ✅ 完了
   - コントラスト改善（白背景→ダークテキスト）
   - 文字サイズ縮小（10px → 9px）
   - シンプルな表示（時間・タスクID削除）

### 次期実装（Sprint 2）
2. **Phase 1.2: マルチカレンダー対応** 🔥 今ここ
   - 全カレンダー取得（共有・チーム含む）
   - カレンダーセレクターUI拡張
   - 表示/非表示切り替え

### 後続実装（Sprint 3+）
3. **Phase 1.4 統合**
   - カレンダービューへのタスクブロック統合
   - タスク編集UIへの統合
   - 重複警告機能

---

## 📋 Phase 1.2: マルチカレンダー対応（詳細仕様）

### 目的
ユーザーの全てのGoogleカレンダー（共有カレンダー、チームカレンダーを含む）を取得し、右上のカレンダーセレクターから表示/非表示を切り替えられるようにする。

### 背景
- 現在はメインのカレンダーのみを取得している
- ユーザーは上司・チームと共有しているカレンダーを持っている
- 複数のカレンダーを統合して表示したい
- カレンダーごとに色分けして見分けたい
- 必要なカレンダーだけを選択して表示したい

---

## 🗄️ データベース設計

### user_calendars テーブル

```sql
-- 既存テーブルの拡張版
CREATE TABLE user_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  google_calendar_id TEXT NOT NULL,

  -- カレンダー情報
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,                  -- カレンダーの場所（オプション）
  timezone TEXT DEFAULT 'Asia/Tokyo',

  -- 表示情報
  color TEXT,                     -- 前景色（Googleから取得）
  background_color TEXT,          -- 背景色（Googleから取得）
  selected BOOLEAN DEFAULT true,  -- 表示選択状態（旧: is_visible）

  -- アクセス権限
  access_level TEXT,              -- 'owner', 'writer', 'reader', 'freeBusyReader'
  primary BOOLEAN DEFAULT false,  -- プライマリカレンダーかどうか

  -- メタ情報
  google_created_at TIMESTAMPTZ,
  google_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- 制約
  UNIQUE(user_id, google_calendar_id)
);

-- インデックス
CREATE INDEX idx_user_calendars_user_id ON user_calendars(user_id);
CREATE INDEX idx_user_calendars_selected ON user_calendars(user_id, selected) WHERE selected = true;

-- RLS
ALTER TABLE user_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own calendars"
  ON user_calendars
  FOR ALL
  USING (auth.uid() = user_id);
```

---

## 🔌 API設計

### 既存APIの変更点

#### 1. カレンダーリスト取得（拡張）

**Endpoint:** `GET /api/calendars`

**新規作成（既存の `/api/calendar/list` を置換）**

**Query Parameters:**
```typescript
{
  forceSync?: boolean;      // trueの場合、Google APIから再取得
}
```

**Response:**
```typescript
{
  success: true,
  calendars: [
    {
      id: string;                    // Supabase UUID
      googleCalendarId: string;      // Google Calendar ID
      name: string;
      description?: string;
      location?: string;
      timezone: string;
      color: string;
      backgroundColor: string;
      accessLevel: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
      primary: boolean;
      selected: boolean;             // 旧: isVisible
      googleCreatedAt: string;
      googleUpdatedAt: string;
      syncedAt: string;
    }
  ],
  syncedAt: string;
}
```

**Google Calendar API呼び出し:**
```typescript
// 全てのカレンダーを取得（共有・購読含む）
const response = await calendar.calendarList.list({
  minAccessRole: 'freeBusyReader',  // 最小限の権限でも取得
  showHidden: false                  // 非表示カレンダーは除外
});
```

---

#### 2. カレンダー表示切り替え（拡張）

**Endpoint:** `PATCH /api/calendars/:id`

**既存の `/api/calendar/visibility` を置換**

**Request Body:**
```typescript
{
  selected: boolean;  // 旧: isVisible
}
```

**Response:**
```typescript
{
  success: true,
  calendar: {
    id: string;
    selected: boolean;
  }
}
```

---

#### 3. イベント一覧取得（拡張）

**Endpoint:** `POST /api/calendar/events/list`

**既存機能を拡張してマルチカレンダー対応**

**Request Body:**
```typescript
{
  timeMin: string;              // ISO 8601
  timeMax: string;              // ISO 8601
  calendarIds?: string[];       // 選択されたカレンダーID（省略時はDBから取得）
  forceSync?: boolean;
}
```

**Response:**
```typescript
{
  success: true,
  events: CalendarEvent[],      // 全選択カレンダーのイベント
  syncedAt: string;
}
```

**処理内容:**
1. `calendarIds` が省略された場合、`user_calendars` テーブルから `selected=true` のカレンダーを取得
2. 各カレンダーからイベントを取得
3. 統合して返す

---

## 🎨 UIコンポーネント設計

### CalendarSelector コンポーネント（拡張）

**ファイル:** `src/components/calendar/calendar-selector.tsx`

**既存コンポーネントを拡張**

```typescript
interface CalendarSelectorProps {
  onVisibleCalendarIdsChange?: (ids: string[]) => void;
  compact?: boolean;  // コンパクトモード（カレンダー上部用）
}

export function CalendarSelector({
  onVisibleCalendarIdsChange,
  compact = false
}: CalendarSelectorProps) {
  const { calendars, isLoading, syncCalendars, toggleCalendar, toggleAll } = useCalendars();

  // 表示中のカレンダーIDのリストを親に通知
  useEffect(() => {
    const visibleIds = calendars.filter(c => c.selected).map(c => c.googleCalendarId);
    onVisibleCalendarIdsChange?.(visibleIds);
  }, [calendars, onVisibleCalendarIdsChange]);

  // ...
}
```

**コンパクトモードのレイアウト:**
```
┌──────────────────────────────────────────────┐
│ Calendars: [☑Personal] [☑Work] [☐Family] ...  │
└──────────────────────────────────────────────┘
```

**詳細モードのレイアウト（サイドバー用）:**
```
┌─────────────────────────────────┐
│ My Calendars       [Sync] [All] │
├─────────────────────────────────┤
│ ☑ 🔵 Personal (Primary)         │
│ ☑ 🟢 Work                       │
│ ☐ 🟡 Family                     │
│ ☑ 🔴 Boss (Shared)              │
│ ☐ 🟣 Team Project (Shared)       │
└─────────────────────────────────┘
```

---

## 🪝 Custom Hooks設計

### useCalendars（新規作成）

**ファイル:** `src/hooks/useCalendars.ts`

```typescript
import { useState, useCallback } from 'react';

export interface UserCalendar {
  id: string;
  googleCalendarId: string;
  name: string;
  description?: string;
  location?: string;
  timezone: string;
  color: string;
  backgroundColor: string;
  accessLevel: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  primary: boolean;
  selected: boolean;
  googleCreatedAt: string;
  googleUpdatedAt: string;
  syncedAt: string;
}

export function useCalendars() {
  const [calendars, setCalendars] = useState<UserCalendar[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // カレンダーリストを取得
  const fetchCalendars = useCallback(async (forceSync = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/calendars${forceSync ? '?forceSync=true' : ''}`);

      if (!response.ok) throw new Error('Failed to fetch calendars');

      const data = await response.json();
      setCalendars(data.calendars);

      // ローカルストレージにも保存
      localStorage.setItem('calendar-selection', JSON.stringify(
        data.calendars.reduce((acc: Record<string, boolean>, cal: UserCalendar) => {
          acc[cal.googleCalendarId] = cal.selected;
          return acc;
        }, {})
      ));
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // カレンダーの表示/非表示を切り替え
  const toggleCalendar = useCallback(async (id: string, selected: boolean) => {
    // Optimistic Update
    setCalendars(prev => prev.map(cal =>
      cal.id === id ? { ...cal, selected } : cal
    ));

    try {
      const response = await fetch(`/api/calendars/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected })
      });

      if (!response.ok) throw new Error('Failed to toggle calendar');

      // ローカルストレージを更新
      const calendar = calendars.find(c => c.id === id);
      if (calendar) {
        const stored = JSON.parse(localStorage.getItem('calendar-selection') || '{}');
        stored[calendar.googleCalendarId] = selected;
        localStorage.setItem('calendar-selection', JSON.stringify(stored));
      }
    } catch (err) {
      // Rollback
      setCalendars(prev => prev.map(cal =>
        cal.id === id ? { ...cal, selected: !selected } : cal
      ));
      setError(err as Error);
      throw err;
    }
  }, [calendars]);

  // 全選択/全解除
  const toggleAll = useCallback(async (selected: boolean) => {
    // Optimistic Update
    setCalendars(prev => prev.map(cal => ({ ...cal, selected })));

    try {
      // 各カレンダーを個別に更新
      await Promise.all(
        calendars.map(cal =>
          fetch(`/api/calendars/${cal.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selected })
          })
        )
      );

      // ローカルストレージを更新
      const stored = calendars.reduce((acc, cal) => {
        acc[cal.googleCalendarId] = selected;
        return acc;
      }, {} as Record<string, boolean>);
      localStorage.setItem('calendar-selection', JSON.stringify(stored));
    } catch (err) {
      // Rollback
      fetchCalendars();
      setError(err as Error);
    }
  }, [calendars, fetchCalendars]);

  return {
    calendars,
    isLoading,
    error,
    fetchCalendars,
    toggleCalendar,
    toggleAll
  };
}
```

---

### useCalendarEvents（拡張）

**ファイル:** `src/hooks/useCalendarEvents.ts`

**既存フックを拡張してマルチカレンダー対応**

```typescript
interface UseCalendarEventsOptions {
  timeMin: Date;
  timeMax: Date;
  selectedCalendarIds?: string[];  // 追加
  autoSync?: boolean;
  syncInterval?: number;
}

export function useCalendarEvents(options: UseCalendarEventsOptions) {
  // ...

  // イベント取得時に選択カレンダーを考慮
  const fetchEvents = useCallback(async (forceSync = false) => {
    // ...
    const response = await fetch('/api/calendar/events/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: options.timeMin.toISOString(),
        timeMax: options.timeMax.toISOString(),
        calendarIds: options.selectedCalendarIds,  // 選択カレンダーのみ取得
        forceSync
      })
    });
    // ...
  }, [options.selectedCalendarIds, /* ... */]);

  // ...
}
```

---

## 📦 実装の優先順位

### Phase 1.2-1: データベースと基盤（最優先）
1. `user_calendars` テーブルの作成・マイグレーション
2. 型定義の追加
3. Google Calendar APIから全カレンダー取得機能の実装

### Phase 1.2-2: API実装
4. `GET /api/calendars` の実装（新規、既存の `/api/calendar/list` を置換）
5. `PATCH /api/calendars/:id` の実装（新規、既存の `/api/calendar/visibility` を置換）
6. `POST /api/calendar/events/list` の拡張

### Phase 1.2-3: Hooks実装
7. `useCalendars` Hook の実装
8. `useCalendarEvents` Hook の拡張

### Phase 1.2-4: UI実装
9. `CalendarSelector` コンポーネントの拡張
10. コンパクトモードの追加
11. `CalendarView` との統合

---

## 🔗 統合ポイント

### CalendarView コンポーネント

**ファイル:** `src/components/calendar/calendar-view.tsx`

```typescript
export function CalendarView() {
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);

  const { calendars, fetchCalendars, toggleCalendar } = useCalendars();
  const { events, refreshEvents } = useCalendarEvents({
    timeMin: startOfWeek(currentDate),
    timeMax: endOfWeek(currentDate),
    selectedCalendarIds: visibleCalendarIds  // 選択カレンダーのイベントのみ取得
  });

  // 初回ロード時にカレンダーリストを取得
  useEffect(() => {
    fetchCalendars();
  }, []);

  // カレンダー選択時にイベントを再取得
  useEffect(() => {
    refreshEvents();
  }, [visibleCalendarIds]);

  return (
    <div className="flex flex-col h-full">
      {/* カレンダーセレクター（コンパクトモード） */}
      <CalendarSelector
        onVisibleCalendarIdsChange={setVisibleCalendarIds}
        compact={true}
      />

      {/* カレンダービュー */}
      {viewMode === 'week' ? (
        <CalendarWeekView
          events={events}
          onEventEdit={/* ... */}
          onEventDelete={/* ... */}
        />
      ) : (
        <CalendarMonthView
          events={events}
          onEventClick={/* ... */}
        />
      )}
    </div>
  );
}
```

---

## 🧪 テスト観点

### 単体テスト

#### API Routes
- [ ] `GET /api/calendars`: 正常系（全カレンダー取得）
- [ ] `GET /api/calendars`: 共有カレンダーを含む
- [ ] `GET /api/calendars`: forceSync でGoogle APIから再取得
- [ ] `PATCH /api/calendars/:id`: 表示切り替え
- [ ] `POST /api/calendar/events/list`: 選択カレンダーのイベントのみ取得

#### Custom Hooks
- [ ] `useCalendars`: 初回取得
- [ ] `useCalendars`: toggleCalendar（Optimistic Update）
- [ ] `useCalendars`: toggleAll
- [ ] `useCalendarEvents`: selectedCalendarIds でフィルタリング

#### Components
- [ ] `CalendarSelector`: カレンダーリスト表示
- [ ] `CalendarSelector`: コンパクトモード表示
- [ ] `CalendarSelector`: 全選択ボタン

### 統合テスト

- [ ] カレンダー取得 → 全カレンダー表示（共有含む）
- [ ] カレンダー選択解除 → 該当イベントが消える
- [ ] 全選択 → 全てのイベント表示
- [ ] ローカルストレージに設定保存 → ページリロード → 設定復元

---

## 📚 参考資料

### 既存仕様書
- [docs/specs/phase1-1-calendar-event-sync.md](./phase1-1-calendar-event-sync.md) - イベント同期
- [docs/specs/phase1-2-calendar-selector.md](./phase1-2-calendar-selector.md) - カレンダーセレクター（基本）
- [docs/specs/phase1-3-notification-system.md](./phase1-3-notification-system.md) - 通知機能
- [docs/specs/phase1-4-task-time-management.md](./phase1-4-task-time-management.md) - タスク時間管理

### 外部リファレンス
- [Google Calendar API - CalendarList](https://developers.google.com/calendar/api/v3/reference/calendarList)
- [Google Calendar API - Events](https://developers.google.com/calendar/api/v3/reference/events)

---

## 🚨 注意事項

### APIレート制限
- Google Calendar APIにはレート制限がある
- 複数カレンダーのイベント取得には並列処理を検討
- キャッシュを活用してAPI呼び出しを削減

### パフォーマンス
- カレンダー数が多い場合の表示遅延対策
- イベント取得の並列処理
- データベースのインデックス最適化

### プライバシー
- 他のユーザーの共有カレンダーの扱いに注意
- 閲覧のみのカレンダーは適切に表示

---

**最終更新:** 2026-01-28
**次のレビュー:** Sprint 2 完了時
