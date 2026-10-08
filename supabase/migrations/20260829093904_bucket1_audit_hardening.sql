-- Bucket 1 audit hardening. This migration is intentionally provider-independent.

-- A paid subscription belongs to one purchased website, while shared booking
-- configuration remains profile-scoped.
drop index if exists public.subscriptions_one_active_per_profile;

alter table public.subscriptions
  add column if not exists last_provider_event_id text;

-- Readiness flags describe configured capabilities; lifecycle state separately
-- gates whether those capabilities may be used.
alter table public.website_entitlements
  drop constraint if exists website_entitlements_admission_check,
  add constraint website_entitlements_admission_check check (
    (booking_admission = false or plan = 'pro')
    and (quote_admission = false or plan = 'starter')
  );
do $$ begin
  if exists (select subscription_id,environment from public.website_entitlements
    where subscription_id is not null group by subscription_id,environment having count(*) > 1) then
    raise exception 'duplicate entitlement subscriptions require reconciliation';
  end if;
  if exists (select 1 from public.appointments a join public.website_entitlements e on e.id=a.entitlement_id
    where (a.website_id,a.profile_id,a.environment) is distinct from (e.website_id,e.profile_id,e.environment)) then
    raise exception 'appointment entitlement tenant mismatch requires reconciliation';
  end if;
  if exists (select 1 from public.calendar_event_links l join public.calendar_selections s on s.id=l.calendar_selection_id
    where (l.connection_id,l.profile_id,l.environment) is distinct from (s.connection_id,s.profile_id,s.environment)) then
    raise exception 'calendar selection tenant mismatch requires reconciliation';
  end if;
end $$;

create unique index if not exists website_entitlements_subscription_environment_uk
  on public.website_entitlements(subscription_id, environment)
  where subscription_id is not null;

-- Preserve exact website/entitlement identity for appointments.
alter table public.website_entitlements
  drop constraint if exists website_entitlements_id_website_tenant_uk,
  add constraint website_entitlements_id_website_tenant_uk
  unique (id, website_id, profile_id, environment);

alter table public.appointments
  drop constraint if exists appointments_entitlement_id_profile_id_environment_fkey,
  drop constraint if exists appointments_entitlement_website_tenant_fkey,
  add constraint appointments_entitlement_website_tenant_fkey
    foreign key (entitlement_id, website_id, profile_id, environment)
    references public.website_entitlements(id, website_id, profile_id, environment);

-- Preserve exact calendar-connection identity for a selected calendar.
alter table public.calendar_selections
  drop constraint if exists calendar_selections_id_connection_tenant_uk,
  add constraint calendar_selections_id_connection_tenant_uk
  unique (id, connection_id, profile_id, environment);

alter table public.calendar_event_links
  drop constraint if exists calendar_event_links_calendar_selection_id_profile_id_environment_fkey,
  drop constraint if exists calendar_event_links_selection_connection_tenant_fkey,
  add constraint calendar_event_links_selection_connection_tenant_fkey
    foreign key (calendar_selection_id, connection_id, profile_id, environment)
    references public.calendar_selections(id, connection_id, profile_id, environment);

