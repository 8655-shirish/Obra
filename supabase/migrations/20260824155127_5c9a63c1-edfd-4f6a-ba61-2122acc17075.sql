-- Normalize pre-rollout jobs and enforce generation source contracts atomically at enqueue.
update public.background_jobs j
set payload_json = j.payload_json || jsonb_build_object('generationKind', 'regeneration')
where j.job_type = 'site_generation'
  and j.status in ('pending', 'running', 'finalizing')
  and not (j.payload_json ? 'generationKind')
  and jsonb_typeof(j.payload_json->'sourceVersionId') = 'string'
  and jsonb_typeof(j.payload_json->'sourceRevision') = 'number'
  and (j.payload_json->>'sourceVersionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and (j.payload_json->>'sourceRevision') ~ '^\d+$'
  and exists (
    select 1 from public.website_versions v
    where v.id::text = lower(j.payload_json->>'sourceVersionId')
      and v.website_id = j.website_id
      and v.revision::text = j.payload_json->>'sourceRevision'
  );

update public.background_jobs j
set payload_json = j.payload_json || jsonb_build_object('generationKind', 'initial')
where j.job_type = 'site_generation'
  and j.status in ('pending', 'running', 'finalizing')
  and not (j.payload_json ? 'generationKind')
  and not (j.payload_json ? 'sourceVersionId')
  and not (j.payload_json ? 'sourceRevision')
  and not exists (select 1 from public.website_versions v where v.website_id = j.website_id);

update public.background_jobs j
set status = 'failed',
    status_message = 'Failed',
    error_message = 'Legacy generation job lacks a valid source snapshot',
    completed_at = now(),
    locked_at = null,
    locked_by = null,
    idempotency_key = null
where j.job_type = 'site_generation'
  and j.status in ('pending', 'running', 'finalizing')
  and not coalesce((
    (
      j.payload_json->>'generationKind' = 'initial'
      and not (j.payload_json ? 'sourceVersionId')
      and not (j.payload_json ? 'sourceRevision')
      and not exists (select 1 from public.website_versions v where v.website_id = j.website_id)
    )
    or
    (
      j.payload_json->>'generationKind' = 'regeneration'
      and jsonb_typeof(j.payload_json->'sourceVersionId') = 'string'
      and jsonb_typeof(j.payload_json->'sourceRevision') = 'number'
      and (j.payload_json->>'sourceVersionId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and (j.payload_json->>'sourceRevision') ~ '^\d+$'
      and exists (
        select 1 from public.website_versions v
        where v.id::text = lower(j.payload_json->>'sourceVersionId')
          and v.website_id = j.website_id
          and v.revision::text = j.payload_json->>'sourceRevision'
      )
    )
  ), false);

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

  if jsonb_typeof(p_payload_json) <> 'object'
     or p_payload_json->>'generationMode' not in ('unified', 'two-step') then
    raise exception 'Site generation payload is malformed';
  end if;

  if generation_kind = 'initial' then
    if (p_payload_json - array['generationKind', 'generationMode']) <> '{}'::jsonb
       or p_payload_json ? 'sourceVersionId' or p_payload_json ? 'sourceRevision' then
      raise exception 'Initial generation cannot include a source snapshot';
    end if;
    if exists (select 1 from public.website_versions where website_id = p_website_id) then
      raise exception 'Regeneration requires a scoped source version and revision snapshot';
    end if;
  elsif generation_kind = 'regeneration' then
    if (p_payload_json - array['generationKind', 'generationMode', 'sourceVersionId', 'sourceRevision']) <> '{}'::jsonb
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

revoke all on function public.enqueue_site_generation_job(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.enqueue_site_generation_job(uuid, text, jsonb, boolean) to service_role;