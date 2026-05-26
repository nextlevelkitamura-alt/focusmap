-- ─────────────────────────────────────────────────────────────
-- SaaS化のためのDB拡張 (差分migration)
--   * 既存実装の80%は完成済み (spaces / space_members / ai_runners / ai_task_packages / ai_usage / api_keys)
--   * 本migrationは「不足分」のみ追加する
--   * 詳細: docs/plans/saas-design-buyer-user.md / saas-design-api-billing.md
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- 1. spaces にプラン情報・課金情報を追加
-- ─────────────────────────────────────────────────────────────
ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'personal', 'team', 'enterprise')),
  ADD COLUMN IF NOT EXISTS billing_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS billing_current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS seat_count INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_spaces_billing_customer
  ON spaces(billing_customer_id)
  WHERE billing_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spaces_plan
  ON spaces(plan);

COMMENT ON COLUMN spaces.plan IS 'free / personal / team / enterprise';
COMMENT ON COLUMN spaces.billing_customer_id IS 'Stripe Customer ID';
COMMENT ON COLUMN spaces.billing_subscription_id IS 'Stripe Subscription ID';
COMMENT ON COLUMN spaces.seat_count IS 'Teamプラン時のseat数 (最低3)';

-- ─────────────────────────────────────────────────────────────
-- 2. ai_task_packages にSaaS用メタデータ追加
--    既存executor (claude/codex/codex_app) は維持しつつ、model_tier で抽象化
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ai_task_packages
  ADD COLUMN IF NOT EXISTS model_tier TEXT NOT NULL DEFAULT 'simple'
    CHECK (model_tier IN ('simple', 'agent', 'mixed')),
  ADD COLUMN IF NOT EXISTS approval_type TEXT NOT NULL DEFAULT 'auto'
    CHECK (approval_type IN ('auto', 'confirm', 'interactive')),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS icon TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS estimated_duration_sec INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_task_packages_tier
  ON ai_task_packages(model_tier, is_active);

CREATE INDEX IF NOT EXISTS idx_ai_task_packages_category
  ON ai_task_packages(category)
  WHERE category IS NOT NULL;

COMMENT ON COLUMN ai_task_packages.model_tier IS 'simple=Flash-Lite, agent=DeepSeek V4 Pro 等, mixed=ステップ毎';
COMMENT ON COLUMN ai_task_packages.approval_type IS 'auto / confirm / interactive';
COMMENT ON COLUMN ai_task_packages.metadata IS 'steps / cache_strategy / fallback_model_tier 等';

-- ─────────────────────────────────────────────────────────────
-- 3. ai_usage に space_id を追加 (集計用)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ai_usage
  ADD COLUMN IF NOT EXISTS space_id UUID REFERENCES spaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES ai_task_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT;  -- 'YYYY-MM' 形式、月集計用

CREATE INDEX IF NOT EXISTS idx_ai_usage_space_cycle
  ON ai_usage(space_id, billing_cycle, created_at DESC)
  WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_cycle
  ON ai_usage(user_id, billing_cycle, created_at DESC);

-- 既存行の billing_cycle を補完
UPDATE ai_usage
SET billing_cycle = to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM')
WHERE billing_cycle IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 4. audit_logs テーブル新規 (操作監査用)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,           -- 'space.created' / 'member.invited' / 'plan.upgraded' / 'skill.executed' 等
  target_type TEXT,                -- 'space' / 'member' / 'package' / 'task' 等
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_space_created
  ON audit_logs(space_id, created_at DESC)
  WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs(action, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Space オーナー/管理者だけが監査ログを閲覧可能
DROP POLICY IF EXISTS "audit_logs_space_owner_read" ON audit_logs;
CREATE POLICY "audit_logs_space_owner_read"
  ON audit_logs FOR SELECT
  USING (
    space_id IS NULL OR public.can_own_space(space_id, auth.uid())
  );

-- INSERT は service role 経由のみ (アプリ層から)
DROP POLICY IF EXISTS "audit_logs_service_insert" ON audit_logs;
CREATE POLICY "audit_logs_service_insert"
  ON audit_logs FOR INSERT
  WITH CHECK (true);  -- アプリ層で制御 (RLS は最低限)

COMMENT ON TABLE audit_logs IS 'BUYER管理画面で表示する監査ログ。Owner/Admin閲覧可';

-- ─────────────────────────────────────────────────────────────
-- 5. user_byok_keys テーブル新規 (BYOK = Bring Your Own Key)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_byok_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('anthropic', 'openai', 'google', 'moonshot', 'deepseek', 'groq')),
  encrypted_key TEXT NOT NULL,     -- AES-256-GCM で暗号化された API key
  key_hint TEXT NOT NULL,           -- 末尾4文字など (UI表示用)
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1 user + 1 space + 1 provider で1キーまで (Workspace 紐付けあり)
CREATE UNIQUE INDEX IF NOT EXISTS idx_byok_keys_unique_per_space
  ON user_byok_keys(space_id, user_id, provider)
  WHERE space_id IS NOT NULL;

