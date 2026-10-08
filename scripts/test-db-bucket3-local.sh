#!/usr/bin/env bash
set -euo pipefail

for command in psql node; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
node "$ROOT/scripts/verify-combined-migration-projection.mjs"
if [[ "${BOOKING_TEST_EXTERNAL_DATABASE:-0}" != 0 ]]; then
  echo "This replay requires its own disposable local PostgreSQL cluster" >&2
  exit 1
fi
# No inherited libpq target, startup options, password file, or psql rc can steer
# a destructive schema replay. The only database is the cluster started below.
for variable in ${!PG@}; do unset "$variable"; done
export LC_ALL=C PSQLRC=/dev/null
REPLAY_SAFEUPDATE=""
if [[ -n "${BOOKING_TEST_SAFEUPDATE_LIBRARY:-}" ]]; then
  [[ "$BOOKING_TEST_SAFEUPDATE_LIBRARY" =~ ^[A-Za-z0-9_./-]+$ ]] || { echo "invalid safeupdate library path" >&2; exit 1; }
fi
for command in initdb pg_ctl; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done
DATA=$(mktemp -d "${TMPDIR:-/tmp}/obra-booking-pg.XXXXXX")
LOG="$DATA/postgres.log"
cleanup() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT INT TERM
PORT=${BOOKING_TEST_PG_PORT:-$(node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1024 && "$PORT" -le 65535 ]] || { echo "invalid local PostgreSQL port" >&2; exit 1; }

initdb -D "$DATA" -A trust --no-locale -E UTF8 >/dev/null
# Darwin socket paths cannot fit long isolated worktree names. Loopback also
# lets the SQL suites use real second-backend dblink concurrency without secrets.
pg_ctl -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c wal_level=logical" -l "$LOG" start >/dev/null
export PGHOST=127.0.0.1 PGPORT="$PORT" PGDATABASE=postgres PGPASSFILE="$DATA/no-password"
export PGUSER=$(id -un)
echo "bucket3-local: disposable 127.0.0.1:$PORT"
psql -X -w -Atq -v ON_ERROR_STOP=1 -v expected_port="$PORT" <<'SQL' | grep -qx t
select inet_server_addr()='127.0.0.1'::inet and inet_server_port()=:'expected_port'::integer
  and current_database()='postgres' and not exists(select 1 from pg_extension where extname in('pg_cron','pg_net'));
SQL

psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create role anon;
create role authenticated;
create role service_role;
create role authenticator noinherit;
create role booking_test_owner login createrole nosuperuser nocreatedb noreplication nobypassrls noinherit;
create role calendar_extension_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
create role calendar_prior_owner login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
create schema auth;
create schema storage;
create schema extensions;
create schema vault authorization calendar_extension_owner;
create schema cron authorization calendar_extension_owner;
create schema net authorization calendar_extension_owner;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists dblink with schema extensions;
create extension if not exists btree_gist with schema extensions;
grant usage on schema extensions to public;
grant usage on schema extensions to calendar_extension_owner;
grant usage,create on schema public to booking_test_owner;
alter schema public owner to booking_test_owner;
alter schema auth owner to booking_test_owner;
alter schema storage owner to booking_test_owner;
do $$begin execute format('grant create on database %I to booking_test_owner',current_database());end$$;
create publication supabase_realtime;
alter publication supabase_realtime owner to booking_test_owner;
set role booking_test_owner;
create table auth.users(
  instance_id uuid default '00000000-0000-0000-0000-000000000000',
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false,
  banned_until timestamptz,
  deleted_at timestamptz
);
create function auth.sync_confirmation_timestamps() returns trigger language plpgsql as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, new.confirmed_at);
  new.confirmed_at := coalesce(new.confirmed_at, new.email_confirmed_at);
  return new;
end;
$$;
create trigger auth_users_sync_confirmation
  before insert or update on auth.users
  for each row execute function auth.sync_confirmation_timestamps();
