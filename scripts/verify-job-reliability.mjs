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
const { isRetryableFirecrawlStatus } = await import(
  pathToFileURL(path.join(root, "src/lib/integrations/firecrawl-retry.ts")).href
);
const { buildJobProgressSnapshot } = await import(
  pathToFileURL(path.join(root, "src/lib/jobs/progress.server.ts")).href
);
const { jobFailureSettlement } = await import(
  pathToFileURL(path.join(root, "src/lib/jobs/failure-settlement.ts")).href
);
const { INVALID_UNIFIED_GENERATION_CHECKPOINT_ERROR } = await import(
  pathToFileURL(path.join(root, "src/lib/agent/unified-design-brief.ts")).href
);
assert.equal(
  jobFailureSettlement({
    jobType: "site_generation",
    attempts: 1,
    maxAttempts: 3,
    payload: {},
    error: new Error(INVALID_UNIFIED_GENERATION_CHECKPOINT_ERROR),
  }).canRetry,
  false,
  "malformed persisted checkpoints must fail once instead of exhausting retries",
);
assert.equal(
  jobFailureSettlement({
    jobType: "site_generation",
    attempts: 1,
    maxAttempts: 3,
    payload: {},
    error: new Error("Invalid generation checkpoint: contactPolicy contract"),
  }).canRetry,
  false,
  "malformed frozen checkpoints must fail once instead of exhausting retries",
);
assert.equal(isRetryableFirecrawlStatus(408), true);
assert.equal(isRetryableFirecrawlStatus(425), true);
assert.equal(isRetryableFirecrawlStatus(429), true);
assert.equal(isRetryableFirecrawlStatus(503), true);
assert.equal(isRetryableFirecrawlStatus(401), false);
assert.equal(isRetryableFirecrawlStatus(404), false);

const base = {
  chain_id: "c",
  website_id: "w",
  job_type: "enrichment_platform",
  progress_pct: 100,
  created_at: "2026-01-01",
  sequence_index: 0,
  status_message: null,
  error_message: null,
};
const snapshot = buildJobProgressSnapshot("w", [
  { ...base, id: "a", status: "completed" },
  { ...base, id: "b", sequence_index: 1, status: "failed", error_message: "terminal" },
]);
assert.equal(snapshot.activeChains.length, 0, "drained mixed terminal chains are not active work");
assert.equal(
  snapshot.activeChain?.hasFailed,
  true,
  "mixed terminal failure remains visible as fallback",
);
assert.equal(snapshot.activeChain?.hasActiveWork, false);
const finalizing = buildJobProgressSnapshot("w", [{ ...base, id: "f", status: "finalizing" }]);
assert.equal(
  finalizing.activeChains.length,
  1,
  "finalization remains visible and blocks completion",
);

const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20260824210000_job_finalization_scheduler_hardening.sql"),
  "utf8",
);
assert.ok(sql.includes("status in ('pending', 'running', 'finalizing')"));
assert.match(sql, /background_jobs_status_check/);
assert.match(sql, /finalizing/);
assert.match(sql, /finalization_attempts between 0 and 3/);
assert.match(sql, /retry_enrichment_finalization/);
assert.match(sql, /next_retry_at timestamptz/);
assert.match(sql, /parse_background_job_retry_at/);
assert.match(sql, /exception when others/);
assert.match(sql, /background_jobs_claim_due_idx/);
assert.ok(sql.includes("candidate.payload_json->'resume_enrichment_finalization' = 'true'::jsonb"));
assert.ok(sql.includes("attempts=attempts+1"));
assert.ok(sql.includes("then 'finalizing' else 'running' end"));
assert.ok(sql.includes("status='finalizing'"));
assert.ok(sql.includes("terminal worker failure"));

const claimSource = fs.readFileSync(path.join(root, "src/lib/jobs/claim.server.ts"), "utf8");
assert.doesNotMatch(
  claimSource,
  /findEligiblePendingJob|export async function claimJob|releaseStaleLocks/,
);
assert.match(claimSource, /claim_next_background_job/);
const executeSource = fs.readFileSync(path.join(root, "src/lib/jobs/execute.server.ts"), "utf8");
assert.match(executeSource, /isInvalidGenerationCheckpointError/);
assert.match(executeSource, /settleInvalidGenerationCheckpoint/);
assert.match(executeSource, /scrapeResult.retryable/);
assert.match(executeSource, /settleEnrichmentJob/);
assert.match(executeSource, /finalizeEnrichmentChain/);
assert.match(executeSource, /retryEnrichmentFinalization/);
assert.doesNotMatch(
  executeSource,
  /const rpc = supabase\.rpc/,
  "supabase.rpc must stay a method call so this.rest is defined",
);
const addVideoSource = fs.readFileSync(
  path.join(root, "src/lib/jobs/add-video-worker.server.ts"),
  "utf8",
);
assert.doesNotMatch(
  addVideoSource,
  /return supabase\.rpc as unknown as AddVideoLedgerRpc|const rpc = supabase\.rpc/,
  "Add Video ledger RPCs must invoke supabase.rpc as a method",
);
const { generationExhausted, isGenerationExhaustedError } = await import(
  pathToFileURL(path.join(root, "src/lib/agent/generation-errors.ts")).href
);
const exhausted = generationExhausted("unified-design", "plan operational validation failed");
assert.equal(
  exhausted.message,
  "site_generation_exhausted:unified-design:plan operational validation failed",
);
assert.equal(exhausted.lastFailure, "plan operational validation failed");
assert.equal(isGenerationExhaustedError(exhausted), true);
assert.equal(
  jobFailureSettlement({
    jobType: "site_generation",
    attempts: 1,
    maxAttempts: 3,
    payload: {},
    error: exhausted,
  }).retryable,
  true,
  "planning exhaustion stays retryable; the persisted message must carry lastFailure",
);

const { callSupabaseRpc } = await import(
  pathToFileURL(path.join(root, "src/lib/jobs/supabase-rpc.server.ts")).href
);
const rpcClient = {
  rest: {
    rpc(name, args) {
      return Promise.resolve({ data: { name, args }, error: null });
    },
  },
  rpc(name, args) {
    return this.rest.rpc(name, args);
  },
};
const unboundRpc = rpcClient.rpc;
assert.throws(
  () => {
    void unboundRpc("fn", {});
  },
  /rest/,
  "extracting supabase.rpc drops this and cannot read rest",
);
const bound = await callSupabaseRpc(rpcClient, "fn", { a: 1 });
assert.deepEqual(bound.data, { name: "fn", args: { a: 1 } });
const canonicalCron = fs.readFileSync(
  path.join(root, "supabase/migrations/20260824240000_canonical_lovable_job_cron.sql"),
  "utf8",
);
assert.match(canonicalCron, /obra-run-background-jobs/);
assert.match(canonicalCron, /https:\/\/obratech\.co\/api\/internal\/run-jobs/);
assert.equal(fs.existsSync(path.join(root, "wrangler.jsonc")), false);
assert.equal(fs.existsSync(path.join(root, "server/plugins/background-jobs-scheduled.ts")), false);
console.log("verify-job-reliability: ok");
