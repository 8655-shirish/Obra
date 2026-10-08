-- Establish the durable checkout identity before any provider network call. Profile claim,
-- website selection, active offer freezing, and checkout reservation are one replay-safe
-- transaction, so a lost HTTP response can be retried without duplicating customer state.
create or replace function public.begin_saas_checkout(
  p_environment text,
  p_attempt_id uuid,
  p_license_number text,
  p_email text,
  p_full_name text,
  p_business_name text,
  p_city text,
  p_plan text,
  p_website_id uuid,
  p_legal_accepted_at timestamptz,
  p_legal_acceptance_ip_hash text,
  p_legal_acceptance_user_agent text,
  p_legal_document_versions jsonb
)
returns table(
  profile_id uuid,
  website_id uuid,
  checkout_session_id uuid,
  subscription_id uuid,
  checkout_status text,
  checkout_email text,
  checkout_plan text,
  disposition text,
  provider_session_id text,
  offer_contract_version integer,
  offer_price_id text,
  offer_product_id text,
  offer_currency text,
  offer_unit_amount_minor integer,
  offer_interval text,
  offer_interval_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_license text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_license_number, '')));
  normalized_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  profile_row public.profiles%rowtype;
  website_row public.websites%rowtype;
  existing_checkout public.checkout_sessions%rowtype;
  offer_contract public.saas_offer_contracts%rowtype;
  offer_snapshot jsonb;
  reservation record;
  stage text := 'validation';
  error_state text;
  error_schema text;
  error_table text;
  error_constraint text;
