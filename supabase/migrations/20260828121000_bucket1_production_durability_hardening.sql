-- Bucket 1 production durability closure: epoch-2 generation is fenced, validated, and atomic.
-- Forward-only: historical epoch-1/schema-2/schema-3 data remains readable through historical paths.

-- Per-stage retry accounting is distinct from interruption, writer-repair, provider-create,
-- and finalization accounting. The scalar stage_attempts remains a compatibility projection.
alter table public.background_jobs
  add column if not exists stage_attempt_counts jsonb not null default '{}'::jsonb;

alter table public.background_jobs
  drop constraint if exists background_jobs_stage_attempt_counts_check,
  add constraint background_jobs_stage_attempt_counts_check check (
    jsonb_typeof(stage_attempt_counts) = 'object'
    and not jsonb_path_exists(stage_attempt_counts, '$.* ? (@.type() != "number" || @ < 0 || @ > 2147483647 || @ % 1 != 0)')
    and not jsonb_path_exists(stage_attempt_counts, '$.keyvalue() ? (!(@.key == "context" || @.key == "planning" || @.key == "media" || @.key == "composition" || @.key == "validation" || @.key == "persistence"))')
  ) not valid;

alter table public.background_jobs
  validate constraint background_jobs_stage_attempt_counts_check;

comment on column public.background_jobs.stage_attempt_counts is
  'Epoch-2 per-stage attempt counters. Keys are generation cursor stages; orthogonal interruption, repair, provider-create, and finalization budgets remain separate.';

-- Reuse the handoff message as the exactly-once terminal projection/outbox record. These
-- columns make the projection identity and payload explicit and auditable without another queue.
alter table public.background_jobs
  add column if not exists generation_terminal_message_id uuid references public.messages(id) on delete restrict,
  add column if not exists generation_terminal_message_payload jsonb;

alter table public.background_jobs
  drop constraint if exists background_jobs_generation_terminal_projection_check,
  add constraint background_jobs_generation_terminal_projection_check check (
    job_type <> 'site_generation'
    or generation_contract_epoch is distinct from 2
    or generation_terminal_message_at is null
    or (
      generation_terminal_message_id is not null
      and generation_terminal_message_payload is not null
      and jsonb_typeof(generation_terminal_message_payload) = 'object'
    )
  ) not valid;

alter table public.background_jobs
  validate constraint background_jobs_generation_terminal_projection_check;

comment on column public.background_jobs.generation_terminal_message_id is
  'Exactly-once epoch-2 terminal projection identity; reuses the accepted handoff message row.';
comment on column public.background_jobs.generation_terminal_message_payload is
  'Durable terminal projection/outbox payload committed with the epoch-2 finalizer.';

-- Canonical JSON mirrors the validator's recursively key-sorted compact encoding. It is kept
-- internal and used only for deterministic binding/attestation hashes.
create or replace function public.bucket1_canonical_json(p_value jsonb)
returns text language plpgsql immutable strict parallel safe set search_path=public as $$
declare result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{'||coalesce(string_agg(to_jsonb(entry.key)::text||':'||public.bucket1_canonical_json(entry.value),',' order by entry.key),'')||'}'
      into result from jsonb_each(p_value) entry;
    when 'array' then
      select '['||coalesce(string_agg(public.bucket1_canonical_json(item.value),',' order by item.ordinality),'')||']'
      into result from jsonb_array_elements(p_value) with ordinality item(value,ordinality);
    else result := p_value::text;
  end case;
  return result;
end;
$$;

create or replace function public.bucket1_canonical_hash(p_value jsonb)
returns text language sql immutable strict parallel safe set search_path=public as $$
  select encode(extensions.digest(convert_to(public.bucket1_canonical_json(p_value),'UTF8'),'sha256'),'hex');
$$;
revoke all on function public.bucket1_canonical_json(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.bucket1_canonical_hash(jsonb) from public,anon,authenticated,service_role;
comment on function public.bucket1_canonical_hash(jsonb) is
  'Internal recursive key-sorted canonical JSON SHA-256 used by the Bucket 1 validation contract.';

-- The media ledger gets the bigint generation ownership fence. Legacy add-video continues to
-- use claim_attempt; epoch-2 site generation mutators below use claim_epoch only.
alter table public.site_generation_media_slots
  add column if not exists claim_epoch bigint,
  add column if not exists effect_certainty text not null default 'none';

alter table public.site_generation_media_slots
  drop constraint if exists site_generation_media_slots_claim_epoch_check,
  add constraint site_generation_media_slots_claim_epoch_check
    check (claim_epoch is null or claim_epoch >= 0) not valid;

alter table public.site_generation_media_slots
  drop constraint if exists site_generation_media_slots_effect_certainty_check,
  add constraint site_generation_media_slots_effect_certainty_check
    check (effect_certainty in ('none','not_started','definite_failure','definite_success','indeterminate')) not valid;

alter table public.site_generation_media_slots
  validate constraint site_generation_media_slots_claim_epoch_check,
  validate constraint site_generation_media_slots_effect_certainty_check;

comment on column public.site_generation_media_slots.claim_epoch is
  'Epoch-2 site-generation ownership fence. claim_attempt is retained only for historical/add-video paths.';

-- -----------------------------------------------------------------------------
-- Retire browser ownership and stale settlement/finalization overloads.
-- Historical versions retain readers/renderers, never a historical execution owner.
-- -----------------------------------------------------------------------------
revoke all on function public.claim_site_generation_stage(uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
drop function if exists public.claim_site_generation_stage(uuid,text,timestamptz);

do $drop_stale_settle_overloads$
declare stale regprocedure;
begin
  for stale in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'settle_site_generation_epoch'
      and not exists (
        select 1
        from unnest(coalesce(p.proargnames, array[]::text[])) arg(name)
        where arg.name = 'p_budget_type'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', stale);
    execute format('drop function %s', stale);
  end loop;
end
$drop_stale_settle_overloads$;

-- Different integer/bigint vectors are overloads in PostgreSQL; explicitly remove the old
-- attempts-authoritative generated-version writers. Historical schema-2/3 rows remain data.
revoke all on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,integer,uuid[])
  from public, anon, authenticated, service_role;
drop function if exists public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,integer,uuid[]);
revoke all on function public.insert_generated_website_version(uuid,jsonb,uuid,integer)
  from public, anon, authenticated, service_role;

-- Legacy attempts-fenced media routines remain for add_video/history, but may never mutate an
-- epoch-2 site-generation job. The epoch-native APIs are the only production path for epoch 2.
create or replace function public.require_epoch2_generation_media_owner(
  p_job_id uuid,
  p_website_id uuid,
  p_claim_epoch bigint,
  p_runner_id text default null
) returns public.background_jobs
language plpgsql security definer set search_path = public as $$
declare owned_job public.background_jobs%rowtype;
begin
  select * into owned_job
  from public.background_jobs
  where id = p_job_id
  for update;

  if not found
     or owned_job.website_id <> p_website_id
     or owned_job.job_type <> 'site_generation'
     or owned_job.generation_contract_epoch <> 2
     or owned_job.status <> 'running'
     or owned_job.claim_epoch <> p_claim_epoch
     or owned_job.lease_expires_at is null
     or owned_job.lease_expires_at <= clock_timestamp()
     or nullif(btrim(owned_job.locked_by), '') is null
     or (p_runner_id is not null and owned_job.locked_by <> p_runner_id) then
    raise exception 'Generation media ownership was lost' using errcode = '40001';
  end if;

  return owned_job;
end;
$$;

revoke all on function public.require_epoch2_generation_media_owner(uuid,uuid,bigint,text)
  from public, anon, authenticated, service_role;
comment on function public.require_epoch2_generation_media_owner(uuid,uuid,bigint,text) is
  'Internal row-locking authority check for epoch-2 generation media effects; not directly executable.';

-- One set-based plan write: the complete accepted slot plan is durable before provider effects.
create or replace function public.plan_generation_media_slots_epoch(
  p_job_id uuid,
  p_website_id uuid,
  p_claim_epoch bigint,
  p_slots jsonb,
  p_runner_id text default null
) returns uuid[]
language plpgsql security definer set search_path = public as $$
declare
  owned_job public.background_jobs%rowtype;
  slot_value jsonb;
  result_ids uuid[] := array[]::uuid[];
  result_id uuid;
  supplied_count integer;
begin
  owned_job := public.require_epoch2_generation_media_owner(
    p_job_id,p_website_id,p_claim_epoch,p_runner_id
  );
  if owned_job.generation_stage not in ('media','composition','validation','persistence')
     or jsonb_typeof(p_slots) is distinct from 'array' then
    raise exception 'Invalid epoch generation media plan' using errcode = '22023';
  end if;
  supplied_count := jsonb_array_length(p_slots);
  if supplied_count > 128
     or exists (
       select 1 from jsonb_array_elements(p_slots) item
       where jsonb_typeof(item) <> 'object'
          or nullif(item->>'slot_id','') is null
          or item->>'kind' not in ('image','video')
          or item->>'role' not in ('hero','proof','support','atmosphere','texture','motion-poster')
          or item->>'provenance' not in ('evidence','generated')
          or jsonb_typeof(item->'required') <> 'boolean'
          or jsonb_typeof(item->'proof_eligible') <> 'boolean'
     )
     or exists (
       select item->>'slot_id' from jsonb_array_elements(p_slots) item
       group by item->>'slot_id' having count(*) <> 1
     ) then
    raise exception 'Invalid epoch generation media plan' using errcode = '22023';
  end if;

  for slot_value in select value from jsonb_array_elements(p_slots) loop
    insert into public.site_generation_media_slots(
      job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,
      status,source_slot_id,poster_slot_id,claim_epoch
    ) values (
      p_job_id,p_website_id,slot_value->>'slot_id',slot_value->>'kind',
      slot_value->>'role',slot_value->>'provenance',(slot_value->>'required')::boolean,
      (slot_value->>'proof_eligible')::boolean,'planned',
      nullif(slot_value->>'source_slot_id',''),nullif(slot_value->>'poster_slot_id',''),p_claim_epoch
    ) on conflict(job_id,slot_id) do update set claim_epoch = excluded.claim_epoch
      where site_generation_media_slots.website_id = excluded.website_id
        and site_generation_media_slots.kind = excluded.kind
        and site_generation_media_slots.role = excluded.role
        and site_generation_media_slots.provenance = excluded.provenance
        and site_generation_media_slots.required = excluded.required
        and site_generation_media_slots.proof_eligible = excluded.proof_eligible
        and site_generation_media_slots.source_slot_id is not distinct from excluded.source_slot_id
        and site_generation_media_slots.poster_slot_id is not distinct from excluded.poster_slot_id
        and site_generation_media_slots.status in ('planned','failed','abandoned','generating','ready')
    returning id into result_id;
    if result_id is null then
      raise exception 'Persisted media slot does not match the accepted plan' using errcode = 'P0001';
    end if;
    result_ids := array_append(result_ids,result_id);
  end loop;

  if exists (
    select 1 from public.site_generation_media_slots slot
    where slot.job_id = p_job_id and slot.website_id = p_website_id
      and slot.status not in ('attached','abandoned')
      and not exists (
        select 1 from jsonb_array_elements(p_slots) item where item->>'slot_id' = slot.slot_id
      )
  ) then
    raise exception 'Accepted media plan cannot omit a live job slot' using errcode = 'P0001';
  end if;
  return result_ids;
end;
$$;

create or replace function public.claim_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,
  p_kind text,p_role text,p_provenance text default 'generated',p_required boolean default true,
  p_proof_eligible boolean default false,p_source_slot_id text default null,
  p_poster_slot_id text default null,p_runner_id text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare owned_job public.background_jobs%rowtype; result_id uuid;
begin
  owned_job := public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  if owned_job.generation_stage not in ('media','composition','validation','persistence') then
    raise exception 'Generation media stage is not active' using errcode = '40001';
  end if;
  insert into public.site_generation_media_slots(
    job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,status,
    claim_epoch,claimed_at,source_slot_id,poster_slot_id
  ) values (
    p_job_id,p_website_id,p_slot_id,p_kind,p_role,p_provenance,p_required,
    p_proof_eligible,'generating',p_claim_epoch,clock_timestamp(),p_source_slot_id,p_poster_slot_id
  ) on conflict(job_id,slot_id) do update set
    status='generating',claim_epoch=excluded.claim_epoch,claimed_at=clock_timestamp(),error_message=null
  where site_generation_media_slots.website_id=excluded.website_id
    and (site_generation_media_slots.status in ('planned','failed','abandoned')
      or (site_generation_media_slots.status='generating'
        and coalesce(site_generation_media_slots.claim_epoch,-1) < excluded.claim_epoch))
    and site_generation_media_slots.kind=excluded.kind
    and site_generation_media_slots.role=excluded.role
    and site_generation_media_slots.provenance=excluded.provenance
    and site_generation_media_slots.required=excluded.required
    and site_generation_media_slots.proof_eligible=excluded.proof_eligible
    and site_generation_media_slots.source_slot_id is not distinct from excluded.source_slot_id
    and site_generation_media_slots.poster_slot_id is not distinct from excluded.poster_slot_id
  returning id into result_id;
  if result_id is null then raise exception 'Media slot cannot be claimed' using errcode='40001'; end if;
  return result_id;
end;
$$;

create or replace function public.reserve_generation_media_create_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,p_runner_id text default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare owned_job public.background_jobs%rowtype; result_count integer;
begin
  owned_job := public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  update public.site_generation_media_slots set
    provider_create_count=provider_create_count+1,provider_operation_id=null,
    status='generating',claim_epoch=p_claim_epoch,claimed_at=clock_timestamp(),error_message=null
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id
    and claim_epoch=p_claim_epoch and status='generating'
    and (provider_create_count=0 or (provider_operation_id is not null
      and retired_provider_operation_ids ? provider_operation_id))
    and provider_create_count < 2
  returning provider_create_count into result_count;
  if result_count is null then
    raise exception 'Provider create is not permitted for this epoch slot' using errcode='40001';
  end if;
  return result_count;
end;
$$;

create or replace function public.record_generation_media_operation_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,
  p_provider_operation_id text,p_effect_certainty text,p_runner_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare owned_job public.background_jobs%rowtype;
begin
  if nullif(btrim(p_provider_operation_id),'') is null
     or p_effect_certainty not in ('none','not_started','definite_failure','definite_success','indeterminate') then
    raise exception 'Provider operation identity and effect certainty are required' using errcode='22023';
  end if;
  owned_job := public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  update public.site_generation_media_slots set
    provider_operation_id=p_provider_operation_id
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id
    and claim_epoch=p_claim_epoch and status='generating'
    and (provider_operation_id is null or provider_operation_id=p_provider_operation_id);
  return found;
end;
$$;

create or replace function public.settle_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,p_status text,
  p_error_message text default null,p_effect_certainty text default 'none',p_runner_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare owned_job public.background_jobs%rowtype;
begin
  if p_status not in ('failed','abandoned')
     or p_effect_certainty not in ('none','not_started','definite_failure','definite_success','indeterminate') then
    raise exception 'Invalid epoch media settlement' using errcode='22023';
  end if;
  owned_job := public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  update public.site_generation_media_slots set
    status=p_status,error_message=p_error_message,effect_certainty=p_effect_certainty,
    retired_provider_operation_ids=case
      when provider_operation_id is not null and p_effect_certainty in ('definite_failure','definite_success')
        and not (retired_provider_operation_ids ? provider_operation_id)
      then retired_provider_operation_ids || jsonb_build_array(provider_operation_id)
      else retired_provider_operation_ids end,
    abandoned_at=case when p_status='abandoned' then clock_timestamp() else null end
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id
    and claim_epoch=p_claim_epoch and status='generating';
  return found;
end;
$$;

create or replace function public.record_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,
  p_kind text,p_role text,p_provenance text,p_required boolean,p_proof_eligible boolean,
  p_storage_path text,p_mime_type text,p_width integer default null,p_height integer default null,
  p_content_hash text default null,p_source_slot_id text default null,p_poster_slot_id text default null,
  p_byte_size bigint default null,p_duration_ms integer default null,p_video_codec text default null,
  p_video_profile text default null,p_has_audio boolean default null,p_audio_codec text default null,
  p_validator_version text default null,p_effect_certainty text default 'definite_success',
  p_runner_id text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare owned_job public.background_jobs%rowtype; result_id uuid;
begin
  if p_effect_certainty <> 'definite_success'
     or nullif(btrim(p_storage_path),'') is null
     or nullif(btrim(p_mime_type),'') is null
     or nullif(btrim(p_content_hash),'') is null then
    raise exception 'A definitely successful durable media asset is required' using errcode='22023';
  end if;
  owned_job := public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  update public.site_generation_media_slots set
    asset_id=p_content_hash,status='ready',storage_path=p_storage_path,mime_type=p_mime_type,
    width=p_width,height=p_height,content_hash=p_content_hash,byte_size=p_byte_size,duration_ms=p_duration_ms,
    video_codec=case when p_video_codec is null then null else lower(p_video_codec) end,
    video_profile=p_video_profile,has_audio=p_has_audio,audio_codec=p_audio_codec,
    validator_version=p_validator_version,error_message=null,effect_certainty='definite_success',
    abandoned_at=null,version_id=null
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id
    and claim_epoch=p_claim_epoch and status='generating'
    and slot_locked_by=p_runner_id and slot_lease_expires_at>clock_timestamp()
    and provider_reservation_id is not null and effect_certainty<>'indeterminate'
    and kind=p_kind and role=p_role and provenance=p_provenance
    and required=p_required and proof_eligible=p_proof_eligible
    and source_slot_id is not distinct from p_source_slot_id
    and poster_slot_id is not distinct from p_poster_slot_id
  returning id into result_id;
  if result_id is null then
    raise exception 'Media slot epoch claim was lost before ready' using errcode='40001';
  end if;
  return result_id;
end;
$$;

-- Attempts-only site-generation calls fail closed; add_video and historical epoch-1 callers keep
-- their established path. These wrappers prevent provider effects from bypassing claim_epoch.
create or replace function public.assert_legacy_media_job_allowed(p_job_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.background_jobs
    where id=p_job_id and job_type='site_generation' and generation_contract_epoch>=2
  ) then
    raise exception 'Current generation media requires claim_epoch authority' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.assert_legacy_media_job_allowed(uuid)
  from public, anon, authenticated, service_role;

-- Preserve legacy add-video/epoch-1 behavior behind attempts-fenced wrappers, while an
-- epoch-2 site-generation row is rejected before the legacy mutator can execute.
alter function public.plan_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text)
  rename to plan_generation_media_slot_legacy_attempt;
