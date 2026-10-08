import {
  GACHA_FAMILIES,
  GACHA_PACK_VERSION,
  type GachaAspectRatio,
  type GachaFamily,
  type GachaFilterTag,
  type GachaLookAndFeel,
  type GachaPack,
  type GachaProofSlot,
} from "./gacha.ts";

/** Opening compositions. Not named-layout ids — the writer realizes these freely. */
export const HERO_TREATMENTS = [
  "billboard",
  "keyhole",
  "dock",
  "diptych",
  "triptych",
  "capstone",
  "inset",
  "spine",
  "chorus",
  "horizon",
  "fold",
  "specimen",
  "dispatch",
  "lantern",
  "cascade",
] as const;

export type GachaHeroTreatment = (typeof HERO_TREATMENTS)[number];

const DENSITIES = ["compact", "balanced", "spacious", "airy"] as const;
type GachaDensity = (typeof DENSITIES)[number];

const NO_CREW =
  " Empty of people. No crew, no impersonated job-site proof, no fake trucks, no readable signage.";

type HeroStill = GachaPack["mediaRecipe"]["atmosphereStills"][number];

type HeroProfile = {
  opening: string;
  mobile: string;
  minEvidenceStills: 0 | 1 | 2;
  proofSlots?: readonly GachaProofSlot[];
  extraTags: GachaFilterTag[];
  stills: (density: GachaDensity) => HeroStill[];
};

function still(
  slotId: string,
  role: HeroStill["role"],
  aspectRatio: GachaAspectRatio,
  cropGuidance: string,
  textOverlayAllowed: boolean,
  promptTemplate: string,
): HeroStill {
  return {
    slotId,
    role,
    aspectRatio,
    cropGuidance,
    textOverlayAllowed,
    promptTemplate: promptTemplate + NO_CREW,
  };
}

function withSupport(
  density: GachaDensity,
  lead: HeroStill[],
  support: HeroStill,
): HeroStill[] {
  if (density === "compact") return lead;
  return [...lead, support];
}

