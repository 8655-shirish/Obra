import { AsyncLocalStorage } from "node:async_hooks";

type WorkerDeadline = {
  deadlineAt: number;
  workDeadlineAt: number;
  canContinue: () => boolean;
  controller: AbortController;
  requests: Set<Promise<unknown>>;
  closed: boolean;
  budgetExhausted: boolean;
};
const deadline = new AsyncLocalStorage<WorkerDeadline>();

export class WorkerDeadlineError extends Error {
  readonly code = "ABORT_ERR";
  constructor() {
    super("Worker invocation deadline or continuation fence reached");
    this.name = "WorkerDeadlineError";
  }
}

export function hasWorkerDeadline() {
  return deadline.getStore() !== undefined;
}

/** Provider adapters with their own body/error reader borrow this scope, not another timer. */
export function workerProviderContext() {
  const scope = deadline.getStore();
  return scope
    ? {
        deadlineAt: scope.workDeadlineAt,
        settlementDeadlineAt: scope.deadlineAt,
        signal: scope.controller.signal,
      }
    : undefined;
}

export function workerCanContinue() {
  const scope = deadline.getStore();
  return (
    !scope ||
    (!scope.closed &&
      !scope.controller.signal.aborted &&
      Date.now() < scope.workDeadlineAt &&
      scope.canContinue())
  );
}

/** The caller awaits work and all network cleanup; no detached worker wins a timeout race. */
export async function withWorkerDeadline<T>(
  deadlineAt: number,
  work: () => Promise<T>,
  options: { workDeadlineAt?: number; canContinue?: () => boolean } = {},
): Promise<T> {
  if (
    !Number.isFinite(deadlineAt) ||
    (options.workDeadlineAt !== undefined && !Number.isFinite(options.workDeadlineAt))
  )
    throw new WorkerDeadlineError();
  const parent = deadline.getStore();
  const scope: WorkerDeadline = {
    deadlineAt: Math.min(deadlineAt, parent?.deadlineAt ?? Infinity, Date.now() + 45_000),
    workDeadlineAt: Math.min(
      options.workDeadlineAt ?? deadlineAt - 3_000,
      parent?.workDeadlineAt ?? Infinity,
    ),
    canContinue: () =>
      (!parent || (!parent.closed && parent.canContinue())) && (options.canContinue?.() ?? true),
    controller: new AbortController(),
    requests: new Set(),
    closed: false,
    budgetExhausted: false,
  };
  if (scope.deadlineAt <= Date.now()) throw new WorkerDeadlineError();
  scope.workDeadlineAt = Math.min(scope.workDeadlineAt, scope.deadlineAt);
  const abortFromParent = () => scope.controller.abort(new WorkerDeadlineError());
  if (parent?.controller.signal.aborted) abortFromParent();
  parent?.controller.signal.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () => scope.controller.abort(new WorkerDeadlineError()),
    scope.deadlineAt - Date.now(),
  );
  return deadline.run(scope, async () => {
    try {
      const result = await work();
      if (
        scope.controller.signal.aborted ||
        scope.budgetExhausted ||
        Date.now() >= scope.deadlineAt
      )
        throw new WorkerDeadlineError();
      return result;
    } finally {
      clearTimeout(timer);
      parent?.controller.signal.removeEventListener("abort", abortFromParent);
      scope.closed = true;
      scope.controller.abort(new WorkerDeadlineError());
      await Promise.allSettled(scope.requests);
    }
  });
}

