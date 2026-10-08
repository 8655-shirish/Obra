-- Close audited Bucket 1 lifecycle, tenant, and governance gaps without provider calls.

-- Storage object names are bucket-global. Reject ambiguous legacy aliases before enforcing identity.
do $$ begin
 if exists(select storage_object_key from public.booking_attachments group by storage_object_key having count(*)>1) then
  raise exception 'duplicate booking attachment object keys require reconciliation';
 end if;
end $$;
create unique index if not exists booking_attachments_storage_object_key_uk
 on public.booking_attachments(storage_object_key);

-- An attachment must cite the exact customer and website of its appointment.
-- Drop dependent exact-composition keys first so replay/partial recovery is deterministic.
alter table public.booking_attachments drop constraint if exists booking_attachments_exact_appointment_fkey;
alter table public.appointments drop constraint if exists appointments_customer_source_composition_fkey;
alter table public.appointments drop constraint if exists appointments_attachment_identity_uk;
alter table public.appointments add constraint appointments_attachment_identity_uk
 unique(id,customer_id,website_id,profile_id,environment);
alter table public.booking_attachments
 drop constraint if exists booking_attachments_appointment_id_profile_id_environment_fkey,
 drop constraint if exists booking_attachments_customer_id_profile_id_environment_fkey,
 drop constraint if exists booking_attachments_website_id_profile_id_environment_fkey,
 add constraint booking_attachments_exact_appointment_fkey
 foreign key(appointment_id,customer_id,website_id,profile_id,environment)
 references public.appointments(id,customer_id,website_id,profile_id,environment) on delete cascade;
alter table public.booking_customers drop constraint if exists booking_customers_source_composition_uk;
alter table public.booking_customers add constraint booking_customers_source_composition_uk unique(id,source_website_id,profile_id,environment);
alter table public.appointments drop constraint if exists appointments_customer_source_composition_fkey;
alter table public.appointments add constraint appointments_customer_source_composition_fkey foreign key(customer_id,website_id,profile_id,environment) references public.booking_customers(id,source_website_id,profile_id,environment);
alter table public.calendar_selections drop constraint if exists calendar_selections_access_role_check;
alter table public.calendar_selections add constraint calendar_selections_access_role_check check(access_role is null or access_role in('freeBusyReader','reader','writer','owner'));
alter table public.provider_event_inbox drop constraint if exists provider_event_inbox_stripe_environment_check;
alter table public.provider_event_inbox add constraint provider_event_inbox_stripe_environment_check check(provider<>'stripe' or livemode=(environment='live'));
alter table public.provider_event_inbox add column if not exists next_attempt_at timestamptz not null default now();
create index if not exists provider_event_inbox_due_claim_idx on public.provider_event_inbox(processing_state,next_attempt_at,received_at) where processing_state in('pending','processing','failed');
alter table public.pipedream_bindings add column if not exists last_health_at timestamptz;
-- Every sensitive Bucket 1 class is explicitly fail-closed until a reviewed policy and
-- class-specific purge command exist. Only website_leads currently has an executor.
insert into public.data_retention_policies(data_class,retention_days,deletion_mode,production_approved) values
 ('booking_customers',null,'legal_hold',false),('appointments',null,'legal_hold',false),
 ('provider_events',null,'legal_hold',false),('governance_audits',null,'legal_hold',false),
 ('application_logs',null,'legal_hold',false),('provider_caches',null,'legal_hold',false),
 ('backups',null,'legal_hold',false),('abandoned_holds',null,'legal_hold',false),
 ('offboarding_records',null,'legal_hold',false)
on conflict(data_class) do nothing;
alter table public.booking_services drop constraint if exists booking_services_duration_minutes_check;
alter table public.booking_services add constraint booking_services_duration_minutes_check check(duration_minutes between 5 and 1439);

-- Truthful legacy treatment: do not represent reconstructed labels/source as captured history.
alter table public.leads add column if not exists snapshot_status text not null default 'legacy_unavailable' check(snapshot_status in('captured','legacy_unavailable')), add column if not exists snapshot_version smallint;
-- The previous migration made lead history immutable. Remove only that guard while this
-- migration classifies existing rows, then restore it before exposing any commands.
drop trigger if exists leads_history_immutable on public.leads;
update public.leads set snapshot_status='legacy_unavailable',snapshot_version=null
where field_snapshot='[]'::jsonb and source_snapshot='{}'::jsonb;
update public.leads set snapshot_status='captured',snapshot_version=1
where field_snapshot<>'[]'::jsonb or source_snapshot<>'{}'::jsonb;
create trigger leads_history_immutable before update or delete on public.leads
for each row execute function public.reject_lead_history_mutation();

do $$ begin
 if exists(select 1 from public.lead_governance_events where actor_user_id is null or nullif(pg_catalog.btrim(reason),'') is null) then
  raise exception 'unattributed lead governance rows require reconciliation';
 end if;
end $$;
alter table public.lead_governance_events
 alter column actor_user_id set not null,
 alter column reason set not null;
create or replace function public.reject_lead_governance_mutation() returns trigger language plpgsql security definer set search_path='' as $$
begin raise exception 'lead governance history is immutable' using errcode='P0001';end $$;
drop trigger if exists lead_governance_immutable on public.lead_governance_events;
create trigger lead_governance_immutable before update or delete on public.lead_governance_events for each row execute function public.reject_lead_governance_mutation();
drop trigger if exists lead_governance_no_truncate on public.lead_governance_events;
create trigger lead_governance_no_truncate before truncate on public.lead_governance_events for each statement execute function public.reject_lead_governance_mutation();
revoke all on function public.reject_lead_governance_mutation() from public,anon,authenticated;

