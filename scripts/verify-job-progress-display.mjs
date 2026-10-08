import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const { progressActivityLabel } = await import(
  pathToFileURL(path.join(here, "../src/lib/jobs/progress-display.ts")).href
);

const chain = { aggregateProgressPct: 42, hasActiveWork: true };
assert.equal(progressActivityLabel(chain, true, false), "42% · checking");
assert.equal(progressActivityLabel(chain, false, false), "42%");
assert.equal(progressActivityLabel({ ...chain, hasActiveWork: false }, true, false), "Finished");

console.log("verify-job-progress-display: ok");
