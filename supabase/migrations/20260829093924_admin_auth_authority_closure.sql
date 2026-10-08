-- Forward-only closure of admin authentication authority.
-- GoTrue proves a fresh, live, single-use AAL2 session; only opaque Obra sessions persist.

create table public.admin_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  consumed_at timestamptz,
  consumed_by uuid,
  constraint admin_bootstrap_consumption_complete check ((consumed_at is null) = (consumed_by is null))
);

insert into public.admin_bootstrap_state(singleton,consumed_at,consumed_by)
select true,
       case when principal.user_id is null then null else pg_catalog.clock_timestamp() end,
       principal.user_id
from (select user_id from public.admin_principals order by created_at,user_id limit 1) principal
right join (values(true)) singleton(value) on true;

create table public.admin_auth_handoffs (
  token_hash text primary key check (token_hash~'^[a-f0-9]{64}$'),
  opaque_session_token_hash text not null unique check (opaque_session_token_hash~'^[a-f0-9]{64}$'),
  user_id uuid not null references public.admin_principals(user_id) on delete cascade,
  auth_epoch bigint not null check (auth_epoch>0),
  gotrue_session_id uuid not null unique,
  factor_id uuid not null,
  recovery_attempt_token_hash text,
  recovery_code_hashes text[],
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table public.admin_recovery_attempts (
  token_hash text primary key check (token_hash~'^[a-f0-9]{64}$'),
  user_id uuid not null references public.admin_principals(user_id) on delete cascade,
  recovery_code_hash text not null check (recovery_code_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  provider_reset_at timestamptz,
  completed_at timestamptz,
  unique(user_id,recovery_code_hash)
);

alter table public.admin_auth_handoffs add constraint admin_auth_handoff_recovery_attempt_fk
foreign key(recovery_attempt_token_hash)references public.admin_recovery_attempts(token_hash);

create table public.admin_auth_audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  event_type text not null,
  actor_user_id uuid,
  subject_user_id uuid,
  opaque_session_id uuid,
  gotrue_session_id uuid,
  evidence jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(evidence)='object')
);

alter table public.admin_bootstrap_state enable row level security;
alter table public.admin_auth_handoffs enable row level security;
alter table public.admin_recovery_attempts enable row level security;
alter table public.admin_auth_audit_events enable row level security;
revoke all on public.admin_bootstrap_state,public.admin_auth_handoffs,public.admin_recovery_attempts,public.admin_auth_audit_events from public,anon,authenticated,service_role;
revoke all on sequence public.admin_auth_audit_events_id_seq from public,anon,authenticated,service_role;

create or replace function public.reject_admin_auth_audit_mutation_v4() returns trigger
language plpgsql security definer set search_path='' as $auth$
begin
  raise exception 'admin auth audit is append-only' using errcode='42501';
end
$auth$;
create trigger admin_auth_audit_no_update_v4 before update or delete on public.admin_auth_audit_events
for each row execute function public.reject_admin_auth_audit_mutation_v4();
create trigger admin_auth_audit_no_truncate_v4 before truncate on public.admin_auth_audit_events
for each statement execute function public.reject_admin_auth_audit_mutation_v4();

create or replace function public.admin_auth_lock_v4(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $auth$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('obra_admin_authority:'||p_user_id::text,0));
end
$auth$;

create or replace function public.admin_delete_gotrue_sessions_v4(p_user_id uuid) returns integer
language plpgsql security definer set search_path='' as $auth$
declare removed integer;
begin
  delete from auth.refresh_tokens where session_id in (select id from auth.sessions where user_id=p_user_id);
  delete from auth.sessions where user_id=p_user_id;
  get diagnostics removed=row_count;
  return removed;
end
$auth$;

-- Authority-changing GoTrue records must revoke both opaque and provider sessions.
create or replace function public.bump_admin_auth_epoch_v2(p_user_id uuid,p_reason text) returns bigint
language plpgsql security definer set search_path='' as $auth$
declare next_epoch bigint;
begin
 if p_user_id is null or nullif(pg_catalog.btrim(p_reason),'')is null then raise exception 'invalid admin auth epoch request' using errcode='22023';end if;
 perform public.admin_auth_lock_v4(p_user_id);
 update public.admin_principals set auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp() where user_id=p_user_id returning auth_epoch into next_epoch;
 if next_epoch is null then raise exception 'admin principal not found' using errcode='P0002';end if;
 update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp()) where user_id=p_user_id and revoked_at is null;
 -- GoTrue must retain the just-created/current session while enrolling or verifying MFA.
 -- GoTrue itself invalidates other sessions on factor verification/deletion; all other authority changes delete provider sessions here.
 if p_reason<>'mfa_factor_changed' then perform public.admin_delete_gotrue_sessions_v4(p_user_id);end if;
 insert into public.admin_auth_audit_events(event_type,subject_user_id,evidence) values('authority_epoch_changed',p_user_id,pg_catalog.jsonb_build_object('reason',p_reason,'auth_epoch',next_epoch));
 return next_epoch;
