-- Focusmap Lite: token-authenticated local agent and command queue.

CREATE TABLE IF NOT EXISTS agent_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_user
  ON agent_tokens(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_space
  ON agent_tokens(space_id, created_at DESC)
  WHERE space_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id UUID NOT NULL REFERENCES ai_runners(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  task_id UUID REFERENCES ai_tasks(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (
    type IN (
      'open_url',
      'open_google_auth',
      'open_gws_auth',
      'open_browser_auth',
      'run_shell',
      'restart_agent',
      'pause_agent',
      'resume_agent',
      'upload_logs',
      'scan_capabilities'
    )
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result JSONB,
  error TEXT,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_commands_runner_pending
  ON agent_commands(runner_id, status, created_at)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS idx_agent_commands_user
  ON agent_commands(user_id, created_at DESC);

ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_executor_valid;
ALTER TABLE ai_tasks
  ADD CONSTRAINT ai_tasks_executor_valid
  CHECK (executor IN ('claude', 'codex', 'codex_app', 'playwright', 'simple', 'browser', 'terminal'));

ALTER TABLE ai_task_packages DROP CONSTRAINT IF EXISTS ai_task_packages_executor_check;
ALTER TABLE ai_task_packages
  ADD CONSTRAINT ai_task_packages_executor_check
  CHECK (executor IN ('claude', 'codex', 'codex_app', 'playwright', 'simple', 'browser', 'terminal'));

ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_tokens_select_owner" ON agent_tokens;
DROP POLICY IF EXISTS "agent_tokens_insert_owner" ON agent_tokens;
DROP POLICY IF EXISTS "agent_tokens_update_owner" ON agent_tokens;
DROP POLICY IF EXISTS "agent_tokens_delete_owner" ON agent_tokens;
CREATE POLICY "agent_tokens_select_owner" ON agent_tokens
  FOR SELECT USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_own_space(space_id)));
CREATE POLICY "agent_tokens_insert_owner" ON agent_tokens
  FOR INSERT WITH CHECK (user_id = auth.uid() AND (space_id IS NULL OR public.can_own_space(space_id)));
CREATE POLICY "agent_tokens_update_owner" ON agent_tokens
  FOR UPDATE USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_own_space(space_id)))
  WITH CHECK (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_own_space(space_id)));
CREATE POLICY "agent_tokens_delete_owner" ON agent_tokens
  FOR DELETE USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_own_space(space_id)));

DROP POLICY IF EXISTS "agent_commands_select_related" ON agent_commands;
DROP POLICY IF EXISTS "agent_commands_insert_editors" ON agent_commands;
DROP POLICY IF EXISTS "agent_commands_update_editors" ON agent_commands;
DROP POLICY IF EXISTS "agent_commands_delete_editors" ON agent_commands;
CREATE POLICY "agent_commands_select_related" ON agent_commands
  FOR SELECT USING (
    user_id = auth.uid()
    OR (space_id IS NOT NULL AND public.can_view_space(space_id))
    OR public.runner_user_id(runner_id) = auth.uid()
  );
CREATE POLICY "agent_commands_insert_editors" ON agent_commands
  FOR INSERT WITH CHECK (user_id = auth.uid() AND (space_id IS NULL OR public.can_edit_space(space_id)));
CREATE POLICY "agent_commands_update_editors" ON agent_commands
  FOR UPDATE USING (
    user_id = auth.uid()
    OR (space_id IS NOT NULL AND public.can_edit_space(space_id))
    OR public.runner_user_id(runner_id) = auth.uid()
  )
  WITH CHECK (
    user_id = auth.uid()
    OR (space_id IS NOT NULL AND public.can_edit_space(space_id))
    OR public.runner_user_id(runner_id) = auth.uid()
  );
CREATE POLICY "agent_commands_delete_editors" ON agent_commands
  FOR DELETE USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_edit_space(space_id)));

COMMENT ON TABLE agent_tokens IS 'Focusmap Lite local agent bearer tokens. Raw tokens are shown once and only hashes are stored.';
COMMENT ON TABLE agent_commands IS 'Small command queue from Focusmap Web to Focusmap Lite local agents.';
COMMENT ON CONSTRAINT ai_tasks_executor_valid ON ai_tasks IS
  'claude/codex = interactive AI tools, playwright/simple/browser/terminal = Focusmap Lite local agent';

NOTIFY pgrst, 'reload schema';
