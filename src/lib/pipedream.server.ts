import { AsyncLocalStorage } from "node:async_hooks";
import { workerCanContinue, workerProviderContext } from "@/lib/worker-deadline.server";
import {
  parseConfiguredPipedreamWebhook,
  parsePipedreamDeployedTrigger,
  parsePipedreamTriggerDefinition,
} from "@/lib/pipedream-trigger-contracts";

type PdEnvironment = "development" | "production";
type BookingEnvironment = "test" | "live";

export type PipedreamAccount = {
  id: string;
  name?: string | null;
  external_id?: string;
  healthy?: boolean;
  dead?: boolean | null;
  app?: { name_slug?: string; name?: string };
  authorized_scopes?: string[];
  error?: string | null;
  created_at?: string | null;
};

let cachedToken: { value: string; expiresAt: number } | null = null;
export const REQUEST_TIMEOUT_MS = 10_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
// Lovable's Cloudflare preset enables nodeCompat; Workers supports run/getStore.
type PipedreamDeadline = {
  deadlineAt: number;
  settlementDeadlineAt: number;
  signal: AbortSignal;
  controller: AbortController;
  parent?: PipedreamDeadline;
};
const requestDeadline = new AsyncLocalStorage<PipedreamDeadline>();

function fenceSharedPipedreamDeadline() {
  const current = requestDeadline.getStore();
  for (let scope: PipedreamDeadline | undefined = current; scope; scope = scope.parent) {
    if (scope === current || scope.deadlineAt <= (current?.deadlineAt ?? 0)) scope.controller.abort();
  }
}

type PipedreamOperation =
  | "Pipedream request"
  | "Pipedream authentication"
  | "Pipedream Connect link creation"
  | "Pipedream account discovery"
  | "Pipedream account deletion"
  | "Pipedream trigger discovery"
  | "Pipedream trigger definition lookup"
  | "Pipedream deployed trigger discovery"
  | "Pipedream trigger deployment"
  | "Pipedream trigger deletion"
  | "Pipedream webhook configuration"
  | "Pipedream deployed trigger lookup"
  | "Pipedream webhook lookup"
  | "Google Calendar proxy"
  | "Google Calendar list via Pipedream"
  | "Google Calendar access verification via Pipedream"
  | "Google Calendar availability via Pipedream"
  | "Google Calendar write verification via Pipedream"
  | "Google Calendar event lookup via Pipedream"
  | "Google Calendar event creation via Pipedream"
  | "Google Calendar event deletion via Pipedream";

// Provider messages can contain credentials, URLs, and customer data. Only
// documented machine codes may cross the server-function error boundary.
const PROVIDER_ERROR_REASONS = [
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "insufficientPermissions",
  "insufficient_scope",
  "accessNotConfigured",
  "SERVICE_DISABLED",
  "userRateLimitExceeded",
  "rateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
  "RESOURCE_EXHAUSTED",
  "invalid_scope",
  "invalid_client",
  "invalid_grant",
  "invalid_token",
  "access_denied",
  "forbidden",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "authError",
  "notFound",
  "deleted",
  "duplicate",
  "forbiddenForNonOrganizer",
  "conditionNotMet",
  "timeRangeEmpty",
  "groupTooBig",
  "tooManyCalendarsRequested",
  "internalError",
] as const;

type PipedreamErrorReason =
  | (typeof PROVIDER_ERROR_REASONS)[number]
  | "deadline_exceeded"
  | "network_error"
  | "invalid_response"
  | "response_too_large"
  | "invalid_configuration"
  | "event_conflict";
type PipedreamErrorLayer = "machine" | "pipedream" | "proxy" | "google";

function operationLayer(operation: PipedreamOperation): PipedreamErrorLayer {
  if (operation === "Pipedream authentication") return "machine";
  return operation.startsWith("Google Calendar") ? "proxy" : "pipedream";
}

// Machine authentication is deliberately NOT a PipedreamRequestError: even an
// auth endpoint's 404/410 must never satisfy a resource-absence catch handler.
export class PipedreamError extends Error {
  /** The requested resource transport, excluding machine-token calls. Undefined is not proof. */
  dispatched?: boolean;
  /** True when our own abort ended the fetch; absent/false is a network-layer failure. */
  aborted?: boolean;
  requestOperation?: PipedreamOperation;
  constructor(
    readonly status: number,
    readonly operation: PipedreamOperation = "Pipedream request",
    readonly reason: PipedreamErrorReason | null = null,
    readonly layer: PipedreamErrorLayer = operationLayer(operation),
    message?: string,
  ) {
    super(message ?? `${operation} failed (${status}${reason ? `; ${reason}` : ""})`);
    this.name = "PipedreamError";
  }
}

export class PipedreamRequestError extends PipedreamError {
  constructor(
    status: number,
    operation: PipedreamOperation = "Pipedream request",
    reason: PipedreamErrorReason | null = null,
    layer: PipedreamErrorLayer = operationLayer(operation),
  ) {
    super(status, operation, reason, layer);
    this.name = "PipedreamRequestError";
  }
}

function resourceAbsent(
  error: unknown,
  operation: PipedreamOperation,
  gone = false,
): error is PipedreamRequestError {
  return (
    error instanceof PipedreamRequestError &&
    error.operation === operation &&
    (operation.startsWith("Google Calendar")
      ? error.layer === "google" &&
        ((error.status === 404 && error.reason === "notFound") ||
          (gone && error.status === 410 && error.reason === "deleted"))
      : error.layer === "pipedream" &&
        (error.status === 404 || (gone && error.status === 410)) &&
        (error.reason === null || error.reason === "notFound" || error.reason === "deleted"))
  );
}

const RATE_LIMIT_REASONS = new Set<PipedreamErrorReason>([
  "userRateLimitExceeded",
  "rateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
  "RESOURCE_EXHAUSTED",
]);

export function classifyPipedreamFailure(
  error: unknown,
): "temporary" | "platform" | "reauthorization" | "permissions" | "configuration" {
  if (!(error instanceof PipedreamError)) return "temporary";
  if (
    RETRYABLE_STATUS.has(error.status) ||
    (error.reason !== null && RATE_LIMIT_REASONS.has(error.reason)) ||
    [
      "deadline_exceeded",
      "network_error",
      "invalid_response",
      "response_too_large",
      "internalError",
    ].includes(error.reason ?? "")
  )
    return "temporary";
  if (error.layer === "machine" || error.operation === "Pipedream authentication")
    return "platform";
  if (
    ["invalid_client", "invalid_scope", "accessNotConfigured", "SERVICE_DISABLED"].includes(
      error.reason ?? "",
    )
  )
    return "platform";
  if (error.layer === "pipedream") return "platform";
  if (error.reason === "invalid_configuration" || error.reason === "event_conflict")
    return "configuration";
  if (
    ["invalid_grant", "invalid_token", "authError", "UNAUTHENTICATED"].includes(error.reason ?? "")
  )
    return "temporary";
  if (error.layer === "google") {
    if (
      error.status === 403 &&
      ["forbidden", "PERMISSION_DENIED"].includes(error.reason ?? "") &&
      [
        "Google Calendar event creation via Pipedream",
        "Google Calendar write verification via Pipedream",
        "Google Calendar event deletion via Pipedream",
      ].includes(error.operation)
    )
      return "permissions";
    if (
      ["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions", "insufficient_scope"].includes(
        error.reason ?? "",
      )
    )
      return "permissions";
    if (
      [
        "Google Calendar availability via Pipedream",
        "Google Calendar access verification via Pipedream",
      ].includes(error.operation) &&
      error.reason === "notFound"
    )
      return "permissions";
    if ([400, 409, 412, 422].includes(error.status) || error.reason === "forbiddenForNonOrganizer")
      return "configuration";
  }
  // The proxy docs do not identify a managed Google grant failure boundary.
  // invalid_grant or an unknown 401/403 alone cannot establish reauthorization.
  return "temporary";
}

