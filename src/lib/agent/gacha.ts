import { createHash } from "node:crypto";

export const GACHA_PACK_VERSION = 1 as const;

export const GACHA_FILTER_TAGS = [
  "premium",
  "minimal",
  "photo-led",
  "bold",
  "warm",
  "editorial",
  "utilitarian",
  "playful",
  "craft",
  "cinematic",
] as const;

export type GachaFilterTag = (typeof GACHA_FILTER_TAGS)[number];

export const GACHA_FAMILIES = [
  "editorial",
  "cinematic",
  "field-manual",
  "craft-journal",
  "portfolio",
  "workshop",
  "ledger-dark",
  "municipal",
  "coastal",
  "atelier",
] as const;

export type GachaFamily = (typeof GACHA_FAMILIES)[number];

export const GACHA_LOOK_AND_FEEL = ["professional", "funky", "modern"] as const;
export type GachaLookAndFeel = (typeof GACHA_LOOK_AND_FEEL)[number];

export const GACHA_ASPECT_RATIOS = ["wide", "landscape", "square", "portrait"] as const;
export type GachaAspectRatio = (typeof GACHA_ASPECT_RATIOS)[number];

export type GachaAtmosphereStill = {
  slotId: string;
  role: "hero" | "atmosphere" | "texture";
  aspectRatio: GachaAspectRatio;
  cropGuidance: string;
  textOverlayAllowed: boolean;
  promptTemplate: string;
};

export type GachaProofSlot = {
  slotId: string;
  aspectRatio: GachaAspectRatio;
  cropGuidance: string;
  minEvidence: 1 | 2 | 3;
  required: boolean;
};

export type GachaMediaRecipe = {
  proofStripRequired: boolean;
  proofSlots?: readonly GachaProofSlot[];
  atmosphereStills: GachaAtmosphereStill[];
};

export type GachaPack = {
  id: string;
  version: typeof GACHA_PACK_VERSION;
  family: GachaFamily;
  lookAndFeelAffinity: GachaLookAndFeel[];
  tags: GachaFilterTag[];
  minEvidenceStills: 0 | 1 | 2;
  typeRoles: string;
  densityAndSpacing: string;
  geometryAndSurface: string;
  colorStrategy: string;
  heroTreatment: string;
  rhythm: string;
  avoid: readonly string[];
  mediaRecipe: GachaMediaRecipe;
  mobile: string;
  writerGuidance: string;
};

export type GachaLock = {
  gachaId?: string;
  gachaVersion?: typeof GACHA_PACK_VERSION;
  evidenceAssetIdBySlot: Record<string, string>;
  scrapeEnqueued?: boolean;
};

export type GachaDrawInput = {
  seed: string;
  evidenceStillCount: number;
  lookAndFeel?: string;
  tags?: readonly string[];
  recentGachaIds?: readonly string[];
  requestedId?: string;
};

const FILTER_TAG_SET = new Set<string>(GACHA_FILTER_TAGS);

/** Generate may scrape only on a first build whose research pass has not finished. */
export function gachaMayEnqueuePhotoScrape(input: {
  generationKind: "initial" | "regeneration";
  researchStatus: string | null | undefined;
}): boolean {
  if (input.generationKind === "regeneration") return false;
  return input.researchStatus !== "complete";
}

export function parseGachaFilter(value: unknown): GachaFilterTag[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("gachaFilter must be an array of closed tags");
  const tags: GachaFilterTag[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !FILTER_TAG_SET.has(entry)) continue;
    if (!tags.includes(entry as GachaFilterTag)) tags.push(entry as GachaFilterTag);
  }
  return tags;
}

export function fillGachaPrompt(
  template: string,
  facts: { trade?: string; city?: string; businessName?: string },
): string {
  return template
    .replaceAll("{{trade}}", (facts.trade ?? "contractor").trim() || "contractor")
    .replaceAll("{{city}}", (facts.city ?? "California").trim() || "California")
    .replaceAll("{{businessName}}", (facts.businessName ?? "the company").trim() || "the company");
}

export function gachaById(
  packs: readonly GachaPack[],
  id: string,
  version = GACHA_PACK_VERSION,
): GachaPack | undefined {
  return packs.find((pack) => pack.id === id && pack.version === version);
}

function lookAndFeelOf(value: string | undefined): GachaLookAndFeel | undefined {
  if (value === "professional" || value === "funky" || value === "modern") return value;
  return undefined;
}

function seedIndex(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  const digest = createHash("sha256").update(seed, "utf8").digest();
  return digest.readUInt32BE(0) % modulo;
}

