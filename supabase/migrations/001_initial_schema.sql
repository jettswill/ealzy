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
