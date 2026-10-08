-- Forward-only closure for immutable SaaS checkout authority and fulfillment.
-- Source-only in this PR. Apply only after merge and explicit rollout authorization.

alter table public.checkout_sessions add column if not exists provider_offer_snapshot jsonb;
alter table public.checkout_sessions add column if not exists provider_completion_evidence jsonb;
alter table public.checkout_sessions add column if not exists provider_completion_event_id uuid references public.provider_event_inbox(id) on delete restrict;
alter table public.checkout_sessions add column if not exists provider_completion_payload_hash text;
alter table public.checkout_sessions add column if not exists provider_offer_contract_id uuid;
alter table public.checkout_sessions add column if not exists provider_offer_contract_digest text;
alter table public.checkout_sessions add column if not exists legacy_evidence_version smallint;
-- Existing scalar Stripe rows are grandfathered only as an explicit immutable migration class;
-- no new caller may manufacture this class and entitlement grant never treats it as fresh proof.
update public.checkout_sessions c set legacy_evidence_version=1 where c.payment_evidence_kind='stripe_api'and c.status in('pending_otp','completed')and c.payment_verified_at is not null and c.payment_provider_session_id is not null and c.payment_price_id is not null and c.subscription_id is not null and c.profile_id is not null and c.website_id is not null and c.environment in('test','live')and c.provider_offer_snapshot is null and c.provider_offer_contract_id is null and c.provider_offer_contract_digest is null and c.provider_completion_evidence is null and c.provider_completion_event_id is null and c.provider_completion_payload_hash is null and c.legacy_evidence_version is null and exists(select 1 from public.websites w where w.id=c.website_id and w.user_id=c.profile_id and w.environment=c.environment)and exists(select 1 from public.subscriptions s where s.id=c.subscription_id and s.user_id=c.profile_id and s.environment=c.environment);
alter table public.checkout_sessions add constraint checkout_sessions_legacy_evidence_version_ck check(
 (legacy_evidence_version is null)or(legacy_evidence_version=1 and payment_evidence_kind='stripe_api'and provider_offer_snapshot is null and provider_offer_contract_id is null and provider_offer_contract_digest is null and provider_completion_evidence is null and provider_completion_event_id is null and provider_completion_payload_hash is null)
)not valid;
alter table public.checkout_sessions validate constraint checkout_sessions_legacy_evidence_version_ck;
alter table public.subscriptions add column if not exists provider_offer_snapshot jsonb;
alter table public.subscriptions add column if not exists provider_offer_contract_id uuid;
alter table public.subscriptions add column if not exists provider_offer_contract_digest text;

-- Offer facts are append-only purchase-contract history.  The only mutable field is the narrow
-- new-sales route; retiring a Price therefore cannot invalidate an existing Checkout Session or
-- a subscribed customer.  Before charging, a privileged operator must insert each Price/Product
-- observed by the read-only Stripe catalog audit, set exactly one route per environment/plan true,
-- drain old app instances, reload PostgREST, and then enable checkout.  No application role can
-- install, replace, or delete an offer contract; an empty registry fails closed by design.
create table public.saas_offer_contracts(
 contract_id uuid primary key default gen_random_uuid(),
 environment text not null check(environment in('test','live')),
 plan text not null check(plan in('starter','pro')),
 price_id text not null check(nullif(pg_catalog.btrim(price_id),'')is not null),
 product_id text not null check(nullif(pg_catalog.btrim(product_id),'')is not null),
 currency text not null check(currency='usd'),
 unit_amount_minor integer not null check((plan='starter'and unit_amount_minor=7900)or(plan='pro'and unit_amount_minor=12900)),
 interval text not null check(interval='month'),
 interval_count integer not null check(interval_count=1),
 active_for_new_sales boolean not null default false,
 contract_digest text not null check(contract_digest~'^[a-f0-9]{64}$'),
 verified_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique(environment,price_id,product_id),
 unique(environment,price_id)
);
create unique index saas_offer_contracts_one_new_sales_route on public.saas_offer_contracts(environment,plan)where active_for_new_sales;
alter table public.saas_offer_contracts enable row level security;
revoke all on public.saas_offer_contracts from public,anon,authenticated,service_role,booking_worker;

create function public.protect_saas_offer_contract()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if tg_op='INSERT'then
  new.contract_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('environment',new.environment,'plan',new.plan,'priceId',new.price_id,'productId',new.product_id,'currency',new.currency,'unitAmountMinor',new.unit_amount_minor,'interval',new.interval,'intervalCount',new.interval_count)::text,'UTF8'),'sha256'),'hex');
  return new;
 end if;
 if tg_op='DELETE'then raise exception'SaaS offer contract history is append-only'using errcode='P0001';end if;
 if new.contract_id is distinct from old.contract_id or new.environment is distinct from old.environment or new.plan is distinct from old.plan or new.price_id is distinct from old.price_id or new.product_id is distinct from old.product_id or new.currency is distinct from old.currency or new.unit_amount_minor is distinct from old.unit_amount_minor or new.interval is distinct from old.interval or new.interval_count is distinct from old.interval_count or new.contract_digest is distinct from old.contract_digest or new.verified_at is distinct from old.verified_at or new.created_at is distinct from old.created_at then raise exception'SaaS offer contract facts are immutable'using errcode='P0001';end if;
 return new;
end $$;
create trigger saas_offer_contracts_immutable before insert or update or delete on public.saas_offer_contracts for each row execute function public.protect_saas_offer_contract();
revoke all on function public.protect_saas_offer_contract()from public,anon,authenticated,service_role,booking_worker;

-- The only route transition is atomic: rotate after inserting an independently audited immutable
-- contract, then validate this registry has exactly one active row for every route before enabling checkout.
create function public.rotate_saas_offer_contract(p_environment text,p_plan text,p_new_contract_id uuid)returns boolean language plpgsql security definer set search_path=''as $$
declare v_new public.saas_offer_contracts%rowtype;
begin
 if p_environment not in('test','live')or p_plan not in('starter','pro')or p_new_contract_id is null then raise exception'invalid offer rotation'using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saas-offer-route-v1:'||p_environment||':'||p_plan,0));
 select*into strict v_new from public.saas_offer_contracts where contract_id=p_new_contract_id and environment=p_environment and plan=p_plan for update;
 if v_new.contract_digest<>pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('environment',v_new.environment,'plan',v_new.plan,'priceId',v_new.price_id,'productId',v_new.product_id,'currency',v_new.currency,'unitAmountMinor',v_new.unit_amount_minor,'interval',v_new.interval,'intervalCount',v_new.interval_count)::text,'UTF8'),'sha256'),'hex')then raise exception'offer contract digest mismatch'using errcode='P0001';end if;
 update public.saas_offer_contracts set active_for_new_sales=false where environment=p_environment and plan=p_plan and active_for_new_sales and contract_id<>p_new_contract_id;
 update public.saas_offer_contracts set active_for_new_sales=true where contract_id=p_new_contract_id and active_for_new_sales=false;
 return found or v_new.active_for_new_sales;
end $$;
revoke all on function public.rotate_saas_offer_contract(text,text,uuid)from public,anon,authenticated,service_role,booking_worker;

-- Deployment automation persists the read-only Stripe audit facts before activating a route.
-- This owner-only audit trail makes catalog installation replay-safe and independently reviewable.
create table public.saas_offer_contract_installations(
 id uuid primary key default gen_random_uuid(),contract_id uuid not null references public.saas_offer_contracts(contract_id)on delete restrict,
 observed_digest text not null check(observed_digest~'^[a-f0-9]{64}$'),installed_at timestamptz not null default pg_catalog.clock_timestamp(),
 unique(contract_id,observed_digest)
);
alter table public.saas_offer_contract_installations enable row level security;
revoke all on public.saas_offer_contract_installations from public,anon,authenticated,service_role,booking_worker;
create function public.install_saas_offer_contract(p_environment text,p_plan text,p_price_id text,p_product_id text,p_unit_amount_minor integer,p_verified_at timestamptz)returns uuid language plpgsql security definer set search_path=''as $$
declare v_contract public.saas_offer_contracts%rowtype;v_digest text;
begin
 if p_environment not in('test','live')or p_plan not in('starter','pro')or nullif(pg_catalog.btrim(p_price_id),'')is null or nullif(pg_catalog.btrim(p_product_id),'')is null or p_verified_at is null then raise exception'invalid audited SaaS offer installation'using errcode='22023';end if;
 if(p_plan='starter'and p_unit_amount_minor<>7900)or(p_plan='pro'and p_unit_amount_minor<>12900)then raise exception'audited offer amount violates canonical plan'using errcode='22023';end if;
 v_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('environment',p_environment,'plan',p_plan,'priceId',p_price_id,'productId',p_product_id,'currency','usd','unitAmountMinor',p_unit_amount_minor,'interval','month','intervalCount',1)::text,'UTF8'),'sha256'),'hex');
 insert into public.saas_offer_contracts(environment,plan,price_id,product_id,currency,unit_amount_minor,interval,interval_count,verified_at)values(p_environment,p_plan,p_price_id,p_product_id,'usd',p_unit_amount_minor,'month',1,p_verified_at)
 on conflict(environment,price_id)do nothing;
 select*into strict v_contract from public.saas_offer_contracts where environment=p_environment and price_id=p_price_id for update;
 if v_contract.plan<>p_plan or v_contract.product_id<>p_product_id or v_contract.contract_digest<>v_digest then raise exception'audited offer identity conflict'using errcode='23505';end if;
 insert into public.saas_offer_contract_installations(contract_id,observed_digest)values(v_contract.contract_id,v_digest)on conflict(contract_id,observed_digest)do nothing;
 return v_contract.contract_id;
end $$;
revoke all on function public.install_saas_offer_contract(text,text,text,text,integer,timestamptz)from public,anon,authenticated,service_role,booking_worker;
create function public.assert_saas_offer_readiness(p_environment text)returns boolean language plpgsql security definer set search_path=''as $$
begin
 if p_environment not in('test','live')then raise exception'invalid SaaS offer readiness environment'using errcode='22023';end if;
 if(select count(*)from public.saas_offer_contracts c join public.saas_offer_contract_installations a on a.contract_id=c.contract_id and a.observed_digest=c.contract_digest where c.environment=p_environment and c.active_for_new_sales and c.plan in('starter','pro'))<>2 or exists(select 1 from public.saas_offer_contracts c where c.environment=p_environment and c.active_for_new_sales and c.contract_digest<>pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object('environment',c.environment,'plan',c.plan,'priceId',c.price_id,'productId',c.product_id,'currency',c.currency,'unitAmountMinor',c.unit_amount_minor,'interval',c.interval,'intervalCount',c.interval_count)::text,'UTF8'),'sha256'),'hex'))then raise exception'SaaS offer registry is not audited and ready'using errcode='P0001';end if;
 return true;
end $$;
revoke all on function public.assert_saas_offer_readiness(text)from public,anon,authenticated,service_role,booking_worker;

do $$ begin
 alter table public.checkout_sessions add constraint checkout_sessions_offer_contract_fk foreign key(provider_offer_contract_id)references public.saas_offer_contracts(contract_id)on delete restrict;
exception when duplicate_object then null;end $$;
do $$ begin
 alter table public.subscriptions add constraint subscriptions_offer_contract_fk foreign key(provider_offer_contract_id)references public.saas_offer_contracts(contract_id)on delete restrict;