end
$auth$;

create or replace function public.bootstrap_admin_principal_v4(p_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare state public.admin_bootstrap_state%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('obra_admin_authority',0));
  select * into strict state from public.admin_bootstrap_state where singleton for update;
  if state.consumed_at is not null then raise exception 'admin bootstrap is closed' using errcode='42501';end if;
  if not exists(select 1 from auth.users where id=p_user_id and deleted_at is null and confirmed_at is not null and (banned_until is null or banned_until<=pg_catalog.clock_timestamp()))then
    raise exception 'confirmed active auth user required' using errcode='42501';
  end if;
  insert into public.admin_principals(user_id,role,enabled,mfa_required)values(p_user_id,'admin',true,true);
  update public.admin_bootstrap_state set consumed_at=pg_catalog.clock_timestamp(),consumed_by=p_user_id where singleton;
  insert into public.admin_auth_audit_events(event_type,subject_user_id,evidence)
  values('bootstrap_consumed',p_user_id,pg_catalog.jsonb_build_object('permanent',true));
  return true;
end
$auth$;

create or replace function public.provision_admin_principal_v4(p_actor_token_hash text,p_target_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare actor public.admin_sessions%rowtype;target public.admin_principals%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('obra_admin_authority',0));
  if p_actor_token_hash!~'^[a-f0-9]{64}$'then raise exception 'admin actor session required' using errcode='42501';end if;
  select s.* into actor from public.admin_sessions s join public.admin_principals p on p.user_id=s.user_id and p.auth_epoch=s.auth_epoch
  join auth.users u on u.id=p.user_id
  where s.token_hash=p_actor_token_hash and p.enabled and p.mfa_required and p.role='admin' and s.aal='aal2' and s.role='admin'
    and s.revoked_at is null and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp()
    and u.deleted_at is null and u.confirmed_at is not null and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()) for update of s,p;
  if actor.id is null then raise exception 'admin actor session required' using errcode='42501';end if;
  perform public.admin_auth_lock_v4(p_target_user_id);
  if not exists(select 1 from auth.users where id=p_target_user_id and deleted_at is null and confirmed_at is not null and (banned_until is null or banned_until<=pg_catalog.clock_timestamp()))then
    raise exception 'confirmed active auth user required' using errcode='42501';
  end if;
  select * into target from public.admin_principals where user_id=p_target_user_id for update;
  if target.user_id is null then
    insert into public.admin_principals(user_id,role,enabled,mfa_required)values(p_target_user_id,'admin',true,true);
  elsif not target.enabled then
    raise exception 'revoked admin cannot be reprovisioned' using errcode='42501';
  end if;
  insert into public.admin_auth_audit_events(event_type,actor_user_id,subject_user_id,opaque_session_id,evidence)
  values('principal_provisioned',actor.user_id,p_target_user_id,actor.id,pg_catalog.jsonb_build_object('idempotent',target.user_id is not null));
  return true;
end
$auth$;

create or replace function public.revoke_admin_principal_v4(p_actor_token_hash text,p_target_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare actor public.admin_sessions%rowtype;target public.admin_principals%rowtype;enabled_count bigint;provider_sessions integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('obra_admin_authority',0));
  if p_actor_token_hash!~'^[a-f0-9]{64}$'then raise exception 'admin actor session required' using errcode='42501';end if;
  select s.* into actor from public.admin_sessions s join public.admin_principals p on p.user_id=s.user_id and p.auth_epoch=s.auth_epoch
  join auth.users u on u.id=p.user_id
  where s.token_hash=p_actor_token_hash and p.enabled and p.mfa_required and p.role='admin' and s.aal='aal2' and s.role='admin'
    and s.revoked_at is null and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp()
    and u.deleted_at is null and u.confirmed_at is not null and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()) for update of s,p;
  if actor.id is null then raise exception 'admin actor session required' using errcode='42501';end if;
  perform public.admin_auth_lock_v4(p_target_user_id);
  select * into target from public.admin_principals where user_id=p_target_user_id for update;
  if target.user_id is null then raise exception 'admin principal not found' using errcode='P0002';end if;
  if not target.enabled then return true;end if;
  select pg_catalog.count(*) into enabled_count from public.admin_principals where enabled;
  if enabled_count<=1 then raise exception 'cannot revoke final enabled admin' using errcode='42501';end if;
  update public.admin_principals set enabled=false,auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp() where user_id=p_target_user_id;
  update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where user_id=p_target_user_id and revoked_at is null;
  provider_sessions:=public.admin_delete_gotrue_sessions_v4(p_target_user_id);
  insert into public.admin_auth_audit_events(event_type,actor_user_id,subject_user_id,opaque_session_id,evidence)
  values('principal_revoked',actor.user_id,p_target_user_id,actor.id,pg_catalog.jsonb_build_object('gotrue_sessions_deleted',provider_sessions));
  return true;
end
$auth$;

