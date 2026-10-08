import { createHash } from "node:crypto";
import {
  buildAvailableSlots,
  type BookingOverride,
  type BusyRange,
} from "@/lib/booking-availability";
import { getGoogleCalendarBusyRanges } from "@/lib/pipedream.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadBookingReadinessFacts, unknownBookingReadiness } from "@/lib/booking-readiness.server";
import { withWorkerDeadline } from "@/lib/worker-deadline.server";

export async function loadPublicBookingReadiness(
  input: Parameters<typeof loadBookingReadinessFacts>[0],
) {
  const deadlineAt = Date.now() + 10_000;
  let facts: Awaited<ReturnType<typeof loadBookingReadinessFacts>>;
  try {
    facts = await loadBookingReadinessFacts(input);
  } catch {
    return unknownBookingReadiness(input);
  }
  const unavailable = (current: typeof facts, reason?: string, unknown = false): typeof facts => ({
    ...current,
    bookingAdmission: false,
    publicMode:
      current.publicMode === "live_booking" || (unknown && !current.showDemo)
        ? current.showLeadForm
          ? "starter_leads"
          : "unavailable"
        : current.publicMode,
    reasonCodes: reason ? [...current.reasonCodes, reason] : current.reasonCodes,
    ...(unknown
      ? {
          calendar: current.calendar === "not_configured" ? "not_configured" : "restricted",
          payments: current.payments === "not_configured" ? "not_configured" : "restricted",
          calendarConnection: {
            ...current.calendarConnection,
            healthState: null,
            reason: "verification_unknown",
          },
        }
      : {}),
  });
  if (
    !input.isPublished ||
    !input.isActiveVersion ||
    !["test", "live"].includes(input.environment) ||
    facts.websiteId !== input.websiteId ||
    facts.profileId !== input.profileId ||
    facts.environment !== input.environment
  )
    return unavailable(facts, "booking_configuration_ineligible");
  if (!facts.providerRefreshEligible) return unavailable(facts);
  if (
    process.env.BOOKING_LIVE_ENABLED !== "true" ||
    process.env.BOOKING_WORKER_MODE !== "active" ||
    process.env.BOOKING_WORKER_ENVIRONMENT !== input.environment
  )
    return unavailable(facts, "booking_runtime_unavailable");
  const googleStale = facts.reasonCodes.some((reason) =>
    [
      "google_verification_stale",
      "google_selection_permissions_stale",
      "google_trigger_health_stale",
    ].includes(reason),
  );
  const googleRefreshable =
    googleStale &&
    !facts.calendarConnection.reconnectReason &&
    [null, "verification_stale", "provider_temporary_failure", "provider_platform_error"].includes(
      facts.calendarConnection.reason,
    );
  const stripeStale = facts.reasonCodes.includes("stripe_verification_stale");
  if (!facts.bookingAdmission && !googleRefreshable && !stripeStale) return facts;
  let settledFacts: typeof facts | undefined;
  try {
    return await withWorkerDeadline(deadlineAt, async () => {
      const { billingEnvironment } = await import("@/lib/stripe.server");
      if (billingEnvironment() !== input.environment) {
        settledFacts = unavailable(facts, "booking_environment_mismatch");
        return settledFacts;
      }
      const { data: cutover, error: cutoverError } = await supabaseAdmin.rpc(
        "booking_cutover_enabled",
        { p_profile_id: input.profileId, p_environment: input.environment },
      );
      if (cutoverError || typeof cutover !== "boolean")
        return unavailable(facts, "booking_readiness_unknown", true);
      if (!cutover) {
        settledFacts = unavailable(facts, "booking_cutover_unavailable");
        return settledFacts;
      }
      // Fresh evidence never bypasses deployment or tenant admission authority.
      if (facts.bookingAdmission) return facts;
      // Shared by page, slots and checkout; anonymous traffic cannot amplify one tenant's checks.
      const { data: admitted, error: rateError } = await supabaseAdmin.rpc(
        "check_public_booking_rate_limit",
        {
          p_scope_key: `provider-refresh:${input.websiteId}`,
          p_action: "slots",
          p_client_bucket: createHash("sha256")
            .update(`${input.profileId}:${input.environment}`)
            .digest("hex"),
          p_limit: 2,
          p_window_seconds: 60,
        },
      );
      if (rateError || admitted !== true) return facts;
      const checks: Promise<{ checked: boolean }>[] = [];
      if (googleRefreshable) {
        const { refreshSavedGoogleCalendar } =
          await import("@/lib/pipedream-trigger-reconciliation.server");
        checks.push(
          refreshSavedGoogleCalendar({
            profileId: input.profileId,
            environment: input.environment,
            allowRepair: false,
            deadlineAt: deadlineAt - 1_000,
          }),
        );
      }
      if (stripeStale) {
        const { refreshSavedStripeConnectAccount } =
          await import("@/lib/stripe-connect-inbox-worker.server");
        checks.push(
          refreshSavedStripeConnectAccount({
            profileId: input.profileId,
            environment: input.environment,
            deadlineAt: deadlineAt - 1_000,
          }),
        );
      }
      const results = await Promise.allSettled(checks);
      if (Date.now() >= deadlineAt) return unavailable(facts, "booking_readiness_unknown", true);
      // Verification can persist a negative observation and then reject. Consume that truth too.
      const current = await loadBookingReadinessFacts(input);
      settledFacts = current;
      if (
        current.bookingAdmission &&
        !results.every((result) => result.status === "fulfilled" && result.value.checked === true)
      )
        return unavailable(current, "booking_readiness_unknown", true);
      return current;
    });
  } catch {
    if (settledFacts && !settledFacts.bookingAdmission) return settledFacts;
    // Keep saved configuration, but a failed final read is not current operational evidence.
    return unavailable(settledFacts ?? facts, "booking_readiness_unknown", true);
  }
}

