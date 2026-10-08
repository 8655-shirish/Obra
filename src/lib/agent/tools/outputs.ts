import { z } from "zod";

export const getEnrichmentSummaryOutput = z.object({
  websiteId: z.string().uuid(),
  templateSlug: z.string().nullable(),
  /** Text slots the template mold renders, with budgets — the personalize turn must fill all of them. */
  textSlots: z.array(z.object({ key: z.string(), maxChars: z.number() })),
  mediaSlots: z.array(z.string()),
  hasReviewSection: z.boolean(),
  researchStatus: z.string().nullable(),
  listedWebsite: z.object({
    status: z.string(),
    headline: z.string(),
    detail: z.string().nullable(),
    opsNote: z.string().nullable(),
    hosts: z.array(
      z.object({
        host: z.string(),
        url: z.string(),
        kind: z.string(),
        platforms: z.array(z.string()),
      }),
    ),
  }),
  summary: z.record(z.unknown()),
});

export const publishToLpOutput = z.object({
  websiteId: z.string().uuid(),
  versionId: z.string().uuid(),
  publicUrl: z.string(),
});

export const suggestCopyOutput = z.object({
  sectionId: z.string(),
  copy: z.string(),
  sourceFieldRefs: z.array(z.string()),
});

export const applyTemplatePatchOutput = z.object({
  websiteId: z.string().uuid(),
  versionId: z.string().uuid(),
  revision: z.number().int().nonnegative(),
});

export const toolOutputSchemas = {
  getEnrichmentSummary: getEnrichmentSummaryOutput,
  publishToLp: publishToLpOutput,
  suggestCopy: suggestCopyOutput,
  applyTemplatePatch: applyTemplatePatchOutput,
} as const;
