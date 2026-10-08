import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter17 ("Alpine Enamel") overlay manifest.
 *
 * Covers the slots Step 1 and edit-mode may fill. Deliberately excluded:
 * - hero/first-fold motion and the cranberry/pine study pair (brand identity
 *   and matched-subject integrity; locked by plan §7.2 media rules),
 * - dialog/planner copy and FAQ answers (structural),
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
    templateSlug: "painter17",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER17_MANIFEST: TemplateManifest = {
  slug: "painter17",
  textBudgets: {
    heroTagline: 50,
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 120,
    studiesTitle: 40,
    detailTitle: 40,
    detailBody: 120,
    journalTitle: 40,
    journalIntro: 70,
    planHeading: 40,
    planIntro: 120,
    footerBlurb: 40,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "pineCabin",
    "detailImage",
    "planningImage",
    "guideImage1",
    "guideImage2",
    "guideImage3",
  ],
  defaultOverlay: emptyOverlay(),
  defaultBlogs: [
    {
      category: "Colour / daylight",
      title: "Let the mountain light have a say.",
      excerpt:
        "A cabin colour has more neighbours than its trim. The roof, timber door, gravel and evergreens all change how a painted surface reads.",
      image: null,
    },
    {
      category: "Preparation / weather",
      title: "A dry day is only half the story.",
      excerpt:
        "Dry-looking siding can still hold moisture. A useful painting window considers the timber, surface temperature and the hours after application, not just the afternoon forecast.",
      image: null,
    },
    {
      category: "Materials / maintenance",
      title: "Look after the board beneath the colour.",
      excerpt:
        "A clean paint line is the visible part. Coating compatibility, sound timber and careful preparation are what make the next maintenance visit easier to plan.",
      image: null,
    },
  ],
};