function remainingBudget(operation: PipedreamOperation): number {
  const context = requestDeadline.getStore();
  const worker = workerProviderContext();
  const remaining =
    Math.min(
      context?.deadlineAt ?? Date.now() + REQUEST_TIMEOUT_MS,
      worker?.deadlineAt ?? Infinity,
    ) - Date.now();
  if (remaining <= 0 || context?.signal.aborted || !workerCanContinue()) {
    // A caught timeout in this scope must not start another provider effect,
    // including nested pdFetch scopes that would otherwise mint a fresh budget.
    fenceSharedPipedreamDeadline();
    throw Object.assign(new PipedreamError(0, operation, "deadline_exceeded"), {
      dispatched: false,
    });
  }
  return remaining;
}

/** Stop dispatch/header acquisition at deadlineAt. Returned mutation bodies may
 * use the parent's/worker's total deadline (or an explicit settlementDeadlineAt).
 * This never grants another request; callers separately bound DB settlement.
 */
export async function withPipedreamDeadline<T>(
  deadlineAt: number,
  work: () => Promise<T>,
  options: { settlementDeadlineAt?: number } = {},
): Promise<T> {
  if (
    !Number.isFinite(deadlineAt) ||
    (options.settlementDeadlineAt !== undefined && !Number.isFinite(options.settlementDeadlineAt))
  )
    throw new PipedreamError(0, "Pipedream request", "invalid_configuration");
  const parent = requestDeadline.getStore();
  const worker = workerProviderContext();
  const signals = [parent?.signal, worker?.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  const parentSignal = signals.length ? AbortSignal.any(signals) : undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parentSignal?.aborted) abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  try {
    return await requestDeadline.run(
      {
        deadlineAt: Math.min(
          deadlineAt,
          options.settlementDeadlineAt ?? Infinity,
          parent?.deadlineAt ?? Infinity,
          worker?.deadlineAt ?? Infinity,
        ),
        settlementDeadlineAt: Math.min(
          options.settlementDeadlineAt ??
            parent?.settlementDeadlineAt ??
            worker?.settlementDeadlineAt ??
            deadlineAt,
          parent?.settlementDeadlineAt ?? Infinity,
          worker?.settlementDeadlineAt ?? Infinity,
        ),
        signal: controller.signal,
        controller,
        parent,
      },
      async () => {
        remainingBudget("Pipedream request");
        // Dispatch checks belong before requests, not after their outcome is known.
        return work();
      },
    );
  } finally {
    // A failed sibling must not leave another branch starting provider effects.
    controller.abort();
    parentSignal?.removeEventListener("abort", abort);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function providerErrorEvidence(body: unknown, status: number, operation: PipedreamOperation) {
  let layer = operationLayer(operation);
  const error = isRecord(body) ? body.error : null;
  const detail = isRecord(error) ? error : null;
  const errors = Array.isArray(detail?.errors) ? detail.errors.filter(isRecord) : [];
  const details = Array.isArray(detail?.details) ? detail.details.filter(isRecord) : [];
  let candidates = [
    isRecord(body) ? body.code : null,
    error,
    detail?.code,
    detail?.status,
    ...errors.map((entry) => entry.reason),
    ...details.map((entry) => entry.reason),
  ];
  const googleReasons = [
    ...errors.filter((entry) =>
      ["global", "calendar", "usageLimits"].includes(entry.domain as string),
    ),
    ...details.filter(
      (entry) =>
        entry["@type"] === "type.googleapis.com/google.rpc.ErrorInfo" &&
        entry.domain === "googleapis.com",
    ),
  ].map((entry) => entry.reason);
  if (layer === "proxy" && detail?.code === status && googleReasons.length) {
    layer = "google";
    candidates = [...googleReasons, detail.status];
  }
  return {
    reason:
      PROVIDER_ERROR_REASONS.find(
        (reason) => RATE_LIMIT_REASONS.has(reason) && candidates.includes(reason),
      ) ??
      PROVIDER_ERROR_REASONS.find((reason) => candidates.includes(reason)) ??
      null,
    layer,
  };
}

const SUCCESS_BODY_LIMITS: Partial<Record<PipedreamOperation, number>> = {
  "Pipedream authentication": 16_384,
  "Pipedream Connect link creation": 16_384,
  "Pipedream account discovery": 4_194_304,
  "Pipedream trigger discovery": 4_194_304,
  "Pipedream deployed trigger discovery": 4_194_304,
  "Google Calendar list via Pipedream": 4_194_304,
  "Google Calendar access verification via Pipedream": 16_384,
  "Google Calendar availability via Pipedream": 8_388_608,
};

async function fetchJsonOnce(
  url: string,
  init: RequestInit,
  operation: PipedreamOperation,
  dispatch?: { dispatched: boolean },
) {
  const requestLimit = Date.now() + REQUEST_TIMEOUT_MS;
  let deadlineAt = Math.min(requestLimit, Date.now() + remainingBudget(operation));
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  let finished = false;
  let timedOut = false;
  let rejectTimeout: (error: Error) => void = () => undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const abort = () => {
    timedOut = true;
    rejectTimeout(new PipedreamError(response?.status ?? 0, operation, "deadline_exceeded"));
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  };
  // Dispatch/settlement expiry fences this scope. Missing diagnostics on a known
  // rejection must not: they still leave the HTTP status as the outcome.
  const abortAndFence = () => {
    fenceSharedPipedreamDeadline();
    abort();
  };
  const scopeSignal = requestDeadline.getStore()?.signal;
  scopeSignal?.addEventListener("abort", abortAndFence, { once: true });
  let timer = setTimeout(abortAndFence, Math.max(1, deadlineAt - Date.now()));
  try {
    remainingBudget(operation);
    if (dispatch) dispatch.dispatched = true;
    response = await Promise.race([
      // redirect:"manual": Workers rejects "error" before any network I/O, and
      // nothing is ever followed — 3xx/opaqueredirect falls into non-ok handling below.
      fetch(url, { ...init, redirect: "manual", signal: controller.signal }),
      timeout,
    ]);
    const diagnosticDeadlineAt = deadlineAt;
    if (dispatch && !["GET", "HEAD"].includes(init.method ?? "GET")) {
      // A returned mutation response may be observed during settlement, but never
      // extends its per-request limit or authorizes another provider dispatch.
      deadlineAt = Math.min(
        requestLimit,
        requestDeadline.getStore()!.settlementDeadlineAt,
        workerProviderContext()?.settlementDeadlineAt ?? Infinity,
      );
      clearTimeout(timer);
      timer = setTimeout(abortAndFence, Math.max(1, deadlineAt - Date.now()));
    }
    const limit = response.ok ? (SUCCESS_BODY_LIMITS[operation] ?? 1_048_576) : 16_384;
    if (!response.ok) {
      clearTimeout(timer);
      timer = setTimeout(
        abort,
        Math.max(1, Math.min(2_000, diagnosticDeadlineAt - Date.now(), deadlineAt - Date.now())),
      );
    }
    if (Number(response.headers.get("content-length")) > limit)
      throw new PipedreamError(response.status, operation, "response_too_large");
    reader = response.body?.getReader();
    let bytes = 0;
    let text = "";
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const deadlineExceeded = () => {
      const context = requestDeadline.getStore();
      if (context && (response?.ok || Date.now() >= context.deadlineAt)) fenceSharedPipedreamDeadline();
      return new PipedreamError(response?.status ?? 0, operation, "deadline_exceeded");
    };
    while (reader) {
      // cancel() closes pending reads even if the underlying cancellation promise stalls.
      const { done, value } = await reader.read();
      if (timedOut || Date.now() >= deadlineAt) throw deadlineExceeded();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new PipedreamError(response.status, operation, "response_too_large");
      try {
        text += decoder.decode(value, { stream: true });
      } catch {
        throw new PipedreamError(response.status, operation, "invalid_response");
      }
    }
    finished = true;
    try {
      text += decoder.decode();
    } catch {
      throw new PipedreamError(response.status, operation, "invalid_response");
    }
    if (timedOut || Date.now() >= deadlineAt) throw deadlineExceeded();
    let body: unknown;
    try {
      body =
        !text && (response.status === 204 || init.method === "DELETE") ? null : JSON.parse(text);
    } catch {
      throw new PipedreamError(response.status, operation, "invalid_response");
    }
    if (timedOut || Date.now() >= deadlineAt) throw deadlineExceeded();
    return { response, body };
  } catch (error) {
    // Rejection headers are already evidence, even if optional diagnostics use
    // the last of the budget. Dispatch/retry guards remain separate from settlement.
    if (response && !response.ok) return { response, body: null };
    if (error instanceof PipedreamError) throw error;
    // An aborted fetch rejects with AbortError and no response, which would
    // otherwise be indistinguishable from a network-layer failure. Reason and
    // retry classification are unchanged; only the flag is added.
    const aborted =
      timedOut || controller.signal.aborted || (isRecord(error) && error.name === "AbortError");
    throw Object.assign(new PipedreamError(response?.status ?? 0, operation, "network_error"), {
      aborted,
    });
  } finally {
    clearTimeout(timer);
    scopeSignal?.removeEventListener("abort", abortAndFence);
    if (!finished) {
      controller.abort();
      if (reader) void reader.cancel().catch(() => undefined);
      else void response?.body?.cancel().catch(() => undefined);
    }
    reader?.releaseLock();
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  operation: PipedreamOperation,
  options: { attempts?: number; dispatch?: { dispatched: boolean } } = {},
) {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 3));
  for (let attempt = 0; attempt < attempts; attempt++) {
    remainingBudget(operation);
    let retryAfter = 0;
    let failure: PipedreamError;
    try {
      const { response, body } = await fetchJsonOnce(url, init, operation, options.dispatch);
      if (response.ok) return body;
      const { reason, layer } = providerErrorEvidence(body, response.status, operation);
      const ErrorType = layer === "machine" ? PipedreamError : PipedreamRequestError;
      failure = new ErrorType(response.status, operation, reason, layer);
      const guidance = response.headers.get("retry-after");
      if (guidance) {
        retryAfter = /^\d+(?:\.\d+)?$/.test(guidance)
          ? Number(guidance) * 1000
          : Math.max(0, Date.parse(guidance) - Date.now());
        if (!Number.isFinite(retryAfter)) retryAfter = 0;
      }
    } catch (error) {
      if (!(error instanceof PipedreamError) || error.reason !== "network_error") throw error;
      failure = error;
    }
    if (
      attempt === attempts - 1 ||
      !(
        RETRYABLE_STATUS.has(failure.status) ||
        failure.reason === "network_error" ||
        (failure.reason !== null && RATE_LIMIT_REASONS.has(failure.reason))
      )
    )
      throw failure;
    try {
      const delay = Math.max(retryAfter, 250 * 2 ** attempt * (0.5 + Math.random() * 0.5));
      if (delay >= remainingBudget(operation)) throw failure;
      const signal = requestDeadline.getStore()?.signal;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(failure);
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, delay);
        signal?.addEventListener("abort", abort, { once: true });
      });
      remainingBudget(operation);
    } catch {
      // No later attempt was sent: retain the last known outcome, not a fabricated timeout.
      throw failure;
    }
  }
  throw new PipedreamError(0, operation, "invalid_configuration");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new PipedreamError(
      0,
      "Pipedream request",
      "invalid_configuration",
      "pipedream",
      `Provider setup is unavailable: ${name} is not configured`,
    );
  return value;
}

