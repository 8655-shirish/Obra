/**
 * Curated pairing and tone tables — the only place human taste is encoded.
 * Weight ranges were checked against the Google Fonts css2 endpoint (it clamps
 * rather than 404s; requesting a missing weight renders synthetic bold).
 */

export const DESIGN_PAIRING_IDS = [
  "sourceSober",
  "baskervilleCraft",
  "bitterSlab",
  "oswaldSignage",
  "playfairPremium",
  "merriweatherWarm",
  "grotesqueTechnical",
  "barlowUtility",
  "dmClean",
  "archivoBold",
] as const;

export const DESIGN_SCALE_IDS = ["minorThird", "majorThird", "perfectFourth", "golden"] as const;
export const DESIGN_BASE_SIZE_IDS = ["sm", "md", "lg"] as const;
export const DESIGN_DENSITY_IDS = ["compact", "regular", "generous"] as const;
export const DESIGN_TONE_IDS = [
  "paper",
  "chalk",
  "linen",
  "slate",
  "steel",
  "sand",
  "sage",
  "oxide",
  "brandwash",
  "press",
] as const;
export const DESIGN_CORNERS_IDS = ["sharp", "soft", "round", "pill"] as const;
export const DESIGN_EMPHASIS_IDS = ["quiet", "balanced", "loud"] as const;

export type DesignPairingId = (typeof DESIGN_PAIRING_IDS)[number];
export type DesignScaleId = (typeof DESIGN_SCALE_IDS)[number];
export type DesignBaseSizeId = (typeof DESIGN_BASE_SIZE_IDS)[number];
export type DesignDensityId = (typeof DESIGN_DENSITY_IDS)[number];
export type DesignToneId = (typeof DESIGN_TONE_IDS)[number];
export type DesignCornersId = (typeof DESIGN_CORNERS_IDS)[number];
export type DesignEmphasisId = (typeof DESIGN_EMPHASIS_IDS)[number];

export type FaceWeightRange =
  | { kind: "range"; min: number; max: number }
  | { kind: "allowed"; values: readonly number[] };

export type PairingFace = {
  family: string;
  weights: FaceWeightRange;
};

export type DesignPairing = {
  id: DesignPairingId;
  display: PairingFace;
  sans: PairingFace;
  /** Which face sets h2/h3. h1 always uses the display face. */
  headingRole: "display" | "sans";
};

export type ToneContrast = "soft" | "standard" | "high" | "maximum";

export type DesignTone = {
  id: DesignToneId;
  /** Degrees, or "brand" to inherit hue from the contractor hex. */
  neutralHue: number | "brand";
  neutralChroma: number;
  contrast: ToneContrast;
};

const RANGE = (min: number, max: number): FaceWeightRange => ({ kind: "range", min, max });
const ALLOWED = (...values: number[]): FaceWeightRange => ({ kind: "allowed", values });

export const DESIGN_PAIRINGS: Record<DesignPairingId, DesignPairing> = {
  sourceSober: {
    id: "sourceSober",
    display: { family: "Source Serif 4", weights: RANGE(400, 900) },
    sans: { family: "Source Sans 3", weights: RANGE(400, 900) },
    headingRole: "display",
  },
  baskervilleCraft: {
    id: "baskervilleCraft",
    display: { family: "Libre Baskerville", weights: RANGE(400, 700) },
    sans: { family: "Work Sans", weights: RANGE(400, 900) },
    headingRole: "display",
  },
  bitterSlab: {
    id: "bitterSlab",
    display: { family: "Bitter", weights: RANGE(400, 900) },
    sans: { family: "Karla", weights: RANGE(400, 800) },
    headingRole: "display",
  },
  oswaldSignage: {
    id: "oswaldSignage",
    display: { family: "Oswald", weights: RANGE(400, 700) },
    sans: { family: "Lato", weights: ALLOWED(400, 700, 900) },
    headingRole: "sans",
  },
  playfairPremium: {
    id: "playfairPremium",
    display: { family: "Playfair Display", weights: RANGE(400, 900) },
    sans: { family: "Source Sans 3", weights: RANGE(400, 900) },
    headingRole: "sans",
  },
  merriweatherWarm: {
    id: "merriweatherWarm",
    display: { family: "Merriweather", weights: RANGE(400, 900) },
    sans: { family: "Nunito Sans", weights: RANGE(400, 900) },
    headingRole: "display",
  },
  grotesqueTechnical: {
    id: "grotesqueTechnical",
    display: { family: "Space Grotesk", weights: RANGE(400, 700) },
    sans: { family: "IBM Plex Sans", weights: RANGE(400, 700) },
    headingRole: "display",
  },
  barlowUtility: {
    id: "barlowUtility",
    display: { family: "Barlow Condensed", weights: RANGE(400, 900) },
    sans: { family: "Barlow", weights: RANGE(400, 900) },
    headingRole: "sans",
  },
  dmClean: {
    id: "dmClean",
    display: { family: "DM Serif Display", weights: ALLOWED(400) },
    sans: { family: "DM Sans", weights: RANGE(400, 900) },
    headingRole: "sans",
  },
  archivoBold: {
    id: "archivoBold",
    display: { family: "Archivo Black", weights: ALLOWED(400) },
    sans: { family: "Archivo", weights: RANGE(400, 900) },
    headingRole: "sans",
  },
};

