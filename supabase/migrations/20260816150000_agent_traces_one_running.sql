-- One in-flight agent turn per website. Close leftover running rows so the unique
-- index can apply on existing data.

update public.agent_traces
set
  status = 'error',
  error_message = coalesce(error_message, 'stale running trace'),
  completed_at = coalesce(completed_at, now())
where status = 'running'
  and started_at < now() - interval '10 minutes';

update public.agent_traces as t
set
  status = 'error',
  error_message = coalesce(t.error_message, 'superseded running trace'),
  completed_at = coalesce(t.completed_at, now())
where t.status = 'running'
  and t.id not in (
    select kept.id
    from (
      select distinct on (website_id) id
      from public.agent_traces
      where status = 'running'
      order by website_id, started_at desc
    ) as kept
  );

create unique index if not exists agent_traces_one_running_per_website
  on public.agent_traces (website_id)
  where status = 'running';
