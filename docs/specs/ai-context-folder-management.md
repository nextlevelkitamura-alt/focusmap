# AI コンテキスト フォルダ管理システム 設計書

> **作成日**: 2026-02-26
> **エージェントチーム**: UI/UXアーキテクト + データエンジニア + AIコンテキストスペシャリスト
> **ステータス**: Draft - ユーザー承認待ち

---

## 1. 概要

### 目的
AIがユーザーを深く理解した上で提案できるよう、コンテキスト情報を**フォルダ/ファイル型UI**で直感的に管理できる仕組みを構築する。

### 現状の課題
- 固定3カテゴリ（性格・目標・状況）で拡張性がない
- プロジェクトコンテキストも固定3フィールドで柔軟性がない
- 鮮度管理の仕組みがない（`updated_at` があるだけ）
- ユーザーが自由に情報を整理できない

### ゴール
```
設定 > コンテキスト管理
├── 📁 自分について
│   ├── 📄 性格・ライフスタイル     ● 新鮮
│   ├── 📄 目標・価値観             ● 新鮮
│   ├── 📄 今の状況                 ⚠️ 要更新（14日前）
│   └── 📄 趣味・関心（カスタム）    ● 新鮮
└── 📁 プロジェクト
    ├── 📁 Shikumika App
    │   ├── 📄 プロジェクト目的      ● 新鮮
    │   ├── 📄 現状・進捗           ⚠️ 要更新
    │   └── 📄 重要な決定           ● 新鮮
    └── 📁 副業プロジェクト
        └── 📄 ...
```

---

## 2. UIデザイン

### 2-1. デスクトップレイアウト（2ペイン）

```
┌─────────────────────────────────────────────────────┐
│ ← 設定に戻る    コンテキスト管理                      │
├──────────────────┬──────────────────────────────────┤
│ 📁 自分について  │  📄 性格・ライフスタイル           │
│   📄 性格・ラ... │  ────────────────────────         │
│   📄 目標・価... │  ● 新鮮  最終更新: 2日前          │
│   📄 今の状況 ⚠️ │                                   │
│                  │  ┌─────────────────────────────┐  │
│ 📁 プロジェクト  │  │ フリーランスでWeb開発を      │  │
│   📁 Shikumika   │  │ メインにしています。         │  │
│     📄 目的      │  │ 朝型で、午前中に集中作業...  │  │
│     📄 現状  ⚠️  │  │                              │  │
│     📄 重要決定  │  └─────────────────────────────┘  │
│                  │                                   │
│ ＋ ファイル追加  │  [💡 ヒント] [保存]               │
└──────────────────┴──────────────────────────────────┘
```

### 2-2. モバイルレイアウト（フルスクリーン切り替え）

**Step 1: フォルダツリー画面**
```
┌───────────────────────┐
│ ← 設定  コンテキスト管理│
├───────────────────────┤
│                        │
│ 📁 自分について    ▶   │
│   ● 3ファイル / 1件要更新│
│                        │
│ 📁 プロジェクト    ▶   │
│   ● 2プロジェクト       │
│                        │
│ ＋ ファイルを追加       │
├───────────────────────┤
│ [Today][Map][AI]...[設定]│
└───────────────────────┘
```

**Step 2: フォルダ内容（タップで展開）**
```
┌───────────────────────┐
│ ← 戻る  自分について    │
├───────────────────────┤
│                        │
│ 📄 性格・ライフスタイル │
│   ● 新鮮  2日前更新     │
│                        │
│ 📄 目標・価値観         │
│   ● 新鮮  5日前更新     │
│                        │
│ 📄 今の状況        ⚠️   │
│   要更新  14日前更新     │
│                        │
│ ＋ ファイルを追加       │
└───────────────────────┘
```

**Step 3: ファイル編集（タップで展開）**
```
┌───────────────────────┐
│ ← 戻る  性格・ライフスタイル│
│              [保存]     │
├───────────────────────┤
│ ● 新鮮  最終更新: 2日前 │
│                        │
│ ┌────────────────────┐ │
│ │ フリーランスでWeb   │ │
│ │ 開発をメインに...   │ │
│ │                     │ │
│ │                     │ │
│ └────────────────────┘ │
│                        │
│ 💡 こんな内容を書くと  │
│    AIが活用できます:    │
│    ・働き方（フリーランス│
│      /会社員）          │
│    ・生活リズム（朝型/  │
│      夜型）            │
│    ・性格の特徴         │
│                        │
│ [✅ 最新です] [🗑 削除] │
└───────────────────────┘
```

