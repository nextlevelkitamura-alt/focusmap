-- メモ（ideal_goals）から起動された ai_task の元アイテム参照
ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS source_ideal_goal_id UUID REFERENCES ideal_goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_source_ideal_goal
  ON ai_tasks(source_ideal_goal_id, status)
  WHERE source_ideal_goal_id IS NOT NULL;

COMMENT ON COLUMN ai_tasks.source_ideal_goal_id IS 'メモ（ideal_goals）から起動された場合の元アイテムID。重複実行防止 / UI 紐付けに使用。';
