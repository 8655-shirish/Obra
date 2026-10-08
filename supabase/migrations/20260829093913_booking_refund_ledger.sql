-- One immutable Stripe refund identity per submission; payment totals remain absolute provider truth.
create table if not exists public.booking_refunds(
 id uuid primary key default gen_random_uuid(),payment_id uuid not null references public.booking_payments(id) on delete cascade,appointment_id uuid not null references public.appointments(id) on delete cascade,profile_id uuid not null,environment text not null check(environment in('test','live')),generation bigint not null check(generation>0),stripe_account_id text not null,payment_intent_id text not null,idempotency_key text not null,amount_minor bigint not null check(amount_minor>0),stripe_refund_id text,state text not null default 'pending' check(state in('pending','requires_action','succeeded','failed','cancelled')),provider_created bigint,provider_updated_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(payment_id,generation),unique(environment,stripe_account_id,idempotency_key)
);
create unique index if not exists booking_refunds_provider_identity_uq on public.booking_refunds(environment,stripe_account_id,stripe_refund_id) where stripe_refund_id is not null;
alter table public.booking_refunds enable row level security;revoke all on public.booking_refunds from public,anon,authenticated;
create or replace function public.ensure_booking_refund_submission(p_appointment_id uuid,p_generation bigint)returns public.booking_refunds language plpgsql security definer set search_path='' as $$
declare p public.booking_payments%rowtype;r public.booking_refunds%rowtype;
begin
 select * into strict p from public.booking_payments where appointment_id=p_appointment_id and refund_generation=p_generation for update;
 insert into public.booking_refunds(payment_id,appointment_id,profile_id,environment,generation,stripe_account_id,payment_intent_id,idempotency_key,amount_minor) values(p.id,p.appointment_id,p.profile_id,p.environment,p_generation,p.stripe_account_id,p.payment_intent_id,p.refund_idempotency_key,p.amount_paid_minor-p.amount_refunded_minor) on conflict(payment_id,generation)do nothing;
 select * into strict r from public.booking_refunds where payment_id=p.id and generation=p_generation;return r;
end $$;
create or replace function public.record_booking_refund_provider_result(p_appointment_id uuid,p_generation bigint,p_refund_id text,p_state text,p_absolute_refunded bigint,p_provider_created bigint)returns boolean language plpgsql security definer set search_path='' as $$
declare p public.booking_payments%rowtype;r public.booking_refunds%rowtype;
begin
 select * into strict p from public.booking_payments where appointment_id=p_appointment_id for update;select * into strict r from public.booking_refunds where payment_id=p.id and generation=p_generation for update;
 if p_refund_id!~'^re_'or p_state not in('pending','requires_action','succeeded','failed','cancelled')or p_absolute_refunded<0 or p_absolute_refunded>p.amount_paid_minor then raise exception 'invalid refund provider result' using errcode='22023';end if;
 if r.stripe_refund_id is not null and r.stripe_refund_id<>p_refund_id then raise exception 'refund provider identity mismatch' using errcode='P0001';end if;
 update public.booking_refunds set stripe_refund_id=p_refund_id,state=p_state,provider_created=coalesce(provider_created,p_provider_created),provider_updated_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=r.id;
 update public.booking_payments set amount_refunded_minor=greatest(amount_refunded_minor,p_absolute_refunded),refund_id=case when p_absolute_refunded>=amount_paid_minor then p_refund_id else refund_id end,refund_state=case when p_absolute_refunded>=amount_paid_minor then'succeeded'when p_state in('failed','cancelled')then'failed'else'pending'end,updated_at=pg_catalog.clock_timestamp() where id=p.id;return true;
end $$;
revoke all on function public.ensure_booking_refund_submission(uuid,bigint),public.record_booking_refund_provider_result(uuid,bigint,text,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.ensure_booking_refund_submission(uuid,bigint),public.record_booking_refund_provider_result(uuid,bigint,text,text,bigint,bigint) to service_role;
