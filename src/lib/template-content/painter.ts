import type { TemplateManifest, TemplateOverlay } from "./overlay";

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
    templateSlug: "painter",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER_MANIFEST: TemplateManifest = {
  slug: "painter",
  textBudgets: {
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 260,
    philosophyTitle: 70,
    philosophyAccent: 40,
    philosophyBody: 220,
    servicesHeading: 50,
    servicesIntro: 150,
    proofTitle: 40,
    proofAccent: 40,
    proofBody: 240,
    reviewsHeading: 40,
    reviewsAccent: 40,
    journalHeading: 40,
    faqTitle: 40,
    faqAccent: 40,
    faqBody: 190,
    ctaTitle: 40,
    ctaAccent: 40,
    ctaBody: 160,
    footerBlurb: 150,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "philosophyDetail",
    "philosophyCraft",
    "serviceImage0",
    "serviceImage1",
    "serviceImage2",
    "reviewImage0",
    "reviewImage1",
    "reviewImage2",
    "journalImage0",
    "journalImage1",
    "journalImage2",
  ],
  defaultOverlay: emptyOverlay(),
  defaultBlogs: [
    {
      category: "Color notes",
      title: "How undertones change in daylight",
      excerpt:
        "Why a swatch shifts from morning to evening — and how to test color on the actual wall before committing.",
      image: null,
    },
    {
      category: "Preparation guide",
      title: "What thorough surface preparation includes",
      excerpt:
        "Masking, patching, sanding, and protection — the work that keeps lines clean and the rest of the home untouched.",
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
