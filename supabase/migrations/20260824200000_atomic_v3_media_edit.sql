create or replace function public.update_website_version_config_with_media_atomic(
  p_website_id uuid, p_version_id uuid, p_expected_revision bigint,
  p_config_json jsonb, p_category text, p_patch_json jsonb, p_media_slots jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare next_revision bigint;
begin
  if p_category is distinct from 'media' then raise exception 'Invalid media edit category'; end if;
  if p_config_json is null or jsonb_typeof(p_config_json) <> 'object'
     or p_config_json->>'generatorSchemaVersion' is distinct from '3'
  then raise exception 'Invalid schema-v3 config'; end if;
  if p_media_slots is null or jsonb_typeof(p_media_slots) <> 'array' or jsonb_array_length(p_media_slots) = 0 then
    raise exception 'Invalid media slot snapshot';
  end if;
  if p_config_json->'mediaManifest'->'slots' is distinct from p_media_slots then
    raise exception 'Media manifest and attachment snapshot differ';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_media_slots) as x(
      "slotId" text, "assetId" text, "storagePath" text, "mimeType" text,
      origin text, role text, required boolean, "proofEligible" boolean,
      "sourceSlotId" text, "posterSlotId" text
    )
    where nullif(x."slotId", '') is null
       or nullif(x."assetId", '') is null
       or nullif(x."storagePath", '') is null
       or nullif(x."mimeType", '') is null
       or x.origin is null or x.origin not in ('evidence', 'generated')
       or x."mimeType" not in ('image/png', 'image/jpeg', 'video/mp4')
       or x.role is null or x.role not in ('hero', 'proof', 'support', 'atmosphere', 'texture', 'motion-poster')
       or x."storagePath" not like (p_website_id::text || '/%')
       or x."storagePath" like '%..%'
       or x."storagePath" like '%\%'
       or x."storagePath" ~* '%(2f|5c|2e)'
       or (x.origin = 'generated' and x."storagePath" not like (p_website_id::text || '/generated/%'))
       or (x.origin = 'evidence' and x."storagePath" like (p_website_id::text || '/generated/%'))
       or (x.role = 'proof' and (x.origin <> 'evidence' or not coalesce(x."proofEligible", false)))
  ) then raise exception 'Invalid or unowned media attachment snapshot'; end if;
  if (select count(*) from jsonb_to_recordset(p_media_slots) as x("slotId" text)) <>
     (select count(distinct x."slotId") from jsonb_to_recordset(p_media_slots) as x("slotId" text))
  then raise exception 'Duplicate media slot identity'; end if;

  perform 1 from public.website_versions
  where id=p_version_id and website_id=p_website_id
    and status in ('draft', 'selected') and revision=p_expected_revision
  for update;
  if not found then raise exception 'Website version revision conflict'; end if;

  update public.website_versions
  set config_json=p_config_json, revision=revision+1, updated_at=now()
  where id=p_version_id and website_id=p_website_id
    and status in ('draft', 'selected') and revision=p_expected_revision
  returning revision into next_revision;

  delete from public.website_version_media_slots where version_id=p_version_id and website_id=p_website_id;
  insert into public.website_version_media_slots
    (version_id, website_id, slot_id, asset_id, storage_path, mime_type, provenance, role, required, proof_eligible, source_slot_id, poster_slot_id)
  select p_version_id, p_website_id, x."slotId", x."assetId", x."storagePath", x."mimeType",
         x.origin, x.role, coalesce(x.required,false), coalesce(x."proofEligible",false), x."sourceSlotId", x."posterSlotId"
  from jsonb_to_recordset(p_media_slots) as x(
    "slotId" text, "assetId" text, "storagePath" text, "mimeType" text, origin text,
    role text, required boolean, "proofEligible" boolean, "sourceSlotId" text, "posterSlotId" text
  );
  insert into public.website_edit_events(website_id,version_id,category,patch_json)
  values(p_website_id,p_version_id,p_category,coalesce(p_patch_json,'{}'::jsonb));
  return next_revision;
end; $$;
revoke all on function public.update_website_version_config_with_media_atomic(uuid,uuid,bigint,jsonb,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.update_website_version_config_with_media_atomic(uuid,uuid,bigint,jsonb,text,jsonb,jsonb) to service_role;
