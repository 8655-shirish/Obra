-- Admission owns the destination. Payment owns financial truth. Calendar effects
-- retain the admitted identity even when the owner later changes configuration.
alter table public.appointments
  add column calendar_destination_epoch_id uuid,
  add constraint appointments_calendar_destination_epoch_fk
    foreign key (calendar_destination_epoch_id,profile_id,environment)
    references public.calendar_destination_epochs(id,profile_id,environment);
alter table public.appointments drop constraint appointments_review_state_check;
alter table public.appointments add constraint appointments_review_state_check check (
  review_state in ('none','late_payment','refund_failure','calendar_reconciliation',
    'provider_inconsistency','unresolved_destination')
);

-- Branch before referencing table-specific OLD/NEW fields: SQL boolean AND is
-- not a record-shape guard when this trigger serves both links and epochs.
create or replace function public.reject_booking_provider_identity_rekey() returns trigger
language plpgsql set search_path='' as $function$
begin
  if tg_table_name='calendar_destination_epochs' then
    if (old.profile_id,old.environment,old.connection_id,old.calendar_selection_id,old.connection_revision,old.pipedream_account_id,old.google_calendar_id)
      is distinct from (new.profile_id,new.environment,new.connection_id,new.calendar_selection_id,new.connection_revision,new.pipedream_account_id,new.google_calendar_id) then
      raise exception 'calendar destination epoch identity is immutable' using errcode='23514';
    end if;
  elsif tg_table_name='calendar_event_links' then
    if (old.appointment_id,old.profile_id,old.environment,old.connection_id,old.calendar_selection_id,old.google_event_id,old.destination_epoch_id)
      is distinct from (new.appointment_id,new.profile_id,new.environment,new.connection_id,new.calendar_selection_id,new.google_event_id,new.destination_epoch_id) then
      raise exception 'calendar event identity is immutable' using errcode='23514';
    end if;
  end if;
  return new;
end $function$;
revoke all on function public.reject_booking_provider_identity_rekey() from public,anon,authenticated,service_role,booking_worker;

-- A retained link is attributable evidence; today's selection is not. Historical
-- null-epoch links and unknown manual repairs deliberately remain unresolved.
update public.appointments a set calendar_destination_epoch_id=l.destination_epoch_id
from public.calendar_event_links l join public.calendar_destination_epochs e
  on e.id=l.destination_epoch_id and e.profile_id=l.profile_id and e.environment=l.environment
where a.id=l.appointment_id and a.profile_id=l.profile_id and a.environment=l.environment
  and a.calendar_destination_epoch_id is null;

create function public.guard_booking_reserved_destination() returns trigger
language plpgsql set search_path='' as $function$
begin
  if old.calendar_destination_epoch_id is not null and
    (new.calendar_destination_epoch_id,new.profile_id,new.environment) is distinct from
    (old.calendar_destination_epoch_id,old.profile_id,old.environment) then
    raise exception 'reserved calendar destination is immutable' using errcode='23514';
  end if;
  if new.calendar_destination_epoch_id is not null and exists (
    select 1 from public.calendar_event_links l where l.appointment_id=new.id
      and l.profile_id=new.profile_id and l.environment=new.environment
      and l.destination_epoch_id is distinct from new.calendar_destination_epoch_id
  ) then raise exception 'existing calendar link is authoritative' using errcode='23514';end if;
  return new;
end $function$;
create trigger appointments_reserved_destination_immutable
before update of calendar_destination_epoch_id,profile_id,environment on public.appointments
for each row execute function public.guard_booking_reserved_destination();
revoke all on function public.guard_booking_reserved_destination()
  from public,anon,authenticated,service_role,booking_worker;

-- Retain the existing admission implementation as an owner-only base. The sole
-- runtime entry point locks provider configuration before invoking its unchanged
-- consent, cache, capacity, entitlement, cutover and idempotency checks.
alter function public.reserve_live_booking(uuid,text,timestamptz,date,time,text,uuid,text,text,text,text,text,jsonb,timestamptz,text,bigint,text)
  rename to reserve_live_booking_before_calendar_lifetime;
revoke all on function public.reserve_live_booking_before_calendar_lifetime(uuid,text,timestamptz,date,time,text,uuid,text,text,text,text,text,jsonb,timestamptz,text,bigint,text)
  from public,anon,authenticated,service_role,booking_worker;
-- The original body has a result variable and appointment_operations.result;
-- qualify only that variable instead of changing PL/pgSQL resolution globally.
do $base_fix$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.reserve_live_booking_before_calendar_lifetime(uuid,text,timestamptz,date,time,text,uuid,text,text,text,text,text,jsonb,timestamptz,text,bigint,text)'::regprocedure);
  if pg_catalog.strpos(definition,'(result->>')=0 then raise exception 'reservation base shape changed' using errcode='55000';end if;
  definition:=pg_catalog.replace(definition,'declare w public.websites%rowtype','<<reservation_base>> declare w public.websites%rowtype');
  execute pg_catalog.replace(definition,'(result->>','(reservation_base.result->>');
end $base_fix$;

create function public.reserve_live_booking(
  p_website_id uuid,p_environment text,p_start_at timestamptz,p_local_date date,p_local_start time,p_time_zone text,
  p_client_request_id uuid,p_request_hash text,p_request_capability_hash text,
  p_consent_document_id text,p_consent_version text,p_consent_digest text,
  p_customer jsonb,p_freebusy_observed_at timestamptz,p_rate_limit_key text,p_availability_generation bigint,p_calendar_set_hash text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  w public.websites%rowtype;c public.calendar_connections%rowtype;b public.pipedream_bindings%rowtype;
  s public.calendar_selections%rowtype;e public.calendar_destination_epochs%rowtype;
  payment public.stripe_connected_accounts%rowtype;op public.appointment_operations%rowtype;
  result jsonb;fresh_after timestamptz;fresh_before timestamptz;blocking_ids jsonb;
begin
  if p_environment is null or p_environment not in ('test','live') or p_client_request_id is null
    or coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request_capability_hash,'') !~ '^[a-f0-9]{64}$'
    or coalesce(p_rate_limit_key,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid idempotency identity' using errcode='22023';
  end if;
  select * into strict w from public.websites where id=p_website_id and environment=p_environment
    and status='live' and active_version_id is not null for share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w.user_id::text||':'||p_environment||':booking',0));
  select * into op from public.appointment_operations where profile_id=w.user_id and environment=p_environment
    and operation_type='reserve' and client_request_id=p_client_request_id;
  if found then
    if op.request_hash is distinct from p_request_hash then raise exception 'idempotency key payload conflict' using errcode='23505';end if;
    if op.request_capability_hash is distinct from p_request_capability_hash then raise exception 'booking request capability conflict' using errcode='42501';end if;
    if not exists(select 1 from public.appointments a where a.id=op.appointment_id and a.website_id=w.id
      and a.profile_id=w.user_id and a.environment=p_environment) then
      raise exception 'booking request website conflict' using errcode='42501';
    end if;
    -- Never bind a replay of a legacy checkout to a newly selected destination.
    return op.result;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(w.user_id::text||':'||p_environment||':google-calendar',0));
  select * into c from public.calendar_connections where profile_id=w.user_id and environment=p_environment for no key update;
  select * into b from public.pipedream_bindings where profile_id=w.user_id and environment=p_environment for update;
  perform 1 from public.calendar_selections where connection_id=c.id and profile_id=w.user_id and environment=p_environment for share;
  select * into payment from public.stripe_connected_accounts where profile_id=w.user_id and environment=p_environment for share;
  perform 1 from public.website_entitlements where website_id=w.id and profile_id=w.user_id and environment=p_environment for share;

  result:=public.reserve_live_booking_before_calendar_lifetime(p_website_id,p_environment,p_start_at,p_local_date,p_local_start,p_time_zone,
    p_client_request_id,p_request_hash,p_request_capability_hash,p_consent_document_id,p_consent_version,p_consent_digest,
    p_customer,p_freebusy_observed_at,p_rate_limit_key,p_availability_generation,p_calendar_set_hash);
  fresh_after:=pg_catalog.clock_timestamp()-interval '15 minutes';
  fresh_before:=pg_catalog.clock_timestamp()+interval '1 minute';
  if c.id is null or c.health_state<>'healthy' or nullif(c.pipedream_account_id,'') is null
    or c.verification_reason is not null or c.reconnect_reason is not null
    or c.last_verified_at is null or c.last_verified_at not between fresh_after and fresh_before
    or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=c.profile_id
      and d.environment=c.environment and d.provider='pipedream' and d.provider_account_id=c.pipedream_account_id
      and d.state in ('pending','completed')) then
    raise exception 'current calendar provider readiness required' using errcode='P0001';
  end if;
  select * into s from public.calendar_selections where connection_id=c.id and profile_id=c.profile_id
    and environment=c.environment and active and receives_bookings;
  select pg_catalog.jsonb_agg(cs.google_calendar_id order by cs.google_calendar_id) into blocking_ids
    from public.calendar_selections cs where cs.connection_id=c.id and cs.profile_id=c.profile_id
      and cs.environment=c.environment and cs.active and cs.blocks_availability;
  if s.id is null or blocking_ids is null or s.access_role not in ('writer','owner')
    or exists(select 1 from public.calendar_selections cs where cs.connection_id=c.id and cs.profile_id=c.profile_id
      and cs.environment=c.environment and cs.active and (cs.blocks_availability or cs.receives_bookings)
      and (cs.permission_verified_at is null or cs.permission_verified_at not between fresh_after and fresh_before
        or cs.access_role is null or (cs.blocks_availability and cs.access_role not in ('freeBusyReader','reader','writer','owner'))
        or (cs.receives_bookings and cs.access_role not in ('writer','owner')))) then
    raise exception 'current calendar selection readiness required' using errcode='P0001';
  end if;
  if b.id is null or b.connection_id is distinct from c.id or b.pipedream_account_id is distinct from c.pipedream_account_id
    or b.configuration_revision is distinct from c.connection_revision
    or b.trigger_state<>'active' or nullif(b.deployed_trigger_id,'') is null
    or b.last_health_at is null or b.last_health_at not between fresh_after and fresh_before
    or b.deployment_operation_id is not null
    or b.selected_calendar_ids is distinct from blocking_ids then
    raise exception 'current calendar trigger readiness required' using errcode='P0001';
  end if;
  if payment.id is null or nullif(payment.stripe_account_id,'') is null
    or payment.onboarding_state<>'ready' or not payment.charges_enabled or not payment.payouts_enabled or not payment.details_submitted
    or payment.charge_model<>'direct' or payment.application_fee_bps<>0
    or payment.capabilities->>'card_payments' is distinct from 'active'
    or payment.requirements->'currently_due' is distinct from '[]'::jsonb
    or payment.requirements->'past_due' is distinct from '[]'::jsonb
    or payment.requirements->'pending_verification' is distinct from '[]'::jsonb
    or nullif(payment.requirements->>'disabled_reason','') is not null
    or payment.last_verified_at is null or payment.last_verified_at not between fresh_after and fresh_before then
    raise exception 'current payment provider readiness required' using errcode='P0001';
  end if;
  select * into strict e from public.ensure_calendar_destination_epoch(c.profile_id,c.environment,c.id,s.id);
  if (e.connection_id,e.calendar_selection_id,e.connection_revision,e.pipedream_account_id,e.google_calendar_id)
    is distinct from (c.id,s.id,c.connection_revision,c.pipedream_account_id,s.google_calendar_id) then
    raise exception 'reserved calendar epoch does not match admitted configuration' using errcode='23514';
  end if;
  update public.appointments set calendar_destination_epoch_id=e.id
    where id=(result->>'appointmentId')::uuid and profile_id=w.user_id and environment=p_environment
      and calendar_destination_epoch_id is null;
  if not found then raise exception 'booking destination was not bound' using errcode='40001';end if;
  return result;
end $function$;
revoke all on function public.reserve_live_booking(uuid,text,timestamptz,date,time,text,uuid,text,text,text,text,text,jsonb,timestamptz,text,bigint,text)
  from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.reserve_live_booking(uuid,text,timestamptz,date,time,text,uuid,text,text,text,text,text,jsonb,timestamptz,text,bigint,text) to service_role;
-- Audited source callers: reserve_live_booking is the only current hold caller;
-- epoch creation is internal to admission. Revoked legacy calendar RPCs stay revoked.
revoke all on function public.reserve_booking_hold(uuid,uuid,uuid,uuid,text,timestamptz,date,time,text,uuid,text),
  public.ensure_calendar_destination_epoch(uuid,text,uuid,uuid) from public,anon,authenticated,service_role,booking_worker;

create function public.resolve_booking_calendar_destination(p_appointment_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;l public.calendar_event_links%rowtype;e public.calendar_destination_epochs%rowtype;
  epoch_id uuid;event_id text;evidence_count integer;
begin
  select * into strict a from public.appointments where id=p_appointment_id for update;
  select * into l from public.calendar_event_links where appointment_id=a.id and profile_id=a.profile_id and environment=a.environment for update;
  if l.id is not null then
    epoch_id:=l.destination_epoch_id;event_id:=l.google_event_id;
  elsif a.calendar_destination_epoch_id is not null then
    epoch_id:=a.calendar_destination_epoch_id;
    event_id:='obra'||pg_catalog.substr(pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_array('obra-calendar-v3',a.environment,a.id)::text,'UTF8'),'sha256'),'hex'),1,48);
  else
    -- Only attributable retained effect identity can resolve an unbound legacy
    -- checkout. Ambiguous/missing evidence is an obligation, not a money error.
    select count(distinct (o.destination_epoch_id,o.payload->>'googleEventId')),
      min(o.destination_epoch_id::text)::uuid,min(o.payload->>'googleEventId')
    into evidence_count,epoch_id,event_id
    from public.integration_outbox o join public.calendar_destination_epochs ep
      on ep.id=o.destination_epoch_id and ep.profile_id=o.profile_id and ep.environment=o.environment
    where o.appointment_id=a.id and o.profile_id=a.profile_id and o.environment=a.environment
      and o.command_type='calendar_create' and o.payload->>'googleEventId' ~ '^[0-9a-v]+$'
      and length(o.payload->>'googleEventId') between 5 and 1024
      and o.payload->>'connectionId'=ep.connection_id::text and o.payload->>'selectionId'=ep.calendar_selection_id::text
      and (not (o.payload ? 'appointmentId') or o.payload->>'appointmentId'=a.id::text);
    if evidence_count<>1 then epoch_id:=null;end if;
  end if;
  select * into e from public.calendar_destination_epochs where id=epoch_id and profile_id=a.profile_id and environment=a.environment;
  if e.id is null then
    update public.appointments set calendar_state=case when appointment_state='confirmed' then 'create_failed' else calendar_state end,
      review_state='unresolved_destination',updated_at=pg_catalog.clock_timestamp()
      where id=a.id;
    return null;
  end if;
  if a.calendar_destination_epoch_id is null then
    update public.appointments set calendar_destination_epoch_id=e.id where id=a.id;
  elsif a.calendar_destination_epoch_id<>e.id then
    raise exception 'reserved destination conflicts with existing calendar link' using errcode='23514';
  end if;
  return pg_catalog.jsonb_build_object('epoch',pg_catalog.to_jsonb(e),'eventId',event_id,'linkId',l.id);
end $function$;
revoke all on function public.resolve_booking_calendar_destination(uuid) from public,anon,authenticated,service_role,booking_worker;

create or replace function public.enqueue_booking_calendar_create(p_appointment_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;e public.calendar_destination_epochs%rowtype;destination jsonb;
begin
  select * into strict a from public.appointments where id=p_appointment_id and appointment_state='confirmed' for update;
  destination:=public.resolve_booking_calendar_destination(a.id);
  if destination is null then return false;end if;
  if destination->>'linkId' is not null then
    -- Payment replay must not reset a conflict, a lease, or an already delivered
    -- event. The appointment desired-state trigger owns actual state changes.
    return true;
  end if;
  e:=pg_catalog.jsonb_populate_record(null::public.calendar_destination_epochs,destination->'epoch');
  insert into public.calendar_event_links(appointment_id,profile_id,connection_id,calendar_selection_id,environment,
    google_event_id,desired_appointment_version,sync_state,destination_epoch_id,desired_state,desired_generation)
  values(a.id,a.profile_id,e.connection_id,e.calendar_selection_id,a.environment,destination->>'eventId',a.version,'pending',e.id,
    'present',greatest(a.calendar_generation,1));
  return true;
end $function$;
revoke all on function public.enqueue_booking_calendar_create(uuid) from public,anon,authenticated,service_role,booking_worker;

-- Late-payment arbitration/refund policy stays with its existing reducer. Only
-- resolve the admitted identity (or expose its absence), without an event effect.
create function public.resolve_late_paid_booking_destination() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  if new.reduction_outcome in ('paid_arbitration_required','expiry_paid_arbitration_required') then
    perform public.resolve_booking_calendar_destination(new.appointment_id);
  end if;
  return new;
end $function$;
create trigger booking_stripe_observation_reserved_destination
after insert on public.booking_stripe_observations_v3 for each row execute function public.resolve_late_paid_booking_destination();
revoke all on function public.resolve_late_paid_booking_destination() from public,anon,authenticated,service_role,booking_worker;

-- Captured/refunded amounts remain authoritative when an older reducer missed
-- the terminal projection. Shared by financial replay, arbitration and cancellation.
create function public.converge_booking_full_refund_v3(p_appointment_id uuid)
returns boolean language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;p public.booking_payments%rowtype;refunds jsonb;refunded_at_value timestamptz;paid_state text;
  now_at timestamptz:=pg_catalog.clock_timestamp();guard_token text:=pg_catalog.gen_random_uuid()::text;
  prior_guard text:=pg_catalog.current_setting('obra.booking_financial_guard_token_v3',true);
  prior_reducer text:=pg_catalog.current_setting('obra.booking_financial_reducer_v3',true);
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_appointment_id::text||':booking-appointment',0));
  select * into strict a from public.appointments where id=p_appointment_id for update;
  select * into p from public.booking_payments where appointment_id=a.id and profile_id=a.profile_id and environment=a.environment for update;
  if p.id is null or a.booking_contract_version is distinct from 2 or p.booking_contract_version is distinct from 2
    or p.amount_paid_minor<>p.expected_amount_minor or p.amount_paid_minor<=0 or p.amount_refunded_minor<>p.amount_paid_minor
    or p.paid_at is null or p.stripe_account_id is null or p.payment_intent_id is null or p.charge_id is null then return false;end if;
  -- Expiry observations retained the complete provider refunds even when the
  -- old projection omitted refunded_at. Observation/replay time is not refund time.
  select o.provider_snapshot->'refunds' into refunds from public.booking_stripe_observations_v3 o
    where o.payment_id=p.id and o.appointment_id=a.id and o.profile_id=p.profile_id and o.environment=p.environment
      and o.stripe_account_id=p.stripe_account_id and o.payment_intent_id=p.payment_intent_id and o.charge_id=p.charge_id
      and o.cumulative_refunded_minor=p.amount_refunded_minor and o.provider_snapshot->>'refundsHasMore'='false'
      and pg_catalog.jsonb_typeof(o.provider_snapshot->'refunds')='array'
    order by o.observed_at desc,o.id desc limit 1;
  if refunds is not null then
    perform public.validate_booking_refund_snapshot_v3(refunds,p.charge_id,p.payment_intent_id,p.currency,p.amount_paid_minor);
    select max(pg_catalog.to_timestamp((x->>'created')::bigint)) into refunded_at_value
      from pg_catalog.jsonb_array_elements(refunds)x where x->>'status'='succeeded'
      having sum((x->>'amount')::bigint)=p.amount_refunded_minor;
  end if;
  paid_state:=case when p.dispute_state in('open','lost','closed')then 'disputed' else 'paid' end;
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
  update public.booking_payments set payment_state=paid_state,refund_state='succeeded',
    refunded_at=coalesce(p.refunded_at,refunded_at_value),updated_at=now_at
    where id=p.id and (payment_state is distinct from paid_state or refund_state<>'succeeded'
      or refunded_at is distinct from coalesce(p.refunded_at,refunded_at_value));
  update public.appointments set appointment_state='cancelled',payment_state=paid_state,refund_state='succeeded',
    appointment_reason=case when cancellation_requested_at is null and appointment_reason='late_payment_arbitration'
      then 'late_payment_refund' else appointment_reason end,
    review_state=case when review_state='refund_failure' then 'none' else review_state end,
    reservation_expires_at=null,cancelled_at=coalesce(cancelled_at,now_at),version=version+1,updated_at=now_at
    where id=a.id and (appointment_state<>'cancelled' or payment_state is distinct from paid_state or refund_state<>'succeeded'
      or (cancellation_requested_at is null and appointment_reason='late_payment_arbitration')
      or review_state='refund_failure' or reservation_expires_at is not null);
  update public.integration_outbox set state='succeeded',completed_at=now_at,terminal_at=now_at,
    lease_token=null,lease_expires_at=null,safe_error=null where appointment_id=a.id and profile_id=a.profile_id
      and environment=a.environment and command_type='refund' and effect_contract_version=2 and state in('pending','processing','failed');
  update public.booking_refunds br set state=case when br.stripe_refund_id is null then 'canceled'
    else coalesce((select x->>'status' from pg_catalog.jsonb_array_elements(refunds)x where x->>'id'=br.stripe_refund_id),br.state) end,
    settled_by_external=br.stripe_refund_id is null,provider_updated_at=now_at,updated_at=now_at
    where br.payment_id=p.id and br.state in('pending','requires_action');
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3',coalesce(prior_reducer,''),true);
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',coalesce(prior_guard,''),true);
  return true;
