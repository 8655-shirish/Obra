\set ON_ERROR_STOP on
\echo 'bucket1-regeneration-lifecycle-audit: deterministic regressions'
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
create or replace function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'assertion failed: %',message; end if; end $$;
-- The runtime suite owns this transactional capability fixture.
delete from public.background_job_runner_capabilities;
insert into public.profiles(id,license_number,email) values
  ('f1000000-0000-0000-0000-000000000001','LIFECYCLE-AUDIT','lifecycle-audit@example.invalid');
insert into public.websites(id,user_id,status) values
  ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','draft');
insert into public.website_versions(id,website_id,version_number,config_json,variant_key,status,revision) values
  ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',1,
   '{"generator":"unified-site-agent","generatorSchemaVersion":4,"mediaManifest":{"slots":[]}}','audit-source','selected',0);

-- Admission fails closed without a fresh job-runner heartbeat. Any capability
-- heartbeat (including capability 1 or browser_ready=false) permits insertion.
do $$ declare caught_state text; caught_message text; begin
  begin
    insert into public.background_jobs(id,website_id,chain_id,job_type,sequence_index,status,payload_json,
      generation_contract_epoch,generation_contract_version)
    values('fa000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
      'fb000000-0000-0000-0000-000000000001','add_video',0,'pending','{}',2,2);
    raise exception 'assertion failed: no-capability admission succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics caught_state=returned_sqlstate,caught_message=message_text;
    if caught_state<>'55000' or caught_message not like 'Epoch-2 generation admission rejected:%' then
      raise exception 'assertion failed: admission error was not actionable: % %',caught_state,caught_message;
    end if;
  end;
end $$;
select public.heartbeat_background_job_runner_capability('epoch1-runner',1,true);
insert into public.background_jobs(id,website_id,chain_id,job_type,sequence_index,status,payload_json,
  generation_contract_epoch,generation_contract_version)
values('fa000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001',
  'fb000000-0000-0000-0000-000000000002','add_video',0,'pending','{}',2,2);
select pg_temp.assert_true(exists(select 1 from public.background_jobs
  where id='fa000000-0000-0000-0000-000000000002'),
  'capability-1 heartbeat did not permit epoch-2 admission');
select public.heartbeat_background_job_runner_capability('browser-false-runner',2,false);
insert into public.background_jobs(id,website_id,chain_id,job_type,sequence_index,status,payload_json,
  generation_contract_epoch,generation_contract_version)
values('fa000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000001',
  'fb000000-0000-0000-0000-000000000003','add_video',0,'pending','{}',2,2);
select pg_temp.assert_true(exists(select 1 from public.background_jobs
  where id='fa000000-0000-0000-0000-000000000003'),
  'browser-false heartbeat did not permit epoch-2 admission');
select public.heartbeat_background_job_runner_capability('lifecycle-audit-test-runner',2,true);
insert into public.background_jobs(id,website_id,chain_id,job_type,sequence_index,status,payload_json,
  request_id,source_version_id,target_version_id,generation_contract_epoch,generation_contract_version)
values('fa000000-0000-0000-0000-000000000004','f2000000-0000-0000-0000-000000000001',
  'fb000000-0000-0000-0000-000000000004','add_video',0,'cancelled','{}',
  'fc000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',2,2);
select pg_temp.assert_true(exists(select 1 from public.background_jobs
  where id='fa000000-0000-0000-0000-000000000004'),
  'fresh job-runner heartbeat did not permit epoch-2 admission');

-- Claim is claim-only: an unsupported pending Add Video poison row remains byte-for-byte unchanged
-- while an unrelated enrichment bystander progresses.
insert into public.background_jobs(
  id,website_id,chain_id,job_type,sequence_index,status,payload_json,request_id,
  source_version_id,target_version_id,generation_contract_epoch,generation_contract_version,created_at
) values(
  'f4000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000001','add_video',0,'pending',
  '{"schemaVersion":1,"kind":"add-video-request","addVideoStage":"planning/call"}',
  'f6000000-0000-0000-0000-000000000001','f3000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',2,null,clock_timestamp()
),(
  'f4000000-0000-0000-0000-000000000002','f2000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000002','enrichment_platform',0,'pending','{}',
  null,null,null,1,null,clock_timestamp()
);
create temporary table poison_before as select to_jsonb(job) value
  from public.background_jobs job where id='f4000000-0000-0000-0000-000000000001';
create temporary table claimed_bystander as select * from public.claim_next_background_job(
  'lifecycle-claim',clock_timestamp()-interval '1 hour',2,'f7000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(
  (select id='f4000000-0000-0000-0000-000000000002' from claimed_bystander),
  'claim-only dispatcher did not progress the unrelated bystander');
