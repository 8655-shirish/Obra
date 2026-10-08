-- Read a version config and its attachment rows from one PostgreSQL statement snapshot.
create or replace function public.get_website_version_media_snapshot(
  p_website_id uuid, p_version_id uuid, p_revision bigint
) returns table(config_json jsonb, revision bigint, media_slots jsonb)
language sql security definer set search_path = public stable as $$
  select version.config_json, version.revision,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'slot_id', slot.slot_id,
        'asset_id', slot.asset_id,
        'storage_path', slot.storage_path,
        'mime_type', slot.mime_type,
        'provenance', slot.provenance,
        'role', slot.role,
        'required', slot.required,
        'proof_eligible', slot.proof_eligible,
        'source_slot_id', slot.source_slot_id,
        'poster_slot_id', slot.poster_slot_id
      ) order by slot.slot_id)
      from public.website_version_media_slots slot
      where slot.website_id = version.website_id and slot.version_id = version.id
    ), '[]'::jsonb)
  from public.website_versions version
  where version.website_id = p_website_id
    and version.id = p_version_id
    and version.revision = p_revision;
$$;
revoke all on function public.get_website_version_media_snapshot(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.get_website_version_media_snapshot(uuid,uuid,bigint) to service_role;