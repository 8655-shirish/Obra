import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const conversation = read("src/lib/agent/conversation.server.ts");
const run = read("src/lib/agent/agent-run.server.ts");
const publicError = read("src/lib/agent/public-error.ts");
const migration = read("supabase/migrations/20260826160000_agent_turn_fenced_lease.sql");
const linkageMigration = read("supabase/migrations/20260826170000_agent_job_trace_linkage.sql");
const recoveryMigration = read(
  "supabase/migrations/20260826203000_agent_generation_recovery_fence.sql",
);
const replaySnapshotMigration = read(
  "supabase/migrations/20260827120000_agent_turn_replay_before_snapshot_validation.sql",
);
const persistWithoutChromeMigration = read(
  "supabase/migrations/20260830200000_persist_generation_without_chrome.sql",
);
const personalizeAdmissionMigration = read(
  "supabase/migrations/20260911170632_f4a9204d-945a-4c5b-a778-3520dd5a9a47.sql",
);
const lovableSchemaCopy = read(
  "supabase/migrations/20260826190901_d4431eb4-0187-412f-95b3-4ae2e0f47e74.sql",
);
const enqueueContract = read(
  "supabase/migrations/20260825100311_eae2fcd7-ad73-47c5-9b48-7481f3c6d349.sql",
);
const api = read("src/routes/api/agent/message.ts");
const handlers = read("src/lib/agent/tools/handlers.server.ts");
const enqueue = read("src/lib/jobs/enqueue.server.ts");
const onboarding = read("src/lib/agent/onboarding.server.ts");
const publish = read("src/lib/agent/publish.server.ts");
const templatePatch = read("src/lib/agent/apply-template-patch.server.ts");
const media = read("src/lib/media/lovable-media.server.ts");
const journal = read("src/lib/agent/journal.server.ts");
const generatedTypes = read("src/integrations/supabase/types.ts");

function sqlFunction(source, name) {
  const start = source.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `missing SQL function ${name}`);
  const end = source.indexOf("\n$$;", start);
  assert.ok(end > start, `unterminated SQL function ${name}`);
  return source.slice(start, end);
}

// Ownership is a renewable token fence, not elapsed-time superseding.
const claim = sqlFunction(linkageMigration, "claim_agent_turn");
const renew = sqlFunction(linkageMigration, "renew_agent_turn");
const complete = sqlFunction(migration, "complete_agent_turn");
const insertMessage = sqlFunction(migration, "insert_agent_message_owned");
const ownedEnqueue = sqlFunction(linkageMigration, "enqueue_site_generation_job_owned");
const forwardOwnedEnqueue = sqlFunction(recoveryMigration, "enqueue_site_generation_job_owned");
const hardenedClaim = sqlFunction(linkageMigration, "claim_agent_turn");
const personalizeClaim = sqlFunction(personalizeAdmissionMigration, "claim_agent_turn");
const hardenedRenew = sqlFunction(linkageMigration, "renew_agent_turn");
const settleBackgroundJob = sqlFunction(recoveryMigration, "settle_background_job");
const cancelWorkspaceJobs = sqlFunction(recoveryMigration, "cancel_workspace_background_jobs");
const settleGenerationMessage = sqlFunction(
  recoveryMigration,
  "settle_agent_site_generation_message",
);
const assertOwned = sqlFunction(migration, "assert_agent_turn_owned");
const beginExternalOperation = sqlFunction(migration, "begin_agent_external_operation");
const finishExternalOperation = sqlFunction(migration, "finish_agent_external_operation");
const abandonExternalOperation = sqlFunction(migration, "admin_abandon_agent_external_operation");
const adminRecover = sqlFunction(recoveryMigration, "admin_recover_agent_turn");
const ownedWrappers = [
  "save_onboarding_field_owned",
  "enqueue_enrichment_chain_owned",
  "publish_website_version_owned",
  "fork_website_version_with_media_owned",
  "update_website_version_config_owned",
  "update_website_version_config_with_media_owned",
  "record_agent_journal_checkpoint_owned",
].map((name) => sqlFunction(migration, name));
for (const ownedMutation of [renew, complete, insertMessage, ownedEnqueue, assertOwned]) {
  assert.ok(ownedMutation.includes("owner_token = p_owner_token"), "mutation lacks token fence");
}
assert.ok(claim.includes("status='running'"), "running traces must remain busy");
assert.equal(
  claim.includes("agent turn lease expired"),
  false,
  "ordinary claim still takes over expired work",
);
assert.equal(
  claim.includes("expires_at > clock_timestamp()"),
  false,
  "external-operation TTL authorizes takeover",
);
assert.ok(claim.includes("jsonb_build_object"));
for (const disposition of ["new", "running", "completed", "error", "cancelled"])
  assert.ok(
    claim.includes(`'${disposition}'`) || claim.includes("existing.status"),
    "missing disposition " + disposition,
  );