create or replace function public.begin_admin_recovery_v4(p_user_id uuid,p_code_hash text,p_attempt_token_hash text) returns text
language plpgsql security definer set search_path='' as $auth$
declare principal public.admin_principals%rowtype;attempt public.admin_recovery_attempts%rowtype;provider_sessions integer;
begin
  if p_code_hash!~'^[a-f0-9]{64}$'or p_attempt_token_hash!~'^[a-f0-9]{64}$'then raise exception 'invalid recovery request' using errcode='22023';end if;
  perform public.admin_auth_lock_v4(p_user_id);
  select * into principal from public.admin_principals where user_id=p_user_id for update;
  if principal.user_id is null or not principal.enabled or not principal.mfa_required or not exists(
    select 1 from auth.users u where u.id=p_user_id and u.deleted_at is null and u.confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
  )then raise exception 'admin recovery unavailable' using errcode='42501';end if;
  select * into attempt from public.admin_recovery_attempts where user_id=p_user_id and recovery_code_hash=p_code_hash for update;
  provider_sessions:=public.admin_delete_gotrue_sessions_v4(p_user_id);
  if attempt.completed_at is not null then raise exception 'admin recovery unavailable' using errcode='42501';end if;
  if attempt.provider_reset_at is not null then
    if attempt.expires_at<=pg_catalog.clock_timestamp()then raise exception 'admin recovery expired' using errcode='42501';end if;
    update public.admin_recovery_attempts set token_hash=p_attempt_token_hash
    where user_id=p_user_id and recovery_code_hash=p_code_hash;
    return 'provider_reset_complete';
  end if;
  if attempt.user_id is not null and attempt.expires_at>pg_catalog.clock_timestamp() then
    update public.admin_recovery_attempts set token_hash=p_attempt_token_hash where user_id=p_user_id and recovery_code_hash=p_code_hash;
    return 'provider_reset_pending';
  end if;
  if not p_code_hash=any(principal.recovery_code_hashes)then raise exception 'admin recovery unavailable' using errcode='42501';end if;
  delete from public.admin_recovery_attempts where user_id=p_user_id and recovery_code_hash=p_code_hash;
  insert into public.admin_recovery_attempts(token_hash,user_id,recovery_code_hash,expires_at)
  values(p_attempt_token_hash,p_user_id,p_code_hash,pg_catalog.clock_timestamp()+interval '30 minutes');
  update public.admin_principals set auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp()where user_id=p_user_id;
  update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where user_id=p_user_id and revoked_at is null;
  insert into public.admin_auth_audit_events(event_type,subject_user_id,evidence)
  values('recovery_started',p_user_id,pg_catalog.jsonb_build_object('attempt_hash',p_attempt_token_hash,'gotrue_sessions_deleted',provider_sessions));
  return 'provider_reset_pending';
end
$auth$;

create or replace function public.complete_admin_recovery_provider_reset_v4(p_attempt_token_hash text) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare attempt public.admin_recovery_attempts%rowtype;
begin
  if p_attempt_token_hash!~'^[a-f0-9]{64}$'then raise exception 'invalid recovery attempt' using errcode='22023';end if;
  select * into attempt from public.admin_recovery_attempts where token_hash=p_attempt_token_hash for update;
  if attempt.user_id is null or attempt.expires_at<=pg_catalog.clock_timestamp()or not exists(
    select 1 from auth.users u where u.id=attempt.user_id and u.deleted_at is null and u.confirmed_at is not null
      and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
  )then raise exception 'admin recovery expired' using errcode='42501';end if;
  if exists(select 1 from auth.mfa_factors where user_id=attempt.user_id)then raise exception 'provider factors remain' using errcode='55000';end if;
  if attempt.provider_reset_at is null then
    update public.admin_principals set recovery_code_hashes=pg_catalog.array_remove(recovery_code_hashes,attempt.recovery_code_hash),
      auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp()
    where user_id=attempt.user_id and enabled and (attempt.recovery_code_hash=any(recovery_code_hashes));
    if not found then raise exception 'recovery code unavailable' using errcode='42501';end if;
    update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where user_id=attempt.user_id and revoked_at is null;
    update public.admin_recovery_attempts set provider_reset_at=pg_catalog.clock_timestamp()where token_hash=p_attempt_token_hash;
    insert into public.admin_auth_audit_events(event_type,subject_user_id,evidence)
    values('recovery_provider_reset',attempt.user_id,pg_catalog.jsonb_build_object('attempt_hash',p_attempt_token_hash));
  end if;
  return true;
end
$auth$;