const HERO_PROFILES: Record<GachaHeroTreatment, HeroProfile> = {
  billboard: {
    opening:
      "Treat the first band as a roadside board: one oversized claim owns the field. Media is only a thin baseline strip under the type, never a poster behind words. Do not put copy on the photograph.",
    mobile:
      "Keep the giant claim; collapse the baseline strip under it. Do not restore a full-bleed photo behind type.",
    minEvidenceStills: 0,
    extraTags: ["bold"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "wide",
            "Thin horizon strip; keep a quiet ground plane; no faces or letters.",
            false,
            "Thin panoramic ground-plane still for a {{trade}} brand in {{city}}, like a baseline under a billboard, not a poster behind type. Quiet materials for {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "wide",
          "Even quieter material band for later sections.",
          false,
          "Secondary ground texture for a {{trade}} brand in {{city}}. Flat, wide, unused as a hero poster for {{businessName}}.",
        ),
      ),
  },
  keyhole: {
    opening:
      "Type lives in a narrow column. The only image is seen through a tight geometric aperture — circle, arch, or punched square — as if looking through a wall. Do not full-bleed the photograph.",
    mobile:
      "Keep the aperture crop small and centered or trailing the type; never expand it into a full-width poster.",
    minEvidenceStills: 0,
    extraTags: ["craft"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "square",
            "Center a circular or arched material fragment; generous unused field around it.",
            false,
            "Tightly cropped circular or arched fragment of material and light for a {{trade}} shop in {{city}}, as if seen through an aperture. For {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "square",
          "A second small aperture-like crop; not a second hero.",
          false,
          "Small square material fragment for a {{trade}} brand in {{city}}. Portal crop, not a landscape poster. {{businessName}}.",
        ),
      ),
  },
  dock: {
    opening:
      "The opening is a stage: atmosphere fills the upper field with no type on it. Identity, facts, and the quote action dock as a heavy bar along the bottom edge, like a control deck.",
    mobile:
      "Keep the dock as a solid block under a short atmosphere; do not sprinkle facts over the image.",
    minEvidenceStills: 0,
    extraTags: ["utilitarian"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "wide",
            "Empty upper stage; leave the lower third quiet so a dock can sit on it without type overlay.",
            false,
            "Wide empty stage of light and material for a {{trade}} brand in {{city}}, like a theater cyclorama. Lower third stays quiet for a dock. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "atmosphere",
          "landscape",
          "Quieter continuation of the stage, not a second poster.",
          false,
          "Quiet interior or material field for a {{trade}} brand in {{city}}. Stage lighting, no signage. {{businessName}}.",
        ),
      ),
  },
  diptych: {
    opening:
      "Two equal leaves share a center gutter, like an open book. One leaf is type only; the other is a single image. Neither leaf is wider. Do not use a 60/40 split or overlay.",
    mobile:
      "Stack the leaves in the same order, still equal. Do not turn the image leaf into a full-bleed banner.",
    minEvidenceStills: 0,
    extraTags: ["editorial"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "square",
            "One square leaf; even margins; no room reserved for type on the image.",
            false,
            "Square still meant to sit as one leaf of a diptych for a {{trade}} brand in {{city}}. Even, book-like, not cinematic widescreen. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "atmosphere",
          "square",
          "Optional later leaf; same square discipline.",
          false,
          "Second square leaf of material for a {{trade}} brand in {{city}}. Same book-page crop. {{businessName}}.",
        ),
      ),
  },
  triptych: {
    opening:
      "Three tall columns: identity, still, action. No element spans the full width of the first band. The photograph is a portrait panel, not a banner.",
    mobile:
      "Stack the three columns in that order. Do not merge them into one overlay poster.",
    minEvidenceStills: 0,
    extraTags: ["editorial"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "portrait",
            "Tall panel crop; keep vertical edges as the composition.",
            false,
            "Portrait panel of quiet architecture or material for a {{trade}} brand in {{city}}, meant to stand as the middle leaf of a triptych. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "atmosphere",
          "portrait",
          "A second tall panel for later use, not a wide hero.",
          false,
          "Second portrait material panel for a {{trade}} brand in {{city}}. Vertical, not panoramic. {{businessName}}.",
        ),
      ),
  },
  capstone: {
    opening:
      "Media is a heavy lintel across the top edge, like stone on a doorway. Name, offer, and actions hang from that lintel in a signboard band. Type does not sit inside the photograph.",
    mobile:
      "Keep the lintel as a short wide crop on top; hang the signboard under it. Do not overlay type on the lintel.",
    minEvidenceStills: 0,
    extraTags: ["bold"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "wide",
            "Heavy top lintel; architectural weight; no safe-area for type inside the crop.",
            false,
            "Wide architectural lintel still for a {{trade}} brand in {{city}}: cornice, beam, or heavy material spanning the top. Not a type-over-photo poster. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "wide",
          "Secondary lintel texture.",
          false,
          "Secondary wide material beam for a {{trade}} brand in {{city}}. {{businessName}}.",
        ),
      ),
  },
  inset: {
    opening:
      "The first band is a type field. The photograph is a small inset plate — like a captioned card dropped onto a page — occupying well under a third of the band. Opposite of full-bleed overlay.",
    mobile:
      "Keep the plate small under or beside the claim. Do not enlarge it to a header image.",
    minEvidenceStills: 0,
    extraTags: ["minimal"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "square",
            "Small plate; even borders; looks like a printed inset, not a hero banner.",
            false,
            "Small square printed-plate still of material and light for a {{trade}} brand in {{city}}, meant to inset on a type page, not bleed. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "square",
          "Even smaller plate for a later caption.",
          false,
          "Tiny material plate for a {{trade}} brand in {{city}}. Caption-card crop. {{businessName}}.",
        ),
      ),
  },
  spine: {
    opening:
      "A vertical structural rule runs the height of the opening. Small stacked crops climb that spine. Type occupies the remaining field. Not a gallery grid and not a two-column split.",
    mobile:
      "Keep the spine as a left rule; stack the small crops; type follows. Do not make a mosaic.",
    minEvidenceStills: 2,
    proofSlots: [
      {
        slotId: "spine-proof-1",
        aspectRatio: "portrait",
        cropGuidance: "Narrow stacked crop on the spine; finished work readable; no faces or signs.",
        minEvidence: 1,
        required: true,
      },
      {
        slotId: "spine-proof-2",
        aspectRatio: "portrait",
        cropGuidance: "Second narrow climb on the same spine.",
        minEvidence: 2,
        required: true,
      },
      {
        slotId: "spine-proof-3",
        aspectRatio: "portrait",
        cropGuidance: "Third climb; keep it smaller than the first two.",
        minEvidence: 3,
        required: false,
      },
    ],
    extraTags: ["photo-led", "editorial"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "atmosphere",
            "portrait",
            "Narrow climbing crop; not the loudest thing on the page.",
            false,
            "Narrow vertical atmosphere for a {{trade}} brand in {{city}}, to sit beside a spine of real project stills, never impersonating those stills. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "portrait",
          "Another narrow climb.",
          false,
          "Second narrow vertical texture for a {{trade}} brand in {{city}}. {{businessName}}.",
        ),
      ),
  },
  chorus: {
    opening:
      "One short lead line, then a horizontal procession of small labeled frames — a line of voices, not a grid and not one poster. Each frame is a real project still when photos exist.",
    mobile:
      "Keep the procession as a vertical sequence of small frames. Do not promote the first frame to a full-bleed hero.",
    minEvidenceStills: 2,
    proofSlots: [
      {
        slotId: "chorus-1",
        aspectRatio: "landscape",
        cropGuidance: "Small labeled procession frame; not a full-bleed hero.",
        minEvidence: 1,
        required: true,
      },
      {
        slotId: "chorus-2",
        aspectRatio: "landscape",
        cropGuidance: "Second small frame in the same procession.",
        minEvidence: 2,
        required: true,
      },
      {
        slotId: "chorus-3",
        aspectRatio: "landscape",
        cropGuidance: "Third small frame; keep it in line, not a grid tile.",
        minEvidence: 3,
        required: false,
      },
    ],
    extraTags: ["photo-led"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "atmosphere",
            "landscape",
            "Quiet atmosphere behind or after the procession; never labeled as a project.",
            false,
            "Quiet landscape atmosphere for a {{trade}} brand in {{city}}, to sit behind a procession of real labeled project frames, never replacing them. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "landscape",
          "Soft continuation, not a sixth proof tile.",
          false,
          "Soft landscape texture for a {{trade}} brand in {{city}}. Not a project photo. {{businessName}}.",
        ),
      ),
  },
  horizon: {
    opening:
      "Compose like a landscape painting: the upper two-thirds is empty air or quiet sky. Identity sits on a low horizon line. No centered poster, no overlay in the sky.",
    mobile:
      "Preserve a large empty top. Pin identity to the bottom. Do not fill the sky with a photo.",
    minEvidenceStills: 0,
    extraTags: ["minimal", "warm"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "wide",
            "Sky-heavy; low horizon; leave the upper field empty of objects and letters.",
            false,
            "Sky-heavy wide still for a {{trade}} brand in {{city}}: empty upper field, a low material horizon, no objects in the sky. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "wide",
          "Another empty-air field.",
          false,
          "Empty-air wide texture for a {{trade}} brand in {{city}}. Low horizon only. {{businessName}}.",
        ),
      ),
  },
  fold: {
    opening:
      "Two leaves meet off-center, like a folded brochure: type and media overlap a gutter instead of sharing a straight 50/50 split. One leaf steps ahead of the other. Not a catalog split-media.",
    mobile:
      "Keep the offset: type, then a stepped image. Do not flatten into a single stacked block with even margins.",
    minEvidenceStills: 0,
    extraTags: ["playful"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "landscape",
            "Allow an uneven edge; this crop will be stepped, not centered in a column.",
            false,
            "Landscape still for a {{trade}} brand in {{city}} meant to sit as a folded overlapping leaf, not a centered column image. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "atmosphere",
          "portrait",
          "The other leaf of the fold, different aspect.",
          false,
          "Portrait overlapping leaf for a {{trade}} brand in {{city}}. Folded-brochure crop. {{businessName}}.",
        ),
      ),
  },
  specimen: {
    opening:
      "The first image is an extreme material close-up, as if a sample chip on a studio table. The company name is a caption under the specimen, not a headline over a job photo. No skyline, no truck, no facade.",
    mobile:
      "Keep the specimen large and the caption small. Do not introduce a second lifestyle photo in the opening.",
    minEvidenceStills: 0,
    extraTags: ["craft"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "square",
            "Macro material; fill the frame with texture; no horizon, no building, no vehicle.",
            false,
            "Extreme close-up of material, grain, or tool surface for a {{trade}} brand in {{city}}, like a studio specimen chip. No buildings, no vehicles. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "square",
          "A second macro chip, different material.",
          false,
          "Second macro material chip for a {{trade}} brand in {{city}}. Studio table, not a job site. {{businessName}}.",
        ),
      ),
  },
  dispatch: {
    opening:
      "The opening reads as a field ticket: city, trade, license, and a time-like stamp. Any photograph is stamp-sized in a corner, never a hero poster. The page should feel issued, not marketed.",
    mobile:
      "Keep the ticket layout: facts first, stamp last. Do not add a banner image.",
    minEvidenceStills: 0,
    extraTags: ["utilitarian"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "texture",
            "square",
            "Stamp-sized; paper, carbon, or worn form texture; not a photograph of work.",
            false,
            "Paper, carbon-copy, or worn-form texture for a {{trade}} dispatch ticket in {{city}}. Stamp crop, not a job photograph. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "square",
          "Another paper texture.",
          false,
          "Secondary paper texture for a {{trade}} brand in {{city}}. Administrative, not scenic. {{businessName}}.",
        ),
      ),
  },
  lantern: {
    opening:
      "Most of the opening is dark or quiet. One crop is lit, like a lantern. Type lives only in the falloff of that light — not centered on the image, not a classic overlay safe-third.",
    mobile:
      "Keep the dark field; pin the lit crop and the type to the same corner. Do not recenter into a poster overlay.",
    minEvidenceStills: 0,
    extraTags: ["cinematic"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "wide",
            "Mostly dark; one illuminated material patch; leave falloff for type off the bright core.",
            true,
            "Mostly dark still with one lantern-like patch of light on material for a {{trade}} brand in {{city}}. Type will sit in the falloff, not on the bright core. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "texture",
          "wide",
          "Dark field continuation.",
          true,
          "Dark material field with a smaller light leak for a {{trade}} brand in {{city}}. {{businessName}}.",
        ),
      ),
  },
  cascade: {
    opening:
      "Type starts oversized and steps down through three measures in the same band, while a single image recedes in scale — large, then smaller, then a whisper. Not type-then-photo stacked in two blocks.",
    mobile:
      "Keep the three type measures stepping down; the image stays a receding companion, not a full-width block between them.",
    minEvidenceStills: 0,
    extraTags: ["premium"],
    stills: (density) =>
      withSupport(
        density,
        [
          still(
            "atmosphere-hero",
            "hero",
            "landscape",
            "Will be shown at more than one scale; keep a strong edge that still reads when smaller.",
            false,
            "Landscape still for a {{trade}} brand in {{city}} that can recede in scale beside stepping type, not a single stacked banner. {{businessName}}.",
          ),
        ],
        still(
          "atmosphere-support",
          "atmosphere",
          "portrait",
          "The smallest whisper crop in the cascade.",
          false,
          "Smaller receding crop for a {{trade}} brand in {{city}}. Same world, quieter. {{businessName}}.",
        ),
      ),
  },
};

