# プロジェクトコンテキスト簡素化 — 仕様書

> **ステータス**: Draft
> **作成日**: 2026-05-21
> **関連**: [memo-to-mindmap.md](memo-to-mindmap.md), [ai-context-folder-management.md](ai-context-folder-management.md)（プロジェクト部分は本仕様で置き換え）

---

## 1. 背景と課題

マインドマップはプロジェクト単位で作られる。メモを適切なプロジェクトに振り分けるには、
AIが「各プロジェクトが何なのか」を理解している必要がある。しかし現状、プロジェクトの
コンテキストは **3系統に分散** しており、過剰に細分化されていて分かりにくい。

| 系統 | 実体 | 内容 |
|---|---|---|
| ① `ai_project_context` テーブル | 1プロジェクト1行 | `purpose` / `current_status` / `key_insights` の3項目 |
| ② `ai_context_folders` + `ai_context_documents` | プロジェクトごとにフォルダ+3ドキュメント | 「プロジェクト目的」「現状・進捗」「重要な決定」（各500字） |
| ③ `projects.purpose` カラム | プロジェクト行の1カラム | ほぼ未使用 |

同じ「プロジェクトの説明」が3か所・最大7項目に散らばっている。
ユーザーが書く場所が多すぎ、AIが読む場所も曖昧。

### 目指す姿
プロジェクトのコンテキストは **「このプロジェクトは何か」を表す1フィールド** に集約する。
ユーザーはチャットで説明を伝えるだけでよく、それが自動でそのフィールドに反映される。

---

## 2. 設計方針

1. **コンテキストは `projects.description` の1フィールドに集約**する（後述の通り2フィールド目は持たない）。
2. ユーザーは **プロジェクト説明チャット** で説明を伝える。AIが対話内容を `description` にまとめる。
3. AIがプロジェクトを理解する時・メモを振り分ける時は、この `description` だけを読む。
4. 既存の3系統（①②のプロジェクト部分・③）は `description` に移行して廃止する。
5. 「細分化しない」が本仕様の主旨。**仕様自体もミニマルに保つ**。

---

## 3. データモデル

### 3.1 `projects` テーブル

```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
```

- `description`: プロジェクトの説明。「何のプロジェクトか・目的・対象・現状のざっくり」を
  自由文で1つにまとめる。AIが読む唯一のプロジェクトコンテキスト。
- 目安は600字程度（厳格な制限はしない。長くなったらチャットでAIが要約・圧縮する）。
- 既存の `projects.purpose` は `description` に統合し、以後使わない（カラムは残置、参照しない）。

**2フィールド目は持たない。** 「目的」「現状」「重要点」のような小分けが現状の混乱の原因のため、
あえて単一フィールドにする。粒度の違いは `description` 内の文章で表現すれば足りる。

### 3.2 廃止するもの

| 対象 | 扱い |
|---|---|
| `ai_project_context` テーブル | プロジェクトコンテキストを `description` へ移行後、参照を停止。テーブルは移行完了後に削除 |
| `ai_context_documents` の `project_purpose` / `project_status` / `project_insights` | 同上。3ドキュメントの内容を `description` へ集約 |
| `ai_context_folders` の `folder_type='project'` フォルダ | プロジェクト用フォルダは作成しない（`createProjectContextFolder` を廃止） |

> **スコープ外**: `ai_context_folders` / `ai_context_documents` の **ユーザーレベル**コンテキスト
> （`personality` / `purpose` / `situation` 等）は本仕様の対象外。プロジェクト部分のみ簡素化する。

---

## 4. プロジェクト説明チャット

「プロジェクトを説明する」をチャットUIで行い、結果が `description` に取り込まれる。

### 4.1 体験

```
プロジェクト画面 →「説明を追加・編集」
  ↓
チャットパネルが開く
  ├─ ユーザー: 「これは個人開発のアプリで、メモを整理するツール」
  ├─ AI: 取り込みました。（description が更新される）
  ├─ ユーザー: 「ターゲットは黒い画面が苦手な非エンジニア」
  └─ AI: 取り込みました。（description に追記・統合）
  ↓
画面上部に description が常時表示され、リアルタイムに育つ。直接手編集も可。
```

### 4.2 仕組み（インクリメンタル統合）

- 1ターンごとに、AIが「現在の `description` + ユーザーの新発言」を受け取り、
  **統合した新しい `description` を返す**（丸ごと置き換え。重複は除き、矛盾は新情報優先）。
