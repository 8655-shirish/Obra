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

const validateMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/validate-theme-source.ts")).href
);
const compileMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/compile-theme-source.ts")).href
);
const evalMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/eval-theme-module.ts")).href
);
const typesMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/types.ts")).href
);

const { validateThemeSource, isStructurallyValidTheme } = validateMod;
const renderModeMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/render-mode.ts")).href
);
const { classifySiteRenderMode, unavailableSiteMessage } = renderModeMod;
const { compileThemeSource } = compileMod;
const { instantiateThemeModule } = evalMod;
const kitScopeMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/kit-scope.ts")).href
);
const {
  CATALOG_KIT_NAMES,
  CATALOG_ONLY_KIT_NAMES,
  pickSiteKit,
  themeModulePreamble,
  UNIFIED_KIT_NAMES,
} = kitScopeMod;
const { THEME_SOURCE_MAX_BYTES, siteDesignSpecSchema } = typesMod;

const reactMod = await import("react");
const React = reactMod.default ?? reactMod;
const STUB_KIT = {
  Section() {},
  LeadSlot() {},
  Button() {},
  Media() {},
  Heading() {},
  TopBar() {},
  Grid() {},
  Card() {},
  Quote() {},
  Hero() {},
  Header() {},
  Nav() {},
  QuoteCta() {},
  MediaGallery() {},
  TrustMarkerList() {},
  NamedLayout() {},
  firstStill() {},
};
const themeRuntime = { React, SiteKit: STUB_KIT };
const designSpecMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/design-spec.ts")).href
);
const {
  sanitizeDesignSpec,
  hasDesignSpecPaintTokens,
  resolvePaintTokens,
  deriveIntentPaint,
  deriveTypeScale,
  deriveToneRamp,
  contrastRatio,
  intentTuple,
  readDesignIntent,
  parseOklchCss,
  tonesForPrimaryColor,
  snapToneToHarmonious,
  inkOnPrimaryHex,
  hexContrastRatio,
  MIN_BAND_LIGHTNESS_DELTA,
  AA_CONTRAST_MIN,
  INK_ON_PRIMARY_LIGHT,
  INK_ON_PRIMARY_DARK,
} = designSpecMod;
const catalogMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/design-catalog.ts")).href
);
const {
  DESIGN_TONE_IDS,
  DESIGN_PAIRINGS,
  DESIGN_PAIRING_IDS,
  DESIGN_SCALE_IDS,
  DESIGN_BASE_SIZE_IDS,
  clampFaceWeight,
} = catalogMod;
const configPropsMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/config-to-props.ts")).href
);
const { googleFontStylesheetUrl } = configPropsMod;

const VALID_THEME = `export default function Site(props: SiteProps) {
  const hero = props.sections.find((s) => s.type === "hero");
  return (
    <div>
      <TopBar>
        <Heading as="h1">{props.businessName}</Heading>
        <Nav items={[{ href: "#services", label: "Services" }, { href: "#contact", label: "Contact" }]} />
        <QuoteCta />
      </TopBar>
      <Section id="hero">
        <Heading as="h1">{hero?.heading}</Heading>
        <p>{hero?.body}</p>
        {props.media[0] ? <Media item={props.media[0]} /> : null}
      </Section>
      <Section id="trustmarkers"><TrustMarkerList markers={props.trustMarkers} /></Section>
      <Section id="services">{props.services.join(", ")}</Section>
      <Section id="beforeAfter"><MediaGallery media={props.media} className="grid grid-cols-2 gap-4" /></Section>
      <Section id="reviews">{props.reviews.map((r, i) => <Quote key={i} quote={r.quote} author={r.author} source={r.source} />)}</Section>
      <Section id="contact">
        <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />
      </Section>
      <Section id="footer">{props.businessName}</Section>
    </div>
  );
}
`;

const HOOKS_THEME = `export default function Site(props: SiteProps) {
  const [ready] = useState(true);
  const hero = props.sections.find((s) => s.type === "hero");
  return (
    <>
      <TopBar>
        <Heading as="h1">{props.businessName}</Heading>
      </TopBar>
      <Section id="hero">
        <Heading as="h1">{hero?.heading}</Heading>
        {ready ? <p>{hero?.body}</p> : null}
        {props.media[0] ? <Media item={props.media[0]} /> : null}
      </Section>
      <Section id="trustmarkers"><TrustMarkerList markers={props.trustMarkers} /></Section>
      <Section id="services">{props.services.join(", ")}</Section>
      <Section id="beforeAfter"><MediaGallery media={props.media} className="grid grid-cols-2 gap-4" /></Section>
      <Section id="reviews">{props.reviews.map((r, i) => <Quote key={i} quote={r.quote} author={r.author} source={r.source} />)}</Section>
      <Section id="contact">
        <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />
      </Section>
      <Section id="footer">{props.businessName}</Section>
    </>
  );
}
`;

const CONTACT_BLOCK = `<Section id="contact">
        <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />
      </Section>`;

const NO_MEDIA_THEME = VALID_THEME.replace(
  "{props.media[0] ? <Media item={props.media[0]} /> : null}",
  "{null}",
).replace(
  '<Section id="beforeAfter"><MediaGallery media={props.media} className="grid grid-cols-2 gap-4" /></Section>',
  '<Section id="beforeAfter">{null}</Section>',
);

const ok = validateThemeSource(VALID_THEME, {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
});
assert.equal(ok.ok, true, ok.ok ? "" : ok.error);
const unifiedLeadSource =
  'export default function Site(){return <main><section data-site-section="contact"><LeadSlot /></section></main>}';
assert.equal(
  validateThemeSource(unifiedLeadSource, { unifiedLoose: true, contactHidden: false }).ok,
  true,
);
assert.equal(
  validateThemeSource(unifiedLeadSource.replace("</section>", "<LeadSlot /></section>"), {
    unifiedLoose: true,
    contactHidden: false,
  }).ok,
  false,
);
assert.equal(
  validateThemeSource(unifiedLeadSource, { unifiedLoose: true, contactHidden: true }).ok,
  false,
);

const compiled = compileThemeSource(VALID_THEME, {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
});
assert.equal(compiled.ok, true, compiled.ok ? "" : compiled.error);
assert.ok(Array.isArray(compiled.advisories), "compile records advisories even when ok");
assert.ok(
  compiled.advisories.some((item) => item.code === "same-consecutive-band"),
  "consecutive Sections without band= are advisory, not an error",
);
assert.equal(
  compiled.advisories.every((item) => item.severity === "advisory"),
  true,
);
assert.equal(
  instantiateThemeModule(VALID_THEME, themeRuntime).ok,
  true,
  "iframe factory still instantiates in Node",
);

assert.equal(
  validateThemeSource(HOOKS_THEME, { hasMedia: true, hasReviews: true, hasTrustMarkers: true }).ok,
  true,
  "generated TSX may use useState/Fragment without import",
);
assert.equal(
  compileThemeSource(HOOKS_THEME, { hasMedia: true, hasReviews: true, hasTrustMarkers: true }).ok,
  true,
  "hooks/Fragment theme must sucrase-compile",
);

const topLevelUnknown = `const boom = definitelyNotInScope;\n${VALID_THEME}`;
assert.equal(
  compileThemeSource(topLevelUnknown, { hasMedia: true, hasReviews: true, hasTrustMarkers: true })
    .ok,
  true,
  "stored two-step themes remain compatible unless generate-time binding analysis is requested",
);
const catalogUnknownCompile = compileThemeSource(`const boom = Bogus;\n${VALID_THEME}`, {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
  bindingScope: "catalog",
});
assert.equal(catalogUnknownCompile.ok, false, "two-step generation rejects unknown bindings");
assert.match(catalogUnknownCompile.error ?? "", /runtime policy|unavailable/);
const catalogBindingsCompile = compileThemeSource(VALID_THEME, {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
  bindingScope: "catalog",
});
assert.equal(catalogBindingsCompile.ok, true, "two-step generation allows catalog kit bindings");

const unifiedUnknown = `export default function Site(props: SiteProps) {
  return <div>{definitelyNotInScope}<LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>;
}`;
const unifiedUnknownCompile = compileThemeSource(unifiedUnknown, { unifiedLoose: true });
assert.equal(unifiedUnknownCompile.ok, false, "unified gate rejects unavailable bindings");
assert.match(unifiedUnknownCompile.error ?? "", /definitelyNotInScope/);

const unifiedBindingCases = [
  [
    "locals, destructuring, callbacks, and safe built-ins",
    `export default function Site(props: SiteProps) {
      const { businessName: name } = props;
      const labels = Array.from(new Set([name])).map((label) => String(label));
      return <div>{labels.map((label) => <span key={label}>{label.trim()}</span>)}<LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>;
    }`,
    true,
  ],
  [
    "browser globals",
    `export default function Site(props: SiteProps) { return <div>{window.location.href}<LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>; }`,
    false,
  ],
  [
    "catalog aliases",
    `export default function Site(props: SiteProps) { const Layout = Grid; return <div><LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>; }`,
    false,
  ],
];
for (const [label, source, expected] of unifiedBindingCases) {
  const result = compileThemeSource(source, { unifiedLoose: true });
  assert.equal(result.ok, expected, label);
}

const unifiedAdversarialCases = [
  `export default function Site(props: SiteProps) { const x = Object.constructor("return globalThis")(); return <div>{String(x)}<LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>; }`,
  `export default function Site(props: SiteProps) { return <div>{this}<LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>; }`,
  `export default function Site(props: SiteProps) { void import("data:text/javascript,export default 1"); return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }`,
  `const LeadSlot = () => null; export default function Site(props: SiteProps) { return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }`,
  `const SiteKit = {}; export default function Site(props: SiteProps) { return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }`,
  `export default function Site(props: SiteProps) { const key = "constructor"; const F = (() => {})[key]; F("return window")(); return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }`,
  `export default function Site(props: SiteProps) { const key = ["con", "structor"].join(""); const F = ({})[key][key]; F("return globalThis")(); return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }`,
  `export default function Site(props: SiteProps) { Reflect.get(Object, "constructor"); return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }`,
  `export default function Site(props: SiteProps) { const Tag = "iframe"; return <Tag><LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></Tag>; }`,
  `export default function Site(props: SiteProps) { const h = React.createElement; return h("iframe", null); }`,
  `export default function Site(props: SiteProps) { return <div onClick={() => 1}><LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>; }`,
  `function Site(props: SiteProps) { return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }`,
];
for (const source of unifiedAdversarialCases) {
  assert.equal(compileThemeSource(source, { unifiedLoose: true }).ok, false);
}
const unifiedCommentAndString = `export default function Site(props: SiteProps) {
  // fetch( and import are harmless prose here
  const text = "fetch( and import are harmless prose";
  const bytes = new Uint8Array([65]);
  const reflected = Reflect.get({ value: "ok" }, "value");
  return <div>{text}{bytes[0]}{reflected}<LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>;
}`;
assert.equal(
  compileThemeSource(unifiedCommentAndString, { unifiedLoose: true }).ok,
  true,
  "unified semantic policy must ignore harmless comments/strings and allow standard typed arrays",
);
const exportProse = `// export default is required
export default function Site(props: SiteProps) {
  const label = "javascript: basics";
  return <div>{label}<LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>;
}`;
assert.equal(
  compileThemeSource(exportProse, { unifiedLoose: true }).ok,
  true,
  "export prose and non-URL javascript text must not break unified compile",
);

const topLevelUnknownResult = instantiateThemeModule(topLevelUnknown, themeRuntime);
assert.equal(topLevelUnknownResult.ok, false, "top-level unknown identifier must fail instantiate");

assert.equal(
  validateThemeSource(VALID_THEME).ok,
  true,
  "Hero/Header components must not be required",
);
assert.equal(/<Hero\b/.test(VALID_THEME), false);
assert.equal(/<Header\b/.test(VALID_THEME), false);

const headerBound = VALID_THEME.replace(
  "<TopBar>",
  `<Header businessName={props.businessName} contactHidden={props.contactHidden} pulse={true} />
      <TopBar>`,
);
assert.equal(
  validateThemeSource(headerBound, { hasMedia: true, hasReviews: true, hasTrustMarkers: true }).ok,
  true,
  "Header contactHidden={props.contactHidden} must not fail generate",
);

const heroBare = VALID_THEME.replace('<Section id="hero">', "<Hero>").replace(
  "</Section>",
  "</Hero>",
);
assert.equal(
  validateThemeSource(heroBare, { hasMedia: true, hasReviews: true, hasTrustMarkers: true }).ok,
  true,
  "Hero defaults id=hero, so a bare <Hero> satisfies the hero section id",
);

assert.equal(
  validateThemeSource(
    VALID_THEME.replace('<Section id="hero">', '<Section id="hero" band={tone}>'),
    { hasMedia: true, hasReviews: true, hasTrustMarkers: true },
  ).ok,
  false,
  "band={expr} remains a nonliteral kit error",
);

assert.equal(
  validateThemeSource(VALID_THEME.replace(/\bitem=/g, "media="), {
    hasMedia: true,
    hasReviews: true,
    hasTrustMarkers: true,
  }).ok,
  false,
  "Media must use item= at generate time",
);
assert.equal(
  validateThemeSource(
    VALID_THEME.replace(
      /<Quote key=\{i\} quote=\{r\.quote\} author=\{r\.author\} source=\{r\.source\} \/>/g,
      "<Quote key={i}><p>{r.quote}</p></Quote>",
    ),
    { hasMedia: true, hasReviews: true, hasTrustMarkers: true },
  ).ok,
  false,
  "Quote must use quote= when reviews exist",
);

