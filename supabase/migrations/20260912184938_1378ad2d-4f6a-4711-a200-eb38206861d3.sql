-- Fixed admin account with hardcoded credentials; no bootstrap/recovery/MFA flows.
do $fix$
declare v_id uuid := '00000000-0000-4000-9000-0000000ad311';
begin
  if not exists (select 1 from auth.users where email = 'obra@shr.com') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      'obra@shr.com', extensions.crypt('America@123', extensions.gen_salt('bf')), now(),
      now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false
    );
  else
    select id into v_id from auth.users where email = 'obra@shr.com';
    update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()),
      encrypted_password = extensions.crypt('America@123', extensions.gen_salt('bf')),
      banned_until = null, deleted_at = null
    where id = v_id;
  end if;

  insert into public.admin_principals (user_id, role, enabled, mfa_required)
  values (v_id, 'admin', true, true)
  on conflict (user_id) do update set enabled = true, mfa_required = true, updated_at = now();
end
$fix$;

create or replace function public.mint_fixed_admin_session_v1(p_email text, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_user_id uuid; v_epoch integer; v_session uuid;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid session token' using errcode='22023'; end if;
  select p.user_id, p.auth_epoch into v_user_id, v_epoch
  from public.admin_principals p
  join auth.users u on u.id = p.user_id
  where pg_catalog.lower(u.email) = pg_catalog.lower(p_email)
    and p.enabled and p.mfa_required and p.role = 'admin'
    and u.deleted_at is null and u.confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= pg_catalog.clock_timestamp());
  if v_user_id is null then raise exception 'admin principal unavailable' using errcode='42501'; end if;

  insert into public.admin_sessions(token_hash,user_id,role,aal,auth_epoch,idle_expires_at,absolute_expires_at)
  values (p_token_hash, v_user_id, 'admin', 'aal2', v_epoch,
          pg_catalog.clock_timestamp() + interval '30 minutes',
          pg_catalog.clock_timestamp() + interval '12 hours')
  returning id into v_session;
  return v_session;
end
$fn$;

revoke all on function public.mint_fixed_admin_session_v1(text,text) from public, anon, authenticated;
grant execute on function public.mint_fixed_admin_session_v1(text,text) to service_role;