exception when duplicate_object then null;end $$;

alter table public.checkout_sessions drop constraint if exists checkout_sessions_provider_offer_snapshot_ck;
alter table public.checkout_sessions add constraint checkout_sessions_provider_offer_snapshot_ck check(
 provider_offer_snapshot is null or(
  pg_catalog.jsonb_typeof(provider_offer_snapshot)='object'
  and provider_offer_snapshot->>'contractVersion'='1'
  and provider_offer_snapshot->>'unitAmountMinor'=case plan when'starter'then'7900'when'pro'then'12900'end
  and provider_offer_snapshot ?& array['contractVersion','plan','livemode','priceId','productId','currency','unitAmountMinor','interval','intervalCount','productName','productDescription']
  and provider_offer_snapshot-array['contractVersion','plan','livemode','priceId','productId','currency','unitAmountMinor','interval','intervalCount','productName','productDescription']='{}'::jsonb
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'contractVersion')='number'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'plan')='string'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'priceId')='string'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'productId')='string'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'currency')='string'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'unitAmountMinor')='number'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'interval')='string'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'intervalCount')='number'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'productName')='string'
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'productDescription')='string'
  and pg_catalog.pg_column_size(provider_offer_snapshot)<=4096
  and provider_offer_snapshot->>'plan'=plan
  and pg_catalog.jsonb_typeof(provider_offer_snapshot->'livemode')='boolean'
  and(provider_offer_snapshot->>'livemode')::boolean=(environment='live')
  and provider_offer_snapshot->>'currency'='usd'
  and provider_offer_snapshot->>'interval'='month'
  and provider_offer_snapshot->>'intervalCount'='1'
  and provider_offer_snapshot->>'unitAmountMinor'=case plan when'starter'then'7900'when'pro'then'12900'end
  and nullif(pg_catalog.btrim(provider_offer_snapshot->>'priceId'),'')is not null
  and nullif(pg_catalog.btrim(provider_offer_snapshot->>'productId'),'')is not null
  and nullif(pg_catalog.btrim(provider_offer_snapshot->>'productName'),'')is not null
 ))not valid;
alter table public.checkout_sessions validate constraint checkout_sessions_provider_offer_snapshot_ck;
alter table public.checkout_sessions add constraint checkout_sessions_provider_evidence_state_ck check(
 -- Migration-only post-payment records carry no provider evidence and may not be inserted by the app.
 (payment_evidence_kind='legacy_post_payment'and legacy_evidence_version is null and provider_offer_snapshot is null and provider_completion_evidence is null and provider_completion_event_id is null and provider_completion_payload_hash is null and payment_verified_at is null and payment_provider_session_id is null and payment_price_id is null)
 -- Explicit scalar Stripe history is retained for reconciliation only, never for new entitlement grants.
 or(payment_evidence_kind='stripe_api'and legacy_evidence_version=1 and provider_offer_snapshot is null and provider_offer_contract_id is null and provider_offer_contract_digest is null and provider_completion_evidence is null and provider_completion_event_id is null and provider_completion_payload_hash is null and payment_verified_at is not null and payment_provider_session_id is not null and payment_price_id is not null)
 -- Local simulations are test-only and never mix with provider evidence.
 or(payment_evidence_kind='local_test_simulation'and legacy_evidence_version is null and environment='test'and provider_offer_snapshot is null and provider_completion_evidence is null and provider_completion_event_id is null and provider_completion_payload_hash is null and provider_offer_contract_id is null and provider_offer_contract_digest is null and payment_verified_at is not null)
 -- A fresh reservation locks its offer before the external Checkout Session exists.
 or(provider_offer_snapshot is not null and provider_offer_contract_id is not null and provider_offer_contract_digest is not null and payment_evidence_kind is null and payment_verified_at is null and provider_completion_evidence is null and provider_completion_event_id is null and provider_completion_payload_hash is null)
 -- A Stripe-paid checkout has complete, signed-inbox provenance and immutable canonical evidence.
 or(payment_evidence_kind='stripe_api'and legacy_evidence_version is null and payment_verified_at is not null and payment_provider_session_id is not null and payment_price_id is not null and provider_offer_snapshot is not null and provider_offer_contract_id is not null and provider_offer_contract_digest is not null and provider_completion_evidence is not null and provider_completion_event_id is not null and provider_completion_payload_hash~'^[a-f0-9]{64}$')
)not valid;
alter table public.checkout_sessions validate constraint checkout_sessions_provider_evidence_state_ck;

create or replace function public.protect_paid_checkout_identity()returns trigger language plpgsql security definer set search_path=''as $$
begin
 -- A snapshot names a particular append-only Price/Product contract, not merely a plan label.
 if new.provider_offer_snapshot is not null and not exists(select 1 from public.saas_offer_contracts c where c.contract_id=new.provider_offer_contract_id and c.contract_digest=new.provider_offer_contract_digest and c.environment=new.environment and c.plan=new.plan and c.price_id=new.provider_offer_snapshot->>'priceId'and c.product_id=new.provider_offer_snapshot->>'productId'and c.currency=new.provider_offer_snapshot->>'currency'and c.unit_amount_minor=(new.provider_offer_snapshot->>'unitAmountMinor')::integer and c.interval=new.provider_offer_snapshot->>'interval'and c.interval_count=(new.provider_offer_snapshot->>'intervalCount')::integer)then raise exception'checkout offer snapshot does not match frozen provider contract'using errcode='P0001';end if;
 -- A completed Stripe record is a typed, exact envelope tied to the stored signed inbox event.
 if new.provider_completion_evidence is not null and(
  pg_catalog.jsonb_typeof(new.provider_completion_evidence)<>'object'or not(new.provider_completion_evidence ?& array['contractVersion','plan','livemode','providerSubscriptionId','providerCustomerId','priceId','productId','currency','unitAmountMinor','interval','intervalCount','quantity','checkoutLineItemsComplete','subscriptionItemsComplete','zeroDiscounts','zeroTaxes','automaticTaxDisabled','adaptivePricingDisabled','providerEventId','providerPayloadHash'])or new.provider_completion_evidence-array['contractVersion','plan','livemode','providerSubscriptionId','providerCustomerId','priceId','productId','currency','unitAmountMinor','interval','intervalCount','quantity','checkoutLineItemsComplete','subscriptionItemsComplete','zeroDiscounts','zeroTaxes','automaticTaxDisabled','adaptivePricingDisabled','providerEventId','providerPayloadHash']<>'{}'::jsonb or new.provider_completion_evidence->>'contractVersion'<>'1'or new.provider_completion_evidence->>'plan' is distinct from new.plan or(new.provider_completion_evidence->>'livemode')::boolean is distinct from(new.environment='live')or new.provider_completion_evidence->>'priceId'is distinct from new.provider_offer_snapshot->>'priceId'or new.provider_completion_evidence->>'productId'is distinct from new.provider_offer_snapshot->>'productId'or new.provider_completion_evidence->>'currency'<>'usd'or new.provider_completion_evidence->>'unitAmountMinor'is distinct from new.provider_offer_snapshot->>'unitAmountMinor'or new.provider_completion_evidence->>'interval'<>'month'or new.provider_completion_evidence->>'intervalCount'<>'1'or new.provider_completion_evidence->>'quantity'<>'1'or new.provider_completion_evidence->>'checkoutLineItemsComplete'<>'true'or new.provider_completion_evidence->>'subscriptionItemsComplete'<>'true'or new.provider_completion_evidence->>'zeroDiscounts'<>'true'or new.provider_completion_evidence->>'zeroTaxes'<>'true'or new.provider_completion_evidence->>'automaticTaxDisabled'<>'true'or new.provider_completion_evidence->>'adaptivePricingDisabled'<>'true'or new.provider_completion_evidence->>'providerEventId' is null or new.provider_completion_evidence->>'providerPayloadHash' is distinct from new.provider_completion_payload_hash or not exists(select 1 from public.provider_event_inbox i where i.id=new.provider_completion_event_id and i.provider='stripe'and i.event_family='saas'and i.event_type='checkout.session.completed'and i.environment=new.environment and i.event_id=new.provider_completion_evidence->>'providerEventId'and i.payload_hash=new.provider_completion_payload_hash and i.payload->'data'->'object'->>'id'=new.payment_provider_session_id)
 )then raise exception'checkout completion evidence is not canonical signed Stripe proof'using errcode='P0001';end if;
 if tg_op='INSERT'and(new.payment_evidence_kind='legacy_post_payment'or new.legacy_evidence_version is not null)then raise exception'legacy payment evidence is migration-only'using errcode='P0001';end if;
 if tg_op='UPDATE'and(new.payment_evidence_kind='legacy_post_payment'and old.payment_evidence_kind is distinct from'legacy_post_payment'or new.legacy_evidence_version is distinct from old.legacy_evidence_version)then raise exception'legacy payment evidence is immutable and migration-only'using errcode='P0001';end if;
 if tg_op='UPDATE'and old.provider_offer_snapshot is not null and(new.provider_offer_snapshot is distinct from old.provider_offer_snapshot or new.provider_offer_contract_id is distinct from old.provider_offer_contract_id or new.provider_offer_contract_digest is distinct from old.provider_offer_contract_digest)then raise exception'checkout purchase contract is immutable'using errcode='P0001';end if;
 if tg_op='UPDATE'and old.provider_completion_evidence is not null and new.provider_completion_evidence is distinct from old.provider_completion_evidence then raise exception'checkout completion evidence is immutable'using errcode='P0001';end if;
 if tg_op='UPDATE'and old.provider_completion_event_id is not null and(new.provider_completion_event_id is distinct from old.provider_completion_event_id or new.provider_completion_payload_hash is distinct from old.provider_completion_payload_hash)then raise exception'checkout completion provenance is immutable'using errcode='P0001';end if;
 if tg_op='UPDATE'and(old.payment_verified_at is not null or old.payment_evidence_kind='legacy_post_payment')and(
  new.profile_id is distinct from old.profile_id or new.website_id is distinct from old.website_id or new.environment is distinct from old.environment
  or new.license_number is distinct from old.license_number or pg_catalog.lower(new.email)is distinct from pg_catalog.lower(old.email)
  or new.full_name is distinct from old.full_name or new.business_name is distinct from old.business_name or new.city is distinct from old.city
  or new.plan is distinct from old.plan or new.subscription_id is distinct from old.subscription_id or new.context_json is distinct from old.context_json
  or new.legal_accepted_at is distinct from old.legal_accepted_at or new.legal_acceptance_ip_hash is distinct from old.legal_acceptance_ip_hash
  or new.legal_acceptance_user_agent is distinct from old.legal_acceptance_user_agent or new.legal_document_versions is distinct from old.legal_document_versions
  or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id or new.provider_offer_snapshot is distinct from old.provider_offer_snapshot or new.provider_offer_contract_id is distinct from old.provider_offer_contract_id or new.provider_offer_contract_digest is distinct from old.provider_offer_contract_digest or new.provider_completion_evidence is distinct from old.provider_completion_evidence or new.provider_completion_event_id is distinct from old.provider_completion_event_id or new.provider_completion_payload_hash is distinct from old.provider_completion_payload_hash
  or new.payment_evidence_kind is distinct from old.payment_evidence_kind or new.payment_verified_at is distinct from old.payment_verified_at
  or new.payment_provider_session_id is distinct from old.payment_provider_session_id or new.payment_price_id is distinct from old.payment_price_id
  or new.status not in('pending_otp','completed')or(new.status='completed'and new.completed_at is null)
 )then raise exception'paid checkout identity is immutable'using errcode='P0001';end if;
 return new;
