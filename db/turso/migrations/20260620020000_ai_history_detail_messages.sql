-- Sanitized detail cache for unlinked AI history items.
-- This table stores display-only user prompts and assistant replies.
-- Raw rollout JSONL, full thread bodies, command output, screenshots, and base64 image bodies are not stored here.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_history_detail_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  history_item_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'codex_app',
  external_thread_id TEXT NOT NULL,
  repo_path TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  occurred_at TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (history_item_id) REFERENCES ai_history_items(id) ON DELETE CASCADE,
  CHECK (sequence >= 0),
  CHECK (role IN ('user', 'assistant', 'system')),
  CHECK (kind IN ('user_prompt', 'assistant_answer', 'assistant_question', 'status', 'summary')),
  CHECK (length(body) > 0 AND length(body) <= 8000),
  CHECK (length(body_hash) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_history_detail_messages_unique_sequence_hash
  ON ai_history_detail_messages(user_id, history_item_id, sequence, body_hash);

CREATE INDEX IF NOT EXISTS idx_ai_history_detail_messages_user_history_sequence
  ON ai_history_detail_messages(user_id, history_item_id, sequence, id);

CREATE INDEX IF NOT EXISTS idx_ai_history_detail_messages_user_history_created
  ON ai_history_detail_messages(user_id, history_item_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_history_detail_messages_user_provider_thread_repo
  ON ai_history_detail_messages(user_id, provider, external_thread_id, repo_path);
