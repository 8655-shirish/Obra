import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  parseSiteGenerationCheckpoint,
  postgresJsonbText,
  verifyPostgresJsonbTextFixtures,
} from "../src/lib/jobs/site-generation-checkpoint.ts";
import { normalizeDesignPreferences } from "../src/lib/agent/design-preferences.server.ts";

const input = {
  schemaVersion: 1,
  normalizerVersion: "bucket1-context-v1",
  generationKind: "initial",
  sourceVersionId: null,
  sourceRevision: null,
  sourceConfig: null,
  sourceMedia: [
    {
      slotId: "evidence-1",
      assetId: "a".repeat(64),
      mimeType: "image/jpeg",
      role: "proof",
      origin: "evidence",
      required: false,
      proofEligible: true,
      storagePath: "site/evidence/photo.jpg",
      sourceSlotId: null,
      posterSlotId: null,
    },
  ],
  onboarding: { contactHidden: false, nested: { b: 2, a: 1 } },
  enrichment: {},
  contactPolicy: {
    schemaVersion: 1,
    source: "websites.onboarding_state.contactHidden",
    sourcePresent: true,
    sourceValue: false,
    contactHidden: false,
    privacyClassification: "generation-private",
    privacySource: "server-generation-storage-policy-v1",
    capturedAtAcceptance: true,
  },
  instruction: "Build exactly this site",
  instructionByteLength: 23,
  requestPayloadHash: "b".repeat(64),
  priorIdentities: [],
  crossSiteLayoutIdentities: [],
} as const;
const canonical = postgresJsonbText(input);
const hash = createHash("sha256").update(canonical).digest("hex");
const checkpoint = {
  schemaVersion: 2,
  stage: "context",
  acceptedAt: "2026-08-28T12:00:00.000Z",
  inputHash: hash,
  inputSizeBytes: Buffer.byteLength(canonical),
  input,
};
verifyPostgresJsonbTextFixtures();
const parsed = parseSiteGenerationCheckpoint(checkpoint, {
  expectedGenerationInputSnapshot: input,
  expectedGenerationInputHash: hash,
});
assert.equal(postgresJsonbText(parsed.input), canonical);
assert.deepEqual(parsed.input, input);
assert.equal(parsed.input.sourceMedia[0]?.slotId, "evidence-1");
const regenerationInput = {
  ...input,
  generationKind: "regeneration" as const,
  sourceVersionId: "10000000-0000-4000-8000-000000000001",
  sourceRevision: 3,
  sourceConfig: {
    generatorSchemaVersion: 4,
    mediaManifest: {
      slots: [
        {
          slotId: "evidence-1",
          assetId: "a".repeat(64),
          origin: "evidence",
          role: "proof",
          proofEligible: true,
          mimeType: "image/jpeg",
          alt: "Completed work",
          storagePath: "site/evidence/photo.jpg",
          width: 1200,
          height: 800,
          required: false,
        },
      ],
    },
  },
};
const regenerationCanonical = postgresJsonbText(regenerationInput);
const regenerationParsed = parseSiteGenerationCheckpoint(
  {
    ...checkpoint,
    input: regenerationInput,
    inputHash: createHash("sha256").update(regenerationCanonical).digest("hex"),
    inputSizeBytes: Buffer.byteLength(regenerationCanonical),
  },
  { expectedGenerationInputSnapshot: regenerationInput },
);
assert.equal(postgresJsonbText(regenerationParsed.input), regenerationCanonical);
assert.deepEqual(regenerationParsed.input, regenerationInput);
assert.equal("width" in regenerationParsed.input.sourceMedia[0]!, false);
assert.equal("height" in regenerationParsed.input.sourceMedia[0]!, false);
assert.equal(parsed.input.contactPolicy.sourcePresent, true);
const preferences = normalizeDesignPreferences({
  instruction: input.instruction,
  frozenEvidence: input.sourceMedia,
});
const planning = parseSiteGenerationCheckpoint({
  ...checkpoint,
  stage: "planning",
  variantKey: "generation-checkpoint",
  designPreferences: preferences,
});
assert.equal(planning.designPreferences?.sourceInstructionSha256.length, 64);
const emptyPreferences = normalizeDesignPreferences({
  instruction: "",
  frozenEvidence: input.sourceMedia,
});
const planningEmpty = parseSiteGenerationCheckpoint({
  ...checkpoint,
  stage: "planning",
  variantKey: "generation-checkpoint",
  designPreferences: emptyPreferences,
});
assert.deepEqual(planningEmpty.designPreferences?.subjective.toneBrand, []);
assert.throws(
  () =>
    parseSiteGenerationCheckpoint({
      ...checkpoint,
      stage: "planning",
      variantKey: "generation-checkpoint",
    }),
  /stage designPreferences/,
);
const largeInput = {
  ...input,
  enrichment: {
    evidenceMarker: "preserve-complete-enrichment",
    padding: "x".repeat(2 * 1024 * 1024),
  },
};
const largeCanonical = postgresJsonbText(largeInput);
const largeHash = createHash("sha256").update(largeCanonical).digest("hex");
const largeBytes = Buffer.byteLength(largeCanonical, "utf8");
assert.ok(largeBytes > 2 * 1024 * 1024, "fixture must exceed former input and checkpoint limits");
const largeParsed = parseSiteGenerationCheckpoint(
  {
    ...checkpoint,
    input: largeInput,
    inputHash: largeHash,
    inputSizeBytes: largeBytes,
  },
  { expectedGenerationInputSnapshot: largeInput, expectedGenerationInputHash: largeHash },
);
assert.equal(largeParsed.input.enrichment.evidenceMarker, "preserve-complete-enrichment");
assert.equal(largeParsed.input.enrichment.padding, largeInput.enrichment.padding);
assert.equal(largeParsed.inputHash, largeHash);
assert.equal(largeParsed.inputSizeBytes, largeBytes);
assert.equal(postgresJsonbText(largeParsed.input), largeCanonical);
assert.throws(
  () =>
    parseSiteGenerationCheckpoint({
      ...checkpoint,
      input: largeInput,
      inputHash: largeHash,
      inputSizeBytes: largeBytes - 1,
    }),
  /inputSizeBytes mismatch/,
);
assert.throws(
  () =>
    parseSiteGenerationCheckpoint({
      ...checkpoint,
      input: largeInput,
      inputHash: "f".repeat(64),
      inputSizeBytes: largeBytes,
    }),
  /inputHash mismatch/,
);
assert.throws(
  () =>
    parseSiteGenerationCheckpoint({
      ...checkpoint,
      stage: "media",
      variantKey: "generation-checkpoint",
      designPreferences: preferences,
    }),
  /stage gachaLock/,
);
assert.throws(
  () =>
    parseSiteGenerationCheckpoint({
      ...checkpoint,
      stage: "media",
      variantKey: "generation-checkpoint",
      designPreferences: preferences,
      planCheckpoint: { evidenceAssetIdBySlot: {} },
    }),
  /checkpoint fields/,
);
const mediaLook = parseSiteGenerationCheckpoint({
  ...checkpoint,
  stage: "media",
  variantKey: "generation-checkpoint",
  designPreferences: preferences,
  gachaLock: {
    gachaId: "editorial-billboard-balanced",
    gachaVersion: 1,
    evidenceAssetIdBySlot: {},
  },
});
assert.equal(mediaLook.gachaLock?.gachaId, "editorial-billboard-balanced");
console.log("verify-bucket1-checkpoint-identity: ok");
