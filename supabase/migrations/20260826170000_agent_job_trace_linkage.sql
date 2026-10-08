-- Durably connect agent-requested site generation to the chat turn that enqueued it.
alter table public.background_jobs
  add column if not exists agent_trace_id uuid
  references public.agent_traces(id);

create index if not exists background_jobs_agent_trace_id_idx
  on public.background_jobs(agent_trace_id)
  where agent_trace_id is not null;

create unique index if not exists agent_traces_id_website_unique
  on public.agent_traces(id,website_id);

create unique index if not exists background_jobs_one_generation_chain_per_trace
  on public.background_jobs(agent_trace_id)
  where agent_trace_id is not null and job_type='site_generation' and sequence_index=0;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='background_jobs_agent_trace_website_fkey'
  ) then
    alter table public.background_jobs add constraint background_jobs_agent_trace_website_fkey
      foreign key (agent_trace_id,website_id) references public.agent_traces(id,website_id)
      not valid;
  end if;
end $$;

alter table public.background_jobs
  validate constraint background_jobs_agent_trace_website_fkey;

-- Preserve canonical enqueue compatibility while rejecting ambiguous identities.
alter function public.enqueue_site_generation_job(uuid,text,jsonb,boolean)
  rename to enqueue_site_generation_job_unchecked;
revoke all on function public.enqueue_site_generation_job_unchecked(uuid,text,jsonb,boolean)
  from public,anon,authenticated,service_role;

create or replace function public.enqueue_site_generation_job(
  p_website_id uuid, p_idempotency_key text, p_payload_json jsonb,
  p_replay_completed boolean default false
) returns uuid language plpgsql security definer set search_path=public as $$
declare existing_payload jsonb;
begin
  if nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'Site generation idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation',0));
  select payload_json into existing_payload from public.background_jobs
  where website_id=p_website_id and job_type='site_generation' and sequence_index=0
    and idempotency_key=p_idempotency_key
    and (status in ('pending','running','finalizing')
      or (p_replay_completed and status in ('completed','failed','cancelled')))
  order by created_at desc limit 1;
  if found and existing_payload->'executionMode' is distinct from p_payload_json->'executionMode' then
    raise exception 'Idempotency key was already used for a different generation request';
  end if;
  return public.enqueue_site_generation_job_unchecked(
    p_website_id,p_idempotency_key,p_payload_json,p_replay_completed
  );
end $$;
revoke all on function public.enqueue_site_generation_job(uuid,text,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.enqueue_site_generation_job(uuid,text,jsonb,boolean) to service_role;

-- Preserve the existing agent RPC contract while rejecting incomplete leases and stale source snapshots.
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
  if (p_source_version_id is null) <> (p_source_revision is null)
     or p_source_revision < 0 then
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
  if p_source_version_id is not null and not exists (
    select 1 from public.website_versions
    where id=p_source_version_id and website_id=p_website_id and revision=p_source_revision
  ) then
    raise exception 'Agent turn source snapshot does not match';
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

create or replace function public.renew_agent_turn(
  p_trace_id uuid,
  p_owner_token uuid,
  p_lease_seconds integer default 60
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  renewed boolean;
  turn_website_id uuid;
begin
  if p_trace_id is null or p_owner_token is null or p_lease_seconds is null
     or p_lease_seconds < 15 or p_lease_seconds > 600 then
    return false;
  end if;

  select website_id into turn_website_id
  from public.agent_traces
  where id=p_trace_id and owner_token = p_owner_token;
  if turn_website_id is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(turn_website_id::text || ':agent_turn', 0));
  update public.agent_traces
  set heartbeat_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds)
  where id=p_trace_id and status='running' and owner_token = p_owner_token;
  renewed := found;
  return renewed;
end;
$$;

-- The fenced-lease migration defined this signature with a scalar return. PostgreSQL
-- requires dropping it before changing the return contract to the handoff tuple.
drop function if exists public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean);

-- Bind every site-generation row in the returned chain in the same transaction as enqueue.
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

-- Settle one chain-level chat response. The message-insert trigger closes the race where
-- a very fast job terminalizes before its enqueue acknowledgement has been persisted.
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
  perform pg_advisory_xact_lock(hashtextextended(p_chain_id::text || ':site_generation_message', 0));

  select agent_trace_id into linked_trace_id from public.background_jobs
  where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation'
    and sequence_index=0
  order by created_at,id limit 1;
  if linked_trace_id is null or exists (
    select 1 from public.background_jobs
    where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation'
      and payload_json ? '_agentTerminalMessageFinalizedAt'
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

  update public.messages set content=final_text where id=message_id;
  update public.background_jobs
  set payload_json=payload_json || jsonb_build_object(
    '_agentTerminalMessageFinalizedAt',clock_timestamp()
  )
  where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation'
    and not (payload_json ? '_agentTerminalMessageFinalizedAt');
  return true;
end;
$$;

create or replace function public.finalize_agent_site_generation_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.job_type='site_generation' and new.agent_trace_id is not null
     and new.status in ('completed','failed','cancelled')
     and (old.status in ('pending','running','finalizing')
       or old.agent_trace_id is distinct from new.agent_trace_id) then
    perform public.settle_agent_site_generation_message(new.website_id,new.chain_id);
  end if;
  return new;
end;
$$;

create or replace function public.reconcile_terminal_site_generation_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare linked_job public.background_jobs%rowtype;
begin
  if new.trace_id is null or new.role<>'assistant' or nullif(btrim(new.content),'') is null then
    return new;
  end if;
  select * into linked_job from public.background_jobs
  where agent_trace_id=new.trace_id and job_type='site_generation'
    and status in ('completed','failed','cancelled')
    and not (payload_json ? '_agentTerminalMessageFinalizedAt')
  order by completed_at desc nulls last, created_at desc, id desc limit 1;
  if found then
    perform public.settle_agent_site_generation_message(linked_job.website_id,linked_job.chain_id);
  end if;
  return new;
end;
$$;

revoke all on function public.claim_agent_turn(uuid,uuid,text,text,uuid,text,uuid,bigint,uuid,integer) from public,anon,authenticated;
revoke all on function public.renew_agent_turn(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.settle_agent_site_generation_message(uuid,uuid) from public,anon,authenticated;
revoke all on function public.finalize_agent_site_generation_message() from public,anon,authenticated;
revoke all on function public.reconcile_terminal_site_generation_message() from public,anon,authenticated;
grant execute on function public.claim_agent_turn(uuid,uuid,text,text,uuid,text,uuid,bigint,uuid,integer) to service_role;
grant execute on function public.renew_agent_turn(uuid,uuid,integer) to service_role;
grant execute on function public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean) to service_role;

drop trigger if exists background_jobs_finalize_agent_site_generation_message on public.background_jobs;
create trigger background_jobs_finalize_agent_site_generation_message
after update of status,agent_trace_id on public.background_jobs
for each row execute function public.finalize_agent_site_generation_message();

drop trigger if exists messages_reconcile_terminal_site_generation on public.messages;
create trigger messages_reconcile_terminal_site_generation
after insert on public.messages
for each row execute function public.reconcile_terminal_site_generation_message();
