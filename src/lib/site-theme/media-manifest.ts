/** Must match the unified config schema emitted by new generation. */
export const CURRENT_GENERATOR_SCHEMA_VERSION = 4 as const;
export const LEGACY_GENERATOR_SCHEMA_VERSION = 2 as const;

export type MediaManifestOrigin = "evidence" | "generated";
export type MediaManifestRole =
  "hero" | "proof" | "support" | "atmosphere" | "texture" | "motion-poster";
export type MediaManifestMotionPreset =
  "slow-push" | "subtle-parallax" | "gentle-pan" | "ambient-depth";

export type MediaManifestSlot = {
  slotId: string;
  assetId: string;
  origin: MediaManifestOrigin;
  role: MediaManifestRole;
  proofEligible: boolean;
  mimeType: string;
  alt: string;
  storagePath?: string;
  url?: string;
  width?: number;
  height?: number;
  required?: boolean;
  sourceSlotId?: string;
  posterSlotId?: string;
  targetSection?: string;
  placement?: "inline";
  motionPreset?: MediaManifestMotionPreset;
};

export type ResolvedMediaManifest = { slots: MediaManifestSlot[] };
type ParsedManifest = { ok: true; manifest: ResolvedMediaManifest } | { ok: false; error: string };
export type MediaManifestConfigResult =
  | { kind: "legacy" }
  | { kind: "current"; version: 2 | 3 | 4; manifest: ResolvedMediaManifest }
  | { kind: "invalid"; error: string }
  | { kind: "future"; version: number };

const ROLES = new Set<MediaManifestRole>([
  "hero",
  "proof",
  "support",
  "atmosphere",
  "texture",
  "motion-poster",
]);
const MOTION_PRESETS = new Set<MediaManifestMotionPreset>([
  "slow-push",
  "subtle-parallax",
  "gentle-pan",
  "ambient-depth",
]);

export function isVideoMimeType(mimeType: string | undefined): boolean {
  return (mimeType ?? "").toLowerCase().startsWith("video/");
}

