import assert from "node:assert/strict";
import { deriveBucketOneReadiness } from "../src/lib/booking-readiness.ts";
const base = {
  websiteId: "w",
  profileId: "p",
  environment: "test" as const,
  isPublished: true,
  isActiveVersion: true,
  serviceActive: false,
  scheduleActive: false,
  intervalCount: 0,
};
assert.equal(deriveBucketOneReadiness({ ...base, entitlement: null }).publicMode, "demo");
assert.equal(
  deriveBucketOneReadiness({
    ...base,
    entitlement: {
      plan: "starter" as const,
      state: "active",
      quote_admission: true,
      order_confirmed_at: null,
    },
  }).publicMode,
  "starter_leads",
);
assert.equal(
  deriveBucketOneReadiness({
    ...base,
    entitlement: {
      plan: "starter" as const,
      state: "suspended",
      quote_admission: true,
      order_confirmed_at: null,
    },
  }).publicMode,
  "unavailable",
);
const pro = {
  plan: "pro" as const,
  state: "active",
  booking_admission: true,
  order_confirmed_at: null,
};
assert.equal(
  deriveBucketOneReadiness({ ...base, entitlement: pro }).firstIncompleteStep,
  "order_confirmation",
);
assert.equal(
  deriveBucketOneReadiness({ ...base, entitlement: { ...pro, order_confirmed_at: "now" } })
    .firstIncompleteStep,
  "calendar",
);
assert.equal(
  deriveBucketOneReadiness({
    ...base,
    entitlement: { ...pro, order_confirmed_at: "now" },
    calendarState: "ready",
  }).firstIncompleteStep,
  "availability",
);
assert.equal(
  deriveBucketOneReadiness({
    ...base,
    entitlement: { ...pro, order_confirmed_at: "now" },
    calendarState: "ready",
    serviceActive: true,
    scheduleActive: true,
    intervalCount: 1,
  }).firstIncompleteStep,
  "payments",
);
const complete = deriveBucketOneReadiness({
  ...base,
  entitlement: { ...pro, order_confirmed_at: "now" },
  calendarState: "ready",
  serviceActive: true,
  scheduleActive: true,
  intervalCount: 1,
  paymentsState: "ready",
});
assert.equal(complete.firstIncompleteStep, "complete");
assert.equal(complete.nextRoute, "workspace");
assert.equal(complete.bookingAdmission, true);
assert.equal(complete.publicMode, "live_booking");
assert.equal(
  deriveBucketOneReadiness({ ...base, entitlement: pro, entitlementTemporallyEligible: false })
    .publicMode,
  "unavailable",
);
assert.equal(
  deriveBucketOneReadiness({
    ...complete,
    entitlement: { ...pro, booking_admission: false, order_confirmed_at: "now" },
  }).bookingAdmission,
  false,
);
console.log("verify-booking-readiness: ok");
