-- Bucket 1 SQL durability slice: one server-owned Unified generation contract.
create extension if not exists pgcrypto with schema extensions;
-- This is a forward compatibility migration. Historical rows and readers stay intact;
-- only new contract-epoch-2 generation rows use the authoritative columns below.

-- -----------------------------------------------------------------------------
-- Authoritative request, ownership, cursor, cancellation, and result identity
-- -----------------------------------------------------------------------------

-- The add-video foundation made these three columns exclusive to add_video. Relax that
-- historical constraint before reusing the already-typed request/source columns.
alter table public.background_jobs
  drop constraint if exists background_jobs_add_video_identity_check;

alter table public.background_jobs
  add column if not exists generation_request_id uuid,
  add column if not exists generation_request_hash text,
  add column if not exists generation_kind text,
  add column if not exists source_revision bigint,
  add column if not exists generation_contract_epoch integer not null default 1,
  add column if not exists generation_contract_version integer,
  add column if not exists generation_stage text,
  add column if not exists generation_input_version integer,
  add column if not exists generation_input_snapshot jsonb,
  add column if not exists generation_input_hash text,
  add column if not exists generation_accepted_at timestamptz,
  add column if not exists generation_checkpoint jsonb,
  add column if not exists claim_epoch bigint not null default 0,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists interruption_count integer not null default 0,
  add column if not exists stage_attempts integer not null default 0,
  add column if not exists repair_attempts integer not null default 0,
  add column if not exists cancellation_actor text,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists generation_handoff_message_id uuid references public.messages(id) on delete set null,
  add column if not exists generation_terminal_message_at timestamptz,
  add column if not exists generation_terminal_message_id uuid references public.messages(id) on delete restrict,
  add column if not exists generation_terminal_message_payload jsonb,
  add column if not exists generation_result_version_id uuid;

alter table public.background_jobs
  drop constraint if exists background_jobs_generation_contract_epoch_check,
  drop constraint if exists background_jobs_generation_contract_version_check,
  drop constraint if exists background_jobs_generation_kind_check,
  drop constraint if exists background_jobs_generation_stage_check,
  drop constraint if exists background_jobs_generation_input_version_check,
  drop constraint if exists background_jobs_generation_input_snapshot_check,
  drop constraint if exists background_jobs_generation_checkpoint_check,
  drop constraint if exists background_jobs_claim_epoch_check,
  drop constraint if exists background_jobs_interruption_count_check,
  drop constraint if exists background_jobs_stage_attempts_check,
  drop constraint if exists background_jobs_repair_attempts_check,
  drop constraint if exists background_jobs_generation_identity_check,
  drop constraint if exists background_jobs_generation_result_version_fkey,
  add constraint background_jobs_generation_contract_epoch_check
    check (generation_contract_epoch in (1,2)),
  add constraint background_jobs_generation_contract_version_check
    check (generation_contract_version is null or generation_contract_version >= 1),
  add constraint background_jobs_generation_kind_check
    check (generation_kind is null or generation_kind in ('initial','regeneration')),
  add constraint background_jobs_generation_stage_check
    check (generation_stage is null or generation_stage in ('context','planning','media','composition','validation','persistence')),
  add constraint background_jobs_generation_input_version_check
    check (generation_input_version is null or generation_input_version = 1),
  add constraint background_jobs_generation_input_snapshot_check check (
    generation_input_snapshot is null
    or (jsonb_typeof(generation_input_snapshot) = 'object'
      and octet_length(generation_input_snapshot::text) <= 524288)
  ),
  add constraint background_jobs_generation_checkpoint_check
    check (generation_checkpoint is null or (
      jsonb_typeof(generation_checkpoint) = 'object'
      and octet_length(convert_to(generation_checkpoint::text,'UTF8')) <= 2097152
    )),
  add constraint background_jobs_claim_epoch_check check (claim_epoch >= 0),
  add constraint background_jobs_interruption_count_check check (interruption_count >= 0),
  add constraint background_jobs_stage_attempts_check check (stage_attempts >= 0),
  add constraint background_jobs_repair_attempts_check check (repair_attempts >= 0),
  add constraint background_jobs_generation_result_version_fkey
    foreign key (generation_result_version_id, website_id)
    references public.website_versions(id, website_id) on delete restrict,
  add constraint background_jobs_generation_identity_check check (
    job_type <> 'site_generation'
    or generation_contract_epoch < 2
    or (
      generation_request_id is not null
      and request_id is not null
      and request_id = generation_request_id
      and nullif(btrim(generation_request_hash), '') is not null
      and generation_kind in ('initial','regeneration')
      and generation_contract_version = 2
      and generation_stage in ('context','planning','media','composition','validation','persistence')
      and generation_input_version = 1
      and generation_input_snapshot is not null
      and jsonb_typeof(generation_input_snapshot) = 'object'
      and octet_length(generation_input_snapshot::text) <= 524288
      and generation_input_hash ~ '^[0-9a-f]{64}$'
      and generation_input_hash = encode(extensions.digest(convert_to(generation_input_snapshot::text, 'UTF8'), 'sha256'), 'hex')
      and generation_accepted_at is not null
      and generation_checkpoint is not null
      and jsonb_typeof(generation_checkpoint) = 'object'
      and (
        (generation_kind = 'initial' and source_version_id is null and source_revision is null)
        or
        (generation_kind = 'regeneration' and source_version_id is not null and source_revision is not null and source_revision >= 0)
      )
    )
  ) not valid;

-- Existing add-video invariants remain exact after relaxing the old exclusive check.
alter table public.background_jobs
  add constraint background_jobs_add_video_identity_check check (
    (job_type = 'add_video'
      and request_id is not null and source_version_id is not null and target_version_id is not null)
    or
    (job_type = 'site_generation'
      and target_version_id is null
      and (
        generation_contract_epoch < 2
        or (request_id is not null and request_id = generation_request_id)
      ))
    or
    (job_type not in ('add_video','site_generation')
      and request_id is null and source_version_id is null and target_version_id is null)
  ) not valid;

alter table public.background_jobs
  validate constraint background_jobs_add_video_identity_check;

-- Exact historical request/source values become typed authority without rewriting payloads.
-- Rows that cannot be proved remain epoch 1 and continue through historical readers only.
update public.background_jobs job
set generation_request_id = coalesce(
      job.generation_request_id,
      job.request_id,
      case when job.idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then job.idempotency_key::uuid else null end,
      trace.request_id
    ),
    request_id = coalesce(
      job.request_id,
      job.generation_request_id,
      case when job.idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then job.idempotency_key::uuid else null end,
      trace.request_id
    ),
    generation_request_hash = coalesce(job.generation_request_hash, trace.request_payload_hash),
    generation_kind = coalesce(job.generation_kind, job.payload_json->>'generationKind'),
    source_version_id = coalesce(
      job.source_version_id,
      case when job.payload_json->>'sourceVersionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (job.payload_json->>'sourceVersionId')::uuid else null end
    ),
    source_revision = coalesce(
      job.source_revision,
      case when job.payload_json->>'sourceRevision' ~ '^\d+$'
        then (job.payload_json->>'sourceRevision')::bigint else null end
    ),
    generation_contract_version = coalesce(
      job.generation_contract_version,
      case when job.payload_json->>'generationContractVersion' ~ '^\d+$'
        then (job.payload_json->>'generationContractVersion')::integer else null end
    ),
    generation_stage = coalesce(
      job.generation_stage,
      case when job.payload_json->>'generationStage' in ('context','planning','media','composition','validation','persistence')
        then job.payload_json->>'generationStage'
        when job.payload_json ? 'unifiedBrief' then 'media'
        else 'planning' end
    ),
    generation_checkpoint = coalesce(
      job.generation_checkpoint,
      jsonb_build_object(
        'schemaVersion', 1,
        'stage', case when job.payload_json->>'generationStage' in ('context','planning','media','composition','validation','persistence')
          then job.payload_json->>'generationStage'
          when job.payload_json ? 'unifiedBrief' then 'media'
          else 'planning' end,
        'payload', job.payload_json - array[
          'executionMode','_agentRequestId','_agentHandoffMessageId','_agentTerminalMessageFinalizedAt'
        ]
      )
    ),
    generation_handoff_message_id = coalesce(
      job.generation_handoff_message_id,
      case when job.payload_json->>'_agentHandoffMessageId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (job.payload_json->>'_agentHandoffMessageId')::uuid else null end
    ),
    generation_terminal_message_at = coalesce(
      job.generation_terminal_message_at,
      case when job.payload_json ? '_agentTerminalMessageFinalizedAt'
        then nullif(job.payload_json->>'_agentTerminalMessageFinalizedAt','')::timestamptz else null end
    )
from public.agent_traces trace
where job.job_type = 'site_generation'
  and trace.id = job.agent_trace_id;

