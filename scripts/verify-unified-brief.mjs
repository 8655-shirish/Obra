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

const briefMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/unified-design-brief.ts")).href
);
const recipesMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/unified-design-recipes.ts")).href
);
const {
  acceptUnifiedBrief,
  parseCurrentUnifiedGenerationCheckpoint,
  parseCurrentUnifiedPlan,
  parseStoredUnifiedPlan,
  parseUnifiedGenerationCheckpoint,
  parseVersionedUnifiedPlan,
} = briefMod;
const recipe = recipesMod.UNIFIED_DESIGN_RECIPES.find(
  (item) => item.id === "utilitarian-field-manual",
);
assert.ok(recipe);

const currentPlan = {
  planSchemaVersion: briefMod.CURRENT_UNIFIED_PLAN_SCHEMA_VERSION,
  operationalIntent: {
    mediaSlots: [],
    operationalAnchors: [{ slug: "contact", purposes: ["contact", "navigation"] }],
  },
  creativeBrief: {
    rationale: "Make the verified business information easy to find and act on.",
    mood: "Confident, clear, and grounded.",
    hierarchy: "Lead with identity and services, then make contact easy to reach.",
    mediaOpportunities: "Use authorized media only when it adds useful context.",
    responsiveBehavior: "Let the writer adapt composition while preserving operational anchors.",
  },
};
const currentCheckpoint = { plan: currentPlan, evidenceAssetIdBySlot: {} };
assert.deepEqual(parseCurrentUnifiedPlan(currentPlan), currentPlan);
assert.deepEqual(parseVersionedUnifiedPlan(currentPlan), currentPlan);
assert.deepEqual(parseCurrentUnifiedGenerationCheckpoint(currentCheckpoint), currentCheckpoint);
assert.equal(
  currentPlan.operationalIntent.mediaSlots.length,
  0,
  "current plans may contain zero media",
);

for (const forbidden of [
  ["recipeId", "utilitarian-field-manual"],
  ["heroTopology", "split hero"],
  ["sectionTopology", []],
  ["conversionPlacement", "contact-only"],
  ["divergenceTuple", {}],
]) {
  assert.throws(() => parseCurrentUnifiedPlan({ ...currentPlan, [forbidden[0]]: forbidden[1] }));
}
assert.throws(() =>
  parseCurrentUnifiedPlan({
    ...currentPlan,
    creativeBrief: { ...currentPlan.creativeBrief, recipe: "forbidden executable recipe" },
  }),
);
assert.throws(() =>
  parseCurrentUnifiedPlan({
    ...currentPlan,
    operationalIntent: { ...currentPlan.operationalIntent, unexpected: true },
  }),
);
assert.throws(() =>
  parseCurrentUnifiedPlan({
    ...currentPlan,
    operationalIntent: {
      mediaSlots: [
        {
          slotId: "support-evidence",
          role: "support",
          required: false,
          sourcePreference: "evidence",
          aspectRatio: "square",
          cropGuidance: "Preserve the subject.",
          textOverlayAllowed: false,
          proofEligibleRequired: true,
        },
      ],
      operationalAnchors: [],
    },
  }),
);
assert.throws(() =>
  parseCurrentUnifiedPlan({
    ...currentPlan,
    operationalIntent: {
      ...currentPlan.operationalIntent,
      operationalAnchors: [
        { slug: "services", purposes: ["navigation"] },
        { slug: "services", purposes: ["host-operation"] },
      ],
    },
  }),
);
assert.throws(() =>
  parseCurrentUnifiedPlan({
    ...currentPlan,
    operationalIntent: {
      ...currentPlan.operationalIntent,
      operationalAnchors: [{ slug: "services", purposes: ["navigation", "navigation"] }],
    },
  }),
);
assert.throws(() =>
  parseCurrentUnifiedPlan({
    ...currentPlan,
    operationalIntent: {
      mediaSlots: [
        {
          slotId: "project-proof",
          role: "proof",
          required: false,
          sourcePreference: "generated",
          aspectRatio: "landscape",
          cropGuidance: "Preserve the subject.",
          textOverlayAllowed: false,
          proofEligibleRequired: false,
          generationPrompt: "Invented project proof is not allowed.",
        },
      ],
      operationalAnchors: [],
    },
  }),
);
assert.throws(() =>
  parseCurrentUnifiedPlan({
    ...currentPlan,
    operationalIntent: {
      mediaSlots: [
        {
          slotId: "hero-one",
          role: "hero",
          required: false,
          sourcePreference: "generated",
          aspectRatio: "wide",
          cropGuidance: "Preserve useful negative space.",
          textOverlayAllowed: true,
          proofEligibleRequired: false,
          generationPrompt: "A generic authorized atmosphere image.",
        },
        {
          slotId: "hero-one",
          role: "support",
          required: false,
          sourcePreference: "evidence",
          aspectRatio: "square",
          cropGuidance: "Preserve the subject.",
          textOverlayAllowed: false,
          proofEligibleRequired: false,
        },
      ],
      operationalAnchors: [],
    },
  }),
);

