/**
 * Named layout vocabulary — HyperUI, Tailblocks, Meraki UI (MIT).
 *
 * Upstream pins (compile-time mapping only; never fetched at generate/runtime):
 * - https://github.com/markmead/hyperui @ 67bab3125015033a6e93c4608c84e6255718696d
 * - https://github.com/mertJF/tailblocks @ 34943e63da6a2d45a55a076ea18312a1c1098957
 * - https://github.com/merakiuilabs/merakiui @ fe0472efe93f6cd275424ecbdfa7f6cb8da6f908
 *
 * HyperUI at this pin has no Heroes folder. Hero ids stay stable and map onto
 * Tailblocks/Meraki hero files. Runtime is SiteKit NamedLayout, not a sketch.
 */

export type NamedLayoutSource = "hyperui" | "tailblocks" | "merakiui";

export type NamedLayoutSection = "hero" | "services" | "beforeAfter" | "reviews" | "footer";

/** Internal composition family — fallback chrome maps split-media → split, else centered. */
export type NamedLayoutFamily =
  | "split-media"
  | "stacked-media"
  | "overlay-media"
  | "type-only"
  | "cards"
  | "grid"
  | "rows"
  | "featured"
  | "mosaic";

export type NamedLayoutEntry = {
  id: string;
  title: string;
  source: NamedLayoutSource;
  canonicalSection: NamedLayoutSection;
  category: string;
  tags: string[];
  layoutSketch: string;
  layoutFamily: NamedLayoutFamily;
  /** True when the composition needs a photo to read as intended. */
  requiresMedia: boolean;
  requires?: { anchors?: number; media?: number; quotes?: number };
  /** Pinned MIT file this composition was compiled from (source@sha:path). */
  upstream: string;
};

const HYPERUI = "hyperui@67bab3125015033a6e93c4608c84e6255718696d";
const TAILBLOCKS = "tailblocks@34943e63da6a2d45a55a076ea18312a1c1098957";
const MERAKI = "merakiui@fe0472efe93f6cd275424ecbdfa7f6cb8da6f908";

const HERO: NamedLayoutEntry[] = [
  {
    id: "hyperui/hero/centered-type-only",
    title: "Centered type only",
    source: "hyperui",
    canonicalSection: "hero",
    category: "Heroes",
    tags: ["centered", "type-only", "quiet", "no-media"],
    layoutSketch: "kicker-above, heading-center, body-center, ctas-center — no media",
    layoutFamily: "type-only",
    requiresMedia: false,
    upstream: `${MERAKI}:components/heros/CenterContent.html`,
  },
  {
    id: "hyperui/hero/left-type-only",
    title: "Left-aligned type only",
    source: "hyperui",
    canonicalSection: "hero",
    category: "Heroes",
    tags: ["left", "type-only", "quiet", "no-media"],
    layoutSketch: "kicker-left, heading-left, body-left, ctas-left — no media",
    layoutFamily: "type-only",
    requiresMedia: false,
    upstream: `${TAILBLOCKS}:src/blocks/hero/light/a.js`,
  },
  {
    id: "hyperui/hero/split-media-right",
    title: "Split media right",
    source: "hyperui",
    canonicalSection: "hero",
    category: "Heroes",
    tags: ["split-media", "media-right", "two-column"],
    layoutSketch: "type-left, media-right, ctas-under-type",
    layoutFamily: "split-media",
    requiresMedia: true,
    upstream: `${TAILBLOCKS}:src/blocks/hero/light/b.js`,
  },
  {
    id: "hyperui/hero/stacked-media-below",
    title: "Stacked media below type",
    source: "hyperui",
    canonicalSection: "hero",
    category: "Heroes",
    tags: ["stacked-media", "type-then-image"],
    layoutSketch: "type-block, media-full-width-below",
    layoutFamily: "stacked-media",
    requiresMedia: true,
    upstream: `${TAILBLOCKS}:src/blocks/hero/light/f.js`,
  },
  {
    id: "hyperui/hero/split-media-wide",
    title: "Narrow type, wide media",
    source: "hyperui",
    canonicalSection: "hero",
    category: "Heroes",
    tags: ["split-media", "media-dominant"],
    layoutSketch: "narrow-type-left, wide-media-right",
    layoutFamily: "split-media",
    requiresMedia: true,
    upstream: `${MERAKI}:components/heros/SideImage.html`,
  },
  {
    id: "hyperui/hero/split-media-left",
    title: "Split media left",
    source: "hyperui",
    canonicalSection: "hero",
    category: "Heroes",
    tags: ["split-media", "media-left", "two-column"],
    layoutSketch:
      "media-left, type-right, ctas-under-type; crop Media with aspect-* / object-cover; do not reserve a min-height image column; images only from props.media",
    layoutFamily: "split-media",
    requiresMedia: true,
    upstream: `${TAILBLOCKS}:src/blocks/hero/light/e.js`,
  },
  {
    id: "hyperui/hero/overlay-media",
    title: "Type over cropped media",
    source: "hyperui",
    canonicalSection: "hero",
    category: "Heroes",
    tags: ["overlay-media", "type-on-photo"],
    layoutSketch:
      "type centered over cropped Media (aspect-* / object-cover overlay); do not reserve a min-height image column; images only from props.media — no CSS background-image",
    layoutFamily: "overlay-media",
    requiresMedia: true,
    upstream: `${MERAKI}:components/heros/BackgroundImage.html`,
  },
];

