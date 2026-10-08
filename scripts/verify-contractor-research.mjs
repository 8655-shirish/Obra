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

const csvMod = await import(
  pathToFileURL(path.join(here, "../src/lib/admin/contractor-research-csv.ts")).href
);
const subjectMod = await import(
  pathToFileURL(path.join(here, "../src/lib/jobs/enrichment-subject.ts")).href
);

const {
  parseContractorResearchCsv,
  researchIdentityFromCells,
  onboardingFromResearchCells,
  assertCsvFilename,
  ContractorResearchCsvError,
} = csvMod;
const { enrichmentSubjectFromJob } = subjectMod;

function quotedNameCsv(rowCount) {
  const preamble = [
    "Contractors State License Board",
    "",
    "Disclaimer: this is not a table",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
  const header = "BusinessName,Address,City,State,ZipCode,License,PhoneNumber";
  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    rows.push(
      `"ADL ROOFING SOLUTIONS, INC",123 Main,San Francisco,CA,94110,${100000 + i},415-555-0100`,
    );
  }
  return [...preamble, header, ...rows].join("\n");
}

const parsed = parseContractorResearchCsv(quotedNameCsv(72));
assert.equal(parsed.headers[0], "BusinessName");
assert.equal(parsed.headers.includes("License"), true);
assert.equal(parsed.rows.length, 72);
assert.equal(parsed.rows[0].BusinessName, "ADL ROOFING SOLUTIONS, INC");
assert.equal(parsed.rows[0].License, "100000");
assert.equal(parsed.rows[0].City, "San Francisco");

const identity = researchIdentityFromCells(parsed.rows[0]);
assert.equal(identity.ok, true);
assert.equal(identity.businessName, "ADL ROOFING SOLUTIONS, INC");
assert.equal(identity.licenseNumber, "100000");

const onboarding = onboardingFromResearchCells(parsed.rows[0]);
assert.equal(onboarding.trade, "");
assert.deepEqual(onboarding.services, []);
assert.equal(onboarding.businessName, "ADL ROOFING SOLUTIONS, INC");

const blankIdentity = researchIdentityFromCells({ BusinessName: "  ", License: "123" });
assert.equal(blankIdentity.ok, false);

assert.throws(() => assertCsvFilename("list.xlsx"), ContractorResearchCsvError);
assert.throws(
  () => parseContractorResearchCsv("not a contractor list\n"),
  ContractorResearchCsvError,
);
assert.throws(() => parseContractorResearchCsv(quotedNameCsv(201)), ContractorResearchCsvError);

assert.deepEqual(enrichmentSubjectFromJob({ website_id: "site-1", research_row_id: null }), {
  kind: "website",
  websiteId: "site-1",
});
assert.deepEqual(enrichmentSubjectFromJob({ website_id: null, research_row_id: "row-1" }), {
  kind: "research_row",
  researchRowId: "row-1",
});
assert.throws(() => enrichmentSubjectFromJob({ website_id: "site-1", research_row_id: "row-1" }));
assert.throws(() => enrichmentSubjectFromJob({ website_id: null, research_row_id: null }));

const migration = fs.readFileSync(
  path.join(here, "../supabase/migrations/20260912220000_contractor_research_sheets.sql"),
  "utf8",
);
assert.match(migration, /background_jobs_subject_xor/);
assert.match(migration, /job_type = 'enrichment_platform'/);
assert.match(migration, /\(\(website_id is not null\) <> \(research_row_id is not null\)\)/);
assert.match(migration, /job_type <> 'enrichment_platform'/);
assert.match(migration, /website_id is not null/);
assert.match(migration, /research_row_id is null/);
assert.match(migration, /background_jobs_website_chain_idempotency_uk/);
assert.match(migration, /background_jobs_research_row_chain_idempotency_uk/);
assert.match(
  migration,
  /revoke all on public\.contractor_research_sheets from public, anon, authenticated/,
);
assert.match(migration, /left join public.websites website on website.id=candidate.website_id/);
assert.match(migration, /candidate.research_row_id is not null or website.id is not null/);
assert.doesNotMatch(
  migration.slice(
    migration.lastIndexOf("create or replace function public.claim_next_background_job"),
  ),
  /\n\s+join public.websites website on website.id=candidate.website_id/,
);

const enqueueSrc = fs.readFileSync(path.join(here, "../src/lib/jobs/enqueue.server.ts"), "utf8");
assert.match(enqueueSrc, /applyEnrichmentSubjectFilter/);
assert.match(enqueueSrc, /research_row_id: subject\.researchRowId/);
assert.match(enqueueSrc, /cancelActiveJobChains\(supabase, subject, JOB_TYPE_ENRICHMENT\)/);
assert.equal(enqueueSrc.includes('.eq("website_id", websiteId)'), false);

const executeSrc = fs.readFileSync(path.join(here, "../src/lib/jobs/execute.server.ts"), "utf8");
assert.match(executeSrc, /enrichmentSubjectFromJob/);
assert.match(executeSrc, /onboardingFromResearchCells/);
assert.match(executeSrc, /persistScrapedSiteMedia/);
assert.match(executeSrc, /subject\.kind === "website"/);
assert.doesNotMatch(executeSrc, /await persistScrapedSiteMedia\(supabase, job\.website_id/);

const mergeSrc = fs.readFileSync(
  path.join(here, "../src/lib/jobs/enrichment-merge.server.ts"),
  "utf8",
);
assert.match(mergeSrc, /contractor_research_rows/);
assert.match(mergeSrc, /subject\.kind === "website"/);

const firecrawlSrc = fs.readFileSync(
  path.join(here, "../src/lib/integrations/firecrawl.server.ts"),
  "utf8",
);
assert.match(firecrawlSrc, /facebook_url/);
assert.match(firecrawlSrc, /instagram_url/);
assert.match(firecrawlSrc, /Facebook page URL if listed/);

const uiSrc = fs.readFileSync(
  path.join(here, "../src/components/admin/ContractorResearchWorkspace.tsx"),
  "utf8",
);
assert.match(uiSrc, /<img/);
assert.match(uiSrc, /image\.displayUrl/);
assert.match(uiSrc, /unmatchedHits/);
assert.match(uiSrc, /Existing website/);
assert.match(uiSrc, /Social pages/);
assert.doesNotMatch(uiSrc, /adminKickoff|WorkspaceShell|ResearchDossierSheet/);

const routeSrc = fs.readFileSync(
  path.join(here, "../src/routes/admin_.contractor-research.tsx"),
  "utf8",
);
assert.match(routeSrc, /AdminGate/);
assert.match(routeSrc, /ContractorResearchWorkspace/);

const fnSrc = fs.readFileSync(
  path.join(here, "../src/lib/admin-contractor-research.functions.ts"),
  "utf8",
);
assert.match(fnSrc, /enqueueEnrichmentChain/);
assert.match(fnSrc, /researchRowSubject/);
assert.doesNotMatch(fnSrc, /personalize_template|ensureTemplateSeeded/);
assert.doesNotMatch(fnSrc, /if \(sheet\.original_filename\)/);

console.log("verify-contractor-research: ok");
