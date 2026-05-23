-- Normalized memo decomposition model.
-- Raw notes / wishlist memos stay intact; memo_items are the structured,
-- checkable, promotable units produced from those raw sources.

CREATE TABLE IF NOT EXISTS memo_structure_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('wishlist', 'note')),
  source_id UUID NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'quick' CHECK (mode IN ('quick', 'deep', 'manual')),
  input_hash TEXT NOT NULL,
  feedback TEXT,
  project_context_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  existing_item_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS memo_structure_runs_unique_completed_input_idx
  ON memo_structure_runs(user_id, source_type, source_id, input_hash, (COALESCE(feedback, '')))
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS idx_memo_structure_runs_user_source
  ON memo_structure_runs(user_id, source_type, source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memo_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('wishlist', 'note')),
  source_id UUID NOT NULL,
  structure_run_id UUID REFERENCES memo_structure_runs(id) ON DELETE SET NULL,
  parent_item_id UUID REFERENCES memo_items(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  item_kind TEXT NOT NULL DEFAULT 'task_candidate'
    CHECK (item_kind IN ('summary', 'theme', 'task_candidate', 'idea', 'question', 'reference', 'decision')),
  status TEXT NOT NULL DEFAULT 'organized'
    CHECK (status IN ('inbox', 'organized', 'task_candidate', 'task', 'scheduled', 'done', 'dismissed', 'archived')),
  content_hash TEXT NOT NULL,
  source_input_hash TEXT NOT NULL,
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  order_index INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS memo_items_unique_content_per_source_idx
  ON memo_items(user_id, source_type, source_id, content_hash);

CREATE INDEX IF NOT EXISTS idx_memo_items_user_source
  ON memo_items(user_id, source_type, source_id, order_index, created_at);

CREATE INDEX IF NOT EXISTS idx_memo_items_parent
  ON memo_items(parent_item_id)
  WHERE parent_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memo_items_project_status
  ON memo_items(user_id, project_id, status, updated_at DESC)
  WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS memo_node_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memo_item_id UUID NOT NULL REFERENCES memo_items(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('wishlist', 'note')),
  source_id UUID NOT NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  link_type TEXT NOT NULL DEFAULT 'mindmap_node' CHECK (link_type IN ('mindmap_node', 'task', 'schedule')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'dismissed', 'archived')),
  created_from_run_id UUID REFERENCES memo_structure_runs(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS memo_node_links_one_active_mindmap_link_idx
  ON memo_node_links(user_id, memo_item_id, link_type)
  WHERE link_type = 'mindmap_node' AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_memo_node_links_task
  ON memo_node_links(user_id, task_id, status, created_at DESC)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memo_node_links_source
  ON memo_node_links(user_id, source_type, source_id, status, created_at DESC);

DROP TRIGGER IF EXISTS update_memo_items_updated_at ON memo_items;
CREATE TRIGGER update_memo_items_updated_at
  BEFORE UPDATE ON memo_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_memo_node_links_updated_at ON memo_node_links;
CREATE TRIGGER update_memo_node_links_updated_at
  BEFORE UPDATE ON memo_node_links
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE memo_structure_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE memo_node_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_memo_structure_runs" ON memo_structure_runs;
CREATE POLICY "users_own_memo_structure_runs"
  ON memo_structure_runs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_memo_items" ON memo_items;
CREATE POLICY "users_own_memo_items"
  ON memo_items
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users_own_memo_node_links" ON memo_node_links;
CREATE POLICY "users_own_memo_node_links"
  ON memo_node_links
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE memo_structure_runs IS 'AI/manual memo decomposition run history, including prompt input hash and feedback memory.';
COMMENT ON TABLE memo_items IS 'Structured 2-level memo fragments extracted from raw wishlist/note sources.';
COMMENT ON TABLE memo_node_links IS 'Normalized links from structured memo fragments to mindmap task nodes or scheduling targets.';
