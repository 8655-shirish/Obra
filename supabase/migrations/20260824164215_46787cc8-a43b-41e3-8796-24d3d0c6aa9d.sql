create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.background_job_cron_requests (
  id bigint generated always as identity primary key,
  schedule_name text not null,
  request_id bigint not null unique,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  status_code integer,
  timed_out boolean,
  error_message text
);
revoke all on public.background_job_cron_requests from public, anon, authenticated;
grant select, insert, update, delete on public.background_job_cron_requests to service_role;
grant usage on sequence public.background_job_cron_requests_id_seq to service_role;
alter table public.background_job_cron_requests enable row level security;

do $$
declare existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job
    where jobname in ('obra-run-background-jobs', 'obra-sweep-add-video-orphans', 'obra-record-background-job-responses', 'obra-add-video-orphan-sweep')
       or command like '%/api/internal/run-jobs%'
       or command like '%/api/internal/sweep-add-video-orphans%'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'obra-record-background-job-responses', '* * * * *',
    $command$
      update public.background_job_cron_requests request
      set responded_at = response.created,
          status_code = response.status_code,
          timed_out = response.timed_out,
          error_message = response.error_msg
      from net._http_response response
      where response.id = request.request_id
        and request.responded_at is null;

      delete from public.background_job_cron_requests
      where requested_at < now() - interval '30 days';
    $command$
  );

  perform cron.schedule(
    'obra-run-background-jobs', '* * * * *',
    $command$
      insert into public.background_job_cron_requests(schedule_name, request_id)
      select 'obra-run-background-jobs', net.http_post(
        url := 'https://obratech.co/api/internal/run-jobs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'JOB_RUNNER_SECRET' limit 1), '')
        ),
        body := '{}'::jsonb, timeout_milliseconds := 55000
      );
    $command$
  );

  perform cron.schedule(
    'obra-sweep-add-video-orphans', '17 3 * * *',
    $command$
      insert into public.background_job_cron_requests(schedule_name, request_id)
      select 'obra-sweep-add-video-orphans', net.http_post(
        url := 'https://obratech.co/api/internal/sweep-add-video-orphans',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-add-video-orphan-sweeper-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'ADD_VIDEO_ORPHAN_SWEEPER_SECRET' limit 1), '')
        ),
        body := '{"dryRun":true}'::jsonb, timeout_milliseconds := 55000
      );
    $command$
  );
end
$$;

create or replace view public.background_job_cron_health
with (security_invoker = true) as
select
  schedule_name,
  request_id,
  requested_at,
  responded_at,
  status_code,
  timed_out,
  error_message,
  case
    when responded_at is null and requested_at < now() - interval '2 minutes' then 'missing_response'
    when responded_at is null then 'pending'
    when timed_out then 'timed_out'
    when status_code between 200 and 299 then 'succeeded'
    else 'failed'
  end as outcome
from public.background_job_cron_requests;
revoke all on public.background_job_cron_health from public, anon, authenticated;
grant select on public.background_job_cron_health to service_role;