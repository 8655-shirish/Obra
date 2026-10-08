import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter7 ("True Coat — Ultraviolet finish lab") overlay manifest.
 *
 * Covers the slots Step 1 and edit-mode may fill. Deliberately excluded:
 * - hero/first-fold motion (brand identity; locked by plan §7.2 media rules),
 * - proof before/after pair (matched-camera integrity),
 * - pigment-bench lighting profiles (interactive workshop state),
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
    templateSlug: "painter7",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER7_MANIFEST: TemplateManifest = {
  slug: "painter7",
  textBudgets: {
    heroTitle: 50,
    heroSub: 210,
    manifestoTitle: 70,
    servicesHeading: 60,
    servicesIntro: 240,
    calibrationTitle: 100,
    proofTitle: 70,
    proofBody: 270,
    processHeading: 80,
    processIntro: 210,
    planHeading: 80,
    planIntro: 170,
    reviewsHeading: 70,
    reviewsBody: 220,
    faqTitle: 50,
    journalTitle: 80,
    estimateTitle: 80,
    estimateIntro: 130,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "detailImage",
    "interiorImage",
    "calibrationImage",
    "serviceImage1",
    "serviceImage2",
    "serviceImage3",
    "serviceImage4",
    "processImage1",
    "processImage2",
    "processImage3",
    "processImage4",
    "processImage5",
    "planningImage",
    "reviewsImage",
    "faqImage",
    "estimateImage",
  ],
  defaultOverlay: emptyOverlay(),
  defaultBlogs: [
    {
      category: "Color planning",
      title: "How to test paint color before committing to a room",
      excerpt:
        "A practical three-step sample routine: place it beside fixed finishes, view it through the day, and compare it with the intended sheen before you choose.",
      image: null,
    },
    {
      category: "Preparation",
      title: "What a thorough paint-prep plan should cover",
      excerpt:
        "From patching and sanding to protection, priming, and edge work, these are the questions that make a painting proposal easier to compare.",
      image: null,
    },
    {
      category: "Finish guide",
      title: "Matte, eggshell, satin, or semi-gloss: choosing a sheen",
      excerpt:
        "Use light, traffic, cleanability, wall condition, and adjacent trim to choose a finish that feels right after the paint has cured.",
      image: null,
    },
  ],
};
