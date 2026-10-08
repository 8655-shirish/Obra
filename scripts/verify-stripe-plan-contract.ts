import assert from "node:assert/strict";
import type Stripe from "stripe";

import {
  assertSingleCheckoutLineItem,
  assertSingleSubscriptionItem,
  assertStripeCheckoutMatchesPlan,
  assertStripePriceMatchesPlan,
  getStripe,
  paidCheckoutOfferEvidence,
  priceIdForPlan,
  stripeConfigured,
  verifiedOfferForPlan,
} from "@/lib/stripe.server";
import { PLANS_BY_ID, type PlanId } from "@/lib/plans";

const ENV_KEYS = [
  "SAAS_BILLING_ENVIRONMENT",
  "STRIPE_PRICE_STARTER",
  "STRIPE_PRICE_PRO",
  "STRIPE_SECRET_KEY",
] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const EXPECTED_MINOR_AMOUNT: Record<PlanId, 7_900 | 12_900> = {
  starter: 7_900,
  pro: 12_900,
};

function setEnv(name: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function product(plan: PlanId, overrides: Partial<Stripe.Product> = {}): Stripe.Product {
  return {
    id: `prod_${plan}`,
    object: "product",
    active: true,
    created: 1,
    description: PLANS_BY_ID[plan].summary,
    images: [],
    livemode: false,
    marketing_features: [],
    metadata: {},
    name: `Obra ${PLANS_BY_ID[plan].name}`,
    package_dimensions: null,
    shippable: null,
    type: "service",
    updated: 1,
    url: null,
    ...overrides,
  };
}

function price(plan: PlanId, overrides: Partial<Stripe.Price> = {}): Stripe.Price {
  const amount = EXPECTED_MINOR_AMOUNT[plan];
  return {
    id: `price_${plan}`,
    object: "price",
    active: true,
    billing_scheme: "per_unit",
    created: 1,
    currency: "usd",
    currency_options: {},
    custom_unit_amount: null,
    livemode: false,
    lookup_key: null,
    metadata: {},
    nickname: null,
    product: product(plan),
    recurring: {
      interval: "month",
      interval_count: 1,
      meter: null,
      trial_period_days: null,
      usage_type: "licensed",
    },
    tax_behavior: null,
    tiers_mode: null,
    transform_quantity: null,
    type: "recurring",
    unit_amount: amount,
    unit_amount_decimal: String(amount),
    ...overrides,
  };
}

function checkout(plan: PlanId, overrides: Record<string, unknown> = {}): Stripe.Checkout.Session {
  const amount = EXPECTED_MINOR_AMOUNT[plan];
  return {
    mode: "subscription",
    status: "complete",
    livemode: false,
    currency: "usd",
    amount_subtotal: amount,
    amount_total: amount,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    automatic_tax: { enabled: false },
    discounts: [],
    adaptive_pricing: { enabled: false },
    ...overrides,
  } as Stripe.Checkout.Session;
}

function lineItem(plan: PlanId, itemPrice: Stripe.Price): Stripe.LineItem {
  const amount = EXPECTED_MINOR_AMOUNT[plan];
  return {
    id: "li_1",
    object: "item",
    adjustable_quantity: null,
    amount_discount: 0,
    amount_subtotal: amount,
    amount_tax: 0,
    amount_total: amount,
    currency: "usd",
    description: PLANS_BY_ID[plan].name,
    discounts: [],
    price: itemPrice,
    quantity: 1,
    taxes: [],
  } as Stripe.LineItem;
}

function apiList<T>(data: T[], hasMore = false): Stripe.ApiList<T> {
  return { object: "list", data, has_more: hasMore, url: "/test" };
}

try {
  process.env.SAAS_BILLING_ENVIRONMENT = "test";
  process.env.STRIPE_PRICE_STARTER = "price_starter";
  process.env.STRIPE_PRICE_PRO = "price_pro";
  process.env.STRIPE_SECRET_KEY = "sk_test_example";

  assert.equal(stripeConfigured(), true);
  assert.equal(priceIdForPlan("starter"), "price_starter");
  assert.equal(priceIdForPlan("pro"), "price_pro");

  for (const plan of ["starter", "pro"] as const) {
    assert.doesNotThrow(() => assertStripePriceMatchesPlan(price(plan), plan));
    assert.doesNotThrow(() => assertStripeCheckoutMatchesPlan(checkout(plan), plan));
  }

  // Observe the real Stripe v1 retrieval boundary. The SDK keeps currency_options optional even
  // when requested, so retrieval must request both expansions and runtime validation must still
  // reject an omitted currency_options payload.
  const stripeClient = getStripe();
  const originalRetrieve = stripeClient.prices.retrieve;
  const retrievals: Array<{ id: string; params: Stripe.PriceRetrieveParams | undefined }> = [];
  let retrievedPrice = price("starter");
  stripeClient.prices.retrieve = (async (id, params) => {
    retrievals.push({ id, params });
    return retrievedPrice as Stripe.Response<Stripe.Price>;
  }) as typeof stripeClient.prices.retrieve;
  try {
    assert.deepEqual(await verifiedOfferForPlan("starter"), {
      contractVersion: 1,
      plan: "starter",
      livemode: false,
      priceId: "price_starter",
      productId: "prod_starter",
      currency: "usd",
      unitAmountMinor: 7_900,
      interval: "month",
      intervalCount: 1,
      productName: "Obra Starter",
      productDescription: PLANS_BY_ID.starter.summary,
    });
    assert.deepEqual(retrievals, [
      { id: "price_starter", params: { expand: ["currency_options", "product"] } },
    ]);

    retrievedPrice = price("starter", { currency_options: undefined });
    await assert.rejects(
      () => verifiedOfferForPlan("starter"),
      /currency options must be expanded/i,
    );
    retrievedPrice = price("starter", { product: "prod_starter" });
    await assert.rejects(() => verifiedOfferForPlan("starter"), /product configuration/i);
  } finally {
    stripeClient.prices.retrieve = originalRetrieve;
  }

  const invalidStarterPrices: Array<[string, Stripe.Price]> = [
    ["wrong configured price", price("starter", { id: "price_other" })],
    ["wrong amount", price("starter", { unit_amount: 2_900, unit_amount_decimal: "2900" })],
    ["inactive", price("starter", { active: false })],
    ["wrong environment", price("starter", { livemode: true })],
    ["wrong currency", price("starter", { currency: "eur" })],
    ["tiered", price("starter", { billing_scheme: "tiered" })],
    [
      "custom amount",
      price("starter", { custom_unit_amount: { minimum: 1, maximum: null, preset: null } }),
    ],
    [
      "transformed quantity",
      price("starter", { transform_quantity: { divide_by: 10, round: "up" } }),
    ],
    ["tier mode", price("starter", { tiers_mode: "volume" })],
    ["one-time", price("starter", { type: "one_time", recurring: null })],
    [
      "annual",
      price("starter", {
        recurring: {
          interval: "year",
          interval_count: 1,
          usage_type: "licensed",
          meter: null,
          trial_period_days: null,
        },
      }),
    ],
    [
      "multi-month",
      price("starter", {
        recurring: {
          interval: "month",
          interval_count: 3,
          usage_type: "licensed",
          meter: null,
          trial_period_days: null,
        },
      }),
    ],
    [
      "metered",
      price("starter", {
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "metered",
          meter: "mtr_1",
          trial_period_days: null,
        },
      }),
    ],
    [
      "trial",
      price("starter", {
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "licensed",
          meter: null,
          trial_period_days: 14,
        },
      }),
    ],
  ];
  for (const [name, invalid] of invalidStarterPrices) {
    assert.throws(() => assertStripePriceMatchesPlan(invalid, "starter"), undefined, name);
  }

  // Stripe API v1 uses expand but keeps the response property optional in its SDK type. Missing
  // expansion, an alternate currency, and a conflicting USD option must all fail closed.
  assert.throws(
    () =>
      assertStripePriceMatchesPlan(price("starter", { currency_options: undefined }), "starter"),
    /currency options must be expanded/i,
  );
  assert.throws(() =>
    assertStripePriceMatchesPlan(
      price("starter", {
        currency_options: {
          eur: {
            custom_unit_amount: null,
            tax_behavior: "unspecified",
            unit_amount: 7_000,
            unit_amount_decimal: "7000",
          },
        },
      }),
      "starter",
    ),
  );
  assert.throws(() =>
    assertStripePriceMatchesPlan(
      price("starter", {
        currency_options: {
          usd: {
            custom_unit_amount: null,
            tax_behavior: "unspecified",
            unit_amount: 7_000,
            unit_amount_decimal: "7000",
          },
        },
      }),
      "starter",
    ),
  );
  assert.doesNotThrow(() =>
    assertStripePriceMatchesPlan(
      price("starter", {
        currency_options: {
          usd: {
            custom_unit_amount: null,
            tax_behavior: "unspecified",
            unit_amount: 7_900,
            unit_amount_decimal: "7900",
          },
        },
      }),
      "starter",
    ),
  );

  for (const [name, invalid] of [
    ["legacy amount", checkout("starter", { amount_subtotal: 2_900, amount_total: 2_900 })],
    ["not complete", checkout("starter", { status: "open" })],
    ["wrong mode", checkout("starter", { mode: "payment" })],
    ["wrong environment", checkout("starter", { livemode: true })],
    ["wrong currency", checkout("starter", { currency: "eur" })],
    ["subtotal mismatch", checkout("starter", { amount_subtotal: 7_000 })],
    ["total mismatch", checkout("starter", { amount_total: 7_000 })],
    [
      "discount",
      checkout("starter", {
        total_details: { amount_discount: 1, amount_shipping: 0, amount_tax: 0 },
      }),
    ],
    [
      "tax",
      checkout("starter", {
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 1 },
      }),
    ],
    ["automatic tax", checkout("starter", { automatic_tax: { enabled: true } })],
    ["promotion", checkout("starter", { discounts: [{ coupon: "coupon_1" }] })],
    ["adaptive pricing", checkout("starter", { adaptive_pricing: { enabled: true } })],
    ["missing adaptive proof", checkout("starter", { adaptive_pricing: null })],
  ] as const) {
    assert.throws(() => assertStripeCheckoutMatchesPlan(invalid, "starter"), undefined, name);
  }

  const starterPrice = price("starter");
  const validLine = lineItem("starter", starterPrice);
  assert.strictEqual(assertSingleCheckoutLineItem(apiList([validLine])), validLine);
  assert.throws(() => assertSingleCheckoutLineItem(apiList([])));
  assert.throws(() => assertSingleCheckoutLineItem(apiList([validLine], true)));
  assert.throws(() =>
    assertSingleCheckoutLineItem(
      apiList([validLine, { ...validLine, id: "li_2" } as Stripe.LineItem]),
    ),
  );
  assert.throws(() => assertSingleCheckoutLineItem(apiList([{ ...validLine, quantity: 2 }])));

  const subscriptionItem = {
    id: "si_1",
    object: "subscription_item",
    created: 1,
    current_period_end: 2,
    current_period_start: 1,
    discounts: [],
    metadata: {},
    price: starterPrice,
    quantity: 1,
    subscription: "sub_1",
    tax_rates: [],
  } as Stripe.SubscriptionItem;
  assert.strictEqual(assertSingleSubscriptionItem(apiList([subscriptionItem])), subscriptionItem);
  assert.throws(() => assertSingleSubscriptionItem(apiList([], true)));
  assert.throws(() =>
    assertSingleSubscriptionItem(apiList([{ ...subscriptionItem, quantity: 2 }])),
  );

  const subscription = {
    id: "sub_1",
    discounts: [],
    default_tax_rates: [],
    automatic_tax: { enabled: false },
    items: apiList([subscriptionItem]),
  } as Stripe.Subscription;
  const paidSession = checkout("starter", {
    subscription,
    customer: "cus_1",
  });
  const evidence = paidCheckoutOfferEvidence(
    paidSession,
    "starter",
    apiList([validLine]),
    "sub_1",
    "cus_1",
  );
  assert.deepEqual(
    {
      contractVersion: evidence.contractVersion,
      plan: evidence.plan,
      priceId: evidence.priceId,
      productId: evidence.productId,
      unitAmountMinor: evidence.unitAmountMinor,
      quantity: evidence.quantity,
      checkoutLineItemsComplete: evidence.checkoutLineItemsComplete,
      subscriptionItemsComplete: evidence.subscriptionItemsComplete,
      zeroDiscounts: evidence.zeroDiscounts,
      zeroTaxes: evidence.zeroTaxes,
      automaticTaxDisabled: evidence.automaticTaxDisabled,
      adaptivePricingDisabled: evidence.adaptivePricingDisabled,
    },
    {
      contractVersion: 1,
      plan: "starter",
      priceId: "price_starter",
      productId: "prod_starter",
      unitAmountMinor: 7_900,
      quantity: 1,
      checkoutLineItemsComplete: true,
      subscriptionItemsComplete: true,
      zeroDiscounts: true,
      zeroTaxes: true,
      automaticTaxDisabled: true,
      adaptivePricingDisabled: true,
    },
  );
  assert.throws(() =>
    paidCheckoutOfferEvidence(paidSession, "starter", apiList([validLine]), "", "cus_1"),
  );
  assert.throws(() =>
    paidCheckoutOfferEvidence(
      paidSession,
      "starter",
      apiList([{ ...validLine, price: price("pro") }]),
      "sub_1",
      "cus_1",
    ),
  );

  process.env.STRIPE_PRICE_PRO = "price_starter";
  assert.equal(stripeConfigured(), false);

  console.log("Stripe canonical price, checkout, and provider-evidence matrices passed");
} finally {
  for (const key of ENV_KEYS) setEnv(key, original[key]);
}
