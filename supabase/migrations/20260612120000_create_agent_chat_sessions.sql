create table if not exists public.agent_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_key text not null default 'general',
  chat_mode text not null default 'general'
    check (chat_mode in ('general', 'project')),
  space_id uuid null references public.spaces(id) on delete set null,
  project_id uuid null references public.projects(id) on delete set null,
  title text not null default '新しいチャット',
  messages jsonb not null default '[]'::jsonb,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'completed', 'failed')),
  last_error text,
  run_started_at timestamptz,
  run_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_chat_sessions_user_scope_updated
  on public.agent_chat_sessions(user_id, scope_key, updated_at desc);

create index if not exists idx_agent_chat_sessions_user_status
  on public.agent_chat_sessions(user_id, status, updated_at desc);

alter table public.agent_chat_sessions enable row level security;

drop policy if exists "own_agent_chat_sessions" on public.agent_chat_sessions;
create policy "own_agent_chat_sessions"
  on public.agent_chat_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.touch_agent_chat_sessions_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_agent_chat_sessions_touch on public.agent_chat_sessions;
create trigger trg_agent_chat_sessions_touch
  before update on public.agent_chat_sessions
  for each row execute function public.touch_agent_chat_sessions_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.agent_chat_sessions;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

comment on table public.agent_chat_sessions is
  'UnifiedChat sessions persisted for restore-after-navigation and background agent runs.';

comment on column public.agent_chat_sessions.messages is
  'AI SDK UIMessage[] without system messages. This is the replay source for persistent agent chat.';

comment on column public.agent_chat_sessions.status is
  'idle/running/completed/failed. running remains visible after screen navigation until the background run finishes.';
