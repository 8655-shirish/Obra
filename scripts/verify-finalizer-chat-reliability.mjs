import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260825120000_fix_generation_finalizer_ambiguity.sql");
const messageOrderMigration = read("supabase/migrations/20260825120100_message_causal_order.sql");
const conversation = read("src/lib/agent/conversation.server.ts");
const generatedTypes = read("src/integrations/supabase/types.ts");
const adminFunctions = read("src/lib/admin.functions.ts");
const adminTraces = read("src/lib/admin-traces.functions.ts");
const publicAgentLogs = read("src/routes/api/public/agent-logs.ts");
const userRoute = read("src/routes/user/$userId.tsx");
const progressDisplay = read("src/lib/jobs/progress-display.ts");

assert.ok(
  migration.includes(
    "create or replace function public.insert_generated_website_version_with_slots",
  ),
);
assert.ok(migration.includes("supplied.slot_uuid"));
assert.ok(!migration.includes("supplied.id"));
assert.ok(migration.includes("source_slots.website_id"));
assert.ok(migration.includes("is distinct from 'unified-site-agent'"));
assert.ok(migration.includes("slots.asset_id is distinct from manifest_slot->>'assetId'"));
assert.ok(migration.includes("Resolved media manifest must cover every ready slot exactly once"));
assert.ok(migration.includes("slots.storage_path is distinct from manifest_slot->>'storagePath'"));
assert.ok(migration.includes("next_retry_at = null"));
assert.ok(migration.includes("source_slots.slot_id"));
assert.ok(migration.includes("where source_slots.id = any(p_media_slot_ids)"));
assert.ok(
  !migration.includes("from public.site_generation_media_slots where id = any(p_media_slot_ids)"),
);
assert.ok(
  migration.includes(
    "grant execute on function public.insert_generated_website_version_with_slots",
  ),
);

assert.ok(messageOrderMigration.includes("row_number() over (order by created_at, id)"));
assert.ok(messageOrderMigration.includes("alter column sequence_id set not null"));
assert.ok(messageOrderMigration.includes("create trigger messages_assign_sequence_id"));
assert.ok(messageOrderMigration.includes("revoke all on sequence"));
assert.ok(messageOrderMigration.includes("new.sequence_id := nextval"));
assert.ok(messageOrderMigration.includes("messages_conversation_sequence_idx"));
assert.ok(conversation.includes('.order("sequence_id", { ascending: false })'));
assert.ok(conversation.includes("trace_id, sequence_id"));
assert.ok(generatedTypes.includes("sequence_id: number"));
assert.ok(adminFunctions.includes('.order("sequence_id", { ascending: true })'));
assert.ok(adminTraces.includes('.order("sequence_id", { ascending: true })'));
assert.ok(publicAgentLogs.includes('.order("sequence_id", { ascending: true })'));
assert.ok(conversation.includes("const chronological = (data ?? []).reverse()"));
assert.ok(conversation.includes('findIndex((message) => message.role !== "tool")'));

assert.ok(progressDisplay.includes('chain.jobType === "site_generation"'));
assert.ok(progressDisplay.includes('latestGeneration.state === "failed"'));
assert.ok(progressDisplay.includes('latestGeneration.state === "cancelled"'));
assert.ok(progressDisplay.includes('"Site generation failed. Please try again."'));
assert.ok(userRoute.includes("<PurchaserOverview"));
assert.ok(!userRoute.includes("WorkspaceShell"));
assert.equal(fs.existsSync(new URL("../src/components/workspace/AgentChatPanel.tsx", import.meta.url)), false);

console.log("verify-finalizer-chat-reliability: ok");
