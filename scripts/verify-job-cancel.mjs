import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const mod = await import(
  pathToFileURL(path.join(here, "../src/lib/jobs/cancel-check.server.ts")).href
);

const { shouldExecuteJob, watchJobCancellation } = mod;

assert.equal(shouldExecuteJob("running"), true);
assert.equal(shouldExecuteJob("cancelled"), false);
assert.equal(shouldExecuteJob("pending"), false);
assert.equal(shouldExecuteJob("completed"), false);
assert.equal(shouldExecuteJob("failed"), false);

const alreadyStopped = watchJobCancellation(async () => false, 20);
await new Promise((resolve) => setTimeout(resolve, 60));
assert.equal(alreadyStopped.signal.aborted, true);
alreadyStopped.stop();

const stillRunning = watchJobCancellation(async () => true, 20);
await new Promise((resolve) => setTimeout(resolve, 60));
assert.equal(stillRunning.signal.aborted, false);
stillRunning.stop();

const executeSrc = fs.readFileSync(path.join(here, "../src/lib/jobs/execute.server.ts"), "utf8");
assert.match(executeSrc, /p_job_attempts: job\.attempts/);
assert.match(executeSrc, /settle_background_job/);
assert.match(
  executeSrc,
  /jobClaim: \{[\s\S]*id: job\.id,[\s\S]*attempts: job\.attempts,[\s\S]*claimEpoch: job\.claim_epoch,[\s\S]*runnerId: job\.locked_by/,
);
const insertMigration = fs.readFileSync(
  path.join(here, "../supabase/migrations/20260822090100_atomic_generated_version_insert.sql"),
  "utf8",
);
assert.match(insertMigration, /status = 'running'/);
assert.match(insertMigration, /attempts = p_job_attempts/);
assert.match(insertMigration, /pg_advisory_xact_lock/);

const enqueueSrc = fs.readFileSync(path.join(here, "../src/lib/jobs/enqueue.server.ts"), "utf8");
assert.doesNotMatch(enqueueSrc, /cancelSiteGenerationRequest|p_claim_epoch: job\.claim_epoch/);
assert.doesNotMatch(enqueueSrc, /generation_request_id/);
assert.match(enqueueSrc, /cancelActiveJobChains\(supabase, subject, JOB_TYPE_ENRICHMENT\)/);

console.log("verify-job-cancel: ok");
