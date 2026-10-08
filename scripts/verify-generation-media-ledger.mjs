import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(
  path.join(here, "../supabase/migrations/20260822100000_fenced_site_generation_media_slots.sql"),
  "utf8",
);
for (const required of [
  "asset_id text",
  "on delete restrict",
  "website_version_media_slots",
  "fork_website_version_with_media",
  "p_expected_config_json",
  "Website version changed after validation",
  "p_expected_media_slots",
  "Website media attachments changed after validation",
  "drop policy if exists site_media_delete_own",
  "enqueue_site_generation_job",
  "pg_advisory_xact_lock",
  "plan_generation_media_slot",
  "claim_generation_media_slot",
  "record_generation_media_operation",
  "provider_operation_id = p_provider_operation_id",
  "settle_generation_media_slot",
  "site_generation_media_slots_ready_material_check",
  "claimed_job.job_type <> 'site_generation'",
  "status in ('planned', 'generating', 'ready', 'failed', 'abandoned', 'attached')",
  "site_generation_media_slots.status in ('planned', 'failed')",
  "and claim_attempt = p_job_attempts",
  "Persisted media slot does not match the accepted plan",
  "insert_generated_website_version_with_slots",
  "update public.site_generation_media_slots set",
  "or claimed_job.status <> 'running'",
  "Generation job is no longer active",
  "Media slot claim was lost before ready",
  "status = 'attached', version_id = new_version_id",
  "Media slots are missing, stale, or not ready",
  "Unified config is missing its validated brief or complete media manifest",
  "Resolved media manifest does not match the ready slot ledger",
])
  assert.ok(sql.includes(required), "missing migration invariant: " + required);
const ledgerSource = fs.readFileSync(
  path.join(here, "../src/lib/media/generation-media-slots.server.ts"),
  "utf8",
);
assert.match(
  ledgerSource,
  /isOwnedSiteMediaPath\(options\.websiteId, options\.item\.storagePath\)/,
);
assert.match(ledgerSource, /isOwnedSiteMediaPath\(options\.websiteId, slot\.storagePath\)/);
assert.match(ledgerSource, /has an invalid storage path/);
assert.match(
  ledgerSource,
  /\| \{ id: string; attempts: number; claimEpoch: number; runnerId: string \}/,
);
assert.match(ledgerSource, /claimEpoch !== undefined/);
assert.match(ledgerSource, /p_job_attempts: options\.jobClaim\.attempts/);
for (const legacyRpc of [
  "plan_generation_media_slot",
  "claim_generation_media_slot",
  "reserve_generation_media_create",
  "record_generation_media_operation",
  "settle_generation_media_slot",
  "record_generation_media_slot",
]) {
  assert.ok(
    ledgerSource.includes(`"${legacyRpc}"`),
    "missing isolated legacy media RPC: " + legacyRpc,
  );
}
for (const rpc of [
  "plan_generation_media_slots_epoch",
  "claim_generation_media_slot_epoch",
  "reserve_generation_media_create_epoch",
  "record_generation_media_operation_epoch",
  "settle_generation_media_slot_epoch",
  "record_generation_media_slot_epoch",
]) {
  assert.ok(ledgerSource.includes(`"${rpc}"`), "missing epoch media RPC: " + rpc);
}
assert.match(ledgerSource, /p_claim_epoch: claimEpoch/);
assert.match(ledgerSource, /p_effect_certainty/);
assert.doesNotMatch(ledgerSource, /epochMediaRpc|EpochMediaRpcContract/);
console.log("verify-generation-media-ledger: ok");
