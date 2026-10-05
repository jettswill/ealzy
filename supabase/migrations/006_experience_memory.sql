begin;

alter table public.recommendations
  add column experience_ids uuid[] not null default '{}';

alter table public.messages drop constraint if exists messages_intent_check;
alter table public.messages add constraint messages_intent_check check (
  intent is null or intent in (
    'remember','recommend','create_task','create_space','create_goal','create_project',
    'query_memory','companion','reflection','experience','other'
  )
);

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('restaurant','theater','trip','event','gift','activity','other')),
  title text not null check (char_length(title) between 1 and 300),
  place text,
  description text,
  occurred_at timestamptz,
  positive_signals text[] not null default '{}',
  negative_signals text[] not null default '{}',
  emotions text[] not null default '{}',
  outcome text,
  source_message_id uuid references public.messages(id) on delete set null,
  planned_task_id uuid references public.tasks(id) on delete set null,
  planned_space_id uuid references public.spaces(id) on delete set null,
  follow_up_at timestamptz,
  status text not null default 'planned'
    check (status in ('planned','completed','follow_up_due')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index experiences_owner_occurred_idx on public.experiences(owner_id, occurred_at desc);
create index experiences_owner_follow_up_idx on public.experiences(owner_id, follow_up_at)
  where follow_up_at is not null and status = 'planned';
create index experiences_source_message_idx on public.experiences(source_message_id);

create table public.experience_participants (
  experience_id uuid not null references public.experiences(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  primary key (experience_id, person_id)
);
create index experience_participants_person_idx on public.experience_participants(person_id);

create table public.experience_memory_updates (
  experience_id uuid not null references public.experiences(id) on delete cascade,
  memory_id uuid not null references public.memories(id) on delete cascade,
  signal text not null check (signal in ('positive','negative')),
  confirmed_at timestamptz not null default now(),
  primary key (experience_id, memory_id)
);
create index experience_memory_updates_memory_idx on public.experience_memory_updates(memory_id);

alter table public.experiences enable row level security;
alter table public.experience_participants enable row level security;
alter table public.experience_memory_updates enable row level security;
create policy experiences_own_rows on public.experiences
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and (source_message_id is null or exists (
      select 1 from public.messages m
      where m.id = source_message_id and m.owner_id = public.current_app_user_id()
    ))
    and (planned_task_id is null or exists (
      select 1 from public.tasks t
      where t.id = planned_task_id and t.owner_id = public.current_app_user_id()
    ))
    and (planned_space_id is null or exists (
      select 1 from public.spaces s
      where s.id = planned_space_id and s.owner_id = public.current_app_user_id()
    ))
  );
create policy experience_participants_own_rows on public.experience_participants
  for all using (exists (
    select 1 from public.experiences e
    where e.id = experience_id and e.owner_id = public.current_app_user_id()
  ))
  with check (
    exists (select 1 from public.experiences e where e.id = experience_id and e.owner_id = public.current_app_user_id())
    and exists (select 1 from public.people p where p.id = person_id and p.owner_id = public.current_app_user_id())
  );
create policy experience_memory_updates_own_rows on public.experience_memory_updates
  for all using (exists (
    select 1 from public.experiences e
    where e.id = experience_id and e.owner_id = public.current_app_user_id()
  ))
  with check (
    exists (select 1 from public.experiences e where e.id = experience_id and e.owner_id = public.current_app_user_id())
    and exists (
      select 1 from public.memories m join public.people p on p.id = m.person_id
      where m.id = memory_id and p.owner_id = public.current_app_user_id()
    )
  );
create trigger experiences_set_updated_at before update on public.experiences
  for each row execute function public.set_updated_at();

commit;
