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
const load = (relative) => import(pathToFileURL(path.join(here, relative)).href);
const manifestMod = await load("../src/lib/site-theme/media-manifest.ts");
const compileMod = await load("../src/lib/site-theme/compile-theme-source.ts");
const evidenceMod = await load("../src/lib/site-evidence.ts");
const propsMod = await load("../src/lib/site-theme/config-to-props.ts");
const renderModeMod = await load("../src/lib/site-theme/render-mode.ts");
const mediaServerMod = await load("../src/lib/media/site-media.server.ts");
const mediaPathMod = await load("../src/lib/media/persist-scraped-media.server.ts");
const generatedPathMod = await load("../src/lib/media/generated-media-path.ts");
const { resolveUnifiedMediaManifest } = await load("../src/lib/agent/unified-media-manifest.ts");

const manifest = {
  slots: [
    {
      slotId: "hero",
      assetId: "still-1",
      origin: "generated",
      role: "hero",
      proofEligible: false,
      mimeType: "image/jpeg",
      alt: "Crew at work",
      storagePath: "site/generated/hero.jpg",
      required: true,
    },
    {
      slotId: "support",
      assetId: "still-2",
      origin: "generated",
      role: "support",
      proofEligible: false,
      mimeType: "image/jpeg",
      alt: "Workshop detail",
      storagePath: "site/generated/support.jpg",
      required: true,
    },
    {
      slotId: "motion",
      assetId: "video-1",
      origin: "generated",
      role: "atmosphere",
      proofEligible: false,
      mimeType: "video/mp4",
      alt: "Crew in motion",
      storagePath: "site/generated/motion.mp4",
      sourceSlotId: "hero",
      posterSlotId: "hero",
      required: true,
    },
  ],
};
assert.equal(manifestMod.parseV2Manifest(manifest).ok, true);
assert.equal(manifestMod.parseV3Manifest({ slots: manifest.slots.slice(0, 2) }).ok, true);
assert.equal(manifestMod.parseV2Manifest({ slots: manifest.slots.slice(0, 2) }).ok, false);
assert.equal(manifestMod.parseV3Manifest(manifest).ok, false);
const v3MotionManifest = {
  slots: manifest.slots.map((slot, index) =>
    index === 2
      ? {
          ...slot,
          targetSection: "hero",
          placement: "inline",
          motionPreset: "slow-push",
        }
      : slot,
  ),
};
assert.equal(manifestMod.parseV3Manifest(v3MotionManifest).ok, true);

const evidenceOnlySlot = {
  slotId: "project-proof",
  assetId: "evidence-still-1",
  origin: "evidence",
  role: "proof",
  proofEligible: true,
  mimeType: "image/jpeg",
  alt: "Completed project",
  storagePath: "site/evidence/project.jpg",
};
assert.deepEqual(manifestMod.parseV4Manifest({ slots: [] }), {
  ok: true,
  manifest: { slots: [] },
});
assert.equal(manifestMod.parseV4Manifest({ slots: [evidenceOnlySlot] }).ok, true);
assert.equal(manifestMod.parseV3Manifest({ slots: [] }).ok, false);
assert.equal(manifestMod.parseV3Manifest({ slots: [evidenceOnlySlot] }).ok, false);
assert.equal(
  manifestMod.parseV4Manifest({
    slots: [evidenceOnlySlot, { ...evidenceOnlySlot, slotId: "project-proof-two" }],
  }).ok,
  false,
  "v4 must preserve unique still asset identity",
);
assert.equal(
  manifestMod.parseV4Manifest({
    slots: [{ ...evidenceOnlySlot, slotId: "project-proof" }, { ...evidenceOnlySlot }],
  }).ok,
  false,
  "v4 must preserve unique slot identity",
);
assert.equal(
  manifestMod.parseV4Manifest({
    slots: [
      evidenceOnlySlot,
      { ...evidenceOnlySlot, slotId: " project-proof ", assetId: "evidence-still-2" },
    ],
  }).ok,
  false,
  "v4 must preserve normalized unique slot identity",
);
assert.equal(
  manifestMod.parseV4Manifest({
    slots: [{ ...evidenceOnlySlot, origin: "generated", role: "proof", proofEligible: false }],
  }).ok,
  false,
  "v4 proof media must remain proof-eligible evidence",
);
assert.equal(
  manifestMod.parseV4Manifest({ slots: [{ ...evidenceOnlySlot, mimeType: "image/gif" }] }).ok,
  false,
  "v4 still MIME safety remains enforced",
);
assert.equal(
  manifestMod.parseV4Manifest({ slots: [{ ...evidenceOnlySlot, storagePath: undefined }] }).ok,
  false,
  "v4 slots still require a storage path or URL",
);
assert.equal(manifestMod.parseV4Manifest(v3MotionManifest).ok, true);
assert.equal(
  manifestMod.parseV4Manifest({
    slots: v3MotionManifest.slots.map((slot, index) =>
      index === 2 ? { ...slot, sourceSlotId: "missing" } : slot,
    ),
  }).ok,
  false,
  "v4 video source/poster integrity remains enforced",
);
assert.equal(manifestMod.parseMediaManifest(4, { slots: [] }).ok, true);
assert.equal(manifestMod.parseMediaManifest(5, manifest).ok, false);

