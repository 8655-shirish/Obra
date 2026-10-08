import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

// Full real migration replay + actual monitor/notice code. Only framework entries,
// generation collection, PostgREST transport and outbound HTTP are replaced.
// Always our own disposable loopback PostgreSQL; no inherited credentials/hosted IO.
const root = fileURLToPath(new URL("../", import.meta.url));
assert.equal(path.resolve(process.cwd()), path.resolve(root));
const directory = await mkdtemp(path.join(root, ".calendar-observability-test-"));
const data = path.join(directory, "pgdata");
const previousEnv = { ...process.env };
const previousFetch = globalThis.fetch;
const previousConsoleError = console.error;
const listener = createServer();
await new Promise((resolve, reject) =>
  listener.listen(0, "127.0.0.1", resolve).once("error", reject),
);
const port = listener.address().port;
await new Promise((resolve, reject) =>
  listener.close((error) => (error ? reject(error) : resolve())),
);
const env = {
  PATH: process.env.PATH,
  HOME: root,
  TMPDIR: directory,
  LC_ALL: "C",
  PSQLRC: "/dev/null",
  PGHOST: "127.0.0.1",
  PGPORT: String(port),
  PGDATABASE: "postgres",
  PGUSER: "calendar_notice_test",
  PGPASSFILE: path.join(directory, "no-password"),
  PGOPTIONS: "-c client_min_messages=warning",
};
process.env.TMPDIR = directory;
Object.assign(process.env, {
  GENERATION_MONITOR_SECRET: "fixture-monitor-secret",
  GENERATION_ALERT_WEBHOOK_URL: "https://generation.example.test/alerts",
  CALENDAR_MONITOR_ENABLED: "true",
  CALENDAR_MONITOR_ENVIRONMENT: "test",
  CALENDAR_ACTION_NOTICES_ENABLED: "true",
  CALENDAR_ALERT_WEBHOOK_URL: "https://operator.example.test/calendar",
  CALENDAR_ALERT_WEBHOOK_TOKEN: "fixture-webhook-token",
  CALENDAR_ALERT_OWNER: "Fixture calendar operator",
  CALENDAR_ALERT_CHANNEL: "Fixture incident destination",
  PUBLIC_APP_URL: "https://obratech.co",
  RESEND_API_KEY_TEST: "fixture-resend-test",
  BOOKING_EMAIL_FROM_TEST: "Obra <calendar@example.test>",
});
delete process.env.RESEND_API_KEY_LIVE;
delete process.env.BOOKING_EMAIL_FROM_LIVE;
let started = false;
const bundles = [];
let state = {};
const logs = [];
console.error = (...args) => logs.push(args.join(" "));
function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    input,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${command} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout.trim();
}
function sql(input) {
  assert.equal(started, true, "never connect before our own local server starts");
  return run("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1"], input);
}
function literal(value) {
  if (value == null) return "null";
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value));
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  const json = typeof value === "object";
  return (
    "'" +
    (json ? JSON.stringify(value) : value).replaceAll("'", "''") +
    "'" +
    (json ? "::jsonb" : "")
  );
}
function row() {
  return JSON.parse(
    sql(`select to_jsonb(c) from public.calendar_connections c where id=${literal(state.id)}`),
  );
}
function recover() {
  sql(`update public.calendar_connections set verification_reason=null,reconnect_reason=null,health_state='healthy',
    last_verified_at=clock_timestamp(),disconnected_at=null where id=${literal(state.id)}`);
}
function makeDue(hours = 0) {
  state.elapsed += hours * 3600_000;
  sql(`update public.calendar_connections set action_notice_due_at=clock_timestamp(),action_notice_lease_expires_at=clock_timestamp()-interval '1 second',
    action_notice=case when action_notice ? 'first_dispatch_at' then jsonb_set(action_notice,'{first_dispatch_at}',
      to_jsonb((action_notice->>'first_dispatch_at')::timestamptz-interval '${hours} hours')) else action_notice end where id=${literal(state.id)}`);
}
function fixture(reason = "calendar_permissions_changed", environment = "test") {
  state = {
    id: randomUUID(),
    profile: randomUUID(),
    owner: randomUUID(),
    elapsed: 0,
    calls: [],
    requests: [],
    emails: [],
    provider: new Map(),
    loseProvider: 0,
    failSettlement: 0,
    loseSettlement: 0,
    failHealth: false,
    failNoticeHealth: false,
    failSnapshotRead: null,
    failClaim: false,
    recoverBeforeAuth: false,
    recoverAfterAcceptance: false,
    stopAfterAcceptance: false,
    loseFenceBeforeAuth: false,
    generationFails: false,
    providerStatus: 200,
    failWebhook: false,
    generationCalls: 0,
    generationDeliveries: 0,
    canContinue: true,
  };
  state.email = `${state.profile}@example.test`;
  sql(`insert into auth.users(id,email,confirmed_at,email_confirmed_at) values(${literal(state.owner)},${literal(state.email)},now(),now());
    insert into public.profiles(id,auth_user_id,license_number,email,environment) values(${literal(state.profile)},${literal(state.owner)},
      ${literal(state.profile)},${literal(state.email)},${literal(environment)});
    insert into public.calendar_connections(id,profile_id,environment,external_user_id,pipedream_account_id,connection_revision,
      account_email,health_state,verification_reason) values(${literal(state.id)},${literal(state.profile)},${literal(environment)},
      ${literal(state.id + "-never-email-external@example.test")},${literal("apn_" + state.id.replaceAll("-", ""))},1,'never-email-google@example.test','degraded',${literal(reason)});
    update public.calendar_connections set action_notice_lease_expires_at=clock_timestamp()+interval '1 year' where id<>${literal(state.id)} and action_notice<>'{}'::jsonb;`);
}
const rpcNames = new Set([
  "get_calendar_worker_health",
  "get_calendar_action_notice_health",
  "claim_calendar_action_notice",
  "transition_calendar_action_notice",
]);
globalThis.__calendarObservability = {
  rpc(name, args) {
    return {
      async abortSignal(signal) {
        assert.ok(signal instanceof AbortSignal);
        assert.ok(rpcNames.has(name), "only existing health and the narrow new RPCs");
        state.calls.push({ name, args: structuredClone(args) });
        if (
          (name === "get_calendar_worker_health" && state.failHealth) ||
          (name === "get_calendar_action_notice_health" && state.failNoticeHealth) ||
          (state.failSnapshotRead?.name === name &&
            state.calls.filter((call) => call.name === name).length ===
              state.failSnapshotRead.at) ||
          (name === "claim_calendar_action_notice" && state.failClaim) ||
          (args.p_action === "accepted" && state.failSettlement-- > 0)
        )
          return { data: null, error: { message: "PRIVATE database payload and key" } };
        if (args.p_action === "authorize" && state.recoverBeforeAuth) recover();
        if (args.p_action === "authorize" && state.loseFenceBeforeAuth)
          sql(
            `update public.calendar_connections set action_notice_fencing_token=action_notice_fencing_token+1 where id=${literal(state.id)}`,
          );
        const query = `set role service_role;select public.${name}(${Object.entries(args)
          .map(([k, v]) => `${k}=>${literal(v)}`)
          .join(",")});`;
        const result = spawnSync(
          "psql",
          ["-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"],
          { cwd: root, env, input: query, encoding: "utf8" },
        );
        if (result.status !== 0) return { data: null, error: { message: result.stderr } };
        if (args.p_action === "accepted" && state.loseSettlement-- > 0)
          return { data: null, error: { message: "PRIVATE committed acceptance response lost" } };
        return { data: JSON.parse(result.stdout.trim() || "null"), error: null };
      },
    };
  },
  generation() {
    state.generationCalls++;
    if (state.generationFails) throw new Error("PRIVATE generation diagnostic");
    return { observedAt: "2026-09-10T00:00:00.000Z", alerts: [] };
  },
  async http(url, init) {
    state.requests.push({ url: String(url), init });
    if (String(url) === "https://generation.example.test/alerts") {
      state.generationDeliveries++;
      return new Response("ok");
    }
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    if (String(url) === "https://operator.example.test/calendar") {
      if (state.failWebhook) throw new Error("PRIVATE destination error");
      assert.equal(init.headers.authorization, "Bearer fixture-webhook-token");
      state.operator = JSON.parse(init.body);
      return new Response("ok");
    }
    assert.equal(String(url), "https://api.resend.com/emails", "no arbitrary URL dispatch");
    assert.equal(init.headers.Authorization, "Bearer fixture-resend-test");
    const current = row();
    const notice = current.action_notice;
    assert.equal(notice.state, "pending");
    assert.ok(notice.first_dispatch_at && notice.payload, "durable before provider call");
    assert.equal(init.body, notice.payload);
    const key = init.headers["Idempotency-Key"];
    assert.equal(key, `calendar-action:test:${state.id}:${notice.id}`);
    if (state.providerStatus !== 200)
      return new Response("PRIVATE rejected provider response", { status: state.providerStatus });
    let accepted = state.provider.get(key);
    if (!accepted || state.elapsed - accepted.at >= 24 * 3600_000) {
      accepted = { id: "email_" + randomUUID(), at: state.elapsed, payload: init.body, key };
      state.provider.set(key, accepted);
      state.emails.push(accepted);
    }
    assert.equal(accepted.payload, init.body, "same immutable bytes under provider replay");
    if (state.recoverAfterAcceptance) recover();
    if (state.stopAfterAcceptance) state.canContinue = false;
    if (state.loseProvider-- > 0) throw new Error("PRIVATE accepted response lost");
    return Response.json({ id: accepted.id });
  },
};