assert.equal(
  validateThemeSource(
    VALID_THEME.replace(CONTACT_BLOCK, '<Section id="contact"><p>x</p></Section>'),
  ).ok,
  false,
);

assert.equal(
  validateThemeSource(VALID_THEME.replace(CONTACT_BLOCK, ""), { contactHidden: true }).ok,
  true,
);
assert.equal(
  compileThemeSource(VALID_THEME, { contactHidden: true, unifiedLoose: true }).ok,
  false,
  "unified hidden-contact themes must omit LeadSlot",
);
assert.equal(
  compileThemeSource(
    `export default function Site() { return <div>{"LeadSlot is unavailable"}</div>; }`,
    { contactHidden: true, unifiedLoose: true },
  ).ok,
  true,
  "hidden-contact validation ignores harmless LeadSlot prose",
);

assert.equal(validateThemeSource(`import React from "react"\n${VALID_THEME}`).ok, false);
const fakeStructuralMarkers = `export default function Site() {
  const fake = 'id="hero" id="services" id="contact" id="footer" LeadSlot';
  return <div>{fake}</div>;
}`;
assert.equal(
  validateThemeSource(fakeStructuralMarkers).ok,
  false,
  "string literals cannot satisfy rendered section or LeadSlot requirements",
);
assert.equal(
  validateThemeSource(VALID_THEME.replace('Section id="hero"', 'Section id="banner"')).ok,
  false,
);

assert.equal(validateThemeSource(VALID_THEME, { hasMedia: true }).ok, true);
assert.equal(
  validateThemeSource(VALID_THEME.replace(/props\.media/g, "[]"), { hasMedia: true }).ok,
  false,
);
assert.equal(
  validateThemeSource(VALID_THEME.replace(/props\.media/g, "[]")).ok,
  true,
  "render-time validation must not require props.media",
);
assert.equal(
  validateThemeSource(VALID_THEME.replace(/props\.reviews/g, "[]"), { hasReviews: true }).ok,
  false,
);
assert.equal(
  validateThemeSource(
    VALID_THEME.replace(
      /<Quote key=\{i\} quote=\{r\.quote\} author=\{r\.author\} source=\{r\.source\} \/>/g,
      "<Quote key={i} quote={r.quote} author={r.author} />",
    ),
    { hasMedia: true, hasReviews: true, hasTrustMarkers: true },
  ).ok,
  false,
  "Quote must pass source= when reviews exist",
);
assert.equal(
  validateThemeSource(
    VALID_THEME.replace(
      '<Section id="beforeAfter"><MediaGallery media={props.media} className="grid grid-cols-2 gap-4" /></Section>',
      '<Section id="beforeAfter">{props.media.length}</Section>',
    ),
    { hasMedia: true, hasReviews: true, hasTrustMarkers: true },
  ).ok,
  false,
  "beforeAfter must use MediaGallery when media exists",
);
assert.equal(
  validateThemeSource(
    VALID_THEME.replace(
      '<Section id="trustmarkers"><TrustMarkerList markers={props.trustMarkers} /></Section>',
      '<Section id="trustmarkers">{props.trustMarkers.length}</Section>',
    ),
    { hasMedia: true, hasReviews: true, hasTrustMarkers: true },
  ).ok,
  false,
  "trustmarkers must use TrustMarkerList when trust markers exist",
);
assert.equal(
  validateThemeSource(VALID_THEME.replace(/props\.reviews/g, "[]")).ok,
  true,
  "render-time validation must not require props.reviews",
);

assert.equal(validateThemeSource(`${VALID_THEME}\nfetch("/x")`).ok, false);
assert.equal(validateThemeSource(`${VALID_THEME}\neval("1")`).ok, false);
assert.equal(validateThemeSource(`${VALID_THEME}\n<script>alert(1)</script>`).ok, false);
assert.equal(validateThemeSource(`${VALID_THEME}\n<iframe src="https://evil" />`).ok, false);
assert.equal(
  validateThemeSource(`${VALID_THEME}\n<button onClick={() => {}}>x</button>`).ok,
  false,
);
assert.equal(
  validateThemeSource(`${VALID_THEME}\n@keyframes fade { from { opacity: 0 } }`).ok,
  false,
);
assert.equal(
  validateThemeSource(`${VALID_THEME}\nimport { Button } from "@/components/ui/button"`).ok,
  false,
);

const huge = `${VALID_THEME}\nconst pad = "${"x".repeat(THEME_SOURCE_MAX_BYTES)}";`;
const cap = validateThemeSource(huge);
assert.equal(cap.ok, false);
assert.match(cap.ok ? "" : cap.error, /80KB/);

const brokenJsx = compileThemeSource(VALID_THEME.replace("return (", "return (<div"), {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
});
assert.equal(brokenJsx.ok, false);

assert.equal(
  validateThemeSource(VALID_THEME, { hasMedia: false, hasReviews: true }).ok,
  false,
  "Media is forbidden when curated photos are empty",
);
assert.equal(
  validateThemeSource(NO_MEDIA_THEME, { hasMedia: false, hasReviews: true }).ok,
  true,
  "themes without Media must compile when photos are empty",
);
assert.equal(compileThemeSource(NO_MEDIA_THEME, { hasMedia: false, hasReviews: true }).ok, true);
assert.equal(
  validateThemeSource(NO_MEDIA_THEME).ok,
  true,
  "render-time validation must not reject Media omission",
);

assert.equal(
  siteDesignSpecSchema.safeParse({
    fontDisplay: "Fraunces",
    fontSans: "DM Sans",
    h1: "2.5rem",
    h2: "1.75rem",
    h3: "1.25rem",
    radius: "0.5rem",
    bandPad: "3.5rem",
  }).success,
  true,
);
assert.equal(
  siteDesignSpecSchema.safeParse({
    fontDisplay: "Fraunces",
    fontSans: "DM Sans",
    chrome: "Open architectural header",
    heroRecipe: "image-led hero",
    serviceComposition: "numbered service rows",
  }).success,
  false,
  "English recipe fields are not a design system",
);

const clamped = sanitizeDesignSpec({
  fontDisplay: "Fraunces",
  fontSans: "DM Sans",
  h1: "4.5rem",
  h2: "0.5rem",
  h3: "1.25rem",
  radius: "3rem",
  bandPad: "1rem",
});
assert.equal(clamped.h1, "3rem");
assert.equal(clamped.h2, "1.5rem");
assert.equal(clamped.radius, "1.25rem");
assert.equal(clamped.bandPad, "2.5rem");
assert.equal(hasDesignSpecPaintTokens(clamped), true);

const oldSpec = {
  fontDisplay: "Georgia",
  fontSans: "Inter",
  chrome: "header",
  heroRecipe: "split",
  serviceComposition: "cards",
};
assert.equal(hasDesignSpecPaintTokens(oldSpec), false);
const fallbackPaint = resolvePaintTokens(oldSpec, "professional");
assert.equal(fallbackPaint.h1, "2.25rem");
const tokenPaint = resolvePaintTokens(clamped, "professional");
assert.equal(tokenPaint.h1, "3rem");
assert.equal(tokenPaint.intent, undefined, "legacy seven-field spec must not paint intent vars");

