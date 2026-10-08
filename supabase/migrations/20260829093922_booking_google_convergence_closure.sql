-- Forward-only closure for late-payment arbitration and Google Calendar convergence.
-- Provider workers transport immutable observations. Database reducers alone project booking state.
-- The committed 180000 money preflight remains the only booking cutover authority.

alter table public.booking_cutover_state
  add column if not exists convergence_snapshot_id uuid,
  add column if not exists convergence_prepared_at timestamptz;

create table if not exists public.booking_convergence_cutover_snapshots(
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  environment text not null check(environment in('test','live')),
  inventory jsonb not null,
  inventory_sha256 text not null check(inventory_sha256~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(profile_id,environment,inventory_sha256),
  unique(id,profile_id,environment),
  foreign key(profile_id,environment) references public.profiles(id,environment)
);
alter table public.booking_convergence_cutover_snapshots enable row level security;
revoke all on public.booking_convergence_cutover_snapshots from public,anon,authenticated,service_role,booking_worker;

alter table public.booking_cutover_state drop constraint if exists booking_cutover_state_convergence_snapshot_fk;
alter table public.booking_cutover_state add constraint booking_cutover_state_convergence_snapshot_fk
  foreign key(convergence_snapshot_id,profile_id,environment) references public.booking_convergence_cutover_snapshots(id,profile_id,environment) on delete restrict not valid;
alter table public.booking_cutover_state validate constraint booking_cutover_state_convergence_snapshot_fk;

create or replace function public.booking_convergence_cutover_inventory(p_profile_id uuid,p_environment text)
returns jsonb language sql stable security definer set search_path='' as $function$
 select pg_catalog.jsonb_build_object(
   'profileId',p_profile_id,
   'environment',p_environment,
   'moneyContractVersion',2,
   'migrationMarker','20260829093922_booking_google_convergence_closure',
   'unresolvedQuarantine',(select pg_catalog.count(*) from public.booking_cutover_quarantine q where q.profile_id=p_profile_id and q.environment=p_environment and q.resolved_at is null),
   'legacyEffects',(select pg_catalog.count(*) from public.integration_outbox o where o.profile_id=p_profile_id and o.environment=p_environment and o.effect_contract_version=1 and o.state in('pending','processing','failed')),
   'calendarEffects',(select pg_catalog.count(*) from public.integration_outbox o where o.profile_id=p_profile_id and o.environment=p_environment and o.command_type in('calendar_create','calendar_cancel') and o.state in('pending','processing','failed')),
   'missingCalendarIdentity',(select pg_catalog.count(*) from public.calendar_event_links l where l.profile_id=p_profile_id and l.environment=p_environment and(l.destination_epoch_id is null or nullif(l.google_event_id,'')is null)),
   'activeCalendarClaims',(select pg_catalog.count(*) from public.calendar_event_links l where l.profile_id=p_profile_id and l.environment=p_environment and l.reconcile_lease_expires_at>pg_catalog.clock_timestamp()),
   'activeProviderClaims',(select pg_catalog.count(*) from public.provider_event_inbox i where i.profile_id=p_profile_id and i.environment=p_environment and i.event_family='booking' and i.processing_state='processing' and i.lease_expires_at>pg_catalog.clock_timestamp())
 )
$function$;

-- Preparation attaches DB-computed convergence evidence to the committed 180000
-- preflight while preserving accepted_preflight_id and every money-preflight field.
create or replace function public.prepare_booking_convergence_cutover(p_profile_id uuid,p_environment text)
returns public.booking_convergence_cutover_snapshots language plpgsql security definer set search_path='' as $function$
declare v_inventory jsonb;v_digest text;money public.booking_cutover_preflights_v3%rowtype;result public.booking_convergence_cutover_snapshots%rowtype;
begin
 if p_environment not in('test','live')then raise exception 'invalid environment' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':booking-cutover',0));
 perform pg_catalog.set_config('obra.booking_cutover_write_v3','allowed',true);
 select p.* into money from public.booking_cutover_state s join public.booking_cutover_preflights_v3 p on p.id=s.accepted_preflight_id and p.profile_id=s.profile_id and p.environment=s.environment where s.profile_id=p_profile_id and s.environment=p_environment and s.status='reconciling'and s.target_contract_version=2 and s.preflight_digest=p.inventory_sha256 and p.migration_marker='20260829093921_booking_money_authority_closure';
 if money.id is null or money.inventory<>public.booking_cutover_inventory_v3(p_profile_id,p_environment)then raise exception 'current committed money preflight required' using errcode='40001';end if;
 v_inventory:=public.booking_convergence_cutover_inventory(p_profile_id,p_environment);
 if (v_inventory->>'unresolvedQuarantine')::bigint<>0 or(v_inventory->>'legacyEffects')::bigint<>0 or(v_inventory->>'calendarEffects')::bigint<>0 or(v_inventory->>'missingCalendarIdentity')::bigint<>0 or(v_inventory->>'activeCalendarClaims')::bigint<>0 or(v_inventory->>'activeProviderClaims')::bigint<>0 then raise exception 'booking convergence admission has unresolved blockers' using errcode='P0001';end if;
 v_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_inventory::text,'UTF8'),'sha256'),'hex');
 insert into public.booking_convergence_cutover_snapshots(profile_id,environment,inventory,inventory_sha256)values(p_profile_id,p_environment,v_inventory,v_digest)on conflict(profile_id,environment,inventory_sha256)do nothing returning * into result;
 if result.id is null then select * into strict result from public.booking_convergence_cutover_snapshots where profile_id=p_profile_id and environment=p_environment and inventory_sha256=v_digest;end if;
 update public.booking_cutover_state set convergence_snapshot_id=result.id,convergence_prepared_at=pg_catalog.clock_timestamp() where profile_id=p_profile_id and environment=p_environment and target_contract_version=2 and accepted_preflight_id=money.id and preflight_digest=money.inventory_sha256;
 if not found then raise exception 'money cutover changed during convergence preparation' using errcode='40001';end if;
 return result;
end $function$;

-- Sole activation authority: the existing preflight-id API now atomically validates both
-- committed money evidence and the DB-generated convergence snapshot. No caller digest exists.
create or replace function public.activate_booking_cutover_v3(p_preflight_id uuid)returns boolean language plpgsql security definer set search_path=''as $function$
declare p public.booking_cutover_preflights_v3%rowtype;inv jsonb;digest text;snapshot public.booking_convergence_cutover_snapshots%rowtype;convergence jsonb;convergence_digest text;
begin
 select*into strict p from public.booking_cutover_preflights_v3 where id=p_preflight_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p.profile_id::text||':'||p.environment||':booking-cutover',0));perform pg_catalog.set_config('obra.booking_cutover_write_v3','allowed',true);
 select*into strict p from public.booking_cutover_preflights_v3 where id=p_preflight_id for share;inv:=public.booking_cutover_inventory_v3(p.profile_id,p.environment);digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(inv::text,'UTF8'),'sha256'),'hex');
 if p.captured_xid=pg_catalog.pg_current_xact_id()then raise exception 'booking cutover preflight must commit before activation' using errcode='25001';end if;
 if p.migration_marker is distinct from '20260829093921_booking_money_authority_closure'or p.target_contract_version is distinct from 2 or p.inventory_sha256 is distinct from digest or p.inventory is distinct from inv then raise exception 'booking cutover preflight is stale' using errcode='40001';end if;
 if coalesce((inv->>'blockerCount')::bigint,-1) is distinct from 0 then raise exception 'booking cutover preflight has blockers' using errcode='P0001';end if;
 select x.* into snapshot from public.booking_cutover_state s join public.booking_convergence_cutover_snapshots x on x.id=s.convergence_snapshot_id and x.profile_id=s.profile_id and x.environment=s.environment where s.profile_id=p.profile_id and s.environment=p.environment and s.accepted_preflight_id=p.id and s.preflight_digest=p.inventory_sha256 and s.target_contract_version=2;
 if snapshot.id is null then raise exception 'booking convergence evidence is not prepared' using errcode='P0001';end if;
 convergence:=public.booking_convergence_cutover_inventory(p.profile_id,p.environment);convergence_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(convergence::text,'UTF8'),'sha256'),'hex');
 if convergence is distinct from snapshot.inventory or convergence_digest is distinct from snapshot.inventory_sha256 then raise exception 'booking convergence evidence is stale' using errcode='40001';end if;
 update public.booking_cutover_state set status='enabled',target_contract_version=2,accepted_preflight_id=p.id,preflight_digest=p.inventory_sha256,preflight_completed_at=p.captured_at,enabled_at=pg_catalog.clock_timestamp()where profile_id=p.profile_id and environment=p.environment and status='reconciling'and accepted_preflight_id=p.id and convergence_snapshot_id=snapshot.id;
 if not found then raise exception 'booking cutover is not frozen' using errcode='40001';end if;return true;
