\set ON_ERROR_STOP on
\echo 'bucket1-generation: transactional behavior suite'

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Epoch-2 admission is fail-closed; this suite represents a live job-runner heartbeat.
select public.heartbeat_background_job_runner_capability('bucket1-db-suite',2,false);

create or replace function pg_temp.assert_true(ok boolean, message text)
returns void
language plpgsql
as $$
begin
  if ok is not true then
    raise exception 'assertion failed: %', message;
  end if;
end;
$$;


create or replace function pg_temp.assert_publish_rejected(
  p_website_id uuid,
  p_version_id uuid,
  p_expected_revision bigint,
  p_expected_config jsonb,
  p_expected_media jsonb,
  p_attestation jsonb,
  p_message text
) returns void
language plpgsql
as $$
declare
  original_status text;
  original_revision bigint;
begin
  select status,revision into strict original_status,original_revision
  from public.website_versions where id=p_version_id and website_id=p_website_id;
  begin
    perform public.publish_website_version_atomic(
      p_website_id,p_version_id,p_expected_revision,p_expected_config,p_expected_media,p_attestation
    );
    raise exception 'assertion failed: %', p_message;
  exception
    when others then
      if sqlerrm like 'assertion failed:%' then raise; end if;
  end;
  perform pg_temp.assert_true(
    (select status=original_status and revision=original_revision
     from public.website_versions where id=p_version_id and website_id=p_website_id),
    p_message || ' (publish was not atomic)'
  );
end;
$$;

create or replace function pg_temp.strict_checkpoint(
  p_job_id uuid,
  p_stage text,
  p_extra jsonb default '{}'::jsonb
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'schemaVersion', 2,
    'stage', p_stage,
    'acceptedAt', generation_accepted_at,
    'inputHash', generation_input_hash,
    'inputSizeBytes', octet_length(convert_to(generation_input_snapshot::text, 'UTF8')),
    'input', generation_input_snapshot
  ) || p_extra
  from public.background_jobs
  where id = p_job_id;
$$;

create or replace function pg_temp.insert_generation_fixture(
  p_website_id uuid,
  p_conversation_id uuid,
  p_request_id uuid,
  p_trace_id uuid,
  p_message_id uuid,
  p_chain_id uuid,
  p_job_id uuid,
  p_scenario text,
  p_stage text,
  p_status text,
  p_repair_attempts integer default 0,
  p_next_retry_at timestamptz default null
) returns void
language plpgsql
as $$
declare
  accepted_at timestamptz := clock_timestamp();
  frozen_input jsonb;
  frozen_hash text;
