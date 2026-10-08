-- Provider-verified Pipedream trigger lifecycle. The signing key is stored only in Vault.
alter table public.pipedream_bindings
  add column if not exists webhook_id text,
  add column if not exists signing_secret_name text,
  add column if not exists provider_updated_at timestamptz,
  add column if not exists reconciliation_due_at timestamptz,
  add column if not exists reconciliation_lease_token uuid,
  add column if not exists reconciliation_lease_expires_at timestamptz,
  add column if not exists reconciliation_fencing_token bigint not null default 0,
  add column if not exists deployment_operation_id uuid,
  add column if not exists deployment_lease_expires_at timestamptz,
  add column if not exists deployment_expected_connection_revision bigint,
  add column if not exists reconciliation_attempts integer not null default 0 check (reconciliation_attempts>=0);

create unique index if not exists pipedream_bindings_trigger_environment_uidx
  on public.pipedream_bindings(environment,deployed_trigger_id)
  where deployed_trigger_id is not null;

create or replace function public.reserve_pipedream_trigger_deployment(
  p_profile_id uuid,p_environment text,p_connection_id uuid,p_pipedream_account_id text,p_expected_connection_revision bigint
) returns public.pipedream_bindings language plpgsql security definer set search_path='' as $$
declare connection public.calendar_connections; result public.pipedream_bindings; operation_id uuid:=gen_random_uuid();
begin
  if p_environment not in ('test','live') or p_expected_connection_revision is null or p_expected_connection_revision<1 then
    raise exception using errcode='22023',message='Invalid Pipedream deployment reservation'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':google-calendar',0));
  select * into strict connection from public.calendar_connections where id=p_connection_id and profile_id=p_profile_id
    and environment=p_environment and pipedream_account_id=p_pipedream_account_id and health_state='healthy' for update;
  if connection.connection_revision<>p_expected_connection_revision then
    raise exception using errcode='40001',message='Google calendar configuration changed'; end if;
  perform public.assert_google_calendar_selection_invariants(connection.id,p_profile_id,p_environment);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':pipedream-trigger',0));
  select * into result from public.pipedream_bindings where profile_id=p_profile_id and environment=p_environment for update;
  if found and result.deployment_lease_expires_at>pg_catalog.clock_timestamp() then
    raise exception using errcode='55P03',message='A Pipedream deployment is already in progress'; end if;
  insert into public.pipedream_bindings(id,profile_id,connection_id,environment,component_key,component_version,pipedream_account_id,
    selected_calendar_ids,webhook_correlation_id,trigger_state,configuration_revision,safe_error,deployment_operation_id,
    deployment_lease_expires_at,deployment_expected_connection_revision)
  values(coalesce(result.id,gen_random_uuid()),p_profile_id,p_connection_id,p_environment,'google_calendar-new-or-updated-event-instant',
    'pending',p_pipedream_account_id,(select jsonb_agg(s.google_calendar_id order by s.google_calendar_id)
      from public.calendar_selections s where s.connection_id=p_connection_id and s.profile_id=p_profile_id
        and s.environment=p_environment and s.active and s.blocks_availability),
    coalesce(result.webhook_correlation_id,gen_random_uuid()),'deploying',
    coalesce(result.configuration_revision,1),'Pipedream deployment is in progress',operation_id,
    pg_catalog.clock_timestamp()+interval '2 minutes',p_expected_connection_revision)
  on conflict(profile_id,environment) do update set
    connection_id=case when public.pipedream_bindings.deployed_trigger_id is null then excluded.connection_id else public.pipedream_bindings.connection_id end,
    pipedream_account_id=case when public.pipedream_bindings.deployed_trigger_id is null then excluded.pipedream_account_id else public.pipedream_bindings.pipedream_account_id end,
    trigger_state=case when public.pipedream_bindings.deployed_trigger_id is null then 'deploying' else public.pipedream_bindings.trigger_state end,
    safe_error=excluded.safe_error,deployment_operation_id=excluded.deployment_operation_id,
    deployment_lease_expires_at=excluded.deployment_lease_expires_at,
    deployment_expected_connection_revision=excluded.deployment_expected_connection_revision,
    reconciliation_lease_token=null,reconciliation_lease_expires_at=null,
    reconciliation_fencing_token=public.pipedream_bindings.reconciliation_fencing_token+1,
    updated_at=pg_catalog.clock_timestamp()
  returning * into result;
  return result;
