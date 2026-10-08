import { randomUUID } from "node:crypto";
import { workerCanContinue, WorkerDeadlineError } from "@/lib/worker-deadline.server";
import { PLANS_BY_ID } from "@/lib/plans";
import type Stripe from "stripe";

import {
  assertSingleCheckoutLineItem,
  assertSingleSubscriptionItem,
  assertSubscriptionHasNoAdjustments,
  assertStripeCheckoutMatchesPlan,
  paidCheckoutOfferEvidence,
  billingEnvironment,
  getStripe,
} from "@/lib/stripe.server";

function subscriptionId(
  invoice: Stripe.Invoice & { subscription?: string | Stripe.Subscription | null },
) {
  const nested = invoice.parent?.subscription_details?.subscription;
  if (typeof nested === "string") return nested;
  if (typeof invoice.subscription === "string") return invoice.subscription;
  return invoice.subscription && typeof invoice.subscription === "object"
    ? invoice.subscription.id
    : null;
}
function localStatus(status: Stripe.Subscription.Status) {
  if (status === "active" || status === "trialing") return "active";
  if (["past_due", "unpaid", "incomplete", "paused"].includes(status)) return "past_due";
  if (["canceled", "incomplete_expired"].includes(status)) return "cancelled";
  return null;
}
type VerifiedSubscriptionOffer = {
  priceId: string;
  productId: string;
  quantity: number;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
};

function verifiedSubscriptionOffer(
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
): VerifiedSubscriptionOffer {
  const productId =
    typeof item.price.product === "string" ? item.price.product : item.price.product.id;
  return {
    priceId: item.price.id,
    productId,
    quantity: item.quantity ?? 0,
    currentPeriodEnd: new Date(item.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

function projection(event: Stripe.Event, subscriptionOffer?: VerifiedSubscriptionOffer) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const checkoutSessionId = session.metadata?.checkoutSessionId;
    const providerSubscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    const providerCustomerId =
      typeof session.customer === "string" ? session.customer : session.customer?.id;
    const plan = session.metadata?.plan;
    const lineItems = session.line_items;
    if (!lineItems) throw new Error("Checkout completion lacks complete line items");
    const lineItem = assertSingleCheckoutLineItem(lineItems);
    const providerEvidence =
      plan === "starter" || plan === "pro"
        ? paidCheckoutOfferEvidence(
            session,
            plan,
            lineItems,
            providerSubscriptionId ?? "",
            providerCustomerId ?? "",
          )
        : null;
    const priceId = providerEvidence?.priceId ?? lineItem.price?.id;
    if (plan === "starter" || plan === "pro") {
      assertStripeCheckoutMatchesPlan(session, plan);
      const expectedAmount = PLANS_BY_ID[plan].monthlyPriceUsd * 100;
      if (
        !priceId ||
        session.metadata?.offerContractVersion !== "1" ||
        session.metadata?.offerPriceId !== priceId ||
        session.metadata?.offerAmountMinor !== String(expectedAmount) ||
        session.metadata?.offerCurrency !== "usd" ||
        session.metadata?.offerInterval !== "month" ||
        session.metadata?.offerIntervalCount !== "1" ||
        !session.metadata?.offerProductId ||
        session.metadata.offerProductId !== providerEvidence?.productId
      ) {
        throw new Error("Checkout completion does not match its immutable offer metadata");
      }
    }
    if (
      session.mode === "subscription" &&
      session.payment_status === "paid" &&
      checkoutSessionId &&
      providerSubscriptionId &&
      providerCustomerId &&
      priceId &&
      (plan === "starter" || plan === "pro")
    )
      return {
        action: "finalize_checkout",
        checkoutSessionId,
        stripeCheckoutSessionId: session.id,
        providerSubscriptionId,
        providerCustomerId,
        priceId,
        plan,
        providerOfferEvidence: providerEvidence,
      };
    throw new Error("Checkout completion lacks authoritative paid subscription identity");
  }
  if (event.type === "checkout.session.expired") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.checkoutSessionId)
      return {
        action: "expire_checkout",
        checkoutSessionId: session.metadata.checkoutSessionId,
        stripeCheckoutSessionId: session.id,
      };
    throw new Error("Expired Checkout Session lacks internal identity");
  }
  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as Stripe.Subscription;
    const status =
      event.type === "customer.subscription.deleted"
        ? "cancelled"
        : localStatus(subscription.status);
    if (status && subscriptionOffer)
      return {
        action: "project_subscription",
        providerSubscriptionId: subscription.id,
        status,
        ...subscriptionOffer,
      };
    throw new Error("Subscription event has unsupported current status");
  }
  if (event.type === "invoice.payment_failed") {
    const id = subscriptionId(
      event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null },
    );
    if (id && subscriptionOffer)
      return {
        action: "project_subscription",
        providerSubscriptionId: id,
        status: "past_due",
        ...subscriptionOffer,
      };
    throw new Error("Failed invoice lacks subscription identity");
  }
  return { action: "no_op" };
}
async function failClaimedEvent(
  eventId: string,
  leaseToken: string,
  fence: number,
  safeError: string,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc("complete_provider_event", {
    p_event_id: eventId,
    p_lease_token: leaseToken,
    p_fencing_token: fence,
    p_succeeded: false,
    p_safe_error: safeError,
  });
  if (error) throw new Error(`Unable to settle failed SaaS inbox event: ${error.message}`);
}

