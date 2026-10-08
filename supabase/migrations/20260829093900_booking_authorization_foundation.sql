-- Bucket 1 payment, booking, calendar, and authorization foundation.
-- Provider credentials and provider calls are deliberately out of scope.

create extension if not exists btree_gist with schema extensions;

-- Environment is explicit at every authority boundary. Existing local rows are test data.
alter table public.profiles add column if not exists environment text not null default 'test'
  check (environment in ('test', 'live'));
alter table public.websites add column if not exists environment text not null default 'test'
  check (environment in ('test', 'live'));
alter table public.subscriptions add column if not exists environment text not null default 'test'
  check (environment in ('test', 'live'));
alter table public.subscriptions add column if not exists provider_subscription_id text;
alter table public.subscriptions add column if not exists provider_customer_id text;
alter table public.subscriptions add column if not exists provider_status text;
alter table public.subscriptions add column if not exists current_period_end timestamptz;
alter table public.subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table public.subscriptions add column if not exists entitlement_ends_at timestamptz;
alter table public.subscriptions add column if not exists last_provider_event_at timestamptz;

create unique index if not exists profiles_id_environment_uk on public.profiles(id, environment);
create unique index if not exists websites_id_user_environment_uk on public.websites(id, user_id, environment);
create unique index if not exists subscriptions_id_user_environment_uk on public.subscriptions(id, user_id, environment);
create unique index if not exists subscriptions_provider_identity_uk
  on public.subscriptions(environment, provider_subscription_id)
  where provider_subscription_id is not null;

alter table public.websites drop constraint if exists websites_user_environment_fkey;
alter table public.websites add constraint websites_user_environment_fkey
  foreign key (user_id, environment) references public.profiles(id, environment);
alter table public.subscriptions drop constraint if exists subscriptions_user_environment_fkey;
alter table public.subscriptions add constraint subscriptions_user_environment_fkey
  foreign key (user_id, environment) references public.profiles(id, environment);

-- A purchase grants one website an entitlement; shared profile configuration never does.
create table public.website_entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  website_id uuid not null,
  subscription_id uuid,
  environment text not null check (environment in ('test', 'live')),
  plan text not null check (plan in ('starter', 'pro')),
  state text not null default 'pending' check (state in ('pending','active','grace','suspended','expired','cancelled')),
  booking_admission boolean not null default false,
  quote_admission boolean not null default false,
  purchased_at timestamptz not null default now(),
  effective_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, environment),
  unique (id, profile_id, environment),
  constraint website_entitlements_website_tenant_fkey foreign key (website_id, profile_id, environment)
    references public.websites(id, user_id, environment) on delete cascade,
  constraint website_entitlements_subscription_tenant_fkey foreign key (subscription_id, profile_id, environment)
    references public.subscriptions(id, user_id, environment),
  constraint website_entitlements_admission_check check (
    (booking_admission = false or (plan = 'pro' and state in ('active','grace')))
    and (quote_admission = false or (plan = 'starter' and state in ('active','grace')))
  )
);
create index website_entitlements_profile_idx on public.website_entitlements(profile_id, environment);

create table public.booking_services (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  name text not null default 'Appointment' check (char_length(name) between 1 and 120),
  description text,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 1440),
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes between 5 and 1440),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 1440),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 1440),
  minimum_notice_minutes integer not null default 1440 check (minimum_notice_minutes between 0 and 525600),
  booking_horizon_days integer not null default 60 check (booking_horizon_days between 1 and 730),
  location_type text not null default 'customer_address' check (location_type in ('customer_address','business_address','remote','other')),
  location_instructions text,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  payment_policy text not null default 'full_amount' check (payment_policy = 'full_amount'),
  active boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, environment),
  unique (id, profile_id, environment),
  foreign key (profile_id, environment) references public.profiles(id, environment) on delete cascade
);

create table public.availability_schedules (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  service_id uuid not null,
  environment text not null check (environment in ('test','live')),
  time_zone text not null check (char_length(time_zone) between 1 and 100),
  active boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, environment),
  unique (id, profile_id, environment),
  foreign key (service_id, profile_id, environment) references public.booking_services(id, profile_id, environment) on delete cascade
);

