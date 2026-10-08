export const UNIFIED_RECIPE_VERSION = 1 as const;

export type UnifiedRecipe = {
  id: string;
  version: typeof UNIFIED_RECIPE_VERSION;
  suitableFor: string;
  minEvidenceStills: number;
  densityAndSpacing: string;
  typeRoles: string;
  geometryAndSurface: string;
  sectionShapes: string[];
  avoid: string[];
  mediaHierarchy: string;
  mobileAdaptation: string;
};

export type UnifiedRecipeProfile = { evidenceStillCount: number; reviewCount: number };

export const UNIFIED_DESIGN_RECIPES: readonly UnifiedRecipe[] = [
  {
    id: "editorial-ledger",
    version: 1,
    suitableFor: "Established specialists with credentials, reviews, or detailed service facts.",
    minEvidenceStills: 0,
    densityAndSpacing:
      "Moderate density, ruled groups, short measures, and deliberate chapter spacing.",
    typeRoles: "Expressive serif display with restrained sans-serif labels and utility copy.",
    geometryAndSurface:
      "Square edges, hairline dividers, paper-like fields, and restrained contrast.",
    sectionShapes: [
      "masthead index",
      "asymmetric story lead",
      "ruled service ledger",
      "pull-quote proof",
    ],
    avoid: ["equal card grids", "pill-heavy controls", "decorative gradients"],
    mediaHierarchy:
      "One editorial lead image, then smaller captioned evidence; favor landscape and portrait crops.",
    mobileAdaptation:
      "Collapse the lead to image then copy; retain rules and section numbering as navigation cues.",
  },
  {
    id: "cinematic-showcase",
    version: 1,
    suitableFor: "Aspirational or dramatic work where generated atmosphere can carry the opening.",
    minEvidenceStills: 0,
    densityAndSpacing: "Low density with long pauses and a small number of oversized statements.",
    typeRoles: "Condensed or sturdy sans-serif display with neutral sans-serif supporting text.",
    geometryAndSurface: "Full-width dark or high-contrast fields, minimal chrome, crisp edges.",
    sectionShapes: [
      "media-overlay hero",
      "split statement",
      "wide proof strip",
      "anchored conversion panel",
    ],
    avoid: ["thumbnail galleries", "busy icon rows", "competing calls to action"],
    mediaHierarchy:
      "Motion or a wide still leads; support media uses cinematic wide crops and quiet overlays.",
    mobileAdaptation:
      "Use poster-first media, move overlay copy below unsafe crops, and keep the primary action visible.",
  },
  {
    id: "utilitarian-field-manual",
    version: 1,
    suitableFor:
      "Urgent, technical, safety-led, or broad service businesses with limited photography.",
    minEvidenceStills: 0,
    densityAndSpacing: "Compact regular rhythm optimized for scanning and fast decisions.",
    typeRoles: "Strong grotesk headings, legible sans-serif body, and tabular utility labels.",
    geometryAndSurface: "Hard edges, clear borders, high-contrast status bands, minimal ornament.",
    sectionShapes: [
      "split utility hero",
      "service index",
      "credential rail",
      "direct contact block",
    ],
    avoid: ["delicate flourishes", "low-contrast text", "ornamental image masks"],
    mediaHierarchy: "Use one functional hero and sparse support crops; facts outrank atmosphere.",
    mobileAdaptation:
      "Stack into one scan path, keep phone and quote actions early, avoid horizontal dependencies.",
  },
  {
    id: "warm-craft-journal",
    version: 1,
    suitableFor:
      "Detail-oriented craft and remodeling businesses with at least one real project image.",
    minEvidenceStills: 1,
    densityAndSpacing:
      "Relaxed rhythm with intimate text blocks and generous margins around evidence.",
    typeRoles: "Humanist serif headings paired with a plain sans-serif for facts and actions.",
    geometryAndSurface:
      "Soft but not bubbly corners, warm neutral surfaces, and subtle inset frames.",
    sectionShapes: ["offset image hero", "process narrative", "detail pair", "testimonial aside"],
    avoid: ["corporate icon grids", "cold monochrome", "uniform image tiles"],
    mediaHierarchy:
      "Real craft detail is primary proof; generated atmosphere never impersonates a project.",
    mobileAdaptation:
      "Alternate image and narrative blocks, preserve captions, and remove decorative overlaps.",
  },
  {
    id: "image-led-portfolio",
    version: 1,
    suitableFor: "Photo-rich businesses whose completed work is the strongest evidence.",
    minEvidenceStills: 2,
    densityAndSpacing:
      "Low text density with variable image scale and generous gallery transitions.",
    typeRoles: "Quiet sans-serif display and compact metadata so imagery remains dominant.",
    geometryAndSurface: "Minimal surfaces, broad image planes, restrained frames and controls.",
    sectionShapes: ["gallery hero", "staggered portfolio", "caption rail", "compact service index"],
    avoid: ["equal thumbnail walls", "copy-heavy cards", "generated images labeled as work"],
    mediaHierarchy:
      "Real projects lead in mixed wide, portrait, and detail crops; atmosphere is secondary.",
    mobileAdaptation:
      "Use a deliberate single-column image sequence and keep captions adjacent to evidence.",
  },
  {
    id: "playful-workshop",
    version: 1,
    suitableFor:
      "Approachable residential services with friendly language or a broad family audience.",
    minEvidenceStills: 0,
    densityAndSpacing: "Energetic controlled rhythm with compact clusters separated by open bands.",
    typeRoles: "Rounded or characterful sans-serif display paired with a neutral readable body.",
    geometryAndSurface:
      "Bold simple shapes, selective rounded panels, offset labels, one controlled accent.",
    sectionShapes: [
      "offset collage hero",
      "stepped service list",
      "badge-and-proof band",
      "friendly conversion panel",
    ],
    avoid: ["mascots", "rainbow palettes", "repeated pill cards", "juvenile copy"],
    mediaHierarchy:
      "Use varied crops and one surprising composition while keeping proof literal and labeled.",
    mobileAdaptation:
      "Flatten collages into a readable sequence, retain one playful offset, and enlarge action targets.",
  },
] as const;