function boundedFetch(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  database: boolean,
  timeoutMs: number,
  dispatch?: { dispatched: boolean },
) {
  const scope = deadline.getStore();
  if (!scope) {
    if (dispatch) dispatch.dispatched = true;
    const request = fetch(input, init);
    if (!database) return request;
    // Interactive page reads are not workers. Still do not honor PostgREST Retry-After.
    return request.then((response) => {
      if (response.status === 503 || response.status === 520) {
        void response.body?.cancel().catch(() => undefined);
        throw Object.assign(new Error("Database transport failed"), { code: "ABORT_ERR" });
      }
      return response;
    });
  }
  const operation = (async () => {
    const until = database ? scope.deadlineAt : scope.workDeadlineAt;
    const remaining = Math.floor(Math.min(timeoutMs, until - Date.now()));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const pathname = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const startsClaim = database && method === "POST" && pathname.startsWith("/rest/v1/rpc/claim_");
    if (
      scope.closed ||
      scope.controller.signal.aborted ||
      remaining <= 0 ||
      ((!database || startsClaim) && !workerCanContinue())
    ) {
      scope.budgetExhausted = true;
      throw new WorkerDeadlineError();
    }
    const controller = new AbortController();
    const signals = [controller.signal, scope.controller.signal];
    if (init?.signal) signals.push(init.signal);
    if (input instanceof Request) signals.push(input.signal);
    const signal = AbortSignal.any(signals);
    if (signal.aborted) throw new WorkerDeadlineError();
    const requestDeadlineAt = Math.min(until, Date.now() + remaining);
    let timer = setTimeout(() => controller.abort(new WorkerDeadlineError()), remaining);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new WorkerDeadlineError());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      // Keep abort armed through body consumption, including SDK/PostgREST/Auth consumers.
      // Buffering also bounds responses and prevents a slow body from escaping this scope.
      if (dispatch) dispatch.dispatched = true;
      // redirect:"manual": Workers rejects "error" before any network I/O, and
      // nothing is ever followed — callers already fail closed on non-ok responses.
      const request = fetch(input, { ...init, redirect: "manual", signal });
      response = await Promise.race([request, aborted]);
      if (database && (response.status === 503 || response.status === 520)) {
        void response.body?.cancel().catch(() => undefined);
        // PostgREST otherwise sleeps on an unbounded Retry-After outside fetch. Retry
        // through the durable worker claim, not an SDK sleep which outlives this scope.
        throw Object.assign(new Error("Worker database transport failed"), { code: "ABORT_ERR" });
      }
      if (!response.ok) {
        clearTimeout(timer);
        timer = setTimeout(
          () => controller.abort(new WorkerDeadlineError()),
          Math.max(1, Math.min(2_000, requestDeadlineAt - Date.now())),
        );
      }
      if (!response.body) {
        if (!response.ok && pathname.startsWith("/auth/v1/"))
          throw new Error("Auth rejection has no diagnostic body");
        return response;
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (done) break;
        length += value.byteLength;
        if (length > (response.ok ? 16 * 1024 * 1024 : 16_384))
          throw new Error("Worker response exceeds transport limit");
        chunks.push(value);
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      // Auth otherwise drops the known status when its own JSON diagnostic reader fails.
      if (!response.ok && pathname.startsWith("/auth/v1/"))
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (error) {
      if (
        response &&
        response.status >= 400 &&
        !(database && (response.status === 503 || response.status === 520))
      ) {
        // Missing diagnostics cannot turn a known rejection into a possibly accepted write.
        // Keep a JSON error for Auth/PostgREST, without inventing a provider machine code.
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        headers.delete("transfer-encoding");
        headers.set("content-type", "application/json");
        return Response.json(
          {
            message: "Worker upstream request rejected; diagnostics unavailable",
            error: { message: "Worker upstream request rejected; diagnostics unavailable" },
          },
          { status: response.status, statusText: response.statusText, headers },
        );
      }
      if (error instanceof WorkerDeadlineError) {
        scope.budgetExhausted = true;
        throw error;
      }
      // Mark transport cancellation for SDKs without exposing URLs, keys or provider prose.
      throw Object.assign(new Error("Worker transport failed"), { code: "ABORT_ERR" });
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
      controller.abort();
      if (reader) {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
  })();
  scope.requests.add(operation);
  void operation.then(
    () => scope.requests.delete(operation),
    () => scope.requests.delete(operation),
  );
  return operation;
}

export const workerProviderFetch: typeof fetch = (input, init) =>
  boundedFetch(input, init, false, 30_000);

// Only PostgREST gets the settlement reserve. Auth sends and storage effects must stop
// at the work deadline; this does not broaden the client's existing database role.
export const workerSupabaseFetch = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
  dispatch?: { dispatched: boolean },
) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return boundedFetch(input, init, url.pathname.startsWith("/rest/v1/"), 5_000, dispatch);
};
