import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { VerifiedGoogleCalendarSelection } from "@/lib/google-calendar-state.server";

const websiteInput = z.object({ websiteId: z.string().uuid() });

async function providerOwnerContext(websiteId: string) {
  const { providerOwnerContext } = await import("@/lib/provider-authorization.server");
  return providerOwnerContext(websiteId, "Google Calendar");
}

async function providerMutationContext(websiteId: string) {
  const { providerMutationContext } = await import("@/lib/provider-authorization.server");
  return providerMutationContext(websiteId, "Google Calendar");
}

async function authorizeSetupRead(input: {
  profileId: string;
  environment: "test" | "live";
  accountId: string;
  expectedRevision: number;
  expectedSetupKey?: string | null;
  deadlineAt: number;
}) {
  const { googleCalendarLifetimeRpc, requireGoogleCalendarSettlement } =
    await import("@/lib/google-calendar-state.server");
  requireGoogleCalendarSettlement(
    await googleCalendarLifetimeRpc<boolean>(
      "authorize_google_calendar_setup_read",
      {
        p_profile_id: input.profileId,
        p_environment: input.environment,
        p_account_id: input.accountId,
        p_expected_revision: input.expectedRevision,
        p_expected_setup_key: input.expectedSetupKey ?? null,
      },
      input.deadlineAt - 3_000,
    ),
  );
}

const GOOGLE_CONNECT_OPEN_FALLBACK = "Unable to open Google setup. Please try again.";

async function throwGoogleConnectOpenFailure(error: unknown): Promise<never> {
  const { GoogleCalendarStateError } = await import("@/lib/google-calendar-state.server");
  // Temporary diagnostic suffixes: user copy is unchanged, bracket codes name the
  // collapsed class so one live click discriminates settlement vs provider vs shape.
  if (error instanceof GoogleCalendarStateError)
    throw new Error(`${GOOGLE_CONNECT_OPEN_FALLBACK} [rpc-settle]`);
  const { PipedreamError, classifyPipedreamFailure } = await import("@/lib/pipedream.server");
  if (error instanceof PipedreamError) {
    // Status/operation/reason are documented machine codes; provider bodies never cross here.
    // aborted names our own timeout/scope abort vs a network-layer failure; reason is unchanged.
    const detail = `${error.status}/${error.operation}/${error.reason ?? "unknown"}/aborted=${error.aborted === true}`;
    throw new Error(
      classifyPipedreamFailure(error) === "platform"
        ? `Google setup could not be opened. This needs attention from Obra, not another sign-in. [pd-platform ${detail}]`
        : `${GOOGLE_CONNECT_OPEN_FALLBACK} [pd-temporary ${detail}]`,
    );
  }
  if (error instanceof Error && error.message.trim()) throw error;
  // typeof is always safe; the value itself is never echoed.
  throw new Error(`${GOOGLE_CONNECT_OPEN_FALLBACK} [non-error typeof=${typeof error}]`);
}