const intentOnly = {
  designIntent: {
    pairing: "sourceSober",
    scale: "majorThird",
    baseSize: "md",
    density: "regular",
    tone: "paper",
    corners: "soft",
    emphasis: "balanced",
  },
};
assert.equal(
  siteDesignSpecSchema.safeParse(intentOnly).success,
  true,
  "designIntent-only spec is valid",
);
const sanitizedIntent = sanitizeDesignSpec(intentOnly);
assert.equal(sanitizedIntent.fontDisplay, "Source Serif 4");
assert.equal(sanitizedIntent.fontSans, "Source Sans 3");
assert.match(sanitizedIntent.h1, /^clamp\(/);
assert.equal(sanitizedIntent.designIntent?.pairing, "sourceSober");

const todaySeven = {
  fontDisplay: "Fraunces",
  fontSans: "DM Sans",
  h1: "2.5rem",
  h2: "1.75rem",
  h3: "1.25rem",
  radius: "0.5rem",
  bandPad: "3.5rem",
};
const todayPaint = resolvePaintTokens(todaySeven, "professional");
assert.deepEqual(
  {
    radius: todayPaint.radius,
    bandPad: todayPaint.bandPad,
    h1: todayPaint.h1,
    h2: todayPaint.h2,
    h3: todayPaint.h3,
  },
  { radius: "0.5rem", bandPad: "3.5rem", h1: "2.5rem", h2: "1.75rem", h3: "1.25rem" },
);
assert.equal(todayPaint.intent, undefined);

const scale = deriveTypeScale(intentOnly.designIntent);
assert.ok(Math.abs(scale.h3Desktop / scale.base - scale.ratio) < 0.02, "h3 = base * r");
assert.ok(Math.abs(scale.h2Desktop / scale.h3Desktop - scale.ratio) < 0.02, "h2 / h3 = r");
assert.ok(
  scale.h1Desktop >= 3.25 - 1e-9 && scale.h1Desktop <= 4.5 + 1e-9,
  "display h1 is in the hero band",
);
assert.ok(scale.h1Desktop > scale.h2Desktop, "display stays larger than title");

for (const pairing of DESIGN_PAIRING_IDS) {
  for (const baseSize of DESIGN_BASE_SIZE_IDS) {
    for (const scaleId of DESIGN_SCALE_IDS) {
      const derived = deriveTypeScale({
        pairing,
        scale: scaleId,
        baseSize,
        density: "regular",
        tone: "paper",
        corners: "soft",
        emphasis: "balanced",
      });
      assert.ok(
        derived.h1Desktop >= 3.25 - 1e-9 && derived.h1Desktop <= 4.5 + 1e-9,
        `${pairing}/${scaleId}/${baseSize} display ${derived.h1Desktop} rem must be 3.25–4.5`,
      );
    }
  }
}

for (const toneId of DESIGN_TONE_IDS) {
  for (const theme of ["light", "dark"]) {
    const ramp = deriveToneRamp(catalogMod.DESIGN_TONES[toneId], theme, "#1e3a5f");
    const bgL = parseOklchCss(ramp.bg)?.L ?? 0;
    const canvasL = parseOklchCss(ramp.canvasSoft)?.L ?? 0;
    const bandDelta = Math.abs(bgL - canvasL);
    assert.ok(
      bandDelta + 1e-9 >= MIN_BAND_LIGHTNESS_DELTA,
      `${toneId} ${theme} bg/canvas delta ${bandDelta.toFixed(3)} must be >= ${MIN_BAND_LIGHTNESS_DELTA}`,
    );
    const pairs = [
      ["ink/bg", ramp.ink, ramp.bg],
      ["ink/canvasSoft", ramp.ink, ramp.canvasSoft],
      ["muted/bg", ramp.muted, ramp.bg],
      ["muted/canvasSoft", ramp.muted, ramp.canvasSoft],
    ];
    for (const [label, a, b] of pairs) {
      const ratio = contrastRatio(a, b);
      assert.ok(
        ratio >= AA_CONTRAST_MIN,
        `${toneId} ${theme} ${label} contrast ${ratio.toFixed(2)} must be >= ${AA_CONTRAST_MIN}`,
      );
    }
  }
}

const navyOnPrimary = inkOnPrimaryHex("#1e3a5f");
assert.equal(navyOnPrimary, INK_ON_PRIMARY_LIGHT);
assert.ok(hexContrastRatio(navyOnPrimary, "#1e3a5f") >= AA_CONTRAST_MIN);
const yellowOnPrimary = inkOnPrimaryHex("#facc15");
assert.equal(yellowOnPrimary, INK_ON_PRIMARY_DARK);
assert.ok(hexContrastRatio(yellowOnPrimary, "#facc15") >= AA_CONTRAST_MIN);

const navyTones = tonesForPrimaryColor("#1e3a5f");
assert.equal(navyTones.includes("sage"), false, "sage clashes with navy brand");
assert.ok(navyTones.includes("chalk"));
assert.ok(navyTones.includes("brandwash"));
assert.ok(navyTones.includes("slate"));
assert.equal(snapToneToHarmonious("sage", "#1e3a5f"), snapToneToHarmonious("sage", "#1e3a5f"));
assert.equal(navyTones.includes(snapToneToHarmonious("sage", "#1e3a5f")), true);
assert.equal(snapToneToHarmonious("slate", "#1e3a5f"), "slate");

const otherIntent = {
  pairing: "oswaldSignage",
  scale: "golden",
  baseSize: "lg",
  density: "generous",
  tone: "oxide",
  corners: "sharp",
  emphasis: "loud",
};
assert.notEqual(intentTuple(intentOnly.designIntent), intentTuple(otherIntent));
const paintA = resolvePaintTokens(intentOnly, "professional", {
  theme: "light",
  primaryColor: "#1e3a5f",
});
const paintB = resolvePaintTokens({ designIntent: otherIntent }, "professional", {
  theme: "light",
  primaryColor: "#1e3a5f",
});
assert.ok(paintA.intent && paintB.intent);
assert.notEqual(paintA.intent.fontDisplay, paintB.intent.fontDisplay);
assert.notEqual(paintA.h1, paintB.h1);
assert.notEqual(paintA.intent.ramp.bg, paintB.intent.ramp.bg);

const dmLoud = deriveIntentPaint({
  pairing: "dmClean",
  scale: "majorThird",
  baseSize: "md",
  density: "regular",
  tone: "chalk",
  corners: "soft",
  emphasis: "loud",
});
assert.equal(dmLoud.weightH1, "400", "DM Serif Display ships 400 only — no synthetic bold");
const archivoLoud = deriveIntentPaint({
  pairing: "archivoBold",
  scale: "majorThird",
  baseSize: "md",
  density: "regular",
  tone: "press",
  corners: "sharp",
  emphasis: "loud",
});
assert.equal(archivoLoud.weightH1, "400", "Archivo Black ships 400 only");
assert.equal(clampFaceWeight(700, DESIGN_PAIRINGS.oswaldSignage.sans.weights), 700, "Lato has 700");
assert.equal(
  clampFaceWeight(500, DESIGN_PAIRINGS.oswaldSignage.sans.weights),
  400,
  "Lato has no 500",
);
assert.equal(
  clampFaceWeight(600, DESIGN_PAIRINGS.oswaldSignage.sans.weights),
  700,
  "Lato 600 snaps to 700",
);

const latoUrl = googleFontStylesheetUrl("Lato", [400, 700, 900]);
assert.match(latoUrl ?? "", /wght@400;700;900/);
assert.equal(readDesignIntent(intentOnly)?.pairing, "sourceSober");
assert.equal(readDesignIntent(todaySeven), null);

const hostTemplate = fs.readFileSync(path.join(here, "../src/site-runtime/host.html"), "utf8");
const hostBuilt = fs.readFileSync(path.join(here, "../public/site-runtime/host.html"), "utf8");
assert.match(hostTemplate, /<!--SITE_RUNTIME_TAILWIND-->/);
assert.match(hostTemplate, /<!--SITE_RUNTIME_BOOTSTRAP-->/);
assert.equal(
  /<script[^>]+src=["'](?:tailwind-browser|bootstrap)\.js["']/.test(hostBuilt),
  false,
  "opaque iframe must not fetch sibling scripts (CORB)",
);
assert.match(hostBuilt, /<script nonce="obra-site-runtime">/);
assert.match(
  hostBuilt,
  /grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3/,
  "iframe player must ship MediaGallery work grid",
);
assert.equal(
  /amount:\s*0\.2/.test(hostBuilt),
  false,
  "iframe player must not keep 20% entrance gate",
);
assert.equal(
  /amount:\s*0\.15/.test(hostBuilt),
  false,
  "iframe player must not keep 15% stagger gate",
);
assert.match(hostBuilt, /fadeDown/, "iframe player must ship fadeDown entrance");
assert.match(hostBuilt, /scale-\[1\.02\]/, "iframe player must ship grow hover");
assert.match(hostTemplate, /script-src 'nonce-obra-site-runtime' 'unsafe-eval'/);
assert.equal(
  /script-src[^"]*'self'/.test(hostTemplate),
  false,
  "script-src 'self' does not match a null origin",
);
assert.match(hostTemplate, /font-weight:\s*var\(--site-weight-h1\)/);
assert.equal(
  /font-weight:\s*var\(--site-weight-h1,\s*bold\)/.test(hostTemplate),
  false,
  "bold fallback would re-bold stored headings; iframe preflight inherits 400",
);
assert.match(hostTemplate, /font-family:\s*var\(--site-font-h1,\s*var\(--site-font-display\)\)/);
assert.equal(
  /font-size:\s*var\(--site-h1\)\s*!important/.test(hostTemplate),
  false,
  "heading size must not be !important so module utilities win",
);
assert.match(hostTemplate, /@layer base/);
assert.match(hostTemplate, /html h1/);
assert.equal(
  /:where\(h1\)/.test(hostTemplate),
  false,
  "unlayered :where(h1) beats @layer utilities",
);
assert.equal(
  /:where\(\[data-site-section\]\)/.test(hostTemplate),
  false,
  "unlayered :where box defaults beat max-w-none",
);
assert.match(hostTemplate, /\[data-site-section\][\s\S]*--site-section-max/);

const siteKitSource = fs.readFileSync(
  path.join(here, "../src/components/site-kit/index.tsx"),
  "utf8",
);
assert.match(siteKitSource, /motion\?: "desktop" \| "all"/);
assert.match(siteKitSource, /useMediaQuery\("\(min-width: 768px\)"\)/);
assert.match(siteKitSource, /onError=\{\(\) => setVideoFailed\(true\)\}/);
assert.match(hostTemplate, /\[data-site-media\]/);
assert.match(hostTemplate, /\[data-site-grid\]/);
assert.match(hostTemplate, /\[data-site-card\]/);
const kitSrc = fs.readFileSync(path.join(here, "../src/components/site-kit/index.tsx"), "utf8");
assert.match(kitSrc, /paddingBlock:/, "Section pad inlines token band padding");
assert.match(kitSrc, /marginInline:/, "Section width inlines the token column");
assert.match(kitSrc, /fontSize:/, "Heading level inlines type size");
assert.equal(/aspectRatio:/.test(kitSrc), false, "Media must not inline crop");
assert.equal(/--site-grid-gap/.test(kitSrc), false, "Grid must not inline gap");
assert.equal(/--site-card-pad/.test(kitSrc), false, "Card must not inline padding");
assert.match(kitSrc, /width:\s*"100%"/, "Section width prop may set width 100%");
assert.equal(/fontWeight:\s*`var\(\$\{weightVar\}, bold\)`/.test(kitSrc), false);
assert.match(kitSrc, /data-site-media/);
assert.match(kitSrc, /data-site-grid/);
assert.match(kitSrc, /data-site-card/);
assert.match(kitSrc, /backgroundColor: "var\(--site-primary/);
assert.match(kitSrc, /variant = "primary"/);
assert.match(kitSrc, /\.\.\.caller, \.\.\.kit/);
assert.match(kitSrc, /surface === "plain"/);
assert.match(kitSrc, /band=\{band\}/);
const kitPropsSrc = fs.readFileSync(path.join(here, "../src/lib/site-theme/kit-props.ts"), "utf8");
assert.match(kitPropsSrc, /export function kitContractText/);
assert.match(kitPropsSrc, /band="\$\{SECTION_BANDS/);
assert.equal(
  /literal: \["pulse", "contactHidden"\]/.test(kitPropsSrc),
  false,
  "Header contactHidden is a runtime binding, not a kit literal",
);
const generatorSrc = fs.readFileSync(
  path.join(here, "../src/lib/agent/website-generator.server.ts"),
  "utf8",
);
assert.equal(/Section owns band padding/.test(generatorSrc), false);
assert.equal(/Section owns vertical band/.test(generatorSrc), false);
assert.equal(/Heading type comes from Heading/.test(generatorSrc), false);
assert.equal(/consume tokens/.test(generatorSrc), false);
assert.equal(/do not set competing heading sizes/.test(generatorSrc), false);
assert.equal(
  /set heading size, section width\/padding, and media crop/.test(generatorSrc),
  false,
  "contract must not tell the model to override tokens in Tailwind",
);
assert.equal(/Heading size is set in the module/.test(generatorSrc), false);
assert.match(generatorSrc, /as designSpec fields/);
assert.match(generatorSrc, /kitContractText\(\)/);
assert.match(kitPropsSrc, /Overlay heroes/);
assert.equal(/hero uses firstStill \+ Media priority/.test(generatorSrc), false);
assert.match(kitPropsSrc, /remaps --site-muted/);
assert.match(generatorSrc, /Alternate section bands/);
assert.match(generatorSrc, /Heading size comes from Heading level/);
assert.match(kitSrc, /export function ReviewSourceBadge/);
assert.match(kitSrc, /export function MediaGallery/);
assert.match(kitSrc, /grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3/);
assert.match(kitSrc, /export function TrustMarkerList/);
assert.match(kitSrc, /export function GalleryProvider/);
const motionPresetsSrc = fs.readFileSync(
  path.join(here, "../src/components/site-renderer/motion-presets.tsx"),
  "utf8",
);
assert.equal(
  /amount: 0\.2/.test(motionPresetsSrc),
  false,
  "entrance must not require 20% of a tall section",
);
assert.equal(
  /amount: 0\.15/.test(motionPresetsSrc),
  false,
  "stagger must not require 15% of a tall grid",
);
assert.match(motionPresetsSrc, /amount: 0/);
assert.match(motionPresetsSrc, /case "fade":/);
assert.match(motionPresetsSrc, /case "fadeDown":/);
assert.match(kitSrc, /hover:scale-\[1\.02\]/);
assert.match(kitSrc, /hover:scale-\[1\.03\]/);
assert.match(generatorSrc, /NamedLayout/);
assert.match(generatorSrc, /design-brief\.server/);
assert.match(generatorSrc, /Writing the page/);
assert.equal(
  validateThemeSource(VALID_THEME.replace(/props\.sections/g, "copy"), {
    hasMedia: true,
    hasReviews: true,
  }).ok,
  true,
  "legacy freehand still compiles without mentioning props.sections",
);
assert.equal(
  validateThemeSource(
    VALID_THEME.replace('<Section id="hero">', '<Section id="hero" entrance="fadeUp">'),
    {
      hasMedia: true,
      hasReviews: true,
    },
  ).ok,
  true,
  "kit entrance prop is allowed",
);
assert.equal(validateThemeSource(`${VALID_THEME}\nfrom "motion"`).ok, false);
assert.match(kitSrc, /entrance \?\? "none"/);
assert.match(kitSrc, /getPulseProps/);
assert.match(kitSrc, /QuoteCta pulse=\{pulse\}/);
const bootstrapSrc = fs.readFileSync(path.join(here, "../src/site-runtime/bootstrap.ts"), "utf8");
assert.match(bootstrapSrc, /GalleryProvider/);
assert.match(
  bootstrapSrc,
  /removeProperty\(name\)/,
  "legacy paint must clear leftover intent vars on iframe reuse",
);
assert.match(bootstrapSrc, /SiteKitMotionRoot/);
assert.match(bootstrapSrc, /SiteKitBookingRoot/);
assert.equal(/--site-band-pad/.test(bootstrapSrc), false, "duplicate band-pad token is deleted");
assert.match(hostTemplate, /html \{[^}]*overflow:\s*auto/);
assert.equal(
  /body \{[^}]*overflow:\s*auto/.test(hostTemplate),
  false,
  "body must not be a nested scrollport — the iframe document (html) scrolls",
);
assert.doesNotMatch(generatorSrc, /codeAttempts = 3/);
assert.match(generatorSrc, /executionUnit\?: "planning" \| "media" \| "composition"/);

const designBriefMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/design-brief.server.ts")).href
);
const {
  designBriefSchema,
  feasibleBriefCompositionFingerprints,
  fixedBriefCompositionCollides,
  sanitizeDesignBrief,
  coerceDesignBriefInput,
  heroLayoutFromCatalog,
  formatCatalogShortlist,
  designUserPrompt,
  designSystemPrompt,
  formatZodIssueList,
} = designBriefMod;
const sampleBrief = {
  designSpec: {
    designIntent: {
      pairing: "sourceSober",
      scale: "majorThird",
      baseSize: "md",
      density: "regular",
      tone: "paper",
      corners: "soft",
      emphasis: "balanced",
    },
  },
  layoutIntent: { hero: "split-media", services: "rows" },
  sections: ["hero", "trustmarkers", "services", "beforeAfter", "reviews", "contact", "footer"].map(
    (type) => ({
      id: type,
      type,
      heading: type,
      body: type,
      entrance:
        type === "trustmarkers" || type === "contact" || type === "footer" ? "none" : "fadeUp",
      hover: "none",
      click: "none",
    }),
  ),
  motionPolicy: { intensity: "minimal", pulseCta: true },
};
assert.equal(designBriefSchema.safeParse(sampleBrief).success, true);
const { layoutIntent: _layoutIntent, ...briefWithoutIntent } = sampleBrief;
assert.equal(
  designBriefSchema.safeParse(briefWithoutIntent).success,
  true,
  "brief without layoutIntent is valid",
);
const parsedSample = designBriefSchema.parse(sampleBrief);
const sanitized = sanitizeDesignBrief(parsedSample, {
  photoCount: 0,
  lookAndFeel: "professional",
  shortlist: { hero: [], services: [], beforeAfter: [], reviews: [], footer: [] },
});
assert.equal("layoutIntent" in sanitized, false);
assert.equal(sanitized.motionPolicy.pulseCta, false);
const sageSnapped = sanitizeDesignBrief(
  {
    ...parsedSample,
    designSpec: {
      designIntent: { ...parsedSample.designSpec.designIntent, tone: "sage" },
    },
  },
  {
    photoCount: 0,
    lookAndFeel: "professional",
    shortlist: { hero: [], services: [], beforeAfter: [], reviews: [], footer: [] },
    primaryColor: "#1e3a5f",
  },
);
assert.equal(sageSnapped.designSpec.designIntent.tone === "sage", false);
assert.equal(
  tonesForPrimaryColor("#1e3a5f").includes(sageSnapped.designSpec.designIntent.tone),
  true,
);
assert.equal(
  heroLayoutFromCatalog({ catalogRef: "hyperui/hero/split-media-right", photoCount: 3 }),
  "split",
);
assert.equal(
  heroLayoutFromCatalog({ catalogRef: "hyperui/hero/split-media-right", photoCount: 0 }),
  "centered",
);
assert.equal(heroLayoutFromCatalog({ photoCount: 3 }), "centered");

const coerced = coerceDesignBriefInput({
  ...sampleBrief,
  layoutIntent: { hero: "split-media-right", services: "three-col-bordered-cards" },
  sections: sampleBrief.sections.map((section) =>
    section.type === "hero"
      ? { ...section, catalogRef: { id: "split-media-right", title: "Split media right" } }
      : section,
  ),
});
const coercedParsed = designBriefSchema.safeParse(coerced);
assert.equal(coercedParsed.success, true);
assert.equal(
  coercedParsed.success && coercedParsed.data.sections.find((s) => s.type === "hero")?.catalogRef,
  "hyperui/hero/split-media-right",
);
assert.equal(coercedParsed.success && "layoutIntent" in coercedParsed.data, false);

const parseAfterCoerce = (raw) => designBriefSchema.safeParse(coerceDesignBriefInput(raw));
const emptyBriefShortlist = { hero: [], services: [], beforeAfter: [], reviews: [], footer: [] };

const sentencePersona = parseAfterCoerce({
  ...sampleBrief,
  persona: "Painting for homeowners in San Francisco.",
});
assert.equal(sentencePersona.success, true, "string persona must not void the brief");
assert.equal(sentencePersona.success && sentencePersona.data.persona, undefined);

const incompletePersona = parseAfterCoerce({
  ...sampleBrief,
  persona: { customer: "homeowners" },
});
assert.equal(incompletePersona.success, true, "incomplete persona must not void the brief");
assert.equal(incompletePersona.success && incompletePersona.data.persona, undefined);

const fadeInHero = parseAfterCoerce({
  ...sampleBrief,
  sections: sampleBrief.sections.map((section) =>
    section.type === "hero" ? { ...section, entrance: "fadeIn" } : section,
  ),
});
assert.equal(fadeInHero.success, true, "illegal entrance must not void the brief");
const fadeInSanitized = sanitizeDesignBrief(fadeInHero.data, {
  photoCount: 0,
  lookAndFeel: "modern",
  shortlist: emptyBriefShortlist,
});
assert.equal(fadeInSanitized.sections.find((s) => s.type === "hero")?.entrance, "fadeUp");

const { motionPolicy: _droppedMotion, ...briefWithoutMotion } = sampleBrief;
const missingMotion = parseAfterCoerce(briefWithoutMotion);
assert.equal(missingMotion.success, true, "missing motionPolicy must not void the brief");
const missingMotionSanitized = sanitizeDesignBrief(missingMotion.data, {
  photoCount: 0,
  lookAndFeel: "modern",
  shortlist: emptyBriefShortlist,
});
assert.equal(missingMotionSanitized.motionPolicy.intensity, "subtle");
assert.equal(missingMotionSanitized.motionPolicy.pulseCta, false);

const pulseCtaString = parseAfterCoerce({
  ...sampleBrief,
  motionPolicy: { intensity: "subtle", pulseCta: "true" },
});
assert.equal(pulseCtaString.success && pulseCtaString.data.motionPolicy?.pulseCta, true);

const badReviewsOnly = coerceDesignBriefInput({
  ...sampleBrief,
  extraReviews: [{ author: "Pat" }],
});
assert.equal(
  Boolean(badReviewsOnly && typeof badReviewsOnly === "object" && "extraReviews" in badReviewsOnly),
  false,
  "bad extraReviews must delete the key, not set []",
);

const mixedReviews = coerceDesignBriefInput({
  ...sampleBrief,
  extraReviews: [{ quote: "Great work", author: "Pat" }, { author: "x" }],
});
assert.deepEqual(
  mixedReviews && typeof mixedReviews === "object" ? mixedReviews.extraReviews : undefined,
  [{ quote: "Great work", author: "Pat" }],
);

const rootIntent = parseAfterCoerce({
  ...sampleBrief,
  designSpec: undefined,
  designIntent: sampleBrief.designSpec.designIntent,
});
assert.equal(rootIntent.success, true, "root designIntent must wrap into designSpec");
assert.equal(rootIntent.success && rootIntent.data.designSpec.designIntent.pairing, "sourceSober");

const flatSpec = parseAfterCoerce({
  ...sampleBrief,
  designSpec: sampleBrief.designSpec.designIntent,
});
assert.equal(flatSpec.success && flatSpec.data.designSpec.designIntent.pairing, "sourceSober");

const missingHeroId = parseAfterCoerce({
  ...sampleBrief,
  sections: sampleBrief.sections.map((section) => {
    if (section.type !== "hero") return section;
    const { id: _id, ...rest } = section;
    return rest;
  }),
});
assert.equal(
  missingHeroId.success && missingHeroId.data.sections.find((s) => s.type === "hero")?.id,
  "hero",
);

const withJunkType = parseAfterCoerce({
  ...sampleBrief,
  sections: [
    ...sampleBrief.sections,
    {
      id: "x",
      type: "Hero",
      heading: "x",
      body: "x",
      entrance: "fadeUp",
      hover: "none",
      click: "none",
    },
  ],
});
assert.equal(
  withJunkType.success,
  false,
  "illegal section type must fail validation so retry can correct",
);
assert.match(
  withJunkType.success ? "" : formatZodIssueList(withJunkType.error),
  /Hero|hero|warranty/,
);

const missingContact = parseAfterCoerce({
  ...sampleBrief,
  sections: sampleBrief.sections.filter((section) => section.type !== "contact"),
});
assert.equal(missingContact.success, false, "missing canonical section type must still fail parse");

const catalogModAgent = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/catalog.server.ts")).href
);
const {
  searchComponentCatalog,
  getCatalogEntryById,
  catalogDigestForIds,
  catalogShortlistForDesign,
  toChatCatalogComponent,
} = catalogModAgent;

for (const query of ["hero", "heroes", "Heroes"]) {
  const hits = searchComponentCatalog({ sectionType: query, limit: 4 });
  assert.ok(hits.length > 0, `catalog query ${query} returns rows`);
  assert.equal(hits[0].source, "hyperui", `named layouts first for ${query}`);
  assert.match(hits[0].id, /^hyperui\/hero\//);
}

const heroHits = searchComponentCatalog({ sectionType: "hero", limit: 8 });
let seenMarketing = false;
for (const entry of heroHits) {
  if (entry.source === "marketing-blocks") seenMarketing = true;
  if (entry.source === "hyperui") {
    assert.equal(seenMarketing, false, "named layouts must precede marketing blocks");
  }
}

const c36Footers = searchComponentCatalog({ sectionType: "footer", trade: "C-36", limit: 4 });
assert.ok(
  c36Footers.length > 0,
  "named footers appear for a trade with no Footers marketing category",
);
assert.ok(c36Footers.every((entry) => entry.source === "hyperui"));

const splitHero = getCatalogEntryById("hyperui/hero/split-media-right");
assert.ok(splitHero);
assert.equal(splitHero.title, "Split media right");
assert.ok(splitHero.layoutSketch);
assert.ok(splitHero.upstream);
assert.match(splitHero.upstream, /tailblocks@34943e63.*hero\/light\/b\.js/);

const digest = catalogDigestForIds(["hyperui/hero/split-media-right"]);
assert.equal(digest.length, 1);
assert.ok(digest[0].layoutSketch);
assert.ok(digest[0].upstream?.includes("src/blocks/hero/light/b.js"));
assert.equal(digest[0].markup, undefined);
assert.equal(digest[0].layoutFamily, "split-media");

const mosaicDigest = catalogDigestForIds(["tailblocks/gallery/mosaic-two-col"]);
assert.equal(mosaicDigest[0].layoutFamily, "mosaic");
assert.equal(mosaicDigest[0].requires?.media, 2);
assert.equal(catalogDigestForIds(["hyperui/reviews/three-col-quote-cards"])[0].requires?.quotes, 3);
assert.equal(catalogDigestForIds(["hyperui/footer/four-col-link-columns"])[0].requires?.anchors, 4);

const catalogServerSrc = fs.readFileSync(
  path.join(here, "../src/lib/agent/catalog.server.ts"),
  "utf8",
);
assert.equal(
  /markup\.includes\(['"]data-layout="grid-3"['"]\)/.test(catalogServerSrc),
  false,
  "content-fit must not parse column counts out of sketch markup",
);
assert.match(catalogServerSrc, /entry\.requires\?\.quotes/);

const chatRow = toChatCatalogComponent(splitHero);
assert.equal("markup" in chatRow, false, "chat payload must not include markup");
assert.equal(chatRow.title, "Split media right");
assert.ok(chatRow.layoutSketch);

const designShortlist = catalogShortlistForDesign("C-36", 4);
assert.ok(designShortlist.services.length > 0, "services is catalog-eligible");
assert.ok(designShortlist.footer.every((entry) => entry.source === "hyperui"));
assert.ok(
  Object.values(designShortlist).every((rows) =>
    rows.every((entry) => entry.source !== "marketing-blocks"),
  ),
  "generate shortlist must not pad with marketing-blocks",
);
assert.ok(Object.values(designShortlist).every((rows) => rows.length <= 4));
const shortlistText = formatCatalogShortlist(designShortlist);
assert.match(shortlistText, /Centered type only|Split media right/);
assert.match(shortlistText, /family=(?:type-only|split-media)/, "shortlist exposes layoutFamily");
assert.equal(
  /<section|<footer|data-slot/.test(shortlistText),
  false,
  "design shortlist must not include markup",
);

const { NAMED_LAYOUTS, resolveNamedLayoutCatalogId } = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/layout-vocabulary.ts")).href
);
const namedIds = NAMED_LAYOUTS.map((entry) => entry.id);
assert.equal(new Set(namedIds).size, namedIds.length, "named layout ids must be unique");
assert.equal(namedIds.length, 27, "the executable NamedLayout registry contains exactly 27 ids");
assert.ok(
  NAMED_LAYOUTS.every((entry) => entry.layoutFamily),
  "every named layout has layoutFamily",
);
assert.ok(NAMED_LAYOUTS.every((entry) => entry.upstream && !entry.markup));
assert.ok(NAMED_LAYOUTS.some((entry) => entry.id === "hyperui/hero/split-media-left"));
assert.ok(NAMED_LAYOUTS.some((entry) => entry.id === "hyperui/hero/overlay-media"));
assert.ok(NAMED_LAYOUTS.some((entry) => entry.id === "hyperui/reviews/two-col-quote-cards"));
assert.ok(NAMED_LAYOUTS.some((entry) => entry.id === "hyperui/services/numbered-step-rows"));
assert.ok(NAMED_LAYOUTS.some((entry) => entry.id === "merakiui/services/cards-left-media-right"));
assert.ok(NAMED_LAYOUTS.some((entry) => entry.id === "tailblocks/gallery/mosaic-two-col"));
const reviewsDefault = "hyperui/reviews/stacked-quote-list";
assert.equal(
  resolveNamedLayoutCatalogId("reviews", "hyperui/reviews/featured-quote", reviewsDefault),
  "hyperui/reviews/featured-quote",
);
assert.equal(
  resolveNamedLayoutCatalogId("reviews", "hyperui/hero/split-media-right", reviewsDefault),
  reviewsDefault,
  "a known catalog ref from another canonical section safely uses this section's default",
);
assert.equal(
  resolveNamedLayoutCatalogId("reviews", undefined, reviewsDefault),
  reviewsDefault,
  "historical missing refs retain the section fallback",
);
assert.equal(
  resolveNamedLayoutCatalogId("reviews", "not-a-real-id", reviewsDefault),
  reviewsDefault,
  "historical unknown refs retain the section fallback",
);
assert.match(
  NAMED_LAYOUTS.find((entry) => entry.id === "hyperui/gallery/header-left-image-grid")?.upstream ??
    "",
  /product-collections\/1\.html/,
);

const zeroPhotoShortlist = catalogShortlistForDesign("C-36", 4, 0, 0, 3);
assert.equal(zeroPhotoShortlist.beforeAfter.length, 0);
assert.ok(zeroPhotoShortlist.hero.every((entry) => !entry.requiresMedia));
assert.ok(zeroPhotoShortlist.hero.every((entry) => entry.source === "hyperui"));
assert.ok(zeroPhotoShortlist.hero.some((entry) => /type-only/.test(entry.id)));
assert.equal(
  zeroPhotoShortlist.services.some(
    (entry) => entry.id === "merakiui/services/cards-left-media-right",
  ),
  false,
);
assert.equal(
  zeroPhotoShortlist.reviews.some((entry) => entry.id === "hyperui/reviews/three-col-quote-cards"),
  false,
);
assert.equal(
  zeroPhotoShortlist.reviews.some((entry) => entry.id === "hyperui/reviews/two-col-quote-cards"),
  false,
);

const shortNavShortlist = catalogShortlistForDesign("C-33", 20, 5, 2, 3);
assert.equal(
  shortNavShortlist.footer.some((entry) => entry.id === "hyperui/footer/four-col-link-columns"),
  false,
  "shortlist must not advertise layouts whose anchor requirement cannot be met",
);
const longNavShortlist = catalogShortlistForDesign("C-33", 20, 5, 2, 4);
assert.equal(
  longNavShortlist.footer.some((entry) => entry.id === "hyperui/footer/four-col-link-columns"),
  true,
);

const twoQuoteShortlist = catalogShortlistForDesign("C-33", 4, 5, 2, 6);
assert.ok(twoQuoteShortlist.hero.some((entry) => entry.layoutFamily === "overlay-media"));
assert.ok(twoQuoteShortlist.hero.some((entry) => entry.layoutFamily === "split-media"));
assert.ok(twoQuoteShortlist.hero.some((entry) => entry.layoutFamily === "type-only"));
assert.ok(twoQuoteShortlist.hero.some((entry) => entry.layoutFamily === "stacked-media"));
assert.equal(
  twoQuoteShortlist.hero.some((entry) => entry.id === "hyperui/hero/split-media-wide"),
  false,
  "split-media-wide appears when it is the split-family pick, not ahead of other families",
);
assert.ok(
  twoQuoteShortlist.reviews.some((entry) => entry.id === "hyperui/reviews/two-col-quote-cards"),
);
assert.equal(
  twoQuoteShortlist.reviews.some((entry) => entry.id === "hyperui/reviews/three-col-quote-cards"),
  false,
);
assert.ok(twoQuoteShortlist.beforeAfter.length > 0);
assert.ok(
  twoQuoteShortlist.services.some((entry) => entry.id === "hyperui/services/numbered-step-rows"),
);
assert.ok(
  twoQuoteShortlist.services.some(
    (entry) => entry.id === "merakiui/services/cards-left-media-right",
  ),
);
assert.ok(
  twoQuoteShortlist.beforeAfter.some((entry) => entry.id === "tailblocks/gallery/mosaic-two-col"),
);
assert.equal(new Set(twoQuoteShortlist.hero.map((entry) => entry.layoutFamily)).size, 4);

const threeQuoteShortlist = catalogShortlistForDesign("C-33", 4, 3, 3);
assert.ok(
  threeQuoteShortlist.reviews.some((entry) => entry.id === "hyperui/reviews/three-col-quote-cards"),
);

const chatHeroFill = searchComponentCatalog({ sectionType: "hero", limit: 8 });
assert.ok(
  chatHeroFill.some((entry) => entry.source === "marketing-blocks"),
  "chat catalog still fills with marketing-blocks",
);

const namedType = getCatalogEntryById("hyperui/hero/centered-type-only");
const namedRows = getCatalogEntryById("hyperui/services/heading-left-list-right");
const namedCards = getCatalogEntryById("hyperui/services/three-col-bordered-cards");
const namedGallery = getCatalogEntryById("hyperui/gallery/header-left-image-grid");
const namedFooterGrid = getCatalogEntryById("hyperui/footer/four-col-link-columns");
const namedFooterType = getCatalogEntryById("hyperui/footer/brand-plus-legal-bar");
const vocabShortlist = {
  hero: [splitHero, namedType],
  services: [namedRows, namedCards],
  beforeAfter: [namedGallery],
  reviews: [],
  footer: [namedFooterGrid, namedFooterType],
};

const withNamedRefs = {
  ...sampleBrief,
  sections: sampleBrief.sections.map((section) => {
    if (section.type === "hero") return { ...section, catalogRef: splitHero.id };
    if (section.type === "services") return { ...section, catalogRef: namedRows.id };
    if (section.type === "beforeAfter") return { ...section, catalogRef: namedGallery.id };
    if (section.type === "trustmarkers") return { ...section, catalogRef: splitHero.id };
    return section;
  }),
};

const noPhotoSanitized = sanitizeDesignBrief(withNamedRefs, {
  photoCount: 0,
  lookAndFeel: "professional",
  shortlist: vocabShortlist,
});
assert.equal(noPhotoSanitized.sections.find((s) => s.type === "hero")?.catalogRef, undefined);
assert.equal(
  noPhotoSanitized.sections.find((s) => s.type === "beforeAfter")?.catalogRef,
  undefined,
);
assert.equal(
  noPhotoSanitized.sections.find((s) => s.type === "services")?.catalogRef,
  namedRows.id,
);
assert.equal(
  noPhotoSanitized.sections.find((s) => s.type === "trustmarkers")?.catalogRef,
  undefined,
);
assert.equal(
  noPhotoSanitized.sections.some((s) => s.type === "beforeAfter"),
  false,
  "no photos → drop the gated gallery band",
);
assert.equal(
  noPhotoSanitized.sections.some((s) => s.type === "reviews"),
  false,
  "no quotes → drop the gated reviews band",
);
assert.deepEqual(
  noPhotoSanitized.sections.map((s) => s.type),
  ["hero", "services", "contact", "footer"],
);

const withPhotoSanitized = sanitizeDesignBrief(withNamedRefs, {
  photoCount: 3,
  lookAndFeel: "modern",
  shortlist: vocabShortlist,
});
assert.equal(withPhotoSanitized.sections.find((s) => s.type === "hero")?.catalogRef, splitHero.id);
assert.equal(
  withPhotoSanitized.sections.find((s) => s.type === "services")?.catalogRef,
  namedRows.id,
);

const cardsVsRows = {
  ...sampleBrief,
  sections: sampleBrief.sections.map((section) =>
    section.type === "services" ? { ...section, catalogRef: namedCards.id } : section,
  ),
};
const catalogPickKept = sanitizeDesignBrief(cardsVsRows, {
  photoCount: 0,
  lookAndFeel: "professional",
  shortlist: vocabShortlist,
});
assert.equal(
  catalogPickKept.sections.find((s) => s.type === "services")?.catalogRef,
  namedCards.id,
);

const illegalRef = {
  ...sampleBrief,
  sections: sampleBrief.sections.map((section) =>
    section.type === "hero" ? { ...section, catalogRef: "not-a-real-id" } : section,
  ),
};
const illegalSanitized = sanitizeDesignBrief(illegalRef, {
  photoCount: 1,
  lookAndFeel: "modern",
  shortlist: vocabShortlist,
});
assert.equal(
  illegalSanitized.sections.find((s) => s.type === "hero")?.catalogRef,
  undefined,
  "illegal optional catalogRef is dropped rather than forcing the first template",
);

const marketingHero = getCatalogEntryById("Heroes/0002-hero-07.html");
assert.equal(marketingHero?.source, "marketing-blocks");
const forgedMarketingShortlist = { ...vocabShortlist, hero: [marketingHero] };
const marketingSanitized = sanitizeDesignBrief(
  {
    ...sampleBrief,
    sections: sampleBrief.sections.map((section) =>
      section.type === "hero" ? { ...section, catalogRef: marketingHero.id } : section,
    ),
  },
  { photoCount: 1, lookAndFeel: "modern", shortlist: forgedMarketingShortlist },
);
assert.equal(
  marketingSanitized.sections.find((s) => s.type === "hero")?.catalogRef,
  undefined,
  "marketing-only refs cannot become NamedLayout even if a shortlist is malformed",
);
const wrongSectionSanitized = sanitizeDesignBrief(
  {
    ...sampleBrief,
    sections: sampleBrief.sections.map((section) =>
      section.type === "services" ? { ...section, catalogRef: splitHero.id } : section,
    ),
  },
  {
    ...{ photoCount: 1, lookAndFeel: "modern" },
    shortlist: { ...vocabShortlist, services: [splitHero] },
  },
);
assert.equal(
  wrongSectionSanitized.sections.find((s) => s.type === "services")?.catalogRef,
  undefined,
  "an executable ref is accepted only for its canonical section",
);

const omittedCatalog = sanitizeDesignBrief(parsedSample, {
  photoCount: 1,
  lookAndFeel: "modern",
  shortlist: vocabShortlist,
});
assert.equal(
  omittedCatalog.sections.find((s) => s.type === "hero")?.catalogRef,
  undefined,
  "omitted catalogRef remains freehand-eligible",
);
assert.equal(omittedCatalog.sections.find((s) => s.type === "services")?.catalogRef, undefined);
assert.equal(omittedCatalog.sections.find((s) => s.type === "beforeAfter")?.catalogRef, undefined);

const quietIncompatible = sanitizeDesignBrief(
  {
    ...withNamedRefs,
    designSpec: { designIntent: { ...sampleBrief.designSpec.designIntent, emphasis: "quiet" } },
  },
  { photoCount: 3, quoteCount: 1, lookAndFeel: "modern", shortlist: vocabShortlist },
);
assert.equal(
  quietIncompatible.sections.find((s) => s.type === "hero")?.catalogRef,
  undefined,
  "sanitization drops a named family incompatible with accepted designIntent",
);
assert.equal(
  quietIncompatible.sections.find((s) => s.type === "services")?.catalogRef,
  namedRows.id,
);

const footerAnchorBrief = {
  ...sampleBrief,
  sections: sampleBrief.sections.map((section) =>
    section.type === "footer" ? { ...section, catalogRef: namedFooterGrid.id } : section,
  ),
};
const insufficientAnchors = sanitizeDesignBrief(footerAnchorBrief, {
  photoCount: 0,
  quoteCount: 0,
  lookAndFeel: "modern",
  shortlist: vocabShortlist,
});
assert.equal(
  insufficientAnchors.sections.find((s) => s.type === "footer")?.catalogRef,
  undefined,
  "declared anchors use the current section/nav registry count",
);
const enoughAnchors = sanitizeDesignBrief(footerAnchorBrief, {
  photoCount: 2,
  quoteCount: 1,
  warranty: "Ten years",
  lookAndFeel: "modern",
  shortlist: vocabShortlist,
});
assert.equal(
  enoughAnchors.sections.find((s) => s.type === "footer")?.catalogRef,
  namedFooterGrid.id,
);

const fullyNamed = sanitizeDesignBrief(
  {
    ...sampleBrief,
    sections: sampleBrief.sections.map((section) => {
      if (section.type === "hero") return { ...section, catalogRef: namedType.id };
      if (section.type === "services") return { ...section, catalogRef: namedRows.id };
      if (section.type === "footer") return { ...section, catalogRef: namedFooterType.id };
      return section;
    }),
  },
  { photoCount: 0, quoteCount: 0, lookAndFeel: "modern", shortlist: vocabShortlist },
);
const fixedFingerprints = feasibleBriefCompositionFingerprints(fullyNamed, { photoCount: 0 });
assert.deepEqual(fixedFingerprints, ["hero:type-only|services:rows|footer:type-only"]);
assert.equal(
  fixedBriefCompositionCollides(fullyNamed, {
    photoCount: 0,
    forbiddenLayouts: new Set(fixedFingerprints),
  }),
  true,
  "fully named collision is knowable before code generation",
);
const partiallyNamed = {
  ...fullyNamed,
  sections: fullyNamed.sections.map((section) => {
    if (section.type !== "services") return section;
    const { catalogRef: _catalogRef, ...freehand } = section;
    return freehand;
  }),
};
assert.equal(
  fixedBriefCompositionCollides(partiallyNamed, {
    photoCount: 0,
    forbiddenLayouts: new Set([
      "hero:type-only@centered|services:rows@stacked|contact:missing|footer:type-only@legal",
    ]),
  }),
  false,
  "one colliding feasible signature does not reject a partially named brief",
);
const loudZeroPhotoBrief = {
  ...fullyNamed,
  designSpec: {
    designIntent: { ...fullyNamed.designSpec.designIntent, emphasis: "loud" },
  },
  sections: fullyNamed.sections.map(({ catalogRef: _catalogRef, ...section }) => section),
};
assert.deepEqual(
  feasibleBriefCompositionFingerprints(loudZeroPhotoBrief, { photoCount: 0 }),
  [],
  "zero-photo loud briefs expose an empty composition set for the pre-code retry gate",
);

const missingReviewsBrief = {
  ...sampleBrief,
  sections: sampleBrief.sections.filter(
    (section) =>
      section.type !== "reviews" &&
      section.type !== "beforeAfter" &&
      section.type !== "trustmarkers",
  ),
};
assert.equal(
  designBriefSchema.safeParse(missingReviewsBrief).success,
  true,
  "evidence-gated sections are optional in the schema",
);
const missingHeroBrief = {
  ...sampleBrief,
  sections: sampleBrief.sections.filter((section) => section.type !== "hero"),
};
assert.equal(designBriefSchema.safeParse(missingHeroBrief).success, false, "hero remains required");

const unknownTypeRaw = coerceDesignBriefInput({
  ...sampleBrief,
  sections: [
    ...sampleBrief.sections,
    {
      id: "pricing",
      type: "pricing",
      heading: "Rates",
      body: "Call us",
      entrance: "none",
      hover: "none",
      click: "none",
    },
  ],
});
const unknownTypeParsed = designBriefSchema.safeParse(unknownTypeRaw);
assert.equal(
  unknownTypeParsed.success,
  false,
  "unknown section types must fail validation, not vanish",
);
assert.match(
  unknownTypeParsed.success ? "" : formatZodIssueList(unknownTypeParsed.error),
  /pricing|hero|warranty/,
);

const withWarranty = sanitizeDesignBrief(
  designBriefSchema.parse({
    ...sampleBrief,
    sections: [
      ...sampleBrief.sections,
      {
        id: "warranty",
        type: "warranty",
        heading: "Warranty",
        body: "2-year workmanship",
        entrance: "fadeUp",
        hover: "none",
        click: "none",
      },
    ],
  }),
  {
    photoCount: 0,
    lookAndFeel: "professional",
    shortlist: emptyBriefShortlist,
    warranty: "2-year workmanship",
  },
);
assert.equal(
  withWarranty.sections.some((s) => s.type === "warranty"),
  true,
);
assert.equal(
  withWarranty.sections.some((s) => s.type === "hours"),
  false,
);

const sysPrompt = designSystemPrompt({
  primaryColor: "#1e3a5f",
  sectionIds: ["hero", "services", "contact", "footer"],
});
assert.match(sysPrompt, /Required spine/);
assert.match(sysPrompt, /hero, services, contact, footer/);
assert.equal(/exactly these sections in order: hero, trustmarkers/.test(sysPrompt), false);

assert.match(generatorSrc, /NamedLayout/);
assert.doesNotMatch(generatorSrc, /codeAttempts = 3|two-step-design|two-step-code/);
assert.doesNotMatch(generatorSrc, /persisting fallback|asHonestFallback|return fallback\(\)/);
assert.match(generatorSrc, /writerRepairNote/);
assert.doesNotMatch(
  generatorSrc,
  /persistScrapedSiteMedia/,
  "site generation must consume the authoritative stored inventory without repairing it",
);
const executeSrc = fs.readFileSync(path.join(here, "../src/lib/jobs/execute.server.ts"), "utf8");
assert.doesNotMatch(
  executeSrc,
  /persistFrozenEnrichment/,
  "site generation must not copy remote photos during generate",
);
assert.match(executeSrc, /overlayStoredEvidenceOnFrozenEnrichment/);

const persistSrc = fs.readFileSync(
  path.join(here, "../src/lib/media/persist-scraped-media.server.ts"),
  "utf8",
);
assert.match(persistSrc, /buildFactSheet/);
assert.match(persistSrc, /listingUrlForImage/);
assert.equal(/selectEnrichmentImagesToPersist/.test(persistSrc), false);

const factSheetSrc = fs.readFileSync(path.join(here, "../src/lib/site-fact-sheet.ts"), "utf8");
assert.match(factSheetSrc, /overlayStoragePathByUrl\(images, enrichmentGallery/);

const siteMediaSrc = fs.readFileSync(
  path.join(here, "../src/lib/media/site-media.server.ts"),
  "utf8",
);
assert.match(siteMediaSrc, /overlayStoragePathByUrl/);
assert.doesNotMatch(
  siteMediaSrc,
  /persistScrapedSiteMedia/,
  "display resolution must not repair or write evidence metadata",
);
const uploadSrc = fs.readFileSync(
  path.join(here, "../src/lib/upload.functions.ts"),
  "utf8",
);
const siteRendererSrc = fs.readFileSync(
  path.join(here, "../src/components/site-renderer/SiteRenderer.tsx"),
  "utf8",
);
const generatedHostSrc = fs.readFileSync(
  path.join(here, "../src/components/site-renderer/GeneratedSiteHost.tsx"),
  "utf8",
);
assert.match(uploadSrc, /url,/);
assert.match(siteRendererSrc, /mediaGallery: nextGallery/);
assert.match(siteRendererSrc, /const nextGallery = \[[^\]]*uploaded/s);
assert.match(generatedHostSrc, /mediaGallery: \[[^\]]*uploaded/s);

const fingerprintSrc = fs.readFileSync(
  path.join(here, "../src/lib/agent/prior-variant-summary.ts"),
  "utf8",
);
assert.match(fingerprintSrc, /component_ids/);
assert.match(fingerprintSrc, /canonicalSection/);
assert.match(fingerprintSrc, /layoutFamily/);
assert.match(fingerprintSrc, /familyFromStructure/);
assert.equal(/bands /.test(fingerprintSrc), false);

const emptyShortlist = { hero: [], services: [], beforeAfter: [], reviews: [], footer: [] };
const c33Prompt = designUserPrompt({
  variantKey: "v1",
  factSheet: {
    businessName: "VSA",
    licenseNumber: "990233",
    trade: "C-33",
    city: "San Francisco",
    services: ["Residential", "Commercial"],
    theme: "light",
    lookAndFeel: "professional",
    primaryColor: "#1e3a5f",
    phone: null,
    address: null,
    hours: null,
    warranty: null,
    images: [],
    reviews: [],
    trustMarkers: [],
    servicesOffered: null,
  },
  contactHidden: false,
  priorNote: "",
  retryNote: "",
  shortlist: emptyShortlist,
});
assert.match(c33Prompt, /Interior house painting/);
assert.equal(/General Engineering Contractor/.test(c33Prompt), false);
assert.match(c33Prompt, /do not skip because onboarding services is already filled/);
assert.equal(/No layoutIntent/.test(c33Prompt), true);
assert.match(c33Prompt, /customer/);
assert.match(c33Prompt, /offering/);
assert.match(c33Prompt, /place/);
assert.match(c33Prompt, /proof/);
assert.match(c33Prompt, /visualDirection/);
assert.match(c33Prompt, /conversionAsk/);
assert.match(c33Prompt, /omit the key rather than a sentence/);
assert.equal(/what does this business do, for whom, where/.test(c33Prompt), false);
assert.match(c33Prompt, /tone must be one of:/);
assert.equal(
  /tone must be one of:[^\n]*sage/.test(c33Prompt),
  false,
  "navy prompt must not offer sage",
);

const unknownTradePrompt = designUserPrompt({
  variantKey: "v1",
  factSheet: {
    businessName: "VSA",
    licenseNumber: "990233",
    trade: "NOT-A-CLASS",
    city: "San Francisco",
    services: ["Residential"],
    theme: "light",
    lookAndFeel: "professional",
    primaryColor: "#1e3a5f",
    phone: null,
    address: null,
    hours: null,
    warranty: null,
    images: [],
    reviews: [],
    trustMarkers: [],
    servicesOffered: null,
  },
  contactHidden: false,
  priorNote: "",
  retryNote: "",
  shortlist: emptyShortlist,
});
assert.equal(/Typical services/.test(unknownTradePrompt), false);

const { typicalServicesForTrade, formatTypicalServicesForDesign } = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/trade-services.server.ts")).href
);
const { SERVICES_DOC } = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/services-doc.ts")).href
);
assert.equal(
  SERVICES_DOC,
  fs.readFileSync(path.join(here, "../docs/services.md"), "utf8"),
  "inlined services doc must match docs/services.md",
);
const c33 = typicalServicesForTrade("C-33");
assert.ok(c33);
assert.ok(c33.typicalServices.includes("Interior house painting"));
assert.equal(typicalServicesForTrade("B")?.code, "B");
assert.notEqual(typicalServicesForTrade("B")?.code, "B-2");
assert.equal(typicalServicesForTrade("unknown-trade"), null);
assert.match(formatTypicalServicesForDesign("C-33"), /Cabinet painting/);
assert.equal(formatTypicalServicesForDesign("nope"), "");

const { z } = await import("zod");
const fakeZod = z.object({ layoutIntent: z.object({ hero: z.enum(["split-media"]) }) }).safeParse({
  layoutIntent: { hero: "split-media-right" },
});
assert.equal(fakeZod.success, false);
assert.match(formatZodIssueList(fakeZod.error), /layoutIntent/);
const registrySrc = fs.readFileSync(path.join(here, "../src/lib/agent/tools/registry.ts"), "utf8");
assert.match(registrySrc, /applyTemplatePatch/);
assert.match(registrySrc, /getEnrichmentSummary/);
assert.doesNotMatch(registrySrc, /searchComponentLibrary|generateVariants|named layouts/);
assert.equal(
  /searchComponentCatalog/.test(
    fs.readFileSync(path.join(here, "../src/lib/agent/tools/handlers.server.ts"), "utf8"),
  ),
  false,
  "live agent turns must not search the component catalog",
);

const auditMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-theme/kit-audit.ts")).href
);
const { auditKitThemeSource } = auditMod;
const invalidMediaMotion = auditKitThemeSource(`<Media slotId="motion" motion="mobile" />`);
assert.equal(
  invalidMediaMotion.some((finding) => finding.code === "kit-prop-value"),
  true,
);
const markerManifest = {
  slots: [
    {
      slotId: "hero-image",
      assetId: "asset",
      origin: "generated",
      role: "hero",
      proofEligible: false,
      mimeType: "image/jpeg",
      alt: "Hero",
      storagePath: "site/generated/hero.jpg",
      required: true,
    },
    {
      slotId: "support-image",
      assetId: "asset-2",
      origin: "generated",
      role: "support",
      proofEligible: false,
      mimeType: "image/jpeg",
      alt: "Support",
      storagePath: "site/generated/support.jpg",
      required: false,
    },
  ],
};
const markerSource = `export default function Site(){ return <main><section data-site-section="hero"><Media slotId="hero-image" /><LeadSlot /></section></main>; }`;
assert.equal(
  compileThemeSource(markerSource, {
    unifiedLoose: true,
    generatorSchemaVersion: 3,
    mediaManifest: markerManifest,
    sectionTopology: [{ section: "hero" }],
  }).ok,
  true,
);
assert.equal(
  compileThemeSource(
    markerSource.replace('data-site-section="hero"', 'data-site-section={"hero"}'),
    {
      unifiedLoose: true,
      generatorSchemaVersion: 3,
      mediaManifest: markerManifest,
      sectionTopology: [{ section: "hero" }],
    },
  ).ok,
  false,
);
assert.equal(
  compileThemeSource(markerSource, {
    unifiedLoose: true,
    generatorSchemaVersion: 3,
    mediaManifest: markerManifest,
    sectionTopology: [{ section: "hero" }, { section: "services" }],
  }).ok,
  false,
);

const NAMED_THEME = `export default function Site(props: SiteProps) {
  return (
    <>
      <Header logoUrl={props.logoUrl} businessName={props.businessName} contactHidden={props.contactHidden} />
      <NamedLayout section="hero" band="base" pad="loose" />
      <Section id="trustmarkers" band="soft" pad="tight" entrance="none">
        <TrustMarkerList markers={props.trustMarkers} />
      </Section>
      <NamedLayout section="services" band="soft" />
      <NamedLayout section="beforeAfter" band="base" />
      <NamedLayout section="reviews" band="soft" />
      <Section id="contact" band="primary" pad="normal" entrance="none">
        <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />
      </Section>
      <NamedLayout section="footer" band="ink" />
    </>
  );
}
`;

const namedCompiled = compileThemeSource(NAMED_THEME, {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
  catalogRefs: [
    "hyperui/hero/split-media-right",
    "hyperui/services/three-col-bordered-cards",
    "tailblocks/gallery/mosaic-two-col",
    "hyperui/reviews/featured-quote",
    "hyperui/footer/stacked-brand-nav-legal",
  ],
  requireNamedLayouts: true,
});
assert.equal(namedCompiled.ok, true, namedCompiled.ok ? "" : namedCompiled.error);
for (const rejectedRef of ["Heroes/0002-hero-07.html", "not-a-real-id"]) {
  const rejected = compileThemeSource(NAMED_THEME, {
    hasMedia: true,
    hasReviews: true,
    hasTrustMarkers: true,
    catalogRefs: [rejectedRef],
    requireNamedLayouts: true,
  });
  assert.equal(rejected.ok, false, `generate validator rejects unexecutable ref: ${rejectedRef}`);
  assert.match(rejected.ok ? "" : rejected.error, /executable NamedLayout/);
}
const wrongSectionRef = compileThemeSource(NAMED_THEME, {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
  catalogRefs: ["hyperui/hero/split-media-right"],
  requireNamedLayouts: true,
});
assert.equal(
  wrongSectionRef.ok,
  false,
  "generate validator rejects NamedLayout under the wrong section",
);

const MIXED_THEME = NAMED_THEME.replace(
  '<NamedLayout section="services" band="soft" />',
  '<Section id="services" band="soft"><Grid><Card /></Grid></Section>',
).replace(
  '<NamedLayout section="footer" band="ink" />',
  '<Section id="footer" band="ink">Footer</Section>',
);
assert.equal(
  compileThemeSource(MIXED_THEME, {
    hasMedia: true,
    hasReviews: true,
    hasTrustMarkers: true,
    catalogRefs: [
      "hyperui/hero/split-media-right",
      "tailblocks/gallery/mosaic-two-col",
      "hyperui/reviews/featured-quote",
    ],
    requireNamedLayouts: true,
  }).ok,
  true,
  "eligible sections without accepted catalogRef may be freehand/grouped",
);
const FREEHAND_EVIDENCE_THEME = NAMED_THEME.replace(
  '<NamedLayout section="beforeAfter" band="base" />',
  '<Section id="beforeAfter" band="base">{props.media.length > 0 && <MediaGallery items={props.media} />}</Section>',
).replace(
  '<NamedLayout section="reviews" band="soft" />',
  '<Section id="reviews" band="soft">{props.reviews.map((review) => <Quote quote={review.quote} source={review.source} />)}</Section>',
);
const freehandEvidenceOptions = {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
  catalogRefs: [
    "hyperui/hero/split-media-right",
    "hyperui/services/three-col-bordered-cards",
    "hyperui/footer/stacked-brand-nav-legal",
  ],
  requireNamedLayouts: true,
};
assert.equal(compileThemeSource(FREEHAND_EVIDENCE_THEME, freehandEvidenceOptions).ok, true);
assert.match(
  compileThemeSource(
    FREEHAND_EVIDENCE_THEME.replace(
      "{props.media.length > 0 && <MediaGallery items={props.media} />}",
      "<Text>No gallery</Text>",
    ),
    freehandEvidenceOptions,
  ).error ?? "",
  /freehand beforeAfter must consume props.media/,
);
assert.match(
  compileThemeSource(
    FREEHAND_EVIDENCE_THEME.replace(
      "{props.reviews.map((review) => <Quote quote={review.quote} source={review.source} />)}",
      "<Text>No reviews</Text>",
    ),
    freehandEvidenceOptions,
  ).error ?? "",
  /freehand reviews must consume props.reviews/,
);
assert.equal(
  compileThemeSource(
    MIXED_THEME.replace(
      '<Section id="services" band="soft"><Grid><Card /></Grid></Section>',
      '<NamedLayout section="services" band="soft" />',
    ),
    {
      hasMedia: true,
      hasReviews: true,
      hasTrustMarkers: true,
      catalogRefs: [
        "hyperui/hero/split-media-right",
        "tailblocks/gallery/mosaic-two-col",
        "hyperui/reviews/featured-quote",
      ],
      requireNamedLayouts: true,
    },
  ).ok,
  false,
  "NamedLayout cannot be used without an accepted catalogRef",
);

assert.equal(
  (namedCompiled.advisories ?? []).some((item) => item.severity === "error"),
  false,
);
assert.equal(
  (namedCompiled.advisories ?? []).some((item) => item.code === "layout-family-mismatch"),
  false,
  "NamedLayout owns composition; layout-family-mismatch is retired",
);
assert.equal(
  compileThemeSource(
    NAMED_THEME.replace('<NamedLayout section="hero" band="base" pad="loose" />', ""),
    {
      hasMedia: true,
      hasReviews: true,
      hasTrustMarkers: true,
      requireNamedLayouts: true,
    },
  ).ok,
  false,
  "generate requires NamedLayout for catalog sections",
);
assert.equal(
  compileThemeSource(
    NAMED_THEME.replace(
      '<NamedLayout section="hero" band="base" pad="loose" />',
      '<Section id="hero" band="base"><NamedLayout section="hero" /></Section>',
    ),
    {
      hasMedia: true,
      hasReviews: true,
      hasTrustMarkers: true,
      requireNamedLayouts: true,
    },
  ).ok,
  false,
  "NamedLayout must not be wrapped in Section",
);
assert.match(
  compileThemeSource(
    NAMED_THEME.replace(
      '<NamedLayout section="hero" band="base" pad="loose" />',
      '<NamedLayout section="hero" band="base" pad="loose" /><h1>Headline</h1>',
    ),
    {
      hasMedia: true,
      hasReviews: true,
      hasTrustMarkers: true,
      catalogRefs: [
        "hyperui/hero/split-media-right",
        "hyperui/services/three-col-bordered-cards",
        "tailblocks/gallery/mosaic-two-col",
        "hyperui/reviews/featured-quote",
        "hyperui/footer/stacked-brand-nav-legal",
      ],
      requireNamedLayouts: true,
    },
  ).error ?? "",
  /h1/,
);

const headingSized = validateThemeSource(
  VALID_THEME.replace(
    '<Heading as="h1">{hero?.heading}</Heading>',
    '<Heading as="h1" className="text-4xl">{hero?.heading}</Heading>',
  ),
  { hasMedia: true, hasReviews: true, hasTrustMarkers: true },
);
assert.equal(headingSized.ok, false, "text-4xl on Heading is a kit-owned utility error");
assert.match(headingSized.ok ? "" : headingSized.error, /level=/);

const headingInkColor = validateThemeSource(
  VALID_THEME.replace(
    '<Heading as="h1">{hero?.heading}</Heading>',
    '<Heading as="h1" className="text-[var(--site-ink)]">{hero?.heading}</Heading>',
  ),
  { hasMedia: true, hasReviews: true, hasTrustMarkers: true },
);
assert.equal(headingInkColor.ok, true, headingInkColor.ok ? "" : headingInkColor.error);

const headingClamp = validateThemeSource(
  VALID_THEME.replace(
    '<Heading as="h1">{hero?.heading}</Heading>',
    '<Heading as="h1" className="text-[clamp(1.5rem,3vw,3rem)]">{hero?.heading}</Heading>',
  ),
  { hasMedia: true, hasReviews: true, hasTrustMarkers: true },
);
assert.equal(headingClamp.ok, false, "text-[clamp] on Heading is a kit-owned size");
assert.match(headingClamp.ok ? "" : headingClamp.error, /level=/);

assert.match(kitSrc, /--site-muted-ramp/);
assert.match(kitSrc, /function bandMutedOn/);
assert.match(kitSrc, /color-mix\(in oklab/);
assert.match(bootstrapSrc, /--site-muted-ramp/);
assert.match(hostTemplate, /--site-muted-ramp/);

const mikeSrc = fs.readFileSync(path.join(here, "fixtures/mike-ph-theme-source.tsx"), "utf8");
assert.equal(
  isStructurallyValidTheme(mikeSrc),
  true,
  "stored defective themeSource remains structurally renderable",
);
const mikeValidate = validateThemeSource(mikeSrc, {
  hasMedia: true,
  hasReviews: true,
  hasTrustMarkers: true,
  catalogRefs: ["tailblocks/gallery/mosaic-two-col"],
});
assert.equal(mikeValidate.ok, false, "Mike P H defects must fail generate-time kit audit");
assert.match(mikeValidate.ok ? "" : mikeValidate.error, /opacity-/);
assert.match(mikeValidate.ok ? "" : mikeValidate.error, /surface="plain"/);
assert.match(mikeValidate.ok ? "" : mikeValidate.error, /MediaGallery does not accept stagger/);
assert.match(mikeValidate.ok ? "" : mikeValidate.error, /MediaGallery does not accept hover/);
assert.match(mikeValidate.ok ? "" : mikeValidate.error, /level=/);

const mikeFindings = auditKitThemeSource(mikeSrc, {
  catalogRefs: ["tailblocks/gallery/mosaic-two-col"],
});
const mikeCodes = new Set(mikeFindings.map((item) => item.code));
assert.equal(mikeCodes.has("kit-owned-utility"), true);
assert.equal(mikeCodes.has("unknown-kit-prop"), true);
assert.equal(
  mikeFindings.some(
    (item) => item.code === "nonliteral-kit-prop" && /contactHidden/.test(item.message),
  ),
  false,
  "Header contactHidden from props is not a generate failure",
);
assert.equal(mikeCodes.has("same-consecutive-band"), true);
assert.equal(mikeCodes.has("layout-family-mismatch"), false, "layout-family-mismatch is retired");
assert.ok(
  mikeFindings.some((item) => item.code === "kit-owned-utility" && /opacity-/.test(item.message)),
  "hero double-scrim: opacity on Media",
);
assert.ok(
  mikeFindings.some(
    (item) => item.code === "kit-owned-utility" && /bg-transparent/.test(item.message),
  ),
  "Card bg-transparent must name surface=plain",
);
assert.ok(
  mikeFindings.some((item) => item.code === "kit-owned-utility" && /text-4xl/.test(item.message)),
  "Heading type-size utilities must name level",
);
assert.ok(
  mikeFindings.some(
    (item) =>
      item.severity === "advisory" &&
      item.code === "same-consecutive-band" &&
      /soft/.test(item.message),
  ),
);

const footerFit = auditKitThemeSource(
  `<Section id="footer" band="base"><a href="#services">Services</a></Section>`,
  { catalogRefs: ["hyperui/footer/four-col-link-columns"] },
);
assert.equal(
  footerFit.some((item) => item.code === "content-fit-anchors"),
  false,
  "content-fit-anchors retired with layout-family-mismatch",
);

const typeOnlyWithGallery = auditKitThemeSource(
  `<Section id="hero" band="base"><Heading level="display">Hi</Heading></Section>
<Section id="beforeAfter" band="soft"><MediaGallery media={props.media} /></Section>`,
  { catalogRefs: ["hyperui/hero/centered-type-only"] },
);
assert.equal(
  typeOnlyWithGallery.some((item) => item.code === "layout-family-mismatch"),
  false,
);

const overlayViaMediaProp = auditKitThemeSource(
  `<Section media={still} id="hero" band="media"><Heading level="display">Hi</Heading></Section>`,
  { catalogRefs: ["hyperui/hero/overlay-media"] },
);
assert.equal(
  overlayViaMediaProp.some((item) => item.code === "layout-family-mismatch"),
  false,
);
assert.match(kitSrc, /overlay \? \(scrim \?\? "soft"\)/);

assert.equal(
  validateThemeSource(
    VALID_THEME.replace(
      '<Section id="beforeAfter"><MediaGallery media={props.media} className="grid grid-cols-2 gap-4" /></Section>',
      "",
    ),
  ).ok,
  true,
  "gated beforeAfter is not required without media evidence",
);
assert.equal(
  validateThemeSource(
    VALID_THEME.replace(
      '<Section id="beforeAfter"><MediaGallery media={props.media} className="grid grid-cols-2 gap-4" /></Section>',
      "",
    ),
    { hasMedia: true },
  ).ok,
  false,
  "beforeAfter is required when photos exist",
);

const sectionOrderMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/section-order.ts")).href
);
const {
  SECTION_REGISTRY,
  headerNavItems,
  REQUIRED_SECTION_TYPES,
  CATALOG_SECTION_CATEGORIES: catsFromRegistry,
} = sectionOrderMod;
assert.deepEqual([...REQUIRED_SECTION_TYPES], ["hero", "services", "contact", "footer"]);
assert.ok(
  SECTION_REGISTRY.some((entry) => entry.id === "warranty" && entry.kind === "evidenceGated"),
);
assert.ok(SECTION_REGISTRY.some((entry) => entry.id === "hours" && entry.kind === "evidenceGated"));
for (const entry of SECTION_REGISTRY) {
  if (entry.catalogCategory) {
    assert.equal(catsFromRegistry[entry.id], entry.catalogCategory);
  }
}
assert.deepEqual(
  headerNavItems(["services", "beforeAfter", "reviews", "warranty", "hours", "contact"], {
    contactHidden: false,
  }).map((item) => item.href),
  ["#services", "#beforeAfter", "#reviews", "#warranty", "#hours", "#contact"],
);
assert.deepEqual(
  headerNavItems(["services", "contact"], { contactHidden: true }).map((item) => item.href),
  ["#services"],
);
const sectionOrderSrc = fs.readFileSync(
  path.join(here, "../src/lib/agent/section-order.ts"),
  "utf8",
);
assert.match(kitSrc, /headerNavItems/);
assert.match(kitSrc, /if \(type === "beforeAfter"\) return showWork/);
assert.match(sectionOrderSrc, /catalogCategory: CATALOG_SECTION_CATEGORIES\.hero/);
assert.match(bootstrapSrc, /sections: payload\.props\.sections/);
assert.match(bootstrapSrc, /warranty: payload\.props\.warranty/);
assert.match(bootstrapSrc, /services: payload\.props\.services/);
assert.match(generatorSrc, /Omit empty evidence bands/);
assert.equal(/with these exact ids: hero, trustmarkers/.test(generatorSrc), false);

const factSheetMod = await import(
  pathToFileURL(path.join(here, "../src/lib/site-fact-sheet.ts")).href
);
const { parseReadableWeeklyHours, parseServiceItems } = factSheetMod;
assert.equal(parseReadableWeeklyHours("Closed• 7:00 am - 6:00 pm"), null);
assert.equal(parseReadableWeeklyHours("7:00 am - 6:00 pm"), null);
assert.ok(parseReadableWeeklyHours("Monday: 9:00 AM – 5:00 PM"));
assert.ok(parseReadableWeeklyHours("Mon-Fri 8am-5pm"));
assert.equal(parseReadableWeeklyHours(""), null);

const mashedHoursSheet = factSheetMod.buildFactSheet(
  {
    businessName: "Acme Painting",
    licenseNumber: "123",
    trade: "C-33",
    city: "Oakland",
    services: ["Residential"],
    theme: "light",
    lookAndFeel: "professional",
    primaryColor: "#1e3a5f",
  },
  {
    platforms: {
      google: {
        results: [
          {
            json: {
              business_name: "Acme Painting",
              hours: "Closed• 7:00 am - 6:00 pm",
              services: ["Interior painting", "Exterior painting"],
            },
          },
        ],
      },
    },
  },
);
assert.equal(mashedHoursSheet.hours, null);
assert.deepEqual(parseServiceItems(mashedHoursSheet.servicesOffered), [
  "Interior painting",
  "Exterior painting",
]);

const projectMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/project-enrichment.server.ts")).href
);
const projected = projectMod.projectEnrichmentToSiteConfig(
  {
    businessName: "Acme Painting",
    licenseNumber: "123",
    trade: "C-33",
    city: "Oakland",
    services: [],
    sections: [
      { id: "hero", type: "hero", heading: "Acme", body: "Painting" },
      {
        id: "services",
        type: "services",
        heading: "Services",
        body: "Interior painting • Exterior painting",
      },
      { id: "contact", type: "contact", heading: "Contact", body: "Call" },
      { id: "footer", type: "footer", heading: "Acme", body: "Oakland" },
    ],
  },
  {
    platforms: {
      google: {
        results: [
          {
            json: {
              business_name: "Acme Painting",
              hours: "Closed• 7:00 am - 6:00 pm",
              services: ["Interior painting", "Exterior painting"],
            },
          },
        ],
      },
    },
  },
);
assert.equal(
  projected.sections.some((section) => section.type === "hours"),
  false,
  "mashed Closed + times is not hours evidence",
);
assert.deepEqual(projected.services, ["Interior painting", "Exterior painting"]);
assert.equal(
  projected.sections
    .find((section) => section.type === "services")
    ?.body.includes("Interior painting •"),
  true,
);

assert.equal(
  instantiateThemeModule(NAMED_THEME, themeRuntime).ok,
  true,
  "NamedLayout shell compiles in the iframe preamble",
);
assert.match(themeModulePreamble("catalog"), /NamedLayout, firstStill/);
assert.equal(/NamedLayout/.test(themeModulePreamble("unified")), false);
assert.equal("NamedLayout" in pickSiteKit(STUB_KIT, "unified"), false);
assert.equal("MediaGallery" in pickSiteKit(STUB_KIT, "unified"), false);
assert.equal("Grid" in pickSiteKit(STUB_KIT, "unified"), false);
assert.equal("Section" in pickSiteKit(STUB_KIT, "unified"), false);
assert.equal("firstStill" in pickSiteKit(STUB_KIT, "unified"), false);
assert.equal("LeadSlot" in pickSiteKit(STUB_KIT, "unified"), true);
assert.equal("NamedLayout" in pickSiteKit(STUB_KIT, "catalog"), true);
assert.equal("Grid" in pickSiteKit(STUB_KIT, "catalog"), true);
assert.deepEqual(classifySiteRenderMode({}), { kind: "standard" });
assert.deepEqual(classifySiteRenderMode({ themeSource: VALID_THEME }), {
  kind: "generated",
  scope: "catalog",
});
assert.deepEqual(
  classifySiteRenderMode({
    generator: "unified-site-agent",
    themeSource: "export default function Site(){ return null; }",
  }),
  { kind: "generated", scope: "unified" },
);
assert.deepEqual(classifySiteRenderMode({ generator: "unified-site-agent" }), {
  kind: "unavailable",
  reason: "incomplete-unified",
});
assert.deepEqual(classifySiteRenderMode({ generator: "future-agent", themeSource: VALID_THEME }), {
  kind: "unavailable",
  reason: "unsupported-generator",
});
assert.match(unavailableSiteMessage("legacy-unified"), /Regenerate/);
assert.equal(
  UNIFIED_KIT_NAMES.some((name) => CATALOG_ONLY_KIT_NAMES.includes(name)),
  false,
  "host seams and two-step tags must not overlap",
);
assert.deepEqual(
  [...CATALOG_KIT_NAMES].toSorted(),
  [...new Set([...UNIFIED_KIT_NAMES, ...CATALOG_ONLY_KIT_NAMES, "firstStill"])].toSorted(),
  "catalog iframe is host seams plus two-step tags",
);
assert.equal(CATALOG_KIT_NAMES.at(-1), "firstStill");
assert.match(themeModulePreamble("unified"), /LeadSlot, Button, Media/);
assert.equal(/Grid|Section|firstStill/.test(themeModulePreamble("unified")), false);
const droppedInUnified = `export default function Site() {
  return <NamedLayout section="hero" />;
}
`;
const unifiedDroppedInst = instantiateThemeModule(droppedInUnified, themeRuntime, "unified");
assert.equal(
  unifiedDroppedInst.ok,
  true,
  "unbound catalog tags fail when Site runs, not at factory",
);
assert.throws(
  () => {
    if (!unifiedDroppedInst.ok) return;
    unifiedDroppedInst.Site();
  },
  /NamedLayout|undefined/,
  "unified preview must not bind NamedLayout",
);
const catalogDroppedInst = instantiateThemeModule(droppedInUnified, themeRuntime, "catalog");
assert.equal(catalogDroppedInst.ok, true);
if (catalogDroppedInst.ok) catalogDroppedInst.Site();
assert.deepEqual([...UNIFIED_KIT_NAMES], ["LeadSlot", "Button", "Media"]);
assert.deepEqual(
  classifySiteRenderMode({ generator: "unified-site-agent", themeSource: droppedInUnified }),
  { kind: "generated", scope: "catalog" },
);
assert.deepEqual(
  classifySiteRenderMode({
    generator: "unified-site-agent",
    themeSource: 'export default function Site(){ return <SiteKit.NamedLayout section="hero" />; }',
  }),
  { kind: "generated", scope: "catalog" },
);
assert.deepEqual(
  classifySiteRenderMode({
    generator: "unified-site-agent",
    themeSource:
      "// avoid <Card> and firstStill( in generated output\nexport default function Site(){ return <div>ok</div>; }",
  }),
  { kind: "generated", scope: "unified" },
);
assert.equal(isStructurallyValidTheme(NAMED_THEME), true);

const UNIFIED_FREEHAND = `export default function Site(props: SiteProps) {
  return (
    <div>
      <h1 className="text-5xl">{props.businessName}</h1>
      <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />
    </div>
  );
}
`;
const unifiedOk = compileThemeSource(UNIFIED_FREEHAND, { unifiedLoose: true });
assert.equal(unifiedOk.ok, true, unifiedOk.ok ? "" : unifiedOk.error);
assert.equal(
  compileThemeSource(`${UNIFIED_FREEHAND}\nfetch("/x")`, { unifiedLoose: true }).ok,
  false,
  "unified loose still rejects fetch",
);
const namedOnUnified = compileThemeSource(
  UNIFIED_FREEHAND.replace("<h1", '<NamedLayout section="hero" /><h1'),
  { unifiedLoose: true },
);
assert.equal(namedOnUnified.ok, false, "unified loose rejects NamedLayout");
assert.equal(
  /NamedLayout|\bcatalog\b/i.test(namedOnUnified.error ?? ""),
  false,
  "unified compile reject must not teach catalog names",
);
assert.match(namedOnUnified.error ?? "", /HTML and Tailwind/);
for (const tag of CATALOG_ONLY_KIT_NAMES) {
  const rejected = compileThemeSource(UNIFIED_FREEHAND.replace("<h1", `<${tag} /><h1`), {
    unifiedLoose: true,
  });
  assert.equal(rejected.ok, false, `unified loose rejects ${tag}`);
  assert.equal(
    /NamedLayout|\bcatalog\b|MediaGallery|QuoteCta|TrustMarkerList|\bGrid\b|\bCard\b|\bSection\b|\bHeading\b/i.test(
      rejected.error ?? "",
    ),
    false,
    `unified reject for ${tag} must not teach two-step kit names`,
  );
}
assert.equal(
  instantiateThemeModule(UNIFIED_FREEHAND, themeRuntime, "unified").ok,
  true,
  "unified scope binds host seams",
);
const gridInUnified = `export default function Site() {
  return <Grid className="grid-cols-3" />;
}
`;
const gridInst = instantiateThemeModule(gridInUnified, themeRuntime, "unified");
assert.equal(gridInst.ok, true);
assert.throws(
  () => {
    if (!gridInst.ok) return;
    gridInst.Site();
  },
  /Grid|undefined/,
  "unified preview must not bind Grid",
);
assert.equal(
  compileThemeSource(UNIFIED_FREEHAND.replace(/\bLeadSlot\b[\s\S]*?\/>/, "<p>no form</p>"), {
    unifiedLoose: true,
  }).ok,
  false,
  "unified loose still requires LeadSlot when contact is shown",
);
const firstStillOnUnified = compileThemeSource(
  UNIFIED_FREEHAND.replace("return (", "const still = firstStill(props.media);\n  return ("),
  { unifiedLoose: true },
);
assert.equal(firstStillOnUnified.ok, false, "unified loose rejects firstStill()");
assert.equal(
  /firstStill/.test(firstStillOnUnified.error ?? ""),
  false,
  "unified reject must not teach firstStill",
);

const firecrawlMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/unified-site-agent-inputs.ts")).href
);
assert.equal(
  fs
    .readFileSync(path.join(here, "../src/lib/agent/unified-site-agent-inputs.ts"), "utf8")
    .includes("ReviewSourceBadge"),
  false,
  "unified user prompt must not advertise kit tags the iframe preamble does not inject",
);
const longMarkdown = "x".repeat(4000);
const truncated = firecrawlMod.formatFirecrawlForAgent({
  platforms: { google: { markdown: longMarkdown, extract: { phone: "555" } } },
});
const parsedDump = JSON.parse(truncated);
assert.equal(parsedDump.google.extract.phone, "555");
assert.equal(parsedDump.google.markdown.length <= firecrawlMod.FIRECRAWL_MARKDOWN_CAP + 1, true);

const flagMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/unified-site-agent.ts")).href
);
assert.equal(flagMod.parseUnifiedSiteAgentEnv(undefined), null);
assert.equal(flagMod.parseUnifiedSiteAgentEnv("true"), true);
assert.equal(flagMod.parseUnifiedSiteAgentEnv("false"), false);
assert.equal(flagMod.UNIFIED_SITE_AGENT_DEFAULT, false);

