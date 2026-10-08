-- Forward-only lifecycle convergence for merged-main Bucket 1 generation and Add Video.
-- Claiming is intentionally mutation-free outside the selected claim. Maintenance owns recovery,
-- quarantine, reconciliation expiry, and terminal child closure.

create or replace function public.add_video_set_stage_failure(
  p_payload jsonb,p_stage text,p_count integer
) returns jsonb
language plpgsql immutable set search_path=public as $$
declare
  payload jsonb:=case when jsonb_typeof(p_payload)='object' then p_payload else '{}'::jsonb end;
  failures jsonb;
  stage_name text:=coalesce(nullif(p_stage,''),'planning/call');
begin
  failures:=case when jsonb_typeof(payload->'stageFailures')='object'
    then payload->'stageFailures' else '{}'::jsonb end;
  payload:=jsonb_set(payload,'{stageFailures}',failures,true);
  return jsonb_set(payload,array['stageFailures',stage_name],to_jsonb(greatest(coalesce(p_count,0),0)),true);
end;
$$;
revoke all on function public.add_video_set_stage_failure(jsonb,text,integer)
  from public,anon,authenticated,service_role;

-- Supported active rows are safe to normalize. Unsupported contracts remain untouched and are
-- terminalized by maintenance rather than silently upgraded.
update public.background_jobs as job
set payload_json=public.add_video_set_stage_failure(
  job.payload_json,job.payload_json->>'addVideoStage',
  coalesce(public.add_video_stage_failure_count(job.payload_json),0)
)
where job.job_type='add_video'
  and job.status in ('pending','running','finalizing')
  and job.generation_contract_epoch=2
  and job.generation_contract_version=2
  and job.payload_json->>'generatorSchemaVersion'='4'
  and job.payload_json->>'addVideoStage' in (
    'planning/call','media/source-verify','media/create','media/poll',
    'media/materialize','composition/build','validation/run','persistence/commit'
  )
  and (job.payload_json->'stageFailures' is null
    or jsonb_typeof(job.payload_json->'stageFailures')<>'object');

-- Caller must own the parent row first. The helper attempts to own every unattached child with
-- SKIP LOCKED before changing any child, so maintenance never waits behind a poisoned child.
-- Return -1 when complete closure ownership was unavailable; otherwise return the total number
-- of reconciliation rows after closure (including rows that were already reconciling).
create or replace function public.close_add_video_terminal_children(
  p_job_id uuid,p_reason text,p_now timestamptz default clock_timestamp()
) returns integer
language plpgsql security definer set search_path=public as $$
declare
  child_count integer;
  owned_count integer;
  reconciliation_count integer;
begin
  if p_job_id is null or nullif(btrim(p_reason),'') is null or p_now is null then
    raise exception 'Add Video terminal child closure identity is required' using errcode='22023';
  end if;
  if not exists(select 1 from public.background_jobs
    where id=p_job_id and job_type in ('site_generation','add_video')) then
    return -1;
  end if;
  select count(*) into child_count
  from public.site_generation_media_slots
  where job_id=p_job_id and version_id is null and status<>'attached';
  select count(*) into owned_count from (
    select slot.id from public.site_generation_media_slots as slot
    where slot.job_id=p_job_id and slot.version_id is null and slot.status<>'attached'
    order by slot.id for update of slot skip locked
  ) as owned;
  if owned_count<>child_count then return -1; end if;

  update public.site_generation_media_slots as slot set
    status=case
      when slot.status='ready' then 'abandoned'
      when slot.provider_reservation_id is not null
        and not(slot.effect_certainty='definite_failure'
          and slot.provider_operation_id is not null
          and slot.retired_provider_operation_ids ? slot.provider_operation_id)
        then 'reconciliation_required'
      else 'abandoned' end,
    effect_certainty=case
      when slot.status<>'ready' and slot.provider_reservation_id is not null
        and not(slot.effect_certainty='definite_failure'
          and slot.provider_operation_id is not null
          and slot.retired_provider_operation_ids ? slot.provider_operation_id)
        then 'indeterminate'
      else slot.effect_certainty end,
    reconciliation_required_at=case
      when slot.status<>'ready' and slot.provider_reservation_id is not null
        and not(slot.effect_certainty='definite_failure'
          and slot.provider_operation_id is not null
          and slot.retired_provider_operation_ids ? slot.provider_operation_id)
        then coalesce(slot.reconciliation_required_at,p_now)
      else null end,
    reconciliation_deadline=case
      when slot.status<>'ready' and slot.provider_reservation_id is not null
        and not(slot.effect_certainty='definite_failure'
          and slot.provider_operation_id is not null
          and slot.retired_provider_operation_ids ? slot.provider_operation_id)
        then coalesce(slot.reconciliation_deadline,p_now+interval '1 hour')
      else null end,
    reconciled_at=case when slot.status='reconciliation_required' then slot.reconciled_at else null end,
    cleanup_required=case when slot.status='ready' then true
      when slot.status='reconciliation_required' then slot.cleanup_required else false end,
    cleanup_completed_at=null,
    abandoned_at=case
      when slot.status='ready' or slot.provider_reservation_id is null
        or (slot.effect_certainty='definite_failure'
          and slot.provider_operation_id is not null
          and slot.retired_provider_operation_ids ? slot.provider_operation_id)
        then coalesce(slot.abandoned_at,p_now)
      else null end,
    slot_locked_by=null,slot_lease_expires_at=null,
    error_message=left(p_reason,1000)
  where slot.job_id=p_job_id and slot.version_id is null and slot.status<>'attached';

  select count(*) into reconciliation_count
  from public.site_generation_media_slots
  where job_id=p_job_id and status='reconciliation_required';
  return reconciliation_count;
