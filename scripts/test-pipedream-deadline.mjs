import assert from "node:assert/strict";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const originalRandom = Math.random;
const bundles = [];
const privateValue =
  "fixture-private-token customer@example.test https://example.test/?secret=fixture";
const input = { profileId: "deadline-profile", environment: "test", accountId: "apn_deadline" };
const tokenResponse = () => Response.json({ access_token: "fixture-token", expires_in: 3600 });
const emptyAccounts = () => Response.json({ data: [], page_info: {} });
const isToken = (url) => new URL(url).pathname === "/v1/oauth/token";
const targetUrl = (url) =>
  new URL(
    Buffer.from(decodeURIComponent(new URL(url).pathname.split("/proxy/")[1]), "base64").toString(),
  );

async function fresh() {
  const bundle = await importWithMocks(path.resolve("src/lib/pipedream.server.ts"), {});
  bundles.push(bundle);
  return bundle.subject;
}

function stalledBody(onCancel, prefix = '{"unfinished":') {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(prefix));
      },
      cancel() {
        onCancel();
        // Even a broken transport whose cancellation never settles cannot extend the deadline.
        return new Promise(() => {});
      },
    }),
  );
}

async function deadlineFailure(pd, work, operation) {
  const start = Date.now();
  await assert.rejects(pd.withPipedreamDeadline(start + 80, work), (error) => {
    assert.equal(error.reason, "deadline_exceeded");
    if (operation) assert.equal(error.operation, operation);
    assert.equal(pd.classifyPipedreamFailure(error), "temporary");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(
      error.message + JSON.stringify(error),
      /fixture-private|customer@|secret=fixture/,
    );
    return true;
  });
  assert.ok(Date.now() - start < 500, "deadline includes the full body, not just response headers");
}

