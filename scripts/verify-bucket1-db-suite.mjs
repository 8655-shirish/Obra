import assert from "node:assert/strict";
import fs from "node:fs";
const file = "supabase/tests/bucket1-foundation.sql";
const sql = fs.readFileSync(file, "utf8");
assert.ok(sql.startsWith("\\set ON_ERROR_STOP on"));
assert.ok(sql.includes("begin;"));
assert.ok(sql.includes("rollback;"));
for (const behavior of [
  "checkout transition",
  "payment transition",
  "atomic outbox",
  "idempotent replay",
  "cross tenant transition allowed",
  "stale revision transition allowed",
  "provider lease fence",
  "provider failure checkpoint",
  "unapproved retention purge allowed",
  "private attachment bucket",
  "retention fail closed",
  "stale inbox fence",
  "expired checkout/payment",
  "cancellation create race",
  "durable SaaS ingress markers",
  "attachment key uniqueness/path and exact composition",
  "atomic outbox apply",
  "late payment recover/refund",
  "custom overrides",
  "overnight rejection",
  "purge attribution",
  "legacy snapshots",
  "provider freshness/shared readiness",
  "offboarding retention",
  "scanner fences",
  "type fidelity",
])
  assert.ok(sql.includes(behavior), "missing executable DB assertion: " + behavior);
console.log(
  "verify-bucket1-db-suite: executable SQL suite present (runtime requires DATABASE_URL)",
);
