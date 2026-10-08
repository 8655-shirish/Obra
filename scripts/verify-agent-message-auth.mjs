import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const helper = read("src/lib/agent/fetch-agent-message.ts");
assert.match(helper, /supabaseBrowser\.auth\.getSession/);
assert.match(helper, /Authorization: `Bearer \$\{accessToken\}`/);
assert.match(helper, /if \(!accessToken\)/);
assert.match(helper, /status: 401/);
assert.match(helper, /fetch\("\/api\/agent\/message"/);
assert.equal(helper.includes("if (accessToken)"), false, "token is required, not optional");

const purchasers = read("src/components/purchaser/PurchaserOverview.tsx");
assert.match(purchasers, /fetchAgentMessage/);
assert.equal(purchasers.includes('fetch("/api/agent/message"'), false);

const rawCallers = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      walk(full);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const rel = path.relative(root, full);
    if (rel === "src/lib/agent/fetch-agent-message.ts") continue;
    const src = fs.readFileSync(full, "utf8");
    if (src.includes('fetch("/api/agent/message"') || src.includes("fetch('/api/agent/message'")) {
      rawCallers.push(rel);
    }
  }
}
walk(path.join(root, "src"));
assert.deepEqual(
  rawCallers,
  [],
  `raw /api/agent/message fetch remains in ${rawCallers.join(", ")}`,
);

console.log("verify-agent-message-auth: ok");
