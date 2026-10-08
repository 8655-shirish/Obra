import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260829150000_remove_bucket1_generation_input_size_limits.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

for (const constraint of [
  "background_jobs_generation_input_snapshot_check",
  "background_jobs_generation_checkpoint_check",
  "background_jobs_generation_identity_check",
]) {
  assert.match(sql, new RegExp("drop constraint if exists " + constraint));
  assert.match(sql, new RegExp("add constraint " + constraint));
}
for (const functionName of [
  "enqueue_site_generation_job",
  "yield_site_generation_stage_epoch",
  "settle_site_generation_epoch",
]) {
  assert.match(sql, new RegExp("create or replace function public\\." + functionName + "\\("));
}
assert.doesNotMatch(sql, /524288|2097152|512 KiB|2 MiB|instruction exceeds/i);
assert.match(
  sql,
  /generation_input_hash = encode\(extensions\.digest\(convert_to\(generation_input_snapshot::text, 'UTF8'\), 'sha256'\), 'hex'\)/,
);
assert.match(sql, /'inputSizeBytes',octet_length\(convert_to\(frozen_input::text, 'UTF8'\)\)/);
assert.match(sql, /p_checkpoint->'input' is distinct from current_job\.generation_input_snapshot/g);
assert.match(
  sql,
  /p_checkpoint->>'inputHash' is distinct from current_job\.generation_input_hash/g,
);
assert.match(sql, /p_checkpoint->>'acceptedAt'/g);
assert.match(sql, /generation_request_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(
  sql,
  /generation_input_snapshot->>'requestPayloadHash' is not distinct from generation_request_hash/,
);
assert.match(
  sql,
  /jsonb_typeof\(generation_checkpoint->'inputSizeBytes'\) is not distinct from 'number'/,
);
assert.match(sql, /p_checkpoint->>'inputSizeBytes' !~ '\^\\d\+\$'/g);
assert.match(sql, /9007199254740991/g);
assert.match(sql, /generation_tenant_id is not null/);
assert.match(sql, /trace.profile_id is distinct from generation_tenant_id/);
assert.match(sql, /generation_request_hash, generation_tenant_id,/);
assert.match(sql, /new.generation_tenant_id is distinct from old.generation_tenant_id/);
assert.match(sql, /Site generation payload is malformed/);
assert.match(sql, /Site generation source snapshot does not match agent turn/);
assert.match(sql, /Regeneration source snapshot does not match/);
assert.match(sql, /Agent turn is not active for a new generation request/);
assert.match(sql, /A site generation job is already active for this website/);
assert.match(sql, /insert into public\.background_jobs/);
assert.match(sql, /generation_contract_epoch, generation_contract_version/);
assert.match(sql, /generation_input_snapshot,/);
assert.match(
  sql,
  /generation_input_hash, generation_accepted_at, generation_checkpoint, agent_trace_id/,
);
assert.doesNotMatch(sql, /grant execute on function public\.enqueue_site_generation_job\(/);
assert.match(
  sql,
  /revoke all on function public\.enqueue_site_generation_job\(uuid,text,jsonb,boolean\)[\s\S]*from public, anon, authenticated, service_role/,
);
assert.match(
  sql,
  /grant execute on function public\.yield_site_generation_stage_epoch[\s\S]*to service_role/,
);
assert.match(
  sql,
  /grant execute on function public\.settle_site_generation_epoch[\s\S]*to service_role/,
);

const addVideo = fs.readFileSync(
  path.join(root, "supabase/migrations/20260828173000_bucket1_staged_add_video.sql"),
  "utf8",
);
assert.match(addVideo, /pg_column_size\(next_payload\)>2097152/);

console.log("verify-bucket1-unbounded-input: ok");