export const startGoogleCalendarConnect = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    websiteInput.extend({ returnPath: z.string().regex(/^\//).max(200).optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { profile, website, authUserId } = await providerMutationContext(data.websiteId);
    const deadlineAt = Date.now() + 20_000;
    const { randomUUID } = await import("node:crypto");
    const operationId = randomUUID();
    try {
      const { googleCalendarLifetimeRpc, requireGoogleCalendarSettlement } =
        await import("@/lib/google-calendar-state.server");
      const { createGoogleConnectLink, withPipedreamDeadline, REQUEST_TIMEOUT_MS } =
        await import("@/lib/pipedream.server");
      requireGoogleCalendarSettlement(
        await googleCalendarLifetimeRpc<{ id: string }>(
          "authorize_google_calendar_connect_start",
          {
            p_profile_id: profile.id,
            p_environment: website.environment,
            p_actor_auth_user_id: authUserId,
            p_operation_id: operationId,
          },
          deadlineAt - REQUEST_TIMEOUT_MS,
          { revealOwnerFailure: true },
        ),
      );
      const result = await withPipedreamDeadline(deadlineAt, () =>
        createGoogleConnectLink({
          profileId: profile.id,
          environment: website.environment as "test" | "live",
          websiteId: website.id,
          ...(data.returnPath ? { returnPath: data.returnPath } : {}),
        }),
      );
      const { setResponseHeader } = await import("@tanstack/react-start/server");
      const { serializeCookie } = await import("@/lib/auth/cookies.server");
      setResponseHeader(
        "Set-Cookie",
        serializeCookie(`obra_google_connect_${profile.id}_${website.environment}`, operationId, {
          path: "/",
          maxAge: 900,
        }),
      );
      return result;
    } catch (error) {
      return throwGoogleConnectOpenFailure(error);
    }
  });

export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(async ({ data }) => {
    const context = await providerOwnerContext(data.websiteId);
    const { assertNoOtherActiveProWebsiteNeedsSharedProviders, sharedProviderDisconnectEnabled } =
      await import("@/lib/provider-authorization.server");
    if (!sharedProviderDisconnectEnabled())
      throw new Error("Shared Google Calendar disconnect is disabled");
    await assertNoOtherActiveProWebsiteNeedsSharedProviders(context);
    const { profile, website, authUserId: actorAuthUserId, supabaseAdmin } = context;
    const environment = website.environment as "test" | "live";
    const deadlineAt = Date.now() + 25_000;
    const { data: connection, error } = await supabaseAdmin
      .from("calendar_connections")
      .select("connection_revision,pipedream_account_id,setup_account_id,setup_completed_at")
      .eq("profile_id", profile.id)
      .eq("environment", environment)
      .abortSignal(AbortSignal.timeout(5_000))
      .maybeSingle();
    if (error || !connection) throw new Error("Google calendar connection not found");
    const { googleCalendarLifetimeRpc } = await import("@/lib/google-calendar-state.server");
    const disconnectId = await googleCalendarLifetimeRpc<string>(
      "reserve_booking_provider_account_disconnect_v3",
      {
        p_profile_id: profile.id,
        p_environment: environment,
        p_provider_account_id:
          connection.pipedream_account_id ??
          (connection.setup_completed_at ? null : connection.setup_account_id),
        p_actor_auth_user_id: actorAuthUserId,
        p_expected_connection_revision: connection.connection_revision,
      },
      deadlineAt - 3_000,
    );
    if (!disconnectId) throw new Error("Google Calendar is already disconnected");
    const { resumeGoogleCalendarDisconnect } =
      await import("@/lib/pipedream-trigger-reconciliation.server");
    const result = await resumeGoogleCalendarDisconnect({ environment, deadlineAt, disconnectId });
    // The durable intent has already stopped new work even if a different worker owns DELETE.
    return { disconnected: true, pending: !result.disconnected };
  });

export const refreshGoogleCalendarConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(async ({ data }) => {
    const { profile, website, authUserId } = await providerOwnerContext(data.websiteId);
    const deadlineAt = Date.now() + 25_000;
    const { googleCalendarLifetimeRpc } = await import("@/lib/google-calendar-state.server");
    await googleCalendarLifetimeRpc<boolean>(
      "request_google_calendar_verification",
      {
        p_profile_id: profile.id,
        p_environment: website.environment,
        p_actor_auth_user_id: authUserId,
      },
      deadlineAt - 3_000,
    );
    const { refreshSavedGoogleCalendar } =
      await import("@/lib/pipedream-trigger-reconciliation.server");
    return refreshSavedGoogleCalendar({
      profileId: profile.id,
      environment: website.environment as "test" | "live",
      allowRepair: true,
      deadlineAt,
      resumeSetup: true,
    });
  });

export const discoverGoogleCalendarAccounts = createServerFn({ method: "POST" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(async ({ data }) => {
    const { profile, website } = await providerMutationContext(data.websiteId);
    const { listGoogleAccounts, withPipedreamDeadline } = await import("@/lib/pipedream.server");
    const accounts = await withPipedreamDeadline(Date.now() + 20_000, () =>
      listGoogleAccounts(profile.id, website.environment as "test" | "live"),
    );
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name ?? "Google Calendar account",
        healthy: googleAccountIsHealthy(account),
      })),
    };
  });

