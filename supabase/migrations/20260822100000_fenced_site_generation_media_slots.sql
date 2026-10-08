-- Add a durable, attempt-fenced media-slot ledger and atomically finalize generated versions.
-- The four-argument insert RPC remains available for generation paths that do not use media slots.

alter table public.background_jobs
  add constraint background_jobs_id_website_id_key unique (id, website_id);

alter table public.website_versions
  add constraint website_versions_id_website_id_key unique (id, website_id);

create table public.site_generation_media_slots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  website_id uuid not null,
  version_id uuid,
  slot_id text not null,
  asset_id text,
  kind text not null check (kind in ('image', 'video')),
  role text not null check (role in ('hero', 'proof', 'support', 'atmosphere', 'texture', 'motion-poster')),
  provenance text not null check (provenance in ('evidence', 'generated')),
  required boolean not null default true,
  proof_eligible boolean not null default false,
  status text not null default 'planned' check (
    status in ('planned', 'generating', 'ready', 'failed', 'abandoned', 'attached')
  ),
  claim_attempt integer,
  claimed_at timestamptz,
  source_slot_id text,
  poster_slot_id text,
  provider_idempotency_key text,
  provider_operation_id text,
  storage_path text,
  mime_type text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  content_hash text,
  error_message text,
  abandoned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_generation_media_slots_job_website_fkey
    foreign key (job_id, website_id)
    references public.background_jobs (id, website_id)
    on delete cascade,
  constraint site_generation_media_slots_version_website_fkey
    foreign key (version_id, website_id)
    references public.website_versions (id, website_id)
    on delete restrict,
  constraint site_generation_media_slots_job_slot_key unique (job_id, slot_id),
  constraint site_generation_media_slots_proof_provenance_check check (
    not (role = 'proof' and (provenance <> 'evidence' or not proof_eligible))
  ),
  constraint site_generation_media_slots_attached_version_check check (
    status <> 'attached' or version_id is not null
  ),
  constraint site_generation_media_slots_ready_material_check check (
    status not in ('ready', 'attached') or (
      asset_id is not null and length(asset_id) > 0 and
      storage_path is not null and length(storage_path) > 0 and
      mime_type is not null and length(mime_type) > 0 and
      content_hash is not null and length(content_hash) > 0 and
      (kind <> 'video' or (source_slot_id is not null and poster_slot_id is not null))
    )
  )
);

create index site_generation_media_slots_abandoned_unattached_idx
  on public.site_generation_media_slots (abandoned_at)
  where status = 'abandoned' and version_id is null;

alter table public.site_generation_media_slots enable row level security;

revoke all on table public.site_generation_media_slots from public, anon, authenticated;
grant all on table public.site_generation_media_slots to service_role;

drop trigger if exists site_generation_media_slots_set_updated_at
  on public.site_generation_media_slots;
create trigger site_generation_media_slots_set_updated_at
  before update on public.site_generation_media_slots
  for each row execute function public.set_updated_at();

