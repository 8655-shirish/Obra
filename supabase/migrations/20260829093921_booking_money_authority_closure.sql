-- Forward-only booking money authority closure (items 1-3 and 12-14).
-- Safe runtime defaults are unchanged; this migration does not enable booking.

-- Committed-current cutover evidence -----------------------------------------------
create table public.booking_cutover_preflights_v3(
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 target_contract_version smallint not null check(target_contract_version=2),
 migration_marker text not null,
 inventory jsonb not null,
 inventory_sha256 text not null check(inventory_sha256~'^[a-f0-9]{64}$'),
 captured_xid xid8 not null default pg_current_xact_id(),
 captured_at timestamptz not null default clock_timestamp(),
 unique(id,profile_id,environment),
 foreign key(profile_id,environment)references public.profiles(id,environment)on delete restrict
);
create table public.booking_cutover_preflight_items_v3(
 preflight_id uuid not null references public.booking_cutover_preflights_v3(id)on delete restrict,
 check_key text not null,
 blocker_count bigint not null default 0 check(blocker_count>=0),
 evidence jsonb not null,
 evidence_sha256 text not null check(evidence_sha256~'^[a-f0-9]{64}$'),
 primary key(preflight_id,check_key)
);
alter table public.booking_cutover_preflights_v3 enable row level security;
alter table public.booking_cutover_preflight_items_v3 enable row level security;
revoke all on public.booking_cutover_preflights_v3,public.booking_cutover_preflight_items_v3 from public,anon,authenticated,service_role,booking_worker;

alter table public.booking_cutover_state add column if not exists accepted_preflight_id uuid;
alter table public.booking_cutover_state drop constraint if exists booking_cutover_state_accepted_preflight_fk;
alter table public.booking_cutover_state add constraint booking_cutover_state_accepted_preflight_fk
 foreign key(accepted_preflight_id,profile_id,environment)references public.booking_cutover_preflights_v3(id,profile_id,environment)on delete restrict not valid;
alter table public.booking_cutover_state validate constraint booking_cutover_state_accepted_preflight_fk;
update public.booking_cutover_state set status='blocked',enabled_at=null,accepted_preflight_id=null
 where status='enabled'and accepted_preflight_id is null;
alter table public.booking_cutover_state drop constraint if exists booking_cutover_state_enabled_preflight_ck;
alter table public.booking_cutover_state add constraint booking_cutover_state_enabled_preflight_ck
 check(status<>'enabled'or accepted_preflight_id is not null)not valid;
alter table public.booking_cutover_state validate constraint booking_cutover_state_enabled_preflight_ck;

create or replace function public.guard_booking_contract_version_v3()returns trigger
language plpgsql set search_path=''as $function$
declare old_version smallint;new_version smallint;column_name text;
begin
 column_name:=case when tg_table_name='integration_outbox'then'effect_contract_version'else'booking_contract_version'end;
 new_version:=(pg_catalog.to_jsonb(new)->>column_name)::smallint;
 if tg_op='INSERT'and new_version is distinct from 2 then raise exception'new booking rows require contract version 2'using errcode='23514';end if;
 if tg_op='UPDATE'then
  old_version:=(pg_catalog.to_jsonb(old)->>column_name)::smallint;
  if new_version is distinct from old_version then raise exception'booking contract version is immutable'using errcode='55000';end if;
 end if;
 return new;
end $function$;
create trigger appointments_contract_version_v3 before insert or update on public.appointments for each row execute function public.guard_booking_contract_version_v3();
create trigger booking_payments_contract_version_v3 before insert or update on public.booking_payments for each row execute function public.guard_booking_contract_version_v3();
create trigger integration_outbox_contract_version_v3 before insert or update on public.integration_outbox for each row execute function public.guard_booking_contract_version_v3();

create or replace function public.booking_cutover_inventory_v3(p_profile_id uuid,p_environment text)returns jsonb
language plpgsql stable security definer set search_path=''as $function$
declare
 appointment_inventory jsonb;payment_inventory jsonb;effect_inventory jsonb;quarantine_inventory jsonb;provider_issues jsonb;claim_issues jsonb;authority_acl jsonb;
 blocker_count bigint;
begin
 if p_profile_id is null or p_environment not in('test','live')then raise exception'invalid booking cutover identity'using errcode='22023';end if;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id,'version',a.booking_contract_version,'state',a.appointment_state,'payment',a.payment_state,'refund',a.refund_state)order by a.id),'[]')into appointment_inventory
 from public.appointments a where a.profile_id=p_profile_id and a.environment=p_environment and a.booking_contract_version is distinct from 2;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id,'appointmentId',p.appointment_id,'version',p.booking_contract_version,'payment',p.payment_state,'refund',p.refund_state,'paid',p.amount_paid_minor,'refunded',p.amount_refunded_minor,'account',p.stripe_account_id,'session',p.checkout_session_id,'intent',p.payment_intent_id,'charge',p.charge_id)order by p.id),'[]')into payment_inventory
 from public.booking_payments p where p.profile_id=p_profile_id and p.environment=p_environment and p.booking_contract_version is distinct from 2;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',o.id,'version',o.effect_contract_version,'type',o.command_type,'state',o.state,'lease',o.lease_token,'leaseUntil',o.lease_expires_at)order by o.id),'[]')into effect_inventory
 from public.integration_outbox o where o.profile_id=p_profile_id and o.environment=p_environment and o.effect_contract_version is distinct from 2;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',q.id,'kind',q.entity_kind,'entityId',q.entity_id,'reason',q.reason_code,'hash',q.evidence_hash)order by q.id),'[]')into quarantine_inventory
 from public.booking_cutover_quarantine q where q.profile_id=p_profile_id and q.environment=p_environment and q.resolved_at is null;
 select coalesce(pg_catalog.jsonb_agg(issue order by issue->>'kind',issue->>'id'),'[]')into provider_issues from(
  select pg_catalog.jsonb_build_object('kind','provider_identity','id',p.id,'account',p.stripe_account_id,'session',p.checkout_session_id,'intent',p.payment_intent_id,'charge',p.charge_id)issue
  from public.booking_payments p where p.profile_id=p_profile_id and p.environment=p_environment and p.booking_contract_version=2 and(
   (((p.checkout_session_id is not null)or(p.payment_intent_id is not null)or(p.charge_id is not null)or(p.refund_id is not null))and p.stripe_account_id is null)
   or p.amount_refunded_minor>p.amount_paid_minor
   or(p.refund_state='succeeded'and p.amount_refunded_minor is distinct from p.amount_paid_minor)
   or(p.payment_state in('paid','disputed')and(p.payment_intent_id is null or p.charge_id is null or p.amount_paid_minor is distinct from p.expected_amount_minor))
  )
  union all
  select pg_catalog.jsonb_build_object('kind','contract_mismatch','id',p.id,'paymentVersion',p.booking_contract_version,'appointmentVersion',a.booking_contract_version)
  from public.booking_payments p join public.appointments a on a.id=p.appointment_id and a.profile_id=p.profile_id and a.environment=p.environment
  where p.profile_id=p_profile_id and p.environment=p_environment and p.booking_contract_version is distinct from a.booking_contract_version
 )issues;
 select coalesce(pg_catalog.jsonb_agg(issue order by issue->>'kind',issue->>'id'),'[]')into claim_issues from(
  select pg_catalog.jsonb_build_object('kind','provider_claim','id',i.id)issue from public.provider_event_inbox i
   where i.profile_id=p_profile_id and i.environment=p_environment and i.event_family='booking'and i.processing_state='processing'and i.lease_expires_at>pg_catalog.clock_timestamp()
  union all
  select pg_catalog.jsonb_build_object('kind','outbox_claim','id',o.id)from public.integration_outbox o
   where o.profile_id=p_profile_id and o.environment=p_environment and o.state='processing'and o.lease_expires_at>pg_catalog.clock_timestamp()
 )claims;
 with legacy(signature)as(values
  ('public.transition_appointment(uuid,uuid,text,bigint,text,uuid,text,jsonb)'),
  ('public.apply_provider_appointment_event(uuid,uuid,bigint,uuid,uuid,text,bigint,text,uuid,text,jsonb)'),
  ('public.claim_outbox_command(uuid,uuid,integer)'),
  ('public.complete_outbox_command(uuid,uuid,bigint,boolean,text)'),
  ('public.complete_outbox_appointment_command(uuid,uuid,bigint,uuid,text,text,text,jsonb)'),
  ('public.record_created_booking_checkout(uuid,text,timestamptz)'),
  ('public.apply_booking_payment_event(uuid,uuid,bigint,uuid,text,text,text,bigint,text,boolean)'),
  ('public.apply_booking_money_mirror_event(uuid,uuid,bigint,text,text,bigint,text,text,text,bigint)'),
  ('public.record_booking_refund_provider_result(uuid,bigint,text,text,bigint,bigint)'),
  ('public.ensure_booking_refund_submission(uuid,bigint)'),
  ('public.settle_booking_refund_command(uuid,uuid,bigint,text,text,bigint,bigint)'),
  ('public.complete_booking_outbox(uuid,uuid,bigint,jsonb)'),
  ('public.claim_due_booking_sessions(text,uuid,integer)'),
  ('public.settle_due_booking_session(uuid,uuid,bigint,boolean,boolean,text,text,bigint,text)'),
  ('public.apply_booking_provider_evidence(uuid,uuid,bigint)')
 ),roles(role_name)as(values('service_role'),('booking_worker'))
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('signature',l.signature,'role',r.role_name,'executable',case when pg_catalog.to_regprocedure(l.signature)is null then false else pg_catalog.has_function_privilege(r.role_name,pg_catalog.to_regprocedure(l.signature),'EXECUTE')end)order by l.signature,r.role_name),'[]')into authority_acl
 from legacy l cross join roles r;
 select
  (select count(*)from public.appointments a where a.profile_id=p_profile_id and a.environment=p_environment and(a.booking_contract_version is null or(a.booking_contract_version<>2 and(a.appointment_state in('held','payment_pending','confirmed')or a.payment_state in('creating','pending','paid','disputed')or a.refund_state in('pending','failed')))))+
  (select count(*)from public.booking_payments p where p.profile_id=p_profile_id and p.environment=p_environment and(p.booking_contract_version is null or(p.booking_contract_version<>2 and(p.payment_state in('creating','pending','paid','disputed')or p.refund_state in('pending','failed')or p.amount_paid_minor is distinct from p.amount_refunded_minor))))+
  (select count(*)from public.integration_outbox o where o.profile_id=p_profile_id and o.environment=p_environment and(o.effect_contract_version is null or(o.effect_contract_version<>2 and o.state in('pending','processing','failed'))))+
  pg_catalog.jsonb_array_length(quarantine_inventory)+pg_catalog.jsonb_array_length(provider_issues)+pg_catalog.jsonb_array_length(claim_issues)+
  (select count(*)from pg_catalog.jsonb_array_elements(authority_acl)x where(x->>'executable')::boolean)
 into blocker_count;
 return pg_catalog.jsonb_build_object('migrationMarker','20260829093921_booking_money_authority_closure','profileId',p_profile_id,'environment',p_environment,'targetContractVersion',2,'blockerCount',blocker_count,'legacyOrNullAppointments',appointment_inventory,'legacyOrNullPayments',payment_inventory,'legacyOrNullEffects',effect_inventory,'unresolvedQuarantine',quarantine_inventory,'providerIssues',provider_issues,'activeClaims',claim_issues,'authorityAcl',authority_acl);
