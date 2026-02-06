-- Phase 1-3-1: 通知システムのテーブル作成
-- notification_settings と notification_queue テーブル

-- =====================================================
-- 1. notification_settings テーブル
-- =====================================================

CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- 通知タイプ
  notification_type TEXT NOT NULL, -- 'task_start' | 'task_due' | 'event_start'

  -- 設定
  is_enabled BOOLEAN DEFAULT true,
  advance_minutes INTEGER DEFAULT 15,  -- 何分前に通知（5, 15, 30, 60, 1440）
  sound_enabled BOOLEAN DEFAULT true,

  -- メール通知（オプション）
  email_enabled BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- 制約
  UNIQUE(user_id, notification_type),

  -- チェック制約
  CONSTRAINT notification_type_check
    CHECK (notification_type IN ('task_start', 'task_due', 'event_start')),
  CONSTRAINT advance_minutes_check
    CHECK (advance_minutes IN (5, 15, 30, 60, 1440))
);

-- インデックスの作成
CREATE INDEX IF NOT EXISTS idx_notification_settings_user
  ON notification_settings(user_id);

-- RLS (Row Level Security) の有効化
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

-- RLSポリシーの作成
CREATE POLICY "Users can only access their own notification settings"
  ON notification_settings
  FOR ALL
  USING (auth.uid() = user_id);

-- updated_at自動更新トリガーの作成
CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 2. notification_queue テーブル
-- =====================================================

CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- 通知対象
  target_type TEXT NOT NULL,       -- 'task' | 'event'
  target_id UUID NOT NULL,         -- tasks.id または calendar_events.id
  notification_type TEXT NOT NULL, -- 'task_start' | 'task_due' | 'event_start'

  -- 通知内容
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  icon_url TEXT,
  action_url TEXT,                 -- クリック時のURL

  -- スケジュール
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  is_sent BOOLEAN DEFAULT false,

  -- エラー処理
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),

  -- チェック制約
  CONSTRAINT target_type_check
    CHECK (target_type IN ('task', 'event'))
);

-- インデックスの作成
CREATE INDEX IF NOT EXISTS idx_notification_queue_scheduled
  ON notification_queue(user_id, scheduled_at, is_sent)
  WHERE is_sent = false;

CREATE INDEX IF NOT EXISTS idx_notification_queue_target
  ON notification_queue(target_type, target_id);

-- RLS (Row Level Security) の有効化
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- RLSポリシーの作成
CREATE POLICY "Users can only access their own notification queue"
  ON notification_queue
  FOR ALL
  USING (auth.uid() = user_id);

-- =====================================================
-- 3. デフォルト通知設定を作成する関数
-- =====================================================

CREATE OR REPLACE FUNCTION create_default_notification_settings()
RETURNS TRIGGER AS $$
BEGIN
  -- 新規ユーザー作成時にデフォルトの通知設定を挿入
  INSERT INTO notification_settings (user_id, notification_type, advance_minutes)
  VALUES
    (NEW.id, 'task_start', 15),
    (NEW.id, 'task_due', 60),
    (NEW.id, 'event_start', 15)
  ON CONFLICT (user_id, notification_type) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. トリガーの作成
-- =====================================================

-- auth.usersへのINSERTを監視するトリガーを作成
-- Note: Supabaseではauth.usersテーブルのトリガーを直接作成できないため、
-- 別途API経由でデフォルト設定を作成する必要があります
-- この関数はユーザー登録時にAPIから呼び出す設計とします

-- =====================================================
-- 5. 通知をキャンセルする関数
-- =====================================================

CREATE OR REPLACE FUNCTION cancel_notifications(
  p_user_id UUID,
  p_target_type TEXT,
  p_target_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  canceled_count INTEGER;
BEGIN
  -- 指定された対象の通知を削除
  DELETE FROM notification_queue
  WHERE user_id = p_user_id
    AND target_type = p_target_type
    AND target_id = p_target_id
    AND is_sent = false;

  GET DIAGNOSTICS canceled_count = ROW_COUNT;

  RETURN canceled_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 6. コメントの追加
-- =====================================================

COMMENT ON TABLE notification_settings IS 'ユーザーの通知設定テーブル';
COMMENT ON COLUMN notification_settings.notification_type IS '通知タイプ: task_start, task_due, event_start';
COMMENT ON COLUMN notification_settings.advance_minutes IS '何分前に通知するか（分単位）';

COMMENT ON TABLE notification_queue IS '通知送信キューテーブル';
COMMENT ON COLUMN notification_queue.target_type IS '通知対象のタイプ: task, event';
COMMENT ON COLUMN notification_queue.target_id IS '通知対象のID（tasks.id または calendar_events.id）';
COMMENT ON COLUMN notification_queue.scheduled_at IS '通知予定時刻';
COMMENT ON COLUMN notification_queue.is_sent IS '通知が送信されたかどうか';
