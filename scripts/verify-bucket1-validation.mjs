import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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

const contractMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-validation/bucket1-contract.ts")).href
);
const validationMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-validation/bucket1-validation.server.ts")).href
);
const { BUCKET1_RUNTIME_CHECK_IDS, BUCKET1_VALIDATION_CONTRACT, BUCKET1_VIEWPORT_MATRIX } =
  contractMod;
const {
  bindBucket1ValidationInput,
  bucket1CandidateConfigHash,
  bucket1CandidateConfigProjection,
  bucket1CanonicalHash,
  validateBucket1Candidate,
  verifyBucket1ValidationAttestation,
} = validationMod;

const SOURCE = `export default function Site(props: SiteProps) {
  return <main><section id="home" data-site-section="home" className="min-h-screen p-8"><h1 className="text-4xl font-bold">{props.businessName}</h1></section></main>;
}`;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SIGNER = {
  keyId: "bucket1-test-key",
  secret: "test-only-secret-that-is-at-least-thirty-two-bytes",
};
const baseInput = () => ({
  generationContractEpoch: 7,
  contextHash: SHA_A,
  candidateRevision: "candidate-1",
  candidateConfigHash: SHA_B,
  candidateSource: SOURCE,
  manifest: { slots: [] },
  attachments: [
    { assetId: "asset-b", contentHash: SHA_B, mimeType: "image/webp", byteSize: 4 },
    { assetId: "asset-c", contentHash: SHA_C, mimeType: "image/webp", byteSize: 8 },
  ],
  operationalPlan: { navigation: [{ label: "Home", href: "#home" }], conversion: "quote" },
  hostProps: { businessName: "Example", canSubmitLead: false },
  compilePolicy: {
    kitScope: "unified",
    generatorSchemaVersion: 4,
    contactHidden: true,
    operationalAnchors: [{ slug: "home" }],
  },
  resources: [
    { logicalId: "hero", contentHash: SHA_B, mimeType: "image/webp", byteSize: 4, kind: "image" },
    { logicalId: "proof", contentHash: SHA_C, mimeType: "image/webp", byteSize: 8, kind: "image" },
  ],
});

assert.equal(BUCKET1_VALIDATION_CONTRACT.schemaVersion, 1);
assert.equal(BUCKET1_VALIDATION_CONTRACT.runtime.hostDocument, "/site-runtime/host.html");
assert.equal(BUCKET1_VALIDATION_CONTRACT.resources.network, "fulfill-bound-resources-only");
assert.deepEqual(BUCKET1_VALIDATION_CONTRACT.resources.allowedSchemes, ["data", "blob"]);
assert.equal(BUCKET1_VALIDATION_CONTRACT.tolerances.minimumNormalTextContrast, 4.5);
assert.equal(
  BUCKET1_VALIDATION_CONTRACT.intentionalExceptions.mediaCrop,
  "object-cover-inside-data-site-media-only",
);
assert.ok(BUCKET1_RUNTIME_CHECK_IDS.includes("contrast"));
assert.ok(BUCKET1_VIEWPORT_MATRIX.some((entry) => entry.id === "desktop-1440"));
assert.ok(BUCKET1_VIEWPORT_MATRIX.some((entry) => entry.id === "mobile-landscape"));
assert.ok(BUCKET1_VIEWPORT_MATRIX.some((entry) => entry.textScale > 1));
for (const breakpoint of [
  [639, 641],
  [767, 769],
  [1023, 1025],
  [1279, 1281],
  [1535, 1537],
]) {
  assert.ok(BUCKET1_VIEWPORT_MATRIX.some((entry) => entry.width === breakpoint[0]));
  assert.ok(BUCKET1_VIEWPORT_MATRIX.some((entry) => entry.width === breakpoint[1]));
}