end $function$;
revoke all on function public.converge_booking_full_refund_v3(uuid) from public,anon,authenticated,service_role,booking_worker;

-- Replace the effective reducer, not a post-transition compensation. Provider
-- identity/amount/refund validation remains the sole money authority. Only a
-- previously unpaid expired hold can enter arbitration; cancellation is intent.
create or replace function public.reduce_booking_financial_evidence_v3(
 p_authority_kind text,p_authority_id uuid,p_lease_token uuid,p_fencing_token bigint,p_provider_snapshot jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $function$
#variable_conflict use_variable
<<financial_reducer>>
declare
 inbox public.provider_event_inbox%rowtype;command public.integration_outbox%rowtype;payment public.booking_payments%rowtype;appointment public.appointments%rowtype;refund_row public.booking_refunds%rowtype;
 checkout jsonb:=p_provider_snapshot->'checkout';intent jsonb:=p_provider_snapshot->'paymentIntent';charge jsonb:=p_provider_snapshot->'charge';refunds jsonb:=coalesce(p_provider_snapshot->'refunds','[]');event_object jsonb;refund_item jsonb;
 account_id text:=p_provider_snapshot->>'stripeAccountId';event_type text;provider_event_id text;provider_object_id text;session_id text;intent_id text;charge_id text;outcome text;refund_id text;refund_status text;dispute_status text;paid_state text;
 provider_created bigint:=0;cumulative_refunded bigint:=0;succeeded_refund_sum bigint:=0;remaining_amount bigint;refund_generation bigint;refund_created bigint;match_count integer:=0;event_rank integer:=0;
 observation_id uuid;snapshot_sha text;envelope_sha text;now_at timestamptz:=pg_catalog.clock_timestamp();refunded_at_value timestamptz;result jsonb;guard_token text:=pg_catalog.gen_random_uuid()::text;appointment_identity uuid;
 arbitration_eligible boolean:=false;hold_expires_at timestamptz;preserve_cancelled boolean:=false;retained_paid boolean;paid_snapshot boolean;
begin
 if p_authority_kind is null or p_authority_kind not in('stripe_event','refund_command','session_expiry')or p_authority_id is null or p_lease_token is null then raise exception 'invalid booking financial authority' using errcode='22023';end if;
 if p_provider_snapshot is null or pg_catalog.jsonb_typeof(p_provider_snapshot)<>'object'or nullif(account_id,'')is null or(p_provider_snapshot->>'refundsHasMore')is distinct from 'false' then raise exception 'complete connected-account Stripe snapshot required' using errcode='22023';end if;
 if pg_catalog.jsonb_typeof(refunds)<>'array'then raise exception 'refund list must be complete' using errcode='22023';end if;
 session_id:=nullif(checkout->>'id','');intent_id:=nullif(intent->>'id','');charge_id:=nullif(charge->>'id','');
 if p_authority_kind='session_expiry'then
  select p.appointment_id into strict appointment_identity from public.booking_payments p where p.id=p_authority_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_identity::text||':booking-appointment',0));
  select p.* into strict payment from public.booking_payments p where p.id=p_authority_id and p.booking_contract_version=2 and p.checkout_lease_token=p_lease_token and p.checkout_fencing_token=p_fencing_token and p.checkout_lease_expires_at>pg_catalog.clock_timestamp()and p.stripe_account_id=account_id for update;
  select a.* into strict appointment from public.appointments a where a.id=payment.appointment_id and a.profile_id=payment.profile_id and a.environment=payment.environment and a.booking_contract_version=2 for update;
  if not public.booking_cutover_enabled(payment.profile_id,payment.environment)or session_id is distinct from payment.checkout_session_id or checkout->>'object'is distinct from 'checkout.session'or checkout->'metadata'->>'kind'is distinct from 'booking'or checkout->'metadata'->>'appointmentId'is distinct from appointment.id::text or checkout->'metadata'->>'profileId'is distinct from payment.profile_id::text or checkout->'metadata'->>'environment'is distinct from payment.environment or(checkout->>'livemode')::boolean is distinct from(payment.environment='live')or coalesce((checkout->>'amount_total')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(checkout->>'currency',''))<>payment.currency then raise exception 'Checkout expiry correlation mismatch' using errcode='P0001';end if;
  if payment.payment_state in('paid','disputed')or payment.amount_paid_minor>0 then raise exception 'expiry no longer owns unpaid booking' using errcode='40001';end if;
  if intent_id is not null then
   if checkout->>'payment_intent'is distinct from intent_id or intent->>'object'is distinct from 'payment_intent'or intent->'metadata'->>'kind'is distinct from 'booking'or intent->'metadata'->>'appointmentId'is distinct from appointment.id::text or coalesce((intent->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(intent->>'currency',''))<>payment.currency or(intent->>'livemode')::boolean is distinct from(payment.environment='live')or(payment.payment_intent_id is not null and payment.payment_intent_id<>intent_id)then raise exception 'PaymentIntent expiry correlation mismatch' using errcode='P0001';end if;
   if intent->>'status'='succeeded'then
    if charge_id is null or charge->>'object'is distinct from 'charge'or charge->>'payment_intent'is distinct from intent_id or coalesce((charge->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(charge->>'currency',''))<>payment.currency or(charge->>'livemode')::boolean is distinct from(payment.environment='live')or(payment.charge_id is not null and payment.charge_id<>charge_id)then raise exception 'Charge expiry correlation mismatch' using errcode='P0001';end if;
    perform public.validate_booking_refund_snapshot_v3(refunds,charge_id,intent_id,payment.currency,payment.expected_amount_minor);
    select coalesce((charge->>'amount_refunded')::bigint,-1),coalesce(sum((x->>'amount')::bigint)filter(where x->>'status'='succeeded'),0),max(pg_catalog.to_timestamp((x->>'created')::bigint))filter(where x->>'status'='succeeded')into cumulative_refunded,succeeded_refund_sum,refunded_at_value from pg_catalog.jsonb_array_elements(refunds)x;
    if not coalesce((charge->>'paid')::boolean,false)or cumulative_refunded<0 or cumulative_refunded>payment.expected_amount_minor or cumulative_refunded<payment.amount_refunded_minor or succeeded_refund_sum<>cumulative_refunded then raise exception 'Paid expiry snapshot mismatch' using errcode='P0001';end if;
    arbitration_eligible:=appointment.appointment_state='payment_pending' and appointment.reservation_expires_at<=now_at
      and appointment.confirmed_at is null and appointment.cancellation_requested_at is null
      and appointment.refund_state='not_requested' and payment.refund_state='not_requested'
      and payment.refund_requested_at is null and pg_catalog.jsonb_array_length(refunds)=0 and appointment.start_at>now_at;
    perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
    update public.booking_payments bp set payment_intent_id=intent_id,charge_id=financial_reducer.charge_id,payment_state='paid',amount_paid_minor=bp.expected_amount_minor,amount_refunded_minor=cumulative_refunded,
      refund_state=case when cumulative_refunded=bp.expected_amount_minor then 'succeeded' else bp.refund_state end,
      refunded_at=case when cumulative_refunded=bp.expected_amount_minor then refunded_at_value else bp.refunded_at end,
      paid_at=coalesce(bp.paid_at,now_at),checkout_lease_token=null,checkout_lease_expires_at=null,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.* into payment;
    if arbitration_eligible then
      update public.appointments a set appointment_state='cancelled',appointment_reason='late_payment_arbitration',payment_state='paid',review_state='late_payment',reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
      outcome:='expiry_paid_arbitration_required';
    elsif cumulative_refunded=payment.expected_amount_minor then
      update public.appointments a set appointment_state='cancelled',payment_state='paid',refund_state='succeeded',reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id;
      outcome:='expiry_paid_refunded';
    else
      refund_generation:=greatest(appointment.refund_generation,payment.refund_generation,1);
      update public.appointments a set appointment_state='cancelled',payment_state='paid',
        appointment_reason=case when a.cancellation_requested_at is not null or a.appointment_reason in('contractor_cancelled','customer_cancelled') then a.appointment_reason else 'late_payment_refund' end,
        refund_state=case when a.refund_state='failed' then 'failed' else 'pending' end,refund_generation=financial_reducer.refund_generation,
        review_state=case when a.refund_state='failed' then 'refund_failure' else 'late_payment' end,
        reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
      update public.booking_payments bp set refund_state=appointment.refund_state,refund_generation=financial_reducer.refund_generation,refund_requested_at=coalesce(bp.refund_requested_at,now_at),refund_idempotency_key=coalesce(bp.refund_idempotency_key,'booking-refund:'||appointment.id||':'||refund_generation) where bp.id=payment.id;
      if appointment.refund_state='pending' then
        insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)
        values(appointment.profile_id,appointment.environment,appointment.id,'refund','booking-refund:'||appointment.id||':'||refund_generation,appointment.version,refund_generation,2,pg_catalog.jsonb_build_object('reason','paid_expiry_not_recoverable'))on conflict(profile_id,environment,idempotency_key)do nothing;
      end if;
      outcome:='expiry_paid_refund_required';
    end if;
   elsif checkout->>'status'='expired'and checkout->>'payment_status'='unpaid'and intent->>'status'in('requires_payment_method','canceled')and pg_catalog.jsonb_array_length(refunds)=0 then
    if charge_id is not null and(charge->>'object'is distinct from 'charge'or charge->>'payment_intent'is distinct from intent_id or coalesce((charge->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(charge->>'currency',''))<>payment.currency or(charge->>'livemode')::boolean is distinct from(payment.environment='live')or coalesce((charge->>'paid')::boolean,false)or coalesce((charge->>'amount_refunded')::bigint,-1)<>0)then raise exception 'Failed Charge expiry correlation mismatch' using errcode='P0001';end if;
    cumulative_refunded:=0;
    perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
    update public.booking_payments bp set payment_intent_id=intent_id,charge_id=nullif(charge->>'id',''),payment_state='failed',failed_at=coalesce(bp.failed_at,now_at),checkout_lease_token=null,checkout_lease_expires_at=null,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id and bp.payment_state<>'paid';
    update public.appointments a set appointment_state='cancelled',appointment_reason='payment_expired',payment_state='failed',cancelled_at=coalesce(a.cancelled_at,now_at),reservation_expires_at=null,version=a.version+1,updated_at=now_at where a.id=appointment.id and a.appointment_state='payment_pending'and a.payment_state<>'paid';outcome:='expiry_unpaid_payment_intent_released';
   else raise exception 'Checkout expiry snapshot is not terminal' using errcode='40001';end if;
  elsif checkout->>'status'='expired'and checkout->>'payment_status'='unpaid'then
   perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
   update public.booking_payments bp set payment_state='failed',failed_at=coalesce(bp.failed_at,now_at),checkout_lease_token=null,checkout_lease_expires_at=null,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id and bp.payment_state<>'paid';
   update public.appointments a set appointment_state='cancelled',appointment_reason='payment_expired',payment_state='failed',cancelled_at=coalesce(a.cancelled_at,now_at),reservation_expires_at=null,version=a.version+1,updated_at=now_at where a.id=appointment.id and a.appointment_state='payment_pending'and a.payment_state<>'paid';outcome:='expiry_unpaid_released';
  else raise exception 'Checkout expiry snapshot is not terminal' using errcode='40001';end if;
  insert into public.booking_stripe_observations_v3(authority_kind,authority_id,payment_id,appointment_id,profile_id,environment,stripe_account_id,provider_created,checkout_session_id,payment_intent_id,charge_id,cumulative_refunded_minor,snapshot_sha256,provider_snapshot,reduction_outcome)values('session_expiry',payment.id,payment.id,payment.appointment_id,payment.profile_id,payment.environment,account_id,0,session_id,intent_id,charge_id,case when charge_id is null then null else cumulative_refunded end,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_provider_snapshot::text,'UTF8'),'sha256'),'hex'),p_provider_snapshot,outcome)on conflict(authority_kind,authority_id,snapshot_sha256,reduction_outcome)do nothing returning id into observation_id;
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
  return pg_catalog.jsonb_build_object('action','settled','outcome',outcome);
 end if;
 snapshot_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_provider_snapshot::text,'UTF8'),'sha256'),'hex');
 if p_authority_kind='stripe_event'then
  select * into strict inbox from public.provider_event_inbox where id=p_authority_id and provider='stripe'and event_family='booking'and processing_state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp()for update;
  if not public.booking_cutover_enabled(inbox.profile_id,inbox.environment)then raise exception 'booking cutover is not enabled' using errcode='P0001';end if;
  if inbox.account_context is distinct from account_id or inbox.destination is distinct from 'obra-connect-webhook'or nullif(inbox.api_version,'')is null or inbox.payload->>'id'is distinct from inbox.event_id or inbox.payload->>'type'is distinct from inbox.event_type or(inbox.payload->>'livemode')::boolean is distinct from inbox.livemode or inbox.livemode is distinct from(inbox.environment='live')then raise exception 'immutable Stripe envelope mismatch' using errcode='22023';end if;
  event_type:=inbox.event_type;provider_event_id:=inbox.event_id;provider_created:=coalesce((inbox.payload->>'created')::bigint,0);event_object:=inbox.payload->'data'->'object';provider_object_id:=nullif(event_object->>'id','');envelope_sha:=inbox.payload_hash;
  if provider_created<=0 or provider_object_id is null then raise exception 'invalid Stripe event causal identity' using errcode='22023';end if;
  if event_type like 'checkout.session.%'then
   if session_id is distinct from provider_object_id or checkout->>'object'is distinct from 'checkout.session'or checkout->'metadata'->>'kind'is distinct from 'booking'or checkout->'metadata'->>'profileId'is distinct from inbox.profile_id::text or checkout->'metadata'->>'environment'is distinct from inbox.environment or nullif(checkout->'metadata'->>'appointmentId','')is null or event_object->'metadata'->>'kind'is distinct from 'booking'or event_object->'metadata'->>'appointmentId'is distinct from checkout->'metadata'->>'appointmentId'or event_object->'metadata'->>'profileId'is distinct from checkout->'metadata'->>'profileId'or event_object->'metadata'->>'environment'is distinct from checkout->'metadata'->>'environment'then raise exception 'Checkout metadata correlation mismatch' using errcode='P0001';end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((checkout->'metadata'->>'appointmentId')||':booking-appointment',0));
   select p.* into strict payment from public.booking_payments p where p.appointment_id=(checkout->'metadata'->>'appointmentId')::uuid and p.profile_id=inbox.profile_id and p.environment=inbox.environment and p.booking_contract_version=2 and p.stripe_account_id=account_id and p.checkout_session_id=session_id for update;
  elsif event_type in('payment_intent.succeeded','payment_intent.payment_failed')then
   if intent_id is distinct from provider_object_id then raise exception 'PaymentIntent event object mismatch' using errcode='P0001';end if;
   if intent->>'object'is distinct from 'payment_intent'or intent->'metadata'->>'kind'is distinct from 'booking'or nullif(intent->'metadata'->>'appointmentId','')is null then raise exception 'PaymentIntent metadata correlation mismatch' using errcode='P0001';end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((intent->'metadata'->>'appointmentId')||':booking-appointment',0));
   select p.* into strict payment from public.booking_payments p where p.appointment_id=(intent->'metadata'->>'appointmentId')::uuid and p.profile_id=inbox.profile_id and p.environment=inbox.environment and p.booking_contract_version=2 and p.stripe_account_id=account_id and(p.payment_intent_id is null or p.payment_intent_id=intent_id)for update;
  elsif event_type in('charge.refunded','refund.updated','charge.dispute.created','charge.dispute.updated','charge.dispute.closed')then
   if intent->>'object'is distinct from 'payment_intent'or intent->'metadata'->>'kind'is distinct from 'booking'or nullif(intent->'metadata'->>'appointmentId','')is null then raise exception 'PaymentIntent metadata correlation mismatch' using errcode='P0001';end if;
   perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended((intent->'metadata'->>'appointmentId')||':booking-appointment',0));
   select p.* into strict payment from public.booking_payments p where p.appointment_id=(intent->'metadata'->>'appointmentId')::uuid and p.profile_id=inbox.profile_id and p.environment=inbox.environment and p.booking_contract_version=2 and p.stripe_account_id=account_id and p.payment_intent_id=intent_id for update;
  else raise exception 'unsupported booking Stripe event type' using errcode='22023';end if;
  select a.* into strict appointment from public.appointments a where a.id=payment.appointment_id and a.profile_id=payment.profile_id and a.environment=payment.environment and a.booking_contract_version=2 for update;
  if session_id is not null and(checkout->>'livemode')::boolean is distinct from(payment.environment='live')or intent_id is not null and(intent->>'livemode')::boolean is distinct from(payment.environment='live')or charge_id is not null and(charge->>'livemode')::boolean is distinct from(payment.environment='live')then raise exception 'Stripe snapshot environment mismatch' using errcode='P0001';end if;
  if intent_id is null then
   if event_type not in('checkout.session.async_payment_failed','checkout.session.expired')or session_id is null or payment.payment_state in('paid','disputed')or payment.amount_paid_minor>0 or checkout->>'object'is distinct from 'checkout.session'or coalesce((checkout->>'amount_total')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(checkout->>'currency',''))<>payment.currency or checkout->>'payment_intent'is not null then raise exception 'PaymentIntent binding mismatch' using errcode='P0001';end if;
  elsif intent->>'object'is distinct from 'payment_intent'or intent->'metadata'->>'kind'is distinct from 'booking'or intent->'metadata'->>'appointmentId'is distinct from appointment.id::text or coalesce((intent->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(intent->>'currency',''))<>payment.currency or(payment.payment_intent_id is not null and payment.payment_intent_id<>intent_id)then raise exception 'PaymentIntent binding mismatch' using errcode='P0001';end if;
  if session_id is not null and(coalesce((checkout->>'amount_total')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(checkout->>'currency',''))<>payment.currency or checkout->>'payment_intent'is distinct from intent_id or(payment.checkout_session_id is not null and payment.checkout_session_id<>session_id))then raise exception 'Checkout binding mismatch' using errcode='P0001';end if;
  if charge_id is not null then
   if charge->>'object'is distinct from 'charge'or charge->>'payment_intent'is distinct from intent_id or coalesce((charge->>'amount')::bigint,-1)<>payment.expected_amount_minor or pg_catalog.upper(coalesce(charge->>'currency',''))<>payment.currency or(payment.charge_id is not null and payment.charge_id<>charge_id)then raise exception 'Charge binding mismatch' using errcode='P0001';end if;
   perform public.validate_booking_refund_snapshot_v3(refunds,charge_id,intent_id,payment.currency,payment.expected_amount_minor);
   select coalesce((charge->>'amount_refunded')::bigint,-1),coalesce(sum((x->>'amount')::bigint)filter(where x->>'status'='succeeded'),0),max(pg_catalog.to_timestamp((x->>'created')::bigint))filter(where x->>'status'='succeeded')into cumulative_refunded,succeeded_refund_sum,refunded_at_value from pg_catalog.jsonb_array_elements(refunds)x;
   if cumulative_refunded<0 or cumulative_refunded>payment.expected_amount_minor or succeeded_refund_sum<>cumulative_refunded or cumulative_refunded<payment.amount_refunded_minor then raise exception 'non-causal or incomplete refund snapshot' using errcode='P0001';end if;
  elsif pg_catalog.jsonb_array_length(refunds)<>0 then raise exception 'refund evidence requires Charge identity' using errcode='P0001';end if;
  -- A successful Charge proves payment, not dispute recovery. Reduce the dispute
  -- clock independently; replayed financial snapshots still carry current refunds.
  if event_type like 'charge.dispute.%'then
   dispute_status:=event_object->>'status';
   if event_object->>'object'is distinct from 'dispute'or provider_object_id is null or dispute_status is null or dispute_status not in('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost')then raise exception 'unsupported Stripe dispute evidence' using errcode='P0001';end if;
   if charge_id is null or event_object->>'charge'is distinct from charge_id then raise exception 'dispute object mismatch' using errcode='P0001';end if;
   if intent->>'status'is distinct from 'succeeded'or not coalesce((charge->>'paid')::boolean,false)then raise exception 'dispute requires successful Charge evidence' using errcode='P0001';end if;
   event_rank:=case when dispute_status in('won','lost','warning_closed')then 22 else 21 end;
   if not(provider_created>payment.dispute_provider_created or(provider_created=payment.dispute_provider_created and event_rank>=payment.dispute_status_rank))then
    dispute_status:=null;
   end if;
  end if;
  paid_state:=case when dispute_status='won'then 'paid'
    when dispute_status is not null or payment.dispute_state in('open','lost','closed')then 'disputed' else 'paid' end;
  retained_paid:=payment.amount_paid_minor=payment.expected_amount_minor and payment.paid_at is not null
    and payment.payment_intent_id is not null and payment.charge_id is not null;
  paid_snapshot:=coalesce(intent->>'status'='succeeded'and charge_id is not null and(charge->>'paid')::boolean,false);
  preserve_cancelled:=appointment.appointment_state='cancelled' and (payment.amount_paid_minor>0
    or appointment.refund_state<>'not_requested' or payment.refund_state<>'not_requested' or payment.refund_requested_at is not null);
  -- The shipped expiry reducer could leave an elapsed service provisionally
  -- cancelled without arbitration. Retained evidence owns its refund, not replay.
  if preserve_cancelled and appointment.appointment_reason='late_payment_arbitration'
    and appointment.start_at<=now_at and appointment.confirmed_at is null
    and appointment.cancellation_requested_at is null and appointment.refund_state='not_requested'
    and payment.refund_state='not_requested' and payment.refund_requested_at is null
    and not exists(select 1 from public.booking_late_payment_arbitrations b where b.payment_id=payment.id)
    and exists(select 1 from public.booking_stripe_observations_v3 o where o.payment_id=payment.id
      and o.appointment_id=appointment.id and o.profile_id=payment.profile_id and o.environment=payment.environment
      and o.stripe_account_id=account_id and o.authority_kind='session_expiry'
      and o.reduction_outcome='expiry_paid_arbitration_required' and o.payment_intent_id=payment.payment_intent_id
      and o.charge_id=payment.charge_id) then
    preserve_cancelled:=false;
  end if;
  hold_expires_at:=coalesce(appointment.reservation_expires_at,(select (o.result->>'holdExpiresAt')::timestamptz from public.appointment_operations o
    where o.appointment_id=appointment.id and o.profile_id=appointment.profile_id and o.environment=appointment.environment and o.operation_type='reserve' limit 1));
  arbitration_eligible:=paid_state='paid' and payment.amount_paid_minor=0 and payment.payment_state not in('paid','disputed')
    and appointment.confirmed_at is null and appointment.cancellation_requested_at is null
    and appointment.refund_state='not_requested' and payment.refund_state='not_requested' and payment.refund_requested_at is null
    and pg_catalog.jsonb_array_length(refunds)=0 and hold_expires_at<=now_at
    and (appointment.appointment_state='payment_pending' or (appointment.appointment_state='cancelled' and appointment.appointment_reason in('hold_expired','payment_expired')));
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
  if retained_paid and not paid_snapshot then
   -- Older reducers could downgrade this projection without removing captured
   -- money or its dispute clock. Nonsuccess observations cannot erase that truth.
   update public.booking_payments bp set payment_state=paid_state,updated_at=now_at
     where bp.id=payment.id and bp.payment_state is distinct from paid_state;
   payment.payment_state:=paid_state;
   update public.appointments a set payment_state=paid_state,version=a.version+1,updated_at=now_at
     where a.id=appointment.id and a.payment_state is distinct from paid_state;
   perform public.converge_booking_full_refund_v3(appointment.id);
  end if;
  if paid_snapshot or(retained_paid and payment.amount_refunded_minor<payment.amount_paid_minor
    and appointment.appointment_state='cancelled' and not preserve_cancelled)then
   if paid_snapshot then
    if event_type='charge.refunded'and provider_object_id<>charge_id then raise exception 'charge.refunded object mismatch' using errcode='P0001';end if;
    if event_type='refund.updated'and not exists(select 1 from pg_catalog.jsonb_array_elements(refunds)x where x->>'id'=provider_object_id and x->>'charge'=charge_id and x->>'payment_intent'=intent_id)then raise exception 'refund.updated object mismatch' using errcode='P0001';end if;
    update public.booking_payments bp set checkout_session_id=coalesce(bp.checkout_session_id,session_id),payment_intent_id=intent_id,charge_id=financial_reducer.charge_id,payment_state=paid_state,amount_paid_minor=bp.expected_amount_minor,amount_refunded_minor=cumulative_refunded,refund_state=case when cumulative_refunded>=bp.expected_amount_minor then 'succeeded' when cumulative_refunded>0 and bp.refund_state<>'failed' then 'pending' else bp.refund_state end,paid_at=coalesce(bp.paid_at,pg_catalog.to_timestamp(provider_created)),refunded_at=case when cumulative_refunded>=bp.expected_amount_minor then refunded_at_value else null end,financial_provider_created=greatest(bp.financial_provider_created,provider_created),financial_event_rank=greatest(bp.financial_event_rank,30),financial_provider_event_id=provider_event_id,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.* into payment;
   else
    cumulative_refunded:=payment.amount_refunded_minor;
   end if;
   if cumulative_refunded>=payment.amount_paid_minor then
    update public.appointments a set appointment_state='cancelled',payment_state=payment.payment_state,refund_state='succeeded',reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
    update public.integration_outbox o set state='succeeded',completed_at=now_at,terminal_at=now_at,lease_token=null,lease_expires_at=null,safe_error=null where o.appointment_id=appointment.id and o.environment=appointment.environment and o.command_type='refund'and o.effect_contract_version=2 and o.state in('pending','processing','failed');
    update public.booking_refunds br set state=case when br.stripe_refund_id is null then 'canceled'
      else coalesce((select x->>'status' from pg_catalog.jsonb_array_elements(refunds)x where x->>'id'=br.stripe_refund_id),br.state) end,
      settled_by_external=br.stripe_refund_id is null,provider_updated_at=now_at,updated_at=now_at where br.payment_id=payment.id and br.state in('pending','requires_action');
    outcome:='paid_refund_fully_converged';
   elsif preserve_cancelled then
    -- This includes signed refund/dispute updates and paid replay. Keep the
    -- cancellation/refund generation and its durable command exactly as requested.
    update public.appointments a set payment_state=payment.payment_state,reservation_expires_at=null,updated_at=now_at where a.id=appointment.id;
    outcome:='paid_cancelled_preserved';
   elsif appointment.appointment_state='confirmed' and appointment.cancellation_requested_at is null then
    update public.appointments a set payment_state=payment.payment_state,confirmed_at=coalesce(a.confirmed_at,now_at),reservation_expires_at=null,updated_at=now_at where a.id=appointment.id returning a.* into appointment;outcome:='paid_confirmed';
   elsif appointment.appointment_state='payment_pending'and appointment.reservation_expires_at>now_at
     and appointment.cancellation_requested_at is null and appointment.refund_state='not_requested' and payment.refund_requested_at is null
     and pg_catalog.jsonb_array_length(refunds)=0 then
    update public.appointments a set appointment_state='confirmed',payment_state=payment.payment_state,calendar_state=case when a.calendar_state in('not_required','create_failed')then 'create_pending' else a.calendar_state end,calendar_generation=a.calendar_generation+case when a.calendar_state in('not_required','create_failed')then 1 else 0 end,confirmed_at=coalesce(a.confirmed_at,now_at),reservation_expires_at=null,version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
    perform public.enqueue_booking_calendar_create(appointment.id);outcome:='paid_confirmed';
   elsif appointment.start_at>now_at and coalesce(arbitration_eligible,false) then
    update public.appointments a set appointment_state='cancelled',appointment_reason='late_payment_arbitration',payment_state=payment.payment_state,review_state='late_payment',reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
    outcome:='paid_arbitration_required';
   else
    refund_generation:=case when appointment.refund_state='pending'and exists(select 1 from public.integration_outbox q where q.appointment_id=appointment.id and q.environment=appointment.environment and q.command_type='refund'and q.effect_generation=appointment.refund_generation and q.state in('pending','processing','failed'))then appointment.refund_generation else appointment.refund_generation+1 end;
    update public.appointments a set appointment_state='cancelled',appointment_reason=case when a.cancellation_requested_at is not null or a.appointment_reason in('contractor_cancelled','customer_cancelled') then coalesce(a.appointment_reason,'contractor_cancelled') else 'late_payment_refund' end,payment_state=payment.payment_state,refund_state='pending',review_state='late_payment',refund_generation=financial_reducer.refund_generation,reservation_expires_at=null,cancelled_at=coalesce(a.cancelled_at,now_at),version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
    update public.booking_payments bp set refund_state='pending',refund_requested_at=coalesce(bp.refund_requested_at,now_at),refund_generation=financial_reducer.refund_generation,refund_idempotency_key='booking-refund:'||appointment.id||':'||refund_generation,updated_at=now_at where bp.id=payment.id returning bp.* into payment;
    insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)values(appointment.profile_id,appointment.environment,appointment.id,'refund','booking-refund:'||appointment.id||':'||refund_generation,appointment.version,refund_generation,2,pg_catalog.jsonb_build_object('reason','paid_booking_not_recoverable'))on conflict(profile_id,environment,idempotency_key)do nothing;
    outcome:='paid_refund_required';
   end if;
  elsif payment.payment_state in('paid','disputed')then outcome:='failure_ignored_paid_terminal';
  elsif event_type in('checkout.session.async_payment_failed','checkout.session.expired','payment_intent.payment_failed')or checkout->>'status'='expired'or intent->>'status'in('canceled','requires_payment_method')then
   event_rank:=10;
   update public.booking_payments bp set checkout_session_id=coalesce(bp.checkout_session_id,session_id),payment_intent_id=coalesce(bp.payment_intent_id,intent_id),payment_state='failed',failed_at=coalesce(bp.failed_at,now_at),financial_provider_created=greatest(bp.financial_provider_created,provider_created),financial_event_rank=case when provider_created>=bp.financial_provider_created then greatest(bp.financial_event_rank,event_rank)else bp.financial_event_rank end,financial_provider_event_id=case when provider_created>=bp.financial_provider_created then provider_event_id else bp.financial_provider_event_id end,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id and bp.payment_state<>'paid'returning bp.* into payment;
   update public.appointments a set appointment_state='cancelled',appointment_reason=case when checkout->>'status'='expired' then 'payment_expired' else 'payment_failed' end,payment_state='failed',cancelled_at=coalesce(a.cancelled_at,now_at),reservation_expires_at=null,version=a.version+1,updated_at=now_at where a.id=appointment.id and a.appointment_state in('held','payment_pending')and a.payment_state<>'paid';
   outcome:='payment_failed';
  else
   update public.booking_payments bp set checkout_session_id=coalesce(bp.checkout_session_id,session_id),payment_intent_id=coalesce(bp.payment_intent_id,intent_id),payment_state=case when bp.payment_state in('not_started','creating')then 'pending' else bp.payment_state end,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.* into payment;
   outcome:='payment_pending_observed';
  end if;
  if dispute_status is not null then
   update public.booking_payments bp set dispute_id=provider_object_id,payment_state=paid_state,dispute_state=case when dispute_status='won'then 'won' when dispute_status='lost'then 'lost' when dispute_status='warning_closed'then 'closed' else 'open' end,dispute_provider_created=provider_created,dispute_status_rank=event_rank,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.* into payment;
   update public.appointments a set payment_state=payment.payment_state,review_state=case when a.review_state='unresolved_destination' then a.review_state
     when payment.dispute_state in('open','lost')then 'provider_inconsistency' else a.review_state end,version=a.version+1,updated_at=now_at where a.id=appointment.id;
   -- A first paid observation may already contain a won dispute. Its late-payment
   -- outcome must still create the existing arbitration obligation.
   if outcome<>'paid_arbitration_required'then outcome:='dispute_'||dispute_status;end if;
  end if;
  if outcome is null then raise exception 'Stripe event has no financial outcome' using errcode='P0001';end if;
  insert into public.booking_provider_evidence(event_id,profile_id,environment,stripe_account_id,event_type,provider_event_id,object_id,appointment_id,payload_sha256)values(inbox.id,inbox.profile_id,inbox.environment,account_id,event_type,provider_event_id,provider_object_id,payment.appointment_id,envelope_sha)on conflict(event_id)do nothing;
  if not exists(select 1 from public.booking_provider_evidence e where e.event_id=inbox.id and e.profile_id=inbox.profile_id and e.environment=inbox.environment and e.stripe_account_id=account_id and e.event_type=event_type and e.provider_event_id=provider_event_id and e.object_id=provider_object_id and e.appointment_id=payment.appointment_id and e.payload_sha256=envelope_sha)then raise exception 'immutable provider evidence conflict' using errcode='23505';end if;
  insert into public.booking_stripe_observations_v3(authority_kind,authority_id,event_id,payment_id,appointment_id,profile_id,environment,stripe_account_id,provider_event_id,event_type,provider_created,checkout_session_id,payment_intent_id,charge_id,cumulative_refunded_minor,envelope_sha256,snapshot_sha256,provider_snapshot,reduction_outcome)
  values('stripe_event',inbox.id,inbox.id,payment.id,payment.appointment_id,payment.profile_id,payment.environment,account_id,provider_event_id,event_type,provider_created,session_id,intent_id,charge_id,case when charge_id is null then null else cumulative_refunded end,envelope_sha,snapshot_sha,p_provider_snapshot,outcome)returning id into observation_id;
  for refund_item in select value from pg_catalog.jsonb_array_elements(refunds)loop
   insert into public.booking_stripe_refund_observations_v3(observation_id,stripe_refund_id,stripe_charge_id,payment_intent_id,status,amount_minor,currency,provider_created,metadata)values(observation_id,refund_item->>'id',refund_item->>'charge',refund_item->>'payment_intent',refund_item->>'status',(refund_item->>'amount')::bigint,pg_catalog.upper(refund_item->>'currency'),(refund_item->>'created')::bigint,coalesce(refund_item->'metadata','{}'));
  end loop;
  update public.provider_event_inbox i set processing_state='processed',processed_at=now_at,lease_token=null,lease_expires_at=null,safe_error=null where i.id=inbox.id and i.processing_state='processing'and i.lease_token=p_lease_token and i.fencing_token=p_fencing_token;
  if not found then raise exception 'stale Stripe event fence' using errcode='40001';end if;
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
  return pg_catalog.jsonb_build_object('action','settled','outcome',outcome);
 end if;
 -- Refund submission continues to freeze and settle the exact provider remainder.
 select o.appointment_id into strict appointment_identity from public.integration_outbox o where o.id=p_authority_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_identity::text||':booking-appointment',0));
 select o.* into strict command from public.integration_outbox o where o.id=p_authority_id and o.command_type='refund'and o.effect_contract_version=2 and o.state='processing'and o.lease_token=p_lease_token and o.fencing_token=p_fencing_token and o.lease_expires_at>pg_catalog.clock_timestamp()for update;
 if not public.booking_cutover_enabled(command.profile_id,command.environment)then raise exception 'booking cutover is not enabled' using errcode='P0001';end if;
 select p.* into strict payment from public.booking_payments p where p.appointment_id=command.appointment_id and p.profile_id=command.profile_id and p.environment=command.environment and p.booking_contract_version=2 and p.refund_generation=command.effect_generation and p.stripe_account_id=account_id for update;
 select a.* into strict appointment from public.appointments a where a.id=payment.appointment_id and a.booking_contract_version=2 and a.refund_generation=command.effect_generation for update;
 if intent_id is null or charge_id is null or intent->>'object'is distinct from 'payment_intent'or intent->'metadata'->>'kind'is distinct from 'booking'or intent->'metadata'->>'appointmentId'is distinct from appointment.id::text or charge->>'object'is distinct from 'charge'or charge->>'payment_intent'is distinct from intent_id or payment.payment_intent_id is distinct from intent_id or(payment.charge_id is not null and payment.charge_id<>charge_id)or coalesce((charge->>'amount')::bigint,-1)<>payment.amount_paid_minor or pg_catalog.upper(coalesce(charge->>'currency',''))<>payment.currency or(intent->>'livemode')::boolean is distinct from(payment.environment='live')or(charge->>'livemode')::boolean is distinct from(payment.environment='live')then raise exception 'refund Charge correlation mismatch' using errcode='P0001';end if;
 perform public.validate_booking_refund_snapshot_v3(refunds,charge_id,intent_id,payment.currency,payment.amount_paid_minor);
 select coalesce((charge->>'amount_refunded')::bigint,-1),coalesce(sum((x->>'amount')::bigint)filter(where x->>'status'='succeeded'),0),max(pg_catalog.to_timestamp((x->>'created')::bigint))filter(where x->>'status'='succeeded')into cumulative_refunded,succeeded_refund_sum,refunded_at_value from pg_catalog.jsonb_array_elements(refunds)x;
 if cumulative_refunded<payment.amount_refunded_minor or cumulative_refunded>payment.amount_paid_minor or succeeded_refund_sum<>cumulative_refunded then raise exception 'non-causal or incomplete cumulative refund evidence' using errcode='P0001';end if;
 remaining_amount:=payment.amount_paid_minor-cumulative_refunded;refund_generation:=command.effect_generation;
 paid_state:=case when payment.amount_paid_minor=payment.expected_amount_minor and payment.paid_at is not null
   then case when payment.dispute_state in('open','lost','closed')then 'disputed' else 'paid' end else payment.payment_state end;
 perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
 update public.booking_payments bp set payment_state=paid_state,charge_id=financial_reducer.charge_id,amount_refunded_minor=cumulative_refunded,refund_state=case when remaining_amount=0 then 'succeeded' else 'pending' end,refunded_at=case when remaining_amount=0 then refunded_at_value else null end,provider_updated_at=now_at,updated_at=now_at where bp.id=payment.id returning bp.* into payment;
 update public.appointments a set payment_state=payment.payment_state,refund_state=case when remaining_amount=0 then 'succeeded' else 'pending' end,review_state=case when remaining_amount=0 and a.review_state='refund_failure'then 'none' else a.review_state end,version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
 select br.* into refund_row from public.booking_refunds br where br.payment_id=payment.id and br.generation=refund_generation for update;
 if refund_row.id is not null then
  select count(*),min(x->>'id'),min(x->>'status'),min((x->>'created')::bigint)into match_count,refund_id,refund_status,refund_created from pg_catalog.jsonb_array_elements(refunds)x where(refund_row.stripe_refund_id is not null and x->>'id'=refund_row.stripe_refund_id)or(refund_row.stripe_refund_id is null and x->'metadata'->>'kind'='booking_refund'and x->'metadata'->>'bookingPaymentId'=payment.id::text and x->'metadata'->>'bookingAppointmentId'=appointment.id::text and x->'metadata'->>'bookingProfileId'=payment.profile_id::text and x->'metadata'->>'bookingEnvironment'=payment.environment and x->'metadata'->>'refundGeneration'=refund_generation::text and x->'metadata'->>'bookingCommandId'=command.id::text);
  if match_count>1 then raise exception 'multiple refunds claim one generation' using errcode='23505';end if;
  if refund_row.stripe_refund_id is not null and match_count=0 then raise exception 'bound refund missing from complete snapshot' using errcode='P0001';end if;
  if match_count=1 then update public.booking_refunds br set stripe_refund_id=refund_id,state=refund_status,provider_created=coalesce(br.provider_created,refund_created),provider_updated_at=now_at,updated_at=now_at where br.id=refund_row.id returning br.* into refund_row;end if;
 end if;
 if remaining_amount=0 then
  if refund_row.id is not null and match_count=0 then update public.booking_refunds br set state='canceled',settled_by_external=true,provider_updated_at=now_at,updated_at=now_at where br.id=refund_row.id;end if;
  update public.integration_outbox o set state='succeeded',completed_at=now_at,terminal_at=now_at,lease_token=null,lease_expires_at=null,safe_error=null where o.id=command.id;
  outcome:='refund_fully_converged';result:=pg_catalog.jsonb_build_object('action','settled','outcome',outcome);
 elsif refund_row.id is null then
  insert into public.booking_refunds(payment_id,appointment_id,profile_id,environment,generation,stripe_account_id,payment_intent_id,idempotency_key,amount_minor)values(payment.id,appointment.id,payment.profile_id,payment.environment,refund_generation,account_id,intent_id,'booking-refund:'||appointment.id||':'||refund_generation,remaining_amount)returning * into refund_row;
  outcome:='refund_submission_prepared';result:=pg_catalog.jsonb_build_object('action','create','stripeAccountId',account_id,'paymentIntentId',intent_id,'chargeId',charge_id,'amountMinor',refund_row.amount_minor,'idempotencyKey',refund_row.idempotency_key,'paymentId',payment.id,'appointmentId',appointment.id,'profileId',payment.profile_id,'environment',payment.environment,'generation',refund_generation,'commandId',command.id);
 elsif match_count=0 and refund_row.stripe_refund_id is null and refund_row.amount_minor<>remaining_amount then
  update public.booking_refunds br set state='canceled',settled_by_external=true,provider_updated_at=now_at,updated_at=now_at where br.id=refund_row.id;
  update public.integration_outbox o set state='dead_letter',terminal_at=now_at,safe_error='superseded_by_external_refund',lease_token=null,lease_expires_at=null where o.id=command.id;
  refund_generation:=refund_generation+1;
  update public.appointments a set refund_generation=financial_reducer.refund_generation,version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
  update public.booking_payments bp set refund_generation=financial_reducer.refund_generation,refund_idempotency_key='booking-refund:'||appointment.id||':'||refund_generation,updated_at=now_at where bp.id=payment.id;
  insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)values(appointment.profile_id,appointment.environment,appointment.id,'refund','booking-refund:'||appointment.id||':'||refund_generation,appointment.version,refund_generation,2,pg_catalog.jsonb_build_object('reason','external_refund_race'))on conflict(profile_id,environment,idempotency_key)do nothing;
  outcome:='refund_generation_superseded';result:=pg_catalog.jsonb_build_object('action','superseded','outcome',outcome);
 elsif match_count=0 then
  outcome:='refund_submission_ready';result:=pg_catalog.jsonb_build_object('action','create','stripeAccountId',account_id,'paymentIntentId',intent_id,'chargeId',charge_id,'amountMinor',refund_row.amount_minor,'idempotencyKey',refund_row.idempotency_key,'paymentId',payment.id,'appointmentId',appointment.id,'profileId',payment.profile_id,'environment',payment.environment,'generation',refund_generation,'commandId',command.id);
 elsif refund_status='succeeded'then
  if remaining_amount>0 then
   update public.integration_outbox o set state='dead_letter',terminal_at=now_at,safe_error='owned_refund_partial_remainder',lease_token=null,lease_expires_at=null where o.id=command.id;
   refund_generation:=refund_generation+1;
   update public.appointments a set refund_generation=financial_reducer.refund_generation,version=a.version+1,updated_at=now_at where a.id=appointment.id returning a.* into appointment;
   update public.booking_payments bp set refund_generation=financial_reducer.refund_generation,refund_idempotency_key='booking-refund:'||appointment.id||':'||refund_generation,updated_at=now_at where bp.id=payment.id;
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
  update public.integration_outbox o set state='failed',next_attempt_at=now_at+interval '15 minutes',safe_error='Stripe refund pending reconciliation',lease_token=null,lease_expires_at=null where o.id=command.id;
  outcome:='refund_submission_pending';result:=pg_catalog.jsonb_build_object('action','waiting','outcome',outcome);
 end if;
 insert into public.booking_stripe_observations_v3(authority_kind,authority_id,command_id,payment_id,appointment_id,profile_id,environment,stripe_account_id,provider_created,payment_intent_id,charge_id,cumulative_refunded_minor,snapshot_sha256,provider_snapshot,reduction_outcome)
 values('refund_command',command.id,command.id,payment.id,payment.appointment_id,payment.profile_id,payment.environment,account_id,0,intent_id,charge_id,cumulative_refunded,snapshot_sha,p_provider_snapshot,outcome)on conflict(authority_kind,authority_id,snapshot_sha256,reduction_outcome)do nothing returning id into observation_id;
 if observation_id is null then select b.id into strict observation_id from public.booking_stripe_observations_v3 b where b.authority_kind='refund_command'and b.authority_id=command.id and b.snapshot_sha256=snapshot_sha and b.reduction_outcome=outcome;end if;
 perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
 for refund_item in select value from pg_catalog.jsonb_array_elements(refunds)loop
  insert into public.booking_stripe_refund_observations_v3(observation_id,stripe_refund_id,stripe_charge_id,payment_intent_id,status,amount_minor,currency,provider_created,metadata)values(observation_id,refund_item->>'id',refund_item->>'charge',refund_item->>'payment_intent',refund_item->>'status',(refund_item->>'amount')::bigint,pg_catalog.upper(refund_item->>'currency'),(refund_item->>'created')::bigint,coalesce(refund_item->'metadata','{}'))on conflict on constraint booking_stripe_refund_observations_v3_pkey do nothing;
 end loop;
 return result;