create table public.availability_intervals (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null,
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  weekday integer not null check (weekday between 0 and 6),
  local_start time not null,
  local_end time not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (schedule_id, weekday, sort_order),
  foreign key (schedule_id, profile_id, environment) references public.availability_schedules(id, profile_id, environment) on delete cascade,
  check (local_start < local_end),
  exclude using gist (
    schedule_id with =,
    weekday with =,
    int4range((extract(epoch from local_start) / 60)::integer, (extract(epoch from local_end) / 60)::integer, '[)') with &&
  )
);

create table public.availability_overrides (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null,
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  local_date date not null,
  override_type text not null check (override_type in ('unavailable','custom_hours')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, local_date),
  unique (id, profile_id, environment),
  foreign key (schedule_id, profile_id, environment) references public.availability_schedules(id, profile_id, environment) on delete cascade
);

create table public.availability_override_intervals (
  id uuid primary key default gen_random_uuid(),
  override_id uuid not null,
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  local_start time not null,
  local_end time not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (override_id, sort_order),
  foreign key (override_id, profile_id, environment) references public.availability_overrides(id, profile_id, environment) on delete cascade,
  check (local_start < local_end),
  exclude using gist (
    override_id with =,
    int4range((extract(epoch from local_start) / 60)::integer, (extract(epoch from local_end) / 60)::integer, '[)') with &&
  )
);

create table public.booking_customers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  full_name text not null,
  email_normalized text not null,
  phone_normalized text not null,
  address_snapshot jsonb not null,
  notes text,
  source_website_id uuid not null,
  consented_at timestamptz,
  consent_document_id text,
  consent_version text,
  consent_digest text,
  created_at timestamptz not null default now(),
  -- 93900 is independently deployable before the 93911 public writer exists. Foundation-wave
  -- identity rows may therefore carry no consent claim. Public booking in 93911 requires and
  -- atomically records the complete canonical quartet; partial or invented evidence is forbidden.
  constraint booking_customers_consent_evidence_all_or_none_check check (
    pg_catalog.num_nonnulls(consented_at, consent_document_id, consent_version, consent_digest) = 0
    or (
      pg_catalog.num_nonnulls(consented_at, consent_document_id, consent_version, consent_digest) = 4
      and consent_digest ~ '^[a-f0-9]{64}$'
    )
  ),
  unique (id, profile_id, environment),
  foreign key (source_website_id, profile_id, environment) references public.websites(id, user_id, environment),
  foreign key (profile_id, environment) references public.profiles(id, environment) on delete cascade
);
create index booking_customers_profile_email_idx on public.booking_customers(profile_id, environment, email_normalized);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  website_id uuid not null,
  entitlement_id uuid not null,
  service_id uuid not null,
  customer_id uuid not null,
  environment text not null check (environment in ('test','live')),
  public_reference uuid not null default gen_random_uuid() unique,
  start_at timestamptz not null,
  end_at timestamptz not null,
  local_date date not null,
  local_start time not null,
  time_zone text not null,
  location_snapshot jsonb not null,
  customer_snapshot jsonb not null,
  service_snapshot jsonb not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes >= 0),
  capacity_range tstzrange not null,
  appointment_state text not null default 'held' check (appointment_state in ('held','payment_pending','confirmed','cancelled')),
  appointment_reason text,
  payment_state text not null default 'not_started' check (payment_state in ('not_started','creating','pending','paid','failed','disputed')),
  refund_state text not null default 'not_requested' check (refund_state in ('not_requested','pending','succeeded','failed')),
  calendar_state text not null default 'not_required' check (calendar_state in ('not_required','create_pending','created','create_failed','cancel_pending','cancelled','cancel_failed')),
  review_state text not null default 'none' check (review_state in ('none','late_payment','refund_failure','calendar_reconciliation','provider_inconsistency')),
  version bigint not null default 1 check (version > 0),
  reservation_expires_at timestamptz,
  confirmed_at timestamptz,
  cancellation_requested_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, profile_id, environment),
  foreign key (website_id, profile_id, environment) references public.websites(id, user_id, environment),
  foreign key (entitlement_id, profile_id, environment) references public.website_entitlements(id, profile_id, environment),
  foreign key (service_id, profile_id, environment) references public.booking_services(id, profile_id, environment),
  foreign key (customer_id, profile_id, environment) references public.booking_customers(id, profile_id, environment),
  check (start_at < end_at),
  check ((appointment_state in ('held','payment_pending') and reservation_expires_at is not null) or appointment_state in ('confirmed','cancelled')),
  exclude using gist (
    profile_id with =,
    environment with =,
    capacity_range with &&
  ) where (appointment_state in ('held','payment_pending','confirmed'))
);
create index appointments_profile_start_idx on public.appointments(profile_id, environment, start_at);
create index appointments_hold_expiry_idx on public.appointments(reservation_expires_at) where appointment_state in ('held','payment_pending');

