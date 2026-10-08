-- Bucket 3 live booking: authoritative admission, provider identities, durable checkout, confirmation, and effect workers.

alter table public.provider_event_inbox drop constraint if exists provider_event_inbox_event_family_check;
alter table public.provider_event_inbox add constraint provider_event_inbox_event_family_check
  check (event_family in ('saas','connect','calendar','booking'));

-- Bucket 3 workers use narrower event/effect-specific transitions; revoke legacy generic mutation entry points.
-- Legacy v1 worker RPCs remain available only for draining already-created obligations.
-- The cutover cleanup wave revokes them after every v1 effect is terminal.

alter table public.booking_customers add column if not exists identity_fingerprint text;
create index if not exists booking_customers_rate_window_idx on public.booking_customers(source_website_id,identity_fingerprint,created_at desc) where identity_fingerprint is not null;

alter table public.appointments
  add column if not exists schedule_revision bigint,
  add column if not exists checkout_generation bigint not null default 0,
  add column if not exists refund_generation bigint not null default 0,
  add column if not exists calendar_generation bigint not null default 0,
  add column if not exists booking_contract_version smallint;
update public.appointments set booking_contract_version=1 where booking_contract_version is null;
alter table public.appointments alter column booking_contract_version set default 2;

alter table public.appointments drop constraint if exists appointments_bucket3_generations_nonnegative_ck;
alter table public.appointments add constraint appointments_bucket3_generations_nonnegative_ck check(checkout_generation>=0 and refund_generation>=0 and calendar_generation>=0) not valid;
alter table public.appointments validate constraint appointments_bucket3_generations_nonnegative_ck;

alter table public.calendar_connections add column if not exists availability_generation bigint not null default 0;
alter table public.calendar_connections drop constraint if exists calendar_connections_availability_generation_nonnegative_ck;
alter table public.calendar_connections add constraint calendar_connections_availability_generation_nonnegative_ck check(availability_generation>=0) not valid;
alter table public.calendar_connections validate constraint calendar_connections_availability_generation_nonnegative_ck;

alter table public.booking_payments
  add column if not exists stripe_account_id text,
  add column if not exists checkout_idempotency_key text,
  add column if not exists checkout_operation_id uuid,
  add column if not exists checkout_lease_token uuid,
  add column if not exists checkout_lease_expires_at timestamptz,
  add column if not exists checkout_fencing_token bigint not null default 0,
  add column if not exists checkout_last_error text,
  add column if not exists checkout_expires_at timestamptz,
  add column if not exists refund_idempotency_key text,
  add column if not exists refund_generation bigint not null default 0,
  add column if not exists dispute_id text,
  add column if not exists confirmation_nonce_hash text,
  add column if not exists checkout_provider_expires_at timestamptz,
  add column if not exists dispute_provider_created bigint not null default 0,
  add column if not exists dispute_status_rank integer not null default 0,
  add column if not exists booking_contract_version smallint;
update public.booking_payments set booking_contract_version=1 where booking_contract_version is null;
alter table public.booking_payments alter column booking_contract_version set default 2;

create unique index if not exists booking_payments_checkout_identity_uq
 on public.booking_payments(environment,stripe_account_id,checkout_session_id)
 where checkout_session_id is not null and booking_contract_version=2;
create unique index if not exists booking_payments_intent_identity_uq
 on public.booking_payments(environment,stripe_account_id,payment_intent_id)
 where payment_intent_id is not null and booking_contract_version=2;
create unique index if not exists booking_payments_charge_identity_uq
 on public.booking_payments(environment,stripe_account_id,charge_id)
 where charge_id is not null and booking_contract_version=2;
update public.booking_payments p set stripe_account_id=a.stripe_account_id
from public.stripe_connected_accounts a
where p.connected_account_id=a.id and p.profile_id=a.profile_id and p.environment=a.environment and p.stripe_account_id is null;
alter table public.booking_payments drop constraint if exists booking_payments_connected_provider_identity_ck;
alter table public.booking_payments add constraint booking_payments_connected_provider_identity_ck
 check(connected_account_id is null or stripe_account_id is not null) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_provider_objects_require_account_ck;
alter table public.booking_payments add constraint booking_payments_provider_objects_require_account_ck check((checkout_session_id is null and payment_intent_id is null and charge_id is null and refund_id is null)or stripe_account_id is not null) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_refund_generation_nonnegative_ck;
alter table public.booking_payments add constraint booking_payments_refund_generation_nonnegative_ck check(refund_generation>=0) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_refund_succeeded_full_ck;
alter table public.booking_payments add constraint booking_payments_refund_succeeded_full_ck check(refund_state<>'succeeded' or amount_refunded_minor=amount_paid_minor) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_dispute_identity_ck;
alter table public.booking_payments add constraint booking_payments_dispute_identity_ck check(dispute_state='none' or dispute_id is not null) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_checkout_operation_fk;
alter table public.booking_payments add constraint booking_payments_checkout_operation_fk
 foreign key(checkout_operation_id,profile_id,environment) references public.appointment_operations(id,profile_id,environment) not valid;

create unique index if not exists booking_payments_refund_identity_uq
 on public.booking_payments(environment,stripe_account_id,refund_id)
 where refund_id is not null and booking_contract_version=2;
create unique index if not exists booking_payments_checkout_operation_uq
 on public.booking_payments(checkout_operation_id) where checkout_operation_id is not null and booking_contract_version=2;

alter table public.integration_outbox
  add column if not exists effect_generation bigint not null default 1,
  add column if not exists terminal_at timestamptz,
  add column if not exists effect_contract_version smallint;
update public.integration_outbox set effect_contract_version=1 where effect_contract_version is null;
alter table public.integration_outbox alter column effect_contract_version set default 2;
alter table public.integration_outbox drop constraint if exists integration_outbox_command_type_check;
alter table public.integration_outbox add constraint integration_outbox_command_type_check
  check (command_type in ('calendar_create','calendar_cancel','refund_full','refund','notify'));
-- Existing v1 provider effects remain byte-for-byte intact. Inventory/quarantine records them before provider retrieval; expansion never guesses or resets an external outcome.

create table if not exists public.public_booking_rate_limits (
 scope_key text not null check(length(scope_key) between 1 and 128),
 action text not null check(action in('slots','confirmation')),
 client_bucket text not null check(client_bucket ~ '^[a-f0-9]{64}$'),
 window_started_at timestamptz not null,
 attempt_count integer not null check(attempt_count>0),
 primary key(scope_key,action,client_bucket,window_started_at)
);
alter table public.public_booking_rate_limits enable row level security;
revoke all on public.public_booking_rate_limits from anon,authenticated;

