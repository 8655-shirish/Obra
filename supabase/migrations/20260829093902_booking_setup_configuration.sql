-- Provider-independent setup progress and atomic shared availability saves.
-- This migration does not connect to or mark any external provider ready.

alter table public.website_entitlements
  add column if not exists order_confirmed_at timestamptz;

create or replace function public.acknowledge_booking_order(
  p_website_id uuid,
  p_profile_id uuid,
  p_environment text,
  p_auth_user_id uuid
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare confirmed_at timestamptz;
begin
  if p_auth_user_id is null or not exists (select 1 from public.profiles where id=p_profile_id and auth_user_id=p_auth_user_id) then
    raise exception 'forbidden';
  end if;

  update public.website_entitlements
     set order_confirmed_at = coalesce(order_confirmed_at, pg_catalog.clock_timestamp()),
         updated_at = pg_catalog.clock_timestamp()
   where website_id = p_website_id
     and profile_id = p_profile_id
     and environment = p_environment
     and plan = 'pro'
     and state in ('active','grace')
  returning order_confirmed_at into confirmed_at;

  if confirmed_at is null then raise exception 'pro entitlement not found'; end if;
  return confirmed_at;
end;
$$;
revoke all on function public.acknowledge_booking_order(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.acknowledge_booking_order(uuid,uuid,text,uuid) to service_role;

create or replace function public.save_shared_booking_availability(
  p_website_id uuid,
  p_profile_id uuid,
  p_environment text,
  p_auth_user_id uuid,
  p_service_revision bigint,
  p_schedule_revision bigint,
  p_service jsonb,
  p_schedule jsonb,
  p_intervals jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_row public.booking_services%rowtype;
  schedule_row public.availability_schedules%rowtype;
  interval_row jsonb;
  interval_count integer := 0;
begin
  if p_auth_user_id is null or not exists (select 1 from public.profiles where id=p_profile_id and auth_user_id=p_auth_user_id) then raise exception 'forbidden'; end if;
  if p_environment not in ('test','live') then raise exception 'invalid environment'; end if;
  if not exists (
    select 1 from public.website_entitlements e
    where e.website_id = p_website_id
      and e.profile_id = p_profile_id and e.environment = p_environment
      and e.plan = 'pro' and e.state in ('active','grace')
      and e.order_confirmed_at is not null
  ) then raise exception 'active pro entitlement required'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_schedule->>'timeZone') then
    raise exception 'invalid time zone';
  end if;
  if pg_catalog.jsonb_typeof(p_intervals) <> 'array' then raise exception 'invalid intervals'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text || ':' || p_environment || ':booking', 0));
  select * into service_row from public.booking_services where profile_id=p_profile_id and environment=p_environment for update;

  if found then
    if p_service_revision is null or service_row.revision <> p_service_revision then raise exception 'revision conflict'; end if;
    update public.booking_services set
      name=p_service->>'name', description=nullif(p_service->>'description',''),
      duration_minutes=(p_service->>'durationMinutes')::integer,
      slot_interval_minutes=(p_service->>'slotIntervalMinutes')::integer,
      buffer_before_minutes=(p_service->>'bufferBeforeMinutes')::integer,
      buffer_after_minutes=(p_service->>'bufferAfterMinutes')::integer,
      minimum_notice_minutes=(p_service->>'minimumNoticeMinutes')::integer,
      booking_horizon_days=(p_service->>'bookingHorizonDays')::integer,
      location_type=p_service->>'locationType', location_instructions=nullif(p_service->>'locationInstructions',''),
      amount_minor=(p_service->>'amountMinor')::bigint, currency='USD', payment_policy='full_amount',
      active=true, revision=revision+1, updated_at=pg_catalog.clock_timestamp()
    where id=service_row.id returning * into service_row;
  else
    if p_service_revision is not null then raise exception 'revision conflict'; end if;
    insert into public.booking_services(profile_id,environment,name,description,duration_minutes,slot_interval_minutes,
      buffer_before_minutes,buffer_after_minutes,minimum_notice_minutes,booking_horizon_days,location_type,
      location_instructions,amount_minor,currency,payment_policy,active)
    values(p_profile_id,p_environment,p_service->>'name',nullif(p_service->>'description',''),
      (p_service->>'durationMinutes')::integer,(p_service->>'slotIntervalMinutes')::integer,
      (p_service->>'bufferBeforeMinutes')::integer,(p_service->>'bufferAfterMinutes')::integer,
      (p_service->>'minimumNoticeMinutes')::integer,(p_service->>'bookingHorizonDays')::integer,
      p_service->>'locationType',nullif(p_service->>'locationInstructions',''),
      (p_service->>'amountMinor')::bigint,'USD','full_amount',true)
    returning * into service_row;
  end if;

  select * into schedule_row from public.availability_schedules where profile_id=p_profile_id and environment=p_environment for update;
  if found then
    if p_schedule_revision is null or schedule_row.revision <> p_schedule_revision then raise exception 'revision conflict'; end if;
    update public.availability_schedules set service_id=service_row.id, time_zone=p_schedule->>'timeZone',
      active=true, revision=revision+1, updated_at=pg_catalog.clock_timestamp()
    where id=schedule_row.id returning * into schedule_row;
  else
    if p_schedule_revision is not null then raise exception 'revision conflict'; end if;
    insert into public.availability_schedules(profile_id,service_id,environment,time_zone,active)
    values(p_profile_id,service_row.id,p_environment,p_schedule->>'timeZone',true) returning * into schedule_row;
  end if;

  delete from public.availability_intervals where schedule_id=schedule_row.id;
  for interval_row in select value from pg_catalog.jsonb_array_elements(p_intervals) loop
    interval_count := interval_count + 1;
    if interval_count > 50 then raise exception 'too many intervals'; end if;
    insert into public.availability_intervals(schedule_id,profile_id,environment,weekday,local_start,local_end,sort_order)
    values(schedule_row.id,p_profile_id,p_environment,(interval_row->>'weekday')::integer,
      (interval_row->>'localStart')::time,(interval_row->>'localEnd')::time,(interval_row->>'sortOrder')::integer);
  end loop;
  if interval_count = 0 then raise exception 'at least one interval is required'; end if;

  return pg_catalog.jsonb_build_object('serviceRevision',service_row.revision,'scheduleRevision',schedule_row.revision);
end;
$$;
revoke all on function public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb) to service_role;
