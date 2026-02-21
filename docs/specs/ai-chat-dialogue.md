# AIチャット型対話 仕様書

> メモ機能 Phase 5: フローティングパネルでAIと対話し、タスク追加・予定登録・メモ整理を行う

## 概要

画面右下のフローティングアイコンからAIチャットパネルを展開。
自然言語で「これをマップに追加して」「来週の火曜に予定入れて」と指示するだけで、AIが操作を実行する。

## UI仕様

### フローティングアイコン
- 位置: 画面右下（FABの左隣、またはFAB非表示時は右下固定）
- デザイン: Sparkles アイコン + バッジ（未読応答時）
- タップ: パネル展開/折りたたみ

### チャットパネル
- 位置: 画面右下からスライドアップ
- サイズ: モバイル → 画面下半分（50vh）/ PC → 400x500px固定
- 構成:
  - ヘッダー: 「AIアシスタント」 + 閉じるボタン + リセットボタン
  - メッセージエリア: スクロール可能、最新メッセージにオートスクロール
  - 入力エリア: テキスト入力 + 送信ボタン + 音声入力ボタン

### メッセージ表示

| 種類 | デザイン |
|------|---------|
| ユーザー | 右寄せ、プライマリカラー背景 |
| AI応答 | 左寄せ、グレー背景 |
| アクション実行結果 | 左寄せ、グリーン/レッドのステータスバッジ付き |
| アクション確認 | 左寄せ + 「実行」「キャンセル」ボタン |

### アクション確認フロー
```
ユーザー: 「来週火曜に企画会議入れて」
AI: 「カレンダーに追加します:
      📅 企画会議
      🕐 2026-02-24 (火) 10:00-11:00
      📋 カレンダー: 仕事用
      [実行] [修正] [キャンセル]」
ユーザー: [実行] をタップ
AI: 「✅ カレンダーに追加しました」
```

## 操作ルール

| 操作 | トリガー例 | 実行方法 |
|------|-----------|---------|
| マップにタスク追加 | 「マップに追加して」「タスクにして」 | POST /api/tasks |
| カレンダーに予定追加 | 「予定に入れて」「カレンダーに追加」 | POST /api/tasks + カレンダー同期 |
| メモのプロジェクト紐付け | 「このメモを○○に紐付けて」 | PATCH /api/notes |
| メモの編集 | 「このメモを書き換えて」 | PATCH /api/notes |
| メモのアーカイブ | 「このメモは処理済みにして」 | PATCH /api/notes (status: archived) |
| タスクの優先度変更 | 「優先度を高にして」 | PATCH /api/tasks/[id] |
| タスクの締切設定 | 「締切を金曜にして」 | PATCH /api/tasks/[id] |

### 制約
- **破壊的操作（削除）はAIから実行不可** → 「削除はメモ画面から行ってください」と案内
- 実行前に必ず確認UIを表示（ワンタップ実行は禁止）
- 複数アクションの連続実行は1つずつ確認

## 会話管理

### セッション中
- **最大7ラリー**（ユーザー発言 + AI応答 = 1ラリー）
- 7ラリー到達時: 「会話が長くなりました。リセットしますか？」と提案
- state管理: `useState` でメッセージ配列を保持

### セッション要約
- セッション終了時（パネルを閉じた時 or 7ラリー到達時）:
  - Gemini に会話内容を渡し、100文字以内の要約を生成
  - DB に保存（最新5セッション分のみ保持）
- 新セッション開始時:
  - 直近5セッション分の要約をプロンプトに含める
  - 「前回は○○について話しましたね」のような文脈を維持

### コスト管理
- 1ラリーあたりのトークン上限: プロンプト ~2000トークン + 応答 ~500トークン
- 要約生成: ~200トークン/回
- Gemini 2.5 Flash 無料枠内で運用可能

## DBスキーマ

### ai_chat_summaries テーブル（新規）
```sql
CREATE TABLE ai_chat_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,  -- 100文字以内の要約
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chat_summaries_user ON ai_chat_summaries(user_id, created_at DESC);

-- RLS
ALTER TABLE ai_chat_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own summaries" ON ai_chat_summaries
  FOR ALL USING (auth.uid() = user_id);
```

## APIエンドポイント

