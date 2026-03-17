# 引き継ぎプロンプト — Ideal Self（理想像）機能 Phase 1完了

> **使い方**: 新しいチャットを開いて、「コピペ用プロンプト」セクションの内容を貼り付ける。

---

## コピペ用プロンプト（ここから↓）

```
以下は Shikumika アプリの「Ideal Self（理想像）」機能開発の引き継ぎです。

## プロジェクト情報
- パス: /Users/kitamuranaohiro/Private/P dev/shikumika-app
- フレームワーク: Next.js 14 App Router, TypeScript, Tailwind CSS
- DB: Supabase (PostgreSQL) — project-ref: whsjsscgmkkkzgcwxjko
- Supabase Access Token: sbp_153e6bbaf018843eafeb2f8dea524378da7761ec
- マイグレーション方法: Management API経由（docs/SUPABASE_CLI.md 参照）

## 機能コンセプト
「Ideal Self（理想像）」= なりたい自分を1〜3件に絞り、
ビジュアル画像・費用・日々の行動（時間負荷付き）を紐付けて管理するビジョンボード機能。
計画書: ~/.claude/plans/cheeky-skipping-oasis.md

---

## Phase 1 完了済み（実装済み）

### DB
- テーブル: ideal_goals / ideal_items / ideal_attachments（Supabaseに適用済み）
- Storageバケット: ideal-attachments（作成済み・RLS設定済み）
- マイグレーションファイル: supabase/migrations/20260316_create_ideal_goals.sql

### 型定義
- src/types/database.ts に IdealGoal / IdealItem / IdealAttachment / calcDailyMinutes 追加済み

### ナビゲーション
- ダッシュボードタブに「理想（⭐）」追加済み（デスクトップヘッダー + モバイルボトムナビ）
- ViewContext の DashboardView に 'ideal' 追加済み

### API（実装済み）
- GET/POST /api/ideals/
- GET/PATCH/DELETE /api/ideals/[id]/
- POST/DELETE /api/ideals/[id]/cover/
- GET/POST /api/ideals/[id]/items/
- PATCH/DELETE /api/ideals/[id]/items/[itemId]/

### UIコンポーネント（実装済み）
- src/components/ideal/
  - ideal-view.tsx          — メインビュー
  - capacity-bar.tsx        — 1日の時間バジェットバー
  - ideal-board.tsx         — 3枚グリッドボード
  - ideal-card.tsx          — ビジョンカード（縦長3/4）
  - ideal-card-empty.tsx    — 空スロット
  - ideal-edit-dialog.tsx   — 作成・編集ダイアログ
  - ideal-cover-upload.tsx  — カバー画像アップロード
  - ideal-items-panel.tsx   — アイテム管理パネル

---

## 次に実装してほしいこと（Phase 2〜）

### Phase 2: キャパシティバーの改善 + アイテム完了プログレス
- capacity-bar でユーザーが「1日のキャパ（分）」を設定できるようにする
  → 既存 ai_user_context.preferences の daily_capacity_minutes を使う
- ideal-card のプログレスバーをクリックでアイテムパネルが開くよう改善

### Phase 3: AI壁打ち（ideal-coach）エージェント統合
- src/lib/ai/agents/ideal-coach.ts を新規作成
- src/lib/ai/skills/index.ts に 'ideal-coach' スキル追加
- src/lib/ai/router.ts にキーワードルール追加
- src/app/api/ai/chat/route.ts に ideal-coach 分岐追加
- src/components/ideal/ideal-chat-panel.tsx を作成

### Phase 4: 既存タスク/ハビットとのリンク
- src/components/ideal/ideal-item-link-picker.tsx を作成
- アイテムから既存タスク・ハビットに linked_task_id / linked_habit_id で紐付け

---

## 重要な制約
- loadContextFromDocuments() の返却形式は変更しない
- /api/ai/chat/route.ts には ideal-coach 分岐の追加のみ（既存ロジックは触れない）
- 既存テーブルスキーマは変更しない

## Supabase マイグレーション手順（今後）
新しいマイグレーションが必要なときは以下で適用:
```bash
python3 -c "
import json
sql = open('supabase/migrations/<ファイル名>.sql').read()
print(json.dumps({'query': sql}))
" > /tmp/migration.json && curl -s -X POST \
  "https://api.supabase.com/v1/projects/whsjsscgmkkkzgcwxjko/database/query" \
  -H "Authorization: Bearer sbp_153e6bbaf018843eafeb2f8dea524378da7761ec" \
  -H "Content-Type: application/json" \
  -d @/tmp/migration.json
```
（詳細: docs/SUPABASE_CLI.md）

/map または /plan [phase名] で続きを開始してください。
```

---

## 作成日
2026-03-16

## 前の計画書
- 計画書: ~/.claude/plans/cheeky-skipping-oasis.md
- 前フェーズの引き継ぎ: docs/plans/handoff-prompt.md（AI統合計画）
