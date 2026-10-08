/**
 * Identity-gated fact sheet for generation and projection.
 * Onboarding facts always pass through. Listing quotes, ratings, contact,
 * and trust hrefs come only from a name-matched listing (or a CSLB license
 * record). Photos still follow hitMatchesContractor (name or license).
 */

import {
  coerceLookAndFeel,
  curateProjectImages,
  filterReviewsForTrade,
  formatTrustRatingDetail,
  isDirectorySearchUrl,
  overlayStoragePathByUrl,
  trustHrefForKind,
  type EvidenceMediaItem,
  type EvidenceReview,
  type EvidenceTrustMarker,
  type LookAndFeelSkin,
} from "./site-evidence.ts";

const LEGAL_STOP = new Set(["inc", "llc", "ltd", "corp", "co", "the", "and", "of"]);

export type SiteFactSheet = {
  businessName: string;
  licenseNumber: string;
  trade: string;
  city: string;
  services: string[];
  theme: "light" | "dark";
  lookAndFeel: LookAndFeelSkin;
  primaryColor: string;
  phone: string | null;
  address: string | null;
  hours: string | null;
  warranty: string | null;
  images: EvidenceMediaItem[];
  reviews: EvidenceReview[];
  trustMarkers: EvidenceTrustMarker[];
  servicesOffered: string | null;
};

function asNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const WEEKDAY =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i;
const TIME_TOKEN = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b/i;

/**
 * Evidence is a readable weekly schedule: a weekday name or day-range plus times.
 * A time token alone is not enough — `"Closed• 7:00 am - 6:00 pm"` is null.
 */
export function parseReadableWeeklyHours(raw: unknown): string | null {
  const trimmed = asNonEmpty(raw);
  if (!trimmed) return null;
  if (!WEEKDAY.test(trimmed)) return null;
  if (!TIME_TOKEN.test(trimmed)) return null;
  return trimmed;
}

export function parseServiceItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }
  const trimmed = asNonEmpty(value);
  if (!trimmed) return [];
  return trimmed
    .split(/[,•\n|;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

export function distinctiveNameTokens(name: string): Set<string> {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return new Set(
    cleaned.split(/\s+/).filter((token) => token.length >= 3 && !LEGAL_STOP.has(token)),
  );
}

export function namesMatchContractor(onboardingName: string, extractName: string): boolean {
  const a = distinctiveNameTokens(onboardingName);
  const b = distinctiveNameTokens(extractName);
  if (a.size === 0 || b.size === 0) return false;
  for (const token of a) {
    if (b.has(token)) return true;
  }
  return false;
}

function readHitExtract(hit: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ["json", "extract", "llm_extraction"] as const) {
    const candidate = hit[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return null;
}

export function hitMatchesContractor(
  hit: Record<string, unknown>,
  onboarding: { businessName: string; licenseNumber: string },
): boolean {
  const extract = readHitExtract(hit);
  const extractName = asNonEmpty(extract?.business_name);
  const url = typeof hit.url === "string" ? hit.url : "";
  const markdown = typeof hit.markdown === "string" ? hit.markdown : "";
  const license = onboarding.licenseNumber.trim();
  const licenseInHit = license.length >= 4 && (url.includes(license) || markdown.includes(license));
  const nameOk = Boolean(extractName && namesMatchContractor(onboarding.businessName, extractName));
  return nameOk || licenseInHit;
}

/**
 * Facts that may be presented as this contractor: a name-matched listing, or a
 * CSLB license record. License-in-URL on Google/Yelp/Houzz is not their listing.
 */
export function hitIsThisContractorListing(
  platform: string,
  extract: Record<string, unknown> | null | undefined,
  onboardingName: string,
): boolean {
  const extractName = asNonEmpty(extract?.business_name);
  if (extractName && namesMatchContractor(onboardingName, extractName)) return true;
  return platform.toLowerCase().includes("cslb");
}

function parseServices(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function markdownImages(markdown: string): EvidenceMediaItem[] {
  const items: EvidenceMediaItem[] = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(re)) {
    const url = (match[2] ?? "").trim();
    if (!url.startsWith("http")) continue;
    items.push({
      url,
      mimeType: "image/jpeg",
      alt: match[1]?.trim() || "Project photo",
    });
  }
  return items;
}

function collectHitImages(
  hit: Record<string, unknown>,
  extract: Record<string, unknown> | null,
  platform: string,
): EvidenceMediaItem[] {
  const items: EvidenceMediaItem[] = [];
  const photos = extract?.photo_urls;
  if (Array.isArray(photos)) {
    for (const raw of photos) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      items.push({
        url: raw.trim(),
        mimeType: "image/jpeg",
        alt: `Photo from ${platform}`,
      });
    }
  }
  const markdown = typeof hit.markdown === "string" ? hit.markdown : "";
  if (markdown) items.push(...markdownImages(markdown));
  return items;
}

function enrichmentGallery(enrichment: Record<string, unknown>): EvidenceMediaItem[] {
  const images = Array.isArray(enrichment.images) ? enrichment.images : [];
  const items: EvidenceMediaItem[] = [];
  for (const raw of images) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    if (!url) continue;
    const storagePath =
      typeof rec.storagePath === "string" && rec.storagePath.trim()
        ? rec.storagePath.trim()
        : undefined;
    items.push({
      url,
      alt: typeof rec.alt === "string" && rec.alt.trim() ? rec.alt.trim() : "Project photo",
      mimeType: typeof rec.mimeType === "string" ? rec.mimeType : "image/jpeg",
      ...(storagePath ? { storagePath } : {}),
      ...(typeof rec.width === "number" ? { width: rec.width } : {}),
      ...(typeof rec.height === "number" ? { height: rec.height } : {}),
      ...(typeof rec.aspect === "number" ? { aspect: rec.aspect } : {}),
      ...(rec.orientation === "landscape" ||
      rec.orientation === "portrait" ||
      rec.orientation === "square"
        ? { orientation: rec.orientation }
        : {}),
      ...(typeof rec.contentHash === "string" ? { contentHash: rec.contentHash } : {}),
      ...(rec.provenance && typeof rec.provenance === "object"
        ? { provenance: rec.provenance as EvidenceMediaItem["provenance"] }
        : {}),
      ...(typeof rec.proofEligible === "boolean" ? { proofEligible: rec.proofEligible } : {}),
    });
  }
  return items;
}

function collectHitReviews(
  extract: Record<string, unknown> | null,
  platform: string,
): EvidenceReview[] {
  if (!extract) return [];
  const quotes = extract.review_quotes;
  if (!Array.isArray(quotes)) return [];
  const reviews: EvidenceReview[] = [];
  for (const entry of quotes) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const quote = asNonEmpty(record.quote);
    if (!quote) continue;
    reviews.push({
      quote,
      author: asNonEmpty(record.author) ?? undefined,
      source: platform,
    });
  }
  return reviews;
}

