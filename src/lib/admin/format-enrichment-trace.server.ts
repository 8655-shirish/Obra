/**
 * Format enrichment_json for the admin traces Firecrawl column / detail tab.
 */

import { classifyListedWebsitePresence, listedWebsiteLine } from "./research-dossier.ts";

export function formatEnrichmentTraceText(
  enrichment: Record<string, unknown>,
  options?: {
    businessName?: string | null;
    licenseNumber?: string | null;
    researchStatus?: string | null;
  },
): string {
  const platforms =
    enrichment.platforms && typeof enrichment.platforms === "object"
      ? (enrichment.platforms as Record<string, unknown>)
      : {};
  const schema =
    enrichment.schema && typeof enrichment.schema === "object"
      ? (enrichment.schema as Record<string, unknown>)
      : {};
  const images = Array.isArray(enrichment.images) ? enrichment.images : [];

  const listed = classifyListedWebsitePresence(
    enrichment,
    {
      businessName: options?.businessName ?? "",
      licenseNumber: options?.licenseNumber ?? "",
    },
    { researchStatus: options?.researchStatus ?? null, scrapeInvoked: true },
  );

  const platformLines: string[] = [];
  for (const [name, value] of Object.entries(platforms)) {
    if (!value || typeof value !== "object") {
      platformLines.push(`${name}: unknown`);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.error) {
      platformLines.push(`${name}: error — ${String(record.error).slice(0, 120)}`);
      continue;
    }
    if (record.no_results === true) {
      platformLines.push(`${name}: no results`);
      continue;
    }
    const results = Array.isArray(record.results) ? record.results : [];
    const hasExtract = Boolean(record.extract);
    platformLines.push(
      `${name}: ${results.length} hit(s)${hasExtract ? ", structured extract" : ""}`,
    );
  }

  const highlightKeys = [
    "business_name",
    "license_number",
    "google_rating",
    "yelp_rating",
    "reviews_average_rating",
    "reviews_recent_quote_1",
    "contact_phone",
    "services_offered",
    "google_address",
    "yelp_address",
  ] as const;
  const schemaBits: string[] = [];
  for (const key of highlightKeys) {
    const value = schema[key];
    if (typeof value === "string" && value.trim()) {
      schemaBits.push(`${key}=${value.trim().slice(0, 160)}`);
    }
  }

  const imageUrls = images
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const url = (entry as { url?: unknown }).url;
      return typeof url === "string" ? url : null;
    })
    .filter((url): url is string => Boolean(url));

  const parts: string[] = [listedWebsiteLine(listed)];
  if (platformLines.length > 0) {
    parts.push(`Platforms:\n${platformLines.join("\n")}`);
  }
  if (schemaBits.length > 0) {
    parts.push(`Schema:\n${schemaBits.join("\n")}`);
  }
  if (imageUrls.length > 0) {
    parts.push(`Images (${imageUrls.length}):\n${imageUrls.slice(0, 12).join("\n")}`);
  }

  if (parts.length === 1 && platformLines.length === 0 && schemaBits.length === 0) {
    return `${parts[0]}\n\nCrawl ran, no usable enrichment data stored.`;
  }
  return parts.join("\n\n");
}
