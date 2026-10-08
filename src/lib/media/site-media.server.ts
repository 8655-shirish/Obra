import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../integrations/supabase/types.ts";
import { overlayStoragePathByUrl, type EvidenceMediaItem } from "../site-evidence.ts";
import { mediaManifestFromConfig } from "../site-theme/media-manifest.ts";
import { isOwnedSiteMediaPath } from "./persist-scraped-media.server.ts";

type SupabaseAdmin = SupabaseClient<Database>;

/** Refreshed on each preview / `/lp` load — not stored in `config_json`. */
export const SITE_MEDIA_SIGNED_TTL_SECONDS = 60 * 60 * 24;

export async function signSiteMediaPath(
  supabase: SupabaseAdmin,
  storagePath: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("site-media")
    .createSignedUrl(storagePath, SITE_MEDIA_SIGNED_TTL_SECONDS);

  if (error) {
    console.error("[signSiteMediaPath]", storagePath, error);
    return null;
  }

  return data?.signedUrl ?? null;
}

/**
 * Sign stored files for display and overlay authoritative persisted enrichment
 * metadata onto gallery items. This read path never repairs or writes media.
 */
export async function resolveSiteMediaInConfig(
  supabase: SupabaseAdmin,
  config: Record<string, unknown>,
  options?: { websiteId?: string },
): Promise<Record<string, unknown>> {
  const next = { ...config };
  let overlaySources: EvidenceMediaItem[] = [];

  if (options?.websiteId) {
    try {
      const { parseEnrichmentImages } = await import("./persist-scraped-media.server.ts");
      const { data } = await supabase
        .from("contractor_profiles")
        .select("enrichment_json")
        .eq("website_id", options.websiteId)
        .maybeSingle();
      const enrichment = (data?.enrichment_json as Record<string, unknown>) ?? {};
      overlaySources = parseEnrichmentImages(enrichment.images);
    } catch (error) {
      console.error("[resolveSiteMediaInConfig] persist", error);
    }
  }

  const logoPath =
    typeof config.logoStoragePath === "string" && config.logoStoragePath.trim()
      ? config.logoStoragePath
      : null;

  if (logoPath && (!options?.websiteId || isOwnedSiteMediaPath(options.websiteId, logoPath))) {
    const signed = await signSiteMediaPath(supabase, logoPath);
    next.logoUrl = signed ?? null;
  } else if (logoPath) {
    next.logoUrl = null;
  }

  const manifestResult = mediaManifestFromConfig(config);
  if (manifestResult.kind === "current") {
    const hydrated = await Promise.all(
      manifestResult.manifest.slots.map(async (slot) => {
        if (
          !slot.storagePath ||
          (options?.websiteId && !isOwnedSiteMediaPath(options.websiteId, slot.storagePath))
        )
          return { ...slot, url: undefined };
        const signed = await signSiteMediaPath(supabase, slot.storagePath);
        return { ...slot, url: signed ?? undefined };
      }),
    );
    next.mediaManifest = { slots: hydrated };
  }

  if (Array.isArray(config.mediaGallery)) {
    const gallery = overlayStoragePathByUrl(
      config.mediaGallery as EvidenceMediaItem[],
      overlaySources,
    );
    next.mediaGallery = await Promise.all(
      gallery.map(async (item) => {
        const storagePath =
          typeof item.storagePath === "string" && item.storagePath.trim()
            ? item.storagePath.trim()
            : null;
        if (
          !storagePath ||
          (options?.websiteId && !isOwnedSiteMediaPath(options.websiteId, storagePath))
        )
          return { ...item, url: undefined };

        const signed = await signSiteMediaPath(supabase, storagePath);
        return { ...item, url: signed ?? undefined };
      }),
    );
  }

  return next;
}
