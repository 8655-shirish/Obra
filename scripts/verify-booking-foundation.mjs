import { readFileSync } from "node:fs";

const migrationPath = "supabase/migrations/20260829093900_booking_authorization_foundation.sql";
const sql = readFileSync(migrationPath, "utf8");
const entitlementMigration = readFileSync(
  "supabase/migrations/20260829093903_verified_website_entitlements.sql",
  "utf8",
);
const checkoutImplementation = readFileSync("src/lib/checkout.functions.ts", "utf8");
const saasAuthority = readFileSync(
  "supabase/migrations/20260901110000_saas_checkout_authority_and_entitlement_lifecycle.sql",
  "utf8",
);
const webhook = readFileSync("src/routes/api/stripe/webhook.ts", "utf8");
const inboxWorker = readFileSync("src/lib/stripe-inbox-worker.server.ts", "utf8");
const otpWorker = readFileSync("src/lib/checkout-otp-outbox-worker.server.ts", "utf8");
const checkoutReturn =
  checkoutImplementation
    .split("export const finalizeStripeCheckout =")[1]
    ?.split("export const resendCheckoutOtp =")[0] ?? "";
const hardeningMigration = readFileSync(
  "supabase/migrations/20260829093904_bucket1_audit_hardening.sql",
  "utf8",
);

const requiredTables = [
  "website_entitlements",
  "booking_services",
  "availability_schedules",
  "availability_intervals",
  "availability_overrides",
  "availability_override_intervals",
  "booking_customers",
  "appointments",
  "appointment_operations",
  "booking_payments",
  "booking_attachments",
  "stripe_connected_accounts",
  "calendar_connections",
  "calendar_selections",
  "calendar_event_links",
  "pipedream_bindings",
  "provider_event_inbox",
  "integration_outbox",
];

const failures = [];
for (const table of requiredTables) {
  if (!sql.includes(`create table public.${table}`)) failures.push(`missing table ${table}`);
  if (!sql.includes(`alter table public.${table} enable row level security`)) {
    failures.push(`RLS not enabled for ${table}`);
  }
}

const requiredFragments = [
  "duration_minutes integer not null default 60",
  "slot_interval_minutes integer not null default 30",
  "buffer_before_minutes integer not null default 0",
  "buffer_after_minutes integer not null default 0",
  "minimum_notice_minutes integer not null default 1440",
  "booking_horizon_days integer not null default 60",
  "currency text not null default 'USD'",
  "foreign key (website_id, profile_id, environment)",
  "foreign key (entitlement_id, profile_id, environment)",
  "unique (id, profile_id, environment)",
  "appointment_state in ('held','payment_pending','confirmed','cancelled')",
  "payment_state in ('not_started','creating','pending','paid','failed','disputed')",
  "refund_state in ('not_requested','pending','succeeded','failed')",
  "calendar_state in ('not_required','create_pending','created','create_failed','cancel_pending','cancelled','cancel_failed')",
  "review_state in ('none','late_payment','refund_failure','calendar_reconciliation','provider_inconsistency')",
  "exclude using gist",
  "interval '15 minutes'",
  "idempotency key payload conflict",
  "security definer set search_path = ''",
  "revoke all on function public.reserve_booking_hold",
  "grant execute on function public.reserve_booking_hold",
  "provider_event_inbox_claim_idx",
  "integration_outbox_claim_idx",
];
for (const fragment of requiredFragments) {
  if (!sql.includes(fragment)) failures.push(`missing invariant: ${fragment}`);
}

if (/to anon/i.test(sql.match(/create policy[\s\S]*/i)?.[0] ?? "")) {
  failures.push("new table policies grant anonymous table access");
}

