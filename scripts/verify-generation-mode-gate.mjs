import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");
const generatorSource = read("src/lib/agent/website-generator.server.ts");
const executeSource = read("src/lib/jobs/execute.server.ts");
const settlementSource = read("src/lib/jobs/failure-settlement.ts");
const serverEnqueueSource = read("src/lib/jobs/enqueue.server.ts");
const toolEnqueueSource = read("src/lib/agent/tools/handlers.server.ts");

const functionStart = generatorSource.indexOf(
  "export async function generateWebsiteContentForVariant",
);
assert.ok(functionStart >= 0, "generation entry point must exist");
const generation = generatorSource.slice(functionStart);
const resolveAt = generation.indexOf("await resolveGenerationMode(supabase)");
const gateAt = generation.indexOf("assertGenerationModeWriteEnabled(generationMode)");
const websiteReadAt = generation.indexOf('.from("websites")');
assert.ok(resolveAt >= 0, "direct generation must resolve the shared product mode");
assert.ok(gateAt > resolveAt, "the new-write gate must follow mode resolution");
assert.ok(websiteReadAt > gateAt, "the Unified write gate must run before source reads");
for (const value of [
  'if (generationMode === "unified") {',
  'throw new Error("Legacy generation modes are read-only")',
]) {
  assert.ok(generation.includes(value), value);
}
assert.doesNotMatch(generation, /generationMode === "two-step"|const designAttempts = 2/);

const modeSource = read("src/lib/agent/generation-mode.server.ts");
for (const value of ['export type GenerationMode = "unified";', 'if (value !== "unified")']) {
  assert.ok(modeSource.includes(value), value);
}
assert.doesNotMatch(modeSource, /return "two-step"|GenerationMode = "unified" \| "two-step"/);

assert.doesNotMatch(serverEnqueueSource, /enqueueSiteGenerationChain|cancelSiteGenerationRequest/);
assert.doesNotMatch(
  serverEnqueueSource,
  /enqueue_site_generation_job_owned|generationContractVersion: 3/,
);
assert.match(serverEnqueueSource, /enqueueEnrichmentChain/);
assert.doesNotMatch(toolEnqueueSource, /case "generateVariants"/);

for (const value of [
  "job.generation_contract_epoch !== 2",
  "job.generation_contract_version !== 2",
  "running.generation_checkpoint",
  "job.generation_input_snapshot",
  "parseSiteGenerationCheckpoint",
]) {
  assert.ok(executeSource.includes(value), value);
}
assert.doesNotMatch(executeSource, /payload\.generationMode|payload\.generationContractVersion/);
assert.doesNotMatch(executeSource, /executionMode/);
const workerStart = executeSource.indexOf("async function executeSiteGenerationJob");
const workerEnd = executeSource.indexOf("export async function executeJob", workerStart);
assert.doesNotMatch(
  executeSource.slice(workerStart, workerEnd),
  /resolveGenerationMode|isUnifiedSiteAgentEnabled|UNIFIED_SITE_AGENT/,
  "queued jobs must never re-read the live product flag",
);
assert.match(
  settlementSource,
  /options\.jobType !== JOB_TYPE_SITE_GENERATION \|\|[\s\S]*?!isNonretryableGenerationConfigurationError\(options\.error\)/,
);
assert.ok(settlementSource.includes("isNonretryableEvidenceInventoryError(options.error)"));

const flags = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/add-video-flags.server.ts")).href
);
const modes = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/generation-mode.server.ts")).href
);
const previous = process.env.UNIFIED_SCHEMA_V3_WRITE_ENABLED;
const storedFlagClient = (enabled) => ({
  storage: {
    from: () => ({
      download: async () => ({
        data: { text: async () => JSON.stringify({ enabled }) },
        error: null,
      }),
    }),
  },
});
try {
  delete process.env.UNIFIED_SCHEMA_V3_WRITE_ENABLED;
  for (const enabled of [false, true]) {
    await assert.rejects(
      () => modes.resolveGenerationMode(storedFlagClient(enabled)),
      (error) =>
        error instanceof Error && error.message === flags.UNIFIED_SCHEMA_V3_WRITES_DISABLED_ERROR,
    );
  }
  process.env.UNIFIED_SCHEMA_V3_WRITE_ENABLED = "true";
  assert.equal(await modes.resolveGenerationMode(storedFlagClient(true)), "unified");
  await assert.rejects(
    () => modes.resolveGenerationMode(storedFlagClient(false)),
    (error) =>
      error instanceof Error && error.message === flags.UNIFIED_SCHEMA_V3_WRITES_DISABLED_ERROR,
  );
  for (const invalid of [undefined, null, "", "legacy", "two-step", true]) {
    assert.throws(
      () => modes.requireGenerationMode(invalid),
      (error) => error instanceof Error && error.message === modes.INVALID_GENERATION_MODE_ERROR,
    );
  }
  assert.equal(modes.requireGenerationMode("unified"), "unified");
} finally {
  if (previous === undefined) delete process.env.UNIFIED_SCHEMA_V3_WRITE_ENABLED;
  else process.env.UNIFIED_SCHEMA_V3_WRITE_ENABLED = previous;
}

console.log("verify-generation-mode-gate: ok");
