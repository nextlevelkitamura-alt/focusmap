---
feature: プロジェクト管理CRUD（左サイドバー）
type: feature
method: impl
created: 2026-02-15
status: planning
---

# 設計プラン: プロジェクト管理CRUD（左サイドバー）

## 目標
左サイドバーでプロジェクトの作成・ステータス変更を行えるようにする。
今回はUI改善 + 基本操作に絞り、ドラッグ並べ替えや詳細編集は次回以降。

## 現状
- `left-sidebar.tsx` (119行): UIの枠組みのみ
- プロジェクトカード表示（実行/構想/アーカイブの3セクション）
- `+` ボタン、`⋯` メニューは見た目だけで機能なし
- プロジェクト切り替え（クリック選択）は動作中
- Goal 選択でプロジェクトをフィルタリング

## 実装範囲（今日）

### 1. プロジェクト新規作成
- セクションの `+` ボタン → インラインフォーム or ダイアログで名前入力
- ステータスは追加先セクションに応じて自動設定（実行 → active, 構想 → concept）
- Supabase に INSERT → ローカルステートに反映

### 2. コンテキストメニュー（⋯ ボタン）
- 名前変更（インライン編集）
- ステータス変更（active / concept / archived）
- 削除（確認ダイアログ付き）

### 3. UI改善
- セクションの折りたたみ機能
- プロジェクト件数バッジ
- 空状態の改善

## API 設計

### POST /api/projects
```json
{
  "goal_id": "uuid",
  "title": "string",
  "status": "active" | "concept",
  "priority": 3
}
```

### PATCH /api/projects/[id]
```json
{
  "title": "string",
  "status": "string"
}
```

### DELETE /api/projects/[id]
- タスクグループ・タスクも CASCADE 削除

## 実装対象ファイル
- `src/components/dashboard/left-sidebar.tsx` - UI改善、CRUD操作
- `src/app/api/projects/route.ts` - 新規作成（新規）
- `src/app/api/projects/[id]/route.ts` - 更新・削除（新規）
- `src/app/dashboard/dashboard-client.tsx` - ステート管理・コールバック追加

## 推奨実装方式
→ /impl