const entitlementFragments = [
  "create or replace function public.grant_verified_website_entitlement(",
  "security definer",
  "set search_path = ''",
  "status in ('pending_otp','completed')",
  "existing_entitlement.checkout_session_id = checkout_row.id",
  "checkout_row.status <> 'pending_otp'",
  "website already has a different purchase entitlement",
  "payment_verified_at is null",
  "checkout_sessions_active_website_environment_uk",
  "checkout_sessions_subscription_uk",
  "checkout_sessions_subscription_tenant_fkey",
  "checkout_sessions_entitlement_identity_uk",
  "website_entitlements_checkout_tenant_fkey",
  "reserve_checkout_intent",
  "protect_paid_checkout_identity",
  "ensure_checkout_website",
  "finalize_paid_checkout",
  "paid checkout requires tenant reconciliation before migration",
  "old.payment_verified_at is not null",
  "checkout_row.website_id is distinct from website_row.id",
  "provider checkout already active for different intent",
  "set status='expired', subscription_id=null",
  "simulated checkout is test-only",
  "case when p_status='pending_otp' then 'local_test_simulation' else null end",
  "payment_evidence_kind",
  "revoke all on function public.grant_verified_website_entitlement",
  "grant execute on function public.grant_verified_website_entitlement",
  "The legacy checkoutConfirmedAt marker identifies the exact origin/main site",
  "It is not provider payment evidence",
  "false,(s.status='active' and s.plan='starter')",
  "s.created_at,s.created_at,null",
  "and c.status='pending_payment' and c.payment_verified_at is null",
  "legacy_post_payment",
  "legacy pending OTP checkout requires exact non-destructive reconciliation",
  "legacy post-payment evidence is migration-only",
];
for (const fragment of entitlementFragments) {
  if (!entitlementMigration.includes(fragment))
    failures.push(`missing entitlement invariant: ${fragment}`);
}
for (const fragment of [
  "appointments_entitlement_website_tenant_fkey",
  "calendar_event_links_selection_connection_tenant_fkey",
  "project_saas_subscription_status",
  "drop index if exists public.subscriptions_one_active_per_profile",
  "website_entitlements_subscription_environment_uk",
  "drop constraint if exists website_entitlements_admission_check",
  "last_provider_event_id = p_provider_event_id",
  "and environment = p_environment",
  "leads_history_immutable",
  "apply_provider_appointment_event",
  "claim_outbox_command",
  "complete_outbox_command",
  "claim_provider_event",
  "complete_provider_event",
  "transition_appointment",
  "appointment revision conflict",
  "booking-attachments",
  "booking_attachment_security",
  "attachment scanner is not proven",
  "claim_booking_attachment_scan",
  "complete_booking_attachment_scan",
  "data_retention_policies",
  "lead_governance_events",
  "offboard_starter_leads",
  "purge_retained_leads",
]) {
  if (!hardeningMigration.includes(fragment)) failures.push(`missing audit hardening: ${fragment}`);
}

if (!checkoutImplementation.includes('payment_method_types: ["card"]')) {
  failures.push("Stripe checkout is not restricted to immediate card settlement");
}
if (!checkoutImplementation.includes("reserve_checkout_intent")) {
  failures.push("checkout intent is not reserved atomically");
}
// Inspect the current SQL bodies, not superseded finalizers or unrelated RPCs.
const saasFunction = (name) => {
  const start = Math.max(
    saasAuthority.indexOf(`create function public.${name}(`),
    saasAuthority.indexOf(`create or replace function public.${name}(`),
  );
  const end = saasAuthority.indexOf("\nend $$;", start);
  if (start < 0 || end < start) throw new Error(`Missing SaaS authority function: ${name}`);
  return saasAuthority.slice(start, end);
};
const fulfillmentFence =
  "where id=p_id and state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()";
