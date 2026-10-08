import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const source = (path) => readFileSync(resolve(root, path), "utf8");
const requiredMedia = [
  "hero.jpg",
  "hero-motion.mp4",
  "courtyard.jpg",
  "service-interior.jpg",
  "service-exterior.jpg",
  "service-cabinets.jpg",
  "service-doors.jpg",
  "zellige-detail.jpg",
  "proof-before.jpg",
  "proof-after.jpg",
  "process.jpg",
  "planning-wall.jpg",
  "reviews.jpg",
  "faq.jpg",
  "estimate.jpg",
  "guide-color.jpg",
  "guide-prep.jpg",
  "guide-sheen.jpg",
  "notes-wall.jpg",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const route = source("src/routes/templates.painter15.tsx");
const page = source("src/components/templates/PainterFifteenTemplatePage.tsx");
const css = source("src/components/templates/painter-fifteen/painter-fifteen.css");
const catalog = source("src/lib/template-catalog.ts");
const overlay = source("src/lib/template-content/overlay.ts");
const chrome = source("src/components/site-renderer/DemoLpChrome.tsx");
const checkout = source("src/lib/checkout.functions.ts");
const ledger = JSON.parse(source("public/templates/moroccan-zellige/generated/media-ledger.json"));

assert(route.includes('createFileRoute("/templates/painter15")'), "P15 route is missing");
assert(
  route.includes('templateId="tpl_painter15"'),
  "P15 route must pass its canonical tpl_* purchase identity to DemoLpChrome",
);
assert(route.includes("showBuyCta={true}"), "P15 must expose the shared purchase seam");
assert(route.includes("showDisclaimer={false}"), "P15 must own its truthful sample disclosures");
assert(
  overlay.includes('"painter15"') &&
    overlay.includes('"tpl_painter15"') &&
    overlay.includes('painter15: "tpl_painter15"') &&
    overlay.includes('tpl_painter15: "painter15"'),
  "P15 purchase identity must be registered in all overlay maps",
);
assert(catalog.includes('slug: "painter15"'), "P15 catalog entry is missing");
assert(
  catalog.includes('href: "/templates/painter15"') && catalog.includes('job: "painter"'),
  "P15 catalog card must link to its route and carry the painter job chip",
);
assert(
  chrome.includes("templateId") && checkout.includes('"CHK-T01"'),
  "P15 purchase must use the shared templateId seam and its fail-closed CHK-T01 guard",
);
assert(page.includes("<SiteBookingPayDemo"), "P15 must preserve the homeowner booking seam");
assert(page.includes('demoWording="walkthrough"'), "P15 booking must use walkthrough wording");
assert(!page.includes("p15-builder"), "P15 must not retain the removed Mosaic Builder");
assert(!css.includes("p15-builder"), "P15 styles must not retain the removed Mosaic Builder");
assert(page.includes("Review copy examples"), "P15 review-copy disclosure is missing");
assert(
  page.includes("Illustrative generated matched-scene study"),
  "P15 proof disclosure is missing",
);
assert(page.includes("prefers-reduced-motion"), "P15 hero requires a reduced-motion fallback");
assert(css.includes(".p15-hero-film video"), "P15 film styling is missing");
assert(css.includes(".p15-arch-frame"), "P15 must use its arch image grammar");
assert(css.includes(".p15-tile-surface"), "P15 must use its tile-grid component grammar");
assert(!css.includes("monospace"), "P15 must not use monospaced customer-facing type");
assert(
  !page.includes("demo/preview purposes"),
  "P15 must not use generic demo disclaimer boilerplate",
);
assert(ledger.route === "/templates/painter15", "P15 media ledger route does not match");
assert(
  ledger.pairs?.[0]?.sameProperty &&
    ledger.pairs?.[0]?.sameCameraRequired &&
    ledger.pairs?.[0]?.afterGeneratedFromBeforeReference,
  "P15 proof ledger is incomplete",
);

for (const file of requiredMedia) {
  const path = resolve(root, "public/templates/moroccan-zellige/generated", file);
  assert(existsSync(path), `P15 media is missing: ${file}`);
  assert(statSync(path).size > 10_000, `P15 media is unexpectedly small: ${file}`);
}

console.log("Painter 15 structure, disclosures, purchase identity, and local media verified.");