export async function loadLiveBookingSettings(websiteId: string) {
  const { data: website, error: websiteError } = await supabaseAdmin
    .from("websites")
    .select("id,user_id,environment,status,active_version_id")
    .eq("id", websiteId)
    .single();
  if (
    websiteError ||
    website?.id !== websiteId ||
    website.status !== "live" ||
    !website.active_version_id ||
    !["test", "live"].includes(website.environment)
  )
    throw new Error("Booking is unavailable");
  const environment = website.environment as "test" | "live";
  const readiness = await loadPublicBookingReadiness({
    websiteId,
    profileId: website.user_id,
    environment,
    isPublished: website.status === "live",
    isActiveVersion: Boolean(website.active_version_id),
  });
  if (!readiness.bookingAdmission || readiness.publicMode !== "live_booking")
    throw new Error("Booking is unavailable");
  const [{ data: service }, { data: schedule }, { data: connection }, { data: account }] =
    await Promise.all([
      supabaseAdmin
        .from("booking_services")
        .select("*")
        .eq("profile_id", website.user_id)
        .eq("environment", environment)
        .eq("active", true)
        .single(),
      supabaseAdmin
        .from("availability_schedules")
        .select("*")
        .eq("profile_id", website.user_id)
        .eq("environment", environment)
        .eq("active", true)
        .single(),
      supabaseAdmin
        .from("calendar_connections")
        .select("*")
        .eq("profile_id", website.user_id)
        .eq("environment", environment)
        .eq("health_state", "healthy")
        .single(),
      supabaseAdmin
        .from("stripe_connected_accounts")
        .select("*")
        .eq("profile_id", website.user_id)
        .eq("environment", environment)
        .eq("onboarding_state", "ready")
        .single(),
    ]);
  if (!service || !schedule || !connection?.pipedream_account_id || !account?.stripe_account_id)
    throw new Error("Booking is unavailable");
  return { website, environment, service, schedule, connection, account };
}

