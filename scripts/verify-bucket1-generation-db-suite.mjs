import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sqlPath = path.join(root, "supabase/tests/bucket1-generation.sql");
const lifecycleSqlPath = path.join(root, "supabase/tests/bucket1-regeneration-lifecycle-audit.sql");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260829190000_bucket1_regeneration_lifecycle_audit.sql",
);
const persistMigrationPath = path.join(
  root,
  "supabase/migrations/20260830200000_persist_generation_without_chrome.sql",
);
const persistMigration = fs.readFileSync(persistMigrationPath, "utf8");
const runnerPath = path.join(root, "scripts/test-db-bucket1-generation.sh");
const packagePath = path.join(root, "package.json");
const sql = fs.readFileSync(sqlPath, "utf8");
const lifecycleSql = fs.readFileSync(lifecycleSqlPath, "utf8");
const lifecycleMigration = fs.readFileSync(migrationPath, "utf8");
const runner = fs.readFileSync(runnerPath, "utf8");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

assert.ok(sql.startsWith("\\set ON_ERROR_STOP on"), "SQL suite must stop on its first error");
assert.match(
  sql,
  /\bbegin;[\s\S]*\brollback;/i,
  "SQL suite must run inside a rollback transaction",
);
assert.match(
  sql,
  /extensions\.digest\(convert_to\(frozen_input::text, 'UTF8'\), 'sha256'\)/,
  "fixture input hash must derive from SQL jsonb::text bytes",
);
assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0, "SQL suite has unbalanced $$ quotes");
assert.doesNotMatch(sql, /\bas \$\s*$/m, "SQL suite has a single-dollar opening quote");
assert.doesNotMatch(sql, /^\s*end\$;\s*$/m, "SQL suite has a single-dollar closing quote");

const behaviorMarkers = [
  "oversized frozen input owned admission",
  "strict frozen checkpoint hash",
  "stale non-generation recovery does not block claims",
  "epoch-2 claim uniqueness",
  "healthy yields beyond old max attempts",
  "stale epoch yield rejection",
  "effect certainty, reconciliation, and supersession RPCs",
  "supersession exact replay",
  "cancellation exact scope",
  "cancellation terminal projection",
  "cancellation replay",
  "ready media preservation",
  "empty manifest preconditions",
  "empty manifest replay",
  "settlement repair budget terminality",
  "omitted contactHidden freezes as JSON false",
  "service grants and browser claim revocation",
];
for (const marker of behaviorMarkers) {
  const declaration = "-- assertion: " + marker;
  const markerOffset = sql.indexOf(declaration);
  assert.notEqual(markerOffset, -1, "missing meaningful assertion marker: " + marker);
  const nextMarker = sql.indexOf("-- assertion:", markerOffset + declaration.length);
  const assertionBlock = sql.slice(markerOffset, nextMarker === -1 ? sql.length : nextMarker);
  assert.match(
    assertionBlock,
    /pg_temp\.assert_true\s*\(/,
    "assertion marker has no executable assertion: " + marker,
  );
}

for (const fixtureTable of [
  "public.profiles",
  "public.websites",
  "public.conversations",
  "public.contractor_profiles",
  "public.agent_traces",
  "public.messages",
  "public.background_jobs",
]) {
  assert.ok(
    sql.includes("insert into " + fixtureTable),
    "missing self-contained fixture: " + fixtureTable,
  );
}

for (const rpc of [
  "claim_next_background_job",
  "recover_stale_background_jobs",
  "yield_site_generation_stage_epoch",
  "cancel_site_generation_request",
  "settle_site_generation_epoch",
  "plan_generation_media_slots_epoch",
  "claim_generation_media_slot_epoch",
  "reserve_generation_media_create_epoch",
  "record_generation_media_operation_epoch",
  "settle_generation_media_slot_epoch",
  "reconcile_generation_media_slot_epoch",
  "supersede_site_generation_epoch",
  "insert_generated_website_version_with_slots",
]) {
  assert.match(
    sql,
    new RegExp("public\\." + rpc + "\\s*\\("),
    "missing concrete RPC exercise: " + rpc,
  );
}

for (const required of [
  "maintain_background_job_lifecycle",
  "heartbeat_background_job_runner_capability",
  "complete_generation_media_cleanup",
  "close_add_video_terminal_children",
]) {
  assert.match(lifecycleSql, new RegExp("public\\." + required + "\\s*\\("));
  assert.ok(lifecycleMigration.includes("public." + required));
}
assert.match(lifecycleMigration, /before insert(?: or update[^\n]+)? on public\.background_jobs/);
assert.ok(
  lifecycleMigration.includes("no fresh browser-ready epoch-2 runner capability heartbeat"),
);
assert.ok(persistMigration.includes("no fresh job-runner heartbeat"));
assert.ok(persistMigration.includes("matching composed candidate"));
assert.match(
  persistMigration,
  /generation_stage='composition' and p_stage in \('validation','persistence'\)/,
);
assert.match(
  persistMigration,
  /generation_stage='validation' and p_stage='persistence'/,
);
assert.match(
  persistMigration,
  /p_expected_stage='composition\/build' and p_next_stage in \('composition\/build','validation\/run','persistence\/commit'\)/,
);
assert.ok(persistMigration.includes("return false;"));
assert.doesNotMatch(
  persistMigration,
  /No compatible execution target may strand/,
  "the Chrome five-minute killer must not remain on the product path",
);
assert.doesNotMatch(sql, /Bucket1 attestation Vault preconditions/);
assert.ok(sql.includes("schema-v4 publish without a Chrome QA stamp did not succeed"));
assert.ok(lifecycleSql.includes("browser-false heartbeat did not permit epoch-2 admission"));
assert.ok(lifecycleSql.includes("maintenance terminalized a still-runnable pending epoch-2 row"));
assert.match(
  persistMigration,
  /'chat','onboarding_submitted','admin_auto_kickoff','regenerate_variants','publishToLp','generate_initial'/,
);
assert.ok(lifecycleMigration.includes("'{\"dryRun\":false}'::jsonb"));
assert.match(runner, /DATABASE_URL:\?Set DATABASE_URL/, "runner must require DATABASE_URL");
assert.match(runner, /psql[\s\S]*bucket1-generation\.sql/, "runner must execute this SQL suite");
assert.match(
  runner,
  /psql[\s\S]*bucket1-regeneration-lifecycle-audit\.sql/,
  "runner must execute lifecycle audit SQL suite",
);
assert.equal(
  packageJson.scripts["test:db:bucket1-generation"],
  "bash scripts/test-db-bucket1-generation.sh",
);
assert.equal(
  packageJson.scripts["verify:db:bucket1-generation"],
  "node scripts/verify-bucket1-generation-db-suite.mjs && node scripts/verify-claim-preflight-hardening.mjs",
);
assert.match(
  packageJson.scripts["test:bucket1-generation"],
  /verify:db:bucket1-generation/,
  "aggregate Bucket1 source contract must include the static SQL verifier",
);
assert.doesNotMatch(
  packageJson.scripts["test:bucket1-generation"],
  /test:db:bucket1-generation|DATABASE_URL/,
  "aggregate source contract must not make the DATABASE_URL runtime suite mandatory",
);

console.log(
  "verify-bucket1-generation-db-suite: transactional SQL behaviors and opt-in runner verified",
);
