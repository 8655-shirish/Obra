-- Bucket 1: immutable, tenant-safe website lead records.
-- Application writes use the service role after publication/entitlement validation.

alter table public.leads
  add column if not exists field_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists source_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists submission_fingerprint text,
  add column if not exists rate_limit_key text,
  add column if not exists submitted_at timestamptz;

update public.leads
set submitted_at = created_at
where submitted_at is null;

alter table public.leads
  alter column submitted_at set default pg_catalog.now(),
  alter column submitted_at set not null;

alter table public.leads
  drop constraint if exists leads_form_data_object_check,
  add constraint leads_form_data_object_check
    check (pg_catalog.jsonb_typeof(form_data) = 'object' and pg_catalog.pg_column_size(form_data) <= 32768),
  drop constraint if exists leads_field_snapshot_array_check,
  add constraint leads_field_snapshot_array_check
    check (pg_catalog.jsonb_typeof(field_snapshot) = 'array' and pg_catalog.jsonb_array_length(field_snapshot) <= 20 and pg_catalog.pg_column_size(field_snapshot) <= 16384),
  drop constraint if exists leads_source_snapshot_object_check,
  add constraint leads_source_snapshot_object_check
    check (pg_catalog.jsonb_typeof(source_snapshot) = 'object' and pg_catalog.pg_column_size(source_snapshot) <= 4096),
  drop constraint if exists leads_submission_fingerprint_check,
  add constraint leads_submission_fingerprint_check
    check (submission_fingerprint is null or pg_catalog.length(submission_fingerprint) between 32 and 128),
  drop constraint if exists leads_rate_limit_key_check,
  add constraint leads_rate_limit_key_check
    check (rate_limit_key is null or pg_catalog.length(rate_limit_key) between 16 and 128);

-- Prevent a website/profile mismatch even for service-role callers.
create unique index if not exists websites_id_user_id_uk on public.websites (id, user_id);

alter table public.leads
  drop constraint if exists leads_website_id_fkey,
  drop constraint if exists leads_website_user_ownership_fk,
  add constraint leads_website_user_ownership_fk
    foreign key (website_id, user_id)
    references public.websites (id, user_id)
    on delete restrict;

create index if not exists leads_user_cursor_idx
  on public.leads (user_id, submitted_at desc, id desc);

create index if not exists leads_website_recent_idx
  on public.leads (website_id, submitted_at desc);

create index if not exists leads_rate_limit_idx
  on public.leads (website_id, rate_limit_key, submitted_at desc)
  where rate_limit_key is not null;

create unique index if not exists leads_website_submission_fingerprint_uk
  on public.leads (website_id, submission_fingerprint)
  where submission_fingerprint is not null;

-- Lead history is immutable through the client API. Existing owner SELECT policy remains.
revoke insert, update, delete, truncate on public.leads from anon, authenticated, service_role;

-- Serialize public admission so entitlement, idempotency, and throttling are one transaction.
alter table public.leads
  add column if not exists payload_hash text;

alter table public.leads
  drop constraint if exists leads_payload_hash_check,
  add constraint leads_payload_hash_check
    check (payload_hash is null or pg_catalog.length(payload_hash) between 32 and 128);

create table if not exists public.lead_submission_attempts (
  id bigint generated always as identity primary key,
  website_id uuid not null references public.websites (id) on delete cascade,
  rate_limit_key text not null check (pg_catalog.length(rate_limit_key) between 16 and 128),
  created_at timestamptz not null default pg_catalog.now()
);

alter table public.lead_submission_attempts enable row level security;
revoke all on public.lead_submission_attempts from public, anon, authenticated, service_role;
create index if not exists lead_submission_attempts_window_idx
  on public.lead_submission_attempts (website_id, rate_limit_key, created_at desc);

