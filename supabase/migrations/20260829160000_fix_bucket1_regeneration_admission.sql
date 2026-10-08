-- Repair deterministic Bucket-1 regeneration admission against the deployed schema.
-- Forward-only: preserve exact frozen input, ownership, request identity, source fencing,
-- active-job uniqueness, atomic handoff, and replay semantics.

-- The prior migration created a canonical insert/update trigger without dropping the older
-- update-only trigger name. Converge to exactly one trigger before replacing admission.
drop trigger if exists guard_site_generation_frozen_input on public.background_jobs;
drop trigger if exists background_jobs_guard_site_generation_frozen_input on public.background_jobs;
create trigger background_jobs_guard_site_generation_frozen_input
before insert or update on public.background_jobs
for each row execute function public.guard_site_generation_frozen_input();

-- Regeneration source attachments are keyed by (version_id, slot_id); there is no slot.id.
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

-- Keep the internal base function inaccessible; admission remains trace-owner-only.
revoke all on function public.enqueue_site_generation_job(uuid,text,jsonb,boolean)
  from public, anon, authenticated, service_role;

-- Qualify every queried table column because RETURNS TABLE names are PL/pgSQL variables.
create or replace function public.enqueue_site_generation_job_owned(
  p_website_id uuid,
  p_idempotency_key text,
  p_payload_json jsonb,
  p_trace_id uuid,
  p_owner_token uuid,
  p_replay_completed boolean default false
) returns table(chain_id uuid, assistant_message_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  returned_chain_id uuid;
  owned_trace public.agent_traces%rowtype;
  generation_job public.background_jobs%rowtype;
  handoff_message_id uuid;
begin
  if p_trace_id is null or p_owner_token is null then
    raise exception 'Site generation trace ownership is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  select trace.* into owned_trace
  from public.agent_traces as trace
  where trace.id = p_trace_id and trace.website_id = p_website_id
    and trace.owner_token = p_owner_token
  for update;
  if not found then
    raise exception 'Agent turn ownership lost' using errcode = '40001';
  end if;
  if owned_trace.request_id is null
     or owned_trace.request_id::text is distinct from p_idempotency_key
     or owned_trace.request_payload_hash is null then
    raise exception 'Site generation request identity does not match agent turn'
      using errcode = 'P0001';
  end if;

  -- Replay is authorized by the immutable trace/request binding copied onto the accepted
  -- job. Do not reread a mutable trace or any other acceptance source after commit.
  select job.* into generation_job
  from public.background_jobs as job
  where job.website_id = p_website_id
    and job.job_type = 'site_generation'
    and job.generation_request_id::text = p_idempotency_key
  order by job.created_at desc, job.id desc
  limit 1;
  if found then
    if generation_job.agent_trace_id is distinct from p_trace_id
       or generation_job.generation_request_hash is distinct from owned_trace.request_payload_hash then
      raise exception 'Site generation chain is already bound to another agent trace or instruction'
        using errcode = 'P0001';
    end if;
    returned_chain_id := public.enqueue_site_generation_job(
      p_website_id, p_idempotency_key, p_payload_json, p_replay_completed
    );
    handoff_message_id := generation_job.generation_handoff_message_id;
    if handoff_message_id is null then
      raise exception 'Accepted generation handoff identity is missing' using errcode = 'P0001';
    end if;
    return query select returned_chain_id, handoff_message_id;
    return;
  end if;

  returned_chain_id := public.enqueue_site_generation_job(
    p_website_id, p_idempotency_key, p_payload_json, p_replay_completed
  );

  select job.* into strict generation_job
  from public.background_jobs as job
  where job.website_id = p_website_id and job.chain_id = returned_chain_id
    and job.job_type = 'site_generation' and job.sequence_index = 0
  for update;

  if generation_job.agent_trace_id is distinct from p_trace_id then
    raise exception 'Site generation chain is already bound to another agent trace'
      using errcode = 'P0001';
  end if;

  handoff_message_id := generation_job.generation_handoff_message_id;
  if handoff_message_id is null then
    insert into public.messages(conversation_id, role, content, trace_id)
    values (owned_trace.conversation_id, 'assistant', 'Building your website…', p_trace_id)
    returning id into handoff_message_id;

    update public.background_jobs as job
    set generation_handoff_message_id = handoff_message_id
    where job.id = generation_job.id and job.generation_handoff_message_id is null;
  elsif not exists (
    select 1 from public.messages as message
    where message.id = handoff_message_id and message.trace_id = p_trace_id
      and message.role = 'assistant'
  ) then
    raise exception 'Site generation handoff identity is invalid' using errcode = 'P0001';
  end if;

  return query select returned_chain_id, handoff_message_id;
end;
$$;

revoke all on function public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)
  to service_role;

