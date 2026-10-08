import assert from "node:assert/strict";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await fs.mkdtemp(path.join(root, ".verify-publish-manifest-"));
const out = path.join(temporary, "publish.mjs");

try {
  await build({
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    alias: { "@": path.join(root, "src") },
    entryPoints: [path.join(root, "src/lib/agent/publish.server.ts")],
    outfile: out,
  });
  const { publishWebsiteVersion } = await import(pathToFileURL(out));
  const { canonicalUnifiedDivergenceTuple } = await import(
    pathToFileURL(path.join(root, "src/lib/agent/unified-design-brief.ts"))
  );

  function supabaseFor({ config, attachments = [], revision = 7 }) {
    const calls = { attachmentReads: 0, published: [] };
    return {
      calls,
      from(table) {
        if (table === "website_versions") {
          const query = {
            select() {
              return query;
            },
            eq() {
              return query;
            },
            async single() {
              return {
                data: {
                  id: "version-1",
                  website_id: "website-1",
                  status: "draft",
                  config_json: config,
                  revision,
                },
                error: null,
              };
            },
          };
          return query;
        }
        if (table === "website_version_media_slots") {
          const query = {
            select() {
              calls.attachmentReads += 1;
              return query;
            },
            eq() {
              return query;
            },
            then(resolve) {
              return Promise.resolve({ data: attachments, error: null }).then(resolve);
            },
          };
          return query;
        }
        throw new Error("unexpected table " + table);
      },
      storage: {
        from(bucket) {
          assert.equal(bucket, "site-media");
          return {
            async createSignedUrl(storagePath) {
              return { data: { signedUrl: "signed:" + storagePath }, error: null };
            },
          };
        },
      },
      async rpc(name, args) {
        calls.published.push({ name, args });
        return { data: 8, error: null };
      },
    };
  }

  const emptyPlan = {
    planSchemaVersion: 3,
    operationalIntent: { mediaSlots: [], operationalAnchors: [] },
    creativeBrief: {
      rationale: "Clear service presentation",
      mood: "Confident and practical",
      hierarchy: "Lead with identity and services",
      mediaOpportunities: "No media required",
      responsiveBehavior: "Stack content on narrow screens",
    },
  };
  const emptyV4 = {
    generator: "unified-site-agent",
    generatorSchemaVersion: 4,
    contactHidden: true,
    themeSource: "export default function Site(){ return <main />; }",
    mediaManifest: { slots: [] },
    unifiedPlan: emptyPlan,
  };
  const emptyDb = supabaseFor({ config: emptyV4 });
  await publishWebsiteVersion(emptyDb, "website-1", "version-1", 7);
  assert.equal(emptyDb.calls.attachmentReads, 1, "v4 empty manifests still verify attachments");
  assert.equal(emptyDb.calls.published.length, 1);
  assert.deepEqual(emptyDb.calls.published[0].args.p_expected_media_slots, []);
  assert.equal(emptyDb.calls.published[0].args.p_validation_attestation, null);
  assert.equal("recipeId" in emptyV4, false);
  assert.equal("divergenceTuple" in emptyV4, false);

  const gachaV4 = {
    generator: "unified-site-agent",
    generatorSchemaVersion: 4,
    contactHidden: true,
    themeSource: "export default function Site(){ return <main />; }",
    mediaManifest: { slots: [] },
    gacha: { id: "editorial-billboard-balanced", version: 1 },
  };
  const gachaDb = supabaseFor({ config: gachaV4 });
  await publishWebsiteVersion(gachaDb, "website-1", "version-1", 7);
  assert.equal(gachaDb.calls.published.length, 1);
  assert.equal("unifiedPlan" in gachaV4, false);

  const strayAttachmentDb = supabaseFor({
    config: emptyV4,
    attachments: [{ slot_id: "stray" }],
  });
  await assert.rejects(
    () => publishWebsiteVersion(strayAttachmentDb, "website-1", "version-1", 7),
    /stale or missing media attachments/,
  );
  assert.equal(strayAttachmentDb.calls.published.length, 0);

  const evidenceSlot = {
    slotId: "project-proof",
    assetId: "evidence-1",
    origin: "evidence",
    role: "proof",
    proofEligible: true,
    mimeType: "image/jpeg",
    alt: "Completed project",
    storagePath: "website-1/evidence/project.jpg",
    required: true,
  };
  const evidenceV4 = {
    ...emptyV4,
    themeSource:
      'export default function Site(){ return <main><Media slotId="project-proof" /></main>; }',
    mediaManifest: { slots: [evidenceSlot] },
    unifiedPlan: {
      ...emptyPlan,
      operationalIntent: {
        operationalAnchors: [],
        mediaSlots: [
          {
            slotId: "project-proof",
            role: "proof",
            required: true,
            sourcePreference: "evidence",
            aspectRatio: "wide",
            cropGuidance: "Keep the completed work visible",
            textOverlayAllowed: false,
            proofEligibleRequired: true,
          },
        ],
      },
    },
  };
  const evidenceDb = supabaseFor({
    config: evidenceV4,
    attachments: [
      {
        slot_id: evidenceSlot.slotId,
        asset_id: evidenceSlot.assetId,
        mime_type: evidenceSlot.mimeType,
        role: evidenceSlot.role,
        provenance: evidenceSlot.origin,
        required: true,
        proof_eligible: true,
        source_slot_id: null,
        poster_slot_id: null,
        storage_path: evidenceSlot.storagePath,
      },
    ],
  });
  await publishWebsiteVersion(evidenceDb, "website-1", "version-1", 7);
  assert.equal(evidenceDb.calls.published.length, 1);
  assert.equal(evidenceDb.calls.published[0].args.p_expected_media_slots.length, 1);

  const historicalManifest = {
    slots: [
      {
        slotId: "hero",
        assetId: "generated-1",
        origin: "generated",
        role: "hero",
        proofEligible: false,
        mimeType: "image/jpeg",
        alt: "Hero",
        storagePath: "website-1/generated/hero.jpg",
        required: true,
      },
      {
        slotId: "support",
        assetId: "generated-2",
        origin: "generated",
        role: "support",
        proofEligible: false,
        mimeType: "image/jpeg",
        alt: "Support",
        storagePath: "website-1/generated/support.jpg",
        required: true,
      },
    ],
  };
  const historicalBrief = {
    planSchemaVersion: 1,
    recipeId: "editorial-ledger",
    recipeVersion: 1,
    heroTopology: "split-media",
    sectionTopology: [
      { section: "hero", shape: "split" },
      { section: "services", shape: "ledger" },
      { section: "contact", shape: "stack" },
    ],
    responsiveIntent: "linearize",
    conversionPlacement: "contact-only",
    mediaSlots: [
      {
        slotId: "hero",
        role: "hero",
        section: "hero",
        sourcePreference: "generated",
        aspectRatio: "wide",
        cropGuidance: "center",
        textOverlayAllowed: true,
        proofEligibleRequired: false,
        mobileTreatment: "crop",
        required: true,
      },
      {
        slotId: "support",
        role: "support",
        section: "services",
        sourcePreference: "generated",
        aspectRatio: "wide",
        cropGuidance: "center",
        textOverlayAllowed: false,
        proofEligibleRequired: false,
        mobileTreatment: "crop",
        required: true,
      },
    ],
  };
  for (const version of [2, 3]) {
    const versionedManifest =
      version === 2
        ? {
            slots: [
              ...historicalManifest.slots,
              {
                slotId: "motion",
                assetId: "video-1",
                origin: "generated",
                role: "atmosphere",
                proofEligible: false,
                mimeType: "video/mp4",
                alt: "",
                storagePath: "website-1/generated/motion.mp4",
                sourceSlotId: "hero",
                posterSlotId: "hero",
                required: true,
              },
            ],
          }
        : historicalManifest;
    const historicalConfig = {
      ...emptyV4,
      generatorSchemaVersion: version,
      mediaManifest: versionedManifest,
    };
    const historicalDb = supabaseFor({ config: historicalConfig });
    await assert.rejects(
      () => publishWebsiteVersion(historicalDb, "website-1", "version-1", 7),
      /invalid unified brief/,
      "v2/v3 must retain historical recipe/brief validation",
    );
    assert.equal(historicalDb.calls.attachmentReads, 0);
    assert.equal(historicalDb.calls.published.length, 0);

    const historicalAttachments = versionedManifest.slots.map((slot) => ({
      slot_id: slot.slotId,
      asset_id: slot.assetId,
      mime_type: slot.mimeType,
      role: slot.role,
      provenance: slot.origin,
      required: slot.required === true,
      proof_eligible: slot.proofEligible === true,
      source_slot_id: slot.sourceSlotId ?? null,
      poster_slot_id: slot.posterSlotId ?? null,
      storage_path: slot.storagePath,
    }));
    const validHistorical = {
      ...historicalConfig,
      themeSource: `export default function Site(){ return <main>${versionedManifest.slots
        .map((slot) => `<Media slotId="${slot.slotId}" />`)
        .join("")}</main>; }`,
      unifiedBrief: historicalBrief,
      divergenceTuple: canonicalUnifiedDivergenceTuple(historicalBrief),
      recipeId: historicalBrief.recipeId,
      recipeVersion: historicalBrief.recipeVersion,
    };
    delete validHistorical.bucket1ValidationInput;
    delete validHistorical.bucket1ValidationAttestation;
    const validHistoricalDb = supabaseFor({
      config: validHistorical,
      attachments: historicalAttachments,
    });
    await publishWebsiteVersion(validHistoricalDb, "website-1", "version-1", 7);
    assert.equal(
      validHistoricalDb.calls.published.length,
      1,
      "v2/v3 do not require v4 attestation",
    );
  }

  const templateOverlay = {
    kind: "template",
    templateSlug: "painter11",
    identity: {
      businessName: "Acme Painting",
      licenseNumber: "123456",
      city: "Los Angeles",
      phone: null,
      email: null,
    },
    text: {},
    media: {},
    reviews: [],
    blogs: [],
    contact: { phone: null, email: null, area: null, hours: null },
  };
  const emptyTemplateDb = supabaseFor({ config: templateOverlay });
  await assert.rejects(
    () => publishWebsiteVersion(emptyTemplateDb, "website-1", "version-1", 7),
    /not been personalized/,
    "an empty template overlay publishes catalog copy",
  );
  assert.equal(emptyTemplateDb.calls.published.length, 0);

  const filledTemplateText = {
    heroTitle: "Fresh paint for Acme homes.",
    heroSub: "Interior and exterior painting with a written scope.",
    servicesHeading: "Painting services",
    servicesIntro: "Interior, exterior, cabinets, and trim.",
    proofTitle: "Recent work",
    proofBody: "A look at finished rooms and exteriors.",
    detailTitle: "Details matter",
    detailBody: "Clean lines and careful preparation.",
    reviewsHeading: "What neighbors say",
    reviewsBody: "Feedback from recent projects.",
    estimateTitle: "Get an estimate",
    estimateIntro: "Tell us about your project.",
    planHeading: "Plan your project",
    planIntro: "A clear scope before work begins.",
  };
  const partialTemplateDb = supabaseFor({
    config: {
      ...templateOverlay,
      text: { heroTitle: "Fresh paint for Acme homes." },
    },
  });
  await assert.rejects(
    () => publishWebsiteVersion(partialTemplateDb, "website-1", "version-1", 7),
    /not been personalized/,
    "a partially filled overlay still renders demo copy in the missing slots",
  );
  assert.equal(partialTemplateDb.calls.published.length, 0);

  const filledTemplateDb = supabaseFor({
    config: {
      ...templateOverlay,
      text: filledTemplateText,
    },
  });
  await publishWebsiteVersion(filledTemplateDb, "website-1", "version-1", 7);
  assert.equal(filledTemplateDb.calls.published.length, 1);
  assert.equal(filledTemplateDb.calls.published[0].args.p_expected_media_slots, null);

  console.log("verify-publish-manifest: ok");
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
