-- Serialize the owner-only offer registry writers in a single global order. The route lock
-- remains useful for observability and future narrow writers, but no writer may obtain it or a
-- contract row lock before the registry lock.
create or replace function public.install_saas_offer_contract(
  p_environment text,
  p_plan text,
  p_price_id text,
  p_product_id text,
  p_unit_amount_minor integer,
  p_verified_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract public.saas_offer_contracts%rowtype;
  v_digest text;
begin
  if p_environment not in ('test', 'live')
    or p_plan not in ('starter', 'pro')
    or nullif(pg_catalog.btrim(p_price_id), '') is null
    or nullif(pg_catalog.btrim(p_product_id), '') is null
    or p_verified_at is null then
    raise exception 'invalid audited SaaS offer installation' using errcode = '22023';
  end if;
  if (p_plan = 'starter' and p_unit_amount_minor <> 7900)
    or (p_plan = 'pro' and p_unit_amount_minor <> 12900) then
    raise exception 'audited offer amount violates canonical plan' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-offer-registry-write-v2', 0)
  );

  v_digest := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'environment', p_environment,
          'plan', p_plan,
          'priceId', p_price_id,
          'productId', p_product_id,
          'currency', 'usd',
          'unitAmountMinor', p_unit_amount_minor,
          'interval', 'month',
          'intervalCount', 1
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Targetless conflict handling covers both historical unique constraints. The locked identity
  -- comparison below distinguishes an exact replay from a genuinely conflicting provider fact.
  insert into public.saas_offer_contracts(
    environment, plan, price_id, product_id, currency,
    unit_amount_minor, interval, interval_count, verified_at
  )
  values (
    p_environment, p_plan, p_price_id, p_product_id, 'usd',
    p_unit_amount_minor, 'month', 1, p_verified_at
  )
  on conflict do nothing;

  select * into strict v_contract
  from public.saas_offer_contracts
  where environment = p_environment and price_id = p_price_id
  for update;

  if v_contract.plan is distinct from p_plan
    or v_contract.product_id is distinct from p_product_id
    or v_contract.contract_digest is distinct from v_digest
    or v_contract.verified_at is distinct from p_verified_at then
    raise exception 'audited offer identity conflict' using errcode = '23505';
  end if;

  insert into public.saas_offer_contract_installations(contract_id, observed_digest)
  values (v_contract.contract_id, v_digest)
  on conflict (contract_id, observed_digest) do nothing;
  return v_contract.contract_id;
end;
$$;

create or replace function public.rotate_saas_offer_contract(
  p_environment text,
  p_plan text,
  p_new_contract_id uuid,
  p_expected_current_price_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new public.saas_offer_contracts%rowtype;
  v_current_contract_id uuid;
  v_current_price_id text;
begin
  if p_environment not in ('test', 'live')
    or p_plan not in ('starter', 'pro')
    or p_new_contract_id is null then
    raise exception 'invalid offer rotation' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-offer-registry-write-v2', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-offer-route-v1:' || p_environment || ':' || p_plan, 0)
  );

  select * into strict v_new
  from public.saas_offer_contracts
  where contract_id = p_new_contract_id
    and environment = p_environment
    and plan = p_plan
  for update;

  if v_new.contract_digest is distinct from pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'environment', v_new.environment,
          'plan', v_new.plan,
          'priceId', v_new.price_id,
          'productId', v_new.product_id,
          'currency', v_new.currency,
          'unitAmountMinor', v_new.unit_amount_minor,
          'interval', v_new.interval,
          'intervalCount', v_new.interval_count
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) then
    raise exception 'offer contract digest mismatch' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
    from public.saas_offer_contract_installations i
    where i.contract_id = v_new.contract_id
      and i.observed_digest = v_new.contract_digest
  ) then
    raise exception 'offer contract has no matching audit installation' using errcode = 'P0001';
  end if;

  select c.contract_id, c.price_id
  into v_current_contract_id, v_current_price_id
  from public.saas_offer_contracts c
  where c.environment = p_environment
    and c.plan = p_plan
    and c.active_for_new_sales
  for update;

  -- The exact target remains replay-safe; any different active route must be consciously
  -- named by a reviewed caller and can never be silently replaced by stale activation SQL.
  if v_current_contract_id is not distinct from p_new_contract_id then
    return true;
  end if;
  if v_current_price_id is distinct from p_expected_current_price_id then
    raise exception 'unexpected active SaaS offer route for %.%: expected %, found %',
      p_environment, p_plan, p_expected_current_price_id, v_current_price_id
      using errcode = 'P0001';
  end if;

  if v_current_contract_id is not null then
    update public.saas_offer_contracts
    set active_for_new_sales = false
    where contract_id = v_current_contract_id;
  end if;
  update public.saas_offer_contracts
  set active_for_new_sales = true
  where contract_id = p_new_contract_id
    and not active_for_new_sales;
  if not found then
    raise exception 'unable to activate expected SaaS offer contract' using errcode = 'P0001';
  end if;
  return true;
end;
$$;

revoke all on function public.install_saas_offer_contract(text, text, text, text, integer, timestamptz)
from public, anon, authenticated, service_role, booking_worker;
revoke all on function public.rotate_saas_offer_contract(text, text, uuid)
from public, anon, authenticated, service_role, booking_worker;
drop function public.rotate_saas_offer_contract(text, text, uuid);
revoke all on function public.rotate_saas_offer_contract(text, text, uuid, text)
from public, anon, authenticated, service_role, booking_worker;
