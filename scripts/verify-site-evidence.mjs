import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

const evidence = await import(pathToFileURL(path.join(here, "../src/lib/site-evidence.ts")).href);

const {
  curateProjectImages,
  isDroppableImageUrl,
  trustHrefForKind,
  isOffTradeQuote,
  preferSchemaReviews,
  coerceLookAndFeel,
  curateSiteEvidence,
  isDirectorySearchUrl,
  classifyListedWebsiteUrl,
  formatTrustRatingDetail,
  overlayStoragePathByUrl,
  evidenceMediaItems,
  generatedMediaItems,
  evidenceStillCount,
  isGeneratedMedia,
} = evidence;

const HOMEADVISOR_BANNER = "https://www.homeadvisor.com/images/consumer/ha/hero-banner.jpg";
const BUILDZOOM_TINY = "https://prod-cdn.buildzoom.com/profile/photo.jpg?width=100&height=100";
const HOUZZ_THUMB = "https://st.hzcdn.com/fimgs/abc123_w390-h260.jpg";
const UNSPLASH_STOCK = "https://images.squarespace-cdn.com/content/v1/abc/unsplash-image-xyz.jpg";
const SQUARESPACE_JOB = "https://images.squarespace-cdn.com/content/v1/abc/painted-kitchen.jpg";
const YELP_PHOTO = "https://s3-media0.fl.yelpcdn.com/bphoto/xyz123/o.jpg";
const YELP_LS = "https://s3-media0.fl.yelpcdn.com/bphoto/xyz123/ls.jpg";
const YELP_168 = "https://s3-media0.fl.yelpcdn.com/bphoto/xyz123/168s.jpg";
const YELP_PROFILE = "https://www.yelp.com/biz/eco-smart-painting";
const ANGI_MISMATCH = "https://www.ecosmartinteriors.com/interiors";
const GOOGLE_MAPS = "https://maps.app.goo.gl/abc123";

assert.equal(isDroppableImageUrl(HOMEADVISOR_BANNER), true);
assert.equal(isDroppableImageUrl(BUILDZOOM_TINY), true);
assert.equal(isDroppableImageUrl(HOUZZ_THUMB), true);
assert.equal(isDroppableImageUrl(SQUARESPACE_JOB), false);
assert.equal(isDroppableImageUrl(YELP_PHOTO), false);
assert.equal(isDroppableImageUrl(YELP_LS), true);
assert.equal(isDroppableImageUrl(YELP_168), true);

const curated = curateProjectImages([
  { url: HOMEADVISOR_BANNER, alt: "ad" },
  { url: BUILDZOOM_TINY, alt: "tiny" },
  { url: HOUZZ_THUMB, alt: "thumb" },
  { url: UNSPLASH_STOCK, alt: "stock" },
  { url: YELP_PHOTO, alt: "listing" },
  { url: SQUARESPACE_JOB, alt: "job" },
]);

const curatedWithThumbs = curateProjectImages([
  { url: YELP_LS, alt: "list" },
  { url: YELP_168, alt: "square" },
  { url: YELP_PHOTO, alt: "listing" },
  { url: SQUARESPACE_JOB, alt: "job" },
]);
assert.deepEqual(
  curatedWithThumbs.map((item) => item.url),
  [SQUARESPACE_JOB, YELP_PHOTO],
);

const onlyStock = curateProjectImages([{ url: UNSPLASH_STOCK, alt: "stock" }]);
assert.deepEqual(
  onlyStock.map((item) => item.url),
  [UNSPLASH_STOCK],
);

const uploaded = "https://example.supabase.co/storage/v1/object/sign/site-media/job.jpg";
const preferUpload = curateProjectImages([
  { url: YELP_PHOTO, alt: "listing" },
  { url: uploaded, storagePath: "site-media/job.jpg", alt: "upload" },
  { url: SQUARESPACE_JOB, alt: "job" },
]);
assert.deepEqual(
  preferUpload.map((item) => item.url),
  [uploaded, SQUARESPACE_JOB, YELP_PHOTO],
);

