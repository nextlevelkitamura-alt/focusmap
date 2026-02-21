-- 習慣の子タスク日次完了記録テーブル
-- 子タスクの完了状態を日付ごとに管理し、翌日にリセットする機能のための基盤

CREATE TABLE IF NOT EXISTS habit_task_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    habit_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    completed_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(task_id, completed_date)
);

-- Indexes for efficient querying
CREATE INDEX idx_habit_task_completions_habit_date ON habit_task_completions(habit_id, completed_date);
CREATE INDEX idx_habit_task_completions_user_date ON habit_task_completions(user_id, completed_date);

-- RLS: Enable and set policies
ALTER TABLE habit_task_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own habit task completions"
    ON habit_task_completions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own habit task completions"
    ON habit_task_completions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own habit task completions"
    ON habit_task_completions FOR DELETE
    USING (auth.uid() = user_id);
