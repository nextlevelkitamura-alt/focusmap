-- AI task observation history.
-- Stores every explicit progress-check result so the UI can show the latest
-- summary while keeping an auditable trail of what evidence was used.

create table if not exists public.ai_task_observations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  observed_at timestamptz not null default now(),
  source text not null default 'progress_check'
    check (source in ('progress_check', 'task_runner', 'hook', 'rule', 'gemini', 'manual')),
  state text not null
    check (state in ('not_started', 'running', 'likely_completed', 'needs_review', 'blocked', 'failed', 'unknown')),
  progress_percent integer not null default 0
    check (progress_percent >= 0 and progress_percent <= 100),
  confidence numeric not null default 0
    check (confidence >= 0 and confidence <= 1),
  session_health text not null default 'unknown'
    check (session_health in ('active', 'stopped', 'lost_after_restart', 'transcript_only', 'unknown')),
  summary text not null default '',
  comment text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_task_observations_task_observed
  on public.ai_task_observations(task_id, observed_at desc);

create index if not exists idx_ai_task_observations_user_observed
  on public.ai_task_observations(user_id, observed_at desc);

create index if not exists idx_ai_task_observations_state
  on public.ai_task_observations(user_id, state, observed_at desc);

alter table public.ai_task_observations enable row level security;

drop policy if exists "own_ai_task_observations" on public.ai_task_observations;
create policy "own_ai_task_observations"
  on public.ai_task_observations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.ai_task_observations;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

comment on table public.ai_task_observations is 'AI task progress-check observation history. Latest summary is also mirrored into ai_tasks.result.progress_summary.';
