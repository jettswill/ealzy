begin;

-- Почасовой учёт токенов: нужен для лимита «за последние N часов».
create table public.usage_hours (
  owner_id uuid not null references public.users(id) on delete cascade,
  hour_start timestamptz not null,
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  call_count integer not null default 0 check (call_count >= 0),
  primary key (owner_id, hour_start)
);

alter table public.usage_hours enable row level security;
create policy usage_hours_own_rows on public.usage_hours
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

-- Тот же вызов, что и раньше, теперь пишет ещё и почасовой счётчик.
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
    owner_id, used_on, metric, prompt_tokens, completion_tokens, total_tokens, call_count
  )
  values (
    p_owner_id, p_used_on, p_metric,
    greatest(p_prompt_tokens, 0), greatest(p_completion_tokens, 0), greatest(p_total_tokens, 0), 1
  )
  on conflict (owner_id, used_on, metric) do update set
    prompt_tokens = public.usage_counters.prompt_tokens + excluded.prompt_tokens,
    completion_tokens = public.usage_counters.completion_tokens + excluded.completion_tokens,
    total_tokens = public.usage_counters.total_tokens + excluded.total_tokens,
    call_count = public.usage_counters.call_count + 1,
    updated_at = now();

  insert into public.usage_hours (owner_id, hour_start, total_tokens, call_count)
  values (p_owner_id, date_trunc('hour', now()), greatest(p_total_tokens, 0), 1)
  on conflict (owner_id, hour_start) do update set
    total_tokens = public.usage_hours.total_tokens + excluded.total_tokens,
    call_count = public.usage_hours.call_count + 1;
end;
$$;

-- Тарифы. 0 в лимите — без ограничения.
create table public.quota_plans (
  plan text primary key check (plan ~ '^[a-z][a-z0-9_]{1,30}$'),
  title text not null check (char_length(title) between 1 and 60),
  period text not null check (period in ('week', 'month')),
  period_tokens bigint not null check (period_tokens >= 0),
  window_hours integer not null check (window_hours between 1 and 168),
  window_tokens bigint not null check (window_tokens >= 0),
  updated_at timestamptz not null default now()
);

insert into public.quota_plans (plan, title, period, period_tokens, window_hours, window_tokens) values
  ('free', 'Бесплатно', 'week', 150000, 5, 50000),
  ('pro', 'Подписка', 'month', 3000000, 5, 300000),
  ('unlimited', 'Без лимита', 'month', 0, 5, 0);

-- Общие настройки лимитов: пока выключены, включаются в админке.
create table public.quota_settings (
  id boolean primary key default true check (id),
  enforced boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.quota_settings (id, enforced) values (true, false);

-- Тариф пользователя; нет строки — бесплатный.
create table public.user_plans (
  owner_id uuid primary key references public.users(id) on delete cascade,
  plan text not null references public.quota_plans(plan),
  plan_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Кто может менять лимиты.
create table public.app_admins (
  owner_id uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.quota_plans enable row level security;
alter table public.quota_settings enable row level security;
alter table public.user_plans enable row level security;
alter table public.app_admins enable row level security;

commit;
