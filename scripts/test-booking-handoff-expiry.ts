import assert from "node:assert/strict";

import {
  BOOKING_HANDOFF_SKEW_SECONDS,
  bookingHandoffExpiresAt,
  bookingHandoffMaxAge,
} from "../src/lib/booking-receipt.server.ts";

const now = Date.parse("2026-08-29T12:00:00.000Z");
const stripeExpiry = new Date(now + 31 * 60_000);
assert.equal(BOOKING_HANDOFF_SKEW_SECONDS, 300);
assert.equal(bookingHandoffExpiresAt(stripeExpiry).getTime(), stripeExpiry.getTime() + 300_000);
assert.equal(bookingHandoffMaxAge(stripeExpiry, now), 36 * 60);
assert.equal(bookingHandoffMaxAge(new Date(now - 301_000), now), 1);
console.log("OK: booking handoff lifetime covers Stripe Checkout expiry with five-minute skew");
