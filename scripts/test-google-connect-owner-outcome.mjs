import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const sqlMessage = "Google Connect was recently started; retry shortly";
const fallback = "Unable to open Google setup. Please try again.";
const platformCopy =
  "Google setup could not be opened. This needs attention from Obra, not another sign-in.";

function rpcClient(error) {
  return {
    abortSignal() {
      return Promise.resolve({ data: error ? null : { id: "op" }, error });
    },
  };
}

const stateMocks = {
  "@/lib/auth/contractor-session.server": `export async function getContractorAuthUserId() { return "auth-1"; }`,
  "@/lib/pipedream.server": `export {};`,
  "@tanstack/react-start/server": `export function getRequest() { return {}; }`,
};

async function loadState(error = null) {
  return importWithMocks(path.resolve("src/lib/google-calendar-state.server.ts"), {
    ...stateMocks,
    "@/integrations/supabase/client.server": `
      export const supabaseAdmin = {
        rpc: () => (${JSON.stringify(error)} ? globalThis.__connectOwnerRpcError() : globalThis.__connectOwnerRpcOk()),
      };
    `,
  });
}

globalThis.__connectOwnerRpcError = () => rpcClient({ message: sqlMessage, code: "55P03" });
globalThis.__connectOwnerRpcOk = () => rpcClient(null);

const worker = await loadState({ message: sqlMessage, code: "55P03" });
await assert.rejects(
  () =>
    worker.subject.googleCalendarLifetimeRpc(
      "authorize_google_calendar_connect_start",
      {},
      Date.now() + 5_000,
    ),
  (error) =>
    error instanceof worker.subject.GoogleCalendarStateError &&
    error.message === "Google Calendar state could not be settled; maintenance will retry",
);
await worker.cleanup();

const owner = await loadState({ message: sqlMessage, code: "55P03" });
await assert.rejects(
  () =>
    owner.subject.googleCalendarLifetimeRpc(
      "authorize_google_calendar_connect_start",
      {},
      Date.now() + 5_000,
      { revealOwnerFailure: true },
    ),
  (error) =>
    !(error instanceof owner.subject.GoogleCalendarStateError) && error.message === sqlMessage,
);
await owner.cleanup();

const aborted = await importWithMocks(path.resolve("src/lib/google-calendar-state.server.ts"), {
  ...stateMocks,
  "@/integrations/supabase/client.server": `
    export const supabaseAdmin = {
      rpc: () => ({
        abortSignal() {
          return Promise.reject(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }));
        },
      }),
    };
  `,
});
await assert.rejects(
  () =>
    aborted.subject.googleCalendarLifetimeRpc(
      "authorize_google_calendar_connect_start",
      {},
      Date.now() + 5_000,
      { revealOwnerFailure: true },
    ),
  (error) =>
    error instanceof aborted.subject.GoogleCalendarStateError &&
    error.message === "Google Calendar state could not be settled; maintenance will retry",
);
await aborted.cleanup();

const transportMessage = "Database transport failed";
const ownerTransport = await importWithMocks(path.resolve("src/lib/google-calendar-state.server.ts"), {
  ...stateMocks,
  "@/integrations/supabase/client.server": `
    export const supabaseAdmin = {
      rpc: () => ({
        abortSignal() {
          return Promise.reject(Object.assign(new Error(${JSON.stringify(transportMessage)}), { code: "ABORT_ERR" }));
        },
      }),
    };
  `,
});
await assert.rejects(
  () =>
    ownerTransport.subject.googleCalendarLifetimeRpc(
      "authorize_google_calendar_connect_start",
      {},
      Date.now() + 5_000,
      { revealOwnerFailure: true },
    ),
  (error) =>
    !(error instanceof ownerTransport.subject.GoogleCalendarStateError) &&
    error.message === transportMessage,
);
await ownerTransport.cleanup();

