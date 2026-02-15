-- Phase 1: Step 1.1 - tasksテーブルに新カラム追加
-- グループとタスクの統合: is_groupフラグとproject_idを追加

-- 1. 新しいカラムを追加
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT FALSE NOT NULL;

-- 2. インデックスを作成（パフォーマンス最適化）
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_is_group ON tasks(is_group);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id_is_group ON tasks(project_id, is_group) WHERE project_id IS NOT NULL;

-- 3. 複合インデックス（階層取得の最適化）
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id_is_group ON tasks(parent_task_id, is_group) WHERE parent_task_id IS NOT NULL;

-- Note: このマイグレーションではデータは変更しません。次のマイグレーションで移行を行います。
