# AI Agent System 仕様書

> AIチャットを唯一の入口とし、ユーザー・プロジェクトのコンテキストを記憶してスキルで処理を振り分けるエージェントシステム

---

## 背景・方針転換

| 旧アーキテクチャ | 新アーキテクチャ |
|---|---|
| メモ画面 → AI分析 → マップ/カレンダー | AIチャット → スキルルーティング → マップ/カレンダー |
| メモという概念がある | 「AIに話しかける」= メモ |
| AI がその都度ユーザーを知らない | AI が常にユーザーとプロジェクトを知っている |

**廃止**: MemoView、notes テーブル（UI・DB ともに削除）

---

## 全体アーキテクチャ

```
┌─────────────────────────────────────────────┐
│           AI の記憶（コンパクト保存）         │
├──────────────────────┬──────────────────────┤
│  ユーザーコンテキスト  │ プロジェクトコンテキスト│
│  (ai_user_context)   │ (ai_project_context) │
│  ・性格・ライフスタイル│ ・プロジェクトの目的   │
│  ・人生の目標・価値観  │ ・現状・進捗           │
│  ・今の状況・悩み     │ ・重要な決定事項        │
│  ↑ インタビュー収集   │ ↑ インタビュー収集     │
│  ↑ AI が200字以内に要約│ ↑ AI が200字以内に要約 │
└──────────────────────┴──────────────────────┘
                     ↓ 合計600字以内でシステムプロンプトに注入
              AIチャット（唯一の入口）
              テキスト / 音声で話しかけるだけ
                     ↓ 意図を判定
        ┌────────────┬────────────┬────────────┐
        │  schedule  │  task-add  │    chat    │
        │ カレンダー  │ マップ追加  │  通常会話   │
        └────────────┴────────────┴────────────┘
```

---

## 1. コンテキスト設計

### 1-1. ユーザーコンテキスト（既存テーブルを活用）

テーブル: `ai_user_context`（カラム追加済み）

| カラム | 型 | 内容 | 上限 |
|---|---|---|---|
| `life_personality` | TEXT | 性格・ライフスタイルの要約 | 200字 |
| `life_purpose` | TEXT | 人生の目標・価値観の要約 | 200字 |
| `current_situation` | TEXT | 現在の状況・悩みの要約 | 200字 |

### 1-2. プロジェクトコンテキスト（新規テーブル）

テーブル: `ai_project_context`

```sql
CREATE TABLE ai_project_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT '',        -- プロジェクトの目的（200字以内）
  current_status TEXT NOT NULL DEFAULT '', -- 現状・進捗（200字以内）
  key_insights TEXT NOT NULL DEFAULT '',   -- 重要な決定・洞察（200字以内）
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, project_id)
);
```

### 1-3. コンテキスト注入ルール

```
システムプロンプトへの注入（合計600字以内）:

## あなたについて
性格: {life_personality}
目標: {life_purpose}
現状: {current_situation}

## 関連プロジェクト
{project_name}: {purpose} / 現状: {current_status}
（関連しそうなプロジェクト上位2件のみ注入）
```

---

## 2. コンテキストインタビュー

### フロー

```
ユーザーが「更新する」ボタンをタップ
    ↓
AI が質問を3〜5つ順番に聞く（チャット形式）
    ↓
ユーザーが答える
    ↓
AI が200字以内に要約して提示
「このように理解しました。保存しますか？」
    ↓
確認 → DB に保存 → 設定画面に表示
```

### ユーザーコンテキスト インタビュー質問例

```
性格・スタイル:
  「どんな働き方・生活スタイルをしていますか？」
  「自分の強みや特徴を一言で言うと？」

人生の目標:
  「5年後どうなっていたいですか？」
  「最も大切にしている価値観は？」

今の状況:
  「今一番取り組んでいることは？」
  「最近の悩みや課題は？」
```

### プロジェクトコンテキスト インタビュー質問例

```
「{project_name} はどんな目的のプロジェクトですか？」
「誰のどんな課題を解決しますか？」
「今どのフェーズ・状態ですか？」
「直近の重要な決定や方向性は？」
```

---

## 3. Skills システム

### ファイル構成

```
src/lib/ai/
├── skills/
│   ├── index.ts           # スキル定義・レジストリ
│   ├── schedule.ts        # カレンダー追加スキル
│   ├── task-add.ts        # マップへのタスク追加スキル
│   └── chat.ts            # 通常会話スキル
├── context/
│   ├── user-context.ts    # ai_user_context 読み込み
│   └── project-context.ts # ai_project_context 読み込み
└── router.ts              # 意図検出 → スキル選択
```

### スキル定義

```typescript
// src/lib/ai/skills/index.ts

export type SkillName = 'schedule' | 'task-add' | 'chat'

export interface Skill {
  name: SkillName
  description: string
  systemPrompt: string               // スキル固有の指示
  triggerKeywords: string[]          // ルーター用のキーワードヒント
}
```

