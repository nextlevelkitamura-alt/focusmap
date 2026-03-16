# 🔁 作業引き継ぎプロンプト — Shikumika AI統合 大刷新 v2.0

> **使い方**: 新しいチャットを開いたら、「コピペ用プロンプト」セクションの内容を貼り付けて「続きをお願いします」と伝えるだけ。

---

## コピペ用プロンプト（ここから↓）

```
以下は Shikumika アプリの開発作業の引き継ぎです。
docs/plans/handoff-prompt.md を読んで現在の状況を把握し、「次のタスク」から作業を再開してください。

## プロジェクト情報
- パス: /Users/kitamuranaohiro/Private/P dev/shikumika-app
- フレームワーク: Next.js 14 App Router, TypeScript, Tailwind CSS
- DB: Supabase (PostgreSQL)
- AI: Vercel AI SDK + Google Gemini 3.0 Flash（プロバイダー切替可能な設計）
- MCP: shikumika（tasks/projects/spaces/habits/calendar/dashboard）

## このプロジェクトで今やっていること
人生管理リポジトリ（~/Private/人生管理）の「ファイル駆動型AI人生管理」の仕組みを
Shikumika の UI上で誰でも使えるようにするための AI統合大刷新。

**大きな計画書（必読）**: /Users/kitamuranaohiro/.claude/plans/wise-plotting-harbor.md
前の計画書（参照のみ）: /Users/kitamuranaohiro/.claude/plans/misty-popping-curry.md

## 新アーキテクチャの核心

### 4層コンテキスト（DBスキーマ変更なし）
- Layer 4 ビジョン層: document_type='purpose'/'personality'（月1更新）
- Layer 3 プロジェクト層: document_type='project_purpose'/'project_insights'（週1更新）
- Layer 2 タスク層: document_type='situation'/'project_status'（毎日更新）
- Layer 1 セッション層: チャット履歴・ai_suggestions（リアルタイム）

### エージェントチーム（実装済み・Phase A）
src/lib/ai/agents/ に以下が実装済み:
- `index.ts`          ✅ AgentId/AgentContext/AgentResult 型定義
- `context-loader.ts` ✅ 4層コンテキストローダー（loadContextForAgent）
- `orchestrator.ts`   ✅ 指揮官（既存 router.ts を内包・後方互換）

Phase B 以降で追加予定:
- `coach.ts`          ← コーチ（counseling + brainstorm の発展形）
- `project-pm.ts`     ← ProjectPM（project-consultation の発展形）
- `daily-planner.ts`  ← デイリープランナー
- `strategist.ts`     ← 企画エージェント（全PJ横断）
- `memory-guardian.ts`← コンテキスト自動更新

### プロバイダー抽象化（重要設計方針）
- 全エージェントは Vercel AI SDK 経由で動作
- デフォルト: Gemini 3.0 Flash（コスト最安）
- 環境変数 ANTHROPIC_API_KEY を追加するだけで Claude に切替可能
- providers/index.ts の AGENT_MODEL_MAP テーブルを1行変えるだけで全体に反映

## フェーズ構成

| Phase | タイトル | 状態 |
|-------|---------|------|
| A | エージェント基盤（後方互換） | ✅ 完了 |
| B | コーチ・ProjectPM 深化 | ✅ 完了 |
| C | コンテキスト管理UI完成 | ⏳ 未着手 |
| D | Strategist・DailyPlanner | ⏳ 未着手 |
| E | ファイル添付機能 | ⏳ 未着手 |

推奨着手順: C（並行可）→ B → D → E

## 次のタスク（ここから始めてください）

### Phase C: コンテキスト管理UI完成

**目標**: ユーザーが4層コンテキスト（ビジョン・プロジェクト・状況）を手動で閲覧・編集・作成できるUIを完成させる

**現状**:
- DB テーブル（`ai_context_folders` / `ai_context_documents`）は稼働済み
- コンテキスト読み込み（`loadContextFromDocuments`）は稼働済み
- UI は未整備 or 部分的（要調査）

**調査ポイント（着手前に確認）**:
1. `src/app/` 配下にコンテキスト管理ページが既にあるか確認
2. `src/components/` 配下にコンテキスト関連コンポーネントがあるか確認
3. 既存UIがあれば改善、なければ新規作成

**実装内容（想定）**:

**Step 1: コンテキスト一覧ページ**
- `/ai-context` または `/settings/context` にページを作成
- フォルダツリー（root_personal / root_projects / project別）を表示
- ドキュメント一覧（タイトル・種別・最終更新日）を表示

**Step 2: ドキュメント編集UI**
- ドキュメントをクリックで編集モードに入れる
- `document_type` に応じたラベル表示（「性格・スタイル」「目標・ビジョン」「現在の状況」等）
- 保存 / 鮮度更新（`freshness_reviewed_at` 更新）ボタン

**Step 3: 新規ドキュメント作成**
- フォルダ配下に新しいドキュメントを追加できる
- プロジェクトフォルダへの追加（`project_purpose` / `project_insights` 等）

**重要な制約**:
- 既存の `ai_context_documents` / `ai_context_folders` テーブル構造を変更しない
- `loadContextFromDocuments()` の返却形式を変更しない（AI側に影響するため）

## Phase A・B 実装内容（参照用）

| ファイル | 役割 |
|---------|------|
| `src/lib/ai/agents/index.ts` | AgentId/AgentContext/AgentResult 型定義 |
| `src/lib/ai/agents/context-loader.ts` | loadContextForAgent() — agentId別に必要な層だけロード |
| `src/lib/ai/agents/orchestrator.ts` | orchestrate() — routeToSkill() をラップしてエージェントIDを返す |
| `src/lib/ai/agents/coach.ts` | **[Phase B]** buildCoachSystemPrompt() — Layer4+Layer2を使ったコーチ専用プロンプト |
| `src/lib/ai/agents/project-pm.ts` | **[Phase B]** buildProjectPMSystemPrompt() — Layer3+Layer2を使ったPM専用プロンプト |
| `src/lib/ai/providers/index.ts` | getModelForAgent() / getConfigForAgent() 追加済み |
| `src/app/api/ai/chat/route.ts` | orchestrate() 統合済み・agentId='coach'/'project-pm' 時に専用プロンプト使用 |

### orchestrate() の動作
```typescript
// skill → agent マッピング
scheduling/task/memo → 'task-executor'（既存処理をそのまま通す）
counseling/brainstorm → 'coach'（buildCoachSystemPrompt で専用プロンプト）
project-consultation → 'project-pm'（buildProjectPMSystemPrompt で専用プロンプト）
スコア不足 → 'orchestrator'（スキルセレクタ表示）
```

## 重要なコンテキスト

### 主要ファイルの場所

| ファイル | 役割 |
|---------|------|
| `src/lib/ai/agents/index.ts` | 型定義（AgentId/AgentContext/AgentResult） |
| `src/lib/ai/agents/orchestrator.ts` | エージェント指揮官 |
| `src/lib/ai/agents/context-loader.ts` | 4層コンテキストローダー |
| `src/lib/ai/router.ts` | 既存スキルルーター（orchestratorが内包） |
| `src/lib/ai/skills/index.ts` | 6スキル定義 |
| `src/lib/ai/providers/index.ts` | Gemini接続・getModelForAgent() |
| `src/lib/ai/context/document-context.ts` | コンテキスト読み込み（4層ローダーがラップ） |
| `src/app/api/ai/chat/route.ts` | メインチャットAPI |
| `src/types/database.ts` | 全テーブル型定義 |

### 既存のDB構成（変更なし）
- `ai_context_folders`: フォルダツリー（folder_type: root_personal/root_projects/project/custom）
- `ai_context_documents`: ドキュメント（document_type: personality/purpose/situation/project_purpose/project_status/project_insights/note）
- `ai_project_context`: プロジェクト別コンテキスト（purpose/current_status/key_insights）
- `ai_user_context`: 旧コンテキスト（フォールバック用）

### Supabase接続
- サーバーサイド: `createClient()` from `@/utils/supabase/server`
- クライアントサイド: `createClient()` from `@/utils/supabase/client`

### chat/route.ts のレスポンス形式（変更禁止）
```typescript
// 全エージェント共通の返却形式（既存UIが依存）
{
  reply: string        // ユーザーへの表示テキスト
  action?: object      // UIアクション（タスク追加・カレンダー登録など）
  options?: string[]   // 次の選択肢
  skillId?: string     // 選択されたスキルID
}
```
```

---

## 作業ログ（更新してから次に渡す）

| 日時 | 作業内容 | 状態 |
|------|---------|------|
| 2026-03-16 | 大刷新計画書（wise-plotting-harbor.md）策定 | ✅ 完了 |
| 2026-03-16 | ハンドオフプロンプト v2.0 更新 | ✅ 完了 |
| 2026-03-16 | Phase A: エージェント基盤整備（agents/配下3ファイル新規 + providers/route修正） | ✅ 完了 |
| 2026-03-16 | Phase B: コーチ・ProjectPM 深化（coach.ts / project-pm.ts 新規作成 + route.ts 分岐追加） | ✅ 完了 |
| 2026-03-16 | TypeScript エラー一括修正（6ファイル・テストファイル除き0エラー達成） | ✅ 完了 |
| - | Phase C: コンテキスト管理UI | ⏳ 未着手 |
| - | Phase D: Strategist・DailyPlanner | ⏳ 未着手 |
| - | Phase E: ファイル添付機能 | ⏳ 未着手 |

---

> **次のチャットを開いたら**: このファイルの「コピペ用プロンプト」セクションの ``` ブロックの内容を貼り付けてください。