const boundCurrentPlan = {
  ...currentPlan,
  operationalIntent: {
    mediaSlots: [
      {
        slotId: "project-proof",
        role: "proof",
        required: true,
        sourcePreference: "evidence",
        aspectRatio: "landscape",
        cropGuidance: "Preserve the documented work.",
        textOverlayAllowed: false,
        proofEligibleRequired: true,
        anchorSlug: "project-proof",
      },
    ],
    operationalAnchors: [{ slug: "project-proof", purposes: ["media"] }],
  },
};
assert.deepEqual(
  parseCurrentUnifiedGenerationCheckpoint({
    plan: boundCurrentPlan,
    evidenceAssetIdBySlot: { "project-proof": "asset-proof-1" },
  }).plan,
  boundCurrentPlan,
);
assert.throws(() =>
  parseCurrentUnifiedGenerationCheckpoint({ plan: boundCurrentPlan, evidenceAssetIdBySlot: {} }),
);
assert.throws(() =>
  parseCurrentUnifiedGenerationCheckpoint({
    plan: boundCurrentPlan,
    evidenceAssetIdBySlot: { unknown: "asset-proof-1" },
  }),
);

const naturalPlan = {
  planSchemaVersion: briefMod.UNIFIED_PLAN_SCHEMA_VERSION,
  recipeId: recipe.id,
  recipeVersion: recipe.version,
  heroTopology: "split utility hero with immediate phone access",
  sectionTopology: [
    { section: "services", shape: "compact service index" },
    { section: "hero", shape: "split utility hero" },
    { section: "contact", shape: "direct contact block" },
  ],
  responsiveIntent: "stack into one scan path while keeping phone and quote actions early",
  conversionPlacement: "direct contact block after the service index",
  mediaSlots: [
    {
      slotId: "hero-atmosphere",
      role: "hero",
      section: "hero",
      sourcePreference: "generated",
      aspectRatio: "wide",
      cropGuidance: "keep the working area clear behind the headline",
      textOverlayAllowed: true,
      proofEligibleRequired: false,
      generationPrompt:
        "functional workshop atmosphere without people, logos, text, or project claims",
      mobileTreatment: "use a tighter crop while keeping the focal area unobstructed",
      required: true,
    },
    {
      slotId: "service-support",
      role: "support",
      section: "services",
      sourcePreference: "either",
      aspectRatio: "landscape",
      cropGuidance: "show useful trade texture with room for adjacent copy",
      textOverlayAllowed: false,
      proofEligibleRequired: false,
      generationPrompt:
        "quiet trade-detail atmosphere without people, logos, text, or project claims",
      mobileTreatment: "place above the service list at natural aspect ratio",
      required: true,
    },
  ],
};
const checkpoint = {
  brief: naturalPlan,
  evidenceAssetIdBySlot: { "hero-atmosphere": "asset-1" },
};
assert.deepEqual(parseUnifiedGenerationCheckpoint(checkpoint), checkpoint);
assert.throws(
  () => parseUnifiedGenerationCheckpoint(naturalPlan),
  (error) =>
    error instanceof Error &&
    error.message === briefMod.INVALID_UNIFIED_GENERATION_CHECKPOINT_ERROR,
);
assert.throws(
  () =>
    parseUnifiedGenerationCheckpoint({
      ...naturalPlan,
      brief: naturalPlan,
      evidenceAssetIdBySlot: { "hero-atmosphere": 42 },
    }),
  (error) =>
    error instanceof Error &&
    error.message === briefMod.INVALID_UNIFIED_GENERATION_CHECKPOINT_ERROR,
);
assert.throws(() =>
  parseUnifiedGenerationCheckpoint({
    ...checkpoint,
    brief: { ...naturalPlan, unexpected: true },
  }),
);
assert.throws(() =>
  parseUnifiedGenerationCheckpoint({
    ...checkpoint,
    evidenceAssetIdBySlot: { "hero-atmosphere": "" },
  }),
);
assert.throws(() =>
  parseUnifiedGenerationCheckpoint({
    ...checkpoint,
    evidenceAssetIdBySlot: { "": "asset-1" },
  }),
);
assert.throws(
  () =>
    parseUnifiedGenerationCheckpoint({
      brief: { recipeId: recipe.id },
      evidenceAssetIdBySlot: {},
    }),
  (error) =>
    error instanceof Error &&
    error.message === briefMod.INVALID_UNIFIED_GENERATION_CHECKPOINT_ERROR,
);

