/**
 * Single source of truth for SiteKit props the code agent may pass.
 * THEME_CODE_CONTRACT and the static audit both read this table.
 */

export const SECTION_BANDS = ["base", "soft", "primary", "ink", "media"] as const;
export const SECTION_WIDTHS = ["prose", "content", "wide", "full"] as const;
export const SECTION_PADS = ["none", "tight", "normal", "loose"] as const;
export const SECTION_SCRIMS = ["none", "soft", "strong"] as const;
export const HEADING_LEVELS = ["display", "title", "section", "sub", "eyebrow"] as const;
export const CARD_SURFACES = ["token", "plain"] as const;
export const ENTRANCE_PROP_VALUES = [
  "fade",
  "fadeUp",
  "fadeDown",
  "scaleIn",
  "slideFromLeft",
  "slideFromRight",
  "none",
] as const;
export const HOVER_PROP_VALUES = ["lift", "underline", "zoomMedia", "grow", "none"] as const;

export type KitPropSpec = {
  props: readonly string[];
  required?: readonly string[];
  /** Props that must be string/boolean literals so the audit can read them. */
  literal?: readonly string[];
  /** className prefixes the kit owns on this tag — use the named prop instead. */
  ownedClass?: Readonly<Record<string, readonly string[]>>;
};

export const KIT_PROP_TABLE = {
  Section: {
    props: [
      "id",
      "className",
      "children",
      "style",
      "entrance",
      "band",
      "width",
      "pad",
      "media",
      "scrim",
    ],
    required: ["id"],
    literal: ["id", "entrance", "band", "width", "pad", "scrim"],
    ownedClass: {
      band: ["bg-", "text-[var(--site-on-primary)]", "text-[var(--site-ink)]", "text-[var(--site-bg)]"],
      width: ["max-w-", "w-screen"],
      pad: ["py-", "px-", "pt-", "pb-", "p-"],
    },
  },
  Hero: {
    props: [
      "id",
      "className",
      "children",
      "style",
      "entrance",
      "band",
      "width",
      "pad",
      "media",
      "scrim",
    ],
    literal: ["id", "entrance", "band", "width", "pad", "scrim"],
    ownedClass: {
      band: ["bg-"],
      width: ["max-w-"],
      pad: ["py-", "px-", "pt-", "pb-", "p-"],
    },
  },
  Heading: {
    props: ["as", "className", "children", "level", "style"],
    literal: ["as", "level"],
    ownedClass: {
      level: ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl", "text-[", "font-thin", "font-light", "font-normal", "font-medium", "font-semibold", "font-bold", "font-extrabold", "font-black", "tracking-", "leading-"],
    },
  },
  Card: {
    props: ["className", "children", "hover", "surface", "style"],
    literal: ["hover", "surface"],
    ownedClass: {
      surface: ["bg-", "shadow-"],
    },
  },
  Media: {
    props: ["item", "media", "slotId", "className", "alt", "priority", "lazy", "disableLightbox", "galleryIndex", "hover", "motion"],
    literal: ["slotId", "hover", "priority", "lazy", "motion"],
    ownedClass: {
      scrim: ["opacity-"],
    },
  },
  MediaGallery: {
    props: ["media", "items", "className", "excludeFirst"],
    literal: ["excludeFirst"],
  },
  Grid: {
    props: ["className", "children", "stagger"],
    literal: ["stagger"],
  },
  Button: {
    props: ["href", "className", "children", "type", "variant", "onClick", "disabled", "hover"],
    literal: ["variant", "hover", "type"],
  },
  Quote: {
    props: ["quote", "author", "source", "className", "children", "hover"],
    literal: ["hover"],
  },
  QuoteCta: {
    props: ["className", "children", "pulse"],
    literal: ["pulse"],
  },
  Nav: {
    props: ["items", "className", "hover"],
    literal: ["hover"],
  },
  Header: {
    props: ["logoUrl", "businessName", "contactHidden", "pulse", "className", "media", "reviews"],
    /** pulse is a boolean literal; contactHidden is a runtime binding from props. */
    literal: ["pulse"],
  },
  TopBar: {
    props: ["className", "children"],
  },
  LeadSlot: {
    props: ["fields", "canSubmitLead", "className"],
  },
  TrustMarkerList: {
    props: ["markers", "className", "chipClassName", "chipStyle", "detailClassName"],
  },
  ReviewSourceBadge: {
    props: ["source", "className"],
  },
  NamedLayout: {
    props: ["section", "className", "style", "entrance", "band", "width", "pad", "scrim"],
    required: ["section"],
    literal: ["section", "entrance", "band", "width", "pad", "scrim"],
    ownedClass: {
      band: ["bg-", "text-[var(--site-on-primary)]", "text-[var(--site-ink)]", "text-[var(--site-bg)]"],
      pad: ["py-", "px-", "pt-", "pb-", "p-"],
    },
  },
} as const satisfies Record<string, KitPropSpec>;

export type KitTagName = keyof typeof KIT_PROP_TABLE;

export const KIT_TAG_NAMES = Object.keys(KIT_PROP_TABLE) as KitTagName[];

const IGNORE_ATTRS = new Set(["key", "ref"]);

export function isKnownKitProp(tag: string, prop: string): boolean {
  const spec = KIT_PROP_TABLE[tag as KitTagName];
  if (!spec) return true;
  if (IGNORE_ATTRS.has(prop)) return true;
  return (spec.props as readonly string[]).includes(prop);
}

export function kitContractText(): string {
  return `Kit named visual props (literals; kit owns the CSS):
- NamedLayout: section="hero|services|beforeAfter|reviews|footer" band="${SECTION_BANDS.join("|")}" pad="${SECTION_PADS.join("|")}" entrance="${ENTRANCE_PROP_VALUES.join("|")}". NamedLayout is the catalog section — do not wrap it, do not emit a sibling tree, do not emit raw h1.
- Section/Hero: band="${SECTION_BANDS.join("|")}" width="${SECTION_WIDTHS.join("|")}" pad="${SECTION_PADS.join("|")}" media={still} scrim="${SECTION_SCRIMS.join("|")}". band paints background+ink together and remaps --site-muted on primary/ink. Overlay heroes: Section media={still} scrim="soft|strong" (kit owns the photo and scrim; type is on-primary). Do not add a second Media with opacity-* or a bg-primary overlay div.
- Heading level="${HEADING_LEVELS.join("|")}" owns size/weight/tracking/leading from --site-h*.
- Card surface="${CARD_SURFACES.join("|")}" (token is the default chrome; plain is transparent, no shadow).
- Section entrance="${ENTRANCE_PROP_VALUES.join("|")}". Card/Media/Nav/Button hover="${HOVER_PROP_VALUES.join("|")}". zoomMedia is Media-only. Grid stagger. QuoteCta pulse.
Do not set type size, section max-width, section padding, or band background with Tailwind on Section/Heading. Composition (grid, flex, order, alignment, which elements exist) stays free.`;
}