### 2-3. コンポーネント構成

```
src/components/settings/
├── context-manager/
│   ├── index.tsx                    # メインコンテナ（2ペイン管理）
│   ├── context-folder-tree.tsx      # 左ペイン：フォルダツリー
│   ├── context-document-editor.tsx  # 右ペイン：ドキュメント編集
│   ├── context-folder-item.tsx      # フォルダ行コンポーネント
│   ├── context-document-item.tsx    # ファイル行コンポーネント
│   ├── freshness-badge.tsx          # 鮮度バッジ（●/⚠️/🔴）
│   ├── content-hint.tsx             # 入力ヒント表示
│   └── create-document-dialog.tsx   # 新規ファイル作成ダイアログ
└── ai-context-settings.tsx          # 既存 → リンクカードに改修
```

### 2-4. 鮮度バッジUI

| ステータス | 表示 | 色 | 条件 |
|-----------|------|-----|------|
| fresh | `● 新鮮` | green-500 | スコア >= 0.7 |
| aging | `⚠️ そろそろ更新` | amber-500 | スコア 0.3〜0.7 |
| stale | `🔴 要更新` | red-500 | スコア < 0.3 |

---

## 3. データモデル

### 3-1. テーブル設計

**ai_context_folders**
```sql
CREATE TABLE ai_context_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES ai_context_folders(id) ON DELETE CASCADE,
  folder_type TEXT NOT NULL DEFAULT 'custom',
    -- 'root_personal' | 'root_projects' | 'project' | 'custom'
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  icon TEXT,              -- Lucide アイコン名
  order_index INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**ai_context_documents**
```sql
CREATE TABLE ai_context_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id UUID NOT NULL REFERENCES ai_context_folders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  document_type TEXT NOT NULL DEFAULT 'note',
    -- 'personality' | 'purpose' | 'situation'
    -- 'project_purpose' | 'project_status' | 'project_insights'
    -- 'note' (カスタム)
  max_length INTEGER NOT NULL DEFAULT 500,
  source TEXT NOT NULL DEFAULT 'manual',
    -- 'manual' | 'ai_interview' | 'ai_auto'
  order_index INTEGER NOT NULL DEFAULT 0,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  freshness_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 3-2. ER図

```
auth.users
  └── ai_context_folders (user_id)
        ├── 「自分について」 (root_personal, is_system=true)
        │     ├── doc: 性格・ライフスタイル (personality)
        │     ├── doc: 目標・価値観 (purpose)
        │     ├── doc: 今の状況 (situation)
        │     └── doc: カスタム... (note)
        │
        └── 「プロジェクト」 (root_projects, is_system=true)
              ├── folder: Shikumika App (project, project_id=xxx)
              │     ├── doc: 目的 (project_purpose)
              │     ├── doc: 現状 (project_status)
              │     └── doc: 重要な決定 (project_insights)
              └── folder: 別プロジェクト...
```

---

## 4. 鮮度管理システム

### 4-1. スコア算出（指数減衰）

```typescript
function calculateFreshnessScore(doc: ContextDocument): number {
  const baseDate = doc.freshness_reviewed_at || doc.content_updated_at
  const daysSinceUpdate = (Date.now() - baseDate) / 86400000
  const halfLife = HALF_LIFE_DAYS[doc.document_type] || 30
  return Math.exp(-Math.LN2 * daysSinceUpdate / halfLife)
}
```

### 4-2. ドキュメントタイプ別の半減期

| タイプ | 半減期 | 根拠 |
|--------|--------|------|
| personality（性格） | 90日 | 性格はめったに変わらない |
| purpose（目標） | 60日 | 目標は数ヶ月単位で見直し |
| situation（今の状況） | 14日 | 状況は頻繁に変化 |
| project_status（進捗） | 14日 | プロジェクト進捗は頻繁 |
| project_purpose（目的） | 90日 | プロジェクト目的は安定 |
| project_insights（決定） | 30日 | 決定は中期的 |
| note（カスタム） | 30日 | デフォルト |

### 4-3. 「最新です」ボタン

内容を変更せずに鮮度をリセットできる。ユーザーが確認して「変わってない」場合に使う。
→ `freshness_reviewed_at = now()` を更新

### 4-4. AIによる能動的な更新提案

古い情報がある場合、AIのシステムプロンプトに以下を注入：

