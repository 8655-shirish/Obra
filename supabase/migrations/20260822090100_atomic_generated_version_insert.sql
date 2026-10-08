-- Serialize version identity allocation and reject stale/cancelled generation attempts at insertion.
create or replace function public.insert_generated_website_version(
  p_website_id uuid,
  p_config_json jsonb,
  p_job_id uuid default null,
  p_job_attempts integer default null
) returns table(id uuid, version_number integer, variant_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));

  if p_job_id is not null and not exists (
    select 1 from public.background_jobs
    where background_jobs.id = p_job_id
      and background_jobs.website_id = p_website_id
      and background_jobs.status = 'running'
      and background_jobs.attempts = p_job_attempts
  ) then
    raise exception 'Generation job is no longer active';
  end if;

  select coalesce(max(wv.version_number), 0) + 1
  into next_number
  from public.website_versions wv
  where wv.website_id = p_website_id;

  return query
  insert into public.website_versions (website_id, version_number, config_json, variant_key, status)
  values (
    p_website_id,
    next_number,
    p_config_json || jsonb_build_object('variantKey', 'v' || next_number::text),
    'v' || next_number::text,
    'draft'
  )
  returning website_versions.id, website_versions.version_number, website_versions.variant_key;
end;
$$;

revoke all on function public.insert_generated_website_version(uuid, jsonb, uuid, integer) from public;
grant execute on function public.insert_generated_website_version(uuid, jsonb, uuid, integer) to service_role;
