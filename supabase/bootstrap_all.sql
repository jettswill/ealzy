create extension if not exists pgcrypto;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique check (telegram_id > 0),
  name text not null check (char_length(name) between 1 and 120),
  username text,
  created_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  relationship text,
  description text,
  created_at timestamptz not null default now()
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  category text not null check (char_length(category) between 1 and 80),
  importance smallint not null default 3 check (importance between 1 and 5),
  confidence numeric(4, 3) not null default 1 check (confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  type text not null check (char_length(type) between 1 and 80)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'assistant', 'system')),
  content text not null check (char_length(content) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index people_owner_id_idx on public.people(owner_id);
create index memories_person_id_idx on public.memories(person_id);
create index memories_category_idx on public.memories(category);
create index memories_content_search_idx
  on public.memories using gin (to_tsvector('simple', content));
create index spaces_owner_id_idx on public.spaces(owner_id);
create index tasks_space_id_idx on public.tasks(space_id);
create index messages_task_id_idx on public.messages(task_id);

comment on table public.memories is
  'Structured memory about a person; confidence is 0..1 and importance is 1..5.';
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
begin;

create table public.notes (
  id uuid primary key,
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 300),
  content jsonb not null default '{}',
  plain_text text not null default '',
  revision integer not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_owner_updated_idx on public.notes(owner_id, updated_at, id);
create index notes_plain_text_search_idx
  on public.notes using gin (to_tsvector('simple', coalesce(title, '') || ' ' || plain_text));

create table public.note_revisions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  title text not null default '' check (char_length(title) <= 300),
  content jsonb not null,
  plain_text text not null,
  deleted_at timestamptz,
  client_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  unique (note_id, revision),
  unique (note_id, client_mutation_id)
);
create index note_revisions_owner_note_idx
  on public.note_revisions(owner_id, note_id, revision);

create or replace function public.prevent_note_revision_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'note_revisions is append-only' using errcode = '55000';
end;
$$;
create trigger note_revisions_append_only
  before update or delete on public.note_revisions
  for each row execute function public.prevent_note_revision_change();

create table public.note_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  note_revision integer not null check (note_revision > 0),
  instruction text not null,
  proposal jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  confirmed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);
create index note_actions_owner_note_idx on public.note_actions(owner_id, note_id, created_at desc);

create or replace function public.mutate_note(
  p_owner_id uuid,
  p_note_id uuid,
  p_base_revision integer,
  p_client_mutation_id uuid,
  p_title text,
  p_content jsonb,
  p_plain_text text,
  p_delete boolean default false
) returns jsonb language plpgsql as $$
declare
  current_note public.notes%rowtype;
  previous_revision public.note_revisions%rowtype;
  next_revision integer;
  changed_at timestamptz := now();
begin
  select * into previous_revision from public.note_revisions
  where note_id = p_note_id and owner_id = p_owner_id
    and client_mutation_id = p_client_mutation_id;
  if found then
    return jsonb_build_object('status', 'ok', 'note', jsonb_build_object(
      'id', p_note_id, 'owner_id', p_owner_id, 'title', previous_revision.title,
      'content', previous_revision.content,
      'plain_text', previous_revision.plain_text, 'revision', previous_revision.revision,
      'deleted_at', previous_revision.deleted_at,
      'created_at', (select created_at from public.notes where id = p_note_id),
      'updated_at', previous_revision.created_at
    ));
  end if;

  select * into current_note from public.notes where id = p_note_id for update;
  if not found then
    if p_base_revision <> 0 or p_delete then
      return jsonb_build_object('status', 'not_found');
    end if;
    insert into public.notes(
      id, owner_id, title, content, plain_text, revision, deleted_at, created_at, updated_at
    )
    values (
      p_note_id, p_owner_id, p_title, p_content, p_plain_text, 1, null, changed_at, changed_at
    )
    returning * into current_note;
  else
    if current_note.owner_id <> p_owner_id then
      return jsonb_build_object('status', 'not_found');
    end if;
    if current_note.revision <> p_base_revision then
      return jsonb_build_object('status', 'conflict', 'note', to_jsonb(current_note));
    end if;
    next_revision := current_note.revision + 1;
    update public.notes
    set title = case when p_delete then title else p_title end,
        content = case when p_delete then content else p_content end,
        plain_text = case when p_delete then plain_text else p_plain_text end,
        revision = next_revision,
        deleted_at = case when p_delete then changed_at else null end,
        updated_at = changed_at
    where id = p_note_id returning * into current_note;
  end if;
  insert into public.note_revisions(
    note_id, owner_id, revision, title, content, plain_text, deleted_at,
    client_mutation_id, created_at
  ) values (
    current_note.id, current_note.owner_id, current_note.revision, current_note.title,
    current_note.content, current_note.plain_text, current_note.deleted_at,
    p_client_mutation_id, changed_at
  );
  return jsonb_build_object('status', 'ok', 'note', to_jsonb(current_note));
