-- Items 1-5, 12-14: forward-only provider-evidence authority and contract fencing.
create table if not exists public.booking_provider_evidence(
 event_id uuid primary key references public.provider_event_inbox(id) on delete cascade,
 profile_id uuid not null,environment text not null check(environment in('test','live')),stripe_account_id text not null,
 event_type text not null,provider_event_id text not null,object_id text not null,appointment_id uuid not null,
 payload_sha256 text not null check(payload_sha256~'^[a-f0-9]{64}$'),observed_at timestamptz not null default now(),
 unique(profile_id,environment,provider_event_id),foreign key(appointment_id,profile_id,environment) references public.appointments(id,profile_id,environment)
);
alter table public.booking_provider_evidence enable row level security;
revoke all on public.booking_provider_evidence from public,anon,authenticated;

-- All accepted facts are parsed from the immutable, signature-verified inbox payload while its lease is locked.
-- The worker supplies only claim identity; it cannot project money or object fields.
create or replace function public.apply_booking_provider_evidence(p_event_id uuid,p_lease_token uuid,p_fencing_token bigint)returns boolean language plpgsql security definer set search_path='' as $tag$
declare i public.provider_event_inbox%rowtype;o jsonb;p public.booking_payments%rowtype;a public.appointments%rowtype;v_appointment_id uuid;object_id text;intent_id text;charge_id text;amount_minor bigint;currency_code text;is_paid boolean;refunded_minor bigint;dispute_id text;provider_created bigint;dispute_rank integer;
begin
 select * into strict i from public.provider_event_inbox where id=p_event_id and provider='stripe' and event_family='booking' and processing_state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp() for update;
 if i.payload->>'id'<>i.event_id or i.payload->>'type'<>i.event_type or (i.payload->>'livemode')::boolean<>(i.environment='live') then raise exception 'immutable provider envelope mismatch' using errcode='22023';end if;
 o:=i.payload->'data'->'object';object_id:=o->>'id';provider_created:=coalesce((i.payload->>'created')::bigint,0);
 if i.event_type like 'checkout.session.%' then
  v_appointment_id:=nullif(o->'metadata'->>'appointmentId','')::uuid;intent_id:=nullif(o->>'payment_intent','');amount_minor:=coalesce((o->>'amount_total')::bigint,0);currency_code:=pg_catalog.upper(coalesce(o->>'currency',''));is_paid:=i.event_type in('checkout.session.completed','checkout.session.async_payment_succeeded')and o->>'payment_status'='paid'and o->>'status'='complete';
 elsif i.event_type in('charge.refunded','refund.updated','charge.dispute.created','charge.dispute.updated','charge.dispute.closed') then
  if i.event_type='refund.updated' then intent_id:=nullif(o->>'payment_intent','');charge_id:=nullif(o->>'charge','');
  elsif i.event_type like 'charge.dispute.%' then charge_id:=nullif(o->>'charge','');dispute_id:=object_id;
  else intent_id:=nullif(o->>'payment_intent','');charge_id:=object_id;refunded_minor:=coalesce((o->>'amount_refunded')::bigint,0);end if;
  select bp.appointment_id into strict v_appointment_id from public.booking_payments bp where bp.profile_id=i.profile_id and bp.environment=i.environment and bp.stripe_account_id=i.account_context and((charge_id is not null and bp.charge_id=charge_id)or(intent_id is not null and bp.payment_intent_id=intent_id));
 else raise exception 'unsupported authoritative booking evidence' using errcode='22023';end if;
 if v_appointment_id is null or object_id is null or i.account_context is null then raise exception 'provider correlation missing' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_appointment_id::text||':booking-appointment',0));
 select * into strict p from public.booking_payments where appointment_id=v_appointment_id and profile_id=i.profile_id and environment=i.environment and stripe_account_id=i.account_context for update;
 select * into strict a from public.appointments where id=p.appointment_id for update;
 insert into public.booking_provider_evidence(event_id,profile_id,environment,stripe_account_id,event_type,provider_event_id,object_id,appointment_id,payload_sha256)values(i.id,i.profile_id,i.environment,i.account_context,i.event_type,i.event_id,object_id,v_appointment_id,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(i.payload::text,'UTF8'),'sha256'),'hex'))on conflict(event_id)do nothing;
 if i.event_type like 'checkout.session.%' then
  if p.checkout_session_id<>object_id or p.expected_amount_minor<>amount_minor or p.currency<>currency_code or o->'metadata'->>'kind'<>'booking' then raise exception 'authoritative checkout evidence mismatch' using errcode='P0001';end if;
  if is_paid and a.start_at<=pg_catalog.clock_timestamp() then
   update public.booking_payments set payment_state='paid',payment_intent_id=coalesce(payment_intent_id,intent_id),amount_paid_minor=amount_minor,paid_at=coalesce(paid_at,pg_catalog.clock_timestamp()),refund_state='pending',refund_requested_at=coalesce(refund_requested_at,pg_catalog.clock_timestamp()),refund_generation=greatest(refund_generation,a.refund_generation+case when a.refund_state<>'pending'then 1 else 0 end),refund_idempotency_key='booking-refund:'||a.id||':'||(a.refund_generation+case when a.refund_state<>'pending'then 1 else 0 end),updated_at=pg_catalog.clock_timestamp() where id=p.id;
   update public.appointments set payment_state='paid',appointment_state='cancelled',appointment_reason='late_payment_refund',cancelled_at=coalesce(cancelled_at,pg_catalog.clock_timestamp()),refund_state='pending',review_state='late_payment',refund_generation=refund_generation+case when refund_state<>'pending'then 1 else 0 end,updated_at=pg_catalog.clock_timestamp(),version=version+1 where id=a.id returning * into a;
   insert into public.integration_outbox(profile_id,environment,appointment_id,command_type,idempotency_key,desired_appointment_version,effect_generation,payload)values(a.profile_id,a.environment,a.id,'refund','booking-refund:'||a.id||':'||a.refund_generation,a.version,a.refund_generation,pg_catalog.jsonb_build_object('amount',amount_minor,'reason','late_payment_no_fresh_freebusy'))on conflict(profile_id,environment,idempotency_key)do nothing;
  elsif is_paid and a.appointment_state in('payment_pending','confirmed') then
   update public.booking_payments set payment_state='paid',payment_intent_id=coalesce(payment_intent_id,intent_id),amount_paid_minor=amount_minor,paid_at=coalesce(paid_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp() where id=p.id;
   update public.appointments set payment_state='paid',appointment_state='confirmed',calendar_state=case when calendar_state in('not_required','create_failed')then'create_pending'else calendar_state end,calendar_generation=calendar_generation+case when calendar_state in('not_required','create_failed')then 1 else 0 end,confirmed_at=coalesce(confirmed_at,pg_catalog.clock_timestamp()),reservation_expires_at=null,updated_at=pg_catalog.clock_timestamp(),version=version+1 where id=a.id returning * into a;perform public.enqueue_booking_calendar_create(a.id);
  elsif i.event_type in('checkout.session.async_payment_failed','checkout.session.expired') then
   update public.booking_payments set payment_state='failed',failed_at=coalesce(failed_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp() where id=p.id and payment_state<>'paid';
   update public.appointments set appointment_state='cancelled',appointment_reason='payment_failed',payment_state='failed',cancelled_at=coalesce(cancelled_at,pg_catalog.clock_timestamp()),version=version+1,updated_at=pg_catalog.clock_timestamp()where id=a.id and appointment_state in('held','payment_pending');
  end if;
 elsif i.event_type='charge.refunded' then
  if refunded_minor<0 or refunded_minor>p.amount_paid_minor then raise exception 'authoritative refund evidence invalid' using errcode='P0001';end if;
  update public.booking_payments set amount_refunded_minor=greatest(amount_refunded_minor,refunded_minor),refund_state=case when refunded_minor>=amount_paid_minor then'succeeded'else refund_state end,refunded_at=case when refunded_minor>=amount_paid_minor then coalesce(refunded_at,pg_catalog.clock_timestamp())else refunded_at end,updated_at=pg_catalog.clock_timestamp() where id=p.id;
  update public.appointments set refund_state=case when refunded_minor>=p.amount_paid_minor then'succeeded'else refund_state end,updated_at=pg_catalog.clock_timestamp() where id=a.id;
 elsif i.event_type='refund.updated' then null;
 else
  dispute_rank:=case when i.event_type='charge.dispute.closed'then 2 else 1 end;
  if provider_created>p.dispute_provider_created or(provider_created=p.dispute_provider_created and dispute_rank>=p.dispute_status_rank)then update public.booking_payments set charge_id=coalesce(charge_id,apply_booking_provider_evidence.charge_id),payment_state=case when i.event_type='charge.dispute.closed'and dispute_state='open'then'paid'else'disputed'end,dispute_state=case when i.event_type='charge.dispute.closed'then'closed'else'open'end,dispute_id=apply_booking_provider_evidence.dispute_id,dispute_provider_created=provider_created,dispute_status_rank=dispute_rank,updated_at=pg_catalog.clock_timestamp() where id=p.id;end if;
 end if;
 update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,safe_error=null where id=i.id;return found;
end $tag$;

-- V1 work is evidence to reconcile, not executable V2 work.
create or replace function public.block_legacy_booking_effect_claims()returns trigger language plpgsql set search_path='' as $tag$ begin if new.effect_contract_version=1 and new.state in('processing','succeeded') and old.state is distinct from new.state then raise exception 'legacy provider effect requires quarantine reconciliation' using errcode='P0001';end if;return new;end $tag$;
drop trigger if exists integration_outbox_block_v1_claim on public.integration_outbox;
create trigger integration_outbox_block_v1_claim before update on public.integration_outbox for each row execute function public.block_legacy_booking_effect_claims();
revoke all on function public.apply_booking_provider_evidence(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.apply_booking_provider_evidence(uuid,uuid,bigint) to service_role;

-- Provider refund truth and command convergence commit together; response loss is replay-safe.
create or replace function public.settle_booking_refund_command(p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_refund_id text,p_state text,p_absolute_refunded bigint,p_provider_created bigint)returns boolean language plpgsql security definer set search_path='' as $tag$
declare o public.integration_outbox%rowtype;p public.booking_payments%rowtype;a public.appointments%rowtype;r public.booking_refunds%rowtype;
begin
 select * into strict o from public.integration_outbox where id=p_command_id and command_type='refund' and effect_contract_version=2 and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp() for update;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(o.appointment_id::text||':booking-appointment',0));
 select * into strict p from public.booking_payments where appointment_id=o.appointment_id and profile_id=o.profile_id and environment=o.environment and refund_generation=o.effect_generation for update;
 select * into strict a from public.appointments where id=p.appointment_id and profile_id=p.profile_id and environment=p.environment for update;
 select * into strict r from public.booking_refunds where payment_id=p.id and generation=o.effect_generation for update;
 if p_refund_id!~'^re_'or p_state not in('pending','requires_action','succeeded','failed','cancelled')or p_absolute_refunded<0 or p_absolute_refunded>p.amount_paid_minor then raise exception 'invalid refund provider result' using errcode='22023';end if;
 if r.stripe_refund_id is not null and r.stripe_refund_id<>p_refund_id then raise exception 'refund provider identity mismatch' using errcode='P0001';end if;
 update public.booking_refunds set stripe_refund_id=p_refund_id,state=p_state,provider_created=coalesce(provider_created,p_provider_created),provider_updated_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=r.id;
 update public.booking_payments set amount_refunded_minor=greatest(amount_refunded_minor,p_absolute_refunded),refund_id=case when p_absolute_refunded>=amount_paid_minor then p_refund_id else refund_id end,refund_state=case when p_absolute_refunded>=amount_paid_minor then'succeeded'when p_state in('failed','cancelled')then'failed'else'pending'end,updated_at=pg_catalog.clock_timestamp() where id=p.id;
 update public.appointments set refund_state=case when p_absolute_refunded>=p.amount_paid_minor then'succeeded'when p_state in('failed','cancelled')then'failed'else'pending'end,review_state=case when p_state in('failed','cancelled')then'refund_failure'else review_state end,updated_at=pg_catalog.clock_timestamp(),version=version+1 where id=a.id and refund_generation=o.effect_generation;
 update public.integration_outbox set state=case when p_state='succeeded'then'succeeded'when p_state in('failed','cancelled')then'dead_letter'else'failed'end,completed_at=case when p_state='succeeded'then pg_catalog.clock_timestamp()else null end,terminal_at=case when p_state in('succeeded','failed','cancelled')then pg_catalog.clock_timestamp()else null end,next_attempt_at=case when p_state in('pending','requires_action')then pg_catalog.clock_timestamp()+interval '15 minutes'else next_attempt_at end,lease_token=null,lease_expires_at=null,safe_error=case when p_state in('pending','requires_action')then'Stripe refund pending reconciliation'when p_state in('failed','cancelled')then'Stripe refund failed'else null end where id=o.id;
 return found;
end $tag$;
revoke all on function public.settle_booking_refund_command(uuid,uuid,bigint,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.settle_booking_refund_command(uuid,uuid,bigint,text,text,bigint,bigint) to service_role;

-- Google desired-state candidates are leased/fenced; confirmed+absent is recreated with the frozen identity.
alter table public.calendar_event_links add column if not exists reconcile_lease_token uuid,add column if not exists reconcile_lease_expires_at timestamptz,add column if not exists reconcile_fencing_token bigint not null default 0;
create or replace function public.claim_booking_calendar_reconciliation(p_environment text,p_lease_token uuid,p_limit integer default 25)returns table(link jsonb,appointment jsonb,epoch jsonb)language plpgsql security definer set search_path='' as $tag$
begin
 if p_environment not in('test','live')then raise exception 'invalid environment' using errcode='22023';end if;
 return query with due as(select l.id from public.calendar_event_links l join public.appointments a on a.id=l.appointment_id and a.profile_id=l.profile_id and a.environment=l.environment where l.environment=p_environment and l.sync_state in('pending','ambiguous','failed') and(l.reconcile_lease_expires_at is null or l.reconcile_lease_expires_at<=pg_catalog.clock_timestamp())order by l.updated_at for update of l skip locked limit greatest(1,least(coalesce(p_limit,25),100))),claimed as(update public.calendar_event_links l set reconcile_lease_token=p_lease_token,reconcile_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',reconcile_fencing_token=l.reconcile_fencing_token+1,last_attempt_at=pg_catalog.clock_timestamp()from due where l.id=due.id returning l.*)select pg_catalog.to_jsonb(c),pg_catalog.to_jsonb(a),pg_catalog.to_jsonb(e)from claimed c join public.appointments a on a.id=c.appointment_id and a.profile_id=c.profile_id and a.environment=c.environment join public.calendar_destination_epochs e on e.id=c.destination_epoch_id;
end $tag$;
create or replace function public.settle_booking_calendar_claim(p_link_id uuid,p_lease_token uuid,p_fencing_token bigint,p_expected_event_id text,p_state text)returns boolean language plpgsql security definer set search_path='' as $tag$
declare l public.calendar_event_links%rowtype;
begin
 if p_state not in('created','cancelled','failed')then raise exception 'invalid calendar reconciliation state' using errcode='22023';end if;
 select * into strict l from public.calendar_event_links where id=p_link_id and google_event_id=p_expected_event_id and reconcile_lease_token=p_lease_token and reconcile_fencing_token=p_fencing_token and reconcile_lease_expires_at>pg_catalog.clock_timestamp() for update;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(l.appointment_id::text||':booking-appointment',0));
 update public.calendar_event_links set sync_state=p_state,reconcile_lease_token=null,reconcile_lease_expires_at=null,safe_error=case when p_state='failed'then'calendar_identity_conflict'else null end,updated_at=pg_catalog.clock_timestamp()where id=l.id;
 update public.appointments set calendar_state=case when p_state='created'then'created'when p_state='cancelled'then'cancelled'when appointment_state='confirmed'then'create_failed'else'cancel_failed'end,review_state=case when p_state='failed'then'calendar_reconciliation'when review_state='calendar_reconciliation'then'none'else review_state end,version=version+1,updated_at=pg_catalog.clock_timestamp()where id=l.appointment_id and((p_state='created'and appointment_state='confirmed')or(p_state='cancelled'and appointment_state='cancelled')or p_state='failed');return found;
end $tag$;
revoke all on function public.claim_booking_calendar_reconciliation(text,uuid,integer),public.settle_booking_calendar_claim(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.claim_booking_calendar_reconciliation(text,uuid,integer),public.settle_booking_calendar_claim(uuid,uuid,bigint,text,text) to service_role;

-- Superseded parameter-authority and split-settlement RPCs are not callable after cutover.
revoke execute on function public.apply_booking_payment_event(uuid,uuid,bigint,uuid,text,text,text,bigint,text,boolean) from service_role;
revoke execute on function public.apply_booking_money_mirror_event(uuid,uuid,bigint,text,text,bigint,text,text,text,bigint) from service_role;
revoke execute on function public.record_booking_refund_provider_result(uuid,bigint,text,text,bigint,bigint) from service_role;
revoke execute on function public.list_booking_calendar_reconciliation(integer) from service_role;
revoke execute on function public.settle_booking_calendar_reconciliation(uuid,text,text) from service_role;

-- Every Stripe/session claim shares the same v2 cutover admission fence.
create or replace function public.claim_due_booking_payment_events(p_environment text,p_lease_token uuid,p_limit integer default 25)returns setof public.provider_event_inbox language plpgsql security definer set search_path='' as $tag$
begin
 if p_lease_token is null or p_environment not in('test','live')then raise exception 'invalid booking event claim' using errcode='22023';end if;
 return query with due as(select i.id from public.provider_event_inbox i where i.provider='stripe'and i.event_family='booking'and i.environment=p_environment and i.profile_id is not null and public.booking_cutover_enabled(i.profile_id,i.environment)and i.processing_state in('pending','processing','failed')and i.next_attempt_at<=pg_catalog.clock_timestamp()and(i.lease_expires_at is null or i.lease_expires_at<=pg_catalog.clock_timestamp())order by i.received_at for update skip locked limit greatest(1,least(coalesce(p_limit,25),100)))update public.provider_event_inbox i set processing_state='processing',attempts=i.attempts+1,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',fencing_token=i.fencing_token+1 from due where i.id=due.id returning i.*;
end $tag$;
create or replace function public.claim_ambiguous_booking_checkouts(p_environment text,p_lease_token uuid,p_limit integer default 25)returns table(payment_id uuid,appointment_id uuid,profile_id uuid,environment text,stripe_account_id text,checkout_idempotency_key text,checkout_provider_expires_at timestamptz,checkout_operation_id uuid,expected_amount_minor bigint,currency text,website_id uuid,service_snapshot jsonb,customer_snapshot jsonb,checkout_fencing_token bigint)language plpgsql security definer set search_path='' as $tag$
begin
 if p_lease_token is null then raise exception 'lease required' using errcode='22023';end if;
 return query with due as(select p.id from public.booking_payments p join public.appointments a on a.id=p.appointment_id and a.profile_id=p.profile_id and a.environment=p.environment where p.environment=p_environment and p.booking_contract_version=2 and public.booking_cutover_enabled(p.profile_id,p.environment)and p.payment_state='creating'and p.checkout_idempotency_key is not null and p.checkout_provider_expires_at>pg_catalog.clock_timestamp()and(p.checkout_session_id is null or(a.appointment_state='held'and a.payment_state='creating'))and(p.checkout_lease_expires_at is null or p.checkout_lease_expires_at<=pg_catalog.clock_timestamp())order by p.updated_at for update of p skip locked limit greatest(1,least(coalesce(p_limit,25),100))),claimed as(update public.booking_payments p set checkout_lease_token=p_lease_token,checkout_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',checkout_fencing_token=p.checkout_fencing_token+1,updated_at=pg_catalog.clock_timestamp()from due where p.id=due.id returning p.*)select p.id,p.appointment_id,p.profile_id,p.environment,p.stripe_account_id,p.checkout_idempotency_key,p.checkout_provider_expires_at,p.checkout_operation_id,p.expected_amount_minor,p.currency,a.website_id,a.service_snapshot,a.customer_snapshot,p.checkout_fencing_token from claimed p join public.appointments a on a.id=p.appointment_id;
end $tag$;
create or replace function public.claim_due_booking_sessions(p_environment text,p_lease_token uuid,p_limit integer default 25)returns setof public.booking_payments language plpgsql security definer set search_path='' as $tag$
begin
 if p_lease_token is null then raise exception 'lease required' using errcode='22023';end if;
 return query with due as(select p.id from public.booking_payments p join public.appointments a on a.id=p.appointment_id and a.profile_id=p.profile_id and a.environment=p.environment where p.environment=p_environment and p.booking_contract_version=2 and public.booking_cutover_enabled(p.profile_id,p.environment)and p.checkout_session_id is not null and((a.appointment_state='payment_pending'and a.reservation_expires_at<=pg_catalog.clock_timestamp()and p.payment_state='pending')or(a.appointment_state='cancelled'and p.payment_state in('creating','pending')))and(p.checkout_lease_expires_at is null or p.checkout_lease_expires_at<=pg_catalog.clock_timestamp())order by a.reservation_expires_at for update of p skip locked limit greatest(1,least(coalesce(p_limit,25),100)))update public.booking_payments p set checkout_lease_token=p_lease_token,checkout_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',checkout_fencing_token=p.checkout_fencing_token+1,updated_at=pg_catalog.clock_timestamp()from due where p.id=due.id returning p.*;
end $tag$;
