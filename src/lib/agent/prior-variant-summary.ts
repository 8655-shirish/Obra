import { intentTuple, readDesignIntent } from "../site-theme/design-spec.ts";
import type { SiteDesignSpec } from "../site-theme/types.ts";
import { getCatalogEntryById } from "./catalog.server.ts";
import type { RealizedComposition, RealizedCompositionFamily } from "./composition-policy.ts";
import { describeThemeSections, type LayoutDescriptor } from "./layout-descriptor.ts";
import { CANONICAL_SECTION_TYPES, type CanonicalSectionType } from "./section-order.ts";
import type { NamedLayoutSection } from "./layout-vocabulary.ts";
import { parseStoredUnifiedPlan, type StoredUnifiedPlan } from "./unified-design-brief.ts";

const PRIOR_VERSION_CAP = 4;
const LEGACY_LAYOUT_SPEC_KEYS = ["heroRecipe", "serviceComposition", "chrome"] as const;
const SECTION_IDS = CANONICAL_SECTION_TYPES;
const COMPOSITION_SECTIONS: NamedLayoutSection[] = [
  "hero",
  "services",
  "beforeAfter",
  "reviews",
  "footer",
];

export type StoredVersionRow = { id: string; version_number: number; config_json: unknown };

export type CrossWebsiteVersionRow = StoredVersionRow & {
  website_id: string;
  created_at: string;
};

/** Latest row per other website, preserving query order and enforcing a distinct-site cap. */
export function latestCrossWebsiteVersions(
  rows: CrossWebsiteVersionRow[],
  cap: number,
): StoredVersionRow[] {
  const seenWebsites = new Set<string>();
  const selected: StoredVersionRow[] = [];
  for (const row of rows) {
    if (!row.website_id || seenWebsites.has(row.website_id)) continue;
    seenWebsites.add(row.website_id);
    selected.push({ id: row.id, version_number: row.version_number, config_json: row.config_json });
    if (selected.length >= cap) break;
  }
  return selected;
}

