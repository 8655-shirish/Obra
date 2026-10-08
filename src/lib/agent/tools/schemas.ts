import { z } from "zod";

export const saveOnboardingFieldInput = z.object({
  websiteId: z.string().uuid(),
  field: z.enum([
    "businessName",
    "licenseNumber",
    "trade",
    "services",
    "theme",
    "primaryColor",
    "lookAndFeel",
    "city",
  ]),
  value: z.unknown(),
});

export const getEnrichmentSummaryInput = z.object({
  websiteId: z.string().uuid(),
});

export const publishToLpInput = z.object({
  websiteId: z.string().uuid(),
  versionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
});

export const suggestCopyInput = z.object({
  websiteId: z.string().uuid(),
  sectionId: z.string(),
  enrichmentFieldRefs: z.array(z.string()).min(1),
});

export const applyTemplatePatchInput = z.object({
  websiteId: z.string().uuid(),
  versionId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
  patch: z.object({
    text: z.record(z.string(), z.string().nullable()).optional(),
    media: z.record(z.string(), z.string().nullable()).optional(),
    reviews: z
      .array(
        z.object({
          quote: z.string(),
          author: z.string(),
          attribution: z.string().nullable(),
        }),
      )
      .optional(),
    blogs: z
      .array(
        z.object({
          category: z.string(),
          title: z.string(),
          excerpt: z.string(),
          image: z.string().nullable(),
        }),
      )
      .optional(),
    contact: z
      .object({
        phone: z.string().nullable(),
        email: z.string().nullable(),
        area: z.string().nullable(),
        hours: z.string().nullable(),
      })
      .partial()
      .optional(),
    identity: z
      .object({
        businessName: z.string().max(200).nullable(),
        licenseNumber: z.string().max(50).nullable(),
        city: z.string().max(200).nullable(),
        phone: z.string().max(40).nullable(),
        email: z.string().max(200).nullable(),
      })
      .partial()
      .optional(),
  }),
});

export const toolInputSchemas = {
  getEnrichmentSummary: getEnrichmentSummaryInput,
  publishToLp: publishToLpInput,
  suggestCopy: suggestCopyInput,
  applyTemplatePatch: applyTemplatePatchInput,
} as const;

export { toolOutputSchemas } from "./outputs";

export type ToolName = keyof typeof toolInputSchemas;

export type ToolType = "read" | "write" | "external";

export interface ToolDefinition {
  name: ToolName;
  type: ToolType;
  description: string;
  serverOnly: boolean;
}
