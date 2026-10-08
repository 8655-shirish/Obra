export type PipedreamTriggerEvent = {
  id: string;
  type: "emit";
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function parsePipedreamTriggerEvent(
  value: unknown,
  nowMs = Date.now(),
): PipedreamTriggerEvent {
  if (!value || typeof value !== "object") throw new Error("Invalid Pipedream trigger event");
  const event = value as Record<string, unknown>;
  if (
    typeof event.id !== "string" ||
    !event.id.trim() ||
    event.k !== "emit" ||
    typeof event.ts !== "number" ||
    !Number.isFinite(event.ts) ||
    event.ts > nowMs + 300_000 ||
    !event.e ||
    typeof event.e !== "object" ||
    Array.isArray(event.e)
  )
    throw new Error("Invalid Pipedream trigger event");
  return {
    id: event.id,
    type: "emit",
    occurredAt: new Date(event.ts).toISOString(),
    payload: event.e as Record<string, unknown>,
  };
}
