begin;

-- Справочник того, чем можно заняться: категории → типы активностей.
-- Общий для всех людей, правится выкладкой (041 и следующие), читает API.
create table if not exists public.activity_categories (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  name text not null check (char_length(name) between 1 and 120),
  emoji text,
  sort smallint not null default 0
);

create table if not exists public.activity_types (
  id text primary key check (id ~ '^[a-z0-9-]{2,80}$'),
  category_id text not null references public.activity_categories(id) on update cascade,
  name text not null check (char_length(name) between 1 and 160),
  emoji text,
  description text check (description is null or char_length(description) <= 2000),
  -- 1 — сидя, 5 — выжимает все силы.
  activity_level smallint not null check (activity_level between 1 and 5),
  -- 1 — спокойно, 5 — адреналин и восторг.
  emotion_level smallint not null check (emotion_level between 1 and 5),
  -- 1 — до 1000 ₽, 2 — 1–3 тыс., 3 — 3–7 тыс., 4 — от 7 тыс. с человека.
  price_level smallint not null check (price_level between 1 and 4),
  duration_hours numeric(5,1) not null check (duration_hours > 0),
  season text not null check (season in ('all','warm','summer','winter')),
  setting text not null check (setting in ('indoor','outdoor','both')),
  min_people smallint not null default 1 check (min_people between 1 and 50),
  kids_ok boolean not null default false,
  -- Что искать на картах, чтобы найти конкретные места этого типа.
  search_query text,
  -- «любой крупный город», «загород», «СПб», «поездка»…
  geo text,
  sort integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists activity_types_category_idx on public.activity_types(category_id, sort);

-- Конкретные места. Одно место может подходить под несколько типов
-- (кофейня с баром), поэтому типы — в отдельной таблице связей.
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 300),
  city text,
  address text,
  lat double precision check (lat is null or lat between -90 and 90),
  lon double precision check (lon is null or lon between -180 and 180),
  description text check (description is null or char_length(description) <= 4000),
  image_url text,
  photos text[] not null default '{}',
  phone text,
  website text,
  hours text,
  price_from integer check (price_from is null or price_from >= 0),
  yandex_org_id text,
  yandex_url text,
  yandex_rating numeric(2,1) check (yandex_rating is null or yandex_rating between 0 and 5),
  yandex_reviews integer check (yandex_reviews is null or yandex_reviews >= 0),
  twogis_url text,
  source text not null default 'manual',
  source_id text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);
create unique index if not exists places_yandex_org_idx on public.places(yandex_org_id)
  where yandex_org_id is not null;
create index if not exists places_city_idx on public.places(city) where is_visible;

create table if not exists public.place_activity_types (
  place_id uuid not null references public.places(id) on delete cascade,
  activity_type_id text not null references public.activity_types(id)
    on update cascade on delete cascade,
  is_primary boolean not null default false,
  primary key (place_id, activity_type_id)
);
create index if not exists place_activity_types_type_idx
  on public.place_activity_types(activity_type_id);

-- Дневник человека: где был, куда хочет, что больше не предлагать.
-- Место может быть из справочника (place_id) или просто названием из чата.
create table if not exists public.place_visits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  place_id uuid references public.places(id) on delete set null,
  activity_type_id text references public.activity_types(id) on update cascade on delete set null,
  title text check (title is null or char_length(title) between 1 and 300),
  city text,
  status text not null default 'visited' check (status in ('visited','want','skip')),
  -- 1–5; null — оценки не было.
  rating smallint check (rating is null or rating between 1 and 5),
  note text check (note is null or char_length(note) <= 2000),
  visited_on date,
  experience_id uuid references public.experiences(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (place_id is not null or title is not null)
);
create index if not exists place_visits_owner_idx on public.place_visits(owner_id, updated_at desc);
create unique index if not exists place_visits_owner_place_idx
  on public.place_visits(owner_id, place_id) where place_id is not null;

alter table public.activity_categories enable row level security;
alter table public.activity_types enable row level security;
alter table public.places enable row level security;
alter table public.place_activity_types enable row level security;
alter table public.place_visits enable row level security;

drop policy if exists activity_categories_read on public.activity_categories;
create policy activity_categories_read on public.activity_categories for select using (true);
drop policy if exists activity_types_read on public.activity_types;
create policy activity_types_read on public.activity_types for select using (true);
drop policy if exists places_read on public.places;
create policy places_read on public.places for select using (is_visible);
drop policy if exists place_activity_types_read on public.place_activity_types;
create policy place_activity_types_read on public.place_activity_types for select using (true);
drop policy if exists place_visits_own_rows on public.place_visits;
create policy place_visits_own_rows on public.place_visits
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

grant select on public.activity_categories, public.activity_types, public.places,
  public.place_activity_types to authenticated;
grant all on public.place_visits to authenticated;

commit;
