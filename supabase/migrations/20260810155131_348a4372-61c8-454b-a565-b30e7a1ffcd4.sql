-- Add dedicated business_name columns (separate from personal full_name)

alter table public.profiles add column if not exists business_name text;
alter table public.checkout_sessions add column if not exists business_name text;