alter function public.claim_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text)
  rename to claim_generation_media_slot_legacy_attempt;
alter function public.reserve_generation_media_create(uuid,uuid,integer,text)
  rename to reserve_generation_media_create_legacy_attempt;
alter function public.record_generation_media_operation(uuid,uuid,integer,text,text)
  rename to record_generation_media_operation_legacy_attempt;
alter function public.settle_generation_media_slot(uuid,uuid,integer,text,text,text)
  rename to settle_generation_media_slot_legacy_attempt;
alter function public.record_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text)
  rename to record_generation_media_slot_legacy_attempt;

create function public.plan_generation_media_slot(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,p_kind text,p_role text,
  p_provenance text,p_required boolean,p_proof_eligible boolean,p_source_slot_id text default null,
  p_poster_slot_id text default null
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_legacy_media_job_allowed(p_job_id);
  return public.plan_generation_media_slot_legacy_attempt(p_job_id,p_website_id,p_job_attempts,p_slot_id,p_kind,p_role,p_provenance,p_required,p_proof_eligible,p_source_slot_id,p_poster_slot_id);
end; $$;

create function public.claim_generation_media_slot(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,p_kind text,p_role text,
  p_provenance text default 'generated',p_required boolean default true,p_proof_eligible boolean default false,
  p_source_slot_id text default null,p_poster_slot_id text default null
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_legacy_media_job_allowed(p_job_id);
  return public.claim_generation_media_slot_legacy_attempt(p_job_id,p_website_id,p_job_attempts,p_slot_id,p_kind,p_role,p_provenance,p_required,p_proof_eligible,p_source_slot_id,p_poster_slot_id);
end; $$;

create function public.reserve_generation_media_create(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text
) returns integer language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_legacy_media_job_allowed(p_job_id);
  return public.reserve_generation_media_create_legacy_attempt(p_job_id,p_website_id,p_job_attempts,p_slot_id);
end; $$;

create function public.record_generation_media_operation(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,p_provider_operation_id text
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_legacy_media_job_allowed(p_job_id);
  return public.record_generation_media_operation_legacy_attempt(p_job_id,p_website_id,p_job_attempts,p_slot_id,p_provider_operation_id);
end; $$;

create function public.settle_generation_media_slot(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,p_status text,p_error_message text default null
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_legacy_media_job_allowed(p_job_id);
  return public.settle_generation_media_slot_legacy_attempt(p_job_id,p_website_id,p_job_attempts,p_slot_id,p_status,p_error_message);
end; $$;

create function public.record_generation_media_slot(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,p_kind text,p_role text,
  p_provenance text,p_required boolean,p_proof_eligible boolean,p_storage_path text,p_mime_type text,
  p_width integer default null,p_height integer default null,p_content_hash text default null,
  p_source_slot_id text default null,p_poster_slot_id text default null,p_byte_size bigint default null,
  p_duration_ms integer default null,p_video_codec text default null,p_video_profile text default null,
  p_has_audio boolean default null,p_audio_codec text default null,p_validator_version text default null
) returns uuid language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_legacy_media_job_allowed(p_job_id);
  return public.record_generation_media_slot_legacy_attempt(
    p_job_id,p_website_id,p_job_attempts,p_slot_id,p_kind,p_role,p_provenance,p_required,
    p_proof_eligible,p_storage_path,p_mime_type,p_width,p_height,p_content_hash,p_source_slot_id,
    p_poster_slot_id,p_byte_size,p_duration_ms,p_video_codec,p_video_profile,p_has_audio,p_audio_codec,p_validator_version
  );
end; $$;

revoke all on function public.plan_generation_media_slot_legacy_attempt(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_generation_media_slot_legacy_attempt(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text) from public,anon,authenticated,service_role;
revoke all on function public.reserve_generation_media_create_legacy_attempt(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.record_generation_media_operation_legacy_attempt(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
revoke all on function public.settle_generation_media_slot_legacy_attempt(uuid,uuid,integer,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.record_generation_media_slot_legacy_attempt(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text) from public,anon,authenticated,service_role;

revoke all on function public.plan_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text) from public,anon,authenticated;
revoke all on function public.claim_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text) from public,anon,authenticated;
revoke all on function public.reserve_generation_media_create(uuid,uuid,integer,text) from public,anon,authenticated;
revoke all on function public.record_generation_media_operation(uuid,uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.settle_generation_media_slot(uuid,uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.record_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.plan_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text) to service_role;
grant execute on function public.claim_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text) to service_role;
grant execute on function public.reserve_generation_media_create(uuid,uuid,integer,text) to service_role;
grant execute on function public.record_generation_media_operation(uuid,uuid,integer,text,text) to service_role;
grant execute on function public.settle_generation_media_slot(uuid,uuid,integer,text,text,text) to service_role;
grant execute on function public.record_generation_media_slot(uuid,uuid,integer,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text) to service_role;

-- Per-stage scalar compatibility projection: workers still reading stage_attempts see only the
-- current cursor's budget, never a lifetime total carried from another stage.
create or replace function public.refresh_generation_stage_attempt_projection()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.job_type='site_generation' and new.generation_contract_epoch=2 then
    new.stage_attempts := coalesce((new.stage_attempt_counts->>new.generation_stage)::integer,0);
  end if;
  return new;
end; $$;
revoke all on function public.refresh_generation_stage_attempt_projection() from public,anon,authenticated;
drop trigger if exists background_jobs_refresh_generation_stage_attempt_projection on public.background_jobs;
create trigger background_jobs_refresh_generation_stage_attempt_projection
before insert or update of generation_stage,stage_attempt_counts on public.background_jobs
for each row execute function public.refresh_generation_stage_attempt_projection();
comment on function public.refresh_generation_stage_attempt_projection() is
  'Maintains stage_attempts as the current-stage compatibility projection of stage_attempt_counts.';

-- Finalize ordinary monotonic yield validation without changing its public identity.
create or replace function public.yield_site_generation_stage_epoch(
  p_job_id uuid,p_claim_epoch bigint,p_contract_epoch integer,p_stage text,p_checkpoint jsonb,
  p_progress_pct integer,p_status_message text,p_event_key text,p_runner_id text default null,
  p_invocation_id uuid default null,p_deployment_id text default null
) returns boolean
language plpgsql security definer set search_path=public as $$
declare current_job public.background_jobs%rowtype; completed_stage text; next_attempt integer;
begin
  if p_contract_epoch<>2 or p_stage not in ('context','planning','media','composition','validation','persistence')
     or jsonb_typeof(p_checkpoint) is distinct from 'object'
     or octet_length(convert_to(p_checkpoint::text,'UTF8'))>2097152
     or p_checkpoint->>'schemaVersion'<>'2' or p_checkpoint->>'stage' is distinct from p_stage
     or p_progress_pct<0 or p_progress_pct>99 or nullif(btrim(p_event_key),'') is null then
    raise exception 'Invalid site generation yield' using errcode='22023';
  end if;
  select * into current_job from public.background_jobs where id=p_job_id and job_type='site_generation' for update;
  if not found or current_job.status<>'running' or current_job.generation_contract_epoch<>2
     or current_job.claim_epoch<>p_claim_epoch or current_job.lease_expires_at<=clock_timestamp()
     or nullif(btrim(current_job.locked_by),'') is null
     or (p_runner_id is not null and current_job.locked_by<>p_runner_id)
     or p_checkpoint->'input' is distinct from current_job.generation_input_snapshot
     or p_checkpoint->>'inputHash' is distinct from current_job.generation_input_hash
     or (p_checkpoint->>'acceptedAt')::timestamptz is distinct from current_job.generation_accepted_at
     or not ((current_job.generation_stage='context' and p_stage='planning')
       or (current_job.generation_stage='planning' and p_stage='media')
       or (current_job.generation_stage='media' and p_stage in ('media','composition'))
       or (current_job.generation_stage='composition' and p_stage='validation')
       or (current_job.generation_stage='validation' and p_stage='persistence')) then
    return false;
  end if;
  completed_stage:=current_job.generation_stage;
  next_attempt:=coalesce((current_job.stage_attempt_counts->>p_stage)::integer,0);
  update public.background_jobs set status='pending',locked_at=null,locked_by=null,lease_expires_at=null,
    next_retry_at=clock_timestamp(),completed_at=null,progress_pct=p_progress_pct,status_message=p_status_message,
    generation_stage=p_stage,generation_checkpoint=p_checkpoint,stage_attempts=next_attempt,
    payload_json=(payload_json-'executionMode')||jsonb_build_object('generationMode','unified','generationContractVersion',2,'generationStage',p_stage)
  where id=p_job_id;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,event_type,
    effect_certainty,disposition,severity,blocking,runner_id,invocation_id,deployment_id,completed_at,details
  ) values(p_event_key,p_job_id,current_job.website_id,current_job.generation_request_id,2,p_claim_epoch,
    p_stage,next_attempt,'yielded','not_started','resume','info',false,current_job.locked_by,p_invocation_id,
    p_deployment_id,clock_timestamp(),jsonb_build_object('completedStage',completed_stage,'nextStage',p_stage))
  on conflict(event_key) do nothing;
  return true;
end; $$;
revoke all on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text) to service_role;
comment on function public.yield_site_generation_stage_epoch(uuid,bigint,integer,text,jsonb,integer,text,text,text,uuid,text) is
  'Service-only monotonic epoch-2 stage yield with immutable checkpoint envelope validation and per-stage budget projection.';

-- Current settle signature only: p_budget_type is mandatory in the identity and service-only.
create or replace function public.settle_site_generation_epoch(
  p_job_id uuid,p_claim_epoch bigint,p_contract_epoch integer,p_status text,p_progress_pct integer,
  p_result_json jsonb,p_checkpoint jsonb,p_error_message text,p_status_message text,
  p_next_retry_at timestamptz,p_effect_certainty text,p_cause_code text,p_event_key text,
  p_budget_type text,p_runner_id text default null,p_invocation_id uuid default null,
  p_deployment_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  current_job public.background_jobs%rowtype;
  prior_stage text;
  requested_stage text;
  stage_before integer;
  stage_after integer;
  event_type_value text;
  disposition_value text;
  terminal_payload jsonb;
  terminal_text text;
begin
  if p_contract_epoch <> 2
     or p_status not in ('pending','failed')
     or p_progress_pct < 0 or p_progress_pct > 100
     or jsonb_typeof(p_checkpoint) is distinct from 'object'
     or octet_length(convert_to(p_checkpoint::text,'UTF8')) > 2097152
     or p_checkpoint->>'schemaVersion' <> '2'
     or p_checkpoint->>'stage' not in ('context','planning','media','composition','validation','persistence')
     or p_effect_certainty not in ('none','not_started','definite_failure','indeterminate')
     or nullif(btrim(p_event_key),'') is null
     or p_budget_type not in ('interruption','stage_attempt','writer_repair')
     or (p_status='pending' and p_next_retry_at is null)
     or (p_status='failed' and p_next_retry_at is not null) then
    raise exception 'Invalid site generation settlement' using errcode='22023';
  end if;

  select * into current_job from public.background_jobs where id=p_job_id for update;
  if not found
     or current_job.job_type <> 'site_generation'
     or current_job.status <> 'running'
     or current_job.generation_contract_epoch <> 2
     or current_job.claim_epoch <> p_claim_epoch
     or current_job.lease_expires_at is null
     or current_job.lease_expires_at <= clock_timestamp()
     or nullif(btrim(current_job.locked_by),'') is null
     or (p_runner_id is not null and current_job.locked_by <> p_runner_id)
     or p_checkpoint->'input' is distinct from current_job.generation_input_snapshot
     or p_checkpoint->>'inputHash' is distinct from current_job.generation_input_hash
     or (p_checkpoint->>'acceptedAt')::timestamptz is distinct from current_job.generation_accepted_at then
    return false;
  end if;

  prior_stage := current_job.generation_stage;
  requested_stage := p_checkpoint->>'stage';
  if not (
    requested_stage=prior_stage
    or (prior_stage='validation' and requested_stage='composition'
      and p_status='pending' and p_budget_type='writer_repair'
      and jsonb_typeof(p_checkpoint->'defects')='array'
      and jsonb_array_length(p_checkpoint->'defects')>0)
  ) then
    return false;
  end if;

  stage_before := coalesce((current_job.stage_attempt_counts->>requested_stage)::integer,0);
  stage_after := stage_before + case when p_budget_type='stage_attempt' then 1 else 0 end;
  if p_status='pending' and (
       (p_budget_type='stage_attempt' and stage_after>=3)
       or (p_budget_type='writer_repair' and current_job.repair_attempts+1>=3)
       or (p_budget_type='interruption' and current_job.interruption_count+1>=5)
     ) then
    p_status := 'failed';
    p_next_retry_at := null;
    p_status_message := 'Generation retry budget exhausted';
  end if;
  if p_status='failed' then
    terminal_text := 'We could not finish this website. Please try again.';
    terminal_payload := jsonb_build_object(
      'schemaVersion',1,'kind','site-generation-terminal','status','failed',
      'jobId',p_job_id,'requestId',current_job.generation_request_id,
      'claimEpoch',p_claim_epoch,'message',terminal_text,'causeCode',p_cause_code
    );
    update public.messages set content=terminal_text
    where id=current_job.generation_handoff_message_id
      and trace_id=current_job.agent_trace_id and role='assistant';
    if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;
    update public.agent_traces set status='error',error_message=left(p_error_message,1000),
      completed_at=coalesce(completed_at,clock_timestamp())
    where id=current_job.agent_trace_id and website_id=current_job.website_id
      and status in ('running','completed','error');
    if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;
  end if;

  update public.background_jobs set
    status=p_status,progress_pct=p_progress_pct,result_json=p_result_json,
    generation_stage=requested_stage,generation_checkpoint=p_checkpoint,
    error_message=p_error_message,status_message=p_status_message,
    completed_at=case when p_status='failed' then clock_timestamp() else null end,
    next_retry_at=p_next_retry_at,locked_at=null,locked_by=null,lease_expires_at=null,
    interruption_count=interruption_count + case when p_budget_type='interruption' then 1 else 0 end,
    stage_attempts=stage_after,
    stage_attempt_counts=case when p_budget_type='stage_attempt'
      then jsonb_set(stage_attempt_counts,array[requested_stage],to_jsonb(stage_after),true)
      else stage_attempt_counts end,
    repair_attempts=repair_attempts + case when p_budget_type='writer_repair' then 1 else 0 end,
    generation_terminal_message_id=case when p_status='failed' then current_job.generation_handoff_message_id else generation_terminal_message_id end,
    generation_terminal_message_payload=case when p_status='failed' then terminal_payload else generation_terminal_message_payload end,
    generation_terminal_message_at=case when p_status='failed' then clock_timestamp() else generation_terminal_message_at end
  where id=p_job_id;

  event_type_value := case when p_status='failed' then 'failed' else 'retry_scheduled' end;
  disposition_value := case when p_status='failed' then 'terminal_failure' else 'retry' end;
  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,budget_type,
    budget_before,budget_after,runner_id,invocation_id,deployment_id,completed_at,details
  ) values (
    p_event_key,current_job.id,current_job.website_id,current_job.generation_request_id,2,p_claim_epoch,
    requested_stage,stage_after,event_type_value,p_cause_code,p_effect_certainty,disposition_value,
    case when p_status='failed' then 'error' else 'info' end,p_status='failed',p_budget_type,
    case p_budget_type when 'interruption' then current_job.interruption_count
      when 'writer_repair' then current_job.repair_attempts else stage_before end,
    case p_budget_type when 'interruption' then current_job.interruption_count+1
      when 'writer_repair' then current_job.repair_attempts+1 else stage_after end,
    current_job.locked_by,p_invocation_id,p_deployment_id,clock_timestamp(),
    jsonb_build_object('priorStage',prior_stage,'requestedStage',requested_stage)
  ) on conflict(event_key) do nothing;
  return true;
end;
$$;

revoke all on function public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text)
  to service_role;
comment on function public.settle_site_generation_epoch(uuid,bigint,integer,text,integer,jsonb,jsonb,text,text,timestamptz,text,text,text,text,text,uuid,text) is
  'Service-only epoch-2 retry/failure settlement. Success is exclusive to the atomic version finalizer. Validation repair may rewind only validation to composition; ordinary same-stage yield remains monotonic.';

-- Epoch-2 attestation binding uses the closed application envelope. SQL validates the immutable
-- cross-layer hashes and deterministic envelope hash. Signature trust has already been established
-- by the server validator that wrote the checkpoint; the database never stores or invents a key.
create or replace function public.insert_generated_website_version_with_slots(
  p_website_id uuid,p_config_json jsonb,p_job_id uuid,p_claim_epoch bigint,p_media_slot_ids uuid[]
) returns table(id uuid,version_number integer,variant_key text)
language plpgsql security definer set search_path = public as $$
declare
  claimed_job public.background_jobs%rowtype;
  replay_version public.website_versions%rowtype;
  checkpoint jsonb;
  attestation jsonb;
  binding jsonb;
  manifest_slots jsonb;
  terminal_payload jsonb;
  next_number integer;
  new_version_id uuid;
  new_variant_key text;
  supplied_count integer;
  distinct_count integer;
  matched_count integer;
  attestation_secret text;
  attestation_key_id text;
  final_text text := 'Your website is ready to review.';
begin
  if p_website_id is null or p_job_id is null or p_claim_epoch is null
     or p_media_slot_ids is null or jsonb_typeof(p_config_json) <> 'object' then
    raise exception 'A generation job, config, and media slot array are required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text,0));
  select * into claimed_job from public.background_jobs where id=p_job_id for update;
  if not found or claimed_job.website_id<>p_website_id or claimed_job.job_type<>'site_generation'
     or claimed_job.generation_contract_epoch<>2 or claimed_job.claim_epoch<>p_claim_epoch
     or not exists(
       select 1 from public.websites website
       where website.id=p_website_id and website.user_id=claimed_job.generation_tenant_id
     )
     or not exists(
       select 1 from public.agent_traces trace
       where trace.id=claimed_job.agent_trace_id and trace.website_id=p_website_id
         and trace.profile_id=claimed_job.generation_tenant_id
         and trace.request_id=claimed_job.generation_request_id
     )
     or (claimed_job.generation_kind='regeneration' and not exists(
       select 1 from public.website_versions source_version
       where source_version.id=claimed_job.source_version_id and source_version.website_id=p_website_id
     )) then
    raise exception 'Generation job, ownership, or source authorization is no longer authoritative' using errcode='40001';
  end if;

  select * into replay_version from public.website_versions
  where generation_job_id=p_job_id for update;
  if found then
    if claimed_job.status<>'completed'
       or claimed_job.generation_result_version_id is distinct from replay_version.id
       or claimed_job.generation_terminal_message_at is null
       or claimed_job.generation_terminal_message_id is distinct from claimed_job.generation_handoff_message_id
       or claimed_job.generation_terminal_message_payload is null then
      raise exception 'Generation replay state is inconsistent' using errcode='P0001';
    end if;
    return query select replay_version.id,replay_version.version_number,replay_version.variant_key;
    return;
  end if;

  checkpoint := claimed_job.generation_checkpoint;
  attestation := checkpoint->'validationAttestation';
  binding := attestation->'binding';
  select decrypted_secret into attestation_secret from vault.decrypted_secrets
    where name='BUCKET1_ATTESTATION_SECRET' limit 1;
  select decrypted_secret into attestation_key_id from vault.decrypted_secrets
    where name='BUCKET1_ATTESTATION_KEY_ID' limit 1;
  if claimed_job.status<>'running' or claimed_job.generation_stage<>'persistence'
     or claimed_job.lease_expires_at is null or claimed_job.lease_expires_at<=clock_timestamp()
     or nullif(btrim(claimed_job.locked_by),'') is null
     or checkpoint->>'schemaVersion'<>'2' or checkpoint->>'stage'<>'persistence'
     or checkpoint->'input' is distinct from claimed_job.generation_input_snapshot
     or checkpoint->>'inputHash' is distinct from claimed_job.generation_input_hash
     or (checkpoint->>'acceptedAt')::timestamptz is distinct from claimed_job.generation_accepted_at
     or checkpoint->'candidateConfig' is distinct from p_config_json
     or p_config_json->>'generator' is distinct from 'unified-site-agent'
     or p_config_json->>'generatorSchemaVersion' is distinct from '4'
     or jsonb_typeof(attestation) is distinct from 'object'
     or attestation->>'schemaVersion' is distinct from '1'
     or attestation->>'kind' is distinct from 'bucket1-validation-attestation'
     or jsonb_typeof(binding) is distinct from 'object'
     or binding->>'generationContractEpoch' is distinct from '2'
     or binding->>'contextHash' is distinct from claimed_job.generation_input_hash
     or binding->>'candidateRevision' is distinct from checkpoint->>'candidateRevision'
     or binding->>'candidateConfigHash' is distinct from public.bucket1_canonical_hash(
          p_config_json - 'bucket1ValidationInput' - 'bucket1ValidationAttestation' - 'validationAttestation'
        )
     or binding->>'sourceHash' is distinct from checkpoint->>'candidateSourceHash'
     or binding->>'sourceHash' is distinct from encode(extensions.digest(convert_to(p_config_json->>'themeSource','UTF8'),'sha256'),'hex')
     or binding->>'manifestHash' is distinct from public.bucket1_canonical_hash(p_config_json->'mediaManifest')
     or binding->>'operationalPlanHash' is distinct from public.bucket1_canonical_hash(p_config_json->'unifiedPlan')
     or binding->>'hostContractHash' is distinct from '56252b35bf3aa5965c9137fab8a1a4e181d6e9b275856dcb33767fbcadea4f85'
     or binding->>'validationContractHash' is distinct from '765f8d655208a5228f55b2e7316edf780b1f08c9e4810d7d839f21ef6ed58c10'
     or binding->>'candidateBindingHash' !~ '^[0-9a-f]{64}$'
     or attestation->>'runtimeEvidenceHash' !~ '^[0-9a-f]{64}$'
     or attestation->>'attestationHash' !~ '^[0-9a-f]{64}$'
     or attestation->>'signature' !~ '^[0-9a-f]{64}$'
     or nullif(attestation_secret,'') is null
     or length(attestation_secret)<32
     or nullif(attestation_key_id,'') is null
     or attestation->>'issuerKeyId' is distinct from attestation_key_id
     or attestation->>'signature' is distinct from encode(extensions.hmac(
          convert_to(attestation->>'attestationHash','UTF8'),
          convert_to(attestation_secret,'UTF8'),'sha256'
        ),'hex')
     or nullif(attestation->>'issuedAt','') is null
     or nullif(attestation->>'expiresAt','') is null
     or (attestation->>'issuedAt')::timestamptz > clock_timestamp()
     or (attestation->>'expiresAt')::timestamptz <= clock_timestamp()
     or (attestation->>'expiresAt')::timestamptz > (attestation->>'issuedAt')::timestamptz + interval '24 hours'
     or public.bucket1_canonical_hash(attestation - 'attestationHash' - 'signature')
          is distinct from attestation->>'attestationHash' then
    raise exception 'Schema-v4 persistence requires the current valid deterministic attestation' using errcode='P0001';
  end if;

  select count(*),count(distinct supplied.slot_uuid) into supplied_count,distinct_count
  from unnest(p_media_slot_ids) supplied(slot_uuid);
  if supplied_count<>distinct_count then raise exception 'Media slot IDs must be unique' using errcode='22023'; end if;
  manifest_slots := p_config_json#>'{mediaManifest,slots}';
  if jsonb_typeof(manifest_slots) is distinct from 'array'
     or jsonb_array_length(manifest_slots)<>supplied_count then
    raise exception 'Unified v4 config is missing a complete media manifest' using errcode='22023';
  end if;

  perform 1 from public.site_generation_media_slots slot
  where slot.job_id=p_job_id order by slot.id for update;
  select count(*) into matched_count from public.site_generation_media_slots slot
  where slot.id=any(p_media_slot_ids) and slot.job_id=p_job_id and slot.website_id=p_website_id
    and slot.status='ready';
  if matched_count<>supplied_count then
    raise exception 'Media slots are stale, missing, or not ready under this claim epoch' using errcode='P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(manifest_slots) item
    left join public.site_generation_media_slots slot
      on slot.id=any(p_media_slot_ids) and slot.slot_id=item->>'slotId'
    where slot.id is null or nullif(item->>'slotId','') is null
      or slot.asset_id is distinct from item->>'assetId'
      or slot.mime_type is distinct from item->>'mimeType'
      or slot.role is distinct from item->>'role'
      or slot.provenance is distinct from item->>'origin'
      or slot.required is distinct from coalesce((item->>'required')::boolean,false)
      or slot.proof_eligible is distinct from coalesce((item->>'proofEligible')::boolean,false)
      or slot.source_slot_id is distinct from nullif(item->>'sourceSlotId','')
      or slot.poster_slot_id is distinct from nullif(item->>'posterSlotId','')
      or slot.storage_path is distinct from item->>'storagePath'
  ) or exists (
    select item->>'slotId' from jsonb_array_elements(manifest_slots) item
    group by item->>'slotId' having count(*)<>1
  ) or exists (
    select 1 from public.site_generation_media_slots slot
    where slot.job_id=p_job_id and slot.website_id=p_website_id and slot.required
      and (not (slot.id=any(p_media_slot_ids)) or slot.status<>'ready')
  ) then
    raise exception 'Validated manifest does not exactly match the ready epoch ledger' using errcode='P0001';
  end if;

  select coalesce(max(v.version_number),0)+1 into next_number
  from public.website_versions v where v.website_id=p_website_id;
  new_variant_key := p_config_json->>'variantKey';
  if nullif(btrim(new_variant_key),'') is null then
    raise exception 'Validated candidate is missing its reserved variant identity' using errcode='P0001';
  end if;
  insert into public.website_versions(website_id,version_number,config_json,variant_key,status,revision,generation_job_id)
  values(p_website_id,next_number,p_config_json,new_variant_key,'draft',(checkpoint->>'candidateRevision')::integer,p_job_id)
  returning website_versions.id into new_version_id;

  insert into public.website_version_media_slots(
    version_id,website_id,slot_id,asset_id,mime_type,role,provenance,required,
    source_slot_id,poster_slot_id,storage_path,proof_eligible
  ) select new_version_id,s.website_id,s.slot_id,s.asset_id,s.mime_type,s.role,s.provenance,
      s.required,s.source_slot_id,s.poster_slot_id,s.storage_path,s.proof_eligible
    from public.site_generation_media_slots s where s.id=any(p_media_slot_ids);

  update public.site_generation_media_slots set status='attached',version_id=new_version_id
  where id=any(p_media_slot_ids) and job_id=p_job_id;
  update public.site_generation_media_slots set
    status='abandoned',error_message=coalesce(error_message,'Not selected by validated manifest'),
    abandoned_at=clock_timestamp()
  where job_id=p_job_id and website_id=p_website_id and version_id is null
    and not (id=any(p_media_slot_ids)) and status in ('planned','generating','failed','ready');

  terminal_payload := jsonb_build_object(
    'schemaVersion',1,'kind','site-generation-terminal','status','completed',
    'jobId',p_job_id,'requestId',claimed_job.generation_request_id,
    'claimEpoch',p_claim_epoch,'versionId',new_version_id,'message',final_text
  );
  update public.messages set content=final_text
  where id=claimed_job.generation_handoff_message_id
    and trace_id=claimed_job.agent_trace_id and role='assistant';
  if not found then raise exception 'Generation terminal projection target is missing' using errcode='P0001'; end if;

  update public.agent_traces set status='completed',error_message=null,
    completed_at=coalesce(completed_at,clock_timestamp())
  where id=claimed_job.agent_trace_id and website_id=p_website_id and status in ('running','completed');
  if not found then raise exception 'Generation agent trace binding is invalid' using errcode='P0001'; end if;

  update public.background_jobs set
    status='completed',progress_pct=100,status_message='Completed',error_message=null,
    result_json=jsonb_build_object('variantCount',1,'versionIds',jsonb_build_array(new_version_id)),
    generation_result_version_id=new_version_id,generation_stage='persistence',
    generation_terminal_message_id=claimed_job.generation_handoff_message_id,
    generation_terminal_message_payload=terminal_payload,generation_terminal_message_at=clock_timestamp(),
    completed_at=clock_timestamp(),next_retry_at=null,locked_at=null,locked_by=null,lease_expires_at=null
  where id=p_job_id and status='running' and generation_contract_epoch=2
    and claim_epoch=p_claim_epoch and locked_by=claimed_job.locked_by
    and lease_expires_at>clock_timestamp();
  if not found then raise exception 'Generation claim was lost before completion' using errcode='40001'; end if;

  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,effect_certainty,disposition,severity,blocking,completed_at,details
  ) values(
    p_job_id::text||':'||p_claim_epoch::text||':finalizer-completed',p_job_id,p_website_id,
    claimed_job.generation_request_id,2,p_claim_epoch,'persistence',
    coalesce((claimed_job.stage_attempt_counts->>'persistence')::integer,0),
    'completed','definite_success','terminal_success','info',false,clock_timestamp(),
    jsonb_build_object('versionId',new_version_id,'terminalMessageId',claimed_job.generation_handoff_message_id,
      'attestationHash',attestation->>'attestationHash')
  ) on conflict(event_key) do nothing;
  return query select new_version_id,next_number,new_variant_key;
end;
$$;

revoke all on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[])
  from public, anon, authenticated;
