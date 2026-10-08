import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { issueBookingAttachmentDownload } from "@/lib/booking-attachments.functions";
import { contractorLoginRedirect } from "@/lib/auth/contractor-return-path";
import { cancelBooking, getBookingsPage } from "@/lib/bookings.functions";

function firstPayment<T>(value: T[] | null | undefined): T | undefined {
  return value?.[0];
}

export const Route = createFileRoute("/bookings")({
  validateSearch: z.object({ view: z.enum(["future", "past"]).default("future") }),
  loaderDeps: ({ search }) => ({ view: search.view }),
  remountDeps: ({ search }) => search.view,
  loader: async ({ deps }) => {
    try {
      return await getBookingsPage({ data: deps });
    } catch (error) {
      if (error instanceof Error && error.message === "Unauthorized")
        throw redirect(contractorLoginRedirect(`/bookings?view=${deps.view}`));
      throw error;
    }
  },
  component: BookingsPage,
});
function BookingsPage() {
  const initial = Route.useLoaderData();
  const [rows, setRows] = useState(initial.rows);
  const [detail, setDetail] = useState<(typeof rows)[number] | null>(null);
  const [message, setMessage] = useState("");
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationRequestId, setCancellationRequestId] = useState(() => crypto.randomUUID());
  const requestScope = useRef<{ loadingMore: boolean } | null>(null);
  useLayoutEffect(() => {
    const scope = { loadingMore: false };
    requestScope.current = scope;
    return () => {
      if (requestScope.current === scope) requestScope.current = null;
    };
  }, []);
  const future = initial.view === "future";
  async function downloadAttachment(attachmentId: string) {
    const scope = requestScope.current;
    if (!scope) return;
    setMessage("");
    try {
      const { route } = await issueBookingAttachmentDownload({ data: { attachmentId } });
      if (requestScope.current === scope) window.open(route, "_blank", "noopener,noreferrer");
    } catch {
      if (requestScope.current === scope)
        setMessage("This image could not be downloaded. Please try again.");
    }
  }
  async function loadMore() {
    const scope = requestScope.current;
    if (!nextCursor || !scope || scope.loadingMore) return;
    scope.loadingMore = true;
    setLoadingMore(true);
    try {
      const page = await getBookingsPage({
        data: {
          view: initial.view,
          cursorStartAt: nextCursor.startAt,
          cursorId: nextCursor.id,
        },
      });
      if (requestScope.current !== scope) return;
      if (page.view !== initial.view || page.profileId !== initial.profileId)
        throw new Error("The booking view changed");
      setRows((current) => [...current, ...page.rows]);
      setNextCursor(page.nextCursor);
    } catch {
      if (requestScope.current === scope)
        setMessage("More bookings could not be loaded. Please try again.");
    } finally {
      if (requestScope.current === scope) {
        scope.loadingMore = false;
        setLoadingMore(false);
      }
    }
  }
  async function cancel() {
    const scope = requestScope.current;
    if (!detail || !scope) return;
    setMessage("");
    setCancelling(true);
    try {
      await cancelBooking({ data: { appointmentId: detail.id, requestId: cancellationRequestId } });
      if (requestScope.current !== scope) return;
      setRows((current) => current.filter((row) => row.id !== detail.id));
      setDetail(null);
      setConfirming(false);
      setMessage(
        "Booking cancelled. Refund and calendar cancellation are being processed independently.",
      );
    } catch {
      if (requestScope.current === scope)
        setMessage("Cancellation could not be completed. Please try again.");
    } finally {
      if (requestScope.current === scope) setCancelling(false);
    }
  }
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">My Bookings</h1>
          <p className="mt-1 text-muted-foreground">
            Review customer appointments and independent payment, refund, and calendar status.
          </p>
        </div>
        <Link
          to="/user/$userId"
          params={{ userId: initial.profileId }}
          search={{ websiteId: initial.availabilityWebsiteId ?? undefined }}
          hash="step-3"
          aria-disabled={!initial.availabilityWebsiteId}
          className={`text-sm underline ${!initial.availabilityWebsiteId ? "pointer-events-none opacity-50" : ""}`}
        >
          Availability Settings
        </Link>
      </div>
      <nav className="mt-7 flex gap-2">
        <Button asChild variant={future ? "default" : "outline"}>
          <Link to="/bookings" search={{ view: "future" }}>
            Future
          </Link>
        </Button>
        <Button asChild variant={!future ? "default" : "outline"}>
          <Link to="/bookings" search={{ view: "past" }}>
            Past Bookings
          </Link>
        </Button>
      </nav>
      {message ? (
        <p className="mt-5" role="status">
          {message}
        </p>
      ) : null}
      <div className="mt-6 grid gap-4">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            No {future ? "future" : "past"} bookings.
          </div>
        ) : (
          rows.map((row) => (
            <button
              key={row.id}
              className="rounded-xl border bg-card p-5 text-left hover:border-primary/40"
              onClick={() => {
                setDetail(row);
                setCancellationRequestId(crypto.randomUUID());
              }}
            >
              <div className="flex justify-between gap-4">
                <div>
                  <p className="font-semibold">
                    {String((row.customer_snapshot as { name?: unknown }).name ?? "Customer")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {new Date(row.start_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: row.time_zone,
                    })}
                    {" – "}
                    {new Date(row.end_at).toLocaleTimeString(undefined, {
                      timeStyle: "short",
                      timeZone: row.time_zone,
                    })}
                    {" · "}
                    {row.time_zone}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Source website {row.website_id.slice(0, 8)}
                  </p>
                </div>
                <span className="text-sm capitalize">
                  {row.appointment_state.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-3 text-sm">
                Paid:{" "}
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: row.currency,
                }).format((firstPayment(row.booking_payments)?.amount_paid_minor ?? 0) / 100)}{" "}
                · Payment: {row.payment_state} · Refund: {row.refund_state} · Calendar:{" "}
                {row.calendar_state}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Service address:{" "}
                {JSON.stringify(
                  (row.customer_snapshot as { address?: unknown }).address ?? "Not provided",
                )}
              </p>
            </button>
          ))
        )}
      </div>
      {nextCursor ? (
        <div className="mt-6 text-center">
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more bookings"}
          </Button>
        </div>
      ) : null}
      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Booking details</DialogTitle>
            <DialogDescription>Reference {detail?.public_reference}</DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3 text-sm">
              <p>
                <strong>Customer:</strong>{" "}
                {String((detail.customer_snapshot as { name?: unknown }).name ?? "")}
              </p>
              <p>
                <strong>Email:</strong>{" "}
                {String((detail.customer_snapshot as { email?: unknown }).email ?? "")}
              </p>
              <p>
                <strong>Phone:</strong>{" "}
                {String((detail.customer_snapshot as { phone?: unknown }).phone ?? "")}
              </p>
              <p>
                <strong>Service:</strong>{" "}
                {String((detail.service_snapshot as { name?: unknown }).name ?? "")}
              </p>
              <p>
                <strong>When:</strong>{" "}
                {new Date(detail.start_at).toLocaleString(undefined, {
                  dateStyle: "full",
                  timeStyle: "short",
                  timeZone: detail.time_zone,
                })}
              </p>
              <p>
                <strong>Address:</strong>{" "}
                {JSON.stringify(
                  (detail.customer_snapshot as { address?: unknown }).address ?? "Not provided",
                )}
              </p>
              <p>
                <strong>Notes:</strong>{" "}
                {String((detail.customer_snapshot as { notes?: unknown }).notes ?? "None")}
              </p>
              <p>
                <strong>Source website:</strong> {detail.website_id}
              </p>
              <div>
                <strong>Customer images:</strong>
                {detail.booking_attachments.length ? (
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {detail.booking_attachments.map((attachment) => (
                      <li key={attachment.id}>
                        <button
                          type="button"
                          className="underline"
                          onClick={() => void downloadAttachment(attachment.id)}
                        >
                          {attachment.display_filename}
                        </button>{" "}
                        <span className="text-muted-foreground">
                          ({Math.max(1, Math.ceil(attachment.byte_size / 1024))} KB)
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="ml-1 text-muted-foreground">No clean images</span>
                )}
              </div>
              <p>
                <strong>Amount:</strong>{" "}
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: detail.currency,
                }).format(detail.amount_minor / 100)}{" "}
                · refunded{" "}
                {new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: detail.currency,
                }).format(
                  (firstPayment(detail.booking_payments)?.amount_refunded_minor ?? 0) / 100,
                )}
              </p>
              <p>
                <strong>Paid:</strong>{" "}
                {firstPayment(detail.booking_payments)?.paid_at
                  ? new Date(firstPayment(detail.booking_payments)!.paid_at!).toLocaleString()
                  : "Not yet"}
              </p>
              <p>
                <strong>Booked:</strong> {new Date(detail.created_at).toLocaleString()}{" "}
                {detail.cancelled_at
                  ? ` · Cancelled ${new Date(detail.cancelled_at).toLocaleString()}`
                  : ""}
              </p>
              <p>
                <strong>Status:</strong> payment {detail.payment_state}, refund{" "}
                {detail.refund_state}, calendar {detail.calendar_state}, review{" "}
                {detail.review_state}
              </p>
              {future &&
              detail.appointment_state === "confirmed" &&
              detail.payment_state === "paid" ? (
                confirming ? (
                  <div
                    className="rounded-lg border border-destructive/40 p-3"
                    role="alertdialog"
                    aria-label="Confirm booking cancellation"
                  >
                    <p>
                      This cancels{" "}
                      {String(
                        (detail.customer_snapshot as { name?: unknown }).name ?? "this customer",
                      )}{" "}
                      at {new Date(detail.start_at).toLocaleString()} and refunds{" "}
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: detail.currency,
                      }).format(
                        ((firstPayment(detail.booking_payments)?.amount_paid_minor ?? 0) -
                          (firstPayment(detail.booking_payments)?.amount_refunded_minor ?? 0)) /
                          100,
                      )}
                      . Rescheduling is unavailable.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={cancelling}
                        onClick={() => void cancel()}
                      >
                        {cancelling ? "Cancelling…" : "Confirm cancellation"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={cancelling}
                        onClick={() => setConfirming(false)}
                      >
                        Keep booking
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="destructive" onClick={() => setConfirming(true)}>
                    Cancel Booking
                  </Button>
                )
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
