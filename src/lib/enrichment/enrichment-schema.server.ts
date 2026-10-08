/**
 * BUSINESS-CASE-aligned enrichment schema (113 scalar fields).
 * Stored flat on enrichment_json.schema + platforms raw blobs.
 */

import {
  readPlatformExtract,
  type ContractorListingExtract,
} from "../integrations/firecrawl.server.ts";
import {
  hitIsThisContractorListing,
  hitMatchesContractor,
  namesMatchContractor,
} from "../site-fact-sheet.ts";

export const ENRICHMENT_SCHEMA_VERSION = 1;

const BUSINESS_IDENTITY = [
  "business_name",
  "legal_name",
  "dba_name",
  "license_number",
  "license_status",
  "license_type",
  "trade_classification",
  "city",
  "county",
  "state",
  "zip",
  "service_area",
  "years_in_business",
  "employee_count",
  "website_url",
] as const;

const CSLB = [
  "cslb_license_number",
  "cslb_status",
  "cslb_issue_date",
  "cslb_expiration_date",
  "cslb_classification",
  "cslb_bond_status",
  "cslb_workers_comp",
  "cslb_entity_type",
  "cslb_address",
  "cslb_phone",
  "cslb_disciplinary_actions",
  "cslb_complaint_count",
  "cslb_insurance_status",
  "cslb_qualifier_name",
  "cslb_business_name",
] as const;

const GOOGLE = [
  "google_place_id",
  "google_name",
  "google_rating",
  "google_review_count",
  "google_address",
  "google_phone",
  "google_website",
  "google_hours",
  "google_categories",
  "google_maps_url",
  "google_photos_count",
  "google_price_level",
  "google_description",
  "google_verified",
  "google_last_updated",
] as const;

const YELP = [
  "yelp_business_id",
  "yelp_name",
  "yelp_rating",
  "yelp_review_count",
  "yelp_url",
  "yelp_phone",
  "yelp_address",
  "yelp_price_range",
  "yelp_categories",
  "yelp_hours",
  "yelp_claimed",
  "yelp_photos_count",
  "yelp_website",
  "yelp_is_closed",
  "yelp_last_updated",
] as const;

const REVIEWS_AGG = [
  "reviews_average_rating",
  "reviews_total_count",
  "reviews_recent_quote_1",
  "reviews_recent_quote_2",
  "reviews_recent_quote_3",
  "reviews_recent_author_1",
  "reviews_recent_author_2",
  "reviews_recent_author_3",
  "reviews_recent_source_1",
  "reviews_recent_source_2",
  "reviews_recent_source_3",
] as const;

const SOCIAL = [
  "facebook_url",
  "facebook_followers",
  "facebook_rating",
  "instagram_url",
  "instagram_followers",
  "linkedin_url",
  "twitter_url",
  "youtube_url",
  "houzz_url",
  "houzz_rating",
  "angi_url",
  "angi_rating",
  "thumbtack_url",
  "thumbtack_rating",
  "bbb_url",
  "bbb_rating",
  "homeadvisor_url",
  "homeadvisor_rating",
  "buildzoom_url",
  "buildzoom_score",
] as const;

const OPERATIONS = [
  "services_offered",
  "specialties",
  "certifications",
  "insurance_carrier",
  "insurance_policy_number",
  "bond_amount",
  "payment_methods",
  "languages",
  "emergency_service",
  "warranty_offered",
  "financing_available",
  "free_estimates",
] as const;

const CONTACT = [
  "contact_phone",
  "contact_email",
  "contact_address_line1",
  "contact_address_line2",
  "contact_city",
  "contact_state",
  "contact_zip",
  "contact_form_url",
  "lead_email",
  "lead_phone",
] as const;

export const ENRICHMENT_COLUMN_KEYS = [
  ...BUSINESS_IDENTITY,
  ...CSLB,
  ...GOOGLE,
  ...YELP,
  ...REVIEWS_AGG,
  ...SOCIAL,
  ...OPERATIONS,
  ...CONTACT,
] as const;

export type EnrichmentColumnKey = (typeof ENRICHMENT_COLUMN_KEYS)[number];

