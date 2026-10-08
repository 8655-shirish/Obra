import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { build, transform } from "esbuild";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const reference = "40000000-0000-4000-8000-000000000004";
const checkoutSessionId = "cs_fixture_receipt";
const secret = "fixture-confirmation-secret-only";
const token = createHmac("sha256", secret)
  .update(`booking-confirmation:test:${checkoutSessionId}`)
  .digest("base64url");
const cookieSuffix = createHmac("sha256", secret)
  .update(`booking-cookie:receipt:${reference}`)
  .digest("hex")
  .slice(0, 24);
const expectedCall = [
  "consume_booking_confirmation_capability_v3",
  { p_token_hash: createHash("sha256").update(token).digest("hex"), p_reference: reference },
];
const projection = {
  reference,
  environment: "test",
  checkoutSessionId,
  startAt: "2026-09-11T10:00:00.000Z",
  endAt: "2026-09-11T11:00:00.000Z",
  timeZone: "UTC",
  appointmentState: "confirmed",
  appointmentReason: null,
  paymentState: "paid",
  refundState: "not_requested",
  calendarState: "create_failed",
  reviewState: "unresolved_destination",
  reservationExpiresAt: null,
  confirmedAt: "2026-09-10T08:00:00.000Z",
  cancelledAt: null,
  updatedAt: "2026-09-10T08:00:00.000Z",
  statusCode: "confirmed_calendar_failed",
  terminal: true,
  pollAfterMs: null,
  automaticPollUntil: null,
};
const state = {
  request: new Request(`https://app.example.test/booking/confirmation?reference=${reference}`, {
    headers: { cookie: `obra_booking_receipt_${cookieSuffix}=${token}` },
  }),
  projection,
  calls: [],
  db: {
    async rpc(...args) {
      state.calls.push(args);
      assert.deepEqual(args, expectedCall);
      return { data: structuredClone(state.projection), error: null };
    },
  },
};
let bundle;
let networkCalls = 0;

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function verifyCheckoutReceiptHandoff(failure = null, throughDialog = false) {
  const now = Date.now();
  const verifiedAt = new Date(now - 60_000).toISOString();
  const localDate = new Date(now + 86_400_000).toISOString().slice(0, 10);
  const websiteId = "10000000-0000-4000-8000-000000000001";
  const profileId = "20000000-0000-4000-8000-000000000002";
  const appointmentId = "30000000-0000-4000-8000-000000000003";
  const operationId = "50000000-0000-4000-8000-000000000005";
  const paymentId = "70000000-0000-4000-8000-000000000007";
  const destinationId = "80000000-0000-4000-8000-000000000008";
  const rawHash = (value) => createHash("sha256").update(value).digest("hex");
  const rows = {
    websites: [
      {
        id: websiteId,
        user_id: profileId,
        environment: "test",
        status: "live",
        active_version_id: "live-version",
      },
    ],
    website_entitlements: [
      {
        website_id: websiteId,
        profile_id: profileId,
        environment: "test",
        plan: "pro",
        state: "active",
        quote_admission: true,
        booking_admission: true,
        order_confirmed_at: verifiedAt,
        effective_at: verifiedAt,
        ends_at: null,
      },
    ],
    booking_services: [
      {
        id: "service",
        profile_id: profileId,
        environment: "test",
        active: true,
        revision: 1,
        name: "Reserved visit",
        amount_minor: 12300,
        currency: "USD",
        duration_minutes: 60,
        slot_interval_minutes: 60,
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        minimum_notice_minutes: 0,
        booking_horizon_days: 30,
      },
    ],
    availability_schedules: [
      {
        id: "schedule",
        profile_id: profileId,
        environment: "test",
        service_id: "service",
        active: true,
        revision: 1,
        time_zone: "UTC",
      },
    ],
    availability_intervals: Array.from({ length: 7 }, (_, weekday) => ({
      id: `interval-${weekday}`,
      profile_id: profileId,
      environment: "test",
      schedule_id: "schedule",
      weekday,
      local_start: "10:00",
      local_end: "11:00",
    })),
    availability_overrides: [],
    calendar_connections: [
      {
        id: "connection",
        connection_revision: 7,
        profile_id: profileId,
        environment: "test",
        pipedream_account_id: "apn_reserved",
        health_state: "healthy",
        last_verified_at: verifiedAt,
        verification_reason: null,
        reconnect_reason: null,
        account_email: "owner@example.test",
        availability_generation: 1,
      },
    ],
    calendar_selections: [
      {
        profile_id: profileId,
        environment: "test",
        connection_id: "connection",
        active: true,
        blocks_availability: true,
        receives_bookings: true,
        google_calendar_id: "reserved-calendar",
        access_role: "owner",
        permission_verified_at: verifiedAt,
      },
    ],
    pipedream_bindings: [
      {
        profile_id: profileId,
        environment: "test",
        connection_id: "connection",
        pipedream_account_id: "apn_reserved",
        trigger_state: "active",
        last_health_at: verifiedAt,
        reconciliation_due_at: null,
      },
    ],
    stripe_connected_accounts: [
      {
        profile_id: profileId,
        environment: "test",
        stripe_account_id: "acct_reserved",
        onboarding_state: "ready",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        capabilities: { card_payments: "active" },
        requirements: { currently_due: [], past_due: [], pending_verification: [] },
        last_verified_at: verifiedAt,
      },
    ],
    booking_cutover_state: [
      { profile_id: profileId, environment: "test", status: "enabled", target_contract_version: 2 },
    ],
    booking_availability_cache: [],
    appointments: [],
    appointment_operations: [],
    booking_payments: [],
  };
  const journey = {
    request: new Request("https://app.example.test", {
      headers: { "cf-connecting-ip": "203.0.113.20" },
    }),
    headers: new Map(),
    calls: [],
    unexpected: [],
    pending: 0,
    session: null,
    receipt: null,
    injected: false,
  };
  const reservationStarted = deferred(),
    releaseReservation = deferred();
  const check = (body) => {
    try {
      return body();
    } catch (error) {
      journey.unexpected.push(error.message);
      throw error;
    }
  };
  const loseResponse = (boundary) => {
    if (failure !== boundary || journey.injected) return false;
    journey.injected = true;
    return true;
  };
  const ok = (data) => ({ data: structuredClone(data), error: null });
  journey.db = {
    from(table) {
      check(() => assert.ok(Object.hasOwn(rows, table), `Unexpected table ${table}`));
      journey.pending++;
      let awaited = false;
      const filters = [];
      let columns = "*",
        options = {},
        single = false;
      const query = {
        select(value, nextOptions = {}) {
          columns = value;
          options = nextOptions;
          return query;
        },
        single() {
          single = true;
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        abortSignal(value) {
          check(() => assert.ok(value instanceof AbortSignal && !value.aborted));
          return query;
        },
        then(resolve, reject) {
          journey.pending--;
          check(() => assert.equal(awaited, false, "Query must be awaited exactly once"));
          awaited = true;
          return Promise.resolve()
            .then(() => {
              journey.calls.push({ kind: "query", table, columns, filters });
              if (
                table === "appointments" &&
                rows.appointments.length &&
                loseResponse("before_claim")
              )
                throw new Error("Fixture interrupted before claim");
              const matches = rows[table].filter((row) =>
                filters.every(([method, key, value]) => {
                  if (method === "eq") return row[key] === value;
                  if (method === "in") return value.includes(row[key]);
                  if (method === "gt") return row[key] > value;
                  if (method === "gte") return row[key] >= value;
                  return row[key] <= value;
                }),
              );
              const selected = matches.map((row) =>
                columns === "*"
                  ? row
                  : Object.fromEntries(columns.split(",").map((key) => [key, row[key]])),
              );
              return {
                ...ok(options.head ? null : single ? (selected[0] ?? null) : selected),
                count: matches.length,
              };
            })
            .then(resolve, reject);
        },
      };
      for (const method of ["eq", "gt", "gte", "lte", "in"])
        query[method] = (key, value) => {
          filters.push([method, key, value]);
          return query;
        };
      return query;
    },
    rpc(name, args) {
      journey.pending++;
      let awaited = false;
      let signal;
      const query = {
        abortSignal(value) {
          check(() => assert.ok(value instanceof AbortSignal && !value.aborted));
          signal = value;
          return query;
        },
        then(resolve, reject) {
          journey.pending--;
          check(() => {
            assert.equal(awaited, false, "RPC must be awaited exactly once");
            assert.equal(Boolean(signal), name === "get_pending_google_calendar_setup");
          });
          awaited = true;
          return Promise.resolve()
            .then(execute)
            .catch((error) => {
              if (error.code === "ERR_ASSERTION") journey.unexpected.push(error.message);
              throw error;
            })
            .then(resolve, reject);
        },
      };
      const execute = async () => {
        journey.calls.push({ kind: "rpc", name, args });
        const appointment = rows.appointments[0];
        const payment = rows.booking_payments[0];
        switch (name) {
          case "get_pending_google_calendar_setup":
            assert.deepEqual(args, {
              p_profile_id: profileId,
              p_environment: "test",
              p_expected_revision: rows.calendar_connections[0].connection_revision,
            });
            return ok(null);
          case "check_public_booking_rate_limit":
            return ok(true);
          case "booking_cutover_enabled":
            return ok(rows.booking_cutover_state[0].status === "enabled");
          case "store_booking_availability_cache":
            rows.booking_availability_cache.push({
              cache_key: args.p_cache_key,
              busy_ranges: args.p_busy_ranges,
              observed_at: args.p_observed_at,
              expires_at: args.p_expires_at,
            });
            return ok(true);
          case "reserve_live_booking": {
            if (loseResponse("inflight_then_rejected")) {
              reservationStarted.resolve();
              await releaseReservation.promise;
            }
            assert.equal(rows.appointments.length, 0, "do not reserve twice");
            assert.equal(args.p_website_id, websiteId);
            assert.equal(args.p_environment, "test");
            assert.equal(args.p_consent_document_id, "obra-booking-data-and-payment-consent");
            assert.match(args.p_request_capability_hash, /^[a-f0-9]{64}$/);
            rows.appointments.push({
              id: appointmentId,
              website_id: websiteId,
              profile_id: profileId,
              environment: "test",
              public_reference: reference,
              booking_contract_version: 2,
              appointment_state: "held",
              payment_state: "not_started",
              refund_state: "not_requested",
              calendar_state: "not_required",
              review_state: "none",
              appointment_reason: null,
              reservation_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
              cancelled_at: null,
              cancellation_requested_at: null,
              confirmed_at: null,
              calendar_destination_epoch_id: destinationId,
              service_snapshot: { name: rows.booking_services[0].name },
              customer_snapshot: { ...args.p_customer, email: args.p_customer.email.toLowerCase() },
              amount_minor: rows.booking_services[0].amount_minor,
              currency: "USD",
              start_at: args.p_start_at,
              end_at: new Date(Date.parse(args.p_start_at) + 60 * 60_000).toISOString(),
              time_zone: args.p_time_zone,
              updated_at: new Date().toISOString(),
            });
            rows.appointment_operations.push({
              id: operationId,
              appointment_id: appointmentId,
              profile_id: profileId,
              environment: "test",
              operation_type: "reserve",
              client_request_id: args.p_client_request_id,
              request_hash: args.p_request_hash,
              request_capability_hash: args.p_request_capability_hash,
            });
            rows.booking_payments.push({
              id: paymentId,
              appointment_id: appointmentId,
              profile_id: profileId,
              environment: "test",
              booking_contract_version: 2,
              checkout_operation_id: operationId,
              checkout_idempotency_key: `booking-checkout:${appointmentId}`,
              stripe_account_id: "acct_reserved",
              expected_amount_minor: rows.appointments[0].amount_minor,
              currency: "USD",
              payment_state: "not_started",
              checkout_session_id: null,
              checkout_provider_expires_at: null,
              checkout_expires_at: null,
              checkout_lease_token: null,
              checkout_lease_expires_at: null,
              checkout_fencing_token: 0,
              confirmation_nonce_hash: null,
              confirmation_handoff_expires_at: null,
              payment_intent_id: null,
              charge_id: null,
            });
            return loseResponse("reservation")
              ? { data: null, error: { code: "57014" } }
              : ok({ appointmentId });
          }
          case "claim_booking_checkout":
            assert.equal(args.p_appointment_id, appointment.id);
            assert.equal(args.p_operation_id, payment.checkout_operation_id);
            assert.equal(appointment.appointment_state, "held");
            assert.ok(["not_started", "creating"].includes(payment.payment_state));
            assert.ok(
              !payment.checkout_lease_expires_at ||
                Date.parse(payment.checkout_lease_expires_at) <= Date.now(),
            );
            Object.assign(payment, {
              payment_state: "creating",
              checkout_lease_token: args.p_lease_token,
              checkout_lease_expires_at: new Date(Date.now() + 120_000).toISOString(),
              checkout_fencing_token: payment.checkout_fencing_token + 1,
            });
            appointment.payment_state = "creating";
            return loseResponse("claim") ? { data: null, error: { code: "57014" } } : ok(payment);
          case "prepare_booking_checkout_handoff_v3":
            assert.equal(args.p_payment_id, payment.id);
            assert.equal(args.p_lease_token, payment.checkout_lease_token);
            assert.equal(args.p_fencing_token, payment.checkout_fencing_token);
            Object.assign(payment, {
              confirmation_nonce_hash: args.p_nonce_hash,
              checkout_provider_expires_at: args.p_provider_expires_at,
              confirmation_handoff_expires_at: args.p_handoff_expires_at,
            });
            return loseResponse("handoff")
              ? { data: null, error: { code: "57014" } }
              : ok({
                  providerExpiresAt: payment.checkout_provider_expires_at,
                  handoffExpiresAt: payment.confirmation_handoff_expires_at,
                });
          case "settle_booking_checkout":
            assert.equal(args.p_payment_id, payment.id);
            assert.equal(args.p_lease_token, payment.checkout_lease_token);
            assert.equal(args.p_fencing_token, payment.checkout_fencing_token);
            if (!args.p_succeeded) {
              assert.equal(args.p_ambiguous, true);
              Object.assign(payment, {
                payment_state: "creating",
                checkout_lease_token: null,
                checkout_lease_expires_at: null,
              });
              return ok(payment);
            }
            Object.assign(payment, {
              payment_state: "pending",
              checkout_session_id: args.p_session_id,
              checkout_expires_at: args.p_expires_at,
              checkout_lease_token: null,
              checkout_lease_expires_at: null,
            });
            Object.assign(appointment, {
              appointment_state: "payment_pending",
              payment_state: "pending",
            });
            return loseResponse("settlement")
              ? { data: null, error: { code: "57014" } }
              : ok(payment);
          case "recover_booking_checkout_handoff_v3":
            return ok(
              args.p_appointment_id === appointment.id &&
                args.p_nonce_hash === payment.confirmation_nonce_hash &&
                Date.parse(payment.confirmation_handoff_expires_at) > Date.now()
                ? {
                    handoffExpiresAt: payment.confirmation_handoff_expires_at,
                    paymentState: payment.payment_state,
                  }
                : null,
            );
          case "issue_booking_confirmation_capability_v3":
            assert.equal(args.p_checkout_session_id, payment.checkout_session_id);
            assert.equal(args.p_nonce_hash, payment.confirmation_nonce_hash);
            journey.receipt = {
              tokenHash: args.p_token_hash,
              reference: appointment.public_reference,
            };
            return ok("receipt-capability");
          case "consume_booking_confirmation_capability_v3":
            if (
              !journey.receipt ||
              args.p_token_hash !== journey.receipt.tokenHash ||
              args.p_reference !== journey.receipt.reference
            )
              return { data: null, error: { code: "P0002" } };
            return ok({
              reference: appointment.public_reference,
              environment: payment.environment,
              checkoutSessionId: payment.checkout_session_id,
              startAt: appointment.start_at,
              endAt: appointment.end_at,
              timeZone: appointment.time_zone,
              appointmentState: appointment.appointment_state,
              appointmentReason: appointment.appointment_reason,
              paymentState: appointment.payment_state,
              refundState: appointment.refund_state,
              calendarState: appointment.calendar_state,
              reviewState: appointment.review_state,
              reservationExpiresAt: appointment.reservation_expires_at,
              confirmedAt: appointment.confirmed_at,
              cancelledAt: appointment.cancelled_at,
              updatedAt: appointment.updated_at,
              statusCode: "payment_pending",
              terminal: false,
              pollAfterMs: 2500,
              automaticPollUntil: new Date(Date.now() + 30_000).toISOString(),
            });
          default:
            assert.fail(`Unexpected journey RPC ${name}`);
        }
      };
      return query;
    },
  };
  journey.stripe = {
    checkout: {
      sessions: {
        async create(input, options) {
          journey.calls.push({ kind: "stripe:create", input, options });
          assert.equal(journey.session, null, "exactly one Checkout session");
          assert.equal(options.stripeAccount, rows.booking_payments[0].stripe_account_id);
          assert.equal(options.idempotencyKey, rows.booking_payments[0].checkout_idempotency_key);
          assert.equal(input.customer_email, rows.appointments[0].customer_snapshot.email);
          assert.equal(
            input.line_items[0].price_data.unit_amount,
            rows.booking_payments[0].expected_amount_minor,
          );
          assert.equal(
            input.line_items[0].price_data.product_data.name,
            rows.appointments[0].service_snapshot.name,
          );
          assert.equal(input.metadata.appointmentId, rows.appointments[0].id);
          assert.equal(input.metadata.profileId, rows.appointments[0].profile_id);
          assert.equal(input.metadata.environment, rows.appointments[0].environment);
          journey.session = {
            id: checkoutSessionId,
            url: "https://checkout.stripe.com/c/pay/fixture",
            status: "open",
            metadata: input.metadata,
            expires_at: input.expires_at,
          };
          if (loseResponse("provider_response")) throw new Error("Fixture provider response lost");
          return structuredClone(journey.session);
        },
        async retrieve(id, _params, options) {
          journey.calls.push({ kind: "stripe:retrieve" });
          assert.equal(id, journey.session.id);
          assert.equal(options.stripeAccount, rows.booking_payments[0].stripe_account_id);
          return structuredClone(journey.session);
        },
      },
    },
  };
  journey.upload = async (input) => {
    journey.calls.push({
      kind: "attachment-upload",
      input,
      paymentState: rows.booking_payments[0].payment_state,
    });
    throw new Error("Fixture optional image storage unavailable");
  };
  journey.unexpectedProvider = () => {
    journey.unexpected.push("Unexpected saved-provider refresh");
    throw new Error("Unexpected saved-provider refresh");
  };
  const mocks = {
    "@tanstack/react-start": `export function createServerFn() { return { validator(validate) { return { handler(handle) { return ({data}) => handle({data:validate(data)}); } }; } }; }`,
    "@tanstack/react-start/server": `export const getRequest=()=>globalThis.__bookingHandoffJourney.request; export const setResponseHeader=(name,value)=>globalThis.__bookingHandoffJourney.headers.set(name,value);`,
    "@/integrations/supabase/client.server": `export const supabaseAdmin=globalThis.__bookingHandoffJourney.db;`,
    "@/lib/stripe.server": `export const billingEnvironment=()=>"test"; export const publicAppUrl=()=>"https://app.example.test"; export const getStripe=()=>globalThis.__bookingHandoffJourney.stripe;`,
    "@/lib/pipedream.server": `export const getGoogleCalendarBusyRanges=async()=>globalThis.__bookingHandoffJourney.busyRanges??[];`,
    "@/lib/pipedream-trigger-reconciliation.server": `export const refreshSavedGoogleCalendar=async()=>globalThis.__bookingHandoffJourney.unexpectedProvider();`,
    "@/lib/stripe-connect-inbox-worker.server": `export const refreshSavedStripeConnectAccount=async()=>globalThis.__bookingHandoffJourney.unexpectedProvider();`,
    "@/lib/booking-attachments.functions": `export async function getBookingAttachmentCapability() { return {enabled:true}; } export const uploadPreparedBookingAttachments=(input)=>globalThis.__bookingHandoffJourney.upload(input);`,
  };
  let checkoutBundle, receiptBundle, dialog;
  const previousWindow = globalThis.window,
    previousFormData = globalThis.FormData;
  globalThis.__bookingHandoffJourney = journey;
  process.env = {
    ...process.env,
    BOOKING_LIVE_ENABLED: "true",
    BOOKING_WORKER_MODE: "active",
    BOOKING_WORKER_ENVIRONMENT: "test",
    BOOKING_RATE_LIMIT_SECRET: "fixture-rate-secret-only",
  };
  const cookiePair = (value) => (Array.isArray(value) ? value[0] : value).split(";")[0];
  try {
    checkoutBundle = await importWithMocks(
      path.resolve("src/lib/booking-live.functions.ts"),
      mocks,
    );
    receiptBundle = await importWithMocks(
      path.resolve("src/lib/booking-confirmation.functions.ts"),
      mocks,
    );
    const available = await checkoutBundle.subject.getLiveBookingSlots({
      data: { websiteId, fromDate: localDate, dayCount: 1 },
    });
    const requestCookie = cookiePair(journey.headers.get("Set-Cookie"));
    journey.request.headers.set("cookie", requestCookie);
    const booking = {
      websiteId,
      ...available.slots[0],
      timeZone: available.timeZone,
      observedAt: available.observedAt,
      availabilityGeneration: available.availabilityGeneration,
      calendarSetHash: available.calendarSetHash,
      requestId: "60000000-0000-4000-8000-000000000006",
      consent: {
        accepted: true,
        documentId: "obra-booking-data-and-payment-consent",
        version: "2026-08-29.1",
        digest: "899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f",
      },
      customer: {
        fullName: "Fixture Customer",
        email: "CUSTOMER@example.test",
        phone: "+1 202 555 0100",
        address: {
          line1: "1 Fixture Road",
          city: "Fixture City",
          region: "CA",
          postalCode: "99999",
        },
      },
      attachments:
        failure === "attachment"
          ? [{ filename: "fixture.png", mimeType: "image/png", byteSize: 1, base64: "eA==" }]
          : [],
    };
    let create = () => checkoutBundle.subject.createLiveBookingCheckout({ data: booking });
    if (throughDialog) {
      const hooks = [];
      let cursor = 0,
        layout = [],
        effects = [],
        dirty = false,
        mounted = true,
        lateWrites = 0;
      const same = (a, b) =>
        a?.length === b?.length && a.every((value, i) => Object.is(value, b[i]));
      journey.hooks = {
        useState(initial) {
          const slot =
            hooks[cursor++] ??
            (hooks[cursor - 1] = { value: typeof initial === "function" ? initial() : initial });
          return [
            slot.value,
            (next) => {
              if (!mounted) {
                lateWrites++;
                return;
              }
              const value = typeof next === "function" ? next(slot.value) : next;
              if (!Object.is(value, slot.value)) {
                slot.value = value;
                dirty = true;
              }
            },
          ];
        },
        useRef(initial) {
          return (hooks[cursor++] ??= { current: initial });
        },
        effect(fn, deps, target) {
          const index = cursor++;
          if (!same(hooks[index]?.deps, deps))
            target.push(() => {
              hooks[index]?.cleanup?.();
              hooks[index] = { deps, cleanup: fn() };
            });
        },
        useEffect(fn, deps) {
          journey.hooks.effect(fn, deps, effects);
        },
        useLayoutEffect(fn, deps) {
          journey.hooks.effect(fn, deps, layout);
        },
      };
      journey.submissions = [];
      journey.dialogCheckout = async ({ data }) => {
        journey.submissions.push(structuredClone(data));
        try {
          const attempt = checkoutBundle.subject.createLiveBookingCheckout({ data });
          if (failure === "inflight_then_rejected" && !journey.originalAttempt) {
            journey.originalAttempt = attempt;
            await Promise.race([
              reservationStarted.promise,
              attempt.then(() => {
                throw Error("Fixture original must reach reservation before its response is lost");
              }),
            ]);
            throw Error("Fixture client Checkout response lost");
          }
          const result = await attempt;
          if (loseResponse("client_response")) throw Error("Fixture client Checkout response lost");
          journey.dialogResult = result;
          return result;
        } catch (error) {
          journey.dialogError = error;
          throw error;
        }
      };
      journey.dialogSlots = async () => {
        journey.dialogSlotReads = (journey.dialogSlotReads ?? 0) + 1;
        return journey.available ?? available;
      };
      globalThis.window = {
        location: {
          assign(url) {
            journey.redirect = url;
          },
        },
      };
      globalThis.FormData = class {
        constructor(values) {
          this.values = { ...values };
        }
        get(key) {
          return this.values[key] ?? null;
        }
        getAll(key) {
          return this.values[key] ?? [];
        }
      };
      const componentMocks = {
        react: `export const {useState,useRef,useEffect,useLayoutEffect}=globalThis.__bookingHandoffJourney.hooks;`,
        "react/jsx-runtime": `export const jsx=(type,props,key)=>({type,props,key}),jsxs=jsx;`,
        "@/lib/booking-live.functions": `export const getLiveBookingSlots=input=>globalThis.__bookingHandoffJourney.dialogSlots(input),createLiveBookingCheckout=input=>globalThis.__bookingHandoffJourney.dialogCheckout(input);`,
        "@/lib/booking-attachments.functions": `export const getBookingAttachmentCapability=async()=>({enabled:false});`,
        ...Object.fromEntries(
          [
            ["button", ["Button"]],
            ["checkbox", ["Checkbox"]],
            ["input", ["Input"]],
            ["label", ["Label"]],
            [
              "dialog",
              ["Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle"],
            ],
          ].map(([file, names]) => [
            `@/components/ui/${file}`,
            names.map((name) => `export const ${name}='${name}';`).join(""),
          ]),
        ),
      };
      const built = await build({
        entryPoints: [path.resolve("src/components/booking/LiveBookingDialog.tsx")],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        target: "node22",
        alias: { "@": path.resolve("src") },
        plugins: [
          {
            name: "actual-dialog-boundaries",
            setup(api) {
              api.onResolve({ filter: /.*/ }, ({ path }) =>
                Object.hasOwn(componentMocks, path)
                  ? { path, namespace: "dialog-fixture" }
                  : undefined,
              );
              api.onLoad({ filter: /.*/, namespace: "dialog-fixture" }, ({ path }) => ({
                contents: componentMocks[path],
                loader: "js",
              }));
            },
          },
        ],
      });
      const { LiveBookingDialog } = await import(
        `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#${failure}`
      );
      const nodes = (node) =>
        Array.isArray(node)
          ? node.flatMap(nodes)
          : node && typeof node === "object"
            ? [node, ...nodes(node.props?.children)]
            : [];
      const form = {
        ...booking.customer.address,
        name: booking.customer.fullName,
        email: booking.customer.email,
        phone: booking.customer.phone,
        notes: "Original submitted notes",
        bookingConsent: "accepted",
        attachments: [],
      };
      dialog = {
        props: {
          websiteId,
          open: true,
          onOpenChange(next) {
            dialog.render({ ...dialog.props, open: next });
          },
        },
        render(next = dialog.props) {
          dialog.props = next;
          cursor = 0;
          layout = [];
          effects = [];
          dirty = false;
          dialog.tree = LiveBookingDialog(next);
          for (const effect of [...layout, ...effects]) effect();
        },
        async flush() {
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setImmediate(resolve));
            if (dirty && mounted) dialog.render();
          }
        },
        unmount() {
          mounted = false;
          for (const hook of hooks) hook?.cleanup?.();
          assert.equal(lateWrites, 0);
        },
      };
      dialog.render();
      await dialog.flush();
      const slot = nodes(dialog.tree).find((node) => node.key === available.slots[0].startAt);
      const refresh = nodes(dialog.tree).find(
        (node) => node.type === "Button" && node.props.children === "Refresh available times",
      );
      slot.props.onClick();
      await dialog.flush();
      const back = nodes(dialog.tree).find(
        (node) => node.type === "Button" && node.props.children === "Back",
      );
      const formNode = () => nodes(dialog.tree).find((node) => node.type === "form");
      create = async () => {
        journey.dialogError = null;
        journey.dialogResult = undefined;
        const submit = formNode().props.onSubmit;
        await submit({ preventDefault() {}, currentTarget: form });
        await dialog.flush();
        if (journey.dialogError) throw journey.dialogError;
        return journey.dialogResult;
      };
      dialog.attemptEdits = async () => {
        assert.equal(
          nodes(dialog.tree).find((node) => node.type === "fieldset").props.disabled,
          true,
        );
        assert.equal(
          nodes(dialog.tree).find(
            (node) => node.type === "Button" && node.props.children === "Retry secure payment",
          ).props.disabled,
          false,
        );
        back.props.onClick();
        slot.props.onClick();
        refresh.props.onClick();
        await dialog.flush();
        assert.ok(formNode(), "ambiguous requests cannot go back to a new slot");
        nodes(dialog.tree)
          .find((node) => node.type === "Dialog")
          .props.onOpenChange(false);
        await dialog.flush();
        dialog.render({ ...dialog.props, open: true });
        await dialog.flush();
        assert.equal(
          journey.dialogSlotReads,
          1,
          "reopen does not generate a different booking request",
        );
        Object.assign(form, {
          notes: "Attempted changed notes",
          email: "changed@example.test",
          bookingConsent: null,
        });
        assert.equal(
          nodes(dialog.tree).find((node) => node.props.name === "notes").props.defaultValue,
          "Original submitted notes",
        );
      };
      if (failure === "input_rejected") {
        for (const invalid of [
          { name: "x" },
          { phone: "123" },
          { line1: "x" },
          { bookingConsent: null },
        ]) {
          const before = { ...form };
          Object.assign(form, invalid);
          assert.equal(
            await create(),
            undefined,
            "local invalid input does not produce a server result",
          );
          assert.equal(journey.submissions.length, 0);
          assert.equal(rows.appointment_operations.length, 0);
          assert.equal(
            nodes(dialog.tree).find((node) => node.type === "fieldset").props.disabled,
            false,
          );
          assert.equal(
            nodes(dialog.tree).find(
              (node) => node.type === "Button" && node.props.children === "Back",
            ).props.disabled,
            false,
          );
          Object.assign(form, before);
        }
        form.name = "Corrected Customer";
        form.phone = "+1 202 555 0199";
      }
      if (failure === "slot_rejected") {
        journey.busyRanges = [{ start: available.slots[0].startAt, end: available.slots[0].endAt }];
        rows.booking_availability_cache.length = 0;
        assert.deepEqual(await create(), { status: "not_attempted", code: "slot_unavailable" });
        assert.equal(rows.appointment_operations.length, 0);
        assert.equal(journey.calls.filter(({ name }) => name === "reserve_live_booking").length, 0);
        assert.equal(
          nodes(dialog.tree).find((node) => node.type === "fieldset").props.disabled,
          false,
        );
        assert.equal(
          nodes(dialog.tree).find(
            (node) => node.type === "Button" && node.props.children === "Back",
          ).props.disabled,
          false,
        );
        back.props.onClick();
        await dialog.flush();
        assert.equal(formNode(), undefined);
        journey.busyRanges = [];
        rows.booking_availability_cache.length = 0;
        const nextDate = new Date(Date.parse(localDate) + 86_400_000).toISOString().slice(0, 10);
        journey.available = await checkoutBundle.subject.getLiveBookingSlots({
          data: { websiteId, fromDate: nextDate, dayCount: 1 },
        });
        nodes(dialog.tree)
          .find(
            (node) => node.type === "Button" && node.props.children === "Refresh available times",
          )
          .props.onClick();
        await dialog.flush();
        nodes(dialog.tree)
          .find((node) => node.key === journey.available.slots[0].startAt)
          .props.onClick();
        await dialog.flush();
        form.notes = "New time after definite refusal";
      }
      if (failure === "inflight_then_rejected") {
        await assert.rejects(create, /Fixture client Checkout response lost/);
        assert.equal(
          rows.appointment_operations.length,
          0,
          "the first request is still in flight, not known absent",
        );
        assert.equal(journey.calls.filter(({ name }) => name === "reserve_live_booking").length, 1);
        journey.busyRanges = [{ start: available.slots[0].startAt, end: available.slots[0].endAt }];
        rows.booking_availability_cache.length = 0;
        assert.deepEqual(await create(), { status: "not_attempted", code: "slot_unavailable" });
        assert.equal(journey.redirect, undefined);
        assert.equal(rows.appointment_operations.length, 0);
        await dialog.attemptEdits();
        assert.equal(
          journey.calls.filter(({ name }) => name === "reserve_live_booking").length,
          1,
          "a refusal on the retry cannot authorize a second reservation",
        );
        releaseReservation.resolve();
        assert.equal(
          (await journey.originalAttempt).status,
          "checkout_ready",
          "the network-lost original can still complete after the refusal",
        );
        assert.equal(rows.appointment_operations.length, 1);
        assert.equal(journey.calls.filter(({ kind }) => kind === "stripe:create").length, 1);
        assert.equal(journey.redirect, undefined, "the original result never reached the browser");
      }
    }
    let checkout;
    if (
      failure &&
      !["attachment", "input_rejected", "slot_rejected", "inflight_then_rejected"].includes(failure)
    ) {
      await assert.rejects(
        create,
        /Unable to reserve|interrupted before claim|Unable to create checkout|Unable to secure booking handoff|Fixture provider response lost|Fixture client Checkout response lost|Checkout was created and is being reconciled/,
      );
      assert.equal(rows.appointment_operations.length, 1);
      if (dialog) {
        await dialog.attemptEdits();
        const original = journey.submissions[0];
        await assert.rejects(
          () =>
            checkoutBundle.subject.createLiveBookingCheckout({
              data: {
                ...original,
                customer: { ...original.customer, notes: "Attempted changed notes" },
              },
            }),
          /Booking request identity conflict/,
          "the actual server rejects edited retries, not just the fixture's reservation count",
        );
      }
      const persisted = structuredClone({
        operation: rows.appointment_operations[0],
        customer: rows.appointments[0].customer_snapshot,
        service: rows.appointments[0].service_snapshot,
        destination: rows.appointments[0].calendar_destination_epoch_id,
        account: rows.booking_payments[0].stripe_account_id,
        price: rows.booking_payments[0].expected_amount_minor,
        key: rows.booking_payments[0].checkout_idempotency_key,
      });
      // Reconfiguration/admission pause must not change the identity of an admitted checkout.
      rows.booking_services[0].name = "Replacement service";
      rows.booking_services[0].amount_minor = 99999;
      rows.stripe_connected_accounts[0].stripe_account_id = "acct_replacement";
      rows.calendar_connections[0].pipedream_account_id = "apn_replacement";
      rows.calendar_connections[0].health_state = "disconnected";
      rows.calendar_selections[0].google_calendar_id = "replacement-calendar";
      rows.website_entitlements[0].state = "expired";
      rows.booking_cutover_state[0].status = "disabled";
      rows.websites[0].status = "draft";
      rows.websites[0].active_version_id = null;
      process.env.BOOKING_LIVE_ENABLED = "false";
      process.env.BOOKING_WORKER_MODE = "drain";
      const continuationStart = journey.calls.length;
      if (failure === "claim") {
        await assert.rejects(create, /being reconciled or is no longer payable/);
        assert.equal(
          journey.calls.filter(({ name }) => name === "claim_booking_checkout").length,
          1,
          "an active lease is not stolen",
        );
        rows.booking_payments[0].checkout_lease_expires_at = new Date(Date.now() - 1).toISOString();
      }
      if (failure === "handoff" || failure === "provider_response") {
        const creates = journey.calls.filter(({ kind }) => kind === "stripe:create").length;
        await assert.rejects(create, /being reconciled or is no longer payable/);
        assert.equal(journey.calls.filter(({ kind }) => kind === "stripe:create").length, creates);
        assert.equal(journey.calls.filter(({ name }) => name === "reserve_live_booking").length, 1);
        assert.equal(rows.booking_payments[0].payment_state, "creating");
        assert.ok(
          rows.booking_payments[0].checkout_provider_expires_at,
          "retain the same due context for background ambiguity recovery",
        );
        assert.equal(rows.booking_payments[0].checkout_idempotency_key, persisted.key);
        console.log(
          `PASS: ${failure} remains the same ambiguous operation, without another reservation or Checkout dispatch`,
        );
        return;
      }
      checkout = await create();
      if (dialog) {
        assert.deepEqual(
          journey.submissions[1],
          journey.submissions[0],
          "actual dialog retries the immutable submitted payload through the real replay hash check",
        );
        assert.equal(journey.submissions[0].customer.notes, "Original submitted notes");
        assert.equal(rows.appointments[0].customer_snapshot.notes, "Original submitted notes");
      }
      assert.deepEqual(
        {
          operation: rows.appointment_operations[0],
          customer: rows.appointments[0].customer_snapshot,
          service: rows.appointments[0].service_snapshot,
          destination: rows.appointments[0].calendar_destination_epoch_id,
          account: rows.booking_payments[0].stripe_account_id,
          price: rows.booking_payments[0].expected_amount_minor,
          key: rows.booking_payments[0].checkout_idempotency_key,
        },
        persisted,
      );
      assert.ok(
        journey.calls
          .slice(continuationStart)
          .every(
            ({ kind, table }) =>
              kind !== "query" ||
              ["websites", "appointment_operations", "appointments", "booking_payments"].includes(
                table,
              ),
          ),
        "continuation never reloads mutable provider/setup facts",
      );
    } else {
      checkout = await create();
    }
    assert.equal(checkout.status, "checkout_ready");
    assert.equal(checkout.checkoutUrl, journey.session.url);
    if (dialog) assert.equal(journey.redirect, checkout.checkoutUrl);
    if (failure === "input_rejected") {
      assert.equal(journey.submissions.length, 1);
      assert.equal(rows.appointments[0].customer_snapshot.fullName, "Corrected Customer");
      assert.equal(rows.appointments[0].customer_snapshot.phone, "+1 202 555 0199");
    }
    if (failure === "slot_rejected") {
      assert.notEqual(journey.submissions[0].requestId, journey.submissions[1].requestId);
      assert.notEqual(journey.submissions[0].startAt, journey.submissions[1].startAt);
      assert.equal(rows.appointments[0].customer_snapshot.notes, "New time after definite refusal");
    }
    if (failure === "inflight_then_rejected")
      assert.deepEqual(
        journey.submissions,
        Array(3).fill(journey.submissions[0]),
        "prior ambiguity keeps the original payload and ID through later preflight refusal and successful replay",
      );
    const handoffCookie = cookiePair(journey.headers.get("Set-Cookie"));
    const nonce = decodeURIComponent(handoffCookie.slice(handoffCookie.indexOf("=") + 1));
    assert.equal(
      rows.booking_payments[0].confirmation_nonce_hash,
      rawHash(JSON.stringify(nonce)),
      "preserve the digest already stored by shipped checkout",
    );
    assert.notEqual(rows.booking_payments[0].confirmation_nonce_hash, rawHash(nonce));
    journey.request.headers.set("cookie", requestCookie);
    const resumed = dialog
      ? await checkoutBundle.subject.createLiveBookingCheckout({ data: journey.submissions.at(-1) })
      : await create();
    assert.equal(resumed.status, "checkout_ready");
    assert.equal(resumed.checkoutUrl, checkout.checkoutUrl);
    assert.equal(rows.booking_payments[0].confirmation_nonce_hash, rawHash(JSON.stringify(nonce)));
    assert.equal(
      journey.calls.filter(({ kind }) => kind === "stripe:create").length,
      1,
      "the browser replay only retrieves the existing Checkout",
    );
    if (failure === "attachment") {
      const uploads = journey.calls.filter(({ kind }) => kind === "attachment-upload");
      assert.equal(uploads.length, 1);
      assert.equal(
        uploads[0].paymentState,
        "pending",
        "optional uploads follow durable checkout settlement",
      );
      assert.equal(uploads[0].input.appointmentId, appointmentId);
      assert.equal(uploads[0].input.contextId, appointmentId);
      assert.equal(
        rawHash(JSON.stringify(uploads[0].input.contextToken)),
        rows.booking_payments[0].confirmation_nonce_hash,
      );
      assert.deepEqual(uploads[0].input.attachments, booking.attachments);
    }

    // The customer completed Stripe, but signed-inbox settlement may still be pending locally.
    journey.session.status = "complete";
    journey.session.payment_status = "paid";
    const returnRequest = new Request(
      `https://app.example.test/booking/return?session_id=${journey.session.id}`,
      { headers: { cookie: handoffCookie, "cf-connecting-ip": "203.0.113.20" } },
    );
    const exchanged = await receiptBundle.subject.exchangeBookingReturn(returnRequest);
    assert.equal(exchanged.location, `/booking/confirmation?reference=${reference}`);
    const receiptCookie = cookiePair(exchanged.cookie);
    const receiptToken = decodeURIComponent(receiptCookie.slice(receiptCookie.indexOf("=") + 1));
    assert.equal(
      journey.receipt.tokenHash,
      rawHash(receiptToken),
      "receipt token hashing stays raw, unlike the persisted nonce",
    );
    journey.request.headers.set("cookie", receiptCookie);
    const receipt = await receiptBundle.subject.consumeBookingConfirmation({ data: { reference } });
    assert.equal(receipt.reference, reference);
    assert.equal(receipt.checkoutSessionId, journey.session.id);
    assert.equal(
      receipt.paymentState,
      "pending",
      "return exchange must not manufacture paid truth",
    );
    assert.equal(rows.appointments[0].calendar_destination_epoch_id, destinationId);

    returnRequest.headers.set("cookie", `${handoffCookie.split("=")[0]}=different-browser`);
    await assert.rejects(
      () => receiptBundle.subject.exchangeBookingReturn(returnRequest),
      /Booking confirmation is unavailable/,
    );
    await assert.rejects(
      () => receiptBundle.subject.consumeBookingConfirmation({ data: { reference: websiteId } }),
      /invalid or expired/,
    );
    assert.equal(journey.calls.filter(({ name }) => name === "reserve_live_booking").length, 1);
    console.log(
      `PASS: ${throughDialog ? "actual dialog + attempted edits + " : ""}${failure ?? "new booking"}: real slots -> checkout/replay -> issued handoff cookie -> return -> issued receipt cookie -> receipt; wrong browser/reference rejected`,
    );
  } finally {
    releaseReservation.resolve();
    await journey.originalAttempt?.catch(() => undefined);
    dialog?.unmount();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    globalThis.FormData = previousFormData;
    delete globalThis.__bookingHandoffJourney;
    if (checkoutBundle) await checkoutBundle.cleanup();
    if (receiptBundle) await receiptBundle.cleanup();
    assert.deepEqual(
      journey.unexpected,
      [],
      "caught mock assertions cannot pass as expected failures",
    );
    assert.equal(journey.pending, 0, "all DB operations must be awaited");
    assert.ok(journey.calls.some(({ name }) => name === "get_pending_google_calendar_setup"));
    assert.equal(networkCalls, 0, "no real provider or database requests");
  }
}

