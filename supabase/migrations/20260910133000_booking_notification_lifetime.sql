-- Notification truth and bounded Resend replay on the existing delivery ledger.
-- Resend retains idempotency keys for 24 hours, not for the life of a booking:
-- https://resend.com/docs/dashboard/emails/idempotency-keys
alter table public.booking_notifications
  add column first_dispatch_at timestamptz,
  add column replay_deadline_at timestamptz,
  add column dispatch_payload text,
  add column dispatch_appointment jsonb,
  add constraint booking_notifications_dispatch_evidence_check check (
    pg_catalog.num_nonnulls(first_dispatch_at,replay_deadline_at,dispatch_payload,dispatch_appointment)=0
    or (pg_catalog.num_nonnulls(first_dispatch_at,replay_deadline_at,dispatch_payload,dispatch_appointment)=4
      and pg_catalog.isfinite(first_dispatch_at)
      and replay_deadline_at=first_dispatch_at+interval '24 hours'
      and pg_catalog.octet_length(dispatch_payload) between 2 and 65536
      and pg_catalog.jsonb_typeof(dispatch_appointment)='object')
  );

-- Neither attempts nor mutable updated_at prove when an old worker sent. Keep
-- these obligations visible, including a still-in-flight legacy completion.
with unknown as (
  update public.booking_notifications n set state='failed',next_attempt_at='infinity',
    last_error='Booking email acceptance is unknown; first-dispatch evidence is missing',
    failed_at=coalesce(n.failed_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp(),
    lease_token=case when n.state='processing' and n.lease_expires_at>pg_catalog.clock_timestamp() then n.lease_token end,
    lease_expires_at=case when n.state='processing' and n.lease_expires_at>pg_catalog.clock_timestamp() then n.lease_expires_at end
  where n.state in ('pending','retry','processing') and (n.attempts>0 or n.state in ('retry','processing'))
    and n.provider_message_id is null and n.accepted_at is null and n.first_dispatch_at is null
  returning n.*
)
insert into public.booking_notification_delivery_review_v3(
  notification_id,appointment_id,profile_id,environment,reason_code,safe_error,attempts
)
select id,appointment_id,profile_id,environment,'acceptance_unknown',last_error,attempts from unknown
on conflict(notification_id) do update set reason_code=excluded.reason_code,safe_error=excluded.safe_error,
  attempts=excluded.attempts,resolved_at=null;

-- Replace only the lifecycle predicates in the existing projector,
-- repair scan and validity authority. Financial facts, source keys, generations,
-- recipient repair and audience deduplication remain the original authority.
do $predicates$
declare identity regprocedure;definition text;
begin
  foreach identity in array array[
    'public.project_booking_notifications_v3(uuid)'::regprocedure,
    'public.reconcile_booking_notification_projection_v3(text,integer)'::regprocedure,
    'public.booking_notification_event_current_v4(uuid)'::regprocedure
  ] loop
    definition:=pg_catalog.pg_get_functiondef(identity);
    if pg_catalog.strpos(definition,'a.confirmed_at is not null')=0
      or pg_catalog.strpos(definition,'p.refund_requested_at is not null')=0
      or pg_catalog.strpos(definition,'a.calendar_state in(''create_failed'',''cancel_failed'')')=0
      or pg_catalog.strpos(definition,'a.calendar_state in(''created'',''cancelled'')')=0 then
      raise exception 'notification predicate authority changed: %',identity using errcode='55000';
    end if;
    definition:=pg_catalog.replace(definition,'a.confirmed_at is not null',
      'a.confirmed_at is not null and a.appointment_state=''confirmed'' and a.cancellation_requested_at is null');
    -- A retained request is history, not pending refund intent. Use the same
    -- current payment/generation/remainder in projection, repair and dispatch.
    definition:=pg_catalog.replace(definition,'p.refund_requested_at is not null',
      'p.refund_requested_at is not null and a.refund_state=''pending'' and p.refund_state=''pending'' and a.refund_generation=p.refund_generation and p.amount_paid_minor>p.amount_refunded_minor');
    definition:=pg_catalog.replace(definition,'a.calendar_state in(''create_failed'',''cancel_failed'')',
      '((a.appointment_state=''confirmed'' and a.cancellation_requested_at is null and a.calendar_state=''create_failed'') or (a.appointment_state=''cancelled'' and a.calendar_state=''cancel_failed''))');
    definition:=pg_catalog.replace(definition,'a.calendar_state in(''created'',''cancelled'')',
      '((a.appointment_state=''confirmed'' and a.cancellation_requested_at is null and a.calendar_state=''created'') or (a.appointment_state=''cancelled'' and a.calendar_state=''cancelled''))');
    -- A repaired address cannot revive a superseded event or monopolize the scan.
    definition:=pg_catalog.replace(definition,'n.state=''suppressed''and n.provider_message_id is null',
      'n.state=''suppressed''and n.provider_message_id is null and public.booking_notification_event_current_v4(n.id)');
    execute definition;
  end loop;
end $predicates$;

create or replace function public.suppress_noncanonical_booking_notifications_v4(p_environment text,p_limit integer default 500)
returns integer language plpgsql security definer set search_path='' as $function$
declare n public.booking_notifications%rowtype;changed integer:=0;reason text;
begin
  if p_environment is null or p_environment not in ('test','live') then
    raise exception 'invalid notification suppression environment' using errcode='22023';
  end if;
  for n in select c.* from public.booking_notifications c
    where c.environment=p_environment and c.state in ('pending','retry','processing')
      and c.provider_message_id is null and c.accepted_at is null
      and (c.state<>'processing' or c.lease_expires_at<=pg_catalog.clock_timestamp())
      and (not public.booking_notification_event_current_v4(c.id)
        or c.replay_deadline_at<=pg_catalog.clock_timestamp())
    order by c.created_at,c.id for update skip locked limit greatest(1,least(coalesce(p_limit,500),1000))
  loop
    if n.first_dispatch_at is null then
      update public.booking_notifications set state='suppressed',suppression_reason='noncanonical_current_state',
        lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=n.id;
    else
      reason:=case when n.replay_deadline_at<=pg_catalog.clock_timestamp() then 'idempotency_expired' else 'acceptance_unknown' end;
      update public.booking_notifications set state='failed',next_attempt_at='infinity',
        last_error='Booking email acceptance is unresolved; automatic replay is not safe',
        failed_at=coalesce(failed_at,pg_catalog.clock_timestamp()),lease_token=null,lease_expires_at=null,
        updated_at=pg_catalog.clock_timestamp() where id=n.id;
      insert into public.booking_notification_delivery_review_v3(
        notification_id,appointment_id,profile_id,environment,reason_code,safe_error,attempts
      ) values(n.id,n.appointment_id,n.profile_id,n.environment,reason,
        'Booking email acceptance is unresolved; automatic replay is not safe',n.attempts)
      on conflict(notification_id) do update set reason_code=excluded.reason_code,safe_error=excluded.safe_error,
        attempts=excluded.attempts,resolved_at=null;
    end if;
    changed:=changed+1;
  end loop;
  return changed;
end $function$;

-- Old callers cannot create new unmarked processing records after the legacy
-- inventory above. There is one claim implementation, not a permissive overload.
drop function public.claim_due_booking_notifications_v3(text,uuid,integer);
create function public.claim_due_booking_notifications_v3(
  p_environment text,p_lease_token uuid,p_limit integer default 25,p_dispatch_contract integer default 0
) returns setof public.booking_notifications language plpgsql security definer set search_path='' as $function$
begin
  if p_dispatch_contract is distinct from 1 then
    raise exception 'notification dispatch authorization contract required' using errcode='22023';
  end if;
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null
    or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid notification claim' using errcode='22023';
  end if;
  perform public.suppress_noncanonical_booking_notifications_v4(p_environment,1000);
  return query with due as (
    select n.id from public.booking_notifications n where n.environment=p_environment
      and public.booking_notification_event_current_v4(n.id) and n.recipient_email is not null
      and n.provider_message_id is null and n.accepted_at is null
      and (n.first_dispatch_at is null or n.replay_deadline_at>pg_catalog.clock_timestamp())
      and ((n.state in ('pending','retry') and n.next_attempt_at<=pg_catalog.clock_timestamp())
        or (n.state='processing' and n.lease_expires_at<=pg_catalog.clock_timestamp()))
    order by n.next_attempt_at,n.created_at,n.id for update skip locked limit p_limit
  ) update public.booking_notifications n set state='processing',attempts=n.attempts+1,
    lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',
    fencing_token=n.fencing_token+1,updated_at=pg_catalog.clock_timestamp()
    from due where n.id=due.id returning n.*;
end $function$;

create function public.authorize_booking_notification_dispatch_v3(
  p_notification_id uuid,p_environment text,p_lease_token uuid,p_fencing_token bigint,
  p_expected_appointment jsonb,p_payload text
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare a public.appointments%rowtype;n public.booking_notifications%rowtype;
  current_appointment jsonb;payload jsonb;now_at timestamptz;reason text;budget_ms integer;
begin
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null
    or p_fencing_token is null or pg_catalog.jsonb_typeof(p_expected_appointment) is distinct from 'object'
    or p_payload is null or pg_catalog.octet_length(p_payload) not between 2 and 65536 then
    raise exception 'invalid notification dispatch authority' using errcode='22023';
  end if;
  -- Same lock order as cancellation's appointment -> notification projection.
  select apt.* into a from public.appointments apt join public.booking_notifications notice
    on notice.appointment_id=apt.id and notice.profile_id=apt.profile_id and notice.environment=apt.environment
    where notice.id=p_notification_id and notice.environment=p_environment for share of apt;
  if not found then return null;end if;
  select * into n from public.booking_notifications where id=p_notification_id and environment=p_environment
    and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token
    and lease_expires_at>pg_catalog.clock_timestamp() and provider_message_id is null and accepted_at is null for update;
  if not found then return null;end if;
  now_at:=pg_catalog.clock_timestamp();
  -- Freeze only facts this copy uses; unrelated financial/calendar revisions
  -- do not supersede an otherwise-current message.
  current_appointment:=pg_catalog.jsonb_build_object(
    'public_reference',a.public_reference,'start_at',a.start_at,'time_zone',a.time_zone,
    'service_snapshot',a.service_snapshot
  );
  if n.notification_type in ('confirmed','calendar_failed','calendar_repaired') then
    current_appointment:=current_appointment||pg_catalog.jsonb_build_object(
      'appointment_state',a.appointment_state,'cancellation_requested_at',a.cancellation_requested_at);
  end if;
  if n.notification_type in ('calendar_failed','calendar_repaired') then
    current_appointment:=current_appointment||pg_catalog.jsonb_build_object('calendar_state',a.calendar_state);
  end if;
  if not public.booking_notification_event_current_v4(n.id) then
    if n.first_dispatch_at is null then
      update public.booking_notifications set state='suppressed',suppression_reason='noncanonical_current_state',
        lease_token=null,lease_expires_at=null,updated_at=now_at where id=n.id;
      return pg_catalog.jsonb_build_object('action','suppressed');
    end if;
    reason:='acceptance_unknown';
  elsif n.first_dispatch_at is not null then
    if n.replay_deadline_at<=now_at+interval '1 second' then reason:='idempotency_expired';
    elsif n.dispatch_payload is distinct from p_payload or n.dispatch_appointment is distinct from current_appointment then
      reason:='acceptance_unknown';
    end if;
  end if;
  if reason is not null then
    update public.booking_notifications set state='failed',next_attempt_at='infinity',
      last_error='Booking email acceptance is unresolved; automatic replay is not safe',
      failed_at=coalesce(failed_at,now_at),lease_token=null,lease_expires_at=null,updated_at=now_at where id=n.id;
    insert into public.booking_notification_delivery_review_v3(
      notification_id,appointment_id,profile_id,environment,reason_code,safe_error,attempts
    ) values(n.id,n.appointment_id,n.profile_id,n.environment,reason,
      'Booking email acceptance is unresolved; automatic replay is not safe',n.attempts)
    on conflict(notification_id) do update set reason_code=excluded.reason_code,safe_error=excluded.safe_error,
      attempts=excluded.attempts,resolved_at=null;
    return pg_catalog.jsonb_build_object('action','review','reason',reason);
  end if;
  if not (p_expected_appointment @> current_appointment) then
    raise exception 'notification context changed before dispatch' using errcode='40001';
  end if;
  payload:=p_payload::jsonb;
  if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
    or payload->'to' is distinct from pg_catalog.jsonb_build_array(n.recipient_email)
    or not public.booking_notification_email_valid_v3(n.recipient_email)
    or pg_catalog.jsonb_typeof(payload->'from') is distinct from 'string' or nullif(pg_catalog.btrim(payload->>'from'),'') is null
    or pg_catalog.jsonb_typeof(payload->'subject') is distinct from 'string' or nullif(pg_catalog.btrim(payload->>'subject'),'') is null
    or pg_catalog.jsonb_typeof(payload->'text') is distinct from 'string' or nullif(pg_catalog.btrim(payload->>'text'),'') is null
    or payload-array['from','to','subject','text']<>'{}'::jsonb then
    raise exception 'invalid notification dispatch payload' using errcode='22023';
  end if;
  if n.lease_expires_at<=pg_catalog.clock_timestamp()+interval '1 second' then return null;end if;
  if n.first_dispatch_at is null then
    update public.booking_notifications set first_dispatch_at=now_at,replay_deadline_at=now_at+interval '24 hours',
      dispatch_payload=p_payload,dispatch_appointment=current_appointment,updated_at=now_at
      where id=n.id returning * into n;
  end if;
  -- Short just-in-time authority is bounded by both the row lease and the first
  -- dispatch window. The caller subtracts authorization transport time as well.
  budget_ms:=floor(least(10000,extract(epoch from (least(n.replay_deadline_at,n.lease_expires_at)
    -pg_catalog.clock_timestamp()))*1000-1000))::integer;
  if budget_ms<=0 then return null;end if;
  return pg_catalog.jsonb_build_object('action','dispatch','payload',n.dispatch_payload,'dispatch_budget_ms',budget_ms);
end $function$;

create or replace function public.complete_booking_notification_v3(
  p_notification_id uuid,p_environment text,p_lease_token uuid,p_fencing_token bigint,
  p_provider_destination text,p_provider_message_id text
) returns boolean language plpgsql security definer set search_path='' as $function$
declare n public.booking_notifications%rowtype;
begin
  if p_environment is null or p_environment not in ('test','live') or p_provider_destination is distinct from 'resend'
    or p_lease_token is null or p_fencing_token is null or coalesce(p_provider_message_id,'')!~'^[[:alnum:]_-]{8,200}$' then
    raise exception 'invalid notification provider settlement' using errcode='22023';
  end if;
  select * into n from public.booking_notifications where id=p_notification_id and environment=p_environment for update;
  if not found or n.lease_token is distinct from p_lease_token or n.fencing_token is distinct from p_fencing_token then
    raise exception 'stale notification settlement' using errcode='40001';
  end if;
  -- Exact response-loss repetition cannot reset delivered/bounced/complained
  -- evidence. The retained token identifies settlement, not a renewable lease.
  if n.provider_message_id=p_provider_message_id and n.provider_destination=p_provider_destination and n.accepted_at is not null then
    return true;
  end if;
  if n.provider_message_id is not null or n.accepted_at is not null
    or n.lease_expires_at is null or n.lease_expires_at<=pg_catalog.clock_timestamp()
    or not ((n.state='processing' and n.first_dispatch_at is not null)
      or (n.state='failed' and n.first_dispatch_at is null and exists(
        select 1 from public.booking_notification_delivery_review_v3 r where r.notification_id=n.id
          and r.reason_code='acceptance_unknown' and r.resolved_at is null))) then
    raise exception 'stale notification settlement' using errcode='40001';
  end if;
  -- Cancellation after dispatch does not erase an actual provider acceptance.
  update public.booking_notifications set state='accepted',provider_destination=p_provider_destination,
    provider_message_id=p_provider_message_id,accepted_at=pg_catalog.clock_timestamp(),
    last_error=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=n.id;
  update public.booking_notification_delivery_events set environment=p_environment
    where provider_message_id=p_provider_message_id and environment is null;
  perform public.reduce_booking_notification_delivery_v3(n.id);
  update public.booking_notification_delivery_review_v3 set resolved_at=pg_catalog.clock_timestamp()
    where notification_id=n.id and resolved_at is null;
  return true;
end $function$;

create or replace function public.fail_booking_notification_v3(
  p_notification_id uuid,p_environment text,p_lease_token uuid,p_fencing_token bigint,
  p_retryable boolean,p_safe_error text
) returns boolean language plpgsql security definer set search_path='' as $function$
declare n public.booking_notifications%rowtype;reason text;retry boolean;now_at timestamptz;
begin
  select * into n from public.booking_notifications where id=p_notification_id and environment=p_environment
    and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token
    and lease_expires_at>pg_catalog.clock_timestamp() and provider_message_id is null and accepted_at is null for update;
  if not found then raise exception 'stale notification failure' using errcode='40001';end if;
  now_at:=pg_catalog.clock_timestamp();
  retry:=coalesce(p_retryable,false) and n.attempts<8
    and (n.first_dispatch_at is null or n.replay_deadline_at>now_at+interval '1 second');
  -- A rejection of this attempt cannot disprove acceptance of an earlier lost
  -- response under the same dispatch marker.
  reason:=case when n.first_dispatch_at is not null and n.replay_deadline_at<=now_at+interval '1 second' then 'idempotency_expired'
    when n.first_dispatch_at is not null then 'acceptance_unknown'
    when p_retryable then 'retry_exhausted' else 'permanent_delivery_failure' end;
  update public.booking_notifications set state=case when retry then 'retry' else 'failed' end,
    next_attempt_at=case when retry then least(coalesce(n.replay_deadline_at,'infinity'),now_at
      +pg_catalog.make_interval(secs=>least(300,pg_catalog.power(2,least(n.attempts,8))::integer))) else 'infinity'::timestamptz end,
    last_error=left(coalesce(p_safe_error,'Booking notification failed'),240),
    failed_at=case when not retry then now_at else failed_at end,
    lease_token=null,lease_expires_at=null,updated_at=now_at where id=n.id;
  if not retry then
    insert into public.booking_notification_delivery_review_v3(notification_id,appointment_id,profile_id,environment,reason_code,safe_error,attempts)
    values(n.id,n.appointment_id,n.profile_id,n.environment,reason,left(coalesce(p_safe_error,'Booking notification failed'),240),n.attempts)
    on conflict(notification_id) do update set reason_code=excluded.reason_code,safe_error=excluded.safe_error,
      attempts=excluded.attempts,resolved_at=null;
  end if;
  return true;
end $function$;

-- No table access or alternative send authority is granted. Existing RLS,
-- webhook reduction and financial/calendar RPC permissions remain unchanged.
revoke all on function public.claim_due_booking_notifications_v3(text,uuid,integer,integer),
  public.authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text)
  from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.claim_due_booking_notifications_v3(text,uuid,integer,integer),
  public.authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text) to booking_worker;

-- The Auth adapter proves whether fetch started. A known-unsent worker may release
-- its reserved intent even when the begin-RPC response was lost. Such an attempt
-- consumes no provider budget; a dispatched/unknown request must use the separate
-- ambiguity authority instead. The same live lease/fence owns both cases.
create or replace function public.defer_saas_checkout_fulfillment(
  p_id uuid,p_lease_token uuid,p_fencing_token bigint,p_safe_error text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.saas_checkout_fulfillment_outbox set
    state='retry_wait',next_attempt_at=pg_catalog.clock_timestamp()+interval '60 seconds',
    provider_attempts=greatest(0,provider_attempts-case when provider_dispatch_started_at is not null then 1 else 0 end),
    provider_dispatch_started_at=null,
    last_error=pg_catalog.left(coalesce(p_safe_error,'OTP dispatch deferred before provider call'),500),
    lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
  where id=p_id and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token
    and lease_expires_at>=pg_catalog.clock_timestamp();
  return found;
end $$;
revoke all on function public.defer_saas_checkout_fulfillment(uuid,uuid,bigint,text)
  from public,anon,authenticated,booking_worker;
grant execute on function public.defer_saas_checkout_fulfillment(uuid,uuid,bigint,text) to service_role;
