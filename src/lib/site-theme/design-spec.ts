import { lookAndFeelPaintTokens, type LookAndFeelSkin } from "../site-evidence.ts";
import { sanitizeCssFontFamily } from "./config-to-props.ts";
import {
  clampFaceWeight,
  DESIGN_BASE_SIZES_REM,
  DESIGN_CORNER_RADII_REM,
  DESIGN_DENSITY_UNITS_REM,
  DESIGN_PAIRINGS,
  DESIGN_SCALE_RATIOS,
  DESIGN_TONES,
  type DesignPairing,
  type DesignTone,
  type DesignToneId,
  type ToneContrast,
} from "./design-catalog.ts";
import type { SiteDesignIntent, SiteDesignSpec } from "./types.ts";

const TOKEN_RANGES = {
  h1: { min: 2, max: 3, fallback: 2.25 },
  h2: { min: 1.5, max: 2.25, fallback: 1.75 },
  h3: { min: 1.125, max: 1.5, fallback: 1.25 },
  radius: { min: 0, max: 1.25, fallback: 1 },
  bandPad: { min: 2.5, max: 4.5, fallback: 3.5 },
} as const;

type TokenKey = keyof typeof TOKEN_RANGES;

const EMPHASIS_WEIGHTS = {
  quiet: { display: 500, sans: 400, h2: 500, h3: 500 },
  balanced: { display: 700, sans: 500, h2: 650, h3: 600 },
  loud: { display: 900, sans: 600, h2: 800, h3: 700 },
} as const;

const EMPHASIS_TRACKING = {
  quiet: { h1: "0", h2: "0", h3: "0" },
  balanced: { h1: "-0.02em", h2: "-0.015em", h3: "-0.01em" },
  loud: { h1: "-0.035em", h2: "-0.02em", h3: "-0.01em" },
} as const;

const EMPHASIS_ELEVATION = {
  quiet: "none",
  balanced: "0 1px 2px oklch(0.2 0 0 / 0.06)",
  loud: "0 10px 28px oklch(0.2 0 0 / 0.14)",
} as const;

/** Lightness gap between `--site-bg` and `--site-canvas-soft` so alternating bands read as bands. */
export const MIN_BAND_LIGHTNESS_DELTA = 0.07;
export const AA_CONTRAST_MIN = 4.5;
/** Chromatic tones farther than this from the brand hue are omitted from the design menu. */
export const TONE_HARMONY_MAX_HUE = 80;
export const INK_ON_PRIMARY_LIGHT = "#ffffff";
export const INK_ON_PRIMARY_DARK = "#0f172a";

const CONTRAST_LADDERS: Record<
  ToneContrast,
  { light: { bg: number; canvas: number; hairline: number; muted: number; ink: number }; dark: { bg: number; canvas: number; hairline: number; muted: number; ink: number } }
> = {
  soft: {
    light: { bg: 0.97, canvas: 0.89, hairline: 0.82, muted: 0.45, ink: 0.25 },
    dark: { bg: 0.22, canvas: 0.3, hairline: 0.38, muted: 0.72, ink: 0.92 },
  },
  standard: {
    light: { bg: 0.99, canvas: 0.91, hairline: 0.84, muted: 0.42, ink: 0.18 },
    dark: { bg: 0.16, canvas: 0.24, hairline: 0.34, muted: 0.74, ink: 0.95 },
  },
  high: {
    light: { bg: 0.995, canvas: 0.915, hairline: 0.84, muted: 0.38, ink: 0.12 },
    dark: { bg: 0.12, canvas: 0.2, hairline: 0.3, muted: 0.76, ink: 0.97 },
  },
  maximum: {
    light: { bg: 1, canvas: 0.92, hairline: 0.85, muted: 0.36, ink: 0.05 },
    dark: { bg: 0.08, canvas: 0.16, hairline: 0.24, muted: 0.78, ink: 0.99 },
  },
};