assert.equal(trustHrefForKind("google", YELP_PROFILE), undefined);
assert.equal(trustHrefForKind("google", GOOGLE_MAPS), GOOGLE_MAPS);
assert.equal(trustHrefForKind("angi", ANGI_MISMATCH), undefined);
assert.equal(
  trustHrefForKind("angi", "https://www.angi.com/companylist/us/ca/eco.htm"),
  "https://www.angi.com/companylist/us/ca/eco.htm",
);
assert.equal(trustHrefForKind("yelp", YELP_PROFILE), YELP_PROFILE);

const roofingQuote = "They replaced our entire roof after the storm and it looks brand new.";
const paintingQuote = "Careful painters — the interior painting was flawless.";
assert.equal(isOffTradeQuote(roofingQuote, "C-33"), true);
assert.equal(isOffTradeQuote(paintingQuote, "C-33"), false);
assert.equal(isOffTradeQuote(roofingQuote, "Roofing"), false);

const schemaWins = preferSchemaReviews(
  [{ quote: paintingQuote, author: "Ada", source: "Google" }],
  [{ quote: "LLM extra that should lose", author: "Bot", source: "Aggregates" }],
  "C-33",
);
assert.equal(schemaWins.length, 1);
assert.equal(schemaWins[0].quote, paintingQuote);

const schemaRoofingDropped = preferSchemaReviews(
  [{ quote: roofingQuote, author: "Sam", source: "Aggregates" }],
  [{ quote: paintingQuote, author: "Ada", source: "Google" }],
  "C-33",
);
assert.equal(schemaRoofingDropped.length, 0);

assert.equal(coerceLookAndFeel("clean, eco-conscious, contemporary"), "modern");
assert.equal(coerceLookAndFeel("professional"), "professional");
assert.equal(coerceLookAndFeel("FUNKY"), "funky");
assert.equal(coerceLookAndFeel("unknown vibe"), "professional");

const live = curateSiteEvidence({
  trade: "C-33",
  lookAndFeel: "clean, eco-conscious, contemporary",
  mediaGallery: [{ url: HOMEADVISOR_BANNER }, { url: SQUARESPACE_JOB }],
  extraReviews: [
    { quote: roofingQuote, author: "Sam", source: "Aggregates" },
    { quote: paintingQuote, author: "Ada", source: "Google" },
  ],
  trustMarkers: [
    { id: "google", kind: "google", label: "Google", detail: "4.9/5", href: YELP_PROFILE },
    { id: "angi", kind: "angi", label: "Angi", detail: "4.8/5", href: ANGI_MISMATCH },
  ],
});

assert.equal(live.lookAndFeel, "modern");
assert.deepEqual(
  live.mediaGallery.map((item) => item.url),
  [SQUARESPACE_JOB],
);
assert.equal(live.extraReviews.length, 1);
assert.equal(live.extraReviews[0].quote, paintingQuote);
assert.equal(live.trustMarkers.find((m) => m.id === "google")?.href, undefined);
assert.equal(live.trustMarkers.find((m) => m.id === "angi")?.href, undefined);
assert.equal(live.trustMarkers.find((m) => m.id === "google")?.detail, "4.9/5");

assert.equal(
  isDroppableImageUrl("https://res.cloudinary.com/angi-prod/image/upload/v1748027941/location.svg"),
  true,
);
assert.equal(
  isDirectorySearchUrl(
    "https://www.yelp.com/search?find_desc=Stucco+Repair&find_loc=San+Francisco%2C+CA",
  ),
  true,
);
assert.equal(
  trustHrefForKind("yelp", "https://www.yelp.com/search?find_desc=Stucco+Repair"),
  undefined,
);
assert.equal(formatTrustRatingDetail("bbb", "5", "40"), "40 reviews");
assert.equal(formatTrustRatingDetail("bbb", "A+"), "A+");
assert.equal(formatTrustRatingDetail("google", "5", "40"), "5/5 · 40 reviews");

