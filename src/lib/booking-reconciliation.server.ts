import { AsyncLocalStorage } from "node:async_hooks";

import { rpcNull } from "@/lib/rpc-nullable";
import { bookingWorker } from "@/integrations/supabase/booking-worker.server";
import { billingEnvironment, getStripe } from "@/lib/stripe.server";
import {
  bookingStripeFailure,
  BookingStripeConfigurationError,
} from "@/lib/booking-stripe-failure.server";
import {
  withWorkerDeadline,
  workerCanContinue,
  workerProviderContext,
  WorkerDeadlineError,
} from "@/lib/worker-deadline.server";
import {
  classifyPipedreamFailure,
  createGoogleBookingEvent,
  deleteGoogleBookingEvent,
  getGoogleBookingEvent,
  getGoogleCalendarBusyRanges,
  PipedreamRequestError,
  withPipedreamDeadline,
} from "@/lib/pipedream.server";

type BookingEnvironment = "test" | "live";
type CalendarState = "present" | "absent" | "conflict";
type CalendarAction = "create" | "delete" | "converged" | "manual_repair" | "retry";

type CalendarClaim = {
  link: {
    id: string;
    appointment_id: string;
    profile_id: string;
    environment: BookingEnvironment;
    google_event_id: string;
    desired_state: "present" | "absent";
    desired_generation: number;
    snapshot_appointment_version: number;
    reconcile_fencing_token: number;
  };
  appointment: {
    id: string;
    public_reference: string;
    start_at: string;
    end_at: string;
    time_zone: string;
    customer_snapshot: { email?: unknown };
    service_snapshot: { name?: unknown };
  };
  epoch: { id: string; pipedream_account_id: string; google_calendar_id: string };
};

type LatePaymentClaim = {
  arbitration: {
    id: string;
    profile_id: string;
    environment: BookingEnvironment;
    snapshot_generation: number;
    fencing_token: number;
  };
  appointment: { start_at: string; end_at: string };
  provider_context: {
    accountId: string;
    calendarIds: string[];
    rangeStart: string;
    rangeEnd: string;
  };
};

function providerStatus(error: unknown) {
  return error instanceof PipedreamRequestError ? error.status : null;
}

function retryableProviderError(error: unknown) {
  return classifyPipedreamFailure(error) !== "configuration";
}

class StaleSessionExpiryLeaseError extends Error {}
class BookingWorkerStoppedError extends Error {}

const SETTLEMENT_BUDGET_MS = 2_000;
const workerDeadline = new AsyncLocalStorage<number>();

function boundedRequest<T>(request: { abortSignal(signal: AbortSignal): PromiseLike<T> }) {
  const remaining = (workerDeadline.getStore() ?? Date.now() + 45_000) - Date.now();
  if (remaining <= 0) throw new BookingWorkerStoppedError();
  return request.abortSignal(AbortSignal.timeout(Math.ceil(remaining)));
}

function calendarFailure(error: unknown, write = false) {
  if (
    error instanceof ReferenceError ||
    error instanceof SyntaxError ||
    error instanceof RangeError ||
    error instanceof TypeError
  )
    throw error;
  const identityConflict =
    error instanceof PipedreamRequestError &&
    (error.reason === "event_conflict" || error.status === 412);
  const kind = identityConflict ? "configuration" : classifyPipedreamFailure(error);
  const writeDenied =
    kind === "permissions" &&
    write &&
    error instanceof PipedreamRequestError &&
    [
      "Google Calendar event creation via Pipedream",
      "Google Calendar event deletion via Pipedream",
    ].includes(error.operation) &&
    [
      "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      "insufficientPermissions",
      "insufficient_scope",
      "forbidden",
      "PERMISSION_DENIED",
    ].includes(error.reason ?? "");
  return {
    kind,
    code: identityConflict
      ? "calendar_identity_conflict"
      : writeDenied
        ? "calendar_write_blocked"
        : {
            temporary: "provider_temporary",
            platform: "provider_platform",
            reauthorization: "provider_reauthorization_required",
            permissions: "calendar_permissions_changed",
            configuration:
              error instanceof PipedreamRequestError &&
              error.operation.startsWith("Google Calendar")
                ? "calendar_event_invalid"
                : "provider_configuration_error",
          }[kind],
  };
}

