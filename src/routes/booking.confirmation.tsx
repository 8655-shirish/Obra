import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  consumeBookingConfirmation,
  type BookingConfirmationProjection,
} from "@/lib/booking-confirmation.functions";

const MAX_AUTOMATIC_POLLS = 12;
const POLL_INTERVAL_MS = 2_500;

export const Route = createFileRoute("/booking/confirmation")({
  validateSearch: z.object({ reference: z.string().uuid() }),
  headers: () => ({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  }),
  component: BookingConfirmation,
});

function isSettling(result: BookingConfirmationProjection) {
  return (
    result.statusCode === "settling" ||
    result.paymentState === "creating" ||
    result.paymentState === "pending" ||
    result.refundState === "pending" ||
    result.calendarState === "create_pending" ||
    result.calendarState === "cancel_pending"
  );
}

function statusCopy(result: BookingConfirmationProjection) {
  const prolonged = Date.now() - Date.parse(result.updatedAt) > 60_000;
  if (result.refundState === "failed")
    return "The refund needs attention. Contact the contractor and keep this reference.";
  if (result.refundState === "pending")
    return result.reviewState === "late_payment"
      ? "Payment arrived after the time was released. A full automatic refund is in progress."
      : "Your booking is cancelled and the remaining refund is in progress.";
  if (result.refundState === "succeeded") return "The refund has completed.";
  if (result.statusCode === "settling" && result.appointmentReason === "late_payment_arbitration")
    return "Your payment arrived after the hold deadline. We are checking whether your appointment can be confirmed.";
  if (result.appointmentReason === "payment_expired" || result.appointmentReason === "hold_expired")
    return "The unpaid reservation expired and the time was released.";
  if (result.paymentState === "failed")
    return "Payment was not completed and this appointment is not booked.";
  if (result.paymentState === "creating" || result.paymentState === "pending")
    return prolonged
      ? "Payment confirmation is taking longer than usual. You can wait or refresh the status below."
      : "Your payment is being confirmed. This page will update automatically.";
  if (
    result.appointmentState === "confirmed" &&
    result.appointmentReason === "late_payment_recovered" &&
    result.paymentState === "paid"
  )
    return "Payment arrived after the hold deadline, but the time was still free and your appointment is confirmed.";
  if (result.appointmentState === "confirmed")
    return result.paymentState === "paid"
      ? "Your appointment and payment are confirmed."
      : "Your appointment is confirmed.";
  if (result.appointmentState === "cancelled") return "This booking is cancelled.";
  return "Your booking status is still being finalized.";
}

function calendarStatusCopy(result: BookingConfirmationProjection) {
  switch (result.calendarState) {
    case "not_required":
      return "No calendar delivery is currently required.";
    case "create_pending":
      return "Calendar delivery is pending. The invitation is still being finalized.";
    case "created":
      return "The event was created on the contractor's calendar. Invitation delivery to your inbox is not confirmed.";
    case "create_failed":
      return "Calendar delivery needs attention. The invitation has not been verified; contact the contractor for an update.";
    case "cancel_pending":
      return "Calendar removal is pending. An old invitation may still appear; it does not mean the booking is confirmed.";
    case "cancel_failed":
      return "Calendar removal needs attention. An old invitation may still appear even though the booking is cancelled. Contact the contractor for an update.";
    case "cancelled":
      return "The event has been removed from the contractor's calendar. Your calendar may take time to update.";
  }
}

function BookingConfirmation() {
  const { reference } = Route.useSearch();
  const [result, setResult] = useState<BookingConfirmationProjection | null>(null);
  const [error, setError] = useState("");
  const [pollCount, setPollCount] = useState(0);
  const [refreshCount, setRefreshCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void consumeBookingConfirmation({ data: { reference } })
      .then((value) => {
        if (active) setResult(value);
      })
      .catch(() => {
        if (active) setError("This confirmation link is invalid or expired.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [pollCount, reference, refreshCount]);

  useEffect(() => {
    if (!result || !isSettling(result) || pollCount >= MAX_AUTOMATIC_POLLS) return;
    const timer = window.setTimeout(() => setPollCount((value) => value + 1), POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [pollCount, result]);

  const title =
    result?.appointmentState === "confirmed"
      ? "Your appointment is confirmed"
      : result
        ? "Booking status"
        : "Booking confirmation";

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <h1 className="text-3xl font-semibold">{title}</h1>
      {error ? (
        <p className="mt-4 text-destructive" role="alert">
          {error}
        </p>
      ) : result ? (
        <div className="mt-6 rounded-xl border p-5">
          <p className="font-medium">Reference {result.reference}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {new Date(result.startAt).toLocaleString(undefined, {
              dateStyle: "full",
              timeStyle: "short",
              timeZone: result.timeZone,
            })}{" "}
            ({result.timeZone})
          </p>
          <p className="mt-3 text-sm" role="status" aria-live="polite">
            {statusCopy(result)}
          </p>
          {result.paymentState === "disputed" ? (
            <p className="mt-3 text-sm" role="status" aria-live="polite">
              Payment is disputed. Contact the contractor and keep this reference.
            </p>
          ) : null}
          <p className="mt-3 text-sm" role="status" aria-live="polite">
            {calendarStatusCopy(result)}
          </p>
          {isSettling(result) && pollCount >= MAX_AUTOMATIC_POLLS ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Automatic updates have paused. Refresh when you are ready.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-muted-foreground" role="status">
          Loading your confirmation…
        </p>
      )}
      <button
        className="mt-5 underline disabled:opacity-50"
        type="button"
        disabled={loading}
        onClick={() => {
          setPollCount(0);
          setRefreshCount((value) => value + 1);
        }}
      >
        {loading ? "Refreshing…" : "Refresh status"}
      </button>
    </main>
  );
}