end $function$;

create or replace function public.reject_booking_cutover_evidence_mutation_v3()returns trigger language plpgsql set search_path=''as $function$
begin raise exception'booking cutover evidence is immutable'using errcode='55000';end $function$;
create trigger booking_cutover_preflights_v3_immutable before update or delete on public.booking_cutover_preflights_v3 for each row execute function public.reject_booking_cutover_evidence_mutation_v3();
create trigger booking_cutover_preflight_items_v3_immutable before update or delete on public.booking_cutover_preflight_items_v3 for each row execute function public.reject_booking_cutover_evidence_mutation_v3();
create trigger booking_cutover_preflights_v3_no_truncate before truncate on public.booking_cutover_preflights_v3 for each statement execute function public.reject_booking_cutover_evidence_mutation_v3();
create trigger booking_cutover_preflight_items_v3_no_truncate before truncate on public.booking_cutover_preflight_items_v3 for each statement execute function public.reject_booking_cutover_evidence_mutation_v3();

create or replace function public.guard_booking_cutover_state_v3()returns trigger language plpgsql set search_path=''as $function$
begin
 if tg_op='DELETE'then raise exception'booking cutover state cannot be deleted'using errcode='55000';end if;
 if(new.status='enabled'or(tg_op='UPDATE'and(new.accepted_preflight_id is distinct from old.accepted_preflight_id or new.preflight_digest is distinct from old.preflight_digest or new.status is distinct from old.status or new.enabled_at is distinct from old.enabled_at)))and coalesce(pg_catalog.current_setting('obra.booking_cutover_write_v3',true),'')<>'allowed'then raise exception'booking cutover state is RPC-owned'using errcode='55000';end if;
 return new;
end $function$;
drop trigger if exists booking_cutover_state_v3_guard on public.booking_cutover_state;
create trigger booking_cutover_state_v3_guard before update or delete on public.booking_cutover_state for each row execute function public.guard_booking_cutover_state_v3();

create or replace function public.capture_booking_cutover_preflight_v3(p_profile_id uuid,p_environment text)returns uuid
language plpgsql security definer set search_path=''as $function$
declare preflight_id uuid:=gen_random_uuid();inventory jsonb;inventory_digest text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':booking-cutover',0));
 perform pg_catalog.set_config('obra.booking_cutover_write_v3','allowed',true);
 insert into public.booking_cutover_state(profile_id,environment)values(p_profile_id,p_environment)on conflict do nothing;
 update public.booking_cutover_state set status='reconciling',accepted_preflight_id=null,preflight_digest=null,preflight_completed_at=null,enabled_at=null where profile_id=p_profile_id and environment=p_environment;
 inventory:=public.booking_cutover_inventory_v3(p_profile_id,p_environment);
 inventory_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(inventory::text,'UTF8'),'sha256'),'hex');
 insert into public.booking_cutover_preflights_v3(id,profile_id,environment,target_contract_version,migration_marker,inventory,inventory_sha256)
 values(preflight_id,p_profile_id,p_environment,2,'20260829093921_booking_money_authority_closure',inventory,inventory_digest);
 insert into public.booking_cutover_preflight_items_v3(preflight_id,check_key,blocker_count,evidence,evidence_sha256)
 select preflight_id,e.key,case when e.key='blockerCount'then(e.value#>>'{}')::bigint when pg_catalog.jsonb_typeof(e.value)='array'then pg_catalog.jsonb_array_length(e.value)else 0 end,e.value,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.length(e.key)::text||':'||e.key||':'||e.value::text,'UTF8'),'sha256'),'hex')from pg_catalog.jsonb_each(inventory)e;
 update public.booking_cutover_state s set accepted_preflight_id=p.id,preflight_digest=p.inventory_sha256,preflight_completed_at=p.captured_at
 from public.booking_cutover_preflights_v3 p where p.id=preflight_id and s.profile_id=p.profile_id and s.environment=p.environment and s.status='reconciling'and s.accepted_preflight_id is null;
 if not found then raise exception 'booking cutover preflight could not be attached' using errcode='40001';end if;
 perform pg_catalog.set_config('obra.booking_cutover_write_v3','',true);
 return preflight_id;
end $function$;

create or replace function public.activate_booking_cutover_v3(p_preflight_id uuid)returns boolean
language plpgsql security definer set search_path=''as $function$
declare preflight public.booking_cutover_preflights_v3%rowtype;inventory jsonb;inventory_digest text;
begin
 select*into strict preflight from public.booking_cutover_preflights_v3 where id=p_preflight_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(preflight.profile_id::text||':'||preflight.environment||':booking-cutover',0));
 select*into strict preflight from public.booking_cutover_preflights_v3 where id=p_preflight_id for share;
 if preflight.captured_xid=pg_catalog.pg_current_xact_id()then raise exception'booking cutover preflight must commit before activation'using errcode='25001';end if;
 inventory:=public.booking_cutover_inventory_v3(preflight.profile_id,preflight.environment);
 inventory_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(inventory::text,'UTF8'),'sha256'),'hex');
 if preflight.migration_marker<>'20260829093921_booking_money_authority_closure'or preflight.target_contract_version<>2 or preflight.inventory_sha256<>inventory_digest or preflight.inventory<>inventory then raise exception'booking cutover preflight is stale'using errcode='40001';end if;
 if coalesce((inventory->>'blockerCount')::bigint,-1)<>0 then raise exception'booking cutover preflight has blockers'using errcode='P0001';end if;
 perform pg_catalog.set_config('obra.booking_cutover_write_v3','allowed',true);
 update public.booking_cutover_state set status='enabled',target_contract_version=2,accepted_preflight_id=preflight.id,preflight_digest=preflight.inventory_sha256,preflight_completed_at=preflight.captured_at,enabled_at=pg_catalog.clock_timestamp()
 where profile_id=preflight.profile_id and environment=preflight.environment and status='reconciling'and accepted_preflight_id is null;
 if not found then raise exception'booking cutover is not frozen'using errcode='40001';end if;
 perform pg_catalog.set_config('obra.booking_cutover_write_v3','',true);
 return true;
end $function$;

create or replace function public.booking_cutover_enabled(p_profile_id uuid,p_environment text)returns boolean
language sql stable security definer set search_path=''as $function$
 select exists(select 1 from public.booking_cutover_state s join public.booking_cutover_preflights_v3 p on p.id=s.accepted_preflight_id and p.profile_id=s.profile_id and p.environment=s.environment where s.profile_id=p_profile_id and s.environment=p_environment and s.status='enabled'and s.target_contract_version=2 and s.preflight_digest=p.inventory_sha256 and p.migration_marker='20260829093921_booking_money_authority_closure')
$function$;
create or replace function public.activate_booking_cutover(p_profile_id uuid,p_environment text,p_preflight_digest text)returns boolean
language plpgsql security definer set search_path=''as $function$
begin raise exception'legacy cutover activation is retired'using errcode='0A000';end $function$;

-- Immutable causal Stripe observations ---------------------------------------------
alter table public.booking_provider_evidence drop constraint if exists booking_provider_evidence_event_id_fkey;
alter table public.booking_provider_evidence add constraint booking_provider_evidence_event_id_fkey foreign key(event_id)references public.provider_event_inbox(id)on delete restrict;
create table public.booking_stripe_observations_v3(
 id uuid primary key default gen_random_uuid(),
 authority_kind text not null check(authority_kind in('stripe_event','refund_command','session_expiry')),
 authority_id uuid not null,
 event_id uuid references public.provider_event_inbox(id)on delete restrict,
 command_id uuid references public.integration_outbox(id)on delete restrict,
 payment_id uuid not null references public.booking_payments(id)on delete restrict,
 appointment_id uuid not null references public.appointments(id)on delete restrict,
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 stripe_account_id text not null,
 provider_event_id text,
 event_type text,
 provider_created bigint not null default 0 check(provider_created>=0),
 checkout_session_id text,
 payment_intent_id text,
 charge_id text,
 cumulative_refunded_minor bigint check(cumulative_refunded_minor>=0),
 envelope_sha256 text,
 snapshot_sha256 text not null check(snapshot_sha256~'^[a-f0-9]{64}$'),
 provider_snapshot jsonb not null,
 reduction_outcome text not null,
 observed_at timestamptz not null default clock_timestamp(),
 check((authority_kind='stripe_event'and event_id=authority_id and command_id is null)or(authority_kind='refund_command'and command_id=authority_id and event_id is null)or(authority_kind='session_expiry'and payment_id=authority_id and event_id is null and command_id is null)),
 unique(authority_kind,authority_id,snapshot_sha256,reduction_outcome),
 foreign key(appointment_id,profile_id,environment)references public.appointments(id,profile_id,environment)on delete restrict
);
create unique index booking_stripe_observations_v3_event_uq on public.booking_stripe_observations_v3(event_id)where event_id is not null;
create table public.booking_stripe_refund_observations_v3(
 observation_id uuid not null references public.booking_stripe_observations_v3(id)on delete restrict,
 stripe_refund_id text not null,
 stripe_charge_id text not null,
 payment_intent_id text not null,
 status text not null check(status in('pending','requires_action','succeeded','failed','canceled')),
 amount_minor bigint not null check(amount_minor>0),
 currency text not null check(currency~'^[A-Z]{3}$'),
 provider_created bigint not null check(provider_created>0),
 metadata jsonb not null default'{}',
 primary key(observation_id,stripe_refund_id)
);
alter table public.booking_stripe_observations_v3 enable row level security;
alter table public.booking_stripe_refund_observations_v3 enable row level security;
revoke all on public.booking_stripe_observations_v3,public.booking_stripe_refund_observations_v3 from public,anon,authenticated,service_role,booking_worker;

