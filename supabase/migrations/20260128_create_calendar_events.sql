-- Phase 1-1-1: calendar_events テーブルの作成
-- Googleカレンダーイベントのキャッシュテーブル

-- 1. updated_at自動更新関数（まだ存在しない場合は作成）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. calendar_eventsテーブルの作成
CREATE TABLE IF NOT EXISTS calendar_events (
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

-- 3. インデックスの作成
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_calendar
  ON calendar_events(user_id, calendar_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_time_range
  ON calendar_events(user_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_calendar_events_google_id
  ON calendar_events(google_event_id);

CREATE INDEX IF NOT EXISTS idx_calendar_events_synced_at
  ON calendar_events(user_id, synced_at);

-- 4. RLS (Row Level Security) の有効化
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- 5. RLSポリシーの作成
CREATE POLICY "Users can only access their own events"
  ON calendar_events
  FOR ALL
  USING (auth.uid() = user_id);

-- 6. updated_at自動更新トリガーの作成
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 7. コメントの追加
COMMENT ON TABLE calendar_events IS 'Googleカレンダーイベントのキャッシュテーブル';
COMMENT ON COLUMN calendar_events.google_event_id IS 'GoogleカレンダーのイベントID';
COMMENT ON COLUMN calendar_events.calendar_id IS 'GoogleカレンダーのカレンダーID';
COMMENT ON COLUMN calendar_events.is_all_day IS '終日イベントかどうか';
COMMENT ON COLUMN calendar_events.recurrence IS 'RRULE配列（繰り返しイベント）';
COMMENT ON COLUMN calendar_events.recurring_event_id IS '繰り返しイベントの親ID';
COMMENT ON COLUMN calendar_events.synced_at IS '最終同期時刻';
