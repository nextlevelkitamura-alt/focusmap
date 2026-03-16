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
| B | コーチ・ProjectPM 深化 | ⏳ 未着手 |
| C | コンテキスト管理UI完成 | ⏳ 未着手 |
| D | Strategist・DailyPlanner | ⏳ 未着手 |
| E | ファイル添付機能 | ⏳ 未着手 |

推奨着手順: C（並行可）→ B → D → E

## 次のタスク（ここから始めてください）

### Phase B: コーチ・ProjectPM 深化

**目標**: counseling/project-consultation の応答品質を、専用エージェントで格段に上げる

**現状の問題点**:
- counseling/project-consultation は既存スキルのまま → Orchestrator が 'coach'/'project-pm' に振るが実体は同じ
- コーチやPMらしい深い思考・専用プロンプトがない

**Step 1: coach.ts 実装**
- 新規: `src/lib/ai/agents/coach.ts`
  - `runCoach(context: AgentContext): Promise<AgentResult>` を実装
  - 4層コンテキスト（Layer4ビジョン + Layer2タスク）を組み込んだ専用プロンプト
  - counseling + brainstorm 両方に対応

**Step 2: project-pm.ts 実装**
- 新規: `src/lib/ai/agents/project-pm.ts`
  - `runProjectPM(context: AgentContext): Promise<AgentResult>` を実装
  - Layer3プロジェクト情報を深く使う専用プロンプト
  - プロジェクト状況・課題・次アクションを構造化して返す

**Step 3: chat/route.ts に分岐を追加**
- agentId='coach' のとき → `runCoach()` を呼び出す
- agentId='project-pm' のとき → `runProjectPM()` を呼び出す
- agentId='task-executor' のとき → 従来通りの処理（変更なし）

**重要な制約**:
- task-executor パスは絶対に変更しない
- 既存の6スキル（scheduling/task/memo）は今まで通り動くこと
- coach/project-pm の応答フォーマットは既存の `{ reply, action?, options? }` に合わせる

## Phase A 実装内容（参照用）

| ファイル | 役割 |
|---------|------|
| `src/lib/ai/agents/index.ts` | AgentId/AgentContext/AgentResult 型定義 |
| `src/lib/ai/agents/context-loader.ts` | loadContextForAgent() — agentId別に必要な層だけロード |
| `src/lib/ai/agents/orchestrator.ts` | orchestrate() — routeToSkill() をラップしてエージェントIDを返す |
| `src/lib/ai/providers/index.ts` | getModelForAgent() / getConfigForAgent() 追加済み |
| `src/app/api/ai/chat/route.ts` | routeToSkill() → orchestrate() に差し替え済み |

### orchestrate() の動作
```typescript
// skill → agent マッピング
scheduling/task/memo → 'task-executor'（既存処理をそのまま通す）
counseling/brainstorm → 'coach'（Phase B で専用処理に切替）
project-consultation → 'project-pm'（Phase B で専用処理に切替）
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
| - | Phase B: コーチ・ProjectPM 深化 | ⏳ 未着手 |
| - | Phase C: コンテキスト管理UI | ⏳ 未着手 |
| - | Phase D: Strategist・DailyPlanner | ⏳ 未着手 |
| - | Phase E: ファイル添付機能 | ⏳ 未着手 |

---

> **次のチャットを開いたら**: このファイルの「コピペ用プロンプト」セクションの ``` ブロックの内容を貼り付けてください。
