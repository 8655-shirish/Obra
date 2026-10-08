import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260829093921_booking_money_authority_closure.sql",
  "utf8",
);
const inbox = await readFile("src/lib/booking-stripe-inbox-worker.server.ts", "utf8");
const outbox = await readFile("src/lib/booking-outbox-worker.server.ts", "utf8");
const convergence = await readFile(
  "supabase/migrations/20260829093922_booking_google_convergence_closure.sql",
  "utf8",
);
const customer = await readFile(
  "supabase/migrations/20260829093923_booking_customer_lifecycle_closure.sql",
  "utf8",
);
const confirmation = await readFile("src/lib/booking-confirmation.functions.ts", "utf8");
const receipt = await readFile("src/lib/booking-receipt.server.ts", "utf8");
const checkout = await readFile("src/lib/booking-live.functions.ts", "utf8");
const saasWebhook = await readFile("src/routes/api/stripe/webhook.ts", "utf8");
const saasInbox = await readFile("src/lib/stripe-inbox-worker.server.ts", "utf8");

for (const marker of [
  "captured_xid xid8",
  "booking cutover preflight must commit before activation",
  "booking_cutover_inventory_v3",
  "legacyOrNullAppointments",
  "legacyOrNullPayments",
  "legacyOrNullEffects",
  "authorityAcl",
  "booking_contract_version is distinct from 2",
  "effect_contract_version is distinct from 2",
  "provider_event_inbox_booking_stripe_envelope_v3",
  "booking Stripe envelope is immutable",
  "validate_booking_refund_snapshot_v3",
  "duplicate refund in complete snapshot",
  "refundsHasMore",
  "paid_arbitration_required",
  "session_expiry",
  "expiry_paid_arbitration_required",
  "expiry_unpaid_released",
  "failure_ignored_paid_terminal",
  "refund_fully_converged",
  "owned_refund_partial_remainder",
  "'canceled'",
  "then refunded_at_value else null end",
  "guard_booking_financial_truth_v3",
  "booking_financial_guard_token_v3",
  "reduce_booking_financial_evidence_v3",
  "fail_booking_refund_command_v3",
  "refund_payment_correlation_mismatch",
  "prepare_booking_refund_snapshot_v3",
  "settle_booking_refund_snapshot_v3",
  "unsupported booking Stripe event type",
  "unsupported Stripe dispute evidence",
]) {
  assert.ok(migration.includes(marker), "missing authority marker: " + marker);
}

for (const retired of [
  "apply_booking_provider_evidence(uuid,uuid,bigint)",
  "apply_booking_payment_event(uuid,uuid,bigint,uuid,text,text,text,bigint,text,boolean)",
  "apply_booking_money_mirror_event(uuid,uuid,bigint,text,text,bigint,text,text,text,bigint)",
  "record_booking_refund_provider_result(uuid,bigint,text,text,bigint,bigint)",
  "ensure_booking_refund_submission(uuid,bigint)",
  "settle_booking_refund_command(uuid,uuid,bigint,text,text,bigint,bigint)",
  "settle_due_booking_session(uuid,uuid,bigint,boolean,boolean,text,text,bigint,text)",
  "complete_booking_outbox(uuid,uuid,bigint,jsonb)",
]) {
  assert.ok(migration.includes(retired), "missing explicit revoke: " + retired);
}

for (const forbidden of [
  "apply_booking_provider_evidence",
  "apply_booking_payment_event",
  "apply_booking_money_mirror_event",
]) {
  assert.equal(
    inbox.includes(forbidden),
    false,
    "inbox worker retains scalar authority: " + forbidden,
  );
}
assert.ok(inbox.includes("reduce_booking_financial_evidence_v3"));
assert.ok(inbox.includes("Stripe refund pagination did not advance"));
assert.ok(inbox.includes("refundsHasMore: refundPage.refundsHasMore"));
assert.ok(inbox.includes("providerJson"));