const factSheet = await import(
  pathToFileURL(path.join(here, "../src/lib/site-fact-sheet.ts")).href
);
assert.equal(factSheet.namesMatchContractor("VSA CONSTRUCTION", "Caledonia Plastering"), false);
assert.equal(factSheet.namesMatchContractor("VSA CONSTRUCTION", "VSA Construction Inc"), true);
assert.equal(
  factSheet.hitMatchesContractor(
    {
      url: "https://example.com/biz",
      json: { business_name: "Caledonia Plastering", review_quotes: [{ quote: "Great stucco" }] },
    },
    { businessName: "VSA CONSTRUCTION", licenseNumber: "990233" },
  ),
  false,
);
assert.equal(
  factSheet.hitMatchesContractor(
    {
      url: "https://cslb.ca.gov/990233",
      markdown: "License 990233",
    },
    { businessName: "VSA CONSTRUCTION", licenseNumber: "990233" },
  ),
  true,
);

const sheet = factSheet.buildFactSheet(
  {
    businessName: "VSA CONSTRUCTION",
    licenseNumber: "990233",
    trade: "C-33",
    city: "SAN FRANCISCO",
  },
  {
    platforms: {
      Nextdoor: {
        results: [
          {
            url: "https://nextdoor.com/pages/caledonia",
            json: {
              business_name: "Caledonia Plastering",
              review_quotes: [{ quote: "Working with John at Caledonia Plastering" }],
              photo_urls: ["https://s3-media0.fl.yelpcdn.com/bphoto/abc/o.jpg"],
            },
          },
        ],
      },
    },
  },
);
assert.equal(sheet.reviews.length, 0);
assert.equal(sheet.images.length, 0);

const CAL_PHOTO = "https://s3-media0.fl.yelpcdn.com/bphoto/abc/o.jpg";

const YELP_LISTING = "https://www.yelp.com/biz/vsa-construction-san-diego";
const VSA_ONBOARDING = {
  businessName: "VSA CONSTRUCTION",
  licenseNumber: "990233",
  trade: "C-33",
  city: "SAN FRANCISCO",
};
const vsaYelpHit = (photoUrl) => ({
  yelp: {
    results: [
      {
        url: YELP_LISTING,
        json: { business_name: "VSA Construction", photo_urls: [photoUrl] },
      },
    ],
  },
});

const attestedSheet = factSheet.buildFactSheet(VSA_ONBOARDING, {
  platforms: vsaYelpHit(YELP_PHOTO),
  images: [
    {
      url: YELP_PHOTO,
      storagePath: "site/enrichment/photo.jpg",
      mimeType: "image/jpeg",
      width: 1200,
      height: 800,
      aspect: 1.5,
      orientation: "landscape",
      contentHash: "abc123",
      provenance: {
        kind: "evidence",
        sourceUrl: YELP_PHOTO,
        platform: "Yelp",
        storageBucket: "site-media",
      },
      proofEligible: true,
    },
  ],
});
assert.equal(attestedSheet.images[0].contentHash, "abc123");
assert.equal(attestedSheet.images[0].width, 1200);
assert.equal(attestedSheet.images[0].proofEligible, true);
assert.equal(evidenceStillCount(attestedSheet.images, { requireUsablePersisted: true }), 1);

const ungatedPersistedSheet = factSheet.buildFactSheet(VSA_ONBOARDING, {
  images: [
    {
      url: "https://s3-media0.fl.yelpcdn.com/bphoto/persist-me/o.jpg",
      platform: "yelp",
      alt: "job",
      storagePath: "web-1/enrichment/abc123.jpg",
      mimeType: "image/jpeg",
    },
  ],
});
assert.equal(ungatedPersistedSheet.images.length, 0, "enrichment-only photos stay off the page");

const gatedPersistedSheet = factSheet.buildFactSheet(VSA_ONBOARDING, {
  platforms: vsaYelpHit(YELP_PHOTO),
  images: [{ url: YELP_PHOTO, storagePath: "web-1/enrichment/abc123.jpg", mimeType: "image/jpeg" }],
});
assert.equal(gatedPersistedSheet.images.length, 1);
assert.equal(gatedPersistedSheet.images[0].storagePath, "web-1/enrichment/abc123.jpg");

