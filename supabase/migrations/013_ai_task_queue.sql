begin;

alter table public.tasks
  add column assignee text not null default 'user'
    check (assignee in ('user', 'ealzy')),
  add column agent_locked_at timestamptz,
  add column agent_attempts integer not null default 0
    check (agent_attempts >= 0),
  add column agent_result text;

create index tasks_ealzy_queue_idx
  on public.tasks (due_at, created_at)
  where assignee = 'ealzy' and status in ('todo', 'in_progress');

commit;
