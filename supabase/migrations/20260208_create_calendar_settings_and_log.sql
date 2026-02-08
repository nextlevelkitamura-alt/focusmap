-- Part 2: Create user_calendar_settings and calendar_sync_log tables
-- Run this AFTER the first migration file

-- Step 1: Create user_calendar_settings table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_calendar_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  google_access_token TEXT NOT NULL,
  google_refresh_token TEXT NOT NULL,
  google_token_expires_at TIMESTAMP WITH TIME ZONE,
  default_calendar_id TEXT DEFAULT 'primary',
  is_sync_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Step 2: Enable RLS for user_calendar_settings
ALTER TABLE user_calendar_settings ENABLE ROW LEVEL SECURITY;

-- Step 3: Drop policy if exists, then create policy for user_calendar_settings
DROP POLICY IF EXISTS "Users can CRUD their own calendar settings" ON user_calendar_settings;
CREATE POLICY "Users can CRUD their own calendar settings"
  ON user_calendar_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Step 4: Create trigger for user_calendar_settings updated_at
DROP TRIGGER IF EXISTS update_user_calendar_settings_updated_at ON user_calendar_settings;
CREATE TRIGGER update_user_calendar_settings_updated_at
  BEFORE UPDATE ON user_calendar_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Step 5: Create calendar_sync_log table for debugging
CREATE TABLE IF NOT EXISTS calendar_sync_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  task_id UUID,
  google_event_id TEXT,
  action TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  sync_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Step 6: Enable RLS for calendar_sync_log
ALTER TABLE calendar_sync_log ENABLE ROW LEVEL SECURITY;

-- Step 7: Drop policies if exists, then create policies for calendar_sync_log
DROP POLICY IF EXISTS "Users can read their own sync logs" ON calendar_sync_log;
CREATE POLICY "Users can read their own sync logs"
  ON calendar_sync_log
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own sync logs" ON calendar_sync_log;
CREATE POLICY "Users can insert their own sync logs"
  ON calendar_sync_log
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Step 8: Create index for calendar_sync_log
CREATE INDEX IF NOT EXISTS idx_calendar_sync_log_user_id ON calendar_sync_log(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_sync_log_created_at ON calendar_sync_log(created_at DESC);
