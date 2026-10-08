/**
 * Agent system prompt layers — loaded each turn alongside tool registry and journal.
 * @see plans/obra_prd § Agent system prompts & tool registry
 */

import { getToolUsePromptLines } from "./tools/registry";

/** Tools reachable on a headless personalize turn. Everything else is unlisted and uncallable. */
export const PERSONALIZE_TOOL_NAMES = [
  "getEnrichmentSummary",
  "suggestCopy",
  "applyTemplatePatch",
  "publishToLp",
] as const;

export const PERSONALIZE_TEMPLATE_PROMPT = `Headless template personalization — no user is present to confirm. Read getEnrichmentSummary for grounded business facts, then write them into the purchaser's template overlay with applyTemplatePatch (text, media, reviews, blogs, contact, identity keys only — the mold, layout, hero motion, and styling are unreachable by construction). Only the listed tools exist on this turn: never generate, regenerate, scrape, onboard, or edit unified configs. Never invent reviews, licenses, ratings, photos, or contact details — unmatched media, review, and contact slots stay empty and template art stays. Use contractor-matched enrichment photos only, including logo and heroPoster when a matched still exists. The summary's textSlots list every text slot the mold renders with its character budget: fill ALL of them, matching the catalog line count (do not pack a paragraph into a display heading). Ground each slot in the facts when they exist; when facts are missing, write neutral trade-appropriate copy for that slot — never leave a text slot empty and never reuse the template's demo wording, because an incomplete overlay cannot publish. When hasReviewSection is true, write reviews from summary.reviews only (matched quotes); if that list is empty, patch reviews: []. Never write demo wording or unmatched quotes. No mold renders blog images, so never set blogs[].image. After each applyTemplatePatch, use its returned revision as expectedRevision on your next mutating call, ending with publishToLp. When the overlay is filled, call publishToLp with the final versionId and expectedRevision.`;

export function buildIntentPrompt(intent: {
  type: "personalize_template";
  versionId?: string;
  expectedRevision?: number;
}): string {
  const target = intent.versionId
    ? ` Work only on versionId \`${intent.versionId}\`` +
      (intent.expectedRevision === undefined
        ? ""
        : ` starting at expectedRevision ${intent.expectedRevision}`) +
      `. Pass that expectedRevision on mutating calls; if a revision conflict names the current revision, retry once with it.`
    : " Use the newest draft template version you can establish from context.";
  return `## Turn instruction\n${PERSONALIZE_TEMPLATE_PROMPT}${target}`;
}

export function buildSystemPrompt(options?: { intentPrompt?: string }): string {
  const layers = [`Registered tools:\n${getToolUsePromptLines()}`];
  if (options?.intentPrompt) {
    layers.push(options.intentPrompt);
  }
  return layers.join("\n\n");
}
