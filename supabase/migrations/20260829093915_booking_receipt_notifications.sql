-- Forward-only P1 receipt binding and independently tracked booking notifications.

alter table public.booking_confirmation_capabilities
  add column if not exists public_reference uuid;
update public.booking_confirmation_capabilities c set public_reference=a.public_reference
from public.appointments a where a.id=c.appointment_id and c.public_reference is null;
alter table public.booking_confirmation_capabilities alter column public_reference set not null;
create unique index if not exists booking_confirmation_capabilities_reference_uq
  on public.booking_confirmation_capabilities(public_reference);

create table if not exists public.booking_notifications(
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null,
  profile_id uuid not null,
  environment text not null check(environment in('test','live')),
  notification_type text not null check(notification_type in(
    'confirmed','cancelled','refund_pending','refund_succeeded','refund_failed',
    'late_payment','calendar_failed'
  )),
  audience text not null check(audience in('customer','contractor')),
  recipient_email text not null check(pg_catalog.length(recipient_email) between 3 and 254),
  idempotency_key text not null,
  state text not null default 'pending' check(state in(
    'pending','processing','accepted','delivered','delivery_delayed','bounced','complained','retry','failed'
  )),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0,
  provider_message_id text,
  provider_event_id text,
  occurrence_version bigint not null,
  last_provider_event_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(profile_id,environment,idempotency_key),
  unique(provider_message_id),
  unique(appointment_id,notification_type,audience,occurrence_version),
  foreign key(appointment_id,profile_id,environment)
    references public.appointments(id,profile_id,environment) on delete cascade
);
alter table public.booking_notifications enable row level security;
revoke all on public.booking_notifications from public,anon,authenticated;

create or replace function public.issue_booking_confirmation_capability(
  p_checkout_session_id text,p_token_hash text,p_nonce_hash text
) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.booking_payments%rowtype;a public.appointments%rowtype;cap uuid;
begin
 select * into strict p from public.booking_payments where checkout_session_id=p_checkout_session_id
   and payment_state='paid' and confirmation_nonce_hash=p_nonce_hash;
 select * into strict a from public.appointments where id=p.appointment_id and profile_id=p.profile_id and environment=p.environment;
 insert into public.booking_confirmation_capabilities(
   appointment_id,profile_id,environment,checkout_session_id,token_hash,public_reference,expires_at
 ) values(p.appointment_id,p.profile_id,p.environment,p_checkout_session_id,p_token_hash,a.public_reference,pg_catalog.clock_timestamp()+interval '24 hours')
 on conflict(environment,checkout_session_id) do update set
   expires_at=greatest(public.booking_confirmation_capabilities.expires_at,excluded.expires_at)
 where public.booking_confirmation_capabilities.token_hash=excluded.token_hash
   and public.booking_confirmation_capabilities.public_reference=excluded.public_reference
 returning id into cap;
 if cap is null then raise exception 'confirmation capability mismatch' using errcode='P0001';end if;
 return cap;
end $$;