try {
  run("initdb", ["-D", data, "-U", env.PGUSER, "-A", "trust", "--no-locale", "-E", "UTF8"]);
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
  const harness = await readFile(path.join(root, "scripts/test-db-bucket3-local.sh"), "utf8");
  const begin = harness.indexOf("psql -v ON_ERROR_STOP=1 <<'SQL'");
  const end = harness.indexOf("\n# Exercise actual RPC execution");
  assert.ok(begin > 0 && end > begin);
  const replay = harness.slice(begin, end);
  run("bash", [
    "-c",
    'set -euo pipefail\nROOT="$1"\nLOG=/dev/null\n' + replay,
    "calendar-notice-replay",
    root,
  ]);
  assert.equal(
    sql(
      "select pg_get_userbyid(proowner) from pg_proc where oid='public.claim_calendar_action_notice(text,uuid)'::regprocedure",
    ),
    "booking_test_owner",
  );
  env.PGOPTIONS += " -c role=booking_test_owner";
  const output = run("psql", [
    "-X",
    "-Atq",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "supabase/tests/calendar-action-notifications.sql",
  ]);
  assert.match(output, /roles, episodes, fences, recovery, dispatch lifetime and review passed/);
  console.log("PASS: full local migration chain and SQL notice authority/lifecycle suite");
  for (const name of ["google-calendar-lifetime", "booking-notification-lifetime"])
    run("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", `supabase/tests/${name}.sql`]);
  const cutoverTenant = sql(
    "insert into public.profiles(license_number,email,environment) values('NOTICE-BYSTANDER-CUTOVER','cutover@example.test','test') returning id",
  );
  const preflight = sql(
    `select public.capture_booking_cutover_preflight_v3('${cutoverTenant}','test')`,
  );
  sql(`select (public.prepare_booking_convergence_cutover('${cutoverTenant}','test')).id`);
  assert.equal(sql(`select public.activate_booking_cutover_v3('${preflight}')`), "t");
  const ownerOptions = env.PGOPTIONS;
  env.PGOPTIONS = "-c client_min_messages=warning"; // Existing suite uses local dblink fixture administration.
  run("psql", [
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    `cutover_tenant=${cutoverTenant}`,
    "-f",
    "supabase/tests/booking-calendar-lifetime.sql",
  ]);
  env.PGOPTIONS = ownerOptions;
  console.log(
    "PASS: existing Google/booking/calendar-notification SQL lifecycles with the new connection trigger installed",
  );

  const mocks = {
    "@tanstack/react-router": "export const createFileRoute=()=>config=>config;",
    "@/integrations/supabase/client.server":
      "export const supabaseAdmin={rpc:(...args)=>globalThis.__calendarObservability.rpc(...args)};",
    "@/lib/generation-observability.server":
      "export const collectGenerationObservability=async()=>globalThis.__calendarObservability.generation();",
  };
  const route = await importWithMocks(
    path.join(root, "src/routes/api/cron/generation-monitor.ts"),
    mocks,
  );
  bundles.push(route);
  const deadlinePath = JSON.stringify(path.join(root, "src/lib/worker-deadline.server.ts"));
  const library = await importWithMocks(
    path.join(root, "src/lib/calendar-observability.server.ts"),
    {
      "@/lib/worker-deadline.server": `
      export { withWorkerDeadline, workerCanContinue, workerProviderFetch } from ${deadlinePath};
      import { withWorkerDeadline } from ${deadlinePath};
      globalThis.__calendarObservability.withWorkerDeadline = withWorkerDeadline;
    `,
    },
  );
  bundles.push(library);
  globalThis.fetch = (...args) => globalThis.__calendarObservability.http(...args);
  const monitor = async (authorized = true, body = {}) => {
    const response = await route.subject.Route.server.handlers.POST({
      request: new Request("https://obratech.co/api/cron/generation-monitor", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(authorized ? { authorization: "Bearer fixture-monitor-secret" } : {}),
        },
        body: JSON.stringify(body),
      }),
    });
    return { status: response.status, body: await response.json() };
  };

  // Actual constrained definer/RLS and evaluator. No foreign-visibility policy.
  const recorderSnapshot = (name, requestId = null) => `
    set local role service_role;
    select jsonb_build_object('name',${literal(name)},
      'expected_response_at',(select responded_at from public.background_job_cron_requests where request_id=${literal(requestId)}),
      'health',public.get_calendar_worker_health('test'),'notices',public.get_calendar_action_notice_health('test'));
    reset role;`;
  const recorderReports = sql(`begin;
    do $$begin
      perform cron.unschedule(j.jobid) from cron.job j where j.username=current_user and j.jobname in(
        'obra-record-background-job-responses','obra-calendar-test-google','obra-calendar-test-stripe',
        'obra-calendar-test-booking-core','obra-calendar-test-booking-notifications');
      if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner cross join pg_class c
        where p.oid='public.get_calendar_worker_health(text)'::regprocedure and c.oid='cron.job'::regclass
          and p.prosecdef and not(r.rolsuper or r.rolbypassrls) and p.proowner<>c.relowner
          and not pg_has_role(p.proowner,c.relowner,'MEMBER')) then
        raise exception 'recorder regression requires a constrained health definer';end if;
      perform public.assert_calendar_worker_cron_privileges();
    end $$;
    delete from public.background_job_cron_requests where id is not null;
    delete from public.booking_worker_family_leases_v3 where environment='test' and family in('core','notifications');
    ${recorderSnapshot("empty")}
    set local role calendar_prior_owner;
    do $$begin
      perform cron.schedule('obra-record-background-job-responses','* * * * *','select 1;');
      perform cron.schedule('obra-record-background-job-responses-unrelated','* * * * *','select 2;');
      perform cron.schedule('obra-calendar-test-google','* * * * *','select 3;');
    end $$;
    reset role;
    do $$begin
      if exists(select 1 from cron.job where username='calendar_prior_owner') then
        raise exception 'foreign recorder or worker rows became visible';end if;
    end $$;
    ${recorderSnapshot("foreign-active-empty")}
    set local role none;
    update cron.job set active=false where jobname='obra-record-background-job-responses' and username='calendar_prior_owner';
    create temporary table recorder_before as select * from cron.job where username='calendar_prior_owner';
    reset role;
    ${recorderSnapshot("foreign-inactive-empty")}
    insert into public.background_job_cron_requests(schedule_name,request_id,requested_at,responded_at,status_code,timed_out)
      values('obra-calendar-live-stripe',900008,clock_timestamp()-interval '17 minutes',clock_timestamp()-interval '16 minutes',200,false);
    ${recorderSnapshot("unknown-stale", 900008)}
    update public.background_job_cron_requests set responded_at=clock_timestamp() where request_id=900008;
    ${recorderSnapshot("unknown-fresh", 900008)}
    insert into public.background_job_cron_requests(schedule_name,request_id,requested_at,responded_at,status_code,timed_out,error_message)
      values('fixture-shared-worker',900009,clock_timestamp()-interval '1 minute',clock_timestamp(),503,false,'PRIVATE failed response'),
        ('fixture-future-worker',900010,clock_timestamp(),clock_timestamp()+interval '1 day',200,false,null),
        ('fixture-pending-worker',900011,clock_timestamp(),null,null,null,null);
    ${recorderSnapshot("unknown-fresh-failed", 900009)}
    do $$begin
      perform public.register_calendar_worker_schedules('test');
      perform cron.alter_job(j.jobid,active:=true) from cron.job j where j.username=current_user and j.jobname in(
        'obra-calendar-test-google','obra-calendar-test-stripe','obra-calendar-test-booking-core','obra-calendar-test-booking-notifications');
    end $$;
    set local role none;
    insert into net._http_response(id,status_code,content,timed_out,created) values
      (900007,503,'{"outcome":"failed","environment":"test","scheduleName":"obra-calendar-test-google","failed":1,"private":"PRIVATE worker response"}',false,clock_timestamp());
    reset role;
    insert into public.background_job_cron_requests(schedule_name,request_id,requested_at)
      values('obra-calendar-test-google',900007,clock_timestamp());
    update public.background_job_cron_requests set responded_at=clock_timestamp(),status_code=503,timed_out=false where request_id=900007;
    ${recorderSnapshot("unknown-worker-failed", 900007)}
    do $$declare recorder_id bigint;begin
      recorder_id:=cron.schedule('obra-record-background-job-responses','* * * * *','select 1;');
      perform cron.alter_job(recorder_id,active:=false);
    end $$;
    ${recorderSnapshot("owned-inactive", 900007)}
    do $$begin
      perform cron.unschedule(j.jobid) from cron.job j where j.username=current_user and j.jobname='obra-record-background-job-responses';
    end $$;
    ${recorderSnapshot("unknown-after-inactive", 900007)}
    do $$begin
      perform cron.schedule('obra-record-background-job-responses','* * * * *','select 1;');
    end $$;
    ${recorderSnapshot("owned-active", 900007)}
    set local role none;
    do $$begin
      if exists(select * from recorder_before except select * from cron.job)
        or exists(select * from cron.job where username='calendar_prior_owner' except select * from recorder_before) then
        raise exception 'health or owned registration changed foreign recorder/worker fixtures';end if;
    end $$;
    rollback;`)
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(recorderReports.length, 10);
  for (const { name, health, notices, expected_response_at } of recorderReports) {
    const owned = name.startsWith("owned-");
    const expected = {
      registered: owned ? true : null,
      active: owned ? name === "owned-active" : null,
      last_recorded_response_at: expected_response_at,
    };
    assert.deepEqual(health.scheduler_scope, {
      owner: "booking_test_owner",
      visibility: "owner_only",
    });
    assert.deepEqual(health.response_recorder, expected, name);
    if (expected_response_at !== null)
      assert.ok(Date.parse(expected_response_at) <= Date.parse(health.observed_at));
    if (name === "unknown-stale")
      assert.ok(Date.parse(health.observed_at) - Date.parse(expected_response_at) >= 900_000);
    if (name === "unknown-fresh" || name === "unknown-fresh-failed")
      assert.ok(Date.parse(health.observed_at) - Date.parse(expected_response_at) < 60_000);
    const report = library.subject.evaluateCalendarObservability("test", health, notices);
    assert.deepEqual(report.schedulerScope, health.scheduler_scope);
    assert.deepEqual(report.responseRecorder, expected);
    assert.deepEqual(
      report.schedules.map((s) => s.schedule_name).sort(),
      ["google", "stripe", "booking-core", "booking-notifications"]
        .map((worker) => `obra-calendar-test-${worker}`)
        .sort(),
      "foreign identities never replace or duplicate the four fixed schedule names",
    );
    const recorderCondition = report.alerts.find((a) => a.id === "response-recorder");
    if (owned) {
      assert.equal(recorderCondition.status, expected.active ? "resolved" : "firing");
      assert.equal(recorderCondition.severity, "critical");
      assert.equal(recorderCondition.summary, "Owned calendar response recorder is inactive");
      assert.equal(recorderCondition.dedupeKey, "calendar:test:response-recorder");
    } else {
      assert.equal(
        recorderCondition,
        undefined,
        name + ": unknown is omitted, never firing or zero-valued resolved",
      );
    }
    for (const worker of ["stripe", "booking-core", "booking-notifications"])
      for (const condition of [
        "dispatch",
        "completion",
        ...(worker.startsWith("booking-") ? ["start"] : []),
      ])
        assert.equal(
          report.alerts.find((a) => a.id === `${worker}:${condition}`).status,
          "firing",
          name,
        );
    if (
      [
        "unknown-worker-failed",
        "owned-inactive",
        "unknown-after-inactive",
        "owned-active",
      ].includes(name)
    ) {
      assert.ok(report.schedules.every((s) => s.registered && s.active));
      assert.equal(
        report.schedules.find((s) => s.schedule_name === "obra-calendar-test-google")
          .worker_outcome,
        "failed",
      );
      assert.equal(
        report.alerts.find((a) => a.id === "google:outcome").status,
        "firing",
        "shared evidence and owned active config never clear worker failure",
      );
    } else {
      assert.ok(report.schedules.every((s) => !s.registered && !s.active));
      assert.equal(report.alerts.find((a) => a.id === "google:schedule").status, "firing");
      assert.equal(report.alerts.find((a) => a.id === "google:dispatch").status, "firing");
      assert.equal(report.alerts.find((a) => a.id === "google:completion").status, "firing");
    }
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  }
  state.requests = [];
  let retainedRecorderAlarm;
  for (const name of ["owned-inactive", "unknown-after-inactive", "owned-active"]) {
    const { health, notices } = recorderReports.find((item) => item.name === name);
    const report = library.subject.evaluateCalendarObservability("test", health, notices);
    await library.subject.deliverCalendarAlertStates(report.alerts);
    const delivered = state.operator.alerts.find((a) => a.id === "response-recorder");
    if (delivered) retainedRecorderAlarm = delivered;
    else assert.equal(name, "unknown-after-inactive");
    assert.equal(retainedRecorderAlarm.status, name === "owned-active" ? "resolved" : "firing");
  }
  console.log(
    "PASS: owner-only SQL -> evaluator -> adapter: unknown empty/stale/fresh/failed recording omits recorder condition and retains prior alarm; owned inactive fires/active resolves config only; shared/future evidence never clears worker absence/failure; four names and foreign jobs preserved",
  );

  // Real denial -> temporary observation -> full-calendar recovery. Current advice
  // eligibility may pause, but the same incident/queued dispatch must not disappear.
  for (const phase of ["pending", "unknown", "rejected", "accepted"]) {
    fixture(null);
    const baseline = JSON.parse(
      sql("set role service_role;select public.get_calendar_action_notice_health('test')"),
    );
    const verificationLease = randomUUID();
    sql(`insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,
      access_role,blocks_availability,receives_bookings,permission_verified_at)
      values(${literal(state.id)},${literal(state.profile)},'test','retained-destination','Retained destination','owner',true,true,clock_timestamp());`);
    const verification = JSON.parse(
      sql(`set role service_role;
      select public.claim_saved_google_calendar_verification(${literal(state.profile)},'test',${literal(verificationLease)},90,false)`),
    );
    const verificationFence = `${literal(verification.binding.id)},${literal(verificationLease)},${verification.binding.reconciliation_fencing_token}`;
    sql(`set role service_role;
      select public.mark_google_calendar_connection_verified(${verificationFence},clock_timestamp(),'[{"id":"retained-destination","accessRole":"owner"}]');
      select public.mark_google_calendar_connection_unhealthy(${verificationFence},false,'calendar_permissions_changed');`);
    const incidentId = row().action_notice.id;
    const lastSuccess = row().last_verified_at;
    if (phase === "pending") process.env.CALENDAR_ACTION_NOTICES_ENABLED = "false";
    if (phase === "unknown") state.loseProvider = 1;
    if (phase === "rejected") state.providerStatus = 401;
    let response = await monitor();
    assert.equal(response.status, ["unknown", "rejected"].includes(phase) ? 503 : 200);
    process.env.CALENDAR_ACTION_NOTICES_ENABLED = "true";
    const initialAlert = state.operator.alerts.find((a) => a.id === "connection:action-required");
    assert.equal(initialAlert.status, "firing");
    const expectedEmails = ["unknown", "accepted"].includes(phase) ? 1 : 0;
    assert.equal(state.emails.length, expectedEmails);
    makeDue();
    const frozen = row().action_notice;
    assert.equal(frozen.id, incidentId);
    if (phase !== "pending") assert.ok(frozen.payload && frozen.first_dispatch_at);
    sql(`set role service_role;
      select public.mark_google_calendar_connection_unhealthy(${verificationFence},false,'provider_temporary_failure');`);
    assert.deepEqual(
      row().action_notice,
      frozen,
      "temporary evidence preserves the exact incident and frozen bytes",
    );
    assert.equal(
      row().last_verified_at,
      lastSuccess,
      "temporary observation does not advance successful evidence",
    );
    const paused = JSON.parse(
      sql("set role service_role;select public.get_calendar_action_notice_health('test')"),
    );
    assert.equal(paused.action_required_count, baseline.action_required_count + 1);
    assert.equal(
      paused.pending_count,
      baseline.pending_count + Number(["pending", "unknown"].includes(phase)),
    );
    assert.equal(paused.items.find((item) => item.notice_id === incidentId).closed_at, null);
    assert.equal(paused.items.find((item) => item.notice_id === incidentId).cause, "permissions");
    response = await monitor();
    assert.equal(response.status, 200, "paused advice is not a failed monitor pass");
    const pausedAlert = state.operator.alerts.find((a) => a.id === "connection:action-required");
    assert.equal(pausedAlert.status, "firing", phase + " incident cannot falsely resolve");
    assert.equal(pausedAlert.dedupeKey, initialAlert.dedupeKey);
    assert.deepEqual(row().action_notice, frozen);
    const sends = state.requests.filter(
      (request) => request.url === "https://api.resend.com/emails",
    ).length;
    assert.equal(
      sends,
      phase === "pending" ? 0 : 1,
      "no stale permission email during a temporary observation",
    );

    if (phase === "unknown") {
      for (const name of ["get_calendar_worker_health", "get_calendar_action_notice_health"]) {
        for (const read of [1, 2]) {
          state.failSnapshotRead = {
            name,
            at: state.calls.filter((call) => call.name === name).length + read,
          };
          response = await monitor();
          assert.equal(
            response.status,
            503,
            "initial/final shared assessment read failure is unknown",
          );
          assert.equal(
            state.operator.alerts.find((a) => a.id === "assessment-unavailable").status,
            "firing",
          );
          assert.ok(
            !state.operator.alerts.some((a) => a.id === "connection:action-required"),
            "failed snapshot cannot emit a fabricated resolution",
          );
          state.failSnapshotRead = null;
          await monitor();
          assert.equal(
            state.operator.alerts.find((a) => a.id === "connection:action-required").status,
            "firing",
          );
          assert.deepEqual(row().action_notice, frozen);
        }
      }
    }

    sql(`set role service_role;
      select public.mark_google_calendar_connection_verified(${verificationFence},clock_timestamp(),'[{"id":"retained-destination","accessRole":"owner"}]');`);
    const closed = row().action_notice;
    assert.equal(closed.id, incidentId);
    assert.ok(closed.closed_at);
    assert.deepEqual(closed.scope, frozen.scope);
    assert.equal(closed.payload, frozen.payload);
    assert.equal(closed.first_dispatch_at, frozen.first_dispatch_at);
    assert.ok(
      Date.parse(row().last_verified_at) > Date.parse(lastSuccess),
      "full verified recovery advances successful evidence",
    );
    await monitor();
    const recoveredAlert = state.operator.alerts.find((a) => a.id === "connection:action-required");
    assert.equal(recoveredAlert.status, "resolved");
    assert.equal(recoveredAlert.dedupeKey, initialAlert.dedupeKey);
    if (["unknown", "rejected"].includes(phase)) {
      assert.equal(closed.state, "review");
      assert.equal(
        state.operator.alerts.find((a) => a.id === "action-notices:review").status,
        "firing",
        "incident recovery is not proof of email delivery",
      );
    }
    await monitor();
    assert.equal(
      state.emails.length,
      expectedEmails,
      "recovery and repeated polls never duplicate the original message",
    );
    assert.equal(
      state.requests.filter((request) => request.url === "https://api.resend.com/emails").length,
      sends,
    );
    const oldDelivery = row().action_notice;
    const recoveredAt = row().last_verified_at;
    // Reproduce a later denial after the first incident has closed. Old review
    // remains a delivery fact, not storage for the new permission incident.
    for (const changedRevision of [false, true]) {
      if (changedRevision)
        sql(
          `update public.calendar_connections set connection_revision=connection_revision+1 where id=${literal(state.id)};`,
        );
      sql(`update public.pipedream_bindings set reconciliation_due_at=clock_timestamp(),
        reconciliation_lease_expires_at=clock_timestamp()-interval '1 second' where connection_id=${literal(state.id)};`);
      const nextLease = randomUUID();
      const next = JSON.parse(
        sql(`set role service_role;
        select public.claim_saved_google_calendar_verification(${literal(state.profile)},'test',${literal(nextLease)},90,false)`),
      );
      const nextFence = `${literal(next.binding.id)},${literal(nextLease)},${next.binding.reconciliation_fencing_token}`;
      const priorIncident = row().action_notice.current_incident;
      const lastSuccess = row().last_verified_at;
      sql(`set role service_role;
        select public.mark_google_calendar_connection_unhealthy(${nextFence},false,'calendar_permissions_changed');`);
      const recurrent = row().action_notice.current_incident;
      assert.notEqual(
        recurrent.id,
        priorIncident.id,
        "a new definite episode receives a separate identity",
      );
      assert.equal(recurrent.closed_at, undefined);
      assert.equal(recurrent.scope.connection_revision, next.connection.connection_revision);
      const retainedDelivery = row().action_notice;
      if (["unknown", "rejected"].includes(phase)) {
        const { current_incident: _previous, ...oldFacts } = oldDelivery;
        const { current_incident: _current, ...retainedFacts } = retainedDelivery;
        assert.deepEqual(
          retainedFacts,
          oldFacts,
          "recurrence cannot rewrite old review/payload/remedy",
        );
        assert.notEqual(retainedDelivery.id, recurrent.id);
      }
      sql(`set role service_role;
        select public.mark_google_calendar_connection_unhealthy(${nextFence},false,'provider_temporary_failure');`);
      const recurrenceHealth = JSON.parse(
        sql("set role service_role;select public.get_calendar_action_notice_health('test')"),
      );
      assert.equal(recurrenceHealth.action_required_count, baseline.action_required_count + 1);
      const item = recurrenceHealth.items.find((item) => item.connection_id === state.id);
      assert.deepEqual(item.current_incident, {
        id: recurrent.id,
        cause: "permissions",
        source: "saved",
        opened_at: recurrent.opened_at,
        closed_at: null,
      });
      assert.equal(
        item.notice_id,
        retainedDelivery.id,
        "DTO names old delivery separately from the current incident",
      );
      assert.equal(row().last_verified_at, lastSuccess);
      await monitor();
      assert.equal(
        state.operator.alerts.find((a) => a.id === "connection:action-required").status,
        "firing",
      );
      assert.deepEqual(row().action_notice.current_incident, recurrent);
      assert.equal(
        state.requests.filter((request) => request.url === "https://api.resend.com/emails").length,
        sends,
      );
      sql(`set role service_role;
        select public.mark_google_calendar_connection_verified(${nextFence},clock_timestamp(),'[{"id":"retained-destination","accessRole":"owner"}]');`);
      assert.equal(row().action_notice.current_incident.id, recurrent.id);
      assert.ok(row().action_notice.current_incident.closed_at);
      assert.ok(Date.parse(row().last_verified_at) > Date.parse(recoveredAt));
      await monitor();
      assert.equal(
        state.operator.alerts.find((a) => a.id === "connection:action-required").status,
        "resolved",
      );
      assert.equal(
        state.requests.filter((request) => request.url === "https://api.resend.com/emails").length,
        sends,
      );
    }
  }
  console.log(
    "PASS: retained and recurrent SQL incidents -> actual evaluator/monitor: pending/unknown/rejected/accepted delivery remains separate from same/new-revision incident; temporary evidence never clears; fresh verification resolves; frozen dispatch/no duplicate; failed snapshots stay unknown",
  );

  fixture();
  assert.equal((await monitor(false)).status, 401);
  assert.equal(state.calls.length, 0);
  assert.equal(state.requests.length, 0);
  process.env.GENERATION_MONITOR_SECRET = "";
  assert.equal((await monitor()).status, 401);
  assert.equal(state.calls.length, 0);
  process.env.GENERATION_MONITOR_SECRET = "fixture-monitor-secret";
  console.log("PASS: missing/bad monitor auth cannot inspect health or send email");

  let result = await monitor(true, {
    webhookUrl: "https://untrusted.example.test",
    environment: "live",
  });
  assert.equal(result.status, 200);
  assert.equal(state.emails.length, 1);
  let email = JSON.parse(state.emails[0].payload);
  assert.deepEqual(email.to, [state.email]);
  assert.match(email.text, /permissions.*choose an accessible calendar/);
  assert.match(email.text, /https:\/\/obratech.co\/login/);
  assert.doesNotMatch(email.text, /never-email|PRIVATE|token|guarantee|invitation.*delivered/);
  assert.equal(row().action_notice.state, "accepted");
  assert.equal(
    sql(`select count(*) from public.appointments where profile_id=${literal(state.profile)}`),
    "0",
  );
  assert.equal(state.generationDeliveries, 1);
  assert.equal(state.operator.source, "obra.calendar");
  assert.ok(
    state.operator.alerts.every(
      (a) => a.dedupeKey.startsWith("calendar:test:") && !a.dedupeKey.includes("generation"),
    ),
  );
  assert.equal(
    state.operator.alerts.find((a) => a.id === "google:schedule").status,
    "firing",
    "missing inactive schedules alert even without due work",
  );
  assert.equal(
    state.operator.alerts.find((a) => a.id === "action-notices:delivery").status,
    "resolved",
  );
  assert.ok(
    !JSON.stringify(state.operator).includes("fixture-webhook-token"),
    "routing configuration cannot leak into alert bodies",
  );
  await monitor();
  assert.equal(state.emails.length, 1, "successive monitors do not resend the same episode");
  const retained = row().action_notice;
  run("psql", [
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "supabase/migrations/20260910150000_calendar_action_notifications.sql",
  ]);
  assert.deepEqual(
    row().action_notice,
    retained,
    "idempotent publish preserves accepted dispatch facts and incident identity",
  );
  console.log(
    "PASS: real monitor sends to offline verified profile without appointments; correct namespace/operator state and publish replay",
  );

  for (const reason of [
    "provider_temporary_failure",
    "provider_platform_error",
    "provider_configuration_error",
    "provider_account_unhealthy",
    "provider_account_missing",
    "verification_stale",
  ]) {
    fixture(reason);
    result = await monitor();
    assert.equal(result.status, 200);
    assert.equal(state.emails.length, 0, reason);
    if (reason === "provider_platform_error" || reason === "provider_configuration_error")
      assert.equal(
        state.operator.alerts.find((a) => a.id === "connection:platform").status,
        "firing",
      );
  }
  fixture("provider_reauthorization_required");
  sql(
    `update public.calendar_connections set disconnected_at=now(),reconnect_reason='provider_reauthorization_required' where id=${literal(state.id)}`,
  );
  await monitor();
  assert.equal(state.emails.length, 1);
  assert.match(JSON.parse(state.emails[0].payload).text, /renewed authorization.*reconnect Google/);
  fixture("provider_temporary_failure");
  sql(`update public.calendar_connections set pipedream_account_id=null,setup_operation_id=gen_random_uuid(),setup_actor_auth_user_id=${literal(state.owner)},
    setup_expected_revision=connection_revision,setup_account_id='apn_setup_runtime',setup_probe_account_id='apn_setup_runtime',
    setup_calendar_id='runtime-destination',setup_probe_calendar_id='runtime-destination',
    setup_calendars='[{"id":"runtime-destination","blocksAvailability":true,"receivesBookings":true}]'::jsonb,
    setup_failure_reason='permissions',setup_retry_at=now()-interval '3 minutes'
    where id=${literal(state.id)}`);
  await monitor();
  assert.equal(state.emails.length, 1);
  assert.match(JSON.parse(state.emails[0].payload).text, /setup has not completed/);
  assert.equal(state.operator.alerts.find((a) => a.id === "setup:overdue").status, "firing");
  sql(
    `update public.calendar_connections set setup_completed_at=now(),setup_failure_reason=null,action_notice_lease_expires_at=now()-interval '1 second' where id=${literal(state.id)}`,
  );
  sql(
    `update public.calendar_connections set setup_completed_at=null,setup_operation_id=gen_random_uuid(),setup_failure_reason='configuration' where id=${literal(state.id)}`,
  );
  await monitor();
  assert.equal(state.emails.length, 2);
  assert.match(
    JSON.parse(state.emails[1].payload).text,
    /configuration or verification needs attention/,
  );
  assert.doesNotMatch(JSON.parse(state.emails[1].payload).text, /reconnect Google/);
  console.log(
    "PASS: actual setup due/action and confirmed consent versus platform/temporary classification",
  );

  fixture();
  state.failSettlement = 2;
  result = await monitor();
  assert.equal(result.status, 200);
  assert.equal(state.emails.length, 1);
  assert.equal(row().action_notice.state, "accepted");
  assert.equal(state.calls.filter((c) => c.args.p_action === "accepted").length, 3);
  fixture();
  state.loseSettlement = 1;
  state.recoverAfterAcceptance = true;
  result = await monitor();
  assert.equal(result.status, 200);
  assert.equal(state.emails.length, 1);
  assert.equal(row().action_notice.state, "accepted");
  assert.ok(row().action_notice.closed_at);
  fixture();
  state.failSettlement = 3;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.emails.length, 1);
  assert.equal(
    state.operator.alerts.find((a) => a.id === "action-notices:delivery").status,
    "firing",
  );
  makeDue(48);
  await monitor();
  assert.equal(state.emails.length, 1);
  assert.equal(row().action_notice.state, "review");
  console.log(
    "PASS: known acceptance retries DB only, including commit-response loss and recovery; partial settlement fails visibly",
  );

  fixture();
  state.stopAfterAcceptance = true;
  state.failSettlement = 1;
  const directAdmin = { rpc: (...args) => globalThis.__calendarObservability.rpc(...args) };
  const directResult = await globalThis.__calendarObservability.withWorkerDeadline(
    Date.now() + 30_000,
    () => library.subject.processCalendarActionNotices(directAdmin, "test"),
    { canContinue: () => state.canContinue },
  );
  assert.equal(directResult.accepted, 1);
  assert.equal(row().action_notice.state, "accepted");
  assert.equal(
    state.calls.filter((call) => call.name === "claim_calendar_action_notice").length,
    1,
    "known acceptance settles DB-only after provider continuation stops; no subsequent claim",
  );

  fixture();
  state.loseProvider = 1;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.emails.length, 1);
  const frozen = row().action_notice;
  makeDue(1);
  process.env.BOOKING_EMAIL_FROM_TEST = "changed@example.test";
  await monitor();
  assert.equal(state.emails.length, 1);
  assert.equal(row().action_notice.state, "accepted");
  assert.equal(
    row().action_notice.payload,
    frozen.payload,
    "sender/payload stays frozen across deployment change",
  );
  process.env.BOOKING_EMAIL_FROM_TEST = "Obra <calendar@example.test>";
  fixture();
  state.loseProvider = 1;
  await monitor();
  makeDue(48);
  await monitor();
  assert.equal(state.emails.length, 1);
  assert.equal(row().action_notice.review_reason, "idempotency_expired");
  assert.equal(
    state.operator.alerts.find((a) => a.id === "action-notices:review").status,
    "firing",
  );
  const retainedReview = row().action_notice;
  run("psql", [
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "supabase/migrations/20260910150000_calendar_action_notifications.sql",
  ]);
  assert.deepEqual(
    row().action_notice,
    retainedReview,
    "publishing again cannot reset expired acceptance review or frozen payload",
  );
  fixture();
  state.recoverBeforeAuth = true;
  result = await monitor();
  assert.equal(result.status, 200);
  assert.equal(state.emails.length, 0);
  assert.equal(row().action_notice.state, "suppressed");
  fixture();
  state.loseFenceBeforeAuth = true;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.emails.length, 0);
  console.log(
    "PASS: within-window stable replay, no 48-hour duplicate, recovered unsent suppression and stale dispatch fence",
  );

  fixture();
  state.failClaim = true;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.emails.length, 0);
  assert.equal(
    state.operator.alerts.find((a) => a.id === "action-notices:delivery").status,
    "firing",
  );
  fixture();
  state.providerStatus = 401;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.emails.length, 0);
  assert.equal(row().action_notice.review_reason, "provider_rejected");
  assert.equal(
    row().verification_reason,
    "calendar_permissions_changed",
    "Resend 401 cannot invent Google revocation",
  );
  assert.equal(
    state.operator.alerts.find((a) => a.id === "action-notices:review").status,
    "firing",
  );
  fixture("provider_account_missing");
  sql(
    `update public.calendar_connections set health_state='disconnected',disconnected_at=now(),last_verified_at=now()-interval '16 minutes' where id=${literal(state.id)}`,
  );
  result = await monitor();
  assert.equal(result.status, 200);
  assert.equal(state.emails.length, 0);
  assert.equal(
    state.operator.alerts.find((a) => a.id === "connection:unverified").status,
    "firing",
  );

  fixture();
  state.failHealth = true;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.generationDeliveries, 1);
  assert.equal(
    state.operator.alerts.find((a) => a.id === "assessment-unavailable").status,
    "firing",
  );
  assert.ok(
    !state.operator.alerts.some((a) => a.id === "google:schedule" && a.status === "resolved"),
  );
  fixture();
  state.failNoticeHealth = true;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.generationDeliveries, 1);
  fixture();
  state.generationFails = true;
  result = await monitor();
  assert.equal(result.status, 500);
  assert.equal(state.emails.length, 1);
  assert.ok(state.operator);
  fixture();
  delete process.env.GENERATION_ALERT_WEBHOOK_URL;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.emails.length, 1);
  assert.ok(state.operator);
  process.env.GENERATION_ALERT_WEBHOOK_URL = "https://generation.example.test/alerts";
  fixture();
  state.failWebhook = true;
  result = await monitor();
  assert.equal(result.status, 503);
  assert.equal(state.generationDeliveries, 1);
  console.log(
    "PASS: independent generation/calendar execution and assessment failure never reports no alerts",
  );

  const admin = await importWithMocks(path.join(root, "src/lib/admin-observability.functions.ts"), {
    ...mocks,
    "@tanstack/react-start": `
      export const createMiddleware=()=>({server:fn=>fn});
      export function createServerFn() { let middleware=[];return {middleware(value){middleware=value;return this;},
        handler(fn){return async()=>{let i=0;const next=()=>i<middleware.length?middleware[i++]({next}):fn();return next();};}}; }
    `,
    "./admin-session.server": `export async function requireAdminSession(){if(!globalThis.__calendarObservability.adminAuthorized) throw new Error("Forbidden");}
      export const isAdminSessionValid=async()=>false;`,
  });
  bundles.push(admin);
  fixture();
  globalThis.__calendarObservability.adminAuthorized = false;
  await assert.rejects(() => admin.subject.getCalendarObservability(), /Forbidden/);
  assert.equal(state.calls.length, 0);
  assert.equal(state.requests.length, 0);
  globalThis.__calendarObservability.adminAuthorized = true;
  let adminReport = await admin.subject.getCalendarObservability();
  assert.equal(adminReport.outcome, "available");
  assert.equal(adminReport.report.actionNotices.action_required_count > 0, true);
  assert.ok(state.calls.every((call) => call.name.startsWith("get_")));
  assert.equal(state.requests.length, 0, "dashboard is read-only; it cannot send email");
  assert.ok(
    !JSON.stringify(adminReport).includes(state.email),
    "admin projection does not return recipient or payload",
  );
  state.failHealth = true;
  adminReport = await admin.subject.getCalendarObservability();
  assert.equal(adminReport.outcome, "unavailable");
  assert.match(adminReport.error, /unknown/);
  assert.ok(!adminReport.report);
  console.log(
    "PASS: actual admin middleware denies before data access; existing dashboard reader exposes safe status and explicit unknown, never sends",
  );

  for (const [key, value] of [
    ["CALENDAR_MONITOR_ENVIRONMENT", ""],
    ["CALENDAR_MONITOR_ENVIRONMENT", "LIVE"],
    ["CALENDAR_ALERT_WEBHOOK_URL", "http://operator.example.test/calendar"],
    ["CALENDAR_ALERT_WEBHOOK_URL", "https://user:password@operator.example.test/calendar"],
    ["CALENDAR_ALERT_OWNER", ""],
    ["CALENDAR_ALERT_CHANNEL", ""],
    ["CALENDAR_MONITOR_ENABLED", "1"],
    ["RESEND_API_KEY_TEST", ""],
    ["PUBLIC_APP_URL", "https://obra-tech.lovable.app"],
    ["PUBLIC_APP_URL", "http://obratech.co"],
    ["CALENDAR_ACTION_NOTICES_ENABLED", "1"],
  ]) {
    fixture();
    const saved = process.env[key];
    process.env[key] = value;
    result = await monitor();
    assert.equal(result.status, 503, key);
    assert.equal(state.emails.length, 0, key);
    assert.equal(state.generationDeliveries, 1, "calendar config cannot starve generation");
    process.env[key] = saved;
  }
  for (const flag of [undefined, "false", ""]) {
    fixture();
    if (flag === undefined) delete process.env.CALENDAR_MONITOR_ENABLED;
    else process.env.CALENDAR_MONITOR_ENABLED = flag;
    result = await monitor();
    assert.deepEqual(result, {
      status: 200,
      body: {
        observedAt: "2026-09-10T00:00:00.000Z",
        delivered: 0,
        destination: "#obra-generation-oncall",
        alerts: [],
      },
    });
    assert.equal(state.calls.length, 0);
    assert.equal(state.emails.length, 0);
  }
  delete process.env.GENERATION_ALERT_WEBHOOK_URL;
  result = await monitor();
  assert.deepEqual(result, {
    status: 503,
    body: { error: "GENERATION_ALERT_WEBHOOK_URL not configured" },
  });
  process.env.GENERATION_ALERT_WEBHOOK_URL = "https://generation.example.test/alerts";
  process.env.CALENDAR_MONITOR_ENABLED = "true";
  assert.ok(logs.every((line) => !line.includes("PRIVATE")));
  console.log(
    "PASS: fail-closed environment/sender/origin/webhook configuration and unchanged unconfigured-calendar generation contract",
  );

  // Pure threshold boundaries fed by the actual health RPC shape, not a invented API.
  fixture("provider_temporary_failure");
  const base = JSON.parse(sql("select public.get_calendar_worker_health('test')"));
  const noticeBase = JSON.parse(sql("select public.get_calendar_action_notice_health('test')"));
  const now = Date.parse(base.observed_at);
  const ago = (seconds) => new Date(now - seconds * 1000).toISOString();
  base.overdue_connections = [];
  base.binding_failures = {};
  base.row_failures = Object.fromEntries(Object.keys(base.row_failures).map((k) => [k, 0]));
  base.scheduler_scope = { owner: "booking_test_owner", visibility: "owner_only" };
  base.response_recorder = { registered: true, active: true, last_recorded_response_at: ago(30) };
  for (const s of base.schedules)
    Object.assign(s, {
      registered: true,
      active: true,
      command_matches: true,
      schedule_matches: true,
      last_dispatched_at: ago(30),
      last_responded_at: ago(30),
      last_authenticated_completed_at: ago(30),
      last_authenticated_requested_at: ago(40),
      oldest_unanswered_at: null,
      overdue_unanswered_count: 0,
      last_started_at: ago(30),
      last_completed_at: ago(30),
      last_success: true,
      transport_outcome: "succeeded",
      worker_outcome: "succeeded",
      worker_counts: { failed: 0 },
      status: "succeeded",
    });
  for (const inventory of Object.values(base.overdue_obligations))
    for (const key of Object.keys(inventory)) inventory[key] = key.endsWith("At") ? null : 0;
  for (const key of Object.keys(noticeBase))
    if (typeof noticeBase[key] === "number" && key !== "items_limit") noticeBase[key] = 0;
  noticeBase.items = [];
  const evaluate = (h = base, n = noticeBase) =>
    library.subject.evaluateCalendarObservability("test", h, n);
  const condition = (h, id) => evaluate(h).alerts.find((a) => a.id === id);
  assert.ok(evaluate().alerts.every((a) => a.status === "resolved"));
  const otherAlerts = evaluate().alerts.filter((a) => a.id !== "response-recorder");
  for (const lastRecorded of [null, ago(30), ago(86_400)]) {
    for (const [registered, active] of [
      [null, null],
      [true, false],
      [true, true],
    ]) {
      const h = structuredClone(base);
      h.response_recorder = { registered, active, last_recorded_response_at: lastRecorded };
      const report = evaluate(h);
      assert.deepEqual(report.responseRecorder, h.response_recorder);
      assert.deepEqual(report.schedulerScope, h.scheduler_scope);
      assert.deepEqual(
        report.alerts.filter((a) => a.id !== "response-recorder"),
        otherAlerts,
      );
      assert.equal(
        condition(h, "response-recorder")?.status,
        registered === null ? undefined : active ? "resolved" : "firing",
      );
    }
  }
  for (const schedulerScope of [
    undefined,
    null,
    {},
    { owner: "", visibility: "owner_only" },
    { owner: "booking_test_owner", visibility: "all" },
  ])
    assert.throws(() => evaluate({ ...base, scheduler_scope: schedulerScope }));
  for (const recorder of [
    undefined,
    null,
    {},
    { registered: true, active: true },
    { ...base.response_recorder, registered: false },
    { ...base.response_recorder, registered: null },
    { ...base.response_recorder, registered: null, active: false },
    { ...base.response_recorder, active: null },
    { ...base.response_recorder, active: "true" },
    { ...base.response_recorder, last_recorded_response_at: "not-an-ISO-timestamp" },
  ])
    assert.throws(
      () => evaluate({ ...base, response_recorder: recorder }),
      "malformed or inconsistent recorder evidence cannot resolve conditions",
    );
  const retainedItem = JSON.parse(
    sql("select public.get_calendar_action_notice_health('test')"),
  ).items.find((item) => item.current_incident.id !== item.notice_id);
  assert.ok(retainedItem, "actual SQL retains an old delivery beside a separate incident");
  const invalidIncident = { ...retainedItem, current_incident: null };
  assert.throws(
    () => evaluate(base, { ...noticeBase, items: [invalidIncident] }),
    "missing current incident is unknown, not an inferred resolved delivery",
  );
  for (const [seconds, expected] of [
    [179, "resolved"],
    [180, "firing"],
  ]) {
    const h = structuredClone(base);
    h.schedules[0].last_dispatched_at = ago(seconds);
    assert.equal(
      condition(h, h.schedules[0].schedule_name.replace("obra-calendar-test-", "") + ":dispatch")
        .status,
      expected,
    );
  }
  for (const [seconds, warning, critical] of [
    [119, "resolved", "resolved"],
    [120, "firing", "resolved"],
    [299, "firing", "resolved"],
    [300, "firing", "firing"],
  ]) {
    const h = structuredClone(base);
    Object.assign(h.overdue_obligations.calendar, {
      count: 1,
      oldestPendingAt: ago(seconds),
      oldestPendingAgeSeconds: seconds,
    });
    assert.equal(condition(h, "paid-calendar:pending").status, warning);
    assert.equal(condition(h, "paid-calendar:critical").status, critical);
  }
  for (const [seconds, expected] of [
    [899, "resolved"],
    [900, "firing"],
  ]) {
    const h = structuredClone(base);
    h.overdue_connections = [
      {
        provider: "google",
        environment: "test",
        id: state.id,
        profile_id: state.profile,
        last_success_at: ago(seconds),
        due_at: ago(120),
        overdue_seconds: 120,
        expired_lease_seconds: 120,
        attempts: 8,
        freshness_expired: seconds >= 900,
      },
    ];
    assert.equal(condition(h, "google:freshness").status, expected);
    assert.equal(condition(h, "google:verification-overdue").status, "firing");
    assert.equal(condition(h, "google:expired-lease").status, "firing");
  }
  let h = structuredClone(base);
  h.overdue_obligations.calendar.blockedCount = 1;
  assert.equal(condition(h, "paid-calendar:blocked").status, "firing");
  h = structuredClone(base);
  h.schedules[0].worker_outcome = "off";
  assert.equal(
    condition(h, h.schedules[0].schedule_name.replace("obra-calendar-test-", "") + ":outcome")
      .status,
    "firing",
  );
  h.schedules[0].worker_outcome = null;
  assert.equal(
    condition(h, h.schedules[0].schedule_name.replace("obra-calendar-test-", "") + ":outcome")
      .status,
    "firing",
  );
  h = structuredClone(base);
  h.schedules[0].last_authenticated_completed_at = ago(180);
  h.schedules[0].last_dispatched_at = ago(0);
  assert.equal(
    condition(h, h.schedules[0].schedule_name.replace("obra-calendar-test-", "") + ":completion")
      .status,
    "firing",
    "new pending dispatch cannot hide old missing completion",
  );
  assert.throws(() => evaluate({ ...base, overdue_obligations: {} }));
  assert.throws(() => evaluate({ ...base, environment: "live" }));
  assert.throws(() => evaluate(null));
  assert.throws(() => evaluate(base, null));
  assert.throws(() => evaluate({ ...base, binding_failures: null }));
  assert.throws(() => evaluate({ ...base, binding_failures: { private_provider_prose: 1 } }));
  assert.throws(() => evaluate({ ...base, binding_failures: { provider_platform_error: -1 } }));
  h = structuredClone(base);
  h.overdue_connections = Array.from({ length: 100 }, () => ({
    provider: "google",
    environment: "test",
    id: randomUUID(),
    profile_id: state.profile,
    last_success_at: ago(901),
    due_at: ago(121),
    overdue_seconds: 121,
    expired_lease_seconds: null,
    attempts: 0,
    freshness_expired: true,
  }));
  assert.equal(condition(h, "connection-inventory-limit").status, "firing");
  assert.equal(condition(h, "google:freshness").status, "firing");
  assert.equal(
    condition(h, "stripe:freshness"),
    undefined,
    "capped inventory cannot resolve an unseen provider condition",
  );
  h.binding_failures = { provider_platform_error: 125 };
  assert.equal(condition(h, "google:binding:provider_platform_error").value, 125);
  assert.equal(condition(h, "google:binding:provider_platform_error").status, "firing");
  h.binding_failures = {};
  assert.equal(
    condition(h, "google:binding:provider_platform_error").status,
    "resolved",
    "uncapped binding aggregate can resolve despite capped overdue inventory",
  );
  console.log(
    "PASS: actual RPC contract, 3m/2m/15m/5m boundaries, immediate blocker/off/transport-only, recovery resolution and malformed evidence",
  );

  // Fenced successful reads followed by trigger failure, then an idle cron result.
  // Account freshness must not replace persistent trigger failure evidence.
  fixture(null, "live");
  sql(`insert into public.calendar_selections(connection_id,profile_id,environment,google_calendar_id,display_name,
      access_role,blocks_availability,receives_bookings,permission_verified_at)
    values(${literal(state.id)},${literal(state.profile)},'live','monitor-destination','Monitor destination','owner',true,true,clock_timestamp());`);
  const bindingLease = randomUUID();
  let bindingClaim = JSON.parse(
    sql(`set role service_role;
    select public.claim_saved_google_calendar_verification(${literal(state.profile)},'live',${literal(bindingLease)},60,true)`),
  );
  const bindingId = bindingClaim.binding.id;
  sql(`set role service_role;
    select public.mark_google_calendar_connection_verified(${literal(bindingId)},${literal(bindingLease)},${bindingClaim.binding.reconciliation_fencing_token},
      clock_timestamp(),'[{"id":"monitor-destination","accessRole":"owner"}]');
    select public.fail_pipedream_binding_reconciliation(${literal(bindingId)},${literal(bindingLease)},${bindingClaim.binding.reconciliation_fencing_token},'provider_platform_error');
    select * from public.register_calendar_worker_schedules('live');`);
  sql(`select cron.alter_job(jobid,active:=true) from cron.job where jobname like 'obra-calendar-live-%';
    set role none;
    insert into net._http_response(id,status_code,content,timed_out,created) values
      (900003,200,'{"outcome":"partial_failure","environment":"live","scheduleName":"obra-calendar-live-google","failed":1}',false,clock_timestamp());
    reset role;
    insert into public.background_job_cron_requests(schedule_name,request_id,requested_at)
      values('obra-calendar-live-google',900003,clock_timestamp()-interval '1 minute');
    update public.background_job_cron_requests set responded_at=clock_timestamp(),status_code=200,timed_out=false where request_id=900003;`);
  const bindingReport = () =>
    library.subject.evaluateCalendarObservability(
      "live",
      JSON.parse(sql("set role service_role;select public.get_calendar_worker_health('live')")),
      JSON.parse(
        sql("set role service_role;select public.get_calendar_action_notice_health('live')"),
      ),
    );
  const bindingCondition = (report) =>
    report.alerts.find((a) => a.id === "google:binding:provider_platform_error");
  const failedBindingReport = bindingReport();
  assert.equal(failedBindingReport.alerts.find((a) => a.id === "google:outcome").status, "firing");
  assert.equal(bindingCondition(failedBindingReport).status, "firing");
  sql(`set role none;
    insert into net._http_response(id,status_code,content,timed_out,created) values
      (900004,200,'{"outcome":"succeeded","environment":"live","scheduleName":"obra-calendar-live-google","failed":0,"reconciled":0}',false,clock_timestamp());
    reset role;
    insert into public.background_job_cron_requests(schedule_name,request_id,requested_at)
      values('obra-calendar-live-google',900004,clock_timestamp());
    update public.background_job_cron_requests set responded_at=clock_timestamp(),status_code=200,timed_out=false where request_id=900004;`);
  const idleBindingReport = bindingReport();
  assert.equal(idleBindingReport.alerts.find((a) => a.id === "google:outcome").status, "resolved");
  assert.equal(
    idleBindingReport.overdueConnections.some((c) => c.id === state.id),
    false,
  );
  assert.equal(bindingCondition(idleBindingReport).status, "firing");
  assert.equal(
    bindingCondition(idleBindingReport).dedupeKey,
    bindingCondition(failedBindingReport).dedupeKey,
  );
  const oldMonitorEnvironment = process.env.CALENDAR_MONITOR_ENVIRONMENT;
  process.env.CALENDAR_MONITOR_ENVIRONMENT = "live";
  const disabledNotices = process.env.CALENDAR_ACTION_NOTICES_ENABLED;
  process.env.CALENDAR_ACTION_NOTICES_ENABLED = "false";
  assert.equal((await monitor()).status, 200);
  assert.equal(
    bindingCondition(state.operator).status,
    "firing",
    "actual adapter receives retained trigger incident after idle success",
  );
  process.env.CALENDAR_MONITOR_ENVIRONMENT = oldMonitorEnvironment;
  process.env.CALENDAR_ACTION_NOTICES_ENABLED = disabledNotices;

  // A real current trigger projection, not a raw failure-column reset, clears it.
  sql(`update public.pipedream_bindings set reconciliation_due_at=clock_timestamp(),component_version='1.0.0',
    deployed_trigger_id='t_monitor_fixture' where id=${literal(bindingId)}`);
  bindingClaim = JSON.parse(
    sql(`set role service_role;
    select public.claim_saved_google_calendar_verification(${literal(state.profile)},'live',${literal(bindingLease)},60,true)`),
  );
  const b = bindingClaim.binding;
  sql(`set role service_role;
    select public.mark_google_calendar_connection_verified(${literal(bindingId)},${literal(bindingLease)},${b.reconciliation_fencing_token},
      clock_timestamp(),'[{"id":"monitor-destination","accessRole":"owner"}]');
    select public.apply_pipedream_trigger_projection(
      p_binding_id=>${literal(bindingId)},p_webhook_correlation_id=>${literal(b.webhook_correlation_id)},
      p_profile_id=>${literal(state.profile)},p_environment=>'live',p_connection_id=>${literal(state.id)},
      p_pipedream_account_id=>${literal(b.pipedream_account_id)},p_component_key=>${literal(b.component_key)},
      p_component_version=>'1.0.0',p_selected_calendar_ids=>'["monitor-destination"]',p_deployed_trigger_id=>'t_monitor_fixture',
      p_webhook_id=>'wh_monitor_fixture',p_signing_key=>'fixture-only',p_active=>true,p_provider_updated_at=>clock_timestamp(),p_safe_error=>null,
      p_lease_token=>${literal(bindingLease)},p_fencing_token=>${b.reconciliation_fencing_token},p_deployment_operation_id=>null,
      p_expected_connection_revision=>${b.configuration_revision},p_observed_component_key=>${literal(b.component_key)},p_observed_component_version=>'1.0.0');`);
  assert.equal(bindingCondition(bindingReport()).status, "resolved");
  console.log(
    "PASS: R13 actual fenced SQL -> Zod -> monitor: fresh account + future trigger retry survives idle success; real trigger projection resolves the same incident",
  );

  const healthyAlert = evaluate().alerts[0];
  for (const phase of ["headers", "body"]) {
    let aborted = false;
    let dispatches = 0;
    globalThis.fetch = async (_url, init) => {
      dispatches++;
      init.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );
      if (phase === "headers")
        return new Promise((_, reject) =>
          init.signal.addEventListener(
            "abort",
            () => reject(new Error("PRIVATE stalled headers")),
            { once: true },
          ),
        );
      return new Response(
        new ReadableStream({
          start(controller) {
            init.signal.addEventListener(
              "abort",
              () => controller.error(new Error("PRIVATE stalled body")),
              { once: true },
            );
          },
        }),
      );
    };
    const start = performance.now();
    await assert.rejects(() =>
      globalThis.__calendarObservability.withWorkerDeadline(
        Date.now() + 90,
        () => library.subject.deliverCalendarAlertStates([healthyAlert]),
        { workDeadlineAt: Date.now() + 60 },
      ),
    );
    assert.ok(performance.now() - start < 1000);
    assert.ok(aborted);
    assert.equal(dispatches, 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(dispatches, 1, "no detached retry after response");
  }
  let callsAfterStop = 0;
  globalThis.fetch = async () => {
    callsAfterStop++;
    return new Response("should not dispatch");
  };
  await assert.rejects(() =>
    globalThis.__calendarObservability.withWorkerDeadline(
      Date.now() + 1000,
      () => library.subject.deliverCalendarAlertStates([healthyAlert]),
      { canContinue: () => false },
    ),
  );
  assert.equal(callsAfterStop, 0);
  globalThis.fetch = (...args) => globalThis.__calendarObservability.http(...args);
  console.log(
    "PASS: shared bounded worker transport aborts stalled headers/body and refuses dispatch after continuation loss",
  );

  // Actual competing PostgreSQL backends prove SKIP LOCKED claim exclusion.
  fixture();
  const competing = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "psql",
        [
          "-X",
          "-Atq",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          `begin;set local role service_role;
      select public.claim_calendar_action_notice('test','${randomUUID()}') is not null;select pg_sleep(0.15);commit;`,
        ],
        { cwd: root, env },
      );
      let output = "";
      let stderr = "";
      child.stdout.on("data", (x) => (output += x));
      child.stderr.on("data", (x) => (stderr += x));
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve(output.trim()) : reject(new Error(stderr)),
      );
    });
  assert.deepEqual((await Promise.all([competing(), competing()])).sort(), ["f", "t"]);
  console.log("PASS: concurrent real PostgreSQL claimers return exactly one dispatch owner");
  console.log(
    "test-calendar-observability: passed (local only; no hosted provider/DB/cron/secret operations)",
  );
} finally {
  console.error = previousConsoleError;
  globalThis.fetch = previousFetch;
  for (const bundle of bundles) await bundle.cleanup();
  delete globalThis.__calendarObservability;
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  if (started) run("pg_ctl", ["-D", data, "stop", "-m", "immediate"]);
  await rm(directory, { recursive: true, force: true });
}
