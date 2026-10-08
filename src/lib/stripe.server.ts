import Stripe from "stripe";

import { PLANS_BY_ID, type PlanId } from "@/lib/plans";
import { hasWorkerDeadline, workerProviderFetch } from "@/lib/worker-deadline.server";

let stripe: Stripe | null = null;

export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;
export type BillingEnvironment = "test" | "live";

export type VerifiedPlanOffer = {
  contractVersion: 1;
  plan: PlanId;
  livemode: boolean;
  priceId: string;
  productId: string;
  currency: "usd";
  unitAmountMinor: number;
  interval: "month";
  intervalCount: 1;
  productName: string;
  productDescription: string;
};

function secretKeyEnvironment(): BillingEnvironment {
  const key = process.env["STRIPE_SECRET_KEY"]?.trim();
  if (!key) throw new Error("Payments are not configured");
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  throw new Error("Stripe secret key mode is invalid");
}

export function billingEnvironment(): BillingEnvironment {
  const configured = process.env["SAAS_BILLING_ENVIRONMENT"]?.trim();
  if (configured !== "test" && configured !== "live") {
    throw new Error("SAAS_BILLING_ENVIRONMENT must be explicitly set to test or live");
  }
  const keyEnvironment = secretKeyEnvironment();
  if (keyEnvironment !== configured) {
    throw new Error("Stripe secret key mode does not match the deployment billing environment");
  }
  return configured;
}

export function saasCheckoutAvailable(): boolean {
  try {
    assertSaasCheckoutChargingEnabled();
    return stripeConfigured();
  } catch {
    return false;
  }
}

export function assertSaasCheckoutChargingEnabled(): BillingEnvironment {
  if (process.env["SAAS_CHECKOUT_ENABLED"] !== "true") {
    throw new Error("SaaS checkout is disabled for this deployment");
  }
  const environment = billingEnvironment();
  if (environment === "live" && process.env["SAAS_LIVE_CHARGING_ENABLED"] !== "true") {
    throw new Error("Live SaaS charging is disabled");
  }
  return environment;
}

export function stripeConfigured(): boolean {
  const starter = process.env["STRIPE_PRICE_STARTER"]?.trim();
  const pro = process.env["STRIPE_PRICE_PRO"]?.trim();
  return Boolean(process.env["STRIPE_SECRET_KEY"]?.trim() && starter && pro && starter !== pro);
}

export function getStripe(): Stripe {
  const secret = process.env["STRIPE_SECRET_KEY"]?.trim();
  if (!secret) throw new Error("Payments are not configured");
  if (hasWorkerDeadline()) {
    // Cron has no interactive session and must not sleep/retry past its invocation.
    return new Stripe(secret, {
      apiVersion: STRIPE_API_VERSION,
      timeout: 8_000,
      maxNetworkRetries: 0,
      httpClient: Stripe.createFetchHttpClient(workerProviderFetch),
    });
  }
  if (!stripe) {
    stripe = new Stripe(secret, { apiVersion: STRIPE_API_VERSION });
  }
  return stripe;
}

const stripeWebhookCrypto = Stripe.createSubtleCryptoProvider();

/** Cloudflare's Stripe build uses SubtleCrypto, which cannot HMAC synchronously. */
export async function constructStripeWebhookEvent(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<Stripe.Event> {
  return getStripe().webhooks.constructEventAsync(
    rawBody,
    signature,
    secret.trim(),
    undefined,
    stripeWebhookCrypto,
  );
}

export function priceIdForPlan(plan: PlanId): string {
  const key = plan === "starter" ? "STRIPE_PRICE_STARTER" : "STRIPE_PRICE_PRO";
  const priceId = process.env[key]?.trim();
  if (!priceId) throw new Error("Payments are not configured");
  return priceId;
}

function productId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
  return typeof product === "string" ? product : product.id;
}

function expectedProductName(plan: PlanId): string {
  return `Obra ${PLANS_BY_ID[plan].name}`;
}

function expectedProductDescription(plan: PlanId): string {
  const item = PLANS_BY_ID[plan];
  return item.summary;
}