select pg_temp.assert_true(
  (select to_jsonb(job)=(select value from poison_before) from public.background_jobs job
    where id='f4000000-0000-0000-0000-000000000001'),
  'claim-only dispatcher mutated maintenance poison');

-- The total setter materializes missing/scalar stageFailures and preserves the rest of the payload.
select pg_temp.assert_true(
  public.add_video_set_stage_failure('{"keep":true}'::jsonb,'planning/call',2)
    ='{"keep":true,"stageFailures":{"planning/call":2}}'::jsonb,
  'total stageFailures setter did not materialize an absent object');
select pg_temp.assert_true(
  public.add_video_set_stage_failure('{"stageFailures":"bad"}'::jsonb,'media/create',1)
    ='{"stageFailures":{"media/create":1}}'::jsonb,
  'total stageFailures setter did not replace a scalar object');

-- One parent-first closure handles ready artifacts, unresolved reservations, explicitly retired
-- definite failures, effect-free children, and already-reconciling children.
insert into public.site_generation_media_slots(
  id,job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,status,
  effect_certainty,asset_id,storage_path,mime_type,content_hash,provider_reservation_id,
  provider_operation_id,retired_provider_operation_ids,reconciliation_required_at,reconciliation_deadline,
  slot_locked_by,slot_lease_expires_at
) values
('f8000000-0000-0000-0000-000000000001','f4000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
 'ready-artifact','image','support','generated',true,false,'ready','definite_success','ready-hash','site-media/ready.webp','image/webp','ready-hash',null,null,'[]',null,null,'slot-owner',clock_timestamp()+interval '1 minute'),
('f8000000-0000-0000-0000-000000000002','f4000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
 'reserved-unknown','image','support','generated',true,false,'generating','not_started',null,null,null,null,
 'f9000000-0000-0000-0000-000000000002',null,'[]',null,null,'slot-owner',clock_timestamp()+interval '1 minute'),
('f8000000-0000-0000-0000-000000000003','f4000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
 'reserved-retired','image','support','generated',true,false,'failed','definite_failure',null,null,null,null,
 'f9000000-0000-0000-0000-000000000003','retired-operation','["retired-operation"]',null,null,'slot-owner',clock_timestamp()+interval '1 minute'),
('f8000000-0000-0000-0000-000000000004','f4000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
 'effect-free','image','support','generated',true,false,'planned','none',null,null,null,null,null,null,'[]',null,null,'slot-owner',clock_timestamp()+interval '1 minute'),
('f8000000-0000-0000-0000-000000000005','f4000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
 'existing-reconciliation','image','support','generated',true,false,'reconciliation_required','indeterminate',null,null,null,null,
 'f9000000-0000-0000-0000-000000000005',null,'[]',clock_timestamp(),clock_timestamp()+interval '1 hour','slot-owner',clock_timestamp()+interval '1 minute');

create temporary table maintenance_result as select * from public.maintain_background_job_lifecycle(
  clock_timestamp()-interval '1 hour','f7000000-0000-4000-8000-000000000002',100);
select pg_temp.assert_true((select status='failed' and error_message='add_video_contract_unsupported'
  from public.background_jobs where id='f4000000-0000-0000-0000-000000000001'),
  'maintenance did not terminalize NULL/unsupported Add Video contract');
select pg_temp.assert_true((select status='abandoned' and cleanup_required and slot_locked_by is null
  and slot_lease_expires_at is null from public.site_generation_media_slots
  where id='f8000000-0000-0000-0000-000000000001'),
  'ready durable artifact did not become abandoned cleanup_required');
select pg_temp.assert_true((select status='reconciliation_required' and effect_certainty='indeterminate'
  and slot_locked_by is null and slot_lease_expires_at is null from public.site_generation_media_slots
  where id='f8000000-0000-0000-0000-000000000002'),
  'non-ready reservation did not become reconciliation_required');
select pg_temp.assert_true((select status='abandoned' from public.site_generation_media_slots
  where id='f8000000-0000-0000-0000-000000000003'),
  'explicitly retired definite failure did not become abandoned');
select pg_temp.assert_true((select status='abandoned' from public.site_generation_media_slots
  where id='f8000000-0000-0000-0000-000000000004'),
  'effect-free child did not become abandoned');
select pg_temp.assert_true((select status='reconciliation_required' from public.site_generation_media_slots
  where id='f8000000-0000-0000-0000-000000000005'),
  'existing reconciliation row was not preserved');