grant execute on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[])
  to service_role;
comment on function public.insert_generated_website_version_with_slots(uuid,jsonb,uuid,bigint,uuid[]) is
  'Sole epoch-2 success transition: claim-epoch/lease fenced, schema-v4 and current-attestation bound, atomically inserts version+attachments, settles slots/job/trace, and projects one terminal message.';

-- The post-finalizer chat helper is historical-only; epoch-2 finalization already projects its
-- terminal message in the same transaction and must never perform a second projection.
create or replace function public.settle_agent_site_generation_message(p_website_id uuid,p_chain_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if exists (
    select 1 from public.background_jobs
    where website_id=p_website_id and chain_id=p_chain_id and job_type='site_generation'
      and generation_contract_epoch>=2
  ) then return false; end if;
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Schema-v4 Add Video SQL guard: operational anchors, never legacy topology.
-- -----------------------------------------------------------------------------
create or replace function public.assert_add_video_source_eligible(
  p_website_id uuid,p_version_id uuid,p_config jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare
  manifest jsonb;
  anchors jsonb;
  theme_source text;
begin
  manifest := p_config#>'{mediaManifest,slots}';
  anchors := p_config#>'{unifiedPlan,operationalIntent,operationalAnchors}';
  theme_source := coalesce(p_config->>'themeSource','');
  if p_config->>'generator' is distinct from 'unified-site-agent'
     or p_config->>'generatorSchemaVersion' is distinct from '4'
     or jsonb_typeof(anchors) is distinct from 'array' or jsonb_array_length(anchors)=0
     or exists (
       select 1 from jsonb_array_elements(anchors) a
       where jsonb_typeof(a)<>'object' or nullif(a->>'slug','') is null
          or jsonb_typeof(a->'purposes')<>'array'
     )
     or exists (
       select a->>'slug' from jsonb_array_elements(anchors) a
       group by a->>'slug' having count(*)<>1
     )
     or exists (
       select 1 from jsonb_array_elements(anchors) a
       where (length(theme_source)-length(replace(theme_source,'data-site-section="'||a->>'slug'||'"','')))
         / greatest(length('data-site-section="'||a->>'slug'||'"'),1) <> 1
     )
     or theme_source ~ 'data-site-section[[:space:]]*=[[:space:]]*\{'
     or not exists (
       select 1 from jsonb_array_elements(anchors) a
       where exists (select 1 from jsonb_array_elements_text(a->'purposes') p where p in ('media','host-operation'))
     ) then
    raise exception 'Add Video requires schema-v4 operational anchors with literal unique markers' using errcode='22023';
  end if;
  if jsonb_typeof(manifest) is distinct from 'array'
     or jsonb_array_length(manifest)<>(select count(*) from public.website_version_media_slots
       where website_id=p_website_id and version_id=p_version_id)
     or exists (
       select 1 from jsonb_array_elements(manifest) m
       where (select count(*) from public.website_version_media_slots a
         where a.website_id=p_website_id and a.version_id=p_version_id
           and a.slot_id=m->>'slotId' and a.asset_id=m->>'assetId'
           and lower(a.mime_type)=lower(m->>'mimeType') and a.role=m->>'role'
           and a.provenance=m->>'origin' and a.storage_path=m->>'storagePath'
           and a.required=coalesce((m->>'required')::boolean,false)
           and a.proof_eligible=coalesce((m->>'proofEligible')::boolean,false)
           and a.source_slot_id is not distinct from nullif(m->>'sourceSlotId','')
           and a.poster_slot_id is not distinct from nullif(m->>'posterSlotId',''))<>1
     ) then
    raise exception 'Add Video schema-v4 manifest does not match operational attachments' using errcode='P0001';
  end if;
end;
$$;

-- Add Video remains attempts-fenced by its own job contract, but its source/candidate SQL guard
-- accepts only schema v4 and validates the selected target against operational anchors.
create or replace function public.assert_add_video_v4_candidate_anchor(
  p_job_id uuid,p_config_json jsonb
) returns void language plpgsql security definer set search_path=public as $$
declare target_anchor text; anchors jsonb; theme_source text;
begin
  target_anchor := (select payload_json#>>'{plan,targetSection}' from public.background_jobs where id=p_job_id);
  anchors := p_config_json#>'{unifiedPlan,operationalIntent,operationalAnchors}';
  theme_source := coalesce(p_config_json->>'themeSource','');
  if p_config_json->>'generatorSchemaVersion' is distinct from '4'
     or jsonb_typeof(anchors) is distinct from 'array'
     or nullif(target_anchor,'') is null
     or (select count(*) from jsonb_array_elements(anchors) a
         where a->>'slug'=target_anchor
           and exists(select 1 from jsonb_array_elements_text(a->'purposes') p where p in ('media','host-operation')))<>1
     or (length(theme_source)-length(replace(theme_source,'data-site-section="'||target_anchor||'"','')))
        / greatest(length('data-site-section="'||target_anchor||'"'),1)<>1 then
    raise exception 'Add Video target is not a current operational anchor' using errcode='P0001';
  end if;
end;
$$;

revoke all on function public.assert_add_video_source_eligible(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.assert_add_video_source_eligible(uuid,uuid,jsonb) to service_role;
revoke all on function public.assert_add_video_v4_candidate_anchor(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.assert_add_video_v4_candidate_anchor(uuid,jsonb) to service_role;
comment on function public.assert_add_video_source_eligible(uuid,uuid,jsonb) is
  'Schema-v4 Add Video source guard using operational anchors and manifest/attachment parity; legacy section topology is intentionally ignored.';
comment on function public.assert_add_video_v4_candidate_anchor(uuid,jsonb) is
  'Schema-v4 Add Video candidate guard binding the accepted targetSection to one media/host operational anchor marker.';

-- Override the historical Add Video finalizer without changing its signature, fences, or writes.
-- Schema v3 remains on its locked validation path; schema v4 adds the operational-anchor guard
-- and then uses the same exact locked attachment-snapshot-plus-video manifest parity check.
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
  if p_config_json->>'generatorSchemaVersion' = '3' then
    -- Keep the historical schema-v3 acceptance rule on its locked branch.
    if p_config_json->>'generator' <> 'unified-site-agent'
      or p_config_json->>'generatorSchemaVersion' <> '3'
      or jsonb_typeof(p_config_json#>'{mediaManifest,slots}') <> 'array' then
      raise exception 'Candidate must contain a supported v3 media manifest';
    end if;
  elsif p_config_json->>'generatorSchemaVersion' = '4' then
    if p_config_json->>'generator' is distinct from 'unified-site-agent'
      or jsonb_typeof(p_config_json#>'{mediaManifest,slots}') is distinct from 'array' then
      raise exception 'Candidate must contain a supported v4 media manifest';
    end if;
    perform public.assert_add_video_v4_candidate_anchor(p_job_id, p_config_json);
  else
    raise exception 'Candidate must contain a supported v3 or v4 media manifest';
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

revoke all on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb) to service_role;
comment on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb) is
  'Service-only attempts/revision-fenced Add Video finalizer. Schema v3 preserves historical validation; schema v4 requires a current operational anchor and exact manifest/attachment parity.';

-- Service-only epoch-native media API.
revoke all on function public.plan_generation_media_slots_epoch(uuid,uuid,bigint,jsonb,text) from public,anon,authenticated;
revoke all on function public.claim_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,text) from public,anon,authenticated;
revoke all on function public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,text,text,text) from public,anon,authenticated;
revoke all on function public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.record_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.plan_generation_media_slots_epoch(uuid,uuid,bigint,jsonb,text) to service_role;
grant execute on function public.claim_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,text) to service_role;
grant execute on function public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text) to service_role;
grant execute on function public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,text) to service_role;
grant execute on function public.record_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text) to service_role;

