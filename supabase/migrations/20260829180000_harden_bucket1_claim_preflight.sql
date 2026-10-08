-- Harden the shared Bucket 1 claim preflight against malformed Add Video retry state and
-- preserve parent-before-child locking across reconciliation. Forward-only: prior migrations stay immutable.

create or replace function public.add_video_stage_failure_count(p_payload jsonb)
returns integer
language plpgsql
immutable
set search_path=public
as $$
declare
  stage_name text;
  stage_failures jsonb;
  raw_count text;
  parsed_count numeric;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' then return null; end if;
  stage_name:=coalesce(p_payload->>'addVideoStage','planning/call');
  if stage_name not in (
    'planning/call','media/source-verify','media/create','media/poll',
    'media/materialize','composition/build','validation/run','persistence/commit'
  ) then return null; end if;
  stage_failures:=p_payload->'stageFailures';
  if stage_failures is null then return 0; end if;
  if jsonb_typeof(stage_failures)<>'object' then return null; end if;
  if stage_failures->stage_name is null then return 0; end if;
  if jsonb_typeof(stage_failures->stage_name)<>'number' then return null; end if;
  raw_count:=stage_failures->>stage_name;
  if raw_count !~ '^(0|[1-9][0-9]*)$' or length(raw_count)>10 then return null; end if;
  parsed_count:=raw_count::numeric;
  if parsed_count>2147483646 then return null; end if;
  return parsed_count::integer;
end;
$$;
revoke all on function public.add_video_stage_failure_count(jsonb)
  from public,anon,authenticated,service_role;

