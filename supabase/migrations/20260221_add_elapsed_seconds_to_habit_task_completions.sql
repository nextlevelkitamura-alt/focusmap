-- habit_task_completions に日別タイマー記録用の elapsed_seconds カラムを追加
ALTER TABLE habit_task_completions
  ADD COLUMN IF NOT EXISTS elapsed_seconds INTEGER NOT NULL DEFAULT 0;

-- UPDATE ポリシーを追加（タイマー停止時に elapsed_seconds を更新するため）
CREATE POLICY "Users can update own habit task completions"
    ON habit_task_completions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- タイマー用の加算upsert RPC関数
CREATE OR REPLACE FUNCTION upsert_habit_timer(
    p_habit_id UUID,
    p_task_id UUID,
    p_user_id UUID,
    p_completed_date DATE,
    p_add_seconds INTEGER
) RETURNS void AS $$
BEGIN
    INSERT INTO habit_task_completions (habit_id, task_id, user_id, completed_date, elapsed_seconds)
    VALUES (p_habit_id, p_task_id, p_user_id, p_completed_date, p_add_seconds)
    ON CONFLICT (task_id, completed_date)
    DO UPDATE SET elapsed_seconds = habit_task_completions.elapsed_seconds + p_add_seconds;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
