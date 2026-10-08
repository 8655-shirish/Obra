-- Keep future active-version pointers within their owning website. NOT VALID avoids
-- making rollout depend on repairing unrelated historical rows; new writes are enforced.
create unique index website_versions_id_website_id_idx
  on public.website_versions (id, website_id);

alter table public.websites
  add constraint websites_active_version_ownership_fk
  foreign key (active_version_id, id)
  references public.website_versions (id, website_id)
  not valid;

-- Sample current live versions with website/version ownership equality, without exposing config_json.
create index websites_live_active_updated_idx
  on public.websites (updated_at desc, id desc)
  where status = 'live' and active_version_id is not null;

create or replace function public.list_cross_website_layout_fingerprints(
  p_website_id uuid,
  p_limit integer default 12
) returns table(id uuid, version_number integer, layout_fingerprint text)
language sql
stable
security definer
set search_path = public
as $$
  select versions.id,
    versions.version_number,
    versions.config_json->>'layoutFingerprint' as layout_fingerprint
  from public.websites sampled_website
  join public.website_versions versions
    on versions.id = sampled_website.active_version_id
   and versions.website_id = sampled_website.id
   and versions.status = 'live'
  where sampled_website.id <> p_website_id
    and sampled_website.status = 'live'
    and sampled_website.active_version_id is not null
  order by sampled_website.updated_at desc, sampled_website.id desc
  limit least(greatest(coalesce(p_limit, 12), 0), 12);
$$;

revoke all on function public.list_cross_website_layout_fingerprints(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_cross_website_layout_fingerprints(uuid, integer)
  to service_role;
