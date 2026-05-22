-- Space sharing, AI execution packages, and shared runner claiming.

-- ─────────────────────────────────────────────────────────────
-- Space roles and helpers
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS space_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_space_members_user_id
  ON space_members(user_id, space_id);

CREATE INDEX IF NOT EXISTS idx_space_members_space_id
  ON space_members(space_id, role);

INSERT INTO space_members (space_id, user_id, role)
SELECT id, user_id, 'owner'
FROM spaces
ON CONFLICT (space_id, user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS space_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'editor', 'commenter', 'viewer')),
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, email)
);

CREATE INDEX IF NOT EXISTS idx_space_invites_space_id
  ON space_invites(space_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.space_member_role(
  p_space_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sm.role
  FROM public.space_members sm
  WHERE sm.space_id = p_space_id
    AND sm.user_id = p_user_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_view_space(
  p_space_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.spaces s
    WHERE s.id = p_space_id
      AND s.user_id = p_user_id
  ) OR public.space_member_role(p_space_id, p_user_id) IN ('owner', 'editor', 'commenter', 'viewer')
$$;

CREATE OR REPLACE FUNCTION public.can_edit_space(
  p_space_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.spaces s
    WHERE s.id = p_space_id
      AND s.user_id = p_user_id
  ) OR public.space_member_role(p_space_id, p_user_id) IN ('owner', 'editor')
$$;

CREATE OR REPLACE FUNCTION public.can_own_space(
  p_space_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.spaces s
    WHERE s.id = p_space_id
      AND s.user_id = p_user_id
  ) OR public.space_member_role(p_space_id, p_user_id) = 'owner'
$$;

CREATE OR REPLACE FUNCTION public.project_space_id(p_project_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.space_id
  FROM public.projects p
  WHERE p.id = p_project_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.can_view_project(
  p_project_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (p.user_id = p_user_id OR public.can_view_space(p.space_id, p_user_id))
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_project(
  p_project_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = p_project_id
      AND (p.user_id = p_user_id OR public.can_edit_space(p.space_id, p_user_id))
  )
$$;

-- ─────────────────────────────────────────────────────────────
-- AI execution packages and runners
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_task_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  executor TEXT NOT NULL DEFAULT 'claude'
    CHECK (executor IN ('claude', 'codex', 'codex_app')),
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_repo_key TEXT,
  required_secret_names TEXT[] NOT NULL DEFAULT '{}'::text[],
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_visibility TEXT NOT NULL DEFAULT 'space'
    CHECK (default_visibility IN ('private', 'space')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_task_packages_space
  ON ai_task_packages(space_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_task_packages_user
  ON ai_task_packages(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_runners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  display_name TEXT,
  executors TEXT[] NOT NULL DEFAULT ARRAY['claude']::text[],
  available_repo_keys TEXT[] NOT NULL DEFAULT '{}'::text[],
  available_secret_names TEXT[] NOT NULL DEFAULT '{}'::text[],
  repo_paths JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, hostname)
);

CREATE INDEX IF NOT EXISTS idx_ai_runners_user_heartbeat
  ON ai_runners(user_id, last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS ai_runner_spaces (
  runner_id UUID NOT NULL REFERENCES ai_runners(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (runner_id, space_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_runner_spaces_space
  ON ai_runner_spaces(space_id, enabled);

CREATE OR REPLACE FUNCTION public.runner_user_id(p_runner_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.user_id
  FROM public.ai_runners r
  WHERE r.id = p_runner_id
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.runner_has_viewable_space(
  p_runner_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ai_runner_spaces rs
    WHERE rs.runner_id = p_runner_id
      AND rs.enabled = true
      AND public.can_view_space(rs.space_id, p_user_id)
  )
$$;

ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS space_id UUID REFERENCES spaces(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES ai_task_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_runner_id UUID REFERENCES ai_runners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS run_visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (run_visibility IN ('private', 'space')),
  ADD COLUMN IF NOT EXISTS package_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_space_status
  ON ai_tasks(space_id, status, scheduled_at)
  WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_claim
  ON ai_tasks(status, scheduled_at, claim_expires_at)
  WHERE status = 'pending' AND scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_claimed_runner
  ON ai_tasks(claimed_runner_id)
  WHERE claimed_runner_id IS NOT NULL;

UPDATE ai_tasks t
SET space_id = p.space_id
FROM ideal_goals g
JOIN projects p ON p.id = g.project_id
WHERE t.space_id IS NULL
  AND t.source_ideal_goal_id = g.id;

UPDATE ai_tasks t
SET space_id = p.space_id
FROM notes n
JOIN projects p ON p.id = n.project_id
WHERE t.space_id IS NULL
  AND t.source_note_id = n.id;

UPDATE ai_tasks child
SET space_id = parent.space_id
FROM ai_tasks parent
WHERE child.space_id IS NULL
  AND child.parent_task_id = parent.id
  AND parent.space_id IS NOT NULL;

-- Atomically claims one due AI task for a heartbeat-active runner.
CREATE OR REPLACE FUNCTION public.claim_ai_task_for_runner(
  p_runner_id UUID,
  p_claim_ttl_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.ai_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runner public.ai_runners%ROWTYPE;
BEGIN
  SELECT *
  INTO v_runner
  FROM public.ai_runners
  WHERE id = p_runner_id
    AND last_heartbeat_at >= now() - INTERVAL '2 minutes';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT t.id
    FROM public.ai_tasks t
    LEFT JOIN public.ai_task_packages p ON p.id = t.package_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(NULLIF(t.package_snapshot->>'required_repo_key', ''), NULLIF(p.required_repo_key, '')) AS required_repo_key,
        CASE
          WHEN jsonb_typeof(t.package_snapshot->'required_secret_names') = 'array' THEN
            ARRAY(
              SELECT jsonb_array_elements_text(t.package_snapshot->'required_secret_names')
            )
          ELSE COALESCE(p.required_secret_names, '{}'::text[])
        END AS required_secret_names
    ) req ON true
    WHERE t.status = 'pending'
      AND t.scheduled_at IS NOT NULL
      AND t.scheduled_at <= now()
      AND (
        t.recurrence_cron IS NULL
        OR t.completed_at IS NULL
        OR (t.completed_at AT TIME ZONE 'Asia/Tokyo')::date < (now() AT TIME ZONE 'Asia/Tokyo')::date
      )
      AND (t.claimed_runner_id IS NULL OR t.claim_expires_at IS NULL OR t.claim_expires_at <= now())
      AND t.executor = ANY(v_runner.executors)
      AND (
        (t.space_id IS NULL AND t.user_id = v_runner.user_id)
        OR (
          t.space_id IS NOT NULL
          AND (t.user_id = v_runner.user_id OR t.run_visibility = 'space')
          AND EXISTS (
            SELECT 1
            FROM public.ai_runner_spaces rs
            WHERE rs.runner_id = v_runner.id
              AND rs.space_id = t.space_id
              AND rs.enabled = true
              AND (
                EXISTS (
                  SELECT 1
                  FROM public.space_members sm
                  WHERE sm.space_id = rs.space_id
                    AND sm.user_id = v_runner.user_id
                    AND sm.role IN ('owner', 'editor')
                )
                OR EXISTS (
                  SELECT 1
                  FROM public.spaces s
                  WHERE s.id = rs.space_id
                    AND s.user_id = v_runner.user_id
                )
              )
          )
        )
      )
      AND (
        req.required_repo_key IS NULL
        OR v_runner.available_repo_keys @> ARRAY[req.required_repo_key]::text[]
      )
      AND COALESCE(req.required_secret_names, '{}'::text[]) <@ COALESCE(v_runner.available_secret_names, '{}'::text[])
    ORDER BY t.scheduled_at ASC, t.created_at ASC
    FOR UPDATE OF t SKIP LOCKED
    LIMIT 1
  ),
  claimed AS (
    UPDATE public.ai_tasks t
    SET claimed_runner_id = v_runner.id,
        claim_expires_at = now() + make_interval(secs => p_claim_ttl_seconds)
    FROM candidate c
    WHERE t.id = c.id
    RETURNING t.*
  )
  SELECT * FROM claimed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_ai_task_for_runner(UUID, INTEGER) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- RLS policies
-- ─────────────────────────────────────────────────────────────
ALTER TABLE space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_task_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runners ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runner_spaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can CRUD their own spaces" ON spaces;
DROP POLICY IF EXISTS "space_select_members" ON spaces;
DROP POLICY IF EXISTS "space_insert_own" ON spaces;
DROP POLICY IF EXISTS "space_update_editors" ON spaces;
DROP POLICY IF EXISTS "space_delete_owners" ON spaces;
CREATE POLICY "space_select_members" ON spaces
  FOR SELECT USING (user_id = auth.uid() OR public.can_view_space(id));
CREATE POLICY "space_insert_own" ON spaces
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "space_update_editors" ON spaces
  FOR UPDATE USING (public.can_edit_space(id)) WITH CHECK (public.can_edit_space(id));
CREATE POLICY "space_delete_owners" ON spaces
  FOR DELETE USING (public.can_own_space(id));

DROP POLICY IF EXISTS "Users can CRUD their own projects" ON projects;
DROP POLICY IF EXISTS "projects_select_space_members" ON projects;
DROP POLICY IF EXISTS "projects_insert_space_editors" ON projects;
DROP POLICY IF EXISTS "projects_update_space_editors" ON projects;
DROP POLICY IF EXISTS "projects_delete_space_editors" ON projects;
CREATE POLICY "projects_select_space_members" ON projects
  FOR SELECT USING (user_id = auth.uid() OR public.can_view_space(space_id));
CREATE POLICY "projects_insert_space_editors" ON projects
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.can_edit_space(space_id));
CREATE POLICY "projects_update_space_editors" ON projects
  FOR UPDATE USING (public.can_edit_space(space_id)) WITH CHECK (public.can_edit_space(space_id));
CREATE POLICY "projects_delete_space_editors" ON projects
  FOR DELETE USING (public.can_edit_space(space_id));

DROP POLICY IF EXISTS "Users can CRUD their own tasks" ON tasks;
DROP POLICY IF EXISTS "tasks_select_space_members" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_space_editors" ON tasks;
DROP POLICY IF EXISTS "tasks_update_space_editors" ON tasks;
DROP POLICY IF EXISTS "tasks_delete_space_editors" ON tasks;
CREATE POLICY "tasks_select_space_members" ON tasks
  FOR SELECT USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_view_project(project_id)));
CREATE POLICY "tasks_insert_space_editors" ON tasks
  FOR INSERT WITH CHECK (user_id = auth.uid() AND (project_id IS NULL OR public.can_edit_project(project_id)));
CREATE POLICY "tasks_update_space_editors" ON tasks
  FOR UPDATE USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)))
  WITH CHECK (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)));
CREATE POLICY "tasks_delete_space_editors" ON tasks
  FOR DELETE USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)));

