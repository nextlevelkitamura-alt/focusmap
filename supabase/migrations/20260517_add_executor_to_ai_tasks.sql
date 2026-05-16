-- ai_tasks にどの AI エージェントで実行するか指定
ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS executor TEXT NOT NULL DEFAULT 'claude';

COMMENT ON COLUMN ai_tasks.executor IS 'AI エージェントの種類。claude (Claude Code) / codex (OpenAI Codex CLI)';

-- 既存データはすべて claude（後方互換）
-- CHECK 制約で値を限定（必要なら将来 gemini-cli なども追加）
ALTER TABLE ai_tasks
  ADD CONSTRAINT ai_tasks_executor_valid CHECK (executor IN ('claude', 'codex'));
