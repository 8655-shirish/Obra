import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings=ExperimentalWarning",
      ...process.argv.slice(1),
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const abortMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/abort.server.ts")).href
);

const { assertNotAborted, createAbortError, isAbortError, isTurnCancelled } = abortMod;

const err = createAbortError();
assert.equal(err.name, "AbortError");
assert.equal(isAbortError(err), true);
assert.equal(isAbortError(new Error("nope")), false);

const named = new Error("Aborted");
named.name = "AbortError";
assert.equal(isAbortError(named), true);

const controller = new AbortController();
controller.abort();
assert.throws(() => assertNotAborted(controller.signal), (thrown) => isAbortError(thrown));

const closedStream = new TypeError("Invalid state: Controller is already closed");
assert.equal(isTurnCancelled(controller.signal, closedStream), true);
assert.equal(isTurnCancelled(undefined, closedStream), false);
assert.equal(isTurnCancelled(undefined, err), true);
assert.equal(isTurnCancelled(new AbortController().signal, closedStream), false);

console.log("verify-agent-abort: ok");