const caledoniaPersisted = factSheet.buildFactSheet(VSA_ONBOARDING, {
  platforms: {
    Nextdoor: {
      results: [
        {
          url: "https://nextdoor.com/pages/caledonia",
          json: {
            business_name: "Caledonia Plastering",
            photo_urls: [CAL_PHOTO],
          },
        },
      ],
    },
  },
  images: [{ url: CAL_PHOTO, storagePath: "web-1/enrichment/wrong.jpg" }],
});
assert.equal(caledoniaPersisted.images.length, 0);

const overlaid = overlayStoragePathByUrl(
  [{ url: YELP_PHOTO, alt: "job" }],
  [
    { url: YELP_PHOTO, storagePath: "web-1/enrichment/abc.jpg", mimeType: "image/jpeg" },
    { url: CAL_PHOTO, storagePath: "web-1/enrichment/wrong.jpg" },
  ],
);
assert.equal(overlaid.length, 1);
assert.equal(overlaid[0].storagePath, "web-1/enrichment/abc.jpg");
assert.equal(overlaid[0].mimeType, "image/jpeg");

assert.equal(
  factSheet.listingUrlForImage(VSA_ONBOARDING, { platforms: vsaYelpHit(YELP_PHOTO) }, YELP_PHOTO),
  YELP_LISTING,
);
assert.equal(
  factSheet.listingUrlForImage(VSA_ONBOARDING, { images: [{ url: YELP_PHOTO }] }, YELP_PHOTO),
  null,
);

const persistMod = await import(
  pathToFileURL(path.join(here, "../src/lib/media/persist-scraped-media.server.ts")).href
);
const { downloadMediaForPersist, persistScrapedSiteMedia } = persistMod;

assert.equal(await downloadMediaForPersist(HOMEADVISOR_BANNER), null);

const failedFetch = async () => {
  throw new Error("network down");
};
assert.equal(await downloadMediaForPersist(YELP_PHOTO, failedFetch), null);

const { encode: encodePng } = await import("fast-png");
const pngBytes = encodePng({
  width: 640,
  height: 480,
  data: new Uint8Array(640 * 480 * 4).fill(255),
  depth: 8,
  channels: 4,
});
const okBytes = pngBytes;
const okFetch = async () =>
  new Response(okBytes, { status: 200, headers: { "content-type": "image/png" } });
const downloaded = await downloadMediaForPersist(YELP_PHOTO, okFetch);
assert.ok(downloaded);
assert.equal(downloaded.mimeType, "image/png");
assert.equal(downloaded.bytes.byteLength, okBytes.byteLength);

let capturedReferer;
const persistFetch = async (_url, init) => {
  capturedReferer = init?.headers?.Referer;
  return new Response(okBytes, { status: 200, headers: { "content-type": "image/png" } });
};

const uploadedPaths = [];
const persisted = await persistScrapedSiteMedia(
  {},
  "web-1",
  {
    images: [{ url: YELP_PHOTO, platform: "yelp", alt: "job" }],
    platforms: vsaYelpHit(YELP_PHOTO),
  },
  {
    fetch: persistFetch,
    upload: async (path, body, mime) => {
      uploadedPaths.push({ path, size: body.byteLength, mime });
      return { ok: true };
    },
    writeBack: false,
    onboarding: VSA_ONBOARDING,
  },
);
assert.equal(uploadedPaths.length, 1);
assert.match(uploadedPaths[0].path, /^web-1\/enrichment\/[a-f0-9]{64}\.png$/);
assert.equal(uploadedPaths[0].mime, "image/png");
assert.equal(persisted.images[0].mimeType, "image/png");
assert.equal(persisted.images[0].storagePath, uploadedPaths[0].path);
assert.equal(persisted.images[0].width, 640);
assert.equal(persisted.images[0].height, 480);
assert.equal(persisted.images[0].aspect, 640 / 480);
assert.equal(persisted.images[0].orientation, "landscape");
assert.match(persisted.images[0].contentHash, /^[a-f0-9]{64}$/);
assert.deepEqual(persisted.images[0].provenance, {
  kind: "evidence",
  sourceUrl: YELP_PHOTO,
  platform: "yelp",
  storageBucket: "site-media",
});
assert.equal(persisted.images[0].proofEligible, true);
assert.equal(capturedReferer, YELP_LISTING);