-- Expired stale recovery may settle a legacy running row whose runner identity is already NULL.
create or replace function public.apply_site_generation_interruption(
  p_job_id uuid,p_claim_epoch bigint,p_cause_code text,p_effect_certainty text,
  p_retry_at timestamptz,p_status_message text,p_event_key text,p_runner_id text,
  p_invocation_id uuid,p_deployment_id text,p_details jsonb,p_allow_expired boolean
) returns boolean
language plpgsql security definer set search_path = public as $$
declare current_job public.background_jobs%rowtype;
declare prior_event public.site_generation_attempt_events%rowtype;
declare next_count integer;
declare terminal boolean;
declare terminal_text text := 'We could not finish this website. Please try again.';
declare terminal_payload jsonb;
declare effective_certainty text := p_effect_certainty;
declare unresolved_count integer := 0;
begin
  if nullif(btrim(p_cause_code),'') is null or p_effect_certainty not in ('none','not_started','definite_failure','indeterminate')
     or p_retry_at is null or nullif(btrim(p_status_message),'') is null
     or nullif(btrim(p_event_key),'') is null
     or (not p_allow_expired and nullif(btrim(p_runner_id),'') is null)
     or p_details is null or jsonb_typeof(p_details) <> 'object' or octet_length(p_details::text) > 16384 then
    raise exception 'Invalid site generation interruption' using errcode = '22023';
  end if;
  select * into prior_event from public.site_generation_attempt_events where event_key=p_event_key;
  if found then
    if prior_event.job_id=p_job_id and prior_event.claim_epoch=p_claim_epoch
       and prior_event.event_type in ('interrupted','failed')
       and prior_event.cause_code is not distinct from p_cause_code then return true; end if;
    raise exception 'Interruption event key was already used for a different transition' using errcode='23505';
  end if;
  select jsonb_populate_record(null::public.site_generation_attempt_events,event_data) into prior_event
  from public.site_generation_attempt_events_archive where event_key=p_event_key;
  if found then
    if prior_event.job_id=p_job_id and prior_event.claim_epoch=p_claim_epoch
       and prior_event.event_type in ('interrupted','failed')
       and prior_event.cause_code is not distinct from p_cause_code then return true; end if;
    raise exception 'Archived interruption event key was used for a different transition' using errcode='23505';
  end if;
  select * into current_job from public.background_jobs where id=p_job_id for update;
  if not found or current_job.job_type<>'site_generation' or current_job.generation_contract_epoch<>2
     or current_job.status not in ('running','finalizing') or current_job.claim_epoch<>p_claim_epoch
     or current_job.locked_by is distinct from p_runner_id
     or (not p_allow_expired and (current_job.lease_expires_at is null or current_job.lease_expires_at<=clock_timestamp())) then
    return false;
  end if;
  next_count := least(current_job.interruption_count+1,5);
  terminal := next_count>=5;

  if p_effect_certainty='indeterminate' then
    update public.site_generation_media_slots set
      status='reconciliation_required',effect_certainty='indeterminate',
      reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      reconciled_at=null,reconciliation_actor=null,reconciliation_reason=null,
      reconciliation_evidence=null,reconciliation_action_key=null,
      cleanup_required=terminal,slot_locked_by=null,slot_lease_expires_at=null,
      error_message='Provider certainty requires interruption reconciliation'
    where job_id=p_job_id and status='generating'
      and (provider_reservation_id is not null or provider_operation_id is not null);
  end if;
  if exists(select 1 from public.site_generation_media_slots where job_id=p_job_id and status='reconciliation_required') then
    effective_certainty := 'indeterminate';
  end if;

  if terminal then
    terminal_payload:=jsonb_build_object(
      'schemaVersion',1,'kind','site-generation-terminal','status','failed',
      'jobId',current_job.id,'requestId',current_job.generation_request_id,
      'claimEpoch',current_job.claim_epoch,'message',terminal_text,'causeCode',p_cause_code
    );
    update public.messages set content=terminal_text
    where id=current_job.generation_handoff_message_id and trace_id=current_job.agent_trace_id and role='assistant';
    if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;
    update public.agent_traces set status='error',error_message=left(p_cause_code,1000),
      completed_at=coalesce(completed_at,clock_timestamp())
    where id=current_job.agent_trace_id and website_id=current_job.website_id
      and status in ('running','completed','error');
    if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;
    update public.site_generation_media_slots set status='abandoned',abandoned_at=clock_timestamp(),
      error_message='Generation interruption budget exhausted',slot_locked_by=null,slot_lease_expires_at=null
    where job_id=p_job_id and version_id is null and status in ('planned','failed')
      and effect_certainty in ('none','not_started','definite_failure');
  end if;

  update public.background_jobs set
    status=case when terminal then 'failed' else 'pending' end,
    result_json=case when terminal then jsonb_build_object(
      'status','failed','errorCode','generation_interruption_budget_exhausted',
      'jobId',id,'requestId',generation_request_id,'claimEpoch',claim_epoch
    ) else result_json end,
    completed_at=case when terminal then clock_timestamp() else null end,
    next_retry_at=case when terminal or exists(
      select 1 from public.site_generation_media_slots slot
      where slot.job_id=p_job_id and slot.status='reconciliation_required'
    ) then null else p_retry_at end,
    locked_at=null,locked_by=null,lease_expires_at=null,
    interruption_count=next_count,
    status_message=case when terminal then 'Generation retry budget exhausted'
      when exists(select 1 from public.site_generation_media_slots slot where slot.job_id=p_job_id and slot.status='reconciliation_required')
        then 'Media provider reconciliation required'
      else left(p_status_message,1000) end,
    error_message=case when terminal then left(p_cause_code,1000) else error_message end,
    generation_terminal_message_id=case when terminal then generation_handoff_message_id else generation_terminal_message_id end,
    generation_terminal_message_payload=case when terminal then terminal_payload else generation_terminal_message_payload end,
    generation_terminal_message_at=case when terminal then clock_timestamp() else generation_terminal_message_at end
  where id=p_job_id;

  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,budget_type,
    budget_before,budget_after,runner_id,invocation_id,deployment_id,completed_at,details
  ) values (
    p_event_key,current_job.id,current_job.website_id,current_job.generation_request_id,2,current_job.claim_epoch,
    current_job.generation_stage,current_job.stage_attempts,case when terminal then 'failed' else 'interrupted' end,
    p_cause_code,effective_certainty,case when terminal then 'terminal_failure' else 'resume' end,
    case when terminal then 'error' else 'warning' end,terminal,'interruption',current_job.interruption_count,
    next_count,p_runner_id,p_invocation_id,p_deployment_id,clock_timestamp(),
    p_details||jsonb_build_object('retryAt',p_retry_at,'budgetExhausted',terminal)
  );
  return true;
