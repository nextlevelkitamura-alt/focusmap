-- calendar_events に is_completed カラムを追加
-- カレンダーイベントの完了状態をトラッキングするため
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_completed boolean DEFAULT false;
