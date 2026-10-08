import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter4 ("True Coat Colorbook") overlay manifest.
 *
 * Deliberately excluded: hero/first-fold motion, the clean-edge craft study,
 * the matched-camera before/after pair, the four surface-study cards, and the
 * five-step preparation contact sheet (process deck imagery).
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
    templateSlug: "painter4",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER4_MANIFEST: TemplateManifest = {
  slug: "painter4",
  textBudgets: {
    heroTitle: 60,
    heroSub: 150,
    detailTitle: 70,
    servicesHeading: 50,
    servicesIntro: 180,
    processHeading: 60,
    processIntro: 130,
    proofTitle: 60,
    proofBody: 220,
    planHeading: 40,
    planIntro: 140,
    reviewsHeading: 50,
    reviewsBody: 280,
    faqTitle: 40,
    estimateTitle: 50,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "cleanEdgeImage",
    "servicesImage",
    "surfaceImage1",
    "surfaceImage2",
    "surfaceImage3",
    "surfaceImage4",
    "processImage1",
    "processImage2",
    "processImage3",
    "processImage4",
    "processImage5",
    "planningImage",
    "sheenImage",
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
