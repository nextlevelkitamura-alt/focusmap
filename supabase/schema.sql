-- Create tables
create table spaces (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  title text not null,
  description text,
  status text default 'in_progress', -- in_progress, completed, archived
  default_calendar_id text, -- Google Calendar ID for this space
  icon text,
  color text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table projects (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  space_id uuid references spaces on delete cascade not null,
  title text not null,
  purpose text, -- 目的
  category_tag text,
  priority integer default 3, -- 1-5
  status text default 'active', -- active, completed, on_hold
  color_theme text default 'blue',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table task_groups (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  project_id uuid references projects on delete cascade not null,
  title text not null,
  order_index integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table tasks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  group_id uuid references task_groups on delete cascade not null,
  title text not null,
  status text default 'todo', -- todo, in_progress, done
  priority integer default 3, -- 1-5
  scheduled_at timestamp with time zone,
  estimated_time integer default 0, -- minutes
  actual_time_minutes integer default 0,
  google_event_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table spaces enable row level security;
alter table projects enable row level security;
alter table task_groups enable row level security;
alter table tasks enable row level security;

-- Create Policies
create policy "Users can CRUD their own spaces" on spaces
  for all using (auth.uid() = user_id);

create policy "Users can CRUD their own projects" on projects
  for all using (auth.uid() = user_id);

create policy "Users can CRUD their own task_groups" on task_groups
  for all using (auth.uid() = user_id);

create policy "Users can CRUD their own tasks" on tasks
  for all using (auth.uid() = user_id);