update public.background_jobs job
set generation_request_id = coalesce(
      job.generation_request_id,
      job.request_id,
      case when job.idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then job.idempotency_key::uuid else null end
    ),
    request_id = coalesce(
      job.request_id,
      job.generation_request_id,
      case when job.idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then job.idempotency_key::uuid else null end
    ),
    generation_kind = coalesce(job.generation_kind, job.payload_json->>'generationKind'),
    source_version_id = coalesce(
      job.source_version_id,
      case when job.payload_json->>'sourceVersionId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (job.payload_json->>'sourceVersionId')::uuid else null end
    ),
    source_revision = coalesce(
      job.source_revision,
      case when job.payload_json->>'sourceRevision' ~ '^\d+$'
        then (job.payload_json->>'sourceRevision')::bigint else null end
    ),
    generation_contract_version = coalesce(
      job.generation_contract_version,
      case when job.payload_json->>'generationContractVersion' ~ '^\d+$'
        then (job.payload_json->>'generationContractVersion')::integer else null end
    ),
    generation_stage = coalesce(
      job.generation_stage,
      case when job.payload_json->>'generationStage' in ('context','planning','media','composition','validation','persistence')
        then job.payload_json->>'generationStage'
        when job.payload_json ? 'unifiedBrief' then 'media'
        else 'planning' end
    ),
    generation_checkpoint = coalesce(
      job.generation_checkpoint,
      jsonb_build_object(
        'schemaVersion', 1,
        'stage', case when job.payload_json->>'generationStage' in ('context','planning','media','composition','validation','persistence')
          then job.payload_json->>'generationStage'
          when job.payload_json ? 'unifiedBrief' then 'media'
          else 'planning' end,
        'payload', job.payload_json - array[
          'executionMode','_agentRequestId','_agentHandoffMessageId','_agentTerminalMessageFinalizedAt'
        ]
      )
    ),
    generation_handoff_message_id = coalesce(
      job.generation_handoff_message_id,
      case when job.payload_json->>'_agentHandoffMessageId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then (job.payload_json->>'_agentHandoffMessageId')::uuid else null end
    ),
    generation_terminal_message_at = coalesce(
      job.generation_terminal_message_at,
      case when job.payload_json ? '_agentTerminalMessageFinalizedAt'
        then nullif(job.payload_json->>'_agentTerminalMessageFinalizedAt','')::timestamptz else null end
    )
where job.job_type = 'site_generation';

-- Existing running claims predate the epoch column. Their attempts value is the only exact
-- fence available, so seed claim_epoch from it before any server-owned recovery can occur.
update public.background_jobs
set claim_epoch = greatest(claim_epoch, attempts)
where job_type = 'site_generation';

-- Historical rows cannot acquire an acceptance-time snapshot after the fact. They stay
-- on epoch 1; only the enqueue transaction below may create an epoch-2 owner.
alter table public.background_jobs
  validate constraint background_jobs_generation_identity_check;

-- Epoch-1 rows keep their historical payload/read path. New epoch-2 admission is blocked by
-- the same active-site index until an old in-flight request settles; no migration writer
-- terminalizes or rewrites active historical work.
create unique index if not exists background_jobs_one_active_site_generation_uk
  on public.background_jobs(website_id)
  where job_type = 'site_generation' and status in ('pending','running','finalizing');

create unique index if not exists background_jobs_generation_request_uk
  on public.background_jobs(website_id, generation_request_id)
  where job_type = 'site_generation' and generation_request_id is not null;

-- The stable generation_job_id makes finalization replayable after commit/response loss.
alter table public.website_versions
  add column if not exists generation_job_id uuid;

alter table public.website_versions
  drop constraint if exists website_versions_generation_job_id_fkey,
  add constraint website_versions_generation_job_id_fkey
    foreign key (generation_job_id) references public.background_jobs(id) on delete set null;

create unique index if not exists website_versions_generation_job_id_uk
  on public.website_versions(generation_job_id)
  where generation_job_id is not null;

-- Epoch-2 acceptance identity and input are write-once. Later stage/checkpoint RPCs may
-- advance execution state but can never replace what the enqueue transaction observed.
create or replace function public.guard_site_generation_frozen_input()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.job_type = 'site_generation' and old.generation_contract_epoch >= 2
     and (
       new.website_id is distinct from old.website_id
       or new.chain_id is distinct from old.chain_id
       or new.request_id is distinct from old.request_id
       or new.generation_request_id is distinct from old.generation_request_id
       or new.generation_request_hash is distinct from old.generation_request_hash
       or new.generation_kind is distinct from old.generation_kind
       or new.source_version_id is distinct from old.source_version_id
       or new.source_revision is distinct from old.source_revision
       or new.generation_contract_epoch is distinct from old.generation_contract_epoch
       or new.generation_contract_version is distinct from old.generation_contract_version
       or new.generation_input_version is distinct from old.generation_input_version
       or new.generation_input_snapshot is distinct from old.generation_input_snapshot
       or new.generation_input_hash is distinct from old.generation_input_hash
       or new.generation_accepted_at is distinct from old.generation_accepted_at
       or new.agent_trace_id is distinct from old.agent_trace_id
       or (old.generation_handoff_message_id is not null
         and new.generation_handoff_message_id is distinct from old.generation_handoff_message_id)
     ) then
    raise exception 'Accepted generation input and identity are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_site_generation_frozen_input()
  from public, anon, authenticated;

drop trigger if exists guard_site_generation_frozen_input on public.background_jobs;
create trigger guard_site_generation_frozen_input
before update on public.background_jobs
for each row execute function public.guard_site_generation_frozen_input();

-- -----------------------------------------------------------------------------
-- Append-only attributable attempt history
-- -----------------------------------------------------------------------------

create table if not exists public.site_generation_attempt_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  job_id uuid not null references public.background_jobs(id) on delete cascade,
  website_id uuid not null references public.websites(id) on delete cascade,
  request_id uuid not null,
  contract_epoch integer not null check (contract_epoch >= 2),
  claim_epoch bigint not null check (claim_epoch >= 0),
  stage text not null check (stage in ('context','planning','media','composition','validation','persistence')),
  unit_id text,
  stage_attempt integer not null default 0 check (stage_attempt >= 0),
  event_type text not null check (event_type in (
    'claimed','yielded','retry_scheduled','interrupted','cancelled','failed','completed','replayed'
  )),
  cause_code text,
  effect_certainty text not null default 'none' check (effect_certainty in (
    'none','not_started','definite_failure','definite_success','indeterminate'
  )),
  disposition text not null check (disposition in (
    'continue','retry','resume','cancel','terminal_failure','terminal_success','replay'
  )),
  severity text not null default 'info' check (severity in ('info','warning','error')),
  blocking boolean not null default false,
  budget_type text check (budget_type is null or budget_type in (
    'interruption','stage_attempt','provider_create','writer_repair'
  )),
  budget_before integer,
  budget_after integer,
  runner_id text,
  invocation_id uuid,
  deployment_id text,
  input_checkpoint_hash text,
  output_checkpoint_hash text,
  started_at timestamptz,
  completed_at timestamptz,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  check (
    (budget_type is null and budget_before is null and budget_after is null)
    or
    (budget_type is not null and budget_before is not null and budget_after is not null
      and budget_before >= 0 and budget_after >= 0)
  )
);

create index if not exists site_generation_attempt_events_job_created_idx
  on public.site_generation_attempt_events(job_id, created_at, id);
create index if not exists site_generation_attempt_events_request_created_idx
  on public.site_generation_attempt_events(website_id, request_id, created_at, id);

alter table public.site_generation_attempt_events enable row level security;
revoke all on table public.site_generation_attempt_events from public, anon, authenticated;
revoke update, delete, truncate on table public.site_generation_attempt_events from service_role;
grant select, insert on table public.site_generation_attempt_events to service_role;
grant usage, select on sequence public.site_generation_attempt_events_id_seq to service_role;

-- -----------------------------------------------------------------------------
-- Unified contract-v2 admission and trace-owned attribution
-- -----------------------------------------------------------------------------