export const ENRICHMENT_COLUMN_COUNT = ENRICHMENT_COLUMN_KEYS.length;

export function createEmptySchemaRecord(): Record<EnrichmentColumnKey, string | null> {
  const record = {} as Record<EnrichmentColumnKey, string | null>;
  for (const key of ENRICHMENT_COLUMN_KEYS) {
    record[key] = null;
  }
  return record;
}

function stripReviewerLastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.trim();
  const last = parts[parts.length - 1];
  parts[parts.length - 1] = `${last.charAt(0)}.`;
  return parts.join(" ");
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeReviewQuote(text: string): boolean {
  const lower = text.toLowerCase();
  if (text.length < 40) return false;
  if (lower.includes("cookie") || lower.includes("privacy policy")) return false;
  if (lower.startsWith("#") || lower.startsWith("##")) return false;
  return true;
}

function identityFromOnboarding(onboarding: Record<string, unknown>): {
  businessName: string;
  licenseNumber: string;
} {
  return {
    businessName: asNonEmptyString(onboarding.businessName) ?? "",
    licenseNumber: asNonEmptyString(onboarding.licenseNumber) ?? "",
  };
}

function platformHitsFromPartial(partial: Record<string, unknown>): Array<Record<string, unknown>> {
  const results = Array.isArray(partial.results)
    ? (partial.results as Array<Record<string, unknown>>)
    : [];
  const hits = results.filter((hit) => hit && typeof hit === "object" && !Array.isArray(hit));
  if (hits.length > 0) return hits;
  if (partial.extract && typeof partial.extract === "object" && !Array.isArray(partial.extract)) {
    return [partial];
  }
  return [];
}

/**
 * Rebuild schema from stored platform blobs using the identity gate.
 * Read paths and merge both use this so stored schema cannot stay dirty.
 */
export function schemaFromMatchedPlatforms(
  enrichment: Record<string, unknown>,
  onboarding: Record<string, unknown>,
): Record<string, unknown> {
  const platforms =
    enrichment.platforms &&
    typeof enrichment.platforms === "object" &&
    !Array.isArray(enrichment.platforms)
      ? (enrichment.platforms as Record<string, unknown>)
      : {};
  let schema: Record<string, unknown> = createEmptySchemaRecord();
  for (const [platform, value] of Object.entries(platforms)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    schema = mergeSchemaRecords(
      schema,
      mapPlatformPartialToSchema(platform, value as Record<string, unknown>, onboarding),
    );
  }
  return schema;
}

