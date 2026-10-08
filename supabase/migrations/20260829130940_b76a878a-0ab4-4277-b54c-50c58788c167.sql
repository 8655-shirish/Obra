CREATE TABLE IF NOT EXISTS public.applied_repo_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  checksum text NOT NULL,
  actor text NOT NULL DEFAULT 'unknown',
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  checksum text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('dry_run', 'apply')),
  result text NOT NULL CHECK (result IN ('ok', 'error', 'rejected')),
  error_message text,
  sqlstate text,
  actor text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS migration_runs_lookup_idx
  ON public.migration_runs (name, checksum, mode, result, created_at DESC);

GRANT ALL ON public.applied_repo_migrations TO service_role;
GRANT ALL ON public.migration_runs TO service_role;

ALTER TABLE public.applied_repo_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_runs ENABLE ROW LEVEL SECURITY;

-- Deny-all by design: only trusted server-side (service_role) code touches these.
DROP POLICY IF EXISTS "no browser access to applied_repo_migrations" ON public.applied_repo_migrations;
CREATE POLICY "no browser access to applied_repo_migrations"
  ON public.applied_repo_migrations FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "no browser access to migration_runs" ON public.migration_runs;
CREATE POLICY "no browser access to migration_runs"
  ON public.migration_runs FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

-- Name is immutable once recorded.
CREATE OR REPLACE FUNCTION public.forbid_applied_repo_migration_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'applied_repo_migrations rows are immutable';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name OR NEW.checksum IS DISTINCT FROM OLD.checksum THEN
    RAISE EXCEPTION 'applied_repo_migrations name/checksum are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS applied_repo_migrations_immutable ON public.applied_repo_migrations;
CREATE TRIGGER applied_repo_migrations_immutable
  BEFORE UPDATE OR DELETE ON public.applied_repo_migrations
  FOR EACH ROW EXECUTE FUNCTION public.forbid_applied_repo_migration_mutation();

CREATE OR REPLACE FUNCTION public.apply_repo_migration(
  p_name text,
  p_checksum text,
  p_sql text,
  p_mode text,
  p_actor text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.applied_repo_migrations%ROWTYPE;
  v_err text;
  v_state text;
BEGIN
  IF p_mode NOT IN ('dry_run', 'apply') THEN
    RAISE EXCEPTION 'mode must be dry_run or apply';
  END IF;
  IF coalesce(trim(p_name), '') = '' OR coalesce(trim(p_checksum), '') = '' THEN
    RAISE EXCEPTION 'name and checksum are required';
  END IF;

  SELECT * INTO v_existing FROM public.applied_repo_migrations WHERE name = p_name;
  IF FOUND THEN
    INSERT INTO public.migration_runs (name, checksum, mode, result, error_message, actor)
    VALUES (p_name, p_checksum, p_mode, 'rejected', 'already applied', p_actor);
    RETURN jsonb_build_object(
      'status', CASE WHEN v_existing.checksum = p_checksum THEN 'already_applied' ELSE 'checksum_conflict' END,
      'appliedAt', v_existing.applied_at,
      'recordedChecksum', v_existing.checksum
    );
  END IF;

  IF p_mode = 'apply' AND NOT EXISTS (
    SELECT 1 FROM public.migration_runs
    WHERE name = p_name AND checksum = p_checksum AND mode = 'dry_run' AND result = 'ok'
  ) THEN
    INSERT INTO public.migration_runs (name, checksum, mode, result, error_message, actor)
    VALUES (p_name, p_checksum, 'apply', 'rejected', 'no successful dry run for this checksum', p_actor);
    RETURN jsonb_build_object('status', 'dry_run_required');
  END IF;

  BEGIN
    EXECUTE p_sql;
    IF p_mode = 'dry_run' THEN
      RAISE EXCEPTION '__DRY_RUN_ROLLBACK__';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    IF v_err = '__DRY_RUN_ROLLBACK__' THEN
      INSERT INTO public.migration_runs (name, checksum, mode, result, actor)
      VALUES (p_name, p_checksum, 'dry_run', 'ok', p_actor);
      RETURN jsonb_build_object('status', 'dry_run_ok');
    END IF;
    INSERT INTO public.migration_runs (name, checksum, mode, result, error_message, sqlstate, actor)
    VALUES (p_name, p_checksum, p_mode, 'error', v_err, v_state, p_actor);
    RETURN jsonb_build_object('status', 'error', 'sqlstate', v_state, 'message', v_err);
  END;

  INSERT INTO public.applied_repo_migrations (name, checksum, actor)
  VALUES (p_name, p_checksum, p_actor);
  INSERT INTO public.migration_runs (name, checksum, mode, result, actor)
  VALUES (p_name, p_checksum, 'apply', 'ok', p_actor);
  RETURN jsonb_build_object('status', 'applied');
END;
$$;

REVOKE ALL ON FUNCTION public.apply_repo_migration(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_repo_migration(text, text, text, text, text) TO service_role;