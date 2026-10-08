-- Bucket 1 final lifecycle convergence: fair ownership, bounded recovery, exact effects,
-- terminal parity, durable diagnostics, and linked administrative supersession.

-- Refuse to remove the last legacy owner while legacy generation is still live. Terminal epoch-1
-- rows remain readable, but an active row must be deliberately drained or migrated first.
do $bucket1_cutover$
begin
  lock table public.background_jobs in share row exclusive mode;
  if exists (
    select 1 from public.background_jobs
    where job_type = 'site_generation'
      and status in ('pending','running','finalizing')
      and generation_contract_epoch is distinct from 2
  ) then
    raise exception 'Bucket 1 cutover blocked by active epoch-1 site generation'
      using errcode = '55000';
  end if;
  if exists (
    select 1 from public.background_jobs
    where job_type = 'site_generation'
      and status in ('pending','running','finalizing')
      and generation_contract_epoch = 2
      and (
        generation_contract_version <> 2
        or generation_request_id is null
        or generation_request_hash !~ '^[0-9a-f]{64}$'
        or generation_stage not in ('context','planning','media','composition','validation','persistence')
        or generation_input_snapshot is null
        or generation_input_hash !~ '^[0-9a-f]{64}$'
        or generation_checkpoint is null
        or agent_trace_id is null
        or generation_handoff_message_id is null
      )
  ) then
    raise exception 'Bucket 1 cutover blocked by malformed active epoch-2 site generation'
      using errcode = '55000';
  end if;
end
$bucket1_cutover$;

-- Remove final-state execution surfaces which cannot prove epoch-2 ownership. The generic
-- attempts-fenced media routines remain only because Add Video uses them; their wrappers reject
-- every epoch-2 site-generation row before mutation.
do $retire_bucket1_writers$
declare
  signature text;
begin
  foreach signature in array array[
    'public.claim_site_generation_stage(uuid,text,timestamptz)',
    'public.claim_next_background_job(text,timestamptz)',
    'public.claim_next_background_job(text,timestamptz,integer)',
    'public.yield_site_generation_stage(uuid,integer,text,integer,text)',
    'public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text)',
    'public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,text,text,text)',
    'public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,text)',
    'public.insert_generated_website_version(uuid,jsonb,uuid,integer)'
  ] loop
    if to_regprocedure(signature) is not null then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', signature);
      execute format('drop function %s', signature);
    end if;
  end loop;
end
$retire_bucket1_writers$;

