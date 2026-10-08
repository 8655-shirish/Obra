import assert from "node:assert/strict";
import fs from "node:fs";

const read = (relative) => fs.readFileSync(new URL("../" + relative, import.meta.url), "utf8");
const exists = (relative) => fs.existsSync(new URL("../" + relative, import.meta.url));
const legacyMigration = read("supabase/migrations/20260824250000_staged_site_generation.sql");
const migration = read("supabase/migrations/20260828120000_bucket1_server_owned_generation.sql");
const executor = read("src/lib/jobs/execute.server.ts");
const runner = read("src/lib/jobs/runner.server.ts");
const validation = read("src/lib/site-validation/bucket1-validation.server.ts");
const runtime = read("src/lib/site-validation/bucket1-headless-runtime.server.ts");
const generator = read("src/lib/agent/website-generator.server.ts");
const inputs = read("src/lib/agent/unified-site-agent-inputs.ts");
const designPreferences = read("src/lib/agent/design-preferences.server.ts");
const progress = read("src/lib/jobs.functions.ts");

assert.equal(exists("src/routes/api/generation/continue.ts"), false);
assert.equal(exists("src/hooks/useSiteGenerationContinuation.ts"), false);
assert.doesNotMatch(executor, /executionMode|claim_site_generation_stage/);
assert.doesNotMatch(generator, /executionMode|generationMode === "two-step"/);
assert.doesNotMatch(generator, /frozenContext\?\.instruction/);
assert.match(generator, /designPreferences,/);
assert.match(inputs, /raw acceptance prose is withheld/);
assert.match(designPreferences, /DESIGN_PREFERENCES_NORMALIZER_VERSION/);

for (const value of [
  "payload_json = (payload_json - 'executionMode')",
  "payload_json->>'generationMode' = 'unified'",
  "generation_contract_epoch = 2",
  "status in ('pending','running','finalizing')",
  "raise exception 'Browser-owned generation is retired'",
  "candidate.generation_contract_epoch = 2",
  "candidate.generation_contract_version = 2",
]) {
  assert.ok(migration.includes(value), value);
}
assert.doesNotMatch(
  migration.slice(
    migration.indexOf("create or replace function public.claim_next_background_job"),
    migration.indexOf("-- Browser ownership is retired"),
  ),
  /payload_json->>'executionMode'/,
);

// The executor consumes authoritative database cursor/checkpoint fields and native epoch RPCs.
for (const value of [
  "generation_checkpoint",
  "generation_stage",
  "claim_epoch",
  '"yield_site_generation_stage_epoch"',
  '"settle_site_generation_epoch"',
  '"renew_site_generation_lease"',
  'case "context"',
  'case "planning"',
  'case "media"',
  'case "composition"',
  'case "validation"',
  'case "persistence"',
]) {
  assert.ok(executor.includes(value), value);
}
assert.doesNotMatch(
  executor,
  /payload\.generationStage|payload\.unifiedBrief|rpc\("yield_site_generation_stage"/,
);
for (const value of [
  "operationDeadlineAt = startedAt + invocationBudgetMs - settlementReserveMs",
  "deadlineController.signal",
  "clearTimeout(deadlineTimer)",
]) {
  assert.ok(runner.includes(value), value);
}
for (const value of [
  "AbortSignal.any([invocationSignal, cancellation.signal])",
  "jobExecutionSignal(leaseController.signal, options)",
  'nextCheckpoint(checkpoint, "persistence"',
  '"interrupt_site_generation_epoch"',
  '"invocation_deadline"',
]) {
  assert.ok(executor.includes(value), value);
}
assert.doesNotMatch(executor, /createBucket1HeadlessRuntime/);
assert.doesNotMatch(executor, /executeGenerationValidation[\s\S]*createBucket1/);
for (const value of [
  "options.runtime.validate({",
  "signal: options.signal",
  'error.name === "AbortError"',
  "throw error",
]) {
  assert.ok(validation.includes(value), value);
}
for (const value of [
  "throwIfAborted(signal)",
  "loadBoundResources(input, options.resolveResource, signal)",
  'signal?.addEventListener("abort", abortBrowser',
  'signal?.addEventListener("abort", abortContext',
  "throw abortError(signal)",
]) {
  assert.ok(runtime.includes(value), value);
}
for (const value of [
  'await onStageCheckpoint?.("media")',
  'await onStageCheckpoint?.("composition")',
  "shots: nextMediaShot ? [nextMediaShot] : []",
  "parallelStills: false",
  "maxStillAttempts: 1",
  'executionUnit?: "planning" | "media" | "composition"',
]) {
  assert.ok(generator.includes(value), value);
}

// Historical staged schemas remain readable/migratable, but no longer own execution.
for (const value of [
  "Validate the complete request before an idempotent replay",
  "version creation and job completion",
  "jsonb_typeof(p_payload_json->'generationMode') is distinct from 'string'",
]) {
  assert.ok(legacyMigration.includes(value), value);
}
assert.ok(progress.includes("latestGeneration"));

console.log("verify-staged-generation: ok");
