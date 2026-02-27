# AI基盤リニューアル — Vercel AI SDK + エージェントループ

> **ステータス**: Approved
> **作成日**: 2026-02-27
> **前提**: [ai-agent-system.md](ai-agent-system.md), [ai-context-folder-management.md](ai-context-folder-management.md)

---

## 0. 実装方針（重要）

**Vercel AI SDK（`ai` パッケージ）を導入し、Gemini 3.0 Flash をメイン基盤として使用する。**

- **自前の AIProvider 抽象レイヤーは作らない** — Vercel AI SDK がその役割を果たす
- `@google/generative-ai` 直接使用 → `ai` + `@ai-sdk/google` に移行
- エージェントループ（ツール呼び出し→結果確認→次のアクション）は `maxSteps` で実現
- OpenAI / Anthropic は将来 `@ai-sdk/openai` / `@ai-sdk/anthropic` を追加するだけ
- 既存のスキルシステム・コンテキスト構築・プロンプトは **そのまま活用**

---

## 1. 背景と課題

### 現状
- AI プロバイダーは **Google Gemini（gemini-2.5-flash）のみ**
- `@google/generative-ai` を各APIで直接使用（抽象化なし）
- **1回投げて1回返すだけ**のワンショット方式 — エージェントループなし
- ルーターはキーワード正規表現マッチ（`src/lib/ai/router.ts`）
- カレンダー追加やマインドマップ更新が「AIがJSON出力 → パース → API実行」の1ショットで不安定

### 核心的な問題
```
今: ユーザー → AI(1回) → JSON → パース → 実行（失敗してもリトライなし）
                                              ↑ ここが壊れると全部ダメ

目標: ユーザー → AI → ツール呼び出し → 結果確認 → 次のアクション → ... → 完了
                     └──── maxSteps でループ ────┘
```

### 目指す姿
壁打ちチャットするだけで、**計画書・マインドマップ・スケジュールが自動で出来上がる**体験。
まずは **Gemini 3.0 Flash + Vercel AI SDK でここまで持っていく**。

---

## 2. アーキテクチャ概要

```
┌──────────────────────────────────────────────────────┐
│                    Client (Chat UI)                    │
└──────────────────────┬───────────────────────────────┘
                       │ POST /api/ai/chat
                       ▼
┌──────────────────────────────────────────────────────┐
│              Stage 1: Intent Router                   │
│  キーワード判定 → (曖昧なら) LLM判定 (Gemini 3.0)    │
│  → skill + confidence score                           │
└──────────────────────┬───────────────────────────────┘
                       │ skill ID
                       ▼
┌──────────────────────────────────────────────────────┐
│        Vercel AI SDK: generateText()                  │
│  ┌─────────────────────────────────────────────┐     │
│  │ model: google('gemini-3.0-flash')           │     │
│  │ system: スキル固有プロンプト + コンテキスト  │     │
│  │ tools: { addTask, addCalendarEvent, ... }    │     │
│  │ maxSteps: 5  ← エージェントループ           │     │
│  └─────────────────────────────────────────────┘     │
│                                                       │
│  将来: google() → openai() / anthropic() に1行で切替  │
└──────────────────────┬───────────────────────────────┘
                       │ text + toolResults
                       ▼
┌──────────────────────────────────────────────────────┐
│              Response Handler                         │
│  テキスト応答 + ツール実行結果をクライアントに返す    │
└──────────────────────────────────────────────────────┘
```

---

## 3. Vercel AI SDK による実装

### 3.1 パッケージ構成

```
npm install ai @ai-sdk/google zod
# 将来追加（APIキー取得後）:
# npm install @ai-sdk/openai @ai-sdk/anthropic
```

| パッケージ | 料金 | 役割 |
|-----------|------|------|
| `ai` | 無料 (Apache 2.0) | SDK コア（generateText, tool, streamText） |
| `@ai-sdk/google` | 無料 (Apache 2.0) | Gemini プロバイダー |
| `zod` | 無料 (MIT) | ツールパラメータのスキーマ定義 |

