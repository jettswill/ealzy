begin;

-- W1.1: Enable morning + evening digests by default for Telegram users.
-- The provision trigger fires on INSERT to users. If the new user has a
-- telegram_id, we enable morning and evening digests so the retention loop
-- starts automatically. Weekly digest stays off (too early for a new user).
-- We also set a sensible timezone based on locale instead of defaulting to UTC.

create or replace function public.provision_personal_context()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  self_id uuid;
  has_telegram boolean := (new.telegram_id is not null);
  default_tz text := case
    when has_telegram then 'Europe/Moscow'
    else 'UTC'
  end;
begin
  select id into self_id from public.people
    where owner_id = new.id and is_self limit 1;
  if self_id is null then
    insert into public.people(owner_id, name, relationship, is_self)
      values (new.id, new.name, 'self', true) returning id into self_id;
  end if;
  insert into public.user_profiles(
    owner_id, self_person_id, timezone,
    morning_digest_enabled, evening_sync_enabled
  ) values (
    new.id, self_id, default_tz,
    has_telegram, has_telegram
  ) on conflict (owner_id) do nothing;
  insert into public.conversations(owner_id, title, is_primary)
    values (new.id, 'LifeOS', true) on conflict do nothing;
  return new;
end;
$$;

-- Backfill: enable digests for existing Telegram users who never turned them on
-- and still have the default UTC timezone.
update public.user_profiles p
  set morning_digest_enabled = true,
      evening_sync_enabled = true,
      timezone = 'Europe/Moscow'
  from public.users u
  where u.id = p.owner_id
    and u.telegram_id is not null
    and p.timezone = 'UTC'
    and not p.morning_digest_enabled
    and not p.evening_sync_enabled;

commit;
