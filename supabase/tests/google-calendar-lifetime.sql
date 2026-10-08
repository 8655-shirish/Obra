\set ON_ERROR_STOP on
\echo 'google-calendar-lifetime: disposable local database only; transaction rolls back'
begin;

create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'assertion failed: %',message; end if;
end $$;

-- Simulated provider acknowledgements still traverse every durable SQL phase.
create function pg_temp.prove_setup(probe jsonb,lease uuid) returns void language plpgsql as $$
begin
  perform public.authorize_google_calendar_setup_effect((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint,'insert');
  perform public.settle_google_calendar_setup_probe((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint,true,true,null,'present');
  perform public.authorize_google_calendar_setup_effect((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint,'delete');
  perform public.settle_google_calendar_setup_probe((probe->>'profile_id')::uuid,probe->>'environment',(probe->>'id')::uuid,
    lease,(probe->>'fencing_token')::bigint,true,true,null,'absent');
end $$;

do $test$
#variable_conflict use_variable
declare
  owner_id uuid:=pg_catalog.gen_random_uuid();other_owner uuid:=pg_catalog.gen_random_uuid();
  profile_id uuid:=pg_catalog.gen_random_uuid();other_profile uuid:=pg_catalog.gen_random_uuid();
  live_owner uuid:=pg_catalog.gen_random_uuid();live_profile uuid:=pg_catalog.gen_random_uuid();
  website_id uuid:=pg_catalog.gen_random_uuid();
  account_id text:='apn_lifetime_fixture';new_account text:='apn_lifetime_reauthorized';
  c public.calendar_connections;b public.pipedream_bindings;d public.booking_provider_account_disconnects_v3;
  claim jsonb;probe jsonb;other_probe jsonb;selections jsonb;before_selections jsonb;old_health timestamptz;
  lease uuid:=pg_catalog.gen_random_uuid();second_lease uuid:=pg_catalog.gen_random_uuid();
  fence bigint;revision bigint;generation bigint;operation_id uuid;disconnect_id uuid;event_id uuid;
  failed boolean;attempt integer;proc regprocedure;
  epoch_id uuid;epoch_snapshot jsonb;connect_id uuid:=pg_catalog.gen_random_uuid();replacement jsonb;
  read_verified_at timestamptz:=pg_catalog.clock_timestamp();
  desired jsonb:='[
    {"id":"busy-a","displayName":"Conflict A","accessRole":"reader","blocksAvailability":true,"receivesBookings":false},
    {"id":"busy-b","displayName":"Conflict B","accessRole":"freeBusyReader","blocksAvailability":true,"receivesBookings":false},
    {"id":"destination","displayName":"Bookings","accessRole":"owner","blocksAvailability":false,"receivesBookings":true}
  ]'::jsonb;
  evidence jsonb:='[{"id":"busy-a","accessRole":"reader"},{"id":"busy-b","accessRole":"freeBusyReader"},{"id":"destination","accessRole":"owner"}]'::jsonb;
begin
  insert into auth.users(id,email) values(owner_id,'google-lifetime@example.test'),
    (other_owner,'google-lifetime-other@example.test'),(live_owner,'google-lifetime-live@example.test');
  insert into public.profiles(id,auth_user_id,license_number,email,environment) values
    (profile_id,owner_id,'GOOGLE-LIFETIME-A','google-lifetime@example.test','test'),
    (other_profile,other_owner,'GOOGLE-LIFETIME-B','google-lifetime-other@example.test','test'),
    (live_profile,live_owner,'GOOGLE-LIFETIME-C','google-lifetime-live@example.test','live');
  insert into public.websites(id,user_id,status,environment) values(website_id,profile_id,'draft','test');
  insert into public.website_entitlements(profile_id,website_id,environment,plan,state,effective_at,order_confirmed_at)
    values(profile_id,website_id,'test','pro','active',pg_catalog.clock_timestamp()-interval '1 day',pg_catalog.clock_timestamp());

  for proc in select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('claim_saved_google_calendar_verification','claim_due_pipedream_bindings',
      'reserve_google_calendar_setup_probe','mark_google_calendar_connection_verified','mark_google_calendar_connection_unhealthy',
      'authorize_google_calendar_connect_start','authorize_google_calendar_connect_completion','request_google_calendar_verification',
      'record_google_calendar_setup_read','restart_google_calendar_setup_probe','persist_google_calendar_configuration',
      'record_pipedream_trigger_deployment_result','adopt_pipedream_trigger_candidate',
      'reserve_pipedream_trigger_deployment','begin_pipedream_trigger_deployment_effect','apply_pipedream_trigger_projection',
      'settle_google_calendar_setup_probe',
      'retire_pipedream_trigger','claim_booking_provider_account_disconnect_v3','complete_booking_provider_account_disconnect_v3')
  loop
    perform pg_temp.assert_true((select prosecdef and proconfig=array['search_path=""'] from pg_catalog.pg_proc where oid=proc),proc::text||' has definer/search_path');
    perform pg_temp.assert_true(has_function_privilege('service_role',proc,'execute'),proc::text||' service grant');
    perform pg_temp.assert_true(not has_function_privilege('anon',proc,'execute') and not has_function_privilege('authenticated',proc,'execute')
      and not has_function_privilege('booking_worker',proc,'execute'),proc::text||' restricted grants');
  end loop;
  perform pg_temp.assert_true(not has_function_privilege('service_role','public.lock_google_calendar_binding(uuid,uuid,bigint,boolean,boolean)','execute'),
    'lock helper is not a public service API');

  failed:=false;
  begin
    perform public.reserve_google_calendar_setup_probe(profile_id,'test',other_owner,account_id,'destination',0,lease,desired,read_verified_at);
  exception when insufficient_privilege then failed:=true; end;
  perform pg_temp.assert_true(failed,'foreign owner cannot reserve setup');
  failed:=false;
  begin
    perform public.reserve_google_calendar_setup_probe(other_profile,'test',other_owner,'apn_other','destination',0,lease,desired,read_verified_at);
  exception when insufficient_privilege then failed:=true; end;
  perform pg_temp.assert_true(failed,'setup requires active confirmed Pro');

  set local role service_role;
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',0,lease,desired,read_verified_at,
    'google-lifetime@example.test','Lifetime test');
  reset role;
  select * into strict c from public.calendar_connections x where x.profile_id=profile_id and x.environment='test';
  perform pg_temp.assert_true(c.pipedream_account_id is null and c.last_verified_at is null,'probe reservation is not connected or verified');
  failed:=false;
  begin
    perform public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',c.connection_revision,second_lease,desired,read_verified_at,
      p_expected_setup_key=>probe->>'configuration_key');
  exception when lock_not_available then failed:=true; end;
  perform pg_temp.assert_true(failed,'setup lease deduplicates concurrent probes');
  update public.calendar_connections set setup_lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second' where id=c.id;
  other_probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',c.connection_revision,second_lease,desired,read_verified_at,
    p_expected_setup_key=>probe->>'configuration_key');
  perform pg_temp.assert_true(probe->>'id'=other_probe->>'id','lost probe response reuses stable operation identity');
  failed:=false;
  begin
    perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,true,true,null);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'expired setup owner cannot settle');
  update public.calendar_connections set setup_lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second' where id=c.id;
  other_probe:=public.claim_google_calendar_setup_probe('test',second_lease);
  perform pg_temp.assert_true(other_probe->>'id'=probe->>'id' and other_probe->>'cleanup_only'='false',
    'scheduled recovery resumes the exact current owner setup, not a periodic new probe');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(other_probe->>'id')::uuid,second_lease,
    (other_probe->>'fencing_token')::bigint,true,false,null,'absent');
  perform pg_temp.assert_true((select setup_completed_at is null and setup_write_verified_at is null and setup_retry_at is not null
    from public.calendar_connections where id=c.id),'probe absence keeps the owner-authorized setup continuation alive');
  failed:=false;
  begin
    perform public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,second_lease,(other_probe->>'fencing_token')::bigint);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'deleted-probe cleanup cannot authorize configuration as a successful write proof');
  other_probe:=public.restart_google_calendar_setup_probe(profile_id,'test',(other_probe->>'id')::uuid,second_lease,(other_probe->>'fencing_token')::bigint);
  perform pg_temp.assert_true(other_probe->>'id'=probe->>'id' and other_probe->>'probe_id'<>probe->>'probe_id',
    'tombstone advances the private probe, not the durable owner operation');
  probe:=other_probe;
  perform pg_temp.prove_setup(probe,second_lease);
  perform pg_temp.assert_true((select setup_completed_at is null and setup_retry_at is not null and pipedream_account_id is null
    from public.calendar_connections where id=c.id),'successful probe cannot terminate before configuration is persisted');
  failed:=false;
  begin
    perform public.record_google_calendar_setup_read(profile_id,'test',(probe->>'id')::uuid,second_lease,(probe->>'fencing_token')::bigint,
      desired-0,read_verified_at);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'setup write proof cannot save a different calendar selection snapshot');
  -- Crash after successful cleanup, then worker takeover and persistence, no owner callback.
  update public.calendar_connections set setup_lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second',
    setup_read_verified_at=pg_catalog.clock_timestamp()-interval '6 minutes' where id=c.id;
  other_probe:=public.claim_google_calendar_setup_probe('test',lease,'{}',profile_id);
  perform pg_temp.assert_true(other_probe->>'id'=probe->>'id' and other_probe->>'probe_state'='absent',
    'worker claims the proven operation across the persistence handoff');
  read_verified_at:=pg_catalog.clock_timestamp();
  perform public.record_google_calendar_setup_read(profile_id,'test',(other_probe->>'id')::uuid,lease,(other_probe->>'fencing_token')::bigint,desired,read_verified_at);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(other_probe->>'id')::uuid,lease,(other_probe->>'fencing_token')::bigint);
  perform pg_temp.assert_true(c.setup_completed_at is not null and c.setup_retry_at is null and c.pipedream_account_id=account_id,
    'only fenced configuration persistence completes the durable save');
  -- A rejected INSERT cannot trap the owner on an inaccessible account/calendar.
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_rejected','destination',c.connection_revision,
    lease,desired,read_verified_at,'rejected@example.test','Rejected');
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,'insert');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,
    false,false,'permissions','pending','insert',pg_catalog.clock_timestamp());
  perform pg_temp.assert_true((select health_state='healthy' and calendar_write_blocked_at is null from public.calendar_connections where id=c.id),
    'a different pending account denial cannot degrade the current saved account');
  other_probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',c.connection_revision,
    second_lease,desired,read_verified_at,'google-lifetime@example.test','Lifetime test',p_expected_setup_key=>probe->>'configuration_key');
  perform pg_temp.assert_true(other_probe->>'probe_account_id'=account_id and other_probe->>'probe_id'<>probe->>'probe_id'
    and other_probe->>'cleanup_only'='false','definite rejection allows a different accessible account without retrying the denied write');
  perform pg_temp.prove_setup(other_probe,second_lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(other_probe->>'id')::uuid,second_lease,(other_probe->>'fencing_token')::bigint);
  replacement:=jsonb_set(desired,'{0,id}','"busy-replacement"');
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',c.connection_revision,
    lease,replacement,pg_catalog.clock_timestamp(),'google-lifetime@example.test','Lifetime test');
  perform pg_temp.assert_true(public.claim_saved_google_calendar_verification(profile_id,'test',second_lease,60,true) is null,
    'material setup lease excludes concurrent trigger provisioning');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,
    false,false,'permissions','pending');
  other_probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',c.connection_revision,
    second_lease,desired,pg_catalog.clock_timestamp(),'google-lifetime@example.test','Lifetime test',p_expected_setup_key=>probe->>'configuration_key');
  perform pg_temp.prove_setup(other_probe,second_lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(other_probe->>'id')::uuid,second_lease,(other_probe->>'fencing_token')::bigint);

  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_superseded','destination',c.connection_revision,
    lease,desired,read_verified_at);
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,'insert');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,
    true,true,null,'present');
  update public.calendar_connections set setup_lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second' where id=c.id;
  other_probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',c.connection_revision,
    second_lease,desired,read_verified_at,'google-lifetime@example.test','Lifetime test',p_expected_setup_key=>probe->>'configuration_key');
  perform pg_temp.assert_true(other_probe->>'probe_id'=probe->>'probe_id' and other_probe->>'cleanup_only'='true',
    'supersession retains a possibly existing old private event and the new desired configuration');
  failed:=false;
  begin perform public.authorize_google_calendar_setup_effect(profile_id,'test',(other_probe->>'id')::uuid,second_lease,
    (other_probe->>'fencing_token')::bigint,'insert');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'superseded probe cannot INSERT against the old account');
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(other_probe->>'id')::uuid,second_lease,
    (other_probe->>'fencing_token')::bigint,'delete');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(other_probe->>'id')::uuid,second_lease,
    (other_probe->>'fencing_token')::bigint,false,false,'permissions',null,'delete',pg_catalog.clock_timestamp());
  perform pg_temp.assert_true((select health_state='healthy' and calendar_write_blocked_at is null from public.calendar_connections where id=c.id),
    'superseded-probe DELETE denial is not evidence against the new desired or saved account');
  update public.calendar_connections set setup_retry_at=pg_catalog.clock_timestamp() where id=c.id;
  other_probe:=public.claim_google_calendar_setup_probe('test',second_lease,'{}',profile_id);
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(other_probe->>'id')::uuid,second_lease,
    (other_probe->>'fencing_token')::bigint,true,false,null,'present');
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(other_probe->>'id')::uuid,second_lease,
    (other_probe->>'fencing_token')::bigint,'delete');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(other_probe->>'id')::uuid,second_lease,
    (other_probe->>'fencing_token')::bigint,true,false,null,'absent');
  other_probe:=public.restart_google_calendar_setup_probe(profile_id,'test',(other_probe->>'id')::uuid,second_lease,(other_probe->>'fencing_token')::bigint);
  perform pg_temp.prove_setup(other_probe,second_lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(other_probe->>'id')::uuid,second_lease,(other_probe->>'fencing_token')::bigint);
  revision:=c.connection_revision;
  -- The status RPC is a failure observation, not a second successful verifier.
  c:=public.reconcile_google_calendar_connection(profile_id,'test',owner_id,revision,'degraded','provider_temporary_failure',read_verified_at);
  perform pg_temp.assert_true(c.connection_revision=revision and c.last_verified_at=read_verified_at,
    'owner health failure is also non-destructive and preserves last-success time');
  failed:=false;
  begin
    perform public.reconcile_google_calendar_connection(profile_id,'test',owner_id,revision,'healthy',null,read_verified_at);
  exception when invalid_parameter_value then failed:=true; end;
  perform pg_temp.assert_true(failed,'legacy owner status cannot stamp successful permission health');
  perform pg_temp.assert_true(c.pipedream_account_id=account_id,'owner verified setup saves account');
  select (public.ensure_calendar_destination_epoch(profile_id,'test',c.id,s.id)).id into epoch_id
    from public.calendar_selections s where s.connection_id=c.id and s.active and s.receives_bookings;
  select to_jsonb(e) into epoch_snapshot from public.calendar_destination_epochs e where e.id=epoch_id;
  perform pg_temp.assert_true(not exists(select 1 from public.pipedream_bindings x where x.profile_id=profile_id),
    'setup does not pretend a binding has been deployed');

  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,true);
  perform pg_temp.assert_true(claim is not null,'saved configuration with no binding is discoverable');
  select * into strict b from public.pipedream_bindings x where x.profile_id=profile_id and x.environment='test';
  fence:=b.reconciliation_fencing_token;
  perform pg_temp.assert_true(b.selected_calendar_ids='["busy-a","busy-b"]'::jsonb and b.configuration_revision=revision,
    'missing binding inherits exact full blocking set/revision, not destination-only defaults');
  perform pg_temp.assert_true(public.claim_saved_google_calendar_verification(profile_id,'test',second_lease,60,false) is null,
    'tenant claim is cross-request deduplicated');
  perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);
  b:=public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,account_id,revision,b.id,lease,fence,'1.2.3');
  operation_id:=b.deployment_operation_id;
  -- A provably unsent/rejected create may retry; a failed observation of an
  -- ambiguous create must preserve dispatch regardless of its failure category.
  perform public.begin_pipedream_trigger_deployment_effect(b.id,lease,fence,operation_id);
  failed:=false;
  begin perform public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',revision,
    second_lease,desired-0,read_verified_at);
  exception when lock_not_available then failed:=true; end;
  perform pg_temp.assert_true(failed and (select deployment_operation_id=operation_id and deployment_dispatched_at is not null
    from public.pipedream_bindings where id=b.id),'material selection changes defer without erasing a dispatched deployment');
  perform public.fail_pipedream_binding_reconciliation(b.id,lease,fence,'provider_platform_error',null,true);
  perform pg_temp.assert_true((select deployment_dispatched_at is null and deployment_operation_id=operation_id
    from public.pipedream_bindings where id=b.id),'definite pre-send rejection clears dispatch without minting a new operation');
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,true);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  b:=public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,account_id,revision,b.id,lease,fence,'1.2.3');
  perform public.begin_pipedream_trigger_deployment_effect(b.id,lease,fence,operation_id);
  perform public.fail_pipedream_binding_reconciliation(b.id,lease,fence,'provider_temporary_failure',null,false);
  perform pg_temp.assert_true((select deployment_dispatched_at is not null from public.pipedream_bindings where id=b.id),
    'timeout or 5xx preserves ambiguous dispatch for scoped discovery');
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,true);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_wrong_version',operation_id);
  perform public.fail_pipedream_binding_reconciliation(b.id,lease,fence,'trigger_version_unverified',
    '{"id":"dc_wrong_version","componentKey":"google_calendar-new-or-updated-event-instant","componentVersion":null}'::jsonb,false);
  perform pg_temp.assert_true((select deployment_candidate_trigger_id='dc_wrong_version' and trigger_state='degraded'
    and deployed_trigger_id is null and last_health_at is null from public.pipedream_bindings where id=b.id),
    'returned incompatible trigger remains owned but unverified for cleanup');
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,true);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  b:=public.retire_pipedream_trigger(b.id,lease,fence,'dc_wrong_version');
  perform public.authorize_pipedream_trigger_cleanup(b.id,lease,fence,'dc_wrong_version');
  perform public.complete_pipedream_stale_trigger_cleanup(b.id,lease,fence,'dc_wrong_version');
  b:=public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,account_id,revision,b.id,lease,fence,'1.2.3');
  perform pg_temp.assert_true(b.deployment_operation_id<>operation_id and 'dc_wrong_version'=any(b.retired_trigger_ids),
    'fenced retirement releases replacement deployment without reusing the rejected resource');
  operation_id:=b.deployment_operation_id;
  perform public.begin_pipedream_trigger_deployment_effect(b.id,lease,fence,operation_id);
  update public.pipedream_bindings set reconciliation_lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second',
    deployment_lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',second_lease,60,true);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  perform pg_temp.assert_true(claim->'binding'->>'deployment_operation_id'=operation_id::text
    and claim->'binding'->>'deployment_dispatched_at' is not null,'expired deployment preserves dispatched identity for discovery');
  failed:=false;
  begin
    perform public.begin_pipedream_trigger_deployment_effect(b.id,second_lease,fence,operation_id);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'ambiguous deployment cannot dispatch another create');
  perform public.mark_google_calendar_connection_verified(b.id,second_lease,fence,pg_catalog.clock_timestamp(),evidence);
  b:=public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,account_id,revision,b.id,second_lease,fence,'1.2.3');
  perform public.adopt_pipedream_trigger_candidate(b.id,second_lease,fence,'dc_lifetime',operation_id);
  b:=public.apply_pipedream_trigger_projection(b.id,b.webhook_correlation_id,profile_id,'test',c.id,account_id,
    b.component_key,'1.2.3','["busy-a","busy-b"]','dc_lifetime','wh_lifetime','fixture-signing-key',true,
    pg_catalog.clock_timestamp(),null,second_lease,fence,operation_id,revision,b.component_key,'1.2.3');
  old_health:=b.last_health_at;
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()+interval '1 hour' where id=b.id;
  perform pg_temp.assert_true(public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,false) is null,
    'successful evidence creates a tenant positive cooldown');
  perform pg_temp.assert_true(public.request_google_calendar_verification(profile_id,'test',owner_id),
    'explicit owner check can wake a cooldown-limited tenant');
  perform pg_temp.assert_true((select reconciliation_due_at<=pg_catalog.clock_timestamp() from public.pipedream_bindings where id=b.id),
    'owner wakeup reaches an hourly retry without extending readiness');
  perform pg_temp.assert_true(not public.request_google_calendar_verification(profile_id,'test',owner_id),
    'owner wakeups have a database-time rate bound');
  select jsonb_agg(jsonb_build_array(s.id,s.google_calendar_id,s.active,s.blocks_availability,s.receives_bookings)order by s.google_calendar_id)
    into before_selections from public.calendar_selections s where s.connection_id=c.id;
  select availability_generation into generation from public.calendar_connections where id=c.id;

  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,false);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  select * into c from public.calendar_connections where id=c.id;
  perform public.mark_google_calendar_connection_unhealthy(b.id,lease,fence,false,'provider_temporary_failure');
  perform pg_temp.assert_true((select x.connection_revision=revision and x.last_verified_at=c.last_verified_at
    and x.availability_generation>generation and x.health_state='degraded' from public.calendar_connections x where x.id=c.id),
    'health failure preserves revision and last successful verification, invalidates unsafe availability');
  perform pg_temp.assert_true((select x.deployed_trigger_id='dc_lifetime' and x.reconciliation_lease_token=lease
    and x.reconciliation_fencing_token=fence and cardinality(x.pending_trigger_deletions)=0 from public.pipedream_bindings x where x.id=b.id),
    'health failure does not invalidate its own fence or retire the live trigger');
  perform public.fail_pipedream_binding_reconciliation(b.id,lease,fence,'provider_temporary_failure');
  perform pg_temp.assert_true(public.resolve_pipedream_trigger_signing_key('test',b.id,'dc_lifetime',account_id,b.webhook_correlation_id)='fixture-signing-key',
    'exact current degraded binding retains webhook trust');

  event_id:=public.ingest_pipedream_calendar_event('evt_lifetime','test',b.id,account_id,'dc_lifetime',b.webhook_correlation_id,
    'calendar.updated',repeat('a',64),'{}',pg_catalog.clock_timestamp());
  perform pg_temp.assert_true(event_id=public.ingest_pipedream_calendar_event('evt_lifetime','test',b.id,account_id,'dc_lifetime',b.webhook_correlation_id,
    'calendar.updated',repeat('a',64),'{}',pg_catalog.clock_timestamp()),'webhook replay is idempotent');
  update public.provider_event_inbox set processing_state='processing',lease_token=second_lease,
    lease_expires_at=pg_catalog.clock_timestamp()+interval '1 minute',fencing_token=1 where id=event_id;
  perform public.apply_pipedream_calendar_event(event_id,second_lease,1,pg_catalog.clock_timestamp());
  perform pg_temp.assert_true((select x.last_health_at=old_health and x.last_event_at is not null
    and x.reconciliation_reason='provider_temporary_failure' from public.pipedream_bindings x where x.id=b.id),
    'webhook changes last_event_at, never last_health_at or failure state');
  failed:=false;
  begin
    perform public.ingest_pipedream_calendar_event('evt_lifetime','test',b.id,account_id,'dc_lifetime',b.webhook_correlation_id,
      'calendar.updated',repeat('b',64),'{}',pg_catalog.clock_timestamp());
  exception when no_data_found then failed:=true; end;
  perform pg_temp.assert_true(failed,'replayed event ID with a different payload hash is rejected');
  perform pg_temp.assert_true(public.resolve_pipedream_trigger_signing_key('live',b.id,'dc_lifetime',account_id,b.webhook_correlation_id) is null,
    'webhook cannot cross environments');

  for attempt in 1..10 loop
    update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
    claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,false);
    fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
    perform public.mark_google_calendar_connection_unhealthy(b.id,lease,fence,false,'provider_temporary_failure');
    perform public.fail_pipedream_binding_reconciliation(b.id,lease,fence,'provider_temporary_failure');
  end loop;
  perform pg_temp.assert_true((select x.reconciliation_attempts>8 and x.reconciliation_due_at>pg_catalog.clock_timestamp()+interval '59 minutes'
    from public.pipedream_bindings x where x.id=b.id),'outage beyond eight attempts retains slow scheduled recovery');
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,false);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  failed:=false;
  begin
    perform public.mark_google_calendar_connection_verified(b.id,second_lease,fence,pg_catalog.clock_timestamp(),evidence);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'different lease cannot settle current evidence');
  failed:=false;
  begin
    perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence-1);
  exception when invalid_parameter_value then failed:=true; end;
  perform pg_temp.assert_true(failed,'incomplete selected-calendar evidence cannot become healthy');
  perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);
  select jsonb_agg(jsonb_build_array(s.id,s.google_calendar_id,s.active,s.blocks_availability,s.receives_bookings)order by s.google_calendar_id)
    into selections from public.calendar_selections s where s.connection_id=c.id;
  perform pg_temp.assert_true(selections=before_selections,'health failure and recovery preserve all saved selections/identities');
  perform pg_temp.assert_true((select x.health_state='healthy' and x.connection_revision=revision from public.calendar_connections x where x.id=c.id),
    'recovery requires no OAuth and does not change the connection revision');
  perform public.mark_google_calendar_connection_unhealthy(b.id,lease,fence,true,'provider_reauthorization_required');
  perform pg_temp.assert_true(public.resolve_pipedream_trigger_signing_key('test',b.id,'dc_lifetime',account_id,b.webhook_correlation_id) is null,
    'confirmed revoked authorization rejects even a signed current trigger');
  perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);

  update public.calendar_connections set verification_reason='calendar_write_blocked',health_state='degraded' where id=c.id;
  perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);
  perform pg_temp.assert_true((select x.verification_reason='calendar_write_blocked' and x.health_state='degraded'
    from public.calendar_connections x where x.id=c.id),'read success cannot clear a booking write blocker');
  read_verified_at:=pg_catalog.clock_timestamp();
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',revision,second_lease,desired,read_verified_at);
  perform pg_temp.prove_setup(probe,second_lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,second_lease,(probe->>'fencing_token')::bigint);
  perform pg_temp.assert_true(c.connection_revision=revision and c.verification_reason='calendar_write_blocked' and c.health_state='degraded',
    'same-config private setup probe neither fabricates a reconfiguration nor clears a known attendee/write blocker');
  perform pg_temp.assert_true((select x.reconciliation_lease_token=lease and x.deployed_trigger_id='dc_lifetime'
    from public.pipedream_bindings x where x.id=b.id),'same-config save does not invalidate concurrent read-only verification');
  -- A DELETE-only blocker can be answered without another booking or purchase.
  -- An attendee-bearing CREATE blocker must survive exactly the same probe.
  update public.calendar_connections set calendar_create_verified_at=pg_catalog.clock_timestamp(),calendar_create_blocked_at=null,
    calendar_delete_blocked_at=pg_catalog.clock_timestamp(),owner_verification_requested_at=null where id=c.id;
  perform public.request_google_calendar_verification(profile_id,'test',owner_id);
  probe:=public.claim_google_calendar_setup_probe('test',second_lease,'{}',profile_id);
  perform pg_temp.assert_true(probe->>'purpose'='write_recovery','owner check schedules only a known private-probe-capable denial');
  perform public.record_google_calendar_setup_read(profile_id,'test',(probe->>'id')::uuid,second_lease,(probe->>'fencing_token')::bigint,
    desired,pg_catalog.clock_timestamp());
  perform pg_temp.prove_setup(probe,second_lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,second_lease,(probe->>'fencing_token')::bigint);
  perform pg_temp.assert_true(c.calendar_delete_blocked_at is null and c.verification_reason is null,
    'attributable private DELETE clears only its later same-config DELETE blocker');
  update public.calendar_connections set calendar_create_blocked_at=pg_catalog.clock_timestamp(),owner_verification_requested_at=null where id=c.id;
  perform public.request_google_calendar_verification(profile_id,'test',owner_id);
  perform pg_temp.assert_true(public.claim_google_calendar_setup_probe('test',second_lease,'{}',profile_id) is null,
    'attendee CREATE denial does not schedule misleading attendee-free proof');
  failed:=false;
  begin
    perform public.apply_pipedream_trigger_projection(b.id,b.webhook_correlation_id,profile_id,'test',c.id,account_id,
      b.component_key,'1.2.3','["busy-a","busy-b"]','dc_lifetime','wh_lifetime','fixture-signing-key',true,
      pg_catalog.clock_timestamp(),null,lease,fence,null,revision,b.component_key,null);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'null observed version cannot be projected as a requested version');
  failed:=false;
  begin
    perform public.retire_pipedream_trigger(b.id,lease,fence,'dc_lifetime');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'public read-only lease cannot authorize retirement');
  perform public.fail_pipedream_binding_reconciliation(b.id,lease,fence,'trigger_contract_mismatch',
    jsonb_build_object('id','dc_lifetime','componentKey','wrong-key','componentVersion','9.9.9'));
  perform pg_temp.assert_true((select x.component_key='google_calendar-new-or-updated-event-instant' and x.component_version='1.2.3'
    and x.observed_component_key='wrong-key' and x.observed_component_version='9.9.9' from public.pipedream_bindings x where x.id=b.id),
    'observed wrong component/version never replaces desired contract');

  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,true);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  b:=public.retire_pipedream_trigger(b.id,lease,fence,'dc_lifetime');
  perform pg_temp.assert_true(public.resolve_pipedream_trigger_signing_key('test',b.id,'dc_lifetime',account_id,b.webhook_correlation_id) is null,
    'retirement immediately revokes webhook trust before DELETE');
  failed:=false;
  begin
    perform public.ingest_pipedream_calendar_event('evt_retired','test',b.id,account_id,'dc_lifetime',b.webhook_correlation_id,
      'calendar.updated',repeat('c',64),'{}',pg_catalog.clock_timestamp());
  exception when insufficient_privilege then failed:=true; end;
  perform pg_temp.assert_true(failed,'retired webhook cannot enqueue calendar events even through service ingress');
  perform public.authorize_pipedream_trigger_cleanup(b.id,lease,fence,'dc_lifetime');
  perform public.complete_pipedream_stale_trigger_cleanup(b.id,lease,fence,'dc_lifetime');
  perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);
  b:=public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,account_id,revision,b.id,lease,fence,'1.2.3');
  failed:=false;
  begin
    perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_lifetime',b.deployment_operation_id);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'acknowledged DELETE tombstone prevents late-delete/adoption race');
  perform public.fail_pipedream_binding_reconciliation(b.id,lease,fence,'provider_temporary_failure');

  -- A genuine material revision invalidates the old claim even when the account
  -- stays the same. Health-only transitions above deliberately do not do this.
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,false);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  update public.calendar_connections set connection_revision=connection_revision+1 where id=c.id;
  select connection_revision into revision from public.calendar_connections where id=c.id;
  failed:=false;
  begin
    perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'material reconfiguration fences a stale verifier');

  -- Disconnect must stop work even while a CREATE response is unknown, but keep
  -- the old dispatch available to discovery and late response attribution.
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,true);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);
  b:=public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,account_id,revision,b.id,lease,fence,'1.2.3');
  operation_id:=b.deployment_operation_id;
  perform public.begin_pipedream_trigger_deployment_effect(b.id,lease,fence,operation_id);

  disconnect_id:=public.reserve_booking_provider_account_disconnect_v3(profile_id,'test',account_id,owner_id,revision);
  select * into c from public.calendar_connections x where x.id=c.id;
  perform pg_temp.assert_true(c.verification_reason='contractor_disconnected','disconnect intent stops work before DELETE');
  perform pg_temp.assert_true((select retired_deployment->>'operation_id'=operation_id::text from public.pipedream_bindings where id=b.id),
    'disconnect retains the old operation and exact deployment contract');
  perform pg_temp.assert_true(not public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_late_disconnect',operation_id),
    'the original CREATE response handoff records late retirement instead of healthy adoption');
  perform pg_temp.assert_true((select retired_deployment is null and 'dc_late_disconnect'=any(pending_trigger_deletions)
    from public.pipedream_bindings where id=b.id),'late CREATE identity survives its lost maintenance fence');
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',second_lease,60,true);
  perform pg_temp.assert_true(claim->>'cleanup_only'='true','disconnected trigger work can only clean up');
  perform public.complete_pipedream_stale_trigger_cleanup(b.id,second_lease,(claim->'binding'->>'reconciliation_fencing_token')::bigint,'dc_late_disconnect');
  perform public.settle_pipedream_binding_cleanup(b.id,second_lease,(claim->'binding'->>'reconciliation_fencing_token')::bigint);
  perform public.authorize_google_calendar_connect_start(profile_id,'test',owner_id,connect_id);
  perform pg_temp.assert_true((public.authorize_google_calendar_connect_completion(profile_id,'test',owner_id,connect_id)).id=c.id,
    'pending old DELETE permits a durable owner Connect operation for a distinct identity');
  perform pg_temp.assert_true(public.resolve_pipedream_trigger_signing_key('test',b.id,'dc_lifetime',account_id,b.webhook_correlation_id) is null,
    'disconnect revokes webhook trust regardless of old health');
  perform pg_temp.assert_true(public.claim_saved_google_calendar_verification(profile_id,'test',second_lease,60,true) is null,
    'background repair cannot resurrect disconnect intent');
  select jsonb_agg(jsonb_build_array(s.id,s.google_calendar_id,s.active,s.blocks_availability,s.receives_bookings)order by s.google_calendar_id)
    into selections from public.calendar_selections s where s.connection_id=c.id;
  perform pg_temp.assert_true(selections=before_selections,'disconnect preserves desired calendar attribution');
  select * into d from jsonb_populate_record(null::public.booking_provider_account_disconnects_v3,
    public.claim_booking_provider_account_disconnect_v3('test',lease,disconnect_id));
  for attempt in 1..9 loop
    perform public.begin_booking_provider_account_disconnect_v3(d.id,profile_id,'test',account_id,lease,d.fencing_token);
    perform public.fail_booking_provider_account_disconnect_v3(d.id,profile_id,'test',account_id,lease,d.fencing_token,'provider_temporary_failure');
    perform pg_temp.assert_true((select retry_at is not null from public.booking_provider_account_disconnects_v3 where id=d.id),
      'disconnect always retains a due retry');
    update public.booking_provider_account_disconnects_v3 set retry_at=pg_catalog.clock_timestamp()-interval '1 second' where id=d.id;
    select * into d from jsonb_populate_record(null::public.booking_provider_account_disconnects_v3,
      public.claim_booking_provider_account_disconnect_v3('test',lease,disconnect_id));
  end loop;
  perform public.begin_booking_provider_account_disconnect_v3(d.id,profile_id,'test',account_id,lease,d.fencing_token);
  update public.booking_provider_account_disconnects_v3 set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second' where id=d.id;
  select * into d from jsonb_populate_record(null::public.booking_provider_account_disconnects_v3,
    public.claim_booking_provider_account_disconnect_v3('test',second_lease,disconnect_id));
  perform pg_temp.assert_true(d.dispatch_state='ambiguous','expired dispatched DELETE becomes ambiguous');
  failed:=false;
  begin
    perform public.complete_booking_provider_account_disconnect_v3(d.id,profile_id,'test',account_id,lease,d.fencing_token-1);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'stale disconnect owner cannot settle');
  failed:=false;
  begin
    perform public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,account_id,'destination',c.connection_revision,lease,desired,read_verified_at);
  exception when insufficient_privilege then failed:=true; end;
  perform pg_temp.assert_true(failed,'same provider ID cannot be reused while DELETE is ambiguous');

  -- A distinct account uses the owner's explicit selection save, not OAuth
  -- completion permission to copy the old account's calendars automatically.
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,new_account,'destination',c.connection_revision,lease,desired,read_verified_at,
    'new-owner@example.test','Reauthorized');
  perform pg_temp.prove_setup(probe,lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint);
  perform public.complete_booking_provider_account_disconnect_v3(d.id,profile_id,'test',account_id,second_lease,d.fencing_token);
  perform pg_temp.assert_true((select x.pipedream_account_id=new_account and x.health_state='healthy' from public.calendar_connections x where x.id=c.id),
    'late old-account DELETE settlement cannot clear a distinct owner-authorized account');
  perform pg_temp.assert_true((select x.state='completed' and x.dispatch_state='settled' from public.booking_provider_account_disconnects_v3 x where x.id=d.id),
    'disconnect completion remains meaningful to paid-calendar workers');
  perform pg_temp.assert_true((select to_jsonb(e)=epoch_snapshot from public.calendar_destination_epochs e where e.id=epoch_id),
    'health, disconnect and reauthentication never rewrite historical account/destination epochs');

  -- Local clear after DELETE and audit settle is the same atomic transition. A
  -- second disconnect exercises resumption when no current provider ID remains.
  disconnect_id:=public.reserve_booking_provider_account_disconnect_v3(profile_id,'test',new_account,owner_id,c.connection_revision);
  select * into d from jsonb_populate_record(null::public.booking_provider_account_disconnects_v3,
    public.claim_booking_provider_account_disconnect_v3('test',lease,disconnect_id));
  perform public.begin_booking_provider_account_disconnect_v3(d.id,profile_id,'test',new_account,lease,d.fencing_token);
  perform public.complete_booking_provider_account_disconnect_v3(d.id,profile_id,'test',new_account,lease,d.fencing_token);
  select * into c from public.calendar_connections x where x.id=c.id;
  perform pg_temp.assert_true(c.pipedream_account_id is null and c.verification_reason='contractor_disconnected','completed disconnect clears only matching account');
  failed:=false;
  begin perform public.reserve_booking_provider_account_disconnect_v3(profile_id,'test','apn_foreign',owner_id,c.connection_revision);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'a cleared connection cannot authorize deletion of an unrelated provider identity');
  failed:=false;
  begin perform public.authorize_google_calendar_connect_completion(profile_id,'test',owner_id,connect_id);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'a Connect callback predating a newer disconnect is fenced');
  failed:=false;
  begin perform public.authorize_google_calendar_setup_read(profile_id,'test',new_account,c.connection_revision-1);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'obsolete editor revision is rejected before provider discovery');
  perform pg_temp.assert_true(public.reserve_booking_provider_account_disconnect_v3(profile_id,'test',null,owner_id,c.connection_revision)=disconnect_id,
    'owner retry finds durable disconnect even after connection was cleared');

  insert into public.calendar_connections(profile_id,environment,external_user_id,pipedream_account_id,health_state)
    values(live_profile,'live','obra:live:'||live_profile::text,'apn_live_fixture','healthy') returning * into c;
  insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,access_role,blocks_availability,receives_bookings)
    values(c.id,live_profile,'live','primary','Primary','owner',true,true);
  perform pg_temp.assert_true(public.claim_saved_google_calendar_verification(live_profile,'test',lease,60,true) is null,
    'targeted verification cannot cross environment');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_due_pipedream_bindings('test',lease,1,60)x
    where x->'connection'->>'environment'='live'),'global due claims remain deployment-environment scoped');
  raise notice 'google-calendar-lifetime: authority, health, retries, setup, webhook, retirement and disconnect transitions passed';
