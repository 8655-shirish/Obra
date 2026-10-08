-- Saved Google authorization outlives an operational health observation.
-- This migration performs no provider, hosted database, or scheduler calls.
-- Deploy this SQL together with the lifecycle application: old unfenced RPC
-- overloads intentionally lose their grants/signatures, not a second runtime path.

-- setup_* owns the complete owner-authorized save, not just its temporary event.
-- The probe identity survives supersession until its exact effect is cleaned up.
-- Only fenced configuration persistence (or revoked cleanup) ends the operation.

alter table public.calendar_connections
  drop constraint calendar_connections_verification_reason_check,
  add constraint calendar_connections_verification_reason_check check (
    verification_reason is null or verification_reason in (
      'contractor_disconnected','provider_account_unhealthy','provider_account_missing',
      'provider_temporary_failure','provider_platform_error','provider_configuration_error',
      'provider_reauthorization_required','calendar_permissions_changed',
      'calendar_selection_invalid','calendar_write_blocked','verification_stale'
    )
  ),
  add column setup_operation_id uuid,
  add column setup_actor_auth_user_id uuid,
  add column setup_account_email text,
  add column setup_account_display_name text,
  add column setup_connect_operation_id uuid,
  add column setup_purpose text not null default 'configuration' check(setup_purpose in ('configuration','write_recovery')),
  add column setup_account_id text,
  add column setup_calendar_id text,
  add column setup_expected_revision bigint,
  add column setup_calendars jsonb,
  add column setup_read_verified_at timestamptz,
  add column setup_completed_at timestamptz,
  add column setup_write_verified_at timestamptz,
  add column setup_probe_id uuid,
  add column setup_probe_account_id text,
  add column setup_probe_calendar_id text,
  add column setup_probe_state text not null default 'pending'
    check(setup_probe_state in ('pending','insert_dispatched','present','delete_dispatched','absent')),
  add column setup_probe_started_at timestamptz,
  add column setup_probe_delete_started_at timestamptz,
  add column setup_probe_write_verified_at timestamptz,
  add column setup_lease_token uuid,
  add column setup_lease_expires_at timestamptz,
  add column setup_fencing_token bigint not null default 0,
  add column setup_retry_at timestamptz,
  add column setup_attempts integer not null default 0,
  add column setup_failure_reason text,
  add column owner_verification_requested_at timestamptz,
  add column connect_operation_id uuid,
  add column connect_actor_auth_user_id uuid,
  add column connect_expected_revision bigint,
  add column connect_expected_setup_key text,
  add column connect_started_at timestamptz,
  add column connect_expires_at timestamptz,
  add column connect_completed_at timestamptz;

-- The former failure paths wrote last_verified_at even on unsuccessful checks.
-- There is no attributable earlier success to reconstruct for those rows.
update public.calendar_connections set last_verified_at=null
  where health_state<>'healthy' or verification_reason is not null;

alter table public.pipedream_bindings
  add column reconciliation_last_attempt_at timestamptz,
  add column reconciliation_allow_repair boolean not null default false,
  add column reconciliation_reason text,
  add column observed_component_key text,
  add column observed_component_version text,
  add column deployment_candidate_trigger_id text,
  add column deployment_dispatched_at timestamptz,
  add column deployment_dispatch_lease_token uuid,
  add column deployment_dispatch_fencing_token bigint,
  add column deployment_receipt jsonb,
  add column retired_deployment jsonb,
  add column retired_trigger_ids text[] not null default '{}',
  add column pending_trigger_deletions text[] not null default '{}';

-- Desired key/version are pinned only by bootstrap; observed_* comes from provider
-- readback/projection or a classified failed check. Claim timestamps are attempts,
-- last_health_at is independent successful trigger evidence, never webhook receipt.
-- The pending subset is removed on fenced DELETE acknowledgement; retired IDs are
-- permanent tombstones and may never be adopted again, even after lease recovery.
-- deployment_receipt binds a successful response's resource/component IDs to
-- the exact pinned operation. A requested version or inventory match alone is
-- not proof. The receipt survives successful settlement, not reconfiguration.
alter table public.pipedream_bindings add constraint pipedream_retirement_authority_check check (
  pending_trigger_deletions <@ retired_trigger_ids
  and (deployed_trigger_id is null or not deployed_trigger_id=any(retired_trigger_ids))
  and (deployment_candidate_trigger_id is null or not deployment_candidate_trigger_id=any(retired_trigger_ids))
);

-- Tombstones remain on the binding after DELETE acknowledgement. A delayed DELETE
-- can therefore never remove an identity that another pass adopted in the meantime.
create unique index pipedream_binding_candidate_identity
  on public.pipedream_bindings(environment,deployment_candidate_trigger_id)
  where deployment_candidate_trigger_id is not null;

alter table public.booking_provider_account_disconnects_v3
  add column connection_id uuid,
  add column requested_connection_revision bigint,
  add column dispatch_state text not null default 'not_dispatched'
    check(dispatch_state in ('not_dispatched','dispatched','ambiguous','settled')),
  add column dispatched_at timestamptz,
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column fencing_token bigint not null default 0,
  add column attempts integer not null default 0,
  add column retry_at timestamptz default pg_catalog.clock_timestamp(),
  add column failure_reason text,
  add column unresolved_setup_operation_id uuid,
  add column unresolved_setup_calendar_id text;

-- state stays pending/completed for booking execution. Dispatch/ambiguity and
-- retry/lease facts belong to this intent, never the mutable current connection.
-- These rows (including unresolved private-probe identity) are retained as audit;
-- this slice does not supersede a disconnect or reuse its deleted account ID.

-- Older pending intents may already have sent DELETE. They are never treated as
-- undispatched or implicitly superseded by the presence of an account with an email.
update public.booking_provider_account_disconnects_v3 d set
  connection_id=c.id
from public.calendar_connections c where c.profile_id=d.profile_id and c.environment=d.environment;
update public.booking_provider_account_disconnects_v3 set
  dispatch_state=case when state='completed' then 'settled' else 'ambiguous' end,
  dispatched_at=requested_at
where provider='pipedream' and state in ('pending','completed')
  and dispatch_state='not_dispatched' and dispatched_at is null;

create or replace function public.assert_google_calendar_owner(
  p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_require_pro boolean
) returns void language plpgsql security definer set search_path='' as $$
declare checked_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_environment is null or p_environment not in ('test','live') or not exists(
    select 1 from public.profiles p where p.id=p_profile_id and p.environment=p_environment
      and p.auth_user_id=p_actor_auth_user_id
  ) then raise exception 'Google Calendar owner authority required' using errcode='42501'; end if;
  if p_require_pro and not exists(
    select 1 from public.website_entitlements e where e.profile_id=p_profile_id and e.environment=p_environment
      and e.plan='pro' and e.state in ('active','grace')
      and pg_catalog.isfinite(e.order_confirmed_at) and e.order_confirmed_at<=checked_at
      and pg_catalog.isfinite(e.effective_at) and e.effective_at<=checked_at
      and (e.ends_at is null or (pg_catalog.isfinite(e.ends_at) and e.ends_at>checked_at))
  ) then raise exception 'Active confirmed Pro authority required' using errcode='42501'; end if;
end $$;

create or replace function public.invalidate_pipedream_binding_for_calendar_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.connection_revision is not distinct from new.connection_revision
    and old.pipedream_account_id is not distinct from new.pipedream_account_id then return new; end if;
  update public.pipedream_bindings b set
    retired_deployment=case when b.deployment_operation_id is not null and b.deployment_dispatched_at is not null
      and b.deployment_candidate_trigger_id is null then jsonb_build_object(
        'operation_id',b.deployment_operation_id,'lease_token',b.deployment_dispatch_lease_token,
        'fencing_token',b.deployment_dispatch_fencing_token,'account_id',b.pipedream_account_id,
        'calendar_ids',b.selected_calendar_ids,'component_key',b.component_key,'component_version',b.component_version,
        'dispatched_at',b.deployment_dispatched_at) else b.retired_deployment end,
    retired_trigger_ids=array(select distinct x from unnest(b.retired_trigger_ids ||
      array[b.deployed_trigger_id,b.deployment_candidate_trigger_id]) x where x is not null),
    pending_trigger_deletions=array(select distinct x from unnest(b.pending_trigger_deletions ||
      array[b.deployed_trigger_id,b.deployment_candidate_trigger_id]) x where x is not null),
    deployed_trigger_id=null,deployment_candidate_trigger_id=null,deployment_receipt=null,webhook_id=null,signing_secret_name=null,
    webhook_correlation_id=pg_catalog.gen_random_uuid(),last_health_at=null,
    trigger_state=case when new.pipedream_account_id is null then 'disabled' else 'not_deployed' end,
    configuration_revision=new.connection_revision,pipedream_account_id=coalesce(new.pipedream_account_id,b.pipedream_account_id),
    selected_calendar_ids='[]'::jsonb,observed_component_key=null,observed_component_version=null,
    reconciliation_reason='calendar_configuration_changed',safe_error='Google calendar configuration changed',
    reconciliation_due_at=pg_catalog.clock_timestamp(),reconciliation_attempts=0,
    reconciliation_lease_token=null,reconciliation_lease_expires_at=null,reconciliation_allow_repair=false,
    reconciliation_fencing_token=b.reconciliation_fencing_token+1,deployment_operation_id=null,
    deployment_dispatched_at=null,deployment_lease_expires_at=null,deployment_expected_connection_revision=null,
    updated_at=pg_catalog.clock_timestamp()
  where b.connection_id=new.id and b.profile_id=new.profile_id and b.environment=new.environment;
  return new;
end $$;

-- Do not adopt a previously copied observation as a desired component contract.
-- Existing version claims require an independent provider observation on the next pass.
update public.pipedream_bindings b set
  component_version=case when b.component_key='google_calendar-new-or-updated-event-instant'
    then b.component_version else 'pending' end,
  component_key='google_calendar-new-or-updated-event-instant',
  configuration_revision=c.connection_revision,
  webhook_correlation_id=case when b.safe_error='Google calendar configuration changed'
    or b.pipedream_account_id is distinct from c.pipedream_account_id
    then pg_catalog.gen_random_uuid() else b.webhook_correlation_id end,
  last_health_at=null,reconciliation_due_at=pg_catalog.clock_timestamp(),
  deployment_dispatched_at=case when b.deployment_operation_id is not null then b.updated_at else null end,
  deployment_dispatch_lease_token=case when b.deployment_operation_id is not null then coalesce(b.reconciliation_lease_token,pg_catalog.gen_random_uuid()) end,
  deployment_dispatch_fencing_token=case when b.deployment_operation_id is not null then b.reconciliation_fencing_token end,
  reconciliation_lease_token=null,reconciliation_lease_expires_at=null,
  reconciliation_fencing_token=b.reconciliation_fencing_token+1
from public.calendar_connections c where c.id=b.connection_id;

-- All binding transitions lock connection then binding, including health and cleanup.
create or replace function public.lock_google_calendar_binding(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,
  p_require_repair boolean default false,p_allow_cleanup boolean default false
) returns public.pipedream_bindings language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;c public.calendar_connections;
begin
  select * into c from public.calendar_connections where id=(
    select connection_id from public.pipedream_bindings where id=p_binding_id
  ) for update;
  select * into b from public.pipedream_bindings where id=p_binding_id for update;
  if c.id is null or b.id is null or p_lease_token is null or p_fencing_token is null
    or b.reconciliation_lease_token is distinct from p_lease_token
    or b.reconciliation_fencing_token is distinct from p_fencing_token
    or b.reconciliation_lease_expires_at is null
    or b.reconciliation_lease_expires_at<=pg_catalog.clock_timestamp()
    or (p_require_repair and not b.reconciliation_allow_repair)
    or (not p_allow_cleanup and (
      b.configuration_revision<>c.connection_revision or b.pipedream_account_id is distinct from c.pipedream_account_id
      or c.pipedream_account_id is null or c.verification_reason='contractor_disconnected'
      or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=c.profile_id
        and d.environment=c.environment and d.provider_account_id=b.pipedream_account_id and d.state in ('pending','completed'))
    )) then raise exception 'Google Calendar maintenance lease lost' using errcode='40001'; end if;
  return b;
end $$;

