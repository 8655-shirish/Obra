import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { encode as encodePng } from "fast-png";

const root = path.resolve(import.meta.dirname, "..");
const temporary = await fs.mkdtemp(path.join(root, ".verify-media-repair-"));
const out = path.join(temporary, "repair.mjs");
await build({
  entryPoints: [path.join(root, "src/lib/media/contractor-media-repair.server.ts")],
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  alias: { "@": path.join(root, "src") },
});
const { repairContractorMedia, isApprovedHistoricalMediaUrl, isExpiredSignedUrl, isRemoteMediaUrlSsrfSafe } = await import(
  pathToFileURL(out)
);

const website = "11111111-1111-4111-8111-111111111111";
const liveVersion = "22222222-2222-4222-8222-222222222222";
const draftVersion = "33333333-3333-4333-8333-333333333333";
const forkVersion = "44444444-4444-4444-8444-444444444444";
const goodUrl = "https://s3-media0.fl.yelpcdn.com/bphoto/good.jpg";
const missingUrl = "https://s3-media0.fl.yelpcdn.com/bphoto/missing.jpg";
const ssrfUrl = "http://169.254.169.254/latest/meta-data/photo.png";

const pixels = new Uint8Array(64 * 64 * 4).fill(200);
const pngBytes = encodePng({ width: 64, height: 64, data: pixels, channels: 4, depth: 8 });
const pngHash = createHash("sha256").update(pngBytes).digest("hex");
const expectedPath = `${website}/enrichment/${pngHash}.png`;

const slot = (overrides = {}) => ({
  slotId: "hero-1",
  assetId: "asset-1",
  origin: "evidence",
  role: "hero",
  proofEligible: true,
  mimeType: "image/jpeg",
  alt: "Finished kitchen remodel",
  url: goodUrl,
  ...overrides,
});

const config = (overrides = {}) => ({
  generatorSchemaVersion: 3,
  mediaGallery: [{ url: goodUrl, alt: "Finished kitchen remodel", platform: "yelp" }],
  mediaManifest: { slots: [slot()] },
  ...overrides,
});

function makeDeps(options = {}) {
  const state = {
    uploads: [],
    enrichmentWrites: [],
    versionWrites: [],
    forks: [],
    publishes: [],
    audits: [],
    storage: new Set(options.storage ?? []),
  };
  const versions = options.versions ?? [
    {
      id: liveVersion,
      status: "live",
      revision: 4,
      version_number: 2,
      variant_key: "a",
      config_json: config(),
    },
    {
      id: draftVersion,
      status: "draft",
      revision: 1,
      version_number: 3,
      variant_key: "b",
      config_json: config(),
    },
  ];
  const deps = {
    state,
    async loadWebsite() {
      return { id: website, activeVersionId: liveVersion };
    },
    async loadEnrichment() {
      return {
        images: [
          { url: goodUrl, alt: "Finished kitchen remodel", platform: "yelp" },
          ...(options.extraImages ?? []),
        ],
      };
    },
    async loadVersions() {
      return versions.map((version) => ({ ...version }));
    },
    async loadSlots() {
      return options.slots ?? [];
    },
    async storageExists(storagePath) {
      return state.storage.has(storagePath);
    },
    async fetchRemote(url) {
      if (!isRemoteMediaUrlSsrfSafe(url)) throw new Error("Unsafe remote media URL");
      if (url === missingUrl) return null;
      return { bytes: pngBytes, mimeType: "image/png" };
    },
    async upload(storagePath, bytes, mimeType) {
      state.uploads.push({ storagePath, bytes: bytes.byteLength, mimeType });
      state.storage.add(storagePath);
      return true;
    },
    async saveEnrichment(_id, enrichment) {
      state.enrichmentWrites.push(enrichment);
      return true;
    },
    async updateVersionMedia(input) {
      if (options.failVersionWrite) return { ok: false, error: "column mismatch" };
      state.versionWrites.push(input);
      return true;
    },
    async forkVersion(input) {
      state.forks.push(input);
      return {
        id: forkVersion,
        status: "draft",
        revision: 0,
        version_number: 9,
        variant_key: "a",
        config_json: config(),
      };
    },
    async publishVersion(input) {
      state.publishes.push(input);
      return true;
    },
    async recordAudit(event) {
      state.audits.push(event);
    },
    now: () => new Date("2026-08-24T12:00:00.000Z"),
  };
  return deps;
}

