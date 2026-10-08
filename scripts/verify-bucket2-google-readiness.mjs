import fs from "node:fs";
const migration = fs.readFileSync(
  "supabase/migrations/20260829093908_bucket2_google_readiness.sql",
  "utf8",
);
const readiness = fs.readFileSync("src/lib/google-calendar-readiness.ts", "utf8");
const server = fs.readFileSync("src/lib/booking-readiness.server.ts", "utf8");
const forbidden = ["api.pipedream.com", "x-pd-signature", "deploy_trigger", "create_event"];
const required = [
  "account_email text",
  "connection_revision bigint",
  "permission_verified_at timestamptz",
  "assert_google_calendar_selection_invariants",
  "At least one readable blocking calendar is required",
  "Exactly one writable booking destination is required",
  "persist_google_calendar_configuration",
  "reconcile_google_calendar_connection",
  "clear_google_calendar_connection",
  "Contractor is not authorized for this profile",
  "p_expected_revision",
  "grant execute on function public.persist_google_calendar_configuration",
];
const failures = [];
for (const fragment of required)
  if (!migration.includes(fragment)) failures.push("migration: " + fragment);
for (const fragment of forbidden)
  if (migration.includes(fragment)) failures.push("invented provider schema: " + fragment);
for (const fragment of [
  "google_connection_degraded",
  "google_connection_disconnected",
  "google_no_readable_blocking_calendar",
  "google_multiple_writable_destinations",
])
  if (!readiness.includes(fragment)) failures.push("projection: " + fragment);
for (const fragment of [
  "projectGoogleCalendarReadiness",
  "googleCalendar.reasons",
  "verification_reason",
])
  if (!server.includes(fragment)) failures.push("server projection: " + fragment);
if (failures.length) {
  console.error("Bucket 2 Google readiness verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("verify-bucket2-google-readiness: bounded provider foundation present");