end $function$;

-- No second activation exists.
drop function if exists public.activate_booking_convergence_cutover(uuid,text);
drop function if exists public.activate_booking_convergence_cutover(uuid);

revoke all on function public.booking_convergence_cutover_inventory(uuid,text),public.prepare_booking_convergence_cutover(uuid,text),public.activate_booking_cutover_v3(uuid) from public,anon,authenticated,service_role,booking_worker;
revoke execute on function public.activate_booking_cutover(uuid,text,text) from service_role,booking_worker;
do $revoke_legacy$ declare proc pg_catalog.regprocedure;begin for proc in select p.oid::pg_catalog.regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=any(array['transition_appointment','apply_provider_appointment_event','apply_booking_payment_event','apply_booking_money_mirror_event','record_booking_refund_provider_result','ensure_booking_refund_submission','settle_booking_refund_command','complete_booking_outbox','complete_booking_calendar_outbox_v3','apply_booking_provider_evidence','claim_due_booking_sessions','settle_due_booking_session','bind_booking_calendar_intent','settle_booking_calendar_claim','settle_booking_calendar_reconciliation'])loop execute 'revoke all on function '||proc::text||' from public,anon,authenticated,service_role,booking_worker';end loop;end $revoke_legacy$;
grant execute on function public.booking_convergence_cutover_inventory(uuid,text),public.prepare_booking_convergence_cutover(uuid,text),public.activate_booking_cutover_v3(uuid),public.booking_cutover_enabled(uuid,text) to service_role;
create table if not exists public.booking_late_payment_arbitrations(
 id uuid primary key default gen_random_uuid(),
 payment_id uuid not null references public.booking_payments(id) on delete cascade,
 appointment_id uuid not null references public.appointments(id) on delete cascade,
 provider_event_id uuid references public.booking_provider_evidence(event_id),
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 generation bigint not null check(generation>0),
 status text not null default 'due' check(status in('due','processing','retry_wait','recovered','refund_required')),
 deadline_at timestamptz not null,
 next_attempt_at timestamptz not null default now(),
 attempts integer not null default 0 check(attempts>=0),
 lease_token uuid,
 lease_expires_at timestamptz,
 fencing_token bigint not null default 0 check(fencing_token>=0),
 snapshot_generation bigint not null default 0 check(snapshot_generation>=0),
 snapshot_appointment_version bigint,
 snapshot_connection_id uuid,
 snapshot_pipedream_account_id text,
 snapshot_availability_generation bigint,
 snapshot_calendar_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(snapshot_calendar_ids)='array'),
 snapshot_calendar_set_hash text,
 snapshot_schedule_revision bigint,
 snapshot_service_revision bigint,
 claimed_at timestamptz,
 decision_code text,
 decided_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(payment_id,generation),
 unique(provider_event_id),
 foreign key(appointment_id,profile_id,environment) references public.appointments(id,profile_id,environment),
 check(status<>'processing' or(lease_token is not null and lease_expires_at is not null and claimed_at is not null))
);
alter table public.booking_late_payment_arbitrations alter column provider_event_id drop not null;
create index if not exists booking_late_payment_due_idx on public.booking_late_payment_arbitrations(environment,next_attempt_at) where status in('due','processing','retry_wait');
alter table public.booking_late_payment_arbitrations enable row level security;
revoke all on public.booking_late_payment_arbitrations from public,anon,authenticated;

create table if not exists public.booking_late_payment_observations(
 id uuid primary key default gen_random_uuid(),
 arbitration_id uuid not null references public.booking_late_payment_arbitrations(id) on delete cascade,
 snapshot_generation bigint not null check(snapshot_generation>0),
 observation_state text not null check(observation_state in('complete','transient_error','permanent_error')),
 observed_at timestamptz not null,
 busy_ranges jsonb not null default '[]'::jsonb check(jsonb_typeof(busy_ranges)='array'),
 request_sha256 text not null check(request_sha256~'^[a-f0-9]{64}$'),
 response_sha256 text not null check(response_sha256~'^[a-f0-9]{64}$'),
 safe_error text,
 lease_token uuid not null,
 fencing_token bigint not null,
 created_at timestamptz not null default now(),
 unique(arbitration_id,snapshot_generation)
);
alter table public.booking_late_payment_observations enable row level security;
revoke all on public.booking_late_payment_observations from public,anon,authenticated;

alter table public.calendar_event_links
 add column if not exists desired_state text,
 add column if not exists desired_generation bigint,
 add column if not exists observed_state text,
 add column if not exists reconcile_status text,
 add column if not exists reconcile_next_attempt_at timestamptz,
 add column if not exists reconcile_attempts integer,
 add column if not exists snapshot_appointment_version bigint,
 add column if not exists snapshot_desired_generation bigint,
 add column if not exists last_observed_at timestamptz,
 add column if not exists last_observation_sha256 text,
 add column if not exists ambiguity_started_at timestamptz,
 add column if not exists stability_scan_until timestamptz,
 add column if not exists drift_scan_count integer,
 add column if not exists manual_repair_at timestamptz,
 add column if not exists manual_repair_reason text;

update public.calendar_event_links l set
 desired_state=case when a.appointment_state='confirmed'then'present'else'absent'end,
 desired_generation=greatest(a.calendar_generation,1),
 observed_state=case when l.sync_state='created'then'present'when l.sync_state='cancelled'then'absent'else'unknown'end,
 reconcile_status='due',reconcile_next_attempt_at=pg_catalog.clock_timestamp(),reconcile_attempts=0,
 snapshot_appointment_version=a.version,snapshot_desired_generation=greatest(a.calendar_generation,1),drift_scan_count=0,
 stability_scan_until=case when a.appointment_state='confirmed'then a.start_at else pg_catalog.clock_timestamp()+interval '24 hours'end
from public.appointments a where a.id=l.appointment_id and a.profile_id=l.profile_id and a.environment=l.environment;

alter table public.calendar_event_links alter column desired_state set not null,alter column desired_generation set not null,alter column observed_state set not null,alter column reconcile_status set not null,alter column reconcile_next_attempt_at set not null,alter column reconcile_attempts set not null,alter column drift_scan_count set not null;
alter table public.calendar_event_links alter column observed_state set default 'unknown',alter column reconcile_status set default 'due',alter column reconcile_next_attempt_at set default now(),alter column reconcile_attempts set default 0,alter column drift_scan_count set default 0;
alter table public.calendar_event_links drop constraint if exists calendar_event_links_desired_state_ck;
alter table public.calendar_event_links add constraint calendar_event_links_desired_state_ck check(desired_state in('present','absent'));
alter table public.calendar_event_links drop constraint if exists calendar_event_links_observed_state_ck;
alter table public.calendar_event_links add constraint calendar_event_links_observed_state_ck check(observed_state in('unknown','present','absent','conflict'));
alter table public.calendar_event_links drop constraint if exists calendar_event_links_reconcile_status_ck;
alter table public.calendar_event_links add constraint calendar_event_links_reconcile_status_ck check(reconcile_status in('due','processing','retry_wait','converged','manual_repair'));
alter table public.calendar_event_links drop constraint if exists calendar_event_links_processing_lease_ck;
alter table public.calendar_event_links add constraint calendar_event_links_processing_lease_ck check(reconcile_status<>'processing' or(reconcile_lease_token is not null and reconcile_lease_expires_at is not null and snapshot_appointment_version is not null and snapshot_desired_generation is not null)) not valid;
alter table public.calendar_event_links validate constraint calendar_event_links_processing_lease_ck;
create index if not exists calendar_event_links_convergence_due_idx on public.calendar_event_links(environment,reconcile_next_attempt_at) where reconcile_status in('due','processing','retry_wait');

create table if not exists public.booking_calendar_observations(
 id uuid primary key default gen_random_uuid(),
 link_id uuid not null references public.calendar_event_links(id) on delete cascade,
 appointment_id uuid not null,
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 destination_epoch_id uuid not null references public.calendar_destination_epochs(id),
 google_event_id text not null,
 desired_state text not null check(desired_state in('present','absent')),
 desired_generation bigint not null,
 appointment_version bigint not null,
 phase text not null check(phase in('probe','post_effect')),
 observed_state text not null check(observed_state in('present','absent','conflict')),
 observed_at timestamptz not null,
 observation_sha256 text not null check(observation_sha256~'^[a-f0-9]{64}$'),
 lease_token uuid not null,
 fencing_token bigint not null,
 created_at timestamptz not null default now(),
 foreign key(appointment_id,profile_id,environment) references public.appointments(id,profile_id,environment),
 unique(link_id,fencing_token,phase)
);
alter table public.booking_calendar_observations enable row level security;
revoke all on public.booking_calendar_observations from public,anon,authenticated;