create or replace function public.authorize_admin_session_handoff_v4(
  p_handoff_token_hash text,p_opaque_session_token_hash text,p_factor_id uuid,p_recovery_attempt_token_hash text default null,p_recovery_code_hashes text[] default null
) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare principal public.admin_principals%rowtype;gotrue_session uuid;verified_count integer;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2'then raise exception 'fresh verified AAL2 required' using errcode='42501';end if;
  if p_handoff_token_hash!~'^[a-f0-9]{64}$'or p_opaque_session_token_hash!~'^[a-f0-9]{64}$'then raise exception 'invalid handoff token' using errcode='22023';end if;
  if coalesce((auth.jwt()->>'iat')::bigint,0)<extract(epoch from pg_catalog.clock_timestamp()-interval '2 minutes')::bigint then
    raise exception 'fresh verified AAL2 required' using errcode='42501';
  end if;
  select pg_catalog.count(*) into verified_count from pg_catalog.jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb))item
  where pg_catalog.jsonb_typeof(item)='object' and item->>'method'in('totp','mfa/totp')
    and coalesce((item->>'timestamp')::bigint,0)>=extract(epoch from pg_catalog.clock_timestamp()-interval '2 minutes')::bigint;
  if verified_count<>1 then raise exception 'fresh TOTP proof required' using errcode='42501';end if;
  gotrue_session:=nullif(auth.jwt()->>'session_id','')::uuid;
  select p.* into principal from public.admin_principals p join auth.users u on u.id=p.user_id
  join auth.sessions gs on gs.id=gotrue_session and gs.user_id=p.user_id
  where p.user_id=auth.uid()and p.enabled and p.mfa_required and p.role='admin'
    and u.deleted_at is null and u.confirmed_at is not null and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()) for update of p;
  if principal.user_id is null then raise exception 'live GoTrue admin session required' using errcode='42501';end if;
  select pg_catalog.count(*) into verified_count from auth.mfa_factors where user_id=principal.user_id and status='verified';
  if verified_count<>1 or not exists(select 1 from auth.mfa_factors where id=p_factor_id and user_id=principal.user_id and status='verified'and factor_type='totp')then
    raise exception 'exactly one bound verified TOTP factor required' using errcode='42501';
  end if;
  if p_recovery_code_hashes is not null and (pg_catalog.array_length(p_recovery_code_hashes,1)<>8 or
    (select pg_catalog.count(distinct value)<>8 or not pg_catalog.bool_and(value~'^[a-f0-9]{64}$')from pg_catalog.unnest(p_recovery_code_hashes)value))then
    raise exception 'eight distinct recovery code hashes required' using errcode='22023';
  end if;
  if p_recovery_attempt_token_hash is not null and not exists(select 1 from public.admin_recovery_attempts a
    where a.token_hash=p_recovery_attempt_token_hash and a.user_id=principal.user_id and a.provider_reset_at is not null
      and a.completed_at is null and a.expires_at>pg_catalog.clock_timestamp())then
    raise exception 'live recovery continuation required' using errcode='42501';
  end if;
  if p_recovery_attempt_token_hash is null and p_recovery_code_hashes is not null
    and principal.recovery_codes_issued_at is not null then raise exception 'recovery continuation required' using errcode='42501';end if;
  if p_recovery_code_hashes is null and pg_catalog.array_length(principal.recovery_code_hashes,1)<>8 then
    raise exception 'recovery code issuance required' using errcode='42501';
  end if;
  insert into public.admin_auth_handoffs(token_hash,opaque_session_token_hash,user_id,auth_epoch,gotrue_session_id,factor_id,recovery_attempt_token_hash,recovery_code_hashes,expires_at)
  values(p_handoff_token_hash,p_opaque_session_token_hash,principal.user_id,principal.auth_epoch,gotrue_session,p_factor_id,p_recovery_attempt_token_hash,p_recovery_code_hashes,pg_catalog.clock_timestamp()+interval '2 minutes')
  on conflict(token_hash)do nothing;
  if not exists(select 1 from public.admin_auth_handoffs where token_hash=p_handoff_token_hash and opaque_session_token_hash=p_opaque_session_token_hash
    and user_id=principal.user_id and auth_epoch=principal.auth_epoch and gotrue_session_id=gotrue_session and factor_id=p_factor_id
    and recovery_attempt_token_hash is not distinct from p_recovery_attempt_token_hash and consumed_at is null)then
    raise exception 'admin session handoff conflict' using errcode='42501';
  end if;
  insert into public.admin_auth_audit_events(event_type,actor_user_id,subject_user_id,gotrue_session_id,evidence)
  values('session_handoff_authorized',principal.user_id,principal.user_id,gotrue_session,pg_catalog.jsonb_build_object('factor_id',p_factor_id,'handoff_hash',p_handoff_token_hash));
  return true;
end
$auth$;

