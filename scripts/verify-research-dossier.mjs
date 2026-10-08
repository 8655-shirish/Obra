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

const dossierMod = await import(
  pathToFileURL(path.join(here, "../src/lib/admin/research-dossier.ts")).href
);
const traceMod = await import(
  pathToFileURL(path.join(here, "../src/lib/admin/format-enrichment-trace.server.ts")).href
);

const {
  buildResearchDossier,
  classifyListedWebsitePresence,
  deriveResearchJobState,
  listedWebsiteLine,
} = dossierMod;
const { formatEnrichmentTraceText } = traceMod;

const identity = { businessName: "Joe Plumbing", licenseNumber: "123456" };
const onboarding = { ...identity, trade: "plumbing", city: "Oakland" };

function hit(overrides = {}) {
  return {
    url: "https://www.yelp.com/biz/joe-plumbing",
    json: {
      business_name: "Joe Plumbing",
      rating: "4.8",
      review_count: "12",
      review_quotes: [{ quote: "Fixed our sink fast", author: "Ann" }],
      ...overrides.json,
    },
    ...overrides,
  };
}

function enrichmentFrom(platforms) {
  return { platforms };
}

const customFromHitUrl = classifyListedWebsitePresence(
  enrichmentFrom({
    Google: {
      results: [
        hit({
          url: "https://www.joeplumbing.com/",
          json: { business_name: "Joe Plumbing" },
        }),
      ],
    },
  }),
  identity,
  { researchStatus: "complete" },
);
assert.equal(customFromHitUrl.status, "listed");
assert.equal(customFromHitUrl.hosts[0].host, "joeplumbing.com");
assert.match(customFromHitUrl.headline, /Listed website: joeplumbing.com/);

const listingWebsiteIgnored = classifyListedWebsitePresence(
  enrichmentFrom({
    Yelp: {
      results: [
        hit({
          url: "https://www.yelp.com/biz/joe-plumbing",
          json: {
            business_name: "Joe Plumbing",
            website: "https://www.yelp.com/biz/joe-plumbing",
          },
        }),
      ],
    },
  }),
  identity,
  { researchStatus: "complete" },
);
assert.equal(listingWebsiteIgnored.status, "none");

const unmatchedWrongName = buildResearchDossier(
  enrichmentFrom({
    Google: {
      results: [
        {
          url: "https://acmeroofing.com",
          json: {
            business_name: "Acme Roofing",
            website: "https://acmeroofing.com",
          },
        },
      ],
    },
  }),
  onboarding,
  { researchStatus: "complete" },
);
assert.equal(unmatchedWrongName.listedWebsite.status, "none");
assert.equal(unmatchedWrongName.unmatchedHits.length, 1);
assert.equal(unmatchedWrongName.unmatchedHits[0].website, "https://acmeroofing.com");
assert.equal(unmatchedWrongName.reviews.length, 0);

const vendorSite = classifyListedWebsitePresence(
  enrichmentFrom({
    Google: {
      results: [
        hit({
          url: "https://www.google.com/maps/place/joe",
          json: {
            business_name: "Joe Plumbing",
            website: "https://acme.housecallpro.com/book",
          },
        }),
      ],
    },
  }),
  identity,
  { researchStatus: "complete" },
);
assert.equal(vendorSite.status, "listed");
assert.equal(vendorSite.hosts[0].kind, "vendor");
assert.match(vendorSite.headline, /Scheduling \/ vendor site/);

const builderSite = classifyListedWebsitePresence(
  enrichmentFrom({
    Google: {
      results: [
        hit({
          json: {
            business_name: "Joe Plumbing",
            website: "https://joe.wixsite.com/site",
          },
        }),
      ],
    },
  }),
  identity,
  { researchStatus: "complete" },
);
assert.equal(builderSite.hosts[0].kind, "builder");

const conflict = classifyListedWebsitePresence(
  enrichmentFrom({
    Google: {
      results: [
        hit({
          url: "https://joeplumbing.com",
          json: { business_name: "Joe Plumbing" },
        }),
      ],
    },
    Yelp: {
      results: [
        hit({
          json: {
            business_name: "Joe Plumbing",
            website: "https://joesplumbing.net",
          },
        }),
      ],
    },
  }),
  identity,
  { researchStatus: "complete" },
);
assert.equal(conflict.status, "conflict");
assert.equal(conflict.hosts.length, 2);

