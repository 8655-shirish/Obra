\set ON_ERROR_STOP on
\if :{?expect_override_alias_failure}
\else
  \set expect_override_alias_failure false
\endif
\echo 'booking-availability-save: actual ten-argument RPC transaction tests'
begin;
select pg_catalog.set_config('test.expect_override_alias_failure', :'expect_override_alias_failure', true);

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'assertion failed: %', message; end if;
end;
$$;

-- Include IDs and timestamps so failed writes must restore the entire aggregate, not just counts.
create function pg_temp.availability_snapshot(p_profile_id uuid) returns jsonb language sql as $$
  select pg_catalog.jsonb_build_object(
    'service', (select pg_catalog.jsonb_agg(s order by s.id) from public.booking_services s where s.profile_id = p_profile_id),
    'schedule', (select pg_catalog.jsonb_agg(s order by s.id) from public.availability_schedules s where s.profile_id = p_profile_id),
    'intervals', (select pg_catalog.jsonb_agg(i order by i.id) from public.availability_intervals i where i.profile_id = p_profile_id),
    'overrides', (select pg_catalog.jsonb_agg(o order by o.id) from public.availability_overrides o where o.profile_id = p_profile_id),
    'overrideIntervals', (select pg_catalog.jsonb_agg(i order by i.id) from public.availability_override_intervals i where i.profile_id = p_profile_id)
  );
$$;

do $test$
declare
  v_profile_id uuid := gen_random_uuid();
  v_other_profile_id uuid := gen_random_uuid();
  v_auth_user_id uuid := gen_random_uuid();
  v_other_auth_user_id uuid := gen_random_uuid();
  v_website_id uuid := gen_random_uuid();
  v_other_website_id uuid := gen_random_uuid();
  v_rpc regprocedure := 'public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb,jsonb)'::regprocedure;
  v_base regprocedure := 'public.save_shared_booking_availability_base(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb)'::regprocedure;
  v_service jsonb := '{"name":"Availability test","description":"Exact cents","durationMinutes":60,"slotIntervalMinutes":30,"bufferBeforeMinutes":0,"bufferAfterMinutes":15,"minimumNoticeMinutes":60,"bookingHorizonDays":60,"locationType":"customer_address","locationInstructions":"","amountMinor":12345,"currency":"EUR","paymentPolicy":"deposit"}';
  v_schedule jsonb := '{"timeZone":"America/Los_Angeles"}';
  v_intervals jsonb := '[{"weekday":1,"localStart":"09:00","localEnd":"12:00","sortOrder":0},{"weekday":1,"localStart":"13:00","localEnd":"17:00","sortOrder":1}]';
  v_overrides jsonb := '[{"localDate":"2030-01-02","type":"unavailable","reason":"Closed","intervals":[]},{"localDate":"2030-01-03","type":"custom_hours","reason":"","intervals":[{"localStart":"10:00","localEnd":"12:00","sortOrder":0},{"localStart":"13:00","localEnd":"15:30","sortOrder":1}]}]';
  v_result jsonb;
  v_previous_result jsonb;
  v_snapshot jsonb;
  v_other_snapshot jsonb;
  v_schedule_id uuid;
  v_case record;
  v_failed boolean;
  v_expect_alias_failure boolean := pg_catalog.current_setting('test.expect_override_alias_failure')::boolean;
