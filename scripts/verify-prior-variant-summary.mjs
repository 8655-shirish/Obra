import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings=ExperimentalWarning", ...process.argv.slice(1)],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const mod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/prior-variant-summary.ts")).href
);

const {
  buildStoredPriorVariantSummary,
  designCollides,
  joinPriorVariantSummaries,
  layoutFingerprint,
  layoutsCollide,
  structuralLayoutDescriptor,
  priorIntentTuples,
  priorLayoutFingerprints,
  priorUnifiedPlans,
  selectPriorVersionRows,
  summarizeThemeLayout,
  summarizeVariantConfig,
} = mod;

const specA = {
  designSpec: {
    fontDisplay: "Fraunces",
    fontSans: "DM Sans",
    h1: "2.5rem",
    h2: "1.75rem",
    h3: "1.25rem",
    radius: "0.5rem",
    bandPad: "3.5rem",
  },
};

const specB = {
  designSpec: {
    fontDisplay: "Space Grotesk",
    fontSans: "Inter",
    h1: "2.75rem",
    h2: "2rem",
    h3: "1.375rem",
    radius: "1rem",
    bandPad: "4rem",
  },
};

assert.match(summarizeVariantConfig(specA), /Fraunces\/DM Sans/);
assert.match(
  summarizeVariantConfig({ ...specA, variantKey: "v2", heroLayout: "centered" }),
  /variant v2, hero centered/,
);
assert.match(
  summarizeVariantConfig({
    ...specB,
    variantKey: "v2-b",
    heroLayout: "split",
    layoutHint: "stacked service cards",
  }),
  /variant v2-b, hero split, layout stacked service cards/,
);
assert.match(
  summarizeVariantConfig({
    variantKey: "v1-b",
    heroLayout: "split",
    designSpec: {
      fontDisplay: "X",
      fontSans: "Y",
      h1: "2rem",
      h2: "1.5rem",
      h3: "1.25rem",
      radius: "1rem",
      bandPad: "3rem",
      heroRecipe: "image-led hero",
      serviceComposition: "numbered service rows",
    },
  }),
  /layout image-led hero; numbered service rows/,
);

const rows = [
  { id: "v1", version_number: 1, config_json: specA },
  { id: "v2", version_number: 2, config_json: specB },
  { id: "v3", version_number: 3, config_json: specA },
  { id: "v4", version_number: 4, config_json: specB },
  { id: "v5", version_number: 5, config_json: specA },
];

const summary = buildStoredPriorVariantSummary(rows);
assert.ok(summary?.includes("Fraunces"));
assert.ok(summary?.includes("Space Grotesk"));

const emphasized = buildStoredPriorVariantSummary(rows, "v4");
assert.ok(emphasized?.startsWith("designSpec font Space Grotesk"));

const oldExplicitRows = rows.map((row) => ({
  ...row,
  config_json: { ...row.config_json, variantKey: row.id },
}));
assert.deepEqual(
  selectPriorVersionRows([...oldExplicitRows, oldExplicitRows[0]], "v1").map((row) => row.id),
  ["v1", "v5", "v4", "v3"],
  "an explicit old version is retained first, deduped, and included within the cap",
);
assert.deepEqual(
  selectPriorVersionRows(oldExplicitRows).map((row) => row.id),
  ["v5", "v4", "v3", "v2"],
);
assert.deepEqual(
  selectPriorVersionRows(oldExplicitRows, "missing").map((row) => row.id),
  ["v5", "v4", "v3", "v2"],
);
const oldExplicitSummary = buildStoredPriorVariantSummary(oldExplicitRows, "v1");
assert.match(oldExplicitSummary ?? "", /^designSpec[^|]+variant v1,/);
assert.doesNotMatch(oldExplicitSummary ?? "", /variant v2,/);

