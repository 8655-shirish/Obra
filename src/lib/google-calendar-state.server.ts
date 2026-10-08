import { rpcNullable } from "@/lib/rpc-nullable";

export type GoogleCalendarEnvironment = "test" | "live";

export type GoogleCalendarVerificationReason =
  | "provider_account_unhealthy"
  | "provider_account_missing"
  | "provider_temporary_failure"
  | "provider_platform_error"
  | "provider_configuration_error"
  | "provider_reauthorization_required"
  | "calendar_permissions_changed"
  | "calendar_selection_invalid"
  | "calendar_write_blocked"
  | "verification_stale";

export type GoogleCalendarBinding = {
  id: string;
  profile_id: string;
  environment: GoogleCalendarEnvironment;
  connection_id: string;
  pipedream_account_id: string;
  configuration_revision: number;
  component_key: string;
  component_version: string;
  deployed_trigger_id: string | null;
  webhook_id: string | null;
  webhook_correlation_id: string;
  trigger_state: string;
  selected_calendar_ids: string[];
  reconciliation_fencing_token: number;
  reconciliation_lease_expires_at: string;
  deployment_operation_id: string | null;
  deployment_candidate_trigger_id: string | null;
  deployment_dispatched_at: string | null;
  deployment_receipt: {
    trigger_id: string;
    component_id: string;
    component_key: string;
    component_version: string;
    operation_id: string;
  } | null;
  retired_deployment: {
    operation_id: string;
    lease_token: string;
    fencing_token: number;
    account_id: string;
    calendar_ids: string[];
    component_key: string;
    component_version: string;
  } | null;
  retired_trigger_ids: string[];
  pending_trigger_deletions: string[];
};

export type SavedGoogleCalendarClaim = {
  connection: {
    id: string;
    profile_id: string;
    environment: GoogleCalendarEnvironment;
    pipedream_account_id: string | null;
    connection_revision: number;
    verification_reason: string | null;
  };
  binding: GoogleCalendarBinding;
  selections: Array<{
    google_calendar_id: string;
    blocks_availability: boolean;
    receives_bookings: boolean;
  }>;
  cleanup_only: boolean;
};

export type GoogleCalendarSetupProbe = {
  id: string;
  profile_id: string;
  environment: GoogleCalendarEnvironment;
  account_id: string;
  calendar_id: string;
  connection_revision: number;
  fencing_token: number;
  lease_expires_at: string;
  calendars: VerifiedGoogleCalendarSelection[];
  read_verified_at: string | null;
  write_verified_at: string | null;
  purpose: "configuration" | "write_recovery";
  probe_id: string;
  probe_account_id: string;
  probe_calendar_id: string;
  probe_state: "pending" | "insert_dispatched" | "present" | "delete_dispatched" | "absent";
  probe_started_at: string | null;
  probe_write_verified_at: string | null;
  configuration_current: boolean;
  cleanup_only: boolean;
  recovery: boolean;
};

export type GoogleCalendarDisconnectClaim = {
  id: string;
  profile_id: string;
  environment: GoogleCalendarEnvironment;
  provider_account_id: string;
  fencing_token: number;
  lease_expires_at: string;
  state: "pending" | "completed";
};

export class GoogleCalendarStateError extends Error {
  constructor() {
    super("Google Calendar state could not be settled; maintenance will retry");
    this.name = "GoogleCalendarStateError";
  }
}

class GoogleCalendarSetupPermissionsError extends Error {}