end $function$;
revoke all on function public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb) to booking_worker;

create or replace function public.queue_booking_late_payment_refund(p_arbitration_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $function$
declare arb public.booking_late_payment_arbitrations%rowtype;a public.appointments%rowtype;p public.booking_payments%rowtype;v_generation bigint;
begin
 select * into strict arb from public.booking_late_payment_arbitrations where id=p_arbitration_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(arb.profile_id::text||':'||arb.environment||':booking',0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(arb.appointment_id::text||':booking-appointment',0));
 select * into strict a from public.appointments where id=arb.appointment_id and profile_id=arb.profile_id and environment=arb.environment for update;
  select * into strict p from public.booking_payments where id=arb.payment_id and appointment_id=a.id for update;
  select * into strict arb from public.booking_late_payment_arbitrations where id=p_arbitration_id for update;
  perform public.converge_booking_full_refund_v3(a.id);
  if arb.status in('recovered','refund_required')then return true;end if;
 if p.payment_state not in('paid','disputed') and not(a.booking_contract_version=2 and p.booking_contract_version=2
   and p.amount_paid_minor=p.expected_amount_minor and p.paid_at is not null and p.payment_intent_id is not null and p.charge_id is not null)
   then raise exception 'late-payment refund requires provider payment evidence' using errcode='P0001';end if;
 if a.appointment_state='cancelled' and p.amount_paid_minor>p.amount_refunded_minor
   and a.refund_state not in('succeeded','failed') and p.refund_state not in('succeeded','failed') then
  v_generation:=case when a.refund_state='pending'and p.refund_state='pending'then greatest(a.refund_generation,p.refund_generation,1)else greatest(a.refund_generation,p.refund_generation)+1 end;
  update public.appointments set appointment_reason=case when cancellation_requested_at is not null or appointment_reason in('contractor_cancelled','customer_cancelled') then appointment_reason else 'late_payment_refund' end,
    cancelled_at=coalesce(cancelled_at,pg_catalog.clock_timestamp()),refund_state='pending',
    review_state=case when cancellation_requested_at is not null then review_state else 'late_payment' end,
    refund_generation=v_generation,version=version+1,updated_at=pg_catalog.clock_timestamp()where id=a.id returning * into a;
  update public.booking_payments set refund_state='pending',refund_requested_at=coalesce(refund_requested_at,pg_catalog.clock_timestamp()),refund_generation=v_generation,
    refund_idempotency_key=coalesce(refund_idempotency_key,'booking-refund:'||a.id||':'||v_generation),updated_at=pg_catalog.clock_timestamp()where id=p.id;
  insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)
    values(a.profile_id,a.environment,a.id,'refund','booking-refund:'||a.id||':'||v_generation,a.version,v_generation,2,pg_catalog.jsonb_build_object('amount',p.amount_paid_minor-p.amount_refunded_minor,'reason',left(coalesce(p_reason,'late_payment'),120)))on conflict(profile_id,environment,idempotency_key)do nothing;
 end if;
 update public.booking_late_payment_arbitrations set status='refund_required',decision_code=left(coalesce(p_reason,'late_payment_refund'),120),decided_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where id=arb.id;
 perform public.enqueue_booking_notification(a.id,'late_payment');
 return true;
