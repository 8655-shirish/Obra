-- Admin authentication lifecycle closure after the admin-auth foundation migration.
alter table public.admin_principals
 add column if not exists auth_epoch bigint not null default 1 check(auth_epoch>0),
 add column if not exists recovery_code_hashes text[] not null default '{}'::text[],
 add column if not exists recovery_codes_issued_at timestamptz;
alter table public.admin_sessions add column if not exists auth_epoch bigint not null default 1 check(auth_epoch>0);

create or replace function public.bump_admin_auth_epoch_v2(p_user_id uuid,p_reason text) returns bigint
language plpgsql security definer set search_path='' as $auth$
declare next_epoch bigint;
begin
 if p_user_id is null or nullif(pg_catalog.btrim(p_reason),'')is null then raise exception 'invalid admin auth epoch request' using errcode='22023';end if;
 update public.admin_principals set auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp() where user_id=p_user_id returning auth_epoch into next_epoch;
 if next_epoch is null then raise exception 'admin principal not found' using errcode='P0002';end if;
 update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp()) where user_id=p_user_id and revoked_at is null;
 return next_epoch;
end
$auth$;

create or replace function public.handle_admin_principal_authority_change_v2() returns trigger
language plpgsql security definer set search_path='' as $auth$
begin
 if old.enabled is distinct from new.enabled or old.mfa_required is distinct from new.mfa_required or old.role is distinct from new.role then
  perform public.bump_admin_auth_epoch_v2(new.user_id,'principal_authority_changed');
 end if;
 return new;
end
$auth$;
drop trigger if exists admin_principal_authority_epoch_v2 on public.admin_principals;
create trigger admin_principal_authority_epoch_v2 after update of enabled,mfa_required,role on public.admin_principals
for each row execute function public.handle_admin_principal_authority_change_v2();

create or replace function public.handle_admin_password_change_v2() returns trigger
language plpgsql security definer set search_path='' as $auth$
begin
 if old.encrypted_password is distinct from new.encrypted_password and exists(select 1 from public.admin_principals where user_id=new.id)then
  perform public.bump_admin_auth_epoch_v2(new.id,'password_changed');
 end if;
 return new;
end
$auth$;
drop trigger if exists admin_password_epoch_v2 on auth.users;
create trigger admin_password_epoch_v2 after update of encrypted_password on auth.users
for each row execute function public.handle_admin_password_change_v2();

create or replace function public.handle_admin_mfa_factor_change_v2() returns trigger
language plpgsql security definer set search_path='' as $auth$
declare principal_id uuid;
begin
 principal_id:=case when tg_op='DELETE'then old.user_id else new.user_id end;
 if exists(select 1 from public.admin_principals where user_id=principal_id)then perform public.bump_admin_auth_epoch_v2(principal_id,'mfa_factor_changed');end if;
 if tg_op='DELETE'then return old;end if;
 return new;
end
$auth$;
drop trigger if exists admin_mfa_factor_epoch_v2 on auth.mfa_factors;
create trigger admin_mfa_factor_epoch_v2 after insert or delete or update of status on auth.mfa_factors
for each row execute function public.handle_admin_mfa_factor_change_v2();

create or replace function public.bootstrap_admin_principal_v2(p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $auth$
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('obra_admin_bootstrap',0));
 if exists(select 1 from public.admin_principals)then raise exception 'admin bootstrap is closed' using errcode='42501';end if;
 if not exists(select 1 from auth.users where id=p_user_id and confirmed_at is not null)then raise exception 'confirmed auth user required' using errcode='42501';end if;
 insert into public.admin_principals(user_id,role,enabled,mfa_required)values(p_user_id,'admin',true,true);
 return true;
end
$auth$;