assert.ok(claim.includes("assistantMessageId"));
assert.ok(claim.includes("source_version_id is distinct from p_source_version_id"));
assert.ok(claim.includes("source_revision is distinct from p_source_revision"));
assert.ok(insertMessage.includes("insert into public.messages"));
assert.ok(ownedEnqueue.includes("public.enqueue_site_generation_job("));
assert.ok(ownedEnqueue.includes("agent_trace_id=p_trace_id"));
assert.ok(ownedEnqueue.includes("already bound to another agent trace"));
assert.ok(ownedEnqueue.includes("source_version_id is distinct from"));
assert.ok(ownedEnqueue.includes("source_revision is distinct from"));
assert.ok(hardenedClaim.includes("p_lease_seconds is null"));
assert.ok(hardenedClaim.includes("(p_source_version_id is null) <> (p_source_revision is null)"));
assert.ok(hardenedClaim.includes("revision=p_source_revision"));
assert.ok(personalizeClaim.includes("'personalize_template'"));
assert.ok(
  personalizeClaim.includes("p_intent_type in ('regenerate_variants','personalize_template')"),
  "personalization must require a source-version snapshot",
);
assert.ok(
  run.includes("intentType: resolvedIntent.type") &&
    run.includes("sourceRevision: resolvedIntent.expectedRevision ?? null"),
  "personalization claim must send the server-resolved source revision",
);
assert.equal(
  run.includes('resolvedIntent?.type === "personalize_template"'),
  false,
  "personalize is the only live intent; claim must not optional-chain a retired type fork",
);
assert.ok(hardenedRenew.includes("p_lease_seconds is null"));
assert.ok(linkageMigration.includes("background_jobs_agent_trace_id_idx"));
assert.ok(settleGenerationMessage.includes("_agentHandoffMessageId"));
assert.ok(settleGenerationMessage.includes("id=message_id and trace_id=linked_trace_id"));
assert.ok(
  linkageMigration.includes("after update of status,agent_trace_id on public.background_jobs"),
);
assert.ok(linkageMigration.includes("after insert on public.messages"));
assert.ok(generatedTypes.includes('foreignKeyName: "background_jobs_agent_trace_id_fkey"'));
assert.equal(conversation.includes("supersedeRunningAgentTraces"), false);
assert.equal(conversation.includes("TRACE_SLOT_WAIT_MS"), false);
for (const fragment of [
  "claim_agent_turn",
  "renew_agent_turn",
  "complete_agent_turn",
  "insert_agent_message_owned",
])
  assert.ok(conversation.includes(fragment), `missing server fence: ${fragment}`);