end $$;
revoke all on function public.protect_paid_checkout_identity()from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.protect_paid_checkout_identity()to service_role;

create or replace function public.protect_saas_subscription_offer_snapshot()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.provider_offer_snapshot is not null and(
  pg_catalog.jsonb_typeof(new.provider_offer_snapshot)<>'object'or not(new.provider_offer_snapshot ?& array['contractVersion','plan','livemode','priceId','productId','currency','unitAmountMinor','interval','intervalCount','productName','productDescription'])or new.provider_offer_snapshot-array['contractVersion','plan','livemode','priceId','productId','currency','unitAmountMinor','interval','intervalCount','productName','productDescription']<>'{}'::jsonb or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'contractVersion')<>'number'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'plan')<>'string'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'livemode')<>'boolean'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'priceId')<>'string'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'productId')<>'string'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'currency')<>'string'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'unitAmountMinor')<>'number'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'interval')<>'string'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'intervalCount')<>'number'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'productName')<>'string'or pg_catalog.jsonb_typeof(new.provider_offer_snapshot->'productDescription')<>'string'or new.provider_offer_snapshot->>'contractVersion'<>'1'or new.provider_offer_snapshot->>'plan' is distinct from new.plan or(new.provider_offer_snapshot->>'livemode')::boolean is distinct from(new.environment='live')or new.provider_offer_snapshot->>'currency'<>'usd'or new.provider_offer_snapshot->>'interval'<>'month'or new.provider_offer_snapshot->>'intervalCount'<>'1'or new.provider_offer_snapshot->>'unitAmountMinor'is distinct from case new.plan when'starter'then'7900'when'pro'then'12900'end or nullif(pg_catalog.btrim(new.provider_offer_snapshot->>'priceId'),'')is null or nullif(pg_catalog.btrim(new.provider_offer_snapshot->>'productId'),'')is null or nullif(pg_catalog.btrim(new.provider_offer_snapshot->>'productName'),'')is null or not exists(select 1 from public.saas_offer_contracts c where c.contract_id=new.provider_offer_contract_id and c.contract_digest=new.provider_offer_contract_digest and c.environment=new.environment and c.plan=new.plan and c.price_id=new.provider_offer_snapshot->>'priceId'and c.product_id=new.provider_offer_snapshot->>'productId'and c.currency='usd'and c.unit_amount_minor=(new.provider_offer_snapshot->>'unitAmountMinor')::integer and c.interval='month'and c.interval_count=(new.provider_offer_snapshot->>'intervalCount')::integer)
 )then raise exception'subscription offer snapshot does not match frozen provider contract'using errcode='P0001';end if;
 if tg_op='UPDATE'and old.provider_offer_snapshot is not null and(new.provider_offer_snapshot is distinct from old.provider_offer_snapshot or new.provider_offer_contract_id is distinct from old.provider_offer_contract_id or new.provider_offer_contract_digest is distinct from old.provider_offer_contract_digest)then raise exception'subscription purchase contract is immutable'using errcode='P0001';end if;return new;
end $$;
drop trigger if exists subscriptions_offer_snapshot_immutable on public.subscriptions;
create trigger subscriptions_offer_snapshot_immutable before insert or update of provider_offer_snapshot,provider_offer_contract_id,provider_offer_contract_digest on public.subscriptions for each row execute function public.protect_saas_subscription_offer_snapshot();
revoke all on function public.protect_saas_subscription_offer_snapshot()from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.protect_saas_subscription_offer_snapshot()to service_role;

-- A lifecycle event may arrive before Checkout binds its provider subscription. The immutable inbox
-- envelope remains the authority; this private table is a durable, typed obligation accepted by the
-- fenced reducer. Unapplied rows have no TTL and are never dead-lettered or deleted automatically.
-- Applied rows are retained for audit. Any future compaction must first establish a separately durable
-- reconciliation watermark; no worker or schedule is enabled by this migration.
create table public.deferred_unbound_subscription(
 provider_event_inbox_id uuid primary key references public.provider_event_inbox(id)on delete restrict,
 provider_event_id text not null check(nullif(pg_catalog.btrim(provider_event_id),'')is not null),
 provider_event_type text not null check(provider_event_type in('customer.subscription.updated','customer.subscription.deleted','invoice.payment_failed')),
 environment text not null check(environment in('test','live')),
 provider_subscription_id text not null check(nullif(pg_catalog.btrim(provider_subscription_id),'')is not null),
 source_created_at timestamptz not null,
 projection_version smallint not null default 1 check(projection_version=1),
 projected_status text not null check(projected_status in('active','past_due','cancelled')),
 price_id text not null check(nullif(pg_catalog.btrim(price_id),'')is not null),
 product_id text not null check(nullif(pg_catalog.btrim(product_id),'')is not null),
 quantity integer not null check(quantity=1),
 current_period_end timestamptz not null,
 cancel_at_period_end boolean not null,
 provider_payload_hash text not null check(provider_payload_hash~'^[a-f0-9]{64}$'),
 projection_hash text not null check(projection_hash~'^[a-f0-9]{64}$'),
 accepted_order bigint generated always as identity,
 state text not null default'deferred'check(state in('deferred','applied')),
 deferred_at timestamptz not null default pg_catalog.clock_timestamp(),
 applied_at timestamptz,
 constraint deferred_unbound_subscription_state_ck check((state='deferred'and applied_at is null)or(state='applied'and applied_at is not null)),
 unique(environment,provider_event_id,provider_subscription_id),
 unique(accepted_order)
);
alter table public.deferred_unbound_subscription enable row level security;
revoke all on public.deferred_unbound_subscription from public,anon,authenticated,service_role,booking_worker;
revoke all on sequence public.deferred_unbound_subscription_accepted_order_seq from public,anon,authenticated,service_role,booking_worker;
create index deferred_unbound_subscription_pending_idx on public.deferred_unbound_subscription(environment,provider_subscription_id,source_created_at,accepted_order)where state='deferred';

create function public.guard_deferred_unbound_subscription()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception'deferred subscription obligations are retained'using errcode='55000';end if;
 if new.provider_event_inbox_id is distinct from old.provider_event_inbox_id or new.provider_event_id is distinct from old.provider_event_id or new.provider_event_type is distinct from old.provider_event_type or new.environment is distinct from old.environment or new.provider_subscription_id is distinct from old.provider_subscription_id or new.source_created_at is distinct from old.source_created_at or new.projection_version is distinct from old.projection_version or new.projected_status is distinct from old.projected_status or new.price_id is distinct from old.price_id or new.product_id is distinct from old.product_id or new.quantity is distinct from old.quantity or new.current_period_end is distinct from old.current_period_end or new.cancel_at_period_end is distinct from old.cancel_at_period_end or new.provider_payload_hash is distinct from old.provider_payload_hash or new.projection_hash is distinct from old.projection_hash or new.accepted_order is distinct from old.accepted_order or new.deferred_at is distinct from old.deferred_at then raise exception'deferred subscription obligation facts are immutable'using errcode='55000';end if;
 if old.state='applied'and(new.state is distinct from old.state or new.applied_at is distinct from old.applied_at)then raise exception'applied subscription obligation is immutable'using errcode='55000';end if;
 if old.state='deferred'and(new.state<>'applied'or new.applied_at is null)then raise exception'invalid deferred subscription transition'using errcode='55000';end if;
 return new;
end $$;
create trigger deferred_unbound_subscription_guard before update or delete on public.deferred_unbound_subscription for each row execute function public.guard_deferred_unbound_subscription();
revoke all on function public.guard_deferred_unbound_subscription()from public,anon,authenticated,service_role,booking_worker;

-- The finalizer is created before the lifecycle projector below, so this SQL helper deliberately uses
-- dynamic SQL. The function itself is private and its only caller is the signed, fenced finalizer.
create function public.reapply_deferred_unbound_subscription(p_environment text,p_provider_subscription_id text)returns integer language plpgsql security definer set search_path=''as $$
declare d public.deferred_unbound_subscription%rowtype;did_apply boolean;applied_count integer:=0;
begin
 if p_environment not in('test','live')or nullif(pg_catalog.btrim(p_provider_subscription_id),'')is null then raise exception'invalid deferred subscription reapply'using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saas-subscription-binding-v1:'||p_environment||':'||p_provider_subscription_id,0));
 if not exists(select 1 from public.subscriptions s where s.environment=p_environment and s.provider_subscription_id=p_provider_subscription_id)then raise exception'deferred subscription binding is missing'using errcode='40001';end if;
 for d in select*from public.deferred_unbound_subscription x where x.environment=p_environment and x.provider_subscription_id=p_provider_subscription_id and x.state='deferred'order by x.source_created_at,x.accepted_order for update loop
  if not exists(select 1 from public.provider_event_inbox i where i.id=d.provider_event_inbox_id and i.provider='stripe'and i.event_family='saas'and i.event_id=d.provider_event_id and i.event_type=d.provider_event_type and i.environment=d.environment and i.livemode=(d.environment='live')and i.payload_hash=d.provider_payload_hash and pg_catalog.length(i.payload_hash)=64)then raise exception'deferred subscription inbox provenance mismatch'using errcode='P0001';end if;
  execute 'select public.project_saas_subscription_status($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'into did_apply using d.provider_subscription_id,d.environment,d.projected_status,d.source_created_at,d.provider_event_id,d.price_id,d.product_id,d.quantity,d.current_period_end,d.cancel_at_period_end;
  if did_apply is distinct from true then raise exception'deferred subscription binding disappeared'using errcode='40001';end if;
  update public.deferred_unbound_subscription set state='applied',applied_at=pg_catalog.clock_timestamp()where provider_event_inbox_id=d.provider_event_inbox_id and state='deferred';
  if not found then raise exception'deferred subscription obligation transition lost'using errcode='40001';end if;
  applied_count:=applied_count+1;
 end loop;
 return applied_count;
end $$;
revoke all on function public.reapply_deferred_unbound_subscription(text,text)from public,anon,authenticated,service_role,booking_worker;

-- Stripe SaaS envelopes are immutable signed evidence.  Processing/lease fields remain mutable only
-- through fenced reducers and this narrow redelivery signal; payload identity can never be rewritten.
create function public.guard_saas_stripe_inbox_envelope()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if tg_op='INSERT'and new.provider='stripe'and new.event_family='saas'and(nullif(pg_catalog.btrim(new.event_id),'')is null or nullif(pg_catalog.btrim(new.event_type),'')is null or new.livemode is distinct from(new.environment='live')or new.payload_hash!~'^[a-f0-9]{64}$'or pg_catalog.jsonb_typeof(new.payload)<>'object'or new.signature_timestamp is null or new.profile_id is not null or new.account_context<>''or new.destination<>'obra-saas-webhook'or nullif(pg_catalog.btrim(new.api_version),'')is null)then raise exception'invalid signed SaaS Stripe envelope'using errcode='22023';end if;
 if tg_op='DELETE'then if old.provider='stripe'and old.event_family='saas'then raise exception'SaaS Stripe envelope is immutable'using errcode='55000';end if;return old;end if;
 if tg_op='UPDATE'and((old.provider='stripe'and old.event_family='saas')or(new.provider='stripe'and new.event_family='saas'))then
  -- Neither an already-signed envelope nor an unrelated row may be reclassified into one.
  if new.id is distinct from old.id or not(old.provider='stripe'and old.event_family='saas'and new.provider='stripe'and new.event_family='saas')or new.event_id is distinct from old.event_id or new.account_context is distinct from old.account_context or new.destination is distinct from old.destination or new.api_version is distinct from old.api_version or new.livemode is distinct from old.livemode or new.environment is distinct from old.environment or new.profile_id is distinct from old.profile_id or new.pipedream_binding_id is distinct from old.pipedream_binding_id or new.pipedream_trigger_id is distinct from old.pipedream_trigger_id or new.event_type is distinct from old.event_type or new.payload_hash is distinct from old.payload_hash or new.payload is distinct from old.payload or new.signature_timestamp is distinct from old.signature_timestamp or new.received_at is distinct from old.received_at then raise exception'SaaS Stripe envelope is immutable'using errcode='55000';end if;
 end if;
 return new;