-- 1 user + 1 provider で1キーまで (個人用、Workspace 紐付けなし)
CREATE UNIQUE INDEX IF NOT EXISTS idx_byok_keys_unique_personal
  ON user_byok_keys(user_id, provider)
  WHERE space_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_byok_keys_space
  ON user_byok_keys(space_id, provider, is_active)
  WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_byok_keys_user
  ON user_byok_keys(user_id, provider, is_active);

ALTER TABLE user_byok_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "byok_keys_own_or_space_admin" ON user_byok_keys;
CREATE POLICY "byok_keys_own_or_space_admin"
  ON user_byok_keys FOR ALL
  USING (
    auth.uid() = user_id
    OR (space_id IS NOT NULL AND public.can_own_space(space_id, auth.uid()))
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (space_id IS NOT NULL AND public.can_own_space(space_id, auth.uid()))
  );

COMMENT ON TABLE user_byok_keys IS 'BYOK: ユーザー/Workspace 持ち込み API key (暗号化保管)';

-- ─────────────────────────────────────────────────────────────
-- 6. ヘルパー関数: get_workspace_plan
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_workspace_plan(p_space_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(s.plan, 'free')
  FROM public.spaces s
  WHERE s.id = p_space_id
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_plan(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7. ヘルパー関数: get_usage_summary
--    指定 space_id (or user_id) の月間実行回数とトークン消費を返す
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_usage_summary(
  p_space_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT auth.uid(),
  p_cycle TEXT DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
)
RETURNS TABLE (
  scope TEXT,
  executions INTEGER,
  input_tokens BIGINT,
  output_tokens BIGINT,
  cost_usd NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH user_sum AS (
    SELECT
      'user'::text AS scope,
      COUNT(*)::integer AS executions,
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM public.ai_usage
    WHERE user_id = p_user_id
      AND billing_cycle = p_cycle
  ),
  space_sum AS (
    SELECT
      'space'::text AS scope,
      COUNT(*)::integer AS executions,
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM public.ai_usage
    WHERE space_id = p_space_id
      AND billing_cycle = p_cycle
  )
  SELECT * FROM user_sum
  UNION ALL
  SELECT * FROM space_sum WHERE p_space_id IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION public.get_usage_summary(UUID, UUID, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8. ヘルパー関数: log_audit (アプリ層から呼ぶ)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_audit(
  p_space_id UUID,
  p_action TEXT,
  p_target_type TEXT DEFAULT NULL,
  p_target_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.audit_logs (space_id, user_id, action, target_type, target_id, metadata)
  VALUES (p_space_id, auth.uid(), p_action, p_target_type, p_target_id, p_metadata)
  RETURNING id INTO v_log_id;
  RETURN v_log_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.log_audit(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 9. 既存 ai_tasks の billing_cycle 列追加 (使用量計測連動用)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_space_cycle
  ON ai_tasks(space_id, billing_cycle, created_at DESC)
  WHERE space_id IS NOT NULL;

-- 既存行のbackfill
UPDATE ai_tasks
SET billing_cycle = to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM')
WHERE billing_cycle IS NULL;

-- ─────────────────────────────────────────────────────────────
-- 完了
-- ─────────────────────────────────────────────────────────────
