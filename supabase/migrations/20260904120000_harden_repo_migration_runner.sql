-- Serialize the authenticated migration runner before its first ledger read. This forward-only
-- replacement prevents concurrent callers from executing the same or differently named SQL out
-- of order before the immutable ledger can record the result. Apply this bootstrap migration
-- through the existing runner only in a single operator session.
create or replace function public.apply_repo_migration(
  p_name text,
  p_checksum text,
  p_sql text,
  p_mode text,
  p_actor text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.applied_repo_migrations%rowtype;
  v_err text;
  v_state text;
begin
  if p_mode not in ('dry_run', 'apply') then
    raise exception 'mode must be dry_run or apply';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_checksum), '') = '' then
    raise exception 'name and checksum are required';
  end if;

  -- One global lock deliberately also orders distinct migration names. It is acquired outside
  -- the nested EXECUTE exception block and held through all ledger reads and writes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('repo-migration-runner-v2', 0)
  );

  select * into v_existing
  from public.applied_repo_migrations
  where name = p_name;
  if found then
    insert into public.migration_runs (name, checksum, mode, result, error_message, actor)
    values (p_name, p_checksum, p_mode, 'rejected', 'already applied', p_actor);
    return jsonb_build_object(
      'status', case when v_existing.checksum = p_checksum then 'already_applied' else 'checksum_conflict' end,
      'appliedAt', v_existing.applied_at,
      'recordedChecksum', v_existing.checksum
    );
  end if;

  if p_mode = 'apply' and not exists (
    select 1
    from public.migration_runs
    where name = p_name and checksum = p_checksum and mode = 'dry_run' and result = 'ok'
  ) then
    insert into public.migration_runs (name, checksum, mode, result, error_message, actor)
    values (p_name, p_checksum, 'apply', 'rejected', 'no successful dry run for this checksum', p_actor);
    return jsonb_build_object('status', 'dry_run_required');
  end if;

  begin
    execute p_sql;
    if p_mode = 'dry_run' then
      raise exception '__DRY_RUN_ROLLBACK__';
    end if;
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    if v_err = '__DRY_RUN_ROLLBACK__' then
      insert into public.migration_runs (name, checksum, mode, result, actor)
      values (p_name, p_checksum, 'dry_run', 'ok', p_actor);
      return jsonb_build_object('status', 'dry_run_ok');
    end if;
    insert into public.migration_runs (name, checksum, mode, result, error_message, sqlstate, actor)
    values (p_name, p_checksum, p_mode, 'error', v_err, v_state, p_actor);
    return jsonb_build_object('status', 'error', 'sqlstate', v_state, 'message', v_err);
  end;

  insert into public.applied_repo_migrations (name, checksum, actor)
  values (p_name, p_checksum, p_actor);
  insert into public.migration_runs (name, checksum, mode, result, actor)
  values (p_name, p_checksum, 'apply', 'ok', p_actor);
  return jsonb_build_object('status', 'applied');
end;
$$;

revoke all on function public.apply_repo_migration(text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.apply_repo_migration(text, text, text, text, text) to service_role;
