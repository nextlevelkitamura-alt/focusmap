-- Dashboard/mobile performance indexes.
-- These match the hot paths used by /dashboard, useMindMapSync.refreshFromServer,
-- and /api/wishlist without changing row visibility or application behavior.

CREATE INDEX IF NOT EXISTS idx_tasks_active_priority_order
  ON public.tasks (priority DESC, order_index ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_active_project_tree_order
  ON public.tasks (project_id, parent_task_id, order_index ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_active_user_priority_order
  ON public.tasks (user_id, priority DESC, order_index ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_created_desc
  ON public.projects (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_space_created_desc
  ON public.projects (space_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_spaces_created_desc
  ON public.spaces (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ideal_goals_memo_user_display
  ON public.ideal_goals (user_id, display_order ASC)
  WHERE status IN ('wishlist', 'memo');

CREATE INDEX IF NOT EXISTS idx_ideal_goals_memo_project_display
  ON public.ideal_goals (project_id, display_order ASC)
  WHERE status IN ('wishlist', 'memo');
