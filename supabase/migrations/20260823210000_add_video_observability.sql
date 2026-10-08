-- Service-role-only Add video rollout observability and scheduled-call seam.
-- No scheduler is installed here; operators may invoke run_add_video_observability_check.

create table public.add_video_observability_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('revision_conflict', 'rpc_incompatibility')),
  job_id uuid,
  website_id uuid,
  source_version_id uuid,
  target_version_id uuid,
  request_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default now(),
  constraint add_video_observability_events_job_website_fkey foreign key (job_id, website_id)
    references public.background_jobs (id, website_id) on delete cascade,
  constraint add_video_observability_events_source_website_fkey foreign key (source_version_id, website_id)
    references public.website_versions (id, website_id) on delete restrict,
  constraint add_video_observability_events_target_website_fkey foreign key (target_version_id, website_id)
    references public.website_versions (id, website_id) on delete restrict,
  constraint add_video_observability_events_identity_check check (
    (job_id is null or website_id is not null) and
    (source_version_id is null or website_id is not null) and
    (target_version_id is null or website_id is not null)
  )
);
create index add_video_observability_events_type_time_idx on public.add_video_observability_events (event_type, occurred_at desc);
create index add_video_observability_events_job_idx on public.add_video_observability_events (job_id) where job_id is not null;
alter table public.add_video_observability_events enable row level security;
revoke all on table public.add_video_observability_events from public, anon, authenticated;
grant select on table public.add_video_observability_events to service_role;

