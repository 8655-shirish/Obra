-- Remove the accidental storage-size ceilings from Bucket 1 generation inputs.
-- No frozen input, embedded checkpoint, or raw instruction content is truncated or projected.
-- The immutable snapshot, canonical byte count, hash, ownership fences, replay rules,
-- source revision fence, active-job uniqueness, and atomic handoff all remain exact.

update public.background_jobs job
set generation_tenant_id = website.user_id
from public.websites website
join public.agent_traces trace on trace.website_id=website.id
where job.job_type='site_generation'
  and job.generation_contract_epoch>=2
  and job.website_id=website.id
  and trace.id=job.agent_trace_id
  and trace.profile_id=website.user_id
  and job.generation_tenant_id is null;

do $$
begin
  if exists (
    select 1
    from public.background_jobs job
    left join public.websites website on website.id=job.website_id
    left join public.agent_traces trace on trace.id=job.agent_trace_id
    where job.job_type='site_generation'
      and job.generation_contract_epoch>=2
      and (job.generation_tenant_id is null
        or job.generation_tenant_id is distinct from website.user_id
        or job.generation_tenant_id is distinct from trace.profile_id)
  ) then
    raise exception 'Existing epoch-2 generation tenant identity is missing or inconsistent'
      using errcode='23514';
  end if;
end;
$$;

alter table public.background_jobs
  drop constraint if exists background_jobs_generation_input_snapshot_check,
  drop constraint if exists background_jobs_generation_checkpoint_check,
  drop constraint if exists background_jobs_generation_identity_check;

alter table public.background_jobs
  add constraint background_jobs_generation_input_snapshot_check check (
    generation_input_snapshot is null
    or jsonb_typeof(generation_input_snapshot) = 'object'
  ),
  add constraint background_jobs_generation_checkpoint_check check (
    generation_checkpoint is null
    or jsonb_typeof(generation_checkpoint) = 'object'
  ),
  add constraint background_jobs_generation_identity_check check (
    job_type <> 'site_generation'
    or generation_contract_epoch < 2
    or (
      generation_tenant_id is not null
      and generation_request_id is not null
      and request_id is not null
      and request_id = generation_request_id
      and nullif(btrim(generation_request_hash), '') is not null
      and generation_kind in ('initial','regeneration')
      and generation_contract_version = 2
      and generation_stage in ('context','planning','media','composition','validation','persistence')
      and generation_input_version = 1
      and generation_input_snapshot is not null
      and jsonb_typeof(generation_input_snapshot) = 'object'
      and generation_request_hash ~ '^[0-9a-f]{64}$'
      and generation_input_snapshot->>'requestPayloadHash' is not distinct from generation_request_hash
      and generation_input_hash is not null
      and generation_input_hash ~ '^[0-9a-f]{64}$'
      and generation_input_hash = encode(extensions.digest(convert_to(generation_input_snapshot::text, 'UTF8'), 'sha256'), 'hex')
      and generation_accepted_at is not null
      and generation_checkpoint is not null
      and jsonb_typeof(generation_checkpoint) = 'object'
      and jsonb_typeof(generation_checkpoint->'inputSizeBytes') is not distinct from 'number'
      and generation_checkpoint->>'inputSizeBytes' ~ '^\d+$'
      and (generation_checkpoint->>'inputSizeBytes')::numeric <= 9007199254740991
      and (generation_checkpoint->>'inputSizeBytes')::numeric =
        octet_length(convert_to(generation_input_snapshot::text, 'UTF8'))
      and generation_checkpoint->'input' is not distinct from generation_input_snapshot
      and generation_checkpoint->>'inputHash' is not distinct from generation_input_hash
      and (generation_checkpoint->>'acceptedAt')::timestamptz is not distinct from generation_accepted_at
      and (
        (generation_kind = 'initial' and source_version_id is null and source_revision is null)
        or
        (generation_kind = 'regeneration' and source_version_id is not null and source_revision is not null and source_revision >= 0)
      )
    )
  ) not valid;

alter table public.background_jobs
  validate constraint background_jobs_generation_identity_check;

