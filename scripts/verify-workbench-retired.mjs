import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const gone = [
  "src/components/workspace/WorkspaceShell.tsx",
  "src/components/workspace/AgentChatPanel.tsx",
  "src/components/workspace/AddVideoCta.tsx",
  "src/components/workspace/PreviewPanel.tsx",
  "src/components/workspace/JobProgressPanel.tsx",
  "src/lib/agent/extract-kickoff.server.ts",
  "src/lib/agent/chat-intent.server.ts",
  "src/lib/agent/apply-config-patch.server.ts",
  "src/lib/workspace/preview-version-utils.ts",
  "src/lib/workspace/edit-category-support.ts",
  "src/lib/jobs/drain-site-generation.server.ts",
];
for (const file of gone) {
  assert.equal(exists(file), false, `${file} must stay deleted`);
}

const admin = read("src/routes/admin.tsx");
assert.doesNotMatch(admin, /Kickoff contractor|Simulate subscription|Unified site agent/);
assert.doesNotMatch(admin, /adminKickoff|simulatePostCheckout|getAdminGenerationSettings/);
assert.ok(admin.indexOf("<AdminRecordsPanel") < admin.indexOf("<AdminAuthSettings"));

const adminFns = read("src/lib/admin.functions.ts");
assert.doesNotMatch(
  adminFns,
  /export const adminKickoff|getAdminGenerationSettings|setAdminGenerationSettings/,
);

const checkout = read("src/lib/checkout.functions.ts");
assert.doesNotMatch(checkout, /simulatePostCheckout|requireAdminMiddleware/);

const flag = read("src/lib/agent/unified-site-agent.ts");
assert.doesNotMatch(flag, /writeUnifiedSiteAgentFlag/);
assert.match(flag, /UNIFIED_SITE_AGENT_DEFAULT = false/);

const api = read("src/routes/api/agent/message.ts");
assert.match(api, /personalize_template/);
assert.doesNotMatch(
  api,
  /admin_auto_kickoff|generate_initial|regenerate_variants|onboarding_submitted|add_video/,
);
assert.doesNotMatch(api, /intent: intentSchema\.optional/);
assert.doesNotMatch(api, /assertAdminAutoKickoffAuthority/);

const registry = read("src/lib/agent/tools/registry.ts");
assert.match(registry, /getEnrichmentSummary/);
assert.match(registry, /applyTemplatePatch/);
assert.match(registry, /publishToLp/);
assert.match(registry, /suggestCopy/);
assert.doesNotMatch(
  registry,
  /generateVariants|applyConfigPatch|saveOnboardingField|searchComponentLibrary|generateSiteImage|generateSiteVideo/,
);

const handlers = read("src/lib/agent/tools/handlers.server.ts");
assert.doesNotMatch(handlers, /case "generateVariants"/);

const prompts = read("src/lib/agent/prompts.ts");
assert.match(prompts, /PERSONALIZE_TEMPLATE_PROMPT/);
assert.doesNotMatch(prompts, /Call generateVariants|admin kickoff|PERSONA_FIRST_DESIGN_PROMPT/);

const user = read("src/routes/user/$userId.tsx");
assert.doesNotMatch(user, /WorkspaceShell/);
assert.match(user, /PurchaserOverview/);

const shell = read("src/components/admin/AdminShell.tsx");
assert.match(shell, /title: "Home"/);
assert.match(shell, /title: "Agent traces"/);
assert.match(shell, /title: "Observability"/);
assert.match(shell, /Log out/);
assert.match(shell, /collapsible="icon"/);
assert.doesNotMatch(shell, /Kickoff contractor|Simulate subscription/);

assert.match(admin, /AdminShell/);
assert.match(admin, /<AdminRecordsPanel/);
assert.match(admin, /<AdminAuthSettings/);
assert.doesNotMatch(admin, /Kickoff contractor|adminKickoff/);

const traces = read("src/routes/admin_.traces.tsx");
assert.match(traces, /AdminShell/);
assert.doesNotMatch(traces, /Back to admin/);

const observability = read("src/routes/admin_.observability.tsx");
assert.match(observability, /AdminShell/);
assert.doesNotMatch(observability, /Back to admin/);

const enqueue = read("src/lib/jobs/enqueue.server.ts");
assert.match(enqueue, /enqueueEnrichmentChain/);
assert.doesNotMatch(
  enqueue,
  /enqueueSiteGenerationChain|cancelSiteGenerationRequest|cancelWorkspaceJobs/,
);

const jobs = read("src/lib/jobs.functions.ts");
assert.match(jobs, /getWorkspaceBootstrap/);
assert.match(jobs, /getJobProgress/);
assert.doesNotMatch(
  jobs,
  /getAddVideoAvailability|enqueueAddVideo|cancelAddVideo|cancelSiteGeneration|cancelWorkspaceJobsFn|\benqueueEnrichment\b/,
);

const claim = read("src/lib/jobs/claim.server.ts");
assert.match(claim, /claimNextJob/);
assert.doesNotMatch(claim, /claimOwnedSiteGenerationJob|SITE_GENERATION_CHAT_RUNNER_ID/);

console.log("verify-workbench-retired: ok");
