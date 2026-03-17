-- =============================================================
-- 理想像 Phase 5: アイテムリッチ化・候補管理・日次トラッキング
-- =============================================================

-- 1. ideal_items にリッチフィールドを追加
ALTER TABLE ideal_items
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS reference_url TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;

-- 2. ideal_item_images: 1アイテムに複数画像を紐付け
CREATE TABLE IF NOT EXISTS ideal_item_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES ideal_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  caption TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ideal_item_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own item images"
  ON ideal_item_images FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own item images"
  ON ideal_item_images FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own item images"
  ON ideal_item_images FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_ideal_item_images_item ON ideal_item_images(item_id);

-- 3. ideal_candidates: 検討候補（例: メガネ候補A, B, C）
CREATE TABLE IF NOT EXISTS ideal_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES ideal_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,
  image_url TEXT,
  image_path TEXT,
  price INTEGER,
  pros TEXT,
  cons TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  status TEXT DEFAULT 'considering' CHECK (status IN ('considering', 'selected', 'rejected')),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ideal_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own candidates"
  ON ideal_candidates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own candidates"
  ON ideal_candidates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own candidates"
  ON ideal_candidates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own candidates"
  ON ideal_candidates FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_ideal_candidates_item ON ideal_candidates(item_id);

-- updated_at trigger for ideal_candidates
CREATE TRIGGER set_ideal_candidates_updated_at
  BEFORE UPDATE ON ideal_candidates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 4. ideal_item_completions: 日次トラッキング
CREATE TABLE IF NOT EXISTS ideal_item_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ideal_item_id UUID NOT NULL REFERENCES ideal_items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_date DATE NOT NULL,
  is_completed BOOLEAN NOT NULL DEFAULT false,
  elapsed_minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(ideal_item_id, user_id, completed_date)
);

ALTER TABLE ideal_item_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own completions"
  ON ideal_item_completions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own completions"
  ON ideal_item_completions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own completions"
  ON ideal_item_completions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own completions"
  ON ideal_item_completions FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_iic_user_date ON ideal_item_completions(user_id, completed_date);
CREATE INDEX idx_iic_item_date ON ideal_item_completions(ideal_item_id, completed_date);

-- updated_at trigger for ideal_item_completions
CREATE TRIGGER set_ideal_item_completions_updated_at
  BEFORE UPDATE ON ideal_item_completions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
