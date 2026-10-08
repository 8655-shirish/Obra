\set ON_ERROR_STOP on
\echo 'calendar-worker-schedules: local-only, rollback-only owner-scoped scheduler/Stripe authority tests'
begin;
create or replace function pg_temp.assert_true(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is not true then raise exception 'assertion failed: %', message; end if; end $$;

-- Scheduler assertions are owner-only, not claims about the global cron catalog.
-- Bootstrap superuser access is only for rollback-only foreign-role/platform fixtures;
-- application definers must remain constrained non-cron-owners throughout this suite.
-- Refuse installed network extensions: no test is allowed to dispatch a hosted request.
select pg_temp.assert_true(not exists(select 1 from pg_catalog.pg_extension where extname in ('pg_net','pg_cron')),
  'run only against local inert scheduler stubs');
select set_config('calendar_test.scheduler_owner',pg_catalog.pg_get_userbyid(proowner),true)
  from pg_catalog.pg_proc where oid='public.apply_repo_migration(text,text,text,text,text)'::regprocedure;
select pg_temp.assert_true(not exists(select 1 from cron.job where username=current_setting('calendar_test.scheduler_owner')
  and jobname ~ '^obra-calendar-(test|live)-(google|stripe|booking-core|booking-notifications)$'),
  'migration itself registers or activates no owner schedules');
select pg_temp.assert_true(not exists(select 1 from public.background_job_cron_requests where schedule_name ~ '^obra-calendar-(test|live)-'),
  'migration dispatches nothing');
select pg_temp.assert_true((select count(*)=1 and bool_and(polname='cron_job_policy') from pg_catalog.pg_policy where polrelid='cron.job'::regclass),
  'installation requires no custom visibility policy');
create temporary table preserved_cron_policies as select * from pg_catalog.pg_policy where polrelid='cron.job'::regclass;

select pg_temp.assert_true(has_function_privilege('service_role','public.register_calendar_worker_schedules(text)','execute'), 'service registration allowed');
select pg_temp.assert_true(has_function_privilege('service_role','public.set_calendar_worker_schedules_active(text,boolean)','execute'), 'explicit service activation allowed');
select pg_temp.assert_true(not has_function_privilege('anon','public.register_calendar_worker_schedules(text)','execute'), 'anonymous registration denied');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.set_calendar_worker_schedules_active(text,boolean)','execute'), 'browser activation denied');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.set_calendar_worker_schedules_active(text,boolean)','execute'), 'financial worker cannot activate schedules');
select pg_temp.assert_true(not has_function_privilege('service_role','public.dispatch_calendar_worker_schedule(text,text)','execute'), 'service RPC cannot bypass cron dispatch authority');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.claim_stripe_connect_account_refresh(uuid,text,uuid)','execute'), 'financial worker does not gain provider maintenance service authority');
select pg_temp.assert_true(not has_function_privilege('anon','public.get_calendar_worker_health(text)','execute'), 'tenant health is service-only');
select pg_temp.assert_true(not has_function_privilege('service_role','public.assert_calendar_worker_cron_privileges(boolean)','execute')
  and not has_function_privilege('booking_worker','public.assert_calendar_worker_cron_privileges(boolean)','execute')
  and (select not prosecdef and proconfig=array['search_path=""'] and proargnames=array['p_require_schedule']
    and pronargdefaults=1 and pg_catalog.pg_get_expr(proargdefaults,0)='true' from pg_catalog.pg_proc
    where oid='public.assert_calendar_worker_cron_privileges(boolean)'::regprocedure),
  'native cron preflight is unexposed invoker authority, requires schedule by default and has a safe search path');
select pg_temp.assert_true(pg_catalog.to_regprocedure('public.release_stripe_connect_reconciliation_claim(uuid,text,uuid,timestamptz)') is null,
  'unfenced release overload is removed');
select pg_temp.assert_true(not exists(
  select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('claim_stripe_connect_account_refresh','claim_due_stripe_connect_accounts',
    'apply_leased_stripe_connect_account_projection','release_stripe_connect_reconciliation_claim','register_calendar_worker_schedules',
    'set_calendar_worker_schedules_active','validate_calendar_worker_cron_configuration','dispatch_calendar_worker_schedule',
    'capture_calendar_worker_cron_response','get_calendar_worker_health',
    'apply_stripe_connect_account_projection','apply_stripe_connect_inbox_projection')
     and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'],false)
       or pg_catalog.pg_get_userbyid(p.proowner)<>current_setting('calendar_test.scheduler_owner'))
), 'all new/replaced definers retain the runner owner and a safe search_path');
select pg_temp.assert_true((select p.prosecdef and r.rolcanlogin
  and not(r.rolsuper or r.rolbypassrls or r.rolcreatedb or r.rolreplication or r.rolinherit) and p.proowner<>c.relowner
  and not pg_has_role(p.proowner,c.relowner,'MEMBER')
  and has_schema_privilege(p.proowner,'cron','USAGE') and has_table_privilege(p.proowner,c.oid,'SELECT')
  and not has_table_privilege(p.proowner,c.oid,'INSERT,UPDATE,DELETE')
  and has_function_privilege(p.proowner,'cron.schedule(text,text,text)','EXECUTE')
  and has_function_privilege(p.proowner,'cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE')
  and not has_function_privilege(p.proowner,'cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE WITH GRANT OPTION')
  from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner cross join pg_catalog.pg_class c
  where p.oid='public.get_calendar_worker_health(text)'::regprocedure and c.oid='cron.job'::regclass),
  'native scheduler grants suffice for a login definer without cron ownership, table writes or elevated roles');

do $$declare role_name text;invocation text;begin
  foreach role_name in array array['anon','authenticated','booking_worker'] loop
    execute pg_catalog.format('set local role %I',role_name);
    foreach invocation in array array[
      'select public.register_calendar_worker_schedules(''test'')',
      'select public.set_calendar_worker_schedules_active(''test'',false)',
      'select public.get_calendar_worker_health(''test'')',
      'select public.dispatch_calendar_worker_schedule(''test'',''google'')',
      'select public.validate_calendar_worker_cron_configuration(''test'')',
      'select public.assert_calendar_worker_cron_privileges()'
    ] loop
      begin execute invocation;raise exception 'cross-role execution accepted for %: %',role_name,invocation;
        exception when insufficient_privilege then null;end;
    end loop;
    reset role;
  end loop;
  set local role service_role;
  begin perform public.dispatch_calendar_worker_schedule('test','google');raise exception 'service bypassed cron dispatch';
    exception when insufficient_privilege then null;end;
  begin perform public.validate_calendar_worker_cron_configuration('test');raise exception 'service executed internal validation';
    exception when insufficient_privilege then null;end;
  begin perform public.assert_calendar_worker_cron_privileges();raise exception 'service executed internal preflight';
    exception when insufficient_privilege then null;end;
  reset role;
