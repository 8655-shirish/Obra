import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260829160000_fix_bucket1_regeneration_admission.sql"),
  "utf8",
);
const freezeMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260830210000_freeze_contact_hidden_boolean.sql"),
  "utf8",
);
const instructionMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260831010000_freeze_generation_instruction_empty.sql"),
  "utf8",
);
const dbSuite = fs.readFileSync(path.join(root, "supabase/tests/bucket1-generation.sql"), "utf8");
const enqueue = fs.readFileSync(path.join(root, "src/lib/jobs/enqueue.server.ts"), "utf8");

assert.match(
  migration,
  /from public\.website_version_media_slots slot[\s\S]*order by slot\.slot_id[\s\S]*for share;/,
);
assert.doesNotMatch(
  migration,
  /from public\.website_version_media_slots slot[\s\S]{0,200}order by slot\.id/,
);
assert.match(
  freezeMigration,
  /from public\.website_version_media_slots slot[\s\S]*order by slot\.slot_id[\s\S]*for share;/,
);
assert.doesNotMatch(
  freezeMigration,
  /from public\.website_version_media_slots slot[\s\S]{0,200}order by slot\.id/,
);
assert.match(
  freezeMigration,
  /'contactHidden', coalesce\(\(onboarding_input->'contactHidden'\) = 'true'::jsonb, false\)/,
);
assert.doesNotMatch(
  freezeMigration,
  /'contactHidden', onboarding_input->'contactHidden' = 'true'::jsonb/,
);
assert.match(instructionMigration, /'instruction', ''/);
assert.match(instructionMigration, /'instructionByteLength', 0/);
assert.doesNotMatch(instructionMigration, /'instruction', coalesce\(trace\.trigger_message/);
assert.match(
  instructionMigration,
  /'contactHidden', coalesce\(\(onboarding_input->'contactHidden'\) = 'true'::jsonb, false\)/,
);
const ownedWrapper = migration.slice(
  migration.indexOf("create or replace function public.enqueue_site_generation_job_owned("),
  migration.indexOf("revoke all on function public.enqueue_site_generation_job_owned"),
);
assert.match(
  ownedWrapper,
  /select job\.\* into strict generation_job[\s\S]*job\.chain_id = returned_chain_id/,
);
for (const unqualified of [
  /from public\.agent_traces\s+where/,
  /from public\.background_jobs\s+where/,
  /update public\.background_jobs\s+set/,
  /from public\.messages\s+where/,
  /where website_id =/,
  /and chain_id =/,
  /where id =/,
])
  assert.doesNotMatch(ownedWrapper, unqualified);

const supersessionWrapper = migration.slice(
  migration.indexOf(
    "create or replace function public.supersede_and_enqueue_site_generation_job_owned(",
  ),
  migration.indexOf(
    "revoke all on function public.supersede_and_enqueue_site_generation_job_owned",
  ),
);
assert.match(supersessionWrapper, /successor_job\.chain_id=accepted\.chain_id/);
assert.match(supersessionWrapper, /where predecessor_job\.id=p_predecessor_job_id/);
assert.match(supersessionWrapper, /where successor_job\.id=successor\.id/);
for (const unqualified of [
  /from public\.background_jobs\s+where/,
  /update public\.background_jobs\s+set/,
  /where website_id=/,
  /and chain_id=/,
  /where id=/,
])
  assert.doesNotMatch(supersessionWrapper, unqualified);
assert.match(migration, /drop trigger if exists guard_site_generation_frozen_input/);
assert.match(
  migration,
  /drop trigger if exists background_jobs_guard_site_generation_frozen_input/,
);
assert.equal(
  (migration.match(/create trigger background_jobs_guard_site_generation_frozen_input/g) ?? [])
    .length,
  1,
);
assert.match(
  migration,
  /revoke all on function public\.enqueue_site_generation_job\(uuid,text,jsonb,boolean\)[\s\S]*service_role/,
);
assert.match(
  migration,
  /grant execute on function public\.enqueue_site_generation_job_owned[\s\S]*to service_role/,
);

for (const marker of [
  "regeneration-source-media-admission",
  "bucket1_regeneration_admission",
  "bucket1_regeneration_replay",
  "frozen-input trigger topology did not converge",
  "generation_input_snapshot->'enrichment'='{\"evidenceMarker\":\"preserve-regeneration-source-media\"}'::jsonb",
  "generation_input_snapshot->'sourceMedia'='[",
  "mismatched regeneration source left a partial job or handoff",
  "Regeneration source snapshot does not match",
  "omitted contactHidden freezes as JSON false",
  "omitted contactHidden did not freeze contactPolicy.contactHidden as JSON false",
  "generation_input_snapshot->>'instruction'=''",
])
  assert.ok(dbSuite.includes(marker), "missing DB regression marker: " + marker);

assert.doesNotMatch(enqueue, /enqueueSiteGenerationChain|Unable to enqueue site generation job/);
assert.doesNotMatch(enqueue, /no fresh job-runner heartbeat|enqueue_site_generation_job_owned/);
assert.match(enqueue, /enqueueEnrichmentChain/);

console.log("bucket1-regeneration-admission: repair invariants verified");
