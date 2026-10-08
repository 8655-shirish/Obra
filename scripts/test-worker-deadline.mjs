import assert from "node:assert/strict";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { build } from "esbuild";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const bundle = await importWithMocks(path.resolve("src/lib/worker-deadline.server.ts"), {});
const { withWorkerDeadline, workerProviderFetch, workerSupabaseFetch, workerCanContinue } =
  bundle.subject;
let fetches = 0;
let aborted = 0;
let mode = "headers";
globalThis.fetch = async (_url, init) => {
  fetches++;
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal);
  if (mode === "retry")
    return Response.json(
      { message: "fixture" },
      { status: 503, headers: { "retry-after": "3600" } },
    );
  if (mode === "success") return Response.json(true);
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
    { headers: { "content-type": "application/json" } },
  );
};
try {
  const db = createClient("https://fixture.supabase.co", "sb_publishable_fixture", {
    global: { fetch: workerSupabaseFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stripe = new Stripe("sk_test_fixture", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(workerProviderFetch),
  });
  for (const transport of ["headers", "body", "retry"]) {
    mode = transport;
    fetches = 0;
    aborted = 0;
    const start = Date.now();
    const response = await withWorkerDeadline(
      start + 180,
      async () => {
        const result = await db.from("provider_event_inbox").select("id");
        assert.ok(result.error);
        return result;
      },
      { workDeadlineAt: start + 90 },
    ).catch((error) => error);
    assert.ok(response);
    assert.ok(
      Date.now() - start < 700,
      "PostgREST includes body/retry delay in invocation deadline",
    );
    assert.equal(fetches, 1, "no retry-after sleep or retry hot loop");
    if (transport !== "retry") assert.equal(aborted, 1);
  }
  mode = "headers";
  await assert.rejects(() =>
    withWorkerDeadline(
      Date.now() + 300,
      async () => {
        const controller = new AbortController();
        controller.abort();
        const before = fetches;
        try {
          await workerProviderFetch("https://fixture.test/already-aborted", {
            signal: controller.signal,
          });
        } finally {
          assert.equal(fetches, before, "an already aborted request is never dispatched");
        }
      },
      { workDeadlineAt: Date.now() + 200 },
    ),
  );

  for (const transport of ["headers", "body"]) {
    mode = transport;
    fetches = 0;
    aborted = 0;
    const start = Date.now();
    await assert.rejects(() =>
      withWorkerDeadline(start + 240, () => stripe.paymentIntents.retrieve("pi_fixture"), {
        workDeadlineAt: start + 80,
      }),
    );
    assert.ok(Date.now() - start < 700);
    assert.equal(fetches, 1);
    assert.equal(aborted, 1);
  }

  mode = "body";
  fetches = 0;
  let sawUnknown = false;
  const start = Date.now();
  await assert.rejects(() =>
    withWorkerDeadline(
      start + 240,
      async () => {
        const { error } = await db.auth.signInWithOtp({
          email: "fixture@example.test",
          options: { shouldCreateUser: true },
        });
        assert.ok(error, "Auth deadline cannot look like accepted OTP");
        sawUnknown = error.status === 0 || error.status == null || error.status >= 500;
        mode = "success";
        assert.equal(
          (await db.rpc("mark_saas_checkout_fulfillment_delivery_unknown")).data,
          true,
          "DB settlement remains usable after provider deadline",
        );
      },
      { workDeadlineAt: start + 80 },
    ),
  );
  assert.equal(sawUnknown, true);
  assert.equal(fetches, 2);

  mode = "headers";
  fetches = 0;
  const parallelStart = Date.now();
  const results = await Promise.allSettled([
    withWorkerDeadline(
      parallelStart + 180,
      () => workerProviderFetch("https://fixture.test/slow"),
      { workDeadlineAt: parallelStart + 60 },
    ),
    withWorkerDeadline(
      parallelStart + 260,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 90));
        assert.equal(
          workerCanContinue(),
          true,
          "one invocation abort must not cancel a concurrent one",
        );
        mode = "success";
        return (await workerProviderFetch("https://fixture.test/fast")).json();
      },
      { workDeadlineAt: parallelStart + 240 },
    ),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(results[1].value, true);

  const outsideFetches = fetches;
  await assert.rejects(() =>
    withWorkerDeadline(Date.now() - 1, async () =>
      workerProviderFetch("https://fixture.test/late"),
    ),
  );
  assert.equal(fetches, outsideFetches);

  // Bundle both real adapters together so they share the actual AsyncLocalStorage instance.
  process.env = {
    ...originalEnv,
    PIPEDREAM_CLIENT_ID: "fixture-client",
    PIPEDREAM_CLIENT_SECRET: "fixture-secret",
    PIPEDREAM_PROJECT_ID: "proj_fixture",
    PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG: "google_calendar",
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fixture",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    VITE_SUPABASE_URL: "https://fixture.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    SUPABASE_BOOKING_WORKER_KEY: "worker_fixture",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    SAAS_BILLING_ENVIRONMENT: "test",
  };
  const { outputFiles } = await build({
    stdin: {
      contents: `
        export * as pd from "./src/lib/pipedream.server.ts";
        export * as worker from "./src/lib/worker-deadline.server.ts";
        export { createSupabaseAuthClient } from "./src/integrations/supabase/auth-server.server.ts";
        export { processCheckoutOtpOutbox } from "./src/lib/checkout-otp-outbox-worker.server.ts";
        export { reconcileBookingLifecycle } from "./src/lib/booking-reconciliation.server.ts";
      `,
      resolveDir: process.cwd(),
    },
    write: false,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    alias: { "@": path.resolve("src") },
    plugins: [
      {
        name: "no-browser",
        setup(api) {
          api.onResolve({ filter: /^@tanstack\/react-start\/server$/ }, () => ({
            path: "server",
            namespace: "fixture",
          }));
          api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: 'export function getRequest(){throw new Error("No browser context");}',
            loader: "js",
          }));
        },
      },
    ],
  });
  const shared = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
  );
  const context = {
    profileId: "fenced-profile",
    environment: "test",
    accountId: "apn_fenced",
    calendarId: "calendar@example.test",
    eventId: "0b12345",
    appointmentId: "appointment",
    summary: "Service",
    description: "Booking",
    startAt: "2030-01-02T12:00:00Z",
    endAt: "2030-01-02T13:00:00Z",
    timeZone: "UTC",
    attendeeEmail: "customer@example.test",
  };
  const token = () => Response.json({ access_token: "fixture-token", expires_in: 3600 });
  const isToken = (url) => new URL(url).pathname === "/v1/oauth/token";
  let permit = true;
  const dispatched = [];
  globalThis.fetch = async (url, init = {}) => {
    if (isToken(url)) {
      permit = false;
      return token();
    }
    dispatched.push(init.method ?? "GET");
    return Response.json({ ...JSON.parse(init.body), status: "confirmed" });
  };
  await assert.rejects(() =>
    shared.worker.withWorkerDeadline(
      Date.now() + 2_000,
      () => shared.pd.createGoogleBookingEvent(context),
      { workDeadlineAt: Date.now() + 1_000, canContinue: () => permit },
    ),
  );
  assert.deepEqual(dispatched, [], "a fence lost during token acquisition forbids the event POST");

  const deployment = {
    ...context,
    key: "google_calendar-new-or-updated-event-instant",
    version: "1.2.3",
    configuredProps: {
      googleCalendar: { authProvisionId: context.accountId },
      calendarIds: [context.calendarId],
      newOnly: false,
    },
  };
  permit = false;
  await assert.rejects(
    shared.worker.withWorkerDeadline(
      Date.now() + 1_000,
      () => shared.pd.deployPipedreamTrigger(deployment),
      {
        workDeadlineAt: Date.now() + 500,
        canContinue: () => permit,
      },
    ),
    {
      dispatched: false,
      requestOperation: "Pipedream trigger deployment",
      reason: "deadline_exceeded",
    },
  );
  assert.deepEqual(dispatched, [], "a stopped mutation reports no resource dispatch");

  // Force a cold machine token. Its transport is not the requested mutation's dispatch.
  const originalNow = Date.now;
  Date.now = () => originalNow() + 3_600_000;
  permit = true;
  try {
    await assert.rejects(
      shared.worker.withWorkerDeadline(
        Date.now() + 1_000,
        () => shared.pd.deployPipedreamTrigger(deployment),
        {
          workDeadlineAt: Date.now() + 500,
          canContinue: () => permit,
        },
      ),
      {
        dispatched: false,
        requestOperation: "Pipedream trigger deployment",
        reason: "deadline_exceeded",
      },
    );
  } finally {
    Date.now = originalNow;
  }
  assert.deepEqual(dispatched, [], "token-response stop never becomes a deployment POST");

  permit = true;
  globalThis.fetch = async (url) =>
    isToken(url) ? token() : Response.json({ data: [], page_info: {} });
  await shared.pd.listGoogleAccounts(context.profileId, "test");
  let refreshes = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (isToken(url)) {
      refreshes++;
      permit = false;
      return token();
    }
    dispatched.push(init.method);
    return Response.json({ code: "invalid_token" }, { status: 401 });
  };
  await assert.rejects(() =>
    shared.worker.withWorkerDeadline(
      Date.now() + 2_000,
      () => shared.pd.createGoogleBookingEvent(context),
      { workDeadlineAt: Date.now() + 1_000, canContinue: () => permit },
    ),
  );
  assert.equal(refreshes, 1);
  assert.deepEqual(dispatched, ["POST"], "401 refresh cannot dispatch again after fence loss");

  permit = true;
  let rejectedPosts = 0;
  let failedTokens = 0;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      failedTokens++;
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }
    rejectedPosts++;
    return Response.json({ code: "invalid_token" }, { status: 401 });
  };
  await assert.rejects(
    shared.worker.withWorkerDeadline(
      Date.now() + 2_000,
      () => shared.pd.deployPipedreamTrigger(deployment),
      {
        workDeadlineAt: Date.now() + 1_000,
      },
    ),
    (error) =>
      error instanceof shared.pd.PipedreamRequestError &&
      error.status === 401 &&
      error.operation === "Pipedream trigger deployment" &&
      error.requestOperation === error.operation &&
      error.dispatched === true &&
      error.layer === "pipedream",
    "machine refresh failure preserves the exact already-rejected deployment outcome",
  );
  assert.equal(rejectedPosts, 1);
  assert.equal(failedTokens, 1);

  for (const path of ["token", "resource"]) {
    permit = true;
    globalThis.fetch = async (url) =>
      isToken(url) ? token() : Response.json({ data: [], page_info: {} });
    await shared.pd.listGoogleAccounts(context.profileId, "test");
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      assert.equal(isToken(url), path === "token");
      permit = false;
      return Response.json({}, { status: 503 });
    };
    if (path === "token") {
      // Expire the cached token using a clock shift, not an extra provider operation.
      const now = Date.now;
      Date.now = () => now() + 3_600_000;
      try {
        await assert.rejects(() =>
          shared.worker.withWorkerDeadline(
            Date.now() + 2_000,
            () => shared.pd.listGoogleAccounts(context.profileId, "test"),
            { workDeadlineAt: Date.now() + 1_000, canContinue: () => permit },
          ),
        );
      } finally {
        Date.now = now;
      }
    } else {
      await assert.rejects(() =>
        shared.worker.withWorkerDeadline(
          Date.now() + 2_000,
          () => shared.pd.listGoogleAccounts(context.profileId, "test"),
          { workDeadlineAt: Date.now() + 1_000, canContinue: () => permit },
        ),
      );
    }
    assert.equal(calls, 1, `${path} retry must recheck shared continuation authority`);
  }

  let lateDispatches = 0;
  globalThis.fetch = async () => {
    lateDispatches++;
    return new Response(null, { status: 204 });
  };
  await assert.rejects(() =>
    shared.worker.withWorkerDeadline(
      Date.now() + 600,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return shared.pd.deleteGoogleBookingEvent({ ...context, ifMatch: '"etag"' });
      },
      { workDeadlineAt: Date.now() + 20 },
    ),
  );
  assert.equal(lateDispatches, 0, "Pipedream obeys the worker work deadline without its own scope");

  for (const hang of ["headers", "body"]) {
    let cancelled = false;
    let signal;
    globalThis.fetch = async (_url, init) => {
      signal = init.signal;
      if (hang === "headers") return new Promise(() => {});
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"unfinished":'));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    };
    const now = Date.now();
    await assert.rejects(() =>
      shared.worker.withWorkerDeadline(
        now + 600,
        () =>
          shared.pd.withPipedreamDeadline(now + 2_000, () =>
            shared.pd.listGoogleAccounts(context.profileId, "test"),
          ),
        { workDeadlineAt: now + 70 },
      ),
    );
    assert.ok(Date.now() - now < 350, "shared work deadline bounds headers and response bodies");
    assert.equal(signal.aborted, true);
    if (hang === "body") assert.equal(cancelled, true);
  }

  const sharedDb = createClient("https://fixture.supabase.co", "sb_publishable_fixture", {
    global: { fetch: shared.worker.workerSupabaseFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  globalThis.fetch = async (url) => {
    if (new URL(url).hostname === "fixture.supabase.co") return Response.json(true);
    return new Response(new ReadableStream({}));
  };
  const reserveStart = Date.now();
  await shared.worker.withWorkerDeadline(
    reserveStart + 600,
    async () => {
      await assert.rejects(() => shared.pd.listGoogleAccounts(context.profileId, "test"));
      assert.equal(
        (await sharedDb.rpc("settle_provider_failure")).data,
        true,
        "Pipedream work timeout leaves DB settlement authority available",
      );
    },
    { workDeadlineAt: reserveStart + 60 },
  );

  globalThis.fetch = async (url) =>
    isToken(url) ? token() : Response.json({ data: [], page_info: {} });
  await shared.pd.listGoogleAccounts(context.profileId, "test");
  for (const status of [401, 403, 429]) {
    let calls = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).hostname === "fixture.supabase.co") return Response.json(true);
      calls++;
      assert.equal(isToken(url), false);
      return new Response(new ReadableStream({}), { status });
    };
    const now = Date.now();
    await shared.worker.withWorkerDeadline(
      now + 600,
      async () => {
        await assert.rejects(
          () =>
            shared.pd.deployPipedreamTrigger({
              ...context,
              key: "google_calendar-new-or-updated-event-instant",
              version: "0.1.20",
              configuredProps: {},
            }),
          { status },
        );
        assert.equal((await sharedDb.rpc("settle_known_provider_rejection")).data, true);
      },
      { workDeadlineAt: now + 60 },
    );
    assert.equal(
      calls,
      1,
      "worker-budget diagnostic timeout preserves status without retry/refresh",
    );
  }

  for (const outcome of ["success", "delayed_body", "malformed", "no_response", "stalled_body"]) {
    permit = true;
    let calls = 0;
    let transportSignal;
    let bodyCancelled = false;
    let observed;
    const resource = {
      id: "dc_outcome",
      component_id: "sc_pinned",
      active: true,
      configured_props: deployment.configuredProps,
    };
    globalThis.fetch = async (url, init) => {
      if (new URL(url).hostname === "fixture.supabase.co") return Response.json(true);
      calls++;
      assert.equal(isToken(url), false);
      transportSignal = init.signal;
      permit = false;
      if (outcome === "no_response") return new Promise(() => {});
      if (outcome === "malformed") return new Response('{"data":');
      if (outcome === "stalled_body")
        return new Response(
          new ReadableStream({
            cancel() {
              bodyCancelled = true;
            },
          }),
        );
      if (outcome === "delayed_body")
        return new Response(
          new ReadableStream({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode(JSON.stringify({ data: resource })));
                controller.close();
              }, 110);
            },
          }),
        );
      return Response.json({ data: resource });
    };
    const at = Date.now();
    await shared.worker.withWorkerDeadline(
      at + 800,
      async () => {
        await shared.pd.withPipedreamDeadline(
          at + 80,
          async () => {
            try {
              observed = await shared.pd.deployPipedreamTrigger(deployment);
            } catch (error) {
              observed = error;
            }
            assert.equal((await sharedDb.rpc("settle_returned_deployment_outcome")).data, true);
          },
          { settlementDeadlineAt: at + 350 },
        );
      },
      { workDeadlineAt: at + 80, canContinue: () => permit },
    );
    if (outcome === "success" || outcome === "delayed_body") {
      assert.equal(
        observed.id,
        resource.id,
        "returned identity is parsed even after dispatch permission ends",
      );
      assert.equal(observed.componentId, resource.component_id);
    } else {
      assert.equal(observed.dispatched, true);
      assert.equal(observed.status, outcome === "no_response" ? 0 : 200);
      assert.equal(
        observed.reason,
        outcome === "malformed" ? "invalid_response" : "deadline_exceeded",
      );
    }
    assert.equal(calls, 1, "no retry/read/new effect after stop");
    assert.ok(Date.now() - at < 650, "response observation has a hard bounded settlement deadline");
    if (outcome === "no_response" || outcome === "stalled_body")
      assert.equal(transportSignal.aborted, true);
    if (outcome === "stalled_body") assert.equal(bodyCancelled, true);
  }

  for (const method of ["POST", "DELETE"]) {
    let calls = 0;
    let nowOffset = 0;
    const now = Date.now;
    const at = now();
    let result;
    globalThis.fetch = async () => {
      calls++;
      // Work time elapsed while the response reached us, but settlement is still open.
      nowOffset = 200;
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({
        id: context.eventId,
        status: "confirmed",
        etag: '"returned"',
        start: { dateTime: context.startAt },
        end: { dateTime: context.endAt },
        attendees: [{ email: context.attendeeEmail }],
        extendedProperties: { private: { obraAppointmentId: context.appointmentId } },
      });
    };
    Date.now = () => now() + nowOffset;
    try {
      await shared.worker.withWorkerDeadline(
        at + 800,
        async () => {
          result =
            method === "POST"
              ? await shared.pd.createGoogleBookingEvent(context)
              : await shared.pd.deleteGoogleBookingEvent({ ...context, ifMatch: '"read-etag"' });
          await assert.rejects(
            () => shared.pd.deleteGoogleBookingEvent({ ...context, ifMatch: '"another"' }),
            { dispatched: false, reason: "deadline_exceeded" },
          );
        },
        { workDeadlineAt: at + 100 },
      );
    } finally {
      Date.now = now;
    }
    assert.equal(calls, 1, "observing an accepted event outcome cannot permit a second write");
    if (method === "POST") assert.equal(result.id, context.eventId);
  }

  let parsedRejection;
  let rejectionCalls = 0;
  permit = true;
  globalThis.fetch = async () => {
    rejectionCalls++;
    permit = false;
    return Response.json(
      { error: { code: 403, errors: [{ domain: "global", reason: "insufficientPermissions" }] } },
      { status: 403 },
    );
  };
  await shared.worker.withWorkerDeadline(
    Date.now() + 800,
    async () => {
      try {
        await shared.pd.createGoogleBookingEvent(context);
      } catch (error) {
        parsedRejection = error;
      }
    },
    { workDeadlineAt: Date.now() + 400, canContinue: () => permit },
  );
  assert.equal(rejectionCalls, 1);
  assert.equal(parsedRejection.dispatched, true);
  assert.equal(parsedRejection.layer, "google");
  assert.equal(parsedRejection.reason, "insufficientPermissions");
  assert.equal(
    shared.pd.classifyPipedreamFailure(parsedRejection),
    "permissions",
    "known machine reasons survive a continuation stop, not just status-only diagnostics",
  );

  // Actual Auth SDK: rejection headers survive failed diagnostics without a made-up reason code.
  for (const status of [401, 403, 429, 503]) {
    for (const diagnostic of ["complete", "stalled", "malformed", "large", "empty"]) {
      let requests = 0;
      globalThis.fetch = async () => {
        requests++;
        if (diagnostic === "stalled") return new Response(new ReadableStream({}), { status });
        if (diagnostic === "malformed") return new Response("{", { status });
        if (diagnostic === "large") return new Response("x".repeat(16_385), { status });
        if (diagnostic === "empty") return new Response(null, { status });
        return Response.json({ message: "fixture rejection" }, { status });
      };
      const at = Date.now();
      await shared.worker.withWorkerDeadline(
        at + 500,
        async () => {
          const { error } = await shared
            .createSupabaseAuthClient()
            .auth.signInWithOtp({ email: "fixture@example.test" });
          assert.equal(error.status, status, `${status}/${diagnostic}`);
          assert.equal(error.code, undefined, "transport cannot invent an Auth machine reason");
        },
        { workDeadlineAt: at + 70 },
      );
      assert.equal(requests, 1);
    }
  }

  const rejectedStripe = new Stripe("sk_test_fixture", {
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(shared.worker.workerProviderFetch),
  });
  for (const status of [401, 429, 503]) {
    globalThis.fetch = async () => new Response(new ReadableStream({}), { status });
    let error;
    const at = Date.now();
    await shared.worker.withWorkerDeadline(
      at + 500,
      async () => {
        try {
          await rejectedStripe.paymentIntents.retrieve("pi_fixture");
        } catch (cause) {
          error = cause;
        }
      },
      { workDeadlineAt: at + 60 },
    );
    assert.equal(error.statusCode, status, "fallback diagnostics preserve real Stripe SDK status");
    assert.equal(
      error.type,
      status === 401
        ? "StripeAuthenticationError"
        : status === 429
          ? "StripeRateLimitError"
          : "StripeAPIError",
    );
  }

  for (const responseKind of [
    "429_complete",
    "429_stalled",
    "401_stalled",
    "success_stalled",
    "success_invalid",
    "missing",
    "lease_lost",
  ]) {
    const rpc = [];
    let sends = 0;
    let cancelled = false;
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://fixture.supabase.co");
      if (parsed.pathname === "/auth/v1/otp") {
        sends++;
        if (responseKind === "missing") return new Promise(() => {});
        if (responseKind === "success_invalid") return new Response("{");
        if (responseKind === "429_complete")
          return Response.json({ message: "fixture limited" }, { status: 429 });
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          {
            status: responseKind.startsWith("429")
              ? 429
              : responseKind.startsWith("401")
                ? 401
                : 200,
          },
        );
      }
      const name = parsed.pathname.split("/").at(-1);
      const args = JSON.parse(init.body ?? "{}");
      rpc.push({ name, args });
      if (name === "claim_due_saas_checkout_fulfillment")
        return Response.json([
          { id: "otp-fixture", recipient_email: "fixture@example.test", fencing_token: 17 },
        ]);
      if (name === "renew_saas_checkout_fulfillment" && responseKind === "lease_lost")
        return Response.json(false);
      return Response.json(true);
    };
    const at = Date.now();
    const result = await shared.worker
      .withWorkerDeadline(at + 700, () => shared.processCheckoutOtpOutbox(1), {
        workDeadlineAt: at + 90,
      })
      .catch((error) => error);
    const settlement = rpc.find(
      ({ name }) =>
        name === "complete_saas_checkout_fulfillment" ||
        name === "mark_saas_checkout_fulfillment_delivery_unknown" ||
        name === "defer_saas_checkout_fulfillment",
    );
    assert.ok(settlement, responseKind);
    assert.equal(
      settlement.args.p_lease_token,
      rpc[0].args.p_lease_token,
      "original OTP claim owns result settlement",
    );
    assert.equal(settlement.args.p_fencing_token, 17);
    assert.equal(sends, responseKind === "lease_lost" ? 0 : 1);
    if (responseKind.startsWith("429") || responseKind.startsWith("401")) {
      assert.equal(settlement.name, "complete_saas_checkout_fulfillment");
      assert.equal(settlement.args.p_succeeded, false);
      assert.equal(settlement.args.p_retryable, responseKind.startsWith("429"));
      if (responseKind.endsWith("stalled"))
        assert.equal(
          result.name,
          "WorkerDeadlineError",
          "settled rejection still reports a stopped lane",
        );
      else assert.deepEqual(result, { checked: 1, accepted: 0 });
    } else if (responseKind === "lease_lost")
      assert.equal(settlement.name, "defer_saas_checkout_fulfillment");
    else assert.equal(settlement.name, "mark_saas_checkout_fulfillment_delivery_unknown");
    if (responseKind.endsWith("stalled")) assert.equal(cancelled, true);
    assert.ok(Date.now() - at < 500, "OTP diagnostics cannot spend the whole invocation");
  }

  // A durable intent is not evidence that Auth was contacted. Exercise the worker
  // and installed SDK through both the worker check and the last transport fence.
  for (const stop of [
    "begin_deadline",
    "begin_fence",
    "auth_transport_fence",
    "begin_response_lost",
    "begin_response_malformed",
    "begin_not_committed",
  ]) {
    const originalNow = Date.now;
    const fixtureEnv = process.env;
    const at = originalNow();
    let now = at;
    let permit = true;
    let stopping = true;
    let sends = 0;
    const rpc = [];
    Date.now = () => now;
    process.env = new Proxy(fixtureEnv, {
      get(target, key) {
        if (stopping && stop === "auth_transport_fence" && key === "SUPABASE_PUBLISHABLE_KEY")
          permit = false;
        return Reflect.get(target, key);
      },
    });
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://fixture.supabase.co");
      if (parsed.pathname === "/auth/v1/otp") {
        sends++;
        return Response.json({});
      }
      const name = parsed.pathname.split("/").at(-1);
      const args = JSON.parse(init.body ?? "{}");
      rpc.push({ name, args });
      if (name === "claim_due_saas_checkout_fulfillment")
        return Response.json([
          { id: "otp-unsent", recipient_email: "fixture@example.test", fencing_token: 18 },
        ]);
      if (stopping && name === "begin_saas_checkout_fulfillment_dispatch") {
        if (stop === "begin_deadline") now = at + 101;
        if (stop === "begin_fence") permit = false;
        if (stop === "begin_response_lost") throw new Error("fixture begin response lost");
        if (stop === "begin_response_malformed") return new Response("{");
        if (stop === "begin_not_committed") return Response.json(false);
      }
      return Response.json(true);
    };
    try {
      const stopped = await shared.worker
        .withWorkerDeadline(at + 1_000, () => shared.processCheckoutOtpOutbox(1), {
          workDeadlineAt: at + 100,
          canContinue: () => permit,
        })
        .catch((error) => {
          assert.equal(error.name, "WorkerDeadlineError");
          return error;
        });
      if (["begin_deadline", "begin_fence", "auth_transport_fence"].includes(stop))
        assert.equal(stopped.name, "WorkerDeadlineError", "a stopped lane cannot report success");
      assert.equal(sends, 0, stop + " has no Auth dispatch");
      assert.equal(
        rpc.some(({ name }) => name === "mark_saas_checkout_fulfillment_delivery_unknown"),
        false,
        stop + " must not strand a known-unsent OTP as provider ambiguity",
      );
      const completion = rpc.find(({ name }) => name === "defer_saas_checkout_fulfillment");
      assert.ok(completion, stop + " settles through the existing retry authority");
      assert.equal(completion.args.p_fencing_token, 18);
      assert.equal(completion.args.p_lease_token, rpc[0].args.p_lease_token);

      stopping = false;
      permit = true;
      now = at;
      assert.deepEqual(
        await shared.worker.withWorkerDeadline(
          at + 1_000,
          () => shared.processCheckoutOtpOutbox(1),
          {
            workDeadlineAt: at + 500,
            canContinue: () => permit,
          },
        ),
        { checked: 1, accepted: 1 },
      );
      assert.equal(sends, 1, "the retained obligation can send once after continuation recovers");
      assert.equal(rpc.at(-1).name, "complete_saas_checkout_fulfillment");
      assert.equal(rpc.at(-1).args.p_succeeded, true);
    } finally {
      Date.now = originalNow;
      process.env = fixtureEnv;
    }
  }

  // Exercise the actual booking worker, provider parser and ETag DELETE transport together.
  for (const drift of [
    { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=20"] },
    { recurringEventId: "series-parent" },
    { originalStartTime: { dateTime: context.startAt } },
    { endTimeUnspecified: true },
    null,
  ]) {
    let claimed = false;
    let deleted = false;
    const methods = [];
    const observations = [];
    const claim = {
      link: {
        id: "link",
        appointment_id: context.appointmentId,
        profile_id: context.profileId,
        environment: "test",
        google_event_id: context.eventId,
        desired_state: "absent",
        desired_generation: 2,
        snapshot_appointment_version: 1,
        reconcile_fencing_token: 3,
      },
      appointment: {
        id: context.appointmentId,
        public_reference: "fixture",
        start_at: context.startAt,
        end_at: context.endAt,
        time_zone: "UTC",
        customer_snapshot: { email: context.attendeeEmail },
        service_snapshot: { name: "Service" },
      },
      epoch: {
        id: "epoch",
        pipedream_account_id: context.accountId,
        google_calendar_id: context.calendarId,
      },
    };
    globalThis.fetch = async (url, init = {}) => {
      const parsed = new URL(url);
      if (parsed.hostname === "fixture.supabase.co") {
        const name = parsed.pathname.split("/").at(-1);
        const args = JSON.parse(init.body ?? "{}");
        if (name === "claim_booking_calendar_reconciliation") {
          const rows = claimed ? [] : [claim];
          claimed = true;
          return Response.json(rows);
        }
        if (name === "record_booking_calendar_observation") {
          observations.push(args.p_observed_state);
          return Response.json({
            action:
              args.p_observed_state === "conflict"
                ? "manual_repair"
                : args.p_phase === "probe"
                  ? "delete"
                  : "converged",
          });
        }
        if (name === "begin_booking_calendar_effect") return Response.json("effect");
        if (name.startsWith("claim_")) return Response.json([]);
        if (name.startsWith("expire_")) return Response.json(0);
        return Response.json(true);
      }
      assert.equal(parsed.origin, "https://api.pipedream.com");
      if (isToken(url)) return token();
      methods.push(init.method);
      if (init.method === "DELETE") {
        assert.equal(new Headers(init.headers).get("x-pd-proxy-if-match"), '"edited-v2"');
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return Response.json(
        deleted
          ? { id: context.eventId, status: "cancelled" }
          : {
              id: context.eventId,
              status: "confirmed",
              etag: '"edited-v2"',
              start: { dateTime: context.startAt },
              end: { dateTime: context.endAt },
              attendees: [{ email: context.attendeeEmail }],
              extendedProperties: { private: { obraAppointmentId: context.appointmentId } },
              ...drift,
            },
      );
    };
    const result = await shared.worker.withWorkerDeadline(
      Date.now() + 25_000,
      () => shared.reconcileBookingLifecycle("test", () => true, Date.now() + 23_000),
      { workDeadlineAt: Date.now() + 20_000 },
    );
    assert.equal(deleted, drift === null);
    assert.equal(methods.filter((method) => method === "DELETE").length, drift === null ? 1 : 0);
    assert.equal(result.googleReconciled, drift === null ? 1 : 0);
    assert.deepEqual(observations, drift === null ? ["present", "absent"] : ["conflict"]);
  }

  let childSignal;
  let child;
  const parentFailure = new Error("parent task failed");
  globalThis.fetch = async (_url, init) => {
    childSignal = init.signal;
    return new Response(new ReadableStream({}));
  };
  await assert.rejects(
    shared.worker.withWorkerDeadline(
      Date.now() + 2_000,
      async () => {
        child = shared.worker.withWorkerDeadline(
          Date.now() + 1_500,
          () => shared.pd.listGoogleAccounts(context.profileId, "test"),
          { workDeadlineAt: Date.now() + 1_000 },
        );
        await Promise.all([
          child,
          (async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            throw parentFailure;
          })(),
        ]);
      },
      { workDeadlineAt: Date.now() + 1_600 },
    ),
    (error) => error === parentFailure,
  );
  await assert.rejects(child);
  assert.equal(childSignal.aborted, true, "closing a worker parent cancels a nested provider body");

  let slowCancelled = false;
  globalThis.fetch = async (url) => {
    if (isToken(url)) return token();
    if (new URL(url).searchParams.get("external_user_id").endsWith(":short"))
      return new Response(
        new ReadableStream({
          cancel() {
            slowCancelled = true;
          },
        }),
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
    return Response.json({ data: [], page_info: {} });
  };
  const independentStart = Date.now();
  const independent = await Promise.allSettled([
    shared.worker.withWorkerDeadline(
      independentStart + 600,
      () => shared.pd.listGoogleAccounts("short", "test"),
      { workDeadlineAt: independentStart + 50 },
    ),
    shared.worker.withWorkerDeadline(
      independentStart + 900,
      () => shared.pd.listGoogleAccounts("long", "test"),
      { workDeadlineAt: independentStart + 600 },
    ),
  ]);
  assert.equal(independent[0].status, "rejected");
  assert.equal(
    independent[1].status,
    "fulfilled",
    "one worker deadline cannot cancel another worker's Pipedream call",
  );
  assert.equal(slowCancelled, true);

  const binary = new Uint8Array([0, 1, 127, 255]);
  globalThis.fetch = async (url, init) => {
    const request = new Request(url, init);
    assert.equal(request.headers.get("apikey"), "fixture-key");
    assert.equal(request.headers.get("authorization"), "Bearer fixture-authority");
    assert.equal(request.method, "POST");
    assert.equal(await request.text(), "fixture-body");
    return new Response(binary, { headers: { "content-type": "image/png" } });
  };
  const requestInput = () =>
    new Request("https://fixture.supabase.co/storage/v1/object/fixture", {
      method: "POST",
      body: "fixture-body",
      headers: { authorization: "Bearer fixture-authority", apikey: "fixture-key" },
    });
  for (const scoped of [false, true]) {
    const work = () => workerSupabaseFetch(requestInput());
    const response = scoped
      ? await withWorkerDeadline(Date.now() + 600, work, { workDeadlineAt: Date.now() + 400 })
      : await work();
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(
      new Uint8Array(await response.arrayBuffer()),
      binary,
      "borrowed Request body/headers and binary responses survive scoped and unscoped fetch",
    );
  }

  console.log(
    "test-worker-deadline: passed (real SDKs; Pipedream dispatch/refresh fences, full bodies, shared work deadlines, settlement reserve)",
  );
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  await bundle.cleanup();
}
