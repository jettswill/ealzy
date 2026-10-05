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