create or replace function public.consume_admin_session_handoff_v4(p_handoff_token_hash text) returns uuid
language plpgsql security definer set search_path='' as $auth$
declare handoff public.admin_auth_handoffs%rowtype;principal public.admin_principals%rowtype;session_id uuid;provider_sessions integer;
begin
  if p_handoff_token_hash!~'^[a-f0-9]{64}$'then raise exception 'invalid handoff token' using errcode='22023';end if;
  select * into handoff from public.admin_auth_handoffs where token_hash=p_handoff_token_hash for update;
  if handoff.user_id is null or handoff.consumed_at is not null or handoff.expires_at<=pg_catalog.clock_timestamp()then
    raise exception 'admin session handoff unavailable' using errcode='42501';
  end if;
  perform public.admin_auth_lock_v4(handoff.user_id);
  select p.* into principal from public.admin_principals p join auth.users u on u.id=p.user_id
  where p.user_id=handoff.user_id and p.auth_epoch=handoff.auth_epoch and p.enabled and p.mfa_required and p.role='admin'
    and u.deleted_at is null and u.confirmed_at is not null and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp()) for update of p;
  if principal.user_id is null then raise exception 'admin authority changed' using errcode='42501';end if;
  if not exists(select 1 from auth.sessions where id=handoff.gotrue_session_id and user_id=handoff.user_id)then
    raise exception 'GoTrue session is no longer current' using errcode='42501';
  end if;
  if (select pg_catalog.count(*)from auth.mfa_factors where user_id=handoff.user_id and status='verified')<>1 or
    not exists(select 1 from auth.mfa_factors where id=handoff.factor_id and user_id=handoff.user_id and status='verified'and factor_type='totp')then
    raise exception 'bound TOTP factor changed' using errcode='42501';
  end if;
  provider_sessions:=public.admin_delete_gotrue_sessions_v4(handoff.user_id);
  if handoff.recovery_code_hashes is not null then
    update public.admin_principals set recovery_code_hashes=handoff.recovery_code_hashes,recovery_codes_issued_at=pg_catalog.clock_timestamp(),
      auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp()where user_id=handoff.user_id returning * into principal;
    update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where user_id=handoff.user_id and revoked_at is null;
  end if;
  insert into public.admin_sessions(token_hash,user_id,role,aal,auth_epoch,idle_expires_at,absolute_expires_at)
  values(handoff.opaque_session_token_hash,handoff.user_id,principal.role,'aal2',principal.auth_epoch,
    pg_catalog.clock_timestamp()+interval '30 minutes',pg_catalog.clock_timestamp()+interval '12 hours')returning id into session_id;
  update public.admin_auth_handoffs set consumed_at=pg_catalog.clock_timestamp()where token_hash=p_handoff_token_hash;
  if handoff.recovery_attempt_token_hash is not null then
    update public.admin_recovery_attempts set completed_at=pg_catalog.clock_timestamp()
    where token_hash=handoff.recovery_attempt_token_hash and user_id=handoff.user_id and provider_reset_at is not null
      and completed_at is null and expires_at>pg_catalog.clock_timestamp();
    if not found then raise exception 'recovery continuation expired' using errcode='42501';end if;
  end if;
  insert into public.admin_auth_audit_events(event_type,actor_user_id,subject_user_id,opaque_session_id,gotrue_session_id,evidence)
  values('opaque_session_created',handoff.user_id,handoff.user_id,session_id,handoff.gotrue_session_id,
    pg_catalog.jsonb_build_object('gotrue_sessions_deleted',provider_sessions,'recovery_codes_issued',handoff.recovery_code_hashes is not null));
  return session_id;
end
$auth$;

create or replace function public.validate_admin_session_v4(p_token_hash text,p_touch boolean default true)
returns table(session_id uuid,user_id uuid,role text,impersonated_profile_id uuid)
language plpgsql security definer set search_path='' as $auth$
declare principal_id uuid;
begin
  if p_token_hash!~'^[a-f0-9]{64}$'then return;end if;
  -- Resolve only the lock key first. Every authority predicate is evaluated after taking the
  -- same transaction lock used by revocation, ban, password, MFA, and epoch changes.
  select s.user_id into principal_id from public.admin_sessions s where s.token_hash=p_token_hash;
  if principal_id is null then return;end if;
  perform public.admin_auth_lock_v4(principal_id);
  return query update public.admin_sessions s
  set last_seen_at=case when p_touch then pg_catalog.clock_timestamp()else s.last_seen_at end,
      idle_expires_at=case when p_touch then least(s.absolute_expires_at,pg_catalog.clock_timestamp()+interval '30 minutes')else s.idle_expires_at end
  from public.admin_principals p,auth.users u
  where s.token_hash=p_token_hash and s.user_id=principal_id and s.user_id=p.user_id and u.id=p.user_id and s.auth_epoch=p.auth_epoch
    and p.enabled and p.mfa_required and p.role='admin'and s.aal='aal2'and s.role='admin'and s.revoked_at is null
    and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp()
    and u.deleted_at is null and u.confirmed_at is not null and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
  returning s.id,s.user_id,s.role,s.impersonated_profile_id;
end
$auth$;

create or replace function public.revoke_admin_session_v4(p_token_hash text) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare revoked public.admin_sessions%rowtype;
begin
  update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where token_hash=p_token_hash returning * into revoked;
  if revoked.id is not null then
    insert into public.admin_auth_audit_events(event_type,actor_user_id,subject_user_id,opaque_session_id,evidence)
    values('opaque_session_revoked',revoked.user_id,revoked.user_id,revoked.id,'{"scope":"local"}'::jsonb);
  end if;
  return true;
