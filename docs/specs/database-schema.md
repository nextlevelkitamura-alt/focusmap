# データベーススキーマ設計書

## 📋 概要

Shikumika App全体のデータベーススキーマ設計書。Phase 1で必要なテーブル構造を定義する。

---

## 🗄️ テーブル一覧

### Phase 1 で追加するテーブル

1. **calendar_events** - Googleカレンダーイベントのキャッシュ
2. **user_calendars** - ユーザーのカレンダー設定
3. **calendar_tokens** - Google OAuth トークン
4. **notification_settings** - 通知設定
5. **notification_queue** - 通知スケジュール
6. **task_time_logs** - タスク実績時間の記録

### 既存テーブルの変更

1. **tasks** - 時間関連カラムの追加

---

## 📊 ER図（概念図）

```
┌─────────────────┐
│   auth.users    │
└────────┬────────┘
         │
         ├─────────────────────┐
         │                     │
         ▼                     ▼
┌──────────────────┐  ┌──────────────────┐
│ calendar_tokens  │  │ user_calendars   │
└──────────────────┘  └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ calendar_events  │
                      └────────┬─────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│      tasks       │  │notification_queue│  │notification_     │
│                  │  │                  │  │    settings      │
└────────┬─────────┘  └──────────────────┘  └──────────────────┘
         │
         ▼
┌──────────────────┐
│ task_time_logs   │
└──────────────────┘
```

---

## 🔧 マイグレーションファイル

### 1. calendar_events テーブル

**ファイル:** `supabase/migrations/20260128_create_calendar_events.sql`

```sql
-- Googleカレンダーイベントのキャッシュテーブル
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  google_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,

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
  recurrence TEXT[],
  recurring_event_id TEXT,

  -- 表示情報
  color TEXT,
  background_color TEXT,

  -- メタ情報
  google_created_at TIMESTAMPTZ,
  google_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- 制約
  UNIQUE(user_id, google_event_id)
);

-- インデックス
CREATE INDEX idx_calendar_events_user_calendar ON calendar_events(user_id, calendar_id);
CREATE INDEX idx_calendar_events_time_range ON calendar_events(user_id, start_time, end_time);
CREATE INDEX idx_calendar_events_google_id ON calendar_events(google_event_id);

-- RLS (Row Level Security)
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own events"
  ON calendar_events
  FOR ALL
  USING (auth.uid() = user_id);

-- 更新時刻の自動更新
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

### 2. user_calendars テーブル

**ファイル:** `supabase/migrations/20260128_create_user_calendars.sql`

```sql
-- ユーザーのカレンダー設定テーブル
CREATE TABLE user_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  google_calendar_id TEXT NOT NULL,

  -- カレンダー情報
  name TEXT NOT NULL,
  description TEXT,
  timezone TEXT DEFAULT 'Asia/Tokyo',

  -- 表示情報
  color TEXT,
  background_color TEXT,
  is_visible BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false,

  -- アクセス権限
  access_role TEXT CHECK (access_role IN ('owner', 'writer', 'reader')),

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
CREATE INDEX idx_user_calendars_visible ON user_calendars(user_id, is_visible);

-- RLS
ALTER TABLE user_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own calendars"
  ON user_calendars
  FOR ALL
  USING (auth.uid() = user_id);

-- 更新時刻の自動更新
CREATE TRIGGER update_user_calendars_updated_at
  BEFORE UPDATE ON user_calendars
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

### 3. calendar_tokens テーブル

**ファイル:** `supabase/migrations/20260128_create_calendar_tokens.sql`

```sql
-- Google OAuth トークンテーブル
CREATE TABLE calendar_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- トークン情報（暗号化推奨）
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  expiry_date TIMESTAMPTZ NOT NULL,

  -- スコープ
  scope TEXT[],

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- インデックス
CREATE INDEX idx_calendar_tokens_user_id ON calendar_tokens(user_id);

-- RLS
ALTER TABLE calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own tokens"
  ON calendar_tokens
  FOR ALL
  USING (auth.uid() = user_id);

-- 更新時刻の自動更新
CREATE TRIGGER update_calendar_tokens_updated_at
  BEFORE UPDATE ON calendar_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

### 4. notification_settings テーブル

**ファイル:** `supabase/migrations/20260128_create_notification_settings.sql`

```sql
-- 通知設定テーブル
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- 通知タイプ
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('task_start', 'task_due', 'event_start')
  ),

  -- 設定
  is_enabled BOOLEAN DEFAULT true,
  advance_minutes INTEGER DEFAULT 15 CHECK (advance_minutes > 0),
  sound_enabled BOOLEAN DEFAULT true,

  -- メール通知（オプション）
  email_enabled BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- 制約
  UNIQUE(user_id, notification_type)
);

