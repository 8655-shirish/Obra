-- Add-video database foundation. Additive only: the duplicated historical ledger migrations remain untouched.

-- Typed request identity and version ownership.
alter table public.background_jobs drop constraint if exists background_jobs_job_type_check;
alter table public.background_jobs
  add constraint background_jobs_job_type_check
  check (job_type in ('enrichment_platform', 'site_generation', 'add_video'));

alter table public.background_jobs add column request_id uuid;
alter table public.background_jobs add column source_version_id uuid;
alter table public.background_jobs add column target_version_id uuid;

alter table public.background_jobs
  add constraint background_jobs_source_version_website_fkey
    foreign key (source_version_id, website_id)
    references public.website_versions (id, website_id) on delete restrict,
  add constraint background_jobs_target_version_website_fkey
    foreign key (target_version_id, website_id)
    references public.website_versions (id, website_id) on delete restrict,
  add constraint background_jobs_add_video_identity_check check (
    (job_type = 'add_video' and request_id is not null and source_version_id is not null and target_version_id is not null)
    or
    (job_type <> 'add_video' and request_id is null and source_version_id is null and target_version_id is null)
  );

create unique index background_jobs_add_video_request_uk
  on public.background_jobs (website_id, source_version_id, request_id)
  where job_type = 'add_video';

create unique index background_jobs_one_active_add_video_source_uk
  on public.background_jobs (website_id, source_version_id)
  where job_type = 'add_video' and status in ('pending', 'running');

create unique index if not exists background_jobs_one_active_add_video_target_uk
  on public.background_jobs (website_id, target_version_id)
  where job_type = 'add_video' and status in ('pending', 'running');

alter table public.website_versions add column revision bigint not null default 0;

-- Version attachments must retain proof parity rather than reconstructing it from role.
alter table public.website_version_media_slots
  add column proof_eligible boolean;

update public.website_version_media_slots attachment
set proof_eligible = ledger.proof_eligible
from public.site_generation_media_slots ledger
where ledger.version_id = attachment.version_id
  and ledger.website_id = attachment.website_id
  and ledger.slot_id = attachment.slot_id;

do $$
begin
  if exists (
    select 1 from public.website_version_media_slots
    where proof_eligible is null and role = 'proof'
  ) then
    raise exception 'Cannot prove proof eligibility for historical proof attachments; reconcile provenance before applying this migration';
  end if;
end;
$$;

update public.website_version_media_slots
set proof_eligible = false
where proof_eligible is null;

alter table public.website_version_media_slots
  alter column proof_eligible set default false,
  alter column proof_eligible set not null,
  add constraint website_version_media_slots_proof_provenance_check check (
    not (role = 'proof' and (provenance <> 'evidence' or not proof_eligible))
  );

-- Durable provider budget, retired-operation audit, accepted-plan identity, and byte attestation.
alter table public.site_generation_media_slots add column provider_create_count integer not null default 0;
alter table public.site_generation_media_slots add column retired_provider_operation_ids jsonb not null default '[]'::jsonb;
alter table public.site_generation_media_slots add column plan_hash text;
alter table public.site_generation_media_slots add column byte_size integer;
alter table public.site_generation_media_slots add column duration_ms integer;
alter table public.site_generation_media_slots add column video_codec text;
alter table public.site_generation_media_slots add column video_profile text;
alter table public.site_generation_media_slots add column has_audio boolean;
alter table public.site_generation_media_slots add column audio_codec text;
alter table public.site_generation_media_slots add column validator_version text;

alter table public.site_generation_media_slots
  add constraint site_generation_media_slots_provider_create_count_check
    check (provider_create_count between 0 and 2),
  add constraint site_generation_media_slots_retired_operations_check
    check (jsonb_typeof(retired_provider_operation_ids) = 'array'),
  add constraint site_generation_media_slots_attestation_check check (
    kind <> 'video' or status not in ('ready', 'attached')
    or (
      byte_size between 1 and 12582912
      and duration_ms between 3000 and 5000
      and width > 0 and height > 0
      and lower(video_codec) = 'h264'
      and nullif(video_profile, '') is not null
      and has_audio is not null
      and (not has_audio or nullif(audio_codec, '') is not null)
      and nullif(validator_version, '') is not null
    )
  );

