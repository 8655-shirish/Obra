import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(here, "..", relative));

assert.equal(exists("src/components/workspace/AgentChatPanel.tsx"), false);
assert.equal(exists("src/components/workspace/AddVideoCta.tsx"), false);

const route = read("src/routes/api/agent/message.ts");
const runner = read("src/lib/agent/agent-run.server.ts");
const handlers = read("src/lib/agent/tools/handlers.server.ts");

assert.doesNotMatch(route, /add_video/);
assert.ok(route.includes('type: z.literal("personalize_template")'));
assert.doesNotMatch(runner, /add_video/);
assert.doesNotMatch(handlers, /generateSiteVideo|generateSiteImage/);

console.log("verify-add-video-shell: add-video agent intent and workbench CTA are gone");
