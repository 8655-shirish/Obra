import { hasDroppedUnifiedKitTag, type ThemeKitScope } from "./kit-scope.ts";
import { mediaManifestFromConfig } from "./media-manifest.ts";

export type SiteRenderMode =
  | { kind: "standard" }
  | { kind: "generated"; scope: ThemeKitScope }
  | {
      kind: "unavailable";
      reason: "incomplete-unified" | "legacy-unified" | "unsupported-generator";
    };

function storedSource(config: Record<string, unknown>): string {
  return typeof config.themeSource === "string" ? config.themeSource.trim() : "";
}

/** One compatibility boundary for persisted site versions. */
export function classifySiteRenderMode(config: Record<string, unknown>): SiteRenderMode {
  const source = storedSource(config);
  const generator = config.generator;

  if (generator === "unified-site-agent") {
    const manifest = mediaManifestFromConfig(config);
    if (manifest.kind === "future" || manifest.kind === "invalid") {
      return { kind: "unavailable", reason: "unsupported-generator" };
    }
    if (!source) return { kind: "unavailable", reason: "incomplete-unified" };
    if (manifest.kind === "legacy") {
      return { kind: "generated", scope: hasDroppedUnifiedKitTag(source) ? "catalog" : "unified" };
    }
    if (hasDroppedUnifiedKitTag(source)) {
      return { kind: "unavailable", reason: "unsupported-generator" };
    }
    return { kind: "generated", scope: "unified" };
  }

  // Historical catalog themes predate a generator marker. Keep that path unchanged.
  if (generator == null || generator === "" || generator === "catalog") {
    return source ? { kind: "generated", scope: "catalog" } : { kind: "standard" };
  }

  // Never grant the catalog toolbox to an unknown explicit generator.
  return { kind: "unavailable", reason: "unsupported-generator" };
}

export function unavailableSiteMessage(
  reason: Extract<SiteRenderMode, { kind: "unavailable" }>["reason"],
): string {
  if (reason === "legacy-unified") {
    return "This design uses an older preview format and can no longer be shown. Regenerate it to create an updated design.";
  }
  if (reason === "incomplete-unified") {
    return "This design was not completed and cannot be shown. Regenerate it to try again.";
  }
  return "This design uses an unsupported preview format and cannot be shown.";
}
