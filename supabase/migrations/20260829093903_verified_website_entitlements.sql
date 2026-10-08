-- Bind verified purchases to exactly one website. Ambiguous legacy purchases require
-- provider-backed reconciliation; shared booking configuration is not consulted here.

alter table public.profiles
  add column if not exists checkout_claimable_at timestamptz,
  add column if not exists checkout_claim_email text;

alter table public.checkout_sessions
  add column if not exists profile_id uuid,
  add column if not exists website_id uuid,
  add column if not exists environment text check (environment in ('test','live')),
  add column if not exists payment_evidence_kind text
    check (payment_evidence_kind in ('stripe_api', 'local_test_simulation', 'legacy_post_payment')),
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_provider_session_id text,
  add column if not exists payment_price_id text,
  add column if not exists otp_delivery_claimed_at timestamptz,
  add column if not exists legal_accepted_at timestamptz,
  add column if not exists legal_acceptance_ip_hash text,
  add column if not exists legal_acceptance_user_agent text,
  add column if not exists legal_document_versions jsonb;

create or replace function public.reserve_otp_send(
  p_email text,
  p_purpose text,
  p_max_sends integer,
  p_window_seconds integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare normalized text;
begin
  normalized := pg_catalog.lower(pg_catalog.btrim(p_email));
  if normalized = '' or p_purpose not in ('login','checkout')
     or p_max_sends < 1 or p_window_seconds < 1 then
    raise exception 'invalid otp reservation' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized || ':' || p_purpose, 0));
  if (select count(*) from public.otp_send_log
      where email = normalized and purpose = p_purpose
        and created_at >= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds)) >= p_max_sends then
    raise exception 'otp rate limit exceeded' using errcode = 'P0001';
  end if;
  insert into public.otp_send_log(email,purpose) values(normalized,p_purpose);
