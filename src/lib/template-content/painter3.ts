import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter3 ("True Coat Spectrum") overlay manifest.
 *
 * Deliberately excluded: hero/first-fold room image and lacquer film, the
 * color-direction proof pair, the stacked service-card imagery, and the
 * method craft detail (brand-identity media).
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
    templateSlug: "painter3",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER3_MANIFEST: TemplateManifest = {
  slug: "painter3",
  textBudgets: {
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 200,
    proofTitle: 40,
    proofAccent: 40,
    proofBody: 230,
    colorTitle: 40,
    colorAccent: 40,
    colorBody: 220,
    servicesHeading: 40,
    servicesIntro: 150,
    methodTitle: 40,
    methodAccent: 40,
    reviewsHeading: 50,
    reviewsBody: 230,
    faqTitle: 40,
    faqAccent: 40,
    notesHeading: 40,
    estimateTitle: 40,
    estimateAccent: 40,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "heroRoom",
    "colorImage",
    "sheenImage",
    "methodImage",
    "serviceImage0",
    "serviceImage1",
    "serviceImage2",
    "estimateImage",
    "noteImage0",
    "noteImage1",
    "noteImage2",
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
