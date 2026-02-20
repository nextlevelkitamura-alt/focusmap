-- タスクメモ欄: tasks テーブルに memo カラムを追加
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS memo TEXT;
