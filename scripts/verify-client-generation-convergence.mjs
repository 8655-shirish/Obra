import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));
const hook = read("src/hooks/useJobProgress.ts");
const display = read("src/lib/jobs/progress-display.ts");

assert.equal(exists("src/components/workspace/AgentChatPanel.tsx"), false);
assert.equal(exists("src/components/workspace/WorkspaceShell.tsx"), false);

assert.ok(display.includes('GENERATION_HANDOFF_PLACEHOLDER = "Building your website…"'));
assert.ok(display.includes("terminalGenerationFallback"));

assert.ok(hook.includes("const inFlightRefreshRef"));
assert.ok(hook.includes("const trailingRefreshRef"));
assert.ok(hook.includes("if (inFlightRefreshRef.current)"));
assert.ok(hook.includes("trailingRefreshRef.current = true"));
assert.ok(hook.includes("} while (trailingRefreshRef.current)"));
assert.equal(hook.includes("refresh({ fromInterval: true })"), false);
assert.ok(hook.includes('.on("broadcast", { event: "progress" }'));
assert.ok(hook.includes('"postgres_changes"'));
assert.ok(hook.includes('if (document.visibilityState === "visible") void refresh()'));

console.log("verify-client-generation-convergence: workbench chat gone; job hook still serializes");