alter table public.booking_refunds add column if not exists settled_by_external boolean not null default false;
alter table public.booking_refunds drop constraint if exists booking_refunds_state_check;
update public.booking_refunds set state='canceled'where state='cancelled';
alter table public.booking_refunds add constraint booking_refunds_state_check check(state in('pending','requires_action','succeeded','failed','canceled'));
create unique index if not exists booking_payments_refund_correlation_uq on public.booking_payments(id,appointment_id,profile_id,environment,stripe_account_id,payment_intent_id);
-- A separately committed preflight migration persists inconsistent refund identities.
-- Never invent correlation; abort authority cutover while durable unresolved evidence remains.
do $refund_correlation$ begin if exists(select 1 from public.booking_cutover_quarantine q where q.entity_kind='booking_refund'and q.reason_code='refund_payment_correlation_mismatch'and q.resolved_at is null)then raise exception 'resolve quarantined refund/payment correlation before money closure' using errcode='P0001';end if;end $refund_correlation$;
alter table public.booking_refunds add constraint booking_refunds_payment_correlation_fk foreign key(payment_id,appointment_id,profile_id,environment,stripe_account_id,payment_intent_id)references public.booking_payments(id,appointment_id,profile_id,environment,stripe_account_id,payment_intent_id)on delete restrict not valid;
alter table public.booking_refunds validate constraint booking_refunds_payment_correlation_fk;
alter table public.booking_payments add column if not exists financial_provider_created bigint not null default 0,add column if not exists financial_event_rank integer not null default 0,add column if not exists financial_provider_event_id text;

create or replace function public.reject_booking_stripe_evidence_mutation_v3()returns trigger language plpgsql set search_path=''as $function$
begin raise exception'booking Stripe evidence is immutable'using errcode='55000';end $function$;
create or replace function public.guard_booking_stripe_inbox_envelope_v3()returns trigger language plpgsql set search_path=''as $function$
begin
 if tg_op='DELETE'then if old.provider='stripe'and old.event_family='booking'then raise exception'booking Stripe envelope is immutable'using errcode='55000';end if;return old;end if;
 if old.provider='stripe'and old.event_family='booking'and(new.provider is distinct from old.provider or new.event_family is distinct from old.event_family or new.event_id is distinct from old.event_id or new.account_context is distinct from old.account_context or new.destination is distinct from old.destination or new.api_version is distinct from old.api_version or new.livemode is distinct from old.livemode or new.environment is distinct from old.environment or new.profile_id is distinct from old.profile_id or new.event_type is distinct from old.event_type or new.payload_hash is distinct from old.payload_hash or new.payload is distinct from old.payload or new.signature_timestamp is distinct from old.signature_timestamp or new.received_at is distinct from old.received_at)then raise exception'booking Stripe envelope is immutable'using errcode='55000';end if;
 return new;
end $function$;
create or replace function public.reject_provider_inbox_truncate_v3()returns trigger language plpgsql set search_path=''as $function$
begin raise exception'provider inbox cannot be truncated'using errcode='55000';end $function$;
create trigger provider_event_inbox_booking_stripe_envelope_v3 before update or delete on public.provider_event_inbox for each row execute function public.guard_booking_stripe_inbox_envelope_v3();
create trigger provider_event_inbox_no_truncate_v3 before truncate on public.provider_event_inbox for each statement execute function public.reject_provider_inbox_truncate_v3();
create trigger booking_provider_evidence_immutable_v3 before update or delete on public.booking_provider_evidence for each row execute function public.reject_booking_stripe_evidence_mutation_v3();
create trigger booking_provider_evidence_no_truncate_v3 before truncate on public.booking_provider_evidence for each statement execute function public.reject_booking_stripe_evidence_mutation_v3();
create trigger booking_stripe_observations_v3_immutable before update or delete on public.booking_stripe_observations_v3 for each row execute function public.reject_booking_stripe_evidence_mutation_v3();
create trigger booking_stripe_observations_v3_no_truncate before truncate on public.booking_stripe_observations_v3 for each statement execute function public.reject_booking_stripe_evidence_mutation_v3();
create trigger booking_stripe_refund_observations_v3_immutable before update or delete on public.booking_stripe_refund_observations_v3 for each row execute function public.reject_booking_stripe_evidence_mutation_v3();
create trigger booking_stripe_refund_observations_v3_no_truncate before truncate on public.booking_stripe_refund_observations_v3 for each statement execute function public.reject_booking_stripe_evidence_mutation_v3();

-- Reducer-only financial mutation guards. The reducer owns an unguessable transaction-local
-- token; legacy SECURITY DEFINER bodies cannot opt themselves through by reusing a boolean flag.
create or replace function public.booking_financial_guard_token_v3()returns text
language sql stable security definer set search_path=''as $function$
 select pg_catalog.current_setting('obra.booking_financial_guard_token_v3',true)
$function$;
create or replace function public.guard_booking_financial_truth_v3()returns trigger language plpgsql set search_path=''as $function$
declare protected_change boolean:=false;
begin
 if tg_table_name='booking_payments'then
  protected_change:=new.payment_intent_id is distinct from old.payment_intent_id or new.charge_id is distinct from old.charge_id or new.refund_id is distinct from old.refund_id or new.amount_paid_minor is distinct from old.amount_paid_minor or new.amount_refunded_minor is distinct from old.amount_refunded_minor or new.paid_at is distinct from old.paid_at or new.refunded_at is distinct from old.refunded_at or new.dispute_state is distinct from old.dispute_state or new.dispute_id is distinct from old.dispute_id or new.financial_provider_created is distinct from old.financial_provider_created or new.financial_event_rank is distinct from old.financial_event_rank or new.financial_provider_event_id is distinct from old.financial_provider_event_id or(new.payment_state is distinct from old.payment_state and(new.payment_state in('paid','disputed')or old.payment_state in('paid','disputed')))or(new.refund_state is distinct from old.refund_state and(new.refund_state in('succeeded','failed')or old.refund_state in('succeeded','failed')));
 elsif tg_table_name='appointments'then
  protected_change:=(new.payment_state is distinct from old.payment_state and(new.payment_state in('paid','disputed')or old.payment_state in('paid','disputed')))or(new.refund_state is distinct from old.refund_state and(new.refund_state in('succeeded','failed')or old.refund_state in('succeeded','failed')));
 elsif tg_table_name='integration_outbox'then
  protected_change:=old.command_type='refund'and((new.state is distinct from old.state and new.state in('succeeded','dead_letter'))or new.terminal_at is distinct from old.terminal_at);
 end if;
 if protected_change and coalesce(pg_catalog.current_setting('obra.booking_financial_reducer_v3',true),'') is distinct from public.booking_financial_guard_token_v3()then raise exception'booking financial truth is reducer-owned'using errcode='55000';end if;
 return new;
end $function$;
create or replace function public.guard_booking_refund_ledger_v3()returns trigger language plpgsql set search_path=''as $function$
begin
 if coalesce(pg_catalog.current_setting('obra.booking_financial_reducer_v3',true),'') is distinct from public.booking_financial_guard_token_v3()then raise exception'booking refund ledger is reducer-owned'using errcode='55000';end if;
 return case when tg_op='DELETE'then old else new end;
end $function$;
create trigger booking_payments_financial_truth_v3 before update on public.booking_payments for each row execute function public.guard_booking_financial_truth_v3();
create trigger appointments_financial_truth_v3 before update on public.appointments for each row execute function public.guard_booking_financial_truth_v3();
create trigger integration_outbox_financial_truth_v3 before update on public.integration_outbox for each row execute function public.guard_booking_financial_truth_v3();
create trigger booking_refunds_financial_truth_v3 before insert or update or delete on public.booking_refunds for each row execute function public.guard_booking_refund_ledger_v3();

create or replace function public.validate_booking_refund_snapshot_v3(p_refunds jsonb,p_charge_id text,p_intent_id text,p_currency text,p_paid_minor bigint)returns void
language plpgsql immutable security definer set search_path=''as $function$
begin
 if pg_catalog.jsonb_typeof(p_refunds)<>'array'or exists(select 1 from pg_catalog.jsonb_array_elements(p_refunds)x where x->>'object'is distinct from'refund'or nullif(x->>'id','')is null or x->>'charge'is distinct from p_charge_id or x->>'payment_intent'is distinct from p_intent_id or coalesce((x->>'amount')::bigint,0)<=0 or(x->>'amount')::bigint>p_paid_minor or pg_catalog.upper(coalesce(x->>'currency',''))is distinct from p_currency or coalesce((x->>'created')::bigint,0)<=0 or x->>'status'not in('pending','requires_action','succeeded','failed','canceled'))then raise exception'invalid or cross-object refund snapshot'using errcode='P0001';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_refunds)x group by x->>'id'having count(*)>1)then raise exception'duplicate refund in complete snapshot'using errcode='P0001';end if;
end $function$;

-- Every relevant writer shares the same tenant cutover lock, closing capture/activation races.
create or replace function public.lock_booking_cutover_writer_v3()returns trigger language plpgsql set search_path=''as $function$
declare profile_identity uuid;environment_identity text;
begin
 profile_identity:=case when tg_op='DELETE'then old.profile_id else new.profile_id end;
 environment_identity:=case when tg_op='DELETE'then old.environment else new.environment end;
 if tg_table_name='provider_event_inbox'and(case when tg_op='DELETE'then pg_catalog.to_jsonb(old)->>'event_family'else pg_catalog.to_jsonb(new)->>'event_family'end)<>'booking'then return case when tg_op='DELETE'then old else new end;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(profile_identity::text||':'||environment_identity||':booking-cutover',0));
 return case when tg_op='DELETE'then old else new end;
