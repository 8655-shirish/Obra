-- Give each running agent turn a renewable fencing token. Lease timestamps provide
-- liveness diagnostics and write fencing only; they never authorize automatic takeover.
alter table public.agent_traces add column if not exists owner_token uuid;
alter table public.agent_traces add column if not exists heartbeat_at timestamptz;
alter table public.agent_traces add column if not exists lease_expires_at timestamptz;
alter table public.agent_traces add column if not exists request_id uuid;
alter table public.agent_traces add column if not exists request_payload_hash text;
alter table public.agent_traces add column if not exists source_version_id uuid references public.website_versions(id) on delete set null;
alter table public.agent_traces add column if not exists source_revision bigint;
alter table public.agent_traces add column if not exists recovered_at timestamptz;
alter table public.agent_traces add column if not exists recovered_by uuid;
alter table public.agent_traces add column if not exists recovery_reason text;

-- Running rows, including legacy/null-lease rows, remain busy until explicit terminal
-- settlement or the service-role-only administrative recovery function below.
create unique index if not exists agent_traces_request_identity_unique
  on public.agent_traces (website_id, request_id) where request_id is not null;

create table if not exists public.agent_journal_checkpoints (
  trace_id uuid primary key references public.agent_traces(id) on delete cascade,
  website_id uuid not null references public.websites(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_count integer not null,
  section_title text not null,
  section_body text not null,
  created_at timestamptz not null default now()
);
alter table public.agent_journal_checkpoints enable row level security;
grant all on public.agent_journal_checkpoints to service_role;

-- Consolidate duplicates before claim can use ON CONFLICT on the canonical website key.
do $$ declare duplicate record; canonical_id uuid; begin
  for duplicate in select website_id from public.conversations group by website_id having count(*) > 1 loop
    select id into canonical_id from public.conversations where website_id=duplicate.website_id order by created_at,id limit 1;
    update public.messages set conversation_id=canonical_id where conversation_id in
      (select id from public.conversations where website_id=duplicate.website_id and id<>canonical_id);
    update public.agent_traces set conversation_id=canonical_id where conversation_id in
      (select id from public.conversations where website_id=duplicate.website_id and id<>canonical_id);
    update public.agent_journal_checkpoints set conversation_id=canonical_id where conversation_id in
      (select id from public.conversations where website_id=duplicate.website_id and id<>canonical_id);
    delete from public.conversations where website_id=duplicate.website_id and id<>canonical_id;
  end loop;
end;
$$;
create unique index if not exists conversations_one_per_website on public.conversations(website_id);

-- Expand/deploy/contract procedure: apply this migration with the gate disabled; drain and
-- stop every legacy instance; invoke set_agent_turn_runtime_enabled(true) as service_role;
-- then start only the new bundle. Before rollback, disable the gate, stop new instances, then
-- restart legacy code. Never enable while an unfenced legacy writer can still run.
create table if not exists public.agent_turn_runtime_gate (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.agent_turn_runtime_gate(singleton, enabled) values (true, false)
on conflict (singleton) do nothing;
alter table public.agent_turn_runtime_gate enable row level security;
grant all on public.agent_turn_runtime_gate to service_role;

create or replace function public.ensure_agent_conversation(
  p_profile_id uuid, p_website_id uuid
) returns public.conversations
language plpgsql security definer set search_path = public as $$
declare canonical public.conversations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  if not exists (select 1 from public.websites where id=p_website_id and user_id=p_profile_id) then
    raise exception 'Website profile mismatch';
  end if;
  insert into public.conversations(user_id,website_id,phase)
  values(p_profile_id,p_website_id,'onboarding') on conflict (website_id) do nothing;
  select * into strict canonical from public.conversations
  where website_id=p_website_id and user_id=p_profile_id;
  return canonical;
end;
$$;
revoke all on function public.ensure_agent_conversation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ensure_agent_conversation(uuid,uuid) to service_role;

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
  if p_owner_token is null or p_request_id is null or p_request_payload_hash is null
     or p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'Invalid agent turn claim';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  if not coalesce((select enabled from public.agent_turn_runtime_gate where singleton), false) then
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
    if existing.profile_id<>p_profile_id or existing.conversation_id<>canonical_conversation_id
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

  -- Every running row is busy. Lease expiry is deliberately irrelevant here.
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
language plpgsql
security definer
set search_path = public
as $$
declare
  renewed boolean;
  turn_website_id uuid;
begin
  if p_owner_token is null or p_lease_seconds < 15 or p_lease_seconds > 600 then
    return false;
  end if;

  select website_id into turn_website_id
  from public.agent_traces
  where id = p_trace_id and owner_token = p_owner_token;
  if turn_website_id is null then return false; end if;

  -- Heartbeats are diagnostics/fencing only; they never enable takeover.
  perform pg_advisory_xact_lock(hashtextextended(turn_website_id::text || ':agent_turn', 0));
  update public.agent_traces
  set heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  where id = p_trace_id and status = 'running' and owner_token = p_owner_token;
  renewed := found;
  return renewed;
end;
$$;

create or replace function public.complete_agent_turn(
  p_trace_id uuid,
  p_owner_token uuid,
  p_status text,
  p_tool_call_count integer,
  p_round_count integer,
  p_error_message text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  completed boolean;
  turn_website_id uuid;
begin
  if p_status not in ('completed', 'error', 'cancelled') then
    raise exception 'Invalid terminal agent turn status';
  end if;

  select website_id into turn_website_id
  from public.agent_traces
  where id = p_trace_id and owner_token = p_owner_token;
  if turn_website_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(turn_website_id::text || ':agent_turn', 0));
  if exists (
    select 1 from public.agent_external_operations
    where trace_id = p_trace_id and status = 'running'
  ) then
    raise exception 'Agent turn has a running external operation';
  end if;

  update public.agent_traces
  set status = p_status,
      tool_call_count = p_tool_call_count,
      round_count = p_round_count,
      error_message = case when p_status = 'cancelled' then 'cancelled' else p_error_message end,
      completed_at = clock_timestamp(),
      heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp()
  where id = p_trace_id and status = 'running' and owner_token = p_owner_token;
  completed := found;
  return completed;
end;
$$;

drop function if exists public.claim_agent_turn(uuid, uuid, uuid, text, text, uuid, text, uuid, integer);
revoke all on function public.claim_agent_turn(uuid, uuid, text, text, uuid, text, uuid, bigint, uuid, integer) from public, anon, authenticated;
revoke all on function public.renew_agent_turn(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.complete_agent_turn(uuid, uuid, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.claim_agent_turn(uuid, uuid, text, text, uuid, text, uuid, bigint, uuid, integer) to service_role;
grant execute on function public.renew_agent_turn(uuid, uuid, integer) to service_role;
grant execute on function public.complete_agent_turn(uuid, uuid, text, integer, integer, text) to service_role;

-- Verify an owner and perform each agent-originated durable write while holding the
-- same website lock used by renewal and explicit operator recovery. A stale process can observe its
-- abort late, but it cannot commit after a successor owns the turn.
create or replace function public.insert_agent_message_owned(
  p_trace_id uuid,
  p_owner_token uuid,
  p_conversation_id uuid,
  p_role text,
  p_content text,
  p_tool_calls jsonb default null,
  p_attachments jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  turn_website_id uuid;
  message_id uuid;
begin
  select website_id into turn_website_id
  from public.agent_traces
  where id = p_trace_id and owner_token = p_owner_token;
  if turn_website_id is null then raise exception 'Agent turn ownership lost'; end if;

  perform pg_advisory_xact_lock(hashtextextended(turn_website_id::text || ':agent_turn', 0));
  if not exists (
    select 1 from public.agent_traces t
    join public.conversations c on c.id = p_conversation_id
    where t.id = p_trace_id and t.owner_token = p_owner_token
      and t.website_id = turn_website_id and t.conversation_id = p_conversation_id
      and t.status = 'running'
      and c.website_id = turn_website_id
  ) then
    raise exception 'Agent turn ownership lost';
  end if;

  insert into public.messages (
    conversation_id, role, content, tool_calls, attachments, trace_id
  ) values (
    p_conversation_id, p_role, p_content, p_tool_calls, p_attachments, p_trace_id
  ) returning id into message_id;
  return message_id;
end;
$$;

create or replace function public.enqueue_site_generation_job_owned(
  p_website_id uuid,
  p_idempotency_key text,
  p_payload_json jsonb,
  p_trace_id uuid,
  p_owner_token uuid,
  p_replay_completed boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  chain_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  if not exists (
    select 1 from public.agent_traces
    where id = p_trace_id and website_id = p_website_id
      and owner_token = p_owner_token and status = 'running'
  ) then
    raise exception 'Agent turn ownership lost';
  end if;

  chain_id := public.enqueue_site_generation_job(
    p_website_id, p_idempotency_key, p_payload_json, p_replay_completed
  );
  return chain_id;
end;
$$;

revoke all on function public.insert_agent_message_owned(uuid, uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_site_generation_job_owned(uuid, text, jsonb, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.insert_agent_message_owned(uuid, uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function public.enqueue_site_generation_job_owned(uuid, text, jsonb, uuid, uuid, boolean) to service_role;

-- Central ownership contract for every agent-originated mutation. The transaction-level
-- advisory lock remains held by the caller, serializing its mutation with explicit recovery.
create or replace function public.assert_agent_turn_owned(
  p_website_id uuid, p_trace_id uuid, p_owner_token uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  if not exists (
    select 1 from public.agent_traces
    where id = p_trace_id and website_id = p_website_id
      and owner_token = p_owner_token and status = 'running'
  ) then raise exception 'Agent turn ownership lost'; end if;
end;
$$;

create or replace function public.save_onboarding_field_owned(
  p_website_id uuid, p_trace_id uuid, p_owner_token uuid,
  p_expected_state jsonb, p_next_state jsonb, p_expected_versions jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_agent_turn_owned(p_website_id, p_trace_id, p_owner_token);
  update public.websites set onboarding_state = p_next_state, updated_at = clock_timestamp()
  where id = p_website_id and onboarding_state = p_expected_state;
  if not found then raise exception 'Onboarding state changed'; end if;
  perform public.discard_website_versions_atomic(p_website_id, p_expected_versions);
end;
$$;

create or replace function public.enqueue_enrichment_chain_owned(
  p_website_id uuid, p_trace_id uuid, p_owner_token uuid,
  p_idempotency_key text, p_chain_id uuid, p_rows jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_agent_turn_owned(p_website_id, p_trace_id, p_owner_token);
  update public.background_jobs set status = 'cancelled', locked_at = null, locked_by = null,
    idempotency_key = null
  where website_id = p_website_id and job_type = 'enrichment_platform'
    and status in ('pending', 'running', 'finalizing');
  update public.background_jobs set idempotency_key = null
  where website_id = p_website_id and idempotency_key = p_idempotency_key
    and status in ('completed', 'failed');
  insert into public.background_jobs (
    website_id, chain_id, job_type, sequence_index, platform, status,
    progress_pct, status_message, payload_json, idempotency_key
  ) select p_website_id, p_chain_id, 'enrichment_platform', row_data.sequence_index,
    row_data.platform, 'pending', 0, row_data.status_message, row_data.payload_json,
    row_data.idempotency_key
  from jsonb_to_recordset(p_rows) as row_data(
    sequence_index integer, platform text, status_message text,
    payload_json jsonb, idempotency_key text
  );
end;
$$;

create or replace function public.publish_website_version_owned(
  p_website_id uuid, p_trace_id uuid, p_owner_token uuid, p_version_id uuid,
  p_expected_revision bigint, p_expected_config_json jsonb, p_expected_media_slots jsonb default null
) returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_agent_turn_owned(p_website_id, p_trace_id, p_owner_token);
  return public.publish_website_version_atomic(
    p_website_id, p_version_id, p_expected_revision, p_expected_config_json, p_expected_media_slots
  );
end;
$$;

create or replace function public.fork_website_version_with_media_owned(
  p_website_id uuid, p_trace_id uuid, p_owner_token uuid,
  p_source_version_id uuid, p_expected_revision bigint
) returns public.website_versions language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_agent_turn_owned(p_website_id, p_trace_id, p_owner_token);
  return public.fork_website_version_with_media(p_website_id, p_source_version_id, p_expected_revision);
end;
$$;

create or replace function public.update_website_version_config_owned(
  p_website_id uuid, p_trace_id uuid, p_owner_token uuid, p_version_id uuid,
  p_expected_revision bigint, p_config_json jsonb, p_category text, p_patch_json jsonb
) returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_agent_turn_owned(p_website_id, p_trace_id, p_owner_token);
  return public.update_website_version_config_atomic(
    p_website_id, p_version_id, p_expected_revision, p_config_json, p_category, p_patch_json
  );
end;
$$;

create or replace function public.update_website_version_config_with_media_owned(
  p_website_id uuid, p_trace_id uuid, p_owner_token uuid, p_version_id uuid,
  p_expected_revision bigint, p_config_json jsonb, p_category text,
  p_patch_json jsonb, p_media_slots jsonb
) returns bigint language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_agent_turn_owned(p_website_id, p_trace_id, p_owner_token);
  return public.update_website_version_config_with_media_atomic(
    p_website_id, p_version_id, p_expected_revision, p_config_json,
    p_category, p_patch_json, p_media_slots
  );
end;
$$;

revoke all on function public.assert_agent_turn_owned(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_onboarding_field_owned(uuid, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_enrichment_chain_owned(uuid, uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.publish_website_version_owned(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fork_website_version_with_media_owned(uuid, uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.update_website_version_config_owned(uuid, uuid, uuid, uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.update_website_version_config_with_media_owned(uuid, uuid, uuid, uuid, bigint, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.assert_agent_turn_owned(uuid, uuid, uuid) to service_role;
grant execute on function public.save_onboarding_field_owned(uuid, uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.enqueue_enrichment_chain_owned(uuid, uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.publish_website_version_owned(uuid, uuid, uuid, uuid, bigint, jsonb, jsonb) to service_role;
grant execute on function public.fork_website_version_with_media_owned(uuid, uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.update_website_version_config_owned(uuid, uuid, uuid, uuid, bigint, jsonb, text, jsonb) to service_role;
grant execute on function public.update_website_version_config_with_media_owned(uuid, uuid, uuid, uuid, bigint, jsonb, text, jsonb, jsonb) to service_role;

create or replace function public.record_agent_journal_checkpoint_owned(
  p_website_id uuid, p_trace_id uuid, p_owner_token uuid,
  p_conversation_id uuid, p_message_count integer,
  p_section_title text, p_section_body text
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_agent_turn_owned(p_website_id, p_trace_id, p_owner_token);
  if not exists (
    select 1 from public.agent_traces
    where id = p_trace_id and website_id = p_website_id
      and conversation_id = p_conversation_id and owner_token = p_owner_token
      and status = 'running'
  ) then raise exception 'Agent checkpoint conversation mismatch'; end if;
  insert into public.agent_journal_checkpoints (
    trace_id, website_id, conversation_id, message_count, section_title, section_body
  ) values (
    p_trace_id, p_website_id, p_conversation_id, p_message_count, p_section_title, p_section_body
  ) on conflict (trace_id) do nothing;
  update public.conversations
  set summary = 'Checkpoint at ' || p_message_count || ' messages'
  where id = p_conversation_id and website_id = p_website_id;
  if not found then raise exception 'Agent checkpoint conversation mismatch'; end if;
end;
$$;
revoke all on function public.record_agent_journal_checkpoint_owned(uuid, uuid, uuid, uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_agent_journal_checkpoint_owned(uuid, uuid, uuid, uuid, integer, text, text) to service_role;

create or replace function public.set_agent_turn_runtime_enabled(p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.agent_turn_runtime_gate(singleton, enabled, updated_at)
  values(true, p_enabled, clock_timestamp())
  on conflict (singleton) do update set enabled=excluded.enabled, updated_at=excluded.updated_at;
end;
$$;
revoke all on function public.set_agent_turn_runtime_enabled(boolean) from public,anon,authenticated;
grant execute on function public.set_agent_turn_runtime_enabled(boolean) to service_role;

-- External provider calls are fenced durably. A running operation has no expiry:
-- only a definite provider return or an explicit administrative abandonment terminalizes it.
create table if not exists public.agent_external_operations (
  operation_key text primary key,
  website_id uuid not null references public.websites(id) on delete cascade,
  trace_id uuid not null references public.agent_traces(id) on delete cascade,
  owner_token uuid not null,
  operation_type text not null check (nullif(btrim(operation_type), '') is not null),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'abandoned')),
  started_at timestamptz not null default clock_timestamp(),
  terminal_at timestamptz,
  abandoned_by uuid,
  abandon_reason text
);
alter table public.agent_external_operations enable row level security;
revoke all on table public.agent_external_operations from public, anon, authenticated;
grant all on table public.agent_external_operations to service_role;
create index if not exists agent_external_operations_trace_status_idx
  on public.agent_external_operations(trace_id, status);

create or replace function public.begin_agent_external_operation(
  p_operation_key text,
  p_website_id uuid,
  p_trace_id uuid,
  p_owner_token uuid,
  p_operation_type text
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  if nullif(btrim(p_operation_key), '') is null
     or p_website_id is null or p_trace_id is null or p_owner_token is null
     or nullif(btrim(p_operation_type), '') is null then
    raise exception 'External operation identity is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  if not exists (
    select 1 from public.agent_traces
    where id=p_trace_id and website_id=p_website_id
      and status='running' and owner_token=p_owner_token
  ) then
    return false;
  end if;

  insert into public.agent_external_operations (
    operation_key, website_id, trace_id, owner_token, operation_type, status
  ) values (
    btrim(p_operation_key), p_website_id, p_trace_id, p_owner_token,
    btrim(p_operation_type), 'running'
  ) on conflict (operation_key) do nothing;
  return found;
end;
$$;

create or replace function public.finish_agent_external_operation(
  p_operation_key text,
  p_trace_id uuid,
  p_owner_token uuid,
  p_status text
) returns boolean language plpgsql security definer set search_path=public as $$
declare operation_website_id uuid;
begin
  if p_status not in ('completed','failed') then
    raise exception 'Invalid external operation terminal status';
  end if;

  select website_id into operation_website_id
  from public.agent_external_operations
  where operation_key=p_operation_key and trace_id=p_trace_id
    and owner_token=p_owner_token and status='running';
  if operation_website_id is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(operation_website_id::text || ':agent_turn', 0));
  update public.agent_external_operations
  set status=p_status, terminal_at=clock_timestamp()
  where operation_key=p_operation_key and trace_id=p_trace_id
    and owner_token=p_owner_token and status='running';
  return found;
end;
$$;

create or replace function public.admin_abandon_agent_external_operation(
  p_operation_key text,
  p_expected_trace_id uuid,
  p_expected_owner_token uuid,
  p_admin_actor_id uuid,
  p_reason text
) returns boolean language plpgsql security definer set search_path=public as $$
declare operation_website_id uuid;
begin
  if nullif(btrim(p_operation_key), '') is null
     or p_expected_trace_id is null or p_expected_owner_token is null
     or p_admin_actor_id is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Expected operation identity, admin actor, and reason are required';
  end if;

  select website_id into operation_website_id
  from public.agent_external_operations
  where operation_key=p_operation_key and trace_id=p_expected_trace_id
    and owner_token=p_expected_owner_token and status='running';
  if operation_website_id is null then return false; end if;

  perform pg_advisory_xact_lock(hashtextextended(operation_website_id::text || ':agent_turn', 0));
  update public.agent_external_operations
  set status='abandoned', terminal_at=clock_timestamp(),
      abandoned_by=p_admin_actor_id, abandon_reason=btrim(p_reason)
  where operation_key=p_operation_key and trace_id=p_expected_trace_id
    and owner_token=p_expected_owner_token and status='running';
  return found;
end;
$$;

-- Explicit service-role operator repair. Ordinary claim logic never invokes this RPC.
-- A running trace remains busy indefinitely until normal settlement or this action.
create or replace function public.admin_recover_agent_turn(
  p_trace_id uuid,
  p_expected_owner_token uuid,
  p_admin_actor_id uuid,
  p_status text,
  p_reason text
) returns boolean language plpgsql security definer set search_path=public as $$
declare turn_website_id uuid;
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

  perform pg_advisory_xact_lock(hashtextextended(turn_website_id::text || ':agent_turn', 0));
  if exists (
    select 1 from public.agent_external_operations
    where trace_id=p_trace_id and status='running'
  ) then
    raise exception 'Agent turn has a running external operation';
  end if;

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

revoke all on function public.begin_agent_external_operation(text,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.finish_agent_external_operation(text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_abandon_agent_external_operation(text,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_recover_agent_turn(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.begin_agent_external_operation(text,uuid,uuid,uuid,text) to service_role;
grant execute on function public.finish_agent_external_operation(text,uuid,uuid,text) to service_role;
grant execute on function public.admin_abandon_agent_external_operation(text,uuid,uuid,uuid,text) to service_role;
grant execute on function public.admin_recover_agent_turn(uuid,uuid,uuid,text,text) to service_role;