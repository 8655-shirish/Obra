import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const live = read("src/lib/booking-live.functions.ts");
const receipt = read("src/lib/booking-receipt.server.ts");
const confirmation = read("src/lib/booking-confirmation.functions.ts");
const consent = read("src/lib/booking-consent.ts");
const checkout = read("src/lib/booking-checkout.ts");
const ui = read("src/components/booking/LiveBookingDialog.tsx");
const foundation = read("supabase/migrations/20260829093900_booking_authorization_foundation.sql");
const lifecycle = read("supabase/migrations/20260829093911_bucket3_live_booking_lifecycle.sql");
const closure = read("supabase/migrations/20260829093923_booking_customer_lifecycle_closure.sql");
const dbTest = read("supabase/tests/bucket3-booking.sql");

// Replay: the original HttpOnly browser capability is bound to the idempotency identity.
assert.match(live, /bookingBrowserCapability\(data\.websiteId[\s\S]*true/);
assert.match(live, /bookingRequestCapabilityHash\(data\.requestId, browserCapability\.value/);
assert.match(live, /replay\.request_capability_hash !== requestCapability\.hash/);
assert.match(live, /recover_booking_checkout_handoff_v3/);
assert.ok(
  live.indexOf("checkout.sessions.retrieve") <
    live.indexOf("bookingHandoffMaxAge(prior.expires_at"),
);
assert.match(foundation, /request_capability_hash text check/);
assert.match(lifecycle, /booking request capability conflict/);
assert.ok(
  lifecycle.indexOf("booking request capability conflict") <
    lifecycle.indexOf("invalid booking customer"),
  "existing replay authority must be checked before mutable customer details",
);
assert.match(
  dbTest,
  /perform public\.reserve_live_booking\([\s\S]{0,800}'899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f','\{\}',now\(\),repeat\('3'/,
);
assert.match(receipt, /bookingRequestCookieName/);

// Expiry: browser and DB authority cover Stripe expiry plus safe redirect/clock skew.
assert.match(receipt, /BOOKING_HANDOFF_SKEW_SECONDS = 5 \* 60/);
assert.match(live, /authoritativeHandoffExpiry/);
assert.match(live, /p_handoff_expires_at: handoffExpiresAt/);
assert.match(closure, /p_handoff_expires_at < p_provider_expires_at\+interval '5 minutes'/);
assert.match(closure, /confirmation_handoff_expires_at>pg_catalog\.clock_timestamp\(\)/g);
assert.match(confirmation, /recover_booking_checkout_handoff_v3/);
assert.match(dbTest, /handoff recovery rejects expired skew lifetime/);

// Consent: displayed text hashes to the exact contract; foundation-only rows claim none.
const text = consent.match(/BOOKING_CONSENT_TEXT =\n\s+"([^"]+)";/)?.[1];
const digest = consent.match(/BOOKING_CONSENT_DIGEST =\n\s+"([a-f0-9]{64})";/)?.[1];
assert.ok(text && digest, "canonical consent constants missing");
assert.equal(createHash("sha256").update(text).digest("hex"), digest);
assert.match(ui, /id="booking-consent"[\s\S]*required/);
assert.match(ui, /\{BOOKING_CONSENT\.text\}/);
assert.match(checkout, /accepted: z\.literal\(true\)/);
assert.match(live, /checkoutSchema\.parse\(value\)/);
assert.match(ui, /checkoutSchema\.parse\(/);
assert.match(lifecycle, /explicit booking consent is required/);
assert.match(lifecycle, /p_consent_document_id is distinct from/);
assert.match(foundation, /93900 is independently deployable before the 93911 public writer exists/);
assert.match(
  foundation,
  /pg_catalog\.num_nonnulls\(consented_at, consent_document_id, consent_version, consent_digest\) = 0/,
);
for (const column of ["consented_at", "consent_document_id", "consent_version", "consent_digest"])
  assert.doesNotMatch(foundation, new RegExp(column + " [^,\\n]*not null"));
assert.match(dbTest, /exact stable consent evidence persists/);

console.log(
  "OK: booking replay capability, Checkout expiry skew, and explicit stable consent regressions present",
);