end $function$;
revoke all on function public.queue_booking_late_payment_refund(uuid,text) from public,anon,authenticated,service_role,booking_worker;

create or replace function public.claim_booking_late_payment_arbitrations(p_environment text,p_lease_token uuid,p_limit integer default 25)
returns table(arbitration jsonb,appointment jsonb,provider_context jsonb)language plpgsql security definer set search_path='' as $function$
declare candidate record;arb public.booking_late_payment_arbitrations%rowtype;a public.appointments%rowtype;c public.calendar_connections%rowtype;
  sched public.availability_schedules%rowtype;service public.booking_services%rowtype;ids jsonb;id_text text;claimed integer:=0;
begin
  if p_lease_token is null or p_environment is null or p_environment not in('test','live')then raise exception 'late-payment lease and environment required' using errcode='22023';end if;
  for candidate in select x.id,x.appointment_id,x.profile_id,x.environment from public.booking_late_payment_arbitrations x
    where x.environment=p_environment and public.booking_cutover_enabled(x.profile_id,x.environment)
      and x.status in('due','processing','retry_wait')and(x.status<>'processing'or x.lease_expires_at<=pg_catalog.clock_timestamp())
      and x.next_attempt_at<=pg_catalog.clock_timestamp() order by x.deadline_at,x.next_attempt_at,x.id
    limit greatest(1,least(coalesce(p_limit,25),100))*4
  loop
    -- Claim and settlement use the same tenant -> connection -> appointment ->
    -- arbitration order. Never hold arbitration while waiting for its owner.
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.profile_id::text||':'||candidate.environment||':booking',0))then continue;end if;
    select * into c from public.calendar_connections where profile_id=candidate.profile_id and environment=candidate.environment for no key update skip locked;
    if c.id is null and exists(select 1 from public.calendar_connections where profile_id=candidate.profile_id and environment=candidate.environment)then continue;end if;
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.appointment_id::text||':booking-appointment',0))then continue;end if;
    select * into a from public.appointments where id=candidate.appointment_id and profile_id=candidate.profile_id and environment=candidate.environment for update skip locked;
    if not found then continue;end if;
    select * into arb from public.booking_late_payment_arbitrations where id=candidate.id and status in('due','processing','retry_wait')
      and(status<>'processing'or lease_expires_at<=pg_catalog.clock_timestamp())and next_attempt_at<=pg_catalog.clock_timestamp()for update skip locked;
    if not found then continue;end if;
    if arb.deadline_at<=pg_catalog.clock_timestamp() or a.appointment_reason is distinct from 'late_payment_arbitration'
      or a.appointment_state<>'cancelled' or a.cancellation_requested_at is not null then
      perform public.queue_booking_late_payment_refund(arb.id,case when a.cancellation_requested_at is not null then 'late_payment_intent_changed' else 'late_payment_arbitration_deadline' end);
      continue;
    end if;
    select coalesce(pg_catalog.jsonb_agg(x.google_calendar_id order by x.google_calendar_id),'[]'::jsonb),pg_catalog.string_agg(x.google_calendar_id,E'\n'order by x.google_calendar_id)
      into ids,id_text from public.calendar_selections x where x.profile_id=arb.profile_id and x.environment=arb.environment and x.active and x.blocks_availability;
    select * into sched from public.availability_schedules where profile_id=arb.profile_id and environment=arb.environment and active;
    select * into service from public.booking_services where id=a.service_id and profile_id=arb.profile_id and environment=arb.environment and active;
    update public.booking_late_payment_arbitrations set status='processing',attempts=attempts+1,lease_token=p_lease_token,
      lease_expires_at=pg_catalog.clock_timestamp()+interval '90 seconds',fencing_token=fencing_token+1,snapshot_generation=snapshot_generation+1,
      snapshot_appointment_version=a.version,snapshot_connection_id=c.id,snapshot_pipedream_account_id=c.pipedream_account_id,
      snapshot_availability_generation=c.availability_generation,snapshot_calendar_ids=ids,
      snapshot_calendar_set_hash=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(id_text,''),'UTF8'),'sha256'),'hex'),
      snapshot_schedule_revision=sched.revision,snapshot_service_revision=service.revision,claimed_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
      where id=arb.id returning * into arb;
    return query select pg_catalog.to_jsonb(arb),pg_catalog.to_jsonb(a),pg_catalog.jsonb_build_object('connectionId',arb.snapshot_connection_id,
      'accountId',arb.snapshot_pipedream_account_id,'availabilityGeneration',arb.snapshot_availability_generation,'calendarIds',arb.snapshot_calendar_ids,
      'calendarSetHash',arb.snapshot_calendar_set_hash,'rangeStart',a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),
      'rangeEnd',a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'scheduleRevision',arb.snapshot_schedule_revision,'serviceRevision',arb.snapshot_service_revision);
    claimed:=claimed+1;exit when claimed>=greatest(1,least(coalesce(p_limit,25),100));
  end loop;
end $function$;
revoke all on function public.claim_booking_late_payment_arbitrations(text,uuid,integer) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.claim_booking_late_payment_arbitrations(text,uuid,integer) to booking_worker;

create or replace function public.record_booking_late_payment_observation(
 p_arbitration_id uuid,p_lease_token uuid,p_fencing_token bigint,p_snapshot_generation bigint,
 p_observed_at timestamptz,p_observation_state text,p_busy_ranges jsonb,p_safe_error text default null
) returns text language plpgsql security definer set search_path='' as $function$
declare arb public.booking_late_payment_arbitrations%rowtype;a public.appointments%rowtype;p public.booking_payments%rowtype;
 c public.calendar_connections%rowtype;sched public.availability_schedules%rowtype;service public.booking_services%rowtype;
 ids jsonb;id_text text;request_hash text;response_hash text;config_current boolean:=false;policy_current boolean:=false;busy boolean:=false;internal_busy boolean:=false;delay_seconds integer;
begin
 if p_lease_token is null or p_observation_state is null or p_observation_state not in('complete','transient_error','permanent_error')or pg_catalog.jsonb_typeof(coalesce(p_busy_ranges,'null'::jsonb))<>'array'then raise exception 'invalid late-payment observation' using errcode='22023';end if;
 select * into strict arb from public.booking_late_payment_arbitrations where id=p_arbitration_id;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(arb.profile_id::text||':'||arb.environment||':booking',0));
 -- Match reservation's connection-before-appointment order while checking the
 -- exact availability snapshot; disconnect cannot race the final decision.
 select * into c from public.calendar_connections where id=arb.snapshot_connection_id and profile_id=arb.profile_id and environment=arb.environment for no key update;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(arb.appointment_id::text||':booking-appointment',0));
 select * into strict a from public.appointments where id=arb.appointment_id and profile_id=arb.profile_id and environment=arb.environment for update;
 select * into strict p from public.booking_payments where id=arb.payment_id and appointment_id=a.id for update;
 select * into strict arb from public.booking_late_payment_arbitrations where id=p_arbitration_id and status='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and snapshot_generation=p_snapshot_generation and lease_expires_at>pg_catalog.clock_timestamp()for update;
 if not public.booking_cutover_enabled(a.profile_id,a.environment)then raise exception 'booking cutover is not enabled' using errcode='42501';end if;
 request_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('accountId',arb.snapshot_pipedream_account_id,'calendarIds',arb.snapshot_calendar_ids,'rangeStart',a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),'rangeEnd',a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'snapshotGeneration',arb.snapshot_generation)::text,'UTF8'),'sha256'),'hex');
 response_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('state',p_observation_state,'observedAt',p_observed_at,'busyRanges',p_busy_ranges)::text,'UTF8'),'sha256'),'hex');
 insert into public.booking_late_payment_observations(arbitration_id,snapshot_generation,observation_state,observed_at,busy_ranges,request_sha256,response_sha256,safe_error,lease_token,fencing_token)values(arb.id,arb.snapshot_generation,p_observation_state,p_observed_at,p_busy_ranges,request_hash,response_hash,left(p_safe_error,240),p_lease_token,p_fencing_token);
 if a.appointment_state<>'cancelled' or a.appointment_reason is distinct from 'late_payment_arbitration'
   or a.cancellation_requested_at is not null or a.confirmed_at is not null or a.refund_state<>'not_requested'
   or p.refund_state<>'not_requested' or p.refund_requested_at is not null or p.amount_refunded_minor>0 or p.payment_state<>'paid'
   or p.dispute_state in('open','lost','closed')
   or arb.deadline_at<=pg_catalog.clock_timestamp() then
   perform public.queue_booking_late_payment_refund(arb.id,'late_payment_intent_changed');return 'refund_required';
 end if;
 if p_observation_state='transient_error'then
  if arb.attempts>=4 or arb.deadline_at<=pg_catalog.clock_timestamp()+interval '5 seconds'then perform public.queue_booking_late_payment_refund(arb.id,'late_payment_freebusy_retry_exhausted');return 'refund_required';end if;
  delay_seconds:=1+mod(abs(pg_catalog.hashtextextended(arb.id::text||':'||arb.fencing_token,0))::numeric,least(30,5*pg_catalog.power(2,arb.attempts-1)::integer)::numeric)::integer;
  update public.booking_late_payment_arbitrations set status='retry_wait',next_attempt_at=least(deadline_at,pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>delay_seconds)),lease_token=null,lease_expires_at=null,decision_code='freebusy_transient_error',updated_at=pg_catalog.clock_timestamp()where id=arb.id;return 'retry';
 elsif p_observation_state='permanent_error'then perform public.queue_booking_late_payment_refund(arb.id,'late_payment_freebusy_unavailable');return 'refund_required';end if;
 if p_observed_at is null or p_observed_at<arb.claimed_at or p_observed_at<pg_catalog.clock_timestamp()-interval '30 seconds'or p_observed_at>pg_catalog.clock_timestamp()+interval '1 minute'then raise exception 'stale late-payment provider observation' using errcode='40001';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_busy_ranges)r where pg_catalog.jsonb_typeof(r)<>'object'or not(r?'start'and r?'end'))then raise exception 'invalid FreeBusy range evidence' using errcode='22023';end if;
 select coalesce(pg_catalog.jsonb_agg(x.google_calendar_id order by x.google_calendar_id),'[]'::jsonb),pg_catalog.string_agg(x.google_calendar_id,E'\n'order by x.google_calendar_id)into ids,id_text from public.calendar_selections x where x.profile_id=arb.profile_id and x.environment=arb.environment and x.active and x.blocks_availability;
 select * into sched from public.availability_schedules where profile_id=arb.profile_id and environment=arb.environment and active;
 select * into service from public.booking_services where id=a.service_id and profile_id=arb.profile_id and environment=arb.environment and active;
 config_current:=c.id is not null and c.health_state='healthy' and c.reconnect_reason is null
   and c.pipedream_account_id=arb.snapshot_pipedream_account_id and c.availability_generation=arb.snapshot_availability_generation
   and ids=arb.snapshot_calendar_ids and pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(id_text,''),'UTF8'),'sha256'),'hex')=arb.snapshot_calendar_set_hash
   and sched.revision=arb.snapshot_schedule_revision and service.revision=arb.snapshot_service_revision and a.version=arb.snapshot_appointment_version
   and not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=a.profile_id and d.environment=a.environment and d.provider='pipedream' and d.provider_account_id=c.pipedream_account_id and d.state in('pending','completed'));
 policy_current:=config_current and a.start_at>=pg_catalog.clock_timestamp()+pg_catalog.make_interval(mins=>service.minimum_notice_minutes)
   and a.time_zone=sched.time_zone and a.schedule_revision=sched.revision and(coalesce((a.service_snapshot->>'revision')::bigint,service.revision)=service.revision)
   and not exists(select 1 from public.availability_overrides o where o.schedule_id=sched.id and o.local_date=a.local_date and o.override_type='unavailable')
   and((exists(select 1 from public.availability_overrides o join public.availability_override_intervals oi on oi.override_id=o.id where o.schedule_id=sched.id and o.local_date=a.local_date and o.override_type='custom_hours'and a.local_start>=oi.local_start and(a.end_at at time zone a.time_zone)::time<=oi.local_end))or(not exists(select 1 from public.availability_overrides o where o.schedule_id=sched.id and o.local_date=a.local_date and o.override_type='custom_hours')and exists(select 1 from public.availability_intervals ai where ai.schedule_id=sched.id and ai.weekday=extract(dow from a.local_date)::integer and a.local_start>=ai.local_start and(a.end_at at time zone a.time_zone)::time<=ai.local_end)));
 busy:=exists(select 1 from pg_catalog.jsonb_array_elements(p_busy_ranges)r where tstzrange((r->>'start')::timestamptz,(r->>'end')::timestamptz,'[)')&&tstzrange(a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'[)'));
 internal_busy:=exists(select 1 from public.appointments x where x.id<>a.id and x.profile_id=a.profile_id and x.environment=a.environment and x.appointment_state in('held','payment_pending','confirmed')and tstzrange(x.start_at-pg_catalog.make_interval(mins=>x.buffer_before_minutes),x.end_at+pg_catalog.make_interval(mins=>x.buffer_after_minutes),'[)')&&tstzrange(a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'[)'));
 if not coalesce(config_current,false) then
  if arb.attempts<4 and arb.deadline_at>pg_catalog.clock_timestamp()+interval '5 seconds'then update public.booking_late_payment_arbitrations set status='retry_wait',next_attempt_at=pg_catalog.clock_timestamp()+interval '5 seconds',lease_token=null,lease_expires_at=null,decision_code='configuration_changed',updated_at=pg_catalog.clock_timestamp()where id=arb.id;return 'retry';end if;
  perform public.queue_booking_late_payment_refund(arb.id,'late_payment_configuration_changed');return 'refund_required';
 end if;
 if not coalesce(policy_current,false) or busy or internal_busy then perform public.queue_booking_late_payment_refund(arb.id,case when busy then 'late_payment_google_conflict' when internal_busy then 'late_payment_internal_conflict' else 'late_payment_policy_changed' end);return 'refund_required';end if;
 begin
  update public.appointments set appointment_state='confirmed',appointment_reason='late_payment_recovered',confirmed_at=coalesce(confirmed_at,pg_catalog.clock_timestamp()),cancelled_at=null,payment_state='paid',calendar_state='create_pending',calendar_generation=calendar_generation+1,review_state=case when review_state='unresolved_destination' then review_state else 'late_payment' end,version=version+1,updated_at=pg_catalog.clock_timestamp()
    where id=a.id and version=arb.snapshot_appointment_version and cancellation_requested_at is null and refund_state='not_requested' returning * into a;
 exception when exclusion_violation then perform public.queue_booking_late_payment_refund(arb.id,'late_payment_exclusion_conflict');return 'refund_required';end;
 if a.id is null then raise exception 'stale late-payment appointment version' using errcode='40001';end if;
 perform public.enqueue_booking_calendar_create(a.id);
 update public.booking_late_payment_arbitrations set status='recovered',decision_code='fresh_freebusy_clear',decided_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where id=arb.id;
 perform public.enqueue_booking_notification(a.id,'late_payment');return 'recovered';
end $function$;
revoke all on function public.record_booking_late_payment_observation(uuid,uuid,bigint,bigint,timestamptz,text,jsonb,text) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.record_booking_late_payment_observation(uuid,uuid,bigint,bigint,timestamptz,text,jsonb,text) to booking_worker;

do $existing_paid$
declare appointment_id uuid;
begin
  for appointment_id in select a.id from public.appointments a where a.booking_contract_version=2
    and a.appointment_state='confirmed' and a.payment_state in ('paid','disputed')
    and not exists(select 1 from public.calendar_event_links l where l.appointment_id=a.id and l.environment=a.environment and l.destination_epoch_id is not null)
  loop perform public.enqueue_booking_calendar_create(appointment_id);end loop;
end $existing_paid$;

alter table public.calendar_event_links
  add column failure_kind text check (failure_kind in ('temporary','platform','reauthorization','permissions','configuration')),
  add column failure_code text check (failure_code in ('provider_temporary','provider_platform','provider_reauthorization_required',
    'calendar_permissions_changed','calendar_write_blocked','provider_configuration_error','calendar_event_invalid',
    'calendar_identity_conflict','calendar_effect_not_yet_visible','appointment_elapsed','contractor_disconnected')),
  add column failure_observed_at timestamptz,
  add column snapshot_connection_revision bigint;