assert.equal(
  manifestMod.parseResolvedMediaManifest({
    slots: manifest.slots.map((slot, index) =>
      index === 2 ? { ...slot, mimeType: "video/webm" } : slot,
    ),
  }).ok,
  false,
);
assert.equal(
  manifestMod.parseResolvedMediaManifest({
    slots: manifest.slots.map((slot, index) =>
      index === 2 ? { ...slot, origin: "evidence" } : slot,
    ),
  }).ok,
  false,
);
assert.equal(
  manifestMod.parseResolvedMediaManifest({
    slots: manifest.slots.map((slot, index) =>
      index === 0 ? { ...slot, mimeType: "image/gif" } : slot,
    ),
  }).ok,
  false,
);

assert.equal(
  manifestMod.parseResolvedMediaManifest({ slots: [{ ...manifest.slots[0], role: "proof" }] }).ok,
  false,
);
assert.equal(
  manifestMod.parseResolvedMediaManifest({
    slots: [...manifest.slots, { ...manifest.slots[2], slotId: "motion-two", assetId: "video-2" }],
  }).ok,
  false,
);
assert.equal(
  manifestMod.parseResolvedMediaManifest({
    slots: [
      manifest.slots[0],
      { ...manifest.slots[1], slotId: "poster", role: "motion-poster" },
      { ...manifest.slots[2], sourceSlotId: "hero", posterSlotId: "poster" },
    ],
  }).ok,
  false,
);
assert.equal(evidenceMod.isVideoMediaItem({ mimeType: "image/gif", url: "x.gif" }), false);
assert.equal(evidenceMod.isVideoMediaItem({ mimeType: "video/mp4", url: "x.mp4" }), true);

const source =
  'export default function Site(props: SiteProps) { return <div><Media slotId="hero" /><Media slotId="support" /><Media slotId={"motion"} /><LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} /></div>; }';
const opts = {
  unifiedLoose: true,
  generatorSchemaVersion: manifestMod.LEGACY_GENERATOR_SCHEMA_VERSION,
  mediaManifest: manifest,
};
assert.equal(compileMod.compileThemeSource(source, opts).ok, true);
assert.equal(
  compileMod.compileThemeSource(
    source.replace('<Media slotId="hero" />', '<img src="https://evil.test/x.jpg" />'),
    opts,
  ).ok,
  false,
);
assert.match(
  compileMod.compileThemeSource(source.replace('slotId="hero"', "slotId={props.slot}"), opts).error,
  /literal slotId/,
);
assert.match(
  compileMod.compileThemeSource(source.replace('slotId="hero"', 'slotId="missing"'), opts).error,
  /unknown media slot/,
);
assert.match(
  compileMod.compileThemeSource(source.replace('<Media slotId="hero" />', ""), opts).error,
  /required media slot hero/,
);
assert.equal(
  compileMod.compileThemeSource(
    "export default function Site(props: SiteProps) { return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }",
    { unifiedLoose: true },
  ).ok,
  true,
);

