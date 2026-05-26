-- ─────────────────────────────────────────────────────────────
-- ai_tasks.executor の CHECK制約を拡張
--   旧: ('claude', 'codex', 'codex_app')
--   新: ('claude', 'codex', 'codex_app', 'playwright', 'simple')
--
-- 背景: Phase C (focusmap-agent) で executor='playwright' / 'simple' のタスクを
-- 投入する設計だが、既存DB制約により INSERT が失敗していた。
-- ─────────────────────────────────────────────────────────────

ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_executor_valid;

ALTER TABLE ai_tasks
  ADD CONSTRAINT ai_tasks_executor_valid
  CHECK (executor IN ('claude', 'codex', 'codex_app', 'playwright', 'simple'));

COMMENT ON CONSTRAINT ai_tasks_executor_valid ON ai_tasks IS
  'claude/codex = codex-rpc-bridge / playwright/simple = focusmap-agent';