// 1. Dry run performs zero writes and produces a complete plan.
{
  const deps = makeDeps();
  const result = await repairContractorMedia(deps, { websiteId: website });
  assert.equal(result.dryRun, true);
  assert.equal(result.summary.versionsInspected, 2);
  assert.ok(result.summary.repairable > 0);
  assert.equal(result.summary.repaired, 0);
  assert.deepEqual(deps.state.uploads, []);
  assert.deepEqual(deps.state.versionWrites, []);
  assert.deepEqual(deps.state.enrichmentWrites, []);
  assert.deepEqual(deps.state.audits, []);
  const live = result.versions.find((version) => version.versionId === liveVersion);
  assert.equal(live.action, "fork_and_repoint");
  assert.equal(
    result.versions.find((version) => version.versionId === draftVersion).action,
    "update_in_place",
  );
  // URL-only historical media is classified as such.
  assert.ok(result.items.every((item) => item.issues.length > 0));
  assert.ok(result.items.some((item) => item.issues.includes("url_only")));
  // Manifest/attachment mismatch is reported (ledger is empty in this fixture).
  assert.ok(result.items.some((item) => item.issues.includes("manifest_attachment_mismatch")));
  console.log("ok: dry-run plan, zero writes");
}

// 2. dryRun defaults to true even when the caller omits it.
{
  const deps = makeDeps();
  const result = await repairContractorMedia(deps, { websiteId: website, dryRun: undefined });
  assert.equal(result.dryRun, true);
  console.log("ok: dryRun defaults to true");
}

// 3. Real repair: rehost, live fork + atomic repoint, manifest/ledger parity.
{
  const deps = makeDeps();
  const result = await repairContractorMedia(deps, { websiteId: website, dryRun: false });
  assert.equal(deps.state.uploads.length, 1);
  assert.equal(deps.state.uploads[0].storagePath, expectedPath);
  assert.equal(deps.state.forks.length, 1);
  assert.equal(deps.state.forks[0].versionId, liveVersion);
  assert.equal(deps.state.publishes.length, 1);
  assert.equal(deps.state.publishes[0].versionId, forkVersion);
  // Live version is never mutated in place.
  assert.ok(deps.state.versionWrites.every((write) => write.versionId !== liveVersion));
  for (const write of [...deps.state.versionWrites, ...deps.state.publishes]) {
    assert.deepEqual(write.configJson.mediaManifest.slots, write.mediaSlots);
    assert.equal(write.mediaSlots[0].storagePath, expectedPath);
    assert.equal(write.mediaSlots[0].alt, "Finished kitchen remodel");
    assert.equal(write.mediaSlots[0].url, undefined);
  }
  // Human-authored fields survive.
  const images = deps.state.enrichmentWrites.at(-1).images;
  assert.equal(images[0].alt, "Finished kitchen remodel");
  assert.equal(images[0].platform, "yelp");
  assert.equal(images[0].storagePath, expectedPath);
  assert.equal(images[0].contentHash, pngHash);
  assert.equal(deps.state.audits.length, 1);
  assert.equal(deps.state.audits[0].website_id, website);
  assert.ok(deps.state.audits[0].identities.some((entry) => entry.storagePath === expectedPath));
  assert.ok(result.summary.repaired > 0);
  console.log("ok: repair, live fork + atomic repoint, parity, audit");
}

// 4. Idempotent retry: content-addressed path already present -> no second upload.
{
  const deps = makeDeps({ storage: [expectedPath] });
  await repairContractorMedia(deps, { websiteId: website, dryRun: false });
  assert.deepEqual(deps.state.uploads, []);
  assert.equal(deps.state.publishes.length, 1);
  console.log("ok: retry idempotency");
}

// 5. Old storage-path formats are flagged as unowned and re-hosted onto the current grammar.
{
  const legacy = "legacy-bucket/old-path.jpg";
  const deps = makeDeps({
    versions: [
      {
        id: draftVersion,
        status: "draft",
        revision: 1,
        version_number: 1,
        variant_key: "a",
        config_json: config({
          mediaGallery: [{ url: goodUrl, storagePath: legacy }],
          mediaManifest: { slots: [slot({ storagePath: legacy })] },
        }),
      },
    ],
  });
  const plan = await repairContractorMedia(deps, { websiteId: website });
  assert.ok(plan.items.some((item) => item.issues.includes("unowned_storage_path")));
  const repaired = await repairContractorMedia(deps, { websiteId: website, dryRun: false });
  assert.equal(deps.state.versionWrites[0].mediaSlots[0].storagePath, expectedPath);
  assert.ok(repaired.summary.repaired > 0);
  console.log("ok: legacy storage path grammar");
}

// 6. Missing storage object is detected and re-hosted from source.
{
  const owned = `${website}/enrichment/${"a".repeat(64)}.jpg`;
  const deps = makeDeps({
    versions: [
      {
        id: draftVersion,
        status: "draft",
        revision: 1,
        version_number: 1,
        variant_key: "a",
        config_json: config({
          mediaGallery: [{ url: goodUrl, storagePath: owned }],
          mediaManifest: { slots: [slot({ storagePath: owned })] },
        }),
      },
    ],
  });
  const plan = await repairContractorMedia(deps, { websiteId: website });
  assert.ok(plan.items.some((item) => item.issues.includes("missing_storage_object")));
  console.log("ok: missing storage object");
}

