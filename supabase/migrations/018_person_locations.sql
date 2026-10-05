begin;

create table public.person_locations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  label text check (label is null or char_length(label) between 1 and 80),
  city text not null check (char_length(city) between 1 and 120),
  address text check (address is null or char_length(address) between 1 and 400),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index person_locations_person_idx
  on public.person_locations(person_id, is_primary desc, created_at);

create unique index person_locations_one_primary_uidx
  on public.person_locations(person_id)
  where is_primary;

create trigger person_locations_set_updated_at before update on public.person_locations
  for each row execute function public.set_updated_at();

alter table public.person_locations enable row level security;
create policy person_locations_own_rows on public.person_locations
  for all using (exists (
    select 1 from public.people p
    where p.id = person_id and p.owner_id = public.current_app_user_id()
  ))
  with check (exists (
    select 1 from public.people p
    where p.id = person_id and p.owner_id = public.current_app_user_id()
  ));

commit;
