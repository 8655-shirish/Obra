import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const functions = readFileSync("src/lib/agent.functions.ts", "utf8");
const api = readFileSync("src/routes/api/agent/message.ts", "utf8");
const purchaser = readFileSync("src/components/purchaser/PurchaserOverview.tsx", "utf8");

assert.equal(existsSync("src/components/workspace/AgentChatPanel.tsx"), false);
assert.equal(existsSync("src/components/workspace/WorkspaceShell.tsx"), false);
assert.ok(functions.includes("assertWebsiteWorkspaceAccess(data.websiteId)"));
assert.equal(functions.includes("ensureWebsiteForProfile"), false);
assert.ok(purchaser.includes("websiteId"));
assert.ok(purchaser.includes("fetchAgentMessage"));
for (const fragment of [
  "websiteId: z.string().uuid(),",
  "assertWebsiteWorkspaceAccess(body.websiteId)",
  "access.profileId !== body.userId",
  "const websiteId = body.websiteId",
])
  assert.ok(api.includes(fragment), fragment);
assert.equal(api.includes("ensureWebsiteForProfile"), false);
console.log(
  "verify-selected-website-agent-authority: purchaser mutations stay on the selected site",
);
