import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import { parseEnrichmentImages, siteMediaPathKind } from "./persist-scraped-media.server.ts";

type Admin = SupabaseClient<Database>;

const HISTORICAL_STATUSES = ["live", "selected", "draft", "discarded", "archived"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Counts media references that are URL-only or sit on a legacy/unowned storage path. */
export function countAffectedMedia(input: {
  websiteId: string;
  configs: unknown[];
  enrichmentImages: unknown;
}): number {
  let count = 0;
  const bump = (storagePath: string | undefined) => {
    if (!storagePath || !siteMediaPathKind(input.websiteId, storagePath)) count += 1;
  };

  for (const raw of input.configs) {
    const config = record(raw);
    const manifest = record(config.mediaManifest).slots;
    for (const slot of Array.isArray(manifest) ? manifest : []) {
      bump(str(record(slot).storagePath));
    }
    const gallery = config.mediaGallery;
    for (const item of Array.isArray(gallery) ? gallery : []) {
      bump(str(record(item).storagePath));
    }
  }

  for (const image of parseEnrichmentImages(input.enrichmentImages)) {
    bump(str((image as Record<string, unknown>).storagePath));
  }

  return count;
}

export type AffectedLicense = {
  licenseNumber: string;
  websiteId: string;
  issueCount: number;
};

/**
 * Read-only, keyset-paginated scan over contractor licenses that still hold
 * URL-only or legacy/unowned media. Cursor is the last license number returned.
 */
export async function listAffectedLicenses(
  supabase: Admin,
  options: { limit: number; cursor?: string | null },
): Promise<{ licenses: AffectedLicense[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(options.limit) || 100, 1), 200);

  let query = supabase
    .from("profiles")
    .select("id, license_number")
    .order("license_number", { ascending: true })
    .limit(limit);
  if (options.cursor) query = query.gt("license_number", options.cursor);

  const { data: profiles, error } = await query;
  if (error) throw new Error("Unable to list licenses");

  const rows = profiles ?? [];
  const licenses: AffectedLicense[] = [];

  for (const profile of rows) {
    const { data: websites } = await supabase
      .from("websites")
      .select("id")
      .eq("user_id", profile.id);
    for (const website of websites ?? []) {
      const [{ data: versions }, { data: contractor }] = await Promise.all([
        supabase
          .from("website_versions")
          .select("config_json, status")
          .eq("website_id", website.id),
        supabase
          .from("contractor_profiles")
          .select("enrichment_json")
          .eq("website_id", website.id)
          .maybeSingle(),
      ]);
      const configs = (versions ?? [])
        .filter((row) => HISTORICAL_STATUSES.includes(row.status))
        .map((row) => row.config_json);
      const issueCount = countAffectedMedia({
        websiteId: website.id,
        configs,
        enrichmentImages: record(contractor?.enrichment_json).images,
      });
      if (issueCount > 0) {
        licenses.push({
          licenseNumber: profile.license_number,
          websiteId: website.id,
          issueCount,
        });
      }
    }
  }

  const nextCursor =
    rows.length === limit ? (rows[rows.length - 1]?.license_number ?? null) : null;
  return { licenses, nextCursor };
}

export type LicenseResolution =
  | { ok: true; websiteId: string; licenseNumber: string }
  | { ok: false; status: 404 }
  | { ok: false; status: 409; profileIds: string[]; websiteIds: string[] };

/** Resolves a license number to exactly one website; never guesses on ambiguity. */
export async function resolveLicenseToWebsite(
  supabase: Admin,
  licenseNumber: string,
): Promise<LicenseResolution> {
  const normalized = licenseNumber.trim().toUpperCase();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("license_number", normalized);
  if (error) throw new Error("Unable to look up license");
  if (!profiles || profiles.length === 0) return { ok: false, status: 404 };
  if (profiles.length > 1) {
    return { ok: false, status: 409, profileIds: profiles.map((p) => p.id), websiteIds: [] };
  }

  const profileId = profiles[0]!.id;
  const { data: websites, error: websitesError } = await supabase
    .from("websites")
    .select("id")
    .eq("user_id", profileId);
  if (websitesError) throw new Error("Unable to look up websites");
  const ids = (websites ?? []).map((w) => w.id);
  if (ids.length === 0) return { ok: false, status: 404 };
  if (ids.length > 1) return { ok: false, status: 409, profileIds: [profileId], websiteIds: ids };
  return { ok: true, websiteId: ids[0]!, licenseNumber: normalized };
}