end $$;
revoke all on function public.reserve_pipedream_trigger_deployment(uuid,text,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.reserve_pipedream_trigger_deployment(uuid,text,uuid,text,bigint) to service_role;

create or replace function public.apply_pipedream_trigger_projection(
  p_binding_id uuid,p_webhook_correlation_id uuid,p_profile_id uuid,p_environment text,p_connection_id uuid,p_pipedream_account_id text,
  p_component_key text,p_component_version text,p_selected_calendar_ids jsonb,
  p_deployed_trigger_id text,p_webhook_id text,p_signing_key text,p_active boolean,
  p_provider_updated_at timestamptz,p_safe_error text,p_lease_token uuid default null,p_fencing_token bigint default null,
  p_deployment_operation_id uuid default null,p_expected_connection_revision bigint default null
) returns public.pipedream_bindings language plpgsql security definer set search_path='' as $$
declare result public.pipedream_bindings; existing public.pipedream_bindings; correlation uuid; secret_name text;
begin
  if p_binding_id is null or p_webhook_correlation_id is null or p_environment not in ('test','live') or nullif(btrim(p_component_key),'') is null
    or nullif(btrim(p_component_version),'') is null or nullif(btrim(p_pipedream_account_id),'') is null
    or jsonb_typeof(p_selected_calendar_ids)<>'array' or jsonb_array_length(p_selected_calendar_ids)<1
    or (p_active and (nullif(btrim(p_deployed_trigger_id),'') is null or nullif(btrim(p_signing_key),'') is null))
    or p_provider_updated_at is null or p_provider_updated_at>pg_catalog.clock_timestamp()+interval '1 minute'
  then raise exception using errcode='22023',message='Invalid Pipedream trigger projection'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':google-calendar',0));
  perform 1 from public.calendar_connections c where c.id=p_connection_id and c.profile_id=p_profile_id
      and c.environment=p_environment and c.pipedream_account_id=p_pipedream_account_id and c.health_state='healthy' for update;
  if not found then raise exception using errcode='23514',message='Verified Google connection is required'; end if;
  if (select count(*) from jsonb_array_elements_text(p_selected_calendar_ids)) <>
       (select count(distinct x) from jsonb_array_elements_text(p_selected_calendar_ids) x)
    or exists(select 1 from jsonb_array_elements_text(p_selected_calendar_ids) x
      where not exists(select 1 from public.calendar_selections s where s.connection_id=p_connection_id
        and s.profile_id=p_profile_id and s.environment=p_environment and s.google_calendar_id=x and s.active and s.blocks_availability))
    or exists(select 1 from public.calendar_selections s where s.connection_id=p_connection_id
      and s.profile_id=p_profile_id and s.environment=p_environment and s.active and s.blocks_availability
      and not p_selected_calendar_ids ? s.google_calendar_id)
  then raise exception using errcode='23514',message='Pipedream trigger calendars must exactly match verified blocking calendars'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':pipedream-trigger',0));
  select * into existing from public.pipedream_bindings where profile_id=p_profile_id and environment=p_environment for update;
  if existing.id is not null and (existing.id<>p_binding_id or existing.webhook_correlation_id<>p_webhook_correlation_id) then
    raise exception using errcode='40001',message='Pipedream binding identity changed';
  end if;
  if existing.deployment_operation_id is not null and p_deployment_operation_id is null then
    raise exception using errcode='55P03',message='Pipedream deployment is in progress';
  end if;
  if p_deployment_operation_id is not null or p_expected_connection_revision is not null then
    if existing.deployment_operation_id is distinct from p_deployment_operation_id
      or existing.deployment_expected_connection_revision is distinct from p_expected_connection_revision
      or existing.deployment_lease_expires_at<=pg_catalog.clock_timestamp()
      or (select connection_revision from public.calendar_connections where id=p_connection_id)<>p_expected_connection_revision then
      raise exception using errcode='40001',message='Pipedream deployment reservation lost';
    end if;
  end if;
  if p_lease_token is not null or p_fencing_token is not null then
    if existing.reconciliation_lease_token is distinct from p_lease_token
      or existing.reconciliation_fencing_token is distinct from p_fencing_token
      or existing.reconciliation_lease_expires_at<=pg_catalog.clock_timestamp() then
      raise exception using errcode='40001',message='Pipedream reconciliation lease lost';
    end if;
  end if;
  correlation:=p_webhook_correlation_id;
  secret_name:='PIPEDREAM_TRIGGER_'||upper(p_environment)||'_'||replace(p_profile_id::text,'-','');
  if p_active then
    if exists(select 1 from vault.decrypted_secrets where name=secret_name) then
      perform vault.update_secret((select id from vault.decrypted_secrets where name=secret_name limit 1),p_signing_key,secret_name,'Pipedream trigger webhook signing key');
    else
      perform vault.create_secret(p_signing_key,secret_name,'Pipedream trigger webhook signing key');
    end if;
  end if;
  insert into public.pipedream_bindings(id,profile_id,connection_id,environment,deployed_trigger_id,component_key,
    component_version,pipedream_account_id,selected_calendar_ids,webhook_correlation_id,trigger_state,
    configuration_revision,last_health_at,safe_error,webhook_id,signing_secret_name,provider_updated_at,reconciliation_due_at)
  values(coalesce(existing.id,p_binding_id),p_profile_id,p_connection_id,p_environment,p_deployed_trigger_id,p_component_key,p_component_version,
    p_pipedream_account_id,p_selected_calendar_ids,correlation,case when p_active then 'active' else 'degraded' end,
    coalesce(existing.configuration_revision+1,1),case when p_active then pg_catalog.clock_timestamp() else existing.last_health_at end,p_safe_error,p_webhook_id,
    case when p_active then secret_name else existing.signing_secret_name end,p_provider_updated_at,
    pg_catalog.clock_timestamp()+interval '10 minutes')
  on conflict(profile_id,environment) do update set connection_id=excluded.connection_id,
    deployed_trigger_id=excluded.deployed_trigger_id,component_key=excluded.component_key,
    component_version=excluded.component_version,pipedream_account_id=excluded.pipedream_account_id,
    selected_calendar_ids=excluded.selected_calendar_ids,trigger_state=excluded.trigger_state,
    configuration_revision=excluded.configuration_revision,last_health_at=excluded.last_health_at,
    safe_error=excluded.safe_error,webhook_id=excluded.webhook_id,signing_secret_name=excluded.signing_secret_name,
    provider_updated_at=excluded.provider_updated_at,reconciliation_due_at=excluded.reconciliation_due_at,
    reconciliation_lease_token=null,reconciliation_lease_expires_at=null,
    reconciliation_attempts=case when excluded.trigger_state='active' then 0 else public.pipedream_bindings.reconciliation_attempts end,
    deployment_operation_id=null,
    deployment_lease_expires_at=null,deployment_expected_connection_revision=null,updated_at=pg_catalog.clock_timestamp()
  returning * into result;
  return result;
