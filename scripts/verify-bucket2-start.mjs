import fs from "node:fs";

const client = fs.readFileSync("src/lib/pipedream.server.ts", "utf8");
const commands = fs.readFileSync("src/lib/booking-provider.functions.ts", "utf8");
const calendarState = fs.readFileSync("src/lib/google-calendar-state.server.ts", "utf8");
const calendarSql = fs.readFileSync(
  "supabase/migrations/20260910120000_google_calendar_lifetime.sql",
  "utf8",
);
const bookingCalendarSql = fs.readFileSync(
  "supabase/migrations/20260910130000_booking_calendar_lifetime.sql",
  "utf8",
);
const cookies = fs.readFileSync("src/lib/auth/cookies.server.ts", "utf8");
const readiness = fs.readFileSync("src/lib/booking-readiness.server.ts", "utf8");
const auth = fs.readFileSync("src/lib/provider-authorization.server.ts", "utf8");
const complete = fs.readFileSync("src/lib/google-calendar-complete.ts", "utf8");
const cards = fs.readFileSync("src/components/purchaser/SetupStepCards.tsx", "utf8");
const env = fs.readFileSync(".env.example", "utf8");
const failures = [];
const requireAll = (name, source, fragments) => {
  for (const fragment of fragments)
    if (!source.includes(fragment)) failures.push(name + ": " + fragment);
};
requireAll("Pipedream OAuth boundary", client, [
  "https://api.pipedream.com/v1/oauth/token",
  '"x-pd-environment"',
  "Date.now() + 60_000",
  "PIPEDREAM_CLIENT_SECRET",
]);
requireAll("tenant identity", client, [
  "obra:${environment}:${profileId}",
  "PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG",
  "account.app.name_slug === appSlug",
]);
requireAll("redirect safety", client, [
  'url.protocol !== "https:"',
  'url.hostname.endsWith(".pipedream.com")',
  "allowed_origins: [origin]",
  'url.pathname !== "/"',
]);
// Cloudflare Workers rejects redirect:"error" before any network I/O while Node
// suites accept it, so the forbidden mode is asserted absent on every transport.
const transports = {
  "pipedream transport": client,
  "worker transport": fs.readFileSync("src/lib/worker-deadline.server.ts", "utf8"),
  "stripe transport": fs.readFileSync("src/lib/stripe-connect.server.ts", "utf8"),
  "notification transport": fs.readFileSync("src/lib/booking-notifications.server.ts", "utf8"),
  "observability transport": fs.readFileSync("src/lib/calendar-observability.server.ts", "utf8"),
  "attachment transport": fs.readFileSync("src/lib/booking-attachments.functions.ts", "utf8"),
  "remote-media transport": fs.readFileSync("src/lib/media/safe-remote-media.server.ts", "utf8"),
};
for (const [name, source] of Object.entries(transports)) {
  if (source.includes('redirect: "error"'))
    failures.push("Workers fetch compatibility (" + name + "): forbidden redirect mode");
  if (source.includes('redirect: "follow"'))
    failures.push("Workers fetch compatibility (" + name + "): bearer fetch must not follow");
  if (!source.includes('redirect: "manual"'))
    failures.push("Workers fetch compatibility (" + name + "): manual redirect mode required");
}
requireAll("provider authorization", auth, [
  "getContractorAuthUserId",
  '.eq("user_id", profile.id)',
  "requireCurrentActiveConfirmedPro",
  "hasCurrentActiveConfirmedPro",
  '.eq("environment", profile.environment)',
]);
requireAll("OAuth return completes", commands, [
  "completeGoogleCalendarConnection",
  "listGoogleAccounts(profile.id, environment)",
  "!accounts.length && attempt < 4 && Date.now() + 4_000 < deadlineAt",
  "accounts = await withPipedreamDeadline(deadlineAt - 3_000",
  "pickGoogleAccountForCompletion",
  "pickWritableBookingCalendar",
  "googleAccountEmail",
  "await verifySavedTrigger({ profileId: profile.id, environment, deadlineAt })",
  "configureGoogleCalendarTrigger",
]);
requireAll("saved calendar verification", commands, [
  "await refreshSavedGoogleCalendar({ ...input, allowRepair: true })",
  'binding?.trigger_state !== "active"',
  "!binding.last_health_at",
  "Date.parse(binding.last_health_at) < Date.now() - 15 * 60_000",
]);
requireAll("canonical calendar readiness", readiness, [
  "const googleCalendar = projectGoogleCalendarReadiness({",
  '...(pendingSetup ? ["google_setup_pending"] : [])',
  '...(calendarUnknown ? ["booking_readiness_unknown"] : googleCalendar.reasons)',
  "!calendarUnknown &&",
]);
if (
  !/calendarState:\s*calendarUnknown\s*\? "restricted"\s*: pendingSetup\s*\? "pending"\s*: googleCalendar\.state/.test(
    readiness,
  )
)
  failures.push(
    "unknown calendar observations must restrict readiness before pending/healthy projection",
  );
