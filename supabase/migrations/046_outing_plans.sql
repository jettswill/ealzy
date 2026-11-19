begin;

-- «Пойду»: человек выбрал, куда идти, и (может быть) когда. План — это место
-- в его дневнике со статусом «хочу» плюс время и дело в календаре; без времени
-- Илзи вечером спросит, когда он пойдёт, а после — как было.
alter table public.place_visits
  add column if not exists planned_for timestamptz,
  add column if not exists task_id uuid references public.tasks(id) on delete set null;
create index if not exists place_visits_planned_idx
  on public.place_visits(owner_id, planned_for) where planned_for is not null;

-- Что человек решил по итогу вращения: «Пойду» или «Поискать ещё».
alter table public.activity_spins
  add column if not exists decision text check (decision is null or decision in ('going', 'more')),
  add column if not exists decided_at timestamptz;

commit;
