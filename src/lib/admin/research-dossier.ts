/**
 * Admin research dossier over stored Firecrawl enrichment.
 * Generation stays identity-gated; this view shows matched facts and unmatched hits.
 */

import { ENRICHMENT_PLATFORMS } from "../jobs/platforms.ts";
import {
  classifyListedWebsiteUrl,
  filterReviewsForTrade,
  overlayStoragePathByUrl,
  type ClassifiedListedWebsite,
  type EvidenceMediaItem,
  type EvidenceReview,
  type ListedWebsiteKind,
} from "../site-evidence.ts";
import {
  hitIsThisContractorListing,
  hitMatchesContractor,
  namesMatchContractor,
  parseReadableWeeklyHours,
} from "../site-fact-sheet.ts";

const TERMINAL_RESEARCH_STATUS = new Set(["complete", "partial", "failed", "no_results_found"]);

export type ResearchJobState = {
  hasActiveEnrichmentJobs: boolean;
  latestChainIncomplete: boolean;
};

export type ListedWebsiteStatus =
  | "not_started"
  | "unknown_running"
  | "unknown_incomplete"
  | "none"
  | "none_partial"
  | "listed"
  | "conflict";

export type ListedWebsiteHost = {
  host: string;
  url: string;
  kind: Exclude<ListedWebsiteKind, "directory">;
  platforms: string[];
};

export type ListedWebsitePresence = {
  status: ListedWebsiteStatus;
  headline: string;
  detail: string | null;
  opsNote: string | null;
  hosts: ListedWebsiteHost[];
};

export type ResearchDossierImage = {
  url: string;
  displayUrl: string;
  alt?: string;
  platform?: string;
  storagePath?: string;
};

export type ResearchDossierReview = {
  quote: string;
  author?: string;
  source?: string;
};

export type ResearchPlatformCard = {
  platform: string;
  status: "ok" | "no_results" | "error" | "missing";
  error?: string;
  rating?: string;
  reviewCount?: string;
  listingUrl?: string;
  website?: string;
  phone?: string;
  address?: string;
  hours?: string;
  businessName?: string;
  extractDegraded?: boolean;
};

export type UnmatchedHit = {
  platform: string;
  url?: string;
  businessName?: string;
  website?: string;
  reviews: ResearchDossierReview[];
};

export type ResearchSocialLink = {
  platform: "Facebook" | "Instagram";
  url: string;
  source: string;
};

export type ResearchDossier = {
  researchStatus: string | null;
  listedWebsite: ListedWebsitePresence;
  social: ResearchSocialLink[];
  identity: {
    businessName: string;
    licenseNumber: string;
    trade: string;
    city: string;
    phone: string | null;
    address: string | null;
    hours: string | null;
  };
  images: ResearchDossierImage[];
  reviews: ResearchDossierReview[];
  platforms: ResearchPlatformCard[];
  unmatchedHits: UnmatchedHit[];
};

function asNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readHitExtract(hit: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ["json", "extract", "llm_extraction"] as const) {
    const candidate = hit[key];
    const record = asRecord(candidate);
    if (record) return record;
  }
  return null;
}

function platformHits(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const results = Array.isArray(record.results)
    ? (record.results as Array<Record<string, unknown>>)
    : [];
  if (results.length > 0) return results;
  if (record.extract) return [record];
  return [];
}

function markdownImages(markdown: string, platform: string): EvidenceMediaItem[] {
  const items: EvidenceMediaItem[] = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(re)) {
    const url = (match[2] ?? "").trim();
    if (!url.startsWith("http")) continue;
    items.push({
      url,
      alt: match[1]?.trim() || "Project photo",
      platform,
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
        alt: `Photo from ${platform}`,
        platform,
      });
    }
  }
  const markdown = typeof hit.markdown === "string" ? hit.markdown : "";
  if (markdown) items.push(...markdownImages(markdown, platform));
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
    const record = asRecord(entry);
    if (!record) continue;
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