create table auth.sessions(id uuid primary key default extensions.gen_random_uuid(),user_id uuid not null references auth.users(id),created_at timestamptz default now(),updated_at timestamptz default now());
create table auth.refresh_tokens(id bigint generated always as identity primary key,session_id uuid references auth.sessions(id));
create table auth.mfa_factors(id uuid primary key default extensions.gen_random_uuid(),user_id uuid not null references auth.users(id),factor_type text default 'totp',status text,updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default extensions.gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(trim(both '/' from name),'/')$$;
-- These platform stubs persist only fixture data. No pg_cron/pg_net extension or
-- background worker is installed, and no SQL command below performs network I/O.
reset role;
set role calendar_extension_owner;
create table vault.decrypted_secrets(id uuid primary key default extensions.gen_random_uuid(),name text unique,decrypted_secret text,description text);
create or replace function vault.create_secret(new_secret text,new_name text default null,new_description text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare secret_id uuid;begin
  insert into vault.decrypted_secrets(name,decrypted_secret,description) values(new_name,new_secret,new_description) returning id into secret_id;
  return secret_id;
end$$;
create or replace function vault.update_secret(secret_id uuid,new_secret text default null,new_name text default null,new_description text default null) returns void language plpgsql security definer set search_path='' as $$
begin
  update vault.decrypted_secrets s set decrypted_secret=coalesce(new_secret,s.decrypted_secret),name=coalesce(new_name,s.name),description=coalesce(new_description,s.description)
    where s.id=secret_id;
end$$;
create table cron.job(jobid bigint generated always as identity primary key,jobname name,command text not null,schedule text not null,
  nodename text not null default 'localhost',nodeport integer not null default current_setting('port')::integer,
  database text not null default current_database(),username text not null default current_user,active boolean not null default true,unique(jobname,username));
grant select on cron.job to public;
alter table cron.job enable row level security;
create policy cron_job_policy on cron.job using(username=current_user);
-- C's internal owner switch is inertly modelled after capturing/checking the
-- caller. The app owner has no table writes or extension-role membership.
create function cron.fixture_schedule(p_name text,p_schedule text,p_command text,p_user text) returns bigint
language plpgsql security definer set search_path='' as $$
declare next_id bigint;begin
  insert into cron.job(jobname,schedule,command,username) values(p_name,p_schedule,p_command,p_user)
    on conflict(jobname,username)do update set schedule=excluded.schedule,command=excluded.command,active=true returning jobid into next_id;
  return next_id;
end$$;
create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language sql as $$
  select cron.fixture_schedule(p_name,p_schedule,p_command,current_user::text)$$;
create function cron.fixture_unschedule(p_jobid bigint,p_user text) returns boolean
language plpgsql security definer set search_path='' as $$begin
  delete from cron.job where jobid=p_jobid and username=p_user;return found;end$$;
create function cron.unschedule(p_jobid bigint) returns boolean language sql as $$
  select cron.fixture_unschedule(p_jobid,current_user::text)$$;
create function cron.unschedule(p_name text) returns boolean language sql as $$
  select cron.unschedule(jobid) from cron.job where jobname=p_name and username=current_user$$;
create function cron.fixture_alter(job_id bigint,p_schedule text,p_command text,p_database text,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$begin
  update cron.job j set schedule=coalesce(p_schedule,j.schedule),command=coalesce(p_command,j.command),
    database=coalesce(p_database,j.database),active=coalesce(p_active,j.active)where j.jobid=job_id;end$$;
create or replace function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,
  username text default null,active boolean default null) returns void language plpgsql as $$
begin
  if username is not null or not exists(select 1 from cron.job j where j.jobid=job_id and j.username=current_user) then
    raise exception 'Job does not exist or you do not own it' using errcode='42501';end if;
  perform cron.fixture_alter(job_id,schedule,command,database,active);
end$$;
revoke all on function cron.alter_job(bigint,text,text,text,text,boolean) from public;
create table net._http_response(id bigint primary key,status_code integer,content_type text,headers jsonb,content text,timed_out boolean,error_msg text,created timestamptz default now());
create sequence net.http_request_id_seq;
create or replace function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{"Content-Type":"application/json"}'::jsonb,
   timeout_milliseconds integer default 5000) returns bigint language sql security definer set search_path='' as $$select nextval('net.http_request_id_seq')$$;
grant usage on schema cron,net,vault to booking_test_owner;
grant usage on schema cron to calendar_prior_owner;
grant select on net._http_response,vault.decrypted_secrets to booking_test_owner;
reset role;
set role booking_test_owner;
-- Mirror the schema/ACL of the skipped deployment-only canonical cron migration,
-- not its schedule installation. Tests explicitly model registration/activation.
create table public.background_job_cron_requests(id bigint generated always as identity primary key,schedule_name text not null,request_id bigint not null unique,
  requested_at timestamptz not null default now(),responded_at timestamptz,status_code integer,timed_out boolean,error_message text);
revoke all on public.background_job_cron_requests from public,anon,authenticated;
grant select,insert on public.background_job_cron_requests to service_role;
grant usage on sequence public.background_job_cron_requests_id_seq to service_role;
create view public.background_job_cron_health with(security_invoker=true) as
select schedule_name,request_id,requested_at,responded_at,status_code,timed_out,error_message,
  case when responded_at is null and requested_at<now()-interval '2 minutes' then 'missing_response'
    when responded_at is null then 'pending' when timed_out then 'timed_out'
    when status_code between 200 and 299 then 'succeeded' else 'failed' end as outcome
from public.background_job_cron_requests;
revoke all on public.background_job_cron_health from public,anon,authenticated;
grant select on public.background_job_cron_health to service_role;
SQL

# Keep migration ownership constrained, including with safeupdate. LOAD runs as
# this disposable cluster's bootstrap user before switching to the definer owner.
psql() {
  local prelude="set role none;" argument has_input=false
  for argument in "$@"; do
    case "$argument" in -c|-f|--command|--file|--command=*|--file=*) has_input=true ;; esac
  done
  if [[ "$has_input" = false ]]; then set -- "$@" -f -; fi
  if [[ -n "${REPLAY_SAFEUPDATE:-}" ]]; then prelude+="load '$REPLAY_SAFEUPDATE';"; fi
  # RESET ROLE inside a behavior test returns to the connection's constrained
  # role, not the bootstrap superuser used only to load the local extension.
  PGOPTIONS="-c role=booking_test_owner -c client_min_messages=warning" command psql -X -w -q -v ON_ERROR_STOP=1 -c "$prelude reset role;" "$@"
}

AGENT_TURN_MIGRATION=20260911170632_f4a9204d-945a-4c5b-a778-3520dd5a9a47.sql
AGENT_TURN_STATE_SQL="select jsonb_build_array(pg_get_functiondef(p.oid),p.proowner,p.proacl,
  has_function_privilege('service_role',p.oid,'EXECUTE'),
  has_function_privilege('anon',p.oid,'EXECUTE'),
  has_function_privilege('authenticated',p.oid,'EXECUTE'),
  has_function_privilege('booking_worker',p.oid,'EXECUTE'))
  from pg_proc p where p.oid='public.claim_agent_turn(uuid,uuid,text,text,uuid,text,uuid,bigint,uuid,integer)'::regprocedure"

