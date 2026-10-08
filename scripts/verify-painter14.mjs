import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const source = (path) => readFileSync(resolve(root, path), "utf8");
const requiredMedia = [
  "hero.jpg",
  "hero-motion.mp4",
  "point-of-view.jpg",
  "finish-macro.jpg",
  "service-interior.jpg",
  "service-exterior.jpg",
  "service-cabinets.jpg",
  "service-doors.jpg",
  "proof-before.jpg",
  "proof-after.jpg",
  "process.jpg",
  "planning.jpg",
  "reviews.jpg",
  "faq.jpg",
  "estimate.jpg",
  "guide-color.jpg",
  "guide-prep.jpg",
  "guide-sheen.jpg",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const route = source("src/routes/templates.painter14.tsx");
const page = source("src/components/templates/PainterFourteenTemplatePage.tsx");
const css = source("src/components/templates/painter-fourteen/painter-fourteen.css");
const catalog = source("src/lib/template-catalog.ts");
const chrome = source("src/components/site-renderer/DemoLpChrome.tsx");
const overlay = source("src/lib/template-content/overlay.ts");
const ledger = JSON.parse(
  source("public/templates/juice-bar-renovation/generated/media-ledger.json"),
);

assert(route.includes('createFileRoute("/templates/painter14")'), "P14 route is missing");
assert(route.includes("showBuyCta={true}"), "P14 must expose the shared purchase seam");
assert(route.includes("showDisclaimer={false}"), "P14 must own its truthful sample disclosures");
assert(catalog.includes('slug: "painter14"'), "P14 catalog entry is missing");
assert(page.includes("<SiteBookingPayDemo"), "P14 must preserve homeowner booking");
assert(page.includes('demoWording="walkthrough"'), "P14 booking must use walkthrough wording");
assert(!page.includes("p14-blender"), "P14 must not retain the removed blender interaction");
assert(!css.includes("p14-blender"), "P14 styles must not retain the removed blender interaction");
assert(!css.includes("monospace"), "P14 must not use monospaced customer-facing type");
assert(!page.includes("p14-flavor-bar"), "P14 must not retain the removed top metadata strip");
assert(
  !css.includes("p14-flavor-bar"),
  "P14 styles must not retain the removed top metadata strip",
);
assert(
  route.includes('templateId="tpl_painter14"'),
  "P14 route must pass its canonical tpl_* purchase identity to DemoLpChrome",
);
assert(
  overlay.includes('painter14: "tpl_painter14"') && overlay.includes('tpl_painter14: "painter14"'),
  "P14 purchase identity must be registered in the overlay slug/id maps",
);
assert(chrome.includes("templateId"), "DemoLpChrome must accept the templateId identity seam");
assert(page.includes("Review copy examples"), "P14 review-copy disclosure is missing");
assert(
  page.includes("Illustrative generated matched-scene study"),
  "P14 proof disclosure is missing",
);
assert(page.includes("prefers-reduced-motion"), "P14 hero requires a reduced-motion fallback");
assert(css.includes(".p14-hero-film video"), "P14 film styling is missing");
assert(ledger.route === "/templates/painter14", "P14 media ledger route does not match");
assert(
  ledger.pairs?.[0]?.sameProperty && ledger.pairs?.[0]?.sameCameraRequired,
  "P14 proof ledger is incomplete",
);

for (const file of requiredMedia) {
  const path = resolve(root, "public/templates/juice-bar-renovation/generated", file);
  assert(existsSync(path), `P14 media is missing: ${file}`);
  assert(statSync(path).size > 10_000, `P14 media is unexpectedly small: ${file}`);
}

console.log("Painter 14 structure, disclosures, and local media verified.");
