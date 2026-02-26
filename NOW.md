# NOW: AIプロジェクト相談 v2 — マインドマップ連携 + 自動要約

## 仕様書
→ [docs/specs/ai-project-consultation-v2.md](docs/specs/ai-project-consultation-v2.md)

---

## Step 1: マインドマップ構造テキスト生成関数 ✅
- [x] `src/lib/ai/context/mindmap-context.ts` を新規作成
- [x] groups + tasks → ツリー形式テキスト生成
- [x] ✅完了マークとノードID付き

## Step 2: プロジェクト相談プロンプト改修 ✅
- [x] `src/lib/ai/skills/prompts/project-consultation.ts` を改修
- [x] 振り分けロジック（マインドマップ vs 予定）の指示追加
- [x] プロジェクト概要ヒアリングの指示追加
- [x] 再要約型 `project_context_update` の指示追加
- [x] マインドマップ操作アクションブロックの出力形式定義

## Step 3: chat route 改修 ✅
- [x] マインドマップ構造をDB取得 → プロンプトに注入
- [x] プロジェクト特定時の動的コンテキスト読み込み（ai_context_documents）
- [x] `project_context_update` を追記型 → 再要約上書き型に変更
- [x] `projectContextUpdated` フラグをレスポンスに追加

## Step 4: マインドマップ操作エンドポイント ✅
- [x] `src/app/api/ai/chat/execute/route.ts` に追加
- [x] `add_mindmap_group` — グループ追加
- [x] `add_mindmap_task` — タスク追加（親指定）
- [x] `delete_mindmap_node` — ノード削除（ソフトデリート）

## Step 5: UI改善 ✅
- [x] マインドマップ操作の承認カード（既存action UIで対応）
- [x] 要約中スピナー + 「会話を要約しています」ログ
- [x] `onMindmapUpdated` コールバック追加

## Step 6: プロジェクト要約の再要約ロジック ✅
- [x] 再要約上書き型に変更（追記型を廃止）
- [x] `ai_context_documents` に上書き保存（フォルダ構造）
- [x] `ai_project_context` テーブルにも同期保存

## ビルド確認 ✅

---

**最終更新:** 2026-02-26
**ステータス:** 実装完了・ビルド通過
