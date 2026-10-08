\set ON_ERROR_STOP on
\if :{?notification_worker_fixture}
\else
  \set notification_worker_fixture false
\endif
\if :{?notification_legacy_fixture}
\else
  \set notification_legacy_fixture false
\endif

begin;
create function pg_temp.assert_notification(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'assertion failed: %',message;end if;end $$;
select pg_temp.assert_notification(inet_server_addr() is null or inet_server_addr() <<= '127.0.0.0/8'::inet,
  'notification tests require disposable local PostgreSQL');

-- Seed existing aggregate facts, not a replacement financial/calendar reducer.
-- Every scenario has a separate tenant; only real notification RPCs deliver it.
create function pg_temp.notification_fixture(appointment_id uuid default gen_random_uuid()) returns uuid language plpgsql as $$
declare tenant uuid:=gen_random_uuid();owner_id uuid:=gen_random_uuid();site uuid:=gen_random_uuid();
  entitlement uuid:=gen_random_uuid();service uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();
  start_time timestamptz:=date_trunc('day',clock_timestamp())+interval '5 days 10 hours';
begin
  insert into auth.users(id,email) values(owner_id,'notification-owner@example.test');
  insert into public.profiles(id,auth_user_id,license_number,email,environment)
    values(tenant,owner_id,'NOTIFICATION-LIFETIME-'||tenant,'contractor@example.test','test');
  insert into public.websites(id,user_id,status,environment) values(site,tenant,'draft','test');
  insert into public.website_entitlements(id,profile_id,website_id,environment,plan,state,booking_admission)
    values(entitlement,tenant,site,'test','pro','active',true);
  insert into public.booking_services(id,profile_id,environment,name,duration_minutes,amount_minor,currency,active)
    values(service,tenant,'test','Repair',60,1000,'USD',true);
  insert into public.booking_customers(id,profile_id,environment,full_name,email_normalized,phone_normalized,address_snapshot,source_website_id)
    values(customer,tenant,'test','Notification test','customer@example.test','+15555550123','{}',site);
  insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,
    start_at,end_at,local_date,local_start,time_zone,customer_snapshot,service_snapshot,location_snapshot,
    amount_minor,currency,duration_minutes,capacity_range,appointment_state,appointment_reason,payment_state,calendar_state,confirmed_at)
    values(appointment_id,tenant,site,entitlement,service,customer,'test',start_time,start_time+interval '1 hour',
      start_time::date,start_time::time,'UTC','{"email":"customer@example.test"}','{"name":"Repair"}','{}',
      1000,'USD',60,tstzrange(start_time,start_time+interval '1 hour','[)'),'confirmed','paid_confirmed','paid','created',clock_timestamp());
  insert into public.booking_payments(appointment_id,profile_id,environment,stripe_account_id,checkout_session_id,
    payment_intent_id,charge_id,expected_amount_minor,currency,payment_state,amount_paid_minor,paid_at)
    values(appointment_id,tenant,'test','acct_notification_lifetime','cs_'||appointment_id,
      'pi_'||appointment_id,'ch_'||appointment_id,1000,'USD','paid',1000,clock_timestamp());
  perform public.project_booking_notifications_v3(appointment_id);
  return appointment_id;
end $$;

-- Full provider snapshots enter the unchanged financial reducer. Runtime tests
-- use its worker role; the primary SQL harness retains its constrained owner.
create function pg_temp.notification_refund(appointment_id uuid,refunds jsonb default '[]') returns jsonb language plpgsql as $$
declare p public.booking_payments;cmd public.integration_outbox;lease uuid:=gen_random_uuid();snapshot jsonb;result jsonb;
  original_role text:=current_user;
