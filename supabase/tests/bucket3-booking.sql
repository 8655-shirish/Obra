\set ON_ERROR_STOP on
\echo 'bucket3-booking: behavioral transaction smoke'
begin;
create or replace function pg_temp.assert_true(ok boolean,message text)returns void language plpgsql as $$begin if ok is not true then raise exception 'assertion failed: %',message;end if;end$$;

-- Security and authority contracts are executable database facts.
select pg_temp.assert_true((
 select rolcanlogin=false and rolsuper=false and rolcreatedb=false and rolcreaterole=false
  and rolreplication=false and rolbypassrls=false and rolinherit=false
 from pg_catalog.pg_roles where rolname='booking_worker'
),'worker role has only restrictive attributes');
select pg_temp.assert_true((select r.rolcanlogin and not r.rolsuper and not r.rolcreatedb and not r.rolbypassrls
  and not r.rolreplication and not r.rolinherit and r.rolcreaterole
  from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid=p.proowner
  where p.oid='public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)'::regprocedure),
  'full replay executes the money authority under a constrained migration owner');
select pg_temp.assert_true((select p.proowner<>extension.proowner
  from pg_catalog.pg_proc p,pg_catalog.pg_proc extension where p.oid='public.register_calendar_worker_schedules(text)'::regprocedure
    and extension.oid='cron.alter_job(bigint,text,text,text,text,boolean)'::regprocedure),
  'scheduler definer is not the extension owner');
do $membership$
declare ok boolean;migration_owner name;
begin
  select pg_catalog.pg_get_userbyid(proowner) into strict migration_owner from pg_catalog.pg_proc
    where oid='public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)'::regprocedure;
 if current_setting('server_version_num')::integer>=160000 then
  execute $query$select count(*)=2 and bool_and(granted.rolname='booking_worker'and(
    (member.rolname='authenticator'and grantor.rolname=$1
    and m.admin_option=false and m.inherit_option=true and m.set_option=true)
   or(member.rolname=$1 and grantor.rolname<>$1 and grantor.rolsuper=true
    and m.admin_option=true and m.inherit_option=false and m.set_option=false)))
   from pg_catalog.pg_auth_members m join pg_catalog.pg_roles granted on granted.oid=m.roleid
   join pg_catalog.pg_roles member on member.oid=m.member join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
    where granted.rolname='booking_worker'or member.rolname='booking_worker'$query$ into ok using migration_owner;
 else
  select count(*)=1 and bool_and(granted.rolname='booking_worker'and member.rolname='authenticator'and m.admin_option=false)into ok
  from pg_catalog.pg_auth_members m join pg_catalog.pg_roles granted on granted.oid=m.roleid
  join pg_catalog.pg_roles member on member.oid=m.member
  where granted.rolname='booking_worker'or member.rolname='booking_worker';
 end if;
 perform pg_temp.assert_true(ok,'worker has only bounded authenticator and PostgreSQL 16+ creator-admin edges');
end $membership$;
select pg_temp.assert_true(not has_schema_privilege('public','public','CREATE'),'PUBLIC cannot create in public schema');
select pg_temp.assert_true(not exists(
 select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and has_function_privilege('public',p.oid,'EXECUTE')
),'PUBLIC cannot execute public-schema functions');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.parse_background_job_retry_at(text)','EXECUTE'),'worker cannot execute unrelated PUBLIC helper');
select pg_temp.assert_true((
 with expected(identity)as(values
  ('claim_due_booking_payment_events(text,uuid,integer)'),('renew_booking_payment_event_v3(uuid,uuid,bigint,integer)'),('fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text,integer)'),('reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)'),
  ('claim_due_booking_outbox(text,uuid,integer)'),('get_booking_outbox_context(uuid,uuid,bigint)'),('renew_booking_refund_command_v3(uuid,uuid,bigint,integer)'),('fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text,integer)'),
  ('expire_due_booking_holds_v3(text,integer)'),('expire_abandoned_booking_checkout_creations_v3(text,integer)'),('claim_due_booking_session_expiries_v3(text,uuid,integer)'),('renew_booking_session_expiry_v3(uuid,uuid,bigint,integer)'),('fail_booking_session_expiry_v3(uuid,uuid,bigint,boolean,text,integer)'),('claim_ambiguous_booking_checkouts(text,uuid,integer)'),('settle_booking_checkout(uuid,uuid,bigint,text,timestamp with time zone,boolean,boolean,text)'),
   ('claim_booking_calendar_reconciliation(text,uuid,integer)'),('renew_booking_calendar_reconciliation_v3(uuid,uuid,bigint,bigint,bigint,integer)'),('fail_booking_calendar_convergence(uuid,uuid,bigint,bigint,bigint,boolean,text,text,text)'),('record_booking_calendar_observation(uuid,uuid,bigint,bigint,bigint,text,text,timestamp with time zone,jsonb)'),('begin_booking_calendar_effect(uuid,uuid,bigint,bigint,bigint,text)'),('record_booking_calendar_effect_result(uuid,uuid,bigint,text,integer,jsonb)'),
  ('claim_booking_late_payment_arbitrations(text,uuid,integer)'),('renew_booking_late_payment_arbitration_v3(uuid,uuid,bigint,bigint,integer)'),('record_booking_late_payment_observation(uuid,uuid,bigint,bigint,timestamp with time zone,text,jsonb,text)'),
   ('reconcile_booking_notification_projection_v3(text,integer)'),('booking_notification_event_current_v4(uuid)'),('suppress_noncanonical_booking_notifications_v4(text,integer)'),('claim_due_booking_notifications_v3(text,uuid,integer,integer)'),('authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text)'),('get_booking_notification_context_v3(uuid,text,uuid,bigint)'),('complete_booking_notification_v3(uuid,text,uuid,bigint,text,text)'),('fail_booking_notification_v3(uuid,text,uuid,bigint,boolean,text)'),
  ('claim_due_booking_attachment_scans_v3(text,uuid,integer)'),('complete_booking_attachment_scan_v3(uuid,bigint,text,uuid,bigint,text,text,text,text,text)'),('claim_booking_attachment_cleanup_v3(text,uuid,integer,boolean)'),('authorize_booking_attachment_cleanup_v3(uuid,bigint,text,uuid,bigint)'),('complete_booking_attachment_cleanup_v3(uuid,bigint,text,uuid,bigint,boolean)'),
  ('claim_booking_worker_family_v3(text,text,uuid,integer)'),('renew_booking_worker_family_v3(text,text,uuid,bigint,integer)'),('complete_booking_worker_family_v3(text,text,uuid,bigint,boolean,text)')
 ),actual(identity)as(
  select p.oid::regprocedure::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and has_function_privilege('booking_worker',p.oid,'EXECUTE')
 )
 select not exists((select identity from expected except select identity from actual)union all(select identity from actual except select identity from expected))
),'worker effective function authority equals the final allowlist');
select pg_temp.assert_true(not has_function_privilege('anon','public.consume_booking_confirmation_capability(text,uuid)','EXECUTE'),'anonymous receipt consumption denied');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.apply_booking_payment_event(uuid,uuid,bigint,uuid,text,text,text,bigint,text,boolean)','EXECUTE'),'worker cannot project Stripe facts');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.apply_booking_provider_evidence(uuid,uuid,bigint)','EXECUTE'),'legacy inbox reducer denied');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)','EXECUTE'),'worker may invoke sole snapshot financial reducer');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.renew_booking_payment_event_v3(uuid,uuid,bigint,integer)','EXECUTE'),'Stripe inbox item renewal survives final closure');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text,integer)','EXECUTE'),'Stripe inbox classified failure survives final closure');
select pg_temp.assert_true(to_regprocedure('public.fail_booking_payment_event_v3(uuid,uuid,bigint,boolean,text)')is null
  and to_regprocedure('public.fail_booking_session_expiry_v3(uuid,uuid,bigint,boolean,text)')is null
  and to_regprocedure('public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text)')is null,
  'retry-delay failure RPCs have one defaulted implementation, not dangling old overloads');
