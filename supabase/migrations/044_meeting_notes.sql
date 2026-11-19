begin;

-- Заметки со встреч. Сам текст живёт в обычных заметках (public.notes), поэтому
-- он виден в «Заметках» на сайте и Илзи его знает. Здесь — привязка заметки к
-- событию календаря телефона. Таблица calendar_events каждый раз заменяется
-- окном с телефона, поэтому ключ — id события в календаре + время начала
-- (у повторяющейся встречи id общий), а название и время храним копией.
create table if not exists public.meeting_notes (
  owner_id uuid not null references public.users(id) on delete cascade,
  note_id uuid not null unique references public.notes(id) on delete cascade,
  event_external_id text not null check (char_length(event_external_id) between 1 and 300),
  event_starts_at timestamptz not null,
  event_ends_at timestamptz not null,
  event_title text not null check (char_length(event_title) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, event_external_id, event_starts_at)
);

create index if not exists meeting_notes_owner_updated_idx
  on public.meeting_notes(owner_id, updated_at desc);

alter table public.meeting_notes enable row level security;
drop policy if exists meeting_notes_own_rows on public.meeting_notes;
create policy meeting_notes_own_rows on public.meeting_notes
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