### 各スキルの責務

| スキル | トリガー例 | アクション |
|---|---|---|
| `schedule` | 「来週〜入れて」「予定を追加」「〜にスケジュール」 | Google カレンダーにイベント追加 |
| `task-add` | 「マップに追加」「タスクにして」「アイデアがある」 | 適切なプロジェクトのマップノードに追加 |
| `chat` | 「どう思う？」「〜って何？」「アドバイスして」 | テキスト返答のみ |

### ルーティング

```typescript
// src/lib/ai/router.ts
// AIに意図を分類させる（追加のAPIコール不要）

// system prompt に含める:
const ROUTING_PROMPT = `
ユーザーの意図を以下から判定し、応答の最初に \`\`\`skill で指定:
- schedule: カレンダー/予定の追加
- task-add: マップ/タスクへの追加
- chat: その他の会話

\`\`\`skill
{"skill": "schedule"}
\`\`\`
`
```

---

## 4. 透明性UI（設定画面）

### 設計

```
設定 > AIコンテキスト

┌─────────────────────────────────────────┐
│ 🤖 AIが見ているあなた                    │
├─────────────────────────────────────────┤
│ 性格・スタイル                           │
│ 「行動力が高いフリーランサー。複数...」  │
│                              [更新する] │
├─────────────────────────────────────────┤
│ 人生の目標                               │
│ 「自社プロダクトでの独立を目指す...」    │
│                              [更新する] │
├─────────────────────────────────────────┤
│ 今の状況                                 │
│ 「アプリ開発中。スケジュール管理が...」  │
│                              [更新する] │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 📂 プロジェクトのコンテキスト            │
├─────────────────────────────────────────┤
│ Shikumika App                           │
│ 「プロダクティビティアプリ。マインド...」 │
│                              [更新する] │
├─────────────────────────────────────────┤
│ [+ プロジェクトを選んで追加]             │
└─────────────────────────────────────────┘
```

### 操作ルール

| 操作 | 動作 |
|---|---|
| [更新する] タップ | チャットパネルでインタビュー開始 |
| インタビュー完了 | AI が要約を提示 → 「保存」で確定 |
| 設定画面を開く | 最新の要約を表示（空なら「まだ設定されていません」） |
| プロジェクト追加 | 既存プロジェクト一覧から選択 → インタビュー開始 |

---

## 5. メモ機能廃止

### 廃止対象

| 対象 | 対応 |
|---|---|
| `src/components/memo/` ディレクトリ | 削除 |
| `src/app/(protected)/memo/` | 削除 |
| BottomNav の「メモ」タブ | 削除 |
| `notes` テーブル | マイグレーションで DROP（既存データ消去） |
| `/api/notes/` ルート | 削除 |
| `/api/ai/analyze-memo/` ルート | 削除 |
| `src/types/note.ts` | 削除 |

### BottomNav の変更

```
旧: ホーム / マップ / メモ / 習慣 / 設定
新: ホーム / マップ / AI    / 習慣 / 設定
         （AIチャットを中央タブに昇格）
```

---

## 6. チャットAPI 改修

### 変更点

```typescript
// /api/ai/chat/route.ts

// 1. コンテキスト読み込み追加
const userCtx = await loadUserContext(userId)
const projectCtx = await loadRelevantProjectContexts(userId, userMessage)

// 2. スキルルーティング込みのプロンプト
const systemPrompt = buildSystemPrompt(userCtx, projectCtx, ROUTING_PROMPT)

// 3. レスポンスからスキル抽出
const skill = parseSkill(responseText)  // skill ブロックをパース
```

---

## 7. 実装フェーズ

| フェーズ | 内容 | 規模 |
|---|---|---|
| Phase 1 | DB 基盤（ai_project_context テーブル） | 小 |
| Phase 2 | コンテキストインタビュー API + 要約保存 | 中 |
| Phase 3 | 設定画面にコンテキスト表示・更新UI | 中 |
| Phase 4 | Skills ファイル構成 + ルーター実装 | 中 |
| Phase 5 | チャット API へのコンテキスト注入 + スキル実行 | 中 |
| Phase 6 | メモ機能廃止（UI削除・DB廃止・BottomNav変更） | 小 |

---

## リスクと対策

| リスク | レベル | 対策 |
|---|---|---|
| notes テーブルに既存データがある | LOW | DROP 前に確認・警告 |
| コンテキスト注入でトークン増加 | MEDIUM | 600字上限を厳守、要約品質管理 |
| スキル分類の精度 | MEDIUM | chat をデフォルトフォールバックに |
| インタビューが長くなる | LOW | 質問数を最大5問に制限 |

---

## 更新履歴

- 2026-02-26: 初版作成（メモ廃止・AI Agent・Skills・コンテキスト透明性）
