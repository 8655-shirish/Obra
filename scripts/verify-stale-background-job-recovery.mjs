import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260829170000_fix_stale_background_job_recovery.sql"),
  "utf8",
);
const dbSuite = fs.readFileSync(path.join(root, "supabase/tests/bucket1-generation.sql"), "utf8");

const functionBody = migration.slice(
  migration.indexOf("create or replace function public.recover_stale_background_jobs("),
  migration.indexOf("revoke all on function public.recover_stale_background_jobs"),
);
assert.ok(functionBody.length > 0, "repair must replace the deployed recovery function");
assert.match(functionBody, /declare stale_generation_job public\.background_jobs%rowtype/);
assert.match(functionBody, /from stale_non_generation as stale_job/);
assert.match(functionBody, /where recovered_job\.id=stale_job\.id/);
assert.doesNotMatch(functionBody, /declare stale public\.background_jobs%rowtype/);
assert.doesNotMatch(functionBody, /from stale_non_generation stale(?:\s|$)/);
assert.doesNotMatch(functionBody, /\bstale\.id\b/);

for (const required of [
  "for update of generation_job skip locked",
  "for update of stale_job skip locked",
  "apply_site_generation_interruption",
  "scheduler_last_run_id=p_scheduler_run_id",
  "resume_enrichment_finalization",
  "job_type in ('enrichment_platform','add_video')",
  "status='finalizing'",
  "attempts>=recovered_job.max_attempts",
  "reconciliation_count := reconciliation_count + unresolved_count",
]) {
  assert.ok(functionBody.includes(required), "missing recovery invariant: " + required);
}

for (const marker of [
  "stale non-generation recovery does not block claims",
  "b8000000-0000-0000-0000-000000000001",
  "b8000000-0000-0000-0000-000000000002",
  "b8000000-0000-0000-0000-000000000003",
  "from public.recover_stale_background_jobs(",
]) {
  assert.ok(dbSuite.includes(marker), "missing stale recovery DB assertion: " + marker);
}

console.log("stale-background-job-recovery: repair invariants verified");
