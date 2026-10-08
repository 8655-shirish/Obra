/**
 * Historical contractor-media repair.
 *
 * Inspects enrichment + every website version's media identity, classifies what is
 * broken, and (when dryRun === false) re-hosts historical URL-only media into the
 * owning website's `site-media` namespace using deterministic content-addressed paths.
 *
 * Invariants:
 * - Live versions are never mutated in place; a repaired immutable replacement is
 *   forked, repaired, validated and only then atomically republished.
 * - config `mediaManifest.slots` and `website_version_media_slots` stay byte-identical.
 * - Historical storage objects are never deleted.
 * - Every phase is idempotent: content-addressed paths make retries converge.
 */

import { createHash } from "node:crypto";

import { extensionForMime } from "../media-validation.ts";
import { detectImageMimeType, validateDecodedImageBytes } from "./image-metadata.ts";
import { parseEnrichmentImages, siteMediaPathKind } from "./persist-scraped-media.server.ts";
import type { EnrichmentImageRef } from "./persist-scraped-media.server.ts";
import { isRemoteMediaUrlSsrfSafe, safeFetchRemoteMedia } from "./safe-remote-media.server.ts";
export { isRemoteMediaUrlSsrfSafe };

export const APPROVED_HISTORICAL_MEDIA_HOSTS = [
  "yelpcdn.com",
  "hzcdn.com",
  "cloudinary.com",
  "squarespace-cdn.com",
  "buildzoom.com",
] as const;

export const MAX_REPAIR_MEDIA_BYTES = 25 * 1024 * 1024;

export type RepairVersionRow = {
  id: string;
  status: string;
  revision: number;
  version_number: number;
  variant_key: string;
  config_json: Record<string, unknown>;
};

export type RepairSlotRow = {
  version_id: string;
  slot_id: string;
  asset_id: string;
  storage_path: string;
  mime_type: string;
  provenance: string;
  role: string;
  required: boolean;
  proof_eligible: boolean;
  source_slot_id: string | null;
  poster_slot_id: string | null;
};

export type RepairIssue =
  | "url_only"
  | "missing_storage_object"
  | "unowned_storage_path"
  | "expired_signed_url"
  | "manifest_attachment_mismatch"
  | "duplicate_source_url"
  | "unrecoverable_source";

export type RepairItem = {
  scope: "enrichment" | "version";
  locus: "gallery" | "manifest" | "logo" | "ledger";
  versionId?: string;
  versionStatus?: string;
  key: string;
  sourceUrl?: string;
  storagePath?: string;
  issues: RepairIssue[];
  action: "none" | "rehost" | "relink" | "manual";
  repaired?: boolean;
  newStoragePath?: string;
  contentHash?: string;
  error?: string;
};

export type RepairVersionReport = {
  versionId: string;
  status: string;
  revision: number;
  versionNumber: number;
  variantKey: string;
  isLive: boolean;
  itemsInspected: number;
  repairable: number;
  manifestSlotCount: number;
  ledgerSlotCount: number;
  parity: boolean;
  action: "none" | "update_in_place" | "fork_and_repoint";
  repairedVersionId?: string;
  outcome?: "skipped" | "repaired" | "failed";
};

export type RepairResponse = {
  websiteId: string;
  licenseNumber?: string | null;
  dryRun: boolean;
  summary: {
    versionsInspected: number;
    itemsInspected: number;
    repairable: number;
    repaired: number;
    unrecoverable: number;
  };
  versions: RepairVersionReport[];
  items: RepairItem[];
  errors: string[];
};

export type FetchedMedia = { bytes: Uint8Array; mimeType: string };

