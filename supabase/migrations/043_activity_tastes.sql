begin;

-- Вкусы человека по активностям: по типу или по целой категории.
--   verdict — сказал сам: «нравится» или «никогда не предлагай»;
--   visit_affinity — выведено из оценок после визитов, −1…1;
--   ai_affinity / ai_reason — гипотеза нейросети из того, что Илзи о нём знает.
-- Колесо и подборки Илзи берут из этого вес: «никогда» не показываем,
-- остальное делает вариант чаще или реже.
create table if not exists public.activity_preferences (
  owner_id uuid not null references public.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('type','category')),
  target_id text not null check (char_length(target_id) between 1 and 80),
  verdict text check (verdict in ('like','never')),
  visit_affinity real not null default 0 check (visit_affinity between -1 and 1),
  ai_affinity real not null default 0 check (ai_affinity between -1 and 1),
  ai_reason text check (ai_reason is null or char_length(ai_reason) <= 300),
  updated_at timestamptz not null default now(),
  primary key (owner_id, target_kind, target_id)
);

-- Когда нейросеть последний раз пересобирала гипотезы и что она думает в целом.
create table if not exists public.activity_taste_profiles (
  owner_id uuid primary key references public.users(id) on delete cascade,
  summary text check (summary is null or char_length(summary) <= 600),
  refreshed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Впечатление после визита: восторг / хорошо / так себе / не моё.
alter table public.place_visits add column if not exists emotion text
  check (emotion in ('wow','good','meh','bad'));

-- Места из внешних каталогов попадают в базу, только когда с ними что-то
-- сделали (хочу / был). Рейтинг — каталога, из которого место пришло.
alter table public.places add column if not exists rating numeric(2,1)
  check (rating is null or rating between 0 and 5);
alter table public.places add column if not exists rating_count integer
  check (rating_count is null or rating_count >= 0);
alter table public.places add column if not exists rating_source text;
create index if not exists places_geo_idx on public.places(lat, lon) where lat is not null;

alter table public.activity_preferences enable row level security;
alter table public.activity_taste_profiles enable row level security;
drop policy if exists activity_preferences_own_rows on public.activity_preferences;
create policy activity_preferences_own_rows on public.activity_preferences
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
drop policy if exists activity_taste_profiles_own_rows on public.activity_taste_profiles;
create policy activity_taste_profiles_own_rows on public.activity_taste_profiles
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
grant all on public.activity_preferences, public.activity_taste_profiles to authenticated;

commit;
