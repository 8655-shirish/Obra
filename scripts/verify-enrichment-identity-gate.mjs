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

const schemaMod = await import(
  pathToFileURL(path.join(here, "../src/lib/enrichment/enrichment-schema.server.ts")).href
);
const firecrawlMod = await import(
  pathToFileURL(path.join(here, "../src/lib/integrations/firecrawl.server.ts")).href
);
const dossierMod = await import(
  pathToFileURL(path.join(here, "../src/lib/admin/research-dossier.ts")).href
);
const factMod = await import(pathToFileURL(path.join(here, "../src/lib/site-fact-sheet.ts")).href);

const { mapPlatformPartialToSchema, schemaFromMatchedPlatforms } = schemaMod;
const { extractImagesFromPlatformPartial, imagesFromMatchedPlatforms } = firecrawlMod;
const { buildResearchDossier, classifyListedWebsitePresence, platformCardForAgent } = dossierMod;
const { buildFactSheet } = factMod;

const onboarding = {
  businessName: "International Waterproofing & Roofing",
  licenseNumber: "999999",
  trade: "roofing",
  city: "Los Angeles",
};

const identity = {
  businessName: onboarding.businessName,
  licenseNumber: onboarding.licenseNumber,
};

const unmatchedHouzz = {
  results: [
    {
      url: "https://www.houzz.com/professionals/interior-designers/hope-pinc-design",
      markdown:
        "Hope Pinc Design transformed our living room with a thoughtful palette and custom millwork throughout the house.",
      json: {
        business_name: "Hope Pinc Design",
        rating: "4.9",
        review_count: "18",
        review_quotes: [{ quote: "Hope Pinc made our house a home.", author: "Dana" }],
        photo_urls: ["https://cdn.houzz.com/hope-pinc.jpg"],
      },
    },
  ],
};

const unmatchedGoogleArts = {
  results: [
    {
      url: "https://artsandculture.google.com/",
      markdown:
        "Explore collections from museums around the world. Sign in to save your favorite works and continue browsing related artists.",
      json: {
        business_name: "Google Arts & Culture",
        review_quotes: [
          {
            quote:
              "Explore collections from museums around the world and save your favorite works.",
            author: "Visitor",
          },
        ],
        photo_urls: ["https://cdn.google.com/arts.jpg"],
      },
    },
  ],
};

const matchedYelp = {
  results: [
    unmatchedHouzz.results[0],
    {
      url: "https://www.yelp.com/biz/international-waterproofing",
      json: {
        business_name: "International Waterproofing & Roofing",
        rating: "4.7",
        review_count: "32",
        review_quotes: [{ quote: "Roof stayed dry through the first storm.", author: "Chris" }],
        photo_urls: ["https://cdn.yelp.com/iwr.jpg"],
      },
    },
  ],
};

const licenseOnlyCslb = {
  results: [
    {
      url: "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=999999",
      markdown: "License 999999 International Waterproofing",
      json: {
        business_name: "Some Other Contractor Inc",
        rating: "5.0",
        review_count: "99",
        phone: "555-010-9999",
        address: "1 License Way, Sacramento, CA",
        review_quotes: [{ quote: "Directory page is not a customer review.", author: "Bot" }],
        photo_urls: ["https://cdn.cslb.ca.gov/badge.png"],
      },
    },
  ],
};

const unmatchedPatch = mapPlatformPartialToSchema("Houzz", unmatchedHouzz, onboarding);
assert.equal(unmatchedPatch.reviews_recent_quote_1, undefined);
assert.equal(unmatchedPatch.houzz_rating, undefined);
assert.equal(unmatchedPatch.business_name, onboarding.businessName);

const googleArtsPatch = mapPlatformPartialToSchema("Google", unmatchedGoogleArts, onboarding);
assert.equal(googleArtsPatch.reviews_recent_quote_1, undefined);
assert.equal(googleArtsPatch.google_rating, undefined);

const matchedPatch = mapPlatformPartialToSchema("Yelp", matchedYelp, onboarding);
assert.equal(matchedPatch.reviews_recent_quote_1, "Roof stayed dry through the first storm.");
assert.equal(matchedPatch.yelp_rating, "4.7");
assert.equal(matchedPatch.business_name, "International Waterproofing & Roofing");

const licenseQuotes = mapPlatformPartialToSchema("CSLB", licenseOnlyCslb, onboarding);
assert.equal(licenseQuotes.reviews_recent_quote_1, undefined);
assert.equal(licenseQuotes.reviews_average_rating, undefined);
assert.equal(licenseQuotes.reviews_total_count, undefined);
assert.equal(licenseQuotes.business_name, onboarding.businessName);
assert.equal(licenseQuotes.cslb_phone, "555-010-9999");
assert.equal(licenseQuotes.contact_phone, "555-010-9999");

