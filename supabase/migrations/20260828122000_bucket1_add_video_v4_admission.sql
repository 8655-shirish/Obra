-- Bucket 1 Add Video admits only current schema-v4 writers. Historical schemas stay read-only.

drop function if exists public.enqueue_add_video_job(uuid,uuid,uuid,bigint);

create function public.enqueue_add_video_job(
  p_website_id uuid, p_source_version_id uuid, p_request_id uuid, p_expected_revision bigint
) returns table(
  job_id uuid, chain_id uuid, source_version_id uuid, target_version_id uuid,
  status text, result jsonb, error_code text
)
language plpgsql security definer set search_path=public as $$
declare
  existing_job public.background_jobs%rowtype;
  source_row public.website_versions%rowtype;
  target_id uuid;
  new_chain_id uuid;
  new_job_id uuid;
  next_number integer;
  replay_revision bigint;
begin
  if p_request_id is null then raise exception 'Request ID is required' using errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text||':add-video:'||p_source_version_id::text,0));
  select b.* into existing_job from public.background_jobs b
  where b.website_id=p_website_id and b.source_version_id=p_source_version_id
    and b.request_id=p_request_id and b.job_type='add_video' for update;
  if found then
    replay_revision := (existing_job.payload_json->>'acceptedExpectedRevision')::bigint;
    if replay_revision is distinct from p_expected_revision then
      raise exception 'Add video request identity conflict' using errcode='22023';
    end if;
    return query select existing_job.id,existing_job.chain_id,existing_job.source_version_id,
      existing_job.target_version_id,existing_job.status,existing_job.result_json,
      coalesce(existing_job.result_json->>'errorCode',existing_job.payload_json->>'errorCode');
    return;
  end if;

  select * into source_row from public.website_versions
  where id=p_source_version_id and website_id=p_website_id for update;
  if not found then raise exception 'Website version not found' using errcode='P0001'; end if;
  if source_row.revision<>p_expected_revision then raise exception 'Website version revision conflict' using errcode='40001'; end if;
  if source_row.status not in ('draft','selected','live') then raise exception 'Website version is not editable' using errcode='55000'; end if;
  perform public.assert_add_video_source_eligible(p_website_id,p_source_version_id,source_row.config_json);

  target_id:=p_source_version_id;
  if source_row.status='live' then
    perform pg_advisory_xact_lock(hashtextextended(p_website_id::text,0));
    select coalesce(max(version_number),0)+1 into next_number from public.website_versions where website_id=p_website_id;
    insert into public.website_versions(website_id,version_number,config_json,variant_key,status,revision)
    values(p_website_id,next_number,source_row.config_json,source_row.variant_key||'-edit-'||next_number::text,'selected',0)
    returning id into target_id;
    insert into public.website_version_media_slots(
      version_id,website_id,slot_id,asset_id,mime_type,role,provenance,required,
      source_slot_id,poster_slot_id,storage_path,proof_eligible
    ) select target_id,website_id,slot_id,asset_id,mime_type,role,provenance,required,
      source_slot_id,poster_slot_id,storage_path,proof_eligible
      from public.website_version_media_slots
      where website_id=p_website_id and version_id=p_source_version_id;
  end if;

  new_chain_id:=gen_random_uuid(); new_job_id:=gen_random_uuid();
  insert into public.background_jobs(
    id,website_id,chain_id,job_type,sequence_index,status,progress_pct,status_message,
    payload_json,request_id,source_version_id,target_version_id,
    generation_contract_epoch,generation_contract_version
  ) values(
    new_job_id,p_website_id,new_chain_id,'add_video',0,'pending',0,'Preparing this design…',
    jsonb_build_object(
      'schemaVersion',1,'kind','add-video-request','requestId',p_request_id,
      'sourceVersionId',p_source_version_id,'targetVersionId',target_id,
      'expectedRevision',case when source_row.status='live' then 0 else source_row.revision end,
      'acceptedExpectedRevision',p_expected_revision,'generatorSchemaVersion',4,
      'addVideoStage','planning/call','stageFailures','{}'::jsonb
    ),p_request_id,p_source_version_id,target_id,2,2
  );
  return query select new_job_id,new_chain_id,p_source_version_id,target_id,
    'pending'::text,null::jsonb,null::text;
end;
$$;

revoke all on function public.enqueue_add_video_job(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.enqueue_add_video_job(uuid,uuid,uuid,bigint) to service_role;

revoke all on function public.enqueue_add_video_job_unchecked(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
comment on function public.enqueue_add_video_job(uuid,uuid,uuid,bigint) is
  'Sole Add Video admission: schema-v4 operational contract, exact request/revision replay, and atomic target snapshot.';
-- Keep the historical implementation as an inaccessible reader-era body and gate the public
-- mutation contract before it can acquire media or version writes.
alter function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)
  rename to commit_add_video_to_version_historical_body;

create function public.commit_add_video_to_version(
  p_job_id uuid, p_website_id uuid, p_target_version_id uuid, p_job_attempts integer,
  p_expected_revision bigint, p_candidate_hash text, p_config_json jsonb,
  p_media_slot_id uuid, p_edit_event_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if p_config_json->>'generatorSchemaVersion' is distinct from '4' then
    raise exception 'Historical website schemas are read-only' using errcode='55000';
  end if;
  return public.commit_add_video_to_version_historical_body(
    p_job_id,p_website_id,p_target_version_id,p_job_attempts,p_expected_revision,
    p_candidate_hash,p_config_json,p_media_slot_id,p_edit_event_payload
  );
end;
$$;

revoke all on function public.commit_add_video_to_version_historical_body(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)
  to service_role;