export function assertStripePriceMatchesPlan(
  price: Stripe.Price,
  plan: PlanId,
  options: { requireActive?: boolean } = {},
): void {
  const expectedId = priceIdForPlan(plan);
  const expected = PLANS_BY_ID[plan];
  const requireActive = options.requireActive ?? true;
  if (price.currency_options == null || typeof price.currency_options !== "object") {
    throw new Error("Stripe Price currency options must be expanded");
  }
  const currencyOptions = price.currency_options;
  const optionCurrencies = Object.keys(currencyOptions);
  const baseOption = currencyOptions.usd;
  const baseOptionAmount = baseOption?.unit_amount;
  const baseOptionDecimal = baseOption?.unit_amount_decimal;
  if (
    price.id !== expectedId ||
    (requireActive && !price.active) ||
    price.livemode !== (billingEnvironment() === "live") ||
    price.currency !== "usd" ||
    price.type !== "recurring" ||
    price.billing_scheme !== "per_unit" ||
    price.transform_quantity != null ||
    price.custom_unit_amount != null ||
    price.tiers_mode != null ||
    price.unit_amount !== expected.monthlyPriceUsd * 100 ||
    (price.unit_amount_decimal != null &&
      String(price.unit_amount_decimal) !== String(expected.monthlyPriceUsd * 100)) ||
    optionCurrencies.some((currency) => currency !== "usd") ||
    (baseOptionAmount != null && baseOptionAmount !== expected.monthlyPriceUsd * 100) ||
    (baseOptionDecimal != null &&
      String(baseOptionDecimal) !== String(expected.monthlyPriceUsd * 100)) ||
    !price.recurring ||
    price.recurring.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed" ||
    price.recurring.meter != null ||
    price.recurring.trial_period_days != null
  ) {
    throw new Error(`Stripe price configuration does not match the ${expected.name} plan`);
  }
}

export function assertStripeProductMatchesPlan(product: Stripe.Product, plan: PlanId): void {
  if (
    !product.active ||
    product.livemode !== (billingEnvironment() === "live") ||
    product.name !== expectedProductName(plan) ||
    product.description !== expectedProductDescription(plan)
  ) {
    throw new Error(
      `Stripe product configuration does not match the ${PLANS_BY_ID[plan].name} plan`,
    );
  }
}

export async function verifiedOfferForPlan(plan: PlanId): Promise<VerifiedPlanOffer> {
  const priceId = priceIdForPlan(plan);
  const price = await getStripe().prices.retrieve(priceId, {
    expand: ["currency_options", "product"],
  });
  assertStripePriceMatchesPlan(price, plan);
  if (typeof price.product === "string" || price.product.deleted) {
    throw new Error(
      `Stripe product configuration does not match the ${PLANS_BY_ID[plan].name} plan`,
    );
  }
  assertStripeProductMatchesPlan(price.product, plan);
  const expected = PLANS_BY_ID[plan];
  return {
    contractVersion: 1,
    plan,
    livemode: price.livemode,
    priceId: price.id,
    productId: productId(price.product),
    currency: "usd",
    unitAmountMinor: expected.monthlyPriceUsd * 100,
    interval: "month",
    intervalCount: 1,
    productName: price.product.name,
    productDescription: price.product.description ?? "",
  };
}

export async function verifiedPriceIdForPlan(plan: PlanId): Promise<string> {
  return (await verifiedOfferForPlan(plan)).priceId;
}

export function planForPriceId(priceId: string): PlanId | null {
  if (priceId === process.env["STRIPE_PRICE_STARTER"]?.trim()) return "starter";
  if (priceId === process.env["STRIPE_PRICE_PRO"]?.trim()) return "pro";
  return null;
}

function recurringAmountFromLineItem(item: Stripe.LineItem): number | null {
  return item.amount_total ?? item.amount_subtotal ?? null;
}

export function assertStripeCheckoutMatchesPlan(
  session: Stripe.Checkout.Session,
  plan: PlanId,
): void {
  const expected = PLANS_BY_ID[plan].monthlyPriceUsd * 100;
  const discounts = session.discounts ?? [];
  if (
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.livemode !== (billingEnvironment() === "live") ||
    session.currency !== "usd" ||
    session.amount_subtotal !== expected ||
    session.amount_total !== expected ||
    session.total_details?.amount_discount !== 0 ||
    session.total_details?.amount_tax !== 0 ||
    session.automatic_tax?.enabled !== false ||
    discounts.length !== 0 ||
    session.adaptive_pricing?.enabled !== false
  ) {
    throw new Error(`Stripe Checkout total does not match the ${PLANS_BY_ID[plan].name} plan`);
  }
}

export function assertSingleCheckoutLineItem(
  items: Stripe.ApiList<Stripe.LineItem>,
): Stripe.LineItem {
  if (items.has_more || items.data.length !== 1) {
    throw new Error("Stripe Checkout must contain exactly one complete line item");
  }
  const item = items.data[0];
  if (
    !item ||
    item.quantity !== 1 ||
    item.currency !== "usd" ||
    item.amount_discount !== 0 ||
    item.amount_tax !== 0 ||
    item.amount_subtotal !== item.amount_total ||
    (item.discounts?.length ?? 0) !== 0 ||
    (item.taxes?.length ?? 0) !== 0 ||
    recurringAmountFromLineItem(item) == null
  ) {
    throw new Error("Stripe Checkout line item is invalid");
  }
  return item;
}