```markdown
## 古くなっているコンテキスト
以下の情報は最終更新から時間が経っています。会話の中で自然に最新状況を確認してください。
- 今の状況（14日前）
- Shikumika App の現状（21日前）
```

---

## 5. コンテンツテンプレート（何を書くべきか）

### 5-1.「自分について」デフォルトファイル

#### 📄 性格・ライフスタイル
```
ヒント: AIがあなたに合った提案をするための基本情報です。

記入例:
・働き方: フリーランスのWebエンジニア、在宅勤務中心
・生活リズム: 朝型。6時起床、22時就寝
・性格: 計画的だが柔軟。新しいことを試すのが好き
・コミュニケーション: 簡潔で具体的なやり取りを好む
```

#### 📄 目標・価値観
```
ヒント: 短期〜長期の目標や大事にしていることを書いてください。

記入例:
・短期目標（3ヶ月）: Shikumikaアプリの MVP リリース
・中期目標（1年）: 月10万のSaaS収益
・価値観: 「仕組み化」で時間の自由を作る。質 > 量
・避けたいこと: 長時間の単純作業、過度な会議
```

#### 📄 今の状況
```
ヒント: 最近の状況や悩みを書くと、AIが文脈を理解して提案できます。

記入例:
・最近の出来事: クライアント案件が一段落、自社開発に集中できる
・悩み: 集客方法が定まらない。SNS vs ブログ vs コミュニティ
・健康状態: 運動不足気味。週2回のジムを目標にしている
・気分: やる気は高いが、タスクが多すぎて優先順位に迷う
```

### 5-2. カスタムファイルの例

ユーザーが自由に追加できるファイル：
- 📄 **趣味・関心** - 好きなこと、学びたいこと
- 📄 **人間関係** - 家族構成、チームメンバー
- 📄 **健康・習慣** - 運動、食事、睡眠の目標
- 📄 **スキル・経験** - 得意分野、学習中の技術

### 5-3.「プロジェクト」デフォルトファイル（各プロジェクトに3つ）

#### 📄 プロジェクト目的
```
ヒント: このプロジェクトが何を解決するか、なぜ取り組むか。

記入例:
・誰の課題: 個人事業主やフリーランスの「仕事と生活の一元管理」
・ゴール: カレンダー・タスク・習慣を1つのアプリで管理
・差別化: AIが文脈を理解して能動的に提案してくれる
```

#### 📄 現状・進捗
```
ヒント: 今どのフェーズにいるか、直近で何をしているか。

記入例:
・フェーズ: MVP開発中（Phase 1.5）
・直近の作業: AIスキルシステムの実装完了、コンテキスト管理UI着手
・ブロッカー: なし
・次のマイルストーン: AI Agent Systemの完成 → クローズドβ
```

#### 📄 重要な決定
```
ヒント: 技術選定やプロダクト方針の重要な判断を記録。

記入例:
・AI基盤: Gemini 3.0 Flash（コスト重視）
・認証: Supabase Auth + Google OAuth
・決定事項: メモ機能は廃止 → AI Agent Systemに統合
・教訓: 対話優先のUI設計がユーザー体験を大幅改善
```

---

## 6. AIコンテキスト読み込み戦略

### 6-1. スキル別の読み込みルール

| スキル | 必須ファイル | 任意ファイル |
|--------|------------|-------------|
| scheduling | personality | カスタム（趣味等） |
| task | situation, project_status | project_insights |
| counseling | 全ファイル | 全ファイル |

### 6-2. トークン最適化

```
合計トークン上限: 約800字（日本語で約400トークン）
├── 個人コンテキスト: 最大400字
│   ├── ピン留めファイル: 優先読み込み
│   └── スキル関連ファイル: 次に読み込み
└── プロジェクトコンテキスト: 最大300字
    ├── アクティブプロジェクト: 優先
    └── ピン留めプロジェクト: 次に読み込み
残り100字: 鮮度アラート
```

### 6-3. 読み込み優先順序

1. **is_pinned = true** のドキュメント（常に読み込み）
2. **スキルが要求する document_type** のドキュメント
3. **アクティブプロジェクト** のドキュメント
4. **鮮度が高い順** で残り枠を埋める

---

## 7. 自動更新の仕組み

### 7-1. 会話からの自動抽出

AIの counseling スキルが新しい情報を学んだ時：

```json
{
  "context_update": {
    "document_type": "situation",
    "content": "最近はクライアント案件が落ち着き、自社開発に注力中",
    "merge_strategy": "replace",
    "confidence": 0.9
  }
}
```