const FAMILY_PROFILE: Record<
  GachaFamily,
  {
    lookAndFeelAffinity: GachaLookAndFeel[];
    tags: GachaFilterTag[];
    typeRoles: string;
    geometryAndSurface: string;
    colorStrategy: string;
    avoid: string[];
    writerGuidance: string;
    mobile: string;
  }
> = {
  editorial: {
    lookAndFeelAffinity: ["professional", "modern"],
    tags: ["editorial", "premium", "minimal"],
    typeRoles: "Expressive serif display with restrained sans-serif labels and utility copy.",
    geometryAndSurface: "Square edges, hairline dividers, paper-like fields, restrained contrast.",
    colorStrategy: "Brand hex as a quiet ink accent on paper or slate; never a second palette.",
    avoid: ["equal card grids", "pill-heavy controls", "decorative gradients"],
    writerGuidance: "Read as a chaptered specialist journal. Facts and captions carry authority.",
    mobile: "Collapse the lead to image then copy; keep rules and numbering as scan cues.",
  },
  cinematic: {
    lookAndFeelAffinity: ["modern", "funky"],
    tags: ["cinematic", "bold", "premium"],
    typeRoles: "Condensed or sturdy sans-serif display with neutral sans-serif supporting text.",
    geometryAndSurface: "Full-width dark or high-contrast fields, minimal chrome, crisp edges.",
    colorStrategy: "Deep field; brand hex only on type and a single control.",
    avoid: ["thumbnail galleries", "busy icon rows", "competing calls to action"],
    writerGuidance: "One oversized opening statement. Atmosphere leads; proof is labeled and scarce.",
    mobile: "Poster-first media; move overlay copy below unsafe crops; keep the primary action visible.",
  },
  "field-manual": {
    lookAndFeelAffinity: ["professional"],
    tags: ["utilitarian", "bold"],
    typeRoles: "Strong grotesk headings, legible sans-serif body, tabular utility labels.",
    geometryAndSurface: "Hard edges, clear borders, high-contrast status bands, minimal ornament.",
    colorStrategy: "High-contrast brand on ink or safety-band; facts outrank atmosphere.",
    avoid: ["delicate flourishes", "low-contrast text", "ornamental image masks"],
    writerGuidance: "Urgent, scannable, safety-led. Phone and quote actions appear early.",
    mobile: "Stack into one scan path; avoid horizontal dependencies.",
  },
  "craft-journal": {
    lookAndFeelAffinity: ["professional", "funky"],
    tags: ["craft", "warm"],
    typeRoles: "Humanist serif headings paired with a plain sans-serif for facts and actions.",
    geometryAndSurface: "Soft corners, warm neutral surfaces, subtle inset frames.",
    colorStrategy: "Warm neutrals; brand hex as a wood-stain accent, not neon.",
    avoid: ["corporate icon grids", "cold monochrome", "uniform image tiles"],
    writerGuidance: "Intimate craft narrative. Real project photos are primary proof when present.",
    mobile: "Alternate image and narrative; preserve captions; remove decorative overlaps.",
  },
  portfolio: {
    lookAndFeelAffinity: ["modern", "professional"],
    tags: ["minimal", "premium"],
    typeRoles: "Quiet sans-serif display and compact metadata so imagery remains dominant.",
    geometryAndSurface: "Minimal surfaces, broad image planes, restrained frames.",
    colorStrategy: "Near-neutral ground; brand hex only in metadata and controls.",
    avoid: ["equal thumbnail walls", "copy-heavy cards", "generated images labeled as work"],
    writerGuidance: "Completed work is the loudest thing on the page. Generated media is secondary atmosphere.",
    mobile: "Single-column image sequence; captions adjacent to evidence.",
  },
  workshop: {
    lookAndFeelAffinity: ["funky", "modern"],
    tags: ["playful", "warm"],
    typeRoles: "Rounded characterful sans-serif display with a neutral readable body.",
    geometryAndSurface: "Bold simple shapes, selective rounded panels, offset labels.",
    colorStrategy: "One controlled accent from the brand hex; never a rainbow.",
    avoid: ["mascots", "rainbow palettes", "repeated pill cards", "juvenile copy"],
    writerGuidance: "Approachable residential voice. Proof stays literal and labeled.",
    mobile: "Flatten collages into a readable sequence; enlarge action targets.",
  },
  "ledger-dark": {
    lookAndFeelAffinity: ["professional", "modern"],
    tags: ["editorial", "premium", "minimal"],
    typeRoles: "High-contrast grotesque display with small caps labels.",
    geometryAndSurface: "Ink fields, hairline rules, no glow, no glassmorphism.",
    colorStrategy: "Dark ground; brand hex as a single signal color on type and CTA.",
    avoid: ["light-card soup", "stock handshake photos", "soft drop shadows"],
    writerGuidance: "Night-ledger specialist. Quiet, expensive, factual.",
    mobile: "Keep rules; stack columns; do not lighten the ground.",
  },
  municipal: {
    lookAndFeelAffinity: ["professional"],
    tags: ["utilitarian", "minimal"],
    typeRoles: "Civic sans-serif at two sizes only; no display novelty.",
    geometryAndSurface: "Document-like bands, clear stamps, no rounded marketing chrome.",
    colorStrategy: "Paper and navy-adjacent brand; high contrast for licenses and hours.",
    avoid: ["lifestyle lifestyle-hero cliches", "script fonts", "discount banners"],
    writerGuidance: "Public-facing contractor of record. Credentials and service area first.",
    mobile: "Linearize like a form; keep license numbers tabular.",
  },
  coastal: {
    lookAndFeelAffinity: ["modern", "funky"],
    tags: ["warm", "minimal"],
    typeRoles: "Airy sans with a restrained serif for pull quotes only.",
    geometryAndSurface: "Wide margins, salt-light surfaces, thin rules, no tropical kitsch.",
    colorStrategy: "Light ground; brand hex as horizon accent, not beach pastels.",
    avoid: ["surf clipart", "script signatures", "stock sunset stock"],
    writerGuidance: "Calm coastal specialist. Space is the luxury; copy stays specific.",
    mobile: "Keep long measure wrapping; do not compress into cards.",
  },
  atelier: {
    lookAndFeelAffinity: ["funky", "professional"],
    tags: ["craft", "editorial", "premium"],
    typeRoles: "Mixed: sharp sans labels, one serif display for the opening only.",
    geometryAndSurface: "Offset frames, studio-wall negative space, one unexpected crop.",
    colorStrategy: "Gallery white or plaster; brand hex as a pigment chip, not a fill.",
    avoid: ["template masonry", "badge clutter", "fake atelier props"],
    writerGuidance: "Maker studio. Process and material language; never generic excellence.",
    mobile: "One offset kept; flatten the rest; captions stay with the work.",
  },
};

