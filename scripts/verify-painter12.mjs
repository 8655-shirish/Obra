import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const page = readFileSync("src/components/templates/PainterTwelveTemplatePage.tsx", "utf8");
const route = readFileSync("src/routes/templates.painter12.tsx", "utf8");
const css = readFileSync("src/components/templates/painter-twelve/painter-twelve.css", "utf8");
const catalog = readFileSync("src/lib/template-catalog.ts", "utf8");
const ledgerPath = "public/templates/lemonade-stand/generated/media-ledger.json";
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const mediaRoot = "public/templates/lemonade-stand/generated";

for (const fragment of [
  "PainterTwelveTemplatePage",
  "SiteBookingPayDemo",
  "ProjectPostcard",
  "FieldNoteDialog",
  "reviewExamples",
  "blogArticles",
  "Paint the neighborhood",
  'demoWording="walkthrough"',
  "/templates/garden-delite/brands/google.svg",
  "/templates/garden-delite/brands/yelp.svg",
]) {
  assert.ok(page.includes(fragment), `Painter 12 page missing ${fragment}`);
}

for (const fragment of [
  'createFileRoute("/templates/painter12")',
  "DemoLpChrome",
  "showBuyCta={true}",
  "showDisclaimer={false}",
  "NOINDEX_META",
]) {
  assert.ok(route.includes(fragment), `Painter 12 route missing ${fragment}`);
}

for (const fragment of [
  'slug: "painter12"',
  'variant: "Lemonade Stand"',
  'href: "/templates/painter12"',
  'previewImage: "/templates/lemonade-stand/generated/hero.jpg"',
]) {
  assert.ok(catalog.includes(fragment), `Painter 12 catalog entry missing ${fragment}`);
}

for (const fragment of [
  "@font-face",
  'url("/templates/lemonade-stand/fredoka-latin.woff2")',
  'url("/templates/lemonade-stand/caveat-brush-latin.woff2")',
  "@media (prefers-reduced-motion: reduce)",
  ".p12-hero-art video",
  ".p12-postcard-dialog",
  ".p12-article-dialog",
  ".p12-review-grid",
  ".p12-hero-copy",
  "position: relative",
  "--p12-cherry: #7a2034",
]) {
  assert.ok(css.includes(fragment), `Painter 12 style missing ${fragment}`);
}

for (const forbidden of ["ThreeUI", "Three.js", "component library", "pattern catalog"]) {
  assert.ok(
    !page.includes(forbidden),
    `customer-facing page includes forbidden attribution ${forbidden}`,
  );
}

for (const forbidden of [
  "demo/preview purposes only",
  "Demo scheduling",
  "Sample only",
  "sample editorial content",
]) {
  assert.ok(!page.includes(forbidden), `Painter 12 includes forbidden boilerplate: ${forbidden}`);
}

assert.match(page, /const reviewExamples = \[[\s\S]+Google-style card[\s\S]+Yelp-style card/);
assert.equal((page.match(/readTime:/g) ?? []).length, 3, "Painter 12 needs three full field notes");
assert.equal(
  (page.match(/sections: \[/g) ?? []).length,
  3,
  "Each field note needs article sections",
);

assert.equal(ledger.template, "painter12-lemonade-stand");
assert.equal(ledger.mediaKind, "photorealistic-generated-photography");
assert.equal(ledger.pairs.length, 4);
for (const pair of ledger.pairs) {
  assert.equal(pair.sameProperty, true, `${pair.id} is not marked same-property`);
  assert.equal(pair.sameCameraRequired, true, `${pair.id} is not camera-locked`);
  assert.equal(
    pair.afterGeneratedFromBeforeReference,
    true,
    `${pair.id} after image was not generated from its before reference`,
  );
  for (const file of [pair.before, pair.after]) {
    assert.ok(existsSync(`${mediaRoot}/${file}`), `missing comparison asset ${file}`);
  }
}

for (const [file, evidence] of Object.entries(ledger.assets)) {
  const path = `${mediaRoot}/${file}`;
  assert.ok(existsSync(path), `missing Painter 12 asset ${file}`);
  assert.ok(statSync(path).size > 100, `empty Painter 12 asset ${file}`);
  assert.equal(evidence.provider, "Higgsfield", `${file} lacks provider evidence`);
  assert.match(evidence.sha256, /^[a-f0-9]{64}$/, `${file} lacks a content hash`);
  if (file.endsWith(".jpg")) {
    assert.equal(evidence.width, 1600, `${file} has the wrong width`);
    assert.equal(evidence.height, 1000, `${file} has the wrong height`);
    for (const variant of Object.values(evidence.variants)) {
      assert.ok(
        existsSync(`${mediaRoot}/${variant.file}`),
        `missing responsive variant ${variant.file}`,
      );
    }
  }
}

assert.equal(
  readdirSync(mediaRoot).filter((file) => file.endsWith(".svg")).length,
  0,
  "obsolete cartoon SVG media remains",
);
assert.ok(
  !page.includes("`${MEDIA}/") || !/\$\{MEDIA\}\/[^`]+\.svg/.test(page),
  "Painter 12 still references cartoon media",
);
assert.ok(
  existsSync("scripts/generate-lemonade-stand-real-media.py"),
  "missing resumable photoreal media generator",
);

for (const font of ["fredoka-latin.woff2", "caveat-brush-latin.woff2"]) {
  assert.ok(existsSync(`public/templates/lemonade-stand/${font}`), `missing local font ${font}`);
}
assert.ok(
  existsSync("public/templates/lemonade-stand/FONT-LICENSES.txt"),
  "missing local font license notices",
);

console.log("verify-painter12: route, media, conversion, truthfulness, and design contracts pass");