-- インデックス
CREATE INDEX idx_notification_settings_user_id ON notification_settings(user_id);

-- RLS
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own settings"
  ON notification_settings
  FOR ALL
  USING (auth.uid() = user_id);

-- デフォルト設定を挿入するトリガー
CREATE OR REPLACE FUNCTION create_default_notification_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notification_settings (user_id, notification_type, advance_minutes)
  VALUES
    (NEW.id, 'task_start', 15),
    (NEW.id, 'task_due', 60),
    (NEW.id, 'event_start', 15)
  ON CONFLICT (user_id, notification_type) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_user_created_notification_settings
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_notification_settings();

-- 更新時刻の自動更新
CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

### 5. notification_queue テーブル

**ファイル:** `supabase/migrations/20260128_create_notification_queue.sql`

```sql
-- 通知スケジュールテーブル
CREATE TABLE notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- 通知対象
  target_type TEXT NOT NULL CHECK (target_type IN ('task', 'event')),
  target_id UUID NOT NULL,
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('task_start', 'task_due', 'event_start')
  ),

  -- 通知内容
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  icon_url TEXT,
  action_url TEXT,

  -- スケジュール
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  is_sent BOOLEAN DEFAULT false,

  -- エラー処理
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- インデックス
CREATE INDEX idx_notification_queue_scheduled ON notification_queue(user_id, scheduled_at, is_sent);
CREATE INDEX idx_notification_queue_target ON notification_queue(target_type, target_id);
CREATE INDEX idx_notification_queue_pending ON notification_queue(scheduled_at, is_sent) WHERE is_sent = false;

-- RLS
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own notifications"
  ON notification_queue
  FOR ALL
  USING (auth.uid() = user_id);
```

---

### 6. task_time_logs テーブル

**ファイル:** `supabase/migrations/20260128_create_task_time_logs.sql`

```sql
-- タスク実績時間の記録テーブル
CREATE TABLE task_time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- 作業時間
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration INTEGER, -- 分単位（ended_at - started_at）

  -- メモ
  note TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- インデックス
CREATE INDEX idx_task_time_logs_task_id ON task_time_logs(task_id);
CREATE INDEX idx_task_time_logs_user_time ON task_time_logs(user_id, started_at);

-- RLS
ALTER TABLE task_time_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own time logs"
  ON task_time_logs
  FOR ALL
  USING (auth.uid() = user_id);

-- 終了時刻が設定されたら自動的にdurationを計算
CREATE OR REPLACE FUNCTION calculate_task_time_log_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL AND NEW.started_at IS NOT NULL THEN
    NEW.duration := EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_duration_on_insert_or_update
  BEFORE INSERT OR UPDATE ON task_time_logs
  FOR EACH ROW
  EXECUTE FUNCTION calculate_task_time_log_duration();
```

---

### 7. tasks テーブルの変更

**ファイル:** `supabase/migrations/20260128_alter_tasks_add_time_columns.sql`

```sql
-- tasksテーブルに時間関連のカラムを追加
ALTER TABLE tasks
  ADD COLUMN estimated_duration INTEGER CHECK (estimated_duration > 0),
  ADD COLUMN actual_duration INTEGER CHECK (actual_duration >= 0),
  ADD COLUMN calendar_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL,
  ADD COLUMN scheduled_at TIMESTAMPTZ,
  ADD COLUMN completed_duration INTEGER CHECK (completed_duration >= 0);

-- インデックス
CREATE INDEX idx_tasks_scheduled ON tasks(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX idx_tasks_calendar_event ON tasks(calendar_event_id) WHERE calendar_event_id IS NOT NULL;

-- コメント
COMMENT ON COLUMN tasks.estimated_duration IS '所要時間（分単位）';
COMMENT ON COLUMN tasks.actual_duration IS '実績時間（分単位）- task_time_logsから集計';
COMMENT ON COLUMN tasks.calendar_event_id IS '紐付けられたカレンダーイベントのID';
COMMENT ON COLUMN tasks.scheduled_at IS 'カレンダーに配置された開始時間';
COMMENT ON COLUMN tasks.completed_duration IS 'タイマーで記録された完了時の実績時間';
```

---

## 🔧 共通関数

### updated_at_column トリガー関数

**ファイル:** `supabase/migrations/20260128_create_updated_at_function.sql`