function addMarker(
  markers: EvidenceTrustMarker[],
  seen: Set<string>,
  marker: EvidenceTrustMarker,
): void {
  if (seen.has(marker.id)) return;
  seen.add(marker.id);
  markers.push(marker);
}

export function buildFactSheet(
  onboarding: Record<string, unknown>,
  enrichment: Record<string, unknown>,
  options: { imageCap?: number } = {},
): SiteFactSheet {
  const businessName = asNonEmpty(onboarding.businessName) ?? "Your Business";
  const licenseNumber = asNonEmpty(onboarding.licenseNumber) ?? "";
  const trade = asNonEmpty(onboarding.trade) ?? "";
  const city = asNonEmpty(onboarding.city) ?? "California";
  const services = parseServices(onboarding.services);
  const theme = onboarding.theme === "dark" ? "dark" : "light";
  const lookAndFeel = coerceLookAndFeel(onboarding.lookAndFeel);
  const primaryColor =
    typeof onboarding.primaryColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(onboarding.primaryColor)
      ? onboarding.primaryColor
      : "#1e3a5f";

  const identity = { businessName, licenseNumber };
  const platforms =
    enrichment.platforms && typeof enrichment.platforms === "object"
      ? (enrichment.platforms as Record<string, unknown>)
      : {};

  const images: EvidenceMediaItem[] = [];
  const reviews: EvidenceReview[] = [];
  const trustMarkers: EvidenceTrustMarker[] = [];
  const seenTrust = new Set<string>();
  let phone: string | null = null;
  let address: string | null = null;
  let hours: string | null = null;
  let warranty: string | null = null;
  let servicesOffered: string | null = null;

  if (licenseNumber) {
    addMarker(trustMarkers, seenTrust, {
      id: "license",
      kind: "license",
      label: "Licensed",
      detail: `#${licenseNumber}`,
    });
  }

  for (const [platform, value] of Object.entries(platforms)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const results = Array.isArray(record.results)
      ? (record.results as Array<Record<string, unknown>>)
      : [];
    const hits = results.length > 0 ? results : record.extract ? [record] : [];
    const platformLower = platform.toLowerCase();

    for (const hit of hits) {
      if (!hitMatchesContractor(hit, identity)) continue;
      const extract = readHitExtract(hit) ?? (record.extract as Record<string, unknown> | null);
      images.push(...collectHitImages(hit, extract, platform));
      const extractName = asNonEmpty(extract?.business_name);
      const listingIsThisContractor = Boolean(
        extractName && namesMatchContractor(businessName, extractName),
      );
      const factsFromThisHit = hitIsThisContractorListing(platform, extract, businessName);
      if (listingIsThisContractor) {
        reviews.push(...collectHitReviews(extract, platform));
      }

      const extractPhone = asNonEmpty(extract?.phone);
      const extractAddress = asNonEmpty(extract?.address);
      const extractHours = asNonEmpty(extract?.hours);
      const extractWarranty =
        asNonEmpty(extract?.warranty) ?? asNonEmpty(extract?.warranty_offered);
      if (factsFromThisHit) {
        if (extractPhone && !phone) phone = extractPhone;
        if (extractAddress && !address) address = extractAddress;
        if (extractHours && !hours) hours = parseReadableWeeklyHours(extractHours);
        if (extractWarranty && !warranty) warranty = extractWarranty;

        if (Array.isArray(extract?.services) && extract.services.length > 0 && !servicesOffered) {
          const joined = extract.services
            .map((item) => asNonEmpty(item))
            .filter((item): item is string => Boolean(item))
            .join(", ");
          if (joined) servicesOffered = joined;
        }
      }

      const rating = asNonEmpty(extract?.rating);
      const reviewCount = asNonEmpty(extract?.review_count);
      const hitUrl = typeof hit.url === "string" ? hit.url : undefined;
      const listingHref =
        hitUrl && !isDirectorySearchUrl(hitUrl)
          ? trustHrefForKind(
              platformLower.includes("google")
                ? "google"
                : platformLower.includes("yelp")
                  ? "yelp"
                  : platformLower.includes("angi")
                    ? "angi"
                    : platformLower.includes("bbb")
                      ? "bbb"
                      : platformLower.includes("houzz")
                        ? "houzz"
                        : "",
              hitUrl,
            )
          : undefined;

      const kind = platformLower.includes("google")
        ? "google"
        : platformLower.includes("yelp")
          ? "yelp"
          : platformLower.includes("angi")
            ? "angi"
            : platformLower.includes("bbb")
              ? "bbb"
              : platformLower.includes("houzz")
                ? "houzz"
                : null;

      if (kind && listingIsThisContractor && (rating || reviewCount || listingHref)) {
        addMarker(trustMarkers, seenTrust, {
          id: kind,
          kind,
          label:
            kind === "google"
              ? "Google"
              : kind === "yelp"
                ? "Yelp"
                : kind === "angi"
                  ? "Angi"
                  : kind === "bbb"
                    ? "BBB"
                    : "Houzz",
          detail: formatTrustRatingDetail(kind, rating, reviewCount),
          href: listingHref,
        });
      }
    }
  }

  return {
    businessName,
    licenseNumber,
    trade,
    city,
    services,
    theme,
    lookAndFeel,
    primaryColor,
    phone,
    address,
    hours: parseReadableWeeklyHours(hours),
    warranty,
    images: curateProjectImages(
      overlayStoragePathByUrl(images, enrichmentGallery(enrichment)),
      options.imageCap,
    ),
    reviews: filterReviewsForTrade(reviews, trade),
    trustMarkers,
    servicesOffered,
  };
}

