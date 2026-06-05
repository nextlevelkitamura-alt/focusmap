-- Codex monitoring lightweight state store for Turso/libSQL.
-- Supabase Auth remains the identity provider; API handlers must enforce user_id
-- from verified auth and never trust client supplied user_id.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  space_id TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  executor TEXT,
  dispatch_mode TEXT,
  source_type TEXT,
  source_id TEXT,
  codex_thread_id TEXT,
  current_step TEXT,
  progress_percent INTEGER,
  summary TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_turso_ai_tasks_user_status_updated
  ON ai_tasks(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_turso_ai_tasks_user_created
  ON ai_tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_turso_ai_tasks_user_updated_cursor
  ON ai_tasks(user_id, updated_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_turso_ai_tasks_space_updated_cursor
  ON ai_tasks(space_id, updated_at ASC, id ASC)
  WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_turso_ai_tasks_codex_thread
  ON ai_tasks(codex_thread_id)
  WHERE codex_thread_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_task_progress (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  phase TEXT,
  message TEXT,
  progress_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_turso_ai_task_progress_task_created
  ON ai_task_progress(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_turso_ai_task_progress_user_created
  ON ai_task_progress(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_turso_ai_task_events_task_created
  ON ai_task_events(task_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_turso_ai_task_events_user_type_created
  ON ai_task_events(user_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS runner_heartbeats (
  runner_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT,
  status TEXT NOT NULL DEFAULT 'online',
  last_seen_at TEXT NOT NULL,
  current_task_id TEXT,
  version TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_turso_runner_heartbeats_user_seen
  ON runner_heartbeats(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS task_progress_watches (
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  watcher_id TEXT NOT NULL,
  watcher_type TEXT NOT NULL DEFAULT 'web',
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (task_id, user_id, watcher_id)
);

CREATE INDEX IF NOT EXISTS idx_turso_task_progress_watches_user_expires
  ON task_progress_watches(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_turso_task_progress_watches_task_expires
  ON task_progress_watches(task_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_turso_task_progress_watches_expires
  ON task_progress_watches(expires_at ASC);

CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  thumbnail_key TEXT,
  preview_key TEXT,
  width INTEGER,
  height INTEGER,
  thumbnail_size_bytes INTEGER,
  preview_size_bytes INTEGER,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at TEXT,
  local_original_path_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_turso_screenshots_user_task_captured
  ON screenshots(user_id, task_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_turso_screenshots_user_created
  ON screenshots(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_turso_screenshots_preview_key
  ON screenshots(preview_key)
  WHERE preview_key IS NOT NULL;
