-- Template identity ids (phase 1 of slug -> id migration).
--
-- Adds canonical template_id beside template_slug on the purchase path and
-- backfills it from the registered slug mapping (see TEMPLATE_ID_BY_SLUG in
-- src/lib/template-content/overlay.ts — the SQL mapping below must match it).
--
-- App code dual-writes both columns and reads id-first with slug fallback,
-- tolerating a missing template_id column as "migration not yet applied", so
-- this migration may land before or after the app bundle with identical
-- behavior. Genuine write failures with template intent are loud (checkout
-- fails fast pre-payment); only the absent-column case degrades silently to
-- legacy behavior. Slug-column removal is a separate phase-2 change after
-- apply is confirmed on every environment (production AND isolated/test DBs).
-- Phase 2 must also: extend protect_template_slug_immutable to template_id,
-- switch getTemplateDraft / getWorkspaceBootstrap / EditMode keying to id,
-- retire the slug fallbacks and transitional casts, and regenerate DB types.

alter table public.checkout_sessions
  add column if not exists template_id text;
alter table public.websites
  add column if not exists template_id text;

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
