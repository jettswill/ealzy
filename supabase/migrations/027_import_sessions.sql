begin;

create table public.import_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('todoist', 'text')),
  status text not null default 'preview' check (status in ('preview', 'confirmed', 'cancelled')),
  items jsonb not null default '[]',
  access_token text,
  log jsonb not null default '{}',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index import_sessions_owner_created_idx
  on public.import_sessions(owner_id, created_at desc);

alter table public.import_sessions enable row level security;
create policy import_sessions_own_rows on public.import_sessions
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
