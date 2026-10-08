-- Backfill template identity for purchases made before capture existed.
--
-- Pre-capture catalog buys left websites.template_slug / template_id NULL, so
-- /login resolved the oldest website into the agent workbench and Pro checkout
-- fell through to /setup. Identity already stored on a checkout session is
-- copied first (any registered template). Remaining purchased, versionless,
-- still-untagged websites are tagged as /templates/painter (tpl_painter) —
-- the operator-confirmed pre-capture catalog purchase. Agent-built sites
-- (they have versions) and unpurchased ensureWebsite drafts (no entitlement
-- and no completed checkout) are left untouched.
--
-- Set-once triggers allow NULL → value and same-value retries; they reject a
-- change of an already-set identity. This migration never overwrites a
-- non-null slug or id.
--
-- Local-only until reviewed, merged, explicitly confirmed, dry-run, applied.

-- 1. Copy the latest identity-bearing checkout session onto its website.
with session_identity as (
  select distinct on (cs.website_id)
    cs.website_id,
    cs.template_slug,
    cs.template_id
  from public.checkout_sessions cs
  where cs.website_id is not null
    and (cs.template_slug is not null or cs.template_id is not null)
  order by
    cs.website_id,
    cs.completed_at desc nulls last,
    cs.created_at desc
)
update public.websites w
set
  template_slug = coalesce(w.template_slug, si.template_slug),
  template_id = coalesce(w.template_id, si.template_id)
from session_identity si
where w.id = si.website_id
  and (
    (w.template_slug is null and si.template_slug is not null)
    or (w.template_id is null and si.template_id is not null)
  );

-- 2. Fill template_id from a known slug when the id column is still null.
--    Mapping matches TEMPLATE_ID_BY_SLUG / 20260907130000.
update public.websites
set template_id = case template_slug
  when 'landscape' then 'tpl_landscape'
  when 'plumber' then 'tpl_plumber'
  when 'painter' then 'tpl_painter'
  when 'painter2' then 'tpl_painter2'
  when 'painter3' then 'tpl_painter3'
  when 'painter4' then 'tpl_painter4'
  when 'painter5' then 'tpl_painter5'
  when 'painter6' then 'tpl_painter6'
  when 'painter7' then 'tpl_painter7'
  when 'painter8' then 'tpl_painter8'
  when 'painter1' then 'tpl_painter1'
  when 'painter10' then 'tpl_painter10'
  when 'painter11' then 'tpl_painter11'
  when 'painter12' then 'tpl_painter12'
  else template_id
end
where template_slug is not null
  and template_id is null;

update public.checkout_sessions
set template_id = case template_slug
  when 'landscape' then 'tpl_landscape'
  when 'plumber' then 'tpl_plumber'
  when 'painter' then 'tpl_painter'
  when 'painter2' then 'tpl_painter2'
  when 'painter3' then 'tpl_painter3'
  when 'painter4' then 'tpl_painter4'
  when 'painter5' then 'tpl_painter5'
  when 'painter6' then 'tpl_painter6'
  when 'painter7' then 'tpl_painter7'
  when 'painter8' then 'tpl_painter8'
  when 'painter1' then 'tpl_painter1'
  when 'painter10' then 'tpl_painter10'
  when 'painter11' then 'tpl_painter11'
  when 'painter12' then 'tpl_painter12'
  else template_id
end
where template_slug is not null
  and template_id is null;

-- 3. Pre-capture catalog purchases: versionless, purchased, still untagged.
update public.websites w
set
  template_slug = 'painter',
  template_id = 'tpl_painter'
where w.template_slug is null
  and w.template_id is null
  and not exists (
    select 1 from public.website_versions v where v.website_id = w.id
  )
  and (
    exists (
      select 1
      from public.website_entitlements e
      where e.website_id = w.id
        and e.state in ('active', 'grace')
    )
    or exists (
      select 1
      from public.checkout_sessions cs
      where cs.website_id = w.id
        and cs.status = 'completed'
    )
  );

-- 4. Mirror website identity onto still-untagged checkout sessions for the
--    same site so leftover /checkout/success and OTP routing see intent.
update public.checkout_sessions cs
set
  template_slug = w.template_slug,
  template_id = w.template_id
from public.websites w
where cs.website_id = w.id
  and w.template_slug is not null
  and w.template_id is not null
  and cs.template_slug is null
  and cs.template_id is null;
