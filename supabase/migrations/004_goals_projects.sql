begin;

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  status text not null default 'active'
    check (status in ('active','completed','paused','cancelled')),
  horizon text check (horizon is null or horizon in ('short','medium','long')),
  priority smallint not null default 3 check (priority between 1 and 5),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_owner_status_idx on public.goals(owner_id, status, priority);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  space_id uuid references public.spaces(id) on delete set null,
  name text not null check (char_length(name) between 1 and 300),
  description text,
  status text not null default 'active'
    check (status in ('active','completed','paused','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_status_idx on public.projects(owner_id, status);
create index projects_goal_id_idx on public.projects(goal_id);

alter table public.tasks
  add column goal_id uuid references public.goals(id) on delete set null,
  add column project_id uuid references public.projects(id) on delete set null,
  add column due_at timestamptz,
  add column completed_at timestamptz;
create index tasks_goal_id_idx on public.tasks(goal_id);
create index tasks_project_id_idx on public.tasks(project_id);

drop policy if exists tasks_own_rows on public.tasks;
create policy tasks_own_rows on public.tasks
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and (goal_id is null or exists (
      select 1 from public.goals g
      where g.id = goal_id and g.owner_id = public.current_app_user_id()
    ))
    and (project_id is null or exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = public.current_app_user_id()
    ))
  );

alter table public.goals enable row level security;
alter table public.projects enable row level security;
create policy goals_own_rows on public.goals
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy projects_own_rows on public.projects
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and (goal_id is null or exists (
      select 1 from public.goals g where g.id = goal_id and g.owner_id = public.current_app_user_id()
    ))
    and (space_id is null or exists (
      select 1 from public.spaces s where s.id = space_id and s.owner_id = public.current_app_user_id()
    ))
  );
create trigger goals_set_updated_at before update on public.goals
  for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

commit;
