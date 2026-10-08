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
    templateSlug: "painter13",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER13_MANIFEST: TemplateManifest = {
  slug: "painter13",
  textBudgets: {
    heroTitle: 70,
    heroSub: 230,
    introTitle: 60,
    introBody: 300,
    servicesHeading: 70,
    servicesIntro: 240,
    proofTitle: 60,
    proofBody: 240,
    methodTitle: 80,
    planHeading: 80,
    planIntro: 170,
    notesHeading: 60,
    notesIntro: 140,
    reviewsHeading: 40,
    reviewsBody: 170,
    faqTitle: 40,
    estimateTitle: 80,
    estimateIntro: 170,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "introImage",
    "serviceImage1",
    "serviceImage2",
    "serviceImage3",
    "serviceImage4",
    "ceramicImage",
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
