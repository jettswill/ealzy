begin;

alter table public.user_profiles
  add column if not exists onboarding_completed_at timestamptz;

create index if not exists user_profiles_onboarding_pending_idx
  on public.user_profiles(owner_id) where onboarding_completed_at is null;

commit;
