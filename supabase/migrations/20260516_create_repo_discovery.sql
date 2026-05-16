-- ─────────────────────────────────────────────────────────────
-- リポジトリ自動発見機構
-- task-runner が Mac 上で .git ディレクトリを再帰探索し、結果を
-- ここに保存する。UI 側はこのテーブルからドロップダウン表示する。
-- ─────────────────────────────────────────────────────────────

-- スキャン対象パスの設定（ホスト別）
CREATE TABLE IF NOT EXISTS user_scan_settings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  scan_paths TEXT[] NOT NULL DEFAULT ARRAY[
    '~/dev',
    '~/Documents',
    '~/Projects',
    '~/Workspace',
    '~/Private',
    '~/Code'
  ],
  scan_now_requested_at TIMESTAMPTZ NULL,
  last_scanned_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, hostname)
);

COMMENT ON TABLE user_scan_settings IS 'task-runner が走る Mac ごとのスキャン対象パス設定';
COMMENT ON COLUMN user_scan_settings.scan_paths IS '~/ プレフィックス可。task-runner 側で HOME 展開する';
COMMENT ON COLUMN user_scan_settings.scan_now_requested_at IS 'Web UI から「今すぐスキャン」が押された時刻。task-runner はこれを見て即座にスキャンする';

ALTER TABLE user_scan_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_scan_settings" ON user_scan_settings;
CREATE POLICY "users_own_scan_settings"
  ON user_scan_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- 発見されたリポジトリ
CREATE TABLE IF NOT EXISTS available_repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_git_commit_at TIMESTAMPTZ NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, hostname, absolute_path)
);

CREATE INDEX IF NOT EXISTS idx_available_repos_user ON available_repos(user_id, last_git_commit_at DESC NULLS LAST);

COMMENT ON TABLE available_repos IS 'task-runner が発見したリポ一覧。UI のドロップダウン用';
COMMENT ON COLUMN available_repos.last_git_commit_at IS '最終 git commit 時刻。最近触ったものを上に表示するため';

ALTER TABLE available_repos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_available_repos" ON available_repos;
CREATE POLICY "users_own_available_repos"
  ON available_repos
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- updated_at の自動更新トリガー
CREATE OR REPLACE FUNCTION touch_user_scan_settings_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_scan_settings_touch ON user_scan_settings;
CREATE TRIGGER trg_user_scan_settings_touch
  BEFORE UPDATE ON user_scan_settings
  FOR EACH ROW EXECUTE FUNCTION touch_user_scan_settings_updated_at();
