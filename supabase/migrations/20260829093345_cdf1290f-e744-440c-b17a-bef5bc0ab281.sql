-- Close the schema-v4 publish TOCTOU by verifying the exact signed validation envelope
-- after the website-version row and attachment set are locked. Historical schema-v2/v3
-- publishing retains its revision/config/media snapshot contract and passes no attestation.

create or replace function public.bucket1_assert_schema_v4_publish_attestation(
  p_config_json jsonb,
  p_expected_revision bigint,
  p_generation_job_id uuid,
  p_validation_attestation jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  validation_input jsonb := p_config_json->'bucket1ValidationInput';
  stored_attestation jsonb := p_config_json->'bucket1ValidationAttestation';
  binding jsonb := p_validation_attestation->'binding';
  compile_policy jsonb;
  expected_compile_policy jsonb;
  sorted_attachments jsonb;
  sorted_resources jsonb;
  expected_binding_base jsonb;
  expected_binding jsonb;
  attestation_payload jsonb;
  attestation_hash text;
  attestation_secret text;
  attestation_key_id text;
  generation_epoch integer;
  generation_context_hash text;
  issued_at timestamptz;
  expires_at timestamptz;
  verified_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(p_config_json) is distinct from 'object'
     or p_config_json->>'generator' is distinct from 'unified-site-agent'
     or p_config_json->>'generatorSchemaVersion' is distinct from '4'
     or jsonb_typeof(validation_input) is distinct from 'object'
     or not validation_input ?& array[
       'generationContractEpoch','contextHash','candidateRevision','candidateConfigHash',
       'candidateSource','manifest','attachments','operationalPlan','hostProps','compilePolicy','resources'
     ]
     or validation_input - array[
       'generationContractEpoch','contextHash','candidateRevision','candidateConfigHash',
       'candidateSource','manifest','attachments','operationalPlan','hostProps','compilePolicy','resources'
     ] <> '{}'::jsonb
     or jsonb_typeof(stored_attestation) is distinct from 'object'
     or stored_attestation is distinct from p_validation_attestation
     or p_config_json->'validationAttestation' is distinct from p_validation_attestation
     or jsonb_typeof(p_validation_attestation) is distinct from 'object'
     or not p_validation_attestation ?& array[
       'schemaVersion','kind','binding','runtimeEvidenceHash','issuedAt','expiresAt',
       'issuerKeyId','attestationHash','signature'
     ]
     or p_validation_attestation - array[
       'schemaVersion','kind','binding','runtimeEvidenceHash','issuedAt','expiresAt',
       'issuerKeyId','attestationHash','signature'
     ] <> '{}'::jsonb
     or jsonb_typeof(p_validation_attestation->'schemaVersion') is distinct from 'number'
     or p_validation_attestation->>'schemaVersion' is distinct from '1'
     or jsonb_typeof(p_validation_attestation->'kind') is distinct from 'string'
     or p_validation_attestation->>'kind' is distinct from 'bucket1-validation-attestation'
     or jsonb_typeof(p_validation_attestation->'runtimeEvidenceHash') is distinct from 'string'
     or jsonb_typeof(p_validation_attestation->'issuedAt') is distinct from 'string'
     or jsonb_typeof(p_validation_attestation->'expiresAt') is distinct from 'string'
     or jsonb_typeof(p_validation_attestation->'issuerKeyId') is distinct from 'string'
     or jsonb_typeof(p_validation_attestation->'attestationHash') is distinct from 'string'
     or jsonb_typeof(p_validation_attestation->'signature') is distinct from 'string'
     or jsonb_typeof(binding) is distinct from 'object'
     or not binding ?& array[
       'generationContractEpoch','contextHash','candidateRevision','candidateConfigHash','sourceHash',
       'compilePolicyHash','manifestHash','attachmentHash','operationalPlanHash','hostPropsHash',
       'resourceSetHash','hostContractHash','validationContractHash','candidateBindingHash'
     ]
     or binding - array[
       'generationContractEpoch','contextHash','candidateRevision','candidateConfigHash','sourceHash',
       'compilePolicyHash','manifestHash','attachmentHash','operationalPlanHash','hostPropsHash',
       'resourceSetHash','hostContractHash','validationContractHash','candidateBindingHash'
     ] <> '{}'::jsonb
     or jsonb_typeof(binding->'generationContractEpoch') is distinct from 'number'
     or exists (
       select 1 from unnest(array[
         'contextHash','candidateRevision','candidateConfigHash','sourceHash','compilePolicyHash',
         'manifestHash','attachmentHash','operationalPlanHash','hostPropsHash','resourceSetHash',
         'hostContractHash','validationContractHash','candidateBindingHash'
       ]) binding_key
       where jsonb_typeof(binding->binding_key) is distinct from 'string'
     ) then
    raise exception 'Schema-v4 publish requires a current valid deterministic attestation' using errcode='P0001';
  end if;

  select job.generation_contract_epoch, job.generation_input_hash
  into generation_epoch, generation_context_hash
  from public.background_jobs job
  where job.id = p_generation_job_id;
  if not found or generation_epoch <> 2 or generation_context_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Schema-v4 publish requires a current valid deterministic attestation' using errcode='P0001';
  end if;

  compile_policy := validation_input->'compilePolicy';
  select jsonb_build_object(
    'kitScope','unified',
    'generatorSchemaVersion',4,
    'contactHidden',coalesce((p_config_json->>'contactHidden')::boolean,false),
    'operationalAnchors',coalesce(jsonb_agg(jsonb_build_object('slug',anchor.item->>'slug') order by anchor.ordinality)
      filter (where anchor.item is not null),'[]'::jsonb)
  )
  into expected_compile_policy
  from jsonb_array_elements(coalesce(
    p_config_json#>'{unifiedPlan,operationalIntent,operationalAnchors}',
    '[]'::jsonb
  )) with ordinality anchor(item,ordinality);

  if jsonb_typeof(validation_input->'attachments') is distinct from 'array'
     or jsonb_array_length(validation_input->'attachments') > 64
     or exists (
       select 1 from jsonb_array_elements(validation_input->'attachments') item
       where jsonb_typeof(item) is distinct from 'object'
          or not item ?& array['assetId','contentHash','mimeType','byteSize']
          or item - array['assetId','contentHash','mimeType','byteSize'] <> '{}'::jsonb
          or jsonb_typeof(item->'assetId') is distinct from 'string'
          or jsonb_typeof(item->'contentHash') is distinct from 'string'
          or jsonb_typeof(item->'mimeType') is distinct from 'string'
          or jsonb_typeof(item->'byteSize') is distinct from 'number'
          or nullif(item->>'assetId','') is null
          or item->>'contentHash' !~ '^[0-9a-f]{64}$'
          or nullif(item->>'mimeType','') is null
          or (item->>'byteSize')::numeric < 0
     )
     or exists (
       select item->>'assetId'
       from jsonb_array_elements(validation_input->'attachments') item
       group by item->>'assetId' having count(*) <> 1
     )
     or jsonb_typeof(validation_input->'resources') is distinct from 'array'
     or jsonb_array_length(validation_input->'resources') > 64
     or exists (
       select 1 from jsonb_array_elements(validation_input->'resources') item
       where jsonb_typeof(item) is distinct from 'object'
          or not item ?& array['logicalId','contentHash','mimeType','byteSize','kind']
          or item - array['logicalId','contentHash','mimeType','byteSize','kind'] <> '{}'::jsonb
          or jsonb_typeof(item->'logicalId') is distinct from 'string'
          or jsonb_typeof(item->'contentHash') is distinct from 'string'
          or jsonb_typeof(item->'mimeType') is distinct from 'string'
          or jsonb_typeof(item->'byteSize') is distinct from 'number'
          or jsonb_typeof(item->'kind') is distinct from 'string'
          or nullif(item->>'logicalId','') is null
          or item->>'contentHash' !~ '^[0-9a-f]{64}$'
          or nullif(item->>'mimeType','') is null
          or (item->>'byteSize')::numeric < 0
          or item->>'kind' not in ('image','font','video')
     )
     or exists (
       select item->>'logicalId'
       from jsonb_array_elements(validation_input->'resources') item
       group by item->>'logicalId' having count(*) <> 1
     ) then
    raise exception 'Schema-v4 publish requires a current valid deterministic attestation' using errcode='P0001';
  end if;

  select coalesce(jsonb_agg(item order by
    (item->>'assetId') collate "C", (item->>'contentHash') collate "C",
    (item->>'mimeType') collate "C", (item->>'byteSize')::numeric
  ),'[]'::jsonb)
  into sorted_attachments
  from jsonb_array_elements(validation_input->'attachments') item;

  select coalesce(jsonb_agg(item order by
    (item->>'logicalId') collate "C", (item->>'contentHash') collate "C",
    (item->>'mimeType') collate "C", (item->>'byteSize')::numeric, (item->>'kind') collate "C"
  ),'[]'::jsonb)
  into sorted_resources
  from jsonb_array_elements(validation_input->'resources') item;

  expected_binding_base := jsonb_build_object(
    'generationContractEpoch',generation_epoch,
    'contextHash',generation_context_hash,
    'candidateRevision',p_expected_revision::text,
    'candidateConfigHash',public.bucket1_canonical_hash(
      p_config_json - 'bucket1ValidationInput' - 'bucket1ValidationAttestation' - 'validationAttestation'
    ),
    'sourceHash',encode(extensions.digest(convert_to(p_config_json->>'themeSource','UTF8'),'sha256'),'hex'),
    'compilePolicyHash',public.bucket1_canonical_hash(compile_policy),
    'manifestHash',public.bucket1_canonical_hash(p_config_json->'mediaManifest'),
    'attachmentHash',public.bucket1_canonical_hash(sorted_attachments),
    'operationalPlanHash',public.bucket1_canonical_hash(p_config_json->'unifiedPlan'),
    'hostPropsHash',public.bucket1_canonical_hash(validation_input->'hostProps'),
    'resourceSetHash',public.bucket1_canonical_hash(sorted_resources),
    'hostContractHash','56252b35bf3aa5965c9137fab8a1a4e181d6e9b275856dcb33767fbcadea4f85',
    'validationContractHash','765f8d655208a5228f55b2e7316edf780b1f08c9e4810d7d839f21ef6ed58c10'
  );
  expected_binding := expected_binding_base || jsonb_build_object(
    'candidateBindingHash',public.bucket1_canonical_hash(expected_binding_base)
  );

  if validation_input->>'generationContractEpoch' is distinct from generation_epoch::text
     or validation_input->>'contextHash' is distinct from generation_context_hash
     or validation_input->>'candidateRevision' is distinct from p_expected_revision::text
     or validation_input->>'candidateConfigHash' is distinct from expected_binding->>'candidateConfigHash'
     or validation_input->>'candidateSource' is distinct from p_config_json->>'themeSource'
     or validation_input->'manifest' is distinct from p_config_json->'mediaManifest'
     or validation_input->'operationalPlan' is distinct from p_config_json->'unifiedPlan'
     or jsonb_typeof(compile_policy) is distinct from 'object'
     or compile_policy is distinct from expected_compile_policy
     or binding is distinct from expected_binding
     or p_validation_attestation->>'runtimeEvidenceHash' !~ '^[0-9a-f]{64}$'
     or p_validation_attestation->>'attestationHash' !~ '^[0-9a-f]{64}$'
     or p_validation_attestation->>'signature' !~ '^[0-9a-f]{64}$'
     or length(p_validation_attestation->>'issuerKeyId') > 128 then
    raise exception 'Schema-v4 publish requires a current valid deterministic attestation' using errcode='P0001';
  end if;

  begin
    issued_at := (p_validation_attestation->>'issuedAt')::timestamptz;
    expires_at := (p_validation_attestation->>'expiresAt')::timestamptz;
  exception when others then
    raise exception 'Schema-v4 publish requires a current valid deterministic attestation' using errcode='P0001';
  end;
  if issued_at > verified_at
     or expires_at <= verified_at
     or expires_at <= issued_at
     or expires_at > issued_at + interval '24 hours' then
    raise exception 'Schema-v4 publish requires a current valid deterministic attestation' using errcode='P0001';
  end if;

  select decrypted_secret into attestation_secret
  from vault.decrypted_secrets where name='BUCKET1_ATTESTATION_SECRET' limit 1;
  select decrypted_secret into attestation_key_id
  from vault.decrypted_secrets where name='BUCKET1_ATTESTATION_KEY_ID' limit 1;
  if nullif(attestation_secret,'') is null
     or length(attestation_secret) < 32
     or nullif(attestation_key_id,'') is null
     or p_validation_attestation->>'issuerKeyId' is distinct from attestation_key_id then
    raise exception 'Schema-v4 publish requires a current valid deterministic attestation' using errcode='P0001';
  end if;

  attestation_payload := p_validation_attestation - 'attestationHash' - 'signature';
  attestation_hash := public.bucket1_canonical_hash(attestation_payload);
  if p_validation_attestation->>'attestationHash' is distinct from attestation_hash
     or p_validation_attestation->>'signature' is distinct from encode(extensions.hmac(
       convert_to(attestation_hash,'UTF8'), convert_to(attestation_secret,'UTF8'), 'sha256'
     ),'hex') then
    raise exception 'Schema-v4 publish requires a current valid deterministic attestation' using errcode='P0001';
  end if;
end;
$$;

revoke all on function public.bucket1_assert_schema_v4_publish_attestation(jsonb,bigint,uuid,jsonb)
  from public,anon,authenticated,service_role;
comment on function public.bucket1_assert_schema_v4_publish_attestation(jsonb,bigint,uuid,jsonb) is
  'Internal schema-v4 publish verifier: exact closed bindings, canonical hashes, Vault HMAC key, and bounded current expiry.';

-- Remove every historical weak publish entry point before installing the attestation-carrying contract.
drop function if exists public.publish_website_version_owned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb);
drop function if exists public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb);
drop function if exists public.publish_website_version_atomic(uuid,uuid,bigint,jsonb);
drop function if exists public.publish_website_version_atomic(uuid,uuid,jsonb,jsonb);
drop function if exists public.publish_website_version_atomic(uuid,uuid,jsonb);
drop function if exists public.publish_website_version_atomic(uuid,uuid);

