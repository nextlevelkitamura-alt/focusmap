-- Daily Themeの完了条件を、本文とチェック状態を分けた正規化データとして保存する。
-- 対象DB: personal-os-inbox（PERSONAL_OS_INBOX_DATABASE_URL）。
-- 既存 themes.done_criteria は互換・履歴用に残し、初回適用時は1件の未チェック項目へ移す。
-- Themeの日次完了（theme_days.state）はこの表の全件完了だけでは変更しない。人が明示操作する。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS theme_completion_criteria (
  id           TEXT PRIMARY KEY,
  theme_id     TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  content      TEXT NOT NULL CHECK (length(trim(content)) > 0),
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0, 1)),
  completed_at TEXT,
  completed_by TEXT CHECK (completed_by IS NULL OR completed_by IN ('human', 'ai')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_theme_completion_criteria_theme
  ON theme_completion_criteria(theme_id, sort_order, created_at);

-- 既存の文章は1項目として保持する。本文の分割・意味の解釈は行わない。
INSERT OR IGNORE INTO theme_completion_criteria
  (id, theme_id, content, is_completed, completed_at, completed_by, sort_order, version, created_at, updated_at)
SELECT
  'legacy:' || id,
  id,
  trim(done_criteria),
  0,
  NULL,
  NULL,
  0,
  1,
  updated_at,
  updated_at
FROM themes
WHERE trim(COALESCE(done_criteria, '')) != '';

-- 旧board.pyや互換APIがdone_criteriaだけでThemeを作っても、完了条件を失わない。
CREATE TRIGGER IF NOT EXISTS themes_done_criteria_to_completion_criteria
AFTER INSERT ON themes
WHEN trim(COALESCE(NEW.done_criteria, '')) != ''
BEGIN
  INSERT OR IGNORE INTO theme_completion_criteria
    (id, theme_id, content, is_completed, completed_at, completed_by, sort_order, version, created_at, updated_at)
  VALUES
    ('legacy:' || NEW.id, NEW.id, trim(NEW.done_criteria), 0, NULL, NULL, 0, 1, NEW.updated_at, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS themes_done_criteria_update_to_completion_criteria
AFTER UPDATE OF done_criteria ON themes
WHEN trim(COALESCE(NEW.done_criteria, '')) != ''
 AND NOT EXISTS (SELECT 1 FROM theme_completion_criteria WHERE theme_id = NEW.id)
BEGIN
  INSERT OR IGNORE INTO theme_completion_criteria
    (id, theme_id, content, is_completed, completed_at, completed_by, sort_order, version, created_at, updated_at)
  VALUES
    ('legacy:' || NEW.id, NEW.id, trim(NEW.done_criteria), 0, NULL, NULL, 0, 1, NEW.updated_at, NEW.updated_at);
END;