create or replace function public.check_public_booking_rate_limit(p_scope_key text,p_action text,p_client_bucket text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare bucket_start timestamptz;current_count integer;
begin
 if p_action not in('slots','confirmation') or p_client_bucket !~ '^[a-f0-9]{64}$' or p_limit<1 or p_limit>1000 or p_window_seconds<10 or p_window_seconds>86400 then raise exception 'invalid booking rate limit request' using errcode='22023';end if;
 bucket_start:=pg_catalog.to_timestamp(pg_catalog.floor(pg_catalog.date_part('epoch',pg_catalog.clock_timestamp())/p_window_seconds)*p_window_seconds);
 insert into public.public_booking_rate_limits(scope_key,action,client_bucket,window_started_at,attempt_count)
 values(p_scope_key,p_action,p_client_bucket,bucket_start,1)
 on conflict(scope_key,action,client_bucket,window_started_at)do update set attempt_count=public.public_booking_rate_limits.attempt_count+1 returning attempt_count into current_count;
 if current_count>p_limit then raise exception 'booking rate limit exceeded' using errcode='P0001';end if;return true;
end $$;
revoke all on function public.check_public_booking_rate_limit(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.check_public_booking_rate_limit(text,text,text,integer,integer) to service_role;

create table if not exists public.booking_confirmation_capabilities (
 id uuid primary key default gen_random_uuid(),
 appointment_id uuid not null,
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 checkout_session_id text not null,
 token_hash text not null unique,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(appointment_id,profile_id,environment) references public.appointments(id,profile_id,environment) on delete cascade,
 unique(environment,checkout_session_id)
);
alter table public.booking_confirmation_capabilities enable row level security;
revoke all on public.booking_confirmation_capabilities from anon,authenticated;

create table if not exists public.calendar_destination_epochs(
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 connection_id uuid not null,
 calendar_selection_id uuid not null,
 connection_revision bigint not null,
 pipedream_account_id text not null,
 google_calendar_id text not null,
 created_at timestamptz not null default now(),
 retired_at timestamptz,
 unique(profile_id,environment,connection_revision),
 unique(id,profile_id,environment)
);
alter table public.calendar_destination_epochs enable row level security;
revoke all on public.calendar_destination_epochs from public,anon,authenticated;
insert into public.calendar_destination_epochs(profile_id,environment,connection_id,calendar_selection_id,connection_revision,pipedream_account_id,google_calendar_id,retired_at)
select c.profile_id,c.environment,c.id,s.id,c.connection_revision,c.pipedream_account_id,s.google_calendar_id,null
from public.calendar_connections c join public.calendar_selections s on s.connection_id=c.id and s.profile_id=c.profile_id and s.environment=c.environment and s.active and s.receives_bookings
where c.pipedream_account_id is not null
on conflict(profile_id,environment,connection_revision)do nothing;
alter table public.calendar_event_links add column if not exists destination_epoch_id uuid;
alter table public.integration_outbox add column if not exists destination_epoch_id uuid;
-- Historical links/effects without immutable provenance stay null and are quarantined by the cutover inventory; never infer their old destination from today's active configuration.
alter table public.calendar_event_links drop constraint if exists calendar_event_links_destination_epoch_fk;
alter table public.calendar_event_links add constraint calendar_event_links_destination_epoch_fk foreign key(destination_epoch_id) references public.calendar_destination_epochs(id) not valid;
alter table public.integration_outbox drop constraint if exists integration_outbox_destination_epoch_fk;
alter table public.integration_outbox add constraint integration_outbox_destination_epoch_fk foreign key(destination_epoch_id) references public.calendar_destination_epochs(id) not valid;

create or replace function public.reject_booking_provider_identity_rekey()returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='calendar_destination_epochs' and (old.profile_id,old.environment,old.connection_id,old.calendar_selection_id,old.connection_revision,old.pipedream_account_id,old.google_calendar_id) is distinct from (new.profile_id,new.environment,new.connection_id,new.calendar_selection_id,new.connection_revision,new.pipedream_account_id,new.google_calendar_id) then raise exception 'calendar destination epoch identity is immutable' using errcode='23514';end if;
 if tg_table_name='calendar_event_links' and (old.appointment_id,old.profile_id,old.environment,old.google_event_id,old.destination_epoch_id) is distinct from (new.appointment_id,new.profile_id,new.environment,new.google_event_id,new.destination_epoch_id) then raise exception 'calendar event identity is immutable' using errcode='23514';end if;return new;
end $$;
drop trigger if exists calendar_destination_epoch_identity_immutable on public.calendar_destination_epochs;
create trigger calendar_destination_epoch_identity_immutable before update on public.calendar_destination_epochs for each row execute function public.reject_booking_provider_identity_rekey();
drop trigger if exists calendar_event_link_identity_immutable on public.calendar_event_links;
create trigger calendar_event_link_identity_immutable before update on public.calendar_event_links for each row execute function public.reject_booking_provider_identity_rekey();
revoke all on function public.reject_booking_provider_identity_rekey() from public,anon,authenticated;

create or replace function public.ensure_calendar_destination_epoch(p_profile_id uuid,p_environment text,p_connection_id uuid,p_selection_id uuid)
returns public.calendar_destination_epochs language plpgsql security definer set search_path='' as $$
declare result public.calendar_destination_epochs%rowtype;c public.calendar_connections%rowtype;s public.calendar_selections%rowtype;
begin
 select * into strict c from public.calendar_connections where id=p_connection_id and profile_id=p_profile_id and environment=p_environment;
 select * into strict s from public.calendar_selections where id=p_selection_id and connection_id=c.id and profile_id=p_profile_id and environment=p_environment and active and receives_bookings;
 if c.pipedream_account_id is null then raise exception 'Google account identity missing' using errcode='P0001';end if;
 update public.calendar_destination_epochs set retired_at=coalesce(retired_at,pg_catalog.clock_timestamp()) where profile_id=p_profile_id and environment=p_environment and connection_revision<>c.connection_revision and retired_at is null;
 insert into public.calendar_destination_epochs(profile_id,environment,connection_id,calendar_selection_id,connection_revision,pipedream_account_id,google_calendar_id) values(p_profile_id,p_environment,c.id,s.id,c.connection_revision,c.pipedream_account_id,s.google_calendar_id) on conflict(profile_id,environment,connection_revision)do nothing returning * into result;
 if result.id is null then select * into strict result from public.calendar_destination_epochs where profile_id=p_profile_id and environment=p_environment and connection_revision=c.connection_revision;end if;
 return result;
end $$;
revoke all on function public.ensure_calendar_destination_epoch(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.ensure_calendar_destination_epoch(uuid,text,uuid,uuid) to service_role;

create table if not exists public.booking_availability_cache (
 cache_key text primary key,
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 connection_id uuid not null,
 availability_generation bigint not null check(availability_generation>=0),
 calendar_set_hash text not null check(calendar_set_hash ~ '^[a-f0-9]{64}$'),
 schedule_revision bigint not null,
 service_revision bigint not null,
 range_start timestamptz not null,
 range_end timestamptz not null,
 busy_ranges jsonb not null check(jsonb_typeof(busy_ranges)='array'),
 observed_at timestamptz not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 foreign key(connection_id,profile_id,environment) references public.calendar_connections(id,profile_id,environment) on delete cascade
);
create index if not exists booking_availability_cache_expiry_idx on public.booking_availability_cache(expires_at);
alter table public.booking_availability_cache enable row level security;
revoke all on public.booking_availability_cache from anon,authenticated;

create or replace function public.invalidate_booking_availability_cache() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.availability_generation:=old.availability_generation+1;
 delete from public.booking_availability_cache where connection_id=new.id;
 return new;
end $$;
drop trigger if exists calendar_connection_booking_cache_invalidation on public.calendar_connections;
create trigger calendar_connection_booking_cache_invalidation before update of last_synchronized_at on public.calendar_connections
for each row execute function public.invalidate_booking_availability_cache();
revoke all on function public.invalidate_booking_availability_cache() from public,anon,authenticated;

create or replace function public.invalidate_booking_availability_cache_selection() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_id uuid;
begin
 target_id:=case when tg_op='DELETE'then old.connection_id else new.connection_id end;
 update public.calendar_connections set last_synchronized_at=null where id=target_id;
 if tg_op='DELETE'then return old;else return new;end if;
end $$;
drop trigger if exists booking_cache_selection_invalidation on public.calendar_selections;
create trigger booking_cache_selection_invalidation after insert or update or delete on public.calendar_selections
for each row execute function public.invalidate_booking_availability_cache_selection();
revoke all on function public.invalidate_booking_availability_cache_selection() from public,anon,authenticated;


create or replace function public.store_booking_availability_cache(
 p_cache_key text,p_profile_id uuid,p_environment text,p_connection_id uuid,p_expected_generation bigint,p_calendar_set_hash text,p_schedule_revision bigint,p_service_revision bigint,p_range_start timestamptz,p_range_end timestamptz,p_busy_ranges jsonb,p_observed_at timestamptz,p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.calendar_connections c where c.id=p_connection_id and c.profile_id=p_profile_id and c.environment=p_environment and c.availability_generation=p_expected_generation for key share;
 if not found then return false;end if;
 insert into public.booking_availability_cache(cache_key,profile_id,environment,connection_id,availability_generation,calendar_set_hash,schedule_revision,service_revision,range_start,range_end,busy_ranges,observed_at,expires_at)
 values(p_cache_key,p_profile_id,p_environment,p_connection_id,p_expected_generation,p_calendar_set_hash,p_schedule_revision,p_service_revision,p_range_start,p_range_end,p_busy_ranges,p_observed_at,p_expires_at)
 on conflict(cache_key) do update set busy_ranges=excluded.busy_ranges,observed_at=excluded.observed_at,expires_at=excluded.expires_at
 where public.booking_availability_cache.availability_generation=excluded.availability_generation and public.booking_availability_cache.calendar_set_hash=excluded.calendar_set_hash and public.booking_availability_cache.schedule_revision=excluded.schedule_revision and public.booking_availability_cache.service_revision=excluded.service_revision;
 return found;
end $$;
revoke all on function public.store_booking_availability_cache(text,uuid,text,uuid,bigint,text,bigint,bigint,timestamptz,timestamptz,jsonb,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.store_booking_availability_cache(text,uuid,text,uuid,bigint,text,bigint,bigint,timestamptz,timestamptz,jsonb,timestamptz,timestamptz) to service_role;

create or replace function public.reserve_live_booking(
 p_website_id uuid,p_environment text,p_start_at timestamptz,p_local_date date,p_local_start time,p_time_zone text,
 p_client_request_id uuid,p_request_hash text,p_request_capability_hash text,
 p_consent_document_id text,p_consent_version text,p_consent_digest text,
 p_customer jsonb,p_freebusy_observed_at timestamptz,p_rate_limit_key text,p_availability_generation bigint,p_calendar_set_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.websites%rowtype;s public.booking_services%rowtype;sched public.availability_schedules%rowtype;
 c_id uuid;result jsonb;ready boolean;profile_lock bigint;existing_op public.appointment_operations%rowtype;attempt_count bigint;
begin
 if p_client_request_id is null or p_request_hash !~ '^[a-f0-9]{64}$' or p_request_capability_hash !~ '^[a-f0-9]{64}$' or p_rate_limit_key !~ '^[a-f0-9]{64}$' then raise exception 'invalid idempotency identity' using errcode='22023';end if;
 select * into strict w from public.websites where id=p_website_id and environment=p_environment and status='live' and active_version_id is not null for share;
 profile_lock:=pg_catalog.hashtextextended(w.user_id::text||':'||p_environment||':booking',0);
 perform pg_catalog.pg_advisory_xact_lock(profile_lock);
 select * into existing_op from public.appointment_operations where profile_id=w.user_id and environment=p_environment and operation_type='reserve' and client_request_id=p_client_request_id;
 if found then
  if existing_op.request_hash<>p_request_hash then raise exception 'idempotency key payload conflict' using errcode='23505';end if;
  if existing_op.request_capability_hash is distinct from p_request_capability_hash then raise exception 'booking request capability conflict' using errcode='42501';end if;
  return existing_op.result;
 end if;
 -- Existing idempotency identity is authoritative above: do not revalidate mutable
 -- request details before rejecting a conflicting browser capability. These checks admit only new work.
 if p_consent_document_id is distinct from 'obra-booking-data-and-payment-consent'
   or p_consent_version is distinct from '2026-08-29.1'
   or p_consent_digest is distinct from '899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f' then
  raise exception 'explicit booking consent is required' using errcode='22023';
 end if;
 if pg_catalog.jsonb_typeof(p_customer)<>'object' or nullif(pg_catalog.btrim(p_customer->>'fullName'),'') is null or nullif(pg_catalog.btrim(p_customer->>'email'),'') is null or nullif(pg_catalog.btrim(p_customer->>'phone'),'') is null or pg_catalog.jsonb_typeof(p_customer->'address')<>'object' then raise exception 'invalid booking customer' using errcode='22023';end if;
 if p_freebusy_observed_at is null or p_freebusy_observed_at<pg_catalog.clock_timestamp()-interval '2 minutes' or p_freebusy_observed_at>pg_catalog.clock_timestamp()+interval '1 minute' then raise exception 'availability evidence is stale' using errcode='P0001';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w.id::text||':booking-rate:'||p_rate_limit_key,0));
 select pg_catalog.count(*) into attempt_count from public.booking_customers where source_website_id=w.id and identity_fingerprint=p_rate_limit_key and created_at>=pg_catalog.clock_timestamp()-interval '10 minutes';
 if attempt_count>=5 then raise exception 'booking rate limit exceeded' using errcode='P0001';end if;
 select * into strict s from public.booking_services where profile_id=w.user_id and environment=p_environment and active=true for share;
 select * into strict sched from public.availability_schedules where profile_id=w.user_id and environment=p_environment and active=true for share;
 select exists(select 1 from public.website_entitlements e where e.website_id=w.id and e.profile_id=w.user_id and e.environment=p_environment and e.plan='pro' and e.booking_admission and e.state in('active','grace') and e.order_confirmed_at is not null and e.effective_at<=pg_catalog.clock_timestamp() and(e.ends_at is null or e.ends_at>pg_catalog.clock_timestamp()))
  and exists(select 1 from public.calendar_connections c join public.pipedream_bindings b on b.connection_id=c.id and b.profile_id=c.profile_id and b.environment=c.environment where c.profile_id=w.user_id and c.environment=p_environment and c.health_state='healthy' and c.last_verified_at>pg_catalog.clock_timestamp()-interval '15 minutes' and b.trigger_state='active' and b.last_health_at>pg_catalog.clock_timestamp()-interval '15 minutes')
  and exists(select 1 from public.stripe_connected_accounts a where a.profile_id=w.user_id and a.environment=p_environment and a.onboarding_state='ready' and a.charges_enabled and a.payouts_enabled and a.details_submitted and a.application_fee_bps=0 and a.charge_model='direct' and a.last_verified_at>pg_catalog.clock_timestamp()-interval '15 minutes') into ready;
 if not ready then raise exception 'booking is temporarily unavailable' using errcode='P0001';end if;
 if not public.booking_cutover_enabled(w.user_id,p_environment)then raise exception 'booking cutover is not enabled' using errcode='P0001';end if;
 if not exists(select 1 from public.booking_availability_cache ac where ac.profile_id=w.user_id and ac.environment=p_environment and ac.connection_id=(select id from public.calendar_connections where profile_id=w.user_id and environment=p_environment) and ac.observed_at=p_freebusy_observed_at and ac.availability_generation=p_availability_generation and ac.availability_generation=(select availability_generation from public.calendar_connections where id=ac.connection_id) and ac.calendar_set_hash=p_calendar_set_hash and ac.calendar_set_hash=pg_catalog.encode(extensions.digest(pg_catalog.convert_to((select pg_catalog.string_agg(cs.google_calendar_id,E'\n' order by cs.google_calendar_id)from public.calendar_selections cs where cs.connection_id=ac.connection_id and cs.active and cs.blocks_availability),'UTF8'),'sha256'),'hex') and ac.schedule_revision=sched.revision and ac.service_revision=s.revision and ac.expires_at>pg_catalog.clock_timestamp() and p_start_at-pg_catalog.make_interval(mins=>s.buffer_before_minutes)>=ac.range_start and p_start_at+pg_catalog.make_interval(mins=>s.duration_minutes+s.buffer_after_minutes)<=ac.range_end and not exists(select 1 from pg_catalog.jsonb_array_elements(ac.busy_ranges) br where tstzrange((br->>'start')::timestamptz,(br->>'end')::timestamptz,'[)') && tstzrange(p_start_at-pg_catalog.make_interval(mins=>s.buffer_before_minutes),p_start_at+pg_catalog.make_interval(mins=>s.duration_minutes+s.buffer_after_minutes),'[)'))) then raise exception 'availability evidence is not authoritative' using errcode='P0001';end if;
 insert into public.booking_customers(profile_id,environment,full_name,email_normalized,phone_normalized,address_snapshot,notes,source_website_id,identity_fingerprint,consented_at,consent_document_id,consent_version,consent_digest)
 values(w.user_id,p_environment,nullif(pg_catalog.btrim(p_customer->>'fullName'),''),pg_catalog.lower(pg_catalog.btrim(p_customer->>'email')),pg_catalog.btrim(p_customer->>'phone'),p_customer->'address',nullif(pg_catalog.btrim(p_customer->>'notes'),''),w.id,p_rate_limit_key,pg_catalog.clock_timestamp(),p_consent_document_id,p_consent_version,p_consent_digest) returning id into c_id;
 result:=public.reserve_booking_hold(w.user_id,w.id,s.id,c_id,p_environment,p_start_at,p_local_date,p_local_start,p_time_zone,p_client_request_id,p_request_hash);
 update public.appointment_operations set request_capability_hash=p_request_capability_hash
  where appointment_id=(result->>'appointmentId')::uuid and operation_type='reserve'
    and request_capability_hash is null;
 if not found then raise exception 'booking request capability was not bound' using errcode='40001';end if;
 update public.appointments set schedule_revision=sched.revision where id=(result->>'appointmentId')::uuid;
 update public.booking_payments set connected_account_id=(select id from public.stripe_connected_accounts where profile_id=w.user_id and environment=p_environment),
  stripe_account_id=(select stripe_account_id from public.stripe_connected_accounts where profile_id=w.user_id and environment=p_environment),
  checkout_idempotency_key='booking-checkout:'||(result->>'appointmentId'),checkout_operation_id=(select id from public.appointment_operations where appointment_id=(result->>'appointmentId')::uuid and operation_type='reserve'),updated_at=pg_catalog.clock_timestamp()
 where appointment_id=(result->>'appointmentId')::uuid;
 return result||pg_catalog.jsonb_build_object('scheduleRevision',sched.revision);

end $$;
revoke all on function public.reserve_live_booking(uuid,text,timestamptz,date,time,text,uuid,text,text,text,text,text,jsonb,timestamptz,text,bigint,text) from public,anon,authenticated;
grant execute on function public.reserve_live_booking(uuid,text,timestamptz,date,time,text,uuid,text,text,text,text,text,jsonb,timestamptz,text,bigint,text) to service_role;

create or replace function public.set_booking_checkout_provider_deadline(p_payment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_provider_expires_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare result timestamptz;
begin
 if p_provider_expires_at<pg_catalog.clock_timestamp()+interval '30 minutes 30 seconds' or p_provider_expires_at>pg_catalog.clock_timestamp()+interval '32 minutes' then raise exception 'invalid Stripe Checkout deadline' using errcode='22023';end if;
 update public.booking_payments set checkout_provider_expires_at=coalesce(checkout_provider_expires_at,p_provider_expires_at),updated_at=pg_catalog.clock_timestamp()
 where id=p_payment_id and checkout_lease_token=p_lease_token and checkout_fencing_token=p_fencing_token and checkout_lease_expires_at>pg_catalog.clock_timestamp() returning checkout_provider_expires_at into result;
 if result is null then raise exception 'stale Checkout deadline fence' using errcode='40001';end if;return result;
end $$;
revoke all on function public.set_booking_checkout_provider_deadline(uuid,uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.set_booking_checkout_provider_deadline(uuid,uuid,bigint,timestamptz) to service_role;

create or replace function public.bind_booking_confirmation_nonce(p_payment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_nonce_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_nonce_hash!~'^[a-f0-9]{64}$' then raise exception 'invalid confirmation nonce' using errcode='22023';end if;
 update public.booking_payments set confirmation_nonce_hash=coalesce(confirmation_nonce_hash,p_nonce_hash),updated_at=pg_catalog.clock_timestamp()
 where id=p_payment_id and checkout_lease_token=p_lease_token and checkout_fencing_token=p_fencing_token and checkout_lease_expires_at>pg_catalog.clock_timestamp() and(confirmation_nonce_hash is null or confirmation_nonce_hash=p_nonce_hash);
 if not found then raise exception 'stale confirmation nonce fence' using errcode='40001';end if;return true;
end $$;
revoke all on function public.bind_booking_confirmation_nonce(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bind_booking_confirmation_nonce(uuid,uuid,bigint,text) to service_role;

create or replace function public.record_created_booking_checkout(p_payment_id uuid,p_session_id text,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare appointment_identity uuid;
begin
 if p_session_id!~'^cs_' then raise exception 'invalid Checkout Session identity' using errcode='22023';end if;
 select appointment_id into strict appointment_identity from public.booking_payments where id=p_payment_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_identity::text||':booking-appointment',0));
 update public.booking_payments set checkout_session_id=coalesce(checkout_session_id,p_session_id),checkout_expires_at=coalesce(checkout_expires_at,p_expires_at),updated_at=pg_catalog.clock_timestamp()
 where id=p_payment_id and payment_state in('creating','pending') and(checkout_session_id is null or checkout_session_id=p_session_id);
 if not found then raise exception 'Checkout Session identity conflict' using errcode='23505';end if;return true;
end $$;
revoke all on function public.record_created_booking_checkout(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.record_created_booking_checkout(uuid,text,timestamptz) to service_role;

create or replace function public.claim_booking_checkout(p_appointment_id uuid,p_operation_id uuid,p_lease_token uuid)
returns public.booking_payments language plpgsql security definer set search_path='' as $$
declare result public.booking_payments%rowtype;
begin
 if p_lease_token is null then raise exception 'lease required' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_appointment_id::text||':booking-appointment',0));
 update public.appointments a set payment_state='creating',version=version+1,updated_at=pg_catalog.clock_timestamp()
 from public.booking_payments p where a.id=p_appointment_id and p.appointment_id=a.id and p.checkout_operation_id=p_operation_id and a.appointment_state='held' and((a.payment_state='not_started'and p.payment_state='not_started')or(a.payment_state='creating'and p.payment_state='creating'))and a.reservation_expires_at>pg_catalog.clock_timestamp() and(p.checkout_lease_expires_at is null or p.checkout_lease_expires_at<=pg_catalog.clock_timestamp());
 if not found then
  update public.appointments a set version=version where a.id=p_appointment_id and a.appointment_state='cancelled' and exists(select 1 from public.booking_payments p where p.appointment_id=a.id and p.checkout_operation_id=p_operation_id and p.payment_state='creating' and(p.checkout_lease_expires_at is null or p.checkout_lease_expires_at<=pg_catalog.clock_timestamp()));
 end if;
 if found then
  update public.booking_payments p set payment_state='creating',checkout_lease_token=p_lease_token,checkout_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',checkout_fencing_token=checkout_fencing_token+1,updated_at=pg_catalog.clock_timestamp()
  where p.appointment_id=p_appointment_id and p.checkout_operation_id=p_operation_id and p.payment_state in('not_started','creating')and(p.checkout_lease_expires_at is null or p.checkout_lease_expires_at<=pg_catalog.clock_timestamp())returning p.* into result;
 end if;
 if result.id is null then select p.* into result from public.booking_payments p join public.appointments a on a.id=p.appointment_id where p.appointment_id=p_appointment_id and p.checkout_operation_id=p_operation_id and p.checkout_session_id is not null and p.checkout_expires_at>pg_catalog.clock_timestamp() and p.payment_state='pending' and a.appointment_state='payment_pending';end if;
 if result.id is null then raise exception 'booking checkout unavailable' using errcode='P0001';end if;return result;
end $$;

create or replace function public.settle_booking_checkout(
 p_payment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_session_id text,p_expires_at timestamptz,p_succeeded boolean,p_ambiguous boolean,p_safe_error text
) returns public.booking_payments language plpgsql security definer set search_path='' as $$
declare result public.booking_payments%rowtype;changed integer;appointment_identity uuid;
begin
 select appointment_id into strict appointment_identity from public.booking_payments where id=p_payment_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_identity::text||':booking-appointment',0));
 select * into strict result from public.booking_payments where id=p_payment_id and checkout_lease_token=p_lease_token and checkout_fencing_token=p_fencing_token and checkout_lease_expires_at>pg_catalog.clock_timestamp() for update;
 if p_succeeded then
  if p_session_id!~'^cs_' then raise exception 'invalid Checkout Session identity' using errcode='22023';end if;
  update public.booking_payments set checkout_session_id=p_session_id,checkout_expires_at=p_expires_at,payment_state='pending',checkout_last_error=null,checkout_lease_token=null,checkout_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=result.id returning * into result;
  update public.appointments set appointment_state='payment_pending',payment_state='pending',version=version+1,updated_at=pg_catalog.clock_timestamp() where id=result.appointment_id and appointment_state='held' and payment_state='creating';
  get diagnostics changed=row_count;if changed<>1 then raise exception 'stale booking checkout appointment state' using errcode='40001';end if;
 elsif p_ambiguous then
  update public.booking_payments set payment_state='creating',checkout_last_error='Checkout creation outcome requires reconciliation',checkout_lease_token=null,checkout_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=result.id returning * into result;
  update public.appointments set payment_state='creating',version=version+1,updated_at=pg_catalog.clock_timestamp() where id=result.appointment_id and appointment_state='held' and payment_state='creating';
 else
  update public.booking_payments set payment_state='failed',checkout_last_error=p_safe_error,checkout_lease_token=null,checkout_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=result.id returning * into result;
  update public.appointments set appointment_state='cancelled',appointment_reason='checkout_creation_failed',payment_state='failed',cancelled_at=pg_catalog.clock_timestamp(),version=version+1,updated_at=pg_catalog.clock_timestamp() where id=result.appointment_id and appointment_state='held' and payment_state='creating';
 end if;return result;
end $$;
revoke all on function public.claim_booking_checkout(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.settle_booking_checkout(uuid,uuid,bigint,text,timestamptz,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_booking_checkout(uuid,uuid,uuid) to service_role;
grant execute on function public.settle_booking_checkout(uuid,uuid,bigint,text,timestamptz,boolean,boolean,text) to service_role;

create or replace function public.claim_due_booking_payment_events(p_environment text,p_lease_token uuid,p_limit integer default 25)
returns setof public.provider_event_inbox language plpgsql security definer set search_path='' as $$
begin
 if p_lease_token is null or p_environment not in('test','live') then raise exception 'invalid booking event claim' using errcode='22023';end if;
 return query with due as(select i.id from public.provider_event_inbox i where i.provider='stripe' and i.event_family='booking' and i.environment=p_environment and i.processing_state in('pending','processing','failed') and i.next_attempt_at<=pg_catalog.clock_timestamp() and(i.lease_expires_at is null or i.lease_expires_at<=pg_catalog.clock_timestamp()) order by i.received_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))) update public.provider_event_inbox i set processing_state='processing',attempts=i.attempts+1,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',fencing_token=i.fencing_token+1 from due where i.id=due.id returning i.*;
end $$;
create or replace function public.fail_booking_payment_event(p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_safe_error text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.provider_event_inbox set processing_state=case when attempts>=8 then'dead_letter'else'failed'end,next_attempt_at=pg_catalog.clock_timestamp()+least(interval '6 hours',pg_catalog.make_interval(secs=>30*pg_catalog.power(2,least(attempts,9))::integer)),safe_error=left(coalesce(p_safe_error,'Booking payment event processing failed'),240),lease_token=null,lease_expires_at=null where id=p_event_id and provider='stripe' and event_family='booking' and processing_state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();return found;
end $$;
revoke all on function public.claim_due_booking_payment_events(text,uuid,integer),public.fail_booking_payment_event(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_due_booking_payment_events(text,uuid,integer),public.fail_booking_payment_event(uuid,uuid,bigint,text) to service_role;

create or replace function public.apply_booking_payment_event(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_appointment_id uuid,p_checkout_session_id text,p_payment_intent_id text,p_charge_id text,p_amount bigint,p_currency text,p_paid boolean
) returns boolean language plpgsql security definer set search_path='' as $$
declare inbox public.provider_event_inbox%rowtype;p public.booking_payments%rowtype;a public.appointments%rowtype;selection public.calendar_selections%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_appointment_id::text||':booking-appointment',0));
 select * into strict inbox from public.provider_event_inbox where id=p_event_id and provider='stripe' and event_family='booking' and processing_state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp() for update;
 if inbox.event_type not in('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired') then raise exception 'unsupported booking payment event' using errcode='22023';end if;
 select * into strict p from public.booking_payments where appointment_id=p_appointment_id and profile_id=inbox.profile_id and environment=inbox.environment and stripe_account_id=inbox.account_context and checkout_session_id=p_checkout_session_id for update;
 select * into strict a from public.appointments where id=p.appointment_id for update;
 if p.expected_amount_minor<>p_amount or p.currency<>pg_catalog.upper(p_currency) then raise exception 'booking payment amount mismatch' using errcode='P0001';end if;
 if p.payment_state in('paid','disputed') then
  update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,safe_error=null where id=inbox.id;return true;
 end if;
 update public.booking_payments set payment_intent_id=coalesce(payment_intent_id,p_payment_intent_id),charge_id=coalesce(charge_id,p_charge_id),payment_state=case when p_paid then'paid'else'failed'end,amount_paid_minor=case when p_paid then p_amount else amount_paid_minor end,paid_at=case when p_paid then pg_catalog.clock_timestamp()else paid_at end,updated_at=pg_catalog.clock_timestamp() where id=p.id;
 if p_paid then
  if a.appointment_state='cancelled' then
   if a.start_at<=pg_catalog.clock_timestamp()then
    update public.appointments set payment_state='paid',refund_state='pending',review_state='late_payment',refund_generation=refund_generation+1,version=version+1,updated_at=pg_catalog.clock_timestamp()where id=a.id returning * into a;
    update public.booking_payments set refund_state='pending',refund_requested_at=pg_catalog.clock_timestamp(),refund_generation=refund_generation+1,refund_idempotency_key='booking-refund:'||a.id||':'||a.refund_generation,updated_at=pg_catalog.clock_timestamp()where id=p.id;
    insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload)values(a.profile_id,a.environment,a.id,'refund','booking-refund:'||a.id||':'||a.refund_generation,a.version,a.refund_generation,pg_catalog.jsonb_build_object('amount',p_amount))on conflict(profile_id,environment,idempotency_key)do nothing;
   else begin
    update public.appointments set appointment_state='confirmed',appointment_reason='late_payment_recovered',payment_state='paid',calendar_state='create_pending',refund_state='not_requested',review_state='none',confirmed_at=coalesce(confirmed_at,pg_catalog.clock_timestamp()),cancelled_at=null,reservation_expires_at=null,calendar_generation=calendar_generation+1,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id returning * into a;
    select * into strict selection from public.calendar_selections where profile_id=a.profile_id and environment=a.environment and active and receives_bookings;
   perform public.enqueue_booking_calendar_create(a.id);
    insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload) values(a.profile_id,a.environment,a.id,'notify','booking-notify:confirmed:'||a.id,a.version,a.version,pg_catalog.jsonb_build_object('notificationType','confirmed')) on conflict(profile_id,environment,idempotency_key)do nothing;
   exception when exclusion_violation then
    update public.appointments set payment_state='paid',refund_state='pending',review_state='late_payment',refund_generation=refund_generation+1,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id returning * into a;
    update public.booking_payments set refund_state='pending',refund_requested_at=pg_catalog.clock_timestamp(),refund_generation=refund_generation+1,refund_idempotency_key='booking-refund:'||a.id||':'||a.refund_generation,updated_at=pg_catalog.clock_timestamp() where id=p.id;
    insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload) values(a.profile_id,a.environment,a.id,'refund','booking-refund:'||a.id||':'||a.refund_generation,a.version,a.refund_generation,pg_catalog.jsonb_build_object('amount',p_amount)) on conflict(profile_id,environment,idempotency_key)do nothing;
   end;end if;
  else
   update public.appointments set appointment_state='confirmed',payment_state='paid',calendar_state='create_pending',confirmed_at=coalesce(confirmed_at,pg_catalog.clock_timestamp()),reservation_expires_at=null,calendar_generation=calendar_generation+1,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id returning * into a;
   perform public.enqueue_booking_calendar_create(a.id);
  end if;
 else update public.appointments set appointment_state='cancelled',appointment_reason='payment_failed',payment_state='failed',cancelled_at=pg_catalog.clock_timestamp(),version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id and a.appointment_state in('held','payment_pending');end if;
 update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,safe_error=null where id=inbox.id;return true;
end $$;
revoke all on function public.apply_booking_payment_event(uuid,uuid,bigint,uuid,text,text,text,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.apply_booking_payment_event(uuid,uuid,bigint,uuid,text,text,text,bigint,text,boolean) to service_role;

create or replace function public.issue_booking_confirmation_capability(p_checkout_session_id text,p_token_hash text,p_nonce_hash text)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.booking_payments%rowtype;cap uuid;
begin
 select * into strict p from public.booking_payments where checkout_session_id=p_checkout_session_id and payment_state='paid' and confirmation_nonce_hash=p_nonce_hash;
 insert into public.booking_confirmation_capabilities(appointment_id,profile_id,environment,checkout_session_id,token_hash,expires_at)
 values(p.appointment_id,p.profile_id,p.environment,p_checkout_session_id,p_token_hash,pg_catalog.clock_timestamp()+interval '24 hours')
 on conflict(environment,checkout_session_id) do update set expires_at=greatest(public.booking_confirmation_capabilities.expires_at,excluded.expires_at) where public.booking_confirmation_capabilities.token_hash=excluded.token_hash returning id into cap;

 if cap is null then raise exception 'confirmation capability mismatch' using errcode='P0001';end if;return cap;
end $$;


create or replace function public.apply_booking_money_mirror_event(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_payment_intent_id text,p_charge_id text,
 p_amount_refunded bigint,p_refund_id text,p_dispute_state text,p_dispute_id text,p_provider_created bigint default 0
) returns boolean language plpgsql security definer set search_path='' as $$
declare inbox public.provider_event_inbox%rowtype;p public.booking_payments%rowtype;a public.appointments%rowtype;new_refunded bigint;appointment_identity uuid;
begin
 select appointment_id into strict appointment_identity from public.booking_payments where profile_id=(select profile_id from public.provider_event_inbox where id=p_event_id) and environment=(select environment from public.provider_event_inbox where id=p_event_id) and stripe_account_id=(select account_context from public.provider_event_inbox where id=p_event_id) and(payment_intent_id=p_payment_intent_id or charge_id=p_charge_id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_identity::text||':booking-appointment',0));
 select * into strict inbox from public.provider_event_inbox where id=p_event_id and provider='stripe' and event_family='booking' and processing_state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp() for update;
 select * into strict p from public.booking_payments where profile_id=inbox.profile_id and environment=inbox.environment and stripe_account_id=inbox.account_context and(payment_intent_id=p_payment_intent_id or charge_id=p_charge_id) for update;
 select * into strict a from public.appointments where id=p.appointment_id for update;
 if p_amount_refunded is not null then
  if p_amount_refunded<0 or p_amount_refunded>p.amount_paid_minor then raise exception 'invalid mirrored refund amount' using errcode='22023';end if;
  new_refunded:=greatest(p.amount_refunded_minor,p_amount_refunded);
  update public.booking_payments set charge_id=coalesce(charge_id,p_charge_id),refund_id=coalesce(p_refund_id,refund_id),amount_refunded_minor=new_refunded,refund_state=case when new_refunded>=amount_paid_minor then'succeeded'when new_refunded>0 then'pending'else refund_state end,refunded_at=case when new_refunded>=amount_paid_minor then coalesce(refunded_at,pg_catalog.clock_timestamp())else refunded_at end,provider_updated_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=p.id;
  update public.appointments set refund_state=case when new_refunded>=p.amount_paid_minor then'succeeded'when new_refunded>0 then'pending'else refund_state end,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id;
 end if;
 if p_dispute_state is not null then
  if p_dispute_id!~'^dp_' or p_dispute_state not in('open','won','lost','closed') or p_provider_created<=0 then raise exception 'invalid dispute state' using errcode='22023';end if;
  if p.dispute_id is null or (p.dispute_id=p_dispute_id and (p_provider_created>p.dispute_provider_created or (p_provider_created=p.dispute_provider_created and case p_dispute_state when'open'then 1 else 2 end>=p.dispute_status_rank))) then
   update public.booking_payments set charge_id=coalesce(charge_id,p_charge_id),dispute_id=p_dispute_id,payment_state=case when p_dispute_state='open'then'disputed'when p_dispute_state in('won','closed')and dispute_state='open'then'paid'else payment_state end,dispute_state=p_dispute_state,dispute_provider_created=p_provider_created,dispute_status_rank=case p_dispute_state when'open'then 1 else 2 end,provider_updated_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=p.id;
   update public.appointments set payment_state=case when p_dispute_state='open'then'disputed'when p_dispute_state in('won','closed')and payment_state='disputed'then'paid'else payment_state end,review_state=case when p_dispute_state in('open','lost')then'provider_inconsistency'else review_state end,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id;
  end if;
 end if;
 update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,safe_error=null where id=inbox.id;return true;
end $$;
revoke all on function public.apply_booking_money_mirror_event(uuid,uuid,bigint,text,text,bigint,text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.apply_booking_money_mirror_event(uuid,uuid,bigint,text,text,bigint,text,text,text,bigint) to service_role;

create or replace function public.consume_booking_confirmation_capability(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.booking_confirmation_capabilities%rowtype;a public.appointments%rowtype;
begin
 select * into strict c from public.booking_confirmation_capabilities where token_hash=p_token_hash and expires_at>pg_catalog.clock_timestamp() for update;
 update public.booking_confirmation_capabilities set consumed_at=coalesce(consumed_at,pg_catalog.clock_timestamp()) where id=c.id;
 select * into strict a from public.appointments where id=c.appointment_id;
 return pg_catalog.jsonb_build_object('reference',a.public_reference,'startAt',a.start_at,'endAt',a.end_at,'timeZone',a.time_zone,'service',a.service_snapshot,'location',a.location_snapshot,'appointmentState',a.appointment_state,'refundState',a.refund_state,'calendarState',a.calendar_state,'paymentState',a.payment_state);
end $$;
revoke all on function public.issue_booking_confirmation_capability(text,text,text) from public,anon,authenticated;
revoke all on function public.consume_booking_confirmation_capability(text) from public,anon,authenticated;
grant execute on function public.issue_booking_confirmation_capability(text,text,text) to service_role;
grant execute on function public.consume_booking_confirmation_capability(text) to service_role;

create or replace function public.claim_due_booking_outbox(p_lease_token uuid,p_limit integer default 25)
returns setof public.integration_outbox language plpgsql security definer set search_path='' as $$
begin
 if p_lease_token is null then raise exception 'lease required' using errcode='22023';end if;
 return query with due as(select o.id from public.integration_outbox o join public.appointments a on a.id=o.appointment_id and a.profile_id=o.profile_id and a.environment=o.environment left join public.booking_payments p on p.appointment_id=a.id where o.effect_contract_version=2 and o.command_type in('calendar_create','calendar_cancel','refund','notify') and o.state in('pending','failed','processing') and o.terminal_at is null and o.next_attempt_at<=pg_catalog.clock_timestamp() and(o.lease_expires_at is null or o.lease_expires_at<=pg_catalog.clock_timestamp()) and((o.command_type='calendar_create' and o.effect_generation=a.calendar_generation and a.calendar_state='create_pending' and a.appointment_state='confirmed' and o.payload ? 'connectionId' and o.payload ? 'selectionId')or(o.command_type='calendar_cancel' and o.effect_generation=a.calendar_generation and a.calendar_state='cancel_pending' and a.appointment_state='cancelled' and o.payload ? 'connectionId' and o.payload ? 'selectionId')or(o.command_type='refund' and o.effect_generation=a.refund_generation and a.refund_state='pending' and p.refund_state='pending' and p.amount_paid_minor>p.amount_refunded_minor)or(o.command_type='notify' and o.desired_appointment_version<=a.version and o.payload->>'notificationType' in('confirmed','cancelled','refund_succeeded','late_payment_recovered','late_payment_refunded'))) order by o.next_attempt_at,o.id for update of o skip locked limit greatest(1,least(coalesce(p_limit,25),100)))
 update public.integration_outbox o set state='processing',attempts=o.attempts+1,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',fencing_token=o.fencing_token+1 from due where o.id=due.id returning o.*;
end $$;

create or replace function public.enqueue_booking_calendar_create(p_appointment_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype;s public.calendar_selections%rowtype;e public.calendar_destination_epochs%rowtype;event_id text;
begin
 select * into strict a from public.appointments where id=p_appointment_id for update;
 select * into strict s from public.calendar_selections where profile_id=a.profile_id and environment=a.environment and active and receives_bookings;
 select * into e from public.ensure_calendar_destination_epoch(a.profile_id,a.environment,s.connection_id,s.id);event_id:='obra'||pg_catalog.substr(pg_catalog.encode(extensions.digest(a.id::text,'sha256'),'hex'),1,48);
 insert into public.calendar_event_links(appointment_id,profile_id,connection_id,calendar_selection_id,environment,google_event_id,desired_appointment_version,sync_state,destination_epoch_id) values(a.id,a.profile_id,s.connection_id,s.id,a.environment,event_id,a.version,'pending',e.id) on conflict(appointment_id,environment)do nothing;
 insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload,destination_epoch_id) values(a.profile_id,a.environment,a.id,'calendar_create','calendar-create:'||a.id||':'||a.calendar_generation,a.version,a.calendar_generation,pg_catalog.jsonb_build_object('appointmentId',a.id,'connectionId',s.connection_id,'selectionId',s.id,'googleEventId',event_id),e.id) on conflict(profile_id,environment,idempotency_key)do nothing;return true;
end $$;
revoke all on function public.enqueue_booking_calendar_create(uuid) from public,anon,authenticated,service_role;

create or replace function public.get_booking_outbox_context(p_command_id uuid,p_lease_token uuid,p_fencing_token bigint)
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.jsonb_build_object('appointment',pg_catalog.to_jsonb(a),'payment',pg_catalog.to_jsonb(p),'connection',pg_catalog.to_jsonb(c),'selection',pg_catalog.to_jsonb(s),'epoch',pg_catalog.to_jsonb(e),'link',pg_catalog.to_jsonb(l)) from public.integration_outbox o join public.appointments a on a.id=o.appointment_id left join public.booking_payments p on p.appointment_id=a.id left join public.calendar_connections c on c.id=nullif(o.payload->>'connectionId','')::uuid and c.profile_id=o.profile_id and c.environment=o.environment left join public.calendar_selections s on s.id=nullif(o.payload->>'selectionId','')::uuid and s.profile_id=o.profile_id and s.environment=o.environment left join public.calendar_destination_epochs e on e.id=o.destination_epoch_id left join public.calendar_event_links l on l.appointment_id=a.id and l.environment=a.environment where o.id=p_command_id and o.command_type in('calendar_create','calendar_cancel','refund','notify') and o.state='processing' and o.lease_token=p_lease_token and o.fencing_token=p_fencing_token and o.lease_expires_at>pg_catalog.clock_timestamp()
$$;
create or replace function public.list_booking_calendar_reconciliation(p_limit integer default 25)
returns table(link jsonb,appointment_state text,epoch jsonb) language sql stable security definer set search_path='' as $$
 select pg_catalog.to_jsonb(l),a.appointment_state,pg_catalog.to_jsonb(e) from public.calendar_event_links l join public.appointments a on a.id=l.appointment_id and a.profile_id=l.profile_id and a.environment=l.environment join public.calendar_destination_epochs e on e.id=l.destination_epoch_id where l.sync_state in('pending','ambiguous') order by l.updated_at limit greatest(1,least(coalesce(p_limit,25),100))
$$;
revoke all on function public.get_booking_outbox_context(uuid,uuid,bigint),public.list_booking_calendar_reconciliation(integer) from public,anon,authenticated;
grant execute on function public.get_booking_outbox_context(uuid,uuid,bigint),public.list_booking_calendar_reconciliation(integer) to service_role;

create or replace function public.bind_booking_calendar_intent(p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_event_id text)
returns public.calendar_destination_epochs language plpgsql security definer set search_path='' as $$
declare cmd public.integration_outbox%rowtype;epoch public.calendar_destination_epochs%rowtype;
begin
 if p_event_id<>'obra'||pg_catalog.substr(pg_catalog.encode(extensions.digest((select appointment_id from public.integration_outbox where id=p_command_id)::text,'sha256'),'hex'),1,48) then raise exception 'invalid deterministic Google event identity' using errcode='22023';end if;
 select * into strict cmd from public.integration_outbox where id=p_command_id and command_type='calendar_create' and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp() for update;
 if cmd.destination_epoch_id is null then
  select * into epoch from public.ensure_calendar_destination_epoch(cmd.profile_id,cmd.environment,(cmd.payload->>'connectionId')::uuid,(cmd.payload->>'selectionId')::uuid);
  update public.integration_outbox set destination_epoch_id=epoch.id,payload=payload||pg_catalog.jsonb_build_object('googleEventId',p_event_id) where id=cmd.id;
 else select * into strict epoch from public.calendar_destination_epochs where id=cmd.destination_epoch_id and profile_id=cmd.profile_id and environment=cmd.environment;end if;
 insert into public.calendar_event_links(appointment_id,profile_id,connection_id,calendar_selection_id,environment,google_event_id,desired_appointment_version,sync_state,last_attempt_at,destination_epoch_id)
 values(cmd.appointment_id,cmd.profile_id,epoch.connection_id,epoch.calendar_selection_id,cmd.environment,p_event_id,cmd.desired_appointment_version,'ambiguous',pg_catalog.clock_timestamp(),epoch.id)
 on conflict(appointment_id,environment)do update set destination_epoch_id=excluded.destination_epoch_id,google_event_id=excluded.google_event_id,sync_state=case when public.calendar_event_links.sync_state='created'then'created'else'ambiguous'end,last_attempt_at=excluded.last_attempt_at;
 return epoch;
end $$;
revoke all on function public.bind_booking_calendar_intent(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.bind_booking_calendar_intent(uuid,uuid,bigint,text) to service_role;

create or replace function public.fail_booking_outbox(p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_retryable boolean,p_safe_error text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.integration_outbox set state=case when not p_retryable or attempts>=8 then'dead_letter'else'failed'end,
  safe_error=left(coalesce(p_safe_error,'Booking provider operation failed'),240),
  next_attempt_at=pg_catalog.clock_timestamp()+least(interval '6 hours',pg_catalog.make_interval(secs=>30*pg_catalog.power(2,least(attempts,9))::integer)),
  terminal_at=case when not p_retryable or attempts>=8 then pg_catalog.clock_timestamp()else null end,lease_token=null,lease_expires_at=null
 where id=p_command_id and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();
 if not found then raise exception 'stale booking outbox fence' using errcode='40001';end if;
 if not p_retryable or (select attempts>=8 from public.integration_outbox where id=p_command_id) then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((select appointment_id from public.integration_outbox where id=p_command_id)::text||':booking-appointment',0));
  update public.appointments a set calendar_state=case when o.command_type='calendar_create'then'create_failed'when o.command_type='calendar_cancel'then'cancel_failed'else a.calendar_state end,refund_state=case when o.command_type='refund'then'failed'else a.refund_state end,review_state=case when o.command_type='refund'then'refund_failure'else'calendar_reconciliation'end,version=a.version+1,updated_at=pg_catalog.clock_timestamp() from public.integration_outbox o where o.id=p_command_id and a.id=o.appointment_id and((o.command_type='calendar_create'and o.effect_generation=a.calendar_generation and a.calendar_state='create_pending')or(o.command_type='calendar_cancel'and o.effect_generation=a.calendar_generation and a.calendar_state='cancel_pending')or(o.command_type='refund'and o.effect_generation=a.refund_generation and a.refund_state='pending'));
  update public.booking_payments p set refund_state='failed',updated_at=pg_catalog.clock_timestamp() from public.integration_outbox o join public.appointments a on a.id=o.appointment_id where o.id=p_command_id and o.command_type='refund' and p.appointment_id=o.appointment_id and o.effect_generation=a.refund_generation and a.refund_state='failed';
 end if;return true;
end $$;

create or replace function public.cancel_contractor_booking(
 p_appointment_id uuid,p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_client_request_id uuid,p_request_hash text
) returns public.appointments language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype;p public.booking_payments%rowtype;op public.appointment_operations%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_profile_id and environment=p_environment and auth_user_id=p_actor_auth_user_id) then raise exception 'booking cancellation forbidden' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':booking',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_appointment_id::text||':booking-appointment',0));
 select * into op from public.appointment_operations where profile_id=p_profile_id and environment=p_environment and operation_type='cancel' and client_request_id=p_client_request_id;
 if found then if op.request_hash<>p_request_hash or op.appointment_id<>p_appointment_id then raise exception 'idempotency key payload conflict' using errcode='23505';end if;select * into strict a from public.appointments where id=op.appointment_id;return a;end if;
 select * into strict a from public.appointments where id=p_appointment_id and profile_id=p_profile_id and environment=p_environment for update;
 if a.start_at<=pg_catalog.clock_timestamp() then raise exception 'only future bookings can be cancelled' using errcode='P0001';end if;
 if a.appointment_state='cancelled' then insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,client_request_id,request_hash,state,result) values(a.profile_id,a.id,a.environment,'cancel',p_client_request_id,p_request_hash,'succeeded',pg_catalog.jsonb_build_object('appointmentId',a.id,'version',a.version));return a;end if;
 select * into strict p from public.booking_payments where appointment_id=a.id for update;
 if a.appointment_state<>'confirmed' or p.payment_state not in('paid','disputed') then raise exception 'booking is not eligible for contractor cancellation' using errcode='P0001';end if;
 update public.appointments set appointment_state='cancelled',appointment_reason='contractor_cancelled',cancellation_requested_at=pg_catalog.clock_timestamp(),cancelled_at=pg_catalog.clock_timestamp(),
  refund_state=case when p.amount_paid_minor>p.amount_refunded_minor then'pending'else refund_state end,
  calendar_state=case when calendar_state in('created','create_failed')then'cancel_pending' when calendar_state='create_pending' and exists(select 1 from public.integration_outbox io where io.appointment_id=a.id and io.environment=a.environment and io.command_type='calendar_create' and io.state='processing')then'cancel_pending' when calendar_state='create_pending'then'cancelled'else calendar_state end,
  refund_generation=refund_generation+case when p.amount_paid_minor>p.amount_refunded_minor then 1 else 0 end,
  calendar_generation=calendar_generation+case when calendar_state in('created','create_failed')then 1 when calendar_state='create_pending' and not exists(select 1 from public.integration_outbox io where io.appointment_id=a.id and io.environment=a.environment and io.command_type='calendar_create' and io.state='processing')then 1 else 0 end,
  version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id returning * into a;
 if p.amount_paid_minor>p.amount_refunded_minor then
  update public.booking_payments set refund_state='pending',refund_requested_at=pg_catalog.clock_timestamp(),refund_generation=refund_generation+1,
   refund_idempotency_key='booking-refund:'||a.id||':'||a.refund_generation,updated_at=pg_catalog.clock_timestamp() where id=p.id;
  insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload)
  values(a.profile_id,a.environment,a.id,'refund','booking-refund:'||a.id||':'||a.refund_generation,a.version,a.refund_generation,pg_catalog.jsonb_build_object('amount',p.amount_paid_minor-p.amount_refunded_minor)) on conflict(profile_id,environment,idempotency_key)do nothing;
 end if;
 if a.calendar_state='cancel_pending' and exists(select 1 from public.calendar_event_links where appointment_id=a.id and environment=a.environment) then insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload,destination_epoch_id)
  values(a.profile_id,a.environment,a.id,'calendar_cancel','calendar-cancel:'||a.id||':'||a.calendar_generation,a.version,a.calendar_generation,pg_catalog.jsonb_build_object('connectionId',(select connection_id from public.calendar_event_links where appointment_id=a.id and environment=a.environment),'selectionId',(select calendar_selection_id from public.calendar_event_links where appointment_id=a.id and environment=a.environment)),(select destination_epoch_id from public.calendar_event_links where appointment_id=a.id and environment=a.environment)) on conflict(profile_id,environment,idempotency_key)do nothing;end if;
 insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,client_request_id,request_hash,state,result)
 values(a.profile_id,a.id,a.environment,'cancel',p_client_request_id,p_request_hash,'succeeded',pg_catalog.jsonb_build_object('appointmentId',a.id,'version',a.version));
 insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload) values(a.profile_id,a.environment,a.id,'notify','booking-notify:cancelled:'||a.id,a.version,a.version,pg_catalog.jsonb_build_object('notificationType','cancelled')) on conflict(profile_id,environment,idempotency_key)do nothing;return a;