alter table public.calendar_connections
  add column calendar_write_blocked_at timestamptz,
  add column calendar_write_verified_at timestamptz,
  add column calendar_create_blocked_at timestamptz,
  add column calendar_delete_blocked_at timestamptz,
  add column calendar_create_verified_at timestamptz,
  add column calendar_delete_verified_at timestamptz,
  add column calendar_probe_insert_blocked_at timestamptz,
  add column calendar_probe_insert_verified_at timestamptz;
alter table public.booking_calendar_effect_attempts
  add column connection_revision bigint,
  add column intended_content_sha256 text check (intended_content_sha256 ~ '^[a-f0-9]{64}$');
-- calendar_write_blocked is in 20260910120000's finite verification reason list.

-- Capability evidence compares the intended event, not the financial version.
-- Start/end are instants; attendee address follows Google's case-insensitive match.
create function public.booking_calendar_content_sha256(p_appointment public.appointments)
returns text language sql stable set search_path='' as $function$
 select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
   p_appointment.id,extract(epoch from p_appointment.start_at),extract(epoch from p_appointment.end_at),
   pg_catalog.lower(pg_catalog.btrim(p_appointment.customer_snapshot->>'email')))::text,'UTF8'),'sha256'),'hex')
$function$;
revoke all on function public.booking_calendar_content_sha256(public.appointments) from public,anon,authenticated,service_role,booking_worker;

-- Private-probe INSERT and attendee-bearing CREATE are independent capabilities.
-- Read-only health refresh is not evidence that either write works.
-- A verified explicit configuration revision starts a new capability scope.
create function public.preserve_booking_calendar_write_blocker() returns trigger
language plpgsql set search_path='' as $function$
begin
  if (new.connection_revision,new.pipedream_account_id) is distinct from (old.connection_revision,old.pipedream_account_id)
    and new.verification_reason is distinct from 'calendar_write_blocked' then
    new.calendar_write_blocked_at:=null;new.calendar_write_verified_at:=null;
    new.calendar_create_blocked_at:=null;new.calendar_delete_blocked_at:=null;
    new.calendar_create_verified_at:=null;new.calendar_delete_verified_at:=null;
    new.calendar_probe_insert_blocked_at:=null;new.calendar_probe_insert_verified_at:=null;
    return new;
  end if;
  if old.calendar_create_blocked_at is not null and new.calendar_create_blocked_at is null
    and not coalesce(new.calendar_create_verified_at>=old.calendar_create_blocked_at
      and new.calendar_create_verified_at is distinct from old.calendar_create_verified_at,false) then
    new.calendar_create_blocked_at:=old.calendar_create_blocked_at;
  end if;
  if old.calendar_delete_blocked_at is not null and new.calendar_delete_blocked_at is null
    and not coalesce(new.calendar_delete_verified_at>=old.calendar_delete_blocked_at
      and new.calendar_delete_verified_at is distinct from old.calendar_delete_verified_at,false) then
    new.calendar_delete_blocked_at:=old.calendar_delete_blocked_at;
  end if;
  if old.calendar_probe_insert_blocked_at is not null and new.calendar_probe_insert_blocked_at is null
    and not coalesce(new.calendar_probe_insert_verified_at>=old.calendar_probe_insert_blocked_at
      and new.calendar_probe_insert_verified_at is distinct from old.calendar_probe_insert_verified_at,false) then
    new.calendar_probe_insert_blocked_at:=old.calendar_probe_insert_blocked_at;
  end if;
  -- A pre-lifetime unclassified blocker cannot be cleared by guessing its cause.
  if new.calendar_create_blocked_at is null and new.calendar_delete_blocked_at is null and new.calendar_probe_insert_blocked_at is null
    and (new.verification_reason='calendar_write_blocked' or new.calendar_write_blocked_at is not null)
    and old.calendar_create_blocked_at is null and old.calendar_delete_blocked_at is null and old.calendar_probe_insert_blocked_at is null then
    new.calendar_create_blocked_at:=coalesce(new.calendar_write_blocked_at,pg_catalog.clock_timestamp());
    new.calendar_delete_blocked_at:=new.calendar_create_blocked_at;
  end if;
  new.calendar_write_blocked_at:=greatest(new.calendar_create_blocked_at,new.calendar_delete_blocked_at,new.calendar_probe_insert_blocked_at);
  new.calendar_write_verified_at:=greatest(new.calendar_create_verified_at,new.calendar_delete_verified_at,new.calendar_probe_insert_verified_at);
  if new.calendar_write_blocked_at is not null and coalesce(new.verification_reason,'')
    not in ('contractor_disconnected','provider_reauthorization_required') then
    new.verification_reason:='calendar_write_blocked';
    if new.health_state<>'disconnected' then new.health_state:='degraded';end if;
  elsif new.calendar_write_blocked_at is null and new.verification_reason='calendar_write_blocked' then
    new.verification_reason:=null;
  end if;
  return new;
end $function$;
create trigger calendar_connections_preserve_booking_write_blocker before update on public.calendar_connections
for each row execute function public.preserve_booking_calendar_write_blocker();
revoke all on function public.preserve_booking_calendar_write_blocker() from public,anon,authenticated,service_role,booking_worker;
update public.calendar_connections set calendar_write_blocked_at=updated_at
  where verification_reason='calendar_write_blocked' and calendar_write_blocked_at is null;

-- Calendar transitions share connection -> appointment -> link locking. The
-- financial reducer never needs the mutable connection to settle paid truth.
create function public.lock_booking_calendar_claim(
  p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint
) returns public.calendar_event_links language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;
begin
  select * into l from public.calendar_event_links where id=p_link_id;
  if l.id is null then return null;end if;
  perform 1 from public.calendar_connections c join public.calendar_destination_epochs e
    on e.connection_id=c.id and e.profile_id=c.profile_id and e.environment=c.environment
    where e.id=l.destination_epoch_id and e.profile_id=l.profile_id and e.environment=l.environment for no key update of c;
  if not found then return null;end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(l.appointment_id::text||':booking-appointment',0));
  perform 1 from public.appointments where id=l.appointment_id and profile_id=l.profile_id and environment=l.environment for update;
  select x.* into l from public.calendar_event_links x join public.appointments a
    on a.id=x.appointment_id and a.profile_id=x.profile_id and a.environment=x.environment
    where x.id=p_link_id and x.reconcile_status='processing' and x.reconcile_lease_token=p_lease_token
      and x.reconcile_fencing_token=p_fencing_token and x.desired_generation=p_expected_generation
      and x.snapshot_desired_generation=p_expected_generation and x.snapshot_appointment_version=p_expected_appointment_version
      and a.version=p_expected_appointment_version and x.reconcile_lease_expires_at>pg_catalog.clock_timestamp()
      and x.desired_state=case when a.appointment_state='confirmed' then 'present' else 'absent' end
      and public.booking_cutover_enabled(x.profile_id,x.environment) for update of x;
  return l;
end $function$;
revoke all on function public.lock_booking_calendar_claim(uuid,uuid,bigint,bigint,bigint)
  from public,anon,authenticated,service_role,booking_worker;

create or replace function public.project_booking_calendar_desire() returns trigger
language plpgsql security definer set search_path='' as $function$
declare desired text;
begin
  if new.appointment_state not in ('confirmed','cancelled') then return new;end if;
  desired:=case when new.appointment_state='confirmed' then 'present' else 'absent' end;
  update public.calendar_event_links set desired_state=desired,
    desired_generation=case when desired_state<>desired then greatest(desired_generation+1,new.calendar_generation,1)
      else greatest(desired_generation,new.calendar_generation,1) end,
    desired_appointment_version=new.version,
    reconcile_status=case when reconcile_status='manual_repair' then 'manual_repair' else 'due' end,
    reconcile_next_attempt_at=pg_catalog.clock_timestamp(),reconcile_attempts=0,
    reconcile_lease_token=null,reconcile_lease_expires_at=null,drift_scan_count=0,
    stability_scan_until=case when desired='present' then new.start_at else pg_catalog.clock_timestamp()+interval '24 hours' end,
    updated_at=pg_catalog.clock_timestamp()
    where appointment_id=new.id and profile_id=new.profile_id and environment=new.environment
      and (desired_state<>desired or desired_generation<new.calendar_generation);
  return new;
end $function$;
revoke all on function public.project_booking_calendar_desire() from public,anon,authenticated,service_role,booking_worker;

create or replace function public.claim_booking_calendar_reconciliation(p_environment text,p_lease_token uuid,p_limit integer default 25)
returns table(link jsonb,appointment jsonb,epoch jsonb) language plpgsql security definer set search_path='' as $function$
declare candidate record;l public.calendar_event_links%rowtype;a public.appointments%rowtype;
  e public.calendar_destination_epochs%rowtype;c public.calendar_connections%rowtype;claimed integer:=0;authorized_recovery boolean;
begin
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null then
    raise exception 'calendar convergence lease required' using errcode='22023';
  end if;
  for candidate in select x.id,x.appointment_id,x.destination_epoch_id from public.calendar_event_links x
    where x.environment=p_environment and x.reconcile_next_attempt_at<=pg_catalog.clock_timestamp()
      and public.booking_cutover_enabled(x.profile_id,x.environment) and x.destination_epoch_id is not null
      and (x.reconcile_status in ('due','retry_wait') or (x.reconcile_status='processing' and x.reconcile_lease_expires_at<=pg_catalog.clock_timestamp())
        or (x.reconcile_status='manual_repair' and x.failure_kind in ('temporary','platform','reauthorization','permissions')
          and x.failure_code in ('provider_temporary','provider_platform','provider_reauthorization_required','calendar_permissions_changed','calendar_write_blocked','contractor_disconnected')))
    order by x.reconcile_next_attempt_at,x.id limit greatest(1,least(coalesce(p_limit,25),100))*4
  loop
    select * into strict e from public.calendar_destination_epochs where id=candidate.destination_epoch_id;
    select * into c from public.calendar_connections where id=e.connection_id and profile_id=e.profile_id and environment=e.environment for no key update skip locked;
    if not found then continue;end if;
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.appointment_id::text||':booking-appointment',0)) then continue;end if;
    select * into a from public.appointments where id=candidate.appointment_id and profile_id=e.profile_id and environment=e.environment for update skip locked;
    if not found then continue;end if;
    select * into l from public.calendar_event_links where id=candidate.id and profile_id=e.profile_id and environment=e.environment
      and reconcile_next_attempt_at<=pg_catalog.clock_timestamp()
      and (reconcile_status in ('due','retry_wait','manual_repair') or (reconcile_status='processing' and reconcile_lease_expires_at<=pg_catalog.clock_timestamp())) for update skip locked;
    if not found then continue;end if;
    if exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=e.profile_id
      and d.environment=e.environment and d.provider='pipedream' and d.provider_account_id=e.pipedream_account_id
      and d.state in ('pending','completed')) then
      -- Preserve historic conflict/unknown repair causes, even while disconnected.
      if l.reconcile_status<>'manual_repair' then
        update public.calendar_event_links set reconcile_status='retry_wait',reconcile_next_attempt_at=pg_catalog.clock_timestamp()+interval '30 minutes',
          reconcile_lease_token=null,reconcile_lease_expires_at=null,failure_kind='reauthorization',failure_code='contractor_disconnected',
          failure_observed_at=pg_catalog.clock_timestamp(),safe_error='contractor_disconnected',updated_at=pg_catalog.clock_timestamp() where id=l.id;
        update public.appointments set calendar_state=case when l.desired_state='present' then 'create_failed' else 'cancel_failed' end,
          review_state=case when review_state in ('none','calendar_reconciliation') then 'calendar_reconciliation' else review_state end,
          updated_at=pg_catalog.clock_timestamp() where id=a.id;
      end if;
      continue;
    end if;
    authorized_recovery:=c.pipedream_account_id=e.pipedream_account_id
      and (c.health_state='healthy' or (c.health_state='degraded' and c.verification_reason='calendar_write_blocked'))
      and c.reconnect_reason is null and c.last_verified_at>l.failure_observed_at
      and c.last_verified_at between pg_catalog.clock_timestamp()-interval '15 minutes' and pg_catalog.clock_timestamp()+interval '1 minute'
      and exists(select 1 from public.calendar_selections s where s.connection_id=c.id and s.profile_id=c.profile_id
        and s.environment=c.environment and s.google_calendar_id=e.google_calendar_id and s.active
        and s.access_role in ('writer','owner') and s.permission_verified_at>l.failure_observed_at
        and s.permission_verified_at between pg_catalog.clock_timestamp()-interval '15 minutes' and pg_catalog.clock_timestamp()+interval '1 minute');
    if l.reconcile_status='manual_repair' and not coalesce(l.failure_kind in ('temporary','platform','reauthorization','permissions')
      and l.failure_code in ('provider_temporary','provider_platform','provider_reauthorization_required','calendar_permissions_changed','calendar_write_blocked','contractor_disconnected')
      and (l.failure_kind='permissions' or authorized_recovery) and l.desired_appointment_version=a.version
      and ((l.desired_state='present' and a.appointment_state='confirmed' and a.start_at>pg_catalog.clock_timestamp()
          and a.cancellation_requested_at is null and a.payment_state in ('paid','disputed') and a.refund_state='not_requested')
        or (l.desired_state='absent' and a.appointment_state='cancelled')),false) then
      update public.calendar_event_links set reconcile_next_attempt_at=pg_catalog.clock_timestamp()+interval '30 minutes' where id=l.id;
      continue;
    end if;
    -- A due permission retry verifies this immutable epoch by exact provider GET,
    -- not by today's selected account/calendar. The effect still requires that
    -- fenced readback. Confirmed revocation never inherits another account's health.
    if (l.failure_kind='reauthorization' and not coalesce(authorized_recovery,false))
      or (c.pipedream_account_id=e.pipedream_account_id and (c.health_state='disconnected' or c.reconnect_reason is not null)) then
      update public.calendar_event_links set reconcile_next_attempt_at=pg_catalog.clock_timestamp()+interval '30 minutes' where id=l.id;
      continue;
    end if;
    if l.desired_state<>(case when a.appointment_state='confirmed' then 'present' else 'absent' end) then
      update public.calendar_event_links set desired_state=case when a.appointment_state='confirmed' then 'present' else 'absent' end,
        desired_generation=greatest(desired_generation+1,a.calendar_generation,1),reconcile_attempts=0,
        drift_scan_count=0,stability_scan_until=case when a.appointment_state='confirmed' then a.start_at else pg_catalog.clock_timestamp()+interval '24 hours' end
        where id=l.id returning * into l;
    end if;
    update public.calendar_event_links set reconcile_status='processing',reconcile_attempts=reconcile_attempts+1,
      reconcile_lease_token=p_lease_token,reconcile_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',
      reconcile_fencing_token=reconcile_fencing_token+1,snapshot_appointment_version=a.version,
      snapshot_desired_generation=desired_generation,desired_appointment_version=a.version,
      snapshot_connection_revision=case when c.pipedream_account_id=e.pipedream_account_id
        and exists(select 1 from public.calendar_selections s where s.connection_id=c.id and s.profile_id=c.profile_id
          and s.environment=c.environment and s.active and s.receives_bookings and s.google_calendar_id=e.google_calendar_id)
        then c.connection_revision else null end,
      manual_repair_at=null,manual_repair_reason=null,last_attempt_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
      where id=l.id returning * into l;
    return query select pg_catalog.to_jsonb(l),pg_catalog.to_jsonb(a),pg_catalog.to_jsonb(e);
    claimed:=claimed+1;
    exit when claimed>=greatest(1,least(coalesce(p_limit,25),100));
  end loop;
end $function$;

-- Negative capability evidence belongs to the original effect, not the link's
-- current lease or desired state. Cancellation cannot erase an observed denial.
create function public.record_booking_calendar_write_denial(p_effect public.booking_calendar_effect_attempts)
returns void language sql security definer set search_path='' as $function$
  update public.calendar_connections c set
    calendar_create_blocked_at=case when p_effect.action='create' then greatest(c.calendar_create_blocked_at,coalesce(p_effect.completed_at,pg_catalog.clock_timestamp())) else c.calendar_create_blocked_at end,
    calendar_delete_blocked_at=case when p_effect.action='delete' then greatest(c.calendar_delete_blocked_at,coalesce(p_effect.completed_at,pg_catalog.clock_timestamp())) else c.calendar_delete_blocked_at end,
    verification_reason='calendar_write_blocked',health_state='degraded',last_synchronized_at=null,updated_at=pg_catalog.clock_timestamp()
    from public.calendar_destination_epochs e,public.appointments a
    where e.id=p_effect.destination_epoch_id and e.profile_id=p_effect.profile_id and e.environment=p_effect.environment
      and c.id=e.connection_id and c.profile_id=e.profile_id and c.environment=e.environment
      and c.pipedream_account_id=e.pipedream_account_id and c.connection_revision=p_effect.connection_revision
      and c.reconnect_reason is null and c.health_state<>'disconnected'
      and a.id=p_effect.appointment_id and a.profile_id=p_effect.profile_id and a.environment=p_effect.environment
      and p_effect.intended_content_sha256=public.booking_calendar_content_sha256(a)
      and (case when p_effect.action='create' then c.calendar_create_verified_at else c.calendar_delete_verified_at end is null
        or coalesce(p_effect.completed_at,pg_catalog.clock_timestamp())>=case when p_effect.action='create' then c.calendar_create_verified_at else c.calendar_delete_verified_at end)
      and exists(select 1 from public.calendar_selections s where s.id=e.calendar_selection_id and s.connection_id=c.id
        and s.profile_id=c.profile_id and s.environment=c.environment and s.active and s.receives_bookings and s.google_calendar_id=e.google_calendar_id)
      and not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=e.profile_id
        and d.environment=e.environment and d.provider='pipedream' and d.provider_account_id=e.pipedream_account_id and d.state in ('pending','completed'))
$function$;
revoke all on function public.record_booking_calendar_write_denial(public.booking_calendar_effect_attempts) from public,anon,authenticated,service_role,booking_worker;

drop function public.fail_booking_calendar_convergence(uuid,uuid,bigint,bigint,bigint,boolean,text);
create function public.fail_booking_calendar_convergence(
  p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,
  p_retryable boolean,p_safe_error text,p_failure_kind text default null,p_failure_code text default null
) returns boolean language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;
  kind text:=coalesce(p_failure_kind,case when p_retryable then 'temporary' else 'configuration' end);
  code text:=coalesce(p_failure_code,case when p_retryable then 'provider_temporary' else 'provider_configuration_error' end);
  cap integer;delay_seconds integer;now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if kind not in ('temporary','platform','reauthorization','permissions','configuration') or code not in (
    'provider_temporary','provider_platform','provider_reauthorization_required','calendar_permissions_changed','calendar_write_blocked',
    'provider_configuration_error','calendar_event_invalid','calendar_identity_conflict','calendar_effect_not_yet_visible','appointment_elapsed','contractor_disconnected') then
    raise exception 'invalid calendar failure classification' using errcode='22023';
  end if;
  if kind is distinct from (case
    when code in ('provider_temporary','calendar_effect_not_yet_visible') then 'temporary'
    when code='provider_platform' then 'platform'
    when code in ('provider_reauthorization_required','contractor_disconnected') then 'reauthorization'
    when code in ('calendar_permissions_changed','calendar_write_blocked') then 'permissions'
    else 'configuration' end) then
    raise exception 'calendar failure code/category mismatch' using errcode='22023';
  end if;
  l:=public.lock_booking_calendar_claim(p_link_id,p_lease_token,p_fencing_token,p_expected_generation,p_expected_appointment_version);
  if l.id is null then return false;end if;
  if kind='permissions' and code='calendar_write_blocked' then
    perform public.record_booking_calendar_write_denial(effect) from public.booking_calendar_effect_attempts effect
      where effect.link_id=l.id and effect.lease_token=p_lease_token and effect.fencing_token=p_fencing_token
        and effect.desired_generation=p_expected_generation and effect.appointment_version=p_expected_appointment_version;
  end if;
  cap:=least(1800,30*pg_catalog.power(2,least(greatest(l.reconcile_attempts-1,0),6))::integer);
  delay_seconds:=case when l.reconcile_attempts>=8 or kind in ('platform','permissions','reauthorization') then 1800 else 1 end
    +mod(abs(pg_catalog.hashtextextended(l.id::text||':'||l.reconcile_fencing_token,0)::numeric),cap::numeric)::integer;
  update public.calendar_event_links set failure_kind=kind,failure_code=code,failure_observed_at=now_at,safe_error=code,
    reconcile_status=case when kind='configuration' then 'manual_repair' else 'retry_wait' end,
    reconcile_next_attempt_at=now_at+pg_catalog.make_interval(secs=>delay_seconds),
    manual_repair_at=case when kind='configuration' then now_at else null end,
    manual_repair_reason=case when kind='configuration' then code else null end,
    sync_state=case when kind='configuration' then 'failed' else sync_state end,
    ambiguity_started_at=coalesce(ambiguity_started_at,now_at),reconcile_lease_token=null,reconcile_lease_expires_at=null,updated_at=now_at
    where id=l.id;
  update public.appointments set calendar_state=case when l.desired_state='present' then 'create_failed' else 'cancel_failed' end,
    review_state=case when review_state in ('none','calendar_reconciliation') then 'calendar_reconciliation' else review_state end,
    updated_at=now_at where id=l.appointment_id;
  perform public.enqueue_booking_notification(l.appointment_id,'calendar_failed');
  return true;