end;
$$;
revoke all on function public.apply_site_generation_interruption(uuid,bigint,text,text,timestamptz,text,text,text,uuid,text,jsonb,boolean)
  from public,anon,authenticated,service_role;

-- Settlement uses the same total parser as admission/recovery; a corrupt in-flight checkpoint
-- is normalized without any text-to-integer exception.
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
        to_jsonb(coalesce(public.add_video_stage_failure_count(job.payload_json),0)+1),true)
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

-- Reconciliation discovers due work without a row lock, then takes the parent job lock before
-- re-locking and revalidating the child slot. This matches callbacks, cancellation, and recovery.
create or replace function public.reconcile_due_generation_media(
  p_limit integer default 100,p_actor text default 'scheduler:bucket1-reconciliation'
) returns table(processed_count integer,terminalized_count integer,requeued_count integer)
language plpgsql security definer set search_path=public as $$
declare slot public.site_generation_media_slots%rowtype;
declare job public.background_jobs%rowtype;
declare candidate_slot_id uuid;
declare action_key text;
declare terminal_text text := 'We could not finish this website. Please try again.';
declare terminal_payload jsonb;
begin
  if p_limit<1 or p_limit>1000 or nullif(btrim(p_actor),'') is null then
    raise exception 'Invalid reconciliation sweep bounds' using errcode='22023';
  end if;
  processed_count:=0; terminalized_count:=0; requeued_count:=0;
  for candidate_slot_id in
    select media_slot.id from public.site_generation_media_slots as media_slot
    join public.background_jobs as parent_job on parent_job.id=media_slot.job_id
      and parent_job.job_type='site_generation'
    where media_slot.status='reconciliation_required'
      and media_slot.reconciliation_deadline<=clock_timestamp()
    order by media_slot.reconciliation_deadline,media_slot.id limit p_limit
  loop
    select parent_job.* into job from public.background_jobs as parent_job
    join public.site_generation_media_slots as media_slot on media_slot.job_id=parent_job.id
    where media_slot.id=candidate_slot_id and parent_job.job_type='site_generation'
    for update of parent_job skip locked;
    if not found then continue; end if;
    select media_slot.* into slot from public.site_generation_media_slots as media_slot
    where media_slot.id=candidate_slot_id and media_slot.job_id=job.id
      and media_slot.status='reconciliation_required'
      and media_slot.reconciliation_deadline<=clock_timestamp()
    for update of media_slot skip locked;
    if not found then continue; end if;
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

create or replace function public.reconcile_due_add_video_media(
  p_limit integer default 100,p_actor text default 'scheduler:bucket1-add-video-reconciliation'
) returns integer language plpgsql security definer set search_path=public as $$
declare slot public.site_generation_media_slots%rowtype;
declare job public.background_jobs%rowtype;
declare candidate_slot_id uuid;
declare processed integer:=0;
begin
  if p_limit<1 or p_limit>1000 or nullif(btrim(p_actor),'') is null then
    raise exception 'Invalid Add Video reconciliation bounds' using errcode='22023';
  end if;
  for candidate_slot_id in
    select media_slot.id from public.site_generation_media_slots as media_slot
    join public.background_jobs as parent_job on parent_job.id=media_slot.job_id
      and parent_job.job_type='add_video'
    where media_slot.status='reconciliation_required'
      and media_slot.reconciliation_deadline<=clock_timestamp()
    order by media_slot.reconciliation_deadline,media_slot.id limit p_limit
  loop
    select parent_job.* into job from public.background_jobs as parent_job
    join public.site_generation_media_slots as media_slot on media_slot.job_id=parent_job.id
    where media_slot.id=candidate_slot_id and parent_job.job_type='add_video'
    for update of parent_job skip locked;
    if not found then continue; end if;
    select media_slot.* into slot from public.site_generation_media_slots as media_slot
    where media_slot.id=candidate_slot_id and media_slot.job_id=job.id
      and media_slot.status='reconciliation_required'
      and media_slot.reconciliation_deadline<=clock_timestamp()
    for update of media_slot skip locked;
    if not found then continue; end if;
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

