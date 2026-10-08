import { readFileSync } from "node:fs";
const read = (path) => readFileSync(path, "utf8");
const requireText = (path, values) => {
  const text = read(path);
  for (const value of values)
    if (!text.includes(value)) throw new Error(path + " missing " + value);
};
const foundation = read("supabase/migrations/20260829093900_booking_authorization_foundation.sql");
const bookingPaymentsTable =
  /create table public\.booking_payments \(([\s\S]*?)\n\);/.exec(foundation)?.[1] ?? "";
if (!bookingPaymentsTable.includes("unique (appointment_id, environment)")) {
  throw new Error("booking_payments missing unique appointment/environment contract");
}
requireText("supabase/migrations/20260829093911_bucket3_live_booking_lifecycle.sql", [
  "reserve_live_booking",
  "claim_booking_checkout",
  "apply_booking_payment_event",
  "booking_confirmation_capabilities",
  "claim_due_booking_outbox",
  "cancel_contractor_booking",
  "refund_generation",
  "calendar_generation",
  "booking_availability_cache",
  "apply_booking_money_mirror_event",
  "claim_due_booking_sessions",
  "settle_due_booking_session",
  "booking_contract_version",
  "effect_contract_version",
  "calendar_destination_epochs",
  "enqueue_booking_calendar_create",
  "booking_payments_checkout_operation_fk",
  "revoke all on function public.reserve_live_booking",
  "grant execute on function public.reserve_live_booking",
  "check_public_booking_rate_limit",
  "bind_booking_confirmation_nonce",
  "set_booking_checkout_provider_deadline",
  "booking_payments_refund_succeeded_full_ck",
  "dispute_id",
  "a.appointment_state in('held','cancelled')",
]);
requireText("src/lib/booking-live.functions.ts", [
  "BOOKING_LIVE_ENABLED",
  "findAvailableBookingSlots",
  "stripeAccount",
  "idempotencyKey",
  'mode: "payment"',
  "trustedClientBucket",
  "bookingCookieName",
  "providerDeadline",
]);
requireText("src/lib/booking-availability.ts", [
  "localDateTimeCandidates",
  "externalBusy",
  "internalBusy",
  "bufferBeforeMinutes",
]);
requireText("src/lib/pipedream.server.ts", [
  "createGoogleConnectLink",
  'url.searchParams.set("app", appSlug)',
  "getGoogleCalendarBusyRanges",
  "createGoogleBookingEvent",
  "deleteGoogleBookingEvent",
  "sendUpdates",
  "startMs >= endMs",
  "attempts: 1",
]);
requireText("src/routes/api/stripe/connect-webhook.ts", [
  '"booking"',
  "checkout.session.completed",
  "charge.refunded",
  "charge.dispute.created",
]);
requireText("src/lib/booking-stripe-inbox-worker.server.ts", [
  "reduce_booking_financial_evidence_v3",
  "snapshot",
  "refundsHasMore",
]);
requireText("supabase/migrations/20260829093921_booking_money_authority_closure.sql", [
  "capture_booking_cutover_preflight_v3",
  "reduce_booking_financial_evidence_v3",
  "booking financial truth is reducer-owned",
]);
requireText("supabase/migrations/20260829093914_booking_authoritative_evidence.sql", [
  "immutable provider envelope mismatch",
  "settle_booking_refund_command",
  "claim_booking_calendar_reconciliation",
]);
requireText("src/lib/booking-reconciliation.server.ts", [
  "claim_booking_late_payment_arbitrations",
  "record_booking_late_payment_observation",
  "claim_booking_calendar_reconciliation",
  "claim_ambiguous_booking_checkouts",
  "billingEnvironment",
]);
requireText("src/lib/booking-outbox-worker.server.ts", [
  "refunds.create",
  "reduce_booking_financial_evidence_v3",
  "Stripe refund pagination did not advance",
]);
requireText("src/routes/lp/$websiteId.tsx", [
  "LiveBookingDialog",
  'readiness.publicMode === "live_booking"',
]);
requireText("src/routes/bookings.tsx", [
  "My Bookings",
  "Past Bookings",
  "Cancel Booking",
  "Confirm cancellation",
  "Availability Settings",
  "Source website",
  "Load more bookings",
]);
requireText("src/routes/booking.return.tsx", [
  "no-store",
  "no-referrer",
  "status: 303",
  "exchangeBookingReturn",
]);
requireText("src/routes/booking.confirmation.tsx", ["no-store", "consumeBookingConfirmation"]);
requireText("supabase/migrations/20260829093912_booking_cutover_inventory.sql", [
  "booking_cutover_quarantine",
  "nonterminal_v1_provider_effect",
  "status text not null default 'blocked'",
]);
requireText("supabase/migrations/20260829093917_admin_auth_hardening.sql", [
  "check_admin_login_rate_limit",
  "admin_principals",
  "aal='aal2'",
]);
requireText("src/lib/booking-notifications.server.ts", ["Idempotency-Key", "api.resend.com"]);
requireText("src/lib/booking-attachments.functions.ts", [
  "complete_booking_attachment_scan",
  "BOOKING_SCANNER_URL",
]);
requireText("src/lib/booking-reconciliation.server.ts", [
  "getGoogleBookingEvent",
  "claim_booking_calendar_reconciliation",
  "record_booking_calendar_observation",
  "createGoogleBookingEvent",
]);
requireText("supabase/migrations/20260829093913_booking_refund_ledger.sql", [
  "booking_refunds",
  "amount_minor bigint not null",
  "stripe_refund_id",
]);
requireText("src/integrations/supabase/booking-worker.server.ts", [
  "SUPABASE_BOOKING_WORKER_KEY",
  "accessToken",
]);
console.log(
  "OK: Bucket 3 live booking, payment, provider, confirmation, and cancellation contracts present",
);
