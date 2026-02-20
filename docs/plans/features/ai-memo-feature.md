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

## アーキテクチャ

### データフロー
```
入力（音声/テキスト）
    ↓
AI分析（分類 + プロジェクト特定 + ノード提案）
    ↓
    ├─ 「予定」→ カレンダーへ追加
    └─ 「計画」→ マップのノードへ追加
    ↓
ユーザー確認/修正（チャットで指示可能）
```

### 新規DBテーブル

```sql
-- メモテーブル
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  project_id UUID REFERENCES projects(id),
  task_id UUID REFERENCES tasks(id),
  content TEXT NOT NULL,
  raw_input TEXT,
  input_type TEXT NOT NULL DEFAULT 'text', -- 'text' | 'voice'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processed' | 'archived'
  ai_analysis JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- tasksテーブル拡張
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS memo TEXT;

-- インデックス
CREATE INDEX idx_notes_user_id ON notes(user_id);
CREATE INDEX idx_notes_project_id ON notes(project_id);
CREATE INDEX idx_notes_task_id ON notes(task_id);
```

### ai_analysis JSON構造
```json
{
  "classification": "calendar" | "map",
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

### Phase 1: メニューバー + メモ入力UI

#### タスク
1. `bottom-nav.tsx` に「メモ」メニュー追加
2. `ViewContext` に `memo` ビュー追加
3. `MemoView` コンポーネント作成
   - テキスト入力エリア
   - 展開/折りたたみボタン
   - 保存ボタン
4. `notes` テーブル作成（マイグレーション）
5. メモ保存API (`/api/notes`)

#### UIモック
```
┌─────────────────────────────┐
│  📝 メモ                    │
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ アイディアを入力...      │ │
│ │                         │ │
│ └─────────────────────────┘ │
│                             │
│ [展開 ▼]  [AIに分析してもらう]│
└─────────────────────────────┘

展開時:
┌─────────────────────────────┐
│  📝 メモ                    │
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ 来週の水曜に設計会議を   │ │
│ │ やりたい                 │ │
│ └─────────────────────────┘ │
│                             │
│ プロジェクト: [自動判定 ▼]  │
│ タイプ: [予定 / 計画]       │
│                             │
│ [折りたたむ ▲] [保存]       │
└─────────────────────────────┘
```

---

### Phase 2: AI統合

#### タスク
1. AI API選定・環境変数設定
   - 候補: OpenAI GPT-4o-mini / Gemini 2.0 Flash
2. `/api/ai/analyze-memo` エンドポイント作成
3. AI分析プロンプト設計
4. `ai_analysis` カラムへの結果保存

#### プロンプト構成
```
あなたはタスク管理アシスタントです。
以下のメモを分析して、分類と追加先を提案してください。

メモ: "{user_input}"

ユーザーのプロジェクト一覧:
{projects}

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
1. マップへのノード追加ロジック
   - `useMindMapSync` の `createTask` を活用
2. カレンダーへの予定追加ロジック
   - `useTaskCalendarSync` を活用
3. メモ→タスク変換処理
4. UI: 追加確認ダイアログ

#### フロー
```
メモ保存 → AI分析 → 結果表示 → ユーザー確認 → タスク作成
```

---

### Phase 4: 音声入力

#### タスク
1. Web Speech API 統合（`SpeechRecognition`）
2. 録音UI（マイクボタン + 波形表示）
3. 音声認識結果の `raw_input` 保存
4. ブラウザ互換性チェック

#### 実装方針
- **第一選択**: Web Speech API（ブラウザ標準、無料）
- **フォールバック**: 非対応ブラウザではテキスト入力のみ

```typescript
// hooks/useSpeechRecognition.ts
const useSpeechRecognition = () => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  const startListening = () => {
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.onresult = (event) => {
      setTranscript(event.results[0][0].transcript);
    };
    recognition.start();
  };

  return { isListening, transcript, startListening, stopListening };
};
```

#### 将来拡張（オプション）
- Groq + Whisper: 高速・高精度（API料金黄安）
- ローカルWhisper: ユーザー環境依存

---

### Phase 5: チャット壁打ち

#### タスク
1. メモ画面にチャットUI統合
2. 会話履歴の保持（ローカル状態）
3. 文脈を考慮した再分析
4. 「ここに追加して」指示の解析・実行

#### UIモック
```
┌─────────────────────────────┐
│  📝 メモ                    │
├─────────────────────────────┤
│ 来週の水曜に設計会議        │
│                             │
│ AI提案: 「設計」プロジェクト│
│        「設計方針」ノード   │
│                             │
│ ┌─────────────────────────┐ │
│ │ ここに追加して           │ │
│ └─────────────────────────┘ │
│ [送信]                      │
│                             │
│ AI: 了解、「設計方針」に    │
│     追加しました！          │
└─────────────────────────────┘
```

---

### Phase 6: タスクメモ欄 + MindMap同期

#### タスク
1. `tasks` テーブルに `memo` カラム追加
2. TaskNode にメモ表示UI追加
3. メモ編集モーダル
4. MindMapとリアルタイム同期

#### DB変更
```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS memo TEXT;
```

---

## 技術選定

### AI API
| 候補 | コスト | 速度 | 精度 | 採用理由 |
|------|--------|------|------|---------|
| **Gemini 2.0 Flash** | 無料枠大 | 高速 | 高 | 推奨（コスパ最強）|
| OpenAI GPT-4o-mini | 安 | 高速 | 高 | 代替案 |
| Claude Haiku | 安 | 高速 | 高 | 代替案 |

### 音声認識
| 候補 | コスト | 精度 | 採用理由 |
|------|--------|------|---------|
| **Web Speech API** | 無料 | 中〜高 | 推奨（ブラウザ標準）|
| Groq + Whisper | 格安 | 最高 | Phase 4で検討 |

---

## ファイル構成（予定）

```
src/
├── app/api/
│   ├── notes/
│   │   └── route.ts          # メモCRUD
│   └── ai/
│       └── analyze-memo/
│           └── route.ts      # AI分析
├── components/
│   ├── memo/
│   │   ├── memo-view.tsx     # メモ画面
│   │   ├── memo-input.tsx    # 入力コンポーネント
│   │   ├── memo-chat.tsx     # チャットUI
│   │   └── voice-input.tsx   # 音声入力
│   └── mobile/
│       └── bottom-nav.tsx    # メニュー追加
├── hooks/
│   ├── useNotes.ts           # メモ操作
│   └── useSpeechRecognition.ts # 音声認識
└── types/
    └── note.ts               # メモ型定義
```

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| AI APIコスト増 | Gemini無料枠活用 + キャッシュ |
| 音声認識精度 | Web Speech API + AI整形 |
| 既存機能への影響 | 段階的リリース + テスト |
| DB移行エラー | ロールバック可能なマイグレーション |

---

## 次のアクション

1. **Phase 1 開始**: メニューバー + メモ入力UI
2. DB設計の最終確認
3. AI API選定（Gemini 2.0 Flash推奨）