for (const forbidden of [
  "settle_booking_refund_command",
  "ensure_booking_refund_submission",
  "record_booking_refund_provider_result",
]) {
  assert.equal(
    outbox.includes(forbidden),
    false,
    "refund worker retains scalar authority: " + forbidden,
  );
}
assert.ok(outbox.includes("reduce_booking_financial_evidence_v3"));
assert.ok(outbox.includes("fail_booking_refund_command_v3"));
assert.equal(outbox.includes('"fail_booking_outbox"'), false);
assert.ok(outbox.includes("bookingPaymentId"));
assert.ok(outbox.includes("Stripe refund pagination did not advance"));
assert.ok(outbox.includes("createError"));
assert.ok(outbox.includes("providerJson"));
assert.equal(outbox.includes("amountPaid -"), false);
assert.ok(convergence.includes("current committed money preflight required"));
assert.ok(convergence.includes("accepted_preflight_id"));
assert.ok(convergence.includes("p_actor_token_hash text"));
assert.ok(convergence.includes("booking_calendar_repair_audit"));
assert.equal(convergence.includes("p_actor_user_id uuid"), false);
assert.ok(confirmation.includes("if (!confirmationNonce)"));
assert.ok(confirmation.includes('"recover_booking_checkout_handoff_v3"'));
assert.equal(
  confirmation.match(/p_nonce_hash: bookingConfirmationNonceHash\(confirmationNonce\)/g)?.length,
  2,
);
assert.match(
  receipt,
  /export function bookingConfirmationNonceHash\(nonce: string\)\s*\{[\s\S]*?return createHash\("sha256"\)\.update\(JSON\.stringify\(nonce\)\)\.digest\("hex"\)/,
);
assert.ok(
  checkout.includes(
    "const confirmationNonceHash = bookingConfirmationNonceHash(confirmationNonce)",
  ),
);
assert.equal(checkout.match(/p_nonce_hash: confirmationNonceHash/g)?.length, 2);
assert.ok(customer.includes("bp.confirmation_nonce_hash=p_nonce_hash"));
assert.ok(
  customer.includes(
    "public.booking_receipt_capabilities_v3.issued_nonce_hash=excluded.issued_nonce_hash",
  ),
);
assert.ok(
  confirmation.indexOf("if (!confirmationNonce)") <
    confirmation.indexOf('"recover_booking_checkout_handoff_v3"'),
);
assert.ok(
  confirmation.indexOf('"recover_booking_checkout_handoff_v3"') <
    confirmation.indexOf("getStripe().checkout.sessions.retrieve"),
);
assert.doesNotMatch(
  confirmation,
  /url\.searchParams\.get\(["'](?:nonce|token|confirmation_nonce)["']\)/,
);
assert.equal(confirmation.includes("suppliedNonce ?? recoverableNonce"), false);
assert.ok(saasWebhook.includes("await processSaasStripeInbox(1, event.id)"));
assert.ok(
  saasInbox.includes('if (providerEventId) throw new Error("Stripe event verification failed")'),
);
assert.ok(
  saasInbox.includes('if (providerEventId) throw new Error("Stripe event projection failed")'),
);
assert.ok(
  saasInbox.includes('if (providerEventId) throw new Error("SaaS event application failed")'),
);
assert.ok(customer.includes("Effective final worker allowlist"));
assert.ok(customer.includes("reduce_booking_financial_evidence_v3(text,uuid,uuid,bigint,jsonb)"));
assert.ok(customer.includes("claim_due_booking_outbox(text,uuid,integer)"));
assert.ok(customer.includes("claim_due_booking_session_expiries_v3"));
assert.ok(customer.includes("renew_booking_refund_command_v3"));
assert.ok(customer.includes("renew_booking_worker_family_v3"));
assert.ok(customer.includes("o.environment=p_environment"));
for (const retired of [
  "apply_booking_provider_evidence",
  "settle_booking_refund_command",
  "ensure_booking_refund_submission",
]) {
  const allowlist = customer.slice(customer.indexOf("-- Effective final worker allowlist"));
  assert.equal(allowlist.includes(retired), false, "later allowlist reopened " + retired);
}

console.log("verify-booking-money-authority-closure: passed");