create table public.appointment_operations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  appointment_id uuid not null,
  environment text not null check (environment in ('test','live')),
  operation_type text not null check (operation_type in ('reserve','checkout_create','expire_hold','payment_success','cancel','refund','calendar_create','calendar_cancel','reconcile')),
  client_request_id uuid not null,
  request_hash text not null,
  request_capability_hash text check (request_capability_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'reserved' check (state in ('reserved','creating','created','processing','succeeded','ambiguous','failed')),
  result jsonb,
  error_code text,
  lease_token uuid,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (profile_id, environment, operation_type, client_request_id),
  unique (id, profile_id, environment),
  foreign key (appointment_id, profile_id, environment) references public.appointments(id, profile_id, environment) on delete cascade
);

create table public.stripe_connected_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  stripe_account_id text,
  configuration jsonb not null default '{}'::jsonb,
  onboarding_state text not null default 'not_started' check (onboarding_state in ('not_started','pending','ready','restricted','disabled')),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  capabilities jsonb not null default '{}'::jsonb,
  requirements jsonb not null default '{}'::jsonb,
  reconnect_reason text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, environment),
  unique (id, profile_id, environment),
  unique (environment, stripe_account_id),
  foreign key (profile_id, environment) references public.profiles(id, environment) on delete cascade
);

create table public.booking_payments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  appointment_id uuid not null,
  connected_account_id uuid,
  environment text not null check (environment in ('test','live')),
  expected_amount_minor bigint not null check (expected_amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  checkout_session_id text,
  payment_intent_id text,
  charge_id text,
  refund_id text,
  payment_state text not null default 'not_started' check (payment_state in ('not_started','creating','pending','paid','failed','disputed')),
  refund_state text not null default 'not_requested' check (refund_state in ('not_requested','pending','succeeded','failed')),
  amount_paid_minor bigint not null default 0 check (amount_paid_minor >= 0),
  amount_refunded_minor bigint not null default 0 check (amount_refunded_minor >= 0 and amount_refunded_minor <= amount_paid_minor),
  dispute_state text not null default 'none' check (dispute_state in ('none','open','won','lost','closed')),
  failure_code text,
  receipt_url text,
  paid_at timestamptz,
  refund_requested_at timestamptz,
  refunded_at timestamptz,
  failed_at timestamptz,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, environment),
  unique (id, profile_id, environment),
  foreign key (appointment_id, profile_id, environment) references public.appointments(id, profile_id, environment) on delete cascade,
  foreign key (connected_account_id, profile_id, environment) references public.stripe_connected_accounts(id, profile_id, environment)
);

create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  external_user_id text not null,
  pipedream_account_id text,
  app_slug text not null default 'google_calendar',
  identity_metadata jsonb not null default '{}'::jsonb,
  health_state text not null default 'not_connected' check (health_state in ('not_connected','pending','healthy','degraded','disconnected')),
  reconnect_reason text,
  last_verified_at timestamptz,
  last_synchronized_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, environment),
  unique (id, profile_id, environment),
  unique (environment, external_user_id),
  unique (environment, pipedream_account_id),
  foreign key (profile_id, environment) references public.profiles(id, environment) on delete cascade
);