create or replace function public.apply_provider_appointment_event(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_appointment_id uuid,p_profile_id uuid,p_environment text,
 p_expected_version bigint,p_operation_type text,p_client_request_id uuid,p_request_hash text,p_payload jsonb default '{}'::jsonb
) returns public.appointments language plpgsql security definer set search_path='' as $$
declare result public.appointments%rowtype; inbox public.provider_event_inbox%rowtype;
begin
 select * into strict inbox from public.provider_event_inbox where id=p_event_id for update;
 if inbox.profile_id is distinct from p_profile_id or inbox.environment<>p_environment
   or inbox.processing_state<>'processing' or inbox.lease_token is distinct from p_lease_token
   or inbox.fencing_token<>p_fencing_token or inbox.lease_expires_at<pg_catalog.clock_timestamp() then
  raise exception 'stale provider event fence' using errcode='40001';
 end if;
 -- No Bucket 1 adapter can yet derive an appointment transition from a stored Connect
 -- provider object. Never accept a caller-selected aggregate or transition.
 raise exception 'provider appointment event adapter is not enabled' using errcode='0A000';
end $$;
revoke all on function public.apply_provider_appointment_event(uuid,uuid,bigint,uuid,uuid,text,bigint,text,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- Replace transition command with guarded expiry and free-slot late-payment recovery.
create or replace function public.transition_appointment(
  p_appointment_id uuid,p_profile_id uuid,p_environment text,p_expected_version bigint,
  p_operation_type text,p_client_request_id uuid,p_request_hash text,p_payload jsonb default '{}'::jsonb
) returns public.appointments language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype; op public.appointment_operations%rowtype; payment public.booking_payments%rowtype; slot_free boolean;
begin
 if p_operation_type not in ('checkout_create','expire_hold','payment_success','payment_failure','cancel','refund','calendar_create','calendar_cancel','reconcile')
   or p_client_request_id is null or pg_catalog.btrim(p_request_hash)='' then raise exception 'invalid appointment transition' using errcode='22023'; end if;
 select * into op from public.appointment_operations where profile_id=p_profile_id and environment=p_environment
  and operation_type=p_operation_type and client_request_id=p_client_request_id for update;
 if found then
  if op.appointment_id<>p_appointment_id or op.request_hash<>p_request_hash then raise exception 'idempotency key payload conflict' using errcode='23505'; end if;
  select * into strict a from public.appointments where id=op.appointment_id; return a;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_profile_id::text||':'||p_environment||':booking',0));
 select * into op from public.appointment_operations where profile_id=p_profile_id and environment=p_environment and operation_type=p_operation_type and client_request_id=p_client_request_id for update;
 if found then if op.appointment_id<>p_appointment_id or op.request_hash<>p_request_hash then raise exception 'idempotency key payload conflict' using errcode='23505';end if;select * into strict a from public.appointments where id=op.appointment_id;return a;end if;
 select * into strict a from public.appointments where id=p_appointment_id and profile_id=p_profile_id and environment=p_environment for update;
 if a.version<>p_expected_version then raise exception 'appointment revision conflict' using errcode='40001'; end if;
 if p_operation_type='payment_success' then
  select * into payment from public.booking_payments where appointment_id=a.id and profile_id=p_profile_id and environment=p_environment for update;
  if payment.id is null or payment.expected_amount_minor<>a.amount_minor or payment.currency<>a.currency or coalesce(p_payload->>'checkoutSessionId','')='' or coalesce(p_payload->>'paymentIntentId','')='' or coalesce(p_payload->>'amountMinor','')!~'^[1-9][0-9]{0,18}$' or pg_catalog.length(p_payload->>'amountMinor')>=19 or (p_payload->>'amountMinor')::bigint<>payment.expected_amount_minor or coalesce(pg_catalog.upper(p_payload->>'currency'),'')<>payment.currency then raise exception 'verified payment evidence required' using errcode='P0001';end if;
 end if;
 if p_operation_type='checkout_create' and a.appointment_state='held' and a.payment_state='not_started'
   and a.reservation_expires_at>pg_catalog.clock_timestamp() then a.appointment_state:='payment_pending';a.payment_state:='creating';
 elsif p_operation_type='expire_hold' and a.appointment_state='held' and a.payment_state='not_started' and a.reservation_expires_at<=pg_catalog.clock_timestamp()
   then a.appointment_state:='cancelled';a.appointment_reason:='hold_expired';a.cancelled_at:=pg_catalog.clock_timestamp();
 elsif p_operation_type='expire_hold' and a.appointment_state='payment_pending' and a.payment_state='failed' and a.reservation_expires_at<=pg_catalog.clock_timestamp()
   then a.appointment_state:='cancelled';a.appointment_reason:='payment_failed';a.cancelled_at:=pg_catalog.clock_timestamp();
 elsif p_operation_type='payment_success' and a.appointment_state='payment_pending' and a.payment_state in('creating','pending','failed')
   and a.reservation_expires_at>pg_catalog.clock_timestamp() then a.appointment_state:='confirmed';a.payment_state:='paid';a.confirmed_at:=pg_catalog.clock_timestamp();a.calendar_state:='create_pending';
 elsif p_operation_type='payment_success' and (a.appointment_state='cancelled' or a.reservation_expires_at<=pg_catalog.clock_timestamp()) and a.payment_state<>'paid' then
   select not exists(select 1 from public.appointments x where x.profile_id=a.profile_id and x.environment=a.environment and x.id<>a.id
    and x.appointment_state in('held','payment_pending','confirmed') and tstzrange(x.start_at-pg_catalog.make_interval(mins=>x.buffer_before_minutes),x.end_at+pg_catalog.make_interval(mins=>x.buffer_after_minutes),'[)') && tstzrange(a.start_at-pg_catalog.make_interval(mins=>a.buffer_before_minutes),a.end_at+pg_catalog.make_interval(mins=>a.buffer_after_minutes),'[)')) into slot_free;
   a.payment_state:='paid';
   if slot_free and a.start_at>pg_catalog.clock_timestamp() then a.appointment_state:='confirmed';a.appointment_reason:='late_payment_recovered';a.confirmed_at:=pg_catalog.clock_timestamp();a.cancelled_at:=null;a.calendar_state:='create_pending';
   else a.appointment_state:='cancelled';a.appointment_reason:='late_payment_refund';a.refund_state:='pending';a.review_state:='late_payment'; end if;
 elsif p_operation_type='payment_failure' and a.appointment_state='payment_pending' and a.payment_state in('creating','pending') then a.payment_state:='failed';a.appointment_reason:='payment_failed';
 elsif p_operation_type='cancel' and a.appointment_state='confirmed' and a.start_at>pg_catalog.clock_timestamp() then
   a.appointment_state:='cancelled';a.appointment_reason:='contractor_cancelled';a.cancellation_requested_at:=pg_catalog.clock_timestamp();a.cancelled_at:=pg_catalog.clock_timestamp();
   if a.calendar_state in('created','create_pending','create_failed') then a.calendar_state:='cancel_pending';end if;if a.payment_state='paid' then a.refund_state:='pending';end if;
   update public.integration_outbox set state='dead_letter',safe_error='superseded_by_cancellation',completed_at=pg_catalog.clock_timestamp(),fencing_token=fencing_token+1,lease_token=null,lease_expires_at=null where appointment_id=a.id and command_type='calendar_create' and state in('pending','failed');
 elsif p_operation_type='refund' and a.refund_state='pending' and p_payload->>'outcome' in('succeeded','failed') then a.refund_state:=p_payload->>'outcome';if a.refund_state='failed'then a.review_state:='refund_failure';end if;
 elsif p_operation_type='calendar_create' and a.appointment_state='confirmed' and a.calendar_state in('create_pending','create_failed') and p_payload->>'outcome' in('succeeded','failed') then a.calendar_state:=case when p_payload->>'outcome'='succeeded'then'created'else'create_failed'end;
 elsif p_operation_type='calendar_cancel' and a.appointment_state='cancelled' and a.calendar_state in('cancel_pending','cancel_failed') and p_payload->>'outcome' in('succeeded','failed') then a.calendar_state:=case when p_payload->>'outcome'='succeeded'then'cancelled'else'cancel_failed'end;
 elsif p_operation_type='reconcile' and p_payload->>'review_state' in('none','late_payment','refund_failure','calendar_reconciliation','provider_inconsistency') then a.review_state:=p_payload->>'review_state';
 else raise exception 'invalid appointment state transition' using errcode='P0001';end if;
 a.version:=a.version+1;a.updated_at:=pg_catalog.clock_timestamp();
 update public.appointments set appointment_state=a.appointment_state,appointment_reason=a.appointment_reason,payment_state=a.payment_state,refund_state=a.refund_state,calendar_state=a.calendar_state,review_state=a.review_state,version=a.version,confirmed_at=a.confirmed_at,cancellation_requested_at=a.cancellation_requested_at,cancelled_at=a.cancelled_at,updated_at=a.updated_at where id=a.id;
 update public.booking_payments set checkout_session_id=case when p_operation_type='payment_success'then p_payload->>'checkoutSessionId' else checkout_session_id end,payment_intent_id=case when p_operation_type='payment_success'then p_payload->>'paymentIntentId' else payment_intent_id end,payment_state=a.payment_state,refund_state=a.refund_state,amount_paid_minor=case when a.payment_state='paid'then expected_amount_minor else amount_paid_minor end,amount_refunded_minor=case when a.refund_state='succeeded'then amount_paid_minor else amount_refunded_minor end,paid_at=case when a.payment_state='paid'then coalesce(paid_at,pg_catalog.clock_timestamp())else paid_at end,failed_at=case when a.payment_state='failed'then pg_catalog.clock_timestamp()else failed_at end,refund_requested_at=case when a.refund_state='pending'then coalesce(refund_requested_at,pg_catalog.clock_timestamp())else refund_requested_at end,refunded_at=case when a.refund_state='succeeded'then pg_catalog.clock_timestamp()else refunded_at end,updated_at=pg_catalog.clock_timestamp() where appointment_id=a.id and profile_id=p_profile_id and environment=p_environment;
 insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,client_request_id,request_hash,state,result,completed_at) values(p_profile_id,a.id,p_environment,p_operation_type,p_client_request_id,p_request_hash,'succeeded',pg_catalog.jsonb_build_object('appointmentId',a.id,'version',a.version),pg_catalog.clock_timestamp());
 if p_operation_type='payment_success' and a.appointment_state='confirmed' then insert into public.integration_outbox(profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,payload) values(p_profile_id,a.id,p_environment,'calendar_create','calendar_create:'||p_client_request_id,a.version,p_payload) on conflict(profile_id,environment,idempotency_key)do nothing;
 elsif a.refund_state='pending' then insert into public.integration_outbox(profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,payload) values(p_profile_id,a.id,p_environment,'refund_full','refund:'||p_client_request_id,a.version,p_payload) on conflict(profile_id,environment,idempotency_key)do nothing;end if;
 if p_operation_type='cancel' and a.calendar_state='cancel_pending' and exists(select 1 from public.calendar_event_links where appointment_id=a.id and environment=a.environment) then insert into public.integration_outbox(profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,payload) values(p_profile_id,a.id,p_environment,'calendar_cancel','calendar_cancel:'||p_client_request_id,a.version,p_payload) on conflict(profile_id,environment,idempotency_key)do nothing;end if;
 return a;
