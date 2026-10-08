import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const migrationName = "20260829180000_harden_bucket1_claim_preflight.sql";
const sql = readFileSync(path.join(root, "supabase/migrations", migrationName), "utf8");
const suite = readFileSync(path.join(root, "supabase/tests/bucket1-generation.sql"), "utf8");

for (const marker of [
  "create or replace function public.add_video_stage_failure_count",
  "p_generation_contract_epoch is null",
  "public.add_video_stage_failure_count(candidate.payload_json)<3",
  "error_message=\'add_video_retry_state_invalid\'",
  "failure_attempts=failure_attempts+1",
  "where stale_job.job_type='enrichment_platform'",
  "create or replace function public.reconcile_generation_media_slot_epoch",
  "create or replace function public.terminalize_add_video_retry_state",
  "add_video_retry_budget_exhausted",
  "candidate.status in ('running','finalizing')",
  "coalesce(candidate.locked_at,candidate.started_at,candidate.created_at)<p_stale_before",
  "for update of parent_job skip locked",
  "for update of media_slot skip locked",
])
  assert.ok(sql.includes(marker), "missing claimant hardening invariant: " + marker);
assert.doesNotMatch(sql, /stageFailures[^\n]*::integer/);
assert.ok(
  sql.indexOf("for update of parent_job skip locked") <
    sql.indexOf("for update of media_slot skip locked"),
);
for (const marker of [
  "stale epoch-2 generation recovery, terminality, and replay",
  "provider uncertainty blocks a recovered generation",
  "NULL claimant capability fails before every preflight mutation",
  "malformed Add Video retry ledgers are quarantined",
  "a late claimant failure rolls back recovery",
])
  assert.ok(suite.includes(marker), "missing executable regression marker: " + marker);
console.log("claim-preflight-hardening: forward-only invariants verified");
