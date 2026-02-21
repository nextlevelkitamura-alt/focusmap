# AIメモ機能 設計書

> 音声/テキストでメモを入力し、AIが分類してカレンダー/マップに追加する機能

## 概要

### 目的
- 思いついたアイディアや予定を素早く記録
- AIが自動で分類（カレンダー予定 vs プロジェクト計画）
- マインドマップの適切なノードに提案・追加

### ユーザー価値
- **速度**: 音声/テキストで即座にメモ
- **整理**: AIが分類・提案してくれる
- **統合**: 既存のマップ/カレンダーとシームレス連携

---

## 技術選定（確定）

### AI API
| 採用 | コスト | 速度 | 精度 | 理由 |
|------|--------|------|------|------|
| **Gemini 3.0 Flash** | 無料枠大 | 高速 | 高 | コスパ最強 |

### 音声認識
| 採用 | コスト | 精度 | 理由 |
|------|--------|------|------|
| **Groq API（Whisper large-v3-turbo）** | Free tier: $0（100人まで） | 高い | 日本語精度高・導入最簡単 |

#### Groq Free tier の容量（組織単位）
- 音声秒数/日: 28,800秒（8時間）
- リクエスト/日: 2,000回
- リクエスト/分: 20回
- 100人×1日5回×10秒 = 5,000秒/日 → **余裕（17%使用）**

#### スケール戦略
| フェーズ | ユーザー数 | 構成 | 月額 |
|---------|-----------|------|------|
| 立ち上げ期 | ~100人 | Groq Free のみ | $0 |
| 成長期 | 100~500人 | Groq Free + Whisper.cpp フォールバック | ~$3 |
| 拡大期 | 500人~ | Groq Developer($0.04/h) + Whisper.cpp | ~$8 |

---

## アーキテクチャ

### データフロー
```
入力（音声/テキスト）
    ↓
[音声の場合] MediaRecorder API → /api/transcribe → Groq API → テキスト化
    ↓
AI分析（Gemini 3.0 Flash: 分類 + プロジェクト特定 + ノード提案）
    ↓
    ├─ 「予定」→ カレンダーへ追加
    └─ 「計画」→ マップのノードへ追加
    ↓
ユーザー確認/修正（チャットで指示可能）
```

### 音声入力フロー
```
[ブラウザ] MediaRecorder API で録音
    ↓ WebM(Chrome/Android) or MP4(Safari/iOS) を自動検出
[Next.js API Route: /api/transcribe]
    ↓ FormData → Groq API (whisper-large-v3-turbo)
[テキスト結果] → メモ入力欄に反映
```

### DBテーブル

#### notes テーブル（Phase 1 で作成済み）
```sql
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  project_id UUID REFERENCES projects(id),
  task_id UUID REFERENCES tasks(id),
  content TEXT NOT NULL,
  raw_input TEXT,              -- 音声認識の生テキスト
  input_type TEXT NOT NULL DEFAULT 'text', -- 'text' | 'voice'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processed' | 'archived'
  ai_analysis JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### tasks.memo カラム（Phase 6 で追加済み）
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS memo TEXT;
```

### ai_analysis JSON構造
```json
{
  "classification": "calendar | map",
  "confidence": 0.85,
  "suggested_project_id": "uuid",
  "suggested_project_name": "プロジェクト名",
  "suggested_node_id": "uuid",
  "suggested_node_title": "親ノード名",
  "reasoning": "このメモは〜なのでXXに追加すべきです",
  "extracted_entities": {
    "dates": ["2026-02-21"],
    "times": ["14:00"],
    "keywords": ["会議", "設計"]
  }
}
```

---

## Phase構成

### Phase 1: メニューバー + メモ入力UI ✅ 完了
- `bottom-nav.tsx` に「メモ」メニュー追加
- `ViewContext` に `memo` ビュー追加
- `MemoView` コンポーネント作成
- `notes` テーブル作成（マイグレーション）
- メモ保存API (`/api/notes`)

### Phase 2: AI統合（Gemini 3.0 Flash）

#### タスク
1. Gemini API 環境変数設定（`GEMINI_API_KEY`）
2. `/api/ai/analyze-memo` エンドポイント作成
3. AI分析プロンプト設計（プロジェクト一覧をコンテキストに含める）
4. `ai_analysis` カラムへの結果保存
5. MemoView に「AIに分析してもらう」ボタン + 結果表示UI

#### プロンプト構成
```
あなたはタスク管理アシスタントです。
以下のメモを分析して、分類と追加先を提案してください。

メモ: "{user_input}"

ユーザーのプロジェクト一覧:
{projects_with_tasks}

出力形式（JSON）:
{
  "classification": "calendar" | "map",
  "suggested_project_id": "...",
  "suggested_node_id": "...",
  "reasoning": "..."
}
```