create or replace function public.claim_saved_google_calendar_verification(
  p_profile_id uuid,p_environment text,p_lease_token uuid,p_lease_seconds integer default 60,p_allow_repair boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;b public.pipedream_bindings;ids jsonb;selections jsonb;
  authorized boolean;cleanup_only boolean;changed boolean;due_at timestamptz;
begin
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null
    or p_lease_seconds is null or p_lease_seconds not between 5 and 90 or p_allow_repair is null
  then raise exception 'Invalid Google Calendar verification claim' using errcode='22023'; end if;
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment
    for update skip locked;
  if not found then return null; end if;
  select coalesce(jsonb_agg(s.google_calendar_id order by s.google_calendar_id)filter(where s.blocks_availability),'[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('google_calendar_id',s.google_calendar_id,
      'blocks_availability',s.blocks_availability,'receives_bookings',s.receives_bookings)
      order by s.google_calendar_id),'[]'::jsonb)
    into ids,selections from public.calendar_selections s where s.connection_id=c.id
      and s.profile_id=p_profile_id and s.environment=p_environment and s.active;
  authorized:=c.pipedream_account_id is not null and c.verification_reason is distinct from 'contractor_disconnected'
    and jsonb_array_length(ids)>0
    and (select count(*) from public.calendar_selections s where s.connection_id=c.id and s.active and s.receives_bookings)=1
    and not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=p_profile_id
      and d.environment=p_environment and d.provider_account_id=c.pipedream_account_id and d.state in ('pending','completed'));
  select * into b from public.pipedream_bindings where profile_id=p_profile_id and environment=p_environment for update;
  if c.setup_operation_id is not null and c.setup_completed_at is null and c.setup_purpose='configuration'
    and c.setup_lease_expires_at>pg_catalog.clock_timestamp()
    and c.setup_expected_revision=c.connection_revision and (c.setup_account_id is distinct from c.pipedream_account_id
      or (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id')
        from jsonb_array_elements(c.setup_calendars)x) is distinct from
        (select jsonb_agg(jsonb_build_array(s.google_calendar_id,s.blocks_availability,s.receives_bookings) order by s.google_calendar_id)
        from public.calendar_selections s where s.connection_id=c.id and s.active))
  then return null; end if;
  if b.id is null then
    if not authorized then return null; end if;
    insert into public.pipedream_bindings(profile_id,environment,connection_id,pipedream_account_id,
      component_key,component_version,configuration_revision,selected_calendar_ids,reconciliation_due_at)
      values(p_profile_id,p_environment,c.id,c.pipedream_account_id,'google_calendar-new-or-updated-event-instant',
        'pending',c.connection_revision,ids,pg_catalog.clock_timestamp()) returning * into b;
  end if;
  if b.reconciliation_lease_expires_at>pg_catalog.clock_timestamp()
    or b.deployment_lease_expires_at>pg_catalog.clock_timestamp() then return null; end if;
  -- A null due date from the pre-lifetime exhaustion path is not abandonment.
  -- Expired work is reclaimed only by the next current lease, never by stale owners.
  changed:=b.configuration_revision<>c.connection_revision or (authorized and (
    b.pipedream_account_id is distinct from c.pipedream_account_id or
    (select jsonb_agg(x order by x) from jsonb_array_elements_text(b.selected_calendar_ids)x) is distinct from ids));
  if changed then
    update public.pipedream_bindings x set
      retired_deployment=case when x.deployment_operation_id is not null and x.deployment_dispatched_at is not null
        and x.deployment_candidate_trigger_id is null then jsonb_build_object(
          'operation_id',x.deployment_operation_id,'lease_token',x.deployment_dispatch_lease_token,
          'fencing_token',x.deployment_dispatch_fencing_token,'account_id',x.pipedream_account_id,
          'calendar_ids',x.selected_calendar_ids,'component_key',x.component_key,'component_version',x.component_version,
          'dispatched_at',x.deployment_dispatched_at) else x.retired_deployment end,
      retired_trigger_ids=array(select distinct v from unnest(x.retired_trigger_ids ||
        array[x.deployed_trigger_id,x.deployment_candidate_trigger_id])v where v is not null),
      pending_trigger_deletions=array(select distinct v from unnest(x.pending_trigger_deletions ||
        array[x.deployed_trigger_id,x.deployment_candidate_trigger_id])v where v is not null),
      deployed_trigger_id=null,deployment_candidate_trigger_id=null,deployment_receipt=null,webhook_id=null,signing_secret_name=null,
      webhook_correlation_id=pg_catalog.gen_random_uuid(),last_health_at=null,
      configuration_revision=c.connection_revision,pipedream_account_id=coalesce(c.pipedream_account_id,x.pipedream_account_id),
      selected_calendar_ids=ids,trigger_state=case when authorized then 'not_deployed' else 'disabled' end,
      deployment_operation_id=null,deployment_dispatched_at=null,deployment_expected_connection_revision=null,
      reconciliation_due_at=pg_catalog.clock_timestamp(),reconciliation_attempts=0
      where x.id=b.id returning * into b;
  end if;
  cleanup_only:=not authorized;
  if cleanup_only and (not p_allow_repair or (cardinality(b.pending_trigger_deletions)=0 and b.retired_deployment is null)) then return null; end if;
  due_at:=coalesce(b.reconciliation_due_at,case when b.trigger_state='active'
    then b.last_health_at+interval '10 minutes' else pg_catalog.clock_timestamp() end,pg_catalog.clock_timestamp());
  if due_at>pg_catalog.clock_timestamp() then return null; end if;
  update public.pipedream_bindings x set
    reconciliation_lease_token=p_lease_token,
    reconciliation_lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
    reconciliation_fencing_token=x.reconciliation_fencing_token+1,reconciliation_allow_repair=p_allow_repair,
    reconciliation_last_attempt_at=pg_catalog.clock_timestamp(),reconciliation_attempts=least(x.reconciliation_attempts,1000000)+1,
    deployment_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
    where x.id=b.id returning * into b;
  return jsonb_build_object('connection',to_jsonb(c),'binding',to_jsonb(b),'selections',selections,'cleanup_only',cleanup_only);
end $$;

drop function public.claim_due_pipedream_bindings(uuid,integer);
create function public.claim_due_pipedream_bindings(
  p_environment text,p_lease_token uuid,p_limit integer default 1,p_lease_seconds integer default 60,
  p_exclude_binding_ids uuid[] default '{}'
) returns setof jsonb language plpgsql security definer set search_path='' as $$
declare candidate record;claim jsonb;claimed integer:=0;
begin
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null
    or p_limit is null or p_limit not between 1 and 5 or p_exclude_binding_ids is null
    or cardinality(p_exclude_binding_ids)>100 then raise exception 'Invalid scoped Pipedream claim' using errcode='22023'; end if;
  for candidate in select c.profile_id from public.calendar_connections c
    left join public.pipedream_bindings b on b.connection_id=c.id and b.profile_id=c.profile_id and b.environment=c.environment
    where c.environment=p_environment
      and (b.id is null or not b.id=any(p_exclude_binding_ids))
      and (cardinality(b.pending_trigger_deletions)>0 or b.retired_deployment is not null or (
        c.pipedream_account_id is not null and c.verification_reason is distinct from 'contractor_disconnected'
        and exists(select 1 from public.calendar_selections s where s.connection_id=c.id and s.active and s.blocks_availability)
        and (select count(*) from public.calendar_selections s where s.connection_id=c.id and s.active and s.receives_bookings)=1
        and not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=c.profile_id
          and d.environment=c.environment and d.provider_account_id=c.pipedream_account_id and d.state in ('pending','completed'))
      ))
      and (b.reconciliation_due_at is null or b.reconciliation_due_at<=pg_catalog.clock_timestamp())
      and (b.reconciliation_lease_expires_at is null or b.reconciliation_lease_expires_at<=pg_catalog.clock_timestamp())
      and (b.deployment_lease_expires_at is null or b.deployment_lease_expires_at<=pg_catalog.clock_timestamp())
    order by coalesce(b.reconciliation_due_at,c.last_verified_at,c.created_at),c.id
    for update of c skip locked limit 25
  loop
    claim:=public.claim_saved_google_calendar_verification(candidate.profile_id,p_environment,p_lease_token,p_lease_seconds,true);
    if claim is not null then return next claim;claimed:=claimed+1; end if;
    exit when claimed>=p_limit;
  end loop;
end $$;

drop function public.mark_google_calendar_connection_verified(uuid,uuid,bigint,timestamptz);
create function public.mark_google_calendar_connection_verified(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_verified_at timestamptz,p_calendars jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token);
  if p_verified_at is null or p_verified_at>pg_catalog.clock_timestamp()+interval '1 minute'
    or p_verified_at<b.reconciliation_last_attempt_at-interval '1 minute'
    or jsonb_typeof(p_calendars) is distinct from 'array'
    or (select count(*)from jsonb_array_elements(p_calendars))<>(select count(distinct x->>'id')from jsonb_array_elements(p_calendars)x)
    or exists(select 1 from jsonb_array_elements(p_calendars)x where not exists(
      select 1 from public.calendar_selections s where s.connection_id=b.connection_id and s.active
        and s.google_calendar_id=x->>'id' and x->>'accessRole' in ('freeBusyReader','reader','writer','owner')
        and (not s.receives_bookings or x->>'accessRole' in ('writer','owner'))))
    or exists(select 1 from public.calendar_selections s where s.connection_id=b.connection_id and s.active
      and not exists(select 1 from jsonb_array_elements(p_calendars)x where x->>'id'=s.google_calendar_id))
  then raise exception 'Invalid full-calendar verification evidence' using errcode='22023'; end if;
  update public.calendar_selections s set access_role=x->>'accessRole',permission_verified_at=p_verified_at,
    updated_at=pg_catalog.clock_timestamp() from jsonb_array_elements(p_calendars)x
    where s.connection_id=b.connection_id and s.profile_id=b.profile_id and s.environment=b.environment
      and s.active and s.google_calendar_id=x->>'id';
  update public.calendar_connections c set
    health_state=case when c.verification_reason='calendar_write_blocked' then 'degraded' else 'healthy' end,
    verification_reason=case when c.verification_reason='calendar_write_blocked' then c.verification_reason else null end,
    reconnect_reason=null,last_verified_at=p_verified_at,disconnected_at=null,
    updated_at=pg_catalog.clock_timestamp() where c.id=b.connection_id;
  if b.reconciliation_allow_repair and exists(select 1 from public.calendar_connections c
    where c.id=b.connection_id and (to_jsonb(c)->>'calendar_delete_blocked_at' is not null
      or to_jsonb(c)->>'calendar_probe_insert_blocked_at' is not null))
    and exists(select 1 from public.profiles p where p.id=b.profile_id and p.environment=b.environment and p.auth_user_id is not null) then
    -- Worker-only continuation of a specific recorded capability question.
    -- Public verification never provisions a private probe.
    perform public.request_google_calendar_verification(b.profile_id,b.environment,
      (select p.auth_user_id from public.profiles p where p.id=b.profile_id and p.environment=b.environment));
  end if;
  return true;
end $$;

create or replace function public.mark_google_calendar_connection_unhealthy(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_disconnected boolean,p_reason text
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token);
  if p_reason is null or p_reason not in ('provider_account_unhealthy','provider_account_missing',
    'provider_temporary_failure','provider_platform_error','provider_configuration_error',
    'provider_reauthorization_required','calendar_permissions_changed','calendar_selection_invalid','verification_stale')
    or p_disconnected is null or (p_disconnected and p_reason not in ('provider_account_missing','provider_reauthorization_required'))
  then raise exception 'Invalid Google provider health reason' using errcode='22023'; end if;
  update public.calendar_connections c set
    health_state=case when p_disconnected or c.reconnect_reason in ('provider_account_missing','provider_reauthorization_required')
      then 'disconnected' else 'degraded' end,
    verification_reason=case when c.verification_reason='calendar_write_blocked' then c.verification_reason else p_reason end,
    reconnect_reason=case when p_disconnected then p_reason else c.reconnect_reason end,
    disconnected_at=case when p_disconnected then coalesce(c.disconnected_at,pg_catalog.clock_timestamp()) else c.disconnected_at end,
    last_synchronized_at=null,updated_at=pg_catalog.clock_timestamp()
    where c.id=b.connection_id;
  -- last_verified_at, selections, revision and the current claim deliberately survive.
  return true;
end $$;

