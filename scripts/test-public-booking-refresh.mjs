import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const now = Date.parse("2026-09-10T08:00:00.000Z");
const freshAt = new Date(now - 60_000).toISOString();
const staleAt = new Date(now - 16 * 60_000).toISOString();
const input = {
  websiteId: "10000000-0000-4000-8000-000000000001",
  profileId: "20000000-0000-4000-8000-000000000002",
  environment: "test",
  isPublished: true,
  isActiveVersion: true,
};
const env = {
  ...originalEnv,
  BOOKING_LIVE_ENABLED: "true",
  BOOKING_WORKER_MODE: "active",
  BOOKING_WORKER_ENVIRONMENT: "test",
};
const state = { expected: [], unexpected: [], calls: [], pending: 0, now };
let bundle,
  passed = 0,
  networkCalls = 0;

function expect(kind, args, value) {
  state.expected.push({ kind, args, value });
}

function take(kind, args) {
  const step = state.expected.shift();
  state.calls.push({ kind, args });
  try {
    assert.ok(step, `Unexpected ${kind}: ${JSON.stringify(args)}`);
    assert.deepEqual({ kind, args }, { kind: step.kind, args: step.args });
  } catch (error) {
    // The public helper catches failures, including assertions thrown inside mocks.
    state.unexpected.push(error.message);
    throw error;
  }
  if (step.value instanceof Error) throw step.value;
  return typeof step.value === "function" ? step.value() : structuredClone(step.value);
}

state.take = take;
state.db = {
  from(table) {
    const calls = [["from", table]];
    state.pending++;
    let awaited = false;
    const query = {
      then(resolve, reject) {
        state.pending--;
        if (awaited) state.unexpected.push("Query awaited more than once");
        awaited = true;
        return Promise.resolve()
          .then(() => take("query", calls))
          .then(resolve, reject);
      },
    };
    for (const method of ["select", "eq", "maybeSingle", "single"])
      query[method] = (...args) => {
        calls.push([method, ...args]);
        return query;
      };
    query.abortSignal = (signal) => {
      if (!(signal instanceof AbortSignal) || signal.aborted)
        state.unexpected.push("Query requires a live AbortSignal");
      calls.push(["abortSignal"]);
      return query;
    };
    return query;
  },
  rpc(name, args) {
    const calls = [name, args];
    state.pending++;
    let awaited = false;
    const query = {
      abortSignal(signal) {
        if (!(signal instanceof AbortSignal) || signal.aborted)
          state.unexpected.push("RPC requires a live AbortSignal");
        calls.push("abortSignal");
        return query;
      },
      then(resolve, reject) {
        state.pending--;
        if (awaited) state.unexpected.push("RPC awaited more than once");
        awaited = true;
        return Promise.resolve()
          .then(() => take("rpc", calls))
          .then(resolve, reject);
      },
    };
    return query;
  },
};

function fixture({ googleStale = false, stripeStale = false } = {}) {
  return {
    website_entitlements: {
      plan: "pro",
      state: "active",
      quote_admission: false,
      booking_admission: true,
      order_confirmed_at: freshAt,
      effective_at: freshAt,
      ends_at: null,
    },
    booking_services: { id: "service-saved", active: true },
    calendar_connections: {
      id: "connection-saved",
      connection_revision: 7,
      pipedream_account_id: "apn_saved",
      health_state: "healthy",
      last_verified_at: googleStale ? staleAt : freshAt,
      verification_reason: null,
      reconnect_reason: null,
      account_email: "owner@example.test",
    },
    calendar_selections: [
      {
        connection_id: "connection-saved",
        active: true,
        blocks_availability: true,
        receives_bookings: true,
        access_role: "owner",
        permission_verified_at: googleStale ? staleAt : freshAt,
      },
    ],
    stripe_connected_accounts: {
      stripe_account_id: "acct_saved",
      onboarding_state: "ready",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: "active" },
      requirements: { currently_due: [], past_due: [], pending_verification: [] },
      last_verified_at: stripeStale ? staleAt : freshAt,
    },
    pipedream_bindings: {
      connection_id: "connection-saved",
      pipedream_account_id: "apn_saved",
      trigger_state: "active",
      last_health_at: googleStale ? staleAt : freshAt,
      reconciliation_due_at: null,
    },
    availability_schedules: { id: "schedule-saved", active: true },
    intervalCount: 1,
  };
}

function expectFacts(rows, scope = input, errorTable, pending = { data: null, error: null }) {
  const tenant = [
    ["eq", "profile_id", scope.profileId],
    ["eq", "environment", scope.environment],
  ];
  for (const [table, columns, filters, terminal, observation] of [
    [
      "website_entitlements",
      "plan,state,quote_admission,booking_admission,order_confirmed_at,effective_at,ends_at",
      [["eq", "website_id", scope.websiteId], ...tenant],
      true,
      false,
    ],
    ["booking_services", "id,active", tenant, true, false],
    [
      "calendar_connections",
      "id,connection_revision,pipedream_account_id,health_state,last_verified_at,verification_reason,reconnect_reason,account_email,setup_operation_id,setup_actor_auth_user_id,setup_account_id,setup_expected_revision,setup_calendar_id,setup_calendars,setup_purpose,setup_completed_at,setup_failure_reason,setup_probe_account_id,setup_probe_calendar_id,setup_retry_at",
      tenant,
      true,
      true,
    ],
    [
      "calendar_selections",
      "connection_id,blocks_availability,receives_bookings,active,access_role,permission_verified_at",
      [...tenant, ["eq", "active", true]],
      false,
      true,
    ],
    [
      "stripe_connected_accounts",
      "stripe_account_id,onboarding_state,charges_enabled,payouts_enabled,details_submitted,capabilities,requirements,last_verified_at",
      tenant,
      true,
      false,
    ],
    [
      "pipedream_bindings",
      "connection_id,pipedream_account_id,trigger_state,last_health_at,reconciliation_due_at",
      tenant,
      true,
      true,
    ],
  ]) {
    expect(
      "query",
      [
        ["from", table],
        ["select", columns],
        ...filters,
        ...(observation ? [["abortSignal"]] : []),
        ...(terminal ? [["maybeSingle"]] : []),
      ],
      {
        data: errorTable === table ? null : rows[table],
        error: errorTable === table ? { code: "57014" } : null,
      },
    );
  }
  if (
    errorTable &&
    !["calendar_connections", "calendar_selections", "pipedream_bindings"].includes(errorTable)
  )
    return;
  if (rows.booking_services) {
    expect(
      "query",
      [
        ["from", "availability_schedules"],
        ["select", "id,active"],
        ...tenant,
        ["eq", "service_id", rows.booking_services.id],
        ["maybeSingle"],
      ],
      { data: rows.availability_schedules, error: null },
    );
    if (rows.availability_schedules)
      expect(
        "query",
        [
          ["from", "availability_intervals"],
          ["select", "id", { count: "exact", head: true }],
          ["eq", "schedule_id", rows.availability_schedules.id],
          ...tenant,
        ],
        { data: null, count: rows.intervalCount, error: null },
      );
  }
  if (errorTable === "calendar_connections") return;
  expect(
    "rpc",
    [
      "get_pending_google_calendar_setup",
      {
        p_profile_id: scope.profileId,
        p_environment: scope.environment,
        p_expected_revision: rows.calendar_connections?.connection_revision ?? 0,
      },
      "abortSignal",
    ],
    pending,
  );
}

