import { z } from "zod";

import { LANDSCAPE_MANIFEST } from "./landscape";
import { PAINTER_MANIFEST } from "./painter";
import { PAINTER1_MANIFEST } from "./painter1";
import { PAINTER2_MANIFEST } from "./painter2";
import { PAINTER3_MANIFEST } from "./painter3";
import { PAINTER4_MANIFEST } from "./painter4";
import { PAINTER5_MANIFEST } from "./painter5";
import { PAINTER6_MANIFEST } from "./painter6";
import { PAINTER7_MANIFEST } from "./painter7";
import { PAINTER8_MANIFEST } from "./painter8";
import { PAINTER10_MANIFEST } from "./painter10";
import { PAINTER11_MANIFEST } from "./painter11";
import { PAINTER12_MANIFEST } from "./painter12";
import { PAINTER13_MANIFEST } from "./painter13";
import { PAINTER14_MANIFEST } from "./painter14";
import { PAINTER15_MANIFEST } from "./painter15";
import { PAINTER16_MANIFEST } from "./painter16";
import { PAINTER17_MANIFEST } from "./painter17";
import { PAINTER18_MANIFEST } from "./painter18";
import { PLUMBER_MANIFEST } from "./plumber";

/**
 * Template-overlay contract (plan/template-purchase.md §4).
 *
 * Purchased templates are static molds. Per-user content lives in a
 * `website_versions.config_json` overlay beside the mold — never in layout,
 * CSS, or component structure. Missing keys fall back to the template's
 * static defaults at render time, so a sparse overlay is always complete.
 */

export const TEMPLATE_PURCHASE_SLUGS = [
  "landscape",
  "plumber",
  "painter",
  "painter2",
  "painter3",
  "painter4",
  "painter5",
  "painter6",
  "painter7",
  "painter8",
  "painter1",
  "painter10",
  "painter11",
  "painter12",
  "painter13",
  "painter14",
  "painter15",
  "painter16",
  "painter17",
  "painter18",
] as const;

export type TemplatePurchaseSlug = (typeof TEMPLATE_PURCHASE_SLUGS)[number];

/**
 * Canonical template identity (plan: purchase identity). Opaque `tpl_*` ids
 * are assigned once and never renamed — unlike route slugs, which are
 * presentational and may change. The purchase flow (dialog → checkout
 * session → website) speaks ids; the overlay mold key stays a slug and the
 * registry below translates at that single seam. Slugs remain dual-written
 * until the phase-2 removal once template_id is applied everywhere.
 */