export const loadGoogleCalendarConfiguration = createServerFn({ method: "GET" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(async ({ data }) => {
    const context = await providerOwnerContext(data.websiteId);
    const { profile, website, supabaseAdmin } = context;
    const environment = website.environment as "test" | "live";
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("calendar_connections")
      .select(
        "id,pipedream_account_id,connection_revision,account_email,account_display_name,health_state,reconnect_reason,verification_reason,last_verified_at",
      )
      .eq("profile_id", profile.id)
      .eq("environment", environment)
      .maybeSingle();
    if (connectionError) throw new Error("Unable to load Google calendar configuration");
    const [{ data: selections, error: selectionError }, { data: binding, error: bindingError }] =
      connection
        ? await Promise.all([
            supabaseAdmin
              .from("calendar_selections")
              .select("google_calendar_id,blocks_availability,receives_bookings")
              .eq("connection_id", connection.id)
              .eq("profile_id", profile.id)
              .eq("environment", environment)
              .eq("active", true),
            supabaseAdmin
              .from("pipedream_bindings")
              .select("trigger_state,last_health_at,reconciliation_due_at,reconciliation_attempts")
              .eq("connection_id", connection.id)
              .eq("profile_id", profile.id)
              .eq("environment", environment)
              .maybeSingle(),
          ])
        : [
            { data: null, error: null },
            { data: null, error: null },
          ];
    if (selectionError || bindingError)
      throw new Error("Unable to load Google calendar selections");
    const { hasCurrentActiveConfirmedPro, sharedProviderDisconnectEnabled } =
      await import("@/lib/provider-authorization.server");
    const { loadPendingGoogleCalendarSetup } = await import("@/lib/booking-readiness.server");
    const pendingSetup = await loadPendingGoogleCalendarSetup({
      profileId: profile.id,
      environment,
      connection,
    });
    return {
      accountId: connection?.pipedream_account_id ?? null,
      connectionRevision: connection?.connection_revision ?? null,
      pendingSetup,
      accountEmail: connection?.account_email ?? null,
      accountDisplayName: connection?.account_display_name ?? null,
      healthState: connection?.health_state ?? null,
      reconnectReason: connection?.reconnect_reason ?? null,
      verificationReason: connection?.verification_reason ?? null,
      lastVerifiedAt: connection?.last_verified_at ?? null,
      triggerState: binding?.trigger_state ?? null,
      triggerLastHealthAt: binding?.last_health_at ?? null,
      reconciliationDueAt: binding?.reconciliation_due_at ?? null,
      reconciliationAttempts: binding?.reconciliation_attempts ?? 0,
      blockingCalendarIds: (selections ?? [])
        .filter((selection) => selection.blocks_availability)
        .map((selection) => selection.google_calendar_id),
      destinationCalendarId:
        selections?.find((selection) => selection.receives_bookings)?.google_calendar_id ?? null,
      canConfigure: await hasCurrentActiveConfirmedPro(context),
      canDisconnectSharedProvider: Boolean(connection && sharedProviderDisconnectEnabled()),
    };
  });

function googleAccountIsHealthy(account: {
  healthy?: boolean | null;
  dead?: boolean | null;
  error?: string | null;
}) {
  return account.healthy === true && account.dead !== true && !account.error;
}

async function recordSavedGoogleCalendarReadFailure(input: {
  profileId: string;
  environment: "test" | "live";
  accountId: string;
  expectedRevision: number;
  deadlineAt: number;
  reason: "calendar_permissions_changed" | "provider_temporary_failure";
  calendars?: Array<{ id: string; accessRole: string }>;
  error?: unknown;
  blockingCalendarIds?: string[];
}) {
  if ("error" in input) {
    const { classifyPipedreamFailure, PipedreamRequestError } =
      await import("@/lib/pipedream.server");
    if (
      !(input.error instanceof PipedreamRequestError) ||
      input.error.layer !== "google" ||
      classifyPipedreamFailure(input.error) !== "permissions"
    )
      return;
  }
  const { withWorkerDeadline } = await import("@/lib/worker-deadline.server");
  await withWorkerDeadline(input.deadlineAt, async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: connection, error } = await supabaseAdmin
      .from("calendar_connections")
      .select("id")
      .eq("profile_id", input.profileId)
      .eq("environment", input.environment)
      .eq("pipedream_account_id", input.accountId)
      .eq("connection_revision", input.expectedRevision)
      .maybeSingle();
    if (error) throw new Error("Unable to check saved Google Calendar configuration");
    if (!connection) return;
    if (input.calendars || input.blockingCalendarIds) {
      const { data: selections, error: selectionError } = await supabaseAdmin
        .from("calendar_selections")
        .select("google_calendar_id,blocks_availability,receives_bookings")
        .eq("connection_id", connection.id)
        .eq("profile_id", input.profileId)
        .eq("environment", input.environment)
        .eq("active", true);
      if (selectionError) throw new Error("Unable to check saved Google calendar selections");
      if (input.blockingCalendarIds) {
        // A failed batch does not identify which calendar failed. Attribute it
        // only when every requested calendar belongs to the saved blocking set.
        if (
          !input.blockingCalendarIds.length ||
          !input.blockingCalendarIds.every((id) =>
            selections?.some(
              (selection) => selection.blocks_availability && selection.google_calendar_id === id,
            ),
          )
        )
          return;
      } else if (input.calendars) {
        const byId = new Map(input.calendars.map((calendar) => [calendar.id, calendar]));
        if (
          !(selections ?? []).some((selection) => {
            const calendar = byId.get(selection.google_calendar_id);
            return (
              !calendar ||
              (selection.blocks_availability &&
                !["freeBusyReader", "reader", "writer", "owner"].includes(calendar.accessRole)) ||
              (selection.receives_bookings && !["writer", "owner"].includes(calendar.accessRole))
            );
          })
        )
          return;
      }
    }
    // Candidate failures cannot poison another saved account/calendar. SQL checks
    // the original revision again if an owner reselects after the reads above.
    const { reconcileVerifiedGoogleCalendarConnection } =
      await import("@/lib/google-calendar-state.server");
    await reconcileVerifiedGoogleCalendarConnection({
      profileId: input.profileId,
      environment: input.environment,
      expectedRevision: input.expectedRevision,
      healthState: "degraded",
      reason: input.reason,
      verifiedAt: new Date().toISOString(),
    });
  });
}

