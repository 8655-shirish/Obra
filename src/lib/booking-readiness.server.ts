import { z } from "zod";
import { deriveBucketOneReadiness } from "@/lib/booking-readiness";
import type { Database } from "@/integrations/supabase/types";
import { isGoogleAccountEmail } from "@/lib/google-calendar-complete";
import {
  projectGoogleCalendarReadiness,
  type GoogleCalendarConnection,
  type GoogleCalendarPendingSetup,
} from "@/lib/google-calendar-readiness";

const CALENDAR_OBSERVATION_MS = 5_000;
const calendarObservationSignal = () => AbortSignal.timeout(CALENDAR_OBSERVATION_MS);

/** Optional Google reads must not abort entitlement, service, or payment facts. */
function optionalCalendarObservation<T extends { data: unknown; error: unknown }>(
  query: PromiseLike<T>,
): Promise<T | { data: null; error: true }> {
  return Promise.resolve(query).catch(() => ({ data: null, error: true }));
}

type SetupConnection = Pick<
  Database["public"]["Tables"]["calendar_connections"]["Row"],
  "connection_revision"
>;

/** Read-only owner intent, not saved configuration or permission evidence. */
export async function loadPendingGoogleCalendarSetup(input: {
  profileId: string;
  environment: "test" | "live";
  connection: SetupConnection | null;
}): Promise<GoogleCalendarPendingSetup | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // SQL reads current intent, ownership and private disconnect authority in one
  // snapshot. A revision collision is unknown, not permission to use older facts.
  const { data, error } = await supabaseAdmin
    .rpc(
      "get_pending_google_calendar_setup" as never,
      {
        p_profile_id: input.profileId,
        p_environment: input.environment,
        p_expected_revision: input.connection?.connection_revision ?? 0,
      } as never,
    )
    .abortSignal(AbortSignal.timeout(5_000));
  if (error) throw new Error("Unable to load pending Google Calendar setup");
  const result = z
    .object({
      operationId: z.string().min(1),
      accountId: z.string().min(1),
      connectionRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      configurationKey: z.string().regex(/^[a-f0-9]{64}$/),
      blockingCalendarIds: z.array(z.string().min(1)).min(1),
      destinationCalendarId: z.string().min(1),
      reason: z
        .enum(["temporary", "platform", "reauthorization", "permissions", "configuration"])
        .nullable(),
      nextRetryAt: z.string().nullable(),
    })
    .strict()
    .nullable()
    .safeParse(data);
  if (
    !result.success ||
    (result.data && result.data.connectionRevision !== input.connection?.connection_revision)
  )
    throw new Error("Unable to load pending Google Calendar setup");
  return result.data
    ? { ...result.data, blockingCalendarIds: result.data.blockingCalendarIds.sort() }
    : null;
}

const FRESHNESS_MS = 15 * 60 * 1000;
const fresh = (value: string | null | undefined, now: number) => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp <= now + 60_000 && timestamp >= now - FRESHNESS_MS;
};

/** Page-only failure projection. A missing observation grants no provider action. */
export function unknownBookingReadiness(
  input: Parameters<typeof loadBookingReadinessFacts>[0],
): Awaited<ReturnType<typeof loadBookingReadinessFacts>> {
  return {
    ...deriveBucketOneReadiness({
      ...input,
      entitlement: null,
      serviceActive: false,
      scheduleActive: false,
      intervalCount: 0,
      calendarState: "restricted",
      paymentsState: "restricted",
    }),
    showDemo: false,
    publicMode: "unavailable",
    firstIncompleteLabel: "Booking status is unavailable",
    calendarConnection: {
      connectionRevision: null,
      accountId: null,
      pendingSetup: null,
      configured: false,
      healthState: null,
      reason: "verification_unknown",
      reconnectReason: null,
      lastVerifiedAt: null,
      nextRetryAt: null,
      triggerState: null,
      lastHealthAt: null,
    },
    providerRefreshEligible: false,
    calendarAccountEmail: null,
    paymentDashboardAvailable: false,
    reasonCodes: ["booking_readiness_unknown"],
  };
}

