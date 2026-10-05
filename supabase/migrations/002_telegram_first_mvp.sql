begin;

alter table public.people add column updated_at timestamptz not null default now();
create index people_owner_lower_name_idx on public.people(owner_id, lower(name));

create table public.person_aliases (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  alias text not null check (char_length(alias) between 1 and 120)
);
create unique index person_aliases_person_lower_alias_uidx
  on public.person_aliases(person_id, lower(alias));
create index person_aliases_lower_alias_idx on public.person_aliases(lower(alias));

alter table public.memories
  add column source_message_id uuid,
  add column status text not null default 'active'
    check (status in ('active', 'archived')),
  add column updated_at timestamptz not null default now();
alter table public.memories drop constraint if exists memories_category_check;
alter table public.memories add constraint memories_category_check
  check (category in ('interest','dislike','dream','size','important_fact','experience','other'));
create unique index memories_person_category_content_uidx
  on public.memories(person_id, category, lower(regexp_replace(btrim(content), '\s+', ' ', 'g')));

alter table public.spaces
  add column context text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

create table public.space_people (
  space_id uuid not null references public.spaces(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  primary key (space_id, person_id)
);
create index space_people_person_id_idx on public.space_people(person_id);

alter table public.tasks
  add column owner_id uuid references public.users(id) on delete cascade,
  add column person_id uuid references public.people(id) on delete set null,
  add column updated_at timestamptz not null default now();
update public.tasks t set owner_id = s.owner_id from public.spaces s where s.id = t.space_id;
alter table public.tasks alter column owner_id set not null;
alter table public.tasks alter column space_id drop not null;
update public.tasks set status = 'todo' where status = 'open';
alter table public.tasks add constraint tasks_status_check
  check (status in ('todo','in_progress','done','cancelled'));
create index tasks_owner_id_idx on public.tasks(owner_id);
create index tasks_person_id_idx on public.tasks(person_id);

alter table public.messages
  add column owner_id uuid references public.users(id) on delete cascade,
  add column telegram_chat_id bigint,
  add column telegram_message_id bigint,
  add column role text,
  add column intent text;
update public.messages m
set owner_id = s.owner_id
from public.tasks t join public.spaces s on s.id = t.space_id
where t.id = m.task_id;
update public.messages set role = sender_type;
with numbered as (
  select m.id, u.telegram_id, -row_number() over (partition by u.telegram_id order by m.created_at, m.id) as synthetic_id
  from public.messages m join public.users u on u.id = m.owner_id
)
update public.messages m
set telegram_chat_id = n.telegram_id, telegram_message_id = n.synthetic_id
from numbered n where n.id = m.id;
alter table public.messages
  alter column owner_id set not null,
  alter column telegram_chat_id set not null,
  alter column telegram_message_id set not null,
  alter column role set not null,
  add constraint messages_role_check check (role in ('user','assistant','system')),
  add constraint messages_intent_check check (
    intent is null or intent in ('remember','recommend','create_task','create_space','query_memory','other')
  );
alter table public.memories add constraint memories_source_message_id_fkey
  foreign key (source_message_id) references public.messages(id) on delete set null;
drop index if exists public.messages_task_id_idx;
alter table public.messages drop column task_id;
alter table public.messages drop column sender_type;
create unique index messages_telegram_chat_message_uidx
  on public.messages(telegram_chat_id, telegram_message_id);
create index messages_owner_created_idx on public.messages(owner_id, created_at desc);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  person_id uuid references public.people(id) on delete set null,
  space_id uuid references public.spaces(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  query text not null check (char_length(query) between 1 and 4000),
  items jsonb not null check (
    jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 3 and 5
  ),
  memory_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index recommendations_owner_created_idx on public.recommendations(owner_id, created_at desc);

create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  telegram_chat_id bigint not null,
  action text not null,
  payload jsonb not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index pending_actions_owner_chat_idx on public.pending_actions(owner_id, telegram_chat_id);
create index pending_actions_expires_idx on public.pending_actions(expires_at);

create table public.telegram_updates (
  update_id bigint primary key,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger people_set_updated_at before update on public.people
  for each row execute function public.set_updated_at();
create trigger memories_set_updated_at before update on public.memories
  for each row execute function public.set_updated_at();
create trigger spaces_set_updated_at before update on public.spaces
  for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.app_user_id', true), '')::uuid
$$;

alter table public.users enable row level security;
alter table public.people enable row level security;
alter table public.person_aliases enable row level security;
alter table public.memories enable row level security;
alter table public.spaces enable row level security;
alter table public.space_people enable row level security;
alter table public.tasks enable row level security;
alter table public.messages enable row level security;
alter table public.recommendations enable row level security;
alter table public.pending_actions enable row level security;
alter table public.telegram_updates enable row level security;

create policy users_own_rows on public.users
  for all using (id = public.current_app_user_id())
  with check (id = public.current_app_user_id());
create policy people_own_rows on public.people
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy aliases_own_rows on public.person_aliases
  for all using (exists (
    select 1 from public.people p
    where p.id = person_id and p.owner_id = public.current_app_user_id()
  ))
  with check (exists (
    select 1 from public.people p
    where p.id = person_id and p.owner_id = public.current_app_user_id()
  ));
create policy memories_own_rows on public.memories
  for all using (exists (
    select 1 from public.people p
    where p.id = person_id and p.owner_id = public.current_app_user_id()
  ))
  with check (exists (
    select 1 from public.people p
    where p.id = person_id and p.owner_id = public.current_app_user_id()
  ));
create policy spaces_own_rows on public.spaces
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy space_people_own_rows on public.space_people
  for all using (exists (
    select 1 from public.spaces s
    where s.id = space_id and s.owner_id = public.current_app_user_id()
  ))
  with check (
    exists (
      select 1 from public.spaces s
      where s.id = space_id and s.owner_id = public.current_app_user_id()
    )
    and exists (
      select 1 from public.people p
      where p.id = person_id and p.owner_id = public.current_app_user_id()
    )
  );
create policy tasks_own_rows on public.tasks
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy messages_own_rows on public.messages
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy recommendations_own_rows on public.recommendations
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy pending_actions_own_rows on public.pending_actions
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