-- The administrative successor wrapper also RETURNS TABLE(chain_id, ...). Qualify every
-- background_jobs column so its output variables cannot collide with relation columns.
create or replace function public.supersede_and_enqueue_site_generation_job_owned(
  p_website_id uuid,p_predecessor_job_id uuid,p_predecessor_request_id uuid,
  p_predecessor_claim_epoch bigint,p_successor_idempotency_key text,p_successor_payload_json jsonb,
  p_successor_trace_id uuid,p_successor_owner_token uuid,p_actor text,p_reason text
) returns table(chain_id uuid,assistant_message_id uuid,successor_job_id uuid)
language plpgsql security definer set search_path=public as $$
declare accepted record;
declare successor public.background_jobs%rowtype;
begin
  if not public.supersede_site_generation_epoch_internal(
    p_website_id,p_predecessor_job_id,p_predecessor_request_id,p_predecessor_claim_epoch,p_actor,p_reason
  ) then raise exception 'Generation predecessor could not be superseded' using errcode='40001'; end if;
  select * into strict accepted from public.enqueue_site_generation_job_owned(
    p_website_id,p_successor_idempotency_key,p_successor_payload_json,
    p_successor_trace_id,p_successor_owner_token,false
  );
  select successor_job.* into strict successor
  from public.background_jobs as successor_job
  where successor_job.website_id=p_website_id
    and successor_job.chain_id=accepted.chain_id
    and successor_job.job_type='site_generation'
  for update;
  if successor.generation_request_id::text is distinct from p_successor_idempotency_key
     or successor.id=p_predecessor_job_id then
    raise exception 'Generation successor identity is invalid' using errcode='P0001';
  end if;
  update public.background_jobs as predecessor_job
  set superseded_by_job_id=successor.id,supersession_link_state='linked',
    result_json=coalesce(predecessor_job.result_json,'{}'::jsonb)||jsonb_build_object('successorJobId',successor.id,'successorRequestId',successor.generation_request_id),
    generation_terminal_message_payload=coalesce(predecessor_job.generation_terminal_message_payload,'{}'::jsonb)
      ||jsonb_build_object('successorJobId',successor.id,'successorRequestId',successor.generation_request_id)
  where predecessor_job.id=p_predecessor_job_id;
  update public.background_jobs as successor_job
  set supersedes_job_id=p_predecessor_job_id,supersession_link_state='linked'
  where successor_job.id=successor.id;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
  ) select p_predecessor_job_id::text||':'||p_predecessor_claim_epoch::text||':successor-linked',
    predecessor_job.id,predecessor_job.website_id,predecessor_job.generation_request_id,2,predecessor_job.claim_epoch,
    predecessor_job.generation_stage,predecessor_job.stage_attempts,'superseded','administrative_successor_linked',
    'none','supersede','info',false,p_actor,clock_timestamp(),
    jsonb_build_object('successorJobId',successor.id,'successorRequestId',successor.generation_request_id)
  from public.background_jobs as predecessor_job
  where predecessor_job.id=p_predecessor_job_id;
  return query select accepted.chain_id,accepted.assistant_message_id,successor.id;
end;
$$;

revoke all on function public.supersede_and_enqueue_site_generation_job_owned(uuid,uuid,uuid,bigint,text,jsonb,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.supersede_and_enqueue_site_generation_job_owned(uuid,uuid,uuid,bigint,text,jsonb,uuid,uuid,text,text)
  to service_role;
