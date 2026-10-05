begin;

alter table public.tasks
  alter column activity_type drop not null,
  alter column activity_type drop default,
  alter column value_score drop not null,
  alter column value_score drop default;

-- Migration 029 backfilled these defaults before either field could be left unselected.
update public.tasks
set activity_type = null,
    value_score = null
where activity_type = 'routine'
  and value_score = 0;

comment on column public.tasks.activity_type is
  'Optional user-facing activity type: development, routine, entertainment, household, or degradation.';
comment on column public.tasks.value_score is
  'Optional user value from -2 (--) through 0 to 2 (++).';

commit;
