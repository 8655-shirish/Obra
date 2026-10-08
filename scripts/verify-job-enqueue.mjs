import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../src/lib/jobs/enqueue.server.ts"), "utf8");

function sliceFrom(marker, nextMarker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  const end = nextMarker ? src.indexOf(nextMarker, start + marker.length) : src.length;
  assert.ok(end > start, `missing end after ${marker}`);
  return src.slice(start, end);
}

const release = sliceFrom(
  "async function releaseIdempotencyKey",
  "export async function enqueueEnrichmentChain",
);
assert.match(release, /\.update\(\{\s*idempotency_key: null\s*\}\)/);
assert.match(release, /applyEnrichmentSubjectFilter/);
assert.match(release, /\.eq\("idempotency_key", key\)/);
assert.match(release, /\.in\("status", \["completed", "failed"\]\)/);
assert.equal(
  /\.in\("status", \["pending", "running"\]\)/.test(release),
  false,
  "release must not clear in-flight rows",
);

const enrichment = sliceFrom("export async function enqueueEnrichmentChain");
const cancelAt = enrichment.indexOf("await cancelActiveJobChains");
const releaseAt = enrichment.indexOf("await releaseIdempotencyKey");
const insertAt = enrichment.indexOf(".insert");
assert.ok(cancelAt >= 0, "enqueueEnrichmentChain cancels in-flight chains");
assert.ok(releaseAt >= 0, "enqueueEnrichmentChain releases leftover lock holders");
assert.ok(insertAt >= 0, "enqueueEnrichmentChain inserts");
assert.ok(
  cancelAt < releaseAt && releaseAt < insertAt,
  "enqueueEnrichmentChain order: cancel, release, insert",
);
assert.match(enrichment, /idempotencyKey \?\? defaultIdempotencyKey/);
assert.match(enrichment, /await releaseIdempotencyKey\(supabase, subject, key\)/);
assert.match(enrichment, /enqueue_enrichment_chain_owned/);

assert.doesNotMatch(src, /enqueueSiteGenerationChain|enqueue_site_generation_job_owned/);
assert.doesNotMatch(src, /cancelSiteGenerationRequest|cancelWorkspaceJobs/);

console.log("verify-job-enqueue: ok");
