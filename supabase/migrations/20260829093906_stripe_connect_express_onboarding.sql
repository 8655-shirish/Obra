-- Bucket 2 Stripe Connect onboarding for the frozen provider model.
-- Charging, checkout creation, refunds, and application fees remain out of scope.

do $$ begin
  if exists(select 1 from public.stripe_connected_accounts where stripe_account_id is not null) then
    raise exception 'existing Stripe connected accounts require provider reconciliation before freezing the Express model';
  end if;
end $$;

alter table public.stripe_connected_accounts
  add column if not exists account_type text not null default 'express',
  add column if not exists country text not null default 'US',
  add column if not exists charge_model text not null default 'direct',
  add column if not exists application_fee_bps integer not null default 0,
  add column if not exists provider_created_at timestamptz,
  add column if not exists reconciliation_generation bigint not null default 0 check (reconciliation_generation >= 0),
  add column if not exists reconciliation_due_at timestamptz,
  add column if not exists creation_key text;

alter table public.stripe_connected_accounts drop constraint if exists stripe_connected_accounts_bucket2_model_check;
alter table public.stripe_connected_accounts add constraint stripe_connected_accounts_bucket2_model_check check (
  account_type = 'express' and country = 'US' and charge_model = 'direct' and application_fee_bps = 0
);

create or replace function public.reject_stripe_connected_account_rebind()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.stripe_account_id is not null and new.stripe_account_id is distinct from old.stripe_account_id then
    raise exception 'stripe connected account identity is immutable';
  end if;
  if new.account_type <> 'express' or new.country <> 'US' or new.charge_model <> 'direct' or new.application_fee_bps <> 0 then
    raise exception 'unsupported Stripe Connect configuration';
  end if;
  return new;
end;
$$;

drop trigger if exists stripe_connected_accounts_identity_immutable on public.stripe_connected_accounts;
create trigger stripe_connected_accounts_identity_immutable before update on public.stripe_connected_accounts
for each row execute function public.reject_stripe_connected_account_rebind();

create or replace function public.reserve_stripe_connect_account(
  p_profile_id uuid, p_website_id uuid, p_environment text, p_auth_user_id uuid
) returns public.stripe_connected_accounts
language plpgsql security definer set search_path = '' as $$
declare result public.stripe_connected_accounts;
begin
  if p_environment not in ('test', 'live') then raise exception 'invalid environment'; end if;
  if not exists (select 1 from public.profiles p where p.id=p_profile_id and p.environment=p_environment and p.auth_user_id=p_auth_user_id) then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from public.websites w
    join public.website_entitlements e on e.website_id=w.id and e.profile_id=w.user_id and e.environment=w.environment
    where w.id=p_website_id and w.user_id=p_profile_id and w.environment=p_environment
      and e.plan='pro' and e.state in ('active','grace') and e.order_confirmed_at is not null
      and e.effective_at is not null and e.effective_at <= clock_timestamp()
      and (e.ends_at is null or e.ends_at > clock_timestamp())
  ) then raise exception 'active confirmed Pro entitlement required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text || ':' || p_environment || ':stripe-connect', 0));
  insert into public.stripe_connected_accounts (
    profile_id, environment, account_type, country, charge_model, application_fee_bps, configuration, onboarding_state
  ) values (
    p_profile_id, p_environment, 'express', 'US', 'direct', 0,
    pg_catalog.jsonb_build_object('accountType','express','country','US','chargeModel','direct','applicationFeeBps',0,'onboarding','stripe_hosted'),
    'not_started'
  ) on conflict (profile_id, environment) do nothing;
  select * into strict result from public.stripe_connected_accounts
    where profile_id=p_profile_id and environment=p_environment for update;
  if result.account_type <> 'express' or result.country <> 'US' or result.charge_model <> 'direct' or result.application_fee_bps <> 0 then
    raise exception 'unsupported existing Stripe Connect configuration';
  end if;
  return result;
end;
$$;


create or replace function public.bind_stripe_connect_account(
  p_profile_id uuid,p_environment text,p_stripe_account_id text,p_creation_key text
) returns bigint language plpgsql security definer set search_path='' as $$
declare generation bigint;
begin
  if p_stripe_account_id is null or pg_catalog.btrim(p_stripe_account_id)='' or p_creation_key is null or pg_catalog.btrim(p_creation_key)='' then
    raise exception using errcode='22023',message='Stripe account identity and creation key are required';
  end if;
  update public.stripe_connected_accounts
  set stripe_account_id=p_stripe_account_id,creation_key=p_creation_key,reconciliation_generation=reconciliation_generation+1,updated_at=pg_catalog.clock_timestamp()
  where profile_id=p_profile_id and environment=p_environment
    and (stripe_account_id is null or stripe_account_id=p_stripe_account_id)
    and (creation_key is null or creation_key=p_creation_key)
  returning reconciliation_generation into generation;
  if generation is null then raise exception 'Stripe Connect identity conflict'; end if;
  return generation;