class BookingWorkerRpcError extends Error {
  constructor(override readonly cause: unknown) {
    super("Booking worker RPC failed");
  }

  get recoverable() {
    if (!this.cause || typeof this.cause !== "object") return false;
    const code = (this.cause as { code?: unknown } | null)?.code;
    return (
      typeof code !== "string" ||
      !code ||
      code.startsWith("08") ||
      ["40001", "P0002", "55P03", "42501"].includes(code)
    );
  }
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await boundedRequest(bookingWorker.rpc(name as never, args as never));
  if (error) throw new BookingWorkerRpcError(error);
  return data as T;
}

function claimArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new BookingWorkerRpcError("Invalid claim response");
  return value as T[];
}

const calendarActions = new Set<CalendarAction>([
  "create",
  "delete",
  "converged",
  "manual_repair",
  "retry",
]);

function calendarDecision(value: unknown): { action: CalendarAction } {
  if (
    !value ||
    typeof value !== "object" ||
    !("action" in value) ||
    typeof value.action !== "string" ||
    !calendarActions.has(value.action as CalendarAction)
  )
    throw new BookingWorkerRpcError("Invalid calendar decision");
  return value as { action: CalendarAction };
}

function assertCalendarClaim(value: CalendarClaim) {
  if (
    !value?.link?.id ||
    !value.link.appointment_id ||
    !value.link.profile_id ||
    !value.link.google_event_id ||
    !["present", "absent"].includes(value.link.desired_state) ||
    !value.link.desired_generation ||
    !value.link.snapshot_appointment_version ||
    !value.link.reconcile_fencing_token ||
    !value?.epoch?.id ||
    !value.epoch.pipedream_account_id ||
    !value.epoch.google_calendar_id ||
    value.appointment?.id !== value.link.appointment_id ||
    !Number.isFinite(Date.parse(value.appointment.start_at)) ||
    !Number.isFinite(Date.parse(value.appointment.end_at)) ||
    typeof value.appointment.customer_snapshot?.email !== "string" ||
    !value.appointment.customer_snapshot.email.trim()
  )
    throw new BookingWorkerRpcError("Incomplete calendar claim");
}

function calendarEvidence(claim: CalendarClaim, state: CalendarState, effectId?: string) {
  return {
    destinationEpochId: claim.epoch.id ?? null,
    googleEventId: claim.link.google_event_id,
    appointmentId: claim.link.appointment_id,
    state,
    effectId: effectId ?? null,
  };
}

async function observeCalendar(
  claim: CalendarClaim,
  leaseToken: string,
  phase: "probe" | "post_effect",
  state: CalendarState,
  effectId?: string,
  failure?: ReturnType<typeof calendarFailure>,
) {
  const value = await rpc<unknown>("record_booking_calendar_observation", {
    p_link_id: claim.link.id,
    p_lease_token: leaseToken,
    p_fencing_token: claim.link.reconcile_fencing_token,
    p_expected_generation: claim.link.desired_generation,
    p_expected_appointment_version: claim.link.snapshot_appointment_version,
    p_phase: phase,
    p_observed_state: state,
    p_observed_at: new Date().toISOString(),
    p_evidence: {
      ...calendarEvidence(claim, state, effectId),
      ...(failure ? { failureKind: failure.kind, failureCode: failure.code } : {}),
    },
  });
  return calendarDecision(value);
}

async function readCalendar(claim: CalendarClaim) {
  const identity = {
    profileId: claim.link.profile_id,
    environment: claim.link.environment,
    accountId: claim.epoch.pipedream_account_id,
    calendarId: claim.epoch.google_calendar_id,
    eventId: claim.link.google_event_id,
    appointmentId: claim.link.appointment_id,
  };
  const observed = await getGoogleBookingEvent({
    ...identity,
    startAt: claim.appointment.start_at,
    endAt: claim.appointment.end_at,
    attendeeEmail: String(claim.appointment.customer_snapshot.email),
  });
  if (claim.link.desired_state === "absent" && observed.state === "conflict") {
    // A DELETE tombstone lacks event contents. Accept only proven absence, not
    // an identity-only "present" that would conceal a contractor's content edit.
    const tombstone = await getGoogleBookingEvent(identity);
    if (tombstone.state === "absent") return tombstone;
  }
  if (
    claim.link.desired_state === "absent" &&
    observed.state === "present" &&
    (typeof observed.etag !== "string" || !observed.etag.trim())
  )
    return { state: "conflict" as const };
  return observed;
}

