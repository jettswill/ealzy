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

comment on column public.tasks.kind is 'task = ordinary work item; meeting = dated appointment.';
comment on column public.tasks.importance is '1 low .. 5 high; with urgency, Ealzy nudges the owner.';
comment on column public.tasks.urgency is '1 low .. 5 high; 4+ with importance 4+ is a push item.';

commit;
