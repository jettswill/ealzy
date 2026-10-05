begin;

do $$ begin
  create role anon nologin noinherit;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null;
end $$;

do $$ begin
  create role authenticator nologin noinherit;
exception when duplicate_object then null;
end $$;

alter role authenticator with login noinherit;
alter role service_role with nologin noinherit bypassrls;

grant anon, authenticated, service_role to authenticator;
grant usage on schema public to anon, authenticated, service_role, authenticator;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

commit;
