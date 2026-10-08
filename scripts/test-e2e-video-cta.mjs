import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [
  "src/components/workspace/AddVideoCta.tsx",
  "src/components/workspace/JobProgressPanel.tsx",
  "src/components/workspace/WorkspaceShell.tsx",
]) {
  assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must stay deleted`);
}

console.log("test-e2e-video-cta: workbench Add Video UI is gone; playwright harness is retired");