assert.ok(run.includes("startAgentTurnHeartbeat"));
assert.ok(run.includes("turnLease: ownedLease"));
assert.doesNotMatch(enqueue, /enqueue_site_generation_job_owned/);
assert.ok(enqueue.includes('rpc("enqueue_enrichment_chain_owned"'));
assert.ok(onboarding.includes('rpc("save_onboarding_field_owned"'));
assert.ok(publish.includes('rpc("publish_website_version_owned"'));
assert.ok(templatePatch.includes('rpc("update_website_version_config_owned"'));
assert.doesNotMatch(templatePatch, /update_website_version_config_with_media_owned/);
assert.ok(media.includes("await options.assertOwned?.()"));
assert.ok(journal.includes('rpc("record_agent_journal_checkpoint_owned"'));
assert.ok(journal.includes('.order("created_at", { ascending: true })'));
assert.ok(journal.includes('.order("trace_id", { ascending: true })'));
assert.ok(journal.includes("[maybeAppendJournalAfterMessages checkpoint]"));
assert.equal(
  journal.includes(
    'throw new Error("Agent turn ownership lost while recording journal checkpoint")',
  ),
  false,
  "checkpoint projection failure terminalizes an otherwise durable turn",
);
assert.ok(run.indexOf("maybeAppendJournalAfterMessages") < run.lastIndexOf("await settleTrace"));
assert.equal(migration.includes("agent_traces_running_has_lease check"), false);
assert.equal(claim.includes("lease_expires_at >"), false, "claim permits expiry takeover");
assert.equal(claim.includes("lease_expires_at <="), false, "claim permits expiry takeover");
assert.ok(migration.includes("create table if not exists public.agent_external_operations"));
const externalOperationTable = migration.slice(
  migration.indexOf("create table if not exists public.agent_external_operations"),
  migration.indexOf("create index if not exists agent_external_operations_trace_status_idx"),
);
assert.equal(
  externalOperationTable.includes("expires_at"),
  false,
  "external operation fence must not expire",
);
assert.equal(
  externalOperationTable.includes("expired_at"),
  false,
  "external operation fence must not expire",
);
assert.ok(beginExternalOperation.includes("pg_advisory_xact_lock"));
assert.ok(beginExternalOperation.includes("status='running'"));
assert.ok(beginExternalOperation.includes("owner_token=p_owner_token"));
assert.ok(finishExternalOperation.includes("p_status not in ('completed','failed')"));
assert.ok(finishExternalOperation.includes("status='running'"));
assert.ok(abandonExternalOperation.includes("p_operation_key"));
assert.ok(abandonExternalOperation.includes("p_expected_trace_id"));
assert.ok(abandonExternalOperation.includes("p_expected_owner_token"));
assert.ok(abandonExternalOperation.includes("p_admin_actor_id"));
assert.ok(abandonExternalOperation.includes("p_reason"));
assert.ok(adminRecover.includes("agent_external_operations"));
assert.ok(adminRecover.includes("status='running'"));
assert.ok(adminRecover.includes("Agent turn has a running external operation"));
assert.ok(adminRecover.includes("job.agent_trace_id=p_trace_id"));
assert.ok(adminRecover.includes("set status='cancelled'"));
assert.ok(adminRecover.includes("for update"));
assert.ok(adminRecover.includes(":site_generation_message"));
assert.ok(
  adminRecover.indexOf("for update") < adminRecover.indexOf(":site_generation_message"),
  "recovery must match terminal transaction job-before-chain lock order",
);
assert.ok(adminRecover.includes("Agent turn has a completed site generation"));
assert.ok(
  adminRecover.indexOf("pg_advisory_xact_lock") < adminRecover.indexOf("for update"),
  "recovery and owned enqueue must share turn-before-job lock order",
);
assert.ok(
  adminRecover.indexOf("for update") <
    adminRecover.indexOf("update public.site_generation_media_slots"),
  "recovery must match canonical job-before-media lock order",
);
assert.ok(
  adminRecover.indexOf("update public.background_jobs") <
    adminRecover.indexOf("update public.agent_traces"),
);
assert.ok(recoveryMigration.includes("recovered_at is not null"));
assert.equal(settleGenerationMessage.includes(":agent_turn"), false);
assert.equal(settleGenerationMessage.includes("update public.background_jobs"), false);
assert.ok(
  settleBackgroundJob.indexOf("for update") <
    settleBackgroundJob.indexOf("update public.site_generation_media_slots"),
  "worker settlement must lock its job before media slots",
);
assert.ok(
  cancelWorkspaceJobs.indexOf("for update") <
    cancelWorkspaceJobs.indexOf("update public.site_generation_media_slots"),
  "workspace cancellation must lock jobs before media slots",
);
assert.ok(
  recoveryMigration.includes(
    "drop function if exists public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)",
  ),
);
assert.ok(
  recoveryMigration.includes(
    "revoke all on function public.enqueue_site_generation_job_unchecked(uuid,text,jsonb,boolean)",
  ),
);
for (const invariant of [
  "Site generation idempotency key is required",
  "Site generation source snapshot does not match agent turn",
  "Site generation chain is already bound to another agent trace",
  "Site generation chain trace binding failed",
  "_agentHandoffMessageId",
  "_agentRequestId",
  "owned_trace.request_id",
]) {
  assert.ok(forwardOwnedEnqueue.includes(invariant), `forward RPC lost invariant: ${invariant}`);
}
assert.ok(
  linkageMigration.includes(
    "drop function if exists public.enqueue_site_generation_job_owned(uuid,text,jsonb,uuid,uuid,boolean)",
  ),
);
assert.ok(lovableSchemaCopy.includes("Intentionally no-op"));
assert.equal(lovableSchemaCopy.includes("rename to enqueue_site_generation_job_unchecked"), false);
assert.ok(complete.includes("Agent turn has a running external operation"));
const checkpointOwned = sqlFunction(migration, "record_agent_journal_checkpoint_owned");
assert.ok(checkpointOwned.includes("conversation_id = p_conversation_id"));
assert.ok(checkpointOwned.includes("Agent checkpoint conversation mismatch"));
assert.ok(migration.includes("agent_traces_request_identity_unique"));
assert.ok(generatedTypes.includes('foreignKeyName: "agent_traces_source_version_id_fkey"'));
assert.ok(generatedTypes.includes('referencedRelation: "website_versions"'));
assert.ok(migration.includes("admin_recover_agent_turn"));
assert.ok(migration.includes("conversations_one_per_website"));
assert.ok(claim.includes("insert into public.conversations"));
const ensureConversation = sqlFunction(migration, "ensure_agent_conversation");
assert.ok(ensureConversation.includes("pg_advisory_xact_lock"));
assert.ok(ensureConversation.includes("Website profile mismatch"));
assert.ok(ensureConversation.includes("on conflict (website_id) do nothing"));
assert.ok(claim.includes("agent_turn_runtime_gate"));
assert.ok(claim.includes("Agent turn runtime is disabled until legacy instances have drained"));
assert.ok(migration.includes("set_agent_turn_runtime_enabled"));
assert.ok(
  migration.includes("request_id=p_request_id") || migration.includes("request_id = p_request_id"),
);
assert.ok(api.includes("requestId: z.string().uuid().optional()"));
assert.ok(api.includes("const requestId ="));
assert.ok(api.includes('type: z.literal("personalize_template")'));
assert.ok(api.includes("intent: intentSchema"));
assert.doesNotMatch(
  api,
  /admin_auto_kickoff|generate_initial|regenerate_variants|onboarding_submitted|add_video|workspaceSnapshot/,
);
assert.doesNotMatch(api, /intent: intentSchema\.optional/);
assert.doesNotMatch(api, /compatibilityRequestId|assertAdminAutoKickoffAuthority/);
assert.ok(api.includes("publicAgentError(error)"));
assert.ok(run.includes("intentType: resolvedIntent.type"));
assert.ok(run.includes("sourceVersionId: resolvedIntent.versionId ?? null"));
assert.ok(run.includes("sourceRevision: resolvedIntent.expectedRevision ?? null"));
assert.ok(run.includes("requestId: identity.requestId"));
assert.ok(run.includes("requestPayloadHash: identity.payloadHash"));
assert.ok(run.includes('claim.disposition === "completed"'));
assert.ok(run.includes("Completed request has no durable assistant response"));
assert.equal(run.includes('assistantMessageId: ""'), false);
assert.equal(run.includes("generationHandoff"), false);
assert.equal(run.includes("drainSiteGenerationOnChat"), false);
assert.equal(run.includes("resolveChatRegenerationIntent"), false);
assert.equal(run.includes("calledGenerateVariants"), false);
assert.equal(run.includes('type: "generate_initial"'), false);
assert.equal(run.includes('intentType: resolvedIntent?.type ?? "chat"'), false);
assert.equal(run.includes("specifiedTool = closedIntentTool"), false);
assert.ok(run.includes("tools: OPENAI_AGENT_TOOLS"));
assert.ok(publicError.includes("The selected preview changed. Refresh the preview"));
assert.ok(publicError.includes("Finish onboarding"));
assert.ok(publicError.includes("A site build is already in progress"));
assert.ok(publicError.includes("job runner is not online"));
assert.ok(publicError.includes("This site rebuild could not be queued"));
assert.ok(run.includes("publicAgentError(claim.error"));
assert.ok(!run.includes('emit({ type: "token", text: closing });\n        if (ok)'));
assert.ok(run.includes("Agent returned no durable assistant response"));
assert.ok(
  run.includes("Agent reached the maximum tool rounds without a durable assistant response"),
);
assert.match(
  persistWithoutChromeMigration,
  /'chat','onboarding_submitted','admin_auto_kickoff','regenerate_variants','publishToLp','generate_initial'/,
);
assert.ok(replaySnapshotMigration.includes("Invalid agent turn intent"));
assert.ok(replaySnapshotMigration.includes("status in ('draft','selected','live')"));
assert.ok(
  replaySnapshotMigration.indexOf("where website_id=p_website_id and request_id=p_request_id") <
    replaySnapshotMigration.indexOf("Agent turn source snapshot does not match"),
);
assert.equal(
  run.slice(0, run.indexOf("await claimAgentTurn")).includes("ensureConversation"),
  false,
);

