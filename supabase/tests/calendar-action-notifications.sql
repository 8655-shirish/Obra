\set ON_ERROR_STOP on
begin;

do $$begin
  if exists(select 1 from pg_catalog.pg_extension where extname in ('pg_net','pg_cron')) then
    raise exception 'Calendar notice tests require inert local platform fixtures'; end if;
end $$;

create function pg_temp.assert_notice(ok boolean, label text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'calendar notice assertion: %',label; end if; end $$;
create function pg_temp.notice_fixture(reason text default 'calendar_permissions_changed', env text default 'test')
returns uuid language plpgsql as $$
declare owner_id uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); connection uuid:=gen_random_uuid();
  email text:=profile||'@example.test';
begin
  insert into auth.users(id,email,confirmed_at,email_confirmed_at) values(owner_id,email,now(),now());
  insert into public.profiles(id,auth_user_id,license_number,email,environment) values(profile,owner_id,profile,email,env);
  insert into public.calendar_connections(id,profile_id,environment,external_user_id,pipedream_account_id,
    account_email,health_state,verification_reason,connection_revision)
    values(connection,profile,env,connection||'-not-recipient@example.test','apn_'||replace(connection::text,'-',''),
      'google-not-the-owner@example.test','degraded',reason,1);
  return connection;
end $$;

do $test$
declare c uuid; other uuid; notice jsonb; claim jsonb; next_claim jsonb; result jsonb; before_notice jsonb;
  lease uuid:=gen_random_uuid(); lease2 uuid:=gen_random_uuid(); proc regprocedure; role_name text;
  message text; n uuid; fence bigint; failed boolean; scope jsonb; diagnostic text;
