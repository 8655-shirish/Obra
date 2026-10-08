#!/usr/bin/env bash
set -euo pipefail

for command in initdb pg_ctl psql; do
  command -v "$command" >/dev/null || { echo "$command is required" >&2; exit 1; }
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DATA=$(mktemp -d "${TMPDIR:-/tmp}/obra-legacy-checkout-pg.XXXXXX")
PORT=${LEGACY_CHECKOUT_TEST_PG_PORT:-55441}
SOCKET_DIR=${TMPDIR:-/tmp}
LOG="$DATA/postgres.log"
cleanup() {
  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT INT TERM

initdb -D "$DATA" -A trust --no-locale >/dev/null
pg_ctl -D "$DATA" -o "-k $SOCKET_DIR -p $PORT" -l "$LOG" start >/dev/null
export PGHOST="$SOCKET_DIR" PGPORT="$PORT" PGDATABASE=postgres
export PGUSER=$(id -un)

psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create role anon;
create role authenticated;
create role service_role;
create role authenticator;
create schema auth;
create schema storage;
create schema extensions;
create schema vault;
create schema cron;
create extension if not exists pgcrypto with schema extensions;
create publication supabase_realtime;
create table auth.users(id uuid primary key,email text,encrypted_password text,confirmed_at timestamptz,updated_at timestamptz default now(),raw_app_meta_data jsonb default '{}'::jsonb,banned_until timestamptz,deleted_at timestamptz);
create table auth.sessions(id uuid primary key default extensions.gen_random_uuid(),user_id uuid not null references auth.users(id),created_at timestamptz default now(),updated_at timestamptz default now());
create table auth.refresh_tokens(id bigint generated always as identity primary key,session_id uuid references auth.sessions(id));
create table auth.mfa_factors(id uuid primary key default extensions.gen_random_uuid(),user_id uuid not null references auth.users(id),factor_type text default 'totp',status text,updated_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default extensions.gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(trim(both '/' from name),'/')$$;
create table vault.decrypted_secrets(id uuid primary key default extensions.gen_random_uuid(),name text unique,decrypted_secret text);
create or replace function vault.create_secret(text,text,text) returns uuid language sql as $$select extensions.gen_random_uuid()$$;
create or replace function vault.update_secret(uuid,text,text,text) returns void language sql as $$select$$;
create table cron.job(jobid bigint generated always as identity,jobname text,command text);
create or replace function cron.unschedule(p_jobid bigint) returns boolean language plpgsql as $$begin delete from cron.job where jobid=p_jobid;return found;end$$;
create or replace function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language plpgsql as $$declare next_id bigint;begin insert into cron.job(jobname,command)values(p_name,p_command)returning jobid into next_id;return next_id;end$$;
SQL

for migration in "$ROOT"/supabase/migrations/*.sql; do
  name=$(basename "$migration")
  case "$name" in
    20260809210000_otp_rate_limit.sql|20260811000000_agent_traces.sql) continue ;;
    20260824155312_*|20260824164215_*|20260824240000_canonical_lovable_job_cron.sql) continue ;;
    20260828170000_*|20260828171000_*|20260828172000_*|20260828173000_*) continue ;;
    20260829080453_*|20260829081231_*|20260829092517_*|20260829092631_*|20260829092714_*|20260829093132_*|20260829093345_*|20260829093506_*|20260829093820_*) continue ;;
  esac
  if [[ "$name" == "20260829093903_verified_website_entitlements.sql" ]]; then
    psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
insert into public.profiles(id,license_number,email,full_name,business_name,city,environment)values
('91000000-0000-0000-0000-000000000012','LEGACY-UPGRADE','legacy-upgrade@example.com','Legacy Upgrade','Legacy Upgrade LLC','Denver','test'),
('91000000-0000-0000-0000-000000000022','LEGACY-UNRESOLVED','legacy-unresolved@example.com','Legacy Unresolved','Legacy Unresolved LLC','Denver','test');
insert into public.websites(id,user_id,status,onboarding_state,environment)values
('91000000-0000-0000-0000-000000000013','91000000-0000-0000-0000-000000000012','draft','{}','test'),
('91000000-0000-0000-0000-000000000023','91000000-0000-0000-0000-000000000022','draft','{}','test');
insert into public.subscriptions(id,user_id,plan,status,stripe_customer_id,stripe_subscription_id,stripe_price_id,environment)values
('91000000-0000-0000-0000-000000000014','91000000-0000-0000-0000-000000000012','pro','pending_activation','cus_legacy_upgrade','sub_legacy_upgrade','price_legacy_upgrade','test'),
('91000000-0000-0000-0000-000000000024','91000000-0000-0000-0000-000000000022','pro','pending_activation',null,null,null,'test');
insert into public.checkout_sessions(id,license_number,email,full_name,business_name,city,context_json,status,subscription_id,plan,stripe_checkout_session_id)values
('91000000-0000-0000-0000-000000000015','LEGACY-UPGRADE','legacy-upgrade@example.com','Legacy Upgrade','Legacy Upgrade LLC','Denver','{"websiteId":"91000000-0000-0000-0000-000000000013"}','pending_otp','91000000-0000-0000-0000-000000000014','pro','cs_legacy_upgrade'),
('91000000-0000-0000-0000-000000000025','LEGACY-UNRESOLVED','legacy-unresolved@example.com','Legacy Unresolved','Legacy Unresolved LLC','Denver','{}','pending_otp','91000000-0000-0000-0000-000000000024','pro',null);
SQL
    if psql -v ON_ERROR_STOP=1 -f "$migration" >"$DATA/unresolved.out" 2>&1; then
      echo "expected unresolved legacy pending OTP migration failure" >&2
      exit 1
    fi
    grep -q "legacy pending OTP checkout requires exact non-destructive reconciliation" "$DATA/unresolved.out"
    psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
delete from public.checkout_sessions where id='91000000-0000-0000-0000-000000000025';
delete from public.subscriptions where id='91000000-0000-0000-0000-000000000024';
delete from public.websites where id='91000000-0000-0000-0000-000000000023';
delete from public.profiles where id='91000000-0000-0000-0000-000000000022';
insert into public.profiles(id,license_number,email,full_name,business_name,city,environment) values('91000000-0000-0000-0000-000000000032','LEGACY-AMBIGUOUS','legacy-ambiguous@example.com','Legacy Ambiguous','Legacy Ambiguous LLC','Denver','test');
insert into public.websites(id,user_id,status,onboarding_state,environment) values('91000000-0000-0000-0000-000000000033','91000000-0000-0000-0000-000000000032','draft','{}','test');
insert into public.subscriptions(id,user_id,plan,status,environment) values
('91000000-0000-0000-0000-000000000034','91000000-0000-0000-0000-000000000032','pro','pending_activation','test'),
('91000000-0000-0000-0000-000000000035','91000000-0000-0000-0000-000000000032','pro','pending_activation','test');
insert into public.checkout_sessions(id,license_number,email,full_name,business_name,city,context_json,status,subscription_id,plan,stripe_checkout_session_id) values
('91000000-0000-0000-0000-000000000036','LEGACY-AMBIGUOUS','legacy-ambiguous@example.com','Legacy Ambiguous','Legacy Ambiguous LLC','Denver','{"websiteId":"91000000-0000-0000-0000-000000000033"}','pending_otp','91000000-0000-0000-0000-000000000034','pro',null),
('91000000-0000-0000-0000-000000000037','LEGACY-AMBIGUOUS','legacy-ambiguous@example.com','Legacy Ambiguous','Legacy Ambiguous LLC','Denver','{"websiteId":"91000000-0000-0000-0000-000000000033"}','pending_otp','91000000-0000-0000-0000-000000000035','pro',null);
SQL
    if psql -v ON_ERROR_STOP=1 -f "$migration" >"$DATA/ambiguous.out" 2>&1; then
      echo "expected ambiguous legacy pending OTP migration failure" >&2
      exit 1
    fi
    grep -q "duplicate paid checkout intents require reconciliation before migration" "$DATA/ambiguous.out"
    psql -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
delete from public.checkout_sessions where id in('91000000-0000-0000-0000-000000000036','91000000-0000-0000-0000-000000000037');
delete from public.subscriptions where id in('91000000-0000-0000-0000-000000000034','91000000-0000-0000-0000-000000000035');
delete from public.websites where id='91000000-0000-0000-0000-000000000033';
delete from public.profiles where id='91000000-0000-0000-0000-000000000032';
SQL
  fi
  psql -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
  [[ "$name" == "20260829093903_verified_website_entitlements.sql" ]] && break
done

psql -At -v ON_ERROR_STOP=1 -c "select status||':'||payment_evidence_kind||':'||(payment_verified_at is null)::text||':'||(payment_provider_session_id is null)::text||':'||(payment_price_id is null)::text from public.checkout_sessions where id='91000000-0000-0000-0000-000000000015'" | grep -qx 'pending_otp:legacy_post_payment:true:true:true'
psql -At -v ON_ERROR_STOP=1 -c "select (checkout_claimable_at is not null)::text||':'||checkout_claim_email from public.profiles where id='91000000-0000-0000-0000-000000000012'" | grep -qx 'true:legacy-upgrade@example.com'
psql -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/legacy-checkout-entitlement.sql" >/dev/null
echo "legacy checkout migration and grant regression passed"
