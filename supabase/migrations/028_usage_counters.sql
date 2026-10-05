begin;

create table public.usage_counters (
  owner_id uuid not null references public.users(id) on delete cascade,
  used_on date not null,
  metric text not null check (char_length(metric) between 1 and 40),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  completion_tokens bigint not null default 0 check (completion_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  call_count integer not null default 0 check (call_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (owner_id, used_on, metric)
);

create index usage_counters_owner_used_on_idx
  on public.usage_counters(owner_id, used_on desc);

alter table public.usage_counters enable row level security;
create policy usage_counters_own_rows on public.usage_counters
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

create or replace function public.increment_usage_counters(
  p_owner_id uuid,
  p_used_on date,
  p_metric text,
  p_prompt_tokens bigint,
  p_completion_tokens bigint,
  p_total_tokens bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.usage_counters (
    owner_id,
    used_on,
    metric,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    call_count
  )
  values (
    p_owner_id,
    p_used_on,
    p_metric,
    greatest(p_prompt_tokens, 0),
    greatest(p_completion_tokens, 0),
    greatest(p_total_tokens, 0),
    1
  )
  on conflict (owner_id, used_on, metric) do update set
    prompt_tokens = public.usage_counters.prompt_tokens + excluded.prompt_tokens,
    completion_tokens = public.usage_counters.completion_tokens + excluded.completion_tokens,
    total_tokens = public.usage_counters.total_tokens + excluded.total_tokens,
    call_count = public.usage_counters.call_count + 1,
    updated_at = now();
end;
$$;

grant execute on function public.increment_usage_counters(uuid, date, text, bigint, bigint, bigint)
  to service_role;

commit;