export function pipedreamEnvironment(environment: BookingEnvironment): PdEnvironment {
  return environment === "live" ? "production" : "development";
}

export function pipedreamExternalUserId(
  profileId: string,
  environment: BookingEnvironment,
): string {
  return `obra:${environment}:${profileId}`;
}

function googleAppSlug(): string {
  const slug = required("PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!/^[a-z0-9][a-z0-9_]{1,99}$/.test(slug))
    throw new PipedreamError(
      0,
      "Pipedream request",
      "invalid_configuration",
      "pipedream",
      "PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG is invalid",
    );
  return slug;
}

function publicOrigin(): string {
  const configured = required("PUBLIC_APP_URL");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new PipedreamError(
      0,
      "Pipedream request",
      "invalid_configuration",
      "pipedream",
      "PUBLIC_APP_URL must be a valid origin",
    );
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"))
    throw new PipedreamError(
      0,
      "Pipedream request",
      "invalid_configuration",
      "pipedream",
      "PUBLIC_APP_URL must be HTTPS outside localhost",
    );
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new PipedreamError(
      0,
      "Pipedream request",
      "invalid_configuration",
      "pipedream",
      "PUBLIC_APP_URL must be an origin without credentials, path, query, or fragment",
    );
  return url.origin;
}

export function pipedreamTriggerWebhookUrl(input: {
  environment: BookingEnvironment;
  bindingId: string;
  accountId: string;
  correlationId: string;
  triggerId: string;
}) {
  const url = new URL("/api/pipedream/webhook", publicOrigin());
  url.searchParams.set("environment", input.environment);
  url.searchParams.set("binding_id", input.bindingId);
  url.searchParams.set("account_id", input.accountId);
  url.searchParams.set("correlation_id", input.correlationId);
  url.searchParams.set("trigger_id", input.triggerId);
  return url.toString();
}

async function accessToken(options: { attempts?: number } = {}): Promise<string> {
  remainingBudget("Pipedream authentication");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const body = await requestJson(
    "https://api.pipedream.com/v1/oauth/token",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: required("PIPEDREAM_CLIENT_ID"),
        client_secret: required("PIPEDREAM_CLIENT_SECRET"),
        // Verified against Pipedream: trigger discovery rejects connect:triggers:*
        // but accepts connect:*. Browser Connect tokens remain account-scoped.
        scope: "connect:*",
      }),
    },
    "Pipedream authentication",
    options,
  );
  if (
    !isRecord(body) ||
    typeof body.access_token !== "string" ||
    !/^[\x21-\x7e]+$/.test(body.access_token) ||
    typeof body.expires_in !== "number" ||
    !Number.isSafeInteger(body.expires_in) ||
    body.expires_in <= 0 ||
    !Number.isSafeInteger(Date.now() + body.expires_in * 1000)
  )
    throw new PipedreamError(0, "Pipedream authentication", "invalid_response");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function pdFetch(
  path: string,
  environment: BookingEnvironment,
  operation: PipedreamOperation,
  init?: RequestInit,
  options: { attempts?: number } = {},
) {
  // One budget includes client credentials, the one-time 401 refresh, retries,
  // backoff and full response bodies, even when the caller supplies no deadline.
  const dispatch = { dispatched: false };
  const deadlineAt = Date.now() + REQUEST_TIMEOUT_MS;
  try {
    return await withPipedreamDeadline(
      deadlineAt,
      async () => {
        let token = await accessToken({ attempts: options.attempts });
        const execute = () =>
          requestJson(
            `https://api.pipedream.com${path}`,
            {
              ...init,
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "x-pd-environment": pipedreamEnvironment(environment),
                ...init?.headers,
              },
            },
            operation,
            { ...options, dispatch },
          );
        try {
          return await execute();
        } catch (error) {
          if (
            !(error instanceof PipedreamRequestError) ||
            error.status !== 401 ||
            error.layer === "google"
          )
            throw error;
          try {
            remainingBudget(operation);
          } catch {
            throw error;
          }
          // A concurrent request may already have refreshed this machine token.
          const previousToken = cachedToken;
          if (cachedToken?.value === token) cachedToken = null;
          try {
            token = await accessToken({ attempts: options.attempts });
            remainingBudget(operation);
          } catch {
            // Failed refresh must not drop a token the next scope still needs.
            if (!cachedToken) cachedToken = previousToken;
            // No resource retry was sent: its known 401 remains the outcome evidence.
            throw error;
          }
          return execute();
        }
      },
      { settlementDeadlineAt: deadlineAt },
    );
  } catch (error) {
    if (error instanceof PipedreamError) {
      error.dispatched = dispatch.dispatched;
      error.requestOperation = operation;
    }
    throw error;
  }
}