for (const [name, source, fragments] of [
  [
    "signed ingress",
    webhook,
    [
      "event = await constructStripeWebhookEvent(rawBody, signature, secret)",
      '.rpc("ingest_provider_event", {',
      'p_event_family: "saas"',
      "p_payload: JSON.parse(rawBody)",
      "await processSaasStripeInbox(1, event.id)",
    ],
  ],
  [
    "paid inbox projection",
    inboxWorker,
    [
      'session.payment_status === "paid"',
      'action: "finalize_checkout"',
      'if (row.processing_state === "processed") return { processed: 0, outcome: "completed" }',
      '"apply_saas_provider_event",',
      "p_event_id: row.id",
      "p_lease_token: leaseToken",
      "p_fencing_token: fence",
      "p_projection: eventProjection",
    ],
  ],
  [
    "transactional inbox reducer",
    saasFunction("apply_saas_provider_event"),
    [
      "provider='stripe'and event_family='saas'and processing_state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()for update",
      "c.environment=inbox.environment and c.stripe_checkout_session_id=p_projection->>'stripeCheckoutSessionId'",
      "finalization_outcome:=public.finalize_paid_checkout((p_projection->>'checkoutSessionId')::uuid,p_projection->>'stripeCheckoutSessionId',p_projection->>'providerSubscriptionId',p_projection->>'providerCustomerId',p_projection->>'priceId',p_projection->>'plan',p_projection->'providerOfferEvidence',p_event_id)",
      "if finalization_outcome not in('finalized','already_finalized')then raise exception",
      "update public.provider_event_inbox set processing_state='processed'",
      "where id=p_event_id and processing_state='processing'and lease_token=p_lease_token and fencing_token=p_fencing_token and lease_expires_at>=pg_catalog.clock_timestamp()",
      "if not found then raise exception'stale SaaS provider event fence'",
    ],
  ],
  [
    "atomic paid finalization",
    saasFunction("finalize_paid_checkout"),
    [
      "select*into strict c from public.checkout_sessions where id=p_checkout_session_id for update",
      "event_type='checkout.session.completed'and environment=c.environment and processing_state='processing'",
      "c.provider_completion_event_id=p_provider_event_id and c.provider_completion_payload_hash=inbox.payload_hash and c.provider_completion_evidence=completed_evidence",
      "perform public.enqueue_saas_checkout_fulfillment(c.id);return'already_finalized'",
      "raise exception'checkout payment identity conflict'",
      "update public.subscriptions set plan=p_plan",
      "where id=c.subscription_id and user_id=c.profile_id and environment=c.environment and status='pending_activation'",
      "if not found then raise exception'checkout subscription binding mismatch'",
      "update public.checkout_sessions set status='pending_otp'",
      "provider_completion_event_id=p_provider_event_id,provider_completion_payload_hash=inbox.payload_hash where id=c.id",
      "perform public.enqueue_saas_checkout_fulfillment(c.id);return'finalized'",
    ],
  ],
  [
    "outbox replay dedupe",
    saasFunction("enqueue_saas_checkout_fulfillment"),
    [
      "c.payment_verified_at is null or c.payment_evidence_kind<>'stripe_api'",
      "insert into public.saas_checkout_fulfillment_outbox(checkout_session_id,profile_id,environment,recipient_email)values(c.id,c.profile_id,c.environment,pg_catalog.lower(c.email))on conflict(checkout_session_id)do nothing",
    ],
  ],
  [
    "outbox claim excludes accepted and ambiguous sends",
    saasFunction("claim_due_saas_checkout_fulfillment"),
    [
      "set state='delivery_unknown'",
      "where o.environment=p_environment and o.state='processing'and o.provider_dispatch_started_at is not null and(o.lease_expires_at is null or o.lease_expires_at<=pg_catalog.clock_timestamp())",
      "where o.environment=p_environment and(o.state in('pending','retry_wait')or(o.state='processing'and o.provider_dispatch_started_at is null))and o.provider_attempts<8",
      "for update skip locked limit p_limit",
      "fencing_token=o.fencing_token+1",
    ],
  ],
  [
    "outbox dispatch fence",
    saasFunction("begin_saas_checkout_fulfillment_dispatch"),
    [
      "provider_dispatch_started_at=pg_catalog.clock_timestamp()",
      fulfillmentFence +
        "and provider_dispatch_started_at is null and provider_attempts<8;return found",
    ],
  ],
  [
    "outbox settlement fence",
    saasFunction("complete_saas_checkout_fulfillment"),
    [
      "state=case when p_succeeded then'accepted'",
      fulfillmentFence + "and provider_dispatch_started_at is not null;return found",
    ],
  ],
  [
    "OTP worker fenced dispatch and settlement",
    otpWorker,
    [
      '.rpc("claim_due_saas_checkout_fulfillment", {',
      "p_environment: billingEnvironment()",
      '"renew_saas_checkout_fulfillment",',
      "p_fencing_token: row.fencing_token",
      "if (renewalError || renewed !== true) throw",
      '"begin_saas_checkout_fulfillment_dispatch",',
      "p_fencing_token: row.fencing_token",
      "if (dispatchError || dispatchStarted !== true)",
      "await createSupabaseAuthClient(authDispatch).auth.signInWithOtp({",
      '"mark_saas_checkout_fulfillment_delivery_unknown",',
      '"complete_saas_checkout_fulfillment",',
      "p_fencing_token: row.fencing_token",
      "if (completionError || completed !== true)",
    ],
  ],
  [
    "browser return only nudges fulfillment",
    checkoutReturn,
    [
      'if (checkout.status === "pending_payment")',
      'if (checkout.status === "pending_otp")',
      'await import("@/lib/checkout-otp-outbox-worker.server")',
      "await processCheckoutOtpOutbox(25)",
    ],
  ],
]) {
  let offset = 0;
  for (const fragment of fragments) {
    const position = source.indexOf(fragment, offset);
    if (position < 0) failures.push(`${name}: missing or out of order: ${fragment}`);
    else offset = position + fragment.length;
  }
}
for (const fragment of [
  "sendCheckoutOtp",
  "signInWithOtp",
  "finalize_paid_checkout",
  "apply_saas_provider_event",
]) {
  if (checkoutReturn.includes(fragment))
    failures.push(`browser return bypasses durable authority: ${fragment}`);
}
if (
  !saasAuthority.includes(
    "checkout_session_id uuid not null unique references public.checkout_sessions(id)on delete restrict",
  )
) {
  failures.push("checkout fulfillment must retain one durable outbox row per checkout");
}
if (!checkoutImplementation.includes("ensure_checkout_website")) {
  failures.push("checkout website bootstrap is not serialized");
}
if (checkoutImplementation.includes("latestOpenCheckout(")) {
  failures.push("legacy non-atomic open checkout lookup remains");
}
if (!checkoutImplementation.includes("saas-checkout:${opts.checkoutSessionId}")) {
  failures.push("Stripe checkout lacks a stable idempotency key");
}
if (checkoutImplementation.includes('payment_status !== "paid" &&')) {
  failures.push("Stripe completion still accepts an unpaid completed session");
}

if (/booking_services|availability_schedules/.test(entitlementMigration)) {
  failures.push("entitlement grant/backfill must not depend on shared booking configuration");
}
if (
  !checkoutImplementation.includes('supabaseAdmin.rpc(\n      "grant_verified_website_entitlement"')
) {
  failures.push("verifyOtp flow does not call the authoritative entitlement RPC");
}
if (checkoutImplementation.includes('.from("website_entitlements").upsert(')) {
  failures.push("verifyOtp flow still writes entitlements directly");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`OK: Bucket 1 booking foundation verifies (${requiredTables.length} tables)`);