create table if not exists public.booking_calendar_effect_attempts(
 id uuid primary key default gen_random_uuid(),
 link_id uuid not null references public.calendar_event_links(id) on delete cascade,
 appointment_id uuid not null,
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 destination_epoch_id uuid not null references public.calendar_destination_epochs(id),
 google_event_id text not null,
 action text not null check(action in('create','delete')),
 desired_generation bigint not null,
 appointment_version bigint not null,
 lease_token uuid not null,
 fencing_token bigint not null,
 outcome text check(outcome in('accepted','ambiguous','failed')),
 provider_status integer,
 outcome_sha256 text,
 started_at timestamptz not null default now(),
 completed_at timestamptz,
 foreign key(appointment_id,profile_id,environment) references public.appointments(id,profile_id,environment),
 unique(link_id,fencing_token,action),
 check(completed_at is null or(outcome is not null and outcome_sha256~'^[a-f0-9]{64}$'))
);
alter table public.booking_calendar_effect_attempts enable row level security;
revoke all on public.booking_calendar_effect_attempts from public,anon,authenticated;

-- V3 desired state replaces executable V2 calendar commands. Existing commands retain audit evidence.
update public.integration_outbox set state='dead_letter',terminal_at=coalesce(terminal_at,pg_catalog.clock_timestamp()),lease_token=null,lease_expires_at=null,safe_error='superseded_by_calendar_convergence_v3'
where effect_contract_version=2 and command_type in('calendar_create','calendar_cancel') and state in('pending','failed')or(effect_contract_version=2 and command_type in('calendar_create','calendar_cancel')and state='processing'and lease_expires_at<=pg_catalog.clock_timestamp());

create or replace function public.redirect_booking_calendar_outbox()returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if tg_op='INSERT'and new.effect_contract_version=2 and new.command_type in('calendar_create','calendar_cancel')then new.state:='dead_letter';new.terminal_at:=pg_catalog.clock_timestamp();new.lease_token:=null;new.lease_expires_at:=null;new.safe_error:='superseded_by_calendar_convergence_v3';elsif tg_op='UPDATE'and new.effect_contract_version=2 and new.command_type in('calendar_create','calendar_cancel')and old.state<>'processing'then new.state:='dead_letter';new.terminal_at:=pg_catalog.clock_timestamp();new.lease_token:=null;new.lease_expires_at:=null;new.safe_error:='superseded_by_calendar_convergence_v3';end if;
 return new;
end $function$;
drop trigger if exists integration_outbox_redirect_calendar_v3 on public.integration_outbox;
create trigger integration_outbox_redirect_calendar_v3 before insert or update of state on public.integration_outbox for each row execute function public.redirect_booking_calendar_outbox();
revoke all on function public.redirect_booking_calendar_outbox() from public,anon,authenticated;

create or replace function public.initialize_booking_calendar_desire()returns trigger language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;
begin
 select * into strict a from public.appointments where id=new.appointment_id and profile_id=new.profile_id and environment=new.environment;
 new.desired_state:=case when a.appointment_state='confirmed'then'present'else'absent'end;
 new.desired_generation:=greatest(coalesce(new.desired_generation,0),a.calendar_generation,1);
 new.desired_appointment_version:=a.version;
 new.observed_state:=coalesce(new.observed_state,'unknown');new.reconcile_status:='due';new.reconcile_next_attempt_at:=pg_catalog.clock_timestamp();new.reconcile_attempts:=0;new.drift_scan_count:=0;
 new.stability_scan_until:=case when a.appointment_state='confirmed'then a.start_at else pg_catalog.clock_timestamp()+interval '24 hours'end;
 return new;
end $function$;
drop trigger if exists calendar_event_links_initialize_desire_v3 on public.calendar_event_links;
create trigger calendar_event_links_initialize_desire_v3 before insert on public.calendar_event_links for each row execute function public.initialize_booking_calendar_desire();

create or replace function public.project_booking_calendar_desire()returns trigger language plpgsql security definer set search_path='' as $function$
declare v_desired text;
begin
 if new.appointment_state not in('confirmed','cancelled')then return new;end if;
 v_desired:=case when new.appointment_state='confirmed'then'present'else'absent'end;
 update public.calendar_event_links set desired_state=v_desired,desired_generation=case when desired_state<>v_desired then greatest(desired_generation+1,new.calendar_generation,1)else greatest(desired_generation,new.calendar_generation,1)end,desired_appointment_version=new.version,reconcile_status='due',reconcile_next_attempt_at=pg_catalog.clock_timestamp(),reconcile_attempts=0,reconcile_lease_token=null,reconcile_lease_expires_at=null,manual_repair_at=null,manual_repair_reason=null,drift_scan_count=0,stability_scan_until=case when v_desired='present'then new.start_at else pg_catalog.clock_timestamp()+interval '24 hours'end,updated_at=pg_catalog.clock_timestamp() where appointment_id=new.id and profile_id=new.profile_id and environment=new.environment and(desired_state<>v_desired or desired_generation<new.calendar_generation);
 return new;
end $function$;
drop trigger if exists appointments_project_calendar_desire_v3 on public.appointments;
create trigger appointments_project_calendar_desire_v3 after update of appointment_state,calendar_generation on public.appointments for each row execute function public.project_booking_calendar_desire();
revoke all on function public.initialize_booking_calendar_desire(),public.project_booking_calendar_desire() from public,anon,authenticated;

create or replace function public.enqueue_booking_calendar_create(p_appointment_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;s public.calendar_selections%rowtype;e public.calendar_destination_epochs%rowtype;event_id text;
begin
 select * into strict a from public.appointments where id=p_appointment_id and appointment_state='confirmed' for update;
 select * into strict s from public.calendar_selections where profile_id=a.profile_id and environment=a.environment and active and receives_bookings;
 select * into e from public.ensure_calendar_destination_epoch(a.profile_id,a.environment,s.connection_id,s.id);
 event_id:='obra'||pg_catalog.substr(pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array('obra-calendar-v3',a.environment,a.id)::text,'UTF8'),'sha256'),'hex'),1,48);
 insert into public.calendar_event_links(appointment_id,profile_id,connection_id,calendar_selection_id,environment,google_event_id,desired_appointment_version,sync_state,destination_epoch_id,desired_state,desired_generation,observed_state,reconcile_status,reconcile_next_attempt_at,reconcile_attempts,drift_scan_count,stability_scan_until)
 values(a.id,a.profile_id,s.connection_id,s.id,a.environment,event_id,a.version,'pending',e.id,'present',greatest(a.calendar_generation,1),'unknown','due',pg_catalog.clock_timestamp(),0,0,a.start_at)
 on conflict(appointment_id,environment)do update set desired_state='present',desired_generation=greatest(public.calendar_event_links.desired_generation,a.calendar_generation,1),desired_appointment_version=a.version,reconcile_status='due',reconcile_next_attempt_at=pg_catalog.clock_timestamp(),reconcile_attempts=0,manual_repair_at=null,manual_repair_reason=null,stability_scan_until=a.start_at,updated_at=pg_catalog.clock_timestamp()
 where public.calendar_event_links.google_event_id=excluded.google_event_id and public.calendar_event_links.destination_epoch_id=excluded.destination_epoch_id;
 return found;
end $function$;

