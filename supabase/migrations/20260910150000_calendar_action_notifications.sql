-- Connection action notices, not appointment notifications. No schedule or HTTP
-- call is installed here. Apply after the calendar lifetime/scheduler migrations.
-- Current incident evidence and the retained delivery live on the existing connection.
-- Unresolved dispatch blocks another automatic email, never a new incident observation.
alter table public.calendar_connections
  add column if not exists action_notice jsonb not null default '{}'::jsonb,
  add column if not exists action_notice_due_at timestamptz,
  add column if not exists action_notice_lease_token uuid,
  add column if not exists action_notice_lease_expires_at timestamptz,
  add column if not exists action_notice_fencing_token bigint not null default 0;

do $constraints$
begin
  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='public.calendar_connections'::regclass and conname='calendar_action_notice_facts_check') then
    alter table public.calendar_connections add constraint calendar_action_notice_facts_check check (
      action_notice_fencing_token >= 0
      and pg_catalog.jsonb_typeof(action_notice)='object'
      and pg_catalog.octet_length(action_notice::text)<=32768
      and (action_notice='{}'::jsonb or coalesce((
        action_notice->>'id' ~ '^[a-f0-9-]{36}$'
        and pg_catalog.jsonb_typeof(action_notice->'scope')='object'
        and action_notice->'scope'->>'cause' in ('reauthorization','permissions','selection','setup')
        and action_notice->'scope'->>'source' in ('saved','setup')
        and pg_catalog.isfinite((action_notice->>'opened_at')::timestamptz)
        and (not action_notice ? 'closed_at' or coalesce(pg_catalog.isfinite((action_notice->>'closed_at')::timestamptz),false))
        and pg_catalog.jsonb_typeof(action_notice->'current_incident')='object'
        and action_notice->'current_incident'->>'id' ~ '^[a-f0-9-]{36}$'
        and pg_catalog.jsonb_typeof(action_notice->'current_incident'->'scope')='object'
        and action_notice->'current_incident'->'scope'->>'cause' in ('reauthorization','permissions','selection','setup')
        and action_notice->'current_incident'->'scope'->>'source' in ('saved','setup')
        and pg_catalog.isfinite((action_notice->'current_incident'->>'opened_at')::timestamptz)
        and (not (action_notice->'current_incident') ? 'closed_at'
          or coalesce(pg_catalog.isfinite((action_notice->'current_incident'->>'closed_at')::timestamptz),false))
        and (action_notice->'current_incident')-array['id','scope','opened_at','closed_at']='{}'::jsonb
        and case when action_notice->>'id'=action_notice->'current_incident'->>'id' then
          action_notice->'scope'=action_notice->'current_incident'->'scope'
          and action_notice->'opened_at'=action_notice->'current_incident'->'opened_at'
          and action_notice->'closed_at' is not distinct from action_notice->'current_incident'->'closed_at'
          else action_notice ? 'closed_at' and action_notice ? 'first_dispatch_at' end
        and action_notice->>'state' in ('pending','accepted','suppressed','review')
        and ((not action_notice ? 'first_dispatch_at' and not action_notice ? 'payload')
          or (pg_catalog.jsonb_typeof(action_notice->'payload')='string'
            and pg_catalog.octet_length(action_notice->>'payload') between 2 and 16384
            and pg_catalog.isfinite((action_notice->>'first_dispatch_at')::timestamptz)
            and pg_catalog.jsonb_typeof(action_notice->'recipient_email')='string'))
        and ((not action_notice ? 'provider_message_id' and not action_notice ? 'accepted_at'
            and action_notice->>'state'<>'accepted')
          or (action_notice->>'state'='accepted'
            and action_notice->>'provider_message_id' ~ '^[A-Za-z0-9_-]{8,200}$'
            and pg_catalog.isfinite((action_notice->>'accepted_at')::timestamptz)
            and action_notice ? 'first_dispatch_at'))
        and (action_notice->>'state'<>'review' or action_notice->>'review_reason' in (
          'recipient_unavailable','recipient_changed','provider_rejected','acceptance_unknown','idempotency_expired'))
      ),false))
    );
  end if;
end $constraints$;

