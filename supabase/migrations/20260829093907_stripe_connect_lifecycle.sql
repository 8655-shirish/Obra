-- Bucket 2 Stripe Connect lifecycle: durable Connect ingress, fenced projection, and due reconciliation.

create unique index if not exists stripe_connected_accounts_account_environment_uidx
  on public.stripe_connected_accounts(stripe_account_id, environment)
  where stripe_account_id is not null;

alter table public.stripe_connected_accounts
  add column if not exists reconciliation_due_at timestamptz,
  add column if not exists reconciliation_lease_token uuid,
  add column if not exists reconciliation_lease_expires_at timestamptz,
  add column if not exists reconciliation_fencing_token bigint not null default 0;

create index if not exists stripe_connected_accounts_reconciliation_due_idx
  on public.stripe_connected_accounts(reconciliation_due_at)
  where stripe_account_id is not null;

create or replace function public.resolve_stripe_connect_account(p_stripe_account_id text, p_environment text)
returns table(profile_id uuid, environment text)
language sql security definer set search_path='' as $$
  select a.profile_id,a.environment from public.stripe_connected_accounts a
  where a.stripe_account_id=p_stripe_account_id and a.environment=p_environment
$$;

create or replace function public.apply_stripe_connect_inbox_projection(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_reconciliation_generation bigint,
 p_charges_enabled boolean,p_payouts_enabled boolean,p_details_submitted boolean,
 p_capabilities jsonb,p_requirements jsonb,p_provider_created_at timestamptz,p_observed_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare inbox public.provider_event_inbox%rowtype; account public.stripe_connected_accounts%rowtype; next_state text;
begin
 select * into strict inbox from public.provider_event_inbox where id=p_event_id and provider='stripe' and event_family='connect'
  and processing_state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token
  and lease_expires_at>pg_catalog.clock_timestamp() for update;
 if inbox.event_type<>'account.updated' then raise exception 'unsupported Connect event'; end if;
 select * into strict account from public.stripe_connected_accounts where profile_id=inbox.profile_id and environment=inbox.environment
  and stripe_account_id=inbox.account_context for update;
 if account.reconciliation_generation<>p_reconciliation_generation then raise exception 'stale Stripe Connect reconciliation'; end if;
 next_state:=case when coalesce(p_requirements->>'disabled_reason','')<>'' then 'disabled'
  when p_charges_enabled and p_payouts_enabled and p_details_submitted and coalesce(p_capabilities->>'card_payments','')='active'
   and jsonb_typeof(p_requirements->'currently_due')='array' and jsonb_array_length(p_requirements->'currently_due')=0
   and jsonb_typeof(p_requirements->'past_due')='array' and jsonb_array_length(p_requirements->'past_due')=0
   and jsonb_typeof(p_requirements->'pending_verification')='array' and jsonb_array_length(p_requirements->'pending_verification')=0 then 'ready'
  when p_details_submitted then 'restricted' else 'pending' end;
 update public.stripe_connected_accounts set onboarding_state=next_state,charges_enabled=p_charges_enabled,
  payouts_enabled=p_payouts_enabled,details_submitted=p_details_submitted,capabilities=coalesce(p_capabilities,'{}'::jsonb),
  requirements=coalesce(p_requirements,'{}'::jsonb),reconnect_reason=nullif(p_requirements->>'disabled_reason',''),
  provider_created_at=coalesce(provider_created_at,p_provider_created_at),last_verified_at=p_observed_at,
  reconciliation_due_at=p_observed_at+interval '10 minutes',updated_at=pg_catalog.clock_timestamp() where id=account.id;
 update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),safe_error=null,
  lease_token=null,lease_expires_at=null where id=inbox.id and lease_token=p_lease_token and fencing_token=p_fencing_token;
 if not found then raise exception 'stale Connect event fence' using errcode='40001'; end if;
 return true;
end $$;

