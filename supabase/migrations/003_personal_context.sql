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