type LifetimeRpcName =
  | "claim_saved_google_calendar_verification"
  | "claim_due_pipedream_bindings"
  | "mark_google_calendar_connection_verified"
  | "mark_google_calendar_connection_unhealthy"
  | "fail_pipedream_binding_reconciliation"
  | "reserve_pipedream_trigger_deployment"
  | "begin_pipedream_trigger_deployment_effect"
  | "record_pipedream_trigger_deployment_result"
  | "adopt_pipedream_trigger_candidate"
  | "retire_pipedream_trigger"
  | "authorize_pipedream_trigger_cleanup"
  | "complete_pipedream_stale_trigger_cleanup"
  | "settle_pipedream_binding_cleanup"
  | "apply_pipedream_trigger_projection"
  | "reserve_google_calendar_setup_probe"
  | "authorize_google_calendar_setup_read"
  | "authorize_google_calendar_connect_start"
  | "authorize_google_calendar_connect_completion"
  | "request_google_calendar_verification"
  | "claim_google_calendar_setup_probe"
  | "authorize_google_calendar_setup_effect"
  | "settle_google_calendar_setup_probe"
  | "record_google_calendar_setup_read"
  | "restart_google_calendar_setup_probe"
  | "persist_google_calendar_configuration"
  | "reserve_booking_provider_account_disconnect_v3"
  | "claim_booking_provider_account_disconnect_v3"
  | "begin_booking_provider_account_disconnect_v3"
  | "fail_booking_provider_account_disconnect_v3"
  | "complete_booking_provider_account_disconnect_v3";

