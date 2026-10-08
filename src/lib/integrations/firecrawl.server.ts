import { isAbortError } from "../agent/abort.server.ts";
import { hitMatchesContractor } from "../site-fact-sheet.ts";
import { isRetryableFirecrawlStatus } from "./firecrawl-retry.ts";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

export interface FirecrawlScrapeResult {
  success: boolean;
  platform: string;
  data: Record<string, unknown>;
  error?: string;
  retryable?: boolean;
}

export interface EnrichmentImageRef {
  url: string;
  platform: string;
  alt?: string;
}

/** Structured contractor listing fields extracted via Firecrawl json format. */
export interface ContractorListingExtract {
  business_name?: string | null;
  rating?: number | string | null;
  review_count?: number | string | null;
  phone?: string | null;
  address?: string | null;
  hours?: string | null;
  website?: string | null;
  services?: string[] | null;
  review_quotes?: Array<{ quote?: string; author?: string }> | null;
  photo_urls?: string[] | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
}

const MAX_IMAGES_PER_PLATFORM = 3;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

const CONTRACTOR_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    business_name: { type: "string" },
    rating: { type: ["number", "string"] },
    review_count: { type: ["number", "string"] },
    phone: { type: "string" },
    address: { type: "string" },
    hours: { type: "string" },
    website: { type: "string" },
    services: { type: "array", items: { type: "string" } },
    review_quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          author: { type: "string" },
        },
      },
    },
    photo_urls: { type: "array", items: { type: "string" } },
    facebook_url: { type: "string" },
    instagram_url: { type: "string" },
  },
} as const;

const EXTRACT_PROMPT =
  "Extract contractor/business listing facts only when clearly present on the page: business name, rating, review count, phone, address, hours, official business website URL if listed (not this directory listing page URL), Facebook page URL if listed, Instagram profile URL if listed, services offered, up to 3 short customer review quotes with authors, and direct photo image URLs. Leave fields empty when unknown — never invent.";

function isLikelyImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("//");
}

function normalizeImageUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || !isLikelyImageUrl(trimmed)) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return trimmed;
}

function extractImagesFromMarkdown(markdown: string, platform: string): EnrichmentImageRef[] {
  const images: EnrichmentImageRef[] = [];
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_RE)) {
    const alt = match[1]?.trim();
    const url = normalizeImageUrl(match[2] ?? "");
    if (!url) continue;
    images.push({
      url,
      platform,
      alt: alt || undefined,
    });
    if (images.length >= MAX_IMAGES_PER_PLATFORM) break;
  }
  return images;
}

function extractPhotoUrlsFromJson(
  extract: ContractorListingExtract | null,
  platform: string,
): EnrichmentImageRef[] {
  if (!extract?.photo_urls || !Array.isArray(extract.photo_urls)) return [];
  const images: EnrichmentImageRef[] = [];
  for (const raw of extract.photo_urls) {
    const url = typeof raw === "string" ? normalizeImageUrl(raw) : null;
    if (!url) continue;
    images.push({ url, platform });
    if (images.length >= MAX_IMAGES_PER_PLATFORM) break;
  }
  return images;
}

function readHitExtract(hit: Record<string, unknown>): ContractorListingExtract | null {
  const candidates = [hit.json, hit.extract, hit.llm_extraction];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as ContractorListingExtract;
    }
  }
  return null;
}

/**
 * Firecrawl v1 /search: markdown for raw text + json extract for structured listing fields.
 * Images also come from extract photo_urls and markdown `![alt](url)` links.
 */
function extractImagesFromHit(
  hit: Record<string, unknown>,
  platform: string,
): EnrichmentImageRef[] {
  const fromJson = extractPhotoUrlsFromJson(readHitExtract(hit), platform);
  if (fromJson.length >= MAX_IMAGES_PER_PLATFORM) {
    return fromJson.slice(0, MAX_IMAGES_PER_PLATFORM);
  }
  const fromMarkdown =
    typeof hit.markdown === "string" ? extractImagesFromMarkdown(hit.markdown, platform) : [];
  const seen = new Set(fromJson.map((i) => i.url));
  const merged = [...fromJson];
  for (const img of fromMarkdown) {
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    merged.push(img);
    if (merged.length >= MAX_IMAGES_PER_PLATFORM) break;
  }
  return merged;
}