export function mapPlatformPartialToSchema(
  platform: string,
  partial: Record<string, unknown>,
  onboarding: Record<string, unknown>,
): Partial<Record<EnrichmentColumnKey, string | null>> {
  const out: Partial<Record<EnrichmentColumnKey, string | null>> = {};

  const identity = identityFromOnboarding(onboarding);
  const onboardingBusinessName = identity.businessName;
  const license = identity.licenseNumber;
  const trade = asNonEmptyString(onboarding.trade) ?? "";
  const city = asNonEmptyString(onboarding.city) ?? "California";

  out.business_name = onboardingBusinessName || null;
  out.license_number = license || null;
  out.trade_classification = trade || null;
  out.city = city || null;
  out.state = "CA";

  if (partial.no_results === true) {
    return out;
  }

  const matchedHit =
    platformHitsFromPartial(partial).find((hit) => hitMatchesContractor(hit, identity)) ?? null;
  if (!matchedHit) {
    return out;
  }

  const extract = readPlatformExtract({ results: [matchedHit] });
  const extractName = asNonEmptyString(extract?.business_name);
  const nameMatched = Boolean(
    extractName && namesMatchContractor(onboardingBusinessName, extractName),
  );
  if (nameMatched && extractName) {
    out.business_name = extractName;
  }

  const markdown =
    typeof matchedHit.markdown === "string" ? matchedHit.markdown.slice(0, 2000) : null;
  const url = typeof matchedHit.url === "string" ? matchedHit.url : null;
  const platformLower = platform.toLowerCase();

  applyExtractToPlatformFields(out, platformLower, extract, url, nameMatched);
  if (nameMatched) {
    applyReviewQuotes(out, platform, extract);
    const facebook = asNonEmptyString(extract?.facebook_url);
    const instagram = asNonEmptyString(extract?.instagram_url);
    if (facebook && !out.facebook_url) out.facebook_url = facebook;
    if (instagram && !out.instagram_url) out.instagram_url = instagram;
  }

  if (platformLower.includes("cslb")) {
    out.cslb_license_number = license || out.cslb_license_number || null;
    out.cslb_classification = trade || out.cslb_classification || null;
    out.cslb_business_name = (nameMatched ? extractName : null) || onboardingBusinessName || null;
    if (asNonEmptyString(extract?.phone)) out.cslb_phone = asNonEmptyString(extract?.phone);
    if (asNonEmptyString(extract?.address)) out.cslb_address = asNonEmptyString(extract?.address);
  }

  const listingFacts = hitIsThisContractorListing(
    platform,
    extractName ? { business_name: extractName } : null,
    onboardingBusinessName,
  );

  if (nameMatched) {
    if (platformLower.includes("facebook") && !out.facebook_url) out.facebook_url = url;
    if (platformLower.includes("instagram") && !out.instagram_url) out.instagram_url = url;
    if (platformLower.includes("bbb") && !out.bbb_url) out.bbb_url = url;
    if (platformLower.includes("houzz") && !out.houzz_url) out.houzz_url = url;
    if (platformLower.includes("angi") && !out.angi_url) out.angi_url = url;
    if (platformLower.includes("thumbtack") && !out.thumbtack_url) out.thumbtack_url = url;
    if (platformLower.includes("homeadvisor") && !out.homeadvisor_url) out.homeadvisor_url = url;
    if (platformLower.includes("buildzoom") && !out.buildzoom_url) out.buildzoom_url = url;
  }

  // Markdown as review only when the listing name matches this contractor.
  // License-in-URL is a directory page, not a customer listing.
  const reviewPlatforms = [
    "yelp",
    "google",
    "bbb",
    "angi",
    "thumbtack",
    "homeadvisor",
    "houzz",
    "nextdoor",
  ];
  if (
    nameMatched &&
    !out.reviews_recent_quote_1 &&
    markdown &&
    looksLikeReviewQuote(markdown) &&
    reviewPlatforms.some((name) => platformLower.includes(name))
  ) {
    out.reviews_recent_quote_1 = markdown.slice(0, 200);
    out.reviews_recent_source_1 = platform;
    out.reviews_recent_author_1 = stripReviewerLastName("Customer");
  }

  if (listingFacts && Array.isArray(extract?.services) && extract.services.length > 0) {
    const joined = extract.services
      .map((s) => asNonEmptyString(s))
      .filter((s): s is string => Boolean(s))
      .join(", ");
    if (joined) out.services_offered = joined;
  }

  if (listingFacts && asNonEmptyString(extract?.phone) && !out.contact_phone) {
    out.contact_phone = asNonEmptyString(extract?.phone);
  }
  if (listingFacts && asNonEmptyString(extract?.address) && !out.contact_address_line1) {
    out.contact_address_line1 = asNonEmptyString(extract?.address);
  }
  if (listingFacts && asNonEmptyString(extract?.website) && !out.website_url) {
    out.website_url = asNonEmptyString(extract?.website);
  }

  return out;
}

