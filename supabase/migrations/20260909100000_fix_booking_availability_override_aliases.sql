-- Keep override validation unambiguous under PL/pgSQL's default variable_conflict=error.
-- CREATE OR REPLACE preserves the existing owner and service-only EXECUTE privileges.
create or replace function public.save_shared_booking_availability(
  p_website_id uuid,
  p_profile_id uuid,
  p_environment text,
  p_auth_user_id uuid,
  p_service_revision bigint,
  p_schedule_revision bigint,
  p_service jsonb,
  p_schedule jsonb,
  p_intervals jsonb,
  p_overrides jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_schedule_id uuid;
  v_override jsonb;
  v_override_interval jsonb;
  v_override_id uuid;
  v_override_count integer := 0;
  v_override_interval_count integer := 0;
begin
  if not exists (
    select 1 from public.website_entitlements
    where website_id = p_website_id and profile_id = p_profile_id and environment = p_environment
      and plan = 'pro' and state in ('active', 'grace')
      and effective_at is not null and effective_at <= pg_catalog.clock_timestamp()
      and (ends_at is null or ends_at > pg_catalog.clock_timestamp())
  ) then
    raise exception 'active Pro website entitlement required' using errcode = 'P0001';
  end if;

  if p_overrides is null or pg_catalog.jsonb_typeof(p_overrides) <> 'array' then
    raise exception 'invalid overrides' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_overrides) > 120 then
    raise exception 'too many overrides' using errcode = '22023';
  end if;
  if (
    select count(*)
    from pg_catalog.jsonb_array_elements(p_overrides) as override_rows(override_value)
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(override_rows.override_value->'intervals') = 'array'
        then override_rows.override_value->'intervals' else '[]'::jsonb end
    ) as interval_rows(interval_value)
  ) > 500 then
    raise exception 'too many override intervals' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_overrides) as override_rows(override_value)
    where pg_catalog.jsonb_typeof(override_rows.override_value) <> 'object'
      or override_rows.override_value->>'localDate' is null
      or pg_catalog.lower(pg_catalog.btrim(override_rows.override_value->>'localDate')) in ('infinity', '-infinity')
      or override_rows.override_value->>'type' is null
      or override_rows.override_value->>'type' not in ('unavailable', 'custom_hours')
      or pg_catalog.jsonb_typeof(override_rows.override_value->'intervals') is distinct from 'array'
      or (override_rows.override_value->>'type' = 'unavailable'
        and pg_catalog.jsonb_array_length(override_rows.override_value->'intervals') <> 0)
      or (override_rows.override_value->>'type' = 'custom_hours'
        and pg_catalog.jsonb_array_length(override_rows.override_value->'intervals') = 0)
  ) then
    raise exception 'invalid override shape' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_overrides) as override_rows(override_value)
    cross join lateral pg_catalog.jsonb_array_elements(override_rows.override_value->'intervals') as interval_rows(interval_value)
    where pg_catalog.jsonb_typeof(interval_rows.interval_value) <> 'object'
      or interval_rows.interval_value->>'localStart' is null
      or interval_rows.interval_value->>'localEnd' is null
      or interval_rows.interval_value->>'sortOrder' is null
  ) then
    raise exception 'invalid override interval shape' using errcode = '22023';
  end if;
  begin
    perform (override_rows.override_value->>'localDate')::date
    from pg_catalog.jsonb_array_elements(p_overrides) as override_rows(override_value);
    perform (interval_rows.interval_value->>'localStart')::time,
      (interval_rows.interval_value->>'localEnd')::time,
      (interval_rows.interval_value->>'sortOrder')::integer
    from pg_catalog.jsonb_array_elements(p_overrides) as override_rows(override_value)
    cross join lateral pg_catalog.jsonb_array_elements(override_rows.override_value->'intervals') as interval_rows(interval_value);
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'invalid override scalar value' using errcode = '22023';
  end;

  v_result := public.save_shared_booking_availability_base(
    p_website_id, p_profile_id, p_environment, p_auth_user_id, p_service_revision, p_schedule_revision,
    p_service, p_schedule, p_intervals
  );
  select id into strict v_schedule_id
  from public.availability_schedules where profile_id = p_profile_id and environment = p_environment;
  delete from public.availability_overrides where schedule_id = v_schedule_id;

  for v_override in
    select override_rows.override_value
    from pg_catalog.jsonb_array_elements(p_overrides) as override_rows(override_value)
  loop
    v_override_count := v_override_count + 1;
    if v_override_count > 120 then
      raise exception 'too many overrides' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_override) <> 'object' or v_override->>'localDate' is null
      or v_override->>'type' is null or v_override->>'type' not in ('unavailable', 'custom_hours')
      or pg_catalog.jsonb_typeof(v_override->'intervals') is distinct from 'array' then
      raise exception 'invalid override shape' using errcode = '22023';
    end if;
    if (v_override->>'type' = 'unavailable' and pg_catalog.jsonb_array_length(v_override->'intervals') <> 0)
      or (v_override->>'type' = 'custom_hours' and pg_catalog.jsonb_array_length(v_override->'intervals') = 0) then
      raise exception 'invalid override intervals' using errcode = '22023';
    end if;
    insert into public.availability_overrides(schedule_id, profile_id, environment, local_date, override_type, reason)
    values(v_schedule_id, p_profile_id, p_environment, (v_override->>'localDate')::date,
      v_override->>'type', nullif(v_override->>'reason', ''))
    returning id into v_override_id;

    for v_override_interval in
      select interval_rows.interval_value
      from pg_catalog.jsonb_array_elements(v_override->'intervals') as interval_rows(interval_value)
    loop
      if pg_catalog.jsonb_typeof(v_override_interval) <> 'object'
        or v_override_interval->>'localStart' is null or v_override_interval->>'localEnd' is null
        or v_override_interval->>'sortOrder' is null then
        raise exception 'invalid override interval shape' using errcode = '22023';
      end if;
      v_override_interval_count := v_override_interval_count + 1;
      if v_override_interval_count > 500 then
        raise exception 'too many override intervals' using errcode = '22023';
      end if;
      insert into public.availability_override_intervals(override_id, profile_id, environment, local_start, local_end, sort_order)
      values(v_override_id, p_profile_id, p_environment, (v_override_interval->>'localStart')::time,
        (v_override_interval->>'localEnd')::time, (v_override_interval->>'sortOrder')::integer);
    end loop;
  end loop;
  return v_result;
end;
$$;
