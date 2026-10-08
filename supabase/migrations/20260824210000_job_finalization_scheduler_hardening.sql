-- Durable, bounded enrichment finalization and indexable retry eligibility.
alter table public.background_jobs
  drop constraint if exists background_jobs_status_check;
alter table public.background_jobs
  add constraint background_jobs_status_check
  check (status in ('pending', 'running', 'finalizing', 'completed', 'failed', 'cancelled'));

alter table public.background_jobs
  add column if not exists next_retry_at timestamptz;
alter table public.background_jobs
  add column if not exists finalization_attempts integer not null default 0;
alter table public.background_jobs
  drop constraint if exists background_jobs_finalization_attempts_check;
alter table public.background_jobs
  add constraint background_jobs_finalization_attempts_check
  check (finalization_attempts between 0 and 3);

create or replace function public.parse_background_job_retry_at(p_value text) returns timestamptz
language plpgsql stable as $$
begin
  if p_value is null then return null; end if;
  return p_value::timestamptz;
exception when others then
  return null;
end $$;

create or replace function public.sync_background_job_retry_at() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.payload_json is distinct from old.payload_json then
    new.next_retry_at := public.parse_background_job_retry_at(new.payload_json->>'next_retry_at');
  end if;
  return new;
end $$;
drop trigger if exists background_jobs_sync_retry_at on public.background_jobs;
create trigger background_jobs_sync_retry_at before insert or update of payload_json
on public.background_jobs for each row execute function public.sync_background_job_retry_at();

-- Migrate valid legacy retry timestamps; malformed JSON values become immediately eligible.
update public.background_jobs
set next_retry_at = public.parse_background_job_retry_at(payload_json->>'next_retry_at')
where payload_json ? 'next_retry_at';

create index if not exists background_jobs_claim_due_idx
  on public.background_jobs (next_retry_at, created_at)
  where status = 'pending';
create index if not exists background_jobs_stale_lease_idx
  on public.background_jobs (locked_at)
  where status in ('running', 'finalizing');
create index if not exists background_jobs_chain_active_idx
  on public.background_jobs (chain_id, sequence_index)
  where status in ('pending', 'running', 'finalizing');

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
      finalization_attempts=finalization_attempts,next_retry_at=null
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

create or replace function public.retry_enrichment_finalization(
  p_job_id uuid,
  p_job_attempts integer,
  p_error_message text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  claimed public.background_jobs%rowtype;
begin
  select * into claimed from public.background_jobs
  where id = p_job_id for update;
  if not found or claimed.status <> 'finalizing' or claimed.attempts <> p_job_attempts then
    return 'superseded';
  end if;
  if claimed.finalization_attempts >= 3 then
    update public.background_jobs
    set status='failed', completed_at=now(), locked_at=null, locked_by=null,
        error_message=coalesce(p_error_message, error_message, 'Enrichment finalization failed'),
        status_message='Enrichment finalization failed after 3 attempts', next_retry_at=null
    where id=p_job_id;
    return 'failed';
  end if;
  update public.background_jobs
  set status='pending', locked_at=null, locked_by=null, next_retry_at=now(),
      payload_json=payload_json || '{"resume_enrichment_finalization":true}'::jsonb,
      status_message='Retrying enrichment finalization immediately'
  where id=p_job_id;
  return 'pending';
end $$;
revoke all on function public.retry_enrichment_finalization(uuid,integer,text) from public, anon, authenticated;
grant execute on function public.retry_enrichment_finalization(uuid,integer,text) to service_role;

create or replace function public.claim_next_background_job(
  p_runner_id text, p_stale_before timestamptz
) returns setof public.background_jobs
language plpgsql security definer set search_path = public as $$
declare claimed public.background_jobs%rowtype;
begin
  -- A stale finalizer is retried immediately, but only up to the independent finalization budget.
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

  -- Serialize stale recovery and elect exactly one finalizer after all terminal stale siblings
  -- are accounted for. The lock is brief and covers only recovery/election, not job execution.
  perform pg_advisory_xact_lock(hashtextextended('background-job-stale-recovery', 0));
  with terminalized as (
    update public.background_jobs
    set status='failed', locked_at=null, locked_by=null, completed_at=now(), next_retry_at=null,
        error_message=coalesce(error_message,'Worker lease expired after maximum attempts'),
        status_message='Failed'
    where status='running' and locked_at < p_stale_before and attempts >= max_attempts
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
  where status='running' and locked_at < p_stale_before and attempts < max_attempts;

  select candidate.* into claimed from public.background_jobs candidate
  where candidate.status='pending'
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
revoke all on function public.claim_next_background_job(text,timestamptz) from public, anon, authenticated;
grant execute on function public.claim_next_background_job(text,timestamptz) to service_role;
create or replace function public.cancel_workspace_background_jobs(p_website_id uuid) returns integer
language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
  update public.background_jobs
  set status='cancelled', locked_at=null, locked_by=null, idempotency_key=null, completed_at=now()
  where website_id=p_website_id
    and job_type in ('enrichment_platform','site_generation')
    and status in ('pending','running');
  get diagnostics affected = row_count;
  return affected;
end $$;
revoke all on function public.cancel_workspace_background_jobs(uuid) from public,anon,authenticated;
grant execute on function public.cancel_workspace_background_jobs(uuid) to service_role;