assert.equal(
  bucket1CanonicalHash({ z: 1, a: [2, { y: true, x: null }] }),
  bucket1CanonicalHash({ a: [2, { x: null, y: true }], z: 1 }),
);
const candidateConfig = {
  generatorSchemaVersion: 4,
  themeSource: SOURCE,
  nested: { keep: true },
  bucket1ValidationInput: { candidateConfigHash: SHA_A },
  bucket1ValidationAttestation: { binding: { candidateConfigHash: SHA_B } },
  validationAttestation: { binding: { candidateConfigHash: SHA_C } },
};
assert.deepEqual(bucket1CandidateConfigProjection(candidateConfig), {
  generatorSchemaVersion: 4,
  themeSource: SOURCE,
  nested: { keep: true },
});
assert.equal(
  bucket1CandidateConfigHash(candidateConfig),
  bucket1CandidateConfigHash({
    nested: { keep: true },
    themeSource: SOURCE,
    generatorSchemaVersion: 4,
    bucket1ValidationInput: { changed: true },
  }),
  "validation self-references must not affect the candidate config hash",
);
assert.notEqual(
  bucket1CandidateConfigHash(candidateConfig),
  bucket1CandidateConfigHash({ ...candidateConfig, persistedExtra: true }),
  "every non-validation persisted config field must affect the candidate config hash",
);
assert.deepEqual(
  bucket1CandidateConfigProjection({
    keep: true,
    omitted: undefined,
    normalizedArray: [undefined, Number.NaN, -0],
  }),
  { keep: true, normalizedArray: [null, null, 0] },
  "the projection must match JSON/jsonb persistence normalization",
);
const firstBinding = bindBucket1ValidationInput(baseInput());
assert.equal(firstBinding.ok, true);
const reordered = baseInput();
reordered.attachments.reverse();
reordered.resources.reverse();
const reorderedBinding = bindBucket1ValidationInput(reordered);
assert.equal(reorderedBinding.ok, true);
assert.equal(
  firstBinding.binding.candidateBindingHash,
  reorderedBinding.binding.candidateBindingHash,
);

for (const mutation of [
  (input) => {
    input.candidateConfigHash = SHA_C;
  },
  (input) => {
    input.candidateSource += "\\n// changed";
  },
  (input) => {
    input.manifest = { slots: [{ slotId: "changed" }] };
  },
  (input) => {
    input.operationalPlan = { anchors: ["contact"] };
  },
  (input) => {
    input.hostProps = { businessName: "Changed" };
  },
  (input) => {
    input.compilePolicy.contactHidden = false;
  },
  (input) => {
    input.attachments[0].contentHash = SHA_A;
    input.resources[0].contentHash = SHA_A;
  },
]) {
  const changed = baseInput();
  mutation(changed);
  const bound = bindBucket1ValidationInput(changed);
  assert.equal(bound.ok, true);
  assert.notEqual(bound.binding.candidateBindingHash, firstBinding.binding.candidateBindingHash);
}

const unattachedResource = baseInput();
unattachedResource.resources[0].contentHash = SHA_A;
const unattachedResult = bindBucket1ValidationInput(unattachedResource);
assert.equal(unattachedResult.ok, false);
assert.equal(unattachedResult.defects[0].cause, "resource_contract");

const unknown = baseInput();
unknown.surprise = true;
const unknownResult = bindBucket1ValidationInput(unknown);
assert.equal(unknownResult.ok, false);
assert.equal(unknownResult.defects[0].id, "static:input-envelope");

const badConfigHash = baseInput();
badConfigHash.candidateConfigHash = "not-a-hash";
const badConfigHashResult = bindBucket1ValidationInput(badConfigHash);
assert.equal(badConfigHashResult.ok, false);
assert.equal(badConfigHashResult.defects[0].id, "static:candidate-config-hash");

const badSource = baseInput();
badSource.candidateSource = "export default function Site() { return <iframe />; }";
const staticFailure = await validateBucket1Candidate({ input: badSource });
assert.equal(staticFailure.outcome, "candidate_failed");
assert.equal(staticFailure.static.status, "failed");
assert.equal(staticFailure.runtime.status, "not_run");
assert.equal(staticFailure.static.defects[0].classification, "candidate");
assert.equal(staticFailure.static.defects[0].disposition, "writer_repair");

const noBrowser = await validateBucket1Candidate({ input: baseInput() });
assert.equal(noBrowser.outcome, "infrastructure_failed");
assert.equal(noBrowser.static.status, "passed");
assert.equal(noBrowser.runtime.status, "infrastructure_failed");
assert.equal(noBrowser.runtime.evidenceKind, "none");
assert.equal(noBrowser.runtime.evidenceHash, null);
assert.deepEqual(noBrowser.runtime.completedViewportIds, []);
assert.equal(noBrowser.runtime.defects[0].cause, "browser_unavailable");
assert.equal(noBrowser.runtime.defects[0].disposition, "infrastructure_retry");
assert.match(
  noBrowser.runtime.defects[0].observed,
  /No server-owned headless runtime adapter was supplied/i,
);

const alreadyAborted = new AbortController();
alreadyAborted.abort(new DOMException("invocation deadline", "AbortError"));
let externalRuntimeCalls = 0;
await assert.rejects(
  validateBucket1Candidate({
    input: baseInput(),
    signal: alreadyAborted.signal,
    runtime: {
      async validate() {
        externalRuntimeCalls += 1;
        throw new Error("external runtime must not start");
      },
    },
  }),
  (error) => error instanceof Error && error.name === "AbortError",
  "an already-aborted invocation must propagate AbortError",
);
assert.equal(externalRuntimeCalls, 0, "an already-aborted invocation must prevent external work");