end $function$;
create trigger appointments_cutover_writer_v3 before insert or update or delete on public.appointments for each row execute function public.lock_booking_cutover_writer_v3();
create trigger booking_payments_cutover_writer_v3 before insert or update or delete on public.booking_payments for each row execute function public.lock_booking_cutover_writer_v3();
create trigger integration_outbox_cutover_writer_v3 before insert or update or delete on public.integration_outbox for each row execute function public.lock_booking_cutover_writer_v3();
create trigger provider_event_inbox_cutover_writer_v3 before insert or update or delete on public.provider_event_inbox for each row execute function public.lock_booking_cutover_writer_v3();

create or replace function public.claim_due_booking_payment_events(p_environment text,p_lease_token uuid,p_limit integer default 25)returns setof public.provider_event_inbox
language plpgsql security definer set search_path=''as $function$
begin
 if p_lease_token is null or p_environment not in('test','live')then raise exception'invalid booking event claim'using errcode='22023';end if;
 return query with due as(
  select i.id from public.provider_event_inbox i where i.provider='stripe'and i.event_family='booking'and i.environment=p_environment and i.profile_id is not null and public.booking_cutover_enabled(i.profile_id,i.environment)and i.processing_state in('pending','processing','failed')and i.next_attempt_at<=pg_catalog.clock_timestamp()and(i.lease_expires_at is null or i.lease_expires_at<=pg_catalog.clock_timestamp())order by i.received_at,i.id for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
 )update public.provider_event_inbox i set processing_state='processing',attempts=i.attempts+1,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval'2 minutes',fencing_token=i.fencing_token+1 from due where i.id=due.id returning i.*;
end $function$;

create or replace function public.claim_due_booking_outbox(p_lease_token uuid,p_limit integer default 25)returns setof public.integration_outbox
language plpgsql security definer set search_path=''as $function$
begin
 if p_lease_token is null then raise exception'lease required'using errcode='22023';end if;
 return query with due as(
  select o.id from public.integration_outbox o join public.appointments a on a.id=o.appointment_id and a.profile_id=o.profile_id and a.environment=o.environment join public.booking_payments p on p.appointment_id=a.id and p.profile_id=a.profile_id and p.environment=a.environment
  where o.effect_contract_version=2 and a.booking_contract_version=2 and p.booking_contract_version=2 and public.booking_cutover_enabled(o.profile_id,o.environment)and o.command_type in('calendar_create','calendar_cancel','refund')and o.state in('pending','failed','processing')and o.terminal_at is null and o.next_attempt_at<=pg_catalog.clock_timestamp()and(o.lease_expires_at is null or o.lease_expires_at<=pg_catalog.clock_timestamp())and(
   (o.command_type='calendar_create'and o.effect_generation=a.calendar_generation and a.calendar_state='create_pending'and a.appointment_state='confirmed'and o.payload?'connectionId'and o.payload?'selectionId')or
   (o.command_type='calendar_cancel'and o.effect_generation=a.calendar_generation and a.calendar_state='cancel_pending'and a.appointment_state='cancelled'and o.payload?'connectionId'and o.payload?'selectionId')or
   (o.command_type='refund'and o.effect_generation=a.refund_generation and o.effect_generation=p.refund_generation and a.refund_state='pending'and p.refund_state='pending'and p.amount_paid_minor>p.amount_refunded_minor)
  )order by o.next_attempt_at,o.id for update of o skip locked limit greatest(1,least(coalesce(p_limit,25),100))
 )update public.integration_outbox o set state='processing',attempts=o.attempts+1,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval'2 minutes',fencing_token=o.fencing_token+1 from due where o.id=due.id returning o.*;
end $function$;

-- Sole booking money reducer --------------------------------------------------------
create or replace function public.reduce_booking_financial_evidence_v3(
 p_authority_kind text,p_authority_id uuid,p_lease_token uuid,p_fencing_token bigint,p_provider_snapshot jsonb default'{}'
)returns jsonb language plpgsql security definer set search_path=''as $function$
#variable_conflict use_variable
declare
 inbox public.provider_event_inbox%rowtype;command public.integration_outbox%rowtype;payment public.booking_payments%rowtype;appointment public.appointments%rowtype;refund_row public.booking_refunds%rowtype;
 checkout jsonb:=p_provider_snapshot->'checkout';intent jsonb:=p_provider_snapshot->'paymentIntent';charge jsonb:=p_provider_snapshot->'charge';refunds jsonb:=coalesce(p_provider_snapshot->'refunds','[]');event_object jsonb;refund_item jsonb;
 account_id text:=p_provider_snapshot->>'stripeAccountId';event_type text;provider_event_id text;provider_object_id text;session_id text;intent_id text;charge_id text;outcome text;refund_id text;refund_status text;dispute_status text;
 provider_created bigint:=0;cumulative_refunded bigint:=0;succeeded_refund_sum bigint:=0;remaining_amount bigint;refund_generation bigint;refund_created bigint;match_count integer:=0;event_rank integer:=0;
 observation_id uuid;snapshot_sha text;envelope_sha text;now_at timestamptz:=pg_catalog.clock_timestamp();refunded_at_value timestamptz;result jsonb;guard_token text:=pg_catalog.gen_random_uuid()::text;appointment_identity uuid;
