begin;

create table public.self_promises (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  status text not null default 'active'
    check (status in ('active','paused','retired')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index self_promises_owner_status_idx on public.self_promises(owner_id, status, created_at desc);

create table public.self_promise_checkins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  promise_id uuid not null references public.self_promises(id) on delete cascade,
  status text not null check (status in ('keeping','struggling','broken')),
  note text,
  created_at timestamptz not null default now()
);
create index self_promise_checkins_promise_idx
  on public.self_promise_checkins(promise_id, created_at desc);
create index self_promise_checkins_owner_idx
  on public.self_promise_checkins(owner_id, created_at desc);

alter table public.self_promises enable row level security;
alter table public.self_promise_checkins enable row level security;
create policy self_promises_own_rows on public.self_promises
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy self_promise_checkins_own_rows on public.self_promise_checkins
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and exists (
      select 1 from public.self_promises p
      where p.id = promise_id and p.owner_id = public.current_app_user_id()
    )
  );
create trigger self_promises_set_updated_at before update on public.self_promises
  for each row execute function public.set_updated_at();

commit;