try {
  process.env = {
    ...originalEnv,
    PIPEDREAM_CLIENT_ID: "fixture-client",
    PIPEDREAM_CLIENT_SECRET: "fixture-secret",
    PIPEDREAM_PROJECT_ID: "fixture-project",
    PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG: "google_calendar",
    PUBLIC_APP_URL: "https://app.example.test",
  };
  Math.random = () => 0;

  const defaultPd = await fresh();
  const originalNow = Date.now;
  let defaultCalls = 0;
  let defaultBodyCancelled = false;
  globalThis.fetch = async (url) => {
    defaultCalls++;
    if (isToken(url)) {
      // Exhaust almost all of the built-in 10s budget without a slow test.
      Date.now = () => originalNow() + 9_750;
      return tokenResponse();
    }
    return stalledBody(() => {
      defaultBodyCancelled = true;
    });
  };
  try {
    await assert.rejects(() => defaultPd.listGoogleAccounts(input.profileId, "test"), {
      reason: "deadline_exceeded",
    });
    assert.equal(defaultCalls, 2);
    assert.equal(
      defaultBodyCancelled,
      true,
      "the default budget is not restarted after acquiring a token",
    );
  } finally {
    Date.now = originalNow;
  }

  // Token and successful resource bodies both consume the enclosing budget.
  for (const hangToken of [true, false]) {
    const pd = await fresh();
    let cancelled = false;
    let calls = 0;
    let signal;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (isToken(url) && !hangToken) return tokenResponse();
      signal = init.signal;
      return stalledBody(() => {
        cancelled = true;
      });
    };
    await deadlineFailure(
      pd,
      () => pd.listGoogleAccounts(input.profileId, "test"),
      hangToken ? "Pipedream authentication" : "Pipedream account discovery",
    );
    assert.equal(cancelled, true);
    assert.equal(signal.aborted, true);
    assert.equal(calls, hangToken ? 1 : 2);
  }

  const pd = await fresh();
  globalThis.fetch = async (url) => (isToken(url) ? tokenResponse() : emptyAccounts());
  await pd.listGoogleAccounts(input.profileId, "test");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return emptyAccounts();
  };
  for (const deadline of [Date.now() - 1, NaN, Infinity]) {
    await assert.rejects(
      pd.withPipedreamDeadline(deadline, async () => {
        calls++;
        return pd.listGoogleAccounts(input.profileId, "test");
      }),
    );
  }
  assert.equal(calls, 0, "expired/invalid scopes never start work or acquire tokens");

  // Optional diagnostics cannot erase a known rejection when they consume the remaining budget.
  for (const status of [400, 401, 403, 404, 429, 503]) {
    let sent = 0;
    let cancelled = false;
    globalThis.fetch = async (url) => {
      assert.equal(isToken(url), false, "expired diagnostics must not start machine refresh");
      sent++;
      const stream = stalledBody(() => {
        cancelled = true;
      });
      return new Response(stream.body, { status, headers: { "retry-after": "60" } });
    };
    await assert.rejects(
      pd.withPipedreamDeadline(Date.now() + 60, () =>
        pd.deployPipedreamTrigger({
          ...input,
          key: "google_calendar-new-or-updated-event-instant",
          version: "0.1.20",
          configuredProps: {},
        }),
      ),
      (error) =>
        error instanceof pd.PipedreamRequestError &&
        error.status === status &&
        error.layer === "pipedream",
      `observed HTTP ${status} must survive missing diagnostics`,
    );
    assert.equal(sent, 1);
    assert.equal(cancelled, true);
  }
  let stoppedRetries = 0;
  globalThis.fetch = async () => {
    stoppedRetries++;
    return new Response(stalledBody(() => {}).body, { status: 503 });
  };
  await assert.rejects(
    pd.withPipedreamDeadline(Date.now() + 60, () => pd.listGoogleAccounts(input.profileId, "test")),
    { status: 503 },
    "the default three-attempt reader also keeps the last HTTP failure when no retry can start",
  );
  assert.equal(stoppedRetries, 1);

  const rejectingTokenPd = await fresh();
  let rejectedTokens = 0;
  globalThis.fetch = async (url) => {
    assert.equal(isToken(url), true);
    rejectedTokens++;
    return new Response(stalledBody(() => {}).body, { status: 403 });
  };
  await assert.rejects(
    rejectingTokenPd.withPipedreamDeadline(Date.now() + 60, () =>
      rejectingTokenPd.listGoogleAccounts(input.profileId, "test"),
    ),
    (error) =>
      error.status === 403 &&
      error.layer === "machine" &&
      !(error instanceof rejectingTokenPd.PipedreamRequestError) &&
      rejectingTokenPd.classifyPipedreamFailure(error) === "platform",
  );
  assert.equal(rejectedTokens, 1, "machine rejection remains distinct from resource absence");

  const readMethods = [];
  globalThis.fetch = async (url, init = {}) => {
    readMethods.push(init.method ?? "GET");
    if (!targetUrl(url).searchParams.has("fields")) {
      await sleep(25);
      return Response.json(
        { error: { code: 404, errors: [{ domain: "global", reason: "notFound" }] } },
        { status: 404 },
      );
    }
    return stalledBody(() => {});
  };
  await deadlineFailure(
    pd,
    () =>
      pd.getGoogleBookingEvent({
        ...input,
        calendarId: "primary",
        eventId: "0b12345",
        appointmentId: "apt",
      }),
    "Google Calendar access verification via Pipedream",
  );
  assert.deepEqual(
    readMethods,
    ["GET", "GET"],
    "event 404 and exact access read share one deadline",
  );

  for (const work of [
    () => pd.listGoogleCalendars(input),
    () => pd.listDeployedPipedreamTriggers(input),
    () => pd.createGoogleConnectLink({ ...input, websiteId: "website" }),
  ]) {
    let cancelled = false;
    globalThis.fetch = async () =>
      stalledBody(() => {
        cancelled = true;
      });
    await deadlineFailure(pd, work);
    assert.equal(cancelled, true);
  }
  let headerSignal;
  globalThis.fetch = async (_url, init) => {
    headerSignal = init.signal;
    return new Promise(() => {});
  };
  await deadlineFailure(pd, () => pd.listGoogleAccounts(input.profileId, "test"));
  assert.equal(
    headerSignal.aborted,
    true,
    "even a fetch ignoring abort cannot hold the caller open",
  );

  // Every success operation uses a finite body limit; no Content-Length header is needed.
  for (const [work, bytes] of [
    [() => pd.createGoogleConnectLink({ ...input, websiteId: "website" }), 16_385],
    [() => pd.listGoogleAccounts(input.profileId, "test"), 4_194_305],
    [() => pd.listGoogleCalendars(input), 4_194_305],
    [
      () =>
        pd.getGoogleBookingEvent({
          ...input,
          calendarId: "primary",
          eventId: "0b12345",
          appointmentId: "apt",
        }),
      1_048_577,
    ],
  ]) {
    let cancelled = false;
    globalThis.fetch = async () =>
      stalledBody(() => {
        cancelled = true;
      }, "x".repeat(bytes));
    await assert.rejects(
      work,
      (error) =>
        error.reason === "response_too_large" && pd.classifyPipedreamFailure(error) === "temporary",
    );
    assert.equal(cancelled, true);
  }
  const largeToken = await fresh();
  globalThis.fetch = async () => new Response("x".repeat(16_385));
  await assert.rejects(() => largeToken.listGoogleAccounts(input.profileId, "test"), {
    operation: "Pipedream authentication",
    reason: "response_too_large",
  });
  for (const body of [
    { access_token: "", expires_in: 3600 },
    { access_token: "fixture\nprivate", expires_in: 3600 },
    { access_token: "fixture", expires_in: 0 },
    { access_token: "fixture", expires_in: 0.5 },
    { access_token: "fixture", expires_in: 1e300 },
  ]) {
    globalThis.fetch = async () => Response.json(body);
    await assert.rejects(() => largeToken.listGoogleAccounts(input.profileId, "test"), {
      operation: "Pipedream authentication",
      reason: "invalid_response",
    });
  }

  // Token acquisition, retry backoff, and the eventual success body share ONE deadline.
  const retryPd = await fresh();
  let tokenCalls = 0;
  let resources = 0;
  let cancelled = false;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      tokenCalls++;
      await sleep(60);
      return tokenResponse();
    }
    resources++;
    if (resources === 1) return Response.json({ error: "unavailable" }, { status: 503 });
    return stalledBody(() => {
      cancelled = true;
    });
  };
  const retryStart = Date.now();
  await assert.rejects(
    retryPd.withPipedreamDeadline(retryStart + 300, () =>
      retryPd.listGoogleAccounts(input.profileId, "test"),
    ),
    { reason: "deadline_exceeded" },
  );
  assert.equal(tokenCalls, 1);
  assert.equal(resources, 2);
  assert.equal(cancelled, true);
  assert.ok(Date.now() - retryStart < 600);

  const retryTokenPd = await fresh();
  tokenCalls = 0;
  resources = 0;
  cancelled = false;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      tokenCalls++;
      if (tokenCalls === 1) return Response.json({}, { status: 503 });
      await sleep(50);
      return tokenResponse();
    }
    resources++;
    return stalledBody(() => {
      cancelled = true;
    });
  };
  const tokenRetryStart = Date.now();
  await assert.rejects(
    retryTokenPd.withPipedreamDeadline(tokenRetryStart + 300, () =>
      retryTokenPd.listGoogleAccounts(input.profileId, "test"),
    ),
    { reason: "deadline_exceeded" },
  );
  assert.equal(tokenCalls, 2);
  assert.equal(resources, 1);
  assert.equal(cancelled, true);
  assert.ok(Date.now() - tokenRetryStart < 600);

  const connectAuthPd = await fresh();
  tokenCalls = 0;
  resources = 0;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      tokenCalls++;
      return Response.json({}, { status: 503 });
    }
    resources++;
    return Response.json({}, { status: 503 });
  };
  await assert.rejects(
    () => connectAuthPd.createGoogleConnectLink({ ...input, websiteId: "website" }),
    (error) => error.status === 503 && error.operation === "Pipedream authentication",
  );
  assert.equal(tokenCalls, 1, "Connect Link does not retry machine-token 503");
  assert.equal(resources, 0, "Connect token POST is not sent after auth failure");

  const connectTokenPd = await fresh();
  tokenCalls = 0;
  resources = 0;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      tokenCalls++;
      return tokenResponse();
    }
    resources++;
    return Response.json({ error: "unavailable" }, { status: 503 });
  };
  await assert.rejects(
    () => connectTokenPd.createGoogleConnectLink({ ...input, websiteId: "website" }),
    (error) => error.status === 503 && error.operation === "Pipedream Connect link creation",
  );
  assert.equal(tokenCalls, 1);
  assert.equal(resources, 1, "Connect token POST is one-shot");

  // A Retry-After longer than remaining budget fails now instead of retrying too early.
  resources = 0;
  globalThis.fetch = async () => {
    resources++;
    return Response.json({}, { status: 429, headers: { "Retry-After": "30" } });
  };
  await assert.rejects(
    pd.withPipedreamDeadline(Date.now() + 80, () => pd.listGoogleAccounts(input.profileId, "test")),
    { status: 429 },
  );
  assert.equal(resources, 1);
  let firstCancelled = false;
  resources = 0;
  globalThis.fetch = async () => {
    resources++;
    if (resources === 1)
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(16_385)));
          },
          cancel() {
            firstCancelled = true;
          },
        }),
        { status: 503 },
      );
    return emptyAccounts();
  };
  assert.deepEqual(await pd.listGoogleAccounts(input.profileId, "test"), []);
  assert.equal(firstCancelled, true, "discarded retry bodies are cancelled");
  assert.equal(resources, 2);

  // Enclosing scopes also span successive operations and later inventory pages.
  resources = 0;
  globalThis.fetch = async () => {
    resources++;
    if (resources === 1) {
      await sleep(40);
      return emptyAccounts();
    }
    return stalledBody(() => {});
  };
  await deadlineFailure(pd, async () => {
    await pd.listGoogleAccounts(input.profileId, "test");
    return pd.listGoogleCalendars(input);
  });
  assert.equal(resources, 2);
  resources = 0;
  globalThis.fetch = async () => {
    resources++;
    if (resources === 1) {
      await sleep(40);
      return Response.json({ data: [], page_info: { end_cursor: "page_two" } });
    }
    return stalledBody(() => {});
  };
  await deadlineFailure(pd, () => pd.listGoogleAccounts(input.profileId, "test"));
  assert.equal(resources, 2);

  // Only the machine layer refreshes; it refreshes once, even for a mutation.
  const authPd = await fresh();
  tokenCalls = 0;
  resources = 0;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      tokenCalls++;
      return tokenResponse();
    }
    resources++;
    return Response.json({ code: "invalid_token", message: privateValue }, { status: 401 });
  };
  await assert.rejects(() => authPd.listGoogleAccounts(input.profileId, "test"), { status: 401 });
  assert.equal(tokenCalls, 2);
  assert.equal(resources, 2);
  tokenCalls = 0;
  resources = 0;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      tokenCalls++;
      return tokenResponse();
    }
    resources++;
    return resources === 1
      ? new Response(null, { status: 401 })
      : new Response(null, { status: 204 });
  };
  await authPd.deletePipedreamAccount(input);
  assert.equal(tokenCalls, 1, "expired cached machine token is refreshed once");
  assert.equal(resources, 2, "authorized resource retry succeeds without another refresh");
  const refreshDeadlinePd = await fresh();
  tokenCalls = 0;
  resources = 0;
  cancelled = false;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      tokenCalls++;
      if (tokenCalls === 1) {
        await sleep(30);
        return tokenResponse();
      }
      return stalledBody(() => {
        cancelled = true;
      });
    }
    resources++;
    return new Response(null, { status: 401 });
  };
  await assert.rejects(
    refreshDeadlinePd.withPipedreamDeadline(Date.now() + 80, () =>
      refreshDeadlinePd.listGoogleAccounts(input.profileId, "test"),
    ),
    { status: 401, operation: "Pipedream account discovery", dispatched: true },
    "a stopped machine refresh must not erase the resource's known rejection",
  );
  assert.equal(tokenCalls, 2);
  assert.equal(resources, 1);
  assert.equal(cancelled, true);
  resources = 0;
  globalThis.fetch = async (url) => {
    assert.equal(isToken(url), false);
    resources++;
    return Response.json(
      { error: { code: 401, errors: [{ domain: "global", reason: "authError" }] } },
      { status: 401 },
    );
  };
  await assert.rejects(
    () => pd.listGoogleCalendars(input),
    (error) => error.layer === "google" && pd.classifyPipedreamFailure(error) === "temporary",
  );
  assert.equal(resources, 1);

  // Auth 404/410 may never be interpreted as a missing account, trigger, or event.
  for (const status of [404, 410]) {
    const missingAuth = await fresh();
    globalThis.fetch = async (url) => {
      assert.equal(isToken(url), true);
      return Response.json(
        { error: "invalid_client", error_description: privateValue },
        { status },
      );
    };
    for (const work of [
      () => missingAuth.deletePipedreamAccount(input),
      () => missingAuth.deletePipedreamTrigger({ ...input, triggerId: "dc_fixture" }),
      () =>
        missingAuth.getGoogleBookingEvent({
          ...input,
          calendarId: "primary",
          eventId: "0b12345",
          appointmentId: "apt",
        }),
      () =>
        missingAuth.deleteGoogleBookingEvent({
          ...input,
          calendarId: "primary",
          eventId: "0b12345",
          ifMatch: '"etag"',
        }),
    ]) {
      await assert.rejects(work, (error) => {
        assert.equal(error instanceof missingAuth.PipedreamRequestError, false);
        assert.equal(error.layer, "machine");
        assert.equal(missingAuth.classifyPipedreamFailure(error), "platform");
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(JSON.stringify(error), /fixture-private|customer@|secret=fixture/);
        return true;
      });
    }
  }

  // Parallel request scopes cannot extend or shorten each other's budgets.
  let shortCancelled = false;
  globalThis.fetch = async (url) => {
    const user = new URL(url).searchParams.get("external_user_id");
    if (user.endsWith(":short"))
      return stalledBody(() => {
        shortCancelled = true;
      });
    await sleep(120);
    return emptyAccounts();
  };
  const parallelStart = Date.now();
  const outcomes = await Promise.allSettled([
    pd.withPipedreamDeadline(parallelStart + 60, () => pd.listGoogleAccounts("short", "test")),
    pd.withPipedreamDeadline(parallelStart + 500, () => pd.listGoogleAccounts("long", "test")),
  ]);
  assert.equal(outcomes[0].status, "rejected");
  assert.equal(outcomes[0].reason.reason, "deadline_exceeded");
  assert.equal(outcomes[1].status, "fulfilled");
  assert.equal(shortCancelled, true);
  assert.ok(Date.now() - parallelStart < 400);
  const parallelTokenPd = await fresh();
  let parallelTokens = 0;
  let tokenCancelled = false;
  globalThis.fetch = async (url) => {
    if (isToken(url)) {
      parallelTokens++;
      if (parallelTokens === 1)
        return stalledBody(() => {
          tokenCancelled = true;
        });
      return tokenResponse();
    }
    return emptyAccounts();
  };
  const coldOutcomes = await Promise.allSettled([
    parallelTokenPd.withPipedreamDeadline(Date.now() + 60, () =>
      parallelTokenPd.listGoogleAccounts("cold-short", "test"),
    ),
    parallelTokenPd.withPipedreamDeadline(Date.now() + 500, () =>
      parallelTokenPd.listGoogleAccounts("cold-long", "test"),
    ),
  ]);
  assert.equal(parallelTokens, 2);
  assert.equal(coldOutcomes[0].status, "rejected");
  assert.equal(coldOutcomes[1].status, "fulfilled");
  assert.equal(
    tokenCancelled,
    true,
    "one request's hung token acquisition does not own another request's budget",
  );
  globalThis.fetch = async () => stalledBody(() => {});
  await deadlineFailure(pd, () =>
    pd.withPipedreamDeadline(Date.now() + 10_000, () => pd.listGoogleAccounts("nested", "test")),
  );
  globalThis.fetch = async () => emptyAccounts();
  assert.deepEqual(
    await pd.listGoogleAccounts("after-scope", "test"),
    [],
    "no ambient deadline leaks after the scope ends",
  );
  globalThis.fetch = async () => stalledBody(() => {});
  await pd.withPipedreamDeadline(Date.now() + 500, async () => {
    await assert.rejects(
      pd.withPipedreamDeadline(Date.now() + 40, () => pd.listGoogleAccounts("child", "test")),
      { reason: "deadline_exceeded" },
    );
    globalThis.fetch = async () => emptyAccounts();
    assert.deepEqual(
      await pd.listGoogleAccounts("parent", "test"),
      [],
      "a handled child timeout does not poison its live parent scope",
    );
  });

  // Catching a timeout does not permit another effect, even after a delayed continuation.
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return stalledBody(() => {});
  };
  await assert.rejects(
    pd.withPipedreamDeadline(Date.now() + 60, async () => {
      try {
        await pd.listGoogleAccounts("expired", "test");
      } catch {}
      await pd.deleteGoogleBookingEvent({
        ...input,
        calendarId: "primary",
        eventId: "0b12345",
        ifMatch: '"etag"',
      });
    }),
    { reason: "deadline_exceeded" },
  );
  assert.equal(calls, 1);
  calls = 0;
  let siblingCancelled = false;
  globalThis.fetch = async (url) => {
    calls++;
    if (new URL(url).searchParams.get("external_user_id").endsWith(":failed")) {
      await sleep(20);
      return Response.json({}, { status: 403 });
    }
    return stalledBody(() => {
      siblingCancelled = true;
    });
  };
  let sibling;
  await assert.rejects(
    pd.withPipedreamDeadline(Date.now() + 1000, async () => {
      sibling = pd.listGoogleAccounts("sibling", "test");
      return Promise.all([sibling, pd.listGoogleAccounts("failed", "test")]);
    }),
    { status: 403 },
  );
  await assert.rejects(sibling, { reason: "deadline_exceeded" });
  assert.equal(siblingCancelled, true, "scope exit aborts an unfinished provider sibling");
  assert.equal(calls, 2);

  // Timed-out INSERTs remain ambiguous. No GET/DELETE/second INSERT starts after expiry.
  for (const probe of [false, true]) {
    const methods = [];
    globalThis.fetch = async (url, init = {}) => {
      methods.push(init.method ?? "GET");
      if (init.method === "GET")
        return targetUrl(url).searchParams.has("fields")
          ? Response.json({ kind: "calendar#events", accessRole: "owner" })
          : Response.json(
              { error: { code: 404, errors: [{ domain: "global", reason: "notFound" }] } },
              { status: 404 },
            );
      assert.equal(init.method, "POST");
      assert.equal(targetUrl(url).searchParams.get("sendUpdates"), probe ? "none" : "all");
      return stalledBody(() => {});
    };
    const context = { ...input, calendarId: "primary", eventId: "0b12345" };
    await deadlineFailure(pd, () =>
      probe
        ? pd.verifyGoogleCalendarWrite({ ...context, operationId: "op" })
        : pd.createGoogleBookingEvent({
            ...context,
            appointmentId: "apt",
            summary: "Repair",
            description: "Booked",
            startAt: "2030-01-02T17:00:00Z",
            endAt: "2030-01-02T18:00:00Z",
            timeZone: "UTC",
            attendeeEmail: "c@example.test",
          }),
    );
    assert.deepEqual(methods, probe ? ["GET", "GET", "POST"] : ["POST"]);
  }

  // Network causes are sanitized rather than retained on an Error.cause chain.
  globalThis.fetch = async () => {
    throw new Error(privateValue);
  };
  await assert.rejects(
    () =>
      pd.proxyGoogleCalendar({
        ...input,
        target: new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList"),
        attempts: 1,
      }),
    (error) => {
      assert.equal(error.reason, "network_error");
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(
        error.message + JSON.stringify(error),
        /fixture-private|customer@|secret=fixture/,
      );
      return true;
    },
  );
  console.log(
    "OK: Pipedream full-body deadlines, bounded retries, auth separation, request isolation, and ambiguous writes (fake fetch only)",
  );
} finally {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  Math.random = originalRandom;
  await Promise.all(bundles.map((bundle) => bundle.cleanup()));
}