async function persistVerifiedGoogleCalendarsForAccount(input: {
  profileId: string;
  environment: "test" | "live";
  account: { id: string; external_id?: string; name?: string | null };
  calendars: VerifiedGoogleCalendarSelection[];
  expectedRevision: number;
  expectedSetupKey?: string | null;
  deadlineAt: number;
  connectOperationId?: string;
}) {
  const { verifyGoogleCalendarFreeBusy, withPipedreamDeadline } =
    await import("@/lib/pipedream.server");
  const { randomUUID } = await import("node:crypto");
  const { reserveGoogleCalendarSetupProbe, runGoogleCalendarSetupProbe } =
    await import("@/lib/google-calendar-state.server");
  const blockingIds = input.calendars
    .filter((calendar) => calendar.blocksAvailability)
    .map((calendar) => calendar.id);
  const destination = input.calendars.find((calendar) => calendar.receivesBookings);
  if (!destination || !blockingIds.length)
    throw new Error("Select conflict calendars and a writable destination");
  for (let offset = 0; offset < blockingIds.length; offset += 50) {
    const calendarIds = blockingIds.slice(offset, offset + 50);
    await withPipedreamDeadline(input.deadlineAt - 3_000, () =>
      verifyGoogleCalendarFreeBusy({
        profileId: input.profileId,
        environment: input.environment,
        accountId: input.account.id,
        calendarIds,
      }),
    ).catch(async (error: unknown) => {
      await recordSavedGoogleCalendarReadFailure({
        profileId: input.profileId,
        environment: input.environment,
        accountId: input.account.id,
        expectedRevision: input.expectedRevision,
        deadlineAt: input.deadlineAt,
        reason: "calendar_permissions_changed",
        blockingCalendarIds: calendarIds,
        error,
      });
      throw error;
    });
  }
  const readVerifiedAt = new Date().toISOString();
  const leaseToken = randomUUID();
  const { googleAccountEmail } = await import("@/lib/google-calendar-complete");
  const probe = await reserveGoogleCalendarSetupProbe({
    profileId: input.profileId,
    environment: input.environment,
    accountId: input.account.id,
    calendarId: destination.id,
    expectedRevision: input.expectedRevision,
    expectedSetupKey: input.expectedSetupKey,
    leaseToken,
    deadlineAt: input.deadlineAt,
    calendars: input.calendars,
    readVerifiedAt,
    accountEmail: googleAccountEmail(input.account),
    accountDisplayName: input.account.name ?? null,
    connectOperationId: input.connectOperationId,
  });
  const capability = await runGoogleCalendarSetupProbe({
    probe,
    leaseToken,
    deadlineAt: input.deadlineAt,
  });
  if (!capability.persisted)
    throw new Error("Google Calendar setup is saved and will finish in the background");
}

