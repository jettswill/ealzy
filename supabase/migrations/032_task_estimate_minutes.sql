begin;

alter table public.tasks
  add column if not exists estimate_minutes integer;

alter table public.tasks drop constraint if exists tasks_estimate_minutes_check;
alter table public.tasks add constraint tasks_estimate_minutes_check
  check (estimate_minutes is null or (estimate_minutes >= 1 and estimate_minutes <= 480));

comment on column public.tasks.estimate_minutes is
  'Optional effort estimate in minutes; shown next to due time, before value.';

commit;
