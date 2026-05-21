# メモ→マインドマップ変換（AI構造化） — 仕様書

> **ステータス**: Draft
> **作成日**: 2026-05-21
> **前提**: [ai-provider-abstraction.md](ai-provider-abstraction.md)（AI基盤）, [ai-context-folder-management.md](ai-context-folder-management.md)
> **スコープ**: Phase 1 = メモ→マインドマップ変換のみ。プロジェクト自動分類・課金基盤は対象外（将来拡張で言及）

---

## 1. 概要とゴール

ユーザーが書き溜めた複数メモ（`notes`）を、AIがロジックツリー構造に整理し、
マインドマップ（`tasks` ツリー）として可視化する機能。

**体験のゴール**: バラバラのメモを選んで「マインドマップ化」を押すと、
論理階層が組まれたツリーがプレビュー表示され、確認・編集して確定するとマップに反映される。

---

## 2. 前提：既存資産（再利用するもの）

| 資産 | 内容 | 本機能での扱い |
|---|---|---|
| Vercel AI SDK (`ai` + `@ai-sdk/google`) | モデル抽象・`generateObject` | **正の生成手段**。Zodスキーマで構造化出力を強制 |
| `getModelForSkill()` (`src/lib/ai/providers/index.ts`) | モデル取得ヘルパー | メモ整理用の取得関数を追加 |
| `tasks` テーブル | マインドマップ本体（`parent_task_id` 階層 + `is_group`） | 生成ツリーの保存先 |
| `notes` テーブル | メモ本体（`content`, `project_id`, `task_id`, `image_urls`） | 変換の入力。確定後に `task_id` を紐付け |
| `loadMindmapStructure()` (`src/lib/ai/context/mindmap-context.ts`) | tasksツリー→テキスト | 既存マップへ追記する場合のコンテキスト |
| ReactFlow + Dagre（`mindmap/` 配下） | マップ描画 | プレビュー（仮ノード）と確定後描画に使用 |
| 仮ノード→確定パターン（ai-provider-abstraction Phase 3） | 破線ノードのプレビューUX | 本機能のプレビューに踏襲 |

---

## 3. アーキテクチャ / データフロー

```
メモ複数選択（memo-view）
        │  noteIds[]
        ▼
POST /api/ai/memo-to-mindmap        ← プレビュー生成（DB書き込みなし）
   1. notes を取得（content / image_urls は除外しテキストのみ）
   2. モデル選択（quick=Gemini Flash-Lite / deep=DeepSeek V4）
   3. generateObject(schema=MindmapDraftSchema) → フラットなノード配列
   4. ai_usage に使用量を記録（Phase 1 は記録のみ・制限なし）
        │  draft（プレビュー）
        ▼
プレビュー描画（ReactFlow・破線=仮ノード）
   - ノードのタイトル編集 / 削除 / 親付け替えを許可
        │  ユーザーが「確定」
        ▼
POST /api/ai/memo-to-mindmap/commit
   1. draft（ユーザー編集後）を tasks へ再帰INSERT
   2. notes.task_id / project_id を紐付け、status='processed'
        │
        ▼
マインドマップに反映（ReactFlow が通常描画）
```

**設計原則**: 生成（プレビュー）と確定（DB書き込み）を別エンドポイントに分離する。
生成は失敗・やり直しが起きるため、副作用を確定時のみに閉じ込める。

---

## 4. データモデル

### 4.1 既存テーブルの利用（スキーマ変更なし）

- `tasks`: 生成ツリーをそのまま保存。`is_group=true`（枝あり）/ `false`（葉）、
  ルート = `parent_task_id IS NULL`、`order_index` は兄弟内連番。
- `notes`: 確定時に `task_id`（代表ノード）・`project_id` を更新、`status='processed'`。

### 4.2 新規テーブル：`ai_usage`（使用量ログ）

課金基盤の土台。Phase 1 は**記録のみ**（制限・課金は将来）。

```sql
create table ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,                 -- 'memo_to_mindmap' 等
  model text not null,                   -- 実際に使ったモデル名
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(10,6) not null default 0,
  metadata jsonb,                        -- { noteCount, mode, projectId }
  created_at timestamptz not null default now()
);
create index ai_usage_user_created_idx on ai_usage (user_id, created_at desc);
-- RLS: 自分の行のみ select 可、insert はサーバー（service role）のみ
```

---

## 5. API 設計

