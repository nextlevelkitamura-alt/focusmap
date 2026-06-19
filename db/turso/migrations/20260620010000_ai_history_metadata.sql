-- Metadata-only AI history store for Codex.app and future local AI providers.
-- Full thread bodies and raw rollout logs stay outside Turso in this phase.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_history_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'codex_app',
  external_thread_id TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  worktree_path TEXT,
  project_id TEXT,
  source_task_id TEXT,
  linked_ai_task_id TEXT,
  title TEXT NOT NULL,
  snippet TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  run_state TEXT,
  last_activity_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  ended_at TEXT,
  work_duration_seconds INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  deleted_at TEXT,
  detail_synced_at TEXT,
  detail_message_count INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (archived IN (0, 1)),
  CHECK (status IN ('running', 'awaiting_approval', 'needs_input', 'completed', 'failed', 'idle'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_history_items_unique_thread_repo
  ON ai_history_items(user_id, provider, external_thread_id, repo_path);

CREATE INDEX IF NOT EXISTS idx_ai_history_items_user_repo_indexed
  ON ai_history_items(user_id, repo_path, indexed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_history_items_user_repo_activity
  ON ai_history_items(user_id, repo_path, last_activity_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_history_items_user_source_activity
  ON ai_history_items(user_id, source_task_id, last_activity_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_history_items_user_project_activity
  ON ai_history_items(user_id, project_id, last_activity_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_history_items_user_project_indexed
  ON ai_history_items(user_id, project_id, indexed_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_history_items_user_provider_thread_repo
  ON ai_history_items(user_id, provider, external_thread_id, repo_path);

CREATE INDEX IF NOT EXISTS idx_ai_history_items_visible_project_repo
  ON ai_history_items(user_id, project_id, repo_path, indexed_at DESC, id DESC)
  WHERE archived = 0 AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ai_history_items_visible_repo_activity
  ON ai_history_items(user_id, repo_path, last_activity_at DESC, id DESC)
  WHERE archived = 0 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS project_repo_scopes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'codex_app',
  repo_path TEXT NOT NULL,
  display_name TEXT,
  sync_enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at TEXT,
  last_reconciled_at TEXT,
  settings_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (sync_enabled IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_repo_scopes_unique_project_repo
  ON project_repo_scopes(user_id, project_id, provider, repo_path);

CREATE INDEX IF NOT EXISTS idx_project_repo_scopes_user_project_provider_repo
  ON project_repo_scopes(user_id, project_id, provider, repo_path);

CREATE INDEX IF NOT EXISTS idx_project_repo_scopes_user_sync_updated
  ON project_repo_scopes(user_id, sync_enabled, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_repo_scopes_user_project_sync
  ON project_repo_scopes(user_id, project_id, sync_enabled, updated_at DESC);
