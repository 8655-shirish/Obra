import { randomUUID } from "node:crypto";

import { bookingWorker } from "@/integrations/supabase/booking-worker.server";
import { workerCanContinue } from "@/lib/worker-deadline.server";
import {
  BookingNotificationProviderError,
  buildBookingNotificationPayload,
  sendBookingNotification,
  type BookingNotificationAppointment,
  type BookingNotificationAudience,
  type BookingNotificationType,
} from "@/lib/booking-notifications.server";

const notificationTypes = new Set<BookingNotificationType>([
  "confirmed",
  "cancelled",
  "refund_pending",
  "refund_succeeded",
  "refund_failed",
  "late_payment",
  "calendar_failed",
  "calendar_repaired",
]);

export async function processBookingNotifications(
  environment: "test" | "live",
  limit = 4,
  familyLeaseCurrent: () => boolean = () => true,
) {
  const counts = {
    processed: 0,
    claimed: 0,
    accepted: 0,
    failed: 0,
    suppressed: 0,
    review: 0,
    settled: 0,
    skipped: 0,
  };
  if (!familyLeaseCurrent() || !workerCanContinue()) return counts;
  const leaseToken = randomUUID();
  const { data: notifications, error } = await bookingWorker.rpc(
    "claim_due_booking_notifications_v3" as never,
    {
      p_environment: environment,
      p_lease_token: leaseToken,
      p_dispatch_contract: 1,
      // Four sequential ten-second provider deadlines fit the 55-second family lease.
      p_limit: Math.max(1, Math.min(limit, 4)),
    } as never,
  );
  if (error) throw new Error("Unable to claim booking notifications");
  const rows = (notifications ?? []) as unknown as Array<{
    id: string;
    appointment_id: string;
    notification_type: string;
    audience: string;
    environment: string;
    recipient_email: string | null;
    idempotency_key: string;
    fencing_token: number;
    dispatch_payload: string | null;
  }>;
  counts.claimed = rows.length;
  for (const raw of rows) {
    if (!familyLeaseCurrent() || !workerCanContinue()) break;
    let providerAccepted = false;
    try {
      if (raw.environment !== environment || !raw.recipient_email)
        throw new BookingNotificationProviderError("Invalid booking notification recipient", false);
      if (!notificationTypes.has(raw.notification_type as BookingNotificationType))
        throw new BookingNotificationProviderError("Invalid booking notification type", false);
      if (raw.audience !== "customer" && raw.audience !== "contractor")
        throw new BookingNotificationProviderError("Invalid booking notification audience", false);
      const { data: appointment, error: appointmentError } = await bookingWorker.rpc(
        "get_booking_notification_context_v3" as never,
        {
          p_notification_id: raw.id,
          p_environment: environment,
          p_lease_token: leaseToken,
          p_fencing_token: raw.fencing_token,
        } as never,
      );
      if (appointmentError)
        throw new BookingNotificationProviderError(
          "Unable to load booking notification context",
          true,
        );
      if (!appointment) break;
      if (!familyLeaseCurrent() || !workerCanContinue()) break;
      const context = appointment as unknown as { appointment: BookingNotificationAppointment };
      const payload =
        raw.dispatch_payload ??
        buildBookingNotificationPayload({
          type: raw.notification_type as BookingNotificationType,
          audience: raw.audience as BookingNotificationAudience,
          recipientEmail: raw.recipient_email,
          environment,
          appointment: context.appointment,
        });
      const authorizationStartedAt = performance.now();
      const { data: authorization, error: authorizationError } = await bookingWorker.rpc(
        "authorize_booking_notification_dispatch_v3" as never,
        {
          p_notification_id: raw.id,
          p_environment: environment,
          p_lease_token: leaseToken,
          p_fencing_token: raw.fencing_token,
          p_expected_appointment: context.appointment,
          p_payload: payload,
        } as never,
      );
      if (authorizationError)
        throw new BookingNotificationProviderError(
          "Unable to authorize booking notification dispatch",
          true,
        );
      const dispatch = authorization as unknown as {
        action: "dispatch" | "suppressed" | "review";
        payload?: string;
        dispatch_budget_ms?: number;
      } | null;
      if (!dispatch) break;
      if (dispatch.action === "suppressed" || dispatch.action === "review") {
        // These outcomes settle the claim, not provider acceptance or delivery.
        counts[dispatch.action]++;
        continue;
      }
      if (
        dispatch.action !== "dispatch" ||
        dispatch.payload !== payload ||
        typeof dispatch.dispatch_budget_ms !== "number" ||
        !Number.isFinite(dispatch.dispatch_budget_ms) ||
        dispatch.dispatch_budget_ms <= 0
      )
        throw new BookingNotificationProviderError(
          "Invalid booking notification dispatch authority",
          true,
        );
      if (!familyLeaseCurrent() || !workerCanContinue()) break;
      const result = await sendBookingNotification({
        idempotencyKey: raw.idempotency_key,
        environment,
        payload: dispatch.payload,
        dispatchDeadlineAt: authorizationStartedAt + dispatch.dispatch_budget_ms,
      });
      providerAccepted = true;
      counts.accepted++;
      let settled = false;
      let settlementError: unknown;
      // Retry only the same completion, never the send. The shared DB transport
      // can use the settlement reserve even after provider dispatch must stop.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data: completed, error: completeError } = await bookingWorker.rpc(
            "complete_booking_notification_v3" as never,
            {
              p_notification_id: raw.id,
              p_environment: environment,
              p_lease_token: leaseToken,
              p_fencing_token: raw.fencing_token,
              p_provider_destination: "resend",
              p_provider_message_id: result.notificationId,
            } as never,
          );
          if (completeError || completed !== true)
            throw completeError ?? new Error("Booking notification acceptance was not settled");
          settled = true;
          break;
        } catch (cause) {
          settlementError = cause;
          if ((cause as { code?: string })?.code === "ABORT_ERR") break;
        }
      }
      if (!settled) throw settlementError;
      counts.processed++;
    } catch (cause) {
      // Do not record a contradictory provider failure after a possibly committed
      // acceptance. Takeover must reauthorize the frozen payload within its window.
      if (providerAccepted)
        throw new Error("Booking notification acceptance settlement is unresolved", { cause });
      const retryable = cause instanceof BookingNotificationProviderError ? cause.retryable : true;
      const { data: failed, error: failureError } = await bookingWorker.rpc(
        "fail_booking_notification_v3" as never,
        {
          p_notification_id: raw.id,
          p_environment: environment,
          p_lease_token: leaseToken,
          p_fencing_token: raw.fencing_token,
          p_retryable: retryable,
          p_safe_error: "Booking notification delivery failed",
        } as never,
      );
      if (failureError || failed !== true)
        throw new Error("Unable to settle booking notification failure", { cause });
      counts.failed++;
    }
  }
  counts.settled = counts.processed + counts.failed + counts.suppressed + counts.review;
  counts.skipped = counts.claimed - counts.settled;
  return counts;
}