end;
$$;
revoke all on function public.close_add_video_terminal_children(uuid,text,timestamptz)
  from public,anon,authenticated,service_role;

create or replace function public.terminalize_add_video_job_internal(
  p_job_id uuid,p_error_code text,p_status_message text,p_actor text
) returns boolean
language plpgsql security definer set search_path=public as $$
declare
  job public.background_jobs%rowtype;
  reconciliation_count integer;
  stage_name text;
  terminal_at timestamptz:=clock_timestamp();
begin
  if nullif(btrim(p_error_code),'') is null or nullif(btrim(p_status_message),'') is null
     or nullif(btrim(p_actor),'') is null then
    raise exception 'Add Video terminal identity is required' using errcode='22023';
  end if;
  select * into job from public.background_jobs where id=p_job_id and job_type='add_video' for update;
  if not found then return false; end if;
  if job.status in ('completed','failed','cancelled') then
    return exists(select 1 from public.site_generation_attempt_events
      where event_key=job.id::text||':'||job.claim_epoch::text||':add-video-terminal');
  end if;
  reconciliation_count:=public.close_add_video_terminal_children(job.id,p_error_code,terminal_at);
  if reconciliation_count<0 then return false; end if;
  update public.background_jobs set
    status='failed',completed_at=terminal_at,next_retry_at=null,
    locked_at=null,locked_by=null,lease_expires_at=null,
    status_message=left(p_status_message,500),error_message=left(p_error_code,1000),
    result_json=jsonb_build_object('status','failed','errorCode',p_error_code,
      'jobId',id,'requestId',coalesce(request_id,id),'claimEpoch',claim_epoch)
  where id=job.id;
  stage_name:=split_part(coalesce(job.payload_json->>'addVideoStage','planning/call'),'/',1);
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
  ) values(
    job.id::text||':'||job.claim_epoch::text||':add-video-terminal',job.id,job.website_id,
    coalesce(job.request_id,job.id),2,job.claim_epoch,
    case when stage_name in ('planning','media','composition','validation','persistence')
      then stage_name else 'planning' end,job.attempts,'failed',p_error_code,
    case when reconciliation_count>0 then 'indeterminate' else 'none' end,
    'terminal_failure','error',true,left(p_actor,1000),terminal_at,
    jsonb_build_object('childReconciliationCount',reconciliation_count,'absoluteDeadline',job.created_at+interval '8 minutes')
  ) on conflict(event_key) do nothing;
  return true;
end;
$$;
revoke all on function public.terminalize_add_video_job_internal(uuid,text,text,text)
  from public,anon,authenticated,service_role;

-- Keep the historical private signature for internal callers, but route it through total closure.
create or replace function public.terminalize_add_video_retry_state(
  p_job_id uuid,p_scheduler_run_id uuid,p_error_code text,p_status_message text
) returns boolean
language sql security definer set search_path=public as $$
  select public.terminalize_add_video_job_internal(
    p_job_id,p_error_code,p_status_message,'scheduler:'||p_scheduler_run_id::text
  );
