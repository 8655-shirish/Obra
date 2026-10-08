import { spawnSync } from "node:child_process";

if (!process.env.RELEASE_BROWSER_EVIDENCE?.trim()) {
  console.error(
    "verify-release-browser-proof: RELEASE_BROWSER_EVIDENCE must reference reviewed deployed closed-browser evidence.",
  );
  process.exit(1);
}

const result = spawnSync("pnpm", ["verify:bucket1-runtime"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: process.env,
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

if (result.status !== 0) process.exit(result.status ?? 1);

const executedMarker = "Bucket 1 runtime contract and installed Chromium validation verified.";
if (!(result.stdout ?? "").includes(executedMarker)) {
  console.error(
    "verify-release-browser-proof: Chromium validation did not execute; a source-contract/browser-unavailable result is not release browser proof.",
  );
  process.exit(1);
}

console.log(
  "verify-release-browser-proof: pinned Chromium validation executed; external evidence reference was supplied.",
);