let ungatedUploads = 0;
const skippedUngated = await persistScrapedSiteMedia(
  {},
  "web-1",
  { images: [{ url: YELP_PHOTO, platform: "yelp", alt: "job" }] },
  {
    fetch: okFetch,
    upload: async () => {
      ungatedUploads += 1;
      return { ok: true };
    },
    writeBack: false,
    onboarding: VSA_ONBOARDING,
  },
);
assert.equal(ungatedUploads, 0);
assert.equal(skippedUngated.images[0].storagePath, undefined);

let alreadyUploads = 0;
const alreadyPersisted = await persistScrapedSiteMedia(
  {},
  "web-1",
  {
    images: [
      {
        url: YELP_PHOTO,
        storagePath:
          "web-1/enrichment/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
      },
    ],
    platforms: vsaYelpHit(YELP_PHOTO),
  },
  {
    fetch: async () => {
      throw new Error("legacy repair must prefer owned storage");
    },
    downloadStorage: async (path) => {
      assert.equal(
        path,
        "web-1/enrichment/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
      );
      return { bytes: okBytes, mimeType: "image/png" };
    },
    upload: async () => {
      alreadyUploads += 1;
      return { ok: true };
    },
    writeBack: false,
    onboarding: VSA_ONBOARDING,
  },
);
assert.equal(alreadyUploads, 0);
assert.equal(
  alreadyPersisted.images[0].storagePath,
  "web-1/enrichment/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
);
assert.equal(alreadyPersisted.images[0].width, 640);
assert.equal(alreadyPersisted.images[0].height, 480);
assert.equal(alreadyPersisted.images[0].proofEligible, true);
assert.match(alreadyPersisted.images[0].contentHash, /^[a-f0-9]{64}$/);

const fetchFailedPersist = await persistScrapedSiteMedia(
  {},
  "web-1",
  {
    images: [{ url: YELP_PHOTO, platform: "yelp" }],
    platforms: vsaYelpHit(YELP_PHOTO),
  },
  { fetch: failedFetch, writeBack: false, onboarding: VSA_ONBOARDING },
);
assert.equal(fetchFailedPersist.images[0].storagePath, undefined);

const aborted = new AbortController();
aborted.abort();
let abortedFetches = 0;
const abortedPersist = await persistScrapedSiteMedia(
  {},
  "web-1",
  {
    images: [{ url: YELP_PHOTO, platform: "yelp" }],
    platforms: vsaYelpHit(YELP_PHOTO),
  },
  {
    fetch: async () => {
      abortedFetches += 1;
      throw new Error("must not fetch after abort");
    },
    writeBack: false,
    onboarding: VSA_ONBOARDING,
    signal: aborted.signal,
  },
);
assert.equal(abortedFetches, 0);
assert.equal(abortedPersist.images[0].storagePath, undefined);

const liveHash = "a".repeat(64);
const liveAttested = {
  url: YELP_PHOTO,
  storagePath: `web-1/enrichment/${liveHash}.png`,
  mimeType: "image/png",
  width: 640,
  height: 480,
  contentHash: liveHash,
  provenance: {
    kind: "evidence",
    sourceUrl: YELP_PHOTO,
    platform: "yelp",
    storageBucket: "site-media",
  },
  proofEligible: true,
};
let liveFetches = 0;
const reusedLive = await persistScrapedSiteMedia(
  {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              enrichment_json: { images: [liveAttested], extra: "live-only" },
            },
            error: null,
          });
        },
      };
    },
  },
  "web-1",
  {
    images: [{ url: YELP_PHOTO, platform: "yelp" }],
    platforms: vsaYelpHit(YELP_PHOTO),
  },
  {
    fetch: async () => {
      liveFetches += 1;
      throw new Error("must reuse live attestation");
    },
    onboarding: VSA_ONBOARDING,
  },
);
assert.equal(liveFetches, 0);
assert.equal(reusedLive.images[0].storagePath, liveAttested.storagePath);
assert.equal(reusedLive.extra, undefined);

