-- ─────────────────────────────────────────────────────────────
-- tasks.codex_work_dir
--   マインドマップのノード（task）ごとに、Codex 実行時の
--   作業ディレクトリ（cwd）を保持する。
--   設計: docs/plans/active/mindmap-node-codex-relay.md
--
--   ノードから「Codexで実行」する際の cwd は、project.repo_path ではなく
--   この per-node 設定を必須とする（未設定なら実行不可）。
--   値は実行ホスト(Mac)上の絶対パス。
-- ─────────────────────────────────────────────────────────────

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS codex_work_dir text;

COMMENT ON COLUMN tasks.codex_work_dir IS
  'Codex relay 用の作業ディレクトリ(cwd)。ノードからCodex実行する際に必須。実行ホスト上の絶対パス。';