export type ContractorMediaRepairDeps = {
  loadWebsite(websiteId: string): Promise<{ id: string; activeVersionId: string | null } | null>;
  loadEnrichment(websiteId: string): Promise<Record<string, unknown> | null>;
  loadVersions(websiteId: string): Promise<RepairVersionRow[]>;
  loadSlots(websiteId: string): Promise<RepairSlotRow[]>;
  storageExists(storagePath: string): Promise<boolean>;
  fetchRemote?(url: string): Promise<FetchedMedia | null>;
  upload(storagePath: string, bytes: Uint8Array, mimeType: string): Promise<boolean>;
  saveEnrichment(websiteId: string, enrichment: Record<string, unknown>): Promise<boolean>;
  updateVersionMedia(input: {
    websiteId: string;
    versionId: string;
    expectedRevision: number;
    configJson: Record<string, unknown>;
    mediaSlots: unknown[];
  }): Promise<boolean | { ok: boolean; error?: string }>;
  forkVersion(input: {
    websiteId: string;
    versionId: string;
    expectedRevision: number;
  }): Promise<RepairVersionRow | null>;
  publishVersion(input: {
    websiteId: string;
    versionId: string;
    expectedRevision: number;
    configJson: Record<string, unknown>;
    mediaSlots: unknown[];
  }): Promise<boolean>;
  recordAudit(event: Record<string, unknown>): Promise<void>;
  now?(): Date;
};

const HISTORICAL_STATUSES = ["live", "selected", "draft", "discarded", "archived"] as const;

type VersionWriteResult = boolean | { ok: boolean; error?: string };

function writeOk(result: VersionWriteResult): boolean {
  return typeof result === "boolean" ? result : result.ok;
}

function writeError(result: VersionWriteResult): string {
  return typeof result === "boolean" ? "unknown database error" : (result.error ?? "unknown database error");
}

export function isApprovedHistoricalMediaUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return APPROVED_HISTORICAL_MEDIA_HOSTS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

/** Supabase signed URLs carry a JWT whose `exp` we can read without verifying. */
export function isExpiredSignedUrl(rawUrl: string, nowMs: number): boolean {
  if (!rawUrl.includes("/storage/v1/object/sign/")) return false;
  const token = (() => {
    try {
      return new URL(rawUrl).searchParams.get("token");
    } catch {
      return null;
    }
  })();
  const payload = token?.split(".")[1];
  if (!payload) return true;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof json.exp === "number" ? json.exp * 1000 <= nowMs : true;
  } catch {
    return true;
  }
}

async function defaultFetchRemote(url: string): Promise<FetchedMedia | null> {
  if (!isRemoteMediaUrlSsrfSafe(url)) return null;
  try {
    const { bytes } = await safeFetchRemoteMedia(url, {
      maxBytes: MAX_REPAIR_MEDIA_BYTES,
      headers: {
        Accept: "image/png,image/jpeg,image/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; ObraMediaRepair/1.0)",
      },
    });
    const mimeType = detectImageMimeType(bytes);
    if (mimeType !== "image/png" && mimeType !== "image/jpeg") return null;
    return { bytes, mimeType };
  } catch {
    return null;
  }
}

function contentAddressedPath(websiteId: string, hash: string, mimeType: string): string {
  return `${websiteId}/enrichment/${hash}.${extensionForMime(mimeType)}`;
}

function manifestSlots(config: Record<string, unknown>): Record<string, unknown>[] {
  const manifest = config.mediaManifest;
  if (!manifest || typeof manifest !== "object") return [];
  const slots = (manifest as { slots?: unknown }).slots;
  return Array.isArray(slots) ? (slots.filter(Boolean) as Record<string, unknown>[]) : [];
}