create table public.calendar_selections (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  profile_id uuid not null,
  environment text not null check (environment in ('test','live')),
  google_calendar_id text not null,
  display_name text not null,
  access_role text,
  time_zone text,
  blocks_availability boolean not null default true,
  receives_bookings boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, google_calendar_id),
  unique (id, profile_id, environment),
  foreign key (connection_id, profile_id, environment) references public.calendar_connections(id, profile_id, environment) on delete cascade
);
create unique index calendar_selections_one_destination_uk
  on public.calendar_selections(profile_id, environment)
  where active and receives_bookings;

create table public.calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null,
  profile_id uuid not null,
  connection_id uuid not null,
  calendar_selection_id uuid not null,
  environment text not null check (environment in ('test','live')),
  google_event_id text not null,
  ical_uid text,
  etag text,
  desired_appointment_version bigint not null check (desired_appointment_version > 0),
  sync_state text not null default 'pending' check (sync_state in ('pending','created','cancelled','failed','ambiguous')),
  safe_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_id, environment),
  unique (environment, connection_id, google_event_id),
  foreign key (appointment_id, profile_id, environment) references public.appointments(id, profile_id, environment) on delete cascade,
  foreign key (connection_id, profile_id, environment) references public.calendar_connections(id, profile_id, environment),
  foreign key (calendar_selection_id, profile_id, environment) references public.calendar_selections(id, profile_id, environment)
);

create table public.booking_attachments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null,
  customer_id uuid not null,
  profile_id uuid not null,
  website_id uuid not null,
  environment text not null check (environment in ('test','live')),
  storage_object_key text not null,
  original_filename text not null,
  display_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  checksum text not null,
  width integer,
  height integer,
  upload_state text not null default 'pending' check (upload_state in ('pending','uploaded','clean','quarantined','rejected','deleted')),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  deleted_at timestamptz,
  unique (profile_id, environment, storage_object_key),
  foreign key (appointment_id, profile_id, environment) references public.appointments(id, profile_id, environment) on delete cascade,
  foreign key (customer_id, profile_id, environment) references public.booking_customers(id, profile_id, environment),
  foreign key (website_id, profile_id, environment) references public.websites(id, user_id, environment),
  check ((width is null and height is null) or (width > 0 and height > 0))
);

create table public.pipedream_bindings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  connection_id uuid not null,
  environment text not null check (environment in ('test','live')),
  deployed_trigger_id text,
  component_key text not null,
  component_version text not null,
  pipedream_account_id text not null,
  selected_calendar_ids jsonb not null default '[]'::jsonb,
  webhook_correlation_id uuid not null default gen_random_uuid(),
  trigger_state text not null default 'not_deployed' check (trigger_state in ('not_deployed','deploying','active','degraded','disabled')),
  configuration_revision bigint not null default 1 check (configuration_revision > 0),
  last_event_at timestamptz,
  last_health_at timestamptz,
  safe_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, environment),
  unique (id, profile_id, environment),
  unique (environment, webhook_correlation_id),
  foreign key (connection_id, profile_id, environment) references public.calendar_connections(id, profile_id, environment) on delete cascade,
  check (jsonb_typeof(selected_calendar_ids) = 'array')
);

