-- Restore the pre-claim recovery pass after production proved SQLSTATE 42702 on stale.id.
-- Forward-only: preserve recovery ordering, locking, retry budgets, effect reconciliation,
-- scheduler fencing, and the claimer's all-or-nothing transaction.

create or replace function public.recover_stale_background_jobs(
  p_stale_before timestamptz,p_scheduler_run_id uuid
) returns table(requeued_count integer,failed_count integer,reconciliation_count integer)
language plpgsql security definer set search_path=public as $$
declare stale_generation_job public.background_jobs%rowtype;
declare certainty text;
declare recovered boolean;
declare unresolved_count integer := 0;
declare non_generation_failed integer := 0;
begin
  if p_stale_before is null or p_scheduler_run_id is null then
    raise exception 'Stale recovery identity is required' using errcode='22023';
  end if;
  requeued_count:=0;failed_count:=0;reconciliation_count:=0;
  for stale_generation_job in
    select generation_job.*
    from public.background_jobs as generation_job
    where generation_job.job_type='site_generation'
      and generation_job.generation_contract_epoch=2
      and generation_job.status in ('running','finalizing')
      and ((generation_job.lease_expires_at is not null
          and generation_job.lease_expires_at<=clock_timestamp())
        or (generation_job.lease_expires_at is null
          and coalesce(generation_job.locked_at,generation_job.started_at,generation_job.created_at)<p_stale_before))
    order by coalesce(generation_job.lease_expires_at,generation_job.locked_at),generation_job.id
    for update of generation_job skip locked
  loop
    update public.site_generation_media_slots as media_slot
    set status='failed',effect_certainty='definite_failure',
      error_message='Expired media lease had no provider reservation or operation',slot_locked_by=null,
      slot_lease_expires_at=null,provider_reservation_id=null,provider_reserved_at=null
    where media_slot.job_id=stale_generation_job.id and media_slot.status='generating'
      and media_slot.provider_reservation_id is null and media_slot.provider_operation_id is null;
    update public.site_generation_media_slots as media_slot
    set status='reconciliation_required',effect_certainty='indeterminate',
      reconciliation_required_at=coalesce(media_slot.reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(media_slot.reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      slot_locked_by=null,slot_lease_expires_at=null,error_message='Stale worker left unresolved provider certainty'
    where media_slot.job_id=stale_generation_job.id and media_slot.status='generating'
      and (media_slot.provider_reservation_id is not null or media_slot.provider_operation_id is not null);
    get diagnostics unresolved_count = row_count;
    reconciliation_count := reconciliation_count + unresolved_count;
    certainty:=case when exists(
      select 1 from public.site_generation_media_slots as media_slot
      where media_slot.job_id=stale_generation_job.id
        and media_slot.status='reconciliation_required'
    ) then 'indeterminate' else 'none' end;
    recovered:=public.apply_site_generation_interruption(
      stale_generation_job.id,stale_generation_job.claim_epoch,'worker_lease_expired',certainty,clock_timestamp(),
      'Resuming interrupted generation',stale_generation_job.id::text||':'||stale_generation_job.claim_epoch::text||':stale-recovery',
      stale_generation_job.locked_by,null,null,
      jsonb_build_object('schedulerRunId',p_scheduler_run_id,'staleBefore',p_stale_before),true
    );
    if recovered then
      if (select generation_job.status='failed'
          from public.background_jobs as generation_job
          where generation_job.id=stale_generation_job.id) then
        failed_count:=failed_count+1;
      else requeued_count:=requeued_count+1; end if;
      update public.background_jobs as generation_job
      set scheduler_last_run_id=p_scheduler_run_id
      where generation_job.id=stale_generation_job.id;
    end if;
  end loop;

  unresolved_count := 0;
  with stale_non_generation as (
    select stale_job.id
    from public.background_jobs as stale_job
    where stale_job.job_type in ('enrichment_platform','add_video')
      and stale_job.status in ('running','finalizing')
      and coalesce(stale_job.locked_at,stale_job.started_at,stale_job.created_at)<p_stale_before
    order by stale_job.locked_at,stale_job.id
    for update of stale_job skip locked
  ), recovered_jobs as (
    update public.background_jobs as recovered_job set
      status=case
        when recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3) then 'failed'
        when recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts then 'failed'
        else 'pending' end,
      completed_at=case
        when (recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3))
          or (recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts)
          then clock_timestamp() else null end,
      next_retry_at=case
        when (recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3))
          or (recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts)
          then null else clock_timestamp() end,
      payload_json=case
        when recovered_job.status='finalizing' and recovered_job.job_type='enrichment_platform'
          and recovered_job.finalization_attempts<3
          then recovered_job.payload_json||'{"resume_enrichment_finalization":true}'::jsonb
        else recovered_job.payload_json end,
      status_message=case
        when (recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3))
          or (recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts)
          then 'Failed after stale worker recovery'
        when recovered_job.status='finalizing' and recovered_job.job_type='enrichment_platform'
          then 'Retrying enrichment finalization immediately'
        else 'Retrying after stale worker recovery' end,
      error_message=case
        when (recovered_job.status='finalizing'
          and (recovered_job.job_type='add_video' or recovered_job.finalization_attempts>=3))
          or (recovered_job.status='running' and recovered_job.attempts>=recovered_job.max_attempts)
          then coalesce(recovered_job.error_message,'Worker lease expired after maximum attempts')
        else recovered_job.error_message end,
      locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
    from stale_non_generation as stale_job
    where recovered_job.id=stale_job.id
    returning recovered_job.status
  ), counted as (
    select count(*) filter(where recovered_job.status='pending')::integer as requeued,
      count(*) filter(where recovered_job.status='failed')::integer as failed
    from recovered_jobs as recovered_job
  )
  select counted.requeued,counted.failed
  into unresolved_count,non_generation_failed
  from counted;
  requeued_count := requeued_count + coalesce(unresolved_count,0);
  failed_count := failed_count + coalesce(non_generation_failed,0);
  return next;
end;
$$;

revoke all on function public.recover_stale_background_jobs(timestamptz,uuid)
  from public,anon,authenticated,service_role;
