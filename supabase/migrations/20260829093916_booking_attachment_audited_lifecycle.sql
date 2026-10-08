-- Audited, fail-closed booking attachment lifecycle. Uploads remain disabled until
-- an operator explicitly enables them after a fresh clean + EICAR proof for this config.

alter table public.booking_attachment_security
  add column if not exists scanner_environment text check (scanner_environment in ('test','live')),
  add column if not exists scanner_config_fingerprint text,
  add column if not exists clean_proven_at timestamptz,
  add column if not exists eicar_proven_at timestamptz,
  add column if not exists proof_expires_at timestamptz,
  add column if not exists clean_probe_checksum text,
  add column if not exists eicar_probe_checksum text;

-- A pre-existing enabled row has no config-bound dual proof and must fail closed.
update public.booking_attachment_security
set upload_enabled=false, updated_at=pg_catalog.clock_timestamp()
where upload_enabled and (
  scanner_environment is null or scanner_config_fingerprint is null or
  clean_proven_at is null or eicar_proven_at is null or proof_expires_at is null
);

alter table public.booking_attachment_security
  drop constraint if exists booking_attachment_security_audited_proof_ck,
  add constraint booking_attachment_security_audited_proof_ck check (
    not upload_enabled or (
      scanner_provider is not null and scanner_proven_at is not null and
      scanner_environment is not null and scanner_config_fingerprint ~ '^[a-f0-9]{64}$' and
      clean_proven_at is not null and eicar_proven_at is not null and proof_expires_at is not null and
      clean_probe_checksum ~ '^[a-f0-9]{64}$' and eicar_probe_checksum ~ '^[a-f0-9]{64}$'
    )
  );

alter table public.booking_attachments
  add column if not exists scan_config_fingerprint text,
  add column if not exists scanned_checksum text,
  add column if not exists scanner_verdict_id text,
  add column if not exists scan_proven_at timestamptz,
  add column if not exists legal_hold_at timestamptz,
  add column if not exists legal_hold_reason text,
  add column if not exists cleanup_lease_token uuid,
  add column if not exists cleanup_lease_expires_at timestamptz,
  add column if not exists cleanup_fencing_token bigint not null default 0 check (cleanup_fencing_token>=0),
  add column if not exists cleanup_reason text check (cleanup_reason in ('orphan','retention'));

