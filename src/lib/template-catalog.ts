import type { FileRoutesByFullPath } from "@/routeTree.gen";

type TemplateRoute = Extract<
  keyof FileRoutesByFullPath,
  `/templates/${string}` | "/painter2" | "/painter3"
>;

export type ContractorJob = "gardener" | "plumber" | "painter";

export type TemplateCatalogItem = {
  slug: string;
  variant: string;
  job: ContractorJob;
  description: string;
  href: TemplateRoute;
  previewImage: string;
  palette: { background: string; surface: string; accent: string; ink: string };
};

export const templateCatalog = [
  {
    slug: "landscape",
    variant: "Editorial garden",
    job: "gardener",
    description:
      "An editorial garden story with organic pacing and considered outdoor transformations.",
    href: "/templates/landscape",
    previewImage: "/templates/garden-delite/generated/hero.jpg",
    palette: { background: "#e9e5d9", surface: "#1d3329", accent: "#c8e36c", ink: "#203128" },
  },
  {
    slug: "plumber",
    variant: "Diagnostic showcase",
    job: "plumber",
    description:
      "A cinematic diagnostic showcase built around water, precision, evidence, and clear next steps.",
    href: "/templates/plumber",
    previewImage: "/templates/leak-geeks/generated/hero.jpg",
    palette: { background: "#d9f3f1", surface: "#062d3a", accent: "#73e6df", ink: "#062d3a" },
  },
  {
    slug: "painter",
    variant: "Tactile portfolio",
    job: "painter",
    description:
      "A tactile painting portfolio where preparation, color, and crisp finish details lead the story.",
    href: "/templates/painter",
    previewImage: "/templates/true-coat/generated/hero.jpg",
    palette: { background: "#f1e7eb", surface: "#422638", accent: "#d486a2", ink: "#3b2933" },
  },
  {
    slug: "painter2",
    variant: "Surface orbit",
    job: "painter",
    description:
      "A dark, cinematic painting field shaped by orbital apertures, deep negative space, and raking-light craft imagery.",
    href: "/painter2",
    previewImage: "/templates/true-coat-orbit/generated/gallery-poster.jpg",
    palette: { background: "#070a12", surface: "#f2eee5", accent: "#ffb84d", ink: "#211309" },
  },
  {
    slug: "painter3",
    variant: "Chromatic frame",
    job: "painter",
    description:
      "A high-chroma residential color studio where moving pigment, oversized project imagery, stacked proof studies, and explicitly fictional review samples lead the story.",
    href: "/painter3",
    previewImage: "/templates/true-coat-spectrum/generated/hero-splash.jpg",
    palette: { background: "#f3f0e8", surface: "#171716", accent: "#ec176b", ink: "#20030e" },
  },
  {
    slug: "painter4",
    variant: "Craftsman’s Colorbook",
    job: "painter",
    description:
      "An elegant, image-heavy field colorbook shaped by physical swatches, well-used tools, refined rooms, and prep-first craft.",
    href: "/templates/painter4",
    previewImage: "/templates/true-coat-colorbook/generated/hero.jpg",
    palette: { background: "#efe9dc", surface: "#44352c", accent: "#83917c", ink: "#211f1b" },
  },
  {
    slug: "painter5",
    variant: "California house issue",
    job: "painter",
    description:
      "A sunlit architectural painter portfolio with material-board projects, a live facade palette, and premium California restraint.",
    href: "/templates/painter5",
    previewImage: "/templates/true-coat-california/generated/hero.jpg",
    palette: { background: "#f4efe4", surface: "#7699aa", accent: "#bd694d", ink: "#181a18" },
  },
  {
    slug: "painter6",
    variant: "Eggshell / Surface study",
    job: "painter",
    description:
      "A quiet-luxury painter template where raking light, immaculate surfaces, and preparation-led craft make the finish feel considered.",
    href: "/templates/painter6",
    previewImage: "/templates/true-coat-eggshell/generated/hero.jpg",
    palette: { background: "#f7f5f0", surface: "#e7e1d6", accent: "#a87664", ink: "#191918" },
  },
  {
    slug: "painter7",
    variant: "Ultraviolet Workshop",
    job: "painter",
    description:
      "An experimental premium painter template shaped by glossy ultraviolet enamel, electric lighting control, polished-metal craft imagery, and clear scope planning.",
    href: "/templates/painter7",
    previewImage: "/templates/true-coat-ultraviolet/generated/hero.jpg",
    palette: { background: "#080515", surface: "#120633", accent: "#d6ff22", ink: "#eee9ff" },
  },
  {
    slug: "painter8",
    variant: "Candy Capsule Lab",
    job: "painter",
    description:
      "A blister-pack painter template with capsule service rails, inflatable swatch orbs, toy-packaging windows, and preparation-led residential scope.",
    href: "/templates/painter8",
    previewImage: "/templates/candy-capsule-lab/generated/hero.jpg",
    palette: { background: "#fffcff", surface: "#ff69b4", accent: "#40e0d0", ink: "#1c1228" },
  },
  {
    slug: "painter1",
    variant: "Imagery-first studio",
    job: "painter",
    description:
      "An alternate imagery-first painting composition built from warm primer, graphite, masking-tape blue, and meticulous preparation.",
    href: "/templates/painter1",
    previewImage: "/templates/cutline/generated/gallery-poster.jpg",
    palette: { background: "#eee9df", surface: "#252429", accent: "#1d5f96", ink: "#eee9df" },
  },
  {
    slug: "painter10",
    variant: "Midnight Lacquer",
    job: "painter",
    description:
      "A dark-luxury painter template shaped by obsidian lacquer, oxblood accents, champagne showroom light, and a moving finish-inspection study.",
    href: "/templates/painter10",
    previewImage: "/templates/midnight-lacquer/generated/hero.jpg",
    palette: { background: "#050506", surface: "#97172a", accent: "#d8c29d", ink: "#f1ece4" },
  },
  {
    slug: "painter11",
    variant: "Vaporwave Paint Supply",
    job: "painter",
    description:
      "An after-hours paint-showroom template with full-bleed project films, lagoon and orchid shade studies, and preparation-led residential scope.",
    href: "/templates/painter11",
    previewImage: "/templates/vaporwave-paint-supply/generated/hero.jpg",
    palette: { background: "#0e0722", surface: "#171033", accent: "#7cb9b2", ink: "#f3ead9" },
  },
  {
    slug: "painter12",
    variant: "Lemonade Stand",
    job: "painter",
    description:
      "A sunny neighborhood painter template with photoreal project stories, painted-sign controls, a film-first hero, and postcard color reveals.",
    href: "/templates/painter12",
    previewImage: "/templates/lemonade-stand/generated/hero.jpg",
    palette: { background: "#fffaf0", surface: "#55c9e8", accent: "#ffd84d", ink: "#7a2034" },
  },
  {
    slug: "painter13",
    variant: "Blueberry Gelato",
    job: "painter",
    description:
      "A Mediterranean color-house painter template with terrazzo, painted arches, photoreal surface studies, and a four-scoop palette recipe.",
    href: "/templates/painter13",
    previewImage: "/templates/blueberry-gelato/generated/hero.jpg",
    palette: { background: "#f4edda", surface: "#30245e", accent: "#9abb83", ink: "#2d2932" },
  },
  {
    slug: "painter14",
    variant: "Juice Bar Renovation",
    job: "painter",
    description:
      "A tropical 1980s-inspired painter template with glossy tile, acrylic and chrome finishes, saturated residential color, and preparation-led scope.",
    href: "/templates/painter14",
    previewImage: "/templates/juice-bar-renovation/generated/hero.jpg",
    palette: { background: "#fffdf6", surface: "#00bfc4", accent: "#ee3e87", ink: "#17223d" },
  },
  {
    slug: "painter15",
    variant: "Moroccan Zellige",
    job: "painter",
    description:
      "An ornamental painter template shaped by hand-cut zellige, limewashed courtyards, carved doors, saturated architectural color, and precise surface planning.",
    href: "/templates/painter15",
    previewImage: "/templates/moroccan-zellige/generated/hero.jpg",
    palette: { background: "#f8f0df", surface: "#281437", accent: "#d38a19", ink: "#2b2130" },
  },
  {
    slug: "painter16",
    variant: "Ink Wash Contractor",
    job: "painter",
    description:
      "Quiet Japanese-inspired rooms, natural timber and indigo brushwork, with practical painting notes and project planning.",
    href: "/templates/painter16",
    previewImage: "/templates/ink-wash/generated/hero-800.jpg",
    palette: { background: "#f3f0e8", surface: "#263547", accent: "#a6b6a3", ink: "#263547" },
  },
  {
    slug: "painter17",
    variant: "Alpine Enamel",
    job: "painter",
    description:
      "Mountain-cabin colour, crisp enamel-sign typography and preparation-led timber care, from cranberry siding to pine-green finishes.",
    href: "/templates/painter17",
    previewImage: "/templates/alpine-enamel/photography/hero-800.jpg",
    palette: { background: "#f2f0e5", surface: "#234b3d", accent: "#edbd48", ink: "#19362b" },
  },
  {
    slug: "painter18",
    variant: "Lavender Estate",
    job: "painter",
    description:
      "An English country-house painter template with photographic room studies, botanical wallpaper and considered decorating guidance.",
    href: "/templates/painter18",
    previewImage: "/templates/lavender-estate/photography/arrival-800.jpg",
    palette: { background: "#f5f1e8", surface: "#623b4b", accent: "#c4b9ce", ink: "#45323c" },
  },
] as const satisfies readonly TemplateCatalogItem[];