create or replace function public.claim_due_stripe_connect_accounts(
 p_environment text,p_lease_token uuid,p_limit integer default 25
) returns setof public.stripe_connected_accounts
language plpgsql security definer set search_path='' as $$
begin
 if p_environment not in ('test','live') or p_lease_token is null then
  raise exception using errcode='22023',message='Environment and lease token required'; end if;
 return query with due as (
  select a.id from public.stripe_connected_accounts a
  where a.stripe_account_id is not null and a.environment=p_environment
   and coalesce(a.reconciliation_due_at,a.last_verified_at,'epoch'::timestamptz)<=pg_catalog.clock_timestamp()
   and (a.reconciliation_lease_expires_at is null or a.reconciliation_lease_expires_at<=pg_catalog.clock_timestamp())
  order by coalesce(a.reconciliation_due_at,a.last_verified_at,'epoch'::timestamptz)
  for update skip locked limit greatest(1,least(coalesce(p_limit,25),100))
 ) update public.stripe_connected_accounts a set reconciliation_lease_token=p_lease_token,
   reconciliation_lease_expires_at=pg_catalog.clock_timestamp()+interval '10 minutes',
   reconciliation_fencing_token=a.reconciliation_fencing_token+1
  from due where a.id=due.id returning a.*;
end $$;

create or replace function public.release_stripe_connect_reconciliation_claim(
 p_profile_id uuid,p_environment text,p_lease_token uuid,p_retry_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.stripe_connected_accounts set reconciliation_lease_token=null,reconciliation_lease_expires_at=null,
  reconciliation_due_at=greatest(p_retry_at,pg_catalog.clock_timestamp()+interval '1 minute'),updated_at=pg_catalog.clock_timestamp()
 where profile_id=p_profile_id and environment=p_environment and reconciliation_lease_token=p_lease_token;
 return found;
end $$;

revoke all on function public.resolve_stripe_connect_account(text,text) from public,anon,authenticated;
revoke all on function public.apply_stripe_connect_inbox_projection(uuid,uuid,bigint,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_due_stripe_connect_accounts(text,uuid,integer) from public,anon,authenticated;
revoke all on function public.release_stripe_connect_reconciliation_claim(uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.resolve_stripe_connect_account(text,text) to service_role;
grant execute on function public.apply_stripe_connect_inbox_projection(uuid,uuid,bigint,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.claim_due_stripe_connect_accounts(text,uuid,integer) to service_role;
grant execute on function public.release_stripe_connect_reconciliation_claim(uuid,text,uuid,timestamptz) to service_role;

-- A scheduled owner advances the account generation only while its finite lease and fence are live.
create or replace function public.begin_leased_stripe_connect_reconciliation(
 p_profile_id uuid,p_environment text,p_stripe_account_id text,p_lease_token uuid,p_fencing_token bigint
) returns bigint language plpgsql security definer set search_path='' as $$
declare next_generation bigint;
begin
 if p_lease_token is null or p_fencing_token is null then raise exception 'lease and fence required' using errcode='22023';end if;
 update public.stripe_connected_accounts set reconciliation_generation=reconciliation_generation+1,updated_at=pg_catalog.clock_timestamp()
 where profile_id=p_profile_id and environment=p_environment and stripe_account_id=p_stripe_account_id
   and reconciliation_lease_token=p_lease_token and reconciliation_fencing_token=p_fencing_token
   and reconciliation_lease_expires_at>pg_catalog.clock_timestamp()
 returning reconciliation_generation into next_generation;
 if next_generation is null then raise exception 'stale Stripe Connect reconciliation lease' using errcode='40001';end if;
 return next_generation;
end $$;
revoke all on function public.begin_leased_stripe_connect_reconciliation(uuid,text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.begin_leased_stripe_connect_reconciliation(uuid,text,text,uuid,bigint) to service_role;


-- A Connect webhook advances generation only after its own inbox fence is proven live.
create or replace function public.begin_stripe_connect_inbox_reconciliation(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint
) returns bigint language plpgsql security definer set search_path='' as $$
declare inbox public.provider_event_inbox%rowtype;next_generation bigint;
begin
 if p_lease_token is null or p_fencing_token is null then raise exception 'lease and fence required' using errcode='22023';end if;
 select * into strict inbox from public.provider_event_inbox where id=p_event_id and provider='stripe' and event_family='connect'
   and event_type='account.updated' and processing_state='processing' and lease_token=p_lease_token
   and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp() for update;
 update public.stripe_connected_accounts set reconciliation_generation=reconciliation_generation+1,updated_at=pg_catalog.clock_timestamp()
 where profile_id=inbox.profile_id and environment=inbox.environment and stripe_account_id=inbox.account_context
 returning reconciliation_generation into next_generation;
 if next_generation is null then raise exception 'Stripe Connect account not found' using errcode='P0001';end if;
 return next_generation;
end $$;
revoke all on function public.begin_stripe_connect_inbox_reconciliation(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.begin_stripe_connect_inbox_reconciliation(uuid,uuid,bigint) to service_role;
