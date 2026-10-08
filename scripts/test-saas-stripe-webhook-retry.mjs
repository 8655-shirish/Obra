import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const currentCreated = Math.floor(Date.now() / 1000) - 10;
const event = {
  id: "evt_retry_1",
  type: "customer.subscription.updated",
  created: currentCreated,
  api_version: "2025-12-15.clover",
  livemode: false,
  data: { object: { id: "sub_1" } },
};

const workerBundle = await importWithMocks(path.resolve("src/lib/stripe-inbox-worker.server.ts"), {
  "@/integrations/supabase/client.server": `
      class Query {
        constructor(state) { this.state = state; this.kind = "select"; }
        select(columns) { this.columns = columns; return this; }
        update(values) { this.kind = "update"; this.values = values; return this; }
        eq(column, value) { this.state.queryCalls.push(["eq", column, value]); return this; }
        in(column, values) { this.state.queryCalls.push(["in", column, values]); return this; }
        lte(column, value) { this.state.queryCalls.push(["lte", column, value]); return this; }
        order(column) { this.state.queryCalls.push(["order", column]); return this; }
        limit(value) { this.state.queryCalls.push(["limit", value]); return this; }
        then(resolve) {
          if (this.kind === "update") {
            this.state.retryUpdates.push(this.values);
            return resolve({ data: null, error: this.state.updateError ?? null });
          }
          const rows = this.state.reads.shift() ?? [];
          return resolve({ data: rows, error: null });
        }
      }
      export const supabaseAdmin = {
        from() { return new Query(globalThis.__saasRetryTest); },
        async rpc(name, args) {
          const state = globalThis.__saasRetryTest;
          state.rpcCalls.push({ name, args });
          if (name === "claim_provider_event") {
            return state.claimError
              ? { data: null, error: state.claimError }
              : { data: 7, error: null };
          }
          if (name === "apply_saas_provider_event") {
            return { data: state.applyResult ?? true, error: state.applyError ?? null };
          }
          return { data: true, error: null };
        },
      };
    `,
  "@/lib/stripe.server": `
      export {
        assertSingleCheckoutLineItem, assertSingleSubscriptionItem,
        assertSubscriptionHasNoAdjustments, paidCheckoutOfferEvidence,
      } from ${JSON.stringify(path.resolve("src/lib/stripe.server.ts"))};
      export const billingEnvironment = () => "test";
      export const assertStripeCheckoutMatchesPlan = () => undefined;
      export const assertStripePriceMatchesPlan = () => undefined;
      export function getStripe() {
        return {
          subscriptions: {
            async retrieve(id) {
              globalThis.__saasRetryTest.providerReads.push(id);
              if (globalThis.__saasRetryTest.providerError) throw new Error("provider failed");
              return { id, status: "active", discounts: [], default_tax_rates: [],
                automatic_tax: { enabled: false }, cancel_at_period_end: false };
            },
          },
          subscriptionItems: {
            async list({ subscription, limit }) {
              if (subscription !== "sub_1" || limit !== 2) throw new Error("unexpected subscription item read");
              return { has_more: false, data: [{ id: "si_1", quantity: 1, discounts: [], tax_rates: [],
                current_period_end: ${currentCreated + 86400}, price: { id: "price_fixture", product: "prod_fixture" } }] };
            },
          },
          checkout: { sessions: { async retrieve() { throw new Error("unexpected checkout read"); } } },
        };
      }
    `,
});