-- Only classified, attributable contractor remedies. Missing/unhealthy accounts,
-- generic 401s, platform configuration, stale evidence and temporary failures do
-- not establish revoked Google consent. Initial setup need not have a saved account.
create or replace function public.calendar_action_notice_scope(p_connection public.calendar_connections)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cause text; account_id text; source text; operation_id uuid; actor uuid; selections_hash text;
begin
  select p.auth_user_id into actor from public.profiles p
    where p.id=p_connection.profile_id and p.environment=p_connection.environment;
  if p_connection.setup_operation_id is not null and p_connection.setup_completed_at is null
    and p_connection.setup_purpose='configuration'
    and p_connection.setup_expected_revision=p_connection.connection_revision
    and p_connection.setup_account_id is not null
    and p_connection.setup_actor_auth_user_id=actor then
    source:='setup'; account_id:=p_connection.setup_account_id;
    operation_id:=p_connection.setup_operation_id;
    -- A retained superseded probe can fail while cleaning up another account or
    -- calendar. That is operator cleanup, not evidence against the owner's new choices.
    cause:=case when p_connection.setup_probe_account_id=p_connection.setup_account_id
      and p_connection.setup_probe_calendar_id=p_connection.setup_calendar_id then case
        when p_connection.setup_failure_reason in ('reauthorization','permissions') then p_connection.setup_failure_reason
        when p_connection.setup_failure_reason='configuration' then 'setup' end end;
    select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id'),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
      into selections_hash from pg_catalog.jsonb_array_elements(p_connection.setup_calendars) x;
  elsif p_connection.pipedream_account_id is not null
    and p_connection.verification_reason is distinct from 'contractor_disconnected'
    and p_connection.reconnect_reason is distinct from 'contractor_disconnected' then
    source:='saved'; account_id:=p_connection.pipedream_account_id;
    cause:=case
      when 'provider_reauthorization_required' in (p_connection.verification_reason,p_connection.reconnect_reason)
        then 'reauthorization'
      when p_connection.verification_reason in ('calendar_permissions_changed','calendar_write_blocked') then 'permissions'
      when p_connection.verification_reason='calendar_selection_invalid' then 'selection' end;
  end if;
  if cause is null or exists(select 1 from public.booking_provider_account_disconnects_v3 d
    where d.profile_id=p_connection.profile_id and d.environment=p_connection.environment
      and d.provider='pipedream' and d.provider_account_id=account_id and d.state in ('pending','completed'))
    then return null; end if;
  return pg_catalog.jsonb_build_object('source',source,'cause',cause,'account_id',account_id,
    'connection_revision',p_connection.connection_revision,'setup_operation_id',operation_id,'actor_auth_user_id',actor)
    ||case when source='setup' then pg_catalog.jsonb_build_object('setup_calendar_id',p_connection.setup_calendar_id,
      'setup_selections_sha256',selections_hash) else '{}'::jsonb end;
end $$;