function galleryItems(config: Record<string, unknown>): Record<string, unknown>[] {
  const gallery = config.mediaGallery;
  return Array.isArray(gallery) ? (gallery.filter(Boolean) as Record<string, unknown>[]) : [];
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type Identity = {
  storagePath: string;
  mimeType: string;
  width: number;
  height: number;
  aspect: number;
  orientation: "landscape" | "portrait" | "square";
  contentHash: string;
};

function classify(input: {
  websiteId: string;
  sourceUrl?: string;
  storagePath?: string;
  storageMissing: boolean;
  nowMs: number;
  duplicate: boolean;
}): { issues: RepairIssue[]; action: RepairItem["action"] } {
  const issues: RepairIssue[] = [];
  const { storagePath, sourceUrl } = input;
  if (!storagePath) issues.push("url_only");
  else if (!siteMediaPathKind(input.websiteId, storagePath)) issues.push("unowned_storage_path");
  else if (input.storageMissing) issues.push("missing_storage_object");
  if (sourceUrl && isExpiredSignedUrl(sourceUrl, input.nowMs)) issues.push("expired_signed_url");
  if (input.duplicate) issues.push("duplicate_source_url");

  if (issues.length === 0) return { issues, action: "none" };
  const needsBytes = issues.some(
    (issue) =>
      issue === "url_only" || issue === "unowned_storage_path" || issue === "missing_storage_object",
  );
  if (!needsBytes) return { issues, action: "relink" };
  if (sourceUrl && isRemoteMediaUrlSsrfSafe(sourceUrl)) return { issues, action: "rehost" };
  issues.push("unrecoverable_source");
  return { issues, action: "manual" };
}

export async function inspectContractorMedia(
  deps: ContractorMediaRepairDeps,
  websiteId: string,
): Promise<{
  items: RepairItem[];
  versions: RepairVersionReport[];
  enrichmentImages: EnrichmentImageRef[];
  enrichment: Record<string, unknown>;
  versionRows: RepairVersionRow[];
  activeVersionId: string | null;
  errors: string[];
}> {
  const errors: string[] = [];
  const nowMs = (deps.now?.() ?? new Date()).getTime();
  const website = await deps.loadWebsite(websiteId);
  if (!website) throw new Error("Website not found");

  const enrichment = (await deps.loadEnrichment(websiteId)) ?? {};
  const enrichmentImages = parseEnrichmentImages(enrichment.images);
  const versionRows = (await deps.loadVersions(websiteId)).filter((row) =>
    (HISTORICAL_STATUSES as readonly string[]).includes(row.status),
  );
  const slots = await deps.loadSlots(websiteId);

  const existsCache = new Map<string, boolean>();
  const exists = async (path: string): Promise<boolean> => {
    const cached = existsCache.get(path);
    if (cached !== undefined) return cached;
    let value = false;
    try {
      value = await deps.storageExists(path);
    } catch (error) {
      errors.push(`storage probe failed for ${path}: ${(error as Error).message}`);
    }
    existsCache.set(path, value);
    return value;
  };

  const items: RepairItem[] = [];
  const seenUrls = new Set<string>();

  for (const [index, image] of enrichmentImages.entries()) {
    const duplicate = seenUrls.has(image.url);
    seenUrls.add(image.url);
    const storagePath = str(image.storagePath);
    const { issues, action } = classify({
      websiteId,
      sourceUrl: image.url,
      storagePath,
      storageMissing: storagePath ? !(await exists(storagePath)) : false,
      nowMs,
      duplicate,
    });
    items.push({
      scope: "enrichment",
      locus: "gallery",
      key: `images[${index}]`,
      sourceUrl: image.url,
      ...(storagePath ? { storagePath } : {}),
      issues,
      action,
    });
  }

  const versions: RepairVersionReport[] = [];
  for (const version of versionRows) {
    const config = version.config_json ?? {};
    const ledger = slots.filter((slot) => slot.version_id === version.id);
    const ledgerByslot = new Map(ledger.map((slot) => [slot.slot_id, slot]));
    const manifest = manifestSlots(config);
    let repairable = 0;
    const before = items.length;

    for (const [index, entry] of galleryItems(config).entries()) {
      const sourceUrl = str(entry.url) ?? str(entry.sourceUrl);
      const storagePath = str(entry.storagePath);
      const { issues, action } = classify({
        websiteId,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(storagePath ? { storagePath } : {}),
        storageMissing: storagePath ? !(await exists(storagePath)) : false,
        nowMs,
        duplicate: false,
      });
      if (issues.length === 0) continue;
      items.push({
        scope: "version",
        locus: "gallery",
        versionId: version.id,
        versionStatus: version.status,
        key: `mediaGallery[${index}]`,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(storagePath ? { storagePath } : {}),
        issues,
        action,
      });
    }

    for (const slot of manifest) {
      const slotId = str(slot.slotId) ?? "";
      const storagePath = str(slot.storagePath);
      const sourceUrl = str(slot.url);
      const { issues, action } = classify({
        websiteId,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(storagePath ? { storagePath } : {}),
        storageMissing: storagePath ? !(await exists(storagePath)) : false,
        nowMs,
        duplicate: false,
      });
      const attachment = ledgerByslot.get(slotId);
      if (!attachment || attachment.storage_path !== (storagePath ?? "")) {
        issues.push("manifest_attachment_mismatch");
      }
      if (issues.length === 0) continue;
      items.push({
        scope: "version",
        locus: "manifest",
        versionId: version.id,
        versionStatus: version.status,
        key: slotId || "(missing slotId)",
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(storagePath ? { storagePath } : {}),
        issues,
        action: action === "none" ? "relink" : action,
      });
    }

    const logoPath = str(config.logoStoragePath);
    const logoUrl = str(config.logoUrl);
    if (logoPath || logoUrl) {
      const { issues, action } = classify({
        websiteId,
        ...(logoUrl ? { sourceUrl: logoUrl } : {}),
        ...(logoPath ? { storagePath: logoPath } : {}),
        storageMissing: logoPath ? !(await exists(logoPath)) : false,
        nowMs,
        duplicate: false,
      });
      if (issues.length > 0) {
        items.push({
          scope: "version",
          locus: "logo",
          versionId: version.id,
          versionStatus: version.status,
          key: "logo",
          ...(logoUrl ? { sourceUrl: logoUrl } : {}),
          ...(logoPath ? { storagePath: logoPath } : {}),
          issues,
          action,
        });
      }
    }

    for (const slot of ledger) {
      if (manifest.some((entry) => str(entry.slotId) === slot.slot_id)) continue;
      items.push({
        scope: "version",
        locus: "ledger",
        versionId: version.id,
        versionStatus: version.status,
        key: slot.slot_id,
        storagePath: slot.storage_path,
        issues: ["manifest_attachment_mismatch"],
        action: "relink",
      });
    }

    const versionItems = items.slice(before);
    repairable = versionItems.filter(
      (item) => item.action === "rehost" || item.action === "relink",
    ).length;
    const isLive = website.activeVersionId === version.id || version.status === "live";
    versions.push({
      versionId: version.id,
      status: version.status,
      revision: version.revision,
      versionNumber: version.version_number,
      variantKey: version.variant_key,
      isLive,
      itemsInspected: versionItems.length,
      repairable,
      manifestSlotCount: manifest.length,
      ledgerSlotCount: ledger.length,
      parity: !versionItems.some((item) => item.issues.includes("manifest_attachment_mismatch")),
      action: repairable === 0 ? "none" : isLive ? "fork_and_repoint" : "update_in_place",
    });
  }

  return {
    items,
    versions,
    enrichmentImages,
    enrichment,
    versionRows,
    activeVersionId: website.activeVersionId,
    errors,
  };
}

async function materializeIdentity(
  deps: ContractorMediaRepairDeps,
  websiteId: string,
  sourceUrl: string,
): Promise<Identity> {
  const fetched = await (deps.fetchRemote ?? defaultFetchRemote)(sourceUrl);
  if (!fetched) throw new Error("source unavailable or not an approved host");
  const metadata = await validateDecodedImageBytes(fetched.bytes);
  const mimeType = detectImageMimeType(fetched.bytes);
  if (!metadata || (mimeType !== "image/png" && mimeType !== "image/jpeg"))
    throw new Error("bytes failed decoder validation");
  const contentHash = createHash("sha256").update(fetched.bytes).digest("hex");
  const storagePath = contentAddressedPath(websiteId, contentHash, mimeType);
  if (!(await deps.storageExists(storagePath))) {
    const uploaded = await deps.upload(storagePath, fetched.bytes, mimeType);
    if (!uploaded) throw new Error("upload failed");
  }
  return { ...metadata, mimeType, contentHash, storagePath };
}

function applyIdentityToConfig(
  config: Record<string, unknown>,
  identities: ReadonlyMap<string, Identity>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...config };

  const gallery = galleryItems(config);
  if (gallery.length > 0) {
    next.mediaGallery = gallery.map((entry) => {
      const url = str(entry.url) ?? str(entry.sourceUrl);
      const identity = url ? identities.get(url) : undefined;
      // Human-authored fields (alt, platform, attribution) are preserved by spreading first.
      return identity
        ? {
            ...entry,
            storagePath: identity.storagePath,
            mimeType: identity.mimeType,
            width: identity.width,
            height: identity.height,
            aspect: identity.aspect,
            orientation: identity.orientation,
            contentHash: identity.contentHash,
          }
        : entry;
    });
  }

  const slots = manifestSlots(config);
  if (slots.length > 0) {
    const repaired = slots.map((slot) => {
      const url = str(slot.url);
      const identity = url ? identities.get(url) : undefined;
      if (!identity) return slot;
      const { url: _dropped, ...rest } = slot;
      return {
        ...rest,
        storagePath: identity.storagePath,
        mimeType: identity.mimeType,
        width: identity.width,
        height: identity.height,
      };
    });
    next.mediaManifest = { ...(config.mediaManifest as object), slots: repaired };
  }

  const logoUrl = str(config.logoUrl);
  const logoIdentity = logoUrl ? identities.get(logoUrl) : undefined;
  if (logoIdentity) next.logoStoragePath = logoIdentity.storagePath;

  return next;
}

