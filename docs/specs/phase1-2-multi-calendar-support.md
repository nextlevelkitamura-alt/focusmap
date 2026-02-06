# Phase 1.2: マルチカレンダー対応（カレンダーセレクター機能）

## 📋 概要

### 目的
ユーザーの全てのGoogleカレンダー（共有カレンダー、チームカレンダーを含む）を取得し、右上のカレンダーセレクターから表示/非表示を切り替えられるようにする。

### 背景
- 現在はメインのカレンダーのみを取得している
- ユーザーは上司・チームと共有しているカレンダーを持っている
- 複数のカレンダーを統合して表示したい
- カレンダーごとに色分けして見分けたい
- 必要なカレンダーだけを選択して表示したい

---

## 🎯 要件定義

### 機能要件

#### FR-1: 全カレンダー取得
- Google Calendar APIからユーザーの全カレンダーを取得
- 共有カレンダー、チームカレンダーも含める
- 取得したカレンダーをデータベースに保存

#### FR-2: カレンダーリスト表示
- 右上のカレンダーセレクターに全カレンダーを表示
- カレンダー名と色を表示
- チェックボックスで表示/非表示を切り替え

#### FR-3: 表示設定の永続化
- チェック状態をローカルストレージに保存
- ページをリロードしても設定を維持

#### FR-4: 複数カレンダーのイベント取得
- 選択された全カレンダーのイベントを取得
- 各カレンダーの色を維持して表示

#### FR-5: カレンダーごとの色管理
- Googleカレンダーの色設定をそのまま使用
- カスタム色設定も可能（オプション）

---

## 🗄️ データベース設計

### user_calendars テーブル（既存の拡張）

```sql
-- 既存のテーブル定義を確認・拡張
CREATE TABLE user_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  google_calendar_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,                    -- カレンダーの色（Googleから取得）
  background_color TEXT,         -- 背景色
  access_level TEXT,             -- 'owner', 'writer', 'reader', 'freeBusyReader'
  primary BOOLEAN DEFAULT false, -- プライマリカレンダーかどうか
  selected BOOLEAN DEFAULT true, -- 表示選択状態
  location TEXT,                 -- カレンダーの場所
  timezone TEXT,                 -- カレンダーのタイムゾーン
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

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

### 1. カレンダーリスト取得・同期

**Endpoint:** `GET /api/calendars`

**Response:**
```typescript
{
  success: true,
  calendars: [
    {
      id: string,
      googleCalendarId: string,
      name: string,
      description?: string,
      color: string,
      backgroundColor: string,
      accessLevel: 'owner' | 'writer' | 'reader' | 'freeBusyReader',
      primary: boolean,
      selected: boolean,
      location?: string,
      timezone?: string
    }
  ]
}
```

**処理内容:**
1. Google Calendar APIからカレンダーリストを取得
2. データベースと同期（upsert）
3. 選択状態を維持して返す

---

### 2. カレンダーの表示/非表示切り替え

**Endpoint:** `PATCH /api/calendars/:id`

**Request Body:**
```typescript
{
  selected: boolean
}
```

**Response:**
```typescript
{
  success: true,
  calendar: {
    id: string,
    selected: boolean
  }
}
```

---

### 3. 全カレンダーのイベント取得

**Endpoint:** `POST /api/calendars/events/list`

**Request Body:**
```typescript
{
  timeMin: string,      // ISO 8601
  timeMax: string,      // ISO 8601
  selectedCalendars?: string[]  // 選択されたカレンダーID（省略時はDBから取得）
}
```

**Response:**
```typescript
{
  success: true,
  events: CalendarEvent[]
}
```

**処理内容:**
1. 選択されたカレンダーを取得
2. 各カレンダーからイベントを取得
3. 統合して返す

---

## 🎨 UI設計

### カレンダーセレクター

**ファイル:** `src/components/calendar/calendar-selector.tsx`（既存の拡張）

```typescript
interface CalendarSelectorProps {
  calendars: UserCalendar[];
  onToggleCalendar: (calendarId: string, selected: boolean) => void;
  onRefresh?: () => void;
}