create or replace function public.guard_site_generation_frozen_input()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.job_type = 'site_generation' and new.generation_contract_epoch >= 2
     and (new.generation_tenant_id is null
       or new.generation_tenant_id is distinct from (
         select website.user_id from public.websites website where website.id=new.website_id
       )
       or new.generation_tenant_id is distinct from (
         select trace.profile_id from public.agent_traces trace where trace.id=new.agent_trace_id
       )) then
    raise exception 'Generation tenant identity is missing or inconsistent' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.job_type = 'site_generation' and old.generation_contract_epoch >= 2
     and (
       new.website_id is distinct from old.website_id
       or new.chain_id is distinct from old.chain_id
       or new.request_id is distinct from old.request_id
       or new.generation_request_id is distinct from old.generation_request_id
       or new.generation_request_hash is distinct from old.generation_request_hash
       or new.generation_tenant_id is distinct from old.generation_tenant_id
       or new.generation_kind is distinct from old.generation_kind
       or new.source_version_id is distinct from old.source_version_id
       or new.source_revision is distinct from old.source_revision
       or new.generation_contract_epoch is distinct from old.generation_contract_epoch
       or new.generation_contract_version is distinct from old.generation_contract_version
       or new.generation_input_version is distinct from old.generation_input_version
       or new.generation_input_snapshot is distinct from old.generation_input_snapshot
       or new.generation_input_hash is distinct from old.generation_input_hash
       or new.generation_accepted_at is distinct from old.generation_accepted_at
       or new.agent_trace_id is distinct from old.agent_trace_id
       or (old.generation_handoff_message_id is not null
         and new.generation_handoff_message_id is distinct from old.generation_handoff_message_id)
     ) then
    raise exception 'Accepted generation input and identity are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_site_generation_frozen_input()
  from public, anon, authenticated;

drop trigger if exists background_jobs_guard_site_generation_frozen_input on public.background_jobs;
create trigger background_jobs_guard_site_generation_frozen_input
before insert or update on public.background_jobs
for each row execute function public.guard_site_generation_frozen_input();

