/** Canonical consent displayed before live booking. Change version and digest with any text change. */
export const BOOKING_CONSENT_DOCUMENT_ID = "obra-booking-data-and-payment-consent";
export const BOOKING_CONSENT_VERSION = "2026-08-29.1";
export const BOOKING_CONSENT_TEXT =
  "I agree that the contractor may use the contact details, service address, appointment details, notes, and optional images I provide to schedule and fulfill this booking and to send booking-related communications. I understand that Stripe processes payment and that completing Stripe Checkout charges the amount displayed for this appointment.";
export const BOOKING_CONSENT_DIGEST =
  "899ffc003957450d395fb07b007db8fea35d25275794367e56210a3bc76db16f";

export function bookingConsentDocument() {
  return {
    documentId: BOOKING_CONSENT_DOCUMENT_ID,
    version: BOOKING_CONSENT_VERSION,
    digest: BOOKING_CONSENT_DIGEST,
    text: BOOKING_CONSENT_TEXT,
  } as const;
}