const promptMod = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/unified-site-agent.prompt.ts")).href
);
assert.match(promptMod.UNIFIED_SITE_AGENT_SYSTEM_PROMPT, /fact ssheet/);
assert.match(promptMod.UNIFIED_SITE_AGENT_SYSTEM_PROMPT, /DESIGN REASONING/);
assert.match(
  promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT,
  /creativeBrief is non-authoritative guidance/,
);
assert.match(
  promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT,
  /writer owns section order, shape, rhythm, media placement/,
);
assert.equal(
  /NamedLayout|\bcatalog\b/i.test(promptMod.UNIFIED_SITE_AGENT_SYSTEM_PROMPT),
  false,
  "unified system prompt must not mention catalog layouts",
);
assert.equal(
  /MediaGallery|QuoteCta|TrustMarkerList|`Hero`|`Header`|`Nav`|`Grid`|`Card`|`Section`|`Heading`|`Quote`|`TopBar`|SiteKit components/.test(
    promptMod.UNIFIED_SITE_AGENT_SYSTEM_PROMPT,
  ),
  false,
  "unified system prompt must not name two-step kit tags",
);
assert.equal(
  /canonical ids|Include these section ids/i.test(promptMod.UNIFIED_SITE_AGENT_SYSTEM_PROMPT),
  false,
  "unified system prompt must not prescribe the two-step section spine",
);
assert.match(promptMod.UNIFIED_SITE_AGENT_SYSTEM_PROMPT, /Host bindings only/);
assert.equal(
  /NamedLayout|\bcatalog\b|beforeAfter/i.test(promptMod.UNIFIED_SITE_AGENT_PLAN_PROMPT),
  false,
  "unified plan prompt must not mention catalog layouts or LP section ids",
);

