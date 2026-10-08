-- Admit gacha generation (contract version 3) on the epoch-2 identity CHECK.
-- Forward-only: copy the live background_jobs_generation_identity_check body from
-- 20260829150000 and widen generation_contract_version from = 2 to in (2, 3).
-- Enqueue already writes version 3; this constraint still rejected the insert (and
-- would reject every later update of a contract-3 row). In-flight planner jobs stay
-- on version 2. Do not rewrite applied migrations.

alter table public.background_jobs
  drop constraint if exists background_jobs_generation_identity_check;

alter table public.background_jobs
  add constraint background_jobs_generation_identity_check check (
    job_type <> 'site_generation'
    or generation_contract_epoch < 2
    or (
      generation_tenant_id is not null
      and generation_request_id is not null
      and request_id is not null
      and request_id = generation_request_id
      and nullif(btrim(generation_request_hash), '') is not null
      and generation_kind in ('initial','regeneration')
      and generation_contract_version in (2, 3)
      and generation_stage in ('context','planning','media','composition','validation','persistence')
      and generation_input_version = 1
      and generation_input_snapshot is not null
      and jsonb_typeof(generation_input_snapshot) = 'object'
      and generation_request_hash ~ '^[0-9a-f]{64}$'
      and generation_input_snapshot->>'requestPayloadHash' is not distinct from generation_request_hash
      and generation_input_hash is not null
      and generation_input_hash ~ '^[0-9a-f]{64}$'
      and generation_input_hash = encode(extensions.digest(convert_to(generation_input_snapshot::text, 'UTF8'), 'sha256'), 'hex')
      and generation_accepted_at is not null
      and generation_checkpoint is not null
      and jsonb_typeof(generation_checkpoint) = 'object'
      and jsonb_typeof(generation_checkpoint->'inputSizeBytes') is not distinct from 'number'
      and generation_checkpoint->>'inputSizeBytes' ~ '^\d+$'
      and (generation_checkpoint->>'inputSizeBytes')::numeric <= 9007199254740991
      and (generation_checkpoint->>'inputSizeBytes')::numeric =
        octet_length(convert_to(generation_input_snapshot::text, 'UTF8'))
      and generation_checkpoint->'input' is not distinct from generation_input_snapshot
      and generation_checkpoint->>'inputHash' is not distinct from generation_input_hash
      and (generation_checkpoint->>'acceptedAt')::timestamptz is not distinct from generation_accepted_at
      and (
        (generation_kind = 'initial' and source_version_id is null and source_revision is null)
        or
        (generation_kind = 'regeneration' and source_version_id is not null and source_revision is not null and source_revision >= 0)
      )
    )
  ) not valid;

alter table public.background_jobs
  validate constraint background_jobs_generation_identity_check;
