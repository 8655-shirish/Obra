/** Host seams the unified page module may bind. Not a composition kit. */
export const UNIFIED_KIT_NAMES = ["LeadSlot", "Button", "Media"] as const;

/**
 * Two-step iframe destructure. Unified injects only UNIFIED_KIT_NAMES;
 * every other name here is two-step and must not be named or bound on that path.
 */
export const CATALOG_KIT_NAMES = [
  "Section",
  "LeadSlot",
  "Button",
  "Media",
  "Heading",
  "TopBar",
  "Grid",
  "Card",
  "Quote",
  "Hero",
  "Header",
  "Nav",
  "QuoteCta",
  "MediaGallery",
  "TrustMarkerList",
  "NamedLayout",
  "firstStill",
] as const;

const UNIFIED_SEAM_SET = new Set<string>(UNIFIED_KIT_NAMES);

/** Two-step JSX tags. Unified compile rejects these without naming them. */
export const CATALOG_ONLY_KIT_NAMES = CATALOG_KIT_NAMES.filter(
  (name) => name !== "firstStill" && !UNIFIED_SEAM_SET.has(name),
);

export type ThemeKitScope = "unified" | "catalog";

export const THEME_RUNTIME_PARAMETER_NAMES = ["React", "SiteKit"] as const;

export const THEME_REACT_NAMES = [
  "React",
  "useState",
  "useEffect",
  "useMemo",
  "useCallback",
  "useId",
  "Fragment",
] as const;

export const UNIFIED_KIT_REBUILD_ERROR =
  'themeSource must use HTML and Tailwind; quote form is LeadSlot, photos are Media, booking is Button href="#contact"';

export function kitNamesForScope(scope: ThemeKitScope): readonly string[] {
  return scope === "unified" ? UNIFIED_KIT_NAMES : CATALOG_KIT_NAMES;
}

export function themeModulePreamble(scope: ThemeKitScope): string {
  const names = kitNamesForScope(scope);
  return `const { ${THEME_REACT_NAMES.filter((name) => name !== "React").join(", ")} } = React;
const { ${names.join(", ")} } = SiteKit;
`;
}

export function pickSiteKit(siteKit: unknown, scope: ThemeKitScope): Record<string, unknown> {
  const source = siteKit && typeof siteKit === "object" ? (siteKit as Record<string, unknown>) : {};
  const picked: Record<string, unknown> = {};
  for (const name of kitNamesForScope(scope)) {
    if (Object.prototype.hasOwnProperty.call(source, name)) picked[name] = source[name];
  }
  return picked;
}

function maskThemeProse(source: string): string {
  return source.replace(
    /(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
    (match) => " ".repeat(match.length),
  );
}

export function hasDroppedUnifiedKitTag(source: string): boolean {
  const code = maskThemeProse(source);
  if (CATALOG_ONLY_KIT_NAMES.some((name) => new RegExp(`<(?:SiteKit\\.)?${name}\\b`).test(code)))
    return true;
  return /\bfirstStill\s*\(/.test(code);
}
