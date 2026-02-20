-- Add stage column to tasks table for explicit lifecycle management
-- stage: 'plan' | 'scheduled' | 'executing' | 'done' | 'archived'

ALTER TABLE tasks ADD COLUMN stage text NOT NULL DEFAULT 'plan';

-- Migrate existing data based on current implicit lifecycle
UPDATE tasks SET stage = CASE
  WHEN status = 'done' THEN 'done'
  WHEN is_timer_running = true THEN 'executing'
  WHEN scheduled_at IS NOT NULL THEN 'scheduled'
  ELSE 'plan'
END;

-- Index for calendar/today view queries (scheduled + executing tasks)
CREATE INDEX idx_tasks_stage ON tasks(user_id, stage);
CREATE INDEX idx_tasks_stage_scheduled ON tasks(user_id, stage, scheduled_at)
  WHERE stage IN ('scheduled', 'executing');
