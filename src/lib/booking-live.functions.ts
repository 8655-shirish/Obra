import { rpcNull } from "@/lib/rpc-nullable";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import Stripe from "stripe";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { checkoutSchema, type BookingCheckoutResult } from "@/lib/booking-checkout";

import {
  BOOKING_CONSENT_DIGEST,
  BOOKING_CONSENT_DOCUMENT_ID,
  BOOKING_CONSENT_VERSION,
} from "@/lib/booking-consent";
import {
  bookingConfirmationNonceHash,
  bookingCookieName,
  bookingHandoffExpiresAt,
  bookingHandoffMaxAge,
  bookingRequestCapabilityHash,
  bookingRequestCookieName,
} from "@/lib/booking-receipt.server";

const slotsSchema = z.object({
  websiteId: z.string().uuid(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayCount: z.number().int().min(1).max(31).default(14),
});
const optionalAttachmentsSchema = z
  .array(
    z.object({
      filename: z.string().min(1).max(255),
      mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      byteSize: z.number().int().positive().max(10_485_760),
      base64: z
        .string()
        .min(1)
        .max(Math.ceil((10_485_760 * 4) / 3) + 4),
    }),
  )
  .max(5);

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function checkoutRequestHash(data: z.infer<typeof checkoutSchema>) {
  // Optional file bytes never participate in booking idempotency or payment admission.
  const { attachments: _attachments, ...booking } = data;
  return stableHash(booking);
}

async function uploadOptionalBookingAttachments(
  appointmentId: string,
  attachments: unknown,
  uploadContext: { id: string; token: string },
) {
  if (attachments === undefined) return;
  const parsed = optionalAttachmentsSchema.safeParse(attachments);
  if (!parsed.success) throw new Error("Booking attachments are invalid");
  if (!parsed.data.length) return;
  const { getBookingAttachmentCapability, uploadPreparedBookingAttachments } =
    await import("@/lib/booking-attachments.functions");
  if (!(await getBookingAttachmentCapability()).enabled)
    throw new Error("Booking attachments are temporarily unavailable");
  await uploadPreparedBookingAttachments({
    appointmentId,
    contextId: uploadContext.id,
    contextToken: uploadContext.token,
    attachments: parsed.data,
  });
}

function bookingEnabled() {
  return (
    process.env.BOOKING_LIVE_ENABLED === "true" && process.env.BOOKING_WORKER_MODE === "active"
  );
}

async function bookingBrowserCapability(websiteId: string, secret: string, issue: boolean) {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { getCookie } = await import("@/lib/auth/cookies.server");
  const cookieName = bookingRequestCookieName(websiteId, secret);
  const existing = getCookie(cookieName, getRequest());
  if (existing) return { cookieName, value: existing };
  if (!issue) throw new Error("Refresh available booking times before continuing");
  return { cookieName, value: randomBytes(32).toString("base64url") };
}

async function trustedClientBucket() {
  const { getRequest } = await import("@tanstack/react-start/server");
  const address = getRequest()?.headers.get("cf-connecting-ip")?.trim();
  const secret =
    process.env["BOOKING_RATE_LIMIT_SECRET"]?.trim() ||
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  if (!address || !secret) throw new Error("Online booking is temporarily unavailable");
  return createHmac("sha256", secret).update(address).digest("hex");
}

export const getLiveBookingSlots = createServerFn({ method: "GET" })
  .validator((value: unknown) => slotsSchema.parse(value))
  .handler(async ({ data }) => {
    if (!bookingEnabled()) throw new Error("Online booking is temporarily unavailable");
    const clientBucket = await trustedClientBucket();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: admitted, error: rateError } = await supabaseAdmin.rpc(
      "check_public_booking_rate_limit",
      {
        p_scope_key: data.websiteId,
        p_action: "slots",
        p_client_bucket: clientBucket,
        p_limit: 30,
        p_window_seconds: 60,
      },
    );
    if (rateError || admitted !== true)
      throw new Error("Online booking is temporarily unavailable");
    const confirmationSecret = process.env["BOOKING_CONFIRMATION_SECRET"]?.trim();
    if (!confirmationSecret) throw new Error("Online booking is temporarily unavailable");
    const browserCapability = await bookingBrowserCapability(
      data.websiteId,
      confirmationSecret,
      true,
    );
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    const { serializeCookie } = await import("@/lib/auth/cookies.server");
    setResponseHeader(
      "Set-Cookie",
      serializeCookie(browserCapability.cookieName, browserCapability.value, {
        path: "/",
        maxAge: 24 * 60 * 60,
        sameSite: "lax",
        secure: true,
      }),
    );
    const { findAvailableBookingSlots } = await import("@/lib/booking-availability.server");
    return findAvailableBookingSlots(data);
  });

