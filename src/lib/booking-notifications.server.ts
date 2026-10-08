import type { Database } from "@/integrations/supabase/types";
import { workerProviderFetch } from "@/lib/worker-deadline.server";

export type BookingNotificationType =
  | "confirmed"
  | "cancelled"
  | "refund_pending"
  | "refund_succeeded"
  | "refund_failed"
  | "late_payment"
  | "calendar_failed"
  | "calendar_repaired";

export type BookingNotificationAudience = "customer" | "contractor";

export type BookingNotificationAppointment = Pick<
  Database["public"]["Tables"]["appointments"]["Row"],
  | "public_reference"
  | "start_at"
  | "time_zone"
  | "service_snapshot"
  | "appointment_state"
  | "calendar_state"
  | "cancellation_requested_at"
>;

export class BookingNotificationProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "BookingNotificationProviderError";
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new BookingNotificationProviderError(name + " is not configured", false);
  return value;
}

function formatWhen(appointment: { start_at: string; time_zone: string }) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: appointment.time_zone,
  }).format(new Date(appointment.start_at));
}

function description(
  type: BookingNotificationType,
  audience: BookingNotificationAudience,
  reference: string,
  serviceName: string,
  when: string,
  appointment: BookingNotificationAppointment,
) {
  const contractor = audience === "contractor";
  const cancelled = appointment.appointment_state === "cancelled";
  const confirmed =
    appointment.appointment_state === "confirmed" && appointment.cancellation_requested_at === null;
  if (
    (type === "confirmed" && !confirmed) ||
    (type === "calendar_failed" &&
      !(
        (confirmed && appointment.calendar_state === "create_failed") ||
        (cancelled && appointment.calendar_state === "cancel_failed")
      )) ||
    (type === "calendar_repaired" &&
      !(
        (confirmed && appointment.calendar_state === "created") ||
        (cancelled && appointment.calendar_state === "cancelled")
      ))
  )
    throw new BookingNotificationProviderError(
      "Booking notification state is no longer current",
      false,
    );
  const descriptions: Record<BookingNotificationType, { subject: string; message: string }> = {
    confirmed: {
      subject: "Booking " + reference + " confirmed",
      message: contractor
        ? serviceName + " was booked for " + when + "."
        : serviceName + " is confirmed for " + when + ".",
    },
    cancelled: {
      subject: "Booking " + reference + " cancelled",
      message: serviceName + " scheduled for " + when + " has been cancelled.",
    },
    refund_pending: {
      subject: "Refund started for " + reference,
      message: contractor
        ? "A refund for " + serviceName + " is being processed."
        : "Your refund for " + serviceName + " is being processed.",
    },
    refund_succeeded: {
      subject: "Refund completed for " + reference,
      message: "The remaining refund for " + serviceName + " has completed.",
    },
    refund_failed: {
      subject: "Refund needs attention for " + reference,
      message: contractor
        ? "The refund for " + serviceName + " needs manual attention."
        : "Your refund could not be completed automatically. Contact the contractor for an update.",
    },
    late_payment: {
      subject: "Late payment update for " + reference,
      message: contractor
        ? "A payment arrived after the booking hold deadline. Review the booking and refund status."
        : "Your payment arrived after the booking hold deadline. Check the current booking and refund status using this reference.",
    },
    calendar_failed: {
      subject:
        (cancelled ? "Calendar cancellation" : "Calendar delivery") +
        " needs attention for " +
        reference,
      message: cancelled
        ? contractor
          ? "The appointment is cancelled, but removing its calendar event still needs attention."
          : "Your appointment is cancelled, but removal of its calendar event has not yet been verified. An old invitation may still appear; it does not mean the booking is confirmed."
        : contractor
          ? "The paid appointment is confirmed, but creating its calendar event still needs attention."
          : "Your appointment remains confirmed, but its calendar invitation is delayed. Contact the contractor if you need an update.",
    },
    calendar_repaired: {
      subject:
        (cancelled ? "Calendar cancellation completed for " : "Calendar event created for ") +
        reference,
      message: cancelled
        ? contractor
          ? "The appointment remains cancelled. Its calendar event has been removed."
          : "Your appointment remains cancelled. Its event has been removed from the contractor's calendar; your calendar may take time to update."
        : contractor
          ? "The calendar event for the confirmed appointment has been created."
          : "The calendar event for your confirmed appointment has been created. Check your calendar for the invitation.",
    },
  };
  return descriptions[type];
}

function environmentValue(base: string, environment: "test" | "live") {
  return required(base + "_" + environment.toUpperCase());
}

export function buildBookingNotificationPayload(input: {
  type: BookingNotificationType;
  audience: BookingNotificationAudience;
  recipientEmail: string;
  environment: "test" | "live";
  appointment: BookingNotificationAppointment;
}) {
  const service = input.appointment.service_snapshot as { name?: unknown } | null;
  const serviceName = typeof service?.name === "string" ? service.name : "Appointment";
  const detail = description(
    input.type,
    input.audience,
    input.appointment.public_reference,
    serviceName,
    formatWhen(input.appointment),
    input.appointment,
  );
  return JSON.stringify({
    from: environmentValue("BOOKING_EMAIL_FROM", input.environment),
    to: [input.recipientEmail],
    subject: detail.subject,
    text:
      detail.message +
      "\n\nBooking reference: " +
      input.appointment.public_reference +
      "\nTime zone: " +
      input.appointment.time_zone,
  });
}

export async function sendBookingNotification(input: {
  idempotencyKey: string;
  environment: "test" | "live";
  payload: string;
  /** Monotonic performance.now() deadline from dispatch authorization. */
  dispatchDeadlineAt: number;
}) {
  const apiKey = environmentValue("RESEND_API_KEY", input.environment);
  // The DB grants a remaining duration, measured from before the authorization
  // request, so a slow response or clock skew cannot extend the replay window.
  const remaining = Math.floor(Math.min(10_000, input.dispatchDeadlineAt - performance.now()));
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw new BookingNotificationProviderError(
      "Booking email dispatch authorization expired",
      true,
    );
  let response: Response;
  try {
    response = await workerProviderFetch("https://api.resend.com/emails", {
      method: "POST",
      // redirect:"manual" (Workers rejects "error"); non-ok responses fail closed below.
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: input.payload,
    });
  } catch {
    throw new BookingNotificationProviderError("Booking email request failed", true);
  }
  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500;
    throw new BookingNotificationProviderError(
      "Booking email provider returned " + response.status,
      retryable,
    );
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new BookingNotificationProviderError("Booking email provider response is invalid", true);
  }
  if (raw.length > 16_384)
    throw new BookingNotificationProviderError("Booking email provider response is invalid", true);
  let body: { id?: unknown } | null;
  try {
    body = JSON.parse(raw) as { id?: unknown } | null;
  } catch {
    throw new BookingNotificationProviderError("Booking email provider response is invalid", true);
  }
  if (typeof body?.id !== "string" || !/^[a-zA-Z0-9_-]{8,200}$/.test(body.id))
    throw new BookingNotificationProviderError("Booking email provider returned no identity", true);
  return { notificationId: body.id };
}
