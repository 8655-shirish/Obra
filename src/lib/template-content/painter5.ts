import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter5 ("True Coat — California house issue") overlay manifest.
 *
 * Covers the slots Step 1 and edit-mode may fill. Deliberately excluded:
 * - hero/first-fold motion (brand identity; locked by plan §7.2 media rules),
 * - proof before/after pair (matched-camera integrity),
 * - facade-lab scheme imagery (paired with fixed palette tokens),
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
    templateSlug: "painter5",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER5_MANIFEST: TemplateManifest = {
  slug: "painter5",
  textBudgets: {
    heroTitle: 60,
    heroSub: 150,
    introTagline: 120,
    servicesHeading: 60,
    labHeading: 60,
    labIntro: 120,
    proofTitle: 70,
    processHeading: 80,
    processIntro: 210,
    planHeading: 80,
    reviewsHeading: 70,
    reviewsBody: 220,
    faqTitle: 80,
    estimateTitle: 80,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "galleryImage",
    "trimImage",
    "interiorImage",
    "schemeImage1",
    "schemeImage2",
    "schemeImage3",
    "schemeImage4",
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