begin
  frozen_input := jsonb_build_object(
    'schemaVersion', 1,
    'normalizerVersion', 'bucket1-db-suite-v1',
    'generationKind', 'initial',
    'sourceVersionId', null,
    'sourceRevision', null,
    'sourceConfig', null,
    'sourceMedia', '[]'::jsonb,
    'onboarding', jsonb_build_object('scenario', p_scenario, 'contactHidden', true),
    'enrichment', '{}'::jsonb,
    'contactPolicy', jsonb_build_object(
      'schemaVersion', 1,
      'source', 'bucket1-generation.sql',
      'sourcePresent', true,
      'sourceValue', true,
      'contactHidden', true,
      'privacyClassification', 'generation-private',
      'privacySource', 'server-generation-storage-policy-v1',
      'capturedAtAcceptance', true
    ),
    'instruction', 'Build the deterministic ' || p_scenario || ' fixture.',
    'instructionByteLength', octet_length(
      convert_to('Build the deterministic ' || p_scenario || ' fixture.', 'UTF8')
    ),
    'requestPayloadHash', repeat('a', 64),
    'priorIdentities', '[]'::jsonb,
    'crossSiteLayoutIdentities', '[]'::jsonb
  );
  -- Deliberately mirror the strict epoch-2 database contract: hash jsonb::text bytes.
  frozen_hash := encode(
    extensions.digest(convert_to(frozen_input::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.agent_traces(
    id, website_id, profile_id, conversation_id, intent_type, trigger_message,
    status, request_id, request_payload_hash, owner_token, heartbeat_at, lease_expires_at
  ) values (
    p_trace_id, p_website_id, 'a1000000-0000-0000-0000-000000000001', p_conversation_id,
    'site_generation', 'Build the deterministic ' || p_scenario || ' fixture.',
    'running', p_request_id, repeat('a', 64), gen_random_uuid(),
    clock_timestamp(), clock_timestamp() + interval '10 minutes'
  );

  insert into public.messages(id, conversation_id, role, content, trace_id)
  values (p_message_id, p_conversation_id, 'assistant', 'Building your website…', p_trace_id);

  insert into public.background_jobs(
    id, website_id, chain_id, job_type, sequence_index, status, progress_pct,
    status_message, payload_json, idempotency_key, attempts, max_attempts,
    locked_at, locked_by, next_retry_at, request_id, generation_request_id,
    generation_request_hash, generation_tenant_id, generation_kind, generation_contract_epoch,
    generation_contract_version, generation_stage, generation_input_version,
    generation_input_snapshot, generation_input_hash, generation_accepted_at,
    generation_checkpoint, agent_trace_id, generation_handoff_message_id,
    claim_epoch, lease_expires_at, repair_attempts, created_at
  ) values (
    p_job_id, p_website_id, p_chain_id, 'site_generation', 0, p_status, 0,
    case when p_status = 'running' then 'Running fixture' else 'Queued fixture' end,
    jsonb_build_object(
      'generationKind', 'initial',
      'generationMode', 'unified',
      'generationStage', p_stage,
      'generationContractVersion', 2
    ),
    p_request_id::text,
    case when p_status = 'running' then 1 else 0 end,
    1,
    case when p_status = 'running' then clock_timestamp() else null end,
    case when p_status = 'running' then 'bucket1-db-suite' else null end,
    p_next_retry_at,
    p_request_id, p_request_id, repeat('a', 64),
    'a1000000-0000-0000-0000-000000000001', 'initial', 2, 2, p_stage, 1,
    frozen_input, frozen_hash, accepted_at,
    jsonb_build_object(
      'schemaVersion', 2,
      'stage', p_stage,
      'acceptedAt', accepted_at,
      'inputHash', frozen_hash,
      'inputSizeBytes', octet_length(convert_to(frozen_input::text, 'UTF8')),
      'input', frozen_input
    ),
    p_trace_id, p_message_id,
    case when p_status = 'running' then 1 else 0 end,
    case when p_status = 'running' then clock_timestamp() + interval '10 minutes' else null end,
    p_repair_attempts,
    case p_scenario
      when 'claim-yield-cancel' then '1900-01-01 00:00:00+00'::timestamptz
      when 'repair-budget' then '1900-01-01 00:00:01+00'::timestamptz
      else '1900-01-01 00:00:02+00'::timestamptz
    end
  );
end;
$$;

-- Self-contained profile / website / conversation fixtures. Trace, message, and job
-- fixtures are inserted by pg_temp.insert_generation_fixture above.
insert into public.profiles(id, license_number, email, environment)
values (
  'a1000000-0000-0000-0000-000000000001',
  'BUCKET1-GENERATION-DB-SUITE',
  'bucket1-generation@example.invalid',
  'test'
);

insert into public.websites(id, user_id, status, environment, onboarding_state)
values
  (
    'a2000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'draft',
    'test',
    '{"contactHidden":true,"scenario":"claim-yield-cancel"}'::jsonb
  ),
  (
    'a2000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000001',
    'draft',
    'test',
    '{"contactHidden":true,"scenario":"repair-budget"}'::jsonb
  ),
  (
    'a2000000-0000-0000-0000-000000000003',
    'a1000000-0000-0000-0000-000000000001',
    'draft',
    'test',
    '{"contactHidden":true,"scenario":"empty-manifest"}'::jsonb
  ),
  (
    'a2000000-0000-0000-0000-000000000004',
    'a1000000-0000-0000-0000-000000000001',
    'draft',
    'test',
    '{"contactHidden":true,"scenario":"supersession"}'::jsonb
  );

insert into public.conversations(id, user_id, website_id, phase)
values
  (
    'a3000000-0000-0000-0000-000000000001',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'generation'
  ),
  (
    'a3000000-0000-0000-0000-000000000002',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000002',
    'generation'
  ),
  (
    'a3000000-0000-0000-0000-000000000003',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000003',
    'generation'
  ),
  (
    'a3000000-0000-0000-0000-000000000004',
    'a1000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000004',
    'generation'
  );

select pg_temp.insert_generation_fixture(
  'a2000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000001',
  'a6000000-0000-0000-0000-000000000001',
  'a7000000-0000-0000-0000-000000000001',
  'a8000000-0000-0000-0000-000000000001',
  'claim-yield-cancel',
  'context',
  'pending',
  0,
  clock_timestamp() - interval '1 second'
);
select pg_temp.insert_generation_fixture(
  'a2000000-0000-0000-0000-000000000002',
  'a3000000-0000-0000-0000-000000000002',
  'a4000000-0000-0000-0000-000000000002',
  'a5000000-0000-0000-0000-000000000002',
  'a6000000-0000-0000-0000-000000000002',
  'a7000000-0000-0000-0000-000000000002',
  'a8000000-0000-0000-0000-000000000002',
  'repair-budget',
  'validation',
  'pending',
  2,
  'infinity'::timestamptz
);
select pg_temp.insert_generation_fixture(
  'a2000000-0000-0000-0000-000000000003',
  'a3000000-0000-0000-0000-000000000003',
  'a4000000-0000-0000-0000-000000000003',
  'a5000000-0000-0000-0000-000000000003',
  'a6000000-0000-0000-0000-000000000003',
  'a7000000-0000-0000-0000-000000000003',
  'a8000000-0000-0000-0000-000000000003',
  'empty-manifest',
  'persistence',
  'pending',
  0,
  null
);

-- assertion: stale non-generation recovery does not block claims
insert into public.background_jobs(
  id,website_id,chain_id,job_type,sequence_index,status,payload_json,attempts,max_attempts,
  locked_at,locked_by,started_at,finalization_attempts,created_at
) values
  (
    'b8000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'b7000000-0000-0000-0000-000000000001',
    'enrichment_platform',0,'running','{}'::jsonb,1,3,
    clock_timestamp()-interval '2 hours','bucket1-stale-worker',
    clock_timestamp()-interval '2 hours',0,clock_timestamp()-interval '2 hours'
  ),
  (
    'b8000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000001',
    'b7000000-0000-0000-0000-000000000002',
    'enrichment_platform',0,'running','{}'::jsonb,3,3,
    clock_timestamp()-interval '2 hours','bucket1-stale-worker',
    clock_timestamp()-interval '2 hours',0,clock_timestamp()-interval '2 hours'
  ),
  (
    'b8000000-0000-0000-0000-000000000003',
    'a2000000-0000-0000-0000-000000000001',
    'b7000000-0000-0000-0000-000000000003',
    'enrichment_platform',0,'finalizing','{}'::jsonb,1,3,
    clock_timestamp()-interval '2 hours','bucket1-stale-worker',
    clock_timestamp()-interval '2 hours',1,clock_timestamp()-interval '2 hours'
  );
create temporary table bucket1_stale_recovery as
select * from public.recover_stale_background_jobs(
  clock_timestamp()-interval '1 hour',
  'b9000000-0000-4000-8000-000000000001'
);
select pg_temp.assert_true(
  (select requeued_count=2 and failed_count=1 and reconciliation_count=0
   from bucket1_stale_recovery)
  and (select status='pending' and locked_by is null and next_retry_at is not null
       and scheduler_last_run_id='b9000000-0000-4000-8000-000000000001'
       from public.background_jobs where id='b8000000-0000-0000-0000-000000000001')
  and (select status='failed' and completed_at is not null and next_retry_at is null
       and error_message='Worker lease expired after maximum attempts'
       from public.background_jobs where id='b8000000-0000-0000-0000-000000000002')
  and (select status='pending' and payload_json->'resume_enrichment_finalization'='true'::jsonb
       from public.background_jobs where id='b8000000-0000-0000-0000-000000000003'),
  'stale non-generation recovery failed or prevented the claimant preflight'
);
update public.background_jobs
set next_retry_at='infinity'::timestamptz
where id in (
  'b8000000-0000-0000-0000-000000000001',
  'b8000000-0000-0000-0000-000000000003'
);
-- Leave one stale terminal-budget row for the separate maintenance RPC to recover.
-- Claiming must remain claim-only after maintenance terminalizes it.
insert into public.background_jobs(
  id,website_id,chain_id,job_type,sequence_index,status,payload_json,attempts,max_attempts,
  locked_at,locked_by,started_at,finalization_attempts,created_at
) values (
  'b8000000-0000-0000-0000-000000000004',
  'a2000000-0000-0000-0000-000000000001',
  'b7000000-0000-0000-0000-000000000004',
  'enrichment_platform',0,'running','{}'::jsonb,3,3,
  clock_timestamp()-interval '2 hours','bucket1-stale-worker',
  clock_timestamp()-interval '2 hours',0,clock_timestamp()-interval '2 hours'
);

select * from public.maintain_background_job_lifecycle(
  clock_timestamp()-interval '1 hour','a9000000-0000-0000-0000-000000000001',100
);

-- assertion: strict frozen checkpoint hash
select pg_temp.assert_true(
  (
    select generation_input_hash = encode(
      extensions.digest(convert_to(generation_input_snapshot::text, 'UTF8'), 'sha256'),
      'hex'
    )
    and generation_checkpoint->'input' = generation_input_snapshot
    and generation_checkpoint->>'inputHash' = generation_input_hash
    and (generation_checkpoint->>'inputSizeBytes')::integer =
      octet_length(convert_to(generation_input_snapshot::text, 'UTF8'))
    and (generation_checkpoint->>'acceptedAt')::timestamptz = generation_accepted_at
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000001'
  ),
  'strict frozen checkpoint/hash was not derived from SQL jsonb::text bytes'
);

-- assertion: epoch-2 claim uniqueness
-- Repeated healthy yields make this max_attempts=1 job claimable seven times. Every
-- claim must get a unique monotonic epoch and exactly one claimed event.
do $$
declare
  claimed public.background_jobs%rowtype;
  target_stage text;
  iteration integer;
  yielded boolean;
begin
  for iteration in 1..6 loop
    select * into claimed
    from public.claim_next_background_job(
      'bucket1-db-suite',
      clock_timestamp() - interval '1 hour',
      2,
      ('a9000000-0000-0000-0000-' || lpad(iteration::text, 12, '0'))::uuid
    );
    perform pg_temp.assert_true(
      claimed.id = 'a8000000-0000-0000-0000-000000000001',
      'epoch-2 claim selected a different job'
    );
    if iteration = 1 then
      perform pg_temp.assert_true(
        (select status='failed' and completed_at is not null and locked_by is null
         from public.background_jobs where id='b8000000-0000-0000-0000-000000000004'),
        'separate maintenance did not recover stale non-generation work before dispatch'
      );
    end if;
    perform pg_temp.assert_true(
      claimed.claim_epoch = iteration and claimed.attempts = iteration,
      'claim epoch was not unique and monotonic'
    );
    target_stage := case when iteration = 1 then 'planning' when iteration = 2 then 'media' else 'media' end;
    select public.yield_site_generation_stage_epoch(
      claimed.id,
      claimed.claim_epoch,
      2,
      target_stage,
      pg_temp.strict_checkpoint(claimed.id, target_stage),
      least(90, 10 + iteration * 10),
      'Healthy checkpoint ' || iteration,
      claimed.id::text || ':' || claimed.claim_epoch::text || ':healthy-yield',
      'bucket1-db-suite',
      null,
      'bucket1-db-suite'
    ) into yielded;
    perform pg_temp.assert_true(yielded, 'healthy epoch yield was rejected');
  end loop;

  select * into claimed
  from public.claim_next_background_job(
    'bucket1-db-suite',
    clock_timestamp() - interval '1 hour',
    2,
    'a9000000-0000-0000-0000-000000000007'
  );
  perform pg_temp.assert_true(
    claimed.id = 'a8000000-0000-0000-0000-000000000001'
      and claimed.claim_epoch = 7
      and claimed.attempts = 7
      and claimed.attempts > claimed.max_attempts,
    'healthy epoch-2 work stopped at the legacy max_attempts ceiling'
  );
end;
$$;

-- assertion: healthy yields beyond old max attempts
select pg_temp.assert_true(
  (
    select status = 'running'
      and attempts = 7
      and max_attempts = 1
      and claim_epoch = 7
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000001'
  ),
  'healthy yields did not remain live beyond old max attempts'
);
select pg_temp.assert_true(
  (
    select count(*) = 7 and count(distinct claim_epoch) = 7
    from public.site_generation_attempt_events
    where job_id = 'a8000000-0000-0000-0000-000000000001'
      and event_type = 'claimed'
  ),
  'claim events are not unique per epoch'
);

-- assertion: stale epoch yield rejection
select pg_temp.assert_true(
  not public.yield_site_generation_stage_epoch(
    'a8000000-0000-0000-0000-000000000001',
    6,
    2,
    'composition',
    pg_temp.strict_checkpoint(
      'a8000000-0000-0000-0000-000000000001',
      'composition'
    ),
    91,
    'Stale checkpoint must not commit',
    'bucket1-generation:stale-yield',
    'bucket1-db-suite',
    null,
    'bucket1-db-suite'
  ),
  'stale claim epoch yield was accepted'
);
select pg_temp.assert_true(
  (
    select status = 'running'
      and generation_stage = 'media'
      and claim_epoch = 7
      and locked_by = 'bucket1-db-suite'
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000001'
  )
  and not exists (
    select 1 from public.site_generation_attempt_events
    where event_key = 'bucket1-generation:stale-yield'
  ),
  'stale yield changed state or wrote an event'
);

-- assertion: effect certainty, reconciliation, and supersession RPCs
select pg_temp.assert_true(
  cardinality(public.plan_generation_media_slots_epoch(
    'a8000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    7,
    '[
      {"slot_id":"hero-ready","kind":"image","role":"hero","provenance":"generated","required":true,"proof_eligible":false},
      {"slot_id":"unused-planned","kind":"image","role":"support","provenance":"generated","required":false,"proof_eligible":false},
      {"slot_id":"unused-failed","kind":"image","role":"texture","provenance":"generated","required":false,"proof_eligible":false}
    ]'::jsonb,
    'bucket1-db-suite'
  )) = 3,
  'complete epoch media plan was not persisted'
);
select public.claim_generation_media_slot_epoch(
  'a8000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  7,
  'hero-ready',
  'image',
  'hero',
  'generated',
  true,
  false,
  null,
  null,
  'bucket1-db-suite'
);
create temporary table bucket1_provider_reservation as
select public.reserve_generation_media_create_epoch(
  'a8000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  7,
  'hero-ready',
  'lovable-image',
  repeat('e', 64),
  'bucket1-db-suite'
) as value;
select pg_temp.assert_true(
  (
    select (value->>'createOrdinal')::integer = 1
      and (value->>'slotClaimEpoch')::bigint = 1
      and nullif(value->>'reservationId', '') is not null
      and nullif(value->>'idempotencyKey', '') is not null
    from bucket1_provider_reservation
  ),
  'provider create reservation identity was not persisted'
);
select pg_temp.assert_true(
  public.record_generation_media_operation_epoch(
    'a8000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    7,
    'hero-ready',
    (select (value->>'reservationId')::uuid from bucket1_provider_reservation),
    'provider-op-a',
    'indeterminate',
    'bucket1-db-suite'
  ),
  'provider operation certainty record was rejected'
);
select pg_temp.assert_true(
  (
    select provider_operation_id = 'provider-op-a'
      and effect_certainty = 'indeterminate'
    from public.site_generation_media_slots
    where job_id = 'a8000000-0000-0000-0000-000000000001'
      and slot_id = 'hero-ready'
  ),
  'provider effect certainty was not durably recorded'
);
select pg_temp.assert_true(
  public.settle_generation_media_slot_epoch(
    'a8000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    7,
    'hero-ready',
    (select (value->>'reservationId')::uuid from bucket1_provider_reservation),
    'failed',
    'provider effect requires reconciliation',
    'indeterminate',
    'bucket1-db-suite'
  ),
  'indeterminate provider effect was not moved to reconciliation'
);
select pg_temp.assert_true(
  (
    select status = 'reconciliation_required'
      and effect_certainty = 'indeterminate'
      and reconciliation_required_at is not null
      and reconciliation_deadline > reconciliation_required_at
    from public.site_generation_media_slots
    where job_id = 'a8000000-0000-0000-0000-000000000001'
      and slot_id = 'hero-ready'
  )
  and (
    select status = 'pending'
      and next_retry_at is null
      and locked_by is null
      and lease_expires_at is null
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000001'
  ),
  'indeterminate effect was blindly retried instead of blocked for reconciliation'
);
select pg_temp.assert_true(
  public.reconcile_generation_media_slot_epoch(
    'a8000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'hero-ready',
    (select (value->>'reservationId')::uuid from bucket1_provider_reservation),
    'bucket1-generation:reconcile-ready',
    'ready',
    'ops:bucket1-db-suite',
    'provider lookup proved durable success',
    jsonb_build_object(
      'storagePath', 'site-media/bucket1-ready.webp',
      'contentHash', repeat('b', 64),
      'mimeType', 'image/webp'
    )
  ) = 'ready',
  'audited media reconciliation did not resolve ready'
);
select pg_temp.assert_true(
  public.reconcile_generation_media_slot_epoch(
    'a8000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'hero-ready',
    (select (value->>'reservationId')::uuid from bucket1_provider_reservation),
    'bucket1-generation:reconcile-ready',
    'ready',
    'ops:bucket1-db-suite',
    'provider lookup proved durable success',
    jsonb_build_object(
      'storagePath', 'site-media/bucket1-ready.webp',
      'contentHash', repeat('b', 64),
      'mimeType', 'image/webp'
    )
  ) = 'ready',
  'exact media reconciliation replay was not idempotent'
);
select pg_temp.assert_true(
  (
    select status = 'ready'
      and effect_certainty = 'definite_success'
      and storage_path = 'site-media/bucket1-ready.webp'
      and content_hash = repeat('b', 64)
      and reconciliation_action_key = 'bucket1-generation:reconcile-ready'
    from public.site_generation_media_slots
    where job_id = 'a8000000-0000-0000-0000-000000000001'
      and slot_id = 'hero-ready'
  )
  and (
    select count(*) = 1
    from public.site_generation_attempt_events
    where event_key = 'bucket1-generation:reconcile-ready'
      and event_type = 'reconciled'
  ),
  'reconciled asset or audit event is not durable and exactly-once'
);

-- assertion: supersession exact replay
select pg_temp.insert_generation_fixture(
  'a2000000-0000-0000-0000-000000000004',
  'a3000000-0000-0000-0000-000000000004',
  'a4000000-0000-0000-0000-000000000004',
  'a5000000-0000-0000-0000-000000000004',
  'a6000000-0000-0000-0000-000000000004',
  'a7000000-0000-0000-0000-000000000004',
  'a8000000-0000-0000-0000-000000000004',
  'supersession',
  'media',
  'pending',
  0,
  null
);
insert into public.site_generation_media_slots(
  id, job_id, website_id, slot_id, asset_id, kind, role, provenance,
  required, proof_eligible, status, claim_epoch, storage_path, mime_type, content_hash
) values (
  'aa000000-0000-0000-0000-000000000004',
  'a8000000-0000-0000-0000-000000000004',
  'a2000000-0000-0000-0000-000000000004',
  'superseded-ready',
  repeat('f', 64),
  'image',
  'support',
  'generated',
  false,
  false,
  'ready',
  0,
  'site-media/superseded-ready.webp',
  'image/webp',
  repeat('f', 64)
);
select pg_temp.assert_true(
  public.supersede_site_generation_epoch(
    'a2000000-0000-0000-0000-000000000004',
    'a8000000-0000-0000-0000-000000000004',
    'a4000000-0000-0000-0000-000000000004',
    0,
    'ops:bucket1-db-suite',
    'explicit test supersession'
  ),
  'exact administrative supersession was rejected'
);
select pg_temp.assert_true(
  public.supersede_site_generation_epoch(
    'a2000000-0000-0000-0000-000000000004',
    'a8000000-0000-0000-0000-000000000004',
    'a4000000-0000-0000-0000-000000000004',
    0,
    'ops:bucket1-db-suite',
    'explicit test supersession'
  )
  and not public.supersede_site_generation_epoch(
    'a2000000-0000-0000-0000-000000000004',
    'a8000000-0000-0000-0000-000000000004',
    'a4000000-0000-0000-0000-000000000004',
    0,
    'ops:bucket1-db-suite',
    'changed replay reason'
  ),
  'supersession replay did not enforce exact actor and reason'
);
select pg_temp.assert_true(
  (
    select status = 'superseded'
      and result_json->>'status' = 'superseded'
      and generation_terminal_message_payload->>'status' = 'superseded'
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000004'
  )
  and (
    select status = 'abandoned'
    from public.site_generation_media_slots
    where id = 'aa000000-0000-0000-0000-000000000004'
  )
  and (
    select count(*) = 1
    from public.site_generation_attempt_events
    where job_id = 'a8000000-0000-0000-0000-000000000004'
      and event_type = 'superseded'
  ),
  'supersession did not atomically project job, result, message, media, and event'
);

-- assertion: cancellation exact scope
select pg_temp.assert_true(
  not public.cancel_site_generation_request(
    'a2000000-0000-0000-0000-000000000001',
    'a7000000-0000-0000-0000-000000000099',
    'a4000000-0000-0000-0000-000000000001',
    2,
    'db-suite',
    'wrong chain',
    7
  ),
  'cancellation escaped its exact chain scope'
);
select pg_temp.assert_true(
  not public.cancel_site_generation_request(
    'a2000000-0000-0000-0000-000000000001',
    'a7000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000099',
    2,
    'db-suite',
    'wrong request',
    7
  ),
  'cancellation escaped its exact request scope'
);
select pg_temp.assert_true(
  not public.cancel_site_generation_request(
    'a2000000-0000-0000-0000-000000000001',
    'a7000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    2,
    'db-suite',
    'stale claim',
    6
  ),
  'cancellation accepted a stale claim epoch'
);
select pg_temp.assert_true(
  (
    select status = 'running' and claim_epoch = 7
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000001'
  ),
  'wrong-scope cancellation changed the job'
);

-- assertion: cancellation terminal projection
select pg_temp.assert_true(
  public.cancel_site_generation_request(
    'a2000000-0000-0000-0000-000000000001',
    'a7000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    2,
    'db-suite',
    'exact cancellation fixture',
    7
  ),
  'exact cancellation was rejected'
);
select pg_temp.assert_true(
  (
    select status = 'cancelled'
      and cancellation_actor = 'db-suite'
      and cancellation_reason = 'exact cancellation fixture'
      and generation_terminal_message_id = 'a6000000-0000-0000-0000-000000000001'
      and generation_terminal_message_payload->>'status' = 'cancelled'
      and generation_terminal_message_payload->>'claimEpoch' = '7'
      and generation_terminal_message_at is not null
      and locked_by is null
      and lease_expires_at is null
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000001'
  ),
  'cancellation did not commit its exact terminal projection'
);
select pg_temp.assert_true(
  (
    select content = 'Website generation was cancelled.'
    from public.messages
    where id = 'a6000000-0000-0000-0000-000000000001'
  )
  and (
    select status = 'completed' and completed_at is not null
    from public.agent_traces
    where id = 'a5000000-0000-0000-0000-000000000001'
  ),
  'cancellation did not settle the bound message and trace'
);

-- assertion: cancellation replay
create temporary table bucket1_cancel_projection_before as
select generation_terminal_message_id, generation_terminal_message_payload, generation_terminal_message_at
from public.background_jobs
where id = 'a8000000-0000-0000-0000-000000000001';
select pg_temp.assert_true(
  not public.cancel_site_generation_request(
    'a2000000-0000-0000-0000-000000000001',
    'a7000000-0000-0000-0000-000000000001',
    'a4000000-0000-0000-0000-000000000001',
    2,
    'db-suite',
    'exact cancellation fixture',
    7
  ),
  'terminal cancellation replay should be a no-op'
);
select pg_temp.assert_true(
  (
    select row(
      job.generation_terminal_message_id,
      job.generation_terminal_message_payload,
      job.generation_terminal_message_at
    ) = row(
      before.generation_terminal_message_id,
      before.generation_terminal_message_payload,
      before.generation_terminal_message_at
    )
    from public.background_jobs job
    cross join bucket1_cancel_projection_before before
    where job.id = 'a8000000-0000-0000-0000-000000000001'
  )
  and (
    select count(*) = 1
    from public.site_generation_attempt_events
    where job_id = 'a8000000-0000-0000-0000-000000000001'
      and event_type = 'cancelled'
  )
  and not public.settle_agent_site_generation_message(
    'a2000000-0000-0000-0000-000000000001',
    'a7000000-0000-0000-0000-000000000001'
  ),
  'cancellation replay duplicated or rewrote terminal projection'
);

-- assertion: ready media preservation
select pg_temp.assert_true(
  (
    select status = 'ready'
      and version_id is null
      and storage_path = 'site-media/bucket1-ready.webp'
      and content_hash = repeat('b', 64)
    from public.site_generation_media_slots
    where job_id = 'a8000000-0000-0000-0000-000000000001'
      and slot_id = 'hero-ready'
  )
  and (
    select bool_and(status = 'abandoned')
    from public.site_generation_media_slots
    where job_id = 'a8000000-0000-0000-0000-000000000001'
      and slot_id in ('unused-planned', 'unused-failed')
  ),
  'cancellation did not preserve ready media or abandon only unfinished media'
);

-- assertion: empty manifest preconditions
create temporary table bucket1_empty_claim as
select *
from public.claim_next_background_job(
  'bucket1-db-suite-empty',
  clock_timestamp() - interval '1 hour',
  2,
  'a9000000-0000-0000-0000-000000000008'
);
select pg_temp.assert_true(
  (
    select id = 'a8000000-0000-0000-0000-000000000003'
      and claim_epoch = 1
      and generation_stage = 'persistence'
    from bucket1_empty_claim
  ),
  'empty-manifest job was not claimed under epoch 1'
);
-- Persist a composed candidate. Chrome QA stamps and Vault HMAC are not required.
create temporary table bucket1_empty_candidate(config jsonb not null);
do $$
declare
  candidate jsonb;
  source_hash text;
begin
  candidate := jsonb_build_object(
    'generator', 'unified-site-agent',
    'generatorSchemaVersion', 4,
    'variantKey', 'bucket1-empty-manifest-v1',
    'themeSource', '<main data-site-section="home"></main>',
    'mediaManifest', jsonb_build_object('slots', '[]'::jsonb),
    'unifiedPlan', jsonb_build_object(
      'operationalIntent', jsonb_build_object(
        'operationalAnchors', jsonb_build_array(
          jsonb_build_object('slug', 'home', 'purposes', jsonb_build_array('host-operation'))
        )
      )
    )
  );
  source_hash := encode(
    extensions.digest(convert_to(candidate->>'themeSource', 'UTF8'), 'sha256'),
    'hex'
  );
  insert into bucket1_empty_candidate(config) values (candidate);

  update public.background_jobs
  set generation_checkpoint = pg_temp.strict_checkpoint(
    id,
    'persistence',
    jsonb_build_object(
      'candidateConfig',candidate,
      'candidateRevision',0,
      'candidateSourceHash',source_hash
    )
  )
  where id = 'a8000000-0000-0000-0000-000000000003';
end;
$$;

create temporary table bucket1_empty_finalized as
select *
from public.insert_generated_website_version_with_slots(
  'a2000000-0000-0000-0000-000000000003',
  (select config from bucket1_empty_candidate),
  'a8000000-0000-0000-0000-000000000003',
  1,
  array[]::uuid[]
);
select pg_temp.assert_true(
  (
    select count(*) = 1 and min(version_number) = 1
    from bucket1_empty_finalized
  )
  and (
    select config_json#>'{mediaManifest,slots}' = '[]'::jsonb
      and generation_job_id = 'a8000000-0000-0000-0000-000000000003'
    from public.website_versions
    where id = (select id from bucket1_empty_finalized)
  )
  and (
    select count(*) = 0
    from public.website_version_media_slots
    where version_id = (select id from bucket1_empty_finalized)
  ),
  'valid empty manifest did not finalize without attachments'
);

-- assertion: empty manifest replay
create temporary table bucket1_empty_replay as
select *
from public.insert_generated_website_version_with_slots(
  'a2000000-0000-0000-0000-000000000003',
  (select config from bucket1_empty_candidate),
  'a8000000-0000-0000-0000-000000000003',
  1,
  array[]::uuid[]
);
select pg_temp.assert_true(
  (
    select first.id = replay.id
      and first.version_number = replay.version_number
      and first.variant_key = replay.variant_key
    from bucket1_empty_finalized first
    cross join bucket1_empty_replay replay
  )
  and (
    select count(*) = 1
    from public.website_versions
    where generation_job_id = 'a8000000-0000-0000-0000-000000000003'
  )
  and (
    select status = 'completed'
      and generation_terminal_message_id = 'a6000000-0000-0000-0000-000000000003'
      and generation_terminal_message_payload->>'status' = 'completed'
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000003'
  ),
  'empty manifest finalization replay was not idempotent'
);

-- assertion: transactional schema-v4 publish without Chrome QA
select pg_temp.assert_publish_rejected(
  'a2000000-0000-0000-0000-000000000003',
  (select id from bucket1_empty_finalized),
  0,
  (select config_json from public.website_versions where id=(select id from bucket1_empty_finalized)),
  null,
  null,
  'schema-v4 publish skipped the locked media snapshot'
);
select pg_temp.assert_publish_rejected(
  'a2000000-0000-0000-0000-000000000003',
  (select id from bucket1_empty_finalized),
  0,
  (select config_json || jsonb_build_object('themeSource','changed after validation')
   from public.website_versions where id=(select id from bucket1_empty_finalized)),
  '[]'::jsonb,
  null,
  'config edit race bypassed locked snapshot comparison'
);
select pg_temp.assert_true(
  public.publish_website_version_atomic(
    'a2000000-0000-0000-0000-000000000003',
    (select id from bucket1_empty_finalized),
    0,
    (select config_json from public.website_versions where id=(select id from bucket1_empty_finalized)),
    '[]'::jsonb,
    null
  ) = 1
  and (select status='live' and revision=1 from public.website_versions
       where id=(select id from bucket1_empty_finalized))
  and (select active_version_id=(select id from bucket1_empty_finalized)
       from public.websites where id='a2000000-0000-0000-0000-000000000003'),
  'schema-v4 publish without a Chrome QA stamp did not succeed'
);

-- assertion: owned and historical publish surfaces
insert into public.website_versions(
  id,website_id,version_number,config_json,variant_key,status,revision
) values (
  'ab000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000004',
  1,
  jsonb_build_object('generatorSchemaVersion',3,'legacy',true),
  'historical-v3',
  'draft',
  0
);
select pg_temp.assert_true(
  public.publish_website_version_owned(
    'a2000000-0000-0000-0000-000000000004',
    'a5000000-0000-0000-0000-000000000004',
    (select owner_token from public.agent_traces where id='a5000000-0000-0000-0000-000000000004'),
    'ab000000-0000-0000-0000-000000000001',
    0,
    jsonb_build_object('generatorSchemaVersion',3,'legacy',true),
    '[]'::jsonb,
    null
  ) = 1,
  'owned historical v3 publish did not retain snapshot behavior'
);
select pg_temp.assert_true(
  (select status='live' and revision=1 from public.website_versions
   where id='ab000000-0000-0000-0000-000000000001'),
  'owned publish did not transition the version'
);

-- assertion: settlement repair budget terminality
update public.background_jobs
set next_retry_at = clock_timestamp()
where id = 'a8000000-0000-0000-0000-000000000002';
create temporary table bucket1_repair_claim as
select *
from public.claim_next_background_job(
  'bucket1-db-suite-repair',
  clock_timestamp() - interval '1 hour',
  2,
  'a9000000-0000-0000-0000-000000000009'
);
select pg_temp.assert_true(
  (
    select id = 'a8000000-0000-0000-0000-000000000002'
      and claim_epoch = 1
      and generation_stage = 'validation'
    from bucket1_repair_claim
  ),
  'repair-budget job was not claimed under epoch 1'
);
select pg_temp.assert_true(
  not public.settle_site_generation_epoch(
    'a8000000-0000-0000-0000-000000000002',1,2,'pending',75,null,
    pg_temp.strict_checkpoint('a8000000-0000-0000-0000-000000000002','validation')-'inputSizeBytes',
    'missing size','Retrying',clock_timestamp()+interval '1 minute','definite_failure',
    'worker_failure','bucket1-generation:settle-missing-size','stage_attempt',
    'bucket1-db-suite-repair',null,'bucket1-db-suite'
  )
  and not public.settle_site_generation_epoch(
    'a8000000-0000-0000-0000-000000000002',1,2,'pending',75,null,
    jsonb_set(
      pg_temp.strict_checkpoint('a8000000-0000-0000-0000-000000000002','validation'),
      '{inputSizeBytes}',to_jsonb(
        octet_length(convert_to((select generation_input_snapshot::text from public.background_jobs
          where id='a8000000-0000-0000-0000-000000000002'),'UTF8'))+1
      )
    ),
    'wrong size','Retrying',clock_timestamp()+interval '1 minute','definite_failure',
    'worker_failure','bucket1-generation:settle-wrong-size','stage_attempt',
    'bucket1-db-suite-repair',null,'bucket1-db-suite'
  )
  and not exists (
    select 1 from public.site_generation_attempt_events
    where event_key in (
      'bucket1-generation:settle-missing-size','bucket1-generation:settle-wrong-size'
    )
  ),
  'missing or incorrect inputSizeBytes was accepted at settlement'
);
-- At repair_attempts=2, one more validation-to-composition writer repair must atomically
-- exhaust the budget, become failed, clear its lease/retry, and project one terminal message.
select pg_temp.assert_true(
  public.settle_site_generation_epoch(
    'a8000000-0000-0000-0000-000000000002',
    1,
    2,
    'pending',
    80,
    null,
    pg_temp.strict_checkpoint(
      'a8000000-0000-0000-0000-000000000002',
      'composition',
      jsonb_build_object('defects', jsonb_build_array('deterministic writer repair fixture'))
    ),
    'writer repair failed',
    'Retrying writer repair',
    clock_timestamp() + interval '1 minute',
    'definite_failure',
    'writer_validation_failure',
    'bucket1-generation:repair-budget-terminal',
    'writer_repair',
    'bucket1-db-suite',
    null,
    'bucket1-db-suite'
  ),
  'terminal writer-repair settlement was rejected'
);
select pg_temp.assert_true(
  (
    select status = 'failed'
      and repair_attempts = 3
      and generation_stage = 'composition'
      and next_retry_at is null
      and locked_by is null
      and lease_expires_at is null
      and status_message = 'Generation retry budget exhausted'
      and generation_terminal_message_id = 'a6000000-0000-0000-0000-000000000002'
      and generation_terminal_message_payload->>'status' = 'failed'
    from public.background_jobs
    where id = 'a8000000-0000-0000-0000-000000000002'
  )
  and (
    select content = 'We could not finish this website. Please try again.'
    from public.messages
    where id = 'a6000000-0000-0000-0000-000000000002'
  )
  and (
    select count(*) = 1
      and bool_and(event_type = 'failed' and budget_before = 2 and budget_after = 3)
    from public.site_generation_attempt_events
    where event_key = 'bucket1-generation:repair-budget-terminal'
  ),
  'repair budget exhaustion was not terminal and exactly projected'
);
select pg_temp.assert_true(
  not public.settle_site_generation_epoch(
    'a8000000-0000-0000-0000-000000000002',
    1,
    2,
    'failed',
    80,
    null,
    pg_temp.strict_checkpoint(
      'a8000000-0000-0000-0000-000000000002',
      'composition',
      jsonb_build_object('defects', jsonb_build_array('replay'))
    ),
    'replay',
    'Failed',
    null,
    'definite_failure',
    'writer_validation_failure',
    'bucket1-generation:repair-budget-terminal-replay',
    'writer_repair',
    'bucket1-db-suite',
    null,
    'bucket1-db-suite'
  )
  and not exists (
    select 1 from public.site_generation_attempt_events
    where event_key = 'bucket1-generation:repair-budget-terminal-replay'
  ),
  'terminal settlement replay mutated the job'
);

-- assertion: service grants and browser claim revocation
select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.claim_next_background_job(text,timestamptz,integer,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_next_background_job(text,timestamptz,integer,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_next_background_job(text,timestamptz,integer,uuid)',
    'EXECUTE'
  ),
  'server claim grants are not service-only'
);
select pg_temp.assert_true(
  to_regprocedure('public.claim_site_generation_stage(uuid,text,timestamptz)') is null
  and to_regprocedure('public.claim_next_background_job(text,timestamptz)') is null
  and to_regprocedure('public.claim_next_background_job(text,timestamptz,integer)') is null
  and to_regprocedure('public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text)') is null
  and to_regprocedure('public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,text,text,text)') is null
  and to_regprocedure('public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,text)') is null
  and to_regprocedure('public.yield_site_generation_stage(uuid,integer,text,integer,text)') is null
  and to_regprocedure('public.record_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text)') is null
  and to_regprocedure('public.record_generation_media_slot_epoch(uuid,uuid,bigint,text,uuid,bigint,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text)') is not null
  and to_regprocedure('public.insert_generated_website_version(uuid,jsonb,uuid,integer)') is null
  and to_regprocedure('public.supersede_site_generation_epoch(uuid,uuid,uuid,bigint,text,text)') is null,
  'retired browser, claim, yield, unfenced ready-writer, finalizer, or supersession RPC survived final migration state'
);
select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.cancel_site_generation_request(uuid,uuid,uuid,integer,text,text,bigint)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[])',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,uuid,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.reconcile_generation_media_slot_epoch(uuid,uuid,text,uuid,text,text,text,text,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.record_generation_media_slot_epoch(uuid,uuid,bigint,text,uuid,bigint,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.supersede_and_enqueue_site_generation_job_owned(uuid,uuid,uuid,bigint,text,jsonb,uuid,uuid,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.enqueue_site_generation_job(uuid,text,jsonb,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,text)',
    'EXECUTE'
  ),
  'epoch-2 mutation RPC grants are not service-only'
);
select pg_temp.assert_true(
  (
    select count(*) = 2
    from pg_proc proc
    join pg_namespace namespace on namespace.oid=proc.pronamespace
    where namespace.nspname='public'
      and proc.proname in ('publish_website_version_atomic','publish_website_version_owned')
      and (
        (proc.proname='publish_website_version_atomic'
         and pg_get_function_identity_arguments(proc.oid)='uuid, uuid, bigint, jsonb, jsonb, jsonb')
        or
        (proc.proname='publish_website_version_owned'
         and pg_get_function_identity_arguments(proc.oid)='uuid, uuid, uuid, uuid, bigint, jsonb, jsonb, jsonb')
      )
  )
  and has_function_privilege(
    'service_role',
    'public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.publish_website_version_owned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ),
  'obsolete publish overload survived or strong publish grants are wrong'
);
select pg_temp.assert_true(
  exists (select 1 from cron.job where jobname='obra-reconcile-generation-media'
    and command like '%reconcile_due_generation_media%')
  and exists (select 1 from cron.job where jobname='obra-archive-generation-events'
    and command like '%archive_site_generation_attempt_events%'),
  'scheduled media reconciliation or generation-event retention executor is missing'
);


-- assertion: oversized frozen input owned admission
insert into public.websites(id,user_id,status,environment,onboarding_state)
values (
  'a2000000-0000-0000-0000-000000000005',
  'a1000000-0000-0000-0000-000000000001',
  'draft','test','{"contactHidden":true,"scenario":"oversized-owned-admission"}'::jsonb
);
insert into public.conversations(id,user_id,website_id,phase)
values (
  'a3000000-0000-0000-0000-000000000005',
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000005','generation'
);
insert into public.contractor_profiles(website_id,license_number,enrichment_json,research_status)
values (
  'a2000000-0000-0000-0000-000000000005',
  'BUCKET1-OVERSIZED-INPUT',
  jsonb_build_object(
    'evidenceMarker','preserve-complete-enrichment',
    'padding',repeat('x',2 * 1024 * 1024)
  ),
  'complete'
);
insert into public.agent_traces(
  id,website_id,profile_id,conversation_id,intent_type,trigger_message,status,request_id,
  request_payload_hash,owner_token,heartbeat_at,lease_expires_at
) values (
  'a5000000-0000-0000-0000-000000000005',
  'a2000000-0000-0000-0000-000000000005',
  'a1000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000005',
  'site_generation','Build a warm, modern, editorial, spacious website — ' || repeat('é',9*1024),'running',
  'a4000000-0000-0000-0000-000000000005',repeat('b',64),
  'a9000000-0000-4000-8000-000000000005',clock_timestamp(),clock_timestamp()+interval '10 minutes'
);
create temporary table bucket1_oversized_admission as
select * from public.enqueue_site_generation_job_owned(
  'a2000000-0000-0000-0000-000000000005',
  'a4000000-0000-0000-0000-000000000005',
  '{"generationKind":"initial","generationMode":"unified","generationStage":"context","generationContractVersion":2}'::jsonb,
  'a5000000-0000-0000-0000-000000000005',
  'a9000000-0000-4000-8000-000000000005',
  false
);
select pg_temp.assert_true(
  (select count(*)=1 and count(distinct chain_id)=1 and count(distinct assistant_message_id)=1
   from bucket1_oversized_admission),
  'oversized owned admission did not return one chain and handoff identity'
);
select pg_temp.assert_true(
  (select count(*)=1
   from public.background_jobs job
   join bucket1_oversized_admission accepted on accepted.chain_id=job.chain_id
   where job.website_id='a2000000-0000-0000-0000-000000000005'
     and job.job_type='site_generation' and job.status='pending' and job.sequence_index=0
     and job.generation_contract_epoch=2 and job.generation_stage='context'
     and octet_length(convert_to(job.generation_input_snapshot::text,'UTF8'))>2*1024*1024
     and job.generation_input_snapshot->'enrichment'->>'evidenceMarker'='preserve-complete-enrichment'
     and length(job.generation_input_snapshot->'enrichment'->>'padding')=2*1024*1024
     and job.generation_tenant_id='a1000000-0000-0000-0000-000000000001'
     and job.generation_input_snapshot->>'instruction'=''
     and (job.generation_input_snapshot->>'instructionByteLength')::integer=0
     and (select octet_length(convert_to(event.trigger_message,'UTF8'))>16*1024
          from public.agent_traces event
          where event.id=job.agent_trace_id)
     and job.generation_input_hash=encode(extensions.digest(convert_to(job.generation_input_snapshot::text,'UTF8'),'sha256'),'hex')
     and job.generation_checkpoint->'input'=job.generation_input_snapshot
     and job.generation_checkpoint->>'inputHash'=job.generation_input_hash
     and (job.generation_checkpoint->>'inputSizeBytes')::integer=octet_length(convert_to(job.generation_input_snapshot::text,'UTF8'))
     and octet_length(convert_to(job.generation_checkpoint::text,'UTF8'))>2*1024*1024),
  'oversized input was truncated, rehashed, or rejected before pending admission'
);
select pg_temp.assert_true(
  (select count(*)=1
   from public.messages message
   join bucket1_oversized_admission accepted on accepted.assistant_message_id=message.id
   where message.trace_id='a5000000-0000-0000-0000-000000000005'
     and message.role='assistant' and message.content='Building your website…'),
  'oversized admission did not atomically persist one handoff message'
);
do $$
declare
  valid_job public.background_jobs%rowtype;
begin
  select job.* into strict valid_job
  from public.background_jobs job
  join bucket1_oversized_admission accepted on accepted.chain_id=job.chain_id
  where job.website_id='a2000000-0000-0000-0000-000000000005'
    and job.job_type='site_generation';

  begin
    delete from public.background_jobs where id=valid_job.id;
    valid_job.generation_input_hash := null;
    insert into public.background_jobs select valid_job.*;
    raise exception 'assertion failed: null input hash was accepted';
  exception
    when not_null_violation or check_violation then null;
  end;
  begin
    delete from public.background_jobs where id=valid_job.id;
    valid_job.generation_input_hash := valid_job.generation_checkpoint->>'inputHash';
    valid_job.generation_request_hash := repeat('g',64);
    insert into public.background_jobs select valid_job.*;
    raise exception 'assertion failed: malformed request hash was accepted';
  exception
    when check_violation then null;
  end;
  begin
    delete from public.background_jobs where id=valid_job.id;
    valid_job.generation_request_hash := valid_job.generation_input_snapshot->>'requestPayloadHash';
    valid_job.generation_checkpoint := valid_job.generation_checkpoint-'inputSizeBytes';
    insert into public.background_jobs select valid_job.*;
    raise exception 'assertion failed: missing checkpoint inputSizeBytes was accepted';
  exception
    when check_violation then null;
  end;
  begin
    delete from public.background_jobs where id=valid_job.id;
    valid_job.generation_checkpoint := jsonb_set(
      valid_job.generation_checkpoint,
      '{inputSizeBytes}',
      to_jsonb(octet_length(convert_to(valid_job.generation_input_snapshot::text,'UTF8')))
    );
    valid_job.generation_request_hash := repeat('c',64);
    insert into public.background_jobs select valid_job.*;
    raise exception 'assertion failed: mismatched request hash was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;
do $$
declare
  claimed public.background_jobs%rowtype;
  expected_job_id uuid;
  yielded boolean;
begin
  select job.id into strict expected_job_id
  from public.background_jobs job
  join bucket1_oversized_admission accepted on accepted.chain_id=job.chain_id
  where job.website_id='a2000000-0000-0000-0000-000000000005'
    and job.job_type='site_generation' and job.sequence_index=0;
  update public.background_jobs
  set next_retry_at='infinity'::timestamptz
  where id<>expected_job_id and job_type='site_generation'
    and generation_contract_epoch=2 and status='pending';
  perform pg_temp.assert_true(
    (select count(*)=1 from public.background_jobs
     where job_type='site_generation' and generation_contract_epoch=2
       and status='pending' and coalesce(next_retry_at,clock_timestamp())<=clock_timestamp()),
    'oversized claim fixture did not isolate the eligible generation queue'
  );
  select * into strict claimed
  from public.claim_next_background_job(
    'bucket1-oversized-suite',clock_timestamp()-interval '1 hour',2,
    'a9000000-0000-4000-8000-000000000006'
  );
  perform pg_temp.assert_true(
    claimed.id=expected_job_id
    and claimed.website_id='a2000000-0000-0000-0000-000000000005'
    and octet_length(convert_to(claimed.generation_checkpoint::text,'UTF8'))>2*1024*1024,
    'oversized generation checkpoint did not cross claim boundary'
  );
  perform pg_temp.assert_true(
    not public.yield_site_generation_stage_epoch(
      claimed.id,claimed.claim_epoch,2,'planning',
      pg_temp.strict_checkpoint(claimed.id,'planning')-'inputSizeBytes',25,
      'Missing input byte count must not persist',claimed.id::text||':missing-size',
      'bucket1-oversized-suite',null,'bucket1-oversized-suite'
    )
    and not public.yield_site_generation_stage_epoch(
      claimed.id,claimed.claim_epoch,2,'planning',
      jsonb_set(
        pg_temp.strict_checkpoint(claimed.id,'planning'),'{inputSizeBytes}',
        to_jsonb(octet_length(convert_to(claimed.generation_input_snapshot::text,'UTF8'))-1)
      ),25,'Wrong input byte count must not persist',claimed.id::text||':wrong-size',
      'bucket1-oversized-suite',null,'bucket1-oversized-suite'
    ),
    'missing or incorrect inputSizeBytes was accepted at oversized yield'
  );
  select public.yield_site_generation_stage_epoch(
    claimed.id,claimed.claim_epoch,2,'planning',
    pg_temp.strict_checkpoint(claimed.id,'planning'),25,'Oversized context preserved',
    claimed.id::text||':oversized-yield','bucket1-oversized-suite',null,'bucket1-oversized-suite'
  ) into yielded;
  perform pg_temp.assert_true(yielded,'oversized generation checkpoint was rejected at yield');
  perform pg_temp.assert_true(
    (select generation_stage='planning'
      and generation_checkpoint->'input'=generation_input_snapshot
      and length(generation_checkpoint->'input'->'enrichment'->>'padding')=2*1024*1024
      and generation_checkpoint->'input'->>'instruction'=''
      and (generation_checkpoint->'input'->>'instructionByteLength')::integer=0
      and (generation_checkpoint->>'inputSizeBytes')::integer=octet_length(convert_to(generation_input_snapshot::text,'UTF8'))
     from public.background_jobs where id=claimed.id),
    'oversized generation checkpoint was truncated during yield'
  );
end;
$$;
create temporary table bucket1_oversized_replay as
select * from public.enqueue_site_generation_job_owned(
  'a2000000-0000-0000-0000-000000000005',
  'a4000000-0000-0000-0000-000000000005',
  '{"generationKind":"initial","generationMode":"unified","generationStage":"context","generationContractVersion":2}'::jsonb,
  'a5000000-0000-0000-0000-000000000005',
  'a9000000-0000-4000-8000-000000000005',false
);
select pg_temp.assert_true(
  (select count(*)=1 from bucket1_oversized_replay)
  and (select first.chain_id=replay.chain_id
        and first.assistant_message_id=replay.assistant_message_id
       from bucket1_oversized_admission first cross join bucket1_oversized_replay replay)
  and (select count(*)=1 and bool_and(
         generation_stage='planning'
         and generation_checkpoint->>'stage'='planning'
         and generation_checkpoint->'input'=generation_input_snapshot
         and generation_checkpoint->>'inputHash'=generation_input_hash
         and (generation_checkpoint->>'acceptedAt')::timestamptz=generation_accepted_at
         and generation_input_snapshot->>'instruction'=''
         and (generation_input_snapshot->>'instructionByteLength')::integer=0
         and event.trigger_message is not null
       )
       from public.background_jobs job
       join public.agent_traces event on event.id=job.agent_trace_id
       join bucket1_oversized_replay replay on replay.chain_id=job.chain_id
       where job.website_id='a2000000-0000-0000-0000-000000000005'
         and job.job_type='site_generation')
  and (select count(*)=1 from public.messages message
       join bucket1_oversized_replay replay on replay.assistant_message_id=message.id
       where message.trace_id='a5000000-0000-0000-0000-000000000005'
         and message.role='assistant' and message.content='Building your website…'),
  'oversized exact replay changed identity, checkpoint, snapshot, or handoff'
);

-- assertion: regeneration admission uses the real source-slot key and commits atomically
select pg_temp.assert_true(
  (select count(*)=1
          and bool_and(pgtrig.tgname='background_jobs_guard_site_generation_frozen_input')
   from pg_trigger pgtrig
   where pgtrig.tgrelid='public.background_jobs'::regclass
     and not pgtrig.tgisinternal
     and pgtrig.tgfoid='public.guard_site_generation_frozen_input()'::regprocedure),
  'frozen-input trigger topology did not converge to one canonical trigger'
);

insert into public.websites(id,user_id,status,environment,onboarding_state)
values ('a2000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000001',
  'draft','test','{"contactHidden":true,"scenario":"regeneration-source-media-admission"}'::jsonb);
insert into public.conversations(id,user_id,website_id,phase)
values ('a3000000-0000-0000-0000-000000000006','a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000006','generation');
insert into public.contractor_profiles(website_id,license_number,enrichment_json,research_status)
values ('a2000000-0000-0000-0000-000000000006','BUCKET1-REGEN-ADMISSION',
  '{"evidenceMarker":"preserve-regeneration-source-media"}'::jsonb,'complete');
insert into public.website_versions(id,website_id,version_number,config_json,variant_key,status,revision)
values ('a6000000-0000-0000-0000-000000000006','a2000000-0000-0000-0000-000000000006',
  1,'{"schemaVersion":3,"marker":"exact-source-config"}'::jsonb,'source','draft',7);
insert into public.website_version_media_slots(
  version_id,website_id,slot_id,asset_id,mime_type,role,provenance,required,
  source_slot_id,poster_slot_id,storage_path,proof_eligible
) values
  ('a6000000-0000-0000-0000-000000000006','a2000000-0000-0000-0000-000000000006',
   'z-support',repeat('b',64),'image/webp','support','generated',false,null,null,
   'site-media/'||repeat('b',64)||'.webp',false),
  ('a6000000-0000-0000-0000-000000000006','a2000000-0000-0000-0000-000000000006',
   'a-hero',repeat('a',64),'image/webp','atmosphere','generated',true,null,null,
   'site-media/'||repeat('a',64)||'.webp',false);
insert into public.agent_traces(
  id,website_id,profile_id,conversation_id,intent_type,trigger_message,status,request_id,
  request_payload_hash,owner_token,heartbeat_at,lease_expires_at,source_version_id,source_revision
) values (
  'a5000000-0000-0000-0000-000000000006','a2000000-0000-0000-0000-000000000006',
  'a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000006',
  'regenerate_variants','Regenerate from the exact source media fixture.','running',
  'a4000000-0000-0000-0000-000000000006',repeat('c',64),
  'a9000000-0000-4000-8000-000000000006',clock_timestamp(),clock_timestamp()+interval '10 minutes',
  'a6000000-0000-0000-0000-000000000006',7);

create temporary table bucket1_regeneration_admission as
select * from public.enqueue_site_generation_job_owned(
  'a2000000-0000-0000-0000-000000000006','a4000000-0000-0000-0000-000000000006',
  '{"generationKind":"regeneration","generationMode":"unified","generationStage":"context","generationContractVersion":2,"sourceVersionId":"a6000000-0000-0000-0000-000000000006","sourceRevision":7}'::jsonb,
  'a5000000-0000-0000-0000-000000000006','a9000000-0000-4000-8000-000000000006',true);

select pg_temp.assert_true(
  (select count(*)=1 and count(distinct chain_id)=1 and count(distinct assistant_message_id)=1
   from bucket1_regeneration_admission),
  'regeneration admission did not return one chain and atomic handoff identity');
select pg_temp.assert_true(
  (select count(*)=1
   from public.background_jobs job
   join bucket1_regeneration_admission accepted on accepted.chain_id=job.chain_id
   where job.website_id='a2000000-0000-0000-0000-000000000006'
     and job.status='pending' and job.generation_kind='regeneration'
     and job.source_version_id='a6000000-0000-0000-0000-000000000006'
     and job.source_revision=7
     and job.generation_input_snapshot->'sourceConfig'='{"schemaVersion":3,"marker":"exact-source-config"}'::jsonb
     and job.generation_input_snapshot->'enrichment'='{"evidenceMarker":"preserve-regeneration-source-media"}'::jsonb
     and job.generation_input_snapshot->'sourceMedia'='[
       {"slotId":"a-hero","assetId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "mimeType":"image/webp","role":"atmosphere","origin":"generated","required":true,
        "proofEligible":false,"storagePath":"site-media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
        "sourceSlotId":null,"posterSlotId":null},
       {"slotId":"z-support","assetId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "mimeType":"image/webp","role":"support","origin":"generated","required":false,
        "proofEligible":false,"storagePath":"site-media/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
        "sourceSlotId":null,"posterSlotId":null}
     ]'::jsonb
     and job.generation_checkpoint->'input' is not distinct from job.generation_input_snapshot
     and job.generation_checkpoint->>'inputHash'=job.generation_input_hash),
  'regeneration admission did not freeze exact source config/media in slot-key order');