end
$auth$;

create or replace function public.global_admin_signout_v4(p_token_hash text) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare principal_id uuid;actor_session uuid;provider_sessions integer;
begin
  select s.user_id,s.id into principal_id,actor_session from public.admin_sessions s join public.admin_principals p on p.user_id=s.user_id and p.auth_epoch=s.auth_epoch
  join auth.users u on u.id=p.user_id
  where s.token_hash=p_token_hash and p.enabled and p.mfa_required and p.role='admin'and s.aal='aal2'and s.role='admin'
    and s.revoked_at is null and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp()
    and u.deleted_at is null and u.confirmed_at is not null and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())for update of s,p;
  if principal_id is null then raise exception 'admin session required' using errcode='42501';end if;
  perform public.admin_auth_lock_v4(principal_id);
  update public.admin_principals set auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp()where user_id=principal_id;
  update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where user_id=principal_id and revoked_at is null;
  provider_sessions:=public.admin_delete_gotrue_sessions_v4(principal_id);
  insert into public.admin_auth_audit_events(event_type,actor_user_id,subject_user_id,opaque_session_id,evidence)
  values('global_signout',principal_id,principal_id,actor_session,pg_catalog.jsonb_build_object('gotrue_sessions_deleted',provider_sessions));
  return true;
end
$auth$;

create or replace function public.invalidate_admin_provider_sessions_v4(p_user_id uuid,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $auth$
declare removed integer;
begin
  if nullif(pg_catalog.btrim(p_reason),'')is null or not exists(select 1 from public.admin_principals where user_id=p_user_id)then
    raise exception 'invalid provider invalidation' using errcode='22023';
  end if;
  perform public.admin_auth_lock_v4(p_user_id);
  removed:=public.admin_delete_gotrue_sessions_v4(p_user_id);
  insert into public.admin_auth_audit_events(event_type,subject_user_id,evidence)
  values('provider_sessions_invalidated',p_user_id,pg_catalog.jsonb_build_object('reason',p_reason,'gotrue_sessions_deleted',removed));
  return true;
end
$auth$;

create or replace function public.set_admin_session_impersonation_v4(p_token_hash text,p_profile_id uuid) returns boolean
language plpgsql security definer set search_path='' as $auth$
begin
  if p_profile_id is not null and not exists(select 1 from public.profiles where id=p_profile_id)then raise exception 'profile not found' using errcode='P0001';end if;
  update public.admin_sessions s set impersonated_profile_id=p_profile_id,last_seen_at=pg_catalog.clock_timestamp(),
    idle_expires_at=least(s.absolute_expires_at,pg_catalog.clock_timestamp()+interval '30 minutes')
  from public.admin_principals p,auth.users u
  where s.token_hash=p_token_hash and s.user_id=p.user_id and u.id=p.user_id and s.auth_epoch=p.auth_epoch
    and p.enabled and p.mfa_required and p.role='admin'and s.aal='aal2'and s.role='admin'and s.revoked_at is null
    and s.idle_expires_at>pg_catalog.clock_timestamp()and s.absolute_expires_at>pg_catalog.clock_timestamp()
    and u.deleted_at is null and u.confirmed_at is not null and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp());
  if found then
    insert into public.admin_auth_audit_events(event_type,actor_user_id,subject_user_id,evidence)
    select 'impersonation_changed',s.user_id,s.user_id,pg_catalog.jsonb_build_object('profile_id',p_profile_id)
    from public.admin_sessions s where s.token_hash=p_token_hash;
  end if;
  return found;
end
$auth$;

create or replace function public.handle_admin_ban_change_v4() returns trigger
language plpgsql security definer set search_path='' as $auth$
begin
  if (old.banned_until is distinct from new.banned_until or old.confirmed_at is distinct from new.confirmed_at
      or old.deleted_at is distinct from new.deleted_at)and exists(select 1 from public.admin_principals where user_id=new.id)then
    perform public.bump_admin_auth_epoch_v2(new.id,'provider_authority_changed');
    insert into public.admin_auth_audit_events(event_type,subject_user_id,evidence)
    values('provider_authority_changed',new.id,pg_catalog.jsonb_build_object(
      'banned_until',new.banned_until,'confirmed_at',new.confirmed_at,'deleted_at',new.deleted_at));
  end if;
  return new;
end
$auth$;
drop trigger if exists admin_ban_authority_v4 on auth.users;
create trigger admin_ban_authority_v4 after update of banned_until,confirmed_at,deleted_at on auth.users
for each row execute function public.handle_admin_ban_change_v4();

-- Revoke any provider principal that was already soft-deleted before this closure.
do $soft_delete_cutover$
declare item record;
begin
  for item in select p.user_id from public.admin_principals p join auth.users u on u.id=p.user_id where u.deleted_at is not null loop
    perform public.bump_admin_auth_epoch_v2(item.user_id,'provider_user_soft_deleted');
  end loop;
