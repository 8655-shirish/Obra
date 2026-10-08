import type { SiteFactSheet } from "@/lib/site-fact-sheet";
import type { ResolvedMediaManifest } from "@/lib/site-theme/media-manifest";
import type { CurrentUnifiedPlan } from "./unified-design-brief.ts";
import type { DesignPreferences } from "./design-preferences.server.ts";
import type { GachaPack } from "./gacha.ts";

export {
  UNIFIED_SITE_AGENT_SYSTEM_PROMPT,
  UNIFIED_SITE_AGENT_PLAN_PROMPT,
} from "./unified-site-agent.prompt.ts";

export const FIRECRAWL_MARKDOWN_CAP = 2500;

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function truncateMarkdownFields(value: unknown, max: number): unknown {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => truncateMarkdownFields(item, max));
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if (key === "markdown" && typeof nested === "string") {
      next[key] = truncateText(nested, max);
    } else {
      next[key] = truncateMarkdownFields(nested, max);
    }
  }
  return next;
}

/** Same enrichment.platforms shape, with markdown truncated per node. */
export function formatFirecrawlForAgent(
  enrichment: Record<string, unknown>,
  maxMarkdown = FIRECRAWL_MARKDOWN_CAP,
): string {
  const platforms = enrichment.platforms;
  if (!platforms || typeof platforms !== "object") return "(none)";
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(platforms as Record<string, unknown>)) {
    next[key] = truncateMarkdownFields(value, maxMarkdown);
  }
  return JSON.stringify(next, null, 2);
}

/** Prior-version note for the page writer. No two-step layout taxonomy. */
export function unifiedPriorNote(summary?: string): string {
  if (!summary?.trim()) return "This is the first variant for this site.";
  return "A prior version exists. Treat similarity as advisory only; choose the composition that best serves the accepted brief and do not copy source code.";
}

export function unifiedSiteAgentPlanUserPrompt(options: {
  variantKey: string;
  contactHidden: boolean;
  factSheet: SiteFactSheet;
  enrichment: Record<string, unknown>;
  priorNote: string;
  retryNote: string;
  evidenceStillCount: number;
  designPreferences: DesignPreferences;
}): string {
  return `Variant key: ${options.variantKey}
contactHidden: ${options.contactHidden}
lookAndFeel: ${options.factSheet.lookAndFeel}
primary hex: ${options.factSheet.primaryColor}
${options.priorNote}${options.retryNote}

Normalized designPreferences (versioned server interpretation; raw acceptance prose is withheld):
${JSON.stringify(options.designPreferences, null, 2)}

Authoritative usable project-photo count: ${options.evidenceStillCount}. Do not require more evidence identities than exist. Media is optional: zero, evidence-only, or generated-atmosphere slots are valid. Generated or either slots require generationPrompt; evidence slots omit it. Declare only stable media slots and operational anchors that host behavior must address. Keep layout, section order, media placement, and responsive suggestions inside non-authoritative creativeBrief.

Fact sheet:
${JSON.stringify(options.factSheet, null, 2)}

Firecrawl / platform research:
${formatFirecrawlForAgent(options.enrichment)}

Return the plan fields directly as one JSON object. Do not wrap them in unifiedBrief. No mediaShots and no themeSource.`;
}

export function unifiedSiteAgentUserPrompt(options: {
  variantKey: string;
  contactHidden: boolean;
  factSheet: SiteFactSheet;
  priorNote: string;
  retryNote: string;
  unifiedPlan: CurrentUnifiedPlan;
  gachaPack: GachaPack;
  mediaManifest: ResolvedMediaManifest;
  designPreferences: DesignPreferences;
}): string {
  const lockedLook = `\nLocked look (binding family, media recipe, and writer guidance; composition is yours):\n${JSON.stringify(
    {
      id: options.gachaPack.id,
      family: options.gachaPack.family,
      typeRoles: options.gachaPack.typeRoles,
      densityAndSpacing: options.gachaPack.densityAndSpacing,
      geometryAndSurface: options.gachaPack.geometryAndSurface,
      colorStrategy: options.gachaPack.colorStrategy,
      heroTreatment: options.gachaPack.heroTreatment,
      rhythm: options.gachaPack.rhythm,
      avoid: options.gachaPack.avoid,
      mobile: options.gachaPack.mobile,
      writerGuidance: options.gachaPack.writerGuidance,
    },
    null,
    2,
  )}\n\nNormalized designPreferences (must/mustNot are binding):\n${JSON.stringify(options.designPreferences, null, 2)}\n\nRequired media slots (use these literal slotId values; do not invent slots):\n${JSON.stringify(options.unifiedPlan.operationalIntent.mediaSlots.map((slot) => ({ slotId: slot.slotId, role: slot.role, required: slot.required, sourcePreference: slot.sourcePreference })), null, 2)}\n\nResolved media manifest:\n${JSON.stringify(options.mediaManifest, null, 2)}\n`;

  return `Variant key: ${options.variantKey}
contactHidden: ${options.contactHidden}
lookAndFeel: ${options.factSheet.lookAndFeel}
primary hex: ${options.factSheet.primaryColor}
${options.priorNote}${options.retryNote}
${lockedLook}
Host bindings: bind every planned image as a literal <Media slotId="the-planned-slot-id" />. Initial generation is still-only: do not add a video Media slot. Never use item= or compute a slot ID. LeadSlot needs fields={props.leadFields} canSubmitLead={props.canSubmitLead}. Button href="#contact" opens the quote flow. Each primary section root needs a unique literal data-site-section="slug".

props carries: businessName, logoUrl, licenseNumber, city, trade, phone, address, hours, warranty, services, mediaSlots, reviews, trustMarkers, leadFields, canSubmitLead, contactHidden, conversionAsk, primaryColor, theme.

Operational media slots resolve through the still-only manifest. Generated media is brand atmosphere, never project proof; only proof-eligible evidence may occupy a proof slot. Required slots and operational anchors are binding; exact placement and composition are not.

Do not put a name, quote, rating, or photo on the page unless it is in the curated fact sheet or resolved manifest.

Fact sheet:
${JSON.stringify(options.factSheet, null, 2)}`;
}
