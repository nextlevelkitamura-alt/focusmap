-- プロジェクトコンテキストの簡素化。
-- 散在していたコンテキスト（ai_project_context / ai_context_documents / projects.purpose）を
-- projects.description の1フィールドに集約する。
-- 既存データは scripts/migrate-project-context.ts で移行する。

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN projects.description IS
  'プロジェクトの説明（何のプロジェクトか・目的・対象・現状）。AIが読む唯一のプロジェクトコンテキスト。';
