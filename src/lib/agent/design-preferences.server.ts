import { createHash } from "node:crypto";
import { z } from "zod";

export const DESIGN_PREFERENCES_SCHEMA_VERSION = 1 as const;
export const DESIGN_PREFERENCES_NORMALIZER_VERSION = "bucket1-design-preferences-v1" as const;
export const DESIGN_PREFERENCES_MAX_BYTES = 8 * 1024;
export const DESIGN_PREFERENCES_MAX_CLAUSES = 32;
export const DESIGN_PREFERENCES_MAX_REQUIRED_PHOTOS = 8;

const SHA256_HEX = /^[0-9a-f]{64}$/;

const toneBrandSchema = z.enum([
  "professional",
  "modern",
  "bold",
  "playful",
  "warm",
  "approachable",
  "premium",
  "industrial",
  "craft-focused",
  "trustworthy",
  "minimal",
  "editorial",
  "energetic",
  "calm",
  "traditional",
  "clean",
]);
const hierarchyEmphasisSchema = z.enum([
  "services",
  "project-proof",
  "reviews",
  "experience",
  "warranty",
  "service-area",
  "contact",
  "brand-story",
]);
const densitySpacingSchema = z.enum(["compact", "balanced", "spacious"]);
const colorSchema = z.enum([
  "brand",
  "neutral",
  "dark",
  "light",
  "warm",
  "cool",
  "muted",
  "vibrant",
  "monochrome",
  "high-contrast",
]);
const typographySchema = z.enum(["serif", "sans-serif", "mixed", "bold-display", "understated"]);
const mediaMotionSchema = z.enum([
  "media-minimal",
  "balanced-media",
  "photo-led",
  "gallery-led",
  "static",
]);
const mustNotKindSchema = z.enum(["motion", "generated-imagery", "media"]);

export const designPreferencesSchema = z
  .object({
    schemaVersion: z.literal(DESIGN_PREFERENCES_SCHEMA_VERSION),
    normalizerVersion: z.literal(DESIGN_PREFERENCES_NORMALIZER_VERSION),
    sourceInstructionSha256: z.string().regex(SHA256_HEX),
    subjective: z
      .object({
        toneBrand: z.array(toneBrandSchema).max(8),
        hierarchyEmphasis: z.array(hierarchyEmphasisSchema).max(8),
        densitySpacing: densitySpacingSchema.nullable(),
        colorTypography: z
          .object({
            color: z.array(colorSchema).max(6),
            typography: z.array(typographySchema).max(3),
          })
          .strict(),
        mediaMotion: z.array(mediaMotionSchema).max(5),
      })
      .strict(),
    must: z
      .array(
        z
          .object({
            kind: z.literal("required-photo"),
            photoId: z.string().regex(SHA256_HEX),
          })
          .strict(),
      )
      .max(DESIGN_PREFERENCES_MAX_REQUIRED_PHOTOS),
    mustNot: z.array(z.object({ kind: mustNotKindSchema }).strict()).max(3),
  })
  .strict()
  .superRefine((preferences, context) => {
    const unique = (values: readonly string[]) => new Set(values).size === values.length;
    const checks: Array<readonly [readonly string[], Array<string | number>]> = [
      [preferences.subjective.toneBrand, ["subjective", "toneBrand"]],
      [preferences.subjective.hierarchyEmphasis, ["subjective", "hierarchyEmphasis"]],
      [preferences.subjective.colorTypography.color, ["subjective", "colorTypography", "color"]],
      [
        preferences.subjective.colorTypography.typography,
        ["subjective", "colorTypography", "typography"],
      ],
      [preferences.subjective.mediaMotion, ["subjective", "mediaMotion"]],
      [preferences.must.map((constraint) => constraint.photoId), ["must"]],
      [preferences.mustNot.map((constraint) => constraint.kind), ["mustNot"]],
    ];
    for (const [values, path] of checks) {
      if (!unique(values)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path, message: "values must be unique" });
      }
    }
    if (
      preferences.mustNot.some((constraint) => constraint.kind === "media") &&
      preferences.must.length > 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["must"],
        message: "required photos conflict with no media",
      });
    }
  });

