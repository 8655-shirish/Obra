-- Publish a validated website version atomically so callers cannot observe a half-published state.
create or replace function public.publish_website_version_atomic(
  p_website_id uuid,
  p_version_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.website_versions
    where id = p_version_id and website_id = p_website_id
  ) then
    raise exception 'Website version not found';
  end if;

  update public.website_versions
  set status = 'live', updated_at = now()
  where id = p_version_id and website_id = p_website_id;

  update public.websites
  set status = 'live', active_version_id = p_version_id, updated_at = now()
  where id = p_website_id;

  if not found then
    raise exception 'Website not found';
  end if;
end;
$$;

revoke all on function public.publish_website_version_atomic(uuid, uuid) from public;
grant execute on function public.publish_website_version_atomic(uuid, uuid) to service_role;