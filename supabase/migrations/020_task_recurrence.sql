begin;

alter table public.tasks
  add column if not exists recurrence_frequency text
    check (recurrence_frequency in ('daily', 'weekly', 'monthly')),
  add column if not exists recurrence_series_id uuid,
  add column if not exists recurrence_anchor_at timestamptz,
  add column if not exists recurrence_template jsonb;

create unique index if not exists tasks_recurrence_instance_uidx
  on public.tasks (recurrence_series_id, recurrence_anchor_at)
  where recurrence_series_id is not null and recurrence_anchor_at is not null;

create index if not exists tasks_owner_recurrence_idx
  on public.tasks (owner_id, recurrence_series_id)
  where recurrence_series_id is not null;

commit;