end $$;
create trigger provider_event_inbox_saas_stripe_envelope before insert or update or delete on public.provider_event_inbox for each row execute function public.guard_saas_stripe_inbox_envelope();
drop trigger if exists provider_event_inbox_no_truncate_saas on public.provider_event_inbox;
create trigger provider_event_inbox_no_truncate_saas before truncate on public.provider_event_inbox for each statement execute function public.reject_provider_inbox_truncate_v3();
revoke all on function public.guard_saas_stripe_inbox_envelope()from public,anon,authenticated,service_role,booking_worker;

create function public.signal_saas_provider_event_retry(p_event_id uuid)returns boolean language plpgsql security definer set search_path=''as $$
begin
 update public.provider_event_inbox set next_attempt_at=pg_catalog.clock_timestamp()
 where id=p_event_id and provider='stripe'and event_family='saas'and processing_state in('pending','processing','failed')and(lease_expires_at is null or lease_expires_at<=pg_catalog.clock_timestamp());
 return found;
end $$;
revoke all on function public.signal_saas_provider_event_retry(uuid)from public,anon,authenticated,booking_worker;
grant execute on function public.signal_saas_provider_event_retry(uuid)to service_role;

-- Expand/app/contract rollout: preserve the historical overload but remove service execution before
-- deploying the snapshot-aware app.  Drain old instances and reconcile their pending reservations
-- before separately removing the overload; never use a defaulted trailing argument while both exist.
revoke all on function public.reserve_checkout_intent(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,text,text,jsonb)from public,anon,authenticated,service_role,booking_worker;
create function public.reserve_checkout_intent(
 p_profile_id uuid,p_website_id uuid,p_environment text,p_license_number text,p_email text,p_full_name text,p_business_name text,p_city text,p_plan text,p_status text,
 p_legal_accepted_at timestamptz,p_legal_acceptance_ip_hash text,p_legal_acceptance_user_agent text,p_legal_document_versions jsonb,p_provider_offer_snapshot jsonb
)returns table(checkout_session_id uuid,subscription_id uuid,checkout_status text,checkout_email text,checkout_plan text,disposition text)
language plpgsql security definer set search_path=''as $$
declare existing public.checkout_sessions%rowtype;subscription_row public.subscriptions%rowtype;reserved public.checkout_sessions%rowtype;offer_contract public.saas_offer_contracts%rowtype;normalized_email text;exact_identity boolean;
begin
 normalized_email:=pg_catalog.lower(pg_catalog.btrim(p_email));
 if p_profile_id is null or p_website_id is null or p_environment not in('test','live')or p_plan not in('starter','pro')or p_status not in('pending_payment','pending_otp')
  or pg_catalog.btrim(coalesce(p_license_number,''))=''or normalized_email=''or(p_status='pending_payment'and p_provider_offer_snapshot is null)or(p_status='pending_otp'and p_provider_offer_snapshot is not null)
  or(p_provider_offer_snapshot is not null and(
   pg_catalog.jsonb_typeof(p_provider_offer_snapshot)is distinct from'object'or not(p_provider_offer_snapshot ?& array['contractVersion','plan','livemode','priceId','productId','currency','unitAmountMinor','interval','intervalCount','productName','productDescription'])or p_provider_offer_snapshot-array['contractVersion','plan','livemode','priceId','productId','currency','unitAmountMinor','interval','intervalCount','productName','productDescription']<>'{}'::jsonb or pg_catalog.pg_column_size(p_provider_offer_snapshot)>4096
   or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'contractVersion')is distinct from'number'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'plan')is distinct from'string'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'livemode')is distinct from'boolean'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'priceId')is distinct from'string'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'productId')is distinct from'string'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'currency')is distinct from'string'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'unitAmountMinor')is distinct from'number'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'interval')is distinct from'string'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'intervalCount')is distinct from'number'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'productName')is distinct from'string'or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'productDescription')is distinct from'string'
   or p_provider_offer_snapshot->>'contractVersion' is distinct from'1'or p_provider_offer_snapshot->>'plan' is distinct from p_plan
   or pg_catalog.jsonb_typeof(p_provider_offer_snapshot->'livemode')is distinct from'boolean'or(p_provider_offer_snapshot->>'livemode')::boolean is distinct from(p_environment='live')or p_provider_offer_snapshot->>'currency'is distinct from'usd'or p_provider_offer_snapshot->>'interval'is distinct from'month'or p_provider_offer_snapshot->>'intervalCount'is distinct from'1'
   or p_provider_offer_snapshot->>'unitAmountMinor'is distinct from case p_plan when'starter'then'7900'else'12900'end
   or nullif(p_provider_offer_snapshot->>'priceId','')is null or nullif(p_provider_offer_snapshot->>'productId','')is null
   or nullif(pg_catalog.btrim(p_provider_offer_snapshot->>'productName'),'')is null
  ))then raise exception'invalid checkout reservation'using errcode='22023';end if;
 if p_provider_offer_snapshot is not null then
  select*into offer_contract from public.saas_offer_contracts c where c.environment=p_environment and c.plan=p_plan and c.active_for_new_sales
   and c.price_id=p_provider_offer_snapshot->>'priceId'and c.product_id=p_provider_offer_snapshot->>'productId'
   and c.currency=p_provider_offer_snapshot->>'currency'and c.unit_amount_minor=(p_provider_offer_snapshot->>'unitAmountMinor')::integer
   and c.interval=p_provider_offer_snapshot->>'interval'and c.interval_count=(p_provider_offer_snapshot->>'intervalCount')::integer for key share;
  if offer_contract.contract_id is null then raise exception'checkout offer is not an active verified new-sales contract'using errcode='P0001';end if;
 end if;
 perform 1 from public.websites where id=p_website_id and user_id=p_profile_id and environment=p_environment for update;
 if not found then raise exception'website tenant mismatch'using errcode='P0001';end if;
 select*into existing from public.checkout_sessions where website_id=p_website_id and environment=p_environment and status in('pending_payment','pending_otp')for update;
 if found then
  exact_identity:=existing.profile_id=p_profile_id and existing.website_id=p_website_id and existing.environment=p_environment and existing.license_number=p_license_number
   and pg_catalog.lower(pg_catalog.btrim(existing.email))=normalized_email and existing.plan=p_plan and existing.full_name is not distinct from p_full_name
   and existing.business_name is not distinct from p_business_name and existing.city is not distinct from p_city
   and(existing.legal_document_versions is not distinct from p_legal_document_versions or(existing.payment_evidence_kind='legacy_post_payment'and existing.legal_document_versions is null))
   and existing.provider_offer_snapshot is not distinct from p_provider_offer_snapshot;
  if existing.status='pending_otp'then
   if existing.payment_evidence_kind is null or(existing.payment_evidence_kind<>'legacy_post_payment'and existing.payment_verified_at is null)then raise exception'checkout payment finalization is still in progress'using errcode='P0001';end if;
   if not exact_identity then raise exception'paid checkout already awaits verification for different identity'using errcode='23505';end if;
   return query select existing.id,existing.subscription_id,existing.status,existing.email,existing.plan,'reused_pending_otp'::text;return;
  end if;
  if exact_identity and p_status='pending_payment'then return query select existing.id,existing.subscription_id,existing.status,existing.email,existing.plan,'reused_pending_payment'::text;return;end if;
  if existing.stripe_checkout_session_id is not null then raise exception'provider checkout already active for different intent'using errcode='23505';end if;
  update public.checkout_sessions set status='expired',subscription_id=null where id=existing.id and status='pending_payment';
  if existing.subscription_id is not null then delete from public.subscriptions where id=existing.subscription_id and status='pending_activation'and provider_subscription_id is null and stripe_subscription_id is null;end if;
 end if;
 insert into public.subscriptions(user_id,plan,status,environment,provider_offer_snapshot,provider_offer_contract_id,provider_offer_contract_digest)values(p_profile_id,p_plan,'pending_activation',p_environment,p_provider_offer_snapshot,offer_contract.contract_id,offer_contract.contract_digest)returning*into subscription_row;
 if p_status='pending_otp'and p_environment<>'test'then raise exception'simulated checkout is test-only'using errcode='P0001';end if;
 insert into public.checkout_sessions(profile_id,website_id,environment,license_number,email,full_name,business_name,city,plan,subscription_id,status,legal_accepted_at,legal_acceptance_ip_hash,legal_acceptance_user_agent,legal_document_versions,payment_evidence_kind,payment_verified_at,context_json,provider_offer_snapshot,provider_offer_contract_id,provider_offer_contract_digest)
 values(p_profile_id,p_website_id,p_environment,p_license_number,normalized_email,p_full_name,p_business_name,p_city,p_plan,subscription_row.id,p_status,p_legal_accepted_at,p_legal_acceptance_ip_hash,p_legal_acceptance_user_agent,p_legal_document_versions,case when p_status='pending_otp'then'local_test_simulation'else null end,case when p_status='pending_otp'then pg_catalog.clock_timestamp()else null end,pg_catalog.jsonb_build_object('source','post_checkout','websiteId',p_website_id),p_provider_offer_snapshot,offer_contract.contract_id,offer_contract.contract_digest)returning*into reserved;
 return query select reserved.id,reserved.subscription_id,reserved.status,reserved.email,reserved.plan,'created'::text;
end $$;
revoke all on function public.reserve_checkout_intent(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,text,text,jsonb,jsonb)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.reserve_checkout_intent(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,text,text,jsonb,jsonb)to service_role;

create function public.attach_saas_checkout_provider_session(p_checkout_session_id uuid,p_provider_session_id text)returns text language plpgsql security definer set search_path=''as $$
declare c public.checkout_sessions%rowtype;
begin
 if p_checkout_session_id is null or nullif(p_provider_session_id,'')is null then raise exception'invalid provider session attachment'using errcode='22023';end if;
 select*into strict c from public.checkout_sessions where id=p_checkout_session_id for update;
 if c.status<>'pending_payment'then return'stale';end if;
 if c.stripe_checkout_session_id is null then update public.checkout_sessions set stripe_checkout_session_id=p_provider_session_id where id=c.id;return'attached';end if;
 if c.stripe_checkout_session_id=p_provider_session_id then return'already_attached';end if;
 raise exception'checkout provider session identity conflict'using errcode='23505';
exception when no_data_found then return'stale';
end $$;
revoke all on function public.attach_saas_checkout_provider_session(uuid,text)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.attach_saas_checkout_provider_session(uuid,text)to service_role;

