begin;

alter table public.tasks
  add column if not exists activity_type text not null default 'routine',
  add column if not exists value_score smallint not null default 0;

alter table public.tasks drop constraint if exists tasks_activity_type_check;
alter table public.tasks add constraint tasks_activity_type_check
  check (
    activity_type in ('development', 'routine', 'entertainment', 'household', 'degradation')
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_value_score_check'
  ) then
    alter table public.tasks add constraint tasks_value_score_check
      check (value_score between -2 and 2);
  end if;
end $$;

create index if not exists tasks_owner_due_value_idx
  on public.tasks (owner_id, due_at, value_score desc);

comment on column public.tasks.activity_type is
  'User-facing activity type: development, routine, entertainment, household, or degradation.';
comment on column public.tasks.value_score is
  'User value from -2 (--) through 0 to 2 (++).';

commit;
