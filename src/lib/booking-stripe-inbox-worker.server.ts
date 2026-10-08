import { randomUUID } from "node:crypto";

import { bookingWorker } from "@/integrations/supabase/booking-worker.server";
import { billingEnvironment, getStripe } from "@/lib/stripe.server";
import { workerCanContinue, workerProviderContext } from "@/lib/worker-deadline.server";
import { bookingStripeFailure } from "@/lib/booking-stripe-failure.server";

function providerJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

class StaleBookingPaymentEventLeaseError extends Error {}

async function fail(eventId: string, leaseToken: string, fence: number, errorCause: unknown) {
  const failure = bookingStripeFailure(errorCause);
  const { data, error } = await bookingWorker.rpc("fail_booking_payment_event_v3", {
    p_event_id: eventId,
    p_lease_token: leaseToken,
    p_fencing_token: fence,
    p_retryable: failure.retryable,
    p_retry_delay_seconds: failure.retryDelaySeconds,
    p_safe_error: "Booking payment event processing failed",
  } as never);
  if (error) throw error;
  return data === true;
}

type StripeObject = Record<string, unknown>;
type BookingInboxRow = {
  id: string;
  profile_id: string | null;
  environment: string;
  account_context: string;
  event_type: string;
  payload: { data?: { object?: StripeObject } };
  fencing_token: number;
};

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

async function listAllRefunds(
  chargeId: string,
  stripeAccount: string,
  renewLease: () => Promise<void>,
) {
  const refunds: StripeObject[] = [];
  let startingAfter: string | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    await renewLease();
    const page = await getStripe().refunds.list(
      { charge: chargeId, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) },
      { stripeAccount },
    );
    refunds.push(...(page.data as unknown as StripeObject[]));
    if (!page.has_more) return { refunds, refundsHasMore: false };
    const nextCursor = page.data.at(-1)?.id;
    if (!nextCursor || nextCursor === startingAfter || seenCursors.has(nextCursor))
      throw new Error("Stripe refund pagination did not advance");
    seenCursors.add(nextCursor);
    startingAfter = nextCursor;
  }
}

async function loadBookingStripeSnapshot(row: BookingInboxRow, renewLease: () => Promise<void>) {
  const stripeAccountId = row.account_context;
  const object = row.payload.data?.object ?? {};
  let checkoutId: string | null = null;
  let paymentIntentId: string | null = null;
  let chargeId: string | null = null;

  if (row.event_type.startsWith("checkout.session.")) {
    checkoutId = idOf(object.id);
    paymentIntentId = idOf(object.payment_intent);
  } else if (row.event_type === "refund.updated") {
    paymentIntentId = idOf(object.payment_intent);
    chargeId = idOf(object.charge);
  } else if (row.event_type === "charge.refunded") {
    chargeId = idOf(object.id);
    paymentIntentId = idOf(object.payment_intent);
  } else if (row.event_type.startsWith("charge.dispute.")) {
    chargeId = idOf(object.charge);
  }

  if (checkoutId) await renewLease();
  const checkout = checkoutId
    ? await getStripe().checkout.sessions.retrieve(
        checkoutId,
        {},
        { stripeAccount: stripeAccountId },
      )
    : null;
  paymentIntentId = paymentIntentId ?? idOf(checkout?.payment_intent);

  if (paymentIntentId) await renewLease();
  let paymentIntent = paymentIntentId
    ? await getStripe().paymentIntents.retrieve(
        paymentIntentId,
        {},
        { stripeAccount: stripeAccountId },
      )
    : null;
  chargeId = chargeId ?? idOf(paymentIntent?.latest_charge);

  if (chargeId) await renewLease();
  const charge = chargeId
    ? await getStripe().charges.retrieve(chargeId, {}, { stripeAccount: stripeAccountId })
    : null;
  paymentIntentId = paymentIntentId ?? idOf(charge?.payment_intent);
  if (!paymentIntent && paymentIntentId) {
    await renewLease();
    paymentIntent = await getStripe().paymentIntents.retrieve(
      paymentIntentId,
      {},
      { stripeAccount: stripeAccountId },
    );
  }

  const refundPage = chargeId
    ? await listAllRefunds(chargeId, stripeAccountId, renewLease)
    : { refunds: [] as StripeObject[], refundsHasMore: false };
  return providerJson({
    stripeAccountId,
    checkout,
    paymentIntent,
    charge,
    refunds: refundPage.refunds,
    refundsHasMore: refundPage.refundsHasMore,
  });
}

/**
 * The worker owns provider transport only. SQL locks the immutable signed envelope,
 * validates this connected-account snapshot, and performs the sole money transition.
 */
export async function processBookingStripeInbox(
  environment: "test" | "live",
  limit = 25,
  familyLeaseCurrent: () => boolean = () => true,
) {
  if (billingEnvironment() !== environment)
    throw new Error("Stripe key mode does not match booking worker environment");
  const counts = { processed: 0, claimed: 0, failed: 0, skipped: 0, deadlineExceeded: false };
  for (let index = 0; index < limit; index++) {
    if (!familyLeaseCurrent() || !workerCanContinue()) break;
    const leaseToken = randomUUID();
    const { data: rows, error } = await bookingWorker.rpc("claim_due_booking_payment_events", {
      p_environment: environment,
      p_lease_token: leaseToken,
      p_limit: 1,
    });
    if (error) throw new Error("Unable to load booking payment inbox");
    if (!Array.isArray(rows) || rows.length > 1) throw new Error("Invalid booking payment claim");
    const claimed = rows?.[0];
    if (!claimed) break;
    counts.claimed++;
    const row = claimed as unknown as BookingInboxRow;
    const fence = row.fencing_token;
    try {
      if (!row.profile_id || row.environment !== environment || !row.account_context)
        throw new Error("Invalid booking payment context");
      const renewLease = async () => {
        if (!familyLeaseCurrent() || !workerCanContinue())
          throw new StaleBookingPaymentEventLeaseError("Worker continuation fence reached");
        const { data, error } = await bookingWorker.rpc("renew_booking_payment_event_v3", {
          p_event_id: row.id,
          p_lease_token: leaseToken,
          p_fencing_token: fence,
          p_lease_seconds: 120,
        });
        if (error) throw error;
        if (data !== true)
          throw new StaleBookingPaymentEventLeaseError("Stale booking payment event lease");
      };
      const providerSnapshot = await loadBookingStripeSnapshot(row, renewLease);
      await renewLease();
      const { data: applied, error: applyError } = await bookingWorker.rpc(
        "reduce_booking_financial_evidence_v3",
        {
          p_authority_kind: "stripe_event",
          p_authority_id: row.id,
          p_lease_token: leaseToken,
          p_fencing_token: fence,
          p_provider_snapshot: providerSnapshot,
        } as never,
      );
      if (
        applyError ||
        !applied ||
        typeof applied !== "object" ||
        !("action" in applied) ||
        applied.action !== "settled"
      )
        throw applyError ?? new Error("Indeterminate booking payment settlement");
      counts.processed++;
    } catch (error) {
      if (error instanceof StaleBookingPaymentEventLeaseError) counts.skipped++;
      else if (await fail(row.id, leaseToken, fence, error)) counts.failed++;
      else counts.skipped++;
    }
  }
  counts.deadlineExceeded = Date.now() >= (workerProviderContext()?.deadlineAt ?? Infinity);
  return counts;
}