### 3.2 モデル取得ヘルパー

```typescript
// src/lib/ai/providers/index.ts
import { google } from '@ai-sdk/google'

/**
 * スキルに応じたモデルを返す
 * 現在: 全て Gemini 3.0 Flash
 * 将来: スキルごとに最適なモデルを選択
 */
export function getModelForSkill(skillId?: string) {
  // 将来の切替ポイント:
  // if (process.env.OPENAI_API_KEY && skillId === 'scheduling') {
  //   return openai('gpt-4o-mini')
  // }
  // if (process.env.ANTHROPIC_API_KEY && skillId === 'brainstorm') {
  //   return anthropic('claude-sonnet-4-6')
  // }

  const modelName = process.env.GEMINI_MODEL || 'gemini-3.0-flash'
  return google(modelName, {
    apiKey: process.env.GEMINI_API_KEY,
  })
}
```

### 3.3 ツール定義（Zod スキーマ）

```typescript
// src/lib/ai/tools/index.ts
import { tool } from 'ai'
import { z } from 'zod'

export const addTask = tool({
  description: 'マインドマップにタスクを追加する',
  parameters: z.object({
    title: z.string().describe('タスクのタイトル'),
    parentTaskId: z.string().optional().describe('親タスクのID'),
    projectId: z.string().describe('プロジェクトID'),
  }),
  execute: async ({ title, parentTaskId, projectId }) => {
    // Supabase にタスクを追加
    const { data, error } = await supabase
      .from('tasks')
      .insert({ title, parent_task_id: parentTaskId, project_id: projectId })
      .select()
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, taskId: data.id, title }
  },
})

export const addCalendarEvent = tool({
  description: 'Googleカレンダーに予定を追加する',
  parameters: z.object({
    title: z.string().describe('予定のタイトル'),
    startTime: z.string().describe('開始日時 (ISO 8601)'),
    duration: z.number().describe('所要時間（分）'),
    calendarId: z.string().optional().describe('カレンダーID'),
  }),
  execute: async ({ title, startTime, duration, calendarId }) => {
    // タスク作成 → Google Calendar API 同期
    // 既存の sync-task ロジックを再利用
    return { success: true, eventTitle: title, startTime }
  },
})

export const updateMindmapNode = tool({
  description: 'マインドマップのノードを更新する',
  parameters: z.object({
    taskId: z.string().describe('更新するタスクのID'),
    title: z.string().optional().describe('新しいタイトル'),
    completed: z.boolean().optional().describe('完了フラグ'),
  }),
  execute: async ({ taskId, title, completed }) => {
    // Supabase でタスクを更新
    return { success: true, taskId }
  },
})

// スキルごとにツールセットを返す
export function getToolsForSkill(skillId: string) {
  switch (skillId) {
    case 'scheduling':
      return { addCalendarEvent }
    case 'task':
      return { addTask, updateMindmapNode }
    case 'project-consultation':
      return { addTask, addCalendarEvent, updateMindmapNode }
    case 'brainstorm':
      return { addTask, updateMindmapNode }
    default:
      return { addTask, addCalendarEvent, updateMindmapNode }
  }
}
```

### 3.4 チャット API（メインエンドポイント）

