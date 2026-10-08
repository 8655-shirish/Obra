import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const websiteId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const authUserId = "33333333-3333-4333-8333-333333333333";
const keys = { test: "sk_test_connect_fixture", live: "sk_live_connect_fixture" };
const safeError = "Stripe is not configured correctly for this deployment. Contact support.";
const stop = new Error("Mock boundary reached");
const now = Date.now();
const ready = {
  stripe_account_id: "acct_connect_fixture",
  onboarding_state: "ready",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { card_payments: "active" },
  requirements: {},
  reconnect_reason: null,
  last_verified_at: new Date(now - 60_000).toISOString(),
};
const readyStatus = {
  connected: true,
  onboardingState: "ready",
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  currentlyDueCount: 0,
  pastDueCount: 0,
  pendingVerificationCount: 0,
  cardPaymentsActive: true,
  snapshotFresh: true,
  reconnectReason: null,
  lastVerifiedAt: ready.last_verified_at,
};
const pending = {
  ...ready,
  onboarding_state: "pending",
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  capabilities: { card_payments: "pending" },
  requirements: { currently_due: ["a", "b"], past_due: ["c"], pending_verification: ["d"] },
  reconnect_reason: "requirements_due",
  last_verified_at: new Date(now - 16 * 60_000).toISOString(),
};
const pro = {
  plan: "pro",
  state: "active",
  order_confirmed_at: new Date(now - 120_000).toISOString(),
  effective_at: new Date(now - 120_000).toISOString(),
  ends_at: null,
};
const expiredPro = { ...pro, ends_at: new Date(now - 60_000).toISOString() };
const state = {};
const bundles = [];
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
let cases = 0;

function reset(overrides = {}) {
  Object.assign(state, {
    calls: [],
    environmentReads: [],
    key: keys[state.workspace],
    deployment: state.workspace,
    authUserId,
    accessError: null,
    account: ready,
    entitlement: pro,
    readiness: { calendar: "ready", availability: "configured" },
    ...overrides,
  });
}
const called = () => state.calls.map(([name]) => name);
const authorizationCalls = ["access", "session", "profiles", "websites", "website_entitlements"];
const statusCalls = [
  "access",
  "session",
  "profiles",
  "websites",
  "stripe_connected_accounts",
  "website_entitlements",
];
state.db = {
  from(table) {
    state.calls.push([table]);
    const rows = {
      profiles: { id: profileId, auth_user_id: authUserId, environment: state.workspace },
      websites: { id: websiteId, user_id: profileId, environment: state.workspace },
      website_entitlements: {
        website_id: websiteId,
        profile_id: profileId,
        environment: state.workspace,
        ...state.entitlement,
      },
      stripe_connected_accounts: state.account && {
        ...state.account,
        profile_id: profileId,
        environment: state.workspace,
      },
    };
    assert.ok(Object.hasOwn(rows, table), `Unexpected table: ${table}`);
    const filters = [];
    return {
      select() {
        return this;
      },
      eq(key, value) {
        filters.push([key, value]);
        return this;
      },
      single() {
        return this.maybeSingle();
      },
      async maybeSingle() {
        const row = rows[table];
        return {
          data: row && filters.every(([key, value]) => row[key] === value) ? row : null,
          error: null,
        };
      },
    };
  },
  async rpc(name, args) {
    state.calls.push([name, args]);
    if (name === "reserve_stripe_connect_account") throw stop;
    assert.ok(
      [
        "begin_stripe_connect_reconciliation",
        "begin_leased_stripe_connect_reconciliation",
        "begin_stripe_connect_inbox_reconciliation",
      ].includes(name),
      `Unexpected RPC: ${name}`,
    );
    return { data: 7, error: null };
  },
};
state.provider = (name, mode, args) => {
  state.calls.push([name, { mode, args }]);
  throw stop;
};
const mocks = {
  "@tanstack/react-start": `
    export function createServerFn() {
      return { validator(parse) {
        return { handler(fn) { return async ({ data }) => fn({ data: parse(data) }); } };
      } };
    }`,
  "@/lib/jobs/access.server": `
    export async function assertWebsiteWorkspaceAccess(websiteId) {
      const s = globalThis.__stripeConnectEnvironment;
      s.calls.push(["access", websiteId]);
      if (s.accessError) throw new Error(s.accessError);
      return { mode: "contractor", profileId: ${JSON.stringify(profileId)} };
    }`,
  "@/lib/auth/contractor-session.server": `
    export async function getContractorAuthUserId() {
      const s = globalThis.__stripeConnectEnvironment;
      s.calls.push(["session"]);
      return s.authUserId;
    }`,
  "@/integrations/supabase/client.server":
    "export const supabaseAdmin = globalThis.__stripeConnectEnvironment.db;",
  "@/lib/booking-readiness.server": `
    export async function loadBookingReadinessFacts(input) {
      const s = globalThis.__stripeConnectEnvironment;
      s.calls.push(["readiness", input]);
      return s.readiness;
    }`,
  stripe: `
    export default class Stripe {
      static createSubtleCryptoProvider() { return {}; }
      constructor(key) {
        const s = globalThis.__stripeConnectEnvironment;
        const mode = key.startsWith("sk_test_") ? "test" : "live";
        s.calls.push(["Stripe", mode]);
        this.accounts = Object.fromEntries(["retrieve", "list", "create", "createLoginLink"].map(
          name => [name, (...args) => s.provider("stripe." + name, mode, args)]));
        this.accountLinks = { create: (...args) => s.provider("stripe.accountLinks.create", mode, args) };
      }
    }`,
};