-- A recovery between monitor polls must end the incident too. Temporary observations
-- merely pause eligibility, rather than resetting deduplication on every retry.
create or replace function public.project_calendar_action_notice()
returns trigger language plpgsql security definer set search_path='' as $$
declare scope jsonb; notice jsonb:=new.action_notice; incident jsonb:=new.action_notice->'current_incident';
  ended boolean:=false; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  scope:=public.calendar_action_notice_scope(new);
  if incident is not null and not incident ? 'closed_at' then
    ended:=incident->'scope'->>'connection_revision' is distinct from new.connection_revision::text
      or (scope is not null and incident->'scope' is distinct from scope)
      or exists(select 1 from public.booking_provider_account_disconnects_v3 d
        where d.profile_id=new.profile_id and d.environment=new.environment and d.provider='pipedream'
          and d.provider_account_id=incident->'scope'->>'account_id' and d.state in ('pending','completed'));
    if incident->'scope'->>'source'='setup' then
      ended:=ended or incident->'scope'->>'setup_operation_id' is distinct from new.setup_operation_id::text
        or incident->'scope'->>'account_id' is distinct from new.setup_account_id or new.setup_completed_at is not null
        or (tg_op='UPDATE' and (new.setup_calendar_id is distinct from old.setup_calendar_id
          or (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id')
            from pg_catalog.jsonb_array_elements(new.setup_calendars)x) is distinct from
             (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x->>'id',x->'blocksAvailability',x->'receivesBookings') order by x->>'id')
            from pg_catalog.jsonb_array_elements(old.setup_calendars)x)));
    else
      ended:=ended or incident->'scope'->>'account_id' is distinct from new.pipedream_account_id
        or 'contractor_disconnected' in (new.verification_reason,new.reconnect_reason)
        -- A replayed old success or delivery settlement is not new recovery evidence.
        or (tg_op='UPDATE' and new.health_state='healthy' and new.verification_reason is null and new.reconnect_reason is null
          and new.last_verified_at is not null
          and (old.last_verified_at is null or new.last_verified_at>old.last_verified_at));
    end if;
    if coalesce(ended,false) then
      incident:=incident||pg_catalog.jsonb_build_object('closed_at',now_at);
      if notice->>'id'=incident->>'id' then
        notice:=notice||pg_catalog.jsonb_build_object('closed_at',now_at);
        if not notice ? 'first_dispatch_at' then
          notice:=(notice-'review_reason')||'{"state":"suppressed"}'::jsonb;
          new.action_notice_lease_token:=null; new.action_notice_lease_expires_at:=null;
          new.action_notice_fencing_token:=new.action_notice_fencing_token+1;
        elsif notice->>'state'<>'accepted' then
          notice:=notice||'{"state":"review","review_reason":"acceptance_unknown"}'::jsonb;
        end if;
        new.action_notice_due_at:=null;
      end if;
    end if;
  end if;
  -- Capture every new definite episode even while an older delivery cannot be replaced.
  if scope is not null and (incident is null or incident ? 'closed_at') then
    incident:=pg_catalog.jsonb_build_object('id',pg_catalog.gen_random_uuid(),'scope',scope,'opened_at',now_at);
  end if;
  if incident is not null and not incident ? 'closed_at' and scope=incident->'scope'
    and notice->>'id' is distinct from incident->>'id'
    and (not notice ? 'first_dispatch_at' or notice->>'state'='accepted')
    -- Retain a just-accepted response's fence through DB-only settlement retries.
    and (not notice ? 'first_dispatch_at' or new.action_notice_lease_expires_at is null
      or new.action_notice_lease_expires_at<=now_at) then
    notice:=incident||'{"state":"pending"}'::jsonb;
    new.action_notice_due_at:=now_at;
    new.action_notice_lease_token:=null; new.action_notice_lease_expires_at:=null;
    new.action_notice_fencing_token:=new.action_notice_fencing_token+1;
  elsif tg_op='UPDATE' and scope is not null and not notice ? 'closed_at'
    and not notice ? 'first_dispatch_at' and scope=notice->'scope'
    and public.calendar_action_notice_scope(old) is distinct from scope
    and notice->>'state'='pending' then
    new.action_notice_due_at:=now_at;
  end if;
  new.action_notice:=case when notice='{}'::jsonb then notice
    else notice||pg_catalog.jsonb_build_object('current_incident',incident) end;
  return new;
end $$;