end $$;


-- Successful provider command settlement updates domain state, event identity, compensation, and command atomically.
create or replace function public.complete_outbox_appointment_command(
 p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_client_request_id uuid,
 p_request_hash text,p_outcome text,p_safe_error text default null,p_provider_result jsonb default '{}'::jsonb
) returns public.appointments language plpgsql security definer set search_path='' as $$
declare cmd public.integration_outbox%rowtype; a public.appointments%rowtype; selection public.calendar_selections%rowtype;
begin
 select * into strict cmd from public.integration_outbox where id=p_command_id;
 select * into strict a from public.appointments where id=cmd.appointment_id and profile_id=cmd.profile_id and environment=cmd.environment for update;
 select * into strict cmd from public.integration_outbox where id=p_command_id and state='processing' and lease_token=p_lease_token
  and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp() for update;
 if p_outcome not in('succeeded','failed')then raise exception 'invalid provider command outcome' using errcode='22023';end if;
 if cmd.command_type='calendar_create' then
  if p_outcome='succeeded' then
   select * into strict selection from public.calendar_selections where profile_id=a.profile_id and environment=a.environment and active and receives_bookings;
   insert into public.calendar_event_links(appointment_id,profile_id,connection_id,calendar_selection_id,environment,google_event_id,ical_uid,etag,desired_appointment_version,sync_state,last_attempt_at)
   values(a.id,a.profile_id,selection.connection_id,selection.id,a.environment,p_provider_result->>'googleEventId',p_provider_result->>'icalUid',p_provider_result->>'etag',a.version,'created',pg_catalog.clock_timestamp())
   on conflict(appointment_id,environment)do update set google_event_id=excluded.google_event_id,ical_uid=excluded.ical_uid,etag=excluded.etag,sync_state='created',updated_at=pg_catalog.clock_timestamp();
   if a.appointment_state='confirmed' then a.calendar_state:='created';
   else a.calendar_state:='cancel_pending';end if;
  elsif a.appointment_state='confirmed'then a.calendar_state:='create_pending';else a.calendar_state:='cancelled';end if;
 elsif cmd.command_type='calendar_cancel' then a.calendar_state:=case when p_outcome='succeeded'then'cancelled'else'cancel_pending'end;
 elsif cmd.command_type='refund_full' then a.refund_state:=case when p_outcome='succeeded'then'succeeded'else'pending'end;if p_outcome='failed'then a.review_state:='refund_failure';end if;
 else raise exception 'command has no appointment transition' using errcode='22023';end if;
 a.version:=a.version+1;a.updated_at:=pg_catalog.clock_timestamp();
 update public.appointments set calendar_state=a.calendar_state,refund_state=a.refund_state,review_state=a.review_state,version=a.version,updated_at=a.updated_at where id=a.id;
 if cmd.command_type='calendar_create' and p_outcome='succeeded' and a.appointment_state='cancelled' then insert into public.integration_outbox(profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,payload) values(a.profile_id,a.id,a.environment,'calendar_cancel','calendar_cancel_after_create:'||cmd.id,a.version,pg_catalog.jsonb_build_object('googleEventId',p_provider_result->>'googleEventId')) on conflict(profile_id,environment,idempotency_key)do nothing;end if;
 if p_outcome='failed' then update public.integration_outbox set desired_appointment_version=a.version where id=cmd.id;end if;
 update public.booking_payments set refund_state=a.refund_state,amount_refunded_minor=case when a.refund_state='succeeded'then amount_paid_minor else amount_refunded_minor end,refunded_at=case when a.refund_state='succeeded'then pg_catalog.clock_timestamp()else refunded_at end,updated_at=pg_catalog.clock_timestamp() where appointment_id=a.id;
 insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,client_request_id,request_hash,state,result,completed_at)
 values(a.profile_id,a.id,a.environment,case when cmd.command_type='refund_full'then'refund'else cmd.command_type end,p_client_request_id,p_request_hash,case when p_outcome='succeeded'then'succeeded'else'failed'end,p_provider_result,pg_catalog.clock_timestamp());
 update public.integration_outbox set state=case when p_outcome='succeeded'then'succeeded'else'failed'end,safe_error=case when p_outcome='succeeded'then null else p_safe_error end,completed_at=case when p_outcome='succeeded'then pg_catalog.clock_timestamp()else null end,next_attempt_at=case when p_outcome='failed'then pg_catalog.clock_timestamp()+interval '1 minute'else next_attempt_at end,lease_token=null,lease_expires_at=null
 where id=cmd.id and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token;
 if not found then raise exception 'stale outbox command fence' using errcode='40001';end if;return a;
