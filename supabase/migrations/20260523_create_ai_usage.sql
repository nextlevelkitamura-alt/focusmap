-- AI使用量ログ。課金（使用枠）設計の土台。
-- Phase 1 では記録のみ。上限チェック・課金は将来のフェーズで実装する。

CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,                       -- 'memo_to_mindmap' 等
  model TEXT NOT NULL,                         -- 実際に使ったモデル名
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,   -- 推定原価（内部監視用）
  metadata JSONB,                              -- { noteCount, mode, projectId } 等
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created
  ON ai_usage(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_feature
  ON ai_usage(feature, created_at DESC);

COMMENT ON TABLE ai_usage IS 'AI使用量ログ。1 AIアクション = 1行。課金（使用枠）の計測土台。';

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Phase 1: 自分の使用量行を read/insert 可能。
-- 将来、上限を強制する段階で insert をサーバー（service role）専用に絞る。
DROP POLICY IF EXISTS "users_own_ai_usage" ON ai_usage;
CREATE POLICY "users_own_ai_usage"
  ON ai_usage
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
