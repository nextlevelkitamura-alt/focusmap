-- Phase 1: Step 1.3 - 移行の整合性チェック
-- データが正しく移行されたことを確認

-- 1. 移行したグループ数の確認
DO $$
DECLARE
  old_count INTEGER;
  new_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO old_count FROM task_groups;
  SELECT COUNT(*) INTO new_count FROM tasks WHERE is_group = TRUE;

  IF old_count != new_count THEN
    RAISE EXCEPTION 'Migration failed: % groups in task_groups, but % groups in tasks', old_count, new_count;
  END IF;

  RAISE NOTICE '✓ Migration successful: % groups migrated', new_count;
END $$;

-- 2. 孤立タスクのチェック（parent_task_idが無効なタスク）
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM tasks
  WHERE parent_task_id IS NOT NULL
    AND is_group = FALSE
    AND NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.id = tasks.parent_task_id);

  IF orphan_count > 0 THEN
    RAISE WARNING 'Found % orphan tasks with invalid parent_task_id', orphan_count;

    -- 孤立タスクの詳細を表示
    RAISE NOTICE 'Orphan tasks:';
    FOR r IN (
      SELECT id, title, parent_task_id
      FROM tasks
      WHERE parent_task_id IS NOT NULL
        AND is_group = FALSE
        AND NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.id = tasks.parent_task_id)
      LIMIT 10
    ) LOOP
      RAISE NOTICE '  - Task: % (%), parent_task_id: %', r.title, r.id, r.parent_task_id;
    END LOOP;

    RAISE EXCEPTION 'Migration validation failed: orphan tasks found';
  END IF;

  RAISE NOTICE '✓ No orphan tasks found';
END $$;

-- 3. プロジェクト直下のグループ/タスクの確認
DO $$
DECLARE
  root_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO root_count
  FROM tasks
  WHERE project_id IS NOT NULL AND parent_task_id IS NULL;

  RAISE NOTICE '✓ Found % root-level tasks/groups (project_id set, parent_task_id NULL)', root_count;
END $$;

-- 4. 階層構造の整合性チェック
-- project_id と parent_task_id が同時に設定されていないことを確認
DO $$
DECLARE
  invalid_hierarchy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_hierarchy_count
  FROM tasks
  WHERE project_id IS NOT NULL AND parent_task_id IS NOT NULL;

  IF invalid_hierarchy_count > 0 THEN
    RAISE EXCEPTION 'Found % tasks with both project_id and parent_task_id set (invalid hierarchy)', invalid_hierarchy_count;
  END IF;

  RAISE NOTICE '✓ Hierarchy structure is valid';
END $$;

-- 5. グループのステータスチェック（全てtodoであることを確認）
DO $$
DECLARE
  non_todo_group_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO non_todo_group_count
  FROM tasks
  WHERE is_group = TRUE AND status != 'todo';

  IF non_todo_group_count > 0 THEN
    RAISE WARNING 'Found % groups with status != todo', non_todo_group_count;
  ELSE
    RAISE NOTICE '✓ All groups have status = todo';
  END IF;
END $$;

-- 最終レポート
DO $$
DECLARE
  total_tasks INTEGER;
  total_groups INTEGER;
  total_items INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_groups FROM tasks WHERE is_group = TRUE;
  SELECT COUNT(*) INTO total_tasks FROM tasks WHERE is_group = FALSE;
  total_items := total_groups + total_tasks;

  RAISE NOTICE '';
  RAISE NOTICE '=== Migration Summary ===';
  RAISE NOTICE 'Total items: %', total_items;
  RAISE NOTICE '  - Groups: %', total_groups;
  RAISE NOTICE '  - Tasks: %', total_tasks;
  RAISE NOTICE '========================';
END $$;
