begin;

-- События календаря человека, которые присылает iOS-приложение (все календари
-- телефона: iCloud, Google, рабочий). Приложение каждый раз заменяет окно
-- «сегодня + 7 дней» целиком, поэтому удалённые на телефоне события здесь
-- тоже пропадают. Нужны Илзи, чтобы планировать день вокруг расписания.
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  source text not null check (source in ('ios')),
  external_id text not null check (char_length(external_id) between 1 and 300),
  title text not null check (char_length(title) between 1 and 300),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  location text check (location is null or char_length(location) <= 300),
  calendar_title text check (calendar_title is null or char_length(calendar_title) <= 120),
  created_at timestamptz not null default now(),
  unique (owner_id, source, external_id, starts_at)
);

create index calendar_events_owner_start_idx on public.calendar_events(owner_id, starts_at);

alter table public.calendar_events enable row level security;
create policy calendar_events_own_rows on public.calendar_events
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
