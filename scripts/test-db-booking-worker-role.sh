#!/usr/bin/env bash
set -euo pipefail
command -v psql >/dev/null || { echo "psql is required" >&2; exit 1; }
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BOOTSTRAP_ROLE=${BOOKING_WORKER_ROLE_BOOTSTRAP_ROLE:-${PGUSER:-$(id -un)}}
if [[ "${BOOKING_WORKER_ROLE_EXTERNAL_DATABASE:-0}" = 1 ]]; then
  psql -v ON_ERROR_STOP=1 -At -c "select 1" | grep -qx 1
else
  for command in initdb pg_ctl; do
    command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
  done
  DATA=$(mktemp -d "${TMPDIR:-/tmp}/obra-worker-role-pg.XXXXXX")
  PORT=${BOOKING_WORKER_ROLE_TEST_PG_PORT:-55469}
  SOCKET_DIR=${TMPDIR:-/tmp}
  cleanup(){ pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
  trap cleanup EXIT INT TERM
  initdb -D "$DATA" -A trust --no-locale >/dev/null
  pg_ctl -D "$DATA" -o "-k $SOCKET_DIR -p $PORT" -l "$DATA/postgres.log" start >/dev/null
  export PGHOST=$SOCKET_DIR PGPORT=$PORT PGDATABASE=postgres PGUSER=$(id -un)
fi

export PGOPTIONS="${PGOPTIONS:-} -c obra_test.bootstrap_role=$BOOTSTRAP_ROLE"
psql -v ON_ERROR_STOP=1 <<'SQL'
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role authenticator nologin noinherit;
create role custom_platform_role nologin;
create role foreign_owner login;
create role migration_owner login createrole nosuperuser nocreatedb noreplication nobypassrls noinherit;
create schema runner authorization migration_owner;
create table runner.applied_repo_migrations(name text primary key,checksum text not null);
create table runner.migration_runs(name text,checksum text,mode text,result text,error_message text,sqlstate text);
grant usage on schema runner to migration_owner;
grant all on all tables in schema runner to migration_owner;
create or replace function runner.apply_repo_migration(p_name text,p_checksum text,p_sql text,p_mode text)
returns jsonb language plpgsql security definer set search_path=runner as $runner$
declare v_error text;v_state text;
begin
 if p_mode not in('dry_run','apply')then raise exception 'invalid mode';end if;
 if exists(select 1 from runner.applied_repo_migrations where name=p_name)then return jsonb_build_object('status','already_applied');end if;
 begin
  execute p_sql;
  if p_mode='dry_run'then raise exception '__DRY_RUN_ROLLBACK__';end if;
 exception when others then
  get stacked diagnostics v_error=message_text,v_state=returned_sqlstate;
  if v_error='__DRY_RUN_ROLLBACK__'then
   insert into runner.migration_runs values(p_name,p_checksum,p_mode,'ok',null,null);
   return jsonb_build_object('status','dry_run_ok');
  end if;
  insert into runner.migration_runs values(p_name,p_checksum,p_mode,'error',v_error,v_state);
  return jsonb_build_object('status','error','message',v_error,'sqlstate',v_state);
 end;
 insert into runner.applied_repo_migrations values(p_name,p_checksum);
 insert into runner.migration_runs values(p_name,p_checksum,p_mode,'ok',null,null);
 return jsonb_build_object('status','applied');
end $runner$;
alter function runner.apply_repo_migration(text,text,text,text) owner to migration_owner;
alter schema public owner to migration_owner;
set role migration_owner;
create function public.claim_due_booking_payment_events(text,uuid,integer) returns void language sql as $$select$$;
create function public.fail_booking_payment_event(uuid,uuid,bigint,text) returns void language sql as $$select$$;
create function public.apply_booking_provider_evidence(uuid,uuid,bigint) returns void language sql as $$select$$;
create function public.ensure_booking_refund_submission(uuid,bigint) returns void language sql as $$select$$;
create function public.settle_booking_refund_command(uuid,uuid,bigint,text,text,bigint,bigint) returns void language sql as $$select$$;
create function public.claim_due_booking_outbox(uuid,integer) returns void language sql as $$select$$;
create function public.get_booking_outbox_context(uuid,uuid,bigint) returns void language sql as $$select$$;
create function public.claim_booking_calendar_reconciliation(text,uuid,integer) returns void language sql as $$select$$;
create function public.bind_booking_calendar_intent(uuid,uuid,bigint,text) returns void language sql as $$select$$;
create function public.complete_booking_outbox(uuid,uuid,bigint,jsonb) returns void language sql as $$select$$;
create function public.fail_booking_outbox(uuid,uuid,bigint,boolean,text) returns void language sql as $$select$$;
create function public.expire_due_booking_holds(integer) returns void language sql as $$select$$;
create function public.claim_ambiguous_booking_checkouts(text,uuid,integer) returns void language sql as $$select$$;
create function public.settle_booking_checkout(uuid,uuid,bigint,text,timestamptz,boolean,boolean,text) returns void language sql as $$select$$;
create function public.claim_due_booking_sessions(text,uuid,integer) returns void language sql as $$select$$;
create function public.settle_due_booking_session(uuid,uuid,bigint,boolean,boolean,text,text,bigint,text) returns void language sql as $$select$$;
create function public.list_due_booking_attachment_scans(integer) returns void language sql as $$select$$;
create function public.claim_booking_attachment_scan(uuid,uuid,integer) returns void language sql as $$select$$;
create function public.complete_booking_attachment_scan(uuid,uuid,bigint,text,text) returns void language sql as $$select$$;
create function public.settle_booking_calendar_claim(uuid,uuid,bigint,text,text) returns void language sql as $$select$$;
create function public.enqueue_booking_notification(uuid,text) returns void language sql as $$select$$;
create function public.claim_due_booking_notifications(uuid,integer) returns void language sql as $$select$$;
create function public.get_booking_notification_context(uuid) returns void language sql as $$select$$;
create function public.complete_booking_notification(uuid,uuid,bigint,text) returns void language sql as $$select$$;
create function public.fail_booking_notification(uuid,uuid,bigint,boolean,text) returns void language sql as $$select$$;
grant execute on function public.claim_due_booking_payment_events(text,uuid,integer) to custom_platform_role;
reset role;
SQL

MIGRATION=$(cat "$ROOT/supabase/migrations/20260829093918_booking_worker_role.sql")
CHECKSUM=$(shasum -a 256 "$ROOT/supabase/migrations/20260829093918_booking_worker_role.sql" | awk '{print $1}')
psql -v ON_ERROR_STOP=1 -v sql="$MIGRATION" -v checksum="$CHECKSUM" <<'SQL'
create or replace function pg_temp.assert_true(ok boolean,message text)returns void language plpgsql as $$begin if ok is not true then raise exception 'assertion failed: %',message;end if;end$$;
select runner.apply_repo_migration('20260829093918_booking_worker_role.sql',:'checksum',:'sql','dry_run') as dry_run_result \gset
\echo :dry_run_result
select pg_temp.assert_true((:'dry_run_result'::jsonb->>'status')='dry_run_ok','worker role dry run did not succeed');
select pg_temp.assert_true((select count(*)=0 from pg_catalog.pg_roles where rolname='booking_worker'),'worker role dry run leaked a role');
select pg_temp.assert_true((runner.apply_repo_migration('20260829093918_booking_worker_role.sql',:'checksum',:'sql','apply')->>'status')='applied','worker role apply did not succeed');
SQL

psql -v ON_ERROR_STOP=1 <<'SQL'
do $assert$
begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname='booking_worker' and rolcanlogin=false and rolsuper=false and rolcreatedb=false and rolcreaterole=false and rolreplication=false and rolbypassrls=false and rolinherit=false)then raise exception 'unsafe worker role flags';end if;
 if current_setting('server_version_num')::integer>=160000 then
  if (select count(*) from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid=m.roleid join pg_catalog.pg_roles u on u.oid=m.member where g.rolname='booking_worker'or u.rolname='booking_worker')<>2 then raise exception 'unexpected PG17 worker membership count';end if;
  if exists(select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid=m.roleid join pg_catalog.pg_roles u on u.oid=m.member join pg_catalog.pg_roles by_role on by_role.oid=m.grantor where(g.rolname='booking_worker'or u.rolname='booking_worker')and not(g.rolname='booking_worker'and((u.rolname='authenticator'and by_role.rolname='migration_owner'and m.admin_option=false and m.inherit_option=true and m.set_option=true)or(u.rolname='migration_owner'and by_role.rolname=current_setting('obra_test.bootstrap_role')and by_role.rolname<>'migration_owner'and by_role.rolsuper=true and m.admin_option=true and m.inherit_option=false and m.set_option=false))))then raise exception 'unsafe PG16+ worker membership edge';end if;
 else
  if (select count(*) from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid=m.roleid join pg_catalog.pg_roles u on u.oid=m.member where g.rolname='booking_worker'or u.rolname='booking_worker')<>1 then raise exception 'unexpected worker membership count';end if;
  if not exists(select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid=m.roleid join pg_catalog.pg_roles u on u.oid=m.member where g.rolname='booking_worker'and u.rolname='authenticator'and m.admin_option=false)then raise exception 'missing bounded authenticator membership';end if;
 end if;
 if pg_catalog.has_schema_privilege('public','public','CREATE')then raise exception 'PUBLIC schema CREATE remains';end if;
 if exists(select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'))then raise exception 'PUBLIC function EXECUTE remains: %',(select string_agg(p.oid::regprocedure::text,', ' order by p.oid::regprocedure::text) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and pg_catalog.has_function_privilege('public',p.oid,'EXECUTE'));end if;
 if not has_function_privilege('custom_platform_role','public.claim_due_booking_payment_events(text,uuid,integer)','EXECUTE')then raise exception 'custom explicit ACL was not preserved';end if;
end $assert$;
SQL

# A pre-existing identity must fail closed before membership or RPC/schema grants.
psql -v ON_ERROR_STOP=1 <<'SQL'
drop owned by booking_worker;
drop role booking_worker;
create role booking_worker login;
SQL
UNSAFE=$(psql -At -v ON_ERROR_STOP=1 -v sql="$MIGRATION" -v checksum="unsafe-$CHECKSUM" <<'SQL'
select runner.apply_repo_migration('unsafe-worker-role.sql',:'checksum',:'sql','dry_run');
SQL
)
printf 'unsafe_result=%s\n' "$UNSAFE"
node -e 'const x=JSON.parse(process.argv[1]);if(x.status!=="error"||x.sqlstate!=="42501"||x.message!=="booking_worker role must not preexist")process.exit(1)' "$UNSAFE"
POST=$(psql -At -v ON_ERROR_STOP=1 <<'SQL'
select (select count(*) from pg_catalog.pg_auth_members m join pg_catalog.pg_roles g on g.oid=m.roleid join pg_catalog.pg_roles u on u.oid=m.member where(g.rolname='booking_worker' or u.rolname='booking_worker')and u.rolname='authenticator'),has_schema_privilege('booking_worker','public','USAGE'),has_schema_privilege('booking_worker','public','CREATE');
SQL
)
printf 'unsafe_postconditions=%s\n' "$POST"
[[ "$POST" = '0|t|f' ]]


# If any PUBLIC-executable function has another owner, abort before creating the worker.
psql -v ON_ERROR_STOP=1 <<'SQL'
drop role booking_worker;
grant create on schema public to foreign_owner;
set role foreign_owner;
create function public.foreign_public_function()returns boolean language sql as $$select true$$;
reset role;
revoke create on schema public from foreign_owner;
SQL
FOREIGN=$(psql -At -v ON_ERROR_STOP=1 -v sql="$MIGRATION" -v checksum="foreign-$CHECKSUM" <<'SQL'
select runner.apply_repo_migration('foreign-owned-function.sql',:'checksum',:'sql','dry_run');
SQL
)
printf 'foreign_owner_result=%s
' "$FOREIGN"
node -e 'const x=JSON.parse(process.argv[1]);if(x.status!=="error"||x.sqlstate!=="42501"||x.message!=="migration owner cannot close all PUBLIC function grants")process.exit(1)' "$FOREIGN"
psql -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_catalog.pg_roles where rolname='booking_worker'" | grep -qx 0

echo 'booking-worker-role: constrained migration-runner regression passed'
