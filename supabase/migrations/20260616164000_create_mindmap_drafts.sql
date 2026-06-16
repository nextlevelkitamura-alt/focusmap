create table if not exists public.mindmap_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chat_session_id uuid null references public.agent_chat_sessions(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'discarded', 'applied')),
  scope jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  base_snapshot jsonb not null default '[]'::jsonb,
  created_by text not null default 'ai'
    check (created_by in ('ai', 'user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mindmap_drafts_one_active_per_project_idx
  on public.mindmap_drafts(user_id, project_id)
  where status = 'active';

create index if not exists idx_mindmap_drafts_project_updated
  on public.mindmap_drafts(user_id, project_id, updated_at desc);

create table if not exists public.mindmap_draft_nodes (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.mindmap_drafts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  draft_node_id uuid not null,
  task_id uuid null references public.tasks(id) on delete set null,
  parent_draft_node_id uuid null,
  parent_task_id uuid null references public.tasks(id) on delete set null,
  title text not null,
  original_title text,
  is_group boolean not null default false,
  order_index integer not null default 0,
  change_type text not null default 'new'
    check (change_type in ('new', 'moved', 'title_adjusted', 'moved_title_adjusted', 'link_adjusted')),
  origin text not null default 'ai'
    check (origin in ('ai', 'user')),
  source_links jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mindmap_draft_nodes_draft_node_idx
  on public.mindmap_draft_nodes(draft_id, draft_node_id);

create index if not exists idx_mindmap_draft_nodes_task
  on public.mindmap_draft_nodes(user_id, task_id)
  where task_id is not null;

create index if not exists idx_mindmap_draft_nodes_parent
  on public.mindmap_draft_nodes(draft_id, parent_draft_node_id);

create table if not exists public.mindmap_draft_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  draft_id uuid null references public.mindmap_drafts(id) on delete set null,
  chat_session_id uuid null references public.agent_chat_sessions(id) on delete set null,
  status text not null default 'applied'
    check (status in ('applied', 'undone', 'redone')),
  summary jsonb not null default '{}'::jsonb,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  applied_payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '15 days'),
  undone_at timestamptz,
  redone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mindmap_draft_history_project_created
  on public.mindmap_draft_history(user_id, project_id, created_at desc);

create index if not exists idx_mindmap_draft_history_expires
  on public.mindmap_draft_history(expires_at);

alter table public.mindmap_drafts enable row level security;
alter table public.mindmap_draft_nodes enable row level security;
alter table public.mindmap_draft_history enable row level security;

drop policy if exists "own_mindmap_drafts" on public.mindmap_drafts;
create policy "own_mindmap_drafts"
  on public.mindmap_drafts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own_mindmap_draft_nodes" on public.mindmap_draft_nodes;
create policy "own_mindmap_draft_nodes"
  on public.mindmap_draft_nodes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own_mindmap_draft_history" on public.mindmap_draft_history;
create policy "own_mindmap_draft_history"
  on public.mindmap_draft_history
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_mindmap_draft_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_mindmap_drafts_touch on public.mindmap_drafts;
create trigger trg_mindmap_drafts_touch
  before update on public.mindmap_drafts
  for each row execute function public.touch_mindmap_draft_updated_at();

drop trigger if exists trg_mindmap_draft_nodes_touch on public.mindmap_draft_nodes;
create trigger trg_mindmap_draft_nodes_touch
  before update on public.mindmap_draft_nodes
  for each row execute function public.touch_mindmap_draft_updated_at();

drop trigger if exists trg_mindmap_draft_history_touch on public.mindmap_draft_history;
create trigger trg_mindmap_draft_history_touch
  before update on public.mindmap_draft_history
  for each row execute function public.touch_mindmap_draft_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.mindmap_drafts;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.mindmap_draft_nodes;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

comment on table public.mindmap_drafts is
  'Latest AI proposal draft for a project mind map. Active draft is shown as AI案 before applying to tasks.';

comment on table public.mindmap_draft_nodes is
  'Diff-centered draft nodes. Existing task rows use task_id; new proposal nodes use draft_node_id until apply.';

comment on table public.mindmap_draft_history is
  '15-day DB-backed undo/redo history for applying AI map drafts to production tasks.';
