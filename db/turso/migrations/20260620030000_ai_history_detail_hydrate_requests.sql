-- Active detail-hydrate requests for unlinked AI history items.
-- Frontend detail open records a short-lived request; the local agent polls it
-- and posts sanitized display messages to ai_history_detail_messages.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_history_detail_hydrate_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  history_item_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'codex_app',
  external_thread_id TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'web',
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  fulfilled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (history_item_id) REFERENCES ai_history_items(id) ON DELETE CASCADE,
  CHECK (reason IN ('detail_cache_empty', 'detail_cache_unsynced', 'detail_cache_stale')),
  CHECK (requested_by IN ('web', 'agent', 'system'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_history_detail_hydrate_requests_unique_history
  ON ai_history_detail_hydrate_requests(user_id, history_item_id);

CREATE INDEX IF NOT EXISTS idx_ai_history_detail_hydrate_requests_user_active
  ON ai_history_detail_hydrate_requests(user_id, fulfilled_at, expires_at DESC, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_history_detail_hydrate_requests_user_provider_thread_repo
  ON ai_history_detail_hydrate_requests(user_id, provider, external_thread_id, repo_path);
