-- Customer lifecycle closure for booking receipts, notifications, attachments, and workers.
-- Forward-only: preserve evidence, retire competing authorities, and keep every admission mode off by default.

-- ---------------------------------------------------------------------------
-- Browser-bound handoff authority remains valid through Stripe Checkout expiry
-- plus five minutes for redirect and clock skew; it never grants payment truth.
alter table public.booking_payments add column if not exists confirmation_handoff_expires_at timestamptz;

-- Receipt handoff: the recoverable handoff is durable before Stripe dispatch,
-- and the receipt capability may project pending state before a webhook settles.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_receipt_capabilities_v3 (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null,
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  checkout_session_id text not null,
  public_reference uuid not null,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  issued_nonce_hash text not null check (issued_nonce_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  first_accessed_at timestamptz,
  last_accessed_at timestamptz,
  access_count bigint not null default 0 check (access_count >= 0),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (environment, checkout_session_id, token_hash),
  unique (token_hash, public_reference),
  foreign key (appointment_id, profile_id, environment)
    references public.appointments(id,profile_id,environment) on delete restrict
);
alter table public.booking_receipt_capabilities_v3 enable row level security;
revoke all on public.booking_receipt_capabilities_v3 from public,anon,authenticated;

create or replace function public.prepare_booking_checkout_handoff_v3(
  p_payment_id uuid,p_lease_token uuid,p_fencing_token bigint,
  p_provider_expires_at timestamptz,p_handoff_expires_at timestamptz,p_nonce_hash text
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare p public.booking_payments%rowtype;a public.appointments%rowtype;
begin
  if p_nonce_hash !~ '^[a-f0-9]{64}$'
    or p_provider_expires_at < pg_catalog.clock_timestamp()+interval '30 minutes 30 seconds'
    or p_provider_expires_at > pg_catalog.clock_timestamp()+interval '32 minutes'
    or p_handoff_expires_at < p_provider_expires_at+interval '5 minutes'
    or p_handoff_expires_at > p_provider_expires_at+interval '5 minutes 5 seconds' then
    raise exception 'invalid booking handoff preparation' using errcode='22023';
  end if;
  select bp.* into strict p from public.booking_payments bp where bp.id=p_payment_id
    and bp.booking_contract_version=2 and bp.checkout_lease_token=p_lease_token
    and bp.checkout_fencing_token=p_fencing_token and bp.checkout_lease_expires_at>pg_catalog.clock_timestamp()
    for update;
  select * into strict a from public.appointments where id=p.appointment_id
    and profile_id=p.profile_id and environment=p.environment for share;
  update public.booking_payments set
    checkout_provider_expires_at=coalesce(checkout_provider_expires_at,p_provider_expires_at),
    confirmation_handoff_expires_at=coalesce(confirmation_handoff_expires_at,p_handoff_expires_at),
    confirmation_nonce_hash=coalesce(confirmation_nonce_hash,p_nonce_hash),
    updated_at=pg_catalog.clock_timestamp()
  where id=p.id and (checkout_provider_expires_at is null or checkout_provider_expires_at=p_provider_expires_at)
    and (confirmation_handoff_expires_at is null or confirmation_handoff_expires_at=p_handoff_expires_at)
    and (confirmation_nonce_hash is null or confirmation_nonce_hash=p_nonce_hash);
  if not found then raise exception 'booking handoff identity conflict' using errcode='23505';end if;
  return pg_catalog.jsonb_build_object('paymentId',p.id,'appointmentId',a.id,
    'reference',a.public_reference,'environment',a.environment,
    'providerExpiresAt',coalesce(p.checkout_provider_expires_at,p_provider_expires_at),
    'handoffExpiresAt',coalesce(p.confirmation_handoff_expires_at,p_handoff_expires_at));
end $body$;

create or replace function public.recover_booking_checkout_handoff_v3(
  p_appointment_id uuid,p_nonce_hash text
) returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare p public.booking_payments%rowtype;a public.appointments%rowtype;
begin
  if p_nonce_hash !~ '^[a-f0-9]{64}$' then return null;end if;
  select bp.* into p from public.booking_payments bp where bp.appointment_id=p_appointment_id
    and bp.booking_contract_version=2 and bp.confirmation_nonce_hash=p_nonce_hash
    and bp.confirmation_handoff_expires_at>pg_catalog.clock_timestamp();
  if p.id is null then return null;end if;
  select * into strict a from public.appointments where id=p.appointment_id
    and profile_id=p.profile_id and environment=p.environment;
  return pg_catalog.jsonb_build_object('paymentId',p.id,'appointmentId',a.id,
    'reference',a.public_reference,'environment',a.environment,'stripeAccountId',p.stripe_account_id,
    'checkoutSessionId',p.checkout_session_id,'checkoutExpiresAt',p.checkout_expires_at,
    'handoffExpiresAt',p.confirmation_handoff_expires_at,'paymentState',p.payment_state);
end $body$;

create or replace function public.issue_booking_confirmation_capability_v3(
  p_checkout_session_id text,p_token_hash text,p_nonce_hash text
) returns uuid language plpgsql security definer set search_path='' as $body$
declare p public.booking_payments%rowtype;a public.appointments%rowtype;cap uuid;
begin
  if p_checkout_session_id !~ '^cs_' or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_nonce_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid receipt authority' using errcode='22023';
  end if;
  select * into strict p from public.booking_payments where checkout_session_id=p_checkout_session_id
    and booking_contract_version=2 and confirmation_nonce_hash=p_nonce_hash
    and confirmation_handoff_expires_at>pg_catalog.clock_timestamp() for share;
  select * into strict a from public.appointments where id=p.appointment_id
    and profile_id=p.profile_id and environment=p.environment for share;
  insert into public.booking_receipt_capabilities_v3(
    appointment_id,profile_id,environment,checkout_session_id,public_reference,
    token_hash,issued_nonce_hash,expires_at
  ) values(p.appointment_id,p.profile_id,p.environment,p.checkout_session_id,a.public_reference,
    p_token_hash,p_nonce_hash,pg_catalog.clock_timestamp()+interval '24 hours')
  on conflict(environment,checkout_session_id,token_hash) do update set
    last_accessed_at=public.booking_receipt_capabilities_v3.last_accessed_at
  where public.booking_receipt_capabilities_v3.appointment_id=excluded.appointment_id
    and public.booking_receipt_capabilities_v3.public_reference=excluded.public_reference
    and public.booking_receipt_capabilities_v3.issued_nonce_hash=excluded.issued_nonce_hash
  returning id into cap;
  if cap is null then raise exception 'receipt authority conflict' using errcode='23505';end if;
  return cap;
end $body$;

create or replace function public.booking_confirmation_projection_v3(p_appointment_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare a public.appointments%rowtype;p public.booking_payments%rowtype;code text;terminal boolean:=false;prolonged boolean;
begin
  select * into strict a from public.appointments where id=p_appointment_id;
  select * into p from public.booking_payments where appointment_id=a.id
    and profile_id=a.profile_id and environment=a.environment;
  prolonged:=a.updated_at<pg_catalog.clock_timestamp()-interval '60 seconds';
  if a.refund_state='failed' then code:='refund_failed';terminal:=true;
  elsif a.refund_state='pending' and a.review_state='late_payment' then code:='late_payment_refund_pending';
  elsif a.refund_state='pending' then code:='refund_pending';
  elsif a.refund_state='succeeded' then code:='refund_succeeded';terminal:=true;
  elsif a.appointment_reason in('payment_expired','hold_expired') then code:='unpaid_expired';terminal:=true;
  elsif a.payment_state='failed' then code:='payment_failed';terminal:=true;
  elsif a.payment_state in('not_started','creating','pending') then
    code:=case when prolonged then 'payment_pending_prolonged' else 'payment_pending' end;
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
    'service',a.service_snapshot,'location',a.location_snapshot,
    'appointmentState',a.appointment_state,'appointmentReason',a.appointment_reason,
    'paymentState',a.payment_state,'refundState',a.refund_state,'calendarState',a.calendar_state,
    'reviewState',a.review_state,'reservationExpiresAt',a.reservation_expires_at,
    'confirmedAt',a.confirmed_at,'cancelledAt',a.cancelled_at,'updatedAt',a.updated_at,
    'checkoutSessionId',p.checkout_session_id,
    'statusCode',code,'terminal',terminal,'pollAfterMs',case when terminal then null else 2500 end,
    'automaticPollUntil',case when terminal then null else a.updated_at+interval '30 seconds' end
  );
end $body$;

create or replace function public.consume_booking_confirmation_capability_v3(
  p_token_hash text,p_reference uuid
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare c public.booking_receipt_capabilities_v3%rowtype;
begin
  select * into strict c from public.booking_receipt_capabilities_v3
    where token_hash=p_token_hash and public_reference=p_reference
      and expires_at>pg_catalog.clock_timestamp() for update;
  update public.booking_receipt_capabilities_v3 set
    first_accessed_at=coalesce(first_accessed_at,pg_catalog.clock_timestamp()),
    last_accessed_at=pg_catalog.clock_timestamp(),access_count=access_count+1 where id=c.id;
  return public.booking_confirmation_projection_v3(c.appointment_id);
end $body$;

revoke all on function public.prepare_booking_checkout_handoff_v3(uuid,uuid,bigint,timestamptz,timestamptz,text),
 public.recover_booking_checkout_handoff_v3(uuid,text),
 public.issue_booking_confirmation_capability_v3(text,text,text),
 public.booking_confirmation_projection_v3(uuid),
 public.consume_booking_confirmation_capability_v3(text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_booking_checkout_handoff_v3(uuid,uuid,bigint,timestamptz,timestamptz,text),
 public.recover_booking_checkout_handoff_v3(uuid,text),
 public.issue_booking_confirmation_capability_v3(text,text,text),
 public.consume_booking_confirmation_capability_v3(text,uuid) to service_role;

-- Retire the split handoff writers and old receipt consumers from runtime roles.
revoke execute on function public.set_booking_checkout_provider_deadline(uuid,uuid,bigint,timestamptz),
 public.bind_booking_confirmation_nonce(uuid,uuid,bigint,text),
 public.issue_booking_confirmation_capability(text,text,text),
 public.consume_booking_confirmation_capability(text,uuid) from service_role,booking_worker;

-- ---------------------------------------------------------------------------
-- One notification projection authority. The trigger is best-effort and cannot
-- abort an aggregate transition; the environment scanner repairs missed work.
-- ---------------------------------------------------------------------------
alter table public.booking_notifications
  add column if not exists source_event_key text,
  add column if not exists suppression_reason text,
  add column if not exists delivery_rank integer not null default 0,
  add column if not exists provider_destination text not null default 'resend',
  add column if not exists projected_at timestamptz not null default pg_catalog.clock_timestamp();
update public.booking_notifications set source_event_key=idempotency_key where source_event_key is null;
alter table public.booking_notifications alter column source_event_key set not null;
alter table public.booking_notifications alter column recipient_email drop not null;
do $drop$ declare c text;begin for c in select conname from pg_catalog.pg_constraint where conrelid='public.booking_notifications'::regclass and contype='c'and(pg_catalog.pg_get_constraintdef(oid)like'%recipient_email%'or pg_catalog.pg_get_constraintdef(oid)like'%state%')loop execute pg_catalog.format('alter table public.booking_notifications drop constraint %I',c);end loop;end $drop$;
update public.booking_notifications set recipient_email=null,state='suppressed',suppression_reason='legacy_recipient_missing_or_invalid',lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
where recipient_email is not null and not(pg_catalog.length(recipient_email)between 3 and 254 and recipient_email~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')and provider_message_id is null;
do $drop$ declare c text;begin for c in select conname from pg_catalog.pg_constraint where conrelid='public.booking_notifications'::regclass and contype='c'and pg_catalog.pg_get_constraintdef(oid)like'%recipient_email%'loop execute pg_catalog.format('alter table public.booking_notifications drop constraint %I',c);end loop;end $drop$;
alter table public.booking_notifications add constraint booking_notifications_recipient_email_v3_check
  check(recipient_email is null or (pg_catalog.length(recipient_email) between 3 and 254
    and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'));
do $drop$ declare c text;begin for c in select conname from pg_catalog.pg_constraint where conrelid='public.booking_notifications'::regclass and contype='c'and pg_catalog.pg_get_constraintdef(oid)like'%state%'loop execute pg_catalog.format('alter table public.booking_notifications drop constraint %I',c);end loop;end $drop$;
alter table public.booking_notifications add constraint booking_notifications_state_v3_check check(state in(
  'pending','processing','accepted','delivered','delivery_delayed','bounced','complained','retry','failed','suppressed'));
do $drop$ declare c text;begin for c in select conname from pg_catalog.pg_constraint where conrelid='public.booking_notifications'::regclass and contype='c'and pg_catalog.pg_get_constraintdef(oid)like'%notification_type%'loop execute pg_catalog.format('alter table public.booking_notifications drop constraint %I',c);end loop;end $drop$;
alter table public.booking_notifications add constraint booking_notifications_notification_type_v3_check check(notification_type in(
  'confirmed','cancelled','refund_pending','refund_succeeded','refund_failed','late_payment','calendar_failed','calendar_repaired'));
create unique index if not exists booking_notifications_source_event_v3_uq
  on public.booking_notifications(appointment_id,environment,notification_type,audience,source_event_key);

alter table public.booking_notification_delivery_events
  add column if not exists environment text check(environment in('test','live')),
  add column if not exists delivery_rank integer not null default 0;

create or replace function public.booking_notification_email_valid_v3(p_email text)
returns boolean language sql immutable set search_path='' as $body$
 select p_email is not null and pg_catalog.length(p_email) between 3 and 254
   and p_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
$body$;

create or replace function public.project_booking_notifications_v3(p_appointment_id uuid)
returns integer language plpgsql security definer set search_path='' as $body$
declare a public.appointments%rowtype;p public.booking_payments%rowtype;customer_email text;contractor_email text;
 event_row record;aud text;recipient text;inserted integer:=0;occurrence bigint;valid boolean;
begin
  select * into strict a from public.appointments where id=p_appointment_id for share;
  select * into p from public.booking_payments where appointment_id=a.id
    and profile_id=a.profile_id and environment=a.environment;
  customer_email:=pg_catalog.lower(pg_catalog.btrim(a.customer_snapshot->>'email'));
  select pg_catalog.lower(pg_catalog.btrim(email)) into contractor_email from public.profiles
    where id=a.profile_id and environment=a.environment;
  for event_row in
    select * from (values
      ('confirmed'::text,'confirmed:0'::text,(a.confirmed_at is not null)),
      ('cancelled','cancelled:0',(a.cancelled_at is not null and a.appointment_reason<>'late_payment_arbitration')),
      ('refund_pending','refund:'||coalesce(p.refund_generation,0)::text||':pending',(p.refund_requested_at is not null and a.appointment_reason<>'late_payment_arbitration')),
      ('refund_succeeded','refund:'||coalesce(p.refund_generation,0)::text||':succeeded',(a.refund_state='succeeded')),
      ('refund_failed','refund:'||coalesce(p.refund_generation,0)::text||':failed',(a.refund_state='failed')),
      ('late_payment','late:'||greatest(a.refund_generation,coalesce(p.refund_generation,0))::text,
        (a.appointment_reason in('late_payment_recovered','late_payment_refund'))),
      ('calendar_failed','calendar:'||a.calendar_generation::text||':failed',(a.calendar_state in('create_failed','cancel_failed'))),
      ('calendar_repaired','calendar:'||a.calendar_generation::text||':repaired',
        (a.calendar_state in('created','cancelled') and exists(select 1 from public.booking_notifications n
          where n.appointment_id=a.id and n.environment=a.environment and n.notification_type='calendar_failed')))
    ) as events(notification_type,source_event_key,eligible)
  loop
    if not event_row.eligible then continue;end if;
    occurrence:=case
      when event_row.notification_type like 'refund_%' then coalesce(p.refund_generation,0)
      when event_row.notification_type='late_payment' then greatest(a.refund_generation,coalesce(p.refund_generation,0))
      when event_row.notification_type like 'calendar_%' then a.calendar_generation
      else 0 end;
    foreach aud in array array['customer','contractor'] loop
      recipient:=case when aud='customer' then customer_email else contractor_email end;
      valid:=public.booking_notification_email_valid_v3(recipient);
      insert into public.booking_notifications(
        appointment_id,profile_id,environment,notification_type,audience,recipient_email,
        idempotency_key,occurrence_version,source_event_key,state,suppression_reason
      ) values(a.id,a.profile_id,a.environment,event_row.notification_type,aud,
        case when valid then recipient else null end,
        'booking-notify:v3:'||a.environment||':'||a.id||':'||event_row.source_event_key||':'||aud,
        occurrence,event_row.source_event_key,case when valid then'pending'else'suppressed'end,
        case when valid then null else'recipient_missing_or_invalid'end)
      on conflict(appointment_id,environment,notification_type,audience,source_event_key) do update
       set recipient_email=case when public.booking_notification_email_valid_v3(excluded.recipient_email)and booking_notifications.state='suppressed'and booking_notifications.provider_message_id is null and booking_notifications.suppression_reason in('recipient_missing_or_invalid','legacy_recipient_missing_or_invalid')then excluded.recipient_email else booking_notifications.recipient_email end,state=case when public.booking_notification_email_valid_v3(excluded.recipient_email)and booking_notifications.state='suppressed'and booking_notifications.provider_message_id is null and booking_notifications.suppression_reason in('recipient_missing_or_invalid','legacy_recipient_missing_or_invalid')then'pending'else booking_notifications.state end,
        suppression_reason=case when public.booking_notification_email_valid_v3(excluded.recipient_email)and booking_notifications.state='suppressed'and booking_notifications.provider_message_id is null and booking_notifications.suppression_reason in('recipient_missing_or_invalid','legacy_recipient_missing_or_invalid')then null else booking_notifications.suppression_reason end,
        next_attempt_at=case when public.booking_notification_email_valid_v3(excluded.recipient_email)and booking_notifications.state='suppressed'and booking_notifications.provider_message_id is null and booking_notifications.suppression_reason in('recipient_missing_or_invalid','legacy_recipient_missing_or_invalid')then pg_catalog.clock_timestamp()else booking_notifications.next_attempt_at end,
        updated_at=pg_catalog.clock_timestamp();
      if found then inserted:=inserted+1;end if;
    end loop;
  end loop;
  return inserted;
end $body$;

create table if not exists public.booking_notification_projection_repairs_v3(
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  profile_id uuid not null,environment text not null check(environment in('test','live')),
  failed_at timestamptz not null default pg_catalog.clock_timestamp(),attempts integer not null default 1,
  sqlstate text not null,safe_error text not null
);
alter table public.booking_notification_projection_repairs_v3 enable row level security;
revoke all on public.booking_notification_projection_repairs_v3 from public,anon,authenticated,service_role,booking_worker;
create or replace function public.try_project_booking_notifications_v3()
returns trigger language plpgsql security definer set search_path='' as $body$
begin
  begin
    perform public.project_booking_notifications_v3(new.id);
    delete from public.booking_notification_projection_repairs_v3 where appointment_id=new.id;
  exception when others then
    insert into public.booking_notification_projection_repairs_v3(appointment_id,profile_id,environment,sqlstate,safe_error)
    values(new.id,new.profile_id,new.environment,sqlstate,left(sqlerrm,240))
    on conflict(appointment_id)do update set failed_at=excluded.failed_at,attempts=public.booking_notification_projection_repairs_v3.attempts+1,sqlstate=excluded.sqlstate,safe_error=excluded.safe_error;
  end;
  return new;
end $body$;
create or replace function public.try_project_booking_payment_notifications_v3()
returns trigger language plpgsql security definer set search_path=''as $body$
begin
 begin
  perform public.project_booking_notifications_v3(new.appointment_id);
  delete from public.booking_notification_projection_repairs_v3 where appointment_id=new.appointment_id;
 exception when others then
  insert into public.booking_notification_projection_repairs_v3(appointment_id,profile_id,environment,sqlstate,safe_error)values(new.appointment_id,new.profile_id,new.environment,sqlstate,left(sqlerrm,240))on conflict(appointment_id)do update set failed_at=excluded.failed_at,attempts=public.booking_notification_projection_repairs_v3.attempts+1,sqlstate=excluded.sqlstate,safe_error=excluded.safe_error;
 end;return new;
end $body$;
drop trigger if exists booking_payments_project_notifications_v3 on public.booking_payments;
create trigger booking_payments_project_notifications_v3 after update on public.booking_payments for each row when(old.refund_requested_at is distinct from new.refund_requested_at or old.refund_generation is distinct from new.refund_generation or old.refund_state is distinct from new.refund_state)execute function public.try_project_booking_payment_notifications_v3();

drop trigger if exists appointments_enqueue_booking_notifications on public.appointments;
drop trigger if exists appointments_project_booking_notifications_v3 on public.appointments;
create trigger appointments_project_booking_notifications_v3 after update on public.appointments
for each row when (
  old.appointment_state is distinct from new.appointment_state or
  old.payment_state is distinct from new.payment_state or
  old.refund_state is distinct from new.refund_state or
  old.calendar_state is distinct from new.calendar_state or
  old.review_state is distinct from new.review_state or
  old.appointment_reason is distinct from new.appointment_reason
) execute function public.try_project_booking_notifications_v3();

-- Legacy notify rows remain evidence; claim predicates exclude them instead of falsifying delivery success.
update public.integration_outbox set lease_token=null,lease_expires_at=null,
 next_attempt_at='infinity'::timestamptz,safe_error='retired: booking_notifications v3 is the sole notification authority'
where command_type='notify' and state in('pending','processing','failed');

revoke all on function public.claim_due_booking_outbox(uuid,integer)from public,anon,authenticated,service_role,booking_worker;
drop function public.claim_due_booking_outbox(uuid,integer);
create or replace function public.claim_due_booking_outbox(p_environment text,p_lease_token uuid,p_limit integer default 25)
returns setof public.integration_outbox language plpgsql security definer set search_path=''as $body$
begin
 if p_environment not in('test','live')or p_lease_token is null then raise exception'environment and lease required'using errcode='22023';end if;
 return query with due as(
  select o.id from public.integration_outbox o join public.appointments a on a.id=o.appointment_id and a.profile_id=o.profile_id and a.environment=o.environment join public.booking_payments p on p.appointment_id=a.id and p.profile_id=a.profile_id and p.environment=a.environment
  where o.environment=p_environment and public.booking_cutover_enabled(o.profile_id,o.environment)and o.effect_contract_version=2 and o.command_type='refund'and o.state in('pending','failed','processing')and o.terminal_at is null and o.next_attempt_at<=pg_catalog.clock_timestamp()and(o.lease_expires_at is null or o.lease_expires_at<=pg_catalog.clock_timestamp())and o.effect_generation=a.refund_generation and o.effect_generation=p.refund_generation and a.refund_state='pending'and p.refund_state='pending'and p.amount_paid_minor>p.amount_refunded_minor
  order by o.next_attempt_at,o.id for update of o skip locked limit greatest(1,least(coalesce(p_limit,25),100))
 )update public.integration_outbox o set state='processing',attempts=o.attempts+1,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval'2 minutes',fencing_token=o.fencing_token+1 from due where o.id=due.id returning o.*;
end $body$;

-- Core workers preserve one environment through hold/session expiry and renew provider leases.
create or replace function public.expire_due_booking_holds_v3(p_environment text,p_limit integer default 100)
returns integer language plpgsql security definer set search_path='' as $body$
declare candidate uuid;expired integer:=0;
begin
 if p_environment not in('test','live')then raise exception'invalid booking expiry environment'using errcode='22023';end if;
 for candidate in select a.id from public.appointments a where a.environment=p_environment and public.booking_cutover_enabled(a.profile_id,a.environment)and a.booking_contract_version=2 and a.appointment_state='held'and a.payment_state='not_started'and a.reservation_expires_at<=pg_catalog.clock_timestamp()order by a.reservation_expires_at,a.id for update skip locked limit greatest(1,least(coalesce(p_limit,100),500))loop
  update public.appointments set appointment_state='cancelled',appointment_reason='hold_expired',cancelled_at=pg_catalog.clock_timestamp(),version=version+1,updated_at=pg_catalog.clock_timestamp()where id=candidate and environment=p_environment and appointment_state='held'and payment_state='not_started'and reservation_expires_at<=pg_catalog.clock_timestamp();expired:=expired+case when found then 1 else 0 end;
 end loop;return expired;
end $body$;

alter table public.booking_payments add column if not exists session_expiry_attempts integer not null default 0,add column if not exists session_expiry_next_attempt_at timestamptz not null default pg_catalog.clock_timestamp();
alter table public.booking_payments drop constraint if exists booking_payments_session_expiry_attempts_ck;
alter table public.booking_payments add constraint booking_payments_session_expiry_attempts_ck check(session_expiry_attempts>=0)not valid;
alter table public.booking_payments validate constraint booking_payments_session_expiry_attempts_ck;

create or replace function public.expire_abandoned_booking_checkout_creations_v3(p_environment text,p_limit integer default 100)
returns integer language plpgsql security definer set search_path=''as $body$
declare candidate record;expired integer:=0;guard_token text:=pg_catalog.gen_random_uuid()::text;
begin
 if p_environment not in('test','live')then raise exception'invalid abandoned checkout environment'using errcode='22023';end if;
 for candidate in select p.id payment_id,a.id appointment_id from public.booking_payments p join public.appointments a on a.id=p.appointment_id and a.profile_id=p.profile_id and a.environment=p.environment where p.environment=p_environment and p.booking_contract_version=2 and a.booking_contract_version=2 and public.booking_cutover_enabled(p.profile_id,p.environment)and p.payment_state='creating'and p.checkout_session_id is null and p.checkout_provider_expires_at<=pg_catalog.clock_timestamp()and a.appointment_state='held'and a.payment_state='creating'order by p.checkout_provider_expires_at,p.id for update of p,a skip locked limit greatest(1,least(coalesce(p_limit,100),500))loop
  perform pg_catalog.set_config('obra.booking_financial_guard_token_v3',guard_token,true);perform pg_catalog.set_config('obra.booking_financial_reducer_v3',guard_token,true);
  update public.booking_payments set payment_state='failed',checkout_last_error='Checkout creation reconciliation deadline elapsed without provider identity',checkout_lease_token=null,checkout_lease_expires_at=null,failed_at=coalesce(failed_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp()where id=candidate.payment_id and payment_state='creating'and checkout_session_id is null;
  update public.appointments set appointment_state='cancelled',appointment_reason='checkout_creation_abandoned',payment_state='failed',cancelled_at=coalesce(cancelled_at,pg_catalog.clock_timestamp()),version=version+1,updated_at=pg_catalog.clock_timestamp()where id=candidate.appointment_id and appointment_state='held'and payment_state='creating';expired:=expired+case when found then 1 else 0 end;
 end loop;perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);return expired;
exception when others then perform pg_catalog.set_config('obra.booking_financial_reducer_v3','',true);perform pg_catalog.set_config('obra.booking_financial_guard_token_v3','',true);raise;
end $body$;

create or replace function public.claim_due_booking_session_expiries_v3(p_environment text,p_lease_token uuid,p_limit integer default 10)
returns setof public.booking_payments language plpgsql security definer set search_path='' as $body$
begin
 if p_environment not in('test','live')or p_lease_token is null then raise exception'invalid booking session expiry claim'using errcode='22023';end if;
 return query with due as(select p.id from public.booking_payments p join public.appointments a on a.id=p.appointment_id and a.profile_id=p.profile_id and a.environment=p.environment where p.environment=p_environment and p.booking_contract_version=2 and a.booking_contract_version=2 and public.booking_cutover_enabled(p.profile_id,p.environment)and p.checkout_session_id is not null and((a.appointment_state='payment_pending'and a.reservation_expires_at<=pg_catalog.clock_timestamp()and p.payment_state='pending')or(a.appointment_state='cancelled'and a.reservation_expires_at<=pg_catalog.clock_timestamp()and p.payment_state in('creating','pending')))and p.session_expiry_next_attempt_at<=pg_catalog.clock_timestamp()and(p.checkout_lease_expires_at is null or p.checkout_lease_expires_at<=pg_catalog.clock_timestamp())order by a.reservation_expires_at,p.id for update of p skip locked limit greatest(1,least(coalesce(p_limit,10),25)))update public.booking_payments p set checkout_lease_token=p_lease_token,checkout_lease_expires_at=pg_catalog.clock_timestamp()+interval'5 minutes',checkout_fencing_token=p.checkout_fencing_token+1,session_expiry_attempts=p.session_expiry_attempts+1,updated_at=pg_catalog.clock_timestamp()from due where p.id=due.id returning p.*;
end $body$;

create or replace function public.renew_booking_session_expiry_v3(p_payment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_lease_seconds integer default 300)
returns boolean language plpgsql security definer set search_path='' as $body$
begin
 if p_lease_token is null or p_lease_seconds not between 30 and 600 then raise exception'invalid session expiry lease renewal'using errcode='22023';end if;
 update public.booking_payments set checkout_lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds)where id=p_payment_id and checkout_lease_token=p_lease_token and checkout_fencing_token=p_fencing_token and checkout_lease_expires_at>pg_catalog.clock_timestamp();return found;
end $body$;

create or replace function public.fail_booking_session_expiry_v3(p_payment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_retryable boolean,p_safe_error text)
returns boolean language plpgsql security definer set search_path='' as $body$
declare p public.booking_payments%rowtype;
begin
 if p_lease_token is null or nullif(pg_catalog.btrim(p_safe_error),'')is null then raise exception'invalid session expiry failure'using errcode='22023';end if;
 update public.booking_payments set checkout_last_error=left(p_safe_error,240),checkout_lease_token=null,checkout_lease_expires_at=null,session_expiry_next_attempt_at=case when p_retryable then pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,15*(2^least(session_expiry_attempts,8))::integer))else'infinity'::timestamptz end,updated_at=pg_catalog.clock_timestamp()where id=p_payment_id and checkout_lease_token=p_lease_token and checkout_fencing_token=p_fencing_token returning*into p;
 if p.id is null then return false;end if;
 if not p_retryable then update public.appointments set review_state='provider_inconsistency',version=version+1,updated_at=pg_catalog.clock_timestamp()where id=p.appointment_id and payment_state<>'paid';end if;return true;
end $body$;

create or replace function public.renew_booking_refund_command_v3(p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_lease_seconds integer default 120)
returns boolean language plpgsql security definer set search_path='' as $body$
begin
 if p_lease_token is null or p_lease_seconds not between 30 and 300 then raise exception'invalid refund lease renewal'using errcode='22023';end if;
 update public.integration_outbox set lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds)where id=p_command_id and command_type='refund'and state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();return found;
end $body$;

create or replace function public.renew_booking_worker_family_v3(p_environment text,p_family text,p_lease_token uuid,p_fencing_token bigint,p_lease_seconds integer default 55)
returns boolean language plpgsql security definer set search_path='' as $body$
begin
 if p_environment not in('test','live')or p_family not in('core','notifications','attachment_scan','attachment_cleanup')or p_lease_token is null or p_lease_seconds not between 10 and 300 then raise exception'invalid worker family renewal'using errcode='22023';end if;
 update public.booking_worker_family_leases_v3 set lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds)where environment=p_environment and family=p_family and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();return found;
end $body$;

create or replace function public.reject_legacy_booking_notify_outbox_v3()
returns trigger language plpgsql set search_path='' as $body$
begin
  if tg_op='INSERT' then return null;end if;
  if new.state in('pending','processing','failed') then
    raise exception 'legacy notification outbox authority is retired' using errcode='23514';
  end if;
  return new;
end $body$;
drop trigger if exists integration_outbox_retire_notify_v3 on public.integration_outbox;
create trigger integration_outbox_retire_notify_v3 before insert or update on public.integration_outbox
for each row when (new.command_type='notify') execute function public.reject_legacy_booking_notify_outbox_v3();

create or replace function public.reconcile_booking_notification_projection_v3(
  p_environment text,p_limit integer default 100
) returns integer language plpgsql security definer set search_path='' as $body$
declare candidate record;projected integer:=0;
begin
  if p_environment not in('test','live') or p_limit not between 1 and 500 then
    raise exception 'invalid notification projection scan' using errcode='22023';end if;
  for candidate in select a.id from public.appointments a
    left join public.booking_payments p on p.appointment_id=a.id and p.profile_id=a.profile_id and p.environment=a.environment
    where a.environment=p_environment and (
      exists(select 1 from public.booking_notification_projection_repairs_v3 r where r.appointment_id=a.id and r.environment=a.environment) or
      exists(select 1 from public.booking_notifications n where n.appointment_id=a.id and n.environment=a.environment and n.state='suppressed'and n.provider_message_id is null and n.suppression_reason in('recipient_missing_or_invalid','legacy_recipient_missing_or_invalid')and((n.audience='contractor'and public.booking_notification_email_valid_v3((select pr.email from public.profiles pr where pr.id=a.profile_id and pr.environment=a.environment)))or(n.audience='customer'and public.booking_notification_email_valid_v3(a.customer_snapshot->>'email')))) or
      (a.confirmed_at is not null and not exists(select 1 from public.booking_notifications n where n.appointment_id=a.id and n.environment=a.environment and n.notification_type='confirmed')) or
      (a.cancelled_at is not null and a.appointment_reason<>'late_payment_arbitration' and not exists(select 1 from public.booking_notifications n where n.appointment_id=a.id and n.environment=a.environment and n.notification_type='cancelled')) or
      (p.refund_requested_at is not null and a.appointment_reason<>'late_payment_arbitration' and not exists(select 1 from public.booking_notifications n where n.appointment_id=a.id and n.environment=a.environment and n.notification_type='refund_pending' and n.source_event_key='refund:'||p.refund_generation::text||':pending')) or
      (a.refund_state in('succeeded','failed') and not exists(select 1 from public.booking_notifications n where n.appointment_id=a.id and n.environment=a.environment and n.notification_type='refund_'||a.refund_state and n.source_event_key='refund:'||p.refund_generation::text||':'||a.refund_state)) or
      (a.appointment_reason in('late_payment_recovered','late_payment_refund') and not exists(select 1 from public.booking_notifications n where n.appointment_id=a.id and n.environment=a.environment and n.notification_type='late_payment' and n.source_event_key='late:'||greatest(a.refund_generation,coalesce(p.refund_generation,0))::text)) or
      (a.calendar_state in('create_failed','cancel_failed') and not exists(select 1 from public.booking_notifications n where n.appointment_id=a.id and n.environment=a.environment and n.notification_type='calendar_failed' and n.source_event_key='calendar:'||a.calendar_generation::text||':failed')) or
      (a.calendar_state in('created','cancelled') and exists(select 1 from public.booking_notifications f where f.appointment_id=a.id and f.environment=a.environment and f.notification_type='calendar_failed') and not exists(select 1 from public.booking_notifications n where n.appointment_id=a.id and n.environment=a.environment and n.notification_type='calendar_repaired' and n.source_event_key='calendar:'||a.calendar_generation::text||':repaired'))
    ) order by a.updated_at,a.id limit p_limit
  loop
    projected:=projected+public.project_booking_notifications_v3(candidate.id);
    delete from public.booking_notification_projection_repairs_v3 where appointment_id=candidate.id;
  end loop;
  return projected;
end $body$;

create or replace function public.booking_notification_event_current_v4(p_notification_id uuid)
returns boolean language sql stable security definer set search_path='' as $body$
 select exists(
  select 1 from public.booking_notifications n
  join public.appointments a on a.id=n.appointment_id and a.profile_id=n.profile_id and a.environment=n.environment
  left join public.booking_payments p on p.appointment_id=a.id and p.profile_id=a.profile_id and p.environment=a.environment
  where n.id=p_notification_id and case n.notification_type
   when'confirmed'then a.confirmed_at is not null and n.source_event_key='confirmed:0'
   when'cancelled'then a.cancelled_at is not null and a.appointment_reason<>'late_payment_arbitration'and n.source_event_key='cancelled:0'
   when'refund_pending'then p.refund_requested_at is not null and a.appointment_reason<>'late_payment_arbitration'and n.source_event_key='refund:'||p.refund_generation::text||':pending'
   when'refund_succeeded'then a.refund_state='succeeded'and n.source_event_key='refund:'||p.refund_generation::text||':succeeded'
   when'refund_failed'then a.refund_state='failed'and n.source_event_key='refund:'||p.refund_generation::text||':failed'
   when'late_payment'then a.appointment_reason in('late_payment_recovered','late_payment_refund')and n.source_event_key='late:'||greatest(a.refund_generation,coalesce(p.refund_generation,0))::text
   when'calendar_failed'then a.calendar_state in('create_failed','cancel_failed')and n.source_event_key='calendar:'||a.calendar_generation::text||':failed'
   when'calendar_repaired'then a.calendar_state in('created','cancelled')and n.source_event_key='calendar:'||a.calendar_generation::text||':repaired'
   else false end
 )
$body$;

create or replace function public.suppress_noncanonical_booking_notifications_v4(p_environment text,p_limit integer default 500)
returns integer language plpgsql security definer set search_path='' as $body$
declare changed integer;
begin
 if p_environment not in('test','live')then raise exception'invalid notification suppression environment'using errcode='22023';end if;
 update public.booking_notifications n set state='suppressed',suppression_reason='noncanonical_current_state',lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
 where n.id in(select c.id from public.booking_notifications c where c.environment=p_environment and c.state in('pending','retry','processing')and(c.state<>'processing'or c.lease_expires_at<=pg_catalog.clock_timestamp())and not public.booking_notification_event_current_v4(c.id)order by c.created_at,c.id limit greatest(1,least(coalesce(p_limit,500),1000)))
 and n.provider_message_id is null;get diagnostics changed=row_count;return changed;
end $body$;

create or replace function public.claim_due_booking_notifications_v3(
  p_environment text,p_lease_token uuid,p_limit integer default 25
) returns setof public.booking_notifications language plpgsql security definer set search_path='' as $body$
begin
  if p_environment not in('test','live') or p_lease_token is null or p_limit not between 1 and 100 then
    raise exception 'invalid notification claim' using errcode='22023';end if;
  perform public.suppress_noncanonical_booking_notifications_v4(p_environment,1000);
  return query with due as(
    select n.id from public.booking_notifications n where n.environment=p_environment and public.booking_notification_event_current_v4(n.id) and n.recipient_email is not null
      and ((n.state in('pending','retry') and n.next_attempt_at<=pg_catalog.clock_timestamp())
        or(n.state='processing' and n.lease_expires_at<=pg_catalog.clock_timestamp()))
    order by n.next_attempt_at,n.created_at for update skip locked limit p_limit
  ) update public.booking_notifications n set state='processing',attempts=n.attempts+1,
    lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',
    fencing_token=n.fencing_token+1,updated_at=pg_catalog.clock_timestamp()
  from due where n.id=due.id returning n.*;
end $body$;

create or replace function public.get_booking_notification_context_v3(
  p_notification_id uuid,p_environment text,p_lease_token uuid,p_fencing_token bigint
) returns jsonb language sql stable security definer set search_path='' as $body$
 select pg_catalog.jsonb_build_object('notification',pg_catalog.to_jsonb(n),'appointment',pg_catalog.to_jsonb(a))
 from public.booking_notifications n join public.appointments a
   on a.id=n.appointment_id and a.profile_id=n.profile_id and a.environment=n.environment
 where n.id=p_notification_id and n.environment=p_environment and n.state='processing'
   and n.lease_token=p_lease_token and n.fencing_token=p_fencing_token
   and n.lease_expires_at>pg_catalog.clock_timestamp() and n.recipient_email is not null
   and public.booking_notification_event_current_v4(n.id)
$body$;

create or replace function public.reduce_booking_notification_delivery_v3(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path='' as $body$
declare chosen public.booking_notification_delivery_events%rowtype;next_state text;
begin
  select e.* into chosen from public.booking_notification_delivery_events e
    join public.booking_notifications n on n.provider_message_id=e.provider_message_id
    where n.id=p_notification_id and (e.environment is null or e.environment=n.environment)
    order by e.delivery_rank desc,e.occurred_at desc,e.provider_event_id desc limit 1;
  if chosen.provider_event_id is null then return false;end if;
  next_state:=case chosen.event_type when'email.complained'then'complained'
    when'email.bounced'then'bounced' when'email.failed'then'failed'
    when'email.delivered'then'delivered' when'email.delivery_delayed'then'delivery_delayed' end;
  update public.booking_notifications set state=next_state,delivery_rank=chosen.delivery_rank,
    provider_event_id=chosen.provider_event_id,last_provider_event_at=chosen.occurred_at,
    delivered_at=case when next_state='delivered'then chosen.occurred_at else delivered_at end,
    failed_at=case when next_state in('failed','bounced','complained')then chosen.occurred_at else failed_at end,
    updated_at=pg_catalog.clock_timestamp()
  where id=p_notification_id and chosen.delivery_rank>=delivery_rank;
  return found;
end $body$;

create or replace function public.complete_booking_notification_v3(
  p_notification_id uuid,p_environment text,p_lease_token uuid,p_fencing_token bigint,
  p_provider_destination text,p_provider_message_id text
) returns boolean language plpgsql security definer set search_path='' as $body$
begin
  if p_environment not in('test','live') or p_provider_destination<>'resend'
    or p_provider_message_id!~'^[[:alnum:]_-]{8,200}$' then
    raise exception 'invalid notification provider settlement' using errcode='22023';end if;
  update public.booking_notifications set state='accepted',provider_destination=p_provider_destination,
    provider_message_id=p_provider_message_id,accepted_at=coalesce(accepted_at,pg_catalog.clock_timestamp()),
    last_error=null,lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
  where id=p_notification_id and environment=p_environment and state='processing'
    and lease_token=p_lease_token and fencing_token=p_fencing_token
    and lease_expires_at>pg_catalog.clock_timestamp()
    and(provider_message_id is null or provider_message_id=p_provider_message_id);
  if not found then raise exception 'stale notification settlement' using errcode='40001';end if;
  update public.booking_notification_delivery_events set environment=p_environment
    where provider_message_id=p_provider_message_id and environment is null;
  perform public.reduce_booking_notification_delivery_v3(p_notification_id);
  return true;
end $body$;

create table if not exists public.booking_notification_delivery_review_v3(
 notification_id uuid primary key references public.booking_notifications(id)on delete restrict,
 appointment_id uuid not null,profile_id uuid not null,environment text not null check(environment in('test','live')),
 reason_code text not null,safe_error text not null,attempts integer not null,queued_at timestamptz not null default pg_catalog.clock_timestamp(),resolved_at timestamptz
);
alter table public.booking_notification_delivery_review_v3 enable row level security;
revoke all on public.booking_notification_delivery_review_v3 from public,anon,authenticated,service_role,booking_worker;

create or replace function public.fail_booking_notification_v3(
  p_notification_id uuid,p_environment text,p_lease_token uuid,p_fencing_token bigint,
  p_retryable boolean,p_safe_error text
) returns boolean language plpgsql security definer set search_path='' as $body$
declare n public.booking_notifications%rowtype;
begin
  update public.booking_notifications set state=case when p_retryable and attempts<8 then'retry'else'failed'end,
    next_attempt_at=case when p_retryable and attempts<8 then pg_catalog.clock_timestamp()
      +pg_catalog.make_interval(secs=>least(300,pg_catalog.power(2,least(attempts,8))::integer))else'infinity'::timestamptz end,
    last_error=left(coalesce(p_safe_error,'Booking notification failed'),240),
    failed_at=case when not p_retryable or attempts>=8 then pg_catalog.clock_timestamp()else failed_at end,
    lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
  where id=p_notification_id and environment=p_environment and state='processing'
    and lease_token=p_lease_token and fencing_token=p_fencing_token
    and lease_expires_at>pg_catalog.clock_timestamp()returning*into n;
  if n.id is null then raise exception 'stale notification failure' using errcode='40001';end if;
  if n.state='failed'then insert into public.booking_notification_delivery_review_v3(notification_id,appointment_id,profile_id,environment,reason_code,safe_error,attempts)values(n.id,n.appointment_id,n.profile_id,n.environment,case when p_retryable then'retry_exhausted'else'permanent_delivery_failure'end,left(coalesce(p_safe_error,'Booking notification failed'),240),n.attempts)on conflict(notification_id)do update set reason_code=excluded.reason_code,safe_error=excluded.safe_error,attempts=excluded.attempts,queued_at=pg_catalog.clock_timestamp(),resolved_at=null;end if;return true;
end $body$;

create or replace function public.ingest_booking_notification_delivery(
  p_provider_event_id text,p_provider_message_id text,p_event_type text,p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $body$
declare rank_value integer;matched_environment text;matched_id uuid;
begin
  rank_value:=case p_event_type when 'email.delivery_delayed' then 10 when 'email.delivered' then 20
    when 'email.failed' then 30 when 'email.bounced' then 40 when 'email.complained' then 50 else null end;
  if rank_value is null or coalesce(p_provider_event_id,'')='' or p_occurred_at is null then
    raise exception 'unsupported notification delivery event' using errcode='22023';end if;
  select n.environment,n.id into matched_environment,matched_id from public.booking_notifications n
    where n.provider_destination='resend' and n.provider_message_id=p_provider_message_id;
  insert into public.booking_notification_delivery_events(
    provider_event_id,provider_message_id,event_type,occurred_at,environment,delivery_rank
  ) values(p_provider_event_id,p_provider_message_id,p_event_type,p_occurred_at,matched_environment,rank_value)
  on conflict(provider_event_id) do nothing;
  if matched_id is not null then perform public.reduce_booking_notification_delivery_v3(matched_id);end if;
  return true;
end $body$;

revoke all on function public.booking_notification_email_valid_v3(text),
 public.project_booking_notifications_v3(uuid),public.try_project_booking_notifications_v3(),
 public.reconcile_booking_notification_projection_v3(text,integer),
 public.claim_due_booking_notifications_v3(text,uuid,integer),
 public.get_booking_notification_context_v3(uuid,text,uuid,bigint),
 public.reduce_booking_notification_delivery_v3(uuid),
 public.complete_booking_notification_v3(uuid,text,uuid,bigint,text,text),
 public.fail_booking_notification_v3(uuid,text,uuid,bigint,boolean,text) from public,anon,authenticated;
revoke execute on function public.enqueue_booking_notification(uuid,text),
 public.claim_due_booking_notifications(uuid,integer),public.get_booking_notification_context(uuid),
 public.complete_booking_notification(uuid,uuid,bigint,text),
 public.fail_booking_notification(uuid,uuid,bigint,boolean,text) from service_role,booking_worker;
grant execute on function public.project_booking_notifications_v3(uuid),
 public.reconcile_booking_notification_projection_v3(text,integer),
 public.claim_due_booking_notifications_v3(text,uuid,integer),
 public.get_booking_notification_context_v3(uuid,text,uuid,bigint),
 public.complete_booking_notification_v3(uuid,text,uuid,bigint,text,text),
 public.fail_booking_notification_v3(uuid,text,uuid,bigint,boolean,text) to booking_worker;
grant execute on function public.ingest_booking_notification_delivery(text,text,text,timestamptz) to service_role;
-- Preserve binary compatibility for older calendar reducers while routing all projection through v3.
create or replace function public.enqueue_booking_notification(p_appointment_id uuid,p_notification_type text)returns integer language plpgsql security definer set search_path=''as $body$begin if p_notification_type not in('confirmed','cancelled','refund_pending','refund_succeeded','refund_failed','late_payment','calendar_failed','calendar_repaired')then raise exception'unsupported booking notification type'using errcode='22023';end if;return public.project_booking_notifications_v3(p_appointment_id);end $body$;
revoke all on function public.enqueue_booking_notification(uuid,text)from public,anon,authenticated,service_role,booking_worker;

-- ---------------------------------------------------------------------------
-- Scoped attachment upload grants and immutable object generations.
-- ---------------------------------------------------------------------------
create table if not exists public.booking_attachment_security_v3(
  environment text not null check(environment in('test','live')),
  config_fingerprint text not null check(config_fingerprint~'^[a-f0-9]{64}$'),
  scanner_provider text not null,
  clean_proven_at timestamptz not null,
  eicar_proven_at timestamptz not null,
  proof_expires_at timestamptz not null,
  clean_probe_checksum text not null check(clean_probe_checksum~'^[a-f0-9]{64}$'),
  eicar_probe_checksum text not null check(eicar_probe_checksum~'^[a-f0-9]{64}$'),
  upload_enabled boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(environment,config_fingerprint)
);
alter table public.booking_attachment_security_v3 enable row level security;
revoke all on public.booking_attachment_security_v3 from public,anon,authenticated;

create table if not exists public.booking_upload_contexts_v3(
  id uuid primary key,appointment_id uuid not null,profile_id uuid not null,website_id uuid not null,
  environment text not null check(environment in('test','live')),
  token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),
  request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
  max_files smallint not null default 5 check(max_files=5),
  max_bytes bigint not null default 52428800 check(max_bytes=52428800),
  expires_at timestamptz not null,state text not null default'open' check(state in('open','expired','closed')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(appointment_id,environment),unique(id,profile_id,environment),
  foreign key(appointment_id,profile_id,environment) references public.appointments(id,profile_id,environment) on delete restrict,
  foreign key(website_id,profile_id,environment) references public.websites(id,user_id,environment) on delete restrict
);
create table if not exists public.booking_attachment_objects_v3(
  attachment_id uuid not null,generation bigint not null check(generation>0),profile_id uuid not null,
  environment text not null check(environment in('test','live')),storage_object_key text not null,
  expected_mime_type text not null check(expected_mime_type in('image/jpeg','image/png','image/webp')),
  expected_byte_size bigint not null check(expected_byte_size between 1 and 10485760),
  expected_checksum text not null check(expected_checksum~'^[a-f0-9]{64}$'),
  object_state text not null default'pending' check(object_state in('pending','uploaded','scanning','clean','rejected','deleted')),
  scan_attempts integer not null default 0 check(scan_attempts>=0),scan_next_attempt_at timestamptz not null default now(),
  scan_lease_token uuid,scan_lease_expires_at timestamptz,scan_fencing_token bigint not null default 0,
  scanned_checksum text,scan_config_fingerprint text,scanner_verdict_id text,scan_proven_at timestamptz,
  deletion_state text not null default'none' check(deletion_state in('none','eligible','committed','deleted')),
  deletion_reason text check(deletion_reason in('rejected','abandoned','retention','superseded')),
  deletion_lease_token uuid,deletion_lease_expires_at timestamptz,deletion_fencing_token bigint not null default 0,
  deletion_committed_at timestamptz,deletion_retry_at timestamptz,delete_attempts integer not null default 0,
  committed_legal_hold_epoch bigint,committed_policy_version bigint,deletion_authorized_at timestamptz,deleted_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(attachment_id,generation),unique(storage_object_key),
  foreign key(attachment_id) references public.booking_attachments(id) on delete restrict
);
create table if not exists public.booking_upload_grants_v3(
  id uuid primary key,context_id uuid not null,attachment_id uuid not null,generation bigint not null,
  profile_id uuid not null,environment text not null check(environment in('test','live')),
  quota_slot smallint not null check(quota_slot between 1 and 5),
  token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),request_id uuid not null,
  request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
  state text not null default'issued' check(state in('issued','uploading','uploaded','expired')),
  expires_at timestamptz not null,result jsonb,created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(context_id,quota_slot),unique(context_id,request_id),
  foreign key(context_id,profile_id,environment) references public.booking_upload_contexts_v3(id,profile_id,environment) on delete restrict,
  foreign key(attachment_id,generation) references public.booking_attachment_objects_v3(attachment_id,generation) on delete restrict
);
alter table public.booking_upload_contexts_v3 enable row level security;
alter table public.booking_attachment_objects_v3 enable row level security;
alter table public.booking_upload_grants_v3 enable row level security;
revoke all on public.booking_upload_contexts_v3,public.booking_attachment_objects_v3,public.booking_upload_grants_v3 from public,anon,authenticated;

alter table public.booking_attachments
  add column if not exists current_object_generation bigint not null default 1 check(current_object_generation>0),
  add column if not exists legal_hold_epoch bigint not null default 0 check(legal_hold_epoch>=0);
insert into public.booking_attachment_objects_v3(
 attachment_id,generation,profile_id,environment,storage_object_key,expected_mime_type,expected_byte_size,
 expected_checksum,object_state,scanned_checksum,scan_config_fingerprint,scanner_verdict_id,scan_proven_at,
 deletion_state,deletion_reason,deleted_at
) select b.id,1,b.profile_id,b.environment,b.storage_object_key,b.mime_type,b.byte_size,b.checksum,
 case b.upload_state when'clean'then'clean'when'rejected'then'rejected'when'deleted'then'deleted'
   when'quarantined'then'uploaded'else b.upload_state end,
 b.scanned_checksum,b.scan_config_fingerprint,b.scanner_verdict_id,b.scan_proven_at,
 case when b.upload_state='deleted'then'deleted'when b.upload_state='rejected'then'eligible'else'none'end,
 case when b.upload_state='rejected'then'rejected'else null end,b.deleted_at
 from public.booking_attachments b on conflict do nothing;

alter table public.booking_attachments drop constraint if exists booking_attachments_exact_appointment_fkey;
alter table public.booking_attachments add constraint booking_attachments_exact_appointment_fkey
 foreign key(appointment_id,customer_id,website_id,profile_id,environment)
 references public.appointments(id,customer_id,website_id,profile_id,environment) on delete restrict;

create or replace function public.reject_booking_attachment_delete_v3()
returns trigger language plpgsql set search_path='' as $body$
begin raise exception 'booking attachment aggregates are retained; delete object generations through the cleanup protocol' using errcode='23514';end $body$;
drop trigger if exists booking_attachments_no_delete_v3 on public.booking_attachments;
create trigger booking_attachments_no_delete_v3 before delete on public.booking_attachments
for each row execute function public.reject_booking_attachment_delete_v3();

create or replace function public.booking_attachment_scanner_ready_v3(p_config_fingerprint text,p_environment text)
returns boolean language sql stable security definer set search_path='' as $body$
 select exists(select 1 from public.booking_attachment_security_v3 where environment=p_environment
   and config_fingerprint=p_config_fingerprint and upload_enabled
   and clean_proven_at>=pg_catalog.clock_timestamp()-interval'24 hours'
   and eicar_proven_at>=pg_catalog.clock_timestamp()-interval'24 hours'
   and proof_expires_at>pg_catalog.clock_timestamp())
$body$;

create or replace function public.record_booking_attachment_scanner_proof_v3(
 p_provider text,p_environment text,p_config_fingerprint text,p_clean_was_clean boolean,p_eicar_was_rejected boolean,
 p_clean_checksum text,p_eicar_checksum text,p_clean_verdict_id text,p_eicar_verdict_id text
) returns boolean language plpgsql security definer set search_path='' as $body$
declare now_at timestamptz:=pg_catalog.clock_timestamp();prior_enabled boolean:=false;
begin
 if nullif(pg_catalog.btrim(p_provider),'')is null or p_environment not in('test','live')
   or p_config_fingerprint!~'^[a-f0-9]{64}$' or not p_clean_was_clean or not p_eicar_was_rejected
   or p_clean_checksum!~'^[a-f0-9]{64}$' or p_eicar_checksum!~'^[a-f0-9]{64}$'
   or nullif(pg_catalog.btrim(p_clean_verdict_id),'')is null or nullif(pg_catalog.btrim(p_eicar_verdict_id),'')is null then
   raise exception 'invalid scanner proof' using errcode='22023';end if;
 select upload_enabled into prior_enabled from public.booking_attachment_security_v3
   where environment=p_environment and config_fingerprint=p_config_fingerprint for update;
 insert into public.booking_attachment_security_v3(environment,config_fingerprint,scanner_provider,
   clean_proven_at,eicar_proven_at,proof_expires_at,clean_probe_checksum,eicar_probe_checksum,upload_enabled)
 values(p_environment,p_config_fingerprint,left(pg_catalog.btrim(p_provider),100),now_at,now_at,now_at+interval'24 hours',
   p_clean_checksum,p_eicar_checksum,coalesce(prior_enabled,false))
 on conflict(environment,config_fingerprint)do update set scanner_provider=excluded.scanner_provider,
   clean_proven_at=excluded.clean_proven_at,eicar_proven_at=excluded.eicar_proven_at,
   proof_expires_at=excluded.proof_expires_at,clean_probe_checksum=excluded.clean_probe_checksum,
   eicar_probe_checksum=excluded.eicar_probe_checksum,updated_at=now_at;
 insert into public.booking_attachment_audit_events(environment,event_type,evidence)
 values(p_environment,'scanner_proof',pg_catalog.jsonb_build_object('contract',3,'provider',p_provider,
   'configFingerprint',p_config_fingerprint,'cleanVerdictId',left(p_clean_verdict_id,200),
   'eicarVerdictId',left(p_eicar_verdict_id,200),'expiresAt',(now_at+interval'24 hours')::text));
 return true;
end $body$;

create or replace function public.prepare_booking_attachment_uploads_v3(
 p_context_id uuid,p_appointment_id uuid,p_context_token_hash text,p_request_hash text,p_manifest jsonb
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare a public.appointments%rowtype;ctx public.booking_upload_contexts_v3%rowtype;item jsonb;count_items integer;total_bytes bigint;
 attachment_id uuid;grant_id uuid;request_id uuid;slot smallint;mime text;size_bytes bigint;checksum text;object_key text;
begin
 if p_context_id is null or p_context_token_hash!~'^[a-f0-9]{64}$' or p_request_hash!~'^[a-f0-9]{64}$'
   or pg_catalog.jsonb_typeof(p_manifest)<>'array' then raise exception 'invalid upload context' using errcode='22023';end if;
 count_items:=pg_catalog.jsonb_array_length(p_manifest);
 select coalesce(sum((value->>'byteSize')::bigint),0) into total_bytes from pg_catalog.jsonb_array_elements(p_manifest);
 if count_items not between 1 and 5 or total_bytes>52428800 then raise exception 'attachment aggregate limit exceeded' using errcode='22023';end if;
 select * into strict a from public.appointments where id=p_appointment_id and appointment_state in('held','payment_pending')
   and reservation_expires_at>pg_catalog.clock_timestamp() for update;
 if not exists(select 1 from public.booking_attachment_security_v3 s where s.environment=a.environment and s.upload_enabled and public.booking_attachment_scanner_ready_v3(s.config_fingerprint,a.environment))then raise exception 'attachment scanner is not ready' using errcode='P0001';end if;
 insert into public.booking_upload_contexts_v3(id,appointment_id,profile_id,website_id,environment,token_hash,request_hash,expires_at)
 values(p_context_id,a.id,a.profile_id,a.website_id,a.environment,p_context_token_hash,p_request_hash,
   least(a.reservation_expires_at,pg_catalog.clock_timestamp()+interval'30 minutes')) on conflict(appointment_id,environment)do nothing;
 select * into strict ctx from public.booking_upload_contexts_v3 where appointment_id=a.id and environment=a.environment for update;
 if ctx.id<>p_context_id or ctx.token_hash<>p_context_token_hash or ctx.request_hash<>p_request_hash
   or ctx.state<>'open' or ctx.expires_at<=pg_catalog.clock_timestamp() then
   raise exception 'upload context replay conflict' using errcode='23505';end if;
 for item in select value from pg_catalog.jsonb_array_elements(p_manifest) loop
   begin
     attachment_id:=(item->>'attachmentId')::uuid;grant_id:=(item->>'grantId')::uuid;
     request_id:=(item->>'requestId')::uuid;slot:=(item->>'quotaSlot')::smallint;
     size_bytes:=(item->>'byteSize')::bigint;
   exception when others then raise exception 'invalid upload manifest identity' using errcode='22023';end;
   mime:=item->>'mimeType';checksum:=item->>'checksum';
   if slot not between 1 and 5 or mime not in('image/jpeg','image/png','image/webp')
     or size_bytes not between 1 and 10485760 or checksum!~'^[a-f0-9]{64}$'
     or (item->>'tokenHash')!~'^[a-f0-9]{64}$' or (item->>'requestHash')!~'^[a-f0-9]{64}$'
     or nullif(pg_catalog.btrim(item->>'filename'),'')is null then
     raise exception 'invalid upload manifest item' using errcode='22023';end if;
   object_key:=a.environment||'/'||a.profile_id||'/'||a.website_id||'/'||a.id||'/'||attachment_id||'/g1';
   insert into public.booking_attachments(id,appointment_id,customer_id,profile_id,website_id,environment,
     storage_object_key,original_filename,display_filename,mime_type,byte_size,checksum,quota_slot,current_object_generation)
   values(attachment_id,a.id,a.customer_id,a.profile_id,a.website_id,a.environment,object_key,
     left(item->>'filename',255),left(item->>'displayFilename',120),mime,size_bytes,checksum,slot,1)
   on conflict(id)do nothing;
   insert into public.booking_attachment_objects_v3(attachment_id,generation,profile_id,environment,storage_object_key,
     expected_mime_type,expected_byte_size,expected_checksum)
   values(attachment_id,1,a.profile_id,a.environment,object_key,mime,size_bytes,checksum) on conflict do nothing;
   insert into public.booking_upload_grants_v3(id,context_id,attachment_id,generation,profile_id,environment,quota_slot,
     token_hash,request_id,request_hash,expires_at)
   values(grant_id,ctx.id,attachment_id,1,a.profile_id,a.environment,slot,item->>'tokenHash',request_id,
     item->>'requestHash',ctx.expires_at) on conflict(context_id,quota_slot)do nothing;
   if not exists(select 1 from public.booking_upload_grants_v3 g where g.context_id=ctx.id and g.quota_slot=slot
     and g.id=grant_id and g.attachment_id=attachment_id and g.token_hash=item->>'tokenHash'
     and g.request_id=request_id and g.request_hash=item->>'requestHash') then
     raise exception 'upload grant replay conflict' using errcode='23505';end if;
 end loop;
 if (select count(*) from public.booking_upload_grants_v3 where context_id=ctx.id)<>count_items then
   raise exception 'upload manifest replay conflict' using errcode='23505';end if;
 return pg_catalog.jsonb_build_object('contextId',ctx.id,'appointmentId',a.id,'environment',a.environment,
   'expiresAt',ctx.expires_at,'fileCount',count_items,'totalBytes',total_bytes);
end $body$;

create or replace function public.begin_booking_attachment_upload_v3(
 p_token_hash text,p_request_id uuid,p_request_hash text
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare g public.booking_upload_grants_v3%rowtype;o public.booking_attachment_objects_v3%rowtype;b public.booking_attachments%rowtype;
begin
 if p_token_hash!~'^[a-f0-9]{64}$' or p_request_id is null or p_request_hash!~'^[a-f0-9]{64}$'then
  raise exception 'invalid upload grant' using errcode='22023';end if;
 select * into strict g from public.booking_upload_grants_v3 where token_hash=p_token_hash for update;
 if g.request_id<>p_request_id or g.request_hash<>p_request_hash then raise exception 'upload request replay conflict' using errcode='23505';end if;
 if g.expires_at<=pg_catalog.clock_timestamp() and g.state not in('uploaded')then
   update public.booking_upload_grants_v3 set state='expired'where id=g.id;raise exception 'upload grant expired' using errcode='P0001';end if;
 select * into strict o from public.booking_attachment_objects_v3 where attachment_id=g.attachment_id and generation=g.generation for update;
 select * into strict b from public.booking_attachments where id=g.attachment_id and current_object_generation=g.generation for update;
 if g.state='issued'then update public.booking_upload_grants_v3 set state='uploading'where id=g.id;end if;
 return pg_catalog.jsonb_build_object('grantId',g.id,'attachmentId',g.attachment_id,'generation',g.generation,
  'profileId',g.profile_id,'environment',g.environment,'storageObjectKey',o.storage_object_key,
  'mimeType',o.expected_mime_type,'byteSize',o.expected_byte_size,'checksum',o.expected_checksum,'state',g.state);
end $body$;

create or replace function public.finalize_booking_attachment_upload_v3(
 p_token_hash text,p_request_id uuid,p_request_hash text
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare g public.booking_upload_grants_v3%rowtype;o public.booking_attachment_objects_v3%rowtype;b public.booking_attachments%rowtype;
begin
 select * into strict g from public.booking_upload_grants_v3 where token_hash=p_token_hash for update;
 if g.request_id<>p_request_id or g.request_hash<>p_request_hash then raise exception 'upload request replay conflict' using errcode='23505';end if;
 if g.state='uploaded'then return g.result;end if;
 if g.state<>'uploading'or g.expires_at<=pg_catalog.clock_timestamp()then raise exception 'upload grant is not active'using errcode='P0001';end if;
 select * into strict o from public.booking_attachment_objects_v3 where attachment_id=g.attachment_id and generation=g.generation for update;
 if not exists(select 1 from storage.objects where bucket_id='booking-attachments' and name=o.storage_object_key
   and metadata?'size' and metadata->>'size'~'^[1-9][0-9]{0,18}$'and pg_catalog.length(metadata->>'size')<19
   and(metadata->>'size')::bigint=o.expected_byte_size)then raise exception 'uploaded object is not proven'using errcode='P0001';end if;
 update public.booking_attachment_objects_v3 set object_state=case when object_state='pending'then'uploaded'else object_state end,
   updated_at=pg_catalog.clock_timestamp()where attachment_id=o.attachment_id and generation=o.generation;
 perform pg_catalog.set_config('app.attachment_state_transition',o.attachment_id::text,true);
 update public.booking_attachments set upload_state=case when upload_state='pending'then'uploaded'else upload_state end,
   state_version=state_version+case when upload_state='pending'then 1 else 0 end
 where id=o.attachment_id and current_object_generation=o.generation returning * into b;
 perform pg_catalog.set_config('app.attachment_state_transition','',true);
 update public.booking_upload_grants_v3 set state='uploaded',result=coalesce(result,
   pg_catalog.jsonb_build_object('attachmentId',o.attachment_id,'generation',o.generation,'state','uploaded'))where id=g.id;
 insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,evidence)
 values(o.attachment_id,o.profile_id,o.environment,'attachment_uploaded',pg_catalog.jsonb_build_object(
   'contract',3,'generation',o.generation,'checksum',o.expected_checksum));
 return (select result from public.booking_upload_grants_v3 where id=g.id);
exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;
end $body$;

create or replace function public.claim_due_booking_attachment_scans_v3(
 p_environment text,p_lease_token uuid,p_limit integer default 10
) returns table(attachment_id uuid,generation bigint,storage_object_key text,mime_type text,byte_size bigint,
 checksum text,scan_fencing_token bigint)language plpgsql security definer set search_path='' as $body$
begin
 if p_environment not in('test','live') or p_lease_token is null or p_limit not between 1 and 50 then raise exception 'invalid scan claim' using errcode='22023';end if;
 return query with due as(
  select o.attachment_id,o.generation from public.booking_attachment_objects_v3 o
  where o.environment=p_environment and o.object_state in('uploaded','scan_retry','scanning')
    and o.scan_next_attempt_at<=pg_catalog.clock_timestamp()
    and(o.scan_lease_expires_at is null or o.scan_lease_expires_at<=pg_catalog.clock_timestamp())
    and o.deletion_state='none'
  order by o.scan_next_attempt_at,o.created_at for update skip locked limit p_limit
 ),claimed as(
  update public.booking_attachment_objects_v3 o set object_state='scanning',scan_lease_token=p_lease_token,
   scan_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',
   scan_fencing_token=o.scan_fencing_token+1,scan_attempts=o.scan_attempts+1,
   updated_at=pg_catalog.clock_timestamp() from due
  where o.attachment_id=due.attachment_id and o.generation=due.generation returning o.*
 ) select c.attachment_id,c.generation,c.storage_object_key,c.expected_mime_type,c.expected_byte_size,
   c.expected_checksum,c.scan_fencing_token from claimed c;
end $body$;

-- Complete generation-bound scan, download, cleanup, ACL, lease, and schedule authority.
alter table public.booking_attachment_objects_v3 drop constraint if exists booking_attachment_objects_v3_object_state_check;
alter table public.booking_attachment_objects_v3 add constraint booking_attachment_objects_v3_object_state_check check(object_state in('pending','uploaded','scanning','scan_retry','clean','rejected','deleted'));

create or replace function public.complete_booking_attachment_scan_v3(p_attachment_id uuid,p_generation bigint,p_environment text,p_lease_token uuid,p_fencing_token bigint,p_outcome text,p_safe_error text,p_config_fingerprint text,p_scanned_checksum text,p_scanner_verdict_id text default null)returns boolean language plpgsql security definer set search_path=''as $body$
declare o public.booking_attachment_objects_v3%rowtype;next_state text;begin
 if p_environment not in('test','live')or p_outcome not in('clean','rejected','scanner_unavailable')or p_scanned_checksum!~'^[a-f0-9]{64}$'then raise exception'invalid scan settlement'using errcode='22023';end if;
 select * into strict o from public.booking_attachment_objects_v3 where attachment_id=p_attachment_id and generation=p_generation and environment=p_environment and object_state='scanning'and scan_lease_token=p_lease_token and scan_fencing_token=p_fencing_token and scan_lease_expires_at>pg_catalog.clock_timestamp()for update;
 if o.expected_checksum<>p_scanned_checksum then raise exception'attachment scan digest mismatch'using errcode='P0001';end if;
 if p_outcome in('clean','rejected')and(nullif(pg_catalog.btrim(p_scanner_verdict_id),'')is null or not public.booking_attachment_scanner_ready_v3(p_config_fingerprint,p_environment))then raise exception'scanner proof stale or mismatched'using errcode='P0001';end if;
 next_state:=case when p_outcome='clean'then'clean'when p_outcome='rejected'then'rejected'else'scan_retry'end;
 update public.booking_attachment_objects_v3 set object_state=next_state,scan_lease_token=null,scan_lease_expires_at=null,scan_next_attempt_at=case when next_state='scan_retry'then pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(300,pg_catalog.power(2,least(scan_attempts,8))::integer))else scan_next_attempt_at end,scanned_checksum=case when p_outcome in('clean','rejected')then p_scanned_checksum else scanned_checksum end,scan_config_fingerprint=case when p_outcome in('clean','rejected')then p_config_fingerprint else scan_config_fingerprint end,scanner_verdict_id=case when p_outcome in('clean','rejected')then left(p_scanner_verdict_id,200)else scanner_verdict_id end,scan_proven_at=case when p_outcome in('clean','rejected')then pg_catalog.clock_timestamp()else scan_proven_at end,deletion_state=case when next_state='rejected'then'eligible'else deletion_state end,deletion_reason=case when next_state='rejected'then'rejected'else deletion_reason end,updated_at=pg_catalog.clock_timestamp()where attachment_id=o.attachment_id and generation=o.generation;
 if exists(select 1 from public.booking_attachments where id=o.attachment_id and current_object_generation=o.generation)then perform pg_catalog.set_config('app.attachment_state_transition',o.attachment_id::text,true);update public.booking_attachments set upload_state=case when next_state='clean'then'clean'when next_state='rejected'then'rejected'else'quarantined'end,scan_error=case when next_state='clean'then null else left(coalesce(p_safe_error,'Attachment scan failed'),200)end,scanned_checksum=case when p_outcome in('clean','rejected')then p_scanned_checksum else scanned_checksum end,scan_config_fingerprint=case when p_outcome in('clean','rejected')then p_config_fingerprint else scan_config_fingerprint end,scanner_verdict_id=case when p_outcome in('clean','rejected')then left(p_scanner_verdict_id,200)else scanner_verdict_id end,scan_proven_at=case when p_outcome in('clean','rejected')then pg_catalog.clock_timestamp()else scan_proven_at end,finalized_at=case when next_state in('clean','rejected')then pg_catalog.clock_timestamp()else finalized_at end,state_version=state_version+1 where id=o.attachment_id;perform pg_catalog.set_config('app.attachment_state_transition','',true);end if;
 insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,evidence)values(o.attachment_id,o.profile_id,o.environment,case when next_state='clean'then'scan_clean'when next_state='rejected'then'scan_rejected'else'scan_retry'end,pg_catalog.jsonb_build_object('contract',3,'generation',o.generation,'checksum',p_scanned_checksum,'configFingerprint',p_config_fingerprint));return true;exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;end $body$;

create or replace function public.list_clean_contractor_booking_attachments_v3(p_actor_auth_user_id uuid,p_appointment_ids uuid[])returns table(id uuid,appointment_id uuid,generation bigint,display_filename text,mime_type text,byte_size bigint,finalized_at timestamptz)language sql stable security definer set search_path=''as $body$ select b.id,b.appointment_id,o.generation,b.display_filename,b.mime_type,b.byte_size,b.finalized_at from public.profiles p join public.booking_attachments b on b.profile_id=p.id and b.environment=p.environment join public.booking_attachment_objects_v3 o on o.attachment_id=b.id and o.generation=b.current_object_generation and o.environment=b.environment where p.auth_user_id=p_actor_auth_user_id and coalesce(pg_catalog.array_length(p_appointment_ids,1),0)<=25 and b.legal_hold_at is null and b.appointment_id=any(p_appointment_ids)and o.object_state='clean'and o.scanned_checksum=o.expected_checksum and o.scanner_verdict_id is not null and o.scan_proven_at is not null and o.deletion_state='none' order by b.appointment_id,b.quota_slot $body$;
create or replace function public.authorize_booking_attachment_download_v3(p_actor_auth_user_id uuid,p_attachment_id uuid,p_generation bigint default null)returns table(storage_object_key text,display_filename text,mime_type text,generation bigint,checksum text)language plpgsql security definer set search_path=''as $body$declare item record;begin select o.storage_object_key,b.display_filename,b.mime_type,o.generation,o.expected_checksum,b.profile_id,b.environment into strict item from public.profiles p join public.booking_attachments b on b.profile_id=p.id and b.environment=p.environment join public.booking_attachment_objects_v3 o on o.attachment_id=b.id and o.generation=b.current_object_generation where p.auth_user_id=p_actor_auth_user_id and b.id=p_attachment_id and b.legal_hold_at is null and(p_generation is null or o.generation=p_generation)and o.object_state='clean'and o.scanned_checksum=o.expected_checksum and o.scanner_verdict_id is not null and o.scan_proven_at is not null and o.deletion_state='none';insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,actor_auth_user_id,evidence)values(p_attachment_id,item.profile_id,item.environment,'download_authorized',p_actor_auth_user_id,pg_catalog.jsonb_build_object('contract',3,'generation',item.generation,'checksum',item.expected_checksum));return query select item.storage_object_key,item.display_filename,item.mime_type,item.generation,item.expected_checksum;end $body$;

alter table public.data_retention_policies add column if not exists policy_version bigint not null default 1 check(policy_version>0),add column if not exists policy_digest text,add column if not exists approved_at timestamptz,add column if not exists approved_by uuid;
-- Existing approvals predate digest/approver evidence. Disable rather than inventing proof or aborting the upgrade.
update public.data_retention_policies set production_approved=false,deletion_mode='support_verified',updated_at=pg_catalog.clock_timestamp()where production_approved and(policy_digest is null or policy_digest!~'^[a-f0-9]{64}$'or approved_at is null or approved_by is null);
alter table public.data_retention_policies drop constraint if exists data_retention_policies_v3_approval_check;alter table public.data_retention_policies add constraint data_retention_policies_v3_approval_check check(not production_approved or(retention_days is not null and deletion_mode='automatic'and policy_digest~'^[a-f0-9]{64}$'and approved_at is not null and approved_by is not null));
create or replace function public.set_booking_attachment_legal_hold_v3(p_attachment_id uuid,p_held boolean,p_admin_token_hash text,p_reason text)returns boolean language plpgsql security definer set search_path=''as $body$declare item public.booking_attachments%rowtype;principal uuid;begin if p_admin_token_hash!~'^[a-f0-9]{64}$'or nullif(pg_catalog.btrim(p_reason),'')is null then raise exception'legal hold authority required'using errcode='22023';end if;select s.user_id into principal from public.admin_sessions s join public.admin_principals p on p.user_id=s.user_id where s.token_hash=p_admin_token_hash and p.enabled and p.mfa_required and p.role='admin'and s.aal='aal2'and s.revoked_at is null and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp();if principal is null then raise exception'legal hold forbidden'using errcode='42501';end if;select * into strict item from public.booking_attachments where id=p_attachment_id for update;if p_held and exists(select 1 from public.booking_attachment_objects_v3 where attachment_id=item.id and generation=item.current_object_generation and deletion_state in('committed','deleted'))then raise exception'attachment deletion already committed'using errcode='P0001';end if;update public.booking_attachments set legal_hold_at=case when p_held then pg_catalog.clock_timestamp()else null end,legal_hold_reason=case when p_held then left(pg_catalog.btrim(p_reason),500)else null end,legal_hold_epoch=legal_hold_epoch+1 where id=item.id;insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,actor_auth_user_id,evidence)values(item.id,item.profile_id,item.environment,case when p_held then'legal_hold_set'else'legal_hold_released'end,principal,pg_catalog.jsonb_build_object('reason',left(pg_catalog.btrim(p_reason),500),'contract',3));return true;end $body$;
create or replace function public.claim_booking_attachment_cleanup_v3(p_environment text,p_lease_token uuid,p_limit integer default 10,p_discover boolean default true)returns table(attachment_id uuid,generation bigint,storage_object_key text,deletion_reason text,deletion_fencing_token bigint)language plpgsql security definer set search_path=''as $body$
begin
 if p_environment not in('test','live')or p_lease_token is null or p_limit not between 1 and 25 then raise exception 'invalid cleanup claim' using errcode='22023';end if;
 return query with eligible as(
  select o.attachment_id,o.generation,coalesce(o.deletion_reason,case when o.object_state in('pending','uploaded','scan_retry','rejected')then'abandoned'else'retention'end)reason,b.legal_hold_epoch,case when o.deletion_reason='rejected'then op.policy_version when o.object_state in('pending','uploaded','scan_retry')then op.policy_version else rp.policy_version end policy_version
  from public.booking_attachment_objects_v3 o join public.booking_attachments b on b.id=o.attachment_id join public.appointments a on a.id=b.appointment_id and a.profile_id=b.profile_id and a.environment=b.environment
  left join public.data_retention_policies rp on rp.data_class='booking_attachments'left join public.data_retention_policies op on op.data_class='abandoned_holds'
  where o.environment=p_environment and b.legal_hold_at is null and o.deletion_state in('none','eligible','committed')and(o.deletion_state='committed'or p_discover)and(o.deletion_lease_expires_at is null or o.deletion_lease_expires_at<=pg_catalog.clock_timestamp())and(o.deletion_retry_at is null or o.deletion_retry_at<=pg_catalog.clock_timestamp())
  and((o.deletion_reason='rejected'and op.production_approved and op.deletion_mode='automatic'and op.policy_digest~'^[a-f0-9]{64}$')or o.deletion_state='committed'or(o.object_state in('pending','uploaded','scan_retry')and op.production_approved and op.deletion_mode='automatic'and op.policy_digest~'^[a-f0-9]{64}$'and a.appointment_state='cancelled'and a.payment_state<>'paid'and a.reservation_expires_at<pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>op.retention_days))or(o.object_state='clean'and rp.production_approved and rp.deletion_mode='automatic'and rp.policy_digest~'^[a-f0-9]{64}$'and coalesce(b.finalized_at,b.created_at)<pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>rp.retention_days)))
  order by coalesce(o.deletion_committed_at,o.created_at)for update of o,b skip locked limit p_limit
 ),claimed as(update public.booking_attachment_objects_v3 o set deletion_state='committed',deletion_reason=eligible.reason,deletion_committed_at=pg_catalog.clock_timestamp(),committed_legal_hold_epoch=eligible.legal_hold_epoch,committed_policy_version=eligible.policy_version,deletion_lease_token=p_lease_token,deletion_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',deletion_fencing_token=o.deletion_fencing_token+1,delete_attempts=o.delete_attempts+1,updated_at=pg_catalog.clock_timestamp()from eligible where o.attachment_id=eligible.attachment_id and o.generation=eligible.generation returning o.*)
 select c.attachment_id,c.generation,c.storage_object_key,c.deletion_reason,c.deletion_fencing_token from claimed c;
end $body$;
create or replace function public.authorize_booking_attachment_cleanup_v3(p_attachment_id uuid,p_generation bigint,p_environment text,p_lease_token uuid,p_fencing_token bigint)returns boolean language plpgsql security definer set search_path=''as $body$
declare o public.booking_attachment_objects_v3%rowtype;expected_class text;
begin
 select * into strict o from public.booking_attachment_objects_v3 where attachment_id=p_attachment_id and generation=p_generation and environment=p_environment and deletion_state='committed'and deletion_lease_token=p_lease_token and deletion_fencing_token=p_fencing_token and deletion_lease_expires_at>pg_catalog.clock_timestamp()for update;
 expected_class:=case when o.deletion_reason='retention'then'booking_attachments'else'abandoned_holds'end;
 if exists(select 1 from public.booking_attachments b where b.id=o.attachment_id and(b.legal_hold_at is not null or b.legal_hold_epoch<>o.committed_legal_hold_epoch))or not exists(select 1 from public.data_retention_policies r where r.data_class=expected_class and r.policy_version=o.committed_policy_version and r.production_approved and r.deletion_mode='automatic'and r.policy_digest~'^[a-f0-9]{64}$')then
  update public.booking_attachment_objects_v3 set deletion_state='eligible',deletion_lease_token=null,deletion_lease_expires_at=null,committed_legal_hold_epoch=null,committed_policy_version=null,deletion_authorized_at=null,updated_at=pg_catalog.clock_timestamp()where attachment_id=o.attachment_id and generation=o.generation;return false;
 end if;
 update public.booking_attachment_objects_v3 set deletion_authorized_at=coalesce(deletion_authorized_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp()where attachment_id=o.attachment_id and generation=o.generation;
 return true;
end $body$;
create or replace function public.complete_booking_attachment_cleanup_v3(p_attachment_id uuid,p_generation bigint,p_environment text,p_lease_token uuid,p_fencing_token bigint,p_object_removed boolean)returns boolean language plpgsql security definer set search_path=''as $body$declare o public.booking_attachment_objects_v3%rowtype;begin select * into strict o from public.booking_attachment_objects_v3 where attachment_id=p_attachment_id and generation=p_generation and environment=p_environment and deletion_state='committed'and deletion_lease_token=p_lease_token and deletion_fencing_token=p_fencing_token and deletion_lease_expires_at>pg_catalog.clock_timestamp()and deletion_authorized_at is not null for update;if not p_object_removed then update public.booking_attachment_objects_v3 set deletion_lease_token=null,deletion_lease_expires_at=null,deletion_retry_at=pg_catalog.clock_timestamp()+interval'1 minute',updated_at=pg_catalog.clock_timestamp()where attachment_id=o.attachment_id and generation=o.generation;return false;end if;update public.booking_attachment_objects_v3 set object_state='deleted',deletion_state='deleted',deleted_at=pg_catalog.clock_timestamp(),deletion_lease_token=null,deletion_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where attachment_id=o.attachment_id and generation=o.generation;if exists(select 1 from public.booking_attachments where id=o.attachment_id and current_object_generation=o.generation)then perform pg_catalog.set_config('app.attachment_state_transition',o.attachment_id::text,true);update public.booking_attachments set upload_state='deleted',deleted_at=pg_catalog.clock_timestamp(),state_version=state_version+1 where id=o.attachment_id;perform pg_catalog.set_config('app.attachment_state_transition','',true);end if;insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,evidence)values(o.attachment_id,o.profile_id,o.environment,case when o.deletion_reason='retention'then'retention_deleted'else'orphan_deleted'end,pg_catalog.jsonb_build_object('contract',3,'generation',o.generation,'reason',o.deletion_reason));return true;exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;end $body$;

-- Legacy attachment mutations are explicit tombstones and lose runtime grants.
drop function if exists public.create_public_booking_attachment_record_audited(uuid,uuid,text,text,text,bigint,text,smallint,text);drop function if exists public.mark_booking_attachment_uploaded_audited(uuid,uuid,text,text,bigint,text,text);drop function if exists public.complete_booking_attachment_scan_audited(uuid,uuid,bigint,text,text,text,text,text);drop function if exists public.set_booking_attachment_legal_hold(uuid,boolean,uuid,text);revoke all on function public.claim_booking_attachment_cleanup(uuid,integer),public.complete_booking_attachment_cleanup(uuid,uuid,bigint,boolean),public.claim_booking_attachment_scan(uuid,uuid,integer),public.list_clean_contractor_booking_attachments(uuid,uuid[]),public.authorize_booking_attachment_download(uuid,uuid)from public,anon,authenticated,service_role,booking_worker;


create table if not exists public.booking_provider_account_disconnects_v3(
 id uuid primary key default pg_catalog.gen_random_uuid(),profile_id uuid not null,environment text not null check(environment in('test','live')),
 provider text not null check(provider='pipedream'),provider_account_id text not null,actor_auth_user_id uuid not null,
 state text not null default'pending'check(state in('pending','completed')),requested_at timestamptz not null default pg_catalog.clock_timestamp(),completed_at timestamptz,
 unique(profile_id,environment,provider,provider_account_id)
);
alter table public.booking_provider_account_disconnects_v3 enable row level security;
revoke all on public.booking_provider_account_disconnects_v3 from public,anon,authenticated,service_role,booking_worker;
create or replace function public.reserve_booking_provider_account_disconnect_v3(p_profile_id uuid,p_environment text,p_provider_account_id text,p_actor_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path=''as $body$declare result uuid;begin
 if nullif(pg_catalog.btrim(p_provider_account_id),'')is null or not exists(select 1 from public.profiles p where p.id=p_profile_id and p.environment=p_environment and p.auth_user_id=p_actor_auth_user_id)then raise exception'provider disconnect forbidden'using errcode='42501';end if;
 insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,actor_auth_user_id)values(p_profile_id,p_environment,'pipedream',p_provider_account_id,p_actor_auth_user_id)on conflict(profile_id,environment,provider,provider_account_id)do update set actor_auth_user_id=excluded.actor_auth_user_id,state='pending',requested_at=pg_catalog.clock_timestamp(),completed_at=null returning id into result;return result;
end $body$;
create or replace function public.complete_booking_provider_account_disconnect_v3(p_disconnect_id uuid,p_profile_id uuid,p_environment text,p_provider_account_id text)
returns boolean language plpgsql security definer set search_path=''as $body$begin update public.booking_provider_account_disconnects_v3 set state='completed',completed_at=pg_catalog.clock_timestamp()where id=p_disconnect_id and profile_id=p_profile_id and environment=p_environment and provider='pipedream'and provider_account_id=p_provider_account_id and state='pending';return found;end $body$;

create table if not exists public.booking_worker_family_leases_v3(environment text not null check(environment in('test','live')),family text not null check(family in('core','notifications','attachment_scan','attachment_cleanup')),lease_token uuid,lease_expires_at timestamptz,fencing_token bigint not null default 0,last_started_at timestamptz,last_completed_at timestamptz,last_success boolean,last_error text,primary key(environment,family));alter table public.booking_worker_family_leases_v3 enable row level security;revoke all on public.booking_worker_family_leases_v3 from public,anon,authenticated;
create or replace function public.claim_booking_worker_family_v3(p_environment text,p_family text,p_lease_token uuid,p_lease_seconds integer default 55)returns bigint language plpgsql security definer set search_path=''as $body$declare fence bigint;begin if p_environment not in('test','live')or p_family not in('core','notifications','attachment_scan','attachment_cleanup')or p_lease_token is null or p_lease_seconds not between 10 and 300 then raise exception'invalid worker family claim'using errcode='22023';end if;insert into public.booking_worker_family_leases_v3(environment,family)values(p_environment,p_family)on conflict do nothing;update public.booking_worker_family_leases_v3 set lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),fencing_token=fencing_token+1,last_started_at=pg_catalog.clock_timestamp(),last_error=null where environment=p_environment and family=p_family and(lease_expires_at is null or lease_expires_at<=pg_catalog.clock_timestamp())returning fencing_token into fence;return fence;end $body$;
create or replace function public.complete_booking_worker_family_v3(p_environment text,p_family text,p_lease_token uuid,p_fencing_token bigint,p_success boolean,p_safe_error text default null)returns boolean language plpgsql security definer set search_path=''as $body$begin update public.booking_worker_family_leases_v3 set lease_token=null,lease_expires_at=null,last_completed_at=pg_catalog.clock_timestamp(),last_success=p_success,last_error=case when p_success then null else left(p_safe_error,240)end where environment=p_environment and family=p_family and lease_token=p_lease_token and fencing_token=p_fencing_token;return found;end $body$;