begin
 if p_authority_kind not in('stripe_event','refund_command','session_expiry')or p_authority_id is null or p_lease_token is null then raise exception'invalid booking financial authority'using errcode='22023';end if;
 if p_provider_snapshot is null or pg_catalog.jsonb_typeof(p_provider_snapshot)<>'object'or nullif(account_id,'')is null or(p_provider_snapshot->>'refundsHasMore')is distinct from'false'then raise exception'complete connected-account Stripe snapshot required'using errcode='22023';end if;
 if pg_catalog.jsonb_typeof(refunds)<>'array'then raise exception'refund list must be complete'using errcode='22023';end if;
 session_id:=nullif(checkout->>'id','');intent_id:=nullif(intent->>'id','');charge_id:=nullif(charge->>'id','');
 if p_authority_kind='session_expiry'then
  select p.appointment_id into strict appointment_identity from public.booking_payments p where p.id=p_authority_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_identity::text||':booking-appointment',0));
  select p.*into strict payment from public.booking_payments p where p.id=p_authority_id and p.booking_contract_version=2 and p.checkout_lease_token=p_lease_token and p.checkout_fencing_token=p_fencing_token and p.checkout_lease_expires_at>pg_catalog.clock_timestamp()and p.stripe_account_id=account_id for update;
  select a.*into strict appointment from public.appointments a where a.id=payment.appointment_id and a.profile_id=payment.profile_id and a.environment=payment.environment and a.booking_contract_version=2 for update;
  if not public.booking_cutover_enabled(payment.profile_id,payment.environment)or session_id is distinct from payment.checkout_session_id or checkout->>'object'is distinct from'checkout.session'or checkout->'metadata'->>'kind'is distinct from'booking'or checkout->'metadata'->>'appointmentId'is distinct from appointment.id::text or checkout->'metadata'->>'profileId'is distinct from payment.profile_id::text or checkout->'metadata'->>'environment'is distinct from payment.environment or (checkout->>'livemode')::boolean is distinct from(payment.environment='live')or coalesce((checkout->>'amount_total')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(checkout->>'currency',''))<>payment.currency then raise exception'Checkout expiry correlation mismatch'using errcode='P0001';end if;
  if intent_id is not null then
   if checkout->>'payment_intent'is distinct from intent_id or intent->>'object'is distinct from'payment_intent'or intent->'metadata'->>'kind'is distinct from'booking'or intent->'metadata'->>'appointmentId'is distinct from appointment.id::text or coalesce((intent->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(intent->>'currency',''))<>payment.currency or(intent->>'livemode')::boolean is distinct from(payment.environment='live')then raise exception'PaymentIntent expiry correlation mismatch'using errcode='P0001';end if;
   if intent->>'status'='succeeded'then
    charge_id:=nullif(charge->>'id','');if charge_id is null or charge->>'object'is distinct from'charge'or charge->>'payment_intent'is distinct from intent_id or coalesce((charge->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(charge->>'currency',''))<>payment.currency or(charge->>'livemode')::boolean is distinct from(payment.environment='live')then raise exception'Charge expiry correlation mismatch'using errcode='P0001';end if;
    perform public.validate_booking_refund_snapshot_v3(refunds,charge_id,intent_id,payment.currency,payment.expected_amount_minor);
    select coalesce((charge->>'amount_refunded')::bigint,-1),coalesce(sum((x->>'amount')::bigint)filter(where x->>'status'='succeeded'),0)into cumulative_refunded,succeeded_refund_sum from pg_catalog.jsonb_array_elements(refunds)x;
    if not coalesce((charge->>'paid')::boolean,false)or cumulative_refunded<0 or succeeded_refund_sum<>cumulative_refunded then raise exception'Paid expiry snapshot mismatch'using errcode='P0001';end if;
    perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
    update public.booking_payments bp set payment_intent_id=intent_id,charge_id=charge_id,payment_state='paid',amount_paid_minor=bp.expected_amount_minor,amount_refunded_minor=cumulative_refunded,paid_at=coalesce(bp.paid_at,now_at),checkout_lease_token=null,checkout_lease_expires_at=null,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.*into payment;
    update public.appointments a set appointment_state='cancelled',appointment_reason='late_payment_arbitration',payment_state='paid',refund_state='not_requested',review_state='late_payment',reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.*into appointment;outcome:='expiry_paid_arbitration_required';
   elsif checkout->>'status'='expired'and checkout->>'payment_status'='unpaid'and intent->>'status'in('requires_payment_method','canceled')and pg_catalog.jsonb_array_length(refunds)=0 then
    if charge_id is not null and(charge->>'object'is distinct from'charge'or charge->>'payment_intent'is distinct from intent_id or coalesce((charge->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(charge->>'currency',''))<>payment.currency or(charge->>'livemode')::boolean is distinct from(payment.environment='live')or coalesce((charge->>'paid')::boolean,false)or coalesce((charge->>'amount_refunded')::bigint,-1)<>0)then raise exception'Failed Charge expiry correlation mismatch'using errcode='P0001';end if;
    cumulative_refunded:=0;
    perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
    update public.booking_payments bp set payment_intent_id=intent_id,charge_id=nullif(charge->>'id',''),payment_state='failed',failed_at=coalesce(bp.failed_at,now_at),checkout_lease_token=null,checkout_lease_expires_at=null,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id and bp.payment_state<>'paid';
    update public.appointments a set appointment_state='cancelled',appointment_reason='payment_expired',payment_state='failed',cancelled_at=coalesce(a.cancelled_at,now_at),reservation_expires_at=null,version=a.version+1,updated_at=now_at where a.id=appointment.id and a.appointment_state='payment_pending'and a.payment_state<>'paid';outcome:='expiry_unpaid_payment_intent_released';
   else raise exception'Checkout expiry snapshot is not terminal'using errcode='40001';end if;
  elsif checkout->>'status'='expired'and checkout->>'payment_status'='unpaid'then
   perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
   update public.booking_payments bp set payment_state='failed',failed_at=coalesce(bp.failed_at,now_at),checkout_lease_token=null,checkout_lease_expires_at=null,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id and bp.payment_state<>'paid';
   update public.appointments a set appointment_state='cancelled',appointment_reason='payment_expired',payment_state='failed',cancelled_at=coalesce(a.cancelled_at,now_at),reservation_expires_at=null,version=a.version+1,updated_at=now_at where a.id=appointment.id and a.appointment_state='payment_pending'and a.payment_state<>'paid';outcome:='expiry_unpaid_released';
  else raise exception'Checkout expiry snapshot is not terminal'using errcode='40001';end if;
  insert into public.booking_stripe_observations_v3(authority_kind,authority_id,payment_id,appointment_id,profile_id,environment,stripe_account_id,provider_created,checkout_session_id,payment_intent_id,charge_id,cumulative_refunded_minor,snapshot_sha256,provider_snapshot,reduction_outcome)values('session_expiry',payment.id,payment.id,payment.appointment_id,payment.profile_id,payment.environment,account_id,0,session_id,intent_id,charge_id,case when charge_id is null then null else cumulative_refunded end,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_provider_snapshot::text,'UTF8'),'sha256'),'hex'),p_provider_snapshot,outcome)on conflict(authority_kind,authority_id,snapshot_sha256,reduction_outcome)do nothing returning id into observation_id;
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
  return pg_catalog.jsonb_build_object('action','settled','outcome',outcome);
 end if;
 snapshot_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_provider_snapshot::text,'UTF8'),'sha256'),'hex');
 if p_authority_kind='stripe_event'then
  select*into strict inbox from public.provider_event_inbox where id=p_authority_id and provider='stripe'and event_family='booking'and processing_state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp()for update;
  if not public.booking_cutover_enabled(inbox.profile_id,inbox.environment)then raise exception'booking cutover is not enabled'using errcode='P0001';end if;
  if inbox.account_context is distinct from account_id or inbox.destination is distinct from'obra-connect-webhook'or nullif(inbox.api_version,'')is null or inbox.payload->>'id'is distinct from inbox.event_id or inbox.payload->>'type'is distinct from inbox.event_type or(inbox.payload->>'livemode')::boolean is distinct from inbox.livemode or inbox.livemode is distinct from(inbox.environment='live')then raise exception'immutable Stripe envelope mismatch'using errcode='22023';end if;
  event_type:=inbox.event_type;provider_event_id:=inbox.event_id;provider_created:=coalesce((inbox.payload->>'created')::bigint,0);event_object:=inbox.payload->'data'->'object';provider_object_id:=nullif(event_object->>'id','');envelope_sha:=inbox.payload_hash;
  if provider_created<=0 or provider_object_id is null then raise exception'invalid Stripe event causal identity'using errcode='22023';end if;
  if event_type like'checkout.session.%'then
   if session_id is distinct from provider_object_id or checkout->>'object'is distinct from'checkout.session'or checkout->'metadata'->>'kind'is distinct from'booking'or checkout->'metadata'->>'profileId'is distinct from inbox.profile_id::text or checkout->'metadata'->>'environment'is distinct from inbox.environment or nullif(checkout->'metadata'->>'appointmentId','')is null or event_object->'metadata'->>'kind'is distinct from'booking'or event_object->'metadata'->>'appointmentId'is distinct from checkout->'metadata'->>'appointmentId'or event_object->'metadata'->>'profileId'is distinct from checkout->'metadata'->>'profileId'or event_object->'metadata'->>'environment'is distinct from checkout->'metadata'->>'environment'then raise exception'Checkout metadata correlation mismatch'using errcode='P0001';end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((checkout->'metadata'->>'appointmentId')||':booking-appointment',0));
   select p.*into strict payment from public.booking_payments p where p.appointment_id=(checkout->'metadata'->>'appointmentId')::uuid and p.profile_id=inbox.profile_id and p.environment=inbox.environment and p.booking_contract_version=2 and p.stripe_account_id=account_id and p.checkout_session_id=session_id for update;
  elsif event_type in('payment_intent.succeeded','payment_intent.payment_failed')then
   if intent_id is distinct from provider_object_id then raise exception'PaymentIntent event object mismatch'using errcode='P0001';end if;
   if intent->>'object'is distinct from'payment_intent'or intent->'metadata'->>'kind'is distinct from'booking'or nullif(intent->'metadata'->>'appointmentId','')is null then raise exception'PaymentIntent metadata correlation mismatch'using errcode='P0001';end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((intent->'metadata'->>'appointmentId')||':booking-appointment',0));
   select p.*into strict payment from public.booking_payments p where p.appointment_id=(intent->'metadata'->>'appointmentId')::uuid and p.profile_id=inbox.profile_id and p.environment=inbox.environment and p.booking_contract_version=2 and p.stripe_account_id=account_id and(p.payment_intent_id is null or p.payment_intent_id=intent_id)for update;
  elsif event_type in('charge.refunded','refund.updated','charge.dispute.created','charge.dispute.updated','charge.dispute.closed')then
   if intent->>'object'is distinct from'payment_intent'or intent->'metadata'->>'kind'is distinct from'booking'or nullif(intent->'metadata'->>'appointmentId','')is null then raise exception'PaymentIntent metadata correlation mismatch'using errcode='P0001';end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((intent->'metadata'->>'appointmentId')||':booking-appointment',0));
   select p.*into strict payment from public.booking_payments p where p.appointment_id=(intent->'metadata'->>'appointmentId')::uuid and p.profile_id=inbox.profile_id and p.environment=inbox.environment and p.booking_contract_version=2 and p.stripe_account_id=account_id and p.payment_intent_id=intent_id for update;
  else raise exception'unsupported booking Stripe event type'using errcode='22023';
  end if;
  select a.*into strict appointment from public.appointments a where a.id=payment.appointment_id and a.profile_id=payment.profile_id and a.environment=payment.environment and a.booking_contract_version=2 for update;
  if session_id is not null and(checkout->>'livemode')::boolean is distinct from(payment.environment='live')or intent_id is not null and(intent->>'livemode')::boolean is distinct from(payment.environment='live')or charge_id is not null and(charge->>'livemode')::boolean is distinct from(payment.environment='live')then raise exception'Stripe snapshot environment mismatch'using errcode='P0001';end if;

  if intent_id is null then
   if event_type not in('checkout.session.async_payment_failed','checkout.session.expired')or session_id is null or payment.payment_state='paid'or checkout->>'object'is distinct from'checkout.session'or coalesce((checkout->>'amount_total')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(checkout->>'currency',''))<>payment.currency or checkout->>'payment_intent'is not null then raise exception'PaymentIntent binding mismatch'using errcode='P0001';end if;
  elsif intent->>'object'is distinct from'payment_intent'or intent->'metadata'->>'kind'is distinct from'booking'or intent->'metadata'->>'appointmentId'is distinct from appointment.id::text or coalesce((intent->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(intent->>'currency',''))<>payment.currency or(payment.payment_intent_id is not null and payment.payment_intent_id<>intent_id)then raise exception'PaymentIntent binding mismatch'using errcode='P0001';end if;
  if session_id is not null and(coalesce((checkout->>'amount_total')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(checkout->>'currency',''))<>payment.currency or checkout->>'payment_intent'is distinct from intent_id or(payment.checkout_session_id is not null and payment.checkout_session_id<>session_id))then raise exception'Checkout binding mismatch'using errcode='P0001';end if;
  if charge_id is not null then
   if charge->>'object'is distinct from'charge'or charge->>'payment_intent'is distinct from intent_id or coalesce((charge->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(charge->>'currency',''))<>payment.currency or(payment.charge_id is not null and payment.charge_id<>charge_id)then raise exception'Charge binding mismatch'using errcode='P0001';end if;
   perform public.validate_booking_refund_snapshot_v3(refunds,charge_id,intent_id,payment.currency,payment.expected_amount_minor);
   select coalesce((charge->>'amount_refunded')::bigint,-1),coalesce(sum((x->>'amount')::bigint)filter(where x->>'status'='succeeded'),0),max(pg_catalog.to_timestamp((x->>'created')::bigint))filter(where x->>'status'='succeeded')into cumulative_refunded,succeeded_refund_sum,refunded_at_value from pg_catalog.jsonb_array_elements(refunds)x;
   if cumulative_refunded<0 or cumulative_refunded>payment.expected_amount_minor or succeeded_refund_sum<>cumulative_refunded or cumulative_refunded<payment.amount_refunded_minor then raise exception'non-causal or incomplete refund snapshot'using errcode='P0001';end if;
  elsif pg_catalog.jsonb_array_length(refunds)<>0 then raise exception'refund evidence requires Charge identity'using errcode='P0001';
  end if;

  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
  if intent->>'status'='succeeded'and charge_id is not null and coalesce((charge->>'paid')::boolean,false)then
   if event_type='charge.refunded'and provider_object_id<>charge_id then raise exception'charge.refunded object mismatch'using errcode='P0001';end if;
   if event_type='refund.updated'and not exists(select 1 from pg_catalog.jsonb_array_elements(refunds)x where x->>'id'=provider_object_id and x->>'charge'=charge_id and x->>'payment_intent'=intent_id)then raise exception'refund.updated object mismatch'using errcode='P0001';end if;
   if event_type like'charge.dispute.%'and event_object->>'charge'is distinct from charge_id then raise exception'dispute object mismatch'using errcode='P0001';end if;
   update public.booking_payments bp set checkout_session_id=coalesce(bp.checkout_session_id,session_id),payment_intent_id=intent_id,charge_id=reduce_booking_financial_evidence_v3.charge_id,payment_state='paid',amount_paid_minor=bp.expected_amount_minor,amount_refunded_minor=cumulative_refunded,refund_state=case when cumulative_refunded>=bp.expected_amount_minor then'succeeded'when cumulative_refunded>0 then'pending'else bp.refund_state end,paid_at=coalesce(bp.paid_at,pg_catalog.to_timestamp(provider_created)),refunded_at=case when cumulative_refunded>=bp.expected_amount_minor then refunded_at_value else null end,financial_provider_created=greatest(bp.financial_provider_created,provider_created),financial_event_rank=greatest(bp.financial_event_rank,30),financial_provider_event_id=provider_event_id,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.*into payment;
   if cumulative_refunded>=payment.amount_paid_minor then
    update public.appointments a set appointment_state='cancelled',payment_state='paid',refund_state='succeeded',reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.*into appointment;
    update public.integration_outbox o set state='succeeded',completed_at=now_at,terminal_at=now_at,lease_token=null,lease_expires_at=null,safe_error=null where o.appointment_id=appointment.id and o.environment=appointment.environment and o.command_type='refund'and o.effect_contract_version=2 and o.state in('pending','processing','failed');
    update public.booking_refunds br set state=case when br.stripe_refund_id is null then'canceled'else br.state end,settled_by_external=br.stripe_refund_id is null,provider_updated_at=now_at,updated_at=now_at where br.payment_id=payment.id and br.state in('pending','requires_action');
    outcome:='paid_refund_fully_converged';
   elsif appointment.appointment_state='confirmed'then
    update public.appointments a set payment_state='paid',confirmed_at=coalesce(a.confirmed_at,now_at),reservation_expires_at=null,updated_at=now_at where a.id=appointment.id returning a.*into appointment;outcome:='paid_confirmed';
   elsif appointment.appointment_state='payment_pending'and appointment.reservation_expires_at>now_at then
    update public.appointments a set appointment_state='confirmed',payment_state='paid',calendar_state=case when a.calendar_state in('not_required','create_failed')then'create_pending'else a.calendar_state end,calendar_generation=a.calendar_generation+case when a.calendar_state in('not_required','create_failed')then 1 else 0 end,confirmed_at=coalesce(a.confirmed_at,now_at),reservation_expires_at=null,version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.*into appointment;
    perform public.enqueue_booking_calendar_create(appointment.id);outcome:='paid_confirmed';
   elsif appointment.start_at<=now_at then
    refund_generation:=case when appointment.refund_state='pending'and exists(select 1 from public.integration_outbox q where q.appointment_id=appointment.id and q.environment=appointment.environment and q.command_type='refund'and q.effect_generation=appointment.refund_generation and q.state in('pending','processing','failed'))then appointment.refund_generation else appointment.refund_generation+1 end;
    update public.appointments a set appointment_state='cancelled',appointment_reason='late_payment_refund',payment_state='paid',refund_state='pending',review_state='late_payment',refund_generation=refund_generation,reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.*into appointment;
    update public.booking_payments bp set refund_state='pending',refund_requested_at=coalesce(bp.refund_requested_at,now_at),refund_generation=refund_generation,refund_idempotency_key='booking-refund:'||appointment.id||':'||refund_generation,updated_at=now_at where bp.id=payment.id returning bp.*into payment;
    insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)values(appointment.profile_id,appointment.environment,appointment.id,'refund','booking-refund:'||appointment.id||':'||refund_generation,appointment.version,refund_generation,2,pg_catalog.jsonb_build_object('reason','paid_after_start'))on conflict(profile_id,environment,idempotency_key)do nothing;
    outcome:='paid_refund_required';
   else
    update public.appointments a set appointment_state='cancelled',appointment_reason='late_payment_arbitration',payment_state='paid',refund_state='not_requested',review_state='late_payment',reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.*into appointment;
    update public.booking_payments bp set refund_state='not_requested',refund_requested_at=null,refund_idempotency_key=null,updated_at=now_at where bp.id=payment.id returning bp.*into payment;
    outcome:='paid_arbitration_required';
   end if;
  elsif payment.payment_state='paid'then outcome:='failure_ignored_paid_terminal';
  elsif event_type in('checkout.session.async_payment_failed','checkout.session.expired','payment_intent.payment_failed')or checkout->>'status'='expired'or intent->>'status'in('canceled','requires_payment_method')then
   event_rank:=10;
   update public.booking_payments bp set checkout_session_id=coalesce(bp.checkout_session_id,session_id),payment_intent_id=coalesce(bp.payment_intent_id,intent_id),payment_state='failed',failed_at=coalesce(bp.failed_at,now_at),financial_provider_created=greatest(bp.financial_provider_created,provider_created),financial_event_rank=case when provider_created>=bp.financial_provider_created then greatest(bp.financial_event_rank,event_rank)else bp.financial_event_rank end,financial_provider_event_id=case when provider_created>=bp.financial_provider_created then provider_event_id else bp.financial_provider_event_id end,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id and bp.payment_state<>'paid'returning bp.*into payment;
   update public.appointments a set appointment_state='cancelled',appointment_reason='payment_failed',payment_state='failed',cancelled_at=coalesce(a.cancelled_at,now_at),reservation_expires_at=null,version=a.version+1,updated_at=now_at where a.id=appointment.id and a.appointment_state in('held','payment_pending')and a.payment_state<>'paid';
   outcome:='payment_failed';
  else
   update public.booking_payments bp set checkout_session_id=coalesce(bp.checkout_session_id,session_id),payment_intent_id=coalesce(bp.payment_intent_id,intent_id),payment_state=case when bp.payment_state in('not_started','creating')then'pending'else bp.payment_state end,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.*into payment;
   outcome:='payment_pending_observed';
  end if;

  if event_type like'charge.dispute.%'then
   dispute_status:=event_object->>'status';
   if event_object->>'object'is distinct from'dispute'or provider_object_id is null or dispute_status not in('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost')then raise exception'unsupported Stripe dispute evidence'using errcode='P0001';end if;
   event_rank:=case when dispute_status in('won','lost','warning_closed')then 22 else 21 end;
   if provider_created>payment.dispute_provider_created or(provider_created=payment.dispute_provider_created and event_rank>=payment.dispute_status_rank)then
    update public.booking_payments bp set dispute_id=provider_object_id,payment_state=case when dispute_status='won'then'paid'else'disputed'end,dispute_state=case when dispute_status='won'then'won'when dispute_status='lost'then'lost'when dispute_status='warning_closed'then'closed'else'open'end,dispute_provider_created=provider_created,dispute_status_rank=event_rank,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.*into payment;
    update public.appointments a set payment_state=payment.payment_state,review_state=case when payment.dispute_state in('open','lost')then'provider_inconsistency'else a.review_state end,version=a.version+1,updated_at=now_at where a.id=appointment.id;
    outcome:='dispute_'||dispute_status;
   end if;
  end if;
  if outcome is null then raise exception'Stripe event has no financial outcome'using errcode='P0001';end if;
  insert into public.booking_provider_evidence(event_id,profile_id,environment,stripe_account_id,event_type,provider_event_id,object_id,appointment_id,payload_sha256)values(inbox.id,inbox.profile_id,inbox.environment,account_id,event_type,provider_event_id,provider_object_id,payment.appointment_id,envelope_sha)on conflict(event_id)do nothing;
  if not exists(select 1 from public.booking_provider_evidence e where e.event_id=inbox.id and e.profile_id=inbox.profile_id and e.environment=inbox.environment and e.stripe_account_id=account_id and e.event_type=event_type and e.provider_event_id=provider_event_id and e.object_id=provider_object_id and e.appointment_id=payment.appointment_id and e.payload_sha256=envelope_sha)then raise exception'immutable provider evidence conflict'using errcode='23505';end if;
  insert into public.booking_stripe_observations_v3(authority_kind,authority_id,event_id,payment_id,appointment_id,profile_id,environment,stripe_account_id,provider_event_id,event_type,provider_created,checkout_session_id,payment_intent_id,charge_id,cumulative_refunded_minor,envelope_sha256,snapshot_sha256,provider_snapshot,reduction_outcome)
  values('stripe_event',inbox.id,inbox.id,payment.id,payment.appointment_id,payment.profile_id,payment.environment,account_id,provider_event_id,event_type,provider_created,session_id,intent_id,charge_id,case when charge_id is null then null else cumulative_refunded end,envelope_sha,snapshot_sha,p_provider_snapshot,outcome)returning id into observation_id;
  for refund_item in select value from pg_catalog.jsonb_array_elements(refunds)loop
   insert into public.booking_stripe_refund_observations_v3(observation_id,stripe_refund_id,stripe_charge_id,payment_intent_id,status,amount_minor,currency,provider_created,metadata)values(observation_id,refund_item->>'id',refund_item->>'charge',refund_item->>'payment_intent',refund_item->>'status',(refund_item->>'amount')::bigint,pg_catalog.upper(refund_item->>'currency'),(refund_item->>'created')::bigint,coalesce(refund_item->'metadata','{}'));
  end loop;
  update public.provider_event_inbox i set processing_state='processed',processed_at=now_at,lease_token=null,lease_expires_at=null,safe_error=null where i.id=inbox.id and i.processing_state='processing'and i.lease_token=p_lease_token and i.fencing_token=p_fencing_token;
  if not found then raise exception'stale Stripe event fence'using errcode='40001';end if;
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
  return pg_catalog.jsonb_build_object('action','settled','outcome',outcome);
 end if;

 -- Refund command: reducer freezes the exact provider-derived remainder, then converges it.
 select o.appointment_id into strict appointment_identity from public.integration_outbox o where o.id=p_authority_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_identity::text||':booking-appointment',0));
 select o.*into strict command from public.integration_outbox o where o.id=p_authority_id and o.command_type='refund'and o.effect_contract_version=2 and o.state='processing'and o.lease_token=p_lease_token and o.fencing_token=p_fencing_token and o.lease_expires_at>pg_catalog.clock_timestamp()for update;
 if not public.booking_cutover_enabled(command.profile_id,command.environment)then raise exception'booking cutover is not enabled'using errcode='P0001';end if;
 select p.*into strict payment from public.booking_payments p where p.appointment_id=command.appointment_id and p.profile_id=command.profile_id and p.environment=command.environment and p.booking_contract_version=2 and p.refund_generation=command.effect_generation and p.stripe_account_id=account_id for update;
 select a.*into strict appointment from public.appointments a where a.id=payment.appointment_id and a.booking_contract_version=2 and a.refund_generation=command.effect_generation for update;
 if intent_id is null or charge_id is null or intent->>'object'is distinct from'payment_intent'or intent->'metadata'->>'kind'is distinct from'booking'or intent->'metadata'->>'appointmentId'is distinct from appointment.id::text or charge->>'object'is distinct from'charge'or charge->>'payment_intent'is distinct from intent_id or payment.payment_intent_id is distinct from intent_id or(payment.charge_id is not null and payment.charge_id<>charge_id)or coalesce((charge->>'amount')::bigint,-1)<>payment.amount_paid_minor or pg_catalog.upper(coalesce(charge->>'currency',''))<>payment.currency or(intent->>'livemode')::boolean is distinct from(payment.environment='live')or(charge->>'livemode')::boolean is distinct from(payment.environment='live')then raise exception'refund Charge correlation mismatch'using errcode='P0001';end if;
 perform public.validate_booking_refund_snapshot_v3(refunds,charge_id,intent_id,payment.currency,payment.amount_paid_minor);
 select coalesce((charge->>'amount_refunded')::bigint,-1),coalesce(sum((x->>'amount')::bigint)filter(where x->>'status'='succeeded'),0),max(pg_catalog.to_timestamp((x->>'created')::bigint))filter(where x->>'status'='succeeded')into cumulative_refunded,succeeded_refund_sum,refunded_at_value from pg_catalog.jsonb_array_elements(refunds)x;
 if cumulative_refunded<payment.amount_refunded_minor or cumulative_refunded>payment.amount_paid_minor or succeeded_refund_sum<>cumulative_refunded then raise exception'non-causal or incomplete cumulative refund evidence'using errcode='P0001';end if;
 remaining_amount:=payment.amount_paid_minor-cumulative_refunded;refund_generation:=command.effect_generation;
 perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
 update public.booking_payments bp set charge_id=reduce_booking_financial_evidence_v3.charge_id,amount_refunded_minor=cumulative_refunded,refund_state=case when remaining_amount=0 then'succeeded'else'pending'end,refunded_at=case when remaining_amount=0 then refunded_at_value else null end,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.*into payment;
 update public.appointments a set refund_state=case when remaining_amount=0 then'succeeded'else'pending'end,review_state=case when remaining_amount=0 and a.review_state='refund_failure'then'none'else a.review_state end,version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.*into appointment;
 select br.*into refund_row from public.booking_refunds br where br.payment_id=payment.id and br.generation=refund_generation for update;
 if refund_row.id is not null then
  select count(*),min(x->>'id'),min(x->>'status'),min((x->>'created')::bigint)into match_count,refund_id,refund_status,refund_created from pg_catalog.jsonb_array_elements(refunds)x where(refund_row.stripe_refund_id is not null and x->>'id'=refund_row.stripe_refund_id)or(refund_row.stripe_refund_id is null and x->'metadata'->>'kind'='booking_refund'and x->'metadata'->>'bookingPaymentId'=payment.id::text and x->'metadata'->>'bookingAppointmentId'=appointment.id::text and x->'metadata'->>'bookingProfileId'=payment.profile_id::text and x->'metadata'->>'bookingEnvironment'=payment.environment and x->'metadata'->>'refundGeneration'=refund_generation::text and x->'metadata'->>'bookingCommandId'=command.id::text);
  if match_count>1 then raise exception'multiple refunds claim one generation'using errcode='23505';end if;
  if refund_row.stripe_refund_id is not null and match_count=0 then raise exception'bound refund missing from complete snapshot'using errcode='P0001';end if;
  if match_count=1 then update public.booking_refunds br set stripe_refund_id=refund_id,state=refund_status,provider_created=coalesce(br.provider_created,refund_created),provider_updated_at=now_at,updated_at=now_at where br.id=refund_row.id returning br.*into refund_row;end if;
 end if;
 if remaining_amount=0 then
  if refund_row.id is not null and match_count=0 then update public.booking_refunds br set state='canceled',settled_by_external=true,provider_updated_at=now_at,updated_at=now_at where br.id=refund_row.id;end if;
  update public.integration_outbox o set state='succeeded',completed_at=now_at,terminal_at=now_at,lease_token=null,lease_expires_at=null,safe_error=null where o.id=command.id;
  outcome:='refund_fully_converged';result:=pg_catalog.jsonb_build_object('action','settled','outcome',outcome);
 elsif refund_row.id is null then
  insert into public.booking_refunds(payment_id,appointment_id,profile_id,environment,generation,stripe_account_id,payment_intent_id,idempotency_key,amount_minor)values(payment.id,appointment.id,payment.profile_id,payment.environment,refund_generation,account_id,intent_id,'booking-refund:'||appointment.id||':'||refund_generation,remaining_amount)returning*into refund_row;
  outcome:='refund_submission_prepared';result:=pg_catalog.jsonb_build_object('action','create','stripeAccountId',account_id,'paymentIntentId',intent_id,'chargeId',charge_id,'amountMinor',refund_row.amount_minor,'idempotencyKey',refund_row.idempotency_key,'paymentId',payment.id,'appointmentId',appointment.id,'profileId',payment.profile_id,'environment',payment.environment,'generation',refund_generation,'commandId',command.id);
 elsif match_count=0 and refund_row.stripe_refund_id is null and refund_row.amount_minor<>remaining_amount then
  update public.booking_refunds br set state='canceled',settled_by_external=true,provider_updated_at=now_at,updated_at=now_at where br.id=refund_row.id;
  update public.integration_outbox o set state='dead_letter',terminal_at=now_at,safe_error='superseded_by_external_refund',lease_token=null,lease_expires_at=null where o.id=command.id;
  refund_generation:=refund_generation+1;
  update public.appointments a set refund_generation=refund_generation,version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.*into appointment;
  update public.booking_payments bp set refund_generation=refund_generation,refund_idempotency_key='booking-refund:'||appointment.id||':'||refund_generation,updated_at=now_at where bp.id=payment.id;
  insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)values(appointment.profile_id,appointment.environment,appointment.id,'refund','booking-refund:'||appointment.id||':'||refund_generation,appointment.version,refund_generation,2,pg_catalog.jsonb_build_object('reason','external_refund_race'))on conflict(profile_id,environment,idempotency_key)do nothing;
  outcome:='refund_generation_superseded';result:=pg_catalog.jsonb_build_object('action','superseded','outcome',outcome);
 elsif match_count=0 then
  outcome:='refund_submission_ready';result:=pg_catalog.jsonb_build_object('action','create','stripeAccountId',account_id,'paymentIntentId',intent_id,'chargeId',charge_id,'amountMinor',refund_row.amount_minor,'idempotencyKey',refund_row.idempotency_key,'paymentId',payment.id,'appointmentId',appointment.id,'profileId',payment.profile_id,'environment',payment.environment,'generation',refund_generation,'commandId',command.id);
 elsif refund_status='succeeded'then
  if remaining_amount>0 then
   update public.integration_outbox o set state='dead_letter',terminal_at=now_at,safe_error='owned_refund_partial_remainder',lease_token=null,lease_expires_at=null where o.id=command.id;
   refund_generation:=refund_generation+1;
   update public.appointments a set refund_generation=refund_generation,version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.*into appointment;
   update public.booking_payments bp set refund_generation=refund_generation,refund_idempotency_key='booking-refund:'||appointment.id||':'||refund_generation,updated_at=now_at where bp.id=payment.id;
   insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)values(appointment.profile_id,appointment.environment,appointment.id,'refund','booking-refund:'||appointment.id||':'||refund_generation,appointment.version,refund_generation,2,pg_catalog.jsonb_build_object('reason','owned_refund_partial_remainder'))on conflict(profile_id,environment,idempotency_key)do nothing;
   outcome:='refund_generation_superseded';result:=pg_catalog.jsonb_build_object('action','superseded','outcome',outcome);
  else
   update public.integration_outbox o set state='succeeded',completed_at=now_at,terminal_at=now_at,lease_token=null,lease_expires_at=null,safe_error=null where o.id=command.id;outcome:='refund_submission_succeeded';result:=pg_catalog.jsonb_build_object('action','settled','outcome',outcome);
  end if;
 elsif refund_status in('failed','canceled')then
  update public.integration_outbox o set state='dead_letter',terminal_at=now_at,safe_error='Stripe refund '||refund_status,lease_token=null,lease_expires_at=null where o.id=command.id;
  update public.appointments a set refund_state='failed',review_state='refund_failure',version=a.version+1,updated_at=now_at where a.id=appointment.id;
  update public.booking_payments bp set refund_state='failed',updated_at=now_at where bp.id=payment.id;
  outcome:='refund_submission_'||refund_status;result:=pg_catalog.jsonb_build_object('action','failed','outcome',outcome);
 else
  update public.integration_outbox o set state='failed',next_attempt_at=now_at+interval'15 minutes',safe_error='Stripe refund pending reconciliation',lease_token=null,lease_expires_at=null where o.id=command.id;
  outcome:='refund_submission_pending';result:=pg_catalog.jsonb_build_object('action','waiting','outcome',outcome);
 end if;
 insert into public.booking_stripe_observations_v3(authority_kind,authority_id,command_id,payment_id,appointment_id,profile_id,environment,stripe_account_id,provider_created,payment_intent_id,charge_id,cumulative_refunded_minor,snapshot_sha256,provider_snapshot,reduction_outcome)
 values('refund_command',command.id,command.id,payment.id,payment.appointment_id,payment.profile_id,payment.environment,account_id,0,intent_id,charge_id,cumulative_refunded,snapshot_sha,p_provider_snapshot,outcome)on conflict(authority_kind,authority_id,snapshot_sha256,reduction_outcome)do nothing returning id into observation_id;
 if observation_id is null then select b.id into strict observation_id from public.booking_stripe_observations_v3 b where b.authority_kind='refund_command'and b.authority_id=command.id and b.snapshot_sha256=snapshot_sha and b.reduction_outcome=outcome;end if;
 perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
 for refund_item in select value from pg_catalog.jsonb_array_elements(refunds)loop
  insert into public.booking_stripe_refund_observations_v3(observation_id,stripe_refund_id,stripe_charge_id,payment_intent_id,status,amount_minor,currency,provider_created,metadata)values(observation_id,refund_item->>'id',refund_item->>'charge',refund_item->>'payment_intent',refund_item->>'status',(refund_item->>'amount')::bigint,pg_catalog.upper(refund_item->>'currency'),(refund_item->>'created')::bigint,coalesce(refund_item->'metadata','{}'))on conflict(observation_id,stripe_refund_id)do nothing;
 end loop;
 return result;