comment on function public.plan_generation_media_slots_epoch(uuid,uuid,bigint,jsonb,text) is 'Epoch-2 claim-epoch/lease-fenced complete media plan persistence.';
comment on function public.claim_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,text) is 'Epoch-2 claim-epoch/lease-fenced media slot claim.';
comment on function public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text) is 'Epoch-2 claim-epoch/lease-fenced provider-create budget reservation.';
comment on function public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,text,text,text) is 'Epoch-2 claim-epoch/lease-fenced provider operation/effect-certainty record.';
comment on function public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,text) is 'Epoch-2 claim-epoch/lease-fenced media failure/abandonment settlement.';
comment on function public.record_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,integer,integer,text,text,text,bigint,integer,text,text,boolean,text,text,text,text) is 'Epoch-2 claim-epoch/lease-fenced durable media asset record.';


-- -----------------------------------------------------------------------------
-- Media provider capacity, customer fairness, and explicit reconciliation
-- -----------------------------------------------------------------------------
-- This is an epoch-2-only extension. Historical Add Video and schema-v2/v3 functions above
-- retain their existing signatures and behavior.

alter table public.background_jobs
  add column if not exists generation_tenant_id uuid references public.profiles(id) on delete restrict,
  add column if not exists generation_last_dispatched_at timestamptz,
  add column if not exists generation_last_scheduler_run_id uuid;

