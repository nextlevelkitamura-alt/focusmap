-- AIユーザーコンテキスト（パーソナライズ用）
-- テーブルが未作成の場合は先に作成する
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_user_context'
      AND policyname = 'Users can manage own context'
  ) THEN
    CREATE POLICY "Users can manage own context"
      ON ai_user_context
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ユーザーコンテキストを3カテゴリに拡張
-- life_personality: 生活スタイル・性格
-- life_purpose: 人生の目的・目標・価値観
-- current_situation: 最近の状況・悩み・仕事

ALTER TABLE ai_user_context
  ADD COLUMN IF NOT EXISTS life_personality TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS life_purpose TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_situation TEXT NOT NULL DEFAULT '';

-- 既存の persona の内容を life_personality に移行
UPDATE ai_user_context
  SET life_personality = persona
  WHERE persona != '' AND life_personality = '';
