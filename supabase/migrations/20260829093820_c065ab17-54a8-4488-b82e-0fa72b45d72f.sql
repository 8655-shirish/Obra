-- Stage schema-v4 Add Video on the existing background_jobs queue. Each claim owns one
-- external attempt (or one bounded deterministic transition); healthy yields do not consume
-- the failure budget. Historical website schemas and readers are unchanged.

update public.background_jobs job
set generation_contract_epoch=2, generation_contract_version=2,
    payload_json=jsonb_set(job.payload_json || jsonb_build_object('generatorSchemaVersion',4),
      '{addVideoStage}',to_jsonb('planning/call'::text),true)
from public.website_versions source
where job.job_type='add_video' and job.status in ('pending','running')
  and source.id=job.source_version_id and source.website_id=job.website_id
  and source.config_json->>'generatorSchemaVersion'='4';

create or replace function public.yield_add_video_stage(
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
    (p_expected_stage='composition/build' and p_next_stage in ('composition/build','validation/run')) or
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
      (p_expected_stage='composition/build' and value in ('resourceBindings')) or
      (p_expected_stage='validation/run' and value in ('candidateHash','validationInput','validationAttestation'))
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
revoke all on function public.yield_add_video_stage(uuid,uuid,integer,bigint,text,text,text,jsonb,timestamptz,integer,text)
  from public,anon,authenticated;
grant execute on function public.yield_add_video_stage(uuid,uuid,integer,bigint,text,text,text,jsonb,timestamptz,integer,text)
  to service_role;
comment on function public.yield_add_video_stage(uuid,uuid,integer,bigint,text,text,text,jsonb,timestamptz,integer,text) is
  'Exact attempts+epoch+runner fenced Add Video checkpoint and healthy queue yield; never consumes failure budget.';

-- Add Video terminal/retry settlement has exact attempts+epoch+runner fencing. Generic
-- settlement remains untouched and keeps its epoch-2 site-generation fail-closed guard.
create or replace function public.settle_add_video_job_epoch(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,p_status text,
  p_progress_pct integer,p_result_json jsonb,p_payload_json jsonb,p_error_message text,
  p_status_message text,p_completed_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  if p_status not in ('pending','failed','cancelled') then
    raise exception 'Invalid Add Video settlement status' using errcode='22023';
  end if;
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video' or job.status<>'running'
     or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id then return false; end if;
  if p_status in ('failed','cancelled') then
    update public.site_generation_media_slots set
      status=case when provider_reservation_id is not null or provider_operation_id is not null
        or effect_certainty in ('indeterminate','definite_success') then 'reconciliation_required' else 'abandoned' end,
      effect_certainty=case when provider_reservation_id is not null or provider_operation_id is not null
        or effect_certainty in ('indeterminate','definite_success') then 'indeterminate' else effect_certainty end,
      reconciliation_required_at=case when provider_reservation_id is not null or provider_operation_id is not null
        or effect_certainty in ('indeterminate','definite_success') then coalesce(reconciliation_required_at,clock_timestamp()) else null end,
      reconciliation_deadline=case when provider_reservation_id is not null or provider_operation_id is not null
        or effect_certainty in ('indeterminate','definite_success') then coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour') else null end,
      error_message=coalesce(p_error_message,'Add Video ended'),
      abandoned_at=case when provider_reservation_id is null and provider_operation_id is null
        and effect_certainty in ('none','not_started','definite_failure') then clock_timestamp() else null end
    where job_id=job.id and version_id is null and status in ('planned','generating','ready','failed');
  end if;
  update public.background_jobs set status=p_status,progress_pct=p_progress_pct,
    result_json=p_result_json,payload_json=case when p_status in ('pending','failed') then
      jsonb_set(coalesce(p_payload_json,'{}'::jsonb),
        array['stageFailures',coalesce(job.payload_json->>'addVideoStage','planning/call')],
        to_jsonb(coalesce((job.payload_json#>>array['stageFailures',coalesce(job.payload_json->>'addVideoStage','planning/call')])::integer,0)+1),true)
      else coalesce(p_payload_json,'{}'::jsonb) end,
    error_message=p_error_message,status_message=left(p_status_message,500),completed_at=p_completed_at,
    next_retry_at=case when p_status='pending' then nullif(p_payload_json->>'next_retry_at','')::timestamptz else null end,
    locked_at=null,locked_by=null,lease_expires_at=null,
    failure_attempts=failure_attempts+case when p_status in ('pending','failed') then 1 else 0 end
  where id=job.id and status='running' and attempts=p_job_attempts and claim_epoch=p_claim_epoch
    and locked_by=p_runner_id;
  return found;
end $$;
revoke all on function public.settle_add_video_job_epoch(uuid,uuid,integer,bigint,text,text,integer,jsonb,jsonb,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.settle_add_video_job_epoch(uuid,uuid,integer,bigint,text,text,integer,jsonb,jsonb,text,text,timestamptz)
  to service_role;

-- Generic generation reconciliation must never consume Add Video provider rows.
create or replace function public.reconcile_due_generation_media(
  p_limit integer default 100,p_actor text default 'scheduler:bucket1-reconciliation'
) returns table(processed_count integer,terminalized_count integer,requeued_count integer)
language plpgsql security definer set search_path=public as $$
declare slot public.site_generation_media_slots%rowtype;
declare job public.background_jobs%rowtype;
declare action_key text;
declare terminal_text text := 'We could not finish this website. Please try again.';
declare terminal_payload jsonb;
begin
  if p_limit<1 or p_limit>1000 or nullif(btrim(p_actor),'') is null then
    raise exception 'Invalid reconciliation sweep bounds' using errcode='22023';
  end if;
  processed_count:=0; terminalized_count:=0; requeued_count:=0;
  for slot in
    select * from public.site_generation_media_slots
    where status='reconciliation_required' and reconciliation_deadline<=clock_timestamp()
      and exists(select 1 from public.background_jobs generation_job
        where generation_job.id=site_generation_media_slots.job_id
          and generation_job.job_type='site_generation')
    order by reconciliation_deadline,id limit p_limit for update skip locked
  loop
    select * into job from public.background_jobs where id=slot.job_id and website_id=slot.website_id for update;
    action_key:=slot.job_id::text||':'||slot.slot_id||':'||slot.provider_reservation_id::text||':deadline';
    update public.site_generation_media_slots set status='abandoned',abandoned_at=clock_timestamp(),
      reconciliation_actor=btrim(p_actor),reconciliation_reason='Provider certainty deadline expired',
      reconciliation_evidence=jsonb_build_object('deadline',slot.reconciliation_deadline,'required',slot.required),
      reconciliation_action_key=action_key,reconciled_at=clock_timestamp(),
      reconciliation_required_at=null,reconciliation_deadline=null,cleanup_required=true,
      cleanup_completed_at=null,slot_locked_by=null,slot_lease_expires_at=null,
      error_message='Provider certainty deadline expired; cleanup required'
    where id=slot.id;
    processed_count:=processed_count+1;
    if job.status in ('pending','running','finalizing') then
      if slot.required then
        terminal_payload:=jsonb_build_object(
          'schemaVersion',1,'kind','site-generation-terminal','status','failed',
          'jobId',job.id,'requestId',job.generation_request_id,'claimEpoch',job.claim_epoch,
          'message',terminal_text,'causeCode','media_reconciliation_deadline_exceeded'
        );
        update public.messages set content=terminal_text
        where id=job.generation_handoff_message_id and trace_id=job.agent_trace_id and role='assistant';
        if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;
        update public.agent_traces set status='error',error_message='media_reconciliation_deadline_exceeded',
          completed_at=coalesce(completed_at,clock_timestamp())
        where id=job.agent_trace_id and website_id=job.website_id and status in ('running','completed','error');
        if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;
        update public.background_jobs set status='failed',completed_at=clock_timestamp(),next_retry_at=null,
          locked_at=null,locked_by=null,lease_expires_at=null,status_message='Generation media reconciliation expired',
          error_message='media_reconciliation_deadline_exceeded',
          result_json=jsonb_build_object('status','failed','errorCode','media_reconciliation_deadline_exceeded',
            'jobId',id,'requestId',generation_request_id,'claimEpoch',claim_epoch),
          generation_terminal_message_id=generation_handoff_message_id,
          generation_terminal_message_payload=terminal_payload,generation_terminal_message_at=clock_timestamp()
        where id=job.id;
        terminalized_count:=terminalized_count+1;
      else
        update public.background_jobs set status='pending',completed_at=null,next_retry_at=clock_timestamp(),
          locked_at=null,locked_by=null,lease_expires_at=null,
          status_message='Optional media reconciliation expired; resuming without it'
        where id=job.id;
        requeued_count:=requeued_count+1;
      end if;
    end if;
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,unit_id,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values (
      action_key,job.id,job.website_id,job.generation_request_id,2,job.claim_epoch,'media',job.stage_attempts,
      slot.slot_id,'reconciled','provider_reconciliation_deadline','indeterminate','cleanup',
      case when slot.required then 'error' else 'warning' end,slot.required,p_actor,clock_timestamp(),
      jsonb_build_object('reservationId',slot.provider_reservation_id,'required',slot.required,'terminalStatus',job.status)
    );
  end loop;
  return next;
end;
$$;
revoke all on function public.reconcile_due_generation_media(integer,text)
  from public,anon,authenticated;
grant execute on function public.reconcile_due_generation_media(integer,text) to service_role;

-- Add Video provider uncertainty converges independently and uses Add Video request identity.
create or replace function public.reconcile_due_add_video_media(
  p_limit integer default 100,p_actor text default 'scheduler:bucket1-add-video-reconciliation'
) returns integer language plpgsql security definer set search_path=public as $$
declare slot public.site_generation_media_slots%rowtype; job public.background_jobs%rowtype; processed integer:=0;
begin
  if p_limit<1 or p_limit>1000 or nullif(btrim(p_actor),'') is null then
    raise exception 'Invalid Add Video reconciliation bounds' using errcode='22023';
  end if;
  for slot in select media.* from public.site_generation_media_slots media
    join public.background_jobs parent on parent.id=media.job_id and parent.job_type='add_video'
    where media.status='reconciliation_required' and media.reconciliation_deadline<=clock_timestamp()
    order by media.reconciliation_deadline,media.id limit p_limit for update of media skip locked
  loop
    select * into job from public.background_jobs where id=slot.job_id for update;
    update public.site_generation_media_slots set status='abandoned',abandoned_at=clock_timestamp(),
      reconciliation_actor=btrim(p_actor),reconciliation_reason='Add Video provider certainty deadline expired',
      reconciliation_evidence=jsonb_build_object('deadline',slot.reconciliation_deadline,
        'reservationId',slot.provider_reservation_id,'operationId',slot.provider_operation_id),
      reconciliation_action_key=slot.job_id::text||':'||slot.slot_id||':add-video-deadline',
      reconciled_at=clock_timestamp(),reconciliation_required_at=null,reconciliation_deadline=null,
      cleanup_required=true,cleanup_completed_at=null,slot_locked_by=null,slot_lease_expires_at=null,
      error_message='Provider certainty unresolved at deadline; terminal cleanup required'
    where id=slot.id;
    update public.background_jobs set status='failed',completed_at=coalesce(completed_at,clock_timestamp()),
      next_retry_at=null,locked_at=null,locked_by=null,lease_expires_at=null,
      status_message='Add Video provider reconciliation expired',
      error_message='add_video_reconciliation_deadline_exceeded',
      result_json=coalesce(result_json,jsonb_build_object('status','failed',
        'errorCode','add_video_reconciliation_deadline_exceeded','requestId',request_id))
    where id=job.id and status in ('pending','running','failed');
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,unit_id,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values (slot.job_id::text||':'||slot.slot_id||':add-video-deadline',job.id,job.website_id,
      job.request_id,2,job.claim_epoch,'media',job.attempts,slot.slot_id,'reconciled',
      'provider_reconciliation_deadline','indeterminate','cleanup','error',true,btrim(p_actor),
      clock_timestamp(),jsonb_build_object('reservationId',slot.provider_reservation_id,
        'operationId',slot.provider_operation_id)) on conflict(event_key) do nothing;
    processed:=processed+1;
  end loop;
  return processed;
end $$;
revoke all on function public.reconcile_due_add_video_media(integer,text) from public,anon,authenticated;
grant execute on function public.reconcile_due_add_video_media(integer,text) to service_role;

-- Stale Add Video claims use failure_attempts, not healthy claim count, and unresolved provider
-- effects are quarantined before any requeue. The existing site-generation recovery remains first.
create or replace function public.recover_stale_add_video_jobs(
  p_stale_before timestamptz,p_scheduler_run_id uuid
) returns table(requeued_count integer,failed_count integer,reconciliation_count integer)
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype; unresolved integer;
begin
  requeued_count:=0;failed_count:=0;reconciliation_count:=0;
  for job in select * from public.background_jobs where job_type='add_video' and status='running'
    and ((lease_expires_at is not null and lease_expires_at<=clock_timestamp())
      or (lease_expires_at is null and coalesce(locked_at,started_at,created_at)<p_stale_before))
    order by coalesce(lease_expires_at,locked_at),id for update skip locked
  loop
    update public.site_generation_media_slots set status='reconciliation_required',effect_certainty='indeterminate',
      reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      error_message='Stale Add Video worker left unresolved provider certainty'
    where job_id=job.id and version_id is null and status='generating'
      and (provider_reservation_id is not null or provider_operation_id is not null
        or effect_certainty in ('indeterminate','definite_success'));
    get diagnostics unresolved=row_count;
    reconciliation_count:=reconciliation_count+unresolved;
    if unresolved>0 then
      update public.background_jobs set status='failed',completed_at=clock_timestamp(),next_retry_at=null,
        status_message='Needs provider reconciliation',error_message='stale_add_video_provider_indeterminate',
        locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
      where id=job.id;
      failed_count:=failed_count+1;
    elsif coalesce((job.payload_json#>>array['stageFailures',coalesce(job.payload_json->>'addVideoStage','planning/call')])::integer,0)+1>=3 then
      update public.background_jobs set status='failed',completed_at=clock_timestamp(),next_retry_at=null,
        status_message='Failed after stale worker recovery',error_message=coalesce(error_message,'Worker lease expired'),
        interruption_count=interruption_count+1,locked_at=null,locked_by=null,lease_expires_at=null,
        scheduler_last_run_id=p_scheduler_run_id
      where id=job.id;
      failed_count:=failed_count+1;
    else
      update public.background_jobs set status='pending',next_retry_at=clock_timestamp(),
        status_message='Retrying after stale worker recovery',interruption_count=interruption_count+1,
        payload_json=jsonb_set(payload_json,array['stageFailures',coalesce(payload_json->>'addVideoStage','planning/call')],
          to_jsonb(coalesce((payload_json#>>array['stageFailures',coalesce(payload_json->>'addVideoStage','planning/call')])::integer,0)+1),true),
        locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
      where id=job.id;
      requeued_count:=requeued_count+1;
    end if;
  end loop;
  return next;
end $$;
revoke all on function public.recover_stale_add_video_jobs(timestamptz,uuid) from public,anon,authenticated,service_role;

-- Preserve fair dispatch while making claim identity distinct from failure budget for Add Video.
create or replace function public.claim_next_background_job(
  p_runner_id text,p_stale_before timestamptz,p_generation_contract_epoch integer,p_scheduler_run_id uuid
) returns setof public.background_jobs
language plpgsql security definer set search_path=public as $$
declare claimed public.background_jobs%rowtype;
declare dispatch public.background_job_dispatch_state%rowtype;
declare class_index integer;
declare step integer;
declare global_active integer;
declare dispatch_seq bigint;
begin
  if nullif(btrim(p_runner_id),'') is null or p_generation_contract_epoch not in (1,2)
     or p_scheduler_run_id is null or p_stale_before is null then
    raise exception 'Runner, capability, stale threshold, and scheduler identity are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bucket1-background-dispatch',0));
  perform * from public.reconcile_due_generation_media(100,'scheduler:'||p_scheduler_run_id::text);
  perform public.reconcile_due_add_video_media(100,'scheduler:'||p_scheduler_run_id::text);
  perform * from public.recover_stale_add_video_jobs(p_stale_before,p_scheduler_run_id);
  perform * from public.recover_stale_background_jobs(p_stale_before,p_scheduler_run_id);
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
        (class_index=0 and p_generation_contract_epoch=2 and candidate.job_type='site_generation' and candidate.generation_contract_epoch=2
          and candidate.claim_epoch=0 and global_active<8)
        or (class_index=1 and candidate.job_type='enrichment_platform'
          and (candidate.attempts<candidate.max_attempts
            or candidate.payload_json->'resume_enrichment_finalization'='true'::jsonb))
        or (class_index=2 and p_generation_contract_epoch=2 and candidate.job_type='add_video'
          and candidate.generation_contract_epoch=2 and candidate.generation_contract_version=2
          and candidate.payload_json->>'generatorSchemaVersion'='4'
          and candidate.payload_json->>'addVideoStage' in ('planning/call','media/source-verify','media/create','media/poll','media/materialize','composition/build','validation/run','persistence/commit')
          and coalesce((candidate.payload_json#>>array['stageFailures',coalesce(candidate.payload_json->>'addVideoStage','planning/call')])::integer,0)<3)
        or (class_index=3 and p_generation_contract_epoch=2 and candidate.job_type='site_generation' and candidate.generation_contract_epoch=2
          and candidate.claim_epoch>0 and global_active<8)
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
    locked_at=clock_timestamp(),locked_by=p_runner_id,lease_expires_at=clock_timestamp()+interval '10 minutes',
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
    ) values (
      claimed.id::text||':'||claimed.claim_epoch::text||':add-video-claimed',claimed.id,claimed.website_id,
      claimed.request_id,2,claimed.claim_epoch,
      case split_part(coalesce(claimed.payload_json->>'addVideoStage','planning/call'),'/',1)
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
    ) values (
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
  'Fair four-class server claim; Add Video claim epochs/attempts are ownership fences while failure_attempts alone is its retry budget.';


-- Add Video stage execution requires the same attempts+epoch+runner capability on every
-- media effect transition. Legacy attempts-only overloads stay inaccessible.
create or replace function public.reserve_add_video_media_create_epoch(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,
  p_slot_id text,p_provider text,p_request_hash text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video'
     or job.status<>'running' or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id then
    raise exception 'Add Video media ownership was lost' using errcode='40001';
  end if;
  return public.reserve_add_video_media_create(p_job_id,p_website_id,p_job_attempts,p_slot_id,p_provider,p_request_hash);
end $$;

create or replace function public.record_add_video_media_operation_epoch(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,
  p_slot_id text,p_reservation_id uuid,p_provider_operation_id text
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video'
     or job.status<>'running' or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id then return false; end if;
  return public.record_add_video_media_operation(p_job_id,p_website_id,p_job_attempts,p_slot_id,p_reservation_id,p_provider_operation_id);
end $$;

create or replace function public.settle_add_video_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,
  p_slot_id text,p_reservation_id uuid,p_provider_operation_id text,p_status text,
  p_error_message text,p_effect_certainty text
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video'
     or job.status<>'running' or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id then return false; end if;
  return public.settle_add_video_media_slot(p_job_id,p_website_id,p_job_attempts,p_slot_id,
    p_reservation_id,p_provider_operation_id,p_status,p_error_message,p_effect_certainty);
end $$;

create or replace function public.record_ready_add_video_media_epoch(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,
  p_slot_id text,p_reservation_id uuid,p_provider_operation_id text,p_storage_path text,
  p_source_slot_id text,p_content_hash text,p_byte_size bigint,p_duration_ms integer,p_width integer,
  p_height integer,p_video_codec text,p_video_profile text,p_has_audio boolean,p_audio_codec text,
  p_validator_version text
) returns uuid language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video'
     or job.status<>'running' or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id then
    raise exception 'Add Video media ownership was lost' using errcode='40001';
  end if;
  return public.record_ready_add_video_media(p_job_id,p_website_id,p_job_attempts,p_slot_id,
    p_reservation_id,p_provider_operation_id,p_storage_path,p_source_slot_id,p_content_hash,
    p_byte_size,p_duration_ms,p_width,p_height,p_video_codec,p_video_profile,p_has_audio,
    p_audio_codec,p_validator_version);
end $$;

revoke all on function public.reserve_add_video_media_create(uuid,uuid,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.record_add_video_media_operation(uuid,uuid,integer,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.settle_add_video_media_slot(uuid,uuid,integer,text,uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.record_ready_add_video_media(uuid,uuid,integer,text,uuid,text,text,text,text,bigint,integer,integer,integer,text,text,boolean,text,text) from public,anon,authenticated,service_role;
revoke all on function public.reserve_add_video_media_create_epoch(uuid,uuid,integer,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function public.record_add_video_media_operation_epoch(uuid,uuid,integer,bigint,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.settle_add_video_media_slot_epoch(uuid,uuid,integer,bigint,text,text,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.record_ready_add_video_media_epoch(uuid,uuid,integer,bigint,text,text,uuid,text,text,text,text,bigint,integer,integer,integer,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.reserve_add_video_media_create_epoch(uuid,uuid,integer,bigint,text,text,text,text) to service_role;
grant execute on function public.record_add_video_media_operation_epoch(uuid,uuid,integer,bigint,text,text,uuid,text) to service_role;
grant execute on function public.settle_add_video_media_slot_epoch(uuid,uuid,integer,bigint,text,text,uuid,text,text,text,text) to service_role;
grant execute on function public.record_ready_add_video_media_epoch(uuid,uuid,integer,bigint,text,text,uuid,text,text,text,text,bigint,integer,integer,integer,text,text,boolean,text,text) to service_role;

-- Final DB-only commit is also fenced by the exact stage claim capability.
create or replace function public.commit_add_video_to_version_epoch(
  p_job_id uuid,p_website_id uuid,p_target_version_id uuid,p_job_attempts integer,
  p_claim_epoch bigint,p_runner_id text,p_expected_revision bigint,p_candidate_hash text,
  p_config_json jsonb,p_media_slot_id uuid,p_edit_event_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.target_version_id<>p_target_version_id
     or job.job_type<>'add_video' or job.status<>'running' or job.attempts<>p_job_attempts
     or job.claim_epoch<>p_claim_epoch or job.locked_by is distinct from p_runner_id
     or coalesce(job.payload_json->>'addVideoStage','planning/call')<>'persistence/commit' then
    raise exception 'Add Video finalization ownership was lost' using errcode='40001';
  end if;
  return public.commit_add_video_to_version(p_job_id,p_website_id,p_target_version_id,p_job_attempts,
    p_expected_revision,p_candidate_hash,p_config_json,p_media_slot_id,p_edit_event_payload);
end $$;
revoke all on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.commit_add_video_to_version_epoch(uuid,uuid,uuid,integer,bigint,text,bigint,text,jsonb,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.commit_add_video_to_version_epoch(uuid,uuid,uuid,integer,bigint,text,bigint,text,jsonb,uuid,jsonb)
  to service_role;

-- Cancellation preserves confirmed or possible provider effects for reconciliation and only
-- abandons effects that are certainly absent.
create or replace function public.cancel_add_video_job(
  p_website_id uuid,p_chain_id uuid,p_request_id uuid
) returns table(job_id uuid,chain_id uuid,source_version_id uuid,target_version_id uuid,
  status text,result jsonb,error_code text)
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  select * into job from public.background_jobs b where b.website_id=p_website_id
    and b.chain_id=p_chain_id and b.request_id=p_request_id and b.job_type='add_video' for update;
  if not found then raise exception 'Add Video request not found' using errcode='P0001'; end if;
  if job.status in ('pending','running') then
    update public.site_generation_media_slots set status='abandoned',abandoned_at=clock_timestamp(),
      error_message='Cancelled by user'
    where job_id=job.id and website_id=p_website_id and version_id is null
      and status in ('planned','generating','failed') and provider_reservation_id is null
      and provider_operation_id is null and effect_certainty in ('none','not_started','definite_failure');
    update public.site_generation_media_slots set status='reconciliation_required',
      effect_certainty='indeterminate',reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      error_message='Cancelled Add Video has unresolved provider certainty'
    where job_id=job.id and website_id=p_website_id and version_id is null
      and status in ('generating','reconciliation_required')
      and (provider_reservation_id is not null or provider_operation_id is not null
        or effect_certainty in ('indeterminate','definite_success'));
    update public.site_generation_media_slots set cleanup_required=true,cleanup_completed_at=null
      where job_id=job.id and website_id=p_website_id and version_id is null and status='ready';
    update public.background_jobs set status='cancelled',status_message='Cancelled',error_message=null,
      completed_at=clock_timestamp(),cancelled_at=clock_timestamp(),locked_at=null,locked_by=null,
      lease_expires_at=null,next_retry_at=null,
      result_json=coalesce(result_json,jsonb_build_object('status','cancelled','errorCode','cancelled'))
    where id=job.id returning * into job;
  end if;
  return query select job.id,job.chain_id,job.source_version_id,job.target_version_id,
    job.status,job.result_json,coalesce(job.result_json->>'errorCode',job.payload_json->>'errorCode');
end $$;
revoke all on function public.cancel_add_video_job(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.cancel_add_video_job(uuid,uuid,uuid) to service_role;


create or replace function public.claim_add_video_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,
  p_slot_id text,p_kind text,p_role text,p_provenance text,p_required boolean,
  p_proof_eligible boolean,p_source_slot_id text,p_poster_slot_id text
) returns uuid language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype; slot public.site_generation_media_slots%rowtype; result_id uuid;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video' or job.status<>'running'
     or job.attempts<>p_job_attempts or job.claim_epoch<>p_claim_epoch
     or job.locked_by is distinct from p_runner_id then
    raise exception 'Add Video media ownership was lost' using errcode='40001';
  end if;
  select * into slot from public.site_generation_media_slots where job_id=p_job_id
    and website_id=p_website_id and slot_id=p_slot_id for update;
  if not found or slot.kind<>p_kind or slot.role<>p_role or slot.provenance<>p_provenance
     or slot.required<>p_required or slot.proof_eligible<>p_proof_eligible
     or slot.source_slot_id is distinct from p_source_slot_id
     or slot.poster_slot_id is distinct from p_poster_slot_id then
    raise exception 'Add Video media slot identity mismatch' using errcode='40001';
  end if;
  if slot.status='ready' then return slot.id; end if;
  if slot.status not in ('planned','failed','generating')
     or (slot.status='generating' and slot.claim_attempt<>p_job_attempts) then
    raise exception 'Add Video media slot cannot be claimed' using errcode='40001';
  end if;
  update public.site_generation_media_slots set status='generating',claim_attempt=p_job_attempts,
    slot_claim_epoch=slot_claim_epoch+1,claimed_at=clock_timestamp(),error_message=null
    where id=slot.id returning id into result_id;
  return result_id;
end $$;
revoke all on function public.claim_add_video_media_slot_epoch(uuid,uuid,integer,bigint,text,text,text,text,text,boolean,boolean,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_add_video_media_slot_epoch(uuid,uuid,integer,bigint,text,text,text,text,text,boolean,boolean,text,text)
  to service_role;

create or replace function public.interrupt_add_video_job_epoch(
  p_job_id uuid,p_job_attempts integer,p_claim_epoch bigint,p_runner_id text,
  p_cause_code text,p_retry_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype; unresolved boolean;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.job_type<>'add_video' or job.status<>'running' or job.attempts<>p_job_attempts
     or job.claim_epoch<>p_claim_epoch or job.locked_by is distinct from p_runner_id then return false; end if;
  update public.site_generation_media_slots set status='reconciliation_required',effect_certainty='indeterminate',
    reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
    reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
    error_message='Interrupted Add Video has unresolved provider certainty'
  where job_id=job.id and version_id is null and status='generating'
    and (provider_reservation_id is not null or provider_operation_id is not null
      or effect_certainty in ('indeterminate','definite_success'));
  select exists(select 1 from public.site_generation_media_slots where job_id=job.id
    and status='reconciliation_required') into unresolved;
  update public.background_jobs set status=case when unresolved then 'failed' else 'pending' end,
    status_message=case when unresolved then 'Needs provider reconciliation' else 'Add Video interrupted; retry scheduled' end,
    error_message=p_cause_code,next_retry_at=case when unresolved then null else p_retry_at end,
    completed_at=case when unresolved then clock_timestamp() else null end,
    interruption_count=interruption_count+1,locked_at=null,locked_by=null,lease_expires_at=null
  where id=job.id and status='running' and attempts=p_job_attempts and claim_epoch=p_claim_epoch
    and locked_by=p_runner_id;
  return found;
end $$;
revoke all on function public.interrupt_add_video_job_epoch(uuid,integer,bigint,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.interrupt_add_video_job_epoch(uuid,integer,bigint,text,text,timestamptz)
  to service_role;

alter function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz)
  rename to settle_background_job_historical_body;
revoke all on function public.settle_background_job_historical_body(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz)
  from public,anon,authenticated,service_role;

-- Generic attempts-only settlement is never a mutation capability for staged Add Video.
create or replace function public.settle_background_job(
  p_job_id uuid,p_attempts integer,p_status text,p_progress_pct integer,p_result_json jsonb,
  p_payload_json jsonb,p_error_message text,p_status_message text,p_completed_at timestamptz
) returns boolean language plpgsql security definer set search_path=public as $$
declare job_type_value text;
begin
  select job_type into job_type_value from public.background_jobs where id=p_job_id;
  if job_type_value='add_video' then
    raise exception 'Staged Add Video requires epoch settlement' using errcode='55000';
  end if;
  return public.settle_background_job_historical_body(p_job_id,p_attempts,p_status,p_progress_pct,
    p_result_json,p_payload_json,p_error_message,p_status_message,p_completed_at);
end $$;
revoke all on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz) to service_role;