const calendarDiscoveryInput = websiteInput.extend({
  accountId: z.string().regex(/^apn_[A-Za-z0-9_-]+$/),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expectedSetupKey: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
});

export const discoverGoogleCalendars = createServerFn({ method: "POST" })
  .validator((input: unknown) => calendarDiscoveryInput.parse(input))
  .handler(async ({ data }) => {
    const { profile, website } = await providerMutationContext(data.websiteId);
    const { listGoogleAccounts, listGoogleCalendars, withPipedreamDeadline } =
      await import("@/lib/pipedream.server");
    const environment = website.environment as "test" | "live";
    const deadlineAt = Date.now() + 20_000;
    await authorizeSetupRead({
      profileId: profile.id,
      environment,
      accountId: data.accountId,
      expectedRevision: data.expectedRevision,
      expectedSetupKey: data.expectedSetupKey,
      deadlineAt,
    });
    return withPipedreamDeadline(deadlineAt, async () => {
      const accounts = await listGoogleAccounts(profile.id, environment);
      const account = accounts.find(
        (candidate) => candidate.id === data.accountId && googleAccountIsHealthy(candidate),
      );
      if (!account) throw new Error("Select a healthy Google Calendar account");
      await authorizeSetupRead({
        profileId: profile.id,
        environment,
        accountId: account.id,
        expectedRevision: data.expectedRevision,
        expectedSetupKey: data.expectedSetupKey,
        deadlineAt,
      });
      return {
        account: { id: account.id, name: account.name ?? "Google Calendar account" },
        calendars: await listGoogleCalendars({
          profileId: profile.id,
          environment,
          accountId: account.id,
        }),
      };
    });
  });

const saveCalendarsInput = calendarDiscoveryInput.extend({
  blockingCalendarIds: z.array(z.string().min(1).max(1024)).min(1).max(250),
  destinationCalendarId: z.string().min(1).max(1024),
});

