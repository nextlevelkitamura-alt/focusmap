-- Google Calendar event ids are only safe when scoped by calendar_id.
-- Keep separate events/tasks from different calendars even if Google returns
-- the same event id string.

WITH ranked_calendar_events AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, calendar_id, google_event_id
      ORDER BY synced_at DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_number
  FROM calendar_events
  WHERE google_event_id IS NOT NULL
),
duplicate_calendar_events AS (
  SELECT id
  FROM ranked_calendar_events
  WHERE row_number > 1
)
DELETE FROM calendar_events
WHERE id IN (SELECT id FROM duplicate_calendar_events);

ALTER TABLE calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_user_id_google_event_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_user_calendar_google_event
  ON calendar_events (user_id, calendar_id, google_event_id);

WITH ranked_event_completions AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, calendar_id, google_event_id, completed_date
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS row_number
  FROM event_completions
),
duplicate_event_completions AS (
  SELECT id
  FROM ranked_event_completions
  WHERE row_number > 1
)
DELETE FROM event_completions
WHERE id IN (SELECT id FROM duplicate_event_completions);

ALTER TABLE event_completions
  DROP CONSTRAINT IF EXISTS event_completions_user_id_google_event_id_completed_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_completions_user_calendar_google_event_date
  ON event_completions (user_id, calendar_id, google_event_id, completed_date);

DROP INDEX IF EXISTS idx_tasks_one_active_google_event;
DROP INDEX IF EXISTS idx_tasks_one_active_calendar_event_any_source;

WITH ranked_tasks AS (
  SELECT
    id,
    source,
    row_number() OVER (
      PARTITION BY user_id, calendar_id, google_event_id
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
    AND calendar_id IS NOT NULL
    AND deleted_at IS NULL
),
duplicate_tasks AS (
  SELECT id, source
  FROM ranked_tasks
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
  FROM duplicate_tasks
  WHERE source = 'google_event'
);

WITH ranked_tasks AS (
  SELECT
    id,
    source,
    row_number() OVER (
      PARTITION BY user_id, calendar_id, google_event_id
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
    AND calendar_id IS NOT NULL
    AND deleted_at IS NULL
),
duplicate_tasks AS (
  SELECT id, source
  FROM ranked_tasks
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
  FROM duplicate_tasks
  WHERE source IS DISTINCT FROM 'google_event'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_one_active_calendar_event_any_source
  ON tasks (user_id, calendar_id, google_event_id)
  WHERE google_event_id IS NOT NULL
    AND calendar_id IS NOT NULL
    AND deleted_at IS NULL;