-- Direct reconciliation follows the same parent-before-child lock order as sweepers and callbacks.
create or replace function public.reconcile_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_slot_id text,p_reservation_id uuid,p_action_key text,
  p_action text,p_actor text,p_reason text,p_evidence jsonb
) returns text
language plpgsql security definer set search_path=public as $$
declare slot public.site_generation_media_slots%rowtype; job public.background_jobs%rowtype; result_status text;
begin
  if p_action not in ('ready','retry','reject','cleanup') or nullif(btrim(p_action_key),'') is null
    or nullif(btrim(p_actor),'') is null or nullif(btrim(p_reason),'') is null or jsonb_typeof(p_evidence) is distinct from 'object' then
    raise exception 'Audited reconciliation action is invalid' using errcode='22023'; end if;
  select * into job from public.background_jobs where id=p_job_id and website_id=p_website_id for update;
  if not found or job.job_type<>'site_generation' or job.generation_contract_epoch<>2 then return null; end if;
  select * into slot from public.site_generation_media_slots where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id for update;
  if not found or slot.provider_reservation_id is distinct from p_reservation_id then return null; end if;
  if slot.reconciliation_action_key=p_action_key then return slot.status; end if;
  if slot.status<>'reconciliation_required' or slot.reconciliation_action_key is not null then return null; end if;
  result_status:=case p_action when 'ready' then 'ready' when 'retry' then 'failed' else 'abandoned' end;
  if p_action='ready' and (nullif(p_evidence->>'storagePath','') is null or (p_evidence->>'contentHash') !~ '^[0-9a-f]{64}$') then
    raise exception 'Ready reconciliation requires durable storage evidence' using errcode='22023'; end if;
  if p_action='retry' and slot.effect_certainty='definite_success' then
    raise exception 'Confirmed provider success cannot be recreated' using errcode='55000'; end if;
  if p_action='retry' and coalesce(slot.provider_create_count,0)>=2 then raise exception 'Provider create cap is exhausted' using errcode='P0001'; end if;
  update public.site_generation_media_slots set status=result_status,effect_certainty=case when p_action='ready' then 'definite_success' else 'definite_failure' end,
    storage_path=case when p_action='ready' then p_evidence->>'storagePath' else storage_path end,
    content_hash=case when p_action='ready' then p_evidence->>'contentHash' else content_hash end,
    asset_id=case when p_action='ready' then p_evidence->>'contentHash' else asset_id end,
    mime_type=case when p_action='ready' then coalesce(nullif(p_evidence->>'mimeType',''),mime_type) else mime_type end,
    reconciliation_actor=btrim(p_actor),reconciliation_reason=btrim(p_reason),reconciliation_evidence=p_evidence,
    reconciliation_action_key=p_action_key,reconciled_at=clock_timestamp(),reconciliation_required_at=null,reconciliation_deadline=null,
    cleanup_required=p_action='cleanup',cleanup_completed_at=case when p_action='cleanup' then clock_timestamp() else null end,
    provider_reservation_id=case when p_action='retry' then null else provider_reservation_id end,
    provider_reserved_at=case when p_action='retry' then null else provider_reserved_at end,
    error_message=case when p_action='ready' then null else btrim(p_reason) end,
    abandoned_at=case when p_action in ('reject','cleanup') then clock_timestamp() else null end
  where id=slot.id;
  if p_action in ('ready','retry') and job.status='pending' and job.completed_at is null then
    update public.background_jobs set next_retry_at=clock_timestamp(),status_message='Media reconciliation resolved: '||p_action where id=p_job_id;
  end if;
  insert into public.site_generation_attempt_events(event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details)
  values(p_action_key,p_job_id,p_website_id,job.generation_request_id,2,job.claim_epoch,'media',job.stage_attempts,
    'reconciled','provider_reconciliation_'||p_action,case when p_action='ready' then 'definite_success' else 'definite_failure' end,
    case when p_action='retry' then 'retry' when p_action='cleanup' then 'cleanup' else 'manual' end,'info',false,p_actor,clock_timestamp(),
    jsonb_build_object('slotId',p_slot_id,'reservationId',p_reservation_id,'action',p_action,'actor',btrim(p_actor),'reason',btrim(p_reason),'evidence',p_evidence));
  return result_status;
