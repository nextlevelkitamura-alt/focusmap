ALTER TABLE tasks ADD COLUMN IF NOT EXISTS mindmap_collapsed BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN tasks.mindmap_collapsed IS 'Whether this node is collapsed in the custom mindmap view. FALSE means children are expanded.';
