import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/jobs.functions.ts", "utf8");
const readinessServer = readFileSync("src/lib/booking-readiness.server.ts", "utf8");
const bootstrap = source.slice(
  source.indexOf("export const getWorkspaceBootstrap"),
  source.indexOf("export const getJobProgress"),
);

for (const relation of ["website_entitlements", "leads", "appointments"]) {
  const start = bootstrap.indexOf(`.from("${relation}")`);
  assert.ok(start >= 0, `workspace bootstrap must query ${relation}`);
  const query = bootstrap.slice(start, bootstrap.indexOf(")", start + 120) + 450);
  assert.ok(
    query.includes('.eq("website_id", websiteId)'),
    `${relation} projection must be bound to selected website`,
  );
}
assert.ok(
  bootstrap.includes("canOpenPayments: readiness.paymentDashboardAvailable"),
  "payment dashboard visibility must use its canonical reconciled-account projection",
);
assert.ok(readinessServer.includes("paymentDashboardAvailable: Boolean("));
assert.ok(
  readinessServer.includes("payments.data?.stripe_account_id && payments.data.details_submitted"),
  "dashboard access must retain its account and completed-onboarding prerequisites",
);
assert.ok(
  readinessServer.includes("const paymentsReady ="),
  "strict payment readiness must remain the separate booking-admission authority",
);
console.log("verify-workspace-payment-overlap: selected-site and readiness authorities preserved");