create or replace function public.claim_calendar_action_notice(p_environment text,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections; notice jsonb; recipient text; now_at timestamptz;
begin
  if p_environment is null or p_environment not in ('test','live') or p_lease_token is null then
    raise exception 'Invalid calendar notice claim' using errcode='22023'; end if;
  for c in select x.* from public.calendar_connections x
    where x.environment=p_environment
      and (x.action_notice_lease_expires_at is null or x.action_notice_lease_expires_at<=pg_catalog.clock_timestamp())
      and (
        (x.action_notice->>'state'='pending' and x.action_notice_due_at<=pg_catalog.clock_timestamp())
        or (x.action_notice->>'state' in ('accepted','suppressed') and x.action_notice ? 'closed_at'
          and public.calendar_action_notice_scope(x) is not null)
        or (x.action_notice->>'state'='accepted' and public.calendar_action_notice_scope(x) is not null
          and public.calendar_action_notice_scope(x) is distinct from x.action_notice->'scope')
        or (x.action_notice->>'state'='review' and x.action_notice->>'review_reason'='recipient_unavailable'
          and not x.action_notice ? 'first_dispatch_at' and x.action_notice_due_at<=pg_catalog.clock_timestamp())
      )
    order by x.action_notice_due_at nulls last,x.id for update skip locked limit 25
  loop
    -- Reproject after locking, including an accepted incident whose retained lease expired.
    update public.calendar_connections set action_notice=action_notice where id=c.id returning * into c;
    notice:=c.action_notice; now_at:=pg_catalog.clock_timestamp();
    if notice->>'state' not in ('pending','review') or notice ? 'closed_at' then continue; end if;
    if (notice->>'first_dispatch_at')::timestamptz<=now_at-interval '24 hours' then
      update public.calendar_connections set action_notice=notice||'{"state":"review","review_reason":"idempotency_expired"}'::jsonb,
        action_notice_due_at=null where id=c.id;
      continue;
    end if;
    if public.calendar_action_notice_scope(c) is distinct from notice->'scope' then
      update public.calendar_connections set action_notice_due_at=now_at+interval '5 minutes' where id=c.id;
      continue;
    end if;
    -- The profile's verified login owner, never Google external_user_id/account_email.
    select pg_catalog.lower(pg_catalog.btrim(p.email)) into recipient from public.profiles p
      join auth.users u on u.id=p.auth_user_id
      where p.id=c.profile_id and p.environment=c.environment
        and p.auth_user_id::text=notice->'scope'->>'actor_auth_user_id'
        and u.email_confirmed_at is not null and u.deleted_at is null
        and pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(p.email))
        and pg_catalog.length(p.email)<=254 and p.email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$';
    if recipient is null or (notice ? 'recipient_email' and notice->>'recipient_email' is distinct from recipient) then
      update public.calendar_connections set action_notice=notice||pg_catalog.jsonb_build_object('state','review',
        'review_reason',case when notice ? 'recipient_email' then 'recipient_changed' else 'recipient_unavailable' end),
        action_notice_due_at=case when not notice ? 'recipient_email' then now_at+interval '5 minutes' end where id=c.id;
      continue;
    end if;
    update public.calendar_connections set
      action_notice=(notice-'review_reason')||pg_catalog.jsonb_build_object('state','pending','recipient_email',recipient),
      action_notice_lease_token=p_lease_token,action_notice_lease_expires_at=now_at+interval '55 seconds',
      action_notice_fencing_token=action_notice_fencing_token+1,action_notice_due_at=now_at+interval '1 minute'
      where id=c.id returning * into c;
    return pg_catalog.jsonb_build_object('connection_id',c.id,'environment',c.environment,'notice',c.action_notice,
      'fencing_token',c.action_notice_fencing_token,'lease_expires_at',c.action_notice_lease_expires_at);
  end loop;
  return null;
end $$;