create or replace function public.enqueue_site_generation_job(
  p_website_id uuid,
  p_idempotency_key text,
  p_payload_json jsonb,
  p_replay_completed boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  existing_job public.background_jobs%rowtype;
  trace public.agent_traces%rowtype;
  new_chain uuid := gen_random_uuid();
  new_job_id uuid;
  requested_id uuid;
  requested_hash text;
  requested_kind text;
  requested_source_id uuid;
  requested_source_revision bigint;
  checkpoint jsonb;
  onboarding_input jsonb;
  enrichment_input jsonb;
  source_config_input jsonb;
  source_media_input jsonb := '[]'::jsonb;
  recent_versions_input jsonb := '[]'::jsonb;
  cross_site_identities_input jsonb := '[]'::jsonb;
  frozen_input jsonb;
  frozen_input_hash text;
  accepted_at timestamptz := clock_timestamp();
begin
  if p_website_id is null or nullif(btrim(p_idempotency_key), '') is null
     or jsonb_typeof(p_payload_json) is distinct from 'object'
     or p_payload_json->>'generationMode' <> 'unified'
     or p_payload_json->>'generationStage' <> 'context'
     or jsonb_typeof(p_payload_json->'generationContractVersion') is distinct from 'number'
     or p_payload_json->>'generationContractVersion' <> '2'
     or p_payload_json ? 'executionMode'
     or p_payload_json ? '_agentRequestId'
     or p_payload_json ? '_agentHandoffMessageId'
     or p_payload_json ? '_agentTerminalMessageFinalizedAt'
     or p_payload_json->>'generationKind' not in ('initial','regeneration')
     or (p_payload_json - array[
       'generationKind','generationMode','generationStage','generationContractVersion',
       'sourceVersionId','sourceRevision'
     ]) <> '{}'::jsonb then
    raise exception 'Site generation payload is malformed' using errcode = '22023';
  end if;

  begin
    requested_id := p_idempotency_key::uuid;
  exception when invalid_text_representation then
    raise exception 'Site generation request identity must be a UUID' using errcode = '22023';
  end;

  requested_kind := p_payload_json->>'generationKind';
  if requested_kind = 'regeneration' then
    if jsonb_typeof(p_payload_json->'sourceVersionId') is distinct from 'string'
       or jsonb_typeof(p_payload_json->'sourceRevision') is distinct from 'number'
       or p_payload_json->>'sourceRevision' !~ '^\d+$' then
      raise exception 'Regeneration source snapshot is malformed' using errcode = '22023';
    end if;
    begin
      requested_source_id := (p_payload_json->>'sourceVersionId')::uuid;
      requested_source_revision := (p_payload_json->>'sourceRevision')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Regeneration source snapshot is malformed' using errcode = '22023';
    end;
  elsif p_payload_json ? 'sourceVersionId' or p_payload_json ? 'sourceRevision' then
    raise exception 'Initial generation cannot include a source snapshot' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation', 0));

  -- Exact replay consults only the immutable accepted row. It must not depend on a
  -- mutable/replaced trace, website profile, source row, or prior-version sample.
  select * into existing_job
  from public.background_jobs
  where website_id = p_website_id
    and job_type = 'site_generation'
    and generation_request_id = requested_id
  order by created_at desc, id desc
  limit 1;
  if found then
    if existing_job.generation_kind is distinct from requested_kind
       or existing_job.source_version_id is distinct from requested_source_id
       or existing_job.source_revision is distinct from requested_source_revision
       or existing_job.generation_contract_epoch <> 2
       or existing_job.generation_contract_version <> 2
       or existing_job.generation_input_version <> 1
       or existing_job.generation_input_snapshot is null
       or existing_job.generation_input_hash !~ '^[0-9a-f]{64}$'
       or existing_job.generation_input_hash is distinct from encode(
         extensions.digest(convert_to(existing_job.generation_input_snapshot::text, 'UTF8'), 'sha256'), 'hex'
       ) then
      raise exception 'Request identity was already used for a different generation request'
        using errcode = '23505';
    end if;
    if existing_job.status in ('pending','running','finalizing')
       or p_replay_completed then
      return existing_job.chain_id;
    end if;
    raise exception 'Terminal generation replay was not requested' using errcode = 'P0001';
  end if;

  select * into trace
  from public.agent_traces
  where website_id = p_website_id and request_id = requested_id
  order by started_at desc nulls last, id desc
  limit 1;
  if not found or trace.request_payload_hash is null or trace.trigger_message is null then
    raise exception 'Site generation requires an attributable trace with an exact raw instruction'
      using errcode = 'P0001';
  end if;
  requested_hash := trace.request_payload_hash;

  if trace.source_version_id is distinct from requested_source_id
     or trace.source_revision is distinct from requested_source_revision then
    raise exception 'Site generation source snapshot does not match agent turn' using errcode = 'P0001';
  end if;

  select coalesce(website.onboarding_state, '{}'::jsonb)
  into onboarding_input
  from public.websites website
  where website.id = p_website_id
  for share;
  if not found then
    raise exception 'Website not found' using errcode = 'P0001';
  end if;

  select coalesce(profile.enrichment_json, '{}'::jsonb)
  into enrichment_input
  from public.contractor_profiles profile
  where profile.website_id = p_website_id
  for share;
  enrichment_input := coalesce(enrichment_input, '{}'::jsonb);

  if requested_kind = 'initial' then
    if exists (select 1 from public.website_versions where website_id = p_website_id) then
      raise exception 'Regeneration requires a scoped source version and revision snapshot' using errcode = 'P0001';
    end if;
    source_config_input := null;
  else
    select version.config_json
    into source_config_input
    from public.website_versions version
    where version.id = requested_source_id and version.website_id = p_website_id
      and version.revision = requested_source_revision
    for share;
    if not found then
      raise exception 'Regeneration source snapshot does not match' using errcode = 'P0001';
    end if;

    -- Lock the exact source slot set before copying it so config/revision and media are
    -- frozen as one protected acceptance-time source snapshot.
    perform 1
    from public.website_version_media_slots slot
    where slot.website_id = p_website_id and slot.version_id = requested_source_id
    order by slot.id
    for share;

    select coalesce(jsonb_agg(jsonb_build_object(
      'slotId', slot.slot_id, 'assetId', slot.asset_id, 'mimeType', slot.mime_type,
      'role', slot.role, 'origin', slot.provenance, 'required', slot.required,
      'proofEligible', slot.proof_eligible, 'storagePath', slot.storage_path,
      'sourceSlotId', slot.source_slot_id, 'posterSlotId', slot.poster_slot_id
    ) order by slot.slot_id), '[]'::jsonb)
    into source_media_input
    from public.website_version_media_slots slot
    where slot.website_id = p_website_id and slot.version_id = requested_source_id;
  end if;

  select coalesce(jsonb_agg(summary.item order by summary.version_number desc), '[]'::jsonb)
  into recent_versions_input
  from (
    select version.version_number, jsonb_build_object(
      'versionId', version.id, 'versionNumber', version.version_number,
      'revision', version.revision, 'variantKey', version.variant_key,
      'generator', version.config_json->'generator',
      'generatorSchemaVersion', version.config_json->'generatorSchemaVersion',
      'recipeId', version.config_json->'recipeId',
      'recipeVersion', version.config_json->'recipeVersion',
      'designIntent', version.config_json#>'{designSpec,designIntent}',
      'layoutFingerprint', coalesce(
        version.config_json->'layoutFingerprint',
        version.config_json#>'{unifiedBrief,layoutFingerprint}'
      ),
      'priorSummary', left(coalesce(
        version.config_json->>'priorVariantSummary',
        version.config_json#>>'{unifiedBrief,creativeBrief,summary}',
        ''
      ), 4000),
      'configHash', encode(
        extensions.digest(convert_to(version.config_json::text, 'UTF8'), 'sha256'), 'hex'
      ),
      'summaryInputs', jsonb_build_object(
        'layoutHint', version.config_json->'layoutHint',
        'heroLayout', version.config_json->'heroLayout',
        'componentIds', version.config_json->'component_ids',
        'sections', version.config_json->'sections',
        'designSpec', version.config_json->'designSpec',
        'unifiedBrief', version.config_json->'unifiedBrief'
      )
    ) as item
    from public.website_versions version
    where version.website_id = p_website_id
    order by version.version_number desc
    limit 4
  ) summary;

  select coalesce(jsonb_agg(sample.item order by sample.updated_at desc, sample.website_id), '[]'::jsonb)
  into cross_site_identities_input
  from (
    select sampled_website.id as website_id, sampled_website.updated_at,
      jsonb_build_object(
        'websiteId', sampled_website.id,
        'versionId', version.id,
        'versionNumber', version.version_number,
        'layoutFingerprint', version.config_json->'layoutFingerprint'
      ) as item
    from public.websites sampled_website
    join public.website_versions version
      on version.id = sampled_website.active_version_id
     and version.website_id = sampled_website.id
     and version.status = 'live'
    where sampled_website.id <> p_website_id
      and sampled_website.status = 'live'
      and sampled_website.active_version_id is not null
    order by sampled_website.updated_at desc, sampled_website.id
    limit 12
  ) sample;

  if octet_length(convert_to(coalesce(trace.trigger_message, ''), 'UTF8')) > 16384 then
    raise exception 'Generation instruction exceeds the 16 KiB contract limit' using errcode = '54000';
  end if;

  frozen_input := jsonb_build_object(
    'schemaVersion', 1,
    'normalizerVersion', 'bucket1-context-v1',
    'generationKind', requested_kind,
    'sourceVersionId', requested_source_id,
    'sourceRevision', requested_source_revision,
    'sourceConfig', source_config_input,
    'sourceMedia', source_media_input,
    'onboarding', onboarding_input,
    'enrichment', enrichment_input,
    'contactPolicy', jsonb_build_object(
      'schemaVersion', 1,
      'source', 'websites.onboarding_state.contactHidden',
      'sourcePresent', onboarding_input ? 'contactHidden',
      'sourceValue', onboarding_input->'contactHidden',
      'contactHidden', onboarding_input->'contactHidden' = 'true'::jsonb,
      'privacyClassification', 'generation-private',
      'privacySource', 'server-generation-storage-policy-v1',
      'capturedAtAcceptance', true
    ),
    'instruction', coalesce(trace.trigger_message, ''),
    'instructionByteLength', octet_length(convert_to(coalesce(trace.trigger_message, ''), 'UTF8')),
    'requestPayloadHash', requested_hash,
    'priorIdentities', recent_versions_input,
    'crossSiteLayoutIdentities', cross_site_identities_input
  );
  if octet_length(convert_to(frozen_input::text, 'UTF8')) > 524288 then
    raise exception 'Frozen generation context exceeds the 512 KiB contract limit' using errcode = '54000';
  end if;
  frozen_input_hash := encode(extensions.digest(convert_to(frozen_input::text, 'UTF8'), 'sha256'), 'hex');

  if trace.status <> 'running' then
    raise exception 'Agent turn is not active for a new generation request' using errcode = '40001';
  end if;

  if exists (
    select 1 from public.background_jobs
    where website_id = p_website_id and job_type = 'site_generation'
      and status in ('pending','running','finalizing')
  ) then
    raise exception 'A site generation job is already active for this website'
      using errcode = '55000';
  end if;

  checkpoint := jsonb_build_object(
    'schemaVersion',2,
    'stage','context',
    'acceptedAt',accepted_at,
    'inputHash',frozen_input_hash,
    'inputSizeBytes',octet_length(convert_to(frozen_input::text, 'UTF8')),
    'input',frozen_input
  );

  insert into public.background_jobs(
    website_id, chain_id, job_type, sequence_index, platform, status,
    progress_pct, status_message, payload_json, idempotency_key,
    request_id, generation_request_id, generation_request_hash,
    generation_kind, source_version_id, source_revision,
    generation_contract_epoch, generation_contract_version,
    generation_stage, generation_input_version, generation_input_snapshot,
    generation_input_hash, generation_accepted_at, generation_checkpoint, agent_trace_id,
    claim_epoch, lease_expires_at
  ) values (
    p_website_id, new_chain, 'site_generation', 0, null, 'pending',
    0, 'Queued site generation…', p_payload_json, p_idempotency_key,
    requested_id, requested_id, requested_hash,
    requested_kind, requested_source_id, requested_source_revision,
    2, 2, 'context', 1, frozen_input,
    frozen_input_hash, accepted_at, checkpoint, trace.id,
    0, null
  ) returning id into new_job_id;

  return new_chain;
end;
$$;

-- The base signature remains for wrapper compatibility but is not directly executable;
-- all new admission must prove trace ownership through the wrapper below.
revoke all on function public.enqueue_site_generation_job(uuid,text,jsonb,boolean)
  from public, anon, authenticated, service_role;

-- Preserve the exact app-callable signature while moving request/message identity out of
-- payload_json. The trace owner fence is checked before enqueue or replay is returned.
create or replace function public.enqueue_site_generation_job_owned(
  p_website_id uuid,
  p_idempotency_key text,
  p_payload_json jsonb,
  p_trace_id uuid,
  p_owner_token uuid,
  p_replay_completed boolean default false
) returns table(chain_id uuid, assistant_message_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  returned_chain_id uuid;
  owned_trace public.agent_traces%rowtype;
  generation_job public.background_jobs%rowtype;
  handoff_message_id uuid;
begin
  if p_trace_id is null or p_owner_token is null then
    raise exception 'Site generation trace ownership is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':agent_turn', 0));
  select * into owned_trace
  from public.agent_traces
  where id = p_trace_id and website_id = p_website_id
    and owner_token = p_owner_token
  for update;
  if not found then
    raise exception 'Agent turn ownership lost' using errcode = '40001';
  end if;
  if owned_trace.request_id is null
     or owned_trace.request_id::text is distinct from p_idempotency_key
     or owned_trace.request_payload_hash is null then
    raise exception 'Site generation request identity does not match agent turn'
      using errcode = 'P0001';
  end if;

  -- Replay is authorized by the immutable trace/request binding copied onto the accepted
  -- job. Do not reread a mutable trace or any other acceptance source after commit.
  select * into generation_job
  from public.background_jobs
  where website_id = p_website_id
    and job_type = 'site_generation'
    and generation_request_id::text = p_idempotency_key
  order by created_at desc, id desc
  limit 1;
  if found then
    if generation_job.agent_trace_id is distinct from p_trace_id
       or generation_job.generation_request_hash is distinct from owned_trace.request_payload_hash then
      raise exception 'Site generation chain is already bound to another agent trace or instruction'
        using errcode = 'P0001';
    end if;
    returned_chain_id := public.enqueue_site_generation_job(
      p_website_id, p_idempotency_key, p_payload_json, p_replay_completed
    );
    handoff_message_id := generation_job.generation_handoff_message_id;
    if handoff_message_id is null then
      raise exception 'Accepted generation handoff identity is missing' using errcode = 'P0001';
    end if;
    return query select returned_chain_id, handoff_message_id;
    return;
  end if;

  returned_chain_id := public.enqueue_site_generation_job(
    p_website_id, p_idempotency_key, p_payload_json, p_replay_completed
  );

  select * into strict generation_job
  from public.background_jobs
  where website_id = p_website_id and chain_id = returned_chain_id
    and job_type = 'site_generation' and sequence_index = 0
  for update;

  if generation_job.agent_trace_id is distinct from p_trace_id then
    raise exception 'Site generation chain is already bound to another agent trace'
      using errcode = 'P0001';
  end if;

  handoff_message_id := generation_job.generation_handoff_message_id;
  if handoff_message_id is null then
    insert into public.messages(conversation_id, role, content, trace_id)
    values (owned_trace.conversation_id, 'assistant', 'Building your website…', p_trace_id)
    returning id into handoff_message_id;

    update public.background_jobs
    set generation_handoff_message_id = handoff_message_id
    where id = generation_job.id and generation_handoff_message_id is null;
  elsif not exists (
    select 1 from public.messages
    where id = handoff_message_id and trace_id = p_trace_id and role = 'assistant'
  ) then
    raise exception 'Site generation handoff identity is invalid' using errcode = 'P0001';
  end if;

  return query select returned_chain_id, handoff_message_id;
end;
$$;

revoke all on function public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)
  to service_role;

-- -----------------------------------------------------------------------------
-- Canonical server claim with DB-owned leases
-- -----------------------------------------------------------------------------

create or replace function public.claim_next_background_job(
  p_runner_id text,
  p_stale_before timestamptz,
  p_generation_contract_epoch integer
) returns setof public.background_jobs
language plpgsql security definer set search_path = public as $$
declare
  claimed public.background_jobs%rowtype;
  recovered public.background_jobs%rowtype;
begin
  if nullif(btrim(p_runner_id), '') is null
     or (p_generation_contract_epoch is not null and p_generation_contract_epoch <> 2) then
    raise exception 'Runner identity or generation capability is invalid' using errcode = '22023';
  end if;

  -- Preserve the established finalization recovery path for enrichment only.
  update public.background_jobs
  set status = case when finalization_attempts >= 3 then 'failed' else 'pending' end,
      completed_at = case when finalization_attempts >= 3 then clock_timestamp() else null end,
      locked_at = null,
      locked_by = null,
      next_retry_at = case when finalization_attempts >= 3 then null else clock_timestamp() end,
      payload_json = case when finalization_attempts >= 3 then payload_json
        else payload_json || '{"resume_enrichment_finalization":true}'::jsonb end,
      error_message = case when finalization_attempts >= 3
        then coalesce(error_message,'Enrichment finalization lease expired after 3 attempts')
        else error_message end,
      status_message = case when finalization_attempts >= 3
        then 'Enrichment finalization failed after 3 attempts'
        else 'Retrying enrichment finalization immediately' end
  where job_type = 'enrichment_platform' and status = 'finalizing'
    and locked_at < p_stale_before;

  perform pg_advisory_xact_lock(hashtextextended('background-job-stale-recovery', 0));

  -- Epoch-2 generation liveness is DB-time lease based. Interruption never consumes
  -- attempts, stage attempts, provider creates, or repair budgets, and ready slots survive.
  for recovered in
    update public.background_jobs
    set status = 'pending',
        locked_at = null,
        locked_by = null,
        lease_expires_at = null,
        next_retry_at = clock_timestamp(),
        interruption_count = interruption_count + 1,
        status_message = 'Resuming interrupted generation'
    where job_type = 'site_generation'
      and generation_contract_epoch = 2
      and p_generation_contract_epoch = 2
      and status = 'running'
      and lease_expires_at is not null
      and lease_expires_at <= clock_timestamp()
    returning *
  loop
    insert into public.site_generation_attempt_events(
      event_key, job_id, website_id, request_id, contract_epoch, claim_epoch,
      stage, stage_attempt, event_type, cause_code, effect_certainty,
      disposition, severity, blocking, budget_type, budget_before, budget_after,
      runner_id, completed_at, details
    ) values (
      recovered.id::text || ':' || recovered.claim_epoch::text || ':interrupted',
      recovered.id, recovered.website_id, recovered.generation_request_id,
      recovered.generation_contract_epoch, recovered.claim_epoch,
      recovered.generation_stage, recovered.stage_attempts,
      'interrupted', 'lease_expired', 'indeterminate', 'resume', 'warning', false,
      'interruption', recovered.interruption_count - 1, recovered.interruption_count,
      recovered.locked_by, clock_timestamp(), '{}'::jsonb
    ) on conflict(event_key) do nothing;
  end loop;

  -- Preserve the previous attempts-based stale recovery and eligibility for unrelated jobs.
  with terminalized as (
    update public.background_jobs
    set status = 'failed', locked_at = null, locked_by = null,
        completed_at = clock_timestamp(), next_retry_at = null,
        error_message = coalesce(error_message,'Worker lease expired after maximum attempts'),
        status_message = 'Failed'
    where job_type <> 'site_generation' and status = 'running'
      and locked_at < p_stale_before and attempts >= max_attempts
    returning id, chain_id, job_type
  ), elected as (
    select distinct on (terminalized.chain_id) terminalized.id
    from terminalized
    where terminalized.job_type = 'enrichment_platform'
      and not exists (
        select 1 from public.background_jobs sibling
        where sibling.chain_id = terminalized.chain_id
          and sibling.id not in (select id from terminalized)
          and sibling.status in ('pending','running','finalizing')
      )
    order by terminalized.chain_id, terminalized.id
  )
  update public.background_jobs finalizer
  set status = 'pending', completed_at = null, next_retry_at = clock_timestamp(),
      finalization_attempts = 0,
      payload_json = finalizer.payload_json || '{"resume_enrichment_finalization":true}'::jsonb,
      status_message = 'Finalizing enrichment after terminal worker failure'
  from elected where finalizer.id = elected.id;

  update public.background_jobs
  set status = 'pending', locked_at = null, locked_by = null,
      next_retry_at = clock_timestamp()
  where job_type <> 'site_generation' and status = 'running'
    and locked_at < p_stale_before and attempts < max_attempts;

  select candidate.* into claimed
  from public.background_jobs candidate
  where candidate.status = 'pending'
    and (
      (
        candidate.job_type = 'site_generation'
        and p_generation_contract_epoch = 2
        and candidate.generation_contract_epoch = 2
        and candidate.generation_contract_version = 2
        and candidate.payload_json->>'generationMode' = 'unified'
        and candidate.generation_stage in ('context','planning','media','composition','validation','persistence')
        and candidate.generation_input_version = 1
        and candidate.generation_input_snapshot is not null
        and candidate.generation_input_hash ~ '^[0-9a-f]{64}$'
        and candidate.generation_input_hash = encode(
          extensions.digest(convert_to(candidate.generation_input_snapshot::text, 'UTF8'), 'sha256'), 'hex'
        )
        and candidate.generation_request_id is not null
        and candidate.agent_trace_id is not null
      )
      or
      (
        candidate.job_type <> 'site_generation'
        and (
          candidate.attempts < candidate.max_attempts
          or (candidate.job_type = 'enrichment_platform'
            and candidate.payload_json->'resume_enrichment_finalization' = 'true'::jsonb)
        )
      )
    )
    and (candidate.next_retry_at is null or candidate.next_retry_at <= clock_timestamp())
    and not exists (
      select 1 from public.background_jobs predecessor
      where predecessor.chain_id = candidate.chain_id
        and predecessor.sequence_index < candidate.sequence_index
        and predecessor.status in ('pending','running','finalizing')
    )
    and (
      candidate.job_type <> 'site_generation'
      or not exists (
        select 1 from public.background_jobs enrichment
        where enrichment.website_id = candidate.website_id
          and enrichment.job_type = 'enrichment_platform'
          and enrichment.status in ('pending','running','finalizing')
      )
    )
  order by case when candidate.job_type = 'site_generation' then 0 else 1 end,
    candidate.created_at, candidate.id
  for update skip locked
  limit 1;

  if not found then return; end if;

  update public.background_jobs
  set status = case when job_type = 'enrichment_platform'
        and payload_json->'resume_enrichment_finalization' = 'true'::jsonb
      then 'finalizing' else 'running' end,
      locked_at = clock_timestamp(),
      locked_by = p_runner_id,
      lease_expires_at = case when job_type = 'site_generation'
        then clock_timestamp() + interval '10 minutes' else lease_expires_at end,
      started_at = coalesce(started_at,clock_timestamp()),
      attempts = attempts + 1,
      claim_epoch = case when job_type = 'site_generation' then claim_epoch + 1 else claim_epoch end,
      next_retry_at = null,
      finalization_attempts = case when job_type = 'enrichment_platform'
          and payload_json->'resume_enrichment_finalization' = 'true'::jsonb
        then finalization_attempts + 1 else finalization_attempts end,
      status_message = case when job_type = 'enrichment_platform'
          and payload_json->'resume_enrichment_finalization' = 'true'::jsonb
        then 'Finalizing enrichment…'
        else coalesce(status_message,'Running ' || coalesce(platform,job_type) || '…') end
  where id = claimed.id
  returning * into claimed;

  if claimed.job_type = 'site_generation' then
    insert into public.site_generation_attempt_events(
      event_key, job_id, website_id, request_id, contract_epoch, claim_epoch,
      stage, stage_attempt, event_type, effect_certainty, disposition,
      severity, blocking, runner_id, started_at, details
    ) values (
      claimed.id::text || ':' || claimed.claim_epoch::text || ':claimed',
      claimed.id, claimed.website_id, claimed.generation_request_id,
      claimed.generation_contract_epoch, claimed.claim_epoch,
      claimed.generation_stage, claimed.stage_attempts,
      'claimed', 'not_started', 'continue', 'info', false,
      p_runner_id, clock_timestamp(), '{}'::jsonb
    ) on conflict(event_key) do nothing;
  end if;

  return next claimed;
end;
$$;

-- Legacy two-argument workers retain unrelated-job behavior but have no epoch-2
-- generation capability. New workers must opt into contract epoch 2 explicitly.
create or replace function public.claim_next_background_job(
  p_runner_id text,
  p_stale_before timestamptz
) returns setof public.background_jobs
language sql security definer set search_path = public as $$
  select * from public.claim_next_background_job(p_runner_id, p_stale_before, null);
$$;

revoke all on function public.claim_next_background_job(text,timestamptz,integer)
  from public, anon, authenticated;
revoke all on function public.claim_next_background_job(text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_next_background_job(text,timestamptz,integer)
  to service_role;
grant execute on function public.claim_next_background_job(text,timestamptz)
  to service_role;

-- Browser claiming is retained only as a callable, fail-closed rolling-deploy shim.
create or replace function public.claim_site_generation_stage(p_website_id uuid,p_runner_id text,p_stale_before timestamptz)
returns setof public.background_jobs
language plpgsql security definer set search_path = public as $$
declare claimed public.background_jobs%rowtype;
begin
  -- Never grant browser ownership of epoch 2. Existing epoch-1 rows retain their old
  -- website-scoped attempts/locked_at claim path until rolling deployment drains them.
  update public.background_jobs
  set status = case when attempts >= max_attempts then 'failed' else 'pending' end,
      completed_at = case when attempts >= max_attempts then clock_timestamp() else null end,
      locked_at = null, locked_by = null,
      next_retry_at = case when attempts >= max_attempts then null else clock_timestamp() end,
      status_message = case when attempts >= max_attempts then 'Failed' else 'Resuming interrupted generation' end
  where website_id = p_website_id and job_type = 'site_generation'
    and generation_contract_epoch < 2 and status = 'running'
    and locked_at < p_stale_before;

  select candidate.* into claimed
  from public.background_jobs candidate
  where candidate.website_id = p_website_id
    and candidate.job_type = 'site_generation'
    and candidate.generation_contract_epoch < 2
    and candidate.status = 'pending'
    and (candidate.next_retry_at is null or candidate.next_retry_at <= clock_timestamp())
    and candidate.attempts < candidate.max_attempts
  order by candidate.created_at, candidate.id
  for update skip locked
  limit 1;
  if not found then
    raise exception 'Browser-owned generation is retired' using errcode = '55000';
  end if;

  update public.background_jobs
  set status = 'running', locked_at = clock_timestamp(), locked_by = p_runner_id,
      started_at = coalesce(started_at,clock_timestamp()), attempts = attempts + 1,
      next_retry_at = null
  where id = claimed.id
  returning * into claimed;
  return next claimed;
end;
$$;
revoke all on function public.claim_site_generation_stage(uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_site_generation_stage(uuid,text,timestamptz)
  to service_role;

-- -----------------------------------------------------------------------------
-- Atomic epoch-fenced yield, settlement, renewal, and scoped cancellation
-- -----------------------------------------------------------------------------

create or replace function public.renew_site_generation_lease(
  p_job_id uuid,
  p_claim_epoch bigint,
  p_runner_id text,
  p_lease_seconds integer default 600
) returns boolean
language plpgsql security definer set search_path = public as $$
declare renewed_id uuid;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 600 then
    raise exception 'Invalid generation lease duration' using errcode = '22023';
  end if;
  update public.background_jobs
  set locked_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
  where id = p_job_id and job_type = 'site_generation'
    and generation_contract_epoch = 2 and status = 'running'
    and claim_epoch = p_claim_epoch and locked_by = p_runner_id
    and lease_expires_at > clock_timestamp()
  returning id into renewed_id;
  return renewed_id is not null;
end;
$$;

-- Invocation deadlines and cooperative worker interruptions are not creative-stage
-- failures. This dedicated transition preserves the stage/checkpoint and increments only
-- interruption_count while atomically recording cause, effect certainty, and retry time.
create or replace function public.interrupt_site_generation_epoch(
  p_job_id uuid,
  p_claim_epoch bigint,
  p_contract_epoch integer,
  p_cause_code text,
  p_effect_certainty text,
  p_retry_at timestamptz,
  p_status_message text,
  p_event_key text,
  p_runner_id text default null,
  p_invocation_id uuid default null,
  p_deployment_id text default null,
  p_details jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare interrupted_job public.background_jobs%rowtype;
declare replay_event public.site_generation_attempt_events%rowtype;
begin
  if p_contract_epoch <> 2
     or nullif(btrim(p_cause_code), '') is null
     or nullif(btrim(p_runner_id), '') is null
     or p_effect_certainty not in ('none','not_started','definite_failure','indeterminate')
     or p_retry_at is null
     or nullif(btrim(p_status_message), '') is null
     or nullif(btrim(p_event_key), '') is null
     or p_details is null or jsonb_typeof(p_details) <> 'object'
     or octet_length(p_details::text) > 16384 then
    raise exception 'Invalid site generation interruption' using errcode = '22023';
  end if;

  select * into replay_event
  from public.site_generation_attempt_events
  where event_key = p_event_key;
  if found then
    if replay_event.job_id = p_job_id
       and replay_event.claim_epoch = p_claim_epoch
       and replay_event.contract_epoch = p_contract_epoch
       and replay_event.event_type = 'interrupted'
       and replay_event.cause_code is not distinct from p_cause_code
       and replay_event.effect_certainty = p_effect_certainty
       and replay_event.details->'retryAt' is not distinct from to_jsonb(p_retry_at) then
      return true;
    end if;
    raise exception 'Interruption event key was already used for a different transition'
      using errcode = '23505';
  end if;

  update public.background_jobs
  set status = 'pending',
      completed_at = null,
      next_retry_at = p_retry_at,
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      interruption_count = interruption_count + 1,
      status_message = left(p_status_message,1000)
  where id = p_job_id
    and job_type = 'site_generation'
    and generation_contract_epoch = p_contract_epoch
    and status = 'running'
    and claim_epoch = p_claim_epoch
    and lease_expires_at > clock_timestamp()
    and locked_by = p_runner_id
  returning * into interrupted_job;
  if not found then return false; end if;

  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,
    stage,stage_attempt,event_type,cause_code,effect_certainty,disposition,
    severity,blocking,budget_type,budget_before,budget_after,
    runner_id,invocation_id,deployment_id,completed_at,details
  ) values (
    p_event_key,interrupted_job.id,interrupted_job.website_id,
    interrupted_job.generation_request_id,interrupted_job.generation_contract_epoch,
    interrupted_job.claim_epoch,interrupted_job.generation_stage,
    interrupted_job.stage_attempts,'interrupted',left(p_cause_code,200),
    p_effect_certainty,'resume','warning',false,'interruption',
    interrupted_job.interruption_count - 1,interrupted_job.interruption_count,
    p_runner_id,p_invocation_id,p_deployment_id,
    clock_timestamp(),p_details || jsonb_build_object(
      'retryAt',p_retry_at,
      'stageAttemptsUnchanged',interrupted_job.stage_attempts,
      'repairAttemptsUnchanged',interrupted_job.repair_attempts
    )
  );
  return true;
end;
$$;

create or replace function public.yield_site_generation_stage_epoch(
  p_job_id uuid,
  p_claim_epoch bigint,
  p_contract_epoch integer,
  p_stage text,
  p_checkpoint jsonb,
  p_progress_pct integer,
  p_status_message text,
  p_event_key text,
  p_runner_id text default null,
  p_invocation_id uuid default null,
  p_deployment_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  current_job public.background_jobs%rowtype;
  completed_stage text;
begin
  if p_contract_epoch <> 2
     or p_stage not in ('context','planning','media','composition','validation','persistence')
     or p_checkpoint is null or jsonb_typeof(p_checkpoint) <> 'object'
     or octet_length(convert_to(p_checkpoint::text,'UTF8')) > 2097152
     or p_checkpoint->>'stage' is distinct from p_stage
     or p_progress_pct < 0 or p_progress_pct > 99
     or nullif(btrim(p_event_key), '') is null then
    raise exception 'Invalid site generation yield' using errcode = '22023';
  end if;

  select * into current_job from public.background_jobs
  where id = p_job_id and job_type = 'site_generation' for update;
  if not found or current_job.status <> 'running'
     or current_job.generation_contract_epoch <> p_contract_epoch
     or current_job.claim_epoch <> p_claim_epoch
     or current_job.lease_expires_at <= clock_timestamp()
     or (p_runner_id is not null and current_job.locked_by <> p_runner_id)
     or not (
       (current_job.generation_stage = 'context' and p_stage = 'planning') or
       (current_job.generation_stage = 'planning' and p_stage = 'media') or
       (current_job.generation_stage = 'media' and p_stage in ('media','composition')) or
       (current_job.generation_stage = 'composition' and p_stage = 'validation') or
       (current_job.generation_stage = 'validation' and p_stage = 'persistence')
     ) then
    return false;
  end if;
  completed_stage := current_job.generation_stage;

  update public.background_jobs
  set status = 'pending',
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      next_retry_at = clock_timestamp(),
      completed_at = null,
      progress_pct = p_progress_pct,
      status_message = p_status_message,
      generation_stage = p_stage,
      generation_checkpoint = p_checkpoint,
      payload_json = (payload_json - 'executionMode') || jsonb_build_object(
        'generationMode','unified',
        'generationContractVersion',2,
        'generationStage',p_stage
      )
  where id = p_job_id and job_type = 'site_generation' and status = 'running'
    and generation_contract_epoch = p_contract_epoch
    and claim_epoch = p_claim_epoch
    and lease_expires_at > clock_timestamp()
    and (p_runner_id is null or locked_by = p_runner_id)
  returning * into current_job;

  if not found then return false; end if;

  insert into public.site_generation_attempt_events(
    event_key, job_id, website_id, request_id, contract_epoch, claim_epoch,
    stage, stage_attempt, event_type, effect_certainty, disposition,
    severity, blocking, runner_id, invocation_id, deployment_id,
    completed_at, details
  ) values (
    p_event_key, current_job.id, current_job.website_id,
    current_job.generation_request_id, current_job.generation_contract_epoch,
    current_job.claim_epoch, completed_stage, current_job.stage_attempts,
    'yielded','none','continue','info',false,
    coalesce(p_runner_id,current_job.locked_by),p_invocation_id,p_deployment_id,
    clock_timestamp(),jsonb_build_object('nextStage',p_stage)
  ) on conflict(event_key) do nothing;
  return true;
end;
$$;

-- Current app compatibility: attempts identifies the current claim while claim_epoch is
-- authoritative. Check both, keep the current signature, and persist no private payload keys.
create or replace function public.yield_site_generation_stage(
  p_job_id uuid,
  p_job_attempts integer,
  p_stage text,
  p_progress_pct integer,
  p_status_message text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare current_job public.background_jobs%rowtype;
begin
  select * into current_job from public.background_jobs
  where id = p_job_id and job_type = 'site_generation' for update;
  if not found or current_job.status <> 'running'
     or current_job.generation_contract_epoch <> 2
     or current_job.attempts <> p_job_attempts then
    return false;
  end if;
  return public.yield_site_generation_stage_epoch(
    p_job_id,
    current_job.claim_epoch,
    current_job.generation_contract_epoch,
    p_stage,
    jsonb_build_object(
      'schemaVersion',1,
      'stage',p_stage,
      'payload',current_job.payload_json - array[
        'executionMode','_agentRequestId','_agentHandoffMessageId','_agentTerminalMessageFinalizedAt'
      ]
    ),
    p_progress_pct,
    p_status_message,
    current_job.id::text || ':' || current_job.claim_epoch::text || ':yielded:' || p_stage,
    current_job.locked_by,
    null,
    null
  );
end;
$$;

create or replace function public.settle_site_generation_epoch(
  p_job_id uuid,
  p_claim_epoch bigint,
  p_contract_epoch integer,
  p_status text,
  p_progress_pct integer,
  p_result_json jsonb,
  p_checkpoint jsonb,
  p_error_message text,
  p_status_message text,
  p_next_retry_at timestamptz,
  p_effect_certainty text,
  p_cause_code text,
  p_event_key text,
  p_budget_type text,
  p_runner_id text default null,
  p_invocation_id uuid default null,
  p_deployment_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare current_job public.background_jobs%rowtype;
declare event_type_value text;
declare disposition_value text;
begin
  if p_contract_epoch <> 2
     or p_status not in ('pending','completed','failed')
     or p_progress_pct < 0 or p_progress_pct > 100
     or p_checkpoint is null or jsonb_typeof(p_checkpoint) <> 'object'
     or p_checkpoint->>'stage' not in ('context','planning','media','composition','validation','persistence')
     or p_effect_certainty not in ('none','not_started','definite_failure','definite_success','indeterminate')
     or nullif(btrim(p_event_key), '') is null
     or (p_status in ('pending','failed') and p_budget_type not in ('stage_attempt','writer_repair'))
     or (p_status = 'completed' and p_budget_type is not null)
     or (p_status = 'pending' and p_next_retry_at is null)
     or (p_status <> 'pending' and p_next_retry_at is not null) then
    raise exception 'Invalid site generation settlement' using errcode = '22023';
  end if;

  update public.background_jobs
  set status = p_status,
      progress_pct = p_progress_pct,
      result_json = p_result_json,
      generation_stage = p_checkpoint->>'stage',
      generation_checkpoint = p_checkpoint,
      error_message = p_error_message,
      status_message = p_status_message,
      completed_at = case when p_status in ('completed','failed')
        then clock_timestamp() else null end,
      next_retry_at = p_next_retry_at,
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      stage_attempts = stage_attempts + case when p_status in ('pending','failed') and p_budget_type = 'stage_attempt' then 1 else 0 end,
      repair_attempts = repair_attempts + case when p_status in ('pending','failed') and p_budget_type = 'writer_repair' then 1 else 0 end
  where id = p_job_id and job_type = 'site_generation' and status = 'running'
    and generation_contract_epoch = p_contract_epoch
    and claim_epoch = p_claim_epoch
    and lease_expires_at > clock_timestamp()
    and (p_runner_id is null or locked_by = p_runner_id)
    and (
      (p_status in ('pending','failed') and p_checkpoint->>'stage' = generation_stage)
      or
      (p_status = 'completed'
        and generation_stage = 'persistence'
        and p_checkpoint->>'stage' = 'persistence'
        and p_result_json is not null)
    )
  returning * into current_job;
  if not found then return false; end if;

  event_type_value := case p_status
    when 'completed' then 'completed'
    when 'failed' then 'failed'
    else 'retry_scheduled' end;
  disposition_value := case p_status
    when 'completed' then 'terminal_success'
    when 'failed' then 'terminal_failure'
    else 'retry' end;

  insert into public.site_generation_attempt_events(
    event_key, job_id, website_id, request_id, contract_epoch, claim_epoch,
    stage, stage_attempt, event_type, cause_code, effect_certainty, disposition,
    severity, blocking, budget_type, budget_before, budget_after,
    runner_id, invocation_id, deployment_id, completed_at, details
  ) values (
    p_event_key,current_job.id,current_job.website_id,current_job.generation_request_id,
    current_job.generation_contract_epoch,current_job.claim_epoch,current_job.generation_stage,
    current_job.stage_attempts,event_type_value,p_cause_code,p_effect_certainty,
    disposition_value,case when p_status = 'failed' then 'error' else 'info' end,
    p_status = 'failed',
    case when p_status in ('pending','failed') then p_budget_type else null end,
    case
      when p_status not in ('pending','failed') then null
      when p_budget_type = 'writer_repair' then current_job.repair_attempts - 1
      else current_job.stage_attempts - 1
    end,
    case
      when p_status not in ('pending','failed') then null
      when p_budget_type = 'writer_repair' then current_job.repair_attempts
      else current_job.stage_attempts
    end,
    coalesce(p_runner_id,current_job.locked_by),p_invocation_id,p_deployment_id,
    clock_timestamp(),'{}'::jsonb
  ) on conflict(event_key) do nothing;
  return true;
end;
$$;

-- Preserve the existing generic RPC for enrichment/add-video. Epoch-2 generation goes
-- through the same signature temporarily, but settlement is additionally claim-epoch and
-- DB-lease fenced and records a durable attempt event.
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
language plpgsql security definer set search_path = public as $$
declare current_job public.background_jobs%rowtype;
declare settled_id uuid;
declare checkpoint jsonb;
begin
  if p_status not in ('pending','completed','failed','cancelled') then
    raise exception 'Invalid background job settlement status' using errcode = '22023';
  end if;

  select * into current_job from public.background_jobs where id = p_job_id for update;
  if not found then return false; end if;

  if current_job.job_type = 'site_generation' and current_job.generation_contract_epoch = 2 then
    -- The legacy signature carries no contract/claim capability. Keep it for enrichment
    -- and add-video, but require epoch-native generation yield/settlement/finalization.
    return false;
  end if;

  if p_status in ('failed','cancelled') then
    update public.site_generation_media_slots ledger
    set status = 'abandoned',
        error_message = coalesce(p_error_message,'Job ended'),
        abandoned_at = clock_timestamp()
    from public.background_jobs job
    where job.id = p_job_id and job.status = 'running'
      and job.attempts = p_job_attempts and job.job_type = 'add_video'
      and ledger.job_id = job.id and ledger.version_id is null
      and ledger.status in ('planned','generating','ready','failed');
  end if;

  update public.background_jobs
  set status = p_status,
      progress_pct = p_progress_pct,
      result_json = p_result_json,
      payload_json = coalesce(p_payload_json,'{}'::jsonb),
      error_message = p_error_message,
      status_message = p_status_message,
      completed_at = p_completed_at,
      next_retry_at = case when p_status = 'pending'
        then nullif(p_payload_json->>'next_retry_at','')::timestamptz else null end,
      locked_at = null,
      locked_by = null
  where id = p_job_id and status = 'running' and attempts = p_job_attempts
  returning id into settled_id;
  return settled_id is not null;
end;
$$;

create or replace function public.cancel_site_generation_request(
  p_website_id uuid,
  p_chain_id uuid,
  p_request_id uuid,
  p_contract_epoch integer,
  p_actor text,
  p_reason text,
  p_expected_claim_epoch bigint default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare cancelled_job public.background_jobs%rowtype;
declare terminal_text text := 'Website generation was cancelled.';
declare terminal_payload jsonb;
begin
  if p_website_id is null or p_chain_id is null or p_request_id is null
     or nullif(btrim(p_actor), '') is null or nullif(btrim(p_reason), '') is null then
    raise exception 'Scoped generation cancellation identity is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation', 0));
  update public.background_jobs
  set status = 'cancelled',
      progress_pct = progress_pct,
      status_message = 'Cancelled',
      error_message = null,
      completed_at = clock_timestamp(),
      cancelled_at = clock_timestamp(),
      cancellation_actor = left(p_actor,200),
      cancellation_reason = left(p_reason,1000),
      locked_at = null,
      locked_by = null,
      lease_expires_at = null,
      next_retry_at = null
  where website_id = p_website_id and chain_id = p_chain_id
    and job_type = 'site_generation'
    and generation_request_id = p_request_id
    and generation_contract_epoch = p_contract_epoch
    and (p_expected_claim_epoch is null or claim_epoch = p_expected_claim_epoch)
    and status in ('pending','running','finalizing')
  returning * into cancelled_job;
  if not found then return false; end if;

  if cancelled_job.generation_contract_epoch = 2 then
    terminal_payload := jsonb_build_object(
      'schemaVersion',1,'kind','site-generation-terminal','status','cancelled',
      'jobId',cancelled_job.id,'requestId',cancelled_job.generation_request_id,
      'claimEpoch',cancelled_job.claim_epoch,'message',terminal_text
    );
    update public.messages set content=terminal_text
    where id=cancelled_job.generation_handoff_message_id
      and trace_id=cancelled_job.agent_trace_id and role='assistant';
    if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;
    update public.agent_traces set status='completed',error_message=null,
      completed_at=coalesce(completed_at,clock_timestamp())
    where id=cancelled_job.agent_trace_id and website_id=p_website_id
      and status in ('running','completed');
    if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;
    update public.background_jobs set
      generation_terminal_message_id=cancelled_job.generation_handoff_message_id,
      generation_terminal_message_payload=terminal_payload,
      generation_terminal_message_at=clock_timestamp()
    where id=cancelled_job.id;
  end if;

  update public.site_generation_media_slots
  set status = 'abandoned', error_message = 'Generation cancelled',
      abandoned_at = clock_timestamp()
  where job_id = cancelled_job.id and version_id is null
    and status in ('planned','generating','failed');

  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,
    stage,stage_attempt,event_type,cause_code,effect_certainty,disposition,
    severity,blocking,runner_id,completed_at,details
  ) values (
    cancelled_job.id::text || ':' || cancelled_job.claim_epoch::text || ':cancelled',
    cancelled_job.id,cancelled_job.website_id,cancelled_job.generation_request_id,
    cancelled_job.generation_contract_epoch,cancelled_job.claim_epoch,
    cancelled_job.generation_stage,cancelled_job.stage_attempts,
    'cancelled','user_or_system_cancellation','indeterminate','cancel',
    'info',false,cancelled_job.locked_by,clock_timestamp(),
    jsonb_build_object('actor',left(p_actor,200),'reason',left(p_reason,1000))
  ) on conflict(event_key) do nothing;
  return true;
end;
$$;

-- Current app compatibility: the UI already supplies exact website, chain, request, and
-- claim epoch. Keep that callable signature while the expanded API carries actor/reason.
create or replace function public.cancel_site_generation_request(
  p_website_id uuid,
  p_chain_id uuid,
  p_request_id uuid,
  p_claim_epoch bigint
) returns boolean
language plpgsql security definer set search_path = public as $$
declare contract_epoch integer;
begin
  select generation_contract_epoch into contract_epoch
  from public.background_jobs
  where website_id = p_website_id and chain_id = p_chain_id
    and job_type = 'site_generation' and generation_request_id = p_request_id
    and claim_epoch = p_claim_epoch and status in ('pending','running','finalizing')
  order by created_at,id limit 1;
  if contract_epoch is null then return false; end if;
  return public.cancel_site_generation_request(
    p_website_id, p_chain_id, p_request_id, contract_epoch,
    'user', 'requested', p_claim_epoch
  );
end;
$$;

revoke all on function public.interrupt_site_generation_epoch(uuid,bigint,integer,text,text,timestamptz,text,text,text,uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.renew_site_generation_lease(uuid,bigint,text,integer)
  from public, anon, authenticated;
revoke all on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)
  from public, anon, authenticated;
revoke all on function public.yield_site_generation_stage(uuid,integer,text,integer,text)
  from public, anon, authenticated;
revoke all on function public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)
  from public, anon, authenticated;
revoke all on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz)
  from public, anon, authenticated;
revoke all on function public.cancel_site_generation_request(uuid,uuid,uuid,integer,text,text,bigint)
  from public, anon, authenticated;
revoke all on function public.cancel_site_generation_request(uuid,uuid,uuid,bigint)
  from public, anon, authenticated;
grant execute on function public.interrupt_site_generation_epoch(uuid,bigint,integer,text,text,timestamptz,text,text,text,uuid,text,jsonb)
  to service_role;
grant execute on function public.renew_site_generation_lease(uuid,bigint,text,integer)
  to service_role;
grant execute on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text)
  to service_role;
grant execute on function public.yield_site_generation_stage(uuid,integer,text,integer,text)
  to service_role;
grant execute on function public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)
  to service_role;