end; $$;
revoke all on function public.reconcile_generation_media_slot_epoch(uuid,uuid,text,uuid,text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.reconcile_generation_media_slot_epoch(uuid,uuid,text,uuid,text,text,text,text,jsonb)
  to service_role;

-- Generic stale recovery owns enrichment only; specialized recovery exclusively owns Add Video.
create or replace function public.recover_stale_background_jobs(
  p_stale_before timestamptz,p_scheduler_run_id uuid
) returns table(requeued_count integer,failed_count integer,reconciliation_count integer)
language plpgsql security definer set search_path=public as $$
declare stale_generation_job public.background_jobs%rowtype;
declare certainty text;
declare recovered boolean;
declare unresolved_count integer := 0;
declare non_generation_failed integer := 0;
begin
  if p_stale_before is null or p_scheduler_run_id is null then
    raise exception 'Stale recovery identity is required' using errcode='22023';
  end if;
  requeued_count:=0;failed_count:=0;reconciliation_count:=0;
  for stale_generation_job in
    select generation_job.*
    from public.background_jobs as generation_job
    where generation_job.job_type='site_generation'
      and generation_job.generation_contract_epoch=2
      and generation_job.status in ('running','finalizing')
      and ((generation_job.lease_expires_at is not null
          and generation_job.lease_expires_at<=clock_timestamp())
        or (generation_job.lease_expires_at is null
          and coalesce(generation_job.locked_at,generation_job.started_at,generation_job.created_at)<p_stale_before))
    order by coalesce(generation_job.lease_expires_at,generation_job.locked_at),generation_job.id
    for update of generation_job skip locked
  loop
    update public.site_generation_media_slots as media_slot
    set status='failed',effect_certainty='definite_failure',
      error_message='Expired media lease had no provider reservation or operation',slot_locked_by=null,
      slot_lease_expires_at=null,provider_reservation_id=null,provider_reserved_at=null
    where media_slot.job_id=stale_generation_job.id and media_slot.status='generating'
      and media_slot.provider_reservation_id is null and media_slot.provider_operation_id is null;
    update public.site_generation_media_slots as media_slot
    set status='reconciliation_required',effect_certainty='indeterminate',
      reconciliation_required_at=coalesce(media_slot.reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(media_slot.reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      slot_locked_by=null,slot_lease_expires_at=null,error_message='Stale worker left unresolved provider certainty'
    where media_slot.job_id=stale_generation_job.id and media_slot.status='generating'
      and (media_slot.provider_reservation_id is not null or media_slot.provider_operation_id is not null);
    get diagnostics unresolved_count = row_count;
    reconciliation_count := reconciliation_count + unresolved_count;
    certainty:=case when exists(
      select 1 from public.site_generation_media_slots as media_slot
      where media_slot.job_id=stale_generation_job.id
        and media_slot.status='reconciliation_required'
    ) then 'indeterminate' else 'none' end;
    recovered:=public.apply_site_generation_interruption(
      stale_generation_job.id,stale_generation_job.claim_epoch,'worker_lease_expired',certainty,clock_timestamp(),
      'Resuming interrupted generation',stale_generation_job.id::text||':'||stale_generation_job.claim_epoch::text||':stale-recovery',
      stale_generation_job.locked_by,null,null,
      jsonb_build_object('schedulerRunId',p_scheduler_run_id,'staleBefore',p_stale_before),true
    );
    if recovered then
      if (select generation_job.status='failed'
          from public.background_jobs as generation_job
          where generation_job.id=stale_generation_job.id) then
        failed_count:=failed_count+1;
      else requeued_count:=requeued_count+1; end if;
      update public.background_jobs as generation_job
      set scheduler_last_run_id=p_scheduler_run_id
      where generation_job.id=stale_generation_job.id;
    end if;
  end loop;

  unresolved_count := 0;
  with stale_non_generation as (
    select stale_job.id
    from public.background_jobs as stale_job
    where stale_job.job_type='enrichment_platform'
      and stale_job.status in ('running','finalizing')
      and coalesce(stale_job.locked_at,stale_job.started_at,stale_job.created_at)<p_stale_before
    order by stale_job.locked_at,stale_job.id
    for update of stale_job skip locked
  ), recovered_jobs as (
    update public.background_jobs as recovered_job set
      status=case
        when recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3) then 'failed'
        when recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts then 'failed'
        else 'pending' end,
      completed_at=case
        when (recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3))
          or (recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts)
          then clock_timestamp() else null end,
      next_retry_at=case
        when (recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3))
          or (recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts)
          then null else clock_timestamp() end,
      payload_json=case
        when recovered_job.status='finalizing' and recovered_job.job_type='enrichment_platform'
          and recovered_job.finalization_attempts<3
          then recovered_job.payload_json||'{"resume_enrichment_finalization":true}'::jsonb
        else recovered_job.payload_json end,
      status_message=case
        when (recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3))
          or (recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts)
          then 'Failed after stale worker recovery'
        when recovered_job.status='finalizing' and recovered_job.job_type='enrichment_platform'
          then 'Retrying enrichment finalization immediately'
        else 'Retrying after stale worker recovery' end,
      error_message=case
        when (recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3))
          or (recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts)
          then coalesce(recovered_job.error_message,'Worker lease expired after maximum attempts')
        else recovered_job.error_message end,
      locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
    from stale_non_generation as stale_job
    where recovered_job.id=stale_job.id
    returning recovered_job.status
  ), counted as (
    select count(*) filter(where recovered_job.status='pending')::integer as requeued,
      count(*) filter(where recovered_job.status='failed')::integer as failed
    from recovered_jobs as recovered_job
  )
  select counted.requeued,counted.failed
  into unresolved_count,non_generation_failed
  from counted;
  requeued_count := requeued_count + coalesce(unresolved_count,0);
  failed_count := failed_count + coalesce(non_generation_failed,0);
  return next;