### 5.1 `POST /api/ai/memo-to-mindmap` — プレビュー生成

リクエスト:
```ts
{
  noteIds: string[]              // 変換対象メモ（1件以上）
  mode?: 'quick' | 'deep'        // 既定 'quick'
  targetProjectId?: string       // 指定時は既存マップへ追記前提でコンテキスト注入
}
```

レスポンス:
```ts
{
  draft: MindmapDraft            // §6.2
  usage: { inputTokens, outputTokens, costUsd, model }
}
```

処理:
1. 認証ユーザーの `notes` を `noteIds` で取得（他人のメモは除外）。
2. `mode` でモデルを決定（§6.1）。
3. `targetProjectId` があれば `loadMindmapStructure()` で既存ツリーを system に注入。
4. `generateObject()` で `MindmapDraftSchema` を強制生成。
5. `ai_usage` に1行 insert（feature='memo_to_mindmap'）。
6. `draft` を返す（**DBのtasksには書き込まない**）。

### 5.2 `POST /api/ai/memo-to-mindmap/commit` — 確定

リクエスト:
```ts
{
  draft: MindmapDraft            // ユーザー編集後のもの
  target: { type: 'new', projectTitle: string }
        | { type: 'existing', projectId: string }
}
```

レスポンス: `{ projectId: string, rootTaskIds: string[] }`

処理:
1. `target.type==='new'` ならプロジェクト相当のルートを作成。
2. `draft.nodes` を**トポロジカル順**に `tasks` へ INSERT。
   `tempId → 実ID` のマップを構築し `parent_task_id` を解決。
   枝ノード（子を持つ）は `is_group=true`。
3. 各ノードの `sourceNoteIds` を使い、対応する `notes` の
   `task_id`・`project_id` を更新、`status='processed'`。

---

## 6. LLM 設計

### 6.1 モデル選定（デュアル構成）

| mode | モデル | 経路 | 用途 |
|---|---|---|---|
| `quick`（既定） | Gemini 3.1 Flash-Lite | `@ai-sdk/google` | 通常のメモ整理。高速・最安級 |
| `deep` | DeepSeek V4 | `@ai-sdk/deepseek`（新規追加） | メモ大量 / 論理再構成が重い時 |

- **両経路とも Vercel AI SDK `generateObject` に統一**する。
  DeepSeek を `src/lib/ai-client.ts`（手書きfetch・本番無効フラグ付き）には載せない。
  構造化出力を型安全に扱うため公式プロバイダ `@ai-sdk/deepseek` を使う。
- `src/lib/ai/providers/index.ts` に `getModelForMemoMindmap(mode)` を追加。
- 環境変数: `GEMINI_MODEL=gemini-3.1-flash-lite`、新規 `DEEPSEEK_API_KEY`。
- 注意: `ai-client.ts` の `ALLOW_EXTERNAL_AI_IN_PRODUCTION` は別経路のフラグ。
  本機能の DeepSeek は意図した課金機能なので `DEEPSEEK_API_KEY` の有無で制御する。

**原価試算**（メモ20件・1回あたり）: Gemini Flash-Lite ≈ $0.004 / DeepSeek ≈ $0.001。
API原価は無視できる水準。課金は原価回収ではなく価値設計（§9）。

### 6.2 出力スキーマ（フラット構造）

再帰スキーマ（`z.lazy`）は Gemini の構造化出力で不安定なため、
**フラット配列 + 親参照**で表現する。

```ts
const MindmapDraftSchema = z.object({
  projectTitle: z.string().describe('マインドマップ全体のタイトル'),
  nodes: z.array(z.object({
    tempId: z.string().describe('一時ID（"n1","n2"...）'),
    title: z.string().describe('ノード見出し。簡潔に'),
    parentTempId: z.string().nullable().describe('親ノードのtempId。ルートはnull'),
    sourceNoteIds: z.array(z.string()).describe('根拠になったメモID（複数可）'),
  })),
})
type MindmapDraft = z.infer<typeof MindmapDraftSchema>
```

`sourceNoteIds` により「どのメモがどのノードになったか」を追跡でき、
プレビューでの根拠表示・確定時の `notes.task_id` 紐付けに使う。

### 6.3 システムプロンプト（要点）

- 役割: 散らばったメモを MECE に近いロジックツリーへ再編する編集者。
- ルール: ①メモ原文を尊重し勝手な事実を足さない ②階層は3〜4段に収める
  ③似た主旨のメモは同じ枝にまとめる ④抽象→具体の順に親子付け
  ⑤全 `noteIds` をいずれかのノードの `sourceNoteIds` に必ず割り当てる。