end $function$;

-- Reducer-owned failure settlement never fabricates Stripe/refund truth. Retryable failures
-- only release the command lease; terminal configuration failures dead-letter the command and
-- move the aggregate to review under the same private financial guard token.
create or replace function public.fail_booking_refund_command_v3(p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_retryable boolean,p_safe_error text)returns boolean
language plpgsql security definer set search_path=''as $function$
declare command public.integration_outbox%rowtype;payment public.booking_payments%rowtype;appointment public.appointments%rowtype;guard_token text:=pg_catalog.gen_random_uuid()::text;terminal boolean;
begin
 select o.*into command from public.integration_outbox o where o.id=p_command_id and o.command_type='refund'and o.effect_contract_version=2 and o.state='processing'and o.lease_token=p_lease_token and o.fencing_token=p_fencing_token and o.lease_expires_at>pg_catalog.clock_timestamp()for update;
 if command.id is null then return false;end if;
 select p.*into strict payment from public.booking_payments p where p.appointment_id=command.appointment_id and p.profile_id=command.profile_id and p.environment=command.environment and p.refund_generation=command.effect_generation for update;
 select a.*into strict appointment from public.appointments a where a.id=command.appointment_id and a.profile_id=command.profile_id and a.environment=command.environment and a.refund_generation=command.effect_generation for update;
 terminal:=not p_retryable;
 perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
 update public.integration_outbox set state=case when terminal then'dead_letter'else'failed'end,terminal_at=case when terminal then pg_catalog.clock_timestamp()else null end,next_attempt_at=case when terminal then'infinity'::timestamptz else pg_catalog.clock_timestamp()+interval'1 minute'end,lease_token=null,lease_expires_at=null,safe_error=left(coalesce(p_safe_error,'Booking refund provider operation failed'),240)where id=command.id;
 if terminal then update public.appointments set refund_state='failed',review_state='refund_failure',version=version+1,updated_at=pg_catalog.clock_timestamp()where id=appointment.id;update public.booking_payments set refund_state='failed',updated_at=pg_catalog.clock_timestamp()where id=payment.id;end if;
 perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);return true;