update public.background_jobs job
set generation_tenant_id = website.user_id
from public.websites website
where job.website_id = website.id
  and job.job_type = 'site_generation'
  and job.generation_contract_epoch = 2
  and job.generation_tenant_id is null;

create index if not exists idx_background_jobs_epoch2_fair_dispatch
  on public.background_jobs (generation_tenant_id, generation_last_dispatched_at nulls first, created_at, id)
  where job_type='site_generation' and generation_contract_epoch=2 and status='pending';

create table if not exists public.generation_media_provider_limits (
  provider text not null,
  tenant_id uuid references public.profiles(id) on delete cascade,
  max_in_flight integer not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint generation_media_provider_limits_provider_check check (provider ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  constraint generation_media_provider_limits_cap_check check (max_in_flight between 1 and 1000)
);
create unique index if not exists idx_generation_media_provider_limits_identity
  on public.generation_media_provider_limits(provider,tenant_id) nulls not distinct;

insert into public.generation_media_provider_limits(provider,tenant_id,max_in_flight)
values ('lovable-image',null,8)
on conflict (provider,tenant_id) do nothing;

alter table public.site_generation_media_slots
  add column if not exists slot_claim_epoch bigint not null default 0,
  add column if not exists slot_locked_by text,
  add column if not exists slot_lease_expires_at timestamptz,
  add column if not exists provider_name text,
  add column if not exists provider_reservation_id uuid,
  add column if not exists provider_request_hash text,
  add column if not exists provider_reserved_at timestamptz,
  add column if not exists reconciliation_required_at timestamptz,
  add column if not exists reconciliation_deadline timestamptz,
  add column if not exists reconciliation_actor text,
  add column if not exists reconciliation_reason text,
  add column if not exists reconciliation_evidence jsonb,
  add column if not exists reconciliation_action_key text,
  add column if not exists reconciled_at timestamptz,
  add column if not exists cleanup_required boolean not null default false,
  add column if not exists cleanup_completed_at timestamptz;

alter table public.site_generation_media_slots
  drop constraint if exists site_generation_media_slots_status_check,
  add constraint site_generation_media_slots_status_check check (
    status in ('planned','generating','reconciliation_required','ready','failed','abandoned','attached')
  ) not valid;
alter table public.site_generation_media_slots validate constraint site_generation_media_slots_status_check;

alter table public.site_generation_media_slots
  drop constraint if exists site_generation_media_slots_reconciliation_check,
  add constraint site_generation_media_slots_reconciliation_check check (
    (status <> 'reconciliation_required' and reconciliation_required_at is null and reconciliation_deadline is null)
    or (
      status = 'reconciliation_required'
      and effect_certainty = 'indeterminate'
      and reconciliation_required_at is not null
      and reconciliation_deadline is not null
      and reconciliation_deadline > reconciliation_required_at
      and reconciled_at is null
      and provider_reservation_id is not null
    )
    or (reconciled_at is not null and nullif(btrim(reconciliation_actor),'') is not null
      and nullif(btrim(reconciliation_reason),'') is not null
      and reconciliation_action_key is not null)
  ) not valid;
alter table public.site_generation_media_slots validate constraint site_generation_media_slots_reconciliation_check;

create unique index if not exists idx_generation_media_provider_reservation
  on public.site_generation_media_slots(provider_reservation_id)
  where provider_reservation_id is not null;
create unique index if not exists idx_generation_media_reconciliation_action
  on public.site_generation_media_slots(reconciliation_action_key)
  where reconciliation_action_key is not null;
create index if not exists idx_generation_media_reconciliation_due
  on public.site_generation_media_slots(reconciliation_deadline,reconciliation_required_at,id)
  where status='reconciliation_required';
create index if not exists idx_generation_media_provider_capacity
  on public.site_generation_media_slots(provider_name,provider_reserved_at,id)
  where status='generating' and provider_reservation_id is not null;

comment on column public.site_generation_media_slots.slot_claim_epoch is
  'Independent monotonic lease fence for one media-slot retry unit; parent claim_epoch remains the workflow fence.';
comment on column public.site_generation_media_slots.provider_reservation_id is
  'Stable pre-call reservation identity; any indeterminate effect retains this identity and forbids blind recreation.';
comment on column public.site_generation_media_slots.reconciliation_required_at is
  'DB-time start of explicit nonterminal provider reconciliation; age is directly alertable without event-window inference.';

-- Planning replay may never rewrite ready/attached/reconciliation state or ownership fences.
create or replace function public.plan_generation_media_slots_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slots jsonb,p_runner_id text default null
) returns uuid[]
language plpgsql security definer set search_path=public as $$
declare owned_job public.background_jobs%rowtype; slot_value jsonb; result_ids uuid[]:=array[]::uuid[]; result_id uuid;
begin
  owned_job:=public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  if owned_job.generation_stage not in ('media','composition','validation','persistence')
     or jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots)>128 then
    raise exception 'Invalid epoch generation media plan' using errcode='22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_slots) item where jsonb_typeof(item)<>'object'
    or nullif(item->>'slot_id','') is null or item->>'kind' not in ('image','video')
    or item->>'role' not in ('hero','proof','support','atmosphere','texture','motion-poster')
    or item->>'provenance' not in ('evidence','generated')
    or jsonb_typeof(item->'required')<>'boolean' or jsonb_typeof(item->'proof_eligible')<>'boolean')
    or exists (select item->>'slot_id' from jsonb_array_elements(p_slots) item group by item->>'slot_id' having count(*)<>1) then
    raise exception 'Invalid epoch generation media plan' using errcode='22023';
  end if;
  for slot_value in select value from jsonb_array_elements(p_slots) loop
    insert into public.site_generation_media_slots(job_id,website_id,slot_id,kind,role,provenance,required,proof_eligible,status,source_slot_id,poster_slot_id,claim_epoch)
    values(p_job_id,p_website_id,slot_value->>'slot_id',slot_value->>'kind',slot_value->>'role',slot_value->>'provenance',
      (slot_value->>'required')::boolean,(slot_value->>'proof_eligible')::boolean,'planned',nullif(slot_value->>'source_slot_id',''),
      nullif(slot_value->>'poster_slot_id',''),p_claim_epoch)
    on conflict(job_id,slot_id) do update set claim_epoch=case
      when site_generation_media_slots.status in ('planned','failed') then excluded.claim_epoch
      else site_generation_media_slots.claim_epoch end
    where site_generation_media_slots.website_id=excluded.website_id
      and site_generation_media_slots.kind=excluded.kind and site_generation_media_slots.role=excluded.role
      and site_generation_media_slots.provenance=excluded.provenance and site_generation_media_slots.required=excluded.required
      and site_generation_media_slots.proof_eligible=excluded.proof_eligible
      and site_generation_media_slots.source_slot_id is not distinct from excluded.source_slot_id
      and site_generation_media_slots.poster_slot_id is not distinct from excluded.poster_slot_id
    returning id into result_id;
    if result_id is null then raise exception 'Persisted media slot does not match the accepted plan' using errcode='P0001'; end if;
    result_ids:=array_append(result_ids,result_id);
  end loop;
  if exists(select 1 from public.site_generation_media_slots slot where slot.job_id=p_job_id and slot.website_id=p_website_id
    and slot.status<>'attached' and not exists(select 1 from jsonb_array_elements(p_slots) item where item->>'slot_id'=slot.slot_id)) then
    raise exception 'Accepted media plan cannot omit a job slot' using errcode='P0001';
  end if;
  return result_ids;
