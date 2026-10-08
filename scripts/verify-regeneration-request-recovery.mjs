import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));
const api = read("src/routes/api/agent/message.ts");
const run = read("src/lib/agent/agent-run.server.ts");

assert.equal(exists("src/components/workspace/AgentChatPanel.tsx"), false);
assert.doesNotMatch(api, /compatibilityRequestId|regenerate_variants|generate_initial/);
assert.ok(api.includes('type: z.literal("personalize_template")'));
assert.ok(api.includes("requestId: z.string().uuid().optional()"));
assert.ok(api.includes("body.requestId ?? crypto.randomUUID()"));

assert.equal(run.includes("generation_handoff_message_id"), false);
assert.equal(run.includes("recoverCommittedGeneration"), false);
assert.ok(run.includes("requestId: identity.requestId"));
const completedReplay = run.slice(
  run.indexOf('if (claim.disposition === "completed")'),
  run.indexOf('if (claim.disposition === "cancelled")'),
);
assert.ok(completedReplay.includes("Completed request has no durable assistant response"));
assert.ok(completedReplay.includes("assistantMessageId: claim.assistantMessageId"));
assert.equal(completedReplay.includes("recoverCommittedGeneration"), false);

console.log("verify-regeneration-request-recovery: workbench regen identity is gone");