end $$;

revoke all on function public.claim_due_booking_outbox(uuid,integer) from public,anon,authenticated;
revoke all on function public.fail_booking_outbox(uuid,uuid,bigint,boolean,text) from public,anon,authenticated;
revoke all on function public.cancel_contractor_booking(uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_due_booking_outbox(uuid,integer) to service_role;
grant execute on function public.fail_booking_outbox(uuid,uuid,bigint,boolean,text) to service_role;
grant execute on function public.cancel_contractor_booking(uuid,uuid,text,uuid,uuid,text) to service_role;


create or replace function public.complete_booking_outbox(
 p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_provider_result jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare cmd public.integration_outbox%rowtype;a public.appointments%rowtype;p public.booking_payments%rowtype;refund_amount bigint;absolute_refunded bigint;remaining_amount bigint;
 selection public.calendar_selections%rowtype;link public.calendar_event_links%rowtype;
begin
 select * into strict cmd from public.integration_outbox where id=p_command_id and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(cmd.appointment_id::text||':booking-appointment',0));
 select * into strict cmd from public.integration_outbox where id=p_command_id and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp() for update;
 select * into strict a from public.appointments where id=cmd.appointment_id and profile_id=cmd.profile_id and environment=cmd.environment for update;
 if cmd.command_type like 'calendar_%' and cmd.effect_generation<>a.calendar_generation then raise exception 'stale calendar effect generation' using errcode='40001';end if;
 if cmd.command_type='refund' and cmd.effect_generation<>a.refund_generation then raise exception 'stale refund effect generation' using errcode='40001';end if;
 if cmd.command_type='notify' and (p_provider_result->>'notificationId') is null then raise exception 'notification provider identity missing' using errcode='22023';end if;
 if cmd.command_type='calendar_create' then
  if p_provider_result->>'googleEventId' is distinct from cmd.payload->>'googleEventId' then raise exception 'Google event identity mismatch' using errcode='22023';end if;
  select * into strict selection from public.calendar_selections where id=(cmd.payload->>'selectionId')::uuid and connection_id=(cmd.payload->>'connectionId')::uuid and profile_id=a.profile_id and environment=a.environment;
  insert into public.calendar_event_links(appointment_id,profile_id,connection_id,calendar_selection_id,environment,google_event_id,ical_uid,etag,desired_appointment_version,sync_state,last_attempt_at,destination_epoch_id)
  values(a.id,a.profile_id,selection.connection_id,selection.id,a.environment,p_provider_result->>'googleEventId',p_provider_result->>'icalUid',p_provider_result->>'etag',a.version,'created',pg_catalog.clock_timestamp(),cmd.destination_epoch_id)
  on conflict(appointment_id,environment)do update set ical_uid=excluded.ical_uid,etag=excluded.etag,sync_state='created',updated_at=pg_catalog.clock_timestamp() where public.calendar_event_links.google_event_id=excluded.google_event_id and public.calendar_event_links.destination_epoch_id=excluded.destination_epoch_id;
  update public.appointments set calendar_state=case when appointment_state='confirmed'then'created'else'cancel_pending'end,calendar_generation=calendar_generation+case when appointment_state='confirmed'then 0 else 1 end,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id returning * into a;
  if a.appointment_state='cancelled' then insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload,destination_epoch_id) values(a.profile_id,a.environment,a.id,'calendar_cancel','calendar-cancel-after-create:'||cmd.id,a.version,a.calendar_generation,pg_catalog.jsonb_build_object('connectionId',selection.connection_id,'selectionId',selection.id),cmd.destination_epoch_id) on conflict(profile_id,environment,idempotency_key)do nothing;end if;
 elsif cmd.command_type='calendar_cancel' then
  update public.calendar_event_links set sync_state='cancelled',updated_at=pg_catalog.clock_timestamp() where appointment_id=a.id;
  update public.appointments set calendar_state='cancelled',version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id;
 elsif cmd.command_type='refund' then
  select * into strict p from public.booking_payments where appointment_id=a.id for update;
  remaining_amount:=p.amount_paid_minor-p.amount_refunded_minor;
  refund_amount:=coalesce((p_provider_result->>'amount')::bigint,-1);absolute_refunded:=coalesce((p_provider_result->>'absoluteRefunded')::bigint,-1);
  if remaining_amount>0 and ((p_provider_result->>'refundId')!~'^re_' or refund_amount<>remaining_amount or absolute_refunded<p.amount_refunded_minor or absolute_refunded>p.amount_paid_minor or coalesce(p_provider_result->>'refundStatus','') not in('pending','requires_action','succeeded')) then raise exception 'invalid Stripe refund completion evidence' using errcode='22023';end if;
  update public.booking_payments set refund_id=case when absolute_refunded>=p.amount_paid_minor then p_provider_result->>'refundId' else refund_id end,amount_refunded_minor=greatest(p.amount_refunded_minor,absolute_refunded),refund_state=case when absolute_refunded>=p.amount_paid_minor then'succeeded'else'pending'end,refunded_at=case when absolute_refunded>=p.amount_paid_minor then coalesce(refunded_at,pg_catalog.clock_timestamp())else refunded_at end,updated_at=pg_catalog.clock_timestamp() where id=p.id returning * into p;
  update public.appointments set refund_state=p.refund_state,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id;
  if p.refund_state='succeeded' then insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload) values(a.profile_id,a.environment,a.id,'notify','booking-notify:refund:'||a.id,a.version,a.version,pg_catalog.jsonb_build_object('notificationType','refund_succeeded')) on conflict(profile_id,environment,idempotency_key)do nothing;end if;
  if p.refund_state='pending' then update public.integration_outbox set state='failed',safe_error='Stripe refund pending reconciliation',next_attempt_at=pg_catalog.clock_timestamp()+interval '15 minutes',lease_token=null,lease_expires_at=null where id=cmd.id;return true;end if;
 elsif cmd.command_type='notify' then null;
 else raise exception 'unsupported booking effect' using errcode='22023';end if;
 update public.integration_outbox set state='succeeded',safe_error=null,completed_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null where id=cmd.id;return true;
