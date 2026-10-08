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

const { buildJobProgressSnapshot } = await import(
  pathToFileURL(path.join(here, "../src/lib/jobs/progress.server.ts")).href
);
const { classifyTemplateLookupPoll, resolveTemplateLookup } = await import(
  pathToFileURL(path.join(here, "../src/lib/template-purchase/lookup.ts")).href
);

const WEBSITE_ID = "00000000-0000-4000-8000-000000000001";
const FIRST_CHAIN = "11111111-1111-4111-8111-111111111111";
const SECOND_CHAIN = "22222222-2222-4222-8222-222222222222";

function job(input: {
  id: string;
  chainId: string;
  sequence: number;
  status: string;
  createdAt: string;
}) {
  return {
    id: input.id,
    chain_id: input.chainId,
    sequence_index: input.sequence,
    status: input.status,
    created_at: input.createdAt,
    job_type: "enrichment_platform",
    progress_pct: input.status === "completed" ? 100 : 0,
    status_message: null,
    error_message: input.status === "failed" ? "platform failed" : null,
  };
}

function chainJobs(chainId: string, createdAt: string, statuses: string[], idPrefix: string) {
  return statuses.map((status, sequence) =>
    job({
      id: `${idPrefix}${sequence.toString().padStart(2, "0")}`,
      chainId,
      sequence,
      status,
      createdAt,
    }),
  );
}

function disposition(jobs: ReturnType<typeof job>[], researchStatus: string | null) {
  const snapshot = buildJobProgressSnapshot(WEBSITE_ID, jobs);
  return resolveTemplateLookup(snapshot.chains, researchStatus);
}

const thirteenComplete = chainJobs(
  FIRST_CHAIN,
  "2026-09-11T15:14:00.000Z",
  Array.from({ length: 13 }, () => "completed"),
  "a",
);

assert.deepEqual(
  disposition(thirteenComplete, "complete"),
  { kind: "reuse", chainId: FIRST_CHAIN },
  "RCA: completed 13-search run with usable facts is reused with no clock",
);

assert.deepEqual(
  disposition(thirteenComplete, "partial"),
  { kind: "reuse", chainId: FIRST_CHAIN },
  "partial research is usable facts",
);

assert.deepEqual(
  disposition(thirteenComplete, "no_results_found"),
  { kind: "enqueue" },
  "empty fact-sheet may scrape again",
);

assert.deepEqual(
  disposition(thirteenComplete, "failed"),
  { kind: "enqueue" },
  "failed research may scrape again",
);

assert.deepEqual(
  disposition(thirteenComplete, null),
  { kind: "enqueue" },
  "missing research is not treated as gathered facts",
);

const midRun = chainJobs(
  FIRST_CHAIN,
  "2026-09-11T15:14:00.000Z",
  [
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "running",
    "pending",
    "pending",
    "pending",
    "pending",
    "pending",
  ],
  "b",
);
assert.deepEqual(
  disposition(midRun, null),
  { kind: "attach", chainId: FIRST_CHAIN },
  "chain grain attaches even when an early sibling is completed",
);
assert.deepEqual(
  disposition(midRun, "complete"),
  { kind: "attach", chainId: FIRST_CHAIN },
  "in-flight attach wins over leftover research_status",
);

const mixedTerminal = chainJobs(
  FIRST_CHAIN,
  "2026-09-11T15:14:00.000Z",
  [
    "completed",
    "failed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
    "completed",
  ],
  "c",
);
assert.deepEqual(
  disposition(mixedTerminal, "partial"),
  { kind: "enqueue" },
  "terminal mixed chain is not reused as a complete lookup",
);

const redundantInFlight = [
  ...chainJobs(
    SECOND_CHAIN,
    "2026-09-11T15:28:00.000Z",
    [
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ],
    "d",
  ),
  ...thirteenComplete,
];
assert.deepEqual(
  disposition(redundantInFlight, "complete"),
  { kind: "attach", chainId: SECOND_CHAIN },
  "designed seam: live chain is followed even if older facts exist",
);

const firstCompleteOlderReuse = [
  ...chainJobs(
    SECOND_CHAIN,
    "2026-09-11T15:28:00.000Z",
    [
      "completed",
      "failed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
    ],
    "e",
  ),
  ...thirteenComplete,
];
assert.deepEqual(
  disposition(firstCompleteOlderReuse, "partial"),
  { kind: "reuse", chainId: FIRST_CHAIN },
  "usable facts reuse an older complete chain when the latest is mixed",
);

assert.equal(classifyTemplateLookupPoll(undefined), "wait");
assert.equal(
  classifyTemplateLookupPoll({
    chainId: FIRST_CHAIN,
    hasActiveWork: true,
    isComplete: false,
    isCancelled: false,
    hasFailed: true,
    state: "running",
  }),
  "wait",
  "a failed sibling does not finish a still-running chain",
);
assert.equal(
  classifyTemplateLookupPoll({
    chainId: FIRST_CHAIN,
    hasActiveWork: false,
    isComplete: true,
    isCancelled: false,
    hasFailed: false,
    state: "completed",
  }),
  "complete",
);
assert.equal(
  classifyTemplateLookupPoll({
    chainId: FIRST_CHAIN,
    hasActiveWork: false,
    isComplete: false,
    isCancelled: false,
    hasFailed: true,
    state: "failed",
  }),
  "failed",
);
assert.equal(
  classifyTemplateLookupPoll({
    chainId: FIRST_CHAIN,
    hasActiveWork: false,
    isComplete: false,
    isCancelled: true,
    hasFailed: false,
    state: "cancelled",
  }),
  "failed",
);

const functionsSrc = fs.readFileSync(
  path.join(here, "../src/lib/template-purchase.functions.ts"),
  "utf8",
);
const lookupSrc = functionsSrc.slice(functionsSrc.indexOf("loadTemplateLookupDisposition"));
assert.equal(functionsSrc.includes("ENRICH_COOLDOWN"), false);
assert.equal(functionsSrc.includes("completedRecently"), false);
assert.equal(lookupSrc.includes(".limit(1)"), false, "lookup inspects the chain, not one sibling");
assert.match(functionsSrc, /resolveTemplateLookup/);
assert.match(functionsSrc, /disposition\.kind === "attach" \? \{ chainId: disposition\.chainId \}/);

const overviewSrc = fs.readFileSync(
  path.join(here, "../src/components/purchaser/PurchaserOverview.tsx"),
  "utf8",
);
assert.equal(overviewSrc.includes("SCRAPE_TIMEOUT"), false);
assert.equal(overviewSrc.includes("Business lookup is taking too long"), false);
assert.match(overviewSrc, /classifyTemplateLookupPoll/);
assert.match(overviewSrc, /FITTING_TIMEOUT_MS/);

console.log("verify-template-lookup: ok");
