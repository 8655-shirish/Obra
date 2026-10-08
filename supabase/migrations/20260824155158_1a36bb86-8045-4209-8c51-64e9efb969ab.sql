-- Finalizers are active work and must obey the same workspace cancellation boundary.
create or replace function public.cancel_workspace_background_jobs(p_website_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation', 0));
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