end
$soft_delete_cutover$;

-- Cut over atomically: every pre-closure opaque and GoTrue admin session is invalid.
update public.admin_principals set auth_epoch=auth_epoch+1,updated_at=pg_catalog.clock_timestamp()where user_id is not null;
update public.admin_sessions set revoked_at=coalesce(revoked_at,pg_catalog.clock_timestamp())where revoked_at is null;
delete from auth.refresh_tokens where session_id in(select s.id from auth.sessions s join public.admin_principals p on p.user_id=s.user_id);
delete from auth.sessions where user_id in(select user_id from public.admin_principals);
insert into public.admin_auth_audit_events(event_type,evidence)values('authority_closure_cutover',pg_catalog.jsonb_build_object('old_sessions_revoked',true));

revoke all on function public.reject_admin_auth_audit_mutation_v4(),public.admin_auth_lock_v4(uuid),public.admin_delete_gotrue_sessions_v4(uuid),public.bump_admin_auth_epoch_v2(uuid,text),public.handle_admin_ban_change_v4(),
  public.bootstrap_admin_principal_v4(uuid),public.provision_admin_principal_v4(text,uuid),public.revoke_admin_principal_v4(text,uuid),
  public.begin_admin_recovery_v4(uuid,text,text),public.complete_admin_recovery_provider_reset_v4(text),
  public.authorize_admin_session_handoff_v4(text,text,uuid,text,text[]),public.consume_admin_session_handoff_v4(text),
  public.validate_admin_session_v4(text,boolean),public.revoke_admin_session_v4(text),public.global_admin_signout_v4(text),
  public.invalidate_admin_provider_sessions_v4(uuid,text),public.set_admin_session_impersonation_v4(text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.authorize_admin_session_handoff_v4(text,text,uuid,text,text[]) to authenticated;
grant execute on function public.bootstrap_admin_principal_v4(uuid),public.provision_admin_principal_v4(text,uuid),public.revoke_admin_principal_v4(text,uuid),
  public.begin_admin_recovery_v4(uuid,text,text),public.complete_admin_recovery_provider_reset_v4(text),public.consume_admin_session_handoff_v4(text),
  public.validate_admin_session_v4(text,boolean),public.revoke_admin_session_v4(text),public.global_admin_signout_v4(text),
  public.invalidate_admin_provider_sessions_v4(uuid,text),public.set_admin_session_impersonation_v4(text,uuid)
to service_role;

-- There is no dual-authority transition. Revoke first so no old execute path can survive even if a later drop is changed.
revoke execute on function public.create_admin_session(text,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.create_admin_session_v2(text,uuid) from public,anon,authenticated,service_role;
revoke execute on function public.create_admin_session_v3(text) from public,anon,authenticated,service_role;
revoke execute on function public.bootstrap_admin_principal_v2(uuid) from public,anon,authenticated,service_role;
revoke execute on function public.provision_admin_principal_v2(text,uuid) from public,anon,authenticated,service_role;

drop function if exists public.create_admin_session(text,uuid);
drop function if exists public.create_admin_session_v2(text,uuid);
drop function if exists public.create_admin_session_v3(text);
drop function if exists public.bootstrap_admin_principal_v2(uuid);
drop function if exists public.provision_admin_principal_v2(text,uuid);
drop function if exists public.validate_admin_session(text,boolean);
drop function if exists public.validate_admin_session_v2(text,boolean);
drop function if exists public.revoke_admin_session(text);
drop function if exists public.global_admin_signout_v2(text);
drop function if exists public.set_admin_session_impersonation(text,uuid);
drop function if exists public.set_admin_session_impersonation_v2(text,uuid);
drop function if exists public.replace_admin_recovery_codes_v2(uuid,text[]);
drop function if exists public.consume_admin_recovery_code_v2(uuid,text);

drop trigger if exists admin_principal_authority_loss_revoke on public.admin_principals;
drop function if exists public.revoke_admin_sessions_on_authority_loss();

-- Final privileged attachment mutation delegates authentication to the canonical v4
-- session validator instead of maintaining a second stale session predicate.
create or replace function public.set_booking_attachment_legal_hold_v3(p_attachment_id uuid,p_held boolean,p_admin_token_hash text,p_reason text)returns boolean
language plpgsql security definer set search_path=''as $auth$
declare item public.booking_attachments%rowtype;principal uuid;
begin
 if p_admin_token_hash!~'^[a-f0-9]{64}$'or nullif(pg_catalog.btrim(p_reason),'')is null then raise exception 'legal hold authority required' using errcode='22023';end if;
 select v.user_id into principal from public.validate_admin_session_v4(p_admin_token_hash,false)v where v.role='admin';
 if principal is null then raise exception 'legal hold forbidden' using errcode='42501';end if;
 select * into strict item from public.booking_attachments where id=p_attachment_id for update;
 if p_held and exists(select 1 from public.booking_attachment_objects_v3 where attachment_id=item.id and generation=item.current_object_generation and deletion_authorized_at is not null and deleted_at is null)then raise exception 'attachment deletion was already authorized' using errcode='55000';end if;
 update public.booking_attachments set legal_hold_at=case when p_held then pg_catalog.clock_timestamp()else null end,legal_hold_reason=case when p_held then left(pg_catalog.btrim(p_reason),500)else null end,legal_hold_epoch=legal_hold_epoch+1 where id=item.id;
 if p_held then update public.booking_attachment_objects_v3 set deletion_state=case when deletion_state='committed'and deleted_at is null then'eligible'else deletion_state end,deletion_lease_token=case when deletion_state='committed'and deleted_at is null then null else deletion_lease_token end,deletion_lease_expires_at=case when deletion_state='committed'and deleted_at is null then null else deletion_lease_expires_at end,committed_legal_hold_epoch=null,committed_policy_version=null,updated_at=pg_catalog.clock_timestamp()where attachment_id=item.id and generation=item.current_object_generation and deletion_authorized_at is null;end if;
 insert into public.booking_attachment_audit_events(attachment_id,profile_id,environment,event_type,actor_auth_user_id,evidence)values(item.id,item.profile_id,item.environment,case when p_held then'legal_hold_set'else'legal_hold_released'end,principal,pg_catalog.jsonb_build_object('reason',left(pg_catalog.btrim(p_reason),500),'contract',4));return true;
end $auth$;
revoke all on function public.set_booking_attachment_legal_hold_v3(uuid,boolean,text,text)from public,anon,authenticated,booking_worker;
grant execute on function public.set_booking_attachment_legal_hold_v3(uuid,boolean,text,text)to service_role;

-- Calendar manual repair has one application-facing mutation authority. The canonical v4
-- validator acquires the admin authority transaction lock before rechecking AAL2, epoch,
-- principal, provider-user, and expiry state; its lock remains held through this repair.
create or replace function public.requeue_booking_calendar_manual_repair(p_link_id uuid,p_expected_generation bigint,p_actor_token_hash text,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $repair$
declare l public.calendar_event_links%rowtype;actor_user_id uuid;
begin
  if p_actor_token_hash!~'^[a-f0-9]{64}$'or char_length(pg_catalog.btrim(coalesce(p_reason,'')))not between 3 and 500 then
    raise exception 'repair actor session and reason required' using errcode='22023';
  end if;
  select v.user_id into actor_user_id from public.validate_admin_session_v4(p_actor_token_hash,false)v where v.role='admin';
  if actor_user_id is null then raise exception 'admin actor session required' using errcode='42501';end if;
  select * into strict l from public.calendar_event_links
    where id=p_link_id and desired_generation=p_expected_generation and reconcile_status='manual_repair' for update;
  insert into public.booking_calendar_repair_audit(link_id,profile_id,environment,expected_generation,actor_user_id,reason,prior_state)
  values(l.id,l.profile_id,l.environment,l.desired_generation,actor_user_id,pg_catalog.btrim(p_reason),pg_catalog.to_jsonb(l));
  update public.calendar_event_links set reconcile_status='due',reconcile_next_attempt_at=pg_catalog.clock_timestamp(),reconcile_attempts=0,
    reconcile_lease_token=null,reconcile_lease_expires_at=null,manual_repair_at=null,manual_repair_reason=null,updated_at=pg_catalog.clock_timestamp()
  where id=l.id;
  return true;
end
$repair$;

-- Service clients and workers cross these booking ledgers only through their narrow SECURITY
-- DEFINER RPCs. Preserve RPC EXECUTE allowlists while removing BYPASSRLS direct mutation paths.
revoke insert,update,delete,truncate on table public.appointments,public.integration_outbox,public.calendar_event_links,
  public.booking_late_payment_arbitrations,public.booking_late_payment_observations,
  public.booking_calendar_observations,public.booking_calendar_effect_attempts,public.booking_calendar_repair_audit
from service_role,booking_worker;
revoke all on table public.booking_calendar_observations,public.booking_calendar_effect_attempts,public.booking_calendar_repair_audit
from public,anon,authenticated,service_role,booking_worker;
-- Opaque admin authority rows cannot be minted or changed by a service key. The login flow's
-- one direct principal lookup is read-only and column-limited.
revoke all on table public.admin_principals,public.admin_sessions,public.admin_login_throttle_buckets from service_role;
grant select(user_id,enabled,mfa_required,recovery_codes_issued_at) on table public.admin_principals to service_role;
revoke all on sequence public.booking_calendar_repair_audit_id_seq from public,anon,authenticated,service_role,booking_worker;
drop trigger if exists booking_calendar_repair_audit_no_truncate on public.booking_calendar_repair_audit;
create trigger booking_calendar_repair_audit_no_truncate before truncate on public.booking_calendar_repair_audit
for each statement execute function public.reject_booking_convergence_evidence_mutation();
revoke all on function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.requeue_booking_calendar_manual_repair(uuid,bigint,text,text) to service_role;
