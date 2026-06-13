-- Treat one Google Calendar event as one active Focusmap task.
--
-- Imported Google-event tasks can be safely soft-deleted when duplicated.
-- Manual/mindmap tasks are user-authored work, so duplicate calendar links are
-- detached instead of deleting the task itself.

WITH ranked AS (
  SELECT
    id,
    source,
    row_number() OVER (
      PARTITION BY user_id, google_event_id
      ORDER BY
        CASE
          WHEN status = 'done' THEN 3
          WHEN status IS NOT NULL AND status <> 'todo' THEN 2
          WHEN status = 'todo' THEN 1
          ELSE 0
        END DESC,
        CASE WHEN source = 'google_event' THEN 0 ELSE 1 END DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS row_number
  FROM tasks
  WHERE google_event_id IS NOT NULL
    AND deleted_at IS NULL
),
duplicates AS (
  SELECT id, source
  FROM ranked
  WHERE row_number > 1
)
UPDATE tasks
SET
  deleted_at = now(),
  is_timer_running = false,
  last_started_at = null,
  updated_at = now()
WHERE id IN (
  SELECT id
  FROM duplicates
  WHERE source = 'google_event'
);

WITH ranked AS (
  SELECT
    id,
    source,
    row_number() OVER (
      PARTITION BY user_id, google_event_id
      ORDER BY
        CASE
          WHEN status = 'done' THEN 3
          WHEN status IS NOT NULL AND status <> 'todo' THEN 2
          WHEN status = 'todo' THEN 1
          ELSE 0
        END DESC,
        CASE WHEN source = 'google_event' THEN 0 ELSE 1 END DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS row_number
  FROM tasks
  WHERE google_event_id IS NOT NULL
    AND deleted_at IS NULL
),
duplicates AS (
  SELECT id, source
  FROM ranked
  WHERE row_number > 1
)
UPDATE tasks
SET
  google_event_id = null,
  calendar_event_id = null,
  calendar_id = null,
  scheduled_at = null,
  stage = CASE WHEN status = 'done' THEN 'done' ELSE 'plan' END,
  is_timer_running = false,
  last_started_at = null,
  updated_at = now()
WHERE id IN (
  SELECT id
  FROM duplicates
  WHERE source IS DISTINCT FROM 'google_event'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_active_calendar_event_any_source
  ON tasks (user_id, google_event_id)
  WHERE google_event_id IS NOT NULL
    AND deleted_at IS NULL;
