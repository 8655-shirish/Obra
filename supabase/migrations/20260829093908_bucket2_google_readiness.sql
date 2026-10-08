-- Bucket 2 Google Calendar provider-readiness foundation.
-- Provider transport, Pipedream payloads, triggers, signatures, and live booking remain out of scope.

alter table public.calendar_connections
  add column if not exists account_email text,
  add column if not exists account_display_name text,
  add column if not exists connection_revision bigint not null default 1 check (connection_revision > 0),
  add column if not exists verification_reason text;

alter table public.calendar_connections
  drop constraint if exists calendar_connections_verification_reason_check,
  add constraint calendar_connections_verification_reason_check check (verification_reason is null or verification_reason in (
    'contractor_disconnected','provider_account_unhealthy','provider_account_missing',
    'calendar_permissions_changed','calendar_selection_invalid','verification_stale'
  ));

alter table public.calendar_selections
  add column if not exists permission_verified_at timestamptz;

alter table public.calendar_selections
  drop constraint if exists calendar_selections_blocking_readable_check,
  add constraint calendar_selections_blocking_readable_check check (
    not (active and blocks_availability)
    or coalesce(access_role in ('freeBusyReader','reader','writer','owner'),false)
  ),
  drop constraint if exists calendar_selections_destination_writable_check,
  add constraint calendar_selections_destination_writable_check check (
    not (active and receives_bookings)
    or coalesce(access_role in ('writer','owner'),false)
  );

create or replace function public.assert_google_calendar_selection_invariants(
  p_connection_id uuid,
  p_profile_id uuid,
  p_environment text
) returns void
language plpgsql security definer set search_path='' as $$
declare blocking_count integer; destination_count integer;
begin
  select
    count(*) filter (where active and blocks_availability and access_role in ('freeBusyReader','reader','writer','owner')),
    count(*) filter (where active and receives_bookings and access_role in ('writer','owner'))
  into blocking_count,destination_count
  from public.calendar_selections
  where connection_id=p_connection_id and profile_id=p_profile_id and environment=p_environment;
  if blocking_count < 1 then raise exception using errcode='23514',message='At least one readable blocking calendar is required'; end if;
  if destination_count <> 1 then raise exception using errcode='23514',message='Exactly one writable booking destination is required'; end if;
end$$;

create or replace function public.persist_google_calendar_configuration(
  p_profile_id uuid,
  p_environment text,
  p_actor_auth_user_id uuid,
  p_external_user_id text,
  p_pipedream_account_id text,
  p_account_email text,
  p_account_display_name text,
  p_calendars jsonb,
  p_verified_at timestamptz,
  p_expected_revision bigint
) returns public.calendar_connections
language plpgsql security definer set search_path='' as $$
declare connection public.calendar_connections; item jsonb; calendar_id text; role text;
begin
  if not exists(select 1 from public.profiles p where p.id=p_profile_id and p.environment=p_environment and p.auth_user_id=p_actor_auth_user_id)
    then raise exception using errcode='42501',message='Contractor is not authorized for this profile'; end if;
  if p_environment not in ('test','live') or nullif(btrim(p_external_user_id),'') is null or nullif(btrim(p_pipedream_account_id),'') is null
    or p_verified_at is null or p_verified_at > pg_catalog.clock_timestamp()+interval '1 minute'
    or jsonb_typeof(p_calendars) <> 'array'
    then raise exception using errcode='22023',message='Invalid Google calendar verification'; end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode='22023',message='Expected Google calendar revision is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text || ':' || p_environment || ':google-calendar',0));
  select * into connection from public.calendar_connections
  where profile_id=p_profile_id and environment=p_environment for update;
  if (found and (p_expected_revision=0 or connection.connection_revision<>p_expected_revision))
     or (not found and p_expected_revision<>0) then
    raise exception using errcode='40001',message='Google calendar configuration changed';
  end if;

  insert into public.calendar_connections(profile_id,environment,external_user_id,pipedream_account_id,account_email,account_display_name,health_state,reconnect_reason,verification_reason,last_verified_at,last_synchronized_at,disconnected_at)
  values(p_profile_id,p_environment,btrim(p_external_user_id),btrim(p_pipedream_account_id),nullif(btrim(p_account_email),''),nullif(btrim(p_account_display_name),''),'pending',null,null,p_verified_at,p_verified_at,null)
  on conflict(profile_id,environment) do update set
    external_user_id=excluded.external_user_id,pipedream_account_id=excluded.pipedream_account_id,
    account_email=excluded.account_email,account_display_name=excluded.account_display_name,
    health_state='pending',reconnect_reason=null,verification_reason=null,last_verified_at=excluded.last_verified_at,
    last_synchronized_at=excluded.last_synchronized_at,disconnected_at=null,
    connection_revision=public.calendar_connections.connection_revision+1,updated_at=pg_catalog.clock_timestamp()
  returning * into connection;

  update public.calendar_selections set active=false,blocks_availability=false,receives_bookings=false,updated_at=pg_catalog.clock_timestamp() where connection_id=connection.id;
  for item in select value from jsonb_array_elements(p_calendars) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') <> 'string' or jsonb_typeof(item->'displayName') <> 'string'
      or jsonb_typeof(item->'accessRole') <> 'string' or jsonb_typeof(item->'blocksAvailability') <> 'boolean'
      or jsonb_typeof(item->'receivesBookings') <> 'boolean'
      then raise exception using errcode='22023',message='Invalid selected calendar'; end if;
    calendar_id:=nullif(btrim(item->>'id'),''); role:=item->>'accessRole';
    if calendar_id is null or role not in ('freeBusyReader','reader','writer','owner')
      then raise exception using errcode='22023',message='Invalid selected calendar permission'; end if;
    insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,access_role,time_zone,blocks_availability,receives_bookings,active,permission_verified_at)
    values(connection.id,p_profile_id,p_environment,calendar_id,btrim(item->>'displayName'),role,nullif(btrim(item->>'timeZone'),''),(item->>'blocksAvailability')::boolean,(item->>'receivesBookings')::boolean,true,p_verified_at)
    on conflict(connection_id,google_calendar_id) do update set
      display_name=excluded.display_name,access_role=excluded.access_role,time_zone=excluded.time_zone,
      blocks_availability=excluded.blocks_availability,receives_bookings=excluded.receives_bookings,
      active=true,permission_verified_at=excluded.permission_verified_at,updated_at=pg_catalog.clock_timestamp();
  end loop;
  perform public.assert_google_calendar_selection_invariants(connection.id,p_profile_id,p_environment);
  update public.calendar_connections set health_state='healthy',verification_reason=null,updated_at=pg_catalog.clock_timestamp()
  where id=connection.id returning * into connection;
  return connection;
