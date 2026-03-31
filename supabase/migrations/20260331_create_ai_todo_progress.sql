-- AI Todo Progress: Claude Code セッションのタスク進捗を追跡
CREATE TABLE ai_todo_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    task_title TEXT NOT NULL,
    task_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (task_status IN ('pending', 'in_progress', 'completed')),
    task_tag TEXT,
    scheduled_time TEXT,
    source TEXT NOT NULL DEFAULT 'claude_code'
        CHECK (source IN ('claude_code', 'schedule_md')),
    completed_at TIMESTAMPTZ,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_todo_user_date ON ai_todo_progress (user_id, session_date);
ALTER TABLE ai_todo_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_ai_todos" ON ai_todo_progress FOR ALL USING (auth.uid() = user_id);

-- AI Dashboard Snapshot: パイプライン + KPI の日次スナップショット
CREATE TABLE ai_dashboard_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    pipeline_summary JSONB,
    kpi_summary JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, snapshot_date)
);

ALTER TABLE ai_dashboard_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_snapshot" ON ai_dashboard_snapshot FOR ALL USING (auth.uid() = user_id);