begin
  for proc in select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname in ('claim_calendar_action_notice','transition_calendar_action_notice','get_calendar_action_notice_health')
  loop
    perform pg_temp.assert_notice((select prosecdef and proconfig=array['search_path=""'] from pg_catalog.pg_proc where oid=proc),proc||' definer/search_path');
    perform pg_temp.assert_notice(has_function_privilege('service_role',proc,'execute'),proc||' service grant');
    foreach role_name in array array['anon','authenticated','booking_worker'] loop
      perform pg_temp.assert_notice(not has_function_privilege(role_name,proc,'execute'),proc||' excludes '||role_name);
    end loop;
  end loop;
  perform pg_temp.assert_notice(not has_function_privilege('service_role','public.calendar_action_notice_scope(public.calendar_connections)','execute'),
    'classification helper not exposed as an alternate authority');
  foreach role_name in array array['anon','authenticated','booking_worker'] loop
    execute format('set local role %I',role_name);
    failed:=false;
    begin perform public.claim_calendar_action_notice('test',lease); exception when insufficient_privilege then failed:=true; end;
    reset role;
    perform pg_temp.assert_notice(failed,'actual claim denied for '||role_name);
  end loop;
  c:=pg_temp.notice_fixture();
  grant select,update on public.calendar_connections to service_role;
  create policy calendar_notice_fixture_service_write on public.calendar_connections for all to service_role using(true) with check(true);
  set local role service_role;
  failed:=false;
  begin update public.calendar_connections set action_notice_due_at=now()+interval '1 day' where id=c;
    exception when insufficient_privilege then failed:=true; get stacked diagnostics diagnostic=message_text; end;
  reset role;
  perform pg_temp.assert_notice(failed and diagnostic='Calendar notice command authority required',
    'raw service PATCH cannot bypass notice authority even with old table grants and permissive RLS');
  set local role service_role;
  failed:=false;
  begin update public.calendar_connections set action_notice=jsonb_set(action_notice,'{current_incident,closed_at}',to_jsonb(now())) where id=c;
    exception when insufficient_privilege then failed:=true; end;
  reset role;
  perform pg_temp.assert_notice(failed,'raw service cannot close current evidence inside the retained delivery JSON');
  failed:=false;
  begin update public.calendar_connections set action_notice=jsonb_set(action_notice,'{current_incident,payload}','"not a delivery"') where id=c;
    exception when check_violation then failed:=true; end;
  perform pg_temp.assert_notice(failed,'current incident cannot contain delivery payload or extra dispatch authority');
  select action_notice into before_notice from public.calendar_connections where id=c;
  update public.calendar_connections set updated_at=now(),verification_reason='calendar_permissions_changed' where id=c;
  perform pg_temp.assert_notice((select action_notice=before_notice from public.calendar_connections where id=c),'same incident/repeated observation is deduplicated');
  set local role service_role;
  claim:=public.claim_calendar_action_notice('test',lease);
  result:=public.claim_calendar_action_notice('test',lease2);
  reset role;
  perform pg_temp.assert_notice(claim->>'connection_id'=c::text and result is null,'one claim and no concurrent lease');
  perform pg_temp.assert_notice(claim->'notice'->>'recipient_email'<>(select external_user_id from public.calendar_connections where id=c)
    and claim->'notice'->>'recipient_email'<>(select account_email from public.calendar_connections where id=c),'recipient is trusted login profile, not provider identity');
  message:=jsonb_build_object('from','Obra <calendar@example.test>','to',jsonb_build_array(claim->'notice'->>'recipient_email'),
    'subject','Action needed','text','Review calendar access. Sign in: https://obratech.co/login')::text;
  n:=(claim->'notice'->>'id')::uuid; fence:=(claim->>'fencing_token')::bigint;
  set local role service_role;
  failed:=false;
  begin perform public.transition_calendar_action_notice('live',c,n,lease,fence,'authorize',message);
    exception when serialization_failure then failed:=true; end;
  reset role;
  perform pg_temp.assert_notice(failed,'environment is not caller-retargetable');
  failed:=false;
  begin update public.calendar_connections set action_notice=action_notice||jsonb_build_object('first_dispatch_at',now()) where id=c;
    exception when check_violation then failed:=true; end;
  perform pg_temp.assert_notice(failed,'partial dispatch marker without immutable payload is rejected');
  set local role service_role;
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message);
  reset role;
  perform pg_temp.assert_notice(result->>'action'='dispatch' and result->>'payload'=message
    and (result->>'dispatch_budget_ms')::integer between 1 and 10000,'preauthorization freezes bytes and grants a bounded provider budget');
  failed:=false;
  begin perform public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message||' ');
    exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_notice(failed,'provider replay cannot change even whitespace of payload');
  -- A transaction/RPC response loss after acceptance repeats DB settlement only.
  set local role service_role;
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'accepted',null,'email_notice_fixture_1');
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'accepted',null,'email_notice_fixture_1');
  reset role;
  perform pg_temp.assert_notice(result->>'action'='accepted','known acceptance settles idempotently');
  update public.calendar_connections set action_notice_lease_expires_at=now()-interval '1 second' where id=c;
  perform pg_temp.assert_notice(public.claim_calendar_action_notice('test',lease2) is null,'accepted episode never resends');
  update public.calendar_connections set health_state='healthy',verification_reason=null,reconnect_reason=null,last_verified_at=now() where id=c;
  perform pg_temp.assert_notice((select action_notice ? 'closed_at' from public.calendar_connections where id=c),'recovery between monitor polls closes episode');
  update public.calendar_connections set health_state='degraded',verification_reason='calendar_permissions_changed' where id=c;
  next_claim:=public.claim_calendar_action_notice('test',lease2);
  perform pg_temp.assert_notice(next_claim->'notice'->>'id'<>n::text,'true recurrent cause starts a new episode');
  -- An old owner cannot authorize a new incident/fence or current configuration.
  failed:=false;
  begin perform public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message);
    exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_notice(failed,'old episode/fence rejected');
  n:=(next_claim->'notice'->>'id')::uuid; fence:=(next_claim->>'fencing_token')::bigint;
  update public.calendar_connections set connection_revision=connection_revision+1,health_state='healthy',verification_reason=null,
    last_verified_at=now() where id=c;
  result:=public.transition_calendar_action_notice('test',c,n,lease2,fence,'authorize',message);
  perform pg_temp.assert_notice(result->>'action'='suppressed' and (select action_notice->>'state'='suppressed' from public.calendar_connections where id=c),
    'unsent stale configuration is suppressed and fence is lost');

  c:=pg_temp.notice_fixture('provider_reauthorization_required');
  update public.calendar_connections set disconnected_at=now(),health_state='disconnected',reconnect_reason='provider_reauthorization_required' where id=c;
  claim:=public.claim_calendar_action_notice('test',lease);
  perform pg_temp.assert_notice(claim->>'connection_id'=c::text and claim->'notice'->'scope'->>'cause'='reauthorization',
    'confirmed provider revocation not excluded as deliberate disconnect');
  n:=(claim->'notice'->>'id')::uuid; fence:=(claim->>'fencing_token')::bigint;
  message:=jsonb_build_object('from','calendar@example.test','to',jsonb_build_array(claim->'notice'->>'recipient_email'),
    'subject','Action needed','text','Reconnect Google. https://obratech.co/login')::text;
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message);
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'unknown');
  update public.calendar_connections set action_notice_due_at=now(),action_notice_lease_expires_at=now()-interval '1 second' where id=c;
  next_claim:=public.claim_calendar_action_notice('test',lease2);
  result:=public.transition_calendar_action_notice('test',c,n,lease2,(next_claim->>'fencing_token')::bigint,'authorize',message);
  perform pg_temp.assert_notice(next_claim->'notice'->>'id'=n::text and result->>'idempotency_key'='calendar-action:test:'||c||':'||n,
    'unknown replay within 24 hours retains provider key and payload');
  failed:=false;
  begin perform public.transition_calendar_action_notice('test',c,n,lease,fence,'accepted',null,'email_late_old_fence');
    exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_notice(failed,'expired owner cannot settle after takeover');
  update public.calendar_connections set action_notice=jsonb_set(action_notice,'{first_dispatch_at}',to_jsonb(now()-interval '48 hours')),
    action_notice_lease_expires_at=now()-interval '1 second',action_notice_due_at=now() where id=c;
  perform pg_temp.assert_notice(public.claim_calendar_action_notice('test',lease) is null,'48-hour unknown acceptance cannot dispatch again');
  perform pg_temp.assert_notice((select action_notice->>'review_reason'='idempotency_expired' from public.calendar_connections where id=c)
    and (public.get_calendar_action_notice_health('test')->>'review_count')::integer=1,'expired ambiguity visible in actual admin health');
  select action_notice into before_notice from public.calendar_connections where id=c;
  update public.calendar_connections set connection_revision=connection_revision+1,verification_reason='calendar_permissions_changed',
    reconnect_reason=null,health_state='degraded' where id=c;
  perform pg_temp.assert_notice((select action_notice->>'id'=before_notice->>'id' and action_notice->>'payload'=before_notice->>'payload'
    and action_notice->>'state'='review' from public.calendar_connections where id=c),'reconfiguration cannot discard unresolved dispatched facts');

  c:=pg_temp.notice_fixture();
  claim:=public.claim_calendar_action_notice('test',lease);
  update public.calendar_connections set health_state='healthy',verification_reason=null,last_verified_at=now() where id=c;
  perform pg_temp.assert_notice((select action_notice->>'state'='suppressed' and not action_notice ? 'first_dispatch_at'
    from public.calendar_connections where id=c),'recovered unsent notice suppressed immediately');

  c:=pg_temp.notice_fixture('provider_temporary_failure');
  perform pg_temp.assert_notice((select action_notice='{}'::jsonb from public.calendar_connections where id=c),'temporary failure produces no contractor notice');
  foreach role_name in array array['provider_platform_error','provider_configuration_error','provider_account_missing','provider_account_unhealthy','verification_stale'] loop
    update public.calendar_connections set verification_reason=role_name where id=c;
    perform pg_temp.assert_notice((select action_notice='{}'::jsonb from public.calendar_connections where id=c),role_name||' is not proof of consent revocation');
  end loop;
  -- Setup-only action is scoped to the existing owner operation and due time.
  update public.calendar_connections set pipedream_account_id=null,verification_reason=null,setup_operation_id=gen_random_uuid(),
    setup_actor_auth_user_id=(select p.auth_user_id from public.profiles p where p.id=calendar_connections.profile_id),
    setup_expected_revision=connection_revision,setup_account_id='apn_initial_setup_notice',setup_failure_reason='permissions',
    setup_probe_account_id='apn_initial_setup_notice',setup_calendar_id='setup-destination',setup_probe_calendar_id='setup-destination',
    setup_calendars='[{"id":"setup-destination","blocksAvailability":true,"receivesBookings":true}]'::jsonb,
    setup_retry_at=now()-interval '3 minutes' where id=c;
  claim:=public.claim_calendar_action_notice('test',lease);
  perform pg_temp.assert_notice(claim->>'connection_id'=c::text and claim->'notice'->'scope'->>'source'='setup',
    'initial setup action email does not require a saved provider account or appointment');
  perform pg_temp.assert_notice((public.get_calendar_action_notice_health('test')->>'setup_overdue_count')::integer=1,'due setup included in evaluator health');
  scope:=public.get_calendar_action_notice_health('test');
  update public.calendar_connections set setup_failure_reason='temporary' where id=c;
  result:=public.get_calendar_action_notice_health('test');
  perform pg_temp.assert_notice(result->'action_required_count'=scope->'action_required_count'
    and result->'pending_count'=scope->'pending_count'
    and exists(select 1 from jsonb_array_elements(result->'items') item where item->>'notice_id'=claim->'notice'->>'id' and item->>'closed_at' is null),
    'temporary setup evidence pauses advice, not its retained incident inventory');
  update public.calendar_connections set setup_failure_reason='permissions' where id=c;
  n:=(claim->'notice'->>'id')::uuid; fence:=(claim->>'fencing_token')::bigint;
  message:=jsonb_build_object('from','calendar@example.test','to',jsonb_build_array(claim->'notice'->>'recipient_email'),
    'subject','Action needed','text','Review setup at https://obratech.co/login')::text;
  update public.calendar_connections set setup_calendars='[{"id":"new-destination","blocksAvailability":true,"receivesBookings":true}]'::jsonb,
    setup_calendar_id='new-destination',setup_failure_reason=null where id=c;
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message);
  perform pg_temp.assert_notice(result->>'action'='suppressed','same setup operation and revision cannot keep old choices eligible');
  update public.calendar_connections set setup_failure_reason='permissions' where id=c;
  perform pg_temp.assert_notice(public.claim_calendar_action_notice('test',lease) is null,
    'superseded probe cleanup failure is not evidence against replacement calendar');
  update public.calendar_connections set setup_probe_calendar_id=setup_calendar_id where id=c;
  claim:=public.claim_calendar_action_notice('test',lease);
  perform pg_temp.assert_notice(claim->'notice'->>'id'<>n::text and claim->'notice'->'scope'->>'setup_selections_sha256' is not null,
    'exact new selected setup capability can have a new scoped action incident');
  update public.calendar_connections set setup_failure_reason='configuration' where id=c;
  claim:=public.claim_calendar_action_notice('test',lease);
  perform pg_temp.assert_notice(claim->'notice'->'scope'->>'cause'='setup',
    'classified setup configuration failure asks for setup review, not invented consent revocation');
  update public.calendar_connections set setup_completed_at=now(),setup_failure_reason=null where id=c;
  perform pg_temp.assert_notice((select action_notice->>'state'='suppressed' from public.calendar_connections where id=c),'completed setup suppresses unsent action');

  c:=pg_temp.notice_fixture();
  insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,actor_auth_user_id)
    select c1.profile_id,c1.environment,'pipedream',c1.pipedream_account_id,p.auth_user_id from public.calendar_connections c1
      join public.profiles p on p.id=c1.profile_id where c1.id=c;
  perform pg_temp.assert_notice(public.claim_calendar_action_notice('test',lease) is null,'disconnect intent wins independently of connection health');

  other:=pg_temp.notice_fixture('calendar_permissions_changed','live');
  perform pg_temp.assert_notice(public.claim_calendar_action_notice('test',lease) is null,'test never claims live');
  claim:=public.claim_calendar_action_notice('live',lease);
  perform pg_temp.assert_notice(claim->>'connection_id'=other::text,'live is independently scoped');

  c:=pg_temp.notice_fixture();
  update auth.users set email_confirmed_at=null,confirmed_at=null where id=(select p.auth_user_id from public.profiles p join public.calendar_connections x on x.profile_id=p.id where x.id=c);
  perform pg_temp.assert_notice(public.claim_calendar_action_notice('test',lease) is null,'unverified profile email cannot receive a notice');
  perform pg_temp.assert_notice((select action_notice->>'review_reason'='recipient_unavailable' from public.calendar_connections where id=c),'missing recipient fails visible, not false accepted');
  update auth.users set email_confirmed_at=now() where id=(select p.auth_user_id from public.profiles p join public.calendar_connections x on x.profile_id=p.id where x.id=c);
  update public.calendar_connections set action_notice_due_at=now() where id=c;
  claim:=public.claim_calendar_action_notice('test',lease);
  perform pg_temp.assert_notice(claim->>'connection_id'=c::text,'verified recipient correction resumes unsent incident');
  n:=(claim->'notice'->>'id')::uuid; fence:=(claim->>'fencing_token')::bigint;
  message:=jsonb_build_object('from','calendar@example.test','to',jsonb_build_array(claim->'notice'->>'recipient_email'),
    'subject','Action needed','text','Review access at https://obratech.co/login')::text;
  update public.profiles set email='changed-owner@example.test' where id=(select profile_id from public.calendar_connections where id=c);
  update auth.users set email='changed-owner@example.test' where id=(select p.auth_user_id from public.profiles p join public.calendar_connections x on x.profile_id=p.id where x.id=c);
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message);
  perform pg_temp.assert_notice(result->>'action'='review' and (select action_notice->>'recipient_email'=claim->'notice'->>'recipient_email'
    and action_notice->>'review_reason'='recipient_changed' from public.calendar_connections where id=c),'claim recipient cannot be retargeted by profile change');

  c:=pg_temp.notice_fixture();
  claim:=public.claim_calendar_action_notice('test',lease); n:=(claim->'notice'->>'id')::uuid; fence:=(claim->>'fencing_token')::bigint;
  message:=jsonb_build_object('from','calendar@example.test','to',jsonb_build_array(claim->'notice'->>'recipient_email'),
    'subject','Action needed','text','Review access at https://obratech.co/login')::text;
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message);
  update public.calendar_connections set action_notice=jsonb_set(action_notice,'{first_dispatch_at}',to_jsonb(clock_timestamp()-interval '24 hours'+interval '500 milliseconds')) where id=c;
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message);
  perform pg_temp.assert_notice(result->>'action'='review','last second of provider window cannot grant an unbounded/reclocked dispatch');

  c:=pg_temp.notice_fixture();
  select action_notice into before_notice from public.calendar_connections where id=c;
  update public.calendar_connections set verification_reason='provider_temporary_failure' where id=c;
  perform pg_temp.assert_notice(public.claim_calendar_action_notice('test',lease) is null,'generic new failure pauses the previous permission email');
  update public.calendar_connections set verification_reason='calendar_permissions_changed' where id=c;
  perform pg_temp.assert_notice((select action_notice->>'id'=before_notice->>'id' from public.calendar_connections where id=c),'temporary failure is not a false recovery/new episode');
  update public.calendar_connections set action_notice_due_at=now() where id=c;
  claim:=public.claim_calendar_action_notice('test',lease); n:=(claim->'notice'->>'id')::uuid; fence:=(claim->>'fencing_token')::bigint;
  message:=jsonb_build_object('from','calendar@example.test','to',jsonb_build_array(claim->'notice'->>'recipient_email'),
    'subject','Action needed','text','Review access at https://obratech.co/login')::text;
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'authorize',message);
  update public.calendar_connections set verification_reason=null,reconnect_reason=null,health_state='healthy',last_verified_at=now() where id=c;
  perform pg_temp.assert_notice((select action_notice->>'state'='review' and action_notice->>'review_reason'='acceptance_unknown'
    and action_notice->>'payload'=message from public.calendar_connections where id=c),'recovery never discards a dispatched unknown effect');
  result:=public.transition_calendar_action_notice('test',c,n,lease,fence,'accepted',null,'email_accepted_after_recovery');
  perform pg_temp.assert_notice(result->>'action'='accepted','current dispatch can still settle known acceptance after recovery');

  c:=pg_temp.notice_fixture();
  select action_notice into before_notice from public.calendar_connections where id=c;
  update public.calendar_connections set setup_operation_id=gen_random_uuid(),setup_completed_at=null,setup_purpose='write_recovery',
    setup_actor_auth_user_id=(select p.auth_user_id from public.profiles p where p.id=calendar_connections.profile_id),
    setup_expected_revision=connection_revision,setup_account_id=pipedream_account_id,setup_failure_reason='permissions' where id=c;
  perform pg_temp.assert_notice((select action_notice->>'id'=before_notice->>'id' and action_notice->'scope'->>'source'='saved'
    from public.calendar_connections where id=c),'recovery probe does not create a duplicate incident for the same saved permission cause');
  update public.calendar_connections set setup_failure_reason='temporary' where id=c;
  claim:=public.claim_calendar_action_notice('test',lease);
  perform pg_temp.assert_notice(claim->>'connection_id'=c::text,'temporary recovery-probe failure cannot erase a confirmed saved permission remedy');

  fence:=(public.get_calendar_action_notice_health('test')->>'unverified_disconnected_count')::bigint;
  c:=pg_temp.notice_fixture('provider_account_missing');
  update public.calendar_connections set health_state='disconnected',disconnected_at=now(),last_verified_at=now()-interval '16 minutes'
    where id=c;
  perform pg_temp.assert_notice((public.get_calendar_action_notice_health('test')->>'unverified_disconnected_count')::integer=fence+1
    and (select action_notice='{}'::jsonb from public.calendar_connections where id=c),
    'unclassified disconnected observation excluded by 140 is visible to operator without invented OAuth email');
