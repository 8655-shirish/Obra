import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.join(here, "..", relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(here, "..", relativePath));

for (const file of [
  "src/components/workspace/AgentChatPanel.tsx",
  "src/components/workspace/AddVideoCta.tsx",
  "src/components/workspace/JobProgressPanel.tsx",
  "src/components/workspace/WorkspaceShell.tsx",
]) {
  assert.equal(exists(file), false, `${file} must stay deleted`);
}

const jobs = read("src/lib/jobs.functions.ts");
const worker = read("src/lib/jobs/add-video-worker.server.ts");
const hook = read("src/hooks/useJobProgress.ts");
const kit = read("src/components/site-kit/index.tsx");
const migration = read("supabase/migrations/20260823183000_harden_add_video_enqueue.sql");
const api = read("src/routes/api/agent/message.ts");
const handlers = read("src/lib/agent/tools/handlers.server.ts");

assert.doesNotMatch(
  jobs,
  /getAddVideoAvailability|getRecentAddVideoJobs|enqueueAddVideo|cancelAddVideo/,
);
assert.match(worker, /selectDeterministicAddVideoPlan/);
assert.match(worker, /parseMediaManifest\(4, config\.mediaManifest\)/);
assert.match(worker, /generatorSchemaVersion !== 4/);
assert.doesNotMatch(hook, /getRecentAddVideoJobs|getAddVideoAvailability/);
assert.ok(hook.includes("sourceVersionId"));
assert.ok(kit.includes('preload="none"'));
assert.ok(kit.includes("IntersectionObserver"));
assert.ok(kit.includes("videoIntersected ? resolved.url : undefined"));
assert.ok(kit.includes('resolved.origin === "generated" ? "" : label'));
assert.ok(migration.includes("assert_add_video_source_eligible"));
assert.ok(migration.includes("manifest attachment mismatch"));
assert.doesNotMatch(api, /add_video/);
assert.doesNotMatch(handlers, /generateSiteVideo|generateSiteImage/);

console.log("verify-add-video-ux: workbench CTA and HTTP enqueue gone; worker contracts remain");
