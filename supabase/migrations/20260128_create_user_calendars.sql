-- Phase 1.2: マルチカレンダー対応
-- user_calendars テーブルの作成

CREATE TABLE IF NOT EXISTS user_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  google_calendar_id TEXT NOT NULL,

  -- カレンダー情報
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  timezone TEXT DEFAULT 'Asia/Tokyo',

  -- 表示情報
  color TEXT,
  background_color TEXT,
  selected BOOLEAN DEFAULT true,

  -- アクセス権限
  access_level TEXT,
  is_primary BOOLEAN DEFAULT false,

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
CREATE INDEX IF NOT EXISTS idx_user_calendars_user_id ON user_calendars(user_id);
CREATE INDEX IF NOT EXISTS idx_user_calendars_selected ON user_calendars(user_id, selected) WHERE selected = true;

-- RLS (Row Level Security)
ALTER TABLE user_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own calendars"
  ON user_calendars
  FOR ALL
  USING (auth.uid() = user_id);

-- updated_at トリガー
CREATE OR REPLACE FUNCTION update_user_calendars_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_calendars_updated_at
  BEFORE UPDATE ON user_calendars
  FOR EACH ROW
  EXECUTE FUNCTION update_user_calendars_updated_at();