export function unifiedRecipeById(id: string, version: number): UnifiedRecipe | undefined {
  return UNIFIED_DESIGN_RECIPES.find((recipe) => recipe.id === id && recipe.version === version);
}

export function selectUnifiedRecipeCandidates(
  profile: UnifiedRecipeProfile,
  recentRecipeIds: readonly string[],
  seed = "",
): UnifiedRecipe[] {
  const compatible = UNIFIED_DESIGN_RECIPES.filter(
    (recipe) => recipe.minEvidenceStills <= profile.evidenceStillCount,
  );
  const recent = new Set(recentRecipeIds);
  const fresh = compatible.filter((recipe) => !recent.has(recipe.id));
  const recency = new Map(recentRecipeIds.map((id, index) => [id, index]));
  const reused = compatible
    .filter((recipe) => recent.has(recipe.id))
    .sort(
      (a, b) =>
        (recency.get(b.id) ?? Number.MAX_SAFE_INTEGER) -
        (recency.get(a.id) ?? Number.MAX_SAFE_INTEGER),
    );
  // Fresh recipes stay first, but a nearly exhausted pool is filled with the
  // least-recently-used compatible choices so the planner still gets 2–3 options.
  const seedValue = Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const rotate = (items: UnifiedRecipe[]) => {
    if (items.length === 0) return items;
    const start = seedValue % items.length;
    return [...items.slice(start), ...items.slice(0, start)];
  };
  const selected = rotate(fresh).slice(0, 3);
  if (selected.length < 3) selected.push(...reused.slice(0, 3 - selected.length));
  return selected;
}

export function formatUnifiedRecipeCandidates(recipes: readonly UnifiedRecipe[]): string {
  return JSON.stringify(
    recipes.map(({ minEvidenceStills: _minimum, ...recipe }) => recipe),
    null,
    2,
  );
}
