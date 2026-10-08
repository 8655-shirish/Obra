-- Code-only installation. No registration, activation, HTTP dispatch, or provider calls here.
-- Apply through the reviewed repository migration runner, in cursor.md order.

-- This installation replaces the never-applied cross-owner-policy prerequisite.
-- Native cron APIs and explicit owner filters are the authority; hidden foreign
-- jobs are outside this installation's visibility and are not declared absent.
create or replace function public.assert_calendar_worker_cron_privileges(p_require_schedule boolean default true)
returns void language plpgsql security invoker set search_path = '' as $$
declare target_oid oid;
begin
  select p.proowner into target_oid from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.apply_repo_migration(text,text,text,text,text)');
  if p_require_schedule is null
    or not exists(select 1 from pg_catalog.pg_roles r where r.oid = target_oid and r.rolcanlogin
      and r.rolname = current_user and r.rolname not in ('anon','authenticated','service_role','booking_worker','authenticator'))
    or not pg_catalog.has_schema_privilege(current_user,'cron','USAGE')
    or not coalesce(pg_catalog.has_function_privilege(current_user,
      pg_catalog.to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)'),'EXECUTE'),false)
    or not pg_catalog.has_table_privilege(current_user,'cron.job','SELECT')
    or (p_require_schedule and not coalesce(pg_catalog.has_function_privilege(current_user,
      pg_catalog.to_regprocedure('cron.schedule(text,text,text)'),'EXECUTE'),false)) then
    raise exception 'Calendar scheduler owner requires native cron privileges' using errcode = '42501',
      hint = 'Verify the migration runner owner can read its jobs and execute the documented native schedule/alter APIs; no cron table policy or ownership change is required.';
  end if;
end $$;
revoke all on function public.assert_calendar_worker_cron_privileges(boolean) from public,anon,authenticated,service_role,booking_worker;
do $calendar_cron_privileges$ begin
  perform public.assert_calendar_worker_cron_privileges();
end $calendar_cron_privileges$;

alter table public.stripe_connected_accounts
  add column reconciliation_last_attempt_at timestamptz,
  add column reconciliation_attempts integer not null default 0 check (reconciliation_attempts >= 0),
  add column reconciliation_safe_error text check (length(reconciliation_safe_error) <= 240);

-- Every successful observation clears retry metadata in the same fenced transaction,
-- including a webhook or owner refresh that completes after a failed maintenance release.
create or replace function public.apply_stripe_connect_account_projection(
  p_profile_id uuid, p_environment text, p_stripe_account_id text, p_reconciliation_generation bigint,
  p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean,
  p_capabilities jsonb, p_requirements jsonb, p_provider_created_at timestamptz, p_observed_at timestamptz
) returns public.stripe_connected_accounts
language plpgsql security definer set search_path = '' as $$
declare result public.stripe_connected_accounts; next_state text;
begin
  if p_profile_id is null or p_environment is null or p_environment not in ('test','live')
    or p_stripe_account_id is null or p_stripe_account_id !~ '^acct_[A-Za-z0-9]+$'
    or p_reconciliation_generation is null or p_observed_at is null
    or p_observed_at > pg_catalog.clock_timestamp() + interval '1 minute' then
    raise exception 'Invalid Stripe Connect observation' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_profile_id::text || ':' || p_environment || ':stripe-connect', 0)
  );
  select * into strict result from public.stripe_connected_accounts
  where profile_id = p_profile_id and environment = p_environment for update;
  if result.stripe_account_id is not null and result.stripe_account_id <> p_stripe_account_id then
    raise exception 'Stripe Connect identity conflict' using errcode = '40001';
  end if;
  if result.reconciliation_generation is distinct from p_reconciliation_generation then
    raise exception 'Stale Stripe Connect reconciliation' using errcode = '40001';
  end if;
  next_state := case
    when coalesce(p_requirements->>'disabled_reason','') <> '' then 'disabled'
    when p_charges_enabled and p_payouts_enabled and p_details_submitted
      and coalesce(p_capabilities->>'card_payments','') = 'active'
      and pg_catalog.jsonb_typeof(p_requirements->'currently_due') = 'array'
      and pg_catalog.jsonb_array_length(p_requirements->'currently_due') = 0
      and pg_catalog.jsonb_typeof(p_requirements->'past_due') = 'array'
      and pg_catalog.jsonb_array_length(p_requirements->'past_due') = 0
      and pg_catalog.jsonb_typeof(p_requirements->'pending_verification') = 'array'
      and pg_catalog.jsonb_array_length(p_requirements->'pending_verification') = 0 then 'ready'
    when p_details_submitted then 'restricted' else 'pending' end;
  update public.stripe_connected_accounts set
    stripe_account_id = p_stripe_account_id, onboarding_state = next_state,
    charges_enabled = p_charges_enabled, payouts_enabled = p_payouts_enabled, details_submitted = p_details_submitted,
    capabilities = coalesce(p_capabilities,'{}'::jsonb), requirements = coalesce(p_requirements,'{}'::jsonb),
    reconnect_reason = nullif(p_requirements->>'disabled_reason',''),
    provider_created_at = coalesce(provider_created_at,p_provider_created_at), last_verified_at = p_observed_at,
    reconciliation_due_at = p_observed_at + interval '10 minutes',
    reconciliation_attempts = 0, reconciliation_safe_error = null, updated_at = pg_catalog.clock_timestamp()
  where id = result.id returning * into result;
  return result;