-- Attachment bytes remain disabled until a scanner is configured and proves clean.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('booking-attachments','booking-attachments',false,10485760,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
revoke all on public.booking_attachments from anon, authenticated;
create or replace function public.can_read_clean_booking_attachment(p_object_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.booking_attachments a join public.profiles p on p.id=a.profile_id
   where p.auth_user_id=auth.uid() and a.storage_object_key=p_object_key and a.upload_state='clean')
$$;
revoke all on function public.can_read_clean_booking_attachment(text) from public,anon;
grant execute on function public.can_read_clean_booking_attachment(text) to authenticated;
drop policy if exists booking_attachments_owner_read on storage.objects;
create policy booking_attachments_owner_read on storage.objects for select to authenticated using (
  bucket_id='booking-attachments' and public.can_read_clean_booking_attachment(name)
);
-- No authenticated INSERT/UPDATE/DELETE policy is intentional: upload capabilities,
-- scanning transitions, and cleanup remain service-role-only until a scanner is proven.

create table if not exists public.lead_governance_events(
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  lead_id uuid,
  action text not null check(action in ('view','export','delete','offboard')),
  actor_user_id uuid,
  reason text,
  occurred_at timestamptz not null default now(),
  foreign key(profile_id) references public.profiles(id) on delete restrict
);
alter table public.lead_governance_events enable row level security;
revoke all on public.lead_governance_events from anon, authenticated;

create table if not exists public.data_retention_policies(
  data_class text primary key,
  retention_days integer check(retention_days is null or retention_days > 0),
  deletion_mode text not null check(deletion_mode in ('support_verified','automatic','legal_hold')),
  production_approved boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.data_retention_policies(data_class,retention_days,deletion_mode,production_approved)
values ('website_leads',null,'support_verified',false),
       ('booking_attachments',null,'legal_hold',false)
on conflict(data_class) do nothing;
revoke all on public.data_retention_policies from anon, authenticated;

create table if not exists public.booking_attachment_security(
  singleton boolean primary key default true check(singleton),
  scanner_provider text,
  scanner_proven_at timestamptz,
  upload_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check(not upload_enabled or (scanner_provider is not null and scanner_proven_at is not null))
);
insert into public.booking_attachment_security(singleton) values(true) on conflict(singleton) do nothing;
revoke all on public.booking_attachment_security from public,anon,authenticated;
alter table public.booking_attachments
  add column if not exists quota_slot integer check(quota_slot between 1 and 5),
  add column if not exists state_version bigint not null default 1 check(state_version>0),
  add column if not exists scan_lease_token uuid,
  add column if not exists scan_lease_expires_at timestamptz,
  add column if not exists scan_fencing_token bigint not null default 0 check(scan_fencing_token>=0),
  add column if not exists scan_attempts integer not null default 0 check(scan_attempts>=0),
  add column if not exists scan_error text;
do $$ begin
 if exists(select 1 from public.booking_attachments where quota_slot is null) then
   raise exception 'booking attachment quota slots require reconciliation';
 end if;
end $$;
alter table public.booking_attachments alter column quota_slot set not null;
create unique index if not exists booking_attachments_quota_slot_uk
  on public.booking_attachments(appointment_id,environment,quota_slot)
  where upload_state not in ('rejected','deleted');

create or replace function public.claim_booking_attachment_scan(
  p_attachment_id uuid,p_lease_token uuid,p_lease_seconds integer
) returns bigint language plpgsql security definer set search_path='' as $$
declare next_fence bigint;
begin
  if p_lease_token is null or p_lease_seconds not between 1 and 900 then raise exception 'invalid scan lease' using errcode='22023'; end if;
  perform pg_catalog.set_config('app.attachment_state_transition',p_attachment_id::text,true);
  update public.booking_attachments set upload_state='quarantined',scan_lease_token=p_lease_token,
    scan_lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
    scan_fencing_token=scan_fencing_token+1,scan_attempts=scan_attempts+1,state_version=state_version+1
  where id=p_attachment_id and upload_state in ('uploaded','quarantined')
    and (scan_lease_expires_at is null or scan_lease_expires_at<pg_catalog.clock_timestamp())
  returning scan_fencing_token into next_fence;
  perform pg_catalog.set_config('app.attachment_state_transition','',true);
  if next_fence is null then raise exception 'attachment scan unavailable' using errcode='P0001'; end if;
  return next_fence;
exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;
end $$;
create or replace function public.complete_booking_attachment_scan(
  p_attachment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_outcome text,p_safe_error text default null
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
declare row public.booking_attachments%rowtype;
begin
  if p_outcome not in ('clean','rejected','scanner_unavailable') then raise exception 'invalid scan outcome' using errcode='22023'; end if;
  if p_outcome='clean' and not exists(select 1 from public.booking_attachment_security
    where singleton and upload_enabled and scanner_proven_at is not null) then
    raise exception 'attachment scanner is not proven' using errcode='P0001';
  end if;
  update public.booking_attachments set
    upload_state=case when p_outcome='clean' then 'clean' when p_outcome='rejected' then 'rejected' else 'quarantined' end,
    scan_error=case when p_outcome='clean' then null else p_safe_error end,
    scan_lease_token=null,scan_lease_expires_at=null,state_version=state_version+1,
    finalized_at=case when p_outcome='clean' then pg_catalog.clock_timestamp() else finalized_at end
  where id=p_attachment_id and upload_state='quarantined' and scan_lease_token=p_lease_token
    and scan_fencing_token=p_fencing_token returning * into row;
  if row.id is null then raise exception 'stale attachment scan fence' using errcode='40001'; end if;
  return row;
end $$;
revoke all on function public.claim_booking_attachment_scan(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.complete_booking_attachment_scan(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.claim_booking_attachment_scan(uuid,uuid,integer) to service_role;
grant execute on function public.complete_booking_attachment_scan(uuid,uuid,bigint,text,text) to service_role;

create or replace function public.offboard_starter_leads(
  p_profile_id uuid,p_actor_user_id uuid,p_reason text
) returns bigint language plpgsql security definer set search_path='' as $$
declare affected bigint;
begin
  if p_reason is null or pg_catalog.btrim(p_reason)='' then raise exception 'offboarding reason required' using errcode='22023'; end if;
  update public.website_entitlements set quote_admission=false,updated_at=pg_catalog.clock_timestamp()
   where profile_id=p_profile_id and plan='starter';
  get diagnostics affected=row_count;
  insert into public.lead_governance_events(profile_id,action,actor_user_id,reason)
   values(p_profile_id,'offboard',p_actor_user_id,p_reason);
  return affected;
end $$;
create or replace function public.purge_retained_leads(
  p_profile_id uuid,p_actor_user_id uuid,p_reason text
) returns bigint language plpgsql security definer set search_path='' as $$
declare affected bigint;
begin
  if not exists(select 1 from public.data_retention_policies where data_class='website_leads'
    and production_approved and retention_days is not null and deletion_mode='automatic') then
    raise exception 'lead retention policy is not approved' using errcode='P0001';
  end if;
  perform pg_catalog.set_config('app.lead_retention_purge_nonce',p_profile_id::text,true);
  delete from public.leads where user_id=p_profile_id and submitted_at < pg_catalog.clock_timestamp()-
    pg_catalog.make_interval(days=>(select retention_days from public.data_retention_policies where data_class='website_leads'));
  get diagnostics affected=row_count;
  insert into public.lead_governance_events(profile_id,action,actor_user_id,reason)
    values(p_profile_id,'delete',p_actor_user_id,p_reason||'; count='||affected::text);
  return affected;
end $$;
revoke all on function public.offboard_starter_leads(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.purge_retained_leads(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.offboard_starter_leads(uuid,uuid,text) to service_role;
grant execute on function public.purge_retained_leads(uuid,uuid,text) to service_role;

-- Existing setup commands are service-only, but still use an empty search path.
alter function public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb)
  set search_path = '';
alter function public.submit_starter_website_lead(uuid,uuid,jsonb,jsonb,jsonb,text,text,text)
  set search_path = '';
alter function public.acknowledge_booking_order(uuid,uuid,text,uuid)
  set search_path = '';

-- Leads are append-only. Retention deletion must use a separately audited command.
create or replace function public.reject_lead_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='DELETE' and pg_catalog.current_setting('app.lead_retention_purge_nonce',true)=old.user_id::text then return old; end if;
  raise exception 'lead history is immutable' using errcode = 'P0001';
end;
$$;
revoke all on function public.reject_lead_history_mutation() from public, anon, authenticated;
grant execute on function public.reject_lead_history_mutation() to service_role;

drop trigger if exists leads_history_immutable on public.leads;
create trigger leads_history_immutable
before update or delete on public.leads
for each row execute function public.reject_lead_history_mutation();

create or replace function public.reject_lead_history_truncate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'lead history is immutable' using errcode = 'P0001';
end;
$$;
revoke all on function public.reject_lead_history_truncate() from public, anon, authenticated;
grant execute on function public.reject_lead_history_truncate() to service_role;

drop trigger if exists leads_history_no_truncate on public.leads;
create trigger leads_history_no_truncate
before truncate on public.leads
for each statement execute function public.reject_lead_history_truncate();

alter table public.provider_event_inbox add column if not exists next_attempt_at timestamptz not null default now();

create or replace function public.claim_provider_event(
  p_event_id uuid,p_lease_token uuid,p_lease_seconds integer
) returns bigint language plpgsql security definer set search_path='' as $$
declare next_fence bigint;
begin
  if p_lease_token is null or p_lease_seconds not between 1 and 900 then raise exception 'invalid provider lease' using errcode='22023'; end if;
  update public.provider_event_inbox set processing_state='processing',lease_token=p_lease_token,
   lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
   fencing_token=fencing_token+1,attempts=attempts+1
  where id=p_event_id and processing_state in ('pending','processing','failed') and next_attempt_at<=pg_catalog.clock_timestamp()
   and (lease_expires_at is null or lease_expires_at<pg_catalog.clock_timestamp())
  returning fencing_token into next_fence;
  if next_fence is null then raise exception 'provider event unavailable' using errcode='P0001'; end if;
  return next_fence;
end $$;
create or replace function public.complete_provider_event(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_succeeded boolean,p_safe_error text default null
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_succeeded then raise exception 'successful provider events require an atomic domain apply command' using errcode='22023'; end if;
 update public.provider_event_inbox set processing_state=case when attempts>=8 then'dead_letter'else'failed'end,
   safe_error=p_safe_error,processed_at=case when attempts>=8 then pg_catalog.clock_timestamp()else null end,
   next_attempt_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer)),
   lease_token=null,lease_expires_at=null
 where id=p_event_id and processing_state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token;
 if not found then raise exception 'stale provider event fence' using errcode='40001'; end if;
 return true;
end $$;
revoke all on function public.claim_provider_event(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.complete_provider_event(uuid,uuid,bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_provider_event(uuid,uuid,integer) to service_role;
grant execute on function public.complete_provider_event(uuid,uuid,bigint,boolean,text) to service_role;

create or replace function public.claim_outbox_command(
 p_command_id uuid,p_lease_token uuid,p_lease_seconds integer
) returns bigint language plpgsql security definer set search_path='' as $$
declare next_fence bigint;
begin
 if p_lease_token is null or p_lease_seconds not between 1 and 900 then raise exception 'invalid outbox lease' using errcode='22023'; end if;
 update public.integration_outbox set state='processing',lease_token=p_lease_token,
   lease_expires_at=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds),
   fencing_token=fencing_token+1,attempts=attempts+1
 where id=p_command_id and state in ('pending','processing','failed') and next_attempt_at<=pg_catalog.clock_timestamp()
   and (lease_expires_at is null or lease_expires_at<pg_catalog.clock_timestamp())
   and exists(select 1 from public.appointments a where a.id=integration_outbox.appointment_id
     and a.profile_id=integration_outbox.profile_id and a.environment=integration_outbox.environment
     and a.version=integration_outbox.desired_appointment_version
     and ((integration_outbox.command_type='calendar_create' and a.calendar_state='create_pending')
       or (integration_outbox.command_type='calendar_cancel' and a.calendar_state='cancel_pending')
       or (integration_outbox.command_type='refund_full' and a.refund_state='pending')
       or integration_outbox.command_type='notify'))
 returning fencing_token into next_fence;
 if next_fence is null then raise exception 'outbox command unavailable' using errcode='P0001'; end if;
 return next_fence;
end $$;
create or replace function public.complete_outbox_command(
 p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_succeeded boolean,p_safe_error text default null
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.integration_outbox set state=case when p_succeeded then 'succeeded' else 'failed' end,
  safe_error=case when p_succeeded then null else p_safe_error end,
  next_attempt_at=case when p_succeeded then next_attempt_at else pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>60) end,
  completed_at=case when p_succeeded then pg_catalog.clock_timestamp() else null end,lease_token=null,lease_expires_at=null
 where id=p_command_id and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token;
 if not found then raise exception 'stale outbox command fence' using errcode='40001'; end if;
 return true;
end $$;
revoke all on function public.claim_outbox_command(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.complete_outbox_command(uuid,uuid,bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_outbox_command(uuid,uuid,integer) to service_role;
grant execute on function public.complete_outbox_command(uuid,uuid,bigint,boolean,text) to service_role;

alter table public.appointment_operations drop constraint if exists appointment_operations_operation_type_check;
alter table public.appointment_operations add constraint appointment_operations_operation_type_check
 check(operation_type in ('reserve','checkout_create','expire_hold','payment_success','payment_failure','cancel','refund','calendar_create','calendar_cancel','reconcile'));

create or replace function public.transition_appointment(
  p_appointment_id uuid, p_profile_id uuid, p_environment text,
  p_expected_version bigint, p_operation_type text, p_client_request_id uuid,
  p_request_hash text, p_payload jsonb default '{}'::jsonb
) returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare a public.appointments%rowtype; op public.appointment_operations%rowtype;
begin
  if p_operation_type not in ('checkout_create','expire_hold','payment_success','payment_failure','cancel','refund','calendar_create','calendar_cancel','reconcile')
     or p_client_request_id is null or pg_catalog.btrim(p_request_hash)='' then
    raise exception 'invalid appointment transition' using errcode='22023';
  end if;
  select * into op from public.appointment_operations where profile_id=p_profile_id
    and environment=p_environment and operation_type=p_operation_type
    and client_request_id=p_client_request_id for update;
  if found then
    if op.appointment_id<>p_appointment_id or op.request_hash<>p_request_hash then raise exception 'idempotency key payload conflict' using errcode='23505'; end if;
    select * into strict a from public.appointments where id=op.appointment_id;
    return a;
  end if;
  select * into strict a from public.appointments where id=p_appointment_id
    and profile_id=p_profile_id and environment=p_environment for update;
  if a.version<>p_expected_version then raise exception 'appointment revision conflict' using errcode='40001'; end if;

  if p_operation_type='checkout_create' and a.appointment_state='held' and a.payment_state='not_started' then
    a.appointment_state:='payment_pending'; a.payment_state:='creating';
  elsif p_operation_type='expire_hold' and a.appointment_state in ('held','payment_pending')
    and a.reservation_expires_at<=pg_catalog.clock_timestamp() then
    a.appointment_state:='cancelled'; a.appointment_reason:='hold_expired'; a.cancelled_at:=pg_catalog.clock_timestamp();
  elsif p_operation_type='payment_success' and a.appointment_state='payment_pending'
    and a.payment_state in ('creating','pending') then
    a.appointment_state:='confirmed'; a.payment_state:='paid'; a.confirmed_at:=pg_catalog.clock_timestamp();
    a.calendar_state:='create_pending';
  elsif p_operation_type='payment_success' and a.appointment_state='cancelled'
    and a.appointment_reason='hold_expired' and a.payment_state<>'paid' then
    a.payment_state:='paid'; a.refund_state:='pending'; a.review_state:='late_payment';
  elsif p_operation_type='payment_failure' and a.appointment_state='payment_pending'
    and a.payment_state in ('creating','pending') then
    a.payment_state:='failed'; a.review_state:=case when p_payload->>'late'='true' then 'late_payment' else a.review_state end;
  elsif p_operation_type='cancel' and a.appointment_state='confirmed' then
    if a.start_at<=pg_catalog.clock_timestamp() then raise exception 'appointment has already started' using errcode='P0001'; end if;
    a.appointment_state:='cancelled'; a.appointment_reason:='contractor_cancelled';
    a.cancellation_requested_at:=pg_catalog.clock_timestamp(); a.cancelled_at:=pg_catalog.clock_timestamp();
    a.calendar_state:=case when a.calendar_state='created' then 'cancel_pending' else a.calendar_state end;
    if a.payment_state='paid' then a.refund_state:='pending'; end if;
    update public.integration_outbox set state='dead_letter',safe_error='superseded_by_cancellation',completed_at=pg_catalog.clock_timestamp()
      where appointment_id=a.id and command_type='calendar_create' and state in ('pending','failed');
  elsif p_operation_type='refund' and a.refund_state='pending' then
    if p_payload->>'outcome' not in ('succeeded','failed') then raise exception 'invalid refund outcome' using errcode='22023'; end if;
    a.refund_state:=p_payload->>'outcome';
    if a.refund_state='failed' then a.review_state:='refund_failure'; end if;
  elsif p_operation_type='calendar_create' and a.calendar_state in ('create_pending','create_failed') then
    if p_payload->>'outcome' not in ('succeeded','failed') then raise exception 'invalid calendar outcome' using errcode='22023'; end if;
    a.calendar_state:=case when p_payload->>'outcome'='succeeded' then 'created' else 'create_failed' end;
  elsif p_operation_type='calendar_cancel' and a.calendar_state in ('cancel_pending','cancel_failed') then
    if p_payload->>'outcome' not in ('succeeded','failed') then raise exception 'invalid calendar outcome' using errcode='22023'; end if;
    a.calendar_state:=case when p_payload->>'outcome'='succeeded' then 'cancelled' else 'cancel_failed' end;
  elsif p_operation_type='reconcile' then
    if p_payload->>'review_state' not in ('none','late_payment','refund_failure','calendar_reconciliation','provider_inconsistency') then raise exception 'invalid review state' using errcode='22023'; end if;
    a.review_state:=p_payload->>'review_state';
  else raise exception 'invalid appointment state transition' using errcode='P0001'; end if;

  a.version:=a.version+1; a.updated_at:=pg_catalog.clock_timestamp();
  update public.appointments set appointment_state=a.appointment_state,appointment_reason=a.appointment_reason,
    payment_state=a.payment_state,refund_state=a.refund_state,calendar_state=a.calendar_state,
    review_state=a.review_state,version=a.version,confirmed_at=a.confirmed_at,
    cancellation_requested_at=a.cancellation_requested_at,cancelled_at=a.cancelled_at,updated_at=a.updated_at
    where id=a.id;
  update public.booking_payments set payment_state=a.payment_state,refund_state=a.refund_state,
    amount_paid_minor=case when a.payment_state='paid' then expected_amount_minor else amount_paid_minor end,
    amount_refunded_minor=case when a.refund_state='succeeded' then amount_paid_minor else amount_refunded_minor end,
    paid_at=case when a.payment_state='paid' then coalesce(paid_at,pg_catalog.clock_timestamp()) else paid_at end,
    failed_at=case when a.payment_state='failed' then pg_catalog.clock_timestamp() else failed_at end,
    refund_requested_at=case when a.refund_state='pending' then coalesce(refund_requested_at,pg_catalog.clock_timestamp()) else refund_requested_at end,
    refunded_at=case when a.refund_state='succeeded' then pg_catalog.clock_timestamp() else refunded_at end,
    updated_at=pg_catalog.clock_timestamp()
    where appointment_id=a.id and profile_id=p_profile_id and environment=p_environment;
  insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,
    client_request_id,request_hash,state,result,completed_at)
  values(p_profile_id,a.id,p_environment,p_operation_type,p_client_request_id,p_request_hash,
    'succeeded',pg_catalog.jsonb_build_object('appointmentId',a.id,'version',a.version),pg_catalog.clock_timestamp());
  if p_operation_type='payment_success' and a.appointment_state='confirmed' then
    insert into public.integration_outbox(profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,payload)
    values(p_profile_id,a.id,p_environment,'calendar_create','calendar_create:'||p_client_request_id::text,a.version,p_payload)
    on conflict(profile_id,environment,idempotency_key) do nothing;
  elsif p_operation_type='payment_success' and a.refund_state='pending' then
    insert into public.integration_outbox(profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,payload)
    values(p_profile_id,a.id,p_environment,'refund_full','late_refund:'||p_client_request_id::text,a.version,p_payload)
    on conflict(profile_id,environment,idempotency_key) do nothing;
  elsif p_operation_type='cancel' then
    if a.refund_state='pending' then
      insert into public.integration_outbox(profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,payload)
      values(p_profile_id,a.id,p_environment,'refund_full','refund_full:'||p_client_request_id::text,a.version,p_payload)
      on conflict(profile_id,environment,idempotency_key) do nothing;
    end if;
    if a.calendar_state='cancel_pending' then
      insert into public.integration_outbox(profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,payload)
      values(p_profile_id,a.id,p_environment,'calendar_cancel','calendar_cancel:'||p_client_request_id::text,a.version,p_payload)
      on conflict(profile_id,environment,idempotency_key) do nothing;
    end if;
  end if;
  return a;
exception when no_data_found then raise exception 'appointment transition target missing' using errcode='P0001';
end;
$$;
revoke all on function public.transition_appointment(uuid,uuid,text,bigint,text,uuid,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.transition_appointment(uuid,uuid,text,bigint,text,uuid,text,jsonb) to service_role;

create or replace function public.apply_provider_appointment_event(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_appointment_id uuid,p_profile_id uuid,p_environment text,
 p_expected_version bigint,p_operation_type text,p_client_request_id uuid,p_request_hash text,p_payload jsonb default '{}'::jsonb
) returns public.appointments language plpgsql security definer set search_path='' as $$
declare result public.appointments%rowtype;
begin
 if not exists(select 1 from public.provider_event_inbox where id=p_event_id and profile_id=p_profile_id
   and environment=p_environment and processing_state='processing' and lease_token=p_lease_token
   and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()) then
   raise exception 'stale provider event fence' using errcode='40001';
 end if;
 result:=public.transition_appointment(p_appointment_id,p_profile_id,p_environment,p_expected_version,
   p_operation_type,p_client_request_id,p_request_hash,p_payload);
 update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),
   safe_error=null,lease_token=null,lease_expires_at=null where id=p_event_id;
 return result;
end $$;
revoke all on function public.apply_provider_appointment_event(uuid,uuid,bigint,uuid,uuid,text,bigint,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.apply_provider_appointment_event(uuid,uuid,bigint,uuid,uuid,text,bigint,text,uuid,text,jsonb) to service_role;



-- Keep entitlement admission synchronized with a verified SaaS subscription event.
create or replace function public.project_saas_subscription_status(
  p_provider_subscription_id text,
  p_environment text,
  p_status text,
  p_provider_event_at timestamptz,
  p_provider_event_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_row public.subscriptions%rowtype;
  projected_state text;
begin
  if p_provider_subscription_id is null or p_provider_event_at is null
     or p_provider_event_id is null or p_environment not in ('test','live') or p_status not in ('active','past_due','cancelled') then
    raise exception 'invalid subscription projection' using errcode = '22023';
  end if;

  select * into subscription_row
  from public.subscriptions
  where provider_subscription_id = p_provider_subscription_id
    and environment = p_environment
  for update;
  if not found then return false; end if;

  -- Event identity deduplicates exact replays. Callers project Stripe's freshly retrieved current subscription state, so equal-second distinct events may
  -- safely converge again; only strictly older deliveries are stale.
  if subscription_row.last_provider_event_id = p_provider_event_id then
    return true;
  end if;

  if subscription_row.last_provider_event_at is not null
     and subscription_row.last_provider_event_at > p_provider_event_at then
    return true;
  end if;

  update public.subscriptions
  set status = p_status,
      provider_status = p_status,
      last_provider_event_at = p_provider_event_at,
      last_provider_event_id = p_provider_event_id,
      updated_at = pg_catalog.clock_timestamp()
  where id = subscription_row.id;

  projected_state := case p_status when 'active' then 'active' when 'past_due' then 'suspended' else 'cancelled' end;
  update public.website_entitlements
  set state = projected_state,
      -- Admission flags represent provider/configuration readiness. Lifecycle state
      -- independently gates use, so preserve readiness across billing recovery.
      booking_admission = booking_admission,
      quote_admission = quote_admission,
      ends_at = case
        when p_status = 'cancelled' then pg_catalog.clock_timestamp()
        when p_status = 'active' then null
        else ends_at
      end,
      updated_at = pg_catalog.clock_timestamp()
  where subscription_id = subscription_row.id;
  return true;
end;
$$;
revoke all on function public.project_saas_subscription_status(text,text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.project_saas_subscription_status(text,text,text,timestamptz,text)
  to service_role;
