begin;

alter table public.user_profiles
  add column if not exists morning_digest_enabled boolean not null default false,
  add column if not exists morning_digest_time text not null default '08:00',
  add column if not exists weekly_digest_enabled boolean not null default false,
  add column if not exists weekly_digest_time text not null default '09:00',
  add column if not exists evening_sync_enabled boolean not null default false,
  add column if not exists evening_sync_time text not null default '21:00',
  add column if not exists last_morning_digest_on date,
  add column if not exists last_weekly_digest_on date,
  add column if not exists last_evening_sync_on date;

alter table public.user_profiles
  drop constraint if exists user_profiles_morning_digest_time_check,
  drop constraint if exists user_profiles_weekly_digest_time_check,
  drop constraint if exists user_profiles_evening_sync_time_check;

alter table public.user_profiles
  add constraint user_profiles_morning_digest_time_check
    check (morning_digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint user_profiles_weekly_digest_time_check
    check (weekly_digest_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint user_profiles_evening_sync_time_check
    check (evening_sync_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create index if not exists user_profiles_morning_digest_idx
  on public.user_profiles(owner_id) where morning_digest_enabled;
create index if not exists user_profiles_weekly_digest_idx
  on public.user_profiles(owner_id) where weekly_digest_enabled;
create index if not exists user_profiles_evening_sync_idx
  on public.user_profiles(owner_id) where evening_sync_enabled;

commit;
