alter table public.background_jobs
  add column if not exists failure_attempts integer not null default 0
  check (failure_attempts >= 0);

create or replace function public.claim_site_generation_stage(
  p_website_id uuid,
  p_runner_id text,
  p_stale_before timestamptz
) returns setof public.background_jobs
language plpgsql security definer set search_path = public as $$
declare claimed public.background_jobs%rowtype;
begin
  update public.site_generation_media_slots ledger
  set status='abandoned',error_message='Generation stage lease expired after maximum failures',abandoned_at=now()
  from public.background_jobs job
  where job.website_id=p_website_id and ledger.job_id=job.id and ledger.version_id is null
    and job.job_type='site_generation' and job.payload_json->>'executionMode'='browser'
    and job.status='running' and job.locked_at<p_stale_before
    and job.failure_attempts+1>=job.max_attempts
    and ledger.status in ('planned','generating','ready','failed');

  update public.background_jobs
  set failure_attempts=failure_attempts+1,
      status=case when failure_attempts+1>=max_attempts then 'failed' else 'pending' end,
      completed_at=case when failure_attempts+1>=max_attempts then now() else null end,
      locked_at=null,locked_by=null,
      next_retry_at=case when failure_attempts+1>=max_attempts then null else now() end,
      error_message=case when failure_attempts+1>=max_attempts then coalesce(error_message,'Generation stage lease expired after maximum failures') else error_message end,
      status_message=case when failure_attempts+1>=max_attempts then 'Failed' else 'Resuming interrupted generation' end
  where website_id=p_website_id and job_type='site_generation'
    and payload_json->>'executionMode'='browser' and status='running' and locked_at<p_stale_before;

  select candidate.* into claimed
  from public.background_jobs candidate
  where candidate.website_id=p_website_id and candidate.job_type='site_generation'
    and candidate.payload_json->>'generationMode'='unified'
    and candidate.payload_json->>'executionMode'='browser'
    and candidate.status='pending' and candidate.failure_attempts<candidate.max_attempts
    and (candidate.next_retry_at is null or candidate.next_retry_at<=now())
    and not exists (select 1 from public.background_jobs enrichment
      where enrichment.website_id=candidate.website_id
        and enrichment.job_type='enrichment_platform'
        and enrichment.status in ('pending','running','finalizing'))
  order by candidate.created_at,candidate.id
  for update skip locked limit 1;
  if not found then return; end if;

  update public.background_jobs
  set status='running',locked_at=now(),locked_by=p_runner_id,
      started_at=coalesce(started_at,now()),
      attempts=attempts+1,next_retry_at=null
  where id=claimed.id returning * into claimed;
  return next claimed;
