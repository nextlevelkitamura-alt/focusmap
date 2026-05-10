ALTER TABLE tasks ADD COLUMN node_width INTEGER NULL;
COMMENT ON COLUMN tasks.node_width IS 'User-resized node width in pixels for mindmap view. NULL means auto-sized.';