const fakeAttestation = {
  schemaVersion: 1,
  kind: "bucket1-validation-attestation",
  binding: firstBinding.binding,
  runtimeEvidenceHash: SHA_A,
  issuedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-01T00:01:00.000Z",
  issuerKeyId: SIGNER.keyId,
  attestationHash: SHA_A,
  signature: SHA_A,
};
const forged = verifyBucket1ValidationAttestation({
  input: baseInput(),
  attestation: fakeAttestation,
  signer: SIGNER,
  now: new Date("2026-01-01T00:00:30.000Z"),
});
assert.equal(forged.ok, false);
assert.equal(forged.defects[0].cause, "attestation_contract");

function signedAttestation(input = baseInput()) {
  const bound = bindBucket1ValidationInput(input);
  assert.equal(bound.ok, true);
  const unsigned = {
    schemaVersion: 1,
    kind: "bucket1-validation-attestation",
    binding: bound.binding,
    runtimeEvidenceHash: SHA_A,
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
    issuerKeyId: SIGNER.keyId,
  };
  const attestationHash = bucket1CanonicalHash(unsigned);
  const signature = createHmac("sha256", SIGNER.secret).update(attestationHash).digest("hex");
  return { ...unsigned, attestationHash, signature };
}
const signed = signedAttestation();
const openBinding = structuredClone(signed);
openBinding.binding.surprise = true;
const openBindingHash = bucket1CanonicalHash({
  schemaVersion: openBinding.schemaVersion,
  kind: openBinding.kind,
  binding: openBinding.binding,
  runtimeEvidenceHash: openBinding.runtimeEvidenceHash,
  issuedAt: openBinding.issuedAt,
  expiresAt: openBinding.expiresAt,
  issuerKeyId: openBinding.issuerKeyId,
});
openBinding.attestationHash = openBindingHash;
openBinding.signature = createHmac("sha256", SIGNER.secret).update(openBindingHash).digest("hex");
const openBindingResult = verifyBucket1ValidationAttestation({
  input: baseInput(),
  attestation: openBinding,
  signer: SIGNER,
  now: new Date("2026-01-01T00:00:30.000Z"),
});
assert.equal(openBindingResult.ok, false);
assert.equal(openBindingResult.defects[0].cause, "attestation_contract");

assert.equal(
  verifyBucket1ValidationAttestation({
    input: baseInput(),
    attestation: signed,
    signer: SIGNER,
    now: new Date("2026-01-01T00:00:30.000Z"),
  }).ok,
  true,
);
const unsafeAfterAttestation = baseInput();
unsafeAfterAttestation.candidateSource = "export default function Site() { return <iframe />; }";
const cheapFailure = verifyBucket1ValidationAttestation({
  input: unsafeAfterAttestation,
  attestation: signed,
  signer: SIGNER,
  now: new Date("2026-01-01T00:00:30.000Z"),
});
assert.equal(cheapFailure.ok, false);
assert.equal(cheapFailure.defects[0].cause, "static_compile");

for (const bindingField of [
  "candidateRevision",
  "candidateConfigHash",
  "sourceHash",
  "manifestHash",
  "operationalPlanHash",
  "hostPropsHash",
  "hostContractHash",
  "validationContractHash",
]) {
  const changed = structuredClone(signed);
  changed.binding[bindingField] = SHA_C;
  const attestationHash = bucket1CanonicalHash({
    schemaVersion: changed.schemaVersion,
    kind: changed.kind,
    binding: changed.binding,
    runtimeEvidenceHash: changed.runtimeEvidenceHash,
    issuedAt: changed.issuedAt,
    expiresAt: changed.expiresAt,
    issuerKeyId: changed.issuerKeyId,
  });
  changed.attestationHash = attestationHash;
  changed.signature = createHmac("sha256", SIGNER.secret).update(attestationHash).digest("hex");
  const mismatch = verifyBucket1ValidationAttestation({
    input: baseInput(),
    attestation: changed,
    signer: SIGNER,
    now: new Date("2026-01-01T00:00:30.000Z"),
  });
  assert.equal(mismatch.ok, false, `must reject changed ${bindingField}`);
  assert.equal(mismatch.defects[0].cause, "attestation_binding_mismatch");
}

console.log("Bucket 1 validation contract verifier passed; browser evidence remains unavailable.");
