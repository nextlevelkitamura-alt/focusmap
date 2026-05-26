-- ─────────────────────────────────────────────────────────────
-- Seed: 初期スキルテンプレを ai_task_packages に登録
--   * MVP の3スキル: カレンダー整理 / 競合・情報サイト巡回 / メール要約
--   * space_id = NULL (システムテンプレ、全Workspaceで参照可能)
--   * user_id = NULL では参照整合性違反のため、system user (00000000-...) を使う形に
-- ─────────────────────────────────────────────────────────────
-- 注意: user_id NOT NULL なので、各Workspaceで「テンプレを取り込む」操作で
--      個別の ai_task_packages 行として作成する設計。
--      このseedは「テンプレ定義」を `system_skill_templates` に保存し、
--      アプリ層から取り込ませる方針。

-- ─────────────────────────────────────────────────────────────
-- システムスキルテンプレテーブル (取り込み元)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_skill_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT,
  category TEXT NOT NULL,
  model_tier TEXT NOT NULL CHECK (model_tier IN ('simple', 'agent', 'mixed')),
  approval_type TEXT NOT NULL DEFAULT 'auto' CHECK (approval_type IN ('auto', 'confirm', 'interactive')),
  prompt_template TEXT NOT NULL,
  default_schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  estimated_cost_usd NUMERIC(10,6),
  estimated_duration_sec INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE system_skill_templates ENABLE ROW LEVEL SECURITY;

-- 認証ユーザーなら誰でも閲覧可
DROP POLICY IF EXISTS "system_skill_templates_read_all" ON system_skill_templates;
CREATE POLICY "system_skill_templates_read_all"
  ON system_skill_templates FOR SELECT
  USING (auth.role() = 'authenticated' AND is_active = true);

-- ─────────────────────────────────────────────────────────────
-- MVP 初期スキル3個
-- ─────────────────────────────────────────────────────────────

INSERT INTO system_skill_templates (
  id, title, description, icon, category, model_tier, approval_type,
  prompt_template, default_schedule, input_schema,
  estimated_cost_usd, estimated_duration_sec, metadata
) VALUES (
  'calendar-organize',
  '今日のカレンダー整理',
  'Google Calendarの今日の予定を取得し、空き時間と推奨作業時間帯を提案します。',
  '📅',
  'morning',
  'simple',
  'auto',
  'Google Calendar APIで今日の予定を取得し、以下を出力してください: 1) 空き時間スロット (15分以上) 2) 各空き時間に推奨する作業候補 3) 移動時間/会議準備時間の考慮。出力はJSON形式 ({"free_slots": [...], "suggested_allocations": [...], "warnings": [...]})。',
  '{"cron": "0 7 * * 1-5", "timezone": "Asia/Tokyo"}'::jsonb,
  '{"properties": {"include_archived": {"type": "boolean", "default": false, "label": "アーカイブ済み予定も含める"}}}'::jsonb,
  0.005,
  120,
  '{"steps": [{"label": "Google Calendar から予定取得", "auto": true}, {"label": "空き時間計算 + AI提案", "auto": true}, {"label": "Webアプリに結果表示", "auto": true}], "cache_strategy": {"enabled": true, "cached_sections": ["system", "output_schema"]}}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  prompt_template = EXCLUDED.prompt_template,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO system_skill_templates (
  id, title, description, icon, category, model_tier, approval_type,
  prompt_template, default_schedule, input_schema,
  estimated_cost_usd, estimated_duration_sec, metadata
) VALUES (
  'web-research',
  '競合・情報サイト巡回',
  '事前登録したサイトを巡回して新着情報をサマリします。キーワードフィルタ可。',
  '🌐',
  'research',
  'simple',
  'auto',
  '以下のURL一覧を巡回し、各サイトの新着情報を3行で要約してください。指定キーワード ({keywords}) を含む情報があれば優先表示。出力はJSON形式 ({"summaries": [{"url": ..., "title": ..., "summary": ..., "matched_keywords": [...]}]})。',
  '{"cron": "0 8 * * 1-5", "timezone": "Asia/Tokyo"}'::jsonb,
  '{"properties": {"urls": {"type": "array", "items": {"type": "string"}, "label": "巡回URLs", "min": 1, "max": 10}, "keywords": {"type": "array", "items": {"type": "string"}, "label": "注目キーワード", "default": []}}}'::jsonb,
  0.02,
  300,
  '{"steps": [{"label": "URLリスト読込", "auto": true}, {"label": "各サイトHTTP取得", "auto": true}, {"label": "AIで要約 + キーワードフィルタ", "auto": true}, {"label": "結果表示", "auto": true}], "cache_strategy": {"enabled": true, "cached_sections": ["system", "output_schema"]}}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  prompt_template = EXCLUDED.prompt_template,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO system_skill_templates (
  id, title, description, icon, category, model_tier, approval_type,
  prompt_template, default_schedule, input_schema,
  estimated_cost_usd, estimated_duration_sec, metadata
) VALUES (
  'email-summary',
  'メール要約',
  'Gmailの未読メールを3行で要約し、重要度を判定します。',
  '📧',
  'morning',
  'simple',
  'auto',
  'Gmail APIで過去 {lookback_hours} 時間の未読メールを最大 {max_emails} 件取得し、各メールを3行で要約。重要度 (high/medium/low) と返信必要性を判定。出力はJSON形式 ({"emails": [{"subject": ..., "from": ..., "summary": ..., "priority": ..., "needs_reply": bool}], "must_reply_count": N})。',
  '{"cron": "0 7 * * *", "timezone": "Asia/Tokyo"}'::jsonb,
  '{"properties": {"max_emails": {"type": "number", "default": 50, "min": 10, "max": 200}, "lookback_hours": {"type": "number", "default": 24, "min": 1, "max": 168}}}'::jsonb,
  0.01,
  180,
  '{"steps": [{"label": "Gmailにログイン", "auto": true, "model_tier": "agent"}, {"label": "未読メール取得", "auto": true}, {"label": "AI要約 + 重要度判定", "auto": true, "model_tier": "simple"}, {"label": "結果表示", "auto": true}], "cache_strategy": {"enabled": true, "cached_sections": ["system", "output_schema"]}}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  prompt_template = EXCLUDED.prompt_template,
  metadata = EXCLUDED.metadata,
  updated_at = now();

-- ─────────────────────────────────────────────────────────────
-- 完了
-- ─────────────────────────────────────────────────────────────