export type DesignPreferences = z.infer<typeof designPreferencesSchema>;
export type DesignPreferenceRejectionCode =
  "instruction_conflict" | "instruction_unsupported" | "instruction_unsafe";

export class DesignPreferencesInstructionError extends Error {
  override readonly name = "DesignPreferencesInstructionError";
  readonly retryable = false;
  readonly code: DesignPreferenceRejectionCode;
  readonly reason: string;
  readonly sourceInstructionSha256: string;
  readonly clauseIndex: number | null;

  constructor(
    code: DesignPreferenceRejectionCode,
    reason: string,
    sourceInstructionSha256: string,
    clauseIndex: number | null,
  ) {
    super(
      [
        "design_preferences_rejected",
        code,
        reason,
        "source=" + sourceInstructionSha256,
        "clause=" + (clauseIndex === null ? "none" : clauseIndex),
      ].join(":"),
    );
    this.code = code;
    this.reason = reason;
    this.sourceInstructionSha256 = sourceInstructionSha256;
    this.clauseIndex = clauseIndex;
  }
}

export function isDesignPreferencesInstructionError(
  error: unknown,
): error is DesignPreferencesInstructionError {
  return (
    error instanceof DesignPreferencesInstructionError ||
    Boolean(
      error &&
      typeof error === "object" &&
      (error as { name?: unknown }).name === "DesignPreferencesInstructionError" &&
      (error as { retryable?: unknown }).retryable === false,
    )
  );
}

function sourceHash(instruction: string): string {
  return createHash("sha256").update(instruction, "utf8").digest("hex");
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sortedUnique<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function reject(
  code: DesignPreferenceRejectionCode,
  reason: string,
  hash: string,
  clauseIndex: number | null,
): never {
  throw new DesignPreferencesInstructionError(code, reason, hash, clauseIndex);
}

const UNSAFE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /\b(?:ignore|override|disregard|bypass)\b.{0,40}\b(?:system|developer|previous|safety|policy|instructions?)\b/iu,
    "prompt_override",
  ],
  [
    /\b(?:reveal|print|show|expose|leak)\b.{0,40}\b(?:prompt|secret|token|credential|environment|api key)\b/iu,
    "secret_exfiltration",
  ],
  [
    /\b(?:execute|run|inject)\b.{0,30}\b(?:code|script|javascript|sql|command|shell)\b/iu,
    "code_execution",
  ],
  [
    /<\/?(?:script|iframe)\b|javascript:|dangerouslysetinnerhtml|document\.write|\beval\s*\(/iu,
    "active_content",
  ],
  [
    /\b(?:disable|bypass|evade)\b.{0,40}\b(?:privacy|contact policy|provenance|validation|security)\b/iu,
    "policy_bypass",
  ],
];

const TONE_PATTERNS: ReadonlyArray<readonly [RegExp, z.infer<typeof toneBrandSchema>]> = [
  [/\bprofessional\b/giu, "professional"],
  [/\b(?:modern|contemporary)\b/giu, "modern"],
  [/\bbold\b/giu, "bold"],
  [/\b(?:playful|fun)\b/giu, "playful"],
  [/\b(?:warm|welcoming)\b/giu, "warm"],
  [/\b(?:approachable|friendly)\b/giu, "approachable"],
  [/\b(?:premium|luxurious?|high-end)\b/giu, "premium"],
  [/\b(?:industrial|rugged)\b/giu, "industrial"],
  [/\b(?:craft-focused|craftsmanship|artisan|crafted)\b/giu, "craft-focused"],
  [/\b(?:trustworthy|dependable|reliable)\b/giu, "trustworthy"],
  [/\b(?:minimal|minimalist)\b/giu, "minimal"],
  [/\b(?:editorial|magazine-like)\b/giu, "editorial"],
  [/\b(?:energetic|dynamic)\b/giu, "energetic"],
  [/\b(?:calm|quiet)\b/giu, "calm"],
  [/\b(?:traditional|classic)\b/giu, "traditional"],
  [/\bclean\b/giu, "clean"],
];

const HIERARCHY_PATTERNS: ReadonlyArray<
  readonly [RegExp, z.infer<typeof hierarchyEmphasisSchema>]
