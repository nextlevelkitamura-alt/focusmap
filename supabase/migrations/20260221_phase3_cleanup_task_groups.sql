-- Phase 3: グループ統合完了後のクリーンアップ
-- 1. tasks テーブルから group_id カラムを削除
-- 2. task_groups テーブルを削除

-- ============================================
-- Step 1: group_id カラム削除
-- ============================================
-- group_id は旧スキーマの名残で、現在は parent_task_id を使用
ALTER TABLE public.tasks DROP COLUMN IF EXISTS group_id;

-- ============================================
-- Step 2: task_groups テーブル削除
-- ============================================
-- task_groups テーブルのデータは tasks テーブルに統合済み
-- (is_group = true, parent_task_id = null で表現)

-- 外部キー制約があれば先に削除
-- ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_group_id_fkey;

-- テーブル削除
DROP TABLE IF EXISTS public.task_groups CASCADE;

-- ============================================
-- Step 3: 関連インデックス・トリガーのクリーンアップ
-- ============================================
-- task_groups 関連のインデックスがあれば削除（自動削除されるはずだが明示的に）
DROP INDEX IF EXISTS public.task_groups_project_id_idx;
DROP INDEX IF EXISTS public.task_groups_user_id_idx;

-- ============================================
-- 完了ログ
-- ============================================
-- マイグレーション完了後、以下の状態になる：
-- - tasks テーブル: group_id カラム削除済み
-- - task_groups テーブル: 削除済み
-- - 全てのグループ/タスクは tasks テーブルで管理（is_group, parent_task_id で識別）
