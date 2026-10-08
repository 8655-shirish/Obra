import { z } from "zod";
import { unifiedRecipeById, type UnifiedRecipe } from "./unified-design-recipes.ts";

export const UNIFIED_GENERATOR_SCHEMA_VERSION = 3 as const;
export const SUPPORTED_UNIFIED_GENERATOR_SCHEMA_VERSIONS = [2, 3] as const;
export const HISTORICAL_UNIFIED_PLAN_SCHEMA_VERSION = 2 as const;
/** Compatibility alias for the existing v2 planner, which this schema-only slice does not rewire. */
export const UNIFIED_PLAN_SCHEMA_VERSION = HISTORICAL_UNIFIED_PLAN_SCHEMA_VERSION;
const LEGACY_UNIFIED_PLAN_SCHEMA_VERSION = 1 as const;
export const CURRENT_UNIFIED_PLAN_SCHEMA_VERSION = 3 as const;
export const MIN_DIVERGENCE_AXES = 3;

const boundedText = z.string().trim().min(1).max(80);
const creativeText = z.string().trim().min(1).max(240);
export const UNIFIED_SECTION_TYPES = [
  "hero",
  "trustmarkers",
  "services",
  "beforeAfter",
  "reviews",
  "warranty",
  "hours",
  "contact",
  "footer",
] as const;
export const UNIFIED_MEDIA_ROLES = [
  "hero",
  "proof",
  "support",
  "atmosphere",
  "texture",
  "motion-poster",
] as const;
export const UNIFIED_MEDIA_SOURCES = ["evidence", "generated", "either"] as const;
export const UNIFIED_ASPECT_RATIOS = ["wide", "landscape", "square", "portrait"] as const;
const sectionTypeSchema = z.enum(UNIFIED_SECTION_TYPES);
const LEGACY_HERO_TOPOLOGIES = new Set([
  "media-overlay",
  "split-media",
  "stacked-media",
  "gallery-led",
  "type-led",
]);
const LEGACY_SECTION_SHAPES = new Set([
  "overlay",
  "split",
  "stack",
  "ledger",
  "index",
  "gallery",
  "staggered",
  "narrative",
  "rail",
  "panel",
]);
const LEGACY_RESPONSIVE_INTENTS = new Set([
  "linearize",
  "media-first",
  "copy-first",
  "preserve-priority",
]);
const LEGACY_CONVERSION_PLACEMENTS = new Set([
  "hero-and-contact",
  "sticky-and-contact",
  "inline-and-contact",
  "contact-only",
  "hidden",
]);
const LEGACY_MOBILE_TREATMENTS = new Set(["full-width", "crop", "contain", "hide-decorative"]);
export const unifiedBriefSchema = z
  .object({
    planSchemaVersion: z.union([
      z.literal(LEGACY_UNIFIED_PLAN_SCHEMA_VERSION),
      z.literal(UNIFIED_PLAN_SCHEMA_VERSION),
    ]),
    recipeId: boundedText,
    recipeVersion: z.number().int().positive(),
    heroTopology: creativeText,
    sectionTopology: z
      .array(z.object({ section: sectionTypeSchema, shape: creativeText }))
      .min(3)
      .max(10),
    responsiveIntent: creativeText,
    conversionPlacement: creativeText,
    mediaSlots: z
      .array(
        z.object({
          slotId: z
            .string()
            .trim()
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
            .max(64),
          role: z.enum(UNIFIED_MEDIA_ROLES),
          section: sectionTypeSchema,
          sourcePreference: z.enum(UNIFIED_MEDIA_SOURCES),
          aspectRatio: z.enum(UNIFIED_ASPECT_RATIOS),
          cropGuidance: z.string().trim().min(1).max(160),
          textOverlayAllowed: z.boolean(),
          proofEligibleRequired: z.boolean(),
          generationPrompt: z.string().trim().min(1).max(500).optional(),
          mobileTreatment: creativeText,
          required: z.boolean(),
        }),
      )
      .min(2)
      .max(5),
  })
  .superRefine((brief, context) => {
    if (brief.planSchemaVersion !== LEGACY_UNIFIED_PLAN_SCHEMA_VERSION) return;
    const issue = (path: Array<string | number>, message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (!LEGACY_HERO_TOPOLOGIES.has(brief.heroTopology))
      issue(["heroTopology"], "invalid v1 value");
    if (!LEGACY_RESPONSIVE_INTENTS.has(brief.responsiveIntent))
      issue(["responsiveIntent"], "invalid v1 value");
    if (!LEGACY_CONVERSION_PLACEMENTS.has(brief.conversionPlacement))
      issue(["conversionPlacement"], "invalid v1 value");
    brief.sectionTopology.forEach(({ shape }, index) => {
      if (!LEGACY_SECTION_SHAPES.has(shape))
        issue(["sectionTopology", index, "shape"], "invalid v1 value");
    });
    brief.mediaSlots.forEach(({ mobileTreatment }, index) => {
      if (!LEGACY_MOBILE_TREATMENTS.has(mobileTreatment))
        issue(["mediaSlots", index, "mobileTreatment"], "invalid v1 value");
    });
  });

export type UnifiedBrief = z.infer<typeof unifiedBriefSchema>;

export const UNIFIED_OPERATIONAL_ANCHOR_PURPOSES = [
  "navigation",
  "contact",
  "media",
  "visual",
  "host-operation",
] as const;
export const UNIFIED_RESERVED_OPERATIONAL_ANCHORS = ["contact", "lead"] as const;
export const MAX_UNIFIED_OPERATIONAL_MEDIA_SLOTS = 12;
export const MAX_UNIFIED_OPERATIONAL_ANCHORS = 24;

const stableOperationalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const operationalPromptSchema = z.string().trim().min(1).max(500);
const operationalAnchorPurposeSchema = z.enum(UNIFIED_OPERATIONAL_ANCHOR_PURPOSES);
const reservedOperationalAnchorSchema = z.enum(UNIFIED_RESERVED_OPERATIONAL_ANCHORS);

const currentUnifiedMediaSlotSchema = z
  .object({
    slotId: stableOperationalIdSchema,
    role: z.enum(UNIFIED_MEDIA_ROLES),
    required: z.boolean(),
    sourcePreference: z.enum(UNIFIED_MEDIA_SOURCES),
    aspectRatio: z.enum(UNIFIED_ASPECT_RATIOS),
    cropGuidance: z.string().trim().min(1).max(160),
    textOverlayAllowed: z.boolean(),
    proofEligibleRequired: z.boolean(),
    generationPrompt: operationalPromptSchema.optional(),
    anchorSlug: stableOperationalIdSchema.optional(),
  })
  .strict();

const currentUnifiedOperationalAnchorSchema = z
  .object({
    slug: stableOperationalIdSchema,
    purposes: z
      .array(operationalAnchorPurposeSchema)
      .min(1)
      .max(UNIFIED_OPERATIONAL_ANCHOR_PURPOSES.length),
  })
  .strict()
  .superRefine((anchor, context) => {
    if (new Set(anchor.purposes).size !== anchor.purposes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purposes"],
        message: "operational anchor purposes must be unique",
      });
    }
    const isReserved = reservedOperationalAnchorSchema.safeParse(anchor.slug).success;
    const isContact = anchor.purposes.includes("contact");
    if (isReserved !== isContact) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["slug"],
        message:
          "contact-purpose anchors must use reserved slug contact or lead, and reserved slugs require contact purpose",
      });
    }
  });