// These casts are confined to the forward migration's RPCs until type regeneration.
// An aborted/indeterminate claim must never be followed by a provider mutation.
export async function googleCalendarLifetimeRpc<T>(
  name: LifetimeRpcName,
  args: Record<string, unknown>,
  deadlineAt: number,
  options?: { revealOwnerFailure?: boolean },
): Promise<T> {
  const remaining = Math.floor(deadlineAt - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new GoogleCalendarStateError();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // Owner connect-start is a redirect, not worker settlement. Abort uses the
  // remaining deadline (caller already reserved Pipedream's request timeout).
  // Workers keep the 5s settlement cap. SQL copy may be revealed. Only
  // AbortError/TimeoutError stay collapsed; other throws are owner-visible so
  // a 503 transport failure is not painted as worker settlement.
  let ownerFailure: string | null = null;
  try {
    const budget = Math.floor(deadlineAt - Date.now());
    if (budget <= 0) throw new GoogleCalendarStateError();
    const { data, error } = await supabaseAdmin
      .rpc(name as never, args as never)
      .abortSignal(
        AbortSignal.timeout(
          Math.max(1, options?.revealOwnerFailure ? budget : Math.min(budget, 5_000)),
        ),
      );
    if (error) {
      const message = typeof error.message === "string" ? error.message.trim() : "";
      if (options?.revealOwnerFailure && message) ownerFailure = message;
      else throw new GoogleCalendarStateError();
    } else {
      return data as T;
    }
  } catch (error) {
    if (
      options?.revealOwnerFailure &&
      error instanceof Error &&
      error.message.trim() &&
      error.name !== "AbortError" &&
      error.name !== "TimeoutError" &&
      !(error instanceof GoogleCalendarStateError)
    )
      throw error;
    throw new GoogleCalendarStateError();
  }
  if (!ownerFailure) throw new GoogleCalendarStateError();
  throw new Error(ownerFailure);
}

export function requireGoogleCalendarSettlement(value: unknown): void {
  if (!value) throw new GoogleCalendarStateError();
}

export type VerifiedGoogleCalendarSelection = {
  id: string;
  displayName: string;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  timeZone?: string | null;
  blocksAvailability: boolean;
  receivesBookings: boolean;
};

async function contractorActorId() {
  const { getContractorAuthUserId } = await import("@/lib/auth/contractor-session.server");
  const actorAuthUserId = await getContractorAuthUserId();
  if (!actorAuthUserId) throw new Error("Unauthorized");
  return actorAuthUserId;
}

/** Persists only normalized evidence produced by a separately verified provider adapter. */
export async function persistVerifiedGoogleCalendarConfiguration(input: {
  probe: GoogleCalendarSetupProbe;
  leaseToken: string;
  deadlineAt: number;
}) {
  const data = await googleCalendarLifetimeRpc<SavedGoogleCalendarClaim["connection"]>(
    "persist_google_calendar_configuration",
    {
      p_profile_id: input.probe.profile_id,
      p_environment: input.probe.environment,
      p_setup_operation_id: input.probe.id,
      p_lease_token: input.leaseToken,
      p_fencing_token: input.probe.fencing_token,
    },
    input.deadlineAt,
  );
  requireGoogleCalendarSettlement(data);
  return data;
}

export async function reconcileVerifiedGoogleCalendarConnection(input: {
  profileId: string;
  environment: "test" | "live";
  expectedRevision: number;
  healthState: "degraded" | "disconnected";
  reason: GoogleCalendarVerificationReason | null;
  verifiedAt: string;
}) {
  const actorAuthUserId = await contractorActorId();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("reconcile_google_calendar_connection", {
    p_profile_id: input.profileId,
    p_environment: input.environment,
    p_actor_auth_user_id: actorAuthUserId,
    p_expected_revision: input.expectedRevision,
    p_health_state: input.healthState,
    p_reason: rpcNullable(input.reason),
    p_verified_at: input.verifiedAt,
  });
  if (error || !data) throw new Error("Unable to reconcile Google Calendar connection");
  return data;
}

export async function clearGoogleCalendarConnection(input: {
  profileId: string;
  environment: "test" | "live";
  expectedRevision: number;
}) {
  const actorAuthUserId = await contractorActorId();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("clear_google_calendar_connection", {
    p_profile_id: input.profileId,
    p_environment: input.environment,
    p_actor_auth_user_id: actorAuthUserId,
    p_expected_revision: input.expectedRevision,
  });
  if (error || !data) throw new Error("Unable to disconnect Google Calendar");
  return data;
}

/** Only an owner setup (or recovery of that exact operation) creates a capability probe. */
export async function reserveGoogleCalendarSetupProbe(input: {
  profileId: string;
  environment: GoogleCalendarEnvironment;
  accountId: string;
  calendarId: string;
  expectedRevision: number;
  expectedSetupKey?: string | null;
  leaseToken: string;
  deadlineAt: number;
  calendars: VerifiedGoogleCalendarSelection[];
  readVerifiedAt: string;
  accountEmail?: string | null;
  accountDisplayName?: string | null;
  connectOperationId?: string;
}) {
  const actorAuthUserId = await contractorActorId();
  const probe = await googleCalendarLifetimeRpc<GoogleCalendarSetupProbe>(
    "reserve_google_calendar_setup_probe",
    {
      p_profile_id: input.profileId,
      p_environment: input.environment,
      p_actor_auth_user_id: actorAuthUserId,
      p_account_id: input.accountId,
      p_calendar_id: input.calendarId,
      p_expected_revision: input.expectedRevision,
      p_expected_setup_key: input.expectedSetupKey ?? null,
      p_lease_token: input.leaseToken,
      p_calendars: input.calendars,
      p_read_verified_at: input.readVerifiedAt,
      p_account_email: input.accountEmail ?? null,
      p_account_display_name: input.accountDisplayName ?? null,
      p_connect_operation_id: input.connectOperationId ?? null,
    },
    input.deadlineAt,
  );
  requireGoogleCalendarSettlement(probe);
  return probe;
}

export async function runGoogleCalendarSetupProbe(input: {
  probe: GoogleCalendarSetupProbe;
  leaseToken: string;
  deadlineAt: number;
}) {
  let { probe } = input;
  const { leaseToken, deadlineAt } = input;
  const providerDeadline = Math.min(deadlineAt - 3_000, Date.parse(probe.lease_expires_at) - 3_000);
  const {
    withPipedreamDeadline,
    classifyPipedreamFailure,
    proxyGoogleCalendar,
    PipedreamRequestError,
    listGoogleAccounts,
    listGoogleCalendars,
    hasGoogleCalendarBookingScopes,
    verifyGoogleCalendarFreeBusy,
    verifyGoogleCalendarEventAccess,
    isGoogleCalendarOneOffEvent,
  } = await import("@/lib/pipedream.server");
  const fence = {
    p_profile_id: probe.profile_id,
    p_environment: probe.environment,
    p_operation_id: probe.id,
    p_lease_token: leaseToken,
    p_fencing_token: probe.fencing_token,
  };
  const authorize = async (action: "read" | "insert" | "delete") =>
    requireGoogleCalendarSettlement(
      await googleCalendarLifetimeRpc<boolean>(
        "authorize_google_calendar_setup_effect",
        { ...fence, p_action: action },
        providerDeadline,
      ),
    );
  const settle = async (state: "pending" | "present" | "absent", writeVerified = false) => {
    probe = await googleCalendarLifetimeRpc<GoogleCalendarSetupProbe>(
      "settle_google_calendar_setup_probe",
      {
        ...fence,
        p_success: true,
        p_write_verified: writeVerified,
        p_reason: null,
        p_probe_state: state,
      },
      deadlineAt,
    );
    requireGoogleCalendarSettlement(probe);
  };
  const provider = <T>(work: () => Promise<T>) => withPipedreamDeadline(providerDeadline, work);
  let observedState: "pending" | "present" | "absent" | null = null;
  let deniedAction: "insert" | "delete" | null = null;
  let failureObservedAt: string | null = null;
  try {
    // At most one superseded cleanup and one current probe per invocation.
    for (let pass = 0; pass < 2; pass++) {
      // Read evidence may expire between the browser and the worker. Refresh exactly
      // the stored owner choices, never today's primary/default calendar.
      if (
        !probe.cleanup_only &&
        (!probe.read_verified_at || Date.parse(probe.read_verified_at) < Date.now() - 60_000)
      ) {
        await authorize("read");
        const account = (
          await provider(() => listGoogleAccounts(probe.profile_id, probe.environment))
        ).find((item) => item.id === probe.account_id);
        if (
          !account ||
          !account.healthy ||
          account.dead ||
          account.error ||
          !Array.isArray(account.authorized_scopes)
        )
          throw new Error("Google setup account health could not be verified");
        if (!hasGoogleCalendarBookingScopes(account.authorized_scopes))
          throw new GoogleCalendarSetupPermissionsError(
            "Google setup requires the selected calendar scopes",
          );
        const calendars = await provider(() =>
          listGoogleCalendars({
            profileId: probe.profile_id,
            environment: probe.environment,
            accountId: probe.account_id,
          }),
        );
        const verified = probe.calendars.map((selection) => {
          const calendar = calendars.find((item) => item.id === selection.id);
          if (
            !calendar ||
            (selection.receivesBookings && !["writer", "owner"].includes(calendar.accessRole))
          )
            throw new GoogleCalendarSetupPermissionsError(
              "Google setup calendar permissions need attention",
            );
          return { ...selection, accessRole: calendar.accessRole };
        });
        const ids = verified.filter((item) => item.blocksAvailability).map((item) => item.id);
        for (let offset = 0; offset < ids.length; offset += 50)
          await provider(() =>
            verifyGoogleCalendarFreeBusy({
              profileId: probe.profile_id,
              environment: probe.environment,
              accountId: probe.account_id,
              calendarIds: ids.slice(offset, offset + 50),
            }),
          );
        requireGoogleCalendarSettlement(
          await googleCalendarLifetimeRpc<boolean>(
            "record_google_calendar_setup_read",
            {
              ...fence,
              p_calendars: verified,
              p_verified_at: new Date().toISOString(),
            },
            deadlineAt,
          ),
        );
      }
      const eventId = `0b${probe.probe_id.replaceAll("-", "")}`;
      const context = {
        profileId: probe.profile_id,
        environment: probe.environment,
        accountId: probe.probe_account_id,
      };
      const target = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(probe.probe_calendar_id)}/events/${eventId}`,
      );
      let event: Record<string, unknown> | null = null;
      let tombstone = false;
      await authorize("read");
      if (probe.probe_state !== "absent") {
        try {
          event = (await provider(() =>
            proxyGoogleCalendar({
              ...context,
              target,
              operation: "Google Calendar event lookup via Pipedream",
            }),
          )) as Record<string, unknown>;
          if (!event || typeof event !== "object" || Array.isArray(event))
            throw new Error("Google returned invalid setup event evidence");
          tombstone = event.id === eventId && event.status === "cancelled";
        } catch (error) {
          if (
            !(error instanceof PipedreamRequestError) ||
            error.layer !== "google" ||
            ![404, 410].includes(error.status) ||
            (error.reason !== null && error.reason !== "notFound" && error.reason !== "deleted")
          )
            throw error;
          // Google's 404 can mean an inaccessible calendar. Exact current calendar
          // access is required before absence may release a possibly sent effect.
          if (error.status === 404) {
            await provider(() =>
              verifyGoogleCalendarEventAccess({ ...context, calendarId: probe.probe_calendar_id }),
            );
          } else tombstone = true;
        }
      }
      if (tombstone || (!event && probe.probe_state === "delete_dispatched")) {
        await settle("absent", !probe.cleanup_only && probe.write_verified_at !== null);
      } else if (!event && probe.cleanup_only) {
        if (probe.probe_state === "insert_dispatched")
          throw new Error("Google setup INSERT outcome is still unknown");
        await settle("absent");
      } else if (!event && probe.probe_state !== "absent") {
        const firstDispatch = probe.probe_state === "pending";
        await authorize("insert");
        probe.probe_state = "insert_dispatched";
        const insertTarget = new URL(target.toString().slice(0, -eventId.length - 1));
        insertTarget.searchParams.set("sendUpdates", "none");
        try {
          event = (await provider(() =>
            proxyGoogleCalendar({
              ...context,
              target: insertTarget,
              method: "POST",
              attempts: 1,
              operation: "Google Calendar write verification via Pipedream",
              body: {
                id: eventId,
                summary: "Obra permission verification",
                description: "Temporary event created and removed automatically.",
                visibility: "private",
                transparency: "transparent",
                reminders: { useDefault: false },
                start: { dateTime: "2000-01-01T00:00:00.000Z" },
                end: { dateTime: "2000-01-01T00:01:00.000Z" },
                extendedProperties: {
                  private: {
                    obraVerification: "true",
                    obraVerificationOperationId: probe.probe_id,
                  },
                },
              },
            }),
          )) as Record<string, unknown>;
        } catch (error) {
          if (
            error instanceof PipedreamRequestError &&
            error.layer === "google" &&
            classifyPipedreamFailure(error) === "permissions"
          ) {
            deniedAction = "insert";
            failureObservedAt = new Date().toISOString();
          }
          if (
            firstDispatch &&
            ((error instanceof PipedreamRequestError &&
              error.layer === "google" &&
              [400, 401, 403, 404, 422, 429].includes(error.status)) ||
              (error instanceof Error &&
                "layer" in error &&
                error.layer === "machine" &&
                "operation" in error &&
                error.operation === "Pipedream authentication"))
          )
            observedState = "pending";
          throw error;
        }
      }
      if (event && !tombstone) {
        const properties = event.extendedProperties as
          { private?: Record<string, unknown> } | undefined;
        const start = event.start as { dateTime?: string; date?: string } | undefined;
        const end = event.end as { dateTime?: string; date?: string } | undefined;
        const reminders = event.reminders as
          { useDefault?: boolean; overrides?: unknown[] } | undefined;
        if (
          event.id !== eventId ||
          !isGoogleCalendarOneOffEvent(event) ||
          properties?.private?.obraVerificationOperationId !== probe.probe_id ||
          properties?.private?.obraVerification !== "true" ||
          event.visibility !== "private" ||
          event.transparency !== "transparent" ||
          event.summary !== "Obra permission verification" ||
          event.description !== "Temporary event created and removed automatically." ||
          (event.status !== undefined &&
            !["confirmed", "tentative"].includes(event.status as string)) ||
          event.status === "cancelled" ||
          event.attendeesOmitted === true ||
          (event.attendees !== undefined &&
            (!Array.isArray(event.attendees) || event.attendees.length > 0)) ||
          start?.date !== undefined ||
          end?.date !== undefined ||
          Date.parse(start?.dateTime ?? "") !== Date.parse("2000-01-01T00:00:00Z") ||
          Date.parse(end?.dateTime ?? "") !== Date.parse("2000-01-01T00:01:00Z") ||
          reminders?.useDefault !== false ||
          (reminders.overrides !== undefined &&
            (!Array.isArray(reminders.overrides) || reminders.overrides.length !== 0)) ||
          typeof event.etag !== "string" ||
          !event.etag ||
          event.etag === "*" ||
          /[\r\n]/.test(event.etag)
        )
          throw new PipedreamRequestError(
            409,
            "Google Calendar write verification via Pipedream",
            "event_conflict",
          );
        await settle("present", !probe.cleanup_only);
        await authorize("delete");
        probe.probe_state = "delete_dispatched";
        target.searchParams.set("sendUpdates", "none");
        try {
          await provider(() =>
            proxyGoogleCalendar({
              ...context,
              target,
              method: "DELETE",
              attempts: 1,
              ifMatch: event.etag as string,
              operation: "Google Calendar event deletion via Pipedream",
            }),
          );
        } catch (error) {
          if (
            error instanceof PipedreamRequestError &&
            error.layer === "google" &&
            classifyPipedreamFailure(error) === "permissions"
          ) {
            deniedAction = "delete";
            failureObservedAt = new Date().toISOString();
          }
          if (
            !(error instanceof PipedreamRequestError) ||
            error.layer !== "google" ||
            error.status !== 410 ||
            (error.reason !== null && error.reason !== "deleted")
          )
            throw error;
        }
        await settle("absent", !probe.cleanup_only);
      }
      if (probe.probe_state !== "absent")
        throw new Error("Google setup effect has not been resolved");
      if (probe.probe_state === "absent") {
        if (!probe.configuration_current) return { writeVerified: false, persisted: false };
        if (
          !probe.cleanup_only &&
          probe.write_verified_at &&
          probe.probe_write_verified_at &&
          Date.parse(probe.write_verified_at) >= Date.now() - 5 * 60_000
        ) {
          const connection = await persistVerifiedGoogleCalendarConfiguration({
            probe,
            leaseToken,
            deadlineAt,
          });
          return { writeVerified: true, persisted: true, connection };
        }
        // A tombstone is cleanup proof, not permission proof. Advance only after
        // that cleanup is durable, keeping the same owner-authorized operation.
        probe = await googleCalendarLifetimeRpc<GoogleCalendarSetupProbe>(
          "restart_google_calendar_setup_probe",
          fence,
          deadlineAt,
        );
        requireGoogleCalendarSettlement(probe);
      }
    }
    return { writeVerified: false, persisted: false };
  } catch (error) {
    if (error instanceof GoogleCalendarStateError) throw error;
    requireGoogleCalendarSettlement(
      await googleCalendarLifetimeRpc<GoogleCalendarSetupProbe>(
        "settle_google_calendar_setup_probe",
        {
          ...fence,
          p_success: false,
          p_write_verified: false,
          p_reason:
            error instanceof GoogleCalendarSetupPermissionsError
              ? "permissions"
              : classifyPipedreamFailure(error),
          p_probe_state: observedState,
          p_denied_action: deniedAction,
          p_failure_observed_at: failureObservedAt,
        },
        deadlineAt,
      ),
    );
    throw new Error("Google Calendar setup is pending; saved choices will resume automatically");
  }
}
