# グループとタスクの統合 - 引き継ぎ書

> 最終更新: 2026-02-16

## 概要

`task_groups`テーブルのデータを`tasks`テーブルに統合済み。
全ノードを`TaskNode`として統一し、ルートタスクは`parent_task_id === null`で判定。

## 進捗

| Phase | 状態 | 内容 |
|-------|------|------|
| Phase 1 | ✅ 完了 | DB移行（is_group, project_idカラム追加、5グループ移行） |
| Phase 2 | ✅ 完了 | コード変更（GroupNode廃止、CRUD統合、全ファイル更新、ビルド成功） |
| Phase 3 | ❌ 未着手 | 旧テーブル削除 |

## Phase 3: 旧テーブル削除（残作業）

1. バックアップ取得
2. `tasks`テーブルから`group_id`カラム削除
3. `task_groups`テーブル削除
4. `database.ts`から`TaskGroup`/`task_groups`型定義削除
5. `useMindMapSync.ts`/`dashboard-client.tsx`の`initialGroups: TaskGroup[]`を廃止
6. `page.tsx`の`task_groups`フェッチを削除
7. CHECK制約追加（任意）:
   ```sql
   CONSTRAINT valid_hierarchy CHECK (
     (project_id IS NOT NULL AND parent_task_id IS NULL) OR
     (project_id IS NULL AND parent_task_id IS NOT NULL)
   )
   ```

## 現在のアーキテクチャ

- ルートタスク = `parent_task_id === null`（`is_group`フラグに依存しない）
- 全ノードを`TaskNode`で描画（`GroupNode`は削除済み）
- CRUD操作は`createTask`/`updateTask`/`deleteTask`に統合
- `groups`変数 = `allTasks.filter(t => t.parent_task_id === null)` で導出
