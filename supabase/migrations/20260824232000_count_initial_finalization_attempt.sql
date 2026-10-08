-- Count the initial finalization execution against the documented three-attempt budget.
create or replace function public.settle_enrichment_job(
  p_job_id uuid, p_job_attempts integer, p_status text, p_result_json jsonb,
  p_payload_json jsonb, p_error_message text, p_status_message text, p_completed_at timestamptz
) returns table(settled boolean, finalize_chain boolean)
language plpgsql security definer set search_path = public as $$
declare claimed public.background_jobs%rowtype; settled_id uuid;
begin
  if p_status is null or p_status not in ('pending','completed','failed') then raise exception 'Invalid enrichment settlement status'; end if;
  select * into claimed from public.background_jobs where id=p_job_id for update;
  if not found or claimed.job_type<>'enrichment_platform' or claimed.status not in ('running','finalizing') or claimed.attempts<>p_job_attempts then
    return query select false,false; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(claimed.chain_id::text, 0));
  if claimed.status='finalizing' then
    update public.background_jobs set status=p_status,
      progress_pct=case when p_status='completed' then 100 else progress_pct end,
      result_json=p_result_json,payload_json=coalesce(p_payload_json,'{}'::jsonb),error_message=p_error_message,
      status_message=p_status_message,completed_at=p_completed_at,locked_at=null,locked_by=null,next_retry_at=null
    where id=p_job_id and status='finalizing' and attempts=p_job_attempts returning id into settled_id;
    return query select settled_id is not null,false; return;
  end if;
  if p_status='pending' then
    update public.background_jobs set status='pending',result_json=p_result_json,payload_json=coalesce(p_payload_json,'{}'::jsonb),
      error_message=p_error_message,status_message=p_status_message,completed_at=null,locked_at=null,locked_by=null
    where id=p_job_id and status='running' and attempts=p_job_attempts returning id into settled_id;
    return query select settled_id is not null,false; return;
  end if;
  perform 1 from public.background_jobs sibling where sibling.chain_id=claimed.chain_id and sibling.id<>claimed.id
    and sibling.status in ('pending','running','finalizing') limit 1;
  if not found then
    update public.background_jobs set status='finalizing',result_json=p_result_json,
      payload_json=coalesce(p_payload_json,'{}'::jsonb) || '{"resume_enrichment_finalization":true}'::jsonb,
      error_message=p_error_message,status_message='Finalizing enrichment…',completed_at=null,locked_at=now(),
      finalization_attempts=finalization_attempts+1,next_retry_at=null
    where id=p_job_id and status='running' and attempts=p_job_attempts returning id into settled_id;
    return query select settled_id is not null,settled_id is not null; return;
  end if;
  update public.background_jobs set status=p_status,
    progress_pct=case when p_status='completed' then 100 else progress_pct end,
    result_json=p_result_json,payload_json=coalesce(p_payload_json,'{}'::jsonb),error_message=p_error_message,
    status_message=p_status_message,completed_at=p_completed_at,locked_at=null,locked_by=null,next_retry_at=null
  where id=p_job_id and status='running' and attempts=p_job_attempts returning id into settled_id;
  return query select settled_id is not null,false;
end $$;
revoke all on function public.settle_enrichment_job(uuid,integer,text,jsonb,jsonb,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_enrichment_job(uuid,integer,text,jsonb,jsonb,text,text,timestamptz) to service_role;