export const currentUnifiedOperationalIntentSchema = z
  .object({
    mediaSlots: z.array(currentUnifiedMediaSlotSchema).max(MAX_UNIFIED_OPERATIONAL_MEDIA_SLOTS),
    operationalAnchors: z
      .array(currentUnifiedOperationalAnchorSchema)
      .max(MAX_UNIFIED_OPERATIONAL_ANCHORS),
  })
  .strict()
  .superRefine((intent, context) => {
    const slotIds = new Set<string>();
    intent.mediaSlots.forEach((slot, index) => {
      if (slotIds.has(slot.slotId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mediaSlots", index, "slotId"],
          message: "media slot IDs must be unique",
        });
      }
      slotIds.add(slot.slotId);

      if (
        slot.role === "proof" &&
        (slot.sourcePreference !== "evidence" || !slot.proofEligibleRequired)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mediaSlots", index],
          message: "proof slots must require proof-eligible evidence",
        });
      }
      if (
        slot.proofEligibleRequired &&
        (slot.role !== "proof" || slot.sourcePreference !== "evidence")
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mediaSlots", index, "proofEligibleRequired"],
          message: "proof eligibility can be required only by proof slots using evidence",
        });
      }
      if (slot.sourcePreference === "evidence" && slot.generationPrompt !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mediaSlots", index, "generationPrompt"],
          message: "evidence-only slots must not include a generation prompt",
        });
      }
      if (slot.sourcePreference !== "evidence" && slot.generationPrompt === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mediaSlots", index, "generationPrompt"],
          message: "generation-capable slots require a generation prompt",
        });
      }
    });

    const anchors = new Map<string, (typeof intent.operationalAnchors)[number]>();
    intent.operationalAnchors.forEach((anchor, index) => {
      if (anchors.has(anchor.slug)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operationalAnchors", index, "slug"],
          message: "operational anchor slugs must be unique",
        });
      }
      anchors.set(anchor.slug, anchor);
    });
    intent.mediaSlots.forEach((slot, index) => {
      if (!slot.anchorSlug) return;
      const anchor = anchors.get(slot.anchorSlug);
      if (!anchor) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mediaSlots", index, "anchorSlug"],
          message: "media slot anchor must reference one declared operational anchor",
        });
      } else if (!anchor.purposes.includes("media")) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mediaSlots", index, "anchorSlug"],
          message: "media slot anchor must declare the media purpose",
        });
      }
    });
  });

