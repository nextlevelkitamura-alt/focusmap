# 🔁 作業引き継ぎプロンプト — Shikumika AI統合 × ファイル添付

> **使い方**: 新しいチャットを開いたら、このファイルの内容を最初に貼り付けて「続きをお願いします」と伝えるだけ。

---

## コピペ用プロンプト（ここから↓）

```
以下は Shikumika アプリの開発作業の引き継ぎです。
docs/plans/handoff-prompt.md を読んで現在の状況を把握し、「次のタスク」から作業を再開してください。

## プロジェクト情報
- パス: /Users/kitamuranaohiro/Private/P dev/shikumika-app
- フレームワーク: Next.js 14 App Router, TypeScript, Tailwind CSS
- DB: Supabase (PostgreSQL)
- AI: Vercel AI SDK + Google Gemini 3.0 Flash
- MCP: shikumika（tasks/projects/spaces/habits/calendar/dashboard）

## このプロジェクトで今やっていること
人生管理リポジトリ（~/Private/人生管理）の「ファイル駆動型AI人生管理」の仕組みを
Shikumika のUI上で誰でも使えるようにするための AI統合強化。

大きな計画は /Users/kitamuranaohiro/.claude/plans/misty-popping-curry.md にあります。

## フェーズ構成
- Phase 1: コンテキスト充実化（ai_context_documents UI）← 着手予定
- Phase 2: Observational Memory（チャット後自動コンテキスト更新）
- Phase 3: マルチスキル拡張（今日の計画・週次振り返りスキル）
- Phase 4: 人生管理リポ ↔ Shikumika 双方向同期
- Phase 5: Claude Agent Teams 本格実装
- 番外: マインドマップへのファイル添付機能（独立機能）

## 完了済み
- [x] 計画書作成（.claude/plans/misty-popping-curry.md）
- [x] ハンドオフプロンプト作成（この文書）
- [ ] 以下から作業開始

## 次のタスク（ここから始めてください）

### 今取り組んでいるのは：マインドマップへのファイル添付機能

**背景**: ユーザーが「マインドマップのノードにドキュメント・写真を紐づけたい」と要望。
計画書・資料がすぐ迷子になる問題を解決する。

**ステップ一覧:**
1. [ ] DB移行SQL: `supabase/migrations/20260316_create_task_attachments.sql`
2. [ ] 型定義: `src/types/database.ts` に task_attachments 追加
3. [ ] APIルート: `src/app/api/tasks/[id]/attachments/route.ts`（GET/POST）
4. [ ] APIルート: `src/app/api/tasks/[id]/attachments/[attachmentId]/route.ts`（DELETE）
5. [ ] UIコンポーネント: `src/components/tasks/task-attachment-panel.tsx`
6. [ ] 組み込み: `src/components/dashboard/inline-edit-panel.tsx` に添付パネル追加
7. [ ] マインドマップ: `src/components/dashboard/mind-map.tsx` に📎バッジ追加

**設計詳細:**

```sql
-- task_attachments テーブル
id uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id uuid REFERENCES auth.users NOT NULL
task_id uuid REFERENCES tasks(id) ON DELETE CASCADE NOT NULL
file_name text NOT NULL
file_url text NOT NULL        -- Supabase Storage公開URL
storage_path text NOT NULL    -- バケット内パス（削除用）
file_type text NOT NULL       -- 'image/png', 'application/pdf' etc.
file_size integer NOT NULL    -- バイト数
created_at timestamptz DEFAULT now()
```

Supabase Storage バケット: `task-attachments`

**重要な注意点:**
- `inline-edit-panel.tsx` にはすでに `memo` フィールドがある
- タスクDBには `memo_images: string[] | null` がある（既存の画像URL配列）
  → 新しい `task_attachments` テーブルは既存の memo_images とは別管理
- Supabase Storage の RLS: user_id ベースでアクセス制御
- ファイルアップロードは Base64ではなく FormData で実装する

## 重要なコンテキスト

### アーキテクチャ方針
- ファイル駆動開発: 口頭での仕様変更禁止、必ずこのファイルを更新してから実装
- 計画→承認→実装の順: いきなりコードを書かない
- 既存コードを壊さない: 段階的に変更

### 主要ファイルの場所
| ファイル | 役割 |
|---------|------|
| `src/types/database.ts` | 全テーブルの型定義 |
| `src/components/dashboard/inline-edit-panel.tsx` | タスク詳細・編集パネル |
| `src/components/dashboard/mind-map.tsx` | マインドマップ本体 |
| `src/lib/ai/skills/` | AIスキル定義 |
| `src/lib/ai/context/` | コンテキスト管理 |
| `supabase/migrations/` | DB移行スクリプト |

### 既存のDB構成（関連するもの）
- `tasks` テーブル: memo, memo_images フィールドあり
- `ai_context_documents` テーブル: フォルダ型コンテキスト（DBは完備、UIは未完成）
- `ai_user_context` テーブル: ユーザーのペルソナ・目的・現状

### Supabase接続
- `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を使用
- サーバーサイドは `createClient()` from `@/utils/supabase/server`
- クライアントサイドは `createClient()` from `@/utils/supabase/client`
```

---

## 作業ログ（更新してから次に渡す）

| 日時 | 作業内容 | 状態 |
|------|---------|------|
| 2026-03-16 | 計画書・ハンドオフプロンプト作成 | ✅ 完了 |
| - | マインドマップ ファイル添付機能 実装 | ⏳ 未着手 |
| - | Phase 1: コンテキスト充実化UI | ⏳ 未着手 |

---

> **次のチャットを開いたら**: このファイルを「コピペ用プロンプト」セクションから最後までコピーして貼り付けてください。
