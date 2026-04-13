-- ai_tasks に作業ディレクトリ（cwd）カラムを追加
-- 特定リポのスキルを実行する際に、そのリポのパスを指定する
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS cwd TEXT;