end;
$$;

revoke all on function public.recover_stale_background_jobs(timestamptz,uuid)
  from public,anon,authenticated,service_role;

-- An Add Video lease is stale only after both its fixed lease and its heartbeat are stale.
-- Every consumed stale attempt is durably reflected in both retry ledgers.
create or replace function public.recover_stale_add_video_jobs(
  p_stale_before timestamptz,p_scheduler_run_id uuid
) returns table(requeued_count integer,failed_count integer,reconciliation_count integer)
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
declare unresolved integer;
declare stage_failure_count integer;
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
    stage_failure_count:=public.add_video_stage_failure_count(job.payload_json);
    update public.site_generation_media_slots set status='reconciliation_required',effect_certainty='indeterminate',
      reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      slot_locked_by=null,slot_lease_expires_at=null,
      error_message='Stale Add Video worker left unresolved provider certainty'
    where job_id=job.id and version_id is null and status='generating'
      and (provider_reservation_id is not null or provider_operation_id is not null
        or effect_certainty in ('indeterminate','definite_success'));
    get diagnostics unresolved=row_count;
    reconciliation_count:=reconciliation_count+unresolved;
    if stage_failure_count is null then
      update public.background_jobs set status='failed',completed_at=clock_timestamp(),next_retry_at=null,
        status_message='Invalid Add Video retry state',error_message='add_video_retry_state_invalid',
        result_json=jsonb_build_object('status','failed','errorCode','add_video_retry_state_invalid','requestId',request_id),
        locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
      where id=job.id;
      failed_count:=failed_count+1;
    elsif unresolved>0 then
      update public.background_jobs set status='failed',completed_at=clock_timestamp(),next_retry_at=null,
        status_message='Needs provider reconciliation',error_message='stale_add_video_provider_indeterminate',
        locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
      where id=job.id;
      failed_count:=failed_count+1;
    elsif stage_failure_count+1>=3 then
      update public.background_jobs set status='failed',completed_at=clock_timestamp(),next_retry_at=null,
        status_message='Failed after stale worker recovery',error_message=coalesce(error_message,'Worker lease expired'),
        interruption_count=interruption_count+1,failure_attempts=failure_attempts+1,
        payload_json=jsonb_set(payload_json,array['stageFailures',coalesce(payload_json->>'addVideoStage','planning/call')],
          to_jsonb(stage_failure_count+1),true),
        locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
      where id=job.id;
      failed_count:=failed_count+1;
    else
      update public.background_jobs set status='pending',next_retry_at=clock_timestamp(),
        status_message='Retrying after stale worker recovery',interruption_count=interruption_count+1,
        failure_attempts=failure_attempts+1,
        payload_json=jsonb_set(payload_json,array['stageFailures',coalesce(payload_json->>'addVideoStage','planning/call')],
          to_jsonb(stage_failure_count+1),true),
        locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
      where id=job.id;
      requeued_count:=requeued_count+1;
    end if;
  end loop;
  return next;