const config = {
  generator: "unified-site-agent",
  generatorSchemaVersion: manifestMod.LEGACY_GENERATOR_SCHEMA_VERSION,
  themeSource: source,
  mediaManifest: manifest,
};
assert.equal(renderModeMod.classifySiteRenderMode(config).kind, "generated");
const v3Config = {
  ...config,
  generatorSchemaVersion: 3,
  themeSource: source.replace('<Media slotId={"motion"} />', ""),
  mediaManifest: { slots: manifest.slots.slice(0, 2) },
};
const v4EmptyConfig = {
  generator: "unified-site-agent",
  generatorSchemaVersion: manifestMod.CURRENT_GENERATOR_SCHEMA_VERSION,
  themeSource:
    "export default function Site(props: SiteProps) { return <LeadSlot fields={props.leadFields} canSubmitLead={props.canSubmitLead} />; }",
  mediaManifest: { slots: [] },
};
assert.equal(renderModeMod.classifySiteRenderMode(v3Config).kind, "generated");
assert.equal(renderModeMod.classifySiteRenderMode(v4EmptyConfig).kind, "generated");
assert.equal(manifestMod.mediaManifestFromConfig(config).version, 2);
assert.equal(manifestMod.mediaManifestFromConfig(v3Config).version, 3);
assert.deepEqual(manifestMod.mediaManifestFromConfig(v4EmptyConfig), {
  kind: "current",
  version: 4,
  manifest: { slots: [] },
});
assert.equal(
  renderModeMod.classifySiteRenderMode({ ...config, generatorSchemaVersion: 999 }).kind,
  "unavailable",
);
assert.equal(
  renderModeMod.classifySiteRenderMode({ generator: "unified-site-agent", themeSource: source })
    .kind,
  "generated",
);
const props = propsMod.configToSiteProps(config, { enableMotion: true, canSubmitLead: false });
assert.equal(props.mediaSlots.hero.assetId, "still-1");
assert.deepEqual(
  propsMod.configToSiteProps({ mediaGallery: [] }, { enableMotion: true, canSubmitLead: false })
    .mediaSlots,
  {},
);

const signedPaths = [];
const supabase = {
  storage: {
    from(bucket) {
      assert.equal(bucket, "site-media");
      return {
        async createSignedUrl(storagePath) {
          signedPaths.push(storagePath);
          return { data: { signedUrl: "signed:" + storagePath }, error: null };
        },
      };
    },
  },
};
const hydrated = await mediaServerMod.resolveSiteMediaInConfig(supabase, config);
assert.deepEqual(signedPaths, [
  "site/generated/hero.jpg",
  "site/generated/support.jpg",
  "site/generated/motion.mp4",
]);
assert.equal(hydrated.mediaManifest.slots[0].url, "signed:site/generated/hero.jpg");
assert.equal(config.mediaManifest.slots[0].url, undefined);

const productionWebsiteId = "cbad3bb2-8d53-4029-9e51-97c5eb253d4e";
const legacyGeneratedPath = `${productionWebsiteId}/generated/42d3ec6607e9a071.png`;
const canonicalGeneratedPath = `${productionWebsiteId}/generated/42d3ec6607e9a071e91785cb96d92fac20a3a4052d66d734d720f080fb4c9d10.png`;
assert.equal(mediaPathMod.siteMediaPathKind(productionWebsiteId, legacyGeneratedPath), "generated");
assert.equal(
  mediaPathMod.siteMediaPathKind(productionWebsiteId, canonicalGeneratedPath),
  "generated",
);
assert.equal(
  mediaPathMod.siteMediaPathKind(
    productionWebsiteId,
    `${productionWebsiteId}/generated/42d3ec6607e9a07.png`,
  ),
  null,
);
assert.equal(mediaPathMod.siteMediaPathKind("other-website", legacyGeneratedPath), null);
assert.equal(
  generatedPathMod.isOwnedChatAttachmentPath(
    productionWebsiteId,
    `${productionWebsiteId}/1720000000000-deadbeef.png`,
  ),
  true,
);
assert.equal(
  generatedPathMod.isOwnedChatAttachmentPath(
    productionWebsiteId,
    `${productionWebsiteId}-other/1720000000000-deadbeef.png`,
  ),
  false,
);
assert.equal(
  generatedPathMod.isOwnedChatAttachmentPath(
    productionWebsiteId,
    `${productionWebsiteId}/../1720000000000-deadbeef.png`,
  ),
  false,
);
for (const invalidPath of [
  `${productionWebsiteId}/generated/${"a".repeat(17)}.png`,
  `${productionWebsiteId}/generated/${"a".repeat(63)}.png`,
  `${productionWebsiteId}/generated/${"a".repeat(65)}.png`,
  `${productionWebsiteId}/generated/${"A".repeat(16)}.png`,
  `${productionWebsiteId}/generated/${"a".repeat(16)}%2Fescape.png`,
  `${productionWebsiteId}/generated/../${"a".repeat(16)}.png`,
  `${productionWebsiteId}//generated/${"a".repeat(16)}.png`,
  `${productionWebsiteId}\\generated\\${"a".repeat(16)}.png`,
]) {
  assert.equal(mediaPathMod.siteMediaPathKind(productionWebsiteId, invalidPath), null);
}
const productionSignedPaths = [];
const productionSupabase = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              async maybeSingle() {
                return { data: null, error: null };
              },
            };
          },
        };
      },
    };
  },
  storage: {
    from() {
      return {
        async createSignedUrl(storagePath) {
          productionSignedPaths.push(storagePath);
          return { data: { signedUrl: "signed:" + storagePath }, error: null };
        },
      };
    },
  },
};
const legacyHydrated = await mediaServerMod.resolveSiteMediaInConfig(
  productionSupabase,
  {
    generatorSchemaVersion: 3,
    mediaManifest: {
      slots: [
        {
          slotId: "hero-architectural-atmosphere",
          assetId: "42d3ec6607e9a071e91785cb96d92fac20a3a4052d66d734d720f080fb4c9d10",
          origin: "generated",
          role: "hero",
          proofEligible: false,
          mimeType: "image/png",
          alt: "Brand atmosphere",
          storagePath: legacyGeneratedPath,
          required: true,
        },
        {
          slotId: "services-material-study",
          assetId: "300023d8b1fb4664835ba54fce2c334a4eb3183887a32d06567563c15e4748e3",
          origin: "generated",
          role: "support",
          proofEligible: false,
          mimeType: "image/png",
          alt: "Material study",
          storagePath: canonicalGeneratedPath,
          required: true,
        },
      ],
    },
  },
  { websiteId: productionWebsiteId },
);
assert.deepEqual(productionSignedPaths, [legacyGeneratedPath, canonicalGeneratedPath]);
assert.equal(legacyHydrated.mediaManifest.slots[0].url, "signed:" + legacyGeneratedPath);
assert.equal(legacyHydrated.mediaManifest.slots[1].url, "signed:" + canonicalGeneratedPath);

