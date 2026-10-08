import assert from "node:assert/strict";

import { verifiedOfferForPlan } from "../src/lib/stripe.server";

assert.equal(process.env.SAAS_BILLING_ENVIRONMENT, "live");
assert.ok(process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_"));
assert.equal(process.env.SAAS_CHECKOUT_ENABLED, "false");
assert.equal(process.env.SAAS_LIVE_CHARGING_ENABLED, "false");
const [starter, pro] = await Promise.all([
  verifiedOfferForPlan("starter"),
  verifiedOfferForPlan("pro"),
]);
assert.equal(starter.unitAmountMinor, 7_900);
assert.equal(pro.unitAmountMinor, 12_900);
assert.equal(starter.currency, "usd");
assert.equal(pro.currency, "usd");
assert.notEqual(starter.priceId, pro.priceId);
assert.notEqual(starter.productId, pro.productId);
console.log("verify-live-stripe-catalog: live read-only Product/Price contracts verified");