select pg_temp.assert_true(
  (select count(*)=1
   from public.messages message
   join bucket1_regeneration_admission accepted on accepted.assistant_message_id=message.id
   where message.trace_id='a5000000-0000-0000-0000-000000000006'
     and message.role='assistant' and message.content='Building your website…'),
  'regeneration admission did not commit exactly one attributable handoff');

create temporary table bucket1_regeneration_replay as
select * from public.enqueue_site_generation_job_owned(
  'a2000000-0000-0000-0000-000000000006','a4000000-0000-0000-0000-000000000006',
  '{"generationKind":"regeneration","generationMode":"unified","generationStage":"context","generationContractVersion":2,"sourceVersionId":"a6000000-0000-0000-0000-000000000006","sourceRevision":7}'::jsonb,
  'a5000000-0000-0000-0000-000000000006','a9000000-0000-4000-8000-000000000006',true);
select pg_temp.assert_true(
  (select count(*)=1 from bucket1_regeneration_replay)
  and (select first.chain_id=replay.chain_id and first.assistant_message_id=replay.assistant_message_id
       from bucket1_regeneration_admission first cross join bucket1_regeneration_replay replay)
  and (select count(*)=1 from public.background_jobs job
       join bucket1_regeneration_replay replay on replay.chain_id=job.chain_id
       where job.website_id='a2000000-0000-0000-0000-000000000006'),
  'regeneration exact replay changed chain, handoff, or job cardinality');