DROP POLICY IF EXISTS "Users can view own ideal_goals" ON ideal_goals;
DROP POLICY IF EXISTS "Users can insert own ideal_goals" ON ideal_goals;
DROP POLICY IF EXISTS "Users can update own ideal_goals" ON ideal_goals;
DROP POLICY IF EXISTS "Users can delete own ideal_goals" ON ideal_goals;
DROP POLICY IF EXISTS "ideal_goals_select_space_members" ON ideal_goals;
DROP POLICY IF EXISTS "ideal_goals_insert_space_editors" ON ideal_goals;
DROP POLICY IF EXISTS "ideal_goals_update_space_editors" ON ideal_goals;
DROP POLICY IF EXISTS "ideal_goals_delete_space_editors" ON ideal_goals;
CREATE POLICY "ideal_goals_select_space_members" ON ideal_goals
  FOR SELECT USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_view_project(project_id)));
CREATE POLICY "ideal_goals_insert_space_editors" ON ideal_goals
  FOR INSERT WITH CHECK (user_id = auth.uid() AND (project_id IS NULL OR public.can_edit_project(project_id)));
CREATE POLICY "ideal_goals_update_space_editors" ON ideal_goals
  FOR UPDATE USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)))
  WITH CHECK (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)));
CREATE POLICY "ideal_goals_delete_space_editors" ON ideal_goals
  FOR DELETE USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)));

