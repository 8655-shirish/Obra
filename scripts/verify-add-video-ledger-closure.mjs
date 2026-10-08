import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260828123000_bucket1_add_video_media_closure.sql",
    import.meta.url,
  ),
  "utf8",
)
  .replace(/\s+/g, " ")
  .toLowerCase();

for (const routine of [
  "reserve_add_video_media_create",
  "record_add_video_media_operation",
  "settle_add_video_media_slot",
  "record_ready_add_video_media",
]) {
  assert.ok(sql.includes("function public." + routine + "("), "missing " + routine);
}
for (const invariant of [
  "job.job_type<>'add_video'",
  "job.status<>'running'",
  "job.attempts<>p_job_attempts",
  "provider_create_count>=2",
  "pg_advisory_xact_lock",
  "status in ('generating','reconciliation_required')",
  "provider_reservation_id=p_reservation_id",
  "effect_certainty in ('indeterminate','definite_success') then 'reconciliation_required'",
  "effect_certainty='definite_success'",
])
  assert.ok(sql.includes(invariant), "missing Add Video ledger invariant: " + invariant);
assert.ok(!sql.includes("job.job_type='site_generation'"));
console.log("verify-add-video-ledger-closure: ok");
