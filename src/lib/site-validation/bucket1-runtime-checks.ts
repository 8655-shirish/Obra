import type {
  Bucket1RuntimeCheckEvidence,
  Bucket1ValidationContract,
} from "./bucket1-contract.ts";

export type Bucket1BrowserCheckResult = {
  checks: Bucket1RuntimeCheckEvidence[];
  metrics: {
    documentHeight: number;
    rootWidth: number;
    sectionCount: number;
    textLength: number;
  };
};

/** Objective DOM checks executed inside the existing isolated site runtime. */
export function collectBucket1BrowserChecks(args: {
  runtimeErrors: string[];
  contactHidden: boolean;
  tolerances: Bucket1ValidationContract["tolerances"];
}): Bucket1BrowserCheckResult {
  type Region = Bucket1RuntimeCheckEvidence["region"];
  type Evidence = Bucket1RuntimeCheckEvidence;
  const checks: Evidence[] = [];
  const short = (value: unknown): string =>
    String(value).replace(/\s+/g, " ").trim().slice(0, 1800);
  const passed = (checkId: Evidence["checkId"], expected: string, threshold: string): void => {
    checks.push({
      checkId,
      status: "passed",
      region: { kind: "document", id: "document" },
      observed: "No contract violation observed.",
      expected,
      threshold,
      repairInstruction: null,
    });
  };
  const failed = (
    checkId: Evidence["checkId"],
    node: Element | null,
    observed: string,
    expected: string,
    threshold: string,
    repairInstruction: string,
    forcedRegion?: Region,
  ): void => {
    let region = forcedRegion;
    if (!region && node) {
      if (node.hasAttribute("data-site-media")) {
        region = {
          kind: "media-slot",
          id: short(
            node.getAttribute("data-site-media-slot") ||
              node.getAttribute("src") ||
              node.getAttribute("poster") ||
              "media",
          ),
        };
      } else {
        const section = node.closest("[data-site-section]");
        if (section) {
          region = {
            kind: "site-section",
            id: short(section.getAttribute("data-site-section") || "section"),
          };
        } else if (node.id) {
          region = { kind: "selector", id: "#" + short(node.id) };
        } else {
          region = { kind: "selector", id: short(node.tagName.toLowerCase()) };
        }
      }
    }
    checks.push({
      checkId,
      status: "failed",
      region: region ?? { kind: "document", id: "document" },
      observed: short(observed),
      expected: short(expected),
      threshold: short(threshold),
      repairInstruction: short(repairInstruction),
    });
  };
  const visible = (node: Element): boolean => {
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0 ||
      node.getAttribute("aria-hidden") === "true"
    )
      return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  };
  const interactiveSelector =
    'a[href],button,input:not([type="hidden"]),select,textarea,summary,[tabindex],[role="button"],[role="link"]';

  if (args.runtimeErrors.length > 0) {
    failed(
      "runtime-errors",
      null,
      args.runtimeErrors.join(" | "),
      "The isolated runtime must render without uncaught errors or error-level diagnostics.",
      "0 runtime errors",
      "Correct the candidate code or bound props that throw during rendering.",
    );
  } else {
    passed("runtime-errors", "The isolated runtime renders without uncaught errors.", "0 runtime errors");
  }

  const documentOverflow = Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    (document.body?.scrollWidth ?? 0) - document.documentElement.clientWidth,
  );
  if (documentOverflow > args.tolerances.overflowPx) {
    const offenders = [...document.querySelectorAll("body *")]
      .filter(visible)
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.right > document.documentElement.clientWidth + args.tolerances.overflowPx ||
          rect.left < -args.tolerances.overflowPx,
      )
      .sort((a, b) => b.rect.right - a.rect.right);
    failed(
      "horizontal-overflow",
      offenders[0]?.node ?? document.documentElement,
      "Document overflows horizontally by " + documentOverflow.toFixed(2) + "px.",
      "Content must fit the viewport without document-level horizontal scrolling.",
      "overflow <= " + args.tolerances.overflowPx + "px",
      "Constrain, wrap, or responsively stack the overflowing element.",
    );
  } else {
    passed(
      "horizontal-overflow",
      "No document-level horizontal overflow.",
      "overflow <= " + args.tolerances.overflowPx + "px",
    );
  }

  let clipped:
    | { parent: Element; child: Element; amount: number; axis: "horizontal" | "vertical" }
    | undefined;
  for (const parent of [...document.querySelectorAll("body *")].slice(0, 3000)) {
    if (!visible(parent) || parent.hasAttribute("data-site-media")) continue;
    const style = getComputedStyle(parent);
    const clipX = style.overflowX === "hidden" || style.overflowX === "clip";
    const clipY = style.overflowY === "hidden" || style.overflowY === "clip";
    if (!clipX && !clipY) continue;
    const outer = parent.getBoundingClientRect();
    for (const child of [...parent.children].slice(0, 100)) {
      if (!visible(child) || child.hasAttribute("data-site-media")) continue;
      const inner = child.getBoundingClientRect();
      const horizontal = Math.max(outer.left - inner.left, inner.right - outer.right, 0);
      const vertical = Math.max(outer.top - inner.top, inner.bottom - outer.bottom, 0);
      if (clipX && horizontal > args.tolerances.clippingPx) {
        clipped = { parent, child, amount: horizontal, axis: "horizontal" };
        break;
      }
      if (clipY && vertical > args.tolerances.clippingPx) {
        clipped = { parent, child, amount: vertical, axis: "vertical" };
        break;
      }
    }
    if (clipped) break;
  }
  if (clipped) {
    failed(
      "clipping",
      clipped.child,
      "Visible child is clipped by " + clipped.amount.toFixed(2) + "px on the " + clipped.axis + " axis.",
      "Visible non-media content must not be unintentionally clipped by an ancestor.",
      "clipping <= " + args.tolerances.clippingPx + "px",
      "Remove the clipping overflow or resize/reflow the child at this viewport.",
    );
  } else {
    passed(
      "clipping",
      "Visible non-media content is not clipped by overflow containers.",
      "clipping <= " + args.tolerances.clippingPx + "px",
    );
  }

  const interactives = [...document.querySelectorAll(interactiveSelector)].filter(visible).slice(0, 400);
  let overlap: { a: Element; b: Element; area: number } | undefined;
  for (let index = 0; index < interactives.length && !overlap; index += 1) {
    const a = interactives[index]!;
    const ar = a.getBoundingClientRect();
    for (let other = index + 1; other < interactives.length; other += 1) {
      const b = interactives[other]!;
      if (a.contains(b) || b.contains(a)) continue;
      const br = b.getBoundingClientRect();
      const area =
        Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left)) *
        Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
      if (area > args.tolerances.overlapAreaPx2) {
        overlap = { a, b, area };
        break;
      }
    }
  }
  if (overlap) {
    failed(
      "interactive-overlap",
      overlap.a,
      "Two independent interactive targets overlap by " + overlap.area.toFixed(2) + "px2.",
      "Independent interactive targets must have non-overlapping hit areas.",
      "overlap area <= " + args.tolerances.overlapAreaPx2 + "px2",
      "Reflow or separate the overlapping interactive targets.",
    );
  } else {
    passed(
      "interactive-overlap",
      "Independent interactive targets do not overlap.",
      "overlap area <= " + args.tolerances.overlapAreaPx2 + "px2",
    );
  }

  const media = [...document.querySelectorAll("img,video")].filter(visible);
  const badMedia = media.find((node) => {
    if (!node.hasAttribute("data-site-media")) return true;
    const rect = node.getBoundingClientRect();
    const parent = node.parentElement?.getBoundingClientRect();
    if (!parent) return true;
    return (
      rect.left < parent.left - args.tolerances.clippingPx ||
      rect.right > parent.right + args.tolerances.clippingPx ||
      rect.top < parent.top - args.tolerances.clippingPx ||
      rect.bottom > parent.bottom + args.tolerances.clippingPx ||
      rect.width <= 0 ||
      rect.height <= 0
    );
  });
  if (badMedia) {
    failed(
      "media-containment",
      badMedia,
      badMedia.hasAttribute("data-site-media")
        ? "Media bounds escape their containing element."
        : "Rendered media is missing the versioned data-site-media marker.",
      "All rendered media must use the host media adapter and remain inside its container.",
      "containment delta <= " + args.tolerances.clippingPx + "px",
      "Render the asset through Media and constrain its container at this viewport.",
    );
  } else {
    passed(
      "media-containment",
      "All rendered media uses the host adapter and remains contained.",
      "containment delta <= " + args.tolerances.clippingPx + "px",
    );
  }

  const leadForms = [...document.querySelectorAll("form")].filter(visible);
  const leadSubmit = leadForms.find((form) =>
    form.querySelector('button[type="submit"],input[type="submit"],button:not([type])'),
  );
  if ((!args.contactHidden && !leadSubmit) || (args.contactHidden && leadForms.length > 0)) {
    failed(
      "lead-action",
      leadForms[0] ?? document.querySelector('[data-site-section="contact"]'),
      args.contactHidden
        ? "Found " + leadForms.length + " visible form(s) while contact is hidden."
        : "No visible lead form with a submit action was found.",
      args.contactHidden
        ? "Contact-hidden candidates expose no lead action."
        : "A visible LeadSlot form exposes a submit action.",
      args.contactHidden ? "0 visible forms" : "at least 1 visible submit action",
      args.contactHidden
        ? "Remove contact and lead controls when contactHidden is true."
        : "Render LeadSlot in the contact section with its host-bound fields.",
      { kind: "lead-slot", id: "lead-slot" },
    );
  } else {
    passed(
      "lead-action",
      args.contactHidden
        ? "No lead action is exposed while contact is hidden."
        : "A visible host lead action is present.",
      args.contactHidden ? "0 visible forms" : "at least 1 visible submit action",
    );
  }

  const accessibleName = (node: Element): string => {
    const labelledBy = node.getAttribute("aria-labelledby");
    const labelled = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
      : "";
    const input = node as HTMLInputElement;
    const label = input.labels ? [...input.labels].map((entry) => entry.textContent ?? "").join(" ") : "";
    const imageAlt = node.querySelector("img[alt]")?.getAttribute("alt") ?? "";
    return short(
      node.getAttribute("aria-label") ||
        labelled ||
        label ||
        node.textContent ||
        input.value ||
        node.getAttribute("title") ||
        imageAlt,
    );
  };
  const unnamed = interactives.find((node) => accessibleName(node).length === 0);
  if (unnamed) {
    failed(
      "accessible-names",
      unnamed,
      "Visible interactive target has no accessible name.",
      "Every visible interactive target has a non-empty accessible name.",
      "0 unnamed interactive targets",
      "Add visible label text, aria-label, or a valid aria-labelledby reference.",
    );
  } else {
    passed(
      "accessible-names",
      "Every visible interactive target has an accessible name.",
      "0 unnamed interactive targets",
    );
  }

  const mains = [...document.querySelectorAll("main")].filter(visible);
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible);
  const h1s = headings.filter((heading) => heading.tagName === "H1");
  let headingProblem: Element | null = null;
  let previousLevel = 0;
  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1));
    if (!short(heading.textContent).length || (previousLevel > 0 && level > previousLevel + 1)) {
      headingProblem = heading;
      break;
    }
    previousLevel = level;
  }
  if (mains.length !== 1 || h1s.length !== 1 || headingProblem) {
    failed(
      "heading-landmarks",
      headingProblem ?? mains[0] ?? h1s[0] ?? null,
      "Found " + mains.length + " visible main landmark(s), " + h1s.length + " visible h1(s)" +
        (headingProblem ? ", and an empty or skipped heading level." : "."),
      "The document has exactly one visible main, one non-empty h1, and no skipped heading levels.",
      "main=1, h1=1, heading level increment <= 1",
      "Restore a single main landmark and a sequential, non-empty heading outline.",
    );
  } else {
    passed(
      "heading-landmarks",
      "One main landmark, one h1, and a sequential heading outline are present.",
      "main=1, h1=1, heading level increment <= 1",
    );
  }

  const focusables = interactives.filter((node) => {
    const control = node as HTMLButtonElement;
    return !control.disabled && node.getAttribute("aria-disabled") !== "true" && control.tabIndex >= 0;
  });
  const positiveTabIndex = focusables.find((node) => (node as HTMLElement).tabIndex > 0);
  const unfocusable = focusables.find((node) => {
    (node as HTMLElement).focus();
    return document.activeElement !== node;
  });
  if (positiveTabIndex || unfocusable) {
    failed(
      "keyboard-navigation",
      positiveTabIndex ?? unfocusable ?? null,
      positiveTabIndex
        ? "Interactive target uses positive tabIndex " + (positiveTabIndex as HTMLElement).tabIndex + "."
        : "Interactive target could not receive programmatic keyboard focus.",
      "Visible enabled controls participate in natural document-order keyboard navigation.",
      "tabIndex <= 0 and every enabled target focusable",
      "Use native controls in DOM order and remove positive tabIndex overrides.",
    );
  } else {
    passed(
      "keyboard-navigation",
      "Visible enabled controls participate in natural keyboard focus order.",
      "tabIndex <= 0 and every enabled target focusable",
    );
  }

  let badAction: Element | undefined;
  let actionReason = "";
  for (const node of focusables) {
    if (node instanceof HTMLAnchorElement) {
      const href = node.getAttribute("href")?.trim() ?? "";
      if (!href || href === "#") {
        badAction = node;
        actionReason = "Anchor has an empty action target.";
        break;
      }
      if (href.startsWith("#") && !document.getElementById(decodeURIComponent(href.slice(1)))) {
        badAction = node;
        actionReason = "Anchor target " + href + " does not exist.";
        break;
      }
    }
    if (node instanceof HTMLButtonElement && node.type === "submit" && !node.form) {
      badAction = node;
      actionReason = "Submit button is not associated with a form.";
      break;
    }
  }
  if (badAction) {
    failed(
      "focus-actions",
      badAction,
      actionReason,
      "Every focusable action resolves to a valid in-document target or form action.",
      "0 invalid focus actions",
      "Bind the control to an existing section, valid URL, or containing form.",
    );
  } else {
    passed(
      "focus-actions",
      "Every focusable action has a valid target or form association.",
      "0 invalid focus actions",
    );
  }

  const parseColor = (value: string): [number, number, number, number] | null => {
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1]!.replaceAll(",", " ").split(/\s+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channels = parts.slice(0, 3).map((part) => Number.parseFloat(part));
    const alpha = parts[3] == null ? 1 : Number.parseFloat(parts[3].replace("/", ""));
    if (channels.some((part) => !Number.isFinite(part)) || !Number.isFinite(alpha)) return null;
    return [channels[0]!, channels[1]!, channels[2]!, alpha];
  };
  const composite = (
    foreground: [number, number, number, number],
    background: [number, number, number, number],
  ): [number, number, number, number] => {
    const alpha = foreground[3] + background[3] * (1 - foreground[3]);
    if (alpha <= 0) return [255, 255, 255, 1];
    return [
      (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
      (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
      (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
      alpha,
    ];
  };
  const backgroundFor = (element: Element): [number, number, number, number] => {
    const layers: [number, number, number, number][] = [];
    let current: Element | null = element;
    while (current) {
      const parsed = parseColor(getComputedStyle(current).backgroundColor);
      if (parsed && parsed[3] > 0) layers.push(parsed);
      current = current.parentElement;
    }
    let result: [number, number, number, number] = [255, 255, 255, 1];
    for (const layer of layers.reverse()) result = composite(layer, result);
    return result;
  };
  const luminance = (color: [number, number, number, number]): number => {
    const values = color.slice(0, 3).map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
  };
  const contrastRatio = (
    foreground: [number, number, number, number],
    background: [number, number, number, number],
  ): number => {
    const first = luminance(composite(foreground, background));
    const second = luminance(background);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let contrastFailure: { element: Element; ratio: number; minimum: number } | undefined;
  let textNodes = 0;
  while (walker.nextNode() && textNodes < 2500) {
    const text = walker.currentNode;
    if (!short(text.textContent).length || !(text.parentElement instanceof Element)) continue;
    const element = text.parentElement;
    if (!visible(element)) continue;
    textNodes += 1;
    const style = getComputedStyle(element);
    const foreground = parseColor(style.color);
    if (!foreground) continue;
    const fontSize = Number.parseFloat(style.fontSize);
    const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const minimum = large
      ? args.tolerances.minimumLargeTextContrast
      : args.tolerances.minimumNormalTextContrast;
    const actual = contrastRatio(foreground, backgroundFor(element));
    if (actual + 0.001 < minimum) {
      contrastFailure = { element, ratio: actual, minimum };
      break;
    }
  }
  if (contrastFailure) {
    failed(
      "contrast",
      contrastFailure.element,
      "Computed text contrast is " + contrastFailure.ratio.toFixed(2) + ":1.",
      "Text contrast is at least " + contrastFailure.minimum + ":1 for this text size and weight.",
      "contrast >= " + contrastFailure.minimum + ":1",
      "Use foreground and background tokens with sufficient computed WCAG contrast.",
    );
  } else {
    passed(
      "contrast",
      "Visible text meets the versioned WCAG contrast thresholds.",
      "normal >= " + args.tolerances.minimumNormalTextContrast + ":1; large >= " +
        args.tolerances.minimumLargeTextContrast + ":1",
    );
  }

  const root = document.getElementById("root");
  const rootRect = root?.getBoundingClientRect();
  const visibleMain = mains[0]?.getBoundingClientRect();
  const severe =
    !root ||
    !rootRect ||
    root.childElementCount === 0 ||
    rootRect.width < window.innerWidth * 0.5 ||
    !Number.isFinite(document.documentElement.scrollHeight) ||
    document.documentElement.scrollHeight <= 0 ||
    (visibleMain != null &&
      (visibleMain.right < 0 ||
        visibleMain.left > window.innerWidth ||
        visibleMain.bottom < 0 ||
        visibleMain.width < window.innerWidth * 0.35));
  if (severe) {
    failed(
      "severe-responsive-regression",
      root,
      "Root width " + (rootRect?.width.toFixed(2) ?? "missing") + "px at " + window.innerWidth +
        "px viewport; rendered root children " + (root?.childElementCount ?? 0) + ".",
      "The rendered site retains an in-viewport, non-collapsed content root at every contract viewport.",
      "root width >= 50% viewport and at least 1 rendered child",
      "Restore responsive width, content flow, and in-viewport main content for this breakpoint.",
    );
  } else {
    passed(
      "severe-responsive-regression",
      "The rendered content root remains non-collapsed and in the viewport.",
      "root width >= 50% viewport and at least 1 rendered child",
    );
  }

  return {
    checks,
    metrics: {
      documentHeight: document.documentElement.scrollHeight,
      rootWidth: rootRect?.width ?? 0,
      sectionCount: document.querySelectorAll("[data-site-section]").length,
      textLength: short(root?.textContent ?? "").length,
    },
  };
}