-- assertion: omitted contactHidden freezes as JSON false
insert into public.websites(id,user_id,status,environment,onboarding_state)
values (
  'a2000000-0000-0000-0000-000000000008',
  'a1000000-0000-0000-0000-000000000001',
  'draft','test','{"scenario":"omitted-contact-hidden"}'::jsonb
);
insert into public.conversations(id,user_id,website_id,phase)
values (
  'a3000000-0000-0000-0000-000000000008',
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000008','generation'
);
insert into public.contractor_profiles(website_id,license_number,enrichment_json,research_status)
values (
  'a2000000-0000-0000-0000-000000000008',
  'BUCKET1-OMITTED-CONTACT-HIDDEN',
  '{"evidenceMarker":"omitted-contact-hidden"}'::jsonb,
  'complete'
);
insert into public.agent_traces(
  id,website_id,profile_id,conversation_id,intent_type,trigger_message,status,request_id,
  request_payload_hash,owner_token,heartbeat_at,lease_expires_at
) values (
  'a5000000-0000-0000-0000-000000000008',
  'a2000000-0000-0000-0000-000000000008',
  'a1000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000008',
  'site_generation','Build from onboarding that omits contactHidden.','running',
  'a4000000-0000-0000-0000-000000000008',repeat('e',64),
  'a9000000-0000-4000-8000-000000000008',clock_timestamp(),clock_timestamp()+interval '10 minutes'
);
create temporary table bucket1_omitted_contact_hidden as
select * from public.enqueue_site_generation_job_owned(
  'a2000000-0000-0000-0000-000000000008',
  'a4000000-0000-0000-0000-000000000008',
  '{"generationKind":"initial","generationMode":"unified","generationStage":"context","generationContractVersion":2}'::jsonb,
  'a5000000-0000-0000-0000-000000000008',
  'a9000000-0000-4000-8000-000000000008',
  false
);
select pg_temp.assert_true(
  (select count(*)=1
   from public.background_jobs job
   join bucket1_omitted_contact_hidden accepted on accepted.chain_id=job.chain_id
   where job.website_id='a2000000-0000-0000-0000-000000000008'
     and job.job_type='site_generation' and job.status='pending'
     and job.generation_input_snapshot->'contactPolicy'->>'source'='websites.onboarding_state.contactHidden'
     and (job.generation_input_snapshot->'contactPolicy'->>'sourcePresent')::boolean is false
     and jsonb_typeof(job.generation_input_snapshot->'contactPolicy'->'sourceValue')='null'
     and job.generation_input_snapshot->'contactPolicy'->'contactHidden'='false'::jsonb
     and jsonb_typeof(job.generation_input_snapshot->'contactPolicy'->'contactHidden')='boolean'
     and not (job.generation_input_snapshot->'onboarding' ? 'contactHidden')),
  'omitted contactHidden did not freeze contactPolicy.contactHidden as JSON false'
);