/** Listing page URL for a photo that passed the identity gate — used as fetch Referer. */
export function listingUrlForImage(
  onboarding: Record<string, unknown>,
  enrichment: Record<string, unknown>,
  imageUrl: string,
): string | null {
  const target = imageUrl.trim();
  if (!target) return null;
  const identity = {
    businessName: asNonEmpty(onboarding.businessName) ?? "",
    licenseNumber: asNonEmpty(onboarding.licenseNumber) ?? "",
  };
  const platforms =
    enrichment.platforms && typeof enrichment.platforms === "object"
      ? (enrichment.platforms as Record<string, unknown>)
      : {};

  for (const [platform, value] of Object.entries(platforms)) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const results = Array.isArray(record.results)
      ? (record.results as Array<Record<string, unknown>>)
      : [];
    const hits = results.length > 0 ? results : record.extract ? [record] : [];
    for (const hit of hits) {
      if (!hitMatchesContractor(hit, identity)) continue;
      const extract = readHitExtract(hit) ?? (record.extract as Record<string, unknown> | null);
      const photos = collectHitImages(hit, extract, platform);
      if (!photos.some((item) => item.url === target)) continue;
      const listing = typeof hit.url === "string" ? hit.url.trim() : "";
      if (listing.startsWith("http://") || listing.startsWith("https://")) return listing;
    }
  }
  return null;
}
