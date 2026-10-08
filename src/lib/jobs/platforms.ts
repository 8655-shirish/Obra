/** BUSINESS-CASE platform order for sequential enrichment chains (PRD § Enrichment). */
export const ENRICHMENT_PLATFORMS = [
  "CSLB",
  "Google",
  "Yelp",
  "BuildZoom",
  "Angi",
  "Thumbtack",
  "Facebook",
  "Instagram",
  "BBB",
  "Houzz",
  "HomeAdvisor",
  "Nextdoor",
  "Aggregates",
] as const;

export type EnrichmentPlatform = (typeof ENRICHMENT_PLATFORMS)[number];

export const JOB_TYPE_ENRICHMENT = "enrichment_platform" as const;
export const JOB_TYPE_SITE_GENERATION = "site_generation" as const;
export const JOB_TYPE_ADD_VIDEO = "add_video" as const;

export type BackgroundJobType =
  | typeof JOB_TYPE_ENRICHMENT
  | typeof JOB_TYPE_SITE_GENERATION
  | typeof JOB_TYPE_ADD_VIDEO;