create or replace function public.submit_starter_website_lead(
  p_website_id uuid,
  p_version_id uuid,
  p_form_data jsonb,
  p_field_snapshot jsonb,
  p_source_snapshot jsonb,
  p_submission_fingerprint text,
  p_payload_hash text,
  p_rate_limit_key text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead_id uuid;
  v_user_id uuid;
  v_license_number text;
begin
  if p_website_id is null
    or p_version_id is null
    or p_form_data is null
    or p_field_snapshot is null
    or p_source_snapshot is null
    or p_submission_fingerprint is null
    or p_payload_hash is null
    or p_rate_limit_key is null
    or pg_catalog.jsonb_typeof(p_form_data) <> 'object'
    or pg_catalog.jsonb_typeof(p_field_snapshot) <> 'array'
    or pg_catalog.jsonb_typeof(p_source_snapshot) <> 'object'
    or pg_catalog.jsonb_array_length(p_field_snapshot) > 20
    or pg_catalog.pg_column_size(p_form_data) > 32768
    or pg_catalog.pg_column_size(p_field_snapshot) > 16384
    or pg_catalog.pg_column_size(p_source_snapshot) > 4096
    or pg_catalog.length(p_submission_fingerprint) not between 32 and 128
    or pg_catalog.length(p_payload_hash) not between 32 and 128
    or pg_catalog.length(p_rate_limit_key) not between 16 and 128 then
    raise exception 'invalid lead payload' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_website_id::text || ':fingerprint:' || p_submission_fingerprint, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_website_id::text || ':rate:' || p_rate_limit_key, 0));

  select l.id into v_lead_id
  from public.leads l
  where l.website_id = p_website_id and l.submission_fingerprint = p_submission_fingerprint;
  if v_lead_id is not null then
    if not exists (select 1 from public.leads l where l.id = v_lead_id and l.payload_hash = p_payload_hash) then
      raise exception 'submission key reused with different payload' using errcode = '23505';
    end if;
    return v_lead_id;
  end if;

  if (select count(*) from public.lead_submission_attempts a
      where a.website_id = p_website_id and a.rate_limit_key = p_rate_limit_key
        and a.created_at >= pg_catalog.now() - interval '10 minutes') >= 5 then
    raise exception 'lead rate limit exceeded' using errcode = 'P0001';
  end if;

  delete from public.lead_submission_attempts
  where created_at < pg_catalog.now() - interval '1 day';

  insert into public.lead_submission_attempts (website_id, rate_limit_key)
  values (p_website_id, p_rate_limit_key);

  select w.user_id, p.license_number
    into v_user_id, v_license_number
  from public.websites w
  join public.profiles p on p.id = w.user_id
  join public.website_versions v on v.id = w.active_version_id and v.website_id = w.id and v.id = p_version_id
  join public.website_entitlements e
    on e.website_id = w.id and e.profile_id = w.user_id and e.environment = w.environment
  where w.id = p_website_id
    and w.status = 'live'
    and e.plan = 'starter'
    and e.state in ('active', 'grace')
    and e.quote_admission = true
    and e.effective_at <= pg_catalog.clock_timestamp()
    and (e.ends_at is null or e.ends_at > pg_catalog.clock_timestamp())
    and (v.config_json ->> 'contactHidden') is distinct from 'true'
  for update of w;

  if v_user_id is null then
    raise exception 'site is not accepting leads' using errcode = 'P0001';
  end if;

  insert into public.leads (
    website_id, user_id, license_number, form_data, field_snapshot, source_snapshot,
    submission_fingerprint, payload_hash, rate_limit_key
  ) values (
    p_website_id, v_user_id, v_license_number, p_form_data, p_field_snapshot, p_source_snapshot,
    p_submission_fingerprint, p_payload_hash, p_rate_limit_key
  ) returning id into v_lead_id;

  return v_lead_id;
end;
$$;

revoke all on function public.submit_starter_website_lead(uuid, uuid, jsonb, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_starter_website_lead(uuid, uuid, jsonb, jsonb, jsonb, text, text, text) to service_role;