drop function public.fail_pipedream_binding_reconciliation(uuid,uuid,bigint,text);
create function public.fail_pipedream_binding_reconciliation(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_safe_error text,p_observed_trigger jsonb default null,
  p_deployment_definitely_rejected boolean default false
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;reason text;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token,false,true);
  reason:=case when p_safe_error in (
    'provider_account_unhealthy','provider_account_missing','provider_temporary_failure','provider_platform_error',
    'provider_configuration_error','provider_reauthorization_required','calendar_permissions_changed','calendar_selection_invalid',
    'trigger_missing','trigger_identity_mismatch','trigger_contract_mismatch','trigger_contract_unavailable',
    'trigger_version_unverified','trigger_webhook_mismatch','trigger_deployment_ambiguous','trigger_cleanup_pending'
  ) then p_safe_error else 'provider_temporary_failure' end;
  update public.pipedream_bindings x set trigger_state=case when x.trigger_state='disabled' then 'disabled' else 'degraded' end,
    reconciliation_reason=reason,safe_error='Google Calendar maintenance will retry ('||reason||')',
    observed_component_key=case when p_observed_trigger->>'id' in (x.deployed_trigger_id,x.deployment_candidate_trigger_id)
      then p_observed_trigger->>'componentKey' else x.observed_component_key end,
    observed_component_version=case when p_observed_trigger->>'id' in (x.deployed_trigger_id,x.deployment_candidate_trigger_id)
      then p_observed_trigger->>'componentVersion' else x.observed_component_version end,
    reconciliation_due_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>
      case when x.reconciliation_attempts>=8 or reason in ('provider_platform_error','provider_configuration_error') then 3600
      else least(900,30*(2^least(x.reconciliation_attempts,5))::integer) end),
    reconciliation_lease_token=null,reconciliation_lease_expires_at=null,reconciliation_allow_repair=false,
    deployment_dispatched_at=case when p_deployment_definitely_rejected
      and x.deployment_dispatch_lease_token=p_lease_token and x.deployment_dispatch_fencing_token=p_fencing_token
      and x.deployment_candidate_trigger_id is null and x.deployment_receipt is null
      then null else x.deployment_dispatched_at end,
    deployment_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where x.id=b.id;
  return true;
end $$;

drop function public.reserve_pipedream_trigger_deployment(uuid,text,uuid,text,bigint);
create function public.reserve_pipedream_trigger_deployment(
  p_profile_id uuid,p_environment text,p_connection_id uuid,p_pipedream_account_id text,
  p_expected_connection_revision bigint,p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_component_version text
) returns public.pipedream_bindings language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token,true);
  if b.profile_id is distinct from p_profile_id or b.environment is distinct from p_environment
    or b.connection_id is distinct from p_connection_id or b.pipedream_account_id is distinct from p_pipedream_account_id
    or b.configuration_revision is distinct from p_expected_connection_revision
    or nullif(btrim(p_component_version),'') is null or p_component_version='pending'
    or (b.component_version<>'pending' and b.component_version<>p_component_version)
    or not exists(select 1 from public.calendar_connections c where c.id=b.connection_id
      and c.last_verified_at>=b.reconciliation_last_attempt_at-interval '1 minute'
      and (c.health_state='healthy' or c.verification_reason='calendar_write_blocked'))
  then raise exception 'Verified saved trigger contract required' using errcode='40001'; end if;
  update public.pipedream_bindings x set component_key='google_calendar-new-or-updated-event-instant',
    component_version=p_component_version,deployment_operation_id=coalesce(x.deployment_operation_id,pg_catalog.gen_random_uuid()),
    deployment_expected_connection_revision=p_expected_connection_revision,
    deployment_lease_expires_at=x.reconciliation_lease_expires_at,
    trigger_state=case when x.deployed_trigger_id is null then 'deploying' else x.trigger_state end,
    updated_at=pg_catalog.clock_timestamp() where x.id=b.id returning * into b;
  return b;
end $$;

create function public.begin_pipedream_trigger_deployment_effect(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_deployment_operation_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token,true);
  if p_deployment_operation_id is null or b.deployment_operation_id is distinct from p_deployment_operation_id
    or b.deployment_dispatched_at is not null or b.deployment_candidate_trigger_id is not null or b.retired_deployment is not null
  then raise exception 'Trigger deployment effect already dispatched or superseded' using errcode='40001'; end if;
  update public.pipedream_bindings set deployment_dispatched_at=pg_catalog.clock_timestamp(),
    deployment_dispatch_lease_token=p_lease_token,deployment_dispatch_fencing_token=p_fencing_token
    where id=b.id;
  return true;
end $$;

-- A result is evidence, not permission to mutate a provider. Even a superseded
-- caller may attribute its late response to its exact retained dispatch.
create function public.record_pipedream_trigger_deployment_result(
  p_binding_id uuid,p_deployment_operation_id uuid,p_lease_token uuid,p_fencing_token bigint,
  p_deployed_trigger_id text,p_definitely_rejected boolean default false
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  perform 1 from public.calendar_connections where id=(select connection_id from public.pipedream_bindings where id=p_binding_id) for update;
  select * into b from public.pipedream_bindings where id=p_binding_id for update;
  if p_deployment_operation_id is null or p_lease_token is null or p_fencing_token is null then return false; end if;
  if p_definitely_rejected is true and b.deployment_operation_id=p_deployment_operation_id
    and b.deployment_dispatched_at is not null and b.deployment_dispatch_lease_token=p_lease_token
    and b.deployment_dispatch_fencing_token=p_fencing_token
    and b.deployment_candidate_trigger_id is null and b.deployment_receipt is null then
    -- Exact dispatch evidence survives lease expiry/takeover. Keep the reserved
    -- operation and any current claimant; only remove this disproven dispatch.
    update public.pipedream_bindings set deployment_dispatched_at=null,
      reconciliation_due_at=pg_catalog.clock_timestamp(),updated_at=pg_catalog.clock_timestamp() where id=b.id;
    return false; -- Current reconciliation still owns its ordinary failure/backoff settlement.
  end if;
  if b.retired_deployment->>'operation_id' is distinct from p_deployment_operation_id::text
    or b.retired_deployment->>'lease_token' is distinct from p_lease_token::text
    or b.retired_deployment->>'fencing_token' is distinct from p_fencing_token::text
  then return false; end if;
  if p_definitely_rejected is true then
    update public.pipedream_bindings set retired_deployment=null,reconciliation_due_at=pg_catalog.clock_timestamp() where id=b.id;
    return true;
  end if;
  if nullif(btrim(p_deployed_trigger_id),'') is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(b.environment||':pipedream-resource:'||p_deployed_trigger_id,0));
  if exists(select 1 from public.pipedream_bindings x where x.environment=b.environment
    and (x.deployed_trigger_id=p_deployed_trigger_id or x.deployment_candidate_trigger_id=p_deployed_trigger_id))
  then raise exception 'Late trigger result conflicts with current ownership' using errcode='40001'; end if;
  update public.pipedream_bindings x set
    retired_trigger_ids=array(select distinct v from unnest(x.retired_trigger_ids||array[p_deployed_trigger_id])v),
    pending_trigger_deletions=array(select distinct v from unnest(x.pending_trigger_deletions||array[p_deployed_trigger_id])v),
    retired_deployment=null,reconciliation_due_at=pg_catalog.clock_timestamp() where x.id=b.id;
  return true;
end $$;

create function public.adopt_pipedream_trigger_candidate(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_deployed_trigger_id text,p_deployment_operation_id uuid,
  p_component_id text default null
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  if public.record_pipedream_trigger_deployment_result(p_binding_id,p_deployment_operation_id,p_lease_token,p_fencing_token,p_deployed_trigger_id)
  then return false; end if;
  if p_component_id is null then
    b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token,true);
  else
    -- The result function already locks connection then binding. A completed
    -- response proves its frozen dispatch, not permission for new provider work.
    select * into b from public.pipedream_bindings where id=p_binding_id;
  end if;
  if nullif(btrim(p_deployed_trigger_id),'') is null
    or p_lease_token is null or p_fencing_token is null
    or b.deployment_operation_id is distinct from p_deployment_operation_id
    or (b.deployment_operation_id is null and b.deployed_trigger_id is distinct from p_deployed_trigger_id)
    or (b.deployment_candidate_trigger_id is not null and b.deployment_candidate_trigger_id<>p_deployed_trigger_id)
  then raise exception 'Trigger adoption authority lost' using errcode='40001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(b.environment||':pipedream-resource:'||p_deployed_trigger_id,0));
  if p_deployed_trigger_id=any(b.retired_trigger_ids) or exists(
    select 1 from public.pipedream_bindings x where x.environment=b.environment and x.id<>b.id
      and (x.deployed_trigger_id=p_deployed_trigger_id or x.deployment_candidate_trigger_id=p_deployed_trigger_id
        or p_deployed_trigger_id=any(x.retired_trigger_ids))
  ) then raise exception 'Retired or foreign trigger cannot be adopted' using errcode='40001'; end if;
  if p_component_id is not null and (
    nullif(btrim(p_component_id),'') is null or length(p_component_id)>256
    or b.deployment_dispatched_at is null or b.deployment_operation_id is null
    or b.deployment_dispatch_lease_token is distinct from p_lease_token
    or b.deployment_dispatch_fencing_token is distinct from p_fencing_token
    or b.component_version='pending'
    or (b.deployment_receipt is not null and b.deployment_receipt is distinct from jsonb_build_object(
      'trigger_id',p_deployed_trigger_id,'component_id',p_component_id,'component_key',b.component_key,
      'component_version',b.component_version,'operation_id',p_deployment_operation_id))
  ) then raise exception 'Successful trigger response does not match its dispatched operation' using errcode='40001'; end if;
  update public.pipedream_bindings set deployment_candidate_trigger_id=p_deployed_trigger_id,
    deployment_receipt=case when p_component_id is null then deployment_receipt else jsonb_build_object(
      'trigger_id',p_deployed_trigger_id,'component_id',p_component_id,'component_key',b.component_key,
      'component_version',b.component_version,'operation_id',p_deployment_operation_id) end
    where id=b.id;
  return true;
end $$;

create function public.retire_pipedream_trigger(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_deployed_trigger_id text
) returns public.pipedream_bindings language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token,true);
  if nullif(btrim(p_deployed_trigger_id),'') is null or
    (b.deployed_trigger_id is distinct from p_deployed_trigger_id and b.deployment_candidate_trigger_id is distinct from p_deployed_trigger_id)
  then raise exception 'Only an owned trigger can be retired' using errcode='40001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(b.environment||':pipedream-resource:'||p_deployed_trigger_id,0));
  update public.pipedream_bindings x set
    retired_trigger_ids=array(select distinct v from unnest(x.retired_trigger_ids||array[p_deployed_trigger_id])v),
    pending_trigger_deletions=array(select distinct v from unnest(x.pending_trigger_deletions||array[p_deployed_trigger_id])v),
    deployed_trigger_id=case when x.deployed_trigger_id=p_deployed_trigger_id then null else x.deployed_trigger_id end,
    deployment_candidate_trigger_id=case when x.deployment_candidate_trigger_id=p_deployed_trigger_id then null else x.deployment_candidate_trigger_id end,
    deployment_receipt=case when x.deployment_receipt->>'trigger_id'=p_deployed_trigger_id then null else x.deployment_receipt end,
    webhook_id=null,signing_secret_name=null,
    webhook_correlation_id=pg_catalog.gen_random_uuid(),trigger_state='not_deployed',last_health_at=null,
    deployment_operation_id=case when x.deployment_candidate_trigger_id is null or x.deployment_candidate_trigger_id=p_deployed_trigger_id
      then null else x.deployment_operation_id end,
    deployment_dispatched_at=case when x.deployment_candidate_trigger_id is null or x.deployment_candidate_trigger_id=p_deployed_trigger_id
      then null else x.deployment_dispatched_at end,
    deployment_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
    where x.id=b.id returning * into b;
  return b;
end $$;

create function public.authorize_pipedream_trigger_cleanup(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_deployed_trigger_id text
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token,true,true);
  if p_deployed_trigger_id is null or not p_deployed_trigger_id=any(b.retired_trigger_ids)
    or not p_deployed_trigger_id=any(b.pending_trigger_deletions)
    or b.deployed_trigger_id=p_deployed_trigger_id or b.deployment_candidate_trigger_id=p_deployed_trigger_id
  then raise exception 'Trigger cleanup lacks retirement authority' using errcode='40001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(b.environment||':pipedream-resource:'||p_deployed_trigger_id,0));
  if exists(select 1 from public.pipedream_bindings x where x.environment=b.environment and x.id<>b.id
    and (x.deployed_trigger_id=p_deployed_trigger_id or x.deployment_candidate_trigger_id=p_deployed_trigger_id))
  then raise exception 'Trigger cleanup conflicts with another owner' using errcode='40001'; end if;
  return true;
end $$;

drop function public.complete_pipedream_stale_trigger_cleanup(uuid,text,text);
create function public.complete_pipedream_stale_trigger_cleanup(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_deployed_trigger_id text
) returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  perform public.authorize_pipedream_trigger_cleanup(p_binding_id,p_lease_token,p_fencing_token,p_deployed_trigger_id);
  update public.pipedream_bindings set pending_trigger_deletions=array_remove(pending_trigger_deletions,p_deployed_trigger_id)
    where id=p_binding_id;
  return true;
end $$;

create function public.settle_pipedream_binding_cleanup(p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token,true,true);
  update public.pipedream_bindings set reconciliation_lease_token=null,reconciliation_lease_expires_at=null,
    reconciliation_allow_repair=false,reconciliation_due_at=case when cardinality(pending_trigger_deletions)>0 or retired_deployment is not null
      then pg_catalog.clock_timestamp()+interval '1 minute' else null end,
    updated_at=pg_catalog.clock_timestamp() where id=b.id;
  return true;
