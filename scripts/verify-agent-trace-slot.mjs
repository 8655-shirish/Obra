import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const conversation = fs.readFileSync(
  path.join(here, "../src/lib/agent/conversation.server.ts"),
  "utf8",
);
const agentRun = fs.readFileSync(path.join(here, "../src/lib/agent/agent-run.server.ts"), "utf8");
const migration = fs.readFileSync(
  path.join(here, "../supabase/migrations/20260826160000_agent_turn_fenced_lease.sql"),
  "utf8",
);

assert.ok(conversation.includes('rpc("claim_agent_turn"'));
assert.ok(conversation.includes('rpc("renew_agent_turn"'));
assert.ok(conversation.includes('rpc("complete_agent_turn"'));
assert.ok(conversation.includes('rpc("insert_agent_message_owned"'));
assert.equal(conversation.includes("supersedeRunningAgentTraces"), false);
assert.equal(conversation.includes("TRACE_SLOT_WAIT_MS"), false);

assert.ok(migration.includes("pg_advisory_xact_lock"));
assert.equal(migration.includes("lease_expires_at > clock_timestamp()"), false);
assert.ok(migration.includes("status='running'"));
assert.ok(migration.includes("owner_token = p_owner_token"));
assert.ok(migration.includes("enqueue_site_generation_job_owned"));

assert.ok(agentRun.includes("startAgentTurnHeartbeat"));
assert.ok(agentRun.includes("turnLease: ownedLease"));
assert.ok(agentRun.includes("ownershipController.signal.aborted"));
assert.equal(agentRun.includes("waitForAgentTraceSlot"), false);
assert.equal(agentRun.includes("superseded running trace"), false);
assert.ok(agentRun.includes("if (!traceSettled)"));
assert.ok(agentRun.includes("turn ended without completion"));
assert.equal(agentRun.includes("drainSiteGenerationOnChat"), false);

console.log("verify-agent-trace-slot: ok");
