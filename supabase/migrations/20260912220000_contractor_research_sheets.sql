-- Admin Contractor Research: sheet tabs + enrichment jobs owned by a row
-- (purchaser sites keep website_id). Browser cannot read these tables.

create table public.contractor_research_sheets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  original_filename text not null default '',
  headers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contractor_research_rows (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.contractor_research_sheets (id) on delete cascade,
  sort_index int not null,
  cells jsonb not null default '{}'::jsonb,
  comment text not null default '' check (char_length(comment) <= 2000),
  chain_id uuid,
  research_status text check (
    research_status is null
    or research_status in ('complete', 'partial', 'failed', 'no_results_found')
  ),
  enrichment_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sheet_id, sort_index)
);

create index contractor_research_rows_sheet_id_idx
  on public.contractor_research_rows (sheet_id, sort_index);

drop trigger if exists contractor_research_sheets_set_updated_at on public.contractor_research_sheets;
create trigger contractor_research_sheets_set_updated_at
  before update on public.contractor_research_sheets
  for each row execute function public.set_updated_at();

drop trigger if exists contractor_research_rows_set_updated_at on public.contractor_research_rows;
create trigger contractor_research_rows_set_updated_at
  before update on public.contractor_research_rows
  for each row execute function public.set_updated_at();

alter table public.contractor_research_sheets enable row level security;
alter table public.contractor_research_rows enable row level security;
revoke all on public.contractor_research_sheets from public, anon, authenticated;
revoke all on public.contractor_research_rows from public, anon, authenticated;
grant all on public.contractor_research_sheets to service_role;
grant all on public.contractor_research_rows to service_role;

alter table public.background_jobs
  alter column website_id drop not null;

alter table public.background_jobs
  add column research_row_id uuid references public.contractor_research_rows (id) on delete cascade;

alter table public.background_jobs
  add constraint background_jobs_subject_xor check (
    (
      job_type = 'enrichment_platform'
      and ((website_id is not null) <> (research_row_id is not null))
    )
    or (
      job_type <> 'enrichment_platform'
      and website_id is not null
      and research_row_id is null
    )
  );

drop index if exists public.background_jobs_chain_idempotency_uk;

create unique index background_jobs_website_chain_idempotency_uk
  on public.background_jobs (website_id, idempotency_key)
  where website_id is not null
    and idempotency_key is not null
    and sequence_index = 0;

create unique index background_jobs_research_row_chain_idempotency_uk
  on public.background_jobs (research_row_id, idempotency_key)
  where research_row_id is not null
    and idempotency_key is not null
    and sequence_index = 0;

create index background_jobs_research_row_id_idx
  on public.background_jobs (research_row_id)
  where research_row_id is not null;

-- Claim used an inner join on websites, so enrichment jobs with null website_id
-- (admin sheet rows) would never run. Site generation / add-video still require
-- a website row. Orphaned website_id jobs stay unclaimable.
create or replace function public.claim_next_background_job(
  p_runner_id text,p_stale_before timestamptz,p_generation_contract_epoch integer,p_scheduler_run_id uuid
) returns setof public.background_jobs
language plpgsql security definer set search_path=public as $$
declare
  claimed public.background_jobs%rowtype;
  dispatch public.background_job_dispatch_state%rowtype;
  class_index integer;
  step integer;
  global_active integer;
  dispatch_seq bigint;
