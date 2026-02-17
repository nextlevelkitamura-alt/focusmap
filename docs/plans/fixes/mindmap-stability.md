---
fix: マインドマップ操作安定性
type: fix
created: 2026-02-16
status: investigating
---

# 修正計画: マインドマップ操作安定性

## エラー内容
1. Tab/Enter で子タスク・兄弟タスク追加後、ノードが消える (0.5秒後)
2. D&D によるノード移動が不安定（位置がスナップバックする）
3. アニメーションが滑らかでない
4. 範囲選択で複数ノード移動ができない

## 原因分析

### 1. ノード消失の根本原因
- `applySelection` 内の `reactFlow.setNodes()` が ReactFlow の controlled/uncontrolled を混在させている
- 新ノード作成 → `applySelection` → `reactFlow.setNodes()` がまだ新ノードを含まない古いノード一覧に対して実行
- → `onSelectionChange` が空のselectionで発火 → `selectedNodeIds` がクリアされる
- → `pendingEditNodeId` クリア (300ms) で triggerEdit が変化 → useMemo 再計算時にレイアウト再構築

### 2. D&D 不安定の根本原因
- `useMemo` (layout計算) が `selectedNodeIds`, `pendingEditNodeId`, callback関数を含む多数の依存に反応
- クリックやフォーカス変更のたびに dagre レイアウトが再計算 → ノード位置がリセット
- ドラッグ中にも再計算が起きるため、ノードがスナップバックする

### 3. アニメーション不足
- ReactFlow ノードに CSS transition がない → レイアウト変更時にジャンプ

## 修正方針

### A. `applySelection` から `reactFlow.setNodes()` を削除
- selection は `layoutNodes` の `selected` プロパティで管理 → `reactFlow.setNodes()` は不要

### B. useMemo を構造計算とデータ注入に分離
- **構造 useMemo**: dagre レイアウト計算 → `groupsJson`, `tasksJson`, `collapsedTaskIds` のみに依存
- **データ useMemo**: callback・selection・edit状態の注入 → 軽量な map 処理

### C. callback を ref 経由で渡す
- `callbacksRef` を使い、callback の参照変更が useMemo を無効化しない

### D. CSS transition 追加
- `.react-flow__node` に `transition: transform 200ms ease`
- ドラッグ中は transition を無効化

### E. 範囲選択ドラッグ対応
- `onSelectionDragStart/Drag/Stop` を実装

## 修正対象ファイル
- `src/components/dashboard/mind-map.tsx`
- `src/app/globals.css`
