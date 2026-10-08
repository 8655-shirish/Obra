import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260829093923_booking_customer_lifecycle_closure.sql");
const lifetime = read("supabase/migrations/20260910133000_booking_notification_lifetime.sql");
const confirmation = read("src/lib/booking-confirmation.functions.ts");
const returnRoute = read("src/routes/booking.return.tsx");
const confirmationRoute = read("src/routes/booking.confirmation.tsx");
const notifications = read("src/lib/booking-notifications.server.ts");
const worker = read("src/lib/booking-notification-worker.server.ts");
const webhook = read("src/routes/api/resend/webhook.ts");

assert.match(returnRoute, /GET: async/);
assert.match(returnRoute, /status: 303/);
assert.ok(confirmation.includes('bookingCookieName("handoff", reference'));
assert.ok(confirmation.includes('bookingCookieName("receipt", reference'));
assert.ok(confirmation.includes("p_reference: data.reference"));
assert.match(migration, /public_reference=p_reference/);
assert.match(
  migration,
  /update public.booking_notifications set source_event_key=idempotency_key where source_event_key is null;/,
  "notification source-event backfill must remain qualified for managed safeupdate",
);
assert.doesNotMatch(
  migration,
  /update public.booking_notifications set source_event_key=coalesce(source_event_key,idempotency_key);/,
  "unqualified notification source-event backfill is rejected by managed safeupdate",
);
assert.match(confirmationRoute, /MAX_AUTOMATIC_POLLS = 12/);
assert.match(confirmationRoute, /Refresh status/);

for (const type of [
  "confirmed",
  "cancelled",
  "refund_pending",
  "refund_succeeded",
  "refund_failed",
  "late_payment",
  "calendar_failed",
  "calendar_repaired",
]) {
  assert.ok(migration.includes("'" + type + "'"), "missing ledger type " + type);
  assert.ok(notifications.includes('"' + type + '"'), "missing delivery type " + type);
}
for (const audience of ["customer", "contractor"])
  assert.ok(migration.includes("'" + audience + "'"), "missing audience " + audience);
for (const state of ["accepted", "delivered", "delivery_delayed", "bounced", "complained"])
  assert.ok(migration.includes("'" + state + "'"), "missing delivery state " + state);
assert.match(migration, /p_retryable and attempts<8/);
assert.match(migration, /booking_notification_delivery_review_v3/);
assert.match(migration, /retry_exhausted/);
assert.match(migration, /power\(2,least\(attempts,8\)\)/);
assert.match(migration, /then'retry'else'failed'/);
for (const contract of [
  "fencing_token",
  "booking_notification_delivery_events",
  "occurrence_version",
  "recipient_missing_or_invalid",
])
  assert.ok(migration.includes(contract), "missing notification safety contract " + contract);
assert.ok(migration.includes("consume_booking_confirmation_capability_v3(text,uuid)"));
assert.match(webhook, /RESEND_WEBHOOK_SECRET/);
assert.match(webhook, /svix-signature/);
for (const marker of [
  "drop function public.claim_due_booking_notifications_v3(text,uuid,integer)",
  "p_dispatch_contract is distinct from 1",
  "replay_deadline_at=first_dispatch_at+interval '24 hours'",
  "n.dispatch_payload is distinct from p_payload",
  "n.dispatch_appointment is distinct from current_appointment",
  "not public.booking_notification_event_current_v4(n.id)",
  "p_expected_appointment @> current_appointment",
  "n.lease_expires_at<=pg_catalog.clock_timestamp()",
  "'idempotency_expired'",
  "'acceptance_unknown'",
  "'dispatch_budget_ms',budget_ms",
  "from public,anon,authenticated,service_role,booking_worker",
  "public.authorize_booking_notification_dispatch_v3(uuid,text,uuid,bigint,jsonb,text) to booking_worker",
])
  assert.ok(lifetime.includes(marker), "missing dispatch authority: " + marker);
assert.doesNotMatch(lifetime, /grant\s+(?:all|select|insert|update|delete|truncate)\b/i);
for (const [grant] of lifetime.matchAll(
  /grant execute[^;]*to (?:public|anon|authenticated|service_role)\b/gi,
)) {
  assert.match(
    grant,
    /^grant execute on function public\.defer_saas_checkout_fulfillment\(uuid,uuid,bigint,text\) to service_role$/i,
    "only the existing SaaS deferral RPC retains service authority; booking delivery stays worker-only",
  );
}
assert.ok(worker.includes("p_dispatch_contract: 1"));
assert.ok(worker.includes('"authorize_booking_notification_dispatch_v3"'));
assert.ok(worker.includes("p_expected_appointment: context.appointment"));
assert.ok(worker.includes("dispatch.payload !== payload"));
assert.ok(
  worker.includes("dispatchDeadlineAt: authorizationStartedAt + dispatch.dispatch_budget_ms"),
);
assert.ok(worker.includes("if (providerAccepted)"));
assert.ok(
  worker.indexOf('"authorize_booking_notification_dispatch_v3"') <
    worker.indexOf("await sendBookingNotification({"),
);
assert.ok(notifications.includes("input.dispatchDeadlineAt - performance.now()"));
assert.ok(notifications.includes('redirect: "manual"'));
assert.ok(notifications.includes("body: input.payload"));

console.log(
  "verify-booking-receipts-notifications: receipt binding, bounded polling, audiences, types, delivery states, and retry classes present",
);
