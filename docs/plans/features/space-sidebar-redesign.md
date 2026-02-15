---
feature: スペース機能 + 左サイドバー再設計
type: feature
method: impl
created: 2026-02-16
status: planning
---

# 設計プラン: スペース機能 + 左サイドバー再設計

## 目標

「Goal」を廃止し、**Space（スペース）** を最上位概念として導入。
人生の領域（Private / 会社 / 副業など）ごとにプロジェクトを整理できるようにする。

## 概要

### 階層構造
```
Space（Private, 株式会社ネクストレベル, ...）
  └── Project（shikumika 開発, マーケティング, ...）
        └── Group → Task（既存のマインドマップ構造）
```

### 左サイドバーの構成
```
┌─────────────────────────┐
│ [全体] [Private] [会社▼] │  ← スペースタブ（横スクロール）
├─────────────────────────┤
│ 実行 (Active)        +  │  ← セクション + 新規作成
│ ┌─────────────────────┐ │
│ │ ● shikumika 開発    │ │  ← プロジェクトカード
│ │   ○ ステータス       │ │
│ └─────────────────────┘ │
│ ┌─────────────────────┐ │
│ │ ● マーケティング     │ │
│ └─────────────────────┘ │
│                         │
│ 構想 (Concept)       +  │
│ ┌─────────────────────┐ │
│ │ ○ 新サービスA        │ │
│ └─────────────────────┘ │
│                         │
│ ▶ アーカイブ (2)        │  ← 折りたたみ、D&Dで移動
│                         │
│ ─── ─── ─── ─── ─── ── │
│ ⚙ スペース設定          │  ← カレンダー紐付け等
└─────────────────────────┘
```

## DB設計

### 1. `goals` テーブル → `spaces` テーブルにリネーム

```sql
-- goals テーブルを spaces にリネーム
ALTER TABLE goals RENAME TO spaces;

-- カレンダー紐付け用カラムを追加
ALTER TABLE spaces ADD COLUMN default_calendar_id TEXT;
-- → google_calendar_id 形式（例: "nextlevel.kitamura@gmail.com"）

-- アイコン/カラー用カラム（将来拡張）
ALTER TABLE spaces ADD COLUMN icon TEXT;
ALTER TABLE spaces ADD COLUMN color TEXT;
```

### 2. `projects` テーブルの FK 変更

```sql
-- goal_id → space_id にリネーム
ALTER TABLE projects RENAME COLUMN goal_id TO space_id;
```

### 3. 型定義の更新

```typescript
// src/types/database.ts
interface Space {
  id: string
  user_id: string
  title: string
  default_calendar_id: string | null  // Google Calendar ID
  icon: string | null
  color: string | null
  created_at: string
  updated_at: string
}

interface Project {
  // goal_id → space_id
  space_id: string
  // ...既存フィールド
}
```

## 機能詳細

### A. スペース管理

| 操作 | UI | 挙動 |
|------|-----|------|
| スペース切替 | タブクリック | プロジェクト一覧をフィルタリング |
| 「全体」タブ | 左端の固定タブ | 全スペースのプロジェクトを表示 |
| スペース作成 | タブ右端の「+」ボタン | インライン or ダイアログで名前入力 |
| スペース編集 | タブ右クリック or 長押し | 名前変更・カレンダー設定・削除 |
| スペース削除 | コンテキストメニュー | 確認ダイアログ → 配下プロジェクトも削除 |

### B. プロジェクトCRUD

| 操作 | UI | 挙動 |
|------|-----|------|
| 新規作成 | セクションの `+` ボタン | インライン入力 → ステータスは追加先セクション準拠 |
| 名前変更 | ダブルクリック or メニュー | インライン編集 |
| ステータス変更 | D&Dでセクション間移動 | active ↔ concept ↔ archived |
| 削除 | コンテキストメニュー | 確認ダイアログ → CASCADE削除 |
| 選択 | クリック | 中央ペインのマインドマップが切り替わる |

### C. カレンダー紐付け（スペース単位）

| 操作 | 挙動 |
|------|------|
| スペースにカレンダーを設定 | スペース設定 → Googleカレンダー選択 |
| 他スペースで連携済みのカレンダー | 「連携済み」バッジ付きで一覧表示、ワンタッチで選択 |
| タスク作成時のデフォルト | スペースのカレンダーがタスクのデフォルトcalendar_idになる |

### D. 「全体」ビュー

- 全スペースのプロジェクトをフラットに表示
- 各プロジェクトにスペース名のラベル表示
- プロジェクト作成時はスペース選択が必要

## 実装フェーズ

### Phase 1: DB移行 + 型定義（基盤）
- [ ] Supabase で goals → spaces リネーム + カラム追加
- [ ] `src/types/database.ts` の型を更新（Goal → Space）
- [ ] 既存コードの `goal_id` → `space_id` 一括置換
- [ ] `dashboard-client.tsx` の state 名を更新

### Phase 2: 左サイドバーUI再構築
- [ ] スペースタブ UI（横並び + スクロール + 「全体」タブ）
- [ ] プロジェクト一覧（Active / Concept / Archive セクション）
- [ ] セクション折りたたみ
- [ ] 空状態の表示

### Phase 3: プロジェクトCRUD
- [ ] API: POST/PATCH/DELETE `/api/projects`
- [ ] プロジェクト新規作成（インライン入力）
- [ ] コンテキストメニュー（名前変更・ステータス変更・削除）
- [ ] ステータス変更のD&D

### Phase 4: スペースCRUD
- [ ] API: POST/PATCH/DELETE `/api/spaces`
- [ ] スペース作成（タブ右端の + ボタン）
- [ ] スペース編集・削除（タブのコンテキストメニュー）

### Phase 5: カレンダー紐付け
- [ ] スペース設定UI（カレンダー選択）
- [ ] 他スペースの連携済みカレンダー表示
- [ ] タスク作成時のデフォルトカレンダー適用

## 実装対象ファイル

| ファイル | 変更内容 |
|---|---|
| `src/types/database.ts` | Goal → Space 型変更、Project の space_id |
| `src/components/dashboard/left-sidebar.tsx` | 全面書き直し |
| `src/app/dashboard/dashboard-client.tsx` | state名変更、Space対応 |
| `src/app/dashboard/page.tsx` | データフェッチのテーブル名変更 |
| `src/app/api/projects/route.ts` | **新規** プロジェクトCRUD |
| `src/app/api/projects/[id]/route.ts` | **新規** プロジェクト個別操作 |
| `src/app/api/spaces/route.ts` | **新規** スペースCRUD |
| `src/app/api/spaces/[id]/route.ts` | **新規** スペース個別操作 |
| `src/hooks/useMindMapSync.ts` | goal_id → space_id 参照変更 |

## リスク評価

| リスク | レベル | 対策 |
|--------|--------|------|
| DB移行（goals → spaces） | MEDIUM | Supabase ダッシュボードで直接ALTER、バックアップ取得後に実行 |
| 既存コードの goal_id 参照 | LOW | grep で一括検索・置換 |
| カレンダー紐付けの複雑さ | MEDIUM | Phase 5 に分離、他が完了してから着手 |

## 推奨実装方式
→ /impl（Phase 1-2 から順に）
