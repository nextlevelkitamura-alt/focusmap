-- Versioned AI packages and runner-side package cache/sync state.

CREATE TABLE IF NOT EXISTS ai_task_package_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES ai_task_packages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_kind TEXT NOT NULL DEFAULT 'git'
    CHECK (source_kind IN ('git', 'local_repo_key', 'inline')),
  repo_url TEXT,
  git_ref TEXT,
  git_commit_sha TEXT,
  package_path TEXT NOT NULL DEFAULT '.',
  content_sha256 TEXT,
  changelog TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, version)
);

ALTER TABLE ai_task_packages
  ADD COLUMN IF NOT EXISTS current_version_id UUID;

DO $$
BEGIN
  ALTER TABLE ai_task_packages
    ADD CONSTRAINT ai_task_packages_current_version_id_fkey
    FOREIGN KEY (current_version_id)
    REFERENCES ai_task_package_versions(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS ai_package_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES ai_task_packages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'editor', 'viewer')),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (package_id, user_id)
);

CREATE TABLE IF NOT EXISTS ai_runner_package_cache (
  runner_id UUID NOT NULL REFERENCES ai_runners(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES ai_task_packages(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES ai_task_package_versions(id) ON DELETE CASCADE,
  local_path TEXT,
  source_ref TEXT,
  git_commit_sha TEXT,
  content_sha256 TEXT,
  sync_status TEXT NOT NULL DEFAULT 'missing'
    CHECK (sync_status IN ('missing', 'sync_requested', 'syncing', 'ready', 'failed')),
  sync_requested_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (runner_id, package_id)
);

ALTER TABLE ai_tasks
  ADD COLUMN IF NOT EXISTS package_version_id UUID REFERENCES ai_task_package_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ai_task_package_versions_package
  ON ai_task_package_versions(package_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_task_packages_current_version
  ON ai_task_packages(current_version_id)
  WHERE current_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_tasks_package_version
  ON ai_tasks(package_version_id)
  WHERE package_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_runner_package_cache_status
  ON ai_runner_package_cache(runner_id, sync_status, updated_at DESC);

CREATE OR REPLACE FUNCTION public.can_view_ai_task_package(
  p_package_id UUID,
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
    FROM public.ai_task_packages p
    WHERE p.id = p_package_id
      AND (
        p.user_id = p_user_id
        OR (p.space_id IS NOT NULL AND public.can_view_space(p.space_id, p_user_id))
        OR EXISTS (
          SELECT 1
          FROM public.ai_package_permissions perm
          WHERE perm.package_id = p.id
            AND perm.user_id = p_user_id
            AND perm.role IN ('owner', 'editor', 'viewer')
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_edit_ai_task_package(
  p_package_id UUID,
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
    FROM public.ai_task_packages p
    WHERE p.id = p_package_id
      AND (
        p.user_id = p_user_id
        OR (p.space_id IS NOT NULL AND public.can_edit_space(p.space_id, p_user_id))
        OR EXISTS (
          SELECT 1
          FROM public.ai_package_permissions perm
          WHERE perm.package_id = p.id
            AND perm.user_id = p_user_id
            AND perm.role IN ('owner', 'editor')
        )
      )
  )
$$;

-- Atomically claims one due AI task for a heartbeat-active runner.
-- Versioned package tasks are claimable only after the runner has synced the
-- exact package version locally, preventing execution from a stale checkout.
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
      AND (
        t.package_version_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.ai_runner_package_cache c
          WHERE c.runner_id = v_runner.id
            AND c.package_id = t.package_id
            AND c.version_id = t.package_version_id
            AND c.sync_status = 'ready'
            AND c.local_path IS NOT NULL
        )
      )
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

ALTER TABLE ai_task_package_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_package_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_runner_package_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_task_package_versions_select" ON ai_task_package_versions;
DROP POLICY IF EXISTS "ai_task_package_versions_insert" ON ai_task_package_versions;
DROP POLICY IF EXISTS "ai_task_package_versions_update" ON ai_task_package_versions;
DROP POLICY IF EXISTS "ai_task_package_versions_delete" ON ai_task_package_versions;
CREATE POLICY "ai_task_package_versions_select" ON ai_task_package_versions
  FOR SELECT USING (public.can_view_ai_task_package(package_id));
CREATE POLICY "ai_task_package_versions_insert" ON ai_task_package_versions
  FOR INSERT WITH CHECK (user_id = auth.uid() AND public.can_edit_ai_task_package(package_id));
CREATE POLICY "ai_task_package_versions_update" ON ai_task_package_versions
  FOR UPDATE USING (public.can_edit_ai_task_package(package_id))
  WITH CHECK (public.can_edit_ai_task_package(package_id));
CREATE POLICY "ai_task_package_versions_delete" ON ai_task_package_versions
  FOR DELETE USING (public.can_edit_ai_task_package(package_id));

DROP POLICY IF EXISTS "ai_package_permissions_select" ON ai_package_permissions;
DROP POLICY IF EXISTS "ai_package_permissions_insert" ON ai_package_permissions;
DROP POLICY IF EXISTS "ai_package_permissions_update" ON ai_package_permissions;
DROP POLICY IF EXISTS "ai_package_permissions_delete" ON ai_package_permissions;
CREATE POLICY "ai_package_permissions_select" ON ai_package_permissions
  FOR SELECT USING (user_id = auth.uid() OR public.can_edit_ai_task_package(package_id));
CREATE POLICY "ai_package_permissions_insert" ON ai_package_permissions
  FOR INSERT WITH CHECK (public.can_edit_ai_task_package(package_id));
CREATE POLICY "ai_package_permissions_update" ON ai_package_permissions
  FOR UPDATE USING (public.can_edit_ai_task_package(package_id))
  WITH CHECK (public.can_edit_ai_task_package(package_id));
CREATE POLICY "ai_package_permissions_delete" ON ai_package_permissions
  FOR DELETE USING (public.can_edit_ai_task_package(package_id));

DROP POLICY IF EXISTS "ai_runner_package_cache_select" ON ai_runner_package_cache;
DROP POLICY IF EXISTS "ai_runner_package_cache_insert_own_runner" ON ai_runner_package_cache;
DROP POLICY IF EXISTS "ai_runner_package_cache_update_own_runner" ON ai_runner_package_cache;
DROP POLICY IF EXISTS "ai_runner_package_cache_delete_own_runner" ON ai_runner_package_cache;
CREATE POLICY "ai_runner_package_cache_select" ON ai_runner_package_cache
  FOR SELECT USING (
    public.runner_user_id(runner_id) = auth.uid()
    OR public.can_view_ai_task_package(package_id)
  );
CREATE POLICY "ai_runner_package_cache_insert_own_runner" ON ai_runner_package_cache
  FOR INSERT WITH CHECK (public.runner_user_id(runner_id) = auth.uid());
CREATE POLICY "ai_runner_package_cache_update_own_runner" ON ai_runner_package_cache
  FOR UPDATE USING (public.runner_user_id(runner_id) = auth.uid())
  WITH CHECK (public.runner_user_id(runner_id) = auth.uid());
CREATE POLICY "ai_runner_package_cache_delete_own_runner" ON ai_runner_package_cache
  FOR DELETE USING (public.runner_user_id(runner_id) = auth.uid());

UPDATE api_keys SET scopes = array_append(scopes, 'ai:packages:write')
WHERE NOT ('ai:packages:write' = ANY(scopes));
UPDATE api_keys SET scopes = array_append(scopes, 'ai:runners')
WHERE NOT ('ai:runners' = ANY(scopes));

NOTIFY pgrst, 'reload schema';