select pg_temp.assert_true(not has_function_privilege('anon','public.renew_booking_payment_event_v3(uuid,uuid,bigint,integer)','EXECUTE'),'anonymous Stripe inbox renewal denied');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.settle_booking_refund_command(uuid,uuid,bigint,text,text,bigint,bigint)','EXECUTE'),'legacy refund settlement denied');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.complete_booking_outbox(uuid,uuid,bigint,jsonb)','EXECUTE'),'worker cannot invoke legacy refund completion');
select pg_temp.assert_true(not has_function_privilege('service_role','public.complete_booking_outbox(uuid,uuid,bigint,jsonb)','EXECUTE'),'service role cannot invoke legacy refund completion');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.claim_booking_calendar_reconciliation(text,uuid,integer)','EXECUTE'),'worker uses leased Google claims');
select pg_temp.assert_true(has_function_privilege('service_role','public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)','EXECUTE'),'service role may invoke sole manual repair RPC');
select pg_temp.assert_true(not has_function_privilege('anon','public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)','EXECUTE'),'anonymous manual repair denied');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)','EXECUTE'),'authenticated manual repair denied');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)','EXECUTE'),'worker manual repair denied');
select pg_temp.assert_true(to_regprocedure('public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text)')is null,
  'one defaulted repair implementation replaces the old exact signature');
select pg_temp.assert_true(has_function_privilege('service_role','public.get_booking_calendar_repair_context(uuid,text)','EXECUTE')
  and not has_function_privilege('anon','public.get_booking_calendar_repair_context(uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_booking_calendar_repair_context(uuid,text)','EXECUTE')
  and not has_function_privilege('booking_worker','public.get_booking_calendar_repair_context(uuid,text)','EXECUTE'),
  'admin repair context remains service-only and outside worker authority');
select pg_temp.assert_true(not has_table_privilege('service_role','public.calendar_event_links','INSERT'),'service role direct calendar insert denied');
select pg_temp.assert_true(not has_table_privilege('service_role','public.calendar_event_links','UPDATE'),'service role direct calendar update denied');
select pg_temp.assert_true(not has_table_privilege('service_role','public.calendar_event_links','DELETE'),'service role direct calendar delete denied');
select pg_temp.assert_true(not has_table_privilege('service_role','public.booking_calendar_repair_audit','INSERT'),'service role direct repair audit insert denied');
select pg_temp.assert_true(not has_table_privilege('booking_worker','public.booking_payments','SELECT'),'worker has no direct relation authority');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.booking_provider_evidence'::regclass),'provider evidence RLS enabled');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.booking_notifications'::regclass),'notification ledger RLS enabled');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.booking_notification_delivery_review_v3'::regclass),'notification delivery review RLS enabled');
select pg_temp.assert_true(not has_table_privilege('booking_worker','public.booking_notification_delivery_review_v3','SELECT'),'worker cannot read notification review queue');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.booking_provider_account_disconnects_v3'::regclass),'provider disconnect audit RLS enabled');
select pg_temp.assert_true(not has_function_privilege('anon','public.reserve_booking_provider_account_disconnect_v3(uuid,text,text,uuid,bigint)','EXECUTE'),'anonymous provider disconnect reservation denied');
select pg_temp.assert_true(has_function_privilege('service_role','public.get_pending_google_calendar_setup(uuid,text,bigint)','EXECUTE')
  and not has_function_privilege('anon','public.get_pending_google_calendar_setup(uuid,text,bigint)','EXECUTE')
  and not has_function_privilege('authenticated','public.get_pending_google_calendar_setup(uuid,text,bigint)','EXECUTE')
  and not has_function_privilege('booking_worker','public.get_pending_google_calendar_setup(uuid,text,bigint)','EXECUTE'),
  'pending setup DTO has the exact service-only read grant');
