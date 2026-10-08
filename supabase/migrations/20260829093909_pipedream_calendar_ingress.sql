-- Signed Pipedream calendar ingress with exact durable binding correlation.
alter table public.provider_event_inbox
  add column if not exists pipedream_binding_id uuid,
  add column if not exists pipedream_trigger_id text;

alter table public.provider_event_inbox
  drop constraint if exists provider_event_inbox_pipedream_binding_fkey,
  add constraint provider_event_inbox_pipedream_binding_fkey
    foreign key (pipedream_binding_id, profile_id, environment)
    references public.pipedream_bindings(id, profile_id, environment),
  add constraint provider_event_inbox_pipedream_identity_check check (
    provider <> 'pipedream' or (
      event_family='calendar' and profile_id is not null and pipedream_binding_id is not null
      and nullif(account_context,'') is not null and nullif(destination,'') is not null
      and nullif(pipedream_trigger_id,'') is not null
    )
  );

create or replace function public.ingest_pipedream_calendar_event(
 p_event_id text,p_environment text,p_binding_id uuid,p_account_id text,p_trigger_id text,
 p_correlation_id uuid,p_event_type text,p_payload_hash text,p_payload jsonb,p_signature_timestamp timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare binding public.pipedream_bindings%rowtype; event_row_id uuid;
begin
 select * into strict binding from public.pipedream_bindings
 where id=p_binding_id and environment=p_environment and webhook_correlation_id=p_correlation_id
   and pipedream_account_id=p_account_id and deployed_trigger_id=p_trigger_id
   and trigger_state in ('active','degraded') for update;
 insert into public.provider_event_inbox(provider,event_family,event_id,account_context,destination,api_version,
   livemode,environment,profile_id,event_type,payload_hash,payload,signature_timestamp,pipedream_binding_id,pipedream_trigger_id)
 values('pipedream','calendar',p_event_id,p_account_id,p_correlation_id::text,binding.component_version,
   (p_environment='live'),p_environment,binding.profile_id,p_event_type,p_payload_hash,p_payload,p_signature_timestamp,
   binding.id,p_trigger_id)
 on conflict(provider,event_family,event_id,account_context,destination,api_version,livemode) do nothing;
 select id into strict event_row_id from public.provider_event_inbox where provider='pipedream' and event_family='calendar'
   and event_id=p_event_id and account_context=p_account_id and destination=p_correlation_id::text
   and api_version=binding.component_version and livemode=(p_environment='live')
   and environment=p_environment and profile_id=binding.profile_id and payload_hash=p_payload_hash
   and pipedream_binding_id=binding.id and pipedream_trigger_id=p_trigger_id for update;
 return event_row_id;
end $$;
revoke all on function public.ingest_pipedream_calendar_event(text,text,uuid,text,text,uuid,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.ingest_pipedream_calendar_event(text,text,uuid,text,text,uuid,text,text,jsonb,timestamptz) to service_role;

create or replace function public.apply_pipedream_calendar_event(
 p_event_id uuid,p_lease_token uuid,p_fencing_token bigint,p_occurred_at timestamptz
) returns boolean language plpgsql security definer set search_path='' as $$
declare inbox public.provider_event_inbox%rowtype;
begin
 select * into strict inbox from public.provider_event_inbox where id=p_event_id for update;
 if p_lease_token is null or p_fencing_token is null or inbox.provider<>'pipedream'
   or inbox.event_family<>'calendar' or inbox.processing_state<>'processing'
   or inbox.lease_token is distinct from p_lease_token or inbox.fencing_token is distinct from p_fencing_token
   or inbox.lease_expires_at is null or inbox.lease_expires_at<=pg_catalog.clock_timestamp() then
   raise exception 'stale Pipedream event fence' using errcode='40001'; end if;
 update public.pipedream_bindings set last_event_at=greatest(coalesce(last_event_at,'epoch'),p_occurred_at),
   last_health_at=pg_catalog.clock_timestamp(),
   safe_error=case when safe_error='Google calendar configuration changed' then safe_error else null end,
   updated_at=pg_catalog.clock_timestamp()
 where id=inbox.pipedream_binding_id and profile_id=inbox.profile_id and environment=inbox.environment
   and pipedream_account_id=inbox.account_context and deployed_trigger_id=inbox.pipedream_trigger_id;
 if not found then raise exception 'Pipedream binding no longer correlates' using errcode='P0001'; end if;
 -- An external change invalidates cached calendar truth; it is not a successful synchronization.
 update public.calendar_connections set last_synchronized_at=null,updated_at=pg_catalog.clock_timestamp()
 where profile_id=inbox.profile_id and environment=inbox.environment and pipedream_account_id=inbox.account_context;
 update public.provider_event_inbox set processing_state='processed',processed_at=pg_catalog.clock_timestamp(),safe_error=null,
   lease_token=null,lease_expires_at=null where id=p_event_id and processing_state='processing'
   and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>pg_catalog.clock_timestamp();
 if not found then raise exception 'stale Pipedream event fence' using errcode='40001'; end if;
 return true;
end $$;
revoke all on function public.apply_pipedream_calendar_event(uuid,uuid,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_pipedream_calendar_event(uuid,uuid,bigint,timestamptz) to service_role;
