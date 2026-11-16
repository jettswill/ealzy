begin;

-- Вход в iOS-приложение через Telegram: приложение создаёт одноразовый код,
-- человек открывает бота по ссылке t.me/<бот>?start=applogin_<код>, бот
-- подтверждает код за его аккаунтом, приложение забирает сессию. Код живёт
-- 10 минут и используется один раз. Таблица служебная: читает и пишет только
-- API под service_role, политик для пользователей нет.
create table public.app_login_requests (
  nonce text primary key check (char_length(nonce) between 24 and 64),
  owner_id uuid references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  consumed_at timestamptz
);

create index app_login_requests_created_idx on public.app_login_requests(created_at);

alter table public.app_login_requests enable row level security;

-- Устройства для push-уведомлений (APNs). Один токен — одно устройство;
-- если токен переехал на другой аккаунт, он переписывается.
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  platform text not null check (platform in ('ios')),
  push_token text not null check (char_length(push_token) between 16 and 512),
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, push_token)
);

create index devices_owner_idx on public.devices(owner_id);

create trigger devices_set_updated_at before update on public.devices
  for each row execute function public.set_updated_at();

alter table public.devices enable row level security;
create policy devices_own_rows on public.devices
  for all using (owner_id = public.current_app_user_id())
  with check (owner_id = public.current_app_user_id());

commit;
