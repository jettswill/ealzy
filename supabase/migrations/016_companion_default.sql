begin;

alter table public.conversations alter column mode set default 'companion';
update public.conversations set mode = 'companion' where mode = 'command';

commit;