function parseToRem(value: string, fallback: number): number {
  const trimmed = value.trim();
  const rem = /^(-?\d+(?:\.\d+)?)rem$/i.exec(trimmed);
  if (rem) return Number(rem[1]);
  const px = /^(-?\d+(?:\.\d+)?)px$/i.exec(trimmed);
  if (px) return Number(px[1]) / 16;
  const em = /^(-?\d+(?:\.\d+)?)em$/i.exec(trimmed);
  if (em) return Number(em[1]);
  return fallback;
}

function clampRem(value: string, key: TokenKey): string {
  const range = TOKEN_RANGES[key];
  const parsed = parseToRem(value, range.fallback);
  const clamped = Math.min(range.max, Math.max(range.min, parsed));
  const rounded = Math.round(clamped * 1000) / 1000;
  return `${rounded}rem`;
}

function roundRem(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function remString(value: number): string {
  return `${roundRem(value)}rem`;
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearSrgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

function oklabToLinearSrgb(L: number, a: number, b: number): { r: number; g: number; b: number } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

export function hexToOklchHue(hex: string): number {
  const match = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!match) return 250;
  const n = Number.parseInt(match[1], 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const lab = linearSrgbToOklab(r, g, b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return Math.round(h * 10) / 10;
}

export function oklchCss(L: number, C: number, H: number): string {
  const l = Math.round(Math.min(1, Math.max(0, L)) * 1000) / 1000;
  const c = Math.round(Math.max(0, C) * 1000) / 1000;
  const h = Math.round(((H % 360) + 360) % 360);
  return `oklch(${l} ${c} ${h})`;
}

export function parseOklchCss(value: string): { L: number; C: number; H: number } | null {
  const match = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/i.exec(value.trim());
  if (!match) return null;
  return { L: Number(match[1]), C: Number(match[2]), H: Number(match[3]) };
}

export function oklchRelativeLuminance(value: string): number {
  const parsed = parseOklchCss(value);
  if (!parsed) return 0;
  const a = parsed.C * Math.cos((parsed.H * Math.PI) / 180);
  const b = parsed.C * Math.sin((parsed.H * Math.PI) / 180);
  const rgb = oklabToLinearSrgb(parsed.L, a, b);
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
  return 0.2126 * clamp(rgb.r) + 0.7152 * clamp(rgb.g) + 0.0722 * clamp(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const l1 = oklchRelativeLuminance(a);
  const l2 = oklchRelativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

export function hexRelativeLuminance(hex: string): number {
  const match = /^#?([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (!match) return 0;
  const n = Number.parseInt(match[1], 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hexContrastRatio(a: string, b: string): number {
  const l1 = hexRelativeLuminance(a);
  const l2 = hexRelativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

export function inkOnPrimaryHex(primary: string): string {
  const light = hexContrastRatio(INK_ON_PRIMARY_LIGHT, primary);
  const dark = hexContrastRatio(INK_ON_PRIMARY_DARK, primary);
  return light >= dark ? INK_ON_PRIMARY_LIGHT : INK_ON_PRIMARY_DARK;
}

export function circularHueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function resolvedToneHue(tone: DesignTone, primaryColor: string): number {
  return toneHue(tone, primaryColor);
}

function isAlwaysOfferedTone(tone: DesignTone): boolean {
  return tone.neutralChroma === 0 || tone.neutralHue === "brand";
}

export function tonesForPrimaryColor(primaryColor: string): DesignToneId[] {
  const primaryHue = hexToOklchHue(primaryColor);
  const kept: DesignToneId[] = [];
  const rejected: Array<{ id: DesignToneId; distance: number }> = [];
  for (const id of Object.keys(DESIGN_TONES) as DesignToneId[]) {
    const tone = DESIGN_TONES[id];
    if (isAlwaysOfferedTone(tone)) {
      kept.push(id);
      continue;
    }
    const distance = circularHueDistance(resolvedToneHue(tone, primaryColor), primaryHue);
    if (distance <= TONE_HARMONY_MAX_HUE) kept.push(id);
    else rejected.push({ id, distance });
  }
  if (kept.length === 0) {
    rejected.sort((a, b) => a.distance - b.distance);
    return rejected.slice(0, 3).map((item) => item.id);
  }
  return kept;
}

export function snapToneToHarmonious(toneId: string, primaryColor: string): DesignToneId {
  const allowed = tonesForPrimaryColor(primaryColor);
  if (allowed.includes(toneId as DesignToneId)) return toneId as DesignToneId;
  const tone = isTableKey(toneId, DESIGN_TONES) ? DESIGN_TONES[toneId] : null;
  const targetHue = tone ? resolvedToneHue(tone, primaryColor) : hexToOklchHue(primaryColor);
  let best = allowed[0] ?? "chalk";
  let bestDist = Number.POSITIVE_INFINITY;
  for (const id of allowed) {
    const dist = circularHueDistance(resolvedToneHue(DESIGN_TONES[id], primaryColor), targetHue);
    if (dist < bestDist) {
      best = id;
      bestDist = dist;
    }
  }
  return best;
}

function toneHue(tone: DesignTone, primaryColor: string): number {
  if (tone.neutralHue === "brand") return hexToOklchHue(primaryColor);
  return tone.neutralHue;
}

function formatOklch(L: number, chroma: number, hue: number, role: "bg" | "canvas" | "hairline" | "muted" | "ink"): string {
  const scale =
    role === "bg" ? 1 : role === "canvas" ? 1.1 : role === "hairline" ? 0.8 : role === "muted" ? 1.2 : 1.15;
  return oklchCss(L, chroma * scale, hue);
}

export type IntentRamp = {
  bg: string;
  ink: string;
  muted: string;
  hairline: string;
  canvasSoft: string;
};

function enforceBandLightness(
  theme: "light" | "dark",
  bg: number,
  canvas: number,
): number {
  if (theme === "light") {
    if (bg - canvas >= MIN_BAND_LIGHTNESS_DELTA) return canvas;
    return Math.max(0, Math.min(1, bg - MIN_BAND_LIGHTNESS_DELTA));
  }
  if (canvas - bg >= MIN_BAND_LIGHTNESS_DELTA) return canvas;
  return Math.max(0, Math.min(1, bg + MIN_BAND_LIGHTNESS_DELTA));
}

export function deriveToneRamp(
  tone: DesignTone,
  theme: "light" | "dark",
  primaryColor: string,
): IntentRamp {
  const hue = toneHue(tone, primaryColor);
  const ladder = CONTRAST_LADDERS[tone.contrast][theme];
  const chroma = tone.neutralChroma;
  const canvas = enforceBandLightness(theme, ladder.bg, ladder.canvas);
  return {
    bg: formatOklch(ladder.bg, chroma, hue, "bg"),
    canvasSoft: formatOklch(canvas, chroma, hue, "canvas"),
    hairline: formatOklch(ladder.hairline, chroma, hue, "hairline"),
    muted: formatOklch(ladder.muted, chroma, hue, "muted"),
    ink: formatOklch(ladder.ink, chroma, hue, "ink"),
  };
}

function modularClamp(base: number, ratio: number, exponent: number): { css: string; desktop: number; mobile: number } {
  const desktop = base * ratio ** exponent;
  const mobile = base * ratio ** Math.max(1, exponent - 1);
  const preferred = `${roundRem(desktop * 0.42)}rem + ${roundRem(1.1 + exponent * 0.55)}vw`;
  return {
    desktop: roundRem(desktop),
    mobile: roundRem(mobile),
    css: `clamp(${remString(mobile)}, ${preferred}, ${remString(desktop)})`,
  };
}

export type DerivedTypeScale = {
  h1: string;
  h2: string;
  h3: string;
  h1Desktop: number;
  h2Desktop: number;
  h3Desktop: number;
  base: number;
  ratio: number;
};

const DISPLAY_DESKTOP = { min: 3.25, max: 4.5 } as const;
const BASE_SIZE_T: Record<SiteDesignIntent["baseSize"], number> = { sm: 0, md: 0.5, lg: 1 };
const SCALE_T: Record<SiteDesignIntent["scale"], number> = {
  minorThird: 0,
  majorThird: 1 / 3,
  perfectFourth: 2 / 3,
  golden: 1,
};

/** Hero display size: mix baseSize + scale into 3.25–4.5rem desktop. h2/h3 stay modular. */
function displayClamp(intent: SiteDesignIntent): { css: string; desktop: number; mobile: number } {
  const t = 0.5 * BASE_SIZE_T[intent.baseSize] + 0.5 * SCALE_T[intent.scale];
  const desktop = DISPLAY_DESKTOP.min + t * (DISPLAY_DESKTOP.max - DISPLAY_DESKTOP.min);
  const mobile = Math.max(2.35, desktop * 0.72);
  const preferred = `${roundRem(desktop * 0.36)}rem + ${roundRem(1.7 + t * 1.5)}vw`;
  return {
    desktop: roundRem(desktop),
    mobile: roundRem(mobile),
    css: `clamp(${remString(mobile)}, ${preferred}, ${remString(desktop)})`,
  };
}

export function deriveTypeScale(intent: SiteDesignIntent): DerivedTypeScale {
  const base = DESIGN_BASE_SIZES_REM[intent.baseSize];
  const ratio = DESIGN_SCALE_RATIOS[intent.scale];
  const h3 = modularClamp(base, ratio, 1);
  const h2 = modularClamp(base, ratio, 2);
  const h1 = displayClamp(intent);
  return {
    h1: h1.css,
    h2: h2.css,
    h3: h3.css,
    h1Desktop: h1.desktop,
    h2Desktop: h2.desktop,
    h3Desktop: h3.desktop,
    base,
    ratio,
  };
}

function leadingForSize(desktopRem: number): string {
  if (desktopRem >= 2.6) return "1.05";
  if (desktopRem >= 1.8) return "1.15";
  return "1.25";
}

export type IntentPaint = {
  fontDisplay: string;
  fontSans: string;
  displayWeights: number[];
  sansWeights: number[];
  h1: string;
  h2: string;
  h3: string;
  radius: string;
  bandPad: string;
  sectionPadY: string;
  sectionPadX: string;
  sectionMax: string;
  sectionMargin: string;
  gridGap: string;
  cardPad: string;
  cardSurface: string;
  elevation: string;
  mediaRatio: string;
  fontH1: string;
  fontH2: string;
  fontH3: string;
  weightH1: string;
  weightH2: string;
  weightH3: string;
  trackingH1: string;
  trackingH2: string;
  trackingH3: string;
  leadingH1: string;
  leadingH2: string;
  leadingH3: string;
  ramp: IntentRamp;
};

function fontStack(family: string, role: "display" | "sans"): string {
  const fallback = role === "display" ? "Georgia, serif" : "system-ui, sans-serif";
  return `"${family}", ${fallback}`;
}

export function deriveIntentPaint(
  intent: SiteDesignIntent,
  options?: { theme?: "light" | "dark"; primaryColor?: string },
): IntentPaint {
  const pairing: DesignPairing = DESIGN_PAIRINGS[intent.pairing];
  const tone = DESIGN_TONES[intent.tone];
  const theme = options?.theme === "dark" ? "dark" : "light";
  const primary = options?.primaryColor || "#1e3a5f";
  const type = deriveTypeScale(intent);
  const unit = DESIGN_DENSITY_UNITS_REM[intent.density];
  const radius = remString(DESIGN_CORNER_RADII_REM[intent.corners]);
  const sectionPadY = remString(unit * 4);
  const weights = EMPHASIS_WEIGHTS[intent.emphasis];
  const tracking = EMPHASIS_TRACKING[intent.emphasis];
  const weightH1 = clampFaceWeight(weights.display, pairing.display.weights);
  const subheadFace = pairing.headingRole === "sans" ? pairing.sans : pairing.display;
  const weightH2 = clampFaceWeight(weights.h2, subheadFace.weights);
  const weightH3 = clampFaceWeight(weights.h3, subheadFace.weights);
  const bodyWeight = clampFaceWeight(weights.sans, pairing.sans.weights);
  const displayName = pairing.display.family;
  const sansName = pairing.sans.family;
  const subheadStack = fontStack(subheadFace.family, pairing.headingRole);
  const displayUsed = pairing.headingRole === "display" ? [weightH1, weightH2, weightH3] : [weightH1];
  const sansUsed =
    pairing.headingRole === "sans" ? [bodyWeight, weightH2, weightH3] : [bodyWeight];

  return {
    fontDisplay: displayName,
    fontSans: sansName,
    displayWeights: [...new Set([400, ...displayUsed])].sort((a, b) => a - b),
    sansWeights: [...new Set([400, ...sansUsed])].sort((a, b) => a - b),
    h1: type.h1,
    h2: type.h2,
    h3: type.h3,
    radius,
    bandPad: sectionPadY,
    sectionPadY,
    sectionPadX: remString(unit * 1.5),
    sectionMax: intent.density === "compact" ? "64rem" : intent.density === "generous" ? "80rem" : "72rem",
    sectionMargin: "auto",
    gridGap: remString(unit),
    cardPad: remString(unit * 1.25),
    cardSurface: "var(--site-canvas-soft)",
    elevation: EMPHASIS_ELEVATION[intent.emphasis],
    mediaRatio: intent.density === "compact" ? "4 / 3" : intent.density === "generous" ? "16 / 9" : "3 / 2",
    fontH1: fontStack(displayName, "display"),
    fontH2: subheadStack,
    fontH3: subheadStack,
    weightH1: String(weightH1),
    weightH2: String(weightH2),
    weightH3: String(weightH3),
    trackingH1: tracking.h1,
    trackingH2: tracking.h2,
    trackingH3: tracking.h3,
    leadingH1: leadingForSize(type.h1Desktop),
    leadingH2: leadingForSize(type.h2Desktop),
    leadingH3: leadingForSize(type.h3Desktop),
    ramp: deriveToneRamp(tone, theme, primary),
  };
}

export function intentTuple(intent: SiteDesignIntent): string {
  return [
    intent.pairing,
    intent.scale,
    intent.baseSize,
    intent.density,
    intent.tone,
    intent.corners,
    intent.emphasis,
  ].join("/");
}

function isTableKey<T extends Record<string, unknown>>(value: unknown, table: T): value is keyof T {
  return typeof value === "string" && value in table;
}

export function readDesignIntent(spec: unknown): SiteDesignIntent | null {
  if (!spec || typeof spec !== "object") return null;
  const rec = spec as Record<string, unknown>;
  const intent = rec.designIntent;
  if (!intent || typeof intent !== "object") return null;
  const raw = intent as Record<string, unknown>;
  if (!isTableKey(raw.pairing, DESIGN_PAIRINGS)) return null;
  if (!isTableKey(raw.scale, DESIGN_SCALE_RATIOS)) return null;
  if (!isTableKey(raw.baseSize, DESIGN_BASE_SIZES_REM)) return null;
  if (!isTableKey(raw.density, DESIGN_DENSITY_UNITS_REM)) return null;
  if (!isTableKey(raw.tone, DESIGN_TONES)) return null;
  if (!isTableKey(raw.corners, DESIGN_CORNER_RADII_REM)) return null;
  if (!isTableKey(raw.emphasis, EMPHASIS_WEIGHTS)) return null;
  return {
    pairing: raw.pairing,
    scale: raw.scale,
    baseSize: raw.baseSize,
    density: raw.density,
    tone: raw.tone,
    corners: raw.corners,
    emphasis: raw.emphasis,
  };
}

export function hasDesignSpecPaintTokens(spec: unknown): spec is SiteDesignSpec {
  if (!spec || typeof spec !== "object") return false;
  const rec = spec as Record<string, unknown>;
  return (
    typeof rec.fontDisplay === "string" &&
    rec.fontDisplay.trim().length > 0 &&
    typeof rec.fontSans === "string" &&
    rec.fontSans.trim().length > 0 &&
    typeof rec.h1 === "string" &&
    rec.h1.trim().length > 0 &&
    typeof rec.h2 === "string" &&
    rec.h2.trim().length > 0 &&
    typeof rec.h3 === "string" &&
    rec.h3.trim().length > 0 &&
    typeof rec.radius === "string" &&
    rec.radius.trim().length > 0 &&
    typeof rec.bandPad === "string" &&
    rec.bandPad.trim().length > 0
  );
}

function sanitizeLegacyTokens(spec: {
  fontDisplay?: string;
  fontSans?: string;
  h1?: string;
  h2?: string;
  h3?: string;
  radius?: string;
  bandPad?: string;
  paletteNote?: string;
}): SiteDesignSpec {
  return {
    fontDisplay: sanitizeCssFontFamily(spec.fontDisplay ?? "", "Georgia"),
    fontSans: sanitizeCssFontFamily(spec.fontSans ?? "", "system-ui"),
    h1: clampRem(spec.h1 ?? TOKEN_RANGES.h1.fallback + "rem", "h1"),
    h2: clampRem(spec.h2 ?? TOKEN_RANGES.h2.fallback + "rem", "h2"),
    h3: clampRem(spec.h3 ?? TOKEN_RANGES.h3.fallback + "rem", "h3"),
    radius: clampRem(spec.radius ?? TOKEN_RANGES.radius.fallback + "rem", "radius"),
    bandPad: clampRem(spec.bandPad ?? TOKEN_RANGES.bandPad.fallback + "rem", "bandPad"),
    ...(spec.paletteNote ? { paletteNote: spec.paletteNote } : {}),
  };
}

export function sanitizeDesignSpec(spec: {
  fontDisplay?: string;
  fontSans?: string;
  h1?: string;
  h2?: string;
  h3?: string;
  radius?: string;
  bandPad?: string;
  paletteNote?: string;
  designIntent?: SiteDesignIntent;
}): SiteDesignSpec {
  const intent = spec.designIntent ? readDesignIntent({ designIntent: spec.designIntent }) : null;
  if (intent) {
    const paint = deriveIntentPaint(intent);
    return {
      fontDisplay: paint.fontDisplay,
      fontSans: paint.fontSans,
      h1: paint.h1,
      h2: paint.h2,
      h3: paint.h3,
      radius: paint.radius,
      bandPad: paint.bandPad,
      ...(spec.paletteNote ? { paletteNote: spec.paletteNote } : {}),
      designIntent: intent,
    };
  }
  return sanitizeLegacyTokens(spec);
}

export const INTENT_PAINT_VARS = [
  "--site-section-pad-y",
  "--site-section-pad-x",
  "--site-section-max",
  "--site-section-margin",
  "--site-grid-gap",
  "--site-card-pad",
  "--site-card-surface",
  "--site-elevation",
  "--site-media-ratio",
  "--site-font-h1",
  "--site-font-h2",
  "--site-font-h3",
  "--site-weight-h1",
  "--site-weight-h2",
  "--site-weight-h3",
  "--site-tracking-h1",
  "--site-tracking-h2",
  "--site-tracking-h3",
  "--site-leading-h1",
  "--site-leading-h2",
  "--site-leading-h3",
] as const;

export type PaintTokens = {
  radius: string;
  bandPad: string;
  h1: string;
  h2: string;
  h3: string;
  intent?: IntentPaint;
};

export function resolvePaintTokens(
  spec: unknown,
  lookAndFeel: LookAndFeelSkin,
  options?: { theme?: "light" | "dark"; primaryColor?: string },
): PaintTokens {
  const intent = readDesignIntent(spec);
  if (intent) {
    const paint = deriveIntentPaint(intent, options);
    return {
      radius: paint.radius,
      bandPad: paint.bandPad,
      h1: paint.h1,
      h2: paint.h2,
      h3: paint.h3,
      intent: paint,
    };
  }
  if (!hasDesignSpecPaintTokens(spec)) {
    return lookAndFeelPaintTokens(lookAndFeel);
  }
  const sanitized = sanitizeDesignSpec(spec);
  return {
    radius: sanitized.radius,
    bandPad: sanitized.bandPad,
    h1: sanitized.h1,
    h2: sanitized.h2,
    h3: sanitized.h3,
  };
}