const options = { candidates: [recipe], contactHidden: false };
const direct = acceptUnifiedBrief(naturalPlan, options);
assert.equal(direct.success, true, "natural top-level plan should be accepted");
assert.deepEqual(
  parseVersionedUnifiedPlan(naturalPlan),
  naturalPlan,
  "v2 dispatch must remain readable",
);
assert.deepEqual(
  parseStoredUnifiedPlan({
    generator: "unified-site-agent",
    generatorSchemaVersion: briefMod.UNIFIED_GENERATOR_SCHEMA_VERSION,
    unifiedBrief: direct.brief,
    divergenceTuple: direct.divergenceTuple,
  }),
  { brief: direct.brief, divergenceTuple: direct.divergenceTuple },
  "StoredUnifiedPlan v2 readers must remain unchanged",
);
assert.equal(
  parseStoredUnifiedPlan({
    generator: "unified-site-agent",
    generatorSchemaVersion: briefMod.UNIFIED_GENERATOR_SCHEMA_VERSION,
    unifiedBrief: currentPlan,
    divergenceTuple: {},
  }),
  null,
  "the historical StoredUnifiedPlan reader must not reinterpret v3",
);
const annotated = acceptUnifiedBrief(
  {
    ...naturalPlan,
    rationale: "This explanation is harmless planner metadata.",
    sectionTopology: naturalPlan.sectionTopology.map((section) => ({
      ...section,
      reason: "creative explanation",
    })),
    mediaSlots: naturalPlan.mediaSlots.map((slot) => ({ ...slot, reason: "placement rationale" })),
  },
  options,
);
assert.equal(annotated.success, true, "harmless planner metadata should be ignored");
assert.equal("rationale" in annotated.brief, false, "ignored metadata must not persist");
const hiddenOptions = { candidates: [recipe], contactHidden: true };
const hiddenContact = acceptUnifiedBrief(
  {
    ...naturalPlan,
    conversionPlacement: "no contact actions or lead form",
    sectionTopology: [
      ...naturalPlan.sectionTopology.filter((x) => x.section !== "contact"),
      { section: "footer", shape: "compact utility footer" },
    ],
  },
  hiddenOptions,
);
assert.equal(hiddenContact.success, true, "hidden-contact plan should omit the contact section");
const hiddenContactSlot = acceptUnifiedBrief(
  {
    ...hiddenContact.brief,
    mediaSlots: hiddenContact.brief.mediaSlots.map((slot, index) =>
      index === 0 ? { ...slot, section: "contact" } : slot,
    ),
  },
  hiddenOptions,
);
assert.equal(hiddenContactSlot.success, false);
assert.match(hiddenContactSlot.error, /references absent section contact/);

const rephrased = {
  ...naturalPlan,
  heroTopology: "a utility split lead with the phone action immediately available",
  conversionPlacement: "put the direct enquiry block after services",
  sectionTopology: naturalPlan.sectionTopology.map((section) => ({
    ...section,
    shape: "reworded " + section.shape,
  })),
};
const rephrasedResult = acceptUnifiedBrief(rephrased, {
  ...options,
  priorPlans: [{ brief: direct.brief, divergenceTuple: direct.divergenceTuple }],
});
assert.equal(rephrasedResult.success, false, "rephrasing one layout must not count as divergence");
assert.match(rephrasedResult.error, /only [012] planning axes/);
const materiallyDifferent = {
  ...naturalPlan,
  heroTopology: "centered type-led masthead with a narrow portrait media rail",
  sectionTopology: [
    { section: "hero", shape: "centered editorial masthead" },
    { section: "reviews", shape: "horizontal testimonial ribbon" },
    { section: "contact", shape: "full-width closing panel" },
  ],
  responsiveIntent: "preserve the editorial rhythm and move the media rail below the title",
  conversionPlacement: "repeat a compact action in the masthead and closing panel",
  mediaSlots: naturalPlan.mediaSlots.map((slot, index) => ({
    ...slot,
    section: index === 0 ? "hero" : "reviews",
    aspectRatio: index === 0 ? "portrait" : "square",
    mobileTreatment: "contain beneath the related copy",
  })),
};
const materiallyDifferentResult = acceptUnifiedBrief(materiallyDifferent, {
  ...options,
  priorPlans: [{ brief: direct.brief, divergenceTuple: direct.divergenceTuple }],
});
assert.equal(
  materiallyDifferentResult.success,
  true,
  "materially different natural composition should satisfy divergence",
);