create function public.publish_website_version_atomic(
  p_website_id uuid,
  p_version_id uuid,
  p_expected_revision bigint,
  p_expected_config_json jsonb,
  p_expected_media_slots jsonb,
  p_validation_attestation jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.website_versions%rowtype;
  locked_media_slots jsonb;
  next_revision bigint;
  schema_version text;
begin
  select * into target
  from public.website_versions
  where id=p_version_id and website_id=p_website_id
  for update;
  if not found then raise exception 'Website version not found'; end if;
  if target.revision <> p_expected_revision then raise exception 'Website version revision conflict'; end if;
  if target.status not in ('draft','selected') then raise exception 'Website version is not publishable'; end if;
  if target.config_json is distinct from p_expected_config_json then
    raise exception 'Website version integrity check failed';
  end if;

  schema_version := target.config_json->>'generatorSchemaVersion';
  if schema_version = '4' and p_expected_media_slots is null then
    raise exception 'Schema-v4 publish requires a locked media attachment snapshot' using errcode='P0001';
  end if;
  if p_expected_media_slots is not null then
    select coalesce(jsonb_agg(to_jsonb(slot_row) order by slot_row.slot_id),'[]'::jsonb)
    into locked_media_slots
    from (
      select slot_id,asset_id,mime_type,role,provenance,required,
        source_slot_id,poster_slot_id,storage_path,proof_eligible
      from public.website_version_media_slots
      where website_id=p_website_id and version_id=p_version_id
      order by slot_id
      for update
    ) slot_row;
    if locked_media_slots is distinct from p_expected_media_slots then
      raise exception 'Website media attachment integrity check failed';
    end if;
  end if;

  if schema_version = '4' then
    if jsonb_typeof(target.config_json#>'{mediaManifest,slots}') is distinct from 'array'
       or jsonb_array_length(target.config_json#>'{mediaManifest,slots}') <> jsonb_array_length(locked_media_slots)
       or exists (
         select 1
         from jsonb_array_elements(target.config_json#>'{mediaManifest,slots}') manifest(slot)
         left join public.website_version_media_slots attached
           on attached.website_id=p_website_id and attached.version_id=p_version_id
          and attached.slot_id=manifest.slot->>'slotId'
         where attached.slot_id is null
            or nullif(manifest.slot->>'slotId','') is null
            or attached.asset_id is distinct from manifest.slot->>'assetId'
            or attached.mime_type is distinct from manifest.slot->>'mimeType'
            or attached.role is distinct from manifest.slot->>'role'
            or attached.provenance is distinct from manifest.slot->>'origin'
            or attached.required is distinct from coalesce((manifest.slot->>'required')::boolean,false)
            or attached.source_slot_id is distinct from nullif(manifest.slot->>'sourceSlotId','')
            or attached.poster_slot_id is distinct from nullif(manifest.slot->>'posterSlotId','')
            or attached.storage_path is distinct from manifest.slot->>'storagePath'
            or attached.proof_eligible is distinct from coalesce((manifest.slot->>'proofEligible')::boolean,false)
       )
       or exists (
         select manifest.slot->>'slotId'
         from jsonb_array_elements(target.config_json#>'{mediaManifest,slots}') manifest(slot)
         group by manifest.slot->>'slotId' having count(*) <> 1
       )
       or jsonb_array_length(target.config_json#>'{bucket1ValidationInput,attachments}') <> (
         select count(distinct manifest.slot->>'assetId')
         from jsonb_array_elements(target.config_json#>'{mediaManifest,slots}') manifest(slot)
       )
       or exists (
         select 1
         from jsonb_array_elements(target.config_json#>'{mediaManifest,slots}') manifest(slot)
         left join jsonb_array_elements(target.config_json#>'{bucket1ValidationInput,attachments}') attachment(item)
           on attachment.item->>'assetId'=manifest.slot->>'assetId'
          and attachment.item->>'contentHash'=manifest.slot->>'assetId'
          and attachment.item->>'mimeType'=manifest.slot->>'mimeType'
         where attachment.item is null
       )
       or jsonb_array_length(target.config_json#>'{bucket1ValidationInput,resources}') <> jsonb_array_length(locked_media_slots)
       or exists (
         select 1
         from jsonb_array_elements(target.config_json#>'{mediaManifest,slots}') manifest(slot)
         left join jsonb_array_elements(target.config_json#>'{bucket1ValidationInput,resources}') resource(item)
           on resource.item->>'logicalId'=manifest.slot->>'slotId'
          and resource.item->>'contentHash'=manifest.slot->>'assetId'
          and resource.item->>'mimeType'=manifest.slot->>'mimeType'
          and resource.item->>'kind'=case when manifest.slot->>'mimeType' like 'video/%' then 'video' else 'image' end
         left join jsonb_array_elements(target.config_json#>'{bucket1ValidationInput,attachments}') attachment(item)
           on attachment.item->>'assetId'=manifest.slot->>'assetId'
         where resource.item is null
            or (resource.item->>'byteSize')::numeric is distinct from (attachment.item->>'byteSize')::numeric
       ) then
      raise exception 'Schema-v4 publish manifest does not match locked media attachments' using errcode='P0001';
    end if;

    perform public.bucket1_assert_schema_v4_publish_attestation(
      target.config_json,target.revision,target.generation_job_id,p_validation_attestation
    );
  elsif p_validation_attestation is not null then
    raise exception 'Historical publish must not accept a schema-v4 validation attestation' using errcode='22023';
  end if;

  update public.website_versions
  set status='live',revision=revision+1,updated_at=clock_timestamp()
  where id=p_version_id and website_id=p_website_id and revision=p_expected_revision
  returning revision into next_revision;
  if next_revision is null then raise exception 'Website version revision conflict'; end if;

  update public.websites
  set status='live',active_version_id=p_version_id,updated_at=clock_timestamp()
  where id=p_website_id;
  if not found then raise exception 'Website not found'; end if;
  return next_revision;
end;
$$;

create function public.publish_website_version_owned(
  p_website_id uuid,
  p_trace_id uuid,
  p_owner_token uuid,
  p_version_id uuid,
  p_expected_revision bigint,
  p_expected_config_json jsonb,
  p_expected_media_slots jsonb,
  p_validation_attestation jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_agent_turn_owned(p_website_id,p_trace_id,p_owner_token);
  return public.publish_website_version_atomic(
    p_website_id,p_version_id,p_expected_revision,p_expected_config_json,
    p_expected_media_slots,p_validation_attestation
  );
end;
$$;

revoke all on function public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
revoke all on function public.publish_website_version_owned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb)
  to service_role;
grant execute on function public.publish_website_version_owned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb)
  to service_role;

comment on function public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb,jsonb) is
  'Publishes v2/v3 under historical snapshot CAS; publishes schema-v4 only after locked manifest parity plus canonical Vault-HMAC attestation verification in the same transaction.';
comment on function public.publish_website_version_owned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb) is
  'Agent-owned publish fence followed by the same transactional historical/schema-v4 publish contract.';