try {
  globalThis.__saasRetryTest = {
    reads: [
      [
        {
          id: "inbox-1",
          payload: event,
          processing_state: "failed",
          lease_expires_at: null,
        },
      ],
    ],
    queryCalls: [],
    retryUpdates: [],
    rpcCalls: [],
    providerReads: [],
  };
  const backoff = await workerBundle.subject.processSaasStripeInbox(1, event.id);
  assert.deepEqual(backoff, { processed: 1, outcome: "applied" });
  assert.equal(
    globalThis.__saasRetryTest.queryCalls.some(([method]) => method === "lte"),
    false,
    "targeted signed delivery reads through next_attempt_at backoff",
  );
  assert.equal(
    globalThis.__saasRetryTest.retryUpdates.length,
    0,
    "retry authority must not use direct table updates",
  );
  assert.deepEqual(globalThis.__saasRetryTest.rpcCalls[0], {
    name: "signal_saas_provider_event_retry",
    args: { p_event_id: "inbox-1" },
  });
  assert.deepEqual(globalThis.__saasRetryTest.providerReads, ["sub_1"]);
  assert.ok(
    globalThis.__saasRetryTest.rpcCalls.some(({ name }) => name === "apply_saas_provider_event"),
  );

  globalThis.__saasRetryTest = {
    reads: [
      [{ id: "inbox-1", payload: event, processing_state: "failed", lease_expires_at: null }],
      [{ id: "inbox-1", payload: event, processing_state: "failed", lease_expires_at: null }],
    ],
    queryCalls: [],
    retryUpdates: [],
    rpcCalls: [],
    providerReads: [],
    claimError: { code: "P0001", message: "provider event unavailable" },
  };
  await assert.rejects(
    () => workerBundle.subject.processSaasStripeInbox(1, event.id),
    /SaaS inbox event claim unavailable/,
    "an unexplained unavailable targeted claim is a processing failure, not success",
  );

  globalThis.__saasRetryTest = {
    reads: [
      [
        {
          id: "inbox-1",
          payload: event,
          processing_state: "processed",
          lease_expires_at: null,
        },
      ],
    ],
    queryCalls: [],
    retryUpdates: [],
    rpcCalls: [],
    providerReads: [],
  };
  assert.deepEqual(await workerBundle.subject.processSaasStripeInbox(1, event.id), {
    processed: 0,
    outcome: "completed",
  });
  assert.equal(globalThis.__saasRetryTest.retryUpdates.length, 0);
  assert.equal(globalThis.__saasRetryTest.rpcCalls.length, 0);

  globalThis.__saasRetryTest = {
    reads: [
      [
        {
          id: "inbox-1",
          payload: event,
          processing_state: "processing",
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    ],
    queryCalls: [],
    retryUpdates: [],
    rpcCalls: [],
    providerReads: [],
  };
  assert.deepEqual(await workerBundle.subject.processSaasStripeInbox(1, event.id), {
    processed: 0,
    outcome: "active_lease",
  });
  assert.equal(globalThis.__saasRetryTest.rpcCalls.length, 0);

  globalThis.__saasRetryTest = {
    reads: [[]],
    queryCalls: [],
    retryUpdates: [],
    rpcCalls: [],
    providerReads: [],
  };
  assert.deepEqual(await workerBundle.subject.processSaasStripeInbox(3), { processed: 0 });
  assert.ok(
    globalThis.__saasRetryTest.queryCalls.some(
      ([method, column]) => method === "lte" && column === "next_attempt_at",
    ),
    "untargeted reconciliation remains due-only",
  );
  assert.ok(
    globalThis.__saasRetryTest.queryCalls.some(
      ([method, value]) => method === "limit" && value === 3,
    ),
    "untargeted reconciliation remains caller-bounded",
  );
  assert.equal(globalThis.__saasRetryTest.retryUpdates.length, 0);
} finally {
  await workerBundle.cleanup();
}

const webhookBundle = await importWithMocks(path.resolve("src/routes/api/stripe/webhook.ts"), {
  "@tanstack/react-router": `
    export const createFileRoute = () => (options) => {
      globalThis.__saasWebhookRoute = options;
      return options;
    };
  `,
  "@/lib/stripe.server": `
    export const STRIPE_API_VERSION = "2025-12-15.clover";
    export const billingEnvironment = () => "test";
    export const getStripe = () => ({});
    export const constructStripeWebhookEvent = async () => globalThis.__saasWebhookEvent;
  `,
  "@/integrations/supabase/client.server": `
    export const supabaseAdmin = {
      async rpc(name) {
        globalThis.__saasWebhookRpc.push(name);
        return { data: "inbox-1", error: null };
      },
    };
  `,
  "@/lib/stripe-inbox-worker.server": `
    export async function processSaasStripeInbox() {
      const value = globalThis.__saasWebhookWorker;
      if (value instanceof Error) throw value;
      return value;
    }
  `,
});

const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
globalThis.__saasWebhookEvent = event;
const post = globalThis.__saasWebhookRoute.server.handlers.POST;
async function deliver(result) {
  globalThis.__saasWebhookWorker = result;
  globalThis.__saasWebhookRpc = [];
  return post({
    request: new Request("https://example.test/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1700000000,v1=test" },
      body: JSON.stringify(event),
    }),
  });
}

try {
  assert.equal((await deliver({ processed: 1, outcome: "applied" })).status, 200);
  assert.equal(
    (await deliver({ processed: 0, outcome: "completed" })).status,
    200,
    "an already-completed duplicate is idempotently acknowledged",
  );
  assert.equal(
    (await deliver({ processed: 0, outcome: "active_lease" })).status,
    409,
    "an active lease is not acknowledged",
  );
  assert.equal(
    (await deliver(new Error("claim unavailable"))).status,
    500,
    "claim/processing failure is not acknowledged",
  );
  assert.equal(
    (await deliver({ processed: 0, outcome: "missing" })).status,
    500,
    "zero missing targeted events are not acknowledged",
  );
} finally {
  if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  await webhookBundle.cleanup();
}

console.log("test-saas-stripe-webhook-retry: passed");