const legacyPlan = {
  ...naturalPlan,
  planSchemaVersion: 1,
  heroTopology: "split-media",
  responsiveIntent: "linearize",
  conversionPlacement: "hero-and-contact",
  sectionTopology: naturalPlan.sectionTopology.map((item) => ({ ...item, shape: "stack" })),
  mediaSlots: naturalPlan.mediaSlots.map((item) => ({ ...item, mobileTreatment: "crop" })),
};
const legacyAccepted = acceptUnifiedBrief(legacyPlan, options);
assert.equal(legacyAccepted.success, true, "persisted v1 plans must remain readable");
assert.deepEqual(
  parseVersionedUnifiedPlan(legacyPlan),
  legacyPlan,
  "v1 dispatch must remain readable",
);
assert.deepEqual(
  parseStoredUnifiedPlan({
    generator: "unified-site-agent",
    generatorSchemaVersion: briefMod.UNIFIED_GENERATOR_SCHEMA_VERSION,
    unifiedBrief: legacyAccepted.brief,
    divergenceTuple: legacyAccepted.divergenceTuple,
  }),
  { brief: legacyAccepted.brief, divergenceTuple: legacyAccepted.divergenceTuple },
  "StoredUnifiedPlan v1 readers must remain unchanged",
);
assert.equal(
  acceptUnifiedBrief({ ...naturalPlan, planSchemaVersion: 1 }, options).success,
  false,
  "v2 creative prose must not masquerade as a legacy v1 plan",
);
const hiddenLegacy = acceptUnifiedBrief(
  {
    ...legacyPlan,
    conversionPlacement: "hidden",
    sectionTopology: [
      ...legacyPlan.sectionTopology.filter((item) => item.section !== "contact"),
      { section: "footer", shape: "stack" },
    ],
  },
  hiddenOptions,
);
assert.equal(hiddenLegacy.success, true, "historical hidden-contact v1 plans remain readable");
assert.equal(hiddenLegacy.brief.conversionPlacement, "hidden");
assert.notDeepEqual(
  legacyAccepted.divergenceTuple,
  direct.divergenceTuple,
  "legacy persisted tuple semantics must remain versioned",
);
const legacyAsV2 = {
  ...legacyAccepted.brief,
  planSchemaVersion: briefMod.UNIFIED_PLAN_SCHEMA_VERSION,
};
const sameAsLegacy = acceptUnifiedBrief(legacyAsV2, {
  ...options,
  priorPlans: [{ brief: legacyAccepted.brief, divergenceTuple: legacyAccepted.divergenceTuple }],
});
assert.equal(sameAsLegacy.success, false, "schema-version changes must not create fake divergence");
const topLevelWithObjectAnnotation = acceptUnifiedBrief(
  { ...naturalPlan, unifiedBrief: { note: "harmless planner metadata" } },
  options,
);
assert.equal(
  topLevelWithObjectAnnotation.success,
  true,
  "an object-valued annotation must not hide a complete top-level plan",
);
const topLevelWithNullWrapper = acceptUnifiedBrief({ ...naturalPlan, unifiedBrief: null }, options);
assert.equal(
  topLevelWithNullWrapper.success,
  true,
  "a stray null wrapper key must not hide a complete top-level plan",
);

