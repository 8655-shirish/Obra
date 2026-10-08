export type GoogleCalendarHealth =
  "not_connected" | "pending" | "healthy" | "degraded" | "disconnected";
export type GoogleCalendarReadinessReason =
  | "google_not_connected"
  | "google_verification_pending"
  | "google_connection_degraded"
  | "google_connection_disconnected"
  | "google_verification_stale"
  | "google_no_readable_blocking_calendar"
  | "google_writable_destination_missing"
  | "google_multiple_writable_destinations"
  | "google_calendar_permissions_changed"
  | "google_selection_permissions_stale"
  | "google_trigger_not_active"
  | "google_trigger_health_stale"
  | "google_setup_pending";

export type GoogleCalendarPendingSetup = {
  operationId: string;
  accountId: string;
  connectionRevision: number;
  configurationKey: string;
  blockingCalendarIds: string[];
  destinationCalendarId: string;
  reason: "temporary" | "platform" | "reauthorization" | "permissions" | "configuration" | null;
  nextRetryAt: string | null;
};

export type GoogleCalendarConnection = {
  connectionRevision: number | null;
  accountId: string | null;
  pendingSetup: Pick<
    GoogleCalendarPendingSetup,
    "configurationKey" | "reason" | "nextRetryAt"
  > | null;
  configured: boolean;
  healthState: GoogleCalendarHealth | null;
  reason: string | null;
  reconnectReason: string | null;
  lastVerifiedAt: string | null;
  nextRetryAt: string | null;
  triggerState: string | null;
  lastHealthAt: string | null;
};

type Selection = {
  active: boolean;
  blocks_availability: boolean;
  receives_bookings: boolean;
  access_role: string | null;
  permission_verified_at?: string | null;
};

const readable = (role: string | null) =>
  role === "freeBusyReader" || role === "reader" || role === "writer" || role === "owner";
const writable = (role: string | null) => role === "writer" || role === "owner";

export function projectGoogleCalendarReadiness(input: {
  healthState?: GoogleCalendarHealth | null;
  reason?: string | null;
  reconnectReason?: string | null;
  lastVerifiedAt?: string | null;
  selections: Selection[];
  triggerState?: string | null;
  triggerLastHealthAt?: string | null;
  now?: number;
  freshnessMs?: number;
}) {
  const now = input.now ?? Date.now();
  const freshnessMs = input.freshnessMs ?? 15 * 60 * 1000;
  const fresh = (value: string | null | undefined) => {
    const timestamp = value ? Date.parse(value) : Number.NaN;
    return (
      Number.isFinite(timestamp) && timestamp <= now + 60_000 && timestamp >= now - freshnessMs
    );
  };
  const active = input.selections.filter((selection) => selection.active);
  const blocking = active.filter((selection) => selection.blocks_availability);
  const destinations = active.filter((selection) => selection.receives_bookings);
  const blockingCount = blocking.filter((selection) => readable(selection.access_role)).length;
  const destinationCount = destinations.filter((selection) =>
    writable(selection.access_role),
  ).length;
  const permissionsChanged =
    blockingCount !== blocking.length || destinationCount !== destinations.length;
  // Completion is structural. Booking permission still requires fresh evidence for the full set.
  const selectionsConfigured =
    blockingCount > 0 && destinations.length === 1 && !permissionsChanged;
  const reasons: GoogleCalendarReadinessReason[] = [];
  if (!input.healthState || input.healthState === "not_connected")
    reasons.push("google_not_connected");
  else if (input.healthState === "pending") reasons.push("google_verification_pending");
  else if (input.healthState === "degraded") reasons.push("google_connection_degraded");
  else if (input.healthState === "disconnected") reasons.push("google_connection_disconnected");
  else if (input.healthState !== "healthy" || input.reason || input.reconnectReason)
    reasons.push("google_connection_degraded");
  if (!fresh(input.lastVerifiedAt)) reasons.push("google_verification_stale");
  if (blockingCount < 1) reasons.push("google_no_readable_blocking_calendar");
  if (destinationCount < 1) reasons.push("google_writable_destination_missing");
  if (destinations.length > 1) reasons.push("google_multiple_writable_destinations");
  if (permissionsChanged) reasons.push("google_calendar_permissions_changed");
  if (
    active.some(
      (selection) =>
        (selection.blocks_availability || selection.receives_bookings) &&
        !fresh(selection.permission_verified_at),
    )
  )
    reasons.push("google_selection_permissions_stale");
  if (input.triggerState !== "active") reasons.push("google_trigger_not_active");
  if (!fresh(input.triggerLastHealthAt)) reasons.push("google_trigger_health_stale");
  const ready = reasons.length === 0;
  const state = ready
    ? "ready"
    : input.healthState === "degraded" || input.healthState === "disconnected"
      ? "restricted"
      : input.healthState === "healthy"
        ? "restricted"
        : input.healthState === "pending"
          ? "pending"
          : "not_configured";
  return { ready, state, reasons, blockingCount, destinationCount, selectionsConfigured } as const;
}

/** Display-only interpretation of persisted facts, never a booking admission gate. */
export function googleCalendarConnectionStatus(
  connection: GoogleCalendarConnection,
  ready: boolean,
) {
  if (connection.reason === "verification_unknown") return "unknown";
  if (connection.pendingSetup) {
    const reason = connection.pendingSetup.reason;
    if (reason === "reauthorization") return "reconnect";
    if (reason === "permissions") return "access_issue";
    if (reason === "platform") return "service_issue";
    if (reason === "configuration") return "selection_required";
    return "setup_pending";
  }
  const reasons = [connection.reason, connection.reconnectReason];
  if (reasons.includes("contractor_disconnected")) return "disconnected";
  if (reasons.includes("provider_reauthorization_required")) return "reconnect";
  if (
    reasons.includes("calendar_permissions_changed") ||
    reasons.includes("calendar_write_blocked")
  )
    return "access_issue";
  if (
    reasons.includes("provider_configuration_error") ||
    reasons.includes("provider_platform_error")
  )
    return "service_issue";
  if (
    !connection.configured &&
    (!connection.healthState || connection.healthState === "not_connected")
  )
    return "not_connected";
  if (!connection.configured || reasons.includes("calendar_selection_invalid"))
    return "selection_required";
  // Legacy unhealthy/missing observations and unknown failures do not prove revoked consent.
  if (reasons.some((reason) => reason && reason !== "verification_stale"))
    return "temporarily_unavailable";
  if (connection.triggerState !== "active") return "monitoring_repair";
  if (
    (connection.healthState === "degraded" || connection.healthState === "disconnected") &&
    connection.reason !== "verification_stale"
  )
    return "temporarily_unavailable";
  return ready && connection.healthState === "healthy" ? "connected" : "checking";
}