create or replace function public.enqueue_site_generation_job(
  p_website_id uuid,
  p_idempotency_key text,
  p_payload_json jsonb,
  p_replay_completed boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  existing_job public.background_jobs%rowtype;
  trace public.agent_traces%rowtype;
  new_chain uuid := gen_random_uuid();
  new_job_id uuid;
  requested_id uuid;
  requested_hash text;
  requested_kind text;
  requested_source_id uuid;
  requested_source_revision bigint;
  generation_tenant_id uuid;
  checkpoint jsonb;
  onboarding_input jsonb;
  enrichment_input jsonb;
  source_config_input jsonb;
  source_media_input jsonb := '[]'::jsonb;
  recent_versions_input jsonb := '[]'::jsonb;
  cross_site_identities_input jsonb := '[]'::jsonb;
  frozen_input jsonb;
  frozen_input_hash text;
  accepted_at timestamptz := clock_timestamp();
begin
  if p_website_id is null or nullif(btrim(p_idempotency_key), '') is null
     or jsonb_typeof(p_payload_json) is distinct from 'object'
     or p_payload_json->>'generationMode' <> 'unified'
     or p_payload_json->>'generationStage' <> 'context'
     or jsonb_typeof(p_payload_json->'generationContractVersion') is distinct from 'number'
     or p_payload_json->>'generationContractVersion' <> '2'
     or p_payload_json ? 'executionMode'
     or p_payload_json ? '_agentRequestId'
     or p_payload_json ? '_agentHandoffMessageId'
     or p_payload_json ? '_agentTerminalMessageFinalizedAt'
     or p_payload_json->>'generationKind' not in ('initial','regeneration')
     or (p_payload_json - array[
       'generationKind','generationMode','generationStage','generationContractVersion',
       'sourceVersionId','sourceRevision'
     ]) <> '{}'::jsonb then
    raise exception 'Site generation payload is malformed' using errcode = '22023';
  end if;

  begin
    requested_id := p_idempotency_key::uuid;
  exception when invalid_text_representation then
    raise exception 'Site generation request identity must be a UUID' using errcode = '22023';
  end;

  requested_kind := p_payload_json->>'generationKind';
  if requested_kind = 'regeneration' then
    if jsonb_typeof(p_payload_json->'sourceVersionId') is distinct from 'string'
       or jsonb_typeof(p_payload_json->'sourceRevision') is distinct from 'number'
       or p_payload_json->>'sourceRevision' !~ '^\d+$' then
      raise exception 'Regeneration source snapshot is malformed' using errcode = '22023';
    end if;
    begin
      requested_source_id := (p_payload_json->>'sourceVersionId')::uuid;
      requested_source_revision := (p_payload_json->>'sourceRevision')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Regeneration source snapshot is malformed' using errcode = '22023';
    end;
  elsif p_payload_json ? 'sourceVersionId' or p_payload_json ? 'sourceRevision' then
    raise exception 'Initial generation cannot include a source snapshot' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation', 0));

  -- Exact replay consults only the immutable accepted row. It must not depend on a
  -- mutable/replaced trace, website profile, source row, or prior-version sample.
  select * into existing_job
  from public.background_jobs
  where website_id = p_website_id
    and job_type = 'site_generation'
    and generation_request_id = requested_id
  order by created_at desc, id desc
  limit 1;
  if found then
    if existing_job.generation_kind is distinct from requested_kind
       or existing_job.source_version_id is distinct from requested_source_id
       or existing_job.source_revision is distinct from requested_source_revision
       or existing_job.generation_contract_epoch <> 2
       or existing_job.generation_contract_version <> 2
       or existing_job.generation_input_version <> 1
       or existing_job.generation_input_snapshot is null
       or existing_job.generation_input_hash !~ '^[0-9a-f]{64}$'
       or existing_job.generation_input_hash is distinct from encode(
         extensions.digest(convert_to(existing_job.generation_input_snapshot::text, 'UTF8'), 'sha256'), 'hex'
       ) then
      raise exception 'Request identity was already used for a different generation request'
        using errcode = '23505';
    end if;
    if existing_job.status in ('pending','running','finalizing')
       or p_replay_completed then
      return existing_job.chain_id;
    end if;
    raise exception 'Terminal generation replay was not requested' using errcode = 'P0001';
  end if;

  select * into trace
  from public.agent_traces
  where website_id = p_website_id and request_id = requested_id
  order by started_at desc nulls last, id desc
  limit 1;
  if not found or trace.request_payload_hash is null or trace.trigger_message is null then
    raise exception 'Site generation requires an attributable trace with an exact raw instruction'
      using errcode = 'P0001';
  end if;
  requested_hash := trace.request_payload_hash;
  if requested_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Agent turn request payload hash is malformed' using errcode = '22023';
  end if;

  if trace.source_version_id is distinct from requested_source_id
     or trace.source_revision is distinct from requested_source_revision then
    raise exception 'Site generation source snapshot does not match agent turn' using errcode = 'P0001';
  end if;

  select coalesce(website.onboarding_state, '{}'::jsonb), website.user_id
  into onboarding_input, generation_tenant_id
  from public.websites website
  where website.id = p_website_id
  for share;
  if not found then
    raise exception 'Website not found' using errcode = 'P0001';
  end if;
  if generation_tenant_id is null or trace.profile_id is distinct from generation_tenant_id then
    raise exception 'Site generation tenant identity does not match attributable trace'
      using errcode = 'P0001';
  end if;

  select coalesce(profile.enrichment_json, '{}'::jsonb)
  into enrichment_input
  from public.contractor_profiles profile
  where profile.website_id = p_website_id
  for share;
  enrichment_input := coalesce(enrichment_input, '{}'::jsonb);

  if requested_kind = 'initial' then
    if exists (select 1 from public.website_versions where website_id = p_website_id) then
      raise exception 'Regeneration requires a scoped source version and revision snapshot' using errcode = 'P0001';
    end if;
    source_config_input := null;
  else
    select version.config_json
    into source_config_input
    from public.website_versions version
    where version.id = requested_source_id and version.website_id = p_website_id
      and version.revision = requested_source_revision
    for share;
    if not found then
      raise exception 'Regeneration source snapshot does not match' using errcode = 'P0001';
    end if;

    -- Lock the exact source slot set before copying it so config/revision and media are
    -- frozen as one protected acceptance-time source snapshot.
    perform 1
    from public.website_version_media_slots slot
    where slot.website_id = p_website_id and slot.version_id = requested_source_id
    order by slot.id
    for share;

    select coalesce(jsonb_agg(jsonb_build_object(
      'slotId', slot.slot_id, 'assetId', slot.asset_id, 'mimeType', slot.mime_type,
      'role', slot.role, 'origin', slot.provenance, 'required', slot.required,
      'proofEligible', slot.proof_eligible, 'storagePath', slot.storage_path,
      'sourceSlotId', slot.source_slot_id, 'posterSlotId', slot.poster_slot_id
    ) order by slot.slot_id), '[]'::jsonb)
    into source_media_input
    from public.website_version_media_slots slot
    where slot.website_id = p_website_id and slot.version_id = requested_source_id;
  end if;

  select coalesce(jsonb_agg(summary.item order by summary.version_number desc), '[]'::jsonb)
  into recent_versions_input
  from (
    select version.version_number, jsonb_build_object(
      'versionId', version.id, 'versionNumber', version.version_number,
      'revision', version.revision, 'variantKey', version.variant_key,
      'generator', version.config_json->'generator',
      'generatorSchemaVersion', version.config_json->'generatorSchemaVersion',
      'recipeId', version.config_json->'recipeId',
      'recipeVersion', version.config_json->'recipeVersion',
      'designIntent', version.config_json#>'{designSpec,designIntent}',
      'layoutFingerprint', coalesce(
        version.config_json->'layoutFingerprint',
        version.config_json#>'{unifiedBrief,layoutFingerprint}'
      ),
      'priorSummary', left(coalesce(
        version.config_json->>'priorVariantSummary',
        version.config_json#>>'{unifiedBrief,creativeBrief,summary}',
        ''
      ), 4000),
      'configHash', encode(
        extensions.digest(convert_to(version.config_json::text, 'UTF8'), 'sha256'), 'hex'
      ),
      'summaryInputs', jsonb_build_object(
        'layoutHint', version.config_json->'layoutHint',
        'heroLayout', version.config_json->'heroLayout',
        'componentIds', version.config_json->'component_ids',
        'sections', version.config_json->'sections',
        'designSpec', version.config_json->'designSpec',
        'unifiedBrief', version.config_json->'unifiedBrief'
      )
    ) as item
    from public.website_versions version
    where version.website_id = p_website_id
    order by version.version_number desc
    limit 4
  ) summary;

  select coalesce(jsonb_agg(sample.item order by sample.updated_at desc, sample.website_id), '[]'::jsonb)
  into cross_site_identities_input
  from (
    select sampled_website.id as website_id, sampled_website.updated_at,
      jsonb_build_object(
        'websiteId', sampled_website.id,
        'versionId', version.id,
        'versionNumber', version.version_number,
        'layoutFingerprint', version.config_json->'layoutFingerprint'
      ) as item
    from public.websites sampled_website
    join public.website_versions version
      on version.id = sampled_website.active_version_id
     and version.website_id = sampled_website.id
     and version.status = 'live'
    where sampled_website.id <> p_website_id
      and sampled_website.status = 'live'
      and sampled_website.active_version_id is not null
    order by sampled_website.updated_at desc, sampled_website.id
    limit 12
  ) sample;

  frozen_input := jsonb_build_object(
    'schemaVersion', 1,
    'normalizerVersion', 'bucket1-context-v1',
    'generationKind', requested_kind,
    'sourceVersionId', requested_source_id,
    'sourceRevision', requested_source_revision,
    'sourceConfig', source_config_input,
    'sourceMedia', source_media_input,
    'onboarding', onboarding_input,
    'enrichment', enrichment_input,
    'contactPolicy', jsonb_build_object(
      'schemaVersion', 1,
      'source', 'websites.onboarding_state.contactHidden',
      'sourcePresent', onboarding_input ? 'contactHidden',
      'sourceValue', onboarding_input->'contactHidden',
      'contactHidden', onboarding_input->'contactHidden' = 'true'::jsonb,
      'privacyClassification', 'generation-private',
      'privacySource', 'server-generation-storage-policy-v1',
      'capturedAtAcceptance', true
    ),
    'instruction', coalesce(trace.trigger_message, ''),
    'instructionByteLength', octet_length(convert_to(coalesce(trace.trigger_message, ''), 'UTF8')),
    'requestPayloadHash', requested_hash,
    'priorIdentities', recent_versions_input,
    'crossSiteLayoutIdentities', cross_site_identities_input
  );
  frozen_input_hash := encode(extensions.digest(convert_to(frozen_input::text, 'UTF8'), 'sha256'), 'hex');

  if trace.status <> 'running' then
    raise exception 'Agent turn is not active for a new generation request' using errcode = '40001';
  end if;

  if exists (
    select 1 from public.background_jobs
    where website_id = p_website_id and job_type = 'site_generation'
      and status in ('pending','running','finalizing')
  ) then
    raise exception 'A site generation job is already active for this website'
      using errcode = '55000';
  end if;

  checkpoint := jsonb_build_object(
    'schemaVersion',2,
    'stage','context',
    'acceptedAt',accepted_at,
    'inputHash',frozen_input_hash,
    'inputSizeBytes',octet_length(convert_to(frozen_input::text, 'UTF8')),
    'input',frozen_input
  );

  insert into public.background_jobs(
    website_id, chain_id, job_type, sequence_index, platform, status,
    progress_pct, status_message, payload_json, idempotency_key,
    request_id, generation_request_id, generation_request_hash, generation_tenant_id,
    generation_kind, source_version_id, source_revision,
    generation_contract_epoch, generation_contract_version,
    generation_stage, generation_input_version, generation_input_snapshot,
    generation_input_hash, generation_accepted_at, generation_checkpoint, agent_trace_id,
    claim_epoch, lease_expires_at
  ) values (
    p_website_id, new_chain, 'site_generation', 0, null, 'pending',
    0, 'Queued site generation…', p_payload_json, p_idempotency_key,
    requested_id, requested_id, requested_hash, generation_tenant_id,
    requested_kind, requested_source_id, requested_source_revision,
    2, 2, 'context', 1, frozen_input,
    frozen_input_hash, accepted_at, checkpoint, trace.id,
    0, null
  ) returning id into new_job_id;

  return new_chain;
end;
$$;

-- The trace-owned wrapper remains the only executable admission surface.
revoke all on function public.enqueue_site_generation_job(uuid,text,jsonb,boolean)
  from public, anon, authenticated, service_role;

create or replace function public.yield_site_generation_stage_epoch(
  p_job_id uuid,p_claim_epoch bigint,p_contract_epoch integer,p_stage text,p_checkpoint jsonb,
  p_progress_pct integer,p_status_message text,p_event_key text,p_runner_id text default null,
  p_invocation_id uuid default null,p_deployment_id text default null
) returns boolean
language plpgsql security definer set search_path=public as $$
declare current_job public.background_jobs%rowtype; completed_stage text; next_attempt integer;
begin
  if p_contract_epoch<>2 or p_stage not in ('context','planning','media','composition','validation','persistence')
     or jsonb_typeof(p_checkpoint) is distinct from 'object'
     or p_checkpoint->>'schemaVersion'<>'2' or p_checkpoint->>'stage' is distinct from p_stage
     or p_progress_pct<0 or p_progress_pct>99 or nullif(btrim(p_event_key),'') is null then
    raise exception 'Invalid site generation yield' using errcode='22023';
  end if;
  select * into current_job from public.background_jobs where id=p_job_id and job_type='site_generation' for update;
  if not found or current_job.status<>'running' or current_job.generation_contract_epoch<>2
     or current_job.claim_epoch<>p_claim_epoch or current_job.lease_expires_at<=clock_timestamp()
     or nullif(btrim(current_job.locked_by),'') is null
     or (p_runner_id is not null and current_job.locked_by<>p_runner_id)
     or p_checkpoint->'input' is distinct from current_job.generation_input_snapshot
     or jsonb_typeof(p_checkpoint->'inputSizeBytes') is distinct from 'number'
     or p_checkpoint->>'inputSizeBytes' !~ '^\d+$'
     or (p_checkpoint->>'inputSizeBytes')::numeric > 9007199254740991
     or (p_checkpoint->>'inputSizeBytes')::numeric is distinct from
       octet_length(convert_to(current_job.generation_input_snapshot::text,'UTF8'))
     or p_checkpoint->>'inputHash' is distinct from current_job.generation_input_hash
     or (p_checkpoint->>'acceptedAt')::timestamptz is distinct from current_job.generation_accepted_at
     or not ((current_job.generation_stage='context' and p_stage='planning')
       or (current_job.generation_stage='planning' and p_stage='media')
       or (current_job.generation_stage='media' and p_stage in ('media','composition'))
       or (current_job.generation_stage='composition' and p_stage='validation')
       or (current_job.generation_stage='validation' and p_stage='persistence')) then
    return false;
  end if;
  completed_stage:=current_job.generation_stage;
  next_attempt:=coalesce((current_job.stage_attempt_counts->>p_stage)::integer,0);
  update public.background_jobs set status='pending',locked_at=null,locked_by=null,lease_expires_at=null,
    next_retry_at=clock_timestamp(),completed_at=null,progress_pct=p_progress_pct,status_message=p_status_message,
    generation_stage=p_stage,generation_checkpoint=p_checkpoint,stage_attempts=next_attempt,
    payload_json=(payload_json-'executionMode')||jsonb_build_object('generationMode','unified','generationContractVersion',2,'generationStage',p_stage)
  where id=p_job_id;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,event_type,
    effect_certainty,disposition,severity,blocking,runner_id,invocation_id,deployment_id,completed_at,details
  ) values(p_event_key,p_job_id,current_job.website_id,current_job.generation_request_id,2,p_claim_epoch,
    p_stage,next_attempt,'yielded','not_started','resume','info',false,current_job.locked_by,p_invocation_id,
    p_deployment_id,clock_timestamp(),jsonb_build_object('completedStage',completed_stage,'nextStage',p_stage))
  on conflict(event_key) do nothing;
  return true;