end $function$;

create or replace function public.renew_booking_calendar_reconciliation_v3(
  p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,p_lease_seconds integer default 120
) returns boolean language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;
begin
  if p_lease_token is null or p_lease_seconds is null or p_lease_seconds not between 30 and 240 then
    raise exception 'invalid calendar lease renewal' using errcode='22023';
  end if;
  l:=public.lock_booking_calendar_claim(p_link_id,p_lease_token,p_fencing_token,p_expected_generation,p_expected_appointment_version);
  if l.id is null or exists(select 1 from public.calendar_destination_epochs e join public.booking_provider_account_disconnects_v3 d
    on d.profile_id=e.profile_id and d.environment=e.environment and d.provider='pipedream' and d.provider_account_id=e.pipedream_account_id
    where e.id=l.destination_epoch_id and d.state in ('pending','completed'))
    or exists(select 1 from public.calendar_destination_epochs e join public.calendar_connections c
      on c.id=e.connection_id and c.pipedream_account_id=e.pipedream_account_id where e.id=l.destination_epoch_id
      and (c.health_state='disconnected' or c.reconnect_reason is not null)) then return false;end if;
  update public.calendar_event_links set reconcile_lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
    updated_at=pg_catalog.clock_timestamp() where id=l.id;
  return true;
end $function$;

create or replace function public.begin_booking_calendar_effect(
  p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,p_action text
) returns uuid language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;a public.appointments%rowtype;result uuid;
begin
  if p_action is null or p_action not in ('create','delete') then raise exception 'invalid calendar effect action' using errcode='22023';end if;
  l:=public.lock_booking_calendar_claim(p_link_id,p_lease_token,p_fencing_token,p_expected_generation,p_expected_appointment_version);
  if l.id is null then raise exception 'stale calendar effect claim' using errcode='40001';end if;
  select * into strict a from public.appointments where id=l.appointment_id;
  if (p_action='create' and (l.desired_state<>'present' or a.appointment_state<>'confirmed' or a.start_at<=pg_catalog.clock_timestamp()
      or a.cancellation_requested_at is not null or a.payment_state not in ('paid','disputed') or a.refund_state<>'not_requested'))
    or (p_action='delete' and (l.desired_state<>'absent' or a.appointment_state<>'cancelled')) then
    raise exception 'stale calendar effect desire' using errcode='40001';
  end if;
  if exists(select 1 from public.calendar_destination_epochs e join public.booking_provider_account_disconnects_v3 d
    on d.profile_id=e.profile_id and d.environment=e.environment and d.provider='pipedream' and d.provider_account_id=e.pipedream_account_id
    where e.id=l.destination_epoch_id and d.state in ('pending','completed')) then
    raise exception 'calendar account disconnect requested' using errcode='42501';
  end if;
  if exists(select 1 from public.calendar_destination_epochs e join public.calendar_connections c
    on c.id=e.connection_id and c.pipedream_account_id=e.pipedream_account_id where e.id=l.destination_epoch_id
    and (c.health_state='disconnected' or c.reconnect_reason is not null)) then
    raise exception 'calendar account authorization required' using errcode='42501';
  end if;
  if not exists(select 1 from public.booking_calendar_observations o where o.link_id=l.id and o.fencing_token=p_fencing_token
    and o.lease_token=p_lease_token and o.desired_generation=p_expected_generation and o.appointment_version=p_expected_appointment_version
    and o.phase='probe' and o.observed_state=case when p_action='create' then 'absent' else 'present' end) then
    raise exception 'calendar effect requires current exact readback' using errcode='40001';
  end if;
  insert into public.booking_calendar_effect_attempts(link_id,appointment_id,profile_id,environment,destination_epoch_id,google_event_id,
    action,desired_generation,appointment_version,lease_token,fencing_token,started_at,connection_revision,intended_content_sha256)
  values(l.id,l.appointment_id,l.profile_id,l.environment,l.destination_epoch_id,l.google_event_id,p_action,l.desired_generation,a.version,p_lease_token,p_fencing_token,pg_catalog.clock_timestamp(),
    l.snapshot_connection_revision,public.booking_calendar_content_sha256(a))
    returning id into result;
  update public.calendar_event_links set ambiguity_started_at=coalesce(ambiguity_started_at,pg_catalog.clock_timestamp()) where id=l.id;
  return result;
end $function$;

create or replace function public.record_booking_calendar_effect_result(
  p_effect_id uuid,p_lease_token uuid,p_fencing_token bigint,p_outcome text,p_provider_status integer,p_evidence jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path='' as $function$
declare effect public.booking_calendar_effect_attempts%rowtype;l public.calendar_event_links%rowtype;a public.appointments%rowtype;
  v_hash text;observed_at timestamptz;
begin
  if p_outcome is null or p_outcome not in('accepted','ambiguous','failed') or p_lease_token is null or p_fencing_token is null
    or pg_catalog.jsonb_typeof(coalesce(p_evidence,'{}'::jsonb))<>'object' then raise exception 'invalid calendar effect outcome' using errcode='22023';end if;
  select * into strict effect from public.booking_calendar_effect_attempts where id=p_effect_id
    and lease_token=p_lease_token and fencing_token=p_fencing_token;
  perform 1 from public.calendar_connections c join public.calendar_destination_epochs ep on ep.connection_id=c.id
    where ep.id=effect.destination_epoch_id and c.profile_id=effect.profile_id and c.environment=effect.environment for no key update of c;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(effect.appointment_id::text||':booking-appointment',0));
  select * into strict a from public.appointments where id=effect.appointment_id and profile_id=effect.profile_id and environment=effect.environment for update;
  select * into strict l from public.calendar_event_links where id=effect.link_id and appointment_id=effect.appointment_id
    and profile_id=effect.profile_id and environment=effect.environment and destination_epoch_id=effect.destination_epoch_id
    and google_event_id=effect.google_event_id for update;
  select * into strict effect from public.booking_calendar_effect_attempts where id=p_effect_id and lease_token=p_lease_token
    and fencing_token=p_fencing_token for update;
  v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('action',effect.action,'eventId',effect.google_event_id,
    'destinationEpochId',effect.destination_epoch_id,'outcome',p_outcome,'providerStatus',p_provider_status,'evidence',coalesce(p_evidence,'{}'::jsonb))::text,'UTF8'),'sha256'),'hex');
  if effect.completed_at is not null then
    if effect.outcome_sha256 is distinct from v_hash then raise exception 'calendar effect result conflict' using errcode='23505';end if;
    return true;
  end if;
  observed_at:=coalesce((p_evidence->>'observedAt')::timestamptz,pg_catalog.clock_timestamp());
  if not pg_catalog.isfinite(observed_at) or observed_at<effect.started_at-interval '1 second'
    or observed_at>pg_catalog.clock_timestamp()+interval '1 minute' then
    raise exception 'invalid calendar effect observation time' using errcode='22023';end if;
  perform pg_catalog.set_config('obra.booking_calendar_effect_settle','allowed',true);
  update public.booking_calendar_effect_attempts set outcome=p_outcome,provider_status=p_provider_status,outcome_sha256=v_hash,
    completed_at=greatest(effect.started_at,observed_at)where id=effect.id returning * into effect;
  perform pg_catalog.set_config('obra.booking_calendar_effect_settle','',true);
  -- Retaining a dispatched result does not require active cutover or a renewable
  -- lease. Only its scoped negative capability may affect the current connection.
  if p_outcome='failed' and p_evidence->>'failureCode'='calendar_write_blocked' then
    perform public.record_booking_calendar_write_denial(effect);
  end if;
  if p_outcome='failed' and p_evidence->>'failureCode'='calendar_identity_conflict'
    and public.booking_cutover_enabled(effect.profile_id,effect.environment)
    and l.desired_state=(case when a.appointment_state='confirmed' then 'present' else 'absent' end)
    and effect.intended_content_sha256=public.booking_calendar_content_sha256(a)
    and not exists(select 1 from public.booking_calendar_effect_attempts newer where newer.link_id=l.id
      and newer.started_at>effect.started_at)
    and not exists(select 1 from public.booking_calendar_observations newer where newer.link_id=l.id
      and newer.observed_at>effect.completed_at and newer.observed_state=l.desired_state)
    and not exists(select 1 from public.booking_calendar_repair_audit repair where repair.link_id=l.id
      and repair.created_at>effect.started_at) then
    -- Persist the conditional-delete conflict with the result itself. A lost
    -- response must not let takeover forget the 412 and dispatch another DELETE.
    -- The conflict concerns this immutable event even after cancellation. It may
    -- block current effects, but never overwrites newer convergence or audited repair.
    update public.calendar_event_links set reconcile_status='manual_repair',sync_state='failed',failure_kind='configuration',
      failure_code='calendar_identity_conflict',failure_observed_at=pg_catalog.clock_timestamp(),safe_error='calendar_identity_conflict',
      manual_repair_reason='calendar_identity_conflict',manual_repair_at=pg_catalog.clock_timestamp(),
      reconcile_lease_token=null,reconcile_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where id=l.id;
    update public.appointments set calendar_state=case when l.desired_state='present' then 'create_failed' else 'cancel_failed' end,
      review_state=case when review_state in('none','calendar_reconciliation') then 'calendar_reconciliation' else review_state end,
      updated_at=pg_catalog.clock_timestamp()where id=a.id;
  end if;
  return true;
end $function$;
revoke all on function public.record_booking_calendar_effect_result(uuid,uuid,bigint,text,integer,jsonb) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.record_booking_calendar_effect_result(uuid,uuid,bigint,text,integer,jsonb) to booking_worker;

create or replace function public.record_booking_calendar_observation(
  p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_generation bigint,p_expected_appointment_version bigint,
  p_phase text,p_observed_state text,p_observed_at timestamptz,p_evidence jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare l public.calendar_event_links%rowtype;a public.appointments%rowtype;v_hash text;v_next timestamptz;v_scan integer;
begin
  if p_lease_token is null or p_phase is null or p_phase not in ('probe','post_effect') or p_observed_state is null
    or p_observed_state not in ('present','absent','conflict') or p_observed_at is null
    or p_observed_at not between pg_catalog.clock_timestamp()-interval '2 minutes' and pg_catalog.clock_timestamp()+interval '1 minute' then
    raise exception 'invalid calendar observation' using errcode='22023';
  end if;
  l:=public.lock_booking_calendar_claim(p_link_id,p_lease_token,p_fencing_token,p_expected_generation,p_expected_appointment_version);
  if l.id is null then raise exception 'stale calendar observation claim' using errcode='40001';end if;
  select * into strict a from public.appointments where id=l.appointment_id;
  if p_observed_at<l.last_attempt_at-interval '1 second' then raise exception 'calendar observation predates claim' using errcode='40001';end if;
  if p_evidence->>'destinationEpochId' is distinct from l.destination_epoch_id::text
    or p_evidence->>'googleEventId' is distinct from l.google_event_id
    or p_evidence->>'appointmentId' is distinct from l.appointment_id::text then
    raise exception 'calendar observation identity mismatch' using errcode='22023';
  end if;
  if p_phase='post_effect' and not exists(select 1 from public.booking_calendar_effect_attempts e where e.id::text=p_evidence->>'effectId'
    and e.link_id=l.id and e.lease_token=p_lease_token and e.fencing_token=p_fencing_token
    and e.desired_generation=p_expected_generation and e.appointment_version=p_expected_appointment_version) then
    raise exception 'calendar observation effect mismatch' using errcode='40001';
  end if;
  v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('eventId',l.google_event_id,
    'appointmentId',l.appointment_id,'state',p_observed_state,'observedAt',p_observed_at,'evidence',p_evidence)::text,'UTF8'),'sha256'),'hex');
  insert into public.booking_calendar_observations(link_id,appointment_id,profile_id,environment,destination_epoch_id,google_event_id,
    desired_state,desired_generation,appointment_version,phase,observed_state,observed_at,observation_sha256,lease_token,fencing_token)
  values(l.id,l.appointment_id,l.profile_id,l.environment,l.destination_epoch_id,l.google_event_id,l.desired_state,l.desired_generation,
    a.version,p_phase,p_observed_state,p_observed_at,v_hash,p_lease_token,p_fencing_token);
  update public.calendar_event_links set observed_state=p_observed_state,last_observed_at=p_observed_at,last_observation_sha256=v_hash where id=l.id;
  if p_phase='post_effect' and p_evidence->>'failureKind'='permissions' and p_evidence->>'failureCode'='calendar_write_blocked' then
    -- Correct existing event contents settle that obligation, not a denied write
    -- capability. Keep the account blocked even when this readback converges.
    perform public.record_booking_calendar_write_denial(effect) from public.booking_calendar_effect_attempts effect
      where effect.id::text=p_evidence->>'effectId' and effect.link_id=l.id
        and effect.lease_token=p_lease_token and effect.fencing_token=p_fencing_token;
  end if;
  if p_observed_state='conflict' then
    perform public.fail_booking_calendar_convergence(l.id,p_lease_token,p_fencing_token,p_expected_generation,p_expected_appointment_version,
      false,null,'configuration','calendar_identity_conflict');
    return pg_catalog.jsonb_build_object('action','manual_repair');
  end if;
  if l.desired_state<>p_observed_state then
    if p_phase='probe' then
      if l.desired_state='present' and a.start_at<=pg_catalog.clock_timestamp() then
        perform public.fail_booking_calendar_convergence(l.id,p_lease_token,p_fencing_token,p_expected_generation,p_expected_appointment_version,
          false,null,'configuration','appointment_elapsed');
        return pg_catalog.jsonb_build_object('action','manual_repair');
      end if;
      return pg_catalog.jsonb_build_object('action',case when l.desired_state='present' then 'create' else 'delete' end);
    end if;
    perform public.fail_booking_calendar_convergence(l.id,p_lease_token,p_fencing_token,p_expected_generation,p_expected_appointment_version,
      true,null,coalesce(p_evidence->>'failureKind','temporary'),coalesce(p_evidence->>'failureCode','calendar_effect_not_yet_visible'));
    return pg_catalog.jsonb_build_object('action',case when p_evidence->>'failureKind'='configuration' then 'manual_repair' else 'retry' end);
  end if;
  -- Success is ordered by effect start, denial by completion/observation. Thus
  -- an overlapping write or a late readback never supersedes a newer denial.
  -- CREATE proves attendee creation only; DELETE proves deletion only.
  update public.calendar_connections c set
      calendar_create_verified_at=case when effect.action='create' then greatest(c.calendar_create_verified_at,effect.started_at) else c.calendar_create_verified_at end,
      calendar_delete_verified_at=case when effect.action='delete' then greatest(c.calendar_delete_verified_at,effect.started_at) else c.calendar_delete_verified_at end,
      calendar_create_blocked_at=case when effect.action='create' and effect.started_at>=c.calendar_create_blocked_at then null else c.calendar_create_blocked_at end,
      calendar_delete_blocked_at=case when effect.action='delete' and effect.started_at>=c.calendar_delete_blocked_at then null else c.calendar_delete_blocked_at end,
      updated_at=pg_catalog.clock_timestamp()
      from public.calendar_destination_epochs ep,public.booking_calendar_effect_attempts effect
      where ep.id=l.destination_epoch_id and c.id=ep.connection_id and c.profile_id=ep.profile_id and c.environment=ep.environment
        and c.pipedream_account_id=ep.pipedream_account_id and c.connection_revision=l.snapshot_connection_revision
        and c.connection_revision=effect.connection_revision
        and effect.link_id=l.id and effect.action=case when l.desired_state='present' then 'create' else 'delete' end
        and effect.desired_generation=l.desired_generation
        and effect.intended_content_sha256=public.booking_calendar_content_sha256(a) and effect.started_at<=p_observed_at+interval '1 second'
        and (effect.outcome is null or effect.outcome in ('accepted','ambiguous'))
        and (p_phase='probe' or effect.id::text=p_evidence->>'effectId')
        and not exists(select 1 from public.booking_calendar_effect_attempts newer where newer.link_id=l.id and newer.action=effect.action
          and newer.desired_generation=l.desired_generation and newer.started_at>effect.started_at)
        and exists(select 1 from public.calendar_selections s where s.id=ep.calendar_selection_id and s.connection_id=c.id
          and s.profile_id=c.profile_id and s.environment=c.environment and s.active and s.receives_bookings and s.google_calendar_id=ep.google_calendar_id)
        and not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=ep.profile_id
          and d.environment=ep.environment and d.provider='pipedream' and d.provider_account_id=ep.pipedream_account_id and d.state in ('pending','completed'));
  v_scan:=l.drift_scan_count+1;
  update public.appointments set calendar_state=case when l.desired_state='present' then 'created' else 'cancelled' end,
    review_state=case when review_state='calendar_reconciliation' then 'none' else review_state end,updated_at=pg_catalog.clock_timestamp() where id=a.id;
  if l.desired_state='present' then
    v_next:=case when a.start_at>pg_catalog.clock_timestamp()+interval '6 hours' then pg_catalog.clock_timestamp()+interval '6 hours'
      when a.start_at>pg_catalog.clock_timestamp() then a.start_at else null end;
  else
    v_next:=case v_scan when 1 then pg_catalog.clock_timestamp()+interval '15 seconds' when 2 then pg_catalog.clock_timestamp()+interval '60 seconds'
      when 3 then pg_catalog.clock_timestamp()+interval '5 minutes' when 4 then pg_catalog.clock_timestamp()+interval '30 minutes'
      when 5 then pg_catalog.clock_timestamp()+interval '6 hours' else l.stability_scan_until end;
    if v_next>l.stability_scan_until then v_next:=l.stability_scan_until;end if;
    if l.stability_scan_until<=pg_catalog.clock_timestamp() then v_next:=null;end if;
  end if;
  update public.calendar_event_links set sync_state=case when l.desired_state='present' then 'created' else 'cancelled' end,
    reconcile_status=case when v_next is null then 'converged' else 'retry_wait' end,reconcile_next_attempt_at=coalesce(v_next,reconcile_next_attempt_at),
    reconcile_attempts=0,drift_scan_count=v_scan,reconcile_lease_token=null,reconcile_lease_expires_at=null,
    safe_error=null,failure_kind=null,failure_code=null,failure_observed_at=null,ambiguity_started_at=null,
    manual_repair_at=null,manual_repair_reason=null,updated_at=pg_catalog.clock_timestamp() where id=l.id;
  return pg_catalog.jsonb_build_object('action','converged','nextProbeAt',v_next);
end $function$;

revoke all on function public.claim_booking_calendar_reconciliation(text,uuid,integer),
  public.renew_booking_calendar_reconciliation_v3(uuid,uuid,bigint,bigint,bigint,integer),
  public.fail_booking_calendar_convergence(uuid,uuid,bigint,bigint,bigint,boolean,text,text,text),
  public.record_booking_calendar_observation(uuid,uuid,bigint,bigint,bigint,text,text,timestamptz,jsonb),
  public.begin_booking_calendar_effect(uuid,uuid,bigint,bigint,bigint,text)
  from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.claim_booking_calendar_reconciliation(text,uuid,integer),
  public.renew_booking_calendar_reconciliation_v3(uuid,uuid,bigint,bigint,bigint,integer),
  public.fail_booking_calendar_convergence(uuid,uuid,bigint,bigint,bigint,boolean,text,text,text),
  public.record_booking_calendar_observation(uuid,uuid,bigint,bigint,bigint,text,text,timestamptz,jsonb),
  public.begin_booking_calendar_effect(uuid,uuid,bigint,bigint,bigint,text) to booking_worker;

-- Setup denials use the same current destination/capability precedence as paid
-- effects, without inventing a calendar-event link or exposing another worker API.
create function public.record_booking_calendar_setup_denial(
  p_profile_id uuid,p_environment text,p_operation_id uuid,p_lease_token uuid,p_fencing_token bigint,
  p_action text,p_observed_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $function$
declare c public.calendar_connections%rowtype;observed_at timestamptz;
begin
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for no key update;
  if c.id is null or p_operation_id is null or c.setup_operation_id is distinct from p_operation_id
    or p_lease_token is null or c.setup_lease_token is distinct from p_lease_token or c.setup_fencing_token is distinct from p_fencing_token
    or c.setup_lease_expires_at is null or c.setup_lease_expires_at<=pg_catalog.clock_timestamp() or c.setup_completed_at is not null
    or p_action is null or p_action not in ('insert','delete') or p_observed_at is null
    or p_observed_at not between pg_catalog.clock_timestamp()-interval '1 minute' and pg_catalog.clock_timestamp()+interval '1 minute'
    or c.setup_probe_started_at is null or p_observed_at<c.setup_probe_started_at-interval '1 second'
    or (p_action='delete' and (c.setup_probe_delete_started_at is null or p_observed_at<c.setup_probe_delete_started_at-interval '1 second'))
    or c.setup_probe_state is distinct from (case when p_action='insert' then 'insert_dispatched' else 'delete_dispatched' end)
  then raise exception 'current setup dispatch fence required' using errcode='40001';end if;
  if c.setup_expected_revision is distinct from c.connection_revision
    or c.setup_probe_account_id is distinct from c.pipedream_account_id or c.setup_account_id is distinct from c.pipedream_account_id
    or c.setup_probe_calendar_id is distinct from c.setup_calendar_id
    or 'contractor_disconnected' in (c.verification_reason,c.reconnect_reason)
    or not exists(select 1 from public.calendar_selections s where s.connection_id=c.id and s.profile_id=c.profile_id and s.environment=c.environment
      and s.active and s.receives_bookings and s.google_calendar_id=c.setup_probe_calendar_id)
    or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=c.profile_id and d.environment=c.environment
      and d.provider='pipedream' and d.provider_account_id=c.pipedream_account_id and d.state in ('pending','completed'))
  then return false;end if;
  -- JavaScript evidence has millisecond precision; never order it before the
  -- database's microsecond-precision dispatch in that same millisecond.
  observed_at:=greatest(p_observed_at,c.setup_probe_started_at,
    case when p_action='delete' then c.setup_probe_delete_started_at end);
  if observed_at<(case when p_action='insert' then c.calendar_probe_insert_verified_at else c.calendar_delete_verified_at end)
  then return false;end if;
  update public.calendar_connections set
    calendar_probe_insert_blocked_at=case when p_action='insert' then greatest(calendar_probe_insert_blocked_at,observed_at) else calendar_probe_insert_blocked_at end,
    calendar_delete_blocked_at=case when p_action='delete' then greatest(calendar_delete_blocked_at,observed_at) else calendar_delete_blocked_at end,
    verification_reason=case when c.verification_reason='provider_reauthorization_required' then c.verification_reason else 'calendar_write_blocked' end,
    health_state=case when c.health_state='disconnected' then c.health_state else 'degraded' end,
    last_synchronized_at=null,updated_at=pg_catalog.clock_timestamp()
    where id=c.id;
  return true;
