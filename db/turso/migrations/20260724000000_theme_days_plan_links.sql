-- Daily Theme の日次継承と Theme-Plan / Theme-repo の正規化。
-- 対象DB: personal-os-inbox（PERSONAL_OS_INBOX_DATABASE_URL）。
--
-- 正本境界:
--   themes            = Theme定義（名前・目的・完了条件）。日ごとに複製しない。
--   theme_days        = その日にThemeを採用した事実と日次状態。
--   theme_plan_links  = Plan slugのTheme所属。Plan本文・bucketはrepo Markdown正本のまま。
--   theme_repos       = Themeを表示するrepo範囲。
--
-- plan_slug は原則1つのThemeにだけ所属させるため PRIMARY KEY とする。
-- 現行 themes.plan_refs JSON は移行元としてだけ読み、以後の正本にはしない。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS theme_days (
  theme_id         TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  day              TEXT NOT NULL,
  state            TEXT NOT NULL DEFAULT 'active'
                     CHECK (state IN ('active', 'completed', 'skipped')),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  carried_from_day TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (theme_id, day)
);

CREATE INDEX IF NOT EXISTS idx_theme_days_day
  ON theme_days(day, state, sort_order);

CREATE TABLE IF NOT EXISTS theme_plan_links (
  plan_slug  TEXT PRIMARY KEY,
  theme_id   TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_theme_plan_links_theme
  ON theme_plan_links(theme_id, sort_order, plan_slug);

CREATE TABLE IF NOT EXISTS theme_repos (
  theme_id   TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  repo_slug  TEXT NOT NULL REFERENCES repos(slug),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (theme_id, repo_slug)
);

CREATE INDEX IF NOT EXISTS idx_theme_repos_repo
  ON theme_repos(repo_slug, theme_id);

-- 現行JSONから正規化表へ一度だけ移す。
-- 同じPlanが複数Themeに書かれている場合は sort_order が小さいThemeを採用する。
INSERT OR IGNORE INTO theme_plan_links (plan_slug, theme_id, sort_order)
SELECT
  TRIM(CAST(ref.value AS TEXT)) AS plan_slug,
  t.id AS theme_id,
  CAST(ref.key AS INTEGER) AS sort_order
FROM themes t
JOIN json_each(
  CASE
    WHEN json_valid(COALESCE(t.plan_refs, '[]')) THEN COALESCE(t.plan_refs, '[]')
    ELSE '[]'
  END
) ref
WHERE TRIM(CAST(ref.value AS TEXT)) != ''
ORDER BY t.sort_order, t.created_at, CAST(ref.key AS INTEGER);