$$;
revoke all on function public.terminalize_add_video_retry_state(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;

create or replace function public.settle_add_video_job_epoch(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,p_status text,
  p_progress_pct integer,p_result_json jsonb,p_payload_json jsonb,p_error_message text,
  p_status_message text,p_completed_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  job public.background_jobs%rowtype;
  failure_count integer;
  reconciliation_count integer:=0;
  terminal_at timestamptz:=coalesce(p_completed_at,clock_timestamp());
begin
  if p_status not in ('pending','failed','cancelled') then
    raise exception 'Invalid Add Video settlement status' using errcode='22023';
  end if;
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video' or job.status<>'running'
     or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id then return false; end if;
  if clock_timestamp()>=job.created_at+interval '8 minutes' then
    perform public.terminalize_add_video_job_internal(job.id,'add_video_deadline_exceeded',
      'Add Video deadline exceeded',p_runner_id);
    return false;
  end if;
  failure_count:=coalesce(public.add_video_stage_failure_count(job.payload_json),0)+1;
  if p_status in ('failed','cancelled') then
    reconciliation_count:=public.close_add_video_terminal_children(
      job.id,coalesce(p_error_message,'Add Video ended'),terminal_at);
    if reconciliation_count<0 then return false; end if;
  end if;
  update public.background_jobs set status=p_status,progress_pct=p_progress_pct,
    result_json=p_result_json,
    payload_json=case when p_status in ('pending','failed') then
      public.add_video_set_stage_failure(coalesce(p_payload_json,'{}'::jsonb),
        coalesce(job.payload_json->>'addVideoStage','planning/call'),failure_count)
      else coalesce(p_payload_json,'{}'::jsonb) end,
    error_message=p_error_message,status_message=left(p_status_message,500),
    completed_at=case when p_status='pending' then null else terminal_at end,
    next_retry_at=case when p_status='pending'
      then nullif(p_payload_json->>'next_retry_at','')::timestamptz else null end,
    locked_at=null,locked_by=null,lease_expires_at=null,
    failure_attempts=failure_attempts+case when p_status in ('pending','failed') then 1 else 0 end
  where id=job.id and status='running' and attempts=p_job_attempts and claim_epoch=p_claim_epoch
    and locked_by=p_runner_id;
  if not found then return false; end if;
  if p_status in ('failed','cancelled') then
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values(
      job.id::text||':'||job.claim_epoch::text||':add-video-terminal',job.id,job.website_id,
      coalesce(job.request_id,job.id),2,job.claim_epoch,
      case split_part(coalesce(job.payload_json->>'addVideoStage','planning/call'),'/',1)
        when 'media' then 'media' when 'composition' then 'composition' when 'validation' then 'validation'
        when 'persistence' then 'persistence' else 'planning' end,job.attempts,
      case when p_status='cancelled' then 'cancelled' else 'failed' end,
      coalesce(p_error_message,p_status),case when reconciliation_count>0 then 'indeterminate' else 'none' end,
      case when p_status='cancelled' then 'cancel' else 'terminal_failure' end,
      case when p_status='cancelled' then 'info' else 'error' end,reconciliation_count>0,p_runner_id,terminal_at,
      jsonb_build_object('childReconciliationCount',reconciliation_count)
    ) on conflict(event_key) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.settle_add_video_job_epoch(uuid,uuid,integer,bigint,text,text,integer,jsonb,jsonb,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.settle_add_video_job_epoch(uuid,uuid,integer,bigint,text,text,integer,jsonb,jsonb,text,text,timestamptz)
  to service_role;

create or replace function public.interrupt_add_video_job_epoch(
  p_job_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,
  p_cause_code text,p_retry_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  job public.background_jobs%rowtype;
  failure_count integer;
  terminal_reason text;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.job_type<>'add_video' or job.status<>'running' or job.attempts<>p_job_attempts
     or job.claim_epoch<>p_claim_epoch or job.locked_by is distinct from p_runner_id then return false; end if;
  if clock_timestamp()>=job.created_at+interval '8 minutes' then terminal_reason:='add_video_deadline_exceeded';
  elsif job.interruption_count+1>=3 then terminal_reason:='add_video_interruption_budget_exhausted';
  elsif exists(select 1 from public.site_generation_media_slots where job_id=job.id and version_id is null
      and (status in ('ready','reconciliation_required') or provider_reservation_id is not null)) then
    terminal_reason:='interrupted_add_video_provider_reconciliation';
  end if;
  if terminal_reason is not null then
    return public.terminalize_add_video_job_internal(job.id,terminal_reason,
      case terminal_reason when 'add_video_deadline_exceeded' then 'Add Video deadline exceeded'
        when 'add_video_interruption_budget_exhausted' then 'Add Video interruption budget exhausted'
        else 'Needs provider reconciliation' end,p_runner_id);
  end if;
  failure_count:=coalesce(public.add_video_stage_failure_count(job.payload_json),0)+1;
  update public.background_jobs set status='pending',status_message='Add Video interrupted; retry scheduled',
    error_message=p_cause_code,next_retry_at=p_retry_at,completed_at=null,
    interruption_count=interruption_count+1,failure_attempts=failure_attempts+1,
    payload_json=public.add_video_set_stage_failure(payload_json,
      coalesce(payload_json->>'addVideoStage','planning/call'),failure_count),
    locked_at=null,locked_by=null,lease_expires_at=null
  where id=job.id and status='running' and attempts=p_job_attempts and claim_epoch=p_claim_epoch
    and locked_by=p_runner_id;
  return found;
end;
$$;
revoke all on function public.interrupt_add_video_job_epoch(uuid,integer,bigint,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.interrupt_add_video_job_epoch(uuid,integer,bigint,text,text,timestamptz)
  to service_role;

-- Add the absolute deadline guard without duplicating the established checkpoint validator.
alter function public.yield_add_video_stage(uuid,uuid,integer,bigint,text,text,text,jsonb,timestamptz,integer,text)
  rename to yield_add_video_stage_pre_lifecycle_audit;
revoke all on function public.yield_add_video_stage_pre_lifecycle_audit(uuid,uuid,integer,bigint,text,text,text,jsonb,timestamptz,integer,text)
  from public,anon,authenticated,service_role;
create function public.yield_add_video_stage(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,
  p_expected_stage text,p_next_stage text,p_checkpoint_patch jsonb,p_retry_at timestamptz,
  p_progress_pct integer,p_status_message text
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video' or job.status<>'running'
     or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id then return false; end if;
  if clock_timestamp()>=job.created_at+interval '8 minutes' or job.interruption_count>=3 then
    perform public.terminalize_add_video_job_internal(job.id,
      case when clock_timestamp()>=job.created_at+interval '8 minutes'
        then 'add_video_deadline_exceeded' else 'add_video_interruption_budget_exhausted' end,
      case when clock_timestamp()>=job.created_at+interval '8 minutes'
        then 'Add Video deadline exceeded' else 'Add Video interruption budget exhausted' end,p_runner_id);
    return false;
  end if;
  return public.yield_add_video_stage_pre_lifecycle_audit(
    p_job_id,p_website_id,p_job_attempts,p_claim_epoch,p_runner_id,p_expected_stage,p_next_stage,
    p_checkpoint_patch,p_retry_at,p_progress_pct,p_status_message);
end;
$$;
revoke all on function public.yield_add_video_stage(uuid,uuid,integer,bigint,text,text,text,jsonb,timestamptz,integer,text)
  from public,anon,authenticated;
grant execute on function public.yield_add_video_stage(uuid,uuid,integer,bigint,text,text,text,jsonb,timestamptz,integer,text)
  to service_role;

create or replace function public.recover_stale_add_video_jobs(
  p_stale_before timestamptz,p_scheduler_run_id uuid
) returns table(requeued_count integer,failed_count integer,reconciliation_count integer)
language plpgsql security definer set search_path=public as $$
declare
  job public.background_jobs%rowtype;
  failure_count integer;
  terminal_code text;
  before_reconciliation integer;
  after_reconciliation integer;
begin
  if p_stale_before is null or p_scheduler_run_id is null then
    raise exception 'Stale Add Video recovery identity is required' using errcode='22023';
  end if;
  requeued_count:=0;failed_count:=0;reconciliation_count:=0;
  for job in select candidate.* from public.background_jobs as candidate
    where candidate.job_type='add_video' and candidate.status in ('running','finalizing')
      and coalesce(candidate.locked_at,candidate.started_at,candidate.created_at)<p_stale_before
      and (candidate.lease_expires_at is null or candidate.lease_expires_at<=clock_timestamp())
    order by coalesce(candidate.lease_expires_at,candidate.locked_at),candidate.id
    for update of candidate skip locked
  loop
    terminal_code:=null;
    failure_count:=public.add_video_stage_failure_count(job.payload_json);
    if job.generation_contract_epoch is distinct from 2
       or job.generation_contract_version is distinct from 2
       or job.payload_json->>'generatorSchemaVersion' is distinct from '4' then
      terminal_code:='add_video_contract_unsupported';
    elsif failure_count is null then terminal_code:='add_video_retry_state_invalid';
    elsif clock_timestamp()>=job.created_at+interval '8 minutes' then terminal_code:='add_video_deadline_exceeded';
    elsif job.interruption_count+1>=3 then terminal_code:='add_video_interruption_budget_exhausted';
    elsif failure_count+1>=3 then terminal_code:='add_video_retry_budget_exhausted';
    elsif exists(select 1 from public.site_generation_media_slots where job_id=job.id and version_id is null
      and (status in ('ready','reconciliation_required') or provider_reservation_id is not null)) then
      terminal_code:='stale_add_video_provider_indeterminate';
    end if;
    if terminal_code is not null then
      select count(*) into before_reconciliation from public.site_generation_media_slots
        where job_id=job.id and status='reconciliation_required';
      if public.terminalize_add_video_job_internal(job.id,terminal_code,
        case terminal_code when 'add_video_deadline_exceeded' then 'Add Video deadline exceeded'
          when 'add_video_contract_unsupported' then 'Unsupported Add Video contract'
          else 'Add Video stale recovery exhausted' end,
        'scheduler:'||p_scheduler_run_id::text) then
        select count(*) into after_reconciliation from public.site_generation_media_slots
          where job_id=job.id and status='reconciliation_required';
        reconciliation_count:=reconciliation_count+greatest(after_reconciliation-before_reconciliation,0);
        failed_count:=failed_count+1;
      end if;
    else
      update public.background_jobs set status='pending',next_retry_at=clock_timestamp(),completed_at=null,
        status_message='Retrying after stale worker recovery',interruption_count=interruption_count+1,
        failure_attempts=failure_attempts+1,
        payload_json=public.add_video_set_stage_failure(payload_json,
          coalesce(payload_json->>'addVideoStage','planning/call'),failure_count+1),
        locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
      where id=job.id;
      requeued_count:=requeued_count+1;
    end if;
  end loop;
  return next;
end;
$$;
revoke all on function public.recover_stale_add_video_jobs(timestamptz,uuid)
  from public,anon,authenticated,service_role;

-- A ready callback for a terminal parent records its evidence but immediately makes the artifact
-- abandoned+cleanup_required. It can never publish an unattached ready row.
create or replace function public.reconcile_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_slot_id text,p_reservation_id uuid,p_action_key text,
  p_action text,p_actor text,p_reason text,p_evidence jsonb
) returns text
language plpgsql security definer set search_path=public as $$
declare
  slot public.site_generation_media_slots%rowtype;
  job public.background_jobs%rowtype;
  result_status text;
  terminal_parent boolean;
  request_identity uuid;
begin
  if p_action not in ('ready','retry','reject','cleanup') or nullif(btrim(p_action_key),'') is null
    or nullif(btrim(p_actor),'') is null or nullif(btrim(p_reason),'') is null
    or jsonb_typeof(p_evidence) is distinct from 'object' then
    raise exception 'Audited reconciliation action is invalid' using errcode='22023';
  end if;
  select * into job from public.background_jobs where id=p_job_id and website_id=p_website_id for update;
  if not found or job.job_type not in ('site_generation','add_video')
     or (job.job_type='site_generation' and job.generation_contract_epoch<>2) then return null; end if;
  select * into slot from public.site_generation_media_slots
    where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id for update;
  if not found or slot.provider_reservation_id is distinct from p_reservation_id then return null; end if;
  if slot.reconciliation_action_key=p_action_key then return slot.status; end if;
  if slot.status<>'reconciliation_required' or slot.reconciliation_action_key is not null then return null; end if;
  terminal_parent:=job.status in ('completed','failed','cancelled');
  result_status:=case when p_action='ready' and not terminal_parent then 'ready'
    when p_action='retry' and not terminal_parent then 'failed' else 'abandoned' end;
  if p_action='ready' and (nullif(p_evidence->>'storagePath','') is null
     or (p_evidence->>'contentHash') !~ '^[0-9a-f]{64}$') then
    raise exception 'Ready reconciliation requires durable storage evidence' using errcode='22023';
  end if;
  if p_action='retry' and slot.effect_certainty='definite_success' then
    raise exception 'Confirmed provider success cannot be recreated' using errcode='55000';
  end if;
  if p_action='retry' and coalesce(slot.provider_create_count,0)>=2 then
    raise exception 'Provider create cap is exhausted' using errcode='P0001';
  end if;
  update public.site_generation_media_slots set
    status=result_status,effect_certainty=case when p_action='ready' then 'definite_success' else 'definite_failure' end,
    storage_path=case when p_action='ready' then p_evidence->>'storagePath' else storage_path end,
    content_hash=case when p_action='ready' then p_evidence->>'contentHash' else content_hash end,
    asset_id=case when p_action='ready' then p_evidence->>'contentHash' else asset_id end,
    mime_type=case when p_action='ready' then coalesce(nullif(p_evidence->>'mimeType',''),mime_type) else mime_type end,
    reconciliation_actor=btrim(p_actor),reconciliation_reason=btrim(p_reason),reconciliation_evidence=p_evidence,
    reconciliation_action_key=p_action_key,reconciled_at=clock_timestamp(),reconciliation_required_at=null,
    reconciliation_deadline=null,cleanup_required=(p_action='cleanup' or (p_action='ready' and terminal_parent)),
    cleanup_completed_at=null,provider_reservation_id=case when p_action='retry' then null else provider_reservation_id end,
    provider_reserved_at=case when p_action='retry' then null else provider_reserved_at end,
    error_message=case when p_action='ready' and not terminal_parent then null else btrim(p_reason) end,
    abandoned_at=case when result_status='abandoned' then clock_timestamp() else null end,
    slot_locked_by=null,slot_lease_expires_at=null
  where id=slot.id;
  if p_action in ('ready','retry') and not terminal_parent and job.status='pending' and job.completed_at is null then
    update public.background_jobs set next_retry_at=clock_timestamp(),status_message='Media reconciliation resolved: '||p_action
      where id=p_job_id;
  end if;
  request_identity:=coalesce(job.generation_request_id,job.request_id,job.id);
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
  ) values(
    p_action_key,p_job_id,p_website_id,request_identity,2,job.claim_epoch,'media',
    case when job.job_type='add_video' then job.attempts else job.stage_attempts end,
    'reconciled','provider_reconciliation_'||p_action,
    case when p_action='ready' then 'definite_success' else 'definite_failure' end,
    case when p_action='retry' then 'retry' when p_action='cleanup' or terminal_parent then 'cleanup' else 'manual' end,
    'info',false,p_actor,clock_timestamp(),jsonb_build_object('slotId',p_slot_id,
      'reservationId',p_reservation_id,'action',p_action,'terminalParent',terminal_parent,
      'actor',btrim(p_actor),'reason',btrim(p_reason),'evidence',p_evidence)
  ) on conflict(event_key) do nothing;
  return result_status;
end;
$$;
revoke all on function public.reconcile_generation_media_slot_epoch(uuid,uuid,text,uuid,text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.reconcile_generation_media_slot_epoch(uuid,uuid,text,uuid,text,text,text,text,jsonb)
  to service_role;

create or replace function public.reconcile_due_add_video_media(
  p_limit integer default 100,p_actor text default 'scheduler:bucket1-add-video-reconciliation'
) returns integer language plpgsql security definer set search_path=public as $$
declare
  job public.background_jobs%rowtype;
  processed integer:=0;
  candidate_job_id uuid;
begin
  if p_limit<1 or p_limit>1000 or nullif(btrim(p_actor),'') is null then
    raise exception 'Invalid Add Video reconciliation bounds' using errcode='22023';
  end if;
  for candidate_job_id in
    select distinct parent.id from public.background_jobs as parent
    join public.site_generation_media_slots as slot on slot.job_id=parent.id
    where parent.job_type='add_video' and slot.status='reconciliation_required'
      and slot.reconciliation_deadline<=clock_timestamp()
    order by parent.id limit p_limit
  loop
    select parent.* into job from public.background_jobs as parent
      where parent.id=candidate_job_id for update of parent skip locked;
    if not found then continue; end if;
    begin
      if public.terminalize_add_video_job_internal(job.id,'add_video_reconciliation_deadline_exceeded',
        'Add Video provider reconciliation expired',p_actor) then processed:=processed+1; end if;
    exception when others then
      continue;
    end;
  end loop;
  return processed;
end;
$$;
revoke all on function public.reconcile_due_add_video_media(integer,text) from public,anon,authenticated;
grant execute on function public.reconcile_due_add_video_media(integer,text) to service_role;

-- Admission must never accept work that no compatible execution target can claim. The
-- database, not the caller, owns last_seen; two minutes is the exact freshness lease.
create table public.background_job_runner_capabilities (
  runner_id text primary key check (nullif(btrim(runner_id),'') is not null),
  capability integer not null check (capability between 1 and 2),
  browser_ready boolean not null,
  last_seen timestamptz not null
);
alter table public.background_job_runner_capabilities enable row level security;
revoke all on table public.background_job_runner_capabilities
  from public,anon,authenticated,service_role;

create or replace function public.heartbeat_background_job_runner_capability(
  p_runner_id text,p_capability integer,p_browser_ready boolean
) returns timestamptz language plpgsql security definer set search_path=public as $$
declare observed_at timestamptz:=clock_timestamp();
begin
  if nullif(btrim(p_runner_id),'') is null or p_capability not between 1 and 2
     or p_browser_ready is null then
    raise exception 'Runner capability heartbeat requires runner ID, capability 1 or 2, and browser readiness'
      using errcode='22023';
  end if;
  insert into public.background_job_runner_capabilities(runner_id,capability,browser_ready,last_seen)
  values(btrim(p_runner_id),p_capability,p_browser_ready,observed_at)
  on conflict (runner_id) do update set capability=excluded.capability,
    browser_ready=excluded.browser_ready,last_seen=excluded.last_seen;
  return observed_at;
end;
$$;
revoke all on function public.heartbeat_background_job_runner_capability(text,integer,boolean)
  from public,anon,authenticated;
grant execute on function public.heartbeat_background_job_runner_capability(text,integer,boolean)
  to service_role;

create or replace function public.has_fresh_epoch2_generation_runner()
returns boolean language sql volatile security definer set search_path=public as $$
  select exists(
    select 1 from public.background_job_runner_capabilities as runner
    where runner.capability=2 and runner.browser_ready
      and runner.last_seen>=clock_timestamp()-interval '2 minutes'
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
    raise exception 'Epoch-2 generation admission rejected: no fresh browser-ready epoch-2 runner capability heartbeat'
      using errcode='55000',
        hint='Start a compatible browser worker and call heartbeat_background_job_runner_capability(runner_id,2,true), then retry.';
  end if;
  return new;
end;
$$;
revoke all on function public.require_epoch2_generation_runner()
  from public,anon,authenticated,service_role;

drop trigger if exists background_jobs_epoch2_runner_admission on public.background_jobs;
create trigger background_jobs_epoch2_runner_admission
before insert or update of job_type,generation_contract_epoch on public.background_jobs
for each row execute function public.require_epoch2_generation_runner();

comment on table public.background_job_runner_capabilities is
  'Durable, RPC-owned worker capability heartbeats. Epoch-2 admission requires browser_ready and last_seen within two minutes.';

-- Already-admitted work gets a bounded five-minute startup grace. Maintenance owns this
-- terminalization so admission outages cannot leave pending epoch-2 chains blocked forever.
create or replace function public.terminalize_unclaimable_epoch2_job(
  p_job_id uuid,p_actor text
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  job public.background_jobs%rowtype;
  terminal_at timestamptz:=clock_timestamp();
  terminal_text text:='Website generation is temporarily unavailable because no compatible browser worker is online.';
  terminal_payload jsonb;
  reconciliation_count integer;
begin
  if p_job_id is null or nullif(btrim(p_actor),'') is null then
    raise exception 'Unclaimable terminalization requires job and actor' using errcode='22023';
  end if;
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.job_type not in ('site_generation','add_video')
     or job.generation_contract_epoch<>2 or job.status<>'pending' then return false; end if;
  if public.has_fresh_epoch2_generation_runner()
     or job.created_at>terminal_at-interval '5 minutes' then return false; end if;
  if job.job_type='add_video' then
    return public.terminalize_add_video_job_internal(job.id,'epoch2_runner_capability_unavailable',
      terminal_text,p_actor);
  end if;

  reconciliation_count:=public.close_add_video_terminal_children(
    job.id,'epoch2_runner_capability_unavailable',terminal_at);
  if reconciliation_count<0 then return false; end if;
  terminal_payload:=jsonb_build_object(
    'schemaVersion',1,'kind','site-generation-terminal','status','failed',
    'jobId',job.id,'requestId',job.generation_request_id,'claimEpoch',job.claim_epoch,
    'message',terminal_text,'causeCode','epoch2_runner_capability_unavailable'
  );
  update public.messages set content=terminal_text
    where id=job.generation_handoff_message_id and trace_id=job.agent_trace_id and role='assistant';
  update public.agent_traces set status='error',
    error_message='epoch2_runner_capability_unavailable',completed_at=coalesce(completed_at,terminal_at)
    where id=job.agent_trace_id and website_id=job.website_id and status in ('running','completed','error');
  update public.background_jobs set status='failed',completed_at=terminal_at,next_retry_at=null,
    locked_at=null,locked_by=null,lease_expires_at=null,
    status_message=terminal_text,error_message='epoch2_runner_capability_unavailable',
    result_json=jsonb_build_object('status','failed','errorCode','epoch2_runner_capability_unavailable',
      'jobId',id,'requestId',generation_request_id,'claimEpoch',claim_epoch),
    generation_terminal_message_id=generation_handoff_message_id,
    generation_terminal_message_payload=terminal_payload,generation_terminal_message_at=terminal_at
  where id=job.id and status='pending';
  if not found then return false; end if;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
  ) values(
    job.id::text||':'||job.claim_epoch::text||':runner-capability-terminal',job.id,job.website_id,
    job.generation_request_id,2,job.claim_epoch,job.generation_stage,job.stage_attempts,
    'failed','epoch2_runner_capability_unavailable',
    case when reconciliation_count>0 then 'indeterminate' else 'none' end,
    'terminal_failure','error',true,p_actor,terminal_at,
    jsonb_build_object('graceSeconds',300,'heartbeatFreshnessSeconds',120,
      'childReconciliationCount',reconciliation_count)
  ) on conflict(event_key) do nothing;
  return true;
end;
$$;
revoke all on function public.terminalize_unclaimable_epoch2_job(uuid,text)
  from public,anon,authenticated,service_role;

-- Service-owned maintenance is deliberately separate from claiming. Every candidate owner uses
-- SKIP LOCKED, and per-row poison is isolated so a bad/locked row cannot stop other maintenance.
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

  -- No compatible execution target may strand an already-admitted pending epoch-2 row. Parent
  -- ownership is nonblocking and each terminal projection is isolated from unrelated maintenance.
  if not public.has_fresh_epoch2_generation_runner() then
    for candidate_id in
      select candidate.id from public.background_jobs as candidate
      where candidate.job_type in ('site_generation','add_video')
        and candidate.generation_contract_epoch=2 and candidate.status='pending'
        and candidate.created_at<=clock_timestamp()-interval '5 minutes'
      order by candidate.created_at,candidate.id limit p_limit
      for update of candidate skip locked
    loop
      begin
        if public.terminalize_unclaimable_epoch2_job(
          candidate_id,'scheduler:'||p_scheduler_run_id::text) then
          terminalized_count:=terminalized_count+1;
        end if;
      exception when others then
        continue;
      end;
    end loop;
  end if;

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

-- Claim-only dispatcher: candidate predicates are total and fail closed. No recovery,
-- reconciliation, quarantine, or child mutation is permitted in this RPC.
create or replace function public.claim_next_background_job(
  p_runner_id text,p_stale_before timestamptz,p_generation_contract_epoch integer,p_scheduler_run_id uuid
) returns setof public.background_jobs
language plpgsql security definer set search_path=public as $$
declare
  claimed public.background_jobs%rowtype;
  dispatch public.background_job_dispatch_state%rowtype;
  class_index integer;
  step integer;
  global_active integer;
  dispatch_seq bigint;
begin
  if nullif(btrim(p_runner_id),'') is null or p_generation_contract_epoch is null
     or p_generation_contract_epoch not in (1,2) or p_scheduler_run_id is null or p_stale_before is null then
    raise exception 'Runner, capability, stale threshold, and scheduler identity are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bucket1-background-dispatch',0));
  select * into dispatch from public.background_job_dispatch_state where singleton for update;
  select count(*) into global_active from public.background_jobs
    where job_type='site_generation' and generation_contract_epoch=2 and status='running'
      and lease_expires_at>clock_timestamp();
  for step in 1..4 loop
    class_index:=(dispatch.dispatch_cursor+step)%4;
    select candidate.* into claimed
    from public.background_jobs candidate
    join public.websites website on website.id=candidate.website_id
    where candidate.status='pending'
      and (candidate.next_retry_at is null or candidate.next_retry_at<=clock_timestamp())
      and candidate.scheduler_last_run_id is distinct from p_scheduler_run_id
      and not exists(select 1 from public.background_jobs predecessor
        where predecessor.chain_id=candidate.chain_id and predecessor.sequence_index<candidate.sequence_index
          and predecessor.status in ('pending','running','finalizing'))
      and (
        (class_index=0 and p_generation_contract_epoch=2 and candidate.job_type='site_generation'
          and candidate.generation_contract_epoch=2 and candidate.claim_epoch=0 and global_active<8)
        or (class_index=1 and candidate.job_type='enrichment_platform'
          and (candidate.attempts<candidate.max_attempts
            or candidate.payload_json->'resume_enrichment_finalization'='true'::jsonb))
        or (class_index=2 and p_generation_contract_epoch=2 and candidate.job_type='add_video'
          and candidate.generation_contract_epoch=2 and candidate.generation_contract_version=2
          and candidate.payload_json->>'generatorSchemaVersion'='4'
          and candidate.payload_json->>'addVideoStage' in (
            'planning/call','media/source-verify','media/create','media/poll',
            'media/materialize','composition/build','validation/run','persistence/commit')
          and public.add_video_stage_failure_count(candidate.payload_json) between 0 and 2
          and candidate.interruption_count<3
          and clock_timestamp()<candidate.created_at+interval '8 minutes')
        or (class_index=3 and p_generation_contract_epoch=2 and candidate.job_type='site_generation'
          and candidate.generation_contract_epoch=2 and candidate.claim_epoch>0 and global_active<8)
      )
      and (candidate.job_type not in ('site_generation','add_video') or not exists(
        select 1 from public.site_generation_media_slots slot
        where slot.job_id=candidate.id and slot.status='reconciliation_required'))
      and (candidate.job_type<>'site_generation' or (
        select count(*) from public.background_jobs active
        join public.websites active_site on active_site.id=active.website_id
        where active_site.user_id=website.user_id and active.job_type='site_generation'
          and active.generation_contract_epoch=2 and active.status='running'
          and active.lease_expires_at>clock_timestamp())<2)
    order by candidate.scheduler_last_dispatched_at nulls first,candidate.created_at,candidate.id
    limit 1 for update of candidate skip locked;
    exit when found;
  end loop;
  if claimed.id is null then return; end if;
  dispatch_seq:=dispatch.dispatch_sequence+1;
  update public.background_jobs set
    status='running',attempts=attempts+1,started_at=coalesce(started_at,clock_timestamp()),
    locked_at=clock_timestamp(),locked_by=p_runner_id,
    lease_expires_at=case when job_type='add_video'
      then least(clock_timestamp()+interval '10 minutes',created_at+interval '8 minutes')
      else clock_timestamp()+interval '10 minutes' end,
    next_retry_at=null,error_message=null,
    claim_epoch=case when job_type in ('site_generation','add_video') then claim_epoch+1 else claim_epoch end,
    generation_last_dispatched_at=case when job_type='site_generation' then clock_timestamp() else generation_last_dispatched_at end,
    generation_last_scheduler_run_id=case when job_type='site_generation' then p_scheduler_run_id else generation_last_scheduler_run_id end,
    scheduler_last_dispatched_at=clock_timestamp(),scheduler_last_run_id=p_scheduler_run_id,
    scheduler_dispatch_sequence=dispatch_seq,
    finalization_attempts=case when job_type='enrichment_platform'
      and payload_json->'resume_enrichment_finalization'='true'::jsonb then finalization_attempts+1 else finalization_attempts end,
    payload_json=case when job_type='enrichment_platform'
      then payload_json-'resume_enrichment_finalization' else payload_json end
  where id=claimed.id returning * into claimed;
  if claimed.job_type='add_video' then
    update public.site_generation_media_slots set claim_attempt=claimed.attempts,claimed_at=clock_timestamp()
      where job_id=claimed.id and status in ('planned','generating','ready');
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values(
      claimed.id::text||':'||claimed.claim_epoch::text||':add-video-claimed',claimed.id,claimed.website_id,
      coalesce(claimed.request_id,claimed.id),2,claimed.claim_epoch,
      case split_part(claimed.payload_json->>'addVideoStage','/',1)
        when 'composition' then 'composition' when 'validation' then 'validation'
        when 'persistence' then 'persistence' when 'media' then 'media' else 'planning' end,
      claimed.attempts,'claimed','server_claim','none','continue','info',false,p_runner_id,clock_timestamp(),
      jsonb_build_object('schedulerRunId',p_scheduler_run_id,'dispatchClass',class_index,'dispatchSequence',dispatch_seq)
    ) on conflict(event_key) do nothing;
  end if;
  update public.background_job_dispatch_state set dispatch_cursor=class_index,
    dispatch_sequence=dispatch_seq,updated_at=clock_timestamp() where singleton;
  if claimed.job_type='site_generation' then
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values(
      claimed.id::text||':'||claimed.claim_epoch::text||':claimed',claimed.id,claimed.website_id,
      claimed.generation_request_id,2,claimed.claim_epoch,claimed.generation_stage,claimed.stage_attempts,
      'claimed','server_claim','none','continue','info',false,p_runner_id,clock_timestamp(),
      jsonb_build_object('schedulerRunId',p_scheduler_run_id,'dispatchClass',class_index,'dispatchSequence',dispatch_seq)
    );
  end if;
  return next claimed;
end;
$$;
revoke all on function public.claim_next_background_job(text,timestamptz,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.claim_next_background_job(text,timestamptz,integer,uuid) to service_role;
comment on function public.claim_next_background_job(text,timestamptz,integer,uuid) is
  'Claim-only fair dispatcher. Lifecycle maintenance and Add Video quarantine run only through maintain_background_job_lifecycle.';
comment on function public.maintain_background_job_lifecycle(timestamptz,uuid,integer) is
  'Service-only bounded nonblocking recovery, reconciliation expiry, and unsupported/expired Add Video quarantine.';

create or replace function public.complete_generation_media_cleanup(
  p_storage_path text,p_actor text
) returns integer language plpgsql security definer set search_path=public as $$
declare completed_count integer;
begin
  if nullif(btrim(p_storage_path),'') is null or nullif(btrim(p_actor),'') is null then
    raise exception 'Cleanup storage path and actor are required' using errcode='22023';
  end if;
  update public.site_generation_media_slots
  set cleanup_completed_at=clock_timestamp(),reconciliation_actor=btrim(p_actor)
  where storage_path=p_storage_path and cleanup_required and cleanup_completed_at is null
    and status='abandoned';
  get diagnostics completed_count=row_count;
  return completed_count;
end;
$$;
revoke all on function public.complete_generation_media_cleanup(text,text)
  from public,anon,authenticated;
grant execute on function public.complete_generation_media_cleanup(text,text) to service_role;

-- Cleanup is now convergent: reference checks run immediately before deletion and the ledger is
-- marked complete only after physical storage removal succeeds.
do $$
begin
  if exists(select 1 from cron.job where jobname='obra-sweep-add-video-orphans') then
    perform cron.unschedule('obra-sweep-add-video-orphans');
  end if;
  perform cron.schedule(
    'obra-sweep-add-video-orphans','17 * * * *',
    $command$
      insert into public.background_job_cron_requests(schedule_name,request_id)
      select 'obra-sweep-add-video-orphans',net.http_post(
        url := 'https://obratech.co/api/internal/sweep-add-video-orphans',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-add-video-orphan-sweeper-secret',coalesce((select decrypted_secret from vault.decrypted_secrets where name='ADD_VIDEO_ORPHAN_SWEEPER_SECRET' limit 1),'')
        ),
        body := '{"dryRun":false}'::jsonb,
        timeout_milliseconds := 55000
      );
    $command$
  );
end
$$;
