begin;

-- Сессии с Илзи: человек выгружает всё из головы (голосом или текстом),
-- Илзи разбирает на дела, направления и мысли и помогает выбрать, что делать
-- сейчас. Здесь хранится сам рассказ, предложенный разбор и то, что человек
-- принял, — чтобы к разбору можно было вернуться и чтобы Илзи помнила прошлые
-- сессии.
create table if not exists public.life_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  mode text not null check (mode in ('unload', 'strategy', 'talk')),
  transcript text not null check (char_length(transcript) between 1 and 60000),
  proposal jsonb not null default '{}'::jsonb,
  summary text,
  result jsonb,
  note_id uuid references public.notes(id) on delete set null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists life_sessions_owner_created_idx
  on public.life_sessions(owner_id, created_at desc);

alter table public.life_sessions enable row level security;
drop policy if exists life_sessions_own_rows on public.life_sessions;
create policy life_sessions_own_rows on public.life_sessions
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
