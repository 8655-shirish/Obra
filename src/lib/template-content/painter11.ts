import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter11 ("Vaporwave Paint Supply") overlay manifest (pilot).
 *
 * Covers the slots Step 1 and edit-mode may fill. Deliberately excluded:
 * - hero/first-fold motion (brand identity; locked by plan §7.2 media rules),
 * - proof before/after pair (matched-camera integrity),
 * - shared process/plan copy decks (cross-template content),
 * - layout, order, styling (unreachable by construction).
 */

const EMPTY_IDENTITY = {
  businessName: null,
  licenseNumber: null,
  city: null,
  phone: null,
  email: null,
} as const;

const EMPTY_CONTACT = {
  phone: null,
  email: null,
  area: null,
  hours: null,
} as const;

function emptyOverlay(): TemplateOverlay {
  return {
    kind: "template",
    templateSlug: "painter11",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER11_MANIFEST: TemplateManifest = {
  slug: "painter11",
  textBudgets: {
    heroTitle: 70,
    heroSub: 240,
    servicesHeading: 80,
    servicesIntro: 240,
    proofTitle: 60,
    proofBody: 300,
    detailTitle: 60,
    detailBody: 300,
    reviewsHeading: 80,
    reviewsBody: 300,
    estimateTitle: 60,
    estimateIntro: 200,
    planHeading: 80,
    planIntro: 240,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "shadeImage1",
    "shadeImage2",
    "shadeImage3",
    "serviceImage1",
    "serviceImage2",
    "serviceImage3",
    "serviceImage4",
    "detailImage",
    "processImage1",
    "processImage2",
    "processImage3",
    "processImage4",
    "processImage5",
    "planningImage",
    "guideImage1",
    "guideImage2",
    "guideImage3",
    "reviewsImage",
    "estimateImage",
  ],
  defaultOverlay: emptyOverlay(),
  defaultBlogs: [
    {
      category: "Color notes",
      title: "Reading undertones in daylight",
      excerpt:
        "Why a swatch shifts from morning to evening — and how to test color on the actual wall before committing.",
      image: null,
    },
    {
      category: "Preparation guide",
      title: "What thorough masking includes",
      excerpt:
        "Clean lines start before the first coat: masking, patching, sanding, and the protection that keeps the rest of the house untouched.",
      image: null,
    },
    {
      category: "Finish guide",
      title: "Matte, eggshell, satin, semi-gloss",
      excerpt:
        "How sheen changes durability, washability, and the way light moves across a wall — room by room.",
      image: null,
    },
  ],
};
