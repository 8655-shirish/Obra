import fs from "node:fs";

const bootstrap = fs.readFileSync("src/lib/jobs.functions.ts", "utf8");
const readiness = fs.readFileSync("src/lib/booking-readiness.ts", "utf8");
const readinessServer = fs.readFileSync("src/lib/booking-readiness.server.ts", "utf8");
const setup = fs.readFileSync("src/components/purchaser/SetupStepCards.tsx", "utf8");
const failures = [];
const requireAll = (name, source, fragments) => {
  for (const fragment of fragments)
    if (!source.includes(fragment)) failures.push(name + ": " + fragment);
};
requireAll("authoritative bootstrap", bootstrap, [
  "loadBookingReadinessFacts",
  "bookingManagement:",
  "appointmentCountResult",
  "canOpenPayments: readiness.paymentDashboardAvailable",
  'access.mode === "contractor"',
]);
requireAll("canonical payment readiness", readinessServer, [
  'from("stripe_connected_accounts")',
  "charges_enabled",
  "payouts_enabled",
  "details_submitted",
  'capabilities.card_payments === "active"',
  "paymentSnapshotFresh",
  "paymentDashboardAvailable: Boolean(",
  "payments.data?.stripe_account_id && payments.data.details_submitted",
]);
requireAll("purchaser payments", setup, [
  "openStripeExpressDashboard",
  "My Payments",
]);
requireAll("resumable projection", readiness, [
  "firstIncompleteLabel",
  "Repair Google Calendar",
  "Repair Stripe payments",
  "nextPath",
]);
requireAll("repeat Pro summary", setup, [
  "Business-wide setup:",
  "shared settings are reused for this Pro website",
]);
if (failures.length) {
  console.error("Bucket 2 workspace integration verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("verify-bucket2-workspace: authoritative cross-cutting workspace integration present");
