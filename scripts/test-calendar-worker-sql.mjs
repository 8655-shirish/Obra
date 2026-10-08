import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

// Focused real-PostgreSQL test. Inert platform stubs only; no inherited DB credentials,
// extension workers, existing database, or hosted access.
const root = process.cwd();
const directory = await mkdtemp(path.join(root, ".calendar-sql-test-"));
const data = path.join(directory, "pgdata");
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("PG")),
);
env.LC_ALL = "C";
// Darwin AF_UNIX paths cannot fit the owned worktree path; use only loopback on
// an ephemeral port, and never connect unless our disposable server started.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
env.PGHOST = "127.0.0.1";
env.PGPORT = String(port);
env.PGDATABASE = "postgres";
env.PGUSER = "calendar_test";
let started = false;
function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, env, input, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(command + " failed\n" + (result.stdout ?? "") + (result.stderr ?? ""));
  }
  return result.stdout;
}
function sql(input) {
  assert.ok(started, "Never connect before our own disposable server starts");
  return run("psql", ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-Atq"], input).trim();
}
function file(name, role) {
  assert.ok(started);
  return run("psql", [
    "-X",
    "-w",
    "-v",
    "ON_ERROR_STOP=1",
    "-q",
    ...(role ? ["-c", `set role ${role}`] : []),
    "-f",
    name,
  ]);
}
try {
  run("initdb", ["-D", data, "-A", "trust", "-U", "calendar_test", "--no-locale"]);
  try {
    run("pg_ctl", [
      "-D",
      data,
      "-o",
      `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`,
      "-l",
      path.join(directory, "postgres.log"),
      "start",
    ]);
  } catch (error) {
    throw new Error(
      String(error) + "\n" + (await readFile(path.join(directory, "postgres.log"), "utf8")),
    );
  }
  started = true;
  sql(`
    create role anon; create role authenticated; create role service_role; create role booking_worker;
    create role migration_owner login createrole nosuperuser nocreatedb noreplication nobypassrls noinherit;
    create role calendar_extension_owner nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
    grant usage,create on schema public to migration_owner;
    create schema cron authorization calendar_extension_owner;
    create schema net authorization calendar_extension_owner;
    create schema vault authorization calendar_extension_owner;
    set role calendar_extension_owner;
    create table cron.job(jobid bigint generated always as identity primary key,jobname name,command text,
      schedule text,active boolean default true,username text default current_user,unique(jobname,username));
    grant select on cron.job to public;
    alter table cron.job enable row level security;
    create policy cron_job_policy on cron.job using(username=current_user);
    -- Inert equivalents of C's internal extension-owner switch, after capturing/checking the caller.
    create function cron.fixture_schedule(p_name text,p_schedule text,p_command text,p_user text)
    returns bigint language plpgsql security definer set search_path='' as $$
    declare id bigint;begin insert into cron.job(jobname,command,schedule,username) values(p_name,p_command,p_schedule,p_user)
      on conflict(jobname,username) do update set command=excluded.command,schedule=excluded.schedule,active=true returning jobid into id;
      return id;end $$;
    create function cron.schedule(p_name text,p_schedule text,p_command text) returns bigint language sql as $$
      select cron.fixture_schedule(p_name,p_schedule,p_command,current_user::text) $$;
    create function cron.fixture_alter(p_job_id bigint,p_active boolean)
    returns void language sql security definer set search_path='' as $$
      update cron.job set active=p_active where jobid=p_job_id $$;
    create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,
      username text default null,active boolean default null) returns void language plpgsql as $$begin
      if username is not null then raise exception 'fixture forbids owner changes';end if;
      if not exists(select 1 from cron.job j where j.jobid=job_id and j.username=current_user) then
        raise exception 'Job does not exist or you do not own it' using errcode='42501';end if;
      perform cron.fixture_alter(job_id,active);end $$;
    revoke all on function cron.alter_job(bigint,text,text,text,text,boolean) from public;
    create table net._http_response(id bigint,status_code integer,content text,timed_out boolean,created timestamptz default now());
    create table vault.decrypted_secrets(id uuid default gen_random_uuid(),name text unique,decrypted_secret text);
    grant usage on schema net,vault to migration_owner;
    grant select on net._http_response,vault.decrypted_secrets to migration_owner;
    reset role;
    set role migration_owner;
    create table public.background_job_cron_requests(id bigint generated always as identity primary key,schedule_name text not null,
      request_id bigint not null unique,requested_at timestamptz not null default now(),responded_at timestamptz,status_code integer,timed_out boolean,error_message text);
    create view public.background_job_cron_health with(security_invoker=true) as select schedule_name,request_id,requested_at,responded_at,status_code,timed_out,error_message,'pending'::text as outcome
      from public.background_job_cron_requests;
    create table public.profiles(id uuid primary key,environment text not null,license_number text,auth_user_id uuid,unique(id,environment));
    create table public.stripe_connected_accounts(id uuid primary key default gen_random_uuid(),profile_id uuid not null,environment text not null,
      stripe_account_id text,onboarding_state text not null default 'not_started',charges_enabled boolean default false,payouts_enabled boolean default false,
      details_submitted boolean default false,capabilities jsonb default '{}',requirements jsonb default '{}',reconnect_reason text,
      configuration jsonb default '{}',last_verified_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),
      unique(profile_id,environment),foreign key(profile_id,environment) references public.profiles(id,environment));
    create table public.provider_event_inbox(id uuid primary key default gen_random_uuid(),environment text,provider text,event_id text,livemode boolean,payload_hash text,payload jsonb,event_family text,event_type text,
      profile_id uuid,account_context text,processing_state text,lease_token uuid,fencing_token bigint,lease_expires_at timestamptz,processed_at timestamptz,safe_error text);
    create table public.calendar_connections(id uuid primary key,profile_id uuid,environment text,last_verified_at timestamptz,created_at timestamptz,
      pipedream_account_id text,connection_revision bigint,disconnected_at timestamptz,verification_reason text,reconnect_reason text);
    create table public.pipedream_bindings(id uuid,connection_id uuid,profile_id uuid,environment text,pipedream_account_id text,configuration_revision bigint,
      trigger_state text,updated_at timestamptz,reconciliation_due_at timestamptz,reconciliation_lease_expires_at timestamptz,reconciliation_attempts integer,safe_error text,reconciliation_reason text);
    create table public.booking_provider_account_disconnects_v3(profile_id uuid,environment text,provider text,provider_account_id text,state text);
    create table public.booking_worker_family_leases_v3(environment text,family text,last_started_at timestamptz,last_completed_at timestamptz,last_success boolean);
    create table public.appointments(id uuid primary key default gen_random_uuid(),profile_id uuid,environment text,
      appointment_state text default 'confirmed',payment_state text default 'paid',calendar_state text default 'create_pending',
      review_state text default 'none',confirmed_at timestamptz,cancellation_requested_at timestamptz,cancelled_at timestamptz,
      created_at timestamptz default now(),unique(id,profile_id,environment));
    create table public.calendar_event_links(id uuid primary key default gen_random_uuid(),appointment_id uuid,profile_id uuid,
      environment text,reconcile_status text,failure_kind text,reconcile_lease_expires_at timestamptz);
    create table public.booking_notifications(id uuid primary key default gen_random_uuid(),appointment_id uuid,profile_id uuid,
      environment text,state text,created_at timestamptz default now(),next_attempt_at timestamptz default now(),
      lease_token uuid,lease_expires_at timestamptz,fencing_token bigint default 0,attempts integer default 0,
      last_error text,failed_at timestamptz,updated_at timestamptz default now(),provider_message_id text,accepted_at timestamptz,
      first_dispatch_at timestamptz,replay_deadline_at timestamptz);
    create table public.booking_notification_delivery_review_v3(notification_id uuid primary key,appointment_id uuid,profile_id uuid,
      environment text,reason_code text,safe_error text,attempts integer,queued_at timestamptz default now(),resolved_at timestamptz);
    grant select on public.background_job_cron_requests to service_role;
  `);
  file(
    "supabase/migrations/20260829093906_stripe_connect_express_onboarding.sql",
    "migration_owner",
  );
  file("supabase/migrations/20260829093907_stripe_connect_lifecycle.sql", "migration_owner");
  file(
    "supabase/migrations/20260829130940_b76a878a-0ab4-4277-b54c-50c58788c167.sql",
    "migration_owner",
  );
  file("supabase/migrations/20260904120000_harden_repo_migration_runner.sql", "migration_owner");
  const name = "20260910140000_calendar_worker_schedules.sql";
  const source = await readFile(path.join(root, "supabase/migrations", name), "utf8");
  const checksum = createHash("sha256").update(source).digest("hex");
  assert.doesNotMatch(
    source,
    /\b(?:create|alter|drop)\s+policy\b|\b(?:insert\s+into|update|delete\s+from)\s+cron\.job\b|\b(?:grant|revoke)\s+[^;]*\bon\s+(?:(?:table|function)\s+)?cron\.|\bcreate\s+(?:unlogged\s+)?table\b/i,
    "owner-scoped installation cannot add cron policies, table writes, native grants or a new queue",
  );
  assert.doesNotMatch(
    source,
    /\busername\s*(?:<>|!=|is\s+distinct\s+from)\s*current_user\b/i,
    "owner-scoped scheduling cannot probe foreign job existence",
  );
  const migrate = (mode, body = source, migrationName = name) =>
    JSON.parse(
      sql(`
    set role service_role;
    select public.apply_repo_migration('${migrationName}','${checksum}',$fixture_sql$${body}$fixture_sql$,'${mode}','local-fixture');
  `),
    );
  assert.equal(migrate("dry_run").sqlstate, "42501", "missing native privileges fail installation");
  sql(`create role prior_scheduler_owner login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
    set role calendar_extension_owner;
    grant usage on schema cron to prior_scheduler_owner,migration_owner;
    -- Fixture-only baseline native authority, not a production policy bootstrap.
    grant execute on function cron.schedule(text,text,text) to migration_owner;
    grant execute on function cron.alter_job(bigint,text,text,text,text,boolean) to migration_owner;
    reset role;set role prior_scheduler_owner;
    select cron.schedule('obra-calendar-test-google','* * * * *','select 0;');
    select cron.schedule('obra-calendar-live-google','* * * * *','select 1;');
    select cron.schedule('foreign-unrelated','* * * * *','select 2;');
    select cron.schedule('obra-record-background-job-responses','* * * * *','select 3;');
    select cron.schedule('obra-record-background-job-responses-unrelated','* * * * *','select 4;');`);
  const foreignBefore = sql(
    "select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j where username='prior_scheduler_owner'",
  );
  assert.equal(
    sql(
      "set role migration_owner;select count(*) from cron.job where username='prior_scheduler_owner'",
    ),
    "0",
    "owner-only RLS hides same/opposite-environment foreign jobs and the shared recorder",
  );
  assert.equal(
    migrate(
      "dry_run",
      "create policy fixture_self_grant on cron.job for select to migration_owner using (true)",
      "fixture-policy-self-grant",
    ).sqlstate,
    "42501",
    "a native scheduler grantee still cannot CREATE POLICY on the extension-owned table",
  );
  sql(
    `set role calendar_extension_owner;grant usage on schema cron to anon,authenticated,service_role,booking_worker`,
  );
  for (const role of ["anon", "authenticated", "service_role", "booking_worker"])
    assert.equal(
      sql(`set role ${role};select count(*) from cron.job`),
      "0",
      "owner-only visibility does not expand " + role,
    );
  assert.equal(
    sql(`select has_function_privilege('migration_owner','cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE')
    and not has_function_privilege('migration_owner','cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE WITH GRANT OPTION')
    and not has_table_privilege('migration_owner','cron.job','UPDATE')
    and not has_table_privilege('migration_owner','cron.job','INSERT')
    and not has_table_privilege('migration_owner','cron.job','DELETE')
    and not pg_has_role('migration_owner','calendar_extension_owner','MEMBER')
    and not has_function_privilege('service_role','cron.alter_job(bigint,text,text,text,text,boolean)','EXECUTE')`),
    "t",
    "baseline native EXECUTE grants confer no table writes, delegation or extension-role authority",
  );
  const catalogState = `select jsonb_build_object(
    'columns',(select jsonb_agg(jsonb_build_array(c.relname,a.attname,a.atttypid,a.attnotnull) order by c.relname,a.attnum)
      from pg_attribute a join pg_class c on c.oid=a.attrelid
      where c.relnamespace='public'::regnamespace and a.attnum>0 and not a.attisdropped),
    'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.prosrc) order by p.oid)
      from pg_proc p where p.pronamespace='public'::regnamespace),
    'jobs',(select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j),
    'policies',(select jsonb_agg(to_jsonb(p) order by oid) from pg_policy p where polrelid='cron.job'::regclass),
    'requests',(select jsonb_agg(to_jsonb(r) order by id) from public.background_job_cron_requests r))`;
  const beforeInstall = sql(catalogState);
  assert.equal(
    migrate("dry_run").status,
    "dry_run_ok",
    "native privileges suffice without a custom visibility policy",
  );
  assert.equal(
    sql(catalogState),
    beforeInstall,
    "service-runner dry run rolls back schema and preserves foreign jobs",
  );
  for (const revoke of [
    "set local role calendar_extension_owner;revoke usage on schema cron from migration_owner",
    "set local role calendar_extension_owner;revoke select on cron.job from public",
    "set local role calendar_extension_owner;revoke execute on function cron.schedule(text,text,text) from public,migration_owner",
    "set local role calendar_extension_owner;revoke execute on function cron.alter_job(bigint,text,text,text,text,boolean) from migration_owner",
    "alter role migration_owner nologin",
  ]) {
    sql(`begin;${revoke};reset role;set local role service_role;do $missing_privileges$declare result jsonb;begin
      result:=public.apply_repo_migration('${name}','${checksum}',$migration$${source}$migration$,'apply','local-fixture');
      if result->>'sqlstate' is distinct from '42501' or result->>'message' is distinct from 'Calendar scheduler owner requires native cron privileges' then
        raise exception 'installation did not fail at the native privilege preflight: %',result;end if;
      end $missing_privileges$;reset role;
      do $$begin
        if to_regprocedure('public.register_calendar_worker_schedules(text)') is not null
          or exists(select 1 from pg_attribute where attrelid='public.stripe_connected_accounts'::regclass and attname='reconciliation_attempts')
          or exists(select 1 from cron.job where username='migration_owner')
          or exists(select 1 from public.applied_repo_migrations where name='${name}') then
          raise exception 'failed installation changed schema, jobs or applied ledger';end if;
      end $$;rollback;`);
    assert.equal(
      sql(catalogState),
      beforeInstall,
      "missing native privilege/login leaves installation unchanged",
    );
  }
  assert.equal(migrate("apply").status, "applied");
  assert.equal(
    sql(
      "select count(*)=1 and bool_and(polname='cron_job_policy') from pg_policy where polrelid='cron.job'::regclass",
    ),
    "t",
    "installation leaves only stock owner RLS",
  );
  const output = file("supabase/tests/calendar-worker-schedules.sql");
  if (!output.includes("calendar-worker-schedules: passed"))
    throw new Error("Missing SQL suite completion");
  assert.equal(
    sql(
      "select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j where username='prior_scheduler_owner'",
    ),
    foreignBefore,
    "installation and rollback-only behavior suite preserve every foreign fixture",
  );
  console.log(
    "PASS: owner-only native cron installation and scheduler SQL suite; no visibility bootstrap or foreign writes",
  );
  sql(`
    insert into public.profiles(id,license_number,environment)
      values('10000000-0000-4000-8000-000000000001','CONCURRENT-REFRESH','test');
    insert into public.stripe_connected_accounts(profile_id,environment,stripe_account_id)
      values('10000000-0000-4000-8000-000000000001','test','acct_concurrentfixture');
  `);
  function concurrentClaim(lease) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "psql",
        [
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-Atq",
          "-c",
          `
        begin;
        select count(*) from public.claim_stripe_connect_account_refresh(
          '10000000-0000-4000-8000-000000000001','test','${lease}');
        select pg_sleep(0.1);
        commit;
      `,
        ],
        { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      let errorOutput = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        errorOutput += chunk;
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve(Number(output.trim())) : reject(new Error(errorOutput)),
      );
    });
  }
  const claims = await Promise.all([
    concurrentClaim("20000000-0000-4000-8000-000000000001"),
    concurrentClaim("20000000-0000-4000-8000-000000000002"),
  ]);
  if (claims.sort().join(",") !== "0,1")
    throw new Error("Concurrent targeted claims did not deduplicate");

  // Run the real notification failure reducer against the smallest existing-column
  // fixture. The full replay owns the rest of the notification schema/contracts.
  const notificationMigration = await readFile(
    path.join(root, "supabase/migrations/20260910133000_booking_notification_lifetime.sql"),
    "utf8",
  );
  const failureReducer = notificationMigration.match(
    /create or replace function public\.fail_booking_notification_v3\([\s\S]*?end \$function\$;/,
  )[0];
  sql(`set role migration_owner;${failureReducer}`);
  sql(`
    insert into public.appointments(id,profile_id,environment,calendar_state,confirmed_at,created_at) values
      ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','test','create_pending',now()-interval '10 minutes',now()-interval '30 minutes'),
      ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','test','created',now()-interval '1 day',now()-interval '2 days');
    insert into public.appointments(profile_id,environment,calendar_state,review_state,confirmed_at) values
      ('10000000-0000-4000-8000-000000000001','test','create_failed','unresolved_destination',now()-interval '5 minutes'),
      ('10000000-0000-4000-8000-000000000001','live','create_failed','unresolved_destination',now()-interval '1 day');
    insert into public.calendar_event_links(appointment_id,profile_id,environment,reconcile_status,reconcile_lease_expires_at) values
      ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','test','processing',now()-interval '3 minutes'),
      ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','test','retry_wait',null);
    insert into public.booking_notifications(id,appointment_id,profile_id,environment,state,created_at,lease_token,lease_expires_at,fencing_token,attempts)
      values('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001','test','processing',now()-interval '6 minutes',
        '50000000-0000-4000-8000-000000000001',now()+interval '1 minute',1,1);
    select public.fail_booking_notification_v3('40000000-0000-4000-8000-000000000001','test',
      '50000000-0000-4000-8000-000000000001',1,true,'fixture transient failure');
    insert into public.booking_notifications(environment,state,created_at,lease_expires_at) values
      ('test','processing',now()-interval '3 minutes',now()-interval '2 minutes'),
      ('test','delivery_delayed',now()-interval '1 day',null),
      ('live','retry',now()-interval '1 day',null);
  `);
  let report = JSON.parse(
    sql("set role service_role;select public.get_calendar_worker_health('test')"),
  );
  assert.equal(report.row_failures.notifications, 1, "real reducer retry is a failure count");
  assert.equal(
    report.overdue_obligations.calendar.count,
    2,
    "paid pending and unresolved only; no healthy drift scans or other environment",
  );
  assert.equal(report.overdue_obligations.calendar.unresolvedDestinationCount, 1);
  assert.equal(report.overdue_obligations.calendar.expiredLeaseCount, 1);
  assert.ok(report.overdue_obligations.calendar.oldestPendingAgeSeconds >= 600);
  assert.ok(
    report.overdue_obligations.calendar.oldestPendingAgeSeconds < 620,
    "creation is not mistaken for obligation time",
  );
  assert.equal(report.overdue_obligations.notifications.count, 2);
  assert.equal(report.overdue_obligations.notifications.retryCount, 1);
  assert.equal(report.overdue_obligations.notifications.deliveryDelayedCount, 1);
  assert.equal(report.overdue_obligations.notifications.expiredLeaseCount, 1);
  assert.ok(report.overdue_obligations.notifications.oldestPendingAgeSeconds >= 360);
  sql(`update public.booking_notifications set state='processing',attempts=8,
      lease_token='50000000-0000-4000-8000-000000000001',lease_expires_at=now()+interval '1 minute'
      where id='40000000-0000-4000-8000-000000000001';
    select public.fail_booking_notification_v3('40000000-0000-4000-8000-000000000001','test',
      '50000000-0000-4000-8000-000000000001',1,true,'fixture retry exhaustion');`);
  report = JSON.parse(
    sql("set role service_role;select public.get_calendar_worker_health('test')"),
  );
  assert.equal(report.overdue_obligations.notifications.count, 1);
  assert.equal(report.overdue_obligations.notifications.failedCount, 1);
  assert.equal(report.overdue_obligations.notifications.reviewCount, 1);
  assert.ok(report.overdue_obligations.notifications.oldestReviewAt);
  sql(`update public.booking_notification_delivery_review_v3 set resolved_at=now()
    where notification_id='40000000-0000-4000-8000-000000000001';`);
  report = JSON.parse(
    sql("set role service_role;select public.get_calendar_worker_health('test')"),
  );
  assert.equal(report.overdue_obligations.notifications.reviewCount, 0);

  sql(`begin;
    insert into public.profiles(id,environment)
      select ('a0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'test' from generate_series(1,120)i;
    insert into public.calendar_connections(id,profile_id,environment,last_verified_at,created_at,pipedream_account_id,connection_revision)
      select id,id,environment,clock_timestamp(),clock_timestamp()-interval '1 day','apn_'||replace(id::text,'-',''),1
      from public.profiles where id::text like 'a0000000-%';
    insert into public.pipedream_bindings(id,connection_id,profile_id,environment,pipedream_account_id,configuration_revision,
      trigger_state,updated_at,reconciliation_due_at,reconciliation_attempts,safe_error,reconciliation_reason)
      select id,id,id,'test',pipedream_account_id,1,'degraded',clock_timestamp(),clock_timestamp()+interval '1 hour',8,
        'PRIVATE provider diagnostic','provider_platform_error' from public.calendar_connections where id::text like 'a0000000-%';
    commit;`);
  report = JSON.parse(
    sql("set role service_role;select public.get_calendar_worker_health('test')"),
  );
  assert.deepEqual(report.binding_failures, { provider_platform_error: 120 });
  assert.equal(
    report.overdue_connections.filter((c) => c.provider === "google").length,
    0,
    "current fresh account + future due binding is not in the overdue inventory",
  );
  sql(`update public.calendar_connections set last_verified_at=clock_timestamp()-interval '16 minutes'
    where id::text like 'a0000000-%'`);
  report = JSON.parse(
    sql("set role service_role;select public.get_calendar_worker_health('test')"),
  );
  assert.equal(report.overdue_connections.length, 100);
  assert.deepEqual(
    report.binding_failures,
    { provider_platform_error: 120 },
    "binding counts are not capped at oldest 100",
  );
  sql(`update public.pipedream_bindings set trigger_state='disabled' where id='a0000000-0000-4000-8000-000000000001';
    update public.pipedream_bindings set configuration_revision=2 where id='a0000000-0000-4000-8000-000000000002';
    update public.pipedream_bindings set pipedream_account_id='apn_retired' where id='a0000000-0000-4000-8000-000000000003';
    update public.pipedream_bindings set environment='live' where id='a0000000-0000-4000-8000-000000000004';
    update public.calendar_connections set reconnect_reason='contractor_disconnected' where id='a0000000-0000-4000-8000-000000000005';
    insert into public.booking_provider_account_disconnects_v3(profile_id,environment,provider,provider_account_id,state)
      select profile_id,environment,'pipedream',pipedream_account_id,'pending' from public.calendar_connections where id='a0000000-0000-4000-8000-000000000006';
    update public.pipedream_bindings set reconciliation_reason='trigger_version_unverified' where id='a0000000-0000-4000-8000-000000000007';
    update public.pipedream_bindings set reconciliation_reason='PRIVATE unclassified reason' where id='a0000000-0000-4000-8000-000000000008';`);
  report = JSON.parse(
    sql("set role service_role;select public.get_calendar_worker_health('test')"),
  );
  assert.deepEqual(report.binding_failures, {
    provider_platform_error: 112,
    trigger_version_unverified: 1,
    unknown: 1,
  });
  assert.doesNotMatch(JSON.stringify(report.binding_failures), /PRIVATE/);
  assert.equal(
    JSON.parse(sql("set role service_role;select public.get_calendar_worker_health('live')"))
      .binding_failures.provider_platform_error,
    undefined,
  );
  console.log(
    "PASS: R13 exact uncapped binding failure counts across 120 tenants; future retries/freshness and retired/revision/environment/disconnect exclusions",
  );

  // Hold the actual webhook projection transaction after resetting metadata, then
  // race the older maintenance release. The row lock must preserve successful evidence.
  sql(`
    update public.stripe_connected_accounts set reconciliation_due_at=now()-interval '1 second',
      reconciliation_lease_expires_at=null,reconciliation_attempts=7,reconciliation_safe_error='fixture failure'
      where profile_id='10000000-0000-4000-8000-000000000001';
    select count(*) from public.claim_stripe_connect_account_refresh('10000000-0000-4000-8000-000000000001',
      'test','60000000-0000-4000-8000-000000000001');
    select public.begin_leased_stripe_connect_reconciliation('10000000-0000-4000-8000-000000000001','test',
      'acct_concurrentfixture','60000000-0000-4000-8000-000000000001',2);
    insert into public.provider_event_inbox(id,profile_id,environment,provider,event_family,event_type,account_context,
      processing_state,lease_token,lease_expires_at,fencing_token) values
      ('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','test','stripe',
      'connect','account.updated','acct_concurrentfixture','processing','80000000-0000-4000-8000-000000000001',
      now()+interval '55 seconds',1);
    select public.begin_stripe_connect_inbox_reconciliation('70000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',1);
  `);
  const webhook = spawn(
    "psql",
    [
      "-X",
      "-w",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
      "-c",
      `
    set role service_role;begin;
    select public.apply_stripe_connect_inbox_projection('70000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000001',1,2,true,true,true,'{"card_payments":"active"}',
      '{"currently_due":[],"past_due":[],"pending_verification":[]}',null,clock_timestamp());
    do $$begin raise notice 'webhook_projection_locked';end $$;
    select pg_sleep(0.3);commit;`,
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  const locked = new Promise((resolve, reject) => {
    webhook.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.includes("webhook_projection_locked")) resolve();
    });
    webhook.once("error", reject);
    webhook.once("close", (code) => {
      if (!stderr.includes("webhook_projection_locked"))
        reject(new Error(`webhook exited ${code}: ${stderr}`));
    });
  });
  const webhookCompleted = new Promise((resolve, reject) => {
    webhook.once("error", reject);
    webhook.once("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
  });
  await locked;
  assert.equal(
    sql(`set role service_role;select public.release_stripe_connect_reconciliation_claim(
    '10000000-0000-4000-8000-000000000001','test','60000000-0000-4000-8000-000000000001',2,false)`),
    "t",
  );
  await webhookCompleted;
  assert.equal(
    sql(`select reconciliation_attempts=0 and reconciliation_safe_error is null and onboarding_state='ready'
    and reconciliation_due_at>now()+interval '9 minutes' from public.stripe_connected_accounts
    where profile_id='10000000-0000-4000-8000-000000000001'`),
    "t",
    "concurrent older release cannot restore stale webhook error",
  );
  console.log(
    "test-calendar-worker-sql: passed (constrained runner/native cron privileges and owner-only RLS; schedule/obligation health; real Stripe projections and concurrent webhook/release)",
  );
} finally {
  if (started) run("pg_ctl", ["-D", data, "stop", "-m", "immediate"]);
  await rm(directory, { recursive: true, force: true });
}