function applyExtractToPlatformFields(
  out: Partial<Record<EnrichmentColumnKey, string | null>>,
  platformLower: string,
  extract: ContractorListingExtract | null,
  url: string | null,
  nameMatched: boolean,
): void {
  if (!nameMatched) return;

  const name = asNonEmptyString(extract?.business_name);
  const rating = asNonEmptyString(extract?.rating);
  const reviewCount = asNonEmptyString(extract?.review_count);
  const phone = asNonEmptyString(extract?.phone);
  const address = asNonEmptyString(extract?.address);
  const hours = asNonEmptyString(extract?.hours);
  const website = asNonEmptyString(extract?.website);
  const photos = Array.isArray(extract?.photo_urls) ? extract.photo_urls.length : 0;

  if (platformLower.includes("google")) {
    if (name) out.google_name = name;
    out.google_maps_url = url;
    if (address) out.google_address = address;
    if (rating) out.google_rating = rating;
    if (reviewCount) out.google_review_count = reviewCount;
    if (phone) out.google_phone = phone;
    if (hours) out.google_hours = hours;
    if (website) out.google_website = website;
    if (photos > 0) out.google_photos_count = String(photos);
  }

  if (platformLower.includes("yelp")) {
    if (name) out.yelp_name = name;
    out.yelp_url = url;
    if (address) out.yelp_address = address;
    if (rating) out.yelp_rating = rating;
    if (reviewCount) out.yelp_review_count = reviewCount;
    if (phone) out.yelp_phone = phone;
    if (hours) out.yelp_hours = hours;
    if (website) out.yelp_website = website;
    if (photos > 0) out.yelp_photos_count = String(photos);
  }

  if (rating && !out.reviews_average_rating) out.reviews_average_rating = rating;
  if (reviewCount && !out.reviews_total_count) out.reviews_total_count = reviewCount;

  if (platformLower.includes("bbb") && rating) out.bbb_rating = rating;
  if (platformLower.includes("houzz") && rating) out.houzz_rating = rating;
  if (platformLower.includes("angi") && rating) out.angi_rating = rating;
  if (platformLower.includes("thumbtack") && rating) out.thumbtack_rating = rating;
  if (platformLower.includes("homeadvisor") && rating) out.homeadvisor_rating = rating;
  if (platformLower.includes("facebook") && rating) out.facebook_rating = rating;
}

function applyReviewQuotes(
  out: Partial<Record<EnrichmentColumnKey, string | null>>,
  platform: string,
  extract: ContractorListingExtract | null,
): void {
  const quotes = Array.isArray(extract?.review_quotes) ? extract.review_quotes : [];
  const usable = quotes
    .map((q) => ({
      quote: asNonEmptyString(q?.quote),
      author: asNonEmptyString(q?.author),
    }))
    .filter((q): q is { quote: string; author: string | null } => Boolean(q.quote))
    .slice(0, 3);

  if (usable.length === 0) return;

  const slots: Array<{
    quote: EnrichmentColumnKey;
    author: EnrichmentColumnKey;
    source: EnrichmentColumnKey;
  }> = [
    {
      quote: "reviews_recent_quote_1",
      author: "reviews_recent_author_1",
      source: "reviews_recent_source_1",
    },
    {
      quote: "reviews_recent_quote_2",
      author: "reviews_recent_author_2",
      source: "reviews_recent_source_2",
    },
    {
      quote: "reviews_recent_quote_3",
      author: "reviews_recent_author_3",
      source: "reviews_recent_source_3",
    },
  ];

  for (let i = 0; i < usable.length; i++) {
    const slot = slots[i];
    out[slot.quote] = usable[i].quote.slice(0, 400);
    out[slot.author] = stripReviewerLastName(usable[i].author ?? "Customer");
    out[slot.source] = platform;
  }
}

export function mergeSchemaRecords(
  base: Record<string, unknown>,
  patch: Partial<Record<EnrichmentColumnKey, string | null>>,
): Record<EnrichmentColumnKey, string | null> {
  const empty = createEmptySchemaRecord();
  const merged = { ...empty };

  for (const key of ENRICHMENT_COLUMN_KEYS) {
    const existing = base[key];
    if (typeof existing === "string") merged[key] = existing;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (
      key in merged &&
      value != null &&
      value !== "" &&
      (merged[key as EnrichmentColumnKey] == null || merged[key as EnrichmentColumnKey] === "")
    ) {
      merged[key as EnrichmentColumnKey] = value;
    }
  }

  const populated = ENRICHMENT_COLUMN_KEYS.filter((k) => merged[k] != null).length;
  const result = { ...merged } as Record<EnrichmentColumnKey, string | null> & {
    enrichment_completeness_pct?: string;
    schema_populated_count?: string;
  };
  result.schema_populated_count = String(populated);
  result.enrichment_completeness_pct = String(
    Math.round((populated / ENRICHMENT_COLUMN_COUNT) * 100),
  );
  return result as Record<EnrichmentColumnKey, string | null>;
}