grant execute on function public.settle_background_job(uuid,integer,text,integer,jsonb,jsonb,text,text,timestamptz)
  to service_role;
grant execute on function public.cancel_site_generation_request(uuid,uuid,uuid,integer,text,text,bigint)
  to service_role;
grant execute on function public.cancel_site_generation_request(uuid,uuid,uuid,bigint)
  to service_role;

-- -----------------------------------------------------------------------------
-- Idempotent slot-aware version finalization (including an empty [] manifest)
-- -----------------------------------------------------------------------------

create or replace function public.insert_generated_website_version_with_slots(
  p_website_id uuid,
  p_config_json jsonb,
  p_job_id uuid,
  p_claim_epoch bigint,
  p_media_slot_ids uuid[]
) returns table(id uuid, version_number integer, variant_key text)
language plpgsql security definer set search_path = public as $$
declare
  claimed_job public.background_jobs%rowtype;
  replay_version public.website_versions%rowtype;
  next_number integer;
  new_version_id uuid;
  new_variant_key text;
  supplied_count integer;
  distinct_count integer;
  matched_count integer;
  manifest_slots jsonb;
begin
  if p_website_id is null or p_job_id is null or p_claim_epoch is null
     or p_media_slot_ids is null or jsonb_typeof(p_config_json) <> 'object' then
    raise exception 'A generation job, config, and media slot array are required'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
  select * into claimed_job
  from public.background_jobs
  where background_jobs.id = p_job_id
  for update;
  if not found or claimed_job.website_id <> p_website_id
     or claimed_job.job_type <> 'site_generation'
     or claimed_job.generation_contract_epoch <> 2
     or claimed_job.claim_epoch <> p_claim_epoch
     or (claimed_job.status <> 'completed' and claimed_job.generation_stage <> 'persistence') then
    raise exception 'Generation job is no longer active' using errcode = '40001';
  end if;

  select * into replay_version
  from public.website_versions
  where generation_job_id = p_job_id
  for update;
  if found then
    if claimed_job.generation_result_version_id is distinct from replay_version.id
       or claimed_job.status <> 'completed' then
      raise exception 'Generation replay state is inconsistent' using errcode = 'P0001';
    end if;
    insert into public.site_generation_attempt_events(
      event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,
      stage,stage_attempt,event_type,effect_certainty,disposition,severity,
      blocking,completed_at,details
    ) values (
      claimed_job.id::text || ':finalizer-replayed',claimed_job.id,claimed_job.website_id,
      claimed_job.generation_request_id,claimed_job.generation_contract_epoch,
      claimed_job.claim_epoch,'persistence',claimed_job.stage_attempts,
      'replayed','definite_success','replay','info',false,clock_timestamp(),
      jsonb_build_object('versionId',replay_version.id)
    ) on conflict(event_key) do nothing;
    return query select replay_version.id,replay_version.version_number,replay_version.variant_key;
    return;
  end if;

  if claimed_job.status <> 'running'
     or claimed_job.claim_epoch <> p_claim_epoch
     or claimed_job.lease_expires_at is null then
    raise exception 'Generation job claim was lost before completion' using errcode = '40001';
  end if;
  -- Final persistence never revives an expired claim. Lease renewal is a distinct,
  -- epoch-fenced operation and must occur before entering the finalizer.
  if claimed_job.lease_expires_at <= clock_timestamp() then
    raise exception 'Generation job claim was lost before completion' using errcode = '40001';
  end if;

  select count(*), count(distinct supplied.slot_uuid)
  into supplied_count, distinct_count
  from unnest(p_media_slot_ids) as supplied(slot_uuid);
  if supplied_count <> distinct_count then
    raise exception 'Media slot IDs must be unique' using errcode = '22023';
  end if;

  manifest_slots := p_config_json#>'{mediaManifest,slots}';
  if p_config_json->>'generatorSchemaVersion' = '4' and (
       jsonb_typeof(p_config_json->'validationAttestation') is distinct from 'object'
       or p_config_json->'validationAttestation' is distinct from claimed_job.generation_checkpoint->'validationAttestation'
       or claimed_job.generation_checkpoint->>'candidateSourceHash' is null
       or encode(extensions.digest(convert_to(p_config_json->>'themeSource', 'UTF8'), 'sha256'), 'hex')
          is distinct from claimed_job.generation_checkpoint->>'candidateSourceHash'
       or p_config_json->'unifiedPlan' is distinct from claimed_job.generation_checkpoint#>'{planCheckpoint,plan}'
       or p_config_json->'mediaManifest' is distinct from claimed_job.generation_checkpoint->'mediaManifest'
     ) then
    raise exception 'Schema v4 persistence requires the exact validated candidate attestation'
      using errcode = 'P0001';
  end if;
  if p_config_json->>'generator' is distinct from 'unified-site-agent'
     or coalesce(p_config_json->>'generatorSchemaVersion' not in ('2','3','4'), true)
     or jsonb_typeof(manifest_slots) is distinct from 'array'
     or jsonb_array_length(manifest_slots) <> supplied_count then
    raise exception 'Unified config is missing a complete media manifest'
      using errcode = '22023';
  end if;

  if supplied_count > 0 then
    perform 1 from public.site_generation_media_slots slots
    where slots.id = any(p_media_slot_ids)
    order by slots.id for update;

    select count(*) into matched_count
    from public.site_generation_media_slots slots
    where slots.id = any(p_media_slot_ids)
      and slots.job_id = p_job_id and slots.website_id = p_website_id
      and slots.status = 'ready';
    if matched_count <> supplied_count then
      raise exception 'Media slots are missing, stale, or not ready' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from jsonb_array_elements(manifest_slots) manifest_slot
      left join public.site_generation_media_slots slots
        on slots.id = any(p_media_slot_ids)
        and slots.slot_id = manifest_slot->>'slotId'
      where slots.id is null
        or nullif(manifest_slot->>'slotId','') is null
        or slots.asset_id is distinct from manifest_slot->>'assetId'
        or slots.mime_type is distinct from manifest_slot->>'mimeType'
        or slots.provenance is distinct from manifest_slot->>'origin'
        or slots.role is distinct from manifest_slot->>'role'
        or slots.required is distinct from coalesce((manifest_slot->>'required')::boolean,false)
        or slots.proof_eligible is distinct from coalesce((manifest_slot->>'proofEligible')::boolean,false)
        or slots.source_slot_id is distinct from manifest_slot->>'sourceSlotId'
        or slots.poster_slot_id is distinct from manifest_slot->>'posterSlotId'
        or slots.storage_path is distinct from manifest_slot->>'storagePath'
    ) then
      raise exception 'Resolved media manifest does not match the ready slot ledger'
        using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select manifest_slot->>'slotId'
    from jsonb_array_elements(manifest_slots) manifest_slot
    group by manifest_slot->>'slotId'
    having count(*) <> 1
  ) or exists (
    select 1 from public.site_generation_media_slots slots
    where slots.id = any(p_media_slot_ids)
      and not exists (
        select 1 from jsonb_array_elements(manifest_slots) manifest_slot
        where manifest_slot->>'slotId' = slots.slot_id
      )
  ) then
    raise exception 'Resolved media manifest must cover every supplied slot exactly once'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.site_generation_media_slots slots
    where slots.job_id = p_job_id and slots.website_id = p_website_id
      and slots.required
      and (not (slots.id = any(p_media_slot_ids)) or slots.status <> 'ready')
  ) then
    raise exception 'Every required media slot must be ready for this job' using errcode = 'P0001';
  end if;

  select coalesce(max(version.version_number),0) + 1 into next_number
  from public.website_versions version where version.website_id = p_website_id;
  new_variant_key := 'v' || next_number::text;

  insert into public.website_versions(
    website_id,version_number,config_json,variant_key,status,revision,generation_job_id
  ) values (
    p_website_id,next_number,
    p_config_json || jsonb_build_object('variantKey',new_variant_key),
    new_variant_key,'draft',0,p_job_id
  ) returning website_versions.id into new_version_id;

  if supplied_count > 0 then
    insert into public.website_version_media_slots(
      version_id,website_id,slot_id,asset_id,mime_type,role,provenance,
      required,source_slot_id,poster_slot_id,storage_path,proof_eligible
    ) select new_version_id,source_slots.website_id,source_slots.slot_id,
        source_slots.asset_id,source_slots.mime_type,source_slots.role,
        source_slots.provenance,source_slots.required,source_slots.source_slot_id,
        source_slots.poster_slot_id,source_slots.storage_path,source_slots.proof_eligible
      from public.site_generation_media_slots source_slots
      where source_slots.id = any(p_media_slot_ids);

    update public.site_generation_media_slots
    set status = 'attached',version_id = new_version_id
    where id = any(p_media_slot_ids);
  end if;

  update public.site_generation_media_slots
  set status = 'abandoned',
      error_message = coalesce(error_message,'Not selected by the validated manifest'),
      abandoned_at = clock_timestamp()
  where job_id = p_job_id and website_id = p_website_id and version_id is null
    and not (id = any(p_media_slot_ids))
    and status in ('planned','generating','failed','ready');

  update public.background_jobs
  set status = 'completed',progress_pct = 100,status_message = 'Completed',
      result_json = jsonb_build_object(
        'variantCount',1,'versionIds',jsonb_build_array(new_version_id)
      ),
      generation_result_version_id = new_version_id,
      generation_stage = 'persistence',
      completed_at = clock_timestamp(),next_retry_at = null,
      locked_at = null,locked_by = null,lease_expires_at = null
  where id = p_job_id and status = 'running'
    and generation_contract_epoch = 2
    and claim_epoch = p_claim_epoch
    and lease_expires_at > clock_timestamp();
  if not found then
    raise exception 'Generation job claim was lost before completion' using errcode = '40001';
  end if;

  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,
    stage,stage_attempt,event_type,effect_certainty,disposition,severity,
    blocking,completed_at,details
  ) values (
    claimed_job.id::text || ':finalizer-completed',claimed_job.id,claimed_job.website_id,
    claimed_job.generation_request_id,claimed_job.generation_contract_epoch,
    claimed_job.claim_epoch,'persistence',claimed_job.stage_attempts,
    'completed','definite_success','terminal_success','info',false,
    clock_timestamp(),jsonb_build_object('versionId',new_version_id)
  ) on conflict(event_key) do nothing;

  return query select new_version_id,next_number,new_variant_key;
