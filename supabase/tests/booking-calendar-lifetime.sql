\set ON_ERROR_STOP on
\echo 'booking-calendar-lifetime: real local PostgreSQL, no provider effects'

-- The primary harness supplies a tenant whose cutover committed in a prior
-- transaction. No SQL test can legitimately activate its own same-xid preflight.
begin;
create extension if not exists dblink with schema extensions;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'assertion failed: %',message;end if;end $$;
create temp table booking_lifetime_context(tenant uuid not null);
insert into booking_lifetime_context values(:'cutover_tenant'::uuid);

create function pg_temp.reserve_calendar_test(site uuid,at_time timestamptz,request_id uuid default gen_random_uuid(),capability text default repeat('b',64))
returns jsonb language plpgsql as $$
declare c public.calendar_connections;s public.booking_services;sched public.availability_schedules;
  observed timestamptz:=pg_catalog.clock_timestamp();calendar_hash text;
begin
  select cc.* into strict c from public.calendar_connections cc join public.websites w on w.user_id=cc.profile_id and w.environment=cc.environment where w.id=site;
  select * into strict s from public.booking_services where profile_id=c.profile_id and environment=c.environment and active;
  select * into strict sched from public.availability_schedules where profile_id=c.profile_id and environment=c.environment and active;
  select encode(extensions.digest(convert_to(string_agg(cs.google_calendar_id,E'\n' order by cs.google_calendar_id),'UTF8'),'sha256'),'hex')
    into calendar_hash from public.calendar_selections cs where cs.connection_id=c.id and cs.active and cs.blocks_availability;
  perform public.store_booking_availability_cache(gen_random_uuid()::text,c.profile_id,c.environment,c.id,c.availability_generation,
    calendar_hash,sched.revision,s.revision,at_time-interval '1 hour',at_time+interval '2 hours','[]',observed,observed+interval '30 seconds');
  return public.reserve_live_booking(site,c.environment,at_time,(at_time at time zone 'UTC')::date,(at_time at time zone 'UTC')::time,'UTC',
    request_id,repeat('a',64),capability,'obra-booking-data-and-payment-consent','2026-08-29.1',
    '899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f',
    '{"fullName":"Calendar test","email":"customer@example.test","phone":"+15555550123","address":{}}',
    observed,encode(extensions.digest(request_id::text,'sha256'),'hex'),c.availability_generation,calendar_hash);
end $$;

create function pg_temp.pay_calendar_test(appointment_id uuid,event_suffix text default 'paid',bad_amount boolean default false)
returns jsonb language plpgsql as $$
declare a public.appointments;p public.booking_payments;i public.provider_event_inbox;
  lease uuid:=gen_random_uuid();metadata jsonb;checkout jsonb;intent jsonb;charge jsonb;envelope jsonb;
begin
  select * into strict a from public.appointments where id=appointment_id;
  select * into strict p from public.booking_payments bp where bp.appointment_id=a.id;
  metadata:=jsonb_build_object('kind','booking','appointmentId',a.id,'profileId',a.profile_id,'environment',a.environment);
  checkout:=jsonb_build_object('id',p.checkout_session_id,'object','checkout.session','metadata',metadata,'livemode',false,
    'payment_intent','pi_'||a.id,'amount_total',p.expected_amount_minor,'currency',lower(p.currency),'payment_status','paid','status','complete');
  intent:=jsonb_build_object('id','pi_'||a.id,'object','payment_intent','metadata',metadata,'livemode',false,
    'amount',p.expected_amount_minor+case when bad_amount then 1 else 0 end,'currency',lower(p.currency),'status','succeeded','latest_charge','ch_'||a.id);
  charge:=jsonb_build_object('id','ch_'||a.id,'object','charge','payment_intent','pi_'||a.id,'livemode',false,
    'amount',p.expected_amount_minor,'currency',lower(p.currency),'paid',true,'amount_refunded',0);
  envelope:=jsonb_build_object('id','evt_'||a.id||'_'||event_suffix,'type','checkout.session.completed','livemode',false,
    'created',extract(epoch from clock_timestamp())::bigint,'data',jsonb_build_object('object',checkout));
  insert into public.provider_event_inbox(provider,event_family,event_id,account_context,destination,api_version,livemode,environment,profile_id,
    event_type,payload_hash,payload,processing_state,lease_token,lease_expires_at,fencing_token)
  values('stripe','booking',envelope->>'id',p.stripe_account_id,'obra-connect-webhook','2026-08-26.dahlia',false,a.environment,a.profile_id,
    'checkout.session.completed',encode(extensions.digest(envelope::text,'sha256'),'hex'),envelope,'processing',lease,clock_timestamp()+interval '2 minutes',1)
    returning * into i;
  return public.reduce_booking_financial_evidence_v3('stripe_event',i.id,lease,i.fencing_token,
    jsonb_build_object('stripeAccountId',p.stripe_account_id,'checkout',checkout,'paymentIntent',intent,'charge',charge,'refunds','[]'::jsonb,'refundsHasMore',false));
end $$;

create function pg_temp.calendar_money_observation(appointment_id uuid,event_type text,snapshot jsonb,event_object jsonb)
returns jsonb language plpgsql as $$
declare a public.appointments;i public.provider_event_inbox;lease uuid:=gen_random_uuid();envelope jsonb;
begin
  select * into strict a from public.appointments where id=appointment_id;
  envelope:=jsonb_build_object('id','evt_'||gen_random_uuid(),'type',event_type,'livemode',false,
    'created',extract(epoch from clock_timestamp())::bigint,'data',jsonb_build_object('object',event_object));
  insert into public.provider_event_inbox(provider,event_family,event_id,account_context,destination,api_version,livemode,environment,profile_id,
    event_type,payload_hash,payload,processing_state,lease_token,lease_expires_at,fencing_token)
  values('stripe','booking',envelope->>'id',snapshot->>'stripeAccountId','obra-connect-webhook','2026-08-26.dahlia',false,a.environment,a.profile_id,
    event_type,encode(extensions.digest(envelope::text,'sha256'),'hex'),envelope,'processing',lease,clock_timestamp()+interval '2 minutes',1)returning * into i;
  return public.reduce_booking_financial_evidence_v3('stripe_event',i.id,lease,1,snapshot);
end $$;

create function pg_temp.observe_calendar_test(l public.calendar_event_links,lease uuid,state text,phase text default 'probe',effect_id uuid default null,
  failure_kind text default null,failure_code text default null) returns jsonb language sql as $$
  select public.record_booking_calendar_observation(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,
    phase,state,clock_timestamp(),jsonb_build_object('destinationEpochId',l.destination_epoch_id,'googleEventId',l.google_event_id,
      'appointmentId',l.appointment_id,'effectId',effect_id,'failureKind',failure_kind,'failureCode',failure_code))
$$;

