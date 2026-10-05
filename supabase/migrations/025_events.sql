begin;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index events_owner_created_idx
  on public.events(owner_id, created_at desc);
create index events_name_created_idx
  on public.events(name, created_at desc);

alter table public.events enable row level security;
create policy events_own_rows on public.events
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