end $$;
revoke all on function public.recover_stale_add_video_jobs(timestamptz,uuid)
  from public,anon,authenticated,service_role;

-- Parent-first terminal closure for invalid or exhausted Add Video retry state.
create or replace function public.terminalize_add_video_retry_state(
  p_job_id uuid,p_scheduler_run_id uuid,p_error_code text,p_status_message text
) returns boolean language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
declare unresolved_count integer:=0;
declare stage_name text;
begin
  select * into job from public.background_jobs where id=p_job_id and job_type='add_video'
    and status='pending' for update;
  if not found then return false; end if;
  perform 1 from public.site_generation_media_slots where job_id=job.id order by id for update;
  update public.site_generation_media_slots set
    status=case when status<>'ready' and provider_reservation_id is not null
      and (provider_operation_id is not null or effect_certainty in ('indeterminate','definite_success'))
      then 'reconciliation_required' else 'abandoned' end,
    effect_certainty=case when status<>'ready' and provider_reservation_id is not null
      and (provider_operation_id is not null or effect_certainty in ('indeterminate','definite_success'))
      then 'indeterminate' else effect_certainty end,
    reconciliation_required_at=case when status<>'ready' and provider_reservation_id is not null
      and (provider_operation_id is not null or effect_certainty in ('indeterminate','definite_success'))
      then coalesce(reconciliation_required_at,clock_timestamp()) else null end,
    reconciliation_deadline=case when status<>'ready' and provider_reservation_id is not null
      and (provider_operation_id is not null or effect_certainty in ('indeterminate','definite_success'))
      then coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour') else null end,
    slot_locked_by=null,slot_lease_expires_at=null,cleanup_required=true,
    abandoned_at=case when status='ready' or provider_reservation_id is null
      or (provider_operation_id is null and effect_certainty in ('none','not_started','definite_failure'))
      then clock_timestamp() else abandoned_at end,
    error_message=p_error_code
  where job_id=job.id and version_id is null and status in ('planned','generating','ready','failed');
  select count(*) into unresolved_count from public.site_generation_media_slots
    where job_id=job.id and status='reconciliation_required';
  update public.background_jobs set status='failed',completed_at=clock_timestamp(),next_retry_at=null,
    locked_at=null,locked_by=null,lease_expires_at=null,status_message=left(p_status_message,500),
    error_message=p_error_code,result_json=jsonb_build_object('status','failed','errorCode',p_error_code,'requestId',request_id),
    scheduler_last_run_id=p_scheduler_run_id where id=job.id;
  stage_name:=split_part(coalesce(job.payload_json->>'addVideoStage','planning/call'),'/',1);
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
  ) values(
    job.id::text||':'||job.claim_epoch::text||':retry-state-terminal',job.id,job.website_id,job.request_id,
    2,job.claim_epoch,case when stage_name in ('planning','media','composition','validation','persistence')
      then stage_name else 'planning' end,job.attempts,'failed',p_error_code,
    case when unresolved_count>0 then 'indeterminate' else 'none' end,'terminal_failure','error',true,
    'scheduler:'||p_scheduler_run_id::text,clock_timestamp(),jsonb_build_object('childReconciliationCount',unresolved_count)
  ) on conflict(event_key) do nothing;
  return true;
