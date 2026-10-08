import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sql = fs.readFileSync(path.join(root, "supabase/migrations/20260823210000_add_video_observability.sql"), "utf8");
const types = fs.readFileSync(path.join(root, "src/integrations/supabase/types.ts"), "utf8");

assert.match(sql, /create table public\.add_video_observability_events/);
assert.match(sql, /create table public\.add_video_observability_runs/);
for (const alert of [
  "repeated_terminal_operation_reuse",
  "provider_operation_budget_exceeded",
  "completed_job_attachment_mismatch",
  "attached_video_without_completed_job",
  "revision_conflict",
  "rpc_incompatibility",
]) assert.match(sql, new RegExp(alert));
assert.match(sql, /retired_provider_operation_ids \? s\.provider_operation_id/);
assert.match(sql, /provider_creates>2/);
assert.match(sql, /j\.status='completed' and r\.matching_attachments<>1/);
assert.match(sql, /j\.status<>'completed' and r\.version_video_attachments>0/);
assert.match(sql, /'24h'.*interval '24 hours'.*'7d'.*interval '7 days'/s);
assert.match(sql, /'completionRate'/);
assert.match(sql, /'revisionConflictRate'/);
assert.match(sql, /percentile_cont\(0\.95\)/);
assert.match(sql, /'meanProviderCreatesPerSuccess'/);
assert.match(sql, /'oldestEligibleAgeSeconds'/);
assert.match(sql, /create or replace function public\.run_add_video_observability_check\(p_dry_run boolean default true/);
assert.match(sql, /if not p_dry_run then insert into public\.add_video_observability_runs/);
assert.doesNotMatch(sql, /cron\.|pg_cron|schedule\(/i);
for (const fn of ["record_add_video_observability_event", "get_add_video_observability_report", "run_add_video_observability_check"]) {
  assert.match(sql, new RegExp("revoke all on function public\\." + fn + "[\\s\\S]*from public, anon, authenticated"));
  assert.match(sql, new RegExp("grant execute on function public\\." + fn + "[\\s\\S]*to service_role"));
}
assert.match(sql, /alter table public\.add_video_observability_events enable row level security/);
assert.match(sql, /revoke all on table public\.add_video_observability_events from public, anon, authenticated/);
assert.doesNotMatch(sql, /grant (all|select|insert).*add_video_observability_events.*(anon|authenticated)/i);
assert.match(sql, /pg_column_size\(p_details\) > 8192/);
assert.match(types, /get_add_video_observability_report: \{[\s\S]*Returns: Json/);
assert.match(types, /run_add_video_observability_check: \{[\s\S]*p_dry_run\?: boolean[\s\S]*Returns: Json/);
assert.match(types, /add_video_observability_events: \{[\s\S]*event_type: string/);
console.log("verify-add-video-observability: ok");
