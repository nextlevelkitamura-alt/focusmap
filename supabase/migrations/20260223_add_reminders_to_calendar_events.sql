-- Add reminders cache to calendar_events for notification consistency
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS reminders INTEGER[];

COMMENT ON COLUMN calendar_events.reminders IS 'Google Calendar reminders (minutes before event)';