end; $$;

create or replace function public.claim_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,
  p_kind text,p_role text,p_provenance text default 'generated',p_required boolean default true,
  p_proof_eligible boolean default false,p_source_slot_id text default null,p_poster_slot_id text default null,
  p_runner_id text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare owned_job public.background_jobs%rowtype; result_id uuid;
begin
  if nullif(btrim(p_runner_id),'') is null then raise exception 'Exact media runner is required' using errcode='22023'; end if;
  owned_job:=public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  if owned_job.generation_stage not in ('media','composition','validation','persistence') then raise exception 'Generation media stage is not active' using errcode='40001'; end if;
  update public.site_generation_media_slots set status='generating',claim_epoch=p_claim_epoch,
    slot_claim_epoch=slot_claim_epoch+1,slot_locked_by=p_runner_id,slot_lease_expires_at=clock_timestamp()+interval '10 minutes',
    claimed_at=clock_timestamp(),error_message=null
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id
    and status in ('planned','failed')
    and kind=p_kind and role=p_role and provenance=p_provenance and required=p_required and proof_eligible=p_proof_eligible
    and source_slot_id is not distinct from p_source_slot_id and poster_slot_id is not distinct from p_poster_slot_id
    and not exists(select 1 from public.site_generation_media_slots unresolved where unresolved.id=site_generation_media_slots.id
      and unresolved.effect_certainty='indeterminate')
  returning id into result_id;
  if result_id is null then raise exception 'Media slot cannot be claimed' using errcode='40001'; end if;
  return result_id;
end; $$;

create or replace function public.reserve_generation_media_create_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,p_provider text,
  p_request_hash text,p_runner_id text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare owned_job public.background_jobs%rowtype; current_slot public.site_generation_media_slots%rowtype;
  v_tenant_id uuid; global_cap integer; tenant_cap integer; global_in_flight integer; tenant_in_flight integer;
  reservation uuid; ordinal integer; idem text;
begin
  if nullif(btrim(p_runner_id),'') is null or p_provider !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'Provider reservation identity is invalid' using errcode='22023'; end if;
  owned_job:=public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  select website.user_id into v_tenant_id from public.websites website where website.id=p_website_id;
  perform pg_advisory_xact_lock(hashtextextended('media-provider:'||p_provider,0));
  perform pg_advisory_xact_lock(hashtextextended('media-provider:'||p_provider||':tenant:'||v_tenant_id::text,0));
  select * into current_slot from public.site_generation_media_slots where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id for update;
  if not found or current_slot.status<>'generating' or current_slot.claim_epoch<>p_claim_epoch
     or current_slot.slot_locked_by<>p_runner_id or current_slot.slot_lease_expires_at<=clock_timestamp()
     or current_slot.effect_certainty='indeterminate' or current_slot.provider_reservation_id is not null then
    raise exception 'Provider create is not permitted for this slot lease' using errcode='40001';
  end if;
  if current_slot.provider_create_count>=2 or (current_slot.provider_create_count>0 and current_slot.effect_certainty<>'definite_failure') then
    raise exception 'Provider create budget is unavailable' using errcode='40001';
  end if;
  select max_in_flight into global_cap from public.generation_media_provider_limits where provider=p_provider and tenant_id is null;
  select max_in_flight into tenant_cap from public.generation_media_provider_limits where provider=p_provider and tenant_id=v_tenant_id;
  global_cap:=coalesce(global_cap,8); tenant_cap:=coalesce(tenant_cap,2);
  select count(*) into global_in_flight from public.site_generation_media_slots
    where provider_name=p_provider and status='generating' and provider_reservation_id is not null
      and slot_lease_expires_at>clock_timestamp();
  select count(*) into tenant_in_flight from public.site_generation_media_slots slot join public.websites website on website.id=slot.website_id
    where slot.provider_name=p_provider and slot.status='generating' and slot.provider_reservation_id is not null
      and slot.slot_lease_expires_at>clock_timestamp() and website.user_id=v_tenant_id;
  if global_in_flight>=global_cap or tenant_in_flight>=tenant_cap then
    raise exception 'Provider concurrency cap is saturated' using errcode='53000';
  end if;
  ordinal:=current_slot.provider_create_count+1;
  reservation:=gen_random_uuid();
  idem:=encode(extensions.digest(convert_to(p_job_id::text||':'||current_slot.id::text||':'||ordinal::text||':'||p_request_hash,'UTF8'),'sha256'),'hex');
  update public.site_generation_media_slots set provider_create_count=ordinal,provider_name=p_provider,
    provider_reservation_id=reservation,provider_request_hash=p_request_hash,provider_idempotency_key=idem,
    provider_operation_id=null,provider_reserved_at=clock_timestamp(),effect_certainty='not_started'
  where id=current_slot.id and slot_claim_epoch=current_slot.slot_claim_epoch;
  return jsonb_build_object('reservationId',reservation,'createOrdinal',ordinal,'idempotencyKey',idem,'slotClaimEpoch',current_slot.slot_claim_epoch);
end; $$;

create or replace function public.record_generation_media_operation_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,p_reservation_id uuid,
  p_provider_operation_id text,p_effect_certainty text,p_runner_id text
) returns boolean
language plpgsql security definer set search_path=public as $$
declare owned_job public.background_jobs%rowtype;
begin
  if nullif(btrim(p_runner_id),'') is null or nullif(btrim(p_provider_operation_id),'') is null
     or p_effect_certainty not in ('not_started','definite_failure','definite_success','indeterminate') then
    raise exception 'Provider operation identity is invalid' using errcode='22023'; end if;
  owned_job:=public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  update public.site_generation_media_slots set provider_operation_id=p_provider_operation_id,effect_certainty=p_effect_certainty
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id and claim_epoch=p_claim_epoch
    and slot_locked_by=p_runner_id and slot_lease_expires_at>clock_timestamp() and status='generating'
    and provider_reservation_id=p_reservation_id
    and (provider_operation_id is null or provider_operation_id=p_provider_operation_id);
  return found;
end; $$;

alter table public.site_generation_attempt_events
  drop constraint if exists site_generation_attempt_events_event_type_check,
  add constraint site_generation_attempt_events_event_type_check check(event_type in(
    'claimed','yielded','retry_scheduled','interrupted','cancelled','superseded','failed','completed','replayed',
    'reconciliation_required','reconciled'
  )) not valid;
alter table public.site_generation_attempt_events
  drop constraint if exists site_generation_attempt_events_disposition_check,
  add constraint site_generation_attempt_events_disposition_check check(disposition in(
    'continue','retry','resume','cancel','supersede','terminal_failure','terminal_success','replay','reconcile','manual','cleanup'
  )) not valid;
alter table public.site_generation_attempt_events validate constraint site_generation_attempt_events_event_type_check;
alter table public.site_generation_attempt_events validate constraint site_generation_attempt_events_disposition_check;

create or replace function public.settle_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_claim_epoch bigint,p_slot_id text,p_reservation_id uuid,
  p_status text,p_error_message text,p_effect_certainty text,p_runner_id text
) returns boolean
language plpgsql security definer set search_path=public as $$
declare owned_job public.background_jobs%rowtype; settled boolean;
begin
  if nullif(btrim(p_runner_id),'') is null or p_status not in ('failed','abandoned')
    or p_effect_certainty not in ('not_started','definite_failure','definite_success','indeterminate')
    or (p_effect_certainty='definite_success' and p_status<>'failed') then
    raise exception 'Invalid epoch media settlement' using errcode='22023'; end if;
  owned_job:=public.require_epoch2_generation_media_owner(p_job_id,p_website_id,p_claim_epoch,p_runner_id);
  update public.site_generation_media_slots set
    status=case when p_effect_certainty in ('indeterminate','definite_success') then 'reconciliation_required' else p_status end,
    error_message=p_error_message,effect_certainty=p_effect_certainty,
    reconciliation_required_at=case when p_effect_certainty in ('indeterminate','definite_success') then clock_timestamp() else null end,
    reconciliation_deadline=case when p_effect_certainty in ('indeterminate','definite_success') then clock_timestamp()+interval '1 hour' else null end,
    slot_locked_by=null,slot_lease_expires_at=null,
    provider_reservation_id=case when p_effect_certainty in ('not_started','definite_failure') then null else provider_reservation_id end,
    provider_reserved_at=case when p_effect_certainty in ('not_started','definite_failure') then null else provider_reserved_at end,
    retired_provider_operation_ids=case when provider_operation_id is not null and p_effect_certainty in ('definite_failure','definite_success')
      and not(retired_provider_operation_ids ? provider_operation_id) then retired_provider_operation_ids||jsonb_build_array(provider_operation_id)
      else retired_provider_operation_ids end,
    abandoned_at=case when p_status='abandoned' and p_effect_certainty<>'indeterminate' then clock_timestamp() else null end
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id and claim_epoch=p_claim_epoch
    and slot_locked_by=p_runner_id and status='generating'
    and provider_reservation_id is not distinct from p_reservation_id;
  settled:=found;
  if settled and p_effect_certainty in ('indeterminate','definite_success') then
    update public.background_jobs set status='pending',next_retry_at=null,locked_at=null,locked_by=null,lease_expires_at=null,
      status_message='Media provider reconciliation required'
    where id=p_job_id and website_id=p_website_id and claim_epoch=p_claim_epoch and status='running';
    insert into public.site_generation_attempt_events(event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
      event_type,cause_code,effect_certainty,disposition,severity,blocking,budget_type,budget_before,budget_after,runner_id,completed_at,details)
    values(p_job_id::text||':'||p_slot_id||':'||p_reservation_id::text||':reconciliation-required',p_job_id,p_website_id,
      owned_job.generation_request_id,2,p_claim_epoch,'media',owned_job.stage_attempts,'reconciliation_required',
      case when p_effect_certainty='definite_success' then 'provider_effect_succeeded_persistence_failed' else 'provider_effect_indeterminate' end,
      p_effect_certainty,'reconcile','error',true,'provider_create',greatest(0,(select provider_create_count-1 from public.site_generation_media_slots where job_id=p_job_id and slot_id=p_slot_id)),
      (select provider_create_count from public.site_generation_media_slots where job_id=p_job_id and slot_id=p_slot_id),p_runner_id,clock_timestamp(),
      jsonb_build_object('slotId',p_slot_id,'reservationId',p_reservation_id)) on conflict(event_key) do nothing;
  end if;
  return settled;