begin
  perform pg_temp.assert_true((select p.prosecdef and p.proconfig = array['search_path=""']
    and p.proowner = (select b.proowner from pg_catalog.pg_proc b where b.oid = v_base)
    from pg_catalog.pg_proc p where p.oid = v_rpc), 'wrapper retains SECURITY DEFINER, empty search_path and base owner');
  perform pg_temp.assert_true(has_function_privilege('service_role', v_rpc, 'EXECUTE'), 'service role may execute wrapper');
  perform pg_temp.assert_true(not has_function_privilege('public', v_rpc, 'EXECUTE'), 'PUBLIC cannot execute wrapper');
  perform pg_temp.assert_true(not has_function_privilege('service_role', v_base, 'EXECUTE'), 'base saver remains private');
  perform pg_temp.assert_true(to_regprocedure('public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb)') is null,
    'retired nine-argument public overload is not restored');

  insert into auth.users(id, email) values
    (v_auth_user_id, 'availability-owner@example.test'), (v_other_auth_user_id, 'availability-other@example.test');
  insert into public.profiles(id, auth_user_id, license_number, email, environment) values
    (v_profile_id, v_auth_user_id, 'AVAILABILITY-SAVE-A', 'availability-owner@example.test', 'test'),
    (v_other_profile_id, v_other_auth_user_id, 'AVAILABILITY-SAVE-B', 'availability-other@example.test', 'test');
  insert into public.websites(id, user_id, status, environment) values
    (v_website_id, v_profile_id, 'draft', 'test'), (v_other_website_id, v_other_profile_id, 'draft', 'test');
  insert into public.website_entitlements(profile_id, website_id, environment, plan, state, effective_at, order_confirmed_at) values
    (v_profile_id, v_website_id, 'test', 'pro', 'active', now() - interval '1 day', now()),
    (v_other_profile_id, v_other_website_id, 'test', 'pro', 'active', now() - interval '1 day', now());
  v_snapshot := pg_temp.availability_snapshot(v_profile_id);
  v_other_snapshot := pg_temp.availability_snapshot(v_other_profile_id);

  -- Run this same first save before the forward migration to prove the original SQLSTATE 42702.
  begin
    set local role service_role;
    v_result := public.save_shared_booking_availability(
      v_website_id, v_profile_id, 'test', v_auth_user_id, null, null, v_service, v_schedule, v_intervals, '[]'::jsonb
    );
    reset role;
  exception when ambiguous_column then
    if not v_expect_alias_failure then raise; end if;
    perform pg_temp.assert_true(sqlerrm = 'column reference "child" is ambiguous', 'pre-fix failure identifies the override alias');
    perform pg_temp.assert_true(pg_temp.availability_snapshot(v_profile_id) = v_snapshot, 'pre-fix failure leaves no partial first save');
    raise notice 'booking-availability-save: pre-fix reproduced SQLSTATE %: % (empty overrides)', sqlstate, sqlerrm;
    return;
  end;
  perform pg_temp.assert_true(not v_expect_alias_failure, 'pre-fix wrapper must reproduce SQLSTATE 42702');
  perform pg_temp.assert_true(v_result = '{"serviceRevision":1,"scheduleRevision":1}'::jsonb, 'first save accepts null revisions and returns revision 1');
  select s.id into strict v_schedule_id from public.availability_schedules s where s.profile_id = v_profile_id;
  perform pg_temp.assert_true((select count(*) = 1 and bool_and(s.amount_minor = 12345 and s.currency = 'USD'
    and s.payment_policy = 'full_amount' and s.active and s.revision = (v_result->>'serviceRevision')::bigint)
    from public.booking_services s where s.profile_id = v_profile_id), 'first save persists exact cents and authoritative USD/full_amount');
  perform pg_temp.assert_true((select s.active and s.time_zone = 'America/Los_Angeles'
    and s.revision = (v_result->>'scheduleRevision')::bigint and s.service_id = b.id
    from public.availability_schedules s join public.booking_services b on b.profile_id = s.profile_id
    where s.id = v_schedule_id), 'first save creates the active linked schedule');
  perform pg_temp.assert_true((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'weekday', i.weekday, 'localStart', to_char(i.local_start, 'HH24:MI'), 'localEnd', to_char(i.local_end, 'HH24:MI'), 'sortOrder', i.sort_order
  ) order by i.weekday, i.sort_order) = v_intervals from public.availability_intervals i where i.schedule_id = v_schedule_id), 'first save persists both weekly intervals');
  perform pg_temp.assert_true(not exists(select 1 from public.availability_overrides where schedule_id = v_schedule_id), 'empty overrides are valid');
  raise notice 'booking-availability-save: first save, exact cents and empty overrides passed';

  v_previous_result := v_result;
  v_service := v_service || '{"amountMinor":23456}'::jsonb;
  v_schedule := '{"timeZone":"America/New_York"}';
  v_intervals := '[{"weekday":2,"localStart":"08:30","localEnd":"16:45","sortOrder":0}]';
  set local role service_role;
  v_result := public.save_shared_booking_availability(
    v_website_id, v_profile_id, 'test', v_auth_user_id,
    (v_previous_result->>'serviceRevision')::bigint, (v_previous_result->>'scheduleRevision')::bigint,
    v_service, v_schedule, v_intervals, v_overrides
  );
  reset role;
  perform pg_temp.assert_true(v_result = '{"serviceRevision":2,"scheduleRevision":2}'::jsonb, 'update consumes returned revisions and advances both once');
  perform pg_temp.assert_true((select s.amount_minor = 23456 and s.currency = 'USD' and s.payment_policy = 'full_amount'
    and s.revision = (v_result->>'serviceRevision')::bigint from public.booking_services s where s.profile_id = v_profile_id), 'update preserves exact cents and payment policy');
  perform pg_temp.assert_true((select s.time_zone = 'America/New_York' and s.revision = (v_result->>'scheduleRevision')::bigint
    from public.availability_schedules s where s.id = v_schedule_id), 'update retains schedule identity and changes time zone');
  perform pg_temp.assert_true((select count(*) = 1 and bool_and(i.weekday = 2 and i.local_start = time '08:30'
    and i.local_end = time '16:45' and i.sort_order = 0) from public.availability_intervals i where i.schedule_id = v_schedule_id), 'update replaces rather than appends weekly hours');
  perform pg_temp.assert_true((select count(*) = 2 from public.availability_overrides o where o.schedule_id = v_schedule_id), 'both override kinds saved');
  perform pg_temp.assert_true(exists(select 1 from public.availability_overrides o where o.schedule_id = v_schedule_id
    and o.local_date = date '2030-01-02' and o.override_type = 'unavailable' and o.reason = 'Closed'
    and not exists(select 1 from public.availability_override_intervals i where i.override_id = o.id)), 'unavailable date has no child intervals');
  perform pg_temp.assert_true((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'localStart', to_char(i.local_start, 'HH24:MI'), 'localEnd', to_char(i.local_end, 'HH24:MI'), 'sortOrder', i.sort_order
  ) order by i.sort_order) = v_overrides->1->'intervals'
    from public.availability_overrides o join public.availability_override_intervals i on i.override_id = o.id
    where o.schedule_id = v_schedule_id and o.local_date = date '2030-01-03' and o.override_type = 'custom_hours' and o.reason is null), 'custom hours and blank reason normalization persist');
  v_snapshot := pg_temp.availability_snapshot(v_profile_id);
  raise notice 'booking-availability-save: revisioned update, weekly hours and both override kinds passed';

  for v_case in select * from (values
    ('stale service revision', v_website_id, 'test', v_auth_user_id, 1::bigint, 2::bigint, 'revision conflict'),
    ('stale schedule revision after service update', v_website_id, 'test', v_auth_user_id, 2, 1, 'revision conflict'),
    ('null update revisions', v_website_id, 'test', v_auth_user_id, null, null, 'revision conflict'),
    ('wrong auth user', v_website_id, 'test', v_other_auth_user_id, 2, 2, 'forbidden'),
    ('missing auth user', v_website_id, 'test', null::uuid, 2, 2, 'forbidden'),
    ('cross-tenant website', v_other_website_id, 'test', v_auth_user_id, 2, 2, 'active Pro website entitlement required'),
    ('wrong environment', v_website_id, 'live', v_auth_user_id, 2, 2, 'active Pro website entitlement required')
  ) as cases(label, website_id, environment, auth_user_id, service_revision, schedule_revision, message)
  loop
    v_failed := false;
    begin
      set local role service_role;
      perform public.save_shared_booking_availability(
        v_case.website_id, v_profile_id, v_case.environment, v_case.auth_user_id, v_case.service_revision, v_case.schedule_revision,
        v_service || '{"amountMinor":99999}'::jsonb, v_schedule, v_intervals, '[]'::jsonb
      );
      reset role;
    exception when raise_exception then
      v_failed := true;
      perform pg_temp.assert_true(sqlerrm = v_case.message, v_case.label || ': expected rejection, not another error');
    end;
    perform pg_temp.assert_true(v_failed, v_case.label || ': rejected');
    perform pg_temp.assert_true(pg_temp.availability_snapshot(v_profile_id) = v_snapshot, v_case.label || ': entire aggregate unchanged');
    perform pg_temp.assert_true(pg_temp.availability_snapshot(v_other_profile_id) = v_other_snapshot, v_case.label || ': other tenant unchanged');
  end loop;
  raise notice 'booking-availability-save: stale revisions, owner, tenant and environment rejection passed';

  for v_case in select * from (values
    ('future entitlement', 'pro', 'active', now() + interval '1 day', null::timestamptz, now(), 'active Pro website entitlement required'),
    ('missing effective date', 'pro', 'active', null, null, now(), 'active Pro website entitlement required'),
    ('expired entitlement', 'pro', 'active', now() - interval '2 days', now() - interval '1 day', now(), 'active Pro website entitlement required'),
    ('inactive entitlement', 'pro', 'suspended', now() - interval '1 day', null, now(), 'active Pro website entitlement required'),
    ('Starter entitlement', 'starter', 'active', now() - interval '1 day', null, now(), 'active Pro website entitlement required'),
    ('unconfirmed order', 'pro', 'active', now() - interval '1 day', null, null, 'active pro entitlement required')
  ) as cases(label, plan, state, effective_at, ends_at, order_confirmed_at, message)
  loop
    v_failed := false;
    begin
      update public.website_entitlements set plan = v_case.plan, state = v_case.state, effective_at = v_case.effective_at,
        ends_at = v_case.ends_at, order_confirmed_at = v_case.order_confirmed_at where website_id = v_website_id;
      set local role service_role;
      perform public.save_shared_booking_availability(v_website_id, v_profile_id, 'test', v_auth_user_id, 2, 2,
        v_service || '{"amountMinor":99999}'::jsonb, v_schedule, v_intervals, '[]'::jsonb);
      reset role;
    exception when raise_exception then
      v_failed := true;
      perform pg_temp.assert_true(sqlerrm = v_case.message, v_case.label || ': expected entitlement rejection');
    end;
    perform pg_temp.assert_true(v_failed, v_case.label || ': rejected');
    perform pg_temp.assert_true(pg_temp.availability_snapshot(v_profile_id) = v_snapshot, v_case.label || ': entire aggregate unchanged');
  end loop;
  raise notice 'booking-availability-save: temporal Pro entitlement and order confirmation gates passed';

  -- Exercise failures both before and after the base saver writes service/schedule revisions.
  for v_case in select * from (values
    ('null overrides', v_intervals, null::jsonb, '22023', 'invalid overrides'),
    ('non-array overrides', v_intervals, '{}'::jsonb, '22023', 'invalid overrides'),
    ('non-object override', v_intervals, '[null]'::jsonb, '22023', 'invalid override shape'),
    ('unavailable with hours', v_intervals, '[{"localDate":"2030-01-04","type":"unavailable","intervals":[{"localStart":"09:00","localEnd":"10:00","sortOrder":0}]}]'::jsonb, '22023', 'invalid override shape'),
    ('custom hours without intervals', v_intervals, '[{"localDate":"2030-01-04","type":"custom_hours","intervals":[]}]'::jsonb, '22023', 'invalid override shape'),
    ('missing interval field', v_intervals, '[{"localDate":"2030-01-04","type":"custom_hours","intervals":[{"localStart":"09:00","sortOrder":0}]}]'::jsonb, '22023', 'invalid override interval shape'),
    ('malformed override date', v_intervals, '[{"localDate":"not-a-date","type":"unavailable","intervals":[]}]'::jsonb, '22023', 'invalid override scalar value'),
    ('infinite override date', v_intervals, '[{"localDate":"infinity","type":"unavailable","intervals":[]}]'::jsonb, '22023', 'invalid override shape'),
    ('malformed override time', v_intervals, '[{"localDate":"2030-01-04","type":"custom_hours","intervals":[{"localStart":"25:00","localEnd":"10:00","sortOrder":0}]}]'::jsonb, '22023', 'invalid override scalar value'),
    ('malformed sort order', v_intervals, '[{"localDate":"2030-01-04","type":"custom_hours","intervals":[{"localStart":"09:00","localEnd":"10:00","sortOrder":"bad"}]}]'::jsonb, '22023', 'invalid override scalar value'),
    ('overlapping override intervals', v_intervals, '[{"localDate":"2030-01-04","type":"custom_hours","intervals":[{"localStart":"09:00","localEnd":"12:00","sortOrder":0},{"localStart":"11:00","localEnd":"13:00","sortOrder":1}]}]'::jsonb, '23P01', null),
    ('zero-length override interval', v_intervals, '[{"localDate":"2030-01-04","type":"custom_hours","intervals":[{"localStart":"09:00","localEnd":"09:00","sortOrder":0}]}]'::jsonb, '23514', null),
    ('negative override sort order', v_intervals, '[{"localDate":"2030-01-04","type":"custom_hours","intervals":[{"localStart":"09:00","localEnd":"10:00","sortOrder":-1}]}]'::jsonb, '23514', null),
    ('duplicate override date', v_intervals, '[{"localDate":"2030-01-04","type":"unavailable","intervals":[]},{"localDate":"2030-01-04","type":"unavailable","intervals":[]}]'::jsonb, '23505', null),
    ('malformed weekly interval', '[{"weekday":2,"localStart":"25:00","localEnd":"12:00","sortOrder":0}]'::jsonb, v_overrides, '22008', null),
    ('overlapping weekly intervals', '[{"weekday":2,"localStart":"09:00","localEnd":"12:00","sortOrder":0},{"weekday":2,"localStart":"11:00","localEnd":"13:00","sortOrder":1}]'::jsonb, v_overrides, '23P01', null),
    ('zero-length weekly interval', '[{"weekday":2,"localStart":"09:00","localEnd":"09:00","sortOrder":0}]'::jsonb, v_overrides, '23514', null),
    ('empty weekly intervals', '[]'::jsonb, v_overrides, 'P0001', 'at least one interval is required'),
    ('override count limit', v_intervals, (select jsonb_agg(jsonb_build_object('localDate', date '2030-01-01' + d, 'type', 'unavailable', 'intervals', '[]'::jsonb)) from generate_series(0, 120) as days(d)), '22023', 'too many overrides'),
    ('override interval count limit', v_intervals, jsonb_build_array(jsonb_build_object('localDate', '2030-01-04', 'type', 'custom_hours', 'intervals', (select jsonb_agg(jsonb_build_object('localStart', time '00:00' + n * interval '1 minute', 'localEnd', time '00:00' + (n + 1) * interval '1 minute', 'sortOrder', n)) from generate_series(0, 500) as intervals(n)))), '22023', 'too many override intervals'),
    ('weekly interval count limit', (select jsonb_agg(jsonb_build_object('weekday', 2, 'localStart', time '00:00' + n * interval '1 minute', 'localEnd', time '00:00' + (n + 1) * interval '1 minute', 'sortOrder', n)) from generate_series(0, 50) as intervals(n)), v_overrides, 'P0001', 'too many intervals')
  ) as cases(label, intervals, overrides, error_code, message)
  loop
    v_failed := false;
    begin
      set local role service_role;
      perform public.save_shared_booking_availability(v_website_id, v_profile_id, 'test', v_auth_user_id, 2, 2,
        v_service || '{"amountMinor":99999}'::jsonb, v_schedule, v_case.intervals, v_case.overrides);
      reset role;
    exception when others then
      v_failed := true;
      perform pg_temp.assert_true(sqlstate = v_case.error_code, v_case.label || ': expected SQLSTATE ' || v_case.error_code || ', got ' || sqlstate || ' (' || sqlerrm || ')');
      perform pg_temp.assert_true(v_case.message is null or sqlerrm = v_case.message, v_case.label || ': expected validation message');
    end;
    perform pg_temp.assert_true(v_failed, v_case.label || ': rejected');
    perform pg_temp.assert_true(pg_temp.availability_snapshot(v_profile_id) = v_snapshot, v_case.label || ': amount, revisions, hours and overrides rolled back');
  end loop;
  raise notice 'booking-availability-save: malformed/overlapping intervals, limits and full aggregate rollback passed';

  for v_case in select * from (values ('anon', false), ('authenticated', false), ('booking_worker', false), ('service_role', true)) as cases(role_name, use_base)
  loop
    perform pg_temp.assert_true(not has_function_privilege(v_case.role_name, case when v_case.use_base then v_base else v_rpc end, 'EXECUTE'), v_case.role_name || ': no execution grant');
    v_failed := false;
    begin
      execute format('set local role %I', v_case.role_name);
      if v_case.use_base then
        perform public.save_shared_booking_availability_base(v_website_id, v_profile_id, 'test', v_auth_user_id, 2, 2, v_service, v_schedule, v_intervals);
      else
        perform public.save_shared_booking_availability(v_website_id, v_profile_id, 'test', v_auth_user_id, 2, 2, v_service, v_schedule, v_intervals, '[]'::jsonb);
      end if;
      reset role;
    exception when insufficient_privilege then
      v_failed := true;
      perform pg_temp.assert_true(sqlerrm = 'permission denied for function ' || case when v_case.use_base then 'save_shared_booking_availability_base' else 'save_shared_booking_availability' end,
        v_case.role_name || ': rejected at function execution boundary');
    end;
    perform pg_temp.assert_true(v_failed, v_case.role_name || ': unauthorized execution rejected');
    perform pg_temp.assert_true(pg_temp.availability_snapshot(v_profile_id) = v_snapshot, v_case.role_name || ': rejected call did not mutate aggregate');
  end loop;
  raise notice 'booking-availability-save: actual service-only wrapper and private base execution boundaries passed';

  -- A valid save still succeeds after all rejected attempts; [] replaces and cascades existing overrides.
  update public.website_entitlements set state = 'grace' where website_id = v_website_id;
  v_previous_result := v_result;
  set local role service_role;
  v_result := public.save_shared_booking_availability(v_website_id, v_profile_id, 'test', v_auth_user_id,
    (v_previous_result->>'serviceRevision')::bigint, (v_previous_result->>'scheduleRevision')::bigint,
    v_service, v_schedule, v_intervals, '[]'::jsonb);
  reset role;
  perform pg_temp.assert_true(v_result = '{"serviceRevision":3,"scheduleRevision":3}'::jsonb, 'grace entitlement can save with unchanged revisions after rollbacks');
  perform pg_temp.assert_true(not exists(select 1 from public.availability_overrides where schedule_id = v_schedule_id)
    and not exists(select 1 from public.availability_override_intervals where profile_id = v_profile_id), 'empty array clears overrides and their child intervals');
  perform pg_temp.assert_true((select s.amount_minor = 23456 and s.revision = (v_result->>'serviceRevision')::bigint
    from public.booking_services s where s.profile_id = v_profile_id), 'clearing keeps the saved amount and advances service revision once');
  perform pg_temp.assert_true((select s.revision = (v_result->>'scheduleRevision')::bigint from public.availability_schedules s where s.id = v_schedule_id), 'clearing advances schedule revision once');
  perform pg_temp.assert_true(pg_temp.availability_snapshot(v_other_profile_id) = v_other_snapshot, 'all saves leave other tenant untouched');
  raise notice 'booking-availability-save: empty override clearing and grace entitlement passed';
end;
$test$;
rollback;
\if :expect_override_alias_failure
  \echo 'booking-availability-save: pre-fix SQLSTATE 42702 proof passed (rolled back)'
\else
  \echo 'booking-availability-save: passed (rolled back)'
\endif