export const saveGoogleCalendarSelection = createServerFn({ method: "POST" })
  .validator((input: unknown) => saveCalendarsInput.parse(input))
  .handler(async ({ data }) => {
    const { profile, website } = await providerMutationContext(data.websiteId);
    const environment = website.environment as "test" | "live";
    const deadlineAt = Date.now() + 25_000;
    const evidenceScope = {
      profileId: profile.id,
      environment,
      accountId: data.accountId,
      expectedRevision: data.expectedRevision,
      deadlineAt,
    };
    await authorizeSetupRead({
      ...evidenceScope,
      expectedSetupKey: data.expectedSetupKey,
    });
    const {
      listGoogleAccounts,
      hasGoogleCalendarBookingScopes,
      listGoogleCalendars,
      withPipedreamDeadline,
    } = await import("@/lib/pipedream.server");
    const accounts = await withPipedreamDeadline(deadlineAt - 3_000, () =>
      listGoogleAccounts(profile.id, environment),
    );
    const account = accounts.find(
      (candidate) => candidate.id === data.accountId && googleAccountIsHealthy(candidate),
    );
    if (!account) throw new Error("The selected Google account is no longer healthy");
    if (!Array.isArray(account.authorized_scopes)) {
      await recordSavedGoogleCalendarReadFailure({
        ...evidenceScope,
        reason: "provider_temporary_failure",
      });
      throw new Error("Google Calendar permissions could not be verified. Try again shortly.");
    }
    if (!hasGoogleCalendarBookingScopes(account.authorized_scopes)) {
      await recordSavedGoogleCalendarReadFailure({
        ...evidenceScope,
        reason: "calendar_permissions_changed",
      });
      throw new Error(
        "Reconnect Google Calendar and allow access to list calendars, check availability, and create booking events.",
      );
    }
    await authorizeSetupRead({
      profileId: profile.id,
      environment,
      accountId: account.id,
      expectedRevision: data.expectedRevision,
      expectedSetupKey: data.expectedSetupKey,
      deadlineAt,
    });
    const discovered = await withPipedreamDeadline(deadlineAt - 3_000, () =>
      listGoogleCalendars({ profileId: profile.id, environment, accountId: account.id }),
    ).catch(async (error: unknown) => {
      await recordSavedGoogleCalendarReadFailure({
        ...evidenceScope,
        reason: "calendar_permissions_changed",
        error,
      });
      throw error;
    });
    await recordSavedGoogleCalendarReadFailure({
      ...evidenceScope,
      reason: "calendar_permissions_changed",
      calendars: discovered,
    });
    const byId = new Map(discovered.map((calendar) => [calendar.id, calendar]));
    const blockingIds = [...new Set(data.blockingCalendarIds)];
    const destination = byId.get(data.destinationCalendarId);
    if (!destination || !["writer", "owner"].includes(destination.accessRole))
      throw new Error("Select a calendar where Obra can create appointments");
    const calendars = [...new Set([...blockingIds, destination.id])].map((id) => {
      const calendar = byId.get(id);
      if (!calendar) throw new Error("A selected calendar is no longer available");
      return {
        id,
        displayName: calendar.summary,
        accessRole: calendar.accessRole,
        timeZone: calendar.timeZone,
        blocksAvailability: blockingIds.includes(id),
        receivesBookings: id === destination.id,
      };
    });
    await persistVerifiedGoogleCalendarsForAccount({
      profileId: profile.id,
      environment,
      account,
      calendars,
      expectedRevision: data.expectedRevision,
      expectedSetupKey: data.expectedSetupKey,
      deadlineAt,
    });
    return { saved: true, triggerPending: true };
  });

async function verifySavedTrigger(input: {
  profileId: string;
  environment: "test" | "live";
  deadlineAt: number;
}) {
  const { refreshSavedGoogleCalendar } =
    await import("@/lib/pipedream-trigger-reconciliation.server");
  await refreshSavedGoogleCalendar({ ...input, allowRepair: true });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: binding, error } = await supabaseAdmin
    .from("pipedream_bindings")
    .select("trigger_state,last_health_at")
    .eq("profile_id", input.profileId)
    .eq("environment", input.environment)
    .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(5_000, input.deadlineAt - Date.now()))))
    .maybeSingle();
  if (
    error ||
    binding?.trigger_state !== "active" ||
    !binding.last_health_at ||
    Date.parse(binding.last_health_at) < Date.now() - 15 * 60_000
  )
    throw new Error("Google calendars are saved; monitoring repair is pending");
  return { active: true };
}

