import assert from "node:assert/strict";
import path from "node:path";
import Stripe from "stripe";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const state = {};
const profileId = "10000000-0000-4000-8000-000000000001";
const account = {
  id: "acct_savedfixture",
  object: "account",
  type: "express",
  country: "US",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { card_payments: "active" },
  requirements: { currently_due: [], past_due: [], pending_verification: [] },
};
const claim = {
  profile_id: profileId,
  environment: "test",
  stripe_account_id: account.id,
  reconciliation_fencing_token: 7,
};

function reset(overrides = {}) {
  Object.assign(state, {
    calls: [],
    providerCalls: [],
    timeouts: [],
    rows: [{ ...claim }],
    inboxRows: [],
    key: "sk_test_calendar_fixture",
    billing: "test",
    now: originalNow(),
    claimError: false,
    claimNull: false,
    afterClaim: undefined,
    beginError: false,
    afterBegin: undefined,
    afterRelease: undefined,
    releaseLost: false,
    fetchMode: "success",
    shortenRetrieve: false,
    claimCount: 0,
    ...overrides,
  });
}

function query(execute) {
  return {
    abortSignal(signal) {
      this.signal = signal;
      return this;
    },
    then(resolve, reject) {
      assert.ok(
        this.signal instanceof AbortSignal,
        "every maintenance DB operation has a deadline",
      );
      return Promise.resolve().then(execute).then(resolve, reject);
    },
  };
}