create or replace function public.queue_booking_late_payment_refund(p_arbitration_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $function$
declare arb public.booking_late_payment_arbitrations%rowtype;a public.appointments%rowtype;p public.booking_payments%rowtype;v_generation bigint;
begin
 select * into strict arb from public.booking_late_payment_arbitrations where id=p_arbitration_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(arb.profile_id::text||':'||arb.environment||':booking',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(arb.appointment_id::text||':booking-appointment',0));
 select * into strict arb from public.booking_late_payment_arbitrations where id=p_arbitration_id for update;
 if arb.status in('recovered','refund_required')then return true;end if;
 select * into strict a from public.appointments where id=arb.appointment_id and profile_id=arb.profile_id and environment=arb.environment for update;
 select * into strict p from public.booking_payments where id=arb.payment_id and appointment_id=a.id for update;
 if p.payment_state<>'paid'then raise exception 'late-payment refund requires provider payment evidence' using errcode='P0001';end if;
 if p.amount_paid_minor>p.amount_refunded_minor and p.refund_state<>'succeeded'then
  v_generation:=case when a.refund_state='pending'and p.refund_state='pending'then greatest(a.refund_generation,p.refund_generation)else greatest(a.refund_generation,p.refund_generation)+1 end;
  update public.appointments set appointment_state='cancelled',appointment_reason='late_payment_refund',cancelled_at=coalesce(cancelled_at,pg_catalog.clock_timestamp()),payment_state='paid',refund_state='pending',review_state='late_payment',refund_generation=v_generation,version=version+1,updated_at=pg_catalog.clock_timestamp() where id=a.id returning * into a;
  update public.booking_payments set refund_state='pending',refund_requested_at=coalesce(refund_requested_at,pg_catalog.clock_timestamp()),refund_generation=v_generation,refund_idempotency_key='booking-refund:'||a.id||':'||v_generation,updated_at=pg_catalog.clock_timestamp() where id=p.id;
  insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)values(a.profile_id,a.environment,a.id,'refund','booking-refund:'||a.id||':'||v_generation,a.version,v_generation,2,pg_catalog.jsonb_build_object('amount',p.amount_paid_minor-p.amount_refunded_minor,'reason',left(coalesce(p_reason,'late_payment'),120)))on conflict(profile_id,environment,idempotency_key)do nothing;
 end if;
 update public.booking_late_payment_arbitrations set status='refund_required',decision_code=left(coalesce(p_reason,'late_payment_refund'),120),decided_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=arb.id;
 perform public.enqueue_booking_notification(a.id,'late_payment');
 return true;
end $function$;
revoke all on function public.queue_booking_late_payment_refund(uuid,text) from public,anon,authenticated,service_role,booking_worker;

-- Convert the durable financial reducer's provisional late-payment decision into a fresh
-- arbitration in the same transaction. No refund/cancellation notification is projected first.
create or replace function public.defer_future_late_payment_refund_v3()returns trigger language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;p public.booking_payments%rowtype;
begin
 if new.reduction_outcome not in('paid_arbitration_required','expiry_paid_arbitration_required')or (new.authority_kind='stripe_event'and new.event_id is null)or new.authority_kind not in('stripe_event','session_expiry')then return new;end if;
 select * into strict a from public.appointments where id=new.appointment_id and profile_id=new.profile_id and environment=new.environment for update;
 if a.start_at<=pg_catalog.clock_timestamp()then return new;end if;
 select * into strict p from public.booking_payments where id=new.payment_id and appointment_id=a.id and payment_state='paid'for update;
 if a.appointment_state<>'cancelled'or a.appointment_reason<>'late_payment_arbitration'or a.refund_state<>'not_requested'then raise exception'late-payment provisional state mismatch'using errcode='P0001';end if;
 insert into public.booking_late_payment_arbitrations(payment_id,appointment_id,provider_event_id,profile_id,environment,generation,deadline_at,snapshot_appointment_version)
 values(p.id,a.id,new.event_id,a.profile_id,a.environment,greatest(a.refund_generation,1),pg_catalog.clock_timestamp()+interval '2 minutes',a.version)
 on conflict(payment_id,generation)do nothing;
 return new;
end $function$;
drop trigger if exists booking_stripe_observation_late_arbitration_v3 on public.booking_stripe_observations_v3;
create trigger booking_stripe_observation_late_arbitration_v3 after insert on public.booking_stripe_observations_v3 for each row execute function public.defer_future_late_payment_refund_v3();
revoke all on function public.defer_future_late_payment_refund_v3() from public,anon,authenticated,service_role,booking_worker;

-- Session retrieval may expire a Checkout Session, but cannot project payment truth.
revoke execute on function public.claim_due_booking_sessions(text,uuid,integer),public.settle_due_booking_session(uuid,uuid,bigint,boolean,boolean,text,text,bigint,text) from service_role,booking_worker;

create or replace function public.claim_booking_late_payment_arbitrations(p_environment text,p_lease_token uuid,p_limit integer default 25)
returns table(arbitration jsonb,appointment jsonb,provider_context jsonb)language plpgsql security definer set search_path='' as $function$
declare candidate uuid;arb public.booking_late_payment_arbitrations%rowtype;a public.appointments%rowtype;c public.calendar_connections%rowtype;sched public.availability_schedules%rowtype;service public.booking_services%rowtype;ids jsonb;id_text text;
begin
 if p_lease_token is null or p_environment not in('test','live')then raise exception 'late-payment lease and environment required' using errcode='22023';end if;
 for candidate in select x.id from public.booking_late_payment_arbitrations x where x.environment=p_environment and public.booking_cutover_enabled(x.profile_id,x.environment)and x.status in('due','processing','retry_wait')and(x.status<>'processing'or x.lease_expires_at<=pg_catalog.clock_timestamp())and x.next_attempt_at<=pg_catalog.clock_timestamp()and x.deadline_at<=pg_catalog.clock_timestamp()order by x.deadline_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))loop perform public.queue_booking_late_payment_refund(candidate,'late_payment_arbitration_deadline');end loop;
 for candidate in select x.id from public.booking_late_payment_arbitrations x where x.environment=p_environment and public.booking_cutover_enabled(x.profile_id,x.environment)and x.status in('due','processing','retry_wait')and(x.status<>'processing'or x.lease_expires_at<=pg_catalog.clock_timestamp())and x.next_attempt_at<=pg_catalog.clock_timestamp()and x.deadline_at>pg_catalog.clock_timestamp()order by x.next_attempt_at,x.id for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))loop
  select * into strict arb from public.booking_late_payment_arbitrations where id=candidate for update;
  select * into strict a from public.appointments where id=arb.appointment_id and profile_id=arb.profile_id and environment=arb.environment;
  select * into c from public.calendar_connections where profile_id=arb.profile_id and environment=arb.environment;
  select coalesce(pg_catalog.jsonb_agg(x.google_calendar_id order by x.google_calendar_id),'[]'::jsonb),pg_catalog.string_agg(x.google_calendar_id,E'\n'order by x.google_calendar_id)into ids,id_text from public.calendar_selections x where x.profile_id=arb.profile_id and x.environment=arb.environment and x.active and x.blocks_availability;
  select * into sched from public.availability_schedules where profile_id=arb.profile_id and environment=arb.environment and active;
  select * into service from public.booking_services where id=a.service_id and profile_id=arb.profile_id and environment=arb.environment and active;
  update public.booking_late_payment_arbitrations set status='processing',attempts=attempts+1,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval '90 seconds',fencing_token=fencing_token+1,snapshot_generation=snapshot_generation+1,snapshot_appointment_version=a.version,snapshot_connection_id=c.id,snapshot_pipedream_account_id=c.pipedream_account_id,snapshot_availability_generation=c.availability_generation,snapshot_calendar_ids=ids,snapshot_calendar_set_hash=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(id_text,''),'UTF8'),'sha256'),'hex'),snapshot_schedule_revision=sched.revision,snapshot_service_revision=service.revision,claimed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()where id=arb.id returning * into arb;
  return query select pg_catalog.to_jsonb(arb),pg_catalog.to_jsonb(a),pg_catalog.jsonb_build_object('connectionId',arb.snapshot_connection_id,'accountId',arb.snapshot_pipedream_account_id,'availabilityGeneration',arb.snapshot_availability_generation,'calendarIds',arb.snapshot_calendar_ids,'calendarSetHash',arb.snapshot_calendar_set_hash,'rangeStart',a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),'rangeEnd',a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'scheduleRevision',arb.snapshot_schedule_revision,'serviceRevision',arb.snapshot_service_revision);
 end loop;
end $function$;

create or replace function public.renew_booking_late_payment_arbitration_v3(p_arbitration_id uuid,p_lease_token uuid,p_fencing_token bigint,p_snapshot_generation bigint,p_lease_seconds integer default 90)
returns boolean language plpgsql security definer set search_path=''as $function$
begin
 if p_lease_token is null or p_lease_seconds not between 30 and 180 then raise exception'invalid late-payment lease renewal'using errcode='22023';end if;
 update public.booking_late_payment_arbitrations set lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),updated_at=pg_catalog.clock_timestamp()where id=p_arbitration_id and status='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and snapshot_generation=p_snapshot_generation and lease_expires_at>pg_catalog.clock_timestamp();return found;
end $function$;

