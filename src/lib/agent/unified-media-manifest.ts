import type { EvidenceMediaItem } from "../site-evidence.ts";
import { usableEvidenceStills } from "../site-evidence.ts";
import type { MediaManifestSlot, ResolvedMediaManifest } from "../site-theme/media-manifest.ts";
import type { CurrentUnifiedPlan, UnifiedBrief } from "./unified-design-brief.ts";

export {
  EVIDENCE_INVENTORY_NONRETRYABLE_ERROR,
  EvidenceInventoryError,
  isNonretryableEvidenceInventoryError,
} from "./evidence-inventory-error.ts";
import { EvidenceInventoryError } from "./evidence-inventory-error.ts";

function mediaAssetId(item: EvidenceMediaItem): string {
  const id = item.contentHash ?? item.storagePath ?? item.url;
  if (!id) throw new Error("Resolved media is missing a stable asset identity");
  return id;
}

function isStill(item: EvidenceMediaItem): boolean {
  return !(item.mimeType ?? "").toLowerCase().startsWith("video/") && item.mimeType !== "image/gif";
}

function asManifestSlot(
  slot:
    | UnifiedBrief["mediaSlots"][number]
    | CurrentUnifiedPlan["operationalIntent"]["mediaSlots"][number],
  item: EvidenceMediaItem,
): MediaManifestSlot {
  return {
    slotId: slot.slotId,
    assetId: mediaAssetId(item),
    origin: item.origin === "generated" ? "generated" : "evidence",
    role: slot.role,
    proofEligible: item.proofEligible === true,
    mimeType: item.mimeType ?? "image/jpeg",
    alt: item.alt ?? (item.origin === "generated" ? "Brand atmosphere" : "Project photo"),
    ...(item.storagePath ? { storagePath: item.storagePath } : {}),
    ...(item.width ? { width: item.width } : {}),
    ...(item.height ? { height: item.height } : {}),
    ...(slot.required ? { required: true } : {}),
  };
}

export function resolveUnifiedMediaManifest(options: {
  brief?: UnifiedBrief;
  plan?: CurrentUnifiedPlan;
  evidence: EvidenceMediaItem[];
  generated: EvidenceMediaItem[];
  effectiveSourceBySlot?: ReadonlyMap<string, "evidence" | "generated">;
  evidenceAssetIdBySlot?: ReadonlyMap<string, string>;
}): ResolvedMediaManifest {
  const evidenceStills = usableEvidenceStills(options.evidence);
  const generatedStills = options.generated.filter(
    (item) => isStill(item) && item.origin === "generated",
  );
  const generatedBySlot = new Map(generatedStills.map((item) => [item.generationSlotId, item]));
  const slots: MediaManifestSlot[] = [];
  const used = new Set<string>();
  const plannedSlots = options.plan?.operationalIntent.mediaSlots ?? options.brief?.mediaSlots;
  if (!plannedSlots) throw new Error("Unified media manifest requires a versioned plan");
  for (const planned of plannedSlots) {
    const effectiveSource = options.effectiveSourceBySlot?.get(planned.slotId);
    const assignedEvidenceAssetId = options.evidenceAssetIdBySlot?.get(planned.slotId);
    const candidates =
      effectiveSource === "generated" || planned.sourcePreference === "generated"
        ? [generatedBySlot.get(planned.slotId)]
        : assignedEvidenceAssetId
          ? evidenceStills.filter((item) => mediaAssetId(item) === assignedEvidenceAssetId)
          : [];
    const item = candidates.find((candidate): candidate is EvidenceMediaItem => {
      if (!candidate) return false;
      const candidateId = mediaAssetId(candidate);
      return !used.has(candidateId);
    });
    if (!item) {
      if (planned.required)
        throw new EvidenceInventoryError(
          `Required unique media slot ${planned.slotId} could not be resolved`,
        );
      continue;
    }
    const resolved = asManifestSlot(planned, item);
    used.add(resolved.assetId);
    slots.push(resolved);
  }
  const uniqueStillIds = new Set(slots.map((slot) => slot.assetId));
  if (uniqueStillIds.size !== slots.length)
    throw new EvidenceInventoryError("Unified media manifest requires unique asset identities");
  if (!options.plan) {
    if (uniqueStillIds.size < 2 || uniqueStillIds.size > 5)
      throw new EvidenceInventoryError(
        `Historical Unified media manifest requires 2-5 unique still assets; resolved ${uniqueStillIds.size}`,
      );
    if (!slots.some((slot) => slot.origin === "generated"))
      throw new Error("Historical Unified media manifest requires at least one generated still");
  }
  return { slots };
}
