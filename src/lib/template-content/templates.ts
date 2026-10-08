import {
  buildTemplateMoldContent,
  isTemplatePurchaseSlug,
  templateOverlaySchema,
  type TemplateMoldContent,
  type TemplatePurchaseSlug,
} from "./overlay";

export interface TemplateIdentity {
  businessName: string | null;
  licenseNumber: string | null;
  city: string | null;
}

export interface TemplatePageView {
  slug: TemplatePurchaseSlug;
  content: TemplateMoldContent;
  identity: TemplateIdentity;
}

/**
 * Resolves a validated template overlay to renderable mold content. Unknown
 * slugs, unwired molds, and non-template configs resolve to null so callers
 * fall back to the unified renderer.
 */
export function resolveTemplatePageView(
  config: unknown,
  templateMedia: Record<string, string>,
): TemplatePageView | null {
  const parsed = templateOverlaySchema.safeParse(config);
  if (!parsed.success || !isTemplatePurchaseSlug(parsed.data.templateSlug)) return null;
  const content = buildTemplateMoldContent(parsed.data, templateMedia);
  if (!content) return null;
  const { businessName, licenseNumber, city } = parsed.data.identity;
  return {
    slug: parsed.data.templateSlug,
    content,
    identity: { businessName, licenseNumber, city },
  };
}
