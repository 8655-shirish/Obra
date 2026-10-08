-- Pre-capture template identity backfill (migration 20260907200000).
-- Fixtures use 94-prefix ids to avoid the 91/92/93 fixtures.
-- Sentinel failures use P9999 so P0001 handlers only catch trigger violations.

-- Shared owner for four websites:
--   A: session already has painter11 identity, website untagged, entitled, no versions
--      → copy painter11, never the painter default
--   B: untagged, entitled, no versions, untagged completed checkout
--      → painter / tpl_painter
--   C: untagged, entitled, HAS a version (agent-built)
--      → stays null
--   D: untagged, no entitlement, no completed checkout (ensureWebsite draft)
--      → stays null

insert into public.profiles(id,license_number,email,full_name,business_name,city,environment) values
('94000000-0000-0000-0000-000000000001','TPL-BACKFILL-1','tpl-backfill-1@example.com','Tpl Backfill','Tpl Backfill LLC','Austin','test');

insert into public.websites(id,user_id,status,onboarding_state,environment) values
('94000000-0000-0000-0000-00000000000a','94000000-0000-0000-0000-000000000001','draft','{}','test'),
('94000000-0000-0000-0000-00000000000b','94000000-0000-0000-0000-000000000001','draft','{}','test'),
('94000000-0000-0000-0000-00000000000c','94000000-0000-0000-0000-000000000001','draft','{}','test'),
('94000000-0000-0000-0000-00000000000d','94000000-0000-0000-0000-000000000001','draft','{}','test');

insert into public.subscriptions(id,user_id,plan,status,environment) values
('94000000-0000-0000-0000-00000000001a','94000000-0000-0000-0000-000000000001','pro','active','test'),
('94000000-0000-0000-0000-00000000001b','94000000-0000-0000-0000-000000000001','pro','active','test'),
('94000000-0000-0000-0000-00000000001c','94000000-0000-0000-0000-000000000001','pro','active','test');

insert into public.website_entitlements(id,profile_id,website_id,subscription_id,environment,plan,state,booking_admission,quote_admission,effective_at) values
('94000000-0000-0000-0000-00000000002a','94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-00000000000a','94000000-0000-0000-0000-00000000001a','test','pro','active',true,false,now()),
('94000000-0000-0000-0000-00000000002b','94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-00000000000b','94000000-0000-0000-0000-00000000001b','test','pro','active',true,false,now()),
('94000000-0000-0000-0000-00000000002c','94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-00000000000c','94000000-0000-0000-0000-00000000001c','test','pro','active',true,false,now());

insert into public.checkout_sessions(id,profile_id,website_id,environment,license_number,email,full_name,business_name,city,context_json,status,subscription_id,plan,stripe_checkout_session_id,template_slug,template_id) values
('94000000-0000-0000-0000-00000000003a','94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-00000000000a','test','TPL-BACKFILL-1','tpl-backfill-1@example.com','Tpl Backfill','Tpl Backfill LLC','Austin','{}','completed','94000000-0000-0000-0000-00000000001a','pro',null,'painter11','tpl_painter11'),
('94000000-0000-0000-0000-00000000003b','94000000-0000-0000-0000-000000000001','94000000-0000-0000-0000-00000000000b','test','TPL-BACKFILL-1','tpl-backfill-1@example.com','Tpl Backfill','Tpl Backfill LLC','Austin','{}','completed','94000000-0000-0000-0000-00000000001b','pro',null,null,null);

insert into public.website_versions(id,website_id,version_number,config_json,variant_key,status) values
('94000000-0000-0000-0000-00000000004c','94000000-0000-0000-0000-00000000000c',1,'{}','agent-built','draft');

\ir ../migrations/20260907200000_backfill_pre_capture_template_identity.sql

do $$
declare
  v_slug text;
  v_id text;
begin
  select template_slug, template_id into v_slug, v_id
  from public.websites where id = '94000000-0000-0000-0000-00000000000a';
  if v_slug is distinct from 'painter11' or v_id is distinct from 'tpl_painter11' then
    raise exception 'site A should copy session painter11, got % / %', v_slug, v_id using errcode = 'P9999';
  end if;

  select template_slug, template_id into v_slug, v_id
  from public.websites where id = '94000000-0000-0000-0000-00000000000b';
  if v_slug is distinct from 'painter' or v_id is distinct from 'tpl_painter' then
    raise exception 'site B should default to painter, got % / %', v_slug, v_id using errcode = 'P9999';
  end if;

  select template_slug into v_slug from public.checkout_sessions where id = '94000000-0000-0000-0000-00000000003b';
  if v_slug is distinct from 'painter' then
    raise exception 'session B should mirror website painter, got %', v_slug using errcode = 'P9999';
  end if;

  select template_slug, template_id into v_slug, v_id
  from public.websites where id = '94000000-0000-0000-0000-00000000000c';
  if v_slug is not null or v_id is not null then
    raise exception 'site C (has versions) must stay untagged, got % / %', v_slug, v_id using errcode = 'P9999';
  end if;

  select template_slug, template_id into v_slug, v_id
  from public.websites where id = '94000000-0000-0000-0000-00000000000d';
  if v_slug is not null or v_id is not null then
    raise exception 'site D (unpurchased draft) must stay untagged, got % / %', v_slug, v_id using errcode = 'P9999';
  end if;
end $$;

-- Replay is a no-op (idempotent) and must not trip set-once.
\ir ../migrations/20260907200000_backfill_pre_capture_template_identity.sql

do $$
declare
  v_slug text;
begin
  select template_slug into v_slug from public.websites where id = '94000000-0000-0000-0000-00000000000a';
  if v_slug is distinct from 'painter11' then
    raise exception 'replay must not retag site A' using errcode = 'P9999';
  end if;
end $$;

delete from public.website_versions where id = '94000000-0000-0000-0000-00000000004c';
delete from public.checkout_sessions where id in ('94000000-0000-0000-0000-00000000003a','94000000-0000-0000-0000-00000000003b');
delete from public.website_entitlements where id in ('94000000-0000-0000-0000-00000000002a','94000000-0000-0000-0000-00000000002b','94000000-0000-0000-0000-00000000002c');
delete from public.subscriptions where id in ('94000000-0000-0000-0000-00000000001a','94000000-0000-0000-0000-00000000001b','94000000-0000-0000-0000-00000000001c');
delete from public.websites where id in (
  '94000000-0000-0000-0000-00000000000a',
  '94000000-0000-0000-0000-00000000000b',
  '94000000-0000-0000-0000-00000000000c',
  '94000000-0000-0000-0000-00000000000d'
);
delete from public.profiles where id = '94000000-0000-0000-0000-000000000001';