const wrapped = acceptUnifiedBrief({ unifiedBrief: naturalPlan }, options);
assert.equal(wrapped.success, true, "historical wrapped plan should remain accepted");
const evidenceSlot = {
  ...naturalPlan.mediaSlots[1],
  slotId: "project-proof",
  role: "proof",
  sourcePreference: "evidence",
  proofEligibleRequired: true,
  generationPrompt: undefined,
};
const overEvidenceCapacity = acceptUnifiedBrief(
  { ...naturalPlan, mediaSlots: [naturalPlan.mediaSlots[0], evidenceSlot] },
  { ...options, evidenceStillCount: 0 },
);
assert.equal(overEvidenceCapacity.success, false);
assert.match(overEvidenceCapacity.error, /^evidence_capacity_exceeded:/);
const exactEvidenceCapacity = acceptUnifiedBrief(
  { ...naturalPlan, mediaSlots: [naturalPlan.mediaSlots[0], evidenceSlot] },
  { ...options, evidenceStillCount: 1 },
);
assert.equal(
  exactEvidenceCapacity.success,
  true,
  "an exact authoritative evidence capacity must be accepted",
);
assert.equal(exactEvidenceCapacity.brief.mediaSlots[1].sourcePreference, "evidence");

const eitherSlot = {
  ...naturalPlan.mediaSlots[1],
  slotId: "flexible-atmosphere",
  sourcePreference: "either",
};
const noEvidenceFallback = acceptUnifiedBrief(
  { ...naturalPlan, mediaSlots: [naturalPlan.mediaSlots[0], eitherSlot] },
  { ...options, evidenceStillCount: 0 },
);
assert.equal(noEvidenceFallback.success, true);
assert.equal(noEvidenceFallback.brief.mediaSlots[1].sourcePreference, "generated");

const requiredEvidenceAfterOptional = acceptUnifiedBrief(
  {
    ...naturalPlan,
    mediaSlots: [
      {
        ...naturalPlan.mediaSlots[1],
        slotId: "optional-proof",
        sourcePreference: "evidence",
        required: false,
      },
      {
        ...naturalPlan.mediaSlots[1],
        slotId: "required-proof",
        sourcePreference: "evidence",
        required: true,
      },
      {
        ...naturalPlan.mediaSlots[0],
        slotId: "generated-hero",
        sourcePreference: "generated",
        required: true,
      },
    ],
  },
  { ...options, evidenceStillCount: 1 },
);
assert.equal(requiredEvidenceAfterOptional.success, true);
if (requiredEvidenceAfterOptional.success) {
  assert.equal(
    requiredEvidenceAfterOptional.effectiveSourceBySlot.get("required-proof"),
    "evidence",
  );
  assert.equal(requiredEvidenceAfterOptional.effectiveSourceBySlot.has("optional-proof"), false);
}

const missingHero = acceptUnifiedBrief(
  {
    ...naturalPlan,
    sectionTopology: [
      { section: "services", shape: "compact service index" },
      { section: "reviews", shape: "plain review ledger" },
      { section: "contact", shape: "direct contact block" },
    ],
  },
  options,
);
assert.equal(missingHero.success, false);
assert.match(missingHero.error, /include hero/);
const missingPlan = acceptUnifiedBrief(undefined, options);
assert.equal(missingPlan.success, false);
assert.match(missingPlan.error, /^plan: Required/);

const promptMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/unified-site-agent.prompt.ts")).href
);
const planPrompt = promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT;
const expectedPlanVocabulary = `planSchemaVersion: ${briefMod.CURRENT_UNIFIED_PLAN_SCHEMA_VERSION}; role: ${briefMod.UNIFIED_MEDIA_ROLES.join(" | ")}; sourcePreference: ${briefMod.UNIFIED_MEDIA_SOURCES.join(" | ")}; aspectRatio: ${briefMod.UNIFIED_ASPECT_RATIOS.join(" | ")}; purposes: ${briefMod.UNIFIED_OPERATIONAL_ANCHOR_PURPOSES.join(" | ")}`;
assert.ok(
  planPrompt.includes(expectedPlanVocabulary),
  "plan prompt machine vocabulary must interpolate the current parser enums",
);
assert.match(
  planPrompt,
  /generationPrompt is required when sourcePreference is generated or either/,
);
assert.match(planPrompt, /must be omitted when sourcePreference is evidence/);
assert.doesNotMatch(
  planPrompt,
  /generationPrompt\?/,
  "plan prompt must not mark generationPrompt optional when the parser requires it",
);
assert.doesNotMatch(
  planPrompt,
  /proofEligibleRequired,generationPrompt/,
  "plan prompt must not list generationPrompt as present on every slot",
);
assert.doesNotMatch(
  planPrompt,
  /Visual, or host operations/,
  "plan prompt must not use prose purpose labels the parser will reject",
);

console.log("verify-unified-brief: ok");
