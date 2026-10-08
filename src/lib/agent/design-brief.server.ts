import { z } from "zod";

import { designIntentContractText } from "../site-theme/design-catalog.ts";
import { snapToneToHarmonious, tonesForPrimaryColor } from "../site-theme/design-spec.ts";
import { siteDesignIntentSchema } from "../site-theme/types.ts";
import type { SiteFactSheet } from "../site-fact-sheet.ts";
import { coerceLookAndFeel, evidenceStillCount } from "../site-evidence.ts";
import {
  clampMediaShots,
  mediaShotsSchema,
  MEDIA_SHOTS_PLAN_CONTRACT,
} from "../media/media-shots.ts";

import {
  CATALOG_SECTION_CATEGORIES,
  catalogShortlistForDesign,
  getCatalogEntryById,
  namedLayoutFitsRequirements,
  isCatalogEligibleSection,
  resolveCatalogRefId,
  type CatalogEligibleSection,
  type ComponentCatalogEntry,
} from "./catalog.server.ts";
import {
  CANONICAL_SECTION_TYPES,
  headerNavItems,
  NO_MOTION_SECTIONS,
  REQUIRED_SECTION_TYPES,
  sectionIdsForEvidence,
  sectionVocabulary,
  type CanonicalSectionType,
} from "./section-order.ts";
import { allowedCompositionFamilies } from "./composition-policy.ts";
import { executableNamedLayoutForSection } from "./layout-vocabulary.ts";
import { layoutsCollide } from "./prior-variant-summary.ts";
import { formatTypicalServicesForDesign } from "./trade-services.server.ts";

export const ENTRANCE_PRESETS = [
  "fade",
  "fadeUp",
  "fadeDown",
  "scaleIn",
  "slideFromLeft",
  "slideFromRight",
  "none",
] as const;

export const HOVER_PRESETS = ["lift", "underline", "zoomMedia", "grow", "none"] as const;
export const CLICK_PRESETS = ["quoteCta", "nav", "tel", "mailto", "none"] as const;
export const MOTION_INTENSITIES = ["minimal", "subtle", "lively"] as const;

const personaSchema = z
  .object({
    customer: z.string(),
    offering: z.string(),
    place: z.string(),
    proof: z.string(),
    visualDirection: z.string(),
    conversionAsk: z.string(),
  })
  .passthrough();

const extraReviewSchema = z.object({
  quote: z.string(),
  author: z.string().optional(),
  source: z.string().optional(),
});

const briefSectionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(CANONICAL_SECTION_TYPES),
  heading: z.string(),
  body: z.string(),
  catalogRef: z.string().min(1).optional(),
  entrance: z.enum(ENTRANCE_PRESETS).optional(),
  stagger: z.boolean().optional(),
  hover: z.enum(HOVER_PRESETS).optional(),
  click: z.enum(CLICK_PRESETS).optional(),
});