create table public.saas_checkout_fulfillment_outbox(
 id uuid primary key default gen_random_uuid(),checkout_session_id uuid not null unique references public.checkout_sessions(id)on delete restrict,
 profile_id uuid not null,environment text not null check(environment in('test','live')),recipient_email text not null check(pg_catalog.length(recipient_email)between 3 and 254),
 state text not null default'pending'check(state in('pending','processing','retry_wait','accepted','delivery_unknown','failed')),attempts integer not null default 0 check(attempts>=0),redrive_count integer not null default 0 check(redrive_count between 0 and 2),
 next_attempt_at timestamptz not null default now(),lease_token uuid,lease_expires_at timestamptz,fencing_token bigint not null default 0,provider_attempts integer not null default 0 check(provider_attempts>=0 and provider_attempts<=8),provider_dispatch_started_at timestamptz,last_error text,
 created_at timestamptz not null default now(),accepted_at timestamptz,failed_at timestamptz,updated_at timestamptz not null default now(),
 constraint saas_checkout_fulfillment_state_ck check(
  (state in('pending','retry_wait')and lease_token is null and lease_expires_at is null and accepted_at is null and failed_at is null)
  or(state='processing'and lease_token is not null and lease_expires_at is not null and accepted_at is null and failed_at is null)
  or(state='accepted'and lease_token is null and lease_expires_at is null and accepted_at is not null and failed_at is null and provider_dispatch_started_at is not null)
  or(state='delivery_unknown'and lease_token is null and lease_expires_at is null and accepted_at is null and failed_at is null and provider_dispatch_started_at is not null)
  or(state='failed'and lease_token is null and lease_expires_at is null and accepted_at is null and failed_at is not null)
 ),
 foreign key(profile_id,environment)references public.profiles(id,environment)
);
alter table public.saas_checkout_fulfillment_outbox enable row level security;
revoke all on public.saas_checkout_fulfillment_outbox from public,anon,authenticated,service_role,booking_worker;

-- Ambiguous Auth responses require a human decision backed by a live AAL2 admin session. The
-- resolution record preserves both the pre-resolution state and external evidence; unknown sends
-- remain excluded from automatic worker claims.
create table public.saas_checkout_fulfillment_resolution_audit(
 id uuid primary key default gen_random_uuid(),fulfillment_id uuid not null references public.saas_checkout_fulfillment_outbox(id)on delete restrict,
 actor_user_id uuid not null references public.admin_principals(user_id)on delete restrict,action text not null check(action in('accepted','retry')),
 expected_fencing_token bigint not null check(expected_fencing_token>=0),prior_state jsonb not null check(pg_catalog.jsonb_typeof(prior_state)='object'),
 reason text not null check(pg_catalog.length(reason)between 3 and 500),evidence jsonb not null check(pg_catalog.jsonb_typeof(evidence)='object'and pg_catalog.pg_column_size(evidence)<=4096),
 resolved_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.saas_checkout_fulfillment_resolution_audit enable row level security;
revoke all on public.saas_checkout_fulfillment_resolution_audit from public,anon,authenticated,service_role,booking_worker;
create function public.protect_saas_checkout_fulfillment_resolution_audit()returns trigger language plpgsql security definer set search_path=''as $$
begin
 raise exception'checkout fulfillment resolution audit is append-only'using errcode='55000';
end $$;
create trigger saas_checkout_fulfillment_resolution_audit_no_mutation before update or delete on public.saas_checkout_fulfillment_resolution_audit for each row execute function public.protect_saas_checkout_fulfillment_resolution_audit();
create trigger saas_checkout_fulfillment_resolution_audit_no_truncate before truncate on public.saas_checkout_fulfillment_resolution_audit for each statement execute function public.protect_saas_checkout_fulfillment_resolution_audit();
revoke all on function public.protect_saas_checkout_fulfillment_resolution_audit()from public,anon,authenticated,service_role,booking_worker;
create index saas_checkout_fulfillment_due_idx on public.saas_checkout_fulfillment_outbox(environment,next_attempt_at,created_at)where state in('pending','processing','retry_wait');
-- Auth does not accept an idempotency key. A crash after begin-dispatch is therefore never auto-retried:
-- recovery leaves a durable delivery_unknown record for operator reconciliation rather than sending a duplicate.

create function public.enqueue_saas_checkout_fulfillment(p_checkout_session_id uuid)returns boolean language plpgsql security definer set search_path=''as $$
declare c public.checkout_sessions%rowtype;
begin
 select*into strict c from public.checkout_sessions where id=p_checkout_session_id for update;
 if c.status not in('pending_otp','completed')or c.payment_verified_at is null or c.payment_evidence_kind<>'stripe_api'or c.legacy_evidence_version is not null or c.profile_id is null or c.environment is null or c.provider_offer_snapshot is null or c.provider_offer_contract_id is null or c.provider_offer_contract_digest is null or c.provider_completion_evidence is null or c.provider_completion_event_id is null or c.provider_completion_payload_hash!~'^[a-f0-9]{64}$'or not exists(select 1 from public.provider_event_inbox i where i.id=c.provider_completion_event_id and i.provider='stripe'and i.event_family='saas'and i.event_type='checkout.session.completed'and i.environment=c.environment and i.payload_hash=c.provider_completion_payload_hash)then raise exception'paid checkout is not fulfillable'using errcode='P0001';end if;
 insert into public.saas_checkout_fulfillment_outbox(checkout_session_id,profile_id,environment,recipient_email)values(c.id,c.profile_id,c.environment,pg_catalog.lower(c.email))on conflict(checkout_session_id)do nothing;return true;
end $$;
revoke all on function public.enqueue_saas_checkout_fulfillment(uuid)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.enqueue_saas_checkout_fulfillment(uuid)to service_role;

create function public.claim_due_saas_checkout_fulfillment(p_environment text,p_lease_token uuid,p_limit integer default 25)returns setof public.saas_checkout_fulfillment_outbox language plpgsql security definer set search_path=''as $$
begin
 if p_environment not in('test','live')or p_lease_token is null or p_limit not between 1 and 100 then raise exception'invalid SaaS fulfillment claim'using errcode='22023';end if;
 -- A process can die after its final claim but before settlement. Convert only expired/unleased
 -- exhausted rows to a terminal state before selection so bounded operator redrive remains possible.
 update public.saas_checkout_fulfillment_outbox o set state='delivery_unknown',last_error=coalesce(o.last_error,'OTP provider dispatch outcome is unknown; reconcile before any resend'),lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
 where o.environment=p_environment and o.state='processing'and o.provider_dispatch_started_at is not null and(o.lease_expires_at is null or o.lease_expires_at<=pg_catalog.clock_timestamp());
 update public.saas_checkout_fulfillment_outbox o set state='failed',failed_at=coalesce(o.failed_at,pg_catalog.clock_timestamp()),last_error=coalesce(o.last_error,'OTP provider-acceptance retry budget exhausted'),lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
 where o.environment=p_environment and o.provider_attempts>=8 and(o.state in('pending','retry_wait')or(o.state='processing'and o.provider_dispatch_started_at is null and(o.lease_expires_at is null or o.lease_expires_at<=pg_catalog.clock_timestamp())));
 return query with due as(select o.id from public.saas_checkout_fulfillment_outbox o where o.environment=p_environment and(o.state in('pending','retry_wait')or(o.state='processing'and o.provider_dispatch_started_at is null))and o.provider_attempts<8 and o.next_attempt_at<=pg_catalog.clock_timestamp()and(o.lease_expires_at is null or o.lease_expires_at<=pg_catalog.clock_timestamp())order by o.next_attempt_at,o.created_at,o.id for update skip locked limit p_limit)
 update public.saas_checkout_fulfillment_outbox o set state='processing',attempts=o.attempts+1,provider_dispatch_started_at=null,lease_token=p_lease_token,lease_expires_at=pg_catalog.clock_timestamp()+interval'5 minutes',fencing_token=o.fencing_token+1,updated_at=pg_catalog.clock_timestamp()from due where o.id=due.id returning o.*;
end $$;
revoke all on function public.claim_due_saas_checkout_fulfillment(text,uuid,integer)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.claim_due_saas_checkout_fulfillment(text,uuid,integer)to service_role;

create function public.complete_saas_checkout_fulfillment(p_id uuid,p_lease_token uuid,p_fencing_token bigint,p_succeeded boolean,p_retryable boolean,p_safe_error text default null)returns boolean language plpgsql security definer set search_path=''as $$
begin
 update public.saas_checkout_fulfillment_outbox set state=case when p_succeeded then'accepted'when p_retryable and provider_attempts<8 then'retry_wait'else'failed'end,
  accepted_at=case when p_succeeded then pg_catalog.clock_timestamp()else null end,failed_at=case when not p_succeeded and(not p_retryable or provider_attempts>=8)then pg_catalog.clock_timestamp()else null end,
  next_attempt_at=case when p_succeeded or not p_retryable or provider_attempts>=8 then next_attempt_at else pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*pg_catalog.power(2,least(provider_attempts,7))::integer))end,
  last_error=case when p_succeeded then null else pg_catalog.left(coalesce(p_safe_error,'provider rejected OTP request'),500)end,lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
 where id=p_id and state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()and provider_dispatch_started_at is not null;return found;
end $$;
revoke all on function public.complete_saas_checkout_fulfillment(uuid,uuid,bigint,boolean,boolean,text)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.complete_saas_checkout_fulfillment(uuid,uuid,bigint,boolean,boolean,text)to service_role;

-- Admission and lease failures occur before contacting Auth; defer them under the same live fence
-- without consuming provider_attempts. Claim attempts remain an operational diagnostic only.
create function public.defer_saas_checkout_fulfillment(p_id uuid,p_lease_token uuid,p_fencing_token bigint,p_safe_error text)returns boolean language plpgsql security definer set search_path=''as $$
begin
 update public.saas_checkout_fulfillment_outbox set state='retry_wait',next_attempt_at=pg_catalog.clock_timestamp()+interval'60 seconds',last_error=pg_catalog.left(coalesce(p_safe_error,'OTP dispatch deferred before provider call'),500),lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
 where id=p_id and state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()and provider_dispatch_started_at is null;return found;
end $$;
revoke all on function public.defer_saas_checkout_fulfillment(uuid,uuid,bigint,text)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.defer_saas_checkout_fulfillment(uuid,uuid,bigint,text)to service_role;

create function public.renew_saas_checkout_fulfillment(p_id uuid,p_lease_token uuid,p_fencing_token bigint)returns boolean language plpgsql security definer set search_path=''as $$
begin
 update public.saas_checkout_fulfillment_outbox set lease_expires_at=pg_catalog.clock_timestamp()+interval'5 minutes',updated_at=pg_catalog.clock_timestamp()
 where id=p_id and state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp();return found;
end $$;
revoke all on function public.renew_saas_checkout_fulfillment(uuid,uuid,bigint)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.renew_saas_checkout_fulfillment(uuid,uuid,bigint)to service_role;

-- Auth has no request-idempotency key. Persist the dispatch intent before crossing the provider
-- boundary; an expired claimed intent becomes delivery_unknown rather than an automatic duplicate send.
create function public.begin_saas_checkout_fulfillment_dispatch(p_id uuid,p_lease_token uuid,p_fencing_token bigint)returns boolean language plpgsql security definer set search_path=''as $$
begin
 update public.saas_checkout_fulfillment_outbox set provider_attempts=provider_attempts+1,provider_dispatch_started_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp()
 where id=p_id and state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()and provider_dispatch_started_at is null and provider_attempts<8;return found;
