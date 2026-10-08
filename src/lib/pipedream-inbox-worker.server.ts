import { randomUUID } from "node:crypto";

type PipedreamEnvelope = {
  id: string;
  type: string;
  occurred_at: string;
  environment: "test" | "live";
  binding_id: string;
  account_id: string;
  trigger_id: string;
  correlation_id: string;
};
function envelope(value: unknown): PipedreamEnvelope {
  if (!value || typeof value !== "object") throw new Error("Invalid Pipedream event");
  const v = value as Record<string, unknown>;
  for (const k of [
    "id",
    "type",
    "occurred_at",
    "environment",
    "binding_id",
    "account_id",
    "trigger_id",
    "correlation_id",
  ])
    if (typeof v[k] !== "string" || !v[k]) throw new Error("Invalid Pipedream event identity");
  const at = new Date(v.occurred_at as string);
  if (!Number.isFinite(at.getTime()) || at.getTime() > Date.now() + 300000)
    throw new Error("Invalid Pipedream event timestamp");
  return v as PipedreamEnvelope;
}
export async function processPipedreamCalendarInbox(
  limit = 25,
  options?: { environment: "test" | "live"; deadlineAt: number },
) {
  const environment = options?.environment ?? process.env["BOOKING_WORKER_ENVIRONMENT"]?.trim();
  if (environment !== "test" && environment !== "live")
    throw new Error("Explicit Pipedream worker environment required");
  const deadlineAt = Math.min(options?.deadlineAt ?? Infinity, Date.now() + 15_000);
  const signal = (settling = false) => {
    const remaining = Math.floor(deadlineAt - (settling ? 0 : 1_000) - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0)
      throw new Error("Pipedream inbox deadline exceeded");
    return AbortSignal.timeout(Math.min(3_000, remaining));
  };
  let processed = 0;
  let failed = 0;
  let claimed = 0;
  if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt - 3_000)
    return { processed, failed, claimed, deadlineExceeded: true };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin
    .from("provider_event_inbox")
    .select("id,payload")
    .eq("provider", "pipedream")
    .eq("event_family", "calendar")
    .eq("environment", environment)
    .in("processing_state", ["pending", "processing", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("received_at")
    .limit(Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 1, 25)))
    .abortSignal(signal());
  if (error) throw new Error("Unable to load Pipedream inbox");
  for (const row of rows ?? []) {
    if (Date.now() >= deadlineAt - 3_000) break;
    const token = randomUUID();
    const { data: fence, error: claimError } = await supabaseAdmin
      .rpc("claim_provider_event", {
        p_event_id: row.id,
        p_lease_token: token,
        p_lease_seconds: 55,
      })
      .abortSignal(signal());
    if (claimError) {
      if (claimError.code === "P0001") continue;
      throw new Error("Unable to claim Pipedream event");
    }
    if (fence === null || !Number.isSafeInteger(fence) || fence < 1)
      throw new Error("Indeterminate Pipedream event claim");
    claimed++;
    try {
      const event = envelope(row.payload);
      if (event.environment !== environment)
        throw new Error("Pipedream inbox environment mismatch");
      const { data: applied, error: applyError } = await supabaseAdmin
        .rpc("apply_pipedream_calendar_event", {
          p_event_id: row.id,
          p_lease_token: token,
          p_fencing_token: fence,
          p_occurred_at: new Date(event.occurred_at).toISOString(),
        })
        .abortSignal(signal());
      if (applyError || applied !== true) throw new Error("Pipedream event was not applied");
      processed++;
    } catch {
      failed++;
      const { data: settled, error: settle } = await supabaseAdmin
        .rpc("complete_provider_event", {
          p_event_id: row.id,
          p_lease_token: token,
          p_fencing_token: fence,
          p_succeeded: false,
          p_safe_error: "Pipedream calendar event processing failed",
        })
        .abortSignal(signal(true));
      if (settle || settled !== true) throw new Error("Unable to settle Pipedream event failure");
    }
  }
  return { processed, failed, claimed, deadlineExceeded: Date.now() >= deadlineAt - 3_000 };
}
