-- AIプロジェクトコンテキスト（プロジェクトごとのAI記憶）
CREATE TABLE IF NOT EXISTS ai_project_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT '',         -- プロジェクトの目的（200字以内）
  current_status TEXT NOT NULL DEFAULT '',  -- 現状・進捗（200字以内）
  key_insights TEXT NOT NULL DEFAULT '',    -- 重要な決定・洞察（200字以内）
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_project_context_user_id ON ai_project_context(user_id);

ALTER TABLE ai_project_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project context"
  ON ai_project_context
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
