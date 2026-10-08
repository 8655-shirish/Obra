-- Template purchase capture (plan/template-purchase.md §4, §9).
--
-- Records which template slug was bought so Step 1 personalization can
-- instantiate the purchased mold as a user-owned version. Forward-only.
-- Local-only until reviewed, merged, explicitly confirmed, dry-run, applied.
--
-- Design notes:
-- * Slug columns are metadata, not paid identity: the existing
--   protect_paid_checkout_identity trigger is untouched and keeps guarding
--   its enumerated identity columns.
-- * Set-once guards below make slug assignment idempotent-safe to retry and
--   immune to later overwrite. Re-setting the identical value is allowed
--   (idempotent retry); changing a set value raises P0001.

alter table public.checkout_sessions
  add column if not exists template_slug text;

alter table public.websites
  add column if not exists template_slug text;

create or replace function public.protect_template_slug_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.template_slug is not null
     and new.template_slug is distinct from old.template_slug then
    raise exception 'template slug is immutable once set' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_template_slug_immutable() from public, anon, authenticated;
grant execute on function public.protect_template_slug_immutable() to service_role;

drop trigger if exists checkout_template_slug_immutable on public.checkout_sessions;
create trigger checkout_template_slug_immutable
  before update on public.checkout_sessions
  for each row execute function public.protect_template_slug_immutable();

drop trigger if exists websites_template_slug_immutable on public.websites;
create trigger websites_template_slug_immutable
  before update on public.websites
  for each row execute function public.protect_template_slug_immutable();