function slotSnapshot(config: Record<string, unknown>): unknown[] {
  return manifestSlots(config);
}

export async function repairContractorMedia(
  deps: ContractorMediaRepairDeps,
  input: { websiteId: string; dryRun?: boolean; licenseNumber?: string | null },
): Promise<RepairResponse> {
  const websiteId = input.websiteId;
  const licenseNumber = input.licenseNumber ?? null;
  const dryRun = input.dryRun !== false;
  const inspection = await inspectContractorMedia(deps, websiteId);
  const errors = [...inspection.errors];
  const items = inspection.items;
  const versions = inspection.versions;

  const summary = {
    versionsInspected: versions.length,
    itemsInspected: items.length + inspection.enrichmentImages.length * 0,
    repairable: items.filter((item) => item.action === "rehost" || item.action === "relink").length,
    repaired: 0,
    unrecoverable: items.filter((item) => item.action === "manual").length,
  };

  if (dryRun) {
    return { websiteId, licenseNumber, dryRun: true, summary, versions, items, errors };
  }

  // Phase 1 — materialize durable identities for every rehostable source URL.
  const identities = new Map<string, Identity>();
  const failedUrls = new Set<string>();
  for (const item of items) {
    if (item.action !== "rehost" || !item.sourceUrl) continue;
    if (identities.has(item.sourceUrl) || failedUrls.has(item.sourceUrl)) continue;
    try {
      identities.set(item.sourceUrl, await materializeIdentity(deps, websiteId, item.sourceUrl));
    } catch (error) {
      failedUrls.add(item.sourceUrl);
      errors.push(`rehost failed for ${item.sourceUrl}: ${(error as Error).message}`);
    }
  }

  for (const item of items) {
    const identity = item.sourceUrl ? identities.get(item.sourceUrl) : undefined;
    if (item.action === "rehost" && identity) {
      item.repaired = true;
      item.newStoragePath = identity.storagePath;
      item.contentHash = identity.contentHash;
      summary.repaired += 1;
    } else if (item.action === "rehost") {
      item.repaired = false;
      item.error = "source unrecoverable";
      summary.unrecoverable += 1;
    }
  }

  // Phase 2 — enrichment write-back (durable identity, human fields preserved).
  if (identities.size > 0) {
    const nextImages = inspection.enrichmentImages.map((image) => {
      const identity = identities.get(image.url);
      return identity
        ? {
            ...image,
            storagePath: identity.storagePath,
            mimeType: identity.mimeType,
            width: identity.width,
            height: identity.height,
            aspect: identity.aspect,
            orientation: identity.orientation,
            contentHash: identity.contentHash,
            provenance: {
              kind: "evidence" as const,
              sourceUrl: image.provenance?.sourceUrl ?? image.url,
              ...(image.platform ?? image.provenance?.platform
                ? { platform: image.platform ?? image.provenance?.platform }
                : {}),
              storageBucket: "site-media" as const,
            },
          }
        : image;
    });
    const saved = await deps.saveEnrichment(websiteId, {
      ...inspection.enrichment,
      images: nextImages,
    });
    if (!saved) errors.push("enrichment write-back failed");
  }

  // Phase 3 — per-version repair. Live versions fork; nothing is mutated in place.
  for (const report of versions) {
    if (report.action === "none") {
      report.outcome = "skipped";
      continue;
    }
    const version = inspection.versionRows.find((row) => row.id === report.versionId)!;
    const nextConfig = applyIdentityToConfig(version.config_json ?? {}, identities);
    const nextSlots = slotSnapshot(nextConfig);
    const stillBroken = nextSlots.some(
      (slot) => !str((slot as Record<string, unknown>).storagePath),
    );
    if (stillBroken) {
      report.outcome = "failed";
      errors.push(`version ${report.versionId}: incomplete media after repair, not written`);
      continue;
    }

    try {
      if (report.action === "fork_and_repoint") {
        const fork = await deps.forkVersion({
          websiteId,
          versionId: version.id,
          expectedRevision: version.revision,
        });
        if (!fork) throw new Error("fork failed");
        const updated = await deps.updateVersionMedia({
          websiteId,
          versionId: fork.id,
          expectedRevision: fork.revision,
          configJson: nextConfig,
          mediaSlots: nextSlots,
        });
        if (!writeOk(updated)) throw new Error(`fork media write failed: ${writeError(updated)}`);
        const published = await deps.publishVersion({
          websiteId,
          versionId: fork.id,
          expectedRevision: fork.revision + 1,
          configJson: nextConfig,
          mediaSlots: nextSlots,
        });
        if (!published) throw new Error("atomic repoint failed");
        report.repairedVersionId = fork.id;
      } else {
        const updated = await deps.updateVersionMedia({
          websiteId,
          versionId: version.id,
          expectedRevision: version.revision,
          configJson: nextConfig,
          mediaSlots: nextSlots,
        });
        if (!writeOk(updated)) throw new Error(`media write failed: ${writeError(updated)}`);
        report.repairedVersionId = version.id;
      }
      report.outcome = "repaired";
      report.parity = true;
    } catch (error) {
      report.outcome = "failed";
      errors.push(`version ${report.versionId}: ${(error as Error).message}`);
    }
  }

  await deps.recordAudit({
    website_id: websiteId,
    license_number: licenseNumber,
    versions: versions.map((version) => ({
      versionId: version.versionId,
      status: version.status,
      isLive: version.isLive,
      repairedVersionId: version.repairedVersionId ?? null,
      outcome: version.outcome ?? "skipped",
    })),
    identities: [...identities.entries()].map(([sourceUrl, identity]) => ({
      sourceUrl,
      storagePath: identity.storagePath,
      contentHash: identity.contentHash,
      mimeType: identity.mimeType,
    })),
    summary,
    errors,
    recorded_at: (deps.now?.() ?? new Date()).toISOString(),
  });

  return { websiteId, licenseNumber, dryRun: false, summary, versions, items, errors };
}