const workerTransport = await importWithMocks(path.resolve("src/lib/google-calendar-state.server.ts"), {
  ...stateMocks,
  "@/integrations/supabase/client.server": `
    export const supabaseAdmin = {
      rpc: () => ({
        abortSignal() {
          return Promise.reject(Object.assign(new Error(${JSON.stringify(transportMessage)}), { code: "ABORT_ERR" }));
        },
      }),
    };
  `,
});
await assert.rejects(
  () =>
    workerTransport.subject.googleCalendarLifetimeRpc(
      "authorize_google_calendar_connect_start",
      {},
      Date.now() + 5_000,
    ),
  (error) =>
    error instanceof workerTransport.subject.GoogleCalendarStateError &&
    error.message === "Google Calendar state could not be settled; maintenance will retry",
);
await workerTransport.cleanup();

const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
const seenTimeouts = [];
AbortSignal.timeout = (ms) => {
  seenTimeouts.push(ms);
  return originalTimeout(ms);
};
try {
  seenTimeouts.length = 0;
  const workerBudget = await loadState(null);
  await workerBudget.subject.googleCalendarLifetimeRpc(
    "authorize_google_calendar_connect_start",
    {},
    Date.now() + 17_000,
  );
  assert.deepEqual(seenTimeouts, [5_000]);
  await workerBudget.cleanup();

  seenTimeouts.length = 0;
  const ownerBudget = await loadState(null);
  await ownerBudget.subject.googleCalendarLifetimeRpc(
    "authorize_google_calendar_connect_start",
    {},
    Date.now() + 17_000,
    { revealOwnerFailure: true },
  );
  assert.equal(seenTimeouts.length, 1);
  assert.ok(seenTimeouts[0] > 5_000 && seenTimeouts[0] <= 17_000);
  await ownerBudget.cleanup();
} finally {
  AbortSignal.timeout = originalTimeout;
}

const connect = await importWithMocks(path.resolve("src/lib/booking-provider.functions.ts"), {
  "@tanstack/react-start": `
    export function createServerFn() {
      return { validator(validate) {
        return { handler(handle) { return async ({ data }) => handle({ data: validate(data) }); } };
      } };
    }
  `,
  "@tanstack/react-start/server": `export function setResponseHeader() {}`,
  "@/lib/provider-authorization.server": `
    export async function providerMutationContext() {
      return {
        profile: { id: "profile-1" },
        website: { id: "website-1", environment: "test" },
        authUserId: "auth-1",
      };
    }
    export async function providerOwnerContext() { throw new Error("unused"); }
  `,
  "@/lib/google-calendar-state.server": `
    export class GoogleCalendarStateError extends Error {
      constructor() { super("Google Calendar state could not be settled; maintenance will retry"); }
    }
    export function requireGoogleCalendarSettlement(value) {
      if (!value) throw new GoogleCalendarStateError();
    }
    export async function googleCalendarLifetimeRpc(name, args, deadlineAt, options = {}) {
      globalThis.__connectOwnerCalls.push({ name, options, deadlineAt, now: Date.now() });
      if (globalThis.__connectOwnerRpc === "throttle") {
        const error = new Error(${JSON.stringify(sqlMessage)});
        if (options.revealOwnerFailure) throw error;
        throw new GoogleCalendarStateError();
      }
      if (globalThis.__connectOwnerRpc === "settle") throw new GoogleCalendarStateError();
      return { id: args.p_operation_id };
    }
  `,
  "@/lib/pipedream.server": `
    export class PipedreamError extends Error {
      constructor(status, operation = "Pipedream request", reason = null) {
        super(operation + " failed (" + status + (reason ? "; " + reason : "") + ")");
        this.name = "PipedreamError";
        this.status = status;
        this.operation = operation;
        this.reason = reason;
      }
    }
    export function classifyPipedreamFailure(error) {
      if (!(error instanceof PipedreamError)) return "temporary";
      if (error.reason === "network_error" || error.status === 503) return "temporary";
      if (error.operation === "Pipedream authentication" || error.reason === "invalid_client") return "platform";
      return "temporary";
    }
    export const REQUEST_TIMEOUT_MS = 10_000;
    export async function withPipedreamDeadline(_deadlineAt, work) { return work(); }
    export async function createGoogleConnectLink() {
      if (globalThis.__connectOwnerLink === "platform") {
        throw new PipedreamError(401, "Pipedream authentication", "invalid_client");
      }
      if (globalThis.__connectOwnerLink === "temporary") {
        throw new PipedreamError(503, "Pipedream Connect link creation", "network_error");
      }
      if (globalThis.__connectOwnerLink === "aborted") {
        throw Object.assign(
          new PipedreamError(0, "Pipedream authentication", "network_error"),
          { aborted: true },
        );
      }
      return { url: "https://connect.example.test/google" };
    }
  `,
  "@/lib/pipedream-trigger-reconciliation.server": `export {};`,
  "@/lib/booking-readiness.server": `export {};`,
  "@/lib/google-calendar-complete": `export {};`,
  "@/lib/worker-deadline.server": `export {};`,
  "@/lib/auth/cookies.server": `export function serializeCookie() { return "cookie"; }`,
  "@/integrations/supabase/client.server": `export const supabaseAdmin = {};`,
});