const running = classifyListedWebsitePresence({}, identity, {
  researchStatus: null,
  jobState: { hasActiveEnrichmentJobs: true, latestChainIncomplete: false },
});
assert.equal(running.status, "unknown_running");
assert.match(running.headline, /still running/);

const cancelled = classifyListedWebsitePresence(
  enrichmentFrom({
    Google: { results: [hit()] },
  }),
  identity,
  {
    researchStatus: null,
    jobState: { hasActiveEnrichmentJobs: false, latestChainIncomplete: true },
  },
);
assert.equal(cancelled.status, "unknown_incomplete");
assert.notEqual(cancelled.status, "none");

const notStarted = classifyListedWebsitePresence({}, identity, { researchStatus: null });
assert.equal(notStarted.status, "not_started");

const degradedNoInvent = classifyListedWebsitePresence(
  enrichmentFrom({
    Google: {
      extract_degraded: true,
      results: [
        {
          url: "https://www.google.com/maps/place/joe",
          markdown: "Visit https://secret-domain-from-markdown.com for more",
          json: { business_name: "Joe Plumbing" },
        },
      ],
    },
  }),
  identity,
  { researchStatus: "complete" },
);
assert.equal(degradedNoInvent.status, "none");
assert.equal(
  degradedNoInvent.hosts.some((host) => host.host.includes("secret-domain-from-markdown")),
  false,
);

const partialNone = classifyListedWebsitePresence(
  enrichmentFrom({
    Google: { no_results: true },
  }),
  identity,
  { researchStatus: "partial" },
);
assert.equal(partialNone.status, "none_partial");

const jobState = deriveResearchJobState([
  { status: "cancelled", chain_id: "c1" },
  { status: "completed", chain_id: "c1" },
]);
assert.equal(jobState.hasActiveEnrichmentJobs, false);
assert.equal(jobState.latestChainIncomplete, true);

const activeJobs = deriveResearchJobState([{ status: "running", chain_id: "c2" }]);
assert.equal(activeJobs.hasActiveEnrichmentJobs, true);

const built = buildResearchDossier(
  enrichmentFrom({
    Google: {
      results: [
        hit({
          url: "https://joeplumbing.com",
          json: {
            business_name: "Joe Plumbing",
            phone: "510-555-0100",
            address: "1 Main St",
            hours: "Monday 8:00 am - 5:00 pm",
            review_quotes: [{ quote: "Great plumber", author: "Sam" }],
            photo_urls: ["https://cdn.example.com/job.jpg"],
          },
        }),
        {
          url: "https://acmeroofing.com",
          json: { business_name: "Acme Roofing", website: "https://acmeroofing.com" },
        },
      ],
    },
  }),
  onboarding,
  { researchStatus: "complete" },
);
assert.equal(built.identity.phone, "510-555-0100");
assert.equal(built.reviews.length, 1);
assert.equal(built.images.length, 1);
assert.equal(built.unmatchedHits.length, 1);
assert.equal(built.listedWebsite.hosts[0].host, "joeplumbing.com");

const mixedHits = buildResearchDossier(
  enrichmentFrom({
    Google: {
      results: [
        {
          url: "https://acmeroofing.com",
          json: {
            business_name: "Acme Roofing",
            rating: "1",
            website: "acmeroofing.com",
          },
        },
        hit({
          url: "https://joeplumbing.com",
          json: {
            business_name: "Joe Plumbing",
            rating: "4.9",
            website: "joeplumbing.com",
          },
        }),
      ],
    },
  }),
  onboarding,
  { researchStatus: "complete" },
);
const googleCard = mixedHits.platforms.find((row) => row.platform === "Google");
assert.equal(googleCard?.businessName, "Joe Plumbing");
assert.equal(googleCard?.rating, "4.9");
assert.equal(googleCard?.website?.includes("joeplumbing.com"), true);
assert.equal(googleCard?.website?.startsWith("http"), true);
assert.equal(mixedHits.unmatchedHits[0].businessName, "Acme Roofing");