end $test$;

do $setup_regressions$
#variable_conflict use_variable
declare
  owner_id uuid:=pg_catalog.gen_random_uuid();profile_id uuid:=pg_catalog.gen_random_uuid();website_id uuid:=pg_catalog.gen_random_uuid();
  lease uuid:=pg_catalog.gen_random_uuid();next_lease uuid:=pg_catalog.gen_random_uuid();
  c public.calendar_connections;key_fixture public.calendar_connections;b public.pipedream_bindings;probe jsonb;next_probe jsonb;claim jsonb;
  desired jsonb:='[{"id":"busy-a","displayName":"Busy","accessRole":"reader","blocksAvailability":true,"receivesBookings":false},
    {"id":"destination","displayName":"Destination","accessRole":"owner","blocksAvailability":false,"receivesBookings":true}]';
  changed jsonb;key_a text;key_b text;failed boolean;observed_at timestamptz;before_generation bigint;disconnect_id uuid;
  connect_id uuid:=pg_catalog.gen_random_uuid();
begin
  insert into auth.users(id,email) values(owner_id,'setup-regression@example.test');
  insert into public.profiles(id,auth_user_id,license_number,email,environment)
    values(profile_id,owner_id,'GOOGLE-SETUP-REGRESSION','setup-regression@example.test','test');
  insert into public.websites(id,user_id,status,environment) values(website_id,profile_id,'draft','test');
  insert into public.website_entitlements(profile_id,website_id,environment,plan,state,effective_at,order_confirmed_at)
    values(profile_id,website_id,'test','pro','active',pg_catalog.clock_timestamp()-interval '1 day',pg_catalog.clock_timestamp());
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_current','destination',0,lease,desired,pg_catalog.clock_timestamp());
  select * into c from public.calendar_connections x where x.profile_id=profile_id and x.environment='test';
  key_a:=probe->>'configuration_key';
  perform pg_temp.assert_true(key_a=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    '["'||(probe->>'id')||'","apn_current",1,["busy-a"],"destination"]','UTF8'),'sha256'),'hex'),
    'SQL pending key matches the existing JSON.stringify owner DTO contract');
  key_fixture:=c;
  key_fixture.setup_operation_id:='00000000-0000-4000-8000-000000000001';
  key_fixture.connection_revision:=12;key_fixture.setup_expected_revision:=12;
  select jsonb_agg(jsonb_build_object('id',id,'blocksAvailability',true,'receivesBookings',false)) into key_fixture.setup_calendars
    from unnest(array['z','a'||chr(34)||'b','a'||chr(92)||'b','a'||chr(10)||'b',chr(8232),chr(57344),chr(65536)]) ids(id);
  perform pg_temp.assert_true(public.google_calendar_setup_configuration_key(key_fixture)='2ed4a50a65c38d0df0c98192cdd54d7375ff93eb96fdbd0856dac710f29b9beb',
    'pending key matches JavaScript JSON escaping and UTF-16 sort order, not database collation');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,false,false,'temporary');
  perform public.authorize_google_calendar_connect_start(profile_id,'test',owner_id,connect_id);
  changed:=jsonb_set(desired,'{0,id}','"busy-b"');
  next_probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_current','destination',c.connection_revision,
    next_lease,changed,pg_catalog.clock_timestamp(),p_expected_setup_key=>key_a);
  key_b:=next_probe->>'configuration_key';
  perform pg_temp.assert_true(key_b<>key_a and next_probe->>'id'=probe->>'id','pending choice replacement changes view key without inventing a connection revision');
  failed:=false;
  begin perform public.authorize_google_calendar_connect_completion(profile_id,'test',owner_id,connect_id);
  exception when serialization_failure then failed:=true;end;
  perform pg_temp.assert_true(failed,'an outstanding OAuth callback cannot overwrite newer same-revision pending choices');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(next_probe->>'id')::uuid,next_lease,(next_probe->>'fencing_token')::bigint,false,false,'temporary');
  failed:=false;
  begin perform public.authorize_google_calendar_setup_read(profile_id,'test','apn_current',c.connection_revision,key_a);
  exception when serialization_failure then failed:=true;end;
  perform pg_temp.assert_true(failed,'stale pending editor is rejected by pre-provider authorization');
  failed:=false;
  begin perform public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_current','destination',c.connection_revision,
    lease,desired,pg_catalog.clock_timestamp(),p_expected_setup_key=>key_a);
  exception when serialization_failure then failed:=true;end;
  perform pg_temp.assert_true(failed,'atomic reservation rejects old pending choices even if their connection revision is current');
  failed:=false;
  begin perform public.authorize_google_calendar_setup_read(profile_id,'test','apn_current',c.connection_revision);
  exception when serialization_failure then failed:=true;end;
  perform pg_temp.assert_true(failed,'omitting a required pending key cannot legitimize an unseen setup');
  update public.calendar_connections set setup_retry_at=pg_catalog.clock_timestamp() where id=c.id;
  probe:=public.claim_google_calendar_setup_probe('test',lease,'{}',profile_id);
  perform pg_temp.assert_true(probe->>'configuration_key'=key_b,'worker lease takeover does not invalidate an unchanged editor');
  perform pg_temp.prove_setup(probe,lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint);
  desired:=changed;
  perform pg_temp.assert_true(public.google_calendar_setup_configuration_key(c) is null,'committed setup no longer requires a pending editor key');
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,60,true);
  select * into b from public.pipedream_bindings where connection_id=c.id;
  perform public.mark_google_calendar_connection_verified(b.id,lease,(claim->'binding'->>'reconciliation_fencing_token')::bigint,
    pg_catalog.clock_timestamp(),'[{"id":"busy-b","accessRole":"reader"},{"id":"destination","accessRole":"owner"}]');

  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_current','destination',c.connection_revision,
    next_lease,desired,pg_catalog.clock_timestamp());
  select availability_generation into before_generation from public.calendar_connections where id=c.id;
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,'insert');
  observed_at:=pg_catalog.clock_timestamp();
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,
    false,false,'permissions','pending','insert',observed_at);
  select * into c from public.calendar_connections where id=c.id;
  perform pg_temp.assert_true(c.calendar_probe_insert_blocked_at=observed_at and c.calendar_create_blocked_at is null and c.calendar_delete_blocked_at is null
    and c.health_state='degraded' and c.verification_reason='calendar_write_blocked' and c.availability_generation>before_generation,
    'same saved destination INSERT denial atomically restricts admission and invalidates slot evidence');
  perform public.mark_google_calendar_connection_verified(b.id,lease,(claim->'binding'->>'reconciliation_fencing_token')::bigint,
    pg_catalog.clock_timestamp(),'[{"id":"busy-b","accessRole":"reader"},{"id":"destination","accessRole":"owner"}]');
  perform pg_temp.assert_true((select calendar_probe_insert_blocked_at=observed_at and health_state='degraded' from public.calendar_connections where id=c.id),
    'ordinary successful reads cannot erase a setup write denial');
  perform pg_temp.assert_true(public.calendar_action_notice_scope(c)->>'cause'='permissions',
    'classified setup denial feeds the existing action notice authority');
  update public.calendar_connections set setup_retry_at=pg_catalog.clock_timestamp() where id=c.id;
  probe:=public.claim_google_calendar_setup_probe('test',next_lease,'{}',profile_id);
  perform pg_temp.prove_setup(probe,next_lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint);
  perform pg_temp.assert_true(c.health_state='healthy' and c.verification_reason is null
    and c.calendar_write_blocked_at is null and c.calendar_create_blocked_at is null and c.calendar_probe_insert_blocked_at is null
    and c.calendar_create_verified_at is null and c.calendar_probe_insert_verified_at is not null
    and c.setup_completed_at is not null and c.pipedream_account_id='apn_current',
    'a successful same-configuration private INSERT retry restores readiness without booking evidence or direct reset');
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_current','destination',c.connection_revision,
    next_lease,desired,pg_catalog.clock_timestamp());
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,'insert');
  select date_trunc('milliseconds',setup_probe_started_at) into observed_at from public.calendar_connections where id=c.id;
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,
    false,false,'permissions','pending','insert',observed_at);
  perform pg_temp.assert_true((select calendar_probe_insert_blocked_at>=setup_probe_started_at from public.calendar_connections where id=c.id),
    'millisecond provider evidence cannot fail or order before its microsecond SQL dispatch');
  update public.calendar_connections set setup_retry_at=pg_catalog.clock_timestamp() where id=c.id;
  probe:=public.claim_google_calendar_setup_probe('test',next_lease,'{}',profile_id);
  perform pg_temp.prove_setup(probe,next_lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint);
  perform pg_temp.assert_true(c.calendar_probe_insert_blocked_at is null and c.calendar_create_blocked_at is null
    and c.calendar_write_blocked_at is null and c.health_state='healthy',
    'millisecond denial recovers through the same private capability, without resetting blockers');
  perform public.mark_google_calendar_connection_verified(b.id,lease,(claim->'binding'->>'reconciliation_fencing_token')::bigint,
    pg_catalog.clock_timestamp(),'[{"id":"busy-b","accessRole":"reader"},{"id":"destination","accessRole":"owner"}]');

  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_current','destination',c.connection_revision,
    next_lease,desired,pg_catalog.clock_timestamp());
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,'insert');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,true,true,null,'present');
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,'delete');
  observed_at:=pg_catalog.clock_timestamp();
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,
    false,false,'permissions',null,'delete',observed_at);
  perform pg_temp.assert_true((select calendar_delete_blocked_at=observed_at and calendar_create_blocked_at is null
    and verification_reason='calendar_write_blocked' from public.calendar_connections where id=c.id),'DELETE denial blocks only its own capability');
  update public.calendar_connections set setup_retry_at=pg_catalog.clock_timestamp() where id=c.id;
  probe:=public.claim_google_calendar_setup_probe('test',next_lease,'{}',profile_id);
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,true,true,null,'present');
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,'delete');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,true,true,null,'absent');
  c:=public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint);

  perform pg_temp.assert_true(c.calendar_delete_blocked_at is null and c.verification_reason is null,
    'the same private probe successful DELETE retry clears the earlier DELETE denial by its own dispatch time');
  -- OAuth can restore reads before the old disconnected projection is refreshed.
  -- A new scoped write denial must survive that later successful read settlement.
  perform public.mark_google_calendar_connection_unhealthy(b.id,lease,(claim->'binding'->>'reconciliation_fencing_token')::bigint,
    true,'provider_reauthorization_required');
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_current','destination',c.connection_revision,
    next_lease,desired,pg_catalog.clock_timestamp());
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,'insert');
  observed_at:=pg_catalog.clock_timestamp();
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,
    false,false,'permissions','pending','insert',observed_at);
  perform pg_temp.assert_true((select calendar_probe_insert_blocked_at=observed_at and calendar_create_blocked_at is null and health_state='disconnected'
    and reconnect_reason='provider_reauthorization_required' from public.calendar_connections where id=c.id),
    'setup denial retains its capability evidence without overriding outstanding authorization state');
  perform public.mark_google_calendar_connection_verified(b.id,lease,(claim->'binding'->>'reconciliation_fencing_token')::bigint,
    pg_catalog.clock_timestamp(),'[{"id":"busy-b","accessRole":"reader"},{"id":"destination","accessRole":"owner"}]');
  perform pg_temp.assert_true((select calendar_probe_insert_blocked_at=observed_at and health_state='degraded'
    and verification_reason='calendar_write_blocked' from public.calendar_connections where id=c.id),
    'post-OAuth successful reads cannot erase an intervening setup write denial');
  update public.calendar_connections set setup_retry_at=pg_catalog.clock_timestamp() where id=c.id;
  probe:=public.claim_google_calendar_setup_probe('test',next_lease,'{}',profile_id);
  perform pg_temp.prove_setup(probe,next_lease);
  c:=public.persist_google_calendar_configuration(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint);
  perform pg_temp.assert_true(c.calendar_probe_insert_blocked_at is null and c.calendar_create_blocked_at is null
    and c.calendar_write_blocked_at is null and c.health_state='healthy' and c.reconnect_reason is null,
    'reauthorized private INSERT recovery consumes its successful probe, not direct field resets');
  -- Read/validation errors do not gain write-failure authority, even if a prior
  -- effect on this operation exists. SQL also refuses browser/helper shortcuts.
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_current','destination',c.connection_revision,
    next_lease,desired,pg_catalog.clock_timestamp());
  failed:=false;
  begin perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,
    false,false,'permissions',null,'insert',pg_catalog.clock_timestamp());
  exception when invalid_parameter_value then failed:=true;end;
  perform pg_temp.assert_true(failed,'an undispatched read failure cannot fabricate a write blocker');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,
    false,false,'configuration');
  perform pg_temp.assert_true(not has_function_privilege('service_role',
    'public.record_booking_calendar_setup_denial(uuid,text,uuid,uuid,bigint,text,timestamptz)','execute'),
    'capability denial helper is private to the fenced SQL transition');

  -- Disconnect A while setup B owns a private event: cleanup must retain its
  -- own lease through present readback, then complete only after B is absent.
  perform public.fail_pipedream_binding_reconciliation(b.id,lease,(claim->'binding'->>'reconciliation_fencing_token')::bigint,'provider_temporary_failure');
  next_probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_other','destination',c.connection_revision,
    lease,desired,pg_catalog.clock_timestamp(),p_expected_setup_key=>probe->>'configuration_key');
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(next_probe->>'id')::uuid,lease,(next_probe->>'fencing_token')::bigint,'insert');
  disconnect_id:=public.reserve_booking_provider_account_disconnect_v3(profile_id,'test','apn_current',owner_id,c.connection_revision);
  probe:=public.claim_google_calendar_setup_probe('test',next_lease,'{}',profile_id);
  perform pg_temp.assert_true(probe->>'cleanup_only'='true','disconnect fences B configuration but retains its exact cleanup');
  probe:=public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,true,false,null,'present');
  perform pg_temp.assert_true((select setup_lease_token=next_lease and setup_retry_at is not null and setup_completed_at is null
    from public.calendar_connections where id=c.id),'stale revision present readback preserves cleanup lease and due continuation');
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,'delete');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,
    false,false,'permissions',null,'delete',pg_catalog.clock_timestamp());
  perform pg_temp.assert_true((select health_state='disconnected' and verification_reason='contractor_disconnected'
    and setup_retry_at is not null from public.calendar_connections where id=c.id),'superseded B cleanup denial cannot mutate disconnected A health and remains due');
  update public.calendar_connections set setup_retry_at=pg_catalog.clock_timestamp() where id=c.id;
  probe:=public.claim_google_calendar_setup_probe('test',next_lease,'{}',profile_id);
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,true,false,null,'present');
  perform public.authorize_google_calendar_setup_effect(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,'delete');
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,true,false,null,'absent');
  perform pg_temp.assert_true((select setup_completed_at is not null and setup_retry_at is null and setup_lease_token is null
    from public.calendar_connections where id=c.id),'only absence ends obsolete setup cleanup');
  raise notice 'google setup regressions: pending edit fences, scoped denial, notice linkage, and stale-revision cleanup passed';
