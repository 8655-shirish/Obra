import manifestJson from "../../../ui-components/manifest.json" with { type: "json" };

import {
  executableNamedLayoutForSection,
  NAMED_LAYOUT_BY_ID,
  NAMED_LAYOUTS,
  type NamedLayoutEntry,
  type NamedLayoutFamily,
  type NamedLayoutSection,
} from "./layout-vocabulary.ts";
import {
  CATALOG_SECTION_CATEGORIES,
  isCatalogEligibleSection,
  type CatalogEligibleSection,
} from "./section-order.ts";

export { CATALOG_SECTION_CATEGORIES, isCatalogEligibleSection };
export type { CatalogEligibleSection };

/** Server-only — manifest bundled at build time; block HTML lives in private storage. */

export interface MarketingBlockManifest {
  source: string;
  bucket: string;
  prefix: string;
  note: string;
  categories: Record<
    string,
    {
      archive: string;
      blocks: string[];
    }
  >;
}

export type CatalogSource = "hyperui" | "marketing-blocks" | "tailblocks" | "merakiui";

export interface ComponentCatalogEntry {
  id: string;
  category: string;
  section_type: string;
  block_filename: string;
  /** Empty for in-repo named layouts (not tarball-backed). */
  archive: string;
  storage_key: string;
  mood_tags: string[];
  trade_tags: string[];
  title?: string;
  source?: CatalogSource;
  canonicalSection?: NamedLayoutSection;
  layoutSketch?: string;
  /** Pinned MIT file compiled into NamedLayout. Never put this on the design prompt. */
  upstream?: string;
  requiresMedia?: boolean;
  requires?: { anchors?: number; media?: number; quotes?: number };
  layoutFamily?: NamedLayoutFamily;
}

const TRADE_CATEGORIES: Record<string, string[]> = {
  "C-33": ["Heroes", "Calls to Action", "Testimonials", "Galleries", "Footers"],
  "C-36": ["Heroes", "Pricing Sections", "Testimonials", "Galleries"],
  B: ["Heroes", "Calls to Action", "Footers", "Testimonials"],
  default: ["Heroes", "Calls to Action", "Footers", "Testimonials", "Galleries"],
};

const MOOD_KEYWORDS = [
  "dark",
  "light",
  "gradient",
  "elegant",
  "minimal",
  "animated",
  "soft",
  "bold",
  "modern",
  "professional",
] as const;

/** hero / heroes / Heroes (and the other mapped sections) are one query. */
const SECTION_ALIASES: Record<string, NamedLayoutSection> = {
  hero: "hero",
  heroes: "hero",
  services: "services",
  service: "services",
  feature: "services",
  features: "services",
  "feature-grids": "services",
  beforeafter: "beforeAfter",
  gallery: "beforeAfter",
  galleries: "beforeAfter",
  reviews: "reviews",
  testimonials: "reviews",
  footer: "footer",
  footers: "footer",
};

let cachedManifest: MarketingBlockManifest | null = null;

export function loadMarketingBlockManifest(): MarketingBlockManifest {
  if (!cachedManifest) {
    cachedManifest = manifestJson as MarketingBlockManifest;
  }
  return cachedManifest;
}

function inferMoodTags(blockFilename: string): string[] {
  const lower = blockFilename.toLowerCase();
  return MOOD_KEYWORDS.filter((keyword) => lower.includes(keyword));
}

