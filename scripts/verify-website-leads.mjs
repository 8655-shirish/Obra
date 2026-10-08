import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(here, "..", relative), "utf8");
const server = read("src/lib/leads.functions.ts");
const migration = read("supabase/migrations/20260829093901_starter_website_leads.sql");
const route = read("src/routes/leads.tsx");
const publicRoute = read("src/routes/lp/$websiteId.tsx");
const publicReadiness = read("src/lib/booking-availability.server.ts").split(
  "export async function loadLiveBookingSettings",
)[0];
const unknownReadiness = read("src/lib/booking-readiness.server.ts").match(
  /export function unknownBookingReadiness\([\s\S]*?\n\}/,
)?.[0];
const workspace = read("src/lib/jobs.functions.ts");
const factsReader = read("src/lib/booking-readiness.server.ts").split(
  "export async function loadBookingReadinessFacts",
)[1];

assert.match(server, /MAX_FIELDS = 20/);
assert.match(server, /MAX_FIELD_LENGTH = 2_000/);
assert.match(server, /MAX_TOTAL_LENGTH = 12_000/);
assert.ok(server.includes('createHmac("sha256"'));
assert.ok(server.includes('process.env["LEAD_RATE_LIMIT_SECRET"]'));
assert.ok(server.includes('process.env["SUPABASE_SERVICE_ROLE_KEY"]'));
assert.ok(server.includes('headers.get("cf-connecting-ip")'));
assert.doesNotMatch(server, /x-forwarded-for/);
assert.doesNotMatch(server, /local-lead-rate-limit/);
assert.ok(server.includes('.from("website_entitlements")'));
assert.ok(server.includes('.in("state", ["active", "grace"])'));
assert.ok(server.includes('.eq("quote_admission", true)'));
assert.ok(server.includes("submit_starter_website_lead"));
assert.ok(server.includes('.eq("user_id", profile.id)'));
assert.match(
  server,
  /order\("submitted_at", \{ ascending: false \}\)[\s\S]*?order\("id", \{ ascending: false \}\)/,
);
assert.doesNotMatch(server, /getLeadsPage[\s\S]*?validator[^;]*profileId/);

assert.ok(migration.toLowerCase().includes("foreign key (website_id, user_id)"));
assert.match(migration, /security definer/i);
assert.ok(migration.includes("set search_path = ''"));
assert.doesNotMatch(migration, /jsonb_array_pg_catalog/);
assert.ok(migration.includes("on delete restrict"));
assert.ok(migration.includes("where submitted_at is null"));
assert.ok(migration.includes("revoke insert, update, delete, truncate on public.leads"));
assert.doesNotMatch(migration, /admit_starter_lead_attempt/);
assert.doesNotMatch(server, /admit_starter_lead_attempt/);
assert.ok(
  migration.indexOf("select l.id into v_lead_id") <
    migration.indexOf("select w.user_id, p.license_number"),
);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /lead_submission_attempts/);
assert.match(migration, /join public.website_entitlements/);
assert.ok(migration.includes("e.state in ('active', 'grace')"));
assert.ok(migration.includes("e.quote_admission = true"));
assert.match(migration, /grant execute[\s\S]*to service_role/i);
assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);

assert.ok(route.includes('createFileRoute("/leads")'));
assert.match(route, /Not supplied/);
assert.match(route, /DialogTitle/);
assert.match(route, /Load more leads/);
assert.match(route, /Website Leads/);
assert.ok(workspace.includes('.eq("profile_id", access.profileId)'));
assert.ok(workspace.includes('.in("state", ["active", "grace"])'));
assert.ok(workspace.includes('.eq("quote_admission", true)'));
assert.match(workspace, /Boolean\(starterEntitlement\)[\s\S]*?leadCount/);
assert.ok(publicRoute.includes('await import("@/lib/booking-availability.server")'));
assert.ok(publicRoute.includes("const readiness = await loadPublicBookingReadiness({"));
assert.ok(publicReadiness.includes('from "@/lib/booking-readiness.server"'));
assert.match(
  publicReadiness,
  /try \{\s*facts = await loadBookingReadinessFacts\(input\);\s*\} catch \{\s*return unknownBookingReadiness\(input\);\s*\}/,
);
assert.doesNotMatch(factsReader, /withWorkerDeadline/);
assert.doesNotMatch(workspace, /withWorkerDeadline/);
assert.ok(factsReader.includes("optionalCalendarObservation"));
assert.ok(unknownReadiness);
for (const marker of [
  "entitlement: null",
  "serviceActive: false",
  "scheduleActive: false",
  'calendarState: "restricted"',
  'paymentsState: "restricted"',
  "showDemo: false",
  'publicMode: "unavailable"',
  "providerRefreshEligible: false",
  'reasonCodes: ["booking_readiness_unknown"]',
])
  assert.ok(unknownReadiness.includes(marker), "unknown readiness must deny admission: " + marker);
assert.ok(publicReadiness.includes("!facts.providerRefreshEligible"));
assert.doesNotMatch(factsReader, /unknownBookingReadiness/);
assert.equal((factsReader.match(/\.from\("website_entitlements"\)/g) ?? []).length, 1);
assert.ok(factsReader.includes("entitlement: entitlement.data"));
assert.ok(factsReader.includes('calendarUnknown ? ["booking_readiness_unknown"]'));
assert.match(factsReader, /calendarState:\s*calendarUnknown\s*\? "restricted"/);
assert.ok(factsReader.includes("!calendarUnknown &&"));
assert.match(
  publicReadiness,
  /if \(cutoverError \|\| typeof cutover !== "boolean"\)\s*return unavailable\(facts, "booking_readiness_unknown", true\)/,
);
assert.match(
  publicReadiness,
  /if \(!cutover\) \{\s*settledFacts = unavailable\(facts, "booking_cutover_unavailable"\);\s*return settledFacts;/,
);
assert.ok(
  factsReader.includes('...(configurationIneligible ? ["booking_configuration_ineligible"] : [])'),
);
assert.ok(publicRoute.includes('"booking_cutover_unavailable"'));
assert.ok(
  publicRoute.indexOf('"booking_configuration_ineligible"') <
    publicRoute.indexOf('readiness.reasonCodes.includes("booking_readiness_unknown")'),
);
assert.ok(publicReadiness.includes("allowRepair: false"));
assert.ok(publicReadiness.includes("const current = await loadBookingReadinessFacts(input)"));
assert.ok(publicReadiness.includes("settledFacts = current"));
assert.ok(
  publicReadiness.includes('return unavailable(current, "booking_readiness_unknown", true)'),
);
assert.ok(publicReadiness.includes("return current"));
assert.ok(publicRoute.includes("readiness.showLeadForm"));
assert.ok(publicRoute.includes("showLeadForm: readiness.showLeadForm"));

console.log("verify-website-leads: ok");