end; $$;

create or replace function public.reconcile_generation_media_slot_epoch(
  p_job_id uuid,p_website_id uuid,p_slot_id text,p_reservation_id uuid,p_action_key text,
  p_action text,p_actor text,p_reason text,p_evidence jsonb
) returns text
language plpgsql security definer set search_path=public as $$
declare slot public.site_generation_media_slots%rowtype; job public.background_jobs%rowtype; result_status text;
begin
  if p_action not in ('ready','retry','reject','cleanup') or nullif(btrim(p_action_key),'') is null
    or nullif(btrim(p_actor),'') is null or nullif(btrim(p_reason),'') is null or jsonb_typeof(p_evidence) is distinct from 'object' then
    raise exception 'Audited reconciliation action is invalid' using errcode='22023'; end if;
  select * into slot from public.site_generation_media_slots where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id for update;
  if not found or slot.provider_reservation_id is distinct from p_reservation_id then return null; end if;
  if slot.reconciliation_action_key=p_action_key then return slot.status; end if;
  if slot.status<>'reconciliation_required' or slot.reconciliation_action_key is not null then return null; end if;
  select * into job from public.background_jobs where id=p_job_id and website_id=p_website_id for update;
  result_status:=case p_action when 'ready' then 'ready' when 'retry' then 'failed' else 'abandoned' end;
  if p_action='ready' and (nullif(p_evidence->>'storagePath','') is null or (p_evidence->>'contentHash') !~ '^[0-9a-f]{64}$') then
    raise exception 'Ready reconciliation requires durable storage evidence' using errcode='22023'; end if;
  if p_action='retry' and slot.effect_certainty='definite_success' then
    raise exception 'Confirmed provider success cannot be recreated' using errcode='55000'; end if;
  if p_action='retry' and coalesce(slot.provider_create_count,0)>=2 then raise exception 'Provider create cap is exhausted' using errcode='P0001'; end if;
  update public.site_generation_media_slots set status=result_status,effect_certainty=case when p_action='ready' then 'definite_success' else 'definite_failure' end,
    storage_path=case when p_action='ready' then p_evidence->>'storagePath' else storage_path end,
    content_hash=case when p_action='ready' then p_evidence->>'contentHash' else content_hash end,
    asset_id=case when p_action='ready' then p_evidence->>'contentHash' else asset_id end,
    mime_type=case when p_action='ready' then coalesce(nullif(p_evidence->>'mimeType',''),mime_type) else mime_type end,
    reconciliation_actor=btrim(p_actor),reconciliation_reason=btrim(p_reason),reconciliation_evidence=p_evidence,
    reconciliation_action_key=p_action_key,reconciled_at=clock_timestamp(),reconciliation_required_at=null,reconciliation_deadline=null,
    cleanup_required=p_action='cleanup',cleanup_completed_at=case when p_action='cleanup' then clock_timestamp() else null end,
    provider_reservation_id=case when p_action='retry' then null else provider_reservation_id end,
    provider_reserved_at=case when p_action='retry' then null else provider_reserved_at end,
    error_message=case when p_action='ready' then null else btrim(p_reason) end,
    abandoned_at=case when p_action in ('reject','cleanup') then clock_timestamp() else null end
  where id=slot.id;
  if p_action in ('ready','retry') and job.status='pending' and job.completed_at is null then
    update public.background_jobs set next_retry_at=clock_timestamp(),status_message='Media reconciliation resolved: '||p_action where id=p_job_id;
  end if;
  insert into public.site_generation_attempt_events(event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,completed_at,details)
  values(p_action_key,p_job_id,p_website_id,job.generation_request_id,2,job.claim_epoch,'media',job.stage_attempts,
    'reconciled','provider_reconciliation_'||p_action,case when p_action='ready' then 'definite_success' else 'definite_failure' end,
    case when p_action='retry' then 'retry' when p_action='cleanup' then 'cleanup' else 'manual' end,'info',false,p_actor,clock_timestamp(),
    jsonb_build_object('slotId',p_slot_id,'reservationId',p_reservation_id,'action',p_action,'actor',btrim(p_actor),'reason',btrim(p_reason),'evidence',p_evidence));
  return result_status;
end; $$;

-- Fair epoch-2 claim: hard global/customer active caps plus least-recently-served customer election.
create or replace function public.claim_next_background_job(
  p_runner_id text,p_stale_before timestamptz,p_generation_contract_epoch integer,p_scheduler_run_id uuid
) returns setof public.background_jobs
language plpgsql security definer set search_path=public as $$
declare claimed public.background_jobs%rowtype; global_active integer; tenant_active integer;
begin
  if nullif(btrim(p_runner_id),'') is null or p_generation_contract_epoch<>2 or p_scheduler_run_id is null then
    raise exception 'Runner, capability, and scheduler run identity are required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('epoch2-generation-fair-dispatch',0));
  update public.background_jobs set status='pending',locked_at=null,locked_by=null,lease_expires_at=null,next_retry_at=clock_timestamp(),
    interruption_count=interruption_count+1,status_message='Resuming interrupted generation'
  where job_type='site_generation' and generation_contract_epoch=2 and status='running'
    and lease_expires_at is not null and lease_expires_at<=clock_timestamp();
  select count(*) into global_active from public.background_jobs where job_type='site_generation' and generation_contract_epoch=2 and status='running'
    and lease_expires_at>clock_timestamp();
  with eligible as (
    select candidate.id,website.user_id as tenant_id,
      min(candidate.generation_last_dispatched_at) over(partition by website.user_id) tenant_last_served,
      row_number() over(partition by website.user_id order by candidate.created_at,candidate.id) tenant_position
    from public.background_jobs candidate join public.websites website on website.id=candidate.website_id
    where global_active<8
      and candidate.job_type='site_generation' and candidate.generation_contract_epoch=2 and candidate.status='pending'
      and (candidate.next_retry_at is null or candidate.next_retry_at<=clock_timestamp())
      and candidate.generation_last_scheduler_run_id is distinct from p_scheduler_run_id
      and not exists(select 1 from public.site_generation_media_slots slot where slot.job_id=candidate.id and slot.status='reconciliation_required')
      and not exists(select 1 from public.background_jobs predecessor where predecessor.chain_id=candidate.chain_id
        and predecessor.sequence_index<candidate.sequence_index and predecessor.status in ('pending','running','finalizing'))
  ), candidate as (
    select eligible.id,eligible.tenant_id from eligible where tenant_position=1
      and (select count(*) from public.background_jobs active join public.websites active_site on active_site.id=active.website_id
        where active_site.user_id=eligible.tenant_id and active.job_type='site_generation' and active.generation_contract_epoch=2
          and active.status='running' and active.lease_expires_at>clock_timestamp())<2
    order by tenant_last_served nulls first,id limit 1
  )
  select job.* into claimed from public.background_jobs job join candidate on candidate.id=job.id;
  if not found then
    select candidate.* into claimed from public.background_jobs candidate
    where candidate.status='pending' and candidate.job_type<>'site_generation'
      and (candidate.next_retry_at is null or candidate.next_retry_at<=clock_timestamp())
      and (candidate.attempts<candidate.max_attempts or (candidate.job_type='enrichment_platform'
        and candidate.payload_json->'resume_enrichment_finalization'='true'::jsonb))
      and not exists(select 1 from public.background_jobs predecessor where predecessor.chain_id=candidate.chain_id
        and predecessor.sequence_index<candidate.sequence_index and predecessor.status in ('pending','running','finalizing'))
    order by candidate.created_at,candidate.id for update skip locked limit 1;
    if not found then return; end if;
  end if;
  update public.background_jobs set status=case when job_type='enrichment_platform'
      and payload_json->'resume_enrichment_finalization'='true'::jsonb then 'finalizing' else 'running' end,
    locked_at=clock_timestamp(),locked_by=p_runner_id,
    lease_expires_at=case when job_type='site_generation' then clock_timestamp()+interval '10 minutes' else lease_expires_at end,
    started_at=coalesce(started_at,clock_timestamp()),attempts=attempts+1,
    claim_epoch=case when job_type='site_generation' then claim_epoch+1 else claim_epoch end,next_retry_at=null,
    finalization_attempts=case when job_type='enrichment_platform'
      and payload_json->'resume_enrichment_finalization'='true'::jsonb then finalization_attempts+1 else finalization_attempts end,
    generation_tenant_id=case when job_type='site_generation' then coalesce(generation_tenant_id,
      (select user_id from public.websites where id=website_id)) else generation_tenant_id end,
    generation_last_dispatched_at=case when job_type='site_generation' then clock_timestamp() else generation_last_dispatched_at end,
    generation_last_scheduler_run_id=case when job_type='site_generation' then p_scheduler_run_id else generation_last_scheduler_run_id end
  where id=claimed.id returning * into claimed;
  if claimed.job_type='site_generation' then
  insert into public.site_generation_attempt_events(event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,effect_certainty,disposition,severity,blocking,runner_id,started_at,details)
  values(claimed.id::text||':'||claimed.claim_epoch::text||':claimed',claimed.id,claimed.website_id,claimed.generation_request_id,2,
    claimed.claim_epoch,claimed.generation_stage,claimed.stage_attempts,'claimed','not_started','continue','info',false,p_runner_id,
    clock_timestamp(),jsonb_build_object('schedulerRunId',p_scheduler_run_id)) on conflict(event_key) do nothing;
  end if;
  return next claimed;
end; $$;

revoke insert,update,delete,truncate on table public.site_generation_media_slots from service_role;
revoke insert,update,delete,truncate on table public.site_generation_attempt_events from service_role;
revoke all on table public.generation_media_provider_limits from public,anon,authenticated;
grant select on table public.generation_media_provider_limits to service_role;

revoke all on function public.plan_generation_media_slots_epoch(uuid,uuid,bigint,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.claim_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,uuid,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_generation_media_slot_epoch(uuid,uuid,text,uuid,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.claim_next_background_job(text,timestamptz,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.plan_generation_media_slots_epoch(uuid,uuid,bigint,jsonb,text) to service_role;
grant execute on function public.claim_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,boolean,boolean,text,text,text) to service_role;
grant execute on function public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text,text,text) to service_role;
grant execute on function public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,uuid,text,text,text) to service_role;
grant execute on function public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,uuid,text,text,text,text) to service_role;
grant execute on function public.reconcile_generation_media_slot_epoch(uuid,uuid,text,uuid,text,text,text,text,jsonb) to service_role;
grant execute on function public.claim_next_background_job(text,timestamptz,integer,uuid) to service_role;

comment on function public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text,text,text) is
  'Service-only exact owner/slot-fenced pre-call reservation with hard global/customer/provider concurrency and two-create slot cap.';
comment on function public.reconcile_generation_media_slot_epoch(uuid,uuid,text,uuid,text,text,text,text,jsonb) is
  'Audited service-only idempotent resolution to ready/retry/abandoned(cleanup or reject); indeterminate is never blindly recreated.';

