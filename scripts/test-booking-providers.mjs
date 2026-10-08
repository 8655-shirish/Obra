import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
try {
  process.env.STRIPE_SECRET_KEY = "sk_test_acceptance";
  process.env.STRIPE_PRICE_STARTER = "price_starter";
  process.env.STRIPE_PRICE_PRO = "price_pro";
  process.env.SAAS_BILLING_ENVIRONMENT = "test";
  process.env.PUBLIC_APP_URL = "https://app.example.test";
  const stripeBundle = await importWithMocks(path.resolve("src/lib/stripe.server.ts"), {});
  const stripe = stripeBundle.subject;
  assert.equal(stripe.billingEnvironment(), "test");
  process.env.STRIPE_SECRET_KEY = "sk_live_acceptance";
  process.env.SAAS_BILLING_ENVIRONMENT = "live";
  assert.equal(stripe.billingEnvironment(), "live");
  process.env.STRIPE_SECRET_KEY = "rk_test_wrong_authority";
  assert.throws(() => stripe.billingEnvironment(), /Stripe secret key mode is invalid/);
  process.env.STRIPE_SECRET_KEY = "sk_test_acceptance";
  process.env.SAAS_BILLING_ENVIRONMENT = "test";
  assert.equal(stripe.publicAppUrl(), "https://app.example.test");
  for (const origin of [
    "http://example.test",
    "https://u:p@example.test",
    "https://example.test/path",
    "https://example.test/?q=1",
  ]) {
    process.env.PUBLIC_APP_URL = origin;
    assert.throws(() => stripe.publicAppUrl(), /bare HTTPS origin/);
  }
  process.env.PUBLIC_APP_URL = "http://localhost:3000";
  assert.equal(stripe.publicAppUrl(), "http://localhost:3000");
  assert.equal(stripe.priceIdForPlan("pro"), "price_pro");
  assert.equal(stripe.planForPriceId("price_starter"), "starter");
  assert.equal(stripe.planForPriceId("price_unknown"), null);
  await stripeBundle.cleanup();

  process.env.RESEND_API_KEY_TEST = "resend-test";
  process.env.BOOKING_EMAIL_FROM_TEST = "bookings@example.test";
  const notices = await importWithMocks(
    path.resolve("src/lib/booking-notifications.server.ts"),
    {},
  );
  const base = {
    environment: "test",
    idempotencyKey: "booking-notify:confirmed:apt:customer",
    type: "confirmed",
    audience: "customer",
    recipientEmail: "customer@example.test",
    appointment: {
      public_reference: "11111111-1111-1111-1111-111111111111",
      start_at: "2030-01-02T17:00:00.000Z",
      time_zone: "America/New_York",
      service_snapshot: { name: "Repair" },
      appointment_state: "confirmed",
      calendar_state: "created",
      cancellation_requested_at: null,
    },
  };
  const dispatch = {
    environment: base.environment,
    idempotencyKey: base.idempotencyKey,
    payload: notices.subject.buildBookingNotificationPayload(base),
    dispatchDeadlineAt: performance.now() + 10_000,
  };
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ id: "email_acceptance_1" }), { status: 200 });
  };
  assert.deepEqual(await notices.subject.sendBookingNotification(dispatch), {
    notificationId: "email_acceptance_1",
  });
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers["Idempotency-Key"], base.idempotencyKey);
  assert.equal(typeof dispatch.payload, "string");
  assert.equal(request.init.body, dispatch.payload);
  const message = JSON.parse(request.init.body);
  assert.deepEqual(message.to, ["customer@example.test"]);
  assert.match(message.subject, /confirmed/);
  assert.match(message.text, /Repair is confirmed/);
  assert.match(message.text, /America\/New_York/);
  delete process.env.BOOKING_EMAIL_FROM_TEST;
  assert.throws(
    () => notices.subject.buildBookingNotificationPayload(base),
    (error) =>
      error.name === "BookingNotificationProviderError" &&
      error.retryable === false &&
      error.message === "BOOKING_EMAIL_FROM_TEST is not configured",
  );
  assert.deepEqual(await notices.subject.sendBookingNotification(dispatch), {
    notificationId: "email_acceptance_1",
  });
  request = null;
  await assert.rejects(
    () =>
      notices.subject.sendBookingNotification({
        ...dispatch,
        dispatchDeadlineAt: performance.now() - 1,
      }),
    /dispatch authorization expired/,
  );
  assert.equal(request, null, "expired dispatch authority performs no provider request");
  process.env.BOOKING_EMAIL_FROM_TEST = "bookings@example.test";
  globalThis.fetch = async () => new Response("provider down", { status: 503 });
  await assert.rejects(() => notices.subject.sendBookingNotification(dispatch), /returned 503/);
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  await assert.rejects(() => notices.subject.sendBookingNotification(dispatch), /no identity/);
  globalThis.fetch = async () => new Response("x".repeat(16_385), { status: 200 });
  await assert.rejects(
    () => notices.subject.sendBookingNotification(dispatch),
    /response is invalid/,
  );
  await notices.cleanup();
  console.log(
    "OK: Resend serialized payload, sender validation, dispatch deadline and response handling",
  );

  process.env.PIPEDREAM_CLIENT_ID = "client";
  process.env.PIPEDREAM_CLIENT_SECRET = "secret";
  process.env.PIPEDREAM_PROJECT_ID = "project";
  process.env.PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG = "google_calendar";
  process.env.PUBLIC_APP_URL = "https://app.example.test";
  const calls = [];
  let proxyDeleteStatus = 204;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/oauth/token"))
      return new Response(JSON.stringify({ access_token: "token", expires_in: 3600 }), {
        status: 200,
      });
    if (String(url).endsWith("/v1/connect/project/tokens"))
      return new Response(
        JSON.stringify({
          connect_link_url:
            "https://pipedream.com/_static/connect.html?token=connect-token&connectLink=true",
          expires_at: "2030-01-02T17:00:00.000Z",
        }),
        { status: 200 },
      );
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          ...body,
          id: body.id ?? "generated-probe-id",
          iCalUID: "ical",
          etag: '"etag"',
          extendedProperties: body.extendedProperties,
        }),
        { status: 200 },
      );
    }
    if (init.method === "DELETE") {
      if (String(url).includes("/proxy/"))
        return proxyDeleteStatus === 410
          ? Response.json(
              { error: { code: 410, errors: [{ domain: "global", reason: "deleted" }] } },
              { status: 410 },
            )
          : new Response(null, { status: proxyDeleteStatus });
      return new Response(null, { status: 204 });
    }
    return new Response(
      JSON.stringify({
        id: "obra-event",
        status: "confirmed",
        start: { dateTime: "2030-01-02T17:00:00Z" },
        end: { dateTime: "2030-01-02T18:00:00Z" },
        attendees: [{ email: "c@example.test" }],
        extendedProperties: { private: { obraAppointmentId: "apt-1" } },
      }),
      { status: 200 },
    );
  };
  const google = await importWithMocks(path.resolve("src/lib/pipedream.server.ts"), {});
  assert.equal(google.subject.pipedreamExternalUserId("profile-1", "test"), "obra:test:profile-1");
  const connectLink = await google.subject.createGoogleConnectLink({
    profileId: "profile-1",
    environment: "test",
    websiteId: "11111111-1111-4111-8111-111111111111",
  });
  const connectUrl = new URL(connectLink.url);
  assert.equal(connectUrl.searchParams.get("token"), "connect-token");
  assert.equal(connectUrl.searchParams.get("connectLink"), "true");
  assert.equal(connectUrl.searchParams.get("app"), "google_calendar");
  for (const configured of ["google-calendar", "google calendar", "Google Calendar"]) {
    process.env.PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG = configured;
    const aliased = await google.subject.createGoogleConnectLink({
      profileId: "profile-1",
      environment: "test",
      websiteId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(new URL(aliased.url).searchParams.get("app"), "google_calendar", configured);
  }
  process.env.PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG = "google_calendar";
  const connectCall = calls.find((call) => call.url.endsWith("/v1/connect/project/tokens"));
  assert.ok(connectCall, "Pipedream Connect token is requested");
  const oauthCall = calls.find((call) => call.url.endsWith("/v1/oauth/token"));
  assert.equal(
    JSON.parse(oauthCall.init.body).scope,
    "connect:*",
    "server token uses the verified Connect-wide scope, not unrestricted workspace access",
  );
  assert.deepEqual(JSON.parse(connectCall.init.body), {
    external_user_id: "obra:test:profile-1",
    allowed_origins: ["https://app.example.test"],
    success_redirect_uri:
      "https://app.example.test/user/profile-1?websiteId=11111111-1111-4111-8111-111111111111&connect=success",
    error_redirect_uri:
      "https://app.example.test/user/profile-1?websiteId=11111111-1111-4111-8111-111111111111&connect=error",
    expires_in: 900,
    scope: "connect:accounts:read connect:accounts:write",
    allow_progressive_scopes: false,
  });
  delete process.env.PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG;
  const callsBeforeInvalidConnect = calls.length;
  await assert.rejects(
    () =>
      google.subject.createGoogleConnectLink({
        profileId: "profile-1",
        environment: "test",
        websiteId: "11111111-1111-4111-8111-111111111111",
      }),
    /PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG is not configured/,
  );
  assert.equal(
    calls.length,
    callsBeforeInvalidConnect,
    "invalid app config fails before Pipedream",
  );
  process.env.PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG = "google_calendar";
  await assert.rejects(
    () =>
      google.subject.proxyGoogleCalendar({
        profileId: "p",
        environment: "test",
        accountId: "bad",
        target: new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList"),
      }),
    /Invalid Pipedream account identity/,
  );
  await assert.rejects(
    () =>
      google.subject.proxyGoogleCalendar({
        profileId: "p",
        environment: "test",
        accountId: "apn_ok",
        target: new URL("https://evil.example/calendar"),
      }),
    /Unsupported Google Calendar proxy target/,
  );
  const event = await google.subject.createGoogleBookingEvent({
    profileId: "profile-1",
    environment: "test",
    accountId: "apn_acceptance",
    calendarId: "primary",
    eventId: "obra-event",
    summary: "Repair",
    description: "Booked",
    startAt: "2030-01-02T17:00:00Z",
    endAt: "2030-01-02T18:00:00Z",
    timeZone: "UTC",
    attendeeEmail: "c@example.test",
    appointmentId: "apt-1",
  });
  assert.equal(event.id, "obra-event");
  const proxyCall = calls.find(
    (call) => call.url.includes("/proxy/") && call.init.method === "POST",
  );
  assert.ok(proxyCall, "Google create reaches Pipedream proxy");
  const providerBody = JSON.parse(proxyCall.init.body);
  assert.equal(providerBody.extendedProperties.private.obraAppointmentId, "apt-1");
  assert.equal(providerBody.attendees[0].email, "c@example.test");
  assert.equal(proxyCall.init.headers["x-pd-environment"], "development");
  const proxyTarget = (call) =>
    new URL(
      Buffer.from(
        decodeURIComponent(new URL(call.url).pathname.split("/proxy/")[1]),
        "base64",
      ).toString(),
    );
  assert.equal(proxyTarget(proxyCall).searchParams.get("sendUpdates"), "all");
  await google.subject.verifyGoogleCalendarWrite({
    profileId: "profile-1",
    environment: "test",
    accountId: "apn_acceptance",
    calendarId: "primary",
  });
  const probePost = calls.find((call) => {
    if (!call.url.includes("/proxy/") || call.init.method !== "POST") return false;
    try {
      return JSON.parse(call.init.body).extendedProperties?.private?.obraVerification === "true";
    } catch {
      return false;
    }
  });
  assert.ok(probePost, "write probe reaches Pipedream proxy");
  assert.equal("id" in JSON.parse(probePost.init.body), false);
  assert.equal(proxyTarget(probePost).searchParams.get("sendUpdates"), "none");
  assert.equal("attendees" in JSON.parse(probePost.init.body), false);
  assert.deepEqual(JSON.parse(probePost.init.body).reminders, { useDefault: false });
  const probeDelete = calls.find(
    (call) => call.url.includes("/proxy/") && call.init.method === "DELETE",
  );
  assert.equal(proxyTarget(probeDelete).searchParams.get("sendUpdates"), "none");
  proxyDeleteStatus = 410;
  await google.subject.verifyGoogleCalendarWrite({
    profileId: "profile-1",
    environment: "test",
    accountId: "apn_acceptance",
    calendarId: "primary",
  });
  await google.subject.deletePipedreamAccount({
    profileId: "profile-1",
    environment: "test",
    accountId: "apn_acceptance",
  });
  const accountDelete = calls.find(
    (call) =>
      call.url.includes("/v1/connect/project/accounts/apn_acceptance?") &&
      call.init.method === "DELETE",
  );
  assert.ok(accountDelete, "Pipedream account disconnect issues provider DELETE");
  assert.match(accountDelete.url, /external_user_id=obra%3Atest%3Aprofile-1/);
  assert.equal(accountDelete.init.headers["x-pd-environment"], "development");

  const deployedInput = { profileId: "profile-1", environment: "test" };
  const deployedTrigger = {
    id: "dc_first",
    component_id: "sc_calendar",
    component_key: "google_calendar-new-or-updated-event-instant",
    configured_props: {
      googleCalendar: { authProvisionId: "apn_acceptance" },
      calendarIds: ["primary"],
    },
    active: true,
    type: "DeployedComponent",
  };
  const parsedTrigger = {
    id: deployedTrigger.id,
    componentId: deployedTrigger.component_id,
    componentKey: deployedTrigger.component_key,
    configuredProps: deployedTrigger.configured_props,
    active: true,
    webhookSigningKey: null,
  };
  function serveDeployedPages(pages) {
    const requestedCursors = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input);
      const index = requestedCursors.length;
      assert.equal(url.origin, "https://api.pipedream.com");
      assert.equal(url.pathname, "/v1/connect/project/deployed-triggers");
      assert.equal(init.method ?? "GET", "GET");
      assert.equal(init.headers.authorization, "Bearer token");
      assert.equal(init.headers["x-pd-environment"], "development");
      assert.equal(url.searchParams.get("external_user_id"), "obra:test:profile-1");
      assert.equal(url.searchParams.get("limit"), "100");
      assert.equal(
        url.searchParams.get("after"),
        index ? pages[index - 1].page_info.end_cursor : null,
      );
      requestedCursors.push(url.searchParams.get("after"));
      assert.ok(index < pages.length, "must not request another page after a terminal response");
      return Response.json(pages[index]);
    };
    return requestedCursors;
  }
  for (const cursor of [{}, { end_cursor: null }, { end_cursor: "" }]) {
    for (const data of [[], [deployedTrigger]]) {
      const requested = serveDeployedPages([
        { data, page_info: { count: data.length, total_count: data.length, ...cursor } },
      ]);
      assert.deepEqual(
        await google.subject.listDeployedPipedreamTriggers(deployedInput),
        data.length ? [parsedTrigger] : [],
        "optional terminal cursor works for empty and populated inventories",
      );
      assert.deepEqual(requested, [null]);
    }
  }
  const paginated = serveDeployedPages([
    { data: [deployedTrigger], page_info: { end_cursor: "cursor_1" } },
    {
      data: [
        { ...deployedTrigger, id: "dc_second" },
        { id: "hi_other", type: "HttpInterface" },
      ],
      page_info: { count: 2, total_count: 3 },
    },
  ]);
  assert.deepEqual(await google.subject.listDeployedPipedreamTriggers(deployedInput), [
    parsedTrigger,
    { ...parsedTrigger, id: "dc_second" },
  ]);
  assert.deepEqual(paginated, [null, "cursor_1"]);

  for (const body of [
    null,
    [],
    "bad",
    {},
    { data: [] },
    { data: {}, page_info: {} },
    ...[null, [], "bad", 42, true].map((page_info) => ({ data: [], page_info })),
  ]) {
    const requested = serveDeployedPages([body]);
    await assert.rejects(
      google.subject.listDeployedPipedreamTriggers(deployedInput),
      /invalid deployed-trigger list/,
    );
    assert.equal(requested.length, 1);
  }
  for (const end_cursor of [false, 42, [], {}]) {
    serveDeployedPages([{ data: [], page_info: { end_cursor } }]);
    await assert.rejects(
      google.subject.listDeployedPipedreamTriggers(deployedInput),
      /invalid deployed-trigger pagination/,
    );
  }
  serveDeployedPages([
    { data: [deployedTrigger], page_info: { end_cursor: "cursor_1" } },
    { data: [], page_info: { end_cursor: "cursor_1" } },
  ]);
  await assert.rejects(
    google.subject.listDeployedPipedreamTriggers(deployedInput),
    /invalid deployed-trigger pagination/,
  );
  serveDeployedPages([
    { data: [], page_info: { end_cursor: "cursor_a" } },
    { data: [], page_info: { end_cursor: "cursor_b" } },
    { data: [], page_info: { end_cursor: "cursor_a" } },
  ]);
  await assert.rejects(
    google.subject.listDeployedPipedreamTriggers(deployedInput),
    /invalid deployed-trigger pagination/,
    "multi-page cursor cycles fail without returning a partial inventory",
  );
  serveDeployedPages([
    { data: [deployedTrigger], page_info: { end_cursor: "cursor_1" } },
    { data: null, page_info: {} },
  ]);
  await assert.rejects(
    google.subject.listDeployedPipedreamTriggers(deployedInput),
    /invalid deployed-trigger list/,
    "a failed later page must not return a partial inventory that could cause duplicate deployment",
  );
  serveDeployedPages([{ data: [{ type: "DeployedComponent", id: "dc_broken" }], page_info: {} }]);
  await assert.rejects(
    google.subject.listDeployedPipedreamTriggers(deployedInput),
    /invalid deployed trigger/,
    "known deployed trigger rows still require valid identity/configuration",
  );
  const bounded = serveDeployedPages(
    Array.from({ length: 100 }, (_, i) => ({ data: [], page_info: { end_cursor: `cursor_${i}` } })),
  );
  await assert.rejects(
    google.subject.listDeployedPipedreamTriggers(deployedInput),
    /pagination exceeded the safety limit/,
  );
  assert.equal(bounded.length, 100);

  let deniedRequests = 0;
  const privateValue = "private-token owner@example.test https://example.test/?secret=fixture";
  let failureResponse = () =>
    Response.json({ code: "insufficient_scope", message: privateValue }, { status: 403 });
  globalThis.fetch = async () => {
    deniedRequests++;
    return failureResponse();
  };
  await assert.rejects(google.subject.listGoogleAccounts("profile-private", "test"), (error) => {
    assert.equal(error.message, "Pipedream account discovery failed (403; insufficient_scope)");
    assert.equal(error.status, 403);
    assert.equal(error.operation, "Pipedream account discovery");
    assert.equal(error.reason, "insufficient_scope");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(JSON.stringify(error), /private|@|https:/);
    return true;
  });
  assert.equal(deniedRequests, 1, "403 is not retried");

  const listCalendars = () =>
    google.subject.listGoogleCalendars({
      profileId: "profile-private",
      environment: "test",
      accountId: "apn_private",
    });
  for (const [body, reason] of [
    [
      { error: { message: privateValue, errors: [{ reason: "insufficientPermissions" }] } },
      "insufficientPermissions",
    ],
    [
      {
        error: {
          message: privateValue,
          status: "PERMISSION_DENIED",
          details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT", metadata: privateValue }],
        },
      },
      "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    ],
    [{ error: { errors: [{ reason: "rateLimitExceeded" }] } }, "rateLimitExceeded"],
    [{ error: { details: [{ reason: "SERVICE_DISABLED" }] } }, "SERVICE_DISABLED"],
  ]) {
    failureResponse = () => Response.json(body, { status: 403 });
    await assert.rejects(listCalendars, {
      name: "PipedreamRequestError",
      message: `Google Calendar list via Pipedream failed (403; ${reason})`,
      status: 403,
      operation: "Google Calendar list via Pipedream",
      reason,
    });
  }
  for (const body of [
    "<html>Private upstream response</html>",
    "{",
    "null",
    "[]",
    JSON.stringify({ code: privateValue, error: privateValue }),
    JSON.stringify({ error: { message: privateValue, errors: [null, { reason: privateValue }] } }),
    JSON.stringify({ error: { status: "PRIVATE_LOOKS_LIKE_A_CODE" } }),
    JSON.stringify({ code: "insufficient_scope", message: "x".repeat(16_384) }),
  ]) {
    failureResponse = () => new Response(body, { status: 403 });
    await assert.rejects(listCalendars, {
      message: "Google Calendar list via Pipedream failed (403)",
      status: 403,
      reason: null,
    });
  }
  let bodyCancelled = false;
  failureResponse = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"error":'));
        },
        cancel() {
          bodyCancelled = true;
        },
      }),
      { status: 403 },
    );
  await assert.rejects(listCalendars, {
    message: "Google Calendar list via Pipedream failed (403)",
    status: 403,
    reason: null,
  });
  assert.equal(bodyCancelled, true, "stalled error bodies are cancelled rather than hanging setup");

  // A new module starts without a cached OAuth token. Token errors are not
  // resource 404s and must not be swallowed as successful account deletion.
  const authFailure = await importWithMocks(path.resolve("src/lib/pipedream.server.ts"), {});
  try {
    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://api.pipedream.com/v1/oauth/token");
      return Response.json(
        { error: "invalid_client", error_description: privateValue },
        { status: 404 },
      );
    };
    await assert.rejects(
      authFailure.subject.deletePipedreamAccount({
        profileId: "profile-private",
        environment: "test",
        accountId: "apn_private",
      }),
      (error) => {
        assert.equal(error.message, "Pipedream authentication failed (404; invalid_client)");
        assert.equal(error instanceof authFailure.subject.PipedreamRequestError, false);
        assert.equal(authFailure.subject.classifyPipedreamFailure(error), "platform");
        assert.equal(error.layer, "machine");
        return true;
      },
    );
  } finally {
    await authFailure.cleanup();
  }

  const account = {
    id: "apn_first",
    name: "owner@example.test",
    external_id: "obra:test:profile-1",
    app: { name_slug: "google_calendar" },
    healthy: true,
    dead: null,
    authorized_scopes: ["https://www.googleapis.com/auth/calendar"],
  };
  const calendar = { id: "first@example.test", summary: "First", accessRole: "owner" };
  const inventoryInput = { profileId: "profile-1", environment: "test", accountId: "apn_first" };
  function serveInventory(kind, pages) {
    const requested = [];
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input);
      assert.equal(url.origin, "https://api.pipedream.com");
      assert.equal(init.method ?? "GET", "GET");
      assert.equal(url.searchParams.get("external_user_id"), "obra:test:profile-1");
      let cursor;
      if (kind === "accounts") {
        assert.equal(url.pathname, "/v1/connect/project/accounts");
        assert.equal(url.searchParams.get("include_credentials"), "false");
        assert.equal(url.searchParams.get("app"), "google_calendar");
        assert.equal(url.searchParams.get("limit"), "100");
        cursor = url.searchParams.get("after");
      } else {
        const target = proxyTarget({ url });
        assert.equal(target.pathname, "/calendar/v3/users/me/calendarList");
        assert.equal(target.searchParams.get("maxResults"), "250");
        assert.equal(target.searchParams.get("showHidden"), "true");
        assert.equal(target.searchParams.get("showDeleted"), "false");
        cursor = target.searchParams.get("pageToken");
      }
      const index = requested.length;
      assert.ok(index < pages.length, "no requests after terminal inventory page");
      assert.equal(
        cursor,
        index
          ? kind === "accounts"
            ? pages[index - 1].page_info.end_cursor
            : pages[index - 1].nextPageToken
          : null,
      );
      requested.push(cursor);
      return Response.json(pages[index]);
    };
    return requested;
  }
  for (const page_info of [{}, { end_cursor: null }, { end_cursor: "" }]) {
    serveInventory("accounts", [{ data: [], page_info }]);
    assert.deepEqual(await google.subject.listGoogleAccounts("profile-1", "test"), []);
  }
  const accountRequests = serveInventory("accounts", [
    { data: [account], page_info: { count: 1, total_count: 2, end_cursor: "account_next" } },
    {
      data: [
        {
          ...account,
          id: "apn_selected",
          error: privateValue,
          credentials: { token: privateValue },
        },
      ],
      page_info: { count: 1, total_count: 2 },
    },
  ]);
  const accounts = await google.subject.listGoogleAccounts("profile-1", "test");
  assert.deepEqual(
    accounts.map(({ id }) => id),
    ["apn_first", "apn_selected"],
  );
  assert.deepEqual(accountRequests, [null, "account_next"]);
  assert.equal(accounts[1].error, "provider_account_unhealthy");
  assert.equal("credentials" in accounts[1], false);
  assert.doesNotMatch(JSON.stringify(accounts), /private-token|secret=fixture/);
  for (const pages of [
    [
      { data: [account], page_info: { total_count: 2, end_cursor: "next" } },
      { data: [], page_info: {} },
    ],
    [
      { data: [account], page_info: { total_count: 2, end_cursor: "next" } },
      { data: [{ ...account, id: "apn_second" }], page_info: { total_count: 3 } },
    ],
  ]) {
    serveInventory("accounts", pages);
    await assert.rejects(() => google.subject.listGoogleAccounts("profile-1", "test"), {
      reason: "invalid_response",
    });
  }
  const calendarRequests = serveInventory("calendars", [
    { items: [calendar], nextPageToken: "calendar_next" },
    {
      items: [
        { ...calendar, id: "selected@example.test", hidden: true },
        { ...calendar, id: "restricted@example.test", accessRole: "writerWithoutPrivateAccess" },
      ],
      nextSyncToken: "sync_final",
    },
  ]);
  const calendars = await google.subject.listGoogleCalendars(inventoryInput);
  assert.deepEqual(
    calendars.map(({ id }) => id),
    ["first@example.test", "selected@example.test", "restricted@example.test"],
  );
  assert.equal(
    calendars[2].accessRole,
    "reader",
    "restricted writer remains an inventory member without granting private-event write access",
  );
  assert.deepEqual(calendarRequests, [null, "calendar_next"]);

  const invalidAccounts = [
    null,
    [],
    {},
    { data: [] },
    { data: [], page_info: [] },
    ...[false, 42, [], {}, "x".repeat(4097)].map((end_cursor) => ({
      data: [],
      page_info: { end_cursor },
    })),
    { data: [], page_info: { count: 1 } },
    { data: [], page_info: { total_count: 1 } },
    { data: [], page_info: { total_count: -1 } },
    { data: [], page_info: { total_count: 0.5 } },
    ...[
      null,
      [],
      {},
      { ...account, id: "" },
      { ...account, app: {} },
      { ...account, app: { name_slug: "slack" } },
      { ...account, healthy: "true" },
      { ...account, dead: "false" },
      { ...account, name: {} },
      { ...account, error: {} },
      { ...account, authorized_scopes: [null] },
      { ...account, created_at: "invalid" },
    ].map((row) => ({ data: [row], page_info: {} })),
    { data: [account, account], page_info: {} },
    {
      data: Array.from({ length: 101 }, (_, i) => ({ ...account, id: `apn_${i}` })),
      page_info: {},
    },
  ];
  const invalidCalendars = [
    null,
    [],
    {},
    { items: null },
    { items: [], kind: "wrong" },
    ...[null, false, 42, [], {}, "", "x".repeat(4097)].map((nextPageToken) => ({
      items: [],
      nextPageToken,
    })),
    { items: [], nextPageToken: "page", nextSyncToken: "sync" },
    ...[
      null,
      [],
      {},
      { ...calendar, id: "" },
      { ...calendar, accessRole: "unknown" },
      { ...calendar, summary: null },
      { ...calendar, timeZone: {} },
      { ...calendar, primary: "true" },
      { ...calendar, deleted: true },
    ].map((row) => ({ items: [row] })),
    { items: [calendar, calendar] },
    { items: Array.from({ length: 251 }, (_, i) => ({ ...calendar, id: `${i}@example.test` })) },
  ];
  for (const [kind, invalidPages] of [
    ["accounts", invalidAccounts],
    ["calendars", invalidCalendars],
  ]) {
    const list = () =>
      kind === "accounts"
        ? google.subject.listGoogleAccounts("profile-1", "test")
        : google.subject.listGoogleCalendars(inventoryInput);
    for (const body of invalidPages) {
      serveInventory(kind, [body]);
      await assert.rejects(
        list,
        (error) =>
          error.reason === "invalid_response" &&
          google.subject.classifyPipedreamFailure(error) === "temporary",
      );
    }
    const page = (next, rows = []) =>
      kind === "accounts"
        ? { data: rows, page_info: { end_cursor: next } }
        : { items: rows, nextPageToken: next };
    for (const cursors of [
      ["a", "a"],
      ["a", "b", "a"],
    ]) {
      const requested = serveInventory(
        kind,
        cursors.map((next) => page(next)),
      );
      await assert.rejects(list, { reason: "invalid_response" });
      assert.equal(requested.length, cursors.length);
    }
    serveInventory(kind, [page("first", [kind === "accounts" ? account : calendar]), null]);
    await assert.rejects(
      list,
      { reason: "invalid_response" },
      "a malformed later page never becomes a partial inventory",
    );
    const bounded = serveInventory(
      kind,
      Array.from({ length: 100 }, (_, i) => page(`page_${i}`)),
    );
    await assert.rejects(list, { reason: "invalid_response" });
    assert.equal(bounded.length, 100);
  }

  const busyInput = {
    ...inventoryInput,
    calendarIds: Array.from({ length: 51 }, (_, i) => `calendar-${i}@example.test`),
    timeMin: "2030-01-02T17:00:00Z",
    timeMax: "2030-01-02T18:00:00Z",
  };
  const chunks = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    chunks.push(body.items.length);
    return Response.json({
      calendars: Object.fromEntries(body.items.map(({ id }) => [id, { busy: [], errors: [] }])),
    });
  };
  assert.deepEqual(await google.subject.getGoogleCalendarBusyRanges(busyInput), []);
  assert.deepEqual(
    chunks,
    [50, 1],
    "FreeBusy verifies the complete blocking set within Google's 50-calendar limit",
  );
  for (const [reason, category] of [
    ["notFound", "permissions"],
    ["internalError", "temporary"],
    ["tooManyCalendarsRequested", "configuration"],
    [privateValue, "temporary"],
  ]) {
    globalThis.fetch = async () =>
      Response.json({
        kind: "calendar#freeBusy",
        calendars: {
          [busyInput.calendarIds[0]]: { errors: [{ domain: "global", reason }] },
        },
      });
    await assert.rejects(
      () =>
        google.subject.getGoogleCalendarBusyRanges({
          ...busyInput,
          calendarIds: busyInput.calendarIds.slice(0, 1),
        }),
      (error) => {
        assert.equal(google.subject.classifyPipedreamFailure(error), category);
        assert.doesNotMatch(
          error.message + JSON.stringify(error),
          /private-token|owner@|secret=fixture/,
        );
        return true;
      },
    );
  }

  const booking = {
    ...inventoryInput,
    calendarId: "selected@example.test",
    eventId: "0b12345",
    appointmentId: "apt-1",
    summary: "Repair",
    description: "Booked",
    startAt: "2030-01-02T17:00:00Z",
    endAt: "2030-01-02T18:00:00Z",
    timeZone: "UTC",
    attendeeEmail: "c@example.test",
  };
  const correctEvent = {
    id: booking.eventId,
    status: "confirmed",
    start: { dateTime: "2030-01-02T12:00:00-05:00" },
    end: { dateTime: "2030-01-02T18:00:00.000Z" },
    attendees: [{ email: "C@EXAMPLE.TEST", responseStatus: "needsAction" }],
    extendedProperties: { private: { obraAppointmentId: booking.appointmentId } },
    iCalUID: "ical",
    etag: '"booking-etag"',
  };
  const drifts = [
    { id: "other" },
    { extendedProperties: { private: { obraAppointmentId: "other" } } },
    { status: "cancelled" },
    { status: "unexpected" },
    { start: { dateTime: "2030-01-02T17:01:00Z" } },
    { end: { dateTime: "2030-01-02T18:01:00Z" } },
    { start: { date: "2030-01-02" } },
    { start: { dateTime: "2030-01-02T17:00:00" } },
    { start: { dateTime: "2030-02-30T17:00:00Z" } },
    { attendees: [] },
    { attendees: [{ email: "other@example.test" }] },
    { attendeesOmitted: true },
    { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=20"] },
    { recurrence: ["RDATE:20300109T170000Z"] },
    { recurrence: "RRULE:FREQ=DAILY" },
    { recurrence: null },
    { recurringEventId: "parent-series" },
    { originalStartTime: { dateTime: booking.startAt } },
    { endTimeUnspecified: true },
    { endTimeUnspecified: "false" },
    { eventType: "outOfOffice" },
  ];
  globalThis.fetch = async () => Response.json(correctEvent);
  assert.deepEqual(await google.subject.getGoogleBookingEvent(booking), {
    state: "present",
    etag: correctEvent.etag,
  });
  for (const drift of drifts) {
    globalThis.fetch = async () => Response.json({ ...correctEvent, ...drift });
    assert.deepEqual(await google.subject.getGoogleBookingEvent(booking), { state: "conflict" });
  }
  globalThis.fetch = async () =>
    Response.json({
      ...correctEvent,
      recurrence: [],
      endTimeUnspecified: false,
      eventType: "default",
    });
  assert.deepEqual(await google.subject.getGoogleBookingEvent(booking), {
    state: "present",
    etag: correctEvent.etag,
  });
  globalThis.fetch = async () => Response.json({ id: booking.eventId, status: "cancelled" });
  assert.deepEqual(await google.subject.getGoogleBookingEvent(booking), { state: "conflict" });
  const identityOnly = {
    ...inventoryInput,
    calendarId: booking.calendarId,
    eventId: booking.eventId,
    appointmentId: booking.appointmentId,
  };
  assert.deepEqual(await google.subject.getGoogleBookingEvent(identityOnly), { state: "absent" });
  globalThis.fetch = async () =>
    Response.json({
      id: booking.eventId,
      status: "cancelled",
      recurringEventId: "parent-series",
      originalStartTime: { dateTime: booking.startAt },
    });
  assert.deepEqual(await google.subject.getGoogleBookingEvent(identityOnly), { state: "conflict" });
  const googleError = (status, reason) =>
    Response.json(
      {
        error: { code: status, errors: [{ domain: "global", reason }] },
      },
      { status },
    );
  const accessPath = `/calendar/v3/calendars/${encodeURIComponent(booking.calendarId)}/events`;
  const accessEvidence = { kind: "calendar#events", accessRole: "owner" };
  const absentCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = proxyTarget({ url });
    absentCalls.push({ path: target.pathname, method: init.method ?? "GET" });
    if (target.pathname === accessPath) {
      assert.equal(init.method ?? "GET", "GET");
      assert.equal(target.searchParams.get("fields"), "kind,accessRole");
      assert.equal(target.searchParams.get("maxResults"), "1");
      assert.equal(
        new Headers(init.headers).has("x-pd-proxy-if-match"),
        false,
        "an event's ETag must not become a conditional header on the access read",
      );
      return Response.json(accessEvidence);
    }
    return googleError(404, "notFound");
  };
  assert.deepEqual(await google.subject.getGoogleBookingEvent(booking), { state: "absent" });
  assert.equal(
    absentCalls.length,
    2,
    "404 absence requires exact-calendar access, not a global inventory",
  );
  await google.subject.deleteGoogleBookingEvent({ ...booking, ifMatch: correctEvent.etag });
  assert.equal(absentCalls.length, 4, "DELETE 404 must establish exact access too");

  for (const evidence of [
    null,
    {},
    { kind: "wrong", accessRole: "owner" },
    { kind: "calendar#events", accessRole: "none" },
    { kind: "calendar#events", accessRole: "freeBusyReader" },
    { kind: "calendar#events", accessRole: "reader" },
    { kind: "calendar#events", accessRole: "writerWithoutPrivateAccess" },
  ]) {
    globalThis.fetch = async (url) =>
      proxyTarget({ url }).pathname === accessPath
        ? Response.json(evidence)
        : googleError(404, "notFound");
    await assert.rejects(
      () => google.subject.getGoogleBookingEvent(booking),
      "missing/private-event read access is not proof of absence",
    );
    await assert.rejects(() =>
      google.subject.deleteGoogleBookingEvent({ ...booking, ifMatch: correctEvent.etag }),
    );
  }
  globalThis.fetch = async () => googleError(404, "notFound");
  await assert.rejects(
    () => google.subject.getGoogleBookingEvent(booking),
    (error) =>
      error.operation === "Google Calendar access verification via Pipedream" &&
      google.subject.classifyPipedreamFailure(error) === "permissions",
  );
  for (const response of [
    () => new Response(null, { status: 404 }),
    () => Response.json({ error: "Account not found" }, { status: 404 }),
    () =>
      Response.json(
        { error: { code: 404, errors: [{ domain: "unknown", reason: "notFound" }] } },
        { status: 404 },
      ),
    () => new Response(null, { status: 410 }),
  ]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return response();
    };
    await assert.rejects(() => google.subject.getGoogleBookingEvent(booking));
    assert.equal(
      calls,
      1,
      "unattributable errors cannot prove disappearance or trigger access fallback",
    );
    await assert.rejects(() =>
      google.subject.deleteGoogleBookingEvent({ ...booking, ifMatch: correctEvent.etag }),
    );
    assert.equal(calls, 2);
  }

  for (const etag of [
    undefined,
    null,
    "",
    "*",
    "bare",
    'W/"weak"',
    '"one", "two"',
    '"bad\r\nheader"',
  ]) {
    globalThis.fetch = async () => Response.json({ ...correctEvent, etag });
    const observed = await google.subject.getGoogleBookingEvent(booking);
    assert.deepEqual(observed, { state: "present" }, "unusable ETags are not deletion authority");
    let deletes = 0;
    globalThis.fetch = async () => {
      deletes++;
      return new Response(null, { status: 204 });
    };
    await assert.rejects(
      () => google.subject.deleteGoogleBookingEvent({ ...booking, ifMatch: etag }),
      { reason: "invalid_configuration" },
    );
    assert.equal(deletes, 0, "missing/wildcard/weak/invalid ETag never dispatches DELETE");
  }
  let storedEvent = structuredClone(correctEvent);
  const conditionalMethods = [];
  globalThis.fetch = async (_url, init = {}) => {
    conditionalMethods.push(init.method ?? "GET");
    if ((init.method ?? "GET") === "GET") return Response.json(storedEvent);
    assert.equal(init.method, "DELETE");
    const etag = new Headers(init.headers).get("x-pd-proxy-if-match");
    if (etag !== storedEvent.etag) return googleError(412, "conditionNotMet");
    storedEvent = null;
    return new Response(null, { status: 204 });
  };
  const observedEvent = await google.subject.getGoogleBookingEvent(booking);
  storedEvent.etag = '"changed-etag"';
  storedEvent.start.dateTime = "2030-01-02T17:30:00Z";
  await assert.rejects(
    () => google.subject.deleteGoogleBookingEvent({ ...booking, ifMatch: observedEvent.etag }),
    (error) =>
      error.status === 412 && google.subject.classifyPipedreamFailure(error) === "configuration",
  );
  assert.ok(storedEvent, "an event edited after readback survives cancellation");
  assert.deepEqual(conditionalMethods, ["GET", "DELETE"], "412 is never automatically retried");
  await google.subject.deleteGoogleBookingEvent({ ...booking, ifMatch: storedEvent.etag });
  assert.equal(storedEvent, null);
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: 410, errors: [{ domain: "global", reason: "deleted" }] } },
      { status: 410 },
    );
  assert.deepEqual(await google.subject.getGoogleBookingEvent(booking), { state: "conflict" });
  assert.deepEqual(await google.subject.getGoogleBookingEvent(identityOnly), { state: "absent" });
  await google.subject.deleteGoogleBookingEvent({ ...booking, ifMatch: correctEvent.etag });
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: 410, errors: [{ domain: "calendar", reason: "fullSyncRequired" }] } },
      { status: 410 },
    );
  await assert.rejects(() => google.subject.getGoogleBookingEvent(booking), { status: 410 });

  for (const drift of [null, ...drifts]) {
    const sent = [];
    globalThis.fetch = async (url, init = {}) => {
      const target = proxyTarget({ url });
      sent.push(init.method);
      if (init.method === "POST") {
        assert.equal(target.searchParams.get("sendUpdates"), "all");
        assert.equal(JSON.parse(init.body).id, booking.eventId);
        throw new Error(privateValue);
      }
      assert.equal(init.method, "GET");
      assert.ok(target.pathname.endsWith(`/${booking.eventId}`));
      assert.equal(target.searchParams.has("sendUpdates"), false);
      return Response.json({ ...correctEvent, ...drift });
    };
    if (drift)
      await assert.rejects(
        () => google.subject.createGoogleBookingEvent(booking),
        (error) =>
          error instanceof google.subject.PipedreamRequestError &&
          error.reason === "event_conflict" &&
          google.subject.classifyPipedreamFailure(error) === "configuration",
      );
    else
      assert.deepEqual(await google.subject.createGoogleBookingEvent(booking), {
        id: booking.eventId,
        iCalUID: "ical",
        etag: correctEvent.etag,
      });
    assert.deepEqual(
      sent,
      ["POST", "GET"],
      "ambiguous INSERT reads the same ID, never sends a second invitation INSERT",
    );
  }

  for (const response of [
    () => Response.json(null),
    () => Response.json({}),
    () => new Response("{malformed"),
    () =>
      Response.json(
        { error: { code: 409, errors: [{ domain: "global", reason: "duplicate" }] } },
        { status: 409 },
      ),
  ]) {
    const methods = [];
    globalThis.fetch = async (_url, init = {}) => {
      methods.push(init.method);
      return init.method === "POST" ? response() : Response.json(correctEvent);
    };
    assert.equal((await google.subject.createGoogleBookingEvent(booking)).id, booking.eventId);
    assert.deepEqual(methods, ["POST", "GET"]);
  }

  for (const [status, reason, layer, category] of [
    [401, "invalid_grant", "machine", "platform"],
    [403, "insufficient_scope", "pipedream", "platform"],
    [404, null, "pipedream", "platform"],
    [403, "invalid_client", "proxy", "platform"],
    [403, "SERVICE_DISABLED", "google", "platform"],
    [403, "accessNotConfigured", "google", "platform"],
    [403, "insufficientPermissions", "google", "permissions"],
    [403, "ACCESS_TOKEN_SCOPE_INSUFFICIENT", "google", "permissions"],
    [401, null, "proxy", "temporary"],
    [403, null, "google", "temporary"],
    [400, "invalid_grant", "proxy", "temporary"],
    [400, "invalid_grant", "google", "temporary"],
    [401, "invalid_token", "google", "temporary"],
    [403, "PERMISSION_DENIED", "google", "permissions"],
    [403, "rateLimitExceeded", "google", "temporary"],
    [429, null, "machine", "temporary"],
    [503, null, "google", "temporary"],
    [400, "timeRangeEmpty", "google", "configuration"],
    [403, "forbiddenForNonOrganizer", "google", "configuration"],
  ]) {
    const operation =
      layer === "machine"
        ? "Pipedream authentication"
        : layer === "pipedream"
          ? "Pipedream account discovery"
          : "Google Calendar event creation via Pipedream";
    assert.equal(
      google.subject.classifyPipedreamFailure(
        new google.subject.PipedreamRequestError(status, operation, reason, layer),
      ),
      category,
    );
  }
  for (const operation of [
    "Google Calendar event creation via Pipedream",
    "Google Calendar write verification via Pipedream",
    "Google Calendar event deletion via Pipedream",
  ]) {
    for (const reason of ["forbidden", "PERMISSION_DENIED"]) {
      for (const [layer, category] of [
        ["google", "permissions"],
        ["proxy", "temporary"],
        ["machine", "platform"],
      ]) {
        assert.equal(
          google.subject.classifyPipedreamFailure(
            new google.subject.PipedreamRequestError(403, operation, reason, layer),
          ),
          category,
          `${operation}: ${reason} at ${layer} must be ${category}, never reauthorization`,
        );
      }
      assert.equal(
        google.subject.classifyPipedreamFailure(
          new google.subject.PipedreamRequestError(
            403,
            "Google Calendar event lookup via Pipedream",
            reason,
            "google",
          ),
        ),
        "temporary",
        "generic read denial does not establish a write blocker",
      );
    }
  }
  assert.equal(
    google.subject.classifyPipedreamFailure(new Error("invalid_grant revoked")),
    "temporary",
  );
  for (const [body, layer, category] of [
    [{ error: "invalid_grant", error_description: privateValue }, "proxy", "temporary"],
    [
      { error: { code: 403, errors: [{ domain: "global", reason: "insufficientPermissions" }] } },
      "google",
      "permissions",
    ],
    [
      {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              domain: "googleapis.com",
              reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
            },
          ],
        },
      },
      "google",
      "permissions",
    ],
    [
      { error: { code: 403, errors: [{ domain: "unknown", reason: "insufficientPermissions" }] } },
      "proxy",
      "temporary",
    ],
    [
      {
        error: {
          code: 403,
          errors: [{ domain: "global", reason: "authError" }],
          details: [{ reason: "insufficientPermissions" }],
        },
      },
      "google",
      "temporary",
    ],
    [
      { error: { code: 401, errors: [{ domain: "global", reason: "insufficientPermissions" }] } },
      "proxy",
      "temporary",
    ],
  ]) {
    globalThis.fetch = async () => Response.json(body, { status: 403 });
    await assert.rejects(
      () => google.subject.listGoogleCalendars(inventoryInput),
      (error) => {
        assert.equal(error.layer, layer);
        assert.equal(google.subject.classifyPipedreamFailure(error), category);
        assert.doesNotMatch(
          error.message + JSON.stringify(error),
          /private-token|owner@|secret=fixture/,
        );
        return true;
      },
    );
  }

  const probe = {
    ...inventoryInput,
    calendarId: booking.calendarId,
    eventId: "0b123456",
    operationId: "probe-operation",
  };
  let storedProbe;
  let lostCleanup = false;
  let probeRequests = [];
  let createBody;
  let createResponse = () => {
    throw new Error(privateValue);
  };
  globalThis.fetch = async (url, init = {}) => {
    const target = proxyTarget({ url });
    probeRequests.push(init.method ?? "GET");
    if (target.searchParams.get("fields") === "kind,accessRole")
      return Response.json(accessEvidence);
    if (init.method === "POST") {
      assert.equal(target.searchParams.get("sendUpdates"), "none");
      storedProbe = { ...JSON.parse(init.body), status: "confirmed", etag: '"probe-etag"' };
      createBody = JSON.parse(init.body);
      assert.equal(storedProbe.id, probe.eventId);
      assert.equal(
        storedProbe.extendedProperties.private.obraVerificationOperationId,
        probe.operationId,
      );
      assert.equal(storedProbe.visibility, "private");
      assert.equal(storedProbe.transparency, "transparent");
      assert.equal("attendees" in storedProbe, false);
      return createResponse();
    }
    assert.ok(target.pathname.endsWith(`/${probe.eventId}`));
    if (init.method === "DELETE") {
      assert.equal(target.searchParams.get("sendUpdates"), "none");
      assert.equal(init.headers["x-pd-proxy-if-match"], '"probe-etag"');
      if (lostCleanup) {
        storedProbe = { id: probe.eventId, status: "cancelled" };
        throw new Error(privateValue);
      }
      return new Response(null, { status: 204 });
    }
    assert.equal(target.searchParams.has("sendUpdates"), false);
    return storedProbe ? Response.json(storedProbe) : googleError(404, "notFound");
  };
  const serveProbe = globalThis.fetch;
  await google.subject.verifyGoogleCalendarWrite(probe);
  assert.deepEqual(probeRequests, ["GET", "GET", "POST", "GET", "DELETE"]);
  const expectedProbe = structuredClone(storedProbe);
  for (const response of [
    () => Response.json(null),
    () => new Response("{"),
    () => Response.json({}, { status: 409 }),
  ]) {
    storedProbe = undefined;
    probeRequests = [];
    createResponse = response;
    await google.subject.verifyGoogleCalendarWrite(probe);
    assert.deepEqual(probeRequests, ["GET", "GET", "POST", "GET", "DELETE"]);
    const { status: _status, etag: _etag, ...body } = expectedProbe;
    assert.deepEqual(
      createBody,
      body,
      "same operation has a deterministic body, including its times",
    );
  }
  probeRequests = [];
  lostCleanup = true;
  await google.subject.verifyGoogleCalendarWrite(probe);
  assert.deepEqual(
    probeRequests,
    ["GET", "DELETE", "GET"],
    "a resumed stable probe does not INSERT again; lost DELETE is read back",
  );
  for (const drift of [
    { id: "other" },
    { summary: "Contractor edited the probe" },
    { attendees: [{ email: "c@example.test" }] },
    { visibility: "public" },
    { reminders: { useDefault: true } },
    { status: "cancelled" },
    { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=20"] },
    { recurringEventId: "parent-series" },
    { originalStartTime: { dateTime: "2000-01-01T00:00:00Z" } },
    { endTimeUnspecified: true },
    { start: { dateTime: "2030-01-02T17:00:00Z" } },
    {
      extendedProperties: {
        private: { obraVerification: "true", obraVerificationOperationId: "other" },
      },
    },
  ]) {
    storedProbe = { ...expectedProbe, ...drift };
    probeRequests = [];
    await assert.rejects(() => google.subject.verifyGoogleCalendarWrite(probe), {
      reason: "event_conflict",
    });
    assert.deepEqual(
      probeRequests,
      ["GET"],
      "conflicting probe must never be overwritten or deleted",
    );
  }
  for (const etag of [undefined, "", "*", "unsafe\r\nheader"]) {
    storedProbe = { ...expectedProbe, etag };
    probeRequests = [];
    await assert.rejects(() => google.subject.verifyGoogleCalendarWrite(probe), {
      reason: "invalid_response",
    });
    assert.deepEqual(probeRequests, ["GET"], "cleanup requires a usable exact ETag");
  }
  await assert.rejects(
    () => google.subject.verifyGoogleCalendarWrite({ ...probe, operationId: undefined }),
    { reason: "invalid_configuration" },
  );
  storedProbe = expectedProbe;
  let reads = 0;
  const methods = [];
  globalThis.fetch = async (url, init = {}) => {
    methods.push(init.method ?? "GET");
    if (init.method === "DELETE") throw new Error(privateValue);
    assert.ok(proxyTarget({ url }).pathname.endsWith(`/${probe.eventId}`));
    reads++;
    return Response.json(storedProbe);
  };
  await assert.rejects(() => google.subject.verifyGoogleCalendarWrite(probe), {
    reason: "network_error",
  });
  assert.equal(reads, 2);
  assert.deepEqual(methods, ["GET", "DELETE", "GET"], "a surviving event is NOT completed cleanup");
  globalThis.fetch = serveProbe;
  lostCleanup = false;
  probeRequests = [];
  await google.subject.verifyGoogleCalendarWrite(probe);
  assert.deepEqual(
    probeRequests,
    ["GET", "DELETE"],
    "a later recovery removes the surviving stable probe without INSERT",
  );

  const cleanupRaceMethods = [];
  globalThis.fetch = async (_url, init = {}) => {
    cleanupRaceMethods.push(init.method ?? "GET");
    if (init.method === "DELETE") {
      assert.equal(init.headers["x-pd-proxy-if-match"], '"probe-etag"');
      return Response.json(
        { error: { code: 412, errors: [{ domain: "global", reason: "conditionNotMet" }] } },
        { status: 412 },
      );
    }
    return Response.json(expectedProbe);
  };
  await assert.rejects(
    () => google.subject.verifyGoogleCalendarWrite(probe),
    (error) =>
      error.status === 412 && google.subject.classifyPipedreamFailure(error) === "configuration",
  );
  assert.deepEqual(
    cleanupRaceMethods,
    ["GET", "DELETE"],
    "probe edited after readback must not be unconditionally deleted",
  );

  globalThis.fetch = async () => googleError(410, "deleted");
  await assert.rejects(() => google.subject.verifyGoogleCalendarWrite(probe), {
    reason: "event_conflict",
  });
  globalThis.fetch = async () => Response.json({ id: probe.eventId, status: "cancelled" });
  await assert.rejects(() => google.subject.verifyGoogleCalendarWrite(probe), {
    reason: "event_conflict",
  });

  // Documented Connect responses: definitions have key/version, deployed resources
  // have id/component_id. A successful pinned deploy response joins these facts.
  // https://pipedream.com/docs/connect/api-reference/deploy-trigger
  const triggerKey = "google_calendar-new-or-updated-event-instant";
  const definition = {
    key: triggerKey,
    name: "Calendar events",
    version: "1.2.3",
    configurable_props: [
      { name: "googleCalendar", type: "app", app: "google_calendar" },
      { name: "calendarIds", type: "string[]" },
      { name: "newOnly", type: "boolean" },
    ],
  };
  globalThis.fetch = async (url) => {
    assert.ok(new URL(url).pathname.endsWith(`/triggers/${triggerKey}`));
    return Response.json({ data: definition });
  };
  const documented = await google.subject.retrievePipedreamTrigger({
    environment: "test",
    key: triggerKey,
    version: definition.version,
  });
  assert.equal(documented.id, undefined);
  assert.equal(documented.key, triggerKey);
  assert.equal(documented.version, definition.version);
  const providerTrigger = {
    id: "dc_version123",
    component_id: "sc_pinned123",
    active: true,
    type: "DeployedComponent",
    owner_id: "exu_version",
    created_at: 1,
    updated_at: 1,
    name: "Calendar",
    name_slug: "calendar",
    configurable_props: definition.configurable_props,
    configured_props: {
      googleCalendar: { authProvisionId: "apn_version123" },
      calendarIds: ["primary"],
      newOnly: false,
    },
  };
  const savedReceipt = {
    trigger_id: providerTrigger.id,
    component_id: providerTrigger.component_id,
    component_key: triggerKey,
    component_version: definition.version,
    operation_id: "completed-operation-fixture",
  };
  const versionState = {};
  globalThis.__pipedreamVersionTest = versionState;
  const versionMocks = {
    "@/lib/google-calendar-state.server": `
      import { withWorkerDeadline } from ${JSON.stringify(path.resolve("src/lib/worker-deadline.server.ts"))};
      const s = globalThis.__pipedreamVersionTest;
      s.withWorkerDeadline=withWorkerDeadline;
      export class GoogleCalendarStateError extends Error { constructor() { super('State settlement unresolved'); } }
      export const requireGoogleCalendarSettlement = (value) => { if (!value) throw new GoogleCalendarStateError(); };
      export const runGoogleCalendarSetupProbe = async () => { throw new Error('Unexpected setup probe'); };
      export const googleCalendarLifetimeRpc = async (name, args) => {
        s.rpc.push({ name, args: structuredClone(args) });
        const b=s.claim.binding;
        let data=true;
        if (name === 'claim_saved_google_calendar_verification') {
          b.reconciliation_fencing_token++;
          b.reconciliation_lease_token=args.p_lease_token;
          data=s.claim;
        }
        if (name === 'record_pipedream_trigger_deployment_result') data=false;
        if (name === 'reserve_pipedream_trigger_deployment') {
          b.component_version=args.p_component_version;
          b.deployment_operation_id??='operation-fixture-'+(++s.operations);
          data=b;
        }
        if (name === 'begin_pipedream_trigger_deployment_effect') {
          b.deployment_dispatched_at=new Date().toISOString();
          b.deployment_dispatch_lease_token=args.p_lease_token;
          b.deployment_dispatch_fencing_token=args.p_fencing_token;
          if(s.expireBeforeDeploy) Date.now=()=>s.startAt+22_001;
          if(s.stopBeforeDeploy) s.permit=false;
          if(s.loseBeginResponse) throw new GoogleCalendarStateError();
        }
        if (name === 'adopt_pipedream_trigger_candidate') {
          b.deployment_candidate_trigger_id=args.p_deployed_trigger_id;
          if (args.p_component_id !== undefined) {
            s.captureReceipt(args,b);
            b.deployment_receipt={trigger_id:args.p_deployed_trigger_id,component_id:args.p_component_id,
              component_key:b.component_key,component_version:b.component_version,operation_id:b.deployment_operation_id};
          }
        }
        if (name === 'retire_pipedream_trigger') {
          b.retired_trigger_ids.push(args.p_deployed_trigger_id);
          b.pending_trigger_deletions.push(args.p_deployed_trigger_id);
          b.deployed_trigger_id=null;b.deployment_candidate_trigger_id=null;b.deployment_receipt=null;
          b.webhook_id=null;b.deployment_operation_id=null;b.deployment_dispatched_at=null;
          data=b;
        }
        if (name === 'complete_pipedream_stale_trigger_cleanup')
          b.pending_trigger_deletions=b.pending_trigger_deletions.filter(id=>id!==args.p_deployed_trigger_id);
        if (name === 'fail_pipedream_binding_reconciliation') {
          b.trigger_state='degraded';
          b.reconciliation_due_at=new Date(Date.now()+60_000).toISOString();
          if(args.p_deployment_definitely_rejected
            && b.deployment_dispatch_lease_token===args.p_lease_token
            && b.deployment_dispatch_fencing_token===args.p_fencing_token
            && !b.deployment_candidate_trigger_id && !b.deployment_receipt)b.deployment_dispatched_at=null;
        }
        if (name === 'apply_pipedream_trigger_projection') {
          b.deployed_trigger_id=args.p_deployed_trigger_id;b.webhook_id=args.p_webhook_id;b.trigger_state='active';
          b.deployment_candidate_trigger_id=null;b.deployment_operation_id=null;b.deployment_dispatched_at=null;
          data=b;
        }
        if (s.loseRpcResponse === name) {
          s.loseRpcResponse=null;
          throw new GoogleCalendarStateError();
        }
        // Real PostgREST deserializes a new object. Never let in-memory assignment
        // in the worker masquerade as a durable receipt across the next claim.
        return structuredClone(data);
      };
    `,
  };
  versionState.captureReceipt = (args, binding) => {
    assert.ok(
      versionState.successfulDeploy,
      "only an actual successful CREATE response can mint proof",
    );
    assert.equal(args.p_deployed_trigger_id, versionState.successfulDeploy.id);
    assert.equal(args.p_component_id, versionState.successfulDeploy.component_id);
    assert.equal(args.p_deployment_operation_id, binding.deployment_operation_id);
    assert.equal(args.p_lease_token, binding.deployment_dispatch_lease_token);
    assert.equal(args.p_fencing_token, binding.deployment_dispatch_fencing_token);
  };
  let versionBundle = await importWithMocks(
    path.resolve("src/lib/pipedream-trigger-reconciliation.server.ts"),
    versionMocks,
  );
  try {
    for (const test of [
      {
        name: "ID-less CREATE receipt survives fresh-module read-only verification",
        missing: true,
        repair: true,
        success: true,
        reload: true,
      },
      {
        name: "old owned trigger without proof cannot pass read-only verification",
        reason: "trigger_contract_mismatch",
      },
      {
        name: "old owned trigger without proof is fenced, retired and replaced",
        repair: true,
        success: true,
        replace: true,
        reload: true,
      },
      {
        name: "receipt proves existing deployed resource with no optional key/version",
        receipt: true,
        success: true,
      },
      {
        name: "existing trigger exposes matching key",
        receipt: true,
        trigger: { component_key: triggerKey },
        success: true,
      },
      {
        name: "mismatched component ID is not the requested version",
        receipt: true,
        trigger: { component_id: "sc_other123", component_version: "1.2.3" },
        reason: "trigger_contract_mismatch",
      },
      {
        name: "contradictory key never inherits pinned key",
        receipt: true,
        trigger: { component_key: "wrong-component" },
        reason: "trigger_contract_mismatch",
      },
      {
        name: "contradictory optional definition ID overrides an otherwise matching receipt",
        receipt: true,
        definition: { id: "sc_other123" },
        reason: "trigger_contract_mismatch",
      },
      {
        name: "malformed definition identity is rejected",
        definition: { id: 123 },
        reason: "provider_temporary_failure",
      },
      {
        name: "malformed deployed key is not treated as omitted",
        trigger: { component_key: 123 },
        reason: "provider_temporary_failure",
      },
      {
        name: "definition returning another version is not pinned evidence",
        definition: { version: "9.9.9" },
        reason: "provider_temporary_failure",
      },
      {
        name: "definition returning another key is not pinned evidence",
        definition: { key: "wrong-component" },
        reason: "provider_temporary_failure",
      },
      {
        name: "missing binding adopts exact inventory component",
        definition: { id: providerTrigger.component_id },
        repair: true,
        missing: true,
        inventory: true,
        success: true,
      },
      {
        name: "inventory skips wrong ID in favor of matching saved component",
        definition: { id: providerTrigger.component_id },
        repair: true,
        missing: true,
        inventory: true,
        wrongFirst: true,
        success: true,
      },
      {
        name: "unknown inventory ID cannot settle an ambiguous create",
        definition: { id: providerTrigger.component_id },
        repair: true,
        missing: true,
        inventory: true,
        wrongOnly: true,
        dispatched: true,
        reason: "trigger_deployment_ambiguous",
      },
      {
        name: "matching ID-less inventory without a receipt is not deployment proof",
        repair: true,
        missing: true,
        inventory: true,
        dispatched: true,
        reason: "trigger_deployment_ambiguous",
      },
      {
        name: "wrong component is retained only for fenced cleanup, never projected healthy",
        definition: { id: providerTrigger.component_id },
        repair: true,
        missing: true,
        trigger: { component_id: "sc_other123" },
        reason: "trigger_version_unverified",
        retainsCleanupIdentity: true,
        contradictory: true,
      },
      {
        name: "CREATE response with contradictory key cannot mint a reusable receipt",
        repair: true,
        missing: true,
        trigger: { component_key: "wrong-component" },
        reason: "trigger_version_unverified",
        retainsCleanupIdentity: true,
        contradictory: true,
      },
      {
        name: "lost successful CREATE response never mints proof or duplicates deployment",
        repair: true,
        missing: true,
        lostCreateResponse: true,
        reason: "provider_temporary_failure",
        reload: true,
      },
      {
        name: "receipt adoption commits but its response is lost",
        repair: true,
        missing: true,
        loseRpcResponse: "adopt_pipedream_trigger_candidate",
        reason: "State settlement unresolved",
        reload: true,
      },
      {
        name: "projection commits but its response is lost",
        repair: true,
        missing: true,
        loseRpcResponse: "apply_pipedream_trigger_projection",
        reason: "State settlement unresolved",
        reload: true,
      },
      ...[
        { trigger_id: "dc_foreign123" },
        { component_id: "sc_foreign123" },
        { component_version: "9.9.9" },
        { component_key: "wrong-component" },
        { operation_id: "" },
      ].map((receiptDrift) => ({
        name: `receipt mismatch ${Object.keys(receiptDrift)[0]}`,
        receipt: true,
        receiptDrift,
        reason: "trigger_contract_mismatch",
      })),
      {
        name: "known deployment rejection survives expired diagnostics for durable settlement",
        repair: true,
        missing: true,
        expiredRejectionBody: true,
        reason: "provider_temporary_failure",
      },
      {
        name: "no-POST deadline stop clears only this deployment intent and permits later recovery",
        repair: true,
        missing: true,
        expireBeforeDeploy: true,
        reason: "provider_temporary_failure",
      },
      {
        name: "lost begin RPC response is settled as not sent without a provider POST",
        repair: true,
        missing: true,
        loseBeginResponse: true,
        reason: "provider_temporary_failure",
      },
      {
        name: "continuation lost during begin prevents POST but retains automatic retry",
        repair: true,
        missing: true,
        stopBeforeDeploy: true,
        reason: "provider_temporary_failure",
      },
      {
        name: "successful returned body survives work stop for receipt capture and resume",
        repair: true,
        missing: true,
        stopResponse: "success",
        reload: true,
        reason: "provider_temporary_failure",
        retainsCleanupIdentity: true,
      },
      ...["invalid_json", "invalid_shape", "no_response"].map((stopResponse) => ({
        name: `dispatched ${stopResponse} stays unresolved without another deployment`,
        repair: true,
        missing: true,
        stopResponse,
        reload: true,
        reason: "provider_temporary_failure",
        ambiguousCreate: true,
      })),
    ]) {
      const now = Date.now;
      Object.assign(versionState, {
        rpc: [],
        fetches: [],
        operations: 0,
        startAt: now(),
        expireBeforeDeploy: test.expireBeforeDeploy,
        loseBeginResponse: test.loseBeginResponse,
        stopBeforeDeploy: test.stopBeforeDeploy,
        stopResponse: test.stopResponse,
        permit: true,
        successfulDeploy: null,
        loseRpcResponse: test.loseRpcResponse ?? null,
        lostCreateResponse: test.lostCreateResponse ?? false,
        definition: { ...definition, ...test.definition },
        inventory: [],
        resources: new Map(),
        webhooks: new Map(),
        claim: {
          connection: {
            id: "connection",
            profile_id: "version-profile",
            environment: "test",
            pipedream_account_id: "apn_version123",
            connection_revision: 3,
          },
          binding: {
            id: "binding",
            profile_id: "version-profile",
            environment: "test",
            connection_id: "connection",
            pipedream_account_id: "apn_version123",
            configuration_revision: 3,
            selected_calendar_ids: ["primary"],
            component_key: triggerKey,
            component_version: "1.2.3",
            deployed_trigger_id: test.missing ? null : providerTrigger.id,
            webhook_id: "wh_version",
            webhook_correlation_id: "correlation",
            reconciliation_fencing_token: 7,
            reconciliation_lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
            deployment_operation_id: null,
            deployment_candidate_trigger_id: null,
            deployment_receipt: test.receipt ? { ...savedReceipt, ...test.receiptDrift } : null,
            pending_trigger_deletions: [],
            retired_trigger_ids: [],
            deployment_dispatched_at: test.dispatched ? new Date().toISOString() : null,
          },
          selections: [
            { google_calendar_id: "primary", blocks_availability: true, receives_bookings: true },
          ],
          cleanup_only: false,
        },
      });
      const webhookUrl = (triggerId) =>
        google.subject.pipedreamTriggerWebhookUrl({
          environment: "test",
          bindingId: "binding",
          accountId: "apn_version123",
          correlationId: "correlation",
          triggerId,
        });
      if (!test.missing) {
        versionState.resources.set(providerTrigger.id, { ...providerTrigger, ...test.trigger });
        versionState.webhooks.set(providerTrigger.id, webhookUrl(providerTrigger.id));
      }
      const wrong = {
        ...providerTrigger,
        id: "dc_wrong123",
        component_id: "sc_other123",
        component_version: "1.2.3",
      };
      versionState.inventory = test.wrongOnly
        ? [wrong]
        : test.inventory
          ? [...(test.wrongFirst ? [wrong] : []), providerTrigger]
          : [];
      for (const resource of versionState.inventory)
        versionState.resources.set(resource.id, resource);
      const createdTriggerId = test.replace ? "dc_replacement123" : providerTrigger.id;
      globalThis.fetch = async (input, init = {}) => {
        const url = new URL(input);
        const method = init.method ?? "GET";
        versionState.fetches.push({ path: url.pathname, method, body: init.body });
        assert.equal(url.origin, "https://api.pipedream.com");
        if (url.pathname === "/v1/oauth/token") {
          assert.equal(JSON.parse(init.body).scope, "connect:*");
          return Response.json({ access_token: "fixture-version", expires_in: 3600 });
        }
        assert.ok(
          url.pathname.startsWith("/v1/connect/project/"),
          "no unsupported metadata endpoint",
        );
        if (url.pathname.endsWith("/accounts"))
          return Response.json({
            data: [
              {
                id: "apn_version123",
                app: { name_slug: "google_calendar" },
                healthy: true,
                authorized_scopes: ["https://www.googleapis.com/auth/calendar"],
              },
            ],
            page_info: {},
          });
        if (url.pathname.includes("/proxy/")) {
          const target = proxyTarget({ url });
          if (target.pathname.endsWith("/calendarList"))
            return Response.json({
              items: [{ id: "primary", summary: "Calendar", accessRole: "owner" }],
            });
          assert.equal(target.pathname, "/calendar/v3/freeBusy");
          return Response.json({ calendars: { primary: { busy: [] } } });
        }
        if (url.pathname.endsWith(`/triggers/${triggerKey}`)) {
          assert.equal(url.searchParams.get("version"), "1.2.3");
          return Response.json({ data: versionState.definition });
        }
        if (url.pathname.endsWith("/deployed-triggers")) {
          return Response.json({
            data: versionState.inventory,
            page_info: {},
          });
        }
        if (url.pathname.endsWith("/triggers/deploy")) {
          const body = JSON.parse(init.body);
          assert.equal(body.id, triggerKey);
          assert.equal(body.version, "1.2.3");
          assert.equal(body.emit_on_deploy, false);
          assert.deepEqual(
            body,
            {
              id: triggerKey,
              version: "1.2.3",
              external_user_id: "obra:test:version-profile",
              emit_on_deploy: false,
              configured_props: {
                googleCalendar: { authProvisionId: "apn_version123" },
                calendarIds: ["primary"],
                newOnly: false,
              },
            },
            "the successful response is attributable to the complete frozen pinned request",
          );
          if (test.expiredRejectionBody) {
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"error":'));
                },
                pull(controller) {
                  // The provider's 10-second body budget expires, not the caller's DB reserve.
                  Date.now = () => now() + 10_010;
                  controller.close();
                },
              }),
              { status: 429 },
            );
          }
          const created = { ...providerTrigger, id: createdTriggerId, ...test.trigger };
          versionState.resources.set(created.id, structuredClone(created));
          versionState.inventory = [structuredClone(created)];
          if (versionState.stopResponse) {
            const mode = versionState.stopResponse;
            versionState.stopResponse = null;
            versionState.permit = false;
            if (mode === "no_response") return new Promise(() => {});
            if (mode === "invalid_json") return new Response('{"data":');
            if (mode === "invalid_shape") return Response.json({ data: { id: created.id } });
          }
          if (versionState.lostCreateResponse) {
            versionState.lostCreateResponse = false;
            throw new Error("Lost successful deployment response");
          }
          versionState.successfulDeploy = structuredClone(created);
          return Response.json({ data: created });
        }
        const resourceId = url.pathname.split("/deployed-triggers/")[1]?.split("/")[0];
        if (url.pathname.endsWith("/webhooks")) {
          assert.equal(method, "PUT");
          const configuredUrl = JSON.parse(init.body).webhook_urls[0];
          assert.equal(configuredUrl, webhookUrl(resourceId));
          versionState.webhooks.set(resourceId, configuredUrl);
          return Response.json({
            webhook_urls: [configuredUrl],
            webhooks: [{ id: "wh_version", url: configuredUrl, signing_key: "fixture-key" }],
          });
        }
        if (url.pathname.endsWith("/webhooks/wh_version"))
          return Response.json({
            data: {
              id: "wh_version",
              url: versionState.webhooks.get(resourceId),
              signing_key: "fixture-key",
              updated_at: Date.now() / 1000,
            },
          });
        assert.ok(resourceId, "request must target a known Connect operation");
        if (method === "DELETE") {
          versionState.resources.delete(resourceId);
          versionState.inventory = versionState.inventory.filter(({ id }) => id !== resourceId);
          return new Response(null, { status: 204 });
        }
        const resource = versionState.resources.get(resourceId);
        return resource ? Response.json({ data: resource }) : new Response(null, { status: 404 });
      };
      const refresh = (allowRepair = test.repair ?? false) => {
        const work = () =>
          versionBundle.subject.refreshSavedGoogleCalendar({
            profileId: "version-profile",
            environment: "test",
            allowRepair,
            deadlineAt: Date.now() + 25_000,
          });
        return test.stopResponse || test.stopBeforeDeploy
          ? versionState.withWorkerDeadline(Date.now() + 1_000, work, {
              workDeadlineAt: Date.now() + 200,
              canContinue: () => versionState.permit,
            })
          : work();
      };
      if (test.success) {
        assert.deepEqual(await refresh(), { checked: true }, test.name);
        const projection = versionState.rpc.find(
          ({ name }) => name === "apply_pipedream_trigger_projection",
        );
        assert.ok(projection, test.name);
        assert.equal(projection.args.p_observed_component_version, definition.version, test.name);
        assert.equal(projection.args.p_observed_component_key, triggerKey, test.name);
        assert.equal(
          projection.args.p_deployed_trigger_id,
          test.replace ? createdTriggerId : providerTrigger.id,
          test.name,
        );
      } else {
        try {
          await assert.rejects(refresh, new RegExp(test.reason), test.name);
        } finally {
          Date.now = now;
        }
        assert.equal(
          versionState.rpc.some(({ name }) => name === "apply_pipedream_trigger_projection"),
          test.loseRpcResponse === "apply_pipedream_trigger_projection",
          test.name,
        );
        if (test.expiredRejectionBody) {
          assert.equal(
            versionState.rpc.find(({ name }) => name === "fail_pipedream_binding_reconciliation")
              .args.p_deployment_definitely_rejected,
            true,
            "a known 429 releases the same dispatch marker instead of stranding an empty inventory",
          );
          assert.equal(
            versionState.fetches.filter(({ path }) => path.endsWith("/triggers/deploy")).length,
            1,
          );
        }
        if (test.expireBeforeDeploy || test.loseBeginResponse || test.stopBeforeDeploy) {
          assert.equal(
            versionState.rpc.find(({ name }) => name === "fail_pipedream_binding_reconciliation")
              .args.p_deployment_definitely_rejected,
            true,
          );
          assert.equal(versionState.claim.binding.deployment_dispatched_at, null);
          assert.equal(
            versionState.fetches.some(({ path }) => path.endsWith("/triggers/deploy")),
            false,
          );
        }
        if (test.stopResponse) {
          assert.ok(versionState.claim.binding.reconciliation_due_at);
          assert.ok(versionState.claim.binding.deployment_dispatched_at);
          const sent = versionState.fetches.filter(({ method }) => method !== "GET");
          assert.equal(sent.filter(({ path }) => path.endsWith("/triggers/deploy")).length, 1);
          assert.equal(
            sent.some(({ method }) => method === "DELETE" || method === "PUT"),
            false,
            "stopped returned outcomes permit only settlement, not cleanup or webhook writes",
          );
        }
        assert.equal(
          versionState.rpc.some(({ name }) => name === "adopt_pipedream_trigger_candidate"),
          test.retainsCleanupIdentity || Boolean(test.loseRpcResponse),
          test.name,
        );
      }
      assert.equal(
        versionState.fetches.filter(({ path }) => path.endsWith(`/triggers/${triggerKey}`)).length,
        typeof test.trigger?.component_key === "number" ? 0 : 1,
        "one pinned definition lookup supplies evidence to GET/list/deploy checks",
      );
      if (!test.repair || test.inventory)
        assert.equal(
          versionState.fetches.some(({ path }) => path.endsWith("/triggers/deploy")),
          false,
          test.name,
        );
      const creates = () =>
        versionState.fetches.filter(({ path }) => path.endsWith("/triggers/deploy"));
      const receiptWrites = () =>
        versionState.rpc.filter(
          ({ name, args }) =>
            name === "adopt_pipedream_trigger_candidate" && args.p_component_id !== undefined,
        );
      if (test.inventory)
        assert.equal(
          receiptWrites().length,
          0,
          "inventory adoption cannot mint a deployment receipt",
        );
      if (test.replace) {
        const deleted = versionState.fetches.findIndex(({ method }) => method === "DELETE");
        const deployed = versionState.fetches.findIndex(({ path }) =>
          path.endsWith("/triggers/deploy"),
        );
        assert.ok(
          deleted >= 0 && deployed > deleted,
          "replace only after fenced retirement and cleanup",
        );
        assert.ok(versionState.claim.binding.retired_trigger_ids.includes(providerTrigger.id));
      }
      if (test.contradictory) {
        assert.equal(
          versionState.claim.binding.deployment_receipt,
          null,
          "contradictory provider evidence is cleanup ownership, never a reusable proof",
        );
        versionState.definition = definition;
        await assert.rejects(() => refresh(false), /trigger_contract_mismatch/);
      }
      if (test.reload) {
        versionState.permit = true;
        const persisted = JSON.stringify(versionState.claim);
        const receipt = structuredClone(versionState.claim.binding.deployment_receipt);
        const createCount = creates().length;
        const receiptCount = receiptWrites().length;
        await versionBundle.cleanup();
        versionBundle = await importWithMocks(
          path.resolve("src/lib/pipedream-trigger-reconciliation.server.ts"),
          versionMocks,
        );
        versionState.claim = JSON.parse(persisted);
        if (test.lostCreateResponse || test.ambiguousCreate) {
          assert.equal(receipt, null);
          assert.equal(receiptCount, 0);
          for (let attempt = 0; attempt < 2; attempt++)
            await assert.rejects(() => refresh(true), /trigger_deployment_ambiguous/);
        } else {
          assert.deepEqual(receipt, {
            trigger_id: createdTriggerId,
            component_id: providerTrigger.component_id,
            component_key: triggerKey,
            component_version: definition.version,
            operation_id: "operation-fixture-1",
          });
          await refresh(
            test.loseRpcResponse === "adopt_pipedream_trigger_candidate" ||
              test.stopResponse === "success",
          );
          assert.equal(versionState.claim.binding.trigger_state, "active");
          assert.equal(versionState.claim.binding.deployment_operation_id, null);
          assert.deepEqual(versionState.claim.binding.deployment_receipt, receipt);
        }
        assert.equal(creates().length, createCount, "restart must not dispatch another CREATE");
        assert.equal(
          receiptWrites().length,
          receiptCount,
          "restart consumes durable proof; it cannot recreate it from GET",
        );
      }
      if (test.expireBeforeDeploy || test.loseBeginResponse || test.stopBeforeDeploy) {
        versionState.expireBeforeDeploy = false;
        versionState.loseBeginResponse = false;
        versionState.stopBeforeDeploy = false;
        versionState.permit = true;
        await refresh(true);
        assert.equal(creates().length, 1, "the recovered attempt creates once, not a duplicate");
        assert.equal(versionState.claim.binding.trigger_state, "active");
      }
      console.log(`PASS: ${test.name}`);
    }
    console.log(
      "PASS: documented ID-less definitions, pinned deployment receipts, reload, ambiguous effects and contradictory evidence (real adapters, mocked transport)",
    );
  } finally {
    delete globalThis.__pipedreamVersionTest;
    await versionBundle.cleanup();
  }

  await google.cleanup();

  console.log(
    "OK: provider-mocked Stripe/Resend plus Pipedream pagination, sanitized classification, booking content, and stable probe recovery executed",
  );
} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
}
