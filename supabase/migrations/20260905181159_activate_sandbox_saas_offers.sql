-- User confirmed the exact Stripe sandbox catalog mapping for the temporary test deployment.
-- The timestamp records that confirmation in this operator session; it is not an independent
-- Stripe API observation. This migration only registers and activates the two test offer routes.
-- It creates no Checkout Session, subscription, payment, or charge and does not change live routes.
do $$
declare
  starter_contract_id uuid;
  pro_contract_id uuid;
  confirmed_at constant timestamptz := timestamptz '2026-09-05T18:11:59Z';
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-offer-registry-write-v2', 0)
  );

  starter_contract_id := public.install_saas_offer_contract(
    'test',
    'starter',
    'price_1U90KGEjgAPzsVsTmS6lgHnQ',
    'prod_V9Iw1h1tesmf0h',
    7900,
    confirmed_at
  );
  pro_contract_id := public.install_saas_offer_contract(
    'test',
    'pro',
    'price_1U90KYEjgAPzsVsTLzMO54Sd',
    'prod_V9IwztC1fi8sqi',
    12900,
    confirmed_at
  );

  -- Initial activation succeeds only for empty test routes. Exact replay remains idempotent;
  -- a different active sandbox Price fails closed rather than being silently replaced.
  if not public.rotate_saas_offer_contract('test', 'starter', starter_contract_id, null::text) then
    raise exception 'unable to activate confirmed sandbox Starter offer contract';
  end if;
  if not public.rotate_saas_offer_contract('test', 'pro', pro_contract_id, null::text) then
    raise exception 'unable to activate confirmed sandbox Pro offer contract';
  end if;

  perform public.assert_saas_offer_readiness('test');
end;
$$;