-- Serialize generation enqueue per website and make same-key retries atomic.
create or replace function public.enqueue_site_generation_job(
  p_website_id uuid, p_idempotency_key text, p_payload_json jsonb,
  p_replay_completed boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare existing_chain uuid; new_chain uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation', 0));
  select chain_id into existing_chain
  from public.background_jobs
  where website_id = p_website_id and job_type = 'site_generation'
    and sequence_index = 0 and idempotency_key = p_idempotency_key
    and (status in ('pending', 'running') or (p_replay_completed and status = 'completed'))
  order by created_at desc limit 1;
  if existing_chain is not null then return existing_chain; end if;

  update public.background_jobs set
    status = 'cancelled', locked_at = null, locked_by = null, idempotency_key = null
  where website_id = p_website_id and job_type = 'site_generation'
    and status in ('pending', 'running');
  update public.background_jobs set idempotency_key = null
  where website_id = p_website_id and idempotency_key = p_idempotency_key
    and status in ('completed', 'failed');

  insert into public.background_jobs (
    website_id, chain_id, job_type, sequence_index, platform, status,
    progress_pct, status_message, payload_json, idempotency_key
  ) values (
    p_website_id, new_chain, 'site_generation', 0, null, 'pending', 0,
    'Queued site generation…', p_payload_json, p_idempotency_key
  );
  return new_chain;
end;
$$;
revoke all on function public.enqueue_site_generation_job(uuid, text, jsonb, boolean) from public;
grant execute on function public.enqueue_site_generation_job(uuid, text, jsonb, boolean) to service_role;


create table public.website_version_media_slots (
  version_id uuid not null,
  website_id uuid not null,
  slot_id text not null,
  asset_id text not null,
  mime_type text not null,
  role text not null,
  provenance text not null,
  required boolean not null,
  source_slot_id text,
  poster_slot_id text,
  storage_path text not null,
  primary key (version_id, slot_id),
  foreign key (version_id, website_id) references public.website_versions (id, website_id) on delete cascade
);
alter table public.website_version_media_slots enable row level security;
-- Shared content-addressed objects may be referenced by many immutable versions. Physical
-- cleanup must be performed by a service-role retention job after reference accounting.
drop policy if exists site_media_delete_own on storage.objects;
revoke all on table public.website_version_media_slots from public, anon, authenticated;
grant all on table public.website_version_media_slots to service_role;

create or replace function public.fork_website_version_with_media(
  p_website_id uuid, p_source_version_id uuid
) returns public.website_versions language plpgsql security definer set search_path = public as $$
declare source_row public.website_versions%rowtype; created public.website_versions%rowtype; next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));
  select * into source_row from public.website_versions
  where id = p_source_version_id and website_id = p_website_id for update;
  if not found then raise exception 'Website version not found'; end if;
  select coalesce(max(version_number), 0) + 1 into next_number
  from public.website_versions where website_id = p_website_id;
  insert into public.website_versions (website_id, version_number, config_json, variant_key, status)
  values (p_website_id, next_number, source_row.config_json, source_row.variant_key || '-edit-' || next_number::text, 'draft')
  returning * into created;
  if source_row.config_json->>'generatorSchemaVersion' = '2' then
    insert into public.website_version_media_slots (
      version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
      required, source_slot_id, poster_slot_id, storage_path
    ) select created.id, website_id, slot_id, asset_id, mime_type, role, provenance,
        required, source_slot_id, poster_slot_id, storage_path
      from public.website_version_media_slots
      where website_id = p_website_id and version_id = p_source_version_id;
  end if;
  return created;
end;
$$;
revoke all on function public.fork_website_version_with_media(uuid, uuid) from public;
grant execute on function public.fork_website_version_with_media(uuid, uuid) to service_role;
drop function if exists public.publish_website_version_atomic(uuid, uuid);

-- Bind publication to the exact config snapshot validated by the application.
create or replace function public.publish_website_version_atomic(
  p_website_id uuid, p_version_id uuid, p_expected_config_json jsonb,
  p_expected_media_slots jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare locked_config jsonb; locked_media_slots jsonb;
begin
  select config_json into locked_config from public.website_versions
  where id = p_version_id and website_id = p_website_id for update;
  if not found then raise exception 'Website version not found'; end if;
  if locked_config is distinct from p_expected_config_json then
    raise exception 'Website version changed after validation';
  end if;
  if p_expected_media_slots is not null then
    select coalesce(jsonb_agg(to_jsonb(slot_row) order by slot_row.slot_id), '[]'::jsonb)
      into locked_media_slots
      from (
        select slot_id, asset_id, mime_type, role, provenance, required,
          source_slot_id, poster_slot_id, storage_path
        from public.website_version_media_slots
        where website_id = p_website_id and version_id = p_version_id
        order by slot_id
        for update
      ) slot_row;
    if locked_media_slots is distinct from p_expected_media_slots then
      raise exception 'Website media attachments changed after validation';
    end if;
  end if;
  update public.website_versions set status = 'live', updated_at = now()
  where id = p_version_id and website_id = p_website_id;
  update public.websites set status = 'live', active_version_id = p_version_id, updated_at = now()
  where id = p_website_id;
  if not found then raise exception 'Website not found'; end if;
end;
$$;
drop function if exists public.publish_website_version_atomic(uuid, uuid, jsonb);
revoke all on function public.publish_website_version_atomic(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.publish_website_version_atomic(uuid, uuid, jsonb, jsonb) to service_role;

-- Persist the complete accepted slot plan before any provider purchase.
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
    or claimed_job.job_type <> 'site_generation'
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
    raise exception 'Generation job is no longer active';
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
revoke all on function public.plan_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) from public;
grant execute on function public.plan_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) to service_role;

