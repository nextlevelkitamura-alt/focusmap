-- Store linked Google account profile for settings display
ALTER TABLE user_calendar_settings
ADD COLUMN IF NOT EXISTS google_account_name TEXT,
ADD COLUMN IF NOT EXISTS google_account_email TEXT,
ADD COLUMN IF NOT EXISTS google_account_picture TEXT;

COMMENT ON COLUMN user_calendar_settings.google_account_name IS 'Linked Google account display name';
COMMENT ON COLUMN user_calendar_settings.google_account_email IS 'Linked Google account email';
COMMENT ON COLUMN user_calendar_settings.google_account_picture IS 'Linked Google account avatar URL';