export const DESIGN_TONES: Record<DesignToneId, DesignTone> = {
  paper: { id: "paper", neutralHue: 85, neutralChroma: 0.008, contrast: "high" },
  chalk: { id: "chalk", neutralHue: 0, neutralChroma: 0, contrast: "standard" },
  linen: { id: "linen", neutralHue: 70, neutralChroma: 0.02, contrast: "standard" },
  slate: { id: "slate", neutralHue: 250, neutralChroma: 0.015, contrast: "high" },
  steel: { id: "steel", neutralHue: 240, neutralChroma: 0.006, contrast: "soft" },
  sand: { id: "sand", neutralHue: 60, neutralChroma: 0.03, contrast: "standard" },
  sage: { id: "sage", neutralHue: 145, neutralChroma: 0.02, contrast: "soft" },
  oxide: { id: "oxide", neutralHue: 40, neutralChroma: 0.03, contrast: "high" },
  brandwash: { id: "brandwash", neutralHue: "brand", neutralChroma: 0.02, contrast: "standard" },
  press: { id: "press", neutralHue: 0, neutralChroma: 0, contrast: "maximum" },
};

export const DESIGN_SCALE_RATIOS: Record<DesignScaleId, number> = {
  minorThird: 1.2,
  majorThird: 1.25,
  perfectFourth: 1.333,
  golden: 1.414,
};

export const DESIGN_BASE_SIZES_REM: Record<DesignBaseSizeId, number> = {
  sm: 1,
  md: 1.125,
  lg: 1.25,
};

export const DESIGN_DENSITY_UNITS_REM: Record<DesignDensityId, number> = {
  compact: 0.75,
  regular: 1,
  generous: 1.25,
};

export const DESIGN_CORNER_RADII_REM: Record<DesignCornersId, number> = {
  sharp: 0,
  soft: 0.375,
  round: 0.75,
  pill: 1.25,
};

export function clampFaceWeight(desired: number, weights: FaceWeightRange): number {
  const snapped = Math.round(desired / 100) * 100;
  if (weights.kind === "allowed") {
    let best = weights.values[0] ?? 400;
    let bestDist = Math.abs(best - snapped);
    for (const value of weights.values) {
      const dist = Math.abs(value - snapped);
      if (dist < bestDist) {
        best = value;
        bestDist = dist;
      }
    }
    return best;
  }
  const bounded = Math.min(weights.max, Math.max(weights.min, snapped));
  return Math.round(bounded / 100) * 100;
}

export function faceWeightList(weights: FaceWeightRange): number[] {
  if (weights.kind === "allowed") return [...weights.values];
  const out: number[] = [];
  for (let w = weights.min; w <= weights.max; w += 100) out.push(w);
  return out;
}

export function designIntentContractText(toneIds?: readonly string[]): string {
  const tones = toneIds && toneIds.length > 0 ? toneIds : DESIGN_TONE_IDS;
  return [
    `pairing one of: ${DESIGN_PAIRING_IDS.join(", ")}`,
    `scale one of: ${DESIGN_SCALE_IDS.join(", ")}`,
    `baseSize one of: ${DESIGN_BASE_SIZE_IDS.join(", ")}`,
    `density one of: ${DESIGN_DENSITY_IDS.join(", ")}`,
    `tone one of: ${tones.join(", ")}`,
    `corners one of: ${DESIGN_CORNERS_IDS.join(", ")}`,
    `emphasis one of: ${DESIGN_EMPHASIS_IDS.join(", ")}`,
  ].join("; ");
}