end $function$;
revoke all on function public.record_booking_calendar_setup_denial(uuid,text,uuid,uuid,bigint,text,timestamptz)
  from public,anon,authenticated,service_role,booking_worker;

-- Called inside setup before its lease is released. Private INSERT success may
-- clear only private INSERT denial; it never proves attendee-bearing CREATE.
-- DELETE retains its own evidence. Ordinary reads cannot call this helper.
create function public.settle_booking_calendar_setup_capability(
  p_profile_id uuid,p_environment text,p_operation_id uuid,p_lease_token uuid,p_fencing_token bigint
) returns boolean language plpgsql security definer set search_path='' as $function$
declare c public.calendar_connections%rowtype;
begin
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for no key update;
  if c.id is null or p_operation_id is null or c.setup_operation_id is distinct from p_operation_id
    or p_lease_token is null or c.setup_lease_token is distinct from p_lease_token
    or c.setup_fencing_token is distinct from p_fencing_token or c.setup_lease_expires_at<=pg_catalog.clock_timestamp()
    or c.setup_lease_expires_at is null or c.setup_expected_revision is distinct from c.connection_revision
    or c.setup_probe_account_id is distinct from c.pipedream_account_id or c.setup_account_id is distinct from c.pipedream_account_id
    or c.setup_probe_calendar_id is distinct from c.setup_calendar_id
    or c.setup_probe_state<>'absent' or c.setup_probe_started_at is null or c.setup_probe_write_verified_at is null
    or c.setup_probe_delete_started_at is null or c.setup_probe_write_verified_at<c.setup_probe_delete_started_at
    or c.reconnect_reason is not null or c.health_state='disconnected'
    or not exists(select 1 from public.calendar_selections s where s.connection_id=c.id and s.profile_id=c.profile_id and s.environment=c.environment
      and s.active and s.receives_bookings and s.google_calendar_id=c.setup_probe_calendar_id)
    or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=c.profile_id and d.environment=c.environment
      and d.provider='pipedream' and d.provider_account_id=c.pipedream_account_id and d.state in('pending','completed'))
  then raise exception 'current scoped setup capability proof required' using errcode='40001';end if;
  update public.calendar_connections set
    calendar_probe_insert_verified_at=case when c.setup_write_verified_at>=c.setup_probe_started_at
      then greatest(calendar_probe_insert_verified_at,c.setup_probe_started_at) else calendar_probe_insert_verified_at end,
    calendar_probe_insert_blocked_at=case when c.setup_write_verified_at>=c.setup_probe_started_at
      and c.setup_probe_started_at>=calendar_probe_insert_blocked_at then null else calendar_probe_insert_blocked_at end,
    calendar_delete_verified_at=greatest(calendar_delete_verified_at,c.setup_probe_delete_started_at),
    calendar_delete_blocked_at=case when c.setup_probe_delete_started_at>=calendar_delete_blocked_at then null else calendar_delete_blocked_at end,
    updated_at=pg_catalog.clock_timestamp() where id=c.id;
  return true;
end $function$;
revoke all on function public.settle_booking_calendar_setup_capability(uuid,text,uuid,uuid,bigint) from public,anon,authenticated,service_role,booking_worker;

create or replace function public.reject_booking_convergence_evidence_mutation() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  if tg_table_name='booking_calendar_effect_attempts' and tg_op='UPDATE' then
    if pg_catalog.current_setting('obra.booking_calendar_effect_settle',true)='allowed'
      and old.completed_at is null and new.completed_at is not null
      and (pg_catalog.to_jsonb(old)-array['outcome','provider_status','outcome_sha256','completed_at'])
        is not distinct from (pg_catalog.to_jsonb(new)-array['outcome','provider_status','outcome_sha256','completed_at']) then return new;end if;
  end if;
  raise exception 'booking convergence evidence is immutable' using errcode='P0001';
end $function$;
revoke all on function public.reject_booking_convergence_evidence_mutation() from public,anon,authenticated,service_role,booking_worker;

-- Arbitration retains its existing financial policy; a disconnected identity
-- cannot authorize even a fresh availability call while that decision is pending.
create or replace function public.renew_booking_late_payment_arbitration_v3(
  p_arbitration_id uuid,p_lease_token uuid,p_fencing_token bigint,p_snapshot_generation bigint,p_lease_seconds integer default 90
) returns boolean language plpgsql security definer set search_path='' as $function$
declare arb public.booking_late_payment_arbitrations%rowtype;c public.calendar_connections%rowtype;
begin
  if p_lease_token is null or p_lease_seconds is null or p_lease_seconds not between 30 and 180 then
    raise exception 'invalid late-payment lease renewal' using errcode='22023';
  end if;
  select * into arb from public.booking_late_payment_arbitrations where id=p_arbitration_id;
  if arb.id is null then return false;end if;
  select * into c from public.calendar_connections where id=arb.snapshot_connection_id and profile_id=arb.profile_id
    and environment=arb.environment for no key update;
  if c.id is null or c.pipedream_account_id is distinct from arb.snapshot_pipedream_account_id
    or c.pipedream_account_id is null or c.health_state='disconnected' or c.reconnect_reason is not null
    or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=arb.profile_id
      and d.environment=arb.environment and d.provider='pipedream' and d.provider_account_id=arb.snapshot_pipedream_account_id
      and d.state in ('pending','completed')) then return false;end if;
  update public.booking_late_payment_arbitrations set lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
    updated_at=pg_catalog.clock_timestamp() where id=p_arbitration_id and status='processing' and lease_token=p_lease_token
      and fencing_token=p_fencing_token and snapshot_generation=p_snapshot_generation and lease_expires_at>pg_catalog.clock_timestamp();
  return found;
end $function$;
revoke all on function public.renew_booking_late_payment_arbitration_v3(uuid,uuid,bigint,bigint,integer)
  from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.renew_booking_late_payment_arbitration_v3(uuid,uuid,bigint,bigint,integer) to booking_worker;

-- Extend the existing audited repair authority, retaining its shipped four-
-- argument call. The additive evidence binds an unresolved appointment, not an
-- alternate calendar for an already-owned event.
alter table public.booking_calendar_repair_audit
  add column appointment_id uuid references public.appointments(id) on delete restrict,
  add column request_id uuid,
  add column evidence jsonb,
  add constraint booking_calendar_repair_evidence_check check (evidence is null or
    (pg_catalog.jsonb_typeof(evidence)='object' and pg_catalog.pg_column_size(evidence)<=8192));
create unique index booking_calendar_repair_request_identity
  on public.booking_calendar_repair_audit(profile_id,environment,request_id) where request_id is not null;

drop function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text);
create function public.requeue_booking_calendar_manual_repair(
  p_link_id uuid,p_expected_generation bigint,p_actor_token_hash text,p_reason text,p_resolution jsonb default null
) returns boolean language plpgsql security definer set search_path='' as $repair$
<<calendar_repair>>
declare l public.calendar_event_links%rowtype;a public.appointments%rowtype;e public.calendar_destination_epochs%rowtype;
  p public.booking_payments%rowtype;prior public.booking_calendar_repair_audit%rowtype;actor_user_id uuid;
  request_id uuid;appointment_id uuid;source_id uuid;expected_version bigint;event_id text;before_state jsonb;original_at timestamptz;reconstruct_epoch boolean:=false;
begin
  if coalesce(p_actor_token_hash,'')!~'^[a-f0-9]{64}$' or char_length(pg_catalog.btrim(coalesce(p_reason,'')))not between 3 and 500
    or p_expected_generation is null or p_expected_generation<0 then raise exception 'repair actor session and reason required' using errcode='22023';end if;
  select v.user_id into actor_user_id from public.validate_admin_session_v4(p_actor_token_hash,false)v where v.role='admin';
  if actor_user_id is null then raise exception 'admin actor session required' using errcode='42501';end if;
  if p_resolution is null then
    select * into strict l from public.calendar_event_links where id=p_link_id;
    perform 1 from public.calendar_connections c join public.calendar_destination_epochs ep on ep.connection_id=c.id
      where ep.id=l.destination_epoch_id and c.profile_id=l.profile_id and c.environment=l.environment for no key update of c;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(l.appointment_id::text||':booking-appointment',0));
    select * into strict a from public.appointments where id=l.appointment_id for update;
    if not public.booking_cutover_enabled(a.profile_id,a.environment)then raise exception 'booking cutover is not enabled' using errcode='42501';end if;
    select * into strict l from public.calendar_event_links where id=p_link_id and desired_generation=p_expected_generation and reconcile_status='manual_repair' for update;
    insert into public.booking_calendar_repair_audit(link_id,appointment_id,profile_id,environment,expected_generation,actor_user_id,reason,prior_state)
      values(l.id,a.id,l.profile_id,l.environment,l.desired_generation,actor_user_id,pg_catalog.btrim(p_reason),pg_catalog.to_jsonb(l));
    update public.calendar_event_links set reconcile_status='due',reconcile_next_attempt_at=pg_catalog.clock_timestamp(),reconcile_attempts=0,
      reconcile_lease_token=null,reconcile_lease_expires_at=null,manual_repair_at=null,manual_repair_reason=null,updated_at=pg_catalog.clock_timestamp()where id=l.id;
    return true;
  end if;
  if p_link_id is not null or pg_catalog.jsonb_typeof(p_resolution)is distinct from 'object' or pg_catalog.pg_column_size(p_resolution)>8192
    or not(p_resolution ?& array['requestId','appointmentId','profileId','environment','expectedVersion','destinationEpochId','googleEventId','source'])
    or p_resolution-array['requestId','appointmentId','profileId','environment','expectedVersion','destinationEpochId','destinationEpoch','googleEventId','source']<>'{}'::jsonb
    or coalesce(p_resolution->>'environment','')not in('test','live')
    or coalesce(p_resolution->>'googleEventId','')!~'^[0-9a-v]+$'
    or length(p_resolution->>'googleEventId')not between 5 and 1024
    or pg_catalog.jsonb_typeof(p_resolution->'source')is distinct from 'object' then
    raise exception 'exact original destination resolution required' using errcode='22023';end if;
  begin
    request_id:=(p_resolution->>'requestId')::uuid;appointment_id:=(p_resolution->>'appointmentId')::uuid;
    expected_version:=(p_resolution->>'expectedVersion')::bigint;
    select * into strict a from public.appointments where id=appointment_id
      and profile_id=(p_resolution->>'profileId')::uuid and environment=p_resolution->>'environment';
    select * into e from public.calendar_destination_epochs where id=(p_resolution->>'destinationEpochId')::uuid
      and profile_id=a.profile_id and environment=a.environment;
    if e.id is null then
      if exists(select 1 from public.calendar_destination_epochs where id=(p_resolution->>'destinationEpochId')::uuid)
        or p_resolution->'source'->>'kind' is distinct from 'original_reservation_record'
        or pg_catalog.jsonb_typeof(p_resolution->'destinationEpoch')is distinct from 'object'
        or not(p_resolution->'destinationEpoch' ?& array['connectionId','selectionId','revision','accountId','calendarId'])
        or (p_resolution->'destinationEpoch')-array['connectionId','selectionId','revision','accountId','calendarId']<>'{}'::jsonb then
        raise exception 'missing epoch requires the exact original configuration record' using errcode='22023';end if;
      e.id:=(p_resolution->>'destinationEpochId')::uuid;e.profile_id:=a.profile_id;e.environment:=a.environment;
      e.connection_id:=(p_resolution->'destinationEpoch'->>'connectionId')::uuid;
      e.calendar_selection_id:=(p_resolution->'destinationEpoch'->>'selectionId')::uuid;
      e.connection_revision:=(p_resolution->'destinationEpoch'->>'revision')::bigint;
      e.pipedream_account_id:=p_resolution->'destinationEpoch'->>'accountId';e.google_calendar_id:=p_resolution->'destinationEpoch'->>'calendarId';
      e.created_at:=(p_resolution->'source'->>'recordedAt')::timestamptz;
      if e.id is null or e.connection_revision is null or e.connection_revision<0 or coalesce(e.pipedream_account_id,'')!~'^apn_[A-Za-z0-9_-]+$'
        or nullif(e.google_calendar_id,'')is null or not exists(select 1 from public.calendar_selections s where s.id=e.calendar_selection_id
          and s.connection_id=e.connection_id and s.profile_id=a.profile_id and s.environment=a.environment and s.google_calendar_id=e.google_calendar_id) then
        raise exception 'original epoch identity does not match retained tenant records' using errcode='22023';end if;
      reconstruct_epoch:=true;
    elsif p_resolution?'destinationEpoch' and p_resolution->'destinationEpoch' is distinct from pg_catalog.jsonb_build_object(
      'connectionId',e.connection_id,'selectionId',e.calendar_selection_id,'revision',e.connection_revision,
      'accountId',e.pipedream_account_id,'calendarId',e.google_calendar_id) then
      raise exception 'supplied epoch conflicts with immutable identity' using errcode='22023';
    end if;
  exception when invalid_text_representation or no_data_found then raise exception 'repair identity does not match appointment' using errcode='22023';end;
  if request_id is null or expected_version is null or expected_version<1 then raise exception 'repair snapshot required' using errcode='22023';end if;
  perform 1 from public.calendar_connections where id=e.connection_id and profile_id=e.profile_id and environment=e.environment for no key update;
  if not found then raise exception 'retained destination connection is missing' using errcode='22023';end if;
  if reconstruct_epoch and (not exists(select 1 from public.calendar_connections c where c.id=e.connection_id
      and c.connection_revision>=e.connection_revision and c.created_at<=e.created_at)
    or not exists(select 1 from public.calendar_selections s where s.id=e.calendar_selection_id and s.created_at<=e.created_at)) then
    raise exception 'original epoch record cannot reference a future configuration' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a.id::text||':booking-appointment',0));
  select * into strict a from public.appointments where id=a.id for update;
  if not public.booking_cutover_enabled(a.profile_id,a.environment)then raise exception 'booking cutover is not enabled' using errcode='42501';end if;
  select * into prior from public.booking_calendar_repair_audit r where r.profile_id=a.profile_id and r.environment=a.environment and r.request_id=calendar_repair.request_id;
  if prior.id is not null then
    if prior.appointment_id is distinct from a.id or prior.evidence is distinct from p_resolution or prior.reason is distinct from pg_catalog.btrim(p_reason)
      or prior.expected_generation is distinct from p_expected_generation then raise exception 'repair idempotency conflict' using errcode='23505';end if;
    return true;
  end if;
  select * into p from public.booking_payments bp where bp.appointment_id=a.id and bp.profile_id=a.profile_id and bp.environment=a.environment for share;
  if a.booking_contract_version is distinct from 2 or p.booking_contract_version is distinct from 2
    or a.version<>expected_version or a.calendar_generation<>p_expected_generation or a.calendar_destination_epoch_id is not null
    or not(a.review_state='unresolved_destination' or (a.appointment_state='cancelled' and a.calendar_state in('cancel_pending','cancel_failed')))
    or a.appointment_state not in('confirmed','cancelled')
    or a.payment_state not in('paid','disputed')
    or p.id is null or p.payment_state not in('paid','disputed') or p.amount_paid_minor<>p.expected_amount_minor
    or p.expected_amount_minor<>a.amount_minor or p.currency<>a.currency
    or (a.appointment_state='confirmed' and (a.cancellation_requested_at is not null or a.start_at<=pg_catalog.clock_timestamp()
      or a.refund_state<>'not_requested' or p.refund_state<>'not_requested' or p.refund_requested_at is not null or p.amount_refunded_minor<>0))
    or (a.appointment_state='cancelled' and a.appointment_reason='late_payment_arbitration' and a.cancellation_requested_at is null
      and a.refund_state='not_requested' and p.refund_state='not_requested' and p.amount_refunded_minor=0)
    or exists(select 1 from public.calendar_event_links where calendar_event_links.appointment_id=a.id)
  then raise exception 'unresolved booking snapshot changed' using errcode='40001';end if;
  if exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=e.profile_id and d.environment=e.environment
    and d.provider='pipedream' and d.provider_account_id=e.pipedream_account_id and d.state in('pending','completed'))then
    raise exception 'original account is explicitly disconnected' using errcode='42501';end if;
  event_id:=p_resolution->>'googleEventId';
  if p_resolution->'source'->>'kind'='retained_outbox' then
    if (p_resolution->'source')-array['kind','id']<>'{}'::jsonb then raise exception 'invalid retained evidence' using errcode='22023';end if;
    source_id:=(p_resolution->'source'->>'id')::uuid;
    if not exists(select 1 from public.integration_outbox o where o.id=source_id and o.appointment_id=a.id and o.profile_id=a.profile_id and o.environment=a.environment
      and o.command_type='calendar_create' and o.destination_epoch_id=e.id and o.payload->>'googleEventId'=event_id
      and o.payload->>'connectionId'=e.connection_id::text and o.payload->>'selectionId'=e.calendar_selection_id::text
      and (not(o.payload?'appointmentId') or o.payload->>'appointmentId'=a.id::text))then raise exception 'retained evidence does not bind this destination' using errcode='22023';end if;
  elsif p_resolution->'source'->>'kind'='original_reservation_record' then
    -- Historical checkouts did not persist a destination. A current AAL2 admin
    -- can attest an exact retained reservation/provider record, never a current
    -- calendar choice. Keep its immutable digest/reference and causal timestamp.
    if not(p_resolution->'source' ?& array['kind','reference','sha256','recordedAt','appointmentId','accountId','calendarId'])
      or (p_resolution->'source')-array['kind','reference','sha256','recordedAt','appointmentId','accountId','calendarId']<>'{}'::jsonb
      or char_length(pg_catalog.btrim(coalesce(p_resolution->'source'->>'reference','')))not between 3 and 500
      or coalesce(p_resolution->'source'->>'sha256','')!~'^[a-f0-9]{64}$'
      or p_resolution->'source'->>'appointmentId' is distinct from a.id::text
      or p_resolution->'source'->>'accountId' is distinct from e.pipedream_account_id
      or p_resolution->'source'->>'calendarId' is distinct from e.google_calendar_id then raise exception 'attributable original reservation record required' using errcode='22023';end if;
    original_at:=(p_resolution->'source'->>'recordedAt')::timestamptz;
    -- Stripe's paid_at has second precision; compare within that same second.
    if original_at is null or original_at<a.created_at or original_at>=coalesce(p.paid_at+interval '1 second',a.confirmed_at)
      or e.created_at>original_at or (e.retired_at is not null and e.retired_at<=original_at) then
      raise exception 'evidence does not predate payment on the original epoch' using errcode='22023';end if;
    -- Reservation evidence owns a destination, not permission to mint a second
    -- event. Reuse the ID the pre-lifetime V3 reducer would have used.
    if event_id is distinct from 'obra'||pg_catalog.substr(pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_array('obra-calendar-v3',a.environment,a.id)::text,'UTF8'),'sha256'),'hex'),1,48) then
      raise exception 'reservation repair requires the original deterministic event identity' using errcode='22023';end if;
  else raise exception 'current selection is not original destination evidence' using errcode='22023';end if;
  if exists(select 1 from public.integration_outbox o join public.calendar_destination_epochs ep on ep.id=o.destination_epoch_id
    and ep.profile_id=o.profile_id and ep.environment=o.environment where o.appointment_id=a.id and o.profile_id=a.profile_id and o.environment=a.environment
    and o.command_type='calendar_create' and o.payload->>'connectionId'=ep.connection_id::text and o.payload->>'selectionId'=ep.calendar_selection_id::text
    and o.payload->>'googleEventId' is not null and (ep.id<>e.id or o.payload->>'googleEventId'<>event_id)) then
    raise exception 'original record conflicts with retained calendar effect identity' using errcode='22023';end if;
  before_state:=pg_catalog.to_jsonb(a);
  if reconstruct_epoch then
    insert into public.calendar_destination_epochs(id,profile_id,environment,connection_id,calendar_selection_id,connection_revision,pipedream_account_id,google_calendar_id,created_at,retired_at)
      values(e.id,e.profile_id,e.environment,e.connection_id,e.calendar_selection_id,e.connection_revision,e.pipedream_account_id,e.google_calendar_id,e.created_at,
        case when exists(select 1 from public.calendar_connections c where c.id=e.connection_id and c.connection_revision=e.connection_revision
          and c.pipedream_account_id=e.pipedream_account_id)then null else pg_catalog.clock_timestamp()end);
  end if;
  -- Cancellation/refunds and elapsed start times do not remove cleanup authority.
  -- Original provenance permits an exact probe, never an assumption of absence.
  update public.appointments set calendar_destination_epoch_id=e.id,
    calendar_state=case when a.appointment_state='confirmed' then 'create_pending' else 'cancel_pending' end,
    review_state=case when review_state='unresolved_destination' then 'none' else review_state end,
    updated_at=pg_catalog.clock_timestamp()where id=a.id;
  insert into public.calendar_event_links(appointment_id,profile_id,connection_id,calendar_selection_id,environment,google_event_id,
    desired_appointment_version,sync_state,destination_epoch_id,desired_state,desired_generation)
    values(a.id,a.profile_id,e.connection_id,e.calendar_selection_id,a.environment,event_id,a.version,'pending',e.id,
      case when a.appointment_state='confirmed' then 'present' else 'absent' end,greatest(a.calendar_generation,1))returning * into l;
  insert into public.booking_calendar_repair_audit(link_id,appointment_id,profile_id,environment,expected_generation,actor_user_id,reason,prior_state,request_id,evidence)
    values(l.id,a.id,a.profile_id,a.environment,p_expected_generation,actor_user_id,pg_catalog.btrim(p_reason),before_state,request_id,p_resolution);
  return true;
