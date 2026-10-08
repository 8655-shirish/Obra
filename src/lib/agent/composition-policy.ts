import type { SiteDesignIntent } from "../site-theme/types.ts";
import type { NamedLayoutFamily, NamedLayoutSection } from "./layout-vocabulary.ts";

export type RealizedCompositionFamily = NamedLayoutFamily | "named-unknown";
export type RealizedComposition = Partial<Record<NamedLayoutSection, RealizedCompositionFamily>>;

const SECTION_FAMILIES: Record<NamedLayoutSection, readonly NamedLayoutFamily[]> = {
  hero: ["split-media", "stacked-media", "overlay-media", "type-only"],
  services: ["split-media", "cards", "grid", "rows"],
  beforeAfter: ["grid", "featured", "mosaic"],
  reviews: ["cards", "grid", "rows", "featured"],
  footer: ["rows", "type-only", "grid"],
};

function restrict(
  section: NamedLayoutSection,
  preferred: readonly NamedLayoutFamily[],
): readonly NamedLayoutFamily[] {
  const valid = SECTION_FAMILIES[section];
  const narrowed = valid.filter((family) => preferred.includes(family));
  return narrowed.length > 0 ? narrowed : valid;
}

/** Small deterministic bridge from the existing designIntent to composition metadata. */
export function allowedCompositionFamilies(
  intent: SiteDesignIntent,
  section: NamedLayoutSection,
): readonly NamedLayoutFamily[] {
  if (section === "hero") {
    if (intent.emphasis === "quiet") return ["type-only", "stacked-media"];
    if (intent.emphasis === "loud") return ["split-media", "overlay-media"];
    if (intent.density === "compact") return ["type-only", "split-media"];
    return ["type-only", "split-media", "stacked-media", "overlay-media"];
  }

  if (intent.emphasis === "quiet") return restrict(section, ["rows", "type-only", "featured"]);
  if (intent.emphasis === "loud")
    return restrict(section, ["cards", "grid", "featured", "mosaic", "split-media", "rows"]);
  if (intent.density === "compact")
    return restrict(section, ["rows", "grid", "cards", "type-only"]);
  return SECTION_FAMILIES[section];
}

export function compositionCompatibilityError(
  intent: SiteDesignIntent,
  composition: RealizedComposition,
): string | null {
  for (const [section, family] of Object.entries(composition) as Array<
    [NamedLayoutSection, RealizedCompositionFamily]
  >) {
    if (family === "named-unknown") {
      return `realized ${section} composition has no catalog layoutFamily`;
    }
    const allowed = allowedCompositionFamilies(intent, section);
    if (!allowed.includes(family)) {
      return `designIntent ${intent.emphasis}/${intent.density} does not allow ${section}:${family}; allowed: ${allowed.join(", ")}`;
    }
  }
  return null;
}

export function compositionPolicyText(intent: SiteDesignIntent): string {
  const sections: NamedLayoutSection[] = ["hero", "services", "beforeAfter", "reviews", "footer"];
  return sections
    .map((section) => `${section}=[${allowedCompositionFamilies(intent, section).join("|")}]`)
    .join("; ");
}
