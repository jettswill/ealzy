begin;

alter table public.goals
  add column if not exists current_plan text,
  add column if not exists plan_revised_at timestamptz;

alter table public.user_profiles
  add column if not exists last_goal_checkin_on date;

commit;