### POST /api/ai/chat
```typescript
// Request
{
  message: string,          // ユーザーの発言
  history: ChatMessage[],   // 現セッションの会話履歴（最大7ラリー）
  context?: {
    activeNoteId?: string,  // 選択中のメモ
    activeProjectId?: string
  }
}

// Response
{
  reply: string,            // AIの応答テキスト
  action?: {                // 実行するアクション（確認待ち）
    type: 'add_task' | 'add_calendar' | 'edit_memo' | 'link_project' | 'archive_memo' | 'update_priority' | 'set_deadline',
    params: Record<string, unknown>,
    description: string     // 確認用の説明文
  }
}
```

### POST /api/ai/chat/execute
```typescript
// Request（確認後に実行）
{
  action: {
    type: string,
    params: Record<string, unknown>
  }
}

// Response
{
  success: boolean,
  message: string
}
```

### POST /api/ai/chat/summarize
```typescript
// Request（セッション終了時に呼ぶ）
{
  history: ChatMessage[]
}

// Response
{
  summary: string  // 100文字以内
}
```

## AIプロンプト設計

### システムプロンプト
```
あなたは「しかみか」のAIアシスタントです。
ユーザーのメモを整理し、タスクや予定の管理を手伝います。

## できること
1. マインドマップにタスクを追加
2. カレンダーに予定を追加
3. メモの編集・プロジェクト紐付け・アーカイブ
4. タスクの優先度変更・締切設定

## ルール
- 実行前に必ず内容を確認表示する
- 削除操作は案内のみ（実行不可）
- 曖昧な指示は質問して明確にする
- 簡潔に応答する（3文以内）

## コンテキスト
ユーザーのプロジェクト一覧:
{projects_with_tasks}

過去の会話要約:
{session_summaries}
```

### Function Calling（Gemini）
```json
[
  {
    "name": "add_task",
    "description": "マインドマップにタスクを追加",
    "parameters": {
      "title": "string",
      "project_id": "string?",
      "parent_task_id": "string?"
    }
  },
  {
    "name": "add_calendar_event",
    "description": "カレンダーに予定を追加",
    "parameters": {
      "title": "string",
      "scheduled_at": "string (ISO8601)",
      "estimated_time": "number (minutes)",
      "calendar_id": "string?"
    }
  },
  {
    "name": "edit_memo",
    "description": "メモの内容を編集",
    "parameters": {
      "note_id": "string",
      "content": "string"
    }
  },
  {
    "name": "link_project",
    "description": "メモにプロジェクトを紐付け",
    "parameters": {
      "note_id": "string",
      "project_id": "string"
    }
  },
  {
    "name": "archive_memo",
    "description": "メモを処理済みにする",
    "parameters": {
      "note_id": "string"
    }
  },
  {
    "name": "update_priority",
    "description": "タスクの優先度を変更",
    "parameters": {
      "task_id": "string",
      "priority": "number (1-4)"
    }
  },
  {
    "name": "set_deadline",
    "description": "タスクに締切を設定",
    "parameters": {
      "task_id": "string",
      "scheduled_at": "string (ISO8601)",
      "estimated_time": "number (minutes)"
    }
  }
]
```

## 実装フェーズ

### Phase 5a: チャットUI + 基本対話（3-4ステップ）
1. フローティングアイコン + パネルUI
2. `/api/ai/chat` エンドポイント（プロンプト設計）
3. メッセージ表示 + 入力 + 7ラリー制限
4. 音声入力統合（既存の useVoiceRecorder 活用）

### Phase 5b: アクション実行（4-5ステップ）
1. Gemini Function Calling 設定
2. `/api/ai/chat/execute` エンドポイント
3. アクション確認UI（実行/修正/キャンセル）
4. マップ追加・カレンダー追加の実行ロジック
5. メモ編集・紐付け・アーカイブの実行ロジック

### Phase 5c: セッション管理（2-3ステップ）
1. `ai_chat_summaries` テーブル作成
2. `/api/ai/chat/summarize` エンドポイント
3. セッション開始時の要約読み込み + プロンプト注入

## エッジケース

| ケース | 対応 |
|--------|------|
| AIが存在しないプロジェクトを提案 | 「プロジェクトが見つかりません。作成しますか？」 |
| 日時が曖昧（「来週」「今度」） | 「いつ頃ですか？」と質問 |
| 7ラリー超過 | 自動要約 + リセット提案 |
| API エラー | 「エラーが発生しました。もう一度お試しください」 |
| オフライン時 | パネル非表示またはエラー表示 |

## 更新履歴
- 2026-02-21: 初版作成
