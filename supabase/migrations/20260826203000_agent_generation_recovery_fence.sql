-- Keep administrative turn recovery atomic with any durable site-generation child.

-- Forward-repair installations that recorded the earlier Lovable schema copy.
-- Recreate the final owned-enqueue contract after dropping either historical return type.
drop function if exists public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean);

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
  chain_row_count integer;
  bound_row_count integer;
  handoff_message_id uuid;
begin
  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Site generation idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  select * into owned_trace from public.agent_traces
  where id=p_trace_id and website_id=p_website_id
    and owner_token = p_owner_token and status='running';
  if not found then
    raise exception 'Agent turn ownership lost';
  end if;

  returned_chain_id := public.enqueue_site_generation_job(
    p_website_id, p_idempotency_key, p_payload_json, p_replay_completed
  );
  if owned_trace.source_version_id is distinct from nullif(p_payload_json->>'sourceVersionId','')::uuid
     or owned_trace.source_revision is distinct from nullif(p_payload_json->>'sourceRevision','')::bigint then
    raise exception 'Site generation source snapshot does not match agent turn';
  end if;

  if exists (
    select 1 from public.background_jobs job
    where job.chain_id=returned_chain_id and job.website_id=p_website_id
      and job.job_type='site_generation'
      and job.agent_trace_id is distinct from p_trace_id and job.agent_trace_id is not null
  ) then
    raise exception 'Site generation chain is already bound to another agent trace';
  end if;

  select nullif(job.payload_json->>'_agentHandoffMessageId','')::uuid
  into handoff_message_id
  from public.background_jobs job
  where job.chain_id=returned_chain_id and job.website_id=p_website_id
    and job.job_type='site_generation' and job.sequence_index=0
  order by job.created_at,job.id limit 1;

  if handoff_message_id is null then
    insert into public.messages (conversation_id,role,content,trace_id)
    values (owned_trace.conversation_id,'assistant','Building your website…',p_trace_id)
    returning id into handoff_message_id;
  end if;

  update public.background_jobs job
  set agent_trace_id=p_trace_id,
      payload_json=job.payload_json || jsonb_build_object(
        '_agentHandoffMessageId',handoff_message_id,
        '_agentRequestId',owned_trace.request_id
      )
  where job.chain_id=returned_chain_id and job.website_id=p_website_id
    and job.job_type='site_generation'
    and (job.agent_trace_id is null or job.agent_trace_id=p_trace_id);

  select count(*), count(*) filter (where job.agent_trace_id=p_trace_id)
  into chain_row_count, bound_row_count
  from public.background_jobs job
  where job.chain_id=returned_chain_id and job.website_id=p_website_id
    and job.job_type='site_generation';
  if chain_row_count=0 or bound_row_count<>chain_row_count then
    raise exception 'Site generation chain trace binding failed';
  end if;
  return query select returned_chain_id,handoff_message_id;
end;
$$;
revoke all on function public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)
  to service_role;

revoke all on function public.enqueue_site_generation_job_unchecked(uuid,text,jsonb,boolean)
  from public,anon,authenticated,service_role;

-- Normalize worker settlement to the same job-before-media order used by every
-- media-slot mutator. The row lock is acquired before either resource is changed.
create or replace function public.settle_background_job(
  p_job_id uuid,p_job_attempts integer,p_status text,p_progress_pct integer,
  p_result_json jsonb,p_payload_json jsonb,p_error_message text,
  p_status_message text,p_completed_at timestamptz
) returns boolean
language plpgsql security definer set search_path=public as $$
declare locked_job public.background_jobs%rowtype; settled_id uuid;
begin
  if p_status not in ('pending','completed','failed','cancelled') then
    raise exception 'Invalid background job settlement status';
  end if;
  select * into locked_job from public.background_jobs
  where id=p_job_id and status='running' and attempts=p_job_attempts
  for update;
  if not found then return false; end if;

  if p_status in ('failed','cancelled') and locked_job.job_type='site_generation' then
    update public.site_generation_media_slots
    set status='abandoned',error_message=coalesce(p_error_message,'Site generation ended'),abandoned_at=now()
    where job_id=locked_job.id and version_id is null
      and status in ('planned','generating','ready','failed');
  end if;

  update public.background_jobs
  set status=p_status,progress_pct=p_progress_pct,result_json=p_result_json,
      payload_json=coalesce(p_payload_json,'{}'::jsonb),error_message=p_error_message,
      status_message=p_status_message,completed_at=p_completed_at,
      next_retry_at=case when p_status='pending' then nullif(p_payload_json->>'next_retry_at','')::timestamptz else null end,
      locked_at=null,locked_by=null,
      failure_attempts=failure_attempts + case when job_type='site_generation' and p_status in ('pending','failed') then 1 else 0 end
  where id=locked_job.id and status='running' and attempts=p_job_attempts
  returning id into settled_id;
  return settled_id is not null;