-- Settle only work owned by the active attempt. Ready rows are immutable here.
create or replace function public.settle_generation_media_slot(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer, p_slot_id text,
  p_status text, p_error_message text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare claimed_job public.background_jobs%rowtype;
begin
  if p_status not in ('failed', 'abandoned') then raise exception 'Invalid settlement status'; end if;
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type <> 'site_generation'
    or claimed_job.status <> 'running'
    or claimed_job.attempts <> p_job_attempts then
    return false;
  end if;
  update public.site_generation_media_slots set
    status = p_status, error_message = left(p_error_message, 1000),
    abandoned_at = case when p_status = 'abandoned' then now() else null end
  where job_id = p_job_id and website_id = p_website_id and slot_id = p_slot_id
    and status = 'generating' and claim_attempt = p_job_attempts;
  return found;
end;
$$;
revoke all on function public.settle_generation_media_slot(uuid, uuid, integer, text, text, text) from public;
grant execute on function public.settle_generation_media_slot(uuid, uuid, integer, text, text, text) to service_role;

-- Slot claims are persisted before provider calls and fenced by the active job attempt.
create or replace function public.claim_generation_media_slot(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer, p_slot_id text,
  p_kind text, p_role text, p_provenance text, p_required boolean,
  p_proof_eligible boolean, p_source_slot_id text default null,
  p_poster_slot_id text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid; claimed_job public.background_jobs%rowtype;
begin
  select * into claimed_job from public.background_jobs
    where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type <> 'site_generation'
    or claimed_job.status <> 'running' or claimed_job.attempts <> p_job_attempts then
    raise exception 'Generation job is no longer active';
  end if;
  insert into public.site_generation_media_slots (
    job_id, website_id, slot_id, kind, role, provenance, required, proof_eligible,
    status, claim_attempt, claimed_at, source_slot_id, poster_slot_id
  ) values (
    p_job_id, p_website_id, p_slot_id, p_kind, p_role, p_provenance, p_required,
    p_proof_eligible, 'generating', p_job_attempts, now(), p_source_slot_id, p_poster_slot_id
  ) on conflict (job_id, slot_id) do update set
    status = 'generating', claim_attempt = excluded.claim_attempt, claimed_at = now(),
    error_message = null,
    provider_operation_id = site_generation_media_slots.provider_operation_id
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
revoke all on function public.claim_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) from public;
grant execute on function public.claim_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) to service_role;

-- Persist a resumable provider operation immediately after provider acceptance.
create or replace function public.record_generation_media_operation(
  p_job_id uuid, p_website_id uuid, p_job_attempts integer,
  p_slot_id text, p_provider_operation_id text
) returns boolean language plpgsql security definer set search_path = public as $$
declare claimed_job public.background_jobs%rowtype;
begin
  if p_provider_operation_id is null or length(p_provider_operation_id) = 0 then
    raise exception 'Provider operation ID is required';
  end if;
  select * into claimed_job from public.background_jobs where id = p_job_id for update;
  if not found or claimed_job.website_id <> p_website_id
    or claimed_job.job_type <> 'site_generation'
    or claimed_job.status <> 'running'
    or claimed_job.attempts <> p_job_attempts then
    return false;
  end if;
  update public.site_generation_media_slots set
    provider_operation_id = p_provider_operation_id
  where job_id = p_job_id and website_id = p_website_id and slot_id = p_slot_id
    and status = 'generating' and claim_attempt = p_job_attempts
    and (provider_operation_id is null or provider_operation_id = p_provider_operation_id);
  return found;