try {
  process.env = { ...originalEnv, BOOKING_CONFIRMATION_SECRET: secret };
  globalThis.__bookingConfirmationTest = state;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Unexpected network request");
  };
  // Keep the real Zod schema, cookie parser, receipt HMAC and timing-safe token check.
  bundle = await importWithMocks(path.resolve("src/lib/booking-confirmation.functions.ts"), {
    "@tanstack/react-start": `
      export function createServerFn() {
        return { validator(validate) {
          return { handler(handle) { return async ({ data }) => handle({ data: validate(data) }); } };
        } };
      }
    `,
    "@tanstack/react-start/server":
      "export const getRequest = () => globalThis.__bookingConfirmationTest.request;",
    "@/integrations/supabase/client.server":
      "export const supabaseAdmin = globalThis.__bookingConfirmationTest.db;",
    "@/lib/stripe.server": `
      export function billingEnvironment() { throw new Error('Unexpected provider access'); }
      export const getStripe = billingEnvironment;
    `,
  });
  const loadBookingConfirmation = () =>
    bundle.subject.consumeBookingConfirmation({ data: { reference } });

  for (const delivery of [
    {},
    {
      calendarState: "create_pending",
      statusCode: "confirmed_calendar_pending",
      terminal: false,
      pollAfterMs: 2_500,
      automaticPollUntil: "2026-09-10T08:00:30.000Z",
    },
  ]) {
    state.projection = { ...projection, ...delivery };
    state.calls = [];
    assert.deepEqual(await loadBookingConfirmation(), state.projection);
    assert.deepEqual(state.calls, [expectedCall], "consume the valid receipt capability once");
    console.log(`PASS: unresolved_destination preserves ${state.projection.statusCode}`);
  }

  state.projection = {
    ...projection,
    appointmentState: "cancelled",
    appointmentReason: "late_payment_arbitration",
    calendarState: "not_required",
    reviewState: "late_payment",
    confirmedAt: null,
    cancelledAt: projection.updatedAt,
    statusCode: "settling",
    terminal: false,
    pollAfterMs: 2_500,
    automaticPollUntil: "2026-09-10T08:00:30.000Z",
  };
  state.calls = [];
  assert.deepEqual(await loadBookingConfirmation(), state.projection);
  assert.deepEqual(state.calls, [expectedCall]);
  // Execute only the route's pure copy/poll predicates. No React, DOM or browser.
  const routeSource = await readFile(path.resolve("src/routes/booking.confirmation.tsx"), "utf8");
  const predicatesStart = routeSource.indexOf("function isSettling(");
  const predicatesEnd = routeSource.indexOf("function BookingConfirmation(");
  assert.ok(predicatesStart >= 0 && predicatesEnd > predicatesStart);
  const { code } = await transform(
    routeSource.slice(predicatesStart, predicatesEnd) +
      "\n({ isSettling, statusCopy, calendarStatusCopy });",
    { loader: "ts", target: "node22" },
  );
  const { isSettling, statusCopy, calendarStatusCopy } = runInNewContext(code);
  assert.equal(isSettling(state.projection), true);
  assert.match(statusCopy(state.projection), /checking whether your appointment can be confirmed/);
  assert.doesNotMatch(statusCopy(state.projection), /booking is cancelled|refund is in progress/);
  const cancelled = {
    ...state.projection,
    appointmentReason: "contractor_cancelled",
    reviewState: "none",
    refundState: "pending",
    statusCode: "refund_pending",
  };
  assert.equal(isSettling(cancelled), true);
  assert.match(
    statusCopy(cancelled),
    /booking is cancelled and the remaining refund is in progress/,
  );
  const completed = {
    ...cancelled,
    refundState: "succeeded",
    calendarState: "cancelled",
    statusCode: "refund_succeeded",
    terminal: true,
  };
  assert.equal(isSettling(completed), false);
  assert.equal(statusCopy(completed), "The refund has completed.");
  console.log(
    "PASS: provisional receipt stays settling and polls; owner cancellation/refund copy stays truthful (pure functions only)",
  );

  for (const appointmentReason of [null, "late_payment_recovered"])
    for (const calendarState of ["created", "create_pending", "create_failed"]) {
      state.projection = {
        ...projection,
        paymentState: "disputed",
        appointmentReason,
        calendarState,
      };
      const disputed = await loadBookingConfirmation();
      assert.equal(
        disputed.paymentState,
        "disputed",
        "actual receipt schema retains independent money state",
      );
      assert.equal(statusCopy(disputed), "Your appointment is confirmed.");
      assert.doesNotMatch(statusCopy(disputed), /payment are confirmed|Payment arrived after/);
      assert.equal(
        calendarStatusCopy(disputed),
        calendarStatusCopy({ ...disputed, paymentState: "paid" }),
      );
      const paid = { ...disputed, paymentState: "paid" };
      assert.equal(
        statusCopy(paid),
        appointmentReason
          ? "Payment arrived after the hold deadline, but the time was still free and your appointment is confirmed."
          : "Your appointment and payment are confirmed.",
      );
    }
  for (const cancelledState of [cancelled, completed])
    assert.equal(
      statusCopy({ ...cancelledState, paymentState: "disputed" }),
      statusCopy(cancelledState),
      "refund/cancellation copy remains independent",
    );
  assert.equal(
    statusCopy({
      ...projection,
      appointmentState: "cancelled",
      appointmentReason: "late_payment_recovered",
    }),
    "This booking is cancelled.",
    "retained late-payment history cannot override a later cancellation",
  );
  console.log(
    "PASS: real disputed receipt projection never implies payment confirmation; calendar and refund/cancellation copy remain independent, confirmed paid unchanged",
  );

  state.projection = { ...projection, reviewState: "unknown_review_state" };
  state.calls = [];
  await assert.rejects(loadBookingConfirmation, (error) => {
    assert.equal(error.name, "ZodError");
    assert.deepEqual(
      error.issues.map(({ code, path, received }) => ({ code, path, received })),
      [{ code: "invalid_enum_value", path: ["reviewState"], received: "unknown_review_state" }],
    );
    return true;
  });
  assert.deepEqual(state.calls, [expectedCall]);
  console.log("PASS: unknown reviewState still fails at the real projection schema");

  state.projection = { ...projection, checkoutSessionId: "cs_fixture_other_receipt" };
  state.calls = [];
  await assert.rejects(loadBookingConfirmation, /This confirmation link is invalid or expired/);
  assert.deepEqual(state.calls, [expectedCall]);
  assert.equal(networkCalls, 0, "no real provider or database requests");
  console.log("PASS: unresolved_destination does not bypass receipt token binding");
  for (const failure of [
    null,
    "reservation",
    "before_claim",
    "claim",
    "handoff",
    "provider_response",
    "settlement",
    "attachment",
  ])
    await verifyCheckoutReceiptHandoff(failure);
  for (const failure of [
    "reservation",
    "client_response",
    "input_rejected",
    "slot_rejected",
    "inflight_then_rejected",
  ])
    await verifyCheckoutReceiptHandoff(failure, true);
  console.log(
    "test-booking-confirmation: 19 scenarios passed (actual dialog validation/refusal/inflight-retry, real checkout/receipt handoff, interrupted continuation and pure status predicates; no network/browser)",
  );
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  delete globalThis.__bookingConfirmationTest;
  if (bundle) await bundle.cleanup();
}