> = [
  [
    /\b(?:emphasize|highlight|prioritize|focus on|feature|make prominent)\s+(?:the\s+)?services?\b/giu,
    "services",
  ],
  [
    /\b(?:emphasize|highlight|prioritize|focus on|feature|make prominent)\s+(?:our\s+)?(?:work|projects?|project photos?)\b|\bproject photos?\b/giu,
    "project-proof",
  ],
  [
    /\b(?:emphasize|highlight|prioritize|focus on|feature|make prominent)\s+(?:the\s+)?reviews?\b/giu,
    "reviews",
  ],
  [
    /\b(?:emphasize|highlight|prioritize|focus on|feature|make prominent)\s+(?:our\s+)?experience\b/giu,
    "experience",
  ],
  [
    /\b(?:emphasize|highlight|prioritize|focus on|feature|make prominent)\s+(?:the\s+)?warranty\b/giu,
    "warranty",
  ],
  [
    /\b(?:emphasize|highlight|prioritize|focus on|feature|make prominent)\s+(?:the\s+)?service area\b/giu,
    "service-area",
  ],
  [
    /\b(?:emphasize|highlight|prioritize|focus on|feature|make prominent)\s+(?:the\s+)?contact(?: form)?\b/giu,
    "contact",
  ],
  [
    /\b(?:emphasize|highlight|prioritize|focus on|feature|make prominent)\s+(?:the\s+)?(?:brand|company|business) story\b/giu,
    "brand-story",
  ],
];

const COLOR_PATTERNS: ReadonlyArray<readonly [RegExp, z.infer<typeof colorSchema>]> = [
  [/\b(?:brand|existing) colou?rs?\b/giu, "brand"],
  [/\bneutral(?: palette| colou?rs?)?\b/giu, "neutral"],
  [/\bdark(?: palette| theme| colou?rs?)\b/giu, "dark"],
  [/\blight(?: palette| theme| colou?rs?)\b/giu, "light"],
  [/\bwarm(?: palette| colou?rs?)\b/giu, "warm"],
  [/\bcool(?: palette| colou?rs?)\b/giu, "cool"],
  [/\bmuted(?: palette| colou?rs?)?\b/giu, "muted"],
  [/\bvibrant(?: palette| colou?rs?)?\b/giu, "vibrant"],
  [/\b(?:monochrome|black and white)\b/giu, "monochrome"],
  [/\bhigh[ -]contrast\b/giu, "high-contrast"],
];

const TYPOGRAPHY_PATTERNS: ReadonlyArray<readonly [RegExp, z.infer<typeof typographySchema>]> = [
  [/\b(?:serif typography|serif type|serif font)\b/giu, "serif"],
  [/\b(?:sans[ -]serif typography|sans[ -]serif type|sans[ -]serif font)\b/giu, "sans-serif"],
  [/\b(?:mixed typography|serif and sans[ -]serif|mixed type)\b/giu, "mixed"],
  [/\b(?:bold display type|bold display typography|display type)\b/giu, "bold-display"],
  [/\b(?:understated typography|understated type|quiet typography)\b/giu, "understated"],
];

type FrozenEvidenceIdentity = {
  assetId: string;
  origin: "evidence" | "generated";
  mimeType: string;
  proofEligible: boolean;
};

type PreferenceAccumulator = {
  toneBrand: Set<z.infer<typeof toneBrandSchema>>;
  hierarchy: Set<z.infer<typeof hierarchyEmphasisSchema>>;
  density: Map<z.infer<typeof densitySpacingSchema>, number>;
  color: Map<z.infer<typeof colorSchema>, number>;
  typography: Map<z.infer<typeof typographySchema>, number>;
  mediaMotion: Map<z.infer<typeof mediaMotionSchema>, number>;
  requiredPhotos: Map<string, number>;
  mustNot: Map<z.infer<typeof mustNotKindSchema>, number>;
  positiveMotionClause: number | null;
};

function replaceRecognized<T extends string>(
  value: string,
  patterns: ReadonlyArray<readonly [RegExp, T]>,
  onMatch: (preference: T) => void,
): string {
  let next = value;
  for (const [pattern, preference] of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(next)) onMatch(preference);
    pattern.lastIndex = 0;
    next = next.replace(pattern, " ");
  }
  return next;
}