DROP POLICY IF EXISTS "Users can view own notes" ON notes;
DROP POLICY IF EXISTS "Users can insert own notes" ON notes;
DROP POLICY IF EXISTS "Users can update own notes" ON notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON notes;
DROP POLICY IF EXISTS "notes_select_space_members" ON notes;
DROP POLICY IF EXISTS "notes_insert_space_editors" ON notes;
DROP POLICY IF EXISTS "notes_update_space_editors" ON notes;
DROP POLICY IF EXISTS "notes_delete_space_editors" ON notes;
CREATE POLICY "notes_select_space_members" ON notes
  FOR SELECT USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_view_project(project_id)));
CREATE POLICY "notes_insert_space_editors" ON notes
  FOR INSERT WITH CHECK (user_id = auth.uid() AND (project_id IS NULL OR public.can_edit_project(project_id)));
CREATE POLICY "notes_update_space_editors" ON notes
  FOR UPDATE USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)))
  WITH CHECK (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)));
CREATE POLICY "notes_delete_space_editors" ON notes
  FOR DELETE USING (user_id = auth.uid() OR (project_id IS NOT NULL AND public.can_edit_project(project_id)));

DROP POLICY IF EXISTS "own_ai_tasks" ON ai_tasks;
DROP POLICY IF EXISTS "ai_tasks_select_space_members" ON ai_tasks;
DROP POLICY IF EXISTS "ai_tasks_insert_space_editors" ON ai_tasks;
DROP POLICY IF EXISTS "ai_tasks_update_space_editors" ON ai_tasks;
DROP POLICY IF EXISTS "ai_tasks_delete_space_editors" ON ai_tasks;
CREATE POLICY "ai_tasks_select_space_members" ON ai_tasks
  FOR SELECT USING (
    user_id = auth.uid()
    OR (space_id IS NOT NULL AND run_visibility = 'space' AND public.can_view_space(space_id))
  );
