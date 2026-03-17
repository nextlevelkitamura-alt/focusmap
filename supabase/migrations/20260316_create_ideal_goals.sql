-- ideal_goals / ideal_items / ideal_attachments
-- 「なりたい自分（Ideal Self）」管理機能
-- Supabase Storage バケット: ideal-attachments

-- ============================================================
-- ideal_goals: 理想の本体（最大3件/ユーザー）
-- ============================================================
CREATE TABLE IF NOT EXISTS ideal_goals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title            text NOT NULL,
  description      text,
  cover_image_url  text,         -- Storage 署名付き URL
  cover_image_path text,         -- Storage 内パス（更新・削除用）
  category         text,         -- 'appearance'|'lifestyle'|'career'|'learning'|'other'
  color            text NOT NULL DEFAULT 'blue',
  status           text NOT NULL DEFAULT 'active',  -- 'active'|'achieved'|'archived'
  display_order    integer NOT NULL DEFAULT 0,

  -- 期間
  duration_months  integer,      -- NULL=無期限。12=1年、3=3ヶ月
  start_date       date,
  target_date      date,

  -- 時間負荷サマリー（ideal_items の daily_minutes 合計）
  total_daily_minutes integer NOT NULL DEFAULT 0,

  -- 費用サマリー
  cost_total       integer,      -- 総費用概算（円）
  cost_monthly     integer,      -- 月次費用概算（円）

  ai_summary       text,         -- AI が生成したサマリー（コンテキスト注入用）

  created_at       timestamptz DEFAULT now() NOT NULL,
  updated_at       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS ideal_goals_user_id_idx ON ideal_goals(user_id);

ALTER TABLE ideal_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ideal_goals"
  ON ideal_goals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ideal_goals"
  ON ideal_goals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ideal_goals"
  ON ideal_goals FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own ideal_goals"
  ON ideal_goals FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- ideal_items: 理想に紐づく行動・費用アイテム
-- ============================================================
CREATE TABLE IF NOT EXISTS ideal_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ideal_id         uuid REFERENCES ideal_goals(id) ON DELETE CASCADE NOT NULL,
  user_id          uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title            text NOT NULL,
  item_type        text NOT NULL DEFAULT 'habit',
    -- 'habit'     定期行動（例: 毎日スキンケア 15 分）
    -- 'action'    単発アクション（例: 美容院予約）
    -- 'cost'      費用アイテム（例: 髭脱毛 ¥150,000）
    -- 'milestone' 達成マイルストーン（例: ホクロ除去完了）

  -- 時間負荷（habit / action 用）
  frequency_type   text NOT NULL DEFAULT 'daily',
    -- 'daily'|'weekly'|'monthly'|'once'
  frequency_value  integer NOT NULL DEFAULT 1,   -- 週 N 回の "N"
  session_minutes  integer NOT NULL DEFAULT 0,   -- 1 回あたりの時間（分）
  daily_minutes    integer NOT NULL DEFAULT 0,   -- 正規化済み日次換算
    -- daily:   session_minutes
    -- weekly:  ROUND(session_minutes * frequency_value / 7.0)
    -- monthly: ROUND(session_minutes * frequency_value / 30.0)
    -- once:    0

  -- 費用（cost 用）
  item_cost        integer,       -- 金額（円）
  cost_type        text DEFAULT 'once',  -- 'once'|'monthly'|'annual'

  is_done          boolean NOT NULL DEFAULT false,
  linked_task_id   uuid REFERENCES tasks(id) ON DELETE SET NULL,
  linked_habit_id  uuid REFERENCES tasks(id) ON DELETE SET NULL,
  display_order    integer NOT NULL DEFAULT 0,

  created_at       timestamptz DEFAULT now() NOT NULL,
  updated_at       timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS ideal_items_ideal_id_idx ON ideal_items(ideal_id);
CREATE INDEX IF NOT EXISTS ideal_items_user_id_idx  ON ideal_items(user_id);

ALTER TABLE ideal_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ideal_items"
  ON ideal_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ideal_items"
  ON ideal_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ideal_items"
  ON ideal_items FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own ideal_items"
  ON ideal_items FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- ideal_attachments: 理想への画像・ドキュメント添付
-- （task_attachments と同一パターン）
-- ============================================================
CREATE TABLE IF NOT EXISTS ideal_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  ideal_id      uuid REFERENCES ideal_goals(id) ON DELETE CASCADE NOT NULL,
  file_name     text NOT NULL,
  file_url      text NOT NULL,      -- 署名付き URL
  storage_path  text NOT NULL,      -- Storage 内パス（削除用）
  file_type     text NOT NULL,
  file_size     integer NOT NULL,
  created_at    timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS ideal_attachments_ideal_id_idx ON ideal_attachments(ideal_id);
CREATE INDEX IF NOT EXISTS ideal_attachments_user_id_idx  ON ideal_attachments(user_id);

ALTER TABLE ideal_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ideal_attachments"
  ON ideal_attachments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own ideal_attachments"
  ON ideal_attachments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own ideal_attachments"
  ON ideal_attachments FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ideal_goals_updated_at
  BEFORE UPDATE ON ideal_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER ideal_items_updated_at
  BEFORE UPDATE ON ideal_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Storage バケット設定（手動で実施）
-- ============================================================
-- Supabase Dashboard > Storage > New bucket
--   名前: ideal-attachments
--   Public: false
--
-- Storage RLS ポリシー（Dashboard > Storage > Policies）:
--   バケット: ideal-attachments
--   SELECT/INSERT/DELETE:
--     bucket_id = 'ideal-attachments' AND auth.uid()::text = (storage.foldername(name))[1]
