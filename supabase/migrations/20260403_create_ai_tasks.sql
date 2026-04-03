-- ai_tasks: AIタスクキュー
-- Focusmapの壁打ち・スキル実行・AI指示をすべてこのテーブルで管理
CREATE TABLE ai_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    skill_id TEXT,
    approval_type TEXT NOT NULL DEFAULT 'auto'
        CHECK (approval_type IN ('auto', 'confirm', 'interactive')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'awaiting_approval', 'needs_input', 'completed', 'failed')),
    result JSONB,
    error TEXT,
    parent_task_id UUID REFERENCES ai_tasks(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_tasks_user_status ON ai_tasks (user_id, status);
CREATE INDEX idx_ai_tasks_user_created ON ai_tasks (user_id, created_at DESC);

ALTER TABLE ai_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_ai_tasks" ON ai_tasks FOR ALL USING (auth.uid() = user_id);

-- Realtimeを有効にする（Supabaseダッシュボードでも設定必要）
ALTER PUBLICATION supabase_realtime ADD TABLE ai_tasks;