end $$;
revoke all on function public.complete_booking_outbox(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.complete_booking_outbox(uuid,uuid,bigint,jsonb) to service_role;


create or replace function public.create_public_booking_attachment_record(p_attachment_id uuid,p_appointment_id uuid,p_original_filename text,p_display_filename text,p_mime_type text,p_byte_size bigint,p_checksum text,p_quota_slot smallint)
returns public.booking_attachments language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype;result public.booking_attachments%rowtype;object_key text;
begin
 if p_attachment_id is null or p_quota_slot not between 1 and 5 or p_mime_type not in('image/jpeg','image/png','image/webp') or p_byte_size not between 1 and 10485760 or p_checksum!~'^[a-f0-9]{64}$' then raise exception 'invalid attachment request' using errcode='22023';end if;
 if not exists(select 1 from public.booking_attachment_security where singleton and upload_enabled and scanner_proven_at is not null) then raise exception 'attachment scanner is not proven' using errcode='P0001';end if;
 select * into strict a from public.appointments where id=p_appointment_id and appointment_state in('held','payment_pending') and reservation_expires_at>pg_catalog.clock_timestamp() for update;
 object_key:=a.environment||'/'||a.profile_id::text||'/'||a.website_id::text||'/'||a.id::text||'/'||p_attachment_id::text;
 insert into public.booking_attachments(id,appointment_id,customer_id,profile_id,website_id,environment,storage_object_key,original_filename,display_filename,mime_type,byte_size,checksum,quota_slot)
 values(p_attachment_id,a.id,a.customer_id,a.profile_id,a.website_id,a.environment,object_key,left(p_original_filename,255),left(p_display_filename,120),p_mime_type,p_byte_size,p_checksum,p_quota_slot) returning * into result;return result;
end $$;
create or replace function public.list_due_booking_attachment_scans(p_limit integer default 10)
returns setof public.booking_attachments language sql security definer set search_path='' as $$
 select * from public.booking_attachments where upload_state in('uploaded','quarantined') and(scan_lease_expires_at is null or scan_lease_expires_at<=pg_catalog.clock_timestamp()) order by created_at limit greatest(1,least(coalesce(p_limit,10),50))
$$;
revoke all on function public.create_public_booking_attachment_record(uuid,uuid,text,text,text,bigint,text,smallint) from public,anon,authenticated;
revoke all on function public.list_due_booking_attachment_scans(integer) from public,anon,authenticated;
grant execute on function public.create_public_booking_attachment_record(uuid,uuid,text,text,text,bigint,text,smallint) to service_role;
grant execute on function public.list_due_booking_attachment_scans(integer) to service_role;

create or replace function public.settle_booking_calendar_reconciliation(p_link_id uuid,p_expected_event_id text,p_state text)
returns boolean language plpgsql security definer set search_path='' as $$
declare l public.calendar_event_links%rowtype;
begin
 if p_state not in('created','cancelled')then raise exception 'invalid calendar reconciliation state' using errcode='22023';end if;
 select * into strict l from public.calendar_event_links where id=p_link_id and google_event_id=p_expected_event_id for update;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(l.appointment_id::text||':booking-appointment',0));
 update public.calendar_event_links set sync_state=p_state,updated_at=pg_catalog.clock_timestamp() where id=l.id and google_event_id=p_expected_event_id;
 if not found then return false;end if;
 update public.appointments set calendar_state=case when p_state='created'then'created'else'cancelled'end,review_state=case when review_state='calendar_reconciliation'then'none'else review_state end,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=l.appointment_id and((p_state='created'and appointment_state='confirmed')or(p_state='cancelled'and appointment_state='cancelled'));return found;
