import { THEME_SOURCE_MAX_BYTES } from "./types.ts";
import { auditKitThemeSource, scanKitOpenTags, type DesignAuditFinding } from "./kit-audit.ts";
import {
  evidenceFromCounts,
  isCatalogEligibleSection,
  sectionIdsForEvidence,
} from "../agent/section-order.ts";
import {
  hasDroppedUnifiedKitTag,
  UNIFIED_KIT_REBUILD_ERROR,
  type ThemeKitScope,
} from "./kit-scope.ts";
import { executableNamedLayoutForSection } from "../agent/layout-vocabulary.ts";

export type { DesignAuditFinding };

export type ThemeValidateOptions = {
  contactHidden?: boolean;
  hasMedia?: boolean;
  hasReviews?: boolean;
  hasTrustMarkers?: boolean;
  hasWarranty?: boolean;
  hasHours?: boolean;
  catalogRefs?: string[];
  /** Generate-time: sections with accepted catalog refs must be NamedLayout-only. */
  requireNamedLayouts?: boolean;
  /**
   * Unified generate: export default + size + LeadSlot-if-contact. Runtime policy is
   * checked semantically after transformation. Rejects two-step kit tags without
   * naming them in the error. Skips kit audit
   * and evidence-id cages.
   */
  unifiedLoose?: boolean;
  /** Generate-time binding analysis scope. Omit when reading historical stored themes. */
  bindingScope?: ThemeKitScope;
  generatorSchemaVersion?: number;
  mediaManifest?: unknown;
  sectionTopology?: unknown;
  operationalAnchors?: unknown;
};

export type ThemeValidateResult =
  | { ok: true; advisories: DesignAuditFinding[] }
  | { ok: false; error: string; advisories?: DesignAuditFinding[] };

