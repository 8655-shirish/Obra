import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { runBackgroundJobBatch } from "../src/lib/jobs/runner.server.ts";
import { postgresJsonbText } from "../src/lib/jobs/site-generation-checkpoint.ts";

const acceptedAt = "2026-08-29T15:00:00.000Z";
const instruction = "Make it warm, modern, editorial, and spacious" + " ".repeat(20 * 1024);
const input = {
  schemaVersion: 1,
  normalizerVersion: "bucket1-context-v1",
  generationKind: "initial",
  sourceVersionId: null,
  sourceRevision: null,
  sourceConfig: null,
  sourceMedia: [],
  onboarding: { contactHidden: true },
  enrichment: {
    evidenceMarker: "worker-preserves-complete-enrichment",
    padding: "z".repeat(2 * 1024 * 1024),
  },
  contactPolicy: {
    schemaVersion: 1,
    source: "websites.onboarding_state.contactHidden",
    sourcePresent: true,
    sourceValue: true,
    contactHidden: true,
    privacyClassification: "generation-private",
    privacySource: "server-generation-storage-policy-v1",
    capturedAtAcceptance: true,
  },
  instruction,
  instructionByteLength: Buffer.byteLength(instruction, "utf8"),
  requestPayloadHash: "b".repeat(64),
  priorIdentities: [],
  crossSiteLayoutIdentities: [],
};
const canonical = postgresJsonbText(input);
const inputHash = createHash("sha256").update(canonical).digest("hex");
const inputSizeBytes = Buffer.byteLength(canonical, "utf8");
assert.ok(inputSizeBytes > 2 * 1024 * 1024);

const authoritativeJob = {
  id: "a8000000-0000-4000-8000-000000000005",
  website_id: "a2000000-0000-4000-8000-000000000005",
  chain_id: "a7000000-0000-4000-8000-000000000005",
  job_type: "site_generation",
  status: "running",
  attempts: 1,
  max_attempts: 3,
  failure_attempts: 0,
  stage_attempts: 0,
  interruption_count: 0,
  claim_epoch: 1,
  locked_by: "bucket1-unbounded-worker",
  progress_pct: 0,
  payload_json: {
    generationKind: "initial",
    generationMode: "unified",
    generationStage: "context",
    generationContractVersion: 2,
  },
  generation_contract_epoch: 2,
  generation_contract_version: 2,
  generation_stage: "context",
  generation_input_version: 1,
  generation_input_snapshot: input,
  generation_input_hash: inputHash,
  generation_accepted_at: acceptedAt,
  generation_request_hash: input.requestPayloadHash,
  generation_kind: "initial",
  source_version_id: null,
  source_revision: null,
  generation_checkpoint: {
    schemaVersion: 2,
    stage: "context",
    acceptedAt,
    inputHash,
    inputSizeBytes,
    input,
  },
};

const authoritativeRow = JSON.parse(JSON.stringify(authoritativeJob)) as typeof authoritativeJob;
const claimedJob = {
  ...authoritativeJob,
  generation_input_snapshot: null,
  generation_input_hash: null,
  generation_checkpoint: null,
};

let yielded: Record<string, unknown> | undefined;
let claimed = false;
let queryMode: "select" | "update" = "select";
let selectedColumns = "*";
const query = {
  select(columns = "*") {
    selectedColumns = columns;
    return this;
  },
  update() {
    queryMode = "update";
    return this;
  },
  eq() {
    return this;
  },
  in() {
    return this;
  },
  lte() {
    return this;
  },
  single() {
    return Promise.resolve({ data: authoritativeRow, error: null });
  },
  maybeSingle() {
    return Promise.resolve({
      data:
        queryMode === "update"
          ? { id: authoritativeJob.id }
          : selectedColumns === "status"
            ? { status: "pending" }
            : authoritativeRow,
      error: null,
    });
  },
};
const supabase = {
  from(table: string) {
    assert.equal(table, "background_jobs");
    queryMode = "select";
    selectedColumns = "*";
    return query;
  },
  rpc(name: string, args: Record<string, unknown>) {
    if (name === "heartbeat_background_job_runner_capability") {
      assert.equal(args.p_capability, 2);
      assert.equal(args.p_browser_ready, false);
      return Promise.resolve({ data: new Date().toISOString(), error: null });
    }
    if (name === "maintain_background_job_lifecycle") {
      return Promise.resolve({ data: [], error: null });
    }
    if (name === "claim_next_background_job") {
      assert.equal(args.p_generation_contract_epoch, 2);
      assert.equal(claimed, false);
      claimed = true;
      return Promise.resolve({
        data: [JSON.parse(JSON.stringify(claimedJob))],
        error: null,
      });
    }
    if (name === "yield_site_generation_stage_epoch") {
      yielded = args;
      return Promise.resolve({ data: true, error: null });
    }
    if (name === "renew_site_generation_lease") {
      return Promise.resolve({ data: true, error: null });
    }
    throw new Error("Unexpected RPC: " + name);
  },
  channel() {
    return {
      subscribe(callback: (status: string) => void) {
        queueMicrotask(() => callback("SUBSCRIBED"));
        return this;
      },
      send() {
        return Promise.resolve("ok");
      },
    };
  },
  removeChannel() {
    return Promise.resolve("ok");
  },
};

assert.notStrictEqual(authoritativeRow, authoritativeJob);
assert.equal(claimedJob.generation_checkpoint, null);
const result = await runBackgroundJobBatch(supabase as never, 1);
assert.deepEqual(result, { processed: 1, claimed: 1, completed: 0, retried: 1, failed: 0 });
assert.equal(claimed, true);
assert.ok(yielded, "context execution must yield a planning checkpoint");
const checkpoint = yielded.p_checkpoint as typeof authoritativeJob.generation_checkpoint & {
  stage: "planning";
  designPreferences: unknown;
};
assert.equal(checkpoint.stage, "planning");
assert.equal(checkpoint.input.enrichment.evidenceMarker, input.enrichment.evidenceMarker);
assert.equal(checkpoint.input.enrichment.padding, input.enrichment.padding);
assert.equal(checkpoint.input.instruction, instruction);
assert.equal(checkpoint.inputHash, inputHash);
assert.equal(checkpoint.inputSizeBytes, inputSizeBytes);
assert.equal(postgresJsonbText(checkpoint.input), canonical);
assert.equal(yielded.p_claim_epoch, 1);
assert.equal(yielded.p_runner_id, "bucket1-unbounded-worker");

console.log("verify-bucket1-unbounded-worker: ok");