const ordinaryCompletion = run.slice(
  run.indexOf("let lastAssistantMessageId"),
  run.lastIndexOf("\n  } catch (error)"),
);
const ordinaryGuard = ordinaryCompletion.indexOf(
  "if (!completedWithResponse || !lastAssistantMessageId)",
);
const ordinarySettlement = ordinaryCompletion.indexOf(
  'settleTrace({ status: "completed" })',
  ordinaryGuard,
);
assert.ok(ordinaryGuard >= 0 && ordinarySettlement > ordinaryGuard);
assert.ok(ordinarySettlement < ordinaryCompletion.lastIndexOf('type: "done"'));
assert.ok(
  ordinaryCompletion.indexOf("maybeAppendJournalAfterMessages", ordinaryGuard) < ordinarySettlement,
  "completed turn does not attempt its checkpoint before authoritative completion",
);

for (const mutatingTool of ["publishToLp", "applyTemplatePatch"]) {
  const start = handlers.indexOf(`case "${mutatingTool}"`);
  assert.ok(start >= 0, `missing mutating tool ${mutatingTool}`);
  const nextCase = handlers.indexOf('case "', start + 6);
  const block = handlers.slice(start, nextCase < 0 ? undefined : nextCase);
  assert.ok(block.includes("requireFence()"), `${mutatingTool} lacks ownership fence`);
}
assert.equal(handlers.includes('case "generateVariants"'), false);
assert.equal(handlers.includes('case "generateSiteImage"'), false);
assert.equal(handlers.includes('case "applyConfigPatch"'), false);
assert.equal(handlers.includes('case "saveOnboardingField"'), false);

