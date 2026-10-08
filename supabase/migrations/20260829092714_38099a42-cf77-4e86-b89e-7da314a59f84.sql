-- Bucket 1 lifecycle audit: retire final-state overloads that bypass epoch-2 fences.
-- Historical rows remain readable; only obsolete execution entry points are removed.

-- The final four-argument claim owns scheduler-run attribution, customer caps, and
-- reconciliation exclusion. No epoch-2 worker may claim through the earlier overload.
revoke all on function public.claim_next_background_job(text,timestamptz)
  from public, anon, authenticated, service_role;
drop function if exists public.claim_next_background_job(text,timestamptz);

revoke all on function public.claim_next_background_job(text,timestamptz,integer)
  from public, anon, authenticated, service_role;
drop function if exists public.claim_next_background_job(text,timestamptz,integer);

-- These pre-capacity overloads lack reservation/provider/request identity and can settle an
-- indeterminate provider effect without reconciliation. The reservation-fenced overloads in
-- 20260828121000 are the sole epoch-2 provider-effect path.
revoke all on function public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text)
  from public, anon, authenticated, service_role;
drop function if exists public.reserve_generation_media_create_epoch(uuid,uuid,bigint,text,text);

revoke all on function public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,text,text,text)
  from public, anon, authenticated, service_role;
drop function if exists public.record_generation_media_operation_epoch(uuid,uuid,bigint,text,text,text,text);

revoke all on function public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,text)
  from public, anon, authenticated, service_role;
drop function if exists public.settle_generation_media_slot_epoch(uuid,uuid,bigint,text,text,text,text,text);

-- This attempts-shaped adapter emits schemaVersion 1 while the authoritative epoch writer
-- requires schemaVersion 2. Remove the misleading service entry point rather than preserving a
-- fail-late compatibility surface.
revoke all on function public.yield_site_generation_stage(uuid,integer,text,integer,text)
  from public, anon, authenticated, service_role;
drop function if exists public.yield_site_generation_stage(uuid,integer,text,integer,text);