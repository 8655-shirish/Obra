-- Persist site generation and Add Video without Chrome QA.
-- Forward-only: epoch 2 remains the job schema; the existing /api/internal/run-jobs
-- loop is the builder. Admission requires a fresh job-runner heartbeat of any
-- capability, not browser_ready. Do not rewrite history.

create or replace function public.has_fresh_epoch2_generation_runner()
returns boolean language sql volatile security definer set search_path=public as $$
  select exists(
    select 1 from public.background_job_runner_capabilities as runner
    where runner.last_seen>=clock_timestamp()-interval '2 minutes'
  );
$$;
revoke all on function public.has_fresh_epoch2_generation_runner()
  from public,anon,authenticated,service_role;

create or replace function public.require_epoch2_generation_runner()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.job_type in ('site_generation','add_video')
     and new.generation_contract_epoch=2
     and not public.has_fresh_epoch2_generation_runner() then
    raise exception 'Epoch-2 generation admission rejected: no fresh job-runner heartbeat'
      using errcode='55000',
        hint='The /api/internal/run-jobs loop must heartbeat within two minutes, then retry.';
  end if;
  return new;
end;
$$;
revoke all on function public.require_epoch2_generation_runner()
  from public,anon,authenticated,service_role;

comment on table public.background_job_runner_capabilities is
  'Durable, RPC-owned worker capability heartbeats. Epoch-2 admission requires any runner last_seen within two minutes.';