end $$;
revoke all on function public.begin_saas_checkout_fulfillment_dispatch(uuid,uuid,bigint)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.begin_saas_checkout_fulfillment_dispatch(uuid,uuid,bigint)to service_role;

create function public.mark_saas_checkout_fulfillment_delivery_unknown(p_id uuid,p_lease_token uuid,p_fencing_token bigint,p_safe_error text)returns boolean language plpgsql security definer set search_path=''as $$
begin
 update public.saas_checkout_fulfillment_outbox set state='delivery_unknown',last_error=pg_catalog.left(coalesce(p_safe_error,'OTP provider dispatch outcome is unknown; reconcile before any resend'),500),lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
 where id=p_id and state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()and provider_dispatch_started_at is not null;return found;
end $$;
revoke all on function public.mark_saas_checkout_fulfillment_delivery_unknown(uuid,uuid,bigint,text)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.mark_saas_checkout_fulfillment_delivery_unknown(uuid,uuid,bigint,text)to service_role;

-- There is no automatic recovery from Auth transport ambiguity. A current AAL2 admin must retain
-- external reconciliation evidence and choose either a confirmed acceptance or one bounded resend.
create function public.resolve_saas_checkout_fulfillment_delivery_unknown(p_id uuid,p_expected_fencing_token bigint,p_action text,p_actor_token_hash text,p_reason text,p_evidence jsonb)returns boolean language plpgsql security definer set search_path=''as $$
declare o public.saas_checkout_fulfillment_outbox%rowtype;actor_user_id uuid;
begin
 if p_id is null or p_expected_fencing_token<0 or p_action not in('accepted','retry')or p_actor_token_hash!~'^[a-f0-9]{64}$'or pg_catalog.length(pg_catalog.btrim(coalesce(p_reason,'')))not between 3 and 500 or pg_catalog.jsonb_typeof(p_evidence)is distinct from'object'or pg_catalog.pg_column_size(p_evidence)>4096 then raise exception'invalid checkout fulfillment resolution'using errcode='22023';end if;
 select v.user_id into actor_user_id from public.validate_admin_session_v4(p_actor_token_hash,true)v where v.role='admin';
 if actor_user_id is null then raise exception'current AAL2 admin session required'using errcode='42501';end if;
 select*into strict o from public.saas_checkout_fulfillment_outbox where id=p_id and state='delivery_unknown'and fencing_token=p_expected_fencing_token for update;
 insert into public.saas_checkout_fulfillment_resolution_audit(fulfillment_id,actor_user_id,action,expected_fencing_token,prior_state,reason,evidence)
 values(o.id,actor_user_id,p_action,p_expected_fencing_token,pg_catalog.to_jsonb(o),pg_catalog.btrim(p_reason),p_evidence);
 if p_action='accepted'then
  update public.saas_checkout_fulfillment_outbox set state='accepted',accepted_at=pg_catalog.clock_timestamp(),last_error=null,lease_token=null,lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()where id=o.id and state='delivery_unknown'and fencing_token=p_expected_fencing_token;
 else
  if o.redrive_count>=2 or o.provider_attempts>=8 then raise exception'checkout fulfillment manual retry budget exhausted'using errcode='P0001';end if;
  update public.saas_checkout_fulfillment_outbox set state='retry_wait',attempts=0,redrive_count=redrive_count+1,next_attempt_at=pg_catalog.clock_timestamp(),provider_dispatch_started_at=null,lease_token=null,lease_expires_at=null,last_error='operator authorized resend after reconciled ambiguous OTP delivery',updated_at=pg_catalog.clock_timestamp()where id=o.id and state='delivery_unknown'and fencing_token=p_expected_fencing_token;
 end if;
 if not found then raise exception'checkout fulfillment resolution lost its fence'using errcode='40001';end if;
 return true;
exception when no_data_found then raise exception'checkout fulfillment is not an unresolved delivery'using errcode='P0001';
end $$;
revoke all on function public.resolve_saas_checkout_fulfillment_delivery_unknown(uuid,bigint,text,text,text,jsonb)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.resolve_saas_checkout_fulfillment_delivery_unknown(uuid,bigint,text,text,text,jsonb)to service_role;

create function public.redrive_saas_checkout_fulfillment(p_id uuid)returns boolean language plpgsql security definer set search_path=''as $$
begin
 update public.saas_checkout_fulfillment_outbox set state='retry_wait',attempts=0,provider_attempts=0,redrive_count=redrive_count+1,next_attempt_at=pg_catalog.clock_timestamp(),failed_at=null,last_error=null,updated_at=pg_catalog.clock_timestamp()
 where id=p_id and state='failed'and redrive_count<2;return found;
end $$;
revoke all on function public.redrive_saas_checkout_fulfillment(uuid)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.redrive_saas_checkout_fulfillment(uuid)to service_role;

-- During expand/app/contract rollout old application instances fail closed rather than reaching
-- scalar finalizers. Remove these overloads only after old instances and reservations are drained.
revoke all on function public.finalize_paid_checkout(uuid,text,text,text,text,text)from public,anon,authenticated,service_role,booking_worker;
create function public.finalize_paid_checkout(p_checkout_session_id uuid,p_stripe_checkout_session_id text,p_provider_subscription_id text,p_provider_customer_id text,p_price_id text,p_plan text,p_provider_offer_evidence jsonb,p_provider_event_id uuid)
returns text language plpgsql security definer set search_path=''as $$
declare c public.checkout_sessions%rowtype;inbox public.provider_event_inbox%rowtype;v_website_id uuid;expected_evidence jsonb;completed_evidence jsonb;
begin
 if p_checkout_session_id is null or p_provider_event_id is null or nullif(p_stripe_checkout_session_id,'')is null or nullif(p_provider_subscription_id,'')is null or nullif(p_provider_customer_id,'')is null or nullif(p_price_id,'')is null or p_plan not in('starter','pro')or pg_catalog.jsonb_typeof(p_provider_offer_evidence)<>'object'then raise exception'invalid paid checkout finalization'using errcode='22023';end if;
 select x.website_id into strict v_website_id from public.checkout_sessions x where x.id=p_checkout_session_id;perform 1 from public.websites where id=v_website_id for update;select*into strict c from public.checkout_sessions where id=p_checkout_session_id for update;
 select*into strict inbox from public.provider_event_inbox where id=p_provider_event_id and provider='stripe'and event_family='saas'and event_type='checkout.session.completed'and environment=c.environment and processing_state='processing'and payload->'data'->'object'->>'id'=p_stripe_checkout_session_id and pg_catalog.length(payload_hash)=64 for update;
 expected_evidence:=pg_catalog.jsonb_build_object('contractVersion',1,'plan',c.provider_offer_snapshot->>'plan','livemode',(c.environment='live'),'providerSubscriptionId',p_provider_subscription_id,'providerCustomerId',p_provider_customer_id,'priceId',c.provider_offer_snapshot->>'priceId','productId',c.provider_offer_snapshot->>'productId','currency','usd','unitAmountMinor',(c.provider_offer_snapshot->>'unitAmountMinor')::integer,'interval','month','intervalCount',1,'quantity',1,'checkoutLineItemsComplete',true,'subscriptionItemsComplete',true,'zeroDiscounts',true,'zeroTaxes',true,'automaticTaxDisabled',true,'adaptivePricingDisabled',true);
 completed_evidence:=expected_evidence||pg_catalog.jsonb_build_object('providerEventId',inbox.event_id,'providerPayloadHash',inbox.payload_hash);
 if c.status in('pending_otp','completed')then
  if c.payment_evidence_kind='stripe_api'and c.payment_provider_session_id=p_stripe_checkout_session_id and c.provider_completion_event_id=p_provider_event_id and c.provider_completion_payload_hash=inbox.payload_hash and c.provider_completion_evidence=completed_evidence and p_provider_offer_evidence=expected_evidence
   and exists(select 1 from public.subscriptions s where s.id=c.subscription_id and s.provider_subscription_id=p_provider_subscription_id and s.provider_customer_id=p_provider_customer_id and s.stripe_price_id=p_price_id)then perform public.enqueue_saas_checkout_fulfillment(c.id);return'already_finalized';end if;
  raise exception'checkout payment identity conflict'using errcode='23505';
 end if;
 if c.status='expired'then return'stale';end if;
 if c.status<>'pending_payment'or c.subscription_id is null or c.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id or c.plan is distinct from p_plan or c.provider_offer_snapshot is null or p_provider_offer_evidence is distinct from expected_evidence or c.provider_offer_snapshot->>'priceId'is distinct from p_price_id then return'stale';end if;
 if c.provider_offer_contract_id is null or c.provider_offer_contract_digest is null or not exists(select 1 from public.saas_offer_contracts x where x.contract_id=c.provider_offer_contract_id and x.contract_digest=c.provider_offer_contract_digest and x.environment=c.environment and x.plan=p_plan and x.price_id=p_price_id and x.product_id=c.provider_offer_snapshot->>'productId')then raise exception'checkout frozen provider contract is missing or mismatched'using errcode='P0001';end if;
 -- Serialize binding with lifecycle deferral. This closes the observe-missing / bind / insert lost-wake race.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saas-subscription-binding-v1:'||c.environment||':'||p_provider_subscription_id,0));
 update public.subscriptions set plan=p_plan,stripe_customer_id=p_provider_customer_id,stripe_subscription_id=p_provider_subscription_id,stripe_price_id=p_price_id,provider_subscription_id=p_provider_subscription_id,provider_customer_id=p_provider_customer_id where id=c.subscription_id and user_id=c.profile_id and environment=c.environment and status='pending_activation';
 if not found then raise exception'checkout subscription binding mismatch'using errcode='P0001';end if;
 -- Drain every matching obligation in this transaction. Any failure rolls the provider binding back.
 perform public.reapply_deferred_unbound_subscription(c.environment,p_provider_subscription_id);
 update public.checkout_sessions set status='pending_otp',payment_evidence_kind='stripe_api',payment_verified_at=pg_catalog.clock_timestamp(),payment_provider_session_id=p_stripe_checkout_session_id,payment_price_id=p_price_id,provider_completion_evidence=completed_evidence,provider_completion_event_id=p_provider_event_id,provider_completion_payload_hash=inbox.payload_hash where id=c.id;
 perform public.enqueue_saas_checkout_fulfillment(c.id);return'finalized';
exception when no_data_found then raise exception'checkout finalization target missing'using errcode='P0001';
end $$;
revoke all on function public.finalize_paid_checkout(uuid,text,text,text,text,text,jsonb,uuid)from public,anon,authenticated,service_role,booking_worker;

-- Historical rows are intentionally not backfilled: doing so would emit unsolicited OTP requests.

-- Product tiers are additive: both Starter and Pro retain Website Leads.
alter table public.website_entitlements drop constraint if exists website_entitlements_admission_check;
alter table public.website_entitlements add constraint website_entitlements_admission_check check(
 (booking_admission=false or(plan='pro'and state in('active','grace')))
 and(quote_admission=false or(plan in('starter','pro')and state in('active','grace')))
)not valid;
update public.website_entitlements set quote_admission=true,updated_at=pg_catalog.clock_timestamp()where plan in('starter','pro')and state in('active','grace')and(ends_at is null or ends_at>pg_catalog.clock_timestamp());
alter table public.website_entitlements validate constraint website_entitlements_admission_check;

