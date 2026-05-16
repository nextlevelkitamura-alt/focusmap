-- notes テーブルに画像URL配列カラムを追加
ALTER TABLE notes ADD COLUMN IF NOT EXISTS image_urls TEXT[];
