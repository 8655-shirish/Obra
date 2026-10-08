-- PostgREST session role for isolated booking workers: RPC-only and no direct relation authority.
-- Production dry-run evidence proves this role is absent. Refuse pre-existing identity.
-- PostgreSQL 16+ gives a constrained CREATEROLE creator an immutable ADMIN-only edge
-- on roles it creates (INHERIT false, SET false); verify that exact bounded shape.
do $role$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('booking_worker_role_provisioning',0));
 if exists(select 1 from pg_catalog.pg_roles where rolname='booking_worker')then
  raise exception 'booking_worker role must not preexist' using errcode='42501';
 end if;
 if exists(
  select 1 from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
   and pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')
   and p.proowner<>(select oid from pg_catalog.pg_roles where rolname=current_user)
 )then
  raise exception 'migration owner cannot close all PUBLIC function grants' using errcode='42501';
 end if;
 create role booking_worker nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
 if not exists(
  select 1 from pg_catalog.pg_roles
  where rolname='booking_worker'
   and rolcanlogin=false and rolsuper=false and rolcreatedb=false
   and rolcreaterole=false and rolreplication=false
   and rolbypassrls=false and rolinherit=false
 )then
  raise exception 'booking_worker role attributes are unsafe' using errcode='42501';
 end if;
 if current_setting('server_version_num')::integer>=160000 then
  execute 'grant booking_worker to authenticator with admin false';
  execute 'grant booking_worker to authenticator with inherit true';
  execute 'grant booking_worker to authenticator with set true';
 else
  grant booking_worker to authenticator;
 end if;
 if current_setting('server_version_num')::integer>=160000 then
  if exists(
   select 1 from pg_catalog.pg_auth_members m
   join pg_catalog.pg_roles granted on granted.oid=m.roleid
   join pg_catalog.pg_roles member on member.oid=m.member
   join pg_catalog.pg_roles grantor on grantor.oid=m.grantor
   where (granted.rolname='booking_worker'or member.rolname='booking_worker')
    and not(granted.rolname='booking_worker'and(
     (member.rolname='authenticator'and grantor.rolname=current_user
      and m.admin_option=false and m.inherit_option=true and m.set_option=true)
     or(member.rolname=current_user and grantor.rolname<>current_user
      and grantor.rolsuper=true
      and m.admin_option=true and m.inherit_option=false and m.set_option=false)
    ))
  )or(
   select pg_catalog.count(*) from pg_catalog.pg_auth_members m
   join pg_catalog.pg_roles granted on granted.oid=m.roleid
   join pg_catalog.pg_roles member on member.oid=m.member
   where granted.rolname='booking_worker'or member.rolname='booking_worker'
  )<>2 then
   raise exception 'booking_worker final role membership is unsafe' using errcode='42501';
  end if;
 else
  if exists(
   select 1 from pg_catalog.pg_auth_members m
   join pg_catalog.pg_roles granted on granted.oid=m.roleid
   join pg_catalog.pg_roles member on member.oid=m.member
   where (granted.rolname='booking_worker'or member.rolname='booking_worker')
    and not(granted.rolname='booking_worker'and member.rolname='authenticator'and m.admin_option=false)
  )or(
   select pg_catalog.count(*) from pg_catalog.pg_auth_members m
   join pg_catalog.pg_roles granted on granted.oid=m.roleid
   join pg_catalog.pg_roles member on member.oid=m.member
   where granted.rolname='booking_worker'or member.rolname='booking_worker'
  )<>1 then
   raise exception 'booking_worker final role membership is unsafe' using errcode='42501';
  end if;
 end if;
end $role$;

-- PostgreSQL privileges are additive: a direct revoke from booking_worker cannot
-- override EXECUTE inherited from PUBLIC. Only mutate functions this migration owner
-- owns; preserve every existing role's effective access except the isolated worker,
-- preserve every non-PUBLIC ACL entry, and verify each PUBLIC revoke took effect.
do $public_acl$
declare
 existing record;
 preserved_acl text[];
 observed_acl text[];
 anon_execute boolean;
 authenticated_execute boolean;
 service_execute boolean;
