import React, {
  Component,
  createElement,
  useEffect,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";

import * as SiteKit from "../components/site-kit/index.tsx";
import {
  googleFontStylesheetUrl,
  sanitizeCssFontFamily,
} from "../lib/site-theme/config-to-props.ts";
import {
  INTENT_PAINT_VARS,
  inkOnPrimaryHex,
  resolvePaintTokens,
} from "../lib/site-theme/design-spec.ts";
import { instantiateThemeModule } from "../lib/site-theme/eval-theme-module.ts";
import type { ThemeKitScope } from "../lib/site-theme/kit-scope.ts";
import type { SiteDesignSpec, SiteProps } from "../lib/site-theme/types.ts";
import { CANONICAL_SECTION_TYPES } from "../lib/agent/section-order.ts";

type Incoming = {
  type: "site-runtime-init";
  token: string;
  themeSource: string;
  props: SiteProps;
  designSpec?: SiteDesignSpec | null;
  kitScope: ThemeKitScope;
};

let root: Root | null = null;
let lastToken = "";
let geometryObserver: ResizeObserver | null = null;

function applyTokens(props: SiteProps, designSpec?: SiteDesignSpec | null): void {
  const rootEl = document.documentElement;
  const primary = props.primaryColor || "#1e3a5f";
  const inkOnPrimary = inkOnPrimaryHex(primary);
  const dark = props.theme === "dark";
  const paint = resolvePaintTokens(designSpec, props.lookAndFeel, {
    theme: props.theme,
    primaryColor: primary,
  });
  const intent = paint.intent;
  const bg = intent ? intent.ramp.bg : dark ? "#0b1220" : "#ffffff";
  const ink = intent ? intent.ramp.ink : dark ? "#f8fafc" : "#0f172a";
  rootEl.style.setProperty("--site-primary", primary);
  rootEl.style.setProperty("--site-on-primary", inkOnPrimary);
  rootEl.style.setProperty("--site-bg", bg);
  rootEl.style.setProperty("--site-ink", ink);
  const muted = intent ? intent.ramp.muted : dark ? "#94a3b8" : "#475569";
  rootEl.style.setProperty("--site-muted", muted);
  rootEl.style.setProperty("--site-muted-ramp", muted);
  rootEl.style.setProperty(
    "--site-hairline",
    intent ? intent.ramp.hairline : dark ? "#243044" : "#e2e8f0",
  );
  rootEl.style.setProperty(
    "--site-canvas-soft",
    intent ? intent.ramp.canvasSoft : dark ? "#121a2a" : "#f8fafc",
  );
  rootEl.style.colorScheme = dark ? "dark" : "light";
  let themeMeta = document.querySelector('meta[name="theme-color"]');
  if (!themeMeta) {
    themeMeta = document.createElement("meta");
    themeMeta.setAttribute("name", "theme-color");
    document.head.appendChild(themeMeta);
  }
  themeMeta.setAttribute("content", bg);
  const displayName = intent
    ? intent.fontDisplay
    : designSpec?.fontDisplay
      ? sanitizeCssFontFamily(designSpec.fontDisplay, "Georgia")
      : "Georgia";
  const sansName = intent
    ? intent.fontSans
    : designSpec?.fontSans
      ? sanitizeCssFontFamily(designSpec.fontSans, "system-ui")
      : "system-ui";
  const display = googleFontStylesheetUrl(displayName, intent?.displayWeights);
  const sans = googleFontStylesheetUrl(sansName, intent?.sansWeights);
  rootEl.style.setProperty("--site-font-display", `"${displayName}", Georgia, serif`);
  rootEl.style.setProperty("--site-font-sans", `"${sansName}", system-ui, sans-serif`);
  rootEl.style.setProperty("--site-radius", paint.radius);
  rootEl.style.setProperty("--site-h1", paint.h1);
  rootEl.style.setProperty("--site-h2", paint.h2);
  rootEl.style.setProperty("--site-h3", paint.h3);
  if (intent) {
    rootEl.style.setProperty("--site-section-pad-y", intent.sectionPadY);
    rootEl.style.setProperty("--site-section-pad-x", intent.sectionPadX);
    rootEl.style.setProperty("--site-section-max", intent.sectionMax);
    rootEl.style.setProperty("--site-section-margin", intent.sectionMargin);
    rootEl.style.setProperty("--site-grid-gap", intent.gridGap);
    rootEl.style.setProperty("--site-card-pad", intent.cardPad);
    rootEl.style.setProperty("--site-card-surface", intent.cardSurface);
    rootEl.style.setProperty("--site-elevation", intent.elevation);
    rootEl.style.setProperty("--site-media-ratio", intent.mediaRatio);
    rootEl.style.setProperty("--site-font-h1", intent.fontH1);
    rootEl.style.setProperty("--site-font-h2", intent.fontH2);
    rootEl.style.setProperty("--site-font-h3", intent.fontH3);
    rootEl.style.setProperty("--site-weight-h1", intent.weightH1);
    rootEl.style.setProperty("--site-weight-h2", intent.weightH2);
    rootEl.style.setProperty("--site-weight-h3", intent.weightH3);
    rootEl.style.setProperty("--site-tracking-h1", intent.trackingH1);
    rootEl.style.setProperty("--site-tracking-h2", intent.trackingH2);
    rootEl.style.setProperty("--site-tracking-h3", intent.trackingH3);
    rootEl.style.setProperty("--site-leading-h1", intent.leadingH1);
    rootEl.style.setProperty("--site-leading-h2", intent.leadingH2);
    rootEl.style.setProperty("--site-leading-h3", intent.leadingH3);
  } else {
    for (const name of INTENT_PAINT_VARS) {
      rootEl.style.removeProperty(name);
    }
  }
  document.body.style.background = "var(--site-bg)";
  document.body.style.color = "var(--site-ink)";
  document.body.style.fontFamily = "var(--site-font-sans)";
  document.body.style.margin = "0";

  for (const href of [display, sans]) {
    if (!href) continue;
    if (
      [...document.querySelectorAll("link[data-site-font]")].some(
        (n) => n.getAttribute("href") === href,
      )
    ) {
      continue;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-site-font", "true");
    document.head.appendChild(link);
  }
}

function postGeometry(token: string): void {
  const seen = new Set<string>();
  const sections: Array<{ id: string; top: number; height: number }> = [];

  for (const node of document.querySelectorAll("[data-site-section]")) {
    const id = node.getAttribute("data-site-section") ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const rect = node.getBoundingClientRect();
    sections.push({ id, top: rect.top, height: rect.height });
  }

  for (const id of CANONICAL_SECTION_TYPES) {
    if (seen.has(id)) continue;
    const node = document.getElementById(id);
    if (!node) continue;
    seen.add(id);
    const rect = node.getBoundingClientRect();
    sections.push({ id, top: rect.top, height: rect.height });
  }

  sections.sort((a, b) => a.top - b.top);

  window.parent.postMessage(
    {
      type: "site-runtime-geometry",
      token,
      height: window.innerHeight,
      scrollY: window.scrollY,
      sections,
    },
    "*",
  );
}

function refreshTailwind(): void {
  const tw = (window as unknown as { tailwind?: { refresh?: () => void } }).tailwind;
  tw?.refresh?.();
}

const RUNTIME_FAILURE_COPY = "The generated design could not be shown.";

function runtimeFailureElement(): ReactNode {
  return createElement(
    "p",
    {
      style: {
        margin: 0,
        padding: "1rem",
        fontFamily: "system-ui, sans-serif",
        fontSize: "0.875rem",
      },
    },
    RUNTIME_FAILURE_COPY,
  );
}

function RuntimeHealthy({ token }: { token: string }): null {
  useEffect(() => {
    window.parent.postMessage({ type: "site-runtime-healthy", token }, "*");
  }, [token]);
  return null;
}

class ThemeErrorBoundary extends Component<
  { token: string; children?: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    window.parent.postMessage(
      {
        type: "site-runtime-error",
        token: this.props.token,
        error: error.message || "Theme failed to render",
      },
      "*",
    );
  }

  override render(): ReactNode {
    if (this.state.failed) return runtimeFailureElement();
    return this.props.children ?? null;
  }
}

function compileSite(
  themeSource: string,
  kitScope: ThemeKitScope,
): ComponentType<SiteProps> | null {
  const instantiated = instantiateThemeModule(themeSource, { React, SiteKit }, kitScope);
  if (!instantiated.ok) return null;
  return instantiated.Site as ComponentType<SiteProps>;
}

function dropRoot(): void {
  geometryObserver?.disconnect();
  geometryObserver = null;
  if (!root) return;
  root.unmount();
  root = null;
  delete (window as unknown as { __SITE_RUNTIME_TOKEN?: string }).__SITE_RUNTIME_TOKEN;
}

function mount(payload: Incoming): void {
  lastToken = payload.token;
  applyTokens(payload.props, payload.designSpec);
  const mountNode = document.getElementById("root");
  if (!mountNode) {
    throw new Error("Theme failed to compile");
  }
  dropRoot();
  (window as unknown as { __SITE_RUNTIME_TOKEN?: string }).__SITE_RUNTIME_TOKEN = payload.token;
  const Site = compileSite(payload.themeSource, payload.kitScope);
  root = createRoot(mountNode);
  if (!Site) {
    root.render(runtimeFailureElement());
    throw new Error("Theme failed to compile");
  }
  root.render(
    createElement(
      ThemeErrorBoundary,
      { token: payload.token },
      createElement(
        SiteKit.GalleryProvider,
        { items: payload.props.media },
        createElement(
          SiteKit.SiteMediaSlotsProvider,
          { slots: payload.props.mediaSlots },
          createElement(
            SiteKit.SiteKitMotionRoot,
            { enableMotion: payload.props.enableMotion },
            createElement(
              SiteKit.SiteEvidenceProvider,
              {
                media: payload.props.media,
                reviews: payload.props.reviews,
                sections: payload.props.sections,
                hours: payload.props.hours,
                warranty: payload.props.warranty,
                services: payload.props.services,
                contactHidden: payload.props.contactHidden,
                businessName: payload.props.businessName,
                licenseNumber: payload.props.licenseNumber,
                city: payload.props.city,
                phone: payload.props.phone,
                address: payload.props.address,
                logoUrl: payload.props.logoUrl,
              },
              createElement(
                SiteKit.SiteKitBookingRoot,
                {
                  canOpenBooking: payload.props.canOpenBooking === true,
                  conversionAsk: payload.props.conversionAsk ?? null,
                },
                createElement(
                  React.Fragment,
                  null,
                  createElement(Site, payload.props),
                  createElement(RuntimeHealthy, { token: payload.token }),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  requestAnimationFrame(() => {
    refreshTailwind();
    postGeometry(payload.token);
  });
  if (typeof ResizeObserver !== "undefined") {
    geometryObserver = new ResizeObserver(() => postGeometry(payload.token));
    geometryObserver.observe(mountNode);
  }
}

let initAccepted = false;
let readyPulse: ReturnType<typeof setInterval> | null = null;

function announceReady(): void {
  if (initAccepted) return;
  window.parent.postMessage({ type: "site-runtime-ready" }, "*");
}

window.addEventListener("message", (event) => {
  const data = event.data as Incoming | undefined;
  if (
    !data ||
    data.type !== "site-runtime-init" ||
    typeof data.token !== "string" ||
    (data.kitScope !== "catalog" && data.kitScope !== "unified")
  )
    return;
  initAccepted = true;
  if (readyPulse !== null) {
    clearInterval(readyPulse);
    readyPulse = null;
  }
  try {
    mount(data);
  } catch (error) {
    window.parent.postMessage(
      {
        type: "site-runtime-error",
        token: data.token,
        error: error instanceof Error ? error.message : "Theme failed to render",
      },
      "*",
    );
  }
});

window.addEventListener("resize", () => {
  if (lastToken) postGeometry(lastToken);
});

window.addEventListener(
  "scroll",
  () => {
    if (lastToken) postGeometry(lastToken);
  },
  { passive: true },
);

announceReady();
readyPulse = setInterval(announceReady, 250);
