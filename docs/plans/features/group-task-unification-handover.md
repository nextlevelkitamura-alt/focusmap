# グループとタスクの統合 - 引き継ぎ書

> 最終更新: 2026-02-16
> 計画書: `~/.claude/plans/zany-seeking-leaf.md`

## 概要

`task_groups`テーブルと`tasks`テーブルを統合し、`is_group`フラグで区別する方式に移行中。
グループとタスクの違いをなくし、ドラッグ&ドロップや階層操作の制限を根本解決する。

---

## 進捗サマリ

| Phase | 内容 | 状態 | 備考 |
|-------|------|------|------|
| Phase 1 | DB移行 | ✅ 完了 | Supabase本番に適用済み |
| Phase 2 Step 2.1 | 型定義更新 | ✅ 完了 | `database.ts` |
| Phase 2 Step 2.2 | ヘルパー関数 | ✅ 完了 | `task-helpers.ts` 新規作成 |
| Phase 2 Step 2.3 | useMindMapSync | ✅ 完了 | allTasks統一ステート化 |
| Phase 2 Step 2.4 | mind-map.tsx | ❌ 未着手 | group_id → parent_task_id参照更新 |
| Phase 2 Step 2.5 | center-pane.tsx | ❌ 未着手 | group_id → parent_task_id参照更新 |
| Phase 2 Step 2.6 | useTaskCalendarSync | ❌ 未着手 | is_groupフィルタリング追加 |
| Phase 2 | ランタイムテスト | ❌ 未着手 | 実際にアプリを動かして動作確認 |
| Phase 3 | 旧テーブル削除 | ❌ 未着手 | task_groups削除、group_id削除 |

---

## 完了済みの作業詳細

### Phase 1: DB移行（Supabase本番適用済み）

**マイグレーションファイル:**
- `supabase/migrations/20260216_add_group_support_to_tasks.sql` - カラム追加+インデックス
- `supabase/migrations/20260216_migrate_task_groups_to_tasks.sql` - データ移行
- `supabase/migrations/20260216_validate_migration.sql` - 整合性チェック

**結果:**
- 5グループがtask_groups → tasks (is_group=TRUE)に移行済み
- 孤立タスク: 0件
- group_idのNOT NULL制約を解除済み

### Phase 2 完了分

**`src/types/database.ts`:**
- `project_id: string | null` 追加
- `is_group: boolean` 追加
- `group_id: string | null` (NOT NULL → nullable化)

**`src/lib/task-helpers.ts`（新規作成）:**
- `isGroup()`, `getGroups()`, `getTasksInGroup()`, `getRootTasks()`
- `getChildTasks()`, `hasChildren()`, `hasGroupChildren()`
- `isDescendant()`, `getTaskPath()`, `getGroupStats()`

**`src/hooks/useMindMapSync.ts`:**
- `groups` + `tasks` 分離ステート → `allTasks` 統一ステート
- `useMemo`で`groups`/`tasks`を計算プロパティとして導出
- `setGroups`/`setTasks`はuseCallbackラッパーで後方互換を維持
- CRUD操作は既存の`groups`/`tasks`変数をそのまま使用可能

---

## 次に着手すべき作業（Phase 2 残り）

### Step 2.4: mind-map.tsx の更新

**変更内容:**
- `group_id`参照を`parent_task_id`に置換
- グループノード生成時に`tasks.filter(t => t.is_group)`を使用
- タスク取得時: `t.group_id === groupId` → `t.parent_task_id === groupId`

### Step 2.5: center-pane.tsx の更新

**変更内容:**
- グループ一覧の取得方法を変更
- `groups.map(...)` → `tasks.filter(t => t.is_group).map(...)`

### Step 2.6: useTaskCalendarSync.ts の更新

**変更内容:**
- `enabled`条件に`!task.is_group`を追加（グループはカレンダー非同期）

### ランタイムテスト

以下を手動確認:
1. グループCRUD（作成・編集・削除）
2. タスクCRUD（作成・編集・削除）
3. ドラッグ&ドロップ（グループ間移動、グループ内並べ替え）
4. Undo/Redo (Cmd+Z / Cmd+Shift+Z)
5. タイマー機能
6. カレンダー同期（タスクのみ、グループは非同期）

---

## Phase 3: 旧テーブル削除（Phase 2完了後に着手）

1. バックアップ取得
2. `tasks`テーブルから`group_id`カラム削除
3. `task_groups`テーブル削除
4. `database.ts`から`TaskGroup`/`task_groups`型定義削除
5. ドキュメント更新

---

## 重要な技術的注意点

### TypeScript型とDB実態の乖離

- `database.ts`のtask_groups型には`priority`, `scheduled_at`, `estimated_time`があるが、**実際のDBテーブルにはこれらのカラムが存在しない**
- 移行SQLではこれに合わせてINSERT文を調整済み

### 後方互換性の維持方法

useMindMapSync.tsでは以下の戦略で後方互換性を維持:
```
内部: allTasks (統一ステート)
  ↓ useMemo
外部: groups (is_group === true のみ)
      tasks  (is_group !== true のみ)
  ↓ useCallback ラッパー
setGroups → allTasks の is_group=true 部分のみ更新
setTasks  → allTasks の is_group=false 部分のみ更新
```

### CHECK制約（将来のPhase 3で追加）

```sql
CONSTRAINT valid_hierarchy CHECK (
  (project_id IS NOT NULL AND parent_task_id IS NULL) OR
  (project_id IS NULL AND parent_task_id IS NOT NULL)
)
```
※現在はまだ追加していない（既存データとの互換性のため）

---

## 関連ファイル一覧

| ファイル | 状態 | 用途 |
|----------|------|------|
| `~/.claude/plans/zany-seeking-leaf.md` | 計画書 | 全体設計・詳細手順 |
| `docs/plans/features/group-task-unification-handover.md` | 引き継ぎ書 | 本ファイル |
| `docs/ROADMAP.md` | 進捗管理 | 現在進行中タスクに記載 |
| `src/types/database.ts` | ✅ 更新済み | 型定義 |
| `src/lib/task-helpers.ts` | ✅ 新規作成 | ヘルパー関数 |
| `src/hooks/useMindMapSync.ts` | ✅ 更新済み | 統一ステート管理 |
| `src/components/dashboard/mind-map.tsx` | ❌ 要更新 | ノード生成ロジック |
| `src/components/dashboard/center-pane.tsx` | ❌ 要更新 | リストビュー |
| `src/hooks/useTaskCalendarSync.ts` | ❌ 要更新 | カレンダー同期 |
| `supabase/migrations/20260216_*.sql` | ✅ 適用済み | DBマイグレーション |