do $pending_read_acl$
declare denied boolean:=false;pending jsonb;
begin
  set local role service_role;
  pending:=public.get_pending_google_calendar_setup(gen_random_uuid(),'test',0);
  begin perform 1 from public.booking_provider_account_disconnects_v3;
    exception when insufficient_privilege then denied:=true;end;
  reset role;
  perform pg_temp.assert_true(pending is null and denied,
    'actual service RPC can read pending state without raw disconnect-ledger SELECT');
end $pending_read_acl$;
select pg_temp.assert_true(has_function_privilege('service_role','public.reserve_booking_provider_account_disconnect_v3(uuid,text,text,uuid,bigint)','EXECUTE'),'service provider disconnect reservation granted');
select pg_temp.assert_true(to_regprocedure('public.reserve_booking_provider_account_disconnect_v3(uuid,text,text,uuid)') is null,'unfenced disconnect reservation overload removed');
select pg_temp.assert_true(to_regprocedure('public.fail_booking_calendar_convergence(uuid,uuid,bigint,bigint,bigint,boolean,text)') is null,'calendar failure has one defaulted structured implementation');
select pg_temp.assert_true((select count(*)=2 from pg_attribute where attrelid='public.booking_notifications'::regclass and attname in('lease_token','lease_expires_at')and not attisdropped),'notification leases installed');
select pg_temp.assert_true((select count(*)=3 from pg_attribute where attrelid='public.calendar_event_links'::regclass and attname in('reconcile_lease_token','reconcile_lease_expires_at','reconcile_fencing_token')and not attisdropped),'calendar reconciliation lease/fence installed');
select pg_temp.assert_true((select count(*)=3 from pg_attribute where attrelid='public.booking_attachment_security'::regclass and attname in('scanner_config_fingerprint','clean_proven_at','eicar_proven_at')and not attisdropped),'dual scanner proof columns installed');
select pg_temp.assert_true((select count(*)=1 from pg_trigger where tgrelid='public.integration_outbox'::regclass and tgname='integration_outbox_block_v1_claim'and not tgisinternal),'v1 provider effects blocked from claims');
select pg_temp.assert_true((select count(*)=1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='admin_password_epoch_v2'and not tgisinternal),'password changes revoke admin authority');
select pg_temp.assert_true((select count(*)=1 from pg_trigger where tgrelid='auth.mfa_factors'::regclass and tgname='admin_mfa_factor_epoch_v2'and not tgisinternal),'MFA changes revoke admin authority');

-- Customer-lifecycle v3 authority and ACL closure.
select pg_temp.assert_true((select count(*)=1 from pg_trigger where tgrelid='public.appointments'::regclass and tgname='appointments_project_booking_notifications_v3'and not tgisinternal),'one notification projector installed');
select pg_temp.assert_true((select count(*)=0 from pg_trigger where tgrelid='public.appointments'::regclass and tgname='appointments_enqueue_booking_notifications'and not tgisinternal),'legacy notification trigger retired');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.enqueue_booking_notification(uuid,text)','EXECUTE'),'legacy notification enqueue revoked');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.claim_due_booking_notifications_v3(text,uuid,integer,integer)','EXECUTE'),'environment-scoped dispatch-contract notification claim granted');
select pg_temp.assert_true(to_regprocedure('public.claim_due_booking_notifications_v3(text,uuid,integer)')is null,'old dispatch-unaware exact claim signature removed');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text)','EXECUTE')
  and not has_function_privilege('service_role','public.authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text)','EXECUTE')
  and not has_function_privilege('anon','public.authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text)','EXECUTE'),
  'dispatch authorizer has only the fenced financial-worker grant');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.claim_due_booking_notifications(uuid,integer)','EXECUTE'),'unscoped notification claim revoked');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.claim_due_booking_outbox(text,uuid,integer)','EXECUTE'),'environment-scoped refund outbox claim granted');
