import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { importWithMocks } from "./lib/import-with-mocks.mjs";

const [
  envExample,
  checkoutSource,
  inboxSource,
  authorityMigration,
  atomicBeginMigration,
  auditAuthorityMigration,
] = await Promise.all([
  readFile(".env.example", "utf8"),
  readFile("src/lib/checkout.functions.ts", "utf8"),
  readFile("src/lib/stripe-inbox-worker.server.ts", "utf8"),
  readFile(
    "supabase/migrations/20260901110000_saas_checkout_authority_and_entitlement_lifecycle.sql",
    "utf8",
  ),
  readFile("supabase/migrations/20260905103000_atomic_saas_checkout_begin.sql", "utf8"),
  readFile(
    "supabase/migrations/20260906170000_restore_saas_fulfillment_resolution_audit_authority.sql",
    "utf8",
  ),
]);

assert.match(envExample, /^SAAS_CHECKOUT_ENABLED=false$/m);
assert.match(envExample, /^SAAS_BILLING_ENVIRONMENT=test$/m);
assert.match(envExample, /^SAAS_LIVE_CHARGING_ENABLED=false$/m);

function sqlFunction(name) {
  return sqlFunctionFrom(authorityMigration, name);
}

function sqlFunctionFrom(source, name) {
  const candidates = [
    `create function public.${name}`,
    `create or replace function public.${name}`,
  ];
  const start = candidates.reduce((found, candidate) => {
    const index = source.toLowerCase().indexOf(candidate.toLowerCase());
    return index !== -1 && (found === -1 || index < found) ? index : found;
  }, -1);
  assert.notEqual(start, -1, `missing SQL function ${name}`);
  const bodyEnd = source.indexOf("$$;", start);
  assert.notEqual(bodyEnd, -1, `unterminated SQL function ${name}`);
  return source.slice(start, bodyEnd + "$$;".length).replace(/\s+/g, " ");
}