const isFactRead = ({ kind, args }) =>
  kind === "query" || (kind === "rpc" && args[0] === "get_pending_google_calendar_setup");

function cutoverArgs(scope) {
  return [
    "booking_cutover_enabled",
    { p_profile_id: scope.profileId, p_environment: scope.environment },
  ];
}

function rateArgs(scope) {
  return [
    "check_public_booking_rate_limit",
    {
      p_scope_key: `provider-refresh:${scope.websiteId}`,
      p_action: "slots",
      p_client_bucket: createHash("sha256")
        .update(`${scope.profileId}:${scope.environment}`)
        .digest("hex"),
      p_limit: 2,
      p_window_seconds: 60,
    },
  ];
}

function expectRefresh(scope, google, stripe) {
  expect("billing", [], scope.environment);
  expect("rpc", cutoverArgs(scope), { data: true, error: null });
  expect("rpc", rateArgs(scope), { data: true, error: null });
  for (const [kind, value] of [
    ["google", google],
    ["stripe", stripe],
  ]) {
    if (value === undefined) continue;
    expect(
      kind,
      {
        input: {
          profileId: scope.profileId,
          environment: scope.environment,
          ...(kind === "google" ? { allowRepair: false } : {}),
          deadlineAt: state.now + 9_000,
        },
        inDeadline: true,
        canContinue: true,
      },
      value,
    );
  }
}

async function run(name, body) {
  process.env = { ...env };
  Object.assign(state, { expected: [], unexpected: [], calls: [], pending: 0, now });
  await body();
  assert.deepEqual(state.unexpected, [], "caught mock violations must still fail the test");
  assert.equal(state.expected.length, 0, "every planned operation must run");
  assert.equal(state.pending, 0, "all DB reads must be awaited exactly once");
  assert.equal(networkCalls, 0, "no real DB/provider network traffic");
  passed++;
  console.log(`PASS: ${name}`);
}

