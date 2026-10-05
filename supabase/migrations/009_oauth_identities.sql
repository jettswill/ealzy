begin;

alter table public.users
  alter column telegram_id drop not null;

alter table public.users
  drop constraint if exists users_telegram_id_check;

alter table public.users
  add constraint users_telegram_id_check
    check (telegram_id is null or telegram_id > 0);

alter table public.users
  add column if not exists auth_user_id uuid unique,
  add column if not exists email text;

alter table public.users
  drop constraint if exists users_identity_present_check;

alter table public.users
  add constraint users_identity_present_check
    check (telegram_id is not null or auth_user_id is not null);

create unique index if not exists users_email_lower_uidx
  on public.users (lower(email))
  where email is not null;

commit;