const unifiedConfig = (recipeId) => ({
  generator: "unified-site-agent",
  generatorSchemaVersion: 2,
  unifiedBrief: {
    planSchemaVersion: 1,
    recipeId,
    recipeVersion: 1,
    heroTopology: "type-led",
    sectionTopology: [
      { section: "hero", shape: "stack" },
      { section: "services", shape: "ledger" },
      { section: "contact", shape: "panel" },
    ],
    responsiveIntent: "linearize",
    conversionPlacement: "hero-and-contact",
    mediaSlots: [
      {
        slotId: "hero-photo",
        role: "hero",
        section: "hero",
        sourcePreference: "evidence",
        aspectRatio: "wide",
        cropGuidance: "Keep the work centered",
        textOverlayAllowed: false,
        proofEligibleRequired: false,
        mobileTreatment: "crop",
        required: true,
      },
      {
        slotId: "proof-photo",
        role: "proof",
        section: "services",
        sourcePreference: "evidence",
        aspectRatio: "landscape",
        cropGuidance: "Show completed work",
        textOverlayAllowed: false,
        proofEligibleRequired: true,
        mobileTreatment: "contain",
        required: false,
      },
    ],
  },
  divergenceTuple: {
    recipe: recipeId + "@1",
    hero: "type-led",
    sections: "hero:stack>services:ledger>contact:panel",
    conversion: "hero-and-contact",
    media: "hero:hero:evidence>proof:services:evidence",
  },
});
const unifiedRows = oldExplicitRows.map((row) => ({
  ...row,
  config_json: unifiedConfig(`recipe-${row.id}`),
}));
assert.deepEqual(
  priorUnifiedPlans([...unifiedRows, unifiedRows[0]], "v1").map((plan) => plan.brief.recipeId),
  ["recipe-v1", "recipe-v5", "recipe-v4", "recipe-v3"],
  "unified plans use the same explicit-first capped selection",
);

assert.equal(joinPriorVariantSummaries(["a", undefined, "b"]), "a | b");
assert.equal(joinPriorVariantSummaries([undefined, ""]), undefined);

const splitTheme = `
export default function Site(props: SiteProps) {
  return (
    <>
      <Section id="hero"><div className="md:flex-row"><Media item={firstStill(props.media)} /></div></Section>
      <Section id="trustmarkers" />
      <Section id="services"><Card /><Card /></Section>
      <Section id="beforeAfter" />
      <Section id="reviews"><Quote quote={""} /></Section>
      <Section id="contact"><LeadSlot /></Section>
      <Section id="footer" />
    </>
  );
}
`;

const stackedTheme = `
export default function Site(props: SiteProps) {
  return (
    <>
      <Section id="hero"><div className="flex-col"><Media item={firstStill(props.media)} /></div></Section>
      <Section id="trustmarkers" />
      <Section id="services"><div className="space-y-4">rows</div></Section>
      <Section id="beforeAfter" />
      <Section id="reviews" />
      <Section id="contact"><LeadSlot /></Section>
      <Section id="footer" />
    </>
  );
}
`;

assert.match(summarizeThemeLayout({ themeSource: splitTheme }) ?? "", /hero:split-media/);
assert.match(summarizeThemeLayout({ themeSource: splitTheme }) ?? "", /services:cards/);
assert.match(summarizeThemeLayout({ themeSource: stackedTheme }) ?? "", /hero:stacked-media/);
assert.match(summarizeThemeLayout({ themeSource: stackedTheme }) ?? "", /services:rows/);
assert.equal(summarizeThemeLayout({ themeFallback: true }), "fallback chrome");
assert.notEqual(
  layoutFingerprint({ themeSource: splitTheme }),
  layoutFingerprint({ themeSource: stackedTheme }),
);

const layoutRows = [
  { id: "a", version_number: 1, config_json: { themeSource: splitTheme } },
  { id: "b", version_number: 2, config_json: { themeSource: splitTheme } },
];
assert.deepEqual(priorLayoutFingerprints(layoutRows), [
  layoutFingerprint({ themeSource: splitTheme }),
]);

assert.equal(
  summarizeThemeLayout({ themeSource: splitTheme })?.includes("kit "),
  false,
  "kit component list is not a layout axis",
);
const splitWithHeader = splitTheme.replace('<Section id="hero">', '<Header /><Section id="hero">');
assert.equal(
  layoutFingerprint({ themeSource: splitTheme }),
  layoutFingerprint({ themeSource: splitWithHeader }),
  "adding Header must not change the fingerprint",
);

const bandedTheme = splitTheme
  .replace(
    '<Section id="hero">',
    '<Section id="hero" band="media"><Heading level="display">Title</Heading>',
  )
  .replace('<Section id="services">', '<Section id="services" band="soft">');
assert.equal(
  layoutFingerprint({ themeSource: splitTheme }),
  layoutFingerprint({ themeSource: bandedTheme }),
  "paint choices do not change coarse realized composition",
);
assert.equal(
  summarizeThemeLayout({ themeSource: splitTheme }),
  summarizeThemeLayout({
    themeSource: splitTheme.replace('className="md:flex-row"', 'className="md:flex-row gap-8"'),
  }),
);