end $$;

-- Remove unfenced deployment settlement. All bootstrap and maintenance now use the
-- same claimed revision, and interrupted creates retain their operation identity.
drop function public.fail_pipedream_trigger_deployment(uuid,uuid,text);
drop function public.apply_pipedream_trigger_projection(uuid,uuid,uuid,text,uuid,text,text,text,jsonb,text,text,text,boolean,timestamptz,text,uuid,bigint,uuid,bigint);
create function public.apply_pipedream_trigger_projection(
  p_binding_id uuid,p_webhook_correlation_id uuid,p_profile_id uuid,p_environment text,p_connection_id uuid,p_pipedream_account_id text,
  p_component_key text,p_component_version text,p_selected_calendar_ids jsonb,
  p_deployed_trigger_id text,p_webhook_id text,p_signing_key text,p_active boolean,
  p_provider_updated_at timestamptz,p_safe_error text,p_lease_token uuid,p_fencing_token bigint,
  p_deployment_operation_id uuid,p_expected_connection_revision bigint,p_observed_component_key text,p_observed_component_version text
) returns public.pipedream_bindings language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;secret_name text;ids jsonb;
begin
  b:=public.lock_google_calendar_binding(p_binding_id,p_lease_token,p_fencing_token);
  select jsonb_agg(s.google_calendar_id order by s.google_calendar_id) into ids from public.calendar_selections s
    where s.connection_id=b.connection_id and s.profile_id=b.profile_id and s.environment=b.environment and s.active and s.blocks_availability;
  if p_active is distinct from true or b.webhook_correlation_id is distinct from p_webhook_correlation_id
    or b.profile_id is distinct from p_profile_id or b.environment is distinct from p_environment
    or b.connection_id is distinct from p_connection_id or b.pipedream_account_id is distinct from p_pipedream_account_id
    or b.configuration_revision is distinct from p_expected_connection_revision
    or b.deployment_operation_id is distinct from p_deployment_operation_id
    or p_component_key is distinct from b.component_key or p_component_key<>'google_calendar-new-or-updated-event-instant'
    or p_component_version is distinct from b.component_version or p_component_version='pending'
    or p_observed_component_key is distinct from p_component_key or p_observed_component_version is distinct from p_component_version
    or nullif(btrim(p_deployed_trigger_id),'') is null or nullif(btrim(p_webhook_id),'') is null
    or nullif(btrim(p_signing_key),'') is null or p_deployed_trigger_id=any(b.retired_trigger_ids)
    or cardinality(b.pending_trigger_deletions)>0
    or (b.deployed_trigger_id is distinct from p_deployed_trigger_id and b.deployment_candidate_trigger_id is distinct from p_deployed_trigger_id)
    or p_provider_updated_at is null or p_provider_updated_at>pg_catalog.clock_timestamp()+interval '1 minute'
    or jsonb_typeof(p_selected_calendar_ids) is distinct from 'array'
    or (select jsonb_agg(x order by x) from jsonb_array_elements_text(p_selected_calendar_ids)x) is distinct from ids
  then raise exception 'Pipedream observed contract or maintenance fence does not match' using errcode='40001'; end if;
  secret_name:='PIPEDREAM_TRIGGER_'||upper(p_environment)||'_'||replace(p_profile_id::text,'-','');
  if exists(select 1 from vault.decrypted_secrets where name=secret_name) then
    perform vault.update_secret((select id from vault.decrypted_secrets where name=secret_name limit 1),p_signing_key,secret_name,'Pipedream trigger webhook signing key');
  else
    perform vault.create_secret(p_signing_key,secret_name,'Pipedream trigger webhook signing key');
  end if;
  -- A claim observes both account permissions and monitoring before it releases.
  -- Read success has already settled selection evidence; no write-blocker is reset.
  update public.pipedream_bindings x set deployed_trigger_id=p_deployed_trigger_id,webhook_id=p_webhook_id,
    signing_secret_name=secret_name,observed_component_key=p_observed_component_key,
    observed_component_version=p_observed_component_version,provider_updated_at=p_provider_updated_at,
    trigger_state='active',last_health_at=pg_catalog.clock_timestamp(),safe_error=null,reconciliation_reason=null,
    reconciliation_due_at=pg_catalog.clock_timestamp()+interval '10 minutes',reconciliation_attempts=0,
    reconciliation_lease_token=null,reconciliation_lease_expires_at=null,reconciliation_allow_repair=false,
    deployment_operation_id=null,deployment_candidate_trigger_id=null,deployment_dispatched_at=null,
    deployment_lease_expires_at=null,deployment_expected_connection_revision=null,
    updated_at=pg_catalog.clock_timestamp() where x.id=b.id returning * into b;
  return b;
end $$;

-- Match the owner's existing SHA-256(JSON.stringify([operation,account,revision,
-- sorted blocking IDs,destination])) view key. Operational lease/probe changes
-- do not change this key, but replacing pending choices does.
create function public.google_calendar_setup_configuration_key(p_connection public.calendar_connections)
returns text language plpgsql stable security definer set search_path='' as $$
declare blocking text;
begin
  if p_connection.setup_operation_id is null or p_connection.setup_completed_at is not null
    or p_connection.setup_purpose<>'configuration' or p_connection.setup_expected_revision is distinct from p_connection.connection_revision
    or not exists(select 1 from public.profiles p where p.id=p_connection.profile_id and p.environment=p_connection.environment
      and p.auth_user_id=p_connection.setup_actor_auth_user_id)
    or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=p_connection.profile_id
      and d.environment=p_connection.environment and d.provider_account_id=p_connection.setup_account_id and d.state in ('pending','completed'))
  then return null; end if;
  -- JavaScript sorts UTF-16 code units; supplementary characters precede E000-FFFF.
  select pg_catalog.string_agg(pg_catalog.to_json(x->>'id')::text,',' order by (
    select array_agg(case when ascii(ch) between 57344 and 65535 then ascii(ch)+1114112 else ascii(ch) end order by position)
      from unnest(pg_catalog.string_to_array(x->>'id',null)) with ordinality chars(ch,position)))
    into blocking from pg_catalog.jsonb_array_elements(p_connection.setup_calendars)x where x->'blocksAvailability'='true'::jsonb;
  return pg_catalog.encode(extensions.digest(pg_catalog.convert_to('['||pg_catalog.to_json(p_connection.setup_operation_id::text)::text||','||
    pg_catalog.to_json(p_connection.setup_account_id)::text||','||p_connection.setup_expected_revision::text||',['||coalesce(blocking,'')||'],'||
    pg_catalog.to_json(p_connection.setup_calendar_id)::text||']','UTF8'),'sha256'),'hex');
end $$;

create function public.get_pending_google_calendar_setup(
  p_profile_id uuid,p_environment text,p_expected_revision bigint
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.calendar_connections;configuration_key text;
begin
  if p_profile_id is null or p_environment is null or p_environment not in ('test','live')
    or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'Invalid Google setup read scope' using errcode='22023';
  end if;
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment;
  if coalesce(c.connection_revision,0)<>p_expected_revision then
    raise exception 'Google calendar configuration changed; reload your selections' using errcode='40001';
  end if;
  if c.setup_operation_id is null or c.setup_completed_at is not null or c.setup_purpose<>'configuration'
    or c.setup_expected_revision is distinct from c.connection_revision then return null;end if;
  if nullif(btrim(c.setup_account_id),'') is null or nullif(btrim(c.setup_calendar_id),'') is null
    or jsonb_typeof(c.setup_calendars) is distinct from 'array' or jsonb_array_length(c.setup_calendars) not between 1 and 251
    or not exists(select 1 from jsonb_array_elements(c.setup_calendars)x where x->'blocksAvailability'='true'::jsonb)
    or (select count(*)from jsonb_array_elements(c.setup_calendars)x where x->'receivesBookings'='true'::jsonb)<>1
    or not exists(select 1 from jsonb_array_elements(c.setup_calendars)x where x->>'id'=c.setup_calendar_id and x->'receivesBookings'='true'::jsonb)
    or (select count(*)from jsonb_array_elements(c.setup_calendars))<>(select count(distinct x->>'id')from jsonb_array_elements(c.setup_calendars)x)
    or exists(select 1 from jsonb_array_elements(c.setup_calendars)x where jsonb_typeof(x->'id') is distinct from 'string'
      or nullif(btrim(x->>'id'),'') is null or jsonb_typeof(x->'blocksAvailability') is distinct from 'boolean'
      or jsonb_typeof(x->'receivesBookings') is distinct from 'boolean') then
    raise exception 'Invalid saved Google setup choices' using errcode='23514';
  end if;
  configuration_key:=public.google_calendar_setup_configuration_key(c);
  if configuration_key is null then return null;end if;
  return jsonb_build_object('operationId',c.setup_operation_id,'accountId',c.setup_account_id,
    'connectionRevision',c.setup_expected_revision,'configurationKey',configuration_key,
    'blockingCalendarIds',(select jsonb_agg(x->>'id' order by x->>'id') from jsonb_array_elements(c.setup_calendars)x where x->'blocksAvailability'='true'::jsonb),
    'destinationCalendarId',c.setup_calendar_id,'nextRetryAt',c.setup_retry_at,
    'reason',case when c.setup_probe_account_id=c.setup_account_id and c.setup_probe_calendar_id=c.setup_calendar_id
      and c.setup_failure_reason in ('temporary','platform','reauthorization','permissions','configuration') then c.setup_failure_reason end);
end $$;
revoke all on function public.get_pending_google_calendar_setup(uuid,text,bigint) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.get_pending_google_calendar_setup(uuid,text,bigint) to service_role;

create function public.authorize_google_calendar_setup_read(
  p_profile_id uuid,p_environment text,p_account_id text,p_expected_revision bigint,p_expected_setup_key text default null
)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment;
  if p_expected_revision is null or p_expected_revision<0 or coalesce(c.connection_revision,0)<>p_expected_revision
    or p_expected_setup_key is distinct from public.google_calendar_setup_configuration_key(c)
  then raise exception 'Google calendar configuration changed; reload your selections' using errcode='40001'; end if;
  if p_environment is null or p_environment not in ('test','live') or nullif(btrim(p_account_id),'') is null
    or not exists(select 1 from public.profiles p where p.id=p_profile_id and p.environment=p_environment)
    or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=p_profile_id
      and d.environment=p_environment and d.provider_account_id=p_account_id and d.state in ('pending','completed'))
  then raise exception 'Google account is not authorized for setup' using errcode='42501'; end if;
  return true;
end $$;

create function public.authorize_google_calendar_connect_start(
  p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  perform public.assert_google_calendar_owner(p_profile_id,p_environment,p_actor_auth_user_id,true);
  if p_operation_id is null then raise exception 'Connect operation required' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':google-calendar',0));
  insert into public.calendar_connections(profile_id,environment,external_user_id)
    values(p_profile_id,p_environment,'obra:'||p_environment||':'||p_profile_id::text) on conflict(profile_id,environment) do nothing;
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.connect_started_at>pg_catalog.clock_timestamp()-interval '30 seconds'
  then raise exception 'Google Connect was recently started; retry shortly' using errcode='55P03'; end if;
  update public.calendar_connections set connect_operation_id=p_operation_id,connect_actor_auth_user_id=p_actor_auth_user_id,
    connect_expected_revision=c.connection_revision,connect_expected_setup_key=public.google_calendar_setup_configuration_key(c),
    connect_started_at=pg_catalog.clock_timestamp(),
    connect_expires_at=pg_catalog.clock_timestamp()+interval '15 minutes',connect_completed_at=null where id=c.id;
  return jsonb_build_object('id',p_operation_id,'connection_revision',c.connection_revision);
end $$;

create function public.authorize_google_calendar_connect_completion(
  p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_operation_id uuid
) returns public.calendar_connections language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  perform public.assert_google_calendar_owner(p_profile_id,p_environment,p_actor_auth_user_id,true);
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if p_operation_id is null or c.connect_operation_id is distinct from p_operation_id
    or c.connect_actor_auth_user_id is distinct from p_actor_auth_user_id
    or c.connect_expires_at is null or c.connect_expires_at<=pg_catalog.clock_timestamp()
    or (c.connect_completed_at is null and c.connect_expected_revision is distinct from c.connection_revision)
    or (c.connect_completed_at is null and c.connect_expected_setup_key is distinct from public.google_calendar_setup_configuration_key(c))
    or (c.connect_completed_at is not null and (c.setup_connect_operation_id is distinct from p_operation_id
      or c.setup_completed_at is null or c.pipedream_account_id is distinct from c.setup_account_id
      or c.connection_revision not in (c.setup_expected_revision,c.setup_expected_revision+1)
      or c.verification_reason='contractor_disconnected'))
  then raise exception 'Google Connect operation changed or expired; start again' using errcode='40001'; end if;
  return c;
end $$;