const unifiedInputsSrc = fs.readFileSync(
  path.join(here, "../src/lib/agent/unified-site-agent-inputs.ts"),
  "utf8",
);
assert.equal(
  /NamedLayout|\bcatalog\b/i.test(unifiedInputsSrc),
  false,
  "unified user/plan inputs must not mention catalog layouts",
);
assert.equal(
  /MediaGallery|QuoteCta|TrustMarkerList|unifiedKitNamesText/.test(unifiedInputsSrc),
  false,
  "unified user/plan inputs must not name two-step kit tags",
);
assert.match(unifiedInputsSrc, /Locked look/);
assert.doesNotMatch(unifiedInputsSrc, /Validated operational intent/);
assert.match(unifiedInputsSrc, /Host bindings/);
assert.equal(/SiteKit in scope|Include these section ids/.test(unifiedInputsSrc), false);
assert.match(generatorSrc, /unifiedPriorNote/);
assert.equal(firecrawlMod.unifiedPriorNote(), "This is the first variant for this site.");
assert.equal(
  firecrawlMod.unifiedPriorNote(
    "designIntent serif/lg; variant v1, hero split, layout hyperui/hero/split-media-right, catalog hyperui/hero/split-media-right",
  ),
  "A prior version exists. Treat similarity as advisory only; choose the composition that best serves the accepted brief and do not copy source code.",
);
assert.equal(
  firecrawlMod.unifiedPriorNote("designIntent navy; layout hero-split-media, services-cards"),
  "A prior version exists. Treat similarity as advisory only; choose the composition that best serves the accepted brief and do not copy source code.",
);
assert.match(
  generatorSrc,
  /projectedBase\.sections = \[\];/,
  "unified persist must not keep the two-step LP section spine",
);
assert.match(
  generatorSrc,
  /projectedBase\.sectionOrder = \[\];/,
  "unified persist must not keep catalog sectionOrder",
);
const hostSrc = fs.readFileSync(
  path.join(here, "../src/components/site-renderer/GeneratedSiteHost.tsx"),
  "utf8",
);
assert.match(
  hostSrc,
  /isUnified \? \[\] : Array\.isArray\(config\.sections\)/,
  "unified workspace must not overlay catalog section pencils",
);
assert.match(
  fs.readFileSync(
    path.join(here, "../src/components/site-renderer/ContractorSiteView.tsx"),
    "utf8",
  ),
  /classifySiteRenderMode/,
);
assert.match(hostSrc, /kitScope/);
assert.equal(/config\.generator/.test(hostSrc), false);
assert.match(bootstrapSrc, /payload\.kitScope/);
assert.match(bootstrapSrc, /site-runtime-healthy/);
const indirectRawMedia = compileThemeSource(
  `export default function Site() { return React.createElement.call(null, "img", { src: "https://evil.test/a.jpg" }); }`,
  { unifiedLoose: true },
);
assert.equal(indirectRawMedia.ok, false, "indirect raw media creation must be rejected");
const shadowedMedia = compileThemeSource(
  `export default function Site() { function Media() { return null; } return React.createElement(Media, { slotId: "hero" }); }`,
  { unifiedLoose: true },
);
assert.equal(shadowedMedia.ok, false, "nested injected Media shadowing must be rejected");
assert.match(bootstrapSrc, /__SITE_RUNTIME_TOKEN = payload.token/);
assert.match(bootstrapSrc, /delete .*__SITE_RUNTIME_TOKEN/);
assert.match(hostSrc, /event\.source !== iframeRef\.current\?\.contentWindow/);
assert.equal(/site-runtime-geometry[^}]*setRuntimeFailed\(false\)/s.test(hostSrc), false);
assert.equal(/themeKitScopeFromGenerator/.test(bootstrapSrc), false);

console.log("verify-site-theme: ok");