const overlayAttrOrder = `
export default function Site(props: SiteProps) {
  return (
    <>
      <Section media={still} id="hero"></Section>
      <Section id="services"><Card /></Section>
    </>
  );
}
`;
assert.match(
  summarizeThemeLayout({ themeSource: overlayAttrOrder }) ?? "",
  /hero:overlay-media/,
  "Section media= is a photo hero even when media= precedes id=",
);

const literalMarkerTheme = `
export default function Site(props: SiteProps) {
  return (
    <>
      <div data-site-section="hero"><div className="md:grid-cols-2"><Media item={firstStill(props.media)} /></div></div>
      <section data-site-section="services"><Card /><Card /></section>
      <section data-site-section="reviews"><Quote quote={""} /></section>
      <footer data-site-section="footer" />
    </>
  );
}
`;
assert.match(layoutFingerprint({ themeSource: literalMarkerTheme }), /hero:split-media@/);
assert.match(layoutFingerprint({ themeSource: literalMarkerTheme }), /services:cards@/);
assert.equal(
  structuralLayoutDescriptor({ themeSource: literalMarkerTheme }).contact.status,
  "missing",
);
const mappedServicesTheme = `export default function Site() {
  const items = ["a", "b"];
  return <section data-site-section="services">{items.map((item) => (
    <article className="grid grid-cols-[2fr_1fr]"><div>{item}</div><div /></article>
  ))}</section>;
}`;
assert.match(
  structuralLayoutDescriptor({ themeSource: mappedServicesTheme }).services.structure ?? "",
  /grid-cols-\[2fr_1fr\]/,
  "mapped JSX callback structure contributes to the realized descriptor",
);
const ambiguousServicesTheme = `export default function Site({ alternate }) {
  return alternate
    ? <Section id="services"><Card /></Section>
    : <Section id="services"><div className="grid grid-cols-2" /></Section>;
}`;
assert.equal(
  structuralLayoutDescriptor({ themeSource: ambiguousServicesTheme }).services.status,
  "unclassifiable",
  "multiple materially different conditional roots are never branch-order dependent",
);
const counterfeitRootTheme = `export default function Site() {
  return <main><a id="hero" className="grid grid-cols-2">jump</a></main>;
}`;
assert.equal(
  structuralLayoutDescriptor({ themeSource: counterfeitRootTheme }).hero.status,
  "missing",
  "arbitrary nested element ids cannot counterfeit canonical section roots",
);

const structuralVariants = literalMarkerTheme.replace(
  'className="md:grid-cols-2"',
  'className="relative grid md:grid-cols-[2fr_1fr] [&>div:first-child]:order-2"',
);
assert.notEqual(
  layoutFingerprint({ themeSource: literalMarkerTheme }),
  layoutFingerprint({ themeSource: structuralVariants }),
  "arbitrary tracks, order, and positioning remain diversity axes",
);
const contaminated = literalMarkerTheme.replace(
  '<section data-site-section="services">',
  '<section data-site-section="services" className="absolute grid-cols-9">',
);
assert.equal(
  structuralLayoutDescriptor({ themeSource: contaminated }).hero.structure,
  structuralLayoutDescriptor({ themeSource: literalMarkerTheme }).hero.structure,
  "next-root attributes cannot contaminate the previous section subtree",
);
const optionalBand = splitTheme.replace(
  '<Section id="contact">',
  '<Section id="warranty"><div className="grid grid-cols-2" /></Section><Section id="contact">',
);
assert.equal(
  layoutsCollide(
    layoutFingerprint({ themeSource: splitTheme }),
    layoutFingerprint({ themeSource: optionalBand }),
  ),
  true,
  "an evidence-gated band cannot hide an otherwise colliding core composition",
);
const catalogFamilyFingerprint = [
  "hero:split-media@catalog:split-media",
  "services:cards@catalog:cards",
  "contact:type-only@catalog:type-only",
  "footer:grid@catalog:grid",
].join("|");
const freehandFamilyFingerprint = [
  "hero:split-media@section(div[grid-cols-2](media))",
  "services:cards@section(card,card)",
  "contact:type-only@section(leadslot)",
  "footer:grid@section(div[grid-cols-3])",
].join("|");
assert.equal(
  layoutsCollide(catalogFamilyFingerprint, freehandFamilyFingerprint),
  true,
  "catalog and freehand realizations compare in one normalized family domain",
);

