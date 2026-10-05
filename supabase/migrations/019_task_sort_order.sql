begin;

alter table public.tasks
  add column if not exists sort_order integer;

create index if not exists tasks_owner_sort_idx
  on public.tasks (owner_id, sort_order);

comment on column public.tasks.sort_order is
  'Manual rank within a due-date bucket; lower comes first. Null means insertion order.';

commit;