create table if not exists public.booking_attachment_audit_events(
  id bigint generated always as identity primary key,
  attachment_id uuid,
  profile_id uuid,
  environment text not null check(environment in ('test','live')),
  event_type text not null check(event_type in (
    'scanner_proof','attachment_created','attachment_uploaded','scan_clean','scan_rejected',
    'scan_retry','download_authorized','orphan_deleted','retention_deleted',
    'legal_hold_set','legal_hold_released'
  )),
  actor_auth_user_id uuid,
  evidence jsonb not null default '{}'::jsonb check(pg_catalog.jsonb_typeof(evidence)='object'),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.booking_attachment_audit_events enable row level security;
revoke all on public.booking_attachment_audit_events from public,anon,authenticated,service_role;

create or replace function public.reject_booking_attachment_audit_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'booking attachment audit is immutable' using errcode='P0001';
end $$;
revoke all on function public.reject_booking_attachment_audit_mutation() from public,anon,authenticated;
grant execute on function public.reject_booking_attachment_audit_mutation() to service_role;
drop trigger if exists booking_attachment_audit_immutable on public.booking_attachment_audit_events;
create trigger booking_attachment_audit_immutable before update or delete on public.booking_attachment_audit_events
for each row execute function public.reject_booking_attachment_audit_mutation();
drop trigger if exists booking_attachment_audit_no_truncate on public.booking_attachment_audit_events;
create trigger booking_attachment_audit_no_truncate before truncate on public.booking_attachment_audit_events
for each statement execute function public.reject_booking_attachment_audit_mutation();

create or replace function public.booking_attachment_scanner_ready(p_config_fingerprint text,p_environment text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.booking_attachment_security
    where singleton and upload_enabled
      and scanner_environment=p_environment
      and scanner_config_fingerprint=p_config_fingerprint
      and scanner_config_fingerprint ~ '^[a-f0-9]{64}$'
      and clean_proven_at>=pg_catalog.clock_timestamp()-interval '24 hours'
      and eicar_proven_at>=pg_catalog.clock_timestamp()-interval '24 hours'
      and proof_expires_at>pg_catalog.clock_timestamp()
      and scanner_proven_at>=greatest(clean_proven_at,eicar_proven_at)
  )
$$;
revoke all on function public.booking_attachment_scanner_ready(text,text) from public,anon,authenticated;
grant execute on function public.booking_attachment_scanner_ready(text,text) to service_role;

create or replace function public.record_booking_attachment_scanner_proof(
  p_provider text,p_environment text,p_config_fingerprint text,
  p_clean_was_clean boolean,p_eicar_was_rejected boolean,
  p_clean_checksum text,p_eicar_checksum text,
  p_clean_verdict_id text,p_eicar_verdict_id text
) returns boolean language plpgsql security definer set search_path='' as $$
declare now_at timestamptz:=pg_catalog.clock_timestamp(); prior_fingerprint text; prior_enabled boolean;
begin
  if nullif(pg_catalog.btrim(p_provider),'') is null or p_environment not in ('test','live')
    or p_config_fingerprint!~'^[a-f0-9]{64}$'
    or not p_clean_was_clean or not p_eicar_was_rejected
    or p_clean_checksum!~'^[a-f0-9]{64}$' or p_eicar_checksum!~'^[a-f0-9]{64}$'
    or nullif(pg_catalog.btrim(p_clean_verdict_id),'') is null
    or nullif(pg_catalog.btrim(p_eicar_verdict_id),'') is null then
    raise exception 'invalid scanner proof' using errcode='22023';
  end if;
  select scanner_config_fingerprint,upload_enabled into prior_fingerprint,prior_enabled
    from public.booking_attachment_security where singleton for update;
  update public.booking_attachment_security set
    scanner_provider=left(pg_catalog.btrim(p_provider),100),
    scanner_environment=p_environment,
    scanner_config_fingerprint=p_config_fingerprint,
    clean_proven_at=now_at,eicar_proven_at=now_at,scanner_proven_at=now_at,
    proof_expires_at=now_at+interval '24 hours',
    clean_probe_checksum=p_clean_checksum,eicar_probe_checksum=p_eicar_checksum,
    upload_enabled=case when prior_fingerprint=p_config_fingerprint then prior_enabled else false end,
    updated_at=now_at
  where singleton;
  insert into public.booking_attachment_audit_events(environment,event_type,evidence)
  values(p_environment,'scanner_proof',pg_catalog.jsonb_build_object(
    'provider',left(pg_catalog.btrim(p_provider),100),'configFingerprint',p_config_fingerprint,
    'cleanChecksum',p_clean_checksum,'eicarChecksum',p_eicar_checksum,
    'cleanVerdictId',left(p_clean_verdict_id,200),'eicarVerdictId',left(p_eicar_verdict_id,200),
    'expiresAt',(now_at+interval '24 hours')::text
  ));
  return true;
end $$;
revoke all on function public.record_booking_attachment_scanner_proof(text,text,text,boolean,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_booking_attachment_scanner_proof(text,text,text,boolean,boolean,text,text,text,text) to service_role;

-- Retire unfingerprinted state transitions. Callers must use the audited commands below.
create or replace function public.create_public_booking_attachment_record(
  p_attachment_id uuid,p_appointment_id uuid,p_original_filename text,p_display_filename text,
  p_mime_type text,p_byte_size bigint,p_checksum text,p_quota_slot smallint
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
begin raise exception 'unfingerprinted attachment command is disabled' using errcode='P0001';end $$;

create or replace function public.mark_booking_attachment_uploaded(
  p_attachment_id uuid,p_profile_id uuid,p_environment text,p_storage_object_key text,
  p_byte_size bigint,p_checksum text
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
begin raise exception 'unfingerprinted attachment command is disabled' using errcode='P0001';end $$;

create or replace function public.complete_booking_attachment_scan(
  p_attachment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_outcome text,p_safe_error text default null
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
begin raise exception 'unaudited attachment scan command is disabled' using errcode='P0001';end $$;

create or replace function public.create_public_booking_attachment_record_audited(
  p_attachment_id uuid,p_appointment_id uuid,p_original_filename text,p_display_filename text,
  p_mime_type text,p_byte_size bigint,p_checksum text,p_quota_slot smallint,p_config_fingerprint text
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype;result public.booking_attachments%rowtype;object_key text;
begin
  if p_attachment_id is null or p_quota_slot not between 1 and 5
    or p_mime_type not in('image/jpeg','image/png','image/webp')
    or p_byte_size not between 1 and 10485760 or p_checksum!~'^[a-f0-9]{64}$' then
    raise exception 'invalid attachment request' using errcode='22023';
  end if;
  select * into strict a from public.appointments where id=p_appointment_id
    and appointment_state in('held','payment_pending')
    and reservation_expires_at>pg_catalog.clock_timestamp() for update;
  if not public.booking_attachment_scanner_ready(p_config_fingerprint,a.environment) then
    raise exception 'attachment scanner proof is stale or mismatched' using errcode='P0001';
  end if;
  object_key:=a.environment||'/'||a.profile_id::text||'/'||a.website_id::text||'/'||a.id::text||'/'||p_attachment_id::text;
  insert into public.booking_attachments(
    id,appointment_id,customer_id,profile_id,website_id,environment,storage_object_key,
    original_filename,display_filename,mime_type,byte_size,checksum,quota_slot
  ) values(
    p_attachment_id,a.id,a.customer_id,a.profile_id,a.website_id,a.environment,object_key,
    left(p_original_filename,255),left(p_display_filename,120),p_mime_type,p_byte_size,p_checksum,p_quota_slot
  ) returning * into result;
  insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,evidence)
  values(result.id,result.profile_id,result.environment,'attachment_created',
    pg_catalog.jsonb_build_object('checksum',result.checksum,'byteSize',result.byte_size,'quotaSlot',result.quota_slot));
  return result;
end $$;
revoke all on function public.create_public_booking_attachment_record_audited(uuid,uuid,text,text,text,bigint,text,smallint,text) from public,anon,authenticated;
grant execute on function public.create_public_booking_attachment_record_audited(uuid,uuid,text,text,text,bigint,text,smallint,text) to service_role;

create or replace function public.mark_booking_attachment_uploaded_audited(
  p_attachment_id uuid,p_profile_id uuid,p_environment text,p_storage_object_key text,
  p_byte_size bigint,p_checksum text,p_config_fingerprint text
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
declare result public.booking_attachments%rowtype;
begin
  if p_byte_size<=0 or p_checksum!~'^[a-f0-9]{64}$'
    or not public.booking_attachment_scanner_ready(p_config_fingerprint,p_environment)
    or not exists(
      select 1 from storage.objects where bucket_id='booking-attachments' and name=p_storage_object_key
        and metadata ? 'size' and metadata->>'size' ~ '^[1-9][0-9]{0,18}$'
        and pg_catalog.length(metadata->>'size')<19 and (metadata->>'size')::bigint=p_byte_size
    ) then raise exception 'uploaded storage object is not proven' using errcode='P0001';end if;
  perform pg_catalog.set_config('app.attachment_state_transition',p_attachment_id::text,true);
  update public.booking_attachments set upload_state='uploaded',byte_size=p_byte_size,checksum=p_checksum,state_version=state_version+1
  where id=p_attachment_id and profile_id=p_profile_id and environment=p_environment
    and storage_object_key=p_storage_object_key and upload_state='pending' and checksum=p_checksum returning * into result;
  perform pg_catalog.set_config('app.attachment_state_transition','',true);
  if result.id is null then raise exception 'attachment upload identity or state mismatch' using errcode='P0001';end if;
  insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,evidence)
  values(result.id,result.profile_id,result.environment,'attachment_uploaded',
    pg_catalog.jsonb_build_object('checksum',result.checksum,'byteSize',result.byte_size));
  return result;
exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;
end $$;
revoke all on function public.mark_booking_attachment_uploaded_audited(uuid,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.mark_booking_attachment_uploaded_audited(uuid,uuid,text,text,bigint,text,text) to service_role;

create or replace function public.complete_booking_attachment_scan_audited(
  p_attachment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_outcome text,p_safe_error text,
  p_config_fingerprint text,p_scanned_checksum text,p_scanner_verdict_id text default null
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
declare result public.booking_attachments%rowtype;current_row public.booking_attachments%rowtype;event_name text;
begin
  if p_outcome not in('clean','rejected','scanner_unavailable') or p_scanned_checksum!~'^[a-f0-9]{64}$' then
    raise exception 'invalid scan outcome' using errcode='22023';end if;
  select * into strict current_row from public.booking_attachments where id=p_attachment_id for update;
  if current_row.checksum<>p_scanned_checksum then raise exception 'attachment scan digest mismatch' using errcode='P0001';end if;
  if p_outcome in('clean','rejected') and (
    nullif(pg_catalog.btrim(p_scanner_verdict_id),'') is null or
    not public.booking_attachment_scanner_ready(p_config_fingerprint,current_row.environment)
  ) then raise exception 'attachment scanner proof is stale or mismatched' using errcode='P0001';end if;
  perform pg_catalog.set_config('app.attachment_state_transition',p_attachment_id::text,true);
  update public.booking_attachments set
    upload_state=case when p_outcome='clean' then 'clean' when p_outcome='rejected' or scan_attempts>=8 then 'rejected' else 'quarantined' end,
    scan_error=case when p_outcome='clean' then null else left(coalesce(p_safe_error,'Attachment scanner unavailable'),200) end,
    scan_lease_token=null,
    scan_lease_expires_at=case when p_outcome='scanner_unavailable' and scan_attempts<8
      then pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*(2^least(scan_attempts,7))::integer)) else null end,
    state_version=state_version+1,
    scan_config_fingerprint=case when p_outcome in('clean','rejected') then p_config_fingerprint else scan_config_fingerprint end,
    scanned_checksum=case when p_outcome in('clean','rejected') then p_scanned_checksum else scanned_checksum end,
    scanner_verdict_id=case when p_outcome in('clean','rejected') then left(p_scanner_verdict_id,200) else scanner_verdict_id end,
    scan_proven_at=case when p_outcome in('clean','rejected') then pg_catalog.clock_timestamp() else scan_proven_at end,
    finalized_at=case when p_outcome in('clean','rejected') or scan_attempts>=8 then pg_catalog.clock_timestamp() else finalized_at end
  where id=p_attachment_id and upload_state='quarantined' and scan_lease_token=p_lease_token
    and scan_fencing_token=p_fencing_token and scan_lease_expires_at>=pg_catalog.clock_timestamp()
  returning * into result;
  perform pg_catalog.set_config('app.attachment_state_transition','',true);
  if result.id is null then raise exception 'stale attachment scan fence' using errcode='40001';end if;
  event_name:=case when result.upload_state='clean' then 'scan_clean' when result.upload_state='rejected' then 'scan_rejected' else 'scan_retry' end;
  insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,evidence)
  values(result.id,result.profile_id,result.environment,event_name,
    pg_catalog.jsonb_build_object('checksum',p_scanned_checksum,'configFingerprint',p_config_fingerprint,
      'verdictId',left(coalesce(p_scanner_verdict_id,''),200),'attempt',result.scan_attempts));
  return result;
exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;
end $$;
revoke all on function public.complete_booking_attachment_scan_audited(uuid,uuid,bigint,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.complete_booking_attachment_scan_audited(uuid,uuid,bigint,text,text,text,text,text) to service_role;

create or replace function public.list_clean_contractor_booking_attachments(
  p_actor_auth_user_id uuid,p_appointment_ids uuid[]
) returns table(id uuid,appointment_id uuid,display_filename text,mime_type text,byte_size bigint,finalized_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare owner public.profiles%rowtype;
begin
  if p_actor_auth_user_id is null or coalesce(pg_catalog.array_length(p_appointment_ids,1),0)>25 then
    raise exception 'invalid attachment listing request' using errcode='22023';end if;
  select * into strict owner from public.profiles where auth_user_id=p_actor_auth_user_id;
  return query select b.id,b.appointment_id,b.display_filename,b.mime_type,b.byte_size,b.finalized_at
  from public.booking_attachments b
  where b.profile_id=owner.id and b.environment=owner.environment and b.upload_state='clean'
    and b.scanned_checksum=b.checksum and b.scan_config_fingerprint~'^[a-f0-9]{64}$'
    and b.scanner_verdict_id is not null and b.scan_proven_at is not null
    and b.deleted_at is null and b.appointment_id=any(p_appointment_ids)
  order by b.appointment_id,b.quota_slot;
end $$;
revoke all on function public.list_clean_contractor_booking_attachments(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.list_clean_contractor_booking_attachments(uuid,uuid[]) to service_role;

create or replace function public.authorize_booking_attachment_download(
  p_actor_auth_user_id uuid,p_attachment_id uuid
) returns table(storage_object_key text,display_filename text,mime_type text)
language plpgsql security definer set search_path='' as $$
declare owner public.profiles%rowtype;item public.booking_attachments%rowtype;
begin
  if p_actor_auth_user_id is null or p_attachment_id is null then raise exception 'invalid download request' using errcode='22023';end if;
  select * into strict owner from public.profiles where auth_user_id=p_actor_auth_user_id;
  select * into strict item from public.booking_attachments where id=p_attachment_id
    and profile_id=owner.id and environment=owner.environment and upload_state='clean'
    and scanned_checksum=checksum and scan_config_fingerprint~'^[a-f0-9]{64}$'
    and scanner_verdict_id is not null and scan_proven_at is not null and deleted_at is null;
  insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,actor_auth_user_id,evidence)
  values(item.id,item.profile_id,item.environment,'download_authorized',p_actor_auth_user_id,
    pg_catalog.jsonb_build_object('checksum',item.checksum));
  return query select item.storage_object_key,item.display_filename,item.mime_type;
end $$;
revoke all on function public.authorize_booking_attachment_download(uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_booking_attachment_download(uuid,uuid) to service_role;

-- Remove the old unaudited direct-storage read path. Contractors use the authenticated route,
-- which authorizes clean state, records an audit event, and creates a 60-second signed URL.
drop policy if exists booking_attachments_owner_read on storage.objects;
revoke execute on function public.can_read_clean_booking_attachment(text) from authenticated;

create or replace function public.set_booking_attachment_legal_hold(
  p_attachment_id uuid,p_held boolean,p_actor_auth_user_id uuid,p_reason text
) returns boolean language plpgsql security definer set search_path='' as $$
declare item public.booking_attachments%rowtype;
begin
  if p_attachment_id is null or p_actor_auth_user_id is null or nullif(pg_catalog.btrim(p_reason),'') is null then
    raise exception 'legal hold actor and reason required' using errcode='22023';end if;
  update public.booking_attachments set legal_hold_at=case when p_held then pg_catalog.clock_timestamp() else null end,
    legal_hold_reason=case when p_held then left(pg_catalog.btrim(p_reason),500) else null end
  where id=p_attachment_id and upload_state<>'deleted'
    and (cleanup_lease_expires_at is null or cleanup_lease_expires_at<=pg_catalog.clock_timestamp())
  returning * into item;
  if item.id is null then raise exception 'attachment is unavailable' using errcode='P0001';end if;
  insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,actor_auth_user_id,evidence)
  values(item.id,item.profile_id,item.environment,case when p_held then 'legal_hold_set' else 'legal_hold_released' end,
    p_actor_auth_user_id,pg_catalog.jsonb_build_object('reason',left(pg_catalog.btrim(p_reason),500)));
  return true;
end $$;
revoke all on function public.set_booking_attachment_legal_hold(uuid,boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.set_booking_attachment_legal_hold(uuid,boolean,uuid,text) to service_role;

create or replace function public.claim_booking_attachment_cleanup(p_lease_token uuid,p_limit integer default 25)
returns table(id uuid,storage_object_key text,cleanup_reason text,cleanup_fencing_token bigint)
language plpgsql security definer set search_path='' as $$
begin
  if p_lease_token is null or p_limit not between 1 and 100 then raise exception 'invalid cleanup claim' using errcode='22023';end if;
  return query with eligible as(
    select b.id,
      case when rp.production_approved and rp.deletion_mode='automatic' and rp.retention_days is not null
        and coalesce(b.finalized_at,b.created_at)<pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>rp.retention_days)
      then 'retention' else 'orphan' end as reason
    from public.booking_attachments b
    join public.appointments a on a.id=b.appointment_id and a.profile_id=b.profile_id and a.environment=b.environment
    left join public.data_retention_policies rp on rp.data_class='booking_attachments'
    left join public.data_retention_policies op on op.data_class='abandoned_holds'
    where b.upload_state<>'deleted' and b.deleted_at is null and b.legal_hold_at is null
      and (b.cleanup_lease_expires_at is null or b.cleanup_lease_expires_at<=pg_catalog.clock_timestamp())
      and (b.scan_lease_expires_at is null or b.scan_lease_expires_at<=pg_catalog.clock_timestamp())
      and (
        (rp.production_approved and rp.deletion_mode='automatic' and rp.retention_days is not null
          and coalesce(b.finalized_at,b.created_at)<pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>rp.retention_days))
        or
        (op.production_approved and op.deletion_mode='automatic' and op.retention_days is not null
          and a.appointment_state='cancelled' and a.payment_state<>'paid'
          and a.reservation_expires_at<pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>op.retention_days))
      )
    order by b.created_at for update of b skip locked limit p_limit
  ),claimed as(
    update public.booking_attachments b set cleanup_lease_token=p_lease_token,
      cleanup_lease_expires_at=pg_catalog.clock_timestamp()+interval '2 minutes',
      cleanup_fencing_token=b.cleanup_fencing_token+1,cleanup_reason=eligible.reason
    from eligible where b.id=eligible.id
    returning b.id,b.storage_object_key,b.cleanup_reason,b.cleanup_fencing_token
  ) select c.id,c.storage_object_key,c.cleanup_reason,c.cleanup_fencing_token from claimed c;
end $$;
revoke all on function public.claim_booking_attachment_cleanup(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_booking_attachment_cleanup(uuid,integer) to service_role;

create or replace function public.complete_booking_attachment_cleanup(
  p_attachment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_object_removed boolean
) returns boolean language plpgsql security definer set search_path='' as $$
declare item public.booking_attachments%rowtype;a public.appointments%rowtype;policy public.data_retention_policies%rowtype;
begin
  select * into strict item from public.booking_attachments where id=p_attachment_id and cleanup_lease_token=p_lease_token
    and cleanup_fencing_token=p_fencing_token and cleanup_lease_expires_at>=pg_catalog.clock_timestamp() for update;
  if not p_object_removed then
    update public.booking_attachments set cleanup_lease_token=null,cleanup_lease_expires_at=null,cleanup_reason=null where id=item.id;
    return false;
  end if;
  if item.legal_hold_at is not null then raise exception 'attachment is on legal hold' using errcode='P0001';end if;
  select * into strict a from public.appointments where id=item.appointment_id;
  select * into strict policy from public.data_retention_policies
    where data_class=case when item.cleanup_reason='retention' then 'booking_attachments' else 'abandoned_holds' end;
  if not policy.production_approved or policy.deletion_mode<>'automatic' or policy.retention_days is null
    or (item.cleanup_reason='retention' and coalesce(item.finalized_at,item.created_at)>=pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>policy.retention_days))
    or (item.cleanup_reason='orphan' and (a.appointment_state<>'cancelled' or a.payment_state='paid'
      or a.reservation_expires_at>=pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>policy.retention_days))) then
    raise exception 'attachment cleanup policy no longer permits deletion' using errcode='P0001';
  end if;
  perform pg_catalog.set_config('app.attachment_state_transition',item.id::text,true);
  update public.booking_attachments set upload_state='deleted',deleted_at=pg_catalog.clock_timestamp(),
    scan_lease_token=null,scan_lease_expires_at=null,cleanup_lease_token=null,cleanup_lease_expires_at=null,
    state_version=state_version+1 where id=item.id;
  perform pg_catalog.set_config('app.attachment_state_transition','',true);
  insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,evidence)
  values(item.id,item.profile_id,item.environment,
    case when item.cleanup_reason='retention' then 'retention_deleted' else 'orphan_deleted' end,
    pg_catalog.jsonb_build_object('policyClass',case when item.cleanup_reason='retention' then 'booking_attachments' else 'abandoned_holds' end,
      'retentionDays',policy.retention_days,'storageRemoved',true));
  return true;
exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;
end $$;
revoke all on function public.complete_booking_attachment_cleanup(uuid,uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.complete_booking_attachment_cleanup(uuid,uuid,bigint,boolean) to service_role;

-- Scan and cleanup leases exclude one another so storage deletion cannot race a verdict.
create or replace function public.list_due_booking_attachment_scans(p_limit integer default 10)
returns setof public.booking_attachments language sql security definer set search_path='' as $$
  select * from public.booking_attachments
  where upload_state in('uploaded','quarantined')
    and (scan_lease_expires_at is null or scan_lease_expires_at<=pg_catalog.clock_timestamp())
    and (cleanup_lease_expires_at is null or cleanup_lease_expires_at<=pg_catalog.clock_timestamp())
  order by created_at limit greatest(1,least(coalesce(p_limit,10),50))
$$;
revoke all on function public.list_due_booking_attachment_scans(integer) from public,anon,authenticated;
grant execute on function public.list_due_booking_attachment_scans(integer) to service_role;

create or replace function public.claim_booking_attachment_scan(
  p_attachment_id uuid,p_lease_token uuid,p_lease_seconds integer
) returns bigint language plpgsql security definer set search_path='' as $$
declare next_fence bigint;
begin
  if p_lease_token is null or p_lease_seconds not between 1 and 900 then raise exception 'invalid scan lease' using errcode='22023';end if;
  perform pg_catalog.set_config('app.attachment_state_transition',p_attachment_id::text,true);
  update public.booking_attachments set upload_state='quarantined',scan_lease_token=p_lease_token,
    scan_lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
    scan_fencing_token=scan_fencing_token+1,scan_attempts=scan_attempts+1,state_version=state_version+1
  where id=p_attachment_id and upload_state in('uploaded','quarantined')
    and (scan_lease_expires_at is null or scan_lease_expires_at<=pg_catalog.clock_timestamp())
    and (cleanup_lease_expires_at is null or cleanup_lease_expires_at<=pg_catalog.clock_timestamp())
  returning scan_fencing_token into next_fence;
  perform pg_catalog.set_config('app.attachment_state_transition','',true);
  if next_fence is null then raise exception 'attachment scan unavailable' using errcode='P0001';end if;
  return next_fence;
exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;
end $$;
revoke all on function public.claim_booking_attachment_scan(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_booking_attachment_scan(uuid,uuid,integer) to service_role;
