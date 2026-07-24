-- AIが提案し、人間がDailyで採用/却下するTheme候補。
-- Theme本体とは分け、採用時だけ themes + theme_days + theme_repos へ原子的に昇格する。

CREATE TABLE IF NOT EXISTS theme_candidates (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  purpose            TEXT,
  done_criteria      TEXT,
  goal_ref           TEXT,
  repo_slug          TEXT REFERENCES repos(slug),
  source_session_key TEXT,
  source_turn_id     TEXT,
  proposed_by        TEXT NOT NULL DEFAULT 'ai' CHECK (proposed_by IN ('ai', 'human')),
  status             TEXT NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed', 'adopted', 'rejected')),
  adopted_theme_id   TEXT REFERENCES themes(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_theme_candidates_status
  ON theme_candidates(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_theme_candidates_source_turn
  ON theme_candidates(source_session_key, source_turn_id)
  WHERE source_session_key IS NOT NULL AND source_turn_id IS NOT NULL;
