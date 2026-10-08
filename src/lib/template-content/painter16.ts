import type { TemplateManifest, TemplateOverlay } from "./overlay";

/**
 * Painter16 ("Ink Wash") overlay manifest.
 *
 * Covers the slots Step 1 and edit-mode may fill. Deliberately excluded:
 * - hero/first-fold motion (brand identity; locked by plan §7.2 media rules),
 * - the one-stroke brushwork study (matched-frame reveal),
 * - surface picker button labels and dialog/planner copy (structural),
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
    templateSlug: "painter16",
    identity: { ...EMPTY_IDENTITY },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { ...EMPTY_CONTACT },
  };
}

export const PAINTER16_MANIFEST: TemplateManifest = {
  slug: "painter16",
  textBudgets: {
    heroTitle: 40,
    heroAccent: 40,
    heroSub: 120,
    servicesHeading: 40,
    surface1Detail: 40,
    surface1Text: 150,
    surface2Detail: 40,
    surface2Text: 190,
    surface3Detail: 40,
    surface3Text: 180,
    surface4Detail: 40,
    surface4Text: 170,
    detailTitle: 40,
    detailBody: 120,
    journalTitle: 60,
    planHeading: 40,
    planIntro: 130,
  },
  mediaSlots: [
    "logo",
    "heroPoster",
    "surfaceImage1",
    "surfaceImage2",
    "surfaceImage3",
    "surfaceImage4",
    "strokeImage",
    "planningImage",
    "guideImage1",
    "guideImage2",
    "guideImage3",
  ],
  defaultOverlay: emptyOverlay(),
  defaultBlogs: [
    {
      category: "Colour",
      title: "Colour beside timber",
      excerpt:
        "Oak, cedar and changing daylight all influence a painted wall. Judge the relationship, not a small swatch in isolation.",
      image: null,
    },
    {
      category: "Preparation",
      title: "Before the first stroke",
      excerpt:
        "A clean painted edge begins with the surface beneath it and a clear agreement about what needs attention.",
      image: null,
    },
    {
      category: "Finish",
      title: "Let the light choose",
      excerpt:
        "Matte, eggshell and satin are starting points, not universal specifications. The room and the actual product matter more than the name.",
      image: null,
    },
  ],
};
