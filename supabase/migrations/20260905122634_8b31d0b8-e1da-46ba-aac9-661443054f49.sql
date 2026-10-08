alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_status_check;

alter table public.checkout_sessions
  add constraint checkout_sessions_status_check
  check (status in ('pending_payment', 'pending_otp', 'completed', 'expired'));