end $setup_regressions$;

do $pending_reader_and_connect$
#variable_conflict use_variable
declare
  owner_id uuid:=pg_catalog.gen_random_uuid();profile_id uuid:=pg_catalog.gen_random_uuid();website_id uuid:=pg_catalog.gen_random_uuid();
  lease uuid:=pg_catalog.gen_random_uuid();next_lease uuid:=pg_catalog.gen_random_uuid();connect_id uuid:=pg_catalog.gen_random_uuid();
  c public.calendar_connections;probe jsonb;view jsonb;key_a text;key_b text;failed boolean;proc regprocedure;
  desired jsonb:='[{"id":"busy-a","displayName":"Busy","accessRole":"reader","blocksAvailability":true,"receivesBookings":false},
    {"id":"destination-a","displayName":"Destination","accessRole":"writer","blocksAvailability":false,"receivesBookings":true}]';
  changed jsonb:='[{"id":"busy-b","displayName":"Busy","accessRole":"reader","blocksAvailability":true,"receivesBookings":false},
    {"id":"destination-b","displayName":"Destination","accessRole":"writer","blocksAvailability":false,"receivesBookings":true}]';
begin
  proc:='public.get_pending_google_calendar_setup(uuid,text,bigint)'::regprocedure;
  perform pg_temp.assert_true((select prosecdef and provolatile='s' and proconfig=array['search_path=""'] from pg_proc where oid=proc),
    'pending setup RPC is a stable definer read with empty search_path');
  perform pg_temp.assert_true(has_function_privilege('service_role',proc,'execute')
    and not has_function_privilege('anon',proc,'execute') and not has_function_privilege('authenticated',proc,'execute')
    and not has_function_privilege('booking_worker',proc,'execute'),'pending setup RPC is service-only');
  perform pg_temp.assert_true(not has_table_privilege('service_role','public.booking_provider_account_disconnects_v3','select'),
    'pending setup read does not grant raw ledger access');
  insert into auth.users(id,email)values(owner_id,'pending-authority@example.test');
  insert into public.profiles(id,auth_user_id,license_number,email,environment)
    values(profile_id,owner_id,'PENDING-AUTHORITY','pending-authority@example.test','test');
  insert into public.websites(id,user_id,status,environment)values(website_id,profile_id,'draft','test');
  insert into public.website_entitlements(profile_id,website_id,environment,plan,state,effective_at,order_confirmed_at)
    values(profile_id,website_id,'test','pro','active',pg_catalog.clock_timestamp()-interval '1 day',pg_catalog.clock_timestamp());
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_pending_read','destination-a',0,lease,desired,pg_catalog.clock_timestamp());
  select * into c from public.calendar_connections x where x.profile_id=profile_id;
  key_a:=probe->>'configuration_key';
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,lease,(probe->>'fencing_token')::bigint,false,false,'permissions');
  set local role service_role;
  view:=public.get_pending_google_calendar_setup(profile_id,'test',c.connection_revision);
  failed:=false;
  begin perform 1 from public.booking_provider_account_disconnects_v3;exception when insufficient_privilege then failed:=true;end;
  reset role;
  perform pg_temp.assert_true(failed,'actual service SELECT still raises 42501');
  perform pg_temp.assert_true(view->>'configurationKey'=key_a and view->>'accountId'='apn_pending_read'
    and view->'blockingCalendarIds'='["busy-a"]'::jsonb and view->>'destinationCalendarId'='destination-a'
    and view->>'reason'='permissions' and (select count(*)from jsonb_object_keys(view))=8,
    'scoped read returns only the existing DTO with the same authoritative key');
  perform pg_temp.assert_true(public.get_pending_google_calendar_setup(profile_id,'live',0) is null,
    'pending read cannot cross environment');
  failed:=false;
  begin perform public.get_pending_google_calendar_setup(profile_id,'test',c.connection_revision+1);exception when serialization_failure then failed:=true;end;
  perform pg_temp.assert_true(failed,'revision mismatch is unknown/error, not no pending setup');
  perform public.authorize_google_calendar_connect_start(profile_id,'test',owner_id,connect_id);
  failed:=false;
  begin perform public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_pending_read','destination-b',c.connection_revision,
    next_lease,changed,pg_catalog.clock_timestamp(),p_connect_operation_id=>connect_id,p_expected_setup_key=>key_a);
  exception when serialization_failure then failed:=true;end;
  perform pg_temp.assert_true(failed,'OAuth completion cannot use a valid key to replace its captured choices');
  failed:=false;
  begin perform public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_other_pending','destination-a',c.connection_revision,
    next_lease,desired,pg_catalog.clock_timestamp(),p_connect_operation_id=>connect_id,p_expected_setup_key=>key_a);
  exception when serialization_failure then failed:=true;end;
  perform pg_temp.assert_true(failed,'OAuth completion cannot move captured choices to another account');
  -- A real explicit selection save can replace pending choices, fencing the old OAuth callback.
  probe:=public.reserve_google_calendar_setup_probe(profile_id,'test',owner_id,'apn_pending_read','destination-b',c.connection_revision,
    next_lease,changed,pg_catalog.clock_timestamp(),p_expected_setup_key=>key_a);
  key_b:=probe->>'configuration_key';
  perform public.settle_google_calendar_setup_probe(profile_id,'test',(probe->>'id')::uuid,next_lease,(probe->>'fencing_token')::bigint,false,false,'temporary');
  perform pg_temp.assert_true(public.get_pending_google_calendar_setup(profile_id,'test',c.connection_revision)->>'configurationKey'=key_b and key_b<>key_a,
    'same-revision current choices have one shared key for DTO and SQL saves');
  failed:=false;
  begin perform public.authorize_google_calendar_connect_completion(profile_id,'test',owner_id,connect_id);exception when serialization_failure then failed:=true;end;
  perform pg_temp.assert_true(failed,'older Connect callback cannot overwrite a newer same-revision pending choice');
  update public.calendar_connections set setup_probe_account_id='apn_superseded',setup_failure_reason='permissions' where id=c.id;
  perform pg_temp.assert_true(public.get_pending_google_calendar_setup(profile_id,'test',c.connection_revision)->>'reason' is null,
    'superseded probe failure is not attributed to the new pending configuration');
  update public.calendar_connections set setup_actor_auth_user_id=pg_catalog.gen_random_uuid() where id=c.id;
  perform pg_temp.assert_true(public.get_pending_google_calendar_setup(profile_id,'test',c.connection_revision) is null,
    'setup intent of a former owner is not current');
  update public.calendar_connections set setup_actor_auth_user_id=owner_id,setup_probe_account_id=setup_account_id where id=c.id;
  perform public.reserve_booking_provider_account_disconnect_v3(profile_id,'test','apn_pending_read',owner_id,c.connection_revision);
  select * into c from public.calendar_connections x where x.id=c.id;
  perform pg_temp.assert_true(public.get_pending_google_calendar_setup(profile_id,'test',c.connection_revision) is null,
    'explicit disconnect suppresses the exact pending account');
  raise notice 'pending setup read and captured Connect intent: real service ACL, DTO, scope, key and supersession passed';