-- assertion: a mismatched regeneration source fence rejects without partial job or handoff
do $$
declare
  mismatched_request uuid := 'a4000000-0000-0000-0000-000000000007';
  mismatched_trace uuid := 'a5000000-0000-0000-0000-000000000007';
  mismatched_owner uuid := 'a9000000-0000-4000-8000-000000000007';
begin
  insert into public.agent_traces(
    id,website_id,profile_id,conversation_id,intent_type,trigger_message,status,request_id,
    request_payload_hash,owner_token,heartbeat_at,lease_expires_at,source_version_id,source_revision
  ) values (
    mismatched_trace,'a2000000-0000-0000-0000-000000000006',
    'a1000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000006',
    'regenerate_variants','Reject the stale source revision.','running',mismatched_request,repeat('d',64),
    mismatched_owner,clock_timestamp(),clock_timestamp()+interval '10 minutes',
    'a6000000-0000-0000-0000-000000000006',8
  );
  begin
    perform public.enqueue_site_generation_job_owned(
      'a2000000-0000-0000-0000-000000000006',mismatched_request::text,
      '{"generationKind":"regeneration","generationMode":"unified","generationStage":"context","generationContractVersion":2,"sourceVersionId":"a6000000-0000-0000-0000-000000000006","sourceRevision":8}'::jsonb,
      mismatched_trace,mismatched_owner,true
    );
    raise exception 'assertion failed: mismatched regeneration source revision was accepted';
  exception
    when others then
      if sqlerrm like 'assertion failed:%' then raise; end if;
      if sqlerrm <> 'Regeneration source snapshot does not match' then
        raise exception 'assertion failed: unexpected regeneration source mismatch error: %',sqlerrm;
      end if;
  end;
  perform pg_temp.assert_true(
    not exists (select 1 from public.background_jobs where generation_request_id=mismatched_request)
    and not exists (select 1 from public.messages where trace_id=mismatched_trace),
    'mismatched regeneration source left a partial job or handoff'
  );