end $$;

create or replace function public.apply_stripe_connect_inbox_projection(
  p_event_id uuid, p_lease_token uuid, p_fencing_token bigint, p_reconciliation_generation bigint,
  p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean,
  p_capabilities jsonb, p_requirements jsonb, p_provider_created_at timestamptz, p_observed_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
declare inbox public.provider_event_inbox%rowtype;
begin
  select * into strict inbox from public.provider_event_inbox
  where id = p_event_id and provider = 'stripe' and event_family = 'connect'
    and event_type = 'account.updated' and processing_state = 'processing'
    and lease_token = p_lease_token and fencing_token = p_fencing_token
    and lease_expires_at > pg_catalog.clock_timestamp() for update;
  -- Inbox ownership precedes the shared advisory-lock -> account-lock reducer.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(inbox.profile_id::text || ':' || inbox.environment || ':stripe-connect', 0)
  );
  perform 1 from public.stripe_connected_accounts a
  where a.profile_id = inbox.profile_id and a.environment = inbox.environment
    and a.stripe_account_id = inbox.account_context for update;
  if not found then raise exception 'Stripe Connect account not found' using errcode = '40001'; end if;
  perform public.apply_stripe_connect_account_projection(
    inbox.profile_id, inbox.environment, inbox.account_context, p_reconciliation_generation,
    p_charges_enabled, p_payouts_enabled, p_details_submitted,
    p_capabilities, p_requirements, p_provider_created_at, p_observed_at
  );
  update public.provider_event_inbox set processing_state = 'processed', processed_at = pg_catalog.clock_timestamp(),
    safe_error = null, lease_token = null, lease_expires_at = null
  where id = inbox.id and processing_state = 'processing' and lease_token = p_lease_token
    and fencing_token = p_fencing_token and lease_expires_at > pg_catalog.clock_timestamp();
  if not found then raise exception 'Stale Connect event fence' using errcode = '40001'; end if;
  return true;
end $$;
revoke all on function public.apply_stripe_connect_account_projection(uuid,text,text,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) from public,anon,authenticated,booking_worker;
revoke all on function public.apply_stripe_connect_inbox_projection(uuid,uuid,bigint,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) from public,anon,authenticated,booking_worker;
grant execute on function public.apply_stripe_connect_account_projection(uuid,text,text,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.apply_stripe_connect_inbox_projection(uuid,uuid,bigint,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) to service_role;

-- Both public stale-evidence refresh and scheduled maintenance claim this exact saved account.
-- The due time also provides a negative cooldown after an interrupted/indeterminate invocation.
create or replace function public.claim_stripe_connect_account_refresh(
  p_profile_id uuid, p_environment text, p_lease_token uuid
) returns setof public.stripe_connected_accounts
language plpgsql security definer set search_path = '' as $$
begin
  if p_profile_id is null or p_environment is null or p_environment not in ('test','live')
    or p_lease_token is null then
    raise exception 'Invalid Stripe refresh scope' using errcode = '22023';
  end if;
  return query
  with due as (
    select a.id from public.stripe_connected_accounts a
    join public.profiles p on p.id = a.profile_id and p.environment = a.environment
    where a.profile_id = p_profile_id and a.environment = p_environment
      and a.stripe_account_id is not null
      and coalesce(a.reconciliation_due_at, a.last_verified_at + interval '10 minutes', 'epoch'::timestamptz)
        <= pg_catalog.clock_timestamp()
      and (a.reconciliation_lease_expires_at is null
        or a.reconciliation_lease_expires_at <= pg_catalog.clock_timestamp())
    for update of a skip locked
  )
  update public.stripe_connected_accounts a
  set reconciliation_lease_token = p_lease_token,
      reconciliation_lease_expires_at = pg_catalog.clock_timestamp() + interval '55 seconds',
      reconciliation_fencing_token = a.reconciliation_fencing_token + 1,
      reconciliation_last_attempt_at = pg_catalog.clock_timestamp(),
      reconciliation_attempts = least(a.reconciliation_attempts, 1000000) + 1,
      reconciliation_due_at = pg_catalog.clock_timestamp() + interval '1 minute',
      updated_at = pg_catalog.clock_timestamp()
  from due where a.id = due.id returning a.*;
end $$;

-- Keep the shipped RPC identity, but do not lease a sequential batch for ten minutes.
create or replace function public.claim_due_stripe_connect_accounts(
  p_environment text, p_lease_token uuid, p_limit integer default 25
) returns setof public.stripe_connected_accounts
language plpgsql security definer set search_path = '' as $$
declare target_profile uuid;
begin
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null
    or p_limit is null or p_limit < 1 then
    raise exception 'Invalid Stripe refresh scope' using errcode = '22023';
  end if;
  select a.profile_id into target_profile from public.stripe_connected_accounts a
  join public.profiles p on p.id = a.profile_id and p.environment = a.environment
  where a.environment = p_environment and a.stripe_account_id is not null
    and coalesce(a.reconciliation_due_at, a.last_verified_at + interval '10 minutes', 'epoch'::timestamptz)
      <= pg_catalog.clock_timestamp()
    and (a.reconciliation_lease_expires_at is null
      or a.reconciliation_lease_expires_at <= pg_catalog.clock_timestamp())
  order by coalesce(a.reconciliation_due_at, a.last_verified_at + interval '10 minutes', 'epoch'::timestamptz), a.id
  for update of a skip locked limit 1;
  if target_profile is null then return; end if;
  return query select * from public.claim_stripe_connect_account_refresh(target_profile, p_environment, p_lease_token);
end $$;

-- Generation alone is insufficient after a lease expires. Preserve the existing projection
-- reducer, proving its current lease/account under the same advisory-lock -> row-lock order.
create or replace function public.apply_leased_stripe_connect_account_projection(
  p_profile_id uuid, p_environment text, p_stripe_account_id text,
  p_lease_token uuid, p_fencing_token bigint, p_reconciliation_generation bigint,
  p_charges_enabled boolean, p_payouts_enabled boolean, p_details_submitted boolean,
  p_capabilities jsonb, p_requirements jsonb, p_provider_created_at timestamptz, p_observed_at timestamptz
) returns public.stripe_connected_accounts
language plpgsql security definer set search_path = '' as $$
declare lease_expires_at timestamptz;
begin
  if p_environment is null or p_environment not in ('test','live') or p_profile_id is null
    or p_lease_token is null or p_fencing_token is null or p_observed_at is null then
    raise exception 'Invalid Stripe refresh scope' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_profile_id::text || ':' || p_environment || ':stripe-connect', 0)
  );
  select a.reconciliation_lease_expires_at into lease_expires_at from public.stripe_connected_accounts a
  where a.profile_id = p_profile_id and a.environment = p_environment
    and a.stripe_account_id = p_stripe_account_id
    and a.reconciliation_lease_token = p_lease_token
    and a.reconciliation_fencing_token = p_fencing_token
    and a.reconciliation_generation = p_reconciliation_generation
    and a.reconciliation_lease_expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found or lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'Stale Stripe refresh lease' using errcode = '40001';
  end if;
  return public.apply_stripe_connect_account_projection(
    p_profile_id, p_environment, p_stripe_account_id, p_reconciliation_generation,
    p_charges_enabled, p_payouts_enabled, p_details_submitted,
    p_capabilities, p_requirements, p_provider_created_at, p_observed_at
  );
