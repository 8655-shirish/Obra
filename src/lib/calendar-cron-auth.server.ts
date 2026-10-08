const canonicalOrigin = "https://obratech.co";

/** A scheduled bearer targets only the fixed environment, endpoint and request body. */
export async function readCalendarCronRequest(
  request: Request,
  worker: "google" | "stripe" | "booking",
  expected: string | undefined,
): Promise<
  | { body: Record<string, unknown>; environment: string | null; scheduleName: string | null }
  | Response
> {
  if (
    !expected ||
    /\s/.test(expected) ||
    request.headers.get("authorization") !== "Bearer " + expected
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const endpoint =
    worker === "booking"
      ? "/api/cron/booking"
      : `/api/cron/${worker === "google" ? "pipedream" : "stripe"}-inbox`;
  const url = new URL(request.url);
  const environment = request.headers.get("x-obra-worker-environment");
  const scheduleName = request.headers.get("x-obra-cron-schedule");
  if (
    request.method !== "POST" ||
    url.pathname !== endpoint ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    ((environment !== null || scheduleName !== null) &&
      (url.origin !== canonicalOrigin ||
        !["test", "live"].includes(environment ?? "") ||
        scheduleName === null))
  )
    return Response.json({ error: "Invalid cron target" }, { status: 400 });
  const reader = request.body?.getReader();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader?.cancel().catch(() => undefined);
  }, 2_000);
  try {
    let text = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    if (reader)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024) throw new Error("Request too large");
        text += decoder.decode(value, { stream: true });
      }
    if (timedOut) throw new Error("Request body timed out");
    // Existing manual bearer callers may omit an inbox body (or probe booking off).
    const body: unknown = JSON.parse(
      text + decoder.decode() || (scheduleName === null ? "{}" : ""),
    );
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    const fields = body as Record<string, unknown>;
    if (worker !== "booking" && Object.keys(fields).length !== 0)
      throw new Error("Invalid inbox body");
    if (scheduleName !== null) {
      const suffix = worker === "booking" ? `booking-${fields.family}` : worker;
      if (
        scheduleName !== `obra-calendar-${environment}-${suffix}` ||
        (worker === "booking" &&
          (!["core", "notifications"].includes(String(fields.family)) ||
            Object.keys(fields).length !== 1))
      )
        throw new Error("Schedule identity mismatch");
    }
    return { body: fields, environment, scheduleName };
  } catch {
    return Response.json({ error: "Invalid cron request" }, { status: 400 });
  } finally {
    clearTimeout(timer);
    void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}
