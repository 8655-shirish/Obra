import { curateSiteEvidence } from "../site-evidence.ts";
import { mediaManifestFromConfig } from "./media-manifest.ts";
import type { SiteLeadField, SiteProps, SiteSectionCopy } from "./types.ts";

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asServices(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function shortConversionAsk(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 40) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return null;
  return trimmed;
}

export function conversionAskFromConfig(config: Record<string, unknown>): string | null {
  const persona = config.persona;
  if (!persona || typeof persona !== "object") return null;
  return shortConversionAsk((persona as { conversionAsk?: unknown }).conversionAsk);
}

export function configToSiteProps(
  config: Record<string, unknown>,
  options: { enableMotion: boolean; canSubmitLead: boolean; canOpenBooking?: boolean },
): SiteProps {
  const evidence = curateSiteEvidence({
    trade: asString(config.trade),
    lookAndFeel: config.lookAndFeel,
    mediaGallery: config.mediaGallery,
    extraReviews: config.extraReviews,
    trustMarkers: config.trustMarkers,
  });
  const manifestResult = mediaManifestFromConfig(config);
  const mediaSlots = manifestResult.kind === "current"
    ? Object.fromEntries(manifestResult.manifest.slots.map((slot) => [slot.slotId, slot]))
    : {};
  const sections = Array.isArray(config.sections)
    ? (config.sections as SiteSectionCopy[])
    : [];
  const leadFields = Array.isArray(config.lead_form_fields)
    ? (config.lead_form_fields as SiteLeadField[])
    : [
        { id: "name", label: "Name", required: true },
        { id: "email", label: "Email", required: true },
        { id: "phone", label: "Phone", required: false },
        { id: "message", label: "Project details", required: true },
      ];

  return {
    businessName: asString(config.businessName) || "Your Business",
    licenseNumber: asString(config.licenseNumber),
    trade: asString(config.trade),
    city: asString(config.city),
    services: asServices(config.services),
    primaryColor: asString(config.primaryColor) || "#1e3a5f",
    theme: config.theme === "dark" ? "dark" : "light",
    lookAndFeel: evidence.lookAndFeel,
    logoUrl: typeof config.logoUrl === "string" ? config.logoUrl : null,
    media: evidence.mediaGallery,
    mediaSlots,
    reviews: evidence.extraReviews,
    trustMarkers: evidence.trustMarkers,
    sections,
    phone: asString(config.phone) || null,
    address: asString(config.address) || null,
    hours: typeof config.hours === "string" ? config.hours : null,
    warranty: typeof config.warranty === "string" ? config.warranty : null,
    leadFields,
    contactHidden: config.contactHidden === true,
    enableMotion: options.enableMotion,
    canSubmitLead: options.canSubmitLead,
    canOpenBooking: options.canOpenBooking === true,
    conversionAsk: conversionAskFromConfig(config),
  };
}

export function sanitizeCssFontFamily(family: string, fallback: string): string {
  const cleaned = family.trim().replace(/[^a-zA-Z0-9 -]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2 || cleaned.length > 60) return fallback;
  return cleaned;
}

const GENERIC_FONT = /^(serif|sans-serif|monospace|system-ui|system ui|ui sans serif|ui serif|georgia|arial|helvetica|times new roman)$/i;

export function sanitizeGoogleFontFamily(family: string): string | null {
  const cleaned = family.trim().replace(/[^a-zA-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  if (GENERIC_FONT.test(cleaned)) return null;
  return cleaned;
}

export function googleFontStylesheetUrl(family: string, weights?: number[]): string | null {
  const cleaned = sanitizeGoogleFontFamily(family);
  if (!cleaned) return null;
  const spec = cleaned.replace(/ /g, "+");
  const wght = (weights && weights.length > 0 ? [...new Set(weights)].sort((a, b) => a - b) : [400, 500, 600, 700, 800, 900])
    .filter((w) => w >= 100 && w <= 900)
    .join(";");
  return `https://fonts.googleapis.com/css2?family=${spec}:wght@${wght}&display=swap`;
}