const SERVICES: NamedLayoutEntry[] = [
  {
    id: "hyperui/services/three-col-bordered-cards",
    title: "Three-column bordered cards",
    source: "hyperui",
    canonicalSection: "services",
    category: "Feature",
    tags: ["cards", "three-column", "bordered"],
    layoutSketch: "heading, then 3-col Grid of Card (icon, title, body)",
    layoutFamily: "cards",
    requiresMedia: false,
    upstream: `${HYPERUI}:public/examples/marketing/feature-grids/1.html`,
  },
  {
    id: "hyperui/services/numbered-step-rows",
    title: "Numbered step rows",
    source: "hyperui",
    canonicalSection: "services",
    category: "Feature",
    tags: ["rows", "numbered", "steps"],
    layoutSketch:
      "heading, then numbered step rows (N rows when N services exist; fewer items → fewer rows or a stack)",
    layoutFamily: "rows",
    requiresMedia: false,
    upstream: `${HYPERUI}:public/examples/marketing/feature-grids/2.html`,
  },
  {
    id: "hyperui/services/heading-left-list-right",
    title: "Heading left, service rows right",
    source: "hyperui",
    canonicalSection: "services",
    category: "Feature",
    tags: ["split", "list", "rows"],
    layoutSketch: "heading-left, stacked-icon-copy-rows-right",
    layoutFamily: "rows",
    requiresMedia: false,
    upstream: `${HYPERUI}:public/examples/marketing/feature-grids/2.html`,
  },
  {
    id: "hyperui/services/four-col-icon-grid",
    title: "Four-column centered icon grid",
    source: "hyperui",
    canonicalSection: "services",
    category: "Feature",
    tags: ["grid", "four-column", "centered"],
    layoutSketch: "heading-center, 4-col Grid of centered icon+title+body",
    layoutFamily: "grid",
    requiresMedia: false,
    upstream: `${HYPERUI}:public/examples/marketing/feature-grids/3.html`,
  },
  {
    id: "hyperui/services/two-col-icon-cards",
    title: "Two-column icon cards",
    source: "hyperui",
    canonicalSection: "services",
    category: "Feature",
    tags: ["cards", "two-column"],
    layoutSketch: "heading, then 2-col Grid of Card (icon-left, title+body)",
    layoutFamily: "cards",
    requiresMedia: false,
    upstream: `${HYPERUI}:public/examples/marketing/feature-grids/4.html`,
  },
  {
    id: "merakiui/services/cards-left-media-right",
    title: "Service cards left, media right",
    source: "merakiui",
    canonicalSection: "services",
    category: "Feature",
    tags: ["cards", "split-media", "media-right"],
    layoutSketch:
      "2×2 service cards left, cropped Media right (aspect-square / object-cover); do not reserve a min-height image column; images only from props.media; N cards when N services exist",
    layoutFamily: "split-media",
    requiresMedia: true,
    upstream: `${MERAKI}:components/features/GridListWithImage.html`,
  },
];

