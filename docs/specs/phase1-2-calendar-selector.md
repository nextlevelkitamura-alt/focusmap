# Phase 1.2: カレンダーセレクター機能

## 📋 概要

### 目的
複数のGoogleカレンダーを管理し、チェックボックスで表示/非表示を切り替える機能を実装する。

### 背景
- ユーザーは通常、複数のGoogleカレンダーを持っている（個人、仕事、家族など）
- 全てのカレンダーを常に表示すると画面が煩雑になる
- Googleカレンダーと同様の直感的なUI/UXを提供する

### スコープ
- ユーザーのカレンダー一覧の取得
- カレンダーの表示/非表示切り替え
- カレンダーごとの色管理
- 設定の永続化

---

## 🎯 要件定義

### 機能要件

#### FR-1: カレンダーリストの取得
- Google Calendar APIからカレンダー一覧を取得
- プライマリカレンダー、セカンダリカレンダー、購読カレンダーに対応
- カレンダーの色情報を取得
- データベースに保存

#### FR-2: カレンダーリストの表示
- 右サイドバーにカレンダーリストを表示
- カレンダー名、色、チェックボックスを表示
- プライマリカレンダーにバッジ表示

#### FR-3: 表示/非表示の切り替え
- チェックボックスでON/OFF
- リアルタイムでカレンダービューに反映
- 設定をローカルストレージとDBに保存

#### FR-4: 全選択/全解除
- 全てのカレンダーを一括で表示/非表示
- ワンクリックで切り替え

#### FR-5: カレンダーごとの色管理
- Googleカレンダーの色を自動取得
- カスタム色設定機能（オプション）
- 色の変更を即座に反映

---

## 🗄️ データベース設計

### user_calendars テーブル

```sql
CREATE TABLE user_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  google_calendar_id TEXT NOT NULL,

  -- カレンダー情報
  name TEXT NOT NULL,
  description TEXT,
  timezone TEXT DEFAULT 'Asia/Tokyo',

  -- 表示情報
  color TEXT,                    -- 前景色（テキスト色）
  background_color TEXT,         -- 背景色
  is_visible BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false,

  -- アクセス権限
  access_role TEXT,              -- 'owner', 'writer', 'reader'

  -- メタ情報
  google_created_at TIMESTAMPTZ,
  google_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- 制約
  UNIQUE(user_id, google_calendar_id),
  INDEX idx_user_id (user_id),
  INDEX idx_visible (user_id, is_visible)
);

-- RLS (Row Level Security)
ALTER TABLE user_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own calendars"
  ON user_calendars
  FOR ALL
  USING (auth.uid() = user_id);
```

---

## 🔌 API設計

### 1. カレンダーリスト取得

**Endpoint:** `GET /api/calendar/list`

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
      timezone: string;
      color: string;
      backgroundColor: string;
      isVisible: boolean;
      isPrimary: boolean;
      accessRole: 'owner' | 'writer' | 'reader';
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
// googleapis ライブラリを使用
const response = await calendar.calendarList.list({
  minAccessRole: 'reader',  // 最低限読み取り権限のあるカレンダー
  showHidden: false         // 非表示カレンダーは除外
});
```

---

### 2. カレンダー表示設定の更新

**Endpoint:** `PATCH /api/calendar/visibility`

**Request Body:**
```typescript
{
  calendarId: string;       // Supabase UUID
  isVisible: boolean;
}
```

**Response:**
```typescript
{
  success: true,
  calendar: {
    id: string;
    isVisible: boolean;
  }
}
```

---

### 3. 全選択/全解除

**Endpoint:** `PATCH /api/calendar/visibility/bulk`

**Request Body:**
```typescript
{
  isVisible: boolean;       // true: 全選択, false: 全解除
  calendarIds?: string[];   // 特定のカレンダーのみ（省略時は全て）
}
```

**Response:**
```typescript
{
  success: true,
  updatedCount: number;
}
```

---

### 4. カレンダー色の更新

**Endpoint:** `PATCH /api/calendar/color`

**Request Body:**
```typescript
{
  calendarId: string;       // Supabase UUID
  color: string;            // 前景色
  backgroundColor: string;  // 背景色
}
```

**Response:**
```typescript
{
  success: true,
  calendar: {
    id: string;
    color: string;
    backgroundColor: string;
  }
}
```

---

## 🎨 UIコンポーネント設計

### 1. CalendarSelector (メインコンポーネント)

**ファイル:** `src/components/calendar/calendar-selector.tsx`

**Props:**
```typescript
interface CalendarSelectorProps {
  onVisibilityChange?: (calendarIds: string[]) => void;
}
```

**機能:**
- カレンダーリストを表示
- 各カレンダーのチェックボックス
- 全選択/全解除ボタン
- カレンダー同期ボタン

**レイアウト:**
```
┌─────────────────────────────────┐
│ My Calendars       [Sync] [All] │
├─────────────────────────────────┤
│ ☑ 🔵 Personal (Primary)         │
│ ☑ 🟢 Work                       │
│ ☐ 🟡 Family                     │
│ ☑ 🔴 Holidays                   │
└─────────────────────────────────┘
```

**実装例:**
```typescript
'use client';

import { useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckSquare, Square } from 'lucide-react';
import { useCalendarList } from '@/hooks/useCalendarList';

export function CalendarSelector({ onVisibilityChange }: CalendarSelectorProps) {
  const { calendars, isLoading, syncCalendars, toggleVisibility, toggleAll } = useCalendarList();

  // 表示中のカレンダーIDのリストを親に通知
  useEffect(() => {
    const visibleIds = calendars.filter(c => c.isVisible).map(c => c.googleCalendarId);
    onVisibilityChange?.(visibleIds);
  }, [calendars, onVisibilityChange]);

  const allChecked = calendars.every(c => c.isVisible);
  const someChecked = calendars.some(c => c.isVisible) && !allChecked;

  return (
    <div className="flex flex-col gap-2 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">My Calendars</h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => syncCalendars()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleAll(!allChecked)}
          >
            {allChecked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Calendar List */}
      <div className="flex flex-col gap-1">
        {calendars.map(calendar => (
          <CalendarItem
            key={calendar.id}
            calendar={calendar}
            onToggle={toggleVisibility}
          />
        ))}
      </div>
    </div>
  );
}
```

---

### 2. CalendarItem (個別アイテム)

**Props:**
```typescript
interface CalendarItemProps {
  calendar: UserCalendar;
  onToggle: (calendarId: string, isVisible: boolean) => void;
}
```

**機能:**
- カレンダー名、色、チェックボックスを表示
- プライマリカレンダーにバッジ表示
- クリックでチェック状態を切り替え
- ホバー時に色変更アイコンを表示（オプション）

**実装例:**
```typescript
function CalendarItem({ calendar, onToggle }: CalendarItemProps) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer group"
      onClick={() => onToggle(calendar.id, !calendar.isVisible)}
    >
      <Checkbox
        checked={calendar.isVisible}
        onCheckedChange={(checked) => onToggle(calendar.id, checked as boolean)}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: calendar.backgroundColor }}
      />
      <span className="text-sm flex-1 truncate">
        {calendar.name}
      </span>
      {calendar.isPrimary && (
        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
          Primary
        </span>
      )}
    </div>
  );
}
```

---

### 3. CalendarColorPicker (色変更)

**Props:**
```typescript
interface CalendarColorPickerProps {
  calendar: UserCalendar;
  onColorChange: (calendarId: string, color: string, backgroundColor: string) => void;
}
```

**機能:**
- カラーピッカーを表示
- プリセットカラーを提供
- カスタムカラー選択
- 変更を即座に反映

---

## 🪝 Custom Hooks設計

### useCalendarList

**目的:** カレンダーリストの管理

```typescript
import { useState, useEffect, useCallback } from 'react';
import { UserCalendar } from '@/types/calendar';

