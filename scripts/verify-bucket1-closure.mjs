import assert from "node:assert/strict";
import fs from "node:fs";
import { deriveBucketOneReadiness } from "../src/lib/booking-readiness.ts";

const closure = fs.readFileSync("supabase/migrations/20260829093905_bucket1_closure.sql", "utf8");
const foundation = fs.readFileSync(
  "supabase/migrations/20260829093900_booking_authorization_foundation.sql",
  "utf8",
);
const hardening = fs.readFileSync(
  "supabase/migrations/20260829093904_bucket1_audit_hardening.sql",
  "utf8",
);
const entitlement = fs.readFileSync(
  "supabase/migrations/20260829093903_verified_website_entitlements.sql",
  "utf8",
);
const readinessServer =
  fs.readFileSync("src/lib/booking-readiness.server.ts", "utf8") +
  fs.readFileSync("src/lib/google-calendar-readiness.ts", "utf8");
const stripeWorker = fs.readFileSync("src/lib/stripe-inbox-worker.server.ts", "utf8");
const publicRoute = fs.readFileSync("src/routes/lp/$websiteId.tsx", "utf8");
const bookingSetup = fs.readFileSync("src/lib/booking-setup.functions.ts", "utf8");
const leads = fs.readFileSync("src/lib/leads.functions.ts", "utf8");
const availabilityEditor = fs.readFileSync("src/components/booking/AvailabilityEditor.tsx", "utf8");
const types = fs.readFileSync("src/integrations/supabase/types.ts", "utf8");
const dbTest = fs.readFileSync("supabase/tests/bucket1-foundation.sql", "utf8");
const failures = [];
const requireFragments = (name, source, fragments) => {
  for (const fragment of fragments)
    if (!source.includes(fragment)) failures.push(name + ": missing " + fragment);
  if (!dbTest.includes(name)) failures.push(name + ": missing executable SQL assertion");
};

requireFragments("stale inbox fence", closure, [
  "processing_state='processing'",
  "lease_token is distinct from p_lease_token",
  "fencing_token<>p_fencing_token",
  "lease_expires_at<pg_catalog.clock_timestamp()",
  "stale provider event fence",
]);
requireFragments("expired checkout/payment", closure + entitlement, [
  "reservation_expires_at>pg_catalog.clock_timestamp()",
  "reservation_expires_at<=pg_catalog.clock_timestamp()",
  "expire_checkout_intent",
  "status='expired'",
]);
requireFragments("cancellation create race", closure, [
  "superseded_by_cancellation",
  "command_type='calendar_create'",
  "fencing_token=fencing_token+1",
  "state in('pending','failed')",
  "calendar_cancel_after_create:",
  "desired_appointment_version",
]);
requireFragments("durable SaaS ingress markers", closure, [
  "ingest_provider_event",
  "event_family='saas'",
  "apply_saas_provider_event",
  "provider event replay identity conflict",
]);
requireFragments("attachment key uniqueness/path and exact composition", closure, [
  "booking_attachments_storage_object_key_uk",
  "booking_attachments_exact_appointment_fkey",
  "booking attachment object key must be canonical",
  "new.environment||'/'||new.profile_id::text||'/'||new.website_id::text||'/'||new.appointment_id::text||'/'||new.id::text",
]);
requireFragments("atomic outbox apply", closure, [
  "complete_outbox_appointment_command",
  "successful outbox commands require atomic domain settlement",
  "stale outbox command fence",
]);
requireFragments("late payment recover/refund", closure, [
  "late_payment_recovered",
  "late_payment_refund",
  "'refund_full'",
  "pg_advisory_xact_lock",
]);
requireFragments("custom overrides", closure, [
  "p_overrides jsonb",
  "'custom_hours'",
  "availability_override_intervals",
  "too many override intervals",
]);
requireFragments("overnight rejection", foundation, ["check (local_start < local_end)"]);
requireFragments("purge attribution", closure, [
  "attributable lead purge required",
  "actor_user_id",
  "reason||'; count='",
]);
requireFragments("legacy snapshots", closure, [
  "snapshot_status",
  "'legacy_unavailable'",
  "snapshot_version",
  "'captured'",
]);
requireFragments("provider freshness/shared readiness", readinessServer, [
  "const FRESHNESS_MS = 15 * 60 * 1000",
  "last_verified_at",
  "last_health_at",
  "projectGoogleCalendarReadiness",
  "selection.blocks_availability",
  "selection.receives_bookings",
  "charges_enabled",
  "payouts_enabled",
  "details_submitted",
]);
requireFragments("offboarding retention", hardening, [
  "offboard_starter_leads",
  "quote_admission=false",
  "'offboard'",
  "return affected",
]);
requireFragments("scanner fences", hardening, [
  "claim_booking_attachment_scan",
  "complete_booking_attachment_scan",
  "scan_fencing_token",
  "stale attachment scan fence",
  "attachment scanner is not proven",
]);