-- PostgreSQL grants PUBLIC EXECUTE on new functions by default. Close that default for
-- every definer introduced by this closure before the explicit role allowlists below.
do $acl$ declare proc pg_catalog.regprocedure;begin for proc in
 select p.oid::pg_catalog.regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'and p.proname=any(array[
  'prepare_booking_checkout_handoff_v3','recover_booking_checkout_handoff_v3','issue_booking_confirmation_capability_v3','booking_confirmation_projection_v3','consume_booking_confirmation_capability_v3',
  'project_booking_notifications_v3','try_project_booking_notifications_v3','try_project_booking_payment_notifications_v3','claim_due_booking_outbox','expire_due_booking_holds_v3','expire_abandoned_booking_checkout_creations_v3','claim_due_booking_session_expiries_v3','renew_booking_session_expiry_v3','fail_booking_session_expiry_v3','renew_booking_refund_command_v3','reject_legacy_booking_notify_outbox_v3','reconcile_booking_notification_projection_v3','booking_notification_event_current_v4','suppress_noncanonical_booking_notifications_v4','claim_due_booking_notifications_v3','get_booking_notification_context_v3','reduce_booking_notification_delivery_v3','complete_booking_notification_v3','fail_booking_notification_v3','ingest_booking_notification_delivery','enqueue_booking_notification',
  'booking_attachment_scanner_ready_v3','record_booking_attachment_scanner_proof_v3','prepare_booking_attachment_uploads_v3','begin_booking_attachment_upload_v3','finalize_booking_attachment_upload_v3','claim_due_booking_attachment_scans_v3','complete_booking_attachment_scan_v3','list_clean_contractor_booking_attachments_v3','authorize_booking_attachment_download_v3','set_booking_attachment_legal_hold_v3','claim_booking_attachment_cleanup_v3','authorize_booking_attachment_cleanup_v3','complete_booking_attachment_cleanup_v3','claim_booking_worker_family_v3','renew_booking_worker_family_v3','complete_booking_worker_family_v3','reserve_booking_provider_account_disconnect_v3','complete_booking_provider_account_disconnect_v3'
 ])loop execute 'revoke all on function '||proc::text||' from public,anon,authenticated,service_role,booking_worker';end loop;end $acl$;
