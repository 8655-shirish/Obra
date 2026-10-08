-- Allow anon/authenticated reads of any live website_version on a live website
-- (multi-publish: more than one version can be live at once).

drop policy if exists website_versions_select_live on public.website_versions;
create policy website_versions_select_live on public.website_versions
  for select to anon, authenticated
  using (
    status = 'live'
    and exists (
      select 1 from public.websites w
      where w.id = website_id and w.status = 'live'
    )
  );