const sevenEvidence = Array.from({ length: 7 }, (_, i) => ({
  url: `https://images.squarespace-cdn.com/content/v1/abc/job-${i}.jpg`,
  alt: `job ${i}`,
}));
const generatedHero = {
  url: "https://generated.obra.invalid/web-1/generated/abc.jpg",
  storagePath: "web-1/generated/abc.jpg",
  mimeType: "image/jpeg",
  origin: "generated",
  alt: "Brand hero",
};
const cappedWithGenerated = curateProjectImages([...sevenEvidence, generatedHero]);
assert.equal(evidenceMediaItems(cappedWithGenerated).length, 6);
assert.equal(generatedMediaItems(cappedWithGenerated).length, 1);
assert.equal(cappedWithGenerated.at(-1)?.origin, "generated");
assert.equal(evidenceStillCount(cappedWithGenerated), 6);
assert.equal(
  evidenceStillCount(cappedWithGenerated, { requireUsablePersisted: true }),
  0,
  "legacy URL-only evidence remains visible but cannot suppress unified generation",
);
assert.equal(
  evidenceStillCount(
    [
      {
        url: SQUARESPACE_JOB,
        storagePath: "web-1/enrichment/a.jpg",
        mimeType: "image/jpeg",
        width: 1200,
        height: 800,
        contentHash: "a".repeat(64),
        provenance: { kind: "evidence", sourceUrl: SQUARESPACE_JOB, storageBucket: "site-media" },
        proofEligible: true,
      },
      { url: YELP_PHOTO, storagePath: "https://foreign.example/a.jpg", width: 1200, height: 800 },
      { url: "https://example.com/broken.jpg", storagePath: "web-1/enrichment/b.jpg" },
    ],
    { requireUsablePersisted: true },
  ),
  1,
);
assert.equal(isGeneratedMedia(generatedHero), true);

const onlyGenerated = curateProjectImages([generatedHero]);
assert.equal(evidenceStillCount(onlyGenerated), 0);
assert.equal(generatedMediaItems(onlyGenerated).length, 1);

const mixedEvidence = curateSiteEvidence({
  trade: "C-33",
  mediaGallery: [{ url: SQUARESPACE_JOB }, generatedHero],
});
assert.deepEqual(
  evidenceMediaItems(mixedEvidence.mediaGallery).map((item) => item.url),
  [SQUARESPACE_JOB],
);

const sectionOrder = await import(
  pathToFileURL(path.join(here, "../src/lib/agent/section-order.ts")).href
);
const idsWithoutPhotos = sectionOrder.sectionIdsForEvidence({
  trustMarkerCount: 0,
  imageCount: 0,
  reviewCount: 0,
});
assert.equal(idsWithoutPhotos.includes("beforeAfter"), false);

assert.equal(classifyListedWebsiteUrl(YELP_PROFILE)?.kind, "directory");
assert.equal(classifyListedWebsiteUrl(GOOGLE_MAPS)?.kind, "directory");
assert.equal(classifyListedWebsiteUrl("https://joeplumbing.com")?.kind, "custom");
assert.equal(classifyListedWebsiteUrl("joeplumbing.com")?.host, "joeplumbing.com");
assert.equal(classifyListedWebsiteUrl("https://foo.wixsite.com/site")?.kind, "builder");
assert.equal(classifyListedWebsiteUrl("https://acme.housecallpro.com")?.kind, "vendor");
assert.equal(classifyListedWebsiteUrl("https://bit.ly/abc")?.kind, "vendor");
assert.equal(classifyListedWebsiteUrl("https://acme.squarespace.com")?.kind, "builder");
assert.equal(classifyListedWebsiteUrl("not a url"), null);

console.log("verify-site-evidence: ok");