try {
  globalThis.__connectOwnerCalls = [];
  globalThis.__connectOwnerRpc = "ok";
  globalThis.__connectOwnerLink = "ok";
  const opened = await connect.subject.startGoogleCalendarConnect({
    data: { websiteId: "10000000-0000-4000-8000-000000000001" },
  });
  assert.equal(opened.url, "https://connect.example.test/google");
  assert.equal(globalThis.__connectOwnerCalls[0].options.revealOwnerFailure, true);
  assert.ok(
    globalThis.__connectOwnerCalls[0].deadlineAt - globalThis.__connectOwnerCalls[0].now > 9_000 &&
      globalThis.__connectOwnerCalls[0].deadlineAt - globalThis.__connectOwnerCalls[0].now <= 10_000,
    "owner Connect save must leave Pipedream's request timeout on the handler deadline",
  );

  globalThis.__connectOwnerCalls = [];
  globalThis.__connectOwnerRpc = "throttle";
  await assert.rejects(
    () =>
      connect.subject.startGoogleCalendarConnect({
        data: { websiteId: "10000000-0000-4000-8000-000000000001" },
      }),
    { message: sqlMessage },
  );

  globalThis.__connectOwnerRpc = "settle";
  await assert.rejects(
    () =>
      connect.subject.startGoogleCalendarConnect({
        data: { websiteId: "10000000-0000-4000-8000-000000000001" },
      }),
    { message: `${fallback} [rpc-settle]` },
  );

  globalThis.__connectOwnerRpc = "ok";
  globalThis.__connectOwnerLink = "temporary";
  await assert.rejects(
    () =>
      connect.subject.startGoogleCalendarConnect({
        data: { websiteId: "10000000-0000-4000-8000-000000000001" },
      }),
    { message: `${fallback} [pd-temporary 503/Pipedream Connect link creation/network_error/aborted=false]` },
  );

  globalThis.__connectOwnerLink = "aborted";
  await assert.rejects(
    () =>
      connect.subject.startGoogleCalendarConnect({
        data: { websiteId: "10000000-0000-4000-8000-000000000001" },
      }),
    { message: `${fallback} [pd-temporary 0/Pipedream authentication/network_error/aborted=true]` },
  );

  globalThis.__connectOwnerLink = "platform";
  await assert.rejects(
    () =>
      connect.subject.startGoogleCalendarConnect({
        data: { websiteId: "10000000-0000-4000-8000-000000000001" },
      }),
    { message: `${platformCopy} [pd-platform 401/Pipedream authentication/invalid_client/aborted=false]` },
  );

  console.log(
    "PASS: owner connect-start reveals SQL 55P03 and transport throws, maps provider failures, and leaves worker settlement collapsed",
  );
} finally {
  await connect.cleanup();
  delete globalThis.__connectOwnerCalls;
  delete globalThis.__connectOwnerRpc;
  delete globalThis.__connectOwnerLink;
  delete globalThis.__connectOwnerRpcError;
  delete globalThis.__connectOwnerRpcOk;
}