export async function createGoogleConnectLink(input: {
  profileId: string;
  environment: BookingEnvironment;
  websiteId: string;
  /**
   * Same-origin return path for re-hosted flows (e.g. the purchaser overview
   * cards). Omitted callers land on /user with connect markers.
   */
  returnPath?: string;
}) {
  const { purchaserWorkspacePath, withConnectMarker } =
    await import("@/lib/auth/contractor-return-path");
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const appSlug = googleAppSlug();
  if (input.returnPath && !input.returnPath.startsWith("/")) {
    throw new Error("Connect return path must be same-origin");
  }
  const origin = publicOrigin();
  const basePath = input.returnPath ?? purchaserWorkspacePath(input.profileId, input.websiteId);
  const successUrl = `${origin}${withConnectMarker(basePath, "success")}`;
  const errorUrl = `${origin}${withConnectMarker(basePath, "error")}`;
  const body = (await pdFetch(
    `/v1/connect/${encodeURIComponent(projectId)}/tokens`,
    input.environment,
    "Pipedream Connect link creation",
    {
      method: "POST",
      body: JSON.stringify({
        external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
        allowed_origins: [origin],
        success_redirect_uri: successUrl,
        error_redirect_uri: errorUrl,
        expires_in: 900,
        scope: "connect:accounts:read connect:accounts:write",
        allow_progressive_scopes: false,
      }),
    },
    { attempts: 1 },
  )) as { connect_link_url?: unknown; expires_at?: unknown };
  if (!body || typeof body.connect_link_url !== "string")
    throw new Error("Pipedream returned no Connect URL");
  let url: URL;
  try {
    url = new URL(body.connect_link_url);
  } catch {
    throw new PipedreamError(0, "Pipedream Connect link creation", "invalid_response");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.hostname !== "pipedream.com" && !url.hostname.endsWith(".pipedream.com"))
  )
    throw new Error("Pipedream returned an unsafe Connect URL");
  url.searchParams.set("app", appSlug);
  return {
    url: url.toString(),
    expiresAt: typeof body.expires_at === "string" ? body.expires_at : null,
  };
}

export async function listGoogleAccounts(profileId: string, environment: BookingEnvironment) {
  return withPipedreamDeadline(Date.now() + REQUEST_TIMEOUT_MS, async () => {
    const projectId = required("PIPEDREAM_PROJECT_ID");
    const appSlug = googleAppSlug();
    const query = new URLSearchParams({
      external_user_id: pipedreamExternalUserId(profileId, environment),
      app: appSlug,
      include_credentials: "false",
      limit: "100",
    });
    const result: PipedreamAccount[] = [];
    const ids = new Set<string>();
    const cursors = new Set<string>();
    let total: number | undefined;
    const invalid = new PipedreamError(0, "Pipedream account discovery", "invalid_response");
    // https://pipedream.com/docs/connect/api-reference/list-accounts
    for (let page = 0; page < 100; page++) {
      const body = await pdFetch(
        `/v1/connect/${encodeURIComponent(projectId)}/accounts?${query}`,
        environment,
        "Pipedream account discovery",
      );
      if (
        !isRecord(body) ||
        !Array.isArray(body.data) ||
        body.data.length > 100 ||
        !isRecord(body.page_info)
      )
        throw invalid;
      const info = body.page_info;
      if (info.count !== undefined && info.count !== body.data.length) throw invalid;
      if (
        info.start_cursor != null &&
        (typeof info.start_cursor !== "string" || info.start_cursor.length > 4096)
      )
        throw invalid;
      if (info.total_count !== undefined) {
        if (
          typeof info.total_count !== "number" ||
          !Number.isSafeInteger(info.total_count) ||
          info.total_count < 0 ||
          info.total_count > 10_000 ||
          (total !== undefined && total !== info.total_count)
        )
          throw invalid;
        total = info.total_count;
      }
      for (const account of body.data) {
        if (
          !isRecord(account) ||
          typeof account.id !== "string" ||
          !/^apn_[A-Za-z0-9_-]+$/.test(account.id) ||
          ids.has(account.id) ||
          !isRecord(account.app) ||
          !(account.app.name_slug === appSlug) ||
          (account.app.name !== undefined && typeof account.app.name !== "string") ||
          (account.name != null && typeof account.name !== "string") ||
          (account.external_id !== undefined && typeof account.external_id !== "string") ||
          (account.healthy !== undefined && typeof account.healthy !== "boolean") ||
          (account.dead != null && typeof account.dead !== "boolean") ||
          (account.error != null && typeof account.error !== "string") ||
          (account.created_at != null &&
            (typeof account.created_at !== "string" ||
              !Number.isFinite(Date.parse(account.created_at)))) ||
          (account.authorized_scopes !== undefined &&
            (!Array.isArray(account.authorized_scopes) ||
              account.authorized_scopes.some(
                (scope) => typeof scope !== "string" || !scope.trim(),
              )))
        )
          throw invalid;
        ids.add(account.id);
        // Never forward an unexpected credentials field or raw provider error prose.
        result.push({
          id: account.id,
          name: account.name as string | null | undefined,
          external_id: account.external_id as string | undefined,
          healthy: account.healthy as boolean | undefined,
          dead: account.dead as boolean | null | undefined,
          app: { name_slug: appSlug, name: account.app.name as string | undefined },
          authorized_scopes: account.authorized_scopes as string[] | undefined,
          error: account.error ? "provider_account_unhealthy" : null,
          created_at: account.created_at as string | null | undefined,
        });
      }
      if (total !== undefined && result.length > total) throw invalid;
      const next = info.end_cursor;
      if (next === null || next === undefined || next === "") {
        if (total !== undefined && result.length !== total) throw invalid;
        return result;
      }
      if (typeof next !== "string" || next.length > 4096 || cursors.has(next)) throw invalid;
      cursors.add(next);
      query.set("after", next);
    }
    throw invalid;
  });
}

export async function deletePipedreamAccount(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
}) {
  if (!input.accountId) throw new Error("Pipedream account identity is required");
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const query = new URLSearchParams({
    external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
  });
  const path =
    "/v1/connect/" +
    encodeURIComponent(projectId) +
    "/accounts/" +
    encodeURIComponent(input.accountId) +
    "?" +
    query;
  try {
    await pdFetch(
      path,
      input.environment,
      "Pipedream account deletion",
      { method: "DELETE" },
      { attempts: 1 },
    );
  } catch (error) {
    if (resourceAbsent(error, "Pipedream account deletion")) return;
    throw error;
  }
}

function encodeProxyTarget(target: URL): string {
  if (
    target.protocol !== "https:" ||
    target.hostname !== "www.googleapis.com" ||
    target.username ||
    target.password ||
    target.port ||
    target.hash
  )
    throw new PipedreamError(
      0,
      "Google Calendar proxy",
      "invalid_configuration",
      "proxy",
      "Unsupported Google Calendar proxy target",
    );
  return encodeURIComponent(Buffer.from(target.toString()).toString("base64"));
}

