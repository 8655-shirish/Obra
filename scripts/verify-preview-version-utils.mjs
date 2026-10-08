import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const gone = [
  "src/lib/workspace/preview-version-utils.ts",
  "src/lib/workspace/edit-category-support.ts",
  "src/components/workspace/WorkspaceShell.tsx",
  "src/components/workspace/PreviewPanel.tsx",
];
for (const file of gone) {
  assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must stay deleted`);
}

console.log("verify-preview-version-utils: workbench preview helpers are gone");
