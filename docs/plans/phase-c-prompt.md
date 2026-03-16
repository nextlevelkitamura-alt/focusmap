# Phase C: コンテキスト管理UI — 新チャット用コピペプロンプト

---

## コピペ用プロンプト（ここから↓）

```
以下は Shikumika アプリの AI統合大刷新 Phase C の作業開始プロンプトです。

## プロジェクト情報
- パス: /Users/kitamuranaohiro/Private/P dev/shikumika-app
- フレームワーク: Next.js 14 App Router, TypeScript, Tailwind CSS
- DB: Supabase (PostgreSQL)
- AI: Vercel AI SDK + Google Gemini 3.0 Flash

## これまでの完了作業
- Phase A: エージェント基盤整備（src/lib/ai/agents/ 配下）
- Phase B: コーチ・ProjectPM 専用プロンプト実装
- TypeScript エラー一括修正（6ファイル、テストファイル除き0エラー）

詳細は docs/plans/handoff-prompt.md を参照。

---

## Phase C: コンテキスト管理UI

### 目標
ユーザーが AI に渡している「自分情報（4層コンテキスト）」を手動で閲覧・編集できるUIを作る。
現在は DB にデータが入っているが、画面から確認・編集する手段がない。

### 既存のDB構成（変更禁止）
- `ai_context_folders` テーブル
  - folder_type: 'root_personal' | 'root_projects' | 'project' | 'custom'
  - user_id, title, order_index, project_id（プロジェクトフォルダの場合）

- `ai_context_documents` テーブル
  - folder_id, user_id, title, content, document_type, is_pinned
  - content_updated_at, freshness_reviewed_at, order_index
  - document_type: 'personality' | 'purpose' | 'situation' | 'project_purpose' | 'project_status' | 'project_insights' | 'note'

- `ai_project_context` テーブル（旧形式、参照のみ）

### 既存コード（変更禁止）
- `src/lib/ai/context/document-context.ts` — loadContextFromDocuments() の返却形式を変えない
- `src/lib/ai/agents/` 配下のエージェントファイル

### 実装スコープ（優先順位順）

#### 優先1: コンテキスト閲覧・編集ページ
場所: `/context` または `/settings/context`（既存ルーティングを確認してから決定）

**フォルダツリー表示**
- root_personal フォルダ → 個人ドキュメント一覧
- root_projects フォルダ → プロジェクト別ドキュメント一覧
- 各ドキュメントをクリック → インライン編集（テキストエリア）

**ドキュメント種別の日本語ラベル**
| document_type | 表示名 |
|--------------|--------|
| personality | 性格・生活スタイル |
| purpose | 目標・ビジョン |
| situation | 現在の状況 |
| project_purpose | プロジェクトの目的 |
| project_status | 進捗状況 |
| project_insights | 重要な気づき |
| note | メモ |

**保存操作**
- テキストエリア編集 → 保存ボタン → PATCH /api/ai/context/documents/[id]
- 「鮮度を確認した」ボタン → freshness_reviewed_at を更新

#### 優先2: 新規ドキュメント作成
- フォルダ内に「+ 追加」ボタン
- document_type をドロップダウンで選択して作成

#### 優先3: コンテキストのフレッシュネス警告
- content_updated_at が 30日以上前 → 「更新をおすすめします」バッジ
- freshness.ts の buildFreshnessAlertForPrompt() ロジックを参考に

### APIエンドポイント（要確認・なければ新規作成）
- GET    /api/ai/context/folders   — フォルダ一覧取得
- GET    /api/ai/context/documents — ドキュメント一覧取得（folder_id 絞り込み）
- PATCH  /api/ai/context/documents/[id] — ドキュメント更新（content, freshness_reviewed_at）
- POST   /api/ai/context/documents — ドキュメント新規作成

### Supabase 接続
- サーバーサイド: createClient() from '@/utils/supabase/server'
- クライアントサイド: createClient() from '@/utils/supabase/client'

### 着手手順（推奨）
1. まず `src/app/` 配下に既存のコンテキスト管理ページがないか確認
2. 既存の `/api/ai/context/` エンドポイントがあるか確認
3. 既存資産を活かしつつ不足部分を追加実装

### 重要な制約
- `loadContextFromDocuments()` の返却形式・動作を変えない（AI応答に影響するため）
- DB スキーマ変更なし
- 既存の `/api/ai/chat/route.ts` には一切触れない

---

docs/plans/handoff-prompt.md を読むと全体像が把握できます。
/map または /plan でこのフェーズの実装を開始してください。
```

---

## 作成日
2026-03-16

## 使い方
新しいチャットを開いて、上記の ``` ブロックの内容を貼り付けてください。
