-- 子02「計画接続」: todos に計画リンク列 plan_slug を1本追加する。
-- 対象DB: personal-os-inbox（PERSONAL_OS_INBOX_DATABASE_URL）。todos は
--   20260717000000_todos_and_repos.sql で新設済み。ここは additive 列追加のみ（破壊的変更なし）。
-- 適用方法（本番適用は人間ゲート）: turso db shell personal-os-inbox < このファイル
-- 注意: ALTER TABLE ADD COLUMN は再実行すると duplicate column エラーになる（1回だけ流す・再実行不可）。
--
-- 正本境界（program.md 正本境界4条・2026-07-21）:
--   計画リンクは path でなく slug（例 '2026-07-17-当日ボードSQL化#03'）で持つ＝バケット移動・改名で切れない。
--   plan_slug は計画（program子/単発）への参照であって本文コピーではない。解決可否は UI 側の解決lintで検証し、
--   解決不能な slug はグレー非リンク表示にして沈黙故障させない。started_at 列は子09の
--   20260719000000_themes_and_carryover.sql で todo_steps へ追加済み＝ここでは追加しない（重複追加はエラー）。

PRAGMA foreign_keys = ON;

-- 計画slug参照（NULL=計画に紐づかない単発/routine todo）。slug#NN 形式（program子）または slug（単発）。
ALTER TABLE todos ADD COLUMN plan_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_todos_plan_slug ON todos(plan_slug);
