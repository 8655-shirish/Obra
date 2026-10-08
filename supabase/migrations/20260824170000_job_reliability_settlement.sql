create or replace function public.settle_background_job(
  p_job_id uuid,
  p_job_attempts integer,
  p_status text,
  p_progress_pct integer,
  p_result_json jsonb,
  p_payload_json jsonb,
  p_error_message text,
  p_status_message text,
  p_completed_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  settled_id uuid;
begin
  if p_status not in ('pending', 'completed', 'failed', 'cancelled') then
    raise exception 'Invalid background job settlement status';
  end if;

  update public.background_jobs
  set status = p_status,
      progress_pct = p_progress_pct,
      result_json = p_result_json,
      payload_json = coalesce(p_payload_json, '{}'::jsonb),
      error_message = p_error_message,
      status_message = p_status_message,
      completed_at = p_completed_at,
      locked_at = null,
      locked_by = null
  where id = p_job_id
    and status = 'running'
    and attempts = p_job_attempts
  returning id into settled_id;

  return settled_id is not null;
end;
$$;

revoke all on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz) to service_role;

create or replace function public.settle_enrichment_job(
  p_job_id uuid,
  p_job_attempts integer,
  p_status text,
  p_result_json jsonb,
  p_payload_json jsonb,
  p_error_message text,
  p_status_message text,
  p_completed_at timestamptz
) returns table(settled boolean, finalize_chain boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.background_jobs%rowtype;
  settled_id uuid;
begin
  if p_status not in ('pending', 'completed', 'failed') then
    raise exception 'Invalid enrichment settlement status';
  end if;

  select * into claimed
  from public.background_jobs
  where id = p_job_id
  for update;

  if not found or claimed.job_type <> 'enrichment_platform'
    or claimed.status not in ('running', 'finalizing')
    or claimed.attempts <> p_job_attempts then
    return query select false, false;
    return;
  end if;

  if claimed.status = 'finalizing' then
    update public.background_jobs
    set status = p_status,
        progress_pct = case when p_status = 'completed' then 100 else progress_pct end,
        result_json = p_result_json,
        payload_json = coalesce(p_payload_json, '{}'::jsonb),
        error_message = p_error_message,
        status_message = p_status_message,
        completed_at = p_completed_at,
        locked_at = null,
        locked_by = null
    where id = p_job_id and status = 'finalizing' and attempts = p_job_attempts
    returning id into settled_id;
    return query select settled_id is not null, false;
    return;
  end if;

  if p_status = 'pending' then
    update public.background_jobs
    set status = p_status, result_json = p_result_json,
        payload_json = coalesce(p_payload_json, '{}'::jsonb), error_message = p_error_message,
        status_message = p_status_message, completed_at = null, locked_at = null, locked_by = null
    where id = p_job_id and status = 'running' and attempts = p_job_attempts
    returning id into settled_id;
    return query select settled_id is not null, false;
    return;
  end if;

  perform 1 from public.background_jobs sibling
  where sibling.chain_id = claimed.chain_id
    and sibling.id <> claimed.id
    and sibling.status in ('pending', 'running', 'finalizing')
  limit 1;

  if not found then
    update public.background_jobs
    set status = 'finalizing', result_json = p_result_json,
        payload_json = coalesce(p_payload_json, '{}'::jsonb), error_message = p_error_message,
        status_message = 'Finalizing enrichment…', completed_at = null, locked_at = now()
    where id = p_job_id and status = 'running' and attempts = p_job_attempts
    returning id into settled_id;
    return query select settled_id is not null, settled_id is not null;
    return;
  end if;

  update public.background_jobs
  set status = p_status,
      progress_pct = case when p_status = 'completed' then 100 else progress_pct end,
      result_json = p_result_json,
      payload_json = coalesce(p_payload_json, '{}'::jsonb),
      error_message = p_error_message,
      status_message = p_status_message,
      completed_at = p_completed_at,
      locked_at = null,
      locked_by = null
  where id = p_job_id and status = 'running' and attempts = p_job_attempts
  returning id into settled_id;
  return query select settled_id is not null, false;
end;
$$;

revoke all on function public.settle_enrichment_job(uuid,integer,text,jsonb,jsonb,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_enrichment_job(uuid,integer,text,jsonb,jsonb,text,text,timestamptz) to service_role;

create or replace function public.claim_next_background_job(
  p_runner_id text,
  p_stale_before timestamptz
) returns setof public.background_jobs
language plpgsql security definer set search_path = public as $$
declare claimed public.background_jobs%rowtype;
begin
  update public.background_jobs
  set status = 'pending', locked_at = null, locked_by = null,
      attempts = greatest(0, attempts - 1),
      payload_json = payload_json || '{"resume_enrichment_finalization":true}'::jsonb,
      status_message = 'Resuming enrichment finalization'
  where status = 'finalizing' and locked_at < p_stale_before;

  update public.background_jobs
  set status = 'failed', locked_at = null, locked_by = null, completed_at = now(),
      error_message = coalesce(error_message, 'Worker lease expired after maximum attempts'),
      status_message = 'Failed'
  where status = 'running' and locked_at < p_stale_before and attempts >= max_attempts;

  update public.background_jobs
  set status = 'pending', locked_at = null, locked_by = null
  where status = 'running' and locked_at < p_stale_before and attempts < max_attempts;

  select candidate.* into claimed from public.background_jobs candidate
  where candidate.status = 'pending' and candidate.attempts < candidate.max_attempts
    and coalesce((candidate.payload_json->>'next_retry_at')::timestamptz, '-infinity'::timestamptz) <= now()
    and not exists (
      select 1 from public.background_jobs predecessor where predecessor.chain_id = candidate.chain_id
        and predecessor.sequence_index < candidate.sequence_index
        and predecessor.status in ('pending', 'running', 'finalizing')
    )
    and (candidate.job_type <> 'site_generation' or not exists (
      select 1 from public.background_jobs enrichment where enrichment.website_id = candidate.website_id
        and enrichment.job_type = 'enrichment_platform'
        and enrichment.status in ('pending', 'running', 'finalizing')
    ))
  order by candidate.created_at asc for update skip locked limit 1;
  if not found then return; end if;
  update public.background_jobs set status='running', locked_at=now(), locked_by=p_runner_id,
    started_at=coalesce(started_at, now()), attempts=attempts+1,
    payload_json=payload_json - 'next_retry_at',
    status_message=coalesce(status_message, 'Running ' || coalesce(platform, job_type) || '…')
  where id=claimed.id returning * into claimed;
  return next claimed;
end;
$$;
revoke all on function public.claim_next_background_job(text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_next_background_job(text,timestamptz) to service_role;
