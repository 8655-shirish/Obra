-- Admit gacha generation (contract version 3) alongside in-flight planner jobs
-- (contract version 2). New jobs may pass optional gachaId / gachaFilter.
-- Frozen prior identities include stored gacha ids for regen exclusion.
-- Planning may yield planning while waiting on scrape (same class as media→media).
-- Forward-only: copy the live enqueue_site_generation_job body from
-- 20260831010000. Do not rewrite applied migrations. Owned wrapper is unchanged.

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
     or p_payload_json->>'generationContractVersion' not in ('2','3')
     or p_payload_json ? 'executionMode'
     or p_payload_json ? '_agentRequestId'
     or p_payload_json ? '_agentHandoffMessageId'
     or p_payload_json ? '_agentTerminalMessageFinalizedAt'
     or p_payload_json->>'generationKind' not in ('initial','regeneration')
     or (p_payload_json->>'generationContractVersion' = '2'
         and (p_payload_json ? 'gachaId' or p_payload_json ? 'gachaFilter'))
     or (p_payload_json ? 'gachaId'
         and (jsonb_typeof(p_payload_json->'gachaId') is distinct from 'string'
              or length(p_payload_json->>'gachaId') < 1
              or length(p_payload_json->>'gachaId') > 64))
     or (p_payload_json ? 'gachaFilter'
         and (jsonb_typeof(p_payload_json->'gachaFilter') is distinct from 'array'
              or jsonb_array_length(p_payload_json->'gachaFilter') > 8
              or exists (
                select 1
                from jsonb_array_elements(p_payload_json->'gachaFilter') tag
                where jsonb_typeof(tag) is distinct from 'string'
                   or tag #>> '{}' not in (
                     'premium','minimal','photo-led','bold','warm','editorial',
                     'utilitarian','playful','craft','cinematic'
                   )
              )))
     or (p_payload_json - array[
       'generationKind','generationMode','generationStage','generationContractVersion',
       'sourceVersionId','sourceRevision','gachaId','gachaFilter'
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
       or existing_job.generation_contract_version
            <> (p_payload_json->>'generationContractVersion')::int
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
    order by slot.slot_id
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
      'gacha', version.config_json->'gacha',
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
      'contactHidden', coalesce((onboarding_input->'contactHidden') = 'true'::jsonb, false),
      'privacyClassification', 'generation-private',
      'privacySource', 'server-generation-storage-policy-v1',
      'capturedAtAcceptance', true
    ),
    'instruction', '',
    'instructionByteLength', 0,
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
    2, (p_payload_json->>'generationContractVersion')::int, 'context', 1, frozen_input,
    frozen_input_hash, accepted_at, checkpoint, trace.id,
    0, null
  ) returning id into new_job_id;

  return new_chain;
end;
$$;

revoke all on function public.enqueue_site_generation_job(uuid,text,jsonb,boolean)
  from public, anon, authenticated, service_role;

-- Same-stage planning yield is the scrape-wait seam (media already yields
-- media→media). Keep generationContractVersion from the job column so a
-- contract-3 wait does not rewrite the payload to 2.
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
       or (current_job.generation_stage='planning' and p_stage in ('planning','media'))
       or (current_job.generation_stage='media' and p_stage in ('media','composition'))
       or (current_job.generation_stage='composition' and p_stage in ('validation','persistence'))
       or (current_job.generation_stage='validation' and p_stage='persistence')) then
    return false;
  end if;
  completed_stage:=current_job.generation_stage;
  next_attempt:=coalesce((current_job.stage_attempt_counts->>p_stage)::integer,0);
  update public.background_jobs set status='pending',locked_at=null,locked_by=null,lease_expires_at=null,
    next_retry_at=clock_timestamp(),completed_at=null,progress_pct=p_progress_pct,status_message=p_status_message,
    generation_stage=p_stage,generation_checkpoint=p_checkpoint,stage_attempts=next_attempt,
    payload_json=(payload_json-'executionMode')||jsonb_build_object(
      'generationMode','unified',
      'generationContractVersion',current_job.generation_contract_version,
      'generationStage',p_stage)
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
  'Service-only monotonic epoch-2 stage yield. Planning may yield planning while waiting on scrape; media may yield media. Composition may yield directly to persistence.';
