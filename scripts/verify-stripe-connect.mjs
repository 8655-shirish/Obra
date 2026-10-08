import fs from "node:fs";
const migration = fs.readFileSync(
  "supabase/migrations/20260829093906_stripe_connect_express_onboarding.sql",
  "utf8",
);
const server = fs.readFileSync("src/lib/stripe-connect.server.ts", "utf8");
const commands = fs.readFileSync("src/lib/stripe-connect.functions.ts", "utf8");
const auth = fs.readFileSync("src/lib/provider-authorization.server.ts", "utf8");
const route = fs.readFileSync("src/components/purchaser/SetupStepCards.tsx", "utf8");
const env = fs.readFileSync(".env.example", "utf8");
const failures = [];
const requireAll = (name, source, fragments) => {
  for (const fragment of fragments)
    if (!source.includes(fragment)) failures.push(name + ": " + fragment);
};
requireAll("frozen model", migration, [
  "account_type = 'express'",
  "country = 'US'",
  "charge_model = 'direct'",
  "application_fee_bps = 0",
]);
requireAll("tenant command", migration, [
  "p_website_id uuid",
  "p.auth_user_id=p_auth_user_id",
  "w.environment=p_environment",
  "pg_advisory_xact_lock",
  "service_role",
]);
requireAll("write-once account", migration, [
  "stripe connected account identity is immutable",
  "Stripe Connect identity conflict",
]);
requireAll("server-only provider", server, [
  'type: "express"',
  'country: "US"',
  'type: "account_onboarding"',
  "idempotencyKey",
  "accounts.createLoginLink",
  "billingEnvironment()",
]);
for (const forbidden of [
  "paymentIntents.create",
  "checkout.sessions.create",
  "application_fee_amount",
  "application_fee_percent",
])
  if (server.includes(forbidden)) failures.push("Bucket 3 primitive present: " + forbidden);
requireAll("contractor authorization", commands + auth, [
  "getContractorAuthUserId",
  'access.mode !== "contractor"',
  '.eq("user_id", profile.id)',
  "contractorConnectMutationContext",
]);
requireAll("redirect not authority", route, [
  'connect === "return"',
  "reconcileStripeConnect",
  "Continue in Stripe",
  "My Payments",
  "Customer charging is not enabled",
]);
requireAll("secret inventory", env, [
  "STRIPE_SECRET_KEY=",
  "STRIPE_CONNECT_WEBHOOK_SECRET=",
]);
if (failures.length) {
  console.error("Stripe Connect verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("verify-stripe-connect: Express onboarding boundary present; Bucket 3 absent");