const SCAFFOLD = [
  /\b(?:yes|yep|sure|okay|ok|thanks?|please)\b/giu,
  /\b(?:go ahead|proceed|continue|build exactly)\b/giu,
  /\b(?:can|could|would|will) you\b/giu,
  /\b(?:i want|i would like|we want|we would like)\b/giu,
  /\b(?:build|create|generate|regenerate|redesign|remake)\b/giu,
  /\b(?:website|site|page|design|variant|version)\b/giu,
  /\b(?:make it|keep it|it should be|make the|keep the)\b/giu,
  /\b(?:must|should|prefer|use)\b/giu,
  /\b(?:look|feel|style|direction|generation)\b/giu,
  /\b(?:this|that|it|my|our|me|us|the|a|an|new|another|one|exactly)\b/giu,
  /\b(?:with|and|but|also|while|still|really|very|more|less|of|for|to|be|is|as)\b/giu,
];

function normalizeClause(
  clause: string,
  clauseIndex: number,
  hash: string,
  state: PreferenceAccumulator,
): void {
  let remaining = clause.normalize("NFKC").toLowerCase();
  if (!remaining.trim()) return;

  for (const [pattern, reason] of UNSAFE_PATTERNS) {
    if (pattern.test(remaining)) reject("instruction_unsafe", reason, hash, clauseIndex);
  }

  if (
    /\b(?:do not|don't|must not|never|no|not|avoid|without)\s+(?:a\s+)?(?:professional|modern|bold|playful|warm|approachable|premium|industrial|minimal|editorial|energetic|calm|traditional|clean|serif|sans[ -]serif|dark|light|muted|vibrant)\b/iu.test(
      remaining,
    )
  ) {
    reject("instruction_unsupported", "unsupported_negative_preference", hash, clauseIndex);
  }

  const requiredPhoto =
    /\b(?:must|required to|please)?\s*(?:use|include|feature)\s+(?:the\s+)?(?:photo|image)(?:\s+id)?\s*[:#]?\s*([0-9a-f]{64})\b/giu;
  remaining = remaining.replace(requiredPhoto, (_match, photoId: string) => {
    state.requiredPhotos.set(photoId.toLowerCase(), clauseIndex);
    return " ";
  });
  if (
    /\bmust\s+(?:use|include|feature)\s+(?:my|our|existing|real|project)\s+(?:photos?|images?)\b/iu.test(
      remaining,
    )
  ) {
    reject("instruction_unsupported", "required_photo_id_missing", hash, clauseIndex);
  }

  const noGenerated =
    /\b(?:do not|don't|must not|never|no|without|avoid)\s+(?:use\s+)?(?:ai[ -])?(?:generated|synthetic)\s+(?:photos?|images?|imagery|media)\b/giu;
  if (noGenerated.test(remaining)) {
    state.mustNot.set("generated-imagery", clauseIndex);
    remaining = remaining.replace(noGenerated, " ");
  }
  const noMotion =
    /\b(?:do not|don't|must not|never|no|without|avoid)\s+(?:use\s+)?(?:motion|animations?|animated effects?|transitions?)\b/giu;
  if (noMotion.test(remaining)) {
    state.mustNot.set("motion", clauseIndex);
    state.mediaMotion.set("static", clauseIndex);
    remaining = remaining.replace(noMotion, " ");
  }
  const noMedia =
    /\b(?:do not|don't|must not|never|no|without|avoid)\s+(?:use\s+)?(?:photos?|images?|imagery|media)\b/giu;
  if (noMedia.test(remaining)) {
    state.mustNot.set("media", clauseIndex);
    state.mediaMotion.set("media-minimal", clauseIndex);
    remaining = remaining.replace(noMedia, " ");
  }

  const positiveMotion =
    /\b(?:use|include|feature|add|prefer|with)\s+(?:subtle\s+)?(?:motion|animations?|animated effects?|transitions?)\b/giu;
  if (positiveMotion.test(remaining)) {
    state.positiveMotionClause = clauseIndex;
    remaining = remaining.replace(positiveMotion, " ");
  }
  if (
    /\bmust\s+(?:use|include|generate|feature)\s+(?:ai[ -])?(?:generated|synthetic)\s+(?:photos?|images?|imagery|media)\b/iu.test(
      remaining,
    )
  ) {
    reject("instruction_unsupported", "required_generated_imagery", hash, clauseIndex);
  }

  remaining = remaining.replace(
    /\b(?:use|using|feature|featuring)\s+(?:my|our|existing|real|project)\s+(?:photos?|images?)\b/giu,
    () => {
      state.mediaMotion.set("photo-led", clauseIndex);
      return " ";
    },
  );
  const mediaPatterns: ReadonlyArray<readonly [RegExp, z.infer<typeof mediaMotionSchema>]> = [
    [/\b(?:gallery-led|photo gallery)\b/giu, "gallery-led"],
    [/\b(?:minimal|limited|restrained)\s+(?:media|imagery|photos?)\b/giu, "media-minimal"],
    [/\bbalanced\s+(?:media|imagery|photos?)\b/giu, "balanced-media"],
    [/\b(?:prominent|large|immersive)\s+(?:media|imagery|photos?)\b/giu, "photo-led"],
  ];
  remaining = replaceRecognized(remaining, mediaPatterns, (preference) => {
    state.mediaMotion.set(preference, clauseIndex);
  });

  const densityPatterns: ReadonlyArray<readonly [RegExp, z.infer<typeof densitySpacingSchema>]> = [
    [/\b(?:spacious|airy|generous spacing)\b/giu, "spacious"],
    [/\b(?:compact|dense|tight spacing)\b/giu, "compact"],
    [/\b(?:balanced spacing|medium density)\b/giu, "balanced"],
  ];
  remaining = replaceRecognized(remaining, densityPatterns, (preference) => {
    state.density.set(preference, clauseIndex);
  });
  remaining = replaceRecognized(remaining, HIERARCHY_PATTERNS, (preference) => {
    state.hierarchy.add(preference);
  });
  remaining = replaceRecognized(remaining, TYPOGRAPHY_PATTERNS, (preference) => {
    state.typography.set(preference, clauseIndex);
  });
  remaining = replaceRecognized(remaining, COLOR_PATTERNS, (preference) => {
    state.color.set(preference, clauseIndex);
  });
  remaining = replaceRecognized(remaining, TONE_PATTERNS, (preference) => {
    state.toneBrand.add(preference);
  });

  for (const pattern of SCAFFOLD) remaining = remaining.replace(pattern, " ");
  remaining = remaining.replace(/[\s,;:()\[\]{}'"_-]+/gu, "").trim();
  if (remaining) reject("instruction_unsupported", "unsupported_clause", hash, clauseIndex);
}

function conflictIndex(
  values: ReadonlyMap<string, number>,
  pairs: ReadonlyArray<readonly [string, string]>,
): number | null {
  for (const [left, right] of pairs) {
    if (values.has(left) && values.has(right))
      return Math.max(values.get(left)!, values.get(right)!);
  }
  return null;
}

export function parseDesignPreferences(value: unknown): DesignPreferences {
  const parsed = designPreferencesSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid generation checkpoint: designPreferences contract");
  if (byteLength(JSON.stringify(parsed.data)) > DESIGN_PREFERENCES_MAX_BYTES) {
    throw new Error("Invalid generation checkpoint: designPreferences exceeds 8 KiB");
  }
  return parsed.data;
}

export function normalizeDesignPreferences(options: {
  instruction: string;
  frozenEvidence: readonly FrozenEvidenceIdentity[];
}): DesignPreferences {
  const hash = sourceHash(options.instruction);
  if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(options.instruction)) {
    reject("instruction_unsafe", "control_characters", hash, null);
  }
  for (const [pattern, reason] of UNSAFE_PATTERNS) {
    if (pattern.test(options.instruction)) reject("instruction_unsafe", reason, hash, null);
  }

  const clauses = options.instruction
    .split(/[.!?;\n]+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length > DESIGN_PREFERENCES_MAX_CLAUSES) {
    reject("instruction_unsupported", "too_many_clauses", hash, null);
  }
  const state: PreferenceAccumulator = {
    toneBrand: new Set(),
    hierarchy: new Set(),
    density: new Map(),
    color: new Map(),
    typography: new Map(),
    mediaMotion: new Map(),
    requiredPhotos: new Map(),
    mustNot: new Map(),
    positiveMotionClause: null,
  };
  clauses.forEach((clause, index) => normalizeClause(clause, index, hash, state));

  if (state.positiveMotionClause !== null) {
    reject(
      state.mustNot.has("motion") ? "instruction_conflict" : "instruction_unsupported",
      state.mustNot.has("motion") ? "motion_both_required_and_forbidden" : "motion_not_supported",
      hash,
      state.positiveMotionClause,
    );
  }
  if (state.density.size > 1) {
    reject("instruction_conflict", "density_conflict", hash, Math.max(...state.density.values()));
  }
  const colorConflict = conflictIndex(state.color, [
    ["dark", "light"],
    ["warm", "cool"],
    ["muted", "vibrant"],
    ["monochrome", "vibrant"],
  ]);
  if (colorConflict !== null) reject("instruction_conflict", "color_conflict", hash, colorConflict);
  if (state.typography.has("mixed")) {
    state.typography.delete("serif");
    state.typography.delete("sans-serif");
  } else if (state.typography.has("serif") && state.typography.has("sans-serif")) {
    state.typography.clear();
    state.typography.set("mixed", 0);
  }
  const mediaConflict = conflictIndex(state.mediaMotion, [
    ["media-minimal", "gallery-led"],
    ["media-minimal", "photo-led"],
  ]);
  if (mediaConflict !== null) {
    reject("instruction_conflict", "media_emphasis_conflict", hash, mediaConflict);
  }
  if (state.mustNot.has("media") && state.requiredPhotos.size > 0) {
    reject(
      "instruction_conflict",
      "required_photo_conflicts_with_no_media",
      hash,
      Math.max(state.mustNot.get("media")!, ...state.requiredPhotos.values()),
    );
  }
  if (state.requiredPhotos.size > DESIGN_PREFERENCES_MAX_REQUIRED_PHOTOS) {
    reject("instruction_unsupported", "too_many_required_photos", hash, null);
  }

  const authorized = new Set(
    options.frozenEvidence
      .filter(
        (item) =>
          item.origin === "evidence" &&
          item.proofEligible === true &&
          ["image/jpeg", "image/png", "image/webp"].includes(item.mimeType.toLowerCase()) &&
          SHA256_HEX.test(item.assetId),
      )
      .map((item) => item.assetId),
  );
  for (const [photoId, clauseIndex] of state.requiredPhotos) {
    if (!authorized.has(photoId)) {
      reject("instruction_conflict", "required_photo_unauthorized", hash, clauseIndex);
    }
  }

  return parseDesignPreferences({
    schemaVersion: DESIGN_PREFERENCES_SCHEMA_VERSION,
    normalizerVersion: DESIGN_PREFERENCES_NORMALIZER_VERSION,
    sourceInstructionSha256: hash,
    subjective: {
      toneBrand: sortedUnique(state.toneBrand),
      hierarchyEmphasis: sortedUnique(state.hierarchy),
      densitySpacing: state.density.keys().next().value ?? null,
      colorTypography: {
        color: sortedUnique(state.color.keys()),
        typography: sortedUnique(state.typography.keys()),
      },
      mediaMotion: sortedUnique(state.mediaMotion.keys()),
    },
    must: sortedUnique(state.requiredPhotos.keys()).map((photoId) => ({
      kind: "required-photo" as const,
      photoId,
    })),
    mustNot: sortedUnique(state.mustNot.keys()).map((kind) => ({ kind })),
  });
}

export function requiredDesignPreferencePhotoIds(preferences: DesignPreferences): string[] {
  return preferences.must.map((constraint) => constraint.photoId);
}

export function designPreferenceForbids(
  preferences: DesignPreferences,
  kind: DesignPreferences["mustNot"][number]["kind"],
): boolean {
  return preferences.mustNot.some((constraint) => constraint.kind === kind);
}
