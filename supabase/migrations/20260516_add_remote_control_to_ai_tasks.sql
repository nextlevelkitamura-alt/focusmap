-- メモから生成された ai_task を識別し、Remote Control セッション情報を保存する
ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS source_note_id UUID REFERENCES notes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remote_session_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS tmux_session_name TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_source_note
  ON ai_tasks(source_note_id, status)
  WHERE source_note_id IS NOT NULL;

COMMENT ON COLUMN ai_tasks.source_note_id IS 'メモから起動された場合の元メモID。重複実行防止 / UI 紐付けに使用。';
COMMENT ON COLUMN ai_tasks.remote_session_url IS 'claude --remote-control が発行する claude.ai/code セッションURL。スマホからの接続用。';
COMMENT ON COLUMN ai_tasks.tmux_session_name IS 'tmux セッション名。後から terminate / attach に使用。';