const db = {
  from(table) {
    assert.ok(["stripe_connected_accounts", "provider_event_inbox"].includes(table));
    const filters = {};
    return {
      select(columns) {
        assert.equal(
          columns,
          table === "provider_event_inbox"
            ? "id,profile_id,environment,account_context,event_type"
            : "stripe_account_id",
        );
        return this;
      },
      eq(name, value) {
        filters[name] = value;
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
      limit(limit) {
        return query(() => {
          assert.equal(table, "provider_event_inbox");
          assert.deepEqual(filters, {
            provider: "stripe",
            event_family: "connect",
            environment: "test",
          });
          state.calls.push(["load_inbox", { limit }]);
          return { data: state.inboxRows.slice(0, limit), error: null };
        });
      },
      abortSignal(signal) {
        this.signal = signal;
        return this;
      },
      maybeSingle() {
        return query(() => {
          state.calls.push(["load_saved", filters]);
          assert.equal(filters.profile_id, profileId);
          assert.equal(filters.environment, "test");
          return { data: { stripe_account_id: account.id }, error: null };
        }).abortSignal(this.signal);
      },
    };
  },
  rpc(name, args) {
    return query(() => {
      state.calls.push([name, args, state.now]);
      if (
        ["claim_stripe_connect_account_refresh", "claim_due_stripe_connect_accounts"].includes(name)
      ) {
        state.claimCount++;
        if (name === "claim_due_stripe_connect_accounts") assert.equal(args.p_limit, 1);
        else assert.equal(args.p_profile_id, profileId);
        state.afterClaim?.();
        if (state.claimNull) return { data: null, error: null };
        return state.claimError
          ? { data: null, error: { code: "57014", message: "dummy claim timeout" } }
          : { data: state.rows.length ? [state.rows.shift()] : [], error: null };
      }
      if (name === "claim_provider_event") {
        state.claimCount++;
        state.afterClaim?.();
        return { data: 7, error: null };
      }
      if (
        [
          "begin_leased_stripe_connect_reconciliation",
          "begin_stripe_connect_inbox_reconciliation",
        ].includes(name)
      ) {
        assert.equal(args.p_fencing_token, 7);
        if (state.shortenRetrieve) state.now += 10_850;
        state.afterBegin?.();
        return state.beginError
          ? { data: null, error: { code: "40001" } }
          : { data: 11, error: null };
      }
      if (name === "apply_stripe_connect_inbox_projection") {
        assert.equal(args.p_fencing_token, 7);
        assert.equal(args.p_reconciliation_generation, 11);
        return { data: true, error: null };
      }
      if (name === "complete_provider_event") {
        assert.equal(args.p_succeeded, false);
        assert.equal(args.p_fencing_token, 7);
        return { data: true, error: null };
      }
      if (name === "apply_leased_stripe_connect_account_projection") {
        assert.equal(args.p_fencing_token, 7);
        assert.equal(args.p_reconciliation_generation, 11);
        assert.equal(args.p_stripe_account_id, account.id);
        return {
          data: {
            stripe_account_id: account.id,
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
        assert.equal(args.p_fencing_token, 7);
        state.afterRelease?.();
        return { data: !state.releaseLost, error: null };
      }
      throw new Error("Unexpected RPC: " + name);
    });
  },
};

// Exercise the installed SDK's real serializer, timeout and retry implementation. Only the
// HTTP transport and DB boundary are replaced; no lifecycle/onboarding/account methods are stubbed.
class TransportObservedStripe extends Stripe {
  static createFetchHttpClient(fetchFn) {
    const client = super.createFetchHttpClient(fetchFn);
    const makeRequest = client.makeRequest.bind(client);
    client.makeRequest = (...args) => {
      state.timeouts.push(args[7]);
      return makeRequest(...args);
    };
    return client;
  }
}

globalThis.__stripeRefreshTest = { db, Stripe: TransportObservedStripe };
process.env = new Proxy(
  {},
  {
    get(target, key) {
      if (key === "STRIPE_SECRET_KEY") return state.key;
      if (key === "SAAS_BILLING_ENVIRONMENT") return state.billing;
      return Reflect.get(target, key);
    },
  },
);
Date.now = () => state.now;
globalThis.fetch = async (url, init) => {
  state.providerCalls.push({ url, method: init.method, redirect: init.redirect, at: state.now });
  assert.equal(url, "https://api.stripe.com/v1/accounts/" + account.id);
  assert.equal(
    init.method,
    "GET",
    "maintenance never onboards, mutates accounts, or creates links",
  );
  assert.equal(init.redirect, "manual", "bearers must not follow redirects");
  assert.equal(new Headers(init.headers).get("authorization"), "Bearer sk_test_calendar_fixture");
  assert.ok(init.signal instanceof AbortSignal);
  if (state.fetchMode === "headers_hang") {
    return new Promise((_, reject) =>
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
    );
  }
  if (state.fetchMode === "body_hang") {
    return new Response(
      new ReadableStream({
        start(controller) {
          init.signal.addEventListener("abort", () => controller.error(init.signal.reason), {
            once: true,
          });
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  }
  if (state.fetchMode === "unavailable") {
    return Response.json(
      { error: { type: "api_error", message: "dummy provider failure" } },
      { status: 503 },
    );
  }
  return Response.json(account);
};

let bundle;
try {
  reset();
  // A test-only entry gives the real refresh helper and worker scope one AsyncLocalStorage.
  const entry = path.resolve("scripts/test-stripe-connect-refresh.mjs");
  bundle = await importWithMocks(entry, {
    [entry]: `
      export * from "@/lib/stripe-connect-inbox-worker.server";
      export { withWorkerDeadline } from "@/lib/worker-deadline.server";
    `,
    "@/integrations/supabase/client.server":
      "export const supabaseAdmin = globalThis.__stripeRefreshTest.db;",
    stripe: "export default globalThis.__stripeRefreshTest.Stripe;",
  });
  const refresh = (overrides = {}) =>
    bundle.subject.refreshSavedStripeConnectAccount({
      profileId,
      environment: "test",
      deadlineAt: state.now + 15_000,
      ...overrides,
    });
  const names = () => state.calls.map(([name]) => name);
  assert.deepEqual(await refresh(), { checked: true });
  assert.deepEqual(names(), [
    "claim_stripe_connect_account_refresh",
    "load_saved",
    "begin_leased_stripe_connect_reconciliation",
    "apply_leased_stripe_connect_account_projection",
    "release_stripe_connect_reconciliation_claim",
  ]);
  assert.equal(state.calls.at(-1)[1].p_succeeded, true);
  assert.equal(state.timeouts[0], 8_000);

  reset({ rows: [] });
  assert.deepEqual(
    await refresh(),
    { checked: false },
    "busy, cooled, fresh, or missing saved account is not checked",
  );
  assert.equal(state.providerCalls.length, 0);

  for (const overrides of [
    { key: undefined },
    { key: "" },
    { key: "not-a-credential" },
    { key: "sk_live_calendar_fixture", billing: "test" },
    { key: "sk_live_calendar_fixture", billing: "live" },
    { billing: undefined },
  ]) {
    reset(overrides);
    await assert.rejects(refresh);
    assert.equal(state.calls.length, 0, "missing/mixed-mode configuration cannot claim");
    assert.equal(state.providerCalls.length, 0);
  }
  reset();
  assert.deepEqual(await refresh({ deadlineAt: state.now - 1 }), { checked: false });
  assert.equal(state.calls.length, 0);
  reset({ claimError: true });
  await assert.rejects(refresh, /Unable to claim/);
  assert.equal(state.providerCalls.length, 0, "indeterminate claim response forbids provider work");
  reset({ claimNull: true });
  await assert.rejects(refresh, /Indeterminate/);
  assert.equal(state.providerCalls.length, 0, "null is not an empty successful claim result");
  reset({ rows: [{ ...claim, environment: "live" }] });
  await assert.rejects(refresh, /scope mismatch/);
  assert.equal(state.providerCalls.length, 0);
  reset({ rows: [{ ...claim, profile_id: "other-profile" }] });
  await assert.rejects(refresh, /scope mismatch/);
  assert.equal(state.providerCalls.length, 0);
  reset({ beginError: true });
  assert.deepEqual(await refresh(), { checked: false });
  assert.equal(state.providerCalls.length, 0);
  assert.equal(state.calls.at(-1)[1].p_succeeded, false);
  reset({ releaseLost: true });
  await assert.rejects(refresh, /Unable to settle/);

  for (const fetchMode of ["headers_hang", "body_hang", "unavailable"]) {
    reset({ fetchMode, shortenRetrieve: true });
    const startedAt = originalNow();
    assert.deepEqual(await refresh(), { checked: false });
    assert.ok(
      originalNow() - startedAt < 2_000,
      fetchMode + " must settle inside the shortened SDK timeout",
    );
    assert.equal(state.providerCalls.length, 1, "zero SDK retries bounds the total request count");
    assert.equal(state.timeouts[0], 150);
    assert.equal(names().includes("apply_leased_stripe_connect_account_projection"), false);
    assert.equal(state.calls.at(-1)[1].p_succeeded, false);
  }

  reset({ rows: [{ ...claim }, { ...claim }], fetchMode: "unavailable" });
  const result = await bundle.subject.reconcileDueStripeConnectAccounts(2, {
    environment: "test",
    deadlineAt: state.now + 40_000,
  });
  assert.deepEqual(result, { reconciled: 0, failed: 2, claimed: 2, deadlineExceeded: false });
  const transitions = names().filter(
    (name) => name.startsWith("claim_") || name.startsWith("release_"),
  );
  assert.deepEqual(
    transitions,
    [
      "claim_due_stripe_connect_accounts",
      "release_stripe_connect_reconciliation_claim",
      "claim_due_stripe_connect_accounts",
      "release_stripe_connect_reconciliation_claim",
    ],
    "claims are just in time, never a leased batch",
  );

  for (const limit of [undefined, 25, 1000]) {
    reset({ rows: Array.from({ length: 30 }, () => ({ ...claim })) });
    assert.deepEqual(
      await bundle.subject.reconcileDueStripeConnectAccounts(limit, {
        environment: "test",
        deadlineAt: state.now + 40_000,
      }),
      { reconciled: 25, failed: 0, claimed: 25, deadlineExceeded: false },
      "default/oversized invocation limits never exceed 25",
    );
    assert.equal(state.rows.length, 5);
    assert.equal(state.providerCalls.length, 25);
    assert.equal(state.claimCount, 25);
    assert.deepEqual(
      names().filter((name) => name.startsWith("claim_") || name.startsWith("release_")),
      Array.from({ length: 25 }, () => [
        "claim_due_stripe_connect_accounts",
        "release_stripe_connect_reconciliation_claim",
      ]).flat(),
      "each row settles before the next row is leased",
    );
  }
  reset({ rows: [] });
  assert.deepEqual(await bundle.subject.reconcileDueStripeConnectAccounts(), {
    reconciled: 0,
    failed: 0,
    claimed: 0,
    deadlineExceeded: false,
  });
  assert.equal(state.claimCount, 1, "empty claims stop without polling");
  for (const negative of ["claimError", "claimNull"]) {
    reset({ [negative]: true });
    await assert.rejects(() => bundle.subject.reconcileDueStripeConnectAccounts());
    assert.equal(state.claimCount, 1);
    assert.equal(state.providerCalls.length, 0, "unknown claims never guess a dispatch fence");
  }
  for (const negative of ["beginError", "releaseLost", "providerFailure"]) {
    reset({
      rows: Array.from({ length: 30 }, () => ({ ...claim })),
      [negative]: true,
      fetchMode: negative === "providerFailure" ? "unavailable" : "success",
    });
    assert.deepEqual(
      await bundle.subject.reconcileDueStripeConnectAccounts(),
      { reconciled: 0, failed: 25, claimed: 25, deadlineExceeded: false },
      negative + " cannot inflate verified counts, even at the invocation cap",
    );
    assert.equal(state.claimCount, 25);
    assert.equal(state.rows.length, 5);
    assert.equal(state.providerCalls.length, negative === "beginError" ? 0 : 25);
  }

  for (const boundary of ["beforeClaim", "afterClaim", "afterBegin", "afterRelease"]) {
    for (const stop of ["fence", "workDeadline"]) {
      reset({ rows: Array.from({ length: 30 }, () => ({ ...claim })) });
      const at = state.now;
      let permit = true;
      const halt = () => {
        if (stop === "fence") permit = false;
        else state.now = at + 1_000;
      };
      if (boundary === "beforeClaim") halt();
      else state[boundary] = halt;
      const claimed = boundary === "beforeClaim" ? 0 : 1;
      const reconciled = boundary === "afterRelease" ? 1 : 0;
      assert.deepEqual(
        await bundle.subject.withWorkerDeadline(
          at + 40_000,
          () =>
            bundle.subject.reconcileDueStripeConnectAccounts(25, {
              environment: "test",
              deadlineAt: at + 40_000,
            }),
          { workDeadlineAt: at + 1_000, canContinue: () => permit },
        ),
        { reconciled, failed: claimed - reconciled, claimed, deadlineExceeded: true },
        boundary + "/" + stop,
      );
      assert.equal(state.claimCount, claimed, "shared stop forbids the next claim");
      assert.equal(state.providerCalls.length, reconciled, "no provider dispatch after stop");
      if (claimed) {
        assert.equal(state.calls.at(-1)[0], "release_stripe_connect_reconciliation_claim");
        assert.equal(state.calls.at(-1)[1].p_succeeded, reconciled === 1);
        assert.equal(state.calls.at(-1)[1].p_lease_token, state.calls[0][1].p_lease_token);
      }
      if (boundary === "afterClaim")
        assert.deepEqual(
          names(),
          ["claim_due_stripe_connect_accounts", "release_stripe_connect_reconciliation_claim"],
          "a stopped known claim is released without starting account reconciliation",
        );
      const counts = [state.calls.length, state.providerCalls.length];
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.deepEqual(
        [state.calls.length, state.providerCalls.length],
        counts,
        "no hidden work after return",
      );
    }
  }
  reset({
    rows: Array.from({ length: 30 }, () => ({ ...claim })),
    afterRelease: () => {
      state.now += 12_000;
    },
  });
  const budgetStart = state.now;
  assert.deepEqual(
    await bundle.subject.reconcileDueStripeConnectAccounts(25, {
      environment: "test",
      deadlineAt: budgetStart + 40_000,
    }),
    { reconciled: 3, failed: 0, claimed: 3, deadlineExceeded: true },
    "elapsed work still stops the 25-item invocation at its local admission cutoff",
  );
  assert.equal(state.claimCount, 3);
  assert.ok(state.providerCalls.every((call) => call.at < budgetStart + 36_000));

  const inboxRows = () =>
    Array.from({ length: 30 }, (_, id) => ({
      id: "connect-event-" + id,
      profile_id: profileId,
      environment: "test",
      account_context: account.id,
      event_type: "account.updated",
    }));
  reset({ inboxRows: inboxRows() });
  assert.deepEqual(await bundle.subject.processStripeConnectInbox(1000), {
    processed: 25,
    failed: 0,
    claimed: 25,
    deadlineExceeded: false,
  });
  assert.equal(state.claimCount, 25);
  assert.equal(state.providerCalls.length, 25);
  for (const boundary of ["beforeClaim", "afterClaim", "afterBegin"]) {
    for (const stop of ["fence", "workDeadline"]) {
      reset({ inboxRows: inboxRows() });
      const at = state.now;
      let permit = true;
      const halt = () => {
        if (stop === "fence") permit = false;
        else state.now = at + 1_000;
      };
      if (boundary === "beforeClaim") halt();
      else state[boundary] = halt;
      const claimed = boundary === "beforeClaim" ? 0 : 1;
      assert.deepEqual(
        await bundle.subject.withWorkerDeadline(
          at + 40_000,
          () =>
            bundle.subject.processStripeConnectInbox(25, {
              environment: "test",
              deadlineAt: at + 40_000,
            }),
          { workDeadlineAt: at + 1_000, canContinue: () => permit },
        ),
        { processed: 0, failed: claimed, claimed, deadlineExceeded: true },
        boundary + "/" + stop,
      );
      assert.equal(state.claimCount, claimed);
      assert.equal(
        state.providerCalls.length,
        0,
        "stopped inbox cannot dispatch or claim the next event",
      );
      if (claimed) {
        assert.equal(state.calls.at(-1)[0], "complete_provider_event");
        assert.equal(
          state.calls.at(-1)[1].p_lease_token,
          state.calls.find(([name]) => name === "claim_provider_event")[1].p_lease_token,
        );
      }
    }
  }

  for (const outcome of ["fence_lost", "work_deadline_exceeded", "success"]) {
    reset();
    const at = state.now;
    const workDeadlineAt = at + 1_000;
    let permit = true;
    // Stop at the successful begin reply, with the refresh/settlement budget still open.
    state.afterBegin = () => {
      assert.equal(state.providerCalls.length, 0, "begin completes before the saved-account GET");
      if (outcome === "fence_lost") permit = false;
      if (outcome === "work_deadline_exceeded") state.now = workDeadlineAt + 1;
    };
    const checked = outcome === "success";
    assert.deepEqual(
      await bundle.subject.withWorkerDeadline(at + 15_000, refresh, {
        workDeadlineAt,
        canContinue: () => permit,
      }),
      { checked },
      outcome,
    );
    assert.equal(state.providerCalls.length, checked ? 1 : 0, outcome + " provider dispatches");
    assert.deepEqual(
      state.timeouts,
      checked ? [8_000] : [],
      outcome + " rejects stopped work before SDK dispatch and preserves the request timeout",
    );
    assert.deepEqual(names(), [
      "claim_stripe_connect_account_refresh",
      "load_saved",
      "begin_leased_stripe_connect_reconciliation",
      ...(checked ? ["apply_leased_stripe_connect_account_projection"] : []),
      "release_stripe_connect_reconciliation_claim",
    ]);
    assert.equal(state.calls.at(-1)[1].p_succeeded, checked, outcome + " settlement outcome");
    assert.equal(
      state.calls.at(-1)[1].p_lease_token,
      state.calls[0][1].p_lease_token,
      "settlement retains the original claim's lease",
    );
  }
  console.log(
    "test-stripe-connect-refresh: passed (real Stripe SDK; 25-item refresh/inbox caps; claim/dispatch/continuation/deadline stops; negative settlements; bounded header/body transport; fixture-only DB/HTTP)",
  );
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  delete globalThis.__stripeRefreshTest;
  if (bundle) await bundle.cleanup();
}
