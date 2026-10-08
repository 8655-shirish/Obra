\set ON_ERROR_STOP on
\echo 'admin-auth-authority-closure: database contract smoke'
begin;
create or replace function pg_temp.assert_true(ok boolean,message text)returns void language plpgsql as $$begin if ok is not true then raise exception 'assertion failed: %',message;end if;end$$;

select pg_temp.assert_true(to_regclass('public.admin_bootstrap_state')is not null,'permanent bootstrap tombstone exists');
select pg_temp.assert_true((select count(*)=1 from public.admin_bootstrap_state),'bootstrap has exactly one durable row');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.admin_auth_handoffs'::regclass),'handoffs use RLS');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.admin_recovery_attempts'::regclass),'recovery attempts use RLS');
select pg_temp.assert_true((select relrowsecurity from pg_class where oid='public.admin_auth_audit_events'::regclass),'audit uses RLS');
select pg_temp.assert_true(has_function_privilege('authenticated','public.authorize_admin_session_handoff_v4(text,text,uuid,text,text[])','EXECUTE'),'AAL2 client may authorize one handoff');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.consume_admin_session_handoff_v4(text)','EXECUTE'),'client cannot consume handoff');
select pg_temp.assert_true(has_function_privilege('service_role','public.consume_admin_session_handoff_v4(text)','EXECUTE'),'service may atomically consume handoff');
select pg_temp.assert_true(not has_function_privilege('service_role','public.bump_admin_auth_epoch_v2(uuid,text)','EXECUTE'),'runtime cannot invoke internal epoch helper');
select pg_temp.assert_true(not has_table_privilege('service_role','public.admin_bootstrap_state','UPDATE'),'runtime cannot reopen bootstrap');
select pg_temp.assert_true(not has_table_privilege('service_role','public.admin_auth_audit_events','INSERT'),'runtime cannot forge audit evidence');
select pg_temp.assert_true((select count(*)=1 from information_schema.columns where table_schema='public'and table_name='admin_auth_handoffs'and column_name='recovery_attempt_token_hash'),'handoff binds exact recovery attempt');
select pg_temp.assert_true(to_regprocedure('public.create_admin_session_v3(text)')is null,'replayable AAL2 mint removed');
select pg_temp.assert_true(to_regprocedure('public.create_admin_session(text,uuid)')is null,'legacy service mint removed');
select pg_temp.assert_true(to_regprocedure('public.create_admin_session_v2(text,uuid)')is null,'legacy service mint v2 removed');
select pg_temp.assert_true(to_regprocedure('public.bootstrap_admin_principal_v2(uuid)')is null,'reopenable bootstrap removed');
select pg_temp.assert_true(to_regprocedure('public.provision_admin_principal_v2(text,uuid)')is null,'enable-on-conflict provision removed');
select pg_temp.assert_true((select count(*)=1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='admin_ban_authority_v4'and not tgisinternal),'ban invalidation trigger installed');
select pg_temp.assert_true((select count(*)=1 from pg_trigger where tgrelid='public.admin_auth_audit_events'::regclass and tgname='admin_auth_audit_no_update_v4'and not tgisinternal),'audit append-only trigger installed');
select pg_temp.assert_true(not exists(select 1 from public.admin_sessions where revoked_at is null),'cutover leaves no old opaque sessions');
select pg_temp.assert_true((select position('admin_auth_lock_v4' in prosrc)>0 and position('p.enabled and p.mfa_required' in prosrc)>position('admin_auth_lock_v4' in prosrc) and position('u.deleted_at is null' in prosrc)>0 from pg_proc where oid='public.validate_admin_session_v4(text,boolean)'::regprocedure),'session authority is locked before canonical live-provider AAL2 revalidation');
select pg_temp.assert_true((select count(*)=1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='admin_ban_authority_v4'and pg_get_triggerdef(oid)like '%banned_until, confirmed_at, deleted_at%'),'provider soft deletion invalidates admin authority');
select pg_temp.assert_true((select position('validate_admin_session_v4' in prosrc)>0 and position('admin_sessions' in prosrc)=0 and position('booking_calendar_repair_audit' in prosrc)>0 from pg_proc where oid='public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)'::regprocedure),'calendar repair delegates to canonical locked validator and audit');
select pg_temp.assert_true(has_function_privilege('service_role','public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)','EXECUTE'),'service role may invoke sole repair authority');
select pg_temp.assert_true(not has_function_privilege('booking_worker','public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text,jsonb)','EXECUTE'),'worker cannot invoke admin repair authority');
select pg_temp.assert_true((select position('validate_admin_session_v4' in prosrc)>0 and prosecdef and proconfig=array['search_path=""']
  from pg_proc where oid='public.get_booking_calendar_repair_context(uuid,text)'::regprocedure),'repair context revalidates canonical AAL2 admin authority');
select pg_temp.assert_true(not has_table_privilege('service_role','public.calendar_event_links','UPDATE'),'service role cannot bypass repair RPC');
select pg_temp.assert_true(not has_table_privilege('service_role','public.booking_calendar_repair_audit','INSERT'),'service role cannot forge repair audit');
select pg_temp.assert_true(not has_table_privilege('service_role','public.admin_sessions','INSERT'),'service role cannot mint opaque admin sessions');
select pg_temp.assert_true(not has_table_privilege('service_role','public.admin_sessions','UPDATE'),'service role cannot rewrite opaque admin sessions');
select pg_temp.assert_true(not has_table_privilege('service_role','public.admin_principals','UPDATE'),'service role cannot change admin principals');
select pg_temp.assert_true(has_column_privilege('service_role','public.admin_principals','enabled','SELECT'),'login flow retains narrow principal read');
select pg_temp.assert_true(not has_column_privilege('service_role','public.admin_principals','auth_epoch','SELECT'),'service role cannot read broader principal authority');
select pg_temp.assert_true((select count(*)=1 from pg_trigger where tgrelid='public.booking_calendar_repair_audit'::regclass and tgname='booking_calendar_repair_audit_no_truncate'and not tgisinternal),'repair audit blocks truncate');

-- A preexisting provider soft delete cannot be converted into opaque authority, even before
-- the provider update trigger has had an opportunity to revoke the synthetic session.
insert into auth.users(id,email,confirmed_at,deleted_at)values('a1100000-0000-0000-0000-000000000001','deleted-admin@example.com',pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp());
insert into public.admin_principals(user_id,role,enabled,mfa_required)values('a1100000-0000-0000-0000-000000000001','admin',true,true);
insert into public.admin_sessions(token_hash,user_id,role,aal,auth_epoch,idle_expires_at,absolute_expires_at)
values(repeat('a',64),'a1100000-0000-0000-0000-000000000001','admin','aal2',1,pg_catalog.clock_timestamp()+interval'30 minutes',pg_catalog.clock_timestamp()+interval'12 hours');
select pg_temp.assert_true((select count(*)=0 from public.validate_admin_session_v4(repeat('a',64),false)),'soft-deleted provider user has no opaque admin authority');
rollback;