end;
$$;

create or replace function public.confirm_note_action(
  p_owner_id uuid,
  p_action_id uuid,
  p_proposal jsonb default null
)
returns jsonb language plpgsql as $$
declare
  action_row public.note_actions%rowtype;
  task_item jsonb;
  goal_id uuid;
  created_id uuid;
  created_ids uuid[] := '{}';
  result_value jsonb;
begin
  select * into action_row from public.note_actions
  where id = p_action_id and owner_id = p_owner_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if action_row.status = 'confirmed' then
    return jsonb_build_object('status', 'ok', 'action', to_jsonb(action_row));
  end if;
  action_row.proposal := coalesce(p_proposal, action_row.proposal);

  if action_row.proposal->>'kind' = 'goal' then
    insert into public.goals(owner_id, title, description, source_note_id)
    values (
      p_owner_id, action_row.proposal->'goal'->>'title',
      action_row.proposal->'goal'->>'description', action_row.note_id
    ) returning id into goal_id;
    result_value := jsonb_build_object('goal_id', goal_id);
  elsif action_row.proposal->>'kind' = 'tasks' then
    for task_item in select value from jsonb_array_elements(action_row.proposal->'tasks') loop
      insert into public.tasks(owner_id, title, description, due_at, source_note_id)
      values (
        p_owner_id, task_item->>'title', task_item->>'description',
        nullif(task_item->>'due_at', '')::timestamptz, action_row.note_id
      ) returning id into created_id;
      created_ids := array_append(created_ids, created_id);
    end loop;
    result_value := jsonb_build_object('task_ids', to_jsonb(created_ids));
  elsif action_row.proposal->>'kind' = 'plan' then
    insert into public.goals(
      owner_id, title, description, current_plan, plan_revised_at, source_note_id
    ) values (
      p_owner_id, action_row.proposal->>'title',
      action_row.proposal->>'description', action_row.proposal->>'current_plan',
      now(), action_row.note_id
    ) returning id into goal_id;
    for task_item in select value from jsonb_array_elements(action_row.proposal->'tasks') loop
      insert into public.tasks(owner_id, goal_id, title, description, due_at, source_note_id)
      values (
        p_owner_id, goal_id, task_item->>'title', task_item->>'description',
        nullif(task_item->>'due_at', '')::timestamptz, action_row.note_id
      ) returning id into created_id;
      created_ids := array_append(created_ids, created_id);
    end loop;
    result_value := jsonb_build_object('goal_id', goal_id, 'task_ids', to_jsonb(created_ids));
  else
    raise exception 'Invalid note action kind' using errcode = '23514';
  end if;
  update public.note_actions set proposal = action_row.proposal,
    status = 'confirmed', confirmed_at = now(), result = result_value
  where id = action_row.id returning * into action_row;
  return jsonb_build_object('status', 'ok', 'action', to_jsonb(action_row));
end;
$$;

alter table public.notes enable row level security;
alter table public.note_revisions enable row level security;
alter table public.note_actions enable row level security;
create policy notes_own_rows on public.notes for all
  using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy note_revisions_own_rows on public.note_revisions for all
  using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id() and exists (
      select 1 from public.notes n
      where n.id = note_id and n.owner_id = public.current_app_user_id()
    )
  );
create policy note_actions_own_rows on public.note_actions for all
  using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id() and exists (
      select 1 from public.notes n
      where n.id = note_id and n.owner_id = public.current_app_user_id()
    )
  );

commit;
begin;

alter table public.tasks
  add column if not exists recurrence_frequency text
    check (recurrence_frequency in ('daily', 'weekly', 'monthly')),
  add column if not exists recurrence_series_id uuid,
  add column if not exists recurrence_anchor_at timestamptz,
  add column if not exists recurrence_template jsonb;

