import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/20260829093906_stripe_connect_express_onboarding.sql",
  "utf8",
);
const server = fs.readFileSync("src/lib/stripe-connect.server.ts", "utf8");
const functions = fs.readFileSync("src/lib/stripe-connect.functions.ts", "utf8");
const authServer = fs.readFileSync("src/lib/provider-authorization.server.ts", "utf8");
const auth = fs.readFileSync("src/lib/provider-authorization.ts", "utf8");
const route = fs.readFileSync("src/components/purchaser/SetupStepCards.tsx", "utf8");
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
  "reject_stripe_connected_account_rebind",
  "grant execute on function public.bind_stripe_connect_account(uuid,text,text,text) to service_role",
]);
requireAll("provider authority", server, [
  "getStripeConnectEnvironment",
  "stripeEnvironment = billingEnvironment()",
  "stripeEnvironment === workspaceEnvironment",
  "if (environmentError) throw new Error(environmentError)",
  'type: "express"',
  'country: "US"',
  "idempotencyKey",
  "accounts.retrieve",
  "accounts.list",
  "Multiple Stripe accounts need operator reconciliation",
  "accountLinks.create",
  "accounts.createLoginLink",
  "apply_stripe_connect_account_projection",
]);
requireAll("authorization", functions + authServer + auth, [
  "assertWebsiteWorkspaceAccess",
  'access.mode !== "contractor"',
  "getContractorAuthUserId",
  "contractorConnectMutationContext",
  "requireCurrentActiveConfirmedPro",
  'entitlement.plan !== "pro"',
  "order_confirmed_at",
  "assertStripeEnvironment(context.website.environment",
  "canOnboard: hasPro && environment.environmentError === null",
]);
requireAll("truthful return", route, [
  "reconcileStripeConnect",
  'connect === "return"',
  "Return markers are hints only",
  "My Payments",
  "Customer charging is not enabled",
  "status.environmentError === null",
  "Stripe setup unavailable",
]);
for (const forbidden of ["application_fee_amount", "transfer_data", "destination:"]) {
  if (server.includes(forbidden)) failures.push("premature money movement: " + forbidden);
}
if (failures.length) {
  console.error("Bucket 2 Stripe Connect verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("verify-bucket2-stripe-connect: Express onboarding boundary present");
