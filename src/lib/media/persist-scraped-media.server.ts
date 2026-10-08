/**
 * Download curated enrichment image URLs into the site-media bucket.
 * storagePath is an attribute of the source URL identity — not a second gallery.
 */

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../../integrations/supabase/types.ts";
import {
  isDroppableImageUrl,
  isProofEligibleStillMimeType,
  MIN_USABLE_EVIDENCE_EDGE,
  overlayStoragePathByUrl,
} from "../site-evidence.ts";
import { extensionForMime, validateMediaUpload } from "../media-validation.ts";
import { buildFactSheet, listingUrlForImage } from "../site-fact-sheet.ts";
import { isGeneratedMediaRelativePath } from "./generated-media-path.ts";
import { detectImageMimeType, validateDecodedImageBytes } from "./image-metadata.ts";
import { readBodyLimited, safeFetchRemoteMedia } from "./safe-remote-media.server.ts";

type SupabaseAdmin = SupabaseClient<Database>;

export type EnrichmentImageRef = {
  url: string;
  platform?: string;
  alt?: string;
  storagePath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  aspect?: number;
  orientation?: "landscape" | "portrait" | "square";
  contentHash?: string;
  provenance?: {
    kind: "evidence";
    sourceUrl?: string;
    platform?: string;
    storageBucket?: "site-media";
  };
  proofEligible?: boolean;
};

export type PersistScrapedMediaDeps = {
  fetch?: typeof fetch;
  upload?: (
    path: string,
    body: Uint8Array,
    mimeType: string,
  ) => Promise<{ ok: boolean; created?: boolean }>;
  downloadStorage?: (path: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
  writeBack?: boolean;
  onboarding?: Record<string, unknown>;
  signal?: AbortSignal;
};

function asImageRef(value: unknown): EnrichmentImageRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const url = typeof rec.url === "string" ? rec.url.trim() : "";
  if (!url) return null;
  return {
    url,
    platform: typeof rec.platform === "string" ? rec.platform : undefined,
    alt: typeof rec.alt === "string" ? rec.alt : undefined,
    storagePath:
      typeof rec.storagePath === "string" && rec.storagePath.trim()
        ? rec.storagePath.trim()
        : undefined,
    mimeType: typeof rec.mimeType === "string" ? rec.mimeType : undefined,
    width: typeof rec.width === "number" ? rec.width : undefined,
    height: typeof rec.height === "number" ? rec.height : undefined,
    aspect: typeof rec.aspect === "number" ? rec.aspect : undefined,
    orientation:
      rec.orientation === "landscape" ||
      rec.orientation === "portrait" ||
      rec.orientation === "square"
        ? rec.orientation
        : undefined,
    contentHash: typeof rec.contentHash === "string" ? rec.contentHash : undefined,
    provenance:
      rec.provenance && typeof rec.provenance === "object"
        ? (rec.provenance as EnrichmentImageRef["provenance"])
        : undefined,
    proofEligible: typeof rec.proofEligible === "boolean" ? rec.proofEligible : undefined,
  };
}

