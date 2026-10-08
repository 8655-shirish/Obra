import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  bookingConfirmationNonceHash,
  bookingCookieName,
  bookingReceiptToken,
} from "@/lib/booking-receipt.server";

const referenceSchema = z.string().uuid();
const sessionSchema = z.string().regex(/^cs_[A-Za-z0-9_]+$/);

const confirmationProjectionSchema = z.object({
  reference: z.string().uuid(),
  environment: z.enum(["test", "live"]),
  checkoutSessionId: z.string().min(1),
  startAt: z.string(),
  endAt: z.string(),
  timeZone: z.string(),
  service: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  location: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  appointmentState: z.enum(["held", "payment_pending", "confirmed", "cancelled"]),
  appointmentReason: z.string().nullable(),
  paymentState: z.enum(["not_started", "creating", "pending", "paid", "failed", "disputed"]),
  refundState: z.enum(["not_requested", "pending", "succeeded", "failed"]),
  calendarState: z.enum([
    "not_required",
    "create_pending",
    "created",
    "create_failed",
    "cancel_pending",
    "cancelled",
    "cancel_failed",
  ]),
  reviewState: z.enum([
    "none",
    "late_payment",
    "refund_failure",
    "calendar_reconciliation",
    "provider_inconsistency",
    "unresolved_destination",
  ]),
  reservationExpiresAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  updatedAt: z.string(),
  statusCode: z.enum([
    "payment_pending",
    "payment_pending_prolonged",
    "payment_failed",
    "unpaid_expired",
    "late_payment_recovered",
    "late_payment_refund_pending",
    "refund_pending",
    "refund_succeeded",
    "refund_failed",
    "confirmed_calendar_pending",
    "confirmed_calendar_ready",
    "confirmed_calendar_failed",
    "cancelled_calendar_pending",
    "cancelled_calendar_failed",
    "cancelled",
    "settling",
  ]),
  terminal: z.boolean(),
  pollAfterMs: z.number().int().positive().nullable(),
  automaticPollUntil: z.string().nullable(),
});

export type BookingConfirmationProjection = z.infer<typeof confirmationProjectionSchema>;

function hash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function timingSafeToken(actual: string, expected: string) {
  const left = Buffer.from(hash(actual), "hex");
  const right = Buffer.from(hash(expected), "hex");
  return timingSafeEqual(left, right);
}

async function clientBucket(request: Request, sessionId: string) {
  const address = request.headers.get("cf-connecting-ip")?.trim();
  const secret = process.env["BOOKING_RATE_LIMIT_SECRET"]?.trim();
  if (!address || !secret) throw new Error("Booking confirmation is unavailable");
  const bucket = createHmac("sha256", secret).update(address).digest("hex");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: admitted, error } = await supabaseAdmin.rpc("check_public_booking_rate_limit", {
    p_scope_key: hash(sessionId),
    p_action: "confirmation",
    p_client_bucket: bucket,
    p_limit: 10,
    p_window_seconds: 300,
  });
  if (error || admitted !== true)
    throw new Error("Booking confirmation is temporarily unavailable");
  return supabaseAdmin;
}

export async function exchangeBookingReturn(request: Request) {
  const url = new URL(request.url);
  const parsedSession = sessionSchema.safeParse(url.searchParams.get("session_id"));
  if (!parsedSession.success) throw new Error("Booking confirmation is unavailable");
  const sessionId = parsedSession.data;
  const supabaseAdmin = await clientBucket(request, sessionId);
  const { data: payment } = await supabaseAdmin
    .from("booking_payments")
    .select("appointment_id,profile_id,environment,stripe_account_id,payment_state")
    .eq("checkout_session_id", sessionId)
    .single();
  if (!payment?.stripe_account_id) throw new Error("Booking confirmation is unavailable");
  const { data: appointment } = await supabaseAdmin
    .from("appointments")
    .select("public_reference")
    .eq("id", payment.appointment_id)
    .single();
  if (!appointment) throw new Error("Booking confirmation is unavailable");
  const reference = referenceSchema.parse(appointment.public_reference);
  const confirmationSecret = process.env["BOOKING_CONFIRMATION_SECRET"]?.trim();
  if (!confirmationSecret) throw new Error("Booking confirmation is unavailable");
  const { getCookie, serializeCookie } = await import("@/lib/auth/cookies.server");
  const handoffName = bookingCookieName("handoff", reference, confirmationSecret);
  const confirmationNonce = getCookie(handoffName, request);
  if (!confirmationNonce) throw new Error("Booking confirmation is unavailable");
  const { data: handoff, error: handoffError } = await supabaseAdmin.rpc(
    "recover_booking_checkout_handoff_v3" as never,
    {
      p_appointment_id: payment.appointment_id,
      p_nonce_hash: bookingConfirmationNonceHash(confirmationNonce),
    } as never,
  );
  if (handoffError || !handoff) throw new Error("Booking confirmation is unavailable");

  const { billingEnvironment, getStripe } = await import("@/lib/stripe.server");
  if (billingEnvironment() !== payment.environment)
    throw new Error("Booking confirmation is unavailable");
  const session = await getStripe().checkout.sessions.retrieve(
    sessionId,
    {},
    { stripeAccount: payment.stripe_account_id },
  );
  if (
    session.metadata?.kind !== "booking" ||
    session.metadata.appointmentId !== payment.appointment_id ||
    session.metadata.profileId !== payment.profile_id ||
    session.metadata.environment !== payment.environment
  )
    throw new Error("Booking confirmation is unavailable");
  // Stripe identity is verified here, but payment truth is reduced only from signed inbox evidence.
  // A valid return may therefore issue a receipt while its projection is still payment_pending.

  const token = bookingReceiptToken(payment.environment, sessionId, confirmationSecret);
  const { error } = await supabaseAdmin.rpc(
    "issue_booking_confirmation_capability_v3" as never,
    {
      p_checkout_session_id: sessionId,
      p_token_hash: hash(token),
      p_nonce_hash: bookingConfirmationNonceHash(confirmationNonce),
    } as never,
  );
  if (error) throw new Error("Booking confirmation is unavailable");
  const receiptName = bookingCookieName("receipt", reference, confirmationSecret);
  return {
    location: "/booking/confirmation?reference=" + encodeURIComponent(reference),
    cookie: serializeCookie(receiptName, token, {
      path: "/",
      maxAge: 24 * 60 * 60,
      sameSite: "lax",
      secure: true,
    }),
  };
}

export const consumeBookingConfirmation = createServerFn({ method: "POST" })
  .validator((value: unknown) => z.object({ reference: referenceSchema }).parse(value))
  .handler(async ({ data }) => {
    const secret = process.env["BOOKING_CONFIRMATION_SECRET"]?.trim();
    if (!secret) throw new Error("This confirmation session is invalid or expired");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { getCookie } = await import("@/lib/auth/cookies.server");
    const token = getCookie(bookingCookieName("receipt", data.reference, secret), getRequest());
    if (!token) throw new Error("This confirmation session is invalid or expired");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: confirmation, error } = await supabaseAdmin.rpc(
      "consume_booking_confirmation_capability_v3" as never,
      { p_token_hash: hash(token), p_reference: data.reference } as never,
    );
    if (error || !confirmation) throw new Error("This confirmation link is invalid or expired");
    const parsed = confirmationProjectionSchema.parse(confirmation);
    const expectedToken = bookingReceiptToken(parsed.environment, parsed.checkoutSessionId, secret);
    if (!timingSafeToken(token, expectedToken))
      throw new Error("This confirmation link is invalid or expired");
    return parsed;
  });