async function failCalendarClaim(
  claim: CalendarClaim,
  leaseToken: string,
  error: unknown,
  write = false,
) {
  const failure = calendarFailure(error, write);
  await rpc("fail_booking_calendar_convergence", {
    p_link_id: claim.link.id,
    p_lease_token: leaseToken,
    p_fencing_token: claim.link.reconcile_fencing_token,
    p_expected_generation: claim.link.desired_generation,
    p_expected_appointment_version: claim.link.snapshot_appointment_version,
    p_retryable: failure.kind !== "configuration",
    p_safe_error: failure.code,
    p_failure_kind: failure.kind,
    p_failure_code: failure.code,
  });
}

async function reconcileCalendarClaim(
  claim: CalendarClaim,
  leaseToken: string,
  canContinue: () => boolean,
  deadlineAt: number,
) {
  const renewLease = async () => {
    if (!canContinue()) throw new BookingWorkerStoppedError();
    const renewed = await rpc<boolean>("renew_booking_calendar_reconciliation_v3", {
      p_link_id: claim.link.id,
      p_lease_token: leaseToken,
      p_fencing_token: claim.link.reconcile_fencing_token,
      p_expected_generation: claim.link.desired_generation,
      p_expected_appointment_version: claim.link.snapshot_appointment_version,
      p_lease_seconds: 120,
    });
    if (renewed !== true) throw new BookingWorkerRpcError({ code: "40001" });
    if (!canContinue()) throw new BookingWorkerStoppedError();
  };
  let first: Awaited<ReturnType<typeof readCalendar>>;
  await renewLease();
  try {
    first = await withPipedreamDeadline(deadlineAt, () => readCalendar(claim));
  } catch (providerError) {
    await failCalendarClaim(claim, leaseToken, providerError);
    return false;
  }
  await renewLease();
  const decision = await observeCalendar(claim, leaseToken, "probe", first.state);
  if (decision.action !== "create" && decision.action !== "delete")
    return decision.action === "converged";

  // An indeterminate begin response must never be followed by an external mutation.
  const effectId = await rpc<string>("begin_booking_calendar_effect", {
    p_link_id: claim.link.id,
    p_lease_token: leaseToken,
    p_fencing_token: claim.link.reconcile_fencing_token,
    p_expected_generation: claim.link.desired_generation,
    p_expected_appointment_version: claim.link.snapshot_appointment_version,
    p_action: decision.action,
  });
  if (typeof effectId !== "string" || !effectId)
    throw new BookingWorkerRpcError("Invalid effect ID");

  let providerError: unknown;
  await renewLease();
  try {
    await withPipedreamDeadline(deadlineAt, async () => {
      if (decision.action === "create") {
        await createGoogleBookingEvent({
          profileId: claim.link.profile_id,
          environment: claim.link.environment,
          accountId: claim.epoch.pipedream_account_id,
          calendarId: claim.epoch.google_calendar_id,
          eventId: claim.link.google_event_id,
          summary: String(claim.appointment.service_snapshot?.name ?? "Appointment"),
          description: "Booked with Obra. Reference: " + claim.appointment.public_reference,
          startAt: claim.appointment.start_at,
          endAt: claim.appointment.end_at,
          timeZone: claim.appointment.time_zone,
          attendeeEmail: String(claim.appointment.customer_snapshot?.email ?? ""),
          appointmentId: claim.link.appointment_id,
        });
      } else {
        await deleteGoogleBookingEvent({
          profileId: claim.link.profile_id,
          environment: claim.link.environment,
          accountId: claim.epoch.pipedream_account_id,
          calendarId: claim.epoch.google_calendar_id,
          eventId: claim.link.google_event_id,
          ifMatch: first.etag,
        });
      }
    });
  } catch (error) {
    providerError = error;
  }

  // Repeat only this frozen result after response loss. Cancellation fences new
  // work, not retention of an already-dispatched effect's outcome.
  const effectResult = {
    p_effect_id: effectId,
    p_lease_token: leaseToken,
    p_fencing_token: claim.link.reconcile_fencing_token,
    p_outcome: providerError
      ? classifyPipedreamFailure(providerError) === "temporary"
        ? "ambiguous"
        : "failed"
      : "accepted",
    p_provider_status: providerError ? providerStatus(providerError) : null,
    p_evidence: {
      action: decision.action,
      outcome: providerError ? "provider_error" : "provider_accepted",
      observedAt: new Date().toISOString(),
      ...(providerError ? { failureCode: calendarFailure(providerError, true).code } : {}),
    },
  };
  let effectSettled = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if ((await rpc("record_booking_calendar_effect_result", effectResult)) !== true)
        throw new BookingWorkerRpcError("Invalid effect settlement");
      effectSettled = true;
      break;
    } catch (error) {
      if (!(error instanceof BookingWorkerRpcError) || !error.recoverable) throw error;
      if (attempt === 2 && providerError) throw error;
    }
  }

  if (providerError && calendarFailure(providerError, true).code === "calendar_identity_conflict") {
    await failCalendarClaim(claim, leaseToken, providerError, true);
    return false;
  }

  if (!canContinue()) {
    if (providerError) await failCalendarClaim(claim, leaseToken, providerError, true);
    // An accepted or ambiguous effect without readback is unfinished, not delivered.
    return false;
  }
  let after: Awaited<ReturnType<typeof readCalendar>>;
  await renewLease();
  try {
    after = await withPipedreamDeadline(deadlineAt, () => readCalendar(claim));
  } catch (readError) {
    await failCalendarClaim(claim, leaseToken, providerError ?? readError, Boolean(providerError));
    return false;
  }
  // A committed-but-response-lost observation is left to lease takeover, never converted to failure.
  await renewLease();
  const result = await observeCalendar(
    claim,
    leaseToken,
    "post_effect",
    after.state,
    effectId,
    providerError ? calendarFailure(providerError, true) : undefined,
  );
  return effectSettled && result.action === "converged";
}
async function reconcileGoogleBookingEvents(
  environment: BookingEnvironment,
  canContinue: () => boolean,
  deadlineAt: number,
  counts: { reconciled: number; failures: number },
  limit = 25,
) {
  for (let index = 0; index < limit; index++) {
    if (!canContinue()) break;
    const leaseToken = crypto.randomUUID();
    const candidates = claimArray<CalendarClaim>(
      await rpc<unknown>("claim_booking_calendar_reconciliation", {
        p_environment: environment,
        p_lease_token: leaseToken,
        p_limit: 1,
      }),
    );
    const candidate = candidates[0];
    if (!candidate) break;
    assertCalendarClaim(candidate);
    if (candidate.link.environment !== environment)
      throw new BookingWorkerRpcError("Calendar claim environment mismatch");
    try {
      if (await reconcileCalendarClaim(candidate, leaseToken, canContinue, deadlineAt))
        counts.reconciled++;
      else counts.failures++;
    } catch (error) {
      counts.failures++;
      // RPC ambiguity/lease loss is not provider failure. Takeover starts with GET.
      if (
        !(error instanceof BookingWorkerStoppedError) &&
        (!(error instanceof BookingWorkerRpcError) || !error.recoverable)
      )
        throw error;
    }
  }
  return counts;
}
async function reconcileLatePayments(
  environment: BookingEnvironment,
  canContinue: () => boolean,
  deadlineAt: number,
  counts: { arbitrated: number; failures: number },
  limit = 25,
) {
  for (let index = 0; index < limit; index++) {
    if (!canContinue()) break;
    const leaseToken = crypto.randomUUID();
    const claims = claimArray<LatePaymentClaim>(
      await rpc<unknown>("claim_booking_late_payment_arbitrations", {
        p_environment: environment,
        p_lease_token: leaseToken,
        p_limit: 1,
      }),
    );
    const claim = claims[0];
    if (!claim) break;
    if (claim.arbitration.environment !== environment)
      throw new BookingWorkerRpcError("Late-payment claim environment mismatch");
    const base = {
      p_arbitration_id: claim.arbitration.id,
      p_lease_token: leaseToken,
      p_fencing_token: claim.arbitration.fencing_token,
      p_snapshot_generation: claim.arbitration.snapshot_generation,
    };
    let providerError: unknown;
    let busyRanges: Awaited<ReturnType<typeof getGoogleCalendarBusyRanges>> | null = null;
    const renewLease = async () => {
      if (!canContinue()) throw new BookingWorkerStoppedError();
      const renewed = await rpc<boolean>("renew_booking_late_payment_arbitration_v3", {
        ...base,
        p_lease_seconds: 90,
      });
      if (renewed !== true) throw new BookingWorkerRpcError({ code: "40001" });
      if (!canContinue()) throw new BookingWorkerStoppedError();
    };
    const observedAt = new Date().toISOString();
    try {
      if (
        !claim.provider_context.accountId ||
        !Array.isArray(claim.provider_context.calendarIds) ||
        claim.provider_context.calendarIds.length === 0 ||
        claim.provider_context.calendarIds.some((id) => typeof id !== "string" || !id) ||
        !claim.provider_context.rangeStart ||
        !claim.provider_context.rangeEnd
      )
        throw new BookingWorkerRpcError("Incomplete late-payment provider context");
      await renewLease();
      busyRanges = await withPipedreamDeadline(deadlineAt, () =>
        getGoogleCalendarBusyRanges({
          profileId: claim.arbitration.profile_id,
          environment: claim.arbitration.environment,
          accountId: claim.provider_context.accountId,
          calendarIds: claim.provider_context.calendarIds,
          timeMin: claim.provider_context.rangeStart,
          timeMax: claim.provider_context.rangeEnd,
          beforeChunk: renewLease,
        }),
      );
    } catch (error) {
      if (
        error instanceof BookingWorkerStoppedError ||
        (error instanceof BookingWorkerRpcError && error.recoverable)
      ) {
        counts.failures++;
        continue;
      }
      if (error instanceof BookingWorkerRpcError) throw error;
      providerError = error;
    }
    try {
      // The current SQL fence can settle a completed read in the reserved budget.
      const outcome = await rpc<string>("record_booking_late_payment_observation", {
        ...base,
        p_observed_at: observedAt,
        p_observation_state: providerError
          ? retryableProviderError(providerError)
            ? "transient_error"
            : "permanent_error"
          : "complete",
        p_busy_ranges: busyRanges ?? [],
        p_safe_error: providerError ? calendarFailure(providerError).code : null,
      });
      if (!["recovered", "refund_required", "retry"].includes(outcome))
        throw new BookingWorkerRpcError("Invalid late-payment decision");
      if (providerError || outcome === "retry") counts.failures++;
      else counts.arbitrated++;
    } catch (error) {
      counts.failures++;
      if (
        !(error instanceof BookingWorkerStoppedError) &&
        (!(error instanceof BookingWorkerRpcError) || !error.recoverable)
      )
        throw error;
      // Response loss is not re-submitted as contradictory provider failure evidence.
    }
  }
  return counts;
}
export async function reconcileBookingLifecycle(
  environment: BookingEnvironment,
  familyLeaseCurrent: () => boolean = () => true,
  deadlineAt: number = Date.now() + 45_000,
) {
  if (billingEnvironment() !== environment)
    throw new Error("Stripe key mode does not match booking worker environment");
  if (!Number.isFinite(deadlineAt)) throw new Error("Invalid booking worker deadline");
  const stopAt = Math.min(
    deadlineAt - SETTLEMENT_BUDGET_MS,
    workerProviderContext()?.deadlineAt ?? Infinity,
  );
  const google = { reconciled: 0, failures: 0 };
  const latePayments = { arbitrated: 0, failures: 0 };
  let expired = 0,
    abandonedCheckouts = 0,
    sessionsArbitrated = 0,
    recovered = 0;
  let holdFailures = 0,
    abandonedCheckoutFailures = 0,
    sessionExpiryFailures = 0,
    recoveryFailures = 0;
  let segmentFailures = 0,
    deadlineExceeded = false;
  // Each existing responsibility gets a bounded opportunity. Unused time carries
  // forward; a hung lane cannot spend the remaining lanes' share or claim their work.
  for (let lane = 0; lane < 6; lane++) {
    if (!familyLeaseCurrent() || !workerCanContinue() || Date.now() >= stopAt) break;
    const segmentDeadlineAt = Date.now() + Math.floor((stopAt - Date.now()) / (6 - lane));
    const workDeadlineAt =
      segmentDeadlineAt - Math.min(1000, Math.floor((segmentDeadlineAt - Date.now()) / 4));
    const canContinue = () =>
      familyLeaseCurrent() && workerCanContinue() && Date.now() < workDeadlineAt;
    const failuresBefore =
      google.failures + latePayments.failures + sessionExpiryFailures + recoveryFailures;
    try {
      await withWorkerDeadline(
        segmentDeadlineAt,
        () =>
          workerDeadline.run(segmentDeadlineAt, async () => {
            if (lane === 0 || lane === 1) {
              const count = await rpc<number>(
                lane === 0
                  ? "expire_due_booking_holds_v3"
                  : "expire_abandoned_booking_checkout_creations_v3",
                {
                  p_environment: environment,
                  p_limit: 100,
                },
              );
              if (!Number.isSafeInteger(count) || count < 0)
                throw new BookingWorkerRpcError("Invalid hold expiry result");
              if (lane === 0) expired = count;
              else abandonedCheckouts = count;
              return;
            }
            if (lane === 2) {
              await reconcileLatePayments(environment, canContinue, workDeadlineAt, latePayments);
              return;
            }
            if (lane === 5) {
              await reconcileGoogleBookingEvents(environment, canContinue, workDeadlineAt, google);
              return;
            }
            const stripe = getStripe();
            const stripeOptions = (stripeAccount: string) => {
              if (!canContinue()) throw new BookingWorkerStoppedError();
              return {
                stripeAccount,
                timeout: Math.max(1, workDeadlineAt - Date.now()),
                maxNetworkRetries: 0,
              };
            };
            if (lane === 3)
              for (let index = 0; index < 25; index++) {
                if (!canContinue()) break;
                const expiryLeaseToken = crypto.randomUUID();
                const { data: dueSessions, error: dueSessionsError } = await boundedRequest(
                  bookingWorker.rpc("claim_due_booking_session_expiries_v3", {
                    p_environment: environment,
                    p_lease_token: expiryLeaseToken,
                    p_limit: 1,
                  }),
                );
                if (dueSessionsError) throw new Error("Unable to claim expired booking sessions");
                if (!Array.isArray(dueSessions) || dueSessions.length > 1)
                  throw new BookingWorkerRpcError("Invalid session expiry claim");
                const due = (
                  dueSessions as unknown as Array<{
                    id: string;
                    checkout_session_id: string | null;
                    stripe_account_id: string | null;
                    checkout_fencing_token: number;
                  }> | null
                )?.[0];
                if (!due) break;
                const renewExpiryLease = async () => {
                  if (!canContinue()) throw new BookingWorkerStoppedError();
                  const { data, error } = await boundedRequest(
                    bookingWorker.rpc("renew_booking_session_expiry_v3", {
                      p_payment_id: due.id,
                      p_lease_token: expiryLeaseToken,
                      p_fencing_token: due.checkout_fencing_token,
                      p_lease_seconds: 300,
                    }),
                  );
                  if (error) throw error;
                  if (data !== true)
                    throw new StaleSessionExpiryLeaseError("Stale booking session expiry lease");
                };
                try {
                  if (!due.checkout_session_id || !due.stripe_account_id)
                    throw new BookingStripeConfigurationError(
                      "Expired booking session provider identity is missing",
                    );
                  await renewExpiryLease();
                  let checkout = await stripe.checkout.sessions.retrieve(
                    due.checkout_session_id,
                    {},
                    stripeOptions(due.stripe_account_id),
                  );
                  if (checkout.status === "open" && checkout.payment_status !== "paid") {
                    await renewExpiryLease();
                    checkout = await stripe.checkout.sessions.expire(
                      due.checkout_session_id,
                      {},
                      stripeOptions(due.stripe_account_id),
                    );
                    await renewExpiryLease();
                    checkout = await stripe.checkout.sessions.retrieve(
                      due.checkout_session_id,
                      {},
                      stripeOptions(due.stripe_account_id),
                    );
                  }
                  const paymentIntentId =
                    typeof checkout.payment_intent === "string"
                      ? checkout.payment_intent
                      : (checkout.payment_intent?.id ?? null);
                  if (paymentIntentId) await renewExpiryLease();
                  const paymentIntent = paymentIntentId
                    ? await stripe.paymentIntents.retrieve(
                        paymentIntentId,
                        {},
                        stripeOptions(due.stripe_account_id),
                      )
                    : null;
                  const chargeId =
                    typeof paymentIntent?.latest_charge === "string"
                      ? paymentIntent.latest_charge
                      : (paymentIntent?.latest_charge?.id ?? null);
                  if (chargeId) await renewExpiryLease();
                  const charge = chargeId
                    ? await stripe.charges.retrieve(
                        chargeId,
                        {},
                        stripeOptions(due.stripe_account_id),
                      )
                    : null;
                  const refunds: Record<string, unknown>[] = [];
                  let startingAfter: string | undefined;
                  const seen = new Set<string>();
                  if (chargeId) {
                    for (;;) {
                      await renewExpiryLease();
                      const page = await stripe.refunds.list(
                        {
                          charge: chargeId,
                          limit: 100,
                          ...(startingAfter ? { starting_after: startingAfter } : {}),
                        },
                        stripeOptions(due.stripe_account_id),
                      );
                      refunds.push(...(page.data as unknown as Record<string, unknown>[]));
                      if (!page.has_more) break;
                      const next = page.data.at(-1)?.id;
                      if (!next || seen.has(next))
                        throw new Error("Stripe expiry refund pagination did not advance");
                      seen.add(next);
                      startingAfter = next;
                    }
                  }
                  await renewExpiryLease();
                  const { data: reduced, error: reduceError } = await boundedRequest(
                    bookingWorker.rpc("reduce_booking_financial_evidence_v3", {
                      p_authority_kind: "session_expiry",
                      p_authority_id: due.id,
                      p_lease_token: expiryLeaseToken,
                      p_fencing_token: due.checkout_fencing_token,
                      p_provider_snapshot: JSON.parse(
                        JSON.stringify({
                          stripeAccountId: due.stripe_account_id,
                          checkout,
                          paymentIntent,
                          charge,
                          refunds,
                          refundsHasMore: false,
                        }),
                      ),
                    }),
                  );
                  if (
                    reduceError ||
                    !reduced ||
                    typeof reduced !== "object" ||
                    !("action" in reduced) ||
                    reduced.action !== "settled"
                  )
                    throw (
                      reduceError ?? new Error("Expired booking session evidence was not accepted")
                    );
                  sessionsArbitrated++;
                } catch (error) {
                  sessionExpiryFailures++;
                  if (
                    error instanceof StaleSessionExpiryLeaseError ||
                    error instanceof BookingWorkerStoppedError
                  )
                    continue;
                  const failure = bookingStripeFailure(error);
                  const { data: failed, error: failError } = await boundedRequest(
                    bookingWorker.rpc("fail_booking_session_expiry_v3", {
                      p_payment_id: due.id,
                      p_lease_token: expiryLeaseToken,
                      p_fencing_token: due.checkout_fencing_token,
                      p_retryable: failure.retryable,
                      p_retry_delay_seconds: failure.retryDelaySeconds,
                      p_safe_error: "Booking session expiry processing failed",
                    } as never),
                  );
                  if (failError) throw failError;
                  if (failed !== true) continue;
                }
              }

            if (lane === 4)
              for (let index = 0; index < 25; index++) {
                if (!canContinue()) break;
                const checkoutLeaseToken = crypto.randomUUID();
                const { data: ambiguous, error } = await boundedRequest(
                  bookingWorker.rpc("claim_ambiguous_booking_checkouts", {
                    p_environment: environment,
                    p_lease_token: checkoutLeaseToken,
                    p_limit: 1,
                  }),
                );
                if (error) throw new Error("Unable to load ambiguous booking checkouts");
                if (!Array.isArray(ambiguous) || ambiguous.length > 1)
                  throw new BookingWorkerRpcError("Invalid checkout recovery claim");
                const row = ambiguous?.[0];
                if (!row) break;
                if (
                  !row.stripe_account_id ||
                  !row.checkout_idempotency_key ||
                  !row.checkout_provider_expires_at ||
                  !row.checkout_operation_id
                ) {
                  recoveryFailures++;
                  continue;
                }
                try {
                  if (!canContinue()) break;
                  const { publicAppUrl } = await import("@/lib/stripe.server");
                  const session = await getStripe().checkout.sessions.create(
                    {
                      mode: "payment",
                      payment_method_types: ["card"],
                      customer_email: String(
                        (row.customer_snapshot as { email?: unknown }).email ?? "",
                      ),
                      line_items: [
                        {
                          price_data: {
                            currency: row.currency.toLowerCase(),
                            unit_amount: row.expected_amount_minor,
                            product_data: {
                              name: String(
                                (row.service_snapshot as { name?: unknown }).name ?? "Appointment",
                              ),
                            },
                          },
                          quantity: 1,
                        },
                      ],
                      metadata: {
                        kind: "booking",
                        appointmentId: row.appointment_id,
                        profileId: row.profile_id,
                        environment: row.environment,
                      },
                      payment_intent_data: {
                        metadata: { kind: "booking", appointmentId: row.appointment_id },
                      },
                      success_url:
                        publicAppUrl() + "/booking/return?session_id={CHECKOUT_SESSION_ID}",
                      cancel_url:
                        publicAppUrl() +
                        "/lp/" +
                        encodeURIComponent(row.website_id) +
                        "?booking=cancelled",
                      expires_at: Math.floor(Date.parse(row.checkout_provider_expires_at) / 1000),
                    },
                    {
                      ...stripeOptions(row.stripe_account_id),
                      idempotencyKey: row.checkout_idempotency_key,
                    },
                  );
                  const { data: settled, error: settleError } = await boundedRequest(
                    bookingWorker.rpc("settle_booking_checkout", {
                      p_payment_id: row.payment_id,
                      p_lease_token: checkoutLeaseToken,
                      p_fencing_token: row.checkout_fencing_token,
                      p_session_id: session.id,
                      p_expires_at: new Date(session.expires_at * 1000).toISOString(),
                      p_succeeded: true,
                      p_ambiguous: false,
                      p_safe_error: rpcNull,
                    }),
                  );
                  if (
                    settleError ||
                    settled?.id !== row.payment_id ||
                    settled.checkout_session_id !== session.id
                  )
                    throw settleError ?? new Error("Checkout recovery settlement is indeterminate");
                  recovered++;
                } catch {
                  recoveryFailures++;
                  // The same Stripe idempotency key is replayed after the fenced lease expires.
                }
              }
          }),
        { workDeadlineAt, canContinue: familyLeaseCurrent },
      );
    } catch (error) {
      segmentFailures++;
      if (lane === 0) holdFailures++;
      if (lane === 1) abandonedCheckoutFailures++;
      // An error settling a failed row is still one failed attempt. A failed
      // claim/budget with no counted row is one failed lane operation instead.
      if (
        google.failures + latePayments.failures + sessionExpiryFailures + recoveryFailures ===
        failuresBefore
      ) {
        if (lane === 2) latePayments.failures++;
        if (lane === 3) sessionExpiryFailures++;
        if (lane === 4) recoveryFailures++;
        if (lane === 5) google.failures++;
      }
      deadlineExceeded ||= error instanceof WorkerDeadlineError || Date.now() >= workDeadlineAt;
    }
  }
  return {
    expired,
    abandonedCheckouts,
    recovered,
    sessionsArbitrated,
    latePaymentsArbitrated: latePayments.arbitrated,
    googleReconciled: google.reconciled,
    googleFailures: google.failures,
    latePaymentFailures: latePayments.failures,
    holdFailures,
    abandonedCheckoutFailures,
    sessionExpiryFailures,
    recoveryFailures,
    segmentFailures,
    // A rejected claim/settlement may have committed. Keep known branch counts,
    // but do not present an exhaustive row total for an interrupted segment.
    failed: segmentFailures
      ? null
      : google.failures +
        latePayments.failures +
        holdFailures +
        abandonedCheckoutFailures +
        sessionExpiryFailures +
        recoveryFailures,
    deadlineExceeded: deadlineExceeded || Date.now() >= stopAt,
  };
}