export const TEMPLATE_IDS = [
  "tpl_landscape",
  "tpl_plumber",
  "tpl_painter",
  "tpl_painter2",
  "tpl_painter3",
  "tpl_painter4",
  "tpl_painter5",
  "tpl_painter6",
  "tpl_painter7",
  "tpl_painter8",
  "tpl_painter1",
  "tpl_painter10",
  "tpl_painter11",
  "tpl_painter12",
  "tpl_painter13",
  "tpl_painter14",
  "tpl_painter15",
  "tpl_painter16",
  "tpl_painter17",
  "tpl_painter18",
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

const TEMPLATE_ID_BY_SLUG: Record<string, TemplateId> = {
  landscape: "tpl_landscape",
  plumber: "tpl_plumber",
  painter: "tpl_painter",
  painter2: "tpl_painter2",
  painter3: "tpl_painter3",
  painter4: "tpl_painter4",
  painter5: "tpl_painter5",
  painter6: "tpl_painter6",
  painter7: "tpl_painter7",
  painter8: "tpl_painter8",
  painter1: "tpl_painter1",
  painter10: "tpl_painter10",
  painter11: "tpl_painter11",
  painter12: "tpl_painter12",
  painter13: "tpl_painter13",
  painter14: "tpl_painter14",
  painter15: "tpl_painter15",
  painter16: "tpl_painter16",
  painter17: "tpl_painter17",
  painter18: "tpl_painter18",
};

const TEMPLATE_SLUG_BY_ID: Record<string, TemplatePurchaseSlug> = {
  tpl_landscape: "landscape",
  tpl_plumber: "plumber",
  tpl_painter: "painter",
  tpl_painter2: "painter2",
  tpl_painter3: "painter3",
  tpl_painter4: "painter4",
  tpl_painter5: "painter5",
  tpl_painter6: "painter6",
  tpl_painter7: "painter7",
  tpl_painter8: "painter8",
  tpl_painter1: "painter1",
  tpl_painter10: "painter10",
  tpl_painter11: "painter11",
  tpl_painter12: "painter12",
  tpl_painter13: "painter13",
  tpl_painter14: "painter14",
  tpl_painter15: "painter15",
  tpl_painter16: "painter16",
  tpl_painter17: "painter17",
  tpl_painter18: "painter18",
};

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && (TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Canonical id for a purchase slug; unknown slugs stay unknown (never guessed). */
export function templateIdForSlug(slug: string): TemplateId | null {
  return TEMPLATE_ID_BY_SLUG[slug] ?? null;
}

/** Mold slug for a canonical id; unknown ids stay unknown (never guessed). */
export function templateSlugForId(id: string): TemplatePurchaseSlug | null {
  return TEMPLATE_SLUG_BY_ID[id] ?? null;
}

/**
 * Resolves purchase intent from either key. Canonical id wins on
 * disagreement; a lone slug resolves through the registry (covers callers
 * that predate ids). Unknown values resolve null — callers fail loud, never
 * guess, never fall back to a different template.
 */
export function resolveTemplatePurchaseIdentity(
  slug: unknown,
  id: unknown,
): { id: TemplateId; slug: TemplatePurchaseSlug } | null {
  if (typeof id === "string" && isTemplateId(id)) {
    const slugForId = templateSlugForId(id);
    if (slugForId) return { id, slug: slugForId };
  }
  if (typeof slug === "string" && isTemplatePurchaseSlug(slug)) {
    const idForSlug = templateIdForSlug(slug);
    if (idForSlug) return { id: idForSlug, slug };
  }
  return null;
}

export function isTemplatePurchaseSlug(value: unknown): value is TemplatePurchaseSlug {
  return (
    typeof value === "string" && (TEMPLATE_PURCHASE_SLUGS as readonly string[]).includes(value)
  );
}

/** Loose wire format: lowercase slug segments only. Registry check happens separately. */
export const templateSlugInput = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/);

const overlayReviewSchema = z.object({
  quote: z.string(),
  author: z.string(),
  /** Null once the words are the contractor's own; non-null keeps sample attribution. */
  attribution: z.string().nullable(),
});

const overlayBlogSchema = z.object({
  category: z.string(),
  title: z.string(),
  excerpt: z.string(),
  /** site-media storage path, or null to keep template art. */
  image: z.string().nullable(),
});

export const templateOverlaySchema = z.object({
  kind: z.literal("template"),
  templateSlug: z.string(),
  identity: z.object({
    businessName: z.string().nullable(),
    licenseNumber: z.string().nullable(),
    city: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  text: z.record(z.string(), z.string()),
  media: z.record(z.string(), z.string()),
  reviews: z.array(overlayReviewSchema),
  blogs: z.array(overlayBlogSchema),
  contact: z.object({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    area: z.string().nullable(),
    hours: z.string().nullable(),
  }),
});

export type TemplateOverlay = z.infer<typeof templateOverlaySchema>;

export interface TemplateManifest {
  slug: TemplatePurchaseSlug;
  /** Overlay text key → max characters (layout budgets; renderer truncates, validator rejects over). */
  textBudgets: Record<string, number>;
  /** Overlay media keys the renderer reads. First-fold/hero motion is never a key. */
  mediaSlots: string[];
  defaultOverlay: TemplateOverlay;
  /** Checked-in starter posts (workstream B); Step 1 personalizes wording, never invents. */
  defaultBlogs: { category: string; title: string; excerpt: string; image: null }[];
}

/** Every purchasable slug has a manifest — the Record type fails compilation otherwise. */
const TEMPLATE_MANIFESTS: Record<TemplatePurchaseSlug, TemplateManifest> = {
  landscape: LANDSCAPE_MANIFEST,
  plumber: PLUMBER_MANIFEST,
  painter: PAINTER_MANIFEST,
  painter2: PAINTER2_MANIFEST,
  painter3: PAINTER3_MANIFEST,
  painter4: PAINTER4_MANIFEST,
  painter5: PAINTER5_MANIFEST,
  painter6: PAINTER6_MANIFEST,
  painter7: PAINTER7_MANIFEST,
  painter8: PAINTER8_MANIFEST,
  painter1: PAINTER1_MANIFEST,
  painter10: PAINTER10_MANIFEST,
  painter11: PAINTER11_MANIFEST,
  painter12: PAINTER12_MANIFEST,
  painter13: PAINTER13_MANIFEST,
  painter14: PAINTER14_MANIFEST,
  painter15: PAINTER15_MANIFEST,
  painter16: PAINTER16_MANIFEST,
  painter17: PAINTER17_MANIFEST,
  painter18: PAINTER18_MANIFEST,
};

export function getTemplateManifest(slug: string): TemplateManifest | null {
  if (!isTemplatePurchaseSlug(slug)) return null;
  return TEMPLATE_MANIFESTS[slug];
}

/** Manifest lookup by canonical id (purchase flow); unwired molds resolve null. */
export function getTemplateManifestById(id: string): TemplateManifest | null {
  const slug = templateSlugForId(id);
  return slug ? getTemplateManifest(slug) : null;
}

/**
 * Renderable content for any wired mold. Text stays keyed by manifest slot
 * (matching data-tkey="text.<key>"); identity/contact/media/blogs/reviews are
 * schema-level. Absent text keys render the mold's demo copy (catalog view).
 */
export interface TemplateMoldContent {
  text: Record<string, string | undefined>;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  media: Record<string, string>;
  blogs?: { category: string; title: string; excerpt: string }[];
  reviews?: { quote: string; author: string; attribution: string | null }[];
}

export type TemplateBlogPost = NonNullable<TemplateMoldContent["blogs"]>[number];

export function overlayMediaUrl(
  content: TemplateMoldContent | undefined,
  slot: string,
  fallback: string,
): string {
  const url = content?.media?.[slot];
  return typeof url === "string" && url.trim() ? url : fallback;
}

export function overlayLogoUrl(content: TemplateMoldContent | undefined): string | null {
  const url = content?.media?.logo;
  return typeof url === "string" && url.trim() ? url : null;
}

/** True when this mold renders overlay reviews (heading slots or a reviews still). */
export function manifestHasReviewSection(manifest: TemplateManifest): boolean {
  const keys = Object.keys(manifest.textBudgets);
  if (
    keys.includes("reviewsHeading") ||
    keys.includes("reviewsTitle") ||
    keys.includes("reviewsBody")
  ) {
    return true;
  }
  return manifest.mediaSlots.includes("reviewsImage");
}

/**
 * Catalog (no overlay) → null, so the mold keeps demo samples.
 * Purchased → the overlay list, including empty (hide sample quotes/badges).
 */
export function purchasedReviewList(
  content: TemplateMoldContent | undefined,
): NonNullable<TemplateMoldContent["reviews"]> | null {
  if (!content) return null;
  return content.reviews ?? [];
}

/**
 * Field-note cards and the dialog they open must be the same post.
 * Overlay blogs carry category/title/excerpt only — those replace the
 * static identity, and excerpt is the opened body. Catalog (no overlay
 * post) keeps the mold's long-form article.
 */
export function withOverlayBlogPost<
  T extends {
    category: string;
    title: string;
    excerpt?: string;
    intro?: string;
    sections?: readonly unknown[];
    body?: readonly string[];
    takeaway?: string;
  },
>(article: T, overlayPost: TemplateBlogPost | undefined): T {
  if (!overlayPost) return article;
  const category = overlayPost.category.trim() || article.category;
  const title = overlayPost.title.trim() || article.title;
  const excerpt = overlayPost.excerpt.trim();
  return {
    ...article,
    category,
    title,
    ...(article.excerpt !== undefined ? { excerpt: excerpt || article.excerpt } : null),
    ...(excerpt && article.intro !== undefined ? { intro: excerpt } : null),
    ...(excerpt && article.sections !== undefined ? { sections: [] } : null),
    ...(excerpt && article.body !== undefined ? { body: [excerpt] } : null),
    ...(excerpt && article.takeaway !== undefined ? { takeaway: "" } : null),
  } as T;
}

/**
 * Single overlay → mold-content derivation for every wired template. The
 * manifest's textBudgets are the slot list, so a new mold needs no per-mold
 * adapter. Returns null for unwired molds so callers fail closed.
 */
export function buildTemplateMoldContent(
  overlay: TemplateOverlay,
  templateMedia: Record<string, string>,
): TemplateMoldContent | null {
  const manifest = getTemplateManifest(overlay.templateSlug);
  if (!manifest) return null;
  const text: Record<string, string | undefined> = {};
  for (const key of Object.keys(manifest.textBudgets)) {
    const value = overlay.text[key];
    text[key] = value && value.trim() ? value : undefined;
  }
  return {
    text,
    businessName: overlay.identity.businessName,
    phone: overlay.contact.phone,
    email: overlay.contact.email,
    media: templateMedia,
    blogs:
      overlay.blogs.length > 0
        ? overlay.blogs.map((post) => ({
            category: post.category,
            title: post.title,
            excerpt: post.excerpt,
          }))
        : undefined,
    reviews: overlay.reviews.length > 0 ? overlay.reviews : undefined,
  };
}