-- All media-ledger mutators derive their owner type from background_jobs.job_type.
create or replace function public.plan_generation_media_slot(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer, p_slot_id text,
  p_kind text, p_role text, p_provenance text, p_required boolean,
  p_proof_eligible boolean, p_source_slot_id text default null,
  p_poster_slot_id text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid; claimed_job public.background_jobs%rowtype;
begin
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type not in ('site_generation', 'add_video')
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
    raise exception 'Media job is no longer active';
  end if;
  insert into public.site_generation_media_slots (
    job_id, website_id, slot_id, kind, role, provenance, required, proof_eligible,
    status, source_slot_id, poster_slot_id
  ) values (
    p_job_id, p_website_id, p_slot_id, p_kind, p_role, p_provenance, p_required,
    p_proof_eligible, 'planned', p_source_slot_id, p_poster_slot_id
  ) on conflict (job_id, slot_id) do nothing returning id into result_id;
  if result_id is null then
    select id into result_id from public.site_generation_media_slots
    where job_id = p_job_id and website_id = p_website_id and slot_id = p_slot_id
      and kind = p_kind and role = p_role and provenance = p_provenance
      and required = p_required and proof_eligible = p_proof_eligible
      and source_slot_id is not distinct from p_source_slot_id
      and poster_slot_id is not distinct from p_poster_slot_id;
    if result_id is null then raise exception 'Persisted media slot does not match the accepted plan'; end if;
  end if;
  return result_id;
end;
$$;

create or replace function public.settle_generation_media_slot(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer, p_slot_id text,
  p_status text, p_error_message text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare claimed_job public.background_jobs%rowtype;
begin
  if p_status not in ('failed', 'abandoned') then raise exception 'Invalid settlement status'; end if;
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type not in ('site_generation', 'add_video')
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then return false;
  end if;
  update public.site_generation_media_slots set
    status = p_status,
    error_message = left(p_error_message, 1000),
    retired_provider_operation_ids = case
      when p_status = 'failed' and provider_operation_id is not null
        and not (retired_provider_operation_ids ? provider_operation_id)
      then retired_provider_operation_ids || jsonb_build_array(provider_operation_id)
      else retired_provider_operation_ids end,
    abandoned_at = case when p_status = 'abandoned' then now() else null end
  where job_id = p_job_id and website_id = p_website_id and slot_id = p_slot_id
    and status = 'generating' and claim_attempt = p_job_attempts;
  return found;
end;
$$;

create or replace function public.claim_generation_media_slot(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer, p_slot_id text,
  p_kind text, p_role text, p_provenance text, p_required boolean,
  p_proof_eligible boolean, p_source_slot_id text default null,
  p_poster_slot_id text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid; claimed_job public.background_jobs%rowtype;
begin
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type not in ('site_generation', 'add_video')
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
    raise exception 'Media job is no longer active';
  end if;
  insert into public.site_generation_media_slots (
    job_id, website_id, slot_id, kind, role, provenance, required, proof_eligible,
    status, claim_attempt, claimed_at, source_slot_id, poster_slot_id
  ) values (
    p_job_id, p_website_id, p_slot_id, p_kind, p_role, p_provenance, p_required,
    p_proof_eligible, 'generating', p_job_attempts, now(), p_source_slot_id, p_poster_slot_id
  ) on conflict (job_id, slot_id) do update set
    status = 'generating', claim_attempt = excluded.claim_attempt, claimed_at = now(),
    error_message = null
  where (
      site_generation_media_slots.status in ('planned', 'failed')
      or (site_generation_media_slots.status = 'generating'
          and site_generation_media_slots.claim_attempt < excluded.claim_attempt)
    )
    and site_generation_media_slots.kind = excluded.kind
    and site_generation_media_slots.role = excluded.role
    and site_generation_media_slots.provenance = excluded.provenance
    and site_generation_media_slots.required = excluded.required
    and site_generation_media_slots.proof_eligible = excluded.proof_eligible
    and site_generation_media_slots.source_slot_id is not distinct from excluded.source_slot_id
    and site_generation_media_slots.poster_slot_id is not distinct from excluded.poster_slot_id
  returning id into result_id;
  if result_id is null then raise exception 'Media slot cannot be claimed'; end if;
  return result_id;
end;
$$;

create or replace function public.record_generation_media_operation(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer,
  p_slot_id text, p_provider_operation_id text
) returns boolean language plpgsql security definer set search_path = public as $$
declare claimed_job public.background_jobs%rowtype;
begin
  if nullif(p_provider_operation_id, '') is null then raise exception 'Provider operation ID is required'; end if;
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type not in ('site_generation', 'add_video')
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then return false;
  end if;
  update public.site_generation_media_slots set provider_operation_id = p_provider_operation_id
  where job_id = p_job_id and website_id = p_website_id and slot_id = p_slot_id
    and status = 'generating' and claim_attempt = p_job_attempts
    and (provider_operation_id is null or provider_operation_id = p_provider_operation_id);
  return found;
end;
$$;

create or replace function public.record_generation_media_slot(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer, p_slot_id text,
  p_kind text, p_role text, p_provenance text, p_required boolean,
  p_proof_eligible boolean, p_storage_path text, p_mime_type text,
  p_width integer default null, p_height integer default null,
  p_content_hash text default null, p_source_slot_id text default null,
  p_poster_slot_id text default null, p_byte_size bigint default null,
  p_duration_ms integer default null, p_video_codec text default null,
  p_video_profile text default null, p_has_audio boolean default null,
  p_audio_codec text default null, p_validator_version text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare claimed_job public.background_jobs%rowtype; result_id uuid;
begin
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type not in ('site_generation', 'add_video')
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
    raise exception 'Media job is no longer active';
  end if;
  update public.site_generation_media_slots set
    asset_id = p_content_hash, status = 'ready', storage_path = p_storage_path,
    mime_type = p_mime_type, width = p_width, height = p_height,
    content_hash = p_content_hash, byte_size = p_byte_size, duration_ms = p_duration_ms,
    video_codec = case when p_video_codec is null then null else lower(p_video_codec) end,
    video_profile = p_video_profile, has_audio = p_has_audio, audio_codec = p_audio_codec,
    validator_version = p_validator_version, error_message = null, abandoned_at = null,
    version_id = null
  where job_id = p_job_id and website_id = p_website_id and slot_id = p_slot_id
    and status = 'generating' and claim_attempt = p_job_attempts
    and kind = p_kind and role = p_role and provenance = p_provenance
    and required = p_required and proof_eligible = p_proof_eligible
    and source_slot_id is not distinct from p_source_slot_id
    and poster_slot_id is not distinct from p_poster_slot_id
  returning id into result_id;
  if result_id is null then raise exception 'Media slot claim was lost before ready'; end if;
  return result_id;
end;
$$;

-- Atomically reserve a billable provider create. Failed operations may be replaced once;
-- generating operations are resumed and never consume another reservation.
create or replace function public.reserve_generation_media_create(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer, p_slot_id text
) returns integer language plpgsql security definer set search_path = public as $$
declare claimed_job public.background_jobs%rowtype; result_count integer;
begin
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type not in ('site_generation', 'add_video')
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
    raise exception 'Media job is no longer active';
  end if;
  update public.site_generation_media_slots set
    provider_create_count = provider_create_count + 1,
    provider_operation_id = null,
    status = 'generating', claim_attempt = p_job_attempts, claimed_at = now(), error_message = null
  where job_id = p_job_id and website_id = p_website_id and slot_id = p_slot_id
    and claim_attempt = p_job_attempts
    and status = 'generating'
    and (provider_create_count = 0 or (provider_operation_id is not null
      and retired_provider_operation_ids ? provider_operation_id))
    and provider_create_count < 2
  returning provider_create_count into result_count;
  if result_count is null then raise exception 'Provider create is not permitted for this slot'; end if;
  return result_count;
end;
$$;

-- Plan checkpoint and slot creation share the job-attempt fence.
create or replace function public.checkpoint_add_video_plan(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer,
  p_plan jsonb, p_plan_hash text, p_slot_id text,
  p_source_slot_id text, p_poster_slot_id text
) returns uuid language plpgsql security definer set search_path = public as $$
declare claimed_job public.background_jobs%rowtype; result_id uuid;
begin
  if jsonb_typeof(p_plan) <> 'object' or nullif(p_plan_hash, '') is null
    or nullif(p_slot_id, '') is null or nullif(p_source_slot_id, '') is null
    or nullif(p_poster_slot_id, '') is null then
    raise exception 'Accepted plan, canonical hash, slot, source, and poster IDs are required';
  end if;
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id or claimed_job.job_type <> 'add_video'
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
    raise exception 'Add video job is no longer active';
  end if;
  if claimed_job.payload_json ? 'planHash' and (claimed_job.payload_json->>'planHash') is distinct from p_plan_hash then
    raise exception 'A different add-video plan is already checkpointed';
  end if;
  update public.background_jobs set payload_json = payload_json || jsonb_build_object(
    'plan', p_plan, 'planHash', p_plan_hash, 'videoSlotId', p_slot_id
  ) where id = p_job_id;
  insert into public.site_generation_media_slots (
    job_id, website_id, slot_id, kind, role, provenance, required, proof_eligible,
    status, source_slot_id, poster_slot_id, plan_hash
  ) values (
    p_job_id, p_website_id, p_slot_id, 'video', 'atmosphere', 'generated', true, false,
    'planned', p_source_slot_id, p_poster_slot_id, p_plan_hash
  ) on conflict (job_id, slot_id) do nothing returning id into result_id;
  if result_id is null then
    select id into result_id from public.site_generation_media_slots
    where job_id = p_job_id and website_id = p_website_id and slot_id = p_slot_id
      and kind = 'video' and role = 'atmosphere' and provenance = 'generated'
      and required and not proof_eligible and plan_hash = p_plan_hash
      and source_slot_id = p_source_slot_id and poster_slot_id = p_poster_slot_id;
    if result_id is null then raise exception 'Persisted video slot does not match the accepted plan'; end if;
  end if;
  return result_id;
end;
$$;

-- Stable replay helper embedded in enqueue/cancel results.
create or replace function public.enqueue_add_video_job(
  p_website_id uuid, p_source_version_id uuid, p_request_id uuid, p_expected_revision bigint
) returns table(
  job_id uuid, chain_id uuid, source_version_id uuid, target_version_id uuid,
  status text, result jsonb, error_code text
) language plpgsql security definer set search_path = public as $$
declare existing_job public.background_jobs%rowtype; source_row public.website_versions%rowtype;
  target_id uuid; new_chain_id uuid; new_job_id uuid; next_number integer;
begin
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  select b.* into existing_job from public.background_jobs b
  where b.website_id = p_website_id and b.source_version_id = p_source_version_id
    and b.request_id = p_request_id and b.job_type = 'add_video';
  if found then
    return query select existing_job.id, existing_job.chain_id, existing_job.source_version_id,
      existing_job.target_version_id, existing_job.status, existing_job.result_json,
      coalesce(existing_job.result_json->>'errorCode', existing_job.payload_json->>'errorCode');
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_source_version_id::text, 0));
  select b.* into existing_job from public.background_jobs b
  where b.website_id = p_website_id and b.source_version_id = p_source_version_id
    and b.request_id = p_request_id and b.job_type = 'add_video';
  if found then
    return query select existing_job.id, existing_job.chain_id, existing_job.source_version_id,
      existing_job.target_version_id, existing_job.status, existing_job.result_json,
      coalesce(existing_job.result_json->>'errorCode', existing_job.payload_json->>'errorCode');
    return;
  end if;

  select * into source_row from public.website_versions
  where id = p_source_version_id and website_id = p_website_id for update;
  if not found then raise exception 'Website version not found'; end if;
  if source_row.revision <> p_expected_revision then raise exception 'Website version revision conflict'; end if;
  if source_row.status not in ('draft', 'selected', 'live') then raise exception 'Website version is not editable'; end if;
  if source_row.config_json->>'generator' <> 'unified-site-agent'
    or source_row.config_json->>'generatorSchemaVersion' <> '3'
    or jsonb_typeof(source_row.config_json#>'{mediaManifest,slots}') <> 'array'
    or exists (
      select 1 from jsonb_array_elements(source_row.config_json#>'{mediaManifest,slots}') slot
      where slot->>'mimeType' = 'video/mp4' or slot->>'kind' = 'video'
    ) then raise exception 'Add video requires a supported v3 still-only manifest';
  end if;
  if not exists (
    select 1 from public.website_version_media_slots s
    where s.website_id = p_website_id and s.version_id = p_source_version_id
      and s.provenance = 'generated' and not s.proof_eligible
      and s.mime_type like 'image/%' and s.mime_type <> 'image/gif'
  ) then raise exception 'No eligible generated still is attached'; end if;

  target_id := p_source_version_id;
  if source_row.status = 'live' then
    perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
    select coalesce(max(version_number), 0) + 1 into next_number
      from public.website_versions where website_id = p_website_id;
    insert into public.website_versions (website_id, version_number, config_json, variant_key, status, revision)
    values (p_website_id, next_number, source_row.config_json,
      source_row.variant_key || '-edit-' || next_number::text, 'selected', 0)
    returning id into target_id;
    insert into public.website_version_media_slots (
      version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
      required, source_slot_id, poster_slot_id, storage_path, proof_eligible
    ) select target_id, website_id, slot_id, asset_id, mime_type, role, provenance,
      required, source_slot_id, poster_slot_id, storage_path, proof_eligible
    from public.website_version_media_slots
    where website_id = p_website_id and version_id = p_source_version_id;
  end if;

  new_chain_id := gen_random_uuid(); new_job_id := gen_random_uuid();
  insert into public.background_jobs (
    id, website_id, chain_id, job_type, sequence_index, status, progress_pct,
    status_message, payload_json, request_id, source_version_id, target_version_id
  ) values (
    new_job_id, p_website_id, new_chain_id, 'add_video', 0, 'pending', 0,
    'Preparing this design…', jsonb_build_object(
      'requestId', p_request_id, 'sourceVersionId', p_source_version_id,
      'targetVersionId', target_id, 'expectedRevision', case when source_row.status = 'live' then 0 else source_row.revision end
    ), p_request_id, p_source_version_id, target_id
  );
  return query select new_job_id, new_chain_id, p_source_version_id, target_id,
    'pending'::text, null::jsonb, null::text;
end;
$$;

create or replace function public.cancel_add_video_job(
  p_website_id uuid, p_chain_id uuid, p_request_id uuid
) returns table(
  job_id uuid, chain_id uuid, source_version_id uuid, target_version_id uuid,
  status text, result jsonb, error_code text
) language plpgsql security definer set search_path = public as $$
declare claimed_job public.background_jobs%rowtype;
begin
  select b.* into claimed_job from public.background_jobs b
  where b.website_id = p_website_id and b.chain_id = p_chain_id and b.request_id = p_request_id
    and b.job_type = 'add_video' for update;
  if not found then raise exception 'Add video request not found'; end if;
  if claimed_job.status in ('pending', 'running') then
    update public.site_generation_media_slots set status = 'abandoned', abandoned_at = now(),
      error_message = 'Cancelled by user'
    where job_id = claimed_job.id and website_id = p_website_id
      and status in ('planned', 'generating')
      and (claimed_job.status = 'pending' or claim_attempt = claimed_job.attempts);
    update public.background_jobs set status = 'cancelled', status_message = 'Cancelled',
      error_message = null, completed_at = now(), locked_at = null, locked_by = null,
      result_json = coalesce(result_json, jsonb_build_object('errorCode', 'cancelled'))
    where id = claimed_job.id returning * into claimed_job;
  end if;
  return query select claimed_job.id, claimed_job.chain_id, claimed_job.source_version_id,
    claimed_job.target_version_id, claimed_job.status, claimed_job.result_json,
    coalesce(claimed_job.result_json->>'errorCode', claimed_job.payload_json->>'errorCode');
end;
$$;

-- Revision-checked generic edit seam. No owner-type denormalization is introduced.
create or replace function public.update_website_version_config_atomic(
  p_website_id uuid, p_version_id uuid, p_expected_revision bigint,
  p_config_json jsonb, p_category text, p_patch_json jsonb default '{}'::jsonb
) returns bigint language plpgsql security definer set search_path = public as $$
declare next_revision bigint;
begin
  update public.website_versions set config_json = p_config_json,
    revision = revision + 1, updated_at = now()
  where id = p_version_id and website_id = p_website_id
    and status in ('draft', 'selected') and revision = p_expected_revision
  returning revision into next_revision;
  if next_revision is null then raise exception 'Website version revision conflict'; end if;
  insert into public.website_edit_events (website_id, version_id, category, patch_json)
  values (p_website_id, p_version_id, p_category, p_patch_json);
  return next_revision;
end;
$$;


-- Atomically attach one validated video to the exact target version and complete its job.
-- Application code owns semantic candidate validation; this routine rechecks relational facts.
create or replace function public.commit_add_video_to_version(
  p_job_id uuid, p_website_id uuid, p_target_version_id uuid, p_job_attempts integer,
  p_expected_revision bigint, p_candidate_hash text, p_config_json jsonb,
  p_media_slot_id uuid, p_edit_event_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  claimed_job public.background_jobs%rowtype;
  target_version public.website_versions%rowtype;
  media_slot public.site_generation_media_slots%rowtype;
  source_attachment public.website_version_media_slots%rowtype;
  poster_attachment public.website_version_media_slots%rowtype;
  result_value jsonb;
  selected_section_type text;
  candidate_video jsonb;
  candidate_slot_count integer;
  attachment_count integer;
begin
  if nullif(p_candidate_hash, '') is null or jsonb_typeof(p_config_json) <> 'object'
    or jsonb_typeof(p_edit_event_payload) <> 'object' then
    raise exception 'Candidate hash, complete config, and edit-event payload are required';
  end if;

  -- The primary-key lock serializes finalization with cancellation. Typed request columns and
  -- the unique request index make this the immutable (website, source version, request) job.
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type <> 'add_video'
    or claimed_job.target_version_id <> p_target_version_id
    or claimed_job.request_id is null or claimed_job.source_version_id is null
    or claimed_job.payload_json->>'requestId' is distinct from claimed_job.request_id::text
    or claimed_job.payload_json->>'sourceVersionId' is distinct from claimed_job.source_version_id::text
    or claimed_job.payload_json->>'targetVersionId' is distinct from claimed_job.target_version_id::text
    or claimed_job.payload_json->>'expectedRevision' is distinct from p_expected_revision::text
    or not exists (
      select 1 from public.background_jobs identity_job
      where identity_job.website_id = claimed_job.website_id
        and identity_job.source_version_id = claimed_job.source_version_id
        and identity_job.request_id = claimed_job.request_id
        and identity_job.job_type = 'add_video' and identity_job.id = claimed_job.id
    ) then
    raise exception 'Add video request identity does not match';
  end if;

  if claimed_job.status = 'completed' then
    if claimed_job.result_json->>'candidateHash' is distinct from p_candidate_hash then
      raise exception 'Add video candidate hash idempotency conflict';
    end if;
    return claimed_job.result_json;
  end if;
  if claimed_job.status in ('failed', 'cancelled') then
    return coalesce(claimed_job.result_json, jsonb_build_object(
      'status', claimed_job.status,
      'errorCode', coalesce(claimed_job.payload_json->>'errorCode', claimed_job.status)
    ));
  end if;
  if claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
    raise exception 'Add video job is no longer active';
  end if;

  select * into target_version from public.website_versions
  where id = p_target_version_id and website_id = p_website_id for update;
  if not found then raise exception 'Target website version not found'; end if;
  if target_version.status not in ('draft', 'selected') then
    raise exception 'Target website version is not editable';
  end if;
  if target_version.revision <> p_expected_revision then
    raise exception 'Website version revision conflict';
  end if;
  if p_config_json->>'generator' <> 'unified-site-agent'
    or p_config_json->>'generatorSchemaVersion' <> '3'
    or jsonb_typeof(p_config_json#>'{mediaManifest,slots}') <> 'array' then
    raise exception 'Candidate must contain a supported v3 media manifest';
  end if;

  select * into media_slot from public.site_generation_media_slots
  where id = p_media_slot_id for update;
  if not found or media_slot.job_id <> p_job_id or media_slot.website_id <> p_website_id
    or media_slot.status <> 'ready' or media_slot.claim_attempt <> p_job_attempts
    or media_slot.version_id is not null
    or media_slot.kind <> 'video' or media_slot.role <> 'atmosphere'
    or media_slot.provenance <> 'generated' or not media_slot.required or media_slot.proof_eligible
    or media_slot.mime_type <> 'video/mp4' or media_slot.plan_hash is null
    or media_slot.plan_hash is distinct from claimed_job.payload_json->>'planHash'
    or media_slot.slot_id is distinct from claimed_job.payload_json->>'videoSlotId'
    or nullif(media_slot.asset_id, '') is null or nullif(media_slot.content_hash, '') is null
    or media_slot.asset_id is distinct from media_slot.content_hash
    or nullif(media_slot.storage_path, '') is null
    or media_slot.byte_size not between 1 and 12582912
    or media_slot.duration_ms not between 3000 and 5000
    or coalesce(media_slot.width, 0) <= 0 or coalesce(media_slot.height, 0) <= 0
    or lower(media_slot.video_codec) <> 'h264' or nullif(media_slot.video_profile, '') is null
    or media_slot.has_audio is null
    or (media_slot.has_audio and nullif(media_slot.audio_codec, '') is null)
    or nullif(media_slot.validator_version, '') is null then
    raise exception 'Ready video ledger slot does not match this attempt and attestation';
  end if;
  if (select count(*) from public.site_generation_media_slots s
      where s.job_id = p_job_id and s.website_id = p_website_id
        and s.status = 'ready' and s.kind = 'video') <> 1 then
    raise exception 'Add video job must own exactly one ready video slot';
  end if;

  if media_slot.source_slot_id is null or media_slot.poster_slot_id is null
    or media_slot.source_slot_id <> media_slot.poster_slot_id then
    raise exception 'Video source and poster must identify the same still attachment';
  end if;
  select * into source_attachment from public.website_version_media_slots
  where version_id = p_target_version_id and website_id = p_website_id
    and slot_id = media_slot.source_slot_id for update;
  select * into poster_attachment from public.website_version_media_slots
  where version_id = p_target_version_id and website_id = p_website_id
    and slot_id = media_slot.poster_slot_id for update;
  if source_attachment.slot_id is null or poster_attachment.slot_id is null
    or source_attachment.asset_id <> poster_attachment.asset_id
    or source_attachment.provenance <> 'generated' or source_attachment.proof_eligible
    or source_attachment.mime_type not like 'image/%' or source_attachment.mime_type = 'image/gif' then
    raise exception 'Video source and poster attachments are invalid';
  end if;
  if exists (select 1 from public.website_version_media_slots
      where version_id = p_target_version_id and website_id = p_website_id
        and (slot_id = media_slot.slot_id or asset_id = media_slot.asset_id)) then
    raise exception 'Video attachment slot or asset already exists';
  end if;

  select slot into candidate_video
  from jsonb_array_elements(p_config_json#>'{mediaManifest,slots}') slot
  where slot->>'slotId' = media_slot.slot_id;
  if candidate_video is null
    or candidate_video->>'assetId' <> media_slot.asset_id
    or candidate_video->>'mimeType' <> media_slot.mime_type
    or candidate_video->>'origin' <> media_slot.provenance
    or candidate_video->>'role' <> media_slot.role
    or candidate_video->>'proofEligible' <> 'false'
    or candidate_video->>'required' <> 'true'
    or candidate_video->>'storagePath' <> media_slot.storage_path
    or candidate_video->>'sourceSlotId' <> media_slot.source_slot_id
    or candidate_video->>'posterSlotId' <> media_slot.poster_slot_id
    or candidate_video->>'sourceSlotId' is distinct from claimed_job.payload_json#>>'{plan,sourceSlotId}'
    or candidate_video->>'placement' <> 'inline'
    or candidate_video->>'placement' is distinct from claimed_job.payload_json#>>'{plan,placement}'
    or nullif(candidate_video->>'motionPreset', '') is null
    or candidate_video->>'motionPreset' is distinct from claimed_job.payload_json#>>'{plan,motionPreset}'
    or nullif(candidate_video->>'targetSection', '') is null
    or candidate_video->>'targetSection' is distinct from claimed_job.payload_json#>>'{plan,targetSection}' then
    raise exception 'Candidate video does not match the accepted ledger and plan';
  end if;
  selected_section_type := candidate_video->>'targetSection';

  -- The candidate manifest must be exactly the locked attachment snapshot plus this video.
  select jsonb_array_length(p_config_json#>'{mediaManifest,slots}') into candidate_slot_count;
  select count(*) into attachment_count from public.website_version_media_slots
    where version_id = p_target_version_id and website_id = p_website_id;
  if candidate_slot_count <> attachment_count + 1
    or (select count(*) from jsonb_array_elements(p_config_json#>'{mediaManifest,slots}') slot
        where slot->>'slotId' = media_slot.slot_id) <> 1
    or exists (
      select 1 from public.website_version_media_slots attachment
      where attachment.version_id = p_target_version_id and attachment.website_id = p_website_id
        and not exists (
          select 1 from jsonb_array_elements(p_config_json#>'{mediaManifest,slots}') slot
          where slot->>'slotId' = attachment.slot_id
            and slot->>'assetId' = attachment.asset_id
            and slot->>'mimeType' = attachment.mime_type
            and slot->>'role' = attachment.role
            and slot->>'origin' = attachment.provenance
            and (slot->>'required')::boolean = attachment.required
            and (slot->>'proofEligible')::boolean = attachment.proof_eligible
            and (slot->>'sourceSlotId') is not distinct from attachment.source_slot_id
            and (slot->>'posterSlotId') is not distinct from attachment.poster_slot_id
            and slot->>'storagePath' = attachment.storage_path
        )
    ) then
    raise exception 'Candidate manifest does not exactly match the attachment snapshot';
  end if;

  insert into public.website_version_media_slots (
    version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
    required, source_slot_id, poster_slot_id, storage_path, proof_eligible
  ) values (
    p_target_version_id, p_website_id, media_slot.slot_id, media_slot.asset_id,
    media_slot.mime_type, media_slot.role, media_slot.provenance, media_slot.required,
    media_slot.source_slot_id, media_slot.poster_slot_id, media_slot.storage_path,
    media_slot.proof_eligible
  );

  update public.website_versions set config_json = p_config_json,
    revision = revision + 1, updated_at = now()
  where id = p_target_version_id and website_id = p_website_id
    and revision = p_expected_revision
  returning * into target_version;
  if not found then raise exception 'Website version revision conflict'; end if;

  insert into public.website_edit_events (website_id, version_id, category, patch_json)
  values (p_website_id, p_target_version_id, 'add_video', p_edit_event_payload);

  update public.site_generation_media_slots set status = 'attached',
    version_id = p_target_version_id, error_message = null
  where id = p_media_slot_id and status = 'ready' and claim_attempt = p_job_attempts;
  if not found then raise exception 'Ready video ledger slot was lost before attachment'; end if;

  result_value := jsonb_build_object(
    'status', 'completed', 'targetVersionId', p_target_version_id,
    'revision', target_version.revision, 'selectedSectionType', selected_section_type,
    'slotId', media_slot.slot_id, 'candidateHash', p_candidate_hash
  );
  update public.background_jobs set status = 'completed', progress_pct = 100,
    status_message = 'Video added', result_json = result_value, error_message = null,
    completed_at = now(), locked_at = null, locked_by = null
  where id = p_job_id and status = 'running' and attempts = p_job_attempts;
  if not found then raise exception 'Add video attempt was lost before completion'; end if;
  return result_value;
end;
$$;

-- The extended signature above has defaults for legacy still callers. Remove the old
-- overload so named PostgREST calls cannot match two routines.
drop function if exists public.record_generation_media_slot(
  uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text,
  integer, integer, text, text, text
);

-- Service-role-only execution for all new or replaced mutation functions.
revoke all on function public.reserve_generation_media_create(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.checkpoint_add_video_plan(uuid, uuid, integer, jsonb, text, text, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_add_video_job(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.cancel_add_video_job(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.commit_add_video_to_version(uuid, uuid, uuid, integer, bigint, text, jsonb, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.update_website_version_config_atomic(uuid, uuid, bigint, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.plan_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.settle_generation_media_slot(uuid, uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.claim_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.record_generation_media_operation(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.record_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text, integer, integer, text, text, text, bigint, integer, text, text, boolean, text, text) from public, anon, authenticated;

grant execute on function public.reserve_generation_media_create(uuid, uuid, integer, text) to service_role;
grant execute on function public.checkpoint_add_video_plan(uuid, uuid, integer, jsonb, text, text, text, text) to service_role;
grant execute on function public.enqueue_add_video_job(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.cancel_add_video_job(uuid, uuid, uuid) to service_role;
grant execute on function public.commit_add_video_to_version(uuid, uuid, uuid, integer, bigint, text, jsonb, uuid, jsonb) to service_role;
grant execute on function public.update_website_version_config_atomic(uuid, uuid, bigint, jsonb, text, jsonb) to service_role;
grant execute on function public.plan_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) to service_role;
grant execute on function public.settle_generation_media_slot(uuid, uuid, integer, text, text, text) to service_role;
grant execute on function public.claim_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) to service_role;
grant execute on function public.record_generation_media_operation(uuid, uuid, integer, text, text) to service_role;
grant execute on function public.record_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text, integer, integer, text, text, text, bigint, integer, text, text, boolean, text, text) to service_role;

-- Revision is the sole stale-write token for every existing version aggregate mutation.
-- Snapshot arguments remain integrity assertions only and never substitute for p_expected_revision.
drop function if exists public.publish_website_version_atomic(uuid, uuid);
drop function if exists public.publish_website_version_atomic(uuid, uuid, jsonb);
drop function if exists public.publish_website_version_atomic(uuid, uuid, jsonb, jsonb);
create or replace function public.publish_website_version_atomic(
  p_website_id uuid, p_version_id uuid, p_expected_revision bigint,
  p_expected_config_json jsonb, p_expected_media_slots jsonb default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare target public.website_versions%rowtype; locked_media_slots jsonb; next_revision bigint;
begin
  select * into target from public.website_versions
  where id = p_version_id and website_id = p_website_id for update;
  if not found then raise exception 'Website version not found'; end if;
  if target.revision <> p_expected_revision then raise exception 'Website version revision conflict'; end if;
  if target.status not in ('draft', 'selected') then raise exception 'Website version is not publishable'; end if;
  if target.config_json is distinct from p_expected_config_json then
    raise exception 'Website version integrity check failed';
  end if;
  if p_expected_media_slots is not null then
    select coalesce(jsonb_agg(to_jsonb(slot_row) order by slot_row.slot_id), '[]'::jsonb)
    into locked_media_slots from (
      select slot_id, asset_id, mime_type, role, provenance, required,
        source_slot_id, poster_slot_id, storage_path, proof_eligible
      from public.website_version_media_slots
      where website_id = p_website_id and version_id = p_version_id
      order by slot_id for update
    ) slot_row;
    if locked_media_slots is distinct from p_expected_media_slots then
      raise exception 'Website media attachment integrity check failed';
    end if;
  end if;
  update public.website_versions set status = 'live', revision = revision + 1, updated_at = now()
  where id = p_version_id and website_id = p_website_id and revision = p_expected_revision
  returning revision into next_revision;
  if next_revision is null then raise exception 'Website version revision conflict'; end if;
  update public.websites set status = 'live', active_version_id = p_version_id, updated_at = now()
  where id = p_website_id;
  if not found then raise exception 'Website not found'; end if;
  return next_revision;
end;
$$;

create or replace function public.select_website_version_atomic(
  p_website_id uuid, p_version_id uuid, p_expected_revision bigint
) returns bigint language plpgsql security definer set search_path = public as $$
declare target public.website_versions%rowtype; next_revision bigint;
begin
  select * into target from public.website_versions
  where id = p_version_id and website_id = p_website_id for update;
  if not found then raise exception 'Website version not found'; end if;
  if target.revision <> p_expected_revision then raise exception 'Website version revision conflict'; end if;
  if target.status = 'live' then return target.revision; end if;
  if target.status not in ('draft', 'selected') then raise exception 'Website version is not selectable'; end if;
  if target.status = 'selected' then return target.revision; end if;
  update public.website_versions set status = 'selected', revision = revision + 1, updated_at = now()
  where id = p_version_id and website_id = p_website_id and revision = p_expected_revision
  returning revision into next_revision;
  if next_revision is null then raise exception 'Website version revision conflict'; end if;
  return next_revision;
end;
$$;

create or replace function public.restore_website_version_atomic(
  p_website_id uuid, p_version_id uuid, p_expected_revision bigint
) returns bigint language plpgsql security definer set search_path = public as $$
declare next_revision bigint;
begin
  update public.website_versions set status = 'selected', revision = revision + 1, updated_at = now()
  where id = p_version_id and website_id = p_website_id
    and status = 'discarded' and revision = p_expected_revision
  returning revision into next_revision;
  if next_revision is null then raise exception 'Website version revision conflict'; end if;
  return next_revision;
end;
$$;

create or replace function public.discard_website_versions_atomic(
  p_website_id uuid, p_expected_versions jsonb
) returns integer language plpgsql security definer set search_path = public as $$
declare expected_count integer; eligible_count integer; changed_count integer;
begin
  if jsonb_typeof(p_expected_versions) <> 'array' then raise exception 'Expected versions must be an array'; end if;
  perform 1 from public.website_versions
  where website_id = p_website_id and status in ('draft', 'selected')
  order by id for update;
  select jsonb_array_length(p_expected_versions) into expected_count;
  select count(*) into eligible_count from public.website_versions
  where website_id = p_website_id and status in ('draft', 'selected');
  if expected_count <> eligible_count or exists (
    select 1 from jsonb_array_elements(p_expected_versions) expected
    left join public.website_versions version
      on version.id = (expected->>'id')::uuid and version.website_id = p_website_id
      and version.status in ('draft', 'selected')
      and version.revision = (expected->>'revision')::bigint
    where version.id is null
  ) then raise exception 'Website version revision conflict'; end if;
  update public.website_versions version set status = 'discarded',
    revision = version.revision + 1, updated_at = now()
  from jsonb_array_elements(p_expected_versions) expected
  where version.id = (expected->>'id')::uuid and version.website_id = p_website_id
    and version.status in ('draft', 'selected')
    and version.revision = (expected->>'revision')::bigint;
  get diagnostics changed_count = row_count;
  if changed_count <> expected_count then raise exception 'Website version revision conflict'; end if;
  return changed_count;
end;
$$;

-- A generic live fork compares the exact source revision before copying; the source is never mutated.
drop function if exists public.fork_website_version_with_media(uuid, uuid);
create or replace function public.fork_website_version_with_media(
  p_website_id uuid, p_source_version_id uuid, p_expected_revision bigint
) returns public.website_versions language plpgsql security definer set search_path = public as $$
declare source_row public.website_versions%rowtype; created public.website_versions%rowtype; next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
  select * into source_row from public.website_versions
  where id = p_source_version_id and website_id = p_website_id for update;
  if not found then raise exception 'Website version not found'; end if;
  if source_row.revision <> p_expected_revision then raise exception 'Website version revision conflict'; end if;
  if source_row.status <> 'live' then raise exception 'Website version is not live'; end if;
  select coalesce(max(version_number), 0) + 1 into next_number
  from public.website_versions where website_id = p_website_id;
  insert into public.website_versions (website_id, version_number, config_json, variant_key, status, revision)
  values (p_website_id, next_number, source_row.config_json,
    source_row.variant_key || '-edit-' || next_number::text, 'selected', 0)
  returning * into created;
  if source_row.config_json->>'generatorSchemaVersion' in ('2', '3') then
    insert into public.website_version_media_slots (
      version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
      required, source_slot_id, poster_slot_id, storage_path, proof_eligible
    ) select created.id, website_id, slot_id, asset_id, mime_type, role, provenance,
      required, source_slot_id, poster_slot_id, storage_path, proof_eligible
    from public.website_version_media_slots
    where website_id = p_website_id and version_id = p_source_version_id;
  end if;
  return created;
end;
$$;

-- Slot-aware generation finalization creates one revision-zero aggregate and attaches its complete snapshot.
create or replace function public.insert_generated_website_version_with_slots(
  p_website_id uuid,
  p_config_json jsonb,
  p_job_id uuid,
  p_job_attempts integer,
  p_media_slot_ids uuid[]
) returns table(id uuid, version_number integer, variant_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
  claimed_job public.background_jobs%rowtype;
  new_version_id uuid;
  supplied_count integer;
  distinct_count integer;
  matched_count integer;
begin
  if p_job_id is null or p_job_attempts is null then
    raise exception 'A generation job claim is required';
  end if;

  if p_media_slot_ids is null or cardinality(p_media_slot_ids) = 0 then
    raise exception 'At least one media slot is required';
  end if;

  select count(*), count(distinct supplied.id)
  into supplied_count, distinct_count
  from unnest(p_media_slot_ids) as supplied(id);

  if supplied_count <> distinct_count then
    raise exception 'Media slot IDs must be unique';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));

  select *
  into claimed_job
  from public.background_jobs
  where background_jobs.id = p_job_id
  for update;

  if not found
    or claimed_job.website_id <> p_website_id
    or claimed_job.job_type <> 'site_generation'
    or claimed_job.status <> 'running'
    or claimed_job.attempts <> p_job_attempts
  then
    raise exception 'Generation job is no longer active';
  end if;

  perform 1
  from public.site_generation_media_slots slots
  where slots.id = any(p_media_slot_ids)
  order by slots.id
  for update;

  select count(*)
  into matched_count
  from public.site_generation_media_slots slots
  where slots.id = any(p_media_slot_ids)
    and slots.job_id = p_job_id
    and slots.website_id = p_website_id
    and slots.status = 'ready';

  if matched_count <> supplied_count then
    raise exception 'Media slots are missing, stale, or not ready';
  end if;

  if p_config_json->>'generator' <> 'unified-site-agent'
    or p_config_json->>'generatorSchemaVersion' not in ('2', '3')
    or jsonb_typeof(p_config_json->'unifiedBrief') <> 'object'
    or nullif(p_config_json#>>'{unifiedBrief,recipeId}', '') is null
    or nullif(p_config_json#>>'{unifiedBrief,recipeVersion}', '') is null
    or jsonb_typeof(p_config_json#>'{mediaManifest,slots}') <> 'array'
    or jsonb_array_length(p_config_json#>'{mediaManifest,slots}') <> supplied_count
  then
    raise exception 'Unified config is missing its validated brief or complete media manifest';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_config_json#>'{mediaManifest,slots}') manifest_slot
    left join public.site_generation_media_slots slots
      on slots.id = any(p_media_slot_ids)
      and slots.slot_id = manifest_slot->>'slotId'
    where slots.id is null
      or slots.asset_id <> manifest_slot->>'assetId'
      or slots.mime_type <> manifest_slot->>'mimeType'
      or slots.provenance <> manifest_slot->>'origin'
      or slots.role <> manifest_slot->>'role'
      or slots.required <> coalesce((manifest_slot->>'required')::boolean, false)
      or slots.proof_eligible <> coalesce((manifest_slot->>'proofEligible')::boolean, false)
      or coalesce(slots.source_slot_id, '') <> coalesce(manifest_slot->>'sourceSlotId', '')
      or coalesce(slots.poster_slot_id, '') <> coalesce(manifest_slot->>'posterSlotId', '')
  ) then
    raise exception 'Resolved media manifest does not match the ready slot ledger';
  end if;

  if exists (
    select 1
    from public.site_generation_media_slots slots
    where slots.job_id = p_job_id
      and slots.website_id = p_website_id
      and slots.required
      and (
        not (slots.id = any(p_media_slot_ids))
        or slots.status <> 'ready'
      )
  ) then
    raise exception 'Every required media slot must be ready in the current attempt';
  end if;

  select coalesce(max(wv.version_number), 0) + 1
  into next_number
  from public.website_versions wv
  where wv.website_id = p_website_id;

  insert into public.website_versions (website_id, version_number, config_json, variant_key, status, revision)
  values (
    p_website_id,
    next_number,
    p_config_json || jsonb_build_object('variantKey', 'v' || next_number::text),
    'v' || next_number::text,
    'draft',
    0
  )
  returning website_versions.id into new_version_id;

  insert into public.website_version_media_slots (
    version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
    required, source_slot_id, poster_slot_id, storage_path, proof_eligible
  ) select new_version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
      required, source_slot_id, poster_slot_id, storage_path, proof_eligible
    from public.site_generation_media_slots where id = any(p_media_slot_ids);

  update public.site_generation_media_slots slots
  set status = 'attached', version_id = new_version_id
  where slots.id = any(p_media_slot_ids);

  update public.background_jobs
  set status = 'completed',
      progress_pct = 100,
      status_message = 'Completed',
      result_json = jsonb_build_object(
        'variantCount', 1,
        'versionIds', jsonb_build_array(new_version_id)
      ),
      completed_at = now(),
      locked_at = null,
      locked_by = null
  where background_jobs.id = p_job_id
    and background_jobs.status = 'running'
    and background_jobs.attempts = p_job_attempts;

  if not found then
    raise exception 'Generation job claim was lost before completion';
  end if;

  return query
  select new_version_id, next_number, 'v' || next_number::text;
end;
$$;

-- New generated aggregates start at revision zero; the active job attempt is their creation CAS.
create or replace function public.insert_generated_website_version(
  p_website_id uuid, p_config_json jsonb, p_job_id uuid default null, p_job_attempts integer default null
) returns table(id uuid, version_number integer, variant_key text) language plpgsql security definer set search_path = public as $$
declare next_number integer; claimed_job public.background_jobs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
  if p_job_id is not null then
    select * into claimed_job from public.background_jobs where background_jobs.id = p_job_id for update;
    if not found or claimed_job.website_id <> p_website_id or claimed_job.job_type <> 'site_generation'
      or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
      raise exception 'Generation job is no longer active';
    end if;
  end if;
  select coalesce(max(wv.version_number), 0) + 1 into next_number
  from public.website_versions wv where wv.website_id = p_website_id;
  return query insert into public.website_versions
    (website_id, version_number, config_json, variant_key, status, revision)
  values (p_website_id, next_number, p_config_json || jsonb_build_object('variantKey', 'v' || next_number::text),
    'v' || next_number::text, 'draft', 0)
  returning website_versions.id, website_versions.version_number, website_versions.variant_key;
end;
$$;

revoke all on function public.publish_website_version_atomic(uuid, uuid, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.select_website_version_atomic(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.restore_website_version_atomic(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.discard_website_versions_atomic(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fork_website_version_with_media(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.insert_generated_website_version(uuid, jsonb, uuid, integer) from public, anon, authenticated;
revoke all on function public.insert_generated_website_version_with_slots(uuid, jsonb, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.publish_website_version_atomic(uuid, uuid, bigint, jsonb, jsonb) to service_role;
grant execute on function public.select_website_version_atomic(uuid, uuid, bigint) to service_role;
grant execute on function public.restore_website_version_atomic(uuid, uuid, bigint) to service_role;
grant execute on function public.discard_website_versions_atomic(uuid, jsonb) to service_role;
grant execute on function public.fork_website_version_with_media(uuid, uuid, bigint) to service_role;
grant execute on function public.insert_generated_website_version(uuid, jsonb, uuid, integer) to service_role;
grant execute on function public.insert_generated_website_version_with_slots(uuid, jsonb, uuid, integer, uuid[]) to service_role;
-- Return indexed Add-video ledger candidates; storage enumeration in the service also finds
-- crash-after-upload-before-ledger objects that this query necessarily cannot see.
create or replace function public.list_add_video_orphan_candidates(
  p_eligible_before timestamptz
) returns table(storage_path text, content_hash text, oldest_at timestamptz)
language sql stable security definer set search_path = public as $$
  select ledger.storage_path, ledger.content_hash,
    min(coalesce(ledger.abandoned_at, ledger.updated_at)) as oldest_at
  from public.site_generation_media_slots ledger
  join public.background_jobs job on job.id = ledger.job_id and job.website_id = ledger.website_id
  where job.job_type = 'add_video'
    and ledger.version_id is null
    and ledger.status in ('ready', 'failed', 'abandoned')
    and ledger.storage_path is not null
    and ledger.content_hash is not null
    and coalesce(ledger.abandoned_at, ledger.updated_at) <= p_eligible_before
  group by ledger.storage_path, ledger.content_hash;
$$;


-- Reference-safe Add-video orphan discovery. This complements the historical
-- abandoned-only index and also covers uploaded/ready objects never attached to a version.
create index site_generation_media_slots_orphan_retention_idx
  on public.site_generation_media_slots (coalesce(abandoned_at, updated_at), storage_path, content_hash)
  where version_id is null
    and storage_path is not null
    and status in ('ready', 'failed', 'abandoned');

-- The sweeper calls this immediately before every delete. It intentionally scans every
-- ledger row and every immutable version attachment, regardless of status or age.
create or replace function public.add_video_storage_object_is_referenced(
  p_storage_path text, p_content_hash text, p_eligible_before timestamptz
) returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if nullif(p_storage_path, '') is null or nullif(p_content_hash, '') is null
    or p_eligible_before is null then
    raise exception 'Storage path, content hash, and eligibility cutoff are required';
  end if;
  return exists (
    select 1 from public.site_generation_media_slots ledger
    join public.background_jobs job on job.id = ledger.job_id and job.website_id = ledger.website_id
    where (ledger.storage_path = p_storage_path or ledger.content_hash = p_content_hash)
      and not (
        job.job_type = 'add_video'
        and ledger.version_id is null
        and ledger.status in ('ready', 'failed', 'abandoned')
        and coalesce(ledger.abandoned_at, ledger.updated_at) <= p_eligible_before
      )
  ) or exists (
    select 1 from public.website_version_media_slots attachment
    where attachment.storage_path = p_storage_path or attachment.asset_id = p_content_hash
  );
end;
$$;

revoke all on function public.add_video_storage_object_is_referenced(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.add_video_storage_object_is_referenced(text, text, timestamptz)
  to service_role;
revoke all on function public.list_add_video_orphan_candidates(timestamptz)
  from public, anon, authenticated;
grant execute on function public.list_add_video_orphan_candidates(timestamptz)
  to service_role;
