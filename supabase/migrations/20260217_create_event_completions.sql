-- event_completions: カレンダーイベントの完了状態を記録するテーブル
-- habit_completions と同様のパターン。30日保存を想定。

CREATE TABLE IF NOT EXISTS event_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  google_event_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  completed_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, google_event_id, completed_date)
);

-- インデックス
CREATE INDEX idx_event_completions_user_date
  ON event_completions(user_id, completed_date);

-- RLS
ALTER TABLE event_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own event completions"
  ON event_completions FOR ALL
  USING (auth.uid() = user_id);
