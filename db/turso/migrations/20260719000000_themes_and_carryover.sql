-- 子09「大課題テーマ階層と横断表示」: themes（大課題テーマ）+ todos/todo_steps へのadditive列
-- 対象DB: personal-os-inbox（PERSONAL_OS_INBOX_DATABASE_URL）。todos/todo_steps は
--   20260717000000_todos_and_repos.sql / 20260718100000_todo_steps_and_questions.sql で新設済み。
-- 適用方法（本番適用は人間ゲート）: turso db shell personal-os-inbox < このファイル
-- 注意: ALTER TABLE ADD COLUMN は再実行すると duplicate column エラーになる（1回だけ流す）。
--
-- 正本境界（program.md 正本境界・2026-07-19人間採用）:
--   themes は inbox DB の運用データ正本（todos と同格・ボード編集可）。
--   的・計画へは goal_ref / plan_refs の参照slugだけを持ち、本文コピー・進捗の重複描画をしない。
--   purpose / done_criteria は DBは nullable だが、AI起点の作成・紐付けでは board.py theme-add が
--   欠落でusage停止＝機械必須化（DB制約では縛らない）。人間のボード即席作成は空可（未記入バッジ表示）。

PRAGMA foreign_keys = ON;

-- 大課題テーマ。今日のタスクをテーマ配下に位置づけるための軽い運用データ。
CREATE TABLE IF NOT EXISTS themes (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  purpose       TEXT,                                  -- 目的（nullable・AI起点は必須）
  done_criteria TEXT,                                  -- 完了条件「これがこうなったら完了」（nullable・AI起点は必須）
  goal_ref      TEXT,                                  -- 的slug参照（本文コピーはしない）
  plan_refs     TEXT,                                  -- 計画slug参照のJSON配列（子07計画タブへのリンク元）
  sort_order    INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_themes_status ON themes(status, sort_order);

-- todos をテーマ配下に置く参照列（nullable=未分類）。破壊的変更はせずカラム追加のみ。
ALTER TABLE todos ADD COLUMN theme_id TEXT;             -- 所属テーマ（NULL=未分類）
ALTER TABLE todos ADD COLUMN carried_from TEXT;         -- 繰越し元do_date（初回のみ記録・「昨日から」表示）
ALTER TABLE todos ADD COLUMN awaiting_since TEXT;       -- 確認待ち開始時刻（時間表示のSQL導出用・時刻の保存であって主観値ではない）

CREATE INDEX IF NOT EXISTS idx_todos_theme ON todos(theme_id);

-- ステップの doing 遷移時刻（所要・経過分のSQL導出用の時刻。主観値ではない）。
ALTER TABLE todo_steps ADD COLUMN started_at TEXT;
