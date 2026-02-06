-- Add calendar_event_id to tasks table for Phase 1.4: Task Time Management
-- This links tasks to local calendar_events table for better tracking

-- Add calendar_event_id column
ALTER TABLE tasks
  ADD COLUMN calendar_event_id UUID REFERENCES calendar_events(id) ON DELETE SET NULL;

-- Add comment
COMMENT ON COLUMN tasks.calendar_event_id IS 'Reference to local calendar_events table when task is scheduled on calendar';

-- Create index for performance
CREATE INDEX idx_tasks_calendar_event ON tasks(calendar_event_id) WHERE calendar_event_id IS NOT NULL;

-- Add updated_at trigger to ensure timestamp is updated
-- (This ensures we track when calendar_event_id is set)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Ensure trigger exists
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
