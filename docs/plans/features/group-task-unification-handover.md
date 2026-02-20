# グループとタスクの統合 - 引き継ぎ書

> 最終更新: 2026-02-21

## 概要

`task_groups`テーブルのデータを`tasks`テーブルに統合済み。
全ノードを`TaskNode`として統一し、ルートタスクは`parent_task_id === null`で判定。

## 進捗

| Phase | 状態 | 内容 |
|-------|------|------|
| Phase 1 | ✅ 完了 | DB移行（is_group, project_idカラム追加、5グループ移行） |
| Phase 2 | ✅ 完了 | コード変更（GroupNode廃止、CRUD統合、全ファイル更新、ビルド成功） |
| Phase 3 | ⏳ 進行中 | 旧テーブル削除（コード完了、DBマイグレーション保留） |

## Phase 3: 旧テーブル削除

### コード側（完了）
- ✅ `database.ts`から`TaskGroup`型定義削除
- ✅ `database.ts`から`group_id`カラム削除
- ✅ `page.tsx`の`task_groups`フェッチ削除
- ✅ `dashboard-loader.tsx`の`initialGroups` prop削除
- ✅ `dashboard-client.tsx`の`TaskGroup`参照削除
- ✅ `useMindMapSync.ts`の`initialGroups`→`initialRootTasks`に変更
- ✅ API routes の`group_id`/`task_groups`参照削除
- ✅ テストファイルの`TaskGroup`参照削除

### DB側（保留）
- [ ] バックアップ取得
- [ ] マイグレーション実行: `supabase/migrations/20260221_phase3_cleanup_task_groups.sql`

## 現在のアーキテクチャ

- ルートタスク = `parent_task_id === null`（`is_group`フラグに依存しない）
- 全ノードを`TaskNode`で描画（`GroupNode`は削除済み）
- CRUD操作は`createTask`/`updateTask`/`deleteTask`に統合
- `groups`変数 = `allTasks.filter(t => t.parent_task_id === null)` で導出
