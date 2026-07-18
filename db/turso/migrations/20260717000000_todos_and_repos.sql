-- やること箱: todos + reposマスタ
-- 対象DB: personal-os-inbox（PERSONAL_OS_INBOX_DATABASE_URL）。
-- 既存の db/turso/migrations/*.sql はメインTurso（TURSO_DATABASE_URL）向けだが、
-- この機能は focusmap Web が書込トークンを持つ personal-os-inbox 側に新設する。
-- repo選択肢の正本は personal-os/AIエージェント基盤/repo-registry/repo概要.md。
-- ここは参照コピー（同期方向: registry → DB のみ）。
-- 適用方法（本番適用は人間ゲート）: turso db shell personal-os-inbox < このファイル

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repos (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO repos (slug, name, sort_order) VALUES
  ('shigoto', '仕事', 1),
  ('focusmap', 'focusmap', 2),
  ('private', 'Private', 3),
  ('ai-platform', 'AIエージェント基盤', 4),
  ('none', 'なし（私用）', 5);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  note TEXT,
  do_date TEXT NOT NULL,
  due_date TEXT,
  repo TEXT NOT NULL REFERENCES repos(slug),
  assignee TEXT NOT NULL CHECK (assignee IN ('self', 'ai')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
  ai_status TEXT NOT NULL DEFAULT '未検知' CHECK (ai_status IN ('未検知', '検知', '立案中', '実行中', '確認待ち', '完了')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'chat', 'cli')),
  goal_ref TEXT,
  -- AIがこのやることを実行する時に自セッションkey（board DBのsessions.session_key）を書く。
  -- ボード上で「やること行⇄稼働エージェント」を紐付けるための任意列（2026-07-18・調整2）。
  session_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_todos_do_date ON todos(do_date);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_ai_status ON todos(ai_status);