const intentA = {
  pairing: "sourceSober",
  scale: "majorThird",
  baseSize: "md",
  density: "regular",
  tone: "paper",
  corners: "soft",
  emphasis: "balanced",
};
const intentB = { ...intentA, pairing: "oswaldSignage", tone: "oxide" };
assert.match(
  summarizeVariantConfig({
    variantKey: "v2",
    heroLayout: "split",
    themeSource: splitTheme,
    designSpec: {
      designIntent: intentA,
      fontDisplay: "Source Serif 4",
      fontSans: "Source Sans 3",
      h1: "clamp(1rem, 2vw, 2rem)",
      h2: "1.5rem",
      h3: "1.25rem",
      radius: "0.5rem",
      bandPad: "4rem",
    },
  }),
  /designIntent sourceSober\/majorThird\/md\/regular\/paper\/soft\/balanced/,
);

const sevenFieldSplit = { themeSource: splitTheme };
const intentSplitA = { themeSource: splitTheme, designSpec: { designIntent: intentA } };
const intentSplitB = { themeSource: splitTheme, designSpec: { designIntent: intentB } };
const intentStackedB = { themeSource: stackedTheme, designSpec: { designIntent: intentB } };

assert.equal(
  layoutFingerprint(intentSplitA),
  layoutFingerprint(sevenFieldSplit),
  "intent and seven-field rows with the same themeSource share a layout fingerprint",
);
assert.equal(layoutFingerprint(intentSplitA), layoutFingerprint(intentSplitB));
assert.match(layoutFingerprint(intentSplitA), /hero:split-media@.*\|.*services:cards@/);
assert.equal(
  layoutFingerprint({ themeSource: splitTheme, themeFallback: true }),
  "fallback chrome",
);

const mixedRows = [
  { id: "legacy", version_number: 1, config_json: sevenFieldSplit },
  { id: "intent", version_number: 2, config_json: intentSplitA },
  {
    id: "chrome",
    version_number: 3,
    config_json: { themeFallback: true, themeSource: splitTheme },
  },
];
assert.deepEqual(priorLayoutFingerprints(mixedRows), [layoutFingerprint(sevenFieldSplit)]);
assert.deepEqual(priorIntentTuples(mixedRows), [
  "sourceSober/majorThird/md/regular/paper/soft/balanced",
]);
assert.deepEqual(
  priorIntentTuples([{ id: "legacy", version_number: 1, config_json: sevenFieldSplit }]),
  [],
);
assert.notEqual(
  priorIntentTuples([{ id: "a", version_number: 1, config_json: intentSplitA }])[0],
  priorIntentTuples([{ id: "b", version_number: 1, config_json: intentSplitB }])[0],
);

const forbidLayouts = new Set(priorLayoutFingerprints(mixedRows));
const forbidIntents = new Set(priorIntentTuples(mixedRows));
assert.equal(
  designCollides(
    layoutFingerprint(intentSplitB),
    "oswaldSignage/majorThird/md/regular/oxide/soft/balanced",
    forbidLayouts,
    forbidIntents,
  ),
  true,
  "same layout as a pre-#20 row is a hit even with a new intent tuple",
);
assert.equal(
  designCollides(
    layoutFingerprint(intentStackedB),
    "sourceSober/majorThird/md/regular/paper/soft/balanced",
    forbidLayouts,
    forbidIntents,
  ),
  true,
  "same intent tuple is a hit even with a different layout",
);
assert.equal(
  designCollides(
    layoutFingerprint(intentStackedB),
    "oswaldSignage/majorThird/md/regular/oxide/soft/balanced",
    forbidLayouts,
    forbidIntents,
  ),
  false,
  "different layout and different tuple is a miss",
);

