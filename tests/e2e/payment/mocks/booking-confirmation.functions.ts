import { RECEIPT_REFERENCES } from "../test-data";

type Projection = {
  reference: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  appointmentState: "held" | "payment_pending" | "confirmed" | "cancelled";
  appointmentReason: string | null;
  paymentState: "not_started" | "creating" | "pending" | "paid" | "failed" | "disputed";
  refundState: "not_requested" | "pending" | "succeeded" | "failed";
  calendarState:
    | "not_required"
    | "create_pending"
    | "created"
    | "create_failed"
    | "cancel_pending"
    | "cancelled"
    | "cancel_failed";
  reviewState:
    | "none"
    | "late_payment"
    | "refund_failure"
    | "calendar_reconciliation"
    | "provider_inconsistency";
  reservationExpiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  statusCode:
    | "payment_pending"
    | "late_payment_refund_pending"
    | "confirmed_calendar_ready"
    | "confirmed_calendar_failed";
  terminal: boolean;
  pollAfterMs: number | null;
  automaticPollUntil: string | null;
};

export type BookingConfirmationProjection = Projection;

let refreshCalls = 0;

function pending(reference: string): Projection {
  return {
    reference,
    startAt: "2030-01-02T17:00:00.000Z",
    endAt: "2030-01-02T18:00:00.000Z",
    timeZone: "America/Los_Angeles",
    appointmentState: "payment_pending",
    appointmentReason: null,
    paymentState: "pending",
    refundState: "not_requested",
    calendarState: "not_required",
    reviewState: "none",
    reservationExpiresAt: "2030-01-02T17:15:00.000Z",
    confirmedAt: null,
    cancelledAt: null,
    updatedAt: new Date().toISOString(),
    statusCode: "payment_pending",
    terminal: false,
    pollAfterMs: 2_500,
    automaticPollUntil: "2030-01-02T17:05:00.000Z",
  };
}

function confirmed(reference: string): Projection {
  return {
    ...pending(reference),
    appointmentState: "confirmed",
    paymentState: "paid",
    calendarState: "created",
    reservationExpiresAt: null,
    confirmedAt: "2030-01-02T16:58:00.000Z",
    statusCode: "confirmed_calendar_ready",
    terminal: true,
    pollAfterMs: null,
    automaticPollUntil: null,
  };
}

function refund(reference: string): Projection {
  return {
    ...confirmed(reference),
    appointmentState: "cancelled",
    appointmentReason: "late_payment_refund_pending",
    refundState: "pending",
    calendarState: "not_required",
    reviewState: "late_payment",
    cancelledAt: "2030-01-02T16:59:00.000Z",
    statusCode: "late_payment_refund_pending",
    terminal: false,
    pollAfterMs: 2_500,
  };
}

function calendarFailure(reference: string): Projection {
  return {
    ...confirmed(reference),
    calendarState: "create_failed",
    reviewState: "calendar_reconciliation",
    statusCode: "confirmed_calendar_failed",
  };
}

export async function consumeBookingConfirmation({
  data,
}: {
  data: { reference: string };
}): Promise<Projection> {
  if (data.reference === RECEIPT_REFERENCES.refresh) {
    refreshCalls += 1;
    return refreshCalls === 1 ? pending(data.reference) : confirmed(data.reference);
  }
  if (data.reference === RECEIPT_REFERENCES.confirmed) return confirmed(data.reference);
  if (data.reference === RECEIPT_REFERENCES.refund) return refund(data.reference);
  if (data.reference === RECEIPT_REFERENCES.calendar) return calendarFailure(data.reference);
  return pending(data.reference);
}