end $$;

-- Same and opposite environment identities are deliberately duplicated across owners.
create role calendar_foreign_fixture login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
set local role calendar_extension_owner;
grant usage on schema cron to calendar_foreign_fixture;
grant execute on function cron.schedule(text,text,text),cron.alter_job(bigint,text,text,text,text,boolean) to calendar_foreign_fixture;
reset role;
set local role calendar_foreign_fixture;
select cron.schedule('obra-calendar-'||environment||'-'||worker,'* * * * *','select 17;')
  from unnest(array['test','live']) environment cross join unnest(array['google','stripe','booking-core','booking-notifications']) worker;
select cron.schedule('obra-record-background-job-responses','* * * * *','select 3;');
select cron.schedule('obra-record-background-job-responses-unrelated','* * * * *','select 4;');
reset role;

savepoint wrong_preflight_owner;
do $$begin
  execute pg_catalog.format('set local role %I',current_setting('calendar_test.scheduler_owner'));
  grant execute on function public.assert_calendar_worker_cron_privileges(boolean) to calendar_foreign_fixture;
  perform public.assert_calendar_worker_cron_privileges();
  perform public.assert_calendar_worker_cron_privileges(false);
  begin perform public.assert_calendar_worker_cron_privileges(null);raise exception 'null native privilege scope accepted';
    exception when insufficient_privilege then null;end;
  reset role;
  set local role calendar_foreign_fixture;
  begin perform public.assert_calendar_worker_cron_privileges();raise exception 'non-runner login owner passed preflight';
    exception when insufficient_privilege then
      if sqlerrm<>'Calendar scheduler owner requires native cron privileges' then raise;end if;end;
  reset role;
end $$;
rollback to savepoint wrong_preflight_owner;

-- Include same-owner neighbours so preservation cannot pass merely because RLS hides them.
do $$begin
  execute pg_catalog.format('set local role %I',current_setting('calendar_test.scheduler_owner'));
  perform pg_temp.assert_true(not exists(select 1 from cron.job where username<>current_user),
    'stock owner-only RLS hides every foreign calendar and shared-recorder fixture');
  perform cron.schedule('obra-run-background-jobs','* * * * *','select 1;');
  perform cron.schedule('obra-calendar-test-attachment-scan','* * * * *','select 2;');
  perform cron.schedule('unrelated-calendar-test','* * * * *','select public.dispatch_calendar_worker_schedule(''test'',''google'');');
  perform set_config('calendar_test.native_job_id',cron.schedule('obra-calendar-test-google','*/5 * * * *','select 99;')::text,true);
  reset role;
end $$;
create temporary table preserved_schedules as select * from cron.job where not
  (username=current_setting('calendar_test.scheduler_owner') and jobname ~ '^obra-calendar-(test|live)-(google|stripe|booking-core|booking-notifications)$');
create function pg_temp.reject_preserved_cron_write() returns trigger
language plpgsql security definer set search_path='' as $$begin
  if exists(select 1 from pg_temp.preserved_schedules where jobid=old.jobid) then
    raise exception 'scheduler wrote an unrelated or shared-recorder job';
  end if;
  if tg_op='DELETE' then return old;end if;
  return new;
end $$;
create trigger reject_preserved_cron_write before update or delete on cron.job
  for each row execute function pg_temp.reject_preserved_cron_write();
create temporary table registered_test_schedules(schedule_name text,job_id bigint,active boolean);
grant select,insert on registered_test_schedules to service_role;

set local role service_role;
insert into registered_test_schedules select * from public.register_calendar_worker_schedules('test');
select * from public.register_calendar_worker_schedules('test');
reset role;
select pg_temp.assert_true((select count(*)=4 and bool_and(not active) from cron.job
  where username=current_setting('calendar_test.scheduler_owner')
    and jobname in ('obra-calendar-test-google','obra-calendar-test-stripe','obra-calendar-test-booking-core','obra-calendar-test-booking-notifications')),
  'owner-only registration is exact, idempotent and inactive despite active hidden foreign jobs and absent secrets');
select pg_temp.assert_true((select count(*)=4 and bool_and(j.jobname=r.schedule_name and not j.active and not r.active
  and j.username=current_setting('calendar_test.scheduler_owner')) from registered_test_schedules r join cron.job j on j.jobid=r.job_id)
  and (select job_id=current_setting('calendar_test.native_job_id')::bigint from registered_test_schedules where schedule_name='obra-calendar-test-google'),
  'native uniqueness upserts the same owner/jobname identity and preserves all returned job IDs');
select pg_temp.assert_true(public.dispatch_calendar_worker_schedule('test','google') is null, 'inactive dispatch does no work');
select pg_temp.assert_true((public.get_calendar_worker_health('live')->'schedules'->0->>'status')='missing_schedule',
  'missing owned schedules are observable even when matching foreign jobs exist');

set local role service_role;
do $$declare environment text;health jsonb;begin
  foreach environment in array array['test','live'] loop
    health:=public.get_calendar_worker_health(environment);
    perform pg_temp.assert_true(health->'scheduler_scope'=jsonb_build_object('owner',current_setting('calendar_test.scheduler_owner'),'visibility','owner_only'),
      'health describes the definer owner, not the service caller or global scheduler visibility');
    perform pg_temp.assert_true(health->'response_recorder'='{"registered":null,"active":null,"last_recorded_response_at":null}'::jsonb,
      'no owned recorder is unknown, never globally missing or inferred active from a hidden foreign row');
    perform pg_temp.assert_true(jsonb_array_length(health->'schedules')=4,'owner health does not duplicate foreign schedule names');
  end loop;
end $$;
reset role;

