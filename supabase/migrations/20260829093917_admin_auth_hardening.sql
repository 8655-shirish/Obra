-- Admin authority hardening: atomic login throttle, MFA-capable principals, opaque revocable sessions.
create table if not exists public.admin_principals(
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null default 'admin' check(role='admin'),enabled boolean not null default true,
 mfa_required boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.admin_login_throttle_buckets(
 bucket_kind text not null check(bucket_kind in('principal','client','pair')),bucket_hash text not null check(bucket_hash~'^[a-f0-9]{64}$'),
 window_started_at timestamptz not null,attempt_count integer not null check(attempt_count>=0),last_attempt_at timestamptz not null,primary key(bucket_kind,bucket_hash)
);
create table if not exists public.admin_sessions(
 id uuid primary key default gen_random_uuid(),token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),user_id uuid not null references public.admin_principals(user_id) on delete cascade,
 role text not null check(role='admin'),aal text not null check(aal='aal2'),created_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),
 idle_expires_at timestamptz not null,absolute_expires_at timestamptz not null,revoked_at timestamptz,impersonated_profile_id uuid references public.profiles(id)
);
do $tag$ begin
 execute 'alter table public.admin_principals enable row level security';
 execute 'alter table public.admin_login_throttle_buckets enable row level security';
 execute 'alter table public.admin_sessions enable row level security';
end $tag$;
revoke all on public.admin_principals,public.admin_login_throttle_buckets,public.admin_sessions from public,anon,authenticated;

create or replace function public.revoke_admin_sessions_on_authority_loss()returns trigger language plpgsql security definer set search_path='' as $tag$
begin
 if(old.enabled and not new.enabled)or(old.mfa_required and not new.mfa_required)then update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where user_id=new.user_id;end if;return new;
end $tag$;
drop trigger if exists admin_principal_authority_loss_revoke on public.admin_principals;
create trigger admin_principal_authority_loss_revoke after update of enabled,mfa_required on public.admin_principals for each row execute function public.revoke_admin_sessions_on_authority_loss();

create or replace function public.check_admin_login_rate_limit(p_principal_hash text,p_client_hash text,p_pair_hash text)
returns boolean language plpgsql security definer set search_path='' as $tag$
declare item record;current_count integer;
begin
 if p_principal_hash!~'^[a-f0-9]{64}$'or p_client_hash!~'^[a-f0-9]{64}$'or p_pair_hash!~'^[a-f0-9]{64}$'then raise exception 'invalid admin throttle bucket' using errcode='22023';end if;
 for item in select * from (values('client'::text,p_client_hash,30),('principal',p_principal_hash,10),('pair',p_pair_hash,5))v(kind,bucket_hash,max_count) loop
  if item.bucket_hash!~'^[a-f0-9]{64}$' then raise exception 'invalid admin throttle bucket' using errcode='22023';end if;
  insert into public.admin_login_throttle_buckets(bucket_kind,bucket_hash,window_started_at,attempt_count,last_attempt_at) values(item.kind,item.bucket_hash,pg_catalog.clock_timestamp(),1,pg_catalog.clock_timestamp())
  on conflict(bucket_kind,bucket_hash)do update set attempt_count=case when public.admin_login_throttle_buckets.window_started_at<=pg_catalog.clock_timestamp()-interval '15 minutes'then 1 else public.admin_login_throttle_buckets.attempt_count+1 end,window_started_at=case when public.admin_login_throttle_buckets.window_started_at<=pg_catalog.clock_timestamp()-interval '15 minutes'then pg_catalog.clock_timestamp()else public.admin_login_throttle_buckets.window_started_at end,last_attempt_at=pg_catalog.clock_timestamp() returning attempt_count into current_count;
  if current_count>item.max_count then return false;end if;
 end loop;return true;
end $tag$;
create or replace function public.create_admin_session(p_token_hash text,p_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $tag$
declare session_id uuid;
begin
 if p_token_hash!~'^[a-f0-9]{64}$' or not exists(select 1 from public.admin_principals where user_id=p_user_id and enabled and mfa_required) then raise exception 'admin session forbidden' using errcode='42501';end if;
 insert into public.admin_sessions(token_hash,user_id,role,aal,idle_expires_at,absolute_expires_at) values(p_token_hash,p_user_id,'admin','aal2',pg_catalog.clock_timestamp()+interval '30 minutes',pg_catalog.clock_timestamp()+interval '12 hours') returning id into session_id;return session_id;
end $tag$;
create or replace function public.validate_admin_session(p_token_hash text,p_touch boolean default true)
returns table(session_id uuid,user_id uuid,role text,impersonated_profile_id uuid) language plpgsql security definer set search_path='' as $tag$
begin
 return query update public.admin_sessions s set last_seen_at=case when p_touch then pg_catalog.clock_timestamp()else s.last_seen_at end,idle_expires_at=case when p_touch then least(s.absolute_expires_at,pg_catalog.clock_timestamp()+interval '30 minutes')else s.idle_expires_at end from public.admin_principals p where s.token_hash=p_token_hash and s.user_id=p.user_id and p.enabled and p.mfa_required and s.aal='aal2' and s.revoked_at is null and s.idle_expires_at>pg_catalog.clock_timestamp() and s.absolute_expires_at>pg_catalog.clock_timestamp() returning s.id,s.user_id,s.role,s.impersonated_profile_id;
end $tag$;
create or replace function public.set_admin_session_impersonation(p_token_hash text,p_profile_id uuid)
returns boolean language plpgsql security definer set search_path='' as $tag$
begin
 if p_profile_id is not null and not exists(select 1 from public.profiles where id=p_profile_id) then raise exception 'profile not found' using errcode='P0001';end if;
 update public.admin_sessions set impersonated_profile_id=p_profile_id,last_seen_at=pg_catalog.clock_timestamp() where token_hash=p_token_hash and revoked_at is null and idle_expires_at>pg_catalog.clock_timestamp() and absolute_expires_at>pg_catalog.clock_timestamp();return found;
end $tag$;
create or replace function public.revoke_admin_session(p_token_hash text)returns boolean language plpgsql security definer set search_path='' as $tag$
begin
 update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp()) where token_hash=p_token_hash;return found;
end $tag$;
revoke all on function public.check_admin_login_rate_limit(text,text,text),public.create_admin_session(text,uuid),public.validate_admin_session(text,boolean),public.set_admin_session_impersonation(text,uuid),public.revoke_admin_session(text) from public,anon,authenticated;
grant execute on function public.check_admin_login_rate_limit(text,text,text),public.create_admin_session(text,uuid),public.validate_admin_session(text,boolean),public.set_admin_session_impersonation(text,uuid),public.revoke_admin_session(text) to service_role;
