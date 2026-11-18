begin;

-- Вращения колеса «Удиви меня»: не больше трёх за день по местному времени
-- человека. Храним запрос, что было на колесе, что выпало и почему крутили
-- снова — чтобы следующее вращение это учло.
create table if not exists public.activity_spins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  local_date date not null,
  request jsonb not null default '{}'::jsonb,
  feedback text check (feedback is null or char_length(feedback) <= 500),
  segment_ids text[] not null default '{}',
  result_type_id text references public.activity_types(id) on update cascade on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists activity_spins_owner_day_idx
  on public.activity_spins(owner_id, local_date, created_at);

alter table public.activity_spins enable row level security;
drop policy if exists activity_spins_own_rows on public.activity_spins;
create policy activity_spins_own_rows on public.activity_spins
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
grant all on public.activity_spins to authenticated;

commit;
