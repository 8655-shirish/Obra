-- Add Video media-effect closure. Historical schema-v2/v3 versions remain readers only;
-- these routines settle schema-v4 Add Video jobs using the existing attempts-fenced ledger.

create or replace function public.reserve_add_video_media_create(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,
  p_provider text,p_request_hash text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype; slot public.site_generation_media_slots%rowtype;
  reservation uuid; ordinal integer; v_tenant_id uuid; global_cap integer; tenant_cap integer;
  global_in_flight integer; tenant_in_flight integer;
begin
  if p_provider !~ '^[a-z0-9][a-z0-9_-]{0,63}$' or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Add Video provider identity is invalid' using errcode='22023';
  end if;
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video'
     or job.status<>'running' or job.attempts<>p_job_attempts then
    raise exception 'Add Video media ownership was lost' using errcode='40001';
  end if;
  select * into slot from public.site_generation_media_slots
    where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id for update;
  if not found or slot.status<>'generating' or slot.claim_attempt<>p_job_attempts
     or slot.provider_reservation_id is not null
     or slot.effect_certainty in ('indeterminate','definite_success')
     or slot.provider_create_count>=2
     or (slot.provider_create_count>0 and slot.effect_certainty<>'definite_failure') then
    raise exception 'Provider create budget is unavailable' using errcode='40001';
  end if;
  select user_id into v_tenant_id from public.websites where id=p_website_id;
  perform pg_advisory_xact_lock(hashtextextended('media-provider:'||p_provider,0));
  perform pg_advisory_xact_lock(hashtextextended('media-provider:'||p_provider||':tenant:'||v_tenant_id::text,0));
  select max_in_flight into global_cap from public.generation_media_provider_limits
    where provider=p_provider and tenant_id is null;
  select max_in_flight into tenant_cap from public.generation_media_provider_limits
    where provider=p_provider and tenant_id=v_tenant_id;
  global_cap:=coalesce(global_cap,8); tenant_cap:=coalesce(tenant_cap,2);
  select count(*) into global_in_flight from public.site_generation_media_slots
    where provider_name=p_provider and provider_reservation_id is not null
      and status in ('generating','reconciliation_required');
  select count(*) into tenant_in_flight from public.site_generation_media_slots media_slot
    join public.websites website on website.id=media_slot.website_id
    where media_slot.provider_name=p_provider and media_slot.provider_reservation_id is not null
      and media_slot.status in ('generating','reconciliation_required')
      and website.user_id=v_tenant_id;
  if global_in_flight>=global_cap or tenant_in_flight>=tenant_cap then
    raise exception 'Provider concurrency cap is saturated' using errcode='53000'; end if;
  ordinal:=slot.provider_create_count+1; reservation:=gen_random_uuid();
  update public.site_generation_media_slots set
    provider_create_count=ordinal,provider_name=p_provider,provider_reservation_id=reservation,
    provider_request_hash=p_request_hash,provider_idempotency_key=encode(extensions.digest(
      convert_to(p_job_id::text||':'||slot.id::text||':'||ordinal::text||':'||p_request_hash,'UTF8'),'sha256'),'hex'),
    provider_operation_id=null,provider_reserved_at=clock_timestamp(),effect_certainty='not_started'
  where id=slot.id;
  return jsonb_build_object('reservationId',reservation,'createOrdinal',ordinal,
    'idempotencyKey',(select provider_idempotency_key from public.site_generation_media_slots where id=slot.id));
end; $$;

create or replace function public.record_add_video_media_operation(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,
  p_reservation_id uuid,p_provider_operation_id text
) returns boolean
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype;
begin
  if nullif(btrim(p_provider_operation_id),'') is null then
    raise exception 'Provider operation ID is required' using errcode='22023'; end if;
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video'
     or job.status<>'running' or job.attempts<>p_job_attempts then return false; end if;
  update public.site_generation_media_slots set
    provider_operation_id=p_provider_operation_id,effect_certainty='indeterminate'
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id
    and status='generating' and claim_attempt=p_job_attempts
    and provider_reservation_id=p_reservation_id
    and (provider_operation_id is null or provider_operation_id=p_provider_operation_id);
  return found;
end; $$;

create or replace function public.settle_add_video_media_slot(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,
  p_reservation_id uuid,p_provider_operation_id text,p_status text,p_error_message text,
  p_effect_certainty text
) returns boolean
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype; settled boolean;
begin
  if p_status not in ('failed','abandoned')
     or p_effect_certainty not in ('not_started','definite_failure','definite_success','indeterminate')
     or (p_effect_certainty='definite_success' and p_status<>'failed') then
    raise exception 'Invalid Add Video media settlement' using errcode='22023'; end if;
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video'
     or job.status<>'running' or job.attempts<>p_job_attempts then return false; end if;
  update public.site_generation_media_slots set
    status=case when p_effect_certainty in ('indeterminate','definite_success') then 'reconciliation_required' else p_status end,
    error_message=left(p_error_message,1000),effect_certainty=p_effect_certainty,
    provider_operation_id=coalesce(p_provider_operation_id,provider_operation_id),
    reconciliation_required_at=case when p_effect_certainty in ('indeterminate','definite_success') then clock_timestamp() else null end,
    reconciliation_deadline=case when p_effect_certainty in ('indeterminate','definite_success') then clock_timestamp()+interval '1 hour' else null end,
    provider_reservation_id=case when p_effect_certainty in ('not_started','definite_failure') then null
      else coalesce(provider_reservation_id,p_reservation_id) end,
    provider_reserved_at=case when p_effect_certainty in ('not_started','definite_failure') then null
      else coalesce(provider_reserved_at,clock_timestamp()) end,
    retired_provider_operation_ids=case when provider_operation_id is not null and p_effect_certainty='definite_failure'
      and not(retired_provider_operation_ids ? provider_operation_id) then retired_provider_operation_ids||jsonb_build_array(provider_operation_id)
      else retired_provider_operation_ids end,
    abandoned_at=case when p_status='abandoned' and p_effect_certainty in ('not_started','definite_failure') then clock_timestamp() else null end
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id
    and status='generating' and claim_attempt=p_job_attempts
    and (p_reservation_id is null or provider_reservation_id=p_reservation_id);
  settled:=found; return settled;
end; $$;

create or replace function public.record_ready_add_video_media(
  p_job_id uuid,p_website_id uuid,p_job_attempts integer,p_slot_id text,
  p_reservation_id uuid,p_provider_operation_id text,p_storage_path text,p_source_slot_id text,
  p_content_hash text,p_byte_size bigint,p_duration_ms integer,p_width integer,p_height integer,
  p_video_codec text,p_video_profile text,p_has_audio boolean,p_audio_codec text,p_validator_version text
) returns uuid
language plpgsql security definer set search_path=public as $$
declare job public.background_jobs%rowtype; result_id uuid;
begin
  select * into job from public.background_jobs where id=p_job_id for update;
  if not found or job.website_id<>p_website_id or job.job_type<>'add_video'
     or job.status<>'running' or job.attempts<>p_job_attempts then
    raise exception 'Add Video media ownership was lost' using errcode='40001'; end if;
  update public.site_generation_media_slots set
    asset_id=p_content_hash,status='ready',storage_path=p_storage_path,mime_type='video/mp4',
    width=p_width,height=p_height,content_hash=p_content_hash,byte_size=p_byte_size,duration_ms=p_duration_ms,
    video_codec=lower(p_video_codec),video_profile=p_video_profile,has_audio=p_has_audio,audio_codec=p_audio_codec,
    validator_version=p_validator_version,error_message=null,abandoned_at=null,version_id=null,
    provider_operation_id=coalesce(p_provider_operation_id,provider_operation_id),effect_certainty='definite_success',
    reconciliation_required_at=null,reconciliation_deadline=null
  where job_id=p_job_id and website_id=p_website_id and slot_id=p_slot_id
    and status='generating' and claim_attempt=p_job_attempts
    and provider_reservation_id is not distinct from p_reservation_id
    and source_slot_id=p_source_slot_id and poster_slot_id=p_source_slot_id
  returning id into result_id;
  if result_id is null then raise exception 'Add Video media claim was lost before ready' using errcode='40001'; end if;
  return result_id;
end; $$;

revoke all on function public.reserve_add_video_media_create(uuid,uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.record_add_video_media_operation(uuid,uuid,integer,text,uuid,text) from public,anon,authenticated;
revoke all on function public.settle_add_video_media_slot(uuid,uuid,integer,text,uuid,text,text,text,text) from public,anon,authenticated;
revoke all on function public.record_ready_add_video_media(uuid,uuid,integer,text,uuid,text,text,text,text,bigint,integer,integer,integer,text,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.reserve_add_video_media_create(uuid,uuid,integer,text,text,text) to service_role;
grant execute on function public.record_add_video_media_operation(uuid,uuid,integer,text,uuid,text) to service_role;
grant execute on function public.settle_add_video_media_slot(uuid,uuid,integer,text,uuid,text,text,text,text) to service_role;
grant execute on function public.record_ready_add_video_media(uuid,uuid,integer,text,uuid,text,text,text,text,bigint,integer,integer,integer,text,text,boolean,text,text) to service_role;