const beginCheckoutSql = sqlFunctionFrom(atomicBeginMigration, "begin_saas_checkout");
assert.match(beginCheckoutSql, /pg_advisory_xact_lock/i);
assert.match(beginCheckoutSql, /insert into public\.profiles/i);
assert.match(beginCheckoutSql, /insert into public\.websites/i);
assert.match(beginCheckoutSql, /active_for_new_sales/i);
assert.match(beginCheckoutSql, /from public\.reserve_checkout_intent/i);
assert.match(beginCheckoutSql, /p_attempt_id/i);
assert.match(beginCheckoutSql, /raise log 'saas_checkout_begin attempt=% stage=started/i);
assert.match(beginCheckoutSql, /exception when others[^;]+get stacked diagnostics/i);
assert.match(
  atomicBeginMigration.replace(/\s+/g, " "),
  /grant execute on function public\.begin_saas_checkout\([^;]+\) to service_role/i,
);
assert.doesNotMatch(checkoutSource, /await verifiedOfferForPlan[\s\S]{0,250}beginSaasCheckout/);
assert.match(checkoutSource, /await beginSaasCheckout[\s\S]{0,3000}await verifiedOfferForPlan/);

const reservationSql = sqlFunction("reserve_checkout_intent");
assert.match(
  reservationSql,
  /pending_payment[^;]+provider_offer_snapshot is null/i,
  "paid checkout reservation requires a verified provider offer snapshot",
);
assert.match(
  reservationSql,
  /insert into public\.subscriptions[^;]+provider_offer_snapshot[^;]+p_provider_offer_snapshot/i,
);
assert.match(
  reservationSql,
  /insert into public\.checkout_sessions[^;]+provider_offer_snapshot[^;]+p_provider_offer_snapshot/i,
);
assert.match(
  authorityMigration,
  /checkout purchase contract is immutable[\s\S]+provider_offer_contract_id[\s\S]+provider_offer_contract_digest/i,
  "checkout snapshot, contract id, and digest are frozen together",
);
assert.match(
  authorityMigration,
  /subscription purchase contract is immutable[\s\S]+provider_offer_contract_id[\s\S]+provider_offer_contract_digest/i,
  "subscription snapshot, contract id, and digest are frozen together",
);

const finalizeSql = sqlFunction("finalize_paid_checkout");
for (const [description, contract] of [
  ["claimed inbox identity", /provider_event_inbox[^;]+id=p_provider_event_id/i],
  ["Stripe SaaS source", /provider='stripe'[^;]+event_family='saas'/i],
  ["completion event type", /event_type='checkout\.session\.completed'/i],
  ["source environment", /environment=c\.environment/i],
  ["claimed processing state", /processing_state='processing'/i],
  ["source Checkout Session", /payload->'data'->'object'->>'id'=p_stripe_checkout_session_id/i],
  ["durable payload digest", /length\(payload_hash\)=64/i],
  ["locked source row", /for update/i],
  ["immutable purchased offer", /expected_evidence:=.+c\.provider_offer_snapshot/i],
  ["completion provenance", /provider_completion_event_id=p_provider_event_id/i],
  ["payload provenance", /provider_completion_payload_hash=inbox\.payload_hash/i],
  ["durable fulfillment", /enqueue_saas_checkout_fulfillment\(c\.id\)/i],
]) {
  assert.match(finalizeSql, contract, `finalization is not bound to ${description}`);
}

const applySql = sqlFunction("apply_saas_provider_event");
assert.match(
  applySql,
  /provider_event_inbox[^;]+id=p_event_id[^;]+lease_token=p_lease_token[^;]+fencing_token=p_fencing_token[^;]+for update/i,
  "the inbox reducer must own a live fenced claim",
);
assert.match(
  applySql,
  /finalize_paid_checkout\([^;]+p_event_id\)/i,
  "the reducer must pass its claimed inbox row as finalization provenance",
);
assert.match(
  applySql,
  /update public\.provider_event_inbox set processing_state='processed'/i,
  "domain reduction and inbox completion remain in one database transaction",
);
assert.doesNotMatch(
  checkoutSource,
  /rpc\(\s*["']finalize_paid_checkout["']/,
  "browser/server-function code must not invoke paid finalization directly",
);
assert.match(inboxSource, /rpc\(\s*["']apply_saas_provider_event["']/);

const normalizedMigration = authorityMigration.replace(/\s+/g, " ");
for (const [description, contract] of [
  [
    "deduplicated checkout delivery",
    /saas_checkout_fulfillment_outbox\([^;]+checkout_session_id uuid not null unique/i,
  ],
  [
    "restricted row access",
    /alter table public\.saas_checkout_fulfillment_outbox enable row level security/i,
  ],
  [
    "private table ACL",
    /revoke all on public\.saas_checkout_fulfillment_outbox from public,anon,authenticated,service_role,booking_worker/i,
  ],
]) {
  assert.match(normalizedMigration, contract, `OTP outbox lacks ${description}`);
}
const enqueueSql = sqlFunction("enqueue_saas_checkout_fulfillment");
assert.match(
  enqueueSql,
  /payment_evidence_kind<>'stripe_api'/i,
  "only provider-paid checkouts enqueue",
);
assert.match(
  enqueueSql,
  /insert into public\.saas_checkout_fulfillment_outbox[^;]+on conflict\(checkout_session_id\)do nothing/i,
  "fulfillment enqueue is idempotent per checkout",
);
const claimFulfillmentSql = sqlFunction("claim_due_saas_checkout_fulfillment");
assert.match(claimFulfillmentSql, /for update skip locked/i, "fulfillment claims serialize");
assert.match(
  claimFulfillmentSql,
  /fencing_token=o\.fencing_token\+1/i,
  "fulfillment claims advance a fence",
);
const completeFulfillmentSql = sqlFunction("complete_saas_checkout_fulfillment");
assert.match(
  completeFulfillmentSql,
  /lease_token=p_lease_token[^;]+fencing_token=p_fencing_token/i,
  "fulfillment settlement requires current lease and fence",
);
assert.match(
  completeFulfillmentSql,
  /when p_retryable and provider_attempts<8 then'retry_wait'/i,
  "only started provider dispatches consume the provider retry budget",
);
const resolveUnknownFulfillmentSql = sqlFunction(
  "resolve_saas_checkout_fulfillment_delivery_unknown",
);
assert.match(
  resolveUnknownFulfillmentSql,
  /validate_admin_session_v4\(p_actor_token_hash,true\)[^;]+v\.role='admin'/i,
  "unknown OTP delivery resolution requires a live AAL2 admin authority",
);
assert.match(
  resolveUnknownFulfillmentSql,
  /state='delivery_unknown'[^;]+fencing_token=p_expected_fencing_token[^;]+for update/i,
  "unknown OTP delivery resolution is fenced to the observed ambiguous delivery",
);
assert.match(
  resolveUnknownFulfillmentSql,
  /insert into public.saas_checkout_fulfillment_resolution_audit/i,
  "unknown OTP delivery resolution is auditable",
);
assert.match(
  resolveUnknownFulfillmentSql,
  /p_action='accepted'[^;]+state='accepted'/i,
  "operator may record a reconciled provider acceptance",
);
assert.match(
  resolveUnknownFulfillmentSql,
  /o.redrive_count>=2[^;]+manual retry budget exhausted/i,
  "operator retry is bounded",
);
assert.match(
  resolveUnknownFulfillmentSql,
  /state='retry_wait'[^;]+attempts=0,redrive_count=redrive_count\+1/i,
  "operator may explicitly authorize one reconciled resend",
);
assert.match(
  normalizedMigration,
  /saas_checkout_fulfillment_resolution_audit_no_mutation[^;]+before update or delete/i,
  "unknown OTP delivery resolution audit is append-only",
);
assert.match(
  auditAuthorityMigration.replace(/\s+/g, " "),
  /revoke all on table public\.saas_checkout_fulfillment_resolution_audit from public, anon, authenticated, service_role, booking_worker/i,
  "only the audited operator recovery RPC may write resolution history",
);
assert.match(
  claimFulfillmentSql,
  /return query with due as\(select o\.id from public\.saas_checkout_fulfillment_outbox o where o\.environment=p_environment and\(o\.state in\('pending','retry_wait'\)or\(o\.state='processing'and o\.provider_dispatch_started_at is null\)\)/i,
  "unknown OTP deliveries are never automatically selected for a worker claim",
);

// Exercise the public checkout boundary with provider and database seams mocked. The verified
// Product/Price offer must be durably reserved before any Stripe Checkout Session can be created.
const checkoutBundle = await importWithMocks(path.resolve("src/lib/checkout.functions.ts"), {
  "@tanstack/react-start": `
    export function createServerFn() {
      let validate = (value) => value;
      const builder = {
        validator(fn) { validate = fn; return builder; },
        middleware() { return builder; },
        handler(fn) { return (input = {}) => fn({ data: validate(input.data) }); },
      };
      return builder;
    }
  `,
  "@tanstack/react-start/server": `
    export const getRequest = () => new Request("https://example.test", {
      headers: { "cf-connecting-ip": "203.0.113.10", "user-agent": "checkout-contract-test" },
    });
  `,
  "@/lib/legal-documents.server": `
    export const checkoutLegalEvidence = () => ({ schema: 1, documents: [] });
  `,
  "@/lib/auth/admin-middleware.server": `export const requireAdminMiddleware = {};`,
  "@/lib/auth/profile.server": `
    export const normalizeLicenseNumber = (value) => value.trim().toUpperCase();
    export const findProfileByLicense = async () => null;
    export const ensureWebsiteForProfile = async () => "00000000-0000-4000-8000-000000000002";
  `,
  "@/lib/onboarding-state": `export const asOnboardingRecord = () => ({});`,
  "@/lib/stripe.server": `
    export function assertSaasCheckoutChargingEnabled() {
      const state = globalThis.__checkoutContract;
      state.events.push("gate");
      if (state.gateError) throw new Error("checkout disabled");
      return "test";
    }
    export const billingEnvironment = () => "test";
    export const stripeConfigured = () => !globalThis.__checkoutContract.stripeConfigError;
    export const saasCheckoutAvailable = () => true;
    export const publicAppUrl = () => "https://example.test";
    export const expireStripeCheckoutSession = async () => undefined;
    export const paidCheckoutOfferEvidence = () => ({});
    export async function verifiedOfferForPlan(plan) {
      const state = globalThis.__checkoutContract;
      state.events.push("verified-offer");
      if (state.offerError) throw new Error("offer unavailable");
      const offer = Object.freeze({
        contractVersion: 1, plan, livemode: false,
        priceId: plan === "starter" ? "price_starter" : "price_pro",
        productId: globalThis.__checkoutContract.offerProductMismatch
          ? "prod_mismatch"
          : plan === "starter" ? "prod_starter" : "prod_pro",
        currency: "usd", unitAmountMinor: plan === "starter" ? 7900 : 12900,
        interval: "month", intervalCount: 1,
        productName: plan === "starter" ? "Obra Starter" : "Obra Pro",
        productDescription: plan === "starter"
          ? "$79/month — website hosting, editing, and Website Leads."
          : "$129/month — website and Website Leads, plus Google Calendar booking and Stripe Connect payments.",
      });
      state.offer = offer;
      return offer;
    }
    export function getStripe() {
      return { checkout: { sessions: {
        retrieve: async (id) => {
          const state = globalThis.__checkoutContract;
          state.events.push("stripe-retrieve");
          return { id, url: "https://checkout.stripe.test/c/pay", status: "open", mode: "subscription", livemode: false, client_reference_id: "00000000-0000-4000-8000-000000000003", metadata: { checkoutSessionId: "00000000-0000-4000-8000-000000000003", offerPriceId: "price_starter", offerProductId: "prod_starter" } };
        },
        create: async (params, options) => {
        const state = globalThis.__checkoutContract;
        state.events.push("stripe-create");
        state.stripeCreate = { params, options };
        if (state.stripeCreateError) throw new Error("provider unavailable");
        return { id: "cs_1", url: "https://checkout.stripe.test/c/pay", status: "open", mode: "subscription", livemode: false, client_reference_id: params.client_reference_id, metadata: params.metadata };
      } } } };
    }
  `,
  "@/integrations/supabase/client.server": `
    class Query {
      constructor(table) { this.table = table; }
      insert(value) { globalThis.__checkoutContract.events.push("profile-insert"); this.value = value; return this; }
      update() { return this; }
      select() { return this; }
      eq() { return this; }
      is() { return this; }
      or() { return this; }
      maybeSingle() { return Promise.resolve({ data: null, error: null }); }
      single() {
        if (this.table === "profiles") return Promise.resolve({ data: { id: "00000000-0000-4000-8000-000000000001" }, error: null });
        return Promise.resolve({ data: null, error: { message: "unexpected query" } });
      }
    }
    export const supabaseAdmin = {
      from(table) { return new Query(table); },
      async rpc(name, args) {
        const state = globalThis.__checkoutContract;
        state.events.push(name);
        state.rpc.push({ name, args: JSON.parse(JSON.stringify(args)) });
        if (name === "begin_saas_checkout") {
          if (state.reserveError) {
            return {
              data: null,
              error:
                state.reserveError === true
                  ? {
                      code: "P0001",
                      message: "checkout offer is not an active verified new-sales contract",
                    }
                  : state.reserveError,
              status: state.reserveStatus ?? 0,
            };
          }
          return { data: [{
            profile_id: "00000000-0000-4000-8000-000000000001",
            website_id: "00000000-0000-4000-8000-000000000002",
            checkout_session_id: "00000000-0000-4000-8000-000000000003",
            subscription_id: "00000000-0000-4000-8000-000000000004",
            checkout_status: "pending_payment",
            checkout_email: "buyer@example.test",
            checkout_plan: "starter",
            disposition: state.beginDisposition ?? "created",
            provider_session_id: state.providerSessionId ?? null,
            offer_contract_version: 1,
            offer_price_id: "price_starter",
            offer_product_id: "prod_starter",
            offer_currency: "usd",
            offer_unit_amount_minor: 7900,
            offer_interval: "month",
            offer_interval_count: 1,
          }], error: null, status: 200 };
        }
        if (name === "attach_saas_checkout_provider_session") {
          return { data: "attached", error: null };
        }
        throw new Error("unexpected RPC " + name);
      },
    };
  `,
});

const checkoutInput = {
  email: "buyer@example.test",
  licenseNumber: "license-1",
  businessName: "Example Builders",
  fullName: "Buyer Example",
  city: "Portland",
  plan: "starter",
  acceptedLegal: true,
};
const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
try {
  globalThis.__checkoutContract = { events: [], rpc: [] };
  const created = await checkoutBundle.subject.createSaasCheckout({ data: checkoutInput });
  assert.equal(created.kind, "stripe");
  const state = globalThis.__checkoutContract;
  const reservation = state.rpc.find(({ name }) => name === "begin_saas_checkout");
  assert.ok(reservation, "checkout did not reserve a durable intent");
  assert.ok(
    state.events.indexOf("begin_saas_checkout") < state.events.indexOf("verified-offer"),
    "provider verification ran before the durable checkout boundary",
  );
  assert.ok(
    state.events.indexOf("begin_saas_checkout") < state.events.indexOf("stripe-create"),
    "Stripe Session creation ran before the immutable offer snapshot was reserved",
  );
  assert.equal(state.events.includes("profile-insert"), false);
  assert.equal(state.events.includes("ensure_checkout_website"), false);
  assert.equal(state.stripeCreate.params.line_items[0].price, state.offer.priceId);
  assert.equal(state.stripeCreate.params.metadata.offerProductId, state.offer.productId);
  assert.equal(
    state.stripeCreate.params.metadata.offerAmountMinor,
    String(state.offer.unitAmountMinor),
  );

  globalThis.__checkoutContract = { events: [], rpc: [], offerProductMismatch: true };
  const mismatchLogs = [];
  const originalMismatchConsoleError = console.error;
  console.error = (...args) => mismatchLogs.push(args);
  try {
    await assert.rejects(
      () => checkoutBundle.subject.createSaasCheckout({ data: checkoutInput }),
      /Support reference: CHK-O02/,
    );
  } finally {
    console.error = originalMismatchConsoleError;
  }
  assert.equal(globalThis.__checkoutContract.events.includes("stripe-create"), false);
  assert.equal(JSON.stringify(mismatchLogs).includes("prod_mismatch"), false);
  assert.match(JSON.stringify(mismatchLogs), /offerProductId|productId/);

  globalThis.__checkoutContract = {
    events: [],
    rpc: [],
    reserveError: { code: "", message: "TypeError: fetch failed" },
  };
  const transportLogs = [];
  console.error = (...args) => transportLogs.push(args);
  try {
    await assert.rejects(
      () => checkoutBundle.subject.createSaasCheckout({ data: checkoutInput }),
      /Support reference: CHK-R19/,
    );
  } finally {
    console.error = originalMismatchConsoleError;
  }
  assert.equal(JSON.stringify(transportLogs).includes("TypeError: fetch failed"), false);

  for (const [reserveError, expectedReference] of [
    [{ code: "PGRST003", message: "pool unavailable" }, "CHK-R15"],
    [{ code: "57014", message: "statement timeout" }, "CHK-R16"],
    [{ code: "40P01", message: "deadlock detected" }, "CHK-R17"],
    [{ code: "23514", message: "constraint failed" }, "CHK-R18"],
  ]) {
    globalThis.__checkoutContract = {
      events: [],
      rpc: [],
      reserveError,
      reserveStatus: 500,
    };
    await assert.rejects(
      () => checkoutBundle.subject.createSaasCheckout({ data: checkoutInput }),
      new RegExp(`Support reference: ${expectedReference}`),
    );
    assert.equal(globalThis.__checkoutContract.events.includes("stripe-create"), false);
  }

  globalThis.__checkoutContract = {
    events: [],
    rpc: [],
    beginDisposition: "reused_pending_otp",
  };
  const reused = await checkoutBundle.subject.createSaasCheckout({ data: checkoutInput });
  assert.equal(reused.kind, "otp");
  assert.equal(globalThis.__checkoutContract.events.includes("verified-offer"), false);
  assert.equal(globalThis.__checkoutContract.events.includes("stripe-create"), false);
  globalThis.__checkoutContract = {
    events: [],
    rpc: [],
    beginDisposition: "reused_pending_payment",
    providerSessionId: "cs_existing",
  };
  const resumed = await checkoutBundle.subject.createSaasCheckout({ data: checkoutInput });
  assert.equal(resumed.kind, "stripe");
  assert.equal(globalThis.__checkoutContract.events.includes("stripe-retrieve"), true);
  assert.equal(globalThis.__checkoutContract.events.includes("stripe-create"), false);
  assert.equal(
    globalThis.__checkoutContract.events.includes("attach_saas_checkout_provider_session"),
    false,
  );
  assert.equal(
    state.stripeCreate.options.idempotencyKey,
    `saas-checkout:${created.checkoutSessionId}`,
  );

  for (const [override, expectedReference] of [
    [{ stripeConfigError: true }, "CHK-C01"],
    [{ offerError: true }, "CHK-O01"],
    [{ stripeCreateError: true }, "CHK-S01"],
  ]) {
    globalThis.__checkoutContract = { events: [], rpc: [], ...override };
    await assert.rejects(
      () => checkoutBundle.subject.createSaasCheckout({ data: checkoutInput }),
      new RegExp(`Support reference: ${expectedReference}`),
    );
  }

  globalThis.__checkoutContract = { events: [], rpc: [] };
  assert.throws(
    () => checkoutBundle.subject.createSaasCheckout({ data: {} }),
    /Unable to validate checkout request.*Support reference: CHK-V01/,
  );

  globalThis.__checkoutContract = { events: [], rpc: [], gateError: true };
  await assert.rejects(
    () => checkoutBundle.subject.createSaasCheckout({ data: checkoutInput }),
    /Payments are not configured yet.*Support reference: CHK-G01/,
  );
  assert.deepEqual(globalThis.__checkoutContract.events, ["gate"]);

  globalThis.__checkoutContract = { events: [], rpc: [], reserveError: true };
  const originalConsoleError = console.error;
  const reservationLogs = [];
  console.error = (...args) => reservationLogs.push(args);
  try {
    await assert.rejects(
      () => checkoutBundle.subject.createSaasCheckout({ data: checkoutInput }),
      /Unable to reserve checkout.*Support reference: CHK-R03/,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(globalThis.__checkoutContract.events.includes("stripe-create"), false);
  assert.equal(reservationLogs[0]?.[0], "[saas_checkout_begin_failed]");
  assert.deepEqual(
    {
      event: reservationLogs[0]?.[1]?.event,
      environment: reservationLogs[0]?.[1]?.environment,
      plan: reservationLogs[0]?.[1]?.plan,
      code: reservationLogs[0]?.[1]?.code,
      message: reservationLogs[0]?.[1]?.message,
      reference: reservationLogs[0]?.[1]?.reference,
    },
    {
      event: "saas_checkout_begin_failed",
      environment: "test",
      plan: "starter",
      code: "P0001",
      message: "checkout offer is not an active verified new-sales contract",
      reference: "CHK-R03",
    },
  );
  assert.match(reservationLogs[0]?.[1]?.attemptId, /^[0-9a-f-]{36}$/);
  globalThis.__checkoutContract = {
    events: [],
    rpc: [],
    reserveError: { code: "PGRST202", message: "unclassified provider text" },
  };
  const schemaCacheLogs = [];
  console.error = (...args) => schemaCacheLogs.push(args);
  try {
    await assert.rejects(
      () => checkoutBundle.subject.createSaasCheckout({ data: checkoutInput }),
      /Unable to reserve checkout.*Support reference: CHK-R08/,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(globalThis.__checkoutContract.events.includes("stripe-create"), false);
  assert.equal(JSON.stringify(schemaCacheLogs).includes("unclassified provider text"), false);

  for (const [reserveError, expectedReference] of [
    [{ code: "22023", message: "unrecognized database validation text" }, "CHK-R13"],
    [{ code: "P0001", message: "unrecognized database rejection text" }, "CHK-R14"],
  ]) {
    globalThis.__checkoutContract = { events: [], rpc: [], reserveError };
    const logs = [];
    console.error = (...args) => logs.push(args);
    try {
      await assert.rejects(
        () => checkoutBundle.subject.createSaasCheckout({ data: checkoutInput }),
        new RegExp(`Unable to reserve checkout.*Support reference: ${expectedReference}`),
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(JSON.stringify(logs).includes(reserveError.message), false);
  }

  const serializedReservationLog = JSON.stringify([...reservationLogs, ...schemaCacheLogs]);
  for (const forbidden of [
    checkoutInput.email,
    checkoutInput.licenseNumber,
    checkoutInput.businessName,
    checkoutInput.fullName,
    checkoutInput.city,
    "service-role-test",
  ]) {
    assert.equal(
      serializedReservationLog.includes(forbidden),
      false,
      "reservation diagnostic leaked protected value",
    );
  }
} finally {
  if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  await checkoutBundle.cleanup();
  delete globalThis.__checkoutContract;
}

// Exercise signed ingress: unverified bytes never enter the inbox, while verified bytes are hashed,
// source-labelled, durably ingested, and reduced only through their targeted event identity.
globalThis.__stripeWebhookContract = {};
const webhookBundle = await importWithMocks(path.resolve("src/routes/api/stripe/webhook.ts"), {
  "@tanstack/react-router": `
    export const createFileRoute = () => (options) => {
      globalThis.__stripeWebhookContract.route = options;
      return options;
    };
  `,
  "@/lib/stripe.server": `
    export const STRIPE_API_VERSION = "2026-08-26.dahlia";
    export const billingEnvironment = () => "test";
    export const getStripe = () => ({});
    export async function constructStripeWebhookEvent(rawBody, signature, secret) {
      const state = globalThis.__stripeWebhookContract;
      state.order.push("verify");
      state.verification = { rawBody, signature, secret };
      if (state.invalidSignature) throw new Error("invalid signature");
      return state.event;
    }
  `,
  "@/integrations/supabase/client.server": `
    export const supabaseAdmin = { async rpc(name, args) {
      const state = globalThis.__stripeWebhookContract;
      state.order.push("ingest");
      state.ingest = { name, args };
      return state.ingestError ? { data: null, error: state.ingestError } : { data: "inbox-1", error: null };
    } };
  `,
  "@/lib/stripe-inbox-worker.server": `
    export async function processSaasStripeInbox(limit, eventId) {
      const state = globalThis.__stripeWebhookContract;
      state.order.push("reduce");
      state.reduction = { limit, eventId };
      return state.workerResult ?? { processed: 1, outcome: "applied" };
    }
  `,
});

const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
process.env.STRIPE_WEBHOOK_SECRET = "whsec_contract";
try {
  const event = {
    id: "evt_signed_1",
    object: "event",
    api_version: "2026-08-26.dahlia",
    account: null,
    created: 1_900_000_000,
    livemode: false,
    type: "checkout.session.completed",
    data: { object: { id: "cs_1" } },
  };
  const rawBody = JSON.stringify(event);
  const deliver = async (state, withSignature = true) => {
    globalThis.__stripeWebhookContract = { order: [], event, ...state };
    const headers = withSignature ? { "stripe-signature": "t=1900000000,v1=signed" } : {};
    return webhookBundle.subject.Route.server.handlers.POST({
      request: new Request("https://example.test/api/stripe/webhook", {
        method: "POST",
        headers,
        body: rawBody,
      }),
    });
  };

  assert.equal((await deliver({}, false)).status, 400);
  assert.deepEqual(globalThis.__stripeWebhookContract.order, []);
  assert.equal((await deliver({ invalidSignature: true })).status, 400);
  assert.deepEqual(globalThis.__stripeWebhookContract.order, ["verify"]);

  const accepted = await deliver({});
  assert.equal(accepted.status, 200);
  const state = globalThis.__stripeWebhookContract;
  assert.deepEqual(state.order, ["verify", "ingest", "reduce"]);
  assert.equal(state.verification.rawBody, rawBody);
  assert.equal(state.ingest.name, "ingest_provider_event");
  assert.equal(state.ingest.args.p_provider, "stripe");
  assert.equal(state.ingest.args.p_event_family, "saas");
  assert.equal(state.ingest.args.p_event_id, event.id);
  assert.equal(state.ingest.args.p_destination, "obra-saas-webhook");
  assert.equal(state.ingest.args.p_environment, "test");
  assert.equal(
    state.ingest.args.p_payload_hash,
    createHash("sha256").update(rawBody).digest("hex"),
  );
  assert.deepEqual(state.reduction, { limit: 1, eventId: event.id });

  assert.equal((await deliver({ ingestError: { message: "database unavailable" } })).status, 500);
  assert.deepEqual(globalThis.__stripeWebhookContract.order, ["verify", "ingest"]);
  assert.equal(
    (await deliver({ workerResult: { processed: 0, outcome: "active_lease" } })).status,
    409,
  );
} finally {
  if (originalWebhookSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  await webhookBundle.cleanup();
  delete globalThis.__stripeWebhookContract;
}

// Exercise provider acceptance and durable settlement separately. A successful return from the OTP
// provider is the only path to accepted=true; rate-limit/provider failures retain retry semantics.
const outboxBundle = await importWithMocks(
  path.resolve("src/lib/checkout-otp-outbox-worker.server.ts"),
  {
    "@/integrations/supabase/client.server": `
      export const supabaseAdmin = { async rpc(name, args) {
        const state = globalThis.__otpOutboxContract;
        state.calls.push({ name, args });
        if (name === "claim_due_saas_checkout_fulfillment") {
          return { data: state.rows, error: state.claimError ?? null };
        }
        if (name === "renew_saas_checkout_fulfillment") {
          return { data: state.renewalResult ?? true, error: state.renewalError ?? null };
        }
        if (name === "begin_saas_checkout_fulfillment_dispatch") {
          return { data: state.dispatchResult ?? true, error: state.dispatchError ?? null };
        }
        if (name === "defer_saas_checkout_fulfillment") {
          return { data: state.deferResult ?? true, error: state.deferError ?? null };
        }
        if (name === "mark_saas_checkout_fulfillment_delivery_unknown") {
          return { data: state.deliveryUnknownResult ?? true, error: state.deliveryUnknownError ?? null };
        }
        if (name === "complete_saas_checkout_fulfillment") {
          return { data: state.completionResult ?? true, error: state.completionError ?? null };
        }
        throw new Error("unexpected RPC " + name);
      } };
    `,
    "@/integrations/supabase/auth-server.server": `
      export const createSupabaseAuthClient = (dispatch) => ({ auth: { signInWithOtp: async (input) => {
        const state = globalThis.__otpOutboxContract;
        dispatch.dispatched = true;
        state.providerCalls.push(input);
        return { data: {}, error: state.providerError ?? null };
      } } });
    `,
    "@/lib/auth/contractor-session.server": `
      export async function assertOtpRateLimit() {
        if (globalThis.__otpOutboxContract.rateLimitError) throw new Error("rate limited");
      }
    `,
    "@/lib/stripe.server": `export const billingEnvironment = () => "test";`,
  },
);

const outboxRow = {
  id: "00000000-0000-4000-8000-000000000010",
  recipient_email: "buyer@example.test",
  fencing_token: 9,
};
async function runOutbox(overrides = {}) {
  globalThis.__otpOutboxContract = {
    rows: [outboxRow],
    calls: [],
    providerCalls: [],
    ...overrides,
  };
  return outboxBundle.subject.processCheckoutOtpOutbox(1);
}
try {
  assert.deepEqual(await runOutbox(), { checked: 1, accepted: 1 });
  let state = globalThis.__otpOutboxContract;
  assert.deepEqual(state.providerCalls, [
    { email: outboxRow.recipient_email, options: { shouldCreateUser: true } },
  ]);
  let completion = state.calls.find(({ name }) => name === "complete_saas_checkout_fulfillment");
  assert.equal(completion.args.p_id, outboxRow.id);
  assert.equal(completion.args.p_fencing_token, outboxRow.fencing_token);
  assert.ok(completion.args.p_lease_token);
  assert.equal(completion.args.p_succeeded, true);
  assert.equal(completion.args.p_retryable, true);
  assert.equal(state.calls[1].name, "renew_saas_checkout_fulfillment");
  assert.equal(state.calls[2].name, "begin_saas_checkout_fulfillment_dispatch");

  assert.deepEqual(await runOutbox({ renewalResult: false }), { checked: 1, accepted: 0 });
  state = globalThis.__otpOutboxContract;
  assert.deepEqual(state.providerCalls, []);
  assert.equal(
    state.calls.find(({ name }) => name === "complete_saas_checkout_fulfillment"),
    undefined,
  );
  assert.equal(
    state.calls.find(({ name }) => name === "defer_saas_checkout_fulfillment")?.args
      .p_fencing_token,
    outboxRow.fencing_token,
  );

  assert.deepEqual(await runOutbox({ rateLimitError: true }), { checked: 1, accepted: 0 });
  state = globalThis.__otpOutboxContract;
  assert.deepEqual(state.providerCalls, []);
  assert.equal(
    state.calls.find(({ name }) => name === "complete_saas_checkout_fulfillment"),
    undefined,
  );
  assert.equal(
    state.calls.find(({ name }) => name === "defer_saas_checkout_fulfillment")?.args
      .p_fencing_token,
    outboxRow.fencing_token,
  );

  assert.deepEqual(await runOutbox({ dispatchResult: false }), { checked: 1, accepted: 0 });
  state = globalThis.__otpOutboxContract;
  assert.deepEqual(state.providerCalls, []);
  assert.equal(
    state.calls.find(({ name }) => name === "defer_saas_checkout_fulfillment")?.args
      .p_fencing_token,
    outboxRow.fencing_token,
  );

  assert.deepEqual(await runOutbox({ providerError: { status: 429 } }), {
    checked: 1,
    accepted: 0,
  });
  state = globalThis.__otpOutboxContract;
  completion = state.calls.find(({ name }) => name === "complete_saas_checkout_fulfillment");
  assert.equal(completion.args.p_succeeded, false);
  assert.equal(completion.args.p_retryable, true);

  assert.deepEqual(await runOutbox({ providerError: { status: 503 } }), {
    checked: 1,
    accepted: 0,
  });
  state = globalThis.__otpOutboxContract;
  assert.equal(
    state.calls.find(({ name }) => name === "complete_saas_checkout_fulfillment"),
    undefined,
  );
  assert.equal(
    state.calls.find(({ name }) => name === "mark_saas_checkout_fulfillment_delivery_unknown")?.args
      .p_fencing_token,
    outboxRow.fencing_token,
  );

  assert.deepEqual(await runOutbox({ providerError: { status: 400 } }), {
    checked: 1,
    accepted: 0,
  });
  state = globalThis.__otpOutboxContract;
  completion = state.calls.find(({ name }) => name === "complete_saas_checkout_fulfillment");
  assert.equal(completion.args.p_succeeded, false);
  assert.equal(completion.args.p_retryable, false);

  await assert.rejects(
    () => runOutbox({ completionResult: false }),
    /Unable to settle checkout fulfillment/,
  );
} finally {
  await outboxBundle.cleanup();
  delete globalThis.__otpOutboxContract;
}

console.log(
  "verify-saas-checkout-security: gated snapshot, signed inbox, and provider-accepted outbox contracts pass",
);
