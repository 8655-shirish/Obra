import assert from "node:assert/strict";
import path from "node:path";
import Stripe from "stripe";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const state = {};
const bundles = [];
const profileId = "10000000-0000-4000-8000-000000000001";
const account = {
  id: "acct_routefixture",
  type: "express",
  country: "US",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { card_payments: "active" },
  requirements: { currently_due: [], past_due: [], pending_verification: [] },
};
function reset(overrides = {}) {
  Object.assign(state, {
    now: originalNow(),
    calls: [],
    provider: [],
    failSaas: false,
    rowFailure: false,
    familyAvailable: true,
    expireAfterFamilyClaim: false,
    connectClaimed: false,
    savedAccounts: null,
    connectAdvanceMs: 0,
    connectDispatches: [],
    connectClaimUnknown: false,
    connectReleaseLost: false,
    googleMaintenanceCalls: [],
    googleMaintenanceResult: null,
    googleAccounts: [],
    googleAdvanceMs: 0,
    googleDispatches: [],
    googleInboxResult: { processed: 0, failed: 0, claimed: 0, deadlineExceeded: false },
    googleInboxFailure: false,
    notifications: [],
    notificationFailure: false,
    notificationClaimUnknown: false,
    notificationSettlementUnknown: false,
    notificationContextMissing: false,
    notificationAuthorizationMissing: false,
    notificationAuthorizations: [],
    notificationAdvanceMs: 0,
    renewalFails: false,
    paymentEvents: [],
    refunds: [],
    refundCreated: new Set(),
    financialAdvanceMs: 0,
    financialFailure: false,
    financialClaimUnknown: false,
    env: {
      PIPEDREAM_INBOX_CRON_SECRET: "fixture-google",
      STRIPE_INBOX_CRON_SECRET: "fixture-stripe",
      BOOKING_CRON_SECRET: "fixture-booking",
      CRON_SECRET: undefined,
      BOOKING_WORKER_ENVIRONMENT: "test",
      BOOKING_WORKER_MODE: "drain",
      SAAS_BILLING_ENVIRONMENT: "test",
      STRIPE_SECRET_KEY: "sk_test_fixture",
      SAAS_STRIPE_INBOX_WORKER_ENABLED: "false",
      SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED: "false",
      CALENDAR_WORKER_BUDGET_MS: "45000",
      CALENDAR_WORKER_SETTLEMENT_MS: "5000",
      BOOKING_LIVE_ENABLED: "false",
      RESEND_API_KEY_TEST: "fixture-resend",
      BOOKING_EMAIL_FROM_TEST: "fixture@example.test",
    },
    ...overrides,
  });
}
function builder(execute) {
  return {
    abortSignal(signal) {
      this.signal = signal;
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve().then(execute).then(resolve, reject);
    },
  };
}
const db = {
  from(table) {
    const filters = {};
    return {
      select() {
        return this;
      },
      eq(key, value) {
        filters[key] = value;
        return this;
      },
      in() {
        return this;
      },
      lte() {
        return this;
      },
      order() {
        return this;
      },
      abortSignal(signal) {
        this.signal = signal;
        return this;
      },
      limit(limit) {
        return builder(() => {
          state.calls.push(["query", table, filters, limit]);
          if (table === "provider_event_inbox" && filters.event_family === "saas" && state.failSaas)
            return { data: null, error: { code: "57014", message: "do-not-leak-dummy-db-error" } };
          if (
            table === "provider_event_inbox" &&
            filters.event_family === "calendar" &&
            state.googleInboxFailure
          )
            return { data: [{ id: "event-fixture", payload: {} }], error: null };
          return { data: [], error: null };
        });
      },
      maybeSingle() {
        assert.equal(table, "stripe_connected_accounts");
        if (state.savedAccounts !== null)
          return builder(() => {
            const row = state.savedAccounts.find(
              (row) =>
                row.profile_id === filters.profile_id && row.environment === filters.environment,
            );
            assert.ok(row, "maintenance loads only the exact saved account");
            return { data: { stripe_account_id: row.stripe_account_id }, error: null };
          });
        assert.deepEqual(filters, { profile_id: profileId, environment: "test" });
        return builder(() => ({ data: { stripe_account_id: account.id }, error: null }));
      },
    };
  },
  rpc(name, args) {
    return builder(() => {
      state.calls.push([name, args, state.now]);
      if (name === "claim_booking_worker_family_v3") {
        if (state.expireAfterFamilyClaim) state.now += 40_000;
        return { data: state.familyAvailable ? 7 : null, error: null };
      }
      if (name === "renew_booking_worker_family_v3")
        return { data: !state.renewalFails, error: null };
      if (name === "claim_due_booking_payment_events" || name === "claim_due_booking_outbox") {
        assert.equal(args.p_limit, 1, "multi-item invocations must still claim just in time");
        if (state.financialClaimUnknown)
          return { data: null, error: { code: "57014", message: "PRIVATE financial claim" } };
        return {
          data: (name === "claim_due_booking_payment_events"
            ? state.paymentEvents
            : state.refunds
          ).splice(0, 1),
          error: null,
        };
      }
      if (name === "get_booking_outbox_context")
        return {
          data: {
            appointment: { id: args.p_command_id },
            payment: {
              id: args.p_command_id,
              stripe_account_id: account.id,
              payment_intent_id: "pi_" + args.p_command_id,
            },
          },
          error: null,
        };
      if (name === "reduce_booking_financial_evidence_v3") {
        if (args.p_authority_kind !== "refund_command")
          return { data: { action: "settled" }, error: null };
        return {
          data: state.refundCreated.has(args.p_authority_id)
            ? { action: "settled" }
            : {
                action: "create",
                stripeAccountId: account.id,
                paymentIntentId: "pi_" + args.p_authority_id,
                chargeId: "ch_" + args.p_authority_id,
                amountMinor: 1000,
                idempotencyKey: "refund_" + args.p_authority_id,
                paymentId: args.p_authority_id,
                appointmentId: args.p_authority_id,
                profileId,
                environment: "test",
                generation: 1,
                commandId: args.p_authority_id,
              },
          error: null,
        };
      }
      if (name === "claim_due_booking_notifications_v3") {
        if (state.notificationClaimUnknown)
          return { data: null, error: { code: "57014", message: "fixture claim timeout" } };
        assert.equal(args.p_limit, 1);
        return { data: state.notifications.splice(0, 1), error: null };
      }
      if (name === "get_booking_notification_context_v3")
        return {
          data: state.notificationContextMissing
            ? null
            : {
                appointment: {
                  public_reference: "fixture-reference",
                  start_at: "2030-01-01T12:00:00Z",
                  time_zone: "UTC",
                  service_snapshot: { name: "Fixture service" },
                  appointment_state: "confirmed",
                  calendar_state: "create_pending",
                  cancellation_requested_at: null,
                },
              },
          error: null,
        };
      if (name === "authorize_booking_notification_dispatch_v3")
        return {
          data: state.notificationAuthorizationMissing
            ? null
            : state.notificationAuthorizations.length
              ? state.notificationAuthorizations.shift()
              : { action: "dispatch", payload: args.p_payload, dispatch_budget_ms: 10_000 },
          error: null,
        };
      if (name === "complete_booking_notification_v3")
        return state.notificationSettlementUnknown
          ? { data: null, error: { code: "57014", message: "fixture settlement timeout" } }
          : { data: true, error: null };
      if (name === "claim_due_stripe_connect_accounts") {
        assert.equal(args.p_limit, 1, "25-item maintenance still claims exactly one row");
        if (state.connectClaimUnknown)
          return { data: null, error: { code: "57014", message: "PRIVATE Connect claim" } };
        if (state.savedAccounts !== null) {
          const due = state.savedAccounts
            .filter(
              (row) =>
                row.environment === args.p_environment && row.dueAt <= state.now && !row.leaseToken,
            )
            .sort((a, b) => a.dueAt - b.dueAt)[0];
          if (!due) return { data: [], error: null };
          due.leaseToken = args.p_lease_token;
          due.reconciliation_fencing_token++;
          due.dueAt = state.now + 60_000;
          return { data: [{ ...due }], error: null };
        }
        const rows = state.connectClaimed
          ? []
          : [
              {
                profile_id: profileId,
                environment: "test",
                stripe_account_id: account.id,
                reconciliation_fencing_token: 7,
              },
            ];
        state.connectClaimed = true;
        return { data: rows, error: null };
      }
      if (name === "begin_leased_stripe_connect_reconciliation") {
        if (state.savedAccounts !== null) {
          const row = state.savedAccounts.find((row) => row.profile_id === args.p_profile_id);
          assert.equal(row.stripe_account_id, args.p_stripe_account_id);
          assert.equal(row.leaseToken, args.p_lease_token);
          assert.equal(row.reconciliation_fencing_token, args.p_fencing_token);
        }
        return { data: 11, error: null };
      }
      if (name === "apply_leased_stripe_connect_account_projection") {
        if (state.savedAccounts !== null) {
          const row = state.savedAccounts.find((row) => row.profile_id === args.p_profile_id);
          assert.equal(row.stripe_account_id, args.p_stripe_account_id);
          assert.equal(row.leaseToken, args.p_lease_token);
          assert.equal(row.reconciliation_fencing_token, args.p_fencing_token);
          const observedAt = Date.parse(args.p_observed_at);
          assert.ok(Number.isFinite(observedAt));
          row.verifications.push(observedAt);
          row.dueAt = observedAt + 600_000;
        }
        return {
          data: {
            stripe_account_id: args.p_stripe_account_id,
            onboarding_state: "ready",
            charges_enabled: true,
            payouts_enabled: true,
            details_submitted: true,
            last_verified_at: args.p_observed_at,
            reconnect_reason: null,
          },
          error: null,
        };
      }
      if (name === "release_stripe_connect_reconciliation_claim") {
        if (state.savedAccounts !== null) {
          const row = state.savedAccounts.find((row) => row.profile_id === args.p_profile_id);
          assert.equal(row.leaseToken, args.p_lease_token);
          assert.equal(row.reconciliation_fencing_token, args.p_fencing_token);
          row.leaseToken = null;
        }
        return { data: !state.connectReleaseLost, error: null };
      }
      if (name === "claim_provider_event") return { data: 4, error: null };
      if (
        [
          "claim_booking_provider_account_disconnect_v3",
          "claim_google_calendar_setup_probe",
        ].includes(name)
      )
        return { data: null, error: null };
      if (name.startsWith("claim_")) return { data: [], error: null };
      if (name.startsWith("expire_")) return { data: 0, error: null };
      return { data: true, error: null };
    });
  },
};

