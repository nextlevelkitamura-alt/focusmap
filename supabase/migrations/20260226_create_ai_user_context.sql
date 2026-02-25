-- AIユーザーコンテキスト（パーソナライズ用）
CREATE TABLE IF NOT EXISTS ai_user_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  persona TEXT NOT NULL DEFAULT '',
  preferences JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_context_user_id ON ai_user_context(user_id);

ALTER TABLE ai_user_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own context"
  ON ai_user_context
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