select pg_temp.assert_true((select (details->>'childReconciliationCount')::integer=2
  from public.site_generation_attempt_events
  where event_key='f4000000-0000-0000-0000-000000000001:0:add-video-terminal'),
  'terminal event did not count all existing reconciliation rows');
select pg_temp.assert_true((select count(*)=1 from public.site_generation_attempt_events
  where event_key='f4000000-0000-0000-0000-000000000001:0:add-video-terminal'),
  'terminal event was not idempotent');

-- A terminal callback may preserve durable evidence, but never an unattached ready artifact.
select pg_temp.assert_true(public.reconcile_generation_media_slot_epoch(
  'f4000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001',
  'reserved-unknown','f9000000-0000-0000-0000-000000000002','terminal-ready-callback',
  'ready','provider:test','late durable callback',
  jsonb_build_object('storagePath','site-media/late.webp','contentHash',repeat('a',64),'mimeType','image/webp')
)='abandoned','terminal ready callback did not return abandoned');
select pg_temp.assert_true((select status='abandoned' and cleanup_required
  and storage_path='site-media/late.webp' and content_hash=repeat('a',64)
  and reconciliation_evidence->>'storagePath'='site-media/late.webp'
  from public.site_generation_media_slots where id='f8000000-0000-0000-0000-000000000002'),
  'terminal callback left ready media or lost audit evidence');

-- Settlement uses the same total setter even when worker payload carries scalar stageFailures.
insert into public.background_jobs(
  id,website_id,chain_id,job_type,sequence_index,status,payload_json,request_id,
  source_version_id,target_version_id,generation_contract_epoch,generation_contract_version,
  attempts,claim_epoch,locked_by,locked_at,lease_expires_at,created_at
) values(
  'f4000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000003','add_video',0,'running',
  '{"generatorSchemaVersion":4,"addVideoStage":"media/create","stageFailures":"bad"}',
  'f6000000-0000-0000-0000-000000000003','f3000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',2,2,1,1,'settler',clock_timestamp(),
  clock_timestamp()+interval '1 minute',clock_timestamp()
);
select pg_temp.assert_true(public.settle_add_video_job_epoch(
  'f4000000-0000-0000-0000-000000000003','f2000000-0000-0000-0000-000000000001',
  1,1,'settler','failed',25,null,
  '{"generatorSchemaVersion":4,"addVideoStage":"media/create","stageFailures":"still-bad"}',
  'retry','Retrying',null),'settlement rejected a materializable stageFailures payload');
select pg_temp.assert_true((select jsonb_typeof(payload_json->'stageFailures')='object'
  and payload_json#>>'{stageFailures,media/create}'='1'
  from public.background_jobs where id='f4000000-0000-0000-0000-000000000003'),
  'settlement did not materialize and increment stageFailures');

-- The absolute eight-minute deadline terminalizes and rejects post-deadline yield.
insert into public.background_jobs(
  id,website_id,chain_id,job_type,sequence_index,status,payload_json,request_id,
  source_version_id,target_version_id,generation_contract_epoch,generation_contract_version,
  attempts,claim_epoch,locked_by,locked_at,lease_expires_at,created_at
) values(
  'f4000000-0000-0000-0000-000000000004','f2000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000004','add_video',0,'running',
  '{"generatorSchemaVersion":4,"addVideoStage":"planning/call","stageFailures":{}}',
  'f6000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',2,2,1,1,'deadline-runner',
  clock_timestamp()-interval '9 minutes',clock_timestamp()+interval '1 minute',clock_timestamp()-interval '9 minutes'
);
select pg_temp.assert_true(not public.yield_add_video_stage(
  'f4000000-0000-0000-0000-000000000004','f2000000-0000-0000-0000-000000000001',
  1,1,'deadline-runner','planning/call','planning/call','{}',clock_timestamp(),5,'yield'),
  'post-deadline yield was accepted');
select pg_temp.assert_true((select status='failed' and error_message='add_video_deadline_exceeded'
  and locked_by is null and lease_expires_at is null from public.background_jobs
  where id='f4000000-0000-0000-0000-000000000004'),
  'post-deadline yield did not terminalize and clear ownership');

-- Finite interruption budget terminalizes on its third interruption.
insert into public.background_jobs(
  id,website_id,chain_id,job_type,sequence_index,status,payload_json,request_id,
  source_version_id,target_version_id,generation_contract_epoch,generation_contract_version,
  attempts,claim_epoch,locked_by,locked_at,lease_expires_at,interruption_count,created_at
) values(
  'f4000000-0000-0000-0000-000000000005','f2000000-0000-0000-0000-000000000001',
  'f5000000-0000-0000-0000-000000000005','add_video',0,'running',
  '{"generatorSchemaVersion":4,"addVideoStage":"planning/call","stageFailures":{}}',
  'f6000000-0000-0000-0000-000000000005','f3000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',2,2,1,1,'interrupt-runner',clock_timestamp(),
  clock_timestamp()+interval '1 minute',2,clock_timestamp()
);
select pg_temp.assert_true(public.interrupt_add_video_job_epoch(
  'f4000000-0000-0000-0000-000000000005',1,1,'interrupt-runner','shutdown',clock_timestamp()),
  'third interruption did not settle');
