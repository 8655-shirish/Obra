/**
 * Isomorphic evidence curation for contractor landing pages.
 * Used at projection (config write) and in SiteRenderer (visitor-visible gate).
 * No Node APIs — the renderer is a client component.
 */

export const LOOK_AND_FEEL_SKINS = ["professional", "funky", "modern"] as const;
export type LookAndFeelSkin = (typeof LOOK_AND_FEEL_SKINS)[number];

/** CSS values for SiteRenderer skins and old generated configs without token designSpec. */
export function lookAndFeelPaintTokens(feel: LookAndFeelSkin): {
  radius: string;
  bandPad: string;
  h1: string;
  h2: string;
  h3: string;
} {
  if (feel === "modern") {
    return { radius: "1rem", bandPad: "4rem", h1: "2.75rem", h2: "2rem", h3: "1.375rem" };
  }
  if (feel === "funky") {
    return { radius: "0.75rem", bandPad: "3.5rem", h1: "2.5rem", h2: "1.875rem", h3: "1.25rem" };
  }
  return { radius: "1rem", bandPad: "3.5rem", h1: "2.25rem", h2: "1.75rem", h3: "1.25rem" };
}

export type MediaOrigin = "evidence" | "generated";
export type MediaOrientation = "landscape" | "portrait" | "square";

export type EvidenceMediaItem = {
  url?: string;
  mimeType?: string;
  storagePath?: string;
  alt?: string;
  origin?: MediaOrigin;
  platform?: string;
  width?: number;
  height?: number;
  aspect?: number;
  orientation?: MediaOrientation;
  contentHash?: string;
  provenance?: {
    kind: MediaOrigin;
    sourceUrl?: string;
    platform?: string;
    storageBucket?: "site-media" | "chat-attachments";
  };
  proofEligible?: boolean;
  generationSlotId?: string;
  videoSourceSlotId?: string;
};

export function isGeneratedMedia(item: { origin?: string } | null | undefined): boolean {
  return item?.origin === "generated";
}

export function evidenceMediaItems<T extends { origin?: string }>(items: T[]): T[] {
  return items.filter((item) => !isGeneratedMedia(item));
}

export function generatedMediaItems<T extends { origin?: string }>(items: T[]): T[] {
  return items.filter((item) => isGeneratedMedia(item));
}

export function isVideoMediaItem(item: { mimeType?: string; url?: string }): boolean {
  const mime = (item.mimeType ?? "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  if (mime === "image/gif") return false;
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(item.url ?? "");
}

export const MIN_USABLE_EVIDENCE_EDGE = 320;

export function isProofEligibleStillMimeType(mimeType: string | undefined): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp";
}

