import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type SupabaseAdmin = SupabaseClient<Database>;

/**
 * Strip section html so catalog HTML cannot leak. Keep themeSource / designSpec —
 * those are the generated theme, not catalog HTML.
 */
export async function attachBlockHtmlToConfig(
  _supabase: SupabaseAdmin,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sections = Array.isArray(config.sections) ? config.sections : [];
  const stripped = sections.map((section) => {
    if (!section || typeof section !== "object") return section;
    const { html: _drop, ...rest } = section as Record<string, unknown>;
    return rest;
  });
  const next: Record<string, unknown> = { ...config, sections: stripped, block_html: {} };
  if (typeof config.themeSource === "string") next.themeSource = config.themeSource;
  if (config.designSpec && typeof config.designSpec === "object") next.designSpec = config.designSpec;
  if (config.designBrief && typeof config.designBrief === "object") next.designBrief = config.designBrief;
  if (Array.isArray(config.component_ids)) next.component_ids = config.component_ids;
  if (config.themeFallback === true) next.themeFallback = true;
  return next;
}
