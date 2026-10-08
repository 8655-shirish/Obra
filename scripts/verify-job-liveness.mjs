import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
const root = path.join(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const { buildJobProgressSnapshot } = await import(
  pathToFileURL(path.join(root, "src/lib/jobs/progress.server.ts")).href
);
const { safeFailureMessage, persistentChainsForDisplay } = await import(
  pathToFileURL(path.join(root, "src/lib/jobs/progress-display.ts")).href
);

const base = {
  id: "job",
  chain_id: "chain",
  website_id: "website",
  job_type: "site_generation",
  sequence_index: 0,
  progress_pct: 0,
  status_message: "Queued site generation…",
  error_message: null,
  created_at: "2026-08-24T00:00:00Z",
  payload_json: {},
};
assert.equal(
  buildJobProgressSnapshot("website", [{ ...base, status: "pending" }]).activeChain?.state,
  "queued",
);
assert.equal(
  buildJobProgressSnapshot("website", [{ ...base, status: "running" }]).activeChain?.state,
  "running",
);
assert.equal(
  buildJobProgressSnapshot("website", [{ ...base, status: "finalizing" }]).activeChain?.state,
  "finalizing",
);
assert.equal(
  buildJobProgressSnapshot("website", [
    { ...base, id: "failed", status: "failed", error_message: "failed" },
    { ...base, id: "pending", sequence_index: 1, status: "pending" },
  ]).activeChain?.state,
  "queued",
);
assert.equal(
  buildJobProgressSnapshot("website", [{ ...base, status: "completed", progress_pct: 100 }])
    .chains[0]?.state,
  "completed",
);
assert.equal(
  buildJobProgressSnapshot("website", [
    { ...base, id: "0000", chain_id: "older", status: "completed", progress_pct: 100 },
    { ...base, id: "ffff", chain_id: "newer", status: "failed", error_message: "failed" },
  ]).chains[0]?.chainId,
  "newer",
  "equal-timestamp generations use their sequence-zero job id as the durable tie-breaker",
);
assert.equal(
  buildJobProgressSnapshot("website", [{ ...base, status: "cancelled" }]).chains[0]?.state,
  "cancelled",
);
assert.equal(
  buildJobProgressSnapshot("website", [
    { ...base, id: "completed", status: "completed", progress_pct: 100 },
    { ...base, id: "failed", sequence_index: 1, status: "failed", error_message: "failed" },
  ]).chains[0]?.state,
  "failed",
);
assert.equal(
  buildJobProgressSnapshot("website", [{ ...base, status: "failed", error_message: "failed" }])
    .activeChain?.state,
  "failed",
);
const generationFailed = {
  chainId: "generation-failed",
  state: "failed",
  jobType: "site_generation",
  hasActiveWork: false,
  errorCode: null,
};
const generationSucceeded = {
  ...generationFailed,
  chainId: "generation-succeeded",
  state: "completed",
};
const addVideoComplete = {
  ...generationSucceeded,
  chainId: "video-complete",
  jobType: "add_video",
};
assert.deepEqual(
  persistentChainsForDisplay([addVideoComplete, generationFailed]).map((chain) => chain.chainId),
  ["video-complete", "generation-failed"],
  "Add Video history must not mask the latest failed generation",
);
assert.deepEqual(
  persistentChainsForDisplay([generationSucceeded, generationFailed]).map((chain) => chain.chainId),
  [],
  "the latest successful generation clears progress and supersedes an older failure",
);
const generationCancelled = {
  ...generationFailed,
  chainId: "generation-cancelled",
  state: "cancelled",
};
assert.deepEqual(
  persistentChainsForDisplay([generationCancelled, generationFailed]).map((chain) => chain.chainId),
  ["generation-cancelled"],
  "the latest cancelled generation remains visible",
);
const generationRetrying = {
  ...generationFailed,
  chainId: "generation-retrying",
  state: "queued",
  hasActiveWork: true,
};
assert.deepEqual(
  persistentChainsForDisplay([generationRetrying, generationFailed]).map((chain) => chain.chainId),
  [],
  "active generation renders through activeChains without a duplicate persistent card",
);
assert.equal(safeFailureMessage(generationFailed), "Site generation failed. Please try again.");

const enqueue = read("src/lib/jobs/enqueue.server.ts");
const functions = read("src/lib/jobs.functions.ts");
assert.match(
  functions,
  /eq\("job_type", "site_generation"\)[\s\S]*eq\("sequence_index", 0\)[\s\S]*order\("created_at", { ascending: false }\)[\s\S]*order\("id", { ascending: false }\)/,
);
const handlers = read("src/lib/agent/tools/handlers.server.ts");
assert.doesNotMatch(enqueue, /generationKind: "initial"|enqueueSiteGenerationChain/);
assert.doesNotMatch(enqueue, /enqueue_site_generation_job_owned/);
assert.doesNotMatch(functions, /enqueueSiteGeneration|generateSiteVariants/);
assert.doesNotMatch(functions, /claimEpoch: z\.number\(\)\.int\(\)\.nonnegative\(\)/);
assert.doesNotMatch(
  functions,
  /enqueueAddVideo|cancelSiteGeneration|getAddVideoAvailability|\benqueueEnrichment\b/,
);
assert.match(
  functions,
  /\.eq\("job_type", "site_generation"\)[\s\S]*latestGeneration\?\.chain_id[\s\S]*\.eq\("chain_id", latestGeneration\.chain_id\)/,
  "latest generation must be fetched independently of bounded mixed job history",
);
assert.match(
  functions,
  /const byId = new Map[\s\S]*authoritativeJobs = \[\.\.\.byId\.values\(\)\]/,
);
assert.doesNotMatch(handlers, /rpc\(\s*["']enqueue_site_generation_job/);
assert.doesNotMatch(enqueue, /from\("website_versions"\)/);

const hook = read("src/hooks/useJobProgress.ts");
const progressServer = read("src/lib/jobs/progress.server.ts");
assert.match(progressServer, /bFirstJobId\.localeCompare\(aFirstJobId\)/);
assert.match(hook, /requestSequence === refreshSequenceRef\.current/);
assert.match(hook, /inFlightRefreshRef\.current/);
assert.match(hook, /trailingRefreshRef\.current = true/);
assert.match(hook, /while \(trailingRefreshRef\.current\)/);
assert.match(hook, /useState\(true\)/);
assert.doesNotMatch(hook, /recent add-video history|getRecentAddVideoJobs/);
const execute = read("src/lib/jobs/execute.server.ts");
const agentRun = read("src/lib/agent/agent-run.server.ts");
assert.doesNotMatch(agentRun, /generation_handoff_message_id/);
assert.doesNotMatch(agentRun, /recoverCommittedGeneration/);
assert.doesNotMatch(agentRun, /drainSiteGenerationOnChat/);
assert.doesNotMatch(agentRun, /_agentHandoffMessageId/);
const generator = read("src/lib/agent/website-generator.server.ts");
const enqueueContract = read("supabase/migrations/20260824230000_generation_enqueue_contract.sql");
const cancelFinalizing = read("supabase/migrations/20260824231000_cancel_finalizing_jobs.sql");
const finalizationAttempts = read(
  "supabase/migrations/20260824232000_count_initial_finalization_attempt.sql",
);
assert.match(execute, /checkpoint\.input\.generationKind !== job\.generation_kind/);
assert.match(execute, /checkpoint\.input\.sourceVersionId !== job\.source_version_id/);
assert.match(execute, /checkpoint\.input\.sourceRevision !== job\.source_revision/);
assert.match(generator, /evidenceImages: evidenceInventory/);
assert.match(generator, /sourceEvidenceOnly[\s\S]*\? \(evidenceMedia \?\? \[\]\)/);
assert.match(execute, /parseSiteGenerationCheckpoint\(running\.generation_checkpoint/);
assert.doesNotMatch(execute, /_agentHandoffMessageId|_agentRequestId/);
assert.match(execute, /yield_site_generation_stage_epoch[\s\S]*if \(error \|\| data !== true\)/);
assert.match(execute, /settle_site_generation_epoch[\s\S]*if \(error \|\| data !== true\)/);
assert.match(execute, /interruptError[\s\S]*Unable to persist site generation interruption/);
assert.match(
  execute,
  /interruptError \|\| interrupted !== true[\s\S]*Unable to persist Add Video interruption/,
);
assert.match(
  execute,
  /throw new DOMException\("Generation cancelled or superseded", "AbortError"\)/,
);
assert.match(generator, /resumeGachaLock\?: GachaLock/);
assert.doesNotMatch(generator, /resumeUnifiedBrief/);
assert.doesNotMatch(generator, /UNIFIED_SITE_AGENT_PLAN_PROMPT/);
assert.doesNotMatch(generator, /resumeRecord\?\.brief \?\? resumeUnifiedBrief/);
assert.match(
  enqueueContract,
  /Idempotency key was already used for a different generation request/,
);
assert.match(enqueueContract, /Legacy generation job lacks a valid source snapshot/);
assert.match(enqueueContract, /not \(j\.payload_json \? 'generationKind'\)/);
assert.match(enqueueContract, /source_version_id is null or source_revision is null/);
assert.match(enqueueContract, /source_revision bigint/);
assert.match(enqueueContract, /status in \('completed', 'failed', 'cancelled'\)/);
assert.match(enqueueContract, /A site generation job is already active for this website/);
assert.match(cancelFinalizing, /status in \('pending','running','finalizing'\)/);
assert.match(cancelFinalizing, /p_website_id::text \|\| ':site_generation'/);
assert.match(
  cancelFinalizing,
  /idempotency_key=case when job_type='site_generation' then idempotency_key else null end/,
);
assert.match(finalizationAttempts, /finalization_attempts=finalization_attempts\+1/);

const claim = read("src/lib/jobs/claim.server.ts");
assert.match(claim, /p_generation_contract_epoch: 2/);
assert.doesNotMatch(claim, /BUCKET1_EPOCH2_CLAIMS_ENABLED/);
const runner = read("src/lib/jobs/runner.server.ts");
assert.match(runner, /status === "pending"\) result\.retried/);
assert.doesNotMatch(runner, /status === "queued"/);
assert.match(runner, /Unable to inspect background job settlement/);
assert.match(runner, /p_capability: 2/);
assert.match(runner, /p_browser_ready: false/);
assert.doesNotMatch(runner, /inspectBucket1HeadlessRuntimeAvailability/);
assert.doesNotMatch(runner, /BUCKET1_EPOCH2_CLAIMS_ENABLED/);

const stageMigration = read("supabase/migrations/20260824250000_staged_site_generation.sql");
assert.match(stageMigration, /claim_site_generation_stage/);
assert.match(stageMigration, /payload_json->>'executionMode'='browser'/);
assert.match(
  stageMigration,
  /candidate\.payload_json->>'executionMode' is distinct from 'browser'/,
);
assert.equal(
  fs.existsSync(path.join(root, "src/routes/api/generation/continue.ts")),
  false,
  "browser-owned generation continuation route must remain removed",
);
assert.equal(fs.existsSync(path.join(root, "src/components/workspace/WorkspaceShell.tsx")), false);

const cron = read("supabase/migrations/20260824240000_canonical_lovable_job_cron.sql");
assert.match(cron, /background_job_cron_health/);
assert.match(cron, /grant usage on sequence public\.background_job_cron_requests_id_seq/);
assert.match(cron, /from net\._http_response response/);
assert.match(cron, /status_code = response\.status_code/);
assert.match(cron, /requested_at < now\(\) - interval '30 days'/);
assert.match(cron, /sweep-add-video-orphans/);
assert.match(cron, /ADD_VIDEO_ORPHAN_SWEEPER_SECRET/);
assert.match(cron, /body := '{\"dryRun\":true}'::jsonb/);
assert.match(cron, /command like '%\/api\/internal\/run-jobs%'/);
assert.doesNotMatch(cron, /url := 'https:\/\/obra-tech\.lovable\.app/);

console.log("verify-job-liveness: ok");