function normalizeSectionQuery(sectionType?: string): string {
  return (sectionType ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function resolveCanonicalSection(sectionType?: string): NamedLayoutSection | null {
  const key = normalizeSectionQuery(sectionType);
  if (!key) return null;
  return SECTION_ALIASES[key] ?? null;
}

function namedToCatalogEntry(named: NamedLayoutEntry): ComponentCatalogEntry {
  const parts = named.id.split("/");
  return {
    id: named.id,
    title: named.title,
    category: named.category,
    section_type: named.canonicalSection,
    block_filename: parts.slice(2).join("/") || named.id,
    archive: "",
    storage_key: "",
    mood_tags: named.tags,
    trade_tags: [],
    source: named.source,
    canonicalSection: named.canonicalSection,
    layoutSketch: named.layoutSketch,
    upstream: named.upstream,
    requiresMedia: named.requiresMedia,
    ...(named.requires ? { requires: named.requires } : {}),
    layoutFamily: named.layoutFamily,
  };
}

function marketingToCatalogEntry(options: {
  category: string;
  blockFilename: string;
  archive: string;
  storageKey: string;
  trade?: string;
}): ComponentCatalogEntry {
  const canonical = resolveCanonicalSection(options.category);
  return {
    id: `${options.category}/${options.blockFilename}`,
    category: options.category,
    section_type: options.category,
    block_filename: options.blockFilename,
    archive: options.archive,
    storage_key: options.storageKey,
    mood_tags: inferMoodTags(options.blockFilename),
    trade_tags: options.trade ? [options.trade] : [],
    source: "marketing-blocks",
    ...(canonical ? { canonicalSection: canonical } : {}),
  };
}

function namedMatchesMood(named: NamedLayoutEntry, mood?: string): boolean {
  if (!mood) return true;
  return named.tags.some((tag) => tag.toLowerCase() === mood);
}

function matchingNamedLayouts(
  section?: NamedLayoutSection | null,
  mood?: string,
): NamedLayoutEntry[] {
  return NAMED_LAYOUTS.filter((entry) => {
    if (section && entry.canonicalSection !== section) return false;
    return namedMatchesMood(entry, mood);
  });
}

/** Accept a full named id or a cheap alias (last path segment, e.g. split-media-right). */
export function resolveCatalogRefId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (NAMED_LAYOUT_BY_ID.has(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const byTail = NAMED_LAYOUTS.find((entry) => {
    const tail = entry.id.split("/").pop()?.toLowerCase();
    return tail === lower || entry.id.toLowerCase() === lower;
  });
  return byTail?.id ?? trimmed;
}

/**
 * Look up a single catalog entry by named id first (`hyperui/hero/…`), then
 * marketing `category/blockFilename`. Used to give the website-generator a
 * layout sketch of a component already picked (selection stays on searchComponentCatalog).
 */
export function getCatalogEntryById(id: string): ComponentCatalogEntry | null {
  const named = NAMED_LAYOUT_BY_ID.get(id);
  if (named) return namedToCatalogEntry(named);

  const slash = id.indexOf("/");
  if (slash <= 0) return null;
  const category = id.slice(0, slash);
  const blockFilename = id.slice(slash + 1);

  const manifest = loadMarketingBlockManifest();
  const categoryData = manifest.categories[category];
  if (!categoryData || !categoryData.blocks.includes(blockFilename)) return null;

  return marketingToCatalogEntry({
    category,
    blockFilename,
    archive: categoryData.archive,
    storageKey: `${manifest.prefix}${categoryData.archive}`,
  });
}

function categoriesForTrade(trade?: string): string[] | null {
  if (!trade) return null;
  const normalized = trade.toUpperCase();
  return (
    TRADE_CATEGORIES[normalized] ?? TRADE_CATEGORIES[trade] ?? TRADE_CATEGORIES["default"] ?? null
  );
}

function resolveCategoryOrder(
  manifest: MarketingBlockManifest,
  trade?: string,
  sectionType?: string,
): string[] {
  const tradeCategories = categoriesForTrade(trade);
  let categoryNames = tradeCategories
    ? tradeCategories.filter((name) => manifest.categories[name])
    : Object.keys(manifest.categories);

  const canonical = resolveCanonicalSection(sectionType);
  const marketingCategory = canonical
    ? CATALOG_SECTION_CATEGORIES[canonical].toLowerCase()
    : sectionType?.toLowerCase();

  if (marketingCategory) {
    categoryNames = categoryNames.filter((name) => name.toLowerCase() === marketingCategory);
  }

  return categoryNames;
}

export type CatalogDigestEntry = {
  id: string;
  category: string;
  block_filename: string;
  mood_tags: string[];
  title?: string;
  source?: CatalogSource;
  canonicalSection?: NamedLayoutSection;
  layoutSketch?: string;
  upstream?: string;
  layoutFamily?: NamedLayoutFamily;
  requires?: { anchors?: number; media?: number; quotes?: number };
};

export function catalogDigestForIds(ids: string[]): CatalogDigestEntry[] {
  const seen = new Set<string>();
  const digest: CatalogDigestEntry[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    const entry = getCatalogEntryById(id);
    if (!entry) continue;
    seen.add(id);
    digest.push({
      id: entry.id,
      category: entry.category,
      block_filename: entry.block_filename,
      mood_tags: entry.mood_tags,
      ...(entry.title ? { title: entry.title } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.canonicalSection ? { canonicalSection: entry.canonicalSection } : {}),
      ...(entry.layoutSketch ? { layoutSketch: entry.layoutSketch } : {}),
      ...(entry.upstream ? { upstream: entry.upstream } : {}),
      ...(entry.layoutFamily ? { layoutFamily: entry.layoutFamily } : {}),
      ...(entry.requires ? { requires: entry.requires } : {}),
    });
  }
  return digest;
}

/** Chat tool payload: id, title, sketch, mood — never markup. */
export function toChatCatalogComponent(entry: ComponentCatalogEntry) {
  return {
    id: entry.id,
    category: entry.category,
    section_type: entry.section_type,
    block_filename: entry.block_filename,
    ...(entry.archive ? { archive: entry.archive } : {}),
    ...(entry.storage_key ? { storage_key: entry.storage_key } : {}),
    mood_tags: entry.mood_tags,
    trade_tags: entry.trade_tags,
    ...(entry.title ? { title: entry.title } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.canonicalSection ? { canonicalSection: entry.canonicalSection } : {}),
    ...(entry.layoutSketch ? { layoutSketch: entry.layoutSketch } : {}),
  };
}

function emptyShortlist(): Record<CatalogEligibleSection, ComponentCatalogEntry[]> {
  return {
    hero: [],
    services: [],
    beforeAfter: [],
    reviews: [],
    footer: [],
  };
}

export function namedLayoutFitsRequirements(
  entry: Pick<ComponentCatalogEntry, "canonicalSection" | "requiresMedia" | "requires">,
  options: { photoCount?: number; quoteCount?: number; anchorCount?: number },
): boolean {
  if (options.photoCount === 0) {
    if (entry.canonicalSection === "beforeAfter") return false;
    if (entry.requiresMedia) return false;
  }
  if (entry.requires?.media && (options.photoCount ?? 0) < entry.requires.media) return false;
  if (entry.requires?.quotes && (options.quoteCount ?? 0) < entry.requires.quotes) return false;
  if (entry.requires?.anchors && (options.anchorCount ?? 0) < entry.requires.anchors) return false;
  return true;
}

/** One per family first (file order), then remaining slots by family round. */
function roundRobinByFamily(entries: NamedLayoutEntry[], limit: number): NamedLayoutEntry[] {
  const buckets = new Map<string, NamedLayoutEntry[]>();
  const familyOrder: string[] = [];
  for (const entry of entries) {
    const family = entry.layoutFamily;
    if (!buckets.has(family)) {
      buckets.set(family, []);
      familyOrder.push(family);
    }
    buckets.get(family)!.push(entry);
  }

  const picked: NamedLayoutEntry[] = [];
  let round = 0;
  while (picked.length < limit) {
    let added = false;
    for (const family of familyOrder) {
      const bucket = buckets.get(family)!;
      if (round < bucket.length) {
        picked.push(bucket[round]!);
        added = true;
        if (picked.length >= limit) return picked;
      }
    }
    if (!added) break;
    round += 1;
  }
  return picked;
}

function shortlistNamedLayouts(
  section: CatalogEligibleSection,
  options: { limit: number; photoCount?: number; quoteCount?: number; anchorCount?: number },
): ComponentCatalogEntry[] {
  const eligible = matchingNamedLayouts(section).filter(
    (entry) =>
      executableNamedLayoutForSection(section, entry.id) !== null &&
      namedLayoutFitsRequirements(entry, options),
  );
  return roundRobinByFamily(eligible, options.limit).map(namedToCatalogEntry);
}

/**
 * Generate shortlist — named layouts only, filtered by proof, then family
 * round-robin. Does not pad with marketing-blocks. Chat search is unchanged.
 */
export function catalogShortlistForDesign(
  trade?: string,
  limitPerSection = 4,
  photoCount?: number,
  quoteCount?: number,
  anchorCount?: number,
): Record<CatalogEligibleSection, ComponentCatalogEntry[]> {
  void trade;
  const result = emptyShortlist();
  for (const section of Object.keys(CATALOG_SECTION_CATEGORIES) as CatalogEligibleSection[]) {
    result[section] = shortlistNamedLayouts(section, {
      limit: limitPerSection,
      photoCount,
      quoteCount,
      anchorCount,
    });
  }
  return result;
}

export function searchComponentCatalog(options: {
  sectionType?: string | undefined;
  mood?: string | undefined;
  trade?: string | undefined;
  limit?: number | undefined;
}): ComponentCatalogEntry[] {
  const manifest = loadMarketingBlockManifest();
  const limit = options.limit ?? 5;
  const mood = options.mood?.toLowerCase();
  const canonical = resolveCanonicalSection(options.sectionType);

  const results: ComponentCatalogEntry[] = [];
  const seen = new Set<string>();

  const named = canonical
    ? matchingNamedLayouts(canonical, mood)
    : options.sectionType
      ? []
      : matchingNamedLayouts(null, mood);
  for (const entry of named) {
    if (results.length >= limit) return results;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    results.push(namedToCatalogEntry(entry));
  }

  const categoryNames = resolveCategoryOrder(manifest, options.trade, options.sectionType);

  for (const category of categoryNames) {
    const categoryData = manifest.categories[category];
    if (!categoryData) continue;

    for (const blockFilename of categoryData.blocks) {
      if (results.length >= limit) return results;
      const moodTags = inferMoodTags(blockFilename);
      if (mood && !moodTags.some((tag) => tag.toLowerCase() === mood)) {
        continue;
      }
      const id = `${category}/${blockFilename}`;
      if (seen.has(id)) continue;
      seen.add(id);
      results.push(
        marketingToCatalogEntry({
          category,
          blockFilename,
          archive: categoryData.archive,
          storageKey: `${manifest.prefix}${categoryData.archive}`,
          trade: options.trade,
        }),
      );
    }
  }

  return results;
}
