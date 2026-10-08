-- Enumerate old direct uploads and verify that no website config still references them.
create or replace function public.direct_upload_storage_object_is_referenced(
  p_storage_path text
) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.website_versions version
    where version.config_json::text like ('%' || replace(replace(p_storage_path, '%', '\%'), '_', '\_') || '%') escape '\'
  );
$$;

revoke all on function public.direct_upload_storage_object_is_referenced(text)
  from public, anon, authenticated;
grant execute on function public.direct_upload_storage_object_is_referenced(text)
  to service_role;