export async function proxyGoogleCalendar(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
  target: URL;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  attempts?: number;
  operation?: PipedreamOperation;
  /** Forwarded by the documented x-pd-proxy-* header contract for conditional cleanup. */
  ifMatch?: string;
}) {
  if (!/^apn_[A-Za-z0-9_-]+$/.test(input.accountId))
    throw new PipedreamError(
      0,
      "Google Calendar proxy",
      "invalid_configuration",
      "proxy",
      "Invalid Pipedream account identity",
    );
  if ((input.method === "DELETE" || input.ifMatch !== undefined) && !googleEventEtag(input.ifMatch))
    throw new PipedreamRequestError(
      400,
      input.operation ?? "Google Calendar proxy",
      "invalid_configuration",
    );
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const query = new URLSearchParams({
    external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
    account_id: input.accountId,
  });
  return pdFetch(
    `/v1/connect/${encodeURIComponent(projectId)}/proxy/${encodeProxyTarget(input.target)}?${query}`,
    input.environment,
    input.operation ?? "Google Calendar proxy",
    {
      method: input.method ?? "GET",
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      ...(input.ifMatch ? { headers: { "x-pd-proxy-if-match": input.ifMatch } } : {}),
    },
    { attempts: input.attempts },
  );
}

function googleEventEtag(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1024 && /^"[\x21\x23-\x7e]+"$/.test(value);
}

/** Exact private-event read access, using the already-required calendar.events scope. */
export async function verifyGoogleCalendarEventAccess(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
  calendarId: string;
}): Promise<void> {
  const operation = "Google Calendar access verification via Pipedream";
  if (!input.calendarId.trim())
    throw new PipedreamRequestError(400, operation, "invalid_configuration");
  // Calendars.get needs extra scopes in the narrow booking grant. Events.list
  // exposes the current role without fetching customer contents or assuming list membership.
  // https://developers.google.com/workspace/calendar/api/v3/reference/events/list
  const target = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
  );
  target.searchParams.set("maxResults", "1");
  target.searchParams.set("fields", "kind,accessRole");
  const body = await proxyGoogleCalendar({
    profileId: input.profileId,
    environment: input.environment,
    accountId: input.accountId,
    method: "GET",
    target,
    operation,
  });
  if (
    !isRecord(body) ||
    body.kind !== "calendar#events" ||
    !["none", "freeBusyReader", "reader", "writerWithoutPrivateAccess", "writer", "owner"].includes(
      body.accessRole as string,
    )
  )
    throw new PipedreamError(0, operation, "invalid_response");
  if (body.accessRole !== "writer" && body.accessRole !== "owner")
    throw new PipedreamRequestError(403, operation, "insufficientPermissions", "google");
}

async function googleEventAbsent(
  error: unknown,
  operation: PipedreamOperation,
  input: Parameters<typeof verifyGoogleCalendarEventAccess>[0],
) {
  if (!resourceAbsent(error, operation, true)) return false;
  // Google uses the same notFound for a missing event and an inaccessible calendar.
  if (error.status === 404) await verifyGoogleCalendarEventAccess(input);
  return true;
}

export type GoogleCalendarDescriptor = {
  id: string;
  summary: string;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  timeZone: string | null;
  primary?: boolean;
};

export async function listGoogleCalendars(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
}): Promise<GoogleCalendarDescriptor[]> {
  return withPipedreamDeadline(Date.now() + REQUEST_TIMEOUT_MS, async () => {
    const target = new URL("https://www.googleapis.com/calendar/v3/users/me/calendarList");
    target.searchParams.set("minAccessRole", "freeBusyReader");
    target.searchParams.set("showDeleted", "false");
    target.searchParams.set("showHidden", "true");
    target.searchParams.set("maxResults", "250");
    const result: GoogleCalendarDescriptor[] = [];
    const ids = new Set<string>();
    const cursors = new Set<string>();
    const invalid = new PipedreamError(0, "Google Calendar list via Pipedream", "invalid_response");
    // https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list
    for (let page = 0; page < 100; page++) {
      const body = await proxyGoogleCalendar({
        ...input,
        target,
        operation: "Google Calendar list via Pipedream",
      });
      if (
        !isRecord(body) ||
        !Array.isArray(body.items) ||
        body.items.length > 250 ||
        (body.kind !== undefined && body.kind !== "calendar#calendarList")
      )
        throw invalid;
      for (const item of body.items) {
        if (
          !isRecord(item) ||
          typeof item.id !== "string" ||
          !item.id.trim() ||
          ids.has(item.id) ||
          typeof item.summary !== "string" ||
          !["freeBusyReader", "reader", "writerWithoutPrivateAccess", "writer", "owner"].includes(
            item.accessRole as string,
          ) ||
          (item.timeZone != null && typeof item.timeZone !== "string") ||
          (item.primary !== undefined && typeof item.primary !== "boolean") ||
          (item.deleted !== undefined && item.deleted !== false)
        )
          throw invalid;
        ids.add(item.id);
        result.push({
          id: item.id,
          summary: item.summary,
          // Restricted writers can block availability but cannot satisfy our
          // private-event write contract. Keep the supported read capability.
          accessRole:
            item.accessRole === "writerWithoutPrivateAccess"
              ? "reader"
              : (item.accessRole as GoogleCalendarDescriptor["accessRole"]),
          timeZone: typeof item.timeZone === "string" ? item.timeZone : null,
          primary: item.primary === true,
        });
      }
      const next = body.nextPageToken;
      if (
        body.nextSyncToken !== undefined &&
        (typeof body.nextSyncToken !== "string" || !body.nextSyncToken || next !== undefined)
      )
        throw invalid;
      if (next === undefined) return result;
      if (typeof next !== "string" || !next || next.length > 4096 || cursors.has(next))
        throw invalid;
      cursors.add(next);
      target.searchParams.set("pageToken", next);
    }
    throw invalid;
  });
}

export function hasGoogleCalendarWriteScope(scopes: string[] | undefined): boolean {
  return (
    Array.isArray(scopes) &&
    scopes.some(
      (scope) =>
        scope === "https://www.googleapis.com/auth/calendar" ||
        scope === "https://www.googleapis.com/auth/calendar.events",
    )
  );
}

export function hasGoogleCalendarBookingScopes(scopes: string[] | undefined): boolean {
  if (!hasGoogleCalendarWriteScope(scopes)) return false;
  if (!Array.isArray(scopes)) return false;
  const granted = new Set(scopes);
  const prefix = "https://www.googleapis.com/auth/calendar";
  if (granted.has(prefix)) return true;
  if (!granted.has(`${prefix}.events`)) return false;
  if (granted.has(`${prefix}.readonly`)) return true;
  // Event-write access alone does not authorize CalendarList or FreeBusy.
  return (
    (granted.has(`${prefix}.calendarlist`) || granted.has(`${prefix}.calendarlist.readonly`)) &&
    (granted.has(`${prefix}.freebusy`) || granted.has(`${prefix}.events.freebusy`))
  );
}

function ambiguousGoogleWrite(error: unknown) {
  return (
    error instanceof PipedreamError &&
    error.dispatched !== false &&
    error.layer !== "machine" &&
    (RETRYABLE_STATUS.has(error.status) ||
      error.status === 409 ||
      ["network_error", "deadline_exceeded", "invalid_response", "response_too_large"].includes(
        error.reason ?? "",
      ))
  );
}

function googleInstant(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(
      value,
    )
  )
    return NaN;
  const date = value.slice(0, 10);
  const midnight = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(midnight) && new Date(midnight).toISOString().startsWith(date)
    ? Date.parse(value)
    : NaN;
}

