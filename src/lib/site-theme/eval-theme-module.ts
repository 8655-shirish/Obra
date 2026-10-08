import { transform } from "sucrase";

import { stripThemeExports } from "./validate-theme-source.ts";
import {
  pickSiteKit,
  themeModulePreamble,
  type ThemeKitScope,
} from "./kit-scope.ts";

export type ThemeModuleRuntime = {
  React: unknown;
  SiteKit: unknown;
};

export type { ThemeKitScope };

/** Sucrase parse only. Safe on the generate worker (no eval). */
export function transformThemeModule(
  source: string,
): { ok: true; js: string } | { ok: false; error: string } {
  try {
    const js = transform(stripThemeExports(source), {
      transforms: ["typescript", "jsx"],
      jsxRuntime: "classic",
      production: true,
    }).code;
    return { ok: true, js };
  } catch (error) {
    return {
      ok: false,
      error: `themeSource failed to compile: ${error instanceof Error ? error.message : "syntax error"}`,
    };
  }
}

/** Iframe-only: parse then run. Do not call from generate. */
export function instantiateThemeModule(
  source: string,
  runtime: ThemeModuleRuntime,
  scope: ThemeKitScope = "catalog",
): { ok: true; Site: (...args: never[]) => unknown } | { ok: false; error: string } {
  const transformed = transformThemeModule(source);
  if (!transformed.ok) return transformed;
  const siteKit = pickSiteKit(runtime.SiteKit, scope);
  const preamble = themeModulePreamble(scope);
  try {
    const factory = new Function("React", "SiteKit", `${preamble}${transformed.js}\nreturn Site;`);
    const Site = factory(runtime.React, siteKit);
    if (typeof Site !== "function") {
      return { ok: false, error: "themeSource failed to compile: Site is not a function" };
    }
    return { ok: true, Site };
  } catch (error) {
    return {
      ok: false,
      error: `themeSource failed to compile: ${error instanceof Error ? error.message : "syntax error"}`,
    };
  }
}