create or replace function public.record_booking_late_payment_observation(p_arbitration_id uuid,p_lease_token uuid,p_fencing_token bigint,p_snapshot_generation bigint,p_observed_at timestamptz,p_observation_state text,p_busy_ranges jsonb,p_safe_error text default null)
returns text language plpgsql security definer set search_path='' as $function$
declare arb public.booking_late_payment_arbitrations%rowtype;a public.appointments%rowtype;c public.calendar_connections%rowtype;sched public.availability_schedules%rowtype;service public.booking_services%rowtype;ids jsonb;id_text text;request_hash text;response_hash text;config_current boolean:=false;policy_current boolean:=false;busy boolean:=false;internal_busy boolean:=false;delay_seconds integer;
begin
 if p_lease_token is null or p_observation_state not in('complete','transient_error','permanent_error')or pg_catalog.jsonb_typeof(coalesce(p_busy_ranges,'null'::jsonb))<>'array'then raise exception 'invalid late-payment observation' using errcode='22023';end if;
 select * into strict arb from public.booking_late_payment_arbitrations where id=p_arbitration_id and status='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and snapshot_generation=p_snapshot_generation and lease_expires_at>pg_catalog.clock_timestamp()for update;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(arb.profile_id::text||':'||arb.environment||':booking',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(arb.appointment_id::text||':booking-appointment',0));
 select * into strict a from public.appointments where id=arb.appointment_id and profile_id=arb.profile_id and environment=arb.environment for update;
 request_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('accountId',arb.snapshot_pipedream_account_id,'calendarIds',arb.snapshot_calendar_ids,'rangeStart',a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),'rangeEnd',a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'snapshotGeneration',arb.snapshot_generation)::text,'UTF8'),'sha256'),'hex');
 response_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('state',p_observation_state,'observedAt',p_observed_at,'busyRanges',coalesce(p_busy_ranges,'[]'::jsonb))::text,'UTF8'),'sha256'),'hex');
 insert into public.booking_late_payment_observations(arbitration_id,snapshot_generation,observation_state,observed_at,busy_ranges,request_sha256,response_sha256,safe_error,lease_token,fencing_token)values(arb.id,arb.snapshot_generation,p_observation_state,p_observed_at,coalesce(p_busy_ranges,'[]'::jsonb),request_hash,response_hash,left(p_safe_error,240),p_lease_token,p_fencing_token);
 if p_observation_state='transient_error'then
  if arb.attempts>=4 or arb.deadline_at<=pg_catalog.clock_timestamp()+interval '5 seconds'then perform public.queue_booking_late_payment_refund(arb.id,'late_payment_freebusy_retry_exhausted');return'refund_required';end if;
  delay_seconds:=1+mod(abs(pg_catalog.hashtextextended(arb.id::text||':'||arb.fencing_token,0))::numeric,least(30,5*pg_catalog.power(2,arb.attempts-1)::integer)::numeric)::integer;
  update public.booking_late_payment_arbitrations set status='retry_wait',next_attempt_at=least(deadline_at,pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>delay_seconds)),lease_token=null,lease_expires_at=null,decision_code='freebusy_transient_error',updated_at=pg_catalog.clock_timestamp()where id=arb.id;return'retry';
 elsif p_observation_state='permanent_error'then perform public.queue_booking_late_payment_refund(arb.id,'late_payment_freebusy_unavailable');return'refund_required';end if;
 if p_observed_at<arb.claimed_at or p_observed_at<pg_catalog.clock_timestamp()-interval '30 seconds'or p_observed_at>pg_catalog.clock_timestamp()+interval '1 minute'then raise exception 'stale late-payment provider observation' using errcode='40001';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_busy_ranges)r where pg_catalog.jsonb_typeof(r)<>'object'or not(r?'start'and r?'end'))then raise exception 'invalid FreeBusy range evidence' using errcode='22023';end if;
 select * into c from public.calendar_connections where id=arb.snapshot_connection_id and profile_id=arb.profile_id and environment=arb.environment;
 select coalesce(pg_catalog.jsonb_agg(x.google_calendar_id order by x.google_calendar_id),'[]'::jsonb),pg_catalog.string_agg(x.google_calendar_id,E'\n'order by x.google_calendar_id)into ids,id_text from public.calendar_selections x where x.profile_id=arb.profile_id and x.environment=arb.environment and x.active and x.blocks_availability;
 select * into sched from public.availability_schedules where profile_id=arb.profile_id and environment=arb.environment and active;
 select * into service from public.booking_services where id=a.service_id and profile_id=arb.profile_id and environment=arb.environment and active;
 config_current:=c.id is not null and c.health_state='healthy'and c.pipedream_account_id=arb.snapshot_pipedream_account_id and c.availability_generation=arb.snapshot_availability_generation and ids=arb.snapshot_calendar_ids and pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(id_text,''),'UTF8'),'sha256'),'hex')=arb.snapshot_calendar_set_hash and sched.revision=arb.snapshot_schedule_revision and service.revision=arb.snapshot_service_revision and a.version=arb.snapshot_appointment_version;
 policy_current:=config_current and a.start_at>=pg_catalog.clock_timestamp()+pg_catalog.make_interval(mins=>service.minimum_notice_minutes)and a.appointment_state='cancelled'and a.appointment_reason='late_payment_arbitration'and a.refund_state not in('pending','succeeded')and a.time_zone=sched.time_zone and a.schedule_revision=sched.revision and(coalesce((a.service_snapshot->>'revision')::bigint,service.revision)=service.revision)and not exists(select 1 from public.availability_overrides o where o.schedule_id=sched.id and o.local_date=a.local_date and o.override_type='unavailable')and((exists(select 1 from public.availability_overrides o join public.availability_override_intervals oi on oi.override_id=o.id where o.schedule_id=sched.id and o.local_date=a.local_date and o.override_type='custom_hours'and a.local_start>=oi.local_start and(a.end_at at time zone a.time_zone)::time<=oi.local_end))or(not exists(select 1 from public.availability_overrides o where o.schedule_id=sched.id and o.local_date=a.local_date and o.override_type='custom_hours')and exists(select 1 from public.availability_intervals ai where ai.schedule_id=sched.id and ai.weekday=extract(dow from a.local_date)::integer and a.local_start>=ai.local_start and(a.end_at at time zone a.time_zone)::time<=ai.local_end)));
 busy:=exists(select 1 from pg_catalog.jsonb_array_elements(p_busy_ranges)r where tstzrange((r->>'start')::timestamptz,(r->>'end')::timestamptz,'[)')&&tstzrange(a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'[)'));
 internal_busy:=exists(select 1 from public.appointments x where x.id<>a.id and x.profile_id=a.profile_id and x.environment=a.environment and x.appointment_state in('held','payment_pending','confirmed')and tstzrange(x.start_at-pg_catalog.make_interval(mins=>x.buffer_before_minutes),x.end_at+pg_catalog.make_interval(mins=>x.buffer_after_minutes),'[)')&&tstzrange(a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'[)'));
 if not config_current then
  if arb.attempts<4 and arb.deadline_at>pg_catalog.clock_timestamp()+interval '5 seconds'then update public.booking_late_payment_arbitrations set status='retry_wait',next_attempt_at=pg_catalog.clock_timestamp()+interval '5 seconds',lease_token=null,lease_expires_at=null,decision_code='configuration_changed',updated_at=pg_catalog.clock_timestamp()where id=arb.id;return'retry';end if;
  perform public.queue_booking_late_payment_refund(arb.id,'late_payment_configuration_changed');return'refund_required';
 end if;
 if not policy_current or busy or internal_busy then perform public.queue_booking_late_payment_refund(arb.id,case when busy then'late_payment_google_conflict'when internal_busy then'late_payment_internal_conflict'else'late_payment_policy_changed'end);return'refund_required';end if;
 begin
  update public.appointments set appointment_state='confirmed',appointment_reason='late_payment_recovered',confirmed_at=coalesce(confirmed_at,pg_catalog.clock_timestamp()),cancelled_at=null,payment_state='paid',calendar_state='create_pending',calendar_generation=calendar_generation+1,review_state='late_payment',version=version+1,updated_at=pg_catalog.clock_timestamp()where id=a.id and version=arb.snapshot_appointment_version returning * into a;
 exception when exclusion_violation then perform public.queue_booking_late_payment_refund(arb.id,'late_payment_exclusion_conflict');return'refund_required';end;
 if a.id is null then raise exception 'stale late-payment appointment version' using errcode='40001';end if;
 perform public.enqueue_booking_calendar_create(a.id);
 update public.booking_late_payment_arbitrations set status='recovered',decision_code='fresh_freebusy_clear',decided_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where id=arb.id;
 perform public.enqueue_booking_notification(a.id,'late_payment');
 return'recovered';
