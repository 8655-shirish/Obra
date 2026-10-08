-- SaaS Stripe checkout: pending_payment, plan, Stripe ids on sessions and subscriptions.

alter table public.checkout_sessions
  add column if not exists plan text not null default 'starter';

alter table public.checkout_sessions
  add column if not exists stripe_checkout_session_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checkout_sessions_plan_check'
  ) then
    alter table public.checkout_sessions
      add constraint checkout_sessions_plan_check
      check (plan in ('starter', 'pro'));
  end if;
end
$$;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_status_check;

alter table public.checkout_sessions
  add constraint checkout_sessions_status_check
  check (status in ('pending_payment', 'pending_otp', 'completed', 'expired'));

create unique index if not exists checkout_sessions_stripe_session_uidx
  on public.checkout_sessions (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.subscriptions
  add column if not exists stripe_customer_id text;

alter table public.subscriptions
  add column if not exists stripe_subscription_id text;

alter table public.subscriptions
  add column if not exists stripe_price_id text;