globalThis.__cronRouteTest = { db, Stripe };
process.env = new Proxy(originalEnv, {
  get(target, key) {
    return Object.hasOwn(state.env, key) ? state.env[key] : Reflect.get(target, key);
  },
});
Date.now = () => state.now;
globalThis.fetch = async (url, init) => {
  if (url === "https://api.resend.com/emails") {
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    state.provider.push(url);
    state.now += state.notificationAdvanceMs;
    return state.notificationFailure
      ? Response.json({ error: "fixture delivery unavailable" }, { status: 503 })
      : Response.json({ id: "fixture-email-" + state.provider.length });
  }
  const parsedUrl = new URL(String(url));
  if (parsedUrl.hostname === "api.stripe.com" && !parsedUrl.pathname.includes("/accounts/")) {
    assert.equal(init.redirect, "manual");
    state.provider.push(url);
    state.now += state.financialAdvanceMs;
    if (state.financialFailure)
      return Response.json(
        { error: { type: "api_error", message: "PRIVATE provider failure" } },
        { status: 503 },
      );
    const id = parsedUrl.pathname.split("/").at(-1);
    if (parsedUrl.pathname.startsWith("/v1/checkout/sessions/"))
      return Response.json({
        id,
        status: "complete",
        payment_status: "paid",
        payment_intent: "pi_" + id,
      });
    if (parsedUrl.pathname.startsWith("/v1/payment_intents/"))
      return Response.json({ id, latest_charge: "ch_" + id.slice(3) });
    if (parsedUrl.pathname.startsWith("/v1/charges/"))
      return Response.json({
        id,
        amount: 1000,
        amount_refunded: state.refundCreated.has(id.slice(3)) ? 1000 : 0,
        currency: "usd",
      });
    assert.equal(parsedUrl.pathname, "/v1/refunds");
    if (init.method === "POST") {
      const command = new URLSearchParams(init.body).get("metadata[bookingCommandId]");
      assert.ok(command);
      state.refundCreated.add(command);
      return Response.json({ id: "re_" + command });
    }
    return Response.json({ data: [], has_more: false });
  }
  const saved = state.savedAccounts?.find(
    (row) => url === "https://api.stripe.com/v1/accounts/" + row.stripe_account_id,
  );
  assert.equal(
    url,
    "https://api.stripe.com/v1/accounts/" + (saved?.stripe_account_id ?? account.id),
  );
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "manual");
  state.provider.push(url);
  state.connectDispatches.push({
    at: state.now,
    accountId: saved?.stripe_account_id ?? account.id,
  });
  state.now += state.connectAdvanceMs;
  return state.rowFailure
    ? Response.json(
        { error: { type: "api_error", message: "dummy provider error" } },
        { status: 503 },
      )
    : Response.json({ ...account, id: saved?.stripe_account_id ?? account.id });
};

