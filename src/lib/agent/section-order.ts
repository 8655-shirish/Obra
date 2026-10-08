/** Canonical LP sections — required spine vs evidence-gated bands. */

export const CANONICAL_SECTION_TYPES = [
  "hero",
  "trustmarkers",
  "services",
  "beforeAfter",
  "reviews",
  "warranty",
  "hours",
  "contact",
  "footer",
] as const;

export type CanonicalSectionType = (typeof CANONICAL_SECTION_TYPES)[number];

export type SectionKind = "required" | "evidenceGated";

export type SectionEvidenceInput = {
  trustMarkerCount: number;
  imageCount: number;
  reviewCount: number;
  warranty?: string | null;
  hours?: string | null;
};

export type SectionRegistryEntry = {
  id: CanonicalSectionType;
  kind: SectionKind;
  catalogCategory: string | null;
  noMotion: boolean;
  navLabel: string | null;
  hasEvidence: (evidence: SectionEvidenceInput) => boolean;
};

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Canonical sections that may take a catalogRef. Trustmarkers, contact, warranty, hours stay kit-only. */
export const CATALOG_SECTION_CATEGORIES = {
  hero: "Heroes",
  services: "Feature",
  beforeAfter: "Galleries",
  reviews: "Testimonials",
  footer: "Footers",
} as const;

export type CatalogEligibleSection = keyof typeof CATALOG_SECTION_CATEGORIES;

export const SECTION_REGISTRY: readonly SectionRegistryEntry[] = [
  {
    id: "hero",
    kind: "required",
    catalogCategory: CATALOG_SECTION_CATEGORIES.hero,
    noMotion: false,
    navLabel: null,
    hasEvidence: () => true,
  },
  {
    id: "trustmarkers",
    kind: "evidenceGated",
    catalogCategory: null,
    noMotion: true,
    navLabel: null,
    hasEvidence: (evidence) => evidence.trustMarkerCount > 0,
  },
  {
    id: "services",
    kind: "required",
    catalogCategory: CATALOG_SECTION_CATEGORIES.services,
    noMotion: false,
    navLabel: "Services",
    hasEvidence: () => true,
  },
  {
    id: "beforeAfter",
    kind: "evidenceGated",
    catalogCategory: CATALOG_SECTION_CATEGORIES.beforeAfter,
    noMotion: false,
    navLabel: "Work",
    hasEvidence: (evidence) => evidence.imageCount > 0,
  },
  {
    id: "reviews",
    kind: "evidenceGated",
    catalogCategory: CATALOG_SECTION_CATEGORIES.reviews,
    noMotion: false,
    navLabel: "Reviews",
    hasEvidence: (evidence) => evidence.reviewCount > 0,
  },
  {
    id: "warranty",
    kind: "evidenceGated",
    catalogCategory: null,
    noMotion: false,
    navLabel: "Warranty",
    hasEvidence: (evidence) => nonEmpty(evidence.warranty),
  },
  {
    id: "hours",
    kind: "evidenceGated",
    catalogCategory: null,
    noMotion: false,
    navLabel: "Hours",
    hasEvidence: (evidence) => nonEmpty(evidence.hours),
  },
  {
    id: "contact",
    kind: "required",
    catalogCategory: null,
    noMotion: true,
    navLabel: "Contact",
    hasEvidence: () => true,
  },
  {
    id: "footer",
    kind: "required",
    catalogCategory: CATALOG_SECTION_CATEGORIES.footer,
    noMotion: true,
    navLabel: null,
    hasEvidence: () => true,
  },
];

export const CANONICAL_SECTION_ORDER: CanonicalSectionType[] = SECTION_REGISTRY.map((entry) => entry.id);

export const REQUIRED_SECTION_TYPES: CanonicalSectionType[] = SECTION_REGISTRY.filter(
  (entry) => entry.kind === "required",
).map((entry) => entry.id);

export const NO_MOTION_SECTIONS = new Set<CanonicalSectionType>(
  SECTION_REGISTRY.filter((entry) => entry.noMotion).map((entry) => entry.id),
);

export function isCanonicalSectionType(value: string): value is CanonicalSectionType {
  return (CANONICAL_SECTION_TYPES as readonly string[]).includes(value);
}

export function isCatalogEligibleSection(type: string): type is CatalogEligibleSection {
  return type in CATALOG_SECTION_CATEGORIES;
}

export function sectionVocabulary(): string {
  return CANONICAL_SECTION_TYPES.join(", ");
}

export function sectionIdsForEvidence(evidence: SectionEvidenceInput): CanonicalSectionType[] {
  return SECTION_REGISTRY.filter(
    (entry) => entry.kind === "required" || entry.hasEvidence(evidence),
  ).map((entry) => entry.id);
}

export function evidenceFromCounts(options: {
  hasTrustMarkers?: boolean;
  hasMedia?: boolean;
  hasReviews?: boolean;
  hasWarranty?: boolean;
  hasHours?: boolean;
}): SectionEvidenceInput {
  return {
    trustMarkerCount: options.hasTrustMarkers ? 1 : 0,
    imageCount: options.hasMedia ? 1 : 0,
    reviewCount: options.hasReviews ? 1 : 0,
    warranty: options.hasWarranty ? "yes" : null,
    hours: options.hasHours ? "yes" : null,
  };
}

export function headerNavItems(
  sectionTypes: readonly string[],
  options: { contactHidden?: boolean } = {},
): Array<{ href: string; label: string }> {
  const present = new Set(sectionTypes);
  const items: Array<{ href: string; label: string }> = [];
  for (const entry of SECTION_REGISTRY) {
    if (!entry.navLabel) continue;
    if (entry.id === "contact" && options.contactHidden) continue;
    if (!present.has(entry.id)) continue;
    items.push({ href: `#${entry.id}`, label: entry.navLabel });
  }
  return items;
}