export const currentUnifiedCreativeBriefSchema = z
  .object({
    rationale: z.string().trim().min(1).max(500),
    mood: z.string().trim().min(1).max(240),
    hierarchy: z.string().trim().min(1).max(500),
    mediaOpportunities: z.string().trim().min(1).max(500),
    responsiveBehavior: z.string().trim().min(1).max(500),
  })
  .strict();

/**
 * Current plan contract. Operational fields are executable; creativeBrief is advisory and must
 * never be compared to realized JSX as an acceptance invariant.
 */
export const currentUnifiedPlanSchema = z
  .object({
    planSchemaVersion: z.literal(CURRENT_UNIFIED_PLAN_SCHEMA_VERSION),
    operationalIntent: currentUnifiedOperationalIntentSchema,
    creativeBrief: currentUnifiedCreativeBriefSchema,
  })
  .strict();

export type CurrentUnifiedOperationalIntent = z.infer<typeof currentUnifiedOperationalIntentSchema>;
export type CurrentUnifiedCreativeBrief = z.infer<typeof currentUnifiedCreativeBriefSchema>;
export type CurrentUnifiedPlan = z.infer<typeof currentUnifiedPlanSchema>;
export type VersionedUnifiedPlan = UnifiedBrief | CurrentUnifiedPlan;

export const INVALID_CURRENT_UNIFIED_PLAN_ERROR = "current_unified_plan_invalid";
export const INVALID_VERSIONED_UNIFIED_PLAN_ERROR = "versioned_unified_plan_invalid";

export function parseCurrentUnifiedPlan(input: unknown): CurrentUnifiedPlan {
  const parsed = currentUnifiedPlanSchema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new Error(INVALID_CURRENT_UNIFIED_PLAN_ERROR);
}

/** Dispatch by the explicit plan discriminator; never reinterpret one version as another. */
export function parseVersionedUnifiedPlan(input: unknown): VersionedUnifiedPlan {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(INVALID_VERSIONED_UNIFIED_PLAN_ERROR);
  }
  const version = (input as Record<string, unknown>).planSchemaVersion;
  const parsed =
    version === CURRENT_UNIFIED_PLAN_SCHEMA_VERSION
      ? currentUnifiedPlanSchema.safeParse(input)
      : version === LEGACY_UNIFIED_PLAN_SCHEMA_VERSION || version === UNIFIED_PLAN_SCHEMA_VERSION
        ? unifiedBriefSchema.safeParse(input)
        : null;
  if (parsed?.success) return parsed.data;
  throw new Error(INVALID_VERSIONED_UNIFIED_PLAN_ERROR);
}