export function CalendarSelector({
  calendars,
  onToggleCalendar,
  onRefresh
}: CalendarSelectorProps) {
  // カレンダーリストを表示
  // 各カレンダーにチェックボックス
  // 色付きインジケーター
  // 「全選択/全解除」ボタン
  // 「再読み込み」ボタン
}
```

**表示要素:**
- カレンダー名
- 色インジケーター（Googleの色）
- チェックボックス（表示/非表示）
- アクセスレベルバッジ（所有者/閲覧のみなど）

---

## 🪝 Custom Hooks設計

### useCalendars

**目的:** カレンダーリストの取得・管理

```typescript
import { useState, useCallback } from 'react';

export function useCalendars() {
  const [calendars, setCalendars] = useState<UserCalendar[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // カレンダーリストを取得
  const fetchCalendars = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/calendars');
      const data = await response.json();
      setCalendars(data.calendars);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // カレンダーの表示/非表示を切り替え
  const toggleCalendar = useCallback(async (calendarId: string, selected: boolean) => {
    const response = await fetch(`/api/calendars/${calendarId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected })
    });
    const data = await response.json();

    // ローカル状態を更新
    setCalendars(prev =>
      prev.map(cal =>
        cal.id === calendarId ? { ...cal, selected: data.calendar.selected } : cal
      )
    );
  }, []);

  return {
    calendars,
    isLoading,
    error,
    fetchCalendars,
    toggleCalendar
  };
}
```

---

## 📦 実装の優先順位

### Phase 1.2-1: データベースと基盤（最優先）
1. `user_calendars` テーブルの作成・マイグレーション
2. 型定義の追加
3. Google Calendar APIからカレンダーリスト取得

### Phase 1.2-2: API実装
4. `GET /api/calendars` の実装
5. `PATCH /api/calendars/:id` の実装
6. `POST /api/calendars/events/list` の拡張

### Phase 1.2-3: UI実装
7. `useCalendars` Hookの実装
8. `CalendarSelector` コンポーネントの拡張
9. カレンダー表示/非表示の統合

### Phase 1.2-4: 統合とテスト
10. 複数カレンダーのイベント表示
11. 色分け表示の確認
12. 表示設定の永続化

---

## 🔗 既存機能との統合

### CalendarView コンポーネント
**ファイル:** `src/components/calendar/calendar-view.tsx`

```typescript
// 既存の実装を拡張
export function CalendarView() {
  const { calendars, fetchCalendars, toggleCalendar } = useCalendars();
  const { events, refreshEvents } = useCalendarEvents();

  // 選択されたカレンダーのIDリスト
  const selectedCalendarIds = calendars
    .filter(c => c.selected)
    .map(c => c.googleCalendarId);

  // イベント取得時に選択カレンダーを渡す
  useEffect(() => {
    refreshEvents({ calendarIds: selectedCalendarIds });
  }, [selectedCalendarIds]);
}
```

---

## 🧪 テスト観点

### 単体テスト
- [ ] カレンダーリスト取得: 正常系
- [ ] カレンダーリスト取得: 共有カレンダーを含む
- [ ] カレンダー表示切り替え: 正常系
- [ ] 複数カレンダーのイベント取得

### 統合テスト
- [ ] 全カレンダーが正しく表示される
- [ ] チェックボックスで表示/非表示が切り替わる
- [ ] 各カレンダーのイベントが正しい色で表示される
- [ ] 表示設定がリロード後も維持される

---

## 📚 参考資料

### Google Calendar API
- [Calendar List: list](https://developers.google.com/calendar/api/v3/reference/calendarList/list)
- [Events: list](https://developers.google.com/calendar/api/v3/reference/events/list)

### 既存コード
- `src/lib/google-calendar.ts` - Google Calendar APIラッパー
- `src/components/calendar/calendar-selector.tsx` - 既存のセレクター
- `src/hooks/useCalendarEvents.ts` - イベント取得フック

---

## 🚨 注意事項

### APIレート制限
- Google Calendar APIにはレート制限がある
- 複数カレンダーのイベント取得にはバッチ処理を検討
- キャッシュを活用してAPI呼び出しを削減

### パフォーマンス
- カレンダー数が多い場合の表示遅延対策
- イベント取得の並列処理
- データベースのインデックス最適化

### プライバシー
- 他のユーザーの共有カレンダーの扱いに注意
- 閲覧のみのカレンダーは適切に表示

---

**作成日:** 2026-01-28
**対象バージョン:** v1.0.0
**担当:** Architect AI