end $$;
revoke all on function public.claim_site_generation_stage(uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.claim_site_generation_stage(uuid,text,timestamptz)
  to service_role;

create or replace function public.yield_site_generation_stage(
  p_job_id uuid,
  p_job_attempts integer,
  p_stage text,
  p_progress_pct integer,
  p_status_message text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare yielded_id uuid;
begin
  if p_stage not in ('media','composition') then
    raise exception 'Invalid site generation continuation stage';
  end if;
  update public.background_jobs
  set status='pending', locked_at=null, locked_by=null, next_retry_at=now(),
      completed_at=null, progress_pct=p_progress_pct, status_message=p_status_message,
      payload_json=payload_json || jsonb_build_object('generationStage',p_stage,'executionMode','browser')
  where id=p_job_id and job_type='site_generation' and status='running'
    and attempts=p_job_attempts
  returning id into yielded_id;
  return yielded_id is not null;
end $$;
revoke all on function public.yield_site_generation_stage(uuid,integer,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.yield_site_generation_stage(uuid,integer,text,integer,text)
  to service_role;

create index if not exists background_jobs_website_type_created_idx
  on public.background_jobs (website_id,job_type,created_at desc,id desc);

create or replace function public.enqueue_site_generation_job(
  p_website_id uuid, p_idempotency_key text, p_payload_json jsonb,
  p_replay_completed boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  existing_chain uuid;
  existing_payload jsonb;
  new_chain uuid := gen_random_uuid();
  generation_kind text := p_payload_json->>'generationKind';
  source_version_id uuid;
  source_revision bigint;
begin
  if jsonb_typeof(p_payload_json) is distinct from 'object'
     or jsonb_typeof(p_payload_json->'generationMode') is distinct from 'string'
     or p_payload_json->>'generationMode' not in ('unified','two-step')
     or (p_payload_json ? 'executionMode' and (
       jsonb_typeof(p_payload_json->'executionMode') is distinct from 'string'
       or p_payload_json->>'executionMode' not in ('browser','runner')
       or (p_payload_json->>'generationMode'='unified') <> (p_payload_json->>'executionMode'='browser')
     ))
     or (generation_kind='initial' and
       (p_payload_json - array['generationKind','generationMode','executionMode']) <> '{}'::jsonb)
     or (generation_kind='regeneration' and (
       (p_payload_json - array['generationKind','generationMode','executionMode','sourceVersionId','sourceRevision']) <> '{}'::jsonb
       or jsonb_typeof(p_payload_json->'sourceVersionId') <> 'string'
       or jsonb_typeof(p_payload_json->'sourceRevision') <> 'number'
       or (p_payload_json->>'sourceRevision') !~ '^\d+$'
     ))
     or generation_kind not in ('initial','regeneration') then
    raise exception 'Site generation payload is malformed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation', 0));

  select chain_id, payload_json into existing_chain, existing_payload
  from public.background_jobs
  where website_id = p_website_id and job_type = 'site_generation'
    and sequence_index = 0 and idempotency_key = p_idempotency_key
    and (status in ('pending', 'running', 'finalizing') or (p_replay_completed and status in ('completed', 'failed', 'cancelled')))
  order by created_at desc limit 1;
  if existing_chain is not null then
    if jsonb_build_object(
      'generationKind', existing_payload->'generationKind',
      'generationMode', existing_payload->'generationMode',
      'sourceVersionId', existing_payload->'sourceVersionId',
      'sourceRevision', existing_payload->'sourceRevision'
    ) is distinct from jsonb_build_object(
      'generationKind', p_payload_json->'generationKind',
      'generationMode', p_payload_json->'generationMode',
      'sourceVersionId', p_payload_json->'sourceVersionId',
      'sourceRevision', p_payload_json->'sourceRevision'
    ) then
      raise exception 'Idempotency key was already used for a different generation request';
    end if;
    return existing_chain;
  end if;

  if generation_kind = 'initial' then
    if (p_payload_json - array['generationKind', 'generationMode', 'executionMode']) <> '{}'::jsonb
       or p_payload_json ? 'sourceVersionId' or p_payload_json ? 'sourceRevision' then
      raise exception 'Initial generation cannot include a source snapshot';
    end if;
    if exists (select 1 from public.website_versions where website_id = p_website_id) then
      raise exception 'Regeneration requires a scoped source version and revision snapshot';
    end if;
  elsif generation_kind = 'regeneration' then
    if (p_payload_json - array['generationKind', 'generationMode', 'executionMode', 'sourceVersionId', 'sourceRevision']) <> '{}'::jsonb
       or not (p_payload_json ? 'sourceVersionId')
       or not (p_payload_json ? 'sourceRevision')
       or jsonb_typeof(p_payload_json->'sourceVersionId') <> 'string'
       or jsonb_typeof(p_payload_json->'sourceRevision') <> 'number'
       or (p_payload_json->>'sourceRevision') !~ '^\d+$' then
      raise exception 'Regeneration source snapshot is malformed';
    end if;
    begin
      source_version_id := (p_payload_json->>'sourceVersionId')::uuid;
      source_revision := (p_payload_json->>'sourceRevision')::bigint;
    exception when others then
      raise exception 'Regeneration source snapshot is malformed';
    end;
    if source_version_id is null or source_revision is null or source_revision < 0 or not exists (
      select 1 from public.website_versions
      where id = source_version_id and website_id = p_website_id and revision = source_revision
    ) then
      raise exception 'Regeneration source snapshot does not match';
    end if;
  else
    raise exception 'Site generation kind is required';
  end if;

  select chain_id into existing_chain
  from public.background_jobs
  where website_id = p_website_id and job_type = 'site_generation'
    and status in ('pending', 'running', 'finalizing')
  order by created_at desc limit 1;
  if existing_chain is not null then
    raise exception 'A site generation job is already active for this website';
  end if;

  insert into public.background_jobs (
    website_id, chain_id, job_type, sequence_index, platform, status,
    progress_pct, status_message, payload_json, idempotency_key
  ) values (
    p_website_id, new_chain, 'site_generation', 0, null, 'pending', 0,
    'Queued site generation…', p_payload_json, p_idempotency_key
  );
  return new_chain;
end;
$$;
revoke all on function public.enqueue_site_generation_job(uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.enqueue_site_generation_job(uuid,text,jsonb,boolean) to service_role;

create or replace function public.settle_background_job(
  p_job_id uuid,p_job_attempts integer,p_status text,p_progress_pct integer,
  p_result_json jsonb,p_payload_json jsonb,p_error_message text,
  p_status_message text,p_completed_at timestamptz
) returns boolean
language plpgsql security definer set search_path=public as $$
declare settled_id uuid;
begin
  if p_status not in ('pending','completed','failed','cancelled') then raise exception 'Invalid background job settlement status'; end if;
  if p_status in ('failed','cancelled') then
    update public.site_generation_media_slots ledger
    set status='abandoned',error_message=coalesce(p_error_message,'Site generation ended'),abandoned_at=now()
    from public.background_jobs job
    where job.id=p_job_id and job.status='running' and job.attempts=p_job_attempts
      and job.job_type='site_generation' and ledger.job_id=job.id and ledger.version_id is null
      and ledger.status in ('planned','generating','ready','failed');
  end if;
  update public.background_jobs
  set status=p_status,progress_pct=p_progress_pct,result_json=p_result_json,
      payload_json=coalesce(p_payload_json,'{}'::jsonb),error_message=p_error_message,
      status_message=p_status_message,completed_at=p_completed_at,
      next_retry_at=case when p_status='pending' then nullif(p_payload_json->>'next_retry_at','')::timestamptz else null end,
      locked_at=null,locked_by=null,failure_attempts=failure_attempts + case when job_type='site_generation' and p_status in ('pending','failed') then 1 else 0 end
  where id=p_job_id and status='running' and attempts=p_job_attempts
  returning id into settled_id;
  return settled_id is not null;
end $$;
revoke all on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz) to service_role;

create or replace function public.claim_generation_media_slot(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,p_kind text,p_role text,
  p_provenance text default 'generated',p_required boolean default true,
  p_proof_eligible boolean default false,p_source_slot_id text default null,p_poster_slot_id text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare claimed_job public.background_jobs%rowtype; result_id uuid;
begin
  select * into claimed_job from public.background_jobs where id=p_job_id for update;
  if not found or claimed_job.website_id<>p_website_id
    or claimed_job.job_type not in ('site_generation','add_video')
    or claimed_job.status<>'running' or claimed_job.attempts<>p_job_attempts then
    raise exception 'Media job is no longer active';
  end if;
  insert into public.site_generation_media_slots(
    job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,status,claim_attempt,claimed_at,source_slot_id,poster_slot_id
  ) values(
    p_job_id,p_website_id,p_slot_id,p_kind,p_role,p_provenance,p_required,p_proof_eligible,'generating',p_job_attempts,now(),p_source_slot_id,p_poster_slot_id
  ) on conflict(job_id,slot_id) do update set
    status='generating',claim_attempt=excluded.claim_attempt,claimed_at=now(),error_message=null
  where (site_generation_media_slots.status in ('planned','failed','abandoned')
      or (site_generation_media_slots.status='generating' and site_generation_media_slots.claim_attempt<excluded.claim_attempt))
    and site_generation_media_slots.kind=excluded.kind
    and site_generation_media_slots.role=excluded.role
    and site_generation_media_slots.provenance=excluded.provenance
    and site_generation_media_slots.required=excluded.required
    and site_generation_media_slots.proof_eligible=excluded.proof_eligible
    and site_generation_media_slots.source_slot_id is not distinct from excluded.source_slot_id
    and site_generation_media_slots.poster_slot_id is not distinct from excluded.poster_slot_id
  returning id into result_id;
  if result_id is null then raise exception 'Media slot cannot be claimed'; end if;
  return result_id;
end $$;
revoke all on function public.claim_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text) from public,anon,authenticated;
grant execute on function public.claim_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text) to service_role;

create or replace function public.claim_next_background_job(
  p_runner_id text, p_stale_before timestamptz
) returns setof public.background_jobs
language plpgsql security definer set search_path = public as $$
declare claimed public.background_jobs%rowtype;
begin
  update public.background_jobs
  set status = case when finalization_attempts >= 3 then 'failed' else 'pending' end,
      completed_at = case when finalization_attempts >= 3 then now() else null end,
      locked_at=null, locked_by=null,
      next_retry_at=case when finalization_attempts >= 3 then null else now() end,
      payload_json=case when finalization_attempts >= 3 then payload_json
        else payload_json || '{"resume_enrichment_finalization":true}'::jsonb end,
      error_message=case when finalization_attempts >= 3 then coalesce(error_message,'Enrichment finalization lease expired after 3 attempts') else error_message end,
      status_message=case when finalization_attempts >= 3 then 'Enrichment finalization failed after 3 attempts' else 'Retrying enrichment finalization immediately' end
  where status='finalizing' and locked_at < p_stale_before;

  perform pg_advisory_xact_lock(hashtextextended('background-job-stale-recovery', 0));
  update public.site_generation_media_slots ledger
  set status='abandoned',error_message='Worker lease expired after maximum attempts',abandoned_at=now()
  from public.background_jobs job
  where ledger.job_id=job.id and ledger.version_id is null and job.job_type='site_generation'
    and job.payload_json->>'executionMode' is distinct from 'browser'
    and job.status='running' and job.locked_at<p_stale_before and job.attempts>=job.max_attempts
    and ledger.status in ('planned','generating','ready','failed');

  with terminalized as (
    update public.background_jobs
    set status='failed', locked_at=null, locked_by=null, completed_at=now(), next_retry_at=null,
        error_message=coalesce(error_message,'Worker lease expired after maximum attempts'),
        status_message='Failed'
    where status='running' and locked_at < p_stale_before and attempts >= max_attempts
      and (job_type<>'site_generation' or payload_json->>'executionMode' is distinct from 'browser')
    returning id, chain_id, job_type
  ), elected as (
    select distinct on (terminalized.chain_id) terminalized.id
    from terminalized
    where terminalized.job_type='enrichment_platform'
      and not exists (
        select 1 from public.background_jobs sibling
        where sibling.chain_id=terminalized.chain_id
          and sibling.id not in (select id from terminalized)
          and sibling.status in ('pending','running','finalizing')
      )
    order by terminalized.chain_id, terminalized.id
  )
  update public.background_jobs finalizer
  set status='pending', completed_at=null, next_retry_at=now(), finalization_attempts=0,
      payload_json=finalizer.payload_json || '{"resume_enrichment_finalization":true}'::jsonb,
      status_message='Finalizing enrichment after terminal worker failure'
  from elected where finalizer.id=elected.id;

  update public.background_jobs
  set status='pending', locked_at=null, locked_by=null, next_retry_at=now()
  where status='running' and locked_at < p_stale_before and attempts < max_attempts
    and (job_type<>'site_generation' or payload_json->>'executionMode' is distinct from 'browser');

  select candidate.* into claimed from public.background_jobs candidate
  where candidate.status='pending'
    and (candidate.job_type<>'site_generation' or candidate.payload_json->>'executionMode' is distinct from 'browser')
    and (candidate.attempts < candidate.max_attempts or (candidate.job_type='enrichment_platform' and candidate.payload_json->'resume_enrichment_finalization' = 'true'::jsonb))
    and (candidate.next_retry_at is null or candidate.next_retry_at <= now())
    and not exists (select 1 from public.background_jobs predecessor
      where predecessor.chain_id=candidate.chain_id and predecessor.sequence_index<candidate.sequence_index
        and predecessor.status in ('pending','running','finalizing'))
    and (candidate.job_type <> 'site_generation' or not exists (select 1 from public.background_jobs enrichment
      where enrichment.website_id=candidate.website_id and enrichment.job_type='enrichment_platform'
        and enrichment.status in ('pending','running','finalizing')))
  order by candidate.created_at for update skip locked limit 1;
  if not found then return; end if;

  update public.background_jobs
  set status=case when job_type='enrichment_platform' and payload_json->'resume_enrichment_finalization' = 'true'::jsonb then 'finalizing' else 'running' end,
      locked_at=now(), locked_by=p_runner_id,
      started_at=coalesce(started_at,now()),
      attempts=attempts+1,
      next_retry_at=null,
      finalization_attempts=case when job_type='enrichment_platform' and payload_json->'resume_enrichment_finalization' = 'true'::jsonb then finalization_attempts+1 else finalization_attempts end,
      status_message=case when job_type='enrichment_platform' and payload_json->'resume_enrichment_finalization' = 'true'::jsonb then 'Finalizing enrichment…'
        else coalesce(status_message,'Running ' || coalesce(platform,job_type) || '…') end
  where id=claimed.id returning * into claimed;
  return next claimed;
end $$;
revoke all on function public.claim_next_background_job(text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_next_background_job(text,timestamptz) to service_role;

create or replace function public.cancel_workspace_background_jobs(p_website_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation', 0));
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

create or replace function public.insert_generated_website_version(
  p_website_id uuid,p_config_json jsonb,p_job_id uuid default null,p_job_attempts integer default null
) returns table(id uuid,version_number integer,variant_key text)
language plpgsql security definer set search_path=public as $$
declare next_number integer; claimed_job public.background_jobs%rowtype; new_id uuid; new_key text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text,0));
  if p_job_id is not null then
    select * into claimed_job from public.background_jobs where background_jobs.id=p_job_id for update;
    if not found or claimed_job.website_id<>p_website_id or claimed_job.job_type<>'site_generation'
      or claimed_job.status<>'running' or claimed_job.attempts<>p_job_attempts then
      raise exception 'Generation job is no longer active';
    end if;
  end if;
  select coalesce(max(wv.version_number),0)+1 into next_number from public.website_versions wv where wv.website_id=p_website_id;
  new_key := 'v'||next_number::text;
  insert into public.website_versions(website_id,version_number,config_json,variant_key,status,revision)
  values(p_website_id,next_number,p_config_json||jsonb_build_object('variantKey',new_key),new_key,'draft',0)
  returning website_versions.id into new_id;
  if p_job_id is not null then
    update public.background_jobs set status='completed',progress_pct=100,status_message='Completed',
      result_json=jsonb_build_object('variantCount',1,'versionIds',jsonb_build_array(new_id)),
      completed_at=now(),locked_at=null,locked_by=null,next_retry_at=null
    where background_jobs.id=p_job_id and background_jobs.status='running' and background_jobs.attempts=p_job_attempts;
    if not found then raise exception 'Generation job claim was lost before completion'; end if;
  end if;
  return query select new_id,next_number,new_key;
end $$;
revoke all on function public.insert_generated_website_version(uuid,jsonb,uuid,integer) from public,anon,authenticated;
grant execute on function public.insert_generated_website_version(uuid,jsonb,uuid,integer) to service_role;

create or replace function public.list_add_video_orphan_candidates(
  p_eligible_before timestamptz
) returns table(storage_path text,content_hash text,oldest_at timestamptz)
language sql stable security definer set search_path=public as $$
  select ledger.storage_path,ledger.content_hash,min(coalesce(ledger.abandoned_at,ledger.updated_at))
  from public.site_generation_media_slots ledger
  join public.background_jobs job on job.id=ledger.job_id and job.website_id=ledger.website_id
  where ledger.version_id is null
    and (job.job_type='add_video' or (job.job_type='site_generation' and job.status in ('completed','failed','cancelled')))
    and ledger.status in ('ready','failed','abandoned')
    and ledger.storage_path is not null and ledger.content_hash is not null
    and coalesce(ledger.abandoned_at,ledger.updated_at)<=p_eligible_before
  group by ledger.storage_path,ledger.content_hash
$$;
create or replace function public.add_video_storage_object_is_referenced(
  p_storage_path text,p_content_hash text,p_eligible_before timestamptz
) returns boolean language plpgsql stable security definer set search_path=public as $$
begin
  if nullif(p_storage_path,'') is null or nullif(p_content_hash,'') is null or p_eligible_before is null then
    raise exception 'Storage path, content hash, and eligibility cutoff are required';
  end if;
  return exists(
    select 1 from public.site_generation_media_slots ledger
    join public.background_jobs job on job.id=ledger.job_id and job.website_id=ledger.website_id
    where (ledger.storage_path=p_storage_path or ledger.content_hash=p_content_hash)
      and not (ledger.version_id is null
        and (job.job_type='add_video' or (job.job_type='site_generation' and job.status in ('completed','failed','cancelled')))
        and ledger.status in ('ready','failed','abandoned')
        and coalesce(ledger.abandoned_at,ledger.updated_at)<=p_eligible_before)
  ) or exists(
    select 1 from public.website_version_media_slots attachment
    where attachment.storage_path=p_storage_path or attachment.asset_id=p_content_hash
  );
end $$;
revoke all on function public.list_add_video_orphan_candidates(timestamptz) from public,anon,authenticated;
grant execute on function public.list_add_video_orphan_candidates(timestamptz) to service_role;
revoke all on function public.add_video_storage_object_is_referenced(text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.add_video_storage_object_is_referenced(text,text,timestamptz) to service_role;