const unifiedManifestSource = fs.readFileSync(
  path.join(here, "../src/lib/agent/unified-media-manifest.ts"),
  "utf8",
);
assert.doesNotMatch(unifiedManifestSource, /brand-motion|videoSourceSlotId/);
const unifiedGeneratorSource = fs.readFileSync(
  path.join(here, "../src/lib/agent/website-generator.server.ts"),
  "utf8",
);
assert.doesNotMatch(unifiedGeneratorSource, /id: "brand-motion"|generatedMotionCount/);
assert.match(unifiedGeneratorSource, /requireVideoSource: false/);

const kitSource = fs.readFileSync(path.join(here, "../src/components/site-kit/index.tsx"), "utf8");
assert.match(kitSource, /poster=\{posterUrl\}/);
assert.match(kitSource, /data-site-media-fallback/);
assert.doesNotMatch(kitSource, /mime === "image\/gif"\) return true/);

assert.throws(
  () =>
    resolveUnifiedMediaManifest({
      brief: {
        mediaSlots: [
          {
            slotId: "hero",
            role: "hero",
            sourcePreference: "evidence",
            required: true,
            aspectRatio: "16:9",
            cropGuidance: "center",
          },
          {
            slotId: "support",
            role: "support",
            sourcePreference: "evidence",
            required: false,
            aspectRatio: "4:3",
            cropGuidance: "center",
          },
        ],
      },
      evidence: [
        {
          url: "signed",
          storagePath: "web/direct.jpg",
          contentHash: "direct",
          mimeType: "image/jpeg",
          width: 800,
          height: 600,
          proofEligible: true,
          provenance: {
            kind: "evidence",
            sourceUrl: "web/direct.jpg",
            storageBucket: "site-media",
          },
        },
        {
          url: "signed2",
          storagePath: "web/other.jpg",
          contentHash: "other",
          mimeType: "image/jpeg",
          width: 800,
          height: 600,
          proofEligible: true,
          provenance: { kind: "evidence", sourceUrl: "web/other.jpg", storageBucket: "site-media" },
        },
      ],
      generated: [],
      effectiveSourceBySlot: new Map([
        ["hero", "evidence"],
        ["support", "evidence"],
      ]),
      evidenceAssetIdBySlot: new Map([
        ["hero", "missing"],
        ["support", "other"],
      ]),
    }),
  /Required unique media slot hero could not be resolved/,
  "resolver never substitutes another evidence asset for an exact checkpoint identity",
);

console.log("verify-media-manifest: ok");