```typescript
// src/app/api/ai/chat/route.ts のリファクタイメージ
import { generateText } from 'ai'
import { getModelForSkill } from '@/lib/ai/providers'
import { getToolsForSkill } from '@/lib/ai/tools'
import { routeToSkill } from '@/lib/ai/router'
import { buildSkillPrompt } from '@/lib/ai/skills/prompts'
import { loadContextForChat } from '@/lib/ai/context'

export async function POST(request: Request) {
  const { message, skill, previousMessages, selectedProjectId } = await request.json()

  // 1. スキル判定（既存ルーター）
  const resolvedSkill = skill || routeToSkill(message)?.skill || 'counseling'

  // 2. コンテキスト構築（既存ロジックを再利用）
  const context = await loadContextForChat(userId, selectedProjectId)

  // 3. プロンプト構築（既存プロンプトを再利用）
  const systemPrompt = buildSkillPrompt(resolvedSkill, context)

  // 4. Vercel AI SDK で生成（エージェントループ付き）
  const result = await generateText({
    model: getModelForSkill(resolvedSkill),
    system: systemPrompt,
    messages: previousMessages || [],
    prompt: message,
    tools: getToolsForSkill(resolvedSkill),
    maxSteps: 5,  // ← ツール呼び出し→確認のループを最大5回
    maxTokens: 2000,
    temperature: 0.7,
  })

  // 5. レスポンス
  return Response.json({
    text: result.text,
    toolResults: result.steps.flatMap(s => s.toolResults),
    usage: result.usage,
  })
}
```

**変更前 vs 変更後:**

```
Before: GoogleGenerativeAI → generateContent → JSON文字列パース → 手動でアクション実行
After:  generateText + tools → SDK がツールを自動呼び出し → 結果を確認 → 必要なら再実行
```

---

## 4. スキル-モデル マッピング

### 4.1 現在の構成（全て Gemini 3.0 Flash）

```typescript
// src/lib/ai/providers/index.ts 内の getModelForSkill

// 現在: 全スキルで同じモデル
// 将来: コメントアウトを外すだけで切替可能

const SKILL_MODEL_CONFIG = {
  // 軽量スキル
  scheduling:             { model: 'gemini-3.0-flash', maxTokens: 800,  temperature: 0.3 },
  task:                   { model: 'gemini-3.0-flash', maxTokens: 800,  temperature: 0.3 },
  // 中量スキル
  counseling:             { model: 'gemini-3.0-flash', maxTokens: 1500, temperature: 0.7 },
  'project-consultation': { model: 'gemini-3.0-flash', maxTokens: 2000, temperature: 0.7 },
  // 重量スキル
  brainstorm:             { model: 'gemini-3.0-flash', maxTokens: 2000, temperature: 0.8 },
  research:               { model: 'gemini-3.0-flash', maxTokens: 2000, temperature: 0.5 },
} as const

// 将来の理想構成（APIキー取得後）:
// scheduling:    openai('gpt-4o-mini')
// task:          openai('gpt-4o-mini')
// counseling:    anthropic('claude-sonnet-4-6')
// brainstorm:    anthropic('claude-sonnet-4-6')
// research:      openai('gpt-4o')
```

### 4.2 コスト

#### 現在（Gemini のみ）
| プロバイダー | モデル | Input | Output | 用途 |
|------------|--------|-------|--------|------|
| Google | gemini-3.0-flash | 無料枠あり / $0.10/1M | $0.40/1M | 全スキル |

**現段階**: Gemini 無料枠内で運用 → コストほぼゼロ

#### 将来（マルチプロバイダー時）
| プロバイダー | モデル | Input | Output | 用途 |
|------------|--------|-------|--------|------|
| OpenAI | gpt-4o-mini | $0.15/1M | $0.60/1M | ルーター、軽量スキル |
| Anthropic | claude-sonnet-4-6 | $3.00/1M | $15.00/1M | 壁打ち、構造化 |

---

## 5. 2段階ルーティング（Phase 4 で実装）

### 5.1 フロー

```
ユーザーメッセージ
      │
      ▼
┌─── Stage 1a: キーワードルーター ───┐
│ routeToSkill(message)              │
│ → score ≥ 3: 確定 (high confidence)│
│ → score < 3: 次へ                  │
└──────────────┬─────────────────────┘
               │ 曖昧
               ▼
┌─── Stage 1b: LLMルーター ─────────┐
│ generateText() で意図分析          │
│ → skill + confidence (0-1)         │
│ → confidence ≥ 0.7: 確定           │
│ → confidence < 0.7: ユーザーに選択 │
└──────────────┬─────────────────────┘
               │ skill確定
               ▼
┌─── Stage 2: スキル実行 ───────────┐
│ getModelForSkill(skill)            │
│ → generateText() + tools           │
└───────────────────────────────────┘
```

