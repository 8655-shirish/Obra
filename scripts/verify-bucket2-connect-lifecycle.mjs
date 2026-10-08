import fs from "node:fs";

const files = {
  migration: fs.readFileSync(
    "supabase/migrations/20260829093907_stripe_connect_lifecycle.sql",
    "utf8",
  ),
  webhook: fs.readFileSync("src/routes/api/stripe/connect-webhook.ts", "utf8"),
  worker: fs.readFileSync("src/lib/stripe-connect-inbox-worker.server.ts", "utf8"),
  server: fs.readFileSync("src/lib/stripe-connect.server.ts", "utf8"),
  cron: fs.readFileSync("src/routes/api/cron/stripe-inbox.ts", "utf8"),
  auth: fs.readFileSync("src/lib/stripe-connect.functions.ts", "utf8"),
  route: fs.readFileSync("src/components/purchaser/SetupStepCards.tsx", "utf8"),
};
const failures = [];
const requires = (file, fragments) =>
  fragments.forEach((fragment) => {
    if (!files[file].includes(fragment)) failures.push(file + ": " + fragment);
  });
requires("webhook", [
  "STRIPE_CONNECT_WEBHOOK_SECRET",
  "request.text()",
  "constructStripeWebhookEvent",
  'event.type !== "account.updated"',
  "billingEnvironment() !== environment",
  "resolve_stripe_connect_account",
  'p_event_family: event.type === "account.updated" ? "connect" : "booking"',
]);
requires("migration", [
  "stripe_connected_accounts_account_environment_uidx",
  "apply_stripe_connect_inbox_projection",
  "processing_state='processing'",
  "lease_token=p_lease_token",
  "fencing_token=p_fencing_token",
  "lease_expires_at>pg_catalog.clock_timestamp()",
  "a.environment=p_environment",
  "interval '10 minutes'",
  "reconciliation_generation",
  "claim_due_stripe_connect_accounts",
  "reconciliation_lease_expires_at",
  "for update skip locked",
  "release_stripe_connect_reconciliation_claim",
]);
requires("worker", [
  "claim_provider_event",
  "reconcileStripeConnectInboxEvent",
  "complete_provider_event",
  "reconcileDueStripeConnectAccounts",
  '.eq("environment", environment)',
  "p_environment: environment",
  "p_lease_token: leaseToken",
  "release_stripe_connect_reconciliation_claim",
]);
requires("server", [
  "accounts.retrieve",
  "begin_stripe_connect_reconciliation",
  "apply_stripe_connect_inbox_projection",
]);
requires("cron", ["processStripeConnectInbox", "reconcileDueStripeConnectAccounts"]);
requires("auth", ["contractorConnectOwnerContext", "contractorConnectMutationContext"]);
requires("route", [
  "status?.connected",
  "creationEligible",
  "status?.connected || creationEligible",
]);
for (const file of Object.values(files))
  for (const forbidden of [
    "paymentIntents.create",
    "checkout.sessions.create",
    "application_fee_amount",
    "transfer_data",
  ])
    if (file.includes(forbidden)) failures.push("Bucket 3 charging: " + forbidden);
if (failures.length) {
  console.error("Bucket 2 Connect lifecycle verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("verify-bucket2-connect-lifecycle: durable lifecycle boundary present");