---

### Phase 3: マップ/カレンダーへの追加

#### タスク
1. マップへのノード追加ロジック（`useMindMapSync.createTask` 活用）
2. カレンダーへの予定追加ロジック（`useTaskCalendarSync` 活用）
3. メモ→タスク変換処理
4. UI: 追加確認ダイアログ

#### フロー
```
メモ保存 → AI分析 → 結果表示 → ユーザー確認 → タスク作成
```

---

### Phase 4: 音声入力（Groq API）

#### タスク
1. `/api/transcribe` エンドポイント作成（Groq API連携）
2. `useVoiceRecorder` Hook 作成（MediaRecorder API）
   - iPhone Safari 対応: MP4/AAC フォーマット自動検出
   - Android/Chrome: WebM/Opus
3. 録音UI（マイクボタン + 録音状態表示）
4. Groq API 環境変数設定（`GROQ_API_KEY`）
5. レート制限エラーのハンドリング

#### 実装方針
```typescript
// /api/transcribe/route.ts
// 1. FormData から音声ファイル取得
// 2. Groq API (whisper-large-v3-turbo) に送信
// 3. テキスト結果を返却
```

#### 音声データの扱い
- 音声ファイルは**保存しない**（トランスクリプト後に破棄）
- `notes.raw_input` に音声認識の生テキストを保存
- `notes.input_type = 'voice'` で音声入力を識別

---

### Phase 5: AIチャット型対話 → [仕様](../../specs/ai-chat-dialogue.md)

#### Phase 5a: チャットUI + 基本対話
1. フローティングアイコン + パネルUI（右下、モバイル50vh/PC 400x500px）
2. `/api/ai/chat` エンドポイント（Gemini 2.5 Flash、プロジェクト一覧コンテキスト）
3. メッセージ表示 + テキスト入力 + 7ラリー制限
4. 音声入力統合（既存 useVoiceRecorder 活用）

#### Phase 5b: アクション実行（Function Calling）
1. Gemini Function Calling 設定（7アクション定義）
2. `/api/ai/chat/execute` エンドポイント
3. アクション確認UI（実行/修正/キャンセルボタン）
4. マップ追加・カレンダー追加の実行ロジック
5. メモ編集・紐付け・アーカイブの実行ロジック

#### Phase 5c: セッション管理
1. `ai_chat_summaries` テーブル作成（100文字要約 × 最新5セッション）
2. `/api/ai/chat/summarize` エンドポイント（セッション終了時に自動要約）
3. セッション開始時の要約読み込み + プロンプト注入

---

### Phase 6: タスクメモ欄 + MindMap同期 ✅ 完了（DB未適用）
- `tasks` テーブルに `memo` カラム追加
- TaskNode にメモ表示UI追加（デスクトップ + モバイル）
- メモ編集（blur時に自動保存）
- MindMapとリアルタイム同期

---

## ファイル構成

```
src/
├── app/api/
│   ├── notes/
│   │   └── route.ts              # メモCRUD ✅
│   ├── transcribe/
│   │   └── route.ts              # 音声→テキスト（Groq API）
│   └── ai/
│       └── analyze-memo/
│           └── route.ts          # AI分析（Gemini 3.0 Flash）
├── components/
│   ├── memo/
│   │   ├── memo-view.tsx         # メモ画面 ✅
│   │   ├── memo-chat.tsx         # チャットUI（Phase 5）
│   │   └── voice-input.tsx       # 音声入力（Phase 4）
│   └── mobile/
│       └── bottom-nav.tsx        # メニュー追加 ✅
├── hooks/
│   ├── useNotes.ts               # メモ操作（必要時に抽出）
│   └── useVoiceRecorder.ts       # 音声録音（Phase 4）
└── types/
    └── note.ts                   # メモ型定義 ✅
```

---

## 環境変数

```env
# AI分析（Phase 2）
GEMINI_API_KEY=xxx

# 音声認識（Phase 4）
GROQ_API_KEY=xxx
```

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| Groq レート制限超過 | 100人以下なら余裕。超過時は429エラーをUIで通知 |
| iPhone Safari の音声録音 | MediaRecorder のフォーマット自動検出で対応 |
| AI APIコスト増 | Gemini 3.0 Flash 無料枠活用 |
| 既存機能への影響 | 段階的リリース + テスト |
| DB移行エラー | IF NOT EXISTS で安全なマイグレーション |

---

## 次のアクション

1. **DBマイグレーション実行**: `notes` テーブル + `tasks.memo` カラム
2. **Phase 2 着手**: Gemini 3.0 Flash でAI分析
3. **Phase 3 着手**: マップ/カレンダーへの追加
4. **Phase 4 着手**: Groq API で音声入力