type TargetedSaasStripeInboxResult =
  | { processed: 1; outcome: "applied" }
  | { processed: 0; outcome: "completed" | "active_lease" | "missing" };

type InboxRow = {
  id: string;
  payload: unknown;
  processing_state: string;
  lease_expires_at: string | null;
};

function hasActiveLease(row: InboxRow) {
  return (
    row.processing_state === "processing" &&
    row.lease_expires_at !== null &&
    Date.parse(row.lease_expires_at) > Date.now()
  );
}

export function processSaasStripeInbox(
  limit: number,
  providerEventId: string,
): Promise<TargetedSaasStripeInboxResult>;
export function processSaasStripeInbox(
  limit?: number,
  providerEventId?: undefined,
): Promise<{ processed: number }>;
export async function processSaasStripeInbox(limit = 25, providerEventId?: string) {
  if (!workerCanContinue()) throw new WorkerDeadlineError();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const inboxQuery = () =>
    supabaseAdmin
      .from("provider_event_inbox")
      .select("id,payload,processing_state,lease_expires_at")
      .eq("provider", "stripe")
      .eq("event_family", "saas")
      .eq("environment", billingEnvironment());

  let events: InboxRow[] | null;
  let error: { message: string } | null;
  if (providerEventId) {
    // A fresh, signed delivery is itself the retry signal. Look through backoff and terminal
    // success so the caller can distinguish a duplicate from work that was not attempted.
    ({ data: events, error } = await inboxQuery().eq("event_id", providerEventId).limit(1));
  } else {
    // Scheduler reconciliation remains due-only and bounded.
    ({ data: events, error } = await inboxQuery()
      .in("processing_state", ["pending", "processing", "failed"])
      .lte("next_attempt_at", new Date().toISOString())
      .order("received_at")
      .limit(limit));
  }
  if (error) throw new Error("Unable to load SaaS inbox");
  if (providerEventId && !events?.length) return { processed: 0, outcome: "missing" };

  let processed = 0;
  for (const row of events ?? []) {
    if (!workerCanContinue()) throw new WorkerDeadlineError();
    if (providerEventId) {
      if (row.processing_state === "processed") return { processed: 0, outcome: "completed" };
      if (hasActiveLease(row)) return { processed: 0, outcome: "active_lease" };
      if (!["pending", "processing", "failed"].includes(row.processing_state)) {
        throw new Error("SaaS inbox event is not processable");
      }

      // claim_provider_event intentionally enforces next_attempt_at for cron callers. A signed
      // redelivery is a stronger retry signal, so make only this targeted row immediately due.
      const { data: retrySignalled, error: retrySignalError } = await supabaseAdmin.rpc(
        "signal_saas_provider_event_retry",
        { p_event_id: row.id },
      );
      if (retrySignalError || retrySignalled !== true) {
        throw new Error("Unable to register SaaS webhook retry signal");
      }
    }

    const leaseToken = randomUUID();
    const { data: fence, error: claimError } = await supabaseAdmin.rpc("claim_provider_event", {
      p_event_id: row.id,
      p_lease_token: leaseToken,
      p_lease_seconds: 120,
    });
    if (claimError) {
      if (claimError.code === "P0001" && providerEventId) {
        // A concurrent claimant may have completed or acquired the row between the read and claim.
        const { data: latest, error: latestError } = await inboxQuery()
          .eq("event_id", providerEventId)
          .limit(1);
        if (latestError) throw new Error("Unable to reload SaaS inbox event");
        const current = latest?.[0] as InboxRow | undefined;
        if (current?.processing_state === "processed") {
          return { processed: 0, outcome: "completed" };
        }
        if (current && hasActiveLease(current)) {
          return { processed: 0, outcome: "active_lease" };
        }
        throw new Error("SaaS inbox event claim unavailable");
      }
      if (claimError.code === "P0001") continue;
      throw new Error(`Unable to claim SaaS inbox event: ${claimError.message}`);
    }
    let event = row.payload as Stripe.Event;
    let subscriptionOffer: VerifiedSubscriptionOffer | undefined;
    try {
      if (event.type === "checkout.session.completed") {
        const sessionId = (event.data.object as Stripe.Checkout.Session).id;
        const session = await getStripe().checkout.sessions.retrieve(sessionId, {
          expand: ["subscription"],
        });
        if (typeof session.subscription !== "object" || !session.subscription) {
          throw new Error("Checkout completion is missing its subscription");
        }
        assertSubscriptionHasNoAdjustments(session.subscription);
        const [lineItems, subscriptionItems] = await Promise.all([
          getStripe().checkout.sessions.listLineItems(sessionId, { limit: 2 }),
          getStripe().subscriptionItems.list({ subscription: session.subscription.id, limit: 2 }),
        ]);
        session.subscription.items = subscriptionItems;
        const subscriptionItem = assertSingleSubscriptionItem(subscriptionItems);
        const lineItem = assertSingleCheckoutLineItem(lineItems);
        if (!lineItem.price || lineItem.price.id !== subscriptionItem.price.id) {
          throw new Error("Checkout and subscription item evidence conflict");
        }
        session.line_items = lineItems;
        event = { ...event, data: { ...event.data, object: session } } as Stripe.Event;
      } else if (
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        const subscription = await getStripe().subscriptions.retrieve(
          (event.data.object as Stripe.Subscription).id,
        );
        assertSubscriptionHasNoAdjustments(subscription);
        subscription.items = await getStripe().subscriptionItems.list({
          subscription: subscription.id,
          limit: 2,
        });
        const item = assertSingleSubscriptionItem(subscription.items);
        subscriptionOffer = verifiedSubscriptionOffer(subscription, item);
        event = { ...event, data: { ...event.data, object: subscription } } as Stripe.Event;
      } else if (event.type === "invoice.payment_failed") {
        const id = subscriptionId(
          event.data.object as Stripe.Invoice & {
            subscription?: string | Stripe.Subscription | null;
          },
        );
        if (!id) throw new Error("Invoice has no subscription identity");
        const subscription = await getStripe().subscriptions.retrieve(id);
        assertSubscriptionHasNoAdjustments(subscription);
        subscription.items = await getStripe().subscriptionItems.list({
          subscription: subscription.id,
          limit: 2,
        });
        const item = assertSingleSubscriptionItem(subscription.items);
        subscriptionOffer = verifiedSubscriptionOffer(subscription, item);
        const status = localStatus(subscription.status);
        if (!status) throw new Error("Subscription status cannot be projected");
        event = {
          ...event,
          type: "customer.subscription.updated",
          data: { ...event.data, object: subscription },
        } as Stripe.Event;
      }
    } catch {
      await failClaimedEvent(row.id, leaseToken, fence, "Stripe event verification failed");
      if (providerEventId) throw new Error("Stripe event verification failed");
      continue;
    }
    let eventProjection: ReturnType<typeof projection>;
    let sourceCreatedAt: string;
    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (
        !Number.isSafeInteger(event.created) ||
        event.created <= 0 ||
        event.created > nowSeconds + 300
      )
        throw new Error("Stripe event has invalid source timestamp");
      sourceCreatedAt = new Date(event.created * 1000).toISOString();
      eventProjection = projection(event, subscriptionOffer);
    } catch {
      await failClaimedEvent(row.id, leaseToken, fence, "Stripe event projection failed");
      if (providerEventId) throw new Error("Stripe event projection failed");
      continue;
    }
    const { data: applied, error: applyError } = await supabaseAdmin.rpc(
      "apply_saas_provider_event",
      {
        p_event_id: row.id,
        p_lease_token: leaseToken,
        p_fencing_token: fence,
        p_source_created_at: sourceCreatedAt,
        p_projection: eventProjection,
      },
    );
    if (applyError) {
      await failClaimedEvent(row.id, leaseToken, fence, "SaaS event application failed");
      if (providerEventId) throw new Error("SaaS event application failed");
      continue;
    }
    if (providerEventId) {
      if (applied === true) return { processed: 1, outcome: "applied" };
      if (applied === false) return { processed: 0, outcome: "completed" };
      throw new Error("SaaS event application returned no result");
    }
    processed++;
  }
  return { processed };
}
