-- Event Task Import: tasks テーブルにイベント取り込み用カラムを追加

-- Step 1: source カラム追加（'manual' | 'google_event'）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

-- Step 2: deleted_at カラム追加（ソフトデリート用）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Step 3: google_event_fingerprint カラム追加（変更検出用）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS google_event_fingerprint TEXT;

-- Step 4: インデックス作成
CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source) WHERE source = 'google_event';
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_google_event_id ON tasks(google_event_id) WHERE google_event_id IS NOT NULL;