create or replace function public.terminalize_unclaimable_epoch2_job(
  p_job_id uuid,p_actor text
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  -- Chrome unclaimable terminalize is retired. Pending jobs remain runnable.
  return false;
end;
$$;
revoke all on function public.terminalize_unclaimable_epoch2_job(uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.bucket1_assert_schema_v4_publish_attestation(
  p_config_json jsonb,
  p_expected_revision bigint,
  p_generation_job_id uuid,
  p_validation_attestation jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Quality check removed: generate → save → preview → Go live never requires a Chrome stamp.
  return;
end;
$$;
revoke all on function public.bucket1_assert_schema_v4_publish_attestation(jsonb,bigint,uuid,jsonb)
  from public,anon,authenticated,service_role;
comment on function public.bucket1_assert_schema_v4_publish_attestation(jsonb,bigint,uuid,jsonb) is
  'No-op. Schema-v4 publish no longer requires a browser QA attestation.';

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
       or (current_job.generation_stage='composition' and p_stage in ('validation','persistence'))
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
  'Service-only monotonic epoch-2 stage yield. Composition may yield directly to persistence; leftover validation still yields persistence.';

create or replace function public.yield_add_video_stage_pre_lifecycle_audit(
  p_job_id uuid,
  p_website_id uuid,
  p_job_attempts integer,
  p_claim_epoch bigint,
  p_runner_id text,
  p_expected_stage text,
  p_next_stage text,
  p_checkpoint_patch jsonb,
  p_retry_at timestamptz,
  p_progress_pct integer,
  p_status_message text
) returns boolean
language plpgsql security definer set search_path=public as $$
declare
  job public.background_jobs%rowtype;
  current_stage text;
  next_payload jsonb;
  v_plan_hash text;
  v_slot_id text;
  v_source_slot_id text;
begin
  if p_expected_stage not in ('planning/call','media/source-verify','media/create','media/poll','media/materialize','composition/build','validation/run','persistence/commit')
     or p_next_stage not in ('planning/call','media/source-verify','media/create','media/poll','media/materialize','composition/build','validation/run','persistence/commit')
     or jsonb_typeof(p_checkpoint_patch) is distinct from 'object'
     or p_progress_pct not between 0 and 99
     or nullif(btrim(p_runner_id),'') is null
     or nullif(btrim(p_status_message),'') is null then
    raise exception 'Invalid Add Video stage yield' using errcode='22023';
  end if;
  if not (
    (p_expected_stage='planning/call' and p_next_stage in ('planning/call','media/source-verify')) or
    (p_expected_stage='media/source-verify' and p_next_stage in ('media/source-verify','media/create')) or
    (p_expected_stage='media/create' and p_next_stage in ('media/create','media/poll','composition/build')) or
    (p_expected_stage='media/poll' and p_next_stage in ('media/poll','media/create','media/materialize')) or
    (p_expected_stage='media/materialize' and p_next_stage in ('media/materialize','composition/build')) or
    (p_expected_stage='composition/build' and p_next_stage in ('composition/build','validation/run','persistence/commit')) or
    (p_expected_stage='validation/run' and p_next_stage in ('validation/run','persistence/commit'))
  ) then
    raise exception 'Invalid Add Video stage transition' using errcode='22023';
  end if;

  select * into job from public.background_jobs where id=p_job_id for update;
  current_stage:=coalesce(job.payload_json->>'addVideoStage','planning/call');
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video' or job.status<>'running'
     or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id or current_stage<>p_expected_stage then
    return false;
  end if;

  next_payload := (job.payload_json - 'next_retry_at' - 'errorCode' - 'addVideoDisposition')
    || p_checkpoint_patch || jsonb_build_object('addVideoStage',p_next_stage);
  if next_payload ?| array['sourceBytes','downloadedVideo'] or exists (
    with recursive walk(value) as (
      select next_payload union all
      select child.value from walk parent cross join lateral (
        select value from jsonb_each(case when jsonb_typeof(parent.value)='object'
          then parent.value else '{}'::jsonb end)
        union all select value from jsonb_array_elements(case when jsonb_typeof(parent.value)='array'
          then parent.value else '[]'::jsonb end)
      ) child
    ) select 1 from walk where (jsonb_typeof(value)='string' and (
      length(value#>>'{}')>262144 or value#>>'{}' like 'data:%;base64,%'))
      or (jsonb_typeof(value)='array' and jsonb_array_length(value)>1024)
  ) then
    raise exception 'Add Video checkpoints may not contain media bytes' using errcode='22023';
  end if;
  if pg_column_size(next_payload)>2097152 then
    raise exception 'Add Video checkpoint is too large' using errcode='22001';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_checkpoint_patch) as key(value)
    where not (
      (p_expected_stage='planning/call' and value in ('plan','planHash','videoSlotId','plannerAttempt','plannerCorrection')) or
      (p_expected_stage='media/source-verify' and value in ('sourceVerification')) or
      (p_expected_stage='media/create' and value in ('providerOperationId','readyLedgerId')) or
      (p_expected_stage='media/poll' and value in ('providerOperationId')) or
      (p_expected_stage='media/materialize' and value in ('readyLedgerId')) or
      (p_expected_stage='composition/build' and value in ('resourceBindings','validatedCandidate')) or
      (p_expected_stage='validation/run' and value in ('candidateHash','validationInput','validationAttestation','validatedCandidate'))
    )
  ) then
    raise exception 'Add Video checkpoint contains a key outside its stage schema' using errcode='22023';
  end if;

  if p_expected_stage='planning/call' and p_next_stage='media/source-verify' then
    if jsonb_typeof(next_payload->'plan') is distinct from 'object'
       or next_payload->>'planHash' !~ '^[0-9a-f]{64}$'
       or nullif(next_payload->>'videoSlotId','') is null
       or nullif(next_payload#>>'{plan,sourceSlotId}','') is null then
      raise exception 'Accepted Add Video plan checkpoint is invalid' using errcode='22023';
    end if;
    v_plan_hash:=next_payload->>'planHash';
    v_slot_id:=next_payload->>'videoSlotId';
    v_source_slot_id:=next_payload#>>'{plan,sourceSlotId}';
    insert into public.site_generation_media_slots(
      job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,status,
      source_slot_id,poster_slot_id,plan_hash
    ) values(
      job.id,job.website_id,v_slot_id,'video','atmosphere','generated',true,false,'planned',
      v_source_slot_id,v_source_slot_id,v_plan_hash
    ) on conflict(job_id,slot_id) do nothing;
    if not exists(
      select 1 from public.site_generation_media_slots slot
      where slot.job_id=job.id and slot.website_id=job.website_id and slot.slot_id=v_slot_id
        and slot.kind='video' and slot.role='atmosphere' and slot.provenance='generated'
        and slot.required and not slot.proof_eligible and slot.plan_hash=v_plan_hash
        and slot.source_slot_id=v_source_slot_id and slot.poster_slot_id=v_source_slot_id
    ) then
      raise exception 'Persisted Add Video slot does not match accepted plan' using errcode='40001';
    end if;
  end if;

  update public.background_jobs set
    status='pending',payload_json=next_payload,progress_pct=p_progress_pct,
    status_message=left(p_status_message,500),error_message=null,
    next_retry_at=greatest(clock_timestamp(),coalesce(p_retry_at,clock_timestamp())),
    locked_at=null,locked_by=null,lease_expires_at=null
  where id=job.id and status='running' and attempts=p_job_attempts
    and claim_epoch=p_claim_epoch and locked_by=p_runner_id;
  if not found then return false; end if;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
  ) values (
    job.id::text||':'||p_claim_epoch::text||':add-video-yield:'||p_expected_stage||':'||p_next_stage,
    job.id,job.website_id,job.request_id,2,p_claim_epoch,
    case split_part(p_expected_stage,'/',1) when 'composition' then 'composition'
      when 'validation' then 'validation' when 'persistence' then 'persistence'
      when 'media' then 'media' else 'planning' end,p_job_attempts,
    'yielded','add_video_stage_checkpoint','none','retry','info',false,p_runner_id,clock_timestamp(),
    jsonb_build_object('nextStage',p_next_stage,'healthy',true,'retryAt',p_retry_at)
  ) on conflict(event_key) do nothing;
  return true;
end;
$$;
revoke all on function public.yield_add_video_stage_pre_lifecycle_audit(uuid,uuid,integer,bigint,text,text,text,jsonb,timestamptz,integer,text)
  from public,anon,authenticated,service_role;

create or replace function public.maintain_background_job_lifecycle(
  p_stale_before timestamptz,p_scheduler_run_id uuid,p_limit integer default 100
) returns table(terminalized_count integer,requeued_count integer,reconciliation_count integer)
language plpgsql security definer set search_path=public as $$
declare
  job public.background_jobs%rowtype;
  recovered record;
  candidate_id uuid;
  error_code text;
  handled integer:=0;
  add_video_due integer:=0;
begin
  if p_stale_before is null or p_scheduler_run_id is null or p_limit<1 or p_limit>1000 then
    raise exception 'Maintenance identity and bounds are required' using errcode='22023';
  end if;
  terminalized_count:=0;requeued_count:=0;reconciliation_count:=0;
  begin perform * from public.reconcile_due_generation_media(p_limit,'scheduler:'||p_scheduler_run_id::text);
  exception when others then null; end;
  begin
    add_video_due:=public.reconcile_due_add_video_media(p_limit,'scheduler:'||p_scheduler_run_id::text);
    terminalized_count:=terminalized_count+coalesce(add_video_due,0);
  exception when others then null; end;
  begin
    select * into recovered from public.recover_stale_background_jobs(p_stale_before,p_scheduler_run_id);
    requeued_count:=requeued_count+coalesce(recovered.requeued_count,0);
    terminalized_count:=terminalized_count+coalesce(recovered.failed_count,0);
    reconciliation_count:=reconciliation_count+coalesce(recovered.reconciliation_count,0);
  exception when others then null; end;
  begin
    select * into recovered from public.recover_stale_add_video_jobs(p_stale_before,p_scheduler_run_id);
    requeued_count:=requeued_count+coalesce(recovered.requeued_count,0);
    terminalized_count:=terminalized_count+coalesce(recovered.failed_count,0);
    reconciliation_count:=reconciliation_count+coalesce(recovered.reconciliation_count,0);
  exception when others then null; end;

  for candidate_id in
    select candidate.id from public.background_jobs as candidate
    where candidate.job_type='add_video' and candidate.status='pending'
      and (
        candidate.generation_contract_epoch is distinct from 2
        or candidate.generation_contract_version is distinct from 2
        or candidate.payload_json->>'generatorSchemaVersion' is distinct from '4'
        or candidate.payload_json->>'addVideoStage' not in (
          'planning/call','media/source-verify','media/create','media/poll',
          'media/materialize','composition/build','validation/run','persistence/commit')
        or public.add_video_stage_failure_count(candidate.payload_json) is null
        or public.add_video_stage_failure_count(candidate.payload_json)>=3
        or candidate.interruption_count>=3
        or clock_timestamp()>=candidate.created_at+interval '8 minutes'
      )
    order by candidate.created_at,candidate.id limit p_limit
    for update of candidate skip locked
  loop
    select * into job from public.background_jobs where id=candidate_id;
    error_code:=case
      when job.generation_contract_epoch is distinct from 2
        or job.generation_contract_version is distinct from 2
        or job.payload_json->>'generatorSchemaVersion' is distinct from '4'
        then 'add_video_contract_unsupported'
      when clock_timestamp()>=job.created_at+interval '8 minutes' then 'add_video_deadline_exceeded'
      when job.interruption_count>=3 then 'add_video_interruption_budget_exhausted'
      when public.add_video_stage_failure_count(job.payload_json) is null then 'add_video_retry_state_invalid'
      else 'add_video_retry_budget_exhausted' end;
    begin
      if public.terminalize_add_video_job_internal(job.id,error_code,
        case error_code when 'add_video_contract_unsupported' then 'Unsupported Add Video contract'
          when 'add_video_deadline_exceeded' then 'Add Video deadline exceeded'
          when 'add_video_interruption_budget_exhausted' then 'Add Video interruption budget exhausted'
          when 'add_video_retry_state_invalid' then 'Invalid Add Video retry state'
          else 'Add Video retry budget exhausted' end,
        'scheduler:'||p_scheduler_run_id::text) then
        terminalized_count:=terminalized_count+1;
      end if;
    exception when others then
      continue;
    end;
    handled:=handled+1;
    exit when handled>=p_limit;
  end loop;
  return next;
end;
$$;
revoke all on function public.maintain_background_job_lifecycle(timestamptz,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.maintain_background_job_lifecycle(timestamptz,uuid,integer)
  to service_role;
comment on function public.maintain_background_job_lifecycle(timestamptz,uuid,integer) is
  'Service-only bounded nonblocking recovery and Add Video quarantine. Does not terminalize pending epoch-2 rows for missing Chrome.';

create or replace function public.insert_generated_website_version_with_slots(
  p_website_id uuid,p_config_json jsonb,p_job_id uuid,p_claim_epoch bigint,p_media_slot_ids uuid[]
) returns table(id uuid,version_number integer,variant_key text)
language plpgsql security definer set search_path = public as $$
declare
  claimed_job public.background_jobs%rowtype;
  replay_version public.website_versions%rowtype;
  checkpoint jsonb;
  manifest_slots jsonb;
  terminal_payload jsonb;
  next_number integer;
  new_version_id uuid;
  new_variant_key text;
  supplied_count integer;
  distinct_count integer;
  matched_count integer;
  final_text text := 'Your website is ready to review.';
begin
  if p_website_id is null or p_job_id is null or p_claim_epoch is null
     or p_media_slot_ids is null or jsonb_typeof(p_config_json) <> 'object' then
    raise exception 'A generation job, config, and media slot array are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text,0));
  select * into claimed_job from public.background_jobs where id=p_job_id for update;
  if not found or claimed_job.website_id<>p_website_id or claimed_job.job_type<>'site_generation'
     or claimed_job.generation_contract_epoch<>2 or claimed_job.claim_epoch<>p_claim_epoch
     or not exists(
       select 1 from public.websites website
       where website.id=p_website_id and website.user_id=claimed_job.generation_tenant_id
     )
     or not exists(
       select 1 from public.agent_traces trace
       where trace.id=claimed_job.agent_trace_id and trace.website_id=p_website_id
         and trace.profile_id=claimed_job.generation_tenant_id
         and trace.request_id=claimed_job.generation_request_id
     )
     or (claimed_job.generation_kind='regeneration' and not exists(
       select 1 from public.website_versions source_version
       where source_version.id=claimed_job.source_version_id and source_version.website_id=p_website_id
     )) then
    raise exception 'Generation job, ownership, or source authorization is no longer authoritative' using errcode='40001';
  end if;

  select * into replay_version from public.website_versions
  where generation_job_id=p_job_id for update;
  if found then
    if claimed_job.status<>'completed'
       or claimed_job.generation_result_version_id is distinct from replay_version.id
       or claimed_job.generation_terminal_message_at is null
       or claimed_job.generation_terminal_message_id is distinct from claimed_job.generation_handoff_message_id
       or claimed_job.generation_terminal_message_payload is null then
      raise exception 'Generation replay state is inconsistent' using errcode='P0001';
    end if;
    return query select replay_version.id,replay_version.version_number,replay_version.variant_key;
    return;
  end if;

  checkpoint := claimed_job.generation_checkpoint;
  if claimed_job.status<>'running' or claimed_job.generation_stage<>'persistence'
     or claimed_job.lease_expires_at is null or claimed_job.lease_expires_at<=clock_timestamp()
     or nullif(btrim(claimed_job.locked_by),'') is null
     or checkpoint->>'schemaVersion'<>'2' or checkpoint->>'stage'<>'persistence'
     or checkpoint->'input' is distinct from claimed_job.generation_input_snapshot
     or checkpoint->>'inputHash' is distinct from claimed_job.generation_input_hash
     or (checkpoint->>'acceptedAt')::timestamptz is distinct from claimed_job.generation_accepted_at
     or checkpoint->'candidateConfig' is distinct from p_config_json
     or p_config_json->>'generator' is distinct from 'unified-site-agent'
     or p_config_json->>'generatorSchemaVersion' is distinct from '4'
     or checkpoint->>'candidateSourceHash' is distinct from encode(extensions.digest(convert_to(p_config_json->>'themeSource','UTF8'),'sha256'),'hex') then
    raise exception 'Schema-v4 persistence requires a matching composed candidate' using errcode='P0001';
  end if;

  select count(*),count(distinct supplied.slot_uuid) into supplied_count,distinct_count
  from unnest(p_media_slot_ids) supplied(slot_uuid);
  if supplied_count<>distinct_count then raise exception 'Media slot IDs must be unique' using errcode='22023'; end if;
  manifest_slots := p_config_json#>'{mediaManifest,slots}';
  if jsonb_typeof(manifest_slots) is distinct from 'array'
     or jsonb_array_length(manifest_slots)<>supplied_count then
    raise exception 'Unified v4 config is missing a complete media manifest' using errcode='22023';
  end if;

  perform 1 from public.site_generation_media_slots slot
  where slot.job_id=p_job_id order by slot.id for update;
  select count(*) into matched_count from public.site_generation_media_slots slot
  where slot.id=any(p_media_slot_ids) and slot.job_id=p_job_id and slot.website_id=p_website_id
    and slot.status='ready';
  if matched_count<>supplied_count then
    raise exception 'Media slots are stale, missing, or not ready under this claim epoch' using errcode='P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(manifest_slots) item
    left join public.site_generation_media_slots slot
      on slot.id=any(p_media_slot_ids) and slot.slot_id=item->>'slotId'
    where slot.id is null or nullif(item->>'slotId','') is null
      or slot.asset_id is distinct from item->>'assetId'
      or slot.mime_type is distinct from item->>'mimeType'
      or slot.role is distinct from item->>'role'
      or slot.provenance is distinct from item->>'origin'
      or slot.required is distinct from coalesce((item->>'required')::boolean,false)
      or slot.proof_eligible is distinct from coalesce((item->>'proofEligible')::boolean,false)
      or slot.source_slot_id is distinct from nullif(item->>'sourceSlotId','')
      or slot.poster_slot_id is distinct from nullif(item->>'posterSlotId','')
      or slot.storage_path is distinct from item->>'storagePath'
  ) or exists (
    select item->>'slotId' from jsonb_array_elements(manifest_slots) item
    group by item->>'slotId' having count(*)<>1
  ) or exists (
    select 1 from public.site_generation_media_slots slot
    where slot.job_id=p_job_id and slot.website_id=p_website_id and slot.required
      and (not (slot.id=any(p_media_slot_ids)) or slot.status<>'ready')
  ) then
    raise exception 'Validated manifest does not exactly match the ready epoch ledger' using errcode='P0001';
  end if;

  select coalesce(max(v.version_number),0)+1 into next_number
  from public.website_versions v where v.website_id=p_website_id;
  new_variant_key := p_config_json->>'variantKey';
  if nullif(btrim(new_variant_key),'') is null then
    raise exception 'Validated candidate is missing its reserved variant identity' using errcode='P0001';
  end if;
  insert into public.website_versions(website_id,version_number,config_json,variant_key,status,revision,generation_job_id)
  values(p_website_id,next_number,p_config_json,new_variant_key,'draft',(checkpoint->>'candidateRevision')::integer,p_job_id)
  returning website_versions.id into new_version_id;

  insert into public.website_version_media_slots(
    version_id,website_id,slot_id,asset_id,mime_type,role,provenance,required,
    source_slot_id,poster_slot_id,storage_path,proof_eligible
  ) select new_version_id,s.website_id,s.slot_id,s.asset_id,s.mime_type,s.role,s.provenance,
      s.required,s.source_slot_id,s.poster_slot_id,s.storage_path,s.proof_eligible
    from public.site_generation_media_slots s where s.id=any(p_media_slot_ids);

  update public.site_generation_media_slots set status='attached',version_id=new_version_id
  where id=any(p_media_slot_ids) and job_id=p_job_id;
  update public.site_generation_media_slots set
    status='abandoned',error_message=coalesce(error_message,'Not selected by validated manifest'),
    abandoned_at=clock_timestamp()
  where job_id=p_job_id and website_id=p_website_id and version_id is null
    and not (id=any(p_media_slot_ids)) and status in ('planned','generating','failed','ready');

  terminal_payload := jsonb_build_object(
    'schemaVersion',1,'kind','site-generation-terminal','status','completed',
    'jobId',p_job_id,'requestId',claimed_job.generation_request_id,
    'claimEpoch',p_claim_epoch,'versionId',new_version_id,'message',final_text
  );
  update public.messages set content=final_text
  where id=claimed_job.generation_handoff_message_id
    and trace_id=claimed_job.agent_trace_id and role='assistant';
  if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;

  update public.agent_traces set status='completed',error_message=null,
    completed_at=coalesce(completed_at,clock_timestamp())
  where id=claimed_job.agent_trace_id and website_id=p_website_id and status in ('running','completed');
  if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;

  update public.background_jobs set
    status='completed',progress_pct=100,status_message='Completed',error_message=null,
    result_json=jsonb_build_object('variantCount',1,'versionIds',jsonb_build_array(new_version_id)),
    generation_result_version_id=new_version_id,generation_stage='persistence',
    generation_terminal_message_id=claimed_job.generation_handoff_message_id,
    generation_terminal_message_payload=terminal_payload,generation_terminal_message_at=clock_timestamp(),
    completed_at=clock_timestamp(),next_retry_at=null,locked_at=null,locked_by=null,lease_expires_at=null
  where id=p_job_id and status='running' and generation_contract_epoch=2
    and claim_epoch=p_claim_epoch and locked_by=claimed_job.locked_by
    and lease_expires_at>clock_timestamp();
  if not found then raise exception 'Generation claim was lost before completion' using errcode='40001'; end if;

  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,effect_certainty,disposition,severity,blocking,completed_at,details
  ) values(
    p_job_id::text||':'||p_claim_epoch::text||':finalizer-completed',p_job_id,p_website_id,
    claimed_job.generation_request_id,2,p_claim_epoch,'persistence',
    coalesce((claimed_job.stage_attempt_counts->>'persistence')::integer,0),
    'completed','definite_success','terminal_success','info',false,clock_timestamp(),
    jsonb_build_object('versionId',new_version_id,'terminalMessageId',claimed_job.generation_handoff_message_id,
      'persistedWithoutChromeQa',true)
  ) on conflict(event_key) do nothing;
  return query select new_version_id,next_number,new_variant_key;
end;
$$;

revoke all on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[])
  from public, anon, authenticated;
grant execute on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[])
  to service_role;
comment on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[]) is
  'Sole epoch-2 success transition: claim-epoch/lease fenced, composed-candidate identity bound, atomically inserts version+attachments, settles slots/job/trace, and projects one terminal message.';

