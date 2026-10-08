import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(here, "..", relative));

const message = read("src/routes/api/agent/message.ts");
const claim = read("src/lib/jobs/claim.server.ts");
const handler = read("src/lib/agent/tools/handlers.server.ts");
const runner = read("src/lib/jobs/runner.server.ts");
const run = read("src/lib/agent/agent-run.server.ts");
const executor = read("src/lib/jobs/execute.server.ts");

assert.equal(exists("src/lib/jobs/drain-site-generation.server.ts"), false);

assert.match(message, /text\/event-stream/);
assert.match(message, /15_000/);
assert.match(message, /: ping\\n\\n/);
assert.match(message, /x-accel-buffering/);
assert.match(message, /clearInterval\(ping\)/);
assert.match(message, /personalize_template/);
assert.doesNotMatch(message, /generate_initial|regenerate_variants|drainSiteGenerationOnChat/);

assert.match(claim, /claimNextJob/);
assert.doesNotMatch(claim, /SITE_GENERATION_CHAT_RUNNER_ID|claimOwnedSiteGenerationJob/);
assert.doesNotMatch(claim, /claim_next_background_job[\s\S]*website_id/);

const generator = read("src/lib/agent/website-generator.server.ts");
assert.match(generator, /if \(deferStillWait && nextMediaShot\?\.kind === "image"\)/);

assert.equal(handler.includes('case "generateVariants"'), false);
assert.equal(run.includes("drainSiteGenerationOnChat"), false);

assert.match(executor, /deadlineSignal/);
assert.match(executor, /invocationDeadline: options\.deadlineSignal\?\.aborted === true/);
assert.match(executor, /deferStillWait: Boolean\(options\.deadlineSignal\)/);
assert.match(executor, /STILL_TOTAL_DEADLINE_MS/);
assert.match(runner, /deadlineSignal: deadlineController\.signal/);

assert.match(runner, /claimNextJob\(supabase, schedulerRunId\)/);

console.log("verify-generate-on-chat-sse: chat no longer starts generation; SSE keepalive remains");
