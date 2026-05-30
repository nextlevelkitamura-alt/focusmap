-- Track Google Calendar event -> Focusmap memo conversions.
-- This preserves the original event snapshot and delete scope after the
-- Google Calendar event itself is removed.

CREATE TABLE IF NOT EXISTS calendar_event_memo_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memo_id UUID REFERENCES ideal_goals(id) ON DELETE SET NULL,

  calendar_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  target_google_event_id TEXT NOT NULL,
  recurring_event_id TEXT,
  delete_scope TEXT NOT NULL DEFAULT 'this'
    CHECK (delete_scope IN ('this', 'series')),

  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  is_all_day BOOLEAN NOT NULL DEFAULT false,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  recurrence TEXT[],
  event_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

  conversion_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (conversion_status IN ('pending', 'memo_created', 'completed', 'failed')),
  error_message TEXT,
  converted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_memo_conversions_user_converted
  ON calendar_event_memo_conversions(user_id, converted_at DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_event_memo_conversions_event
  ON calendar_event_memo_conversions(user_id, calendar_id, google_event_id);

CREATE INDEX IF NOT EXISTS idx_calendar_event_memo_conversions_memo
  ON calendar_event_memo_conversions(memo_id)
  WHERE memo_id IS NOT NULL;

ALTER TABLE calendar_event_memo_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_calendar_event_memo_conversions" ON calendar_event_memo_conversions;
CREATE POLICY "users_own_calendar_event_memo_conversions"
  ON calendar_event_memo_conversions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_calendar_event_memo_conversions_updated_at ON calendar_event_memo_conversions;
CREATE TRIGGER update_calendar_event_memo_conversions_updated_at
  BEFORE UPDATE ON calendar_event_memo_conversions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE calendar_event_memo_conversions IS 'Audit log for converting Google Calendar events into unscheduled Focusmap memos and deleting the source event.';
COMMENT ON COLUMN calendar_event_memo_conversions.delete_scope IS 'Whether only this occurrence or the whole recurring series was deleted after memo creation.';
COMMENT ON COLUMN calendar_event_memo_conversions.event_snapshot IS 'Original event payload needed for traceability after the Google event is removed.';