-- Trigger-only historical projection helpers do not need a PostgREST execution surface.
revoke all on function public.settle_agent_site_generation_message(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_agent_site_generation_message()
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_terminal_site_generation_message()
  from public, anon, authenticated, service_role;

-- One durable round-robin cursor. The four slots give generation one fresh and one resume turn,
-- while enrichment and Add Video each have a guaranteed turn when eligible.
create table if not exists public.background_job_dispatch_state (
  singleton boolean primary key default true check (singleton),
  dispatch_cursor integer not null default 0 check (dispatch_cursor between 0 and 3),
  dispatch_sequence bigint not null default 0 check (dispatch_sequence >= 0),
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.background_job_dispatch_state(singleton) values (true)
on conflict (singleton) do nothing;
alter table public.background_job_dispatch_state enable row level security;
revoke all on table public.background_job_dispatch_state from public, anon, authenticated, service_role;

alter table public.background_jobs
  add column if not exists scheduler_last_dispatched_at timestamptz,
  add column if not exists scheduler_last_run_id uuid,
  add column if not exists scheduler_dispatch_sequence bigint,
  add column if not exists supersedes_job_id uuid,
  add column if not exists superseded_by_job_id uuid,
  add column if not exists supersession_link_state text not null default 'none';

alter table public.background_jobs
  drop constraint if exists background_jobs_scheduler_dispatch_sequence_check,
  drop constraint if exists background_jobs_supersession_link_state_check,
  add constraint background_jobs_scheduler_dispatch_sequence_check
    check (scheduler_dispatch_sequence is null or scheduler_dispatch_sequence >= 0),
  add constraint background_jobs_supersession_link_state_check check (
    (supersession_link_state = 'none' and supersedes_job_id is null and superseded_by_job_id is null)
    or (supersession_link_state = 'legacy_unavailable' and status = 'superseded'
      and supersedes_job_id is null and superseded_by_job_id is null)
    or (supersession_link_state = 'linked'
      and ((supersedes_job_id is null) <> (superseded_by_job_id is null)))
  ) not valid;

update public.background_jobs
set supersession_link_state = 'legacy_unavailable'
where status = 'superseded'
  and supersession_link_state = 'none'
  and supersedes_job_id is null
  and superseded_by_job_id is null;

alter table public.background_jobs
  validate constraint background_jobs_supersession_link_state_check;

create unique index if not exists background_jobs_supersedes_job_unique
  on public.background_jobs(supersedes_job_id) where supersedes_job_id is not null;
create unique index if not exists background_jobs_superseded_by_job_unique
  on public.background_jobs(superseded_by_job_id) where superseded_by_job_id is not null;
create index if not exists background_jobs_scheduler_fairness_idx
  on public.background_jobs(status,job_type,scheduler_last_dispatched_at,created_at,id);

alter table public.background_jobs
  drop constraint if exists background_jobs_supersedes_job_fkey,
  drop constraint if exists background_jobs_superseded_by_job_fkey,
  add constraint background_jobs_supersedes_job_fkey foreign key (supersedes_job_id)
    references public.background_jobs(id) on delete restrict deferrable initially deferred,
  add constraint background_jobs_superseded_by_job_fkey foreign key (superseded_by_job_id)
    references public.background_jobs(id) on delete restrict deferrable initially deferred;

create or replace function public.guard_background_job_supersession_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare peer public.background_jobs%rowtype;
begin
  if new.supersession_link_state <> 'linked' then return null; end if;
  if new.supersedes_job_id is not null then
    select * into peer from public.background_jobs where id = new.supersedes_job_id;
    if not found or peer.website_id <> new.website_id or peer.status <> 'superseded'
       or peer.superseded_by_job_id is distinct from new.id
       or peer.supersession_link_state <> 'linked' then
      raise exception 'Generation successor link is not reciprocal' using errcode = '23514';
    end if;
  else
    select * into peer from public.background_jobs where id = new.superseded_by_job_id;
    if not found or peer.website_id <> new.website_id
       or peer.supersedes_job_id is distinct from new.id
       or peer.supersession_link_state <> 'linked' then
      raise exception 'Generation predecessor link is not reciprocal' using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.guard_background_job_supersession_link()
  from public, anon, authenticated, service_role;
drop trigger if exists guard_background_job_supersession_link on public.background_jobs;
create constraint trigger guard_background_job_supersession_link
after insert or update of supersedes_job_id,superseded_by_job_id,supersession_link_state
on public.background_jobs deferrable initially deferred
for each row execute function public.guard_background_job_supersession_link();

-- Immutable event identity survives archive. A same-key exact replay becomes a no-op before the
-- unique index; a same-key different transition raises 23505 before any caller can commit state.
create table if not exists public.site_generation_attempt_events_archive (
  source_event_id bigint primary key,
  event_key text not null unique,
  event_fingerprint text not null check (event_fingerprint ~ '^[0-9a-f]{64}$'),
  event_data jsonb not null check (jsonb_typeof(event_data) = 'object'),
  event_created_at timestamptz not null,
  archived_at timestamptz not null default clock_timestamp(),
  archive_run_id uuid not null
);
create index if not exists site_generation_attempt_events_archive_created_idx
  on public.site_generation_attempt_events_archive(event_created_at,source_event_id);

-- Cancellation, deadline expiry, and late exact callbacks retain audit metadata after a slot
-- leaves reconciliation_required; constrain only the active reconciliation shape.
alter table public.site_generation_media_slots
  drop constraint if exists site_generation_media_slots_reconciliation_check,
  add constraint site_generation_media_slots_reconciliation_check check (
    (status='reconciliation_required'
      and effect_certainty='indeterminate'
      and reconciliation_required_at is not null
      and reconciliation_deadline is not null
      and reconciliation_deadline>reconciliation_required_at
      and reconciled_at is null
      and provider_reservation_id is not null)
    or (status<>'reconciliation_required'
      and reconciliation_required_at is null
      and reconciliation_deadline is null)
  ) not valid;
alter table public.site_generation_media_slots
  validate constraint site_generation_media_slots_reconciliation_check;
alter table public.site_generation_attempt_events_archive enable row level security;
revoke all on table public.site_generation_attempt_events_archive from public,anon,authenticated;
revoke insert,update,delete,truncate on table public.site_generation_attempt_events_archive from service_role;
grant select on table public.site_generation_attempt_events_archive to service_role;

create or replace function public.site_generation_event_fingerprint(p_event jsonb)
returns text language sql immutable security definer set search_path = public as $$
  select encode(extensions.digest(convert_to(
    (p_event - array['id','created_at','started_at','completed_at','event_fingerprint']::text[])::text,
    'UTF8'), 'sha256'), 'hex');
$$;
revoke all on function public.site_generation_event_fingerprint(jsonb)
  from public,anon,authenticated,service_role;

alter table public.site_generation_attempt_events
  add column if not exists event_fingerprint text;
update public.site_generation_attempt_events event
set event_fingerprint = public.site_generation_event_fingerprint(to_jsonb(event))
where event_fingerprint is null;
alter table public.site_generation_attempt_events
  alter column event_fingerprint set not null,
  drop constraint if exists site_generation_attempt_events_fingerprint_check,
  add constraint site_generation_attempt_events_fingerprint_check
    check (event_fingerprint ~ '^[0-9a-f]{64}$');

create or replace function public.guard_site_generation_event_key()
returns trigger language plpgsql security definer set search_path = public as $$
declare existing_fingerprint text;
begin
  new.event_fingerprint := public.site_generation_event_fingerprint(to_jsonb(new));
  perform pg_advisory_xact_lock(hashtextextended('generation-event:' || new.event_key,0));
  select event_fingerprint into existing_fingerprint
  from public.site_generation_attempt_events where event_key = new.event_key;
  if not found then
    select event_fingerprint into existing_fingerprint
    from public.site_generation_attempt_events_archive where event_key = new.event_key;
  end if;
  if found then
    if existing_fingerprint = new.event_fingerprint then return null; end if;
    raise exception 'Generation event key was already used for a different transition'
      using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_site_generation_event_key()
  from public,anon,authenticated,service_role;
drop trigger if exists guard_site_generation_event_key on public.site_generation_attempt_events;
create trigger guard_site_generation_event_key
before insert on public.site_generation_attempt_events
for each row execute function public.guard_site_generation_event_key();

create or replace function public.archive_site_generation_attempt_events(
  p_batch_size integer default 1000,
  p_archive_before timestamptz default clock_timestamp() - interval '90 days',
  p_purge_before timestamptz default clock_timestamp() - interval '365 days'
) returns table(archived_count bigint,purged_count bigint)
language plpgsql security definer set search_path = public as $$
declare run_id uuid := gen_random_uuid();
begin
  if p_batch_size < 1 or p_batch_size > 10000
     or p_archive_before is null or p_purge_before is null
     or p_purge_before >= p_archive_before then
    raise exception 'Invalid generation event archive bounds' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bucket1-generation-event-archive',0));
  if exists (
    select 1 from public.site_generation_attempt_events live
    join public.site_generation_attempt_events_archive archive using (event_key)
    where live.event_fingerprint <> archive.event_fingerprint
  ) then
    raise exception 'Generation event archive identity collision' using errcode = '23505';
  end if;
  with candidates as (
    select event.* from public.site_generation_attempt_events event
    join public.background_jobs job on job.id = event.job_id
    where event.created_at < p_archive_before
      and job.status in ('completed','failed','cancelled','superseded')
    order by event.created_at,event.id
    limit p_batch_size
    for update of event skip locked
  ), inserted as (
    insert into public.site_generation_attempt_events_archive(
      source_event_id,event_key,event_fingerprint,event_data,event_created_at,archived_at,archive_run_id
    )
    select id,event_key,event_fingerprint,
      to_jsonb(candidates) - 'event_fingerprint',created_at,clock_timestamp(),run_id
    from candidates
    on conflict (source_event_id) do update set event_key=excluded.event_key
      where public.site_generation_attempt_events_archive.event_fingerprint=excluded.event_fingerprint
    returning source_event_id
  ), deleted as (
    delete from public.site_generation_attempt_events live
    using inserted,public.site_generation_attempt_events_archive archive
    where live.id = inserted.source_event_id
      and archive.source_event_id = live.id
      and archive.event_fingerprint = live.event_fingerprint
    returning live.id
  ) select count(*) into archived_count from deleted;

  with purged as (
    delete from public.site_generation_attempt_events_archive
    where event_created_at < p_purge_before
    returning source_event_id
  ) select count(*) into purged_count from purged;
  return next;
end;
$$;
revoke all on function public.archive_site_generation_attempt_events(integer,timestamptz,timestamptz)
  from public,anon,authenticated;
grant execute on function public.archive_site_generation_attempt_events(integer,timestamptz,timestamptz)
  to service_role;

-- One capped interruption transition is shared by cooperative interruption and stale recovery.
create or replace function public.apply_site_generation_interruption(
  p_job_id uuid,p_claim_epoch bigint,p_cause_code text,p_effect_certainty text,
  p_retry_at timestamptz,p_status_message text,p_event_key text,p_runner_id text,
  p_invocation_id uuid,p_deployment_id text,p_details jsonb,p_allow_expired boolean
) returns boolean
language plpgsql security definer set search_path = public as $$
declare current_job public.background_jobs%rowtype;
declare prior_event public.site_generation_attempt_events%rowtype;
declare next_count integer;
declare terminal boolean;
declare terminal_text text := 'We could not finish this website. Please try again.';
declare terminal_payload jsonb;
declare effective_certainty text := p_effect_certainty;
declare unresolved_count integer := 0;
begin
  if nullif(btrim(p_cause_code),'') is null or p_effect_certainty not in ('none','not_started','definite_failure','indeterminate')
     or p_retry_at is null or nullif(btrim(p_status_message),'') is null
     or nullif(btrim(p_event_key),'') is null or nullif(btrim(p_runner_id),'') is null
     or p_details is null or jsonb_typeof(p_details) <> 'object' or octet_length(p_details::text) > 16384 then
    raise exception 'Invalid site generation interruption' using errcode = '22023';
  end if;
  select * into prior_event from public.site_generation_attempt_events where event_key=p_event_key;
  if found then
    if prior_event.job_id=p_job_id and prior_event.claim_epoch=p_claim_epoch
       and prior_event.event_type in ('interrupted','failed')
       and prior_event.cause_code is not distinct from p_cause_code then return true; end if;
    raise exception 'Interruption event key was already used for a different transition' using errcode='23505';
  end if;
  select jsonb_populate_record(null::public.site_generation_attempt_events,event_data) into prior_event
  from public.site_generation_attempt_events_archive where event_key=p_event_key;
  if found then
    if prior_event.job_id=p_job_id and prior_event.claim_epoch=p_claim_epoch
       and prior_event.event_type in ('interrupted','failed')
       and prior_event.cause_code is not distinct from p_cause_code then return true; end if;
    raise exception 'Archived interruption event key was used for a different transition' using errcode='23505';
  end if;
  select * into current_job from public.background_jobs where id=p_job_id for update;
  if not found or current_job.job_type<>'site_generation' or current_job.generation_contract_epoch<>2
     or current_job.status not in ('running','finalizing') or current_job.claim_epoch<>p_claim_epoch
     or current_job.locked_by is distinct from p_runner_id
     or (not p_allow_expired and (current_job.lease_expires_at is null or current_job.lease_expires_at<=clock_timestamp())) then
    return false;
  end if;
  next_count := least(current_job.interruption_count+1,5);
  terminal := next_count>=5;

  if p_effect_certainty='indeterminate' then
    update public.site_generation_media_slots set
      status='reconciliation_required',effect_certainty='indeterminate',
      reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      reconciled_at=null,reconciliation_actor=null,reconciliation_reason=null,
      reconciliation_evidence=null,reconciliation_action_key=null,
      cleanup_required=terminal,slot_locked_by=null,slot_lease_expires_at=null,
      error_message='Provider certainty requires interruption reconciliation'
    where job_id=p_job_id and status='generating'
      and (provider_reservation_id is not null or provider_operation_id is not null);
  end if;
  if exists(select 1 from public.site_generation_media_slots where job_id=p_job_id and status='reconciliation_required') then
    effective_certainty := 'indeterminate';
  end if;

  if terminal then
    terminal_payload:=jsonb_build_object(
      'schemaVersion',1,'kind','site-generation-terminal','status','failed',
      'jobId',current_job.id,'requestId',current_job.generation_request_id,
      'claimEpoch',current_job.claim_epoch,'message',terminal_text,'causeCode',p_cause_code
    );
    update public.messages set content=terminal_text
    where id=current_job.generation_handoff_message_id and trace_id=current_job.agent_trace_id and role='assistant';
    if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;
    update public.agent_traces set status='error',error_message=left(p_cause_code,1000),
      completed_at=coalesce(completed_at,clock_timestamp())
    where id=current_job.agent_trace_id and website_id=current_job.website_id
      and status in ('running','completed','error');
    if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;
    update public.site_generation_media_slots set status='abandoned',abandoned_at=clock_timestamp(),
      error_message='Generation interruption budget exhausted',slot_locked_by=null,slot_lease_expires_at=null
    where job_id=p_job_id and version_id is null and status in ('planned','failed')
      and effect_certainty in ('none','not_started','definite_failure');
  end if;

  update public.background_jobs set
    status=case when terminal then 'failed' else 'pending' end,
    result_json=case when terminal then jsonb_build_object(
      'status','failed','errorCode','generation_interruption_budget_exhausted',
      'jobId',id,'requestId',generation_request_id,'claimEpoch',claim_epoch
    ) else result_json end,
    completed_at=case when terminal then clock_timestamp() else null end,
    next_retry_at=case when terminal or exists(
      select 1 from public.site_generation_media_slots slot
      where slot.job_id=p_job_id and slot.status='reconciliation_required'
    ) then null else p_retry_at end,
    locked_at=null,locked_by=null,lease_expires_at=null,
    interruption_count=next_count,
    status_message=case when terminal then 'Generation retry budget exhausted'
      when exists(select 1 from public.site_generation_media_slots slot where slot.job_id=p_job_id and slot.status='reconciliation_required')
        then 'Media provider reconciliation required'
      else left(p_status_message,1000) end,
    error_message=case when terminal then left(p_cause_code,1000) else error_message end,
    generation_terminal_message_id=case when terminal then generation_handoff_message_id else generation_terminal_message_id end,
    generation_terminal_message_payload=case when terminal then terminal_payload else generation_terminal_message_payload end,
    generation_terminal_message_at=case when terminal then clock_timestamp() else generation_terminal_message_at end
  where id=p_job_id;

  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,budget_type,
    budget_before,budget_after,runner_id,invocation_id,deployment_id,completed_at,details
  ) values (
    p_event_key,current_job.id,current_job.website_id,current_job.generation_request_id,2,current_job.claim_epoch,
    current_job.generation_stage,current_job.stage_attempts,case when terminal then 'failed' else 'interrupted' end,
    p_cause_code,effective_certainty,case when terminal then 'terminal_failure' else 'resume' end,
    case when terminal then 'error' else 'warning' end,terminal,'interruption',current_job.interruption_count,
    next_count,p_runner_id,p_invocation_id,p_deployment_id,clock_timestamp(),
    p_details||jsonb_build_object('retryAt',p_retry_at,'budgetExhausted',terminal)
  );
  return true;
end;
$$;
revoke all on function public.apply_site_generation_interruption(uuid,bigint,text,text,timestamptz,text,text,text,uuid,text,jsonb,boolean)
  from public,anon,authenticated,service_role;

create or replace function public.interrupt_site_generation_epoch(
  p_job_id uuid,p_claim_epoch bigint,p_contract_epoch integer,p_cause_code text,
  p_effect_certainty text,p_retry_at timestamptz,p_status_message text,p_event_key text,
  p_runner_id text default null,p_invocation_id uuid default null,p_deployment_id text default null,
  p_details jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_contract_epoch<>2 then raise exception 'Invalid site generation interruption' using errcode='22023'; end if;
  return public.apply_site_generation_interruption(
    p_job_id,p_claim_epoch,p_cause_code,p_effect_certainty,p_retry_at,p_status_message,
    p_event_key,p_runner_id,p_invocation_id,p_deployment_id,p_details,false
  );
end;
$$;
revoke all on function public.interrupt_site_generation_epoch(uuid,bigint,integer,text,text,timestamptz,text,text,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.interrupt_site_generation_epoch(uuid,bigint,integer,text,text,timestamptz,text,text,text,uuid,text,jsonb)
  to service_role;

-- Expired slot leases are either safely adopted or durably moved to reconciliation. A reservation
-- is treated as possibly accepted even when the last persisted certainty was not_started.
create or replace function public.claim_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,
  p_kind text,p_role text,p_provenance text default 'generated',p_required boolean default true,
  p_proof_eligible boolean default false,p_source_slot_id text default null,
  p_poster_slot_id text default null,p_runner_id text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare owned_job public.background_jobs%rowtype;
declare slot public.site_generation_media_slots%rowtype;
declare result_id uuid;
declare event_key_value text;
begin
  if nullif(btrim(p_runner_id),'') is null then raise exception 'Exact media runner is required' using errcode='22023'; end if;
  owned_job:=public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  if owned_job.generation_stage not in ('media','composition','validation','persistence') then
    raise exception 'Generation media stage is not active' using errcode='40001';
  end if;
  select * into slot from public.site_generation_media_slots
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id for update;
  if not found or slot.kind<>p_kind or slot.role<>p_role or slot.provenance<>p_provenance
     or slot.required<>p_required or slot.proof_eligible<>p_proof_eligible
     or slot.source_slot_id is distinct from p_source_slot_id
     or slot.poster_slot_id is distinct from p_poster_slot_id then
    raise exception 'Media slot cannot be claimed' using errcode='40001';
  end if;
  if slot.status='ready' then return slot.id; end if;
  if slot.status='generating' and slot.slot_lease_expires_at<=clock_timestamp()
     and (slot.provider_reservation_id is not null or slot.provider_operation_id is not null
       or slot.effect_certainty in ('indeterminate','definite_success')) then
    event_key_value:=p_job_id::text||':'||p_slot_id||':'||slot.slot_claim_epoch::text||':expired-effect-reconciliation';
    update public.site_generation_media_slots set status='reconciliation_required',effect_certainty='indeterminate',
      reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      slot_locked_by=null,slot_lease_expires_at=null,error_message='Expired media lease has unresolved provider certainty'
    where id=slot.id;
    update public.background_jobs set status='pending',next_retry_at=null,locked_at=null,locked_by=null,
      lease_expires_at=null,status_message='Media provider reconciliation required'
    where id=p_job_id and claim_epoch=p_claim_epoch and status='running';
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,unit_id,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values (
      event_key_value,p_job_id,p_website_id,owned_job.generation_request_id,2,p_claim_epoch,'media',
      owned_job.stage_attempts,p_slot_id,'reconciliation_required','expired_media_lease','indeterminate',
      'reconcile','error',true,p_runner_id,clock_timestamp(),
      jsonb_build_object('slotId',p_slot_id,'reservationId',slot.provider_reservation_id,'slotClaimEpoch',slot.slot_claim_epoch)
    );
    return null;
  end if;
  if slot.status not in ('planned','failed','generating')
     or (slot.status='generating' and (slot.slot_lease_expires_at is null or slot.slot_lease_expires_at>clock_timestamp())) then
    raise exception 'Media slot cannot be claimed' using errcode='40001';
  end if;
  update public.site_generation_media_slots set status='generating',claim_epoch=p_claim_epoch,
    slot_claim_epoch=slot_claim_epoch+1,slot_locked_by=p_runner_id,
    slot_lease_expires_at=clock_timestamp()+interval '10 minutes',claimed_at=clock_timestamp(),
    error_message=null,provider_reservation_id=null,provider_reserved_at=null,provider_operation_id=null,
    effect_certainty='not_started',reconciliation_required_at=null,reconciliation_deadline=null,
    reconciled_at=null,reconciliation_actor=null,reconciliation_reason=null,reconciliation_evidence=null,
    reconciliation_action_key=null,cleanup_required=false,cleanup_completed_at=null
  where id=slot.id returning id into result_id;
  return result_id;
end;
$$;
revoke all on function public.claim_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,text)
  from public,anon,authenticated;
grant execute on function public.claim_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,text)
  to service_role;

-- Replace the unfenced ready writer with an exact reservation + slot-claim identity.
revoke all on function public.record_generation_media_slot_epoch(
  uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text
) from public,anon,authenticated,service_role;
drop function public.record_generation_media_slot_epoch(
  uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text
);
create function public.record_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,
  p_reservation_id uuid,p_slot_claim_epoch bigint,
  p_kind text,p_role text,p_provenance text,p_required boolean,p_proof_eligible boolean,
  p_storage_path text,p_mime_type text,p_width integer default null,p_height integer default null,
  p_content_hash text default null,p_source_slot_id text default null,p_poster_slot_id text default null,
  p_byte_size bigint default null,p_duration_ms integer default null,p_video_codec text default null,
  p_video_profile text default null,p_has_audio boolean default null,p_audio_codec text default null,
  p_validator_version text default null,p_effect_certainty text default 'definite_success',
  p_runner_id text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
declare slot public.site_generation_media_slots%rowtype;
declare late_terminal boolean;
begin
  if p_reservation_id is null or p_slot_claim_epoch is null or p_effect_certainty<>'definite_success'
     or nullif(btrim(p_storage_path),'') is null or nullif(btrim(p_mime_type),'') is null
     or nullif(btrim(p_content_hash),'') is null or nullif(btrim(p_runner_id),'') is null then
    raise exception 'Exact definitely successful durable media identity is required' using errcode='22023';
  end if;
  select * into job from public.background_jobs where id=p_job_id and website_id=p_website_id for update;
  select * into slot from public.site_generation_media_slots
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id for update;
  if not found or job.generation_contract_epoch<>2 or job.claim_epoch<>p_claim_epoch
     or slot.provider_reservation_id is distinct from p_reservation_id
     or slot.slot_claim_epoch<>p_slot_claim_epoch
     or slot.kind<>p_kind or slot.role<>p_role or slot.provenance<>p_provenance
     or slot.required<>p_required or slot.proof_eligible<>p_proof_eligible
     or slot.source_slot_id is distinct from p_source_slot_id
     or slot.poster_slot_id is distinct from p_poster_slot_id then
    raise exception 'Media reservation or slot claim fence was lost before ready' using errcode='40001';
  end if;
  late_terminal:=job.status in ('cancelled','failed','superseded')
    and slot.status in ('reconciliation_required','abandoned')
    and slot.effect_certainty='indeterminate' and slot.cleanup_required;
  if not late_terminal and (
    job.status<>'running' or job.locked_by<>p_runner_id or job.lease_expires_at<=clock_timestamp()
    or slot.status<>'generating' or slot.slot_locked_by<>p_runner_id
    or slot.slot_lease_expires_at<=clock_timestamp()
  ) then
    raise exception 'Media owner lease was lost before ready' using errcode='40001';
  end if;
  update public.site_generation_media_slots set
    asset_id=p_content_hash,status='ready',storage_path=p_storage_path,mime_type=p_mime_type,
    width=p_width,height=p_height,content_hash=p_content_hash,byte_size=p_byte_size,duration_ms=p_duration_ms,
    video_codec=case when p_video_codec is null then null else lower(p_video_codec) end,
    video_profile=p_video_profile,has_audio=p_has_audio,audio_codec=p_audio_codec,
    validator_version=p_validator_version,error_message=null,effect_certainty='definite_success',
    abandoned_at=null,version_id=null,slot_locked_by=null,slot_lease_expires_at=null,
    reconciliation_actor=case when late_terminal then 'provider-callback' else reconciliation_actor end,
    reconciliation_reason=case when late_terminal then 'Exact late provider success persisted' else reconciliation_reason end,
    reconciliation_action_key=case when late_terminal then p_job_id::text||':'||p_slot_id||':'||p_reservation_id::text||':late-ready' else reconciliation_action_key end,
    reconciled_at=case when late_terminal then clock_timestamp() else reconciled_at end,
    reconciliation_required_at=null,reconciliation_deadline=null,
    cleanup_required=case when late_terminal then true else cleanup_required end
  where id=slot.id;
  if late_terminal then
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,unit_id,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values (
      p_job_id::text||':'||p_slot_id||':'||p_reservation_id::text||':late-ready',p_job_id,p_website_id,
      job.generation_request_id,2,p_claim_epoch,'media',job.stage_attempts,p_slot_id,'reconciled',
      'late_provider_success','definite_success','cleanup','warning',false,p_runner_id,clock_timestamp(),
      jsonb_build_object('reservationId',p_reservation_id,'slotClaimEpoch',p_slot_claim_epoch,'terminalStatus',job.status)
    );
  end if;
  return slot.id;
end;
$$;
revoke all on function public.record_generation_media_slot_epoch(
  uuid,uuid,bigint,text,uuid,bigint,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.record_generation_media_slot_epoch(
  uuid,uuid,bigint,text,uuid,bigint,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text
) to service_role;

-- Deadline convergence is deterministic and bounded. It never claims provider failure: overdue
-- certainty remains indeterminate and requires cleanup, while active required work fails safely.
create or replace function public.reconcile_due_generation_media(
  p_limit integer default 100,p_actor text default 'scheduler:bucket1-reconciliation'
) returns table(processed_count integer,terminalized_count integer,requeued_count integer)
language plpgsql security definer set search_path=public as $$
declare slot public.site_generation_media_slots%rowtype;
declare job public.background_jobs%rowtype;
declare action_key text;
declare terminal_text text := 'We could not finish this website. Please try again.';
declare terminal_payload jsonb;
begin
  if p_limit<1 or p_limit>1000 or nullif(btrim(p_actor),'') is null then
    raise exception 'Invalid reconciliation sweep bounds' using errcode='22023';
  end if;
  processed_count:=0; terminalized_count:=0; requeued_count:=0;
  for slot in
    select * from public.site_generation_media_slots
    where status='reconciliation_required' and reconciliation_deadline<=clock_timestamp()
    order by reconciliation_deadline,id limit p_limit for update skip locked
  loop
    select * into job from public.background_jobs where id=slot.job_id and website_id=slot.website_id for update;
    action_key:=slot.job_id::text||':'||slot.slot_id||':'||slot.provider_reservation_id::text||':deadline';
    update public.site_generation_media_slots set status='abandoned',abandoned_at=clock_timestamp(),
      reconciliation_actor=btrim(p_actor),reconciliation_reason='Provider certainty deadline expired',
      reconciliation_evidence=jsonb_build_object('deadline',slot.reconciliation_deadline,'required',slot.required),
      reconciliation_action_key=action_key,reconciled_at=clock_timestamp(),
      reconciliation_required_at=null,reconciliation_deadline=null,cleanup_required=true,
      cleanup_completed_at=null,slot_locked_by=null,slot_lease_expires_at=null,
      error_message='Provider certainty deadline expired; cleanup required'
    where id=slot.id;
    processed_count:=processed_count+1;
    if job.status in ('pending','running','finalizing') then
      if slot.required then
        terminal_payload:=jsonb_build_object(
          'schemaVersion',1,'kind','site-generation-terminal','status','failed',
          'jobId',job.id,'requestId',job.generation_request_id,'claimEpoch',job.claim_epoch,
          'message',terminal_text,'causeCode','media_reconciliation_deadline_exceeded'
        );
        update public.messages set content=terminal_text
        where id=job.generation_handoff_message_id and trace_id=job.agent_trace_id and role='assistant';
        if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;
        update public.agent_traces set status='error',error_message='media_reconciliation_deadline_exceeded',
          completed_at=coalesce(completed_at,clock_timestamp())
        where id=job.agent_trace_id and website_id=job.website_id and status in ('running','completed','error');
        if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;
        update public.background_jobs set status='failed',completed_at=clock_timestamp(),next_retry_at=null,
          locked_at=null,locked_by=null,lease_expires_at=null,status_message='Generation media reconciliation expired',
          error_message='media_reconciliation_deadline_exceeded',
          result_json=jsonb_build_object('status','failed','errorCode','media_reconciliation_deadline_exceeded',
            'jobId',id,'requestId',generation_request_id,'claimEpoch',claim_epoch),
          generation_terminal_message_id=generation_handoff_message_id,
          generation_terminal_message_payload=terminal_payload,generation_terminal_message_at=clock_timestamp()
        where id=job.id;
        terminalized_count:=terminalized_count+1;
      else
        update public.background_jobs set status='pending',completed_at=null,next_retry_at=clock_timestamp(),
          locked_at=null,locked_by=null,lease_expires_at=null,
          status_message='Optional media reconciliation expired; resuming without it'
        where id=job.id;
        requeued_count:=requeued_count+1;
      end if;
    end if;
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,unit_id,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values (
      action_key,job.id,job.website_id,job.generation_request_id,2,job.claim_epoch,'media',job.stage_attempts,
      slot.slot_id,'reconciled','provider_reconciliation_deadline','indeterminate','cleanup',
      case when slot.required then 'error' else 'warning' end,slot.required,p_actor,clock_timestamp(),
      jsonb_build_object('reservationId',slot.provider_reservation_id,'required',slot.required,'terminalStatus',job.status)
    );
  end loop;
  return next;
end;
$$;
revoke all on function public.reconcile_due_generation_media(integer,text)
  from public,anon,authenticated;
grant execute on function public.reconcile_due_generation_media(integer,text) to service_role;

-- All-class recovery uses the caller's stale threshold for non-generation jobs and DB leases for
-- epoch-2 generation. Every generation recovery consumes exactly one capped interruption.
create or replace function public.recover_stale_background_jobs(
  p_stale_before timestamptz,p_scheduler_run_id uuid
) returns table(requeued_count integer,failed_count integer,reconciliation_count integer)
language plpgsql security definer set search_path=public as $$
declare stale public.background_jobs%rowtype;
declare certainty text;
declare recovered boolean;
declare unresolved_count integer := 0;
declare non_generation_failed integer := 0;
begin
  if p_stale_before is null or p_scheduler_run_id is null then
    raise exception 'Stale recovery identity is required' using errcode='22023';
  end if;
  requeued_count:=0;failed_count:=0;reconciliation_count:=0;
  for stale in
    select * from public.background_jobs
    where job_type='site_generation' and generation_contract_epoch=2
      and status in ('running','finalizing')
      and ((lease_expires_at is not null and lease_expires_at<=clock_timestamp())
        or (lease_expires_at is null and coalesce(locked_at,started_at,created_at)<p_stale_before))
    order by coalesce(lease_expires_at,locked_at),id for update skip locked
  loop
    update public.site_generation_media_slots set status='failed',effect_certainty='definite_failure',
      error_message='Expired media lease had no provider reservation or operation',slot_locked_by=null,
      slot_lease_expires_at=null,provider_reservation_id=null,provider_reserved_at=null
    where job_id=stale.id and status='generating'
      and provider_reservation_id is null and provider_operation_id is null;
    update public.site_generation_media_slots set status='reconciliation_required',effect_certainty='indeterminate',
      reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
      reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
      slot_locked_by=null,slot_lease_expires_at=null,error_message='Stale worker left unresolved provider certainty'
    where job_id=stale.id and status='generating'
      and (provider_reservation_id is not null or provider_operation_id is not null);
    get diagnostics unresolved_count = row_count;
    reconciliation_count := reconciliation_count + unresolved_count;
    certainty:=case when exists(
      select 1 from public.site_generation_media_slots where job_id=stale.id and status='reconciliation_required'
    ) then 'indeterminate' else 'none' end;
    recovered:=public.apply_site_generation_interruption(
      stale.id,stale.claim_epoch,'worker_lease_expired',certainty,clock_timestamp(),
      'Resuming interrupted generation',stale.id::text||':'||stale.claim_epoch::text||':stale-recovery',
      stale.locked_by,null,null,jsonb_build_object('schedulerRunId',p_scheduler_run_id,'staleBefore',p_stale_before),true
    );
    if recovered then
      if (select status='failed' from public.background_jobs where id=stale.id) then
        failed_count:=failed_count+1;
      else requeued_count:=requeued_count+1; end if;
      update public.background_jobs set scheduler_last_run_id=p_scheduler_run_id where id=stale.id;
    end if;
  end loop;

  unresolved_count := 0;
  with stale_non_generation as (
    select id from public.background_jobs
    where job_type in ('enrichment_platform','add_video')
      and status in ('running','finalizing') and coalesce(locked_at,started_at,created_at)<p_stale_before
    order by locked_at,id for update skip locked
  ), recovered_jobs as (
    update public.background_jobs job set
      status=case
        when job.status='finalizing' and (job.job_type='add_video' or job.finalization_attempts>=3) then 'failed'
        when job.status='running' and job.attempts>=job.max_attempts then 'failed'
        else 'pending' end,
      completed_at=case
        when (job.status='finalizing' and (job.job_type='add_video' or job.finalization_attempts>=3))
          or (job.status='running' and job.attempts>=job.max_attempts) then clock_timestamp() else null end,
      next_retry_at=case
        when (job.status='finalizing' and (job.job_type='add_video' or job.finalization_attempts>=3))
          or (job.status='running' and job.attempts>=job.max_attempts) then null else clock_timestamp() end,
      payload_json=case when job.status='finalizing' and job.job_type='enrichment_platform'
        and job.finalization_attempts<3
        then job.payload_json||'{"resume_enrichment_finalization":true}'::jsonb else job.payload_json end,
      status_message=case
        when (job.status='finalizing' and (job.job_type='add_video' or job.finalization_attempts>=3))
          or (job.status='running' and job.attempts>=job.max_attempts) then 'Failed after stale worker recovery'
        when job.status='finalizing' and job.job_type='enrichment_platform' then 'Retrying enrichment finalization immediately'
        else 'Retrying after stale worker recovery' end,
      error_message=case
        when (job.status='finalizing' and (job.job_type='add_video' or job.finalization_attempts>=3))
          or (job.status='running' and job.attempts>=job.max_attempts)
        then coalesce(job.error_message,'Worker lease expired after maximum attempts') else job.error_message end,
      locked_at=null,locked_by=null,lease_expires_at=null,scheduler_last_run_id=p_scheduler_run_id
    from stale_non_generation stale where job.id=stale.id
    returning job.status
  ), counted as (
    select count(*) filter(where status='pending')::integer as requeued,
      count(*) filter(where status='failed')::integer as failed from recovered_jobs
  ) select requeued,failed into unresolved_count,non_generation_failed from counted;
  requeued_count := requeued_count + coalesce(unresolved_count,0);
  failed_count := failed_count + coalesce(non_generation_failed,0);
  return next;
end;
$$;
revoke all on function public.recover_stale_background_jobs(timestamptz,uuid)
  from public,anon,authenticated,service_role;

-- Four-class round robin: fresh generation -> enrichment -> Add Video -> resumed generation.
-- Empty classes are skipped, but an eligible class advances the cursor and therefore cannot starve.
create or replace function public.claim_next_background_job(
  p_runner_id text,p_stale_before timestamptz,p_generation_contract_epoch integer,p_scheduler_run_id uuid
) returns setof public.background_jobs
language plpgsql security definer set search_path=public as $$
declare claimed public.background_jobs%rowtype;
declare dispatch public.background_job_dispatch_state%rowtype;
declare class_index integer;
declare step integer;
declare global_active integer;
declare dispatch_seq bigint;
begin
  if nullif(btrim(p_runner_id),'') is null or p_generation_contract_epoch<>2
     or p_scheduler_run_id is null or p_stale_before is null then
    raise exception 'Runner, capability, stale threshold, and scheduler identity are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('bucket1-background-dispatch',0));
  perform * from public.reconcile_due_generation_media(100,'scheduler:'||p_scheduler_run_id::text);
  perform * from public.recover_stale_background_jobs(p_stale_before,p_scheduler_run_id);
  select * into dispatch from public.background_job_dispatch_state where singleton for update;
  select count(*) into global_active from public.background_jobs
    where job_type='site_generation' and generation_contract_epoch=2 and status='running'
      and lease_expires_at>clock_timestamp();

  for step in 1..4 loop
    class_index:=(dispatch.dispatch_cursor+step)%4;
    select candidate.* into claimed
    from public.background_jobs candidate
    join public.websites website on website.id=candidate.website_id
    where candidate.status='pending'
      and (candidate.next_retry_at is null or candidate.next_retry_at<=clock_timestamp())
      and candidate.scheduler_last_run_id is distinct from p_scheduler_run_id
      and not exists(select 1 from public.background_jobs predecessor
        where predecessor.chain_id=candidate.chain_id and predecessor.sequence_index<candidate.sequence_index
          and predecessor.status in ('pending','running','finalizing'))
      and (
        (class_index=0 and candidate.job_type='site_generation' and candidate.generation_contract_epoch=2
          and candidate.claim_epoch=0 and global_active<8)
        or (class_index=1 and candidate.job_type='enrichment_platform'
          and (candidate.attempts<candidate.max_attempts
            or candidate.payload_json->'resume_enrichment_finalization'='true'::jsonb))
        or (class_index=2 and candidate.job_type='add_video' and candidate.attempts<candidate.max_attempts)
        or (class_index=3 and candidate.job_type='site_generation' and candidate.generation_contract_epoch=2
          and candidate.claim_epoch>0 and global_active<8)
      )
      and (candidate.job_type<>'site_generation' or (
        not exists(select 1 from public.site_generation_media_slots slot
          where slot.job_id=candidate.id and slot.status='reconciliation_required')
        and (select count(*) from public.background_jobs active
          join public.websites active_site on active_site.id=active.website_id
          where active_site.user_id=website.user_id and active.job_type='site_generation'
            and active.generation_contract_epoch=2 and active.status='running'
            and active.lease_expires_at>clock_timestamp())<2
      ))
    order by candidate.scheduler_last_dispatched_at nulls first,candidate.created_at,candidate.id
    limit 1 for update of candidate skip locked;
    exit when found;
  end loop;
  if not found then return; end if;
  dispatch_seq:=dispatch.dispatch_sequence+1;
  update public.background_jobs set
    status='running',attempts=attempts+1,started_at=coalesce(started_at,clock_timestamp()),
    locked_at=clock_timestamp(),locked_by=p_runner_id,lease_expires_at=clock_timestamp()+interval '10 minutes',
    next_retry_at=null,error_message=null,
    claim_epoch=case when job_type='site_generation' then claim_epoch+1 else claim_epoch end,
    generation_last_dispatched_at=case when job_type='site_generation' then clock_timestamp() else generation_last_dispatched_at end,
    generation_last_scheduler_run_id=case when job_type='site_generation' then p_scheduler_run_id else generation_last_scheduler_run_id end,
    scheduler_last_dispatched_at=clock_timestamp(),scheduler_last_run_id=p_scheduler_run_id,
    scheduler_dispatch_sequence=dispatch_seq,
    finalization_attempts=case when job_type='enrichment_platform'
      and payload_json->'resume_enrichment_finalization'='true'::jsonb then finalization_attempts+1 else finalization_attempts end,
    payload_json=case when job_type='enrichment_platform'
      then payload_json-'resume_enrichment_finalization' else payload_json end
  where id=claimed.id returning * into claimed;
  update public.background_job_dispatch_state set dispatch_cursor=class_index,
    dispatch_sequence=dispatch_seq,updated_at=clock_timestamp() where singleton;
  if claimed.job_type='site_generation' then
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
    ) values (
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

-- Cancellation now has the same canonical terminal result projection as other dispositions and
-- preserves unresolved provider certainty for scheduled reconciliation/cleanup.
create or replace function public.cancel_site_generation_request(
  p_website_id uuid,p_chain_id uuid,p_request_id uuid,p_contract_epoch integer,
  p_actor text,p_reason text,p_expected_claim_epoch bigint default null
) returns boolean
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
declare terminal_text text:='Website generation was cancelled.';
declare terminal_payload jsonb;
declare terminal_result jsonb;
declare event_certainty text:='none';
begin
  if p_website_id is null or p_chain_id is null or p_request_id is null or p_contract_epoch<>2
     or p_expected_claim_epoch is null or nullif(btrim(p_actor),'') is null
     or nullif(btrim(p_reason),'') is null then
    raise exception 'Exact scoped generation cancellation identity is required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text||':site_generation',0));
  select * into job from public.background_jobs
  where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation'
    and generation_request_id=p_request_id and generation_contract_epoch=2
    and claim_epoch=p_expected_claim_epoch and status in ('pending','running','finalizing') for update;
  if not found then return false; end if;
  if exists(select 1 from public.site_generation_media_slots where job_id=job.id and version_id is null
    and (provider_reservation_id is not null or provider_operation_id is not null
      or effect_certainty in ('indeterminate','definite_success'))) then event_certainty:='indeterminate'; end if;
  update public.site_generation_media_slots set status='abandoned',abandoned_at=clock_timestamp(),
    error_message='Generation cancelled',slot_locked_by=null,slot_lease_expires_at=null
  where job_id=job.id and version_id is null and status in ('planned','failed','generating')
    and provider_reservation_id is null and provider_operation_id is null
    and effect_certainty in ('none','not_started','definite_failure');
  update public.site_generation_media_slots set status='reconciliation_required',effect_certainty='indeterminate',
    reconciliation_required_at=coalesce(reconciliation_required_at,clock_timestamp()),
    reconciliation_deadline=coalesce(reconciliation_deadline,clock_timestamp()+interval '1 hour'),
    reconciled_at=null,reconciliation_actor=null,reconciliation_reason=null,
    reconciliation_evidence=null,reconciliation_action_key=null,
    cleanup_required=true,cleanup_completed_at=null,slot_locked_by=null,slot_lease_expires_at=null,
    error_message='Cancelled generation has unresolved provider certainty'
  where job_id=job.id and version_id is null and status in ('generating','reconciliation_required')
    and (provider_reservation_id is not null or provider_operation_id is not null
      or effect_certainty in ('indeterminate','definite_success'));
  update public.site_generation_media_slots set cleanup_required=true,cleanup_completed_at=null
  where job_id=job.id and version_id is null and status='ready';
  terminal_result:=jsonb_build_object('status','cancelled','errorCode','cancelled','jobId',job.id,
    'requestId',job.generation_request_id,'claimEpoch',job.claim_epoch);
  terminal_payload:=jsonb_build_object('schemaVersion',1,'kind','site-generation-terminal','status','cancelled',
    'jobId',job.id,'requestId',job.generation_request_id,'claimEpoch',job.claim_epoch,'message',terminal_text);
  update public.messages set content=terminal_text
  where id=job.generation_handoff_message_id and trace_id=job.agent_trace_id and role='assistant';
  if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;
  update public.agent_traces set status='completed',error_message=null,completed_at=coalesce(completed_at,clock_timestamp())
  where id=job.agent_trace_id and website_id=p_website_id and status in ('running','completed');
  if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;
  update public.background_jobs set status='cancelled',status_message='Cancelled',error_message=null,
    result_json=terminal_result,completed_at=clock_timestamp(),cancelled_at=clock_timestamp(),
    cancellation_actor=left(btrim(p_actor),200),cancellation_reason=left(btrim(p_reason),1000),
    next_retry_at=null,locked_at=null,locked_by=null,lease_expires_at=null,
    generation_terminal_message_id=generation_handoff_message_id,
    generation_terminal_message_payload=terminal_payload,generation_terminal_message_at=clock_timestamp()
  where id=job.id;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
  ) values (
    job.id::text||':'||job.claim_epoch::text||':cancelled',job.id,job.website_id,job.generation_request_id,
    2,job.claim_epoch,job.generation_stage,job.stage_attempts,'cancelled','user_or_system_cancellation',
    event_certainty,'cancel','info',event_certainty='indeterminate',job.locked_by,clock_timestamp(),
    jsonb_build_object('actor',left(btrim(p_actor),200),'reason',left(btrim(p_reason),1000))
  );
  return true;
end;
$$;

create or replace function public.cancel_site_generation_request(
  p_website_id uuid,p_chain_id uuid,p_request_id uuid,p_claim_epoch bigint
) returns boolean
language sql security definer set search_path=public as $$
  select public.cancel_site_generation_request(
    p_website_id,p_chain_id,p_request_id,2,'user','requested',p_claim_epoch
  );
$$;
revoke all on function public.cancel_site_generation_request(uuid,uuid,uuid,integer,text,text,bigint)
  from public,anon,authenticated;
revoke all on function public.cancel_site_generation_request(uuid,uuid,uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.cancel_site_generation_request(uuid,uuid,uuid,integer,text,text,bigint) to service_role;
grant execute on function public.cancel_site_generation_request(uuid,uuid,uuid,bigint) to service_role;

update public.background_jobs set result_json=jsonb_build_object(
  'status','cancelled','errorCode','cancelled','jobId',id,'requestId',generation_request_id,'claimEpoch',claim_epoch
) where job_type='site_generation' and generation_contract_epoch=2 and status='cancelled' and result_json is null;
alter table public.background_jobs
  drop constraint if exists background_jobs_cancelled_generation_projection_check,
  add constraint background_jobs_cancelled_generation_projection_check check (
    not (job_type='site_generation' and generation_contract_epoch=2 and status='cancelled')
    or (result_json->>'status'='cancelled' and result_json->>'jobId'=id::text
      and result_json->>'requestId'=generation_request_id::text
      and (result_json->>'claimEpoch')::bigint=claim_epoch
      and generation_terminal_message_payload->>'status'='cancelled')
  ) not valid;
alter table public.background_jobs validate constraint background_jobs_cancelled_generation_projection_check;

-- Retire unlinked administrative supersession. The renamed helper is private; the only service
-- operation supersedes and enqueues the exact successor in one transaction, then links both rows.
alter function public.supersede_site_generation_epoch(uuid,uuid,uuid,bigint,text,text)
  rename to supersede_site_generation_epoch_internal;
revoke all on function public.supersede_site_generation_epoch_internal(uuid,uuid,uuid,bigint,text,text)
  from public,anon,authenticated,service_role;

create or replace function public.supersede_and_enqueue_site_generation_job_owned(
  p_website_id uuid,p_predecessor_job_id uuid,p_predecessor_request_id uuid,
  p_predecessor_claim_epoch bigint,p_successor_idempotency_key text,p_successor_payload_json jsonb,
  p_successor_trace_id uuid,p_successor_owner_token uuid,p_actor text,p_reason text
) returns table(chain_id uuid,assistant_message_id uuid,successor_job_id uuid)
language plpgsql security definer set search_path=public as $$
declare accepted record;
declare successor public.background_jobs%rowtype;
begin
  if not public.supersede_site_generation_epoch_internal(
    p_website_id,p_predecessor_job_id,p_predecessor_request_id,p_predecessor_claim_epoch,p_actor,p_reason
  ) then raise exception 'Generation predecessor could not be superseded' using errcode='40001'; end if;
  select * into strict accepted from public.enqueue_site_generation_job_owned(
    p_website_id,p_successor_idempotency_key,p_successor_payload_json,
    p_successor_trace_id,p_successor_owner_token,false
  );
  select * into strict successor from public.background_jobs
  where website_id=p_website_id and chain_id=accepted.chain_id and job_type='site_generation'
  for update;
  if successor.generation_request_id::text is distinct from p_successor_idempotency_key
     or successor.id=p_predecessor_job_id then
    raise exception 'Generation successor identity is invalid' using errcode='P0001';
  end if;
  update public.background_jobs set superseded_by_job_id=successor.id,supersession_link_state='linked',
    result_json=coalesce(result_json,'{}'::jsonb)||jsonb_build_object('successorJobId',successor.id,'successorRequestId',successor.generation_request_id),
    generation_terminal_message_payload=coalesce(generation_terminal_message_payload,'{}'::jsonb)
      ||jsonb_build_object('successorJobId',successor.id,'successorRequestId',successor.generation_request_id)
  where id=p_predecessor_job_id;
  update public.background_jobs set supersedes_job_id=p_predecessor_job_id,supersession_link_state='linked'
  where id=successor.id;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details
  ) select p_predecessor_job_id::text||':'||p_predecessor_claim_epoch::text||':successor-linked',
    predecessor.id,predecessor.website_id,predecessor.generation_request_id,2,predecessor.claim_epoch,
    predecessor.generation_stage,predecessor.stage_attempts,'superseded','administrative_successor_linked',
    'none','supersede','info',false,p_actor,clock_timestamp(),
    jsonb_build_object('successorJobId',successor.id,'successorRequestId',successor.generation_request_id)
  from public.background_jobs predecessor where predecessor.id=p_predecessor_job_id;
  return query select accepted.chain_id,accepted.assistant_message_id,successor.id;
end;
$$;
revoke all on function public.supersede_and_enqueue_site_generation_job_owned(uuid,uuid,uuid,bigint,text,jsonb,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.supersede_and_enqueue_site_generation_job_owned(uuid,uuid,uuid,bigint,text,jsonb,uuid,uuid,text,text)
  to service_role;

-- Canonical scheduled owners. These run bounded SQL-only convergence and retention work.
do $bucket1_schedules$
declare job_id bigint;
begin
  for job_id in select jobid from cron.job
    where jobname in ('obra-reconcile-generation-media','obra-archive-generation-events')
  loop perform cron.unschedule(job_id); end loop;
  perform cron.schedule('obra-reconcile-generation-media','* * * * *',
    $cron$select * from public.reconcile_due_generation_media(100,'cron:obra-reconcile-generation-media');$cron$);
  perform cron.schedule('obra-archive-generation-events','23 3 * * *',
    $cron$select * from public.archive_site_generation_attempt_events(1000);$cron$);
end
$bucket1_schedules$;

comment on function public.claim_next_background_job(text,timestamptz,integer,uuid) is
  'Sole background claim: all-class stale recovery plus non-starving four-class round robin with generation global/tenant caps.';
comment on function public.reconcile_due_generation_media(integer,text) is
  'Bounded scheduled convergence for overdue indeterminate provider effects; never invents provider failure.';
comment on function public.archive_site_generation_attempt_events(integer,timestamptz,timestamptz) is
  'Moves terminal generation diagnostics to a foreign-key-free immutable archive after 90 days and purges after 365 days.';