end $pending_reader_and_connect$;

do $receipt$
#variable_conflict use_variable
declare
  profile_id uuid:=pg_catalog.gen_random_uuid();foreign_profile uuid:=pg_catalog.gen_random_uuid();
  lease uuid:=pg_catalog.gen_random_uuid();next_lease uuid:=pg_catalog.gen_random_uuid();foreign_lease uuid:=pg_catalog.gen_random_uuid();
  c public.calendar_connections;b public.pipedream_bindings;other_c public.calendar_connections;other_b public.pipedream_bindings;
  claim jsonb;receipt jsonb;foreign_receipt jsonb;takeover_snapshot jsonb;operation_id uuid;original_fence bigint;fence bigint;
  failed boolean;component_id text;proc regprocedure;
  evidence jsonb:='[{"id":"receipt-calendar","accessRole":"owner"}]';
begin
  proc:='public.adopt_pipedream_trigger_candidate(uuid,uuid,bigint,text,uuid,text)'::regprocedure;
  perform pg_temp.assert_true((select pronargs=6 and pronargdefaults=1 from pg_catalog.pg_proc where oid=proc),
    'sixth component argument is optional; inventory adoption does not imply a response receipt');
  perform pg_temp.assert_true(to_regprocedure('public.adopt_pipedream_trigger_candidate(uuid,uuid,bigint,text,uuid)') is null,
    'no legacy unfenced adoption overload remains');
  perform pg_temp.assert_true(has_function_privilege('service_role',proc,'execute')
    and not has_function_privilege('anon',proc,'execute')
    and not has_function_privilege('authenticated',proc,'execute')
    and not has_function_privilege('booking_worker',proc,'execute'),
    'receipt capture remains service-only, not a browser or booking-worker capability');
  perform pg_temp.assert_true(not exists(select 1 from pg_catalog.pg_proc p,
    lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)))a
    where p.oid=proc and a.grantee=0 and a.privilege_type='EXECUTE'),
    'PUBLIC cannot execute receipt capture');

  insert into public.profiles(id,license_number,email,environment) values
    (profile_id,'GC-RECEIPT-A','receipt-a@example.test','test'),
    (foreign_profile,'GC-RECEIPT-B','receipt-b@example.test','test');
  insert into public.calendar_connections(profile_id,environment,external_user_id,pipedream_account_id,health_state)
    values(profile_id,'test','obra:test:'||profile_id::text,'apn_receiptA','healthy') returning * into c;
  insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,access_role,blocks_availability,receives_bookings)
    values(c.id,profile_id,'test','receipt-calendar','Receipt calendar','owner',true,true);
  insert into public.calendar_connections(profile_id,environment,external_user_id,pipedream_account_id,health_state)
    values(foreign_profile,'test','obra:test:'||foreign_profile::text,'apn_receiptB','healthy') returning * into other_c;
  insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,access_role,blocks_availability,receives_bookings)
    values(other_c.id,foreign_profile,'test','receipt-calendar','Receipt calendar','owner',true,true);

  claim:=public.claim_saved_google_calendar_verification(foreign_profile,'test',foreign_lease,90,true);
  select * into other_b from public.pipedream_bindings where id=(claim->'binding'->>'id')::uuid;
  perform public.mark_google_calendar_connection_verified(other_b.id,foreign_lease,other_b.reconciliation_fencing_token,pg_catalog.clock_timestamp(),evidence);
  other_b:=public.reserve_pipedream_trigger_deployment(foreign_profile,'test',other_c.id,'apn_receiptB',other_c.connection_revision,
    other_b.id,foreign_lease,other_b.reconciliation_fencing_token,'1.2.3');
  perform public.begin_pipedream_trigger_deployment_effect(other_b.id,foreign_lease,other_b.reconciliation_fencing_token,other_b.deployment_operation_id);
  perform public.adopt_pipedream_trigger_candidate(other_b.id,foreign_lease,other_b.reconciliation_fencing_token,
    'dc_foreignReceipt',other_b.deployment_operation_id,'sc_foreignReceipt');
  select deployment_receipt into foreign_receipt from public.pipedream_bindings where id=other_b.id;

  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,90,true);
  select * into b from public.pipedream_bindings where id=(claim->'binding'->>'id')::uuid;
  fence:=b.reconciliation_fencing_token;original_fence:=fence;
  perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);
  b:=public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,'apn_receiptA',c.connection_revision,b.id,lease,fence,'1.2.3');
  operation_id:=b.deployment_operation_id;
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptA',operation_id,'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed and (select deployment_receipt is null and deployment_candidate_trigger_id is null
    from public.pipedream_bindings where id=b.id),'an undispatched reservation cannot mint successful response evidence');

  perform public.begin_pipedream_trigger_deployment_effect(b.id,lease,fence,operation_id);
  failed:=false;
  begin perform public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,'apn_receiptA',c.connection_revision,b.id,lease,fence,'9.9.9');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed and (select component_version='1.2.3' and component_key='google_calendar-new-or-updated-event-instant'
    and pipedream_account_id='apn_receiptA' and selected_calendar_ids='["receipt-calendar"]'::jsonb and deployment_operation_id=operation_id
    from public.pipedream_bindings where id=b.id),'receipt pin/account/calendar body is frozen on its dispatched operation');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,next_lease,fence,'dc_receiptA',operation_id,'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'different lease cannot capture a deployment receipt');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence-1,'dc_receiptA',operation_id,'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'old fencing token cannot capture a deployment receipt');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptA',pg_catalog.gen_random_uuid(),'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'another operation cannot borrow the active dispatch');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(other_b.id,lease,fence,'dc_receiptA',other_b.deployment_operation_id,'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed and (select deployment_receipt=foreign_receipt from public.pipedream_bindings where id=other_b.id),
    'foreign binding receipt cannot be overwritten with this claim');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_foreignReceipt',operation_id,'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'a current dispatch cannot claim another binding resource');

  set local role service_role;
  perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptA',operation_id,'sc_receiptA');
  reset role;
  receipt:=jsonb_build_object('trigger_id','dc_receiptA','component_id','sc_receiptA',
    'component_key','google_calendar-new-or-updated-event-instant','component_version','1.2.3','operation_id',operation_id);
  perform pg_temp.assert_true((select deployment_receipt=receipt from public.pipedream_bindings where id=b.id),
    'successful response receipt contains exact returned identities and the server-owned frozen pin');
  perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptA',operation_id,'sc_receiptA');
  perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptA',operation_id);
  foreach component_id in array array['sc_otherReceipt','',repeat('x',257)] loop
    failed:=false;
    begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptA',operation_id,component_id);
    exception when serialization_failure then failed:=true; end;
    perform pg_temp.assert_true(failed,'inconsistent or invalid component cannot overwrite the successful response receipt');
  end loop;
  perform pg_temp.assert_true((select deployment_receipt=receipt from public.pipedream_bindings where id=b.id),
    'exact acknowledgement replay and metadata-free adoption preserve the original receipt');

  -- Treat the preceding acknowledgement as lost. The next claimant gets a newly
  -- deserialized receipt, but may not claim it saw the previous worker response.
  update public.pipedream_bindings set reconciliation_lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second',
    deployment_lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',next_lease,90,true);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  perform pg_temp.assert_true(claim->'binding'->'deployment_receipt'=receipt,'claim takeover reads the committed response receipt');
  select to_jsonb(x) into takeover_snapshot from public.pipedream_bindings x where x.id=b.id;
  set local role service_role;
  perform public.adopt_pipedream_trigger_candidate(b.id,lease,original_fence,'dc_receiptA',operation_id,'sc_receiptA');
  reset role;
  perform pg_temp.assert_true((select to_jsonb(x)=takeover_snapshot from public.pipedream_bindings x where x.id=b.id),
    'original dispatch acknowledgement retains identical receipt without changing takeover lease, configuration or health');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,original_fence,'dc_changedReceipt',operation_id,'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'original dispatch owner cannot replace the returned resource after takeover');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,original_fence,'dc_receiptA',operation_id,'sc_changedReceipt');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'original dispatch owner cannot replace component evidence after takeover');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,original_fence,'dc_receiptA',pg_catalog.gen_random_uuid(),'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'original receipt cannot authorize another operation after takeover');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,original_fence,'dc_receiptA',operation_id);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'metadata-free inventory adoption still requires the current claim');
  failed:=false;
  begin perform public.begin_pipedream_trigger_deployment_effect(b.id,lease,original_fence,operation_id);
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'retaining an old response does not authorize another deployment');
  failed:=false;
  begin perform public.authorize_pipedream_trigger_cleanup(b.id,lease,original_fence,'dc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'retaining an old response does not authorize provider deletion');
  failed:=false;
  begin perform public.apply_pipedream_trigger_projection(b.id,b.webhook_correlation_id,profile_id,'test',c.id,'apn_receiptA',
    b.component_key,'1.2.3','["receipt-calendar"]','dc_receiptA','wh_receiptA','fixture-receipt-key',true,
    pg_catalog.clock_timestamp(),null,lease,original_fence,operation_id,c.connection_revision,b.component_key,'1.2.3');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'old dispatch acknowledgement cannot project current monitoring healthy');
  perform pg_temp.assert_true((select to_jsonb(x)=takeover_snapshot from public.pipedream_bindings x where x.id=b.id),
    'rejected stale mutations preserve the complete current binding');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,next_lease,fence,'dc_receiptA',operation_id,'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'new claimant cannot mint a receipt for the original dispatch, even with identical IDs');
  perform public.adopt_pipedream_trigger_candidate(b.id,next_lease,fence,'dc_receiptA',operation_id);
  perform public.mark_google_calendar_connection_verified(b.id,next_lease,fence,pg_catalog.clock_timestamp(),evidence);
  select * into b from public.pipedream_bindings where id=b.id;
  perform public.apply_pipedream_trigger_projection(b.id,b.webhook_correlation_id,profile_id,'test',c.id,'apn_receiptA',
    b.component_key,'1.2.3','["receipt-calendar"]','dc_receiptA','wh_receiptA','fixture-receipt-key',true,
    pg_catalog.clock_timestamp(),null,next_lease,fence,operation_id,c.connection_revision,b.component_key,'1.2.3');
  select * into b from public.pipedream_bindings where id=b.id;
  perform pg_temp.assert_true(b.deployment_receipt=receipt and b.deployment_operation_id is null and b.deployment_dispatched_at is null
    and b.trigger_state='active','receipt survives successful projection and cleared transient deployment fields');

  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,90,false);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  perform pg_temp.assert_true(claim->'binding'->'deployment_receipt'=receipt,'read-only reload retains receipt after projection acknowledgement loss');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptA',null,'sc_receiptA');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'read-only verification cannot manufacture proof');
  perform public.fail_pipedream_binding_reconciliation(b.id,lease,fence,'provider_temporary_failure');
  update public.pipedream_bindings set reconciliation_due_at=pg_catalog.clock_timestamp()-interval '1 second' where id=b.id;
  claim:=public.claim_saved_google_calendar_verification(profile_id,'test',lease,90,true);
  fence:=(claim->'binding'->>'reconciliation_fencing_token')::bigint;
  b:=public.retire_pipedream_trigger(b.id,lease,fence,'dc_receiptA');
  perform pg_temp.assert_true(b.deployment_receipt is null and 'dc_receiptA'=any(b.pending_trigger_deletions),
    'retirement clears exactly the retired resource receipt before deletion');
  perform public.complete_pipedream_stale_trigger_cleanup(b.id,lease,fence,'dc_receiptA');
  perform public.mark_google_calendar_connection_verified(b.id,lease,fence,pg_catalog.clock_timestamp(),evidence);
  b:=public.reserve_pipedream_trigger_deployment(profile_id,'test',c.id,'apn_receiptA',c.connection_revision,b.id,lease,fence,'1.2.3');
  operation_id:=b.deployment_operation_id;
  perform public.begin_pipedream_trigger_deployment_effect(b.id,lease,fence,operation_id);
  perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptReplacement',operation_id,'sc_receiptReplacement');
  update public.calendar_connections set connection_revision=connection_revision+1 where id=c.id;
  perform pg_temp.assert_true((select deployment_receipt is null and 'dc_receiptReplacement'=any(pending_trigger_deletions)
    from public.pipedream_bindings where id=b.id),'material reconfiguration clears the old receipt and retains resource cleanup');
  failed:=false;
  begin perform public.adopt_pipedream_trigger_candidate(b.id,lease,fence,'dc_receiptReplacement',operation_id,'sc_receiptReplacement');
  exception when serialization_failure then failed:=true; end;
  perform pg_temp.assert_true(failed,'superseded response cannot reinstate a material configuration receipt');
end $receipt$;
\echo 'google-calendar-lifetime: deployment receipt dispatch/fence, frozen pin, takeover, projection, retirement, reconfiguration and grants passed'

rollback;
