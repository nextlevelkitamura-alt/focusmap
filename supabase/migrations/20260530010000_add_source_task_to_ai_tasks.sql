-- Allow AI runs to be launched from ordinary mind-map task nodes.
ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS source_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_source_task
  ON ai_tasks(source_task_id, status)
  WHERE source_task_id IS NOT NULL;

COMMENT ON COLUMN ai_tasks.source_task_id IS 'マインドマップの通常タスクノードから起動された場合の元タスクID。重複実行防止 / UI 紐付けに使用。';
