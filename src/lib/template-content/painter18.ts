import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter18 ("Lavender Estate") overlay manifest.
 *
 * Covers the slots Step 1 and edit-mode may fill. Deliberately excluded:
 * - hero/first-fold motion (brand identity; locked by plan §7.2 media rules),
 * - the wallpaper peel study (matched-frame interactive pair),
 * - room card labels and dialog/planner copy (structural),
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
    templateSlug: "painter18",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER18_MANIFEST: TemplateManifest = {
  slug: "painter18",
  textBudgets: {
    heroTagline: 60,
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 130,
    heroCaption: 120,
    servicesHeading: 60,
    servicesIntro: 120,
    colourTitle: 50,
    detailTitle: 60,
    detailBody: 120,
    journalTitle: 40,
    journalIntro: 70,
    planHeading: 40,
    planIntro: 120,
    footerBlurb: 120,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "roomImage1",
    "roomImage2",
    "roomImage3",
    "roomImage4",
    "preparationImage",
    "prepNotesImage",
    "planningImage",
    "guideImage1",
    "guideImage2",
    "guideImage3",
  ],
  defaultOverlay: emptyOverlay(),
  defaultBlogs: [
    {
      category: "Colour, in context",
      title: "Live with a colour before you choose it.",
      excerpt:
        "Use a large loose board and the intended paint system, rather than a collection of small patches scattered across the wall. Place it beside the flooring, fabrics and trim that will remain.",
      image: null,
    },
    {
      category: "Before the brush",
      title: "The finish begins with the preparation.",
      excerpt:
        "Note peeling, stains, cracks, loose joints and signs of moisture before comparing paint proposals. The cause of a defect matters as much as the visible repair.",
      image: null,
    },
    {
      category: "A matter of finish",
      title: "A softer wall. A little light on the trim.",
      excerpt:
        "Lower-sheen finishes diffuse light and can make a wall feel quieter. More reflective finishes bring attention to profiles, but can also reveal dents, patches and surface texture.",
      image: null,
    },
  ],
};