const boundedEvidenceAssetIdSchema = z.string().trim().min(1).max(256);

export const currentUnifiedGenerationCheckpointSchema = z
  .object({
    plan: currentUnifiedPlanSchema,
    evidenceAssetIdBySlot: z.record(boundedEvidenceAssetIdSchema),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    const slots = new Map(
      checkpoint.plan.operationalIntent.mediaSlots.map((slot) => [slot.slotId, slot]),
    );
    const bindings = Object.entries(checkpoint.evidenceAssetIdBySlot);
    if (bindings.length > MAX_UNIFIED_OPERATIONAL_MEDIA_SLOTS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceAssetIdBySlot"],
        message: "too many evidence bindings",
      });
    }
    const assetIds = new Set<string>();
    bindings.forEach(([slotId, assetId]) => {
      if (!stableOperationalIdSchema.safeParse(slotId).success) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceAssetIdBySlot", slotId],
          message: "evidence binding key must be a stable media slot ID",
        });
      }
      const slot = slots.get(slotId);
      if (!slot) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceAssetIdBySlot", slotId],
          message: "evidence binding must reference one declared media slot",
        });
      } else if (slot.sourcePreference === "generated") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceAssetIdBySlot", slotId],
          message: "generated-only media slots cannot bind evidence",
        });
      }
      if (assetIds.has(assetId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceAssetIdBySlot", slotId],
          message: "evidence asset identities must be unique across media slots",
        });
      }
      assetIds.add(assetId);
    });
    checkpoint.plan.operationalIntent.mediaSlots.forEach((slot, index) => {
      if (
        slot.required &&
        slot.sourcePreference === "evidence" &&
        checkpoint.evidenceAssetIdBySlot[slot.slotId] === undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plan", "operationalIntent", "mediaSlots", index, "slotId"],
          message: "required evidence slots must have an evidence binding",
        });
      }
    });
  });

export type CurrentUnifiedGenerationCheckpoint = z.infer<
  typeof currentUnifiedGenerationCheckpointSchema
>;
export const INVALID_CURRENT_UNIFIED_GENERATION_CHECKPOINT_ERROR =
  "current_site_generation_checkpoint_invalid";

export function parseCurrentUnifiedGenerationCheckpoint(
  input: unknown,
): CurrentUnifiedGenerationCheckpoint {
  const checkpoint = currentUnifiedGenerationCheckpointSchema.safeParse(input);
  if (checkpoint.success) return checkpoint.data;
  throw new Error(INVALID_CURRENT_UNIFIED_GENERATION_CHECKPOINT_ERROR);
}

export const INVALID_UNIFIED_GENERATION_CHECKPOINT_ERROR = "site_generation_checkpoint_invalid";

const CHECKPOINT_BRIEF_KEYS = new Set([
  "planSchemaVersion",
  "recipeId",
  "recipeVersion",
  "heroTopology",
  "sectionTopology",
  "responsiveIntent",
  "conversionPlacement",
  "mediaSlots",
]);
const CHECKPOINT_SECTION_KEYS = new Set(["section", "shape"]);
const CHECKPOINT_MEDIA_SLOT_KEYS = new Set([
  "slotId",
  "role",
  "section",
  "sourcePreference",
  "aspectRatio",
  "cropGuidance",
  "textOverlayAllowed",
  "proofEligibleRequired",
  "generationPrompt",
  "mobileTreatment",
  "required",
]);

function hasOnlyKeys(value: unknown, allowed: ReadonlySet<string>): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

const checkpointBriefSchema = z.unknown().superRefine((value, context) => {
  if (!hasOnlyKeys(value, CHECKPOINT_BRIEF_KEYS)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid checkpoint brief shape" });
    return;
  }
  const brief = value as Record<string, unknown>;
  if (
    !Array.isArray(brief.sectionTopology) ||
    !brief.sectionTopology.every((section) => hasOnlyKeys(section, CHECKPOINT_SECTION_KEYS)) ||
    !Array.isArray(brief.mediaSlots) ||
    !brief.mediaSlots.every((slot) => hasOnlyKeys(slot, CHECKPOINT_MEDIA_SLOT_KEYS))
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "invalid checkpoint brief shape" });
  }
});