/** Setup/recovery only. Persist both optional identities to resume the same probe. */
export async function verifyGoogleCalendarWrite(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
  calendarId: string;
  eventId?: string;
  operationId?: string;
}) {
  return withPipedreamDeadline(Date.now() + REQUEST_TIMEOUT_MS, async () => {
    const operation = "Google Calendar write verification via Pipedream";
    const stable = input.eventId !== undefined || input.operationId !== undefined;
    if (
      !input.calendarId ||
      (stable &&
        (typeof input.eventId !== "string" ||
          !/^[0-9a-v]{5,1024}$/.test(input.eventId) ||
          typeof input.operationId !== "string" ||
          !input.operationId.trim() ||
          input.operationId.length > 1024))
    )
      throw new PipedreamRequestError(400, operation, "invalid_configuration");
    const target = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
    );
    target.searchParams.set("sendUpdates", "none");
    // Fixed past instants keep retries byte-stable and avoid future reminders.
    const start = stable ? Date.parse("2000-01-01T00:00:00Z") : Date.now();
    const event = {
      ...(stable ? { id: input.eventId } : {}),
      summary: "Obra permission verification",
      description: "Temporary event created and removed automatically.",
      visibility: "private",
      transparency: "transparent",
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(start + 60_000).toISOString() },
      reminders: { useDefault: false },
      extendedProperties: {
        private: {
          obraVerification: "true",
          ...(stable ? { obraVerificationOperationId: input.operationId } : {}),
        },
      },
    };
    let eventId = input.eventId;
    const lookup = () =>
      new URL(`${target.origin}${target.pathname}/${encodeURIComponent(eventId!)}`);
    const read = () => proxyGoogleCalendar({ ...input, target: lookup(), operation, attempts: 1 });
    const absent = (error: unknown) => googleEventAbsent(error, operation, input);
    let created: unknown;
    if (stable) {
      try {
        created = await read();
      } catch (error) {
        // A gone stable ID cannot be inserted again. Cleanup has already won;
        // a fresh capability question needs a new persisted operation identity.
        if (!(await absent(error))) throw error;
        if (error instanceof PipedreamRequestError && error.status === 410)
          throw new PipedreamRequestError(409, operation, "event_conflict");
      }
    }
    if (created === undefined) {
      try {
        created = await proxyGoogleCalendar({
          ...input,
          target,
          method: "POST",
          attempts: 1,
          operation,
          body: event,
        });
        if (!isRecord(created) || typeof created.id !== "string" || !created.id)
          throw Object.assign(new PipedreamError(200, operation, "invalid_response"), {
            dispatched: true,
          });
      } catch (error) {
        if (!stable || !ambiguousGoogleWrite(error)) throw error;
        try {
          created = await read();
        } catch {
          throw error;
        }
      }
    }
    if (!isRecord(created) || typeof created.id !== "string" || !created.id)
      throw new PipedreamError(0, operation, "invalid_response");
    const privateProps =
      isRecord(created.extendedProperties) && isRecord(created.extendedProperties.private)
        ? created.extendedProperties.private
        : null;
    if (
      !isGoogleCalendarOneOffEvent(created) ||
      (stable &&
        (created.id !== eventId ||
          privateProps?.obraVerificationOperationId !== input.operationId)) ||
      privateProps?.obraVerification !== "true" ||
      created.summary !== event.summary ||
      created.description !== event.description ||
      created.status === "cancelled" ||
      (created.status !== undefined &&
        !["confirmed", "tentative"].includes(created.status as string)) ||
      created.visibility !== "private" ||
      created.transparency !== "transparent" ||
      !isRecord(created.reminders) ||
      created.reminders.useDefault !== false ||
      (created.reminders.overrides !== undefined &&
        (!Array.isArray(created.reminders.overrides) ||
          created.reminders.overrides.length !== 0)) ||
      (created.attendees !== undefined &&
        (!Array.isArray(created.attendees) || created.attendees.length !== 0)) ||
      created.attendeesOmitted === true ||
      !isRecord(created.start) ||
      created.start.date !== undefined ||
      googleInstant(created.start.dateTime) !== start ||
      !isRecord(created.end) ||
      created.end.date !== undefined ||
      googleInstant(created.end.dateTime) !== start + 60_000
    )
      throw new PipedreamRequestError(409, operation, "event_conflict");
    if (!googleEventEtag(created.etag)) throw new PipedreamError(0, operation, "invalid_response");
    eventId = created.id;
    const cleanup = lookup();
    cleanup.searchParams.set("sendUpdates", "none");
    try {
      await proxyGoogleCalendar({
        ...input,
        target: cleanup,
        method: "DELETE",
        attempts: 1,
        operation,
        ifMatch: created.etag,
      });
    } catch (error) {
      if (await absent(error)) return;
      if (!ambiguousGoogleWrite(error)) throw error;
      let observed: unknown;
      try {
        observed = await read();
      } catch (lookupError) {
        if (await absent(lookupError)) return;
        throw error;
      }
      // A lost DELETE is complete only after exact absence/tombstone evidence.
      if (
        isRecord(observed) &&
        isGoogleCalendarOneOffEvent(observed) &&
        observed.id === eventId &&
        observed.status === "cancelled"
      )
        return;
      throw error;
    }
  });
}

export async function verifyGoogleCalendarFreeBusy(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
  calendarIds: string[];
}) {
  const now = Date.now();
  await getGoogleCalendarBusyRanges({
    ...input,
    timeMin: new Date(now).toISOString(),
    timeMax: new Date(now + 60_000).toISOString(),
  });
}

export async function listGoogleCalendarTriggers(environment: BookingEnvironment) {
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const query = new URLSearchParams({ app: googleAppSlug(), registry: "public", limit: "100" });
  const body = (await pdFetch(
    "/v1/connect/" + encodeURIComponent(projectId) + "/triggers?" + query,
    environment,
    "Pipedream trigger discovery",
  )) as { data?: unknown };
  if (!body || !Array.isArray(body.data))
    throw new Error("Pipedream returned an invalid trigger list");
  return body.data.map(parsePipedreamTriggerDefinition);
}

export type GoogleBusyRange = { start: string; end: string };

export async function getGoogleCalendarBusyRanges(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
  calendarIds: string[];
  timeMin: string;
  timeMax: string;
  beforeChunk?: () => Promise<void>;
}): Promise<GoogleBusyRange[]> {
  return withPipedreamDeadline(Date.now() + REQUEST_TIMEOUT_MS, async () => {
    const operation = "Google Calendar availability via Pipedream";
    const timeMin = googleInstant(input.timeMin);
    const timeMax = googleInstant(input.timeMax);
    if (
      !Number.isFinite(timeMin) ||
      !Number.isFinite(timeMax) ||
      timeMin >= timeMax ||
      input.calendarIds.some((id) => typeof id !== "string" || !id.trim())
    )
      throw new PipedreamRequestError(400, operation, "invalid_configuration");
    const invalid = new PipedreamError(0, operation, "invalid_response");
    const ranges: GoogleBusyRange[] = [];
    for (let offset = 0; offset < input.calendarIds.length; offset += 50) {
      remainingBudget("Google Calendar availability via Pipedream");
      await input.beforeChunk?.();
      const calendarIds = input.calendarIds.slice(offset, offset + 50);
      const body = await proxyGoogleCalendar({
        profileId: input.profileId,
        environment: input.environment,
        accountId: input.accountId,
        target: new URL("https://www.googleapis.com/calendar/v3/freeBusy"),
        method: "POST",
        operation,
        body: {
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          items: calendarIds.map((id) => ({ id })),
        },
      });
      if (!isRecord(body) || !isRecord(body.calendars)) throw invalid;
      const calendars = body.calendars;
      for (const id of calendarIds) {
        const entry = calendars[id];
        if (!isRecord(entry)) throw invalid;
        if (entry.errors !== undefined) {
          if (!Array.isArray(entry.errors)) throw invalid;
          if (entry.errors.length) {
            if (body.kind !== "calendar#freeBusy" || entry.errors.some((error) => !isRecord(error)))
              throw invalid;
            const { reason, layer } = providerErrorEvidence(
              { error: { code: 400, errors: entry.errors } },
              400,
              operation,
            );
            if (layer !== "google" || reason === null) throw invalid;
            // Per-calendar FreeBusy errors are HTTP 200, not successful permission evidence.
            throw new PipedreamRequestError(400, operation, reason, layer);
          }
        }
        const busy = entry.busy;
        if (!Array.isArray(busy)) throw invalid;
        for (const value of busy) {
          if (!isRecord(value)) throw invalid;
          const { start, end } = value as { start?: unknown; end?: unknown };
          const startMs = googleInstant(start);
          const endMs = googleInstant(end);
          if (
            typeof start !== "string" ||
            typeof end !== "string" ||
            !Number.isFinite(startMs) ||
            !Number.isFinite(endMs) ||
            startMs >= endMs ||
            startMs < timeMin ||
            endMs > timeMax
          )
            throw invalid;
          ranges.push({
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
          });
        }
      }
    }
    return ranges;
  });
}