begin
  select bp.* into strict p from public.booking_payments bp where bp.appointment_id=notification_refund.appointment_id;
  update public.integration_outbox set next_attempt_at=clock_timestamp()
    where integration_outbox.appointment_id=p.appointment_id and command_type='refund' and effect_generation=p.refund_generation
      and state='failed' and terminal_at is null;
  select o.* into cmd from public.integration_outbox o where o.appointment_id=p.appointment_id
    and o.command_type='refund' and o.effect_generation=p.refund_generation and o.state='processing'
    and o.lease_expires_at>clock_timestamp();
  snapshot:=jsonb_build_object('stripeAccountId',p.stripe_account_id,'checkout',null,
    'paymentIntent',jsonb_build_object('id',p.payment_intent_id,'object','payment_intent','livemode',p.environment='live',
      'status','succeeded','amount',p.expected_amount_minor,'currency',lower(p.currency),'latest_charge',p.charge_id,
      'metadata',jsonb_build_object('kind','booking','appointmentId',p.appointment_id,'profileId',p.profile_id,'environment',p.environment)),
    'charge',jsonb_build_object('id',p.charge_id,'object','charge','payment_intent',p.payment_intent_id,'livemode',p.environment='live',
      'paid',true,'amount',p.amount_paid_minor,'currency',lower(p.currency),
      'amount_refunded',(select coalesce(sum((r->>'amount')::bigint)filter(where r->>'status'='succeeded'),0) from jsonb_array_elements(refunds)r)),
    'refunds',refunds,'refundsHasMore',false);
  if original_role<>'booking_test_owner' then perform set_config('role','booking_worker',true);end if;
  if cmd.id is null then
    select x.* into strict cmd from public.claim_due_booking_outbox(p.environment,lease,100)x where x.appointment_id=p.appointment_id;
  end if;
  result:=public.reduce_booking_financial_evidence_v3('refund_command',cmd.id,cmd.lease_token,cmd.fencing_token,snapshot);
  if original_role<>'booking_test_owner' then perform set_config('role',original_role,true);end if;
  return result;
end $$;

\if :{?notification_refund_appointment}
select pg_temp.notification_refund(:'notification_refund_appointment'::uuid,:'notification_refunds'::jsonb);
commit;
\else
\if :notification_legacy_fixture
-- Executed just before migration 133 in the isolated full-chain test.
do $$
declare appointment uuid;kind text;counter integer:=0;
begin
  foreach kind in array array['processing','processing_expired','retry','accepted','delivered'] loop
    counter:=counter+1;
    appointment:=pg_temp.notification_fixture(('73300000-0000-4000-8000-'||lpad(counter::text,12,'0'))::uuid);
    update public.booking_notifications set state=case when kind='processing_expired' then 'processing' else kind end,
      attempts=1,lease_token='73300000-0000-4000-8000-000000000099',fencing_token=1,
      lease_expires_at=case when kind='processing_expired' then clock_timestamp()-interval '48 hours' else clock_timestamp()+interval '2 minutes' end,
      provider_message_id=case when kind in ('accepted','delivered') then 'legacy_email_'||id end,
      accepted_at=case when kind in ('accepted','delivered') then clock_timestamp()-interval '48 hours' end,
      delivered_at=case when kind='delivered' then clock_timestamp()-interval '47 hours' end,
      created_at=clock_timestamp()-interval '49 hours',updated_at=clock_timestamp()
      where appointment_id=appointment and audience='customer';
    update public.booking_notifications set next_attempt_at='infinity' where appointment_id=appointment and audience='contractor';
  end loop;
end $$;
commit;
\else
\if :notification_worker_fixture
select pg_temp.notification_fixture() as appointment_id \gset
update public.booking_notifications set next_attempt_at='infinity'
  where appointment_id=:'appointment_id'::uuid and audience='contractor';
commit;
select :'appointment_id';
\else

-- The real financial authority requires a separately committed cutover preflight.
create temp table notification_refund_context as select pg_temp.notification_fixture() as appointment_id;
select public.capture_booking_cutover_preflight_v3(a.profile_id,a.environment) as refund_preflight
  from public.appointments a join notification_refund_context c on c.appointment_id=a.id \gset
do $$begin perform public.prepare_booking_convergence_cutover(a.profile_id,a.environment)
  from public.appointments a join notification_refund_context c on c.appointment_id=a.id;end $$;
commit;
begin;
select pg_temp.assert_notification(public.activate_booking_cutover_v3(:'refund_preflight'::uuid),'refund fixture cutover is real and committed');

do $refund_test$
declare appointment uuid;n public.booking_notifications;terminal_notice public.booking_notifications;original public.booking_notifications;
  lease uuid:=gen_random_uuid();context jsonb;terminal_context jsonb;result jsonb;prepared jsonb;item jsonb;terminal text;history text;
  payload text:='{"from":"booking@example.test","to":["customer@example.test"],"subject":"Refund started","text":"Your refund is being processed."}';
  terminal_payload text;notice_updated_at timestamptz;