const firstHitExtractNotStolen = buildResearchDossier(
  enrichmentFrom({
    Google: {
      extract: {
        business_name: "Acme Roofing",
        website: "https://acmeroofing.com",
        rating: "1",
      },
      results: [
        {
          url: "https://acmeroofing.com",
          json: {
            business_name: "Acme Roofing",
            website: "https://acmeroofing.com",
            rating: "1",
          },
        },
        {
          url: "https://www.google.com/maps/place/Joe+Plumbing/123456",
          markdown: "License 123456",
        },
      ],
    },
  }),
  onboarding,
  { researchStatus: "complete" },
);
assert.equal(firstHitExtractNotStolen.listedWebsite.status, "none");
assert.equal(
  firstHitExtractNotStolen.listedWebsite.hosts.some((host) => host.host === "acmeroofing.com"),
  false,
);
const unmatchedAcme = firstHitExtractNotStolen.unmatchedHits.find(
  (row) => row.businessName === "Acme Roofing",
);
assert.equal(unmatchedAcme?.website, "https://acmeroofing.com");

const unmatchedDoesNotInheritMatchedExtract = buildResearchDossier(
  enrichmentFrom({
    Google: {
      extract: {
        business_name: "Joe Plumbing",
        website: "https://joeplumbing.com",
      },
      results: [
        hit({
          url: "https://joeplumbing.com",
          json: {
            business_name: "Joe Plumbing",
            website: "https://joeplumbing.com",
          },
        }),
        { url: "https://news.example.com/unrelated-article" },
      ],
    },
  }),
  onboarding,
  { researchStatus: "complete" },
);
assert.equal(unmatchedDoesNotInheritMatchedExtract.unmatchedHits.length, 1);
assert.equal(unmatchedDoesNotInheritMatchedExtract.unmatchedHits[0].businessName, undefined);
assert.equal(unmatchedDoesNotInheritMatchedExtract.unmatchedHits[0].website, undefined);
assert.equal(unmatchedDoesNotInheritMatchedExtract.unmatchedHits[0].url?.startsWith("http"), true);

const licenseOnlyQuotes = buildResearchDossier(
  enrichmentFrom({
    CSLB: {
      results: [
        {
          url: "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/LicenseDetail.aspx?LicNum=123456",
          markdown: "License 123456",
          json: {
            business_name: "Unrelated Roofing Co",
            rating: "5.0",
            review_quotes: [{ quote: "Directory pages are not customer reviews.", author: "Bot" }],
          },
        },
      ],
    },
  }),
  onboarding,
  { researchStatus: "complete" },
);
assert.equal(licenseOnlyQuotes.reviews.length, 0);
assert.equal(licenseOnlyQuotes.platforms.find((row) => row.platform === "CSLB")?.rating, undefined);

const traceText = formatEnrichmentTraceText(
  enrichmentFrom({
    Google: { results: [hit({ url: "https://joeplumbing.com" })] },
  }),
  { businessName: "Joe Plumbing", licenseNumber: "123456", researchStatus: "complete" },
);
assert.match(traceText, /Listed website: joeplumbing.com/);

assert.match(listedWebsiteLine(customFromHitUrl), /joeplumbing.com/);

const socialDossier = buildResearchDossier(
  enrichmentFrom({
    Facebook: {
      results: [
        hit({
          url: "https://www.facebook.com/joeplumbing",
          json: {
            business_name: "Joe Plumbing",
            facebook_url: "https://www.facebook.com/joeplumbing",
          },
        }),
      ],
    },
    Google: {
      results: [
        hit({
          url: "https://www.google.com/maps/place/joe",
          json: {
            business_name: "Joe Plumbing",
            instagram_url: "https://www.instagram.com/joeplumbing",
            website: "https://joeplumbing.com",
          },
        }),
      ],
    },
  }),
  onboarding,
  { researchStatus: "complete" },
);
assert.equal(
  socialDossier.social.some((link) => link.platform === "Facebook" && link.url.includes("facebook.com")),
  true,
);
assert.equal(
  socialDossier.social.some((link) => link.platform === "Instagram" && link.url.includes("instagram.com")),
  true,
);

console.log("verify-research-dossier: ok");