create unique index if not exists tasks_recurrence_instance_uidx
  on public.tasks (recurrence_series_id, recurrence_anchor_at)
  where recurrence_series_id is not null and recurrence_anchor_at is not null;

create index if not exists tasks_owner_recurrence_idx
  on public.tasks (owner_id, recurrence_series_id)
  where recurrence_series_id is not null;

commit;
begin;

alter table public.people add column is_self boolean not null default false;
create unique index people_one_self_per_owner_uidx
  on public.people(owner_id) where is_self;

create table public.user_profiles (
  owner_id uuid primary key references public.users(id) on delete cascade,
  self_person_id uuid not null unique references public.people(id) on delete cascade,
  bio text,
  values text[] not null default '{}',
  communication_style text,
  timezone text not null default 'UTC',
  locale text not null default 'ru',
  context_summary text,
  weekly_reflection_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'companion' check (kind in ('companion','system')),
  mode text not null default 'companion' check (mode in ('command','companion')),
  title text,
  summary text,
  is_primary boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index conversations_primary_owner_uidx
  on public.conversations(owner_id) where is_primary;
create index conversations_owner_last_message_idx
  on public.conversations(owner_id, last_message_at desc);

insert into public.people(owner_id, name, relationship, is_self)
select u.id, u.name, 'self', true from public.users u
where not exists (select 1 from public.people p where p.owner_id = u.id and p.is_self);

insert into public.user_profiles(owner_id, self_person_id)
select p.owner_id, p.id from public.people p where p.is_self
on conflict (owner_id) do nothing;

insert into public.conversations(owner_id, title, is_primary)
select id, 'LifeOS', true from public.users
on conflict do nothing;

alter table public.messages
  add column conversation_id uuid references public.conversations(id) on delete cascade,
  add column source_channel text not null default 'telegram'
    check (source_channel in ('telegram','mini_app','system')),
  add column metadata jsonb not null default '{}';
update public.messages m set conversation_id = c.id
from public.conversations c where c.owner_id = m.owner_id and c.is_primary;
alter table public.messages
  alter column conversation_id set not null,
  alter column telegram_chat_id drop not null,
  alter column telegram_message_id drop not null;
drop index if exists public.messages_telegram_chat_message_uidx;
create unique index messages_telegram_chat_message_uidx
  on public.messages(telegram_chat_id, telegram_message_id)
  where telegram_chat_id is not null and telegram_message_id is not null;
create index messages_conversation_created_idx
  on public.messages(conversation_id, created_at desc);

alter table public.user_profiles enable row level security;
alter table public.conversations enable row level security;
create policy user_profiles_own_rows on public.user_profiles
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy conversations_own_rows on public.conversations
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

create trigger user_profiles_set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();
create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create or replace function public.provision_personal_context()
returns trigger language plpgsql security definer set search_path = public as $$
declare self_id uuid;
begin
  select id into self_id from public.people where owner_id = new.id and is_self limit 1;
  if self_id is null then
    insert into public.people(owner_id, name, relationship, is_self)
    values (new.id, new.name, 'self', true) returning id into self_id;
  end if;
  insert into public.user_profiles(owner_id, self_person_id)
    values (new.id, self_id) on conflict (owner_id) do nothing;
  insert into public.conversations(owner_id, title, is_primary)
    values (new.id, 'LifeOS', true) on conflict do nothing;
  return new;
end;
$$;
create trigger users_provision_personal_context
  after insert on public.users for each row execute function public.provision_personal_context();

commit;
begin;

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text,
  status text not null default 'active'
    check (status in ('active','completed','paused','cancelled')),
  horizon text check (horizon is null or horizon in ('short','medium','long')),
  priority smallint not null default 3 check (priority between 1 and 5),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_owner_status_idx on public.goals(owner_id, status, priority);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  space_id uuid references public.spaces(id) on delete set null,
  name text not null check (char_length(name) between 1 and 300),
  description text,
  status text not null default 'active'
    check (status in ('active','completed','paused','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner_status_idx on public.projects(owner_id, status);
create index projects_goal_id_idx on public.projects(goal_id);

alter table public.tasks
  add column goal_id uuid references public.goals(id) on delete set null,
  add column project_id uuid references public.projects(id) on delete set null,
  add column due_at timestamptz,
  add column completed_at timestamptz;
create index tasks_goal_id_idx on public.tasks(goal_id);
create index tasks_project_id_idx on public.tasks(project_id);

drop policy if exists tasks_own_rows on public.tasks;
create policy tasks_own_rows on public.tasks
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and (goal_id is null or exists (
      select 1 from public.goals g
      where g.id = goal_id and g.owner_id = public.current_app_user_id()
    ))
    and (project_id is null or exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = public.current_app_user_id()
    ))
  );

alter table public.goals enable row level security;
alter table public.projects enable row level security;
create policy goals_own_rows on public.goals
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy projects_own_rows on public.projects
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and (goal_id is null or exists (
      select 1 from public.goals g where g.id = goal_id and g.owner_id = public.current_app_user_id()
    ))
    and (space_id is null or exists (
      select 1 from public.spaces s where s.id = space_id and s.owner_id = public.current_app_user_id()
    ))
  );
