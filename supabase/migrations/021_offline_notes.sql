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

alter table public.goals
  add column source_note_id uuid references public.notes(id) on delete set null;
alter table public.tasks
  add column source_note_id uuid references public.notes(id) on delete set null;
create index goals_source_note_idx on public.goals(owner_id, source_note_id);
create index tasks_source_note_idx on public.tasks(owner_id, source_note_id);

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
) returns jsonb
language plpgsql
as $$
declare
  current_note public.notes%rowtype;
  previous_revision public.note_revisions%rowtype;
  next_revision integer;
  changed_at timestamptz := now();
begin
  select * into previous_revision
  from public.note_revisions
  where note_id = p_note_id
    and owner_id = p_owner_id
    and client_mutation_id = p_client_mutation_id;

  if found then
    return jsonb_build_object(
      'status', 'ok',
      'note', jsonb_build_object(
        'id', p_note_id,
        'owner_id', p_owner_id,
        'title', previous_revision.title,
        'content', previous_revision.content,
        'plain_text', previous_revision.plain_text,
        'revision', previous_revision.revision,
        'deleted_at', previous_revision.deleted_at,
        'created_at', (select created_at from public.notes where id = p_note_id),
        'updated_at', previous_revision.created_at
      )
    );
  end if;

  select * into current_note from public.notes where id = p_note_id for update;

  if not found then
    if p_base_revision <> 0 or p_delete then
      return jsonb_build_object('status', 'not_found');
    end if;
    insert into public.notes (
      id, owner_id, title, content, plain_text, revision, deleted_at, created_at, updated_at
    ) values (
      p_note_id, p_owner_id, p_title, p_content, p_plain_text, 1, null, changed_at, changed_at
    ) returning * into current_note;
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
    where id = p_note_id
    returning * into current_note;
  end if;

  insert into public.note_revisions (
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
returns jsonb
language plpgsql
as $$
declare
  action_row public.note_actions%rowtype;
  task_item jsonb;
  goal_id uuid;
  created_id uuid;
  created_ids uuid[] := '{}';
  result_value jsonb;
begin
  select * into action_row
  from public.note_actions
  where id = p_action_id and owner_id = p_owner_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if action_row.status = 'confirmed' then
    return jsonb_build_object('status', 'ok', 'action', to_jsonb(action_row));
  end if;
  action_row.proposal := coalesce(p_proposal, action_row.proposal);

  if action_row.proposal->>'kind' = 'goal' then
    insert into public.goals(owner_id, title, description, source_note_id)
    values (
      p_owner_id,
      action_row.proposal->'goal'->>'title',
      action_row.proposal->'goal'->>'description',
      action_row.note_id
    ) returning id into goal_id;
    result_value := jsonb_build_object('goal_id', goal_id);
  elsif action_row.proposal->>'kind' = 'tasks' then
    for task_item in select value from jsonb_array_elements(action_row.proposal->'tasks')
    loop
      insert into public.tasks(owner_id, title, description, due_at, source_note_id)
      values (
        p_owner_id,
        task_item->>'title',
        task_item->>'description',
        nullif(task_item->>'due_at', '')::timestamptz,
        action_row.note_id
      ) returning id into created_id;
      created_ids := array_append(created_ids, created_id);
    end loop;
    result_value := jsonb_build_object('task_ids', to_jsonb(created_ids));
  elsif action_row.proposal->>'kind' = 'plan' then
    insert into public.goals(
      owner_id, title, description, current_plan, plan_revised_at, source_note_id
    ) values (
      p_owner_id,
      action_row.proposal->>'title',
      action_row.proposal->>'description',
      action_row.proposal->>'current_plan',
      now(),
      action_row.note_id
    ) returning id into goal_id;
    for task_item in select value from jsonb_array_elements(action_row.proposal->'tasks')
    loop
      insert into public.tasks(owner_id, goal_id, title, description, due_at, source_note_id)
      values (
        p_owner_id,
        goal_id,
        task_item->>'title',
        task_item->>'description',
        nullif(task_item->>'due_at', '')::timestamptz,
        action_row.note_id
      ) returning id into created_id;
      created_ids := array_append(created_ids, created_id);
    end loop;
    result_value := jsonb_build_object('goal_id', goal_id, 'task_ids', to_jsonb(created_ids));
  else
    raise exception 'Invalid note action kind' using errcode = '23514';
  end if;

  update public.note_actions
  set proposal = action_row.proposal,
      status = 'confirmed',
      confirmed_at = now(),
      result = result_value
  where id = action_row.id
  returning * into action_row;
  return jsonb_build_object('status', 'ok', 'action', to_jsonb(action_row));
end;
$$;

alter table public.notes enable row level security;
alter table public.note_revisions enable row level security;
alter table public.note_actions enable row level security;

create policy notes_own_rows on public.notes
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());
create policy note_revisions_own_rows on public.note_revisions
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.owner_id = public.current_app_user_id()
    )
  );
create policy note_actions_own_rows on public.note_actions
  for all using (owner_id = public.current_app_user_id())
  with check (
    owner_id = public.current_app_user_id()
    and exists (
      select 1 from public.notes n
      where n.id = note_id and n.owner_id = public.current_app_user_id()
    )
  );
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
