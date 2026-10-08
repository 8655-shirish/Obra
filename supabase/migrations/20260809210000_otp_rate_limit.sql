-- OTP send rate limiting (service-role only; no client policies)

create table public.otp_send_log (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('login', 'checkout')),
  created_at timestamptz not null default now()
);

create index otp_send_log_email_purpose_created_idx
  on public.otp_send_log (email, purpose, created_at desc);

alter table public.otp_send_log enable row level security;
