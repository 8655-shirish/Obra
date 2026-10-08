import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const route = read("src/routes/templates.painter18.tsx");
const page = read("src/components/templates/PainterEighteenTemplatePage.tsx");
const css = read("src/components/templates/painter-eighteen/painter-eighteen.css");
const catalog = read("src/lib/template-catalog.ts");
const manifest = JSON.parse(read("src/components/templates/painter-eighteen/media.json"));
const mediaDir = resolve(root, "public", manifest.directory.slice(1));
const ledger = JSON.parse(readFileSync(resolve(mediaDir, "media-ledger.json"), "utf8"));

assert(route.includes('createFileRoute("/templates/painter18")'));
assert(route.includes('templateId="tpl_painter18"'), "Preserve canonical purchase identity");
assert(route.includes("showBuyCta={true}") && route.includes("showDisclaimer={false}"));
assert(route.includes("NOINDEX_META") && !route.includes("prefill"));
assert(read("src/lib/template-content/overlay.ts").includes('"painter18"'));
assert(catalog.includes(`${manifest.directory}/arrival-800.jpg`), "Catalog must show photography");
assert(!page.includes("RoomScene") && !page.includes(".svg"), "No scene stand-ins");
assert(!page.includes("painter-shared-copy"), "P18 copy must not import legacy demo claims");

const forbidden =
  /\b(?:demo|dummy|fictional|placeholder|sample offering|sample review|AI-generated|generated illustrative|replace before publishing|555|example\.com|testimonials?)\b/i;
const tree = ts.createSourceFile(
  "PainterEighteenTemplatePage.tsx",
  page,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function checkCopy(node) {
  if (ts.isStringLiteral(node) || ts.isJsxText(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    assert(!forbidden.test(node.text), `Unfinished or unsupported copy: ${node.text}`);
  }
  ts.forEachChild(node, checkCopy);
}
checkCopy(tree);

const hashes = new Set();
for (const [name, shot] of Object.entries(manifest.photos)) {
  const filename = `${name}.jpg`;
  const record = ledger.assets[filename];
  assert.equal(record?.status, "completed", `Missing completed photograph: ${name}`);
  assert.equal(record.width, shot.width);
  assert.equal(record.height, shot.height);
  assert(record.jobId || (record.sourcePage && record.license), `${name}: missing provenance`);
  for (const asset of [{ ...record, file: filename }, ...record.variants]) {
    const bytes = readFileSync(resolve(mediaDir, asset.file));
    assert.equal(bytes.readUInt16BE(0), 0xffd8, `${asset.file}: not a JPEG photograph`);
    assert.equal(bytes.length, asset.bytes, `${asset.file}: stale byte count`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
      `${asset.file}: integrity mismatch`,
    );
    assert(
      bytes.length > 8_000 && bytes.length < 1_700_000,
      `${asset.file}: unreasonable media payload`,
    );
  }
  assert(!hashes.has(record.sha256), `${name}: duplicate image masquerading as another role`);
  hashes.add(record.sha256);
  for (const width of [800, 1200].filter((width) => width < shot.width)) {
    assert(
      record.variants.some((variant) => variant.width === width),
      `${name}: missing responsive width ${width}`,
    );
  }
  assert(!forbidden.test(shot.alt), `${name}: invalid alt text`);
}
assert(hashes.size >= 10, "The page needs an actual photographic shot system");
assert(
  !readdirSync(mediaDir).some((file) => file.startsWith(".") || file.endsWith(".svg")),
  "No source intermediates or SVG scene replacements in delivery assets",
);
assert(
  !existsSync(resolve(mediaDir, "../estate-hero.svg")),
  "Delete the rejected hero illustration",
);

const filmPath = resolve(mediaDir, manifest.film.file);
const film = JSON.parse(
  execFileSync(
    "ffprobe",
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", filmPath],
    { encoding: "utf8" },
  ),
);
assert.equal(film.streams.length, 1, "Film must contain video only, no audio");
assert.equal(film.streams[0].codec_name, "h264");
assert.equal(film.streams[0].pix_fmt, "yuv420p");
assert(film.streams[0].width >= 1280 && film.streams[0].height >= 720);
assert(Number(film.format.duration) >= 5 && Number(film.format.duration) <= 7);
assert.equal(ledger.assets[manifest.film.file].sourcePage, manifest.film.sourcePage);
assert.equal(
  ledger.assets[`${manifest.film.poster}.jpg`].sourcePage,
  manifest.film.sourcePage,
  "Poster and film must show the same scene",
);
const videoBytes = readFileSync(filmPath);
assert.equal(
  createHash("sha256").update(videoBytes).digest("hex"),
  ledger.assets[manifest.film.file].sha256,
);
assert(videoBytes.indexOf("moov") < videoBytes.indexOf("mdat"), "MP4 must be fast-start");
assert(
  page.includes("useSyncExternalStore") && page.includes("prefers-reduced-motion"),
  "SSR-safe reactive motion handling is required",
);
assert(
  page.includes("autoPlay") &&
    page.includes("muted") &&
    page.includes("playsInline") &&
    page.includes("loop"),
);
assert(!page.includes("controls="), "Atmospheric film must not grow player controls");
assert(
  page.includes("onCloseAutoFocus") && page.includes("manualCopy"),
  "Dialogs and clipboard failure need working paths",
);

for (const font of [
  "cormorant-garamond-latin",
  "cormorant-garamond-italic-latin",
  "source-sans-3-latin",
]) {
  const name = `${font}.woff2`;
  const bytes = readFileSync(resolve(mediaDir, "../fonts", name));
  assert.equal(bytes.subarray(0, 4).toString(), "wOF2");
  assert(css.includes(name), `${name}: font is not actually loaded`);
}
assert(!/monospace|SFMono|Consolas/.test(css));
assert(read("public/templates/lavender-estate/MEDIA-CREDITS.md").includes("David Pickup"));
console.log(
  `P18: ${hashes.size} distinct photographs, licensed 6s film, local fonts, truthful copy and shared purchase seam verified. Visual acceptance is a separate review.`,
);