export function siteMediaPathKind(
  websiteId: string,
  storagePath: string | undefined,
): "upload" | "enrichment" | "generated" | null {
  if (
    !storagePath ||
    [...storagePath].some(
      (character) =>
        character === "\\" || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /%(?:2f|5c|2e)/i.test(storagePath)
  )
    return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(storagePath);
  } catch {
    return null;
  }
  if (
    decoded !== storagePath ||
    decoded.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  const prefix = `${websiteId}/`;
  if (!storagePath.startsWith(prefix)) return null;
  const relative = storagePath.slice(prefix.length);
  if (/^enrichment\/[a-f0-9]{64}\.(?:png|jpe?g|webp)$/.test(relative)) return "enrichment";
  if (isGeneratedMediaRelativePath(relative)) return "generated";
  if (/^[0-9]+-[a-f0-9]{8}\.(?:png|jpe?g|webp|gif|mp4)$/.test(relative)) return "upload";
  return null;
}

export function isOwnedSiteMediaPath(websiteId: string, storagePath: string | undefined): boolean {
  return siteMediaPathKind(websiteId, storagePath) !== null;
}

export function isOwnedEvidenceMediaPath(
  websiteId: string,
  storagePath: string | undefined,
): boolean {
  const kind = siteMediaPathKind(websiteId, storagePath);
  return kind === "upload" || kind === "enrichment";
}

export function parseEnrichmentImages(images: unknown): EnrichmentImageRef[] {
  if (!Array.isArray(images)) return [];
  const out: EnrichmentImageRef[] = [];
  for (const item of images) {
    const parsed = asImageRef(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

function mimeFromContentType(header: string | null, url: string): string {
  const raw = (header ?? "").toLowerCase().split(";")[0].trim();
  if (raw && raw !== "application/octet-stream") return raw;
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".mp4")) return "video/mp4";
  return "image/jpeg";
}

export async function downloadMediaForPersist(
  url: string,
  fetchImpl?: typeof fetch,
  referer?: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  if (isDroppableImageUrl(url)) return null;
  try {
    const headers: Record<string, string> = {
      Accept: "image/*,video/mp4,image/gif,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; ObraSiteMedia/1.0)",
    };
    if (referer) headers.Referer = referer;
    const { bytes: buffer, response } = await safeFetchRemoteMedia(url, {
      ...(fetchImpl ? { fetchImpl, resolveHost: async () => ["93.184.216.34"] } : {}),
      headers,
      maxBytes: 50 * 1024 * 1024,
      ...(signal ? { signal } : {}),
    });
    const mimeType = mimeFromContentType(response.headers.get("content-type"), url);
    const check = validateMediaUpload({ type: mimeType, size: buffer.byteLength }, "site");
    if (!check.ok) return null;
    return { bytes: buffer, mimeType };
  } catch {
    return null;
  }
}

export async function attestStoredEvidenceImage(options: {
  websiteId: string;
  source: EnrichmentImageRef;
  bytes: Uint8Array;
  mimeType: string;
  storagePath?: string;
}): Promise<EnrichmentImageRef | null> {
  const metadata = await validateDecodedImageBytes(options.bytes);
  const mimeType = detectImageMimeType(options.bytes);
  if (!metadata || !mimeType) return null;
  const contentHash = createHash("sha256").update(options.bytes).digest("hex");
  if (options.storagePath && !isOwnedEvidenceMediaPath(options.websiteId, options.storagePath))
    return null;
  const storagePath =
    options.storagePath ??
    `${options.websiteId}/enrichment/${contentHash}.${extensionForMime(mimeType)}`;
  return {
    ...options.source,
    storagePath,
    mimeType,
    ...metadata,
    contentHash,
    provenance: {
      kind: "evidence",
      sourceUrl: options.source.url,
      ...(typeof options.source.platform === "string"
        ? { platform: options.source.platform }
        : typeof options.source.provenance?.platform === "string"
          ? { platform: options.source.provenance.platform }
          : {}),
      storageBucket: "site-media",
    },
    proofEligible:
      isProofEligibleStillMimeType(mimeType) &&
      metadata.width >= MIN_USABLE_EVIDENCE_EDGE &&
      metadata.height >= MIN_USABLE_EVIDENCE_EDGE,
  };
}

function hasCompleteEvidenceAttestation(item: EnrichmentImageRef, websiteId: string): boolean {
  const storagePath = item.storagePath?.trim();
  const contentHash = item.contentHash?.trim();
  return Boolean(
    storagePath &&
    contentHash &&
    siteMediaPathKind(websiteId, storagePath) === "enrichment" &&
    storagePath.split("/").pop()?.startsWith(`${contentHash}.`) &&
    item.mimeType?.startsWith("image/") &&
    Number.isSafeInteger(item.width) &&
    Number.isSafeInteger(item.height) &&
    item.provenance?.kind === "evidence" &&
    item.provenance.sourceUrl?.trim() &&
    item.provenance.storageBucket === "site-media" &&
    typeof item.proofEligible === "boolean",
  );
}

function gatedImagesMissingAttestation(
  websiteId: string,
  enrichment: Record<string, unknown>,
  onboarding: Record<string, unknown>,
) {
  const sheet = buildFactSheet(onboarding, enrichment, { imageCap: Number.MAX_SAFE_INTEGER });
  return sheet.images.filter((item) => {
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url || isDroppableImageUrl(url)) return false;
    const source = parseEnrichmentImages([{ ...item, url }])[0];
    return !source || !hasCompleteEvidenceAttestation(source, websiteId);
  });
}

export function countGatedImagesMissingAttestation(
  websiteId: string,
  enrichment: Record<string, unknown>,
  onboarding: Record<string, unknown>,
): number {
  return gatedImagesMissingAttestation(websiteId, enrichment, onboarding).length;
}

async function defaultUpload(
  supabase: SupabaseAdmin,
  path: string,
  body: Uint8Array,
  mimeType: string,
): Promise<{ ok: boolean; created: boolean }> {
  const { error } = await supabase.storage.from("site-media").upload(path, body, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) {
    const duplicate =
      error.message?.toLowerCase().includes("already exists") ||
      error.message?.toLowerCase().includes("duplicate") ||
      error.message?.toLowerCase().includes("resource already exists");
    if (duplicate) {
      const existing = await defaultDownloadStorage(supabase, path);
      if (!existing) return { ok: false, created: false };
      const expectedHash = createHash("sha256").update(body).digest("hex");
      const existingHash = createHash("sha256").update(existing.bytes).digest("hex");
      return {
        ok: expectedHash === existingHash && detectImageMimeType(existing.bytes) === mimeType,
        created: false,
      };
    }
    console.error("[persistScrapedSiteMedia] upload", path, error);
    return { ok: false, created: false };
  }
  return { ok: true, created: true };
}

async function defaultDownloadStorage(
  supabase: SupabaseAdmin,
  path: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const { data, error } = await supabase.storage.from("site-media").download(path);
  if (error || !data) return null;
  return {
    bytes: await readBodyLimited(
      new Response(data.stream(), { headers: { "content-length": String(data.size) } }),
      50 * 1024 * 1024,
    ),
    mimeType: data.type || "image/jpeg",
  };
}

async function loadLatestEnrichment(
  supabase: SupabaseAdmin,
  websiteId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("contractor_profiles")
    .select("enrichment_json")
    .eq("website_id", websiteId)
    .maybeSingle();
  if (error) {
    console.error("[persistScrapedSiteMedia] enrichment", error);
    return {};
  }
  return data?.enrichment_json &&
    typeof data.enrichment_json === "object" &&
    !Array.isArray(data.enrichment_json)
    ? (data.enrichment_json as Record<string, unknown>)
    : {};
}

async function loadOnboarding(
  supabase: SupabaseAdmin,
  websiteId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("websites")
    .select("onboarding_state")
    .eq("id", websiteId)
    .maybeSingle();
  if (error) {
    console.error("[persistScrapedSiteMedia] onboarding", error);
    return {};
  }
  return (data?.onboarding_state as Record<string, unknown>) ?? {};
}

/**
 * Persist identity-gated gallery URLs into site-media. Fail-open: never throw
 * to the scrape job. Writes storagePath back onto enrichment_json.images.
 */
async function mergeAttestedImagesIntoLatestProfile(
  supabase: SupabaseAdmin,
  websiteId: string,
  attestedByIdentity: ReadonlyMap<string, EnrichmentImageRef>,
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase
      .from("contractor_profiles")
      .select("enrichment_json,updated_at")
      .eq("website_id", websiteId)
      .maybeSingle();
    if (error || !data) return null;
    const latest =
      data.enrichment_json && typeof data.enrichment_json === "object"
        ? (data.enrichment_json as Record<string, unknown>)
        : {};
    const images = parseEnrichmentImages(latest.images);
    const nextImages = images.map((item) => {
      const attested = attestedByIdentity.get(`${item.url}\0${item.storagePath ?? ""}`);
      return attested ? { ...item, ...attested } : item;
    });
    for (const attested of attestedByIdentity.values()) {
      if (!nextImages.some((item) => item.url === attested.url)) nextImages.push(attested);
    }
    const next = { ...latest, images: nextImages };
    const { data: updated, error: updateError } = await supabase
      .from("contractor_profiles")
      .update({ enrichment_json: next as unknown as Json })
      .eq("website_id", websiteId)
      .eq("updated_at", data.updated_at)
      .select("website_id")
      .maybeSingle();
    if (updateError) return null;
    if (updated) return next;
  }
  return null;
}