type GoogleBookingEventExpectation = {
  eventId: string;
  appointmentId: string;
  // Supply desired content for presence checks; omit it for deletion convergence.
  startAt?: string;
  endAt?: string;
  attendeeEmail?: string;
};

/** Booking and private probes are single timed events, never series or their instances. */
export function isGoogleCalendarOneOffEvent(event: Record<string, unknown>) {
  return (
    (event.recurrence === undefined ||
      (Array.isArray(event.recurrence) && event.recurrence.length === 0)) &&
    event.recurringEventId === undefined &&
    event.originalStartTime === undefined &&
    (event.endTimeUnspecified === undefined || event.endTimeUnspecified === false) &&
    (event.eventType === undefined || event.eventType === "default")
  );
}

function googleBookingEventState(body: unknown, input: GoogleBookingEventExpectation) {
  if (!isRecord(body) || typeof body.id !== "string" || !body.id)
    throw new PipedreamError(0, "Google Calendar event lookup via Pipedream", "invalid_response");
  if (body.id !== input.eventId || !isGoogleCalendarOneOffEvent(body)) return "conflict" as const;
  const marker =
    isRecord(body.extendedProperties) && isRecord(body.extendedProperties.private)
      ? body.extendedProperties.private.obraAppointmentId
      : undefined;
  // Google GET can return a deleted-event tombstone containing only id/status.
  // With a desired-content expectation, a cancellation needs repair, not INSERT.
  if (body.status === "cancelled" && (marker === undefined || marker === input.appointmentId)) {
    return input.startAt === undefined &&
      input.endAt === undefined &&
      input.attendeeEmail === undefined
      ? ("absent" as const)
      : ("conflict" as const);
  }
  if (
    marker !== input.appointmentId ||
    (body.status !== undefined && !["confirmed", "tentative"].includes(body.status as string))
  )
    return "conflict" as const;
  const start =
    isRecord(body.start) && body.start.date === undefined
      ? googleInstant(body.start.dateTime)
      : NaN;
  const end =
    isRecord(body.end) && body.end.date === undefined ? googleInstant(body.end.dateTime) : NaN;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    (input.startAt !== undefined && start !== googleInstant(input.startAt)) ||
    (input.endAt !== undefined && end !== googleInstant(input.endAt)) ||
    (input.attendeeEmail !== undefined &&
      (!input.attendeeEmail.trim() ||
        body.attendeesOmitted === true ||
        !Array.isArray(body.attendees) ||
        !body.attendees.some(
          (attendee) =>
            isRecord(attendee) &&
            typeof attendee.email === "string" &&
            attendee.email.trim().toLowerCase() === input.attendeeEmail!.trim().toLowerCase(),
        )))
  )
    return "conflict" as const;
  return "present" as const;
}

export async function getGoogleBookingEvent(
  input: {
    profileId: string;
    environment: BookingEnvironment;
    accountId: string;
    calendarId: string;
  } & GoogleBookingEventExpectation,
): Promise<{ state: "present" | "absent" | "conflict"; etag?: string }> {
  return withPipedreamDeadline(Date.now() + REQUEST_TIMEOUT_MS, async () => {
    if (!input.calendarId || !input.eventId || !input.appointmentId)
      throw new PipedreamRequestError(
        400,
        "Google Calendar event lookup via Pipedream",
        "invalid_configuration",
      );
    const target = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/" +
        encodeURIComponent(input.calendarId) +
        "/events/" +
        encodeURIComponent(input.eventId),
    );
    try {
      const body = await proxyGoogleCalendar({
        ...input,
        target,
        method: "GET",
        operation: "Google Calendar event lookup via Pipedream",
      });
      const state = googleBookingEventState(body, input);
      return {
        state,
        ...(state === "present" && isRecord(body) && googleEventEtag(body.etag)
          ? { etag: body.etag }
          : {}),
      };
    } catch (error) {
      if (
        error instanceof PipedreamRequestError &&
        (await googleEventAbsent(error, "Google Calendar event lookup via Pipedream", input))
      )
        return {
          state:
            error.status === 410 &&
            (input.startAt !== undefined ||
              input.endAt !== undefined ||
              input.attendeeEmail !== undefined)
              ? ("conflict" as const)
              : ("absent" as const),
        };
      throw error;
    }
  });
}

export async function createGoogleBookingEvent(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
  calendarId: string;
  eventId: string;
  summary: string;
  description: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  attendeeEmail: string;
  appointmentId: string;
}) {
  return withPipedreamDeadline(Date.now() + REQUEST_TIMEOUT_MS, async () => {
    const operation = "Google Calendar event creation via Pipedream";
    if (
      !input.calendarId ||
      !input.eventId ||
      !input.appointmentId ||
      !input.attendeeEmail.trim() ||
      !Number.isFinite(googleInstant(input.startAt)) ||
      !Number.isFinite(googleInstant(input.endAt)) ||
      googleInstant(input.startAt) >= googleInstant(input.endAt)
    )
      throw new PipedreamRequestError(400, operation, "invalid_configuration");
    const target = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
    );
    target.searchParams.set("sendUpdates", "all");
    let body: unknown;
    try {
      body = await proxyGoogleCalendar({
        ...input,
        target,
        method: "POST",
        attempts: 1,
        operation,
        body: {
          id: input.eventId,
          summary: input.summary,
          description: input.description,
          start: { dateTime: input.startAt, timeZone: input.timeZone },
          end: { dateTime: input.endAt, timeZone: input.timeZone },
          attendees: [{ email: input.attendeeEmail }],
          extendedProperties: { private: { obraAppointmentId: input.appointmentId } },
        },
      });
      if (!isRecord(body) || typeof body.id !== "string" || !body.id)
        throw Object.assign(new PipedreamError(200, operation, "invalid_response"), {
          dispatched: true,
        });
    } catch (error) {
      if (!ambiguousGoogleWrite(error)) throw error;
      const lookup = new URL(
        `${target.origin}${target.pathname}/${encodeURIComponent(input.eventId)}`,
      );
      try {
        body = await proxyGoogleCalendar({
          ...input,
          target: lookup,
          method: "GET",
          operation: "Google Calendar event lookup via Pipedream",
        });
      } catch {
        throw error;
      }
    }
    if (googleBookingEventState(body, input) !== "present")
      throw Object.assign(new PipedreamRequestError(409, operation, "event_conflict"), {
        dispatched: true,
      });
    const event = body as Record<string, unknown>;
    return {
      id: input.eventId,
      iCalUID: typeof event.iCalUID === "string" ? event.iCalUID : undefined,
      etag: googleEventEtag(event.etag) ? event.etag : undefined,
    };
  });
}