create table public.provider_event_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe','pipedream')),
  event_family text not null check (event_family in ('saas','connect','calendar')),
  event_id text not null,
  account_context text not null default '',
  destination text not null default '',
  api_version text not null default '',
  livemode boolean not null,
  environment text not null check (environment in ('test','live')),
  profile_id uuid,
  event_type text not null,
  payload_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  signature_timestamp timestamptz,
  processing_state text not null default 'pending' check (processing_state in ('pending','processing','processed','failed','dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  safe_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider,event_family,event_id,account_context,destination,api_version,livemode),
  foreign key (profile_id, environment) references public.profiles(id, environment)
);
create index provider_event_inbox_claim_idx on public.provider_event_inbox(processing_state, received_at)
  where processing_state in ('pending','processing');

create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  appointment_id uuid not null,
  environment text not null check (environment in ('test','live')),
  command_type text not null check (command_type in ('calendar_create','calendar_cancel','refund_full','notify')),
  idempotency_key text not null,
  desired_appointment_version bigint not null check (desired_appointment_version > 0),
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'pending' check (state in ('pending','processing','succeeded','failed','dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  safe_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (profile_id, environment, idempotency_key),
  foreign key (appointment_id, profile_id, environment) references public.appointments(id, profile_id, environment) on delete cascade
);
create index integration_outbox_claim_idx on public.integration_outbox(state, next_attempt_at)
  where state in ('pending','processing');

-- Generic guard: tenant/environment identity is immutable after insert.
create or replace function public.reject_booking_tenant_rekey()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.profile_id is distinct from old.profile_id or new.environment is distinct from old.environment then
    raise exception 'tenant and environment are immutable';
  end if;
  return new;
end;
$$;

-- Provider inbox has an optional tenant, but both tenant and environment remain immutable.
create or replace function public.reject_provider_inbox_rekey()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.profile_id is distinct from old.profile_id or new.environment is distinct from old.environment then
    raise exception 'tenant and environment are immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists provider_event_inbox_tenant_immutable on public.provider_event_inbox;
create trigger provider_event_inbox_tenant_immutable before update on public.provider_event_inbox
for each row execute function public.reject_provider_inbox_rekey();

-- Website/profile environment itself is also immutable.
create or replace function public.reject_environment_rekey()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.environment is distinct from old.environment then raise exception 'environment is immutable'; end if;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['website_entitlements','booking_services','availability_schedules','availability_intervals','availability_overrides','availability_override_intervals','booking_customers','booking_attachments','appointments','appointment_operations','stripe_connected_accounts','booking_payments','calendar_connections','calendar_selections','calendar_event_links','pipedream_bindings','integration_outbox'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_tenant_immutable', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.reject_booking_tenant_rekey()', table_name || '_tenant_immutable', table_name);
  end loop;
end $$;
drop trigger if exists profiles_environment_immutable on public.profiles;
create trigger profiles_environment_immutable before update on public.profiles for each row execute function public.reject_environment_rekey();
drop trigger if exists websites_environment_immutable on public.websites;
create trigger websites_environment_immutable before update on public.websites for each row execute function public.reject_environment_rekey();
drop trigger if exists subscriptions_environment_immutable on public.subscriptions;
create trigger subscriptions_environment_immutable before update on public.subscriptions for each row execute function public.reject_environment_rekey();

-- Service-role reservation primitive. DB time owns the 15-minute capacity hold.
create or replace function public.reserve_booking_hold(
  p_profile_id uuid, p_website_id uuid, p_service_id uuid, p_customer_id uuid,
  p_environment text, p_start_at timestamptz, p_local_date date, p_local_start time,
  p_time_zone text, p_client_request_id uuid, p_request_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  service_row public.booking_services%rowtype;
  existing_op public.appointment_operations%rowtype;
  appointment_id uuid;
  entitlement_id uuid;
  schedule_row public.availability_schedules%rowtype;
  derived_local timestamp;
  hold_expires_at timestamptz := clock_timestamp() + interval '15 minutes';
begin
  if p_environment not in ('test','live') or p_start_at <= clock_timestamp() then
    raise exception 'invalid reservation request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text || ':' || p_environment || ':booking', 0));
  -- Only an untouched hold may be released synchronously. Once Checkout creation starts,
  -- capacity remains held until a fenced Stripe reconciliation proves the payment outcome.
  update public.appointments set appointment_state='cancelled',appointment_reason='hold_expired',
    cancelled_at=pg_catalog.clock_timestamp(),version=version+1,updated_at=pg_catalog.clock_timestamp()
  where profile_id=p_profile_id and environment=p_environment and appointment_state='held'
    and payment_state='not_started' and reservation_expires_at<=pg_catalog.clock_timestamp();

  select * into existing_op from public.appointment_operations
   where profile_id=p_profile_id and environment=p_environment
     and operation_type='reserve' and client_request_id=p_client_request_id;
  if found then
    if existing_op.request_hash <> p_request_hash then raise exception 'idempotency key payload conflict'; end if;
    return coalesce(existing_op.result, pg_catalog.jsonb_build_object('operationId',existing_op.id,'state',existing_op.state));
  end if;

  select * into strict service_row from public.booking_services
   where id=p_service_id and profile_id=p_profile_id and environment=p_environment and active;
  select * into strict schedule_row from public.availability_schedules
   where profile_id=p_profile_id and service_id=p_service_id and environment=p_environment and active;
  derived_local:=p_start_at at time zone schedule_row.time_zone;
  if p_time_zone<>schedule_row.time_zone or p_local_date<>derived_local::date or p_local_start<>derived_local::time
     or p_start_at<pg_catalog.clock_timestamp()+pg_catalog.make_interval(mins=>service_row.minimum_notice_minutes)
     or p_start_at>pg_catalog.clock_timestamp()+pg_catalog.make_interval(days=>service_row.booking_horizon_days)
     or not (
       (exists(select 1 from public.availability_overrides o where o.schedule_id=schedule_row.id and o.local_date=p_local_date and o.override_type='custom_hours')
        and exists(select 1 from public.availability_overrides o join public.availability_override_intervals oi on oi.override_id=o.id
          where o.schedule_id=schedule_row.id and o.local_date=p_local_date and o.override_type='custom_hours'
            and p_local_start>=oi.local_start and derived_local+pg_catalog.make_interval(mins=>service_row.duration_minutes)<=p_local_date+oi.local_end
            and mod((extract(epoch from (p_local_start-oi.local_start))/60)::integer,service_row.slot_interval_minutes)=0))
       or
       (not exists(select 1 from public.availability_overrides o where o.schedule_id=schedule_row.id and o.local_date=p_local_date and o.override_type='custom_hours')
        and exists(select 1 from public.availability_intervals i where i.schedule_id=schedule_row.id and i.weekday=extract(dow from p_local_date)::integer
          and p_local_start>=i.local_start and derived_local+pg_catalog.make_interval(mins=>service_row.duration_minutes)<=p_local_date+i.local_end
          and mod((extract(epoch from (p_local_start-i.local_start))/60)::integer,service_row.slot_interval_minutes)=0))
     ) then
    raise exception 'reservation is outside booking policy' using errcode='22023';
  end if;
  if exists(select 1 from public.availability_overrides o where o.schedule_id=schedule_row.id
      and o.local_date=p_local_date and o.override_type='unavailable')
     or not (
       (exists(select 1 from public.availability_overrides o where o.schedule_id=schedule_row.id
          and o.local_date=p_local_date and o.override_type='custom_hours')
        and exists(select 1 from public.availability_overrides o
          join public.availability_override_intervals oi on oi.override_id=o.id
          where o.schedule_id=schedule_row.id and o.local_date=p_local_date and o.override_type='custom_hours'
            and p_local_start>=oi.local_start
            and derived_local+pg_catalog.make_interval(mins=>service_row.duration_minutes)
                <= p_local_date+oi.local_end))
       or
       (not exists(select 1 from public.availability_overrides o where o.schedule_id=schedule_row.id
          and o.local_date=p_local_date and o.override_type='custom_hours')
        and exists(select 1 from public.availability_intervals i where i.schedule_id=schedule_row.id
          and i.weekday=extract(dow from p_local_date)::integer and p_local_start>=i.local_start
          and derived_local+pg_catalog.make_interval(mins=>service_row.duration_minutes)
              <= p_local_date+i.local_end))
     ) then
    raise exception 'requested slot is unavailable' using errcode='P0001';
  end if;
  select e.id into entitlement_id from public.website_entitlements e
   where e.website_id=p_website_id and e.profile_id=p_profile_id and e.environment=p_environment
     and e.booking_admission and e.plan='pro' and e.state in ('active','grace')
     and e.effective_at<=pg_catalog.clock_timestamp()
     and (e.ends_at is null or e.ends_at>pg_catalog.clock_timestamp());
  if entitlement_id is null then raise exception 'website is not admitted for booking'; end if;
  if not exists (
    select 1 from public.booking_customers c
     where c.id=p_customer_id and c.profile_id=p_profile_id and c.environment=p_environment
  ) then raise exception 'customer tenant mismatch'; end if;

  insert into public.appointments(
    profile_id,website_id,entitlement_id,service_id,customer_id,environment,start_at,end_at,
    local_date,local_start,time_zone,location_snapshot,customer_snapshot,service_snapshot,
    amount_minor,currency,duration_minutes,buffer_before_minutes,buffer_after_minutes,capacity_range,
    reservation_expires_at
  ) select p_profile_id,p_website_id,entitlement_id,p_service_id,p_customer_id,p_environment,p_start_at,
    p_start_at + pg_catalog.make_interval(mins=>service_row.duration_minutes),p_local_date,p_local_start,p_time_zone,
    pg_catalog.jsonb_build_object('type',service_row.location_type,'instructions',service_row.location_instructions),
    pg_catalog.jsonb_build_object('name',c.full_name,'email',c.email_normalized,'phone',c.phone_normalized,'address',c.address_snapshot,'notes',c.notes),
    pg_catalog.jsonb_build_object('name',service_row.name,'description',service_row.description,'revision',service_row.revision),
    service_row.amount_minor,service_row.currency,service_row.duration_minutes,
    service_row.buffer_before_minutes,service_row.buffer_after_minutes,
    tstzrange(p_start_at-pg_catalog.make_interval(mins=>service_row.buffer_before_minutes),p_start_at+pg_catalog.make_interval(mins=>service_row.duration_minutes+service_row.buffer_after_minutes),'[)'),hold_expires_at
  from public.booking_customers c where c.id=p_customer_id
  returning id into appointment_id;

  insert into public.booking_payments(profile_id,appointment_id,environment,expected_amount_minor,currency)
    values(p_profile_id,appointment_id,p_environment,service_row.amount_minor,service_row.currency);
  insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,client_request_id,request_hash,state,result)
    values(p_profile_id,appointment_id,p_environment,'reserve',p_client_request_id,p_request_hash,'succeeded',
      pg_catalog.jsonb_build_object('appointmentId',appointment_id,'holdExpiresAt',hold_expires_at))
    returning result into existing_op.result;
  return existing_op.result;
end;
$$;
revoke all on function public.reserve_booking_hold(uuid,uuid,uuid,uuid,text,timestamptz,date,time,text,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_booking_hold(uuid,uuid,uuid,uuid,text,timestamptz,date,time,text,uuid,text) to service_role;

-- Authenticated users may read only their tenant. All writes use narrow server commands.
create or replace function public.is_profile_owner(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=p_profile_id and p.auth_user_id=auth.uid())
$$;
revoke all on function public.is_profile_owner(uuid) from public, anon;
grant execute on function public.is_profile_owner(uuid) to authenticated, service_role;

alter table public.website_entitlements enable row level security;
alter table public.booking_services enable row level security;
alter table public.availability_schedules enable row level security;
alter table public.availability_intervals enable row level security;
alter table public.availability_overrides enable row level security;
alter table public.availability_override_intervals enable row level security;
alter table public.booking_customers enable row level security;
alter table public.booking_attachments enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_operations enable row level security;
alter table public.stripe_connected_accounts enable row level security;
alter table public.booking_payments enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.calendar_selections enable row level security;
alter table public.calendar_event_links enable row level security;
alter table public.pipedream_bindings enable row level security;
alter table public.provider_event_inbox enable row level security;
alter table public.integration_outbox enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['website_entitlements','booking_services','availability_schedules','availability_intervals','availability_overrides','availability_override_intervals','booking_customers','booking_attachments','appointments','appointment_operations','stripe_connected_accounts','booking_payments','calendar_connections','calendar_selections','calendar_event_links','pipedream_bindings'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_profile_owner(profile_id))', table_name || '_owner_select', table_name);
  end loop;
end $$;

-- Provider inbox and outbox intentionally have no client policies. Harden helper functions too.
revoke all on function public.reject_booking_tenant_rekey() from public, anon, authenticated;
revoke all on function public.reject_provider_inbox_rekey() from public, anon, authenticated;
revoke all on function public.reject_environment_rekey() from public, anon, authenticated;