create or replace function public.consume_booking_confirmation_capability(
  p_token_hash text,p_reference uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.booking_confirmation_capabilities%rowtype;a public.appointments%rowtype;
begin
 select * into strict c from public.booking_confirmation_capabilities
 where token_hash=p_token_hash and public_reference=p_reference and expires_at>pg_catalog.clock_timestamp();
 update public.booking_confirmation_capabilities set consumed_at=coalesce(consumed_at,pg_catalog.clock_timestamp()) where id=c.id;
 select * into strict a from public.appointments where id=c.appointment_id and public_reference=p_reference;
 return pg_catalog.jsonb_build_object(
   'reference',a.public_reference,'startAt',a.start_at,'endAt',a.end_at,'timeZone',a.time_zone,
   'service',a.service_snapshot,'location',a.location_snapshot,
   'appointmentState',a.appointment_state,'appointmentReason',a.appointment_reason,
   'paymentState',a.payment_state,'refundState',a.refund_state,'calendarState',a.calendar_state,
   'reviewState',a.review_state,'reservationExpiresAt',a.reservation_expires_at,
   'confirmedAt',a.confirmed_at,'cancelledAt',a.cancelled_at,'updatedAt',a.updated_at
 );
end $$;
revoke all on function public.issue_booking_confirmation_capability(text,text,text) from public,anon,authenticated;
revoke all on function public.consume_booking_confirmation_capability(text,uuid) from public,anon,authenticated;
revoke all on function public.consume_booking_confirmation_capability(text) from public,anon,authenticated,service_role;
grant execute on function public.issue_booking_confirmation_capability(text,text,text) to service_role;
grant execute on function public.consume_booking_confirmation_capability(text,uuid) to service_role;

create or replace function public.enqueue_booking_notification(
  p_appointment_id uuid,p_notification_type text
) returns integer language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype;customer_email text;contractor_email text;inserted integer;
begin
 if p_notification_type not in('confirmed','cancelled','refund_pending','refund_succeeded','refund_failed','late_payment','calendar_failed')
   then raise exception 'invalid booking notification type' using errcode='22023';end if;
 select * into strict a from public.appointments where id=p_appointment_id for update;
 customer_email:=pg_catalog.lower(pg_catalog.btrim(a.customer_snapshot->>'email'));
 select pg_catalog.lower(pg_catalog.btrim(email)) into contractor_email from public.profiles
   where id=a.profile_id and environment=a.environment;
 insert into public.booking_notifications(
   appointment_id,profile_id,environment,notification_type,audience,recipient_email,idempotency_key,occurrence_version,state,last_error,failed_at
 ) values
   (a.id,a.profile_id,a.environment,p_notification_type,'customer',coalesce(nullif(customer_email,''),'unsendable@invalid'),
    'booking-notify:'||p_notification_type||':'||a.id||':'||a.version||':customer',a.version,case when coalesce(customer_email,'')=''then'failed'else'pending'end,case when coalesce(customer_email,'')=''then'recipient_missing'else null end,case when coalesce(customer_email,'')=''then pg_catalog.clock_timestamp()else null end),
   (a.id,a.profile_id,a.environment,p_notification_type,'contractor',coalesce(nullif(contractor_email,''),'unsendable@invalid'),
    'booking-notify:'||p_notification_type||':'||a.id||':'||a.version||':contractor',a.version,case when coalesce(contractor_email,'')=''then'failed'else'pending'end,case when coalesce(contractor_email,'')=''then'recipient_missing'else null end,case when coalesce(contractor_email,'')=''then pg_catalog.clock_timestamp()else null end)
 on conflict(appointment_id,notification_type,audience,occurrence_version) do nothing;
 get diagnostics inserted=row_count;return inserted;
end $$;


create or replace function public.get_booking_notification_context(p_notification_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select pg_catalog.to_jsonb(a) from public.booking_notifications n
 join public.appointments a on a.id=n.appointment_id and a.profile_id=n.profile_id and a.environment=n.environment
 where n.id=p_notification_id and n.state='processing'
$$;

create or replace function public.enqueue_booking_notification_transitions()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.appointment_state='confirmed' and old.appointment_state is distinct from new.appointment_state then
   perform public.enqueue_booking_notification(new.id,'confirmed');
 end if;
 if new.appointment_state='cancelled' and old.appointment_state is distinct from new.appointment_state then
   perform public.enqueue_booking_notification(new.id,'cancelled');
 end if;
 if new.refund_state='pending' and old.refund_state is distinct from new.refund_state then
   perform public.enqueue_booking_notification(new.id,'refund_pending');
 end if;
 if new.refund_state='succeeded' and old.refund_state is distinct from new.refund_state then
   perform public.enqueue_booking_notification(new.id,'refund_succeeded');
 end if;
 if new.refund_state='failed' and old.refund_state is distinct from new.refund_state then
   perform public.enqueue_booking_notification(new.id,'refund_failed');
 end if;
 if (new.review_state='late_payment' and old.review_state is distinct from new.review_state)
    or (new.appointment_reason='late_payment_recovered' and old.appointment_reason is distinct from new.appointment_reason) then
   perform public.enqueue_booking_notification(new.id,'late_payment');
 end if;
 if new.calendar_state in('create_failed','cancel_failed') and old.calendar_state is distinct from new.calendar_state then
   perform public.enqueue_booking_notification(new.id,'calendar_failed');
 end if;
 return new;
end $$;
drop trigger if exists appointments_enqueue_booking_notifications on public.appointments;
create trigger appointments_enqueue_booking_notifications after update on public.appointments
for each row execute function public.enqueue_booking_notification_transitions();

create or replace function public.claim_due_booking_notifications(
  p_lease_token uuid,p_limit integer default 25
) returns setof public.booking_notifications language plpgsql security definer set search_path='' as $$
begin
 if p_lease_token is null then raise exception 'lease required' using errcode='22023';end if;
 return query with due as(
   select n.id from public.booking_notifications n
   where n.attempts<8 and((n.state in('pending','retry') and n.next_attempt_at<=pg_catalog.clock_timestamp())
     or(n.state='processing' and n.lease_expires_at<=pg_catalog.clock_timestamp()))
   order by n.next_attempt_at,n.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
 ) update public.booking_notifications n set state='processing',attempts=n.attempts+1,
   lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval '10 minutes',
   fencing_token=n.fencing_token+1,updated_at=pg_catalog.clock_timestamp()
 from due where n.id=due.id returning n.*;
end $$;

create or replace function public.complete_booking_notification(
  p_notification_id uuid,p_lease_token uuid,p_fencing_token bigint,p_provider_message_id text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_provider_message_id!~'^[[:alnum:]_-]{8,200}$' then raise exception 'invalid notification provider identity' using errcode='22023';end if;
 update public.booking_notifications set state='accepted',provider_message_id=p_provider_message_id,
   accepted_at=coalesce(accepted_at,pg_catalog.clock_timestamp()),last_error=null,
   lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
 where id=p_notification_id and state='processing' and lease_token=p_lease_token
   and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp() and(provider_message_id is null or provider_message_id=p_provider_message_id);
 if not found then raise exception 'stale booking notification completion' using errcode='40001';end if;
 -- Provider delivery may race ahead of this response; reduce retained inbox evidence now.
 update public.booking_notifications n set state=case when e.event_type='email.complained'then'complained'when e.event_type='email.bounced'then'bounced'when e.event_type='email.delivered'then'delivered'when e.event_type='email.failed'then'failed'else n.state end,provider_event_id=e.provider_event_id,last_provider_event_at=e.occurred_at,delivered_at=case when e.event_type='email.delivered'then e.occurred_at else n.delivered_at end,failed_at=case when e.event_type in('email.bounced','email.complained','email.failed')then e.occurred_at else n.failed_at end from(select distinct on(provider_message_id)*from public.booking_notification_delivery_events where provider_message_id=p_provider_message_id order by provider_message_id,case event_type when'email.complained'then 5 when'email.bounced'then 4 when'email.delivered'then 3 when'email.failed'then 2 else 1 end desc,occurred_at desc)e where n.id=p_notification_id;
 return true;
end $$;

create or replace function public.fail_booking_notification(
  p_notification_id uuid,p_lease_token uuid,p_fencing_token bigint,p_retryable boolean,p_safe_error text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.booking_notifications set
   state=case when p_retryable and attempts<8 then'retry'else'failed'end,
   next_attempt_at=case when p_retryable and attempts<8 then pg_catalog.clock_timestamp()
     +pg_catalog.make_interval(secs=>least(300,pg_catalog.power(2,attempts)::integer))else next_attempt_at end,
   last_error=left(coalesce(p_safe_error,'Booking notification failed'),240),
   failed_at=case when not p_retryable or attempts>=8 then pg_catalog.clock_timestamp()else failed_at end,
   lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
 where id=p_notification_id and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token;
 if not found then raise exception 'stale booking notification failure' using errcode='40001';end if;return true;
end $$;

create table if not exists public.booking_notification_delivery_events(
 provider_event_id text primary key,provider_message_id text not null,event_type text not null,
 occurred_at timestamptz not null,received_at timestamptz not null default now()
);
alter table public.booking_notification_delivery_events enable row level security;
revoke all on public.booking_notification_delivery_events from public,anon,authenticated;
create or replace function public.ingest_booking_notification_delivery(
  p_provider_event_id text,p_provider_message_id text,p_event_type text,p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare next_state text;inserted boolean;
begin
 next_state:=case p_event_type when'email.delivered'then'delivered'when'email.delivery_delayed'then'delivery_delayed'when'email.bounced'then'bounced'when'email.complained'then'complained'when'email.failed'then'failed'else null end;
 if next_state is null or coalesce(p_provider_event_id,'')=''then raise exception 'unsupported notification delivery event' using errcode='22023';end if;
 insert into public.booking_notification_delivery_events(provider_event_id,provider_message_id,event_type,occurred_at)values(p_provider_event_id,p_provider_message_id,p_event_type,p_occurred_at)on conflict do nothing;inserted:=found;
 if not inserted then return true;end if;
 update public.booking_notifications set state=case when state in('bounced','complained')then state when next_state in('bounced','complained')then next_state when state='delivered'then state when next_state='delivered'then'delivered'when state='failed'then state else next_state end,provider_event_id=p_provider_event_id,last_provider_event_at=greatest(coalesce(last_provider_event_at,p_occurred_at),p_occurred_at),delivered_at=case when next_state='delivered'then coalesce(delivered_at,p_occurred_at)else delivered_at end,failed_at=case when next_state in('bounced','complained','failed')then coalesce(failed_at,p_occurred_at)else failed_at end,updated_at=pg_catalog.clock_timestamp()where provider_message_id=p_provider_message_id;
 return found;
end $$;

revoke all on function public.enqueue_booking_notification(uuid,text),public.get_booking_notification_context(uuid),
 public.enqueue_booking_notification_transitions(),public.claim_due_booking_notifications(uuid,integer),
 public.complete_booking_notification(uuid,uuid,bigint,text),public.fail_booking_notification(uuid,uuid,bigint,boolean,text),
 public.ingest_booking_notification_delivery(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_booking_notification(uuid,text),public.get_booking_notification_context(uuid),
 public.claim_due_booking_notifications(uuid,integer),public.complete_booking_notification(uuid,uuid,bigint,text),
 public.fail_booking_notification(uuid,uuid,bigint,boolean,text) to service_role;
grant execute on function public.ingest_booking_notification_delivery(text,text,text,timestamptz) to service_role;
