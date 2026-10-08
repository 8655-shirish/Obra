-- Restore the current contract-3 generation yield semantics after the late Lovable mirror
-- 20260901083802 replays the older 20260830200000 function body after gacha admission.
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

revoke all on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)
  to service_role;
comment on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text) is
  'Service-only monotonic epoch-2 stage yield. Planning may yield planning while waiting on scrape; media may yield media. Contract-3 identity survives every yield.';
