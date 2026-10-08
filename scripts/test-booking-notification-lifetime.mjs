import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

// Actual worker + actual migration chain. Only Resend and its 24-hour retention
// clock are simulated. PostgreSQL is always a fresh loopback cluster we start.
const root = fileURLToPath(new URL("../", import.meta.url));
assert.equal(path.resolve(process.cwd()), path.resolve(root));
const workerOnly = process.argv.includes("--worker-only");
const directory = await mkdtemp(path.join(root, ".booking-notification-lifetime-"));
const data = path.join(directory, "pgdata");
const testSql = path.join(root, "supabase/tests/booking-notification-lifetime.sql");
const fixtureEnv = {
  TMPDIR: directory,
  RESEND_API_KEY_TEST: "inert-notification-test-key",
  BOOKING_EMAIL_FROM_TEST: "booking@example.test",
  BOOKING_CRON_SECRET: "inert-notification-cron-key",
  BOOKING_WORKER_ENVIRONMENT: "test",
  BOOKING_WORKER_MODE: "drain",
  SAAS_BILLING_ENVIRONMENT: "test",
  STRIPE_SECRET_KEY: "sk_test_inert_notification",
  CALENDAR_WORKER_BUDGET_MS: "45000",
  CALENDAR_WORKER_SETTLEMENT_MS: "5000",
};
const previousEnv = Object.fromEntries(
  Object.keys(fixtureEnv).map((name) => [name, process.env[name]]),
);
const previousFetch = globalThis.fetch;
Object.assign(process.env, fixtureEnv);
const probe = createServer();
await new Promise((resolve, reject) => probe.listen(0, "127.0.0.1", resolve).once("error", reject));
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
const env = {
  PATH: process.env.PATH,
  HOME: root,
  TMPDIR: directory,
  LC_ALL: "C",
  PSQLRC: "/dev/null",
  PGHOST: "127.0.0.1",
  PGPORT: String(port),
  PGDATABASE: "postgres",
  PGUSER: "notification_test",
  PGPASSFILE: path.join(directory, "no-password"),
  PGOPTIONS: "-c client_min_messages=warning",
};
let started = false;
let bundle;
let routeBundle;
let state;
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
  assert.equal(started, true, "never connect unless our own local server started");
  return run("psql", ["-X", "-Atq", "-v", "ON_ERROR_STOP=1"], input);
}
function literal(value) {
  if (value == null) return "null";
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value));
    return String(value);
  }
  if (typeof value === "boolean") return String(value);
  const object = typeof value === "object";
  return (
    "'" +
    (object ? JSON.stringify(value) : value).replaceAll("'", "''") +
    "'" +
    (object ? "::jsonb" : "")
  );
}
function row(id = state.id) {
  return JSON.parse(
    sql(`select to_jsonb(n) from public.booking_notifications n where id=${literal(id)};`),
  );
}
function review(id = state.id) {
  return JSON.parse(
    sql(
      `select to_jsonb(r) from public.booking_notification_delivery_review_v3 r where notification_id=${literal(id)};`,
    ) || "null",
  );
}
function cancel() {
  sql(`select public.cancel_contractor_booking(a.id,a.profile_id,a.environment,p.auth_user_id,gen_random_uuid(),repeat('a',64))
    from public.appointments a join public.profiles p on p.id=a.profile_id where a.id=${literal(state.appointmentId)};`);
  pauseOtherRows();
}
function pauseOtherRows() {
  sql(`update public.booking_notifications set next_attempt_at='infinity',
    lease_expires_at=case when state='processing' then 'infinity'::timestamptz else lease_expires_at end
    where environment='test' and id not in (${(state.queue ?? [{ id: state.id }]).map(({ id }) => literal(id)).join(",")})
      and state in ('pending','retry','processing');`);
}
function advance(hours) {
  assert.ok(Number.isInteger(hours) && hours > 0);
  state.elapsed += hours * 60 * 60 * 1000;
  sql(`update public.booking_notifications set first_dispatch_at=first_dispatch_at-interval '${hours} hours',
    replay_deadline_at=replay_deadline_at-interval '${hours} hours',lease_expires_at=lease_expires_at-interval '${hours} hours',
    next_attempt_at=next_attempt_at-interval '${hours} hours',created_at=created_at-interval '${hours} hours',
    updated_at=clock_timestamp() where id=${literal(state.id)};`);
}
function fixture(type = "confirmed", cancelled = false, audience = "customer") {
  const appointmentId = run("psql", [
    "-X",
    "-Atq",
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    "notification_worker_fixture=true",
    "-f",
    testSql,
  ]);
  assert.match(appointmentId, /^[a-f0-9-]{36}$/);
  if (type.startsWith("calendar_")) {
    sql(`update public.appointments set appointment_state=${literal(cancelled ? "cancelled" : "confirmed")},
      cancellation_requested_at=${cancelled ? "clock_timestamp()" : "null"},
      cancelled_at=${cancelled ? "clock_timestamp()" : "null"},
      appointment_reason=${literal(cancelled ? "contractor_cancelled" : "paid_confirmed")},
      calendar_state=${literal(cancelled ? "cancel_failed" : "create_failed")} where id=${literal(appointmentId)};`);
    if (type === "calendar_repaired")
      sql(
        `update public.appointments set calendar_state=${literal(cancelled ? "cancelled" : "created")} where id=${literal(appointmentId)};`,
      );
  }
  const id =
    sql(`select id from public.booking_notifications where appointment_id=${literal(appointmentId)}
    and notification_type=${literal(type)} and audience=${literal(audience)};`);
  assert.match(id, /^[a-f0-9-]{36}$/);
  sql(
    `update public.booking_notifications set next_attempt_at=clock_timestamp() where id=${literal(id)};`,
  );
  state = {
    id,
    appointmentId,
    elapsed: 0,
    canContinue: true,
    calls: [],
    providerRequests: [],
    emails: [],
    provider: new Map(),
    completionFailures: 0,
    completionResponseLost: 0,
    providerResponseLost: 0,
    stopAfterContext: false,
    stopAfterAuthorization: false,
    cancelAfterContext: false,
    cancelAfterAcceptance: false,
    stopAfterAcceptance: false,
    authorizationResponseDelayed: false,
  };
  pauseOtherRows();
  process.env.BOOKING_EMAIL_FROM_TEST = "booking@example.test";
}

