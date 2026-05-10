ALTER TABLE ideal_goals
  ADD COLUMN IF NOT EXISTS scheduled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS duration_minutes int,
  ADD COLUMN IF NOT EXISTS google_event_id  text,
  ADD COLUMN IF NOT EXISTS is_completed     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags             text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS memo_status      text NOT NULL DEFAULT 'unsorted',
  ADD COLUMN IF NOT EXISTS ai_source_payload jsonb;

CREATE INDEX IF NOT EXISTS ideal_goals_is_completed_idx
  ON ideal_goals (user_id, is_completed);

CREATE INDEX IF NOT EXISTS ideal_goals_memo_status_idx
  ON ideal_goals (user_id, memo_status);