end $$;
revoke all on function public.apply_pipedream_trigger_projection(uuid,uuid,uuid,text,uuid,text,text,text,jsonb,text,text,text,boolean,timestamptz,text,uuid,bigint,uuid,bigint) from public,anon,authenticated;
grant execute on function public.apply_pipedream_trigger_projection(uuid,uuid,uuid,text,uuid,text,text,text,jsonb,text,text,text,boolean,timestamptz,text,uuid,bigint,uuid,bigint) to service_role;

create or replace function public.resolve_pipedream_trigger_signing_key(
  p_environment text,p_binding_id uuid,p_trigger_id text,p_account_id text,p_correlation_id uuid
) returns text language sql security definer set search_path='' as $$
  select v.decrypted_secret from public.pipedream_bindings b
  join vault.decrypted_secrets v on v.name=b.signing_secret_name
  where b.id=p_binding_id and b.environment=p_environment and b.deployed_trigger_id=p_trigger_id
    and b.pipedream_account_id=p_account_id and b.webhook_correlation_id=p_correlation_id
    and b.trigger_state='active' and b.signing_secret_name is not null limit 1
$$;
revoke all on function public.resolve_pipedream_trigger_signing_key(text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.resolve_pipedream_trigger_signing_key(text,uuid,text,text,uuid) to service_role;

create or replace function public.claim_due_pipedream_bindings(p_lease_token uuid,p_limit integer default 25)
returns setof public.pipedream_bindings language plpgsql security definer set search_path='' as $$
begin
  if p_lease_token is null then raise exception using errcode='22023',message='Lease token required'; end if;
  return query with due as (select id from public.pipedream_bindings where deployed_trigger_id is not null
      and reconciliation_due_at is not null and reconciliation_due_at<=pg_catalog.clock_timestamp()
      and (deployment_lease_expires_at is null or deployment_lease_expires_at<=pg_catalog.clock_timestamp())
      and (reconciliation_lease_expires_at is null or reconciliation_lease_expires_at<=pg_catalog.clock_timestamp())
      order by reconciliation_due_at nulls first for update skip locked limit greatest(1,least(coalesce(p_limit,25),100)))
    update public.pipedream_bindings b set reconciliation_lease_token=p_lease_token,
      reconciliation_lease_expires_at=pg_catalog.clock_timestamp()+interval '10 minutes',
      reconciliation_fencing_token=b.reconciliation_fencing_token+1,
      reconciliation_attempts=b.reconciliation_attempts+1 from due where b.id=due.id returning b.*;
end $$;
revoke all on function public.claim_due_pipedream_bindings(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_due_pipedream_bindings(uuid,integer) to service_role;


create or replace function public.invalidate_pipedream_binding_for_calendar_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.pipedream_bindings set trigger_state='degraded',safe_error='Google calendar configuration changed',
    last_health_at=null,reconciliation_due_at=case when deployed_trigger_id is null then null else pg_catalog.clock_timestamp() end,
    reconciliation_lease_token=null,reconciliation_lease_expires_at=null,
    reconciliation_fencing_token=reconciliation_fencing_token+1,deployment_operation_id=null,
    deployment_lease_expires_at=null,deployment_expected_connection_revision=null,updated_at=pg_catalog.clock_timestamp()
  where connection_id=new.id and profile_id=new.profile_id and environment=new.environment
    and (pipedream_account_id is distinct from new.pipedream_account_id or old.connection_revision is distinct from new.connection_revision);
  return new;
end $$;
revoke all on function public.invalidate_pipedream_binding_for_calendar_change() from public,anon,authenticated;
drop trigger if exists calendar_connection_invalidate_pipedream_binding on public.calendar_connections;
create trigger calendar_connection_invalidate_pipedream_binding after update of pipedream_account_id,connection_revision
on public.calendar_connections for each row execute function public.invalidate_pipedream_binding_for_calendar_change();


create or replace function public.fail_pipedream_binding_reconciliation(
  p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_safe_error text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.pipedream_bindings set trigger_state='degraded',last_health_at=null,
    safe_error=case when reconciliation_attempts>=8 then 'Pipedream trigger reconciliation exhausted: '||
      left(coalesce(nullif(btrim(p_safe_error),''),'provider verification failed'),430) else
      left(coalesce(nullif(btrim(p_safe_error),''),'Pipedream trigger reconciliation failed'),500) end,
    reconciliation_due_at=case when reconciliation_attempts>=8 then null else
      pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*(2^least(reconciliation_attempts,7))::integer)) end,
    reconciliation_lease_token=null,reconciliation_lease_expires_at=null,updated_at=pg_catalog.clock_timestamp()
  where id=p_binding_id and reconciliation_lease_token=p_lease_token
    and reconciliation_fencing_token=p_fencing_token and reconciliation_lease_expires_at>pg_catalog.clock_timestamp();
  return found;
end $$;
revoke all on function public.fail_pipedream_binding_reconciliation(uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.fail_pipedream_binding_reconciliation(uuid,uuid,bigint,text) to service_role;


create or replace function public.fail_pipedream_trigger_deployment(
  p_binding_id uuid,p_deployment_operation_id uuid,p_safe_error text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.pipedream_bindings set trigger_state='degraded',last_health_at=null,
    safe_error=left(coalesce(nullif(btrim(p_safe_error),''),'Pipedream trigger deployment failed'),500),
    reconciliation_due_at=case when deployed_trigger_id is null then null else pg_catalog.clock_timestamp() end,
    deployment_operation_id=null,deployment_lease_expires_at=null,deployment_expected_connection_revision=null,
    updated_at=pg_catalog.clock_timestamp()
  where id=p_binding_id and deployment_operation_id=p_deployment_operation_id;
  return found;
end $$;
revoke all on function public.fail_pipedream_trigger_deployment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fail_pipedream_trigger_deployment(uuid,uuid,text) to service_role;


create or replace function public.complete_pipedream_stale_trigger_cleanup(
  p_profile_id uuid,p_environment text,p_deployed_trigger_id text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.pipedream_bindings set trigger_state='not_deployed',deployed_trigger_id=null,webhook_id=null,
    signing_secret_name=null,provider_updated_at=null,reconciliation_due_at=null,safe_error=null,
    updated_at=pg_catalog.clock_timestamp()
  where profile_id=p_profile_id and environment=p_environment and deployed_trigger_id=p_deployed_trigger_id
    and trigger_state='degraded';
  return found;
end $$;
revoke all on function public.complete_pipedream_stale_trigger_cleanup(uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_pipedream_stale_trigger_cleanup(uuid,text,text) to service_role;


create or replace function public.mark_google_calendar_connection_unhealthy(
 p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_disconnected boolean,p_reason text
) returns boolean language plpgsql security definer set search_path='' as $$
declare binding public.pipedream_bindings;
begin
 if p_reason not in ('provider_account_unhealthy','provider_account_missing','calendar_permissions_changed') then
  raise exception using errcode='22023',message='Invalid Google provider health reason'; end if;
 select * into binding from public.pipedream_bindings where id=p_binding_id and reconciliation_lease_token=p_lease_token
  and reconciliation_fencing_token=p_fencing_token and reconciliation_lease_expires_at>pg_catalog.clock_timestamp() for update;
 if not found then return false; end if;
 update public.calendar_connections set health_state=case when p_disconnected then 'disconnected' else 'degraded' end,
  verification_reason=p_reason,reconnect_reason=case when p_disconnected then p_reason else null end,
  last_verified_at=pg_catalog.clock_timestamp(),disconnected_at=case when p_disconnected then pg_catalog.clock_timestamp() else null end,
  connection_revision=connection_revision+1,updated_at=pg_catalog.clock_timestamp()
 where id=binding.connection_id and profile_id=binding.profile_id and environment=binding.environment;
 return found;
end $$;
revoke all on function public.mark_google_calendar_connection_unhealthy(uuid,uuid,bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.mark_google_calendar_connection_unhealthy(uuid,uuid,bigint,boolean,text) to service_role;


create or replace function public.mark_google_calendar_connection_verified(
 p_binding_id uuid,p_lease_token uuid,p_fencing_token bigint,p_verified_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare binding public.pipedream_bindings;
begin
 if p_verified_at is null or p_verified_at>pg_catalog.clock_timestamp()+interval '1 minute' then
  raise exception using errcode='22023',message='Invalid Google verification timestamp'; end if;
 select * into binding from public.pipedream_bindings where id=p_binding_id and reconciliation_lease_token=p_lease_token
  and reconciliation_fencing_token=p_fencing_token and reconciliation_lease_expires_at>pg_catalog.clock_timestamp() for update;
 if not found then return false; end if;
 perform public.assert_google_calendar_selection_invariants(binding.connection_id,binding.profile_id,binding.environment);
 update public.calendar_connections set health_state='healthy',verification_reason=null,reconnect_reason=null,
  last_verified_at=p_verified_at,last_synchronized_at=p_verified_at,disconnected_at=null,updated_at=pg_catalog.clock_timestamp()
 where id=binding.connection_id and profile_id=binding.profile_id and environment=binding.environment
  and pipedream_account_id=binding.pipedream_account_id;
 if not found then return false; end if;
 update public.calendar_selections set permission_verified_at=p_verified_at,updated_at=pg_catalog.clock_timestamp()
 where connection_id=binding.connection_id and profile_id=binding.profile_id and environment=binding.environment and active;
 return true;
end $$;
revoke all on function public.mark_google_calendar_connection_verified(uuid,uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.mark_google_calendar_connection_verified(uuid,uuid,bigint,timestamptz) to service_role;