end $repair$;
revoke all on function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb) to service_role;

create function public.get_booking_calendar_repair_context(p_appointment_id uuid,p_actor_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;l public.calendar_event_links%rowtype;
begin
  if not exists(select 1 from public.validate_admin_session_v4(p_actor_token_hash,false)v where v.role='admin')then raise exception 'admin actor session required' using errcode='42501';end if;
  select * into strict a from public.appointments where id=p_appointment_id for share;
  select * into l from public.calendar_event_links where appointment_id=a.id and profile_id=a.profile_id and environment=a.environment;
  return pg_catalog.jsonb_build_object('appointmentId',a.id,'profileId',a.profile_id,'environment',a.environment,'reference',a.public_reference,
    'expectedVersion',a.version,'expectedGeneration',case when l.id is null then a.calendar_generation else l.desired_generation end,
    'appointmentState',a.appointment_state,'calendarState',a.calendar_state,'reviewState',a.review_state,'linkId',l.id,'reconcileStatus',l.reconcile_status,
    'googleEventId',coalesce(l.google_event_id,'obra'||pg_catalog.substr(pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
      pg_catalog.jsonb_build_array('obra-calendar-v3',a.environment,a.id)::text,'UTF8'),'sha256'),'hex'),1,48)),
    'destinationEpochs',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',ep.id,'accountId',ep.pipedream_account_id,
      'calendarId',ep.google_calendar_id,'revision',ep.connection_revision,'createdAt',ep.created_at,'retiredAt',ep.retired_at)order by ep.created_at desc),'[]'::jsonb)
      from (select * from public.calendar_destination_epochs where profile_id=a.profile_id and environment=a.environment order by created_at desc limit 50)ep),
    'cutoverEnabled',public.booking_cutover_enabled(a.profile_id,a.environment));
end $function$;
revoke all on function public.get_booking_calendar_repair_context(uuid,text) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.get_booking_calendar_repair_context(uuid,text) to service_role;

-- A claim can commit before its handoff/dispatch marker. Once both the hold and
-- lease expire, that effect-free reservation must release capacity too.
create or replace function public.expire_abandoned_booking_checkout_creations_v3(p_environment text,p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $function$
declare candidate record;a public.appointments%rowtype;p public.booking_payments%rowtype;
  expired integer:=0;guard_token text:=pg_catalog.gen_random_uuid()::text;
begin
  if p_environment is null or p_environment not in('test','live')then raise exception 'invalid abandoned checkout environment' using errcode='22023';end if;
  for candidate in select bp.id,bp.appointment_id from public.booking_payments bp join public.appointments apt
    on apt.id=bp.appointment_id and apt.profile_id=bp.profile_id and apt.environment=bp.environment
    where bp.environment=p_environment and bp.booking_contract_version=2 and apt.booking_contract_version=2
      and public.booking_cutover_enabled(bp.profile_id,bp.environment)
      and bp.payment_state='creating' and bp.checkout_session_id is null and apt.appointment_state='held' and apt.payment_state='creating'
      and (bp.checkout_lease_expires_at is null or bp.checkout_lease_expires_at<=pg_catalog.clock_timestamp())
      and (bp.checkout_provider_expires_at<=pg_catalog.clock_timestamp()
        or (bp.checkout_provider_expires_at is null and apt.reservation_expires_at<=pg_catalog.clock_timestamp()))
    order by coalesce(bp.checkout_provider_expires_at,apt.reservation_expires_at),bp.id
    limit greatest(1,least(coalesce(p_limit,100),500))*4
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.appointment_id::text||':booking-appointment',0))then continue;end if;
    select * into a from public.appointments where id=candidate.appointment_id and environment=p_environment
      and booking_contract_version=2 and appointment_state='held' and payment_state='creating' for update skip locked;
    if not found then continue;end if;
    select * into p from public.booking_payments where id=candidate.id and appointment_id=a.id and profile_id=a.profile_id
      and environment=a.environment and booking_contract_version=2 and payment_state='creating' and checkout_session_id is null
      and (checkout_lease_expires_at is null or checkout_lease_expires_at<=pg_catalog.clock_timestamp()) for update skip locked;
    if not found then continue;end if;
    if not public.booking_cutover_enabled(a.profile_id,a.environment) or p.amount_paid_minor<>0 or p.amount_refunded_minor<>0
      or a.refund_state<>'not_requested' or p.refund_state<>'not_requested' or p.refund_requested_at is not null then continue;end if;
    if p.checkout_provider_expires_at is null then
      if a.reservation_expires_at>pg_catalog.clock_timestamp() or p.checkout_expires_at is not null
        or p.confirmation_handoff_expires_at is not null or p.confirmation_nonce_hash is not null
        or p.payment_intent_id is not null or p.charge_id is not null then continue;end if;
    elsif p.checkout_provider_expires_at>pg_catalog.clock_timestamp() then continue;end if;
    perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);
    perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
    update public.booking_payments set payment_state='failed',checkout_last_error='Checkout creation expired without provider identity',
      checkout_lease_token=null,checkout_lease_expires_at=null,checkout_fencing_token=checkout_fencing_token+1,
      failed_at=coalesce(failed_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp()where id=p.id;
    update public.appointments set appointment_state='cancelled',appointment_reason='checkout_creation_abandoned',payment_state='failed',
      cancelled_at=coalesce(cancelled_at,pg_catalog.clock_timestamp()),version=version+1,updated_at=pg_catalog.clock_timestamp()where id=a.id;
    expired:=expired+1;
    exit when expired>=greatest(1,least(coalesce(p_limit,100),500));
  end loop;
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
  return expired;
exception when others then
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
  raise;
end $function$;
revoke all on function public.expire_abandoned_booking_checkout_creations_v3(text,integer) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.expire_abandoned_booking_checkout_creations_v3(text,integer) to booking_worker;

create or replace function public.cancel_contractor_booking(
  p_appointment_id uuid,p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_client_request_id uuid,p_request_hash text
) returns public.appointments language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;p public.booking_payments%rowtype;op public.appointment_operations%rowtype;
begin
  if not exists(select 1 from public.profiles where id=p_profile_id and environment=p_environment and auth_user_id=p_actor_auth_user_id)then
    raise exception 'booking cancellation forbidden' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':booking',0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_appointment_id::text||':booking-appointment',0));
  select * into op from public.appointment_operations where profile_id=p_profile_id and environment=p_environment
    and operation_type='cancel' and client_request_id=p_client_request_id;
  if found then
    if op.request_hash<>p_request_hash or op.appointment_id<>p_appointment_id then raise exception 'idempotency key payload conflict' using errcode='23505';end if;
    perform public.converge_booking_full_refund_v3(op.appointment_id);
    select * into strict a from public.appointments where id=op.appointment_id;return a;
  end if;
  select * into strict a from public.appointments where id=p_appointment_id and profile_id=p_profile_id and environment=p_environment for update;
  if a.start_at<=pg_catalog.clock_timestamp()then raise exception 'only future bookings can be cancelled' using errcode='P0001';end if;
  -- Provisional late-payment arbitration is not a completed owner cancellation.
  if a.appointment_state='cancelled' and a.appointment_reason is distinct from 'late_payment_arbitration' then
    perform public.converge_booking_full_refund_v3(a.id);
    select * into strict a from public.appointments where id=p_appointment_id;
    insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,client_request_id,request_hash,state,result)
      values(a.profile_id,a.id,a.environment,'cancel',p_client_request_id,p_request_hash,'succeeded',pg_catalog.jsonb_build_object('appointmentId',a.id,'version',a.version));
    return a;
  end if;
  select * into strict p from public.booking_payments where appointment_id=a.id and profile_id=a.profile_id and environment=a.environment for update;
  if (a.appointment_state<>'confirmed' and not(a.appointment_state='cancelled' and a.appointment_reason='late_payment_arbitration'))
    or (p.payment_state not in('paid','disputed') and not(a.booking_contract_version=2 and p.booking_contract_version=2
      and p.amount_paid_minor=p.expected_amount_minor and p.paid_at is not null
      and p.payment_intent_id is not null and p.charge_id is not null))then raise exception 'booking is not eligible for contractor cancellation' using errcode='P0001';end if;
  update public.appointments set appointment_state='cancelled',appointment_reason='contractor_cancelled',
    cancellation_requested_at=pg_catalog.clock_timestamp(),cancelled_at=pg_catalog.clock_timestamp(),
    refund_state=case when p.amount_paid_minor>p.amount_refunded_minor then 'pending' else refund_state end,
    review_state=case when a.appointment_reason='late_payment_arbitration' and review_state='late_payment' then 'none' else review_state end,
    -- Retained links own current effects, not retired calendar_create outbox rows.
    -- Only the reconciler's exact absence observation can complete their cancellation.
    calendar_state=case when calendar_state<>'not_required' or exists(select 1 from public.calendar_event_links l
      where l.appointment_id=a.id and l.profile_id=a.profile_id and l.environment=a.environment)then 'cancel_pending' else calendar_state end,
    refund_generation=greatest(a.refund_generation,p.refund_generation)+case when p.amount_paid_minor>p.amount_refunded_minor then 1 else 0 end,
    calendar_generation=calendar_generation+1,version=version+1,updated_at=pg_catalog.clock_timestamp()
    where id=a.id returning * into a;
  if p.amount_paid_minor>p.amount_refunded_minor then
    update public.booking_payments set refund_state='pending',refund_requested_at=coalesce(refund_requested_at,pg_catalog.clock_timestamp()),
      refund_generation=a.refund_generation,refund_idempotency_key='booking-refund:'||a.id||':'||a.refund_generation,
      updated_at=pg_catalog.clock_timestamp()where id=p.id;
    insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)
      values(a.profile_id,a.environment,a.id,'refund','booking-refund:'||a.id||':'||a.refund_generation,a.version,a.refund_generation,2,
        pg_catalog.jsonb_build_object('amount',p.amount_paid_minor-p.amount_refunded_minor))on conflict(profile_id,environment,idempotency_key)do nothing;
  elsif public.converge_booking_full_refund_v3(a.id) then
    select * into strict a from public.appointments where id=p_appointment_id;
  end if;
  insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,client_request_id,request_hash,state,result)
    values(a.profile_id,a.id,a.environment,'cancel',p_client_request_id,p_request_hash,'succeeded',pg_catalog.jsonb_build_object('appointmentId',a.id,'version',a.version));
  return a;
end $function$;
revoke all on function public.cancel_contractor_booking(uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.cancel_contractor_booking(uuid,uuid,text,uuid,uuid,text) to service_role;

-- Keep the receipt contract; provisional arbitration uses its existing settling
-- code rather than exposing a final cancellation before a decision is made.
create or replace function public.booking_confirmation_projection_v3(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare a public.appointments%rowtype;p public.booking_payments%rowtype;code text;terminal boolean:=false;prolonged boolean;
begin
  select * into strict a from public.appointments where id=p_appointment_id;
  select * into p from public.booking_payments where appointment_id=a.id and profile_id=a.profile_id and environment=a.environment;
  prolonged:=a.updated_at<pg_catalog.clock_timestamp()-interval '60 seconds';
  if a.refund_state='failed' then code:='refund_failed';terminal:=true;
  elsif a.refund_state='pending' and a.review_state='late_payment' then code:='late_payment_refund_pending';
  elsif a.refund_state='pending' then code:='refund_pending';
  elsif a.refund_state='succeeded' then code:='refund_succeeded';terminal:=true;
  elsif a.appointment_state='cancelled' and a.appointment_reason='late_payment_arbitration' and a.cancellation_requested_at is null then code:='settling';
  elsif a.appointment_reason in('payment_expired','hold_expired') then code:='unpaid_expired';terminal:=true;
  elsif a.payment_state='failed' then code:='payment_failed';terminal:=true;
  elsif a.payment_state in('not_started','creating','pending') then code:=case when prolonged then 'payment_pending_prolonged' else 'payment_pending' end;
  elsif a.appointment_reason='late_payment_recovered' then code:='late_payment_recovered';
  elsif a.appointment_state='confirmed' and a.calendar_state='create_failed' then code:='confirmed_calendar_failed';terminal:=true;
  elsif a.appointment_state='confirmed' and a.calendar_state='create_pending' then code:='confirmed_calendar_pending';
  elsif a.appointment_state='confirmed' then code:='confirmed_calendar_ready';terminal:=true;
  elsif a.appointment_state='cancelled' and a.calendar_state='cancel_failed' then code:='cancelled_calendar_failed';terminal:=true;
  elsif a.appointment_state='cancelled' and a.calendar_state='cancel_pending' then code:='cancelled_calendar_pending';
  elsif a.appointment_state='cancelled' then code:='cancelled';terminal:=true;
  else code:='settling';end if;
  return pg_catalog.jsonb_build_object(
    'reference',a.public_reference,'environment',a.environment,'startAt',a.start_at,'endAt',a.end_at,'timeZone',a.time_zone,
    'service',a.service_snapshot,'location',a.location_snapshot,'appointmentState',a.appointment_state,'appointmentReason',a.appointment_reason,
    'paymentState',a.payment_state,'refundState',a.refund_state,'calendarState',a.calendar_state,'reviewState',a.review_state,
    'reservationExpiresAt',a.reservation_expires_at,'confirmedAt',a.confirmed_at,'cancelledAt',a.cancelled_at,'updatedAt',a.updated_at,
    'checkoutSessionId',p.checkout_session_id,'statusCode',code,'terminal',terminal,'pollAfterMs',case when terminal then null else 2500 end,
    'automaticPollUntil',case when terminal then null else a.updated_at+interval '30 seconds' end);
end $function$;
revoke all on function public.booking_confirmation_projection_v3(uuid) from public,anon,authenticated,service_role,booking_worker;

-- Provider credentials are a dependency, not terminal payment evidence. Existing
-- callers retain their backoff; the current worker can request a bounded slow retry.
-- Legacy terminal errors have no attributable cause and are deliberately not reset.
drop function public.fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text);
create function public.fail_booking_payment_event_v3(
  p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_retryable boolean,p_safe_error text,
  p_retry_delay_seconds integer default 0
) returns boolean language plpgsql security definer set search_path='' as $function$
begin
  if p_lease_token is null or p_retryable is null or nullif(pg_catalog.btrim(p_safe_error),'') is null
    or p_retry_delay_seconds is null or p_retry_delay_seconds not between 0 and 3600 then
    raise exception 'invalid booking event failure' using errcode='22023';end if;
  update public.provider_event_inbox set processing_state=case when p_retryable then 'failed' else 'dead_letter' end,
    processed_at=case when p_retryable then null else pg_catalog.clock_timestamp() end,
    next_attempt_at=case when p_retryable then pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>
      greatest(p_retry_delay_seconds,least(3600,30*(2^least(attempts,7))::integer))) else 'infinity'::timestamptz end,
    safe_error=left(p_safe_error,240),lease_token=null,lease_expires_at=null
    where id=p_event_id and provider='stripe' and event_family='booking' and processing_state='processing'
      and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();
  return found;
end $function$;

drop function public.fail_booking_session_expiry_v3(uuid,uuid,bigint,boolean,text);
create function public.fail_booking_session_expiry_v3(
  p_payment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_retryable boolean,p_safe_error text,
  p_retry_delay_seconds integer default 0
) returns boolean language plpgsql security definer set search_path='' as $function$
declare p public.booking_payments%rowtype;appointment_id uuid;
begin
  if p_lease_token is null or p_retryable is null or nullif(pg_catalog.btrim(p_safe_error),'') is null
    or p_retry_delay_seconds is null or p_retry_delay_seconds not between 0 and 3600 then
    raise exception 'invalid session expiry failure' using errcode='22023';end if;
  select bp.appointment_id into appointment_id from public.booking_payments bp where bp.id=p_payment_id;
  if appointment_id is null then return false;end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_id::text||':booking-appointment',0));
  update public.booking_payments set checkout_last_error=left(p_safe_error,240),checkout_lease_token=null,checkout_lease_expires_at=null,
    session_expiry_next_attempt_at=case when p_retryable then pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>
      greatest(p_retry_delay_seconds,least(3600,15*(2^least(session_expiry_attempts,8))::integer))) else 'infinity'::timestamptz end,
    updated_at=pg_catalog.clock_timestamp()
    where id=p_payment_id and checkout_lease_token=p_lease_token and checkout_fencing_token=p_fencing_token
      and checkout_lease_expires_at>pg_catalog.clock_timestamp() returning * into p;
  if p.id is null then return false;end if;
  if not p_retryable then update public.appointments set review_state='provider_inconsistency',version=version+1,updated_at=pg_catalog.clock_timestamp()
    where id=p.appointment_id and payment_state not in('paid','disputed');end if;
  return true;
end $function$;

drop function public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text);
create function public.fail_booking_refund_command_v3(
  p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_retryable boolean,p_safe_error text,
  p_retry_delay_seconds integer default 0
) returns boolean language plpgsql security definer set search_path='' as $function$
declare command public.integration_outbox%rowtype;payment public.booking_payments%rowtype;appointment public.appointments%rowtype;
  guard_token text:=pg_catalog.gen_random_uuid()::text;appointment_id uuid;paid_state text;
begin
  if p_lease_token is null or p_retryable is null or p_retry_delay_seconds is null or p_retry_delay_seconds not between 0 and 3600 then
    raise exception 'invalid booking refund failure' using errcode='22023';end if;
  select o.appointment_id into appointment_id from public.integration_outbox o where o.id=p_command_id;
  if appointment_id is null then return false;end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(appointment_id::text||':booking-appointment',0));
  select o.* into command from public.integration_outbox o where o.id=p_command_id and o.command_type='refund' and o.effect_contract_version=2
    and o.state='processing' and o.lease_token=p_lease_token and o.fencing_token=p_fencing_token and o.lease_expires_at>pg_catalog.clock_timestamp() for update;
  if command.id is null then return false;end if;
  select p.* into strict payment from public.booking_payments p where p.appointment_id=command.appointment_id
    and p.profile_id=command.profile_id and p.environment=command.environment and p.refund_generation=command.effect_generation for update;
  select a.* into strict appointment from public.appointments a where a.id=command.appointment_id
    and a.profile_id=command.profile_id and a.environment=command.environment and a.refund_generation=command.effect_generation for update;
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
  if payment.booking_contract_version=2 and appointment.booking_contract_version=2
    and payment.amount_paid_minor=payment.expected_amount_minor and payment.paid_at is not null
    and payment.payment_intent_id is not null and payment.charge_id is not null then
    paid_state:=case when payment.dispute_state in('open','lost','closed')then 'disputed' else 'paid' end;
    update public.booking_payments set payment_state=paid_state,updated_at=pg_catalog.clock_timestamp()
      where id=payment.id and payment_state is distinct from paid_state;
    update public.appointments set payment_state=paid_state,version=version+1,updated_at=pg_catalog.clock_timestamp()
      where id=appointment.id and payment_state is distinct from paid_state;
  end if;
  update public.integration_outbox set state=case when p_retryable then 'failed' else 'dead_letter' end,
    terminal_at=case when p_retryable then null else pg_catalog.clock_timestamp() end,
    next_attempt_at=case when p_retryable then pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>greatest(60,p_retry_delay_seconds))
      else 'infinity'::timestamptz end,lease_token=null,lease_expires_at=null,
    safe_error=left(coalesce(p_safe_error,'Booking refund provider operation failed'),240) where id=command.id;
  if not p_retryable then
    update public.appointments set refund_state='failed',review_state='refund_failure',version=version+1,updated_at=pg_catalog.clock_timestamp() where id=appointment.id;
    update public.booking_payments set refund_state='failed',updated_at=pg_catalog.clock_timestamp() where id=payment.id;
  end if;
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
  return true;
exception when others then
  perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);
  raise;
end $function$;
revoke all on function public.fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text,integer),
  public.fail_booking_session_expiry_v3(uuid,uuid,bigint,boolean,text,integer),
  public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text,integer) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text,integer),
  public.fail_booking_session_expiry_v3(uuid,uuid,bigint,boolean,text,integer),
  public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text,integer) to booking_worker;