end$$;

create or replace function public.reconcile_google_calendar_connection(
  p_profile_id uuid,
  p_environment text,
  p_actor_auth_user_id uuid,
  p_expected_revision bigint,
  p_health_state text,
  p_reason text,
  p_verified_at timestamptz
) returns public.calendar_connections
language plpgsql security definer set search_path='' as $$
declare connection public.calendar_connections;
begin
  if not exists(select 1 from public.profiles p where p.id=p_profile_id and p.environment=p_environment and p.auth_user_id=p_actor_auth_user_id)
    then raise exception using errcode='42501',message='Contractor is not authorized for this profile'; end if;
  if p_health_state not in ('healthy','degraded','disconnected') or p_verified_at is null or p_verified_at > pg_catalog.clock_timestamp()+interval '1 minute'
    or (p_reason is not null and p_reason not in ('provider_account_unhealthy','provider_account_missing','calendar_permissions_changed','calendar_selection_invalid','verification_stale'))
    then raise exception using errcode='22023',message='Invalid reconciliation result'; end if;
  select * into connection from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if not found then raise exception using errcode='P0002',message='Google calendar connection not found'; end if;
  if connection.connection_revision <> p_expected_revision then raise exception using errcode='40001',message='Google calendar configuration changed'; end if;
  if p_health_state='healthy' then
    perform public.assert_google_calendar_selection_invariants(connection.id,p_profile_id,p_environment);
  elsif nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='A safe degraded or disconnected reason is required';
  end if;
  update public.calendar_connections set health_state=p_health_state,
    verification_reason=case when p_health_state='healthy' then null else btrim(p_reason) end,
    reconnect_reason=case when p_health_state='disconnected' then btrim(p_reason) else null end,
    last_verified_at=p_verified_at,disconnected_at=case when p_health_state='disconnected' then p_verified_at else null end,
    connection_revision=connection_revision+1,updated_at=pg_catalog.clock_timestamp()
  where id=connection.id returning * into connection;
  return connection;
end$$;

create or replace function public.clear_google_calendar_connection(
  p_profile_id uuid,p_environment text,p_actor_auth_user_id uuid,p_expected_revision bigint
) returns public.calendar_connections
language plpgsql security definer set search_path='' as $$
declare connection public.calendar_connections;
begin
  if not exists(select 1 from public.profiles p where p.id=p_profile_id and p.environment=p_environment and p.auth_user_id=p_actor_auth_user_id)
    then raise exception using errcode='42501',message='Contractor is not authorized for this profile'; end if;
  select * into connection from public.calendar_connections where profile_id=p_profile_id and environment=p_environment for update;
  if not found then raise exception using errcode='P0002',message='Google calendar connection not found'; end if;
  if connection.connection_revision <> p_expected_revision then raise exception using errcode='40001',message='Google calendar configuration changed'; end if;
  update public.calendar_selections set active=false,blocks_availability=false,receives_bookings=false,updated_at=pg_catalog.clock_timestamp() where connection_id=connection.id;
  update public.calendar_connections set pipedream_account_id=null,account_email=null,account_display_name=null,
    identity_metadata='{}'::jsonb,health_state='disconnected',verification_reason='contractor_disconnected',reconnect_reason='contractor_disconnected',
    last_verified_at=pg_catalog.clock_timestamp(),last_synchronized_at=null,disconnected_at=pg_catalog.clock_timestamp(),
    connection_revision=connection_revision+1,updated_at=pg_catalog.clock_timestamp()
  where id=connection.id returning * into connection;
  return connection;
end$$;

revoke all on function public.assert_google_calendar_selection_invariants(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.persist_google_calendar_configuration(uuid,text,uuid,text,text,text,text,jsonb,timestamptz,bigint) from public,anon,authenticated;
revoke all on function public.reconcile_google_calendar_connection(uuid,text,uuid,bigint,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.clear_google_calendar_connection(uuid,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.persist_google_calendar_configuration(uuid,text,uuid,text,text,text,text,jsonb,timestamptz,bigint) to service_role;
grant execute on function public.reconcile_google_calendar_connection(uuid,text,uuid,bigint,text,text,timestamptz) to service_role;
grant execute on function public.clear_google_calendar_connection(uuid,text,uuid,bigint) to service_role;