create function public.request_google_calendar_verification(
  p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  perform public.assert_google_calendar_owner(p_profile_id,p_environment,p_actor_auth_user_id,false);
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.id is null or c.owner_verification_requested_at>pg_catalog.clock_timestamp()-interval '30 seconds' then return false; end if;
  update public.calendar_connections set owner_verification_requested_at=pg_catalog.clock_timestamp(),
    setup_retry_at=case when setup_operation_id is not null and setup_completed_at is null
      then pg_catalog.clock_timestamp() else setup_retry_at end where id=c.id;
  -- Private INSERT and DELETE denials are answerable by a private capability
  -- probe. Attendee-bearing CREATE/unknown denials still require booking evidence.
  if (c.setup_completed_at is not null or c.setup_operation_id is null)
    and c.pipedream_account_id is not null and c.health_state<>'disconnected' and c.reconnect_reason is null
    and (to_jsonb(c)->>'calendar_delete_blocked_at' is not null
      or to_jsonb(c)->>'calendar_probe_insert_blocked_at' is not null)
    and exists(select 1 from public.calendar_selections s where s.connection_id=c.id and s.active and s.blocks_availability)
    and (select count(*) from public.calendar_selections s where s.connection_id=c.id and s.active and s.receives_bookings)=1
    and not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=c.profile_id
      and d.environment=c.environment and d.provider_account_id=c.pipedream_account_id and d.state in ('pending','completed')) then
    update public.calendar_connections x set setup_operation_id=pg_catalog.gen_random_uuid(),setup_actor_auth_user_id=p_actor_auth_user_id,
      setup_account_id=x.pipedream_account_id,setup_account_email=x.account_email,setup_account_display_name=x.account_display_name,
      setup_expected_revision=x.connection_revision,setup_purpose='write_recovery',setup_connect_operation_id=null,
      setup_calendars=(select jsonb_agg(jsonb_build_object('id',s.google_calendar_id,'displayName',s.display_name,'accessRole',s.access_role,
        'timeZone',s.time_zone,'blocksAvailability',s.blocks_availability,'receivesBookings',s.receives_bookings) order by s.google_calendar_id)
        from public.calendar_selections s where s.connection_id=x.id and s.active),
      setup_calendar_id=(select s.google_calendar_id from public.calendar_selections s where s.connection_id=x.id and s.active and s.receives_bookings),
      setup_read_verified_at=null,setup_write_verified_at=null,setup_completed_at=null,setup_lease_token=null,setup_lease_expires_at=null,
      setup_probe_id=pg_catalog.gen_random_uuid(),setup_probe_account_id=x.pipedream_account_id,
      setup_probe_calendar_id=(select s.google_calendar_id from public.calendar_selections s where s.connection_id=x.id and s.active and s.receives_bookings),
      setup_probe_state='pending',setup_probe_started_at=null,setup_probe_delete_started_at=null,setup_probe_write_verified_at=null,
      setup_retry_at=pg_catalog.clock_timestamp(),setup_attempts=0,setup_failure_reason=null where x.id=c.id;
  end if;
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()
    where connection_id=c.id and profile_id=p_profile_id and environment=p_environment;
  return true;
end $$;

create function public.google_calendar_setup_claim(p_connection public.calendar_connections)
returns jsonb language sql set search_path='' as $$
  select jsonb_build_object('id',p_connection.setup_operation_id,'profile_id',p_connection.profile_id,
    'environment',p_connection.environment,'account_id',p_connection.setup_account_id,'calendar_id',p_connection.setup_calendar_id,
    'connection_revision',p_connection.setup_expected_revision,'fencing_token',p_connection.setup_fencing_token,
    'configuration_key',public.google_calendar_setup_configuration_key(p_connection),
    'lease_expires_at',p_connection.setup_lease_expires_at,'calendars',p_connection.setup_calendars,
    'read_verified_at',p_connection.setup_read_verified_at,'purpose',p_connection.setup_purpose,
    'probe_id',p_connection.setup_probe_id,'probe_account_id',p_connection.setup_probe_account_id,
    'probe_calendar_id',p_connection.setup_probe_calendar_id,'probe_state',p_connection.setup_probe_state,
    'probe_started_at',p_connection.setup_probe_started_at,'write_verified_at',p_connection.setup_write_verified_at,
    'probe_write_verified_at',p_connection.setup_probe_write_verified_at,
    'configuration_current',p_connection.setup_expected_revision=p_connection.connection_revision,
    'cleanup_only',p_connection.setup_expected_revision is distinct from p_connection.connection_revision
      or p_connection.setup_probe_account_id is distinct from p_connection.setup_account_id
      or p_connection.setup_probe_calendar_id is distinct from p_connection.setup_calendar_id,
    'recovery',p_connection.setup_attempts>1);
$$;