end; $$;
revoke all on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text) to service_role;
comment on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text) is
  'Service-only monotonic epoch-2 stage yield with immutable checkpoint envelope validation and per-stage budget projection.';

create or replace function public.settle_site_generation_epoch(
  p_job_id uuid,p_claim_epoch bigint,p_contract_epoch integer,p_status text,p_progress_pct integer,
  p_result_json jsonb,p_checkpoint jsonb,p_error_message text,p_status_message text,
  p_next_retry_at timestamptz,p_effect_certainty text,p_cause_code text,p_event_key text,
  p_budget_type text,p_runner_id text default null,p_invocation_id uuid default null,
  p_deployment_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  current_job public.background_jobs%rowtype;
  prior_stage text;
  requested_stage text;
  stage_before integer;
  stage_after integer;
  event_type_value text;
  disposition_value text;
  terminal_payload jsonb;
  terminal_text text;
begin
  if p_contract_epoch <> 2
     or p_status not in ('pending','failed')
     or p_progress_pct < 0 or p_progress_pct > 100
     or jsonb_typeof(p_checkpoint) is distinct from 'object'
     or p_checkpoint->>'schemaVersion' <> '2'
     or p_checkpoint->>'stage' not in ('context','planning','media','composition','validation','persistence')
     or p_effect_certainty not in ('none','not_started','definite_failure','indeterminate')
     or nullif(btrim(p_event_key),'') is null
     or p_budget_type not in ('interruption','stage_attempt','writer_repair')
     or (p_status='pending' and p_next_retry_at is null)
     or (p_status='failed' and p_next_retry_at is not null) then
    raise exception 'Invalid site generation settlement' using errcode='22023';
  end if;

  select * into current_job from public.background_jobs where id=p_job_id for update;
  if not found
     or current_job.job_type <> 'site_generation'
     or current_job.status <> 'running'
     or current_job.generation_contract_epoch <> 2
     or current_job.claim_epoch <> p_claim_epoch
     or current_job.lease_expires_at is null
     or current_job.lease_expires_at <= clock_timestamp()
     or nullif(btrim(current_job.locked_by),'') is null
     or (p_runner_id is not null and current_job.locked_by <> p_runner_id)
     or p_checkpoint->'input' is distinct from current_job.generation_input_snapshot
     or jsonb_typeof(p_checkpoint->'inputSizeBytes') is distinct from 'number'
     or p_checkpoint->>'inputSizeBytes' !~ '^\d+$'
     or (p_checkpoint->>'inputSizeBytes')::numeric > 9007199254740991
     or (p_checkpoint->>'inputSizeBytes')::numeric is distinct from
       octet_length(convert_to(current_job.generation_input_snapshot::text,'UTF8'))
     or p_checkpoint->>'inputHash' is distinct from current_job.generation_input_hash
     or (p_checkpoint->>'acceptedAt')::timestamptz is distinct from current_job.generation_accepted_at then
    return false;
  end if;

  prior_stage := current_job.generation_stage;
  requested_stage := p_checkpoint->>'stage';
  if not (
    requested_stage=prior_stage
    or (prior_stage='validation' and requested_stage='composition'
      and p_status='pending' and p_budget_type='writer_repair'
      and jsonb_typeof(p_checkpoint->'defects')='array'
      and jsonb_array_length(p_checkpoint->'defects')>0)
  ) then
    return false;
  end if;

  stage_before := coalesce((current_job.stage_attempt_counts->>requested_stage)::integer,0);
  stage_after := stage_before + case when p_budget_type='stage_attempt' then 1 else 0 end;
  if p_status='pending' and (
       (p_budget_type='stage_attempt' and stage_after>=3)
       or (p_budget_type='writer_repair' and current_job.repair_attempts+1>=3)
       or (p_budget_type='interruption' and current_job.interruption_count+1>=5)
     ) then
    p_status := 'failed';
    p_next_retry_at := null;
    p_status_message := 'Generation retry budget exhausted';
  end if;
  if p_status='failed' then
    terminal_text := 'We could not finish this website. Please try again.';
    terminal_payload := jsonb_build_object(
      'schemaVersion',1,'kind','site-generation-terminal','status','failed',
      'jobId',p_job_id,'requestId',current_job.generation_request_id,
      'claimEpoch',p_claim_epoch,'message',terminal_text,'causeCode',p_cause_code
    );
    update public.messages set content=terminal_text
    where id=current_job.generation_handoff_message_id
      and trace_id=current_job.agent_trace_id and role='assistant';
    if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;
    update public.agent_traces set status='error',error_message=left(p_error_message,1000),
      completed_at=coalesce(completed_at,clock_timestamp())
    where id=current_job.agent_trace_id and website_id=current_job.website_id
      and status in ('running','completed','error');
    if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;
  end if;

  update public.background_jobs set
    status=p_status,progress_pct=p_progress_pct,result_json=p_result_json,
    generation_stage=requested_stage,generation_checkpoint=p_checkpoint,
    error_message=p_error_message,status_message=p_status_message,
    completed_at=case when p_status='failed' then clock_timestamp() else null end,
    next_retry_at=p_next_retry_at,locked_at=null,locked_by=null,lease_expires_at=null,
    interruption_count=interruption_count + case when p_budget_type='interruption' then 1 else 0 end,
    stage_attempts=stage_after,
    stage_attempt_counts=case when p_budget_type='stage_attempt'
      then jsonb_set(stage_attempt_counts,array[requested_stage],to_jsonb(stage_after),true)
      else stage_attempt_counts end,
    repair_attempts=repair_attempts + case when p_budget_type='writer_repair' then 1 else 0 end,
    generation_terminal_message_id=case when p_status='failed' then current_job.generation_handoff_message_id else generation_terminal_message_id end,
    generation_terminal_message_payload=case when p_status='failed' then terminal_payload else generation_terminal_message_payload end,
    generation_terminal_message_at=case when p_status='failed' then clock_timestamp() else generation_terminal_message_at end
  where id=p_job_id;

  event_type_value := case when p_status='failed' then 'failed' else 'retry_scheduled' end;
  disposition_value := case when p_status='failed' then 'terminal_failure' else 'retry' end;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,budget_type,
    budget_before,budget_after,runner_id,invocation_id,deployment_id,completed_at,details
  ) values (
    p_event_key,current_job.id,current_job.website_id,current_job.generation_request_id,2,p_claim_epoch,
    requested_stage,stage_after,event_type_value,p_cause_code,p_effect_certainty,disposition_value,
    case when p_status='failed' then 'error' else 'info' end,p_status='failed',p_budget_type,
    case p_budget_type when 'interruption' then current_job.interruption_count
      when 'writer_repair' then current_job.repair_attempts else stage_before end,
    case p_budget_type when 'interruption' then current_job.interruption_count+1
      when 'writer_repair' then current_job.repair_attempts+1 else stage_after end,
    current_job.locked_by,p_invocation_id,p_deployment_id,clock_timestamp(),
    jsonb_build_object('priorStage',prior_stage,'requestedStage',requested_stage)
  ) on conflict(event_key) do nothing;
  return true;
end;
$$;

revoke all on function public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)
  to service_role;
comment on function public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text) is
  'Service-only epoch-2 retry/failure settlement. Success is exclusive to the atomic version finalizer. Validation repair may rewind only validation to composition; ordinary same-stage yield remains monotonic.';