end $function$;

create or replace function public.claim_due_booking_outbox(p_lease_token uuid,p_limit integer default 25)
returns setof public.integration_outbox language plpgsql security definer set search_path='' as $function$
begin
 if p_lease_token is null then raise exception 'lease required' using errcode='22023';end if;
 return query with due as(select o.id from public.integration_outbox o join public.appointments a on a.id=o.appointment_id and a.profile_id=o.profile_id and a.environment=o.environment join public.booking_payments p on p.appointment_id=a.id and p.profile_id=a.profile_id and p.environment=a.environment where public.booking_cutover_enabled(o.profile_id,o.environment)and o.effect_contract_version=2 and o.command_type='refund'and o.state in('pending','failed','processing')and o.terminal_at is null and o.next_attempt_at<=pg_catalog.clock_timestamp()and(o.lease_expires_at is null or o.lease_expires_at<=pg_catalog.clock_timestamp())and o.effect_generation=a.refund_generation and o.effect_generation=p.refund_generation and a.refund_state='pending'and p.refund_state='pending'and p.amount_paid_minor>p.amount_refunded_minor order by o.next_attempt_at,o.id for update of o skip locked limit greatest(1,least(coalesce(p_limit,25),100)))update public.integration_outbox o set state='processing',attempts=o.attempts+1,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',fencing_token=o.fencing_token+1 from due where o.id=due.id returning o.*;
end $function$;

create or replace function public.claim_booking_calendar_reconciliation(p_environment text,p_lease_token uuid,p_limit integer default 25)
returns table(link jsonb,appointment jsonb,epoch jsonb)language plpgsql security definer set search_path='' as $function$
begin
 if p_lease_token is null or p_environment not in('test','live')then raise exception 'calendar convergence lease required' using errcode='22023';end if;
 update public.calendar_event_links l set desired_state=case when a.appointment_state='confirmed'then'present'else'absent'end,desired_generation=greatest(l.desired_generation+1,a.calendar_generation,1),desired_appointment_version=a.version,reconcile_status='due',reconcile_next_attempt_at=pg_catalog.clock_timestamp(),reconcile_attempts=0,reconcile_lease_token=null,reconcile_lease_expires_at=null,drift_scan_count=0,stability_scan_until=case when a.appointment_state='confirmed'then a.start_at else pg_catalog.clock_timestamp()+interval '24 hours'end,updated_at=pg_catalog.clock_timestamp()from public.appointments a where a.id=l.appointment_id and a.profile_id=l.profile_id and a.environment=l.environment and l.environment=p_environment and l.desired_state<>case when a.appointment_state='confirmed'then'present'else'absent'end;
 return query with due as(select l.id from public.calendar_event_links l join public.appointments a on a.id=l.appointment_id and a.profile_id=l.profile_id and a.environment=l.environment where l.environment=p_environment and public.booking_cutover_enabled(l.profile_id,l.environment)and l.destination_epoch_id is not null and l.reconcile_status in('due','processing','retry_wait')and l.reconcile_next_attempt_at<=pg_catalog.clock_timestamp()and(l.reconcile_status<>'processing'or l.reconcile_lease_expires_at<=pg_catalog.clock_timestamp())order by l.reconcile_next_attempt_at,l.id for update of l skip locked limit greatest(1,least(coalesce(p_limit,25),100))),claimed as(update public.calendar_event_links l set reconcile_status='processing',reconcile_attempts=l.reconcile_attempts+1,reconcile_lease_token=p_lease_token,reconcile_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',reconcile_fencing_token=l.reconcile_fencing_token+1,snapshot_appointment_version=a.version,snapshot_desired_generation=l.desired_generation,desired_appointment_version=a.version,last_attempt_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()from due d,public.appointments a where l.id=d.id and a.id=l.appointment_id and a.profile_id=l.profile_id and a.environment=l.environment returning l.*)select pg_catalog.to_jsonb(c),pg_catalog.to_jsonb(a),pg_catalog.to_jsonb(e)from claimed c join public.appointments a on a.id=c.appointment_id and a.profile_id=c.profile_id and a.environment=c.environment join public.calendar_destination_epochs e on e.id=c.destination_epoch_id;
end $function$;

create or replace function public.fail_booking_calendar_convergence(p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,p_retryable boolean,p_safe_error text)
returns boolean language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;a public.appointments%rowtype;cap integer;delay_seconds integer;
begin
 select * into strict l from public.calendar_event_links where id=p_link_id and reconcile_status='processing'and reconcile_lease_token=p_lease_token and reconcile_fencing_token=p_fencing_token and snapshot_desired_generation=p_expected_generation and snapshot_appointment_version=p_expected_appointment_version and reconcile_lease_expires_at>pg_catalog.clock_timestamp()for update;
 select * into strict a from public.appointments where id=l.appointment_id and version=p_expected_appointment_version for update;
 if not p_retryable or l.reconcile_attempts>=8 then
  update public.calendar_event_links set reconcile_status='manual_repair',sync_state='failed',safe_error=left(coalesce(p_safe_error,'calendar_provider_failure'),240),manual_repair_at=pg_catalog.clock_timestamp(),manual_repair_reason=case when p_retryable then'retry_exhausted'else'permanent_provider_failure'end,reconcile_lease_token=null,reconcile_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where id=l.id;
  update public.appointments set calendar_state=case when l.desired_state='present'then'create_failed'else'cancel_failed'end,review_state='calendar_reconciliation',updated_at=pg_catalog.clock_timestamp()where id=a.id;perform public.enqueue_booking_notification(a.id,'calendar_failed');return true;
 end if;
 cap:=least(1800,30*pg_catalog.power(2,l.reconcile_attempts-1)::integer);delay_seconds:=1+mod(abs(pg_catalog.hashtextextended(l.id::text||':'||l.reconcile_fencing_token,0))::numeric,cap::numeric)::integer;
 update public.calendar_event_links set reconcile_status='retry_wait',reconcile_next_attempt_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>delay_seconds),safe_error=left(coalesce(p_safe_error,'calendar_provider_retry'),240),ambiguity_started_at=coalesce(ambiguity_started_at,pg_catalog.clock_timestamp()),reconcile_lease_token=null,reconcile_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where id=l.id;return true;
end $function$;