### 7-2. マージ戦略

| 戦略 | 動作 | 使用場面 |
|------|------|---------|
| `append` | 既存の末尾に追記 | 新しい情報の追加 |
| `replace` | 全体を置換 | 状況が大きく変わった時 |
| `merge` | AIが既存と統合・要約 | 情報の更新 |

### 7-3. 承認フロー

- **confidence >= 0.8**: 自動更新（UIに通知のみ）
- **confidence < 0.8**: 確認ダイアログ表示
- **手動編集との競合**: 手動編集を優先（AI更新は破棄）

---

## 8. API設計

### エンドポイント一覧

| Method | Path | 用途 |
|--------|------|------|
| POST | `/api/ai/context/initialize` | 初回セットアップ + 旧データ移行 |
| GET | `/api/ai/context/folders` | フォルダ・ドキュメントツリー取得 |
| POST | `/api/ai/context/folders` | フォルダ作成 |
| PATCH | `/api/ai/context/folders/[id]` | フォルダ更新 |
| DELETE | `/api/ai/context/folders/[id]` | フォルダ削除 |
| POST | `/api/ai/context/documents` | ドキュメント作成 |
| PATCH | `/api/ai/context/documents/[id]` | ドキュメント更新 |
| DELETE | `/api/ai/context/documents/[id]` | ドキュメント削除 |
| POST | `/api/ai/context/documents/[id]/review` | 「最新です」確認 |
| GET | `/api/ai/context/freshness` | 鮮度サマリー取得 |

### 既存APIとの後方互換

`GET/POST /api/ai/chat/context` は内部で新テーブルを参照するよう改修。
旧テーブルは読み取り専用のフォールバックとして残す。

---

## 9. マイグレーション戦略

### Lazy Migration（遅延移行）方式

1. ユーザーが設定画面 or AIチャットにアクセス
2. `POST /api/ai/context/initialize` を呼び出し
3. ルートフォルダが未作成なら自動作成 + 旧データ移行
4. 移行済みフラグで二重実行を防止

### 移行データの対応

| 旧テーブル | 旧フィールド | 新テーブル | 新document_type |
|-----------|------------|-----------|----------------|
| ai_user_context | life_personality | ai_context_documents | personality |
| ai_user_context | life_purpose | ai_context_documents | purpose |
| ai_user_context | current_situation | ai_context_documents | situation |
| ai_project_context | purpose | ai_context_documents | project_purpose |
| ai_project_context | current_status | ai_context_documents | project_status |
| ai_project_context | key_insights | ai_context_documents | project_insights |

---

## 10. 実装フェーズ

### Phase 1: データ基盤（1-2日）
- [ ] マイグレーションSQL（テーブル + RLS）
- [ ] TypeScript型定義追加
- [ ] 初期化API（`/api/ai/context/initialize`）
- [ ] 鮮度スコア算出ロジック

### Phase 2: CRUD API（1-2日）
- [ ] フォルダCRUD API
- [ ] ドキュメントCRUD API
- [ ] ツリー取得API（フォルダ + ドキュメント一括）
- [ ] 鮮度サマリーAPI

### Phase 3: UI実装（2-3日）
- [ ] フォルダツリーコンポーネント
- [ ] ドキュメントエディタコンポーネント
- [ ] 鮮度バッジコンポーネント
- [ ] コンテンツヒント表示
- [ ] 新規作成ダイアログ
- [ ] モバイル対応（フルスクリーン切り替え）

### Phase 4: AI統合（1-2日）
- [ ] コンテキスト注入ロジック改修（新テーブル参照）
- [ ] 鮮度アラートのプロンプト注入
- [ ] context_update の新フォーマット対応
- [ ] 既存APIの後方互換レイヤー

### Phase 5: 磨き込み（1日）
- [ ] 「最新です」ボタンの実装
- [ ] AI自動更新の承認フロー
- [ ] 空状態のオンボーディングUI
- [ ] 旧設定UIからの導線

---

## 11. 技術スタック

| 領域 | 技術 |
|------|------|
| UI | React + Tailwind CSS + Radix UI (shadcn/ui) |
| アイコン | lucide-react |
| 状態管理 | React useState + SWR or fetch |
| DB | Supabase (PostgreSQL) + RLS |
| API | Next.js Route Handlers |
| AI | Gemini 3.0 Flash（既存） |
