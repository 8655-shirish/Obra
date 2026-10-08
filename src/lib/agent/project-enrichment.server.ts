/**
 * Deterministic projection of enrichment_json into website config_json.
 * LLM may refine copy; this ensures facts/images are not omitted when present.
 */

import { coerceLookAndFeel, preferSchemaReviews, type EvidenceReview } from "../site-evidence.ts";
import { buildFactSheet, parseServiceItems } from "../site-fact-sheet.ts";
import {
  type CanonicalSectionType,
  isCanonicalSectionType,
  sectionIdsForEvidence,
} from "./section-order.ts";

type ExtraReview = EvidenceReview;

type Section = {
  id: string;
  type: string;
  heading: string;
  body: string;
  html?: string;
  [key: string]: unknown;
};

function isGenericReviewBody(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    !body.trim() ||
    lower.includes("professional contractor services tailored") ||
    lower.includes("reviews and credentials sourced from public listings")
  );
}

function isGenericServicesBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();
  return lower === "services" || lower.includes("professional contractor services");
}

function defaultSection(
  variantKey: string,
  type: CanonicalSectionType,
  config: Record<string, unknown>,
): Section {
  const businessName = String(config.businessName ?? "Your Business");
  const city = String(config.city ?? "California");
  const licenseNumber = String(config.licenseNumber ?? "");
  const trade = String(config.trade ?? "");

  switch (type) {
    case "hero":
      return {
        id: `${variantKey}-hero`,
        type: "hero",
        heading: businessName,
        body: `${trade} services in ${city}.`,
      };
    case "trustmarkers":
      return {
        id: `${variantKey}-trustmarkers`,
        type: "trustmarkers",
        heading: "Trusted credentials",
        body: "",
      };
    case "services":
      return {
        id: `${variantKey}-services`,
        type: "services",
        heading: "Services offered",
        body: trade ? `${trade} work in ${city}.` : `Contractor services in ${city}.`,
      };
    case "beforeAfter":
      return {
        id: `${variantKey}-beforeAfter`,
        type: "beforeAfter",
        heading: "Our work",
        body: "Project photos from recent jobs.",
      };
    case "reviews":
      return {
        id: `${variantKey}-reviews`,
        type: "reviews",
        heading: "Reviews",
        body: "",
      };
    case "contact":
      return {
        id: `${variantKey}-contact`,
        type: "contact",
        heading: "Request a quote",
        body: `Tell us about your project in ${city} and surrounding areas.`,
      };
    case "warranty":
      return {
        id: `${variantKey}-warranty`,
        type: "warranty",
        heading: "Warranty",
        body: String(config.warranty ?? ""),
      };
    case "hours":
      return {
        id: `${variantKey}-hours`,
        type: "hours",
        heading: "Hours",
        body: String(config.hours ?? ""),
      };
    case "footer":
      return {
        id: `${variantKey}-footer`,
        type: "footer",
        heading: businessName,
        body: [licenseNumber ? `Licensed #${licenseNumber}` : null, city]
          .filter(Boolean)
          .join(" · "),
      };
  }
}

function normalizeSections(
  sections: Section[],
  config: Record<string, unknown>,
  options: {
    includeBeforeAfter: boolean;
    includeTrustmarkers: boolean;
    includeReviews: boolean;
    includeWarranty: boolean;
    includeHours: boolean;
  },
): Section[] {
  const variantKey = String(config.variantKey ?? "v1");
  const byType = new Map<string, Section>();
  for (const section of sections) {
    if (!isCanonicalSectionType(section.type)) continue;
    if (!byType.has(section.type)) byType.set(section.type, section);
  }

  const order = sectionIdsForEvidence({
    trustMarkerCount: options.includeTrustmarkers ? 1 : 0,
    imageCount: options.includeBeforeAfter ? 1 : 0,
    reviewCount: options.includeReviews ? 1 : 0,
    warranty: options.includeWarranty ? "yes" : null,
    hours: options.includeHours ? "yes" : null,
  });

  return order.map((type) => {
    const existing = byType.get(type);
    if (existing) {
      const cleaned = { ...existing };
      if (type !== "hero") delete cleaned.html;
      return cleaned;
    }
    return defaultSection(variantKey, type, config);
  });
}