export const configureGoogleCalendarTrigger = createServerFn({ method: "POST" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(async ({ data }) => {
    const { profile, website } = await providerMutationContext(data.websiteId);
    return verifySavedTrigger({
      profileId: profile.id,
      environment: website.environment as "test" | "live",
      deadlineAt: Date.now() + 25_000,
    });
  });

export const completeGoogleCalendarConnection = createServerFn({ method: "POST" })
  .validator((input: unknown) => websiteInput.parse(input))
  .handler(async ({ data }) => {
    const { profile, website, supabaseAdmin, authUserId } = await providerMutationContext(
      data.websiteId,
    );
    const environment = website.environment as "test" | "live";
    const deadlineAt = Date.now() + 25_000;
    const { googleAccountEmail, pickGoogleAccountForCompletion, pickWritableBookingCalendar } =
      await import("@/lib/google-calendar-complete");
    const {
      listGoogleAccounts,
      hasGoogleCalendarBookingScopes,
      listGoogleCalendars,
      withPipedreamDeadline,
    } = await import("@/lib/pipedream.server");
    const { getCookie } = await import("@/lib/auth/cookies.server");
    const operationId = getCookie(`obra_google_connect_${profile.id}_${environment}`);
    if (!operationId || !z.string().uuid().safeParse(operationId).success)
      throw new Error("Start Google Connect before completing setup");
    const { googleCalendarLifetimeRpc } = await import("@/lib/google-calendar-state.server");
    const current = await googleCalendarLifetimeRpc<{
      id: string;
      pipedream_account_id: string | null;
      connection_revision: number;
      verification_reason: string | null;
      disconnected_at: string | null;
      connect_completed_at: string | null;
      connect_expected_setup_key: string | null;
      connect_started_at: string;
      setup_account_id: string | null;
      setup_calendar_id: string | null;
      setup_calendars: unknown;
    }>(
      "authorize_google_calendar_connect_completion",
      {
        p_profile_id: profile.id,
        p_environment: environment,
        p_actor_auth_user_id: authUserId,
        p_operation_id: operationId,
      },
      deadlineAt - 3_000,
    );
    if (current.connect_completed_at) {
      await verifySavedTrigger({ profileId: profile.id, environment, deadlineAt });
      return { completed: true };
    }
    let accounts = await withPipedreamDeadline(deadlineAt - 3_000, () =>
      listGoogleAccounts(profile.id, environment),
    );
    for (
      let attempt = 0;
      !accounts.length && attempt < 4 && Date.now() + 4_000 < deadlineAt;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      accounts = await withPipedreamDeadline(deadlineAt - 3_000, () =>
        listGoogleAccounts(profile.id, environment),
      );
    }
    const capturedAccountId = current.connect_expected_setup_key
      ? current.setup_account_id
      : current.pipedream_account_id;
    // A different recently issued (or undated) identity cannot be attributed to
    // this browser by inventory order. Require an explicit account/calendar save.
    if (
      capturedAccountId &&
      accounts.some(
        (account) =>
          account.id !== capturedAccountId &&
          (!account.created_at ||
            Date.parse(account.created_at) + 1_000 >= Date.parse(current.connect_started_at)),
      )
    )
      throw new Error(
        "Google account selection needs review. Explicitly select the account and its calendars before saving.",
      );
    const accountId =
      capturedAccountId ??
      pickGoogleAccountForCompletion({
        accounts: accounts.map((account) => ({
          id: account.id,
          healthy: googleAccountIsHealthy(account),
          createdAt: account.created_at,
        })),
      })?.id;
    const account = accounts.find((candidate) => candidate.id === accountId);
    if (!account || !googleAccountIsHealthy(account))
      throw new Error("Google Calendar did not finish connecting. Try connecting again.");
    if (
      current?.verification_reason === "contractor_disconnected" &&
      (!current.disconnected_at ||
        !account.created_at ||
        !Number.isFinite(Date.parse(account.created_at)) ||
        Date.parse(account.created_at) < Date.parse(current.disconnected_at))
    )
      throw new Error(
        "Connect a new Google account identity after disconnecting; retained accounts are not selected automatically",
      );
    const evidenceScope = {
      profileId: profile.id,
      environment,
      accountId: account.id,
      expectedRevision: current.connection_revision,
      deadlineAt,
    };
    if (!Array.isArray(account.authorized_scopes)) {
      await recordSavedGoogleCalendarReadFailure({
        ...evidenceScope,
        reason: "provider_temporary_failure",
      });
      throw new Error("Google Calendar permissions could not be verified. Try again shortly.");
    }
    if (!hasGoogleCalendarBookingScopes(account.authorized_scopes)) {
      await recordSavedGoogleCalendarReadFailure({
        ...evidenceScope,
        reason: "calendar_permissions_changed",
      });
      throw new Error(
        "Reconnect Google Calendar and allow access to list calendars, check availability, and create booking events.",
      );
    }
    const accountEmail = googleAccountEmail(account);
    if (!accountEmail)
      throw new Error("Google did not return an account email. Connect Google Calendar again.");
    await authorizeSetupRead({
      profileId: profile.id,
      environment,
      accountId: account.id,
      expectedRevision: current.connection_revision,
      expectedSetupKey: current.connect_expected_setup_key,
      deadlineAt,
    });
    const { data: selections, error: selectionError } = current
      ? await supabaseAdmin
          .from("calendar_selections")
          .select("google_calendar_id,blocks_availability,receives_bookings")
          .eq("connection_id", current.id)
          .eq("profile_id", profile.id)
          .eq("environment", environment)
          .eq("active", true)
          .abortSignal(AbortSignal.timeout(Math.max(1, Math.min(5_000, deadlineAt - Date.now()))))
      : { data: null, error: null };
    if (selectionError) throw new Error("Unable to read saved Google calendars");
    if (
      account.id === current?.pipedream_account_id &&
      selections?.some((selection) => selection.receives_bookings) &&
      selections.some((selection) => selection.blocks_availability)
    ) {
      // OAuth completion is not permission to shrink an existing multi-calendar choice.
      await googleCalendarLifetimeRpc<boolean>(
        "request_google_calendar_verification",
        {
          p_profile_id: profile.id,
          p_environment: environment,
          p_actor_auth_user_id: authUserId,
        },
        deadlineAt - 3_000,
      );
    }
    const discovered = await withPipedreamDeadline(deadlineAt - 3_000, () =>
      listGoogleCalendars({ profileId: profile.id, environment, accountId: account.id }),
    ).catch(async (error: unknown) => {
      await recordSavedGoogleCalendarReadFailure({
        ...evidenceScope,
        reason: "calendar_permissions_changed",
        error,
      });
      throw error;
    });
    await recordSavedGoogleCalendarReadFailure({
      ...evidenceScope,
      reason: "calendar_permissions_changed",
      calendars: discovered,
    });
    let choices: Array<{ id: string; blocksAvailability: boolean; receivesBookings: boolean }>;
    if (current.connect_expected_setup_key) {
      const pending = z
        .array(
          z.object({
            id: z.string().min(1),
            blocksAvailability: z.boolean(),
            receivesBookings: z.boolean(),
          }),
        )
        .min(1)
        .safeParse(current.setup_calendars);
      if (
        !pending.success ||
        account.id !== current.setup_account_id ||
        pending.data.filter((item) => item.receivesBookings).length !== 1 ||
        pending.data.find((item) => item.receivesBookings)?.id !== current.setup_calendar_id ||
        !pending.data.some((item) => item.blocksAvailability)
      )
        throw new Error("Google setup choices changed. Review your calendars before saving.");
      choices = pending.data;
    } else if (
      current.pipedream_account_id ||
      selections?.length ||
      current.verification_reason === "contractor_disconnected"
    ) {
      if (
        account.id !== current.pipedream_account_id ||
        !selections?.some((item) => item.blocks_availability) ||
        selections.filter((item) => item.receives_bookings).length !== 1
      )
        throw new Error(
          "Review and explicitly select calendars for this Google account before saving.",
        );
      choices = selections.map((item) => ({
        id: item.google_calendar_id,
        blocksAvailability: item.blocks_availability,
        receivesBookings: item.receives_bookings,
      }));
    } else {
      const destination = pickWritableBookingCalendar({
        calendars: discovered,
        sameAccount: false,
        accountEmail,
      });
      if (!destination) throw new Error("Select a calendar where Obra can create appointments");
      choices = [{ id: destination.id, blocksAvailability: true, receivesBookings: true }];
    }
    const selected = choices.map((choice) => {
      const calendar = discovered.find((item) => item.id === choice.id);
      if (
        !calendar ||
        !["freeBusyReader", "reader", "writer", "owner"].includes(calendar.accessRole) ||
        (choice.receivesBookings && !["writer", "owner"].includes(calendar.accessRole))
      )
        throw new Error("Restore access to your chosen Google calendars or review selections");
      return {
        ...choice,
        displayName: calendar.summary,
        accessRole: calendar.accessRole,
        timeZone: calendar.timeZone,
      };
    });
    await persistVerifiedGoogleCalendarsForAccount({
      profileId: profile.id,
      environment,
      account,
      calendars: selected,
      expectedRevision: current?.connection_revision ?? 0,
      expectedSetupKey: current.connect_expected_setup_key,
      deadlineAt,
      connectOperationId: operationId,
    });
    await verifySavedTrigger({ profileId: profile.id, environment, deadlineAt });
    // Retained accounts/epochs remain available to their original paid obligations.
    return { completed: true };
  });
