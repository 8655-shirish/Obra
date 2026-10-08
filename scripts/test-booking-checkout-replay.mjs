import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const OriginalDate = Date;
const now = Date.parse("2026-09-10T08:00:00.000Z");
const freshAt = new Date(now - 60_000).toISOString();
const observedAt = new Date(now - 5_000).toISOString();
const staleAt = new Date(now - 16 * 60_000).toISOString();
const websiteId = "10000000-0000-4000-8000-000000000001";
const profileId = "20000000-0000-4000-8000-000000000002";
const appointmentId = "30000000-0000-4000-8000-000000000003";
const publicReference = "40000000-0000-4000-8000-000000000004";
const operationId = "50000000-0000-4000-8000-000000000005";
const secret = "fixture-confirmation-secret-only";
const capability = "fixture-browser-capability-only";
const clientIp = "203.0.113.10";
const env = {
  ...originalEnv,
  BOOKING_LIVE_ENABLED: "true",
  BOOKING_WORKER_MODE: "active",
  BOOKING_WORKER_ENVIRONMENT: "test",
  BOOKING_CONFIRMATION_SECRET: secret,
  BOOKING_RATE_LIMIT_SECRET: "fixture-rate-secret-only",
  SUPABASE_SERVICE_ROLE_KEY: "",
  STRIPE_SECRET_KEY: "sk_test_public_fixture",
  SAAS_BILLING_ENVIRONMENT: "test",
  PUBLIC_APP_URL: "https://app.example.test",
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hmac = (value) => createHmac("sha256", secret).update(value).digest("hex");
const cookieName = (kind, id) =>
  `obra_booking_${kind}_${hmac(`booking-cookie:${kind}:${id}`).slice(0, 24)}`;
const requestCookieName = cookieName("request", websiteId);
const clientBucket = createHmac("sha256", env.BOOKING_RATE_LIMIT_SECRET)
  .update(clientIp)
  .digest("hex");
const tenant = [
  ["eq", "profile_id", profileId],
  ["eq", "environment", "test"],
];
const data = {
  websiteId,
  startAt: "2026-09-11T10:00:00.000Z",
  localDate: "2026-09-11",
  localStart: "10:00",
  timeZone: "UTC",
  observedAt: freshAt,
  availabilityGeneration: 1,
  calendarSetHash: "a".repeat(64),
  requestId: "60000000-0000-4000-8000-000000000006",
  consent: {
    accepted: true,
    documentId: "obra-booking-data-and-payment-consent",
    version: "2026-08-29.1",
    digest: "899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f",
  },
  customer: {
    fullName: "Fixture Customer",
    email: "customer@example.test",
    phone: "+1 202 555 0100",
    address: {
      line1: "123 Fixture Street",
      city: "Fixture City",
      region: "NY",
      postalCode: "10001",
    },
    notes: "Fixture booking",
  },
  attachments: [],
};
const { attachments: _attachments, ...booking } = data;
const requestHash = hash(booking);
const requestCapabilityHash = hmac(`booking-request-capability:${data.requestId}:${capability}`);
const website = {
  id: websiteId,
  user_id: profileId,
  environment: "test",
  status: "live",
  active_version_id: "version-saved",
};
const service = {
  id: "service-saved",
  active: true,
  revision: 3,
  name: "Fixture visit",
  duration_minutes: 60,
  slot_interval_minutes: 60,
  buffer_before_minutes: 5,
  buffer_after_minutes: 10,
  minimum_notice_minutes: 60,
  booking_horizon_days: 30,
  amount_minor: 12500,
  currency: "USD",
};
const schedule = { id: "schedule-saved", active: true, revision: 4, time_zone: "UTC" };
const connection = {
  id: "connection-saved",
  pipedream_account_id: "apn_saved",
  health_state: "healthy",
  last_verified_at: freshAt,
  verification_reason: null,
  reconnect_reason: null,
  account_email: "owner@example.test",
  availability_generation: 7,
};
const account = {
  stripe_account_id: "acct_current",
  onboarding_state: "ready",
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { card_payments: "active" },
  requirements: { currently_due: [], past_due: [], pending_verification: [] },
  last_verified_at: freshAt,
};
const calendarSetHash = createHash("sha256").update("primary").digest("hex");
const session = {
  id: "cs_fixture_replay",
  url: "https://checkout.stripe.com/c/pay/cs_fixture_replay",
  status: "open",
  expires_at: now / 1000 + 30 * 60,
};
const replay = {
  id: operationId,
  appointment_id: appointmentId,
  request_hash: requestHash,
  request_capability_hash: requestCapabilityHash,
};
const priorPayment = {
  id: "70000000-0000-4000-8000-000000000007",
  appointment_id: appointmentId,
  profile_id: profileId,
  environment: "test",
  booking_contract_version: 2,
  checkout_operation_id: operationId,
  checkout_idempotency_key: `booking-checkout:${appointmentId}`,
  checkout_session_id: session.id,
  stripe_account_id: "acct_original_booking",
  payment_state: "pending",
  expected_amount_minor: service.amount_minor,
  currency: service.currency,
  checkout_provider_expires_at: new Date(session.expires_at * 1000).toISOString(),
  confirmation_handoff_expires_at: new Date(session.expires_at * 1000 + 5 * 60_000).toISOString(),
  confirmation_nonce_hash: hash(capability),
  checkout_fencing_token: 0,
  checkout_lease_token: null,
  checkout_lease_expires_at: null,
  payment_intent_id: null,
  charge_id: null,
};
const reservedAppointment = {
  id: appointmentId,
  website_id: websiteId,
  profile_id: profileId,
  environment: "test",
  public_reference: publicReference,
  booking_contract_version: 2,
  appointment_state: "payment_pending",
  payment_state: "pending",
  reservation_expires_at: new Date(now + 15 * 60_000).toISOString(),
  cancellation_requested_at: null,
  service_snapshot: { name: service.name },
  customer_snapshot: { ...data.customer, name: data.customer.fullName },
  amount_minor: service.amount_minor,
  currency: service.currency,
  calendar_destination_epoch_id: "80000000-0000-4000-8000-000000000008",
};
const unstartedPayment = {
  ...priorPayment,
  payment_state: "not_started",
  checkout_session_id: null,
  checkout_provider_expires_at: null,
  confirmation_handoff_expires_at: null,
  confirmation_nonce_hash: null,
};
const heldAppointment = {
  ...reservedAppointment,
  appointment_state: "held",
  payment_state: "not_started",
};
const rateArgs = [
  "check_public_booking_rate_limit",
  {
    p_scope_key: websiteId,
    p_action: "slots",
    p_client_bucket: clientBucket,
    p_limit: 30,
    p_window_seconds: 60,
  },
];
const reserveArgs = [
  "reserve_live_booking",
  {
    p_website_id: websiteId,
    p_environment: "test",
    p_start_at: data.startAt,
    p_local_date: data.localDate,
    p_local_start: data.localStart,
    p_time_zone: data.timeZone,
    p_client_request_id: data.requestId,
    p_request_hash: requestHash,
    p_request_capability_hash: requestCapabilityHash,
    p_consent_document_id: data.consent.documentId,
    p_consent_version: data.consent.version,
    p_consent_digest: data.consent.digest,
    p_customer: data.customer,
    p_freebusy_observed_at: observedAt,
    p_availability_generation: connection.availability_generation,
    p_calendar_set_hash: calendarSetHash,
    p_rate_limit_key: hash({ websiteId, clientBucket }),
  },
];
const state = { expected: [], unexpected: [], calls: [], pending: 0 };
let bundle,
  networkCalls = 0,
  passed = 0;

function expect(kind, args, value) {
  state.expected.push({ kind, args, value });
}

function take(kind, args) {
  const step = state.expected.shift();
  state.calls.push({ kind, args });
  try {
    assert.ok(step, `Unexpected ${kind}: ${JSON.stringify(args)}`);
    assert.equal(kind, step.kind);
    if (typeof step.args === "function") step.args(args);
    else assert.deepEqual(args, step.args);
  } catch (error) {
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
    let awaited = false;
    state.pending++;
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
    for (const method of [
      "select",
      "eq",
      "gt",
      "gte",
      "lte",
      "in",
      "maybeSingle",
      "single",
      "abortSignal",
    ])
      query[method] = (...args) => {
        if (method !== "abortSignal") calls.push([method, ...args]);
        return query;
      };
    return query;
  },
  rpc(name, args) {
    const request = Promise.resolve().then(() => take("rpc", [name, args]));
    request.abortSignal = () => request;
    return request;
  },
};
state.stripe = {
  checkout: {
    sessions: {
      async retrieve(...args) {
        return take("stripe:retrieve", args);
      },
      async create(...args) {
        return take("stripe:create", args);
      },
    },
  },
};

function query(table, columns, filters, result, terminal = "maybeSingle") {
  expect(
    "query",
    [["from", table], ["select", columns], ...filters, ...(terminal ? [[terminal]] : [])],
    result,
  );
}
const ok = (value) => ({ data: value, error: null });

function expectIdentity() {
  query(
    "websites",
    "id,user_id,environment",
    [["eq", "id", websiteId]],
    ok({
      id: websiteId,
      user_id: profileId,
      environment: "test",
    }),
    "single",
  );
}

function expectLookup(value, error = null) {
  expectIdentity();
  query(
    "appointment_operations",
    "id,appointment_id,request_hash,request_capability_hash",
    [...tenant, ["eq", "operation_type", "reserve"], ["eq", "client_request_id", data.requestId]],
    { data: value, error },
  );
}

function expectReplayDetails(payment = priorPayment, appointment = reservedAppointment) {
  query(
    "booking_payments",
    "*",
    [["eq", "appointment_id", appointmentId], ...tenant],
    ok(payment),
    "single",
  );
  query(
    "appointments",
    "id,website_id,profile_id,environment,public_reference,booking_contract_version,appointment_state,payment_state,reservation_expires_at,cancellation_requested_at,service_snapshot,customer_snapshot,amount_minor,currency,calendar_destination_epoch_id",
    [["eq", "id", appointmentId], ...tenant, ["eq", "website_id", websiteId]],
    ok(appointment),
    "single",
  );
}

function expectRetrieve(value = session) {
  expect(
    "stripe:retrieve",
    [
      session.id,
      {},
      {
        stripeAccount: priorPayment.stripe_account_id,
        timeout: 8_000,
        maxNetworkRetries: 0,
      },
    ],
    value,
  );
}

function expectFacts(stale = false, entitlementPatch = {}) {
  for (const [table, columns, filters, row, terminal] of [
    [
      "website_entitlements",
      "plan,state,quote_admission,booking_admission,order_confirmed_at,effective_at,ends_at",
      [["eq", "website_id", websiteId], ...tenant],
      {
        plan: "pro",
        state: "active",
        quote_admission: false,
        booking_admission: true,
        order_confirmed_at: freshAt,
        effective_at: freshAt,
        ends_at: null,
        ...entitlementPatch,
      },
      true,
    ],
    ["booking_services", "id,active", tenant, service, true],
    [
      "calendar_connections",
      "id,connection_revision,pipedream_account_id,health_state,last_verified_at,verification_reason,reconnect_reason,account_email,setup_operation_id,setup_actor_auth_user_id,setup_account_id,setup_expected_revision,setup_calendar_id,setup_calendars,setup_purpose,setup_completed_at,setup_failure_reason,setup_probe_account_id,setup_probe_calendar_id,setup_retry_at",
      tenant,
      {
        ...connection,
        last_verified_at: stale ? staleAt : freshAt,
      },
      true,
    ],
    [
      "calendar_selections",
      "connection_id,blocks_availability,receives_bookings,active,access_role,permission_verified_at",
      [...tenant, ["eq", "active", true]],
      [
        {
          connection_id: connection.id,
          active: true,
          blocks_availability: true,
          receives_bookings: true,
          access_role: "owner",
          permission_verified_at: stale ? staleAt : freshAt,
        },
      ],
      false,
    ],
    [
      "stripe_connected_accounts",
      "stripe_account_id,onboarding_state,charges_enabled,payouts_enabled,details_submitted,capabilities,requirements,last_verified_at",
      tenant,
      {
        ...account,
        last_verified_at: stale ? staleAt : freshAt,
      },
      true,
    ],
    [
      "pipedream_bindings",
      "connection_id,pipedream_account_id,trigger_state,last_health_at,reconciliation_due_at",
      tenant,
      {
        connection_id: connection.id,
        pipedream_account_id: connection.pipedream_account_id,
        trigger_state: "active",
        last_health_at: stale ? staleAt : freshAt,
        reconciliation_due_at: null,
      },
      true,
    ],
    [
      "availability_schedules",
      "id,active",
      [...tenant, ["eq", "service_id", service.id]],
      schedule,
      true,
    ],
  ])
    query(table, columns, filters, ok(row), terminal ? "maybeSingle" : null);
  expect(
    "query",
    [
      ["from", "availability_intervals"],
      ["select", "id", { count: "exact", head: true }],
      ["eq", "schedule_id", schedule.id],
      ...tenant,
    ],
    { data: null, count: 1, error: null },
  );
  expect(
    "rpc",
    [
      "get_pending_google_calendar_setup",
      {
        p_profile_id: profileId,
        p_environment: "test",
        p_expected_revision: 0,
      },
    ],
    ok(null),
  );
}

function expectSettings(stale = false, cutover = true) {
  query(
    "websites",
    "id,user_id,environment,status,active_version_id",
    [["eq", "id", websiteId]],
    ok(website),
    "single",
  );
  expectFacts(stale);
  expect(
    "rpc",
    ["booking_cutover_enabled", { p_profile_id: profileId, p_environment: "test" }],
    ok(cutover),
  );
  if (!cutover) return;
  if (stale) {
    expect(
      "rpc",
      [
        "check_public_booking_rate_limit",
        {
          p_scope_key: `provider-refresh:${websiteId}`,
          p_action: "slots",
          p_client_bucket: createHash("sha256").update(`${profileId}:test`).digest("hex"),
          p_limit: 2,
          p_window_seconds: 60,
        },
      ],
      ok(true),
    );
    expect(
      "google:refresh",
      {
        input: { profileId, environment: "test", allowRepair: false, deadlineAt: now + 9_000 },
        inDeadline: true,
        canContinue: true,
      },
      { checked: true },
    );
    expect(
      "stripe:refresh",
      {
        input: { profileId, environment: "test", deadlineAt: now + 9_000 },
        inDeadline: true,
        canContinue: true,
      },
      { checked: true },
    );
    expectFacts();
  }
  for (const [table, filters, row] of [
    ["booking_services", [...tenant, ["eq", "active", true]], service],
    ["availability_schedules", [...tenant, ["eq", "active", true]], schedule],
    ["calendar_connections", [...tenant, ["eq", "health_state", "healthy"]], connection],
    ["stripe_connected_accounts", [...tenant, ["eq", "onboarding_state", "ready"]], account],
  ])
    query(table, "*", filters, ok(row), "single");
}

function expectAvailability(busy = []) {
  const timeMin = "2026-09-11T00:00:00.000Z";
  const timeMax = "2026-09-13T00:00:00.000Z";
  query(
    "availability_intervals",
    "weekday,local_start,local_end",
    [["eq", "schedule_id", schedule.id]],
    ok([{ weekday: 5, local_start: "10:00", local_end: "11:00" }]),
    null,
  );
  query(
    "availability_overrides",
    "id,local_date,override_type,availability_override_intervals(local_start,local_end)",
    [
      ["eq", "schedule_id", schedule.id],
      ["gte", "local_date", data.localDate],
    ],
    ok([]),
    null,
  );
  query(
    "calendar_selections",
    "google_calendar_id",
    [
      ["eq", "connection_id", connection.id],
      ["eq", "active", true],
      ["eq", "blocks_availability", true],
    ],
    ok([{ google_calendar_id: "primary" }]),
    null,
  );
  query(
    "appointments",
    "start_at,end_at,buffer_before_minutes,buffer_after_minutes",
    [
      ...tenant,
      ["in", "appointment_state", ["held", "payment_pending", "confirmed"]],
      ["gte", "end_at", timeMin],
      ["lte", "start_at", timeMax],
    ],
    ok([]),
    null,
  );
  const cacheKey = createHash("sha256")
    .update(
      [
        profileId,
        "test",
        connection.pipedream_account_id,
        String(connection.availability_generation),
        calendarSetHash,
        String(schedule.revision),
        String(service.revision),
        timeMin,
        timeMax,
      ].join("|"),
    )
    .digest("hex");
  query(
    "booking_availability_cache",
    "busy_ranges,observed_at,expires_at",
    [
      ["eq", "cache_key", cacheKey],
      ["gt", "expires_at", new Date(now).toISOString()],
    ],
    ok({
      busy_ranges: busy,
      observed_at: observedAt,
      expires_at: new Date(now + 60_000).toISOString(),
    }),
  );
}

function handoffCookie(expiresAt) {
  const maxAge = Math.ceil((expiresAt + 5 * 60_000 - now) / 1000);
  return `${cookieName("handoff", publicReference)}=${capability}; Max-Age=${maxAge}; Path=/booking/return; SameSite=lax; HttpOnly; Secure`;
}

async function run(name, body) {
  process.env = { ...env };
  Object.assign(state, {
    expected: [],
    unexpected: [],
    calls: [],
    pending: 0,
    leaseToken: null,
    request: new Request("https://app.example.test", {
      headers: {
        "cf-connecting-ip": clientIp,
        cookie: `${requestCookieName}=${capability}`,
      },
    }),
  });
  await body();
  assert.deepEqual(state.unexpected, [], "caught mock assertions must still fail");
  assert.equal(state.expected.length, 0, "every planned operation must run");
  assert.equal(state.pending, 0, "DB queries must be awaited exactly once");
  assert.equal(networkCalls, 0, "no real provider or database requests");
  passed++;
  console.log(`PASS: ${name}`);
}

try {
  globalThis.__bookingCheckoutReplayTest = state;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Unexpected network request");
  };
  bundle = await importWithMocks(path.resolve("src/lib/booking-live.functions.ts"), {
    "@tanstack/react-start": `
      export function createServerFn() {
        return { validator(validate) {
          return { handler(handle) { return async ({ data }) => handle({ data: validate(data) }); } };
        } };
      }
    `,
    "@tanstack/react-start/server": `
      export const getRequest = () => globalThis.__bookingCheckoutReplayTest.request;
      export const setResponseHeader = (...args) => globalThis.__bookingCheckoutReplayTest.take('header', args);
    `,
    "@/integrations/supabase/client.server":
      "export const supabaseAdmin = globalThis.__bookingCheckoutReplayTest.db;",
    "@/lib/stripe.server": `
      export { billingEnvironment, publicAppUrl } from ${JSON.stringify(path.resolve("src/lib/stripe.server.ts"))};
      export const getStripe = () => globalThis.__bookingCheckoutReplayTest.stripe;
    `,
    "@/lib/pipedream.server":
      "export const getGoogleCalendarBusyRanges = async (input) => globalThis.__bookingCheckoutReplayTest.take('freebusy', input);",
    "@/lib/pipedream-trigger-reconciliation.server": `
      import { hasWorkerDeadline, workerCanContinue } from '@/lib/worker-deadline.server';
      export const refreshSavedGoogleCalendar = async (input) => globalThis.__bookingCheckoutReplayTest.take('google:refresh', {
        input, inDeadline: hasWorkerDeadline(), canContinue: workerCanContinue(),
      });
    `,
    "@/lib/stripe-connect-inbox-worker.server": `
      import { hasWorkerDeadline, workerCanContinue } from '@/lib/worker-deadline.server';
      export const refreshSavedStripeConnectAccount = async (input) => globalThis.__bookingCheckoutReplayTest.take('stripe:refresh', {
        input, inDeadline: hasWorkerDeadline(), canContinue: workerCanContinue(),
      });
    `,
    "@/lib/booking-attachments.functions": `
      export const getBookingAttachmentCapability = async () => globalThis.__bookingCheckoutReplayTest.take('attachment-capability', []);
      export const uploadPreparedBookingAttachments = async (input) => globalThis.__bookingCheckoutReplayTest.take('attachment-upload', input);
    `,
  });
  // Freeze both Date.now and new Date so the real slot builder and cache expiry use one clock.
  globalThis.Date = class extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  };
  const checkout = (value = data) => bundle.subject.createLiveBookingCheckout({ data: value });
  const slots = () =>
    bundle.subject.getLiveBookingSlots({
      data: { websiteId, fromDate: data.localDate, dayCount: 1 },
    });

  await run(
    "real validation, browser capability and request identity reject before replay recovery",
    async () => {
      for (const invalid of [
        { websiteId: "not-a-uuid" },
        { requestId: "not-a-uuid" },
        { consent: { ...data.consent, accepted: false } },
        { consent: { ...data.consent, digest: "wrong" } },
        { customer: { ...data.customer, email: "not-an-email" } },
        { customer: { ...data.customer, fullName: "x" } },
        { customer: { ...data.customer, phone: "123" } },
        { customer: { ...data.customer, notes: "x".repeat(2001) } },
        { availabilityGeneration: -1 },
      ])
        await assert.rejects(() => checkout({ ...data, ...invalid }), { name: "ZodError" });
      assert.equal(state.calls.length, 0);

      state.request.headers.delete("cookie");
      expectIdentity();
      await assert.rejects(checkout, /Refresh available booking times/);
      state.request.headers.set("cookie", `${requestCookieName}=another-browser`);
      expectLookup(replay);
      await assert.rejects(checkout, /belongs to another browser/);
      state.request.headers.set("cookie", `${requestCookieName}=${capability}`);
      expectLookup(replay);
      await assert.rejects(
        () => checkout({ ...data, customer: { ...data.customer, notes: "Changed booking" } }),
        /identity conflict/,
      );
      assert.ok(state.calls.every(({ kind }) => kind === "query"));
    },
  );

  await run(
    "valid replay survives disabled/draining admission and absent current settings",
    async () => {
      // No current service, schedule, selection, entitlement or provider snapshot is available to this DB mock.
      // Any loadLiveBookingSettings call therefore fails, even if its error would otherwise be swallowed.
      for (const overrides of [
        { BOOKING_LIVE_ENABLED: "false" },
        { BOOKING_WORKER_MODE: "drain" },
        { BOOKING_WORKER_MODE: "off", BOOKING_LIVE_ENABLED: "false" },
        {
          BOOKING_LIVE_ENABLED: "false",
          BOOKING_WORKER_MODE: "drain",
          BOOKING_WORKER_ENVIRONMENT: "live",
        },
      ]) {
        process.env = { ...env, ...overrides };
        expectLookup(replay);
        expectReplayDetails();
        expectRetrieve();
        expect(
          "rpc",
          [
            "recover_booking_checkout_handoff_v3",
            {
              p_appointment_id: appointmentId,
              p_nonce_hash: hash(capability),
            },
          ],
          ok(true),
        );
        expect("header", ["Set-Cookie", handoffCookie(session.expires_at * 1000)]);
        assert.deepEqual(
          await checkout({
            ...data,
            attachments: { ignored: "optional bytes never participate in replay identity" },
            customer: { ...data.customer, fullName: ` ${data.customer.fullName} ` },
            ignored: "stripped by schema",
          }),
          {
            status: "checkout_ready",
            checkoutUrl: session.url,
            expiresAt: new Date(session.expires_at * 1000).toISOString(),
          },
        );
      }
      assert.ok(
        state.calls
          .filter(({ kind }) => kind === "query")
          .every(({ args }) =>
            ["websites", "appointment_operations", "booking_payments", "appointments"].includes(
              args[0][1],
            ),
          ),
      );
      assert.equal(state.calls.filter(({ kind }) => kind === "stripe:retrieve").length, 4);
      assert.ok(
        state.calls
          .filter(({ kind }) => kind === "rpc")
          .every(({ args }) => args[0] === "recover_booking_checkout_handoff_v3"),
      );
    },
  );

  await run(
    "unstarted admitted holds require a servicing mode before claim or handoff",
    async () => {
      for (const overrides of [
        { BOOKING_WORKER_MODE: "off", BOOKING_LIVE_ENABLED: "false" },
        { BOOKING_WORKER_MODE: "" },
        { BOOKING_WORKER_MODE: "invalid" },
        { BOOKING_WORKER_MODE: "drain", BOOKING_WORKER_ENVIRONMENT: "live" },
        { BOOKING_WORKER_MODE: "active", BOOKING_WORKER_ENVIRONMENT: "" },
      ]) {
        process.env = { ...env, ...overrides };
        expectLookup(replay);
        expectReplayDetails(unstartedPayment, heldAppointment);
        await assert.rejects(checkout, /temporarily unavailable/);
      }
      assert.ok(state.calls.every(({ kind }) => kind === "query"));
      for (const mode of ["active", "drain"]) {
        process.env = { ...env, BOOKING_LIVE_ENABLED: "false", BOOKING_WORKER_MODE: mode };
        expectLookup(replay);
        expectReplayDetails(unstartedPayment, heldAppointment);
        expect("rpc", ([name]) => assert.equal(name, "claim_booking_checkout"), ok(null));
        await assert.rejects(checkout, /Unable to create checkout/);
      }
    },
  );

  await run("failed or expired replay never falls through to a new reservation", async () => {
    expectLookup(null, { code: "57014" });
    await assert.rejects(checkout, /Unable to read booking request/);
    for (const [payment, appointment] of [
      [null, reservedAppointment],
      [{ ...priorPayment, checkout_session_id: null }, reservedAppointment],
      [{ ...priorPayment, stripe_account_id: null }, reservedAppointment],
      [priorPayment, null],
    ]) {
      expectLookup(replay);
      expectReplayDetails(payment, appointment);
      await assert.rejects(checkout, /being reconciled or is no longer payable/);
    }
    for (const prior of [
      { ...session, status: "complete" },
      { ...session, status: "expired" },
      { ...session, url: null },
      { ...session, expires_at: now / 1000 },
      { ...session, expires_at: now / 1000 - 1 },
      new Error("Fixture Stripe unavailable"),
    ]) {
      expectLookup(replay);
      expectReplayDetails();
      expectRetrieve(prior);
      await assert.rejects(
        checkout,
        prior instanceof Error
          ? /Fixture Stripe unavailable/
          : /being reconciled or is no longer payable/,
      );
    }
    for (const recovered of [ok(false), ok(null), { data: null, error: { code: "40001" } }]) {
      expectLookup(replay);
      expectReplayDetails();
      expectRetrieve();
      expect(
        "rpc",
        [
          "recover_booking_checkout_handoff_v3",
          { p_appointment_id: appointmentId, p_nonce_hash: hash(capability) },
        ],
        recovered,
      );
      await assert.rejects(checkout, /handoff cannot be recovered/);
    }
    assert.ok(
      state.calls.every(
        ({ kind }) =>
          !["google:refresh", "stripe:refresh", "stripe:create", "header"].includes(kind),
      ),
    );
    assert.ok(
      state.calls
        .filter(({ kind }) => kind === "rpc")
        .every(({ args }) => args[0] === "recover_booking_checkout_handoff_v3"),
    );
  });

  await run(
    "pre-dispatch continuation rejects terminal, unowned, unbound and cross-scope records",
    async () => {
      for (const patch of [
        { payment_state: "failed" },
        { payment_state: "paid" },
        { payment_state: "disputed" },
        { profile_id: "other-profile" },
        { environment: "live" },
        { appointment_id: websiteId },
        { booking_contract_version: 1 },
        { checkout_operation_id: websiteId },
        { checkout_idempotency_key: null },
        { stripe_account_id: null },
        { checkout_provider_expires_at: freshAt },
        { confirmation_handoff_expires_at: freshAt },
        { confirmation_nonce_hash: hash(capability) },
        { payment_intent_id: "pi_fixture" },
        { charge_id: "ch_fixture" },
        { checkout_lease_expires_at: new Date(now + 120_000).toISOString() },
        { expected_amount_minor: service.amount_minor + 1 },
        { currency: "EUR" },
      ]) {
        expectLookup(replay);
        expectReplayDetails({ ...unstartedPayment, ...patch }, heldAppointment);
        await assert.rejects(checkout, /being reconciled or is no longer payable/);
      }
      for (const patch of [
        { id: websiteId },
        { website_id: profileId },
        { profile_id: websiteId },
        { environment: "live" },
        { booking_contract_version: 1 },
        { appointment_state: "confirmed" },
        { appointment_state: "cancelled" },
        { cancellation_requested_at: freshAt },
        { calendar_destination_epoch_id: null },
        { reservation_expires_at: null },
        { reservation_expires_at: new Date(now).toISOString() },
        { reservation_expires_at: "invalid" },
        { payment_state: "creating" },
      ]) {
        expectLookup(replay);
        expectReplayDetails(unstartedPayment, { ...heldAppointment, ...patch });
        await assert.rejects(checkout, /being reconciled or is no longer payable/);
      }
      assert.ok(
        state.calls.every(({ kind }) => kind === "query"),
        "no claim, upload or provider effect before existing authority is validated",
      );
    },
  );

  await run("a concurrent completed checkout is recovered, never dispatched again", async () => {
    expectLookup(replay);
    expectReplayDetails(unstartedPayment, heldAppointment);
    expect(
      "rpc",
      ([name, args]) => {
        assert.equal(name, "claim_booking_checkout");
        assert.equal(args.p_operation_id, operationId);
        assert.equal(args.p_appointment_id, appointmentId);
      },
      ok(priorPayment),
    );
    expectRetrieve();
    expect(
      "rpc",
      [
        "recover_booking_checkout_handoff_v3",
        { p_appointment_id: appointmentId, p_nonce_hash: hash(capability) },
      ],
      ok(true),
    );
    expect("header", ["Set-Cookie", handoffCookie(session.expires_at * 1000)]);
    assert.deepEqual(await checkout(), {
      status: "checkout_ready",
      checkoutUrl: session.url,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
    });
    assert.ok(
      state.calls.every(
        ({ kind, args }) =>
          kind !== "stripe:create" && (kind !== "rpc" || args[0] !== "reserve_live_booking"),
      ),
    );
  });

  await run(
    "indeterminate, expired or changed checkout claims never authorize dispatch",
    async () => {
      for (const patch of [
        { id: websiteId },
        { appointment_id: websiteId },
        { profile_id: websiteId },
        { environment: "live" },
        { booking_contract_version: 1 },
        { checkout_operation_id: websiteId },
        { stripe_account_id: "acct_replacement" },
        { checkout_idempotency_key: "replacement-operation" },
        { expected_amount_minor: 99999 },
        { currency: "EUR" },
        { payment_state: "paid" },
        { checkout_lease_token: null },
        { checkout_lease_expires_at: new Date(now).toISOString() },
        { checkout_fencing_token: 0 },
        { checkout_provider_expires_at: freshAt },
        { confirmation_handoff_expires_at: freshAt },
        { confirmation_nonce_hash: hash(capability) },
      ]) {
        expectLookup(replay);
        expectReplayDetails(unstartedPayment, heldAppointment);
        expect(
          "rpc",
          ([name, args]) => {
            assert.equal(name, "claim_booking_checkout");
            state.leaseToken = args.p_lease_token;
          },
          () =>
            ok({
              ...unstartedPayment,
              payment_state: "creating",
              checkout_lease_token: state.leaseToken,
              checkout_lease_expires_at: new Date(now + 120_000).toISOString(),
              checkout_fencing_token: 1,
              ...patch,
            }),
        );
        await assert.rejects(checkout, /being reconciled or is no longer payable/);
      }
      for (const claim of [ok(null), { data: null, error: { code: "57014" } }]) {
        expectLookup(replay);
        expectReplayDetails(unstartedPayment, heldAppointment);
        expect("rpc", ([name]) => assert.equal(name, "claim_booking_checkout"), claim);
        await assert.rejects(checkout, /Unable to create checkout/);
      }
      assert.ok(
        state.calls.every(
          ({ kind }) =>
            !["header", "stripe:create", "stripe:retrieve", "attachment-upload"].includes(kind),
        ),
      );
    },
  );

  await run(
    "new requests enforce deployment, trusted-client and rate gates before readiness refresh",
    async () => {
      for (const overrides of [
        { BOOKING_LIVE_ENABLED: "false" },
        { BOOKING_WORKER_MODE: "drain" },
        { BOOKING_WORKER_ENVIRONMENT: "live" },
        { BOOKING_WORKER_ENVIRONMENT: "" },
      ]) {
        process.env = { ...env, ...overrides };
        expectLookup(null);
        assert.deepEqual(await checkout(), {
          status: "not_attempted",
          code: "booking_unavailable",
        });
      }
      for (const overrides of [
        { STRIPE_SECRET_KEY: "sk_live_public_fixture", SAAS_BILLING_ENVIRONMENT: "live" },
        { STRIPE_SECRET_KEY: "sk_live_public_fixture" },
        { STRIPE_SECRET_KEY: "invalid" },
        { SAAS_BILLING_ENVIRONMENT: "" },
      ]) {
        process.env = { ...env, ...overrides };
        expectIdentity();
        await assert.rejects(checkout, /Stripe.*mode|SAAS_BILLING_ENVIRONMENT/);
      }
      process.env = { ...env, BOOKING_CONFIRMATION_SECRET: "" };
      expectIdentity();
      await assert.rejects(checkout, /Booking confirmation is unavailable/);
      process.env = { ...env, BOOKING_RATE_LIMIT_SECRET: "" };
      await assert.rejects(checkout, /temporarily unavailable/);
      process.env = { ...env };
      state.request.headers.delete("cf-connecting-ip");
      await assert.rejects(checkout, /temporarily unavailable/);
      state.request.headers.set("cf-connecting-ip", clientIp);
      for (const denied of [
        { data: false, error: null },
        { data: null, error: null },
        { data: null, error: { code: "P0001", message: "booking rate limit exceeded" } },
        new Error("Fixture rate store unavailable"),
      ]) {
        expectLookup(null);
        expect("rpc", rateArgs, denied);
        assert.deepEqual(await checkout(), {
          status: "not_attempted",
          code: "booking_unavailable",
        });
        expect("rpc", rateArgs, denied);
        await assert.rejects(slots, /temporarily unavailable|Fixture rate store unavailable/);
      }
      // A tenant's cutover denial also prevents refresh after the client rate gate passes.
      expectLookup(null);
      expect("rpc", rateArgs, ok(true));
      query(
        "websites",
        "id,user_id,environment,status,active_version_id",
        [["eq", "id", websiteId]],
        ok(website),
        "single",
      );
      expectFacts(true);
      expect(
        "rpc",
        ["booking_cutover_enabled", { p_profile_id: profileId, p_environment: "test" }],
        ok(false),
      );
      assert.deepEqual(await checkout(), { status: "not_attempted", code: "booking_unavailable" });
      assert.ok(
        state.calls.every(
          ({ kind }) =>
            !["google:refresh", "stripe:refresh", "stripe:create", "freebusy", "header"].includes(
              kind,
            ),
        ),
      );
    },
  );

  await run(
    "fresh slots and checkout stop before FreeBusy for paused, mixed, draft and cutover-denied admission",
    async () => {
      const expectSlotStart = () => {
        expect("rpc", rateArgs, ok(true));
        expect("header", [
          "Set-Cookie",
          `${requestCookieName}=${capability}; Max-Age=86400; Path=/; SameSite=lax; HttpOnly; Secure`,
        ]);
      };
      for (const overrides of [
        { BOOKING_LIVE_ENABLED: "false" },
        { BOOKING_WORKER_MODE: "off" },
        { BOOKING_WORKER_MODE: "drain" },
      ]) {
        process.env = { ...env, ...overrides };
        await assert.rejects(slots, /temporarily unavailable/);
      }
      for (const workerEnvironment of ["live", ""]) {
        process.env = { ...env, BOOKING_WORKER_ENVIRONMENT: workerEnvironment };
        expectSlotStart();
        query(
          "websites",
          "id,user_id,environment,status,active_version_id",
          [["eq", "id", websiteId]],
          ok(website),
          "single",
        );
        expectFacts();
        await assert.rejects(slots, /Booking is unavailable/);
      }
      process.env = {
        ...env,
        STRIPE_SECRET_KEY: "sk_live_public_fixture",
        SAAS_BILLING_ENVIRONMENT: "live",
      };
      expectSlotStart();
      query(
        "websites",
        "id,user_id,environment,status,active_version_id",
        [["eq", "id", websiteId]],
        ok(website),
        "single",
      );
      expectFacts();
      await assert.rejects(slots, /Booking is unavailable/);
      process.env = { ...env };
      for (const patch of [
        { status: "draft" },
        { active_version_id: null },
        { environment: "mixed" },
      ]) {
        expectSlotStart();
        query(
          "websites",
          "id,user_id,environment,status,active_version_id",
          [["eq", "id", websiteId]],
          ok({ ...website, ...patch }),
          "single",
        );
        await assert.rejects(slots, /Booking is unavailable/);
      }
      for (const entitlementPatch of [
        { effective_at: null },
        { effective_at: new Date(now + 1).toISOString() },
        { ends_at: new Date(now).toISOString() },
        { state: "expired" },
        { plan: "starter" },
        { order_confirmed_at: null },
        { booking_admission: false },
      ]) {
        expectSlotStart();
        query(
          "websites",
          "id,user_id,environment,status,active_version_id",
          [["eq", "id", websiteId]],
          ok(website),
          "single",
        );
        expectFacts(false, entitlementPatch);
        await assert.rejects(slots, /Booking is unavailable/);
        expectLookup(null);
        expect("rpc", rateArgs, ok(true));
        query(
          "websites",
          "id,user_id,environment,status,active_version_id",
          [["eq", "id", websiteId]],
          ok(website),
          "single",
        );
        expectFacts(false, entitlementPatch);
        assert.deepEqual(await checkout(), {
          status: "not_attempted",
          code: "booking_unavailable",
        });
      }
      expectSlotStart();
      expectSettings(false, false);
      await assert.rejects(slots, /Booking is unavailable/);
      expectLookup(null);
      expect("rpc", rateArgs, ok(true));
      expectSettings(false, false);
      assert.deepEqual(await checkout(), { status: "not_attempted", code: "booking_unavailable" });
      assert.ok(
        state.calls.every(
          ({ kind }) =>
            !["freebusy", "stripe:create", "google:refresh", "stripe:refresh"].includes(kind),
        ),
      );
      assert.ok(
        state.calls
          .filter(({ kind }) => kind === "query")
          .every(
            ({ args }) =>
              !["booking_availability_cache", "availability_overrides"].includes(args[0][1]),
          ),
      );
    },
  );

  await run(
    "slots and new checkout reuse one verified settings snapshot with real admission constraints",
    async () => {
      expect("rpc", rateArgs, ok(true));
      expect("header", [
        "Set-Cookie",
        `${requestCookieName}=${capability}; Max-Age=86400; Path=/; SameSite=lax; HttpOnly; Secure`,
      ]);
      expectSettings(true);
      expectAvailability();
      const available = await slots();
      assert.deepEqual(available, {
        slots: [
          {
            startAt: data.startAt,
            endAt: "2026-09-11T11:00:00.000Z",
            localDate: data.localDate,
            localStart: data.localStart,
          },
        ],
        observedAt,
        availabilityGeneration: connection.availability_generation,
        calendarSetHash,
        service: {
          name: service.name,
          amountMinor: service.amount_minor,
          currency: service.currency,
          durationMinutes: service.duration_minutes,
        },
        timeZone: "UTC",
      });
      const checkoutStart = state.calls.length;
      expectLookup(null);
      expect("rpc", rateArgs, ok(true));
      expectSettings(true);
      expectAvailability();
      expect("rpc", reserveArgs, ok({ appointmentId }));
      expectReplayDetails(unstartedPayment, heldAppointment);
      query(
        "appointment_operations",
        "id,appointment_id,request_hash,request_capability_hash",
        [
          ["eq", "appointment_id", appointmentId],
          ...tenant,
          ["eq", "operation_type", "reserve"],
          ["eq", "client_request_id", data.requestId],
        ],
        ok(replay),
        "single",
      );
      const payment = {
        ...unstartedPayment,
        payment_state: "creating",
        checkout_fencing_token: 11,
        checkout_lease_expires_at: new Date(now + 120_000).toISOString(),
      };
      expect(
        "rpc",
        ([name, args]) => {
          assert.equal(name, "claim_booking_checkout");
          assert.match(
            args.p_lease_token,
            /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
          );
          state.leaseToken = args.p_lease_token;
          payment.checkout_lease_token = state.leaseToken;
          assert.deepEqual(args, {
            p_appointment_id: appointmentId,
            p_operation_id: operationId,
            p_lease_token: state.leaseToken,
          });
        },
        () => ok(payment),
      );
      const providerExpiresAt = new Date(now + 31 * 60_000).toISOString();
      const handoffExpiresAt = new Date(now + 36 * 60_000).toISOString();
      expect(
        "rpc",
        (args) =>
          assert.deepEqual(args, [
            "prepare_booking_checkout_handoff_v3",
            {
              p_payment_id: payment.id,
              p_lease_token: state.leaseToken,
              p_fencing_token: payment.checkout_fencing_token,
              p_provider_expires_at: providerExpiresAt,
              p_handoff_expires_at: handoffExpiresAt,
              p_nonce_hash: hash(capability),
            },
          ]),
        ok({ providerExpiresAt, handoffExpiresAt }),
      );
      expect("header", ["Set-Cookie", [handoffCookie(Date.parse(providerExpiresAt))]]);
      const created = {
        ...session,
        id: "cs_fixture_new",
        url: "https://checkout.stripe.com/c/pay/cs_fixture_new",
        expires_at: Date.parse(providerExpiresAt) / 1000,
      };
      expect(
        "stripe:create",
        [
          {
            mode: "payment",
            payment_method_types: ["card"],
            customer_email: data.customer.email,
            line_items: [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: payment.expected_amount_minor,
                  product_data: { name: service.name },
                },
                quantity: 1,
              },
            ],
            metadata: { kind: "booking", appointmentId, profileId, environment: "test" },
            payment_intent_data: { metadata: { kind: "booking", appointmentId } },
            success_url: "https://app.example.test/booking/return?session_id={CHECKOUT_SESSION_ID}",
            cancel_url: `https://app.example.test/lp/${websiteId}?booking=cancelled`,
            expires_at: created.expires_at,
          },
          {
            stripeAccount: payment.stripe_account_id,
            idempotencyKey: payment.checkout_idempotency_key,
          },
        ],
        created,
      );
      expect(
        "rpc",
        (args) =>
          assert.deepEqual(args, [
            "settle_booking_checkout",
            {
              p_payment_id: payment.id,
              p_lease_token: state.leaseToken,
              p_fencing_token: payment.checkout_fencing_token,
              p_session_id: created.id,
              p_expires_at: providerExpiresAt,
              p_succeeded: true,
              p_ambiguous: false,
              p_safe_error: null,
            },
          ]),
        () => ok({ ...payment, checkout_session_id: created.id, payment_state: "pending" }),
      );
      assert.deepEqual(await checkout(), {
        status: "checkout_ready",
        checkoutUrl: created.url,
        expiresAt: providerExpiresAt,
      });
      for (const calls of [state.calls.slice(0, checkoutStart), state.calls.slice(checkoutStart)]) {
        assert.equal(calls.filter(({ kind }) => kind === "google:refresh").length, 1);
        assert.equal(calls.filter(({ kind }) => kind === "stripe:refresh").length, 1);
        assert.equal(
          calls.filter(
            ({ kind, args }) =>
              kind === "query" &&
              args[0][1] === "websites" &&
              args[1][1].includes("active_version_id"),
          ).length,
          1,
          "settings are loaded once, not again by slot verification",
        );
        assert.equal(
          calls.filter(
            ({ kind, args }) => kind === "query" && args[0][1] === "website_entitlements",
          ).length,
          2,
          "one original fact read and one persisted reread, no duplicate verification",
        );
      }
    },
  );

  await run(
    "new checkout still rejects occupied slots, wrong cutover and failed reservation",
    async () => {
      expectLookup(null);
      expect("rpc", rateArgs, ok(true));
      expectSettings();
      expectAvailability([{ start: data.startAt, end: "2026-09-11T11:00:00.000Z" }]);
      assert.deepEqual(await checkout(), { status: "not_attempted", code: "slot_unavailable" });
      expectLookup(null);
      expect("rpc", rateArgs, ok(true));
      expectSettings(false, false);
      assert.deepEqual(await checkout(), { status: "not_attempted", code: "booking_unavailable" });
      for (const reservation of [
        { data: null, error: { code: "23P01" } },
        { data: null, error: { code: "57014" } },
        { data: null, error: { code: "40001" } },
        new Error("Fixture reservation response lost"),
        { data: null, error: null },
        { data: {}, error: null },
        { data: true, error: null },
      ]) {
        expectLookup(null);
        expect("rpc", rateArgs, ok(true));
        expectSettings();
        expectAvailability();
        expect("rpc", reserveArgs, reservation);
        await assert.rejects(
          checkout,
          /Unable to reserve that time|Fixture reservation response lost/,
        );
      }
      assert.ok(
        state.calls.every(
          ({ kind }) =>
            !["google:refresh", "stripe:refresh", "stripe:create", "header"].includes(kind),
        ),
      );
    },
  );
  console.log(
    `test-booking-checkout-replay: ${passed} scenarios passed (real checkout/readiness/slots; no network)`,
  );
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  globalThis.Date = OriginalDate;
  delete globalThis.__bookingCheckoutReplayTest;
  if (bundle) await bundle.cleanup();
}