const cardsIcon = {
  themeSource: splitTheme,
  component_ids: ["hyperui/services/cards-icon", "hyperui/hero/split-media-right"],
};
const cardsImage = {
  themeSource: splitTheme,
  component_ids: ["hyperui/services/cards-image", "hyperui/hero/split-media-right"],
};
assert.equal(
  layoutFingerprint(cardsIcon),
  layoutFingerprint(cardsImage),
  "catalog ids normalize to canonical section/layoutFamily",
);
assert.equal(
  layoutFingerprint({ themeSource: splitTheme, component_ids: [] }),
  layoutFingerprint(sevenFieldSplit),
  "versions without component_ids stay shape-only",
);
assert.equal(
  layoutFingerprint({ themeSource: splitTheme, component_ids: ["hyperui/hero/split-media-right"] }),
  layoutFingerprint({
    themeSource: splitTheme,
    component_ids: ["hyperui/hero/split-media-right", "hyperui/hero/split-media-right"],
  }),
);
assert.equal(
  designCollides(
    layoutFingerprint(cardsImage),
    null,
    new Set([layoutFingerprint(cardsIcon)]),
    new Set(),
  ),
  true,
);
assert.equal(
  designCollides(
    layoutFingerprint(cardsIcon),
    null,
    new Set([layoutFingerprint(cardsIcon)]),
    new Set(),
  ),
  true,
);
assert.match(
  summarizeVariantConfig({
    ...specA,
    themeSource: splitTheme,
    component_ids: ["hyperui/services/cards-icon", "hyperui/hero/split-media-right"],
  }),
  /catalog hyperui\/hero\/split-media-right,hyperui\/services\/cards-icon/,
);

const namedShell = `
export default function Site(props: SiteProps) {
  return (
    <>
      <Header logoUrl={props.logoUrl} businessName={props.businessName} contactHidden={props.contactHidden} />
      <NamedLayout section="hero" />
      <NamedLayout section="services" />
      <Section id="contact"><LeadSlot /></Section>
      <NamedLayout section="footer" />
    </>
  );
}
`;
const namedIdsA = {
  themeSource: namedShell,
  component_ids: ["hyperui/hero/centered-type-only", "hyperui/services/three-col-bordered-cards"],
};
const namedIdsB = {
  themeSource: namedShell,
  component_ids: ["hyperui/hero/left-type-only", "hyperui/services/three-col-bordered-cards"],
};
assert.equal(
  layoutFingerprint(namedIdsA),
  layoutFingerprint(namedIdsB),
  "catalog ids in one family share a coarse fingerprint",
);
assert.equal(
  layoutFingerprint(namedIdsA),
  layoutFingerprint({ ...namedIdsA, themeSource: namedShell.replace("Header", "TopBar") }),
);
assert.equal(
  layoutFingerprint(namedIdsA),
  layoutFingerprint({
    ...namedIdsA,
    themeSource: namedShell
      .replace('section="hero"', 'section={"hero"}')
      .replace('section="services"', "section={'services'}")
      .replace('section="footer"', "section={`footer`}"),
  }),
  "braced literal NamedLayout attrs use the shared kit parser",
);
assert.equal(
  designCollides(
    layoutFingerprint(namedIdsA),
    null,
    new Set([layoutFingerprint(namedIdsA)]),
    new Set(),
  ),
  true,
);

const compositionPolicyMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/composition-policy.ts")).href
);
assert.equal(
  compositionPolicyMod.compositionCompatibilityError(intentA, {
    hero: "type-only",
    services: "rows",
  }),
  null,
);
assert.match(
  compositionPolicyMod.compositionCompatibilityError(
    { ...intentA, emphasis: "quiet" },
    { hero: "overlay-media" },
  ) ?? "",
  /does not allow hero:overlay-media/,
);
assert.match(
  compositionPolicyMod.compositionPolicyText(intentB),
  /hero=\[type-only\|split-media\|stacked-media\|overlay-media\]/,
);

const generatorSource = fs.readFileSync(
  path.join(here, "../src/lib/agent/website-generator.server.ts"),
  "utf8",
);
const unifiedStart = generatorSource.indexOf("async function generateUnifiedThemeSource");
const entryStart = generatorSource.indexOf(
  "export async function generateWebsiteContentForVariant",
);
assert.ok(unifiedStart >= 0 && entryStart > unifiedStart);
const unifiedSource = generatorSource.slice(unifiedStart, entryStart);
assert.match(unifiedSource, /priorLayoutFingerprints\?: string\[\]/);
assert.match(unifiedSource, /const layout = layoutFingerprint\(projected\)/);
assert.match(unifiedSource, /if \(findCollidingLayout\(layout, forbidLayouts\)\)[\s\S]*?continue;/);
assert.match(
  generatorSource.slice(entryStart),
  /priorLayoutFingerprints: options\?\.priorLayoutFingerprints/,
  "generation entry point threads forbidden layouts into unified generation",
);

console.log("verify-prior-variant-summary: ok");