create or replace function public.record_booking_calendar_observation(p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,p_phase text,p_observed_state text,p_observed_at timestamptz,p_evidence jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;a public.appointments%rowtype;v_hash text;v_action text;v_next timestamptz;v_scan integer;
begin
 if p_lease_token is null or p_phase not in('probe','post_effect')or p_observed_state not in('present','absent','conflict')or p_observed_at<pg_catalog.clock_timestamp()-interval '2 minutes'or p_observed_at>pg_catalog.clock_timestamp()+interval '1 minute'then raise exception 'invalid calendar observation' using errcode='22023';end if;
 select * into strict l from public.calendar_event_links where id=p_link_id and reconcile_status='processing'and reconcile_lease_token=p_lease_token and reconcile_fencing_token=p_fencing_token and snapshot_desired_generation=p_expected_generation and snapshot_appointment_version=p_expected_appointment_version and desired_generation=p_expected_generation and google_event_id is not null and destination_epoch_id is not null and reconcile_lease_expires_at>pg_catalog.clock_timestamp()for update;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(l.appointment_id::text||':booking-appointment',0));
 select * into strict a from public.appointments where id=l.appointment_id and profile_id=l.profile_id and environment=l.environment and version=p_expected_appointment_version for update;
 if l.desired_state<>(case when a.appointment_state='confirmed'then'present'else'absent'end) then raise exception 'stale calendar desired-state snapshot' using errcode='40001';end if;
 v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('eventId',l.google_event_id,'appointmentId',l.appointment_id,'state',p_observed_state,'observedAt',p_observed_at,'evidence',coalesce(p_evidence,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
 insert into public.booking_calendar_observations(link_id,appointment_id,profile_id,environment,destination_epoch_id,google_event_id,desired_state,desired_generation,appointment_version,phase,observed_state,observed_at,observation_sha256,lease_token,fencing_token)values(l.id,l.appointment_id,l.profile_id,l.environment,l.destination_epoch_id,l.google_event_id,l.desired_state,l.desired_generation,a.version,p_phase,p_observed_state,p_observed_at,v_hash,p_lease_token,p_fencing_token);
 update public.calendar_event_links set observed_state=p_observed_state,last_observed_at=p_observed_at,last_observation_sha256=v_hash where id=l.id;
 if p_observed_state='conflict'then
  update public.calendar_event_links set reconcile_status='manual_repair',sync_state='failed',safe_error='calendar_identity_conflict',manual_repair_at=pg_catalog.clock_timestamp(),manual_repair_reason='calendar_identity_conflict',reconcile_lease_token=null,reconcile_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where id=l.id;
  update public.appointments set calendar_state=case when l.desired_state='present'then'create_failed'else'cancel_failed'end,review_state='calendar_reconciliation',updated_at=pg_catalog.clock_timestamp()where id=a.id;perform public.enqueue_booking_notification(a.id,'calendar_failed');return pg_catalog.jsonb_build_object('action','manual_repair');
 end if;
 if l.desired_state='present'and p_observed_state='absent'and p_phase='probe'then return pg_catalog.jsonb_build_object('action','create');end if;
 if l.desired_state='absent'and p_observed_state='present'and p_phase='probe'then return pg_catalog.jsonb_build_object('action','delete');end if;
 if(l.desired_state='present'and p_observed_state='absent')or(l.desired_state='absent'and p_observed_state='present')then
  perform public.fail_booking_calendar_convergence(l.id,p_lease_token,p_fencing_token,p_expected_generation,p_expected_appointment_version,true,'calendar_effect_not_yet_visible');return pg_catalog.jsonb_build_object('action','retry');
 end if;
 v_scan:=l.drift_scan_count+1;
 if l.desired_state='present'then
  update public.appointments set calendar_state='created',review_state=case when review_state='calendar_reconciliation'then'none'else review_state end,updated_at=pg_catalog.clock_timestamp()where id=a.id;
  if a.start_at>pg_catalog.clock_timestamp()+interval '6 hours'then v_next:=pg_catalog.clock_timestamp()+interval '6 hours';elsif a.start_at>pg_catalog.clock_timestamp()then v_next:=a.start_at;else v_next:=null;end if;
 else
  update public.appointments set calendar_state='cancelled',review_state=case when review_state='calendar_reconciliation'then'none'else review_state end,updated_at=pg_catalog.clock_timestamp()where id=a.id;
  v_next:=case v_scan when 1 then pg_catalog.clock_timestamp()+interval '15 seconds'when 2 then pg_catalog.clock_timestamp()+interval '60 seconds'when 3 then pg_catalog.clock_timestamp()+interval '5 minutes'when 4 then pg_catalog.clock_timestamp()+interval '30 minutes'when 5 then pg_catalog.clock_timestamp()+interval '6 hours'else l.stability_scan_until end;
  if v_next is not null and v_next>l.stability_scan_until then v_next:=l.stability_scan_until;end if;
  if l.stability_scan_until<=pg_catalog.clock_timestamp()then v_next:=null;end if;
 end if;
 update public.calendar_event_links set sync_state=case when l.desired_state='present'then'created'else'cancelled'end,reconcile_status=case when v_next is null then'converged'else'retry_wait'end,reconcile_next_attempt_at=coalesce(v_next,reconcile_next_attempt_at),reconcile_attempts=0,drift_scan_count=v_scan,reconcile_lease_token=null,reconcile_lease_expires_at=null,safe_error=null,ambiguity_started_at=null,updated_at=pg_catalog.clock_timestamp()where id=l.id;
 return pg_catalog.jsonb_build_object('action','converged','nextProbeAt',v_next);
end $function$;

create or replace function public.renew_booking_calendar_reconciliation_v3(p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path=''as $function$
begin
 if p_lease_token is null or p_lease_seconds not between 30 and 240 then raise exception'invalid calendar lease renewal'using errcode='22023';end if;
 update public.calendar_event_links set reconcile_lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),updated_at=pg_catalog.clock_timestamp()where id=p_link_id and reconcile_status='processing'and reconcile_lease_token=p_lease_token and reconcile_fencing_token=p_fencing_token and desired_generation=p_expected_generation and snapshot_appointment_version=p_expected_appointment_version and reconcile_lease_expires_at>pg_catalog.clock_timestamp();return found;
end $function$;

create or replace function public.renew_booking_calendar_reconciliation_v3(p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path=''as $function$
begin
 if p_lease_token is null or p_lease_seconds not between 30 and 240 then raise exception'invalid calendar lease renewal'using errcode='22023';end if;
 update public.calendar_event_links set reconcile_lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),updated_at=pg_catalog.clock_timestamp()where id=p_link_id and reconcile_status='processing'and reconcile_lease_token=p_lease_token and reconcile_fencing_token=p_fencing_token and desired_generation=p_expected_generation and snapshot_appointment_version=p_expected_appointment_version and reconcile_lease_expires_at>pg_catalog.clock_timestamp();return found;
end $function$;

create or replace function public.begin_booking_calendar_effect(p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,p_action text)
returns uuid language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;a public.appointments%rowtype;result uuid;
begin
 if p_action not in('create','delete')then raise exception 'invalid calendar effect action' using errcode='22023';end if;
 select * into strict l from public.calendar_event_links where id=p_link_id and reconcile_status='processing'and reconcile_lease_token=p_lease_token and reconcile_fencing_token=p_fencing_token and desired_generation=p_expected_generation and snapshot_desired_generation=p_expected_generation and snapshot_appointment_version=p_expected_appointment_version and reconcile_lease_expires_at>pg_catalog.clock_timestamp()for update;
 select * into strict a from public.appointments where id=l.appointment_id and version=p_expected_appointment_version for update;
 if(p_action='create'and(l.desired_state<>'present'or a.appointment_state<>'confirmed'))or(p_action='delete'and(l.desired_state<>'absent'or a.appointment_state<>'cancelled'))then raise exception 'stale calendar effect desire' using errcode='40001';end if;
 insert into public.booking_calendar_effect_attempts(link_id,appointment_id,profile_id,environment,destination_epoch_id,google_event_id,action,desired_generation,appointment_version,lease_token,fencing_token)values(l.id,l.appointment_id,l.profile_id,l.environment,l.destination_epoch_id,l.google_event_id,p_action,l.desired_generation,a.version,p_lease_token,p_fencing_token)returning id into result;
 update public.calendar_event_links set ambiguity_started_at=coalesce(ambiguity_started_at,pg_catalog.clock_timestamp())where id=l.id;
 return result;
end $function$;

create or replace function public.record_booking_calendar_effect_result(p_effect_id uuid,p_lease_token uuid,p_fencing_token bigint,p_outcome text,p_provider_status integer,p_evidence jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path='' as $function$
declare e public.booking_calendar_effect_attempts%rowtype;l public.calendar_event_links%rowtype;v_hash text;
begin
 if p_outcome not in('accepted','ambiguous','failed')then raise exception 'invalid calendar effect outcome' using errcode='22023';end if;
 select * into strict e from public.booking_calendar_effect_attempts where id=p_effect_id and lease_token=p_lease_token and fencing_token=p_fencing_token and completed_at is null for update;
 select * into strict l from public.calendar_event_links where id=e.link_id and reconcile_status='processing'and reconcile_lease_token=p_lease_token and reconcile_fencing_token=p_fencing_token and reconcile_lease_expires_at>pg_catalog.clock_timestamp()and desired_generation=e.desired_generation and snapshot_appointment_version=e.appointment_version for update;
 v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('action',e.action,'eventId',e.google_event_id,'destinationEpochId',e.destination_epoch_id,'outcome',p_outcome,'providerStatus',p_provider_status,'evidence',coalesce(p_evidence,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
 perform pg_catalog.set_config('obra.booking_calendar_effect_settle','allowed',true);
 update public.booking_calendar_effect_attempts set outcome=p_outcome,provider_status=p_provider_status,outcome_sha256=v_hash,completed_at=pg_catalog.clock_timestamp()where id=e.id;
 perform pg_catalog.set_config('obra.booking_calendar_effect_settle','',true);
 return true;
end $function$;

create or replace function public.reject_booking_convergence_evidence_mutation()returns trigger language plpgsql security definer set search_path='' as $function$
begin
 if tg_table_name='booking_calendar_effect_attempts'and tg_op='UPDATE'and pg_catalog.current_setting('obra.booking_calendar_effect_settle',true)='allowed'and old.completed_at is null and new.completed_at is not null and new.id=old.id and new.link_id=old.link_id and new.appointment_id=old.appointment_id and new.profile_id=old.profile_id and new.environment=old.environment and new.destination_epoch_id=old.destination_epoch_id and new.google_event_id=old.google_event_id and new.action=old.action and new.desired_generation=old.desired_generation and new.appointment_version=old.appointment_version and new.lease_token=old.lease_token and new.fencing_token=old.fencing_token then return new;end if;
 raise exception 'booking convergence evidence is immutable' using errcode='P0001';
end $function$;
revoke all on function public.reject_booking_convergence_evidence_mutation() from public,anon,authenticated,service_role,booking_worker;

drop trigger if exists booking_convergence_snapshots_immutable on public.booking_convergence_cutover_snapshots;
create trigger booking_convergence_snapshots_immutable before update or delete on public.booking_convergence_cutover_snapshots for each row execute function public.reject_booking_convergence_evidence_mutation();
drop trigger if exists booking_convergence_snapshots_no_truncate on public.booking_convergence_cutover_snapshots;
create trigger booking_convergence_snapshots_no_truncate before truncate on public.booking_convergence_cutover_snapshots for each statement execute function public.reject_booking_convergence_evidence_mutation();
drop trigger if exists booking_late_observations_immutable on public.booking_late_payment_observations;
create trigger booking_late_observations_immutable before update or delete on public.booking_late_payment_observations for each row execute function public.reject_booking_convergence_evidence_mutation();
drop trigger if exists booking_late_observations_no_truncate on public.booking_late_payment_observations;
create trigger booking_late_observations_no_truncate before truncate on public.booking_late_payment_observations for each statement execute function public.reject_booking_convergence_evidence_mutation();
drop trigger if exists booking_calendar_observations_immutable on public.booking_calendar_observations;
create trigger booking_calendar_observations_immutable before update or delete on public.booking_calendar_observations for each row execute function public.reject_booking_convergence_evidence_mutation();
drop trigger if exists booking_calendar_observations_no_truncate on public.booking_calendar_observations;
create trigger booking_calendar_observations_no_truncate before truncate on public.booking_calendar_observations for each statement execute function public.reject_booking_convergence_evidence_mutation();
drop trigger if exists booking_calendar_attempts_immutable on public.booking_calendar_effect_attempts;
create trigger booking_calendar_attempts_immutable before update or delete on public.booking_calendar_effect_attempts for each row execute function public.reject_booking_convergence_evidence_mutation();
drop trigger if exists booking_calendar_attempts_no_truncate on public.booking_calendar_effect_attempts;
create trigger booking_calendar_attempts_no_truncate before truncate on public.booking_calendar_effect_attempts for each statement execute function public.reject_booking_convergence_evidence_mutation();

create table if not exists public.booking_calendar_repair_audit(
 id bigint generated always as identity primary key,
 link_id uuid not null references public.calendar_event_links(id) on delete restrict,
 profile_id uuid not null,
 environment text not null check(environment in('test','live')),
 expected_generation bigint not null,
 actor_user_id uuid not null references auth.users(id),
 reason text not null check(char_length(btrim(reason))between 3 and 500),
 prior_state jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.booking_calendar_repair_audit enable row level security;
revoke all on public.booking_calendar_repair_audit from public,anon,authenticated,service_role,booking_worker;
drop trigger if exists booking_calendar_repair_audit_immutable on public.booking_calendar_repair_audit;
create trigger booking_calendar_repair_audit_immutable before update or delete on public.booking_calendar_repair_audit for each row execute function public.reject_booking_convergence_evidence_mutation();

create or replace function public.requeue_booking_calendar_manual_repair(p_link_id uuid,p_expected_generation bigint,p_actor_token_hash text,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;actor_user_id uuid;
begin
 if p_actor_token_hash!~'^[a-f0-9]{64}$'or char_length(pg_catalog.btrim(coalesce(p_reason,'')))not between 3 and 500 then raise exception 'repair actor session and reason required' using errcode='22023';end if;
 select s.user_id into actor_user_id from public.admin_sessions s join public.admin_principals p on p.user_id=s.user_id and p.auth_epoch=s.auth_epoch where s.token_hash=p_actor_token_hash and p.enabled and p.mfa_required and p.role='admin'and s.aal='aal2'and s.role='admin'and s.revoked_at is null and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp();
 if actor_user_id is null then raise exception 'admin actor session required' using errcode='42501';end if;
 select * into strict l from public.calendar_event_links where id=p_link_id and desired_generation=p_expected_generation and reconcile_status='manual_repair'for update;
 insert into public.booking_calendar_repair_audit(link_id,profile_id,environment,expected_generation,actor_user_id,reason,prior_state)values(l.id,l.profile_id,l.environment,l.desired_generation,actor_user_id,pg_catalog.btrim(p_reason),pg_catalog.to_jsonb(l));
 update public.calendar_event_links set reconcile_status='due',reconcile_next_attempt_at=pg_catalog.clock_timestamp(),reconcile_attempts=0,reconcile_lease_token=null,reconcile_lease_expires_at=null,manual_repair_at=null,manual_repair_reason=null,updated_at=pg_catalog.clock_timestamp()where id=l.id;
 return true;
end $function$;
revoke all on function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text) from public,anon,authenticated,booking_worker;
grant execute on function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text) to service_role;

revoke all on function public.claim_booking_late_payment_arbitrations(text,uuid,integer),public.renew_booking_late_payment_arbitration_v3(uuid,uuid,bigint,bigint,integer),public.record_booking_late_payment_observation(uuid,uuid,bigint,bigint,timestamptz,text,jsonb,text),public.claim_booking_calendar_reconciliation(text,uuid,integer),public.renew_booking_calendar_reconciliation_v3(uuid,uuid,bigint,bigint,bigint,integer),public.fail_booking_calendar_convergence(uuid,uuid,bigint,bigint,bigint,boolean,text),public.record_booking_calendar_observation(uuid,uuid,bigint,bigint,bigint,text,text,timestamptz,jsonb),public.begin_booking_calendar_effect(uuid,uuid,bigint,bigint,bigint,text),public.record_booking_calendar_effect_result(uuid,uuid,bigint,text,integer,jsonb) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.claim_booking_late_payment_arbitrations(text,uuid,integer),public.renew_booking_late_payment_arbitration_v3(uuid,uuid,bigint,bigint,integer),public.record_booking_late_payment_observation(uuid,uuid,bigint,bigint,timestamptz,text,jsonb,text),public.claim_booking_calendar_reconciliation(text,uuid,integer),public.renew_booking_calendar_reconciliation_v3(uuid,uuid,bigint,bigint,bigint,integer),public.fail_booking_calendar_convergence(uuid,uuid,bigint,bigint,bigint,boolean,text),public.record_booking_calendar_observation(uuid,uuid,bigint,bigint,bigint,text,text,timestamptz,jsonb),public.begin_booking_calendar_effect(uuid,uuid,bigint,bigint,bigint,text),public.record_booking_calendar_effect_result(uuid,uuid,bigint,text,integer,jsonb) to booking_worker;
grant execute on function public.claim_due_booking_outbox(uuid,integer) to booking_worker;
revoke all on function public.enqueue_booking_calendar_create(uuid),public.queue_booking_late_payment_refund(uuid,text) from public,anon,authenticated,service_role,booking_worker;

-- Final admission uses the committed 180000 cutover state and its accepted preflight.
-- There is deliberately no convergence activation RPC and no booking_cutover_enabled override.
create or replace function public.reject_booking_convergence_snapshot_mutation_v3()returns trigger language plpgsql set search_path=''as $function$
begin raise exception 'booking convergence evidence is immutable' using errcode='55000';end $function$;
drop trigger if exists booking_convergence_snapshots_immutable_v3 on public.booking_convergence_cutover_snapshots;
create trigger booking_convergence_snapshots_immutable_v3 before update or delete on public.booking_convergence_cutover_snapshots for each row execute function public.reject_booking_convergence_snapshot_mutation_v3();
drop trigger if exists booking_convergence_snapshots_no_truncate_v3 on public.booking_convergence_cutover_snapshots;
create trigger booking_convergence_snapshots_no_truncate_v3 before truncate on public.booking_convergence_cutover_snapshots for each statement execute function public.reject_booking_convergence_snapshot_mutation_v3();
revoke all on function public.reject_booking_convergence_snapshot_mutation_v3(),public.booking_convergence_cutover_inventory(uuid,text),public.prepare_booking_convergence_cutover(uuid,text),public.activate_booking_cutover_v3(uuid)from public,anon,authenticated,service_role,booking_worker;
revoke execute on function public.activate_booking_cutover(uuid,text,text)from service_role,booking_worker;
grant execute on function public.booking_convergence_cutover_inventory(uuid,text),public.prepare_booking_convergence_cutover(uuid,text),public.activate_booking_cutover_v3(uuid),public.booking_cutover_enabled(uuid,text)to service_role;