requireAll("operator configuration", env, [
  "PIPEDREAM_CLIENT_ID=",
  "PIPEDREAM_CLIENT_SECRET=",
  "PIPEDREAM_PROJECT_ID=",
  "PIPEDREAM_GOOGLE_CALENDAR_APP_SLUG=",
  "PUBLIC_APP_URL=",
]);
requireAll("one calendar complete path", complete + commands, [
  "pickWritableBookingCalendar",
  "reserveGoogleCalendarSetupProbe",
  "runGoogleCalendarSetupProbe",
  "expectedRevision",
  "listGoogleCalendars",
  "accountEmail",
]);
requireAll("fenced setup persistence", calendarState, [
  "await persistVerifiedGoogleCalendarConfiguration({",
  '"persist_google_calendar_configuration"',
  "p_setup_operation_id: input.probe.id",
  "p_lease_token: input.leaseToken",
  "p_fencing_token: input.probe.fencing_token",
]);
requireAll("connect operation cookie", commands, [
  "const operationId = randomUUID()",
  '"authorize_google_calendar_connect_start"',
  "p_operation_id: operationId",
  "p_actor_auth_user_id: authUserId",
  "{ revealOwnerFailure: true }",
  "deadlineAt - REQUEST_TIMEOUT_MS",
  "serializeCookie(`obra_google_connect_${profile.id}_${website.environment}`, operationId",
  "maxAge: 900",
  "getCookie(`obra_google_connect_${profile.id}_${environment}`)",
  "if (!operationId || !z.string().uuid().safeParse(operationId).success)",
  '"authorize_google_calendar_connect_completion"',
  "expectedRevision: data.expectedRevision",
  "p_expected_setup_key: input.expectedSetupKey ?? null",
]);
requireAll("owner connect-start outcome", calendarState + commands + cards + calendarSql, [
  "revealOwnerFailure",
  "Google Connect was recently started; retry shortly",
  "error instanceof Error",
  "Unable to open Google setup. Please try again. [client-non-error]",
  "[rpc-settle]",
  "[pd-temporary",
  "[pd-platform",
  "[non-error typeof=",
  "/aborted=${error.aborted === true}",
  "options?.revealOwnerFailure ? budget : Math.min(budget, 5_000)",
  "error.name !== \"AbortError\"",
  "error.name !== \"TimeoutError\"",
]);
requireAll("owner Connect link is a one-shot mutation", client, [
  '{ attempts: 1 },\n  )) as { connect_link_url?: unknown; expires_at?: unknown }',
  "accessToken({ attempts: options.attempts })",
  "aborted?: boolean",
]);
requireAll("Pipedream request timeout export", client, ["export const REQUEST_TIMEOUT_MS = 10_000"]);
requireAll("connect operation authority", calendarSql, [
  "c.connect_operation_id is distinct from p_operation_id",
  "c.connect_actor_auth_user_id is distinct from p_actor_auth_user_id",
  "c.connect_expires_at<=pg_catalog.clock_timestamp()",
  "c.connect_expected_revision is distinct from c.connection_revision",
  "coalesce(c.connection_revision,0)<>p_expected_revision",
  "p_expected_setup_key is distinct from public.google_calendar_setup_configuration_key(c)",
  "c.connect_expected_setup_key is distinct from public.google_calendar_setup_configuration_key(c)",
  "'google_calendar_setup_claim','google_calendar_setup_configuration_key'",
]);
requireAll("private setup denial authority", bookingCalendarSql, [
  "revoke all on function public.record_booking_calendar_setup_denial(uuid,text,uuid,uuid,bigint,text,timestamptz)\n  from public,anon,authenticated,service_role,booking_worker",
  "c.setup_lease_token is distinct from p_lease_token or c.setup_fencing_token is distinct from p_fencing_token",
  "c.setup_expected_revision is distinct from c.connection_revision",
  "c.setup_probe_delete_started_at is null",
]);
if (
  /grant execute[^;]*public\.(?:google_calendar_setup_configuration_key|record_booking_calendar_setup_denial)\(/i.test(
    calendarSql + "\n" + bookingCalendarSql,
  )
)
  failures.push("private setup helpers must not receive client execution grants");
requireAll("HttpOnly connect cookie", cookies, [
  'if (options.httpOnly !== false) parts.push("HttpOnly")',
]);
requireAll("purchaser calendar card", cards, [
  "completeGoogleCalendarConnection({ data: { websiteId } })",
  'connect !== "success" && connect !== "error"',
  'if (!canConfigure || connect === "error")',
  "handledRef.current === connect",
  "if (requestScope.current !== scope) return",
  'connect === "error"',
  "Connect Google Calendar",
  "Connect to different account",
  "Reconnect",
]);
if (
  cards.includes("Verify connected account") ||
  cards.includes("Save verified calendar choices")
) {
  failures.push("purchaser calendar card still exposes the multi-select wizard");
}
if (cards.includes("Discover calendars") || cards.includes("Blocks appointment availability")) {
  failures.push("purchaser calendar card still lists calendars for multi-select");
}
if (failures.length) {
  console.error("Bucket 2 start verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("verify-bucket2-start: provider-safe onboarding boundary present");