if (/alter table public\.lead_governance_events\s+select \*/i.test(closure))
  failures.push("closure SQL structure: truncated lead_governance_events ALTER/function boundary");
if (
  /create or replace function public\.complete_outbox_appointment_command\([^$]*create or replace function public\.complete_outbox_appointment_command/i.test(
    closure,
  )
)
  failures.push("closure SQL structure: duplicated complete_outbox_appointment_command header");
if (/^\s*p_rate_limit_key text\s*\n\s*\) returns uuid/m.test(closure))
  failures.push("closure SQL structure: orphan submit_starter_website_lead function tail");

const base = {
  websiteId: "w",
  profileId: "p",
  environment: "test",
  isPublished: true,
  isActiveVersion: true,
  entitlement: { plan: "pro", state: "active", order_confirmed_at: "2026-01-01" },
  serviceActive: true,
  scheduleActive: true,
  intervalCount: 1,
};
try {
  assert.equal(
    deriveBucketOneReadiness({ ...base, calendarState: "ready", paymentsState: "ready" })
      .firstIncompleteStep,
    "complete",
  );
  assert.equal(
    deriveBucketOneReadiness({ ...base, calendarState: "not_configured", paymentsState: "ready" })
      .firstIncompleteStep,
    "calendar",
  );
  assert.equal(
    deriveBucketOneReadiness({ ...base, calendarState: "ready", paymentsState: "restricted" })
      .firstIncompleteStep,
    "payments",
  );
} catch (error) {
  failures.push("provider freshness/shared readiness pure projection: " + error.message);
}
if (
  !readinessServer.includes("timestamp >= now - FRESHNESS_MS") ||
  !readinessServer.includes("timestamp <= now + 60_000")
)
  failures.push("provider freshness/shared readiness: bounded freshness comparator absent");

for (const rpc of [
  "ingest_provider_event",
  "apply_saas_provider_event",
  "complete_outbox_appointment_command",
  "record_lead_governance_event",
]) {
  if (!new RegExp("\\b" + rpc + ":\\s*\\{").test(types))
    failures.push("type fidelity: generated Database type omits " + rpc);
}
for (const column of ["snapshot_status", "snapshot_version"])
  if (!new RegExp("\\b" + column + ":").test(types))
    failures.push("type fidelity: generated leads row omits " + column);
if (!dbTest.includes("type fidelity"))
  failures.push("type fidelity: missing SQL catalog assertion");
for (const [name, source, fragments] of [
  [
    "lead backfill ordering",
    closure,
    ["drop trigger if exists leads_history_immutable", "create trigger leads_history_immutable"],
  ],
  [
    "provider readiness completeness",
    readinessServer,
    [
      "pendingVerification.length === 0",
      "freeBusyReader",
      "entitlementTemporallyEligible",
      "selection.blocks_availability",
      "selection.receives_bookings",
      "destinationCount",
    ],
  ],
  [
    "Stripe checkout authority",
    stripeWorker,
    [
      "checkout.sessions.retrieve",
      "subscriptions.retrieve",
      'session.payment_status === "paid"',
      "failClaimedEvent",
      "next_attempt_at",
      "nowSeconds + 300",
    ],
  ],
  ["public server boundary", publicRoute, ["createServerFn", "loadPublicSite"]],
  [
    "lead temporal admission",
    leads,
    [
      '.eq("environment", website.environment)',
      '.lte("effective_at", admissionCheckedAt)',
      '.eq("status", "live")',
      "config?.contactHidden !== true",
    ],
  ],
  [
    "timezone editor safety",
    bookingSetup + availabilityEditor,
    ["Enter a valid IANA time zone", "setMessage(null)"],
  ],
  [
    "attachment upload transition",
    closure,
    ["mark_booking_attachment_uploaded", "attachment state requires fenced command"],
  ],
  [
    "temporal setup authority",
    closure + bookingSetup,
    [
      "effective_at is not null",
      "save_shared_booking_availability_base",
      "Only one override is allowed per date",
    ],
  ],
])
  for (const fragment of fragments)
    if (!source.includes(fragment)) failures.push(name + ": missing " + fragment);
if (failures.length) {
  console.error("Bucket 1 closure verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("verify-bucket1-closure: 16 audited gap groups covered");
