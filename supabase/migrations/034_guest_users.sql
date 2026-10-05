begin;

-- Guest sessions: let a visitor use Ealzy without any login (Telegram/OAuth),
-- keeping a real server-side account (needed because chat/memory/recommendations
-- are server+LLM-backed) keyed only by the session token issued to their device.
-- They can later link Telegram (or Google/Apple/Yandex) to keep everything.

alter table public.users
  add column if not exists is_guest boolean not null default false;

alter table public.users
  drop constraint if exists users_identity_present_check;

alter table public.users
  add constraint users_identity_present_check
    check (telegram_id is not null or auth_user_id is not null or is_guest);

commit;