```sql
-- updated_atを自動更新する関数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 📝 TypeScript型定義

### types/database.ts

```typescript
export interface CalendarEvent {
  id: string;
  user_id: string;
  google_event_id: string;
  calendar_id: string;
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  timezone: string;
  recurrence?: string[];
  recurring_event_id?: string;
  color?: string;
  background_color?: string;
  google_created_at?: string;
  google_updated_at?: string;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface UserCalendar {
  id: string;
  user_id: string;
  google_calendar_id: string;
  name: string;
  description?: string;
  timezone: string;
  color?: string;
  background_color?: string;
  is_visible: boolean;
  is_primary: boolean;
  access_role?: 'owner' | 'writer' | 'reader';
  google_created_at?: string;
  google_updated_at?: string;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarToken {
  id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: string;
  scope?: string[];
  created_at: string;
  updated_at: string;
}

export interface NotificationSetting {
  id: string;
  user_id: string;
  notification_type: 'task_start' | 'task_due' | 'event_start';
  is_enabled: boolean;
  advance_minutes: number;
  sound_enabled: boolean;
  email_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationQueue {
  id: string;
  user_id: string;
  target_type: 'task' | 'event';
  target_id: string;
  notification_type: 'task_start' | 'task_due' | 'event_start';
  title: string;
  body: string;
  icon_url?: string;
  action_url?: string;
  scheduled_at: string;
  sent_at?: string;
  is_sent: boolean;
  retry_count: number;
  last_error?: string;
  created_at: string;
}

export interface TaskTimeLog {
  id: string;
  task_id: string;
  user_id: string;
  started_at: string;
  ended_at?: string;
  duration?: number;
  note?: string;
  created_at: string;
}

export interface Task {
  // ... 既存のフィールド
  estimated_duration?: number;
  actual_duration?: number;
  calendar_event_id?: string;
  scheduled_at?: string;
  completed_duration?: number;
}
```

---

## 🔐 セキュリティ考慮事項

### 1. Row Level Security (RLS)

全てのテーブルでRLSを有効化し、ユーザーは自分のデータのみアクセス可能。

```sql
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own data"
  ON {table_name}
  FOR ALL
  USING (auth.uid() = user_id);
```

### 2. トークンの暗号化

`calendar_tokens`テーブルの`access_token`と`refresh_token`は暗号化して保存することを推奨。

**実装例:**
```sql
-- pg_cryptoを使用した暗号化
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- トークンを暗号化して保存
INSERT INTO calendar_tokens (user_id, access_token, refresh_token, ...)
VALUES (
  user_id,
  pgp_sym_encrypt('access_token_value', current_setting('app.encryption_key')),
  pgp_sym_encrypt('refresh_token_value', current_setting('app.encryption_key')),
  ...
);

-- 復号化して取得
SELECT
  pgp_sym_decrypt(access_token::bytea, current_setting('app.encryption_key')) AS access_token,
  pgp_sym_decrypt(refresh_token::bytea, current_setting('app.encryption_key')) AS refresh_token
FROM calendar_tokens
WHERE user_id = auth.uid();
```

### 3. インデックス最適化

頻繁にクエリされるカラムにインデックスを作成し、パフォーマンスを向上。

---

## 🧪 テストデータ

### サンプルデータ挿入スクリプト

**ファイル:** `supabase/seed.sql`

```sql
-- テスト用ユーザー（既存と仮定）
-- user_id: '00000000-0000-0000-0000-000000000001'

-- カレンダートークン
INSERT INTO calendar_tokens (user_id, access_token, refresh_token, expiry_date, scope)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'test_access_token',
  'test_refresh_token',
  now() + interval '1 hour',
  ARRAY['https://www.googleapis.com/auth/calendar']
);

-- ユーザーカレンダー
INSERT INTO user_calendars (user_id, google_calendar_id, name, color, background_color, is_primary)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'primary@gmail.com', 'Personal', '#039BE5', '#E3F2FD', true),
  ('00000000-0000-0000-0000-000000000001', 'work@company.com', 'Work', '#0B8043', '#E8F5E9', false);

-- カレンダーイベント
INSERT INTO calendar_events (
  user_id,
  google_event_id,
  calendar_id,
  title,
  start_time,
  end_time,
  color,
  background_color
)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'event001',
    'primary@gmail.com',
    'Team Meeting',
    '2026-01-29 10:00:00+09',
    '2026-01-29 11:00:00+09',
    '#039BE5',
    '#E3F2FD'
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    'event002',
    'work@company.com',
    'Project Review',
    '2026-01-29 14:00:00+09',
    '2026-01-29 15:30:00+09',
    '#0B8043',
    '#E8F5E9'
  );

-- 通知設定（自動作成されるが、カスタマイズ例）
UPDATE notification_settings
SET advance_minutes = 30, sound_enabled = true
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND notification_type = 'task_start';
```

---

## 📚 参考資料

- [Supabase Database Documentation](https://supabase.com/docs/guides/database)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)

---

**作成日:** 2026-01-28
**対象バージョン:** v1.0.0
**担当:** Architect AI (Sonnet 4.5)