function enrichmentGallery(enrichment: Record<string, unknown>): EvidenceMediaItem[] {
  const images = Array.isArray(enrichment.images) ? enrichment.images : [];
  const items: EvidenceMediaItem[] = [];
  for (const raw of images) {
    const rec = asRecord(raw);
    if (!rec) continue;
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    if (!url) continue;
    const storagePath =
      typeof rec.storagePath === "string" && rec.storagePath.trim()
        ? rec.storagePath.trim()
        : undefined;
    items.push({
      url,
      alt: asNonEmpty(rec.alt) ?? "Project photo",
      platform: asNonEmpty(rec.platform) ?? undefined,
      ...(storagePath ? { storagePath } : {}),
    });
  }
  return items;
}

type OwnedListedWebsite = ClassifiedListedWebsite & {
  kind: Exclude<ListedWebsiteKind, "directory">;
};

function ownedClassification(raw: string | null | undefined): OwnedListedWebsite | null {
  if (!raw) return null;
  const classified = classifyListedWebsiteUrl(raw);
  if (!classified || classified.kind === "directory") return null;
  return { kind: classified.kind, host: classified.host, url: classified.url };
}

function collectOwnedFromHit(
  hit: Record<string, unknown>,
  extract: Record<string, unknown> | null,
): OwnedListedWebsite[] {
  const found: OwnedListedWebsite[] = [];
  const hitUrl = typeof hit.url === "string" ? hit.url : null;
  const website = asNonEmpty(extract?.website);
  const fromHit = ownedClassification(hitUrl);
  const fromWebsite = ownedClassification(website);
  if (fromHit) found.push(fromHit);
  if (fromWebsite && fromWebsite.host !== fromHit?.host) found.push(fromWebsite);
  return found;
}

function mergeOwnedHosts(
  byHost: Map<string, ListedWebsiteHost>,
  classified: OwnedListedWebsite,
  platform: string,
): void {
  const existing = byHost.get(classified.host);
  if (existing) {
    if (!existing.platforms.includes(platform)) existing.platforms.push(platform);
    return;
  }
  byHost.set(classified.host, {
    host: classified.host,
    url: classified.url,
    kind: classified.kind,
    platforms: [platform],
  });
}

export function formatListedWebsitePresence(presence: {
  status: ListedWebsiteStatus;
  hosts: ListedWebsiteHost[];
}): ListedWebsitePresence {
  const { status, hosts } = presence;
  if (status === "unknown_running") {
    return {
      status,
      hosts,
      headline: "Research still running",
      detail: "Website unknown until research finishes.",
      opsNote: null,
    };
  }
  if (status === "unknown_incomplete") {
    return {
      status,
      hosts,
      headline: "Research did not finish",
      detail: "Website unknown — the scrape was cancelled, superseded, or never finalized.",
      opsNote: null,
    };
  }
  if (status === "not_started") {
    return {
      status,
      hosts,
      headline: "Research not started",
      detail: null,
      opsNote: null,
    };
  }
  if (status === "none") {
    return {
      status,
      hosts,
      headline: "No owned website found",
      detail: "Listings only — no custom domain, website builder, or vendor site.",
      opsNote: null,
    };
  }
  if (status === "none_partial") {
    return {
      status,
      hosts,
      headline: "No owned website found on the listings that succeeded",
      detail:
        "Research was partial or failed. A site may still exist on a listing that did not return.",
      opsNote: null,
    };
  }
  if (status === "conflict") {
    const detail = hosts
      .map((host) => `${host.host} (${host.kind}; ${host.platforms.join(", ")})`)
      .join("; ");
    return {
      status,
      hosts,
      headline: "Conflicting listed websites",
      detail,
      opsNote: "Confirm which site, if any, to migrate before registering a new domain.",
    };
  }

  const host = hosts[0];
  if (!host) {
    return {
      status: "none",
      hosts,
      headline: "No owned website found",
      detail: null,
      opsNote: null,
    };
  }
  const sources = host.platforms.join(", ");
  if (host.kind === "builder") {
    return {
      status,
      hosts,
      headline: `Website builder: ${host.host}`,
      detail: `${sources} — they have a site, not a portable domain.`,
      opsNote: null,
    };
  }
  if (host.kind === "vendor") {
    return {
      status,
      hosts,
      headline: `Scheduling / vendor site: ${host.host}`,
      detail: `${sources} — not a domain to migrate.`,
      opsNote: null,
    };
  }
  const oneListing = host.platforms.length < 2;
  return {
    status,
    hosts,
    headline: `Listed website: ${host.host}`,
    detail: oneListing ? `Seen on one listing (${sources})` : sources,
    opsNote: "Confirm whether to migrate this domain or register a new one.",
  };
}