end $test$;

savepoint retained_incidents;
-- Existing fixtures must not compete for the new scenario's notice claim.
update public.calendar_connections set action_notice_lease_expires_at=clock_timestamp()+interval '1 year'
  where action_notice<>'{}'::jsonb;
do $retained$
declare c uuid; env text; phase text; resolution text; baseline jsonb; health jsonb; binding jsonb;
  notice jsonb; after_notice jsonb; claim jsonb; result jsonb; message text; profile uuid; actor uuid;
  lease uuid; verification_lease uuid; fence bigint; pending integer; other_env text; other_baseline jsonb;
begin
  foreach env in array array['test','live'] loop
    foreach phase in array array['pending','claimed','dispatching','unknown','rejected','accepted'] loop
      foreach resolution in array array['recovery','revision','account','disconnect'] loop
        baseline:=public.get_calendar_action_notice_health(env);
        other_env:=case env when 'test' then 'live' else 'test' end;
        other_baseline:=public.get_calendar_action_notice_health(other_env);
        c:=pg_temp.notice_fixture(null,env); lease:=gen_random_uuid(); verification_lease:=gen_random_uuid();
        select x.profile_id,p.auth_user_id into profile,actor from public.calendar_connections x
          join public.profiles p on p.id=x.profile_id and p.environment=x.environment where x.id=c;
        insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,
          access_role,blocks_availability,receives_bookings,permission_verified_at)
          values(c,profile,env,'retained-destination','Retained destination','owner',true,true,clock_timestamp());
        set local role service_role;
        binding:=public.claim_saved_google_calendar_verification(profile,env,verification_lease,90,false);
        perform public.mark_google_calendar_connection_verified((binding->'binding'->>'id')::uuid,verification_lease,
          (binding->'binding'->>'reconciliation_fencing_token')::bigint,clock_timestamp(),
          '[{"id":"retained-destination","accessRole":"owner"}]');
        perform public.mark_google_calendar_connection_unhealthy((binding->'binding'->>'id')::uuid,verification_lease,
          (binding->'binding'->>'reconciliation_fencing_token')::bigint,false,'calendar_permissions_changed');
        reset role;
        update public.calendar_connections set action_notice=jsonb_set(jsonb_set(action_notice,'{opened_at}',to_jsonb(now()-interval '3 minutes')),
          '{current_incident,opened_at}',to_jsonb(now()-interval '3 minutes')) where id=c;
        if phase<>'pending' then
          set local role service_role;
          claim:=public.claim_calendar_action_notice(env,lease);
          reset role;
          perform pg_temp.assert_notice(claim->>'connection_id'=c::text,'exact notice claim for '||env||'/'||phase||'/'||resolution);
          fence:=(claim->>'fencing_token')::bigint;
          message:=jsonb_build_object('from','calendar@example.test','to',jsonb_build_array(claim->'notice'->>'recipient_email'),
            'subject','Access needs review','text','Review your selected calendar permissions.')::text;
          if phase<>'claimed' then
            set local role service_role;
            result:=public.transition_calendar_action_notice(env,c,(claim->'notice'->>'id')::uuid,lease,fence,'authorize',message);
            if phase<>'dispatching' then
              result:=public.transition_calendar_action_notice(env,c,(claim->'notice'->>'id')::uuid,lease,fence,phase,
                null,case when phase='accepted' then 'email_retained_'||c end);
            end if;
            reset role;
          end if;
        end if;
        select action_notice into notice from public.calendar_connections where id=c;
        set local role service_role;
        perform public.mark_google_calendar_connection_unhealthy((binding->'binding'->>'id')::uuid,verification_lease,
          (binding->'binding'->>'reconciliation_fencing_token')::bigint,false,'provider_temporary_failure');
        health:=public.get_calendar_action_notice_health(env);
        result:=public.claim_calendar_action_notice(env,gen_random_uuid());
        reset role;
        pending:=case when phase in ('pending','claimed','dispatching','unknown') then 1 else 0 end;
        perform pg_temp.assert_notice(result is null,'temporary evidence never permits stale advice in '||phase);
        perform pg_temp.assert_notice((select public.calendar_action_notice_scope(x) is null and action_notice=notice
          and not action_notice ? 'closed_at' from public.calendar_connections x where id=c),'temporary evidence retains exact open incident/dispatch bytes');
        perform pg_temp.assert_notice((health->>'action_required_count')::integer=(baseline->>'action_required_count')::integer+1,
          'paused remedy cannot resolve the retained '||phase||' incident in '||env);
        perform pg_temp.assert_notice((health->>'pending_count')::integer=(baseline->>'pending_count')::integer+pending,
          'pending inventory is retained evidence, not current send eligibility');
        perform pg_temp.assert_notice(pending=0 or (health->>'oldest_pending_age_seconds')::integer>=180,
          'temporary observation cannot reset pending age');
        perform pg_temp.assert_notice(exists(select 1 from jsonb_array_elements(health->'items') item
          where item->>'notice_id'=notice->>'id' and item->>'cause'='permissions' and item->>'closed_at' is null),
          'paused incident remains in the safe inventory under its original identity');
        result:=public.get_calendar_action_notice_health(other_env);
        perform pg_temp.assert_notice(result->'action_required_count'=other_baseline->'action_required_count'
          and result->'pending_count'=other_baseline->'pending_count'
          and not exists(select 1 from jsonb_array_elements(result->'items') item where item->>'notice_id'=notice->>'id'),
          'retained '||phase||' evidence never crosses environment scope');
        if phase='claimed' then
          result:=public.transition_calendar_action_notice(env,c,(notice->>'id')::uuid,lease,fence,'authorize',message);
          perform pg_temp.assert_notice(result->>'action'='deferred' and (select not action_notice ? 'first_dispatch_at'
            from public.calendar_connections where id=c),'claim before temporary observation cannot authorize stale advice');
        end if;
        if resolution='recovery' then
          set local role service_role;
          perform public.mark_google_calendar_connection_verified((binding->'binding'->>'id')::uuid,verification_lease,
            (binding->'binding'->>'reconciliation_fencing_token')::bigint,clock_timestamp(),
            '[{"id":"retained-destination","accessRole":"owner"}]');
          reset role;
        elsif resolution='revision' then
          update public.calendar_connections set connection_revision=connection_revision+1 where id=c;
        elsif resolution='account' then
          update public.calendar_connections set pipedream_account_id='apn_replacement_'||replace(c::text,'-','') where id=c;
        else
          set local role service_role;
          perform public.reserve_booking_provider_account_disconnect_v3(profile,env,binding->'connection'->>'pipedream_account_id',actor,
            (binding->'connection'->>'connection_revision')::bigint);
          reset role;
        end if;
        select action_notice into after_notice from public.calendar_connections where id=c;
        health:=public.get_calendar_action_notice_health(env);
        perform pg_temp.assert_notice(after_notice ? 'closed_at' and after_notice->>'id'=notice->>'id'
          and after_notice->'scope'=notice->'scope' and after_notice->'payload' is not distinct from notice->'payload'
          and after_notice->'first_dispatch_at' is not distinct from notice->'first_dispatch_at',
          resolution||' closes, never retargets or erases the old incident');
        perform pg_temp.assert_notice((health->>'action_required_count')::integer=(baseline->>'action_required_count')::integer
          and (health->>'pending_count')::integer=(baseline->>'pending_count')::integer,
          'only closed authority resolves active/pending evidence');
        if notice ? 'first_dispatch_at' and phase<>'accepted' then
          perform pg_temp.assert_notice(after_notice->>'state'='review' and exists(select 1 from jsonb_array_elements(health->'items') item
            where item->>'notice_id'=notice->>'id' and item->>'closed_at' is not null and item->>'state'='review'),
            'closed incident still retains independent unresolved delivery review');
        end if;
        perform pg_temp.assert_notice(public.claim_calendar_action_notice(env,gen_random_uuid()) is null,
          'closed temporary/recovered configuration cannot resend the old advice');
        if resolution='disconnect' then continue; end if;
        -- A new definite incident is independent of the old delivery and its lease.
        update public.pipedream_bindings set reconciliation_due_at=clock_timestamp(),
          reconciliation_lease_expires_at=clock_timestamp()-interval '1 second' where connection_id=c;
        verification_lease:=gen_random_uuid();
        set local role service_role;
        binding:=public.claim_saved_google_calendar_verification(profile,env,verification_lease,90,false);
        perform public.mark_google_calendar_connection_unhealthy((binding->'binding'->>'id')::uuid,verification_lease,
          (binding->'binding'->>'reconciliation_fencing_token')::bigint,false,'calendar_permissions_changed');
        reset role;
        select action_notice->'current_incident' into result from public.calendar_connections where id=c;
        perform pg_temp.assert_notice(result->>'id'<>notice->>'id' and not result ? 'closed_at'
          and result->'scope'->>'account_id'=binding->'connection'->>'pipedream_account_id'
          and result->'scope'->>'connection_revision'=binding->'connection'->>'connection_revision',
          'recurrence records a new exact incident even while the previous delivery is retained');
        if notice ? 'first_dispatch_at' then
          perform pg_temp.assert_notice((select action_notice-'current_incident'=after_notice-'current_incident'
            and action_notice_lease_token=lease and action_notice_fencing_token=fence
            from public.calendar_connections where id=c),'new incident cannot change old frozen payload, cause, identity or fence');
        end if;
        if phase in ('dispatching','accepted') then
          set local role service_role;
          perform public.transition_calendar_action_notice(env,c,(notice->>'id')::uuid,lease,fence,'accepted',null,
            case phase when 'accepted' then 'email_retained_'||c else 'email_after_close_'||c end);
          reset role;
          perform pg_temp.assert_notice((select action_notice->'current_incident'=result and action_notice->>'id'=notice->>'id'
            and action_notice->>'payload'=notice->>'payload' from public.calendar_connections where id=c),
            'old acceptance before temporary observation cannot erase or replace a definite recurrence');
        end if;
        select action_notice into after_notice from public.calendar_connections where id=c;
        set local role service_role;
        perform public.mark_google_calendar_connection_unhealthy((binding->'binding'->>'id')::uuid,verification_lease,
          (binding->'binding'->>'reconciliation_fencing_token')::bigint,false,'provider_temporary_failure');
        health:=public.get_calendar_action_notice_health(env);
        reset role;
        perform pg_temp.assert_notice((select action_notice=after_notice and last_verified_at=(binding->'connection'->>'last_verified_at')::timestamptz
          from public.calendar_connections where id=c),'temporary recurrence retains current evidence and last-success timestamp');
        perform pg_temp.assert_notice((health->>'action_required_count')::integer=(baseline->>'action_required_count')::integer+1
          and exists(select 1 from jsonb_array_elements(health->'items') item
            where item->'current_incident'->>'id'=result->>'id' and item->'current_incident'->>'closed_at' is null
              and item->>'notice_id'=after_notice->>'id'),
          'health separates open recurrent evidence from old closed delivery review');
        perform pg_temp.assert_notice(public.claim_calendar_action_notice(env,gen_random_uuid()) is null,
          'new incident never replays ambiguous old advice or sends through temporary evidence');
        if phase in ('dispatching','accepted') then
          set local role service_role;
          perform public.transition_calendar_action_notice(env,c,(notice->>'id')::uuid,lease,fence,'accepted',null,
            case phase when 'accepted' then 'email_retained_'||c else 'email_after_close_'||c end);
          reset role;
          perform pg_temp.assert_notice((select action_notice->'current_incident'=result and action_notice->>'id'=notice->>'id'
            and action_notice->>'payload'=notice->>'payload' from public.calendar_connections where id=c),
            'late/duplicate old acceptance settles only old delivery, never resolves the new incident');
        end if;
        -- An old successful timestamp is not positive evidence for this later denial.
        set local role service_role;
        perform public.mark_google_calendar_connection_verified((binding->'binding'->>'id')::uuid,verification_lease,
          (binding->'binding'->>'reconciliation_fencing_token')::bigint,(binding->'connection'->>'last_verified_at')::timestamptz,
          '[{"id":"retained-destination","accessRole":"owner"}]');
        reset role;
        update public.calendar_connections set action_notice=action_notice where id=c;
        perform pg_temp.assert_notice((select action_notice->'current_incident'=result from public.calendar_connections where id=c)
          and (public.get_calendar_action_notice_health(env)->>'action_required_count')::integer=(baseline->>'action_required_count')::integer+1,
          'old timestamp and unrelated delivery/row writes cannot clear recurrent evidence');
        set local role service_role;
        perform public.mark_google_calendar_connection_verified((binding->'binding'->>'id')::uuid,verification_lease,
          (binding->'binding'->>'reconciliation_fencing_token')::bigint,clock_timestamp(),
          '[{"id":"retained-destination","accessRole":"owner"}]');
        reset role;
        perform pg_temp.assert_notice((select action_notice->'current_incident'->>'id'=result->>'id'
          and (action_notice->'current_incident') ? 'closed_at' from public.calendar_connections where id=c)
          and (public.get_calendar_action_notice_health(env)->>'action_required_count')::integer=(baseline->>'action_required_count')::integer,
          'fresh exact verification closes the recurrent incident without rewriting its identity');
      end loop;
    end loop;
  end loop;
end $retained$;
rollback to retained_incidents;

rollback;
\echo 'calendar-action-notifications: roles, episodes, fences, recovery, dispatch lifetime and review passed'