create or replace function public.provision_admin_principal_v2(p_actor_token_hash text,p_target_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $auth$
begin
 if p_actor_token_hash!~'^[a-f0-9]{64}$'or not exists(
  select 1 from public.admin_sessions s join public.admin_principals p on p.user_id=s.user_id and p.auth_epoch=s.auth_epoch
  where s.token_hash=p_actor_token_hash and p.enabled and p.mfa_required and p.role='admin' and s.aal='aal2' and s.role='admin'
   and s.revoked_at is null and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp()
 )then raise exception 'admin actor session required' using errcode='42501';end if;
 if not exists(select 1 from auth.users where id=p_target_user_id and confirmed_at is not null)then raise exception 'confirmed auth user required' using errcode='42501';end if;
 insert into public.admin_principals(user_id,role,enabled,mfa_required)values(p_target_user_id,'admin',true,true)
 on conflict(user_id)do update set role='admin',enabled=true,mfa_required=true,updated_at=pg_catalog.clock_timestamp();
 return true;
end
$auth$;

create or replace function public.replace_admin_recovery_codes_v2(p_user_id uuid,p_code_hashes text[]) returns boolean
language plpgsql security definer set search_path='' as $auth$
begin
 if coalesce(pg_catalog.array_length(p_code_hashes,1),0)<>8
  or exists(select 1 from pg_catalog.unnest(p_code_hashes)value where value!~'^[a-f0-9]{64}$')
  or(select pg_catalog.count(distinct value)from pg_catalog.unnest(p_code_hashes)value)<>8
 then raise exception 'eight distinct recovery code hashes required' using errcode='22023';end if;
 update public.admin_principals set recovery_code_hashes=p_code_hashes,recovery_codes_issued_at=pg_catalog.clock_timestamp(),auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp()
 where user_id=p_user_id and enabled and mfa_required;
 if not found then raise exception 'admin principal not found' using errcode='P0002';end if;
 update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where user_id=p_user_id and revoked_at is null;
 return true;
end
$auth$;

create or replace function public.consume_admin_recovery_code_v2(p_user_id uuid,p_code_hash text) returns boolean
language plpgsql security definer set search_path='' as $auth$
begin
 if p_code_hash!~'^[a-f0-9]{64}$'then raise exception 'invalid recovery code hash' using errcode='22023';end if;
 update public.admin_principals set recovery_code_hashes=pg_catalog.array_remove(recovery_code_hashes,p_code_hash),auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp()
 where user_id=p_user_id and enabled and mfa_required and p_code_hash=any(recovery_code_hashes);
 if not found then return false;end if;
 update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where user_id=p_user_id and revoked_at is null;
 return true;
end
$auth$;

create or replace function public.create_admin_session_v2(p_token_hash text,p_user_id uuid) returns uuid
language plpgsql security definer set search_path='' as $auth$
declare session_id uuid;
begin
 if p_token_hash!~'^[a-f0-9]{64}$'then raise exception 'invalid admin session token' using errcode='22023';end if;
 insert into public.admin_sessions(token_hash,user_id,role,aal,auth_epoch,idle_expires_at,absolute_expires_at)
 select p_token_hash,p.user_id,p.role,'aal2',p.auth_epoch,pg_catalog.clock_timestamp()+interval '30 minutes',pg_catalog.clock_timestamp()+interval '12 hours'
 from public.admin_principals p where p.user_id=p_user_id and p.enabled and p.mfa_required and p.role='admin' returning id into session_id;
 if session_id is null then raise exception 'admin session forbidden' using errcode='42501';end if;
 return session_id;
end
$auth$;

create or replace function public.validate_admin_session_v2(p_token_hash text,p_touch boolean default true)
returns table(session_id uuid,user_id uuid,role text,impersonated_profile_id uuid)
language plpgsql security definer set search_path='' as $auth$
begin
 return query update public.admin_sessions s
 set last_seen_at=case when p_touch then pg_catalog.clock_timestamp()else s.last_seen_at end,
  idle_expires_at=case when p_touch then least(s.absolute_expires_at,pg_catalog.clock_timestamp()+interval '30 minutes')else s.idle_expires_at end
 from public.admin_principals p where s.token_hash=p_token_hash and s.user_id=p.user_id and s.auth_epoch=p.auth_epoch
  and p.enabled and p.mfa_required and p.role='admin' and s.aal='aal2' and s.role='admin' and s.revoked_at is null
  and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp()
 returning s.id,s.user_id,s.role,s.impersonated_profile_id;
end
$auth$;

create or replace function public.set_admin_session_impersonation_v2(p_token_hash text,p_profile_id uuid) returns boolean
language plpgsql security definer set search_path='' as $auth$
begin
 if p_profile_id is not null and not exists(select 1 from public.profiles where id=p_profile_id)then raise exception 'profile not found' using errcode='P0001';end if;
 update public.admin_sessions s set impersonated_profile_id=p_profile_id,last_seen_at=pg_catalog.clock_timestamp(),
  idle_expires_at=least(s.absolute_expires_at,pg_catalog.clock_timestamp()+interval '30 minutes')
 from public.admin_principals p where s.token_hash=p_token_hash and s.user_id=p.user_id and s.auth_epoch=p.auth_epoch
  and p.enabled and p.mfa_required and p.role='admin' and s.aal='aal2' and s.role='admin' and s.revoked_at is null
  and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp();
 return found;
end
$auth$;

create or replace function public.global_admin_signout_v2(p_token_hash text) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare principal_id uuid;
begin
 select s.user_id into principal_id from public.admin_sessions s join public.admin_principals p on p.user_id=s.user_id and p.auth_epoch=s.auth_epoch
 where s.token_hash=p_token_hash and p.enabled and p.mfa_required and p.role='admin' and s.aal='aal2' and s.role='admin'
  and s.revoked_at is null and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp();
 if principal_id is null then raise exception 'admin session required' using errcode='42501';end if;
 perform public.bump_admin_auth_epoch_v2(principal_id,'global_signout');
 return true;
end
$auth$;

revoke all on function public.bump_admin_auth_epoch_v2(uuid,text),public.bootstrap_admin_principal_v2(uuid),
 public.provision_admin_principal_v2(text,uuid),public.replace_admin_recovery_codes_v2(uuid,text[]),public.consume_admin_recovery_code_v2(uuid,text),
 public.create_admin_session_v2(text,uuid),public.validate_admin_session_v2(text,boolean),public.set_admin_session_impersonation_v2(text,uuid),
 public.global_admin_signout_v2(text) from public,anon,authenticated;
grant execute on function public.bump_admin_auth_epoch_v2(uuid,text),public.bootstrap_admin_principal_v2(uuid),
 public.provision_admin_principal_v2(text,uuid),public.replace_admin_recovery_codes_v2(uuid,text[]),public.consume_admin_recovery_code_v2(uuid,text),
 public.create_admin_session_v2(text,uuid),public.validate_admin_session_v2(text,boolean),public.set_admin_session_impersonation_v2(text,uuid),
 public.global_admin_signout_v2(text) to service_role;

-- Session minting is authorized by the caller's verified GoTrue AAL2 JWT, never a service-supplied user id.
create or replace function public.create_admin_session_v3(p_token_hash text)returns uuid language plpgsql security definer set search_path='' as $auth$
declare session_id uuid;principal_id uuid:=auth.uid();
begin
 if principal_id is null or coalesce(auth.jwt()->>'aal','')<>'aal2'then raise exception 'verified AAL2 required' using errcode='42501';end if;
 if p_token_hash!~'^[a-f0-9]{64}$'then raise exception 'invalid admin session token' using errcode='22023';end if;
 insert into public.admin_sessions(token_hash,user_id,role,aal,auth_epoch,idle_expires_at,absolute_expires_at)select p_token_hash,p.user_id,p.role,'aal2',p.auth_epoch,pg_catalog.clock_timestamp()+interval '30 minutes',pg_catalog.clock_timestamp()+interval '12 hours'from public.admin_principals p where p.user_id=principal_id and p.enabled and p.mfa_required and p.role='admin'returning id into session_id;
 if session_id is null then raise exception 'admin session forbidden' using errcode='42501';end if;return session_id;
end $auth$;
revoke all on function public.create_admin_session_v3(text) from public,anon,service_role;
grant execute on function public.create_admin_session_v3(text) to authenticated;
revoke execute on function public.create_admin_session(text,uuid),public.create_admin_session_v2(text,uuid) from service_role;
