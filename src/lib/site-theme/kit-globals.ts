/** Identifiers the generated theme may use besides React and props. */
export const SITE_KIT_PRIMITIVES = [
  "Section",
  "LeadSlot",
  "Button",
  "Media",
  "Heading",
  "TopBar",
  "Grid",
  "Card",
  "Quote",
] as const;

export const SITE_KIT_OPTIONAL_COMPOSITES = ["Hero", "Header", "Nav", "QuoteCta", "MediaGallery", "TrustMarkerList"] as const;
export const SITE_KIT_HELPERS = ["firstStill"] as const;

export const SITE_KIT_GLOBALS = [
  ...SITE_KIT_PRIMITIVES,
  ...SITE_KIT_OPTIONAL_COMPOSITES,
  ...SITE_KIT_HELPERS,
] as const;
