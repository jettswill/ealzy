begin;

-- Основатель (@jettswill) — администратор и пользуется без лимитов.
insert into public.app_admins (owner_id)
select id from public.users where lower(username) = 'jettswill'
on conflict (owner_id) do nothing;

commit;
