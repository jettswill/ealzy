begin;

-- Утренняя сводка приходит всем по умолчанию (решение основателя 08.10.2026).
-- Раньше она включалась только у тех, кто начинал с бота, или при входе через
-- сайт — и часть аккаунтов оставалась без неё.

create or replace function public.provision_personal_context()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  self_id uuid;
  has_telegram boolean := (new.telegram_id is not null);
  -- Веб-аккаунту пояс подставит браузер при первом входе (applyWebClientContext
  -- перезаписывает только UTC), Telegram-аккаунту — Москва.
  default_tz text := case when has_telegram then 'Europe/Moscow' else 'UTC' end;
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
    true, has_telegram
  ) on conflict (owner_id) do nothing;
  insert into public.conversations(owner_id, title, is_primary)
    values (new.id, 'LifeOS', true) on conflict do nothing;
  return new;
end;
$$;

-- Включить у всех, у кого выключена.
update public.user_profiles
  set morning_digest_enabled = true
  where not morning_digest_enabled;

-- Русскоязычным Telegram-аккаунтам с поясом UTC — Москва, иначе сводка
-- приходит на три часа позже. Веб-аккаунтам пояс подставит браузер.
update public.user_profiles p
  set timezone = 'Europe/Moscow'
  from public.users u
  where u.id = p.owner_id
    and u.telegram_id is not null
    and p.timezone = 'UTC'
    and coalesce(p.locale, 'ru') like 'ru%';

commit;
