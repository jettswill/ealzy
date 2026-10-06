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

-- Migrations are re-applied on every deploy. 034_guest_users later relaxes this
-- check to allow guests, so re-adding the strict form here fails as soon as a
-- guest row exists. Only add it when the constraint is missing (fresh database).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_identity_present_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_identity_present_check
        check (telegram_id is not null or auth_user_id is not null);
  end if;
end $$;

create unique index if not exists users_email_lower_uidx
  on public.users (lower(email))
  where email is not null;

commit;
