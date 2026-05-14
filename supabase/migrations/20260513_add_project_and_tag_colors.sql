ALTER TABLE ideal_goals
ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ideal_goals_project_id
ON ideal_goals(project_id)
WHERE project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS memo_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#8b5cf6',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memo_tags_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT memo_tags_user_name_unique UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_memo_tags_user_id
ON memo_tags(user_id);

ALTER TABLE memo_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own memo tags" ON memo_tags;
CREATE POLICY "Users can view own memo tags"
ON memo_tags FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own memo tags" ON memo_tags;
CREATE POLICY "Users can insert own memo tags"
ON memo_tags FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own memo tags" ON memo_tags;
CREATE POLICY "Users can update own memo tags"
ON memo_tags FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own memo tags" ON memo_tags;
CREATE POLICY "Users can delete own memo tags"
ON memo_tags FOR DELETE
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_memo_tags_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_memo_tags_updated_at ON memo_tags;
CREATE TRIGGER update_memo_tags_updated_at
BEFORE UPDATE ON memo_tags
FOR EACH ROW
EXECUTE FUNCTION update_memo_tags_updated_at();

INSERT INTO memo_tags (user_id, name, color)
SELECT DISTINCT user_id, tag_name, '#8b5cf6'
FROM (
  SELECT user_id, trim(category) AS tag_name
  FROM ideal_goals
  WHERE status IN ('wishlist', 'memo')
    AND category IS NOT NULL
    AND trim(category) <> ''
  UNION
  SELECT user_id, trim(unnest(tags)) AS tag_name
  FROM ideal_goals
  WHERE status IN ('wishlist', 'memo')
    AND tags IS NOT NULL
) existing_tags
WHERE tag_name <> ''
ON CONFLICT (user_id, name) DO NOTHING;

NOTIFY pgrst, 'reload schema';