end $$;
revoke all on function public.settle_booking_calendar_reconciliation(uuid,text,text) from public,anon,authenticated;
grant execute on function public.settle_booking_calendar_reconciliation(uuid,text,text) to service_role;

create or replace function public.expire_due_booking_holds(p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer:=0;candidate uuid;
begin
 for candidate in select id from public.appointments where appointment_state='held' and payment_state='not_started' and reservation_expires_at<=pg_catalog.clock_timestamp() order by reservation_expires_at for update skip locked limit greatest(1,least(coalesce(p_limit,100),500)) loop
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(candidate::text||':booking-appointment',0));
  update public.appointments set appointment_state='cancelled',appointment_reason='hold_expired',cancelled_at=pg_catalog.clock_timestamp(),version=version+1,updated_at=pg_catalog.clock_timestamp() where id=candidate and appointment_state='held' and payment_state='not_started' and reservation_expires_at<=pg_catalog.clock_timestamp();
  if found then changed:=changed+1;end if;
 end loop;
 return changed;
end $$;

create or replace function public.list_ambiguous_booking_checkouts(p_environment text,p_limit integer default 25)
returns table(payment_id uuid,appointment_id uuid,environment text,stripe_account_id text,checkout_idempotency_key text,checkout_provider_expires_at timestamptz)
language sql security definer set search_path='' as $$
 select p.id,p.appointment_id,p.environment,p.stripe_account_id,p.checkout_idempotency_key,p.checkout_provider_expires_at from public.booking_payments p join public.appointments a on a.id=p.appointment_id
 where p.environment=p_environment and p.payment_state='creating' and p.checkout_session_id is null and p.checkout_idempotency_key is not null and a.appointment_state in('held','cancelled')
 order by p.updated_at limit greatest(1,least(coalesce(p_limit,25),100))