create trigger goals_set_updated_at before update on public.goals
  for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

commit;
begin;

alter table public.memories drop constraint if exists memories_category_check;
alter table public.memories add constraint memories_category_check check (category in (
  'interest','dislike','favorite_place','favorite_food','gift','size','dream',
  'important_date','story','personality','experience','preference','skill',
  'important_event','important_fact','other'
));
alter table public.memories
  add column occurred_at timestamptz,
  add column metadata jsonb not null default '{}';

alter table public.messages drop constraint if exists messages_intent_check;
alter table public.messages add constraint messages_intent_check check (
  intent is null or intent in (
    'remember','recommend','create_task','create_space','create_goal','create_project',
    'query_memory','companion','reflection','other'
  )
);

create table public.recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null references public.recommendations(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  item_index smallint not null check (item_index between 0 and 4),
  outcome text not null check (outcome in ('liked','disliked','used')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(recommendation_id, item_index)
);
create index recommendation_feedback_owner_created_idx
  on public.recommendation_feedback(owner_id, created_at desc);

create table public.reflections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  wins jsonb not null default '[]' check (jsonb_typeof(wins) = 'array'),
  improvements jsonb not null default '[]' check (jsonb_typeof(improvements) = 'array'),
  next_steps jsonb not null default '[]' check (jsonb_typeof(next_steps) = 'array'),
  source_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);
create index reflections_owner_period_idx on public.reflections(owner_id, period_end desc);

alter table public.recommendation_feedback enable row level security;
alter table public.reflections enable row level security;
create policy recommendation_feedback_own_rows on public.recommendation_feedback
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and exists (
      select 1 from public.recommendations r
      where r.id = recommendation_id and r.owner_id = public.current_app_user_id()
    )
  );
create policy reflections_own_rows on public.reflections
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create trigger recommendation_feedback_set_updated_at
  before update on public.recommendation_feedback
  for each row execute function public.set_updated_at();

commit;
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
begin;

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.app_user_id', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_user_id'
  )::uuid
$$;

create table public.beta_metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (name in (
    'first_self_fact',
    'personal_recommendation',
    'companion_week_2',
    'reflection_completed'
  )),
  properties jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(owner_id, name)
);

create index beta_metrics_name_created_idx on public.beta_metrics(name, created_at);

alter table public.beta_metrics enable row level security;
create policy beta_metrics_own_rows on public.beta_metrics
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
begin;

alter table public.user_profiles
  add column if not exists morning_digest_enabled boolean not null default false,
  add column if not exists morning_digest_time text not null default '08:00',
  add column if not exists weekly_digest_enabled boolean not null default false,
  add column if not exists weekly_digest_time text not null default '09:00',
  add column if not exists evening_sync_enabled boolean not null default false,
  add column if not exists evening_sync_time text not null default '21:00',
  add column if not exists last_morning_digest_on date,
  add column if not exists last_weekly_digest_on date,
  add column if not exists last_evening_sync_on date;

alter table public.user_profiles
  drop constraint if exists user_profiles_morning_digest_time_check,
  drop constraint if exists user_profiles_weekly_digest_time_check,
  drop constraint if exists user_profiles_evening_sync_time_check;