export function listedWebsiteLine(presence: ListedWebsitePresence): string {
  if (!presence.detail) return presence.headline;
  return `${presence.headline} — ${presence.detail}`;
}

export function classifyListedWebsitePresence(
  enrichment: Record<string, unknown>,
  onboarding: { businessName: string; licenseNumber: string },
  options: {
    researchStatus?: string | null;
    jobState?: ResearchJobState;
    scrapeInvoked?: boolean;
  } = {},
): ListedWebsitePresence {
  const jobState = options.jobState ?? {
    hasActiveEnrichmentJobs: false,
    latestChainIncomplete: false,
  };
  const researchStatus = options.researchStatus ?? null;
  const platforms = asRecord(enrichment.platforms) ?? {};
  const byHost = new Map<string, ListedWebsiteHost>();

  for (const [platform, value] of Object.entries(platforms)) {
    const record = asRecord(value);
    if (!record) continue;
    for (const hit of platformHits(record)) {
      if (!hitMatchesContractor(hit, onboarding)) continue;
      const extract = readHitExtract(hit);
      if (!hitIsThisContractorListing(platform, extract, onboarding.businessName)) continue;
      for (const classified of collectOwnedFromHit(hit, extract)) {
        mergeOwnedHosts(byHost, classified, platform);
      }
    }
  }

  const hosts = [...byHost.values()];
  if (jobState.hasActiveEnrichmentJobs) {
    return formatListedWebsitePresence({ status: "unknown_running", hosts });
  }

  const finished = Boolean(researchStatus && TERMINAL_RESEARCH_STATUS.has(researchStatus));
  if (!finished) {
    const hasPlatforms = Object.keys(platforms).length > 0;
    if (jobState.latestChainIncomplete) {
      return formatListedWebsitePresence({ status: "unknown_incomplete", hosts });
    }
    if (!hasPlatforms && !options.scrapeInvoked) {
      return formatListedWebsitePresence({ status: "not_started", hosts });
    }
    if (!hasPlatforms) {
      return formatListedWebsitePresence({ status: "unknown_running", hosts });
    }
    return formatListedWebsitePresence({ status: "unknown_incomplete", hosts });
  }

  if (hosts.length === 0) {
    const partial = researchStatus === "partial" || researchStatus === "failed";
    return formatListedWebsitePresence({
      status: partial ? "none_partial" : "none",
      hosts,
    });
  }
  if (hosts.length === 1) {
    return formatListedWebsitePresence({ status: "listed", hosts });
  }
  return formatListedWebsitePresence({ status: "conflict", hosts });
}

function socialPlatformFromUrl(url: string): "Facebook" | "Instagram" | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com") {
      return "Facebook";
    }
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "Instagram";
    return null;
  } catch {
    return null;
  }
}