// Framework entry adapters and DB/HTTP seams only. All application workers, reducers' callers,
// environment checks, and provider orchestration are bundled from the actual application.
const mocks = {
  "@tanstack/react-router": "export const createFileRoute=()=>config=>config;",
  "@tanstack/react-start":
    "export function createServerFn(){return {validator(parse){return {handler(fn){return ({data})=>fn({data:parse(data)});}};},handler(fn){return fn;}};}",
  "@tanstack/react-start/server":
    "export function getRequest(){throw new Error('No owner browser in cron test');}",
  "@/integrations/supabase/client.server":
    "export const supabaseAdmin=globalThis.__cronRouteTest.db;",
  "@/integrations/supabase/booking-worker.server":
    "export const bookingWorker=globalThis.__cronRouteTest.db;",
  stripe: "export default globalThis.__cronRouteTest.Stripe;",
};

function request(route, body, headers = {}) {
  const secret = {
    "pipedream-inbox": "fixture-google",
    "stripe-inbox": "fixture-stripe",
    booking: "fixture-booking",
  }[route];
  return new Request("https://obratech.co/api/cron/" + route, {
    method: "POST",
    headers: { authorization: "Bearer " + secret, "content-type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
}

try {
  reset();
  for (const name of ["pipedream-inbox", "stripe-inbox", "booking"]) {
    const bundle = await importWithMocks(
      path.resolve("src/routes/api/cron/" + name + ".ts"),
      mocks,
    );
    bundles.push({ name, ...bundle });
  }
  const invoke = (name, body, headers) =>
    bundles
      .find((bundle) => bundle.name === name)
      .subject.Route.server.handlers.POST({ request: request(name, body, headers) });
  for (const name of ["pipedream-inbox", "stripe-inbox", "booking"]) {
    reset();
    assert.equal(
      (await invoke(name, { family: "core" }, { authorization: "Bearer wrong-fixture" })).status,
      401,
    );
    assert.equal(state.calls.length, 0);
    const suffix =
      name === "booking" ? "booking-core" : name === "pipedream-inbox" ? "google" : "stripe";
    const mismatch = await invoke(name, name === "booking" ? { family: "core" } : {}, {
      "x-obra-worker-environment": "live",
      "x-obra-cron-schedule": "obra-calendar-live-" + suffix,
    });
    assert.equal(mismatch.status, 503);
    const mismatchResult = await mismatch.json();
    assert.equal(mismatchResult.outcome, "failed");
    assert.equal(mismatchResult.environment, "live");
    assert.equal(
      mismatchResult.scheduleName,
      "obra-calendar-live-" + suffix,
      "authenticated configuration rejection retains the exact request identity for the ledger",
    );
    assert.equal(state.calls.length, 0);
  }

  reset();
  state.env.SAAS_STRIPE_INBOX_WORKER_ENABLED = "true";
  state.failSaas = true;
  const rejectedSaas = await invoke("stripe-inbox");
  assert.equal(rejectedSaas.status, 500);
  const rejectedBody = await rejectedSaas.json();
  assert.equal(
    rejectedBody.reconciliation.reconciled,
    1,
    "real SaaS rejection cannot skip real Stripe verification",
  );
  assert.equal(rejectedBody.failed, null, "unknown counts are not zero");
  assert.doesNotMatch(JSON.stringify(rejectedBody), /do-not-leak/);
  assert.equal(state.provider.length, 1);
  assert.ok(
    state.calls
      .filter(([name]) => name === "claim_due_stripe_connect_accounts")
      .every(([, args]) => args.p_limit === 1),
  );

  reset({ rowFailure: true });
  const failedStripe = await (await invoke("stripe-inbox")).json();
  assert.equal(failedStripe.outcome, "partial_failure");
  assert.equal(failedStripe.failed, 1);
  assert.equal(failedStripe.saas.skipped, true);
  assert.equal(failedStripe.checkoutFulfillment.skipped, true);
  reset();
  state.env.STRIPE_SECRET_KEY = undefined;
  assert.equal((await invoke("stripe-inbox")).status, 503);
  assert.equal(state.calls.length, 0);
  reset();
  state.env.SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED = "true";
  assert.equal((await (await invoke("stripe-inbox")).json()).outcome, "completed");
  assert.equal(
    state.calls.find(([name]) => name === "claim_due_saas_checkout_fulfillment")[1].p_limit,
    1,
  );

  reset({ googleInboxFailure: true });
  assert.equal((await (await invoke("pipedream-inbox")).json()).outcome, "partial_failure");
  assert.ok(
    state.calls.some(([name]) => name === "claim_due_pipedream_bindings"),
    "inbox row failure does not skip Google maintenance",
  );
  reset();
  state.env.CALENDAR_WORKER_BUDGET_MS = "999999999";
  state.env.CALENDAR_WORKER_SETTLEMENT_MS = "-999";
  const bounded = await (await invoke("pipedream-inbox")).json();
  assert.equal(bounded.budgetMs, 45_000);
  assert.equal(
    state.calls.find(([name]) => name === "claim_due_pipedream_bindings")[1].p_environment,
    "test",
  );

  const savedAccounts = (count) =>
    Array.from({ length: count }, (_, index) => ({
      profile_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      environment: "test",
      stripe_account_id: "acct_idle" + index,
      reconciliation_fencing_token: 0,
      leaseToken: null,
      dueAt: state.now,
      verifications: [],
    }));
  reset();
  state.savedAccounts = savedAccounts(30);
  state.env.SAAS_STRIPE_INBOX_WORKER_ENABLED = "true";
  state.failSaas = true;
  const cappedMaintenance = await invoke("stripe-inbox");
  assert.equal(cappedMaintenance.status, 500);
  const cappedMaintenanceBody = await cappedMaintenance.json();
  assert.deepEqual(cappedMaintenanceBody.reconciliation, {
    reconciled: 25,
    failed: 0,
    claimed: 25,
    deadlineExceeded: false,
  });
  assert.equal(
    cappedMaintenanceBody.failed,
    null,
    "failed SaaS does not invent an exhaustive count",
  );
  assert.equal(state.savedAccounts.filter((row) => row.verifications.length).length, 25);
  assert.equal(state.connectDispatches.length, 25, "no 26th account despite unused time");
  assert.equal(
    state.calls.filter(([name]) => name === "claim_due_stripe_connect_accounts").length,
    25,
  );
  assert.doesNotMatch(JSON.stringify(cappedMaintenanceBody), /PRIVATE|do-not-leak/);
  for (const negative of ["rowFailure", "connectReleaseLost", "connectClaimUnknown"]) {
    reset({ [negative]: true });
    state.savedAccounts = savedAccounts(30);
    const response = await invoke("stripe-inbox");
    const result = await response.json();
    assert.equal(response.status, negative === "connectClaimUnknown" ? 500 : 200);
    assert.equal(result.outcome, negative === "connectClaimUnknown" ? "failed" : "partial_failure");
    assert.equal(result.failed, negative === "connectClaimUnknown" ? null : 25);
    assert.equal(result.reconciled, negative === "connectClaimUnknown" ? null : 0);
    assert.equal(state.connectDispatches.length, negative === "connectClaimUnknown" ? 0 : 25);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
  reset({ connectAdvanceMs: 4_000 });
  state.savedAccounts = savedAccounts(48);
  const maintenanceStarted = state.now;
  const maintenanceStopped = await (await invoke("stripe-inbox")).json();
  assert.deepEqual(maintenanceStopped.reconciliation, {
    reconciled: 9,
    failed: 0,
    claimed: 9,
    deadlineExceeded: true,
  });
  assert.equal(maintenanceStopped.outcome, "deadline_exceeded");
  assert.ok(state.connectDispatches.every((call) => call.at < maintenanceStarted + 36_000));
  assert.equal(
    state.calls.filter(([name]) => name === "claim_due_stripe_connect_accounts").length,
    9,
  );
  let workAfterReturn = [state.calls.length, state.provider.length];
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(
    [state.calls.length, state.provider.length],
    workAfterReturn,
    "no hidden maintenance after response",
  );

  // Google inner fairness is owned/tested separately. Mock that interface only here:
  // actual route/deadline contexts must pass the 25-item bound and retain mixed results.
  globalThis.__cronRouteTest.googleMaintenance = async (limit, options, canContinue) => {
    state.googleMaintenanceCalls.push({ limit, ...options });
    assert.equal(limit, 25);
    assert.equal(options.environment, "test");
    if (state.googleMaintenanceResult instanceof Error) throw state.googleMaintenanceResult;
    if (state.googleMaintenanceResult) return state.googleMaintenanceResult;
    const result = {
      checked: 0,
      reconciled: 0,
      failed: 0,
      disconnects: 0,
      probes: 0,
      deadlineReached: false,
    };
    while (result.checked < limit && canContinue() && state.now + 4_000 < options.deadlineAt) {
      const due = state.googleAccounts
        .filter((row) => row.dueAt <= state.now)
        .sort((a, b) => a.dueAt - b.dueAt)[0];
      if (!due) break;
      state.googleDispatches.push({ at: state.now, id: due.id });
      state.now += state.googleAdvanceMs;
      due.verifications.push(state.now);
      due.dueAt = state.now + 600_000;
      result.checked++;
      result.reconciled++;
    }
    result.deadlineReached = !canContinue() || state.now + 4_000 >= options.deadlineAt;
    return { ...result, success: result.failed === 0 && !result.deadlineReached };
  };
  globalThis.__cronRouteTest.googleInbox = () => {
    if (state.googleInboxResult instanceof Error) throw state.googleInboxResult;
    return state.googleInboxResult;
  };
  const googleCapacityRoute = await importWithMocks(
    path.resolve("src/routes/api/cron/pipedream-inbox.ts"),
    {
      ...mocks,
      "@/lib/pipedream-trigger-reconciliation.server": `
      import { workerCanContinue } from "@/lib/worker-deadline.server";
      export const reconcileDuePipedreamTriggers=(limit,options)=>globalThis.__cronRouteTest.googleMaintenance(limit,options,workerCanContinue);`,
      "@/lib/pipedream-inbox-worker.server":
        "export const processPipedreamCalendarInbox=async()=>globalThis.__cronRouteTest.googleInbox();",
    },
  );
  bundles.push({ name: "google-capacity", ...googleCapacityRoute });
  const invokeGoogleCapacity = () =>
    googleCapacityRoute.subject.Route.server.handlers.POST({ request: request("pipedream-inbox") });
  const mixedGoogle = {
    checked: 25,
    reconciled: 23,
    failed: 2,
    disconnects: 4,
    probes: 5,
    deadlineReached: false,
    success: false,
  };
  reset({
    googleMaintenanceResult: mixedGoogle,
    googleInboxResult: { processed: 3, failed: 1, claimed: 4, deadlineExceeded: false },
  });
  const mixedGoogleBody = await (await invokeGoogleCapacity()).json();
  assert.equal(mixedGoogleBody.outcome, "partial_failure");
  assert.equal(mixedGoogleBody.failed, 3);
  assert.equal(mixedGoogleBody.reconciled, 23);
  assert.deepEqual(
    mixedGoogleBody.reconciliation,
    mixedGoogle,
    "disconnect/setup/saved-check result fields pass through unchanged",
  );
  assert.equal(state.googleMaintenanceCalls[0].deadlineAt, state.now + 40_000);
  reset({ googleMaintenanceResult: { ...mixedGoogle, deadlineReached: true } });
  assert.equal((await (await invokeGoogleCapacity()).json()).outcome, "deadline_exceeded");
  reset({ googleInboxResult: new Error("PRIVATE inbox rejection") });
  let googleNegative = await invokeGoogleCapacity();
  assert.equal(googleNegative.status, 500);
  assert.equal((await googleNegative.json()).failed, null);
  assert.equal(
    state.googleMaintenanceCalls.length,
    1,
    "rejected inbox cannot skip Google maintenance",
  );
  reset({ googleMaintenanceResult: new Error("PRIVATE Google maintenance") });
  googleNegative = await invokeGoogleCapacity();
  assert.equal(googleNegative.status, 500);
  assert.doesNotMatch(JSON.stringify(await googleNegative.json()), /PRIVATE/);
  reset({ googleAdvanceMs: 4_000 });
  state.googleAccounts = Array.from({ length: 48 }, (_, id) => ({
    id,
    dueAt: state.now,
    verifications: [],
  }));
  const googleStarted = state.now;
  const googleStopped = await (await invokeGoogleCapacity()).json();
  assert.equal(googleStopped.outcome, "deadline_exceeded");
  assert.equal(googleStopped.reconciliation.checked, 9);
  assert.ok(state.googleDispatches.every((call) => call.at < googleStarted + 36_000));
  workAfterReturn = state.googleDispatches.length;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(state.googleDispatches.length, workAfterReturn);

  // Bounded virtual-clock simulation, not a hosted capacity or Google-inner-loop proof.
  // 48 saved accounts/provider, one minute ticks, 100ms observations, ten-minute due time;
  // only cron invokes maintenance, never owner/public traffic or live providers.
  const realDate = globalThis.Date;
  try {
    globalThis.Date = class extends realDate {
      constructor(...args) {
        super(...(args.length ? args : [state.now]));
      }
      static now() {
        return state.now;
      }
    };
    for (const provider of ["stripe", "google"]) {
      reset({ connectAdvanceMs: 100, googleAdvanceMs: 100 });
      const start = state.now;
      const accounts =
        provider === "stripe"
          ? (state.savedAccounts = savedAccounts(48))
          : (state.googleAccounts = Array.from({ length: 48 }, (_, id) => ({
              id,
              dueAt: start,
              verifications: [],
            })));
      const perInvocation = [];
      for (let minute = 0; minute <= 45; minute++) {
        state.now = start + minute * 60_000;
        const response =
          provider === "stripe" ? await invoke("stripe-inbox") : await invokeGoogleCapacity();
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.outcome, "succeeded");
        const claimed =
          provider === "stripe" ? result.reconciliation.claimed : result.reconciliation.checked;
        assert.ok(claimed <= 25);
        assert.equal(result.reconciled, claimed);
        assert.ok(
          state.now - (start + minute * 60_000) <= 2_500,
          "fixture fits well within the shared invocation budget",
        );
        perInvocation.push(claimed);
      }
      assert.deepEqual(perInvocation.slice(0, 2), [25, 23]);
      assert.ok(
        accounts.every((row) => row.verifications.length >= 4),
        "every idle owner crosses multiple due cycles",
      );
      const gaps = accounts.flatMap((row) =>
        row.verifications.slice(1).map((at, i) => at - row.verifications[i]),
      );
      assert.ok(
        gaps.every((gap) => gap >= 600_000 && gap <= 660_000),
        "repeat cadence is ten minutes plus at most one minute scheduling granularity",
      );
      assert.ok(
        accounts.every((row) => state.now - row.verifications.at(-1) < 900_000),
        "all modeled evidence remains within freshness",
      );
      assert.equal(
        perInvocation.reduce((sum, count) => sum + count, 0),
        accounts.reduce((sum, row) => sum + row.verifications.length, 0),
      );
      console.log(
        `PASS: bounded ${provider} virtual-clock fixture: 48 idle owners, 46 cron ticks, max repeat ${Math.max(...gaps) / 60_000}m; not hosted capacity proof`,
      );
    }
  } finally {
    globalThis.Date = realDate;
  }

  reset();
  state.env.BOOKING_WORKER_MODE = "off";
  assert.equal((await (await invoke("booking", { family: "core" })).json()).outcome, "off");
  assert.equal(state.calls.length, 0);
  reset();
  state.env.BOOKING_WORKER_MODE = "active";
  assert.equal((await (await invoke("booking", { family: "core" })).json()).mode, "active");
  assert.equal(
    state.env.BOOKING_LIVE_ENABLED,
    "false",
    "active servicing does not enable admission",
  );
  reset();
  const drain = await (await invoke("booking", { family: "core" })).json();
  assert.equal(drain.mode, "drain");
  assert.equal(drain.outcome, "completed", "family completion is not proof of all row outcomes");
  assert.equal(drain.failed, 0, "current core workers all return exact failure counts");
  for (const name of ["claim_due_booking_payment_events", "claim_due_booking_outbox"]) {
    const [, args] = state.calls.find(([called]) => called === name);
    assert.equal(args.p_environment, "test");
    assert.equal(args.p_limit, 1);
  }
  const completion = state.calls.find(([name]) => name === "complete_booking_worker_family_v3")[1];
  assert.equal(completion.p_fencing_token, 7);
  assert.equal(completion.p_success, true);
  assert.equal(state.env.BOOKING_LIVE_ENABLED, "false");

  const readyPayments = (count) =>
    Array.from({ length: count }, (_, index) => ({
      id: "payment-event-" + index,
      profile_id: profileId,
      environment: "test",
      account_context: account.id,
      event_type: "checkout.session.completed",
      fencing_token: 1,
      payload: { data: { object: { id: "cs_fixture" + index } } },
    }));
  const readyRefunds = (count) =>
    Array.from({ length: count }, (_, index) => ({
      id: "refund" + index,
      profile_id: profileId,
      environment: "test",
      command_type: "refund",
      fencing_token: 1,
    }));
  reset({ paymentEvents: readyPayments(10), refunds: readyRefunds(10) });
  const financialStarted = originalNow();
  const burst = await (await invoke("booking", { family: "core" })).json();
  const financialElapsedMs = originalNow() - financialStarted;
  assert.equal(burst.inbox.processed, 10);
  assert.equal(burst.outbox.processed, 10);
  assert.equal(state.paymentEvents.length, 0);
  assert.equal(state.refunds.length, 0);
  assert.equal(state.refundCreated.size, 10);
  for (const name of ["claim_due_booking_payment_events", "claim_due_booking_outbox"])
    assert.equal(
      state.calls.filter(([called]) => called === name).length,
      11,
      "drain stops at empty claim",
    );
  assert.ok(financialElapsedMs < 2_000, "ready financial burst uses remaining budget efficiently");
  console.log(
    `PASS: R8 real payment/refund worker burst: 10 payments + 10 refunds in ${financialElapsedMs} ms; one-row claims`,
  );

  reset({ paymentEvents: readyPayments(30), refunds: readyRefunds(30) });
  const cappedBurst = await (await invoke("booking", { family: "core" })).json();
  assert.equal(cappedBurst.inbox.processed, 25);
  assert.equal(cappedBurst.outbox.processed, 25);
  assert.equal(state.paymentEvents.length, 5);
  assert.equal(state.refunds.length, 5);
  reset({ paymentEvents: readyPayments(10), refunds: readyRefunds(10), financialFailure: true });
  const failedBurst = await (await invoke("booking", { family: "core" })).json();
  assert.equal(failedBurst.outcome, "partial_failure");
  assert.equal(failedBurst.failed, 20);
  assert.equal(state.calls.at(-1)[1].p_success, false);
  assert.equal(state.paymentEvents.length, 0);
  assert.equal(state.refunds.length, 0, "persisted row failure does not starve the other lane");
  reset({
    paymentEvents: readyPayments(10),
    refunds: readyRefunds(10),
    financialClaimUnknown: true,
  });
  assert.equal((await invoke("booking", { family: "core" })).status, 500);
  assert.equal(state.provider.length, 0);
  reset({
    paymentEvents: readyPayments(10),
    refunds: readyRefunds(10),
    financialAdvanceMs: 20_000,
  });
  const budgetStop = await invoke("booking", { family: "core" });
  assert.equal(budgetStop.status, 500);
  for (const name of ["claim_due_booking_payment_events", "claim_due_booking_outbox"])
    assert.equal(
      state.calls.filter(([called]) => called === name).length,
      1,
      "no further financial claim after deadline",
    );

  // Actual lifecycle and route: only the Google read adapter supplies a conflict.
  const actualRpc = db.rpc.bind(db);
  let calendarClaimed = false;
  db.rpc = (name, args) => {
    if (name === "claim_booking_calendar_reconciliation")
      return builder(() => {
        state.calls.push([name, args]);
        if (calendarClaimed) return { data: [], error: null };
        calendarClaimed = true;
        return {
          data: [
            {
              link: {
                id: "calendar-link",
                appointment_id: "calendar-appointment",
                profile_id: profileId,
                environment: "test",
                google_event_id: "calendar-event",
                desired_state: "present",
                desired_generation: 1,
                snapshot_appointment_version: 1,
                reconcile_fencing_token: 1,
              },
              appointment: {
                id: "calendar-appointment",
                public_reference: "fixture",
                start_at: "2030-01-01T12:00:00Z",
                end_at: "2030-01-01T13:00:00Z",
                time_zone: "UTC",
                customer_snapshot: { email: "fixture@example.test" },
                service_snapshot: {},
              },
              epoch: {
                id: "calendar-epoch",
                pipedream_account_id: "apn_fixture",
                google_calendar_id: "fixture",
              },
            },
          ],
          error: null,
        };
      });
    if (name === "record_booking_calendar_observation")
      return builder(() => ({ data: { action: "manual_repair" }, error: null }));
    return actualRpc(name, args);
  };
  const conflictRoute = await importWithMocks(path.resolve("src/routes/api/cron/booking.ts"), {
    ...mocks,
    "@/lib/pipedream.server": `export * from ${JSON.stringify(path.resolve("src/lib/pipedream.server.ts"))};
      export async function getGoogleBookingEvent(){return {state:"conflict"};}`,
  });
  bundles.push({ name: "core-conflict", ...conflictRoute });
  reset();
  const conflict = await (
    await conflictRoute.subject.Route.server.handlers.POST({
      request: request("booking", { family: "core" }),
    })
  ).json();
  assert.equal(conflict.lifecycle.googleFailures, 1);
  assert.equal(conflict.outcome, "partial_failure");
  assert.equal(conflict.failed, 1, "current exact totals include the lifecycle failure only once");
  assert.equal(state.calls.at(-1)[1].p_success, false);
  db.rpc = actualRpc;

  // Contract combinations that are not all produced by the current workers yet:
  // known totals, partial positive detail, and thrown errors stay distinct.
  const countRoute = await importWithMocks(path.resolve("src/routes/api/cron/booking.ts"), {
    ...mocks,
    "@/lib/booking-stripe-inbox-worker.server":
      "export async function processBookingStripeInbox(){return globalThis.__cronRouteTest.coreCounts.inbox;}",
    "@/lib/booking-outbox-worker.server":
      "export async function processBookingOutbox(){return globalThis.__cronRouteTest.coreCounts.outbox;}",
    "@/lib/booking-reconciliation.server": `export async function reconcileBookingLifecycle(){
      const value=globalThis.__cronRouteTest.coreCounts.lifecycle;if(value instanceof Error)throw value;return value;}`,
  });
  bundles.push({ name: "core-counts", ...countRoute });
  for (const [inbox, outbox, lifecycle, outcome, failed] of [
    [
      { processed: 0 },
      { processed: 0 },
      { googleFailures: 0, latePaymentFailures: 0 },
      "completed",
      null,
    ],
    [
      { failed: 0 },
      { failed: 0 },
      { googleFailures: 0, latePaymentFailures: 2 },
      "partial_failure",
      null,
    ],
    [
      { failed: 0 },
      { failed: 0 },
      { googleFailures: 0, recoveryFailures: 1 },
      "partial_failure",
      null,
    ],
    [{ failed: 0 }, { failed: 0 }, { sessionExpiryFailures: 1 }, "partial_failure", null],
    [{ failed: 0 }, { failed: 0 }, { holdFailures: 1 }, "partial_failure", null],
    [{ failed: 0 }, { failed: 0 }, { abandonedCheckoutFailures: 1 }, "partial_failure", null],
    [{ failed: 0 }, { failed: 0 }, { segmentFailures: 1 }, "partial_failure", null],
    [{ failed: 2 }, { failed: 3 }, { failed: 4, googleFailures: 4 }, "partial_failure", 9],
    [{ failed: 0 }, { failed: 0 }, { failed: 0 }, "completed", 0],
    [{ failed: 0 }, { failed: 0 }, { failed: 0, googleFailures: 1 }, "partial_failure", null],
    [{ failed: 1 }, { processed: 0 }, { googleFailures: 0 }, "partial_failure", null],
    [{ failed: 0, skipped: 1 }, { failed: 0 }, { failed: 0 }, "partial_failure", null],
    [
      { failed: 0 },
      { failed: 0 },
      { failed: 0, deadlineExceeded: true },
      "deadline_exceeded",
      null,
    ],
    [{ failed: 0 }, { failed: 0 }, new Error("PRIVATE provider error object"), "failed", null],
  ]) {
    reset();
    globalThis.__cronRouteTest.coreCounts = { inbox, outbox, lifecycle };
    const response = await countRoute.subject.Route.server.handlers.POST({
      request: request("booking", { family: "core" }),
    });
    const body = await response.json();
    assert.equal(body.outcome, outcome);
    assert.equal(body.failed, failed);
    assert.equal(state.calls.at(-1)[1].p_success, outcome === "completed");
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE/);
  }
  console.log(
    "PASS: R14 real manual-repair counts and explicit core counter combinations drive partial failure/heartbeat; unknown totals stay null",
  );

  reset({ expireAfterFamilyClaim: true });
  const exhausted = await invoke("booking", { family: "core" });
  assert.equal(exhausted.status, 500);
  assert.equal((await exhausted.json()).outcome, "deadline_exceeded");
  assert.equal(
    state.calls.some(
      ([name]) =>
        name === "claim_due_booking_payment_events" || name === "claim_due_booking_outbox",
    ),
    false,
    "existing canContinue fences prevent financial claims after work deadline",
  );
  assert.equal(state.calls.at(-1)[1].p_success, false);

  reset();
  const bookingHandler = bundles.find((bundle) => bundle.name === "booking").subject.Route.server
    .handlers.POST;
  const stalled = await bookingHandler({
    request: new Request("https://fixture.invalid/api/cron/booking", {
      method: "POST",
      headers: { authorization: "Bearer fixture-booking" },
      duplex: "half",
      body: new ReadableStream({ start() {} }),
    }),
  });
  assert.equal(stalled.status, 400, "request body reads are bounded before claiming work");
  assert.equal(state.calls.length, 0);
  reset();
  assert.equal(
    (await invoke("booking", { family: "core", padding: "x".repeat(2048) })).status,
    400,
  );
  assert.equal(state.calls.length, 0);

  reset({ familyAvailable: false });
  assert.equal((await (await invoke("booking", { family: "core" })).json()).outcome, "skipped");
  assert.equal(state.calls.length, 1);
  reset();
  const emptyNotifications = await (await invoke("booking", { family: "notifications" })).json();
  assert.deepEqual(emptyNotifications.notifications, {
    processed: 0,
    claimed: 0,
    accepted: 0,
    failed: 0,
    suppressed: 0,
    review: 0,
    settled: 0,
    skipped: 0,
  });
  assert.equal(
    state.calls.find(([name]) => name === "claim_due_booking_notifications_v3")[1].p_limit,
    1,
  );
  assert.equal(
    state.calls.filter(([name]) => name === "claim_due_booking_notifications_v3").length,
    1,
    "an empty notification claim stops without polling",
  );
  const queuedNotifications = (count) =>
    Array.from({ length: count }, (_, index) => ({
      id: "notification-" + index,
      appointment_id: "appointment-" + Math.floor(index / 2),
      notification_type: "confirmed",
      audience: index % 2 ? "contractor" : "customer",
      environment: "test",
      recipient_email: "fixture@example.test",
      idempotency_key: "fixture-notification-" + index,
      fencing_token: 1,
    }));
  reset({ notifications: queuedNotifications(10) });
  const drainingStarted = originalNow();
  const notifications = await (await invoke("booking", { family: "notifications" })).json();
  const drainingElapsedMs = originalNow() - drainingStarted;
  assert.equal(notifications.outcome, "succeeded");
  assert.deepEqual(notifications.notifications, {
    processed: 10,
    claimed: 10,
    accepted: 10,
    failed: 0,
    suppressed: 0,
    review: 0,
    settled: 10,
    skipped: 0,
  });
  assert.equal(notifications.accepted, 10);
  assert.equal(notifications.claimed, 10);
  assert.equal(notifications.failed, 0);
  assert.equal(state.notifications.length, 0);
  assert.equal(state.provider.length, 10);
  assert.equal(
    state.calls.filter(([name]) => name === "claim_due_booking_notifications_v3").length,
    11,
  );
  assert.ok(
    drainingElapsedMs < 2_000,
    "ten ready notifications use the remaining invocation budget",
  );
  assert.equal(state.calls.at(-1)[1].p_success, true);

  for (const action of ["suppressed", "review"]) {
    reset({
      notifications: queuedNotifications(10),
      notificationAuthorizations: [
        { action, ...(action === "review" ? { reason: "acceptance_unknown" } : {}) },
      ],
    });
    const response = await invoke("booking", { family: "notifications" });
    assert.equal(
      response.status,
      200,
      "known " + action + " does not abort the notification drain",
    );
    const result = await response.json();
    assert.equal(result.outcome, action === "review" ? "partial_failure" : "succeeded");
    assert.equal(result.claimed, 10);
    assert.equal(result.accepted, 9);
    const expected = {
      processed: 9,
      claimed: 10,
      accepted: 9,
      failed: 0,
      suppressed: action === "suppressed" ? 1 : 0,
      review: action === "review" ? 1 : 0,
      settled: 10,
      skipped: 0,
    };
    assert.deepEqual(result.notifications, expected);
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value);
    assert.equal(state.notifications.length, 0);
    assert.equal(state.provider.length, 9);
    assert.equal(
      state.calls.filter(([name]) => name === "claim_due_booking_notifications_v3").length,
      11,
      "known " + action + " drains the next nine then stops on no work",
    );
    assert.equal(state.calls.at(-1)[1].p_success, action === "suppressed");
    assert.equal(
      state.calls.at(-1)[1].p_safe_error,
      action === "review" ? "Booking notification delivery requires review" : null,
    );
  }

  reset({ notifications: queuedNotifications(3), notificationFailure: true });
  const partialNotifications = await (await invoke("booking", { family: "notifications" })).json();
  assert.equal(partialNotifications.outcome, "partial_failure");
  assert.equal(partialNotifications.failed, 3);
  assert.equal(partialNotifications.accepted, 0);
  assert.equal(partialNotifications.settled, 3);
  assert.equal(partialNotifications.skipped, 0);
  assert.equal(
    partialNotifications.review,
    0,
    "failure RPC boolean does not identify a review outcome",
  );
  assert.equal(
    state.calls.at(-1)[1].p_success,
    false,
    "row failures cannot produce a successful family heartbeat",
  );

  for (const failure of [
    "notificationClaimUnknown",
    "notificationSettlementUnknown",
    "notificationContextMissing",
    "notificationAuthorizationMissing",
  ]) {
    reset({ notifications: queuedNotifications(3), [failure]: true });
    const response = await invoke("booking", { family: "notifications" });
    assert.equal(response.status, 500);
    const result = await response.json();
    assert.equal(result.outcome, "failed");
    assert.equal(result.failed, null, "unknown settlement is not a known delivery failure count");
    assert.equal(result.settled, 0);
    assert.equal(result.suppressed, 0);
    assert.equal(result.review, 0);
    assert.equal(state.notifications.length, failure === "notificationClaimUnknown" ? 3 : 2);
    assert.equal(state.calls.at(-1)[1].p_success, false);
    assert.equal(
      state.calls.filter(([name]) => name === "claim_due_booking_notifications_v3").length,
      1,
      failure + " stops just-in-time claiming without a hot loop",
    );
  }
  reset({ notifications: queuedNotifications(10), notificationAdvanceMs: 20_000 });
  const notificationDeadline = await invoke("booking", { family: "notifications" });
  assert.equal(notificationDeadline.status, 500);
  assert.equal((await notificationDeadline.json()).outcome, "deadline_exceeded");
  assert.equal(
    state.calls.filter(([name]) => name === "claim_due_booking_notifications_v3").length,
    2,
    "no third lease after the work deadline",
  );

  // Exercise the actual heartbeat without a 20-second test sleep. Other timers keep
  // their normal behavior; the provider yields while the first renewal is rejected.
  const originalSetTimeout = globalThis.setTimeout;
  const realMockFetch = globalThis.fetch;
  try {
    reset({ notifications: queuedNotifications(3), renewalFails: true });
    globalThis.setTimeout = (fn, ms, ...args) =>
      originalSetTimeout(fn, ms === 20_000 ? 1 : ms, ...args);
    globalThis.fetch = async (url, init) => {
      if (url === "https://api.resend.com/emails")
        await new Promise((resolve) => originalSetTimeout(resolve, 10));
      return realMockFetch(url, init);
    };
    assert.equal((await invoke("booking", { family: "notifications" })).status, 500);
    assert.ok(state.calls.some(([name]) => name === "renew_booking_worker_family_v3"));
    assert.equal(
      state.calls.filter(([name]) => name === "claim_due_booking_notifications_v3").length,
      1,
      "failed renewal forbids a second notification claim",
    );
    assert.equal(state.calls.at(-1)[1].p_success, false);
    reset({ paymentEvents: readyPayments(3), refunds: readyRefunds(3), renewalFails: true });
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("https://api.stripe.com/"))
        await new Promise((resolve) => originalSetTimeout(resolve, 10));
      return realMockFetch(url, init);
    };
    assert.equal((await invoke("booking", { family: "core" })).status, 500);
    for (const name of ["claim_due_booking_payment_events", "claim_due_booking_outbox"])
      assert.equal(
        state.calls.filter(([called]) => called === name).length,
        1,
        "family renewal loss stops each financial lane before its next claim",
      );
    assert.equal(state.calls.at(-1)[1].p_success, false);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.fetch = realMockFetch;
  }
  reset();
  await invoke("booking", { family: "attachment_cleanup" });
  const cleanup = state.calls.find(([name]) => name === "claim_booking_attachment_cleanup_v3")[1];
  assert.equal(cleanup.p_discover, false);
  assert.equal(cleanup.p_limit, 1);
  console.log(
    `test-calendar-cron-routes: passed (25-item maintenance bounds and mocked Google handoff; virtual-clock cadence; 10 notifications in ${drainingElapsedMs} ms; empty/ambiguous/deadline/renewal stops; no live IO)`,
  );
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  delete globalThis.__cronRouteTest;
  await Promise.all(bundles.map((bundle) => bundle.cleanup()));
}
