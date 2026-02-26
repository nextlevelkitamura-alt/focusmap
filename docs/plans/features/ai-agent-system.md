---
feature: ai-agent-system
type: feature
method: impl
created: 2026-02-26
status: planning
---

# 設計プラン: AI Agent System

> 仕様書: [docs/specs/ai-agent-system.md](../../specs/ai-agent-system.md)

## 要件

- AIチャットをアプリの唯一の AI 入口に昇格
- ユーザー・プロジェクトのコンテキストをAIが記憶（インタビュー → 要約 → 保存）
- ユーザーが設定画面でAIの解釈を確認・更新できる（透明性）
- Skills システムでスケジュール/タスク追加/会話を振り分け
- メモ機能（MemoView・notes テーブル）を完全廃止

## リスク評価

| リスク | レベル |
|---|---|
| notes テーブルの既存データ消去 | LOW（テスト環境のみ） |
| コンテキスト600字上限の品質維持 | MEDIUM |
| スキル分類の精度 | MEDIUM → chat をフォールバックに |

## 依存関係

- `ai_user_context` テーブル（既存・カラム追加済み）
- `projects` テーブル（FK 先）
- `/api/ai/chat/route.ts`（改修）
- 設定画面コンポーネント（追加先）
- BottomNav（タブ変更）

---

## 実装フェーズ

### Phase 1: DB 基盤
- [ ] `supabase/migrations/YYYYMMDD_create_ai_project_context.sql` 作成
  - `ai_project_context` テーブル（user_id, project_id, purpose, current_status, key_insights）
  - RLS ポリシー追加
- [ ] `src/types/database.ts` に `ai_project_context` 型追加

### Phase 2: コンテキスト API
- [ ] `src/lib/ai/context/user-context.ts` 作成
  - `ai_user_context` から読み込み・フォーマット
- [ ] `src/lib/ai/context/project-context.ts` 作成
  - `ai_project_context` から関連プロジェクト上位2件を読み込み
- [ ] `src/app/api/ai/context/interview/route.ts` 作成（POST）
  - インタビュー会話を受け取り、AI が要約を生成して返す
- [ ] `src/app/api/ai/context/save/route.ts` 作成（POST）
  - ユーザー確認後に DB に保存（user or project 指定）

### Phase 3: 設定画面 UI（透明性）
- [ ] 設定画面に「AIコンテキスト」セクション追加
  - ユーザーコンテキスト3項目（性格・目標・状況）を表示
  - 各項目に「更新する」ボタン → インタビューチャット起動
- [ ] プロジェクトコンテキスト一覧表示
  - 登録済みプロジェクトのコンテキストを表示
  - 「+ プロジェクトを追加」→ プロジェクト選択 → インタビュー起動
- [ ] インタビューはチャットパネルを流用（`ai-chat-panel.tsx`）
  - インタビューモードフラグで通常チャットと区別

### Phase 4: Skills システム
- [ ] `src/lib/ai/skills/index.ts` 作成（型定義 + レジストリ）
- [ ] `src/lib/ai/skills/schedule.ts` 作成（カレンダー追加スキル）
- [ ] `src/lib/ai/skills/task-add.ts` 作成（マップ追加スキル）
- [ ] `src/lib/ai/skills/chat.ts` 作成（通常会話スキル）
- [ ] `src/lib/ai/router.ts` 作成（スキル分類ロジック）

### Phase 5: チャット API 統合
- [ ] `/api/ai/chat/route.ts` 改修
  - コンテキスト読み込み追加（user + project）
  - スキルルーティングプロンプトを組み込み
  - レスポンスから skill ブロックをパースしてスキル実行
- [ ] スキル別アクション実行（既存 execute ロジックを skills に移管）

### Phase 6: メモ機能廃止
- [ ] `src/components/memo/` ディレクトリ削除
- [ ] `src/app/(protected)/memo/` 削除
- [ ] BottomNav から「メモ」タブ削除 → 「AI」タブに変更（チャットパネル開閉）
- [ ] `/api/notes/` ルート削除
- [ ] `/api/ai/analyze-memo/` ルート削除
- [ ] `src/types/note.ts` 削除
- [ ] `supabase/migrations/YYYYMMDD_drop_notes_table.sql` 作成

---

## 実装対象ファイル

### 新規作成
| ファイル | 内容 |
|---|---|
| `supabase/migrations/YYYYMMDD_create_ai_project_context.sql` | ai_project_context テーブル |
| `supabase/migrations/YYYYMMDD_drop_notes_table.sql` | notes テーブル廃止 |
| `src/lib/ai/skills/index.ts` | スキル型・レジストリ |
| `src/lib/ai/skills/schedule.ts` | スケジュールスキル |
| `src/lib/ai/skills/task-add.ts` | タスク追加スキル |
| `src/lib/ai/skills/chat.ts` | 通常会話スキル |
| `src/lib/ai/router.ts` | スキルルーター |
| `src/lib/ai/context/user-context.ts` | ユーザーコンテキスト読み込み |
| `src/lib/ai/context/project-context.ts` | プロジェクトコンテキスト読み込み |
| `src/app/api/ai/context/interview/route.ts` | インタビューAPI |
| `src/app/api/ai/context/save/route.ts` | コンテキスト保存API |

### 変更
| ファイル | 変更内容 |
|---|---|
| `src/app/api/ai/chat/route.ts` | コンテキスト注入 + スキルルーティング |
| `src/types/database.ts` | ai_project_context 型追加 |
| `src/components/settings/` | AIコンテキストセクション追加 |
| `src/components/mobile/bottom-nav.tsx` | メモ→AIタブに変更 |

### 削除
| ファイル |
|---|
| `src/components/memo/` 全体 |
| `src/app/(protected)/memo/` |
| `src/app/api/notes/` |
| `src/app/api/ai/analyze-memo/` |
| `src/types/note.ts` |

---

## 推奨実装方式

→ **/impl**（Phase 1〜3 はUIとAPI構築中心、TDD不要）

Phase 5 のチャットAPI改修は既存テストがあるため要注意。