end$$;

create or replace function public.begin_stripe_connect_reconciliation(
  p_profile_id uuid,p_environment text,p_stripe_account_id text
) returns bigint language plpgsql security definer set search_path='' as $$
declare next_generation bigint;
begin
  update public.stripe_connected_accounts set reconciliation_generation=reconciliation_generation+1,updated_at=pg_catalog.clock_timestamp()
  where profile_id=p_profile_id and environment=p_environment and stripe_account_id=p_stripe_account_id
  returning reconciliation_generation into next_generation;
  if next_generation is null then raise exception 'Stripe Connect account not found'; end if;
  return next_generation;
end$$;

create or replace function public.apply_stripe_connect_account_projection(
  p_profile_id uuid, p_environment text, p_stripe_account_id text, p_reconciliation_generation bigint,
  p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean,
  p_capabilities jsonb, p_requirements jsonb, p_provider_created_at timestamptz, p_observed_at timestamptz
) returns public.stripe_connected_accounts
language plpgsql security definer set search_path = '' as $$
declare result public.stripe_connected_accounts; next_state text;
begin
  if p_environment not in ('test','live') or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$' then raise exception 'invalid Stripe Connect identity'; end if;
  if p_observed_at > clock_timestamp() + interval '1 minute' then raise exception 'invalid observation time'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text || ':' || p_environment || ':stripe-connect', 0));
  select * into strict result from public.stripe_connected_accounts
    where profile_id=p_profile_id and environment=p_environment for update;
  if result.stripe_account_id is not null and result.stripe_account_id <> p_stripe_account_id then raise exception 'Stripe Connect identity conflict'; end if;
  if result.reconciliation_generation <> p_reconciliation_generation then raise exception 'stale Stripe Connect reconciliation'; end if;
  next_state := case
    when coalesce(p_requirements->>'disabled_reason','') <> '' then 'disabled'
    when p_charges_enabled and p_payouts_enabled and p_details_submitted
      and coalesce(p_capabilities->>'card_payments','') = 'active'
      and jsonb_typeof(p_requirements->'currently_due') = 'array' and jsonb_array_length(p_requirements->'currently_due') = 0
      and jsonb_typeof(p_requirements->'past_due') = 'array' and jsonb_array_length(p_requirements->'past_due') = 0
      and jsonb_typeof(p_requirements->'pending_verification') = 'array' and jsonb_array_length(p_requirements->'pending_verification') = 0 then 'ready'
    when p_details_submitted then 'restricted' else 'pending' end;
  update public.stripe_connected_accounts set
    stripe_account_id=p_stripe_account_id, onboarding_state=next_state,
    charges_enabled=p_charges_enabled, payouts_enabled=p_payouts_enabled, details_submitted=p_details_submitted,
    capabilities=coalesce(p_capabilities,'{}'::jsonb), requirements=coalesce(p_requirements,'{}'::jsonb),
    reconnect_reason=nullif(p_requirements->>'disabled_reason',''),
    provider_created_at=coalesce(provider_created_at,p_provider_created_at), last_verified_at=p_observed_at,
    reconciliation_due_at=p_observed_at+interval '10 minutes',updated_at=clock_timestamp()
  where id=result.id returning * into result;
  return result;
end;
$$;

revoke all on function public.reject_stripe_connected_account_rebind() from public, anon, authenticated;
revoke all on function public.reserve_stripe_connect_account(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.bind_stripe_connect_account(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.begin_stripe_connect_reconciliation(uuid,text,text) from public, anon, authenticated;
revoke all on function public.apply_stripe_connect_account_projection(uuid,text,text,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.reserve_stripe_connect_account(uuid,uuid,text,uuid) to service_role;
grant execute on function public.bind_stripe_connect_account(uuid,text,text,text) to service_role;
grant execute on function public.begin_stripe_connect_reconciliation(uuid,text,text) to service_role;
grant execute on function public.apply_stripe_connect_account_projection(uuid,text,text,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) to service_role;