end;
$$;

-- assertion: stale epoch-2 generation recovery, terminality, and replay
select pg_temp.insert_generation_fixture(
  'a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001',
  'c4000000-0000-0000-0000-000000000001','c5000000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000001','c7000000-0000-0000-0000-000000000001',
  'c8000000-0000-0000-0000-000000000001','stale-recovery','media','running',0,null
);
update public.background_jobs set locked_at=clock_timestamp()-interval '2 hours',
  lease_expires_at=clock_timestamp()-interval '1 minute',interruption_count=0
where id='c8000000-0000-0000-0000-000000000001';
create temporary table bucket1_generation_recovery as select * from public.recover_stale_background_jobs(
  clock_timestamp()-interval '1 hour','c9000000-0000-4000-8000-000000000001');
select pg_temp.assert_true(
  (select requeued_count=1 and failed_count=0 and reconciliation_count=0 from bucket1_generation_recovery)
  and (select status='pending' and interruption_count=1 and claim_epoch=1 and attempts=1
    and locked_at is null and locked_by is null and lease_expires_at is null and next_retry_at is not null
    from public.background_jobs where id='c8000000-0000-0000-0000-000000000001')
  and (select count(*)=1 from public.site_generation_attempt_events
    where event_key='c8000000-0000-0000-0000-000000000001:1:stale-recovery'
      and event_type='interrupted' and budget_before=0 and budget_after=1),
  'stale generation was not requeued with one durable interruption');