function filterPool(
  packs: readonly GachaPack[],
  input: Omit<GachaDrawInput, "seed" | "requestedId">,
): GachaPack[] {
  return packs.filter((pack) => {
    if (pack.minEvidenceStills > input.evidenceStillCount) return false;
    const look = lookAndFeelOf(input.lookAndFeel);
    if (look && pack.lookAndFeelAffinity.length > 0 && !pack.lookAndFeelAffinity.includes(look))
      return false;
    const tags = (input.tags ?? []).filter((tag): tag is GachaFilterTag => FILTER_TAG_SET.has(tag));
    if (tags.length > 0 && !tags.some((tag) => pack.tags.includes(tag))) return false;
    return true;
  });
}

export function drawGacha(packs: readonly GachaPack[], input: GachaDrawInput): GachaPack {
  if (input.requestedId) {
    const requested = gachaById(packs, input.requestedId);
    if (!requested) throw new Error("Unknown gachaId");
    return requested;
  }

  const recent = new Set(input.recentGachaIds ?? []);
  const attempts: Array<Omit<GachaDrawInput, "seed" | "requestedId">> = [
    {
      evidenceStillCount: input.evidenceStillCount,
      lookAndFeel: input.lookAndFeel,
      tags: input.tags,
      recentGachaIds: input.recentGachaIds,
    },
    {
      evidenceStillCount: input.evidenceStillCount,
      lookAndFeel: input.lookAndFeel,
      tags: input.tags,
    },
    {
      evidenceStillCount: input.evidenceStillCount,
      lookAndFeel: input.lookAndFeel,
    },
    { evidenceStillCount: input.evidenceStillCount },
    { evidenceStillCount: 0 },
  ];

  for (const attempt of attempts) {
    const base = filterPool(packs, attempt);
    const usable = attempt.recentGachaIds ? base.filter((pack) => !recent.has(pack.id)) : base;
    if (usable.length === 0) continue;
    return usable[seedIndex(input.seed, usable.length)]!;
  }

  throw new Error("Gacha drum is empty");
}

function gachaIdFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : undefined;
}

export function recentGachaIdsFromConfigs(
  configs: ReadonlyArray<Record<string, unknown> | null | undefined>,
): string[] {
  const ids: string[] = [];
  for (const config of configs) {
    const id = gachaIdFromUnknown(config?.gacha);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function recentGachaIdsFromPriorIdentities(
  identities: ReadonlyArray<Record<string, unknown>>,
): string[] {
  const ids: string[] = [];
  for (const identity of identities) {
    const id = gachaIdFromUnknown(identity.gacha);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export type DerivedGachaSlot = {
  slotId: string;
  role: "hero" | "proof" | "support" | "atmosphere" | "texture";
  required: boolean;
  sourcePreference: "evidence" | "generated";
  aspectRatio: GachaAspectRatio;
  cropGuidance: string;
  textOverlayAllowed: boolean;
  proofEligibleRequired: boolean;
  generationPrompt?: string;
};

export function deriveGachaMediaSlots(
  pack: GachaPack,
  facts: { trade?: string; city?: string; businessName?: string },
  evidenceCount: number,
): DerivedGachaSlot[] {
  const slots: DerivedGachaSlot[] = [];
  const proofSlots = pack.mediaRecipe.proofSlots ??
    (pack.mediaRecipe.proofStripRequired
      ? [
          {
            slotId: "proof-lead",
            aspectRatio: "landscape" as const,
            cropGuidance: "Keep finished work and materials readable; no crop through faces or signs.",
            minEvidence: 1 as const,
            required: true,
          },
          {
            slotId: "proof-support",
            aspectRatio: "portrait" as const,
            cropGuidance: "Detail crop of real project photography.",
            minEvidence: 2 as const,
            required: false,
          },
        ]
      : []);
  for (const proof of proofSlots) {
    if (evidenceCount < proof.minEvidence) continue;
    slots.push({
      slotId: proof.slotId,
      role: "proof",
      required: proof.required,
      sourcePreference: "evidence",
      aspectRatio: proof.aspectRatio,
      cropGuidance: proof.cropGuidance,
      textOverlayAllowed: false,
      proofEligibleRequired: true,
    });
  }
  for (const still of pack.mediaRecipe.atmosphereStills) {
    slots.push({
      slotId: still.slotId,
      role: still.role,
      required: still.role === "hero",
      sourcePreference: "generated",
      aspectRatio: still.aspectRatio,
      cropGuidance: still.cropGuidance,
      textOverlayAllowed: still.textOverlayAllowed,
      proofEligibleRequired: false,
      generationPrompt: fillGachaPrompt(still.promptTemplate, facts),
    });
  }
  return slots;
}
