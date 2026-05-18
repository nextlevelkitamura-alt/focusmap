-- Add is_today flag to ideal_goals for "今日する" column on memo view.
-- Memos can be picked into the today lane manually (independent of scheduled_at).
ALTER TABLE ideal_goals
  ADD COLUMN IF NOT EXISTS is_today BOOLEAN NOT NULL DEFAULT false;

-- Partial index for fast lookup of today-picked memos per user.
CREATE INDEX IF NOT EXISTS idx_ideal_goals_is_today
  ON ideal_goals(user_id)
  WHERE is_today = true;
