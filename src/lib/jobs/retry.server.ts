/** Exponential backoff base delay for job retries (PRD § Background job runner). */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

export function computeRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_MAX_MS);
}

export function getNextRetryAtIso(attempts: number): string {
  const delayMs = computeRetryDelayMs(attempts);
  return new Date(Date.now() + delayMs).toISOString();
}

export function asPayloadRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) };
  }
  return {};
}

export function getNextRetryAtFromPayload(payload: unknown): string | null {
  const record = asPayloadRecord(payload);
  const value = record.next_retry_at;
  return typeof value === "string" ? value : null;
}

export function isJobReadyForRetry(payload: unknown): boolean {
  const nextRetryAt = getNextRetryAtFromPayload(payload);
  if (!nextRetryAt) return true;
  return Date.now() >= new Date(nextRetryAt).getTime();
}

export function withoutRetrySchedule(payload: unknown): Record<string, unknown> {
  const record = asPayloadRecord(payload);
  delete record.next_retry_at;
  return record;
}