export const designBriefSchema = z
  .object({
    persona: personaSchema.optional(),
    designSpec: z.object({ designIntent: siteDesignIntentSchema }),
    sections: z.array(briefSectionSchema).min(1),
    extraReviews: z.array(extraReviewSchema).optional(),
    mediaShots: mediaShotsSchema,
    motionPolicy: z
      .object({
        intensity: z.enum(MOTION_INTENSITIES).optional(),
        pulseCta: z.boolean().optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const types = value.sections.map((section) => section.type);
    for (const expected of REQUIRED_SECTION_TYPES) {
      if (!types.includes(expected)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing section type ${expected} (allowed: ${sectionVocabulary()})`,
          path: ["sections"],
        });
      }
    }
  });

export type DesignBrief = z.infer<typeof designBriefSchema>;

export const LANDING_PAGE_PRINCIPLES = `Landing page principles — apply these to how you write, not just what you write:
1. Trust-first sequencing: the trustmarkers section owns credentials (license, ratings, certifications, years). Put those facts there — not in the hero. Hero is brand name, short positioning, and a booking CTA. When photos exist they may be the hero visual; they are not credentials. Readers who don't trust the business won't engage; the dedicated trust strip is how we earn that.
2. Specificity over genericity: prefer a real license number, a real warranty/experience detail, and concrete sub-bulleted service scope over vague claims like "licensed and insured" or a flat comma-separated service list. A true generic is acceptable when data is missing; a fabricated specific is not — never invent a specific you don't have data for. License/rating specifics belong in trustmarkers; service specifics belong in services.
3. Review attribution: whenever you use extraReviews, always populate author and source from real enrichment data when it's available. An unattributed floating quote is not a credible review — attribution is what makes it a third-party voice rather than more marketing copy. Do not paste the same quote into the reviews section body when extraReviews already lists it.
4. Evidence-volume honesty: never imply more reviews, images, or years of work exist than the data actually supports. The beforeAfter section is an honest project-photo gallery ("Our work") — never label unlabeled photos as before/after transformations. When mediaGallery images exist, reference them as visible project proof.
5. Repeated conversion asks: don't rely on a single call-to-action moment. Use the same short booking label (2–4 words; e.g. "Book now", "Book Appointment", "Schedule a visit") in the hero and again after services or reviews — visitors convert at different points once they're persuaded. Put that label on persona.conversionAsk. Do not invent a second CTA intent (no "Learn More" / "Get Started"). The contact form stays a quote request; Nav Contact still goes to #contact.
6. Tone register: avoid discount/urgency/pressure-sales language ("limited time", excessive exclamation) regardless of which lookAndFeel is chosen — urgency framing signals a commoditized, price-competed category and contradicts trust-first positioning.`;

export function motionIntensityForLookAndFeel(
  lookAndFeel: string,
): (typeof MOTION_INTENSITIES)[number] {
  const skin = coerceLookAndFeel(lookAndFeel);
  if (skin === "professional") return "minimal";
  if (skin === "funky") return "lively";
  return "subtle";
}

function coerceCatalogRef(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return resolveCatalogRefId(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return resolveCatalogRefId(id);
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isPreset<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function looksLikeDesignIntent(value: unknown): boolean {
  const rec = asRecord(value);
  return Boolean(rec && "pairing" in rec && !("designIntent" in rec));
}

function coerceDesignSpec(rec: Record<string, unknown>): void {
  const spec = asRecord(rec.designSpec);
  const nested = spec?.designIntent;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return;
  if (spec && looksLikeDesignIntent(spec)) {
    rec.designSpec = { designIntent: spec };
    return;
  }
  const rootIntent = rec.designIntent;
  if (rootIntent && typeof rootIntent === "object" && !Array.isArray(rootIntent)) {
    rec.designSpec = { designIntent: rootIntent };
  }
}

function coerceMotionPolicy(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  const rec = asRecord(value);
  if (!rec) return undefined;
  const next: Record<string, unknown> = {};
  if (isPreset(rec.intensity, MOTION_INTENSITIES)) next.intensity = rec.intensity;
  const pulseCta = coerceBoolean(rec.pulseCta);
  if (pulseCta !== undefined) next.pulseCta = pulseCta;
  if (next.intensity === undefined && next.pulseCta === undefined) return undefined;
  return next;
}

function coerceExtraReviews(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter((item) => extraReviewSchema.safeParse(item).success);
  return kept.length > 0 ? kept : undefined;
}

function coerceSection(section: unknown): Record<string, unknown> | null {
  const next = asRecord(section);
  if (!next) return null;
  if (typeof next.type !== "string" || !next.type.trim()) return null;
  if (typeof next.id !== "string" || !next.id.trim()) next.id = next.type;
  const coerced = coerceCatalogRef(next.catalogRef);
  if (coerced) next.catalogRef = coerced;
  else delete next.catalogRef;
  if (!isPreset(next.entrance, ENTRANCE_PRESETS)) delete next.entrance;
  if (!isPreset(next.hover, HOVER_PRESETS)) delete next.hover;
  if (!isPreset(next.click, CLICK_PRESETS)) delete next.click;
  if (typeof next.stagger !== "boolean") delete next.stagger;
  return next;
}

/** Coerce LLM JSON to the brief contract. Optional/wrong-shape fields must not void required ones. */
export function coerceDesignBriefInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const rec = { ...(raw as Record<string, unknown>) };
  delete rec.layoutIntent;
  coerceDesignSpec(rec);
  if (rec.persona !== undefined && !personaSchema.safeParse(rec.persona).success) {
    delete rec.persona;
  }
  const extraReviews = coerceExtraReviews(rec.extraReviews);
  if (extraReviews) rec.extraReviews = extraReviews;
  else delete rec.extraReviews;
  const mediaShots = clampMediaShots(rec.mediaShots);
  if (mediaShots.length > 0) rec.mediaShots = mediaShots;
  else delete rec.mediaShots;
  const motionPolicy = coerceMotionPolicy(rec.motionPolicy);
  if (motionPolicy) rec.motionPolicy = motionPolicy;
  else delete rec.motionPolicy;
  if (Array.isArray(rec.sections)) {
    rec.sections = rec.sections.flatMap((section) => {
      const coerced = coerceSection(section);
      return coerced ? [coerced] : [];
    });
  }
  return rec;
}

export function formatZodIssueList(error: z.ZodError, limit = 8): string {
  return error.issues
    .slice(0, limit)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Fallback chrome: split-media named hero → split; else centered. No photos → centered. */
export function heroLayoutFromCatalog(options: {
  catalogRef?: string;
  photoCount: number;
}): "split" | "centered" {
  if (options.photoCount === 0) return "centered";
  if (!options.catalogRef) return "centered";
  const entry = getCatalogEntryById(options.catalogRef);
  return entry?.layoutFamily === "split-media" ? "split" : "centered";
}

function allowedCatalogIds(
  shortlist: Record<CatalogEligibleSection, ComponentCatalogEntry[]>,
  sectionType: string,
): Set<string> {
  if (!isCatalogEligibleSection(sectionType)) return new Set();
  return new Set((shortlist[sectionType] ?? []).map((entry) => entry.id));
}

function catalogEntryFromShortlist(
  shortlist: Record<CatalogEligibleSection, ComponentCatalogEntry[]>,
  sectionType: CatalogEligibleSection,
  id: string,
): ComponentCatalogEntry | null {
  return shortlist[sectionType]?.find((entry) => entry.id === id) ?? getCatalogEntryById(id);
}

/** Drop refs that cannot be realized from evidence or the accepted structural intent. */
function catalogRefAllowed(options: {
  catalogRef: string;
  sectionType: string;
  photoCount: number;
  anchorCount: number;
  designIntent: DesignBrief["designSpec"]["designIntent"];
  shortlist: Record<CatalogEligibleSection, ComponentCatalogEntry[]>;
}): boolean {
  const { catalogRef, sectionType, photoCount, anchorCount, designIntent, shortlist } = options;
  if (!isCatalogEligibleSection(sectionType)) return false;
  if (!executableNamedLayoutForSection(sectionType, catalogRef)) return false;
  const allowed = allowedCatalogIds(shortlist, sectionType);
  if (!allowed.has(catalogRef)) return false;
  const entry = catalogEntryFromShortlist(shortlist, sectionType, catalogRef);
  if (!entry?.layoutFamily) return false;
  if (!namedLayoutFitsRequirements(entry, { photoCount, anchorCount })) return false;
  return allowedCompositionFamilies(designIntent, sectionType).includes(entry.layoutFamily);
}

function pickCatalogRef(options: {
  rawRef?: string;
  sectionType: CanonicalSectionType;
  photoCount: number;
  anchorCount: number;
  designIntent: DesignBrief["designSpec"]["designIntent"];
  shortlist: Record<CatalogEligibleSection, ComponentCatalogEntry[]>;
}): string | undefined {
  const { rawRef, sectionType, photoCount, anchorCount, designIntent, shortlist } = options;
  if (!isCatalogEligibleSection(sectionType)) return undefined;
  if (
    rawRef &&
    catalogRefAllowed({
      catalogRef: rawRef,
      sectionType,
      photoCount,
      anchorCount,
      designIntent,
      shortlist,
    })
  ) {
    return rawRef;
  }
  return undefined;
}

/** Drop illegal / media-requiring catalog refs; coerce motion for lookAndFeel. */
export function sanitizeDesignBrief(
  brief: DesignBrief,
  options: {
    photoCount: number;
    lookAndFeel: string;
    shortlist: Record<CatalogEligibleSection, ComponentCatalogEntry[]>;
    primaryColor?: string;
    quoteCount?: number;
    trustMarkerCount?: number;
    warranty?: string | null;
    hours?: string | null;
  },
): DesignBrief {
  const intensity = motionIntensityForLookAndFeel(options.lookAndFeel);
  const pulseCta = intensity === "minimal" ? false : brief.motionPolicy?.pulseCta === true;
  const primaryColor = options.primaryColor?.trim() || "";
  const intent = brief.designSpec?.designIntent;
  const snappedTone =
    intent && primaryColor ? snapToneToHarmonious(intent.tone, primaryColor) : intent?.tone;
  const designSpec =
    intent && snappedTone && snappedTone !== intent.tone
      ? { designIntent: { ...intent, tone: snappedTone } }
      : brief.designSpec;

  const byType = new Map<CanonicalSectionType, DesignBrief["sections"][number]>();
  for (const section of brief.sections) {
    if (!byType.has(section.type)) byType.set(section.type, section);
  }

  const sectionTypes = sectionIdsForEvidence({
    trustMarkerCount: options.trustMarkerCount ?? 0,
    imageCount: options.photoCount,
    reviewCount: options.quoteCount ?? 0,
    warranty: options.warranty,
    hours: options.hours,
  });
  const anchorCount = headerNavItems(sectionTypes).length;
  const sections = sectionTypes.map((type) => {
    const raw = byType.get(type);
    const catalogRef = pickCatalogRef({
      rawRef: raw?.catalogRef,
      sectionType: type,
      photoCount: options.photoCount,
      anchorCount,
      designIntent: designSpec.designIntent,
      shortlist: options.shortlist,
    });
    const defaultEntrance = NO_MOTION_SECTIONS.has(type) ? "none" : "fadeUp";
    const defaultHover =
      type === "beforeAfter" ? "zoomMedia" : type === "services" ? "lift" : "none";
    const defaultClick = type === "hero" || type === "contact" ? "quoteCta" : "none";
    return {
      id: raw?.id ?? type,
      type,
      heading: raw?.heading ?? "",
      body: raw?.body ?? "",
      ...(catalogRef ? { catalogRef } : {}),
      entrance: raw?.entrance ?? defaultEntrance,
      ...(raw?.stagger !== undefined ? { stagger: raw.stagger } : {}),
      hover: raw?.hover ?? defaultHover,
      click: raw?.click ?? defaultClick,
    };
  });

  for (const section of sections) {
    if (NO_MOTION_SECTIONS.has(section.type)) {
      section.entrance = "none";
    }
    if (!isCatalogEligibleSection(section.type)) {
      delete section.catalogRef;
    }
  }

  return {
    persona: brief.persona,
    designSpec,
    sections,
    extraReviews: brief.extraReviews,
    mediaShots: clampMediaShots(brief.mediaShots),
    motionPolicy: { intensity, pulseCta },
  };
}

export function catalogRefsFromBrief(brief: DesignBrief): string[] {
  return brief.sections
    .map((section) => section.catalogRef)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

const COMPOSITION_SECTION_ORDER: CatalogEligibleSection[] = [
  "hero",
  "services",
  "beforeAfter",
  "reviews",
  "footer",
];

/** All composition fingerprints still realizable after the brief fixes any named families. */
export function feasibleBriefCompositionFingerprints(
  brief: DesignBrief,
  options: { photoCount: number },
): string[] {
  const present = new Set(brief.sections.map((section) => section.type));
  let fingerprints = [""];
  for (const sectionType of COMPOSITION_SECTION_ORDER) {
    if (!present.has(sectionType)) continue;
    const section = brief.sections.find((item) => item.type === sectionType);
    const entry = section?.catalogRef ? getCatalogEntryById(section.catalogRef) : null;
    let families = entry?.layoutFamily
      ? [entry.layoutFamily]
      : [...allowedCompositionFamilies(brief.designSpec.designIntent, sectionType)];
    if (options.photoCount === 0) {
      if (sectionType === "hero") families = families.filter((family) => family === "type-only");
      if (sectionType === "services")
        families = families.filter((family) => family !== "split-media");
    }
    if (families.length === 0) return [];
    fingerprints = fingerprints.flatMap((prefix) =>
      families.map((family) => `${prefix}${prefix ? "|" : ""}${sectionType}:${family}`),
    );
  }
  return fingerprints.filter(Boolean);
}

/** True only when loaded prior fingerprints exhaust every composition the accepted brief can realize. */
export function fixedBriefCompositionCollides(
  brief: DesignBrief,
  options: { photoCount: number; forbiddenLayouts: ReadonlySet<string> },
): boolean {
  const feasible = feasibleBriefCompositionFingerprints(brief, options);
  return (
    feasible.length > 0 &&
    feasible.every((fingerprint) =>
      [...options.forbiddenLayouts].some((prior) => layoutsCollide(fingerprint, prior)),
    )
  );
}

export function formatCatalogShortlist(
  shortlist: Record<CatalogEligibleSection, ComponentCatalogEntry[]>,
): string {
  const lines: string[] = [];
  for (const [section, category] of Object.entries(CATALOG_SECTION_CATEGORIES) as Array<
    [CatalogEligibleSection, string]
  >) {
    const entries = shortlist[section];
    if (entries.length === 0) {
      lines.push(`${section} (${category}): (none for this trade)`);
      continue;
    }
    lines.push(
      `${section} (${category}): ${entries
        .map((entry) => {
          const title = entry.title ?? entry.block_filename;
          const family = entry.layoutFamily ? ` family=${entry.layoutFamily}` : "";
          const sketch = entry.layoutSketch ? ` — ${entry.layoutSketch}` : "";
          const mood = entry.mood_tags.length ? ` [${entry.mood_tags.join(", ")}]` : "";
          return `${entry.id} "${title}"${family}${sketch}${mood}`;
        })
        .join("; ")}`,
    );
  }
  return lines.join("\n");
}

export function designSystemPrompt(options?: {
  primaryColor?: string;
  sectionIds?: readonly string[];
}): string {
  const toneIds = options?.primaryColor ? tonesForPrimaryColor(options.primaryColor) : undefined;
  const ids = (options?.sectionIds ?? REQUIRED_SECTION_TYPES).join(", ");
  return `You are a California contractor brand designer and information architect. Return ONLY valid JSON matching the requested schema. Do not write TSX, HTML, or themeSource. Ground every factual claim in the provided identity and fact sheet — never invent reviews, ratings, licenses, credentials, photos, or URLs. Use neutral copy when data is missing.

${LANDING_PAGE_PRINCIPLES}

Design system: pick designIntent names from the curated tables (${designIntentContractText(toneIds)}). designIntent is also structural: quiet favors type-only/stacked heroes and rows/type-only/featured sections; loud favors split/overlay heroes and cards/grid/featured/mosaic sections; compact balanced favors type-only/split heroes and rows/grid/cards sections. Choose catalogRef only when its shortlist layout family fits. lookAndFeel is a tone hint for pairing/tone and motion intensity (professional → minimal, no pulse; modern → subtle; funky → lively). Code derives fonts, radius, space, and the neutral ramp — do not write fontDisplay, h1/h2/h3, radius, or bandPad as designSpec fields.

Information architecture: these sections in order: ${ids}. Required spine: hero, services, contact, footer. Include trustmarkers, beforeAfter, reviews, warranty, and hours only when the fact sheet has that evidence — do not pad empty bands. Hero is brand + short positioning + booking CTA. Trustmarkers owns credentials. Services owns scope. beforeAfter is honest project photos ("Our work"). Reviews are attributed quotes only. Warranty and hours are fact-sheet copy when present. Contact is the quote form. Footer is legal/identity.

UX: entrance is required. trustmarkers, contact, and footer MUST be "none" (omitting entrance is not "no motion"). Hover is one of lift | underline | zoomMedia | grow | none. Click is one of quoteCta | nav | tel | mailto | none — tel/mailto only when the fact sheet has a phone or address; never invent handlers.

Catalog: catalogRef is optional for hero, services, beforeAfter, reviews, and footer. Use only an id from that section's shortlist when that named composition fits; otherwise omit it so code may realize a freehand or grouped composition. Sections with catalogRef become NamedLayout; sections without it must be implemented with SiteKit primitives. trustmarkers, contact, warranty, and hours are kit-only — omit catalogRef. Shortlist is title + sketch; do not copy HTML. Do not emit layoutIntent.

When the fact sheet has zero photos, do not pick a media-requiring catalogRef (type-only heroes, no gallery). Generated brand stills/clips do not count as project photos for beforeAfter.

${MEDIA_SHOTS_PLAN_CONTRACT}`;
}

export function designUserPrompt(options: {
  variantKey: string;
  factSheet: SiteFactSheet;
  contactHidden: boolean;
  priorNote: string;
  retryNote: string;
  shortlist: Record<CatalogEligibleSection, ComponentCatalogEntry[]>;
}): string {
  const photoCount = evidenceStillCount(options.factSheet.images, { requireUsablePersisted: true });
  const quoteCount = options.factSheet.reviews.length;
  const sectionIds = sectionIdsForEvidence({
    trustMarkerCount: options.factSheet.trustMarkers.length,
    imageCount: photoCount,
    reviewCount: quoteCount,
    warranty: options.factSheet.warranty,
    hours: options.factSheet.hours,
  });
  const intensity = motionIntensityForLookAndFeel(options.factSheet.lookAndFeel);
  const tradeServices = formatTypicalServicesForDesign(options.factSheet.trade);
  const tradeServicesBlock = tradeServices
    ? `\nTrade services vocabulary (always use when writing the services section; do not skip because onboarding services is already filled):\n${tradeServices}\n`
    : "";
  const allowedTones = tonesForPrimaryColor(options.factSheet.primaryColor);
  const toneBlock = `tone must be one of: ${allowedTones.join(", ")} (others clash with the brand hex and will be snapped).`;
  return `Variant key: ${options.variantKey}
${options.priorNote}${options.retryNote}

Work in this order: (1) decide customer, offering, place, proof, visualDirection, and conversionAsk — conversionAsk is the 2–4 word booking button label (e.g. "Book now"); those belong on optional persona as those six fields, or omit persona; do not put a sentence in persona. (2) what proof exists — 0 photos means no portfolio; ${quoteCount} quote(s) means that many attributed quotes; (3) what would make a stranger hire them? (4) pick designIntent from the curated tables; ${toneBlock} (5) specify section copy, entrance/hover/click, and optional catalogRef from the shortlist.

contactHidden: ${options.contactHidden}. If true, still include a contact section in the brief but do not plan LeadSlot or booking CTAs — code will omit them.
photoCount: ${photoCount} (real project photos only; generated stills do not count). quoteCount: ${quoteCount}.
lookAndFeel: ${options.factSheet.lookAndFeel} (motion intensity ${intensity}; professional forbids pulseCta).
Primary hex ${options.factSheet.primaryColor} is the brand seed.
${tradeServicesBlock}
Catalog shortlist (pick 0–1 id per eligible section, or omit):
${formatCatalogShortlist(options.shortlist)}

Identity + fact sheet (identity-gated; empty arrays are allowed and must not be invented):
${JSON.stringify(options.factSheet, null, 2)}

Return JSON with: optional persona ({ customer, offering, place, proof, visualDirection, conversionAsk } — omit the key rather than a sentence), designSpec ({ designIntent: { pairing, scale, baseSize, density, tone, corners, emphasis } }), sections (id, type, heading, body, entrance, hover, click, optional stagger, optional catalogRef — types exactly [${sectionIds.join(",")}]), optional extraReviews (only quotes from the fact sheet), optional mediaShots, motionPolicy ({ intensity, pulseCta }). Hero heading may be a short positioning line. beforeAfter heading should be honest project-photo copy (e.g. "Our work"). No themeSource. No layoutIntent.`;
}

export function collectCatalogShortlist(
  trade?: string,
  photoCount?: number,
  quoteCount?: number,
  anchorCount?: number,
) {
  return catalogShortlistForDesign(trade, 4, photoCount, quoteCount, anchorCount);
}