const RHYTHM: Record<GachaDensity, string> = {
  compact: "Tight regular rhythm optimized for scanning.",
  balanced: "Moderate density with deliberate pauses between bands.",
  spacious: "Low density with long pauses and oversized statements.",
  airy: "Very low text density; generous margins around media and facts.",
};

function buildPack(
  family: GachaFamily,
  hero: GachaHeroTreatment,
  density: GachaDensity,
): GachaPack {
  const profile = FAMILY_PROFILE[family];
  const heroProfile = HERO_PROFILES[hero];
  const minEvidenceStills = heroProfile.minEvidenceStills;
  const tags = new Set<GachaFilterTag>(profile.tags);
  for (const tag of heroProfile.extraTags) tags.add(tag);
  if (minEvidenceStills >= 2) tags.add("photo-led");
  if (density === "airy" || density === "spacious") tags.add("premium");
  const proofSlots = heroProfile.proofSlots;
  return {
    id: `${family}-${hero}-${density}`,
    version: GACHA_PACK_VERSION,
    family,
    lookAndFeelAffinity: profile.lookAndFeelAffinity,
    tags: [...tags],
    minEvidenceStills,
    typeRoles: profile.typeRoles,
    densityAndSpacing: RHYTHM[density],
    geometryAndSurface: profile.geometryAndSurface,
    colorStrategy: profile.colorStrategy,
    heroTreatment: heroProfile.opening,
    rhythm: RHYTHM[density],
    avoid: [
      ...profile.avoid,
      "Do not flatten this opening into a full-bleed poster, a straight two-column split, or type-then-photo stacks.",
    ],
    mediaRecipe: {
      proofStripRequired: Boolean(proofSlots && proofSlots.length > 0),
      ...(proofSlots ? { proofSlots } : {}),
      atmosphereStills: heroProfile.stills(density),
    },
    mobile: `${heroProfile.mobile} Later bands: ${profile.mobile}`,
    writerGuidance: `${profile.writerGuidance} Opening composition (binding): ${heroProfile.opening} Realize it at ${density} density. Required media slot IDs are binding; composition of later bands is yours.`,
  };
}

export const GACHA_PACKS: readonly GachaPack[] = GACHA_FAMILIES.flatMap((family) =>
  HERO_TREATMENTS.flatMap((hero) => DENSITIES.map((density) => buildPack(family, hero, density))),
);

if (GACHA_PACKS.length < 200) {
  throw new Error(`Gacha drum must contain at least 200 packs; got ${GACHA_PACKS.length}`);
}

export function allGachaPacks(): readonly GachaPack[] {
  return GACHA_PACKS;
}