begin
  if p_attempt_id is null
    or coalesce(p_environment, '') not in ('test', 'live')
    or coalesce(p_plan, '') not in ('starter', 'pro')
    or pg_catalog.length(normalized_license) not between 1 and 50
    or pg_catalog.length(normalized_email) not between 3 and 254
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_full_name, ''))) not between 1 and 200
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_business_name, ''))) not between 1 and 200
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_city, ''))) not between 1 and 200
    or p_legal_accepted_at is null
    or coalesce(p_legal_acceptance_ip_hash, '') !~ '^[a-f0-9]{64}$'
    or pg_catalog.length(coalesce(p_legal_acceptance_user_agent, '')) not between 1 and 512
    or pg_catalog.jsonb_typeof(p_legal_document_versions) is distinct from 'object'
    or pg_catalog.pg_column_size(p_legal_document_versions) > 16384 then
    raise exception 'invalid checkout reservation' using errcode = '22023';
  end if;

  raise log 'saas_checkout_begin attempt=% stage=started environment=% plan=%',
    p_attempt_id, p_environment, p_plan;

  -- First requests have no row to lock, so serialize by normalized contractor identity.
  stage := 'identity';
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saas-checkout-begin-v1:' || normalized_license, 0)
  );

  select * into profile_row
  from public.profiles p
  where p.license_number = normalized_license;

  if found then
    if profile_row.environment is distinct from p_environment then
      raise exception 'account belongs to a different billing environment' using errcode = 'P0001';
    end if;
    if p_website_id is not null then
      select * into website_row
      from public.websites w
      where w.id = p_website_id
        and w.user_id = profile_row.id
        and w.environment = p_environment
      for update;
      if not found then
        raise exception 'website tenant mismatch' using errcode = 'P0001';
      end if;
    else
      select * into website_row
      from public.websites w
      where w.user_id = profile_row.id
        and w.environment = p_environment
      order by w.created_at, w.id
      limit 1
      for update;
    end if;

    if website_row.id is not null then
      -- Replay is bound to the already-frozen checkout, not today's mutable sales route.
      select * into existing_checkout
      from public.checkout_sessions c
      where c.website_id = website_row.id
        and c.environment = p_environment
        and c.status in ('pending_payment', 'pending_otp')
      for update;
    end if;

    if existing_checkout.id is not null then
      if existing_checkout.profile_id is distinct from profile_row.id
        or existing_checkout.license_number is distinct from normalized_license
        or pg_catalog.lower(pg_catalog.btrim(existing_checkout.email)) is distinct from normalized_email
        or existing_checkout.plan is distinct from p_plan
        or existing_checkout.full_name is distinct from pg_catalog.btrim(p_full_name)
        or existing_checkout.business_name is distinct from pg_catalog.btrim(p_business_name)
        or existing_checkout.city is distinct from pg_catalog.btrim(p_city)
        or existing_checkout.legal_document_versions is distinct from p_legal_document_versions then
        if existing_checkout.status = 'pending_otp'
          or existing_checkout.stripe_checkout_session_id is not null then
          raise exception 'provider checkout already active for different intent' using errcode = '23505';
        end if;
        update public.checkout_sessions
        set status = 'expired', subscription_id = null
        where id = existing_checkout.id and status = 'pending_payment';
        if existing_checkout.subscription_id is not null then
          delete from public.subscriptions
          where id = existing_checkout.subscription_id
            and status = 'pending_activation'
            and provider_subscription_id is null
            and stripe_subscription_id is null;
        end if;
        existing_checkout := null;
      else
        if existing_checkout.status = 'pending_otp'
          and (existing_checkout.payment_evidence_kind is null
            or (existing_checkout.payment_evidence_kind <> 'legacy_post_payment'
              and existing_checkout.payment_verified_at is null)) then
          raise exception 'checkout payment finalization is still in progress' using errcode = 'P0001';
        end if;
        select * into offer_contract
        from public.saas_offer_contracts c
        where c.contract_id = existing_checkout.provider_offer_contract_id
          and c.contract_digest = existing_checkout.provider_offer_contract_digest
          and c.environment = existing_checkout.environment
          and c.plan = existing_checkout.plan
          and c.price_id = existing_checkout.provider_offer_snapshot->>'priceId'
          and c.product_id = existing_checkout.provider_offer_snapshot->>'productId';
        if not found then
          raise exception 'checkout frozen provider contract is missing or mismatched'
            using errcode = 'P0001';
        end if;
        if existing_checkout.status = 'pending_payment'
          and existing_checkout.stripe_checkout_session_id is null
          and offer_contract.active_for_new_sales is false then
          update public.checkout_sessions set status='expired',subscription_id=null
          where id=existing_checkout.id and status='pending_payment';
          delete from public.subscriptions where id=existing_checkout.subscription_id
            and status='pending_activation'and provider_subscription_id is null
            and stripe_subscription_id is null;
          existing_checkout := null;
        else
        return query select
          profile_row.id,
          website_row.id,
          existing_checkout.id,
          existing_checkout.subscription_id,
          existing_checkout.status,
          existing_checkout.email,
          existing_checkout.plan,
          case existing_checkout.status
            when 'pending_otp' then 'reused_pending_otp'
            else 'reused_pending_payment'
          end,
          existing_checkout.stripe_checkout_session_id,
          1,
          offer_contract.price_id,
          offer_contract.product_id,
          offer_contract.currency,
          offer_contract.unit_amount_minor,
          offer_contract.interval,
          offer_contract.interval_count;
        raise log 'saas_checkout_begin attempt=% stage=succeeded environment=% plan=% disposition=reused',
          p_attempt_id, p_environment, p_plan;
        return;
        end if;
      end if;
    end if;

    if exists(
      select 1 from public.website_entitlements e
      where e.website_id = website_row.id and e.environment = p_environment
    ) then
      raise exception 'website already has a purchase entitlement' using errcode = '23505';
    end if;
  end if;

  stage := 'profile';
  if profile_row.id is null then
    if p_website_id is not null then
      raise exception 'website not found for checkout' using errcode = 'P0001';
    end if;
    insert into public.profiles(
      license_number, full_name, business_name, city, auth_user_id,
      checkout_claimable_at, checkout_claim_email, environment
    ) values (
      normalized_license, pg_catalog.btrim(p_full_name), pg_catalog.btrim(p_business_name),
      pg_catalog.btrim(p_city), null, pg_catalog.clock_timestamp(), normalized_email, p_environment
    ) returning * into profile_row;
  else
    -- Match entitlement activation's website -> checkout -> profile lock order.
    select * into strict profile_row from public.profiles p where p.id=profile_row.id for update;
  end if;
  if profile_row.auth_user_id is not null then
    if p_website_id is null then
      raise exception 'authenticated checkout requires an explicit website' using errcode = 'P0001';
    end if;
    if profile_row.email is null
      or pg_catalog.lower(pg_catalog.btrim(profile_row.email)) is distinct from normalized_email then
      raise exception 'authenticated checkout email mismatch' using errcode = 'P0001';
    end if;
  elsif profile_row.checkout_claimable_at is null then
    raise exception 'contractor profile is not available for public checkout' using errcode = 'P0001';
  elsif profile_row.checkout_claim_email is distinct from normalized_email then
    -- An unattached, unpaid reservation is not ownership evidence. Retarget it atomically;
    -- provider-attached and paid rows were rejected above and can never be taken over.
    update public.profiles
    set checkout_claim_email = normalized_email,
        checkout_claimable_at = pg_catalog.clock_timestamp(),
        full_name = pg_catalog.btrim(p_full_name),
        business_name = pg_catalog.btrim(p_business_name),
        city = pg_catalog.btrim(p_city),
        updated_at = pg_catalog.clock_timestamp()
    where id = profile_row.id
    returning * into profile_row;
  end if;

  stage := 'website';
  if website_row.id is null then
    if p_website_id is not null then
      raise exception 'website tenant mismatch' using errcode = 'P0001';
    end if;
    insert into public.websites(user_id, environment, status)
    values(profile_row.id, p_environment, 'draft')
    returning * into website_row;
  end if;

  if exists(
    select 1 from public.website_entitlements e
    where e.website_id = website_row.id and e.environment = p_environment
  ) then
    raise exception 'website already has a purchase entitlement' using errcode = '23505';
  end if;

  stage := 'offer';
  select c.* into offer_contract
  from public.saas_offer_contracts c
  where c.environment = p_environment
    and c.plan = p_plan
    and c.active_for_new_sales
    and exists(
      select 1 from public.saas_offer_contract_installations i
      where i.contract_id = c.contract_id and i.observed_digest = c.contract_digest
    )
  for share of c;
  if not found then
    raise exception 'checkout offer is not an active verified new-sales contract'
      using errcode = 'P0001';
  end if;

  offer_snapshot := pg_catalog.jsonb_build_object(
    'contractVersion', 1,
    'plan', p_plan,
    'livemode', p_environment = 'live',
    'priceId', offer_contract.price_id,
    'productId', offer_contract.product_id,
    'currency', offer_contract.currency,
    'unitAmountMinor', offer_contract.unit_amount_minor,
    'interval', offer_contract.interval,
    'intervalCount', offer_contract.interval_count,
    'productName', case p_plan when 'starter' then 'Obra Starter' else 'Obra Pro' end,
    'productDescription', ''
  );

  stage := 'reservation';
  select * into strict reservation
  from public.reserve_checkout_intent(
    profile_row.id, website_row.id, p_environment, normalized_license, normalized_email,
    pg_catalog.btrim(p_full_name), pg_catalog.btrim(p_business_name), pg_catalog.btrim(p_city),
    p_plan, 'pending_payment', p_legal_accepted_at, p_legal_acceptance_ip_hash,
    p_legal_acceptance_user_agent, p_legal_document_versions, offer_snapshot
  );

  return query select
    profile_row.id,
    website_row.id,
    reservation.checkout_session_id,
    reservation.subscription_id,
    reservation.checkout_status,
    reservation.checkout_email,
    reservation.checkout_plan,
    reservation.disposition,
    null::text,
    1,
    offer_contract.price_id,
    offer_contract.product_id,
    offer_contract.currency,
    offer_contract.unit_amount_minor,
    offer_contract.interval,
    offer_contract.interval_count;
  raise log 'saas_checkout_begin attempt=% stage=succeeded environment=% plan=% disposition=%',
    p_attempt_id, p_environment, p_plan, reservation.disposition;
exception when others then
  get stacked diagnostics
    error_state = returned_sqlstate,
    error_schema = schema_name,
    error_table = table_name,
    error_constraint = constraint_name;
  raise log 'saas_checkout_begin attempt=% stage=% environment=% plan=% sqlstate=% schema=% table=% constraint=%',
    p_attempt_id, stage, p_environment, p_plan, error_state,
    coalesce(error_schema, ''), coalesce(error_table, ''), coalesce(error_constraint, '');
  raise;
end;
$$;

comment on function public.begin_saas_checkout(
  text,uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,jsonb
) is 'Atomic, replay-safe pre-provider checkout boundary. p_attempt_id is used only for non-identifying logs.';

revoke all on function public.begin_saas_checkout(
  text,uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,jsonb
) from public, anon, authenticated, service_role, booking_worker;
grant execute on function public.begin_saas_checkout(
  text,uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,jsonb
) to service_role;
