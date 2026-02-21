# AIチャット型対話 Phase 5b-c 設計書

> Phase 5a（基本チャットUI + アクション実行）完了を前提とした改善設計

---

## Phase 5b: フローティングチャット改善

### 概要
AIの応答に**選択肢ボタン**を含め、ユーザーがタップだけで操作を進められるようにする。
テキスト入力と選択肢のハイブリッドUXを実現。

### 現状（Phase 5a）の課題
1. AIの応答がテキストのみ → ユーザーがテキストで返答する必要がある
2. プロジェクトやタスクの選択に正確な名前入力が必要
3. 日時指定が自然言語解析頼みで不安定

### 設計

#### 1. AI応答に選択肢を含める

**API変更: `/api/ai/chat/route.ts`**

プロンプトに選択肢指定フォーマットを追加:

```
## 選択肢の指定方法
ユーザーに選択を求める場合、応答の最後に以下のJSONブロックを含める:
\`\`\`options
[
  {"label": "表示テキスト", "value": "送信される値"},
  {"label": "表示テキスト2", "value": "送信される値2"}
]
\`\`\`
最大4つまで。必ず「自分で入力」を最後に含める。
```

**レスポンスの変更:**
```typescript
// 現在
{ reply: string, action?: Action }

// 変更後
{ reply: string, action?: Action, options?: Option[] }

interface Option {
  label: string
  value: string
}
```

**例: プロジェクト選択時**
```
ユーザー: 「マップに追加して」
AI: 「どのプロジェクトに追加しますか？」
    options: [
      { label: "プロジェクトA", value: "プロジェクトAに追加" },
      { label: "プロジェクトB", value: "プロジェクトBに追加" },
      { label: "自分で入力", value: "" }
    ]
```

**例: 日時選択時**
```
ユーザー: 「来週の会議を追加して」
AI: 「いつにしますか？」
    options: [
      { label: "月曜 10:00", value: "月曜 10:00 に設定" },
      { label: "火曜 10:00", value: "火曜 10:00 に設定" },
      { label: "水曜 10:00", value: "水曜 10:00 に設定" },
      { label: "自分で入力", value: "" }
    ]
```

#### 2. UI変更: `ai-chat-panel.tsx`

**ChatMessageの拡張:**
```typescript
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  action?: Action
  actionStatus?: 'pending' | 'executing' | 'success' | 'error'
  options?: Option[]  // 新規追加
}
```

**選択肢ボタンの表示:**
```
┌──────────────────────────┐
│ AI: どのプロジェクトに     │
│ 追加しますか？             │
│                            │
│ [プロジェクトA]            │
│ [プロジェクトB]            │
│ [自分で入力]               │
└──────────────────────────┘
```

- ボタンタップ → `value` を自動送信（ユーザーメッセージとして）
- 「自分で入力」タップ → テキスト入力欄にフォーカス
- ボタンは一度選択されたら無効化（再選択防止）

#### 3. 選択肢パース処理

`/api/ai/chat/route.ts` の応答パース:
```typescript
// 既存: actionブロック抽出
const actionMatch = responseText.match(/```action\s*\n([\s\S]*?)\n```/)

// 追加: optionsブロック抽出
const optionsMatch = responseText.match(/```options\s*\n([\s\S]*?)\n```/)
let options: Option[] | undefined
if (optionsMatch) {
  try {
    options = JSON.parse(optionsMatch[1])
    replyText = replyText.replace(/```options\s*\n[\s\S]*?\n```/, '').trim()
  } catch { /* ignore */ }
}
```

#### 4. 録音中の波形表示（完了済み）
- `VoiceWaveform` コンポーネントを共有化済み
- AIチャットパネルに録音中インジケーター追加済み

### 実装対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/app/api/ai/chat/route.ts` | プロンプトに選択肢フォーマット追加、optionsパース |
| `src/components/ai/ai-chat-panel.tsx` | ChatMessage型にoptions追加、選択肢ボタンUI |

### 工数見積もり
- API変更: 30分
- UI変更: 1時間
- テスト: 30分
- **合計: 約2時間**

---

## Phase 5c: セッション管理

### 概要
会話セッションの要約をDBに保存し、次回セッション開始時にコンテキストとして注入する。
7ラリー制限を超えても文脈を維持できる。

### 設計

#### 1. DBスキーマ: `ai_chat_summaries`

