begin;

-- Где человек сейчас: город, который определил телефон (на самом iPhone),
-- и погода там. Одна строка — одно пребывание в городе: пока город тот же,
-- обновляется last_seen_at и погода; сменился город — новая строка. Так у Илзи
-- есть и «где ты сейчас», и история поездок. Точка округлена до ~10 км.
create table if not exists public.user_whereabouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  city text not null check (char_length(city) between 1 and 120),
  country text check (country is null or char_length(country) <= 120),
  lat numeric(4,1) check (lat is null or lat between -90 and 90),
  lon numeric(5,1) check (lon is null or lon between -180 and 180),
  timezone text check (timezone is null or char_length(timezone) <= 64),
  arrived_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  weather_temp real check (weather_temp is null or weather_temp between -90 and 70),
  weather_code smallint check (weather_code is null or weather_code between 0 and 99),
  weather_at timestamptz
);

create index if not exists user_whereabouts_owner_seen_idx
  on public.user_whereabouts(owner_id, last_seen_at desc);

alter table public.user_whereabouts enable row level security;
drop policy if exists user_whereabouts_own_rows on public.user_whereabouts;
create policy user_whereabouts_own_rows on public.user_whereabouts
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
