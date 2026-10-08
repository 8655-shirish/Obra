-- User confirmed the exact live Stripe catalog mapping in the Stripe Dashboard for initial launch.
-- The timestamp records that confirmation in this operator session; it is not an independent
-- provider API observation. This migration registers and activates no more than these two
-- canonical subscriptions. It neither creates a Checkout Session nor a Stripe charge.
do $$
declare
  starter_contract_id uuid;
  pro_contract_id uuid;
  confirmed_at constant timestamptz := timestamptz '2026-09-04T14:15:42Z';
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-offer-registry-write-v2', 0)
  );

  starter_contract_id := public.install_saas_offer_contract(
    'live',
    'starter',
    'price_1UBv1wEjgAPzsVsT16jTWfoX',
    'prod_VCJf9cb38DrMux',
    7900,
    confirmed_at
  );
  pro_contract_id := public.install_saas_offer_contract(
    'live',
    'pro',
    'price_1UBv4REjgAPzsVsTgJaCJbzu',
    'prod_VCJhFaSe0Jrofq',
    12900,
    confirmed_at
  );

  -- Initial activation succeeds only for an empty route. Exact replay remains idempotent;
  -- another active Price fails closed rather than restoring a stale route.
  if not public.rotate_saas_offer_contract('live', 'starter', starter_contract_id, null::text) then
    raise exception 'unable to activate confirmed Starter offer contract';
  end if;
  if not public.rotate_saas_offer_contract('live', 'pro', pro_contract_id, null::text) then
    raise exception 'unable to activate confirmed Pro offer contract';
  end if;

  perform public.assert_saas_offer_readiness('live');
end;
$$;