end $$;

-- The unfenced overload must not remain an alternate release authority. Deploy with cron off.
drop function public.release_stripe_connect_reconciliation_claim(uuid,text,uuid,timestamptz);
create or replace function public.release_stripe_connect_reconciliation_claim(
  p_profile_id uuid, p_environment text, p_lease_token uuid, p_fencing_token bigint,
  p_succeeded boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_profile_id is null or p_environment is null or p_environment not in ('test','live')
    or p_lease_token is null or p_fencing_token is null or p_succeeded is null then
    raise exception 'Invalid Stripe refresh scope' using errcode = '22023';
  end if;
  update public.stripe_connected_accounts a
  set reconciliation_lease_token = null, reconciliation_lease_expires_at = null,
      reconciliation_due_at = case
        -- Claim increments attempts; only a generation-checked projection resets it.
        -- This also recognizes webhook success without comparing app and DB clocks.
        when p_succeeded or a.reconciliation_attempts = 0
          then greatest(a.reconciliation_due_at, pg_catalog.clock_timestamp() + interval '1 minute')
        else pg_catalog.clock_timestamp() + case when a.reconciliation_attempts >= 8
          then interval '10 minutes' else interval '1 minute' end end,
      reconciliation_safe_error = case
        when p_succeeded or a.reconciliation_attempts = 0 then null
        else 'Stripe account verification failed' end,
      reconciliation_attempts = case
        when p_succeeded or a.reconciliation_attempts = 0 then 0
        else a.reconciliation_attempts end,
      updated_at = pg_catalog.clock_timestamp()
  where a.profile_id = p_profile_id and a.environment = p_environment
    and a.reconciliation_lease_token = p_lease_token
    and a.reconciliation_fencing_token = p_fencing_token
    and a.reconciliation_lease_expires_at > pg_catalog.clock_timestamp();
  return found;
end $$;

revoke all on function public.claim_stripe_connect_account_refresh(uuid,text,uuid) from public,anon,authenticated,booking_worker;
revoke all on function public.claim_due_stripe_connect_accounts(text,uuid,integer) from public,anon,authenticated,booking_worker;
revoke all on function public.apply_leased_stripe_connect_account_projection(uuid,text,text,uuid,bigint,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) from public,anon,authenticated,booking_worker;
revoke all on function public.release_stripe_connect_reconciliation_claim(uuid,text,uuid,bigint,boolean) from public,anon,authenticated,booking_worker;
grant execute on function public.claim_stripe_connect_account_refresh(uuid,text,uuid) to service_role;
grant execute on function public.claim_due_stripe_connect_accounts(text,uuid,integer) to service_role;
grant execute on function public.apply_leased_stripe_connect_account_projection(uuid,text,text,uuid,bigint,bigint,boolean,boolean,boolean,jsonb,jsonb,timestamptz,timestamptz) to service_role;
grant execute on function public.release_stripe_connect_reconciliation_claim(uuid,text,uuid,bigint,boolean) to service_role;

-- Expected identities are deliberately closed, not a command/URL pattern match.
create or replace function public.register_calendar_worker_schedules(p_environment text)
returns table(schedule_name text, job_id bigint, active boolean)
language plpgsql security definer set search_path = '' as $$
declare worker text; name text; registered_id bigint;
begin
  if p_environment is null or p_environment not in ('test','live') then
    raise exception 'Explicit calendar worker environment required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('calendar-worker-schedules', 0));
  perform public.assert_calendar_worker_cron_privileges();
  foreach worker in array array['google','stripe','booking-core','booking-notifications'] loop
    name := 'obra-calendar-' || p_environment || '-' || worker;
    registered_id := cron.schedule(name, '* * * * *', pg_catalog.format(
      'select public.dispatch_calendar_worker_schedule(%L,%L);', p_environment, worker
    ));
    -- pg_cron sees committed jobs only. This transaction never leaves a new job active.
    perform cron.alter_job(registered_id, active := false);
    if not exists(select 1 from cron.job j where j.jobid=registered_id and j.username=current_user
      and j.jobname=name and j.schedule='* * * * *' and not j.active
      and j.command=pg_catalog.format('select public.dispatch_calendar_worker_schedule(%L,%L);',p_environment,worker)) then
      raise exception 'Owned calendar schedule could not be verified' using errcode='42501';
    end if;
    return query select name, registered_id, false;
  end loop;
end $$;

create or replace function public.validate_calendar_worker_cron_configuration(p_environment text)
returns void language plpgsql security definer set search_path = '' as $$
declare value text; secret_name text;
begin
  if p_environment is null or p_environment not in ('test','live') then
    raise exception 'Explicit calendar worker environment required' using errcode = '22023';
  end if;
  select v.decrypted_secret into value from vault.decrypted_secrets v
  where v.name = 'CALENDAR_WORKER_CRON_ENVIRONMENT';
  if value is distinct from p_environment then
    raise exception 'Calendar cron environment is not configured for this scope' using errcode = '22023';
  end if;
  select v.decrypted_secret into value from vault.decrypted_secrets v
  where v.name = 'CALENDAR_WORKER_CRON_ORIGIN';
  -- No tenant domains, preview wildcards, callback headers, paths, ports, or redirecting aliases.
  if value is distinct from 'https://obratech.co' then
    raise exception 'Calendar cron requires the allowed canonical HTTPS origin' using errcode = '22023';
  end if;
  if pg_catalog.current_setting('log_min_messages') in ('debug5','debug4','debug3','debug2') then
    raise exception 'Calendar cron forbids pg_net verbose credential logging' using errcode = '22023';
  end if;
  foreach secret_name in array array['PIPEDREAM_INBOX_CRON_SECRET','STRIPE_INBOX_CRON_SECRET','BOOKING_CRON_SECRET'] loop
    select v.decrypted_secret into value from vault.decrypted_secrets v where v.name = secret_name;
    if value is null or pg_catalog.btrim(value) = '' or value ~ '[[:space:][:cntrl:]]' then
      raise exception 'Calendar cron bearer configuration is missing or invalid' using errcode = '22023';
    end if;
  end loop;
  if pg_catalog.to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'pg_net HTTP transport is not installed' using errcode = '55000';
  end if;
end $$;

create or replace function public.set_calendar_worker_schedules_active(
  p_environment text, p_active boolean default false
) returns integer language plpgsql security definer set search_path = '' as $$
declare worker text; name text; registered_id bigint; changed integer := 0;
begin
  if p_environment is null or p_environment not in ('test','live') or p_active is null then
    raise exception 'Explicit calendar worker environment and activation required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('calendar-worker-schedules', 0));
  perform public.assert_calendar_worker_cron_privileges(p_active);
  if p_active then
    perform public.validate_calendar_worker_cron_configuration(p_environment);
    if exists(select 1 from cron.job j where j.username=current_user and j.active and j.jobname = any(array[
      'obra-calendar-' || case p_environment when 'test' then 'live' else 'test' end || '-google',
      'obra-calendar-' || case p_environment when 'test' then 'live' else 'test' end || '-stripe',
      'obra-calendar-' || case p_environment when 'test' then 'live' else 'test' end || '-booking-core',
      'obra-calendar-' || case p_environment when 'test' then 'live' else 'test' end || '-booking-notifications'
    ])) then
      raise exception 'Disable the other calendar worker environment explicitly first' using errcode = '22023';
    end if;
  end if;
  foreach worker in array array['google','stripe','booking-core','booking-notifications'] loop
    name := 'obra-calendar-' || p_environment || '-' || worker;
    select j.jobid into registered_id from cron.job j
    where j.jobname = name and j.username = current_user;
    if p_active and (registered_id is null or not exists (
      select 1 from cron.job j where j.jobid = registered_id and j.schedule = '* * * * *'
        and j.command = pg_catalog.format('select public.dispatch_calendar_worker_schedule(%L,%L);', p_environment, worker)
    )) then
      raise exception 'Exact inactive calendar schedules must be registered before activation' using errcode = '22023';
    end if;
    if registered_id is not null then
      perform cron.alter_job(registered_id, active := p_active);
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end $$;

create or replace function public.dispatch_calendar_worker_schedule(p_environment text, p_worker text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare name text; secret_name text; bearer text; endpoint text; body jsonb; request_id bigint;
begin
  if p_environment is null or p_environment not in ('test','live') or p_worker is null
    or p_worker not in ('google','stripe','booking-core','booking-notifications') then
    raise exception 'Invalid calendar schedule scope' using errcode = '22023';
  end if;
  name := 'obra-calendar-' || p_environment || '-' || p_worker;
  if not exists(select 1 from cron.job j where j.jobname = name and j.username = current_user and j.active
    and j.schedule = '* * * * *'
    and j.command = pg_catalog.format('select public.dispatch_calendar_worker_schedule(%L,%L);', p_environment, p_worker)) then
    return null;
  end if;
  perform public.validate_calendar_worker_cron_configuration(p_environment);
  endpoint := case p_worker when 'google' then '/api/cron/pipedream-inbox'
    when 'stripe' then '/api/cron/stripe-inbox' else '/api/cron/booking' end;
  secret_name := case p_worker when 'google' then 'PIPEDREAM_INBOX_CRON_SECRET'
    when 'stripe' then 'STRIPE_INBOX_CRON_SECRET' else 'BOOKING_CRON_SECRET' end;
  select v.decrypted_secret into strict bearer from vault.decrypted_secrets v where v.name = secret_name;
  if bearer is null or pg_catalog.btrim(bearer) = '' or bearer ~ '[[:space:][:cntrl:]]' then
    raise exception 'Calendar cron bearer configuration is missing or invalid' using errcode = '22023';
  end if;
  body := case when p_worker = 'booking-core' then '{"family":"core"}'::jsonb
    when p_worker = 'booking-notifications' then '{"family":"notifications"}'::jsonb else '{}'::jsonb end;
  begin
    -- pg_net uses CURLOPT_HTTPHEADER + FOLLOWLOCATION, not UNRESTRICTED_AUTH.
    -- libcurl >=7.83 strips Authorization across host/scheme/port redirects; same-origin
    -- handlers also verify this schedule/environment/path/body identity. No URL is caller-owned.
    select net.http_post(
      url := 'https://obratech.co' || endpoint, body := body, params := '{}'::jsonb,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type','application/json','Authorization','Bearer ' || bearer,
        'X-Obra-Worker-Environment',p_environment,'X-Obra-Cron-Schedule',name
      ), timeout_milliseconds := 55000
    ) into request_id;
  exception when others then
    raise exception 'Calendar cron dispatch failed' using errcode = 'P0001';
  end;
  insert into public.background_job_cron_requests(schedule_name,request_id) values(name,request_id);
  return request_id;
end $$;

revoke all on function public.register_calendar_worker_schedules(text) from public,anon,authenticated,booking_worker;
revoke all on function public.set_calendar_worker_schedules_active(text,boolean) from public,anon,authenticated,booking_worker;
revoke all on function public.validate_calendar_worker_cron_configuration(text) from public,anon,authenticated,service_role,booking_worker;
revoke all on function public.dispatch_calendar_worker_schedule(text,text) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.register_calendar_worker_schedules(text) to service_role;
grant execute on function public.set_calendar_worker_schedules_active(text,boolean) to service_role;

-- The existing response-recorder and its 30-day retention remain the only cron ledger owner.
-- Persist only allowlisted outcome/counters, never arbitrary HTTP bodies or rejection reasons.
alter table public.background_job_cron_requests
  add column worker_outcome text,
  add column worker_counts jsonb;

create or replace function public.capture_calendar_worker_cron_response()
returns trigger language plpgsql security definer set search_path = '' as $$
declare payload jsonb; raw_body text; field text; counts jsonb := '{}'::jsonb;
begin
  if new.schedule_name !~ '^obra-calendar-(test|live)-(google|stripe|booking-core|booking-notifications)$'
    or new.responded_at is null then return new; end if;
  select r.content into raw_body from net._http_response r
  where r.id = new.request_id and pg_catalog.octet_length(r.content) <= 16384 limit 1;
  begin
    if pg_catalog.octet_length(raw_body) <= 16384 then payload := raw_body::jsonb; end if;
  exception when others then payload := null; end;
  -- A redirected unauthenticated target's generic HTTP 200 is not this worker's result.
  if payload->>'scheduleName' is distinct from new.schedule_name
    or payload->>'environment' is distinct from pg_catalog.split_part(new.schedule_name,'-',3) then
    payload := null;
  end if;
  new.worker_outcome := case when payload->>'outcome' in
    ('succeeded','completed','partial_failure','failed','off','skipped','deadline_exceeded') then payload->>'outcome' else null end;
  foreach field in array array['processed','failed','reconciled','accepted','claimed'] loop
    if pg_catalog.jsonb_typeof(payload->field) = 'number' and (payload->>field) ~ '^[0-9]{1,9}$' then
      counts := counts || pg_catalog.jsonb_build_object(field,(payload->>field)::integer);
    else
      counts := counts || pg_catalog.jsonb_build_object(field,null);
    end if;
  end loop;
  new.worker_counts := counts;
  if new.worker_outcome in ('succeeded','completed') and (counts->>'failed')::integer > 0 then
    new.worker_outcome := 'partial_failure';
  end if;
  return new;
end $$;
revoke all on function public.capture_calendar_worker_cron_response() from public,anon,authenticated,service_role,booking_worker;
create trigger capture_calendar_worker_cron_response
before update of responded_at,status_code on public.background_job_cron_requests
for each row execute function public.capture_calendar_worker_cron_response();

create or replace view public.background_job_cron_health with (security_invoker = true) as
select schedule_name, request_id, requested_at, responded_at, status_code, timed_out, error_message,
  case
    when responded_at is null and requested_at < now() - interval '2 minutes' then 'missing_response'
    when responded_at is null then 'pending'
    when timed_out then 'timed_out'
    when status_code not between 200 and 299 or status_code is null then 'failed'
    when schedule_name ~ '^obra-calendar-(test|live)-(google|stripe|booking-core|booking-notifications)$'
      then coalesce(worker_outcome,'transport_only')
    else 'succeeded'
  end as outcome,
  worker_outcome, worker_counts,
  case when responded_at is null then 'pending' when timed_out then 'timed_out'
    when status_code between 200 and 299 then 'succeeded' else 'failed' end as transport_outcome
from public.background_job_cron_requests;
revoke all on public.background_job_cron_health from public,anon,authenticated,booking_worker;
grant select on public.background_job_cron_health to service_role;

-- Service-only, read-only projection of existing authority. Missing expected identities are
-- visible even with no due rows or ledger history. This is not an independent alert monitor.
create or replace function public.get_calendar_worker_health(p_environment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare schedules jsonb; connections jsonb; failures jsonb; recorder jsonb; obligations jsonb; binding_failures jsonb;
  observed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_environment is null or p_environment not in ('test','live') then
    raise exception 'Explicit calendar worker environment required' using errcode = '22023';
  end if;
  -- A shared recorder owned by another role may be hidden. No owned row means
  -- unobservable, not missing. Recorded responses are separate operational evidence,
  -- not proof of a visible/active registry entry or of any worker's success.
  select pg_catalog.jsonb_build_object('registered',true,'active',j.active)
  into recorder from cron.job j where j.jobname='obra-record-background-job-responses' and j.username=current_user;
  recorder:=coalesce(recorder,pg_catalog.jsonb_build_object('registered',null,'active',null))
    ||pg_catalog.jsonb_build_object('last_recorded_response_at',(
      select max(r.responded_at) from public.background_job_cron_requests r where r.responded_at<=observed_at));
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schedule_name',expected.name,'registered',j.jobid is not null,'active',coalesce(j.active,false),
    'last_dispatched_at',h.requested_at,'request_id',h.request_id,
    'last_responded_at',completed.responded_at,'last_response_request_id',completed.request_id,
    'transport_outcome',coalesce(completed.transport_outcome,h.transport_outcome),
    'worker_outcome',completed.worker_outcome,'worker_counts',completed.worker_counts,
    'last_authenticated_completed_at',authenticated.responded_at,
    'last_authenticated_requested_at',authenticated.requested_at,
    'last_authenticated_worker_outcome',authenticated.worker_outcome,
    'oldest_unanswered_at',history.oldest_unanswered_at,'overdue_unanswered_count',history.overdue_unanswered_count,
    'last_started_at',f.last_started_at,'last_completed_at',f.last_completed_at,'last_success',f.last_success,
    'command_matches',j.command = pg_catalog.format('select public.dispatch_calendar_worker_schedule(%L,%L);', p_environment,expected.worker),
    'schedule_matches',j.schedule = '* * * * *',
    'status',case when j.jobid is null then 'missing_schedule' when not j.active then 'inactive'
      when j.schedule <> '* * * * *' or j.command <> pg_catalog.format('select public.dispatch_calendar_worker_schedule(%L,%L);', p_environment,expected.worker) then 'schedule_drift'
      when h.requested_at is null or h.requested_at <= observed_at - interval '3 minutes' then 'missed_dispatch'
      when history.overdue_unanswered_count > 0 then 'missing_response'
      when coalesce(authenticated.responded_at,history.first_dispatched_at) <= observed_at - interval '3 minutes' then 'missed_authenticated_completion'
      when completed.worker_outcome = 'off' then 'off'
      when expected.family is not null and (f.last_started_at is null or f.last_started_at <= observed_at - interval '3 minutes') then 'missed_worker_start'
      when expected.family is not null and f.last_success is false then 'worker_failed'
      else coalesce(completed.outcome,h.outcome) end
  ) order by expected.name) into schedules
  from (select 'obra-calendar-' || p_environment || '-' || w.worker as name,w.family,w.worker
    from (values ('google',null::text),('stripe',null::text),('booking-core','core'),('booking-notifications','notifications')) w(worker,family)) expected
  left join cron.job j on j.jobname = expected.name and j.username = current_user
  left join lateral (select r.* from public.background_job_cron_health r
    where r.schedule_name = expected.name order by r.requested_at desc,r.request_id desc limit 1) h on true
  left join lateral (select r.* from public.background_job_cron_health r
    where r.schedule_name = expected.name and r.responded_at is not null
    order by r.requested_at desc,r.request_id desc limit 1) completed on true
  left join lateral (select r.* from public.background_job_cron_health r
    where r.schedule_name = expected.name and r.responded_at is not null
      and r.worker_outcome is not null and r.timed_out is distinct from true
    order by r.requested_at desc,r.request_id desc limit 1) authenticated on true
  left join lateral (
    select min(r.requested_at) as first_dispatched_at,
      min(r.requested_at) filter(where r.responded_at is null
        and (authenticated.requested_at is null or r.requested_at > authenticated.requested_at)) as oldest_unanswered_at,
      count(*) filter(where r.responded_at is null and r.requested_at <= observed_at - interval '3 minutes'
        and (authenticated.requested_at is null or r.requested_at > authenticated.requested_at)) as overdue_unanswered_count
    from public.background_job_cron_requests r where r.schedule_name = expected.name
  ) history on true
  left join public.booking_worker_family_leases_v3 f on f.environment = p_environment and f.family = expected.family;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(overdue) order by overdue.due_at),'[]'::jsonb) into connections
  from (
    select due.*,
      greatest(0,extract(epoch from pg_catalog.clock_timestamp()-due.due_at)::bigint) as overdue_seconds,
      case when due.lease_expires_at is not null then
        greatest(0,extract(epoch from pg_catalog.clock_timestamp()-due.lease_expires_at)::bigint) end as expired_lease_seconds,
      case when due.freshness_expired then 'critical' else 'warning' end as severity
    from (
      select 'google'::text as provider,c.id,c.profile_id,c.environment,c.last_verified_at as last_success_at,
        coalesce(b.reconciliation_due_at,c.last_verified_at + interval '10 minutes',c.created_at) as due_at,
        b.reconciliation_lease_expires_at as lease_expires_at,
        coalesce(b.reconciliation_attempts,0) as attempts,
        (b.safe_error is not null or c.verification_reason is not null) as has_error,
        coalesce(c.verification_reason,b.reconciliation_reason) as reason,
        (c.last_verified_at is null or c.last_verified_at < pg_catalog.clock_timestamp() - interval '15 minutes') as freshness_expired
      from public.calendar_connections c
      left join lateral (select b.* from public.pipedream_bindings b
        where b.connection_id = c.id and b.profile_id = c.profile_id and b.environment = c.environment
          and b.pipedream_account_id = c.pipedream_account_id and b.configuration_revision = c.connection_revision
          and b.trigger_state <> 'disconnected'
        order by b.updated_at desc,b.id limit 1) b on true
      where c.environment = p_environment and c.pipedream_account_id is not null and c.disconnected_at is null
        and c.verification_reason is distinct from 'contractor_disconnected'
        and not exists(select 1 from public.booking_provider_account_disconnects_v3 d
          where d.profile_id = c.profile_id and d.environment = c.environment and d.provider = 'pipedream'
            and d.provider_account_id = c.pipedream_account_id and d.state in ('pending','completed'))
      union all
      select 'stripe',a.id,a.profile_id,a.environment,a.last_verified_at,
        coalesce(a.reconciliation_due_at,a.last_verified_at + interval '10 minutes',a.created_at),
        a.reconciliation_lease_expires_at,a.reconciliation_attempts,a.reconciliation_safe_error is not null,
        case when a.reconciliation_safe_error is not null then 'stripe_verification_failed' else a.reconnect_reason end,
        (a.last_verified_at is null or a.last_verified_at < pg_catalog.clock_timestamp() - interval '15 minutes')
      from public.stripe_connected_accounts a where a.environment = p_environment and a.stripe_account_id is not null
    ) due where due.due_at < pg_catalog.clock_timestamp() - interval '2 minutes' or due.freshness_expired
    order by due.due_at,due.id limit 100
  ) overdue;

  -- Retained current-binding failure is independent of the next retry and account
  -- freshness. Successful trigger projection clears its reason; idle cron does not.
  select coalesce(pg_catalog.jsonb_object_agg(reason,total),'{}'::jsonb) into binding_failures
  from (
    select reason,count(*) as total from (
      select case when b.reconciliation_reason in (
        'provider_account_unhealthy','provider_account_missing','provider_temporary_failure','provider_platform_error',
        'provider_configuration_error','provider_reauthorization_required','calendar_permissions_changed','calendar_selection_invalid',
        'trigger_missing','trigger_identity_mismatch','trigger_contract_mismatch','trigger_contract_unavailable',
        'trigger_version_unverified','trigger_webhook_mismatch','trigger_deployment_ambiguous','trigger_cleanup_pending'
      ) then b.reconciliation_reason else 'unknown' end as reason
      from public.pipedream_bindings b join public.calendar_connections c
        on c.id = b.connection_id and c.profile_id = b.profile_id and c.environment = b.environment
          and c.pipedream_account_id = b.pipedream_account_id and c.connection_revision = b.configuration_revision
      where b.environment = p_environment and b.trigger_state not in ('disabled','disconnected')
        and (b.trigger_state = 'degraded' or (b.reconciliation_reason is not null
          and b.reconciliation_reason <> 'calendar_configuration_changed'))
        and c.verification_reason is distinct from 'contractor_disconnected'
        and c.reconnect_reason is distinct from 'contractor_disconnected'
        and not exists(select 1 from public.booking_provider_account_disconnects_v3 d
          where d.profile_id = c.profile_id and d.environment = c.environment and d.provider = 'pipedream'
            and d.provider_account_id = c.pipedream_account_id and d.state in ('pending','completed'))
    ) current_failures group by reason
  ) counts;

  select pg_catalog.jsonb_build_object(
    'google_inbox',(select count(*) from public.provider_event_inbox i where i.environment = p_environment and i.provider = 'pipedream' and i.event_family = 'calendar' and i.processing_state in ('failed','dead_letter')),
    'stripe_connect_inbox',(select count(*) from public.provider_event_inbox i where i.environment = p_environment and i.provider = 'stripe' and i.event_family = 'connect' and i.processing_state in ('failed','dead_letter')),
    'saas_inbox',(select count(*) from public.provider_event_inbox i where i.environment = p_environment and i.provider = 'stripe' and i.event_family = 'saas' and i.processing_state in ('failed','dead_letter')),
    'booking_inbox',(select count(*) from public.provider_event_inbox i where i.environment = p_environment and i.provider = 'stripe' and i.event_family = 'booking' and i.processing_state in ('failed','dead_letter')),
    'stripe_verification',(select count(*) from public.stripe_connected_accounts a where a.environment = p_environment and a.reconciliation_safe_error is not null),
    'calendar_manual_repair',(select count(*) from public.calendar_event_links l where l.environment = p_environment and l.reconcile_status = 'manual_repair'),
    'notifications',(select count(*) from public.booking_notifications n where n.environment = p_environment and n.state in ('retry','failed','bounced','complained'))
  ) into failures;

  -- Appointment state excludes pre-Checkout destination bindings and successful drift scans.
  -- Age comes from the obligation, not updated_at/next_attempt_at, which retries keep moving.
  select pg_catalog.jsonb_build_object(
    'calendar',(
      select pg_catalog.jsonb_build_object(
        'count',count(*),'oldestPendingAt',min(pending_at),
        'oldestPendingAgeSeconds',greatest(0,extract(epoch from observed_at-min(pending_at))::bigint),
        'blockedCount',count(*) filter(where blocked),
        'manualRepairCount',count(*) filter(where reconcile_status = 'manual_repair'),
        'unresolvedDestinationCount',count(*) filter(where review_state = 'unresolved_destination'),
        'retryCount',count(*) filter(where reconcile_status = 'retry_wait'),
        'expiredLeaseCount',count(*) filter(where reconcile_status = 'processing' and reconcile_lease_expires_at <= observed_at),
        'oldestExpiredLeaseAt',min(reconcile_lease_expires_at) filter(where reconcile_status = 'processing' and reconcile_lease_expires_at <= observed_at),
        'oldestExpiredLeaseAgeSeconds',greatest(0,extract(epoch from observed_at-
          min(reconcile_lease_expires_at) filter(where reconcile_status = 'processing' and reconcile_lease_expires_at <= observed_at))::bigint)
      ) from (
        select case when a.calendar_state in ('cancel_pending','cancel_failed')
            then coalesce(a.cancellation_requested_at,a.cancelled_at,a.created_at)
            else coalesce(a.confirmed_at,a.created_at) end as pending_at,
          a.review_state,l.reconcile_status,l.reconcile_lease_expires_at,
          (a.review_state = 'unresolved_destination' or l.reconcile_status = 'manual_repair'
            or l.failure_kind in ('reauthorization','permissions','configuration')) as blocked
        from public.appointments a
        left join public.calendar_event_links l on l.appointment_id = a.id
          and l.profile_id = a.profile_id and l.environment = a.environment
        where a.environment = p_environment and a.payment_state in ('paid','disputed')
          and (a.calendar_state in ('create_pending','create_failed','cancel_pending','cancel_failed')
            or a.review_state = 'unresolved_destination')
      ) pending
    ),
    'notifications',(
      select pg_catalog.jsonb_build_object(
        'count',count(*) filter(where n.state in ('pending','processing','retry')),
        'oldestPendingAt',min(n.created_at) filter(where n.state in ('pending','processing','retry')),
        'oldestPendingAgeSeconds',greatest(0,extract(epoch from observed_at-
          min(n.created_at) filter(where n.state in ('pending','processing','retry')))::bigint),
        'retryCount',count(*) filter(where n.state = 'retry'),
        'failedCount',count(*) filter(where n.state in ('failed','bounced','complained')),
        'deliveryDelayedCount',count(*) filter(where n.state = 'delivery_delayed'),
        'expiredLeaseCount',count(*) filter(where n.state = 'processing' and n.lease_expires_at <= observed_at),
        'oldestExpiredLeaseAt',min(n.lease_expires_at) filter(where n.state = 'processing' and n.lease_expires_at <= observed_at),
        'oldestExpiredLeaseAgeSeconds',greatest(0,extract(epoch from observed_at-
          min(n.lease_expires_at) filter(where n.state = 'processing' and n.lease_expires_at <= observed_at))::bigint),
        'reviewCount',(select count(*) from public.booking_notification_delivery_review_v3 r
          where r.environment = p_environment and r.resolved_at is null),
        'oldestReviewAt',(select min(r.queued_at) from public.booking_notification_delivery_review_v3 r
          where r.environment = p_environment and r.resolved_at is null)
      ) from public.booking_notifications n where n.environment = p_environment
    )
  ) into obligations;
  return pg_catalog.jsonb_build_object('environment',p_environment,'observed_at',observed_at,
    'scheduler_scope',pg_catalog.jsonb_build_object('owner',current_user,'visibility','owner_only'),
    'schedules',schedules,'overdue_connections',connections,'overdue_connections_limit',100,
    'row_failures',failures,'overdue_obligations',obligations,'binding_failures',binding_failures,
    'response_recorder',recorder,'independent_monitor_verified',false);
end $$;
revoke all on function public.get_calendar_worker_health(text) from public,anon,authenticated,booking_worker;
grant execute on function public.get_calendar_worker_health(text) to service_role;
