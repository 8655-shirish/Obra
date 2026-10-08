import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const source = (path) => readFileSync(resolve(root, path), "utf8");
const requiredMedia = [
  "hero.jpg",
  "hero-motion.mp4",
  "flavor-wall.jpg",
  "service-interior.jpg",
  "service-exterior.jpg",
  "service-cabinets.jpg",
  "service-trim.jpg",
  "ceramic-detail.jpg",
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

const route = source("src/routes/templates.painter13.tsx");
const page = source("src/components/templates/PainterThirteenTemplatePage.tsx");
const css = source("src/components/templates/painter-thirteen/painter-thirteen.css");
const catalog = source("src/lib/template-catalog.ts");
const overlay = source("src/lib/template-content/overlay.ts");
const ledger = JSON.parse(source("public/templates/blueberry-gelato/generated/media-ledger.json"));

assert(route.includes('createFileRoute("/templates/painter13")'), "P13 route is missing");
assert(route.includes("showBuyCta={true}"), "P13 must expose the shared purchase seam");
assert(
  route.includes('templateId="tpl_painter13"'),
  "P13 route must pass its canonical tpl_* purchase identity to DemoLpChrome",
);
assert(
  overlay.includes('painter13: "tpl_painter13"') && overlay.includes('tpl_painter13: "painter13"'),
  "P13 purchase identity must be registered in the overlay slug/id maps",
);
assert(route.includes("showDisclaimer={false}"), "P13 must own its truthful sample disclosures");
assert(catalog.includes('slug: "painter13"'), "P13 catalog entry is missing");
assert(page.includes("<SiteBookingPayDemo"), "P13 must preserve the homeowner booking seam");
assert(page.includes('demoWording="walkthrough"'), "P13 booking uses the walkthrough wording");
assert(!page.includes("p13-recipe"), "P13 must not retain the removed color selector");
assert(!css.includes(".p13-recipe"), "P13 styles must not retain the removed color selector");
assert(page.includes("Review copy examples."), "P13 review-copy disclosure is missing");
assert(
  page.includes("Illustrative generated matched-scene study"),
  "P13 proof disclosure is missing",
);
assert(page.includes("prefers-reduced-motion"), "P13 hero requires a reduced-motion fallback");
assert(css.includes(".p13-hero-film video"), "P13 film styling is missing");
assert(ledger.route === "/templates/painter13", "P13 media ledger route does not match");
assert(
  ledger.pairs?.[0]?.sameProperty && ledger.pairs?.[0]?.sameCameraRequired,
  "P13 proof ledger is incomplete",
);

for (const file of requiredMedia) {
  const path = resolve(root, "public/templates/blueberry-gelato/generated", file);
  assert(existsSync(path), `P13 media is missing: ${file}`);
  assert(statSync(path).size > 10_000, `P13 media is unexpectedly small: ${file}`);
}

console.log("Painter 13 structure, disclosures, and local media verified.");
