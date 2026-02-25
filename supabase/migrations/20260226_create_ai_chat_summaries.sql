-- AIチャット会話要約テーブル
CREATE TABLE IF NOT EXISTS ai_chat_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  topics TEXT[] DEFAULT '{}',
  message_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_summaries_user_id ON ai_chat_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_summaries_created_at ON ai_chat_summaries(created_at DESC);

ALTER TABLE ai_chat_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own summaries"
  ON ai_chat_summaries
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