// 7. Missing source image: unrecoverable, no partial publish.
{
  const deps = makeDeps({
    versions: [
      {
        id: liveVersion,
        status: "live",
        revision: 4,
        version_number: 1,
        variant_key: "a",
        config_json: config({
          mediaGallery: [{ url: missingUrl }],
          mediaManifest: { slots: [slot({ url: missingUrl })] },
        }),
      },
    ],
  });
  const result = await repairContractorMedia(deps, { websiteId: website, dryRun: false });
  assert.equal(deps.state.publishes.length, 0);
  assert.equal(result.versions[0].outcome, "failed");
  assert.ok(result.summary.unrecoverable > 0);
  assert.ok(result.errors.length > 0);
  console.log("ok: missing source, no incomplete publish");
}

// 8. Partially failed repair does not publish an incomplete version.
{
  const deps = makeDeps({ failVersionWrite: true });
  const result = await repairContractorMedia(deps, { websiteId: website, dryRun: false });
  assert.equal(deps.state.publishes.length, 0);
  assert.ok(result.versions.every((version) => version.outcome !== "repaired"));
  console.log("ok: partial failure never publishes");
}

// 9. SSRF rejection and host allow-listing.
{
  assert.equal(isApprovedHistoricalMediaUrl(ssrfUrl), false);
  assert.equal(isApprovedHistoricalMediaUrl("https://127.0.0.1/photo.png"), false);
  assert.equal(isApprovedHistoricalMediaUrl("http://s3.yelpcdn.com/a.jpg"), false);
  assert.equal(isApprovedHistoricalMediaUrl(goodUrl), true);
  assert.equal(isRemoteMediaUrlSsrfSafe(ssrfUrl), false);
  assert.equal(isRemoteMediaUrlSsrfSafe("https://127.0.0.1/photo.png"), false);
  assert.equal(isRemoteMediaUrlSsrfSafe("http://www.example.com/images/job.jpg"), true);
  const deps = makeDeps({
    versions: [
      {
        id: draftVersion,
        status: "draft",
        revision: 1,
        version_number: 1,
        variant_key: "a",
        config_json: config({
          mediaGallery: [{ url: ssrfUrl }],
          mediaManifest: { slots: [slot({ url: ssrfUrl })] },
        }),
      },
    ],
  });
  const result = await repairContractorMedia(deps, { websiteId: website, dryRun: false });
  const ssrfItem = result.items.find((item) => item.sourceUrl === ssrfUrl);
  assert.ok(ssrfItem.issues.includes("unrecoverable_source"));
  assert.equal(ssrfItem.action, "manual");
  assert.equal(deps.state.versionWrites.length, 0);
  console.log("ok: SSRF rejection");
}

// 10. Expired signed URLs are classified.
{
  const expired = `https://x.supabase.co/storage/v1/object/sign/site-media/a.jpg?token=${[
    Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
    Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url"),
    "sig",
  ].join(".")}`;
  assert.equal(isExpiredSignedUrl(expired, Date.now()), true);
  assert.equal(isExpiredSignedUrl(goodUrl, Date.now()), false);
  console.log("ok: expired signed url detection");
}

// 11. Duplicate source URLs are reported.
{
  const deps = makeDeps({ extraImages: [{ url: goodUrl, alt: "dup" }] });
  const result = await repairContractorMedia(deps, { websiteId: website });
  assert.ok(result.items.some((item) => item.issues.includes("duplicate_source_url")));
  console.log("ok: duplicate source urls");
}

{
  const serverSrc = await fs.readFile(path.join(root, "src/server.ts"), "utf8");
  const persistSrc = await fs.readFile(
    path.join(root, "src/lib/media/persist-scraped-media.server.ts"),
    "utf8",
  );
  assert.match(serverSrc, /persistEnrichment === true/);
  assert.doesNotMatch(serverSrc, /backfillNext/);
  assert.match(serverSrc, /persistScrapedSiteMedia/);
  assert.match(
    serverSrc,
    /imagesRemaining: countGatedImagesMissingAttestation\(websiteId, liveAfter/,
  );
  assert.match(serverSrc, /afterError \|\| !after/);
  assert.match(persistSrc, /countGatedImagesMissingAttestation/);
  assert.match(persistSrc, /deps\.signal\?\.aborted/);
  const executeSrc = await fs.readFile(path.join(root, "src/lib/jobs/execute.server.ts"), "utf8");
  assert.doesNotMatch(executeSrc, /persistFrozenEnrichment/);
  assert.match(executeSrc, /overlayStoredEvidenceOnFrozenEnrichment/);
  console.log("ok: persist enrichment stays off generate");
}

await fs.rm(temporary, { recursive: true, force: true });
console.log("verify-contractor-media-repair: ok");