assert.ok(
  media.includes("if (isIndeterminateGenerationResult(generated))") &&
    media.includes("throw new MediaGenerationIndeterminateError(generated)"),
  "indeterminate provider outcomes do not leave the external operation running",
);
assert.ok(conversation.includes('return "unavailable"'));
assert.ok(conversation.includes('result === "lost"'), "heartbeat aborts on transient RPC failure");
const settleStart = run.indexOf("const settleTrace");
const settleEnd = run.indexOf("try {", settleStart);
const settle = run.slice(settleStart, settleEnd);
assert.ok(
  settle.indexOf("completeAgentTrace") < settle.indexOf("stopHeartbeat?.()"),
  "heartbeat stops before completion is durable",
);
assert.ok(
  settle.includes('completion === "lost"') &&
    settle.includes('throw new Error("Agent turn ownership lost")'),
  "ownership loss returns to a path that can emit completion",
);
const finalization = run.slice(run.lastIndexOf("} finally {"), run.lastIndexOf("export function"));
assert.ok(
  finalization.includes("if (!ownershipController.signal.aborted)"),
  "ownership loss retries completion from finally",
);
assert.ok(
  settle.includes("completeAgentTrace") && conversation.includes('rpc("complete_agent_turn"'),
  "best-effort checkpoint path bypasses authoritative completion fence",
);

assert.ok(enqueue.includes("p_idempotency_key: key"));
assert.ok(ownedEnqueue.includes("_agentHandoffMessageId"));
assert.ok(ownedEnqueue.includes("insert into public.messages"));
assert.equal(run.includes("generationHandoff"), false);
assert.ok(run.includes("requestId: identity.requestId"));
const replay = sqlFunction(enqueueContract, "enqueue_site_generation_job");
assert.ok(replay.includes("idempotency_key = p_idempotency_key"));
assert.ok(replay.includes("p_replay_completed"));
assert.ok(linkageMigration.includes("Site generation idempotency key is required"));
assert.ok(linkageMigration.includes("existing_payload->'executionMode'"));
assert.ok(linkageMigration.includes("background_jobs_one_generation_chain_per_trace"));
assert.ok(replay.includes("return existing_chain"), "same-key retry creates another chain");
assert.ok(
  replay.includes("Idempotency key was already used for a different generation request"),
  "same key can be reused for a different source snapshot",
);

console.log("verify-agent-turn-ownership: ok");
