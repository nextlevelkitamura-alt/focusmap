---
feature: 習慣機能改善（日次完了リセット・TODOビュー統合・週間達成率UI）
type: feature
method: impl
created: 2026-02-21
status: planning
---

# 設計プラン: 習慣機能改善

## 要件

### 1. 子タスクの日次完了リセット
- 習慣の子タスク（腕立て、腹筋など）の完了状態を **日付ごとに管理**
- 翌日になると自動的にチェックが外れる（リセット）
- 既存の `tasks.status` はそのまま維持（通常タスクとの互換性）

### 2. 今日ビュー: ハイブリッド習慣表示
- **通常時**: 現在の横スクロールバーを維持（1行コンパクト表示）
- **展開時**: ▼ボタンで展開 → カード形式の縦並びリスト
  - 各習慣カード: アイコン + タイトル + 子タスク進捗 + ストリーク
  - 子タスクチェックボックス表示
  - 全体の達成率プログレスバー
- **折りたたみ**: ▲ボタンで横スクロールに戻る

### 3. 週間ビュー: ヒートマップグリッド
- 縦軸 = 習慣、横軸 = 曜日（月〜日）のグリッド
- 各セルの色が達成率を表す（GitHub コントリビューショングラフ風）
  - 0%: グレー
  - 1-49%: 薄い緑
  - 50-99%: 中間の緑
  - 100%: 濃い緑
- 達成率 = 完了した子タスク数 / 全子タスク数（子タスクなし習慣は完了/未完了の2値）

## リスク評価

| リスク | レベル | 対策 |
|--------|--------|------|
| DBマイグレーション | MEDIUM | 新テーブル追加のみ（既存テーブルは変更なし） |
| パフォーマンス | LOW | 日付範囲でクエリするため、インデックスを追加 |
| 既存テストへの影響 | LOW | 新テーブル・新ロジックのため既存テストに影響なし |
| UI変更の影響範囲 | MEDIUM | today-view.tsx と habits-view.tsx のみ変更 |

## 依存関係

- 既存の `habit_completions` テーブル（習慣全体の完了管理）
- 既存の `useHabits` Hook
- 既存の `today-view.tsx`（習慣バー部分）
- 既存の `habits-view.tsx`（週間ビュー部分）
- 外部ライブラリ追加: なし

## 実装フェーズ

### Phase 1: DB基盤 + API（子タスク日次完了）
- [ ] `habit_task_completions` テーブル作成（マイグレーションSQL）
  - `id` UUID PRIMARY KEY
  - `habit_id` UUID REFERENCES tasks(id) ON DELETE CASCADE
  - `task_id` UUID REFERENCES tasks(id) ON DELETE CASCADE
  - `user_id` UUID REFERENCES auth.users(id)
  - `completed_date` DATE NOT NULL
  - `created_at` TIMESTAMPTZ DEFAULT now()
  - UNIQUE(task_id, completed_date)
  - INDEX(habit_id, completed_date)
  - INDEX(user_id, completed_date)
  - RLS: ユーザー自身のレコードのみ操作可能
- [ ] 型定義追加（`src/types/database.ts`）
- [ ] API追加: `POST /api/habits/task-completions` → 子タスク完了を記録
- [ ] API追加: `DELETE /api/habits/task-completions` → 子タスク完了を取消
- [ ] API追加: `GET /api/habits/task-completions?from=&to=` → 期間内の完了記録取得

### Phase 2: Hook拡張 + 今日ビューの日次リセット
- [ ] `useHabits` Hook に子タスク完了の日付管理ロジックを追加
  - `toggleChildTaskCompletion(habitId, taskId, date)` を追加
  - `isChildTaskCompletedToday(habitId, taskId)` を追加
  - 既存の `updateChildTaskStatus` は互換性のため維持
- [ ] 今日ビューの子タスクチェックボックスを日次リセット対応に変更
  - チェック → `habit_task_completions` に今日の日付で記録
  - チェック解除 → 今日の記録を削除
  - 翌日は自動的に未チェック（レコードがないため）
- [ ] 全子タスク完了時の自動習慣完了も日次対応に更新

### Phase 3: 今日ビュー - ハイブリッド習慣表示
- [ ] 展開/折りたたみトグルボタン（▼/▲）追加
- [ ] 展開時のカード形式UI
  - 全体達成率プログレスバー
  - 各習慣カード（アイコン + タイトル + 進捗 + ストリーク）
  - 子タスクチェックボックス（Phase 2の日次完了と連動）
- [ ] 折りたたみ時は現在の横スクロールバーをそのまま使用
- [ ] 展開状態のローカルステート管理（リロードでリセットOK）

### Phase 4: 週間ビュー - ヒートマップグリッド
- [ ] 週間データ取得ロジック（今週の月〜日の完了記録を取得）
- [ ] ヒートマップグリッドUI
  - 縦軸: 習慣名（アイコン + タイトル）
  - 横軸: 曜日（月 火 水 木 金 土 日）
  - セル: 達成率に応じた色分け（4段階グラデーション）
- [ ] 週の切り替え（前週/次週ナビゲーション）
- [ ] 習慣ビュー（habits-view.tsx）に統合

## 実装対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `supabase/migrations/` | 新規マイグレーションSQL |
| `src/types/database.ts` | HabitTaskCompletion 型追加 |
| `src/app/api/habits/task-completions/route.ts` | 新規API |
| `src/hooks/useHabits.ts` | 子タスク日次完了ロジック追加 |
| `src/components/today/today-view.tsx` | ハイブリッド習慣表示 |
| `src/components/habits/habits-view.tsx` | ヒートマップグリッド追加 |

## 推奨実装方式

→ `/impl`（UIメインの変更 + DB追加。テスト既存分は維持）

Phase 1 → 2 → 3 → 4 の順で段階的に実装。各Phase完了後に動作確認。