-- -----------------------------------------------------------------------------
-- Explicit administrative supersession (no admission, queue, or UI path)
-- -----------------------------------------------------------------------------
-- Supersession is a distinct terminal outcome. It is intentionally available only through
-- the exact service-role RPC below; historical cancellation and epoch-1 readers are unchanged.
alter table public.background_jobs
  drop constraint if exists background_jobs_status_check;
alter table public.background_jobs
  add constraint background_jobs_status_check check (
    status in ('pending','running','finalizing','completed','failed','cancelled','superseded')
  ) not valid;
alter table public.background_jobs validate constraint background_jobs_status_check;

alter table public.background_jobs
  add column if not exists superseded_at timestamptz,
  add column if not exists supersession_actor text,
  add column if not exists supersession_reason text;

alter table public.background_jobs
  drop constraint if exists background_jobs_supersession_identity_check,
  add constraint background_jobs_supersession_identity_check check (
    status <> 'superseded'
    or (
      job_type = 'site_generation'
      and generation_contract_epoch = 2
      and superseded_at is not null
      and completed_at = superseded_at
      and nullif(btrim(supersession_actor),'') is not null
      and nullif(btrim(supersession_reason),'') is not null
      and generation_result_version_id is null
      and generation_handoff_message_id is not null
      and generation_terminal_message_id = generation_handoff_message_id
      and generation_terminal_message_at is not null
      and jsonb_typeof(generation_terminal_message_payload) = 'object'
      and generation_terminal_message_payload->>'status' = 'superseded'
      and jsonb_typeof(result_json) = 'object'
      and result_json->>'status' = 'superseded'
    )
  ) not valid;
alter table public.background_jobs
  validate constraint background_jobs_supersession_identity_check;

comment on column public.background_jobs.superseded_at is
  'Terminal timestamp for an explicit epoch-2 administrative generation supersession.';
comment on column public.background_jobs.supersession_actor is
  'Required audited service actor for an explicit administrative generation supersession.';
comment on column public.background_jobs.supersession_reason is
  'Required audited reason for an explicit administrative generation supersession.';

alter table public.site_generation_attempt_events
  drop constraint if exists site_generation_attempt_events_event_type_check,
  add constraint site_generation_attempt_events_event_type_check check (event_type in (
    'claimed','yielded','retry_scheduled','interrupted','cancelled','superseded','failed','completed','replayed',
    'reconciliation_required','reconciled'
  )) not valid;
alter table public.site_generation_attempt_events
  drop constraint if exists site_generation_attempt_events_disposition_check,
  add constraint site_generation_attempt_events_disposition_check check (disposition in (
    'continue','retry','resume','cancel','supersede','terminal_failure','terminal_success','replay','reconcile','manual','cleanup'
  )) not valid;
alter table public.site_generation_attempt_events
  validate constraint site_generation_attempt_events_event_type_check,
  validate constraint site_generation_attempt_events_disposition_check;

create or replace function public.supersede_site_generation_epoch(
  p_website_id uuid,
  p_job_id uuid,
  p_request_id uuid,
  p_claim_epoch bigint,
  p_actor text,
  p_reason text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  current_job public.background_jobs%rowtype;
  terminal_at timestamptz;
  terminal_text constant text := 'This website generation was superseded. Please submit a new request.';
  terminal_payload jsonb;
  terminal_result jsonb;
  normalized_actor text := btrim(p_actor);
  normalized_reason text := btrim(p_reason);
  supersession_event_key text;
  abandoned_media_count integer := 0;
begin
  if p_website_id is null or p_job_id is null or p_request_id is null or p_claim_epoch is null
     or p_claim_epoch < 0
     or nullif(normalized_actor,'') is null or length(normalized_actor) > 200
     or nullif(normalized_reason,'') is null or length(normalized_reason) > 1000 then
    raise exception 'Exact administrative generation supersession identity is required'
      using errcode = '22023';
  end if;

  -- Serialize admission/cancellation for this website, then fence every worker/finalizer with
  -- the exact job row lock. No lease expiry or elapsed time grants supersession authority.
  perform pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation',0));
  select * into current_job
  from public.background_jobs
  where id = p_job_id
  for update;

  if not found
     or current_job.website_id <> p_website_id
     or current_job.job_type <> 'site_generation'
     or current_job.generation_contract_epoch <> 2
     or current_job.generation_request_id <> p_request_id
     or current_job.claim_epoch <> p_claim_epoch then
    return false;
  end if;

  terminal_payload := jsonb_build_object(
    'schemaVersion',1,
    'kind','site-generation-terminal',
    'status','superseded',
    'causeCode','administrative_supersession',
    'jobId',p_job_id,
    'requestId',p_request_id,
    'claimEpoch',p_claim_epoch,
    'message',terminal_text
  );
  terminal_result := jsonb_build_object(
    'schemaVersion',1,
    'kind','site-generation-result',
    'status','superseded',
    'errorCode','superseded',
    'jobId',p_job_id,
    'requestId',p_request_id,
    'claimEpoch',p_claim_epoch,
    'message',terminal_text
  );
  supersession_event_key := p_job_id::text || ':' || p_claim_epoch::text || ':superseded';

  -- A committed retry is idempotent only for the complete, exact terminal identity. Different
  -- actor/reason input or any inconsistent terminal projection is never treated as success.
  if current_job.status = 'superseded' then
    return current_job.supersession_actor is not distinct from normalized_actor
      and current_job.supersession_reason is not distinct from normalized_reason
      and current_job.superseded_at is not null
      and current_job.completed_at is not distinct from current_job.superseded_at
      and current_job.generation_terminal_message_id is not distinct from current_job.generation_handoff_message_id
      and current_job.generation_terminal_message_payload is not distinct from terminal_payload
      and current_job.result_json is not distinct from terminal_result
      and exists (
        select 1 from public.agent_traces trace
        where trace.id = current_job.agent_trace_id
          and trace.website_id = p_website_id
          and trace.status = 'completed'
          and trace.completed_at is not null
      )
      and not exists (
        select 1 from public.site_generation_media_slots slot
        where slot.job_id = p_job_id
          and slot.website_id = p_website_id
          and slot.version_id is null
          and slot.status in ('planned','generating','reconciliation_required','ready','failed')
      )
      and exists (
        select 1 from public.messages message
        where message.id = current_job.generation_handoff_message_id
          and message.trace_id = current_job.agent_trace_id
          and message.role = 'assistant'
          and message.content = terminal_text
      )
      and exists (
        select 1 from public.site_generation_attempt_events event
        where event.event_key = supersession_event_key
          and event.job_id = p_job_id
          and event.website_id = p_website_id
          and event.request_id = p_request_id
          and event.contract_epoch = 2
          and event.claim_epoch = p_claim_epoch
          and event.event_type = 'superseded'
          and event.disposition = 'supersede'
          and event.details->>'actor' = normalized_actor
          and event.details->>'reason' = normalized_reason
      );
  end if;

  if current_job.status not in ('pending','running','finalizing') then
    return false;
  end if;
  if current_job.agent_trace_id is null
     or current_job.generation_handoff_message_id is null
     or current_job.request_id is distinct from p_request_id
     or current_job.generation_result_version_id is not null
     or exists (select 1 from public.website_versions version where version.generation_job_id = p_job_id)
     or current_job.generation_terminal_message_id is not null
     or current_job.generation_terminal_message_payload is not null
     or current_job.generation_terminal_message_at is not null then
    raise exception 'Generation supersession terminal projection is inconsistent' using errcode = 'P0001';
  end if;
  -- Establish deterministic subordinate row-lock order after the authoritative job lock.
  perform 1 from public.site_generation_media_slots slot
  where slot.job_id = p_job_id and slot.website_id = p_website_id
  order by slot.id
  for update;

  perform 1 from public.messages message
  where message.id = current_job.generation_handoff_message_id
    and message.trace_id = current_job.agent_trace_id
    and message.role = 'assistant'
  for update;
  if not found then
    raise exception 'Generation terminal projection target is missing' using errcode = 'P0001';
  end if;

  perform 1 from public.agent_traces trace
  where trace.id = current_job.agent_trace_id
    and trace.website_id = p_website_id
    and trace.status in ('running','completed')
  for update;
  if not found then
    raise exception 'Generation agent trace binding is invalid' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.agent_external_operations operation
    where operation.trace_id = current_job.agent_trace_id
      and operation.website_id = p_website_id
      and operation.status = 'running'
  ) then
    raise exception 'Running external operation prevents safe generation supersession' using errcode = '55000';
  end if;

  terminal_at := clock_timestamp();

  update public.messages
  set content = terminal_text
  where id = current_job.generation_handoff_message_id
    and trace_id = current_job.agent_trace_id
    and role = 'assistant';
  if not found then
    raise exception 'Generation terminal projection target is missing' using errcode = 'P0001';
  end if;

  update public.agent_traces
  set status = 'completed',
      error_message = null,
      completed_at = coalesce(completed_at,terminal_at)
  where id = current_job.agent_trace_id
    and website_id = p_website_id
    and status in ('running','completed');
  if not found then
    raise exception 'Generation agent trace binding is invalid' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.site_generation_media_slots slot
    where slot.job_id = p_job_id
      and slot.website_id = p_website_id
      and slot.version_id is null
      and (
        slot.status = 'reconciliation_required'
        or (
          slot.status = 'generating'
          and (slot.provider_reservation_id is not null or slot.provider_create_count > 0 or slot.provider_operation_id is not null)
          and slot.effect_certainty not in ('not_started','definite_failure')
        )
      )
  ) then
    raise exception 'Media reconciliation prevents safe generation supersession' using errcode = '55000';
  end if;

  update public.site_generation_media_slots
  set status = 'abandoned',
      error_message = 'Generation administratively superseded',
      abandoned_at = terminal_at
  where job_id = p_job_id
    and website_id = p_website_id
    and version_id is null
    and status in ('planned','generating','ready','failed');
  get diagnostics abandoned_media_count = row_count;

  update public.background_jobs
  set status = 'superseded',
      status_message = 'Superseded',
      error_message = null,
      result_json = terminal_result,
      completed_at = terminal_at,
      superseded_at = terminal_at,
      supersession_actor = normalized_actor,
      supersession_reason = normalized_reason,
      generation_result_version_id = null,
      generation_terminal_message_id = current_job.generation_handoff_message_id,
      generation_terminal_message_payload = terminal_payload,
      generation_terminal_message_at = terminal_at,
      next_retry_at = null,
      locked_at = null,
      locked_by = null,
      lease_expires_at = null
  where id = p_job_id
    and website_id = p_website_id
    and generation_request_id = p_request_id
    and claim_epoch = p_claim_epoch
    and generation_contract_epoch = 2
    and status in ('pending','running','finalizing');
  if not found then
    raise exception 'Generation supersession authority was lost' using errcode = '40001';
  end if;

  insert into public.site_generation_attempt_events(
    event_key,job_id,website_id,request_id,contract_epoch,claim_epoch,stage,stage_attempt,
    event_type,cause_code,effect_certainty,disposition,severity,blocking,runner_id,
    completed_at,details
  ) values (
    supersession_event_key,p_job_id,p_website_id,p_request_id,2,p_claim_epoch,
    coalesce(current_job.generation_stage,'context'),
    coalesce((current_job.stage_attempt_counts->>coalesce(current_job.generation_stage,'context'))::integer,current_job.stage_attempts),
    'superseded','administrative_supersession',
    case when exists (
      select 1 from public.site_generation_media_slots slot
      where slot.job_id = p_job_id and slot.website_id = p_website_id
        and slot.effect_certainty = 'indeterminate'
    ) then 'indeterminate' else 'none' end,
    'supersede','info',false,current_job.locked_by,
    terminal_at,jsonb_build_object(
      'actor',normalized_actor,
      'reason',normalized_reason,
      'priorStatus',current_job.status,
      'abandonedMediaCount',abandoned_media_count,
      'terminalMessageId',current_job.generation_handoff_message_id
    )
  );

  return true;
end;
$$;

revoke all on function public.supersede_site_generation_epoch(uuid,uuid,uuid,bigint,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.supersede_site_generation_epoch(uuid,uuid,uuid,bigint,text,text)
  to service_role;
comment on function public.supersede_site_generation_epoch(uuid,uuid,uuid,bigint,text,text) is
  'Service-only exact-identity administrative epoch-2 supersession. Atomically terminalizes one active job and its safe message/result/event/trace/media projections; exact replay only.';