-- Authorize and settle are the same closed transition authority, separate from
-- claim so a known result can use the worker's DB-only settlement reserve.
create or replace function public.transition_calendar_action_notice(
  p_environment text,p_connection_id uuid,p_notice_id uuid,p_lease_token uuid,p_fencing_token bigint,
  p_action text,p_payload text default null,p_provider_message_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.calendar_connections; notice jsonb; payload jsonb; recipient text; now_at timestamptz; budget_ms integer;
begin
  if p_environment is null or p_environment not in ('test','live') or p_connection_id is null or p_notice_id is null
    or p_lease_token is null or p_fencing_token is null or p_action is null
    or p_action not in ('authorize','accepted','unknown','rejected') then
    raise exception 'Invalid calendar notice transition' using errcode='22023'; end if;
  select * into c from public.calendar_connections where id=p_connection_id and environment=p_environment for update;
  if found and p_action='authorize' and c.action_notice->>'id'=p_notice_id::text
    and c.action_notice->>'state'='suppressed' and c.action_notice ? 'closed_at' then
    return '{"action":"suppressed"}'::jsonb;
  end if;
  if not found or c.action_notice->>'id' is distinct from p_notice_id::text
    or c.action_notice_lease_token is distinct from p_lease_token
    or c.action_notice_fencing_token is distinct from p_fencing_token then
    raise exception 'Stale calendar notice fence' using errcode='40001'; end if;
  notice:=c.action_notice; now_at:=pg_catalog.clock_timestamp();
  if p_action='accepted' then
    if coalesce(p_provider_message_id,'') !~ '^[A-Za-z0-9_-]{8,200}$' then
      raise exception 'Invalid calendar notice provider identity' using errcode='22023'; end if;
    if notice->>'state'='accepted' and notice->>'provider_message_id'=p_provider_message_id then
      return '{"action":"accepted"}'::jsonb;
    end if;
  elsif p_action in ('unknown','rejected') and c.action_notice_lease_expires_at is null
    and notice ? 'first_dispatch_at' and notice->>'state' in ('pending','review') then
    return pg_catalog.jsonb_build_object('action',notice->>'state');
  end if;
  if c.action_notice_lease_expires_at is null or c.action_notice_lease_expires_at<=now_at
    or notice->>'state' not in ('pending','review') then
    raise exception 'Expired calendar notice lease' using errcode='40001'; end if;

  if p_action='authorize' then
    if notice ? 'closed_at' or public.calendar_action_notice_scope(c) is distinct from notice->'scope' then
      if notice ? 'first_dispatch_at' then
        notice:=notice||'{"state":"review","review_reason":"acceptance_unknown"}'::jsonb;
      end if;
      update public.calendar_connections set action_notice=notice,action_notice_lease_expires_at=null,
        action_notice_due_at=case when notice->>'state'='pending' then now_at+interval '1 minute' end where id=c.id;
      return pg_catalog.jsonb_build_object('action',case when notice->>'state'='pending' then 'deferred' else notice->>'state' end);
    end if;
    select pg_catalog.lower(pg_catalog.btrim(p.email)) into recipient from public.profiles p
      join auth.users u on u.id=p.auth_user_id where p.id=c.profile_id and p.environment=c.environment
        and p.auth_user_id::text=notice->'scope'->>'actor_auth_user_id' and u.email_confirmed_at is not null and u.deleted_at is null
        and pg_catalog.lower(pg_catalog.btrim(u.email))=pg_catalog.lower(pg_catalog.btrim(p.email));
    if recipient is null or recipient is distinct from notice->>'recipient_email'
      or (notice->>'first_dispatch_at')::timestamptz<=now_at-interval '24 hours'+interval '1 second' then
      notice:=notice||pg_catalog.jsonb_build_object('state','review','review_reason',
        case when recipient is distinct from notice->>'recipient_email' then 'recipient_changed' else 'idempotency_expired' end);
      update public.calendar_connections set action_notice=notice,action_notice_due_at=null,
        action_notice_lease_expires_at=null where id=c.id;
      return '{"action":"review"}'::jsonb;
    end if;
    if p_payload is null or pg_catalog.octet_length(p_payload) not between 2 and 16384 then
      raise exception 'Invalid calendar notice payload' using errcode='22023'; end if;
    payload:=p_payload::jsonb;
    if pg_catalog.jsonb_typeof(payload) is distinct from 'object'
      or payload->'to' is distinct from pg_catalog.jsonb_build_array(recipient)
      or pg_catalog.jsonb_typeof(payload->'from') is distinct from 'string' or nullif(pg_catalog.btrim(payload->>'from'),'') is null
      or pg_catalog.jsonb_typeof(payload->'subject') is distinct from 'string' or nullif(pg_catalog.btrim(payload->>'subject'),'') is null
      or pg_catalog.jsonb_typeof(payload->'text') is distinct from 'string' or nullif(pg_catalog.btrim(payload->>'text'),'') is null
      or payload-array['from','to','subject','text']<>'{}'::jsonb
      or (notice ? 'payload' and notice->>'payload' is distinct from p_payload) then
      raise exception 'Calendar notice payload or recipient changed' using errcode='40001'; end if;
    if not notice ? 'first_dispatch_at' then
      notice:=notice||pg_catalog.jsonb_build_object('first_dispatch_at',now_at,'payload',p_payload);
      update public.calendar_connections set action_notice=notice where id=c.id;
    end if;
    budget_ms:=floor(least(10000,extract(epoch from (least(c.action_notice_lease_expires_at,
      (notice->>'first_dispatch_at')::timestamptz+interval '24 hours')-pg_catalog.clock_timestamp()))*1000-1000))::integer;
    if budget_ms<=0 then return '{"action":"deferred"}'::jsonb; end if;
    return pg_catalog.jsonb_build_object('action','dispatch','payload',notice->>'payload','dispatch_budget_ms',budget_ms,
      'idempotency_key','calendar-action:'||p_environment||':'||c.id||':'||p_notice_id);
  end if;

  if not notice ? 'first_dispatch_at' then
    raise exception 'Calendar notice dispatch evidence required' using errcode='40001'; end if;
  if p_action='accepted' then
    -- Recovery/disconnect after dispatch cannot erase a real acceptance. Keep this
    -- lease identity until expiry for exact, response-loss completion repetition.
    notice:=(notice-'review_reason')||pg_catalog.jsonb_build_object('state','accepted',
      'provider_message_id',p_provider_message_id,'accepted_at',now_at);
    update public.calendar_connections set action_notice=notice,action_notice_due_at=null where id=c.id;
    return '{"action":"accepted"}'::jsonb;
  end if;
  if p_action='rejected' or notice ? 'closed_at' or notice->>'state'='review'
    or (notice->>'first_dispatch_at')::timestamptz<=now_at-interval '24 hours'+interval '1 second' then
    notice:=notice||pg_catalog.jsonb_build_object('state','review','review_reason',case
      when (notice->>'first_dispatch_at')::timestamptz<=now_at-interval '24 hours'+interval '1 second' then 'idempotency_expired'
      when p_action='rejected' then 'provider_rejected' else 'acceptance_unknown' end);
  end if;
  update public.calendar_connections set action_notice=notice,action_notice_lease_expires_at=null,
    action_notice_due_at=case when notice->>'state'='pending' then now_at+interval '1 minute' end where id=c.id;
  return pg_catalog.jsonb_build_object('action',notice->>'state');
end $$;

create or replace function public.get_calendar_action_notice_health(p_environment text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if p_environment is null or p_environment not in ('test','live') then
    raise exception 'Explicit calendar notice environment required' using errcode='22023'; end if;
  with facts as (
    select c.*,c.action_notice->'current_incident' as current_incident,
      (c.action_notice<>'{}'::jsonb and not (c.action_notice->'current_incident') ? 'closed_at') as incident_open,
      (c.action_notice->>'state'='review' or (c.action_notice->>'state'='pending'
        and (c.action_notice->>'first_dispatch_at')::timestamptz<=now()-interval '24 hours')) as needs_review,
      case when c.setup_operation_id is not null and c.setup_completed_at is null
        and c.setup_expected_revision=c.connection_revision
        and not exists(select 1 from public.booking_provider_account_disconnects_v3 d
          where d.profile_id=c.profile_id and d.environment=c.environment and d.provider='pipedream'
            and d.provider_account_id=c.setup_account_id and d.state in ('pending','completed'))
        then greatest(0,extract(epoch from now()-coalesce(c.setup_retry_at,c.created_at))::bigint) else 0 end as setup_overdue_seconds
    from public.calendar_connections c where c.environment=p_environment
  )
  select pg_catalog.jsonb_build_object('environment',p_environment,'observed_at',now(),
    'action_required_count',count(*) filter(where incident_open),
    'pending_count',count(*) filter(where action_notice->>'state'='pending' and not action_notice ? 'closed_at' and needs_review is not true),
    'oldest_pending_age_seconds',coalesce(max(greatest(0,extract(epoch from now()-(action_notice->>'opened_at')::timestamptz)::bigint))
      filter(where action_notice->>'state'='pending' and not action_notice ? 'closed_at' and needs_review is not true),0),
    'review_count',count(*) filter(where needs_review),
    'setup_overdue_count',count(*) filter(where setup_overdue_seconds>=120),
    'oldest_setup_overdue_seconds',coalesce(max(setup_overdue_seconds),0),
    'platform_error_count',count(*) filter(where verification_reason in ('provider_platform_error','provider_configuration_error')
      or (setup_operation_id is not null and setup_completed_at is null and setup_expected_revision=connection_revision
        and setup_failure_reason in ('platform','configuration'))),
    -- 140 excludes disconnected_at rows from recurring connection inventory. An
    -- unclassified provider-disconnected row is not silence and not proven revocation.
    'unverified_disconnected_count',count(*) filter(where pipedream_account_id is not null
      and (disconnected_at is not null or health_state='disconnected')
      and verification_reason is distinct from 'contractor_disconnected' and reconnect_reason is distinct from 'contractor_disconnected'
      and verification_reason is distinct from 'provider_reauthorization_required' and reconnect_reason is distinct from 'provider_reauthorization_required'
      and (last_verified_at is null or last_verified_at<=now()-interval '15 minutes')
      and not exists(select 1 from public.booking_provider_account_disconnects_v3 d
        where d.profile_id=facts.profile_id and d.environment=facts.environment and d.provider='pipedream'
          and d.provider_account_id=facts.pipedream_account_id and d.state in ('pending','completed'))),
    'items',coalesce((select pg_catalog.jsonb_agg(item) from (
      select pg_catalog.jsonb_build_object('connection_id',id,'profile_id',profile_id,'notice_id',action_notice->>'id',
        'cause',action_notice->'scope'->>'cause','source',action_notice->'scope'->>'source',
        'current_incident',pg_catalog.jsonb_build_object('id',current_incident->>'id',
          'cause',current_incident->'scope'->>'cause','source',current_incident->'scope'->>'source',
          'opened_at',current_incident->>'opened_at','closed_at',current_incident->>'closed_at'),
        'state',case when needs_review then 'review' else action_notice->>'state' end,
        'opened_at',action_notice->>'opened_at','closed_at',action_notice->>'closed_at',
        'first_dispatch_at',action_notice->>'first_dispatch_at','accepted_at',action_notice->>'accepted_at',
        'next_attempt_at',action_notice_due_at,'lease_expires_at',action_notice_lease_expires_at,
        'review_reason',case when needs_review and action_notice->>'state'<>'review' then 'idempotency_expired'
          else action_notice->>'review_reason' end) as item
      from facts where incident_open or needs_review or action_notice->>'state'='accepted'
      order by needs_review desc nulls last,(action_notice->>'opened_at')::timestamptz,id limit 100
    ) limited),'[]'::jsonb),'items_limit',100) into result from facts;
  return result;
end $$;

-- Service has existing provider-maintenance table rights, but may not bypass the
-- new dispatch authority with a raw PATCH. SECURITY DEFINER commands share the
-- migration owner; browser/booking-worker rights are not broadened.
create or replace function public.guard_calendar_action_notice_write()
returns trigger language plpgsql set search_path='' as $$
begin
  if ((tg_op='INSERT' and (new.action_notice<>'{}'::jsonb or new.action_notice_due_at is not null
      or new.action_notice_lease_token is not null or new.action_notice_lease_expires_at is not null
      or new.action_notice_fencing_token<>0))
    or (tg_op='UPDATE' and (new.action_notice,new.action_notice_due_at,new.action_notice_lease_token,
      new.action_notice_lease_expires_at,new.action_notice_fencing_token) is distinct from
      (old.action_notice,old.action_notice_due_at,old.action_notice_lease_token,
        old.action_notice_lease_expires_at,old.action_notice_fencing_token)))
    and current_user is distinct from pg_catalog.pg_get_userbyid((select p.proowner from pg_catalog.pg_proc p
      where p.oid='public.claim_calendar_action_notice(text,uuid)'::regprocedure)) then
    raise exception 'Calendar notice command authority required' using errcode='42501'; end if;
  return new;
end $$;

revoke all on function public.calendar_action_notice_scope(public.calendar_connections),
  public.project_calendar_action_notice(),public.guard_calendar_action_notice_write(),
  public.claim_calendar_action_notice(text,uuid),
  public.transition_calendar_action_notice(text,uuid,uuid,uuid,bigint,text,text,text),
  public.get_calendar_action_notice_health(text) from public,anon,authenticated,service_role,booking_worker;
grant execute on function public.claim_calendar_action_notice(text,uuid),
  public.transition_calendar_action_notice(text,uuid,uuid,uuid,bigint,text,text,text),
  public.get_calendar_action_notice_health(text) to service_role;

drop trigger if exists calendar_connections_action_notice_guard on public.calendar_connections;
create trigger calendar_connections_action_notice_guard before insert or update on public.calendar_connections
  for each row execute function public.guard_calendar_action_notice_write();
-- Run after the existing capability-blocker BEFORE trigger, consuming its final reason.
drop trigger if exists calendar_connections_zz_action_notice on public.calendar_connections;
create trigger calendar_connections_zz_action_notice before insert or update on public.calendar_connections
  for each row execute function public.project_calendar_action_notice();

-- Publish/replay does not rotate an existing incident or clear its dispatch facts.
update public.calendar_connections set action_notice=action_notice where id is not null;
