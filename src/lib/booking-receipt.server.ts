import { createHash, createHmac } from "node:crypto";

export type BookingCookieKind = "request" | "handoff" | "receipt";

export const BOOKING_HANDOFF_SKEW_SECONDS = 5 * 60;

export function bookingCookieName(kind: BookingCookieKind, reference: string, secret: string) {
  const suffix = createHmac("sha256", secret)
    .update(`booking-cookie:${kind}:${reference}`)
    .digest("hex")
    .slice(0, 24);
  return `obra_booking_${kind}_${suffix}`;
}

export function bookingRequestCookieName(requestId: string, secret: string) {
  return bookingCookieName("request", requestId, secret);
}

export function bookingRequestCapabilityHash(
  requestId: string,
  requestCapability: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`booking-request-capability:${requestId}:${requestCapability}`)
    .digest("hex");
}

export function bookingConfirmationNonceHash(nonce: string) {
  // Existing checkout handoffs persist the JSON-string encoding, including its quotes.
  return createHash("sha256").update(JSON.stringify(nonce)).digest("hex");
}

export function bookingHandoffExpiresAt(providerExpiresAt: string | number | Date) {
  const expiresAt = new Date(providerExpiresAt).getTime();
  if (!Number.isFinite(expiresAt)) throw new Error("Invalid booking provider expiry");
  return new Date(expiresAt + BOOKING_HANDOFF_SKEW_SECONDS * 1000);
}

export function bookingHandoffMaxAge(providerExpiresAt: string | number | Date, now = Date.now()) {
  return Math.max(
    1,
    Math.ceil((bookingHandoffExpiresAt(providerExpiresAt).getTime() - now) / 1000),
  );
}

export function bookingReceiptToken(
  environment: string,
  checkoutSessionId: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`booking-confirmation:${environment}:${checkoutSessionId}`)
    .digest("base64url");
}
