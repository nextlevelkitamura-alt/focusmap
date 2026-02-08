-- Migration to add missing columns for task calendar sync
-- This adds calendar_id and other missing columns to the tasks table

-- Step 1: Add calendar_id column to tasks table
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS calendar_id TEXT;

-- Step 2: Add comment for calendar_id
COMMENT ON COLUMN tasks.calendar_id IS 'ID of the selected Google calendar for syncing (from user_calendars table)';

-- Step 3: Add parent_task_id column for hierarchical tasks
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;

-- Step 4: Add index for parent_task_id
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- Step 5: Add order_index column for task ordering
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;

-- Step 6: Add timer columns
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS total_elapsed_seconds INTEGER DEFAULT 0;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS last_started_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_timer_running BOOLEAN DEFAULT false;

-- Step 7: Add updated_at column if it doesn't exist
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Step 8: Create or replace update_updated_at_column function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Step 9: Create trigger for tasks updated_at
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 10: Add index for calendar_id
CREATE INDEX IF NOT EXISTS idx_tasks_calendar_id ON tasks(calendar_id) WHERE calendar_id IS NOT NULL;