export async function loadBookingReadinessFacts(input: {
  websiteId: string;
  profileId: string;
  environment: "test" | "live";
  isPublished: boolean;
  isActiveVersion: boolean;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin;
  const now = Date.now();
  const [entitlement, service, calendar, selections, payments, binding] = await Promise.all([
    Promise.resolve(
      db
        .from("website_entitlements")
        .select(
          "plan,state,quote_admission,booking_admission,order_confirmed_at,effective_at,ends_at",
        )
        .eq("website_id", input.websiteId)
        .eq("profile_id", input.profileId)
        .eq("environment", input.environment)
        .maybeSingle(),
    ),
    Promise.resolve(
      db
        .from("booking_services")
        .select("id,active")
        .eq("profile_id", input.profileId)
        .eq("environment", input.environment)
        .maybeSingle(),
    ),
    optionalCalendarObservation(
      db
        .from("calendar_connections")
        .select(
          "id,connection_revision,pipedream_account_id,health_state,last_verified_at,verification_reason,reconnect_reason,account_email,setup_operation_id,setup_actor_auth_user_id,setup_account_id,setup_expected_revision,setup_calendar_id,setup_calendars,setup_purpose,setup_completed_at,setup_failure_reason,setup_probe_account_id,setup_probe_calendar_id,setup_retry_at",
        )
        .eq("profile_id", input.profileId)
        .eq("environment", input.environment)
        .abortSignal(calendarObservationSignal())
        .maybeSingle(),
    ),
    optionalCalendarObservation(
      db
        .from("calendar_selections")
        .select(
          "connection_id,blocks_availability,receives_bookings,active,access_role,permission_verified_at",
        )
        .eq("profile_id", input.profileId)
        .eq("environment", input.environment)
        .eq("active", true)
        .abortSignal(calendarObservationSignal()),
    ),
    Promise.resolve(
      db
        .from("stripe_connected_accounts")
        .select(
          "stripe_account_id,onboarding_state,charges_enabled,payouts_enabled,details_submitted,capabilities,requirements,last_verified_at",
        )
        .eq("profile_id", input.profileId)
        .eq("environment", input.environment)
        .maybeSingle(),
    ),
    optionalCalendarObservation(
      db
        .from("pipedream_bindings")
        .select(
          "connection_id,pipedream_account_id,trigger_state,last_health_at,reconciliation_due_at",
        )
        .eq("profile_id", input.profileId)
        .eq("environment", input.environment)
        .abortSignal(calendarObservationSignal())
        .maybeSingle(),
    ),
  ]);
  for (const result of [entitlement, service, payments])
    if (result.error) throw new Error("Unable to load booking readiness facts");
  let scheduleActive = false,
    intervalCount = 0;
  if (service.data) {
    const schedule = await db
      .from("availability_schedules")
      .select("id,active")
      .eq("profile_id", input.profileId)
      .eq("environment", input.environment)
      .eq("service_id", service.data.id)
      .maybeSingle();
    if (schedule.error) throw new Error("Unable to load availability readiness");
    scheduleActive = Boolean(schedule.data?.active);
    if (schedule.data) {
      const count = await db
        .from("availability_intervals")
        .select("id", { count: "exact", head: true })
        .eq("schedule_id", schedule.data.id)
        .eq("profile_id", input.profileId)
        .eq("environment", input.environment);
      if (count.error) throw new Error("Unable to load availability readiness");
      intervalCount = count.count ?? 0;
    }
  }
  const effectiveAt = entitlement.data?.effective_at
    ? Date.parse(entitlement.data.effective_at)
    : Number.NaN;
  const endsAt = entitlement.data?.ends_at ? Date.parse(entitlement.data.ends_at) : null;
  const entitlementTemporallyEligible = Boolean(
    entitlement.data &&
    Number.isFinite(effectiveAt) &&
    effectiveAt <= now &&
    (endsAt === null || (Number.isFinite(endsAt) && endsAt > now)),
  );
  const currentConnection = calendar.error ? null : calendar.data;
  let calendarUnknown = Boolean(calendar.error || selections.error || binding.error);
  let pendingSetup: GoogleCalendarPendingSetup | null = null;
  if (!calendar.error) {
    try {
      // Optional observations stay on this query's abort; they must not fence
      // checked entitlement, availability, or payment facts.
      pendingSetup = await loadPendingGoogleCalendarSetup({
        profileId: input.profileId,
        environment: input.environment,
        connection: currentConnection,
      });
    } catch {
      calendarUnknown = true;
    }
  }
  const selectionRows =
    currentConnection?.id && !selections.error && selections.data
      ? selections.data.filter((selection) => selection.connection_id === currentConnection.id)
      : [];
  const bindingMatchesConnection = Boolean(
    !binding.error &&
    binding.data &&
    currentConnection?.id &&
    currentConnection.pipedream_account_id?.trim() &&
    binding.data.connection_id === currentConnection.id &&
    binding.data.pipedream_account_id === currentConnection.pipedream_account_id,
  );
  const googleCalendar = projectGoogleCalendarReadiness({
    healthState: currentConnection?.pipedream_account_id?.trim()
      ? (currentConnection.health_state as GoogleCalendarConnection["healthState"])
      : "not_connected",
    reason: currentConnection?.verification_reason,
    reconnectReason: currentConnection?.reconnect_reason,
    lastVerifiedAt: currentConnection?.last_verified_at,
    selections: selectionRows,
    triggerState: bindingMatchesConnection ? binding.data?.trigger_state : null,
    triggerLastHealthAt: bindingMatchesConnection ? binding.data?.last_health_at : null,
    now,
    freshnessMs: FRESHNESS_MS,
  });
  const calendarConnection: GoogleCalendarConnection = {
    connectionRevision: currentConnection?.connection_revision ?? null,
    accountId: currentConnection?.pipedream_account_id ?? null,
    pendingSetup: pendingSetup
      ? {
          configurationKey: pendingSetup.configurationKey,
          reason: pendingSetup.reason,
          nextRetryAt: pendingSetup.nextRetryAt,
        }
      : null,
    configured:
      Boolean(currentConnection?.pipedream_account_id?.trim()) &&
      googleCalendar.selectionsConfigured,
    healthState: calendarUnknown
      ? null
      : ((currentConnection?.health_state as GoogleCalendarConnection["healthState"]) ?? null),
    reason: calendarUnknown
      ? "verification_unknown"
      : (currentConnection?.verification_reason ?? null),
    reconnectReason: currentConnection?.reconnect_reason ?? null,
    lastVerifiedAt: currentConnection?.last_verified_at ?? null,
    nextRetryAt: bindingMatchesConnection ? (binding.data?.reconciliation_due_at ?? null) : null,
    triggerState: bindingMatchesConnection ? (binding.data?.trigger_state ?? null) : null,
    lastHealthAt: bindingMatchesConnection ? (binding.data?.last_health_at ?? null) : null,
  };
  const capabilities = (payments.data?.capabilities ?? {}) as Record<string, unknown>;
  const requirements = (payments.data?.requirements ?? {}) as Record<string, unknown>;
  const requirementsComplete =
    Array.isArray(requirements.currently_due) &&
    Array.isArray(requirements.past_due) &&
    Array.isArray(requirements.pending_verification);
  const currentlyDue = requirementsComplete ? (requirements.currently_due as unknown[]) : [];
  const pastDue = requirementsComplete ? (requirements.past_due as unknown[]) : [];
  const pendingVerification = requirementsComplete
    ? (requirements.pending_verification as unknown[])
    : [];
  const paymentSnapshotFresh = fresh(payments.data?.last_verified_at, now);
  const paymentsReady =
    Boolean(payments.data?.stripe_account_id) &&
    payments.data?.onboarding_state === "ready" &&
    payments.data.charges_enabled &&
    payments.data.payouts_enabled &&
    payments.data.details_submitted &&
    capabilities.card_payments === "active" &&
    requirementsComplete &&
    currentlyDue.length === 0 &&
    pastDue.length === 0 &&
    pendingVerification.length === 0 &&
    !requirements.disabled_reason &&
    paymentSnapshotFresh;
  const paymentsState = paymentsReady
    ? "ready"
    : !payments.data?.stripe_account_id
      ? "not_configured"
      : payments.data.onboarding_state === "restricted" ||
          payments.data.onboarding_state === "disabled" ||
          !paymentSnapshotFresh
        ? "restricted"
        : "pending";
  const readiness = deriveBucketOneReadiness({
    websiteId: input.websiteId,
    profileId: input.profileId,
    environment: input.environment,
    entitlement: entitlement.data
      ? {
          plan: entitlement.data.plan as "starter" | "pro",
          state: entitlement.data.state,
          quote_admission: entitlement.data.quote_admission,
          booking_admission: entitlement.data.booking_admission,
          order_confirmed_at: entitlement.data.order_confirmed_at,
        }
      : null,
    entitlementTemporallyEligible,
    isPublished: input.isPublished,
    isActiveVersion: input.isActiveVersion,
    serviceActive: Boolean(service.data?.active),
    scheduleActive,
    intervalCount,
    calendarState: calendarUnknown ? "restricted" : pendingSetup ? "pending" : googleCalendar.state,
    paymentsState,
  });
  const calendarEmail = currentConnection?.account_email;
  // Known setup/admission blockers survive an independent Google observation outage.
  // Missing query results do not prove that an account or its selections are absent.
  const configurationIneligible =
    !input.isPublished ||
    !input.isActiveVersion ||
    readiness.plan !== "pro" ||
    !readiness.orderConfirmed ||
    !entitlementTemporallyEligible ||
    !["active", "grace"].includes(entitlement.data?.state ?? "") ||
    entitlement.data?.booking_admission !== true ||
    readiness.availability !== "configured" ||
    Boolean(pendingSetup) ||
    !payments.data?.stripe_account_id ||
    (!calendar.error && !currentConnection?.pipedream_account_id?.trim()) ||
    (!calendar.error && !selections.error && !calendarConnection.configured);
  return {
    ...readiness,
    publicMode:
      calendarUnknown && readiness.publicMode === "configuration_pending"
        ? ("unavailable" as const)
        : readiness.publicMode,
    firstIncompleteLabel:
      readiness.firstIncompleteStep === "calendar" &&
      (calendarUnknown || calendarConnection.configured || pendingSetup)
        ? pendingSetup && !calendarUnknown
          ? "Review Google Calendar setup"
          : "Check Google Calendar status"
        : readiness.firstIncompleteLabel,
    calendarConnection,
    providerRefreshEligible: !calendarUnknown && !configurationIneligible,
    calendarAccountEmail: isGoogleAccountEmail(calendarEmail) ? calendarEmail.trim() : null,
    paymentDashboardAvailable: Boolean(
      payments.data?.stripe_account_id && payments.data.details_submitted,
    ),
    reasonCodes: [
      ...readiness.reasonCodes.filter((reason) => reason !== "calendar_provider_not_ready"),
      ...(calendarUnknown ? ["booking_readiness_unknown"] : googleCalendar.reasons),
      ...(configurationIneligible ? ["booking_configuration_ineligible"] : []),
      ...[
        "contractor_disconnected",
        "provider_reauthorization_required",
        "calendar_permissions_changed",
        "calendar_write_blocked",
        "calendar_selection_invalid",
        "provider_configuration_error",
      ].filter((reason) => reason === currentConnection?.verification_reason),
      ...(pendingSetup ? ["google_setup_pending"] : []),
      ...(payments.data?.stripe_account_id && !paymentSnapshotFresh
        ? ["stripe_verification_stale"]
        : []),
    ],
  };
}