function asConfig(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

function familyFromStructure(
  section: NamedLayoutSection,
  structure: string,
): RealizedCompositionFamily {
  const media = /(?:media|media-prop)/.test(structure);
  const overlay = media && /(?:absolute|inset-|media-prop)/.test(structure);
  const split = media && /(?:flex-row|grid-cols-(?:2|\[))/.test(structure);
  const grid = /(?:grid-cols-|columns-)/.test(structure);
  if (section === "hero")
    return overlay
      ? "overlay-media"
      : split
        ? "split-media"
        : media
          ? "stacked-media"
          : "type-only";
  if (section === "beforeAfter")
    return /columns-/.test(structure) ? "mosaic" : grid ? "grid" : "rows";
  if (section === "services")
    return media && split
      ? "split-media"
      : /card/.test(structure)
        ? "cards"
        : grid
          ? "grid"
          : "rows";
  if (section === "reviews")
    return /card/.test(structure)
      ? "cards"
      : grid
        ? "grid"
        : (structure.match(/quote/g) ?? []).length === 1
          ? "featured"
          : "rows";
  return grid ? "grid" : /(?:flex-row|grid)/.test(structure) ? "rows" : "type-only";
}

export function structuralLayoutDescriptor(config: Record<string, unknown>): LayoutDescriptor {
  const source = typeof config.themeSource === "string" ? config.themeSource.trim() : "";
  const descriptor = describeThemeSections(source);
  const rawIds = Array.isArray(config.component_ids) ? config.component_ids : [];
  for (const value of rawIds) {
    if (typeof value !== "string") continue;
    const entry = getCatalogEntryById(value.trim());
    if (!entry?.canonicalSection || descriptor[entry.canonicalSection].source !== "catalog")
      continue;
    const family = (entry.layoutFamily as RealizedCompositionFamily | undefined) ?? "named-unknown";
    descriptor[entry.canonicalSection] = {
      status: "classified",
      source: "catalog",
      family,
      structure: "catalog:" + family,
    };
  }
  for (const section of COMPOSITION_SECTIONS) {
    const entry = descriptor[section];
    if (entry.status === "classified" && !entry.family && entry.structure)
      entry.family = familyFromStructure(section, entry.structure);
  }
  return descriptor;
}

export function realizedComposition(config: Record<string, unknown>): RealizedComposition {
  const descriptor = structuralLayoutDescriptor(config);
  const composition: RealizedComposition = {};
  for (const section of COMPOSITION_SECTIONS) {
    const family = descriptor[section].family;
    if (family) composition[section] = family as RealizedCompositionFamily;
  }
  return composition;
}

function compositionKey(config: Record<string, unknown>): string | undefined {
  const descriptor = structuralLayoutDescriptor(config);
  const parts = CANONICAL_SECTION_TYPES.map((section) => {
    const entry = descriptor[section];
    return (
      section +
      ":" +
      (entry.status === "classified"
        ? entry.family
          ? entry.family + "@" + (entry.structure ?? entry.family)
          : (entry.structure ?? "unclassifiable")
        : entry.status)
    );
  });
  return parts.some((part) => !part.endsWith(":missing")) ? parts.join("|") : undefined;
}
export function summarizeThemeLayout(config: Record<string, unknown>): string | undefined {
  if (config.themeFallback === true) return "fallback chrome";
  return compositionKey(config) ?? readLayoutHint(config);
}
const SKIP_LAYOUT_KEYS = new Set(["unknown", "fallback chrome"]);
export function layoutFingerprint(config: Record<string, unknown>): string {
  return summarizeThemeLayout(config) ?? "unknown";
}
const CORE_COLLISION_SECTIONS: CanonicalSectionType[] = ["hero", "services", "contact", "footer"];
function fingerprintParts(fingerprint: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of fingerprint.split("|")) {
    const colon = part.indexOf(":");
    if (colon <= 0) continue;
    const value = part.slice(colon + 1);
    // Catalog and freehand sections share the same realized family domain. Keep the
    // detailed structure in persisted fingerprints for diagnostics, but compare the
    // normalized family so changing implementation syntax cannot evade diversity.
    parts.set(part.slice(0, colon), value.split("@", 1)[0]);
  }
  return parts;
}
export function layoutsCollide(candidate: string, prior: string): boolean {
  if (SKIP_LAYOUT_KEYS.has(candidate) || SKIP_LAYOUT_KEYS.has(prior)) return false;
  const left = fingerprintParts(candidate),
    right = fingerprintParts(prior);
  const comparable = CORE_COLLISION_SECTIONS.filter((section) => {
    const a = left.get(section),
      b = right.get(section);
    return (
      a &&
      b &&
      a !== "missing" &&
      b !== "missing" &&
      a !== "unclassifiable" &&
      b !== "unclassifiable"
    );
  });
  return (
    comparable.length >= 3 &&
    comparable.every((section) => left.get(section) === right.get(section))
  );
}
export function findCollidingLayout(
  layout: string,
  forbidden: Iterable<string>,
): string | undefined {
  for (const prior of forbidden) if (layoutsCollide(layout, prior)) return prior;
  return undefined;
}
export function designCollides(
  layout: string,
  intent: string | null | undefined,
  forbidLayouts: ReadonlySet<string>,
  forbidIntents: ReadonlySet<string>,
): boolean {
  return Boolean(
    findCollidingLayout(layout, forbidLayouts) || (intent && forbidIntents.has(intent)),
  );
}

function readLayoutHint(config: Record<string, unknown>): string | undefined {
  if (typeof config.layoutHint === "string") {
    const trimmed = config.layoutHint.trim();
    if (trimmed.length > 0) return trimmed;
  }

  const spec = config.designSpec;
  if (!spec || typeof spec !== "object") return undefined;

  const rec = spec as Record<string, unknown>;
  const legacy = LEGACY_LAYOUT_SPEC_KEYS.map((key) => {
    const value = rec[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }).filter(Boolean);

  return legacy.length > 0 ? legacy.join("; ") : undefined;
}

function catalogIdsFromConfig(config: Record<string, unknown>): string[] {
  const raw = Array.isArray(config.component_ids) ? config.component_ids : [];
  return [
    ...new Set(
      raw
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  ].sort();
}

function appendVariantLayoutMeta(config: Record<string, unknown>, base: string): string {
  const variantKey =
    typeof config.variantKey === "string" && config.variantKey.trim()
      ? config.variantKey.trim()
      : null;
  const heroLayout = String(config.heroLayout ?? "centered");
  const layout = summarizeThemeLayout(config);
  const ids = catalogIdsFromConfig(config);

  const meta = [
    variantKey ? `variant ${variantKey}` : null,
    `hero ${heroLayout}`,
    layout ? `layout ${layout}` : null,
    ids.length > 0 ? `catalog ${ids.join(",")}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return meta ? `${base}; ${meta}` : base;
}

export function summarizeVariantConfig(config: Record<string, unknown>): string {
  const spec = config.designSpec;
  if (spec && typeof spec === "object") {
    const rec = spec as Partial<SiteDesignSpec>;
    const intent = readDesignIntent(spec);
    const base = intent
      ? `designIntent ${intentTuple(intent)}`
      : `designSpec font ${String(rec.fontDisplay ?? "")}/${String(rec.fontSans ?? "")}, type ${String(rec.h1 ?? "")}/${String(rec.h2 ?? "")}/${String(rec.h3 ?? "")}, radius ${String(rec.radius ?? "")}, bandPad ${String(rec.bandPad ?? "")}`;
    return appendVariantLayoutMeta(config, base);
  }

  const sections = Array.isArray(config.sections)
    ? (config.sections as Array<{ type?: string; heading?: string }>)
    : [];
  const headings = sections.map((s) => `${s.type}: ${s.heading ?? ""}`).join("; ");
  const base = headings ? `sections: ${headings}` : "sections: (none)";
  return appendVariantLayoutMeta(config, base);
}

export function joinPriorVariantSummaries(
  parts: Array<string | undefined | null>,
): string | undefined {
  const joined = parts
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" | ");
  return joined.length > 0 ? joined : undefined;
}

/** Explicitly viewed row first, then newest rows, with unique ids and the cap still enforced. */
export function selectPriorVersionRows(
  rows: StoredVersionRow[],
  emphasizeVersionId?: string | null,
): StoredVersionRow[] {
  const byId = new Map<string, StoredVersionRow>();
  for (const row of rows) {
    const current = byId.get(row.id);
    if (!current || row.version_number > current.version_number) byId.set(row.id, row);
  }

  const newest = [...byId.values()].sort((a, b) => b.version_number - a.version_number);
  const emphasized = emphasizeVersionId ? byId.get(emphasizeVersionId) : undefined;
  return [
    ...(emphasized ? [emphasized] : []),
    ...newest.filter((row) => row.id !== emphasized?.id),
  ].slice(0, PRIOR_VERSION_CAP);
}

/** Summaries from persisted versions, optional explicitly viewed version first. */
export function buildStoredPriorVariantSummary(
  rows: StoredVersionRow[],
  emphasizeVersionId?: string | null,
): string | undefined {
  const selected = selectPriorVersionRows(rows, emphasizeVersionId);
  return joinPriorVariantSummaries(
    selected.map((row) => summarizeVariantConfig(asConfig(row.config_json))),
  );
}

export function priorLayoutFingerprints(rows: StoredVersionRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const fp = layoutFingerprint(asConfig(row.config_json));
    if (SKIP_LAYOUT_KEYS.has(fp) || seen.has(fp)) continue;
    seen.add(fp);
    out.push(fp);
  }
  return out;
}

/** Intent tuples from rows that have a readable designIntent. Seven-field rows contribute none. */
/** New-schema unified plans only; legacy rows deliberately contribute no inferred tuple. */
export function priorUnifiedPlans(
  rows: StoredVersionRow[],
  emphasizeVersionId?: string | null,
): StoredUnifiedPlan[] {
  return selectPriorVersionRows(rows, emphasizeVersionId)
    .map((row) => parseStoredUnifiedPlan(row.config_json))
    .filter((plan): plan is StoredUnifiedPlan => plan !== null);
}

export function priorUnifiedRecipeIds(rows: StoredVersionRow[]): string[] {
  return priorUnifiedPlans(rows).map((plan) => plan.brief.recipeId);
}

export function priorIntentTuples(rows: StoredVersionRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const intent = readDesignIntent(asConfig(row.config_json).designSpec);
    if (!intent) continue;
    const key = intentTuple(intent);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
