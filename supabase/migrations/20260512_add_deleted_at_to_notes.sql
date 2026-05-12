-- Add soft-delete support for notes.
-- The application filters active notes with deleted_at IS NULL.

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notes_active
  ON notes(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_deleted_at
  ON notes(user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