export function usableEvidenceStills(items: EvidenceMediaItem[]): EvidenceMediaItem[] {
  const seen = new Set<string>();
  return evidenceMediaItems(items).filter((item) => {
    const mime = (item.mimeType ?? "").toLowerCase();
    const hash = item.contentHash?.trim();
    const path = item.storagePath?.trim();
    if (!item.url?.trim() || !path || /^https?:\/\//i.test(path)) return false;
    if (!isProofEligibleStillMimeType(mime) || isVideoMediaItem(item)) return false;
    if (!hash || seen.has(hash)) return false;
    if (!Number.isSafeInteger(item.width) || !Number.isSafeInteger(item.height)) return false;
    if (item.width! < MIN_USABLE_EVIDENCE_EDGE || item.height! < MIN_USABLE_EVIDENCE_EDGE)
      return false;
    if (item.provenance?.kind !== "evidence" || !item.provenance.sourceUrl?.trim()) return false;
    if (item.proofEligible !== true) return false;
    seen.add(hash);
    return true;
  });
}

export function evidenceStillCount(
  items: EvidenceMediaItem[],
  options: { requireUsablePersisted?: boolean } = {},
): number {
  return options.requireUsablePersisted
    ? usableEvidenceStills(items).length
    : evidenceMediaItems(items).filter((item) => Boolean(item.url) && !isVideoMediaItem(item))
        .length;
}

export type EvidenceReview = {
  quote: string;
  author?: string;
  source?: string;
};

export type EvidenceTrustMarker = {
  id: string;
  label: string;
  detail?: string;
  href?: string;
  kind: string;
};

const GALLERY_CAP = 6;

const TRUST_HOSTS: Record<string, string[]> = {
  google: ["google.com", "maps.app.goo.gl"],
  yelp: ["yelp.com"],
  angi: ["angi.com", "angieslist.com"],
  bbb: ["bbb.org"],
  houzz: ["houzz.com"],
};

/** Small keyword table — not a classifier. Contractor family vs named-other-family. */
const TRADE_FAMILIES: Array<{
  family: string;
  tradeHints: string[];
  quoteHints: string[];
}> = [
  {
    family: "painting",
    tradeHints: ["paint", "painter", "painting", "c-33", "c33", "decorating"],
    quoteHints: ["paint", "painter", "painting"],
  },
  {
    family: "roofing",
    tradeHints: ["roof", "roofer", "roofing", "c-39", "c39"],
    quoteHints: ["roof", "roofer", "roofing", "shingle"],
  },
  {
    family: "plumbing",
    tradeHints: ["plumb", "plumber", "plumbing", "c-36", "c36"],
    quoteHints: ["plumb", "plumber", "plumbing"],
  },
  {
    family: "electrical",
    tradeHints: ["electric", "electrician", "electrical", "c-10", "c10"],
    quoteHints: ["electric", "electrician", "electrical", "wiring"],
  },
  {
    family: "hvac",
    tradeHints: ["hvac", "heating", "air conditioning", "c-20", "c20"],
    quoteHints: ["hvac", "furnace", "air conditioning"],
  },
  {
    family: "landscaping",
    tradeHints: ["landscape", "landscaping", "c-27", "c27"],
    quoteHints: ["landscape", "landscaping", "irrigation"],
  },
];

const MODERN_HINTS = ["modern", "contemporary", "clean", "eco", "minimal"];
const FUNKY_HINTS = ["funky", "playful", "bold", "vibrant", "energetic"];

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function hostnameOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function hostMatches(hostname: string, allowed: string[]): boolean {
  return allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function queryDim(url: URL, keys: string[]): number | null {
  for (const key of keys) {
    const raw = url.searchParams.get(key);
    if (raw == null || raw === "") continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function isMarketingChrome(url: URL): boolean {
  const host = hostnameOf(url);
  const path = url.pathname.toLowerCase();
  if (host.includes("homeadvisor.com") && path.includes("/images/consumer")) return true;
  if (path.includes("/images/consumer")) return true;
  if (host.includes("doubleclick.net") || host.includes("googlesyndication.com")) return true;
  return false;
}

function isTinyCrop(url: URL): boolean {
  const width = queryDim(url, ["width", "w"]);
  const height = queryDim(url, ["height", "h"]);
  if (width != null && width <= 100) return true;
  if (height != null && height <= 100) return true;
  return false;
}

function isSmallHouzzThumb(raw: string, url: URL): boolean {
  const host = hostnameOf(url);
  const lower = raw.toLowerCase();
  const houzzish =
    host.includes("houzz.com") || host.includes("hzcdn.com") || lower.includes("/fimgs/");
  if (!houzzish) return false;
  const match = lower.match(/[/_-]w(\d{2,4})(?:[-._h]|$)/);
  if (match) {
    const w = Number.parseInt(match[1], 10);
    if (Number.isFinite(w) && w > 0 && w <= 400) return true;
  }
  return /w390/.test(lower);
}

function isSmallYelpThumb(_raw: string, url: URL): boolean {
  const host = hostnameOf(url);
  if (!host.includes("yelpcdn.com") && !host.includes("yelp.com")) return false;
  const path = url.pathname.toLowerCase();
  return /\/(?:ls|ms|90s|168s|258s|s)\.jpe?g$/i.test(path);
}

function isUnsplashNamed(raw: string): boolean {
  return raw.toLowerCase().includes("unsplash-image");
}

function isSvgOrIconUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  if (path.endsWith(".svg") || path.includes(".svg?")) return true;
  if (path.includes("/icon") || path.includes("location.svg") || path.includes("/sprite")) {
    return true;
  }
  return false;
}

/** Directory search / category index — not a contractor listing. */
export function isDirectorySearchUrl(raw: string): boolean {
  const url = parseHttpUrl(raw.trim());
  if (!url) return true;
  const path = url.pathname.toLowerCase();
  if (/(^|\/)search\/?$/.test(path) || path.includes("/search/")) return true;
  if (url.searchParams.has("find_desc") || url.searchParams.has("find_loc")) return true;
  const host = hostnameOf(url);
  if (host.includes("houzz.com") && path.includes("/professionals") && url.search.length > 1) {
    return true;
  }
  return false;
}

export type ListedWebsiteKind = "directory" | "builder" | "vendor" | "custom";

export type ClassifiedListedWebsite = {
  kind: ListedWebsiteKind;
  host: string;
  url: string;
};

const DIRECTORY_LISTING_HOSTS = [
  "google.com",
  "maps.google.com",
  "maps.app.goo.gl",
  "goo.gl",
  "yelp.com",
  "facebook.com",
  "fb.com",
  "instagram.com",
  "angi.com",
  "angieslist.com",
  "houzz.com",
  "bbb.org",
  "thumbtack.com",
  "homeadvisor.com",
  "nextdoor.com",
  "buildzoom.com",
  "cslb.ca.gov",
];

const WEBSITE_BUILDER_HOSTS = [
  "wixsite.com",
  "wix.com",
  "squarespace.com",
  "weebly.com",
  "wordpress.com",
  "godaddysites.com",
  "webflow.io",
];

const VENDOR_SCHEDULING_HOSTS = [
  "housecallpro.com",
  "jobber.com",
  "getjobber.com",
  "servicetitan.com",
  "linktr.ee",
  "bit.ly",
  "bitly.com",
  "calendly.com",
];

function parseListedWebsiteUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return parseHttpUrl(trimmed) ?? parseHttpUrl(`https://${trimmed}`);
}

/** Listing / builder / vendor / custom host. Null when the string is not an http(s) URL. */
export function classifyListedWebsiteUrl(raw: string): ClassifiedListedWebsite | null {
  const url = parseListedWebsiteUrl(raw);
  if (!url) return null;
  const host = hostnameOf(url);
  if (!host) return null;
  if (hostMatches(host, DIRECTORY_LISTING_HOSTS) || isDirectorySearchUrl(url.href)) {
    return { kind: "directory", host, url: url.href };
  }
  if (hostMatches(host, WEBSITE_BUILDER_HOSTS)) {
    return { kind: "builder", host, url: url.href };
  }
  if (hostMatches(host, VENDOR_SCHEDULING_HOSTS)) {
    return { kind: "vendor", host, url: url.href };
  }
  return { kind: "custom", host, url: url.href };
}

/** True when the URL cannot stand as project proof. */
export function isDroppableImageUrl(raw: string): boolean {
  const url = parseHttpUrl(raw.trim());
  if (!url) return true;
  if (isMarketingChrome(url)) return true;
  if (isTinyCrop(url)) return true;
  if (isSmallHouzzThumb(raw, url)) return true;
  if (isSmallYelpThumb(raw, url)) return true;
  if (isSvgOrIconUrl(url)) return true;
  return false;
}

function preferenceRank(item: EvidenceMediaItem): number {
  if (typeof item.storagePath === "string" && item.storagePath.trim()) return 0;
  const lower = (item.url ?? "").toLowerCase();
  if (lower.includes("squarespace-cdn.com") && !isUnsplashNamed(lower)) return 1;
  if (lower.includes("yelpcdn.com") && lower.includes("/bphoto")) return 2;
  return 3;
}

export function curateProjectImages(
  items: EvidenceMediaItem[],
  cap: number = GALLERY_CAP,
): EvidenceMediaItem[] {
  const seen = new Set<string>();
  const evidenceKept: EvidenceMediaItem[] = [];
  const generatedKept: EvidenceMediaItem[] = [];
  for (const item of items) {
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const generated = isGeneratedMedia(item);
    const key = generated
      ? typeof item.storagePath === "string" && item.storagePath.trim()
        ? item.storagePath.trim()
        : url
      : url;
    if (!key || seen.has(key)) continue;
    if (generated) {
      seen.add(key);
      generatedKept.push({ ...item, url: url || key, origin: "generated" });
      continue;
    }
    if (!url || isDroppableImageUrl(url)) continue;
    seen.add(url);
    evidenceKept.push({ ...item, url });
  }

  const nonStock = evidenceKept.filter((item) => !isUnsplashNamed(item.url ?? ""));
  const pool = nonStock.length > 0 ? nonStock : evidenceKept;

  const ranked = pool.map((item, index) => ({
    item,
    index,
    rank: preferenceRank(item),
  }));
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  const evidence = ranked.slice(0, Math.max(0, cap)).map((entry) => entry.item);
  return [...evidence, ...generatedKept];
}

/** Copy storagePath onto items that share a source URL. Does not add ungated URLs. */
export function joinAttestedStills<T extends EvidenceMediaItem>(
  frozen: T[],
  live: EvidenceMediaItem[],
): T[] {
  const overlaid = overlayStoragePathByUrl(frozen, live);
  const seen = new Set<string>();
  for (const item of overlaid) {
    const url = item.url?.trim();
    const hash = item.contentHash?.trim();
    if (url) seen.add(url);
    if (hash) seen.add(hash);
  }
  const extras: T[] = [];
  for (const src of live) {
    const url = src.url?.trim();
    const hash = src.contentHash?.trim();
    const path = src.storagePath?.trim();
    if (!url || !path || /^https?:\/\//i.test(path)) continue;
    if (src.proofEligible !== true || !hash) continue;
    if (seen.has(url) || seen.has(hash)) continue;
    seen.add(url);
    seen.add(hash);
    extras.push(src as T);
  }
  return extras.length === 0 ? overlaid : [...overlaid, ...extras];
}

export function overlayStoragePathByUrl<T extends EvidenceMediaItem>(
  items: T[],
  sources: EvidenceMediaItem[],
): T[] {
  const byUrl = new Map<string, EvidenceMediaItem>();
  for (const src of sources) {
    const url = typeof src.url === "string" ? src.url.trim() : "";
    const storagePath = typeof src.storagePath === "string" ? src.storagePath.trim() : "";
    if (!url || !storagePath) continue;
    byUrl.set(url, src);
  }
  return items.map((item) => {
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url) return item;
    if (typeof item.storagePath === "string" && item.storagePath.trim()) return item;
    const src = byUrl.get(url);
    if (!src?.storagePath) return item;
    return {
      ...item,
      storagePath: src.storagePath,
      ...(src.mimeType ? { mimeType: src.mimeType } : {}),
      ...(src.width ? { width: src.width } : {}),
      ...(src.height ? { height: src.height } : {}),
      ...(src.aspect ? { aspect: src.aspect } : {}),
      ...(src.orientation ? { orientation: src.orientation } : {}),
      ...(src.contentHash ? { contentHash: src.contentHash } : {}),
      ...(src.provenance ? { provenance: src.provenance } : {}),
      ...(typeof src.proofEligible === "boolean" ? { proofEligible: src.proofEligible } : {}),
    };
  });
}

export function trustHrefForKind(
  kind: string,
  href: string | undefined | null,
): string | undefined {
  const trimmed = typeof href === "string" ? href.trim() : "";
  if (!trimmed) return undefined;
  const allowed = TRUST_HOSTS[kind];
  if (!allowed) return undefined;
  const url = parseHttpUrl(trimmed);
  if (!url) return undefined;
  if (!hostMatches(hostnameOf(url), allowed)) return undefined;
  if (isDirectorySearchUrl(trimmed)) return undefined;
  return trimmed;
}

/** BBB is a letter grade. Never emit n/5 for BBB. */
export function formatTrustRatingDetail(
  kind: string,
  rating: string | null | undefined,
  count?: string | null,
): string | undefined {
  const ratingTrim = typeof rating === "string" ? rating.trim() : "";
  const countTrim = typeof count === "string" ? count.trim() : "";
  if (kind === "bbb") {
    if (ratingTrim && /^[\d.]+(?:\/5)?$/.test(ratingTrim)) {
      return countTrim ? `${countTrim} reviews` : undefined;
    }
    const parts = [ratingTrim || null, countTrim ? `${countTrim} reviews` : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : undefined;
  }
  const ratingPart = ratingTrim
    ? ratingTrim.includes("/")
      ? ratingTrim
      : `${ratingTrim}/5`
    : null;
  const parts = [ratingPart, countTrim ? `${countTrim} reviews` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function hintMatches(haystack: string, hint: string): boolean {
  const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(haystack);
}

function familyFromTrade(trade: string): string | null {
  const raw = trade.trim().toLowerCase();
  if (!raw) return null;
  for (const row of TRADE_FAMILIES) {
    if (row.tradeHints.some((hint) => hintMatches(raw, hint))) return row.family;
  }
  return null;
}

function familiesNamedInQuote(quote: string): string[] {
  const raw = quote.toLowerCase();
  const named: string[] = [];
  for (const row of TRADE_FAMILIES) {
    if (row.quoteHints.some((hint) => hintMatches(raw, hint))) named.push(row.family);
  }
  return named;
}

export function isOffTradeQuote(quote: string, trade: string): boolean {
  const contractorFamily = familyFromTrade(trade);
  if (!contractorFamily) return false;
  const named = familiesNamedInQuote(quote);
  return named.some((family) => family !== contractorFamily);
}

export function filterReviewsForTrade(reviews: EvidenceReview[], trade: string): EvidenceReview[] {
  return reviews.filter((review) => {
    const quote = typeof review.quote === "string" ? review.quote.trim() : "";
    if (!quote) return false;
    return !isOffTradeQuote(quote, trade);
  });
}

/** Schema quotes win whenever any exist. Off-trade lines drop either way. */
export function preferSchemaReviews(
  schemaReviews: EvidenceReview[],
  llmReviews: EvidenceReview[],
  trade: string,
): EvidenceReview[] {
  const preferred = schemaReviews.length > 0 ? schemaReviews : llmReviews;
  return filterReviewsForTrade(preferred, trade);
}

export function coerceLookAndFeel(value: unknown): LookAndFeelSkin {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "professional" || raw === "funky" || raw === "modern") return raw;

  const tokens = raw.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (token === "funky" || token === "modern" || token === "professional") return token;
  }

  if (MODERN_HINTS.some((hint) => raw.includes(hint))) return "modern";
  if (FUNKY_HINTS.some((hint) => raw.includes(hint))) return "funky";
  return "professional";
}

function asMediaList(value: unknown): EvidenceMediaItem[] {
  if (!Array.isArray(value)) return [];
  const items: EvidenceMediaItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    items.push(entry as EvidenceMediaItem);
  }
  return items;
}

function asReviewList(value: unknown): EvidenceReview[] {
  if (!Array.isArray(value)) return [];
  const items: EvidenceReview[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.quote !== "string") continue;
    items.push({
      quote: record.quote,
      author: typeof record.author === "string" ? record.author : undefined,
      source: typeof record.source === "string" ? record.source : undefined,
    });
  }
  return items;
}

function asMarkerList(value: unknown): EvidenceTrustMarker[] {
  if (!Array.isArray(value)) return [];
  const items: EvidenceTrustMarker[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.kind !== "string") continue;
    if (typeof record.label !== "string") continue;
    items.push({
      id: record.id,
      kind: record.kind,
      label: record.label,
      detail: typeof record.detail === "string" ? record.detail : undefined,
      href: typeof record.href === "string" ? record.href : undefined,
    });
  }
  return items;
}

export function curateSiteEvidence(config: {
  mediaGallery?: unknown;
  extraReviews?: unknown;
  trustMarkers?: unknown;
  lookAndFeel?: unknown;
  trade?: unknown;
}): {
  mediaGallery: EvidenceMediaItem[];
  extraReviews: EvidenceReview[];
  trustMarkers: EvidenceTrustMarker[];
  lookAndFeel: LookAndFeelSkin;
} {
  const trade = typeof config.trade === "string" ? config.trade : "";
  return {
    mediaGallery: curateProjectImages(asMediaList(config.mediaGallery)),
    extraReviews: filterReviewsForTrade(asReviewList(config.extraReviews), trade),
    trustMarkers: asMarkerList(config.trustMarkers).map((marker) => ({
      ...marker,
      href: trustHrefForKind(marker.kind, marker.href),
    })),
    lookAndFeel: coerceLookAndFeel(config.lookAndFeel),
  };
}