end;
$$;
revoke all on function public.reserve_otp_send(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.reserve_otp_send(text,text,integer,integer) to service_role;

alter table public.website_entitlements
  add column if not exists checkout_session_id uuid references public.checkout_sessions(id);
update public.checkout_sessions c
set profile_id = w.user_id, website_id = w.id, environment = w.environment
from public.websites w
where c.website_id is null
  and c.context_json ->> 'websiteId' = w.id::text;

-- The legacy checkoutConfirmedAt marker identifies the exact origin/main site
-- that was already purchased. It is not provider payment evidence. Fail closed
-- rather than guessing when a profile/environment has multiple marked sites or
-- multiple current subscriptions.
do $$
begin
  if exists (
    select 1
    from public.websites w
    where pg_catalog.jsonb_typeof(w.onboarding_state -> 'checkoutConfirmedAt') = 'string'
      and pg_catalog.length(pg_catalog.btrim(w.onboarding_state ->> 'checkoutConfirmedAt')) > 0
      and (
        (select pg_catalog.count(*) from public.websites marked
         where marked.user_id=w.user_id and marked.environment=w.environment
           and pg_catalog.jsonb_typeof(marked.onboarding_state -> 'checkoutConfirmedAt') = 'string'
           and pg_catalog.length(pg_catalog.btrim(marked.onboarding_state ->> 'checkoutConfirmedAt')) > 0) <> 1
        or
        (select pg_catalog.count(*) from public.subscriptions s
         where s.user_id=w.user_id and s.environment=w.environment
           and s.status in ('active','past_due')) <> 1
      )
  ) then
    raise exception 'ambiguous legacy paid website entitlement requires reconciliation';
  end if;
end;
$$;

insert into public.website_entitlements(
  profile_id,website_id,subscription_id,checkout_session_id,environment,plan,state,
  booking_admission,quote_admission,purchased_at,effective_at,order_confirmed_at,updated_at
)
select
  w.user_id,w.id,s.id,null,w.environment,s.plan,
  case s.status when 'active' then 'active' else 'suspended' end,
  false,(s.status='active' and s.plan='starter'),s.created_at,s.created_at,null,
  pg_catalog.clock_timestamp()
from public.websites w
join public.subscriptions s
  on s.user_id=w.user_id and s.environment=w.environment
 and s.status in ('active','past_due')
where pg_catalog.jsonb_typeof(w.onboarding_state -> 'checkoutConfirmedAt') = 'string'
  and pg_catalog.length(pg_catalog.btrim(w.onboarding_state ->> 'checkoutConfirmedAt')) > 0
  and not exists (
    select 1 from public.website_entitlements e
    where e.website_id=w.id and e.environment=w.environment
  );

do $$
begin
  if exists (
    select 1
    from public.websites w
    join public.subscriptions s
      on s.user_id=w.user_id and s.environment=w.environment
     and s.status in ('active','past_due')
    where pg_catalog.jsonb_typeof(w.onboarding_state -> 'checkoutConfirmedAt') = 'string'
      and pg_catalog.length(pg_catalog.btrim(w.onboarding_state ->> 'checkoutConfirmedAt')) > 0
      and not exists (
        select 1 from public.website_entitlements e
        where e.website_id=w.id and e.profile_id=w.user_id and e.environment=w.environment
          and e.subscription_id=s.id
          and e.booking_admission=false and e.order_confirmed_at is null
      )
  ) then
    raise exception 'legacy paid website entitlement preservation failed';
  end if;
end;
$$;

-- A context website is an exact local association, not payment proof. Preserve
-- historical post-payment OTP rows and abort on any unresolved identity below.
update public.checkout_sessions c
set profile_id=w.user_id,website_id=w.id,environment=w.environment
from public.websites w
join public.subscriptions s
  on s.user_id=w.user_id and s.environment=w.environment
where c.subscription_id=s.id and c.context_json ->> 'websiteId'=w.id::text
  and c.status in ('pending_otp','completed')
  and (c.profile_id is null or c.website_id is null or c.environment is null);

-- Prior to this cutover, pending_otp was itself the durable post-payment
-- boundary. Preserve that historical fact as a distinct migration-only evidence
-- class, but only when checkout, subscription, profile, site, environment, plan,
-- and context website agree exactly. Do not manufacture provider verification:
-- all provider evidence fields, including payment_verified_at, remain null.
update public.checkout_sessions c
set payment_evidence_kind='legacy_post_payment'
from public.subscriptions s
join public.websites w
  on w.user_id=s.user_id and w.environment=s.environment
where c.status='pending_otp'
  and c.payment_verified_at is null and c.payment_evidence_kind is null
  and c.payment_provider_session_id is null and c.payment_price_id is null
  and c.subscription_id=s.id and c.profile_id=s.user_id
  and c.website_id=w.id and c.environment=s.environment
  and c.context_json ->> 'websiteId'=w.id::text
  and c.plan=s.plan;

do $$ begin
  if exists (
    select 1 from public.checkout_sessions c
    where c.status='pending_otp'
      and c.payment_evidence_kind is null
  ) then
    raise exception 'legacy pending OTP checkout requires exact non-destructive reconciliation';
  end if;
end $$;

-- Grandfather only rows that had already crossed the historical OTP boundary.
-- Newly pre-created unowned contractor profiles remain non-claimable.
update public.profiles p
set checkout_claimable_at=coalesce(p.checkout_claimable_at,c.created_at),
    checkout_claim_email=coalesce(p.checkout_claim_email,pg_catalog.lower(pg_catalog.btrim(c.email)))
from public.checkout_sessions c
where c.profile_id=p.id and p.auth_user_id is null
  and c.status in ('pending_otp','completed');

-- Only unpaid payment attempts may be retired automatically. Pending OTP was the
-- historical post-payment state and must never be expired by this cutover.
update public.checkout_sessions
set status = 'expired'
where status = 'pending_payment'
  and payment_verified_at is null
  and (profile_id is null or website_id is null or environment is null);

do $$ begin
  if exists (select 1 from public.checkout_sessions where status = 'pending_otp'
    and (profile_id is null or website_id is null or environment is null or subscription_id is null)) then
    raise exception 'pending OTP checkout requires non-destructive tenant reconciliation before migration';
  end if;
  if exists (select 1 from public.checkout_sessions where status = 'pending_payment'
    and payment_verified_at is not null and (profile_id is null or website_id is null or environment is null)) then
    raise exception 'paid checkout requires tenant reconciliation before migration';
  end if;
end $$;

-- Keep the newest active legacy intent for each exact website/environment before
-- installing the concurrency backstop.
with ranked as (
  select id, pg_catalog.row_number() over (
    partition by website_id, environment
    order by (status='pending_otp') desc, (payment_verified_at is not null) desc, created_at desc, id desc
  ) as position
  from public.checkout_sessions
  where status in ('pending_payment','pending_otp')
)
update public.checkout_sessions c set status='expired'
from ranked r where c.id=r.id and r.position > 1
  and c.status='pending_payment' and c.payment_verified_at is null;

do $$ begin
  if exists (select 1 from public.checkout_sessions where status in ('pending_payment','pending_otp')
    group by website_id,environment having count(*) > 1) then
    raise exception 'duplicate paid checkout intents require reconciliation before migration';
  end if;
end $$;

-- Never rewrite paid/completed subscription history by inference. Ambiguous rows
-- require provider-backed reconciliation before relational constraints are installed.
do $$ begin
  if exists (
    select 1 from public.checkout_sessions c
    where c.subscription_id is not null
      and (c.payment_verified_at is not null or c.status in ('pending_otp','completed'))
      and not exists (select 1 from public.subscriptions s where s.id=c.subscription_id
        and s.user_id=c.profile_id and s.environment=c.environment)
  ) then raise exception 'paid checkout subscription tenant mismatch requires reconciliation'; end if;
  if exists (
    select subscription_id from public.checkout_sessions
    where subscription_id is not null and (payment_verified_at is not null or status in ('pending_otp','completed'))
    group by subscription_id having count(*) > 1
  ) then raise exception 'paid checkout subscription reuse requires reconciliation'; end if;
end $$;

-- Only unpaid pending-payment attempts may have invalid or duplicate links cleared.
-- A pending-OTP row is historical paid-customer state even when evidence needs reconciliation.
update public.checkout_sessions c set subscription_id=null
where c.subscription_id is not null and c.payment_verified_at is null and c.status = 'pending_payment'
  and not exists (select 1 from public.subscriptions s where s.id=c.subscription_id
    and s.user_id=c.profile_id and s.environment=c.environment);
with ranked as (
  select id, pg_catalog.row_number() over (
    partition by subscription_id order by created_at desc, id desc
  ) as position
  from public.checkout_sessions
  where subscription_id is not null and payment_verified_at is null and status = 'pending_payment'
)
update public.checkout_sessions c set subscription_id=null
from ranked r where c.id=r.id and r.position > 1;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_payment_evidence_consistent,
  add constraint checkout_sessions_payment_evidence_consistent check (
    (payment_verified_at is null and payment_evidence_kind is null
      and payment_provider_session_id is null and payment_price_id is null)
    or (payment_verified_at is not null and payment_evidence_kind = 'stripe_api'
      and payment_provider_session_id is not null and payment_price_id is not null)
    or (payment_verified_at is not null and payment_evidence_kind = 'local_test_simulation'
      and environment = 'test' and payment_provider_session_id is null and payment_price_id is null)
    or (payment_verified_at is null and payment_evidence_kind = 'legacy_post_payment'
      and subscription_id is not null and status in ('pending_otp','completed')
      and payment_provider_session_id is null and payment_price_id is null)
  );

drop index if exists public.subscriptions_one_active_per_profile;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_active_tenant_required,
  add constraint checkout_sessions_active_tenant_required check (
    status not in ('pending_payment','pending_otp')
    or (profile_id is not null and website_id is not null and environment is not null)
  );

create unique index if not exists checkout_sessions_subscription_uk
  on public.checkout_sessions(subscription_id)
  where subscription_id is not null;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_subscription_tenant_fkey,
  add constraint checkout_sessions_subscription_tenant_fkey
    foreign key (subscription_id, profile_id, environment)
    references public.subscriptions(id, user_id, environment);

create unique index if not exists checkout_sessions_active_website_environment_uk
  on public.checkout_sessions(website_id, environment)
  where status in ('pending_payment','pending_otp');

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_website_tenant_fkey,
  add constraint checkout_sessions_website_tenant_fkey
    foreign key (website_id, profile_id, environment)
    references public.websites(id, user_id, environment);

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_entitlement_identity_uk,
  add constraint checkout_sessions_entitlement_identity_uk
    unique (id, profile_id, website_id, environment, subscription_id);

alter table public.website_entitlements
  drop constraint if exists website_entitlements_checkout_tenant_fkey,
  add constraint website_entitlements_checkout_tenant_fkey
    foreign key (checkout_session_id, profile_id, website_id, environment, subscription_id)
    references public.checkout_sessions(id, profile_id, website_id, environment, subscription_id);

create unique index if not exists website_entitlements_checkout_session_uk
  on public.website_entitlements(checkout_session_id)
  where checkout_session_id is not null;

create or replace function public.ensure_checkout_website(p_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare profile_environment text; website_id uuid;
begin
  select environment into strict profile_environment from public.profiles
   where id=p_profile_id for update;
  select id into website_id from public.websites
   where user_id=p_profile_id and environment=profile_environment
   order by created_at asc, id asc limit 1;
  if website_id is null then
    insert into public.websites(user_id,environment,status)
    values(p_profile_id,profile_environment,'draft') returning id into website_id;
  end if;
  return website_id;
exception when no_data_found then
  raise exception 'checkout profile not found' using errcode='P0001';
end;
$$;
revoke all on function public.ensure_checkout_website(uuid) from public, anon, authenticated;
grant execute on function public.ensure_checkout_website(uuid) to service_role;

create or replace function public.protect_paid_checkout_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only rows classified by the one-time pre-trigger migration may carry legacy
  -- evidence. Runtime inserts/updates cannot mint this evidence class.
  if tg_op='INSERT' and new.payment_evidence_kind='legacy_post_payment' then
    raise exception 'legacy post-payment evidence is migration-only' using errcode='P0001';
  end if;
  if tg_op='UPDATE' and new.payment_evidence_kind='legacy_post_payment'
     and old.payment_evidence_kind is distinct from 'legacy_post_payment' then
    raise exception 'legacy post-payment evidence is migration-only' using errcode='P0001';
  end if;

  if tg_op='UPDATE' and (old.payment_verified_at is not null or old.payment_evidence_kind='legacy_post_payment') and (
    new.profile_id is distinct from old.profile_id or new.website_id is distinct from old.website_id
    or new.environment is distinct from old.environment or new.license_number is distinct from old.license_number
    or pg_catalog.lower(new.email) is distinct from pg_catalog.lower(old.email)
    or new.full_name is distinct from old.full_name or new.business_name is distinct from old.business_name
    or new.city is distinct from old.city or new.plan is distinct from old.plan
    or new.subscription_id is distinct from old.subscription_id or new.context_json is distinct from old.context_json
    or new.legal_accepted_at is distinct from old.legal_accepted_at
    or new.legal_acceptance_ip_hash is distinct from old.legal_acceptance_ip_hash
    or new.legal_acceptance_user_agent is distinct from old.legal_acceptance_user_agent
    or new.legal_document_versions is distinct from old.legal_document_versions
    or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
    or new.payment_evidence_kind is distinct from old.payment_evidence_kind
    or new.payment_verified_at is distinct from old.payment_verified_at
    or new.payment_provider_session_id is distinct from old.payment_provider_session_id
    or new.payment_price_id is distinct from old.payment_price_id
    or new.status not in ('pending_otp','completed')
    or (new.status='completed' and new.completed_at is null)
  ) then raise exception 'paid checkout identity is immutable' using errcode='P0001'; end if;
  return new;
end;
$$;
revoke all on function public.protect_paid_checkout_identity() from public, anon, authenticated;
grant execute on function public.protect_paid_checkout_identity() to service_role;
drop trigger if exists checkout_paid_identity_immutable on public.checkout_sessions;
create trigger checkout_paid_identity_immutable before insert or update on public.checkout_sessions
for each row execute function public.protect_paid_checkout_identity();

create or replace function public.reserve_checkout_intent(
  p_profile_id uuid, p_website_id uuid, p_environment text, p_license_number text,
  p_email text, p_full_name text, p_business_name text, p_city text, p_plan text,
  p_status text, p_legal_accepted_at timestamptz, p_legal_acceptance_ip_hash text,
  p_legal_acceptance_user_agent text, p_legal_document_versions jsonb
) returns table(
  checkout_session_id uuid, subscription_id uuid, checkout_status text,
  checkout_email text, checkout_plan text, disposition text,
  replaced_stripe_checkout_session_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.checkout_sessions%rowtype;
  subscription_row public.subscriptions%rowtype;
  reserved public.checkout_sessions%rowtype;
  normalized_email text;
  exact_identity boolean;
  replaced_stripe_id text;
begin
  normalized_email := pg_catalog.lower(pg_catalog.btrim(p_email));
  if p_profile_id is null or p_website_id is null or p_environment not in ('test','live')
     or p_plan not in ('starter','pro') or p_status not in ('pending_payment','pending_otp')
     or pg_catalog.btrim(coalesce(p_license_number,'')) = '' or normalized_email = '' then
    raise exception 'invalid checkout reservation' using errcode = '22023';
  end if;

  perform 1 from public.websites
   where id=p_website_id and user_id=p_profile_id and environment=p_environment
   for update;
  if not found then raise exception 'website tenant mismatch' using errcode='P0001'; end if;

  select * into existing from public.checkout_sessions
   where website_id=p_website_id and environment=p_environment
     and status in ('pending_payment','pending_otp')
   for update;

  if found then
    exact_identity := existing.profile_id=p_profile_id and existing.website_id=p_website_id
      and existing.environment=p_environment and existing.license_number=p_license_number
      and pg_catalog.lower(pg_catalog.btrim(existing.email))=normalized_email
      and existing.plan=p_plan and existing.full_name is not distinct from p_full_name
      and existing.business_name is not distinct from p_business_name
      and existing.city is not distinct from p_city
      and (existing.legal_document_versions is not distinct from p_legal_document_versions
        or (existing.payment_evidence_kind='legacy_post_payment'
          and existing.legal_document_versions is null));

    if existing.status='pending_otp' then
      if existing.payment_evidence_kind is null
         or (existing.payment_evidence_kind <> 'legacy_post_payment'
           and existing.payment_verified_at is null) then
        raise exception 'checkout payment finalization is still in progress' using errcode='P0001';
      end if;
      if not exact_identity then
        raise exception 'paid checkout already awaits verification for different identity' using errcode='23505';
      end if;
      return query select existing.id, existing.subscription_id, existing.status,
        existing.email, existing.plan, 'reused_pending_otp'::text, null::text;
      return;
    end if;

    if exact_identity and p_status='pending_payment' then
      return query select existing.id, existing.subscription_id, existing.status,
        existing.email, existing.plan, 'reused_pending_payment'::text, null::text;
      return;
    end if;

    if existing.stripe_checkout_session_id is not null then
      raise exception 'provider checkout already active for different intent' using errcode='23505';
    end if;

    replaced_stripe_id := existing.stripe_checkout_session_id;
    update public.checkout_sessions set status='expired', subscription_id=null
      where id=existing.id and status='pending_payment';
    if existing.subscription_id is not null then
      delete from public.subscriptions where id=existing.subscription_id
        and status='pending_activation' and provider_subscription_id is null
        and stripe_subscription_id is null;
    end if;
  end if;

  insert into public.subscriptions(user_id,plan,status,environment)
  values(p_profile_id,p_plan,'pending_activation',p_environment)
  returning * into subscription_row;
  if p_status='pending_otp' and p_environment <> 'test' then
    raise exception 'simulated checkout is test-only' using errcode='P0001';
  end if;

  insert into public.checkout_sessions(
    profile_id,website_id,environment,license_number,email,full_name,business_name,city,
    plan,subscription_id,status,legal_accepted_at,legal_acceptance_ip_hash,
    legal_acceptance_user_agent,legal_document_versions,payment_evidence_kind,
    payment_verified_at,context_json
  ) values(
    p_profile_id,p_website_id,p_environment,p_license_number,normalized_email,
    p_full_name,p_business_name,p_city,p_plan,subscription_row.id,p_status,
    p_legal_accepted_at,p_legal_acceptance_ip_hash,p_legal_acceptance_user_agent,
    p_legal_document_versions,
    case when p_status='pending_otp' then 'local_test_simulation' else null end,
    case when p_status='pending_otp' then pg_catalog.clock_timestamp() else null end,
    pg_catalog.jsonb_build_object('source','post_checkout','websiteId',p_website_id)
  ) returning * into reserved;
  return query select reserved.id, reserved.subscription_id, reserved.status, reserved.email,
    reserved.plan, 'created'::text, replaced_stripe_id;
end;
$$;
revoke all on function public.reserve_checkout_intent(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_checkout_intent(uuid,uuid,text,text,text,text,text,text,text,text,timestamptz,text,text,jsonb)
  to service_role;

create or replace function public.expire_checkout_intent(
  p_checkout_session_id uuid, p_stripe_checkout_session_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare checkout_row public.checkout_sessions%rowtype; website_id uuid;
begin
  select c.website_id into strict website_id from public.checkout_sessions c
   where c.id=p_checkout_session_id;
  perform 1 from public.websites where id=website_id for update;
  select * into strict checkout_row from public.checkout_sessions
   where id=p_checkout_session_id for update;
  if checkout_row.status <> 'pending_payment'
     or checkout_row.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id then
    return false;
  end if;
  update public.checkout_sessions set status='expired',subscription_id=null where id=checkout_row.id;
  if checkout_row.subscription_id is not null then
    delete from public.subscriptions where id=checkout_row.subscription_id
      and status='pending_activation' and provider_subscription_id is null
      and stripe_subscription_id is null;
  end if;
  return true;
exception when no_data_found then return false;
end;
$$;
revoke all on function public.expire_checkout_intent(uuid,text) from public, anon, authenticated;
grant execute on function public.expire_checkout_intent(uuid,text) to service_role;

create or replace function public.finalize_paid_checkout(
  p_checkout_session_id uuid, p_stripe_checkout_session_id text,
  p_provider_subscription_id text, p_provider_customer_id text,
  p_price_id text, p_plan text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare checkout_row public.checkout_sessions%rowtype; website_id uuid;
begin
  if p_checkout_session_id is null or p_stripe_checkout_session_id is null
     or p_provider_subscription_id is null or p_provider_customer_id is null
     or p_price_id is null or p_plan not in ('starter','pro') then
    raise exception 'invalid paid checkout finalization' using errcode='22023';
  end if;

  select c.website_id into strict website_id from public.checkout_sessions c
   where c.id=p_checkout_session_id;
  perform 1 from public.websites where id=website_id for update;
  select * into strict checkout_row from public.checkout_sessions
   where id=p_checkout_session_id for update;

  if checkout_row.status='expired' then return 'stale'; end if;
  if checkout_row.status in ('pending_otp','completed') then
    if checkout_row.payment_evidence_kind='stripe_api'
       and checkout_row.payment_provider_session_id=p_stripe_checkout_session_id then
      return 'already_finalized';
    end if;
    raise exception 'checkout payment identity conflict' using errcode='23505';
  end if;
  if checkout_row.status <> 'pending_payment' or checkout_row.subscription_id is null
     or checkout_row.stripe_checkout_session_id is distinct from p_stripe_checkout_session_id
     or checkout_row.plan <> p_plan then
    return 'stale';
  end if;

  update public.subscriptions set
    plan=p_plan, stripe_customer_id=p_provider_customer_id,
    stripe_subscription_id=p_provider_subscription_id, stripe_price_id=p_price_id,
    provider_subscription_id=p_provider_subscription_id,
    provider_customer_id=p_provider_customer_id
  where id=checkout_row.subscription_id and user_id=checkout_row.profile_id
    and environment=checkout_row.environment and status='pending_activation';
  if not found then raise exception 'checkout subscription binding mismatch' using errcode='P0001'; end if;

  update public.checkout_sessions set status='pending_otp',
    payment_evidence_kind='stripe_api', payment_verified_at=pg_catalog.clock_timestamp(),
    payment_provider_session_id=p_stripe_checkout_session_id, payment_price_id=p_price_id
  where id=checkout_row.id;
  return 'finalized';
exception when no_data_found then
  raise exception 'checkout finalization target missing' using errcode='P0001';
end;
$$;
revoke all on function public.finalize_paid_checkout(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.finalize_paid_checkout(uuid,text,text,text,text,text)
  to service_role;

create or replace function public.grant_verified_website_entitlement(
  p_checkout_session_id uuid,
  p_website_id uuid,
  p_auth_user_id uuid
) returns public.website_entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkout_row public.checkout_sessions%rowtype;
  profile_row public.profiles%rowtype;
  website_row public.websites%rowtype;
  subscription_row public.subscriptions%rowtype;
  entitlement_row public.website_entitlements%rowtype;
  existing_entitlement public.website_entitlements%rowtype;
begin
  if p_checkout_session_id is null or p_website_id is null or p_auth_user_id is null then
    raise exception 'invalid entitlement grant request' using errcode = '22023';
  end if;

  -- Match reservation lock order: website, then checkout, then profile.
  select * into strict website_row from public.websites
   where id=p_website_id for update;

  select * into strict checkout_row from public.checkout_sessions
   where id=p_checkout_session_id and website_id=website_row.id
     and environment=website_row.environment and status in ('pending_otp','completed')
   for update;

  select * into strict profile_row from public.profiles
   where id=checkout_row.profile_id and id=website_row.user_id
     and license_number=checkout_row.license_number
     and environment=checkout_row.environment and environment=website_row.environment
     and (
       auth_user_id=p_auth_user_id
       or (auth_user_id is null and checkout_claimable_at is not null
         and checkout_claim_email=pg_catalog.lower(pg_catalog.btrim(checkout_row.email)))
     )
   for update;

  if profile_row.auth_user_id is null then
    update public.profiles
       set auth_user_id=p_auth_user_id,
           email=pg_catalog.lower(pg_catalog.btrim(checkout_row.email)),
           full_name=coalesce(checkout_row.full_name,profile_row.full_name),
           business_name=coalesce(checkout_row.business_name,profile_row.business_name),
           city=coalesce(checkout_row.city,profile_row.city),
           updated_at=pg_catalog.clock_timestamp()
     where id=profile_row.id and auth_user_id is null
       and checkout_claimable_at=profile_row.checkout_claimable_at
       and checkout_claim_email=profile_row.checkout_claim_email
     returning * into strict profile_row;
  end if;

  if checkout_row.website_id is distinct from website_row.id then
    raise exception 'checkout is not bound to website' using errcode = 'P0001';
  end if;

  if checkout_row.subscription_id is null then
    raise exception 'verified purchase is missing its subscription' using errcode = 'P0001';
  end if;

  if checkout_row.payment_evidence_kind is null
     or checkout_row.payment_evidence_kind not in ('stripe_api', 'local_test_simulation', 'legacy_post_payment')
     or (checkout_row.payment_evidence_kind in ('stripe_api', 'local_test_simulation')
       and checkout_row.payment_verified_at is null)
     or (checkout_row.payment_evidence_kind = 'stripe_api'
       and checkout_row.payment_provider_session_id is null)
     or (checkout_row.payment_evidence_kind = 'local_test_simulation' and profile_row.environment <> 'test')
     or (checkout_row.payment_evidence_kind = 'legacy_post_payment' and (
       checkout_row.payment_verified_at is not null
       or checkout_row.payment_provider_session_id is not null
       or checkout_row.payment_price_id is not null
       or checkout_row.status <> 'pending_otp'
       or checkout_row.context_json ->> 'websiteId' is distinct from website_row.id::text
     )) then
    raise exception 'checkout has no admissible payment evidence' using errcode = 'P0001';
  end if;

  select * into existing_entitlement
    from public.website_entitlements
   where website_id = website_row.id
     and environment = website_row.environment
   for update;

  if found then
    if existing_entitlement.checkout_session_id = checkout_row.id then
      return existing_entitlement;
    end if;
    raise exception 'website already has a different purchase entitlement' using errcode = '23505';
  end if;

  if checkout_row.status <> 'pending_otp' then
    raise exception 'completed checkout is missing its entitlement' using errcode = 'P0001';
  end if;

  select * into strict subscription_row
    from public.subscriptions
   where id = checkout_row.subscription_id
     and user_id = profile_row.id
     and environment = website_row.environment
     and plan = checkout_row.plan
     and status in ('pending_activation', 'active')
   for update;

  update public.subscriptions
     set status = 'active', updated_at = pg_catalog.clock_timestamp()
   where id = subscription_row.id;

  insert into public.website_entitlements(
    profile_id, website_id, subscription_id, checkout_session_id, environment, plan, state,
    booking_admission, quote_admission, purchased_at, effective_at,
    order_confirmed_at, updated_at
  ) values (
    profile_row.id, website_row.id, subscription_row.id, checkout_row.id, website_row.environment,
    subscription_row.plan, 'active', false, subscription_row.plan = 'starter',
    coalesce(checkout_row.payment_verified_at, checkout_row.created_at),
    pg_catalog.clock_timestamp(), null, pg_catalog.clock_timestamp()
  )
  returning * into entitlement_row;

  update public.checkout_sessions
     set status = 'completed', completed_at = coalesce(completed_at, pg_catalog.clock_timestamp())
   where id = checkout_row.id;

  return entitlement_row;
exception
  when no_data_found then
    raise exception 'verified checkout ownership mismatch' using errcode = 'P0001';
end;
$$;

revoke all on function public.grant_verified_website_entitlement(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.grant_verified_website_entitlement(uuid,uuid,uuid)
  to service_role;

-- Legacy site markers are consumed only by the one-time preservation above.
-- Runtime entitlement grants continue to require verified payment evidence.