create function public.reserve_google_calendar_setup_probe(
  p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_account_id text,p_calendar_id text,
  p_expected_revision bigint,p_lease_token uuid,p_calendars jsonb,p_read_verified_at timestamptz,
  p_account_email text default null,p_account_display_name text default null,p_connect_operation_id uuid default null,
  p_expected_setup_key text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;b public.pipedream_bindings;same_probe boolean;calendars jsonb;item jsonb;material_change boolean;
begin
  perform public.assert_google_calendar_owner(p_profile_id,p_environment,p_actor_auth_user_id,true);
  if p_lease_token is null or nullif(btrim(p_account_id),'') is null or nullif(btrim(p_calendar_id),'') is null
    or p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_calendars) is distinct from 'array'
    or jsonb_array_length(p_calendars) not between 1 and 251
    or p_read_verified_at is null or p_read_verified_at<pg_catalog.clock_timestamp()-interval '1 minute'
    or p_read_verified_at>pg_catalog.clock_timestamp()+interval '1 minute'
  then raise exception 'Invalid setup reservation' using errcode='22023'; end if;
  if (select count(*)from jsonb_array_elements(p_calendars))<>(select count(distinct x->>'id')from jsonb_array_elements(p_calendars)x)
    or not exists(select 1 from jsonb_array_elements(p_calendars)x where x->'blocksAvailability'='true'::jsonb)
    or (select count(*)from jsonb_array_elements(p_calendars)x where x->'receivesBookings'='true'::jsonb)<>1
    or not exists(select 1 from jsonb_array_elements(p_calendars)x where x->>'id'=p_calendar_id
      and x->'receivesBookings'='true'::jsonb and x->>'accessRole' in ('writer','owner'))
  then raise exception 'Invalid setup calendar selection' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_calendars) loop
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'id') is distinct from 'string'
      or nullif(btrim(item->>'id'),'') is null or jsonb_typeof(item->'displayName') is distinct from 'string'
      or item->>'accessRole' is null or item->>'accessRole' not in ('freeBusyReader','reader','writer','owner')
      or jsonb_typeof(item->'blocksAvailability') is distinct from 'boolean'
      or jsonb_typeof(item->'receivesBookings') is distinct from 'boolean'
    then raise exception 'Invalid setup calendar evidence' using errcode='22023'; end if;
  end loop;
  select jsonb_agg(x order by x->>'id') into calendars from jsonb_array_elements(p_calendars)x;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':google-calendar',0));
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if (c.id is null and p_expected_revision<>0) or (c.id is not null and c.connection_revision<>p_expected_revision)
    or p_expected_setup_key is distinct from public.google_calendar_setup_configuration_key(c)
  then raise exception 'Google calendar configuration changed' using errcode='40001'; end if;
  if exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=p_profile_id
    and d.environment=p_environment and d.provider_account_id=p_account_id and d.state in ('pending','completed'))
  then raise exception 'Disconnected provider identity cannot be reused; connect a new account identity' using errcode='42501'; end if;
  if c.id is null then
    insert into public.calendar_connections(profile_id,environment,external_user_id)
      values(p_profile_id,p_environment,'obra:'||p_environment||':'||p_profile_id::text) returning * into c;
  end if;
  if p_connect_operation_id is not null then
    perform public.authorize_google_calendar_connect_completion(p_profile_id,p_environment,p_actor_auth_user_id,p_connect_operation_id);
    -- OAuth renews the captured intent; changing accounts/calendars requires the
    -- owner's explicit selection path, never the completion callback's defaults.
    if c.connect_expected_setup_key is not null then
      if c.setup_account_id is distinct from p_account_id or c.setup_calendar_id is distinct from p_calendar_id
        or (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id') from jsonb_array_elements(c.setup_calendars)x)
          is distinct from (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id') from jsonb_array_elements(calendars)x) then
        raise exception 'Google Connect must preserve pending calendar choices' using errcode='40001';
      end if;
    elsif c.pipedream_account_id is not null or c.verification_reason='contractor_disconnected'
      or exists(select 1 from public.calendar_selections s where s.connection_id=c.id and s.active) then
      if c.pipedream_account_id is distinct from p_account_id
        or (select jsonb_agg(jsonb_build_array(s.google_calendar_id,s.blocks_availability,s.receives_bookings) order by s.google_calendar_id) from public.calendar_selections s where s.connection_id=c.id and s.active)
          is distinct from (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id') from jsonb_array_elements(calendars)x) then
        raise exception 'Google Connect must preserve saved calendar choices; select a new account explicitly' using errcode='40001';
      end if;
    end if;
  end if;
  select * into b from public.pipedream_bindings where connection_id=c.id for update;
  material_change:=c.pipedream_account_id is distinct from p_account_id or
    (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id')
      from jsonb_array_elements(calendars)x) is distinct from
    (select jsonb_agg(jsonb_build_array(s.google_calendar_id,s.blocks_availability,s.receives_bookings) order by s.google_calendar_id)
      from public.calendar_selections s where s.connection_id=c.id and s.active);
  if material_change and (b.reconciliation_lease_expires_at>pg_catalog.clock_timestamp()
    or b.deployment_lease_expires_at>pg_catalog.clock_timestamp()
    or (b.deployment_dispatched_at is not null and b.deployment_candidate_trigger_id is null))
  then raise exception 'Calendar monitoring operation must settle before changing calendars' using errcode='55P03'; end if;
  if c.setup_lease_expires_at>pg_catalog.clock_timestamp()
  then raise exception 'Google setup is already in progress' using errcode='55P03'; end if;
  same_probe:=c.setup_operation_id is not null and c.setup_completed_at is null
    and c.setup_account_id=p_account_id and c.setup_calendar_id=p_calendar_id
    and c.setup_expected_revision=c.connection_revision
    and ((select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id')
      from jsonb_array_elements(c.setup_calendars)x) is not distinct from
      (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id')
       from jsonb_array_elements(calendars)x));
  -- Replacing desired choices never discards a possibly dispatched private event.
  -- The same operation cleans that exact event before probing the replacement.
  update public.calendar_connections x set
    setup_operation_id=case when x.setup_operation_id is not null and x.setup_completed_at is null
      then x.setup_operation_id else pg_catalog.gen_random_uuid() end,
    setup_actor_auth_user_id=p_actor_auth_user_id,setup_account_email=nullif(btrim(p_account_email),''),
    setup_account_display_name=nullif(btrim(p_account_display_name),''),setup_connect_operation_id=p_connect_operation_id,
    setup_purpose='configuration',
    setup_account_id=p_account_id,setup_calendar_id=p_calendar_id,setup_expected_revision=x.connection_revision,
    setup_calendars=calendars,setup_read_verified_at=p_read_verified_at,
    setup_completed_at=null,
    setup_write_verified_at=case when same_probe then x.setup_write_verified_at else null end,
    setup_probe_id=case when x.setup_completed_at is null and x.setup_probe_state not in ('pending','absent') then x.setup_probe_id
      when same_probe then x.setup_probe_id else pg_catalog.gen_random_uuid() end,
    setup_probe_account_id=case when x.setup_completed_at is null and x.setup_probe_state not in ('pending','absent')
      then x.setup_probe_account_id else p_account_id end,
    setup_probe_calendar_id=case when x.setup_completed_at is null and x.setup_probe_state not in ('pending','absent')
      then x.setup_probe_calendar_id else p_calendar_id end,
    setup_probe_state=case when (x.setup_completed_at is null and x.setup_probe_state not in ('pending','absent')) or same_probe
      then x.setup_probe_state else 'pending' end,
    setup_probe_started_at=case when (x.setup_completed_at is null and x.setup_probe_state not in ('pending','absent')) or same_probe
      then x.setup_probe_started_at else null end,
    setup_probe_delete_started_at=case when (x.setup_completed_at is null and x.setup_probe_state not in ('pending','absent')) or same_probe
      then x.setup_probe_delete_started_at else null end,
    setup_probe_write_verified_at=case when (x.setup_completed_at is null and x.setup_probe_state not in ('pending','absent')) or same_probe
      then x.setup_probe_write_verified_at else null end,
    setup_lease_token=p_lease_token,setup_lease_expires_at=pg_catalog.clock_timestamp()+interval '90 seconds',
    setup_fencing_token=x.setup_fencing_token+1,setup_retry_at=pg_catalog.clock_timestamp(),
    setup_attempts=case when same_probe then x.setup_attempts+1 else 1 end,setup_failure_reason=null
    where x.id=c.id returning * into c;
  if p_connect_operation_id is not null then
    update public.calendar_connections set connect_expected_setup_key=public.google_calendar_setup_configuration_key(c) where id=c.id;
  end if;
  return public.google_calendar_setup_claim(c);
end $$;

create function public.claim_google_calendar_setup_probe(
  p_environment text,p_lease_token uuid,p_exclude_operation_ids uuid[] default '{}',p_profile_id uuid default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;b public.pipedream_bindings;
begin
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null
    or p_exclude_operation_ids is null or cardinality(p_exclude_operation_ids)>100
  then raise exception 'Invalid setup cleanup claim' using errcode='22023'; end if;
  select * into c from public.calendar_connections x where x.environment=p_environment and x.setup_operation_id is not null
    and (p_profile_id is null or x.profile_id=p_profile_id)
    and not x.setup_operation_id=any(p_exclude_operation_ids)
    and x.setup_completed_at is null and x.setup_retry_at<=pg_catalog.clock_timestamp()
    and (x.setup_lease_expires_at is null or x.setup_lease_expires_at<=pg_catalog.clock_timestamp())
    and not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=x.profile_id
      and d.environment=x.environment and d.provider_account_id=x.setup_probe_account_id and d.state in ('pending','completed'))
    and not exists(select 1 from public.pipedream_bindings binding where binding.connection_id=x.id
      and x.setup_expected_revision=x.connection_revision
      and (binding.reconciliation_lease_expires_at>pg_catalog.clock_timestamp() or binding.deployment_lease_expires_at>pg_catalog.clock_timestamp()
        or (binding.deployment_dispatched_at is not null and binding.deployment_candidate_trigger_id is null))
      and (x.setup_account_id is distinct from x.pipedream_account_id
        or (select jsonb_agg(jsonb_build_array(j->>'id',j->'blocksAvailability',j->'receivesBookings') order by j->>'id')
          from jsonb_array_elements(x.setup_calendars)j) is distinct from
          (select jsonb_agg(jsonb_build_array(s.google_calendar_id,s.blocks_availability,s.receives_bookings) order by s.google_calendar_id)
          from public.calendar_selections s where s.connection_id=x.id and s.active)))
    order by x.setup_retry_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select * into b from public.pipedream_bindings where connection_id=c.id for update;
  if c.setup_expected_revision=c.connection_revision and (c.setup_account_id is distinct from c.pipedream_account_id
    or (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id')
      from jsonb_array_elements(c.setup_calendars)x) is distinct from
      (select jsonb_agg(jsonb_build_array(s.google_calendar_id,s.blocks_availability,s.receives_bookings) order by s.google_calendar_id)
      from public.calendar_selections s where s.connection_id=c.id and s.active))
    and (b.reconciliation_lease_expires_at>pg_catalog.clock_timestamp() or b.deployment_lease_expires_at>pg_catalog.clock_timestamp()
      or (b.deployment_dispatched_at is not null and b.deployment_candidate_trigger_id is null))
  then return null; end if;
  update public.calendar_connections x set setup_lease_token=p_lease_token,
    setup_lease_expires_at=pg_catalog.clock_timestamp()+interval '90 seconds',setup_fencing_token=x.setup_fencing_token+1,
    setup_attempts=least(x.setup_attempts,1000000)+1 where x.id=c.id returning * into c;
  return public.google_calendar_setup_claim(c);
end $$;

create function public.authorize_google_calendar_setup_effect(
  p_profile_id uuid,p_environment text,p_operation_id uuid,p_lease_token uuid,p_fencing_token bigint,p_action text
) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.id is null or p_operation_id is null or c.setup_operation_id is distinct from p_operation_id
    or p_lease_token is null or c.setup_lease_token is distinct from p_lease_token
    or c.setup_fencing_token is distinct from p_fencing_token or c.setup_lease_expires_at is null
    or c.setup_lease_expires_at<=pg_catalog.clock_timestamp() or c.setup_completed_at is not null
    or p_action is null or p_action not in ('read','insert','delete')
    or (p_action='insert' and (c.setup_expected_revision is distinct from c.connection_revision
      or c.setup_probe_account_id is distinct from c.setup_account_id or c.setup_probe_calendar_id is distinct from c.setup_calendar_id
      or c.setup_probe_state not in ('pending','insert_dispatched')))
    or (p_action='delete' and c.setup_probe_state not in ('present','delete_dispatched'))
    or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=c.profile_id
      and d.environment=c.environment and d.provider_account_id=c.setup_probe_account_id and d.state in ('pending','completed'))
  then raise exception 'Google setup effect authority lost' using errcode='40001'; end if;
  perform public.assert_google_calendar_owner(c.profile_id,c.environment,c.setup_actor_auth_user_id,false);
  if p_action in ('insert','delete') then
    update public.calendar_connections set setup_probe_state=case when p_action='insert' then 'insert_dispatched' else 'delete_dispatched' end,
      setup_probe_started_at=case when p_action='insert' then pg_catalog.clock_timestamp()
        else setup_probe_started_at end,
      setup_write_verified_at=case when p_action='insert' then null else setup_write_verified_at end,
      setup_probe_delete_started_at=case when p_action='delete' then pg_catalog.clock_timestamp() else setup_probe_delete_started_at end where id=c.id;
  end if;
  return true;
end $$;

create function public.record_google_calendar_setup_read(
  p_profile_id uuid,p_environment text,p_operation_id uuid,p_lease_token uuid,p_fencing_token bigint,
  p_calendars jsonb,p_verified_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  perform public.authorize_google_calendar_setup_effect(p_profile_id,p_environment,p_operation_id,p_lease_token,p_fencing_token,'read');
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.setup_expected_revision is distinct from c.connection_revision or p_verified_at is null
    or p_verified_at not between pg_catalog.clock_timestamp()-interval '1 minute' and pg_catalog.clock_timestamp()+interval '1 minute'
    or jsonb_typeof(p_calendars) is distinct from 'array'
    or (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id') from jsonb_array_elements(p_calendars)x)
      is distinct from (select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id') from jsonb_array_elements(c.setup_calendars)x)
    or exists(select 1 from jsonb_array_elements(p_calendars)x where x->>'accessRole' is null
      or x->>'accessRole' not in ('freeBusyReader','reader','writer','owner')
      or (x->'receivesBookings'='true'::jsonb and x->>'accessRole' not in ('writer','owner')))
  then raise exception 'Setup read evidence does not match owner choices' using errcode='40001'; end if;
  update public.calendar_connections set setup_calendars=(select jsonb_agg(x order by x->>'id') from jsonb_array_elements(p_calendars)x),
    setup_read_verified_at=p_verified_at where id=c.id;
  return true;
end $$;

create function public.settle_google_calendar_setup_probe(
  p_profile_id uuid,p_environment text,p_operation_id uuid,p_lease_token uuid,p_fencing_token bigint,
  p_success boolean,p_write_verified boolean,p_reason text,p_probe_state text default null,
  p_denied_action text default null,p_failure_observed_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;cleanup_complete boolean;
begin
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.id is null or p_success is null or p_write_verified is null or p_operation_id is null or c.setup_operation_id is distinct from p_operation_id
    or c.setup_lease_token is distinct from p_lease_token or p_lease_token is null
    or c.setup_fencing_token is distinct from p_fencing_token
    or c.setup_lease_expires_at is null or c.setup_lease_expires_at<=pg_catalog.clock_timestamp()
  then raise exception 'Google setup lease lost' using errcode='40001'; end if;
  if p_probe_state is not null and p_probe_state not in ('pending','present','absent')
  then raise exception 'Invalid setup probe observation' using errcode='22023'; end if;
  if p_success and p_write_verified and (p_probe_state is null or p_probe_state not in ('present','absent')
    or c.setup_probe_started_at is null or c.setup_probe_state='pending')
  then raise exception 'Setup write proof requires an attributable dispatched effect' using errcode='40001'; end if;
  if p_denied_action is not null then
    if p_success or p_reason is distinct from 'permissions' or p_denied_action not in ('insert','delete')
      or p_failure_observed_at is null or p_failure_observed_at not between pg_catalog.clock_timestamp()-interval '1 minute' and pg_catalog.clock_timestamp()+interval '1 minute'
      or c.setup_probe_state is distinct from (case when p_denied_action='insert' then 'insert_dispatched' else 'delete_dispatched' end)
    then raise exception 'Attributable setup permission denial required' using errcode='22023'; end if;
    -- SQL130 owns capability precedence. Call before changing dispatch state or
    -- releasing the setup fence; no synthetic appointment/link is introduced.
    perform public.record_booking_calendar_setup_denial(p_profile_id,p_environment,p_operation_id,p_lease_token,p_fencing_token,
      p_denied_action,p_failure_observed_at);
  end if;
  cleanup_complete:=p_success and coalesce(p_probe_state,c.setup_probe_state)='absent'
    and c.setup_expected_revision is distinct from c.connection_revision;
  update public.calendar_connections x set
    setup_probe_state=coalesce(p_probe_state,x.setup_probe_state),
    setup_completed_at=case when cleanup_complete then pg_catalog.clock_timestamp() else x.setup_completed_at end,
    setup_write_verified_at=case when p_success and p_write_verified
      and x.setup_expected_revision=x.connection_revision and x.setup_probe_account_id=x.setup_account_id and x.setup_probe_calendar_id=x.setup_calendar_id
      then coalesce(x.setup_write_verified_at,x.setup_probe_started_at) else x.setup_write_verified_at end,
    setup_probe_write_verified_at=case when p_success and p_write_verified and p_probe_state='absent' and x.setup_probe_state='delete_dispatched'
      then greatest(x.setup_probe_write_verified_at,x.setup_probe_delete_started_at) else x.setup_probe_write_verified_at end,
    setup_retry_at=case when cleanup_complete then null
      when p_success then pg_catalog.clock_timestamp() else pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>
      case when x.setup_attempts>=8 then 3600 else least(900,30*(2^least(x.setup_attempts,5))::integer) end) end,
    setup_failure_reason=case when p_success then null when p_reason in ('temporary','platform','reauthorization','permissions','configuration')
      then p_reason else 'temporary' end,
    setup_lease_token=case when p_success and not cleanup_complete then x.setup_lease_token else null end,
    setup_lease_expires_at=case when p_success and not cleanup_complete then x.setup_lease_expires_at else null end where x.id=c.id returning * into c;
  return public.google_calendar_setup_claim(c);
end $$;

create function public.restart_google_calendar_setup_probe(
  p_profile_id uuid,p_environment text,p_operation_id uuid,p_lease_token uuid,p_fencing_token bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  perform public.authorize_google_calendar_setup_effect(p_profile_id,p_environment,p_operation_id,p_lease_token,p_fencing_token,'read');
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.setup_probe_state<>'absent' or c.setup_expected_revision is distinct from c.connection_revision
  then raise exception 'Exact setup cleanup required before a new probe' using errcode='40001'; end if;
  update public.calendar_connections set setup_probe_id=pg_catalog.gen_random_uuid(),setup_probe_account_id=setup_account_id,
    setup_probe_calendar_id=setup_calendar_id,setup_probe_state='pending',setup_probe_started_at=null,setup_probe_delete_started_at=null,
    setup_write_verified_at=null,setup_probe_write_verified_at=null
    where id=c.id returning * into c;
  return public.google_calendar_setup_claim(c);
end $$;

drop function public.persist_google_calendar_configuration(uuid,text,uuid,text,text,text,text,jsonb,timestamptz,bigint);
create function public.persist_google_calendar_configuration(
  p_profile_id uuid,p_environment text,p_setup_operation_id uuid,p_lease_token uuid,p_fencing_token bigint
) returns public.calendar_connections language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;b public.pipedream_bindings;item jsonb;desired jsonb;existing jsonb;material_change boolean;known_write_blocker boolean;
begin
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.id is null or c.connection_revision is distinct from c.setup_expected_revision
    or p_setup_operation_id is null or c.setup_operation_id is distinct from p_setup_operation_id
    or p_lease_token is null or c.setup_lease_token is distinct from p_lease_token
    or c.setup_fencing_token is distinct from p_fencing_token or c.setup_lease_expires_at is null or c.setup_lease_expires_at<=pg_catalog.clock_timestamp()
    or c.setup_completed_at is not null or c.setup_write_verified_at is null or c.setup_probe_state<>'absent'
    or c.setup_probe_write_verified_at is null or c.setup_write_verified_at<pg_catalog.clock_timestamp()-interval '5 minutes'
    or c.setup_probe_account_id is distinct from c.setup_account_id or c.setup_probe_calendar_id is distinct from c.setup_calendar_id
    or c.setup_read_verified_at<pg_catalog.clock_timestamp()-interval '5 minutes' or c.setup_read_verified_at is null
  then raise exception 'Verified Google setup operation or revision required' using errcode='40001'; end if;
  perform public.assert_google_calendar_owner(p_profile_id,p_environment,c.setup_actor_auth_user_id,false);
  if exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=p_profile_id
    and d.environment=p_environment and d.provider_account_id=c.setup_account_id and d.state in ('pending','completed'))
  then raise exception 'Disconnected provider identity cannot be reused' using errcode='42501'; end if;
  select jsonb_agg(jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings')order by x->>'id')
    into desired from jsonb_array_elements(c.setup_calendars)x;
  select jsonb_agg(jsonb_build_array(s.google_calendar_id,s.blocks_availability,s.receives_bookings)order by s.google_calendar_id)
    into existing from public.calendar_selections s where s.connection_id=c.id and s.active;
  material_change:=c.pipedream_account_id is distinct from c.setup_account_id or desired is distinct from existing;
  select * into b from public.pipedream_bindings where connection_id=c.id for update;
  if material_change and (b.reconciliation_lease_expires_at>pg_catalog.clock_timestamp()
    or b.deployment_lease_expires_at>pg_catalog.clock_timestamp()
    or (b.deployment_dispatched_at is not null and b.deployment_candidate_trigger_id is null))
  then raise exception 'Calendar monitoring operation must settle before changing calendars' using errcode='55P03'; end if;
  known_write_blocker:=(c.verification_reason='calendar_write_blocked' or to_jsonb(c)->>'calendar_write_blocked_at' is not null)
    and c.pipedream_account_id=c.setup_account_id
    and exists(select 1 from public.calendar_selections s where s.connection_id=c.id and s.active
      and s.receives_bookings and s.google_calendar_id=c.setup_calendar_id);
  if known_write_blocker then
    -- The full scoped setup reads have renewed authorization, but cannot clear
    -- write capability. SQL130 consumes private INSERT/DELETE evidence separately
    -- without clearing an independent attendee-bearing CREATE denial.
    update public.calendar_connections set reconnect_reason=null,health_state='degraded' where id=c.id;
    if pg_catalog.to_regprocedure('public.settle_booking_calendar_setup_capability(uuid,text,uuid,uuid,bigint)') is not null then
      perform public.settle_booking_calendar_setup_capability(p_profile_id,p_environment,p_setup_operation_id,p_lease_token,p_fencing_token);
    end if;
    select verification_reason='calendar_write_blocked' into known_write_blocker from public.calendar_connections where id=c.id;
  end if;
  if material_change then
    update public.calendar_selections set active=false,blocks_availability=false,receives_bookings=false
      where connection_id=c.id;
  end if;
  for item in select value from jsonb_array_elements(c.setup_calendars) loop
    insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,access_role,
      time_zone,blocks_availability,receives_bookings,active,permission_verified_at)
    values(c.id,p_profile_id,p_environment,item->>'id',item->>'displayName',item->>'accessRole',nullif(item->>'timeZone',''),
      (item->>'blocksAvailability')::boolean,(item->>'receivesBookings')::boolean,true,c.setup_read_verified_at)
    on conflict(connection_id,google_calendar_id) do update set display_name=excluded.display_name,access_role=excluded.access_role,
      time_zone=excluded.time_zone,blocks_availability=excluded.blocks_availability,receives_bookings=excluded.receives_bookings,
      active=true,permission_verified_at=excluded.permission_verified_at,updated_at=pg_catalog.clock_timestamp();
  end loop;
  perform public.assert_google_calendar_selection_invariants(c.id,p_profile_id,p_environment);
  update public.calendar_connections x set pipedream_account_id=c.setup_account_id,
    account_email=c.setup_account_email,account_display_name=c.setup_account_display_name,
    health_state=case when known_write_blocker then 'degraded' else 'healthy' end,
    verification_reason=case when known_write_blocker then 'calendar_write_blocked' else null end,
    reconnect_reason=null,last_verified_at=c.setup_read_verified_at,disconnected_at=null,
    connection_revision=x.connection_revision+case when material_change then 1 else 0 end,
    setup_completed_at=pg_catalog.clock_timestamp(),setup_retry_at=null,
    connect_completed_at=case when x.connect_operation_id=x.setup_connect_operation_id then pg_catalog.clock_timestamp() else x.connect_completed_at end,
    setup_lease_token=null,setup_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where x.id=c.id returning * into c;
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()
    where connection_id=c.id and profile_id=c.profile_id and environment=c.environment;
  return c;
end $$;

create or replace function public.reconcile_google_calendar_connection(
  p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_expected_revision bigint,
  p_health_state text,p_reason text,p_verified_at timestamptz
) returns public.calendar_connections language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  perform public.assert_google_calendar_owner(p_profile_id,p_environment,p_actor_auth_user_id,false);
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.id is null or c.connection_revision is distinct from p_expected_revision or c.pipedream_account_id is null
    or exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=p_profile_id
      and d.environment=p_environment and d.provider_account_id=c.pipedream_account_id and d.state in ('pending','completed'))
  then raise exception 'Google calendar configuration changed' using errcode='40001'; end if;
  -- Success must come from the full-calendar verifier, not this older owner status RPC.
  if p_health_state is null or p_health_state not in ('degraded','disconnected')
    or p_reason is null or p_reason not in ('provider_account_unhealthy','provider_account_missing','calendar_permissions_changed',
      'calendar_selection_invalid','verification_stale','provider_temporary_failure','provider_platform_error',
      'provider_configuration_error','provider_reauthorization_required')
    or (p_health_state='disconnected' and p_reason not in ('provider_account_missing','provider_reauthorization_required'))
  then raise exception 'Use the scoped verifier for successful health observations' using errcode='22023'; end if;
  update public.calendar_connections x set
    health_state=case when x.reconnect_reason in ('provider_account_missing','provider_reauthorization_required')
      then 'disconnected' else p_health_state end,
    verification_reason=case when x.verification_reason='calendar_write_blocked' then x.verification_reason else p_reason end,
    reconnect_reason=case when p_health_state='disconnected' then p_reason else x.reconnect_reason end,
    last_synchronized_at=null,updated_at=pg_catalog.clock_timestamp() where x.id=c.id returning * into c;
  update public.pipedream_bindings set
    reconciliation_due_at=least(coalesce(reconciliation_due_at,pg_catalog.clock_timestamp()),pg_catalog.clock_timestamp())
    where connection_id=c.id and profile_id=c.profile_id and environment=c.environment;
  return c;
end $$;

drop function public.reserve_booking_provider_account_disconnect_v3(uuid,text,text,uuid);
create function public.reserve_booking_provider_account_disconnect_v3(
  p_profile_id uuid,p_environment text,p_provider_account_id text,p_actor_auth_user_id uuid,p_expected_connection_revision bigint
) returns uuid language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;d public.booking_provider_account_disconnects_v3;
begin
  perform public.assert_google_calendar_owner(p_profile_id,p_environment,p_actor_auth_user_id,false);
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if p_provider_account_id is null then
    select * into d from public.booking_provider_account_disconnects_v3 where profile_id=p_profile_id
      and environment=p_environment and provider='pipedream' order by requested_at desc limit 1 for update;
    return d.id;
  end if;
  select * into d from public.booking_provider_account_disconnects_v3 where profile_id=p_profile_id
    and environment=p_environment and provider='pipedream' and provider_account_id=p_provider_account_id for update;
  if d.id is not null then return d.id; end if;
  if c.id is null or not coalesce(c.pipedream_account_id=p_provider_account_id
    or (c.pipedream_account_id is null and c.setup_account_id=p_provider_account_id and c.setup_completed_at is null),false)
    or c.connection_revision is distinct from p_expected_connection_revision
  then raise exception 'Disconnect requires the exact current account' using errcode='40001'; end if;
  insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,
    actor_auth_user_id,connection_id,requested_connection_revision,unresolved_setup_operation_id,unresolved_setup_calendar_id)
    values(p_profile_id,p_environment,'pipedream',p_provider_account_id,p_actor_auth_user_id,c.id,c.connection_revision,
      case when c.setup_probe_account_id=p_provider_account_id and c.setup_completed_at is null then c.setup_probe_id end,
      case when c.setup_probe_account_id=p_provider_account_id and c.setup_completed_at is null then c.setup_probe_calendar_id end)
    returning * into d;
  -- Disable new work in the same transaction as the intent, before any provider call.
  -- Desired selections and original destination epochs remain attributable.
  update public.calendar_connections set health_state='disconnected',verification_reason='contractor_disconnected',
    reconnect_reason='contractor_disconnected',disconnected_at=pg_catalog.clock_timestamp(),last_synchronized_at=null,
    connection_revision=connection_revision+1,setup_fencing_token=setup_fencing_token+1,
    setup_lease_token=null,setup_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp() where id=c.id;
  if c.setup_probe_account_id=p_provider_account_id
    or (c.setup_account_id=p_provider_account_id and c.setup_probe_state in ('pending','absent')) then
    update public.calendar_connections set setup_operation_id=null,setup_account_id=null,setup_calendar_id=null,
      setup_expected_revision=null,setup_calendars=null,setup_read_verified_at=null,
      setup_completed_at=null,setup_write_verified_at=null,setup_retry_at=null,
      setup_actor_auth_user_id=null,setup_account_email=null,setup_account_display_name=null,setup_connect_operation_id=null,
      setup_probe_id=null,setup_probe_account_id=null,setup_probe_calendar_id=null,setup_probe_state='pending',
      setup_probe_started_at=null,setup_probe_delete_started_at=null,setup_probe_write_verified_at=null where id=c.id;
  end if;
  return d.id;
end $$;

create function public.claim_booking_provider_account_disconnect_v3(
  p_environment text,p_lease_token uuid,p_disconnect_id uuid default null,p_exclude_ids uuid[] default '{}'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record;d public.booking_provider_account_disconnects_v3;
begin
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null
    or p_exclude_ids is null or cardinality(p_exclude_ids)>100
  then raise exception 'Invalid provider disconnect claim' using errcode='22023'; end if;
  if p_disconnect_id is not null then
    select * into d from public.booking_provider_account_disconnects_v3
      where id=p_disconnect_id and environment=p_environment and state='completed';
    if found then return to_jsonb(d); end if;
  end if;
  for candidate in select x.id,x.profile_id from public.booking_provider_account_disconnects_v3 x
    where x.environment=p_environment and x.state='pending'
      and not x.id=any(p_exclude_ids)
      and (p_disconnect_id is null or x.id=p_disconnect_id)
      and (x.retry_at is null or x.retry_at<=pg_catalog.clock_timestamp())
      and (x.lease_expires_at is null or x.lease_expires_at<=pg_catalog.clock_timestamp())
    order by x.retry_at nulls first,x.requested_at limit 10
  loop
    perform 1 from public.calendar_connections where profile_id=candidate.profile_id and environment=p_environment
      for update skip locked;
    if not found then continue; end if;
    select * into d from public.booking_provider_account_disconnects_v3 where id=candidate.id
      and state='pending' and (lease_expires_at is null or lease_expires_at<=pg_catalog.clock_timestamp())
      for update skip locked;
    if not found then continue; end if;
    update public.booking_provider_account_disconnects_v3 x set lease_token=p_lease_token,
      lease_expires_at=pg_catalog.clock_timestamp()+interval '90 seconds',fencing_token=x.fencing_token+1,
      attempts=least(x.attempts,1000000)+1,
      dispatch_state=case when x.dispatch_state='dispatched' then 'ambiguous' else x.dispatch_state end
      where x.id=d.id returning * into d;
    return to_jsonb(d);
  end loop;
  return null;
end $$;

create function public.lock_google_calendar_disconnect(
  p_disconnect_id uuid,p_profile_id uuid,p_environment text,p_provider_account_id text,p_lease_token uuid,p_fencing_token bigint
) returns public.booking_provider_account_disconnects_v3 language plpgsql security definer set search_path='' as $$
declare d public.booking_provider_account_disconnects_v3;
begin
  perform 1 from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  select * into d from public.booking_provider_account_disconnects_v3 where id=p_disconnect_id for update;
  if d.id is null or d.profile_id is distinct from p_profile_id or d.environment is distinct from p_environment
    or d.provider_account_id is distinct from p_provider_account_id or d.state<>'pending'
    or p_lease_token is null or d.lease_token is distinct from p_lease_token or d.fencing_token is distinct from p_fencing_token
    or d.lease_expires_at is null or d.lease_expires_at<=pg_catalog.clock_timestamp()
  then raise exception 'Provider disconnect lease lost' using errcode='40001'; end if;
  return d;
end $$;

create function public.begin_booking_provider_account_disconnect_v3(
  p_disconnect_id uuid,p_profile_id uuid,p_environment text,p_provider_account_id text,p_lease_token uuid,p_fencing_token bigint
) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.booking_provider_account_disconnects_v3;
begin
  d:=public.lock_google_calendar_disconnect(p_disconnect_id,p_profile_id,p_environment,p_provider_account_id,p_lease_token,p_fencing_token);
  update public.booking_provider_account_disconnects_v3 set dispatch_state='dispatched',
    dispatched_at=coalesce(dispatched_at,pg_catalog.clock_timestamp()) where id=d.id;
  return true;
end $$;

create function public.fail_booking_provider_account_disconnect_v3(
  p_disconnect_id uuid,p_profile_id uuid,p_environment text,p_provider_account_id text,p_lease_token uuid,p_fencing_token bigint,p_reason text
) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.booking_provider_account_disconnects_v3;
begin
  d:=public.lock_google_calendar_disconnect(p_disconnect_id,p_profile_id,p_environment,p_provider_account_id,p_lease_token,p_fencing_token);
  update public.booking_provider_account_disconnects_v3 set dispatch_state='ambiguous',lease_token=null,lease_expires_at=null,
    failure_reason=case when p_reason in ('provider_platform_error','provider_configuration_error','provider_temporary_failure')
      then p_reason else 'provider_temporary_failure' end,
    retry_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>case when attempts>=8 then 3600
      else least(900,30*(2^least(attempts,5))::integer) end) where id=d.id;
  return true;
end $$;

drop function public.complete_booking_provider_account_disconnect_v3(uuid,uuid,text,text);
create function public.complete_booking_provider_account_disconnect_v3(
  p_disconnect_id uuid,p_profile_id uuid,p_environment text,p_provider_account_id text,p_lease_token uuid,p_fencing_token bigint
) returns boolean language plpgsql security definer set search_path='' as $$
declare d public.booking_provider_account_disconnects_v3;connection public.calendar_connections;preserve_connect boolean;
begin
  d:=public.lock_google_calendar_disconnect(p_disconnect_id,p_profile_id,p_environment,p_provider_account_id,p_lease_token,p_fencing_token);
  if d.dispatched_at is null then raise exception 'Provider disconnect was not dispatched' using errcode='40001'; end if;
  select * into connection from public.calendar_connections where profile_id=p_profile_id and environment=p_environment;
  preserve_connect:=connection.connect_expected_revision=connection.connection_revision and connection.connect_started_at>d.requested_at
    and connection.connect_expected_setup_key is not distinct from public.google_calendar_setup_configuration_key(connection);
  update public.calendar_connections c set pipedream_account_id=null,account_email=null,account_display_name=null,
    identity_metadata='{}'::jsonb,health_state='disconnected',verification_reason='contractor_disconnected',
    reconnect_reason='contractor_disconnected',last_synchronized_at=null,disconnected_at=coalesce(c.disconnected_at,pg_catalog.clock_timestamp()),
    connection_revision=c.connection_revision+1,
    setup_expected_revision=case when c.setup_expected_revision=c.connection_revision and c.setup_account_id<>d.provider_account_id
      then c.connection_revision+1 else c.setup_expected_revision end,
    connect_expected_revision=case when preserve_connect
      then c.connection_revision+1 else c.connect_expected_revision end,
    updated_at=pg_catalog.clock_timestamp()
    where c.profile_id=p_profile_id and c.environment=p_environment and c.pipedream_account_id=d.provider_account_id returning * into connection;
  if found and preserve_connect then
    update public.calendar_connections set connect_expected_setup_key=public.google_calendar_setup_configuration_key(connection)
      where id=connection.id;
  end if;
  update public.booking_provider_account_disconnects_v3 set state='completed',dispatch_state='settled',
    completed_at=pg_catalog.clock_timestamp(),lease_token=null,lease_expires_at=null,retry_at=null,failure_reason=null where id=d.id;
  return true;
end $$;

create or replace function public.clear_google_calendar_connection(
  p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_expected_revision bigint
) returns public.calendar_connections language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections;
begin
  perform public.assert_google_calendar_owner(p_profile_id,p_environment,p_actor_auth_user_id,false);
  select * into c from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if c.id is null or c.connection_revision is distinct from p_expected_revision
  then raise exception 'Google calendar configuration changed' using errcode='40001'; end if;
  if c.pipedream_account_id is null and c.verification_reason='contractor_disconnected' then return c; end if;
  if not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=p_profile_id
    and d.environment=p_environment and d.provider_account_id=c.pipedream_account_id and d.state='completed' and d.dispatch_state='settled')
  then raise exception 'Durably settled disconnect required' using errcode='42501'; end if;
  update public.calendar_connections set pipedream_account_id=null,account_email=null,account_display_name=null,
    health_state='disconnected',verification_reason='contractor_disconnected',reconnect_reason='contractor_disconnected',
    connection_revision=connection_revision+1,last_synchronized_at=null,updated_at=pg_catalog.clock_timestamp()
    where id=c.id returning * into c;
  return c;
end $$;

-- Bring pre-migration explicit intent into the same stop-work authority. A pending
-- old DELETE never gains permission to target a distinct replacement account.
update public.calendar_connections c set health_state='disconnected',verification_reason='contractor_disconnected',
  reconnect_reason='contractor_disconnected',last_synchronized_at=null,connection_revision=c.connection_revision+1,
  disconnected_at=coalesce(c.disconnected_at,(select min(d.requested_at) from public.booking_provider_account_disconnects_v3 d
    where d.profile_id=c.profile_id and d.environment=c.environment and d.provider_account_id=c.pipedream_account_id and d.state in ('pending','completed')))
where exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=c.profile_id
  and d.environment=c.environment and d.provider_account_id=c.pipedream_account_id and d.state in ('pending','completed'));

create or replace function public.resolve_pipedream_trigger_signing_key(
  p_environment text,p_binding_id uuid,p_trigger_id text,p_account_id text,p_correlation_id uuid
) returns text language sql security definer set search_path='' as $$
  select v.decrypted_secret from public.pipedream_bindings b
  join public.calendar_connections c on c.id=b.connection_id and c.profile_id=b.profile_id and c.environment=b.environment
  join vault.decrypted_secrets v on v.name=b.signing_secret_name
  where b.id=p_binding_id and b.environment=p_environment and b.deployed_trigger_id=p_trigger_id
    and b.pipedream_account_id=p_account_id and b.webhook_correlation_id=p_correlation_id
    and b.trigger_state in ('active','degraded') and c.pipedream_account_id=b.pipedream_account_id
    and b.configuration_revision=c.connection_revision and c.health_state not in ('not_connected','disconnected')
    and c.verification_reason is distinct from 'contractor_disconnected'
    and not p_trigger_id=any(b.retired_trigger_ids)
    and not exists(select 1 from public.booking_provider_account_disconnects_v3 d where d.profile_id=b.profile_id
      and d.environment=b.environment and d.provider_account_id=p_account_id and d.state in ('pending','completed'))
  limit 1
$$;

create or replace function public.ingest_pipedream_calendar_event(
  p_event_id text,p_environment text,p_binding_id uuid,p_account_id text,p_trigger_id text,
  p_correlation_id uuid,p_event_type text,p_payload_hash text,p_payload jsonb,p_signature_timestamp timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare b public.pipedream_bindings;event_row_id uuid;
begin
  perform 1 from public.calendar_connections where id=(select connection_id from public.pipedream_bindings where id=p_binding_id) for update;
  select * into strict b from public.pipedream_bindings where id=p_binding_id for update;
  if public.resolve_pipedream_trigger_signing_key(p_environment,p_binding_id,p_trigger_id,p_account_id,p_correlation_id) is null
  then raise exception 'Pipedream event identity is no longer authorized' using errcode='42501'; end if;
  insert into public.provider_event_inbox(provider,event_family,event_id,account_context,destination,api_version,
    livemode,environment,profile_id,event_type,payload_hash,payload,signature_timestamp,pipedream_binding_id,pipedream_trigger_id)
  values('pipedream','calendar',p_event_id,p_account_id,p_correlation_id::text,b.component_version,
    p_environment='live',p_environment,b.profile_id,p_event_type,p_payload_hash,p_payload,p_signature_timestamp,b.id,p_trigger_id)
  on conflict(provider,event_family,event_id,account_context,destination,api_version,livemode) do nothing;
  select id into strict event_row_id from public.provider_event_inbox where provider='pipedream' and event_family='calendar'
    and event_id=p_event_id and account_context=p_account_id and destination=p_correlation_id::text
    and api_version=b.component_version and livemode=(p_environment='live') and environment=p_environment
    and profile_id=b.profile_id and payload_hash=p_payload_hash and pipedream_binding_id=b.id and pipedream_trigger_id=p_trigger_id;
  return event_row_id;
end $$;

create or replace function public.apply_pipedream_calendar_event(
  p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare inbox public.provider_event_inbox;b public.pipedream_bindings;
begin
  select * into inbox from public.provider_event_inbox where id=p_event_id;
  perform 1 from public.calendar_connections where profile_id=inbox.profile_id and environment=inbox.environment for update;
  select * into b from public.pipedream_bindings where id=inbox.pipedream_binding_id for update;
  select * into strict inbox from public.provider_event_inbox where id=p_event_id for update;
  if p_lease_token is null or p_fencing_token is null or inbox.provider<>'pipedream' or inbox.event_family<>'calendar'
    or inbox.processing_state<>'processing' or inbox.lease_token is distinct from p_lease_token
    or inbox.fencing_token is distinct from p_fencing_token or inbox.lease_expires_at is null
    or inbox.lease_expires_at<=pg_catalog.clock_timestamp()
  then raise exception 'Stale Pipedream event fence' using errcode='40001'; end if;
  if inbox.destination is distinct from b.webhook_correlation_id::text or public.resolve_pipedream_trigger_signing_key(
    inbox.environment,b.id,inbox.pipedream_trigger_id,inbox.account_context,b.webhook_correlation_id) is null
  then raise exception 'Pipedream binding no longer correlates' using errcode='42501'; end if;
  update public.pipedream_bindings set last_event_at=greatest(coalesce(last_event_at,'epoch'),p_occurred_at),
    updated_at=pg_catalog.clock_timestamp() where id=b.id;
  -- Event receipt invalidates slot evidence; it is not independent health evidence.
  update public.calendar_connections set last_synchronized_at=null,updated_at=pg_catalog.clock_timestamp() where id=b.connection_id;
  update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),
    safe_error=null,lease_token=null,lease_expires_at=null where id=p_event_id;
  return true;
end $$;

-- New functions default to PUBLIC EXECUTE. Expose only the concrete service RPCs;
-- helper locks/authorization remain private, and booking_worker gains no raw access.
do $acl$
declare proc regprocedure;
begin
  for proc in select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'assert_google_calendar_owner','lock_google_calendar_binding','lock_google_calendar_disconnect','google_calendar_setup_configuration_key',
      'claim_saved_google_calendar_verification','claim_due_pipedream_bindings','mark_google_calendar_connection_verified',
      'mark_google_calendar_connection_unhealthy','fail_pipedream_binding_reconciliation','reserve_pipedream_trigger_deployment',
      'begin_pipedream_trigger_deployment_effect','adopt_pipedream_trigger_candidate','retire_pipedream_trigger',
      'record_pipedream_trigger_deployment_result',
      'authorize_pipedream_trigger_cleanup','complete_pipedream_stale_trigger_cleanup','settle_pipedream_binding_cleanup',
      'apply_pipedream_trigger_projection','authorize_google_calendar_connect_start','authorize_google_calendar_setup_read',
      'authorize_google_calendar_connect_completion','request_google_calendar_verification','google_calendar_setup_claim',
      'reserve_google_calendar_setup_probe','claim_google_calendar_setup_probe',
      'record_google_calendar_setup_read','restart_google_calendar_setup_probe',
      'authorize_google_calendar_setup_effect','settle_google_calendar_setup_probe','persist_google_calendar_configuration','reconcile_google_calendar_connection',
      'clear_google_calendar_connection','reserve_booking_provider_account_disconnect_v3','claim_booking_provider_account_disconnect_v3',
      'begin_booking_provider_account_disconnect_v3','fail_booking_provider_account_disconnect_v3',
      'complete_booking_provider_account_disconnect_v3','resolve_pipedream_trigger_signing_key',
      'ingest_pipedream_calendar_event','apply_pipedream_calendar_event'
    ])
  loop
    execute 'revoke all on function '||proc::text||' from public,anon,authenticated,service_role,booking_worker';
    if (select proname from pg_catalog.pg_proc where oid=proc::oid) not in (
      'assert_google_calendar_owner','lock_google_calendar_binding','lock_google_calendar_disconnect','google_calendar_setup_claim','google_calendar_setup_configuration_key'
    ) then execute 'grant execute on function '||proc::text||' to service_role'; end if;
  end loop;
end $acl$;
