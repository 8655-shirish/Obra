DO $$
DECLARE
  keep text[] := ARRAY[
    'applied_repo_migrations','migration_runs','data_retention_policies',
    'generation_media_provider_limits','saas_offer_contracts','saas_offer_contract_installations',
    'background_job_runner_capabilities','admin_bootstrap_state','admin_auth_audit_events'
  ];
  tbls text;
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relname = ANY(keep))
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', r.relname);
  END LOOP;

  SELECT string_agg(format('public.%I', c.relname), ', ')
    INTO tbls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relname = ANY(keep));

  EXECUTE 'TRUNCATE TABLE ' || tbls || ' RESTART IDENTITY CASCADE';

  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT (c.relname = ANY(keep))
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', r.relname);
  END LOOP;
END $$;