exception when others then perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);raise;
end $function$;
revoke all on function public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text)to booking_worker;

create or replace function public.renew_booking_payment_event_v3(p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path=''as $function$
begin
 if p_lease_token is null or p_lease_seconds not between 30 and 300 then raise exception'invalid booking event renewal'using errcode='22023';end if;
 update public.provider_event_inbox set lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds)where id=p_event_id and provider='stripe'and event_family='booking'and processing_state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();return found;
end $function$;

create or replace function public.fail_booking_payment_event_v3(p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_retryable boolean,p_safe_error text)
returns boolean language plpgsql security definer set search_path=''as $function$
begin
 if p_lease_token is null or nullif(pg_catalog.btrim(p_safe_error),'')is null then raise exception'invalid booking event failure'using errcode='22023';end if;
 update public.provider_event_inbox set processing_state=case when p_retryable then'failed'else'dead_letter'end,processed_at=case when p_retryable then null else pg_catalog.clock_timestamp()end,next_attempt_at=case when p_retryable then pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer))else'infinity'::timestamptz end,safe_error=left(p_safe_error,240),lease_token=null,lease_expires_at=null where id=p_event_id and provider='stripe'and event_family='booking'and processing_state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();return found;
end $function$;
revoke all on function public.renew_booking_payment_event_v3(uuid,uuid,bigint,integer),public.fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.renew_booking_payment_event_v3(uuid,uuid,bigint,integer),public.fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text)to booking_worker;