create function pg_temp.complete_private_calendar_probe(probe jsonb,lease uuid)
returns public.calendar_connections language plpgsql as $$
begin
  perform public.authorize_google_calendar_setup_effect((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint,'insert');
  perform public.settle_google_calendar_setup_probe((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint,true,true,null,'present');
  perform public.authorize_google_calendar_setup_effect((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint,'delete');
  perform public.settle_google_calendar_setup_probe((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint,true,true,null,'absent');
  return public.persist_google_calendar_configuration((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint);
end $$;

do $test$
#variable_conflict use_variable
declare tenant uuid;owner_id uuid:=gen_random_uuid();site uuid:=gen_random_uuid();site_version uuid:=gen_random_uuid();
  service uuid:=gen_random_uuid();schedule uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();concurrent_appointment uuid:=gen_random_uuid();
  c public.calendar_connections;b public.pipedream_bindings;e public.calendar_destination_epochs;l public.calendar_event_links;
  old_claim public.calendar_event_links;p public.booking_payments;epoch_id uuid;late_claim record;
  appointment_id uuid;unbound uuid;attributed uuid;linked uuid;late_unbound uuid;late_bound uuid;
  request_id uuid:=gen_random_uuid();effect_id uuid;result jsonb;
  lease uuid:=gen_random_uuid();lease2 uuid:=gen_random_uuid();claim record;verify_claim jsonb;fence bigint;generation bigint;
  start_time timestamptz:=((current_date+3)+time '10:00') at time zone 'UTC';denied boolean;before_count bigint;proc regprocedure;
begin
  select x.tenant into strict tenant from booking_lifetime_context x;
  perform pg_temp.assert_true(public.booking_cutover_enabled(tenant,'test'),'prior committed cutover is enabled');
  insert into auth.users(id,email) values(owner_id,'calendar-booking-owner@example.test');
  update public.profiles set auth_user_id=owner_id where id=tenant;
  insert into public.websites(id,user_id,status,environment) values(site,tenant,'draft','test');
  insert into public.website_versions(id,website_id,version_number,config_json,variant_key,status)
    values(site_version,site,1,'{}','booking-calendar-lifetime','live');
  update public.websites set status='live',active_version_id=site_version where id=site;
  insert into public.website_entitlements(profile_id,website_id,environment,plan,state,booking_admission,effective_at,order_confirmed_at)
    values(tenant,site,'test','pro','active',true,clock_timestamp()-interval '1 day',clock_timestamp());
  insert into public.booking_services(id,profile_id,environment,name,duration_minutes,amount_minor,currency,active)
    values(service,tenant,'test','Calendar test',60,10000,'USD',true);
  insert into public.availability_schedules(id,profile_id,service_id,environment,time_zone,active) values(schedule,tenant,service,'test','UTC',true);
  insert into public.availability_intervals(schedule_id,profile_id,environment,weekday,local_start,local_end)
    select schedule,tenant,'test',n,'00:00','23:59' from generate_series(0,6)n;
  insert into public.calendar_connections(profile_id,environment,external_user_id,pipedream_account_id,health_state,last_verified_at)
    values(tenant,'test','obra:test:'||tenant,'apn_calendar_lifetime','healthy',clock_timestamp()) returning * into c;
  insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,access_role,blocks_availability,receives_bookings,permission_verified_at)
    values(c.id,tenant,'test','busy','Busy','reader',true,false,clock_timestamp()),
      (c.id,tenant,'test','destination','Destination','owner',false,true,clock_timestamp());
  insert into public.pipedream_bindings(profile_id,environment,connection_id,pipedream_account_id,deployed_trigger_id,component_key,component_version,
    configuration_revision,selected_calendar_ids,trigger_state,last_health_at)
    values(tenant,'test',c.id,c.pipedream_account_id,'dc_calendar_test','google_calendar-new-or-updated-event-instant','1',c.connection_revision,
      '["busy"]','active',clock_timestamp()) returning * into b;
  insert into public.stripe_connected_accounts(profile_id,environment,stripe_account_id,onboarding_state,charges_enabled,payouts_enabled,details_submitted,
    capabilities,requirements,last_verified_at) values(tenant,'test','acct_calendar_lifetime','ready',true,true,true,
        '{"card_payments":"active"}','{"currently_due":[],"past_due":[],"pending_verification":[]}',clock_timestamp());

  -- Reopened audit 6: no existing booking is required to resolve a private
  -- INSERT denial. Independent attendee denial still requires its own evidence.
  declare probe jsonb;desired jsonb;recovered public.calendar_connections;private_denial timestamptz;booking_denial timestamptz;
  begin
    select jsonb_agg(jsonb_build_object('id',s.google_calendar_id,'displayName',s.display_name,'accessRole',s.access_role,
      'blocksAvailability',s.blocks_availability,'receivesBookings',s.receives_bookings) order by s.google_calendar_id)
      into desired from public.calendar_selections s where s.connection_id=c.id and s.active;
    probe:=public.reserve_google_calendar_setup_probe(tenant,'test',owner_id,c.pipedream_account_id,'destination',c.connection_revision,
      lease,desired,clock_timestamp());
    perform public.authorize_google_calendar_setup_effect(tenant,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,'insert');
    private_denial:=clock_timestamp();
    perform public.settle_google_calendar_setup_probe(tenant,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,
      false,false,'permissions','pending','insert',private_denial);
    denied:=false;
    begin perform pg_temp.reserve_calendar_test(site,start_time);exception when raise_exception then denied:=true;end;
    perform pg_temp.assert_true(denied,'known private INSERT denial pauses actual new reservation');
    perform pg_temp.assert_true(public.request_google_calendar_verification(tenant,'test',owner_id),'owner request wakes the existing failed capability operation');
    probe:=public.claim_google_calendar_setup_probe('test',lease2,'{}',tenant);
    recovered:=pg_temp.complete_private_calendar_probe(probe,lease2);
    perform pg_temp.assert_true(recovered.id=c.id and recovered.connection_revision=c.connection_revision
      and recovered.pipedream_account_id=c.pipedream_account_id and recovered.health_state='healthy'
      and recovered.calendar_probe_insert_blocked_at is null and recovered.calendar_create_blocked_at is null
      and recovered.calendar_create_verified_at is null and recovered.calendar_write_blocked_at is null,
      'successful private retry restores only its own cause and the unchanged saved configuration');
    perform pg_temp.assert_true(not exists(select 1 from public.calendar_event_links x where x.profile_id=tenant),
      'private recovery used no synthetic or existing attendee booking evidence');
    result:=pg_temp.reserve_calendar_test(site,start_time);
    appointment_id:=(result->>'appointmentId')::uuid;
    perform pg_temp.assert_true(appointment_id is not null,'actual new admission works after private recovery');
    p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
    perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);
    perform pg_temp.pay_calendar_test(appointment_id);
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease,'absent');
    effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'failed',403,'{"failureCode":"calendar_write_blocked"}');
    perform pg_temp.observe_calendar_test(l,lease,'absent','post_effect',effect_id,'permissions','calendar_write_blocked');
    select calendar_create_blocked_at into booking_denial from public.calendar_connections where id=c.id;
    perform pg_temp.assert_true(booking_denial is not null,'actual attendee CREATE denial has its own blocker');
    probe:=public.reserve_google_calendar_setup_probe(tenant,'test',owner_id,c.pipedream_account_id,'destination',c.connection_revision,
      lease2,desired,clock_timestamp());
    perform public.authorize_google_calendar_setup_effect(tenant,'test',(probe->>'id')::uuid,lease2,(probe->>'fencing_token')::bigint,'insert');
    perform public.settle_google_calendar_setup_probe(tenant,'test',(probe->>'id')::uuid,lease2,(probe->>'fencing_token')::bigint,
      false,false,'permissions','pending','insert',clock_timestamp());
    update public.calendar_connections set setup_retry_at=clock_timestamp() where id=c.id;
    probe:=public.claim_google_calendar_setup_probe('test',lease2,'{}',tenant);
    recovered:=pg_temp.complete_private_calendar_probe(probe,lease2);
    perform pg_temp.assert_true(recovered.calendar_probe_insert_blocked_at is null and recovered.calendar_create_blocked_at=booking_denial
      and recovered.health_state='degraded' and recovered.verification_reason='calendar_write_blocked',
      'private INSERT failure and success cannot replace or clear independent attendee denial');
    denied:=false;
    begin perform pg_temp.reserve_calendar_test(site,start_time+interval '1 day');exception when raise_exception then denied:=true;end;
    perform pg_temp.assert_true(denied,'attendee denial still blocks actual admission after private recovery');
    update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease,'absent');
    effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'accepted',200,'{}');
    perform pg_temp.observe_calendar_test(l,lease,'present','post_effect',effect_id);
    verify_claim:=public.claim_saved_google_calendar_verification(tenant,'test',lease2,60,false);
    perform public.mark_google_calendar_connection_verified(b.id,lease2,(verify_claim->'binding'->>'reconciliation_fencing_token')::bigint,
      clock_timestamp(),'[{"id":"busy","accessRole":"reader"},{"id":"destination","accessRole":"owner"}]');
    result:=pg_temp.reserve_calendar_test(site,start_time+interval '1 day');
    perform pg_temp.assert_true(result->>'appointmentId' is not null,'independent attendee recovery restores admission through real transitions');
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- R4: dispatch authority can expire/supersede, but the same effect still owns
  -- its observed result. Neither cancellation nor inactive cutover discards it.
  declare dispatched public.booking_calendar_effect_attempts;cancelled_snapshot jsonb;observed timestamptz;case_number integer;
  begin
    for case_number in 1..5 loop
      begin
        result:=pg_temp.reserve_calendar_test(site,start_time);
        appointment_id:=(result->>'appointmentId')::uuid;
        p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
        perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);
        perform pg_temp.pay_calendar_test(appointment_id);
        if case_number>=4 then perform public.cancel_contractor_booking(appointment_id,tenant,'test',owner_id,gen_random_uuid(),repeat('d',64));end if;
        select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
        l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
        perform pg_temp.observe_calendar_test(l,lease,case when case_number>=4 then 'present' else 'absent' end);
        effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,
          case when case_number>=4 then 'delete' else 'create' end);
        observed:=clock_timestamp();
        perform public.cancel_contractor_booking(appointment_id,tenant,'test',owner_id,gen_random_uuid(),repeat('d',64));
        if case_number>=4 then
          update public.calendar_event_links set reconcile_lease_expires_at=clock_timestamp()-interval '1 second' where id=l.id;
          perform 1 from public.claim_booking_calendar_reconciliation('test',lease2,1);
        end if;
        select to_jsonb(a) into cancelled_snapshot from public.appointments a where a.id=appointment_id;
        if case_number=2 then
          perform set_config('obra.booking_cutover_write_v3','allowed',true);
          update public.booking_cutover_state set status='reconciling' where profile_id=tenant and environment='test';
        elsif case_number=3 then
          update public.calendar_connections set connection_revision=connection_revision+1,pipedream_account_id='apn_replacement_after_cancel'
            where id=c.id;
        end if;
        result:=jsonb_build_object('failureCode',case when case_number=5 then 'calendar_identity_conflict' else 'calendar_write_blocked' end,'observedAt',observed);
        denied:=false;
        begin perform public.record_booking_calendar_effect_result(effect_id,lease2,l.reconcile_fencing_token,'failed',case when case_number=5 then 412 else 403 end,result);
          exception when no_data_found then denied:=true;end;
        perform pg_temp.assert_true(denied,'a different effect owner cannot settle a cancelled dispatch');
        perform pg_temp.assert_true(public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'failed',case when case_number=5 then 412 else 403 end,result),
          'the original effect retains its result after cancellation');
        select * into dispatched from public.booking_calendar_effect_attempts where id=effect_id;
        perform pg_temp.assert_true(dispatched.outcome='failed' and dispatched.completed_at is not null,'result is durable without a renewable link lease');
        perform pg_temp.assert_true(public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'failed',case when case_number=5 then 412 else 403 end,result),
          'exact response-loss settlement repetition is idempotent');
        perform pg_temp.assert_true((select completed_at=dispatched.completed_at and outcome_sha256=dispatched.outcome_sha256
          from public.booking_calendar_effect_attempts where id=effect_id),'repetition does not refresh denial ordering');
        denied:=false;
        begin perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'accepted',200,result);
          exception when unique_violation then denied:=true;end;
        perform pg_temp.assert_true(denied,'a contradictory result cannot replace evidence');
        perform pg_temp.assert_true((select to_jsonb(a)-array['calendar_state','review_state','updated_at']=cancelled_snapshot-array['calendar_state','review_state','updated_at']
          from public.appointments a where a.id=appointment_id),
          'negative capability evidence never changes cancelled appointment or refund state');
        perform pg_temp.assert_true((select desired_state='absent' and reconcile_status=case when case_number=5 then 'manual_repair' when case_number=4 then 'processing' else 'due' end
          from public.calendar_event_links where id=l.id),
          'retaining old evidence never revives its create generation');
        perform pg_temp.assert_true((select (calendar_create_blocked_at is not null)=(case_number in(1,2))
          and (calendar_delete_blocked_at is not null)=(case_number=4)
          and calendar_probe_insert_blocked_at is null from public.calendar_connections where id=c.id),
          'only the unchanged account/revision inherits attendee denial, never private INSERT');
        if case_number=1 then
          denied:=false;
          begin perform pg_temp.reserve_calendar_test(site,start_time+interval '1 day');exception when raise_exception then denied:=true;end;
          perform pg_temp.assert_true(denied,'actual admission fails closed after cancellation-race write denial');
        end if;
        raise exception 'rollback R4 case' using errcode='Z0002';
      exception when sqlstate 'Z0002' then null;end;
    end loop;
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- R4 ordering: a stored late result uses the provider observation instant,
  -- not the time a delayed DB response eventually settles.
  declare first_effect uuid;first_link public.calendar_event_links;denial_observed timestamptz;newer_success timestamptz;
  begin
    result:=pg_temp.reserve_calendar_test(site,start_time);
    appointment_id:=(result->>'appointmentId')::uuid;
    p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
    perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);
    perform pg_temp.pay_calendar_test(appointment_id);
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
    first_link:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(first_link,lease,'absent');
    first_effect:=public.begin_booking_calendar_effect(first_link.id,lease,first_link.reconcile_fencing_token,
      first_link.desired_generation,first_link.snapshot_appointment_version,'create');
    denial_observed:=clock_timestamp();
    perform public.cancel_contractor_booking(appointment_id,tenant,'test',owner_id,gen_random_uuid(),repeat('d',64));
    result:=pg_temp.reserve_calendar_test(site,start_time+interval '1 day');
    unbound:=(result->>'appointmentId')::uuid;
    p:=public.claim_booking_checkout(unbound,(select checkout_operation_id from public.booking_payments x where x.appointment_id=unbound),lease2);
    perform public.settle_booking_checkout(p.id,lease2,p.checkout_fencing_token,'cs_'||unbound,clock_timestamp()+interval '31 minutes',true,false,null);
    perform pg_temp.pay_calendar_test(unbound);
    -- Complete the cancelled row before selecting the next real claim.
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease2,'absent');
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.assert_true(l.appointment_id=unbound,'newer write belongs to the separate still-confirmed booking');
    perform pg_temp.observe_calendar_test(l,lease2,'absent');
    effect_id:=public.begin_booking_calendar_effect(l.id,lease2,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_id,lease2,l.reconcile_fencing_token,'accepted',200,'{}');
    perform pg_temp.observe_calendar_test(l,lease2,'present','post_effect',effect_id);
    select calendar_create_verified_at into newer_success from public.calendar_connections where id=c.id;
    perform pg_temp.assert_true(newer_success>denial_observed,'success starts after the older denial was observed');
    perform public.record_booking_calendar_effect_result(first_effect,lease,first_link.reconcile_fencing_token,'failed',403,
      jsonb_build_object('failureCode','calendar_write_blocked','observedAt',denial_observed));
    perform pg_temp.assert_true((select calendar_create_verified_at=newer_success and calendar_create_blocked_at is null
      from public.calendar_connections where id=c.id),'delayed result storage cannot override newer scoped write success');
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- Audit regression 1: signed pending refund and paid replay preserve cancellation
  -- through actual refund preparation and completion, not a compensating update.
  declare snapshot jsonb;refund_item jsonb;cmd public.integration_outbox;initial_generation bigint;bad jsonb;
  begin
    result:=pg_temp.reserve_calendar_test(site,start_time);
    appointment_id:=(result->>'appointmentId')::uuid;
    p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
    perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);
    perform pg_temp.pay_calendar_test(appointment_id);
    select o.provider_snapshot into strict snapshot from public.booking_stripe_observations_v3 o where o.appointment_id=appointment_id;
    for bad in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_set(jsonb_set(jsonb_set(snapshot,'{paymentIntent,id}','"pi_wrong"'),'{checkout,payment_intent}','"pi_wrong"'),'{charge,payment_intent}','"pi_wrong"'),
      jsonb_set(jsonb_set(snapshot,'{charge,id}','"ch_wrong"'),'{paymentIntent,latest_charge}','"ch_wrong"'),
      jsonb_set(snapshot,'{checkout,metadata,profileId}',to_jsonb(gen_random_uuid())),
      jsonb_set(snapshot,'{charge,amount}','10001')
    )) loop
      denied:=false;
      begin perform pg_temp.calendar_money_observation(appointment_id,'checkout.session.completed',bad,bad->'checkout');exception when raise_exception then denied:=true;end;
      perform pg_temp.assert_true(denied,'financial provider identity, metadata and amount validation remain authoritative');
    end loop;
    snapshot:=jsonb_set(snapshot,'{checkout}','null');
    perform public.cancel_contractor_booking(appointment_id,tenant,'test',owner_id,gen_random_uuid(),repeat('d',64));
    select refund_generation into initial_generation from public.appointments where id=appointment_id;
    select * into strict cmd from public.claim_due_booking_outbox('test',lease2,1);
    result:=public.reduce_booking_financial_evidence_v3('refund_command',cmd.id,lease2,cmd.fencing_token,snapshot);
    perform pg_temp.assert_true(result->>'action'='create','cancellation prepares the existing refund generation');
    refund_item:=jsonb_build_object('id','re_'||appointment_id,'object','refund','charge','ch_'||appointment_id,'payment_intent','pi_'||appointment_id,
      'status','pending','amount',10000,'currency','usd','created',extract(epoch from clock_timestamp())::bigint,
      'metadata',jsonb_build_object('kind','booking_refund','bookingPaymentId',p.id,'bookingAppointmentId',appointment_id,
        'bookingProfileId',tenant,'bookingEnvironment','test','refundGeneration',initial_generation::text,'bookingCommandId',cmd.id));
    snapshot:=jsonb_set(snapshot,'{refunds}',jsonb_build_array(refund_item));
    result:=pg_temp.calendar_money_observation(appointment_id,'refund.updated',snapshot,refund_item);
    perform pg_temp.assert_true(result->>'outcome'='paid_cancelled_preserved','pending refund cannot masquerade as late payment');
    perform pg_temp.pay_calendar_test(appointment_id,'cancelled_paid_replay');
    perform pg_temp.assert_true((select appointment_state='cancelled' and appointment_reason='contractor_cancelled' and cancellation_requested_at is not null
      and refund_state='pending' and refund_generation=initial_generation from public.appointments where id=appointment_id),'paid replay preserves cancellation and refund intent');
    perform pg_temp.assert_true(not exists(select 1 from public.booking_late_payment_arbitrations x where x.appointment_id=appointment_id),'cancelled paid booking never enters arbitration');
    result:=public.reduce_booking_financial_evidence_v3('refund_command',cmd.id,lease2,cmd.fencing_token,snapshot);
    perform pg_temp.assert_true(result->>'action'='waiting','owned pending refund remains scheduled');
    update public.integration_outbox set next_attempt_at=clock_timestamp() where id=cmd.id;
    select * into strict cmd from public.claim_due_booking_outbox('test',lease,1);
    refund_item:=jsonb_set(refund_item,'{status}','"succeeded"');
    snapshot:=jsonb_set(jsonb_set(snapshot,'{refunds}',jsonb_build_array(refund_item)),'{charge,amount_refunded}','10000');
    perform pg_temp.calendar_money_observation(appointment_id,'refund.updated',snapshot,refund_item);
    perform pg_temp.assert_true((select appointment_state='cancelled' and appointment_reason='contractor_cancelled' and refund_state='succeeded' from public.appointments where id=appointment_id),'refund completion preserves deliberate cancellation');
    perform pg_temp.assert_true((select amount_refunded_minor=10000 and refund_state='succeeded' from public.booking_payments where id=p.id)
      and (select state='succeeded' from public.integration_outbox where id=cmd.id)
      and (select br.state='succeeded' from public.booking_refunds br where br.payment_id=p.id and br.generation=initial_generation),'signed completion closes money, owned ledger and refund work');
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- A committed checkout claim without a handoff is still effect-free. Expiry
  -- releases capacity without stealing a live lease or rewriting paid evidence.
  declare snapshot jsonb;deadline timestamptz;old_fence bigint;replacement uuid;
  begin
    result:=pg_temp.reserve_calendar_test(site,start_time);
    appointment_id:=(result->>'appointmentId')::uuid;
    p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
    old_fence:=p.checkout_fencing_token;
    perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=0,'unexpired pre-dispatch claim retains its hold');
    begin
      deadline:=clock_timestamp()+interval '31 minutes';
      perform public.prepare_booking_checkout_handoff_v3(p.id,lease,old_fence,deadline,deadline+interval '5 minutes',repeat('b',64));
      update public.appointments set reservation_expires_at=clock_timestamp()-interval '1 minute'where id=appointment_id;
      update public.booking_payments set checkout_lease_expires_at=clock_timestamp()-interval '1 second'where id=p.id;
      perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=0,'persisted dispatch marker remains on ambiguous recovery, not pre-dispatch expiry');
      perform pg_temp.assert_true(exists(select 1 from public.claim_ambiguous_booking_checkouts('test',lease2,1)),'marked ambiguous checkout retains its original recovery claim');
      raise exception 'rollback dispatch fixture' using errcode='Z0002';
    exception when sqlstate 'Z0002' then null;end;
    begin
      perform public.settle_booking_checkout(p.id,lease,old_fence,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);
      perform pg_temp.pay_calendar_test(appointment_id);
      select o.provider_snapshot into strict snapshot from public.booking_stripe_observations_v3 o where o.appointment_id=appointment_id;
      perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=0,'provider-paid booking cannot be expired');
      raise exception 'rollback payment fixture' using errcode='Z0002';
    exception when sqlstate 'Z0002' then null;end;
    update public.appointments set reservation_expires_at=clock_timestamp()-interval '1 minute'where id=appointment_id;
    perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=0,'live checkout lease still fences hold expiry');
    update public.booking_payments set checkout_lease_expires_at=clock_timestamp()-interval '1 second'where id=p.id;
    begin
      update public.booking_payments set confirmation_nonce_hash=repeat('b',64)where id=p.id;
      perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=0,'partial legacy handoff evidence is not assumed undispatched');
      raise exception 'rollback marker fixture' using errcode='Z0002';
    exception when sqlstate 'Z0002' then null;end;
    perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('live',100)=0,'expiry never crosses environment');
    perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=1,'expired pre-handoff creating hold is released');
    perform pg_temp.assert_true((select appointment_state='cancelled' and payment_state='failed' and appointment_reason='checkout_creation_abandoned'
      and calendar_destination_epoch_id is not null from public.appointments where id=appointment_id),'expiry preserves destination while releasing capacity');
    perform pg_temp.assert_true((select checkout_lease_token is null and checkout_lease_expires_at is null and checkout_fencing_token=old_fence+1
      and checkout_provider_expires_at is null and checkout_session_id is null and amount_paid_minor=0 from public.booking_payments where id=p.id),'expiry fences stale checkout without fabricating provider evidence');
    denied:=false;
    begin perform public.prepare_booking_checkout_handoff_v3(p.id,lease,old_fence,clock_timestamp()+interval '31 minutes',clock_timestamp()+interval '36 minutes',repeat('b',64));
    exception when no_data_found then denied:=true;end;
    perform pg_temp.assert_true(denied,'expired owner cannot prepare a late handoff');
    denied:=false;
    begin perform public.settle_booking_checkout(p.id,lease,old_fence,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);
    exception when no_data_found then denied:=true;end;
    perform pg_temp.assert_true(denied,'expired owner cannot settle a stale Checkout');
    result:=pg_temp.reserve_calendar_test(site,start_time);
    replacement:=(result->>'appointmentId')::uuid;
    perform pg_temp.assert_true(replacement<>appointment_id,'another customer can reserve the released capacity');
    -- A second backend holds the appointment lock before expiry considers this
    -- interrupted claim. No provider effect or direct cancellation is simulated.
    insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,start_at,end_at,local_date,local_start,time_zone,
      customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,reservation_expires_at)
      select concurrent_appointment,a.profile_id,a.website_id,a.entitlement_id,a.service_id,a.customer_id,a.environment,a.start_at+interval '1 day',a.end_at+interval '1 day',a.local_date+1,a.local_start,a.time_zone,
        a.customer_snapshot,a.service_snapshot,a.location_snapshot,a.amount_minor,a.currency,a.duration_minutes,tstzrange(a.start_at+interval '1 day',a.end_at+interval '1 day','[)'),
        'held','creating',clock_timestamp()-interval '1 minute' from public.appointments a where a.id=appointment_id;
    insert into public.booking_payments(appointment_id,profile_id,environment,stripe_account_id,expected_amount_minor,currency,payment_state,checkout_lease_expires_at)
      values(concurrent_appointment,tenant,'test','acct_calendar_lifetime',10000,'USD','creating',clock_timestamp()-interval '1 second');
    perform extensions.dblink_connect('booking_checkout_expiry',format('hostaddr=127.0.0.1 port=%s dbname=%L user=%L connect_timeout=2',current_setting('port'),current_database(),current_user));
    begin
      perform extensions.dblink_exec('booking_checkout_expiry',format('do $remote$ begin perform pg_advisory_lock(%s);end $remote$',
        hashtextextended(concurrent_appointment::text||':booking-appointment',0)));
      perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=0,'expiry skips a concurrently owned appointment');
      perform extensions.dblink_disconnect('booking_checkout_expiry');
    exception when others then perform extensions.dblink_disconnect('booking_checkout_expiry');raise;end;
    perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=1,'released appointment lock lets expiry complete');
    -- If attributable paid evidence later arrives, only the existing reducer may
    -- establish money truth. It cannot resurrect an abandoned creation.
    result:=pg_temp.calendar_money_observation(appointment_id,'payment_intent.succeeded',jsonb_set(snapshot,'{checkout}','null'),snapshot->'paymentIntent');
    perform pg_temp.assert_true(result->>'outcome'='paid_refund_required' and (select payment_state='paid' and refund_state='pending'
      and appointment_state='cancelled' from public.appointments where id=appointment_id),'late paid evidence after expiry refunds through the financial reducer');
    perform pg_temp.assert_true(exists(select 1 from public.claim_due_booking_outbox('test',lease2,1)),'late paid refund remains claimable');
    perform pg_temp.assert_true(public.expire_abandoned_booking_checkout_creations_v3('test',100)=0,'expiry repeats without altering replacement or paid truth');
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- Session expiry is another entry into the same money reducer. Paid truth
  -- after the service start must refund, never leave unclaimable arbitration.
  declare snapshot jsonb;expired_at timestamptz;session_lease uuid:=gen_random_uuid();paid public.booking_payments;
  begin
    result:=pg_temp.reserve_calendar_test(site,start_time);
    appointment_id:=(result->>'appointmentId')::uuid;
    p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
    perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);
    -- Build the actual provider snapshot in a rollback-only subtransaction.
    begin
      perform pg_temp.pay_calendar_test(appointment_id);
      select o.provider_snapshot into strict snapshot from public.booking_stripe_observations_v3 o where o.appointment_id=appointment_id;
      raise exception 'rollback provider fixture' using errcode='Z0002';
    exception when sqlstate 'Z0002' then null;end;
    update public.appointments set reservation_expires_at=clock_timestamp()-interval '1 minute',start_at=clock_timestamp()-interval '1 hour',
      end_at=clock_timestamp(),capacity_range=tstzrange(clock_timestamp()-interval '1 hour',clock_timestamp(),'[)')where id=appointment_id;
    select * into strict paid from public.claim_due_booking_session_expiries_v3('test',session_lease,1);
    result:=public.reduce_booking_financial_evidence_v3('session_expiry',paid.id,session_lease,paid.checkout_fencing_token,snapshot);
    perform pg_temp.assert_true(result->>'outcome'='expiry_paid_refund_required'
      and (select appointment_state='cancelled' and payment_state='paid' and refund_state='pending' from public.appointments where id=appointment_id),
      'elapsed paid expiry settles refund obligation without arbitration');
    perform pg_temp.assert_true(exists(select 1 from public.claim_due_booking_outbox('test',lease2,1)),'elapsed expiry refund is actually claimable');
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- Audit regressions 6/24: independent capability causes and effect-time order.
  declare effect_a uuid;effect_b uuid;snapshot jsonb;started timestamptz;
  begin
    result:=pg_temp.reserve_calendar_test(site,start_time);
    appointment_id:=(result->>'appointmentId')::uuid;
    p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
    perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);
    perform pg_temp.pay_calendar_test(appointment_id);
    select o.provider_snapshot into strict snapshot from public.booking_stripe_observations_v3 o where o.appointment_id=appointment_id;
    snapshot:=jsonb_set(snapshot,'{checkout}','null');
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
    old_claim:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(old_claim,lease,'absent');
    effect_a:=public.begin_booking_calendar_effect(old_claim.id,lease,old_claim.reconcile_fencing_token,old_claim.desired_generation,old_claim.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_a,lease,old_claim.reconcile_fencing_token,'accepted',200,'{}');
    result:=pg_temp.reserve_calendar_test(site,start_time+interval '1 day');
    unbound:=(result->>'appointmentId')::uuid;
    p:=public.claim_booking_checkout(unbound,(select checkout_operation_id from public.booking_payments x where x.appointment_id=unbound),lease2);
    perform public.settle_booking_checkout(p.id,lease2,p.checkout_fencing_token,'cs_'||unbound,clock_timestamp()+interval '31 minutes',true,false,null);
    perform pg_temp.pay_calendar_test(unbound);
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease2,'absent');
    effect_b:=public.begin_booking_calendar_effect(l.id,lease2,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_b,lease2,l.reconcile_fencing_token,'failed',403,'{}');
    perform pg_temp.observe_calendar_test(old_claim,lease,'present','post_effect',effect_a);
    perform pg_temp.observe_calendar_test(l,lease2,'absent','post_effect',effect_b,'permissions','calendar_write_blocked');
    perform pg_temp.assert_true((select calendar_create_blocked_at is not null and calendar_delete_blocked_at is null and health_state='degraded' from public.calendar_connections where id=c.id),'older write late readback cannot suppress later CREATE denial');
    update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease2,'absent');
    effect_b:=public.begin_booking_calendar_effect(l.id,lease2,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_b,lease2,l.reconcile_fencing_token,'accepted',200,'{}');
    select o.provider_snapshot into strict snapshot from public.booking_stripe_observations_v3 o where o.appointment_id=unbound;
    perform pg_temp.calendar_money_observation(unbound,'charge.dispute.created',jsonb_set(snapshot,'{checkout}','null'),
      jsonb_build_object('id','dp_'||unbound,'object','dispute','charge','ch_'||unbound,'status','needs_response'));
    perform pg_temp.assert_true(not public.renew_booking_calendar_reconciliation_v3(l.id,lease2,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,120),'financial version still fences old dispatch');
    update public.calendar_event_links set reconcile_lease_expires_at=clock_timestamp()-interval '1 second' where id=l.id;
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease,'present');
    perform pg_temp.assert_true((select calendar_create_blocked_at is null and calendar_write_blocked_at is null from public.calendar_connections where id=c.id),'unchanged desired content CREATE proof clears despite dispute version');
    perform public.cancel_contractor_booking(appointment_id,tenant,'test',owner_id,gen_random_uuid(),repeat('d',64));
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease2,'present');
    effect_b:=public.begin_booking_calendar_effect(l.id,lease2,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'delete');
    perform public.record_booking_calendar_effect_result(effect_b,lease2,l.reconcile_fencing_token,'failed',403,'{}');
    perform pg_temp.observe_calendar_test(l,lease2,'present','post_effect',effect_b,'permissions','calendar_write_blocked');
    update public.calendar_connections set calendar_create_blocked_at=clock_timestamp(),verification_reason='calendar_write_blocked' where id=c.id;
    update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease,'present');
    effect_b:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'delete');
    perform public.record_booking_calendar_effect_result(effect_b,lease,l.reconcile_fencing_token,'accepted',204,'{}');
    perform pg_temp.observe_calendar_test(l,lease,'absent','post_effect',effect_b);
    perform pg_temp.assert_true((select calendar_delete_blocked_at is null and calendar_create_blocked_at is not null and verification_reason='calendar_write_blocked' from public.calendar_connections where id=c.id),'successful DELETE clears only DELETE denial');
    update public.calendar_event_links x set reconcile_next_attempt_at=clock_timestamp() where x.appointment_id=unbound;
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease2,'absent');
    effect_b:=public.begin_booking_calendar_effect(l.id,lease2,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_b,lease2,l.reconcile_fencing_token,'accepted',200,'{}');
    update public.calendar_connections set calendar_delete_blocked_at=clock_timestamp(),verification_reason='calendar_write_blocked' where id=c.id;
    perform pg_temp.observe_calendar_test(l,lease2,'present','post_effect',effect_b);
    perform pg_temp.assert_true((select calendar_create_blocked_at is null and calendar_delete_blocked_at is not null from public.calendar_connections where id=c.id),'CREATE proof cannot clear a DELETE denial');
    update public.calendar_connections set calendar_create_blocked_at=clock_timestamp(),verification_reason='calendar_write_blocked',
      setup_operation_id=gen_random_uuid(),setup_account_id=pipedream_account_id,setup_calendar_id='destination',setup_expected_revision=connection_revision,
      setup_probe_id=gen_random_uuid(),setup_probe_account_id=pipedream_account_id,setup_probe_calendar_id='destination',setup_probe_state='absent',
      setup_probe_started_at=clock_timestamp(),setup_probe_delete_started_at=clock_timestamp(),setup_probe_write_verified_at=clock_timestamp(),setup_lease_token=lease,
      setup_lease_expires_at=clock_timestamp()+interval '1 minute',setup_fencing_token=setup_fencing_token+1 where id=c.id;
    select * into c from public.calendar_connections where id=c.id;
    denied:=false;
    begin perform public.settle_booking_calendar_setup_capability(tenant,'test',c.setup_operation_id,lease2,c.setup_fencing_token);exception when serialization_failure then denied:=true;end;
    perform pg_temp.assert_true(denied,'setup capability is fenced to its exact owner lease');
    perform public.settle_booking_calendar_setup_capability(tenant,'test',c.setup_operation_id,lease,c.setup_fencing_token);
    perform pg_temp.assert_true((select calendar_delete_blocked_at is null and calendar_create_blocked_at is not null from public.calendar_connections where id=c.id),'attendee-free setup resolves only DELETE, not attendee CREATE');
    -- A 412 result survives response loss without needing a second fail RPC.
    update public.calendar_event_links x set reconcile_next_attempt_at=clock_timestamp() where x.appointment_id=appointment_id;
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease2,'present');
    effect_b:=public.begin_booking_calendar_effect(l.id,lease2,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'delete');
    perform public.record_booking_calendar_effect_result(effect_b,lease2,l.reconcile_fencing_token,'failed',412,'{"failureCode":"calendar_identity_conflict"}');
    perform pg_temp.assert_true((select reconcile_status='manual_repair' and failure_code='calendar_identity_conflict' from public.calendar_event_links where id=l.id),'conditional-delete conflict is durable with effect result');
    -- Same generation alone is insufficient if the intended attendee changed.
    update public.calendar_event_links x set reconcile_next_attempt_at=clock_timestamp() where x.appointment_id=unbound;
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease2,'absent');
    effect_b:=public.begin_booking_calendar_effect(l.id,lease2,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_b,lease2,l.reconcile_fencing_token,'accepted',200,'{}');
    update public.appointments set customer_snapshot=jsonb_set(customer_snapshot,'{email}','"different@example.test"'),version=version+1 where id=unbound;
    update public.calendar_event_links set reconcile_lease_expires_at=clock_timestamp()-interval '1 second' where id=l.id;
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.observe_calendar_test(l,lease,'present');
    perform pg_temp.assert_true((select calendar_create_blocked_at is not null from public.calendar_connections where id=c.id),'different desired attendee cannot reuse old capability proof');
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- Inverse result order is also safe: a denied effect completes while an
  -- older successful effect is awaiting content readback.
  declare effect_a uuid;effect_b uuid;
  begin
    for before_count in 1..2 loop
      result:=pg_temp.reserve_calendar_test(site,start_time+pg_catalog.make_interval(days=>before_count::integer));
      unbound:=(result->>'appointmentId')::uuid;
      p:=public.claim_booking_checkout(unbound,(select checkout_operation_id from public.booking_payments x where x.appointment_id=unbound),lease);
      perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||unbound,clock_timestamp()+interval '31 minutes',true,false,null);
      perform pg_temp.pay_calendar_test(unbound);
      select * into strict claim from public.claim_booking_calendar_reconciliation('test',case when before_count=1 then lease else lease2 end,1);
      l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
      perform pg_temp.observe_calendar_test(l,case when before_count=1 then lease else lease2 end,'absent');
      effect_id:=public.begin_booking_calendar_effect(l.id,case when before_count=1 then lease else lease2 end,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
      if before_count=1 then old_claim:=l;effect_a:=effect_id;else effect_b:=effect_id;end if;
    end loop;
    perform public.record_booking_calendar_effect_result(effect_b,lease2,l.reconcile_fencing_token,'failed',403,'{"failureCode":"calendar_write_blocked"}');
    perform public.record_booking_calendar_effect_result(effect_a,lease,old_claim.reconcile_fencing_token,'accepted',200,'{}');
    perform pg_temp.observe_calendar_test(old_claim,lease,'present','post_effect',effect_a);
    perform pg_temp.assert_true((select calendar_create_blocked_at is not null and verification_reason='calendar_write_blocked' from public.calendar_connections where id=c.id),'late success readback never clears an overlapping known denial');
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- Audited unresolved repair is reachable by service RPC but only an AAL2
  -- administrator can attest original evidence; it is not an account chooser.
  declare admin_id uuid:=gen_random_uuid();resolution jsonb;context jsonb;original_at timestamptz;foreign_epoch uuid;replacement_epoch uuid;repair_audit bigint;
  begin
    perform pg_sleep(1);
    insert into auth.users(id,email,confirmed_at)values(admin_id,'calendar-repair-admin@example.test',clock_timestamp());
    insert into public.admin_principals(user_id,role,enabled,mfa_required)values(admin_id,'admin',true,true);
    insert into public.admin_sessions(token_hash,user_id,role,aal,auth_epoch,idle_expires_at,absolute_expires_at)
      select repeat('9',64),admin_id,'admin','aal2',auth_epoch,clock_timestamp()+interval '30 minutes',clock_timestamp()+interval '12 hours'
      from public.admin_principals where user_id=admin_id;
    result:=pg_temp.reserve_calendar_test(site,start_time);
    appointment_id:=(result->>'appointmentId')::uuid;
    select calendar_destination_epoch_id into epoch_id from public.appointments where id=appointment_id;
    select * into strict e from public.calendar_destination_epochs where id=epoch_id;
    insert into public.appointments(profile_id,website_id,entitlement_id,service_id,customer_id,environment,start_at,end_at,local_date,local_start,time_zone,
      customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,reservation_expires_at)
      select a.profile_id,a.website_id,a.entitlement_id,a.service_id,a.customer_id,a.environment,a.start_at+interval '1 day',a.end_at+interval '1 day',a.local_date+1,a.local_start,a.time_zone,
        a.customer_snapshot,a.service_snapshot,a.location_snapshot,a.amount_minor,a.currency,a.duration_minutes,tstzrange(a.start_at+interval '1 day',a.end_at+interval '1 day','[)'),
        'payment_pending','pending',clock_timestamp()+interval '15 minutes' from public.appointments a where a.id=appointment_id returning id into unbound;
    original_at:=date_trunc('second',clock_timestamp());
    -- Fixture rows use transaction-time created_at; paid_at is Stripe seconds.
    update public.appointments set created_at=original_at-interval '1 second' where id=unbound;
    insert into public.booking_payments(appointment_id,profile_id,environment,stripe_account_id,checkout_session_id,expected_amount_minor,currency,payment_state)
      values(unbound,tenant,'test','acct_calendar_lifetime','cs_'||unbound,10000,'USD','pending');
    perform pg_temp.pay_calendar_test(unbound);
    context:=public.get_booking_calendar_repair_context(unbound,repeat('9',64));
    perform pg_temp.assert_true(context->>'reviewState'='unresolved_destination' and context->>'linkId' is null,'context exposes unresolved exact snapshot');
    perform pg_temp.assert_true(exists(select 1 from jsonb_array_elements(context->'destinationEpochs')x where x->>'id'=e.id::text),
      'admin repair can inspect retained epoch IDs without a raw database path');
    resolution:=jsonb_build_object('requestId',gen_random_uuid(),'appointmentId',unbound,'profileId',tenant,'environment','test',
      'expectedVersion',(context->>'expectedVersion')::bigint,'destinationEpochId',e.id,'googleEventId',context->>'googleEventId',
      'source',jsonb_build_object('kind','original_reservation_record','reference','retained-original-reservation-case','sha256',repeat('e',64),
        'recordedAt',original_at,'appointmentId',unbound,'accountId',e.pipedream_account_id,'calendarId',e.google_calendar_id));
    generation:=(context->>'expectedGeneration')::bigint;
    denied:=false;
    begin perform public.requeue_booking_calendar_manual_repair(null,generation,repeat('8',64),'Original record reviewed',resolution);exception when insufficient_privilege then denied:=true;end;
    perform pg_temp.assert_true(denied,'repair needs a real admin session');
    denied:=false;
    begin update public.admin_sessions set aal='aal1' where token_hash=repeat('9',64);exception when check_violation then denied:=true;end;
    perform pg_temp.assert_true(denied,'opaque repair authority cannot be minted below AAL2');
    insert into public.calendar_destination_epochs(profile_id,environment,connection_id,calendar_selection_id,connection_revision,pipedream_account_id,google_calendar_id)
      values(gen_random_uuid(),'test',gen_random_uuid(),gen_random_uuid(),1,'apn_foreign','foreign')returning id into foreign_epoch;
    for result in select value from jsonb_array_elements(jsonb_build_array(
      jsonb_set(resolution,'{profileId}',to_jsonb(gen_random_uuid())),
      jsonb_set(resolution,'{destinationEpochId}',to_jsonb(foreign_epoch)),
      jsonb_set(resolution,'{source,kind}','"current_selection"'),
      jsonb_set(resolution,'{source,accountId}','"apn_wrong"'),
      jsonb_set(resolution,'{source,appointmentId}',to_jsonb(gen_random_uuid())),
      jsonb_set(resolution,'{googleEventId}','"obrareplacement123"'),
      jsonb_set(resolution,'{expectedVersion}','999999')
    )) loop
      denied:=false;
      begin perform public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original record reviewed',result);
      exception when invalid_parameter_value or serialization_failure then denied:=true;end;
      perform pg_temp.assert_true(denied,'cross identity/current selection/stale snapshot cannot bind');
    end loop;
    denied:=false;
    begin
      perform public.cancel_contractor_booking(unbound,tenant,'test',owner_id,gen_random_uuid(),repeat('d',64));
      perform public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original record reviewed',resolution);
    exception when serialization_failure then denied:=true;end;
    perform pg_temp.assert_true(denied,'cancellation after context fences unresolved repair');
    denied:=false;
    begin
      insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,actor_auth_user_id)
        values(tenant,'test','pipedream',e.pipedream_account_id,owner_id);
      perform public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original record reviewed',resolution);
    exception when insufficient_privilege then denied:=true;end;
    perform pg_temp.assert_true(denied,'admin evidence cannot bypass explicit disconnect');
    denied:=false;
    begin
      perform set_config('obra.booking_cutover_write_v3','allowed',true);
      update public.booking_cutover_state set status='reconciling' where profile_id=tenant and environment='test';
      perform public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original record reviewed',resolution);
    exception when insufficient_privilege then denied:=true;end;
    perform pg_temp.assert_true(denied,'repair cannot bypass paused cutover');
    -- The other evidence branch validates a retained effect's identity, not
    -- arbitrary supplied provider fields. Roll this branch back for the final
    -- original-record/reselection recovery below.
    declare outbox_id uuid;retained jsonb;
    begin
      insert into public.integration_outbox(appointment_id,profile_id,environment,command_type,idempotency_key,desired_appointment_version,destination_epoch_id,payload)
      values(unbound,tenant,'test','calendar_create','legacy-repair-evidence:'||unbound,1,e.id,
        jsonb_build_object('connectionId',e.connection_id,'selectionId',e.calendar_selection_id,'appointmentId',unbound,'googleEventId',context->>'googleEventId'))returning id into outbox_id;
      retained:=jsonb_set(resolution,'{source}',jsonb_build_object('kind','retained_outbox','id',outbox_id));
      perform pg_temp.assert_true(public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Retained provider intent reviewed',retained),'matching retained outbox is repair evidence');
      raise exception 'rollback regression' using errcode='Z0002';
    exception when sqlstate 'Z0002' then null;end;
    -- First legacy booking can predate any epoch row. The original record, not
    -- current selection, may reconstruct that missing immutable epoch once.
    declare reconstructed jsonb;missing_epoch uuid:=gen_random_uuid();next_revision bigint;
    begin
      update public.calendar_connections set connection_revision=connection_revision+1 where id=c.id returning connection_revision into next_revision;
      reconstructed:=jsonb_set(resolution,'{destinationEpochId}',to_jsonb(missing_epoch))||jsonb_build_object('destinationEpoch',jsonb_build_object(
        'connectionId',e.connection_id,'selectionId',e.calendar_selection_id,'revision',next_revision,'accountId',e.pipedream_account_id,'calendarId',e.google_calendar_id));
      perform pg_temp.assert_true(public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original missing epoch record reviewed',reconstructed),'audited original tuple reconstructs missing legacy epoch');
      perform pg_temp.assert_true((select calendar_destination_epoch_id=missing_epoch from public.appointments where id=unbound)
        and (select pipedream_account_id=e.pipedream_account_id and google_calendar_id=e.google_calendar_id from public.calendar_destination_epochs where id=missing_epoch),'missing epoch retains attested provider identity');
      perform pg_temp.assert_true(public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original missing epoch record reviewed',reconstructed),'reconstructed epoch repair replay is idempotent');
      raise exception 'rollback regression' using errcode='Z0002';
    exception when sqlstate 'Z0002' then null;end;
    -- R10: the same provenance also repairs cancelled/refunded and elapsed
    -- obligations. Money transitions still go through the actual reducer.
    declare cancelled_resolution jsonb;money_snapshot jsonb;refund_item jsonb;cancelled_link public.calendar_event_links;
      payment_before jsonb;case_number integer;repair_observation jsonb;refund_command public.integration_outbox;
    begin
      for case_number in 1..5 loop
        begin
          perform public.cancel_contractor_booking(unbound,tenant,'test',owner_id,gen_random_uuid(),repeat('d',64));
          select o.provider_snapshot into strict money_snapshot from public.booking_stripe_observations_v3 o where o.appointment_id=unbound;
          if case_number between 2 and 4 then
            refund_item:=jsonb_build_object('id','re_cancelled_repair_'||unbound,'object','refund','charge','ch_'||unbound,
              'payment_intent','pi_'||unbound,'status','succeeded','amount',10000,'currency','usd',
              'created',extract(epoch from clock_timestamp())::bigint,'metadata','{}'::jsonb);
            money_snapshot:=jsonb_set(jsonb_set(money_snapshot,'{refunds}',jsonb_build_array(refund_item)),'{charge,amount_refunded}','10000');
            perform pg_temp.calendar_money_observation(unbound,'refund.updated',money_snapshot,refund_item);
          elsif case_number=5 then
            select * into strict refund_command from public.claim_due_booking_outbox('test',lease,1);
            perform pg_temp.assert_true(refund_command.appointment_id=unbound,'failed refund belongs to the cancelled unresolved booking');
            perform public.fail_booking_refund_command_v3(refund_command.id,lease,refund_command.fencing_token,false,'invalid refund evidence');
          end if;
          if case_number=3 then
            -- Advancing the stored appointment time models a later cleanup run,
            -- not a replacement cancellation/refund outcome.
            update public.appointments set start_at=clock_timestamp()-interval '2 hours',end_at=clock_timestamp()-interval '1 hour',
              capacity_range=tstzrange(clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour','[)') where id=unbound;
          end if;
          context:=public.get_booking_calendar_repair_context(unbound,repeat('9',64));
          cancelled_resolution:=jsonb_set(resolution,'{expectedVersion}',context->'expectedVersion');
          select to_jsonb(bp) into payment_before from public.booking_payments bp where bp.appointment_id=unbound;
          denied:=false;
          begin perform public.requeue_booking_calendar_manual_repair(null,(context->>'expectedGeneration')::bigint,
            repeat('9',64),'Cancelled original destination reviewed',jsonb_set(cancelled_resolution,'{source,accountId}','"apn_wrong"'));
            exception when invalid_parameter_value then denied:=true;end;
          perform pg_temp.assert_true(denied,'cancelled repair still requires exact original provider provenance');
          perform pg_temp.assert_true(public.requeue_booking_calendar_manual_repair(null,(context->>'expectedGeneration')::bigint,
            repeat('9',64),'Cancelled original destination reviewed',cancelled_resolution),'cancelled original evidence remains repairable');
          perform pg_temp.assert_true(public.requeue_booking_calendar_manual_repair(null,(context->>'expectedGeneration')::bigint,
            repeat('9',64),'Cancelled original destination reviewed',cancelled_resolution),'cancelled repair response-loss replay is idempotent');
          select * into strict cancelled_link from public.calendar_event_links x where x.appointment_id=unbound;
          perform pg_temp.assert_true(cancelled_link.desired_state='absent' and cancelled_link.destination_epoch_id=e.id
            and cancelled_link.observed_state='unknown','repair binds original absent intent, not presumed absence');
          select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
          cancelled_link:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
          perform pg_temp.assert_true(cancelled_link.appointment_id=unbound,'cancelled repair reaches actual worker claim');
          repair_observation:=pg_temp.observe_calendar_test(cancelled_link,lease2,case when case_number=4 then 'absent' else 'present' end);
          perform pg_temp.assert_true(repair_observation->>'action'=case when case_number=4 then 'converged' else 'delete' end,
            'exact GET proves absence or authorizes only DELETE');
          denied:=false;
          begin perform public.begin_booking_calendar_effect(cancelled_link.id,lease2,cancelled_link.reconcile_fencing_token,
            cancelled_link.desired_generation,cancelled_link.snapshot_appointment_version,'create');exception when serialization_failure then denied:=true;end;
          perform pg_temp.assert_true(denied,'cancelled repair can never authorize CREATE');
          if case_number<>4 then
            effect_id:=public.begin_booking_calendar_effect(cancelled_link.id,lease2,cancelled_link.reconcile_fencing_token,
              cancelled_link.desired_generation,cancelled_link.snapshot_appointment_version,'delete');
            perform public.record_booking_calendar_effect_result(effect_id,lease2,cancelled_link.reconcile_fencing_token,'accepted',204,'{}');
            perform pg_temp.observe_calendar_test(cancelled_link,lease2,'absent','post_effect',effect_id);
          else
            perform pg_temp.assert_true(not exists(select 1 from public.booking_calendar_effect_attempts where link_id=cancelled_link.id),
              'exact absent readback closes without a provider mutation');
          end if;
          perform pg_temp.assert_true((select appointment_state='cancelled' and calendar_state='cancelled' from public.appointments where id=unbound)
            and (select to_jsonb(bp)=payment_before from public.booking_payments bp where bp.appointment_id=unbound),
            'exact cleanup closes calendar without changing payment, refund or cancellation intent');
          if case_number=5 then
            perform pg_temp.assert_true((select review_state='refund_failure' from public.appointments where id=unbound),
              'calendar cleanup does not erase an independent refund review');
          end if;
          raise exception 'rollback R10 case' using errcode='Z0002';
        exception when sqlstate 'Z0002' then null;end;
      end loop;
    end;

    -- Reselect after the reservation; the repair still binds the retained epoch.
    update public.calendar_selections set receives_bookings=false where id=e.calendar_selection_id;
    insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,access_role,blocks_availability,receives_bookings,permission_verified_at)
      values(c.id,tenant,'test','new-repair-calendar','Replacement','owner',false,true,clock_timestamp());
    update public.calendar_connections set connection_revision=connection_revision+1 where id=c.id;
    perform pg_temp.assert_true(public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original record reviewed',resolution),'evidenced unresolved booking binds original destination');
    select * into strict l from public.calendar_event_links x where x.appointment_id=unbound;
    select id into repair_audit from public.booking_calendar_repair_audit r where r.appointment_id=unbound;
    perform pg_temp.assert_true(l.destination_epoch_id=e.id and l.google_event_id=context->>'googleEventId'
      and (select review_state='none' and calendar_state='create_pending' from public.appointments where id=unbound),'repair queues same epoch and truthful pending status');
    perform pg_temp.assert_true(public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original record reviewed',resolution),'exact response-loss replay is idempotent');
    perform pg_temp.assert_true((select count(*)=1 from public.booking_calendar_repair_audit r where r.appointment_id=unbound)
      and (select count(*)=1 from public.calendar_event_links x where x.appointment_id=unbound),'replay never creates a second audit/link/effect');
    denied:=false;
    begin perform public.requeue_booking_calendar_manual_repair(null,generation,repeat('9',64),'Original record reviewed',jsonb_set(resolution,'{googleEventId}','"obraother123"'));exception when unique_violation then denied:=true;end;
    perform pg_temp.assert_true(denied,'repair request identity cannot be reused for another destination');
    denied:=false;
    begin update public.booking_calendar_repair_audit set reason='changed' where id=repair_audit;exception when raise_exception then denied:=true;end;
    perform pg_temp.assert_true(denied,'repair evidence is immutable');
    update public.calendar_event_links set reconcile_status='manual_repair',manual_repair_reason='calendar_identity_conflict',
      failure_kind='configuration',failure_code='calendar_identity_conflict' where id=l.id;
    perform pg_temp.assert_true(public.requeue_booking_calendar_manual_repair(l.id,l.desired_generation,repeat('9',64),'Provider conflict inspected'),
      'shipped four-argument repair call remains supported by the additive RPC');
    perform pg_temp.assert_true((select count(*)=2 from public.booking_calendar_repair_audit r where r.appointment_id=unbound),'ordinary link repair is separately audited');
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
    l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
    perform pg_temp.assert_true(l.appointment_id=unbound and l.destination_epoch_id=e.id,'bound obligation reaches real worker claim');
    perform pg_temp.observe_calendar_test(l,lease,'absent');
    effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'accepted',200,'{}');
    declare cancellation public.calendar_event_links;delete_effect uuid;notice public.booking_notifications;notice_context jsonb;
    begin
      perform public.cancel_contractor_booking(unbound,tenant,'test',owner_id,gen_random_uuid(),repeat('d',64));
      perform pg_temp.assert_true((select appointment_state='cancelled' and calendar_state='cancel_pending' from public.appointments where id=unbound),
        'accepted CREATE before readback remains pending cancellation');
      perform pg_temp.assert_true(not exists(select 1 from public.booking_notifications n where n.appointment_id=unbound
        and n.notification_type='calendar_repaired' and public.booking_notification_event_current_v4(n.id)),
        'legacy repair failure cannot become a false event-removed notice');
      perform pg_temp.assert_true(not public.renew_booking_calendar_reconciliation_v3(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,120),
        'cancellation fences the accepted CREATE claim before readback');
      select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
      cancellation:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
      perform pg_temp.assert_true(cancellation.id=l.id and cancellation.desired_state='absent' and cancellation.desired_generation>l.desired_generation,
        'cancellation retains the same link with a new absent generation');
      perform pg_temp.observe_calendar_test(cancellation,lease2,'present');
      delete_effect:=public.begin_booking_calendar_effect(cancellation.id,lease2,cancellation.reconcile_fencing_token,cancellation.desired_generation,cancellation.snapshot_appointment_version,'delete');
      perform public.record_booking_calendar_effect_result(delete_effect,lease2,cancellation.reconcile_fencing_token,'accepted',204,'{}');
      perform pg_temp.assert_true((select calendar_state='cancel_pending' from public.appointments where id=unbound),'DELETE acceptance alone does not project verified absence');
      perform pg_temp.observe_calendar_test(cancellation,lease2,'absent','post_effect',delete_effect);
      perform pg_temp.assert_true((select calendar_state='cancelled' and appointment_state='cancelled' and payment_state='paid' from public.appointments where id=unbound),
        'exact absence completes calendar cancellation without changing paid truth');
      select x.* into strict notice from public.claim_due_booking_notifications_v3('test',lease2,100,1)x
        where x.appointment_id=unbound and x.notification_type='calendar_repaired' and x.audience='customer';
      notice_context:=public.get_booking_notification_context_v3(notice.id,'test',lease2,notice.fencing_token)->'appointment';
      perform pg_temp.assert_true(public.authorize_booking_notification_dispatch_v3(notice.id,'test',lease2,notice.fencing_token,notice_context,
        jsonb_build_object('from','booking@example.test','to',jsonb_build_array(notice.recipient_email),'subject','Calendar cancellation completed',
          'text','Your appointment remains cancelled. Its event has been removed from the contractor calendar.')::text)->>'action'='dispatch',
        'event-removed notification becomes dispatchable only after verified absence');
      raise exception 'rollback cancellation regression' using errcode='Z0002';
    exception when sqlstate 'Z0002' then null;end;
    perform pg_temp.observe_calendar_test(l,lease,'present','post_effect',effect_id);
    perform pg_temp.assert_true((select calendar_state='created' and payment_state='paid' from public.appointments where id=unbound),'repair reaches fulfillment without changing payment');
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  -- Late recovery is eligible only from an unpaid expired hold, and a new
  -- cancellation between claim and readback wins even over clear availability.
  declare arb public.booking_late_payment_arbitrations;attempt integer;deadline timestamptz;receipt jsonb;cancel_request uuid;
    refund_item jsonb;snapshot jsonb;cmd public.integration_outbox;initial_generation bigint;
  begin
    for attempt in 1..3 loop
      result:=pg_temp.reserve_calendar_test(site,start_time+pg_catalog.make_interval(days=>attempt));
      appointment_id:=(result->>'appointmentId')::uuid;
      p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
      deadline:=clock_timestamp()+interval '31 minutes';
      perform public.prepare_booking_checkout_handoff_v3(p.id,lease,p.checkout_fencing_token,deadline,deadline+interval '5 minutes',repeat('b',64));
      perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||appointment_id,deadline,true,false,null);
      update public.appointments set reservation_expires_at=clock_timestamp()-interval '1 minute' where id=appointment_id;
      if attempt=3 then
        update public.appointments set appointment_state='cancelled',appointment_reason='customer_cancelled',cancellation_requested_at=clock_timestamp(),version=version+1 where id=appointment_id;
      end if;
      result:=pg_temp.pay_calendar_test(appointment_id);
      if attempt=3 then
        perform pg_temp.assert_true(result->>'outcome'='paid_refund_required' and (select appointment_state='cancelled' and appointment_reason='customer_cancelled' and refund_state='pending' from public.appointments where id=appointment_id),
          'first paid evidence after deliberate unpaid cancellation refunds without recovering');
        continue;
      end if;
      perform public.issue_booking_confirmation_capability_v3('cs_'||appointment_id,repeat('f',64),repeat('b',64));
      receipt:=public.consume_booking_confirmation_capability_v3(repeat('f',64),(select public_reference from public.appointments where id=appointment_id));
      perform pg_temp.assert_true(receipt->>'statusCode'='settling' and receipt->'terminal'='false' and receipt->>'pollAfterMs'='2500'
        and receipt->>'automaticPollUntil' is not null and receipt->>'paymentState'='paid','issued receipt treats provisional arbitration as settling, not final cancellation');
      select * into strict late_claim from public.claim_booking_late_payment_arbitrations('test',lease2,1);
      arb:=jsonb_populate_record(null::public.booking_late_payment_arbitrations,late_claim.arbitration);
      if attempt=2 then
        denied:=false;
        begin perform public.cancel_contractor_booking(appointment_id,tenant,'test',gen_random_uuid(),gen_random_uuid(),repeat('d',64));
        exception when insufficient_privilege then denied:=true;end;
        perform pg_temp.assert_true(denied,'provisional cancellation still requires the real owner');
        cancel_request:=gen_random_uuid();
        perform public.cancel_contractor_booking(appointment_id,tenant,'test',owner_id,cancel_request,repeat('d',64));
        select refund_generation into initial_generation from public.appointments where id=appointment_id;
        perform public.cancel_contractor_booking(appointment_id,tenant,'test',owner_id,cancel_request,repeat('d',64));
        perform pg_temp.assert_true((select cancellation_requested_at is not null and appointment_reason='contractor_cancelled' and refund_generation=initial_generation
          and refund_state='pending' from public.appointments where id=appointment_id),'real owner RPC records deliberate intent and idempotent refund generation during arbitration');
        receipt:=public.consume_booking_confirmation_capability_v3(repeat('f',64),(select public_reference from public.appointments where id=appointment_id));
        perform pg_temp.assert_true(receipt->>'statusCode'='refund_pending' and receipt->>'appointmentReason'='contractor_cancelled',
          'owner cancellation receipt no longer presents provisional or automatic late-refund status');
      end if;
      result:=to_jsonb(public.record_booking_late_payment_observation(arb.id,lease2,arb.fencing_token,arb.snapshot_generation,clock_timestamp(),'complete','[]',null));
      if attempt=1 then
        perform pg_temp.assert_true(result='"recovered"' and (select appointment_state='confirmed' from public.appointments where id=appointment_id),'actual expired unpaid hold still recovers');
      else
        perform pg_temp.assert_true(result='"refund_required"' and (select appointment_state='cancelled' and appointment_reason='contractor_cancelled' and refund_state='pending' from public.appointments where id=appointment_id),'cancellation intent checked again at arbitration settlement');
        select o.provider_snapshot into strict snapshot from public.booking_stripe_observations_v3 o where o.appointment_id=appointment_id;
        snapshot:=jsonb_set(snapshot,'{checkout}','null');
        select * into strict cmd from public.claim_due_booking_outbox('test',lease,1);
        result:=public.reduce_booking_financial_evidence_v3('refund_command',cmd.id,lease,cmd.fencing_token,snapshot);
        perform pg_temp.assert_true(result->>'action'='create','cancelled arbitration reaches actual refund preparation');
        refund_item:=jsonb_build_object('id','re_'||appointment_id,'object','refund','charge','ch_'||appointment_id,'payment_intent','pi_'||appointment_id,
          'status','pending','amount',10000,'currency','usd','created',extract(epoch from clock_timestamp())::bigint,
          'metadata',jsonb_build_object('kind','booking_refund','bookingPaymentId',p.id,'bookingAppointmentId',appointment_id,
            'bookingProfileId',tenant,'bookingEnvironment','test','refundGeneration',initial_generation::text,'bookingCommandId',cmd.id));
        snapshot:=jsonb_set(snapshot,'{refunds}',jsonb_build_array(refund_item));
        result:=pg_temp.calendar_money_observation(appointment_id,'refund.updated',snapshot,refund_item);
        perform pg_temp.assert_true(result->>'outcome'='paid_cancelled_preserved','signed pending refund preserves real arbitration cancellation');
        refund_item:=jsonb_set(refund_item,'{status}','"succeeded"');
        snapshot:=jsonb_set(jsonb_set(snapshot,'{refunds}',jsonb_build_array(refund_item)),'{charge,amount_refunded}','10000');
        perform pg_temp.calendar_money_observation(appointment_id,'refund.updated',snapshot,refund_item);
        perform pg_temp.assert_true((select appointment_state='cancelled' and appointment_reason='contractor_cancelled' and refund_state='succeeded'
          and refund_generation=initial_generation from public.appointments where id=appointment_id) and (select state='succeeded' from public.integration_outbox where id=cmd.id),
          'signed refund completion closes the same cancelled arbitration obligation');
      end if;
    end loop;
    raise exception 'rollback regression' using errcode='Z0001';
  exception when sqlstate 'Z0001' then null;end;

  select * into c from public.calendar_connections where id=c.id;
  appointment_id:=null;unbound:=null;attributed:=null;linked:=null;late_unbound:=null;late_bound:=null;
  perform pg_temp.assert_true(inet_server_addr() is null or inet_server_addr() <<= '127.0.0.0/8'::inet,
    'concurrency fixture requires a disposable loopback database');
  perform extensions.dblink_connect('booking_calendar_reserve',format('hostaddr=127.0.0.1 port=%s dbname=%L user=%L connect_timeout=2',
    current_setting('port'),current_database(),current_user));
  begin
    perform extensions.dblink_exec('booking_calendar_reserve',format('do $remote$ begin perform pg_advisory_lock(%s);end $remote$',
      hashtextextended(tenant::text||':test:booking',0)));
    perform set_config('lock_timeout','200ms',true);
    denied:=false;
    begin perform pg_temp.reserve_calendar_test(site,start_time);exception when lock_not_available then denied:=true;end;
    perform set_config('lock_timeout','0',true);
    perform pg_temp.assert_true(denied and not exists(select 1 from public.appointments where profile_id=tenant),
      'concurrent reservation authority cannot admit/bind outside the tenant transaction lock');
    perform extensions.dblink_disconnect('booking_calendar_reserve');
  exception when others then
    perform extensions.dblink_disconnect('booking_calendar_reserve');
    raise;
  end;

  for proc in select oid::regprocedure from pg_proc where proname in ('reserve_booking_hold','ensure_calendar_destination_epoch','reserve_live_booking_before_calendar_lifetime',
    'lock_booking_calendar_claim','resolve_booking_calendar_destination','resolve_late_paid_booking_destination','record_booking_calendar_write_denial',
    'settle_booking_calendar_setup_capability','booking_calendar_content_sha256') loop
    perform pg_temp.assert_true(not has_function_privilege('service_role',proc,'EXECUTE') and not has_function_privilege('booking_worker',proc,'EXECUTE')
      and not has_function_privilege('anon',proc,'EXECUTE'),proc::text||' is not a runtime bypass');
  end loop;
  perform pg_temp.assert_true(not has_table_privilege('booking_worker','public.calendar_event_links','SELECT')
    and not has_table_privilege('booking_worker','public.appointments','UPDATE'),'booking worker remains RPC-only');
  perform pg_temp.assert_true(has_function_privilege('booking_worker','public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)','EXECUTE')
    and not has_function_privilege('service_role','public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)','EXECUTE'),'financial reducer authority unchanged');
  for proc in select oid::regprocedure from pg_proc where proname in ('claim_booking_calendar_reconciliation','renew_booking_calendar_reconciliation_v3',
    'fail_booking_calendar_convergence','record_booking_calendar_observation','begin_booking_calendar_effect','renew_booking_late_payment_arbitration_v3') loop
    perform pg_temp.assert_true((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=proc),proc::text||' retains definer and safe path');
    perform pg_temp.assert_true(has_function_privilege('booking_worker',proc,'EXECUTE') and not has_function_privilege('service_role',proc,'EXECUTE')
      and not has_function_privilege('anon',proc,'EXECUTE') and not has_function_privilege('authenticated',proc,'EXECUTE'),proc::text||' remains worker-only');
  end loop;
  perform pg_temp.assert_true((select count(*)=1 from pg_proc where proname='fail_booking_calendar_convergence'),
    'defaulted failure API has one implementation, not ambiguous overloads');
  perform pg_temp.assert_true((select count(*)=1 from pg_proc where proname='requeue_booking_calendar_manual_repair')
    and has_function_privilege('service_role','public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)','EXECUTE')
    and not has_function_privilege('booking_worker','public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)','EXECUTE'),
    'one additive repair API preserves service-only audited mutation');
  perform pg_temp.assert_true(not has_table_privilege('service_role','public.appointments','UPDATE')
    and not has_table_privilege('service_role','public.booking_calendar_repair_audit','INSERT'),'repair adds no raw table authority');

  -- Every required permission, Google/trigger/Stripe timestamp and identity must be current.
  for result in select value from jsonb_array_elements('["selection_stale","selection_future","google_stale","google_future","trigger_stale","trigger_future","trigger_account","stripe_stale","stripe_future","stripe_requirements","stripe_capability","write_blocked"]') loop
    denied:=false;
    begin
      case result#>>'{}'
        when 'selection_stale' then update public.calendar_selections set permission_verified_at=clock_timestamp()-interval '16 minutes' where connection_id=c.id and google_calendar_id='busy';
        when 'selection_future' then update public.calendar_selections set permission_verified_at=clock_timestamp()+interval '2 minutes' where connection_id=c.id and google_calendar_id='destination';
        when 'google_stale' then update public.calendar_connections set last_verified_at=clock_timestamp()-interval '16 minutes' where id=c.id;
        when 'google_future' then update public.calendar_connections set last_verified_at=clock_timestamp()+interval '2 minutes' where id=c.id;
        when 'trigger_stale' then update public.pipedream_bindings set last_health_at=clock_timestamp()-interval '16 minutes' where id=b.id;
        when 'trigger_future' then update public.pipedream_bindings set last_health_at=clock_timestamp()+interval '2 minutes' where id=b.id;
        when 'trigger_account' then update public.pipedream_bindings set pipedream_account_id='apn_wrong' where id=b.id;
        when 'stripe_stale' then update public.stripe_connected_accounts set last_verified_at=clock_timestamp()-interval '16 minutes' where profile_id=tenant;
        when 'stripe_future' then update public.stripe_connected_accounts set last_verified_at=clock_timestamp()+interval '2 minutes' where profile_id=tenant;
        when 'stripe_requirements' then update public.stripe_connected_accounts set requirements='{}' where profile_id=tenant;
        when 'stripe_capability' then update public.stripe_connected_accounts set capabilities='{}' where profile_id=tenant;
        when 'write_blocked' then update public.calendar_connections set verification_reason='calendar_write_blocked' where id=c.id;
      end case;
      perform pg_temp.reserve_calendar_test(site,start_time);
    exception when raise_exception then denied:=true;end;
    perform pg_temp.assert_true(denied,'admission rejects '||result::text);
    perform pg_temp.assert_true(not exists(select 1 from public.appointments where profile_id=tenant),'rejected admission rolls back appointment/epoch/customer');
  end loop;

  result:=pg_temp.reserve_calendar_test(site,start_time,request_id);
  appointment_id:=(result->>'appointmentId')::uuid;
  select calendar_destination_epoch_id into strict epoch_id from public.appointments where id=appointment_id;
  select * into strict e from public.calendar_destination_epochs where id=epoch_id;
  perform pg_temp.assert_true(e.pipedream_account_id='apn_calendar_lifetime' and e.google_calendar_id='destination','reserve binds original immutable destination');
  perform pg_temp.assert_true((result->>'holdExpiresAt')::timestamptz between clock_timestamp()+interval '14 minutes' and clock_timestamp()+interval '15 minutes 1 second','hold was not extended');
  perform pg_temp.assert_true(not exists(select 1 from public.calendar_event_links x where x.appointment_id=appointment_id)
    and not exists(select 1 from public.booking_calendar_effect_attempts x where x.appointment_id=appointment_id)
    and not exists(select 1 from public.booking_notifications x where x.appointment_id=appointment_id),'reservation alone schedules no event/invitation/email');
  lease:=gen_random_uuid();
  p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
  perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||appointment_id,clock_timestamp()+interval '31 minutes',true,false,null);

  -- Reselection changes only new admission; payment no longer needs selections.
  update public.calendar_selections set receives_bookings=false where id=e.calendar_selection_id;
  insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,access_role,blocks_availability,receives_bookings,permission_verified_at)
    values(c.id,tenant,'test','replacement','Replacement','owner',false,true,clock_timestamp());
  update public.calendar_connections set connection_revision=connection_revision+1 where id=c.id;
  insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,actor_auth_user_id)
    values(tenant,'test','pipedream',e.pipedream_account_id,owner_id);
  perform pg_temp.assert_true((pg_temp.reserve_calendar_test(site,start_time,request_id)->>'appointmentId')::uuid=appointment_id,'authorized replay survives reselect/disconnect');
  denied:=false;
  begin perform pg_temp.reserve_calendar_test(site,start_time,request_id,repeat('c',64));exception when insufficient_privilege then denied:=true;end;
  perform pg_temp.assert_true(denied,'replay still requires exact request capability');
  denied:=false;
  begin perform pg_temp.pay_calendar_test(appointment_id,'bad_amount',true);exception when raise_exception then denied:=true;end;
  perform pg_temp.assert_true(denied and (select payment_state='pending' from public.booking_payments where id=p.id),'payment validation still rejects wrong money evidence');
  result:=pg_temp.pay_calendar_test(appointment_id);
  perform pg_temp.assert_true(result->>'outcome'='paid_confirmed','payment settles after disconnect/reselect');
  select * into strict l from public.calendar_event_links x where x.appointment_id=appointment_id;
  perform pg_temp.assert_true(l.destination_epoch_id=epoch_id and l.calendar_selection_id=e.calendar_selection_id,'paid obligation remains on admitted epoch');
  perform pg_temp.assert_true((select amount_paid_minor=10000 and payment_state='paid' from public.booking_payments where id=p.id),'financial truth durable');
  update public.booking_notifications n set state='accepted',provider_message_id='email_fixture_'||n.id
    where n.appointment_id=appointment_id and n.notification_type='confirmed';
  perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',lease,1)),'pending disconnect excludes calendar work');
  update public.booking_provider_account_disconnects_v3 set state='completed' where profile_id=tenant;
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',lease,1)),'completed disconnect excludes historical calendar work');
  -- Test-only rollback of the intent, not a production reauthorization path.
  delete from public.booking_provider_account_disconnects_v3 where profile_id=tenant;

  -- Legacy checkout: no current-selection fallback, but retained effect/link evidence is attributable.
  select customer_id into customer from public.appointments where id=appointment_id;
  for result in select value from jsonb_array_elements('["unbound","attributed","linked"]') loop
    insert into public.appointments(profile_id,website_id,entitlement_id,service_id,customer_id,environment,start_at,end_at,local_date,local_start,time_zone,
      customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,reservation_expires_at)
    select tenant,site,a.entitlement_id,service,customer,'test',a.start_at+interval '2 days',a.end_at+interval '2 days',a.local_date+2,a.local_start,'UTC',
      a.customer_snapshot,a.service_snapshot,a.location_snapshot,10000,'USD',60,tstzrange(a.start_at+interval '2 days',a.end_at+interval '2 days','[)'),
      'payment_pending','pending',clock_timestamp()+interval '15 minutes' from public.appointments a where a.id=coalesce(linked,attributed,unbound,appointment_id)
      returning id into unbound;
    insert into public.booking_payments(appointment_id,profile_id,environment,stripe_account_id,checkout_session_id,expected_amount_minor,currency,payment_state)
      values(unbound,tenant,'test','acct_calendar_lifetime','cs_'||unbound,10000,'USD','pending');
    if result#>>'{}'='attributed' then
      attributed:=unbound;
      insert into public.integration_outbox(appointment_id,profile_id,environment,command_type,idempotency_key,desired_appointment_version,destination_epoch_id,payload)
        values(unbound,tenant,'test','calendar_create','historic:'||unbound,1,epoch_id,
          jsonb_build_object('connectionId',e.connection_id,'selectionId',e.calendar_selection_id,'appointmentId',unbound,'googleEventId','obrahistoric12345'));
    elsif result#>>'{}'='linked' then
      linked:=unbound;
      insert into public.calendar_event_links(appointment_id,profile_id,environment,connection_id,calendar_selection_id,google_event_id,destination_epoch_id,desired_appointment_version)
        values(unbound,tenant,'test',e.connection_id,e.calendar_selection_id,'obralink12345',epoch_id,1);
    end if;
    perform pg_temp.pay_calendar_test(unbound);
    if result#>>'{}'='unbound' then
      perform pg_temp.assert_true((select payment_state='paid' and calendar_state='create_failed' and review_state='unresolved_destination'
        and calendar_destination_epoch_id is null from public.appointments where id=unbound),'unbound payment remains paid with explicit review');
      perform pg_temp.assert_true(not exists(select 1 from public.calendar_event_links x where x.appointment_id=unbound),'unbound obligation creates no unowned event');
      perform pg_temp.assert_true(public.booking_confirmation_projection_v3(unbound)->>'statusCode'='confirmed_calendar_failed','receipt does not lie about delivery');
    else
      perform pg_temp.assert_true((select calendar_destination_epoch_id=epoch_id from public.appointments where id=unbound),'legacy retained evidence binds original epoch');
    end if;
  end loop;

  for result in select value from jsonb_array_elements('["late_unbound","late_bound"]') loop
    insert into public.appointments(profile_id,website_id,entitlement_id,service_id,customer_id,environment,start_at,end_at,local_date,local_start,time_zone,
      customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,
      reservation_expires_at,calendar_destination_epoch_id)
    select tenant,site,a.entitlement_id,service,customer,'test',a.start_at+interval '2 days',a.end_at+interval '2 days',a.local_date+2,a.local_start,'UTC',
      a.customer_snapshot,a.service_snapshot,a.location_snapshot,10000,'USD',60,tstzrange(a.start_at+interval '2 days',a.end_at+interval '2 days','[)'),
      'payment_pending','pending',clock_timestamp()-interval '1 minute',case when result#>>'{}'='late_bound' then epoch_id else null end
      from public.appointments a where a.id=coalesce(late_unbound,linked) returning id into late_bound;
    if result#>>'{}'='late_unbound' then late_unbound:=late_bound;end if;
    insert into public.booking_payments(appointment_id,profile_id,environment,stripe_account_id,checkout_session_id,expected_amount_minor,currency,payment_state)
      values(late_bound,tenant,'test','acct_calendar_lifetime','cs_'||late_bound,10000,'USD','pending');
    perform pg_temp.pay_calendar_test(late_bound);
    perform pg_temp.assert_true((select payment_state='paid' and appointment_reason='late_payment_arbitration' and refund_state='not_requested'
      from public.appointments where id=late_bound),'expired hold uses unchanged paid arbitration, not a calendar-triggered refund');
    perform pg_temp.assert_true(exists(select 1 from public.booking_late_payment_arbitrations x where x.appointment_id=late_bound),
      'late-payment financial policy remains with arbitration authority');
    perform pg_temp.assert_true(not exists(select 1 from public.calendar_event_links x where x.appointment_id=late_bound),
      'destination resolution alone never enqueues a late payment calendar effect');
  end loop;
  perform pg_temp.assert_true((select review_state='unresolved_destination' and calendar_destination_epoch_id is null from public.appointments where id=late_unbound),
    'unbound late payment records financial truth with unresolved destination review');
  perform pg_temp.assert_true((select calendar_destination_epoch_id=epoch_id from public.appointments where id=late_bound),
    'bound late payment retains original epoch through arbitration');
  select * into strict late_claim from public.claim_booking_late_payment_arbitrations('test',gen_random_uuid(),1);
  insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,actor_auth_user_id)
    values(tenant,'test','pipedream',e.pipedream_account_id,owner_id);
  perform pg_temp.assert_true(not public.renew_booking_late_payment_arbitration_v3((late_claim.arbitration->>'id')::uuid,
    (late_claim.arbitration->>'lease_token')::uuid,(late_claim.arbitration->>'fencing_token')::bigint,
    (late_claim.arbitration->>'snapshot_generation')::bigint,90),'disconnect also fences late-payment provider evidence collection');
  delete from public.booking_provider_account_disconnects_v3 where profile_id=tenant;

  -- Permission recovery belongs to the retained epoch, not the new connection's
  -- readiness or selected calendars. Only exact readback can authorize its effect.
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp()+interval '1 day' where profile_id=tenant and id<>l.id;
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp(),failure_kind=null,failure_code=null where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform public.fail_booking_calendar_convergence(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,
    true,null,'permissions','calendar_permissions_changed');
  update public.calendar_selections set active=false,receives_bookings=false where id=e.calendar_selection_id;
  update public.calendar_connections set pipedream_account_id='apn_calendar_reselected',connection_revision=connection_revision+1,
    health_state='pending',last_verified_at=null where id=c.id;
  update public.calendar_event_links set reconcile_attempts=9,reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.assert_true(l.reconcile_attempts=10 and l.destination_epoch_id=epoch_id and l.snapshot_connection_revision is null
    and claim.epoch->>'pipedream_account_id'=e.pipedream_account_id and claim.epoch->>'google_calendar_id'=e.google_calendar_id,
    'due historical permission retry retains old account/inactive destination without current readiness');
  denied:=false;
  begin perform public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    exception when serialization_failure then denied:=true;end;
  perform pg_temp.assert_true(denied,'historical permission retry does not authorize effects before fresh exact readback');
  result:=pg_temp.observe_calendar_test(l,lease,'absent');
  perform pg_temp.assert_true(result->>'action'='create','restored retained-calendar read permits the existing desired effect');
  effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
  perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'accepted',200,'{}');
  result:=pg_temp.observe_calendar_test(l,lease,'present','post_effect',effect_id);
  perform pg_temp.assert_true(result->>'action'='converged' and (select failure_kind is null and sync_state='created' and destination_epoch_id=epoch_id
    from public.calendar_event_links where id=l.id),'restored historical permission delivers without moving its epoch');
  perform pg_temp.assert_true((select pipedream_account_id='apn_calendar_reselected' and health_state='pending' and last_verified_at is null
    and calendar_write_verified_at is null from public.calendar_connections where id=c.id),'historical success does not fabricate current account readiness');

  update public.calendar_event_links set reconcile_status='manual_repair',failure_kind='permissions',failure_code='calendar_permissions_changed',
    failure_observed_at=clock_timestamp(),manual_repair_reason='calendar_permissions_changed',reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.assert_true(l.destination_epoch_id=epoch_id,'known permission-only manual recovery can verify exact historical epoch');
  perform public.fail_booking_calendar_convergence(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,
    true,null,'reauthorization','provider_reauthorization_required');
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',gen_random_uuid(),1)),
    'explicit historical revocation is not bypassed by permission-retry recovery');
  update public.calendar_event_links set failure_kind='permissions',failure_code='calendar_permissions_changed',reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.observe_calendar_test(l,lease,'absent');
  insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,actor_auth_user_id)
    values(tenant,'test','pipedream',e.pipedream_account_id,owner_id);
  perform pg_temp.assert_true(not public.renew_booking_calendar_reconciliation_v3(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,120),
    'disconnect of retained account fences in-flight historical recovery');
  denied:=false;
  begin perform public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
    exception when insufficient_privilege then denied:=true;end;
  perform pg_temp.assert_true(denied,'historical recovered permission cannot override a new disconnect');
  update public.calendar_event_links set reconcile_lease_expires_at=clock_timestamp()-interval '1 second',reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',gen_random_uuid(),1)),
    'pending disconnect excludes retained account after reselection');
  update public.booking_provider_account_disconnects_v3 set state='completed' where profile_id=tenant;
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',gen_random_uuid(),1)),
    'completed disconnect still excludes retained account after reselection');
  delete from public.booking_provider_account_disconnects_v3 where profile_id=tenant;

  -- Restore the admitted destination as the same account, with a new configuration
  -- revision. Claims snapshot that revision for scoped readiness feedback.
  update public.calendar_selections set receives_bookings=false where connection_id=c.id and receives_bookings;
  update public.calendar_selections set active=true,receives_bookings=true,permission_verified_at=clock_timestamp() where id=e.calendar_selection_id;
  update public.calendar_connections set pipedream_account_id=e.pipedream_account_id,connection_revision=connection_revision+1,health_state='healthy',verification_reason=null,
    last_verified_at=clock_timestamp() where id=c.id returning * into c;
  update public.pipedream_bindings set configuration_revision=c.connection_revision,pipedream_account_id=c.pipedream_account_id,
    selected_calendar_ids='["busy"]',deployed_trigger_id='dc_calendar_reconfigured',trigger_state='active',last_health_at=clock_timestamp(),
    reconciliation_due_at=clock_timestamp() where id=b.id returning * into b;
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp()+interval '1 day' where profile_id=tenant and id<>l.id;
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp(),failure_kind=null,failure_code=null where id=l.id;
  lease:=gen_random_uuid();
  select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.assert_true(l.snapshot_connection_revision=c.connection_revision,'claim scopes feedback to current config without rekeying epoch');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',lease2,1)),'live claim excludes a competing owner');
  perform pg_temp.observe_calendar_test(l,lease,'absent');
  effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
  perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'failed',403,'{}');
  generation:=c.availability_generation;
  result:=pg_temp.observe_calendar_test(l,lease,'absent','post_effect',effect_id,'permissions','calendar_write_blocked');
  perform pg_temp.assert_true(result->>'action'='retry','write denial preserves retry path');
  perform pg_temp.assert_true((select verification_reason='calendar_write_blocked' and calendar_write_blocked_at is not null
    and connection_revision=c.connection_revision and availability_generation>generation from public.calendar_connections where id=c.id),'write denial invalidates availability, not configuration');
  verify_claim:=public.claim_saved_google_calendar_verification(tenant,'test',lease2,60,false);
  fence:=(verify_claim->'binding'->>'reconciliation_fencing_token')::bigint;
  perform public.mark_google_calendar_connection_verified(b.id,lease2,fence,clock_timestamp(),
    '[{"id":"busy","accessRole":"reader"},{"id":"destination","accessRole":"owner"},{"id":"replacement","accessRole":"owner"}]');
  perform pg_temp.assert_true((select verification_reason='calendar_write_blocked' and health_state='degraded' from public.calendar_connections where id=c.id),
    'full read-only lifecycle verification cannot erase booking write denial');
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp(),reconcile_attempts=9 where id=l.id;
  lease:=gen_random_uuid();
  select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.assert_true(l.reconcile_attempts=10,'same-account fresh authorization resumes dependency retry beyond eight');
  old_claim:=l;
  perform pg_temp.observe_calendar_test(l,lease,'absent');
  effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
  perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'ambiguous',503,'{}');
  result:=pg_temp.observe_calendar_test(l,lease,'present','post_effect',effect_id);
  perform pg_temp.assert_true(result->>'action'='converged','lost insert response converges exact event without another create');
  perform pg_temp.assert_true((select calendar_write_blocked_at is null and verification_reason is null and calendar_write_verified_at is not null
    from public.calendar_connections where id=c.id),'same configuration attendee write plus readback clears blocker: '||
      (select jsonb_build_object('blocked',x.calendar_write_blocked_at,'verified',x.calendar_write_verified_at,'revision',x.connection_revision,
        'snapshotRevision',l.snapshot_connection_revision,'effectStart',(select started_at from public.booking_calendar_effect_attempts where id=effect_id))::text
        from public.calendar_connections x where x.id=c.id));
  perform pg_temp.assert_true(not public.fail_booking_calendar_convergence(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,
    true,null,'permissions','calendar_write_blocked'),'late failure cannot undo converged claim');

  -- A later denial cannot be cleared by reading an earlier accepted event. Only
  -- the exact current retry's successful write can answer that capability question.
  update public.calendar_connections set calendar_create_blocked_at=clock_timestamp(),verification_reason='calendar_write_blocked' where id=c.id;
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.observe_calendar_test(l,lease,'present');
  perform pg_temp.assert_true((select verification_reason='calendar_write_blocked' from public.calendar_connections where id=c.id),
    'ordinary existing-event GET cannot clear a newer write denial');
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.observe_calendar_test(l,lease,'absent');
  effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
  -- Lose the INSERT and effect-result response entirely, then take over the lease.
  update public.calendar_event_links set reconcile_lease_expires_at=clock_timestamp()-interval '1 second' where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  result:=pg_temp.observe_calendar_test(l,lease,'present');
  perform pg_temp.assert_true(result->>'action'='converged' and (select calendar_write_blocked_at is null from public.calendar_connections where id=c.id),
    'takeover readback of attributable newer create clears its blocker without another INSERT');
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.observe_calendar_test(l,lease,'absent');
  effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'create');
  perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'failed',403,'{}');
  result:=pg_temp.observe_calendar_test(l,lease,'present','post_effect',effect_id,'permissions','calendar_write_blocked');
  perform pg_temp.assert_true(result->>'action'='converged' and (select verification_reason='calendar_write_blocked' from public.calendar_connections where id=c.id),
    'correct readback can settle an event but cannot erase confirmed write denial');
  -- Test-only explicit different configuration, with verified owner configuration
  -- responsible for replacing the blocker in production.
  update public.calendar_connections set connection_revision=connection_revision+1,verification_reason=null,health_state='healthy' where id=c.id;

  -- Exact GET takeover, generation/replay fences, no blanket manual repair replay.
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  before_count:=(select count(*) from public.booking_calendar_effect_attempts where link_id=l.id);
  result:=pg_temp.observe_calendar_test(l,lease,'present');
  perform pg_temp.assert_true(result->>'action'='converged' and (select count(*)=before_count from public.booking_calendar_effect_attempts where link_id=l.id),'takeover finds event without duplicate effect');
  denied:=false;
  begin perform pg_temp.observe_calendar_test(l,lease,'absent');exception when serialization_failure then denied:=true;end;
  perform pg_temp.assert_true(denied,'observation replay cannot replace a settled readback');
  denied:=false;
  begin update public.appointments set calendar_destination_epoch_id=null where id=l.appointment_id;exception when check_violation then denied:=true;end;
  perform pg_temp.assert_true(denied,'reservation destination cannot be unbound');
  denied:=false;
  begin update public.calendar_event_links set google_event_id='obraother123' where id=l.id;exception when check_violation then denied:=true;end;
  perform pg_temp.assert_true(denied,'existing deterministic event identity is immutable');
  denied:=false;
  begin update public.calendar_destination_epochs set google_calendar_id='replacement' where id=epoch_id;exception when check_violation then denied:=true;end;
  perform pg_temp.assert_true(denied,'epoch calendar cannot be rekeyed');

  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  old_claim:=l;
  update public.calendar_event_links set reconcile_lease_expires_at=clock_timestamp()-interval '1 second' where id=l.id;
  lease2:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease2,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.assert_true(l.reconcile_fencing_token=old_claim.reconcile_fencing_token+1,'expired claim receives a new fence');
  perform pg_temp.assert_true(not public.renew_booking_calendar_reconciliation_v3(old_claim.id,lease,old_claim.reconcile_fencing_token,
    old_claim.desired_generation,old_claim.snapshot_appointment_version,120),'old lease cannot renew after takeover');
  perform pg_temp.assert_true(not public.fail_booking_calendar_convergence(old_claim.id,lease,old_claim.reconcile_fencing_token,
    old_claim.desired_generation,old_claim.snapshot_appointment_version,true,null,'permissions','calendar_write_blocked'),'stale permission denial cannot overwrite takeover');
  lease:=lease2;
  update public.calendar_event_links set reconcile_attempts=10 where id=l.id;
  perform public.fail_booking_calendar_convergence(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,
    true,'unsafe provider prose','platform','provider_platform');
  perform pg_temp.assert_true((select reconcile_status='retry_wait' and reconcile_next_attempt_at between clock_timestamp()+interval '29 minutes'
    and clock_timestamp()+interval '61 minutes' and safe_error='provider_platform' and failure_kind='platform' from public.calendar_event_links where id=l.id),
    'real dependency exhaustion is a slow due retry, not terminal/manual or raw provider prose');
  update public.calendar_event_links set reconcile_status='manual_repair',failure_kind=null,failure_code=null,
    manual_repair_reason='permanent_provider_failure',reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',gen_random_uuid(),1)),
    'unknown historic manual repairs require audited operator action');
  update public.calendar_event_links set failure_kind='permissions',failure_code='calendar_write_blocked',failure_observed_at=clock_timestamp()-interval '1 minute',
    manual_repair_reason='calendar_write_blocked',reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  update public.calendar_selections set permission_verified_at=clock_timestamp() where id=e.calendar_selection_id;
  update public.calendar_connections set last_verified_at=clock_timestamp(),health_state='healthy' where id=c.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.assert_true(l.reconcile_status='processing','known same-account permission repair resumes only after fresh scoped evidence');
  perform pg_temp.observe_calendar_test(l,lease,'present');

  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  result:=pg_temp.observe_calendar_test(l,lease,'conflict');
  perform pg_temp.assert_true(result->>'action'='manual_repair','content/identity conflicts require audited repair');
  update public.calendar_connections set health_state='healthy',last_verified_at=clock_timestamp() where id=c.id;
  update public.calendar_event_links set reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',lease2,1)),'fresh account does not blindly replay conflict');
  perform pg_temp.pay_calendar_test(l.appointment_id,'replay');
  perform pg_temp.assert_true((select reconcile_status='manual_repair' and failure_code='calendar_identity_conflict' from public.calendar_event_links where id=l.id),
    'paid event replay preserves manual conflict and original event');
  update public.appointments set appointment_state='cancelled',calendar_generation=calendar_generation+1,version=version+1 where id=l.appointment_id;
  perform pg_temp.assert_true((select reconcile_status='manual_repair' and desired_state='absent' from public.calendar_event_links where id=l.id),'cancellation changes desire without wiping manual identity conflict');
  perform pg_temp.assert_true(not public.fail_booking_calendar_convergence(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,
    true,null,'permissions','calendar_write_blocked'),'stale generation failure cannot degrade readiness');

  -- A permission failure for an already-owned event is scoped; reconfiguration
  -- after claim must not inherit stale denial. New pending disconnect wins at dispatch.
  update public.calendar_event_links set reconcile_status='due',reconcile_next_attempt_at=clock_timestamp(),failure_kind=null,failure_code=null where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.observe_calendar_test(l,lease,'present');
  update public.calendar_connections set connection_revision=connection_revision+1 where id=c.id;
  effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'delete');
  perform public.fail_booking_calendar_convergence(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,
    true,null,'permissions','calendar_write_blocked');
  perform pg_temp.assert_true((select verification_reason is null from public.calendar_connections where id=c.id),'stale configuration denial does not poison readiness');
  update public.calendar_event_links set reconcile_status='due',failure_kind=null,failure_code=null,reconcile_next_attempt_at=clock_timestamp() where id=l.id;
  lease:=gen_random_uuid();select * into strict claim from public.claim_booking_calendar_reconciliation('test',lease,1);
  l:=jsonb_populate_record(null::public.calendar_event_links,claim.link);
  perform pg_temp.observe_calendar_test(l,lease,'present');
  insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,actor_auth_user_id)
    values(tenant,'test','pipedream',e.pipedream_account_id,owner_id);
  perform pg_temp.assert_true(not public.renew_booking_calendar_reconciliation_v3(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,120),
    'new disconnect after claim fences provider work');
  denied:=false;
  begin perform public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'delete');
    exception when insufficient_privilege then denied:=true;end;
  perform pg_temp.assert_true(denied,'new disconnect forbids historical cancellation effect too');
  delete from public.booking_provider_account_disconnects_v3 where profile_id=tenant;
  -- A request dispatched by the old desired generation may finish after cancel.
  -- The new owner reads the same ID and compensates with DELETE, never rekeys.
  effect_id:=public.begin_booking_calendar_effect(l.id,lease,l.reconcile_fencing_token,l.desired_generation,l.snapshot_appointment_version,'delete');
  perform public.record_booking_calendar_effect_result(effect_id,lease,l.reconcile_fencing_token,'accepted',204,'{}');
  result:=pg_temp.observe_calendar_test(l,lease,'absent','post_effect',effect_id);
  perform pg_temp.assert_true(result->>'action'='converged' and (select desired_state='absent' and sync_state='cancelled' from public.calendar_event_links where id=l.id),
    'cancellation compensation preserves exact identity and absence readback');
  perform pg_temp.assert_true((select payment_state='paid' and refund_state='not_requested' from public.booking_payments x where x.appointment_id=l.appointment_id),
    'calendar compensation never changes paid truth/refund policy');
  perform public.project_booking_notifications_v3(l.appointment_id);
  perform pg_temp.assert_true((select count(*)=2 and bool_and(state='accepted') from public.booking_notifications n
    where n.appointment_id=appointment_id and n.notification_type='confirmed'),'calendar retries/payment replay never resend accepted confirmation emails');

  -- A separate PostgreSQL backend holds the same appointment lock used by
  -- cancellation/financial settlement. A just-in-time claim must skip it.
  perform pg_temp.assert_true(inet_server_addr() is null or inet_server_addr() <<= '127.0.0.0/8'::inet,
    'concurrency fixture requires a disposable loopback database');
  insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,start_at,end_at,local_date,local_start,time_zone,
    customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,
    calendar_destination_epoch_id)
  select concurrent_appointment,tenant,site,a.entitlement_id,service,customer,'test',a.start_at+interval '12 days',a.end_at+interval '12 days',a.local_date+12,a.local_start,'UTC',
    a.customer_snapshot,a.service_snapshot,a.location_snapshot,10000,'USD',60,tstzrange(a.start_at+interval '12 days',a.end_at+interval '12 days','[)'),
    'confirmed','paid',epoch_id from public.appointments a where a.id=appointment_id;
  perform public.enqueue_booking_calendar_create(concurrent_appointment);
  perform extensions.dblink_connect('booking_calendar_lock',format('hostaddr=127.0.0.1 port=%s dbname=%L user=%L connect_timeout=2',
    current_setting('port'),current_database(),current_user));
  begin
    perform extensions.dblink_exec('booking_calendar_lock',format('do $remote$ begin perform pg_advisory_lock(%s);end $remote$',
      hashtextextended(concurrent_appointment::text||':booking-appointment',0)));
    perform pg_temp.assert_true(not exists(select 1 from public.claim_booking_calendar_reconciliation('test',gen_random_uuid(),1)),
      'calendar claim skips concurrent appointment authority instead of taking an obsolete snapshot');
    perform extensions.dblink_exec('booking_calendar_lock',format('do $remote$ begin perform pg_advisory_unlock(%s);end $remote$',
      hashtextextended(concurrent_appointment::text||':booking-appointment',0)));
    select * into strict claim from public.claim_booking_calendar_reconciliation('test',gen_random_uuid(),1);
    perform pg_temp.assert_true(claim.link->>'appointment_id'=concurrent_appointment::text,'released concurrent appointment resumes same durable obligation');
    perform extensions.dblink_disconnect('booking_calendar_lock');
  exception when others then
    perform extensions.dblink_disconnect('booking_calendar_lock');
    raise;
  end;
end $test$;
rollback;
\echo 'booking-calendar-lifetime: passed (rolled back)'