export function projectEnrichmentToSiteConfig(
  config: Record<string, unknown>,
  enrichment: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };
  next.lookAndFeel = coerceLookAndFeel(next.lookAndFeel);

  const sheet = buildFactSheet(next, enrichment);
  const gallery = sheet.images;
  next.mediaGallery = gallery;

  const existingExtra = Array.isArray(next.extraReviews)
    ? (next.extraReviews as ExtraReview[])
    : [];
  const extraReviews = preferSchemaReviews(
    sheet.reviews,
    existingExtra,
    String(next.trade ?? ""),
  );
  next.extraReviews = extraReviews;
  next.trustMarkers = sheet.trustMarkers;

  if (sheet.phone) next.phone = sheet.phone;
  if (sheet.address) next.address = sheet.address;
  if (sheet.hours) next.hours = sheet.hours;
  else next.hours = null;
  if (sheet.warranty) next.warranty = sheet.warranty;

  const listingServices = parseServiceItems(sheet.servicesOffered);
  if (listingServices.length > 0) next.services = listingServices;

  const phone = typeof next.phone === "string" ? next.phone : null;
  const address = typeof next.address === "string" ? next.address : null;

  const rawSections = Array.isArray(next.sections)
    ? ([...(next.sections as Section[])] as Section[])
    : [];

  const normalized = normalizeSections(rawSections, next, {
    includeBeforeAfter: gallery.length > 0,
    includeTrustmarkers: sheet.trustMarkers.length > 0,
    includeReviews: extraReviews.length > 0,
    includeWarranty: Boolean(sheet.warranty),
    includeHours: Boolean(sheet.hours),
  });

  next.sectionOrder = normalized.map((s) => s.type);

  next.sections = normalized.map((section) => {
    if (section.type === "services") {
      const heading = section.heading?.trim() || "Services offered";
      const body = section.body ?? "";
      if (isGenericServicesBody(body)) {
        const trade = String(next.trade ?? "").trim();
        const city = String(next.city ?? "California");
        return {
          ...section,
          heading,
          body: trade ? `${trade} work in ${city}.` : `Contractor services in ${city}.`,
        };
      }
      return { ...section, heading };
    }
    if (section.type === "reviews") {
      const extras = Array.isArray(next.extraReviews)
        ? (next.extraReviews as ExtraReview[])
        : [];
      if (extras.length > 0) {
        const first = extras[0];
        const body = section.body ?? "";
        const duplicatesList =
          isGenericReviewBody(body) || (first?.quote ? body.includes(first.quote) : false);
        if (duplicatesList) {
          return {
            ...section,
            heading: section.heading?.trim() || "Reviews",
            body: "What customers say about our work.",
          };
        }
      }
    }
    if (section.type === "beforeAfter") {
      // Slot is project photos only — never keep LLM "before/after" transformation claims.
      return {
        ...section,
        heading: "Our work",
        body: "Project photos from recent jobs.",
      };
    }
    if (section.type === "warranty" && sheet.warranty) {
      return {
        ...section,
        heading: section.heading?.trim() || "Warranty",
        body: section.body?.trim() || sheet.warranty,
      };
    }
    if (section.type === "hours" && sheet.hours) {
      return {
        ...section,
        heading: section.heading?.trim() || "Hours",
        body: section.body?.trim() || sheet.hours,
      };
    }
    if (section.type === "footer") {
      const businessName = String(next.businessName ?? section.heading ?? "");
      const licenseNumber = String(next.licenseNumber ?? "");
      const city = String(next.city ?? "");
      const parts = [
        licenseNumber ? `Licensed #${licenseNumber}` : null,
        city || null,
        phone,
        address,
      ].filter(Boolean);
      return {
        ...section,
        heading: businessName || section.heading,
        body: parts.join(" · "),
      };
    }
    if (section.type === "hero" && typeof section.html === "string") {
      return section;
    }
    if (section.type !== "hero") {
      const { html: _drop, ...rest } = section;
      return rest;
    }
    return section;
  });

  return next;
}