### 5.2 LLMルーター実装

```typescript
// src/lib/ai/router.ts
import { generateText } from 'ai'
import { getModelForSkill } from './providers'

export async function routeMessage(message: string): Promise<RouterResult> {
  // Stage 1a: キーワード判定（既存ロジック・変更なし）
  const keywordResult = routeToSkill(message)
  if (keywordResult && keywordResult.score >= 3) {
    return { skill: keywordResult.skill, confidence: keywordResult.score / 5, source: 'keyword' }
  }

  // Stage 1b: LLMルーター
  try {
    const { text } = await generateText({
      model: getModelForSkill(),  // デフォルトモデル
      system: ROUTER_PROMPT,
      prompt: message,
      maxTokens: 100,
      temperature: 0,
    })
    const parsed = JSON.parse(text)
    return { skill: parsed.skill, confidence: parsed.confidence, source: 'llm' }
  } catch {
    return { skill: keywordResult?.skill ?? null, confidence: 0, source: 'keyword' }
  }
}
```

---

## 6. 壁打ち対話 + マインドマップ自動生成（ハイブリッド方式）

Phase 3 で実装。アーキテクチャは前回仕様と同じ。

### 6.1 Vercel AI SDK での実装イメージ

```typescript
// brainstorm スキルでは updateMindmapNode ツールが仮ノードを作成
const result = await generateText({
  model: getModelForSkill('brainstorm'),
  system: brainstormPrompt,
  messages: conversationHistory,
  tools: {
    proposeMindmapNode: tool({
      description: '壁打ちの内容からマインドマップのノードを提案する（仮ノード）',
      parameters: z.object({
        title: z.string(),
        parentTitle: z.string().optional(),
        reasoning: z.string().describe('なぜこのノードを提案したか'),
      }),
      execute: async ({ title, parentTitle, reasoning }) => {
        // 仮ノードとしてクライアントに返す（DBには保存しない）
        return { status: 'tentative', title, parentTitle, reasoning }
      },
    }),
  },
  maxSteps: 5,
})
```

---

## 7. 既存コードへの影響と移行計画

### 7.1 変更が必要なファイル

| ファイル | 変更内容 | 影響度 |
|---------|---------|--------|
| `src/app/api/ai/chat/route.ts` | `GoogleGenerativeAI` → `generateText` に変更 | **高** |
| `src/app/api/ai/chat/summarize/route.ts` | 同上 | 中 |
| `src/app/api/ai/chat/execute/route.ts` | ツール実行を SDK に統合（将来的に不要に） | **高** |
| `src/app/api/ai/scheduling/route.ts` | 同上 | 中 |
| `src/app/api/ai/analyze-memo/route.ts` | 同上 | 低 |
| `src/lib/ai/router.ts` | 既存キーワードルーターはそのまま維持 | 低 |
| `src/lib/ai/skills/prompts/*.ts` | プロンプトはそのまま再利用 | 低 |
| `src/lib/ai/context/*.ts` | コンテキスト構築はそのまま再利用 | なし |

### 7.2 新規ファイル

```
src/lib/ai/
├── providers/
│   └── index.ts          # getModelForSkill() — モデル取得ヘルパー
└── tools/
    ├── index.ts           # ツール定義 + getToolsForSkill()
    ├── task-tools.ts      # タスク関連ツール
    ├── calendar-tools.ts  # カレンダー関連ツール
    └── mindmap-tools.ts   # マインドマップ関連ツール
```

### 7.3 削除可能なファイル（将来）

移行完了後、`/api/ai/chat/execute/route.ts` は不要になる可能性あり
（ツール実行が SDK 内で自動化されるため）

### 7.4 パッケージ変更