revoke all on all tables in schema public from booking_worker;revoke all on all sequences in schema public from booking_worker;revoke all on all functions in schema public from booking_worker;grant usage on schema public to booking_worker;
-- Effective final worker allowlist. Financial projection has exactly one reducer; Google,
-- notifications, and attachments expose only lease/fence-bound v3 transitions.
grant execute on function
 public.claim_due_booking_payment_events(text,uuid,integer),public.renew_booking_payment_event_v3(uuid,uuid,bigint,integer),public.fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text),public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb),
 public.claim_due_booking_outbox(text,uuid,integer),public.get_booking_outbox_context(uuid,uuid,bigint),public.renew_booking_refund_command_v3(uuid,uuid,bigint,integer),public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text),
 public.expire_due_booking_holds_v3(text,integer),public.expire_abandoned_booking_checkout_creations_v3(text,integer),public.claim_due_booking_session_expiries_v3(text,uuid,integer),public.renew_booking_session_expiry_v3(uuid,uuid,bigint,integer),public.fail_booking_session_expiry_v3(uuid,uuid,bigint,boolean,text),public.claim_ambiguous_booking_checkouts(text,uuid,integer),public.settle_booking_checkout(uuid,uuid,bigint,text,timestamptz,boolean,boolean,text),
 public.claim_booking_calendar_reconciliation(text,uuid,integer),public.renew_booking_calendar_reconciliation_v3(uuid,uuid,bigint,bigint,bigint,integer),public.fail_booking_calendar_convergence(uuid,uuid,bigint,bigint,bigint,boolean,text),public.record_booking_calendar_observation(uuid,uuid,bigint,bigint,bigint,text,text,timestamptz,jsonb),public.begin_booking_calendar_effect(uuid,uuid,bigint,bigint,bigint,text),public.record_booking_calendar_effect_result(uuid,uuid,bigint,text,integer,jsonb),
 public.claim_booking_late_payment_arbitrations(text,uuid,integer),public.renew_booking_late_payment_arbitration_v3(uuid,uuid,bigint,bigint,integer),public.record_booking_late_payment_observation(uuid,uuid,bigint,bigint,timestamptz,text,jsonb,text),
 public.reconcile_booking_notification_projection_v3(text,integer),public.booking_notification_event_current_v4(uuid),public.suppress_noncanonical_booking_notifications_v4(text,integer),public.claim_due_booking_notifications_v3(text,uuid,integer),public.get_booking_notification_context_v3(uuid,text,uuid,bigint),public.complete_booking_notification_v3(uuid,text,uuid,bigint,text,text),public.fail_booking_notification_v3(uuid,text,uuid,bigint,boolean,text),
 public.claim_due_booking_attachment_scans_v3(text,uuid,integer),public.complete_booking_attachment_scan_v3(uuid,bigint,text,uuid,bigint,text,text,text,text,text),public.claim_booking_attachment_cleanup_v3(text,uuid,integer,boolean),public.authorize_booking_attachment_cleanup_v3(uuid,bigint,text,uuid,bigint),public.complete_booking_attachment_cleanup_v3(uuid,bigint,text,uuid,bigint,boolean),
 public.claim_booking_worker_family_v3(text,text,uuid,integer),public.renew_booking_worker_family_v3(text,text,uuid,bigint,integer),public.complete_booking_worker_family_v3(text,text,uuid,bigint,boolean,text)
