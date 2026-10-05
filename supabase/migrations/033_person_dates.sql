begin;

create table public.person_dates (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  kind text not null check (kind in ('birthday', 'met', 'wedding', 'anniversary', 'other')),
  label text check (label is null or char_length(label) between 1 and 80),
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  year integer check (year is null or year between 1800 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'other' or label is not null)
);

create index person_dates_person_idx
  on public.person_dates(person_id, month, day);

create unique index person_dates_unique_kind_uidx
  on public.person_dates(person_id, kind)
  where kind in ('birthday', 'met', 'wedding');

create trigger person_dates_set_updated_at before update on public.person_dates
  for each row execute function public.set_updated_at();

alter table public.person_dates enable row level security;
create policy person_dates_own_rows on public.person_dates
  for all using (exists (
    select 1 from public.people p
    where p.id = person_id and p.owner_id = public.current_app_user_id()
  ))
  with check (exists (
    select 1 from public.people p
    where p.id = person_id and p.owner_id = public.current_app_user_id()
  ));

commit;
