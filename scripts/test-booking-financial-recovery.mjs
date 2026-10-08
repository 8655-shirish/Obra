import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(path.join(os.tmpdir(), "booking-financial-recovery-"));
const data = path.join(directory, "pgdata");
const listener = createServer();
await new Promise((resolve, reject) =>
  listener.listen(0, "127.0.0.1", resolve).once("error", reject),
);
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = {
  PATH: process.env.PATH,
  HOME: directory,
  TMPDIR: directory,
  LC_ALL: "C",
  PSQLRC: "/dev/null",
  PGHOST: "127.0.0.1",
  PGPORT: String(port),
  PGDATABASE: "postgres",
  PGUSER: "financial_recovery",
  PGPASSFILE: path.join(directory, "no-password"),
  PGOPTIONS: "-c client_min_messages=warning",
};
const originalEnv = process.env,
  originalFetch = globalThis.fetch;
let started = false,
  bundle;
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
  assert.ok(started, "only our disposable PostgreSQL may be queried");
  return run("psql", ["-X", "-w", "-Atq", "-v", "ON_ERROR_STOP=1"], input);
}
function literal(value) {
  if (value == null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return (
    "'" +
    (typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''") +
    "'" +
    (typeof value === "object" ? "::jsonb" : "")
  );
}
try {
  run("initdb", ["-D", data, "-U", env.PGUSER, "-A", "trust", "--no-locale", "-E", "UTF8"]);
  run("pg_ctl", [
    "-D",
    data,
    "-o",
    `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c wal_level=logical`,
    "-l",
    path.join(directory, "postgres.log"),
    "start",
  ]);
  started = true;
  assert.equal(
    sql(`select inet_server_addr()='127.0.0.1'::inet and inet_server_port()=${port};`),
    "t",
  );
  const harness = await readFile(path.join(root, "scripts/test-db-bucket3-local.sh"), "utf8");
  const bootstrap = harness.indexOf("psql -v ON_ERROR_STOP=1 <<'SQL'");
  const end = harness.indexOf("\n# Exercise actual RPC execution");
  assert.ok(bootstrap > 0 && end > bootstrap);
  run("bash", [
    "-c",
    'set -euo pipefail\nROOT="$1"\nLOG=/dev/null\n' + harness.slice(bootstrap, end),
    "financial-recovery-replay",
    root,
  ]);
  assert.equal(sql("select count(*) from pg_extension where extname in('pg_cron','pg_net');"), "0");
  assert.equal(
    sql(`select not bool_or(has_function_privilege(r,'public.converge_booking_full_refund_v3(uuid)','EXECUTE'))
    from unnest(array['anon','authenticated','service_role','booking_worker']) r;`),
    "t",
    "retained full-refund projection is owner-only, not a new runtime RPC",
  );
  const tenant = sql(
    "insert into public.profiles(id,license_number,email,environment) values(gen_random_uuid(),'FINANCIAL-RECOVERY','recovery@example.test','test') returning id;",
  );
  const preflight = sql(`select public.capture_booking_cutover_preflight_v3('${tenant}','test');`);
  sql(`select public.prepare_booking_convergence_cutover('${tenant}','test');`);
  assert.equal(sql(`select public.activate_booking_cutover_v3('${preflight}');`), "t");
  // Reuse real admission fixtures and authorities, not an imitation money reducer.
  const fixture = await readFile(
    path.join(root, "supabase/tests/booking-calendar-lifetime.sql"),
    "utf8",
  );
  const fixtureStart = fixture.indexOf("create function pg_temp.assert_true");
  const fixtureEnd = fixture.indexOf("  -- Reopened audit 6:");
  assert.ok(fixtureStart > 0 && fixtureEnd > fixtureStart);
  const appointments = JSON.parse(
    sql(
      "begin;create temp table financial_fixture(id uuid);\n" +
        fixture.slice(fixtureStart, fixtureEnd).replace(":'cutover_tenant'", `'${tenant}'`) +
        `
    for before_count in 0..23 loop
      result:=pg_temp.reserve_calendar_test(site,start_time+pg_catalog.make_interval(days=>before_count::integer));
      appointment_id:=(result->>'appointmentId')::uuid;
      p:=public.claim_booking_checkout(appointment_id,(select checkout_operation_id from public.booking_payments x where x.appointment_id=appointment_id),lease);
      perform public.prepare_booking_checkout_handoff_v3(p.id,lease,p.checkout_fencing_token,clock_timestamp()+interval '31 minutes',clock_timestamp()+interval '36 minutes',repeat('b',64));
      perform public.settle_booking_checkout(p.id,lease,p.checkout_fencing_token,'cs_'||replace(appointment_id::text,'-',''),clock_timestamp()+interval '31 minutes',true,false,null);
      insert into financial_fixture values(appointment_id);
    end loop;
    end $test$;
    select jsonb_agg(to_jsonb(p) order by a.start_at) from public.booking_payments p join public.appointments a on a.id=p.appointment_id where p.appointment_id in(select id from financial_fixture);
    commit;`,
    ),
  );
  const snapshots = appointments.map((p) => {
    const intentId = "pi_" + p.id.replaceAll("-", ""),
      chargeId = "ch_" + p.id.replaceAll("-", "");
    return {
      payment: p,
      checkout: {
        id: p.checkout_session_id,
        object: "checkout.session",
        status: "complete",
        payment_status: "paid",
        payment_intent: intentId,
        amount_total: p.expected_amount_minor,
        currency: "usd",
        livemode: false,
        metadata: {
          kind: "booking",
          appointmentId: p.appointment_id,
          profileId: tenant,
          environment: "test",
        },
      },
      intent: {
        id: intentId,
        object: "payment_intent",
        amount: p.expected_amount_minor,
        currency: "usd",
        status: "succeeded",
        latest_charge: chargeId,
        livemode: false,
        metadata: { kind: "booking", appointmentId: p.appointment_id },
      },
      charge: {
        id: chargeId,
        object: "charge",
        payment_intent: intentId,
        amount: p.expected_amount_minor,
        amount_refunded: 0,
        currency: "usd",
        paid: true,
        livemode: false,
      },
      refunds: [],
    };
  });
  function ingest(
    snapshot,
    {
      id = "evt_" + randomUUID(),
      type = "checkout.session.completed",
      object = snapshot.checkout,
      created = Math.floor(Date.now() / 1000),
    } = {},
  ) {
    const event = {
      id,
      type,
      livemode: false,
      created,
      data: { object },
    };
    return sql(`set role service_role; select public.ingest_provider_event('stripe','booking',${literal(event.id)},${literal(snapshot.payment.stripe_account_id)},
      'obra-connect-webhook','2026-08-26.dahlia',false,'test','${tenant}',${literal(event.type)},
      ${literal(createHash("sha256").update(JSON.stringify(event)).digest("hex"))},${literal(event)});`);
  }
  const eventId = ingest(snapshots[0]);
  let providerStatus = 401,
    refundCreateStatus = "succeeded",
    refundCreates = 0;
  const calls = [];
  const setReturning = new Set([
    "claim_due_booking_payment_events",
    "claim_due_booking_outbox",
    "claim_booking_calendar_reconciliation",
    "claim_booking_late_payment_arbitrations",
    "claim_due_booking_session_expiries_v3",
    "claim_ambiguous_booking_checkouts",
  ]);
  globalThis.__financialRecovery = {
    rpc(name, args) {
      calls.push({ name, args });
      const invocation = `public.${name}(${Object.entries(args)
        .map(([key, value]) => `${key}=>${literal(value)}`)
        .join(",")})`;
      const query = setReturning.has(name)
        ? `select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from ${invocation} x;`
        : `select to_jsonb(${invocation});`;
      const result = spawnSync(
        "psql",
        ["-X", "-w", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"],
        {
          cwd: root,
          env,
          input: "set role booking_worker;" + query,
          encoding: "utf8",
        },
      );
      const request = Promise.resolve(
        result.status === 0
          ? { data: JSON.parse(result.stdout.trim() || "null"), error: null }
          : {
              data: null,
              error: { code: result.stderr.match(/ERROR:\s+([A-Z0-9]{5})/)?.[1] ?? "XX000" },
            },
      );
      request.abortSignal = () => request;
      return request;
    },
  };
  process.env = {
    PATH: originalEnv.PATH,
    HOME: directory,
    TMPDIR: directory,
    STRIPE_SECRET_KEY: "sk_test_inert_recovery",
    SAAS_BILLING_ENVIRONMENT: "test",
  };
  globalThis.fetch = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.hostname, "api.stripe.com");
    if (providerStatus !== 200)
      return Response.json(
        { error: { type: "invalid_request_error", message: "Inert dependency failure" } },
        { status: providerStatus },
      );
    for (const snapshot of snapshots) {
      if (target.pathname.endsWith("/checkout/sessions/" + snapshot.checkout.id))
        return Response.json(snapshot.checkout);
      if (target.pathname.endsWith("/payment_intents/" + snapshot.intent.id))
        return Response.json(snapshot.intent);
      if (target.pathname.endsWith("/charges/" + snapshot.charge.id))
        return Response.json(snapshot.charge);
    }
    if (target.pathname === "/v1/refunds") {
      if (init.method === "POST") {
        refundCreates++;
        const body = new URLSearchParams(init.body);
        const snapshot = snapshots.find((value) => value.charge.id === body.get("charge"));
        assert.ok(snapshot);
        assert.equal(
          Number(body.get("amount")),
          snapshot.payment.expected_amount_minor - snapshot.charge.amount_refunded,
        );
        const refund = {
          id: "re_inert_recovery_" + snapshot.payment.id,
          object: "refund",
          charge: snapshot.charge.id,
          payment_intent: snapshot.intent.id,
          amount: Number(body.get("amount")),
          currency: "usd",
          status: refundCreateStatus,
          created: Math.floor(Date.now() / 1000),
          metadata: Object.fromEntries(
            [...body]
              .filter(([key]) => key.startsWith("metadata["))
              .map(([key, value]) => [key.slice(9, -1), value]),
          ),
        };
        snapshot.refunds.push(refund);
        if (refund.status === "succeeded") snapshot.charge.amount_refunded += refund.amount;
        return Response.json(refund);
      }
      const snapshot = snapshots.find(
        (value) => value.charge.id === target.searchParams.get("charge"),
      );
      assert.ok(snapshot);
      return Response.json({ data: snapshot.refunds, has_more: false });
    }
    throw new Error("Unexpected provider boundary");
  };
  const entry = path.join(directory, "workers.mjs");
  await writeFile(
    entry,
    [
      ["processBookingStripeInbox", "booking-stripe-inbox-worker.server.ts"],
      ["processBookingOutbox", "booking-outbox-worker.server.ts"],
      ["reconcileBookingLifecycle", "booking-reconciliation.server.ts"],
      ["withWorkerDeadline", "worker-deadline.server.ts"],
    ]
      .map(
        ([name, file]) =>
          `export { ${name} } from ${JSON.stringify(path.join(root, "src/lib", file))};`,
      )
      .join("\n"),
  );
  bundle = await importWithMocks(entry, {
    "@/integrations/supabase/booking-worker.server":
      "export const bookingWorker=globalThis.__financialRecovery;",
    "@/lib/pipedream.server": `export class PipedreamRequestError extends Error {};
      export const classifyPipedreamFailure=()=>"temporary";
      export const withPipedreamDeadline=(_deadline,work)=>work();
      export const getGoogleBookingEvent=async()=>({state:"present",etag:'"fixture"'});
      export const getGoogleCalendarBusyRanges=async()=>[];
      export const createGoogleBookingEvent=()=>{throw new Error("Unexpected Google create")};
      export const deleteGoogleBookingEvent=()=>{throw new Error("Unexpected Google delete")};`,
  });
  const work = (fn) => bundle.subject.withWorkerDeadline(Date.now() + 30000, fn);
  for (let attempt = 0; attempt < 9; attempt++) {
    providerStatus = attempt % 2 ? 403 : 401;
    assert.equal(
      (await work(() => bundle.subject.processBookingStripeInbox("test", 25))).failed,
      1,
    );
    const row = JSON.parse(
      sql(`select to_jsonb(i) from public.provider_event_inbox i where id='${eventId}';`),
    );
    assert.equal(row.processing_state, "failed");
    assert.equal(row.attempts, attempt + 1);
    assert.equal(
      sql(
        `select next_attempt_at>=clock_timestamp()+interval '29 minutes' and next_attempt_at<'infinity' from public.provider_event_inbox where id='${eventId}';`,
      ),
      "t",
    );
    sql(
      `update public.provider_event_inbox set next_attempt_at=clock_timestamp() where id='${eventId}';`,
    );
  }
  sql(
    `update public.appointments set reservation_expires_at=clock_timestamp()-interval '1 second' where id='${appointments[1].appointment_id}';`,
  );
  assert.equal(
    (await work(() => bundle.subject.reconcileBookingLifecycle("test"))).sessionExpiryFailures,
    1,
  );
  assert.equal(
    sql(
      `select session_expiry_next_attempt_at>=clock_timestamp()+interval '29 minutes' and session_expiry_next_attempt_at<'infinity' from public.booking_payments where id='${appointments[1].id}';`,
    ),
    "t",
  );
  assert.ok(
    calls
      .filter(({ name }) =>
        ["fail_booking_payment_event_v3", "fail_booking_session_expiry_v3"].includes(name),
      )
      .every(({ args }) => args.p_retryable && args.p_retry_delay_seconds === 1800),
  );
  providerStatus = 200;
  assert.equal(
    (await work(() => bundle.subject.processBookingStripeInbox("test", 25))).processed,
    1,
  );
  assert.equal((await work(() => bundle.subject.processBookingStripeInbox("test", 25))).claimed, 0);
  assert.equal(
    sql(`select count(*) from public.booking_stripe_observations_v3 where event_id='${eventId}';`),
    "1",
  );
  assert.equal(
    sql(
      `select amount_paid_minor=expected_amount_minor and payment_state='paid' from public.booking_payments where id='${appointments[0].id}';`,
    ),
    "t",
  );
  sql(
    `update public.booking_payments set session_expiry_next_attempt_at=clock_timestamp() where id='${appointments[1].id}';`,
  );
  assert.equal(
    (await work(() => bundle.subject.reconcileBookingLifecycle("test"))).sessionsArbitrated,
    1,
  );
  assert.equal(
    sql(
      `select amount_paid_minor=expected_amount_minor and payment_state='paid' from public.booking_payments where id='${appointments[1].id}';`,
    ),
    "t",
  );
  console.log(
    "PASS: real SDK 401/403 -> real bounded slow SQL retry beyond eight attempts -> same payment settles once after restoration",
  );

  sql(`select public.cancel_contractor_booking(a.id,a.profile_id,a.environment,p.auth_user_id,gen_random_uuid(),repeat('d',64))
    from public.appointments a join public.profiles p on p.id=a.profile_id where a.id='${appointments[0].appointment_id}';`);
  providerStatus = 403;
  assert.equal((await work(() => bundle.subject.processBookingOutbox("test", 25))).failed, 1);
  assert.equal(refundCreates, 0);
  assert.equal(
    sql(
      `select refund_state='pending' and amount_refunded_minor=0 from public.booking_payments where id='${appointments[0].id}';`,
    ),
    "t",
  );
  assert.equal(
    sql(
      `select next_attempt_at>=clock_timestamp()+interval '29 minutes' and terminal_at is null from public.integration_outbox where appointment_id='${appointments[0].appointment_id}' and command_type='refund';`,
    ),
    "t",
  );
  providerStatus = 200;
  sql(
    `update public.integration_outbox set next_attempt_at=clock_timestamp() where appointment_id='${appointments[0].appointment_id}' and command_type='refund';`,
  );
  assert.equal((await work(() => bundle.subject.processBookingOutbox("test", 25))).processed, 1);
  assert.equal((await work(() => bundle.subject.processBookingOutbox("test", 25))).claimed, 0);
  assert.equal(refundCreates, 1);
  assert.equal(
    sql(
      `select amount_refunded_minor=expected_amount_minor and refund_state='succeeded' from public.booking_payments where id='${appointments[0].id}';`,
    ),
    "t",
  );
  const invalidEvent = ingest(snapshots[2]);
  providerStatus = 400;
  assert.equal((await work(() => bundle.subject.processBookingStripeInbox("test", 25))).failed, 1);
  providerStatus = 200;
  assert.equal((await work(() => bundle.subject.processBookingStripeInbox("test", 25))).claimed, 0);
  assert.equal(
    sql(`select processing_state from public.provider_event_inbox where id='${invalidEvent}';`),
    "dead_letter",
  );
  assert.equal(
    sql(`select amount_paid_minor from public.booking_payments where id='${appointments[2].id}';`),
    "0",
  );
  console.log(
    "PASS: real refund authority survives provider permission outage; one refund after recovery; terminal evidence is never mass-reset",
  );
  const conflictingEvent = ingest(snapshots[2]);
  snapshots[2].intent.amount++;
  assert.equal((await work(() => bundle.subject.processBookingStripeInbox("test", 25))).failed, 1);
  assert.equal(
    sql(
      `select count(*) from public.booking_stripe_observations_v3 where event_id='${conflictingEvent}';`,
    ),
    "0",
  );
  assert.equal(
    sql(`select amount_paid_minor from public.booking_payments where id='${appointments[2].id}';`),
    "0",
  );
  assert.equal(
    sql(
      `select payment_state from public.appointments where id='${appointments[2].appointment_id}';`,
    ),
    "pending",
  );
  console.log(
    "PASS: successful HTTP carrying conflicting financial identity/amount cannot settle payment",
  );

  function observe(snapshot, event, rejected = null) {
    const id = ingest(snapshot, event),
      lease = randomUUID();
    const claims = JSON.parse(
      sql(`set role booking_worker; select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb)
        from public.claim_due_booking_payment_events('test','${lease}',1) i;`),
    );
    assert.deepEqual(
      claims.map((claim) => claim.id),
      [id],
    );
    const reduce = () =>
      sql(`set role booking_worker; select public.reduce_booking_financial_evidence_v3(
        'stripe_event','${id}','${lease}',${claims[0].fencing_token},${literal({
          stripeAccountId: snapshot.payment.stripe_account_id,
          checkout: snapshot.checkout,
          paymentIntent: snapshot.intent,
          charge: snapshot.charge,
          refunds: snapshot.refunds,
          refundsHasMore: false,
        })});`);
    if (rejected) {
      assert.throws(reduce, rejected);
      assert.equal(
        sql(`set role booking_worker; select public.fail_booking_payment_event_v3(
          '${id}','${lease}',${claims[0].fencing_token},false,'Rejected inert evidence');`),
        "t",
      );
    } else {
      assert.equal(JSON.parse(reduce()).action, "settled");
      assert.equal(
        sql(`select i.processing_state='processed' and count(o.id)=1
          from public.provider_event_inbox i left join public.booking_stripe_observations_v3 o on o.event_id=i.id
          where i.id='${id}' group by i.processing_state;`),
        "t",
      );
    }
    return id;
  }
  function assertDispute(snapshot, state, created, rank, message) {
    const paymentState = ["none", "won"].includes(state) ? "paid" : "disputed";
    assert.deepEqual(
      JSON.parse(
        sql(`select jsonb_build_array(p.payment_state,a.payment_state,p.dispute_state,
          p.dispute_provider_created,p.dispute_status_rank,p.dispute_id,p.amount_paid_minor,p.amount_refunded_minor)
          from public.booking_payments p join public.appointments a on a.id=p.appointment_id
          where p.id='${snapshot.payment.id}';`),
      ),
      [
        paymentState,
        paymentState,
        state,
        created,
        rank,
        state === "none" ? null : "dp_" + snapshot.payment.id,
        snapshot.payment.expected_amount_minor,
        snapshot.charge.amount_refunded,
      ],
      message,
    );
  }

  const causalTime = Math.floor(Date.now() / 1000) - 600,
    ownerId = sql(`select auth_user_id from public.profiles where id='${tenant}';`);
  // These immutable files contain the effective authorities at shipped base
  // 8354719. Do not repair their label bug or substitute the unshipped PR body.
  const shippedMoney = await readFile(
    path.join(root, "supabase/migrations/20260829093921_booking_money_authority_closure.sql"),
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(shippedMoney).digest("hex"),
    "8638b1e9ecfb69a901062d42bcab5f4e7f4040fa1578ba03436d1d93f913d345",
    "upgrade fixture is the exact effective money migration shipped at 8354719",
  );
  const shippedConvergence = await readFile(
    path.join(root, "supabase/migrations/20260829093922_booking_google_convergence_closure.sql"),
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(shippedConvergence).digest("hex"),
    "11fe4c4cd56a72f96050864afd93c19c946c62e8fccf60b5543f83a2eabee74f",
  );
  const authorities = [
    [shippedMoney, "reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)"],
    [shippedConvergence, "claim_booking_late_payment_arbitrations(text,uuid,integer)"],
    [
      shippedConvergence,
      "record_booking_late_payment_observation(uuid,uuid,bigint,bigint,timestamptz,text,jsonb,text)",
    ],
  ];
  const currentAuthorities =
    authorities
      .map(([, signature]) =>
        sql(`select pg_get_functiondef('public.${signature}'::regprocedure);`),
      )
      .join(";\n") + ";";
  const shippedAuthorities = authorities
    .map(([source, signature]) => {
      const name = signature.slice(0, signature.indexOf("("));
      const definition = source.match(
        new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?end \\$function\\$;`),
      )?.[0];
      assert.ok(definition, name);
      return definition;
    })
    .join("\n");
  sql("set role booking_test_owner;" + shippedAuthorities);
  const upgradeCases = [
    "pending",
    "failure",
    "refund_succeeded",
    "refund_failed",
    "cancel_failed",
    "zero_paid",
    "elapsed_expiry",
    "refund_dependency_failure",
    "cancel_precedence",
    "elapsed_refunded",
    "arbitration_failed",
    "arbitration_disputed",
    "future_refunded",
    "future_refunded_cancel",
    "future_partial_refunded",
    "future_partial_failed",
  ];
  for (const [index, name] of upgradeCases.entries()) {
    const snapshot = snapshots[index + 8],
      elapsed = name.startsWith("elapsed_"),
      futureRefund = name.startsWith("future_"),
      pending = {
        ...snapshot,
        checkout: { ...snapshot.checkout, payment_status: "unpaid" },
        intent: { ...snapshot.intent, status: "processing", latest_charge: null },
        charge: null,
      },
      lost = {
        id: "dp_" + snapshot.payment.id,
        object: "dispute",
        charge: snapshot.charge.id,
        status: name === "future_refunded_cancel" ? "warning_closed" : "lost",
      };
    observe(pending, { created: causalTime });
    if (name !== "zero_paid") {
      sql(`update public.appointments set reservation_expires_at=clock_timestamp()-interval '1 second'
        where id='${snapshot.payment.appointment_id}';`);
    }
    if (index === 0) {
      observe(
        snapshot,
        {
          type: "charge.dispute.closed",
          object: { ...lost, status: "won" },
          created: causalTime + 1,
        },
        /missing FROM-clause entry for table "reduce_booking_financial_evidence_v3"/,
      );
      assert.equal(
        sql(`select a.appointment_state='payment_pending' and p.amount_paid_minor=0
        and not exists(select 1 from public.booking_late_payment_arbitrations b where b.payment_id=p.id)
        and not exists(select 1 from public.integration_outbox o where o.appointment_id=a.id and o.command_type='refund')
        from public.appointments a join public.booking_payments p on p.appointment_id=a.id where p.id='${snapshot.payment.id}';`),
        "t",
        "8354719 first-won successful Stripe event rolls back, unlike cea35b9",
      );
    }
    if (name === "zero_paid") {
      observe(
        { ...pending, charge: snapshot.charge },
        { type: "charge.dispute.closed", object: lost, created: causalTime + 10 },
      );
      continue;
    }
    if (elapsed) {
      sql(`update public.appointments set start_at=clock_timestamp()-interval '1 hour',end_at=clock_timestamp(),
        capacity_range=tstzrange(clock_timestamp()-interval '1 hour',clock_timestamp(),'[)') where id='${snapshot.payment.appointment_id}';`);
    }
    if (name === "elapsed_refunded" || futureRefund) {
      for (const [part, amount] of (name.includes("partial") ? [4000] : [4000, 6000]).entries()) {
        snapshot.refunds.push({
          id: "re_external_" + snapshot.payment.id + "_" + part,
          object: "refund",
          charge: snapshot.charge.id,
          payment_intent: snapshot.intent.id,
          amount,
          currency: "usd",
          status: "succeeded",
          created: causalTime + part + 1,
          metadata: {},
        });
        snapshot.charge.amount_refunded += amount;
      }
    }
    const expiryLease = randomUUID(),
      [expiryClaim] = JSON.parse(
        sql(`set role booking_worker; select jsonb_agg(to_jsonb(p))
        from public.claim_due_booking_session_expiries_v3('test','${expiryLease}',1) p;`),
      );
    assert.equal(expiryClaim.id, snapshot.payment.id);
    if (!elapsed && name !== "future_refunded") {
      observe(
        { ...pending, charge: snapshot.charge },
        { type: "charge.dispute.closed", object: lost, created: causalTime + 10 },
      );
    }
    const expiry = JSON.parse(
      sql(`set role booking_worker; select public.reduce_booking_financial_evidence_v3(
      'session_expiry','${snapshot.payment.id}','${expiryLease}',${expiryClaim.checkout_fencing_token},${literal(
        {
          stripeAccountId: snapshot.payment.stripe_account_id,
          checkout: snapshot.checkout,
          paymentIntent: snapshot.intent,
          charge: snapshot.charge,
          refunds: snapshot.refunds,
          refundsHasMore: false,
        },
      )});`),
    );
    assert.equal(expiry.outcome, "expiry_paid_arbitration_required");
    if (futureRefund)
      assert.equal(
        sql(`select p.amount_refunded_minor=${snapshot.charge.amount_refunded}
      and p.refund_state='not_requested' and a.refund_state='not_requested' and p.refunded_at is null
      from public.booking_payments p join public.appointments a on a.id=p.appointment_id where p.id='${snapshot.payment.id}';`),
        "t",
        "exact shipped future expiry retains provider refund amounts while omitting terminal refund projections",
      );
    assert.equal(
      sql(`select p.payment_state='paid' and a.payment_state='paid' and p.amount_paid_minor=p.expected_amount_minor
       and p.dispute_state='${elapsed || name === "future_refunded" ? "none" : name === "future_refunded_cancel" ? "closed" : "lost"}' and a.appointment_reason='late_payment_arbitration'
      and (select count(*) from public.booking_late_payment_arbitrations b where b.payment_id=p.id)=${elapsed ? 0 : 1}
      from public.booking_payments p join public.appointments a on a.id=p.appointment_id where p.id='${snapshot.payment.id}';`),
      "t",
      "exact shipped expiry establishes both the paid/dispute overwrite and the elapsed provisional orphan",
    );
    if (index === 0) {
      observe(
        snapshot,
        { created: causalTime - 1 },
        /missing FROM-clause entry for table "reduce_booking_financial_evidence_v3"/,
      );
    }
    if (elapsed || futureRefund) continue;
    if (name === "arbitration_disputed") continue;
    if (name === "arbitration_failed") {
      observe(
        { ...pending, charge: snapshot.charge },
        { type: "charge.dispute.closed", object: lost, created: causalTime + 20 },
      );
      observe(
        {
          ...pending,
          checkout: null,
          intent: { ...pending.intent, status: "requires_payment_method" },
        },
        { type: "payment_intent.payment_failed", object: pending.intent, created: causalTime + 1 },
      );
      assert.equal(
        sql(`select p.payment_state='failed' and a.payment_state='disputed' and a.appointment_reason='late_payment_arbitration'
        and p.amount_paid_minor=p.expected_amount_minor from public.booking_payments p join public.appointments a
        on a.id=p.appointment_id where p.id='${snapshot.payment.id}';`),
        "t",
      );
      continue;
    }
    const lease = randomUUID(),
      claims = JSON.parse(
        sql(`set role booking_worker; select jsonb_agg(to_jsonb(c))
        from public.claim_booking_late_payment_arbitrations('test','${lease}',25) c;`),
      );
    assert.ok(claims.some((claim) => claim.appointment.id === snapshot.payment.appointment_id));
    for (const claim of claims) {
      assert.equal(
        sql(`set role booking_worker; select public.record_booking_late_payment_observation(
        '${claim.arbitration.id}','${lease}',${claim.arbitration.fencing_token},${claim.arbitration.snapshot_generation},
        clock_timestamp(),'complete','[]'::jsonb);`),
        "recovered",
      );
    }
    if (["failure", "cancel_failed"].includes(name)) {
      observe(
        { ...pending, charge: snapshot.charge },
        { type: "charge.dispute.closed", object: lost, created: causalTime + 20 },
      );
      observe(
        {
          ...pending,
          checkout: null,
          intent: { ...pending.intent, status: "requires_payment_method" },
        },
        { type: "payment_intent.payment_failed", object: pending.intent, created: causalTime + 1 },
      );
      assert.equal(
        sql(`select p.payment_state='failed' and a.payment_state='disputed' and p.amount_paid_minor=p.expected_amount_minor
        and a.appointment_state='confirmed' and p.dispute_state='lost' from public.booking_payments p
        join public.appointments a on a.id=p.appointment_id where p.id='${snapshot.payment.id}';`),
        "t",
        "8354719 failure downgrades only the payment, despite retained captured money and lost dispute",
      );
    }
  }
  sql("set role booking_test_owner;" + currentAuthorities);
  console.log(
    "PASS: exact 8354719 authorities reproduce persisted expiry/dispute and failure anomalies; first-won Stripe trace rolls back",
  );
  for (const [index, name] of upgradeCases.entries()) {
    const snapshot = snapshots[index + 8];
    if (["pending", "failure", "zero_paid"].includes(name)) {
      const status = name === "pending" ? "processing" : "requires_payment_method";
      observe(
        {
          ...snapshot,
          checkout: null,
          intent: { ...snapshot.intent, status, latest_charge: null },
          charge: null,
        },
        {
          type: name === "pending" ? "payment_intent.succeeded" : "payment_intent.payment_failed",
          object: snapshot.intent,
          created: causalTime + 2,
        },
      );
      if (name === "zero_paid") {
        assert.equal(
          sql(`select amount_paid_minor=0 and amount_refunded_minor=0 and paid_at is null and refunded_at is null
          and refund_state='not_requested' from public.booking_payments
          where id='${snapshot.payment.id}';`),
          "t",
          "a retained dispute alone never invents captured money",
        );
        assert.throws(
          () =>
            sql(`set role service_role; select public.cancel_contractor_booking(
          '${snapshot.payment.appointment_id}','${tenant}','test','${ownerId}',gen_random_uuid(),repeat('d',64));`),
          /booking is not eligible for contractor cancellation/,
        );
      } else {
        assertDispute(
          snapshot,
          "lost",
          causalTime + (name === "failure" ? 20 : 10),
          22,
          "post-upgrade nonsuccess observation normalizes only authoritative retained captured/dispute truth",
        );
      }
    } else if (
      name.startsWith("refund_") ||
      name === "cancel_failed" ||
      name === "cancel_precedence"
    ) {
      sql(`set role service_role; select public.cancel_contractor_booking(
        '${snapshot.payment.appointment_id}','${tenant}','test','${ownerId}',gen_random_uuid(),repeat('d',64));`);
      if (name === "cancel_precedence") {
        sql(`update public.appointments set start_at=clock_timestamp()-interval '1 hour',end_at=clock_timestamp(),
          capacity_range=tstzrange(clock_timestamp()-interval '1 hour',clock_timestamp(),'[)') where id='${snapshot.payment.appointment_id}';`);
        const won = {
          id: "dp_" + snapshot.payment.id,
          object: "dispute",
          charge: snapshot.charge.id,
          status: "won",
        };
        observe(snapshot, { type: "charge.dispute.closed", object: won, created: causalTime + 30 });
        observe(snapshot, { created: causalTime - 1 });
      }
      const failed = ["refund_failed", "refund_dependency_failure"].includes(name);
      refundCreateStatus = failed ? "failed" : "succeeded";
      const createsBefore = refundCreates;
      if (name === "refund_dependency_failure") providerStatus = 400;
      const counts = await work(() => bundle.subject.processBookingOutbox("test", 25));
      providerStatus = 200;
      assert.equal(counts[failed ? "failed" : "processed"], 1);
      if (name === "refund_dependency_failure")
        assert.equal(refundCreates, createsBefore, "failed snapshot fetch never submits a refund");
      assertDispute(
        snapshot,
        name === "cancel_precedence" ? "won" : "lost",
        causalTime + (name === "cancel_failed" ? 20 : name === "cancel_precedence" ? 30 : 10),
        22,
        "post-upgrade cancellation/refund settlement repairs stale classification without changing dispute authority",
      );
      assert.equal(
        sql(`select a.appointment_state='cancelled' and a.appointment_reason='contractor_cancelled'
        and a.cancellation_requested_at is not null and a.refund_generation=1 and p.refund_generation=1
        and a.refund_state='${refundCreateStatus}' and p.refund_state=a.refund_state from public.appointments a
        join public.booking_payments p on p.appointment_id=a.id where p.id='${snapshot.payment.id}';`),
        "t",
      );
    } else if (name.startsWith("future_")) {
      const full = !name.includes("partial"),
        cancelled = name === "future_refunded_cancel",
        beforeCreates = refundCreates,
        cancelRequest = randomUUID(),
        deadline = sql(
          `select deadline_at from public.booking_late_payment_arbitrations where payment_id='${snapshot.payment.id}';`,
        );
      const cancel = () =>
        sql(`set role service_role; select public.cancel_contractor_booking(
        '${snapshot.payment.appointment_id}','${tenant}','test','${ownerId}','${cancelRequest}',repeat('d',64));`);
      if (cancelled) {
        cancel();
      } else {
        const lease = randomUUID(),
          [claim] = JSON.parse(
            sql(`set role booking_worker; select jsonb_agg(to_jsonb(c))
            from public.claim_booking_late_payment_arbitrations('test','${lease}',1) c;`),
          );
        assert.equal(claim.appointment.id, snapshot.payment.appointment_id);
        assert.equal(
          sql(`set role booking_worker; select public.record_booking_late_payment_observation(
          '${claim.arbitration.id}','${lease}',${claim.arbitration.fencing_token},${claim.arbitration.snapshot_generation},
          clock_timestamp(),'complete','[]'::jsonb);`),
          "refund_required",
        );
      }
      assert.equal(
        sql(`select a.refund_state='${full ? "succeeded" : "pending"}' and p.refund_state=a.refund_state
        and a.appointment_state='cancelled' and a.appointment_reason='${cancelled ? "contractor_cancelled" : "late_payment_refund"}'
        and (a.cancellation_requested_at is not null)=${cancelled} and a.refund_generation=${full ? 0 : 1}
        and p.refund_generation=a.refund_generation from public.appointments a join public.booking_payments p
        on p.appointment_id=a.id where p.id='${snapshot.payment.id}';`),
        "t",
        "future shipped expiry converges its actual arbitration and terminal refund projection",
      );
      assert.equal(
        sql(
          `select deadline_at from public.booking_late_payment_arbitrations where payment_id='${snapshot.payment.id}';`,
        ),
        deadline,
      );
      if (full) {
        assertDispute(
          snapshot,
          cancelled ? "closed" : "none",
          cancelled ? causalTime + 10 : 0,
          cancelled ? 22 : 0,
          "full refund retains warning_closed classification and never resets the dispute clock",
        );
        assert.equal(
          sql(`select refunded_at=to_timestamp(${causalTime + 2}) from public.booking_payments
          where id='${snapshot.payment.id}';`),
          "t",
          "refund timestamp is the last succeeded refund in retained provider evidence",
        );
        assert.equal(
          sql(
            `select public.booking_confirmation_projection_v3('${snapshot.payment.appointment_id}')->>'statusCode';`,
          ),
          "refund_succeeded",
        );
        assert.equal(
          sql(`select count(*) from public.booking_notifications where appointment_id='${snapshot.payment.appointment_id}'
          and notification_type='refund_succeeded' and source_event_key='refund:0:succeeded';`),
          "2",
        );
        const beforeReplay =
          sql(`select jsonb_build_array(a.version,p.refunded_at,p.refund_generation)
          from public.appointments a join public.booking_payments p on p.appointment_id=a.id where p.id='${snapshot.payment.id}';`);
        if (cancelled) {
          cancel();
          assert.equal(
            sql(`select jsonb_build_array(a.version,p.refunded_at,p.refund_generation)
            from public.appointments a join public.booking_payments p on p.appointment_id=a.id where p.id='${snapshot.payment.id}';`),
            beforeReplay,
          );
        }
        observe(
          {
            ...snapshot,
            checkout: null,
            intent: { ...snapshot.intent, status: "requires_payment_method", latest_charge: null },
            charge: null,
            refunds: [],
          },
          {
            type: "payment_intent.payment_failed",
            object: snapshot.intent,
            created: causalTime - 1,
          },
        );
        observe(snapshot, { created: causalTime - 2 });
        assertDispute(
          snapshot,
          cancelled ? "closed" : "none",
          cancelled ? causalTime + 10 : 0,
          cancelled ? 22 : 0,
          "older financial replays preserve the completed full refund and dispute classification",
        );
        assert.equal(
          sql(
            `select count(*) from public.integration_outbox where appointment_id='${snapshot.payment.appointment_id}' and command_type='refund';`,
          ),
          "0",
        );
        assert.equal(
          sql(`select count(*) from public.booking_notifications where appointment_id='${snapshot.payment.appointment_id}'
          and notification_type='refund_succeeded';`),
          "2",
          "replays do not duplicate refund notifications",
        );
      } else {
        refundCreateStatus = name === "future_partial_failed" ? "failed" : "succeeded";
        const counts = await work(() => bundle.subject.processBookingOutbox("test", 25));
        assert.equal(counts[refundCreateStatus === "failed" ? "failed" : "processed"], 1);
        assert.equal(
          refundCreates,
          beforeCreates + 1,
          "partial refund submits only the real remainder once",
        );
        assert.equal(
          sql(`select a.refund_state='${refundCreateStatus}' and p.refund_state=a.refund_state
          and p.amount_refunded_minor=${refundCreateStatus === "failed" ? 4000 : 10000}
          and (p.refunded_at is null)=${refundCreateStatus === "failed"} and p.refund_generation=1
          from public.appointments a join public.booking_payments p on p.appointment_id=a.id where p.id='${snapshot.payment.id}';`),
          "t",
        );
        cancel();
        cancel();
        assert.equal(
          sql(
            `select refund_state from public.booking_payments where id='${snapshot.payment.id}';`,
          ),
          refundCreateStatus,
          "operator cancellation replay cannot turn a failed partial refund into a full refund or new pending generation",
        );
        assertDispute(
          snapshot,
          "lost",
          causalTime + 10,
          22,
          "partial refund success/failure retains disputed captured money",
        );
      }
      assert.equal((await work(() => bundle.subject.processBookingOutbox("test", 25))).claimed, 0);
      assert.equal(
        refundCreates,
        beforeCreates + (full ? 0 : 1),
        "zero remainder never creates another refund",
      );
    } else if (name.startsWith("arbitration_")) {
      const deadline = sql(
          `select deadline_at from public.booking_late_payment_arbitrations where payment_id='${snapshot.payment.id}';`,
        ),
        lease = randomUUID(),
        [claim] = JSON.parse(
          sql(`set role booking_worker; select jsonb_agg(to_jsonb(c))
          from public.claim_booking_late_payment_arbitrations('test','${lease}',1) c;`),
        );
      assert.equal(claim.appointment.id, snapshot.payment.appointment_id);
      assert.equal(
        sql(`set role booking_worker; select public.record_booking_late_payment_observation(
        '${claim.arbitration.id}','${lease}',${claim.arbitration.fencing_token},${claim.arbitration.snapshot_generation},
        clock_timestamp(),'complete','[]'::jsonb);`),
        "refund_required",
        "existing arbitration must refund a retained dispute regardless of its stale paid/failed projection",
      );
      assert.equal(
        sql(
          `select deadline_at from public.booking_late_payment_arbitrations where payment_id='${snapshot.payment.id}';`,
        ),
        deadline,
        "upgrade does not replace or extend an existing arbitration deadline",
      );
      refundCreateStatus = "succeeded";
      assert.equal(
        (await work(() => bundle.subject.processBookingOutbox("test", 25))).processed,
        1,
      );
      assertDispute(
        snapshot,
        "lost",
        causalTime + (name === "arbitration_failed" ? 20 : 10),
        22,
        "arbitration refund converges retained dispute truth through the money reducer",
      );
    } else {
      const fullyRefunded = name === "elapsed_refunded";
      const observed = sql(`select observed_at from public.booking_stripe_observations_v3
        where payment_id='${snapshot.payment.id}' and reduction_outcome='expiry_paid_arbitration_required';`);
      observe(
        {
          ...snapshot,
          checkout: null,
          intent: { ...snapshot.intent, status: "requires_payment_method", latest_charge: null },
          charge: null,
          refunds: [],
        },
        { type: "payment_intent.payment_failed", object: snapshot.intent, created: causalTime + 2 },
      );
      assert.equal(
        sql(`select a.appointment_state='cancelled'
        and a.refund_state='${fullyRefunded ? "succeeded" : "pending"}' and p.refund_state=a.refund_state
        and a.refund_generation=${fullyRefunded ? 0 : 1} and p.refund_generation=a.refund_generation
        and not exists(select 1 from public.booking_late_payment_arbitrations b where b.payment_id=p.id)
        from public.appointments a join public.booking_payments p on p.appointment_id=a.id where p.id='${snapshot.payment.id}';`),
        "t",
        "elapsed shipped expiry orphan uses the existing refund obligation without opening any arbitration window",
      );
      if (fullyRefunded)
        assert.equal(
          sql(`select refunded_at=to_timestamp(${causalTime + 2}) from public.booking_payments
        where id='${snapshot.payment.id}';`),
          "t",
          "retained terminal projection uses provider time on nonsuccess replay too",
        );
      observe(snapshot, { created: causalTime + 3 });
      assert.equal(
        sql(`select observed_at from public.booking_stripe_observations_v3
        where payment_id='${snapshot.payment.id}' and reduction_outcome='expiry_paid_arbitration_required';`),
        observed,
      );
      assert.equal(
        sql(`select count(*)=${fullyRefunded ? 0 : 1} and coalesce(bool_and(effect_generation=1),true) from public.integration_outbox
        where appointment_id='${snapshot.payment.appointment_id}' and command_type='refund';`),
        "t",
      );
      refundCreateStatus = "succeeded";
      assert.equal(
        (await work(() => bundle.subject.processBookingOutbox("test", 25))).processed,
        fullyRefunded ? 0 : 1,
      );
    }
  }
  console.log(
    "PASS: upgrades normalize retained paid/dispute truth and restore only attributable provisional obligations without renewing deadlines",
  );
  for (const [index, snapshot] of snapshots.slice(3, 6).entries()) {
    if (index === 1) {
      observe(
        {
          ...snapshot,
          checkout: { ...snapshot.checkout, payment_status: "unpaid" },
          intent: { ...snapshot.intent, status: "processing", latest_charge: null },
          charge: null,
        },
        { created: causalTime },
      );
      assert.equal(
        sql(`select payment_state='pending' and amount_paid_minor=0 and dispute_state='none'
        from public.booking_payments where id='${snapshot.payment.id}';`),
        "t",
      );
      observe(
        {
          ...snapshot,
          intent: { ...snapshot.intent, status: "requires_payment_method" },
          charge: { ...snapshot.charge, paid: false },
        },
        {
          type: "charge.dispute.created",
          created: causalTime + 1,
          object: {
            id: "dp_" + snapshot.payment.id,
            object: "dispute",
            charge: snapshot.charge.id,
            status: "needs_response",
          },
        },
        /dispute requires successful Charge evidence/,
      );
      assert.equal(
        sql(`select payment_state='pending' and amount_paid_minor=0 and dispute_state='none'
        from public.booking_payments where id='${snapshot.payment.id}';`),
        "t",
        "contradictory unpaid dispute snapshot cannot establish financial truth",
      );
    } else {
      observe(snapshot, { created: causalTime });
      assertDispute(
        snapshot,
        "none",
        0,
        0,
        "initial payment is still paid without dispute evidence",
      );
    }
    if (index === 2) {
      sql(`set role service_role; select public.cancel_contractor_booking(
        '${snapshot.payment.appointment_id}','${tenant}','test','${ownerId}',gen_random_uuid(),repeat('d',64));`);
    }
    const statuses =
      index === 1
        ? ["warning_needs_response", "warning_under_review", "warning_closed"]
        : ["needs_response", "under_review", ...(index === 0 ? ["lost"] : [])];
    let dispute, latestEvent, latestInboxId, disputeState, disputeCreated, disputeRank;
    for (const [step, status] of statuses.entries()) {
      dispute = {
        id: "dp_" + snapshot.payment.id,
        object: "dispute",
        charge: snapshot.charge.id,
        status,
      };
      disputeCreated = causalTime + 10 * (status === "warning_closed" ? step : step + 1);
      disputeState = status === "lost" ? "lost" : status === "warning_closed" ? "closed" : "open";
      disputeRank = disputeState === "open" ? 21 : 22;
      latestEvent = {
        id: "evt_" + randomUUID(),
        type:
          disputeRank === 22
            ? "charge.dispute.closed"
            : step === 0
              ? "charge.dispute.created"
              : "charge.dispute.updated",
        object: dispute,
        created: disputeCreated,
      };
      latestInboxId = observe(snapshot, latestEvent);
      assertDispute(
        snapshot,
        disputeState,
        disputeCreated,
        disputeRank,
        "current dispute evidence is authoritative",
      );
    }
    if (index === 0) {
      for (const table of ["booking_payments", "appointments"]) {
        assert.throws(
          () =>
            sql(`set role booking_test_owner; update public.${table} set payment_state='paid'
          where id='${table === "appointments" ? snapshot.payment.appointment_id : snapshot.payment.id}';`),
          /booking financial truth is reducer-owned/,
        );
      }
    }
    for (const event of [
      {
        type: "charge.dispute.created",
        object: { ...dispute, status: "needs_response" },
        created: causalTime + 1,
      },
      { type: "checkout.session.completed", created: causalTime + 2 },
      { type: "payment_intent.succeeded", object: snapshot.intent, created: causalTime + 3 },
      {
        type: "charge.dispute.closed",
        object: { ...dispute, status: "won" },
        created: disputeCreated - 1,
      },
      {
        type: "charge.dispute.updated",
        object: { ...dispute, status: "under_review" },
        created: disputeCreated,
      },
      { type: "checkout.session.completed", created: disputeCreated + 100 },
    ]) {
      observe(snapshot, event);
      assertDispute(
        snapshot,
        disputeState,
        disputeCreated,
        disputeRank,
        `${event.type} at ${event.created} cannot clear ${disputeState}`,
      );
    }
    assert.equal(
      ingest(snapshot, latestEvent),
      latestInboxId,
      "exact delivery replay retains its inbox identity",
    );
    assert.equal(
      sql(
        `set role booking_worker; select count(*) from public.claim_due_booking_payment_events('test','${randomUUID()}',1);`,
      ),
      "0",
    );
    observe(snapshot, { ...latestEvent, id: "evt_" + randomUUID() });
    assertDispute(
      snapshot,
      disputeState,
      disputeCreated,
      disputeRank,
      "separate equal-clock observation retains equivalent dispute classification",
    );

    const failure = {
      ...snapshot,
      checkout: null,
      intent: { ...snapshot.intent, status: "requires_payment_method", latest_charge: null },
      charge: null,
    };
    observe(failure, {
      type: "payment_intent.payment_failed",
      object: failure.intent,
      created: causalTime + 1,
    });
    assertDispute(
      snapshot,
      disputeState,
      disputeCreated,
      disputeRank,
      "older failure cannot replace paid/disputed truth",
    );
    observe(
      { ...failure, intent: { ...failure.intent, status: "processing" } },
      { type: "payment_intent.succeeded", object: snapshot.intent, created: causalTime + 2 },
    );
    assertDispute(
      snapshot,
      disputeState,
      disputeCreated,
      disputeRank,
      "pending snapshot cannot reset a disputed payment",
    );

    const expired = {
      ...failure,
      checkout: {
        ...snapshot.checkout,
        status: "expired",
        payment_status: "unpaid",
        payment_intent: null,
      },
      intent: null,
    };
    observe(
      expired,
      { type: "checkout.session.expired", created: causalTime + 1 },
      /PaymentIntent binding mismatch/,
    );
    assertDispute(
      snapshot,
      disputeState,
      disputeCreated,
      disputeRank,
      "expiry without the bound intent is still rejected",
    );
    observe(
      {
        ...failure,
        checkout: { ...snapshot.checkout, status: "expired", payment_status: "unpaid" },
      },
      { type: "checkout.session.expired", created: causalTime + 2 },
    );
    assertDispute(
      snapshot,
      disputeState,
      disputeCreated,
      disputeRank,
      "bound unpaid expiry cannot clear dispute authority",
    );

    if (index === 2) {
      const refundsBefore = refundCreates;
      refundCreateStatus = "pending";
      assert.equal(
        (await work(() => bundle.subject.processBookingOutbox("test", 25))).processed,
        1,
      );
      assert.equal(
        refundCreates,
        refundsBefore + 1,
        "disputed cancellation creates only its owned refund",
      );
      assertDispute(
        snapshot,
        disputeState,
        disputeCreated,
        disputeRank,
        "refund command preserves disputed classification",
      );
      observe(snapshot, {
        type: "refund.updated",
        object: snapshot.refunds[0],
        created: disputeCreated + 100,
      });
      assertDispute(
        snapshot,
        disputeState,
        disputeCreated,
        disputeRank,
        "pending refund webhook preserves disputed cancellation",
      );
      observe({ ...snapshot, refunds: [] }, { created: causalTime + 2 });
      assertDispute(
        snapshot,
        disputeState,
        disputeCreated,
        disputeRank,
        "older empty refund snapshot cannot clear a pending refund",
      );
      snapshot.refunds[0].status = "succeeded";
      snapshot.charge.amount_refunded = snapshot.refunds[0].amount;
      sql(`update public.integration_outbox set next_attempt_at=clock_timestamp()
        where appointment_id='${snapshot.payment.appointment_id}' and command_type='refund';`);
      assert.equal(
        (await work(() => bundle.subject.processBookingOutbox("test", 25))).processed,
        1,
      );
      assert.equal(
        refundCreates,
        refundsBefore + 1,
        "pending refund settles without a second creation",
      );
      assertDispute(
        snapshot,
        disputeState,
        disputeCreated,
        disputeRank,
        "full refund command retains disputed state",
      );
      observe(snapshot, {
        type: "refund.updated",
        object: snapshot.refunds[0],
        created: disputeCreated + 101,
      });
      assertDispute(
        snapshot,
        disputeState,
        disputeCreated,
        disputeRank,
        "full refund webhook preserves disputed classification",
      );
      observe(snapshot, { created: causalTime + 2 });
      assertDispute(
        snapshot,
        disputeState,
        disputeCreated,
        disputeRank,
        "delayed Checkout with complete refunds remains disputed",
      );
      observe(
        { ...snapshot, charge: { ...snapshot.charge, amount_refunded: 0 }, refunds: [] },
        { created: causalTime + 3 },
        /non-causal or incomplete refund snapshot/,
      );
    }

    observe(snapshot, {
      type: "charge.dispute.closed",
      object: { ...dispute, status: "won" },
      created: disputeCreated + 1,
    });
    assertDispute(
      snapshot,
      "won",
      disputeCreated + 1,
      22,
      "genuinely newer won evidence recovers both payment projections",
    );
    observe(snapshot, { ...latestEvent, id: "evt_" + randomUUID() });
    assertDispute(
      snapshot,
      "won",
      disputeCreated + 1,
      22,
      "older dispute cannot undo won recovery",
    );
    observe(snapshot, {
      type: "charge.dispute.closed",
      object: { ...dispute, status: "lost" },
      created: disputeCreated + 1,
    });
    assertDispute(
      snapshot,
      "lost",
      disputeCreated + 1,
      22,
      "distinct event identity at equal timestamp/rank follows the existing acceptance policy",
    );
    observe(snapshot, {
      type: "charge.dispute.closed",
      object: { ...dispute, status: "won" },
      created: disputeCreated + 1,
    });
    assertDispute(
      snapshot,
      "won",
      disputeCreated + 1,
      22,
      "equal-clock won evidence remains accepted without inventing a terminal status ranking",
    );
    assert.equal(
      sql(`select a.appointment_state='${index === 2 ? "cancelled" : "confirmed"}'
        and a.refund_state='${index === 2 ? "succeeded" : "not_requested"}'
        and p.refund_state=a.refund_state and a.refund_generation=p.refund_generation and a.refund_generation=${index === 2 ? 1 : 0}
        and (a.cancellation_requested_at is not null)=${index === 2}
        and l.desired_state='${index === 2 ? "absent" : "present"}'
        from public.appointments a join public.booking_payments p on p.appointment_id=a.id
        join public.calendar_event_links l on l.appointment_id=a.id where a.id='${snapshot.payment.appointment_id}';`),
      "t",
      "dispute recovery never reverses cancellation, refund completion, or calendar intent",
    );
    if (index === 0) {
      observe(snapshot, {
        type: "charge.dispute.updated",
        object: { ...dispute, status: "under_review" },
        created: disputeCreated + 2,
      });
      assertDispute(
        snapshot,
        "open",
        disputeCreated + 2,
        21,
        "strictly newer reopen evidence is not suppressed by won's terminal rank",
      );
      observe(snapshot, {
        type: "charge.dispute.closed",
        object: { ...dispute, status: "lost" },
        created: disputeCreated + 2,
      });
      assertDispute(
        snapshot,
        "lost",
        disputeCreated + 2,
        22,
        "same-second closure outranks the open state",
      );
      sql(`set role service_role; select public.cancel_contractor_booking(
        '${snapshot.payment.appointment_id}','${tenant}','test','${ownerId}',gen_random_uuid(),repeat('d',64));`);
      refundCreateStatus = "failed";
      assert.equal((await work(() => bundle.subject.processBookingOutbox("test", 25))).failed, 1);
      assertDispute(
        snapshot,
        "lost",
        disputeCreated + 2,
        22,
        "failed refund settlement cannot reset disputed payment",
      );
      observe(snapshot, {
        type: "refund.updated",
        object: snapshot.refunds[0],
        created: disputeCreated + 100,
      });
      assertDispute(
        snapshot,
        "lost",
        disputeCreated + 2,
        22,
        "failed refund webhook cannot reset disputed payment",
      );
      observe(snapshot, {
        type: "charge.dispute.closed",
        object: { ...dispute, status: "won" },
        created: disputeCreated + 3,
      });
      assertDispute(
        snapshot,
        "won",
        disputeCreated + 3,
        22,
        "newer won recovers only payment classification after refund failure",
      );
      assert.equal(
        sql(`select a.appointment_state='cancelled' and a.appointment_reason='contractor_cancelled'
        and a.cancellation_requested_at is not null and a.refund_state='failed' and p.refund_state='failed'
        and a.refund_generation=p.refund_generation and a.refund_generation=1 and l.desired_state='absent'
        from public.appointments a join public.booking_payments p on p.appointment_id=a.id
        join public.calendar_event_links l on l.appointment_id=a.id where a.id='${snapshot.payment.appointment_id}';`),
        "t",
      );
    }
  }
  for (const snapshot of snapshots.slice(6, 8)) {
    const pending = {
      ...snapshot,
      checkout: { ...snapshot.checkout, payment_status: "unpaid" },
      intent: { ...snapshot.intent, status: "processing", latest_charge: null },
      charge: null,
    };
    observe(pending, { created: causalTime });
    sql(`update public.appointments set reservation_expires_at=clock_timestamp()-interval '1 second'
      where id='${snapshot.payment.appointment_id}';`);
    const expiryLease = randomUUID(),
      expiryClaims = JSON.parse(
        sql(`set role booking_worker; select jsonb_agg(to_jsonb(p))
        from public.claim_due_booking_session_expiries_v3('test','${expiryLease}',1) p;`),
      );
    assert.equal(expiryClaims[0].id, snapshot.payment.id);
    const won = snapshot === snapshots[7],
      dispute = {
        id: "dp_" + snapshot.payment.id,
        object: "dispute",
        charge: snapshot.charge.id,
        status: won ? "won" : "needs_response",
      };
    observe(snapshot, {
      type: won ? "charge.dispute.closed" : "charge.dispute.created",
      object: dispute,
      created: causalTime + 10,
    });
    assertDispute(
      snapshot,
      won ? "won" : "open",
      causalTime + 10,
      won ? 22 : 21,
      "first paid Charge snapshot reduces its own current dispute before late-payment arbitration",
    );
    for (const expired of [
      snapshot,
      { ...pending, intent: { ...pending.intent, status: "requires_payment_method" } },
      { ...pending, checkout: { ...pending.checkout, payment_intent: null }, intent: null },
    ]) {
      assert.throws(
        () =>
          sql(`set role booking_worker; select public.reduce_booking_financial_evidence_v3(
        'session_expiry','${snapshot.payment.id}','${expiryLease}',${expiryClaims[0].checkout_fencing_token},${literal(
          {
            stripeAccountId: snapshot.payment.stripe_account_id,
            checkout: expired.checkout,
            paymentIntent: expired.intent,
            charge: expired.charge,
            refunds: [],
            refundsHasMore: false,
          },
        )});`),
        /expiry no longer owns unpaid booking/,
      );
    }
    if (won) {
      const lease = randomUUID(),
        claims = JSON.parse(
          sql(`set role booking_worker; select jsonb_agg(to_jsonb(c))
          from public.claim_booking_late_payment_arbitrations('test','${lease}',25) c;`),
        );
      assert.ok(claims.some((claim) => claim.appointment.id === snapshot.payment.appointment_id));
      for (const claim of claims) {
        assert.equal(
          sql(`set role booking_worker; select public.record_booking_late_payment_observation(
          '${claim.arbitration.id}','${lease}',${claim.arbitration.fencing_token},${claim.arbitration.snapshot_generation},
          clock_timestamp(),'complete','[]'::jsonb);`),
          "recovered",
        );
      }
    } else {
      assert.equal(
        sql(`select appointment_state='cancelled' and appointment_reason='late_payment_refund'
        and refund_state='pending' and cancellation_requested_at is null from public.appointments
        where id='${snapshot.payment.appointment_id}';`),
        "t",
      );
      assert.equal(
        sql(`select count(*) from public.booking_late_payment_arbitrations
        where appointment_id='${snapshot.payment.appointment_id}';`),
        "0",
        "a disputed first payment never strands or recovers a late-payment arbitration",
      );
      observe(snapshot, {
        type: "charge.dispute.closed",
        object: { ...dispute, status: "won" },
        created: causalTime + 11,
      });
      assertDispute(
        snapshot,
        "won",
        causalTime + 11,
        22,
        "won recovery retains the cancelled refund obligation",
      );
      assert.equal(
        sql(`select appointment_state='cancelled' and refund_state='pending'
        from public.appointments where id='${snapshot.payment.appointment_id}';`),
        "t",
      );
    }
  }
  console.log(
    "PASS: real Stripe ingestion/claims preserve causal open/lost/closed/won truth across financial replays, failure, expiry and refund",
  );
} finally {
  if (bundle) await bundle.cleanup();
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  delete globalThis.__financialRecovery;
  if (started) run("pg_ctl", ["-D", data, "stop", "-m", "immediate"]);
  await rm(directory, { recursive: true, force: true });
}
