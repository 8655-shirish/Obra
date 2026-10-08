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
    templateSlug: "landscape",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const LANDSCAPE_MANIFEST: TemplateManifest = {
  slug: "landscape",
  textBudgets: {
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 220,
    philosophyTitle: 70,
    philosophyAccent: 40,
    philosophyBody: 230,
    servicesHeading: 40,
    servicesIntro: 140,
    proofTitle: 40,
    proofAccent: 40,
    proofBody: 190,
    reviewsHeading: 40,
    reviewsAccent: 40,
    journalHeading: 40,
    faqTitle: 40,
    faqAccent: 40,
    faqBody: 140,
    ctaTitle: 40,
    ctaAccent: 40,
    ctaBody: 160,
    footerBlurb: 130,
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
      category: "Garden notes",
      title: "A quieter, greener front garden",
      excerpt:
        "How layered planting and a restrained palette turn a front yard into a garden that feels established.",
      image: null,
    },
    {
      category: "Design guide",
      title: "Five layers of a drought-wise landscape",
      excerpt:
        "From soil preparation to plant palette, the structure that keeps a water-wise garden looking abundant.",
      image: null,
    },
    {
      category: "Planting",
      title: "What to plant for every season",
      excerpt:
        "A simple framework for choosing plants so something is always emerging, blooming, or resting well.",
      image: null,
    },
  ],
};
