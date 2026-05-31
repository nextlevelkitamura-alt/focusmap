-- Compact project context:
-- - heading/details are user-editable and used as bounded AI context.
-- - progress/progress_status are reserved for future AI/manual completion updates.

create table if not exists public.project_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null default auth.uid(),
  project_id uuid references public.projects(id) on delete cascade not null,
  heading text not null default '',
  details text not null default '',
  progress text not null default '',
  progress_status text not null default 'not_started'
    check (progress_status in ('not_started', 'in_progress', 'blocked', 'done', 'archived')),
  progress_updated_at timestamptz,
  last_saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint project_contexts_project_user_unique unique (project_id, user_id)
);

create index if not exists project_contexts_user_updated_idx
  on public.project_contexts (user_id, updated_at desc);

create index if not exists project_contexts_project_idx
  on public.project_contexts (project_id);

alter table public.project_contexts enable row level security;

drop policy if exists "project_contexts_select_own" on public.project_contexts;
create policy "project_contexts_select_own"
  on public.project_contexts for select
  using (auth.uid() = user_id);

drop policy if exists "project_contexts_insert_own" on public.project_contexts;
create policy "project_contexts_insert_own"
  on public.project_contexts for insert
  with check (auth.uid() = user_id);

drop policy if exists "project_contexts_update_own" on public.project_contexts;
create policy "project_contexts_update_own"
  on public.project_contexts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "project_contexts_delete_own" on public.project_contexts;
create policy "project_contexts_delete_own"
  on public.project_contexts for delete
  using (auth.uid() = user_id);

create or replace function public.update_project_contexts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  new.last_saved_at = now();

  if new.progress is distinct from old.progress
    or new.progress_status is distinct from old.progress_status then
    new.progress_updated_at = now();
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists project_contexts_updated_at on public.project_contexts;
create trigger project_contexts_updated_at
  before update on public.project_contexts
  for each row execute function public.update_project_contexts_updated_at();

comment on table public.project_contexts is
  'One compact project context row. User-facing fields are heading/details; progress is stored for later AI or completion-report updates.';

comment on column public.project_contexts.heading is
  'Short user-editable project context heading. Can be typed, dictated, or generated from details.';

comment on column public.project_contexts.details is
  'Free-text project context details used as bounded AI context.';

comment on column public.project_contexts.progress is
  'Project progress summary reserved for later AI/manual completion updates.';
