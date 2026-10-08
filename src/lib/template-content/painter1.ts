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
    templateSlug: "painter1",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER1_MANIFEST: TemplateManifest = {
  slug: "painter1",
  textBudgets: {
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 150,
    detailTitle: 70,
    proofTitle: 60,
    proofBody: 220,
    servicesHeading: 50,
    servicesIntro: 180,
    processHeading: 60,
    processIntro: 130,
    reviewsHeading: 50,
    reviewsBody: 280,
    planHeading: 40,
    planIntro: 140,
    faqTitle: 40,
    estimateTitle: 50,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "proofImage",
    "serviceImage0",
    "serviceImage1",
    "serviceImage2",
    "serviceImage3",
    "processImage1",
    "processImage2",
    "processImage3",
    "processImage4",
    "processImage5",
    "notesImage0",
    "notesImage1",
  ],
  defaultOverlay: emptyOverlay(),
  defaultBlogs: [
    {
      category: "Color notes",
      title: "Testing swatches in real daylight",
      excerpt:
        "Why paint color shifts from morning to evening, and how to judge samples on the actual wall before deciding.",
      image: null,
    },
    {
      category: "Preparation guide",
      title: "What belongs in a written scope",
      excerpt:
        "Repairs, protection, coats, and exclusions — the details that keep a painting project predictable.",
      image: null,
    },
    {
      category: "Finish guide",
      title: "Choosing a sheen room by room",
      excerpt:
        "How matte, eggshell, satin, and semi-gloss balance durability, washability, and light.",
      image: null,
    },
  ],
};