export async function findAvailableBookingSlots(
  input: {
    websiteId: string;
    fromDate: string;
    dayCount?: number;
  },
  verifiedSettings?: Awaited<ReturnType<typeof loadLiveBookingSettings>>,
) {
  const settings = verifiedSettings ?? (await loadLiveBookingSettings(input.websiteId));
  if (settings.website.id !== input.websiteId) throw new Error("Booking is unavailable");
  const rangeCandidates = [] as Date[];
  for (const value of [input.fromDate + "T00:00", input.fromDate + "T23:59"]) {
    const { localDateTimeCandidates } = await import("@/lib/booking-availability");
    rangeCandidates.push(
      ...localDateTimeCandidates(value.slice(0, 10), value.slice(11), settings.schedule.time_zone),
    );
  }
  const timeMin = new Date(Math.min(...rangeCandidates.map(Number))).toISOString();
  const timeMax = new Date(
    Date.parse(timeMin) + Math.min(input.dayCount ?? 14, 31) * 86_400_000 + 86_400_000,
  ).toISOString();
  const [intervalResult, overrideResult, selectionResult, internalResult] = await Promise.all([
    supabaseAdmin
      .from("availability_intervals")
      .select("weekday,local_start,local_end")
      .eq("schedule_id", settings.schedule.id),
    supabaseAdmin
      .from("availability_overrides")
      .select("id,local_date,override_type,availability_override_intervals(local_start,local_end)")
      .eq("schedule_id", settings.schedule.id)
      .gte("local_date", input.fromDate),
    supabaseAdmin
      .from("calendar_selections")
      .select("google_calendar_id")
      .eq("connection_id", settings.connection.id)
      .eq("active", true)
      .eq("blocks_availability", true),
    supabaseAdmin
      .from("appointments")
      .select("start_at,end_at,buffer_before_minutes,buffer_after_minutes")
      .eq("profile_id", settings.website.user_id)
      .eq("environment", settings.environment)
      .in("appointment_state", ["held", "payment_pending", "confirmed"])
      .gte("end_at", timeMin)
      .lte("start_at", timeMax),
  ]);
  if (intervalResult.error || overrideResult.error || selectionResult.error || internalResult.error)
    throw new Error("Unable to load authoritative booking availability");
  const intervals = intervalResult.data;
  const overrides = overrideResult.data;
  const selections = selectionResult.data;
  const internal = internalResult.data;
  const calendarIds = (selections ?? []).map((row) => row.google_calendar_id);
  if (calendarIds.length === 0) throw new Error("Booking is unavailable");
  const accountId = settings.connection.pipedream_account_id;
  if (!accountId) throw new Error("Booking is unavailable");
  const normalizedCalendarIds = [...calendarIds].sort();
  const calendarSetHash = createHash("sha256")
    .update(normalizedCalendarIds.join("\n"))
    .digest("hex");
  const cacheKey = createHash("sha256")
    .update(
      [
        settings.website.user_id,
        settings.environment,
        accountId,
        String(settings.connection.availability_generation),
        calendarSetHash,
        String(settings.schedule.revision),
        String(settings.service.revision),
        timeMin,
        timeMax,
      ].join("|"),
    )
    .digest("hex");
  const { data: cached, error: cacheReadError } = await supabaseAdmin
    .from("booking_availability_cache")
    .select("busy_ranges,observed_at,expires_at")
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (cacheReadError) throw new Error("Unable to read authoritative availability evidence");
  let externalBusy = cached?.busy_ranges as BusyRange[] | undefined;
  let observedAt = cached?.observed_at ?? null;
  if (!Array.isArray(externalBusy)) {
    externalBusy = await getGoogleCalendarBusyRanges({
      profileId: settings.website.user_id,
      environment: settings.environment,
      accountId,
      calendarIds,
      timeMin,
      timeMax,
    });
    observedAt = new Date().toISOString();
    const { data: cacheStored, error: cacheError } = await supabaseAdmin.rpc(
      "store_booking_availability_cache",
      {
        p_cache_key: cacheKey,
        p_profile_id: settings.website.user_id,
        p_environment: settings.environment,
        p_connection_id: settings.connection.id,
        p_expected_generation: settings.connection.availability_generation,
        p_calendar_set_hash: calendarSetHash,
        p_schedule_revision: settings.schedule.revision,
        p_service_revision: settings.service.revision,
        p_range_start: timeMin,
        p_range_end: timeMax,
        p_busy_ranges: externalBusy,
        p_observed_at: observedAt,
        p_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    );
    if (cacheError || !cacheStored)
      throw new Error("Availability changed while provider evidence was loading");
  }
  const slots = buildAvailableSlots({
    fromDate: input.fromDate,
    dayCount: input.dayCount ?? 14,
    timeZone: settings.schedule.time_zone,
    durationMinutes: settings.service.duration_minutes,
    slotIntervalMinutes: settings.service.slot_interval_minutes,
    bufferBeforeMinutes: settings.service.buffer_before_minutes,
    bufferAfterMinutes: settings.service.buffer_after_minutes,
    minimumNoticeMinutes: settings.service.minimum_notice_minutes,
    horizonDays: settings.service.booking_horizon_days,
    intervals: (intervals ?? []).map((row) => ({
      weekday: row.weekday,
      localStart: row.local_start,
      localEnd: row.local_end,
    })),
    overrides: (overrides ?? []).map((row) => ({
      localDate: row.local_date,
      type: row.override_type,
      intervals: (
        (
          row as typeof row & {
            availability_override_intervals?: { local_start: string; local_end: string }[];
          }
        ).availability_override_intervals ?? []
      ).map((part) => ({ localStart: part.local_start, localEnd: part.local_end })),
    })) as BookingOverride[],
    externalBusy,
    internalBusy: (internal ?? []).map((row) => ({
      start: new Date(Date.parse(row.start_at) - row.buffer_before_minutes * 60_000).toISOString(),
      end: new Date(Date.parse(row.end_at) + row.buffer_after_minutes * 60_000).toISOString(),
    })),
  });
  return {
    slots,
    observedAt: observedAt ?? new Date().toISOString(),
    availabilityGeneration: settings.connection.availability_generation,
    calendarSetHash,
    service: {
      name: settings.service.name,
      amountMinor: settings.service.amount_minor,
      currency: settings.service.currency,
      durationMinutes: settings.service.duration_minutes,
    },
    timeZone: settings.schedule.time_zone,
  };
}
