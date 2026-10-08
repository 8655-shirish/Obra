import { z } from "zod";

import type { LookAndFeelSkin } from "../site-evidence.ts";
import type { MediaManifestSlot } from "./media-manifest.ts";
import {
  DESIGN_BASE_SIZE_IDS,
  DESIGN_CORNERS_IDS,
  DESIGN_DENSITY_IDS,
  DESIGN_EMPHASIS_IDS,
  DESIGN_PAIRING_IDS,
  DESIGN_SCALE_IDS,
  DESIGN_TONE_IDS,
} from "./design-catalog.ts";
import { CANONICAL_SECTION_TYPES } from "../agent/section-order.ts";

export const THEME_SOURCE_MAX_BYTES = 80 * 1024;

export const CANONICAL_THEME_SECTION_IDS = CANONICAL_SECTION_TYPES;

export type SiteMediaItem = {
  url?: string;
  storagePath?: string;
  mimeType?: string;
  alt?: string;
  origin?: "evidence" | "generated";
  slotId?: string;
  assetId?: string;
  posterUrl?: string;
};

export type SiteReview = {
  quote: string;
  author?: string;
  source?: string;
};

export type SiteTrustMarker = {
  id: string;
  kind: string;
  label: string;
  detail?: string;
  href?: string;
};

export type SiteSectionCopy = {
  id: string;
  type: string;
  heading: string;
  body: string;
  catalogRef?: string;
  entrance?: string;
  stagger?: boolean;
  hover?: string;
};

export type SiteLeadField = {
  id: string;
  label: string;
  required: boolean;
};

export type SiteProps = {
  businessName: string;
  licenseNumber: string;
  trade: string;
  city: string;
  services: string[];
  primaryColor: string;
  theme: "light" | "dark";
  lookAndFeel: LookAndFeelSkin;
  logoUrl?: string | null;
  media: SiteMediaItem[];
  mediaSlots: Record<string, MediaManifestSlot>;
  reviews: SiteReview[];
  trustMarkers: SiteTrustMarker[];
  sections: SiteSectionCopy[];
  phone?: string | null;
  address?: string | null;
  hours?: string | null;
  warranty?: string | null;
  leadFields: SiteLeadField[];
  contactHidden: boolean;
  enableMotion: boolean;
  canSubmitLead: boolean;
  canOpenBooking: boolean;
  conversionAsk?: string | null;
};

export const siteDesignIntentSchema = z.object({
  pairing: z.enum(DESIGN_PAIRING_IDS),
  scale: z.enum(DESIGN_SCALE_IDS),
  baseSize: z.enum(DESIGN_BASE_SIZE_IDS),
  density: z.enum(DESIGN_DENSITY_IDS),
  tone: z.enum(DESIGN_TONE_IDS),
  corners: z.enum(DESIGN_CORNERS_IDS),
  emphasis: z.enum(DESIGN_EMPHASIS_IDS),
});

export type SiteDesignIntent = z.infer<typeof siteDesignIntentSchema>;

const TOKEN_KEYS = ["fontDisplay", "fontSans", "h1", "h2", "h3", "radius", "bandPad"] as const;

export const siteDesignSpecSchema = z
  .object({
    fontDisplay: z.string().min(1).optional(),
    fontSans: z.string().min(1).optional(),
    h1: z.string().min(1).optional(),
    h2: z.string().min(1).optional(),
    h3: z.string().min(1).optional(),
    radius: z.string().min(1).optional(),
    bandPad: z.string().min(1).optional(),
    paletteNote: z.string().optional(),
    designIntent: siteDesignIntentSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.designIntent) return;
    for (const key of TOKEN_KEYS) {
      if (!value[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} is required when designIntent is absent`,
          path: [key],
        });
      }
    }
  });

/** Stored/sanitized spec: seven paint fields always filled; intent optional. */
export type SiteDesignSpec = {
  fontDisplay: string;
  fontSans: string;
  h1: string;
  h2: string;
  h3: string;
  radius: string;
  bandPad: string;
  paletteNote?: string;
  designIntent?: SiteDesignIntent;
};