export const unifiedGenerationCheckpointSchema = z
  .object({
    brief: z.intersection(checkpointBriefSchema, unifiedBriefSchema),
    evidenceAssetIdBySlot: z.record(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    for (const slotId of Object.keys(checkpoint.evidenceAssetIdBySlot)) {
      if (slotId.trim().length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["evidenceAssetIdBySlot", slotId],
          message: "slot identity must not be empty",
        });
      }
    }
  });

export type UnifiedGenerationCheckpoint = z.infer<typeof unifiedGenerationCheckpointSchema>;

/** Parse the one durable producer/consumer checkpoint contract without lossy fallback. */
export function parseUnifiedGenerationCheckpoint(input: unknown): UnifiedGenerationCheckpoint {
  const checkpoint = unifiedGenerationCheckpointSchema.safeParse(input);
  if (checkpoint.success) return checkpoint.data;
  throw new Error(INVALID_UNIFIED_GENERATION_CHECKPOINT_ERROR);
}

export function isInvalidUnifiedGenerationCheckpointError(error: unknown): boolean {
  return error instanceof Error && error.message === INVALID_UNIFIED_GENERATION_CHECKPOINT_ERROR;
}

export type UnifiedDivergenceTuple = {
  recipe: string;
  hero: string;
  sections: string;
  conversion: string;
  media: string;
};
export type StoredUnifiedPlan = { brief: UnifiedBrief; divergenceTuple: UnifiedDivergenceTuple };

function semanticTokens(value: string): string {
  const ignored = new Set([
    "a",
    "an",
    "and",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "into",
    "of",
    "on",
    "the",
    "to",
    "with",
    "reworded",
  ]);
  const aliases: Record<string, string> = {
    access: "action",
    enquiry: "contact",
    immediate: "early",
    immediately: "early",
    inquiry: "contact",
    lead: "hero",
    put: "place",
  };
  return [
    ...new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.map((token) => aliases[token] ?? token)
        .filter((token) => !ignored.has(token)) ?? [],
    ),
  ]
    .sort()
    .join("-");
}

export function comparableUnifiedDivergenceTuple(brief: UnifiedBrief): UnifiedDivergenceTuple {
  return {
    recipe: brief.recipeId,
    hero: semanticTokens(brief.heroTopology),
    sections: brief.sectionTopology
      .map(({ section, shape }) => section + ":" + semanticTokens(shape))
      .join(">"),
    conversion:
      semanticTokens(brief.conversionPlacement) + ":" + semanticTokens(brief.responsiveIntent),
    media: brief.mediaSlots
      .map(
        ({ role, section, sourcePreference, aspectRatio, mobileTreatment }) =>
          role +
          ":" +
          section +
          ":" +
          sourcePreference +
          ":" +
          aspectRatio +
          ":" +
          semanticTokens(mobileTreatment),
      )
      .join(">"),
  };
}

export function canonicalUnifiedDivergenceTuple(brief: UnifiedBrief): UnifiedDivergenceTuple {
  if (brief.planSchemaVersion === LEGACY_UNIFIED_PLAN_SCHEMA_VERSION) {
    return {
      recipe: brief.recipeId + "@" + brief.recipeVersion,
      hero: brief.heroTopology,
      sections: brief.sectionTopology.map(({ section, shape }) => section + ":" + shape).join(">"),
      conversion: brief.conversionPlacement,
      media: brief.mediaSlots
        .map(({ role, section, sourcePreference }) => role + ":" + section + ":" + sourcePreference)
        .join(">"),
    };
  }
  return comparableUnifiedDivergenceTuple(brief);
}

export function unifiedDivergenceAxisCount(
  candidate: UnifiedDivergenceTuple,
  prior: UnifiedDivergenceTuple,
): number {
  return (Object.keys(candidate) as Array<keyof UnifiedDivergenceTuple>).reduce(
    (count, axis) => count + (candidate[axis] === prior[axis] ? 0 : 1),
    0,
  );
}