const licenseOnlyGoogle = {
  results: [
    {
      url: "https://www.google.com/maps/search/?api=1&query=999999",
      markdown: "License 999999 appears in this directory result.",
      json: {
        business_name: "Hope Pinc Design",
        rating: "4.9",
        review_count: "18",
        phone: "555-000-1111",
        address: "9 Unrelated Ave, Los Angeles, CA",
        website: "https://hopepinc.example",
        review_quotes: [
          { quote: "License pages are not this contractor's reviews.", author: "Bot" },
        ],
      },
    },
  ],
};
const licenseGoogle = mapPlatformPartialToSchema("Google", licenseOnlyGoogle, onboarding);
assert.equal(licenseGoogle.google_rating, undefined);
assert.equal(licenseGoogle.google_review_count, undefined);
assert.equal(licenseGoogle.google_name, undefined);
assert.equal(licenseGoogle.google_phone, undefined);
assert.equal(licenseGoogle.google_address, undefined);
assert.equal(licenseGoogle.google_maps_url, undefined);
assert.equal(licenseGoogle.google_website, undefined);
assert.equal(licenseGoogle.contact_phone, undefined);
assert.equal(licenseGoogle.website_url, undefined);
assert.equal(licenseGoogle.reviews_average_rating, undefined);
assert.equal(licenseGoogle.reviews_recent_quote_1, undefined);

assert.deepEqual(extractImagesFromPlatformPartial("Houzz", unmatchedHouzz, identity), []);
assert.equal(
  extractImagesFromPlatformPartial("Yelp", matchedYelp, identity)[0]?.url,
  "https://cdn.yelp.com/iwr.jpg",
);

const dirtySchema = {
  schema: {
    reviews_recent_quote_1: "Hope Pinc made our house a home.",
    houzz_rating: "4.9",
  },
  platforms: { Houzz: unmatchedHouzz, Google: unmatchedGoogleArts },
  images: [{ url: "https://cdn.houzz.com/hope-pinc.jpg", platform: "Houzz" }],
};
const rebuilt = schemaFromMatchedPlatforms(dirtySchema, onboarding);
assert.equal(rebuilt.reviews_recent_quote_1, null);
assert.equal(rebuilt.houzz_rating, null);
assert.deepEqual(imagesFromMatchedPlatforms(dirtySchema, identity), []);

const dossier = buildResearchDossier(dirtySchema, onboarding, { researchStatus: "complete" });
assert.equal(dossier.reviews.length, 0);
assert.equal(dossier.images.length, 0);
assert.ok(dossier.unmatchedHits.length >= 1);

const licenseDossier = buildResearchDossier({ platforms: { CSLB: licenseOnlyCslb } }, onboarding, {
  researchStatus: "complete",
});
assert.equal(licenseDossier.reviews.length, 0);
assert.equal(licenseDossier.platforms.find((row) => row.platform === "CSLB")?.rating, undefined);
assert.equal(licenseDossier.identity.phone, "555-010-9999");

const licenseGoogleDossier = buildResearchDossier(
  { platforms: { Google: licenseOnlyGoogle } },
  onboarding,
  { researchStatus: "complete" },
);
assert.equal(licenseGoogleDossier.reviews.length, 0);
assert.equal(
  licenseGoogleDossier.platforms.find((row) => row.platform === "Google")?.rating,
  undefined,
);
assert.equal(licenseGoogleDossier.identity.phone, null);
const googleCard = licenseGoogleDossier.platforms.find((row) => row.platform === "Google");
assert.equal(googleCard?.businessName, "Hope Pinc Design");
const agentGoogle = platformCardForAgent(googleCard, onboarding.businessName);
assert.equal(agentGoogle.businessName, undefined);
assert.equal(agentGoogle.phone, undefined);
assert.equal(
  classifyListedWebsitePresence({ platforms: { Google: licenseOnlyGoogle } }, identity, {
    researchStatus: "complete",
  }).hosts.length,
  0,
);

const sheet = buildFactSheet(onboarding, dirtySchema);
assert.equal(sheet.reviews.length, 0);
assert.equal(
  sheet.trustMarkers.some((marker) => marker.kind === "google" || marker.kind === "houzz"),
  false,
);

const licenseGoogleSheet = buildFactSheet(onboarding, { platforms: { Google: licenseOnlyGoogle } });
assert.equal(
  licenseGoogleSheet.trustMarkers.some((marker) => marker.kind === "google"),
  false,
);
assert.ok(licenseGoogleSheet.trustMarkers.some((marker) => marker.kind === "license"));
assert.equal(licenseGoogleSheet.phone, null);

const licenseCslbSheet = buildFactSheet(onboarding, { platforms: { CSLB: licenseOnlyCslb } });
assert.equal(licenseCslbSheet.phone, "555-010-9999");

const matchedSheet = buildFactSheet(onboarding, { platforms: { Yelp: matchedYelp } });
assert.equal(matchedSheet.reviews.length, 1);
assert.equal(matchedSheet.reviews[0].quote, "Roof stayed dry through the first storm.");
assert.ok(matchedSheet.trustMarkers.some((marker) => marker.kind === "yelp"));

const socialFromListing = mapPlatformPartialToSchema(
  "Google",
  {
    results: [
      {
        url: "https://www.google.com/maps/place/International+Waterproofing",
        json: {
          business_name: "International Waterproofing & Roofing",
          facebook_url: "https://www.facebook.com/iwr",
          instagram_url: "https://www.instagram.com/iwr",
          website: "https://iwr.example",
        },
      },
    ],
  },
  onboarding,
);
assert.equal(socialFromListing.facebook_url, "https://www.facebook.com/iwr");
assert.equal(socialFromListing.instagram_url, "https://www.instagram.com/iwr");
assert.equal(socialFromListing.website_url, "https://iwr.example");

console.log("verify-enrichment-identity-gate: ok");