function selectNotification(type, audience = "customer") {
  state.id =
    sql(`select id from public.booking_notifications where appointment_id=${literal(state.appointmentId)}
    and notification_type=${literal(type)} and audience=${literal(audience)} order by occurrence_version desc limit 1;`);
  assert.match(state.id, /^[a-f0-9-]{36}$/);
  pauseOtherRows();
  sql(
    `update public.booking_notifications set next_attempt_at=clock_timestamp() where id=${literal(state.id)};`,
  );
}
function refund(refunds = []) {
  return JSON.parse(
    run("psql", [
      "-X",
      "-Atq",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `notification_refund_appointment=${state.appointmentId}`,
      "-v",
      `notification_refunds=${JSON.stringify(refunds)}`,
      "-f",
      testSql,
    ]),
  );
}
function refundFixture(audience = "customer") {
  fixture();
  const preflight = sql(`select public.capture_booking_cutover_preflight_v3(profile_id,environment)
    from public.appointments where id=${literal(state.appointmentId)};`);
  sql(`select public.prepare_booking_convergence_cutover(profile_id,environment)
    from public.appointments where id=${literal(state.appointmentId)};`);
  assert.equal(sql(`select public.activate_booking_cutover_v3(${literal(preflight)});`), "t");
  cancel();
  selectNotification("refund_pending", audience);
  const prepared = refund();
  assert.equal(prepared.action, "create");
  state.refundItem = {
    id: "re_notification_" + state.appointmentId,
    object: "refund",
    charge: prepared.chargeId,
    payment_intent: prepared.paymentIntentId,
    status: "pending",
    amount: prepared.amountMinor,
    currency: "usd",
    created: Math.floor(Date.now() / 1000),
    metadata: {
      kind: "booking_refund",
      bookingPaymentId: prepared.paymentId,
      bookingAppointmentId: state.appointmentId,
      bookingProfileId: prepared.profileId,
      bookingEnvironment: "test",
      refundGeneration: String(prepared.generation),
      bookingCommandId: prepared.commandId,
    },
  };
}