function isNonAnimatedStillMimeType(mimeType: string | undefined): boolean {
  const normalized = (mimeType ?? "").toLowerCase();
  return normalized === "image/png" || normalized === "image/jpeg";
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseSlots(value: unknown): ParsedManifest {
  if (!value || typeof value !== "object" || !Array.isArray((value as { slots?: unknown }).slots)) {
    return { ok: false, error: "mediaManifest.slots must be an array" };
  }
  const slots: MediaManifestSlot[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of (value as { slots: unknown[] }).slots.entries()) {
    if (!raw || typeof raw !== "object")
      return { ok: false, error: `mediaManifest.slots[${index}] must be an object` };
    const slot = raw as Record<string, unknown>;
    if (
      !nonEmpty(slot.slotId) ||
      !nonEmpty(slot.assetId) ||
      !nonEmpty(slot.mimeType) ||
      typeof slot.alt !== "string"
    )
      return {
        ok: false,
        error: `mediaManifest.slots[${index}] is missing identity or media metadata`,
      };
    if (ids.has(slot.slotId)) return { ok: false, error: `duplicate media slot ${slot.slotId}` };
    ids.add(slot.slotId);
    if (slot.origin !== "evidence" && slot.origin !== "generated")
      return { ok: false, error: `media slot ${slot.slotId} has invalid origin` };
    if (typeof slot.role !== "string" || !ROLES.has(slot.role as MediaManifestRole))
      return { ok: false, error: `media slot ${slot.slotId} has invalid role` };
    if (typeof slot.proofEligible !== "boolean")
      return { ok: false, error: `media slot ${slot.slotId} must declare proofEligible` };
    if (slot.role === "proof" && (slot.origin !== "evidence" || slot.proofEligible !== true))
      return { ok: false, error: `proof slot ${slot.slotId} must use proof-eligible evidence` };
    const storagePath = nonEmpty(slot.storagePath) ? slot.storagePath.trim() : undefined;
    const url = nonEmpty(slot.url) ? slot.url.trim() : undefined;
    if (!storagePath && !url)
      return { ok: false, error: `media slot ${slot.slotId} has no storage path or URL` };
    slots.push({
      slotId: slot.slotId.trim(),
      assetId: slot.assetId.trim(),
      origin: slot.origin,
      role: slot.role as MediaManifestRole,
      proofEligible: slot.proofEligible,
      mimeType: slot.mimeType.trim().toLowerCase(),
      alt: slot.alt.trim(),
      ...(storagePath ? { storagePath } : {}),
      ...(url ? { url } : {}),
      ...(typeof slot.width === "number" && slot.width > 0 ? { width: slot.width } : {}),
      ...(typeof slot.height === "number" && slot.height > 0 ? { height: slot.height } : {}),
      ...(slot.required === true ? { required: true } : {}),
      ...(nonEmpty(slot.sourceSlotId) ? { sourceSlotId: slot.sourceSlotId.trim() } : {}),
      ...(nonEmpty(slot.posterSlotId) ? { posterSlotId: slot.posterSlotId.trim() } : {}),
      ...(nonEmpty(slot.targetSection) ? { targetSection: slot.targetSection.trim() } : {}),
      ...(slot.placement === "inline" ? { placement: "inline" as const } : {}),
      ...(typeof slot.motionPreset === "string" &&
      MOTION_PRESETS.has(slot.motionPreset as MediaManifestMotionPreset)
        ? { motionPreset: slot.motionPreset as MediaManifestMotionPreset }
        : {}),
    });
  }
  const byId = new Map(slots.map((slot) => [slot.slotId, slot]));
  for (const slot of slots) {
    if (!isVideoMimeType(slot.mimeType)) continue;
    if (!slot.sourceSlotId || !slot.posterSlotId)
      return {
        ok: false,
        error: `video slot ${slot.slotId} must declare sourceSlotId and posterSlotId`,
      };
    const source = byId.get(slot.sourceSlotId);
    const poster = byId.get(slot.posterSlotId);
    if (!source || !poster || isVideoMimeType(source.mimeType) || isVideoMimeType(poster.mimeType))
      return {
        ok: false,
        error: `video slot ${slot.slotId} must reference existing still source and poster slots`,
      };
    if (
      !isNonAnimatedStillMimeType(source.mimeType) ||
      !isNonAnimatedStillMimeType(poster.mimeType)
    )
      return {
        ok: false,
        error: `video slot ${slot.slotId} source and poster must be nonanimated images`,
      };
    if (source.assetId !== poster.assetId)
      return {
        ok: false,
        error: `video slot ${slot.slotId} must use the same still asset as source and poster`,
      };
  }
  if (
    slots.some(
      (slot) => !isVideoMimeType(slot.mimeType) && !isNonAnimatedStillMimeType(slot.mimeType),
    )
  )
    return { ok: false, error: "mediaManifest stills must be nonanimated images" };
  return { ok: true, manifest: { slots } };
}

/** Frozen v2/v3 still-count and generated-media policy. */
function parseLegacySlots(value: unknown): ParsedManifest {
  const parsed = parseSlots(value);
  if (!parsed.ok) return parsed;
  const stills = parsed.manifest.slots.filter((slot) => isNonAnimatedStillMimeType(slot.mimeType));
  const uniqueStillAssets = new Set(stills.map((slot) => slot.assetId));
  if (
    uniqueStillAssets.size < 2 ||
    uniqueStillAssets.size > 5 ||
    uniqueStillAssets.size !== stills.length
  )
    return { ok: false, error: "mediaManifest must contain 2-5 unique still assets" };
  if (!stills.some((slot) => slot.origin === "generated"))
    return { ok: false, error: "mediaManifest must contain a generated still" };
  return parsed;
}

export function parseV2Manifest(value: unknown): ParsedManifest {
  const parsed = parseLegacySlots(value);
  if (!parsed.ok) return parsed;
  const videos = parsed.manifest.slots.filter((slot) => isVideoMimeType(slot.mimeType));
  if (videos.length !== 1)
    return { ok: false, error: "mediaManifest v2 must contain exactly one video slot" };
  const motion = videos[0]!;
  if (motion.mimeType !== "video/mp4" || motion.origin !== "generated" || motion.required !== true)
    return { ok: false, error: "mediaManifest v2 motion must be one required generated MP4" };
  return parsed;
}

function validateMotionManifest(parsed: ParsedManifest, version: 3 | 4): ParsedManifest {
  if (!parsed.ok) return parsed;
  const videos = parsed.manifest.slots.filter((slot) => isVideoMimeType(slot.mimeType));
  if (videos.length > 1)
    return {
      ok: false,
      error: `mediaManifest v${version} may contain at most one video slot`,
    };
  const motion = videos[0];
  if (!motion) return parsed;
  if (
    motion.mimeType !== "video/mp4" ||
    motion.origin !== "generated" ||
    motion.proofEligible ||
    motion.required !== true ||
    !motion.targetSection ||
    motion.placement !== "inline" ||
    !motion.motionPreset
  )
    return {
      ok: false,
      error: `mediaManifest v${version} motion metadata is invalid`,
    };
  const source = parsed.manifest.slots.find((slot) => slot.slotId === motion.sourceSlotId);
  if (!source || source.origin !== "generated" || source.proofEligible)
    return {
      ok: false,
      error: `mediaManifest v${version} motion source must be a generated non-proof still`,
    };
  return parsed;
}

export function parseV3Manifest(value: unknown): ParsedManifest {
  return validateMotionManifest(parseLegacySlots(value), 3);
}

/**
 * Schema v4 removes aesthetic media cardinality and origin requirements while
 * retaining the slot identity, proof, MIME, storage, and motion integrity contract.
 */
export function parseV4Manifest(value: unknown): ParsedManifest {
  const parsed = parseSlots(value);
  if (!parsed.ok) return parsed;
  if (
    new Set(parsed.manifest.slots.map((slot) => slot.slotId)).size !== parsed.manifest.slots.length
  )
    return { ok: false, error: "mediaManifest slot identities must be unique" };
  const stills = parsed.manifest.slots.filter((slot) => isNonAnimatedStillMimeType(slot.mimeType));
  if (new Set(stills.map((slot) => slot.assetId)).size !== stills.length)
    return { ok: false, error: "mediaManifest still asset identities must be unique" };
  return validateMotionManifest(parsed, 4);
}

export function parseMediaManifest(version: number, value: unknown): ParsedManifest {
  if (version === 2) return parseV2Manifest(value);
  if (version === 3) return parseV3Manifest(value);
  if (version === 4) return parseV4Manifest(value);
  return { ok: false, error: `unsupported generatorSchemaVersion ${version}` };
}

/** Compatibility name for the frozen v2 contract. New consumers must dispatch by version. */
export const parseResolvedMediaManifest = parseV2Manifest;

export function mediaManifestFromConfig(
  config: Record<string, unknown>,
): MediaManifestConfigResult {
  const rawVersion = config.generatorSchemaVersion;
  if (rawVersion == null) return { kind: "legacy" };
  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion) || rawVersion < 1)
    return { kind: "invalid", error: "generatorSchemaVersion must be a positive integer" };
  if (rawVersion > CURRENT_GENERATOR_SCHEMA_VERSION) return { kind: "future", version: rawVersion };
  if (rawVersion !== 2 && rawVersion !== 3 && rawVersion !== 4) return { kind: "legacy" };
  const parsed = parseMediaManifest(rawVersion, config.mediaManifest);
  return parsed.ok
    ? { kind: "current", version: rawVersion, manifest: parsed.manifest }
    : { kind: "invalid", error: parsed.error };
}