// Substitute only synthetic configuration; never read or overwrite inherited credentials.
globalThis.__stripeConnectEnvironment = state;
process.env = new Proxy(originalEnv, {
  get(target, key) {
    if (key === "STRIPE_SECRET_KEY" || key === "SAAS_BILLING_ENVIRONMENT") {
      state.environmentReads.push(key);
      return key === "STRIPE_SECRET_KEY" ? state.key : state.deployment;
    }
    return Reflect.get(target, key);
  },
});
globalThis.fetch = async () => {
  throw new Error("Network calls are forbidden in this test");
};
try {
  for (const workspace of ["test", "live"]) {
    state.workspace = workspace;
    reset();
    // Fresh bundles isolate the real Stripe client's deployment-scoped cache.
    const serverBundle = await importWithMocks(
      path.resolve("src/lib/stripe-connect.server.ts"),
      mocks,
    );
    bundles.push(serverBundle);
    const functionsBundle = await importWithMocks(
      path.resolve("src/lib/stripe-connect.functions.ts"),
      mocks,
    );
    bundles.push(functionsBundle);
    const server = serverBundle.subject;
    const functions = functionsBundle.subject;
    const input = { profileId, websiteId, authUserId, environment: workspace };
    const actions = [
      [() => server.createOrReuseStripeConnectOnboarding(input), "reserve_stripe_connect_account"],
      [() => server.reconcileStripeConnectAccount(input), "begin_stripe_connect_reconciliation"],
      [
        () =>
          server.reconcileStripeConnectAccount({
            ...input,
            lease: { token: "lease-fixture", fencingToken: 3 },
          }),
        "begin_leased_stripe_connect_reconciliation",
      ],
      [() => server.createStripeExpressLoginLink(input), "begin_stripe_connect_reconciliation"],
      [
        () =>
          server.reconcileStripeConnectInboxEvent({
            ...input,
            eventId: "event-fixture",
            leaseToken: "lease-fixture",
            fencingToken: 3,
            stripeAccountId: ready.stripe_account_id,
          }),
        "begin_stripe_connect_inbox_reconciliation",
      ],
    ];
    const keyCases = [
      ["test", keys.test],
      ["live", keys.live],
      ["test", ` ${keys.test} `],
      ["live", ` ${keys.live} `],
      [null, undefined],
      [null, ""],
      [null, "   "],
      [null, "bad-key-fixture"],
      [null, "pk_test_fixture"],
      [null, "rk_test_fixture"],
      [null, "rk_live_fixture"],
    ];
    const deploymentCases = [
      ["test", "test"],
      ["live", "live"],
      ["test", " test "],
      ["live", " live "],
      [null, undefined],
      [null, ""],
      [null, "   "],
      [null, "bad-deployment-fixture"],
    ];
    for (const [keyMode, key] of keyCases) {
      for (const [deploymentMode, deployment] of deploymentCases) {
        reset({ key, deployment });
        const stripeMode = keyMode && keyMode === deploymentMode ? keyMode : null;
        const environment = server.getStripeConnectEnvironment(workspace);
        assert.equal(environment.workspaceEnvironment, workspace);
        assert.equal(environment.stripeEnvironment, stripeMode);
        if (!stripeMode) assert.equal(environment.environmentError, safeError);
        else if (stripeMode === workspace) assert.equal(environment.environmentError, null);
        else {
          assert.match(
            environment.environmentError,
            new RegExp(`workspace uses ${workspace} payments`),
          );
          assert.match(
            environment.environmentError,
            new RegExp(`deployment uses ${stripeMode} Stripe`),
          );
          assert.match(
            environment.environmentError,
            /does not convert existing purchases or accounts/,
          );
        }
        const status = await functions.getStripeConnectStatus({ data: { websiteId } });
        assert.deepEqual(status, {
          ...readyStatus,
          workspaceEnvironment: workspace,
          stripeEnvironment: stripeMode,
          environmentError: environment.environmentError,
          canOnboard: stripeMode === workspace,
        });
        assert.doesNotMatch(
          JSON.stringify(status),
          /sk_|pk_|rk_|bad-key-fixture|bad-deployment-fixture/,
        );
        assert.deepEqual(called(), statusCalls);
        if (environment.environmentError) {
          const rejection = { message: environment.environmentError };
          assert.throws(() => server.assertStripeEnvironment(workspace), rejection);
          for (const [invoke] of actions) {
            state.calls = [];
            await assert.rejects(invoke, rejection);
            assert.deepEqual(state.calls, []);
          }
          state.calls = [];
          await assert.rejects(
            functions.startStripeConnectOnboarding({ data: { websiteId } }),
            rejection,
          );
          assert.deepEqual(called(), authorizationCalls);
        } else assert.doesNotThrow(() => server.assertStripeEnvironment(workspace));
        cases++;
      }
    }

    const statusFixtures = [
      [ready, readyStatus],
      [
        pending,
        {
          ...readyStatus,
          onboardingState: "pending",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          currentlyDueCount: 2,
          pastDueCount: 1,
          pendingVerificationCount: 1,
          cardPaymentsActive: false,
          snapshotFresh: false,
          reconnectReason: pending.reconnect_reason,
          lastVerifiedAt: pending.last_verified_at,
        },
      ],
      [
        null,
        {
          ...readyStatus,
          connected: false,
          onboardingState: "not_started",
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          cardPaymentsActive: false,
          snapshotFresh: false,
          lastVerifiedAt: null,
        },
      ],
    ];
    for (const [account, expected] of statusFixtures) {
      for (const entitlement of [pro, expiredPro]) {
        reset({ account, entitlement });
        assert.deepEqual(await functions.getStripeConnectStatus({ data: { websiteId } }), {
          ...expected,
          workspaceEnvironment: workspace,
          stripeEnvironment: workspace,
          environmentError: null,
          canOnboard: entitlement === pro,
        });
        assert.deepEqual(called(), statusCalls);
        cases++;
      }
    }

    for (const [invoke, data] of [
      [functions.getStripeConnectStatus, { websiteId: "not-a-uuid" }],
      [functions.startStripeConnectOnboarding, { websiteId, returnPath: "https://example.test" }],
      [functions.startStripeConnectOnboarding, { websiteId, returnPath: "/" + "a".repeat(200) }],
    ]) {
      reset();
      await assert.rejects(invoke({ data }), { name: "ZodError" });
      assert.deepEqual(state.calls, []);
      assert.deepEqual(state.environmentReads, []);
      cases++;
    }
    for (const denial of ["Unauthorized", "Forbidden"]) {
      for (const invoke of Object.values(functions)) {
        reset({
          key: "bad-key-fixture",
          deployment: "bad-deployment-fixture",
          authUserId: denial === "Unauthorized" ? null : authUserId,
          accessError: denial === "Forbidden" ? denial : null,
        });
        await assert.rejects(invoke({ data: { websiteId } }), { message: denial });
        assert.deepEqual(called(), denial === "Unauthorized" ? ["access", "session"] : ["access"]);
        assert.deepEqual(state.environmentReads, []);
        cases++;
      }
    }
    reset({ entitlement: expiredPro, key: undefined, deployment: undefined });
    await assert.rejects(functions.startStripeConnectOnboarding({ data: { websiteId } }), {
      message: "An active confirmed Pro order is required",
    });
    assert.deepEqual(called(), authorizationCalls);
    assert.deepEqual(state.environmentReads, []);
    cases++;

    for (const readiness of [
      { calendar: "missing", availability: "configured" },
      { calendar: "ready", availability: "missing" },
      { calendar: "ready", availability: "configured" },
    ]) {
      reset({ readiness });
      const readyToStart =
        readiness.calendar === "ready" && readiness.availability === "configured";
      await assert.rejects(
        functions.startStripeConnectOnboarding({ data: { websiteId } }),
        readyToStart
          ? (error) => error === stop
          : { message: "Complete Google Calendar and availability before connecting Stripe" },
      );
      assert.deepEqual(called(), [
        ...authorizationCalls,
        "readiness",
        ...(readyToStart ? ["reserve_stripe_connect_account"] : []),
      ]);
      assert.deepEqual(state.calls.find(([name]) => name === "readiness")[1], {
        websiteId,
        profileId,
        environment: workspace,
        isPublished: false,
        isActiveVersion: true,
      });
      if (readyToStart)
        assert.deepEqual(state.calls.at(-1)[1], {
          p_profile_id: profileId,
          p_website_id: websiteId,
          p_environment: workspace,
          p_auth_user_id: authUserId,
        });
      cases++;
    }
    for (const [invoke, boundary] of actions) {
      reset();
      await assert.rejects(invoke, (error) => error === stop);
      assert.ok(called().includes(boundary), boundary);
      if (boundary === "reserve_stripe_connect_account") assert.deepEqual(called(), [boundary]);
      else {
        assert.equal(state.calls.at(-1)[0], "stripe.retrieve");
        assert.deepEqual(state.calls.at(-1)[1], {
          mode: workspace,
          args: [ready.stripe_account_id],
        });
      }
      const args = state.calls.find(([name]) => name === boundary)[1];
      if (boundary === "begin_stripe_connect_inbox_reconciliation") {
        assert.deepEqual(args, {
          p_event_id: "event-fixture",
          p_lease_token: "lease-fixture",
          p_fencing_token: 3,
        });
      } else {
        assert.equal(args.p_environment, workspace);
        assert.equal(args.p_profile_id, profileId);
      }
      cases++;
    }
  }
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  delete globalThis.__stripeConnectEnvironment;
  await Promise.all(bundles.map((bundle) => bundle.cleanup()));
}
console.log(`test-stripe-connect-environment: passed (${cases} cases)`);