end $$;
revoke all on function public.terminalize_add_video_retry_state(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;

-- The claimant quarantines invalid current Add Video contracts before candidate selection,
-- so one corrupt JSON value can never abort or wedge unrelated queues.
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
  if nullif(btrim(p_runner_id),'') is null or p_generation_contract_epoch is null
     or p_generation_contract_epoch not in (1,2)
     or p_scheduler_run_id is null or p_stale_before is null then
    raise exception 'Runner, capability, stale threshold, and scheduler identity are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bucket1-background-dispatch',0));
  perform * from public.reconcile_due_generation_media(100,'scheduler:'||p_scheduler_run_id::text);
  perform public.reconcile_due_add_video_media(100,'scheduler:'||p_scheduler_run_id::text);
  perform * from public.recover_stale_add_video_jobs(p_stale_before,p_scheduler_run_id);
  perform * from public.recover_stale_background_jobs(p_stale_before,p_scheduler_run_id);
  for claimed in select invalid_job.* from public.background_jobs as invalid_job
    where invalid_job.job_type='add_video' and invalid_job.status='pending'
      and invalid_job.generation_contract_epoch=2 and invalid_job.generation_contract_version=2
      and (invalid_job.payload_json->>'generatorSchemaVersion' is distinct from '4'
        or coalesce(invalid_job.payload_json->>'addVideoStage','') not in (
          'planning/call','media/source-verify','media/create','media/poll',
          'media/materialize','composition/build','validation/run','persistence/commit')
        or public.add_video_stage_failure_count(invalid_job.payload_json) is null)
    order by invalid_job.created_at,invalid_job.id
  loop
    perform public.terminalize_add_video_retry_state(claimed.id,p_scheduler_run_id,
      'add_video_retry_state_invalid','Invalid Add Video retry state');
  end loop;
  for claimed in select exhausted_job.* from public.background_jobs as exhausted_job
    where exhausted_job.job_type='add_video' and exhausted_job.status='pending'
      and exhausted_job.generation_contract_epoch=2 and exhausted_job.generation_contract_version=2
      and exhausted_job.payload_json->>'generatorSchemaVersion'='4'
      and exhausted_job.payload_json->>'addVideoStage' in (
        'planning/call','media/source-verify','media/create','media/poll',
        'media/materialize','composition/build','validation/run','persistence/commit')
      and public.add_video_stage_failure_count(exhausted_job.payload_json)>=3
    order by exhausted_job.created_at,exhausted_job.id
  loop
    perform public.terminalize_add_video_retry_state(claimed.id,p_scheduler_run_id,
      'add_video_retry_budget_exhausted','Add Video retry budget exhausted');
  end loop;
  claimed:=null;
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
          and public.add_video_stage_failure_count(candidate.payload_json)<3)
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
  'Fair four-class server claim; invalid Add Video retry state is terminally quarantined before candidate selection.';