select pg_temp.assert_true(not has_function_privilege('anon','public.claim_due_booking_outbox(text,uuid,integer)','EXECUTE'),'anonymous refund outbox claim denied');
select pg_temp.assert_true(to_regprocedure('public.claim_due_booking_outbox(uuid,integer)')is null,'unscoped refund outbox overload removed');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.expire_due_booking_holds_v3(text,integer)','EXECUTE'),'environment-scoped hold expiry granted');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.claim_due_booking_session_expiries_v3(text,uuid,integer)','EXECUTE'),'environment-scoped session expiry granted');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.renew_booking_session_expiry_v3(uuid,uuid,bigint,integer)','EXECUTE'),'session expiry lease renewal granted');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.fail_booking_session_expiry_v3(uuid,uuid,bigint,boolean,text,integer)','EXECUTE'),'session expiry fenced failure granted');
select pg_temp.assert_true(not has_function_privilege('anon','public.renew_booking_session_expiry_v3(uuid,uuid,bigint,integer)','EXECUTE'),'anonymous session expiry renewal denied');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.expire_due_booking_holds(integer)','EXECUTE'),'unscoped hold expiry retired');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.renew_booking_refund_command_v3(uuid,uuid,bigint,integer)','EXECUTE'),'refund lease renewal granted');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.renew_booking_worker_family_v3(text,text,uuid,bigint,integer)','EXECUTE'),'family lease renewal granted');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.renew_booking_late_payment_arbitration_v3(uuid,uuid,bigint,bigint,integer)','EXECUTE'),'late-payment arbitration renewal survives final closure');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.renew_booking_calendar_reconciliation_v3(uuid,uuid,bigint,bigint,bigint,integer)','EXECUTE'),'calendar convergence renewal survives final closure');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.expire_abandoned_booking_checkout_creations_v3(text,integer)','EXECUTE'),'abandoned checkout terminalization survives final closure');
select pg_temp.assert_true(not has_function_privilege('anon','public.expire_abandoned_booking_checkout_creations_v3(text,integer)','EXECUTE'),'anonymous abandoned checkout terminalization denied');
select pg_temp.assert_true(not has_function_privilege('anon','public.renew_booking_worker_family_v3(text,text,uuid,bigint,integer)','EXECUTE'),'anonymous family renewal denied');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.claim_due_booking_attachment_scans_v3(text,uuid,integer)','EXECUTE'),'generation-scoped scan claim granted');
select pg_temp.assert_true(has_function_privilege('booking_worker','public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text,integer)','EXECUTE'),'worker uses reducer-owned refund failure settlement');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.fail_booking_outbox(uuid,uuid,bigint,boolean,text)','EXECUTE'),'legacy split-authority outbox failure denied');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.complete_booking_attachment_scan(uuid,uuid,bigint,text,text)','EXECUTE'),'legacy attachment completion revoked');
select pg_temp.assert_true(not has_function_privilege('anon','public.record_booking_attachment_scanner_proof_v3(text,text,text,boolean,boolean,text,text,text,text)','EXECUTE'),'anonymous scanner proof denied');
select pg_temp.assert_true(not has_function_privilege('anon','public.prepare_booking_attachment_uploads_v3(uuid,uuid,text,text,jsonb)','EXECUTE'),'anonymous upload admission denied');
select pg_temp.assert_true(not has_function_privilege('anon','public.claim_booking_worker_family_v3(text,text,uuid,integer)','EXECUTE'),'anonymous worker family claim denied');
select pg_temp.assert_true(not has_function_privilege('service_role','public.authorize_booking_attachment_download(uuid,uuid)','EXECUTE'),'legacy attachment download authority retired');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.booking_receipt_capabilities_v3'::regclass),'receipt capability RLS enabled');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.booking_upload_grants_v3'::regclass),'upload grant RLS enabled');
select pg_temp.assert_true((select count(*)=0 from cron.job where jobname like 'obra-booking-%-v3'),'worker schedules remain disabled pending environment-specific activation evidence');
select pg_temp.assert_true((select position('o.environment=p_environment' in prosrc)>0 and position('o.command_type=''refund''' in prosrc)>0 and position('''notify''' in prosrc)=0 from pg_proc where oid='public.claim_due_booking_outbox(text,uuid,integer)'::regprocedure),'legacy outbox claim is refund-only');
select pg_temp.assert_true((select prosrc like '%project_booking_notifications_v3%'from pg_proc where oid='public.enqueue_booking_notification(uuid,text)'::regprocedure),'legacy enqueue compatibility routes through sole projector');
select pg_temp.assert_true((select count(*)=1 from pg_class where oid='public.booking_notification_projection_repairs_v3'::regclass and relrowsecurity),'notification projection failure repair evidence installed');
select pg_temp.assert_true((select position('intent->>''status''in(''requires_payment_method'',''canceled'')'in prosrc)>0 and position('outcome:=''expiry_unpaid_payment_intent_released'''in prosrc)>0 from pg_proc where oid='public.reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)'::regprocedure),'failed or canceled no-charge PaymentIntent expiry has a terminal capacity-release reduction');
select pg_temp.assert_true((select position('absolute_refunded<p.amount_refunded_minor' in prosrc)>0 and position('absolute_refunded>p.amount_paid_minor' in prosrc)>0 and position('absolute_refunded<amount_refunded_minor' in prosrc)=0 and position('absolute_refunded>amount_paid_minor' in prosrc)=0 from pg_proc where oid='public.complete_booking_outbox(uuid,uuid,bigint,jsonb)'::regprocedure),'legacy refund completion uses its loaded payment row as amount authority');
select pg_temp.assert_true((select position('case when p_retryable then ''failed'' else ''dead_letter'' end'in prosrc)>0 and position('if not p_retryable then'in prosrc)>0 from pg_proc where oid='public.fail_booking_refund_command_v3(uuid,uuid,bigint,boolean,text,integer)'::regprocedure),'refund failure contract distinguishes retryable release from terminal aggregate review');