create or replace function public.publish_website_version_atomic(
  p_website_id uuid,
  p_version_id uuid,
  p_expected_revision bigint,
  p_expected_config_json jsonb,
  p_expected_media_slots jsonb,
  p_validation_attestation jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.website_versions%rowtype;
  locked_media_slots jsonb;
  next_revision bigint;
  schema_version text;
begin
  select * into target
  from public.website_versions
  where id=p_version_id and website_id=p_website_id
  for update;
  if not found then raise exception 'Website version not found'; end if;
  if target.revision <> p_expected_revision then raise exception 'Website version revision conflict'; end if;
  if target.status not in ('draft','selected') then raise exception 'Website version is not publishable'; end if;
  if target.config_json is distinct from p_expected_config_json then
    raise exception 'Website version integrity check failed';
  end if;

  schema_version := target.config_json->>'generatorSchemaVersion';
  if schema_version = '4' and p_expected_media_slots is null then
    raise exception 'Schema-v4 publish requires a locked media attachment snapshot' using errcode='P0001';
  end if;
  if p_expected_media_slots is not null then
    select coalesce(jsonb_agg(to_jsonb(slot_row) order by slot_row.slot_id),'[]'::jsonb)
    into locked_media_slots
    from (
      select slot_id,asset_id,mime_type,role,provenance,required,
        source_slot_id,poster_slot_id,storage_path,proof_eligible
      from public.website_version_media_slots
      where website_id=p_website_id and version_id=p_version_id
      order by slot_id
      for update
    ) slot_row;
    if locked_media_slots is distinct from p_expected_media_slots then
      raise exception 'Website media attachment integrity check failed';
    end if;
  end if;

  if schema_version = '4' then
    if jsonb_typeof(target.config_json#>'{mediaManifest,slots}') is distinct from 'array'
       or jsonb_array_length(target.config_json#>'{mediaManifest,slots}') <> jsonb_array_length(locked_media_slots)
       or exists (
         select 1
         from jsonb_array_elements(target.config_json#>'{mediaManifest,slots}') manifest(slot)
         left join public.website_version_media_slots attached
           on attached.website_id=p_website_id and attached.version_id=p_version_id
          and attached.slot_id=manifest.slot->>'slotId'
         where attached.slot_id is null
            or nullif(manifest.slot->>'slotId','') is null
            or attached.asset_id is distinct from manifest.slot->>'assetId'
            or attached.mime_type is distinct from manifest.slot->>'mimeType'
            or attached.role is distinct from manifest.slot->>'role'
            or attached.provenance is distinct from manifest.slot->>'origin'
            or attached.required is distinct from coalesce((manifest.slot->>'required')::boolean,false)
            or attached.source_slot_id is distinct from nullif(manifest.slot->>'sourceSlotId','')
            or attached.poster_slot_id is distinct from nullif(manifest.slot->>'posterSlotId','')
            or attached.storage_path is distinct from manifest.slot->>'storagePath'
            or attached.proof_eligible is distinct from coalesce((manifest.slot->>'proofEligible')::boolean,false)
       )
       or exists (
         select manifest.slot->>'slotId'
         from jsonb_array_elements(target.config_json#>'{mediaManifest,slots}') manifest(slot)
         group by manifest.slot->>'slotId' having count(*) <> 1
       ) then
      raise exception 'Schema-v4 publish manifest does not match locked media attachments' using errcode='P0001';
    end if;
  end if;


  update public.website_versions
  set status='live',revision=revision+1,updated_at=clock_timestamp()
  where id=p_version_id and website_id=p_website_id and revision=p_expected_revision
  returning revision into next_revision;
  if next_revision is null then raise exception 'Website version revision conflict'; end if;

  update public.websites
  set status='live',active_version_id=p_version_id,updated_at=clock_timestamp()
  where id=p_website_id;
  if not found then raise exception 'Website not found'; end if;
  return next_revision;
end;
$$;

revoke all on function public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb)
  to service_role;
comment on function public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb) is
  'Atomic publish. Schema v4 requires locked media vs mediaManifest; it does not require a Chrome QA stamp.';

-- First-time confirm and create-without-snapshot claim generate_initial (no source snapshot).
-- Kickoff remains admin_auto_kickoff. Do not rewrite the prior claim_agent_turn history.
create or replace function public.claim_agent_turn(
  p_website_id uuid,
  p_profile_id uuid,
  p_intent_type text,
  p_trigger_message text,
  p_request_id uuid,
  p_request_payload_hash text,
  p_source_version_id uuid,
  p_source_revision bigint,
  p_owner_token uuid,
  p_lease_seconds integer default 60
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  existing public.agent_traces%rowtype;
  canonical_conversation_id uuid;
  assistant_message_id uuid;
begin
  if p_website_id is null or p_profile_id is null or p_owner_token is null
     or p_request_id is null or p_request_payload_hash is null
     or p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'Invalid agent turn claim';
  end if;
  if p_intent_type not in (
    'chat','onboarding_submitted','admin_auto_kickoff','regenerate_variants','publishToLp','generate_initial'
  ) then
    raise exception 'Invalid agent turn intent';
  end if;
  if (p_source_version_id is null) <> (p_source_revision is null)
     or p_source_revision < 0
     or (p_intent_type='regenerate_variants') <> (p_source_version_id is not null) then
    raise exception 'Invalid agent turn source snapshot';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  perform 1 from public.agent_turn_runtime_gate where singleton and enabled for share;
  if not found then
    raise exception 'Agent turn runtime is disabled until legacy instances have drained';
  end if;
  if not exists (select 1 from public.websites where id=p_website_id and user_id=p_profile_id) then
    raise exception 'Website profile mismatch';
  end if;
  insert into public.conversations(user_id,website_id,phase)
  values(p_profile_id,p_website_id,'onboarding') on conflict (website_id) do nothing;
  select id into strict canonical_conversation_id from public.conversations
  where website_id=p_website_id and user_id=p_profile_id;

  select * into existing from public.agent_traces
  where website_id=p_website_id and request_id=p_request_id;
  if found then
    if existing.profile_id is distinct from p_profile_id
       or existing.conversation_id is distinct from canonical_conversation_id
       or existing.request_payload_hash is distinct from p_request_payload_hash
       or existing.source_version_id is distinct from p_source_version_id
       or existing.source_revision is distinct from p_source_revision then
      raise exception 'Request identity payload conflict';
    end if;
    if existing.status='completed' then
      select m.id into assistant_message_id from public.messages m
      where m.trace_id=existing.id and m.role='assistant' and btrim(m.content)<>''
      order by m.sequence_id desc limit 1;
    end if;
    return jsonb_build_object(
      'disposition', existing.status, 'traceId', existing.id,
      'conversationId', canonical_conversation_id,
      'assistantMessageId', assistant_message_id, 'error', existing.error_message
    );
  end if;

  if p_source_version_id is not null and not exists (
    select 1 from public.website_versions
    where id=p_source_version_id and website_id=p_website_id and revision=p_source_revision
      and status in ('draft','selected','live')
  ) then
    raise exception 'Agent turn source snapshot does not match';
  end if;

  select * into existing from public.agent_traces
  where website_id=p_website_id and status='running' order by started_at,id limit 1;
  if found then
    return jsonb_build_object(
      'disposition','running','traceId',existing.id,
      'conversationId',canonical_conversation_id,'assistantMessageId',null,'error',null
    );
  end if;

  insert into public.agent_traces(
    website_id,profile_id,conversation_id,intent_type,trigger_message,request_id,
    request_payload_hash,source_version_id,source_revision,status,owner_token,heartbeat_at,lease_expires_at
  ) values (
    p_website_id,p_profile_id,canonical_conversation_id,p_intent_type,p_trigger_message,p_request_id,
    p_request_payload_hash,p_source_version_id,p_source_revision,'running',p_owner_token,
    clock_timestamp(),clock_timestamp()+make_interval(secs=>p_lease_seconds)
  ) returning * into existing;
  return jsonb_build_object(
    'disposition','new','traceId',existing.id,'conversationId',canonical_conversation_id,
    'assistantMessageId',null,'error',null
  );
end;
$$;
revoke all on function public.claim_agent_turn(uuid,uuid,text,text,uuid,text,uuid,bigint,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.claim_agent_turn(uuid,uuid,text,text,uuid,text,uuid,bigint,uuid,integer)
  to service_role;
