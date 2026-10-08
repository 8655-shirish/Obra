import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(
  new URL("../src/lib/jobs/add-video-worker.server.ts", import.meta.url),
  "utf8",
);
const persistSql = readFileSync(
  new URL(
    "../supabase/migrations/20260830200000_persist_generation_without_chrome.sql",
    import.meta.url,
  ),
  "utf8",
);

assert.ok(
  worker.includes('nextStage: "persistence/commit"'),
  "Add Video composition must yield persistence",
);
assert.ok(
  worker.includes("persistableAddVideoCandidate"),
  "Add Video must persist a candidate without Chrome QA fields",
);
assert.equal(worker.includes("createBucket1HeadlessRuntime"), false);
assert.equal(worker.includes("validateAndAttestAddVideoCandidate"), false);
assert.equal(worker.includes("issueBucket1ValidationAttestation"), false);
assert.ok(worker.includes("attestMp4"), "MP4 file identity attestation remains");

assert.ok(
  persistSql.includes("p_next_stage in ('composition/build','validation/run','persistence/commit')"),
);
assert.ok(persistSql.includes("validatedCandidate"));
assert.ok(
  persistSql.includes("begin\n  -- Quality check removed") ||
    persistSql.includes("never requires a Chrome QA stamp"),
);

console.log("verify-add-video-attestation: ok");