end $$;
revoke all on function public.complete_outbox_appointment_command(uuid,uuid,bigint,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_outbox_appointment_command(uuid,uuid,bigint,uuid,text,text,text,jsonb) to service_role;
create or replace function public.complete_outbox_command(
 p_command_id uuid,p_lease_token uuid,p_fencing_token bigint,p_succeeded boolean,p_safe_error text default null
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_succeeded then raise exception 'successful outbox commands require atomic domain settlement' using errcode='22023';end if;
 update public.integration_outbox set state='failed',safe_error=p_safe_error,
  next_attempt_at=pg_catalog.clock_timestamp()+interval '1 minute',completed_at=null,lease_token=null,lease_expires_at=null
 where id=p_command_id and state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token;
 if not found then raise exception 'stale outbox command fence' using errcode='40001';end if;return true;
end $$;

-- Service-only durable raw inbox insertion. Exact replay returns the existing row; hash conflict fails.
create or replace function public.ingest_provider_event(
 p_provider text,p_event_family text,p_event_id text,p_account_context text,p_destination text,
 p_api_version text,p_livemode boolean,p_environment text,p_profile_id uuid,p_event_type text,
 p_payload_hash text,p_payload jsonb,p_signature_timestamp timestamptz default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare row public.provider_event_inbox%rowtype;
begin
 insert into public.provider_event_inbox(provider,event_family,event_id,account_context,destination,api_version,
  livemode,environment,profile_id,event_type,payload_hash,payload,signature_timestamp)
 values(p_provider,p_event_family,p_event_id,coalesce(p_account_context,''),coalesce(p_destination,''),coalesce(p_api_version,''),
  p_livemode,p_environment,p_profile_id,p_event_type,p_payload_hash,p_payload,p_signature_timestamp)
 on conflict(provider,event_family,event_id,account_context,destination,api_version,livemode) do nothing;
 select * into strict row from public.provider_event_inbox where provider=p_provider and event_family=p_event_family
  and event_id=p_event_id and account_context=coalesce(p_account_context,'') and destination=coalesce(p_destination,'')
  and api_version=coalesce(p_api_version,'') and livemode=p_livemode for update;
 if row.payload_hash<>p_payload_hash or row.environment<>p_environment or row.profile_id is distinct from p_profile_id
   then raise exception 'provider event replay identity conflict' using errcode='23505';end if;
 return row.id;
end $$;
revoke all on function public.ingest_provider_event(text,text,text,text,text,text,boolean,text,uuid,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.ingest_provider_event(text,text,text,text,text,text,boolean,text,uuid,text,text,jsonb,timestamptz) to service_role;

-- Governance events are append-only and actor/reason attributable.
create or replace function public.record_lead_governance_event(
 p_profile_id uuid,p_lead_id uuid,p_action text,p_actor_user_id uuid,p_reason text
) returns bigint language plpgsql security definer set search_path='' as $$
declare event_id bigint;
begin
 if p_actor_user_id is null or nullif(pg_catalog.btrim(p_reason),'') is null
   or p_action not in('view','export','delete','offboard') then raise exception 'attributable lead audit required' using errcode='22023';end if;
 if p_action in('view','export') and not exists(select 1 from public.profiles where id=p_profile_id and auth_user_id=p_actor_user_id) then raise exception 'lead audit actor mismatch' using errcode='P0001';end if;
 if p_lead_id is not null and not exists(select 1 from public.leads where id=p_lead_id and user_id=p_profile_id)
   then raise exception 'lead audit tenant mismatch' using errcode='P0001';end if;
 insert into public.lead_governance_events(profile_id,lead_id,action,actor_user_id,reason)
 values(p_profile_id,p_lead_id,p_action,p_actor_user_id,p_reason) returning id into event_id;return event_id;
end $$;
revoke all on function public.record_lead_governance_event(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_lead_governance_event(uuid,uuid,text,uuid,text) to service_role;

create or replace function public.purge_retained_leads(p_profile_id uuid,p_actor_user_id uuid,p_reason text)
returns bigint language plpgsql security definer set search_path='' as $$
declare affected bigint; retention integer;
begin
 if p_actor_user_id is null or nullif(pg_catalog.btrim(p_reason),'') is null then raise exception 'attributable lead purge required' using errcode='22023';end if;
 select retention_days into retention from public.data_retention_policies where data_class='website_leads' and production_approved and retention_days is not null and deletion_mode='automatic' for update;
 if retention is null then raise exception 'lead retention policy is not approved' using errcode='P0001';end if;
 perform pg_catalog.set_config('app.lead_retention_purge_nonce',p_profile_id::text,true);
 delete from public.leads where user_id=p_profile_id and submitted_at<pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>retention);
 get diagnostics affected=row_count;
 perform pg_catalog.set_config('app.lead_retention_purge_nonce','',true);
 insert into public.lead_governance_events(profile_id,action,actor_user_id,reason) values(p_profile_id,'delete',p_actor_user_id,p_reason||'; count='||affected);return affected;
end $$;

create or replace function public.submit_starter_website_lead(
  p_website_id uuid, p_version_id uuid, p_form_data jsonb, p_field_snapshot jsonb,
  p_source_snapshot jsonb, p_submission_fingerprint text, p_payload_hash text, p_rate_limit_key text
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
  for update of w, e;

  if v_user_id is null then
    raise exception 'site is not accepting leads' using errcode = 'P0001';
  end if;

  insert into public.leads (
    website_id, user_id, license_number, form_data, field_snapshot, source_snapshot, snapshot_status, snapshot_version,
    submission_fingerprint, payload_hash, rate_limit_key
  ) values (
    p_website_id, v_user_id, v_license_number, p_form_data, p_field_snapshot, p_source_snapshot, 'captured', 1,
    p_submission_fingerprint, p_payload_hash, p_rate_limit_key
  ) returning id into v_lead_id;

  return v_lead_id;
end;
$$;

revoke all on function public.submit_starter_website_lead(uuid, uuid, jsonb, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_starter_website_lead(uuid, uuid, jsonb, jsonb, jsonb, text, text, text) to service_role;



create or replace function public.enforce_booking_attachment_object_key() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.storage_object_key <> new.environment||'/'||new.profile_id::text||'/'||new.website_id::text||'/'||new.appointment_id::text||'/'||new.id::text then
  raise exception 'booking attachment object key must be canonical' using errcode='22023';
 end if;return new;
end $$;
drop trigger if exists booking_attachment_object_key_guard on public.booking_attachments;
create trigger booking_attachment_object_key_guard before insert or update of storage_object_key,profile_id,website_id,appointment_id,environment
on public.booking_attachments for each row execute function public.enforce_booking_attachment_object_key();
revoke all on function public.enforce_booking_attachment_object_key() from public,anon,authenticated;

-- A claimed SaaS event and its checkout/subscription projection commit together.
create or replace function public.apply_saas_provider_event(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_source_created_at timestamptz,p_projection jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare inbox public.provider_event_inbox%rowtype; action text; applied boolean:=false;
begin
 select * into strict inbox from public.provider_event_inbox where id=p_event_id and provider='stripe' and event_family='saas'
  and processing_state='processing' and lease_token=p_lease_token and fencing_token=p_fencing_token
  and lease_expires_at>=pg_catalog.clock_timestamp() for update;
 action:=p_projection->>'action';
 if action='finalize_checkout' then
  if not exists(select 1 from public.checkout_sessions c where c.id=(p_projection->>'checkoutSessionId')::uuid and c.environment=inbox.environment and c.stripe_checkout_session_id=p_projection->>'stripeCheckoutSessionId') then raise exception 'checkout event environment or identity mismatch' using errcode='P0001';end if;
  perform public.finalize_paid_checkout((p_projection->>'checkoutSessionId')::uuid,p_projection->>'stripeCheckoutSessionId',
   p_projection->>'providerSubscriptionId',p_projection->>'providerCustomerId',p_projection->>'priceId',p_projection->>'plan');applied:=true;
 elsif action='expire_checkout' then
  if not exists(select 1 from public.checkout_sessions c where c.id=(p_projection->>'checkoutSessionId')::uuid and c.environment=inbox.environment and c.stripe_checkout_session_id=p_projection->>'stripeCheckoutSessionId') then raise exception 'checkout event environment or identity mismatch' using errcode='P0001';end if;
  applied:=public.expire_checkout_intent((p_projection->>'checkoutSessionId')::uuid,p_projection->>'stripeCheckoutSessionId');
 elsif action='no_op' then
  applied:=true;
 elsif action='project_subscription' then
  applied:=public.project_saas_subscription_status(p_projection->>'providerSubscriptionId',inbox.environment,
   p_projection->>'status',p_source_created_at,inbox.event_id);
  if not applied then raise exception 'subscription identity is not bound yet' using errcode='P0001';end if;
 else raise exception 'unsupported SaaS projection' using errcode='22023';end if;
 update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),safe_error=null,
  lease_token=null,lease_expires_at=null where id=p_event_id and processing_state='processing' and lease_token=p_lease_token
  and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp();
 if not found then raise exception 'stale SaaS provider event fence' using errcode='40001';end if;return applied;
end $$;
revoke all on function public.apply_saas_provider_event(uuid,uuid,bigint,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.apply_saas_provider_event(uuid,uuid,bigint,timestamptz,jsonb) to service_role;


-- Setup mutation authority uses the same temporal entitlement predicate as public readiness.
drop function if exists public.acknowledge_booking_order(uuid,uuid,text,uuid);
create function public.acknowledge_booking_order(
 p_website_id uuid,p_profile_id uuid,p_environment text,p_auth_user_id uuid
) returns public.website_entitlements language plpgsql security definer set search_path='' as $$
declare result public.website_entitlements%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_profile_id and environment=p_environment and auth_user_id=p_auth_user_id)then raise exception 'booking setup authorization failed' using errcode='42501';end if;
 update public.website_entitlements set order_confirmed_at=coalesce(order_confirmed_at,pg_catalog.clock_timestamp()),updated_at=pg_catalog.clock_timestamp()
 where website_id=p_website_id and profile_id=p_profile_id and environment=p_environment and plan='pro' and state in('active','grace')
   and effective_at is not null and effective_at<=pg_catalog.clock_timestamp() and (ends_at is null or ends_at>pg_catalog.clock_timestamp()) returning * into result;
 if result.id is null then raise exception 'active Pro website entitlement required' using errcode='P0001';end if;return result;
end $$;
revoke all on function public.acknowledge_booking_order(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.acknowledge_booking_order(uuid,uuid,text,uuid) to service_role;

-- Retire the legacy public overload without losing its validated base implementation.
do $$ begin
 if pg_catalog.to_regprocedure('public.save_shared_booking_availability_base(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb)') is null then
  if pg_catalog.to_regprocedure('public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb)') is null then raise exception 'availability base function missing' using errcode='42883';end if;
  alter function public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb) rename to save_shared_booking_availability_base;
 elsif pg_catalog.to_regprocedure('public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb)') is not null then
  drop function public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb);
 end if;
end $$;
revoke all on function public.save_shared_booking_availability_base(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Date overrides are part of the same revisioned availability aggregate.
create or replace function public.save_shared_booking_availability(
 p_website_id uuid,p_profile_id uuid,p_environment text,p_auth_user_id uuid,p_service_revision bigint,p_schedule_revision bigint,
 p_service jsonb,p_schedule jsonb,p_intervals jsonb,p_overrides jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; v_schedule_id uuid; item jsonb; child jsonb; override_id uuid; override_count int:=0;child_count int:=0;
begin
 if not exists(select 1 from public.website_entitlements where website_id=p_website_id and profile_id=p_profile_id and environment=p_environment and plan='pro' and state in('active','grace') and effective_at is not null and effective_at<=pg_catalog.clock_timestamp() and (ends_at is null or ends_at>pg_catalog.clock_timestamp()))then raise exception 'active Pro website entitlement required' using errcode='P0001';end if;
 if p_overrides is null or pg_catalog.jsonb_typeof(p_overrides)<>'array'then raise exception 'invalid overrides' using errcode='22023';end if;
 if pg_catalog.jsonb_array_length(p_overrides)>120 then raise exception 'too many overrides' using errcode='22023';end if;
 if (select count(*) from pg_catalog.jsonb_array_elements(p_overrides) value cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(value->'intervals')='array' then value->'intervals' else '[]'::jsonb end))>500 then raise exception 'too many override intervals' using errcode='22023';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_overrides) value where pg_catalog.jsonb_typeof(value)<>'object' or value->>'localDate' is null or pg_catalog.lower(pg_catalog.btrim(value->>'localDate')) in('infinity','-infinity') or value->>'type' is null or value->>'type' not in('unavailable','custom_hours') or pg_catalog.jsonb_typeof(value->'intervals') is distinct from 'array' or (value->>'type'='unavailable' and pg_catalog.jsonb_array_length(value->'intervals')<>0) or (value->>'type'='custom_hours' and pg_catalog.jsonb_array_length(value->'intervals')=0)) then raise exception 'invalid override shape' using errcode='22023';end if;
 if exists(select 1 from pg_catalog.jsonb_array_elements(p_overrides) value cross join lateral pg_catalog.jsonb_array_elements(value->'intervals') child where pg_catalog.jsonb_typeof(child)<>'object' or child->>'localStart' is null or child->>'localEnd' is null or child->>'sortOrder' is null) then raise exception 'invalid override interval shape' using errcode='22023';end if;
 begin
  perform (value->>'localDate')::date from pg_catalog.jsonb_array_elements(p_overrides) value;
  perform (child->>'localStart')::time,(child->>'localEnd')::time,(child->>'sortOrder')::int from pg_catalog.jsonb_array_elements(p_overrides) value cross join lateral pg_catalog.jsonb_array_elements(value->'intervals') child;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'invalid override scalar value' using errcode='22023';end;
 result:=public.save_shared_booking_availability_base(p_website_id,p_profile_id,p_environment,p_auth_user_id,p_service_revision,p_schedule_revision,p_service,p_schedule,p_intervals);
 select id into strict v_schedule_id from public.availability_schedules where profile_id=p_profile_id and environment=p_environment;
 delete from public.availability_overrides where schedule_id=v_schedule_id;
 for item in select value from pg_catalog.jsonb_array_elements(p_overrides) loop
  override_count:=override_count+1;if override_count>120 then raise exception 'too many overrides' using errcode='22023';end if;
  if pg_catalog.jsonb_typeof(item)<>'object' or item->>'localDate' is null or item->>'type' is null or item->>'type' not in('unavailable','custom_hours') or pg_catalog.jsonb_typeof(item->'intervals') is distinct from 'array' then raise exception 'invalid override shape' using errcode='22023';end if;
  if (item->>'type'='unavailable' and pg_catalog.jsonb_array_length(item->'intervals')<>0)
   or(item->>'type'='custom_hours' and pg_catalog.jsonb_array_length(item->'intervals')=0)then raise exception 'invalid override intervals' using errcode='22023';end if;
  insert into public.availability_overrides(schedule_id,profile_id,environment,local_date,override_type,reason)
   values(v_schedule_id,p_profile_id,p_environment,(item->>'localDate')::date,item->>'type',nullif(item->>'reason','')) returning id into override_id;
  for child in select value from pg_catalog.jsonb_array_elements(item->'intervals') loop
   if pg_catalog.jsonb_typeof(child)<>'object' or child->>'localStart' is null or child->>'localEnd' is null or child->>'sortOrder' is null then raise exception 'invalid override interval shape' using errcode='22023';end if;
   child_count:=child_count+1;if child_count>500 then raise exception 'too many override intervals' using errcode='22023';end if;
   insert into public.availability_override_intervals(override_id,profile_id,environment,local_start,local_end,sort_order)
   values(override_id,p_profile_id,p_environment,(child->>'localStart')::time,(child->>'localEnd')::time,(child->>'sortOrder')::int);
  end loop;
 end loop;
 return result;
end $$;
revoke all on function public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_shared_booking_availability(uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb,jsonb) to service_role;


create or replace function public.guard_booking_attachment_state() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' and new.upload_state<>'pending') or (tg_op='UPDATE' and new.upload_state is distinct from old.upload_state and pg_catalog.current_setting('app.attachment_state_transition',true) is distinct from old.id::text) then
  raise exception 'attachment state requires fenced command' using errcode='P0001';
 end if;return new;
end $$;
drop trigger if exists booking_attachment_state_guard on public.booking_attachments;
create trigger booking_attachment_state_guard before insert or update of upload_state on public.booking_attachments for each row execute function public.guard_booking_attachment_state();
revoke all on function public.guard_booking_attachment_state() from public,anon,authenticated;
-- Service workers must use the narrow SECURITY DEFINER commands; direct table DML cannot
-- manufacture pending/uploaded/clean transitions or rewrite audit history.
revoke insert,update,delete,truncate on public.booking_attachments from service_role;
revoke insert,update,delete,truncate on public.lead_governance_events from service_role;

create or replace function public.mark_booking_attachment_uploaded(
 p_attachment_id uuid,p_profile_id uuid,p_environment text,p_storage_object_key text,p_byte_size bigint,p_checksum text
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
declare row public.booking_attachments%rowtype;
begin
 if p_byte_size<=0 or p_checksum is null or pg_catalog.btrim(p_checksum)='' then raise exception 'invalid uploaded object evidence' using errcode='22023';end if;
 if not exists(select 1 from public.booking_attachment_security where singleton and upload_enabled and scanner_proven_at is not null) or not exists(select 1 from storage.objects where bucket_id='booking-attachments' and name=p_storage_object_key and metadata ? 'size' and metadata->>'size' ~ '^[1-9][0-9]{0,18}$' and pg_catalog.length(metadata->>'size')<19 and (metadata->>'size')::bigint=p_byte_size) then raise exception 'uploaded storage object is not proven' using errcode='P0001';end if;
 perform pg_catalog.set_config('app.attachment_state_transition',p_attachment_id::text,true);
 update public.booking_attachments set upload_state='uploaded',byte_size=p_byte_size,checksum=p_checksum,state_version=state_version+1
 where id=p_attachment_id and profile_id=p_profile_id and environment=p_environment and storage_object_key=p_storage_object_key and upload_state='pending' returning * into row;
 perform pg_catalog.set_config('app.attachment_state_transition','',true);
 if row.id is null then raise exception 'attachment upload identity or state mismatch' using errcode='P0001';end if;return row;
exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;
end $$;
revoke all on function public.mark_booking_attachment_uploaded(uuid,uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.mark_booking_attachment_uploaded(uuid,uuid,text,text,bigint,text) to service_role;

create or replace function public.complete_booking_attachment_scan(
 p_attachment_id uuid,p_lease_token uuid,p_fencing_token bigint,p_outcome text,p_safe_error text default null
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
declare row public.booking_attachments%rowtype;
begin
 if p_outcome not in('clean','rejected','scanner_unavailable')then raise exception 'invalid scan outcome' using errcode='22023';end if;
 if p_outcome='clean' and not exists(select 1 from public.booking_attachment_security where singleton and upload_enabled and scanner_proven_at is not null)then raise exception 'attachment scanner is not proven' using errcode='P0001';end if;
 perform pg_catalog.set_config('app.attachment_state_transition',p_attachment_id::text,true);
 update public.booking_attachments set upload_state=case when p_outcome='clean'then'clean'when p_outcome='rejected'or scan_attempts>=8 then'rejected'else'quarantined'end,scan_error=case when p_outcome='clean'then null else p_safe_error end,scan_lease_token=null,scan_lease_expires_at=case when p_outcome='scanner_unavailable'and scan_attempts<8 then pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>least(3600,30*(2^least(scan_attempts,7))::integer))else null end,state_version=state_version+1,finalized_at=case when p_outcome='clean'or p_outcome='rejected'or scan_attempts>=8 then pg_catalog.clock_timestamp()else finalized_at end
 where id=p_attachment_id and upload_state='quarantined' and scan_lease_token=p_lease_token and scan_fencing_token=p_fencing_token and scan_lease_expires_at>=pg_catalog.clock_timestamp() returning * into row;
 perform pg_catalog.set_config('app.attachment_state_transition','',true);
 if row.id is null then raise exception 'stale attachment scan fence' using errcode='40001';end if;return row;
exception when others then perform pg_catalog.set_config('app.attachment_state_transition','',true);raise;
end $$;

create or replace function public.validate_lead_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.snapshot_status='captured' then
  if new.snapshot_version<>1 or pg_catalog.jsonb_typeof(new.field_snapshot)<>'array' or pg_catalog.jsonb_array_length(new.field_snapshot)>20
   or pg_catalog.jsonb_typeof(new.source_snapshot)<>'object' then raise exception 'invalid captured lead snapshot' using errcode='22023';end if;
 else
  if new.snapshot_version is not null then raise exception 'legacy snapshot cannot claim a version' using errcode='22023';end if;
 end if;return new;
end $$;
drop trigger if exists validate_lead_snapshot on public.leads;
create trigger validate_lead_snapshot before insert or update of field_snapshot,source_snapshot,snapshot_status,snapshot_version on public.leads for each row execute function public.validate_lead_snapshot();
revoke all on function public.validate_lead_snapshot() from public,anon,authenticated;


create or replace function public.create_booking_attachment_record(
 p_attachment_id uuid,p_appointment_id uuid,p_profile_id uuid,p_environment text,p_original_filename text,
 p_display_filename text,p_mime_type text,p_byte_size bigint,p_checksum text,p_quota_slot smallint
) returns public.booking_attachments language plpgsql security definer set search_path='' as $$
declare a public.appointments%rowtype; result public.booking_attachments%rowtype; object_key text;
begin
 if p_attachment_id is null or p_quota_slot not between 1 and 5 then raise exception 'invalid attachment request' using errcode='22023';end if;
 select * into strict a from public.appointments where id=p_appointment_id and profile_id=p_profile_id and environment=p_environment for update;
 if not exists(select 1 from public.booking_attachment_security where singleton and upload_enabled and scanner_proven_at is not null)then raise exception 'attachment scanner is not proven' using errcode='P0001';end if;
 object_key:=a.environment||'/'||a.profile_id::text||'/'||a.website_id::text||'/'||a.id::text||'/'||p_attachment_id::text;
 insert into public.booking_attachments(id,appointment_id,customer_id,profile_id,website_id,environment,storage_object_key,original_filename,display_filename,mime_type,byte_size,checksum,quota_slot)
 values(p_attachment_id,a.id,a.customer_id,a.profile_id,a.website_id,a.environment,object_key,p_original_filename,p_display_filename,p_mime_type,p_byte_size,p_checksum,p_quota_slot) returning * into result;return result;
end $$;
revoke all on function public.create_booking_attachment_record(uuid,uuid,uuid,text,text,text,text,bigint,text,smallint) from public,anon,authenticated;
grant execute on function public.create_booking_attachment_record(uuid,uuid,uuid,text,text,text,text,bigint,text,smallint) to service_role;
