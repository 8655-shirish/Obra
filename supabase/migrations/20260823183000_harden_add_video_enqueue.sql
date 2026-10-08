-- Fail closed at enqueue when v3 topology or manifest/attachment parity is unverifiable.
create unique index if not exists background_jobs_one_active_add_video_target_uk
  on public.background_jobs (website_id, target_version_id)
  where job_type = 'add_video' and status in ('pending', 'running');
create or replace function public.assert_add_video_source_eligible(
  p_website_id uuid, p_version_id uuid, p_config jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare topology jsonb; theme_source text; manifest jsonb; section_name text;
begin
  topology := p_config #> '{unifiedBrief,sectionTopology}';
  theme_source := coalesce(p_config->>'themeSource', '');
  manifest := p_config #> '{mediaManifest,slots}';
  if jsonb_typeof(topology) <> 'array' or jsonb_array_length(topology) = 0 then
    raise exception 'Add video requires a valid section topology';
  end if;
  if exists (select 1 from jsonb_array_elements(topology) t where jsonb_typeof(t) <> 'object' or nullif(t->>'section','') is null)
     or (select count(*) from jsonb_array_elements(topology)) <>
        (select count(distinct t->>'section') from jsonb_array_elements(topology) t) then
    raise exception 'Add video requires unique section topology';
  end if;
  for section_name in select t->>'section' from jsonb_array_elements(topology) t loop
    if (length(theme_source) - length(replace(theme_source, 'data-site-section="' || section_name || '"', ''))) /
       greatest(length('data-site-section="' || section_name || '"'), 1) <> 1 then
      raise exception 'Add video requires one literal marker per section';
    end if;
  end loop;
  if theme_source ~ 'data-site-section[[:space:]]*=[[:space:]]*\{' then
    raise exception 'Add video does not allow dynamic section markers';
  end if;
  if jsonb_typeof(manifest) <> 'array' or jsonb_array_length(manifest) <>
    (select count(*) from public.website_version_media_slots where website_id=p_website_id and version_id=p_version_id) then
    raise exception 'Add video manifest attachment count mismatch';
  end if;
  if exists (
    select 1 from jsonb_array_elements(manifest) m
    where (select count(*) from public.website_version_media_slots a
      where a.website_id=p_website_id and a.version_id=p_version_id
        and a.slot_id=m->>'slotId' and a.asset_id=m->>'assetId'
        and lower(a.mime_type)=lower(m->>'mimeType') and a.role=m->>'role'
        and a.provenance=m->>'origin' and a.storage_path=m->>'storagePath'
        and a.required=coalesce((m->>'required')::boolean,false)
        and a.proof_eligible=coalesce((m->>'proofEligible')::boolean,false)
        and a.source_slot_id is not distinct from nullif(m->>'sourceSlotId','')
        and a.poster_slot_id is not distinct from nullif(m->>'posterSlotId','')) <> 1
  ) then raise exception 'Add video manifest attachment mismatch'; end if;
end; $$;
revoke all on function public.assert_add_video_source_eligible(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.assert_add_video_source_eligible(uuid,uuid,jsonb) to service_role;

-- Wrap the existing enqueue implementation without duplicating its concurrency/idempotency logic.
alter function public.enqueue_add_video_job(uuid,uuid,uuid,bigint) rename to enqueue_add_video_job_unchecked;
create function public.enqueue_add_video_job(
  p_website_id uuid, p_source_version_id uuid, p_request_id uuid, p_expected_revision bigint
) returns table(job_id uuid, chain_id uuid, source_version_id uuid, target_version_id uuid, status text, result jsonb, error_code text)
language plpgsql security definer set search_path=public as $$
declare source_config jsonb; existing_job public.background_jobs%rowtype;
begin
  select b.* into existing_job from public.background_jobs b
  where b.website_id=p_website_id and b.source_version_id=p_source_version_id
    and b.request_id=p_request_id and b.job_type='add_video';
  if found then
    return query select existing_job.id, existing_job.chain_id, existing_job.source_version_id,
      existing_job.target_version_id, existing_job.status, existing_job.result_json,
      coalesce(existing_job.result_json->>'errorCode', existing_job.payload_json->>'errorCode');
    return;
  end if;
  select config_json into source_config from public.website_versions where id=p_source_version_id and website_id=p_website_id;
  if source_config is null then raise exception 'Website version not found'; end if;
  perform public.assert_add_video_source_eligible(p_website_id,p_source_version_id,source_config);
  return query select * from public.enqueue_add_video_job_unchecked(p_website_id,p_source_version_id,p_request_id,p_expected_revision);
end; $$;
revoke all on function public.enqueue_add_video_job(uuid,uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.enqueue_add_video_job(uuid,uuid,uuid,bigint) to service_role;