function collectSocialLinks(
  platforms: Record<string, unknown>,
  identity: { businessName: string; licenseNumber: string },
): ResearchSocialLink[] {
  const links: ResearchSocialLink[] = [];
  const seen = new Set<string>();
  const push = (
    platform: "Facebook" | "Instagram",
    raw: string | null | undefined,
    source: string,
  ) => {
    const href = httpHref(raw);
    if (!href) return;
    const key = href.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ platform, url: href, source });
  };

  for (const [platform, value] of Object.entries(platforms)) {
    const record = asRecord(value);
    if (!record) continue;
    for (const hit of platformHits(record)) {
      if (!hitMatchesContractor(hit, identity)) continue;
      const extract = readHitExtract(hit);
      const extractName = asNonEmpty(extract?.business_name);
      if (!extractName || !namesMatchContractor(identity.businessName, extractName)) continue;
      push("Facebook", asNonEmpty(extract?.facebook_url), platform);
      push("Instagram", asNonEmpty(extract?.instagram_url), platform);
      const listingUrl = typeof hit.url === "string" ? httpHref(hit.url) : undefined;
      const listingSocial = listingUrl ? socialPlatformFromUrl(listingUrl) : null;
      if (listingSocial && listingUrl) push(listingSocial, listingUrl, platform);
    }
  }
  return links;
}

function httpHref(raw: string | null | undefined): string | undefined {
  const trimmed = asNonEmpty(raw);
  if (!trimmed) return undefined;
  return (
    classifyListedWebsiteUrl(trimmed)?.url ?? (trimmed.startsWith("http") ? trimmed : undefined)
  );
}

function platformCard(
  platform: string,
  record: Record<string, unknown> | null,
  identity: { businessName: string; licenseNumber: string },
): ResearchPlatformCard {
  if (!record) {
    return { platform, status: "missing" };
  }
  if (record.no_results === true) {
    return { platform, status: "no_results" };
  }
  if (record.error) {
    return { platform, status: "error", error: String(record.error) };
  }
  const hits = platformHits(record);
  const matchedHit = hits.find((hit) => hitMatchesContractor(hit, identity)) ?? null;
  const extract = matchedHit ? readHitExtract(matchedHit) : null;
  const extractName = asNonEmpty(extract?.business_name);
  const listingIsThisContractor = Boolean(
    extractName && namesMatchContractor(identity.businessName, extractName),
  );
  const listingUrl = typeof matchedHit?.url === "string" ? httpHref(matchedHit.url) : undefined;
  const website = httpHref(asNonEmpty(extract?.website));
  return {
    platform,
    status: "ok",
    rating: listingIsThisContractor ? (asNonEmpty(extract?.rating) ?? undefined) : undefined,
    reviewCount: listingIsThisContractor
      ? (asNonEmpty(extract?.review_count) ?? undefined)
      : undefined,
    listingUrl,
    website,
    phone: asNonEmpty(extract?.phone) ?? undefined,
    address: asNonEmpty(extract?.address) ?? undefined,
    hours: asNonEmpty(extract?.hours) ?? undefined,
    businessName: asNonEmpty(extract?.business_name) ?? undefined,
    extractDegraded: record.extract_degraded === true,
  };
}

/** Personalize sees listing identity only when the listing is this contractor. */
export function platformCardForAgent(
  card: ResearchPlatformCard,
  onboardingName: string,
): ResearchPlatformCard {
  if (card.status !== "ok") return card;
  const extract = card.businessName ? { business_name: card.businessName } : null;
  if (hitIsThisContractorListing(card.platform, extract, onboardingName)) return card;
  return {
    platform: card.platform,
    status: card.status,
    extractDegraded: card.extractDegraded,
  };
}

