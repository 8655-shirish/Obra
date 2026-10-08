import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

// Only the dispatch/result seam: actual SQL functions, disposable loopback DB,
// minimal inert tables. Full migration replay remains the integration suite's job.
const directory = await mkdtemp(path.join(os.tmpdir(), "obra-pipedream-outcome-"));
const data = path.join(directory, "pgdata");
const probe = createServer();
await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", resolve).once("error", reject));
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const env = {
  PATH: process.env.PATH,
  HOME: directory,
  TMPDIR: directory,
  LC_ALL: "C",
  PGHOST: "127.0.0.1",
  PGPORT: String(port),
  PGDATABASE: "postgres",
  PGUSER: "outcome_test",
  PGPASSFILE: path.join(directory, "no-password"),
};
let started = false;
function run(command, args, input) {
  const result = spawnSync(command, args, {
    env,
    input,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${command} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout.trim();
}
function sql(input) {
  assert.equal(started, true, "never connect before this test's own server started");
  return run("psql", ["-X", "-w", "-Atq", "-v", "ON_ERROR_STOP=1"], input);
}
try {
  run("initdb", ["-D", data, "-A", "trust", "-U", "outcome_test", "--no-locale"]);
  run("pg_ctl", [
    "-D",
    data,
    "-o",
    `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=''`,
    "-l",
    path.join(directory, "postgres.log"),
    "start",
  ]);
  started = true;
  sql(`
    create role service_role;
    create role migration_owner nologin;
    grant usage,create on schema public to migration_owner;
    set role migration_owner;
    create table public.calendar_connections(id uuid primary key,profile_id uuid,environment text,
      connection_revision bigint,pipedream_account_id text,verification_reason text);
    create table public.booking_provider_account_disconnects_v3(profile_id uuid,environment text,provider_account_id text,state text);
    create table public.pipedream_bindings(
      id uuid primary key,connection_id uuid,profile_id uuid,environment text,pipedream_account_id text,
      configuration_revision bigint,component_key text,component_version text,trigger_state text,
      reconciliation_lease_token uuid,reconciliation_fencing_token bigint,reconciliation_lease_expires_at timestamptz,
      reconciliation_allow_repair boolean,reconciliation_reason text,reconciliation_attempts integer,reconciliation_due_at timestamptz,
      safe_error text,observed_component_key text,observed_component_version text,deployed_trigger_id text,
      deployment_operation_id uuid,deployment_candidate_trigger_id text,deployment_dispatched_at timestamptz,
      deployment_dispatch_lease_token uuid,deployment_dispatch_fencing_token bigint,deployment_lease_expires_at timestamptz,
      deployment_receipt jsonb,retired_deployment jsonb,retired_trigger_ids text[] default '{}',
      pending_trigger_deletions text[] default '{}',updated_at timestamptz
    );
  `);
  const source = await readFile(
    path.resolve("supabase/migrations/20260910120000_google_calendar_lifetime.sql"),
    "utf8",
  );
  for (const name of [
    "lock_google_calendar_binding",
    "begin_pipedream_trigger_deployment_effect",
    "record_pipedream_trigger_deployment_result",
    "adopt_pipedream_trigger_candidate",
    "fail_pipedream_binding_reconciliation",
  ]) {
    const definition = source.match(
      new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?end \\$\\$;`),
    )?.[0];
    assert.ok(
      definition,
      `${name} must be read from the current migration, not duplicated in a mock`,
    );
    sql(`set role migration_owner; ${definition}`);
  }
  sql(`
    set role migration_owner;
    revoke all on all functions in schema public from public;
    grant execute on all functions in schema public to service_role;
    insert into public.calendar_connections values('10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002','test',1,'apn_fixture',null);
    insert into public.pipedream_bindings(id,connection_id,profile_id,environment,pipedream_account_id,configuration_revision,
      component_key,component_version,trigger_state,reconciliation_lease_token,reconciliation_fencing_token,
      reconciliation_lease_expires_at,reconciliation_allow_repair,reconciliation_attempts,deployment_operation_id)
    values('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002','test','apn_fixture',1,
      'google_calendar-new-or-updated-event-instant','1.2.3','deploying',
      '10000000-0000-4000-8000-000000000004',7,clock_timestamp()+interval '1 minute',true,1,
      '10000000-0000-4000-8000-000000000005');
  `);
  const binding = "'10000000-0000-4000-8000-000000000003'";
  const lease = "'10000000-0000-4000-8000-000000000004'";
  const operation = "'10000000-0000-4000-8000-000000000005'";
  const nextLease = "'10000000-0000-4000-8000-000000000006'";
  const scalar = (expression) => sql(`select ${expression};`);
  const begin = () =>
    sql(
      `set role service_role;select public.begin_pipedream_trigger_deployment_effect(${binding},${lease},7,${operation});`,
    );
  const fail = (token = lease, fence = 7, rejected = true) =>
    sql(
      `set role service_role;select public.fail_pipedream_binding_reconciliation(${binding},${token},${fence},'provider_temporary_failure',null,${rejected});`,
    );
  const reclaim = (token = lease, fence = 7) =>
    sql(`set role migration_owner;update public.pipedream_bindings set
    reconciliation_lease_token=${token},reconciliation_fencing_token=${fence},reconciliation_lease_expires_at=clock_timestamp()+interval '1 minute',reconciliation_allow_repair=true where id=${binding};`);

  fail();
  sql(`set role service_role;do $$begin
    begin perform public.begin_pipedream_trigger_deployment_effect(${binding},${lease},7,${operation});
      raise exception 'queued begin survived no-send settlement';
    exception when serialization_failure then null;end;
  end $$;`);
  assert.equal(
    scalar(`deployment_dispatched_at is null from public.pipedream_bindings where id=${binding}`),
    "t",
    "settlement before the pending begin transaction prevents a late dispatch marker",
  );
  reclaim();
  assert.equal(begin(), "t");
  assert.equal(fail(), "t");
  assert.equal(
    scalar(
      `deployment_dispatched_at is null and deployment_operation_id=${operation} and reconciliation_due_at is not null from public.pipedream_bindings where id=${binding}`,
    ),
    "t",
    "known no-POST/rejection clears only dispatch and retains scheduled operation",
  );
  sql(`set role service_role;do $$begin
    begin perform public.begin_pipedream_trigger_deployment_effect(${binding},${lease},7,${operation});
      raise exception 'delayed begin bypassed released lease';
    exception when serialization_failure then null;end;
  end $$;`);
  assert.equal(
    scalar(`deployment_dispatched_at is null from public.pipedream_bindings where id=${binding}`),
    "t",
    "late begin cannot restore the cleared marker",
  );

  reclaim();
  begin();
  sql(
    `set role migration_owner;update public.pipedream_bindings set reconciliation_lease_expires_at=clock_timestamp()-interval '1 second' where id=${binding};`,
  );
  assert.equal(
    sql(
      `set role service_role;select public.record_pipedream_trigger_deployment_result(${binding},${operation},${lease},7,null,true);`,
    ),
    "f",
  );
  assert.equal(
    scalar(
      `deployment_dispatched_at is null and deployment_operation_id=${operation} from public.pipedream_bindings where id=${binding}`,
    ),
    "t",
    "expired dispatch owner can retain no-send evidence without changing its operation",
  );
  reclaim();
  begin();
  fail(lease, 7, false);
  assert.equal(
    scalar(
      `deployment_dispatched_at is not null and reconciliation_due_at is not null from public.pipedream_bindings where id=${binding}`,
    ),
    "t",
    "unknown sent outcome remains due",
  );
  reclaim(nextLease, 8);
  fail(nextLease, 8, true);
  assert.equal(
    scalar(
      `deployment_dispatched_at is not null from public.pipedream_bindings where id=${binding}`,
    ),
    "t",
    "new claimant cannot label a previous dispatch not sent",
  );

  reclaim(nextLease, 8);
  sql(`set role service_role;do $$begin
    begin perform public.begin_pipedream_trigger_deployment_effect(${binding},${nextLease},8,${operation});
      raise exception 'unknown dispatch allowed another create';
    exception when serialization_failure then null;end;
  end $$;`);
  reclaim();
  fail();
  reclaim();
  begin();
  assert.equal(
    sql(
      `set role service_role;select public.adopt_pipedream_trigger_candidate(${binding},${lease},7,'dc_fixture',${operation},'sc_pinned');`,
    ),
    "t",
  );
  fail();
  assert.equal(
    scalar(`deployment_dispatched_at is not null and deployment_candidate_trigger_id='dc_fixture'
    and deployment_receipt->>'component_id'='sc_pinned' from public.pipedream_bindings where id=${binding}`),
    "t",
    "a successful receipt cannot be contradicted by not-sent settlement",
  );

  sql(`set role migration_owner;update public.pipedream_bindings set deployment_candidate_trigger_id=null,deployment_receipt=null,
    reconciliation_lease_expires_at=clock_timestamp()-interval '1 second' where id=${binding};`);
  assert.equal(
    sql(
      `set role service_role;select public.adopt_pipedream_trigger_candidate(${binding},${lease},7,'dc_fixture',${operation},'sc_pinned');`,
    ),
    "t",
    "successful response remains attributable after its reconciliation lease expires",
  );
  reclaim(nextLease, 8);
  assert.equal(
    sql(
      `set role service_role;select public.adopt_pipedream_trigger_candidate(${binding},${lease},7,'dc_fixture',${operation},'sc_pinned');`,
    ),
    "t",
    "late completed response retains its receipt without stealing the takeover lease",
  );
  assert.equal(
    scalar(`reconciliation_lease_token=${nextLease} and reconciliation_fencing_token=8 and trigger_state<>'active'
    and deployment_receipt->>'operation_id'=${operation}::text from public.pipedream_bindings where id=${binding}`),
    "t",
  );
  sql(`set role service_role;do $$begin
    begin perform public.adopt_pipedream_trigger_candidate(${binding},${lease},7,'dc_fixture',${operation});
      raise exception 'late inventory adoption bypassed lease';
    exception when serialization_failure then null;end;
    begin perform public.adopt_pipedream_trigger_candidate(${binding},${nextLease},8,'dc_fixture',${operation},'sc_pinned');
      raise exception 'takeover invented successful response proof';
    exception when serialization_failure then null;end;
    begin perform public.adopt_pipedream_trigger_candidate(${binding},null,null,'dc_fixture',${operation},'sc_pinned');
      raise exception 'missing dispatch identity supplied response proof';
    exception when serialization_failure then null;end;
  end $$;`);

  sql(`set role migration_owner;update public.pipedream_bindings set retired_deployment=jsonb_build_object(
    'operation_id',${operation}::text,'lease_token',${lease}::text,'fencing_token','7'),
    deployment_operation_id=null,deployment_candidate_trigger_id=null,deployment_receipt=null where id=${binding};`);
  assert.equal(
    sql(
      `set role service_role;select public.record_pipedream_trigger_deployment_result(${binding},${operation},${nextLease},8,null,true);`,
    ),
    "f",
  );
  assert.equal(
    scalar(`retired_deployment is not null from public.pipedream_bindings where id=${binding}`),
    "t",
  );
  assert.equal(
    sql(
      `set role service_role;select public.record_pipedream_trigger_deployment_result(${binding},${operation},${lease},7,null,true);`,
    ),
    "t",
    "only exact superseded operation can settle its no-send result",
  );
  console.log(
    "test-pipedream-outcome-sql: passed (actual begin/fail/adopt/result fences; late begin, takeover, unknown dispatch and receipt preservation; inert loopback DB)",
  );
} finally {
  if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "stop"]);
  await rm(directory, { recursive: true, force: true });
}