begin
 for existing in
  select p.oid,p.oid::pg_catalog.regprocedure as procedure_identity
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')
  order by p.oid
 loop
  anon_execute:=pg_catalog.has_function_privilege('anon',existing.oid,'EXECUTE');
  authenticated_execute:=pg_catalog.has_function_privilege('authenticated',existing.oid,'EXECUTE');
  service_execute:=pg_catalog.has_function_privilege('service_role',existing.oid,'EXECUTE');
  select coalesce(pg_catalog.array_agg(
   pg_catalog.format('%s:%s:%s:%s',acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable)
   order by acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable
  ),array[]::text[])into preserved_acl
  from pg_catalog.aclexplode(coalesce(
   (select proacl from pg_catalog.pg_proc where oid=existing.oid),
   pg_catalog.acldefault('f',(select proowner from pg_catalog.pg_proc where oid=existing.oid))
  ))acl where acl.grantee<>0;
  execute pg_catalog.format('revoke execute on function %s from public',existing.procedure_identity);
  if pg_catalog.has_function_privilege('public',existing.oid,'EXECUTE')then
   raise exception 'PUBLIC function EXECUTE revocation failed for %',existing.procedure_identity using errcode='42501';
  end if;
  if anon_execute then execute pg_catalog.format('grant execute on function %s to anon',existing.procedure_identity);end if;
  if authenticated_execute then execute pg_catalog.format('grant execute on function %s to authenticated',existing.procedure_identity);end if;
  if service_execute then execute pg_catalog.format('grant execute on function %s to service_role',existing.procedure_identity);end if;
  if pg_catalog.has_function_privilege('anon',existing.oid,'EXECUTE')is distinct from anon_execute
   or pg_catalog.has_function_privilege('authenticated',existing.oid,'EXECUTE')is distinct from authenticated_execute
   or pg_catalog.has_function_privilege('service_role',existing.oid,'EXECUTE')is distinct from service_execute then
   raise exception 'application function authority preservation failed for %',existing.procedure_identity using errcode='42501';
  end if;
  select coalesce(pg_catalog.array_agg(
   pg_catalog.format('%s:%s:%s:%s',acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable)
   order by acl.grantor,acl.grantee,acl.privilege_type,acl.is_grantable
  ),array[]::text[])into observed_acl
  from pg_catalog.aclexplode(coalesce(
   (select proacl from pg_catalog.pg_proc where oid=existing.oid),
   pg_catalog.acldefault('f',(select proowner from pg_catalog.pg_proc where oid=existing.oid))
  ))acl where acl.grantee<>0;
  if not preserved_acl<@observed_acl then
   raise exception 'non-PUBLIC function ACL preservation failed for %',existing.procedure_identity using errcode='42501';
  end if;
 end loop;
 if exists(
  select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and pg_catalog.has_function_privilege('public',p.oid,'EXECUTE')
 )then
  raise exception 'PUBLIC function EXECUTE closure is incomplete' using errcode='42501';
 end if;
end $public_acl$;
-- Global defaults are additive with per-schema defaults. This unscoped command
-- closes PUBLIC EXECUTE for every downstream function created by the same owner.
alter default privileges revoke execute on functions from public;
revoke create on schema public from public;
do $schema_acl$
begin
 if pg_catalog.has_schema_privilege('public','public','CREATE')then
  raise exception 'PUBLIC schema CREATE closure is incomplete' using errcode='42501';
 end if;
end $schema_acl$;

grant usage on schema public to booking_worker;
revoke create on schema public from booking_worker;
revoke all on all tables in schema public from booking_worker;
revoke all on all sequences in schema public from booking_worker;
revoke all on all functions in schema public from booking_worker;
-- Exact background-only RPC boundary. Request admission, confirmation, cancellation,
-- upload-finalization, provider ingress, and generic provider claims are deliberately excluded.
grant execute on function public.claim_due_booking_payment_events(text,uuid,integer) to booking_worker;
grant execute on function public.fail_booking_payment_event(uuid,uuid,bigint,text) to booking_worker;
grant execute on function public.apply_booking_provider_evidence(uuid,uuid,bigint) to booking_worker;
grant execute on function public.ensure_booking_refund_submission(uuid,bigint) to booking_worker;
grant execute on function public.settle_booking_refund_command(uuid,uuid,bigint,text,text,bigint,bigint) to booking_worker;
grant execute on function public.claim_due_booking_outbox(uuid,integer) to booking_worker;
grant execute on function public.get_booking_outbox_context(uuid,uuid,bigint) to booking_worker;
grant execute on function public.claim_booking_calendar_reconciliation(text,uuid,integer) to booking_worker;
grant execute on function public.bind_booking_calendar_intent(uuid,uuid,bigint,text) to booking_worker;
grant execute on function public.complete_booking_outbox(uuid,uuid,bigint,jsonb) to booking_worker;
grant execute on function public.fail_booking_outbox(uuid,uuid,bigint,boolean,text) to booking_worker;
grant execute on function public.expire_due_booking_holds(integer) to booking_worker;
grant execute on function public.claim_ambiguous_booking_checkouts(text,uuid,integer) to booking_worker;
grant execute on function public.settle_booking_checkout(uuid,uuid,bigint,text,timestamptz,boolean,boolean,text) to booking_worker;
grant execute on function public.claim_due_booking_sessions(text,uuid,integer) to booking_worker;
grant execute on function public.settle_due_booking_session(uuid,uuid,bigint,boolean,boolean,text,text,bigint,text) to booking_worker;
grant execute on function public.list_due_booking_attachment_scans(integer) to booking_worker;
grant execute on function public.claim_booking_attachment_scan(uuid,uuid,integer) to booking_worker;
grant execute on function public.complete_booking_attachment_scan(uuid,uuid,bigint,text,text) to booking_worker;
grant execute on function public.settle_booking_calendar_claim(uuid,uuid,bigint,text,text) to booking_worker;
grant execute on function public.enqueue_booking_notification(uuid,text) to booking_worker;
grant execute on function public.claim_due_booking_notifications(uuid,integer) to booking_worker;
grant execute on function public.get_booking_notification_context(uuid) to booking_worker;
grant execute on function public.complete_booking_notification(uuid,uuid,bigint,text) to booking_worker;
grant execute on function public.fail_booking_notification(uuid,uuid,bigint,boolean,text) to booking_worker;