export async function deleteGoogleBookingEvent(input: {
  profileId: string;
  environment: BookingEnvironment;
  accountId: string;
  calendarId: string;
  eventId: string;
  /** Required at dispatch: the usable ETag from the matching present event read. */
  ifMatch?: string;
}) {
  return withPipedreamDeadline(Date.now() + REQUEST_TIMEOUT_MS, async () => {
    if (!input.calendarId || !input.eventId || !googleEventEtag(input.ifMatch))
      throw new PipedreamRequestError(
        400,
        "Google Calendar event deletion via Pipedream",
        "invalid_configuration",
      );
    const target = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
    );
    target.searchParams.set("sendUpdates", "all");
    try {
      await proxyGoogleCalendar({
        ...input,
        target,
        method: "DELETE",
        attempts: 1,
        ifMatch: input.ifMatch,
        operation: "Google Calendar event deletion via Pipedream",
      });
    } catch (error) {
      if (await googleEventAbsent(error, "Google Calendar event deletion via Pipedream", input))
        return;
      throw error;
    }
  });
}

export async function retrievePipedreamTrigger(input: {
  environment: BookingEnvironment;
  key: string;
  version: string;
}) {
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const path =
    "/v1/connect/" +
    encodeURIComponent(projectId) +
    "/triggers/" +
    encodeURIComponent(input.key) +
    "?version=" +
    encodeURIComponent(input.version);
  const body = (await pdFetch(path, input.environment, "Pipedream trigger definition lookup")) as {
    data?: unknown;
  };
  const definition = parsePipedreamTriggerDefinition(body?.data);
  if (definition.key !== input.key || definition.version !== input.version)
    throw new PipedreamError(0, "Pipedream trigger definition lookup", "invalid_response");
  return definition;
}

export async function listDeployedPipedreamTriggers(input: {
  profileId: string;
  environment: BookingEnvironment;
}) {
  return withPipedreamDeadline(Date.now() + REQUEST_TIMEOUT_MS, async () => {
    const projectId = required("PIPEDREAM_PROJECT_ID");
    const result: ReturnType<typeof parsePipedreamDeployedTrigger>[] = [];
    const cursors = new Set<string>();
    let after: string | null = null;
    for (let page = 0; page < 100; page++) {
      const query = new URLSearchParams({
        external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
        limit: "100",
      });
      if (after) query.set("after", after);
      const body = (await pdFetch(
        "/v1/connect/" + encodeURIComponent(projectId) + "/deployed-triggers?" + query,
        input.environment,
        "Pipedream deployed trigger discovery",
      )) as {
        data?: unknown;
        page_info?: { end_cursor?: unknown };
      };
      if (
        !body ||
        !Array.isArray(body.data) ||
        !body.page_info ||
        typeof body.page_info !== "object" ||
        Array.isArray(body.page_info)
      )
        throw new Error("Pipedream returned an invalid deployed-trigger list");
      result.push(
        ...body.data
          .filter((row): row is Record<string, unknown> =>
            Boolean(
              row &&
              typeof row === "object" &&
              (row as Record<string, unknown>).type === "DeployedComponent",
            ),
          )
          .map(parsePipedreamDeployedTrigger),
      );
      // Pipedream omits cursors for empty/terminal pages; its SDK also treats
      // an empty cursor as terminal. The response envelope is still required.
      const next = body.page_info.end_cursor;
      if (next === null || next === undefined || next === "") return result;
      if (typeof next !== "string" || next.length > 4096 || cursors.has(next))
        throw new Error("Pipedream returned invalid deployed-trigger pagination");
      cursors.add(next);
      after = next;
    }
    throw new Error("Pipedream deployed-trigger pagination exceeded the safety limit");
  });
}

export async function deployPipedreamTrigger(input: {
  profileId: string;
  environment: BookingEnvironment;
  key: string;
  version: string;
  configuredProps: Record<string, unknown>;
}) {
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const body = (await pdFetch(
    "/v1/connect/" + encodeURIComponent(projectId) + "/triggers/deploy",
    input.environment,
    "Pipedream trigger deployment",
    {
      method: "POST",
      body: JSON.stringify({
        id: input.key,
        version: input.version,
        external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
        configured_props: input.configuredProps,
        emit_on_deploy: false,
      }),
    },
    { attempts: 1 },
  )) as { data?: unknown };
  try {
    return parsePipedreamDeployedTrigger(body?.data);
  } catch {
    throw Object.assign(
      new PipedreamError(200, "Pipedream trigger deployment", "invalid_response"),
      { dispatched: true, requestOperation: "Pipedream trigger deployment" as const },
    );
  }
}

export async function deletePipedreamTrigger(input: {
  profileId: string;
  environment: BookingEnvironment;
  triggerId: string;
}) {
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const query = new URLSearchParams({
    external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
    ignore_hook_errors: "false",
  });
  const path =
    "/v1/connect/" +
    encodeURIComponent(projectId) +
    "/deployed-triggers/" +
    encodeURIComponent(input.triggerId) +
    "?" +
    query;
  try {
    await pdFetch(path, input.environment, "Pipedream trigger deletion", { method: "DELETE" });
  } catch (error) {
    if (resourceAbsent(error, "Pipedream trigger deletion")) return;
    throw error;
  }
}

export async function configurePipedreamTriggerWebhook(input: {
  profileId: string;
  environment: BookingEnvironment;
  triggerId: string;
  webhookUrl: string;
}) {
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const query = new URLSearchParams({
    external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
  });
  const path =
    "/v1/connect/" +
    encodeURIComponent(projectId) +
    "/deployed-triggers/" +
    encodeURIComponent(input.triggerId) +
    "/webhooks?" +
    query;
  const body = await pdFetch(path, input.environment, "Pipedream webhook configuration", {
    method: "PUT",
    body: JSON.stringify({ webhook_urls: [input.webhookUrl] }),
  });
  return parseConfiguredPipedreamWebhook(body, input.webhookUrl);
}

export async function getDeployedPipedreamTrigger(input: {
  profileId: string;
  environment: BookingEnvironment;
  triggerId: string;
}) {
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const query = new URLSearchParams({
    external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
  });
  const path =
    "/v1/connect/" +
    encodeURIComponent(projectId) +
    "/deployed-triggers/" +
    encodeURIComponent(input.triggerId) +
    "?" +
    query;
  const body = (await pdFetch(path, input.environment, "Pipedream deployed trigger lookup")) as {
    data?: unknown;
  };
  return parsePipedreamDeployedTrigger(body?.data);
}

export async function getPipedreamTriggerWebhook(input: {
  profileId: string;
  environment: BookingEnvironment;
  triggerId: string;
  webhookId: string;
}) {
  const projectId = required("PIPEDREAM_PROJECT_ID");
  const query = new URLSearchParams({
    external_user_id: pipedreamExternalUserId(input.profileId, input.environment),
  });
  const path =
    "/v1/connect/" +
    encodeURIComponent(projectId) +
    "/deployed-triggers/" +
    encodeURIComponent(input.triggerId) +
    "/webhooks/" +
    encodeURIComponent(input.webhookId) +
    "?" +
    query;
  const body = (await pdFetch(path, input.environment, "Pipedream webhook lookup")) as {
    data?: unknown;
  };
  if (!body?.data || typeof body.data !== "object")
    throw new Error("Pipedream returned an invalid trigger webhook");
  const webhook = body.data as Record<string, unknown>;
  if (
    typeof webhook.id !== "string" ||
    typeof webhook.url !== "string" ||
    typeof webhook.signing_key !== "string" ||
    typeof webhook.updated_at !== "number"
  )
    throw new Error("Pipedream returned an invalid trigger webhook");
  return {
    id: webhook.id,
    url: webhook.url,
    signingKey: webhook.signing_key,
    updatedAt: new Date(webhook.updated_at * 1000).toISOString(),
  };
}