const FORBIDDEN = [
  /\bimport\s+/i,
  /\brequire\s*\(/,
  /\bfetch\s*\(/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /document\.write/,
  /dangerouslySetInnerHTML/,
  /<script/i,
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /javascript:/i,
  /\bon[A-Z][A-Za-z]+\s*=/,
  /@keyframes/i,
  /data-site-section\s*=\s*\{/,

  /from\s+['"]motion['"]/,
  /@\/components/,
  /supabase/i,
  /from\s+['"]react['"]/,
];

function hasExportDefaultSite(source: string, requireExport = false): boolean {
  const exported = /^[\t ]*export\s+default\s+function\s+Site\b/m.test(source);
  return exported || (!requireExport && /function\s+Site\s*\(/.test(source));
}

function hasNamedLayoutSection(source: string, id: string): boolean {
  return scanKitOpenTags(source).some(
    (el) => el.tag === "NamedLayout" && el.attrMap.section?.literal === id,
  );
}

function hasSectionId(source: string, id: string): boolean {
  if (hasNamedLayoutSection(source, id)) return true;
  return scanKitOpenTags(source).some((el) => {
    if (el.tag === "Section") return el.attrMap.id?.literal === id;
    if (el.tag !== "Hero" || id !== "hero") return false;
    const literal = el.attrMap.id?.literal;
    return literal == null || literal === "hero";
  });
}

function kitUsagesHaveProp(source: string, tag: string, prop: string): boolean {
  const open = new RegExp(`<${tag}\\b([\\s\\S]*?)(?:\\/>|>)`, "g");
  let match: RegExpExecArray | null;
  let found = false;
  const propRe = new RegExp(`\\b${prop}\\s*=`);
  while ((match = open.exec(source))) {
    found = true;
    if (!propRe.test(match[1])) return false;
  }
  return found;
}

function sectionBody(source: string, sectionId: string): string | null {
  const escaped = sectionId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRe = new RegExp(
    `<Section\\b[^>]*\\bid\\s*=\\s*(?:["'\`]${escaped}["'\`]|\\{["'\`]${escaped}["'\`]\\})[^>]*>`,
    "i",
  );
  const openMatch = openRe.exec(source);
  if (!openMatch) return null;
  const pos = openMatch.index + openMatch[0].length;
  let depth = 1;
  const tagRe = /<\/?Section\b[^>]*>/gi;
  tagRe.lastIndex = pos;
  let tagMatch: RegExpExecArray | null;
  while (depth > 0 && (tagMatch = tagRe.exec(source))) {
    if (tagMatch[0].startsWith("</")) depth--;
    else depth++;
    if (depth === 0) return source.slice(pos, tagMatch.index);
  }
  return null;
}

function sectionContainsComponent(source: string, sectionId: string, component: string): boolean {
  const body = sectionBody(source, sectionId);
  if (!body) return false;
  return new RegExp(`<${component}\\b`).test(body);
}

export function validateThemeStructure(
  source: string,
  options: ThemeValidateOptions = {},
): ThemeValidateResult {
  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, error: "themeSource is empty" };
  }
  if (new TextEncoder().encode(source).length > THEME_SOURCE_MAX_BYTES) {
    return { ok: false, error: "themeSource exceeds 80KB" };
  }
  // Preserve the historical catalog gate. Unified code receives semantic checks after
  // Sucrase transformation, avoiding security decisions based on comments or strings.
  if (!options.unifiedLoose) {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(source)) {
        return { ok: false, error: `themeSource contains forbidden pattern ${pattern}` };
      }
    }
  } else if (/@keyframes/i.test(source)) {
    return { ok: false, error: "themeSource contains forbidden @keyframes" };
  } else if (/data-site-section\s*=\s*\{/.test(source)) {
    return { ok: false, error: "data-site-section must be a direct string literal" };
  }
  if (
    !hasExportDefaultSite(source, options.unifiedLoose === true) &&
    !/^[\t ]*export\s+default\s+Site\b/m.test(source)
  ) {
    return { ok: false, error: "themeSource must export default function Site" };
  }
  if (options.unifiedLoose) {
    if (hasDroppedUnifiedKitTag(source)) {
      return { ok: false, error: UNIFIED_KIT_REBUILD_ERROR };
    }
    const leadSlotCount = scanKitOpenTags(source).filter(
      (element) => element.tag === "LeadSlot",
    ).length;
    if (options.contactHidden && leadSlotCount !== 0) {
      return { ok: false, error: "themeSource must omit LeadSlot when contact is hidden" };
    }
    if (!options.contactHidden && leadSlotCount !== 1) {
      return {
        ok: false,
        error: "themeSource must use exactly one LeadSlot when contact is shown",
      };
    }
    return { ok: true, advisories: [] };
  }
  const executableSections = ["hero", "services", "beforeAfter", "reviews", "footer"] as const;
  const acceptedNamedLayouts = (options.catalogRefs ?? []).map(
    (id) =>
      executableSections
        .map((section) => executableNamedLayoutForSection(section, id))
        .find(Boolean) ?? null,
  );
  if (options.requireNamedLayouts && acceptedNamedLayouts.some((entry) => entry === null)) {
    return { ok: false, error: "catalogRef must identify an executable NamedLayout" };
  }
  const namedLayoutSections: Set<string> = new Set(
    acceptedNamedLayouts.flatMap((entry) => (entry ? [entry.canonicalSection] : [])),
  );
  const evidenceIds = sectionIdsForEvidence(
    evidenceFromCounts({
      hasTrustMarkers: options.hasTrustMarkers,
      hasMedia: options.hasMedia,
      hasReviews: options.hasReviews,
      hasWarranty: options.hasWarranty,
      hasHours: options.hasHours,
    }),
  );
  for (const id of evidenceIds) {
    if (id === "contact" && options.contactHidden) continue;
    if (options.requireNamedLayouts && namedLayoutSections.has(id)) {
      if (!hasNamedLayoutSection(source, id)) {
        return { ok: false, error: `themeSource missing NamedLayout section="${id}"` };
      }
      continue;
    }
    if (!hasSectionId(source, id)) {
      return { ok: false, error: `themeSource missing section id ${id}` };
    }
  }
  if (options.requireNamedLayouts) {
    const tags = scanKitOpenTags(source);
    const unacceptedNamed = tags.find(
      (el) =>
        el.tag === "NamedLayout" && !namedLayoutSections.has(el.attrMap.section?.literal ?? ""),
    );
    if (unacceptedNamed) {
      return { ok: false, error: "NamedLayout requires an accepted catalogRef for its section" };
    }
    for (const id of evidenceIds) {
      if (!isCatalogEligibleSection(id) || !namedLayoutSections.has(id)) continue;
      const freehand = tags.some((el) => {
        if (el.tag !== "Section" && el.tag !== "Hero") return false;
        const literal = el.attrMap.id?.literal ?? (el.tag === "Hero" ? "hero" : null);
        return literal === id;
      });
      if (freehand) {
        return { ok: false, error: `themeSource must not freehand #${id} beside NamedLayout` };
      }
    }
    if (options.hasMedia && !namedLayoutSections.has("beforeAfter")) {
      const body = sectionBody(source, "beforeAfter") ?? "";
      if (!/props\.media\b/.test(body) || !/<MediaGallery\b/.test(body)) {
        return {
          ok: false,
          error: "freehand beforeAfter must consume props.media with MediaGallery",
        };
      }
    }
    if (options.hasReviews && !namedLayoutSections.has("reviews")) {
      const body = sectionBody(source, "reviews") ?? "";
      if (
        !/props\.reviews\b/.test(body) ||
        !/<Quote\b/.test(body) ||
        !kitUsagesHaveProp(body, "Quote", "quote") ||
        !kitUsagesHaveProp(body, "Quote", "source")
      ) {
        return {
          ok: false,
          error: "freehand reviews must consume props.reviews with attributed Quote components",
        };
      }
    }
    const wrapped = tags.some(
      (el) => (el.tag === "Section" || el.tag === "Hero") && /<NamedLayout\b/.test(el.body),
    );
    if (wrapped) {
      return { ok: false, error: "NamedLayout must not be wrapped in Section or Hero" };
    }
    if (namedLayoutSections.has("hero") && /<h1\b/i.test(source)) {
      return { ok: false, error: "themeSource must not use raw h1; NamedLayout owns display type" };
    }
  }
  if (!options.contactHidden && !scanKitOpenTags(source).some((el) => el.tag === "LeadSlot")) {
    return { ok: false, error: "themeSource must use LeadSlot when contact is shown" };
  }
  if (options.hasMedia === false && /<Media\b/.test(source)) {
    return { ok: false, error: "themeSource must omit Media when no photos exist" };
  }
  if (!options.requireNamedLayouts) {
    if (options.hasMedia && !/props\.media\b/.test(source)) {
      return { ok: false, error: "themeSource must read props.media when media exists" };
    }
    if (options.hasMedia) {
      const hasMediaTags = /<Media\b/.test(source);
      if (hasMediaTags && !kitUsagesHaveProp(source, "Media", "item")) {
        return { ok: false, error: "themeSource must pass item= to Media when media exists" };
      }
      const kitOwnsStill =
        /<(?:Section|Hero)\b[^>]*\bmedia\s*=/.test(source) ||
        /<MediaGallery\b/.test(source) ||
        hasMediaTags;
      if (!kitOwnsStill) {
        return { ok: false, error: "themeSource must pass item= to Media when media exists" };
      }
    }
    if (options.hasMedia && !sectionContainsComponent(source, "beforeAfter", "MediaGallery")) {
      return {
        ok: false,
        error: "themeSource must use MediaGallery in beforeAfter when media exists",
      };
    }
    if (options.hasReviews && !/props\.reviews\b/.test(source)) {
      return { ok: false, error: "themeSource must read props.reviews when reviews exist" };
    }
    if (options.hasReviews && !kitUsagesHaveProp(source, "Quote", "quote")) {
      return { ok: false, error: "themeSource must pass quote= to Quote when reviews exist" };
    }
    if (options.hasReviews && !kitUsagesHaveProp(source, "Quote", "source")) {
      return { ok: false, error: "themeSource must pass source= to Quote when reviews exist" };
    }
  }
  if (options.hasTrustMarkers && !/props\.trustMarkers\b/.test(source)) {
    return {
      ok: false,
      error: "themeSource must read props.trustMarkers when trust markers exist",
    };
  }
  if (options.hasTrustMarkers && !/<TrustMarkerList\b/.test(source)) {
    return { ok: false, error: "themeSource must use TrustMarkerList when trust markers exist" };
  }
  return { ok: true, advisories: [] };
}

export function validateThemeSource(
  source: string,
  options: ThemeValidateOptions = {},
): ThemeValidateResult {
  const structural = validateThemeStructure(source, options);
  if (!structural.ok) return structural;
  if (options.unifiedLoose) return structural;
  const findings = auditKitThemeSource(source, { catalogRefs: options.catalogRefs });
  const errors = findings.filter((item) => item.severity === "error");
  const advisories = findings.filter((item) => item.severity === "advisory");
  if (errors.length > 0) {
    return {
      ok: false,
      error: errors.map((item) => item.message).join(" "),
      advisories,
    };
  }
  return { ok: true, advisories };
}

export function stripThemeExports(source: string): string {
  return source.replace(/^[\t ]*export\s+default\s+(?=(?:function\s+Site\b|Site\b))/m, "");
}

export function hasStoredThemeSource(config: Record<string, unknown>): boolean {
  return typeof config.themeSource === "string" && config.themeSource.trim().length > 0;
}

/** Iframe host, including a unified miss that must not paint two-step chrome. */
/** Render-time gate: structural only. hasMedia/hasReviews are codegen-time checks. */
export function isStructurallyValidTheme(
  source: string,
  options: Pick<ThemeValidateOptions, "contactHidden"> = {},
): boolean {
  return validateThemeStructure(source, { contactHidden: options.contactHidden }).ok;
}