end;
$$;

revoke all on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[])
  from public, anon, authenticated;
grant execute on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[])
  to service_role;

-- Use authoritative message columns for epoch-2 jobs while preserving the old function
-- signature and historical payload fallback for epoch-1 readers.
create or replace function public.settle_agent_site_generation_message(
  p_website_id uuid,
  p_chain_id uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare generation_job public.background_jobs%rowtype;
declare final_text text;
begin
  if p_website_id is null or p_chain_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_chain_id::text || ':site_generation_message',0));

  select * into generation_job
  from public.background_jobs
  where website_id = p_website_id and chain_id = p_chain_id
    and job_type = 'site_generation' and sequence_index = 0
  order by created_at,id limit 1
  for update;
  if not found or generation_job.agent_trace_id is null
     or generation_job.status not in ('completed','failed','cancelled') then
    return false;
  end if;

  if generation_job.generation_contract_epoch >= 2 then
    if generation_job.generation_terminal_message_at is not null
       or generation_job.generation_handoff_message_id is null
       or not exists (
         select 1 from public.messages
         where id = generation_job.generation_handoff_message_id
           and trace_id = generation_job.agent_trace_id and role = 'assistant'
       ) then
      return false;
    end if;
  elsif generation_job.payload_json ? '_agentTerminalMessageFinalizedAt' then
    return false;
  end if;

  final_text := case generation_job.status
    when 'completed' then 'Your website is ready to review.'
    when 'failed' then 'Site generation failed. Please try again.'
    when 'cancelled' then 'Site generation was cancelled.' end;

  update public.messages
  set content = final_text
  where id = coalesce(
    generation_job.generation_handoff_message_id,
    nullif(generation_job.payload_json->>'_agentHandoffMessageId','')::uuid
  ) and trace_id = generation_job.agent_trace_id and role = 'assistant';
  if not found then return false; end if;

  if generation_job.generation_contract_epoch >= 2 then
    update public.background_jobs
    set generation_terminal_message_at = clock_timestamp()
    where id = generation_job.id and generation_terminal_message_at is null;
  else
    update public.background_jobs
    set payload_json = payload_json || jsonb_build_object(
      '_agentTerminalMessageFinalizedAt',clock_timestamp()
    )
    where id = generation_job.id
      and not (payload_json ? '_agentTerminalMessageFinalizedAt');
  end if;
  return true;
end;
$$;

revoke all on function public.settle_agent_site_generation_message(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.settle_agent_site_generation_message(uuid,uuid)
  to service_role;