begin
  select appointment_id into strict appointment from notification_refund_context;
  foreach terminal in array array['succeeded','failed'] loop
    foreach history in array array['unsent','accepted','ambiguous'] loop
      begin
        perform public.cancel_contractor_booking(a.id,a.profile_id,a.environment,p.auth_user_id,gen_random_uuid(),repeat('a',64))
          from public.appointments a join public.profiles p on p.id=a.profile_id where a.id=appointment;
        prepared:=pg_temp.notification_refund(appointment);
        perform pg_temp.assert_notification(prepared->>'action'='create','real refund command prepares the requested generation');
        select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1)x
          where x.appointment_id=appointment and x.notification_type='refund_pending' and x.audience='customer';
        context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
        perform pg_temp.assert_notification(context is not null and public.booking_notification_event_current_v4(n.id),
          'matching pending appointment/payment generation is dispatchable');
        update public.booking_notifications set state='suppressed',recipient_email=null,suppression_reason='recipient_missing_or_invalid',
          lease_token=null,lease_expires_at=null where appointment_id=appointment and notification_type='refund_pending' and audience='contractor';
        if history<>'unsent' then
          result:=public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
          perform pg_temp.assert_notification(result->>'action'='dispatch','current refund copy freezes before sending');
          if history='accepted' then
            perform public.complete_booking_notification_v3(n.id,'test',lease,n.fencing_token,'resend','refund_pending_'||n.id);
          else
            perform public.fail_booking_notification_v3(n.id,'test',lease,n.fencing_token,true,'Provider response lost');
            update public.booking_notifications set next_attempt_at=clock_timestamp() where id=n.id;
            select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1)x where x.id=n.id;
            context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
          end if;
        end if;
        select * into strict original from public.booking_notifications where id=n.id;
        item:=jsonb_build_object('id','re_notification_'||appointment,'object','refund','charge',prepared->>'chargeId',
          'payment_intent',prepared->>'paymentIntentId','status',terminal,'amount',(prepared->>'amountMinor')::bigint,'currency','usd',
          'created',extract(epoch from clock_timestamp())::bigint,'metadata',jsonb_build_object('kind','booking_refund',
            'bookingPaymentId',prepared->>'paymentId','bookingAppointmentId',appointment,'bookingProfileId',prepared->>'profileId',
            'bookingEnvironment','test','refundGeneration',prepared->>'generation','bookingCommandId',prepared->>'commandId'));
        result:=pg_temp.notification_refund(appointment,jsonb_build_array(item));
        perform pg_temp.assert_notification(result->>'action'=case when terminal='succeeded' then 'settled' else 'failed' end
          and (select a.refund_state=terminal and p.refund_state=terminal and p.refund_requested_at is not null
            and a.refund_generation=p.refund_generation from public.appointments a join public.booking_payments p on p.appointment_id=a.id where a.id=appointment)
          and not public.booking_notification_event_current_v4(n.id),'terminal refund keeps the historical request, not pending dispatch validity');

        -- Completion/failure is accepted first, while the older pending claim is delayed.
        select x.* into strict terminal_notice from public.claim_due_booking_notifications_v3('test',lease,100,1)x
          where x.appointment_id=appointment and x.notification_type='refund_'||terminal and x.audience='customer';
        terminal_context:=public.get_booking_notification_context_v3(terminal_notice.id,'test',lease,terminal_notice.fencing_token)->'appointment';
        terminal_payload:=replace(replace(payload,'Refund started','Refund '||terminal),'is being processed',terminal);
        result:=public.authorize_booking_notification_dispatch_v3(terminal_notice.id,'test',lease,terminal_notice.fencing_token,terminal_context,terminal_payload);
        perform pg_temp.assert_notification(result->>'action'='dispatch','terminal refund notification remains dispatchable');
        perform public.complete_booking_notification_v3(terminal_notice.id,'test',lease,terminal_notice.fencing_token,'resend','refund_terminal_'||terminal_notice.id);
        if history='unsent' then
          result:=public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
          perform pg_temp.assert_notification(result->>'action'='suppressed' and (select state='suppressed' and first_dispatch_at is null
            from public.booking_notifications where id=n.id),'delayed pending authorization is suppressed after terminal email acceptance');
        elsif history='accepted' then
          perform pg_temp.assert_notification((select to_jsonb(x)=to_jsonb(original) from public.booking_notifications x where id=n.id),
            'accepted pending notification remains unmodified history after terminal refund');
        else
          result:=public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
          perform pg_temp.assert_notification(result->>'action'='review' and (select state='failed' and next_attempt_at='infinity' and dispatch_payload=original.dispatch_payload
            and dispatch_appointment=original.dispatch_appointment and first_dispatch_at=original.first_dispatch_at
            and replay_deadline_at=original.replay_deadline_at and idempotency_key=original.idempotency_key from public.booking_notifications where id=n.id)
            and exists(select 1 from public.booking_notification_delivery_review_v3 where notification_id=n.id and reason_code='acceptance_unknown' and resolved_at is null),
            'ambiguous pending acceptance keeps frozen evidence in review without a changed-state resend');
        end if;
        perform public.project_booking_notifications_v3(appointment);
        perform public.reconcile_booking_notification_projection_v3('test',500);
        perform pg_temp.assert_notification(not exists(select 1 from public.claim_due_booking_notifications_v3('test',lease,100,1)x where x.id=n.id)
          and (select state='suppressed' and recipient_email is null from public.booking_notifications where appointment_id=appointment
            and notification_type='refund_pending' and audience='contractor'),'repair cannot revive obsolete pending copy through a repaired recipient');
        if history='unsent' then
          delete from public.booking_notifications where appointment_id=appointment and notification_type='refund_pending';
          perform public.project_booking_notifications_v3(appointment);
          select updated_at into notice_updated_at from public.booking_notifications where id=terminal_notice.id;
          perform public.reconcile_booking_notification_projection_v3('test',500);
          perform public.reconcile_booking_notification_projection_v3('test',500);
          perform pg_temp.assert_notification(not exists(select 1 from public.booking_notifications where appointment_id=appointment and notification_type='refund_pending')
            and (select updated_at=notice_updated_at from public.booking_notifications where id=terminal_notice.id),
            'projector and repair scan neither recreate missing obsolete pending nor repeatedly select its terminal appointment');
        end if;
        raise exception 'rollback refund scenario' using errcode='Z0001';
      exception when sqlstate 'Z0001' then null;end;
    end loop;
  end loop;

  perform public.cancel_contractor_booking(a.id,a.profile_id,a.environment,p.auth_user_id,gen_random_uuid(),repeat('a',64))
    from public.appointments a join public.profiles p on p.id=a.profile_id where a.id=appointment;
  select * into strict n from public.booking_notifications where appointment_id=appointment and notification_type='refund_pending' and audience='customer';
  update public.appointments set refund_generation=refund_generation+1 where id=appointment;
  perform pg_temp.assert_notification(not public.booking_notification_event_current_v4(n.id),'payment generation alone cannot authorize a different desired refund generation');
  update public.appointments set refund_generation=refund_generation-1,refund_state='not_requested' where id=appointment;
  perform pg_temp.assert_notification(not public.booking_notification_event_current_v4(n.id),'pending payment without pending desired refund is not current');
  update public.appointments set refund_state='pending' where id=appointment;
  update public.booking_payments set refund_state='not_requested' where appointment_id=appointment;
  perform pg_temp.assert_notification(not public.booking_notification_event_current_v4(n.id),'historical request without pending payment context is not current');
  update public.booking_payments set refund_state='pending' where appointment_id=appointment;
  prepared:=pg_temp.notification_refund(appointment);
  item:=jsonb_build_object('id','re_external_'||appointment,'object','refund','charge',prepared->>'chargeId',
    'payment_intent',prepared->>'paymentIntentId','status','succeeded','amount',400,'currency','usd',
    'created',extract(epoch from clock_timestamp())::bigint,'metadata','{}'::jsonb);
  result:=pg_temp.notification_refund(appointment,jsonb_build_array(item));
  perform pg_temp.assert_notification(result->>'action'='superseded' and not public.booking_notification_event_current_v4(n.id),
    'real partial-refund evidence supersedes only the old pending generation');
  prepared:=pg_temp.notification_refund(appointment,jsonb_build_array(item));
  perform pg_temp.assert_notification(prepared->>'action'='create' and prepared->>'amountMinor'='600'
    and (select a.refund_state='pending' and p.refund_state='pending' and a.refund_generation=p.refund_generation and p.amount_refunded_minor=400
      from public.appointments a join public.booking_payments p on p.appointment_id=a.id where a.id=appointment),
    'remaining partial refund has a real pending command in the next generation');
  select x.* into strict terminal_notice from public.claim_due_booking_notifications_v3('test',lease,100,1)x
    where x.appointment_id=appointment and x.notification_type='refund_pending' and x.audience='customer';
  context:=public.get_booking_notification_context_v3(terminal_notice.id,'test',lease,terminal_notice.fencing_token)->'appointment';
  result:=public.authorize_booking_notification_dispatch_v3(terminal_notice.id,'test',lease,terminal_notice.fencing_token,context,payload);
  perform pg_temp.assert_notification(result->>'action'='dispatch' and terminal_notice.source_event_key='refund:2:pending'
    and terminal_notice.id<>n.id and terminal_notice.idempotency_key<>n.idempotency_key,
    'new pending partial-refund generation is dispatchable; pending notifications are not globally disabled');