export function assertSubscriptionHasNoAdjustments(subscription: Stripe.Subscription): void {
  if (
    subscription.discounts.length !== 0 ||
    (subscription.default_tax_rates?.length ?? 0) !== 0 ||
    subscription.automatic_tax.enabled !== false
  ) {
    throw new Error("Stripe subscription must not contain discounts or taxes");
  }
}

export function assertSingleSubscriptionItem(
  items: Stripe.ApiList<Stripe.SubscriptionItem>,
): Stripe.SubscriptionItem {
  if (items.has_more || items.data.length !== 1) {
    throw new Error("Stripe subscription must contain exactly one complete item");
  }
  const item = items.data[0];
  if (!item || item.quantity !== 1 || item.discounts?.length || item.tax_rates?.length) {
    throw new Error("Stripe subscription item is invalid");
  }
  return item;
}

export type PaidCheckoutOfferEvidence = {
  contractVersion: 1;
  plan: PlanId;
  livemode: boolean;
  providerSubscriptionId: string;
  providerCustomerId: string;
  priceId: string;
  productId: string;
  currency: "usd";
  unitAmountMinor: number;
  interval: "month";
  intervalCount: 1;
  quantity: 1;
  checkoutLineItemsComplete: true;
  subscriptionItemsComplete: true;
  zeroDiscounts: true;
  zeroTaxes: true;
  automaticTaxDisabled: true;
  adaptivePricingDisabled: true;
};

export function paidCheckoutOfferEvidence(
  session: Stripe.Checkout.Session,
  plan: PlanId,
  lineItems: Stripe.ApiList<Stripe.LineItem>,
  providerSubscriptionId: string,
  providerCustomerId: string,
): PaidCheckoutOfferEvidence {
  assertStripeCheckoutMatchesPlan(session, plan);
  if (typeof session.subscription !== "object" || !session.subscription) {
    throw new Error("Checkout is missing its expanded subscription");
  }
  assertSubscriptionHasNoAdjustments(session.subscription);
  const checkoutItem = assertSingleCheckoutLineItem(lineItems);
  const subscriptionItem = assertSingleSubscriptionItem(session.subscription.items);
  const checkoutPrice = checkoutItem.price;
  const subscriptionPrice = subscriptionItem.price;
  const checkoutProduct = checkoutPrice?.product;
  const checkoutProductId =
    typeof checkoutProduct === "string" ? checkoutProduct : (checkoutProduct?.id ?? null);
  const subscriptionProductId =
    typeof subscriptionPrice.product === "string"
      ? subscriptionPrice.product
      : subscriptionPrice.product.id;
  const recurring = subscriptionPrice.recurring;
  const expectedAmount = PLANS_BY_ID[plan].monthlyPriceUsd * 100;
  if (
    !providerSubscriptionId ||
    !providerCustomerId ||
    !checkoutPrice ||
    checkoutPrice.id !== subscriptionPrice.id ||
    !checkoutProductId ||
    checkoutProductId !== subscriptionProductId ||
    checkoutItem.amount_subtotal !== expectedAmount ||
    checkoutPrice.unit_amount !== expectedAmount ||
    checkoutPrice.currency !== "usd" ||
    subscriptionPrice.currency !== "usd" ||
    subscriptionPrice.unit_amount !== expectedAmount ||
    !recurring ||
    recurring.interval !== "month" ||
    recurring.interval_count !== 1 ||
    recurring.usage_type !== "licensed" ||
    recurring.meter != null ||
    recurring.trial_period_days != null
  ) {
    throw new Error("Checkout provider evidence does not match the purchased offer");
  }
  return {
    contractVersion: 1,
    plan,
    livemode: session.livemode,
    providerSubscriptionId,
    providerCustomerId,
    priceId: subscriptionPrice.id,
    productId: subscriptionProductId,
    currency: "usd",
    unitAmountMinor: expectedAmount,
    interval: "month",
    intervalCount: 1,
    quantity: 1,
    checkoutLineItemsComplete: true,
    subscriptionItemsComplete: true,
    zeroDiscounts: true,
    zeroTaxes: true,
    automaticTaxDisabled: true,
    adaptivePricingDisabled: true,
  };
}

export function publicAppUrl(): string {
  const configured = process.env["PUBLIC_APP_URL"]?.trim();
  if (!configured) throw new Error("PUBLIC_APP_URL is required for provider redirects");
  const url = new URL(configured);
  const local = url.protocol === "http:" && url.hostname === "localhost";
  if (
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PUBLIC_APP_URL must be a bare HTTPS origin");
  }
  return url.origin;
}

export async function expireStripeCheckoutSession(sessionId: string): Promise<void> {
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.status === "open") await getStripe().checkout.sessions.expire(sessionId);
  } catch (error) {
    console.error("[stripe] failed to expire superseded checkout", sessionId, error);
    throw new Error("Unable to replace the previous checkout session");
  }
}