export function extractImagesFromPlatformPartial(
  platform: string,
  partial: Record<string, unknown>,
  identity?: { businessName: string; licenseNumber: string },
): EnrichmentImageRef[] {
  const images: EnrichmentImageRef[] = [];
  const seen = new Set<string>();

  const push = (url: string, alt?: string, imagePlatform?: string) => {
    const normalized = normalizeImageUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    images.push({ url: normalized, platform: imagePlatform ?? platform, alt });
  };

  const results = partial.results as Array<Record<string, unknown>> | undefined;
  let matchedHit = false;
  if (Array.isArray(results)) {
    for (const hit of results) {
      if (identity && !hitMatchesContractor(hit, identity)) continue;
      matchedHit = true;
      for (const img of extractImagesFromHit(hit, platform)) {
        if (seen.has(img.url)) continue;
        seen.add(img.url);
        images.push(img);
        if (images.length >= MAX_IMAGES_PER_PLATFORM) break;
      }
      if (images.length >= MAX_IMAGES_PER_PLATFORM) break;
    }
  }

  // Unattributed top-level photos belong to first-hit packaging. With an
  // identity gate, only ingest them when no per-hit results exist and the
  // partial itself matches this contractor.
  if (identity) {
    if (matchedHit || images.length >= MAX_IMAGES_PER_PLATFORM) {
      return images.slice(0, MAX_IMAGES_PER_PLATFORM);
    }
    if (!hitMatchesContractor(partial, identity)) {
      return images.slice(0, MAX_IMAGES_PER_PLATFORM);
    }
  }

  const topLevel = partial.images;
  if (Array.isArray(topLevel) && images.length < MAX_IMAGES_PER_PLATFORM) {
    for (const entry of topLevel) {
      if (typeof entry === "string") {
        push(entry);
      } else if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const url =
          typeof record.url === "string"
            ? record.url
            : typeof record.src === "string"
              ? record.src
              : null;
        const alt = typeof record.alt === "string" ? record.alt : undefined;
        const imagePlatform = typeof record.platform === "string" ? record.platform : platform;
        if (url) push(url, alt, imagePlatform);
      }
      if (images.length >= MAX_IMAGES_PER_PLATFORM) break;
    }
  }

  // photo_urls may also sit at platform-partial top level after scrape packaging
  const topExtract = partial.extract;
  if (topExtract && typeof topExtract === "object" && !Array.isArray(topExtract)) {
    for (const img of extractPhotoUrlsFromJson(topExtract as ContractorListingExtract, platform)) {
      push(img.url, img.alt, img.platform);
      if (images.length >= MAX_IMAGES_PER_PLATFORM) break;
    }
  }

  return images.slice(0, MAX_IMAGES_PER_PLATFORM);
}

/** Rebuild the gallery from platform blobs so unmatched URLs cannot linger after a re-merge. */
export function imagesFromMatchedPlatforms(
  enrichment: Record<string, unknown>,
  identity: { businessName: string; licenseNumber: string },
): EnrichmentImageRef[] {
  const platforms =
    enrichment.platforms &&
    typeof enrichment.platforms === "object" &&
    !Array.isArray(enrichment.platforms)
      ? (enrichment.platforms as Record<string, unknown>)
      : {};
  const collected: EnrichmentImageRef[] = [];
  const seen = new Set<string>();
  for (const [platform, value] of Object.entries(platforms)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const img of extractImagesFromPlatformPartial(
      platform,
      value as Record<string, unknown>,
      identity,
    )) {
      if (!img.url || seen.has(img.url)) continue;
      seen.add(img.url);
      collected.push(img);
    }
  }
  return collected;
}

/** First hit's structured extract, if present on the platform partial. */
export function readPlatformExtract(
  partial: Record<string, unknown>,
): ContractorListingExtract | null {
  if (partial.extract && typeof partial.extract === "object" && !Array.isArray(partial.extract)) {
    return partial.extract as ContractorListingExtract;
  }
  const results = partial.results as Array<Record<string, unknown>> | undefined;
  const first = results?.[0];
  if (!first) return null;
  return readHitExtract(first);
}

function getFirecrawlKey(): string | null {
  const key = process.env.FIRECRAWL_API_KEY;
  return key?.trim() ? key : null;
}

function servicesQueryFragment(services: unknown): string {
  if (Array.isArray(services)) {
    return services
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .slice(0, 4)
      .join(" ");
  }
  if (typeof services === "string") return services.trim();
  return "";
}