const GALLERY: NamedLayoutEntry[] = [
  {
    id: "hyperui/gallery/header-left-image-grid",
    title: "Header left, image grid",
    source: "hyperui",
    canonicalSection: "beforeAfter",
    category: "Galleries",
    tags: ["gallery", "grid", "header-left"],
    layoutSketch: "heading-left, 4-col Media grid of project photos",
    layoutFamily: "grid",
    requiresMedia: true,
    upstream: `${HYPERUI}:public/examples/marketing/product-collections/1.html`,
  },
  {
    id: "hyperui/gallery/centered-header-image-grid",
    title: "Centered header, image grid",
    source: "hyperui",
    canonicalSection: "beforeAfter",
    category: "Galleries",
    tags: ["gallery", "grid", "centered"],
    layoutSketch: "heading-center, 4-col Media grid",
    layoutFamily: "grid",
    requiresMedia: true,
    upstream: `${HYPERUI}:public/examples/marketing/product-collections/2.html`,
  },
  {
    id: "hyperui/gallery/captioned-project-grid",
    title: "Captioned project cards",
    source: "hyperui",
    canonicalSection: "beforeAfter",
    category: "Galleries",
    tags: ["gallery", "cards", "captions"],
    layoutSketch: "heading, 3-col Grid of Media+caption Card",
    layoutFamily: "grid",
    requiresMedia: true,
    upstream: `${HYPERUI}:public/examples/marketing/product-collections/3.html`,
  },
  {
    id: "hyperui/gallery/featured-then-grid",
    title: "Featured shot then grid",
    source: "hyperui",
    canonicalSection: "beforeAfter",
    category: "Galleries",
    tags: ["gallery", "featured", "grid"],
    layoutSketch:
      "featured Media is media[0], then remaining photos in Grid (MediaGallery excludeFirst); omit View all unless a real in-page target",
    layoutFamily: "featured",
    requiresMedia: true,
    upstream: `${HYPERUI}:public/examples/marketing/product-collections/4.html`,
  },
  {
    id: "tailblocks/gallery/mosaic-two-col",
    title: "Two-column mosaic",
    source: "tailblocks",
    canonicalSection: "beforeAfter",
    category: "Galleries",
    tags: ["gallery", "mosaic", "two-column"],
    layoutSketch:
      "heading+body above, two columns of mixed-size Media (mosaic, not equal 3-col); crop with aspect-* / object-cover; do not use h-full min-height image columns; images only from props.media",
    layoutFamily: "mosaic",
    requiresMedia: true,
    requires: { media: 2 },
    upstream: `${TAILBLOCKS}:src/blocks/gallery/light/a.js`,
  },
];

const REVIEWS: NamedLayoutEntry[] = [
  {
    id: "hyperui/reviews/three-col-quote-cards",
    title: "Three-column quote cards",
    source: "hyperui",
    canonicalSection: "reviews",
    category: "Testimonials",
    tags: ["quotes", "cards", "three-column"],
    layoutSketch: "heading, 3-col Grid of Quote cards (quote, name, role)",
    layoutFamily: "cards",
    requiresMedia: false,
    requires: { quotes: 3 },
    upstream: `${MERAKI}:components/testimonials/Card.html`,
  },
  {
    id: "hyperui/reviews/two-col-quote-cards",
    title: "Two-column quote cards",
    source: "hyperui",
    canonicalSection: "reviews",
    category: "Testimonials",
    tags: ["quotes", "cards", "two-column"],
    layoutSketch:
      "heading, 2-col Grid of Quote cards when 2 quotes exist; fewer items → fewer columns or a stack",
    layoutFamily: "cards",
    requiresMedia: false,
    requires: { quotes: 2 },
    upstream: `${MERAKI}:components/testimonials/FullPageCards.html`,
  },
  {
    id: "hyperui/reviews/compact-quote-row",
    title: "Compact quote row",
    source: "hyperui",
    canonicalSection: "reviews",
    category: "Testimonials",
    tags: ["quotes", "row", "compact"],
    layoutSketch: "heading-center, row of compact Quote (name + quote)",
    layoutFamily: "grid",
    requiresMedia: false,
    upstream: `${MERAKI}:components/testimonials/Centered.html`,
  },
  {
    id: "hyperui/reviews/featured-quote",
    title: "Featured single quote",
    source: "hyperui",
    canonicalSection: "reviews",
    category: "Testimonials",
    tags: ["quote", "featured", "single"],
    layoutSketch: "one large Quote, name+role below",
    layoutFamily: "featured",
    requiresMedia: false,
    upstream: `${MERAKI}:components/testimonials/Single.html`,
  },
  {
    id: "hyperui/reviews/stacked-quote-list",
    title: "Stacked quote list",
    source: "hyperui",
    canonicalSection: "reviews",
    category: "Testimonials",
    tags: ["quotes", "stack", "list"],
    layoutSketch: "heading-left, stacked Quote blocks",
    layoutFamily: "rows",
    requiresMedia: false,
    upstream: `${MERAKI}:components/testimonials/Centered2.html`,
  },
];