-- Snapshot APIs expose preparation and settlement phases without accepting scalar money truth.
-- Both phases use the same lease/fence-bound authoritative reducer.
create or replace function public.prepare_booking_refund_snapshot_v3(
 p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_provider_snapshot jsonb
)returns jsonb language sql security definer set search_path=''as $function$
 select public.reduce_booking_financial_evidence_v3('refund_command',p_command_id,p_lease_token,p_fencing_token,p_provider_snapshot)
$function$;
create or replace function public.settle_booking_refund_snapshot_v3(
 p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_provider_snapshot jsonb
)returns jsonb language sql security definer set search_path=''as $function$
 select public.reduce_booking_financial_evidence_v3('refund_command',p_command_id,p_lease_token,p_fencing_token,p_provider_snapshot)
$function$;

-- Generic provider transport may never claim or complete booking family events.
revoke all on function public.prepare_booking_refund_snapshot_v3(uuid,uuid,bigint,jsonb),public.settle_booking_refund_snapshot_v3(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role,booking_worker;

create or replace function public.claim_provider_event(p_event_id uuid,p_lease_token uuid,p_lease_seconds integer)returns bigint
language plpgsql security definer set search_path=''as $function$
declare next_fence bigint;
begin
 if exists(select 1 from public.provider_event_inbox i where i.id=p_event_id and i.event_family='booking')then raise exception'booking provider events require the v3 claim'using errcode='0A000';end if;
 if p_lease_token is null or p_lease_seconds not between 1 and 900 then raise exception'invalid provider lease'using errcode='22023';end if;
 update public.provider_event_inbox i set processing_state='processing',lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),fencing_token=i.fencing_token+1,attempts=i.attempts+1 where i.id=p_event_id and i.processing_state in('pending','processing','failed')and i.next_attempt_at<=pg_catalog.clock_timestamp()and(i.lease_expires_at is null or i.lease_expires_at<pg_catalog.clock_timestamp())returning i.fencing_token into next_fence;
 if next_fence is null then raise exception'provider event unavailable'using errcode='P0001';end if;return next_fence;
end $function$;
create or replace function public.complete_provider_event(p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_succeeded boolean,p_safe_error text default null)returns boolean
language plpgsql security definer set search_path=''as $function$
begin
 if exists(select 1 from public.provider_event_inbox i where i.id=p_event_id and i.event_family='booking')then raise exception'booking provider events require the v3 reducer'using errcode='0A000';end if;
 if p_succeeded then raise exception'successful provider events require a domain reducer'using errcode='22023';end if;
 update public.provider_event_inbox i set processing_state=case when i.attempts>=8 then'dead_letter'else'failed'end,safe_error=p_safe_error,processed_at=case when i.attempts>=8 then pg_catalog.clock_timestamp()else null end,next_attempt_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*(2^least(i.attempts,7))::integer)),lease_token=null,lease_expires_at=null where i.id=p_event_id and i.processing_state='processing'and i.lease_token=p_lease_token and i.fencing_token=p_fencing_token;
 if not found then raise exception'stale provider event fence'using errcode='40001';end if;return true;
end $function$;

-- Explicit exhaustive legacy authority retirement. Claim-only checkout recovery remains
-- callable because it cannot project provider money; every scalar money/provider reducer is denied.
revoke all on function
 public.transition_appointment(uuid,uuid,text,bigint,text,uuid,text,jsonb),
 public.apply_provider_appointment_event(uuid,uuid,bigint,uuid,uuid,text,bigint,text,uuid,text,jsonb),
 public.claim_outbox_command(uuid,uuid,integer),
 public.complete_outbox_command(uuid,uuid,bigint,boolean,text),
 public.complete_outbox_appointment_command(uuid,uuid,bigint,uuid,text,text,text,jsonb),
 public.record_created_booking_checkout(uuid,text,timestamptz),
 public.apply_booking_payment_event(uuid,uuid,bigint,uuid,text,text,text,bigint,text,boolean),
 public.apply_booking_money_mirror_event(uuid,uuid,bigint,text,text,bigint,text,text,text,bigint),
 public.record_booking_refund_provider_result(uuid,bigint,text,text,bigint,bigint),
 public.ensure_booking_refund_submission(uuid,bigint),
 public.settle_booking_refund_command(uuid,uuid,bigint,text,text,bigint,bigint),
 public.complete_booking_outbox(uuid,uuid,bigint,jsonb),
 public.claim_due_booking_sessions(text,uuid,integer),
 public.settle_due_booking_session(uuid,uuid,bigint,boolean,boolean,text,text,bigint,text),
 public.apply_booking_provider_evidence(uuid,uuid,bigint),
 public.bind_booking_calendar_intent(uuid,uuid,bigint,text),
 public.settle_booking_calendar_claim(uuid,uuid,bigint,text,text),
 public.settle_booking_calendar_reconciliation(uuid,text,text),
 public.list_ambiguous_booking_checkouts(text,integer)
from public,anon,authenticated,service_role,booking_worker;

revoke all on function
 public.guard_booking_contract_version_v3(),public.booking_cutover_inventory_v3(uuid,text),public.reject_booking_cutover_evidence_mutation_v3(),public.guard_booking_cutover_state_v3(),public.capture_booking_cutover_preflight_v3(uuid,text),public.activate_booking_cutover_v3(uuid),public.booking_cutover_enabled(uuid,text),public.activate_booking_cutover(uuid,text,text),
 public.reject_booking_stripe_evidence_mutation_v3(),public.guard_booking_stripe_inbox_envelope_v3(),public.reject_provider_inbox_truncate_v3(),public.booking_financial_guard_token_v3(),public.guard_booking_financial_truth_v3(),public.guard_booking_refund_ledger_v3(),public.validate_booking_refund_snapshot_v3(jsonb,text,text,text,bigint),public.lock_booking_cutover_writer_v3(),
 public.claim_due_booking_payment_events(text,uuid,integer),public.claim_due_booking_outbox(uuid,integer),public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb),public.prepare_booking_refund_snapshot_v3(uuid,uuid,bigint,jsonb),public.settle_booking_refund_snapshot_v3(uuid,uuid,bigint,jsonb),public.claim_provider_event(uuid,uuid,integer),public.complete_provider_event(uuid,uuid,bigint,boolean,text)
from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.capture_booking_cutover_preflight_v3(uuid,text),public.activate_booking_cutover_v3(uuid),public.booking_cutover_enabled(uuid,text)to service_role;
grant execute on function public.claim_due_booking_payment_events(text,uuid,integer),public.claim_due_booking_outbox(uuid,integer),public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)to booking_worker;
grant execute on function public.claim_provider_event(uuid,uuid,integer),public.complete_provider_event(uuid,uuid,bigint,boolean,text)to service_role;