to booking_worker;
grant execute on function public.prepare_booking_checkout_handoff_v3(uuid,uuid,bigint,timestamptz,timestamptz,text),public.recover_booking_checkout_handoff_v3(uuid,text),public.issue_booking_confirmation_capability_v3(text,text,text),public.consume_booking_confirmation_capability_v3(text,uuid),public.ingest_booking_notification_delivery(text,text,text,timestamptz),public.booking_attachment_scanner_ready_v3(text,text),public.record_booking_attachment_scanner_proof_v3(text,text,text,boolean,boolean,text,text,text,text),public.prepare_booking_attachment_uploads_v3(uuid,uuid,text,text,jsonb),public.begin_booking_attachment_upload_v3(text,uuid,text),public.finalize_booking_attachment_upload_v3(text,uuid,text),public.list_clean_contractor_booking_attachments_v3(uuid,uuid[]),public.authorize_booking_attachment_download_v3(uuid,uuid,bigint),public.set_booking_attachment_legal_hold_v3(uuid,boolean,text,text),public.reserve_booking_provider_account_disconnect_v3(uuid,text,text,uuid),public.complete_booking_provider_account_disconnect_v3(uuid,uuid,text,text)to service_role;

-- Forward-only safe default: retire any inherited booking schedules, but do not dispatch
-- to a hostname or with a secret chosen by source code. Operations must install the four
-- environment-scoped jobs only after validating the target origin, Vault secret, disabled
-- worker mode, and retained heartbeat evidence from the target deployment.
do $schedule$
declare job_id bigint;
begin
 for job_id in select jobid from cron.job where jobname in('obra-booking-core-v3','obra-booking-notifications-v3','obra-booking-attachment-scan-v3','obra-booking-attachment-cleanup-v3')loop perform cron.unschedule(job_id);end loop;
end $schedule$;
