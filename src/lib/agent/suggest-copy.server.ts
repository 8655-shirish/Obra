import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { streamChatCompletion } from "./lovable-ai.server";

type SupabaseAdmin = SupabaseClient<Database>;

/**
 * Layout budget for an overlay text slot (plan §4 manifests). Returned so
 * suggestions fit the design slot the applier will enforce — a suggestion
 * that cannot be accepted is worse than none. Non-text keys (blogs, contact)
 * have no manifest budgets, so callers get undefined and keep prior behavior.
 */
export async function slotBudgetForWebsite(
  supabase: SupabaseAdmin,
  websiteId: string,
  slotKey: string,
): Promise<number | undefined> {
  if (!slotKey.startsWith("text.")) return undefined;
  const { data: website } = await supabase
    .from("websites")
    .select("template_slug")
    .eq("id", websiteId)
    .maybeSingle();
  if (!website?.template_slug) return undefined;
  const { getTemplateManifest } = await import("@/lib/template-content/overlay");
  const manifest = getTemplateManifest(website.template_slug);
  const key = slotKey.slice("text.".length);
  if (!manifest || !Object.prototype.hasOwnProperty.call(manifest.textBudgets, key)) {
    return undefined;
  }
  return manifest.textBudgets[key];
}

export async function suggestGroundedCopy(
  supabase: SupabaseAdmin,
  websiteId: string,
  sectionId: string,
  enrichmentFieldRefs: string[],
  options?: { signal?: AbortSignal; maxChars?: number },
): Promise<{ sectionId: string; copy: string; sourceFieldRefs: string[] }> {
  const [{ data: contractor }, { data: website }] = await Promise.all([
    supabase
      .from("contractor_profiles")
      .select("enrichment_json, business_name, license_number")
      .eq("website_id", websiteId)
      .maybeSingle(),
    supabase.from("websites").select("onboarding_state").eq("id", websiteId).maybeSingle(),
  ]);

  const enrichment = (contractor?.enrichment_json as Record<string, unknown>) ?? {};
  const onboardingRecord =
    website?.onboarding_state && typeof website.onboarding_state === "object"
      ? (website.onboarding_state as Record<string, unknown>)
      : {};
  const { schemaFromMatchedPlatforms } = await import("@/lib/enrichment/enrichment-schema.server");
  const schema = schemaFromMatchedPlatforms(enrichment, {
    ...onboardingRecord,
    businessName:
      (typeof onboardingRecord.businessName === "string" && onboardingRecord.businessName.trim()
        ? onboardingRecord.businessName
        : contractor?.business_name) ?? "",
    licenseNumber:
      (typeof onboardingRecord.licenseNumber === "string" && onboardingRecord.licenseNumber.trim()
        ? onboardingRecord.licenseNumber
        : contractor?.license_number) ?? "",
  });

  const cited: Record<string, string> = {};
  for (const ref of enrichmentFieldRefs) {
    const value = schema[ref];
    if (typeof value === "string" && value.trim()) {
      cited[ref] = value;
    }
  }

  if (Object.keys(cited).length === 0) {
    throw new Error("No enrichment fields available for the requested references");
  }

  let copy = "";
  await streamChatCompletion({
    messages: [
      {
        role: "system",
        content:
          "Write one short website section paragraph using ONLY the provided enrichment fields. Do not invent facts." +
          (options?.maxChars
            ? ` Keep it to at most ${options.maxChars} characters so it fits the design slot.`
            : ""),
      },
      {
        role: "user",
        content: `Section: ${sectionId}\nFields:\n${JSON.stringify(cited, null, 2)}`,
      },
    ],
    signal: options?.signal,
    onToken: (text) => {
      copy += text;
    },
  });

  return {
    sectionId,
    copy: copy.trim(),
    sourceFieldRefs: Object.keys(cited),
  };
}