$$;
revoke all on function public.expire_due_booking_holds(integer) from public,anon,authenticated;
revoke all on function public.list_ambiguous_booking_checkouts(text,integer) from public,anon,authenticated;
grant execute on function public.expire_due_booking_holds(integer) to service_role;
grant execute on function public.list_ambiguous_booking_checkouts(text,integer) to service_role;


create or replace function public.claim_ambiguous_booking_checkouts(p_environment text,p_lease_token uuid,p_limit integer default 25)
returns table(payment_id uuid,appointment_id uuid,profile_id uuid,environment text,stripe_account_id text,checkout_idempotency_key text,checkout_provider_expires_at timestamptz,checkout_operation_id uuid,expected_amount_minor bigint,currency text,website_id uuid,service_snapshot jsonb,customer_snapshot jsonb,checkout_fencing_token bigint)
language plpgsql security definer set search_path='' as $$
begin
 if p_lease_token is null then raise exception 'lease required' using errcode='22023';end if;
 return query with due as(select p.id from public.booking_payments p join public.appointments a on a.id=p.appointment_id where p.environment=p_environment and p.payment_state='creating' and p.checkout_idempotency_key is not null and p.checkout_provider_expires_at>pg_catalog.clock_timestamp() and(p.checkout_session_id is null or(a.appointment_state='held'and a.payment_state='creating')) and(p.checkout_lease_expires_at is null or p.checkout_lease_expires_at<=pg_catalog.clock_timestamp()) order by p.updated_at for update of p skip locked limit greatest(1,least(coalesce(p_limit,25),100))),claimed as(update public.booking_payments p set checkout_lease_token=p_lease_token,checkout_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',checkout_fencing_token=p.checkout_fencing_token+1,updated_at=pg_catalog.clock_timestamp() from due where p.id=due.id returning p.*) select p.id,p.appointment_id,p.profile_id,p.environment,p.stripe_account_id,p.checkout_idempotency_key,p.checkout_provider_expires_at,p.checkout_operation_id,p.expected_amount_minor,p.currency,a.website_id,a.service_snapshot,a.customer_snapshot,p.checkout_fencing_token from claimed p join public.appointments a on a.id=p.appointment_id;
end $$;
revoke all on function public.claim_ambiguous_booking_checkouts(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_ambiguous_booking_checkouts(text,uuid,integer) to service_role;

create or replace function public.claim_due_booking_sessions(p_environment text,p_lease_token uuid,p_limit integer default 25)
returns setof public.booking_payments language plpgsql security definer set search_path='' as $$
begin
 if p_lease_token is null then raise exception 'lease required' using errcode='22023';end if;
 return query with due as(select p.id from public.booking_payments p join public.appointments a on a.id=p.appointment_id and a.profile_id=p.profile_id and a.environment=p.environment where p.environment=p_environment and p.checkout_session_id is not null and((a.appointment_state='payment_pending' and a.reservation_expires_at<=pg_catalog.clock_timestamp() and p.payment_state='pending')or(a.appointment_state='cancelled' and p.payment_state in('creating','pending'))) and(p.checkout_lease_expires_at is null or p.checkout_lease_expires_at<=pg_catalog.clock_timestamp()) order by a.reservation_expires_at for update of p skip locked limit greatest(1,least(coalesce(p_limit,25),100)))
 update public.booking_payments p set checkout_lease_token=p_lease_token,checkout_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',checkout_fencing_token=p.checkout_fencing_token+1,updated_at=pg_catalog.clock_timestamp() from due where p.id=due.id returning p.*;
end $$;

create or replace function public.settle_due_booking_session(p_payment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_paid boolean,p_expired boolean,p_payment_intent_id text,p_charge_id text,p_amount bigint,p_currency text)
returns boolean language plpgsql security definer set search_path='' as $$
declare p public.booking_payments%rowtype;a public.appointments%rowtype;selection public.calendar_selections%rowtype;appointment_identity uuid;
begin
 select appointment_id into strict appointment_identity from public.booking_payments where id=p_payment_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_identity::text||':booking-appointment',0));
 select * into strict p from public.booking_payments where id=p_payment_id and checkout_lease_token=p_lease_token and checkout_fencing_token=p_fencing_token and checkout_lease_expires_at>pg_catalog.clock_timestamp() for update;
 select * into strict a from public.appointments where id=p.appointment_id for update;
 if p_paid then
  if p.expected_amount_minor<>p_amount or p.currency<>pg_catalog.upper(p_currency) then raise exception 'booking payment amount mismatch' using errcode='P0001';end if;
  update public.booking_payments set payment_intent_id=coalesce(payment_intent_id,p_payment_intent_id),charge_id=coalesce(charge_id,p_charge_id),payment_state='paid',amount_paid_minor=p_amount,paid_at=coalesce(paid_at,pg_catalog.clock_timestamp()),checkout_lease_token=null,checkout_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=p.id;
  -- A payment discovered by expiry arbitration is late. Local capacity cannot prove
  -- fresh Google FreeBusy, so fail closed to the deterministic full-refund path.
  if a.appointment_state in('payment_pending','cancelled') then
   update public.appointments set appointment_state='cancelled',appointment_reason='late_payment_refund',payment_state='paid',refund_state='pending',review_state='late_payment',cancelled_at=coalesce(cancelled_at,pg_catalog.clock_timestamp()),refund_generation=refund_generation+case when refund_state<>'pending' then 1 else 0 end,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id returning * into a;
   update public.booking_payments set refund_state='pending',refund_requested_at=coalesce(refund_requested_at,pg_catalog.clock_timestamp()),refund_generation=a.refund_generation,refund_idempotency_key='booking-refund:'||a.id||':'||a.refund_generation,updated_at=pg_catalog.clock_timestamp() where id=p.id;
   insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload) values(a.profile_id,a.environment,a.id,'refund','booking-refund:'||a.id||':'||a.refund_generation,a.version,a.refund_generation,pg_catalog.jsonb_build_object('amount',p_amount,'reason','late_payment_no_fresh_freebusy')) on conflict(profile_id,environment,idempotency_key)do nothing;
  end if;
 elsif p_expired then
  update public.booking_payments set payment_state='failed',failed_at=coalesce(failed_at,pg_catalog.clock_timestamp()),checkout_lease_token=null,checkout_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=p.id;
  update public.appointments set appointment_state='cancelled',appointment_reason='payment_expired',payment_state='failed',cancelled_at=pg_catalog.clock_timestamp(),version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id and appointment_state='payment_pending';
 else
  update public.booking_payments set checkout_lease_token=null,checkout_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=p.id;
 end if;return true;
end $$;
revoke all on function public.claim_due_booking_sessions(text,uuid,integer) from public,anon,authenticated;
revoke all on function public.settle_due_booking_session(uuid,uuid,bigint,boolean,boolean,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.claim_due_booking_sessions(text,uuid,integer) to service_role;
grant execute on function public.settle_due_booking_session(uuid,uuid,bigint,boolean,boolean,text,text,bigint,text) to service_role;