export const createLiveBookingCheckout = createServerFn({ method: "POST" })
  .validator((value: unknown) => checkoutSchema.parse(value))
  .handler(async ({ data }): Promise<BookingCheckoutResult> => {
    const clientBucket = await trustedClientBucket();
    const { findAvailableBookingSlots, loadLiveBookingSettings } =
      await import("@/lib/booking-availability.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: website, error: websiteError } = await supabaseAdmin
      .from("websites")
      .select("id,user_id,environment")
      .eq("id", data.websiteId)
      .single();
    if (
      websiteError ||
      website?.id !== data.websiteId ||
      !["test", "live"].includes(website.environment)
    )
      throw new Error("Booking is unavailable");
    const environment = website.environment as "test" | "live";
    const { billingEnvironment } = await import("@/lib/stripe.server");
    if (billingEnvironment() !== environment)
      throw new Error("Stripe key mode does not match booking environment");
    const handoffSecret = process.env["BOOKING_CONFIRMATION_SECRET"]?.trim();
    if (!handoffSecret) throw new Error("Booking confirmation is unavailable");
    const browserCapability = await bookingBrowserCapability(data.websiteId, handoffSecret, false);
    const requestCapability = {
      value: browserCapability.value,
      hash: bookingRequestCapabilityHash(data.requestId, browserCapability.value, handoffSecret),
    };
    const requestHash = checkoutRequestHash(data);
    const { data: replay, error: replayError } = await supabaseAdmin
      .from("appointment_operations")
      .select("id,appointment_id,request_hash,request_capability_hash")
      .eq("profile_id", website.user_id)
      .eq("environment", environment)
      .eq("operation_type", "reserve")
      .eq("client_request_id", data.requestId)
      .maybeSingle();
    if (replayError) throw new Error("Unable to read booking request");
    if (replay && replay.request_hash !== requestHash)
      throw new Error("Booking request identity conflict");
    if (replay && replay.request_capability_hash !== requestCapability.hash)
      throw new Error("Booking request belongs to another browser");
    let appointmentId = replay?.appointment_id ?? null;
    if (!replay) {
      let fresh: Awaited<ReturnType<typeof findAvailableBookingSlots>>;
      try {
        if (!bookingEnabled() || process.env.BOOKING_WORKER_ENVIRONMENT !== environment)
          return { status: "not_attempted", code: "booking_unavailable" };
        const { data: admitted, error: rateError } = await supabaseAdmin.rpc(
          "check_public_booking_rate_limit",
          {
            p_scope_key: data.websiteId,
            p_action: "slots",
            p_client_bucket: clientBucket,
            p_limit: 30,
            p_window_seconds: 60,
          },
        );
        if (rateError || admitted !== true)
          return { status: "not_attempted", code: "booking_unavailable" };
        const settings = await loadLiveBookingSettings(data.websiteId);
        if (settings.website.user_id !== website.user_id || settings.environment !== environment)
          return { status: "not_attempted", code: "booking_unavailable" };
        fresh = await findAvailableBookingSlots(
          { websiteId: data.websiteId, fromDate: data.localDate, dayCount: 1 },
          settings,
        );
      } catch {
        return { status: "not_attempted", code: "booking_unavailable" };
      }
      if (
        !fresh.slots.some(
          (slot) => slot.startAt === data.startAt && slot.localStart === data.localStart,
        )
      )
        return { status: "not_attempted", code: "slot_unavailable" };
      // After dispatch, neither transport errors nor a failed duplicate RPC prove
      // that another attempt with this request ID cannot still reserve the time.
      const { data: reservation, error: reserveError } = await supabaseAdmin.rpc(
        "reserve_live_booking",
        {
          p_website_id: data.websiteId,
          p_environment: environment,
          p_start_at: data.startAt,
          p_local_date: data.localDate,
          p_local_start: data.localStart,
          p_time_zone: data.timeZone,
          p_client_request_id: data.requestId,
          p_request_hash: requestHash,
          p_request_capability_hash: requestCapability.hash,
          p_consent_document_id: BOOKING_CONSENT_DOCUMENT_ID,
          p_consent_version: BOOKING_CONSENT_VERSION,
          p_consent_digest: BOOKING_CONSENT_DIGEST,
          p_customer: data.customer,
          p_freebusy_observed_at: fresh.observedAt,
          p_availability_generation: fresh.availabilityGeneration,
          p_calendar_set_hash: fresh.calendarSetHash,
          p_rate_limit_key: stableHash({ websiteId: data.websiteId, clientBucket }),
        },
      );
      if (
        reserveError ||
        !reservation ||
        typeof reservation !== "object" ||
        Array.isArray(reservation)
      )
        throw new Error("Unable to reserve that time");
      appointmentId =
        typeof reservation.appointmentId === "string" ? reservation.appointmentId : null;
    }
    if (!appointmentId) throw new Error("Unable to reserve that time");
    const [paymentResult, appointmentResult, operationResult] = await Promise.all([
      supabaseAdmin
        .from("booking_payments")
        .select("*")
        .eq("appointment_id", appointmentId)
        .eq("profile_id", website.user_id)
        .eq("environment", environment)
        .single(),
      supabaseAdmin
        .from("appointments")
        .select(
          "id,website_id,profile_id,environment,public_reference,booking_contract_version,appointment_state,payment_state,reservation_expires_at,cancellation_requested_at,service_snapshot,customer_snapshot,amount_minor,currency,calendar_destination_epoch_id",
        )
        .eq("id", appointmentId)
        .eq("profile_id", website.user_id)
        .eq("environment", environment)
        .eq("website_id", data.websiteId)
        .single(),
      replay
        ? { data: replay, error: null }
        : supabaseAdmin
            .from("appointment_operations")
            .select("id,appointment_id,request_hash,request_capability_hash")
            .eq("appointment_id", appointmentId)
            .eq("profile_id", website.user_id)
            .eq("environment", environment)
            .eq("operation_type", "reserve")
            .eq("client_request_id", data.requestId)
            .single(),
    ]);
    const priorPayment = paymentResult.data;
    const reservedAppointment = appointmentResult.data;
    const operation = operationResult.data;
    const unavailable =
      "This booking is being reconciled or is no longer payable. Check its status before trying again.";
    if (
      paymentResult.error ||
      appointmentResult.error ||
      operationResult.error ||
      !priorPayment ||
      !reservedAppointment ||
      !operation?.id ||
      operation.appointment_id !== appointmentId ||
      operation.request_hash !== requestHash ||
      operation.request_capability_hash !== requestCapability.hash ||
      reservedAppointment.id !== appointmentId ||
      reservedAppointment.website_id !== data.websiteId ||
      reservedAppointment.profile_id !== website.user_id ||
      reservedAppointment.environment !== environment ||
      reservedAppointment.booking_contract_version !== 2 ||
      priorPayment.appointment_id !== appointmentId ||
      priorPayment.profile_id !== website.user_id ||
      priorPayment.environment !== environment ||
      priorPayment.booking_contract_version !== 2 ||
      priorPayment.checkout_operation_id !== operation.id ||
      !priorPayment.stripe_account_id ||
      reservedAppointment.cancellation_requested_at ||
      !["held", "payment_pending"].includes(reservedAppointment.appointment_state)
    )
      throw new Error(unavailable);
    const publicReference = reservedAppointment.public_reference;
    const confirmationSecret = handoffSecret;
    const confirmationNonce = requestCapability.value;
    const confirmationNonceHash = bookingConfirmationNonceHash(confirmationNonce);
    const resumeSession = async (sessionId: string) => {
      const { getStripe } = await import("@/lib/stripe.server");
      const prior = await getStripe().checkout.sessions.retrieve(
        sessionId,
        {},
        { stripeAccount: priorPayment.stripe_account_id!, timeout: 8_000, maxNetworkRetries: 0 },
      );
      if (!prior.url || prior.status !== "open" || prior.expires_at * 1000 <= Date.now())
        throw new Error(unavailable);
      const { data: recovered, error: recoveryError } = await supabaseAdmin.rpc(
        "recover_booking_checkout_handoff_v3" as never,
        { p_appointment_id: appointmentId, p_nonce_hash: confirmationNonceHash } as never,
      );
      if (recoveryError || !recovered) throw new Error("Booking handoff cannot be recovered");
      const { setResponseHeader } = await import("@tanstack/react-start/server");
      const { serializeCookie } = await import("@/lib/auth/cookies.server");
      setResponseHeader(
        "Set-Cookie",
        serializeCookie(
          bookingCookieName("handoff", publicReference, handoffSecret),
          confirmationNonce,
          {
            path: "/booking/return",
            maxAge: bookingHandoffMaxAge(prior.expires_at * 1000),
            sameSite: "lax",
            secure: true,
          },
        ),
      );
      return {
        status: "checkout_ready" as const,
        checkoutUrl: prior.url,
        expiresAt: new Date(prior.expires_at * 1000).toISOString(),
      };
    };
    if (priorPayment.checkout_session_id) {
      if (
        priorPayment.payment_state !== "pending" ||
        reservedAppointment.payment_state !== "pending" ||
        reservedAppointment.appointment_state !== "payment_pending"
      )
        throw new Error(unavailable);
      return resumeSession(priorPayment.checkout_session_id);
    }
    // Existing Checkout reads and receipts remain available while off. Starting
    // or reclaiming a provider mutation requires servicing, not new admission.
    if (
      !["active", "drain"].includes(process.env.BOOKING_WORKER_MODE ?? "") ||
      process.env.BOOKING_WORKER_ENVIRONMENT !== environment
    )
      throw new Error("Online booking is temporarily unavailable");
    // A handoff deadline is persisted before dispatch. Once present, the worker owns ambiguity.
    // A lost claim response without that deadline can be reclaimed under the existing SQL lease.
    if (
      reservedAppointment.appointment_state !== "held" ||
      !reservedAppointment.calendar_destination_epoch_id ||
      !reservedAppointment.reservation_expires_at ||
      !(Date.parse(reservedAppointment.reservation_expires_at) > Date.now()) ||
      !["not_started", "creating"].includes(priorPayment.payment_state) ||
      reservedAppointment.payment_state !== priorPayment.payment_state ||
      priorPayment.checkout_provider_expires_at !== null ||
      priorPayment.confirmation_handoff_expires_at !== null ||
      priorPayment.confirmation_nonce_hash !== null ||
      priorPayment.payment_intent_id !== null ||
      priorPayment.charge_id !== null ||
      !priorPayment.checkout_idempotency_key ||
      (priorPayment.checkout_lease_expires_at !== null &&
        !(Date.parse(priorPayment.checkout_lease_expires_at) <= Date.now()))
    )
      throw new Error(unavailable);
    const serviceSnapshot = z
      .object({ name: z.string().min(1) })
      .parse(reservedAppointment.service_snapshot);
    const customerSnapshot = z
      .object({ email: z.string().email() })
      .parse(reservedAppointment.customer_snapshot);
    if (
      !Number.isSafeInteger(priorPayment.expected_amount_minor) ||
      priorPayment.expected_amount_minor <= 0 ||
      priorPayment.expected_amount_minor !== reservedAppointment.amount_minor ||
      priorPayment.currency !== reservedAppointment.currency
    )
      throw new Error(unavailable);
    const leaseToken = randomUUID();
    const { data: payment, error: claimError } = await supabaseAdmin.rpc("claim_booking_checkout", {
      p_appointment_id: appointmentId,
      p_operation_id: operation.id,
      p_lease_token: leaseToken,
    });
    if (claimError || !payment) throw new Error("Unable to create checkout");
    if (
      payment.id !== priorPayment.id ||
      payment.appointment_id !== appointmentId ||
      payment.profile_id !== website.user_id ||
      payment.environment !== environment ||
      payment.booking_contract_version !== 2 ||
      payment.checkout_operation_id !== operation.id ||
      payment.stripe_account_id !== priorPayment.stripe_account_id ||
      payment.checkout_idempotency_key !== priorPayment.checkout_idempotency_key ||
      payment.expected_amount_minor !== priorPayment.expected_amount_minor ||
      payment.currency !== priorPayment.currency
    )
      throw new Error(unavailable);
    // Another request can have finished checkout between our read and this atomic claim.
    if (payment.checkout_session_id && payment.payment_state === "pending")
      return resumeSession(payment.checkout_session_id);
    if (
      payment.payment_state !== "creating" ||
      payment.checkout_lease_token !== leaseToken ||
      !Number.isSafeInteger(payment.checkout_fencing_token) ||
      payment.checkout_fencing_token < 1 ||
      !payment.checkout_lease_expires_at ||
      !(Date.parse(payment.checkout_lease_expires_at) > Date.now()) ||
      payment.checkout_provider_expires_at !== null ||
      payment.checkout_session_id !== null ||
      payment.confirmation_handoff_expires_at !== null ||
      payment.confirmation_nonce_hash !== null
    )
      throw new Error(unavailable);
    const requestedProviderDeadline = new Date(Date.now() + 31 * 60_000).toISOString();
    const handoffExpiresAt = bookingHandoffExpiresAt(requestedProviderDeadline).toISOString();
    const { data: handoff, error: handoffError } = await supabaseAdmin.rpc(
      "prepare_booking_checkout_handoff_v3" as never,
      {
        p_payment_id: payment.id,
        p_lease_token: leaseToken,
        p_fencing_token: payment.checkout_fencing_token,
        p_provider_expires_at: requestedProviderDeadline,
        p_handoff_expires_at: handoffExpiresAt,
        p_nonce_hash: confirmationNonceHash,
      } as never,
    );
    if (handoffError || !handoff) throw new Error("Unable to secure booking handoff");
    const { providerExpiresAt: providerDeadline, handoffExpiresAt: authoritativeHandoffExpiry } =
      handoff as unknown as { providerExpiresAt: string; handoffExpiresAt: string };
    if (
      Date.parse(providerDeadline) !== Date.parse(requestedProviderDeadline) ||
      Date.parse(authoritativeHandoffExpiry) !== Date.parse(handoffExpiresAt) ||
      !(Date.parse(payment.checkout_lease_expires_at) > Date.now())
    )
      throw new Error("Unable to secure booking handoff");
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    const { serializeCookie } = await import("@/lib/auth/cookies.server");
    setResponseHeader("Set-Cookie", [
      serializeCookie(
        bookingCookieName("handoff", publicReference, confirmationSecret),
        confirmationNonce,
        {
          path: "/booking/return",
          maxAge: Math.max(
            1,
            Math.ceil((Date.parse(authoritativeHandoffExpiry) - Date.now()) / 1000),
          ),
          sameSite: "lax",
          secure: true,
        },
      ),
    ]);
    const { getStripe, publicAppUrl } = await import("@/lib/stripe.server");
    let session: Stripe.Checkout.Session;
    try {
      session = await getStripe().checkout.sessions.create(
        {
          mode: "payment",
          payment_method_types: ["card"],
          customer_email: customerSnapshot.email,
          line_items: [
            {
              price_data: {
                currency: payment.currency.toLowerCase(),
                unit_amount: payment.expected_amount_minor,
                product_data: { name: serviceSnapshot.name },
              },
              quantity: 1,
            },
          ],
          metadata: {
            kind: "booking",
            appointmentId,
            profileId: website.user_id,
            environment,
          },
          payment_intent_data: { metadata: { kind: "booking", appointmentId } },
          success_url: publicAppUrl() + "/booking/return?session_id={CHECKOUT_SESSION_ID}",
          cancel_url:
            publicAppUrl() + "/lp/" + encodeURIComponent(data.websiteId) + "?booking=cancelled",
          expires_at: Math.floor(Date.parse(providerDeadline) / 1000),
        },
        {
          stripeAccount: priorPayment.stripe_account_id,
          idempotencyKey: priorPayment.checkout_idempotency_key,
        },
      );
      if (!session.url) throw new Error("Stripe did not return Checkout URL");
    } catch (error) {
      const definitelyFailed =
        error instanceof Stripe.errors.StripeInvalidRequestError ||
        error instanceof Stripe.errors.StripeAuthenticationError ||
        error instanceof Stripe.errors.StripePermissionError;
      await supabaseAdmin.rpc("settle_booking_checkout", {
        p_payment_id: payment.id,
        p_lease_token: leaseToken,
        p_fencing_token: payment.checkout_fencing_token,
        p_session_id: "",
        p_expires_at: rpcNull,
        p_succeeded: false,
        p_ambiguous: !definitelyFailed,
        p_safe_error: definitelyFailed
          ? "Checkout creation failed"
          : "Checkout creation requires reconciliation",
      });
      throw error;
    }
    const { data: settledPayment, error: settlementError } = await supabaseAdmin.rpc(
      "settle_booking_checkout",
      {
        p_payment_id: payment.id,
        p_lease_token: leaseToken,
        p_fencing_token: payment.checkout_fencing_token,
        p_session_id: session.id,
        p_expires_at: new Date(session.expires_at * 1000).toISOString(),
        p_succeeded: true,
        p_ambiguous: false,
        p_safe_error: rpcNull,
      },
    );
    if (
      settlementError ||
      settledPayment?.id !== payment.id ||
      settledPayment.appointment_id !== appointmentId ||
      settledPayment.profile_id !== website.user_id ||
      settledPayment.environment !== environment ||
      settledPayment.checkout_session_id !== session.id ||
      settledPayment.payment_state !== "pending"
    )
      throw new Error(
        "Checkout was created and is being reconciled; retry this same booking request",
      );
    // Optional files never own checkout liveness. Their existing consent-bound upload authority
    // still validates bytes, scanner readiness, quotas and the browser's upload context.
    await uploadOptionalBookingAttachments(appointmentId, data.attachments, {
      id: appointmentId,
      token: confirmationNonce,
    }).catch(() => undefined);
    return {
      status: "checkout_ready",
      checkoutUrl: session.url,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
    };
  });