for migration in "$ROOT"/supabase/migrations/*.sql; do
  name=$(basename "$migration")
  case "$name" in
    20260809210000_otp_rate_limit.sql|20260811000000_agent_traces.sql) continue ;;
    20260824155312_*|20260824164215_*|20260824240000_canonical_lovable_job_cron.sql) continue ;;
    # Apply each generation revision once. UUID-named Lovable files duplicate the earlier
    # canonical files except 20260829093506, which is the hosted-history compatibility patch.
    20260828172000_*) continue ;;
    20260829080453_*|20260829081231_*|20260829092517_*|20260829092631_*|20260829092714_*|20260829093132_*|20260829093345_*|20260829093820_*) continue ;;
    # Deployment-only data operations, not schema revisions: the first wipes our historical
    # fixtures; the second requires a particular production account absent from this database.
    20260909223245_5ad3e2d5-9ae8-4bee-b91f-9faeb552b684.sql) continue ;;
    20260909223840_2e80086c-328c-4a29-810d-43f6ff7105db.sql) continue ;;
  esac
  if [[ "$name" == "20260910120000_google_calendar_lifetime.sql" ]]; then
    # Main already contains this later-dated replacement. Exercise forward deployment
    # before the lifetime additions, then leave its normal sorted replay intact.
    psql -f "$ROOT/supabase/migrations/$AGENT_TURN_MIGRATION" >/dev/null
    agent_turn_before=$(psql -Atq -c "$AGENT_TURN_STATE_SQL")
    echo "bucket3-local: forward-order preapplied $AGENT_TURN_MIGRATION before lifetime migrations"
  fi
  if [[ "$name" == "20260829093923_booking_customer_lifecycle_closure.sql" ]]; then
    legacy_notification_appointment=$(psql -At -v ON_ERROR_STOP=1 -c "select appointment_id from public.booking_notifications where id='71000000-0000-0000-0000-000000000008'")
    legacy_notification_profile=$(psql -At -v ON_ERROR_STOP=1 -c "select profile_id from public.booking_notifications where id='71000000-0000-0000-0000-000000000008'")
    legacy_notification_environment=$(psql -At -v ON_ERROR_STOP=1 -c "select environment from public.booking_notifications where id='71000000-0000-0000-0000-000000000008'")
    psql -v ON_ERROR_STOP=1 -c "insert into public.booking_notifications(id,appointment_id,profile_id,environment,notification_type,audience,recipient_email,idempotency_key,occurrence_version,state)values('71000000-0000-0000-0000-00000000000a','$legacy_notification_appointment','$legacy_notification_profile','$legacy_notification_environment','confirmed','contractor','preserved@example.com','legacy-preserved',0,'pending')"
    psql -v ON_ERROR_STOP=1 -c "alter table public.booking_notifications add column if not exists source_event_key text;update public.booking_notifications set source_event_key='already-frozen' where id='71000000-0000-0000-0000-00000000000a'"
    node - "$migration" <<'NODE'
const fs = require("node:fs");
const sql = fs.readFileSync(process.argv[2], "utf8");
if (/update public\.booking_notifications set source_event_key=coalesce\(source_event_key,idempotency_key\);/i.test(sql)) {
  throw new Error("customer lifecycle migration contains a managed-safeupdate-incompatible backfill");
}
if (!/update public\.booking_notifications set source_event_key=idempotency_key where source_event_key is null;/i.test(sql)) {
  throw new Error("customer lifecycle notification backfill must be explicitly qualified");
}
NODE
  fi
  if [[ "$name" == "20260829093920_booking_refund_correlation_preflight.sql" ]]; then
    psql -v ON_ERROR_STOP=1 -c "insert into public.booking_refunds(id,payment_id,appointment_id,profile_id,environment,generation,stripe_account_id,payment_intent_id,idempotency_key,amount_minor)values('71000000-0000-0000-0000-000000000009','71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','test',9,'acct_mismatch','pi_mismatch','legacy-mismatch',100)"
  fi
  if [[ "$name" == "20260829093916_booking_attachment_audited_lifecycle.sql" ]]; then
    legacy_notification_appointment=$(psql -At -v ON_ERROR_STOP=1 -c "select id from public.appointments limit 1")
    legacy_notification_profile=$(psql -At -v ON_ERROR_STOP=1 -c "select profile_id from public.appointments where id='$legacy_notification_appointment'")
    legacy_notification_environment=$(psql -At -v ON_ERROR_STOP=1 -c "select environment from public.appointments where id='$legacy_notification_appointment'")
    psql -v ON_ERROR_STOP=1 -c "insert into public.booking_notifications(id,appointment_id,profile_id,environment,notification_type,audience,recipient_email,idempotency_key,occurrence_version,state)values('71000000-0000-0000-0000-000000000008','$legacy_notification_appointment','$legacy_notification_profile','$legacy_notification_environment','confirmed','customer','unsendable@invalid','legacy-invalid-recipient',0,'pending')"
  fi
  if [[ "$name" == "20260829093911_bucket3_live_booking_lifecycle.sql" ]]; then
    psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
insert into public.profiles(id,license_number,email,environment)values('71000000-0000-0000-0000-000000000001','VET-LEGACY','legacy@example.com','test');
insert into public.websites(id,user_id,status,environment)values('71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','draft','test');
insert into public.website_entitlements(id,profile_id,website_id,environment,plan,state,booking_admission)values('71000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000004','test','pro','active',true);
insert into public.booking_services(id,profile_id,environment,name,duration_minutes,amount_minor,currency,active)values('71000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000001','test','Legacy',60,1000,'USD',true);
insert into public.booking_customers(id,profile_id,environment,full_name,email_normalized,phone_normalized,address_snapshot,source_website_id)values('71000000-0000-0000-0000-000000000007','71000000-0000-0000-0000-000000000001','test','Foundation wave','foundation-wave-customer@example.com','+15555550123','{}','71000000-0000-0000-0000-000000000004');
insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,public_reference,start_at,end_at,local_date,local_start,time_zone,customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,reservation_expires_at)
values('71000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000005','71000000-0000-0000-0000-000000000006','71000000-0000-0000-0000-000000000007','test',gen_random_uuid(),now()+interval'1 day',now()+interval'1 day 1 hour',(now()+interval'1 day')::date,(now()+interval'1 day')::time,'UTC','{}','{}','{}',1000,'USD',60,tstzrange(now()+interval'1 day',now()+interval'1 day 1 hour','[)'),'cancelled','paid',null);
insert into public.booking_payments(id,profile_id,appointment_id,environment,expected_amount_minor,currency,checkout_session_id,payment_intent_id,payment_state,refund_state,amount_paid_minor,amount_refunded_minor,dispute_state)
values('71000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','test',1000,'USD','cs_legacy','pi_legacy','paid','succeeded',1000,500,'open');
SQL
  fi
  if [[ "$name" == "20260829093921_booking_money_authority_closure.sql" ]]; then
    psql -At -v ON_ERROR_STOP=1 -c "select count(*) from public.booking_cutover_quarantine where entity_id='71000000-0000-0000-0000-000000000009' and reason_code='refund_payment_correlation_mismatch' and resolved_at is null" | grep -qx 1
    if psql -1 -v ON_ERROR_STOP=1 -f "$migration" >/dev/null 2>&1; then echo "money closure unexpectedly accepted unresolved refund correlation" >&2; exit 1; fi
    psql -At -v ON_ERROR_STOP=1 -c "select count(*) from public.booking_cutover_quarantine where entity_id='71000000-0000-0000-0000-000000000009' and reason_code='refund_payment_correlation_mismatch' and resolved_at is null" | grep -qx 1
    psql -v ON_ERROR_STOP=1 -c "update public.booking_cutover_quarantine set resolved_at=clock_timestamp() where entity_id='71000000-0000-0000-0000-000000000009' and reason_code='refund_payment_correlation_mismatch';delete from public.booking_refunds where id='71000000-0000-0000-0000-000000000009'"
  fi
  if [[ "$name" == "20260829093924_admin_auth_authority_closure.sql" ]]; then
    psql -v ON_ERROR_STOP=1 -c "insert into auth.users(id,email,confirmed_at)values('71100000-0000-0000-0000-000000000001','preclosure-admin@example.com',pg_catalog.clock_timestamp());insert into public.admin_principals(user_id,role,enabled,mfa_required)values('71100000-0000-0000-0000-000000000001','admin',true,true);insert into public.admin_sessions(token_hash,user_id,role,aal,auth_epoch,idle_expires_at,absolute_expires_at)values(repeat('b',64),'71100000-0000-0000-0000-000000000001','admin','aal2',1,pg_catalog.clock_timestamp()+interval '30 minutes',pg_catalog.clock_timestamp()+interval '12 hours');"
  fi
  if [[ "$name" == "20260905181159_activate_sandbox_saas_offers.sql" ]]; then
    sandbox_checkout_count=$(psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.checkout_sessions")
    sandbox_subscription_count=$(psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.subscriptions")
    live_offer_routes_before=$(psql -Atq -v ON_ERROR_STOP=1 -c "select coalesce(string_agg(plan||':'||price_id||':'||product_id,'|' order by plan),'') from public.saas_offer_contracts where environment='live' and active_for_new_sales")
  fi
  if [[ "$name" == "20260909100000_fix_booking_availability_override_aliases.sql" ]]; then
    psql -v ON_ERROR_STOP=1 -v expect_override_alias_failure=true -f "$ROOT/supabase/tests/booking-availability-save.sql"
  fi
  if [[ "$name" == "20260910133000_booking_notification_lifetime.sql" ]]; then
    psql -v notification_legacy_fixture=true -f "$ROOT/supabase/tests/booking-notification-lifetime.sql"
  fi
  if [[ "$name" == "20260910140000_calendar_worker_schedules.sql" ]]; then
    node - "$migration" <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const source = fs.readFileSync(process.argv[2],'utf8');
const name = '20260910140000_calendar_worker_schedules.sql';
const checksum = createHash('sha256').update(source).digest('hex');
function sql(input) {
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const library=process.env.BOOKING_TEST_SAFEUPDATE_LIBRARY;
  const result = spawnSync('psql',['-X','-w','-v','ON_ERROR_STOP=1','-Atq'],{
    env:process.env,input:"set client_min_messages=warning;\n"+(library?`load '${library}';\n`:"")+input,encoding:'utf8',maxBuffer:1024*1024,
  });
  if(result.status!==0)throw new Error(result.stderr);
  return result.stdout.trim();
}
function migrate(mode,body=source,migrationName=name) {
  return JSON.parse(sql(`set role service_role;select public.apply_repo_migration('${migrationName}','${checksum}',$fixture$${body}$fixture$,'${mode}','disposable-harness');`));
}
assert.equal(migrate('dry_run').sqlstate,'42501','native alter EXECUTE is required before installation changes');
sql(`set role calendar_prior_owner;
  select cron.schedule('obra-calendar-test-google','* * * * *','select 13;');
  select cron.schedule('obra-calendar-live-google','* * * * *','select 17;');
  select cron.schedule('obra-record-background-job-responses','* * * * *','select 18;');
  select cron.schedule('foreign-unrelated-calendar-fixture','* * * * *','select 19;');`);
const schedulesBefore=sql("select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j");
const policiesBefore=sql("select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid='cron.job'::regclass");
assert.equal(sql(`set role booking_test_owner;
  select count(*) from cron.job where username='calendar_prior_owner'`),'0',
  'stock owner-only RLS hides same/opposite-environment foreign jobs and shared recorder');
// Inert fixture setup supplies already-provisioned native authority only. No
// production bootstrap is extracted from docs or run against extension tables.
sql(`set role calendar_extension_owner;
  grant execute on function cron.schedule(text,text,text) to booking_test_owner;
  grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to booking_test_owner;`);
assert.equal(migrate('dry_run',
  'create policy fixture_self_grant on cron.job for select to booking_test_owner using (true)',
  'calendar-policy-self-grant-negative').sqlstate,'42501',
  'a native scheduler function grantee still cannot CREATE POLICY');
assert.equal(sql(`select has_function_privilege('booking_test_owner','cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE')
  and not has_function_privilege('booking_test_owner','cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE WITH GRANT OPTION')
  and not has_table_privilege('booking_test_owner','cron.job','UPDATE')
  and not has_table_privilege('booking_test_owner','cron.job','INSERT')
  and not has_table_privilege('booking_test_owner','cron.job','DELETE')
  and not pg_has_role('booking_test_owner','calendar_extension_owner','MEMBER')
  and not has_function_privilege('service_role','cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE')`),'t');
assert.equal(sql(`set role booking_test_owner;select count(*) from cron.job where username='calendar_prior_owner'`),'0',
  'baseline native grants do not reveal foreign rows');
for(const role of ['anon','authenticated','service_role','booking_worker']) {
  assert.equal(sql(`begin;set local role calendar_extension_owner;grant usage on schema cron to ${role};
    reset role;set local role ${role};select count(*) from cron.job where username='calendar_prior_owner';rollback;`),'0',
    `owner-only RLS does not expand ${role} visibility`);
}
const verified=migrate('dry_run');
assert.equal(verified.status,'dry_run_ok',JSON.stringify(verified));
assert.equal(sql("select to_regprocedure('public.register_calendar_worker_schedules(text)') is null"),'t',
  'service migration dry run rolls back function installation');
assert.equal(sql("select count(*)=4 and bool_and(active) from cron.job where username='calendar_prior_owner'"),'t',
  'the migration dry run must preserve foreign jobs without installing its own');
for(const revoke of [
  'set local role calendar_extension_owner;revoke usage on schema cron from booking_test_owner',
  'set local role calendar_extension_owner;revoke select on cron.job from public',
  'set local role calendar_extension_owner;revoke execute on function cron.schedule(text,text,text) from public,booking_test_owner',
  'set local role calendar_extension_owner;revoke execute on function cron.alter_job(bigint,text,text,text,text,boolean) from booking_test_owner',
  'alter role booking_test_owner nologin',
]) {
  sql(`begin;${revoke};reset role;set local role service_role;do $missing_privileges$declare result jsonb;begin
    result:=public.apply_repo_migration('${name}','${checksum}',$migration$${source}$migration$,'apply','disposable-harness');
    if result->>'sqlstate' is distinct from '42501' or result->>'message' is distinct from 'Calendar scheduler owner requires native cron privileges' then
      raise exception 'missing native privilege/login did not fail preflight: %',result;end if;
    end $missing_privileges$;reset role;do $$begin
      if to_regprocedure('public.register_calendar_worker_schedules(text)') is not null
        or exists(select 1 from pg_attribute where attrelid='public.stripe_connected_accounts'::regclass and attname='reconciliation_attempts')
        or exists(select 1 from cron.job where username='booking_test_owner' and jobname like 'obra-calendar-%')
        or exists(select 1 from public.applied_repo_migrations where name='${name}') then
        raise exception 'failed installation changed schema, jobs or applied ledger';end if;
    end $$;rollback;`);
}
assert.equal(migrate('apply').status,'applied','service runner applies exact dry-run bytes with native grants and no custom visibility policy');
assert.equal(sql("select count(*)=1 from public.applied_repo_migrations where name='"+name+"' and checksum='"+checksum+"'"),'t');
assert.equal(sql("select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j"),schedulesBefore,
  'native grants and service migration dry-run/apply preserve the full inherited cron catalog');
assert.equal(sql("select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid='cron.job'::regclass"),policiesBefore,
  'installation never adds, removes or broadens cron policies');
console.log('bucket3-local: owner-only RLS; denied CREATE POLICY; native privilege/login failures; service migration dry-run/apply passed');
NODE
  fi
  if [[ "$name" > "20260829093922_booking_google_convergence_closure.sql" && -n "${BOOKING_TEST_SAFEUPDATE_LIBRARY:-}" ]]; then
    library=$BOOKING_TEST_SAFEUPDATE_LIBRARY
    [[ "$library" =~ ^[A-Za-z0-9_./-]+$ ]] || { echo "invalid safeupdate library path" >&2; exit 1; }
    if [[ "$name" == "20260829093924_admin_auth_authority_closure.sql" ]]; then
      probe_sql="update public.admin_principals set auth_epoch=auth_epoch;"
    else
      probe_sql="update public.booking_notifications set source_event_key=source_event_key;"
    fi
    REPLAY_SAFEUPDATE=$library
    psql -X -v ON_ERROR_STOP=1 -c "do \$\$begin
      if current_setting('safeupdate.enabled')<>'on' then raise exception 'safeupdate is disabled';end if;
      begin $probe_sql raise exception 'safeupdate accepted an unqualified UPDATE';
        exception when cardinality_violation then null;end;
    end\$\$;" >/dev/null
    if [[ "$name" != "20260910140000_calendar_worker_schedules.sql" ]]; then
      psql -X -v ON_ERROR_STOP=1 -f "$migration" >/dev/null || {
        echo "Failed migration with safeupdate: $name" >&2
        tail -n 100 "$LOG" >&2 || true
        exit 1
      }
    fi
  elif [[ "$name" != "20260910140000_calendar_worker_schedules.sql" ]]; then
    psql -v ON_ERROR_STOP=1 -f "$migration" >/dev/null || {
      echo "Failed migration: $name" >&2
      tail -n 100 "$LOG" >&2 || true
      exit 1
    }
  fi
  case "$name" in
    20260910120000_*|20260910130000_*|20260910133000_*|20260910140000_*|20260910150000_*|"$AGENT_TURN_MIGRATION")
      if [[ "$(psql -Atq -c "$AGENT_TURN_STATE_SQL")" != "$agent_turn_before" ]]; then
        echo "claim_agent_turn definition, owner or grants changed after $name" >&2
        exit 1
      fi
      echo "bucket3-local: applied local schema $name; claim_agent_turn definition/owner/ACL/effective grants unchanged" ;;
  esac
  if [[ "$name" == "20260829093923_booking_customer_lifecycle_closure.sql" ]]; then
    psql -At -v ON_ERROR_STOP=1 -c "select source_event_key from public.booking_notifications where id='71000000-0000-0000-0000-000000000008'" | grep -qx 'legacy-invalid-recipient'
    psql -At -v ON_ERROR_STOP=1 -c "select source_event_key from public.booking_notifications where id='71000000-0000-0000-0000-00000000000a'" | grep -qx 'already-frozen'
  fi
  if [[ "$name" == "20260829093924_admin_auth_authority_closure.sql" ]]; then
    psql -At -v ON_ERROR_STOP=1 -c "select auth_epoch from public.admin_principals where user_id='71100000-0000-0000-0000-000000000001'" | grep -qx 2
    psql -At -v ON_ERROR_STOP=1 -c "select revoked_at is not null from public.admin_sessions where token_hash=repeat('b',64)" | grep -qx t
  fi
  if [[ "$name" == "20260910140000_calendar_worker_schedules.sql" ]]; then
    node - <<'NODE'
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
function sql(input){
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const library=process.env.BOOKING_TEST_SAFEUPDATE_LIBRARY;
  const result=spawnSync('psql',['-X','-w','-v','ON_ERROR_STOP=1','-Atq'],{env:process.env,input:(library?`load '${library}';\n`:"")+input,encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr);
  return result.stdout.trim();
}
const foreignBefore=sql("select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j where username='calendar_prior_owner'");
const inheritedBefore=sql("select coalesce(jsonb_agg(to_jsonb(j) order by jobid),'[]') from cron.job j where username<>'calendar_prior_owner'");
sql(`begin;set local role service_role;
  select count(*) from public.register_calendar_worker_schedules('test');
  select count(*) from public.register_calendar_worker_schedules('live');
  reset role;set local role calendar_extension_owner;
  insert into vault.decrypted_secrets(name,decrypted_secret) values
    ('CALENDAR_WORKER_CRON_ENVIRONMENT','test'),('CALENDAR_WORKER_CRON_ORIGIN','https://obratech.co'),
    ('PIPEDREAM_INBOX_CRON_SECRET','fixture-only-google'),('STRIPE_INBOX_CRON_SECRET','fixture-only-stripe'),
    ('BOOKING_CRON_SECRET','fixture-only-booking');
  reset role;set local role service_role;
  do $$begin
    if public.set_calendar_worker_schedules_active('test',true)<>4 then
      raise exception 'hidden foreign same/opposite-environment jobs blocked owner activation';end if;
    if public.get_calendar_worker_health('test')->'scheduler_scope'<>
      '{"owner":"booking_test_owner","visibility":"owner_only"}'::jsonb
      or public.get_calendar_worker_health('test')->'response_recorder'<>
      '{"registered":null,"active":null,"last_recorded_response_at":null}'::jsonb then
      raise exception 'health claimed global recorder visibility';end if;
  end$$;
  reset role;
  do $$begin
    if (select count(*) from cron.job where username='booking_test_owner' and jobname like 'obra-calendar-%')<>8
      or (select count(*) from cron.job where username='booking_test_owner' and active and jobname like 'obra-calendar-test-%')<>4
      or exists(select 1 from cron.job where username='booking_test_owner' and active and jobname like 'obra-calendar-live-%') then
      raise exception 'owner registration/activation did not retain fixed eight identities';end if;
  end$$;rollback;`);
assert.equal(sql("select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j where username='calendar_prior_owner'"),foreignBefore,
  'owner-only registration, activation and health preserve foreign jobs');
sql(`set role calendar_prior_owner;select cron.unschedule(jobid) from cron.job
  where jobname in('obra-calendar-test-google','obra-calendar-live-google','obra-record-background-job-responses','foreign-unrelated-calendar-fixture');`);
assert.equal(sql("select count(*) from cron.job where username='calendar_prior_owner'"),'0','only fixture owner disposes of its seeded jobs');
assert.equal(sql("select coalesce(jsonb_agg(to_jsonb(j) order by jobid),'[]') from cron.job j"),inheritedBefore,
  'fixture disposal preserves every inherited schedule');
// The shared rollback-only scheduler suite below covers restrictive owned-row
// visibility, revoked schedule/alter EXECUTE, cross-role calls and same-owner switching.
console.log('bucket3-local: owner-only registration/activation with hidden foreign same/opposite-environment jobs passed');
NODE
  fi
  if [[ "$name" == "20260905181159_activate_sandbox_saas_offers.sql" ]]; then
    psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.saas_offer_contracts where environment='test' and active_for_new_sales and ((plan='starter' and price_id='price_1U90KGEjgAPzsVsTmS6lgHnQ' and product_id='prod_V9Iw1h1tesmf0h' and unit_amount_minor=7900) or (plan='pro' and price_id='price_1U90KYEjgAPzsVsTLzMO54Sd' and product_id='prod_V9IwztC1fi8sqi' and unit_amount_minor=12900))" | grep -qx 2
    psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.saas_offer_contract_installations i join public.saas_offer_contracts c on c.contract_id=i.contract_id and c.contract_digest=i.observed_digest where c.environment='test' and c.active_for_new_sales" | grep -qx 2
    psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.saas_offer_contracts where environment='test' and active_for_new_sales and verified_at='2026-09-05T18:11:59Z'::timestamptz" | grep -qx 2
    [[ "$(psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.checkout_sessions")" = "$sandbox_checkout_count" ]]
    [[ "$(psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.subscriptions")" = "$sandbox_subscription_count" ]]
    [[ "$(psql -Atq -v ON_ERROR_STOP=1 -c "select coalesce(string_agg(plan||':'||price_id||':'||product_id,'|' order by plan),'') from public.saas_offer_contracts where environment='live' and active_for_new_sales")" = "$live_offer_routes_before" ]]
    psql -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
    if {
      printf '%s\n' "begin;"
      printf '%s\n' "select public.rotate_saas_offer_contract('test','starter',public.install_saas_offer_contract('test','starter','price_sandbox_conflict','prod_sandbox_conflict',7900,'2026-09-05T18:12:00Z'::timestamptz),'price_1U90KGEjgAPzsVsTmS6lgHnQ');"
      cat "$migration"
      printf '%s\n' "rollback;"
    } | psql -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
      echo "sandbox activation unexpectedly replaced a conflicting active route" >&2
      exit 1
    fi
    psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.saas_offer_contracts where environment='test' and active_for_new_sales and price_id in ('price_1U90KGEjgAPzsVsTmS6lgHnQ','price_1U90KYEjgAPzsVsTLzMO54Sd')" | grep -qx 2
  fi
done

# Exercise actual RPC execution under the same managed safe-update setting, not
# only function creation. Earlier historical migrations retain their old policy.
REPLAY_SAFEUPDATE=${BOOKING_TEST_SAFEUPDATE_LIBRARY:-}
if [[ -n "$REPLAY_SAFEUPDATE" ]]; then echo "bucket3-local: managed safeupdate loaded $REPLAY_SAFEUPDATE; exact unqualified UPDATE rejection verified"; fi

psql -Atq -c "select current_user='booking_test_owner'
  and not (rolsuper or rolbypassrls or rolcreatedb or rolreplication or rolinherit)
  and not pg_has_role(current_user,'calendar_extension_owner','MEMBER')
  from pg_roles where rolname=current_user" | grep -qx t
echo "bucket3-local: constrained migration/RPC owner booking_test_owner: NOSUPERUSER NOBYPASSRLS NOCREATEDB NOREPLICATION NOINHERIT; no extension-owner membership"

psql -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/booking-availability-save.sql"

# The forward-only runner lock makes a competing apply wait, then observe the durable ledger
# instead of executing the same SQL twice. The offer registry lock similarly serializes exact
# installations across both historical unique constraints.
RUNNER_DRY_RUN="select public.apply_repo_migration('saas-runner-concurrency-probe.sql','c0ffee','select pg_sleep(0.05)','dry_run','concurrency-test')"
psql -Atq -v ON_ERROR_STOP=1 -c "$RUNNER_DRY_RUN" | grep -Fqx '{"status": "dry_run_ok"}'
RUNNER_APPLY="select public.apply_repo_migration('saas-runner-concurrency-probe.sql','c0ffee','select pg_sleep(0.25)','apply','concurrency-test')"
RUNNER_ONE=$(mktemp)
RUNNER_TWO=$(mktemp)
psql -Atq -v ON_ERROR_STOP=1 -c "$RUNNER_APPLY" >"$RUNNER_ONE" & runner_one_pid=$!
psql -Atq -v ON_ERROR_STOP=1 -c "$RUNNER_APPLY" >"$RUNNER_TWO" & runner_two_pid=$!
wait "$runner_one_pid"
wait "$runner_two_pid"
{ cat "$RUNNER_ONE"; cat "$RUNNER_TWO"; } | grep -Fhc '"status": "applied"' | grep -qx 1
{ cat "$RUNNER_ONE"; cat "$RUNNER_TWO"; } | grep -Fhc '"status": "already_applied"' | grep -qx 1
rm -f "$RUNNER_ONE" "$RUNNER_TWO"
psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.applied_repo_migrations where name='saas-runner-concurrency-probe.sql'" | grep -qx 1

OFFER_INSTALL="select public.install_saas_offer_contract('test','starter','price_concurrent_install','prod_concurrent_install',7900,'2026-09-04T12:00:00Z'::timestamptz)"
OFFER_ONE=$(mktemp)
OFFER_TWO=$(mktemp)
psql -Atq -v ON_ERROR_STOP=1 -c "$OFFER_INSTALL" >"$OFFER_ONE" & offer_one_pid=$!
psql -Atq -v ON_ERROR_STOP=1 -c "$OFFER_INSTALL" >"$OFFER_TWO" & offer_two_pid=$!
wait "$offer_one_pid"
wait "$offer_two_pid"
sort -u "$OFFER_ONE" "$OFFER_TWO" | wc -l | tr -d ' ' | grep -qx 1
rm -f "$OFFER_ONE" "$OFFER_TWO"
psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.saas_offer_contracts where environment='test' and price_id='price_concurrent_install'" | grep -qx 1
psql -Atq -v ON_ERROR_STOP=1 -c "select count(*) from public.saas_offer_contract_installations i join public.saas_offer_contracts c on c.contract_id=i.contract_id where c.environment='test' and c.price_id='price_concurrent_install'" | grep -qx 1

echo "bucket3-booking: concurrent runner and offer-install fences"

# The late Lovable mirror of persist-without-Chrome sorts after gacha admission and rewrites this
# RPC. Prove the combined final schema still retains contract-3 and same-stage planning yields.
psql -At -v ON_ERROR_STOP=1 -c "select position('generationContractVersion'',current_job.generation_contract_version' in pg_get_functiondef('public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)'::regprocedure))>0 and position('generation_stage=''planning'' and p_stage in (''planning'',''media'')' in pg_get_functiondef('public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)'::regprocedure))>0" | grep -qx t

psql -At -v ON_ERROR_STOP=1 -c "select count(*) from public.booking_cutover_quarantine where entity_id='71000000-0000-0000-0000-000000000003'::text and reason_code='provider_object_without_connected_account' and resolved_at is null" | grep -qx 1
psql -At -v ON_ERROR_STOP=1 -c "select booking_contract_version||':'||coalesce(stripe_account_id,'null')||':'||amount_refunded_minor||':'||refund_state||':'||dispute_state||':'||coalesce(dispute_id,'null') from public.booking_payments where id='71000000-0000-0000-0000-000000000003'" | grep -qx '1:null:500:succeeded:open:null'
psql -At -v ON_ERROR_STOP=1 -c "select consented_at is null and consent_document_id is null and consent_version is null and consent_digest is null from public.booking_customers where id='71000000-0000-0000-0000-000000000007'" | grep -qx t
psql -At -v ON_ERROR_STOP=1 -c "select coalesce(recipient_email,'null')||':'||state||':'||suppression_reason from public.booking_notifications where id='71000000-0000-0000-0000-000000000008'" | grep -qx 'null:suppressed:legacy_recipient_missing_or_invalid'
psql -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_constraint where conrelid='public.booking_payments'::regclass and conname in('booking_payments_connected_provider_identity_ck','booking_payments_provider_objects_require_account_ck','booking_payments_refund_generation_nonnegative_ck','booking_payments_refund_succeeded_full_ck','booking_payments_dispute_identity_ck')and convalidated" | grep -qx 5
psql -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_constraint where conrelid='public.booking_payments'::regclass and conname in('booking_payments_connected_provider_identity_ck','booking_payments_provider_objects_require_account_ck','booking_payments_refund_generation_nonnegative_ck','booking_payments_refund_succeeded_full_ck','booking_payments_dispute_identity_ck')and pg_get_constraintdef(oid)like'%booking_contract_version <> 2%'" | grep -qx 5

echo "bucket3-booking: committed cutover chain"
TENANT=$(psql -Atq -v ON_ERROR_STOP=1 -c "insert into public.profiles(id,license_number,email,environment)values(gen_random_uuid(),'VET-CUTOVER','cutover@example.com','test')returning id")
PREFLIGHT=$(psql -At -v ON_ERROR_STOP=1 -c "select public.capture_booking_cutover_preflight_v3('$TENANT','test')")
psql -At -v ON_ERROR_STOP=1 -c "select (public.prepare_booking_convergence_cutover('$TENANT','test')).id" >/dev/null
psql -At -v ON_ERROR_STOP=1 -c "select public.activate_booking_cutover_v3('$PREFLIGHT')" | grep -qx t
psql -At -v ON_ERROR_STOP=1 -c "select public.booking_cutover_enabled('$TENANT','test')" | grep -qx t

# The scheduler suite changes platform fixture definitions transactionally. It
# and dblink's passwordless loopback test require the isolated bootstrap user;
# application SECURITY DEFINER functions still execute as booking_test_owner.
platform_options=(-c "set client_min_messages=warning;")
if [[ -n "$REPLAY_SAFEUPDATE" ]]; then platform_options+=(-c "load '$REPLAY_SAFEUPDATE';"); fi
# Each suite is rollback-only in its own connection. Report every failure without
# hiding later regressions, but never turn a partial replay into a passing run.
failed_suites=()
for suite in admin-auth-authority-closure.sql bucket3-booking.sql saas-checkout-fulfillment-recovery.sql \
  google-calendar-lifetime.sql booking-calendar-lifetime.sql calendar-worker-schedules.sql \
  booking-notification-lifetime.sql calendar-action-notifications.sql; do
  suite_status=0
  case "$suite" in
    booking-calendar-lifetime.sql|calendar-worker-schedules.sql)
      command psql -X -w -q -v ON_ERROR_STOP=1 "${platform_options[@]}" -v cutover_tenant="$TENANT" \
        -f "$ROOT/supabase/tests/$suite" || suite_status=$? ;;
    *)
      psql -v ON_ERROR_STOP=1 -v cutover_tenant="$TENANT" -f "$ROOT/supabase/tests/$suite" || suite_status=$? ;;
  esac
  if [[ "$suite_status" = 0 ]]; then
    echo "bucket3-local: suite passed $suite"
  else
    failed_suites+=("$suite")
    echo "bucket3-local: suite failed $suite (exit $suite_status)" >&2
  fi
done
if [[ ${#failed_suites[@]} -ne 0 ]]; then
  echo "bucket3-local: incomplete replay; failed suites: ${failed_suites[*]}" >&2
  exit 1
fi
echo "bucket3-local: full migration chain and all SQL suites passed"
