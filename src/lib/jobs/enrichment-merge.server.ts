import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { schemaFromMatchedPlatforms } from "@/lib/enrichment/enrichment-schema.server";
import { imagesFromMatchedPlatforms } from "@/lib/integrations/firecrawl.server";
import { overlayStoragePathByUrl } from "@/lib/site-evidence";

import type { EnrichmentSubject } from "./enrichment-subject";

type EnrichmentImageRef = { url: string; platform: string; alt?: string };

type SupabaseAdmin = SupabaseClient<Database>;

/**
 * Merge per-platform enrichment partials into the subject's enrichment_json.
 */
export async function mergeEnrichmentPlatformResult(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
  platform: string,
  partial: Record<string, unknown>,
  onboarding: Record<string, unknown>,
): Promise<void> {
  const identity = {
    businessName: typeof onboarding.businessName === "string" ? onboarding.businessName : "",
    licenseNumber: typeof onboarding.licenseNumber === "string" ? onboarding.licenseNumber : "",
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentRow = await loadEnrichmentRow(supabase, subject);
    const current = asEnrichmentRoot(currentRow.enrichment_json);
    const platforms = { ...current.platforms, [platform]: partial };
    const nextRoot = { ...current, platforms };
    const schema = schemaFromMatchedPlatforms(nextRoot, onboarding);
    const existingImages = Array.isArray(current.images)
      ? (current.images as EnrichmentImageRef[])
      : [];
    const mergedImages = overlayStoragePathByUrl(
      imagesFromMatchedPlatforms(nextRoot, identity),
      existingImages,
    );
    const nextJson = {
      ...current,
      platforms,
      schema,
      images: mergedImages,
      schema_version: 1,
      last_merged_at: new Date().toISOString(),
    } as unknown as Json;
    const updated = await saveEnrichmentRow(supabase, subject, currentRow.updated_at, nextJson);
    if (updated) return;
  }
  throw new Error("Concurrent updates prevented enrichment merge");
}

async function loadEnrichmentRow(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
): Promise<{ enrichment_json: Json; updated_at: string }> {
  if (subject.kind === "website") {
    const { data, error } = await supabase
      .from("contractor_profiles")
      .select("enrichment_json,updated_at")
      .eq("website_id", subject.websiteId)
      .maybeSingle();
    if (error) throw new Error("Unable to load enrichment data");
    if (!data) throw new Error("Contractor profile not found for enrichment merge");
    return data;
  }
  const { data, error } = await supabase
    .from("contractor_research_rows")
    .select("enrichment_json,updated_at")
    .eq("id", subject.researchRowId)
    .maybeSingle();
  if (error) throw new Error("Unable to load enrichment data");
  if (!data) throw new Error("Research row not found for enrichment merge");
  return data;
}

async function saveEnrichmentRow(
  supabase: SupabaseAdmin,
  subject: EnrichmentSubject,
  updatedAt: string,
  enrichmentJson: Json,
): Promise<boolean> {
  if (subject.kind === "website") {
    const { data, error } = await supabase
      .from("contractor_profiles")
      .update({ enrichment_json: enrichmentJson })
      .eq("website_id", subject.websiteId)
      .eq("updated_at", updatedAt)
      .select("website_id")
      .maybeSingle();
    if (error) throw new Error("Unable to merge enrichment data");
    return Boolean(data);
  }
  const { data, error } = await supabase
    .from("contractor_research_rows")
    .update({ enrichment_json: enrichmentJson })
    .eq("id", subject.researchRowId)
    .eq("updated_at", updatedAt)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Unable to merge enrichment data");
  return Boolean(data);
}

function asEnrichmentRoot(value: unknown): {
  platforms: Record<string, unknown>;
  schema?: Record<string, unknown>;
  [key: string]: unknown;
} {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const platforms =
      record.platforms && typeof record.platforms === "object" && !Array.isArray(record.platforms)
        ? { ...(record.platforms as Record<string, unknown>) }
        : {};
    return { ...record, platforms };
  }

  return { platforms: {} };
}