-- Exercise customer-lifecycle authorities against real rows. Reuse the tenant activated by
-- the dedicated prior-transaction harness because PostgreSQL forbids same-xid activation.
create temp table payment_test_context(tenant uuid not null);
insert into payment_test_context(tenant)values(:'cutover_tenant'::uuid);
do $behavior$
declare tenant uuid;site uuid:=gen_random_uuid();site_version uuid:=gen_random_uuid();entitlement uuid:=gen_random_uuid();service uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();appointment uuid:=gen_random_uuid();payment uuid:=gen_random_uuid();expiry_appointment uuid:=gen_random_uuid();expiry_payment uuid:=gen_random_uuid();expiry_lease uuid:=gen_random_uuid();failed_intent_appointment uuid:=gen_random_uuid();failed_intent_payment uuid:=gen_random_uuid();failed_intent_lease uuid:=gen_random_uuid();paid_expiry_appointment uuid:=gen_random_uuid();paid_expiry_payment uuid:=gen_random_uuid();paid_expiry_lease uuid:=gen_random_uuid();refund_appointment uuid:=gen_random_uuid();refund_payment uuid:=gen_random_uuid();refund_command uuid:=gen_random_uuid();stale_notice uuid:=gen_random_uuid();notice_lease uuid:=gen_random_uuid();family_lease uuid:=gen_random_uuid();
begin
 select c.tenant into strict tenant from payment_test_context c;
 insert into public.websites(id,user_id,status,environment)values(site,tenant,'draft','test');
 insert into public.website_versions(id,website_id,version_number,config_json,variant_key,status)values(site_version,site,1,'{}','bucket3-smoke','live');
 update public.websites set active_version_id=site_version,status='live'where id=site;
 insert into public.website_entitlements(id,profile_id,website_id,environment,plan,state,booking_admission)values(entitlement,tenant,site,'test','pro','active',true);
 insert into public.booking_services(id,profile_id,environment,name,duration_minutes,amount_minor,currency,active)values(service,tenant,'test','Smoke',60,1000,'USD',true);
 begin
  perform public.reserve_live_booking(site,'test',now()+interval '1 day',current_date+1,'00:00','UTC',gen_random_uuid(),repeat('a',64),repeat('b',64),null,null,null,'{}',now(),repeat('c',64),0,repeat('d',64));
  raise exception'public reservation without exact consent accepted';
 exception when invalid_parameter_value then null;end;
 insert into public.booking_customers(id,profile_id,environment,full_name,email_normalized,phone_normalized,address_snapshot,source_website_id,consented_at,consent_document_id,consent_version,consent_digest)values(customer,tenant,'test','Test Customer','customer@example.com','+15555550123','{}',site,now(),'obra-booking-data-and-payment-consent','2026-08-29.1','899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f');
 insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,public_reference,start_at,end_at,local_date,local_start,time_zone,customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,reservation_expires_at,booking_contract_version)values(appointment,tenant,site,entitlement,service,customer,'test',gen_random_uuid(),now()+interval '1 day',now()+interval '1 day 1 hour',(now()+interval '1 day')::date,(now()+interval '1 day')::time,'UTC','{"email":"customer@example.com"}','{"name":"Smoke"}','{}',1000,'USD',60,tstzrange(now()+interval '1 day',now()+interval '1 day 1 hour','[)'),'payment_pending','pending',now()+interval '15 minutes',2);
 insert into public.booking_payments(id,appointment_id,profile_id,environment,expected_amount_minor,currency,payment_state,checkout_session_id,stripe_account_id,booking_contract_version,confirmation_nonce_hash,confirmation_handoff_expires_at)values(payment,appointment,tenant,'test',1000,'USD','pending','cs_test_smoke','acct_smoke',2,repeat('c',64),now()+interval '35 minutes');
 perform public.issue_booking_confirmation_capability_v3('cs_test_smoke',repeat('d',64),repeat('c',64));
 perform pg_temp.assert_true((public.consume_booking_confirmation_capability_v3(repeat('d',64),(select public_reference from public.appointments where id=appointment))->>'statusCode')='payment_pending','provider-verified return reaches pending projection');
 perform pg_temp.assert_true((select consent_document_id='obra-booking-data-and-payment-consent' and consent_version='2026-08-29.1' and consent_digest='899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f' and consented_at is not null from public.booking_customers where id=customer),'exact stable consent evidence persists');
 perform pg_temp.assert_true(public.recover_booking_checkout_handoff_v3(appointment,repeat('c',64))is not null,'handoff survives during checkout plus safe skew');
 update public.booking_payments set confirmation_handoff_expires_at=now()-interval '1 second' where id=payment;
 perform pg_temp.assert_true(public.recover_booking_checkout_handoff_v3(appointment,repeat('c',64))is null,'handoff recovery rejects expired skew lifetime');
 begin
  perform public.issue_booking_confirmation_capability_v3('cs_test_smoke',repeat('e',64),repeat('c',64));
  raise exception'expired handoff minted receipt authority';
 exception when no_data_found then null;end;
 update public.booking_payments set confirmation_handoff_expires_at=now()+interval '35 minutes' where id=payment;
 perform pg_temp.assert_true((select count(*)=0 from public.booking_notifications where appointment_id=appointment),'no notification fabricated before lifecycle event');
 insert into public.appointment_operations(profile_id,appointment_id,environment,operation_type,client_request_id,request_hash,request_capability_hash,state,result)
 values(tenant,appointment,'test','reserve',gen_random_uuid(),repeat('f',64),repeat('1',64),'succeeded',pg_catalog.jsonb_build_object('appointmentId',appointment));
 perform pg_temp.assert_true((select request_capability_hash=repeat('1',64) from public.appointment_operations where appointment_id=appointment and operation_type='reserve'),'booking request replay is bound to its original browser capability');
 begin
  perform public.reserve_live_booking(site,'test',now()+interval '1 day',current_date+1,'00:00','UTC',(select client_request_id from public.appointment_operations where appointment_id=appointment and operation_type='reserve'),repeat('f',64),repeat('2',64),'obra-booking-data-and-payment-consent','2026-08-29.1','899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f','{}',now(),repeat('3',64),0,repeat('4',64));
  raise exception'foreign browser replay unexpectedly accepted';
 exception when insufficient_privilege then null;end;
 update public.appointments set appointment_state='cancelled',appointment_reason='customer_cancelled',cancelled_at=now(),reservation_expires_at=null where id=appointment;
 perform public.project_booking_notifications_v3(appointment);
 perform pg_temp.assert_true((select count(*)=2 from public.booking_notifications where appointment_id=appointment and notification_type='cancelled'),'one delivery per audience projected idempotently');
 perform pg_temp.assert_true((select count(*)=0 from public.integration_outbox where appointment_id=appointment and command_type='notify'),'notification outbox authority retired');
 update public.appointments set appointment_reason='late_payment_arbitration',review_state='late_payment'where id=appointment;
 perform public.project_booking_notifications_v3(appointment);
 perform pg_temp.assert_true((select count(*)=0 from public.booking_notifications where appointment_id=appointment and notification_type in('late_payment','refund_pending')),'provisional late-payment state projects no refund or late notice');
 update public.appointments set appointment_reason='late_payment_recovered',appointment_state='confirmed',confirmed_at=now(),cancelled_at=null,review_state='none'where id=appointment;
 perform public.project_booking_notifications_v3(appointment);
 perform pg_temp.assert_true((select count(*)=2 from public.booking_notifications where appointment_id=appointment and notification_type='late_payment'),'recovered late-payment decision projects one final notice per audience');
 insert into public.booking_notifications(id,appointment_id,profile_id,environment,notification_type,audience,recipient_email,idempotency_key,occurrence_version,source_event_key,state)values(stale_notice,appointment,tenant,'test','refund_pending','customer','customer@example.com','booking-notify:v3:test:'||appointment||':refund:0:pending:customer',0,'refund:0:pending','pending');
  perform pg_temp.assert_true((select count(*)=0 from public.claim_due_booking_notifications_v3('test',notice_lease,25,1)where id=stale_notice),'claim rejects stale provisional refund notice after recovery');
 perform pg_temp.assert_true((select state='suppressed'and suppression_reason='noncanonical_current_state'from public.booking_notifications where id=stale_notice),'stale provisional notice is suppressed and unleased');
 update public.booking_notifications set state='processing',lease_token=notice_lease,lease_expires_at=now()+interval'2 minutes',fencing_token=1 where id=stale_notice;
 perform pg_temp.assert_true(public.get_booking_notification_context_v3(stale_notice,'test',notice_lease,1)is null,'final context rejects stale notification even under a current fence');
  perform pg_temp.assert_true((select count(*)=0 from public.claim_due_booking_notifications_v3('live',gen_random_uuid(),25,1)),'notification claims cannot cross environments');
 insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,public_reference,start_at,end_at,local_date,local_start,time_zone,customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,reservation_expires_at,booking_contract_version)values(expiry_appointment,tenant,site,entitlement,service,customer,'test',gen_random_uuid(),now()+interval'3 days',now()+interval'3 days 1 hour',(now()+interval'3 days')::date,(now()+interval'3 days')::time,'UTC','{"email":"expiry@example.com"}','{"name":"Smoke"}','{}',1000,'USD',60,tstzrange(now()+interval'3 days',now()+interval'3 days 1 hour','[)'),'payment_pending','pending',now()-interval'1 minute',2);
 insert into public.booking_payments(id,appointment_id,profile_id,environment,expected_amount_minor,currency,payment_state,checkout_session_id,checkout_expires_at,checkout_provider_expires_at,stripe_account_id,booking_contract_version)values(expiry_payment,expiry_appointment,tenant,'test',1000,'USD','pending','cs_expiry_smoke',now()+interval'15 minutes',now()+interval'15 minutes','acct_smoke',2);
 perform pg_temp.assert_true((select count(*)=0 from public.claim_due_booking_session_expiries_v3('live',gen_random_uuid(),1)),'session expiry cannot cross environments');
 perform pg_temp.assert_true((select count(*)=1 from public.claim_due_booking_session_expiries_v3('test',expiry_lease,1)where id=expiry_payment),'expired test reservation claims its later-lived provider session');
 begin
  perform public.reduce_booking_financial_evidence_v3('session_expiry',expiry_payment,expiry_lease,1,pg_catalog.jsonb_build_object('stripeAccountId','acct_smoke','checkout',pg_catalog.jsonb_build_object('id','cs_expiry_smoke','object','checkout.session','livemode',false,'status','open','payment_status','unpaid','payment_intent',null,'amount_total',1000,'currency','usd','metadata',pg_catalog.jsonb_build_object('kind','booking','appointmentId',expiry_appointment,'profileId',tenant,'environment','test')),'paymentIntent',null,'charge',null,'refunds','[]'::jsonb,'refundsHasMore',false));
  raise exception'nonterminal unpaid snapshot unexpectedly released capacity';
 exception when sqlstate'40001'then null;end;
 perform pg_temp.assert_true((select appointment_state='payment_pending'and payment_state='pending'from public.appointments where id=expiry_appointment),'open unpaid provider snapshot cannot release capacity');
 perform pg_temp.assert_true(public.renew_booking_session_expiry_v3(expiry_payment,expiry_lease,1,300),'current session-expiry fence renews');
 perform pg_temp.assert_true(not public.renew_booking_session_expiry_v3(expiry_payment,gen_random_uuid(),1,300),'foreign session-expiry lease cannot renew');
 perform public.reduce_booking_financial_evidence_v3('session_expiry',expiry_payment,expiry_lease,1,pg_catalog.jsonb_build_object('stripeAccountId','acct_smoke','checkout',pg_catalog.jsonb_build_object('id','cs_expiry_smoke','object','checkout.session','livemode',false,'status','expired','payment_status','unpaid','payment_intent',null,'amount_total',1000,'currency','usd','metadata',pg_catalog.jsonb_build_object('kind','booking','appointmentId',expiry_appointment,'profileId',tenant,'environment','test')),'paymentIntent',null,'charge',null,'refunds','[]'::jsonb,'refundsHasMore',false));
 perform pg_temp.assert_true((select appointment_state='cancelled'and appointment_reason='payment_expired'and payment_state='failed'from public.appointments where id=expiry_appointment),'unpaid terminal provider evidence releases expired capacity');
 perform pg_temp.assert_true(not public.renew_booking_session_expiry_v3(expiry_payment,expiry_lease,1,300),'settled expiry fence cannot renew');
 insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,public_reference,start_at,end_at,local_date,local_start,time_zone,customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,reservation_expires_at,booking_contract_version)values(failed_intent_appointment,tenant,site,entitlement,service,customer,'test',gen_random_uuid(),now()+interval'5 days',now()+interval'5 days 1 hour',(now()+interval'5 days')::date,(now()+interval'5 days')::time,'UTC','{"email":"failed-intent@example.com"}','{"name":"Smoke"}','{}',1000,'USD',60,tstzrange(now()+interval'5 days',now()+interval'5 days 1 hour','[)'),'payment_pending','pending',now()-interval'1 minute',2);
 insert into public.booking_payments(id,appointment_id,profile_id,environment,expected_amount_minor,currency,payment_state,checkout_session_id,checkout_expires_at,checkout_provider_expires_at,stripe_account_id,booking_contract_version)values(failed_intent_payment,failed_intent_appointment,tenant,'test',1000,'USD','pending','cs_failed_intent_smoke',now()+interval'15 minutes',now()+interval'15 minutes','acct_smoke',2);
 perform pg_temp.assert_true((select count(*)=1 from public.claim_due_booking_session_expiries_v3('test',failed_intent_lease,1)where id=failed_intent_payment),'failed-card expiry claims under a fresh fence');
 perform public.reduce_booking_financial_evidence_v3('session_expiry',failed_intent_payment,failed_intent_lease,1,pg_catalog.jsonb_build_object('stripeAccountId','acct_smoke','checkout',pg_catalog.jsonb_build_object('id','cs_failed_intent_smoke','object','checkout.session','livemode',false,'status','expired','payment_status','unpaid','payment_intent','pi_failed_expiry','amount_total',1000,'currency','usd','metadata',pg_catalog.jsonb_build_object('kind','booking','appointmentId',failed_intent_appointment,'profileId',tenant,'environment','test')),'paymentIntent',pg_catalog.jsonb_build_object('id','pi_failed_expiry','object','payment_intent','livemode',false,'status','requires_payment_method','amount',1000,'currency','usd','metadata',pg_catalog.jsonb_build_object('kind','booking','appointmentId',failed_intent_appointment)),'charge',null,'refunds','[]'::jsonb,'refundsHasMore',false));
 perform pg_temp.assert_true((select appointment_state='cancelled'and appointment_reason='payment_expired'and payment_state='failed'and reservation_expires_at is null from public.appointments where id=failed_intent_appointment),'failed-card no-charge PaymentIntent expiry releases capacity');
 perform pg_temp.assert_true((select payment_state='failed'and payment_intent_id='pi_failed_expiry'and checkout_lease_token is null and session_expiry_next_attempt_at<>'infinity'::timestamptz from public.booking_payments where id=failed_intent_payment),'failed-card PaymentIntent is terminally recorded instead of requeued');
 perform pg_temp.assert_true(not public.renew_booking_session_expiry_v3(failed_intent_payment,failed_intent_lease,1,300),'released failed-card expiry fence cannot renew');
 insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,public_reference,start_at,end_at,local_date,local_start,time_zone,customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,reservation_expires_at,booking_contract_version)values(paid_expiry_appointment,tenant,site,entitlement,service,customer,'test',gen_random_uuid(),now()+interval'4 days',now()+interval'4 days 1 hour',(now()+interval'4 days')::date,(now()+interval'4 days')::time,'UTC','{"email":"paid-expiry@example.com"}','{"name":"Smoke"}','{}',1000,'USD',60,tstzrange(now()+interval'4 days',now()+interval'4 days 1 hour','[)'),'payment_pending','pending',now()-interval'1 minute',2);
 insert into public.booking_payments(id,appointment_id,profile_id,environment,expected_amount_minor,currency,payment_state,checkout_session_id,checkout_expires_at,checkout_provider_expires_at,stripe_account_id,booking_contract_version)values(paid_expiry_payment,paid_expiry_appointment,tenant,'test',1000,'USD','pending','cs_paid_expiry_smoke',now()+interval'15 minutes',now()+interval'15 minutes','acct_smoke',2);
 perform pg_temp.assert_true((select count(*)=1 from public.claim_due_booking_session_expiries_v3('test',paid_expiry_lease,1)where id=paid_expiry_payment),'paid-at-cutoff candidate claims under its own fence');
 perform public.reduce_booking_financial_evidence_v3('session_expiry',paid_expiry_payment,paid_expiry_lease,1,pg_catalog.jsonb_build_object('stripeAccountId','acct_smoke','checkout',pg_catalog.jsonb_build_object('id','cs_paid_expiry_smoke','object','checkout.session','livemode',false,'status','complete','payment_status','paid','payment_intent','pi_paid_expiry','amount_total',1000,'currency','usd','metadata',pg_catalog.jsonb_build_object('kind','booking','appointmentId',paid_expiry_appointment,'profileId',tenant,'environment','test')),'paymentIntent',pg_catalog.jsonb_build_object('id','pi_paid_expiry','object','payment_intent','livemode',false,'status','succeeded','amount',1000,'currency','usd','metadata',pg_catalog.jsonb_build_object('kind','booking','appointmentId',paid_expiry_appointment)),'charge',pg_catalog.jsonb_build_object('id','ch_paid_expiry','object','charge','livemode',false,'payment_intent','pi_paid_expiry','amount',1000,'currency','usd','paid',true,'amount_refunded',0),'refunds','[]'::jsonb,'refundsHasMore',false));
 perform pg_temp.assert_true((select appointment_state='cancelled'and appointment_reason='late_payment_arbitration'and payment_state='paid'and refund_state='not_requested'from public.appointments where id=paid_expiry_appointment),'paid cutoff evidence enters provisional late-payment arbitration');
 perform pg_temp.assert_true((select count(*)=1 from public.booking_late_payment_arbitrations where payment_id=paid_expiry_payment),'paid cutoff creates one fresh arbitration');
 perform pg_temp.assert_true((select count(*)=0 from public.integration_outbox where appointment_id=paid_expiry_appointment and command_type='refund'),'future paid cutoff does not queue a provisional refund');
 perform pg_temp.assert_true((select count(*)=0 from public.booking_notifications where appointment_id=paid_expiry_appointment and notification_type in('cancelled','refund_pending','late_payment')),'paid cutoff provisional state emits no external notice');
 insert into public.appointments(id,profile_id,website_id,entitlement_id,service_id,customer_id,environment,public_reference,start_at,end_at,local_date,local_start,time_zone,customer_snapshot,service_snapshot,location_snapshot,amount_minor,currency,duration_minutes,capacity_range,appointment_state,payment_state,refund_state,refund_generation,cancelled_at,reservation_expires_at,booking_contract_version)
 values(refund_appointment,tenant,site,entitlement,service,customer,'test',gen_random_uuid(),now()+interval '2 days',now()+interval '2 days 1 hour',(now()+interval '2 days')::date,(now()+interval '2 days')::time,'UTC','{"email":"refund@example.com"}','{"name":"Smoke"}','{}',1000,'USD',60,tstzrange(now()+interval '2 days',now()+interval '2 days 1 hour','[)'),'cancelled','paid','pending',1,now(),null,2);
 insert into public.booking_payments(id,appointment_id,profile_id,environment,expected_amount_minor,currency,payment_state,amount_paid_minor,amount_refunded_minor,refund_state,refund_generation,payment_intent_id,charge_id,stripe_account_id,booking_contract_version)
 values(refund_payment,refund_appointment,tenant,'test',1000,'USD','paid',1000,0,'pending',1,'pi_refund_smoke','ch_refund_smoke','acct_smoke',2);
 insert into public.integration_outbox(id,profile_id,appointment_id,environment,command_type,idempotency_key,desired_appointment_version,effect_generation,effect_contract_version,payload)
 values(refund_command,tenant,refund_appointment,'test','refund','booking-refund:'||refund_appointment::text||':1',1,1,2,'{}');
 perform pg_temp.assert_true((select count(*)=0 from public.claim_due_booking_outbox('live',gen_random_uuid(),25)),'refund outbox claims cannot cross environments');
 family_lease:=gen_random_uuid();
 perform pg_temp.assert_true((select count(*)=1 from public.claim_due_booking_outbox('test',family_lease,25)where id=refund_command),'matching environment claims the due refund');
 perform pg_temp.assert_true(public.renew_booking_refund_command_v3(refund_command,family_lease,1,180),'current refund fence renews');
 perform pg_temp.assert_true(not public.renew_booking_refund_command_v3(refund_command,gen_random_uuid(),1,180),'foreign refund lease cannot renew');
 perform pg_temp.assert_true(not public.fail_booking_refund_command_v3(refund_command,gen_random_uuid(),1,true,'foreign refund failure'),'foreign refund failure fence returns false');
 perform pg_temp.assert_true((select state='processing'and lease_token=family_lease from public.integration_outbox where id=refund_command),'foreign refund failure fence leaves the claim unchanged');
 perform pg_temp.assert_true(public.fail_booking_refund_command_v3(refund_command,family_lease,1,true,repeat('r',300)),'current retryable refund failure releases its command lease');
 perform pg_temp.assert_true((select state='failed'and terminal_at is null and next_attempt_at>pg_catalog.clock_timestamp()and next_attempt_at<>'infinity'::timestamptz and lease_token is null and lease_expires_at is null and pg_catalog.length(safe_error)=240 from public.integration_outbox where id=refund_command),'retryable refund failure is finite, unleased, and safely bounded');
 perform pg_temp.assert_true((select refund_state='pending'and review_state<>'refund_failure'from public.appointments where id=refund_appointment)and(select refund_state='pending'from public.booking_payments where id=refund_payment),'retryable refund failure does not fabricate terminal aggregate truth');
 update public.integration_outbox set next_attempt_at=pg_catalog.clock_timestamp()where id=refund_command;
 family_lease:=gen_random_uuid();
 perform pg_temp.assert_true((select count(*)=1 from public.claim_due_booking_outbox('test',family_lease,25)where id=refund_command and fencing_token=2),'retryable refund command can be reclaimed under a fresh fence');
 perform pg_temp.assert_true(public.fail_booking_refund_command_v3(refund_command,family_lease,2,false,'terminal refund configuration failure'),'current terminal refund failure settles the aggregate');
 perform pg_temp.assert_true((select state='dead_letter'and terminal_at is not null and next_attempt_at='infinity'::timestamptz and lease_token is null and lease_expires_at is null from public.integration_outbox where id=refund_command),'terminal refund failure dead-letters and clears its lease');
 perform pg_temp.assert_true((select refund_state='failed'and review_state='refund_failure'from public.appointments where id=refund_appointment)and(select refund_state='failed'from public.booking_payments where id=refund_payment),'terminal refund failure moves the aggregate to review');
 perform pg_temp.assert_true(public.claim_booking_worker_family_v3('test','notifications',family_lease,55)=1,'worker family first claim succeeds');
 perform pg_temp.assert_true(public.renew_booking_worker_family_v3('test','notifications',family_lease,1,55),'current family fence renews');
 perform pg_temp.assert_true(not public.renew_booking_worker_family_v3('test','notifications',gen_random_uuid(),1,55),'foreign family lease cannot renew');
 perform pg_temp.assert_true(public.claim_booking_worker_family_v3('test','notifications',gen_random_uuid(),55)is null,'worker family overlap is fenced');
end $behavior$;

rollback;
\echo 'bucket3-booking: passed'