```sql
CREATE TABLE ai_chat_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,          -- 100文字以内の要約
  topics TEXT[] DEFAULT '{}',     -- 話題のキーワード（検索用）
  message_count INTEGER NOT NULL, -- そのセッションのメッセージ数
  created_at TIMESTAMPTZ DEFAULT now()
);

-- インデックス
CREATE INDEX idx_chat_summaries_user_id ON ai_chat_summaries(user_id);
CREATE INDEX idx_chat_summaries_created_at ON ai_chat_summaries(created_at DESC);

-- RLS
ALTER TABLE ai_chat_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own summaries"
  ON ai_chat_summaries
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 古いセッションの自動削除（最新5件のみ保持）
-- → アプリ側で制御（INSERT時に古いレコードを削除）
```

#### 2. API: `/api/ai/chat/summarize`

**POST** - セッション終了時に要約を生成・保存

```typescript
// リクエスト
{ messages: ChatMessage[] }

// 処理
// 1. Gemini API で会話を100文字以内に要約
// 2. トピックキーワードを抽出
// 3. ai_chat_summaries に INSERT
// 4. 古いセッション（6件目以降）を DELETE

// レスポンス
{ summary: string, topics: string[] }
```

**要約プロンプト:**
```
以下の会話を100文字以内で要約してください。
また、主要なトピックをキーワード3つ以内で抽出してください。

会話:
{messages}

出力形式（JSON）:
{"summary": "...", "topics": ["キーワード1", "キーワード2"]}
```

#### 3. セッション開始時の要約読み込み

`/api/ai/chat/route.ts` のシステムプロンプトに追加:

```typescript
// 最新3件のセッション要約を取得
const { data: summaries } = await supabase
  .from('ai_chat_summaries')
  .select('summary, topics, created_at')
  .eq('user_id', user.id)
  .order('created_at', { ascending: false })
  .limit(3)

// プロンプトに注入
const summaryContext = summaries?.length
  ? `\n## 過去の会話サマリー\n${summaries.map(s =>
      `- ${s.summary} (トピック: ${s.topics.join(', ')})`
    ).join('\n')}`
  : ''
```

#### 4. セッションリセット時の自動要約

`ai-chat-panel.tsx` の `handleReset`:

```typescript
const handleReset = useCallback(async () => {
  // メッセージが2件以上ある場合のみ要約
  if (messages.length >= 2) {
    try {
      await fetch('/api/ai/chat/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      })
    } catch {
      // 要約失敗しても会話リセットは続行
    }
  }
  setMessages([])
  setInput("")
}, [messages])
```

#### 5. 7ラリー到達時の自動要約

```typescript
// /api/ai/chat/route.ts で rallyCount >= 7 の場合
if (rallyCount >= 7) {
  // バックグラウンドで要約保存（レスポンスはブロックしない）
  // → クライアント側で handleReset 呼び出し時に実行
  return NextResponse.json({
    reply: '会話が長くなりました。内容を保存してリセットします。',
    shouldReset: true,
    shouldSummarize: true,  // 新規フラグ
  })
}
```

### 実装対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `supabase/migrations/YYYYMMDD_create_ai_chat_summaries.sql` | テーブル作成 |
| `src/app/api/ai/chat/summarize/route.ts` | 要約生成・保存API（新規） |
| `src/app/api/ai/chat/route.ts` | セッション要約をプロンプトに注入 |
| `src/components/ai/ai-chat-panel.tsx` | リセット時に自動要約 |
| `src/types/database.ts` | ai_chat_summaries 型追加 |

### 工数見積もり
- DBマイグレーション: 15分
- 要約API: 1時間
- チャットAPI改修: 30分
- UI改修: 30分
- テスト: 30分
- **合計: 約3時間**

---

## 実装優先順位

| 順番 | フェーズ | 工数 | 理由 |
|------|---------|------|------|
| 1 | **Phase 5b** | 2時間 | UX改善のインパクト大。選択肢ボタンでタップ操作が劇的に改善 |
| 2 | **Phase 5c** | 3時間 | 文脈維持で会話品質向上。7ラリー制限の実用性が大幅UP |

---

## リスクと対策

| リスク | レベル | 対策 |
|--------|--------|------|
| AIが選択肢フォーマットを正しく出力しない | MEDIUM | フォーマット検証 + フォールバック（テキストのみ） |
| 要約APIの追加コスト | LOW | 1セッション1回、100文字なので微小 |
| 要約が不正確で文脈が混乱 | LOW | 最新3件のみ使用、古い要約は無視 |
| セッション要約のDB肥大化 | LOW | 最新5件のみ保持（超過分を自動削除） |

---

## 更新履歴
- 2026-02-21: 初版作成（Phase 5b-c 設計）