```diff
# 追加
+ ai
+ @ai-sdk/google
+ zod  （既に入っている場合は不要）

# 将来追加（APIキー取得後）
# + @ai-sdk/openai
# + @ai-sdk/anthropic

# 既存（維持 — 他で使っている場合）
  @google/generative-ai  → AI以外で使ってなければ将来削除可能
```

### 7.5 環境変数

```env
# 既存（必須・変更なし）
GEMINI_API_KEY=xxx

# 新規追加（オプション）
GEMINI_MODEL=gemini-3.0-flash     # 使用するGeminiモデル（デフォルト: gemini-3.0-flash）

# 将来追加（設定するだけで自動有効化）
# OPENAI_API_KEY=xxx
# ANTHROPIC_API_KEY=xxx
```

---

## 8. 実装フェーズ

### Phase 1: Vercel AI SDK 導入 + Gemini 3.0 Flash 移行
**目標**: SDK を導入し、既存機能を壊さずに移行する

1. `ai` + `@ai-sdk/google` + `zod` をインストール
2. `src/lib/ai/providers/index.ts` — `getModelForSkill()` 実装
3. `src/lib/ai/tools/` — 既存アクション（add_task, add_calendar_event 等）を Zod ツールに変換
4. `src/app/api/ai/chat/route.ts` — `generateText` + `tools` + `maxSteps` に書き換え
5. 他の AI エンドポイント（summarize, scheduling）も順次移行
6. 既存動作が壊れないことを確認

**完了条件**: Gemini 3.0 Flash + エージェントループでチャットが動く

### Phase 2: 壁打ち対話の品質向上（プロンプト設計）
**目標**: Gemini 3.0 Flash で深掘り質問ができる壁打ち体験

1. `brainstorm` スキル用のプロンプトを新規作成
2. Gemini 3.0 Flash 向けプロンプト最適化
3. コンテキスト注入の強化
4. 対話サマリーの品質改善

**完了条件**: 壁打ちで3ターン以上の深掘りが自然にできる

### Phase 3: 対話→マインドマップ自動変換（ハイブリッド方式）
**目標**: 壁打ち中に仮ノード → 完了時に確定

1. `proposeMindmapNode` ツールを brainstorm スキルに追加
2. UIに仮ノード表示（破線枠 + 薄い色）
3. 「構造確定」ボタンの実装
4. 確定時のDB保存ロジック

**完了条件**: 壁打ち→マインドマップが1フローで完結する

### Phase 4: 2段階ルーティング
**目標**: ルーターの精度向上

1. LLMルーター実装（`generateText` でスキル判定）
2. キーワード → LLM のフォールバック構成
3. 新スキル（brainstorm, research）のUI追加

**完了条件**: 曖昧な発言でも適切なスキルに振り分けられる

### Phase 5: マルチプロバイダー有効化（APIキー取得後）
- `@ai-sdk/openai` / `@ai-sdk/anthropic` をインストール
- `getModelForSkill()` のコメントアウトを外す
- スキルUIパッケージ化

---

## 9. テスト戦略

### ユニットテスト
- `getModelForSkill()` のモデル解決
- 各ツールの execute 関数（モック使用）
- ルーター（キーワード + LLM）

### 統合テスト
- チャットAPI → generateText → ツール実行のE2Eフロー
- maxSteps によるリトライ動作
- フォールバック動作

---

## 10. リスクと対策

| リスク | 対策 |
|-------|------|
| APIキー漏洩 | `.env` のみ、API Route 内でのみ使用 |
| maxSteps の無限ループ | `maxSteps: 5` で上限設定。ツール内でも安全な実装 |
| SDK のバージョン変更 | `ai` パッケージのメジャーバージョンを固定 |
| 既存機能の退行 | Phase 1 で既存プロンプト・コンテキストをそのまま再利用 |
| Gemini がツール呼び出しに失敗 | テキスト応答にフォールバック。既存の JSON パース方式も一時的に併用可能 |
