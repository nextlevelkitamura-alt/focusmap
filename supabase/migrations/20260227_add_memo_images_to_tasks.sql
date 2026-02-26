-- ノードメモ画像: tasks テーブルに memo_images カラムを追加
-- 画像は URL または data URL を配列で保持する
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS memo_images TEXT[];