const rpcNames = new Set([
  "claim_due_booking_notifications_v3",
  "get_booking_notification_context_v3",
  "authorize_booking_notification_dispatch_v3",
  "complete_booking_notification_v3",
  "fail_booking_notification_v3",
  "claim_booking_worker_family_v3",
  "renew_booking_worker_family_v3",
  "complete_booking_worker_family_v3",
  "reconcile_booking_notification_projection_v3",
]);
globalThis.__bookingNotificationLifetime = {
  Stripe,
  rpc: async (name, args) => {
    assert.ok(rpcNames.has(name), "worker must use the notification RPC allowlist");
    const call = { name, args: structuredClone(args) };
    state.calls.push(call);
    if (name === "complete_booking_notification_v3" && state.completionFailures-- > 0)
      return { data: null, error: { code: "08006" } };
    if (name === state.loseLeaseAt) {
      state.loseLeaseAt = null;
      sql(
        `update public.booking_notifications set lease_token=gen_random_uuid() where id=${literal(state.id)};`,
      );
    }
    const invocation = `public.${name}(${Object.entries(args)
      .map(([key, value]) => `${key}=>${literal(value)}`)
      .join(",")})`;
    const query =
      name === "claim_due_booking_notifications_v3"
        ? `select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb) from ${invocation} n;`
        : `select to_jsonb(${invocation});`;
    const result = spawnSync(
      "psql",
      ["-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"],
      {
        cwd: root,
        env,
        input: `set role booking_worker; ${query}`,
        encoding: "utf8",
      },
    );
    if (result.status !== 0)
      return {
        data: null,
        error: {
          code: result.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? "XX000",
          message: result.stderr,
        },
      };
    const response = { data: JSON.parse(result.stdout.trim() || "null"), error: null };
    call.result = response.data;
    if (name === "claim_due_booking_notifications_v3" && state.queue && response.data[0])
      Object.assign(
        state,
        state.queue.find(({ id }) => id === response.data[0].id),
      );
    if (name === "get_booking_notification_context_v3") {
      if (state.stopAfterContext) state.canContinue = false;
      if (state.cancelAfterContext) {
        state.cancelAfterContext = false;
        cancel();
      }
      if (state.afterContext) {
        const afterContext = state.afterContext;
        state.afterContext = null;
        await afterContext();
      }
    }
    if (name === "authorize_booking_notification_dispatch_v3") {
      if (state.stopAfterAuthorization) state.canContinue = false;
      if (state.authorizationResponseDelayed && response.data?.action === "dispatch") {
        response.data.dispatch_budget_ms = 5;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (name === "complete_booking_notification_v3" && state.completionResponseLost-- > 0) {
      sql(
        `select public.ingest_booking_notification_delivery('event_${state.id}',${literal(args.p_provider_message_id)},'email.delivered',clock_timestamp());`,
      );
      return { data: null, error: { code: "08006" } };
    }
    return response;
  },
  providerFetch: async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.equal(init.signal.aborted, false);
    assert.equal(state.canContinue, true, "no new email after the continuation fence is lost");
    const n = row();
    const key = init.headers["Idempotency-Key"];
    assert.equal(n.state, "processing");
    assert.ok(n.first_dispatch_at && n.replay_deadline_at && n.dispatch_appointment);
    assert.ok(new Date(n.replay_deadline_at).getTime() > Date.now());
    assert.equal(
      n.dispatch_payload,
      init.body,
      "exact bytes are durable before the provider boundary",
    );
    assert.equal(n.idempotency_key, key);
    state.providerRequests.push({ key, payload: init.body });
    let accepted = state.provider.get(key);
    if (!accepted || state.elapsed - accepted.at >= 24 * 60 * 60 * 1000) {
      accepted = { id: "email_" + n.id + "_" + (state.emails.length + 1), at: state.elapsed };
      state.provider.set(key, accepted);
      state.emails.push({ ...accepted, key, payload: init.body });
    } else {
      assert.equal(init.body, state.emails.find((email) => email.id === accepted.id).payload);
    }
    if (state.cancelAfterAcceptance) cancel();
    if (state.afterAcceptance) {
      const afterAcceptance = state.afterAcceptance;
      state.afterAcceptance = null;
      await afterAcceptance();
    }
    if (state.stopAfterAcceptance) state.canContinue = false;
    if (state.providerResponseLost-- > 0)
      throw new Error("Simulated lost provider response after acceptance");
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
  // Reuse the unchanged harness's inert bootstrap and historical migration
  // ordering, without its unrelated suites. Focused tests below check the new ACL.
  const harness = await readFile(path.join(root, "scripts/test-db-bucket3-local.sh"), "utf8");
  const begin = harness.indexOf("psql -v ON_ERROR_STOP=1 <<'SQL'");
  const end = harness.indexOf("\n# Exercise actual RPC execution");
  assert.ok(begin > 0 && end > begin);
  let replay = harness.slice(begin, end);
  if (workerOnly)
    replay = replay.replace(
      '  case "$name" in',
      '  case "$name" in\n    20260910140000_*|20260910150000_*) continue ;;',
    );
  assert.equal(
    replay.split("notification_legacy_fixture=true").length,
    2,
    "primary harness must seed the pre-migration notification fixture exactly once",
  );
  run("bash", [
    "-c",
    'set -euo pipefail\nROOT="$1"\nLOG=/dev/null\n' + replay,
    "notification-lifetime-replay",
    root,
  ]);
  const sqlResult = run("psql", [
    "-X",
    "-Atq",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    "set role booking_test_owner;",
    "-f",
    testSql,
  ]);
  assert.match(
    sqlResult,
    /SQL authority, cancellation\/refund truth, dispatch lifetime and delivery evidence passed/,
  );
  console.log(
    `OK: local migration chain${workerOnly ? " through notification lifetime" : ""}, conservative legacy dispatch handling and focused SQL regressions`,
  );

  const mocks = {
    "@/integrations/supabase/booking-worker.server":
      "export const bookingWorker={rpc:(...args)=>{const result=globalThis.__bookingNotificationLifetime.rpc(...args);result.abortSignal=()=>result;return result;}};",
    "@/lib/worker-deadline.server": `
      import { withWorkerDeadline } from ${JSON.stringify(path.join(root, "src/lib/worker-deadline.server.ts"))};
      export * from ${JSON.stringify(path.join(root, "src/lib/worker-deadline.server.ts"))};
      globalThis.__bookingNotificationLifetime.withWorkerDeadline = withWorkerDeadline;
    `,
  };
  bundle = await importWithMocks(
    path.join(root, "src/lib/booking-notification-worker.server.ts"),
    mocks,
  );
  globalThis.fetch = (...args) => globalThis.__bookingNotificationLifetime.providerFetch(...args);
  const work = () =>
    globalThis.__bookingNotificationLifetime.withWorkerDeadline(
      Date.now() + 30_000,
      () => bundle.subject.processBookingNotifications("test", 1, () => state.canContinue),
      { canContinue: () => state.canContinue },
    );

  for (const audience of ["customer", "contractor"]) {
    refundFixture(audience);
    assert.equal(refund([state.refundItem]).action, "waiting");
    const pending = row();
    let completed;
    state.afterContext = async () => {
      const claimed = row(pending.id);
      assert.equal(claimed.state, "processing");
      assert.equal(refund([{ ...state.refundItem, status: "succeeded" }]).action, "settled");
      // Delay this real claim while another worker sends the actual completion
      // email. Keep its original live lease, not a fabricated pending response.
      state.queue = [{ id: pending.id, appointmentId: state.appointmentId }];
      selectNotification("refund_succeeded", audience);
      completed = state.id;
      state.queue.push({ id: completed, appointmentId: state.appointmentId });
      assert.equal((await work()).processed, 1);
      assert.equal(row().state, "accepted");
      for (const field of ["lease_token", "lease_expires_at", "fencing_token"])
        assert.equal(row(pending.id)[field], claimed[field]);
      state.id = pending.id;
      delete state.queue;
    };
    assert.equal((await work()).suppressed, 1);
    assert.equal(row().state, "suppressed");
    assert.equal(row().first_dispatch_at, null);
    assert.equal(state.providerRequests.length, 1);
    assert.equal(state.emails.length, 1);
    const message = JSON.parse(state.emails[0].payload);
    assert.match(message.subject, /^Refund completed/);
    assert.match(message.text, /remaining refund.*has completed/);
    assert.doesNotMatch(message.text, /is being processed/);
    assert.deepEqual(message.to, [audience + "@example.test"]);
    const completion = state.calls.findIndex(
      ({ name, args }) =>
        name === "complete_booking_notification_v3" && args.p_notification_id === completed,
    );
    const delayed = state.calls.findIndex(
      ({ name, args }) =>
        name === "authorize_booking_notification_dispatch_v3" &&
        args.p_notification_id === pending.id,
    );
    assert.ok(
      completion >= 0 && delayed > completion,
      "terminal email is accepted before old pending authorization resumes",
    );
    assert.equal((await work()).claimed, 0);
    assert.equal(state.providerRequests.length, 1, "delayed pending copy never reaches HTTP");
  }

  for (const terminal of ["succeeded", "failed"]) {
    refundFixture();
    const pending = row();
    assert.equal(
      refund([{ ...state.refundItem, status: terminal }]).action,
      terminal === "succeeded" ? "settled" : "failed",
    );
    selectNotification("refund_" + terminal);
    assert.equal((await work()).processed, 1);
    assert.match(
      JSON.parse(state.emails[0].payload).subject,
      terminal === "succeeded" ? /^Refund completed/ : /^Refund needs attention/,
    );
    assert.equal(
      row(pending.id).state,
      "suppressed",
      "unclaimed pending email is suppressed before terminal email dispatch",
    );
    assert.equal(row(pending.id).first_dispatch_at, null);
    state.id = pending.id;
    assert.equal((await work()).claimed, 0);
    assert.equal(state.providerRequests.length, 1);

    refundFixture();
    if (terminal === "succeeded")
      state.afterAcceptance = () =>
        assert.equal(refund([{ ...state.refundItem, status: terminal }]).action, "settled");
    assert.equal((await work()).processed, 1);
    const accepted = row();
    if (terminal === "failed")
      assert.equal(refund([{ ...state.refundItem, status: terminal }]).action, "failed");
    selectNotification("refund_" + terminal);
    assert.equal((await work()).processed, 1);
    assert.deepEqual(
      row(accepted.id),
      accepted,
      "historical accepted pending evidence is not erased or rewritten",
    );
    assert.equal(
      sql(
        `set role booking_worker; select public.booking_notification_event_current_v4(${literal(accepted.id)});`,
      ),
      "f",
    );
    assert.equal(review(accepted.id), null);
    assert.equal(state.emails.length, 2);
    state.id = accepted.id;
    assert.equal((await work()).claimed, 0);

    refundFixture();
    state.providerResponseLost = 1;
    assert.equal((await work()).failed, 1);
    const ambiguous = row();
    assert.equal(
      refund([{ ...state.refundItem, status: terminal }]).action,
      terminal === "succeeded" ? "settled" : "failed",
    );
    selectNotification("refund_" + terminal);
    assert.equal((await work()).processed, 1);
    const retained = row(ambiguous.id);
    assert.equal(retained.state, "failed");
    assert.equal(retained.next_attempt_at, "infinity");
    for (const field of [
      "idempotency_key",
      "source_event_key",
      "dispatch_payload",
      "dispatch_appointment",
      "first_dispatch_at",
      "replay_deadline_at",
    ])
      assert.deepEqual(retained[field], ambiguous[field]);
    assert.equal(review(ambiguous.id).reason_code, "acceptance_unknown");
    assert.equal(review(ambiguous.id).resolved_at, null);
    state.id = ambiguous.id;
    assert.equal((await work()).claimed, 0);
    assert.equal(
      state.providerRequests.length,
      2,
      "unknown original acceptance never replays after a terminal refund",
    );
    assert.equal(state.emails.length, 2);
  }
  console.log(
    "OK: real refund completion email precedes delayed pending authorization; success/failure preserve accepted and ambiguous history",
  );

  for (const hours of [23, 24, 48]) {
    refundFixture();
    assert.equal(refund([state.refundItem]).action, "waiting");
    state.providerResponseLost = 1;
    assert.equal((await work()).failed, 1);
    const original = row();
    advance(hours);
    process.env.BOOKING_EMAIL_FROM_TEST = "changed-sender@example.test";
    const result = await work();
    assert.equal(result.processed, hours === 23 ? 1 : 0);
    assert.equal(state.providerRequests.length, hours === 23 ? 2 : 1);
    assert.equal(state.emails.length, 1);
    assert.equal(row().dispatch_payload, original.dispatch_payload);
    assert.equal(row().idempotency_key, original.idempotency_key);
    if (hours === 23) assert.deepEqual(state.providerRequests[0], state.providerRequests[1]);
    else assert.equal(review().reason_code, "idempotency_expired");
  }

  refundFixture();
  state.providerResponseLost = 1;
  assert.equal((await work()).failed, 1);
  const pendingCopy = row();
  sql(`update public.appointments set service_snapshot='{"name":"Changed service"}'::jsonb where id=${literal(state.appointmentId)};
    update public.booking_notifications set next_attempt_at=clock_timestamp() where id=${literal(state.id)};`);
  assert.equal(
    (await work()).review,
    1,
    "still-pending state cannot authorize changed content under an ambiguous key",
  );
  assert.equal(state.providerRequests.length, 1);
  assert.equal(row().dispatch_payload, pendingCopy.dispatch_payload);
  assert.deepEqual(row().dispatch_appointment, pendingCopy.dispatch_appointment);
  assert.equal(row().replay_deadline_at, pendingCopy.replay_deadline_at);
  assert.equal(review().reason_code, "acceptance_unknown");

  refundFixture();
  const oldGeneration = row();
  const external = {
    ...state.refundItem,
    id: "re_external_" + state.appointmentId,
    status: "succeeded",
    amount: 400,
    metadata: {},
  };
  assert.equal(refund([external]).action, "superseded");
  const remainder = refund([external]);
  assert.equal(remainder.action, "create");
  assert.equal(remainder.amountMinor, 600);
  assert.equal(remainder.generation, 2);
  const nextRefund = {
    ...state.refundItem,
    id: "re_remainder_" + state.appointmentId,
    amount: 600,
    metadata: {
      ...state.refundItem.metadata,
      refundGeneration: "2",
      bookingCommandId: remainder.commandId,
    },
  };
  assert.equal(refund([external, nextRefund]).action, "waiting");
  selectNotification("refund_pending");
  assert.equal(
    (await work()).processed,
    1,
    "a real new partial-refund generation remains sendable",
  );
  assert.equal(row().source_event_key, "refund:2:pending");
  assert.notEqual(row().idempotency_key, oldGeneration.idempotency_key);
  assert.equal(row(oldGeneration.id).state, "suppressed");
  assert.equal(row(oldGeneration.id).first_dispatch_at, null);
  assert.equal(state.providerRequests.length, 1);
  assert.match(JSON.parse(state.emails[0].payload).text, /refund.*is being processed/);
  console.log(
    "OK: pending-refund 23/24/48-hour frozen replay limits and real next-generation partial-refund dispatch",
  );

  for (const [cancelled, type, audience] of [false, true].flatMap((cancelled) =>
    ["calendar_failed", "calendar_repaired"].flatMap((type) =>
      ["customer", "contractor"].map((audience) => [cancelled, type, audience]),
    ),
  )) {
    fixture(type, cancelled, audience);
    assert.deepEqual(await work(), {
      processed: 1,
      claimed: 1,
      accepted: 1,
      failed: 0,
      suppressed: 0,
      review: 0,
      settled: 1,
      skipped: 0,
    });
    const message = JSON.parse(state.emails[0].payload);
    if (cancelled) {
      assert.match(message.text, /appointment (?:is|remains) cancelled/);
      assert.doesNotMatch(message.text, /remains confirmed|invitation is now available/);
      assert.match(message.subject, /Calendar cancellation/);
      assert.match(
        message.text,
        type === "calendar_failed"
          ? /remov(?:al|ing).* (?:not yet been verified|still needs attention)/
          : /event has been removed/,
      );
    } else {
      assert.match(message.text, /confirmed/);
      assert.match(
        message.text,
        type === "calendar_failed"
          ? /invitation is delayed|creating its calendar event still needs attention/
          : /calendar event.*has been created/,
      );
    }
    assert.doesNotMatch(
      message.text,
      /has been notified|inbox|received|invitation is now available/,
    );
  }
  fixture();
  state.cancelAfterContext = true;
  assert.deepEqual(await work(), {
    processed: 0,
    claimed: 1,
    accepted: 0,
    failed: 0,
    suppressed: 1,
    review: 0,
    settled: 1,
    skipped: 0,
  });
  assert.equal(state.providerRequests.length, 0);
  assert.equal(row().state, "suppressed");
  assert.equal(row().first_dispatch_at, null);
  console.log(
    "OK: actual cancellation/create/delete copy and context-to-dispatch cancellation fence",
  );

  fixture();
  sql(`update public.booking_notifications set state='suppressed',recipient_email=null,suppression_reason='recipient_missing_or_invalid'
    where id=${literal(state.id)};`);
  cancel();
  assert.equal(
    sql("select public.reconcile_booking_notification_projection_v3('test',500);"),
    "0",
    "a valid address on a cancelled confirmation cannot monopolize the projection scan",
  );
  assert.equal(row().state, "suppressed");

  fixture();
  sql(`update public.booking_notifications set state='suppressed',recipient_email=null,suppression_reason='recipient_missing_or_invalid'
    where id=${literal(state.id)};`);
  sql("select public.reconcile_booking_notification_projection_v3('test',500);");
  assert.equal(row().state, "pending", "recipient repair still revives a current unsent event");
  assert.equal(row().recipient_email, "customer@example.test");
  assert.equal((await work()).processed, 1);

  fixture();
  state.completionFailures = 2;
  assert.equal((await work()).processed, 1);
  assert.equal(state.providerRequests.length, 1, "known acceptance retries settlement, not send");
  const completions = state.calls.filter(
    (call) => call.name === "complete_booking_notification_v3",
  );
  assert.equal(completions.length, 3);
  assert.deepEqual(completions[0].args, completions[1].args);
  assert.deepEqual(completions[0].args, completions[2].args);
  assert.equal(row().state, "accepted");
  assert.equal(
    state.calls.some((call) => call.name === "fail_booking_notification_v3"),
    false,
  );
  cancel();
  advance(48);
  assert.equal((await work()).claimed, 0);
  assert.equal(
    row().state,
    "accepted",
    "cancellation/expiry suppression cannot rewrite recorded acceptance",
  );
  assert.equal(review(), null);

  fixture();
  state.completionResponseLost = 1;
  state.cancelAfterAcceptance = true;
  state.stopAfterAcceptance = true;
  assert.equal(
    (await work()).processed,
    1,
    "settlement repetition may use the reserve after new work stops",
  );
  assert.equal(state.providerRequests.length, 1);
  assert.equal(
    row().state,
    "delivered",
    "response-loss completion cannot overwrite a delivery webhook",
  );
  assert.equal(
    state.calls.filter((call) => call.name === "complete_booking_notification_v3").length,
    2,
  );
  console.log(
    "OK: same acceptance completion repeats before/after DB commit, preserving cancellation-race delivery evidence",
  );

  fixture();
  state.providerResponseLost = 1;
  assert.equal((await work()).failed, 1);
  const original = row();
  assert.equal(original.state, "retry");
  advance(23);
  process.env.BOOKING_EMAIL_FROM_TEST = "changed-sender@example.test";
  sql(
    `update public.appointments set version=version+1,calendar_state='create_pending' where id=${literal(state.appointmentId)};`,
  );
  assert.equal((await work()).processed, 1);
  assert.equal(state.providerRequests.length, 2);
  assert.equal(
    state.emails.length,
    1,
    "provider suppresses duplicate replay inside its 24-hour retention",
  );
  assert.equal(row().idempotency_key, original.idempotency_key);
  assert.equal(row().dispatch_payload, original.dispatch_payload);
  assert.deepEqual(state.providerRequests[0], state.providerRequests[1]);
  assert.equal(
    JSON.parse(row().dispatch_payload).from,
    "booking@example.test",
    "replay never rebuilds mutable sender/template contents",
  );
  assert.deepEqual(await work(), {
    processed: 0,
    claimed: 0,
    accepted: 0,
    failed: 0,
    suppressed: 0,
    review: 0,
    settled: 0,
    skipped: 0,
  });

  fixture();
  state.completionFailures = 3;
  await assert.rejects(work, /acceptance settlement is unresolved/);
  advance(23);
  assert.equal((await work()).processed, 1);
  assert.equal(state.providerRequests.length, 2);
  assert.equal(
    state.emails.length,
    1,
    "process loss with unpersisted acceptance replays only within retention",
  );

  for (const hours of [24, 48]) {
    fixture();
    state.completionFailures = 3;
    await assert.rejects(work, /acceptance settlement is unresolved/);
    assert.equal(row().state, "processing");
    assert.equal(
      state.calls.some((call) => call.name === "fail_booking_notification_v3"),
      false,
    );
    const original = row();
    advance(hours);
    const result = await work();
    assert.equal(
      result.claimed,
      0,
      `${hours}-hour unknown acceptance cannot be reclaimed for another send`,
    );
    assert.equal(state.emails.length, 1);
    assert.equal(state.providerRequests.length, 1);
    assert.equal(row().state, "failed");
    assert.equal(row().dispatch_payload, original.dispatch_payload);
    assert.equal(row().idempotency_key, original.idempotency_key);
    assert.equal(review().reason_code, "idempotency_expired");
    assert.equal(review().resolved_at, null);
  }
  fixture();
  state.providerResponseLost = 1;
  await work();
  advance(48);
  assert.equal((await work()).claimed, 0);
  assert.equal(review().reason_code, "idempotency_expired");
  assert.equal(
    state.emails.length,
    1,
    "lost provider response also remains reviewable instead of resending after retention",
  );
  console.log(
    "OK: 23-hour stable-key replay suppresses duplicates; 24/48-hour unknown acceptance remains visible in review",
  );

  fixture("calendar_failed");
  state.providerResponseLost = 1;
  await work();
  advance(1);
  // Hold the generation fixed to exercise the frozen create/delete meaning too,
  // not just source-event generation invalidation.
  sql(`update public.appointments set appointment_state='cancelled',calendar_state='cancel_failed',
    cancellation_requested_at=clock_timestamp(),cancelled_at=clock_timestamp(),appointment_reason='contractor_cancelled'
    where id=${literal(state.appointmentId)};`);
  pauseOtherRows();
  assert.deepEqual(await work(), {
    processed: 0,
    claimed: 1,
    accepted: 0,
    failed: 0,
    suppressed: 0,
    review: 1,
    settled: 1,
    skipped: 0,
  });
  assert.equal(review().reason_code, "acceptance_unknown");
  assert.equal(
    state.providerRequests.length,
    1,
    "changed calendar meaning cannot replay an earlier create-failure message",
  );

  fixture();
  state.providerResponseLost = 1;
  await work();
  cancel();
  advance(1);
  assert.equal((await work()).claimed, 0);
  assert.equal(review().reason_code, "acceptance_unknown");
  assert.equal(
    state.providerRequests.length,
    1,
    "ambiguous original confirmation cannot be replayed after cancellation",
  );

  fixture();
  state.stopAfterContext = true;
  assert.equal((await work()).skipped, 1);
  assert.equal(row().first_dispatch_at, null);
  assert.equal(state.providerRequests.length, 0);
  advance(48);
  state.canContinue = true;
  state.stopAfterContext = false;
  assert.equal(
    (await work()).processed,
    1,
    "a crash before authorization is safely dispatchable even after 48 hours",
  );
  assert.equal(state.emails.length, 1);
  assert.equal(review(), null);

  fixture();
  state.stopAfterAuthorization = true;
  assert.equal((await work()).skipped, 1);
  assert.ok(row().first_dispatch_at);
  assert.equal(state.providerRequests.length, 0);
  advance(48);
  state.canContinue = true;
  state.stopAfterAuthorization = false;
  assert.equal((await work()).claimed, 0);
  assert.equal(
    review().reason_code,
    "idempotency_expired",
    "crash after durable dispatch intent is conservatively ambiguous",
  );

  fixture();
  state.authorizationResponseDelayed = true;
  assert.equal((await work()).failed, 1);
  assert.equal(
    state.providerRequests.length,
    0,
    "authorization transport time cannot extend a replay grant",
  );
  console.log(
    "OK: changed-state replay fences, crash-before/after authorization and elapsed dispatch grants",
  );
  if (!workerOnly) {
    routeBundle = await importWithMocks(path.join(root, "src/routes/api/cron/booking.ts"), {
      ...mocks,
      "@tanstack/react-router": "export const createFileRoute=()=>config=>config;",
      "@tanstack/react-start":
        "export function createServerFn(){return {validator(parse){return {handler(fn){return ({data})=>fn({data:parse(data)});}};},handler(fn){return fn;}};}",
      "@tanstack/react-start/server":
        "export function getRequest(){throw new Error('No browser in notification test');}",
      "@/integrations/supabase/client.server": "export const supabaseAdmin={};",
      stripe: "export default globalThis.__bookingNotificationLifetime.Stripe;",
    });
    const invoke = () =>
      routeBundle.subject.Route.server.handlers.POST({
        request: new Request("https://obratech.co/api/cron/booking", {
          method: "POST",
          headers: {
            authorization: "Bearer " + fixtureEnv.BOOKING_CRON_SECRET,
            "content-type": "application/json",
            "x-obra-worker-environment": "test",
            "x-obra-cron-schedule": "obra-calendar-test-booking-notifications",
          },
          body: JSON.stringify({ family: "notifications" }),
        }),
      });
    for (const outcome of [
      "suppressed",
      "review",
      "context_lost",
      "authorization_lost",
      "settlement_unknown",
    ]) {
      const queue = [];
      for (let index = 0; index < 10; index++) {
        fixture();
        queue.push({ id: state.id, appointmentId: state.appointmentId });
      }
      Object.assign(state, queue[0]);
      pauseOtherRows();
      if (outcome === "review") {
        sql(
          `update public.booking_notifications set next_attempt_at=clock_timestamp() where id=${literal(state.id)};`,
        );
        state.stopAfterAuthorization = true;
        assert.equal((await work()).skipped, 1);
        assert.ok(row().first_dispatch_at);
        assert.equal(state.providerRequests.length, 0);
        advance(1);
        state.stopAfterAuthorization = false;
        state.canContinue = true;
      }
      state.queue = queue;
      state.calls.length = 0;
      state.cancelAfterContext = outcome === "suppressed" || outcome === "review";
      state.loseLeaseAt =
        outcome === "context_lost"
          ? "get_booking_notification_context_v3"
          : outcome === "authorization_lost"
            ? "authorize_booking_notification_dispatch_v3"
            : null;
      state.completionFailures = outcome === "settlement_unknown" ? 3 : 0;
      const ids = queue.map(({ id }) => literal(id)).join(",");
      sql(`update public.booking_notifications set next_attempt_at=clock_timestamp()-interval '1 minute'
      +array_position(array[${ids}]::uuid[],id)*interval '1 millisecond' where id=any(array[${ids}]::uuid[]);`);
      const response = await invoke();
      const result = await response.json();
      const terminal = outcome === "suppressed" || outcome === "review";
      const expected = {
        processed: terminal ? 9 : 0,
        claimed: terminal ? 10 : outcome === "settlement_unknown" ? 0 : 1,
        accepted: terminal ? 9 : 0,
        failed: 0,
        suppressed: outcome === "suppressed" ? 1 : 0,
        review: outcome === "review" ? 1 : 0,
        settled: terminal ? 10 : 0,
        skipped: !terminal && outcome !== "settlement_unknown" ? 1 : 0,
      };
      assert.equal(response.status, terminal ? 200 : 500, JSON.stringify(result));
      assert.equal(
        result.outcome,
        outcome === "review" ? "partial_failure" : terminal ? "succeeded" : "failed",
      );
      assert.deepEqual(result.notifications, expected);
      for (const [key, value] of Object.entries(expected))
        assert.equal(result[key], key === "failed" && !terminal ? null : value);
      assert.equal(
        state.calls.filter(({ name }) => name === "claim_due_booking_notifications_v3").length,
        terminal ? 11 : 1,
      );
      assert.equal(
        state.providerRequests.length,
        terminal ? 9 : outcome === "settlement_unknown" ? 1 : 0,
      );
      assert.equal(
        Number(
          sql(
            `select count(*) from public.booking_notifications where id=any(array[${ids}]::uuid[]) and state='pending';`,
          ),
        ),
        terminal ? 0 : 9,
      );
      assert.equal(state.calls.at(-1).args.p_success, outcome === "suppressed");
      assert.equal(
        sql(
          "select last_success from public.booking_worker_family_leases_v3 where environment='test' and family='notifications';",
        ),
        outcome === "suppressed" ? "t" : "f",
      );
      if (terminal) {
        assert.equal(
          state.calls.find(({ name }) => name === "authorize_booking_notification_dispatch_v3")
            .result.action,
          outcome,
        );
        assert.equal(row(queue[0].id).state, outcome === "suppressed" ? "suppressed" : "failed");
        assert.equal(row(queue[0].id).provider_message_id, null);
        if (outcome === "review") {
          assert.equal(review(queue[0].id).reason_code, "acceptance_unknown");
          assert.equal(review(queue[0].id).resolved_at, null);
        }
        const emptyResponse = await invoke();
        assert.equal(emptyResponse.status, 200);
        const empty = await emptyResponse.json();
        assert.equal(empty.claimed, 0);
        assert.equal(empty.settled, 0);
        assert.equal(
          state.providerRequests.length,
          9,
          "terminal suppression/review never hot-resends",
        );
      } else {
        assert.equal(row(queue[0].id).state, "processing");
        assert.equal(
          review(queue[0].id),
          null,
          "unknown lease/settlement is not counted as authoritative review",
        );
      }
    }
    console.log(
      "OK: actual cron + SQL drains nine more after cancellation suppression/review; lost context/dispatch lease or acceptance settlement stops claiming",
    );
  }
  console.log(
    `PASS: booking notification lifetime, actual worker + local PostgreSQL; no external provider requests${workerOnly ? ", cron route or scheduler tests" : ""}`,
  );
} finally {
  globalThis.fetch = previousFetch;
  if (routeBundle) await routeBundle.cleanup();
  if (bundle) await bundle.cleanup();
  if (started)
    spawnSync("pg_ctl", ["-D", data, "stop", "-m", "immediate"], { env, stdio: "ignore" });
  await rm(directory, { recursive: true, force: true });
  delete globalThis.__bookingNotificationLifetime;
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
