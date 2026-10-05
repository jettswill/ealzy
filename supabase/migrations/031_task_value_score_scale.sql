begin;

update public.tasks
set value_score = -1
where value_score = -2;

alter table public.tasks drop constraint if exists tasks_value_score_check;
alter table public.tasks add constraint tasks_value_score_check
  check (value_score is null or value_score between -1 and 3);

comment on column public.tasks.value_score is
  'Optional user value: -1 ice, 0 neutral, 1 plus, 2 double plus, 3 triple plus.';

commit;
