begin;

alter table public.tasks alter column status set default 'todo';
update public.tasks set status = 'todo' where status = 'open';

commit;
