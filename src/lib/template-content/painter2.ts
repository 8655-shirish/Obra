import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter2 ("True Coat Orbit") overlay manifest.
 *
 * Deliberately excluded: hero/first-fold motion, the matched-frame
 * before/after comparison, the interactive service-tab imagery, and the
 * process phase deck (cross-template content).
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
    templateSlug: "painter2",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER2_MANIFEST: TemplateManifest = {
  slug: "painter2",
  textBudgets: {
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 200,
    servicesHeading: 40,
    servicesAccent: 40,
    methodHeading: 50,
    methodIntro: 200,
    proofTitle: 40,
    proofAccent: 40,
    proofBody: 210,
    reviewsHeading: 50,
    reviewsBody: 270,
    planHeading: 50,
    faqTitle: 50,
    faqIntro: 220,
    ctaTitle: 40,
    ctaBody: 260,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "serviceImage0",
    "serviceImage1",
    "serviceImage2",
    "methodImage",
    "planImage",
    "journalImage0",
    "journalImage1",
    "journalImage2",
    "ctaImage",
  ],
  defaultOverlay: emptyOverlay(),
  defaultBlogs: [
    {
      category: "Color notes",
      title: "How undertones change in daylight",
      excerpt:
        "Why a swatch shifts from morning to evening — and how to read undertones on the actual wall before committing.",
      image: null,
    },
    {
      category: "Preparation guide",
      title: "What thorough surface preparation includes",
      excerpt:
        "Clean lines start before the first coat: repairs, masking, sanding, priming, and the protection that keeps the rest of the home untouched.",
      image: null,
    },
    {
      category: "Finish guide",
      title: "Where matte, eggshell, and satin fit",
      excerpt:
        "How sheen changes durability, washability, and the way light moves across a wall — room by room.",
      image: null,
    },
  ],
};
