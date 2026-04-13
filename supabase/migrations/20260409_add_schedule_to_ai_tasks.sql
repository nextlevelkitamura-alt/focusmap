-- ai_tasks にスケジュール実行用カラムを追加
-- scheduled_at: このタイムスタンプ以降に実行（NULLなら即時実行）
-- recurrence_cron: 繰り返しcron式 (例: "0 9 * * *" = 毎日9時)

ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurrence_cron TEXT;

-- scheduled_at インデックス（pending + scheduled の高速検索）
CREATE INDEX IF NOT EXISTS idx_ai_tasks_scheduled
  ON ai_tasks (scheduled_at)
  WHERE status = 'pending' AND scheduled_at IS NOT NULL;

-- =========================================================
-- pg_cron + pg_net による Edge Function 毎分呼び出し設定
-- =========================================================
-- 事前準備（Supabase Dashboard > Database > Extensions）:
--   1. pg_cron を有効化
--   2. pg_net  を有効化
--
-- 上記有効化後、Supabase SQL Editor で以下を実行してください
-- （PROJECT_ID と SERVICE_ROLE_KEY は Dashboard > Settings > API で確認）:
--
-- SELECT cron.schedule(
--   'process-ai-tasks-every-minute',
--   '* * * * *',
--   $$
--   SELECT net.http_post(
--     url     := 'https://PROJECT_ID.supabase.co/functions/v1/process-ai-tasks',
--     headers := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer SERVICE_ROLE_KEY'
--     ),
--     body    := '{}'::jsonb
--   );
--   $$
-- );
--
-- 確認方法:
--   SELECT * FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--
-- Edge Function のデプロイ:
--   supabase functions deploy process-ai-tasks --project-ref PROJECT_ID