end $refund_test$;

do $test$
declare appointment uuid;n public.booking_notifications%rowtype;other public.booking_notifications%rowtype;
  lease uuid:=gen_random_uuid();lease2 uuid:=gen_random_uuid();context jsonb;payload text;
  result jsonb;first_dispatch timestamptz;deadline timestamptz;at_time timestamptz;hours integer;
  reason text;denied boolean;proc regprocedure;
begin
  foreach proc in array array['public.project_booking_notifications_v3(uuid)'::regprocedure,
    'public.reconcile_booking_notification_projection_v3(text,integer)'::regprocedure,
    'public.booking_notification_event_current_v4(uuid)'::regprocedure] loop
    perform pg_temp.assert_notification((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=proc)
      and not has_function_privilege('service_role',proc,'EXECUTE') and not has_function_privilege('anon',proc,'EXECUTE')
      and not has_function_privilege('authenticated',proc,'EXECUTE') and not has_function_privilege('public',proc,'EXECUTE')
      and has_function_privilege('booking_worker',proc,'EXECUTE')=(proc<>'public.project_booking_notifications_v3(uuid)'::regprocedure),
      'effective projector remains owner-only; current predicate and repair retain their worker-only definer grants');
  end loop;
  proc:='public.authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text)'::regprocedure;
  perform pg_temp.assert_notification((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=proc),
    'dispatch authorizer uses definer with empty search path');
  perform pg_temp.assert_notification(has_function_privilege('booking_worker',proc,'EXECUTE')
    and not has_function_privilege('service_role',proc,'EXECUTE') and not has_function_privilege('anon',proc,'EXECUTE')
    and not has_function_privilege('authenticated',proc,'EXECUTE') and not has_function_privilege('public',proc,'EXECUTE'),
    'only booking_worker can authorize a dispatch');
  perform pg_temp.assert_notification(to_regprocedure('public.claim_due_booking_notifications_v3(text,uuid,integer)') is null
    and has_function_privilege('booking_worker','public.claim_due_booking_notifications_v3(text,uuid,integer,integer)','EXECUTE')
    and not has_function_privilege('service_role','public.claim_due_booking_notifications_v3(text,uuid,integer,integer)','EXECUTE')
    and not has_function_privilege('public','public.claim_due_booking_notifications_v3(text,uuid,integer,integer)','EXECUTE'),
    'one worker-only claim implementation requires the dispatch contract');
  denied:=false;
  begin perform public.claim_due_booking_notifications_v3('test',lease,100);
  exception when invalid_parameter_value then denied:=true;end;
  perform pg_temp.assert_notification(denied,'old workers cannot claim unmarked work after migration');
  perform pg_temp.assert_notification((select relrowsecurity from pg_class where oid='public.booking_notifications'::regclass)
    and (select relrowsecurity from pg_class where oid='public.booking_notification_delivery_review_v3'::regclass)
    and not has_table_privilege('booking_worker','public.booking_notifications','UPDATE')
    and not has_table_privilege('booking_worker','public.booking_notification_delivery_review_v3','SELECT'),
    'notification evidence and existing review remain RLS protected and RPC only');

  if exists(select 1 from public.appointments where id='73300000-0000-4000-8000-000000000001') then
    perform pg_temp.assert_notification((select count(*)=3 from public.booking_notifications notice
      join public.booking_notification_delivery_review_v3 r on r.notification_id=notice.id
      where notice.appointment_id in ('73300000-0000-4000-8000-000000000001','73300000-0000-4000-8000-000000000002','73300000-0000-4000-8000-000000000003')
        and notice.audience='customer' and notice.state='failed' and notice.first_dispatch_at is null
        and notice.replay_deadline_at is null and r.reason_code='acceptance_unknown' and r.resolved_at is null
        and notice.source_event_key='confirmed:0'),
      'legacy processing and retry have no reconstructable dispatch age, even with fresh updated_at');
    perform pg_temp.assert_notification((select count(*)=2 from public.booking_notifications notice
      where notice.appointment_id in ('73300000-0000-4000-8000-000000000004','73300000-0000-4000-8000-000000000005')
        and notice.audience='customer' and notice.state in ('accepted','delivered') and notice.provider_message_id is not null
        and notice.first_dispatch_at is null), 'migration does not suppress or fabricate proof for accepted legacy messages');
    select * into strict n from public.booking_notifications where appointment_id='73300000-0000-4000-8000-000000000001' and audience='customer';
    perform pg_temp.assert_notification(public.complete_booking_notification_v3(n.id,'test',n.lease_token,n.fencing_token,'resend','legacy_late_acceptance'),
      'a live legacy fence may still settle acceptance without granting another send');
    perform pg_temp.assert_notification((select resolved_at is not null from public.booking_notification_delivery_review_v3 where notification_id=n.id),
      'known legacy acceptance resolves existing review');
  end if;

  appointment:=pg_temp.notification_fixture();
  select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1) x
    where x.appointment_id=appointment and x.audience='customer';
  context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
  payload:='{"from":"booking@example.test","to":["customer@example.test"],"subject":"Booking confirmed","text":"Repair is confirmed"}';
  perform public.cancel_contractor_booking(appointment,n.profile_id,'test',
    (select auth_user_id from public.profiles where id=n.profile_id),gen_random_uuid(),repeat('a',64));
  perform pg_temp.assert_notification((select confirmed_at is not null from public.appointments where id=appointment)
    and not public.booking_notification_event_current_v4(n.id),'historical confirmation is not current cancellation truth');
  result:=public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
  perform pg_temp.assert_notification(result->>'action'='suppressed' and (select first_dispatch_at is null and state='suppressed'
    from public.booking_notifications where id=n.id),'cancellation between context and authorization prevents an old confirmation');
  perform public.project_booking_notifications_v3(appointment);
  perform pg_temp.assert_notification((select count(*)=2 from public.booking_notifications where appointment_id=appointment and notification_type='confirmed')
    and (select count(*)=2 from public.booking_notifications where appointment_id=appointment and notification_type='cancelled')
    and (select count(*)=2 from public.booking_notifications where appointment_id=appointment and notification_type='refund_pending'
      and source_event_key='refund:1:pending'),'projection preserves confirmed/cancelled/refund source identity and audience dedupe');
  update public.appointments set calendar_state='cancel_failed' where id=appointment;
  select * into strict other from public.booking_notifications where appointment_id=appointment and audience='customer' and notification_type='calendar_failed';
  perform pg_temp.assert_notification(public.booking_notification_event_current_v4(other.id),'failed DELETE notice is current for cancellation');
  update public.appointments set calendar_state='cancelled' where id=appointment;
  perform pg_temp.assert_notification(not public.booking_notification_event_current_v4(other.id),'old failure is not current after repair');
  select * into strict other from public.booking_notifications where appointment_id=appointment and audience='customer' and notification_type='calendar_repaired';
  perform pg_temp.assert_notification(public.booking_notification_event_current_v4(other.id),'DELETE repair notice is current without reviving confirmation');

  -- The scanner must not repeatedly enqueue historical confirmations on cancelled appointments.
  appointment:=pg_temp.notification_fixture();
  delete from public.booking_notifications where appointment_id=appointment;
  update public.appointments set appointment_state='cancelled',cancellation_requested_at=clock_timestamp(),
    cancelled_at=clock_timestamp(),appointment_reason='contractor_cancelled',calendar_state='cancel_failed' where id=appointment;
  perform public.project_booking_notifications_v3(appointment);
  perform public.reconcile_booking_notification_projection_v3('test',500);
  perform pg_temp.assert_notification(not exists(select 1 from public.booking_notifications where appointment_id=appointment and notification_type='confirmed'),
    'enqueue and scan use present cancellation state, not historical confirmed_at');

  appointment:=pg_temp.notification_fixture();
  select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1) x
    where x.appointment_id=appointment and x.audience='customer';
  context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
  perform pg_temp.assert_notification(public.authorize_booking_notification_dispatch_v3(n.id,'live',lease,n.fencing_token,context,payload) is null
    and public.authorize_booking_notification_dispatch_v3(n.id,'test',lease2,n.fencing_token,context,payload) is null
    and public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token+1,context,payload) is null,
    'environment, token and fence must match before freezing or sending');
  denied:=false;
  begin
    perform public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,
      replace(payload,'customer@example.test','wrong@example.test'));
  exception when invalid_parameter_value then denied:=true;end;
  perform pg_temp.assert_notification(denied and (select first_dispatch_at is null from public.booking_notifications where id=n.id),
    'foreign payload recipient cannot freeze dispatch proof');
  result:=public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
  select first_dispatch_at,replay_deadline_at into first_dispatch,deadline from public.booking_notifications where id=n.id;
  perform pg_temp.assert_notification(result->>'action'='dispatch' and result->>'payload'=payload
    and (result->>'dispatch_budget_ms')::integer between 1 and 10000 and deadline=first_dispatch+interval '24 hours'
    and (select dispatch_payload=payload and dispatch_appointment->>'appointment_state'='confirmed' from public.booking_notifications where id=n.id),
    'first dispatch freezes the exact body, appointment facts and replay deadline before external work');
  result:=public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
  perform pg_temp.assert_notification(result->>'action'='dispatch' and (select first_dispatch_at=first_dispatch and replay_deadline_at=deadline
    from public.booking_notifications where id=n.id),'same dispatch replay does not extend the first window');
  result:=public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,replace(payload,'booking@example.test','changed@example.test'));
  perform pg_temp.assert_notification(result->>'action'='review' and result->>'reason'='acceptance_unknown'
    and (select dispatch_payload=payload from public.booking_notifications where id=n.id),'same key with changed body goes to review, never refreezes');

  -- A lost response within retention keeps the same payload/key under a newer lease.
  appointment:=pg_temp.notification_fixture();
  select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1) x
    where x.appointment_id=appointment and x.audience='customer';
  context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
  perform public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
  at_time:=clock_timestamp();
  update public.booking_notifications set first_dispatch_at=at_time-interval '23 hours',replay_deadline_at=at_time+interval '1 hour',
    lease_expires_at=at_time-interval '1 second',updated_at=at_time where id=n.id;
  select x.* into strict other from public.claim_due_booking_notifications_v3('test',lease2,100,1) x where x.id=n.id;
  result:=public.authorize_booking_notification_dispatch_v3(other.id,'test',lease2,other.fencing_token,context,payload);
  perform pg_temp.assert_notification(result->>'action'='dispatch' and other.idempotency_key=n.idempotency_key
    and other.dispatch_payload=payload and other.fencing_token>n.fencing_token,'23-hour takeover uses original key and body');
  at_time:=clock_timestamp()+interval '3 seconds';
  update public.booking_notifications set first_dispatch_at=at_time-interval '24 hours',replay_deadline_at=at_time where id=n.id;
  result:=public.authorize_booking_notification_dispatch_v3(other.id,'test',lease2,other.fencing_token,context,payload);
  perform pg_temp.assert_notification(result->>'action'='dispatch' and (result->>'dispatch_budget_ms')::integer between 1 and 2000,
    'authorization narrows its grant as the original replay deadline approaches');
  perform pg_temp.assert_notification(public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload) is null,
    'the previous lease cannot authorize another dispatch');
  denied:=false;
  begin perform public.complete_booking_notification_v3(n.id,'test',lease,n.fencing_token,'resend','stale_email_acceptance');
  exception when serialization_failure then denied:=true;end;
  perform pg_temp.assert_notification(denied,'stale completion cannot steal a new lease');
  perform public.complete_booking_notification_v3(other.id,'test',lease2,other.fencing_token,'resend','within_window_acceptance');

  foreach hours in array array[24,48] loop
    appointment:=pg_temp.notification_fixture();
    select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1) x
      where x.appointment_id=appointment and x.audience='customer';
    context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
    perform public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
    at_time:=clock_timestamp()-pg_catalog.make_interval(hours=>hours)-interval '1 second';
    update public.booking_notifications set first_dispatch_at=at_time,replay_deadline_at=at_time+interval '24 hours',
      lease_expires_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp() where id=n.id;
    perform pg_temp.assert_notification(not exists(select 1 from public.claim_due_booking_notifications_v3('test',lease2,100,1) x where x.id=n.id),
      hours::text||'-hour unknown acceptance is not blindly reclaimed');
    perform pg_temp.assert_notification((select state='failed' and idempotency_key=n.idempotency_key and dispatch_payload=payload
      from public.booking_notifications where id=n.id) and exists(select 1 from public.booking_notification_delivery_review_v3
      where notification_id=n.id and reason_code='idempotency_expired' and resolved_at is null),
      'expired unknown acceptance remains a visible obligation with original dispatch evidence');
    perform public.project_booking_notifications_v3(appointment);
    perform pg_temp.assert_notification((select count(*)=1 from public.booking_notifications where appointment_id=appointment
      and notification_type='confirmed' and audience='customer'),'projection cannot replace an expired notification identity');
  end loop;

  -- Expiry after claiming is checked again by dispatch authority, not just claim.
  appointment:=pg_temp.notification_fixture();
  select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1) x
    where x.appointment_id=appointment and x.audience='customer';
  context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
  perform public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
  at_time:=clock_timestamp()-interval '24 hours 1 second';
  update public.booking_notifications set first_dispatch_at=at_time,replay_deadline_at=at_time+interval '24 hours' where id=n.id;
  result:=public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
  perform pg_temp.assert_notification(result->>'action'='review' and result->>'reason'='idempotency_expired','active claim cannot bypass expired provider key');

  -- A crash before authorization is provably unsent under the new protocol.
  appointment:=pg_temp.notification_fixture();
  select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1) x
    where x.appointment_id=appointment and x.audience='customer';
  update public.booking_notifications set lease_expires_at=clock_timestamp()-interval '48 hours',
    created_at=clock_timestamp()-interval '49 hours',updated_at=clock_timestamp() where id=n.id;
  select x.* into strict other from public.claim_due_booking_notifications_v3('test',lease2,100,1) x where x.id=n.id;
  context:=public.get_booking_notification_context_v3(other.id,'test',lease2,other.fencing_token)->'appointment';
  result:=public.authorize_booking_notification_dispatch_v3(other.id,'test',lease2,other.fencing_token,context,payload);
  perform pg_temp.assert_notification(result->>'action'='dispatch' and (select first_dispatch_at>clock_timestamp()-interval '1 minute'
    from public.booking_notifications where id=other.id),'post-migration pre-dispatch crash starts a fresh window, independent of row age');

  -- A dispatch may finish while cancellation commits, but settlement is not a new send.
  appointment:=pg_temp.notification_fixture();
  select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1) x
    where x.appointment_id=appointment and x.audience='customer';
  context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
  perform public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
  perform public.cancel_contractor_booking(appointment,n.profile_id,'test',
    (select auth_user_id from public.profiles where id=n.profile_id),gen_random_uuid(),repeat('a',64));
  perform public.suppress_noncanonical_booking_notifications_v4('test',1000);
  perform pg_temp.assert_notification((select state='processing' from public.booking_notifications where id=n.id),
    'suppression does not steal a current in-flight dispatch fence');
  perform public.ingest_booking_notification_delivery('event_before_settlement','settlement_race_email','email.delivered',clock_timestamp());
  perform public.complete_booking_notification_v3(n.id,'test',lease,n.fencing_token,'resend','settlement_race_email');
  perform pg_temp.assert_notification(public.complete_booking_notification_v3(n.id,'test',lease,n.fencing_token,'resend','settlement_race_email'),
    'exact accepted settlement may repeat after the completion response is lost');
  perform public.suppress_noncanonical_booking_notifications_v4('test',1000);
  perform pg_temp.assert_notification((select state='delivered' and delivery_rank=20 and provider_message_id='settlement_race_email'
    and source_event_key='confirmed:0' and idempotency_key=n.idempotency_key from public.booking_notifications where id=n.id),
    'cancel and repeated completion preserve accepted delivery identity and early webhook evidence');
  perform public.ingest_booking_notification_delivery('event_late_complaint','settlement_race_email','email.complained',clock_timestamp());
  perform public.complete_booking_notification_v3(n.id,'test',lease,n.fencing_token,'resend','settlement_race_email');
  perform pg_temp.assert_notification((select state='complained' and delivery_rank=50 from public.booking_notifications where id=n.id),
    'acceptance repetition cannot reset later delivery evidence');

  appointment:=pg_temp.notification_fixture();
  select x.* into strict n from public.claim_due_booking_notifications_v3('test',lease,100,1) x
    where x.appointment_id=appointment and x.audience='customer';
  context:=public.get_booking_notification_context_v3(n.id,'test',lease,n.fencing_token)->'appointment';
  perform public.authorize_booking_notification_dispatch_v3(n.id,'test',lease,n.fencing_token,context,payload);
  update public.booking_notifications set attempts=8 where id=n.id;
  perform public.fail_booking_notification_v3(n.id,'test',lease,n.fencing_token,true,'Provider result unknown');
  perform pg_temp.assert_notification(exists(select 1 from public.booking_notification_delivery_review_v3
    where notification_id=n.id and reason_code='acceptance_unknown' and resolved_at is null),
    'exhausted ambiguous results use existing delivery review rather than disappearing');
end $test$;
rollback;
\echo 'booking-notification-lifetime: SQL authority, cancellation/refund truth, dispatch lifetime and delivery evidence passed (scenarios rolled back)'
\endif
\endif
\endif
