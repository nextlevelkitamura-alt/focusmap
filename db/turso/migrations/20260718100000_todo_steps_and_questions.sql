-- 子05「タスク入れ子と2層チェック」: todo_steps（計画ステップの入れ子）+ todos質問/経路カラム
-- 対象DB: personal-os-inbox（PERSONAL_OS_INBOX_DATABASE_URL）。todos は 20260717000000_todos_and_repos.sql で新設済み。
-- 適用方法（本番適用は人間ゲート）: turso db shell personal-os-inbox < このファイル
-- 注意: ALTER TABLE ADD COLUMN は再実行すると duplicate column エラーになる（1回だけ流す）。
--
-- 設計正本: plans/active/2026-07-17-当日ボードSQL化/explain/ボード入れ子と進捗率の提案.html
--   - %と「レビュー待ち」はSQL導出のみ（主観値を保存しない）→ 進捗値カラムは持たない
--   - ai_status既存語彙は削除せず据え置き（migration軽量）
--   - 過去ステップ行は書き換えず、手直し/レビューは kind='fix'/'review' の追記行で表す

PRAGMA foreign_keys = ON;

-- 段階1: 計画ステップの入れ子。1 todo = N steps。seq は todo 内で一意。
CREATE TABLE IF NOT EXISTS todo_steps (
  id TEXT PRIMARY KEY,
  todo_id TEXT NOT NULL REFERENCES todos(id),
  seq INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'step' CHECK (kind IN ('step', 'review', 'fix')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'skipped')),
  -- どの稼働セッションが登録/完了したか（board DBの sessions.session_key を任意で記録）
  session_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at TEXT,
  UNIQUE (todo_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_todo_steps_todo ON todo_steps(todo_id);
CREATE INDEX IF NOT EXISTS idx_todo_steps_status ON todo_steps(status);

-- 段階4: AIの質問（質問文＋選択肢最大3＋自由入力可否）と人間のスマホ回答。
-- 「レビュー待ち」はSQL導出だが、「質問」だけは保存する（設計裁定Q1）。
ALTER TABLE todos ADD COLUMN question TEXT;                              -- 質問文（NULL=質問なし）
ALTER TABLE todos ADD COLUMN question_choices TEXT;                     -- JSON配列（最大3・NULL可）
ALTER TABLE todos ADD COLUMN question_allow_free INTEGER NOT NULL DEFAULT 1; -- 自由入力可否（1=可）
ALTER TABLE todos ADD COLUMN question_gate INTEGER NOT NULL DEFAULT 0;  -- 1=人間ゲート承認（回答UIを描画せずセッション誘導のみ）
ALTER TABLE todos ADD COLUMN question_asked_at TEXT;                    -- 質問時刻（NULL=質問なし）
ALTER TABLE todos ADD COLUMN answer TEXT;                               -- 人間の回答（NULL=未回答）
ALTER TABLE todos ADD COLUMN answered_at TEXT;                          -- 回答時刻
ALTER TABLE todos ADD COLUMN answer_consumed_at TEXT;                   -- セッションが回答を消費した時刻（NULL=未消費）

-- 段階5: 3経路。plan=見出しを人間チェック / routine=board_route宣言済みで自動完了 / single=単発ログ直行。
-- 既定は plan（安全側）。routine への遷移は flow-done が宣言照合を通した時だけ行う。
ALTER TABLE todos ADD COLUMN route TEXT NOT NULL DEFAULT 'plan' CHECK (route IN ('plan', 'routine', 'single'));

-- 段階2/3: 完了の主体（human=見出しタップ / routine=定型自動）。undo で NULL へ戻す。
ALTER TABLE todos ADD COLUMN completed_by TEXT;                         -- 'human' | 'routine' | NULL
