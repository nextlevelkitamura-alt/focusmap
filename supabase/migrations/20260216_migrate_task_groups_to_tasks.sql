-- Phase 1: Step 1.2 - task_groupsデータをtasksに移行
-- 既存のtask_groupsをtasksテーブルに統合

-- 0. group_id の NOT NULL 制約を外す（グループは group_id = NULL）
ALTER TABLE tasks ALTER COLUMN group_id DROP NOT NULL;

-- 1. task_groupsのデータをtasksに挿入
-- is_group = TRUE として、グループとして識別
-- Note: task_groupsには priority, scheduled_at, estimated_time, calendar_event_id カラムは存在しない
INSERT INTO tasks (
  id, user_id, project_id, parent_task_id, is_group,
  title, order_index,
  status, actual_time_minutes, total_elapsed_seconds, last_started_at,
  is_timer_running, created_at
)
SELECT
  id, user_id, project_id, NULL, TRUE,
  title, order_index,
  'todo', 0, 0, NULL,
  FALSE, created_at
FROM task_groups
ON CONFLICT (id) DO NOTHING;

-- 2. 既存タスクのgroup_idをparent_task_idに移行
UPDATE tasks
SET parent_task_id = group_id
WHERE group_id IS NOT NULL
  AND parent_task_id IS NULL
  AND is_group = FALSE;

-- Note: この時点ではtask_groupsテーブルとgroup_idカラムは削除しません（Phase 3で削除）
