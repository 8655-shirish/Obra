import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import Stripe from "stripe";
import * as supabase from "@supabase/supabase-js";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const state = { scenario: "", calls: [], claimed: new Set(), active: new Set() };
const env = {
  SUPABASE_URL: "https://fixture.supabase.co",
  VITE_SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  SUPABASE_BOOKING_WORKER_KEY: "worker_fixture",
  STRIPE_SECRET_KEY: "sk_test_fixture",
  SAAS_BILLING_ENVIRONMENT: "test",
  BOOKING_WORKER_ENVIRONMENT: "test",
  BOOKING_WORKER_MODE: "drain",
  CALENDAR_WORKER_BUDGET_MS: "10000",
  CALENDAR_WORKER_SETTLEMENT_MS: "3000",
  STRIPE_INBOX_CRON_SECRET: "fixture",
  BOOKING_CRON_SECRET: "fixture",
  PIPEDREAM_INBOX_CRON_SECRET: "fixture",
  SAAS_STRIPE_INBOX_WORKER_ENABLED: "false",
  SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED: "false",
  RESEND_API_KEY_TEST: "resend_fixture",
  BOOKING_EMAIL_FROM_TEST: "fixture@example.test",
  BOOKING_ATTACHMENT_ENVIRONMENT: "test",
  BOOKING_SCANNER_PROVIDER: "fixture",
  BOOKING_SCANNER_URL: "https://scanner.example.test/scan",
  BOOKING_SCANNER_ALLOWED_ORIGIN: "https://scanner.example.test",
  BOOKING_SCANNER_TOKEN: "scanner_fixture",
  BOOKING_SCANNER_CREDENTIAL_VERSION: "fixture-1",
};
process.env = new Proxy(originalEnv, {
  get(target, key) {
    return Object.hasOwn(env, key) ? env[key] : Reflect.get(target, key);
  },
});
globalThis.__cronTransportTest = { Stripe, supabase };
const bytes = new TextEncoder().encode("fixture bytes");
const checksum = createHash("sha256").update(bytes).digest("hex");
const once = (name, row) => {
  if (state.claimed.has(name)) return [];
  state.claimed.add(name);
  return [row];
};
function hang(init, body = false) {
  assert.ok(init.signal instanceof AbortSignal, "every real transport has a cancel signal");
  state.active.add(init.signal);
  if (body)
    return new Response(
      new ReadableStream({
        start(controller) {
          init.signal.addEventListener(
            "abort",
            () => {
              state.active.delete(init.signal);
              controller.error(init.signal.reason);
            },
            { once: true },
          );
        },
      }),
    );
  return new Promise((_, reject) =>
    init.signal.addEventListener(
      "abort",
      () => {
        state.active.delete(init.signal);
        reject(init.signal.reason);
      },
      { once: true },
    ),
  );
}
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  const name = url.pathname.split("/").at(-1);
  const args = typeof init.body === "string" ? JSON.parse(init.body) : null;
  state.calls.push({ host: url.hostname, name, args });
  if (
    state.scenario === "otp-unsent" &&
    [
      "claim_due_saas_checkout_fulfillment",
      "reserve_otp_send",
      "renew_saas_checkout_fulfillment",
      "begin_saas_checkout_fulfillment_dispatch",
    ].includes(name)
  )
    state.now += 4_350;
  assert.equal(init.redirect, "manual");
  if (url.hostname === "api.stripe.com") return hang(init, true);
  if (url.hostname === "api.resend.com" || url.hostname === "scanner.example.test")
    return hang(init, true);
  assert.equal(
    url.hostname,
    "fixture.supabase.co",
    "no hosted credentials or unrecognized network targets",
  );
  if (url.pathname === "/auth/v1/otp") return hang(init, true);
  if (url.pathname.startsWith("/storage/v1/")) {
    if (state.scenario === "cleanup") return hang(init, true);
    return new Response(bytes);
  }
  if (name === "claim_booking_worker_family_v3") {
    if (state.scenario === "claim") return hang(init, true);
    return Response.json(7);
  }
  if (name === "claim_due_booking_payment_events")
    return Response.json(
      state.scenario === "payment"
        ? once(name, {
            id: "inbox-fixture",
            profile_id: "profile-fixture",
            environment: "test",
            account_context: "acct_fixture",
            event_type: "checkout.session.completed",
            fencing_token: 4,
            payload: { data: { object: { id: "cs_fixture" } } },
          })
        : [],
    );
  if (name === "claim_due_booking_outbox")
    return Response.json(
      state.scenario === "refund"
        ? once(name, {
            id: "refund-fixture",
            environment: "test",
            command_type: "refund",
            fencing_token: 4,
          })
        : [],
    );
  if (name === "claim_due_booking_session_expiries_v3")
    return Response.json(
      state.scenario === "lifecycle"
        ? once(name, {
            id: "expiry-fixture",
            checkout_session_id: "cs_expiryfixture",
            stripe_account_id: "acct_fixture",
            checkout_fencing_token: 4,
          })
        : [],
    );
  if (name === "get_booking_outbox_context")
    return Response.json({
      appointment: { id: "apt-fixture" },
      payment: {
        stripe_account_id: "acct_fixture",
        payment_intent_id: "pi_fixture",
      },
    });
  if (name === "provider_event_inbox")
    return Response.json(
      state.scenario === "saas" && url.searchParams.get("event_family") === "eq.saas"
        ? [
            {
              id: "saas-fixture",
              payload: {
                type: "customer.subscription.updated",
                data: { object: { id: "sub_fixture" } },
              },
              processing_state: "pending",
              lease_expires_at: null,
            },
          ]
        : [],
    );
  if (name === "claim_provider_event") return Response.json(4);
  if (name === "claim_due_saas_checkout_fulfillment")
    return Response.json(
      state.scenario === "otp" || state.scenario === "otp-unsent"
        ? once(name, {
            id: "otp-fixture",
            environment: "test",
            recipient_email: "fixture@example.test",
            fencing_token: 4,
          })
        : [],
    );
  if (name === "claim_due_booking_notifications_v3")
    return Response.json(
      state.scenario === "notification"
        ? once(name, {
            id: "notification-fixture",
            environment: "test",
            notification_type: "confirmed",
            audience: "customer",
            recipient_email: "fixture@example.test",
            idempotency_key: "notification-fixture",
            fencing_token: 4,
          })
        : [],
    );
  if (name === "get_booking_notification_context_v3")
    return Response.json({
      appointment: {
        public_reference: "fixture",
        start_at: "2030-01-01T12:00:00Z",
        time_zone: "UTC",
        service_snapshot: { name: "fixture" },
        appointment_state: "confirmed",
        calendar_state: "create_pending",
        cancellation_requested_at: null,
      },
    });
  if (name === "authorize_booking_notification_dispatch_v3")
    return Response.json({
      action: "dispatch",
      payload: args.p_payload,
      dispatch_budget_ms: 10_000,
    });
  if (name === "booking_attachment_security_v3")
    return Response.json([{ scanner_provider: "fixture", upload_enabled: true }]);
  if (name === "claim_due_booking_attachment_scans_v3")
    return Response.json(
      once(name, {
        attachment_id: "attachment-fixture",
        generation: 1,
        storage_object_key: "fixture/file",
        mime_type: "image/png",
        checksum,
        scan_fencing_token: 4,
      }),
    );
  if (name === "claim_booking_attachment_cleanup_v3")
    return Response.json(
      once(name, {
        attachment_id: "attachment-fixture",
        generation: 1,
        storage_object_key: "fixture/file",
        deletion_fencing_token: 4,
      }),
    );
  if (
    ["claim_booking_provider_account_disconnect_v3", "claim_google_calendar_setup_probe"].includes(
      name,
    )
  )
    return Response.json(null);
  if (name.startsWith("claim_")) return Response.json([]);
  if (name.startsWith("expire_")) return Response.json(0);
  return Response.json(true);
};
const bundles = [];
try {
  for (const route of ["booking", "stripe-inbox"]) {
    bundles.push({
      route,
      ...(await importWithMocks(path.resolve(`src/routes/api/cron/${route}.ts`), {
        "@tanstack/react-router": "export const createFileRoute=()=>config=>config;",
        "@tanstack/react-start":
          "export function createServerFn(){return {validator(parse){return {handler(fn){return ({data})=>fn({data:parse(data)});}};},handler(fn){return fn;}};}",
        "@tanstack/react-start/server":
          "export function getRequest(){throw new Error('No browser');}",
        stripe: "export default globalThis.__cronTransportTest.Stripe;",
        "@supabase/supabase-js":
          "export const createClient=globalThis.__cronTransportTest.supabase.createClient;",
      })),
    });
  }
  for (const [scenario, route, family, settlement] of [
    ["claim", "booking", "core", null],
    ["payment", "booking", "core", "fail_booking_payment_event_v3"],
    ["refund", "booking", "core", "fail_booking_refund_command_v3"],
    ["lifecycle", "booking", "core", "fail_booking_session_expiry_v3"],
    ["saas", "stripe-inbox", null, "complete_provider_event"],
    ["otp", "stripe-inbox", null, "mark_saas_checkout_fulfillment_delivery_unknown"],
    ["notification", "booking", "notifications", "fail_booking_notification_v3"],
    ["scanner", "booking", "attachment_scan", "complete_booking_attachment_scan_v3"],
    ["cleanup", "booking", "attachment_cleanup", "complete_booking_attachment_cleanup_v3"],
  ]) {
    state.scenario = scenario;
    state.calls = [];
    state.claimed.clear();
    state.active.clear();
    env.SAAS_STRIPE_INBOX_WORKER_ENABLED = scenario === "saas" ? "true" : "false";
    env.SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED = scenario === "otp" ? "true" : "false";
    const startedAt = Date.now();
    const response = await bundles
      .find((b) => b.route === route)
      .subject.Route.server.handlers.POST({
        request: new Request(`https://obratech.co/api/cron/${route}`, {
          method: "POST",
          headers: { authorization: "Bearer fixture" },
          body: JSON.stringify(family ? { family } : {}),
        }),
      });
    assert.ok(
      Date.now() - startedAt < 10_000,
      `${scenario} must complete inside total invocation budget`,
    );
    assert.equal(state.active.size, 0, `${scenario} leaves no live transport after response`);
    if (settlement)
      assert.ok(
        state.calls.some((call) => call.name === settlement),
        `${scenario} keeps durable settlement within reserve`,
      );
    if (scenario === "claim")
      assert.equal(
        state.calls.length,
        1,
        "indeterminate family claim cannot dispatch provider work",
      );
    if (scenario === "otp")
      assert.equal(
        state.calls.some((c) => c.name === "complete_saas_checkout_fulfillment"),
        false,
        "ambiguous OTP never projects provider failure/success",
      );
    assert.equal(
      response.status,
      500,
      `${scenario} cannot report successful invocation after transport deadline`,
    );
    const count = state.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(state.calls.length, count, "no detached work after HTTP response");
  }
  state.scenario = "otp-unsent";
  state.calls = [];
  state.claimed.clear();
  state.now = originalNow();
  Date.now = () => state.now;
  env.CALENDAR_WORKER_BUDGET_MS = "45000";
  env.CALENDAR_WORKER_SETTLEMENT_MS = "5000";
  env.SAAS_STRIPE_INBOX_WORKER_ENABLED = "false";
  env.SAAS_CHECKOUT_FULFILLMENT_WORKER_ENABLED = "true";
  const stoppedOtp = await bundles
    .find((b) => b.route === "stripe-inbox")
    .subject.Route.server.handlers.POST({
      request: new Request("https://obratech.co/api/cron/stripe-inbox", {
        method: "POST",
        headers: { authorization: "Bearer fixture" },
        body: "{}",
      }),
    });
  const stoppedOutcome = await stoppedOtp.json();
  assert.equal(
    stoppedOutcome.outcome,
    "deadline_exceeded",
    "settled zero-send OTP cutoff cannot clear worker health",
  );
  assert.equal(stoppedOtp.status, 500);
  assert.equal(stoppedOutcome.failed, null, "interrupted lane failure total remains unknown");
  assert.equal(state.calls.filter((call) => call.name === "otp").length, 0);
  assert.ok(state.calls.some((call) => call.name === "defer_saas_checkout_fulfillment"));
  assert.equal(
    state.calls.some((call) => call.name === "mark_saas_checkout_fulfillment_delivery_unknown"),
    false,
  );
  Date.now = originalNow;
  console.log(
    "test-calendar-cron-transports: passed (9 hung-transport cases and unsent OTP cutoff; actual routes/SDKs, truthful outcome and settlement reserve)",
  );
} finally {
  process.env = originalEnv;
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  delete globalThis.__cronTransportTest;
  await Promise.all(bundles.map((bundle) => bundle.cleanup()));
}