-- Shared ledger evidence is independent of scheduler visibility and environment.
insert into public.background_job_cron_requests(schedule_name,request_id,requested_at,responded_at,status_code) values
  ('obra-run-background-jobs',900001,'2000-01-01T00:00:00Z','2000-01-03T04:05:06Z',200),
  ('obra-calendar-live-google',900002,'2000-01-01T00:00:00Z','2000-01-02T00:00:00Z',200),
  ('fixture-shared-future',900003,clock_timestamp(),clock_timestamp()+interval '1 day',200),
  ('fixture-shared-pending',900004,clock_timestamp(),null,null);
set local role service_role;
do $$declare environment text;recorder jsonb;begin
  foreach environment in array array['test','live'] loop
    recorder:=public.get_calendar_worker_health(environment)->'response_recorder';
    perform pg_temp.assert_true(recorder->'registered'='null'::jsonb and recorder->'active'='null'::jsonb
      and (recorder->>'last_recorded_response_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
      and (recorder->>'last_recorded_response_at')::timestamptz='2000-01-03T04:05:06Z'::timestamptz,
      'unknown recorder exposes the shared ledger maximum as ISO time, not worker/environment-only, pending or future evidence');
  end loop;
end $$;
reset role;
savepoint foreign_recorder_inactive;
drop trigger reject_preserved_cron_write on cron.job;
set local role calendar_foreign_fixture;
select cron.alter_job(jobid,active:=false) from cron.job where jobname='obra-record-background-job-responses' and username=current_user;
reset role;
set local role service_role;
select pg_temp.assert_true(public.get_calendar_worker_health('test')->'response_recorder'->'active'='null'::jsonb,
  'a hidden inactive recorder is still unknown, not a global inactive diagnosis');
reset role;
rollback to savepoint foreign_recorder_inactive;

do $$declare recorder_id bigint;begin
  execute pg_catalog.format('set local role %I',current_setting('calendar_test.scheduler_owner'));
  recorder_id:=cron.schedule('obra-record-background-job-responses','* * * * *','select 5;');
  reset role;
  set local role service_role;
  perform pg_temp.assert_true((public.get_calendar_worker_health('test')->'response_recorder')-'last_recorded_response_at'='{"registered":true,"active":true}'::jsonb,
    'an owned recorder is known registered and active');
  reset role;
  execute pg_catalog.format('set local role %I',current_setting('calendar_test.scheduler_owner'));
  perform cron.alter_job(recorder_id,active:=false);
  reset role;
  set local role service_role;
  perform pg_temp.assert_true((public.get_calendar_worker_health('live')->'response_recorder')-'last_recorded_response_at'='{"registered":true,"active":false}'::jsonb,
    'an owned inactive recorder remains registered, regardless of active foreign recorders');
  reset role;
  execute pg_catalog.format('set local role %I',current_setting('calendar_test.scheduler_owner'));
  perform cron.alter_job(recorder_id,active:=true);
  reset role;
end $$;
insert into preserved_schedules select * from cron.job
  where jobname='obra-record-background-job-responses' and username=current_setting('calendar_test.scheduler_owner');
create temporary table preserved_cron_requests as select * from public.background_job_cron_requests;

do $$declare foreign_id bigint;begin
  select jobid into strict foreign_id from cron.job where jobname='obra-record-background-job-responses' and username='calendar_foreign_fixture';
  execute pg_catalog.format('set local role %I',current_setting('calendar_test.scheduler_owner'));
  begin perform cron.alter_job(foreign_id,active:=false);raise exception 'known foreign job ID allowed native alteration';
    exception when insufficient_privilege then null;end;
  begin update cron.job set active=false where jobid=foreign_id;raise exception 'raw cron table write accepted';
    exception when insufficient_privilege then null;end;
  reset role;
end $$;

-- Hide only the last newly paused owned row. Native alteration succeeds while it
-- is active; the registration's final verification must reject and roll back all four.
savepoint owned_row_verification;
do $$begin
  execute pg_catalog.format('set local role %I',current_setting('calendar_test.scheduler_owner'));
  perform cron.schedule('obra-calendar-live-google','*/5 * * * *','select 99;');
  reset role;
end $$;
create temporary table before_failed_registration as select * from cron.job;
set local role calendar_extension_owner;
do $$begin
  execute pg_catalog.format('create policy fixture_owned_visibility on cron.job as restrictive for select to %I using(jobname<>''obra-calendar-live-booking-notifications'' or active)',
    current_setting('calendar_test.scheduler_owner'));
end $$;
reset role;
set local role service_role;
do $$begin
  begin perform public.register_calendar_worker_schedules('live');raise exception 'unverifiable owned inactive row accepted';
    exception when insufficient_privilege then
      if sqlerrm<>'Owned calendar schedule could not be verified' then raise;end if;end;
end $$;
reset role;
select pg_temp.assert_true(not exists(select * from before_failed_registration except select * from cron.job)
  and not exists(select * from cron.job except select * from before_failed_registration),
  'restrictive RLS on the final owned row rolls back earlier upserts, new jobs and partial deactivation');
rollback to savepoint owned_row_verification;

savepoint missing_alter_privilege;
create temporary table before_missing_alter as select * from cron.job;
set local role calendar_extension_owner;
do $$begin
  execute pg_catalog.format('revoke execute on function cron.alter_job(bigint,text,text,text,text,boolean) from %I',current_setting('calendar_test.scheduler_owner'));
end $$;
reset role;
set local role service_role;
do $$begin
  begin perform public.register_calendar_worker_schedules('live');raise exception 'registration accepted revoked alter privilege';
    exception when insufficient_privilege then null;end;
  begin perform public.set_calendar_worker_schedules_active('test',true);raise exception 'activation accepted revoked alter privilege';
    exception when insufficient_privilege then null;end;
  begin perform public.set_calendar_worker_schedules_active('test',false);raise exception 'deactivation accepted revoked alter privilege';
    exception when insufficient_privilege then null;end;
end $$;
reset role;
select pg_temp.assert_true(not exists(select * from before_missing_alter except select * from cron.job)
  and not exists(select * from cron.job except select * from before_missing_alter),
  'revoked alter privilege fails before any job creation or changes');
rollback to savepoint missing_alter_privilege;

do $$ begin
  begin perform public.set_calendar_worker_schedules_active('test',true);
    raise exception 'activation accepted missing config';
  exception when sqlstate '22023' then null; end;
  begin perform public.register_calendar_worker_schedules(null);
    raise exception 'registration accepted null environment';
  exception when sqlstate '22023' then null; end;
  begin perform public.register_calendar_worker_schedules('test''; select 1');
    raise exception 'registration accepted arbitrary scope';
  exception when sqlstate '22023' then null; end;
  begin perform public.set_calendar_worker_schedules_active('test',null);
    raise exception 'activation accepted null intent';
  exception when sqlstate '22023' then null; end;
end $$;

insert into vault.decrypted_secrets(name,decrypted_secret) values
  ('CALENDAR_WORKER_CRON_ENVIRONMENT','test'),('CALENDAR_WORKER_CRON_ORIGIN','https://obratech.co'),
  ('PIPEDREAM_INBOX_CRON_SECRET','fixture-only-google'),('STRIPE_INBOX_CRON_SECRET','fixture-only-stripe'),
  ('BOOKING_CRON_SECRET','');
do $$ begin
  begin perform public.set_calendar_worker_schedules_active('test',true);
    raise exception 'activation accepted empty bearer';
  exception when sqlstate '22023' then null; end;
end $$;
update vault.decrypted_secrets set decrypted_secret='fixture-only-booking' where name='BOOKING_CRON_SECRET';
-- Isolate absence even when the full harness preinstalls this inert stub. The
-- suite's final rollback restores its original definition, defaults and grants.
drop function if exists net.http_post(text,jsonb,jsonb,jsonb,integer);
do $$ begin
  begin perform public.set_calendar_worker_schedules_active('test',true);
    raise exception 'activation accepted missing pg_net transport';
  exception when sqlstate '55000' then null; end;
end $$;

-- Stock five-argument pg_net interface; record safe request metadata only, never bearer values.
create temporary table calendar_transport_calls(id bigint generated always as identity,url text,body jsonb,environment text,timeout_ms integer,schedule_name text);
create or replace function net.http_post(url text,body jsonb,params jsonb,headers jsonb,timeout_milliseconds integer)
returns bigint language plpgsql security definer set search_path='' as $$ declare id bigint; begin
  perform pg_temp.assert_true(headers->>'Authorization' ~ '^Bearer fixture-only-(google|stripe|booking)$','nonempty dummy bearer supplied at dispatch only');
  insert into pg_temp.calendar_transport_calls(url,body,environment,timeout_ms,schedule_name)
    values(url,body,headers->>'X-Obra-Worker-Environment',timeout_milliseconds,headers->>'X-Obra-Cron-Schedule') returning calendar_transport_calls.id into id;
  return id;
end $$;

do $$ begin
  begin perform public.set_calendar_worker_schedules_active('live',true);
    raise exception 'activation accepted a different configured environment';
  exception when sqlstate '22023' then null; end;
end $$;
update vault.decrypted_secrets set decrypted_secret='live' where name='CALENDAR_WORKER_CRON_ENVIRONMENT';
do $$ begin
  begin perform public.set_calendar_worker_schedules_active('live',true);
    raise exception 'activation accepted missing exact jobs';
  exception when sqlstate '22023' then null; end;
end $$;
update vault.decrypted_secrets set decrypted_secret='test' where name='CALENDAR_WORKER_CRON_ENVIRONMENT';

do $$ declare origin text; begin
  foreach origin in array array['http://obratech.co','https://obra-tech.lovable.app','https://evil.example',
    'https://obratech.co/','https://obratech.co:443','https://obratech.co@evil.example',
    'https://obratech.co/api/cron/booking','https://obratech.co?redirect=1'] loop
    update vault.decrypted_secrets set decrypted_secret=origin where name='CALENDAR_WORKER_CRON_ORIGIN';
    begin perform public.set_calendar_worker_schedules_active('test',true);
      raise exception 'activation accepted untrusted/noncanonical origin';
    exception when sqlstate '22023' then null; end;
  end loop;
end $$;
update vault.decrypted_secrets set decrypted_secret='https://obratech.co' where name='CALENDAR_WORKER_CRON_ORIGIN';
set local role service_role;
select public.set_calendar_worker_schedules_active('test',true);
reset role;
select pg_temp.assert_true((select count(*)=4 and bool_and(active) from cron.job
  where username=current_setting('calendar_test.scheduler_owner')
    and jobname in ('obra-calendar-test-google','obra-calendar-test-stripe','obra-calendar-test-booking-core','obra-calendar-test-booking-notifications')),
  'owner-only activation changes four jobs despite active hidden same/opposite-environment foreign jobs');
select pg_temp.assert_true(not exists(select 1 from pg_temp.calendar_transport_calls), 'activation is not dispatch');
select pg_temp.assert_true(not exists(select * from preserved_cron_requests except select * from public.background_job_cron_requests)
  and not exists(select * from public.background_job_cron_requests except select * from preserved_cron_requests),
  'registration, activation and read-only health write no shared response-ledger rows');
select pg_temp.assert_true((public.get_calendar_worker_health('test')->'schedules'->0->>'status')='missed_dispatch',
  'active schedule without dispatch history is visible');

savepoint missing_schedule_privilege;
delete from vault.decrypted_secrets where name in ('CALENDAR_WORKER_CRON_ENVIRONMENT','CALENDAR_WORKER_CRON_ORIGIN',
  'PIPEDREAM_INBOX_CRON_SECRET','STRIPE_INBOX_CRON_SECRET','BOOKING_CRON_SECRET');
set local role calendar_extension_owner;
do $$begin
  execute pg_catalog.format('revoke execute on function cron.schedule(text,text,text) from public,%I',current_setting('calendar_test.scheduler_owner'));
end $$;
reset role;
set local role service_role;
do $$begin
  begin perform public.register_calendar_worker_schedules('live');raise exception 'registration accepted revoked schedule privilege';
    exception when insufficient_privilege then null;end;
  begin perform public.set_calendar_worker_schedules_active('test',true);raise exception 'activation accepted revoked schedule privilege';
    exception when insufficient_privilege then null;end;
end $$;
reset role;
select pg_temp.assert_true((select count(*)=4 and bool_and(active) from cron.job
  where username=current_setting('calendar_test.scheduler_owner') and jobname ~ '^obra-calendar-test-(google|stripe|booking-core|booking-notifications)$'),
  'revoked schedule privilege leaves existing owned jobs active until explicit deactivation');
set local role service_role;
select pg_temp.assert_true(public.set_calendar_worker_schedules_active('test')=4,
  'default deactivation needs neither schedule EXECUTE nor any configuration');
reset role;
select pg_temp.assert_true((select count(*)=4 and bool_and(not active) from cron.job
  where username=current_setting('calendar_test.scheduler_owner') and jobname ~ '^obra-calendar-test-(google|stripe|booking-core|booking-notifications)$'),
  'only owned exact jobs are disabled when schedule privilege is revoked');
rollback to savepoint missing_schedule_privilege;

update cron.job set command='select 99;' where jobname='obra-calendar-test-google' and username=current_setting('calendar_test.scheduler_owner');
do $$ begin
  begin perform public.set_calendar_worker_schedules_active('test',true);
    raise exception 'activation accepted a modified command';
  exception when sqlstate '22023' then null; end;
end $$;
select pg_temp.assert_true(public.dispatch_calendar_worker_schedule('test','google') is null,'modified active command cannot dispatch through helper');
select * from public.register_calendar_worker_schedules('test');
select public.set_calendar_worker_schedules_active('test',true);
select pg_temp.assert_true(not exists(select 1 from cron.job where username=current_setting('calendar_test.scheduler_owner')
  and jobname ~ '^obra-calendar-(test|live)-(google|stripe|booking-core|booking-notifications)$'
  and (command like '%fixture-only%' or command like '%https:%' or command like '%Bearer%')), 'cron SQL contains no origin or bearer values');

select public.dispatch_calendar_worker_schedule('test','google');
select public.dispatch_calendar_worker_schedule('test','stripe');
select public.dispatch_calendar_worker_schedule('test','booking-core');
select public.dispatch_calendar_worker_schedule('test','booking-notifications');
select pg_temp.assert_true((select count(*)=4 and bool_and(environment='test' and timeout_ms=55000
  and url in ('https://obratech.co/api/cron/pipedream-inbox','https://obratech.co/api/cron/stripe-inbox','https://obratech.co/api/cron/booking')
  and schedule_name in ('obra-calendar-test-google','obra-calendar-test-stripe','obra-calendar-test-booking-core','obra-calendar-test-booking-notifications')) from pg_temp.calendar_transport_calls),
  'stock pg_net dispatch is fixed-origin, environment/identity scoped and bounded');
select pg_temp.assert_true((select body='{"family":"core"}'::jsonb from pg_temp.calendar_transport_calls where id=3),'booking core body is exact');
select pg_temp.assert_true((select body='{"family":"notifications"}'::jsonb from pg_temp.calendar_transport_calls where id=4),'booking notifications body is exact');
update cron.job set jobname='obra-calendar-test-google-removed' where jobname='obra-calendar-test-google' and username=current_setting('calendar_test.scheduler_owner');
select pg_temp.assert_true((select s->>'status'='missing_schedule' from jsonb_array_elements(public.get_calendar_worker_health('test')->'schedules') s
  where s->>'schedule_name'='obra-calendar-test-google'),'old dispatch history does not hide a missing expected schedule');
update cron.job set jobname='obra-calendar-test-google' where jobname='obra-calendar-test-google-removed' and username=current_setting('calendar_test.scheduler_owner');

-- The existing recorder updates responded_at/status_code; its trigger stores only safe fields.
insert into net._http_response(id,status_code,content,timed_out,created) values
  (1,200,'{"outcome":"partial_failure","environment":"test","scheduleName":"obra-calendar-test-google","processed":1,"failed":2,"secret":"do-not-store","provider":{"body":"do-not-store"}}',false,clock_timestamp()),
  (2,200,'{"outcome":"off","environment":"test","scheduleName":"obra-calendar-test-stripe"}',false,clock_timestamp()),
  (3,200,'not-json',false,clock_timestamp()),
  (4,200,'{"outcome":"succeeded","environment":"live","scheduleName":"obra-calendar-live-booking-notifications","accepted":1}',false,clock_timestamp());
update public.background_job_cron_requests r set responded_at=s.created,status_code=s.status_code,timed_out=s.timed_out
from net._http_response s where r.request_id=s.id and r.schedule_name ~ '^obra-calendar-test-' and r.responded_at is null;
select pg_temp.assert_true((select outcome='partial_failure' and transport_outcome='succeeded' and worker_counts->>'failed'='2'
  and worker_counts::text not like '%do-not-store%' from public.background_job_cron_health where request_id=1),'HTTP 200 is not per-row success');
select pg_temp.assert_true((select outcome='off' from public.background_job_cron_health where request_id=2),'HTTP 200/off is visible');
select pg_temp.assert_true((select outcome='transport_only' from public.background_job_cron_health where request_id=3),'invalid result body is unknown, not worker success');
select pg_temp.assert_true((select outcome='transport_only' from public.background_job_cron_health where request_id=4),'wrong response identity is not worker success');
update net._http_response set content='{"outcome":"partial_failure","environment":"test","scheduleName":"obra-calendar-test-booking-core","failed":null,"lifecycle":{"googleFailures":1}}' where id=3;
update public.background_job_cron_requests set responded_at=clock_timestamp(),status_code=200 where request_id=3;
select pg_temp.assert_true((select outcome='partial_failure' and worker_counts->'failed'='null'::jsonb
  from public.background_job_cron_health where request_id=3),'known partial failure is retained without inventing an exhaustive failure count');

-- Dispatch and response history have independent ages. New pending requests cannot
-- conceal earlier failed/off results or a recorder that has stopped recording.
insert into public.background_job_cron_requests(schedule_name,request_id,requested_at) values
  ('obra-calendar-test-google',101,clock_timestamp()-interval '10 minutes'),
  ('obra-calendar-test-google',102,clock_timestamp()-interval '4 minutes'),
  ('obra-calendar-test-google',103,clock_timestamp()-interval '1 minute'),
  ('obra-calendar-test-google',104,clock_timestamp());
update public.background_job_cron_requests set requested_at=clock_timestamp()-interval '20 minutes'
  where request_id=1;
update public.background_job_cron_requests set responded_at=clock_timestamp()-interval '20 minutes'
  where request_id=1;
select pg_temp.assert_true((select s->>'status'='missing_response'
  and (s->>'overdue_unanswered_count')::integer=2
  and (s->>'last_dispatched_at')::timestamptz>clock_timestamp()-interval '1 minute'
  and (s->>'last_authenticated_completed_at')::timestamptz<clock_timestamp()-interval '19 minutes'
  from jsonb_array_elements(public.get_calendar_worker_health('test')->'schedules') s
  where s->>'schedule_name'='obra-calendar-test-google'),'new pending dispatch cannot mask missed authenticated completion');
update cron.job set active=false where jobname='obra-calendar-test-google' and username=current_setting('calendar_test.scheduler_owner');
select pg_temp.assert_true((select s->>'status'='inactive' from jsonb_array_elements(public.get_calendar_worker_health('test')->'schedules') s
  where s->>'schedule_name'='obra-calendar-test-google'),'explicit pause is distinct from missing responses');
update cron.job set active=true,command='select 99;' where jobname='obra-calendar-test-google' and username=current_setting('calendar_test.scheduler_owner');
select pg_temp.assert_true((select s->>'status'='schedule_drift' from jsonb_array_elements(public.get_calendar_worker_health('test')->'schedules') s
  where s->>'schedule_name'='obra-calendar-test-google'),'modified active schedule is not healthy');
update cron.job set command='select public.dispatch_calendar_worker_schedule(''test'',''google'');' where jobname='obra-calendar-test-google' and username=current_setting('calendar_test.scheduler_owner');
insert into net._http_response(id,status_code,content,timed_out) values
  (104,200,'{"outcome":"succeeded","environment":"test","scheduleName":"obra-calendar-test-google","processed":0,"failed":0}',false);
update public.background_job_cron_requests set responded_at=clock_timestamp(),status_code=200,timed_out=false where request_id=104;
insert into public.background_job_cron_requests(schedule_name,request_id,requested_at) values
  ('obra-calendar-test-google',105,clock_timestamp()),('obra-calendar-test-stripe',106,clock_timestamp());
select pg_temp.assert_true((select s->>'status'='succeeded' and (s->>'overdue_unanswered_count')::integer=0
  and (s->>'last_response_request_id')::integer=104 and (s->>'request_id')::integer=105
  from jsonb_array_elements(public.get_calendar_worker_health('test')->'schedules') s
  where s->>'schedule_name'='obra-calendar-test-google'),'new authenticated completion resolves old silence while next pending does not erase it');
select pg_temp.assert_true((select s->>'status'='off' from jsonb_array_elements(public.get_calendar_worker_health('test')->'schedules') s
  where s->>'schedule_name'='obra-calendar-test-stripe'),'new pending request cannot hide last recorded off result');
-- Mark all Google responses recorded, but none recently authenticated. Generic HTTP
-- success is not a worker heartbeat, including a mismatched environment response.
update public.background_job_cron_requests set responded_at=clock_timestamp(),status_code=200,timed_out=false
  where request_id in(101,102,103,105);
update public.background_job_cron_requests set responded_at=clock_timestamp()-interval '4 minutes' where request_id=104;
select pg_temp.assert_true((select s->>'status'='missed_authenticated_completion'
  from jsonb_array_elements(public.get_calendar_worker_health('test')->'schedules') s
  where s->>'schedule_name'='obra-calendar-test-google'),'generic responses do not reset authenticated completion age');
insert into net._http_response(id,status_code,content,timed_out) values
  (105,500,'{"outcome":"failed","environment":"test","scheduleName":"obra-calendar-test-google"}',false);
update public.background_job_cron_requests set responded_at=clock_timestamp(),status_code=500,timed_out=false where request_id=105;
insert into public.background_job_cron_requests(schedule_name,request_id,requested_at)
  values('obra-calendar-test-google',107,clock_timestamp());
select pg_temp.assert_true((select s->>'status'='failed'
  and (s->>'last_authenticated_completed_at')::timestamptz>clock_timestamp()-interval '1 minute'
  from jsonb_array_elements(public.get_calendar_worker_health('test')->'schedules') s
  where s->>'schedule_name'='obra-calendar-test-google'),'new pending cannot hide an authenticated failed completion');
delete from public.background_job_cron_requests where request_id=107;
delete from public.background_job_cron_requests where request_id between 101 and 106;
delete from net._http_response where id in(104,105);

select * from public.register_calendar_worker_schedules('live');
update vault.decrypted_secrets set decrypted_secret='live' where name='CALENDAR_WORKER_CRON_ENVIRONMENT';
do $$ begin
  begin perform public.set_calendar_worker_schedules_active('live',true);
    raise exception 'activation ignored same-owner opposite-environment activity';
  exception when sqlstate '22023' then
    if sqlerrm<>'Disable the other calendar worker environment explicitly first' then raise;end if;end;
  begin perform public.dispatch_calendar_worker_schedule('test','google');
    raise exception 'active old environment dispatched after config changed';
  exception when sqlstate '22023' then null; end;
end $$;
select pg_temp.assert_true(not exists(select 1 from cron.job where username=current_setting('calendar_test.scheduler_owner')
  and jobname ~ '^obra-calendar-live-(google|stripe|booking-core|booking-notifications)$' and active),
  'same-owner opposite-environment rejection leaves no partial activation');
delete from vault.decrypted_secrets where name='BOOKING_CRON_SECRET';
select pg_temp.assert_true(public.set_calendar_worker_schedules_active('test')=4,'activation defaults to disabling even with missing/mismatched config');
insert into vault.decrypted_secrets(name,decrypted_secret) values('BOOKING_CRON_SECRET','fixture-only-booking');
select pg_temp.assert_true(public.set_calendar_worker_schedules_active('live',true)=4,'new environment requires separate explicit activation');
select * from public.register_calendar_worker_schedules('live');
select pg_temp.assert_true(not exists(select 1 from cron.job where username=current_setting('calendar_test.scheduler_owner')
  and jobname ~ '^obra-calendar-live-(google|stripe|booking-core|booking-notifications)$' and active),
  're-registration pauses exact owned jobs rather than silently keeping activation');
select pg_temp.assert_true(not exists(select * from preserved_schedules except select * from cron.job)
  and not exists(select * from cron.job where not (username=current_setting('calendar_test.scheduler_owner')
    and jobname ~ '^obra-calendar-(test|live)-(google|stripe|booking-core|booking-notifications)$') except select * from preserved_schedules),
  'all foreign, generation, attachment, unrelated and same-owner shared-recorder jobs remain byte-for-byte unchanged');
select pg_temp.assert_true((select count(*)=8 from cron.job
  where username=current_setting('calendar_test.scheduler_owner') and jobname ~ '^obra-calendar-(test|live)-(google|stripe|booking-core|booking-notifications)$'),
  'only the fixed eight owned identities are registered, never the shared recorder or neighbours');
select pg_temp.assert_true(not exists(select * from preserved_cron_requests except select * from public.background_job_cron_requests),
  'scheduler operations never mutate or prune existing shared ledger evidence');
select pg_temp.assert_true(not exists(select * from preserved_cron_policies except select * from pg_catalog.pg_policy where polrelid='cron.job'::regclass)
  and not exists(select * from pg_catalog.pg_policy where polrelid='cron.job'::regclass except select * from preserved_cron_policies),
  'scheduler behavior never broadens or replaces stock owner-only RLS');

do $$ declare tenant uuid:=gen_random_uuid();other_tenant uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();next_lease uuid:=gen_random_uuid();
  claimed public.stripe_connected_accounts;generation bigint;projected public.stripe_connected_accounts;health jsonb;
  webhook_id uuid:=gen_random_uuid();event_lease uuid:=gen_random_uuid();webhook_generation bigint;last_success timestamptz;
begin
  insert into public.profiles(id,license_number,environment) values(tenant,'CALENDAR-STRIPE-TEST','test'),(other_tenant,'CALENDAR-STRIPE-LIVE','live');
  insert into public.stripe_connected_accounts(profile_id,environment,stripe_account_id,last_verified_at,reconciliation_due_at)
    values(tenant,'test','acct_calendarfixture',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '3 minutes'),
      (other_tenant,'live','acct_calendarlivefixture',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '3 minutes');
  health:=public.get_calendar_worker_health('test');
  perform pg_temp.assert_true(exists(select 1 from jsonb_array_elements(health->'overdue_connections') r
    where r->>'profile_id'=tenant::text and r->>'provider'='stripe' and r->>'severity'='critical' and (r->>'overdue_seconds')::integer>=180),
    'overdue saved Stripe evidence includes age/severity without provider traffic');
  perform pg_temp.assert_true(not exists(select 1 from jsonb_array_elements(health->'overdue_connections') r
    where r->>'profile_id'=other_tenant::text),'health projection does not include another environment');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_stripe_connect_account_refresh(other_tenant,'test',lease)), 'targeted refresh never crosses tenant environment');
  select * into strict claimed from public.claim_stripe_connect_account_refresh(tenant,'test',lease);
  perform pg_temp.assert_true(claimed.profile_id=tenant and claimed.environment='test' and claimed.reconciliation_fencing_token=1,'saved identity and fence returned');
  perform pg_temp.assert_true(claimed.reconciliation_lease_expires_at<=clock_timestamp()+interval '55 seconds','claim lease is finite, not ten minutes');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_stripe_connect_account_refresh(tenant,'test',next_lease)),'concurrent refresh is deduplicated');
  perform pg_temp.assert_true(not public.release_stripe_connect_reconciliation_claim(tenant,'test',lease,99,false),'stale fence cannot release');
  generation:=public.begin_leased_stripe_connect_reconciliation(tenant,'test','acct_calendarfixture',lease,1);
  projected:=public.apply_leased_stripe_connect_account_projection(tenant,'test','acct_calendarfixture',lease,1,generation,true,true,true,
    '{"card_payments":"active"}','{"currently_due":[],"past_due":[],"pending_verification":[]}',null,clock_timestamp());
  perform pg_temp.assert_true(projected.onboarding_state='ready','existing account projection reused');
  perform pg_temp.assert_true(public.release_stripe_connect_reconciliation_claim(tenant,'test',lease,1,true),'current fenced success settles');
  perform pg_temp.assert_true((select count(*)=1 and bool_and(stripe_account_id='acct_calendarfixture') from public.stripe_connected_accounts
    where profile_id=tenant and environment='test'),'verification creates or changes no provider account identity');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_stripe_connect_account_refresh(tenant,'test',next_lease)),'success establishes due cooldown');
  update public.stripe_connected_accounts set reconciliation_due_at=clock_timestamp()-interval '1 second' where profile_id=tenant and environment='test';
  select * into strict claimed from public.claim_due_stripe_connect_accounts('test',next_lease,100);
  perform pg_temp.assert_true(claimed.profile_id=tenant and claimed.reconciliation_fencing_token=2,'global claim shares scoped authority and advances fence');
  perform pg_temp.assert_true(public.release_stripe_connect_reconciliation_claim(tenant,'test',next_lease,2,false),'failed verification settles with cooldown');
  perform pg_temp.assert_true((select reconciliation_due_at>clock_timestamp()+interval '55 seconds' and reconciliation_safe_error is not null
    from public.stripe_connected_accounts where profile_id=tenant and environment='test'),'negative cooldown and failure remain observable');
  insert into public.provider_event_inbox(id,provider,event_id,livemode,payload_hash,environment,account_context,event_family,event_type,profile_id,payload,processing_state,lease_token,fencing_token,lease_expires_at)
  values(webhook_id,'stripe','evt_calendar_health_fixture',false,repeat('a',64),'test','acct_calendarfixture','connect','account.updated',tenant,
    '{"fixture":true}','processing',event_lease,1,clock_timestamp()+interval '55 seconds');
  webhook_generation:=public.begin_stripe_connect_inbox_reconciliation(webhook_id,event_lease,1);
  perform public.apply_stripe_connect_inbox_projection(webhook_id,event_lease,1,webhook_generation,true,true,true,
    '{"card_payments":"active"}','{"currently_due":[],"past_due":[],"pending_verification":[]}',null,clock_timestamp()-interval '1 second');
  perform pg_temp.assert_true((select onboarding_state='ready' and reconciliation_safe_error is null and reconciliation_attempts=0
    from public.stripe_connected_accounts where profile_id=tenant and environment='test'),'webhook after failed release clears old retry metadata atomically');
  perform pg_temp.assert_true((select processing_state='processed' from public.provider_event_inbox where id=webhook_id),'webhook account and inbox settle together');
  update public.stripe_connected_accounts set reconciliation_due_at=clock_timestamp()-interval '1 second' where profile_id=tenant and environment='test';
  select * into strict claimed from public.claim_stripe_connect_account_refresh(tenant,'test',lease);
  generation:=public.begin_leased_stripe_connect_reconciliation(tenant,'test','acct_calendarfixture',lease,3);
  update public.stripe_connected_accounts set reconciliation_lease_expires_at=clock_timestamp()-interval '1 second' where profile_id=tenant and environment='test';
  begin
    perform public.apply_leased_stripe_connect_account_projection(tenant,'test','acct_calendarfixture',lease,3,generation,true,true,true,
      '{"card_payments":"active"}','{"currently_due":[],"past_due":[],"pending_verification":[]}',null,clock_timestamp());
    raise exception 'expired lease projection accepted';
  exception when sqlstate '40001' then null; end;
  perform pg_temp.assert_true(not public.release_stripe_connect_reconciliation_claim(tenant,'test',lease,3,true),'expired owner cannot release or extend due time');
  update public.stripe_connected_accounts set reconciliation_due_at=clock_timestamp()-interval '1 second',reconciliation_attempts=8
    where profile_id=tenant and environment='test';
  select * into strict claimed from public.claim_stripe_connect_account_refresh(tenant,'test',next_lease);
  perform pg_temp.assert_true(public.release_stripe_connect_reconciliation_claim(tenant,'test',next_lease,4,false),'exhausted fast retries still settle');
  perform pg_temp.assert_true((select reconciliation_due_at>clock_timestamp()+interval '9 minutes' and reconciliation_due_at<clock_timestamp()+interval '11 minutes'
    from public.stripe_connected_accounts where profile_id=tenant and environment='test'),'exhausted failures keep a low-rate due path');
  update public.stripe_connected_accounts set reconciliation_due_at=clock_timestamp()-interval '1 second' where profile_id=tenant and environment='test';
  select * into strict claimed from public.claim_stripe_connect_account_refresh(tenant,'test',lease);
  generation:=public.begin_leased_stripe_connect_reconciliation(tenant,'test','acct_calendarfixture',lease,5);
  -- A newer successful webhook must survive an older failed maintenance release.
  webhook_id:=gen_random_uuid();
  insert into public.provider_event_inbox(id,provider,event_id,livemode,payload_hash,environment,account_context,event_family,event_type,profile_id,payload,processing_state,lease_token,fencing_token,lease_expires_at)
  values(webhook_id,'stripe','evt_calendar_health_newer_fixture',false,repeat('b',64),'test','acct_calendarfixture','connect','account.updated',tenant,
    '{"fixture":true}','processing',event_lease,1,clock_timestamp()+interval '55 seconds');
  webhook_generation:=public.begin_stripe_connect_inbox_reconciliation(webhook_id,event_lease,1);
  perform public.apply_stripe_connect_inbox_projection(webhook_id,event_lease,1,webhook_generation,true,true,true,
    '{"card_payments":"active"}','{"currently_due":[],"past_due":[],"pending_verification":[]}',null,clock_timestamp()-interval '1 second');
  begin
    perform public.apply_leased_stripe_connect_account_projection(tenant,'test','acct_calendarfixture',lease,5,generation,false,false,false,
      '{}','{}',null,clock_timestamp());raise exception 'superseded generation projected';
  exception when sqlstate '40001' then null;end;
  perform pg_temp.assert_true(public.release_stripe_connect_reconciliation_claim(tenant,'test',lease,5,false),'older verifier can release without downgrading new evidence');
  perform pg_temp.assert_true((select reconciliation_safe_error is null and reconciliation_attempts=0 and reconciliation_due_at>clock_timestamp()+interval '9 minutes'
    from public.stripe_connected_accounts where profile_id=tenant and environment='test'),'newer successful evidence owns retry/failure projection despite app-clock skew');
  -- The non-leased owner path uses exactly the same metadata clearing reducer.
  update public.stripe_connected_accounts set reconciliation_due_at=clock_timestamp()-interval '1 second' where profile_id=tenant and environment='test';
  select * into strict claimed from public.claim_stripe_connect_account_refresh(tenant,'test',next_lease);
  perform public.release_stripe_connect_reconciliation_claim(tenant,'test',next_lease,6,false);
  generation:=public.begin_stripe_connect_reconciliation(tenant,'test','acct_calendarfixture');
  projected:=public.apply_stripe_connect_account_projection(tenant,'test','acct_calendarfixture',generation,true,true,true,
    '{"card_payments":"active"}','{"currently_due":[],"past_due":[],"pending_verification":[]}',null,clock_timestamp());
  perform pg_temp.assert_true(projected.reconciliation_attempts=0 and projected.reconciliation_safe_error is null,'owner refresh clears metadata without a maintenance release');
  webhook_id:=gen_random_uuid();
  insert into public.provider_event_inbox(id,provider,event_id,livemode,payload_hash,environment,account_context,event_family,event_type,profile_id,payload,processing_state,lease_token,fencing_token,lease_expires_at)
  values(webhook_id,'stripe','evt_calendar_health_expired_fixture',false,repeat('c',64),'test','acct_calendarfixture','connect','account.updated',tenant,
    '{"fixture":true}','processing',event_lease,1,clock_timestamp()+interval '55 seconds');
  webhook_generation:=public.begin_stripe_connect_inbox_reconciliation(webhook_id,event_lease,1);
  last_success:=projected.last_verified_at;
  update public.provider_event_inbox set lease_expires_at=clock_timestamp()-interval '1 second' where id=webhook_id;
  begin
    perform public.apply_stripe_connect_inbox_projection(webhook_id,event_lease,1,webhook_generation,false,false,false,'{}','{}',null,clock_timestamp());
    raise exception 'expired webhook projected';
  exception when no_data_found then null;end;
  perform pg_temp.assert_true((select last_verified_at=last_success and onboarding_state='ready' from public.stripe_connected_accounts
    where profile_id=tenant and environment='test'),'expired webhook cannot update status or clearing metadata');
end $$;
rollback;
\echo 'calendar-worker-schedules: passed'