select pg_temp.assert_true((select status='failed' and error_message='add_video_interruption_budget_exhausted'
  from public.background_jobs where id='f4000000-0000-0000-0000-000000000005'),
  'finite interruption budget did not terminalize');

select pg_temp.assert_true(has_function_privilege('service_role',
  'public.maintain_background_job_lifecycle(timestamptz,uuid,integer)','EXECUTE'),
  'service role lacks lifecycle maintenance execute');
select pg_temp.assert_true(not has_function_privilege('authenticated',
  'public.maintain_background_job_lifecycle(timestamptz,uuid,integer)','EXECUTE'),
  'authenticated role can execute lifecycle maintenance');
select pg_temp.assert_true(not has_function_privilege('service_role',
  'public.close_add_video_terminal_children(uuid,text,timestamptz)','EXECUTE'),
  'internal closure helper leaked to service role');

select pg_temp.assert_true(has_function_privilege('service_role',
  'public.heartbeat_background_job_runner_capability(text,integer,boolean)','EXECUTE'),
  'service role lacks worker capability heartbeat');
select pg_temp.assert_true(not has_function_privilege('authenticated',
  'public.heartbeat_background_job_runner_capability(text,integer,boolean)','EXECUTE'),
  'authenticated role can forge worker capability');
select pg_temp.assert_true(not has_table_privilege('service_role',
  'public.background_job_runner_capabilities','INSERT'),
  'service role can forge last_seen without heartbeat RPC');
select pg_temp.assert_true(has_function_privilege('service_role',
  'public.complete_generation_media_cleanup(text,text)','EXECUTE'),
  'service role lacks cleanup completion callback');
select pg_temp.assert_true(not has_function_privilege('authenticated',
  'public.complete_generation_media_cleanup(text,text)','EXECUTE'),
  'authenticated role can complete cleanup');

update public.background_job_runner_capabilities
set last_seen=clock_timestamp()-interval '3 minutes';

-- Already-admitted pending rows stay runnable after Chrome admission is gone. Maintenance
-- must not terminalize them with a missing-browser cause.
alter table public.background_jobs disable trigger background_jobs_epoch2_runner_admission;
insert into public.background_jobs(id,website_id,chain_id,job_type,sequence_index,status,payload_json,
  request_id,source_version_id,target_version_id,generation_contract_epoch,generation_contract_version,created_at)
values('fa000000-0000-0000-0000-000000000005','f2000000-0000-0000-0000-000000000001',
  'fb000000-0000-0000-0000-000000000005','add_video',0,'pending',
  '{"generatorSchemaVersion":4,"addVideoStage":"planning/call","stageFailures":{}}',
  'fc000000-0000-0000-0000-000000000005','f3000000-0000-0000-0000-000000000001',
  'f3000000-0000-0000-0000-000000000001',2,2,clock_timestamp()-interval '6 minutes');
alter table public.background_jobs enable trigger background_jobs_epoch2_runner_admission;
select * from public.maintain_background_job_lifecycle(clock_timestamp()-interval '1 hour',
  'fd000000-0000-4000-8000-000000000005',100);
select pg_temp.assert_true((select status='pending'
  and coalesce(error_message,'') is distinct from 'epoch2_runner_capability_unavailable'
  from public.background_jobs where id='fa000000-0000-0000-0000-000000000005'),
  'maintenance terminalized a still-runnable pending epoch-2 row');
select pg_temp.assert_true(not public.terminalize_unclaimable_epoch2_job(
  'fa000000-0000-0000-0000-000000000005','lifecycle-audit'),
  'retired Chrome unclaimable terminalize still mutated a job');

do $$
begin
  begin
    insert into public.background_jobs(
      website_id,chain_id,job_type,sequence_index,status,payload_json,
      generation_contract_epoch,generation_contract_version
    ) values(
      'f2000000-0000-0000-0000-000000000001',gen_random_uuid(),'site_generation',0,'pending','{}',2,2
    );
    raise exception 'assertion failed: stale capability admitted epoch-2 generation';
  exception when sqlstate '55000' then null; end;
end $$;

rollback;
\echo 'bucket1-regeneration-lifecycle-audit: all assertions passed'