alter table public.user_profiles
  add constraint user_profiles_morning_digest_time_check
    check (morning_digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint user_profiles_weekly_digest_time_check
    check (weekly_digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint user_profiles_evening_sync_time_check
    check (evening_sync_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create index if not exists user_profiles_morning_digest_idx
  on public.user_profiles(owner_id) where morning_digest_enabled;
create index if not exists user_profiles_weekly_digest_idx
  on public.user_profiles(owner_id) where weekly_digest_enabled;
create index if not exists user_profiles_evening_sync_idx
  on public.user_profiles(owner_id) where evening_sync_enabled;

commit;
begin;

alter table public.users
  alter column telegram_id drop not null;

alter table public.users
  drop constraint if exists users_telegram_id_check;

alter table public.users
  add constraint users_telegram_id_check
    check (telegram_id is null or telegram_id > 0);

alter table public.users
  add column if not exists auth_user_id uuid unique,
  add column if not exists email text;

alter table public.users
  drop constraint if exists users_identity_present_check;

alter table public.users
  add constraint users_identity_present_check
    check (telegram_id is not null or auth_user_id is not null);

create unique index if not exists users_email_lower_uidx
  on public.users (lower(email))
  where email is not null;

commit;

begin;

create table if not exists public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  email text not null,
  provider text not null default 'custom',
  username text not null,
  imap_host text not null,
  imap_port integer not null default 993,
  smtp_host text not null,
  smtp_port integer not null default 465,
  secret_cipher text not null,
  status text not null default 'active',
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, email)
);

create index if not exists mail_accounts_owner_idx on public.mail_accounts (owner_id);
create index if not exists mail_accounts_sync_idx on public.mail_accounts (status, last_synced_at);

create table if not exists public.mail_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  provider_uid text not null,
  from_address text not null default '',
  from_name text,
  to_address text,
  subject text not null default '',
  snippet text not null default '',
  received_at timestamptz,
  is_important boolean not null default false,
  is_meeting boolean not null default false,
  meeting_at timestamptz,
  has_calendar_invite boolean not null default false,
  handled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_uid)
);

create index if not exists mail_messages_owner_idx
  on public.mail_messages (owner_id, received_at desc);
create index if not exists mail_messages_important_idx
  on public.mail_messages (owner_id, is_important, handled, received_at desc);

create table if not exists public.mail_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  account_id uuid not null references public.mail_accounts(id) on delete cascade,
  message_id uuid references public.mail_messages(id) on delete set null,
  to_address text not null,
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft',
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mail_drafts_owner_idx
  on public.mail_drafts (owner_id, created_at desc);

create table if not exists public.mail_playbooks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  account_id uuid references public.mail_accounts(id) on delete cascade,
  name text not null,
  trigger text not null,
  actions text[] not null default '{}',
  prompt text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mail_playbooks_owner_idx on public.mail_playbooks (owner_id);

commit;
begin;

alter table public.tasks
  add column if not exists kind text not null default 'task',
  add column if not exists importance smallint not null default 3,
  add column if not exists urgency smallint not null default 3;
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check
  check (kind in ('task', 'meeting'));
alter table public.tasks drop constraint if exists tasks_importance_check;
alter table public.tasks add constraint tasks_importance_check
  check (importance between 1 and 5);
alter table public.tasks drop constraint if exists tasks_urgency_check;
alter table public.tasks add constraint tasks_urgency_check
  check (urgency between 1 and 5);
create index if not exists tasks_owner_push_idx
  on public.tasks (owner_id, status, importance, urgency);

commit;
begin;

alter table public.tasks
  add column if not exists sort_order integer;
create index if not exists tasks_owner_sort_idx
  on public.tasks (owner_id, sort_order);

commit;
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
begin;

alter table public.goals
  add column source_note_id uuid references public.notes(id) on delete set null;
alter table public.tasks
  add column source_note_id uuid references public.notes(id) on delete set null;
create index goals_source_note_idx on public.goals(owner_id, source_note_id);
create index tasks_source_note_idx on public.tasks(owner_id, source_note_id);
create policy goals_source_note_own_rows on public.goals as restrictive
  for all using (
    source_note_id is null or exists (
      select 1 from public.notes n
      where n.id = source_note_id and n.owner_id = public.current_app_user_id()
    )
  )
  with check (
    source_note_id is null or exists (
      select 1 from public.notes n
      where n.id = source_note_id and n.owner_id = public.current_app_user_id()
    )
  );
create policy tasks_source_note_own_rows on public.tasks as restrictive
  for all using (
    source_note_id is null or exists (
      select 1 from public.notes n
      where n.id = source_note_id and n.owner_id = public.current_app_user_id()
    )
  )
  with check (
    source_note_id is null or exists (
      select 1 from public.notes n
      where n.id = source_note_id and n.owner_id = public.current_app_user_id()
    )
  );

commit;
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
