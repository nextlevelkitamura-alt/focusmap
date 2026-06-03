create table if not exists public.ai_task_activity_messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null
    check (role in ('system', 'codex', 'user', 'status')),
  kind text not null
    check (kind in ('sent', 'progress', 'question', 'approval', 'resumed', 'completed', 'failed', 'user_answer')),
  body text not null,
  importance text not null default 'normal'
    check (importance in ('normal', 'important')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_task_activity_messages_task_created
  on public.ai_task_activity_messages(task_id, created_at);

create index if not exists idx_ai_task_activity_messages_user_created
  on public.ai_task_activity_messages(user_id, created_at desc);

alter table public.ai_task_activity_messages enable row level security;

drop policy if exists "own_ai_task_activity_messages" on public.ai_task_activity_messages;
create policy "own_ai_task_activity_messages"
  on public.ai_task_activity_messages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.ai_task_activity_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

comment on table public.ai_task_activity_messages is
  'Chat-style activity messages for ai_tasks. Server helpers keep each task capped at 50 rows while preserving important execution events first.';