create or replace function public.record_add_video_observability_event(
  p_event_type text, p_job_id uuid default null, p_website_id uuid default null,
  p_source_version_id uuid default null, p_target_version_id uuid default null,
  p_request_id uuid default null, p_details jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare inserted_id uuid; owned_job public.background_jobs%rowtype;
begin
  if p_event_type not in ('revision_conflict', 'rpc_incompatibility') then raise exception 'Unsupported Add video observability event type'; end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then raise exception 'Observability event details must be an object'; end if;
  if pg_column_size(p_details) > 8192 then raise exception 'Observability event details exceed 8 KiB'; end if;
  if p_job_id is not null then
    select * into owned_job from public.background_jobs where id=p_job_id and website_id=p_website_id and job_type='add_video';
    if not found then raise exception 'Add video job not found'; end if;
    if p_source_version_id is not null and p_source_version_id <> owned_job.source_version_id then raise exception 'Observability source version does not match job'; end if;
    if p_target_version_id is not null and p_target_version_id <> owned_job.target_version_id then raise exception 'Observability target version does not match job'; end if;
    if p_request_id is not null and p_request_id <> owned_job.request_id then raise exception 'Observability request does not match job'; end if;
  end if;
  insert into public.add_video_observability_events(event_type,job_id,website_id,source_version_id,target_version_id,request_id,details)
  values (p_event_type,p_job_id,p_website_id,coalesce(p_source_version_id,owned_job.source_version_id),
    coalesce(p_target_version_id,owned_job.target_version_id),coalesce(p_request_id,owned_job.request_id),p_details)
  returning id into inserted_id;
  return inserted_id;
end; $$;
revoke all on function public.record_add_video_observability_event(text,uuid,uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.record_add_video_observability_event(text,uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;

create or replace function public.get_add_video_observability_report(p_as_of timestamptz default now())
returns jsonb language sql stable security definer set search_path = public as $$
with windows(window_name, window_start) as (
  values ('24h'::text, p_as_of - interval '24 hours'), ('7d'::text, p_as_of - interval '7 days')
), jobs as (
  select b.*, coalesce(b.result_json->>'errorCode',b.payload_json->>'errorCode','') error_code,
    extract(epoch from (coalesce(b.completed_at,p_as_of)-coalesce(b.started_at,b.created_at)))*1000 duration_ms
  from public.background_jobs b where b.job_type='add_video' and b.created_at<=p_as_of
), slot_rollup as (
  select j.id job_id, coalesce(sum(s.provider_create_count),0)::bigint provider_creates,
    count(*) filter (where s.kind='video' and s.status='attached')::bigint attached_slots,
    count(*) filter (where s.kind='video' and exists (
      select 1 from public.website_version_media_slots a where a.website_id=j.website_id
        and a.version_id=j.target_version_id and a.slot_id=s.slot_id and a.asset_id=s.asset_id
        and a.storage_path=s.storage_path and lower(a.mime_type)='video/mp4'))::bigint version_video_attachments,
    count(*) filter (where s.kind='video' and s.provider_operation_id is not null
      and s.retired_provider_operation_ids ? s.provider_operation_id)::bigint terminal_reuses,
    count(*) filter (where s.kind='video' and s.status='attached' and exists (
      select 1 from public.website_version_media_slots a where a.website_id=j.website_id
        and a.version_id=j.target_version_id and a.slot_id=s.slot_id and a.asset_id=s.asset_id
        and a.storage_path=s.storage_path and lower(a.mime_type)='video/mp4'))::bigint matching_attachments,
    max(s.byte_size) filter (where s.kind='video') video_bytes
  from jobs j left join public.site_generation_media_slots s on s.job_id=j.id and s.website_id=j.website_id group by j.id
), alerts as (
  select 'repeated_terminal_operation_reuse'::text alert_type,j.id job_id,j.website_id,j.source_version_id,j.target_version_id,j.request_id,
    jsonb_build_object('count',r.terminal_reuses) details from jobs j join slot_rollup r on r.job_id=j.id where r.terminal_reuses>0
  union all select 'provider_operation_budget_exceeded',j.id,j.website_id,j.source_version_id,j.target_version_id,j.request_id,
    jsonb_build_object('providerCreateCount',r.provider_creates) from jobs j join slot_rollup r on r.job_id=j.id where r.provider_creates>2
  union all select 'completed_job_attachment_mismatch',j.id,j.website_id,j.source_version_id,j.target_version_id,j.request_id,
    jsonb_build_object('matchingAttachmentCount',r.matching_attachments,'attachedLedgerCount',r.attached_slots)
    from jobs j join slot_rollup r on r.job_id=j.id where j.status='completed' and r.matching_attachments<>1
  union all select 'attached_video_without_completed_job',j.id,j.website_id,j.source_version_id,j.target_version_id,j.request_id,
    jsonb_build_object('jobStatus',j.status,'attachedLedgerCount',r.attached_slots,'versionAttachmentCount',r.version_video_attachments)
    from jobs j join slot_rollup r on r.job_id=j.id where j.status<>'completed' and r.version_video_attachments>0
  union all select e.event_type,e.job_id,e.website_id,e.source_version_id,e.target_version_id,e.request_id,e.details
    from public.add_video_observability_events e where e.occurred_at<=p_as_of
  union all select 'revision_conflict',j.id,j.website_id,j.source_version_id,j.target_version_id,j.request_id,jsonb_build_object('errorCode',j.error_code)
    from jobs j where j.error_code in ('revision_conflict','version_revision_conflict','website_version_revision_conflict')
      or lower(coalesce(j.error_message,'')) like '%revision conflict%'
  union all select 'rpc_incompatibility',j.id,j.website_id,j.source_version_id,j.target_version_id,j.request_id,jsonb_build_object('errorCode',j.error_code)
    from jobs j where j.error_code in ('rpc_incompatible','rpc_incompatibility','missing_rpc')
), metrics as (
  select w.window_name,jsonb_build_object(
    'windowStart',w.window_start,'windowEnd',p_as_of,'enqueued',count(j.id),
    'terminalNonCancelled',count(j.id) filter(where j.status in ('completed','failed')),
    'completed',count(j.id) filter(where j.status='completed'),
    'completionRate',coalesce(round(count(j.id) filter(where j.status='completed')::numeric/
      nullif(count(j.id) filter(where j.status in ('completed','failed')),0),4),0),
    'cancelled',count(j.id) filter(where j.status='cancelled'),
    'revisionConflicts',count(j.id) filter(where j.error_code in ('revision_conflict','version_revision_conflict','website_version_revision_conflict')
      or lower(coalesce(j.error_message,'')) like '%revision conflict%'),
    'revisionConflictRate',coalesce(round(count(j.id) filter(where j.error_code in ('revision_conflict','version_revision_conflict','website_version_revision_conflict')
      or lower(coalesce(j.error_message,'')) like '%revision conflict%')::numeric/
      nullif(count(j.id) filter(where j.status in ('completed','failed')),0),4),0),
    'medianDurationMs',percentile_cont(0.5) within group(order by j.duration_ms) filter(where j.status in ('completed','failed')),
    'p95DurationMs',percentile_cont(0.95) within group(order by j.duration_ms) filter(where j.status in ('completed','failed')),
    'meanProviderCreatesPerSuccess',coalesce(round(avg(r.provider_creates) filter(where j.status='completed'),4),0),
    'maxProviderCreatesPerJob',coalesce(max(r.provider_creates),0),
    'p95VideoBytes',percentile_cont(0.95) within group(order by r.video_bytes) filter(where j.status='completed' and r.video_bytes is not null)
  ) value from windows w left join jobs j on j.created_at>=w.window_start
  left join slot_rollup r on r.job_id=j.id group by w.window_name,w.window_start
), orphan_metrics as (
  select count(*)::bigint eligible_count,min(coalesce(s.abandoned_at,s.updated_at)) oldest_at
  from public.site_generation_media_slots s join public.background_jobs j on j.id=s.job_id and j.website_id=s.website_id
  where j.job_type='add_video' and s.kind='video' and s.version_id is null and s.status in ('ready','abandoned')
    and coalesce(s.abandoned_at,s.updated_at)<=p_as_of-interval '24 hours'
)
select jsonb_build_object('asOf',p_as_of,
  'alerts',coalesce((select jsonb_agg(jsonb_build_object('type',alert_type,'jobId',job_id,'websiteId',website_id,
    'sourceVersionId',source_version_id,'targetVersionId',target_version_id,'requestId',request_id,'details',details) order by alert_type,job_id) from alerts),'[]'::jsonb),
  'metrics',coalesce((select jsonb_object_agg(window_name,value) from metrics),'{}'::jsonb),
  'orphans',(select jsonb_build_object('eligibleCount',eligible_count,'oldestEligibleAt',oldest_at,
    'oldestEligibleAgeSeconds',case when oldest_at is null then null else extract(epoch from (p_as_of-oldest_at)) end) from orphan_metrics));
$$;
revoke all on function public.get_add_video_observability_report(timestamptz) from public, anon, authenticated;
grant execute on function public.get_add_video_observability_report(timestamptz) to service_role;

create table public.add_video_observability_runs (
  id uuid primary key default gen_random_uuid(),
  as_of timestamptz not null,
  report jsonb not null check (jsonb_typeof(report)='object'),
  created_at timestamptz not null default now()
);
create index add_video_observability_runs_created_at_idx on public.add_video_observability_runs(created_at desc);
alter table public.add_video_observability_runs enable row level security;
revoke all on table public.add_video_observability_runs from public, anon, authenticated;
grant select, insert on table public.add_video_observability_runs to service_role;

create or replace function public.run_add_video_observability_check(p_dry_run boolean default true,p_as_of timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare report_value jsonb; inserted_run_id uuid;
begin
  report_value:=public.get_add_video_observability_report(p_as_of);
  if not p_dry_run then insert into public.add_video_observability_runs(as_of,report) values(p_as_of,report_value) returning id into inserted_run_id; end if;
  return report_value||jsonb_build_object('dryRun',p_dry_run,'runId',inserted_run_id);
end; $$;
revoke all on function public.run_add_video_observability_check(boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.run_add_video_observability_check(boolean,timestamptz) to service_role;