export async function scrapePlatformContext(
  platform: string,
  context: {
    businessName: string;
    licenseNumber: string;
    trade: string;
    city: string;
    services: unknown;
  },
  options?: { signal?: AbortSignal },
): Promise<FirecrawlScrapeResult> {
  const apiKey = getFirecrawlKey();
  if (!apiKey) {
    return {
      success: false,
      platform,
      data: {},
      error: "FIRECRAWL_API_KEY is not configured — enrichment skipped",
    };
  }

  const query = [
    context.businessName,
    context.trade,
    servicesQueryFragment(context.services),
    context.city,
    "California",
    platform,
    String(context.licenseNumber),
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const response = await fetch(`${FIRECRAWL_BASE}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: options?.signal,
      body: JSON.stringify({
        query,
        limit: 3,
        scrapeOptions: {
          formats: ["markdown", "json"],
          jsonOptions: {
            schema: CONTRACTOR_EXTRACT_SCHEMA,
            prompt: EXTRACT_PROMPT,
          },
        },
      }),
    });

    if (!response.ok) {
      // Degrade: retry markdown-only so a json-format rejection doesn't kill enrichment.
      const text = await response.text();
      if (response.status === 400 || response.status === 422) {
        return scrapePlatformContextMarkdownOnly(apiKey, platform, query, text, options?.signal);
      }
      return {
        success: false,
        platform,
        data: {},
        error: `Firecrawl search failed (${response.status}): ${text.slice(0, 200)}`,
        retryable: isRetryableFirecrawlStatus(response.status),
      };
    }

    const json = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const hits = json.data ?? [];

    if (hits.length === 0) {
      return {
        success: true,
        platform,
        data: { no_results: true, query },
      };
    }

    const sliced = hits.slice(0, 3);
    const firstExtract = readHitExtract(sliced[0] as Record<string, unknown>);
    const platformImages = sliced.flatMap((hit) =>
      extractImagesFromHit(hit as Record<string, unknown>, platform),
    );

    return {
      success: true,
      platform,
      data: {
        query,
        results: sliced,
        extract: firstExtract ?? undefined,
        images: platformImages.slice(0, MAX_IMAGES_PER_PLATFORM),
        scraped_at: new Date().toISOString(),
      },
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      success: false,
      platform,
      data: {},
      error: error instanceof Error ? error.message : "Firecrawl request failed",
      retryable: true,
    };
  }
}

async function scrapePlatformContextMarkdownOnly(
  apiKey: string,
  platform: string,
  query: string,
  priorError: string,
  signal?: AbortSignal,
): Promise<FirecrawlScrapeResult> {
  try {
    const response = await fetch(`${FIRECRAWL_BASE}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal,
      body: JSON.stringify({
        query,
        limit: 3,
        scrapeOptions: { formats: ["markdown"] },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        platform,
        data: {},
        error: `Firecrawl search failed (${response.status}): ${text.slice(0, 200)} (json extract also failed: ${priorError.slice(0, 100)})`,
        retryable: isRetryableFirecrawlStatus(response.status),
      };
    }

    const json = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const hits = json.data ?? [];
    if (hits.length === 0) {
      return { success: true, platform, data: { no_results: true, query } };
    }

    const sliced = hits.slice(0, 3);
    const platformImages = sliced.flatMap((hit) =>
      extractImagesFromHit(hit as Record<string, unknown>, platform),
    );

    return {
      success: true,
      platform,
      data: {
        query,
        results: sliced,
        images: platformImages.slice(0, MAX_IMAGES_PER_PLATFORM),
        scraped_at: new Date().toISOString(),
        extract_degraded: true,
      },
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return {
      success: false,
      platform,
      data: {},
      error: error instanceof Error ? error.message : "Firecrawl markdown fallback failed",
      retryable: true,
    };
  }
}

export function computeResearchStatusFromPlatforms(
  platforms: Record<string, unknown>,
): "complete" | "partial" | "failed" | "no_results_found" {
  const keys = Object.keys(platforms);
  if (keys.length === 0) return "no_results_found";

  let withData = 0;
  let failures = 0;

  for (const key of keys) {
    const entry = platforms[key];
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.no_results === true) continue;
    if (record.error) {
      failures += 1;
      continue;
    }
    if (record.results || record.data || record.extract) {
      withData += 1;
    }
  }

  if (withData === 0 && failures === 0) return "no_results_found";
  if (withData > 0 && failures === 0) return "complete";
  if (withData > 0) return "partial";
  return failures > 0 ? "failed" : "no_results_found";
}