try {
  globalThis.__publicBookingRefreshTest = state;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Unexpected network request");
  };
  Date.now = () => state.now;
  bundle = await importWithMocks(path.resolve("src/lib/booking-availability.server.ts"), {
    "@/integrations/supabase/client.server":
      "export const supabaseAdmin = globalThis.__publicBookingRefreshTest.db;",
    "@/lib/stripe.server":
      "export const billingEnvironment = () => globalThis.__publicBookingRefreshTest.take('billing', []);",
    "@/lib/pipedream.server":
      "export const getGoogleCalendarBusyRanges = async (input) => globalThis.__publicBookingRefreshTest.take('freebusy', input);",
    "@/lib/pipedream-trigger-reconciliation.server": `
      import { hasWorkerDeadline, workerCanContinue, workerProviderFetch } from '@/lib/worker-deadline.server';
      export const refreshSavedGoogleCalendar = async (input) => {
        const result = globalThis.__publicBookingRefreshTest.take('google', {
          input, inDeadline: hasWorkerDeadline(), canContinue: workerCanContinue(),
        });
        if (result?.workBudgetExpired) await workerProviderFetch('https://never-dispatched.example.test');
        return result;
      };
    `,
    "@/lib/stripe-connect-inbox-worker.server": `
      import { hasWorkerDeadline, workerCanContinue } from '@/lib/worker-deadline.server';
      export const refreshSavedStripeConnectAccount = async (input) => globalThis.__publicBookingRefreshTest.take('stripe', {
        input, inDeadline: hasWorkerDeadline(), canContinue: workerCanContinue(),
      });
    `,
  });
  const load = (scope = input) => bundle.subject.loadPublicBookingReadiness(scope);

  await run("fresh snapshots still obey paused admission before provider work", async () => {
    process.env.BOOKING_WORKER_MODE = "drain";
    expectFacts(fixture());
    const facts = await load();
    assert.equal(facts.bookingAdmission, false);
    assert.notEqual(facts.publicMode, "live_booking");
    assert.ok(state.calls.every(isFactRead));
  });

  await run(
    "structural, draft, preview, non-Pro and reconnect gates never call providers",
    async () => {
      for (const stale of [false, true])
        for (const [label, change] of [
          [
            "draft",
            (_rows, scope) => {
              scope.isPublished = false;
            },
          ],
          [
            "preview version",
            (_rows, scope) => {
              scope.isActiveVersion = false;
            },
          ],
          [
            "no entitlement",
            (rows) => {
              rows.website_entitlements = null;
            },
          ],
          [
            "Starter",
            (rows) => {
              rows.website_entitlements.plan = "starter";
            },
          ],
          [
            "suspended",
            (rows) => {
              rows.website_entitlements.state = "suspended";
            },
          ],
          [
            "missing authoritative entitlement state",
            (rows) => {
              delete rows.website_entitlements.state;
            },
          ],
          [
            "booking disabled",
            (rows) => {
              rows.website_entitlements.booking_admission = false;
            },
          ],
          [
            "unconfirmed order",
            (rows) => {
              rows.website_entitlements.order_confirmed_at = null;
            },
          ],
          [
            "not effective",
            (rows) => {
              rows.website_entitlements.effective_at = new Date(now + 1).toISOString();
            },
          ],
          [
            "missing effective time",
            (rows) => {
              rows.website_entitlements.effective_at = null;
            },
          ],
          [
            "invalid effective time",
            (rows) => {
              rows.website_entitlements.effective_at = "invalid";
            },
          ],
          [
            "expired",
            (rows) => {
              rows.website_entitlements.ends_at = new Date(now).toISOString();
            },
          ],
          [
            "invalid expiry time",
            (rows) => {
              rows.website_entitlements.ends_at = "invalid";
            },
          ],
          [
            "missing service",
            (rows) => {
              rows.booking_services = null;
            },
          ],
          [
            "inactive service",
            (rows) => {
              rows.booking_services.active = false;
            },
          ],
          [
            "missing schedule",
            (rows) => {
              rows.availability_schedules = null;
            },
          ],
          [
            "inactive schedule",
            (rows) => {
              rows.availability_schedules.active = false;
            },
          ],
          [
            "no intervals",
            (rows) => {
              rows.intervalCount = 0;
            },
          ],
          [
            "no Google account",
            (rows) => {
              rows.calendar_connections.pipedream_account_id = null;
            },
          ],
          [
            "deleted selections",
            (rows) => {
              rows.calendar_selections = [];
            },
          ],
          [
            "other connection",
            (rows) => {
              rows.calendar_selections[0].connection_id = "other-connection";
            },
          ],
          [
            "no writable destination",
            (rows) => {
              rows.calendar_selections[0].access_role = "reader";
            },
          ],
          [
            "no Stripe account",
            (rows) => {
              rows.stripe_connected_accounts.stripe_account_id = null;
            },
          ],
        ]) {
          const rows = fixture({ googleStale: stale, stripeStale: stale });
          const scope = { ...input };
          change(rows, scope);
          expectFacts(rows, scope);
          const facts = await load(scope);
          assert.equal(facts.providerRefreshEligible, false, label);
          assert.equal(facts.bookingAdmission, false, label);
        }
      for (const reason of [
        "contractor_disconnected",
        "provider_reauthorization_required",
        "calendar_permissions_changed",
        "calendar_write_blocked",
        "provider_configuration_error",
        "calendar_selection_invalid",
      ]) {
        const rows = fixture({ googleStale: true });
        rows.calendar_connections.verification_reason = reason;
        expectFacts(rows);
        assert.equal((await load()).bookingAdmission, false, reason);
      }
      const reconnect = fixture({ googleStale: true });
      reconnect.calendar_connections.reconnect_reason = "provider_reauthorization_required";
      expectFacts(reconnect);
      assert.equal((await load()).bookingAdmission, false);
      assert.ok(state.calls.every(isFactRead));
    },
  );

  await run(
    "flags, worker mode, worker environment and billing mode deny before refresh",
    async () => {
      for (const stale of [false, true])
        for (const overrides of [
          { BOOKING_LIVE_ENABLED: "false" },
          { BOOKING_LIVE_ENABLED: "" },
          { BOOKING_WORKER_MODE: "drain" },
          { BOOKING_WORKER_MODE: "off" },
          { BOOKING_WORKER_MODE: "" },
          { BOOKING_WORKER_MODE: "disabled" },
          { BOOKING_WORKER_ENVIRONMENT: "live" },
          { BOOKING_WORKER_ENVIRONMENT: "" },
        ]) {
          process.env = { ...env, ...overrides };
          expectFacts(fixture({ googleStale: stale, stripeStale: stale }));
          const facts = await load();
          assert.equal(facts.bookingAdmission, false);
          assert.notEqual(facts.publicMode, "live_booking");
        }
      process.env = { ...env };
      for (const stale of [false, true])
        for (const billing of ["live", new Error("Fixture billing configuration unavailable")]) {
          expectFacts(fixture({ googleStale: stale, stripeStale: stale }));
          expect("billing", [], billing);
          assert.equal((await load()).bookingAdmission, false);
        }
      assert.ok(state.calls.every((call) => isFactRead(call) || call.kind === "billing"));
    },
  );

  await run(
    "cutover and tenant refresh rate denial perform no provider work or reread",
    async () => {
      for (const gate of ["cutover", "rate"]) {
        for (const denied of [
          { data: false, error: null },
          { data: null, error: null },
          { data: null, error: { code: "P0001" } },
          new Error("Fixture gate unavailable"),
        ]) {
          expectFacts(fixture({ googleStale: true, stripeStale: true }));
          expect("billing", [], "test");
          expect(
            "rpc",
            cutoverArgs(input),
            gate === "cutover" ? denied : { data: true, error: null },
          );
          if (gate === "rate") expect("rpc", rateArgs(input), denied);
          assert.equal((await load()).bookingAdmission, false);
        }
      }
      assert.ok(state.calls.every(({ kind }) => !["google", "stripe", "freebusy"].includes(kind)));
    },
  );

  await run("fresh evidence cannot bypass cutover denial or an unknown cutover", async () => {
    for (const [denied, unknown] of [
      [{ data: false, error: null }, false],
      [{ data: null, error: null }, true],
      [{ data: "true", error: null }, true],
      [{ data: {}, error: null }, true],
      [{ data: null, error: { code: "57014" } }, true],
      [{ data: true, error: { code: "57014" } }, true],
      [new Error("Fixture cutover unavailable"), true],
    ]) {
      expectFacts(fixture());
      expect("billing", [], "test");
      expect("rpc", cutoverArgs(input), denied);
      const facts = await load();
      assert.equal(facts.bookingAdmission, false);
      assert.notEqual(facts.publicMode, "live_booking");
      assert.equal(facts.reasonCodes.includes("booking_readiness_unknown"), unknown);
      assert.equal(facts.reasonCodes.includes("booking_cutover_unavailable"), !unknown);
      assert.equal(facts.calendarConnection.configured, true);
      if (unknown) assert.equal(facts.calendarConnection.reason, "verification_unknown");
    }
    assert.ok(state.calls.every(({ kind }) => !["google", "stripe", "freebusy"].includes(kind)));
  });

  await run(
    "healthy persisted facts enforce admission authority without refreshing providers",
    async () => {
      expectFacts(fixture());
      expect("billing", [], "test");
      expect("rpc", cutoverArgs(input), { data: true, error: null });
      const facts = await load();
      assert.equal(facts.providerRefreshEligible, true);
      assert.equal(facts.bookingAdmission, true);
      assert.equal(facts.publicMode, "live_booking");
      assert.deepEqual(facts.reasonCodes, []);
      assert.equal(state.calls.length, 11);
    },
  );

  await run(
    "each stale Google evidence type refreshes only the saved tenant without repair",
    async () => {
      for (const environment of ["test", "live"]) {
        const scope = { ...input, environment };
        process.env = { ...env, BOOKING_WORKER_ENVIRONMENT: environment };
        for (const change of [
          (rows) => {
            rows.calendar_connections.last_verified_at = staleAt;
          },
          (rows) => {
            rows.calendar_selections[0].permission_verified_at = staleAt;
          },
          (rows) => {
            rows.pipedream_bindings.last_health_at = staleAt;
          },
          ...["verification_stale", "provider_temporary_failure", "provider_platform_error"].map(
            (reason) => (rows) => {
              rows.calendar_connections.last_verified_at = staleAt;
              rows.calendar_connections.health_state = "degraded";
              rows.calendar_connections.verification_reason = reason;
            },
          ),
        ]) {
          const rows = fixture();
          change(rows);
          expectFacts(rows, scope);
          expectRefresh(scope, { checked: true });
          expectFacts(fixture(), scope);
          const facts = await load(scope);
          assert.equal(facts.bookingAdmission, true);
          assert.deepEqual(facts.reasonCodes, []);
        }
      }
      assert.equal(state.calls.filter(({ kind }) => kind === "google").length, 12);
      assert.equal(state.calls.filter(({ kind }) => kind === "stripe").length, 0);
    },
  );

  await run(
    "stale Stripe evidence refreshes only the saved account with the same bounded scope",
    async () => {
      for (const environment of ["test", "live"]) {
        const scope = { ...input, environment };
        process.env = { ...env, BOOKING_WORKER_ENVIRONMENT: environment };
        for (const timestamp of [staleAt, null, new Date(now + 61_000).toISOString()]) {
          const rows = fixture();
          rows.stripe_connected_accounts.last_verified_at = timestamp;
          expectFacts(rows, scope);
          expectRefresh(scope, undefined, { checked: true });
          expectFacts(fixture(), scope);
          assert.equal((await load(scope)).bookingAdmission, true);
        }
      }
      assert.equal(state.calls.filter(({ kind }) => kind === "stripe").length, 6);
      assert.equal(state.calls.filter(({ kind }) => kind === "google").length, 0);
    },
  );

  await run("initial fact reads consume the same public refresh deadline", async () => {
    expectFacts(fixture({ googleStale: true }));
    const initialRead = state.expected[0];
    const initialResult = initialRead.value;
    initialRead.value = () => {
      state.now += 4_000;
      return initialResult;
    };
    expectRefresh(input, { checked: true });
    expectFacts(fixture());
    const facts = await load();
    assert.equal(facts.bookingAdmission, true);
    assert.equal(
      state.calls.find(({ kind }) => kind === "google").args.input.deadlineAt,
      now + 9_000,
      "initial DB latency cannot give provider verification a new ten-second budget",
    );
  });

  await run(
    "failed, unchecked and deadline-exhausted verification cannot manufacture readiness",
    async () => {
      const failure = new Error("Fixture provider unavailable");
      for (const [google, stripe] of [
        [failure, failure],
        [{ checked: false }, { checked: false }],
        [failure, { checked: false }],
      ]) {
        expectFacts(fixture({ googleStale: true, stripeStale: true }));
        expectRefresh(input, google, stripe);
        expectFacts(fixture({ googleStale: true, stripeStale: true }));
        const facts = await load();
        assert.equal(facts.bookingAdmission, false);
        assert.ok(facts.reasonCodes.includes("google_verification_stale"));
        assert.ok(facts.reasonCodes.includes("stripe_verification_stale"));
      }
      expectFacts(fixture({ googleStale: true }));
      expectRefresh(input, () => {
        state.now += 10_001;
        return { checked: true };
      });
      assert.equal(
        (await load()).bookingAdmission,
        false,
        "late completion cannot start another read or admit",
      );
    },
  );

  await run("initial checked reads fail closed without erasing the public page", async () => {
    for (const table of [
      "website_entitlements",
      "booking_services",
      "calendar_connections",
      "calendar_selections",
      "stripe_connected_accounts",
      "pipedream_bindings",
    ]) {
      expectFacts(fixture(), input, table);
      const facts = await load();
      assert.equal(facts.websiteId, input.websiteId);
      assert.equal(facts.profileId, input.profileId);
      assert.equal(facts.environment, input.environment);
      assert.equal(facts.bookingAdmission, false);
      assert.equal(facts.providerRefreshEligible, false);
      assert.equal(facts.showDemo, false);
      assert.equal(facts.showLeadForm, false);
      assert.equal(facts.publicMode, "unavailable");
      assert.equal(facts.calendarConnection.healthState, null);
      assert.equal(facts.calendarConnection.reason, "verification_unknown");
      if (["calendar_connections", "calendar_selections", "pipedream_bindings"].includes(table)) {
        assert.equal(facts.plan, "pro");
        assert.equal(facts.orderConfirmed, true);
        assert.equal(facts.availability, "configured");
        assert.equal(facts.paymentDashboardAvailable, true);
        assert.equal(facts.calendarConnection.configured, table === "pipedream_bindings");
        assert.ok(facts.reasonCodes.includes("booking_readiness_unknown"));
      } else {
        assert.equal(facts.plan, null);
        assert.equal(facts.paymentDashboardAvailable, false);
        assert.deepEqual(facts.reasonCodes, ["booking_readiness_unknown"]);
      }
    }
    assert.ok(state.calls.every(isFactRead), "an unknown first read cannot dispatch providers");
  });

  await run(
    "entitlement authority and owner pending-setup reads stay strict; optional page facts do not",
    async () => {
      const reader = await importWithMocks(path.resolve("src/lib/booking-readiness.server.ts"), {
        "@/integrations/supabase/client.server":
          "export const supabaseAdmin = globalThis.__publicBookingRefreshTest.db;",
      });
      try {
        expectFacts(fixture(), input, "website_entitlements");
        await assert.rejects(
          () => reader.subject.loadBookingReadinessFacts(input),
          /Unable to load booking readiness facts/,
        );
        expect(
          "rpc",
          [
            "get_pending_google_calendar_setup",
            {
              p_profile_id: input.profileId,
              p_environment: input.environment,
              p_expected_revision: 7,
            },
            "abortSignal",
          ],
          { data: null, error: { code: "42501" } },
        );
        await assert.rejects(
          () =>
            reader.subject.loadPendingGoogleCalendarSetup({
              profileId: input.profileId,
              environment: input.environment,
              connection: fixture().calendar_connections,
            }),
          /Unable to load pending Google Calendar setup/,
        );
        expectFacts(fixture(), input, undefined, { data: null, error: { code: "42501" } });
        const partial = await reader.subject.loadBookingReadinessFacts(input);
        assert.equal(partial.plan, "pro");
        assert.equal(partial.bookingAdmission, false);
        assert.equal(partial.providerRefreshEligible, false);
        assert.equal(partial.calendarConnection.reason, "verification_unknown");
      } finally {
        await reader.cleanup();
      }
    },
  );

  await run(
    "actual SDK initial reads bound stalls and never sleep on one-hour Retry-After",
    async () => {
      process.env.SUPABASE_URL = "https://booking-readiness.example.test";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_fixture";
      // One bundle keeps the real reader, client and nested deadlines on the same ALS instance.
      const { outputFiles } = await build({
        stdin: {
          contents: `
          export { loadPublicBookingReadiness } from "@/lib/booking-availability.server";
          export { loadBookingReadinessFacts } from "@/lib/booking-readiness.server";
          export * as worker from "@/lib/worker-deadline.server";
        `,
          resolveDir: process.cwd(),
        },
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        target: "node22",
        alias: { "@": path.resolve("src") },
        plugins: [
          {
            name: "forbid-provider-work",
            setup(api) {
              api.onResolve(
                {
                  filter:
                    /^@\/lib\/(pipedream|stripe|pipedream-trigger-reconciliation|stripe-connect-inbox-worker)\.server$/,
                },
                ({ path }) => ({
                  path,
                  namespace: "read-only-fixture",
                }),
              );
              api.onLoad({ filter: /.*/, namespace: "read-only-fixture" }, () => ({
                contents: `const forbidden=()=>{
              globalThis.__publicBookingRefreshTest.unexpected.push('Provider work during initial read failure');
              throw Error('Provider work forbidden');
            };
            export const getGoogleCalendarBusyRanges=forbidden,billingEnvironment=forbidden,
              refreshSavedGoogleCalendar=forbidden,refreshSavedStripeConnectAccount=forbidden;`,
                loader: "js",
              }));
            },
          },
        ],
      });
      const sdk = await import(
        `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
      );
      const forbiddenFetch = globalThis.fetch;
      const originalSetTimeout = globalThis.setTimeout;
      let retrySleeps = 0;
      globalThis.setTimeout = (callback, ms, ...args) => {
        if (ms >= 3_600_000) {
          retrySleeps++;
          // Fail a regression promptly instead of keeping the test alive for an hour.
          return originalSetTimeout(callback, 0, ...args);
        }
        return originalSetTimeout(callback, ms, ...args);
      };
      try {
        for (const reader of ["facts", "public"])
          for (const mode of ["retry", "headers", "body"]) {
            const requests = [];
            let aborted = 0;
            globalThis.fetch = async (url, init) => {
              const parsed = new URL(String(url));
              try {
                assert.equal(parsed.origin, "https://booking-readiness.example.test");
                assert.equal(
                  init.method,
                  "GET",
                  "initial read failure must not start provider/RPC work",
                );
                const table = parsed.pathname.split("/").at(-1);
                const optional = [
                  "calendar_connections",
                  "calendar_selections",
                  "pipedream_bindings",
                ].includes(table);
                const context = sdk.worker.workerProviderContext();
                if (mode === "retry") {
                  assert.equal(context, undefined, "page facts must not enter the worker ALS");
                  if (optional) assert.ok(init.signal instanceof AbortSignal && !init.signal.aborted);
                } else {
                  assert.equal(init.redirect, "manual");
                  assert.ok(init.signal instanceof AbortSignal && !init.signal.aborted);
                  assert.ok(context);
                  assert.equal(context.settlementDeadlineAt, now + 50);
                }
                requests.push({ table, signal: init.signal });
                if (!parsed.pathname.endsWith("/website_entitlements")) return Response.json([]);
                if (mode === "retry")
                  return Response.json(
                    { message: "Fixture database unavailable" },
                    { status: 503, headers: { "retry-after": "3600" } },
                  );
                if (mode === "headers")
                  return new Promise((_, reject) =>
                    init.signal.addEventListener(
                      "abort",
                      () => {
                        aborted++;
                        reject(init.signal.reason);
                      },
                      { once: true },
                    ),
                  );
                return new Response(
                  new ReadableStream({
                    start(controller) {
                      init.signal.addEventListener(
                        "abort",
                        () => {
                          aborted++;
                          controller.error(init.signal.reason);
                        },
                        { once: true },
                      );
                    },
                  }),
                );
              } catch (error) {
                state.unexpected.push(error.message);
                throw error;
              }
            };
            let projection;
            const work = async () => {
              if (reader === "facts")
                await assert.rejects(() => sdk.loadBookingReadinessFacts(input));
              else projection = await sdk.loadPublicBookingReadiness(input);
            };
            const started = performance.now();
            if (mode === "retry") await work();
            else
              // Caller-supplied worker deadlines still bound stalls; page facts no longer create one.
              await assert.rejects(
                sdk.worker.withWorkerDeadline(now + 50, work, { workDeadlineAt: now + 50 }),
                sdk.worker.WorkerDeadlineError,
              );
            const elapsed = performance.now() - started;
            assert.ok(elapsed < 2_000, `${reader}/${mode} completed in ${elapsed}ms`);
            assert.equal(retrySleeps, 0, "PostgREST must not schedule Retry-After backoff");
            assert.deepEqual(requests.map(({ table }) => table).sort(), [
              "booking_services",
              "calendar_connections",
              "calendar_selections",
              "pipedream_bindings",
              "stripe_connected_accounts",
              "website_entitlements",
            ]);
            if (mode === "retry") {
              assert.ok(
                requests
                  .filter(({ table }) =>
                    ["calendar_connections", "calendar_selections", "pipedream_bindings"].includes(
                      table,
                    ),
                  )
                  .every(({ signal }) => signal instanceof AbortSignal),
              );
            } else {
              assert.ok(
                requests.every(({ signal }) => signal.aborted),
                "all transport scopes cleaned up",
              );
            }
            assert.equal(aborted, mode === "retry" ? 0 : 1);
            if (reader === "public") {
              assert.equal(projection.websiteId, input.websiteId);
              assert.equal(projection.profileId, input.profileId);
              assert.equal(projection.environment, input.environment);
              assert.equal(projection.plan, null);
              assert.equal(projection.bookingAdmission, false);
              assert.equal(projection.providerRefreshEligible, false);
              assert.equal(projection.showDemo, false);
              assert.equal(projection.showLeadForm, false);
              assert.equal(projection.paymentDashboardAvailable, false);
              assert.equal(projection.publicMode, "unavailable");
              assert.deepEqual(projection.reasonCodes, ["booking_readiness_unknown"]);
            }
            console.log(
              `PASS: SDK ${reader}/${mode} ${Math.round(elapsed)}ms; no retries or network`,
            );
          }
        for (const [fault, mode] of [
          ["calendar_connections", "retry"],
          ["calendar_selections", "retry"],
          ["pipedream_bindings", "retry"],
          ["get_pending_google_calendar_setup", "error"],
          ["get_pending_google_calendar_setup", "malformed"],
        ]) {
          const rows = fixture();
          rows.website_entitlements.quote_admission = true;
          const requests = [];
          let aborted = 0;
          globalThis.fetch = async (url, init) => {
            const parsed = new URL(String(url));
            const name = parsed.pathname.split("/").at(-1);
            try {
              assert.equal(parsed.origin, "https://booking-readiness.example.test");
              const optional = [
                "calendar_connections",
                "calendar_selections",
                "pipedream_bindings",
                "get_pending_google_calendar_setup",
              ].includes(name);
              if (optional) {
                assert.ok(init.signal instanceof AbortSignal);
              }
              requests.push({ name, signal: init.signal });
              if (name === fault) {
                if (mode === "retry")
                  return Response.json(
                    { message: "Fixture optional outage" },
                    { status: 503, headers: { "retry-after": "3600" } },
                  );
                if (mode === "error")
                  return Response.json(
                    { code: "57014", message: "Fixture pending observation unavailable" },
                    { status: 500 },
                  );
                if (mode === "malformed") return Response.json(true);
                if (mode === "headers")
                  return new Promise((_, reject) => {
                    let done = false;
                    const fail = () => {
                      if (done) return;
                      done = true;
                      aborted++;
                      reject(init.signal?.reason ?? new Error("Fixture observation aborted"));
                    };
                    if (init.signal?.aborted) {
                      fail();
                      return;
                    }
                    init.signal?.addEventListener("abort", fail, { once: true });
                    originalSetTimeout(fail, 50);
                  });
                return new Response(
                  new ReadableStream({
                    start(controller) {
                      let done = false;
                      const fail = () => {
                        if (done) return;
                        done = true;
                        aborted++;
                        controller.error(
                          init.signal?.reason ?? new Error("Fixture observation aborted"),
                        );
                      };
                      if (init.signal?.aborted) {
                        fail();
                        return;
                      }
                      init.signal?.addEventListener("abort", fail, { once: true });
                      originalSetTimeout(fail, 50);
                    },
                  }),
                );
              }
              if (name === "get_pending_google_calendar_setup") {
                assert.equal(init.method, "POST");
                assert.deepEqual(JSON.parse(init.body), {
                  p_profile_id: input.profileId,
                  p_environment: "test",
                  p_expected_revision: 7,
                });
                return Response.json(null);
              }
              if (name === "availability_intervals") {
                assert.equal(init.method, "HEAD");
                return new Response(null, { headers: { "content-range": "0-0/1" } });
              }
              assert.equal(init.method, "GET");
              assert.ok(Object.hasOwn(rows, name), name);
              return Response.json(rows[name]);
            } catch (error) {
              state.unexpected.push(error.message);
              throw error;
            }
          };
          const projection = await sdk.loadPublicBookingReadiness(input);
          assert.equal(projection.plan, "pro");
          assert.equal(projection.orderConfirmed, true);
          assert.equal(projection.availability, "configured");
          assert.equal(projection.payments, "ready");
          assert.equal(projection.showLeadForm, true);
          assert.equal(projection.paymentDashboardAvailable, true);
          assert.equal(
            projection.calendarConnection.configured,
            !["calendar_connections", "calendar_selections"].includes(fault),
          );
          assert.equal(projection.calendarConnection.healthState, null);
          assert.equal(projection.calendarConnection.reason, "verification_unknown");
          assert.equal(projection.bookingAdmission, false);
          assert.equal(projection.providerRefreshEligible, false);
          assert.ok(projection.reasonCodes.includes("booking_readiness_unknown"));
          assert.equal(requests.filter(({ name }) => name === "website_entitlements").length, 1);
          assert.equal(requests.filter(({ name }) => name === fault).length, 1);
          assert.ok(
            requests
              .filter(({ name }) =>
                [
                  "calendar_connections",
                  "calendar_selections",
                  "pipedream_bindings",
                  "get_pending_google_calendar_setup",
                ].includes(name),
              )
              .every(({ signal }) => signal instanceof AbortSignal),
          );
          assert.equal(aborted, ["body", "headers"].includes(mode) ? 1 : 0);
          console.log(
            `PASS: SDK optional ${fault}/${mode} retains checked facts, denies provider/admission; no network`,
          );
        }
      } finally {
        globalThis.fetch = forbiddenFetch;
        globalThis.setTimeout = originalSetTimeout;
      }
    },
  );

  await run("pending-setup RPC failure or malformed output is unknown, never healthy", async () => {
    for (const pending of [
      { data: null, error: { code: "42501" } },
      { data: null, error: { code: "40001" } },
      { data: true, error: null },
      { data: {}, error: null },
      {
        data: {
          operationId: "operation",
          accountId: "apn_pending",
          connectionRevision: 8,
          configurationKey: "a".repeat(64),
          blockingCalendarIds: ["busy"],
          destinationCalendarId: "destination",
          reason: null,
          nextRetryAt: null,
        },
        error: null,
      },
      new Error("Fixture pending read unavailable"),
    ]) {
      expectFacts(fixture(), input, undefined, pending);
      const facts = await load();
      assert.equal(facts.bookingAdmission, false);
      assert.equal(facts.showDemo, false);
      assert.equal(facts.plan, "pro");
      assert.equal(facts.orderConfirmed, true);
      assert.equal(facts.availability, "configured");
      assert.equal(facts.payments, "ready");
      assert.equal(facts.calendarConnection.configured, true);
      assert.equal(facts.calendarConnection.connectionRevision, 7);
      assert.equal(facts.calendarConnection.accountId, "apn_saved");
      assert.equal(facts.calendarConnection.pendingSetup, null);
      assert.equal(facts.providerRefreshEligible, false);
      assert.equal(facts.calendarConnection.healthState, null);
      assert.ok(facts.reasonCodes.includes("booking_readiness_unknown"));
      assert.equal(
        facts.reasonCodes.includes("booking_configuration_ineligible"),
        false,
        "an unknown optional observation is not known structural ineligibility",
      );
    }
    assert.ok(state.calls.every(isFactRead));
  });

  await run(
    "H5 optional unknown observations cannot override confirmed-order or temporal entitlement policy",
    async () => {
      for (const patch of [
        { order_confirmed_at: null },
        { plan: "starter", booking_admission: false },
        { state: "suspended" },
        { effective_at: new Date(now + 1).toISOString() },
        { ends_at: new Date(now).toISOString() },
        { booking_admission: false },
      ]) {
        const rows = fixture();
        Object.assign(rows.website_entitlements, patch);
        expectFacts(rows, input, undefined, { data: null, error: { code: "57014" } });
        const facts = await load();
        assert.equal(facts.plan, rows.website_entitlements.plan);
        assert.equal(facts.orderConfirmed, Boolean(rows.website_entitlements.order_confirmed_at));
        assert.equal(
          facts.entitlementUnavailable,
          Boolean(patch.state || patch.effective_at || patch.ends_at),
        );
        assert.equal(facts.availability, "configured");
        assert.equal(facts.bookingAdmission, false);
        assert.equal(facts.providerRefreshEligible, false);
        assert.equal(facts.showDemo, false);
        assert.ok(facts.reasonCodes.includes("booking_readiness_unknown"));
      }
      assert.ok(state.calls.every(isFactRead));
    },
  );

  await run(
    "H5/H6 operational settings reject optional partial facts and cutover errors before provider/settings work",
    async () => {
      for (const options of [
        { errorTable: "calendar_connections" },
        { errorTable: "calendar_selections" },
        { errorTable: "pipedream_bindings" },
        { pending: { data: null, error: { code: "57014" } } },
        { pending: { data: true, error: null } },
        { cutover: { data: null, error: { code: "57014" } } },
        { cutover: { data: false, error: null } },
        { cutover: { data: "true", error: null } },
      ]) {
        expect(
          "query",
          [
            ["from", "websites"],
            ["select", "id,user_id,environment,status,active_version_id"],
            ["eq", "id", input.websiteId],
            ["single"],
          ],
          {
            data: {
              id: input.websiteId,
              user_id: input.profileId,
              environment: input.environment,
              status: "live",
              active_version_id: "version",
            },
            error: null,
          },
        );
        expectFacts(fixture(), input, options.errorTable, options.pending);
        if (options.cutover) {
          expect("billing", [], "test");
          expect("rpc", cutoverArgs(input), options.cutover);
        }
        await assert.rejects(
          () => bundle.subject.loadLiveBookingSettings(input.websiteId),
          /Booking is unavailable/,
        );
      }
      assert.ok(state.calls.every(({ kind }) => !["google", "stripe", "freebusy"].includes(kind)));
    },
  );

  await run(
    "H5 actual Stripe onboarding handler denies partial Google readiness before provider creation",
    async () => {
      const stripe = await importWithMocks(path.resolve("src/lib/stripe-connect.functions.ts"), {
        "@tanstack/react-start": `export const createServerFn=()=>({validator:parse=>({handler:fn=>({data})=>fn({data:parse(data)})})});`,
        "@/integrations/supabase/client.server": `export const supabaseAdmin=globalThis.__publicBookingRefreshTest.db;`,
        "@/lib/provider-authorization.server": `export const providerMutationContext=(...args)=>globalThis.__publicBookingRefreshTest.take('owner',args);`,
        "@/lib/stripe-connect.server": `const f=globalThis.__publicBookingRefreshTest;
        export const assertStripeEnvironment=environment=>f.take('stripe-environment',environment);
        export const createOrReuseStripeConnectOnboarding=input=>f.take('forbidden',input);`,
      });
      try {
        for (const options of [
          { errorTable: "calendar_connections" },
          { errorTable: "calendar_selections" },
          { errorTable: "pipedream_bindings" },
          { pending: { data: null, error: { code: "57014" } } },
          { pending: { data: true, error: null } },
        ]) {
          expect("owner", [input.websiteId, "Stripe"], {
            profile: { id: input.profileId },
            website: { id: input.websiteId, environment: "test" },
          });
          expect("stripe-environment", "test", undefined);
          expectFacts(fixture(), input, options.errorTable, options.pending);
          await assert.rejects(
            () =>
              stripe.subject.startStripeConnectOnboarding({ data: { websiteId: input.websiteId } }),
            /Complete Google Calendar and availability before connecting Stripe/,
          );
        }
      } finally {
        await stripe.cleanup();
      }
    },
  );

  await run("partial persistence rereads once after attempts and remains fail closed", async () => {
    const failure = new Error("Fixture provider unavailable");
    for (const [google, stripe, persisted, admitted] of [
      [{ checked: true }, failure, fixture({ stripeStale: true }), false],
      [failure, { checked: true }, fixture({ googleStale: true }), false],
      [{ checked: true }, { checked: true }, fixture(), true],
      [
        { checked: true },
        { checked: false },
        fixture({ googleStale: true, stripeStale: true }),
        false,
      ],
    ]) {
      expectFacts(fixture({ googleStale: true, stripeStale: true }));
      expectRefresh(input, google, stripe);
      expectFacts(persisted);
      const facts = await load();
      assert.equal(facts.bookingAdmission, admitted);
      assert.equal(
        facts.reasonCodes.includes("google_verification_stale"),
        persisted.calendar_connections.last_verified_at === staleAt,
      );
      assert.equal(
        facts.reasonCodes.includes("stripe_verification_stale"),
        persisted.stripe_connected_accounts.last_verified_at === staleAt,
      );
    }
    const restricted = fixture();
    restricted.stripe_connected_accounts.charges_enabled = false;
    expectFacts(fixture({ stripeStale: true }));
    expectRefresh(input, undefined, { checked: true });
    expectFacts(restricted);
    assert.equal(
      (await load()).bookingAdmission,
      false,
      "fresh timestamps do not replace payment requirements",
    );

    expectFacts(fixture({ googleStale: true }));
    expectRefresh(input, { checked: true });
    expectFacts(fixture(), input, "stripe_connected_accounts");
    const unchanged = await load();
    assert.equal(unchanged.bookingAdmission, false);
    assert.ok(
      unchanged.reasonCodes.includes("booking_readiness_unknown"),
      "failed reread reports unknown instead of claiming old health is current",
    );
    assert.equal(unchanged.calendarConnection.reason, "verification_unknown");
    assert.equal(unchanged.calendarConnection.healthState, null);
    assert.equal(unchanged.calendarConnection.configured, true);
  });

  await run(
    "rejected verification exposes persisted revocation, not the original healthy facts",
    async () => {
      const revoked = fixture();
      revoked.calendar_connections.health_state = "disconnected";
      revoked.calendar_connections.verification_reason = "provider_reauthorization_required";
      revoked.calendar_connections.reconnect_reason = "provider_reauthorization_required";
      expectFacts(fixture({ googleStale: true }));
      expectRefresh(input, new Error("Fixture verified revocation"));
      expectFacts(revoked);
      const facts = await load();
      assert.equal(facts.bookingAdmission, false);
      assert.equal(facts.calendarConnection.reason, "provider_reauthorization_required");
      assert.equal(facts.calendarConnection.reconnectReason, "provider_reauthorization_required");
      assert.equal(facts.calendarConnection.lastVerifiedAt, freshAt);
      assert.equal(facts.calendarConnection.configured, true);
    },
  );

  await run("a healthy-looking reread cannot authorize a rejected or unowned check", async () => {
    for (const result of [new Error("Fixture lost verification"), { checked: false }]) {
      expectFacts(fixture({ googleStale: true }));
      expectRefresh(input, result);
      expectFacts(fixture());
      const facts = await load();
      assert.equal(facts.bookingAdmission, false);
      assert.notEqual(facts.publicMode, "live_booking");
      assert.equal(facts.calendarConnection.reason, "verification_unknown");
    }
  });

  await run(
    "settlement-budget reads retain negative facts after the provider work budget expires",
    async () => {
      const revoked = fixture();
      revoked.calendar_connections.health_state = "disconnected";
      revoked.calendar_connections.verification_reason = "provider_reauthorization_required";
      revoked.calendar_connections.reconnect_reason = "provider_reauthorization_required";
      expectFacts(fixture({ googleStale: true }));
      expectRefresh(input, () => {
        state.now += 7_001;
        return { workBudgetExpired: true };
      });
      expectFacts(revoked);
      const facts = await load();
      assert.equal(facts.bookingAdmission, false);
      assert.equal(facts.calendarConnection.reconnectReason, "provider_reauthorization_required");
      assert.equal(facts.calendarConnection.reason, "provider_reauthorization_required");
    },
  );

  await run("recovery preserves lead fallbacks and rechecks final entitlement truth", async () => {
    const withLeads = fixture();
    withLeads.website_entitlements.quote_admission = true;
    process.env.BOOKING_WORKER_MODE = "drain";
    expectFacts(withLeads);
    const paused = await load();
    assert.equal(paused.bookingAdmission, false);
    assert.equal(paused.publicMode, "starter_leads");
    assert.equal(paused.showLeadForm, true);
    process.env = { ...env };
    for (const change of [
      (rows) => {
        rows.website_entitlements.ends_at = new Date(now).toISOString();
      },
      (rows) => {
        rows.website_entitlements.booking_admission = false;
      },
      (rows) => {
        rows.calendar_selections = [];
      },
      (rows) => {
        rows.calendar_connections.verification_reason = "calendar_write_blocked";
      },
    ]) {
      const current = fixture();
      change(current);
      expectFacts(fixture({ googleStale: true }));
      expectRefresh(input, { checked: true });
      expectFacts(current);
      const facts = await load();
      assert.equal(facts.bookingAdmission, false);
      assert.notEqual(facts.publicMode, "live_booking");
    }
  });

  await run(
    "the existing LP loader invokes the helper with publication and active-version scope",
    async () => {
      const source = await readFile(path.resolve("src/routes/lp/$websiteId.tsx"), "utf8");
      const loader = source.slice(
        source.indexOf("const loadPublicSite"),
        source.indexOf("export const Route"),
      );
      assert.match(
        loader,
        /const\s+\{\s*loadPublicBookingReadiness\s*\}\s*=\s*await import\("@\/lib\/booking-availability\.server"\)/,
      );
      assert.match(
        loader,
        /const readiness = await loadPublicBookingReadiness\(\{\s*websiteId: website\.id,\s*profileId: website\.user_id,\s*environment: website\.environment as "test" \| "live",\s*isPublished: isLive,\s*isActiveVersion: versionId === website\.active_version_id,\s*\}\)/,
      );
      assert.doesNotMatch(loader, /loadBookingReadinessFacts/);
      assert.match(source, /loader:\s*\(\{ params, deps \}\) => loadPublicSite\(/);
    },
  );
  console.log(
    `test-public-booking-refresh: ${passed} scenarios passed (real helper/fact reader; no network)`,
  );
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  delete globalThis.__publicBookingRefreshTest;
  if (bundle) await bundle.cleanup();
}