CREATE POLICY "ai_tasks_insert_space_editors" ON ai_tasks
  FOR INSERT WITH CHECK (user_id = auth.uid() AND (space_id IS NULL OR public.can_edit_space(space_id)));
CREATE POLICY "ai_tasks_update_space_editors" ON ai_tasks
  FOR UPDATE USING (user_id = auth.uid() OR (space_id IS NOT NULL AND run_visibility = 'space' AND public.can_edit_space(space_id)))
  WITH CHECK (user_id = auth.uid() OR (space_id IS NOT NULL AND run_visibility = 'space' AND public.can_edit_space(space_id)));
CREATE POLICY "ai_tasks_delete_space_editors" ON ai_tasks
  FOR DELETE USING (user_id = auth.uid() OR (space_id IS NOT NULL AND run_visibility = 'space' AND public.can_edit_space(space_id)));

DROP POLICY IF EXISTS "space_members_select" ON space_members;
DROP POLICY IF EXISTS "space_members_insert_owners" ON space_members;
DROP POLICY IF EXISTS "space_members_update_owners" ON space_members;
DROP POLICY IF EXISTS "space_members_delete_owners" ON space_members;
CREATE POLICY "space_members_select" ON space_members
  FOR SELECT USING (user_id = auth.uid() OR public.can_view_space(space_id));
CREATE POLICY "space_members_insert_owners" ON space_members
  FOR INSERT WITH CHECK (public.can_own_space(space_id));
CREATE POLICY "space_members_update_owners" ON space_members
  FOR UPDATE USING (public.can_own_space(space_id)) WITH CHECK (public.can_own_space(space_id));
CREATE POLICY "space_members_delete_owners" ON space_members
  FOR DELETE USING (public.can_own_space(space_id));

DROP POLICY IF EXISTS "space_invites_select" ON space_invites;
DROP POLICY IF EXISTS "space_invites_insert_owners" ON space_invites;
DROP POLICY IF EXISTS "space_invites_update_owners" ON space_invites;
DROP POLICY IF EXISTS "space_invites_delete_owners" ON space_invites;
CREATE POLICY "space_invites_select" ON space_invites
  FOR SELECT USING (public.can_own_space(space_id));
CREATE POLICY "space_invites_insert_owners" ON space_invites
  FOR INSERT WITH CHECK (invited_by = auth.uid() AND public.can_own_space(space_id));
CREATE POLICY "space_invites_update_owners" ON space_invites
  FOR UPDATE USING (public.can_own_space(space_id)) WITH CHECK (public.can_own_space(space_id));
CREATE POLICY "space_invites_delete_owners" ON space_invites
  FOR DELETE USING (public.can_own_space(space_id));

