-- Keep one active imported task per Google Calendar event.
--
-- Older builds could import the same Google event concurrently from multiple
-- Today panels. That left several active tasks with the same google_event_id;
-- checking one row completed it, but reload could render another unchecked row.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, google_event_id
      ORDER BY
        CASE
          WHEN status = 'done' THEN 3
          WHEN status IS NOT NULL AND status <> 'todo' THEN 2
          WHEN status = 'todo' THEN 1
          ELSE 0
        END DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id DESC
    ) AS row_number
  FROM tasks
  WHERE source = 'google_event'
    AND google_event_id IS NOT NULL
    AND deleted_at IS NULL
)
UPDATE tasks
SET
  deleted_at = now(),
  is_timer_running = false,
  last_started_at = null,
  updated_at = now()
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_active_google_event
  ON tasks (user_id, google_event_id)
  WHERE source = 'google_event'
    AND google_event_id IS NOT NULL
    AND deleted_at IS NULL;
