import { analyzeThemeBindings } from "./analyze-theme-bindings.ts";
import { transformThemeModule } from "./eval-theme-module.ts";
import { parseMediaManifest } from "./media-manifest.ts";
import {
  validateThemeSource,
  type ThemeValidateOptions,
  type ThemeValidateResult,
} from "./validate-theme-source.ts";

/** Validate, Sucrase-parse, and resolve runtime bindings without executing generated code. */
export function compileThemeSource(
  source: string,
  options: ThemeValidateOptions = {},
): ThemeValidateResult {
  const validated = validateThemeSource(source, options);
  if (!validated.ok) return validated;
  const transformed = transformThemeModule(source);
  if (!transformed.ok) return { ...transformed, advisories: validated.advisories };
  const bindingScope = options.bindingScope ?? (options.unifiedLoose ? "unified" : undefined);
  if (!bindingScope) return { ok: true, advisories: validated.advisories };
  try {
    const bindings = analyzeThemeBindings(transformed.js, bindingScope);
    if (bindings.unavailable.length > 0) {
      return {
        ok: false,
        error: `themeSource uses unavailable binding${bindings.unavailable.length === 1 ? "" : "s"}: ${bindings.unavailable.join(", ")}`,
        advisories: validated.advisories,
      };
    }
    if (!options.unifiedLoose) return { ok: true, advisories: validated.advisories };
    if (options.operationalAnchors !== undefined) {
      if (!Array.isArray(options.operationalAnchors))
        return {
          ok: false,
          error: "Operational anchors are malformed",
          advisories: validated.advisories,
        };
      const expected = options.operationalAnchors
        .map((anchor) =>
          anchor && typeof anchor === "object" && !Array.isArray(anchor)
            ? (anchor as { slug?: unknown }).slug
            : undefined,
        )
        .filter((slug): slug is string => typeof slug === "string");
      if (expected.length !== options.operationalAnchors.length)
        return {
          ok: false,
          error: "Operational anchors are malformed",
          advisories: validated.advisories,
        };
      for (const slug of expected) {
        const occurrences = bindings.sectionMarkerIds.filter((id) => id === slug).length;
        if (occurrences !== 1)
          return {
            ok: false,
            error: `Operational anchor ${slug} must occur exactly once; found ${occurrences}`,
            advisories: validated.advisories,
          };
      }
    }
    if (bindings.policyErrors.length > 0) {
      return {
        ok: false,
        error: `themeSource violates runtime policy: ${bindings.policyErrors.join(", ")}`,
        advisories: validated.advisories,
      };
    }
    if (bindings.collisions.length > 0) {
      return {
        ok: false,
        error: `themeSource redeclares injected binding${bindings.collisions.length === 1 ? "" : "s"}: ${bindings.collisions.join(", ")}`,
        advisories: validated.advisories,
      };
    }
    if (!options.contactHidden && !bindings.usedInjected.includes("LeadSlot")) {
      return {
        ok: false,
        error: "themeSource must use LeadSlot when contact is shown",
        advisories: validated.advisories,
      };
    }
    if (options.contactHidden && bindings.usedInjected.includes("LeadSlot")) {
      return {
        ok: false,
        error: "themeSource must omit LeadSlot when contact is hidden",
        advisories: validated.advisories,
      };
    }
    if (options.generatorSchemaVersion != null) {
      const parsed = parseMediaManifest(options.generatorSchemaVersion, options.mediaManifest);
      if (!parsed.ok) return { ok: false, error: parsed.error, advisories: validated.advisories };
      if (bindings.dynamicMediaSlotCount > 0) {
        return {
          ok: false,
          error: "new-schema Media must use a literal slotId",
          advisories: validated.advisories,
        };
      }
      if (options.generatorSchemaVersion === 3 && options.sectionTopology != null) {
        if (bindings.dynamicSectionMarkerCount > 0)
          return {
            ok: false,
            error: "v3 section roots must use literal data-site-section markers",
            advisories: validated.advisories,
          };
        const topology = Array.isArray(options.sectionTopology)
          ? options.sectionTopology.flatMap((entry) =>
              entry &&
              typeof entry === "object" &&
              typeof (entry as { section?: unknown }).section === "string"
                ? [(entry as { section: string }).section]
                : [],
            )
          : [];
        const markerCounts = new Map<string, number>();
        for (const id of bindings.sectionMarkerIds)
          markerCounts.set(id, (markerCounts.get(id) ?? 0) + 1);
        if (topology.length === 0 || new Set(topology).size !== topology.length)
          return {
            ok: false,
            error: "v3 section topology must be non-empty and unique",
            advisories: validated.advisories,
          };
        if (
          bindings.sectionMarkerIds.length !== topology.length ||
          topology.some((id) => markerCounts.get(id) !== 1)
        )
          return {
            ok: false,
            error:
              "v3 themeSource must contain exactly one literal root marker per planned section",
            advisories: validated.advisories,
          };
      }
      const known = new Set(parsed.manifest.slots.map((slot) => slot.slotId));
      const used = new Set(bindings.mediaSlotIds);
      const unknown = bindings.mediaSlotIds.find((slotId) => !known.has(slotId));
      if (unknown)
        return {
          ok: false,
          error: `themeSource references unknown media slot ${unknown}`,
          advisories: validated.advisories,
        };
      const missing = parsed.manifest.slots.find((slot) => slot.required && !used.has(slot.slotId));
      if (missing)
        return {
          ok: false,
          error: `themeSource must reference required media slot ${missing.slotId}`,
          advisories: validated.advisories,
        };
      const video = parsed.manifest.slots.find((slot) => slot.mimeType.startsWith("video/"));
      if (video && !used.has(video.slotId))
        return {
          ok: false,
          error: `themeSource must reference video slot ${video.slotId}`,
          advisories: validated.advisories,
        };
    }
  } catch (error) {
    return {
      ok: false,
      error: `themeSource failed static analysis: ${error instanceof Error ? error.message : "invalid JavaScript"}`,
      advisories: validated.advisories,
    };
  }
  return { ok: true, advisories: validated.advisories };
}