end $$;
revoke all on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz)
  to service_role;

-- Normalize workspace cancellation to job-before-media as well. Advisory locks alone do
-- not serialize worker settlement, so tuple order must be consistent in every path.
create or replace function public.cancel_workspace_background_jobs(p_website_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation', 0));

  perform 1 from public.background_jobs
  where website_id=p_website_id
    and job_type in ('enrichment_platform','site_generation')
    and status in ('pending','running','finalizing')
  order by id
  for update;

  update public.site_generation_media_slots ledger
  set status='abandoned', error_message='Workspace generation cancelled', abandoned_at=now()
  from public.background_jobs job
  where job.website_id=p_website_id and ledger.job_id=job.id
    and job.job_type='site_generation' and job.status in ('pending','running','finalizing')
    and ledger.version_id is null
    and ledger.status in ('planned','generating','ready','failed');

  update public.background_jobs
  set status='cancelled', locked_at=null, locked_by=null,
      idempotency_key=case when job_type='site_generation' then idempotency_key else null end,
      completed_at=now()
  where website_id=p_website_id
    and job_type in ('enrichment_platform','site_generation')
    and status in ('pending','running','finalizing');
  get diagnostics affected = row_count;
  return affected;
end $$;
revoke all on function public.cancel_workspace_background_jobs(uuid) from public,anon,authenticated;
grant execute on function public.cancel_workspace_background_jobs(uuid) to service_role;

create or replace function public.settle_agent_site_generation_message(
  p_website_id uuid, p_chain_id uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  linked_trace_id uuid;
  terminal_status text;
  final_text text;
  message_id uuid;
begin
  if p_website_id is null or p_chain_id is null then return false; end if;
  -- Serialize terminal rows within the chain. Settlement never locks or updates job
  -- rows, so the final terminal transaction can observe prior commits without a cycle.
  perform pg_advisory_xact_lock(hashtextextended(p_chain_id::text || ':site_generation_message', 0));

  select agent_trace_id into linked_trace_id from public.background_jobs
  where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation'
    and sequence_index=0
  order by created_at,id limit 1;
  if linked_trace_id is null or exists (
    select 1 from public.agent_traces
    where id=linked_trace_id and recovered_at is not null
  ) or exists (
    select 1 from public.background_jobs
    where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation'
      and status in ('pending','running','finalizing')
  ) then
    return false;
  end if;

  select case
    when bool_or(status='failed') then 'failed'
    when bool_or(status='cancelled') then 'cancelled'
    when bool_and(status='completed') then 'completed'
  end into terminal_status
  from public.background_jobs
  where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation';
  if terminal_status is null then return false; end if;

  final_text := case terminal_status
    when 'completed' then 'Your website is ready to review.'
    when 'failed' then 'Site generation failed. Please try again.'
    when 'cancelled' then 'Site generation was cancelled.'
  end;
  select nullif(payload_json->>'_agentHandoffMessageId','')::uuid into message_id
  from public.background_jobs
  where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation'
    and sequence_index=0
  order by created_at,id limit 1;
  if message_id is null or not exists (
    select 1 from public.messages
    where id=message_id and trace_id=linked_trace_id and role='assistant'
  ) then return false; end if;

  -- Repeated trigger/reconciliation calls are harmless; avoiding a job-row marker
  -- prevents cross-row terminalization deadlocks.
  update public.messages set content=final_text where id=message_id;
  return true;
end;
$$;

create or replace function public.admin_recover_agent_turn(
  p_trace_id uuid,
  p_expected_owner_token uuid,
  p_admin_actor_id uuid,
  p_status text,
  p_reason text
) returns boolean language plpgsql security definer set search_path=public as $$
declare
  turn_website_id uuid;
  generation_chain_id uuid;
begin
  if p_trace_id is null or p_admin_actor_id is null
     or p_status not in ('error','cancelled')
     or nullif(btrim(p_reason), '') is null then
    raise exception 'Trace id, admin actor, terminal status, and recovery reason are required';
  end if;

  select website_id into turn_website_id from public.agent_traces
  where id=p_trace_id and status='running'
    and owner_token is not distinct from p_expected_owner_token;
  if turn_website_id is null then return false; end if;

  -- Owned enqueue and recovery share the turn-before-job order. Terminal settlement
  -- takes only its chain lock and never updates jobs, so it cannot invert this order.
  perform pg_advisory_xact_lock(hashtextextended(turn_website_id::text || ':agent_turn', 0));
  if not exists (
    select 1 from public.agent_traces
    where id=p_trace_id and website_id=turn_website_id and status='running'
      and owner_token is not distinct from p_expected_owner_token
  ) then return false; end if;

  if exists (
    select 1 from public.agent_external_operations
    where trace_id=p_trace_id and status='running'
  ) then
    raise exception 'Agent turn has a running external operation';
  end if;

  select chain_id into generation_chain_id from public.background_jobs
  where agent_trace_id=p_trace_id and website_id=turn_website_id
    and job_type='site_generation' and sequence_index=0
  order by created_at,id limit 1;

  -- Use the canonical job-before-media order shared with worker settlement and every
  -- media mutator; the turn fence prevents owned enqueue from adding another child.
  perform 1 from public.background_jobs
  where agent_trace_id=p_trace_id and website_id=turn_website_id
    and job_type='site_generation'
  order by id
  for update;

  update public.site_generation_media_slots ledger
  set status='abandoned', error_message='Agent turn administratively recovered', abandoned_at=clock_timestamp()
  from public.background_jobs job
  where job.agent_trace_id=p_trace_id and ledger.job_id=job.id
    and job.job_type='site_generation' and job.status in ('pending','running','finalizing')
    and ledger.version_id is null
    and ledger.status in ('planned','generating','ready','failed');
  if generation_chain_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(generation_chain_id::text || ':site_generation_message', 0)
    );
  end if;
  if exists (
    select 1 from public.background_jobs
    where agent_trace_id=p_trace_id and website_id=turn_website_id
      and job_type='site_generation' and status='completed'
  ) then
    raise exception 'Agent turn has a completed site generation';
  end if;

  -- Cancel child work before releasing the turn. The existing terminal trigger replaces
  -- its exact handoff while the trace is still eligible for settlement.
  update public.background_jobs
  set status='cancelled', locked_at=null, locked_by=null, completed_at=clock_timestamp()
  where agent_trace_id=p_trace_id and website_id=turn_website_id
    and job_type='site_generation' and status in ('pending','running','finalizing');

  update public.agent_traces
  set status=p_status,
      error_message=case when p_status='cancelled' then 'cancelled' else 'Administrative recovery: ' || btrim(p_reason) end,
      completed_at=clock_timestamp(), heartbeat_at=clock_timestamp(),
      recovered_at=clock_timestamp(), recovered_by=p_admin_actor_id,
      recovery_reason=btrim(p_reason), lease_expires_at=clock_timestamp()
  where id=p_trace_id and status='running'
    and owner_token is not distinct from p_expected_owner_token;
  return found;
end;
$$;

revoke all on function public.settle_agent_site_generation_message(uuid,uuid) from public,anon,authenticated;
revoke all on function public.admin_recover_agent_turn(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_recover_agent_turn(uuid,uuid,uuid,text,text) to service_role;