/** Returns the input enrichment with attested paths. Live profile write-back is a side effect. */
export async function persistScrapedSiteMedia(
  supabase: SupabaseAdmin,
  websiteId: string,
  enrichment: Record<string, unknown>,
  deps: PersistScrapedMediaDeps = {},
): Promise<Record<string, unknown>> {
  try {
    const onboarding = deps.onboarding ?? (await loadOnboarding(supabase, websiteId));
    const originalImages = parseEnrichmentImages(enrichment.images);
    let working = enrichment;
    if (deps.writeBack !== false && originalImages.length > 0) {
      const live = await loadLatestEnrichment(supabase, websiteId);
      working = {
        ...enrichment,
        images: overlayStoragePathByUrl(originalImages, parseEnrichmentImages(live.images)),
      };
    }
    const needing = gatedImagesMissingAttestation(websiteId, working, onboarding);
    const platformByUrl = new Map(
      parseEnrichmentImages(working.images).map((item) => [item.url, item.platform]),
    );
    if (needing.length === 0) return working;

    const fetchImpl = deps.fetch ?? fetch;
    const persistedByIdentity = new Map<string, EnrichmentImageRef>();

    for (const item of needing) {
      if (deps.signal?.aborted) break;
      const url = item.url?.trim() ?? "";
      if (!url) continue;
      try {
        const existingStoragePath = item.storagePath?.trim();
        const stored = existingStoragePath
          ? deps.downloadStorage
            ? await deps.downloadStorage(existingStoragePath)
            : await defaultDownloadStorage(supabase, existingStoragePath)
          : null;
        const referer = listingUrlForImage(onboarding, working, url) ?? undefined;
        const downloaded =
          stored ?? (await downloadMediaForPersist(url, fetchImpl, referer, deps.signal));
        if (deps.signal?.aborted) break;
        if (!downloaded) continue;
        const source: EnrichmentImageRef = {
          url,
          platform: item.platform ?? platformByUrl.get(url),
          alt: item.alt,
          storagePath: item.storagePath,
          mimeType: item.mimeType,
          width: item.width,
          height: item.height,
          aspect: item.aspect,
          orientation: item.orientation,
          contentHash: item.contentHash,
          provenance:
            item.provenance?.kind === "evidence"
              ? {
                  kind: "evidence",
                  sourceUrl: item.provenance.sourceUrl,
                  platform: item.provenance.platform,
                  storageBucket:
                    item.provenance.storageBucket === "site-media" ? "site-media" : undefined,
                }
              : undefined,
          proofEligible: item.proofEligible,
        };
        const attested = await attestStoredEvidenceImage({
          websiteId,
          source,
          bytes: downloaded.bytes,
          mimeType: downloaded.mimeType,
          ...(existingStoragePath ? { storagePath: existingStoragePath } : {}),
        });
        if (!attested?.storagePath) continue;
        if (!existingStoragePath) {
          const uploaded = deps.upload
            ? await deps.upload(attested.storagePath, downloaded.bytes, attested.mimeType!)
            : await defaultUpload(
                supabase,
                attested.storagePath,
                downloaded.bytes,
                attested.mimeType!,
              );
          if (!uploaded.ok) continue;
        }
        persistedByIdentity.set(`${url}\0${existingStoragePath ?? ""}`, attested);
      } catch (error) {
        console.error("[persistScrapedSiteMedia] image", url, error);
      }
    }

    if (persistedByIdentity.size === 0) return working;

    const images = parseEnrichmentImages(working.images);
    const nextImages = images.map((item) => {
      const persisted = persistedByIdentity.get(`${item.url}\0${item.storagePath ?? ""}`);
      return persisted ? { ...item, ...persisted } : item;
    });
    for (const persisted of persistedByIdentity.values()) {
      if (!nextImages.some((item) => item.url === persisted.url)) {
        nextImages.push(persisted);
      }
    }

    const next: Record<string, unknown> = { ...working, images: nextImages };

    if (deps.writeBack !== false) {
      const merged = await mergeAttestedImagesIntoLatestProfile(
        supabase,
        websiteId,
        persistedByIdentity,
      );
      if (!merged) console.error("[persistScrapedSiteMedia] writeBack conflict or failure");
    }
    return next;
  } catch (error) {
    console.error("[persistScrapedSiteMedia]", error);
    return enrichment;
  }
}
