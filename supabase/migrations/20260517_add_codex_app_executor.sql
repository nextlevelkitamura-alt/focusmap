-- executor 'codex_app' を追加（Mac で Codex.app を起動するモード）
ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_executor_valid;
ALTER TABLE ai_tasks
  ADD CONSTRAINT ai_tasks_executor_valid CHECK (executor IN ('claude', 'codex', 'codex_app'));

-- Codex.app の thread ID（state_5.sqlite の threads.id）を保存
ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS codex_thread_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_codex_thread
  ON ai_tasks(codex_thread_id) WHERE codex_thread_id IS NOT NULL;

COMMENT ON COLUMN ai_tasks.codex_thread_id IS 'Codex.app の thread ID（~/.codex/state_5.sqlite の threads.id）。task-runner が起動後に first_user_message でマッチさせて保存';
