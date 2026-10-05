begin;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.app_user_id', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_user_id'
  )::uuid
$$;

create table public.beta_metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (name in (
    'first_self_fact',
    'personal_recommendation',
    'companion_week_2',
    'reflection_completed'
  )),
  properties jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(owner_id, name)
);

create index beta_metrics_name_created_idx on public.beta_metrics(name, created_at);

alter table public.beta_metrics enable row level security;
create policy beta_metrics_own_rows on public.beta_metrics
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
