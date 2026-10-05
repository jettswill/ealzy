begin;

alter table public.user_profiles
  add column if not exists last_active_at timestamptz,
  add column if not exists last_reengagement_at timestamptz,
  add column if not exists reengagement_enabled boolean not null default true;

create index if not exists user_profiles_last_active_idx
  on public.user_profiles(last_active_at)
  where reengagement_enabled;

-- Existing accounts already used the product: don't force mini-app onboarding.
update public.user_profiles p
  set onboarding_completed_at = coalesce(p.onboarding_completed_at, p.updated_at, now())
  where p.onboarding_completed_at is null
    and (
      cardinality(p.values) > 0
      or exists (select 1 from public.tasks t where t.owner_id = p.owner_id)
      or exists (select 1 from public.goals g where g.owner_id = p.owner_id)
      or exists (
        select 1 from public.people pe
        join public.memories m on m.person_id = pe.id
        where pe.owner_id = p.owner_id
      )
    );

commit;
