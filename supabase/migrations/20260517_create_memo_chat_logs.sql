-- メモ対話チャットのアーカイブ
-- 各セッション（チャットシートを開いて閉じるまで）を1行として保存
-- 30日経過したものは別途クリーンアップ（cron or 手動）

CREATE TABLE IF NOT EXISTS memo_chat_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,  -- フロントが生成。同じセッション内の更新はこれで upsert
  source_memo_id UUID NULL REFERENCES ideal_goals(id) ON DELETE SET NULL,
  source_memo_title TEXT,  -- 非正規化。メモ削除されても表示できるように
  /** OpenAI 形式の会話履歴（system は含まない、user/assistant/tool のみ） */
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** 実行されたツールアクションのログ（[{tool, args, result}, ...]） */
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** チャット開始時のメモ情報スナップショット */
  source_snapshot JSONB,
  /** 何ターン会話したか */
  turn_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_memo_chat_logs_user_memo
  ON memo_chat_logs(user_id, source_memo_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memo_chat_logs_cleanup
  ON memo_chat_logs(updated_at);

COMMENT ON TABLE memo_chat_logs IS 'メモ対話チャット履歴。各セッション1行。30日経過で削除推奨。';

ALTER TABLE memo_chat_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_memo_chat_logs" ON memo_chat_logs;
CREATE POLICY "users_own_memo_chat_logs"
  ON memo_chat_logs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION touch_memo_chat_logs_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memo_chat_logs_touch ON memo_chat_logs;
CREATE TRIGGER trg_memo_chat_logs_touch
  BEFORE UPDATE ON memo_chat_logs
  FOR EACH ROW EXECUTE FUNCTION touch_memo_chat_logs_updated_at();