-- Admission is a separate, explicit service operation. The migration never enables a tenant,
-- and this RPC does not mutate the monotonic booking cutover state.
create function public.activate_pro_booking_admission(p_website_id uuid,p_environment text)returns boolean
language plpgsql security definer set search_path=''as $$
declare e public.website_entitlements%rowtype;w public.websites%rowtype;s public.subscriptions%rowtype;cc public.calendar_connections%rowtype;pb public.pipedream_bindings%rowtype;fresh_after timestamptz:=pg_catalog.clock_timestamp()-interval'15 minutes';fresh_before timestamptz:=pg_catalog.clock_timestamp()+interval'1 minute';
begin
 if p_website_id is null or p_environment not in('test','live')then raise exception'invalid booking admission target'using errcode='22023';end if;
 select*into strict w from public.websites where id=p_website_id and environment=p_environment for update;
 select*into strict e from public.website_entitlements where website_id=w.id and profile_id=w.user_id and environment=w.environment for update;
 if w.status<>'live'or w.active_version_id is null or e.plan<>'pro'or e.state not in('active','grace')or e.order_confirmed_at is null or e.effective_at is null or e.effective_at>pg_catalog.clock_timestamp()or(e.ends_at is not null and e.ends_at<=pg_catalog.clock_timestamp())then raise exception'current active confirmed Pro entitlement and live website required'using errcode='P0001';end if;
 select*into strict s from public.subscriptions where id=e.subscription_id and user_id=e.profile_id and environment=e.environment for update;
 if s.plan<>'pro'or s.status<>'active'or s.provider_status is distinct from'active'or s.provider_subscription_id is null or s.stripe_price_id is null or s.provider_offer_contract_id is null or s.provider_offer_contract_digest is null or(s.entitlement_ends_at is not null and s.entitlement_ends_at<=pg_catalog.clock_timestamp())or not exists(select 1 from public.saas_offer_contracts c where c.contract_id=s.provider_offer_contract_id and c.contract_digest=s.provider_offer_contract_digest and c.environment=s.environment and c.plan='pro'and c.price_id=s.stripe_price_id)then raise exception'current active Pro subscription requires a verified historical contract'using errcode='P0001';end if;
 if not exists(select 1 from public.booking_cutover_state b where b.profile_id=e.profile_id and b.environment=e.environment and b.status='enabled'and b.target_contract_version=2 and b.accepted_preflight_id is not null and b.convergence_snapshot_id is not null)then raise exception'booking cutover v2 is not enabled'using errcode='P0001';end if;
 if not exists(select 1 from public.booking_services bs join public.availability_schedules a on a.service_id=bs.id and a.profile_id=bs.profile_id and a.environment=bs.environment where bs.profile_id=e.profile_id and bs.environment=e.environment and bs.active and a.active and exists(select 1 from public.availability_intervals ai where ai.schedule_id=a.id and ai.profile_id=a.profile_id and ai.environment=a.environment))then raise exception'booking availability is not ready'using errcode='P0001';end if;
 select*into strict cc from public.calendar_connections c where c.profile_id=e.profile_id and c.environment=e.environment;
 select*into strict pb from public.pipedream_bindings b where b.profile_id=e.profile_id and b.environment=e.environment;
 if cc.health_state<>'healthy'or cc.pipedream_account_id is null or cc.last_verified_at not between fresh_after and fresh_before or pb.connection_id<>cc.id or pb.pipedream_account_id<>cc.pipedream_account_id or pb.trigger_state<>'active'or pb.last_health_at not between fresh_after and fresh_before then raise exception'current calendar provider readiness required'using errcode='P0001';end if;
 if not exists(select 1 from public.calendar_selections cs where cs.connection_id=cc.id and cs.profile_id=e.profile_id and cs.environment=e.environment and cs.active and cs.blocks_availability and cs.access_role in('freeBusyReader','reader','writer','owner')and cs.permission_verified_at between fresh_after and fresh_before)or(select count(*)from public.calendar_selections cs where cs.connection_id=cc.id and cs.profile_id=e.profile_id and cs.environment=e.environment and cs.active and cs.receives_bookings and cs.access_role in('writer','owner')and cs.permission_verified_at between fresh_after and fresh_before)<>1 then raise exception'current calendar selection readiness required'using errcode='P0001';end if;
 if not exists(select 1 from public.stripe_connected_accounts a where a.profile_id=e.profile_id and a.environment=e.environment and a.stripe_account_id is not null and a.onboarding_state='ready'and a.charges_enabled and a.payouts_enabled and a.details_submitted and a.capabilities->>'card_payments'='active'and pg_catalog.jsonb_typeof(a.requirements->'currently_due')='array'and pg_catalog.jsonb_array_length(a.requirements->'currently_due')=0 and pg_catalog.jsonb_typeof(a.requirements->'past_due')='array'and pg_catalog.jsonb_array_length(a.requirements->'past_due')=0 and pg_catalog.jsonb_typeof(a.requirements->'pending_verification')='array'and pg_catalog.jsonb_array_length(a.requirements->'pending_verification')=0 and nullif(a.requirements->>'disabled_reason','')is null and a.last_verified_at between fresh_after and fresh_before)then raise exception'current payment provider readiness required'using errcode='P0001';end if;
 update public.website_entitlements set booking_admission=true,updated_at=pg_catalog.clock_timestamp()where id=e.id and booking_admission=false;return true;
exception when no_data_found then raise exception'booking admission target or readiness row missing'using errcode='P0001';
end $$;
revoke all on function public.activate_pro_booking_admission(uuid,text)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.activate_pro_booking_admission(uuid,text)to service_role;

-- The immutable purchase snapshot remains history. Current Price/Product identity is mapped
-- through the separately installed deployment contract, so plan changes do not poison events.
drop function if exists public.project_saas_subscription_status(text,text,text,timestamptz,text);
create function public.project_saas_subscription_status(
 p_provider_subscription_id text,p_environment text,p_status text,p_provider_event_at timestamptz,p_provider_event_id text,p_price_id text,p_product_id text,p_quantity integer,p_current_period_end timestamptz,p_cancel_at_period_end boolean
)returns boolean language plpgsql security definer set search_path=''as $$
declare s public.subscriptions%rowtype;offer_contract public.saas_offer_contracts%rowtype;projected_state text;projected_plan text;projected_end timestamptz;
begin
 if nullif(p_provider_subscription_id,'')is null or p_environment not in('test','live')or p_status not in('active','past_due','cancelled')or p_provider_event_at is null or nullif(p_provider_event_id,'')is null
  or nullif(p_price_id,'')is null or nullif(p_product_id,'')is null or p_quantity<>1 or p_current_period_end is null or p_cancel_at_period_end is null then raise exception'invalid subscription projection'using errcode='22023';end if;
 select*into s from public.subscriptions where provider_subscription_id=p_provider_subscription_id and environment=p_environment for update;
 if not found then return false;end if;
 if s.provider_offer_snapshot is null then raise exception'subscription purchase snapshot is missing'using errcode='P0001';end if;
 select*into offer_contract from public.saas_offer_contracts c
 where c.environment=p_environment and c.price_id=p_price_id and c.product_id=p_product_id for key share;
 if offer_contract.contract_id is null then raise exception'subscription offer is not in verified provider contract history'using errcode='P0001';end if;
 projected_plan:=offer_contract.plan;
 -- Event IDs are identities, never chronology. Distinct equal-time events carry a fresh canonical
 -- provider snapshot and are safe to reapply; only exact replay and strictly older time are stale.
 if s.last_provider_event_id=p_provider_event_id or(s.last_provider_event_at is not null and p_provider_event_at<s.last_provider_event_at)then return true;end if;
 projected_state:=case when p_status='active'then'active'when p_status='past_due'then'grace'else'cancelled'end;
 projected_end:=case when p_status='cancelled'then least(p_current_period_end,p_provider_event_at)when p_cancel_at_period_end then p_current_period_end else null end;
 update public.subscriptions set plan=projected_plan,status=p_status,provider_status=p_status,stripe_price_id=p_price_id,current_period_end=p_current_period_end,cancel_at_period_end=p_cancel_at_period_end,
  entitlement_ends_at=projected_end,last_provider_event_at=greatest(coalesce(s.last_provider_event_at,p_provider_event_at),p_provider_event_at),last_provider_event_id=p_provider_event_id
 where id=s.id;
 update public.website_entitlements set plan=projected_plan,state=projected_state,quote_admission=(projected_state in('active','grace')),
  booking_admission=case when projected_plan='pro'and projected_state in('active','grace')then booking_admission else false end,
  ends_at=projected_end,updated_at=pg_catalog.clock_timestamp()
 where subscription_id=s.id;
 return true;
end $$;
revoke all on function public.project_saas_subscription_status(text,text,text,timestamptz,text,text,text,integer,timestamptz,boolean)from public,anon,authenticated,service_role,booking_worker;

create or replace function public.apply_saas_provider_event(p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_source_created_at timestamptz,p_projection jsonb)
returns boolean language plpgsql security definer set search_path=''as $$
declare inbox public.provider_event_inbox%rowtype;action text;applied boolean:=false;finalization_outcome text;
begin
 select*into strict inbox from public.provider_event_inbox where id=p_event_id and provider='stripe'and event_family='saas'and processing_state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()for update;
 action:=p_projection->>'action';
 if action='finalize_checkout'then
  if not exists(select 1 from public.checkout_sessions c where c.id=(p_projection->>'checkoutSessionId')::uuid and c.environment=inbox.environment and c.stripe_checkout_session_id=p_projection->>'stripeCheckoutSessionId')then raise exception'checkout event environment or identity mismatch'using errcode='P0001';end if;
  finalization_outcome:=public.finalize_paid_checkout((p_projection->>'checkoutSessionId')::uuid,p_projection->>'stripeCheckoutSessionId',p_projection->>'providerSubscriptionId',p_projection->>'providerCustomerId',p_projection->>'priceId',p_projection->>'plan',p_projection->'providerOfferEvidence',p_event_id);
  if finalization_outcome not in('finalized','already_finalized')then raise exception'checkout finalization requires reconciliation'using errcode='40001';end if;applied:=true;
 elsif action='expire_checkout'then
  if not exists(select 1 from public.checkout_sessions c where c.id=(p_projection->>'checkoutSessionId')::uuid and c.environment=inbox.environment and c.stripe_checkout_session_id=p_projection->>'stripeCheckoutSessionId')then raise exception'checkout event environment or identity mismatch'using errcode='P0001';end if;
  applied:=public.expire_checkout_intent((p_projection->>'checkoutSessionId')::uuid,p_projection->>'stripeCheckoutSessionId');
 elsif action='project_subscription'then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saas-subscription-binding-v1:'||inbox.environment||':'||(p_projection->>'providerSubscriptionId'),0));
  applied:=public.project_saas_subscription_status(p_projection->>'providerSubscriptionId',inbox.environment,p_projection->>'status',p_source_created_at,inbox.event_id,p_projection->>'priceId',p_projection->>'productId',(p_projection->>'quantity')::integer,(p_projection->>'currentPeriodEnd')::timestamptz,(p_projection->>'cancelAtPeriodEnd')::boolean);
  if not applied then
   insert into public.deferred_unbound_subscription(provider_event_inbox_id,provider_event_id,provider_event_type,environment,provider_subscription_id,source_created_at,projected_status,price_id,product_id,quantity,current_period_end,cancel_at_period_end,provider_payload_hash,projection_hash)
   values(inbox.id,inbox.event_id,inbox.event_type,inbox.environment,p_projection->>'providerSubscriptionId',p_source_created_at,p_projection->>'status',p_projection->>'priceId',p_projection->>'productId',(p_projection->>'quantity')::integer,(p_projection->>'currentPeriodEnd')::timestamptz,(p_projection->>'cancelAtPeriodEnd')::boolean,inbox.payload_hash,pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_projection::text,'UTF8'),'sha256'),'hex'))
   on conflict(provider_event_inbox_id)do update set provider_event_inbox_id=excluded.provider_event_inbox_id where public.deferred_unbound_subscription.provider_event_id=excluded.provider_event_id and public.deferred_unbound_subscription.provider_event_type=excluded.provider_event_type and public.deferred_unbound_subscription.environment=excluded.environment and public.deferred_unbound_subscription.provider_subscription_id=excluded.provider_subscription_id and public.deferred_unbound_subscription.source_created_at=excluded.source_created_at and public.deferred_unbound_subscription.projected_status=excluded.projected_status and public.deferred_unbound_subscription.price_id=excluded.price_id and public.deferred_unbound_subscription.product_id=excluded.product_id and public.deferred_unbound_subscription.quantity=excluded.quantity and public.deferred_unbound_subscription.current_period_end=excluded.current_period_end and public.deferred_unbound_subscription.cancel_at_period_end=excluded.cancel_at_period_end and public.deferred_unbound_subscription.provider_payload_hash=excluded.provider_payload_hash and public.deferred_unbound_subscription.projection_hash=excluded.projection_hash;
   if not found then raise exception'deferred subscription obligation identity conflict'using errcode='23505';end if;
   -- The signed envelope and canonical typed obligation are both durable; do not spend inbox retries.
   applied:=true;
  end if;
 elsif action='no_op'then applied:=true;
 else raise exception'unsupported SaaS projection'using errcode='22023';end if;
 update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),safe_error=null,lease_token=null,lease_expires_at=null where id=p_event_id and processing_state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp();
 if not found then raise exception'stale SaaS provider event fence'using errcode='40001';end if;return applied;
