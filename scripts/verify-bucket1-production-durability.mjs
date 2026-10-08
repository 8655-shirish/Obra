import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260828121000_bucket1_production_durability_hardening.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const publishMigrationPath = path.join(
  root,
  "supabase/migrations/20260828171000_bucket1_transactional_publish_attestation.sql",
);
const publishSql = readFileSync(publishMigrationPath, "utf8");
const compact = sql.replace(/\s+/g, " ").toLowerCase();

for (const required of [
  "stage_attempt_counts jsonb",
  "generation_terminal_message_payload jsonb",
  "claim_epoch bigint",
  "drop_stale_settle_overloads",
  "p_budget_type text",
  "schema-v4 persistence requires the current valid deterministic attestation",
  "generation_stage<>'persistence'".replaceAll("'", "'"),
  "generation_contract_epoch<>2",
  "p_config_json->>'generatorschemaversion' is distinct from '4'".replaceAll("'", "'"),
  "candidatebindinghash",
  "manifesthash",
  "operationalplanhash",
  "hostcontracthash",
  "validationcontracthash",
  "agent_traces set status='completed'".replaceAll("'", "'"),
  "generation_terminal_message_id=claimed_job.generation_handoff_message_id",
  "validation' and requested_stage='composition'".replaceAll("'", "'"),
  "create or replace function public.plan_generation_media_slots_epoch",
  "create or replace function public.claim_generation_media_slot_epoch",
  "create or replace function public.reserve_generation_media_create_epoch",
  "create or replace function public.record_generation_media_operation_epoch",
  "create or replace function public.settle_generation_media_slot_epoch",
  "create or replace function public.record_generation_media_slot_epoch",
  "current generation media requires claim_epoch authority",
  "operationalintent,operationalanchors",
]) {
  assert.ok(compact.includes(required), "missing Bucket 1 durability anchor: " + required);
}

assert.doesNotMatch(sql, /attempts\s*=\s*p_claim_epoch/i);
assert.doesNotMatch(sql, /generatorSchemaVersion'\s+not in\s*\([^)]*'2'/i);
assert.doesNotMatch(sql, /sectionTopology/);
assert.match(sql, /agent_traces set status='error'/);
assert.doesNotMatch(sql, /agent_traces set status='failed'/);

for (const required of [
  "'superseded'",
  "create or replace function public.supersede_site_generation_epoch",
  "p_website_id uuid",
  "p_job_id uuid",
  "p_request_id uuid",
  "p_claim_epoch bigint",
  "p_actor text",
  "p_reason text",
  "pg_advisory_xact_lock(hashtextextended(p_website_id::text || ':site_generation',0))",
  "where id = p_job_id",
  "for update",
  "status in ('pending','running','finalizing')",
  "generation_terminal_message_id = current_job.generation_handoff_message_id",
  "generation_terminal_message_payload = terminal_payload",
  "result_json = terminal_result",
  "update public.messages",
  "update public.agent_traces",
  "update public.site_generation_media_slots",
  "insert into public.site_generation_attempt_events",
  "if current_job.status = 'superseded'",
  "event.details->>'actor' = normalized_actor",
  "event.details->>'reason' = normalized_reason",
  "running external operation prevents safe generation supersession",
  "revoke all on function public.supersede_site_generation_epoch(uuid,uuid,uuid,bigint,text,text)",
  "grant execute on function public.supersede_site_generation_epoch(uuid,uuid,uuid,bigint,text,text)",
  "to service_role",
]) {
  assert.ok(compact.includes(required), "missing administrative supersession anchor: " + required);
}
assert.match(
  compact,
  /grant execute on function public\.supersede_site_generation_epoch\(uuid,uuid,uuid,bigint,text,text\) to service_role/,
);
assert.doesNotMatch(
  compact,
  /grant execute on function public\.supersede_site_generation_epoch\(uuid,uuid,uuid,bigint,text,text\) to (?:public|anon|authenticated)/,
);

const finalizer = sql.slice(
  sql.indexOf("create or replace function public.insert_generated_website_version_with_slots"),
);
for (const atomicWrite of [
  "insert into public.website_versions",
  "insert into public.website_version_media_slots",
  "update public.site_generation_media_slots",
  "update public.messages",
  "update public.agent_traces",
  "update public.background_jobs",
]) {
  assert.ok(
    finalizer.toLowerCase().includes(atomicWrite),
    "atomic finalizer missing " + atomicWrite,
  );
}

const publishCompact = publishSql.replace(/\s+/g, " ").toLowerCase();
for (const required of [
  "create or replace function public.bucket1_assert_schema_v4_publish_attestation",
  "create function public.publish_website_version_atomic",
  "create function public.publish_website_version_owned",
  "for update",
  "vault.decrypted_secrets",
  "extensions.hmac",
  "public.bucket1_canonical_hash(attestation_payload)",
  "expires_at <= verified_at",
  "expires_at > issued_at + interval '24 hours'",
  "target.config_json,target.revision,target.generation_job_id,p_validation_attestation",
  "public.assert_agent_turn_owned(p_website_id,p_trace_id,p_owner_token)",
  "drop function if exists public.publish_website_version_atomic(uuid,uuid,bigint,jsonb,jsonb)",
  "drop function if exists public.publish_website_version_owned(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb)",
]) {
  assert.ok(publishCompact.includes(required), "missing transactional publish anchor: " + required);
}
assert.match(
  publishCompact,
  /grant execute on function public\.publish_website_version_atomic\(uuid,uuid,bigint,jsonb,jsonb,jsonb\)\s+to service_role/,
);
assert.match(
  publishCompact,
  /grant execute on function public\.publish_website_version_owned\(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb\)\s+to service_role/,
);

const epochApiCount = (sql.match(/create or replace function public\.[a-z_]+_epoch\(/g) ?? [])
  .length;
assert.ok(epochApiCount >= 8, "expected settlement, yield, and six epoch-native media APIs");

console.log("Bucket 1 production durability migration static verifier passed.");