select pg_temp.assert_true(
  (select requeued_count=0 and failed_count=0 and reconciliation_count=0
   from public.recover_stale_background_jobs(clock_timestamp()-interval '1 hour','c9000000-0000-4000-8000-000000000002'))
  and (select count(*)=1 from public.site_generation_attempt_events
    where event_key='c8000000-0000-0000-0000-000000000001:1:stale-recovery'),
  'stale generation replay was not idempotent');

select pg_temp.insert_generation_fixture(
  'a2000000-0000-0000-0000-000000000002','a3000000-0000-0000-0000-000000000002',
  'c4000000-0000-0000-0000-000000000002','c5000000-0000-0000-0000-000000000002',
  'c6000000-0000-0000-0000-000000000002','c7000000-0000-0000-0000-000000000002',
  'c8000000-0000-0000-0000-000000000002','stale-terminal','validation','running',0,null
);
update public.background_jobs set locked_at=clock_timestamp()-interval '2 hours',
  lease_expires_at=clock_timestamp()-interval '1 minute',interruption_count=4
where id='c8000000-0000-0000-0000-000000000002';
select * from public.recover_stale_background_jobs(
  clock_timestamp()-interval '1 hour','c9000000-0000-4000-8000-000000000003');
select pg_temp.assert_true(
  (select status='failed' and interruption_count=5 and completed_at is not null and next_retry_at is null
    and status_message='Generation retry budget exhausted'
    and result_json->>'errorCode'='generation_interruption_budget_exhausted'
    and generation_terminal_message_payload->>'status'='failed'
    from public.background_jobs where id='c8000000-0000-0000-0000-000000000002')
  and (select content='We could not finish this website. Please try again.' from public.messages
    where id='c6000000-0000-0000-0000-000000000002')
  and (select status='error' from public.agent_traces where id='c5000000-0000-0000-0000-000000000002')
  and (select count(*)=1 from public.site_generation_attempt_events
    where event_key='c8000000-0000-0000-0000-000000000002:1:stale-recovery'
      and event_type='failed' and disposition='terminal_failure' and budget_before=4 and budget_after=5),
  'terminal stale recovery did not project the exhausted budget');

-- assertion: stale generation recovery accepts legacy NULL runner identity
select pg_temp.insert_generation_fixture(
  'a2000000-0000-0000-0000-000000000004','a3000000-0000-0000-0000-000000000004',
  'cc000000-0000-0000-0000-000000000004','cc100000-0000-0000-0000-000000000004',
  'cc200000-0000-0000-0000-000000000004','cc300000-0000-0000-0000-000000000004',
  'cc400000-0000-0000-0000-000000000004','stale-null-runner','context','running',0,null
);
update public.background_jobs set locked_at=clock_timestamp()-interval '2 hours',locked_by=null,
  lease_expires_at=clock_timestamp()-interval '1 minute'
where id='cc400000-0000-0000-0000-000000000004';
select * from public.recover_stale_background_jobs(
  clock_timestamp()-interval '1 hour','cc500000-0000-4000-8000-000000000004');
select pg_temp.assert_true(
  (select status='pending' and interruption_count=1 and locked_by is null and lease_expires_at is null
    from public.background_jobs where id='cc400000-0000-0000-0000-000000000004'),
  'legacy NULL runner identity blocked expired generation recovery');

-- assertion: provider uncertainty blocks a recovered generation
select pg_temp.insert_generation_fixture(
  'a2000000-0000-0000-0000-000000000003','a3000000-0000-0000-0000-000000000003',
  'c4000000-0000-0000-0000-000000000003','c5000000-0000-0000-0000-000000000003',
  'c6000000-0000-0000-0000-000000000003','c7000000-0000-0000-0000-000000000003',
  'c8000000-0000-0000-0000-000000000003','stale-uncertain','media','running',0,null
);
update public.background_jobs set locked_at=clock_timestamp()-interval '2 hours',
  lease_expires_at=clock_timestamp()-interval '1 minute'
where id='c8000000-0000-0000-0000-000000000003';
insert into public.site_generation_media_slots(
  id,job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,status,claim_epoch,
  effect_certainty,provider_reservation_id,provider_reserved_at
) values(
  'ca000000-0000-0000-0000-000000000003','c8000000-0000-0000-0000-000000000003',
  'a2000000-0000-0000-0000-000000000003','uncertain-hero','image','hero','generated',true,false,
  'generating',1,'indeterminate','cb000000-0000-4000-8000-000000000003',clock_timestamp()-interval '2 minutes'
);
create temporary table bucket1_uncertain_recovery as select * from public.recover_stale_background_jobs(
  clock_timestamp()-interval '1 hour','c9000000-0000-4000-8000-000000000004');
select pg_temp.assert_true(
  (select requeued_count=1 and failed_count=0 and reconciliation_count=1 from bucket1_uncertain_recovery)
  and (select status='pending' and next_retry_at is null and status_message='Media provider reconciliation required'
    from public.background_jobs where id='c8000000-0000-0000-0000-000000000003')
  and (select status='reconciliation_required' and effect_certainty='indeterminate'
    and provider_reservation_id='cb000000-0000-4000-8000-000000000003'
    and reconciliation_required_at is not null and reconciliation_deadline>reconciliation_required_at
    from public.site_generation_media_slots where id='ca000000-0000-0000-0000-000000000003'),
  'provider uncertainty was not quarantined before generation retry');
-- assertion: healthy Add Video lease survives every shared recovery pass
insert into public.background_jobs(
  id,website_id,chain_id,job_type,sequence_index,status,payload_json,request_id,
  generation_contract_epoch,generation_contract_version,attempts,max_attempts,claim_epoch,
  locked_at,locked_by,lease_expires_at,started_at,created_at
) values(
  'cc000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000004',
  'cc100000-0000-0000-0000-000000000001','add_video',0,'running',
  '{"generatorSchemaVersion":4,"addVideoStage":"planning/call","stageFailures":{"planning/call":0}}',
  'cc200000-0000-0000-0000-000000000001',2,2,1,3,1,clock_timestamp()-interval '2 hours',
  'healthy-add-video',clock_timestamp()+interval '30 minutes',clock_timestamp()-interval '2 hours',
  clock_timestamp()-interval '2 hours'
);
create temporary table bucket1_healthy_add_video_before as
select to_jsonb(job) job_json from public.background_jobs job
where id='cc000000-0000-0000-0000-000000000001';
create temporary table bucket1_healthy_add_video_specialized as
select * from public.recover_stale_add_video_jobs(
  clock_timestamp()-interval '1 hour','cc300000-0000-4000-8000-000000000001');
create temporary table bucket1_healthy_add_video_generic as
select * from public.recover_stale_background_jobs(
  clock_timestamp()-interval '1 hour','cc300000-0000-4000-8000-000000000002');
select pg_temp.assert_true(
  (select requeued_count=0 and failed_count=0 and reconciliation_count=0
    from bucket1_healthy_add_video_specialized)
  and (select requeued_count=0 and failed_count=0 and reconciliation_count=0
    from bucket1_healthy_add_video_generic)
  and (select to_jsonb(job)=(select job_json from bucket1_healthy_add_video_before)
    from public.background_jobs job where id='cc000000-0000-0000-0000-000000000001'),
  'unexpired Add Video lease was mutated by specialized or generic recovery');

-- assertion: NULL claimant capability fails before every preflight mutation
insert into public.background_jobs(
  id,website_id,chain_id,job_type,sequence_index,status,payload_json,attempts,max_attempts,
  locked_at,locked_by,started_at,created_at
) values(
  'cc600000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000004',
  'cc700000-0000-0000-0000-000000000001','enrichment_platform',0,'running','{}',1,3,
  clock_timestamp()-interval '2 hours','null-guard-tripwire',clock_timestamp()-interval '2 hours',
  clock_timestamp()-interval '2 hours'
);
create function pg_temp.reject_null_guard_preflight_mutation() returns trigger language plpgsql as $$begin
  if old.id='cc600000-0000-0000-0000-000000000001' then
    raise exception 'NULL capability reached preflight mutation' using errcode='P1235';
  end if;
  return new;
