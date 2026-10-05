begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

insert into public.users(id, telegram_id, name)
values
  ('10000000-0000-4000-8000-000000000001', 910001, 'RLS owner A'),
  ('10000000-0000-4000-8000-000000000002', 910002, 'RLS owner B');

insert into public.people(id, owner_id, name)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'A person'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'B person');

insert into public.tasks(id, owner_id, title)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'A task'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'B task');

insert into public.experiences(id, owner_id, type, title)
values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'activity', 'A experience'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'activity', 'B experience');

insert into public.person_locations(id, person_id, city, address, is_primary)
values
  ('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Kazan', 'Bauman 1', true),
  ('50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Sochi', null, true);

insert into public.person_dates(id, person_id, kind, month, day, year)
values
  ('51000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'birthday', 3, 29, 1994),
  ('51000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'birthday', 9, 1, 1990);

insert into public.notes(id, owner_id, content, plain_text)
values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '{}', 'A note'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '{}', 'B note');
insert into public.note_revisions(
  note_id, owner_id, revision, content, plain_text, client_mutation_id
)
values
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, '{}', 'A note', '70000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1, '{}', 'B note', '70000000-0000-4000-8000-000000000002');
insert into public.note_actions(owner_id, note_id, note_revision, instruction, proposal)
values
  ('10000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 1, 'A action', '{"kind":"tasks","tasks":[]}'),
  ('10000000-0000-4000-8000-000000000002', '60000000-0000-4000-8000-000000000002', 1, 'B action', '{"kind":"tasks","tasks":[]}');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"app_user_id":"10000000-0000-4000-8000-000000000001"}',
  true
);

select results_eq(
  $$ select id from public.users order by id $$,
  $$ values ('10000000-0000-4000-8000-000000000001'::uuid) $$,
  'users are isolated by app_user_id'
);
select results_eq(
  $$ select name from public.people where not is_self order by name $$,
  $$ values ('A person'::text) $$,
  'people are isolated by owner'
);
select results_eq(
  $$ select title from public.tasks order by title $$,
  $$ values ('A task'::text) $$,
  'tasks are isolated by owner'
);
select results_eq(
  $$ select title from public.experiences order by title $$,
  $$ values ('A experience'::text) $$,
  'experiences are isolated by owner'
);
select results_eq(
  $$ select city from public.person_locations order by city $$,
  $$ values ('Kazan'::text) $$,
  'person locations are isolated by owner'
);
select results_eq(
  $$ select kind from public.person_dates order by kind $$,
  $$ values ('birthday'::text) $$,
  'person dates are isolated by owner'
);
select results_eq(
  $$ select plain_text from public.notes order by plain_text $$,
  $$ values ('A note'::text) $$,
  'notes are isolated by owner'
);
select results_eq(
  $$ select plain_text from public.note_revisions order by plain_text $$,
  $$ values ('A note'::text) $$,
  'note revisions are isolated by owner'
);
select results_eq(
  $$ select instruction from public.note_actions order by instruction $$,
  $$ values ('A action'::text) $$,
  'note actions are isolated by owner'
);

select * from finish();
rollback;
