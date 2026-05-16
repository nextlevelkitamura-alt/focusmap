-- メモから Claude Code を起動する際の作業ディレクトリ（cwd）として使用する
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_path TEXT NULL;
COMMENT ON COLUMN projects.repo_path IS 'ローカルリポジトリの絶対パス。Claude Code 実行時の cwd に使用。';
