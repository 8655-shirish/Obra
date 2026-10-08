-- Schema-v4 Add Video mutates the selected version in place. Reinstall its finalizer so the
-- same transaction that locks the job/version/media row also verifies the fresh Bucket 1
-- attestation for the exact post-edit config and revision. Historical v2/v3 history is unchanged.

do $patch$
declare definition text;
begin
  select pg_get_functiondef('public.commit_add_video_to_version_historical_body(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)'::regprocedure)
  into definition;

  if position('perform public.bucket1_assert_schema_v4_publish_attestation(' in definition) > 0 then
    return;
  end if;
  if position(
    $$elsif p_config_json->>'generatorSchemaVersion' = '4' then$$ in definition
  ) = 0 or position(
    $$    perform public.assert_add_video_v4_candidate_anchor(p_job_id, p_config_json);$$ in definition
  ) = 0 then
    raise exception 'Unexpected Add Video finalizer definition; refusing unsafe attestation patch';
  end if;

  definition := replace(
    definition,
    $$    perform public.assert_add_video_v4_candidate_anchor(p_job_id, p_config_json);$$,
    $$    perform public.assert_add_video_v4_candidate_anchor(p_job_id, p_config_json);
    perform public.bucket1_assert_schema_v4_publish_attestation(
      p_config_json, p_expected_revision + 1, (
        select origin.generation_job_id from public.website_versions origin
        where origin.id = claimed_job.source_version_id and origin.website_id = p_website_id
      ),
      p_config_json->'bucket1ValidationAttestation'
    );$$
  );
  execute definition;
end;
$patch$;

revoke all on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)
  to service_role;
comment on function public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb) is
  'Attempts-fenced schema-v4 Add Video finalizer; atomically checks attachment/ledger parity and the exact fresh Bucket 1 attestation for the incremented revision.';