end $$;
revoke all on function public.apply_saas_provider_event(uuid,uuid,bigint,timestamptz,jsonb)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.apply_saas_provider_event(uuid,uuid,bigint,timestamptz,jsonb)to service_role;

create or replace function public.submit_starter_website_lead(p_website_id uuid,p_version_id uuid,p_form_data jsonb,p_field_snapshot jsonb,p_source_snapshot jsonb,p_submission_fingerprint text,p_payload_hash text,p_rate_limit_key text)
returns uuid language plpgsql security definer set search_path=''as $$
declare v_lead_id uuid;v_user_id uuid;v_license_number text;
begin
 if p_website_id is null or p_version_id is null or p_form_data is null or p_field_snapshot is null or p_source_snapshot is null or p_submission_fingerprint is null or p_payload_hash is null or p_rate_limit_key is null
  or pg_catalog.jsonb_typeof(p_form_data)<>'object'or pg_catalog.jsonb_typeof(p_field_snapshot)<>'array'or pg_catalog.jsonb_typeof(p_source_snapshot)<>'object'or pg_catalog.jsonb_array_length(p_field_snapshot)>20
  or pg_catalog.pg_column_size(p_form_data)>32768 or pg_catalog.pg_column_size(p_field_snapshot)>16384 or pg_catalog.pg_column_size(p_source_snapshot)>4096
  or pg_catalog.length(p_submission_fingerprint)not between 32 and 128 or pg_catalog.length(p_payload_hash)not between 32 and 128 or pg_catalog.length(p_rate_limit_key)not between 16 and 128 then raise exception'invalid lead payload'using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_website_id::text||':fingerprint:'||p_submission_fingerprint,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_website_id::text||':rate:'||p_rate_limit_key,0));
 select l.id into v_lead_id from public.leads l where l.website_id=p_website_id and l.submission_fingerprint=p_submission_fingerprint;
 if v_lead_id is not null then if not exists(select 1 from public.leads l where l.id=v_lead_id and l.payload_hash=p_payload_hash)then raise exception'submission key reused with different payload'using errcode='23505';end if;return v_lead_id;end if;
 if(select count(*)from public.lead_submission_attempts a where a.website_id=p_website_id and a.rate_limit_key=p_rate_limit_key and a.created_at>=pg_catalog.now()-interval'10 minutes')>=5 then raise exception'lead rate limit exceeded'using errcode='P0001';end if;
 delete from public.lead_submission_attempts where created_at<pg_catalog.now()-interval'1 day';insert into public.lead_submission_attempts(website_id,rate_limit_key)values(p_website_id,p_rate_limit_key);
 select w.user_id,p.license_number into v_user_id,v_license_number from public.websites w join public.profiles p on p.id=w.user_id join public.website_versions v on v.id=w.active_version_id and v.website_id=w.id and v.id=p_version_id
 join public.website_entitlements e on e.website_id=w.id and e.profile_id=w.user_id and e.environment=w.environment
 where w.id=p_website_id and w.status='live'and e.plan in('starter','pro')and e.state in('active','grace')and e.quote_admission=true and e.effective_at<=pg_catalog.clock_timestamp()and(e.ends_at is null or e.ends_at>pg_catalog.clock_timestamp())and(v.config_json->>'contactHidden')is distinct from'true'for update of w;
 if v_user_id is null then raise exception'site is not accepting leads'using errcode='P0001';end if;
 insert into public.leads(website_id,user_id,license_number,form_data,field_snapshot,source_snapshot,submission_fingerprint,payload_hash,rate_limit_key)values(p_website_id,v_user_id,v_license_number,p_form_data,p_field_snapshot,p_source_snapshot,p_submission_fingerprint,p_payload_hash,p_rate_limit_key)returning id into v_lead_id;return v_lead_id;
end $$;
revoke all on function public.submit_starter_website_lead(uuid,uuid,jsonb,jsonb,jsonb,text,text,text)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.submit_starter_website_lead(uuid,uuid,jsonb,jsonb,jsonb,text,text,text)to service_role;

create or replace function public.grant_verified_website_entitlement(p_checkout_session_id uuid,p_website_id uuid,p_auth_user_id uuid)returns public.website_entitlements
language plpgsql security definer set search_path=''as $$
declare profile_row public.profiles%rowtype;website_row public.websites%rowtype;checkout_row public.checkout_sessions%rowtype;subscription_row public.subscriptions%rowtype;existing_entitlement public.website_entitlements%rowtype;entitlement_row public.website_entitlements%rowtype;
begin
 if p_checkout_session_id is null or p_website_id is null or p_auth_user_id is null then raise exception'invalid entitlement grant'using errcode='22023';end if;
 select*into strict website_row from public.websites where id=p_website_id for update;select*into strict checkout_row from public.checkout_sessions where id=p_checkout_session_id and website_id=website_row.id and environment=website_row.environment and status in('pending_otp','completed')for update;
 select*into strict profile_row from public.profiles where id=checkout_row.profile_id and id=website_row.user_id and license_number=checkout_row.license_number and environment=website_row.environment
  and(auth_user_id=p_auth_user_id or(auth_user_id is null and checkout_claimable_at is not null and checkout_claim_email=pg_catalog.lower(pg_catalog.btrim(checkout_row.email))))for update;
 if profile_row.auth_user_id is null then
  update public.profiles set auth_user_id=p_auth_user_id,email=pg_catalog.lower(pg_catalog.btrim(checkout_row.email)),full_name=coalesce(checkout_row.full_name,profile_row.full_name),business_name=coalesce(checkout_row.business_name,profile_row.business_name),city=coalesce(checkout_row.city,profile_row.city),checkout_claimable_at=null,checkout_claim_email=null,updated_at=pg_catalog.clock_timestamp()
  where id=profile_row.id and auth_user_id is null and checkout_claimable_at=profile_row.checkout_claimable_at and checkout_claim_email=profile_row.checkout_claim_email returning*into strict profile_row;
 end if;
 -- A previously granted checkout is idempotent, including a migration-tagged historical record.
 select*into existing_entitlement from public.website_entitlements where website_id=website_row.id and environment=website_row.environment for update;
 if found then if existing_entitlement.checkout_session_id=checkout_row.id then return existing_entitlement;end if;raise exception'website already has a different purchase entitlement'using errcode='23505';end if;
 if checkout_row.subscription_id is null or checkout_row.plan not in('starter','pro')or checkout_row.payment_evidence_kind is null or checkout_row.payment_evidence_kind not in('legacy_post_payment','stripe_api','local_test_simulation')
  or(checkout_row.payment_evidence_kind in('stripe_api','local_test_simulation')and checkout_row.payment_verified_at is null)
  or(checkout_row.payment_evidence_kind='stripe_api'and(checkout_row.legacy_evidence_version is not null or checkout_row.payment_provider_session_id is null or checkout_row.provider_offer_snapshot is null or checkout_row.provider_offer_contract_id is null or checkout_row.provider_offer_contract_digest is null or checkout_row.provider_completion_evidence is null or checkout_row.provider_completion_event_id is null or checkout_row.provider_completion_payload_hash is null))
  or(checkout_row.payment_evidence_kind='legacy_post_payment'and(checkout_row.payment_verified_at is not null or checkout_row.payment_provider_session_id is not null or checkout_row.payment_price_id is not null or checkout_row.provider_offer_snapshot is not null or checkout_row.provider_offer_contract_id is not null or checkout_row.provider_offer_contract_digest is not null or checkout_row.provider_completion_evidence is not null or checkout_row.provider_completion_event_id is not null or checkout_row.provider_completion_payload_hash is not null or checkout_row.status<>'pending_otp'or checkout_row.context_json->>'websiteId'is distinct from website_row.id::text))or(checkout_row.payment_evidence_kind='local_test_simulation'and profile_row.environment<>'test')then raise exception'checkout has no admissible payment evidence'using errcode='P0001';end if;
 if checkout_row.status<>'pending_otp'then raise exception'completed checkout is missing its entitlement'using errcode='P0001';end if;
 select*into strict subscription_row from public.subscriptions where id=checkout_row.subscription_id and user_id=profile_row.id and environment=website_row.environment and plan=checkout_row.plan and status in('pending_activation','active')for update;
 update public.subscriptions set status='active',updated_at=pg_catalog.clock_timestamp()where id=subscription_row.id;
 insert into public.website_entitlements(profile_id,website_id,subscription_id,checkout_session_id,environment,plan,state,booking_admission,quote_admission,purchased_at,effective_at,order_confirmed_at,updated_at)
 values(profile_row.id,website_row.id,subscription_row.id,checkout_row.id,website_row.environment,subscription_row.plan,'active',false,true,coalesce(checkout_row.payment_verified_at,checkout_row.created_at),pg_catalog.clock_timestamp(),null,pg_catalog.clock_timestamp())returning*into entitlement_row;
 update public.checkout_sessions set status='completed',completed_at=coalesce(completed_at,pg_catalog.clock_timestamp())where id=checkout_row.id;return entitlement_row;
exception when no_data_found then raise exception'verified checkout ownership mismatch'using errcode='P0001';end $$;
revoke all on function public.grant_verified_website_entitlement(uuid,uuid,uuid)from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.grant_verified_website_entitlement(uuid,uuid,uuid)to service_role;
