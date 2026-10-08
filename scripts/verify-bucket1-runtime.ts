import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUCKET1_RUNTIME_CHECK_IDS,
  BUCKET1_VALIDATION_CONTRACT,
} from "../src/lib/site-validation/bucket1-contract.ts";
import {
  createBucket1HeadlessRuntime,
  inspectBucket1HeadlessRuntimeAvailability,
} from "../src/lib/site-validation/bucket1-headless-runtime.server.ts";
import { collectBucket1BrowserChecks } from "../src/lib/site-validation/bucket1-runtime-checks.ts";
import { bindBucket1ValidationInput } from "../src/lib/site-validation/bucket1-validation.server.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const browserMetadata = JSON.parse(
  readFileSync(
    path.join(
      root,
      "node_modules/.pnpm/playwright-core@1.55.0/node_modules/playwright-core/browsers.json",
    ),
    "utf8",
  ),
);
const chromium = browserMetadata.browsers.find((entry) => entry.name === "chromium");
assert.equal(chromium?.revision, BUCKET1_VALIDATION_CONTRACT.browser.revision);
assert.equal(chromium?.browserVersion, BUCKET1_VALIDATION_CONTRACT.browser.browserVersion);
assert.equal(BUCKET1_VALIDATION_CONTRACT.browser.playwrightVersion, "1.55.0");
assert.equal(typeof createBucket1HeadlessRuntime, "function");
assert.equal(typeof collectBucket1BrowserChecks, "function");
assert.deepEqual([...BUCKET1_RUNTIME_CHECK_IDS], [...BUCKET1_VALIDATION_CONTRACT.checks]);

const hostPath = path.join(root, "public/site-runtime/host.html");
assert.equal(existsSync(hostPath), true, "build:site-runtime must produce the isolated host");
const host = readFileSync(hostPath, "utf8");
assert.match(host, /site-runtime-init/);
assert.match(host, /site-runtime-healthy/);
assert.doesNotMatch(host, /<script[^>]+src=/i);

const adapterPath = path.join(root, "src/lib/site-validation/bucket1-headless-runtime.server.ts");
const checksPath = path.join(root, "src/lib/site-validation/bucket1-runtime-checks.ts");
const adapterSource = readFileSync(adapterPath, "utf8");
const checksSource = readFileSync(checksPath, "utf8");
for (const closedCheckId of BUCKET1_RUNTIME_CHECK_IDS) {
  assert.equal(checksSource.includes('"' + closedCheckId + '"'), true);
}
assert.match(adapterSource, /serviceWorkers: "block"/);
assert.match(adapterSource, /reducedMotion: "reduce"/);
assert.match(adapterSource, /route\.abort\("blockedbyclient"\)/);
assert.match(adapterSource, /document\.fonts\?\.ready/);
assert.match(adapterSource, /waitForStableLayout/);
assert.match(adapterSource, /AbortSignal\.timeout\(contract\.totalTimeoutMs\)/);
assert.match(adapterSource, /AbortSignal\.any\(\[parentSignal, timeoutSignal\]\)/);
assert.match(adapterSource, /input\.candidateSource/);
assert.doesNotMatch(adapterSource, /screenshot\s*\(/);

const sha = "a".repeat(64);
const input = {
  generationContractEpoch: 1,
  contextHash: sha,
  candidateRevision: "runtime-verifier",
  candidateConfigHash: sha,
  candidateSource:
    'export default function Site(props: SiteProps) { return <main><section id="home" data-site-section="home"><h1>{props.businessName}</h1></section></main>; }',
  manifest: { slots: [] },
  attachments: [],
  operationalPlan: { anchors: ["home"] },
  hostProps: {
    businessName: "Runtime verifier",
    licenseNumber: "",
    trade: "",
    city: "",
    services: [],
    primaryColor: "#1e3a5f",
    theme: "light",
    lookAndFeel: "clean",
    logoUrl: null,
    media: [],
    mediaSlots: {},
    reviews: [],
    trustMarkers: [],
    sections: [],
    phone: null,
    address: null,
    hours: null,
    warranty: null,
    leadFields: [],
    contactHidden: true,
    enableMotion: false,
    canSubmitLead: false,
    conversionAsk: null,
  },
  compilePolicy: {
    kitScope: "unified",
    generatorSchemaVersion: 4,
    contactHidden: true,
    operationalAnchors: [{ slug: "home" }],
  },
  resources: [],
};
const bound = bindBucket1ValidationInput(input);
assert.equal(bound.ok, true);

const availability = await inspectBucket1HeadlessRuntimeAvailability();
if (!availability.ok) {
  assert.equal(availability.cause, "browser_unavailable");
  assert.match(availability.detail, /revision 1187|Playwright package mismatch/);
  const observation = await createBucket1HeadlessRuntime().validate({
    input,
    binding: bound.binding,
    contract: BUCKET1_VALIDATION_CONTRACT,
  });
  assert.equal(observation.status, "infrastructure_failed");
  assert.equal(observation.cause, "browser_unavailable");
  console.log(
    "Bucket 1 runtime contract verified; production browser unavailable: " + availability.detail,
  );
} else {
  assert.equal(availability.packageVersion, "1.55.0");
  assert.equal(availability.browserRevision, "1187");
  assert.equal(availability.browserVersion, "140.0.7339.16");
  const observation = await createBucket1HeadlessRuntime().validate({
    input,
    binding: bound.binding,
    contract: BUCKET1_VALIDATION_CONTRACT,
  });
  assert.equal(observation.status, "completed");
  console.log("Bucket 1 runtime contract and installed Chromium validation verified.");
}