const FOOTERS: NamedLayoutEntry[] = [
  {
    id: "hyperui/footer/brand-left-links-right",
    title: "Brand left, link columns right",
    source: "hyperui",
    canonicalSection: "footer",
    category: "Footers",
    tags: ["footer", "columns", "brand-left"],
    layoutSketch: "brand+blurb-left, 2-col link lists, legal bar below",
    layoutFamily: "rows",
    requiresMedia: false,
    upstream: `${HYPERUI}:public/examples/marketing/footers/2.html`,
  },
  {
    id: "hyperui/footer/stacked-brand-nav-legal",
    title: "Stacked brand, nav, legal",
    source: "hyperui",
    canonicalSection: "footer",
    category: "Footers",
    tags: ["footer", "stacked", "simple"],
    layoutSketch: "brand, then nav row, then legal — single column",
    layoutFamily: "type-only",
    requiresMedia: false,
    upstream: `${HYPERUI}:public/examples/marketing/footers/5.html`,
  },
  {
    id: "hyperui/footer/four-col-link-columns",
    title: "Four-column link footer",
    source: "hyperui",
    canonicalSection: "footer",
    category: "Footers",
    tags: ["footer", "columns", "dense"],
    layoutSketch: "4-col Grid of heading+link lists, legal bar",
    layoutFamily: "grid",
    requiresMedia: false,
    requires: { anchors: 4 },
    upstream: `${HYPERUI}:public/examples/marketing/footers/1.html`,
  },
  {
    id: "hyperui/footer/brand-plus-legal-bar",
    title: "Brand plus legal bar",
    source: "hyperui",
    canonicalSection: "footer",
    category: "Footers",
    tags: ["footer", "minimal", "bar"],
    layoutSketch: "one row: brand left, legal right",
    layoutFamily: "type-only",
    requiresMedia: false,
    upstream: `${HYPERUI}:public/examples/marketing/footers/4.html`,
  },
];

export const NAMED_LAYOUTS: NamedLayoutEntry[] = [
  ...HERO,
  ...SERVICES,
  ...GALLERY,
  ...REVIEWS,
  ...FOOTERS,
];

export const NAMED_LAYOUT_BY_ID = new Map(NAMED_LAYOUTS.map((entry) => [entry.id, entry]));

/** The executable registry is the authority for refs that may become NamedLayout. */
export function executableNamedLayoutForSection(
  section: NamedLayoutSection,
  catalogRef: unknown,
): NamedLayoutEntry | null {
  if (typeof catalogRef !== "string") return null;
  const entry = NAMED_LAYOUT_BY_ID.get(catalogRef);
  return entry?.canonicalSection === section ? entry : null;
}

/** Historical runtime compatibility: missing/invalid refs retain the section's fallback. */
export function resolveNamedLayoutCatalogId(
  section: NamedLayoutSection,
  catalogRef: unknown,
  fallback: string,
): string {
  return executableNamedLayoutForSection(section, catalogRef)?.id ?? fallback;
}