end;
$$;
revoke all on function public.record_generation_media_operation(uuid, uuid, integer, text, text) from public;
grant execute on function public.record_generation_media_operation(uuid, uuid, integer, text, text) to service_role;

-- Tighten the legacy-compatible RPC by locking the claimed job row before checking it.
-- This keeps its existing signature and result shape while serializing it with cancellation.
create or replace function public.insert_generated_website_version(
  p_website_id uuid,
  p_config_json jsonb,
  p_job_id uuid default null,
  p_job_attempts integer default null
) returns table(id uuid, version_number integer, variant_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  next_number integer;
  claimed_job public.background_jobs%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text, 0));

  if p_job_id is not null then
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
  end if;

  select coalesce(max(wv.version_number), 0) + 1
  into next_number
  from public.website_versions wv
  where wv.website_id = p_website_id;

  return query
  insert into public.website_versions (website_id, version_number, config_json, variant_key, status)
  values (
    p_website_id,
    next_number,
    p_config_json || jsonb_build_object('variantKey', 'v' || next_number::text),
    'v' || next_number::text,
    'draft'
  )
  returning website_versions.id, website_versions.version_number, website_versions.variant_key;
end;
$$;

revoke all on function public.insert_generated_website_version(uuid, jsonb, uuid, integer) from public;
grant execute on function public.insert_generated_website_version(uuid, jsonb, uuid, integer) to service_role;

-- A distinct slot-aware RPC prevents accidental selection of the legacy signature.
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
    or p_config_json->>'generatorSchemaVersion' <> '2'
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

  insert into public.website_versions (website_id, version_number, config_json, variant_key, status)
  values (
    p_website_id,
    next_number,
    p_config_json || jsonb_build_object('variantKey', 'v' || next_number::text),
    'v' || next_number::text,
    'draft'
  )
  returning website_versions.id into new_version_id;

  insert into public.website_version_media_slots (
    version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
    required, source_slot_id, poster_slot_id, storage_path
  ) select new_version_id, website_id, slot_id, asset_id, mime_type, role, provenance,
      required, source_slot_id, poster_slot_id, storage_path
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

revoke all on function public.insert_generated_website_version_with_slots(uuid, jsonb, uuid, integer, uuid[]) from public;
grant execute on function public.insert_generated_website_version_with_slots(uuid, jsonb, uuid, integer, uuid[]) to service_role;

-- Record a ready slot only while the caller still owns the active generation attempt.
-- Repeated calls for the same attempt and slot reuse the durable row.
create or replace function public.record_generation_media_slot(
  p_job_id uuid,
  p_website_id uuid,
  p_job_attempts integer,
  p_slot_id text,
  p_kind text,
  p_role text,
  p_provenance text,
  p_required boolean,
  p_proof_eligible boolean,
  p_storage_path text,
  p_mime_type text,
  p_width integer default null,
  p_height integer default null,
  p_content_hash text default null,
  p_source_slot_id text default null,
  p_poster_slot_id text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_job public.background_jobs%rowtype;
  result_id uuid;
begin
  select * into claimed_job
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

  update public.site_generation_media_slots set
    asset_id = p_content_hash,
    status = 'ready',
    storage_path = p_storage_path,
    mime_type = p_mime_type,
    width = p_width,
    height = p_height,
    content_hash = p_content_hash,
    error_message = null,
    abandoned_at = null,
    version_id = null
  where job_id = p_job_id
    and website_id = p_website_id
    and slot_id = p_slot_id
    and status = 'generating'
    and claim_attempt = p_job_attempts
    and kind = p_kind
    and role = p_role
    and provenance = p_provenance
    and required = p_required
    and proof_eligible = p_proof_eligible
    and source_slot_id is not distinct from p_source_slot_id
    and poster_slot_id is not distinct from p_poster_slot_id
  returning id into result_id;

  if result_id is null then raise exception 'Media slot claim was lost before ready'; end if;
  return result_id;
end;
$$;

revoke all on function public.record_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text, integer, integer, text, text, text) from public;
grant execute on function public.record_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text, integer, integer, text, text, text) to service_role;