- フロントは返ってきた `description` を表示・保存。ユーザーはいつでも手編集できる。
- モデル: Gemini Flash-Lite（`getModelForSkill` 既存基盤）。`generateObject` で
  `{ description: string }` を構造化出力。
- 使用量は `ai_usage`（feature=`project_context_chat`）に記録。
- チャット履歴の永続化は任意。Phase 1 は保存しない（`description` だけが成果物）。

### 4.3 API

```
POST /api/projects/[id]/context-chat
  body: { message: string }
  → { description: string }   // 統合後の全文。フロントが projects.description を更新
```

---

## 5. メモのプロジェクト振り分けへの利用

本簡素化の目的はここに繋がる。メモを整理する時、AIは各プロジェクトの `description` を
読んで「どのプロジェクトのメモか」を判断できる。

### 5.1 「プロジェクトを分ける」= プロジェクト間の振り分け

[memo-to-mindmap.md](memo-to-mindmap.md) の前段に **分類ステップ** を追加する（次フェーズ実装）:

```
選択メモ + 全プロジェクトの description
  ↓ LLM分類
{ 既存プロジェクトA: [memo...], 既存プロジェクトB: [memo...], 新規: [memo...] }
  ↓ グループごとに
memo-to-mindmap（既存）でツリー化
```

新規プロジェクトと判定されたグループは、作成時に description のドラフトもAIが提案し、
ユーザーは §4 のチャットで育てられる。

### 5.2 「小プロジェクトを分ける」= プロジェクト内の枝分け

**小プロジェクト＝マインドマップ内のトップレベルのグループノード**（`tasks.is_group`）と定義する。
memo-to-mindmap は既にメモをグループノードへ階層化しており、プロジェクト内の細分は
このツリー構造で表現済み。**`parent_project_id` のようなサブプロジェクト用エンティティは追加しない。**

> **要確認**: 「小プロジェクト」を、マインドマップの枝ではなく独立した子プロジェクト
> （別マインドマップを持つ）にしたい場合は、`projects` への `parent_project_id` 追加が必要になり
> 構造が増える。本仕様は「増やさない」前提で枝＝小プロジェクトとした。意図と違えば指摘されたい。

---

## 6. 既存データ移行

各プロジェクトについて、散在する情報を1つの `description` へ集約する:

1. `ai_project_context` の `purpose` / `current_status` / `key_insights` を連結。
2. `ai_context_documents` のプロジェクト3ドキュメントの `content` を連結。
3. `projects.purpose` があれば連結。
4. 連結結果が長い場合は LLM（Flash-Lite）で1段落に要約し `projects.description` へ保存。
5. 移行完了を確認後、`ai_project_context` テーブルと project系フォルダ/ドキュメントを削除。

移行は一度きりのスクリプト（`scripts/` に配置）で実行。

---

## 7. AIプロンプトへの注入の変更

| 現状 | 変更後 |
|---|---|
| `loadAllProjectContexts()`（`ai_project_context` を読む） | `projects` から `id, title, description` を読む関数に置換 |
| `formatProjectContextsForPrompt()`（3項目を整形） | `**プロジェクト名**: description` の1行形式に簡素化 |
| `createProjectContextFolder()`（フォルダ+3ドキュメント作成） | 廃止。memo-to-mindmap/commit の呼び出しも削除 |

---

## 8. 実装フェーズ

| Phase | 内容 |
|---|---|
| 1 | `projects.description` 追加（マイグレーション）+ 既存データ移行スクリプト |
| 2 | プロンプト注入の置換（`loadAllProjectContexts` / `formatProjectContextsForPrompt`）+ `createProjectContextFolder` 呼び出し削除 |
| 3 | プロジェクト説明チャット API + UI |
| 4 | メモのプロジェクト分類ステップ（memo-to-mindmap に前段追加） |
| 5 | 旧テーブル（`ai_project_context` 等）削除 |

---

## 9. リスク

| リスク | 対策 |
|---|---|
| 移行で既存コンテキストが失われる | 削除は移行確認後。元テーブルはしばらく残置してから削除 |
| 1フィールドが肥大化して読みにくくなる | チャット統合時にAIが要約・圧縮。手編集も可能 |
| ユーザーレベルコンテキスト機能への波及 | 本仕様はプロジェクト部分のみ。フォルダ系のユーザー部分は触らない |
| description 未記入のプロジェクトが分類精度を下げる | 未記入時はプロジェクト名で代替。チャットでの記入を促すUI |