- 既存マップへ追記（`targetProjectId` あり）時は、既存ツリーテキストを与え
  「既存の枝に接続するか新規ルートを作るか」を判断させる。

---

## 7. UI 設計

- **入口**: `memo-view` に複数選択モードを追加 → 選択中フッターに「マインドマップ化」。
- **プレビュー**: ReactFlow を流用し、生成ノードを**破線枠 + 淡色**（仮ノード）で表示。
  - 操作: タイトル編集 / ノード削除 / 親の付け替え（既存D&D流用）。
  - 各ノードに「根拠メモ」を表示（`sourceNoteIds`）。
- **確定**: 「新規プロジェクトとして作成」または「既存マップに追加」を選択 → commit。
- **モバイルファースト**: プレビューは全画面、確定/破棄の2ボタンを下部固定。
- `mode` 切替（quick / deep）は控えめなトグル。既定は quick。

---

## 8. 実装フェーズ

| Phase | 内容 | 完了条件 |
|---|---|---|
| 1-A | `ai_usage` テーブル + マイグレーション | 記録が入る |
| 1-B | `@ai-sdk/deepseek` 追加・`getModelForMemoMindmap()` | quick/deep でモデルが切り替わる |
| 1-C | `POST /api/ai/memo-to-mindmap`（プレビュー生成） | draft が返る・usage 記録 |
| 1-D | `POST /api/ai/memo-to-mindmap/commit`（確定） | tasks に保存・notes 紐付け |
| 1-E | memo-view 複数選択 + プレビューUI（仮ノード描画・編集） | 選択→生成→編集→確定が1フロー |

---

## 9. 将来拡張：課金と「自動化パッケージ」

> **本セクションは方向性メモ。別途仕様書化が必要。本Phaseでは実装しない。**

### 9.1 課金の土台（メモ→マインドマップ側）

- 課金単位は**アクション回数ベース**（例: 月N回まで無料、以降有料）。
- `ai_usage`（§4.2）が計測の土台。プラン上限テーブル・Stripe・上限チェック
  ミドルウェアは、本機能が安定稼働しデータが溜まってから設計する。

### 9.2 自動化パッケージ構想（要・別仕様）

「Playwright / GWS / 認証が最初から揃い、AIに指示すれば自動化が組め、
スケジュール実行できるパッケージ」を有料の中核にする構想。
既存の `ai_packages` / `ai-runners` / `task-runner` / scheduled-tasks が土台になり得る。

**ただし、課金商品化の前に解かねばならない構造的課題が3つある（フラットな指摘）:**

1. **実行ランナー問題**: 現状の自動化は本人のMac上で `claude -p` 実行（Max契約・原価0）。
   他ユーザーに課金して提供するなら本人のMacでは動かせず、**クラウドランナー
   （Cloud Run Jobs 等）が必須**。これがインフラコストと複雑性の本丸。
2. **AIによる自動化生成は高コスト・高難度**: Playwrightスクリプト生成は
   ハード推論のコーディングで、安価モデルは壊れやすいスクリプトを出す。
   「言ったら全部できてる」ではなく現実は**「AIが下書き→ユーザーが検証」**。
   期待値の設計が必要。
3. **認証情報の預かりは重大なセキュリティ・コンプラ面**: pivot計画書は
   「認証情報はMac上のみ・Webには置かない」を原則にしている。
   ホスト型自動化はこの原則と**正面から矛盾**する。設計の前に方針判断が要る。

→ メモ→マインドマップ（本Phase）と自動化パッケージは**別プロダクト**として扱い、
本仕様書を肥大化させない。自動化パッケージは上記3課題への回答を含む
独立した仕様書で検討する。

---

## 10. リスクと対策

| リスク | 対策 |
|---|---|
| Gemini が再帰スキーマで崩れる | フラット配列 + 親参照（§6.2）で回避 |
| LLM が一部メモを取りこぼす | 全 `noteIds` の割当を必須化・commit前にプレビューで検証 |
| 大量メモでコンテキスト超過 | 1Mコンテキストモデル使用。さらに超える場合は事前にメモ要約 |
| 確定時の部分失敗（途中までinsert） | commit をトランザクション化、失敗時ロールバック |
| DeepSeek 障害時 | quick（Gemini）へフォールバック |