export function buildResearchDossier(
  enrichment: Record<string, unknown>,
  onboarding: Record<string, unknown>,
  options: {
    researchStatus?: string | null;
    jobState?: ResearchJobState;
  } = {},
): ResearchDossier {
  const businessName = asNonEmpty(onboarding.businessName) ?? "Unknown business";
  const licenseNumber = asNonEmpty(onboarding.licenseNumber) ?? "";
  const trade = asNonEmpty(onboarding.trade) ?? "";
  const city = asNonEmpty(onboarding.city) ?? "";
  const identity = { businessName, licenseNumber };
  const platforms = asRecord(enrichment.platforms) ?? {};
  const listedWebsite = classifyListedWebsitePresence(enrichment, identity, {
    researchStatus: options.researchStatus,
    jobState: options.jobState,
  });
  const social = collectSocialLinks(platforms, identity);

  const matchedImages: EvidenceMediaItem[] = [];
  const matchedReviews: EvidenceReview[] = [];
  const unmatchedHits: UnmatchedHit[] = [];
  let phone: string | null = null;
  let address: string | null = null;
  let hours: string | null = null;

  for (const [platform, value] of Object.entries(platforms)) {
    const record = asRecord(value);
    if (!record) continue;
    for (const hit of platformHits(record)) {
      const extract = readHitExtract(hit);
      const hitUrl = typeof hit.url === "string" ? hit.url.trim() : undefined;
      if (!hitMatchesContractor(hit, identity)) {
        const reviews = collectHitReviews(extract, platform);
        const businessNameHit = asNonEmpty(extract?.business_name) ?? undefined;
        const website = asNonEmpty(extract?.website) ?? undefined;
        if (!hitUrl && !businessNameHit && !website && reviews.length === 0) continue;
        unmatchedHits.push({
          platform,
          url: httpHref(hitUrl),
          businessName: businessNameHit,
          website,
          reviews,
        });
        continue;
      }
      matchedImages.push(...collectHitImages(hit, extract, platform));
      const extractName = asNonEmpty(extract?.business_name);
      if (extractName && namesMatchContractor(businessName, extractName)) {
        matchedReviews.push(...collectHitReviews(extract, platform));
      }
      if (hitIsThisContractorListing(platform, extract, businessName)) {
        if (!phone) phone = asNonEmpty(extract?.phone);
        if (!address) address = asNonEmpty(extract?.address);
        if (!hours) hours = parseReadableWeeklyHours(extract?.hours);
      }
    }
  }

  const overlayed = overlayStoragePathByUrl(matchedImages, enrichmentGallery(enrichment));
  const seenImage = new Set<string>();
  const images: ResearchDossierImage[] = [];
  for (const item of overlayed) {
    const url = item.url?.trim();
    if (!url) continue;
    const key = item.storagePath?.trim() || url;
    if (seenImage.has(key)) continue;
    seenImage.add(key);
    images.push({
      url,
      displayUrl: url,
      alt: item.alt,
      platform: item.platform,
      storagePath: item.storagePath,
    });
  }

  const platformNames = [
    ...ENRICHMENT_PLATFORMS,
    ...Object.keys(platforms).filter(
      (name) => !ENRICHMENT_PLATFORMS.includes(name as (typeof ENRICHMENT_PLATFORMS)[number]),
    ),
  ];

  return {
    researchStatus: options.researchStatus ?? null,
    listedWebsite,
    social,
    identity: {
      businessName,
      licenseNumber,
      trade,
      city,
      phone: phone ?? asNonEmpty(onboarding.phone),
      address: address ?? asNonEmpty(onboarding.address),
      hours,
    },
    images,
    reviews: filterReviewsForTrade(matchedReviews, trade),
    platforms: platformNames.map((name) => platformCard(name, asRecord(platforms[name]), identity)),
    unmatchedHits,
  };
}

export function deriveResearchJobState(
  jobs: Array<{ status: string; chain_id: string }>,
): ResearchJobState {
  const hasActiveEnrichmentJobs = jobs.some(
    (job) => job.status === "pending" || job.status === "running" || job.status === "finalizing",
  );
  const latestChainId = jobs[0]?.chain_id;
  const chainJobs = latestChainId ? jobs.filter((job) => job.chain_id === latestChainId) : [];
  const latestChainIncomplete =
    chainJobs.length > 0 &&
    !chainJobs.every((job) => job.status === "completed") &&
    chainJobs.some(
      (job) => job.status === "cancelled" || job.status === "superseded" || job.status === "failed",
    ) &&
    !hasActiveEnrichmentJobs;
  return { hasActiveEnrichmentJobs, latestChainIncomplete };
}
