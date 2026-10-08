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
    'chat','onboarding_submitted','admin_auto_kickoff','regenerate_variants','publishToLp',
    'generate_initial','personalize_template'
  ) then
    raise exception 'Invalid agent turn intent';
  end if;
  if (p_source_version_id is null) <> (p_source_revision is null)
     or p_source_revision < 0
     or (p_intent_type in ('regenerate_variants','personalize_template'))
        <> (p_source_version_id is not null) then
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