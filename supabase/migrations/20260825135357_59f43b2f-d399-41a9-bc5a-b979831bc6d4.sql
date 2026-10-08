-- Remove ambiguity between the RETURNS TABLE output parameter `id` and media-slot columns.
-- PostgreSQL exposes output columns as PL/pgSQL variables throughout the function body.
-- Slot-aware generation finalization creates one revision-zero aggregate and attaches its complete snapshot.
create or replace function public.insert_generated_website_version_with_slots(
  p_website_id uuid,
  p_config_json jsonb,
  p_job_id uuid,
  p_job_attempts integer,
  p_media_slot_ids uuid[]
) returns table(id uuid, version_number integer, variant_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
  claimed_job public.background_jobs%rowtype;
  new_version_id uuid;
  supplied_count integer;
  distinct_count integer;
  matched_count integer;
begin
  if p_job_id is null or p_job_attempts is null then
    raise exception 'A generation job claim is required';
  end if;

  if p_media_slot_ids is null or cardinality(p_media_slot_ids) = 0 then
    raise exception 'At least one media slot is required';
  end if;

  select count(*), count(distinct supplied.slot_uuid)
  into supplied_count, distinct_count
  from unnest(p_media_slot_ids) as supplied(slot_uuid);

  if supplied_count <> distinct_count then
    raise exception 'Media slot IDs must be unique';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));

  select *
  into claimed_job
  from public.background_jobs
  where background_jobs.id = p_job_id
  for update;

  if not found
    or claimed_job.website_id <> p_website_id
    or claimed_job.job_type <> 'site_generation'
    or claimed_job.status <> 'running'
    or claimed_job.attempts <> p_job_attempts
  then
    raise exception 'Generation job is no longer active';
  end if;

  perform 1
  from public.site_generation_media_slots slots
  where slots.id = any(p_media_slot_ids)
  order by slots.id
  for update;

  select count(*)
  into matched_count
  from public.site_generation_media_slots slots
  where slots.id = any(p_media_slot_ids)
    and slots.job_id = p_job_id
    and slots.website_id = p_website_id
    and slots.status = 'ready';

  if matched_count <> supplied_count then
    raise exception 'Media slots are missing, stale, or not ready';
  end if;

  if p_config_json->>'generator' is distinct from 'unified-site-agent'
    or coalesce(p_config_json->>'generatorSchemaVersion' not in ('2', '3'), true)
    or jsonb_typeof(p_config_json->'unifiedBrief') is distinct from 'object'
    or nullif(p_config_json#>>'{unifiedBrief,recipeId}', '') is null
    or nullif(p_config_json#>>'{unifiedBrief,recipeVersion}', '') is null
    or jsonb_typeof(p_config_json#>'{mediaManifest,slots}') is distinct from 'array'
    or jsonb_array_length(p_config_json#>'{mediaManifest,slots}') is distinct from supplied_count
  then
    raise exception 'Unified config is missing its validated brief or complete media manifest';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_config_json#>'{mediaManifest,slots}') manifest_slot
    left join public.site_generation_media_slots slots
      on slots.id = any(p_media_slot_ids)
      and slots.slot_id = manifest_slot->>'slotId'
    where slots.id is null
      or nullif(manifest_slot->>'slotId', '') is null
      or slots.asset_id is distinct from manifest_slot->>'assetId'
      or slots.mime_type is distinct from manifest_slot->>'mimeType'
      or slots.provenance is distinct from manifest_slot->>'origin'
      or slots.role is distinct from manifest_slot->>'role'
      or slots.required is distinct from coalesce((manifest_slot->>'required')::boolean, false)
      or slots.proof_eligible is distinct from coalesce((manifest_slot->>'proofEligible')::boolean, false)
      or slots.source_slot_id is distinct from manifest_slot->>'sourceSlotId'
      or slots.poster_slot_id is distinct from manifest_slot->>'posterSlotId'
      or slots.storage_path is distinct from manifest_slot->>'storagePath'
  ) then
    raise exception 'Resolved media manifest does not match the ready slot ledger';
  end if;

  if exists (
    select manifest_slot->>'slotId'
    from jsonb_array_elements(p_config_json#>'{mediaManifest,slots}') manifest_slot
    group by manifest_slot->>'slotId'
    having count(*) <> 1
  ) or exists (
    select 1
    from public.site_generation_media_slots slots
    where slots.id = any(p_media_slot_ids)
      and not exists (
        select 1
        from jsonb_array_elements(p_config_json#>'{mediaManifest,slots}') manifest_slot
        where manifest_slot->>'slotId' = slots.slot_id
      )
  ) then
    raise exception 'Resolved media manifest must cover every ready slot exactly once';
  end if;

  if exists (
    select 1
    from public.site_generation_media_slots slots
    where slots.job_id = p_job_id
      and slots.website_id = p_website_id
      and slots.required
      and (
        not (slots.id = any(p_media_slot_ids))
        or slots.status <> 'ready'
      )
  ) then
    raise exception 'Every required media slot must be ready for this job';
  end if;

  select coalesce(max(wv.version_number), 0) + 1
  into next_number
  from public.website_versions wv
  where wv.website_id = p_website_id;

  insert into public.website_versions (website_id, version_number, config_json, variant_key, status, revision)
  values (
    p_website_id,
    next_number,
    p_config_json || jsonb_build_object('variantKey', 'v' || next_number::text),
    'v' || next_number::text,
    'draft',
    0
  )
  returning website_versions.id into new_version_id;

  insert into public.website_version_media_slots (
    version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
    required, source_slot_id, poster_slot_id, storage_path, proof_eligible
  ) select new_version_id, source_slots.website_id, source_slots.slot_id, source_slots.asset_id,
      source_slots.mime_type, source_slots.role, source_slots.provenance, source_slots.required,
      source_slots.source_slot_id, source_slots.poster_slot_id, source_slots.storage_path,
      source_slots.proof_eligible
    from public.site_generation_media_slots source_slots
    where source_slots.id = any(p_media_slot_ids);

  update public.site_generation_media_slots slots
  set status = 'attached', version_id = new_version_id
  where slots.id = any(p_media_slot_ids);

  update public.background_jobs
  set status = 'completed',
      progress_pct = 100,
      status_message = 'Completed',
      result_json = jsonb_build_object(
        'variantCount', 1,
        'versionIds', jsonb_build_array(new_version_id)
      ),
      completed_at = now(),
      next_retry_at = null,
      locked_at = null,
      locked_by = null
  where background_jobs.id = p_job_id
    and background_jobs.status = 'running'
    and background_jobs.attempts = p_job_attempts;

  if not found then
    raise exception 'Generation job claim was lost before completion';
  end if;

  return query
  select new_version_id, next_number, 'v' || next_number::text;
end;
$$;

revoke all on function public.insert_generated_website_version_with_slots(uuid, jsonb, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.insert_generated_website_version_with_slots(uuid, jsonb, uuid, integer, uuid[]) to service_role;