begin
  if nullif(btrim(p_runner_id),'') is null or p_generation_contract_epoch is null
     or p_generation_contract_epoch not in (1,2) or p_scheduler_run_id is null or p_stale_before is null then
    raise exception 'Runner, capability, stale threshold, and scheduler identity are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bucket1-background-dispatch',0));
  select * into dispatch from public.background_job_dispatch_state where singleton for update;
  select count(*) into global_active from public.background_jobs
    where job_type='site_generation' and generation_contract_epoch=2 and status='running'
      and lease_expires_at>clock_timestamp();
  for step in 1..4 loop
    class_index:=(dispatch.dispatch_cursor+step)%4;
    select candidate.* into claimed
    from public.background_jobs candidate
    left join public.websites website on website.id=candidate.website_id
    where candidate.status='pending'
      and (candidate.next_retry_at is null or candidate.next_retry_at<=clock_timestamp())
      and candidate.scheduler_last_run_id is distinct from p_scheduler_run_id
      and (candidate.research_row_id is not null or website.id is not null)
      and not exists(select 1 from public.background_jobs predecessor
        where predecessor.chain_id=candidate.chain_id and predecessor.sequence_index<candidate.sequence_index
          and predecessor.status in ('pending','running','finalizing'))
      and (
        (class_index=0 and p_generation_contract_epoch=2 and candidate.job_type='site_generation'
          and candidate.generation_contract_epoch=2 and candidate.claim_epoch=0 and global_active<8)
        or (class_index=1 and candidate.job_type='enrichment_platform'
          and (candidate.attempts<candidate.max_attempts
            or candidate.payload_json->'resume_enrichment_finalization'='true'::jsonb))
        or (class_index=2 and p_generation_contract_epoch=2 and candidate.job_type='add_video'
          and candidate.generation_contract_epoch=2 and candidate.generation_contract_version=2
          and candidate.payload_json->>'generatorSchemaVersion'='4'
          and candidate.payload_json->>'addVideoStage' in (
            'planning/call','media/source-verify','media/create','media/poll',
            'media/materialize','composition/build','validation/run','persistence/commit')
          and public.add_video_stage_failure_count(candidate.payload_json) between 0 and 2
          and candidate.interruption_count<3
          and clock_timestamp()<candidate.created_at+interval '8 minutes')
        or (class_index=3 and p_generation_contract_epoch=2 and candidate.job_type='site_generation'
          and candidate.generation_contract_epoch=2 and candidate.claim_epoch>0 and global_active<8)
      )
      and (candidate.job_type not in ('site_generation','add_video') or not exists(
        select 1 from public.site_generation_media_slots slot
        where slot.job_id=candidate.id and slot.status='reconciliation_required'))
      and (candidate.job_type<>'site_generation' or (
        select count(*) from public.background_jobs active
        join public.websites active_site on active_site.id=active.website_id
        where active_site.user_id=website.user_id and active.job_type='site_generation'
          and active.generation_contract_epoch=2 and active.status='running'
          and active.lease_expires_at>clock_timestamp())<2)
    order by candidate.scheduler_last_dispatched_at nulls first,candidate.created_at,candidate.id
    limit 1 for update of candidate skip locked;
    exit when found;
  end loop;
  if claimed.id is null then return; end if;
  dispatch_seq:=dispatch.dispatch_sequence+1;
  update public.background_jobs set
    status='running',attempts=attempts+1,started_at=coalesce(started_at,clock_timestamp()),
    locked_at=clock_timestamp(),locked_by=p_runner_id,
    lease_expires_at=case when job_type='add_video'
      then least(clock_timestamp()+interval '10 minutes',created_at+interval '8 minutes')
      else clock_timestamp()+interval '10 minutes' end,
    next_retry_at=null,error_message=null,
    claim_epoch=case when job_type in ('site_generation','add_video') then claim_epoch+1 else claim_epoch end,
    generation_last_dispatched_at=case when job_type='site_generation' then clock_timestamp() else generation_last_dispatched_at end,
    generation_last_scheduler_run_id=case when job_type='site_generation' then p_scheduler_run_id else generation_last_scheduler_run_id end,
    scheduler_last_dispatched_at=clock_timestamp(),scheduler_last_run_id=p_scheduler_run_id,
    scheduler_dispatch_sequence=dispatch_seq,
    finalization_attempts=case when job_type='enrichment_platform'
      and payload_json->'resume_enrichment_finalization'='true'::jsonb then finalization_attempts+1 else finalization_attempts end,
    payload_json=case when job_type='enrichment_platform'
      then payload_json-'resume_enrichment_finalization' else payload_json end
  where id=claimed.id returning * into claimed;
  if claimed.job_type='add_video' then
    update public.site_generation_media_slots set claim_attempt=claimed.attempts,claimed_at=clock_timestamp()
      where job_id=claimed.id and status in ('planned','generating','ready');
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values(
      claimed.id::text||':'||claimed.claim_epoch::text||':add-video-claimed',claimed.id,claimed.website_id,
      coalesce(claimed.request_id,claimed.id),2,claimed.claim_epoch,
      case split_part(claimed.payload_json->>'addVideoStage','/',1)
        when 'composition' then 'composition' when 'validation' then 'validation'
        when 'persistence' then 'persistence' when 'media' then 'media' else 'planning' end,
      claimed.attempts,'claimed','server_claim','none','continue','info',false,p_runner_id,clock_timestamp(),
      jsonb_build_object('schedulerRunId',p_scheduler_run_id,'dispatchClass',class_index,'dispatchSequence',dispatch_seq)
    ) on conflict(event_key) do nothing;
  end if;
  update public.background_job_dispatch_state set dispatch_cursor=class_index,
    dispatch_sequence=dispatch_seq,updated_at=clock_timestamp() where singleton;
  if claimed.job_type='site_generation' then
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values(
      claimed.id::text||':'||claimed.claim_epoch::text||':claimed',claimed.id,claimed.website_id,
      claimed.generation_request_id,2,claimed.claim_epoch,claimed.generation_stage,claimed.stage_attempts,
      'claimed','server_claim','none','continue','info',false,p_runner_id,clock_timestamp(),
      jsonb_build_object('schedulerRunId',p_scheduler_run_id,'dispatchClass',class_index,'dispatchSequence',dispatch_seq)
    );
  end if;
  return next claimed;
end;
$$;
revoke all on function public.claim_next_background_job(text,timestamptz,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.claim_next_background_job(text,timestamptz,integer,uuid) to service_role;
comment on function public.claim_next_background_job(text,timestamptz,integer,uuid) is
  'Claim-only fair dispatcher. Enrichment may be owned by a website or a contractor_research_rows id.';
