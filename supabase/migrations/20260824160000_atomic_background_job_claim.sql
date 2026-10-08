create or replace function public.claim_next_background_job(
  p_runner_id text,
  p_stale_before timestamptz
) returns setof public.background_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.background_jobs%rowtype;
begin
  update public.background_jobs
  set status = 'failed', locked_at = null, locked_by = null, completed_at = now(),
      error_message = coalesce(error_message, 'Worker lease expired after maximum attempts'),
      status_message = 'Failed'
  where status = 'running' and locked_at < p_stale_before and attempts >= max_attempts;

  update public.background_jobs
  set status = 'pending', locked_at = null, locked_by = null
  where status = 'running' and locked_at < p_stale_before and attempts < max_attempts;

  select candidate.* into claimed
  from public.background_jobs candidate
  where candidate.status = 'pending'
    and candidate.attempts < candidate.max_attempts
    and coalesce((candidate.payload_json->>'next_retry_at')::timestamptz, '-infinity'::timestamptz) <= now()
    and not exists (
      select 1 from public.background_jobs predecessor
      where predecessor.chain_id = candidate.chain_id
        and predecessor.sequence_index < candidate.sequence_index
        and predecessor.status in ('pending', 'running')
    )
    and (
      candidate.job_type <> 'site_generation'
      or not exists (
        select 1 from public.background_jobs enrichment
        where enrichment.website_id = candidate.website_id
          and enrichment.job_type = 'enrichment_platform'
          and enrichment.status in ('pending', 'running')
      )
    )
  order by candidate.created_at asc
  for update skip locked
  limit 1;

  if not found then return; end if;

  update public.background_jobs
  set status='running', locked_at=now(), locked_by=p_runner_id,
      started_at=coalesce(started_at, now()), attempts=attempts+1,
      payload_json=payload_json - 'next_retry_at',
      status_message=coalesce(status_message, 'Running ' || coalesce(platform, job_type) || '…')
  where id=claimed.id
  returning * into claimed;
  return next claimed;
end;
$$;
revoke all on function public.claim_next_background_job(text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_next_background_job(text,timestamptz) to service_role;