export function parseStoredUnifiedPlan(config: unknown): StoredUnifiedPlan | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const record = config as Record<string, unknown>;
  if (
    record.generator !== "unified-site-agent" ||
    !SUPPORTED_UNIFIED_GENERATOR_SCHEMA_VERSIONS.includes(
      record.generatorSchemaVersion as (typeof SUPPORTED_UNIFIED_GENERATOR_SCHEMA_VERSIONS)[number],
    )
  )
    return null;
  const parsed = unifiedBriefSchema.safeParse(record.unifiedBrief);
  if (!parsed.success) return null;
  const expected = canonicalUnifiedDivergenceTuple(parsed.data);
  const stored = record.divergenceTuple;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
  const tuple = stored as Record<string, unknown>;
  if (
    !Object.entries(expected).every(([axis, value]) => tuple[axis] === value) ||
    Object.keys(tuple).length !== Object.keys(expected).length
  )
    return null;
  return { brief: parsed.data, divergenceTuple: expected };
}

export function unifiedBriefCandidate(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  if (unifiedBriefSchema.safeParse(input).success) return input;
  const record = input as Record<string, unknown>;
  const nested = record.unifiedBrief;
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : input;
}

export function acceptUnifiedBrief(
  input: unknown,
  options: {
    candidates: readonly UnifiedRecipe[];
    priorPlans?: readonly StoredUnifiedPlan[];
    contactHidden: boolean;
    evidenceStillCount?: number;
  },
):
  | {
      success: true;
      brief: UnifiedBrief;
      recipe: UnifiedRecipe;
      divergenceTuple: UnifiedDivergenceTuple;
      effectiveSourceBySlot: ReadonlyMap<string, "evidence" | "generated">;
    }
  | { success: false; error: string } {
  const parsed = unifiedBriefSchema.safeParse(unifiedBriefCandidate(input));
  if (!parsed.success)
    return {
      success: false,
      error: parsed.error.issues
        .map((issue) => (issue.path.length ? issue.path.join(".") : "plan") + ": " + issue.message)
        .join("; "),
    };
  const brief: UnifiedBrief =
    options.contactHidden && parsed.data.planSchemaVersion === UNIFIED_PLAN_SCHEMA_VERSION
      ? { ...parsed.data, conversionPlacement: "contact hidden by host" }
      : parsed.data;
  const recipe = options.candidates.find(
    (item) => item.id === brief.recipeId && item.version === brief.recipeVersion,
  );
  if (!recipe || !unifiedRecipeById(brief.recipeId, brief.recipeVersion))
    return {
      success: false,
      error: "recipeId and recipeVersion must identify one offered candidate",
    };
  if (!brief.sectionTopology.some((item) => item.section === "hero"))
    return { success: false, error: "sectionTopology must include hero" };
  if (
    new Set(brief.sectionTopology.map((item) => item.section)).size !== brief.sectionTopology.length
  )
    return { success: false, error: "sectionTopology sections must be unique" };
  if (new Set(brief.mediaSlots.map((item) => item.slotId)).size !== brief.mediaSlots.length)
    return { success: false, error: "media slot IDs must be unique" };
  if (!brief.mediaSlots.some((item) => item.sourcePreference === "generated" && item.required))
    return { success: false, error: "at least one required media slot must use generated media" };
  const plannedSections = new Set(brief.sectionTopology.map(({ section }) => section));
  for (const slot of brief.mediaSlots) {
    if (!plannedSections.has(slot.section)) {
      return {
        success: false,
        error: `media slot ${slot.slotId} references absent section ${slot.section}`,
      };
    }
    if (
      slot.role === "proof" &&
      (slot.sourcePreference !== "evidence" || !slot.proofEligibleRequired)
    ) {
      return {
        success: false,
        error: `proof slot ${slot.slotId} must require proof-eligible evidence`,
      };
    }
    if (slot.sourcePreference !== "evidence" && !slot.generationPrompt) {
      return {
        success: false,
        error: `fallback-capable slot ${slot.slotId} requires generationPrompt`,
      };
    }
    if (slot.sourcePreference === "generated" && slot.proofEligibleRequired) {
      return {
        success: false,
        error: `generated slot ${slot.slotId} cannot require proof eligibility`,
      };
    }
  }
  const evidenceCapacity = options.evidenceStillCount ?? Number.POSITIVE_INFINITY;
  const effectiveSourceBySlot = new Map<string, "evidence" | "generated">();
  let remainingEvidence = evidenceCapacity;
  const explicitEvidenceSlots = brief.mediaSlots.filter(
    (item) => item.sourcePreference === "evidence",
  );
  for (const slot of explicitEvidenceSlots.filter((item) => item.required)) {
    if (remainingEvidence <= 0)
      return {
        success: false,
        error: `evidence_capacity_exceeded: required evidence slot ${slot.slotId} cannot be satisfied by the authoritative inventory of ${evidenceCapacity} unique stills`,
      };
    effectiveSourceBySlot.set(slot.slotId, "evidence");
    remainingEvidence -= 1;
  }
  for (const slot of explicitEvidenceSlots.filter((item) => !item.required)) {
    if (remainingEvidence <= 0) continue;
    effectiveSourceBySlot.set(slot.slotId, "evidence");
    remainingEvidence -= 1;
  }
  for (const slot of brief.mediaSlots.filter((item) => item.sourcePreference === "generated"))
    effectiveSourceBySlot.set(slot.slotId, "generated");
  for (const slot of brief.mediaSlots.filter((item) => item.sourcePreference === "either")) {
    if (remainingEvidence > 0) {
      effectiveSourceBySlot.set(slot.slotId, "evidence");
      remainingEvidence -= 1;
    } else {
      effectiveSourceBySlot.set(slot.slotId, "generated");
    }
  }
  if (effectiveSourceBySlot.size < 2)
    return {
      success: false,
      error: `evidence_capacity_exceeded: plan can resolve only ${effectiveSourceBySlot.size} unique stills; at least 2 are required`,
    };

  const hasContact = brief.sectionTopology.some((item) => item.section === "contact");
  if (options.contactHidden && hasContact)
    return { success: false, error: "contactHidden plans must omit contact" };
  if (!options.contactHidden && !hasContact)
    return { success: false, error: "visible-contact plans must include contact" };
  if (brief.planSchemaVersion === LEGACY_UNIFIED_PLAN_SCHEMA_VERSION) {
    if (options.contactHidden && brief.conversionPlacement !== "hidden")
      return { success: false, error: "v1 contactHidden plans must use hidden conversion" };
    if (!options.contactHidden && brief.conversionPlacement === "hidden")
      return { success: false, error: "v1 visible-contact plans require visible conversion" };
  }
  const canonicalBrief: UnifiedBrief = {
    ...brief,
    mediaSlots: brief.mediaSlots.map((slot) => ({
      ...slot,
      sourcePreference: effectiveSourceBySlot.get(slot.slotId) ?? slot.sourcePreference,
    })),
  };
  const tuple = canonicalUnifiedDivergenceTuple(canonicalBrief);
  const comparableTuple = comparableUnifiedDivergenceTuple(canonicalBrief);
  for (const prior of options.priorPlans ?? []) {
    const changed = unifiedDivergenceAxisCount(
      comparableTuple,
      comparableUnifiedDivergenceTuple(prior.brief),
    );
    if (changed < MIN_DIVERGENCE_AXES)
      return {
        success: false,
        error:
          "plan differs from a recent unified brief on only " +
          changed +
          " planning axes; at least " +
          MIN_DIVERGENCE_AXES +
          " are required",
      };
  }
  return {
    success: true,
    brief: canonicalBrief,
    recipe,
    divergenceTuple: tuple,
    effectiveSourceBySlot,
  };
}

export function readRecentUnifiedPlans(
  rows: readonly { config_json: unknown }[],
): StoredUnifiedPlan[] {
  return rows
    .map((row) => parseStoredUnifiedPlan(row.config_json))
    .filter((item): item is StoredUnifiedPlan => item !== null);
}