end$$;
create trigger bucket1_reject_null_guard_preflight_mutation before update on public.background_jobs
for each row execute function pg_temp.reject_null_guard_preflight_mutation();
do $$ declare caught_state text; begin
  begin
    perform * from public.claim_next_background_job(
      'bucket1-null-capability',clock_timestamp()-interval '1 hour',null,
      'd9000000-0000-4000-8000-000000000001'
    );
    raise exception 'assertion failed: null capability was accepted';
  exception when others then
    get stacked diagnostics caught_state=returned_sqlstate;
    if caught_state<>'22023' then
      raise exception 'assertion failed: NULL guard did not precede preflight mutation; got %',caught_state;
    end if;
  end;
end $$;
drop trigger bucket1_reject_null_guard_preflight_mutation on public.background_jobs;
select pg_temp.assert_true(
  (select status='running' and locked_by='null-guard-tripwire'
    from public.background_jobs where id='cc600000-0000-0000-0000-000000000001'),
  'NULL claimant capability changed preflight state');

-- assertion: malformed Add Video retry ledgers are quarantined
insert into public.website_versions(id,website_id,version_number,config_json,variant_key,status,revision) values
  ('da000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000004',201,'{}','claim-bad-source','draft',0),
  ('da000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000004',202,'{}','claim-bad-target','draft',0),
  ('da000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000004',203,'{}','claim-exhausted-source','draft',0),
  ('da000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-000000000004',204,'{}','claim-exhausted-target','draft',0);
insert into public.background_jobs(id,website_id,chain_id,job_type,sequence_index,status,payload_json,
  request_id,source_version_id,target_version_id,generation_contract_epoch,generation_contract_version,
  attempts,max_attempts,created_at) values
  ('dc000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000004',
   'dd000000-0000-0000-0000-000000000001','add_video',0,'pending',
   '{"generatorSchemaVersion":4,"addVideoStage":"planning/call","stageFailures":{"planning/call":"NaN"}}',
   'de000000-0000-0000-0000-000000000001','da000000-0000-0000-0000-000000000001',
   'da000000-0000-0000-0000-000000000002',2,2,0,3,clock_timestamp()),
  ('dc000000-0000-0000-0000-000000000002','a2000000-0000-0000-0000-000000000004',
   'dd000000-0000-0000-0000-000000000002','add_video',0,'pending',
   '{"generatorSchemaVersion":4,"addVideoStage":"planning/call","stageFailures":{"planning/call":3}}',
   'de000000-0000-0000-0000-000000000002','da000000-0000-0000-0000-000000000003',
   'da000000-0000-0000-0000-000000000004',2,2,0,3,clock_timestamp()),
  ('dc000000-0000-0000-0000-000000000003','a2000000-0000-0000-0000-000000000004',
   'dd000000-0000-0000-0000-000000000003','enrichment_platform',0,'pending','{}',
   null,null,null,1,null,0,3,clock_timestamp());
insert into public.site_generation_media_slots(
 id,job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,status,effect_certainty,
 provider_reservation_id,provider_reserved_at
) values
 ('df000000-0000-0000-0000-000000000001','dc000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000004','bad-provider','video','hero','generated',true,false,
  'generating','indeterminate','df100000-0000-4000-8000-000000000001',clock_timestamp()),
 ('df000000-0000-0000-0000-000000000002','dc000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000004','exhausted-no-effect','video','hero','generated',true,false,
  'planned','not_started',null,null);
update public.background_jobs set scheduler_last_run_id='d9000000-0000-4000-8000-000000000002'
where status='pending' and id not in(
 'dc000000-0000-0000-0000-000000000001','dc000000-0000-0000-0000-000000000002',
 'dc000000-0000-0000-0000-000000000003');
select * from public.maintain_background_job_lifecycle(
  clock_timestamp()-interval '1 hour','d9000000-0000-4000-8000-000000000002',100
);
create temporary table bucket1_add_video_bystander_claim as select *
from public.claim_next_background_job('bucket1-add-video-quarantine',clock_timestamp()-interval '1 hour',2,
  'd9000000-0000-4000-8000-000000000002');
select pg_temp.assert_true(
  (select id='dc000000-0000-0000-0000-000000000003' from bucket1_add_video_bystander_claim)
  and (select status='failed' and error_message='add_video_retry_state_invalid'
    and result_json->>'status'='failed' and result_json->>'errorCode'='add_video_retry_state_invalid'
    from public.background_jobs where id='dc000000-0000-0000-0000-000000000001')
  and (select status='reconciliation_required' and effect_certainty='indeterminate'
    and reconciliation_required_at is not null and reconciliation_deadline>reconciliation_required_at
    and not cleanup_required from public.site_generation_media_slots
    where id='df000000-0000-0000-0000-000000000001')
  and (select status='failed' and error_message='add_video_retry_budget_exhausted'
    and result_json->>'status'='failed' and result_json->>'errorCode'='add_video_retry_budget_exhausted'
    from public.background_jobs where id='dc000000-0000-0000-0000-000000000002')
  and (select status='abandoned' and not cleanup_required and abandoned_at is not null
    from public.site_generation_media_slots where id='df000000-0000-0000-0000-000000000002')
  and (select count(*)=2 and count(*) filter(where cause_code='add_video_retry_state_invalid')=1
    and count(*) filter(where cause_code='add_video_retry_budget_exhausted')=1
    and bool_and(event_type='failed' and disposition='terminal_failure')
    from public.site_generation_attempt_events
    where job_id in('dc000000-0000-0000-0000-000000000001','dc000000-0000-0000-0000-000000000002')
      and event_key like '%:add-video-terminal'),
  'Add Video quarantine failed child closure, retry exhaustion, or unrelated dispatch');

-- assertion: a late claimant failure rolls back recovery atomically
insert into public.websites(id,user_id,status,environment,onboarding_state) values(
  'ce100000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',
  'draft','test','{"contactHidden":true,"scenario":"rollback-generation"}');
insert into public.conversations(id,user_id,website_id,phase) values(
  'ce200000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001',
  'ce100000-0000-0000-0000-000000000001','generation');
select pg_temp.insert_generation_fixture(
  'ce100000-0000-0000-0000-000000000001','ce200000-0000-0000-0000-000000000001',
  'ce300000-0000-0000-0000-000000000001','ce400000-0000-0000-0000-000000000001',
  'ce500000-0000-0000-0000-000000000001','ce600000-0000-0000-0000-000000000001',
  'ce700000-0000-0000-0000-000000000001','rollback-generation','media','running',0,null);
update public.background_jobs set locked_at=clock_timestamp()-interval '2 hours',
  lease_expires_at=clock_timestamp()-interval '1 minute'
where id='ce700000-0000-0000-0000-000000000001';
insert into public.site_generation_media_slots(
  id,job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,status,claim_epoch,
  effect_certainty
) values(
  'ce900000-0000-0000-0000-000000000001','ce700000-0000-0000-0000-000000000001',
  'ce100000-0000-0000-0000-000000000001','rollback-slot','image','hero','generated',true,false,
  'generating',1,'not_started');
insert into public.background_jobs(id,website_id,chain_id,job_type,sequence_index,status,payload_json,
  attempts,max_attempts,created_at) values(
  'ce800000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000004',
  'cf000000-0000-0000-0000-000000000001','enrichment_platform',0,'pending','{}',0,3,
  clock_timestamp()-interval '1 hour');
update public.background_jobs set scheduler_last_run_id='d9000000-0000-4000-8000-000000000003'
where status='pending' and id<>'ce800000-0000-0000-0000-000000000001';
create temporary table bucket1_rollback_stale as select to_jsonb(job) job_json
from public.background_jobs job where id='ce700000-0000-0000-0000-000000000001';
create temporary table bucket1_rollback_child as select to_jsonb(slot) slot_json
from public.site_generation_media_slots slot where id='ce900000-0000-0000-0000-000000000001';
create temporary table bucket1_rollback_candidate as select to_jsonb(job) job_json
from public.background_jobs job where id='ce800000-0000-0000-0000-000000000001';
create temporary table bucket1_rollback_dispatch as select to_jsonb(dispatch) dispatch_json
from public.background_job_dispatch_state dispatch where singleton;
select pg_temp.assert_true(not exists(
  select 1 from public.site_generation_attempt_events
  where event_key='ce700000-0000-0000-0000-000000000001:1:stale-recovery'),
  'rollback recovery event key was not fresh');
create function pg_temp.reject_claim_update() returns trigger language plpgsql as $$begin
  if new.status='running' and old.status='pending' and new.id='ce800000-0000-0000-0000-000000000001'
  then raise exception 'forced late claim failure' using errcode='P1234'; end if;
  return new;
end$$;
create trigger bucket1_reject_claim_update before update on public.background_jobs
for each row execute function pg_temp.reject_claim_update();
do $$ declare caught_state text; begin
  begin
    perform * from public.claim_next_background_job(
      'bucket1-rollback',clock_timestamp()-interval '1 hour',2,
      'd9000000-0000-4000-8000-000000000003');
    raise exception 'assertion failed: late claimant failure was not raised' using errcode='P0002';
  exception when sqlstate 'P1234' then
    get stacked diagnostics caught_state=returned_sqlstate;
    if caught_state<>'P1234' then raise exception 'assertion failed: expected P1234, got %',caught_state; end if;
  end;
end $$;
drop trigger bucket1_reject_claim_update on public.background_jobs;
select pg_temp.assert_true(
  (select to_jsonb(job)=(select job_json from bucket1_rollback_stale)
    from public.background_jobs job where id='ce700000-0000-0000-0000-000000000001')
  and (select to_jsonb(slot)=(select slot_json from bucket1_rollback_child)
    from public.site_generation_media_slots slot where id='ce900000-0000-0000-0000-000000000001')
  and not exists(select 1 from public.site_generation_attempt_events
    where event_key='ce700000-0000-0000-0000-000000000001:1:stale-recovery')
  and (select to_jsonb(job)=(select job_json from bucket1_rollback_candidate)
    from public.background_jobs job where id='ce800000-0000-0000-0000-000000000001')
  and (select to_jsonb(dispatch)=(select dispatch_json from bucket1_rollback_dispatch)
    from public.background_job_dispatch_state dispatch where singleton),
  'late claimant failure did not roll back generation recovery event, child, candidate, and dispatch state');
rollback;

do $$
begin
  if exists (
    select 1 from public.profiles
    where id = 'a1000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'assertion failed: transactional fixture rollback';
  end if;
end;
$$;

\echo 'bucket1-generation: all assertions passed'