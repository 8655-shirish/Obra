-- Persist cutover evidence before any later validation or cleanup migration.
create table if not exists public.booking_cutover_quarantine(
 id bigint generated always as identity primary key,entity_kind text not null,entity_id text not null,profile_id uuid,environment text,reason_code text not null,evidence_hash text not null check(evidence_hash~'^[a-f0-9]{64}$'),resolved_at timestamptz,resolution text,created_at timestamptz not null default now(),unique(entity_kind,entity_id,reason_code)
);
create table if not exists public.booking_cutover_state(
 profile_id uuid not null,environment text not null check(environment in('test','live')),status text not null default 'blocked' check(status in('blocked','reconciling','enabled')),target_contract_version smallint not null default 2,preflight_digest text,preflight_completed_at timestamptz,enabled_at timestamptz,primary key(profile_id,environment)
);
alter table public.booking_cutover_quarantine enable row level security;alter table public.booking_cutover_state enable row level security;
revoke all on public.booking_cutover_quarantine,public.booking_cutover_state from public,anon,authenticated;
insert into public.booking_cutover_state(profile_id,environment)select id,environment from public.profiles on conflict do nothing;
insert into public.booking_cutover_quarantine(entity_kind,entity_id,profile_id,environment,reason_code,evidence_hash)
select 'booking_payment',p.id::text,p.profile_id,p.environment,'provider_object_without_connected_account',pg_catalog.encode(extensions.digest(p.id::text||':provider_object_without_connected_account','sha256'),'hex')
from public.booking_payments p where p.booking_contract_version=1 and p.stripe_account_id is null and(p.checkout_session_id is not null or p.payment_intent_id is not null or p.charge_id is not null or p.refund_id is not null) on conflict do nothing;
insert into public.booking_cutover_quarantine(entity_kind,entity_id,profile_id,environment,reason_code,evidence_hash)
select 'provider_effect',o.id::text,o.profile_id,o.environment,'nonterminal_v1_provider_effect',pg_catalog.encode(extensions.digest(o.id::text||':nonterminal_v1_provider_effect','sha256'),'hex') from public.integration_outbox o where o.effect_contract_version=1 and o.state in('pending','processing','failed') on conflict do nothing;
insert into public.booking_cutover_quarantine(entity_kind,entity_id,profile_id,environment,reason_code,evidence_hash)
select 'calendar_effect',o.id::text,o.profile_id,o.environment,'calendar_destination_provenance_missing',pg_catalog.encode(extensions.digest(o.id::text||':calendar_destination_provenance_missing','sha256'),'hex') from public.integration_outbox o where o.effect_contract_version=1 and o.command_type in('calendar_create','calendar_cancel') and not(o.payload?'connectionId'and o.payload?'selectionId') on conflict do nothing;
create or replace function public.booking_cutover_enabled(p_profile_id uuid,p_environment text)returns boolean language sql stable security definer set search_path='' as $tag$ select exists(select 1 from public.booking_cutover_state where profile_id=p_profile_id and environment=p_environment and status='enabled' and target_contract_version=2) $tag$;
revoke all on function public.booking_cutover_enabled(uuid,text) from public,anon,authenticated;
grant execute on function public.booking_cutover_enabled(uuid,text) to service_role;
create or replace function public.seed_booking_cutover_state()returns trigger language plpgsql security definer set search_path='' as $tag$
begin insert into public.booking_cutover_state(profile_id,environment)values(new.id,new.environment)on conflict do nothing;return new;end $tag$;
drop trigger if exists profiles_seed_booking_cutover_state on public.profiles;
create trigger profiles_seed_booking_cutover_state after insert on public.profiles for each row execute function public.seed_booking_cutover_state();
-- Legacy v1 rows remain quarantined evidence and must not prevent the closure migration from
-- installing v2 authority. Re-scope the constraints to contract v2; preflight blocks every v1
-- tenant until operations reconciles it, without inventing missing provider/refund/dispute facts.
alter table public.booking_payments drop constraint if exists booking_payments_connected_provider_identity_ck;
alter table public.booking_payments add constraint booking_payments_connected_provider_identity_ck check(booking_contract_version<>2 or connected_account_id is null or stripe_account_id is not null) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_provider_objects_require_account_ck;
alter table public.booking_payments add constraint booking_payments_provider_objects_require_account_ck check(booking_contract_version<>2 or (checkout_session_id is null and payment_intent_id is null and charge_id is null and refund_id is null)or stripe_account_id is not null) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_refund_generation_nonnegative_ck;
alter table public.booking_payments add constraint booking_payments_refund_generation_nonnegative_ck check(booking_contract_version<>2 or refund_generation>=0) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_refund_succeeded_full_ck;
alter table public.booking_payments add constraint booking_payments_refund_succeeded_full_ck check(booking_contract_version<>2 or refund_state<>'succeeded' or amount_refunded_minor=amount_paid_minor) not valid;
alter table public.booking_payments drop constraint if exists booking_payments_dispute_identity_ck;
alter table public.booking_payments add constraint booking_payments_dispute_identity_ck check(booking_contract_version<>2 or dispute_state='none' or dispute_id is not null) not valid;
alter table public.booking_payments validate constraint booking_payments_connected_provider_identity_ck;
alter table public.booking_payments validate constraint booking_payments_provider_objects_require_account_ck;
alter table public.booking_payments validate constraint booking_payments_refund_generation_nonnegative_ck;
alter table public.booking_payments validate constraint booking_payments_refund_succeeded_full_ck;
alter table public.booking_payments validate constraint booking_payments_dispute_identity_ck;

create or replace function public.activate_booking_cutover(p_profile_id uuid,p_environment text,p_preflight_digest text)returns boolean language plpgsql security definer set search_path='' as $tag$
begin
 if p_preflight_digest!~'^[a-f0-9]{64}$'then raise exception 'invalid preflight digest' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':booking-cutover',0));
 insert into public.booking_cutover_state(profile_id,environment)values(p_profile_id,p_environment)on conflict do nothing;
 if exists(select 1 from public.booking_cutover_quarantine where profile_id=p_profile_id and environment=p_environment and resolved_at is null)or exists(select 1 from public.integration_outbox where profile_id=p_profile_id and environment=p_environment and effect_contract_version=1 and state in('pending','processing','failed'))then raise exception 'booking cutover has unresolved blockers' using errcode='P0001';end if;
 update public.booking_cutover_state set status='enabled',target_contract_version=2,preflight_digest=p_preflight_digest,preflight_completed_at=pg_catalog.clock_timestamp(),enabled_at=pg_catalog.clock_timestamp()where profile_id=p_profile_id and environment=p_environment;return found;
end $tag$;
revoke all on function public.seed_booking_cutover_state(),public.activate_booking_cutover(uuid,text,text) from public,anon,authenticated;
grant execute on function public.activate_booking_cutover(uuid,text,text) to service_role;