DROP POLICY IF EXISTS "ai_task_packages_select_space_members" ON ai_task_packages;
DROP POLICY IF EXISTS "ai_task_packages_insert_space_editors" ON ai_task_packages;
DROP POLICY IF EXISTS "ai_task_packages_update_space_editors" ON ai_task_packages;
DROP POLICY IF EXISTS "ai_task_packages_delete_space_owners" ON ai_task_packages;
CREATE POLICY "ai_task_packages_select_space_members" ON ai_task_packages
  FOR SELECT USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_view_space(space_id)));
CREATE POLICY "ai_task_packages_insert_space_editors" ON ai_task_packages
  FOR INSERT WITH CHECK (user_id = auth.uid() AND (space_id IS NULL OR public.can_edit_space(space_id)));
CREATE POLICY "ai_task_packages_update_space_editors" ON ai_task_packages
  FOR UPDATE USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_edit_space(space_id)))
  WITH CHECK (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_edit_space(space_id)));
CREATE POLICY "ai_task_packages_delete_space_owners" ON ai_task_packages
  FOR DELETE USING (user_id = auth.uid() OR (space_id IS NOT NULL AND public.can_own_space(space_id)));

DROP POLICY IF EXISTS "ai_runners_own" ON ai_runners;
DROP POLICY IF EXISTS "ai_runners_select_own_or_space" ON ai_runners;
DROP POLICY IF EXISTS "ai_runners_insert_own" ON ai_runners;
DROP POLICY IF EXISTS "ai_runners_update_own" ON ai_runners;
DROP POLICY IF EXISTS "ai_runners_delete_own" ON ai_runners;
CREATE POLICY "ai_runners_select_own_or_space" ON ai_runners
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.runner_has_viewable_space(id)
  );
CREATE POLICY "ai_runners_insert_own" ON ai_runners
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "ai_runners_update_own" ON ai_runners
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "ai_runners_delete_own" ON ai_runners
  FOR DELETE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ai_runner_spaces_own_runner" ON ai_runner_spaces;
DROP POLICY IF EXISTS "ai_runner_spaces_select_own_or_space" ON ai_runner_spaces;
DROP POLICY IF EXISTS "ai_runner_spaces_insert_own_runner" ON ai_runner_spaces;
DROP POLICY IF EXISTS "ai_runner_spaces_update_own_runner" ON ai_runner_spaces;
DROP POLICY IF EXISTS "ai_runner_spaces_delete_own_runner" ON ai_runner_spaces;
CREATE POLICY "ai_runner_spaces_select_own_or_space" ON ai_runner_spaces
  FOR SELECT USING (
    public.can_view_space(space_id)
    OR public.runner_user_id(runner_id) = auth.uid()
  );
CREATE POLICY "ai_runner_spaces_insert_own_runner" ON ai_runner_spaces
  FOR INSERT WITH CHECK (public.runner_user_id(runner_id) = auth.uid());
CREATE POLICY "ai_runner_spaces_update_own_runner" ON ai_runner_spaces
  FOR UPDATE USING (public.runner_user_id(runner_id) = auth.uid())
  WITH CHECK (public.runner_user_id(runner_id) = auth.uid());
CREATE POLICY "ai_runner_spaces_delete_own_runner" ON ai_runner_spaces
  FOR DELETE USING (public.runner_user_id(runner_id) = auth.uid());

-- Add scopes used by the new package and runner APIs.
ALTER TABLE api_keys
  ALTER COLUMN scopes SET DEFAULT ARRAY[
    'tasks:read',
    'tasks:write',
    'projects:read',
    'projects:write',
    'spaces:read',
    'spaces:write',
    'habits:read',
    'ai:scheduling',
    'ai:chat',
    'ai:tasks:read',
    'ai:tasks:write',
    'ai:packages:read',
    'ai:packages:write',
    'ai:runners',
    'calendar:read',
    'notes:read',
    'notes:write'
  ];

UPDATE api_keys SET scopes = array_append(scopes, 'spaces:write')
WHERE NOT ('spaces:write' = ANY(scopes));
UPDATE api_keys SET scopes = array_append(scopes, 'ai:packages:read')
WHERE NOT ('ai:packages:read' = ANY(scopes));
UPDATE api_keys SET scopes = array_append(scopes, 'ai:packages:write')
WHERE NOT ('ai:packages:write' = ANY(scopes));
UPDATE api_keys SET scopes = array_append(scopes, 'ai:runners')
WHERE NOT ('ai:runners' = ANY(scopes));

NOTIFY pgrst, 'reload schema';
