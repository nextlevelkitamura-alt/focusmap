ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS codex_thread_import_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS codex_thread_import_enabled_since TIMESTAMPTZ NULL;

COMMENT ON COLUMN projects.codex_thread_import_enabled IS 'Codex.appで直接開始したthreadを、このプロジェクトのrepo_pathへ自動取り込みするか。';
COMMENT ON COLUMN projects.codex_thread_import_enabled_since IS 'Codex thread自動取り込みをONにした時刻。この時刻以降のthreadだけを対象にする。';
