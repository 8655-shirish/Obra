import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter12 ("Lemonade Stand") overlay manifest.
 *
 * Covers the slots Step 1 and edit-mode may fill. Deliberately excluded:
 * - hero/first-fold motion (brand identity; locked by plan §7.2 media rules),
 * - proof before/after pairs and project postcards (matched-camera integrity),
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
    templateSlug: "painter12",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER12_MANIFEST: TemplateManifest = {
  slug: "painter12",
  textBudgets: {
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 220,
    streetTitle: 70,
    streetIntro: 180,
    servicesHeading: 80,
    servicesIntro: 240,
    proofTitle: 70,
    proofBody: 220,
    processTitle: 70,
    processIntro: 210,
    planHeading: 80,
    planIntro: 170,
    journalTitle: 80,
    journalIntro: 150,
    reviewsHeading: 90,
    faqTitle: 60,
    estimateTitle: 80,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "streetImage",
    "serviceImage1",
    "serviceImage2",
    "serviceImage3",
    "accentImage",
    "processImage",
    "planningImage",
    "guideImage1",
    "guideImage2",
    "guideImage3",
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