export function useCalendarList() {
  const [calendars, setCalendars] = useState<UserCalendar[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // カレンダーリスト取得
  const fetchCalendars = useCallback(async (forceSync = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/calendar/list?' + new URLSearchParams({
        forceSync: forceSync.toString()
      }));

      if (!response.ok) throw new Error('Failed to fetch calendars');

      const data = await response.json();
      setCalendars(data.calendars);

      // ローカルストレージにも保存
      localStorage.setItem('calendar-visibility', JSON.stringify(
        data.calendars.reduce((acc: Record<string, boolean>, cal: UserCalendar) => {
          acc[cal.googleCalendarId] = cal.isVisible;
          return acc;
        }, {})
      ));
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 初回取得
  useEffect(() => {
    fetchCalendars();
  }, [fetchCalendars]);

  // カレンダー同期（Google APIから再取得）
  const syncCalendars = useCallback(() => {
    return fetchCalendars(true);
  }, [fetchCalendars]);

  // 表示/非表示の切り替え
  const toggleVisibility = useCallback(async (calendarId: string, isVisible: boolean) => {
    // Optimistic Update
    setCalendars(prev => prev.map(cal =>
      cal.id === calendarId ? { ...cal, isVisible } : cal
    ));

    try {
      const response = await fetch('/api/calendar/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId, isVisible })
      });

      if (!response.ok) throw new Error('Failed to update visibility');

      // ローカルストレージを更新
      const stored = JSON.parse(localStorage.getItem('calendar-visibility') || '{}');
      const calendar = calendars.find(c => c.id === calendarId);
      if (calendar) {
        stored[calendar.googleCalendarId] = isVisible;
        localStorage.setItem('calendar-visibility', JSON.stringify(stored));
      }
    } catch (err) {
      // Rollback
      setCalendars(prev => prev.map(cal =>
        cal.id === calendarId ? { ...cal, isVisible: !isVisible } : cal
      ));
      setError(err as Error);
    }
  }, [calendars]);

  // 全選択/全解除
  const toggleAll = useCallback(async (isVisible: boolean) => {
    // Optimistic Update
    setCalendars(prev => prev.map(cal => ({ ...cal, isVisible })));

    try {
      const response = await fetch('/api/calendar/visibility/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isVisible })
      });

      if (!response.ok) throw new Error('Failed to update visibility');

      // ローカルストレージを更新
      const stored = calendars.reduce((acc, cal) => {
        acc[cal.googleCalendarId] = isVisible;
        return acc;
      }, {} as Record<string, boolean>);
      localStorage.setItem('calendar-visibility', JSON.stringify(stored));
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
    syncCalendars,
    toggleVisibility,
    toggleAll
  };
}
```

---

## 🔗 統合ポイント

### RightSidebar への統合

**ファイル:** `src/components/dashboard/right-sidebar.tsx`

**変更点:**
```typescript
// Before
export function RightSidebar() {
  return (
    <div className="flex flex-col h-full">
      <CalendarView />
    </div>
  );
}

// After
export function RightSidebar() {
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<string[]>([]);

  return (
    <div className="flex flex-col h-full">
      {/* カレンダーセレクター */}
      <CalendarSelector onVisibilityChange={setVisibleCalendarIds} />

      <Separator />

      {/* カレンダービュー */}
      <CalendarView visibleCalendarIds={visibleCalendarIds} />
    </div>
  );
}
```

---

### CalendarView への統合

**変更点:**
```typescript
// Before
export function CalendarView({ onTaskDrop }: CalendarViewProps) {
  const { events } = useCalendarEvents({ /* ... */ });
  // 全てのイベントを表示
}

// After
export function CalendarView({
  onTaskDrop,
  visibleCalendarIds  // 追加
}: CalendarViewProps) {
  const { events } = useCalendarEvents({ /* ... */ });

  // 表示中のカレンダーのイベントのみフィルタリング
  const visibleEvents = events.filter(event =>
    visibleCalendarIds.includes(event.calendarId)
  );

  // visibleEvents を表示
}
```

---

## 🧪 テスト観点

### 単体テスト

#### API Routes
- [ ] カレンダーリスト取得: 正常系
- [ ] カレンダーリスト取得: Google APIから再取得
- [ ] 表示設定更新: 正常系
- [ ] 全選択: 正常系
- [ ] 全解除: 正常系

#### Custom Hooks
- [ ] useCalendarList: 初回取得
- [ ] useCalendarList: toggleVisibility（Optimistic Update）
- [ ] useCalendarList: toggleAll
- [ ] useCalendarList: エラー時のロールバック

#### コンポーネント
- [ ] CalendarSelector: カレンダーリスト表示
- [ ] CalendarSelector: 全選択ボタン
- [ ] CalendarItem: クリックでチェック切り替え
- [ ] CalendarItem: プライマリバッジ表示

---

### 統合テスト

- [ ] カレンダー取得 → 表示 → チェック解除 → イベント非表示
- [ ] 全選択 → 全てのイベント表示
- [ ] ローカルストレージに設定保存 → ページリロード → 設定復元

---

## 📦 実装の優先順位

### Phase 1-2-1: カレンダーリストの取得・表示（最優先）
1. `user_calendars`テーブル作成
2. `/api/calendar/list` 実装
3. `useCalendarList` Hook 実装
4. `CalendarSelector` コンポーネント実装

### Phase 1-2-2: 表示/非表示の切り替え
1. `/api/calendar/visibility` 実装
2. `toggleVisibility` 実装
3. ローカルストレージ連携

### Phase 1-2-3: カレンダーごとの色管理
1. `/api/calendar/color` 実装
2. `CalendarColorPicker` コンポーネント実装

---

## 📚 参考資料

- [Google Calendar API - CalendarList](https://developers.google.com/calendar/api/v3/reference/calendarList)
- [Radix UI - Checkbox](https://www.radix-ui.com/primitives/docs/components/checkbox)
- [localStorage Best Practices](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)

---

**作成日:** 2026-01-28
**対象バージョン:** v1.0.0
**担当:** Architect AI (Sonnet 4.5)
