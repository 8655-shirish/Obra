import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const originalEnv = process.env;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const now = Date.parse("2026-09-11T08:00:00.000Z");
const freshAt = new Date(now - 60_000).toISOString();
const staleAt = new Date(now - 16 * 60_000).toISOString();
const ids = {
  website: "10000000-0000-4000-8000-000000000001",
  profile: "20000000-0000-4000-8000-000000000002",
  actor: "30000000-0000-4000-8000-000000000003",
  version: "40000000-0000-4000-8000-000000000004",
  preview: "50000000-0000-4000-8000-000000000005",
  draft: "60000000-0000-4000-8000-000000000006",
  other: "70000000-0000-4000-8000-000000000007",
};
const env = {
  ...originalEnv,
  BOOKING_LIVE_ENABLED: "true",
  BOOKING_WORKER_MODE: "active",
  BOOKING_WORKER_ENVIRONMENT: "test",
};
const profile = {
  id: ids.profile,
  auth_user_id: ids.actor,
  environment: "test",
  license_number: "FIXTURE123",
  full_name: "Fixture Owner",
  business_name: "Fixture Plumbing",
  trade: "plumber",
  city: "Fixture City",
};
const website = {
  id: ids.website,
  user_id: ids.profile,
  environment: "test",
  status: "live",
  active_version_id: ids.version,
  template_slug: "plumber",
  template_id: "tpl_plumber",
  onboarding_state: { licenseNumber: profile.license_number },
};
const config = {
  kind: "template",
  templateSlug: "plumber",
  identity: {
    businessName: profile.business_name,
    licenseNumber: profile.license_number,
    phone: "+15551234567",
    email: "owner@example.test",
    city: profile.city,
  },
  contact: {
    phone: "+15551234567",
    email: "owner@example.test",
    area: profile.city,
    hours: "Weekdays",
  },
  text: { heroTitle: "Existing website content" },
  media: {},
  reviews: [],
  blogs: [],
};
const cutover = { data: { status: "enabled", target_contract_version: 2 }, error: null };
const state = { expected: [], calls: [], unexpected: [], pending: 0, handlers: [], now };
const bundles = [];
let directory;
let passed = 0;
let networkCalls = 0;

function check(body) {
  try {
    return body();
  } catch (error) {
    // Page isolation catches errors. A caught test assertion must still fail the suite.
    state.unexpected.push(error.message);
    throw error;
  }
}

function expect(kind, args, value) {
  state.expected.push({ kind, args, value });
}

function take(kind, args) {
  const step = state.expected.shift();
  state.calls.push({ kind, args });
  check(() => {
    assert.ok(step, `Unexpected ${kind}: ${JSON.stringify(args)}`);
    assert.deepEqual({ kind, args }, { kind: step.kind, args: step.args });
  });
  if (step.value instanceof Error) throw step.value;
  return typeof step.value === "function" ? step.value() : structuredClone(step.value);
}

function query(kind, calls) {
  state.pending++;
  let awaited = false;
  const chain = {
    abortSignal(signal) {
      check(() => assert.ok(signal instanceof AbortSignal && !signal.aborted));
      calls.push("abortSignal");
      return chain;
    },
    then(resolve, reject) {
      state.pending--;
      check(() => assert.equal(awaited, false, "each DB operation is awaited exactly once"));
      awaited = true;
      return Promise.resolve()
        .then(() => take(kind, calls))
        .then(resolve, reject);
    },
  };
  for (const method of ["select", "eq", "in", "order", "limit", "single", "maybeSingle"])
    chain[method] = (...args) => {
      calls.push([method, ...args]);
      return chain;
    };
  return chain;
}

Object.assign(state, {
  check,
  take,
  db: {
    from: (table) => query("query", [["from", table]]),
    rpc: (name, args) => query("rpc", [name, args]),
  },
});

function expectQuery(table, columns, filters, result, terminal = "maybeSingle", options) {
  expect(
    "query",
    [
      ["from", table],
      ["select", columns, ...(options ? [options] : [])],
      ...filters,
      ...(terminal ? [[terminal]] : []),
    ],
    result,
  );
}

function fixture() {
  return {
    website_entitlements: {
      plan: "pro",
      state: "active",
      quote_admission: true,
      booking_admission: true,
      order_confirmed_at: freshAt,
      effective_at: freshAt,
      ends_at: null,
    },
    booking_services: { id: "service", active: true },
    calendar_connections: {
      id: "connection",
      connection_revision: 7,
      pipedream_account_id: "apn_saved",
      health_state: "healthy",
      last_verified_at: freshAt,
      verification_reason: null,
      reconnect_reason: null,
      account_email: "owner@example.test",
    },
    calendar_selections: [
      {
        connection_id: "connection",
        blocks_availability: true,
        receives_bookings: true,
        active: true,
        access_role: "owner",
        permission_verified_at: freshAt,
      },
    ],
    stripe_connected_accounts: {
      stripe_account_id: "acct_saved",
      onboarding_state: "ready",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: "active" },
      requirements: { currently_due: [], past_due: [], pending_verification: [] },
      last_verified_at: freshAt,
    },
    pipedream_bindings: {
      connection_id: "connection",
      pipedream_account_id: "apn_saved",
      trigger_state: "active",
      last_health_at: freshAt,
      reconciliation_due_at: null,
    },
    availability_schedules: { id: "schedule", active: true },
    intervalCount: 1,
  };
}

function expectFacts(
  rows,
  {
    site = website,
    errorTable,
    failure = { data: null, error: { code: "57014" } },
    pending = { data: null, error: null },
  } = {},
) {
  const tenant = [
    ["eq", "profile_id", site.user_id],
    ["eq", "environment", site.environment],
  ];
  for (const [table, columns, filters, terminal, observation] of [
    [
      "website_entitlements",
      "plan,state,quote_admission,booking_admission,order_confirmed_at,effective_at,ends_at",
      [["eq", "website_id", site.id], ...tenant],
      "maybeSingle",
      false,
    ],
    ["booking_services", "id,active", tenant, "maybeSingle", false],
    [
      "calendar_connections",
      "id,connection_revision,pipedream_account_id,health_state,last_verified_at,verification_reason,reconnect_reason,account_email,setup_operation_id,setup_actor_auth_user_id,setup_account_id,setup_expected_revision,setup_calendar_id,setup_calendars,setup_purpose,setup_completed_at,setup_failure_reason,setup_probe_account_id,setup_probe_calendar_id,setup_retry_at",
      tenant,
      "maybeSingle",
      true,
    ],
    [
      "calendar_selections",
      "connection_id,blocks_availability,receives_bookings,active,access_role,permission_verified_at",
      [...tenant, ["eq", "active", true]],
      null,
      true,
    ],
    [
      "stripe_connected_accounts",
      "stripe_account_id,onboarding_state,charges_enabled,payouts_enabled,details_submitted,capabilities,requirements,last_verified_at",
      tenant,
      "maybeSingle",
      false,
    ],
    [
      "pipedream_bindings",
      "connection_id,pipedream_account_id,trigger_state,last_health_at,reconciliation_due_at",
      tenant,
      "maybeSingle",
      true,
    ],
  ])
    expect(
      "query",
      [
        ["from", table],
        ["select", columns],
        ...filters,
        ...(observation ? ["abortSignal"] : []),
        ...(terminal ? [[terminal]] : []),
      ],
      errorTable === table ? failure : { data: rows[table], error: null },
    );
  if (
    errorTable &&
    !["calendar_connections", "calendar_selections", "pipedream_bindings"].includes(errorTable)
  )
    return;
  if (rows.booking_services) {
    expectQuery(
      "availability_schedules",
      "id,active",
      [...tenant, ["eq", "service_id", rows.booking_services.id]],
      { data: rows.availability_schedules, error: null },
    );
    if (rows.availability_schedules)
      expectQuery(
        "availability_intervals",
        "id",
        [["eq", "schedule_id", rows.availability_schedules.id], ...tenant],
        { data: null, count: rows.intervalCount, error: null },
        null,
        { count: "exact", head: true },
      );
  }
  if (errorTable === "calendar_connections") return;
  expect(
    "rpc",
    [
      "get_pending_google_calendar_setup",
      {
        p_profile_id: site.user_id,
        p_environment: site.environment,
        p_expected_revision: rows.calendar_connections?.connection_revision ?? 0,
      },
      "abortSignal",
    ],
    pending,
  );
}

function expectOwner() {
  expectQuery("profiles", "*", [["eq", "auth_user_id", ids.actor]], { data: profile, error: null });
}

function expectOverview(rows, options = {}) {
  expectQuery("websites", "user_id", [["eq", "id", ids.website]], {
    data: { user_id: ids.profile },
    error: null,
  });
  expectOwner();
  expectQuery(
    "websites",
    "*",
    [["eq", "id", ids.website]],
    { data: website, error: null },
    "single",
  );
  expectQuery(
    "profiles",
    "id, business_name, license_number, city",
    [["eq", "id", ids.profile]],
    { data: profile, error: null },
    "single",
  );
  expectFacts(rows, options);
  if (
    options.errorTable &&
    !["calendar_connections", "calendar_selections", "pipedream_bindings"].includes(
      options.errorTable,
    )
  )
    return;
  expectQuery(
    "website_versions",
    "id",
    [
      ["eq", "website_id", ids.website],
      ["eq", "status", "draft"],
      ["order", "version_number", { ascending: false }],
      ["limit", 1],
    ],
    { data: { id: ids.draft }, error: null },
  );
}

function expectWorkspace(
  rows,
  {
    statisticError,
    statisticFailure = { data: null, count: null, error: { code: "57014" } },
    siteResult = { data: website, error: null },
    ...options
  } = {},
) {
  expectOwner();
  expectQuery(
    "profiles",
    "id, license_number, full_name, business_name, trade, city",
    [["eq", "id", ids.profile]],
    { data: profile, error: null },
    "single",
  );
  expectQuery(
    "websites",
    "id",
    [
      ["eq", "id", ids.website],
      ["eq", "user_id", ids.profile],
    ],
    { data: { id: ids.website }, error: null },
  );
  expectQuery("websites", "*", [["eq", "id", ids.website]], siteResult, "single");
  if (siteResult.error) return;
  const statistic = (table, count) =>
    statisticError === table ? statisticFailure : { data: null, count, error: null };
  expectQuery(
    "website_entitlements",
    "id, plan",
    [
      ["eq", "profile_id", ids.profile],
      ["eq", "website_id", ids.website],
      ["eq", "plan", "starter"],
      ["in", "state", ["active", "grace"]],
      ["eq", "quote_admission", true],
      ["limit", 1],
    ],
    statistic("website_entitlements"),
  );
  expectQuery(
    "leads",
    "id",
    [
      ["eq", "user_id", ids.profile],
      ["eq", "website_id", ids.website],
    ],
    statistic("leads", 2),
    null,
    { count: "exact", head: true },
  );
  expectQuery(
    "appointments",
    "id",
    [
      ["eq", "profile_id", ids.profile],
      ["eq", "website_id", ids.website],
    ],
    statistic("appointments", 1),
    null,
    { count: "exact", head: true },
  );
  if (siteResult.error || !siteResult.data) return;
  expectFacts(rows, options);
}

function expectPublicContent(site = website, deps = {}) {
  expectQuery(
    "websites",
    "id, status, active_version_id, onboarding_state, user_id, environment",
    [["eq", "id", site.id]],
    { data: site, error: null },
  );
  const versionId = deps.version ?? site.active_version_id;
  if (deps.version) {
    expect("preview", [site.id, deps.preview], true);
    expectQuery("website_versions", "id, status, website_id", [["eq", "id", deps.version]], {
      data: { id: deps.version, status: "live", website_id: site.id },
      error: null,
    });
  }
  expectQuery(
    "website_versions",
    "config_json",
    [
      ["eq", "id", versionId],
      ["eq", "website_id", site.id],
    ],
    { data: { config_json: config }, error: null },
    "single",
  );
  expect("media", [config, { websiteId: site.id }], config);
  expect("overlay", [site.id, config], {});
}

function expectPublicCutover(result = cutover, site = website) {
  expectQuery(
    "booking_cutover_state",
    "status,target_contract_version",
    [
      ["eq", "profile_id", site.user_id],
      ["eq", "environment", site.environment],
    ],
    result,
  );
}

function expectAdmission(site = website, result = { data: true, error: null }) {
  expect("billing", [], site.environment);
  expect(
    "rpc",
    ["booking_cutover_enabled", { p_profile_id: site.user_id, p_environment: site.environment }],
    result,
  );
}

function expectRefresh(kind, checked) {
  expectAdmission();
  expect(
    "rpc",
    [
      "check_public_booking_rate_limit",
      {
        p_scope_key: `provider-refresh:${ids.website}`,
        p_action: "slots",
        p_client_bucket: createHash("sha256").update(`${ids.profile}:test`).digest("hex"),
        p_limit: 2,
        p_window_seconds: 60,
      },
    ],
    { data: true, error: null },
  );
  expect(
    kind,
    {
      profileId: ids.profile,
      environment: "test",
      ...(kind === "google" ? { allowRepair: false } : {}),
      deadlineAt: state.now + 9_000,
    },
    { checked },
  );
}

function assertUnknown(readiness) {
  assert.equal(readiness.websiteId, ids.website);
  assert.equal(readiness.profileId, ids.profile);
  assert.equal(readiness.environment, "test");
  assert.equal(readiness.plan, null, "unknown is not a Starter downgrade");
  assert.equal(readiness.orderConfirmed, false);
  assert.equal(readiness.bookingAdmission, false);
  assert.equal(readiness.providerRefreshEligible, false);
  assert.equal(readiness.showDemo, false);
  assert.equal(readiness.showLeadForm, false);
  assert.equal(readiness.entitlementUnavailable, false, "unknown is not known expiry");
  assert.equal(readiness.paymentDashboardAvailable, false);
  assert.equal(readiness.publicMode, "unavailable");
  assert.deepEqual(readiness.reasonCodes, ["booking_readiness_unknown"]);
  assert.deepEqual(readiness.calendarConnection, {
    connectionRevision: null,
    accountId: null,
    pendingSetup: null,
    configured: false,
    healthState: null,
    reason: "verification_unknown",
    reconnectReason: null,
    lastVerifiedAt: null,
    nextRetryAt: null,
    triggerState: null,
    lastHealthAt: null,
  });
}

function assertCalendarUnknown(readiness, plan = "pro", configured = true) {
  assert.equal(readiness.websiteId, ids.website);
  assert.equal(readiness.profileId, ids.profile);
  assert.equal(readiness.environment, "test");
  assert.equal(readiness.plan, plan, "optional Google failure cannot replace checked entitlement");
  assert.equal(readiness.orderConfirmed, true);
  assert.equal(readiness.availability, "configured");
  assert.equal(readiness.payments, "ready");
  assert.equal(readiness.paymentDashboardAvailable, true);
  assert.equal(readiness.showLeadForm, true);
  assert.equal(readiness.entitlementUnavailable, false);
  assert.equal(readiness.showDemo, false);
  assert.equal(readiness.bookingAdmission, false);
  assert.equal(readiness.providerRefreshEligible, false);
  assert.equal(readiness.calendar, "restricted");
  assert.equal(readiness.calendarConnection.configured, configured);
  assert.equal(readiness.calendarConnection.healthState, null);
  assert.equal(readiness.calendarConnection.reason, "verification_unknown");
  assert.ok(readiness.reasonCodes.includes("booking_readiness_unknown"));
}

function assertPublicContent(result, site = website, versionId = site.active_version_id) {
  assert.deepEqual(result.config, config);
  assert.equal(result.config.contact.phone, "+15551234567");
  assert.equal(result.config.identity.email, "owner@example.test");
  assert.equal(result.websiteId, site.id);
  assert.equal(result.versionId, versionId);
  assert.equal(result.hasLicenseConfigured, true);
  assert.deepEqual(result.templateMedia, {});
}

const components = (...names) =>
  names.map((name) => `export const ${name}=${JSON.stringify(name)};`).join("\n");
const forbidden = (...names) =>
  names
    .map(
      (name) =>
        `export const ${name}=(...args)=>globalThis.__bookingPageIsolation.take('forbidden',[${JSON.stringify(name)},...args]);`,
    )
    .join("\n");
const mocks = {
  zod: `export * from ${JSON.stringify(fileURLToPath(import.meta.resolve("zod")))};`,
  "@tanstack/react-start": `export const createServerFn=options=>({validator:validate=>({handler:handle=>async({data})=>{
    const parsed=validate(data);globalThis.__bookingPageIsolation.handlers.push({method:options.method,data:parsed});
    return handle({data:parsed});
  }})});`,
  "@tanstack/react-router": `const f=globalThis.__bookingPageIsolation;
    export const createFileRoute=()=>options=>({...options,useLoaderData:()=>f.loaderData,useSearch:()=>f.search});
    export const redirect=options=>Object.assign(new Error('Fixture route redirect'),{options});
    export const useMatches=()=>f.matches;export const Outlet='Outlet',Link='Link';
    export const useNavigate=()=>()=>f.take('forbidden',['navigate']);
    export const useRouter=()=>f.take('forbidden',['router']);`,
  react: `const f=globalThis.__bookingPageIsolation;
    export const useState=(...args)=>f.hooks.useState(...args),useRef=(...args)=>f.hooks.useRef(...args),
      useLayoutEffect=(...args)=>f.hooks.useLayoutEffect(...args),useEffect=(...args)=>f.hooks.useEffect(...args);
    export const useCallback=fn=>fn,lazy=load=>({load}),Suspense='Suspense';`,
  "react/jsx-runtime": `export const jsx=(type,props,key)=>({type,props,key}),jsxs=jsx,Fragment='Fragment';`,
  "@/integrations/supabase/client.server": `export const supabaseAdmin=globalThis.__bookingPageIsolation.db;`,
  "@/lib/auth/admin-session.server": `export const getImpersonationProfileId=async()=>null,isAdminSessionValid=async()=>false;`,
  "@/lib/auth/contractor-session.server": `export const getContractorAuthUserId=async()=>globalThis.__bookingPageIsolation.actor;`,
  "@/lib/jobs/enqueue.server": forbidden(
    "enqueueEnrichmentChain",
    "cancelSiteGenerationRequest",
    "cancelWorkspaceJobs",
  ),
  "@/lib/auth/preview-token.server": `export const isValidOwnerPreviewToken=(...args)=>globalThis.__bookingPageIsolation.take('preview',args);`,
  "@/lib/media/site-media.server": `export const resolveSiteMediaInConfig=(db,...args)=>{
    const f=globalThis.__bookingPageIsolation;f.check(()=>{if(db!==f.db)throw Error('Wrong media DB')});return f.take('media',args);
  };`,
  "@/lib/template-purchase.server": `export const resolveTemplateOverlayMedia=(db,...args)=>{
    const f=globalThis.__bookingPageIsolation;f.check(()=>{if(db!==f.db)throw Error('Wrong overlay DB')});return f.take('overlay',args);
  };${forbidden("copyTemplateIdentityToWebsite")}`,
  "@/lib/stripe.server": `export const billingEnvironment=()=>globalThis.__bookingPageIsolation.take('billing',[]);`,
  "@/lib/pipedream.server": forbidden("getGoogleCalendarBusyRanges"),
  "@/lib/pipedream-trigger-reconciliation.server": `export const refreshSavedGoogleCalendar=input=>globalThis.__bookingPageIsolation.take('google',input);`,
  "@/lib/stripe-connect-inbox-worker.server": `export const refreshSavedStripeConnectAccount=input=>globalThis.__bookingPageIsolation.take('stripe',input);`,
  "@/components/site-renderer/DemoLicenseGate": components("DemoLicenseGate"),
  "@/components/site-renderer/DemoLpChrome": components("DemoLpChrome"),
  "@/components/site-renderer/ContractorSiteView": components("ContractorSiteView"),
  "@/components/site-renderer/SiteBookingPayDemo": components("SiteBookingPayDemo"),
  "@/components/booking/LiveBookingDialog": components("LiveBookingDialog"),
  "@/components/templates/molds": forbidden("moldComponentFor"),
  "@/components/purchaser/PurchaserOverview": components("PurchaserOverview"),
  "@/components/ui/button": components("Button"),
  "@/components/ui/card": components(
    "Card",
    "CardContent",
    "CardDescription",
    "CardHeader",
    "CardTitle",
  ),
};

async function sourceBundle(relative, { before, append = "", overrides = {} } = {}) {
  const source = await readFile(path.resolve(relative), "utf8");
  const end = before ? source.indexOf(before) : source.length;
  assert.ok(end > 0, `Missing source boundary ${relative}: ${before}`);
  const entry = path.join(directory, `entry-${bundles.length}.mjs`);
  // Temporary exports leave the production handler, validator and loader body unchanged.
  const { code } = await transform(source.slice(0, end) + append, {
    loader: "tsx",
    jsx: "automatic",
    target: "node22",
    sourcefile: relative,
  });
  await writeFile(entry, code);
  const bundle = await importWithMocks(entry, { ...mocks, ...overrides });
  bundles.push(bundle);
  return bundle.subject;
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}

async function run(name, body) {
  process.env = { ...env };
  Object.assign(state, {
    expected: [],
    calls: [],
    unexpected: [],
    pending: 0,
    handlers: [],
    actor: ids.actor,
    now,
  });
  await body();
  assert.deepEqual(state.unexpected, [], "caught mock violations must fail the test");
  assert.deepEqual(state.expected, [], "all planned operations must execute");
  assert.equal(state.pending, 0, "all DB operations must be awaited");
  assert.ok(
    state.handlers.every(({ method }) => method === "GET"),
    "no action handlers",
  );
  assert.equal(networkCalls, 0, "no DB/provider network traffic");
  passed++;
  console.log(`PASS: ${name}`);
}

try {
  globalThis.__bookingPageIsolation = state;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network forbidden in code-only page isolation tests");
  };
  Date.now = () => state.now;
  directory = await mkdtemp(path.join(os.tmpdir(), "obra-booking-page-"));
  const purchaser = await sourceBundle("src/lib/template-purchase.functions.ts", {
    before: "export type PurchaserOverview",
  });
  const workspace = await sourceBundle("src/lib/jobs.functions.ts", {
    before: "export const getJobProgress",
    append: '\nexport { workerProviderContext } from "@/lib/worker-deadline.server";\n',
  });
  const publicSite = await sourceBundle("src/routes/lp/$websiteId.tsx", {
    append:
      '\nexport { loadPublicSite };\nexport { workerProviderContext } from "@/lib/worker-deadline.server";\n',
  });
  const overviewComponent = await sourceBundle("src/components/purchaser/PurchaserOverview.tsx", {
    overrides: {
      "@/lib/template-purchase.functions": `export const getPurchaserOverview=input=>{
        const f=globalThis.__bookingPageIsolation;return f.lastOverviewRequest=f.overview(input);
      };${forbidden("getActiveTemplatePersonalization", "runTemplatePersonalization")}`,
      "@/lib/agent/fetch-agent-message": forbidden("fetchAgentMessage"),
      "@/lib/jobs.functions": forbidden("getJobProgress"),
      "@/lib/booking-setup.functions": forbidden("acknowledgeBookingOrder"),
      "@/lib/supabase-browser": `export const supabaseBrowser={auth:{signOut:()=>globalThis.__bookingPageIsolation.take('forbidden',['signOut'])}};`,
      "./EngagementCards": components("AppointmentsCard", "BookingsCard"),
      "./SetupStepCards": components("StepTwoCard", "StepThreeCard", "StepFourCard"),
    },
  });
  const userRoute = await sourceBundle("src/routes/user/$userId.tsx", {
    overrides: {
      "@/lib/jobs.functions": `export const getWorkspaceBootstrap=input=>globalThis.__bookingPageIsolation.bootstrap(input);`,
    },
  });
  state.bootstrap = workspace.getWorkspaceBootstrap;
  state.overview = purchaser.getPurchaserOverview;
  const getOverview = () => purchaser.getPurchaserOverview({ data: { websiteId: ids.website } });
  const getPublic = (site = website, deps = {}) =>
    publicSite.Route.loader({
      params: { websiteId: site.id },
      deps: publicSite.Route.loaderDeps({ search: publicSite.Route.validateSearch.parse(deps) }),
    });
  const beforeLoad = () =>
    userRoute.Route.beforeLoad({
      params: { userId: ids.profile },
      search: { websiteId: ids.website },
      location: { hash: "#step-3" },
    });

  function mountOverview() {
    const slots = [];
    let cursor = 0;
    const view = { layout: [], effects: [], tree: null };
    state.hooks = {
      useState(initial) {
        const index = cursor++;
        slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          slots[index].value,
          (next) => {
            slots[index].value = typeof next === "function" ? next(slots[index].value) : next;
          },
        ];
      },
      useRef(initial) {
        return (slots[cursor++] ??= { current: initial });
      },
      useLayoutEffect(fn, deps) {
        const index = cursor++;
        if (!slots[index] || !deps.every((value, i) => Object.is(value, slots[index][i]))) {
          slots[index] = deps;
          view.layout.push(fn);
        }
      },
      useEffect(fn) {
        view.effects.push(fn);
      },
    };
    view.render = () => {
      cursor = 0;
      view.layout = [];
      view.effects = [];
      view.tree = overviewComponent.PurchaserOverview({
        userId: ids.profile,
        websiteId: ids.website,
      });
      return view.tree;
    };
    view.render();
    // Only the identity layout effect and GET effect run; no DOM/hash/visibility effects here.
    view.unmount = view.layout[0]();
    view.effects[0]();
    return view;
  }

  await run("#139 LP keeps shared slug selection and template page scrolling", async () => {
    const source = await readFile(path.resolve("src/routes/lp/$websiteId.tsx"), "utf8");
    assert.match(source, /moldComponentFor\(templateView\.slug\)/);
    assert.doesNotMatch(source, /PainterElevenTemplatePage|PlumberTemplatePage/);
    assert.match(source, /className=\{templateView \? undefined : "h-full min-h-0 flex-1"\}/);
    assert.match(
      source,
      /className=\{templateView \? "min-h-dvh" : "flex h-dvh min-h-0 flex-col overflow-hidden"\}/,
    );
    assert.equal(
      publicSite.Route.head({ loaderData: { config } }).meta[0].title,
      profile.business_name,
    );
  });

  await run(
    "R1 integration fixtures bind to the service-only pending RPC's SQL shape",
    async () => {
      const migration = await readFile(
        path.resolve("supabase/migrations/20260910120000_google_calendar_lifetime.sql"),
        "utf8",
      );
      const start = migration.indexOf("create function public.get_pending_google_calendar_setup(");
      const end = migration.indexOf(
        "create function public.authorize_google_calendar_setup_read",
        start,
      );
      assert.ok(start >= 0 && end > start);
      const contract = migration.slice(start, end);
      assert.match(
        contract,
        /p_profile_id uuid,p_environment text,p_expected_revision bigint\s*\) returns jsonb language plpgsql stable security definer set search_path=''/,
      );
      assert.match(
        contract,
        /revoke all on function public\.get_pending_google_calendar_setup\(uuid,text,bigint\) from public,anon,authenticated,service_role,booking_worker/,
      );
      assert.match(
        contract,
        /grant execute on function public\.get_pending_google_calendar_setup\(uuid,text,bigint\) to service_role/,
      );
      for (const key of [
        "operationId",
        "accountId",
        "connectionRevision",
        "configurationKey",
        "blockingCalendarIds",
        "destinationCalendarId",
        "reason",
        "nextRetryAt",
      ])
        assert.ok(contract.includes(`'${key}',`), `SQL pending DTO field ${key}`);
      // Actual role/ACL execution belongs to the Google SQL suite, not this mock.
      const pending = {
        operationId: ids.draft,
        accountId: "apn_pending",
        connectionRevision: 7,
        configurationKey: createHash("sha256")
          .update(
            JSON.stringify([ids.draft, "apn_pending", 7, ["busy-a", "busy-z"], "destination"]),
          )
          .digest("hex"),
        blockingCalendarIds: ["busy-a", "busy-z"],
        destinationCalendarId: "destination",
        reason: "temporary",
        nextRetryAt: freshAt,
      };
      expectOverview(fixture(), { pending: { data: pending, error: null } });
      const result = await getOverview();
      assert.equal(result.plan, "pro");
      assert.equal(result.orderConfirmed, true);
      assert.equal(result.readiness.calendar, "pending");
      assert.equal(result.readiness.bookingAdmission, false);
      assert.equal(result.readiness.providerRefreshEligible, false);
      assert.deepEqual(result.readiness.calendarConnection.pendingSetup, {
        configurationKey: pending.configurationKey,
        reason: "temporary",
        nextRetryAt: freshAt,
      });
      expectPublicContent();
      expectFacts(fixture(), { pending: { data: pending, error: null } });
      expectPublicCutover();
      const page = await getPublic();
      assertPublicContent(page);
      assert.equal(page.liveBooking, false);
      assert.equal(page.showDemoChrome, false);
      assert.equal(page.bookingRetryAvailable, false, "owner setup intent is not public recovery");
    },
  );

  await run("R16 overview has one checked entitlement read and no false Starter DTO", async () => {
    for (const plan of ["pro", "starter", null]) {
      const rows = fixture();
      if (plan) rows.website_entitlements.plan = plan;
      else rows.website_entitlements = null;
      const start = state.calls.length;
      expectOverview(rows);
      const result = await getOverview();
      assert.equal(result.plan, plan ?? "starter");
      assert.equal(result.readiness.plan, plan);
      assert.equal(result.orderConfirmed, result.readiness.orderConfirmed);
      assert.equal(result.orderConfirmed, plan !== null);
      assert.equal(result.website.templateId, "tpl_plumber");
      assert.deepEqual(result.draft, { exists: true, id: ids.draft });
      assert.equal(result.liveUrl, `/lp/${ids.website}`);
      assert.equal(
        state.calls
          .slice(start)
          .filter(({ kind, args }) => kind === "query" && args[0][1] === "website_entitlements")
          .length,
        1,
      );
    }
    const rows = fixture();
    rows.website_entitlements.order_confirmed_at = null;
    expectOverview(rows);
    const unconfirmed = await getOverview();
    assert.equal(unconfirmed.plan, "pro");
    assert.equal(unconfirmed.orderConfirmed, false);
    assert.equal(unconfirmed.readiness.orderConfirmed, false);
  });

  await run(
    "H5 first-load Pro/Starter overview keeps checked setup, editing and engagement during optional Google failures",
    async () => {
      for (const plan of ["pro", "starter"])
        for (const options of [
          { pending: { data: null, error: { code: "57014" } } },
          { pending: { data: null, error: { code: "40001" } } },
          { pending: { data: true, error: null } },
          { pending: { data: {}, error: null } },
          {
            pending: {
              data: {
                operationId: ids.draft,
                accountId: "apn_pending",
                connectionRevision: 8,
                configurationKey: "a".repeat(64),
                blockingCalendarIds: ["busy"],
                destinationCalendarId: "destination",
                reason: null,
                nextRetryAt: null,
              },
              error: null,
            },
          },
          { pending: new Error("Fixture optional RPC rejected") },
          { errorTable: "calendar_connections" },
          { errorTable: "calendar_selections" },
          { errorTable: "pipedream_bindings" },
          {
            errorTable: "pipedream_bindings",
            failure: new Error("Fixture optional query rejected"),
          },
        ]) {
          const rows = fixture();
          rows.website_entitlements.plan = plan;
          const start = state.calls.length;
          expectOverview(rows, options);
          const view = mountOverview();
          await state.lastOverviewRequest;
          await new Promise((resolve) => setImmediate(resolve));
          const tree = view.render();
          const stepOne = nodes(tree).find(({ props }) => props?.overview);
          const result = stepOne.props.overview;
          assert.equal(result.plan, plan);
          assert.equal(result.orderConfirmed, true);
          assert.deepEqual(result.draft, { exists: true, id: ids.draft });
          assert.equal(result.liveUrl, `/lp/${ids.website}`);
          assert.equal(result.profile.businessName, profile.business_name);
          assertCalendarUnknown(
            result.readiness,
            plan,
            !["calendar_connections", "calendar_selections"].includes(options.errorTable),
          );
          assert.equal(
            nodes(tree).some(({ type }) => type === "AppointmentsCard"),
            true,
          );
          assert.equal(
            nodes(tree).some(({ type }) => type === "BookingsCard"),
            plan === "pro",
          );
          if (plan === "pro") {
            assert.equal(
              nodes(tree).find(({ type }) => type === "StepTwoCard").props.statusUnknown,
              true,
            );
            assert.equal(
              nodes(tree).find(({ type }) => type === "StepThreeCard").props.locked,
              false,
            );
            assert.equal(
              nodes(tree).find(({ type }) => type === "StepFourCard").props.onboardingReady,
              false,
            );
          }
          // Invoke the actual Step 1 body with fresh hooks, without running its network effects.
          state.hooks.useState = (initial) => {
            const value = typeof initial === "function" ? initial() : initial;
            return [value, () => {}];
          };
          const content = stepOne.type(stepOne.props);
          assert.ok(
            nodes(content).some(
              ({ type, props }) => type === "Link" && props.to === "/user/$userId/edit-mode",
            ),
          );
          assert.equal(
            state.calls
              .slice(start)
              .filter(({ kind, args }) => kind === "query" && args[0][1] === "website_entitlements")
              .length,
            1,
          );
          view.unmount();
        }
    },
  );

  await run(
    "R16 a rejected checked refresh preserves the actual component's setup identity and props",
    async () => {
      expectOverview(fixture());
      const view = mountOverview();
      const render = view.render;
      await state.lastOverviewRequest;
      await new Promise((resolve) => setImmediate(resolve));
      let tree = render();
      const child = (name) => nodes(tree).find(({ type }) => type === name);
      const previous = nodes(tree).find(({ props }) => props?.overview)?.props.overview;
      assert.equal(previous.plan, "pro");
      assert.equal(previous.orderConfirmed, true);
      const scopeKey = `${ids.profile}:${ids.website}:test`;
      assert.ok(nodes(tree).some(({ key }) => key === scopeKey));
      assert.equal(child("StepTwoCard").props.statusUnknown, false);
      assert.equal(child("StepThreeCard").props.locked, false);
      assert.equal(child("StepFourCard").props.onboardingReady, true);
      for (const failure of [
        { data: null, error: { code: "57014" } },
        new Error("Fixture checked query rejected"),
      ]) {
        expectOverview(fixture(), { errorTable: "website_entitlements", failure });
        await assert.rejects(
          child("StepTwoCard").props.onChanged,
          /Unable to load booking readiness facts|Fixture checked query rejected/,
        );
        tree = render();
        assert.equal(nodes(tree).find(({ props }) => props?.overview)?.props.overview, previous);
        assert.ok(
          nodes(tree).some(({ key }) => key === scopeKey),
          "the setup subtree keeps its React key",
        );
        assert.equal(child("StepTwoCard").props.readiness, previous.readiness);
        assert.equal(child("StepTwoCard").props.statusUnknown, true);
        assert.equal(child("StepThreeCard").props.websiteId, ids.website);
        assert.equal(child("StepThreeCard").props.locked, false);
        assert.equal(child("StepFourCard").props.locked, false);
        assert.equal(child("StepFourCard").props.onboardingReady, false);
      }
      expectOverview(fixture());
      await child("StepTwoCard").props.onChanged();
      tree = render();
      assert.equal(child("StepTwoCard").props.statusUnknown, false);
      assert.equal(child("StepFourCard").props.onboardingReady, true);
      assert.ok(nodes(tree).some(({ key }) => key === scopeKey));
      view.unmount();
    },
  );

  await run(
    "H5 first-load entitlement failure still rejects rather than constructing a false Starter overview",
    async () => {
      for (const failure of [
        { data: null, error: { code: "57014" } },
        new Error("Fixture entitlement rejected"),
      ]) {
        expectOverview(fixture(), { errorTable: "website_entitlements", failure });
        const view = mountOverview();
        await assert.rejects(state.lastOverviewRequest);
        await new Promise((resolve) => setImmediate(resolve));
        const tree = view.render();
        assert.ok(nodes(tree).some(({ type }) => type === "Button"));
        assert.ok(!nodes(tree).some(({ props }) => props?.overview));
        assert.ok(
          !nodes(tree).some(({ type }) =>
            ["StepTwoCard", "StepThreeCard", "BookingsCard"].includes(type),
          ),
        );
        view.unmount();
      }
    },
  );

  await run(
    "R17 real profile/website authorization and metadata failures still deny the workspace",
    async () => {
      state.actor = null;
      await assert.rejects(beforeLoad, (error) => {
        assert.deepEqual(error.options, {
          to: "/login",
          search: { next: `/user/${ids.profile}?websiteId=${ids.website}#step-3` },
        });
        return true;
      });
      await assert.rejects(getOverview, /Unauthorized/);
      assert.equal(state.calls.length, 0);
      state.actor = ids.actor;
      for (const owner of [
        null,
        { ...profile, id: ids.other },
        { ...profile, auth_user_id: null },
      ]) {
        expectQuery("profiles", "*", [["eq", "auth_user_id", ids.actor]], {
          data: owner,
          error: null,
        });
        await assert.rejects(beforeLoad, /Forbidden/);
      }
      expectOwner();
      expectQuery(
        "profiles",
        "id, license_number, full_name, business_name, trade, city",
        [["eq", "id", ids.profile]],
        { data: null, error: { code: "42501" } },
        "single",
      );
      await assert.rejects(beforeLoad, /Profile not found/);
      for (const result of [
        { data: null, error: null },
        { data: null, error: { code: "42501" } },
      ]) {
        expectOwner();
        expectQuery(
          "profiles",
          "id, license_number, full_name, business_name, trade, city",
          [["eq", "id", ids.profile]],
          { data: profile, error: null },
          "single",
        );
        expectQuery(
          "websites",
          "id",
          [
            ["eq", "id", ids.website],
            ["eq", "user_id", ids.profile],
          ],
          result,
        );
        await assert.rejects(beforeLoad, /Website not found|Unable to load website/);
      }
      expectQuery("websites", "user_id", [["eq", "id", ids.website]], {
        data: { user_id: ids.other },
        error: null,
      });
      expectOwner();
      await assert.rejects(getOverview, /Forbidden/);
      assert.ok(
        state.calls.every(
          ({ kind, args }) => kind === "query" && ["profiles", "websites"].includes(args[0][1]),
        ),
        "denial precedes every booking read",
      );
      for (const siteResult of [
        { data: null, error: { code: "42501" } },
        { data: null, error: null },
      ]) {
        expectWorkspace(fixture(), { siteResult });
        await assert.rejects(beforeLoad, /Unable to load workspace access state|Website not found/);
      }
    },
  );

  await run(
    "R17 authorized workspace metadata and edit Outlet survive optional booking reads",
    async () => {
      for (const options of [
        { errorTable: "calendar_connections" },
        { errorTable: "website_entitlements" },
        { errorTable: "booking_services", failure: new Error("Fixture booking query rejected") },
        { pending: { data: null, error: { code: "40001" } } },
        { statisticError: "appointments" },
        { statisticError: "website_entitlements" },
        { statisticError: "leads" },
      ]) {
        expectWorkspace(fixture(), options);
        const context = await beforeLoad();
        const result = userRoute.Route.loader({ context });
        assert.equal(result, context.bootstrap);
        assert.deepEqual(result.profile, {
          id: ids.profile,
          licenseNumber: profile.license_number,
          fullName: profile.full_name,
          businessName: profile.business_name,
          trade: profile.trade,
          city: profile.city,
        });
        assert.equal(result.mode, "contractor");
        assert.equal(result.websiteId, ids.website);
        assert.equal(result.templateSlug, "plumber");
        assert.equal(
          result.bookingManagement.hasHistoricalBookings,
          options.statisticError !== "appointments",
        );
        if (["website_entitlements", "booking_services"].includes(options.errorTable)) {
          assertUnknown(result.bookingManagement.readiness);
          assert.equal(result.bookingManagement.canContinueSetup, false);
          assert.equal(result.bookingManagement.canOpenPayments, false);
        } else if (options.errorTable || options.pending) {
          assertCalendarUnknown(
            result.bookingManagement.readiness,
            "pro",
            options.errorTable !== "calendar_connections",
          );
          assert.equal(result.bookingManagement.canContinueSetup, true);
          assert.equal(result.bookingManagement.canOpenPayments, true);
        } else {
          assert.equal(result.bookingManagement.readiness.plan, "pro");
          assert.equal(result.bookingManagement.readiness.bookingAdmission, true);
        }
        Object.assign(state, {
          loaderData: result,
          search: { websiteId: ids.website },
          matches: [{ routeId: "/user/$userId/edit-mode" }],
        });
        const elements = nodes(userRoute.Route.component());
        assert.ok(elements.some(({ type }) => type === "Outlet"));
        assert.ok(!elements.some(({ type }) => type === "PurchaserOverview"));
        assert.equal(userRoute.Route.head().meta[0].title, "Workspace | Obra");
      }
    },
  );

  await run(
    "R17 optional statistics rejection cannot grant or deny workspace access",
    async () => {
      for (const statisticError of ["website_entitlements", "leads", "appointments"]) {
        expectWorkspace(fixture(), {
          statisticError,
          statisticFailure: () => {
            check(() => assert.equal(workspace.workerProviderContext(), undefined));
            throw new Error("Fixture optional statistic rejected");
          },
        });
        const context = await beforeLoad();
        const result = userRoute.Route.loader({ context });
        assert.equal(result.mode, "contractor");
        assert.equal(result.profile.id, ids.profile);
        assert.equal(result.websiteId, ids.website);
        assert.equal(
          result.showWebsiteLeads,
          statisticError !== "leads",
          "only a discarded lead count cannot grant the leads menu",
        );
        assert.equal(
          result.bookingManagement.hasHistoricalBookings,
          statisticError !== "appointments",
        );
        assert.equal(result.bookingManagement.readiness.plan, "pro");
        assert.equal(result.bookingManagement.readiness.bookingAdmission, true);
        Object.assign(state, {
          loaderData: result,
          search: { websiteId: ids.website },
          matches: [{ routeId: "/user/$userId/edit-mode" }],
        });
        assert.ok(nodes(userRoute.Route.component()).some(({ type }) => type === "Outlet"));
      }
    },
  );

  await run(
    "R17 initial public read failure preserves contact content without demo, purchase or charge admission",
    async () => {
      for (const options of [
        { errorTable: "website_entitlements" },
        { errorTable: "calendar_connections" },
        {
          errorTable: "booking_services",
          failure: new Error("Fixture initial booking read rejected"),
        },
        { pending: { data: null, error: { code: "42501" } } },
      ]) {
        expectPublicContent();
        expectFacts(fixture(), options);
        expectPublicCutover();
        const result = await getPublic();
        assertPublicContent(result);
        for (const flag of [
          "showBookingPay",
          "liveBooking",
          "showBuyCta",
          "showDemoChrome",
          "bookingConfigurationPending",
          "entitlementUnavailable",
        ])
          assert.equal(result[flag], false, flag);
        assert.equal(
          result.showLeadForm,
          options.errorTable === "calendar_connections" || Boolean(options.pending),
        );
        assert.equal(result.bookingRetryAvailable, true);
      }
      assert.ok(
        state.calls.every(
          ({ kind, args }) =>
            kind !== "billing" &&
            (kind !== "rpc" || args[0] === "get_pending_google_calendar_setup"),
        ),
        "unknown facts cannot trigger provider work",
      );
    },
  );

  await run(
    "R17 healthy admission, genuine no-entitlement demo and Starter leads are unchanged",
    async () => {
      for (const [environment, plan] of [
        ["test", "pro"],
        ["live", "pro"],
        ["test", "starter"],
        ["test", null],
      ]) {
        const site = { ...website, environment };
        process.env.BOOKING_WORKER_ENVIRONMENT = environment;
        const rows = fixture();
        if (plan) rows.website_entitlements.plan = plan;
        else rows.website_entitlements = null;
        expectPublicContent(site);
        expectFacts(rows, { site });
        if (plan === "pro") expectAdmission(site);
        expectPublicCutover(cutover, site);
        const result = await getPublic(site);
        assertPublicContent(result, site);
        assert.equal(result.liveBooking, plan === "pro");
        assert.equal(result.showBookingPay, plan !== "starter");
        assert.equal(result.showDemoChrome, plan === null);
        assert.equal(result.showBuyCta, plan === null);
        assert.equal(result.showLeadForm, plan !== null);
        assert.equal(result.bookingRetryAvailable, false);
      }
    },
  );

  await run(
    "R19 unknown-read retry reruns the actual LP loader and only verified recovery admits",
    async () => {
      expectPublicContent();
      expectFacts(fixture(), { errorTable: "website_entitlements" });
      expectPublicCutover();
      const unavailable = await getPublic();
      assert.equal(unavailable.bookingRetryAvailable, true);
      assert.equal(unavailable.liveBooking, false);
      expectPublicContent();
      expectFacts(fixture());
      expectAdmission();
      expectPublicCutover();
      const recovered = await getPublic();
      assert.equal(recovered.liveBooking, true);
      assert.equal(recovered.showBookingPay, true);
      assert.equal(recovered.bookingRetryAvailable, false);
      assert.deepEqual(recovered.config, unavailable.config);
    },
  );

  await run(
    "R19 stale eligible public facts retry through bounded refresh, not a demo or new provider action",
    async () => {
      const rows = fixture();
      rows.calendar_connections.last_verified_at = staleAt;
      for (const checked of [false, true]) {
        expectPublicContent();
        expectFacts(rows);
        expectRefresh("google", checked);
        expectFacts(checked ? fixture() : rows);
        expectPublicCutover();
        const result = await getPublic();
        assertPublicContent(result);
        assert.equal(result.liveBooking, checked);
        assert.equal(result.bookingRetryAvailable, !checked);
        assert.equal(result.showDemoChrome, false);
      }
    },
  );

  await run(
    "R19 fresh Stripe restrictions never offer retry, even with stale Google evidence",
    async () => {
      const requirements = fixture().stripe_connected_accounts.requirements;
      for (const restriction of [
        { charges_enabled: false },
        { payouts_enabled: false },
        { details_submitted: false },
        { onboarding_state: "pending" },
        { onboarding_state: "restricted" },
        { onboarding_state: "disabled" },
        { capabilities: { card_payments: "inactive" } },
        { requirements: { ...requirements, currently_due: ["business_profile.url"] } },
        { requirements: { ...requirements, past_due: ["business_profile.url"] } },
        { requirements: { ...requirements, pending_verification: ["individual.verification"] } },
        { requirements: { ...requirements, disabled_reason: "requirements.past_due" } },
      ])
        for (const googleStale of [false, true]) {
          const rows = fixture();
          Object.assign(rows.stripe_connected_accounts, restriction);
          if (googleStale) rows.calendar_connections.last_verified_at = staleAt;
          const start = state.calls.length;
          expectPublicContent();
          expectFacts(rows);
          if (googleStale) {
            expectRefresh("google", false);
            expectFacts(rows);
          }
          expectPublicCutover();
          const result = await getPublic();
          assertPublicContent(result);
          assert.equal(result.liveBooking, false);
          assert.equal(result.showBookingPay, false);
          assert.equal(result.showDemoChrome, false);
          assert.equal(result.showLeadForm, true);
          assert.equal(
            result.bookingRetryAvailable,
            false,
            JSON.stringify({ restriction, googleStale }),
          );
          assert.deepEqual(
            state.calls
              .slice(start)
              .filter(({ kind }) => ["google", "stripe"].includes(kind))
              .map(({ kind }) => kind),
            googleStale ? ["google"] : [],
            "fresh known Stripe failure never triggers a Stripe refresh",
          );
        }
    },
  );

  await run(
    "R19 stale Stripe may retry, but freshly verified restrictions stop retries",
    async () => {
      for (const outcome of ["unchecked", "restricted", "ready"]) {
        const rows = fixture();
        rows.stripe_connected_accounts.charges_enabled = false;
        rows.stripe_connected_accounts.last_verified_at = staleAt;
        const current = outcome === "unchecked" ? rows : fixture();
        if (outcome === "restricted") current.stripe_connected_accounts.charges_enabled = false;
        expectPublicContent();
        expectFacts(rows);
        expectRefresh("stripe", outcome !== "unchecked");
        expectFacts(current);
        expectPublicCutover();
        const result = await getPublic();
        assertPublicContent(result);
        assert.equal(result.liveBooking, outcome === "ready");
        assert.equal(result.showBookingPay, outcome === "ready");
        assert.equal(result.bookingRetryAvailable, outcome === "unchecked");
        assert.equal(result.showDemoChrome, false);
      }
    },
  );

  await run("R19 temporary Google or monitoring failure retains a read-only retry", async () => {
    for (const reason of ["provider_temporary_failure", "provider_platform_error", null]) {
      const rows = fixture();
      if (reason) {
        rows.calendar_connections.health_state = "degraded";
        rows.calendar_connections.verification_reason = reason;
      } else rows.pipedream_bindings.trigger_state = "degraded";
      expectPublicContent();
      expectFacts(rows);
      expectPublicCutover();
      const result = await getPublic();
      assertPublicContent(result);
      assert.equal(result.liveBooking, false);
      assert.equal(result.showBookingPay, false);
      assert.equal(result.bookingRetryAvailable, true);
    }
    assert.ok(state.calls.every(({ kind }) => !["google", "stripe", "forbidden"].includes(kind)));
  });

  await run(
    "R19 structurally incomplete and reconnect-required sites do not offer futile retries",
    async () => {
      for (const change of [
        (rows) => {
          rows.booking_services = null;
        },
        (rows) => {
          rows.availability_schedules = null;
        },
        (rows) => {
          rows.intervalCount = 0;
        },
        (rows) => {
          rows.calendar_connections = null;
        },
        (rows) => {
          rows.calendar_selections = [];
        },
        (rows) => {
          rows.stripe_connected_accounts = null;
        },
        (rows) => {
          rows.website_entitlements.booking_admission = false;
        },
        (rows) => {
          rows.website_entitlements.order_confirmed_at = null;
        },
        (rows) => {
          rows.website_entitlements.state = "expired";
        },
        (rows) => {
          rows.calendar_connections.verification_reason = "provider_reauthorization_required";
          rows.calendar_connections.reconnect_reason = "provider_reauthorization_required";
        },
      ]) {
        const rows = fixture();
        change(rows);
        expectPublicContent();
        expectFacts(rows);
        expectPublicCutover();
        const result = await getPublic();
        assertPublicContent(result);
        assert.equal(result.liveBooking, false);
        assert.equal(result.bookingRetryAvailable, false);
        assert.equal(result.showDemoChrome, false);
      }
    },
  );

  await run(
    "known admission/configuration/payment blockers win over partial Google unknown observations",
    async () => {
      const restrictions = [
        [
          "Starter",
          (rows) => {
            rows.website_entitlements.plan = "starter";
          },
        ],
        [
          "no entitlement",
          (rows) => {
            rows.website_entitlements = null;
          },
        ],
        [
          "booking admission disabled",
          (rows) => {
            rows.website_entitlements.booking_admission = false;
          },
        ],
        [
          "unconfirmed",
          (rows) => {
            rows.website_entitlements.order_confirmed_at = null;
          },
        ],
        ...["expired", "suspended", "cancelled"].map((value) => [
          value,
          (rows) => {
            rows.website_entitlements.state = value;
          },
        ]),
        [
          "future entitlement",
          (rows) => {
            rows.website_entitlements.effective_at = new Date(now + 1).toISOString();
          },
        ],
        [
          "missing effective time",
          (rows) => {
            rows.website_entitlements.effective_at = null;
          },
        ],
        [
          "missing entitlement state",
          (rows) => {
            delete rows.website_entitlements.state;
          },
        ],
        [
          "ended entitlement",
          (rows) => {
            rows.website_entitlements.ends_at = new Date(now).toISOString();
          },
        ],
        [
          "missing service",
          (rows) => {
            rows.booking_services = null;
          },
        ],
        [
          "inactive service",
          (rows) => {
            rows.booking_services.active = false;
          },
        ],
        [
          "missing schedule",
          (rows) => {
            rows.availability_schedules = null;
          },
        ],
        [
          "inactive schedule",
          (rows) => {
            rows.availability_schedules.active = false;
          },
        ],
        [
          "no hours",
          (rows) => {
            rows.intervalCount = 0;
          },
        ],
        [
          "missing Stripe",
          (rows) => {
            rows.stripe_connected_accounts = null;
          },
        ],
        ...[
          { charges_enabled: false },
          { payouts_enabled: false },
          { details_submitted: false },
          { onboarding_state: "pending" },
          { onboarding_state: "restricted" },
          { onboarding_state: "disabled" },
          { capabilities: { card_payments: "inactive" } },
          ...["currently_due", "past_due", "pending_verification"].map((key) => ({
            requirements: { ...fixture().stripe_connected_accounts.requirements, [key]: ["unmet"] },
          })),
          {
            requirements: {
              ...fixture().stripe_connected_accounts.requirements,
              disabled_reason: "restricted",
            },
          },
          { requirements: {} },
        ].map((patch) => [
          JSON.stringify(patch),
          (rows) => {
            Object.assign(rows.stripe_connected_accounts, patch);
          },
        ]),
      ];
      for (const [label, change] of restrictions)
        for (const options of [
          { pending: { data: null, error: { code: "57014" } } },
          { pending: { data: {}, error: null } },
          { errorTable: "calendar_connections" },
          { errorTable: "calendar_selections" },
          { errorTable: "pipedream_bindings" },
        ]) {
          const rows = fixture();
          change(rows);
          expectPublicContent();
          expectFacts(rows, options);
          expectPublicCutover();
          const page = await getPublic();
          assertPublicContent(page);
          assert.equal(page.liveBooking, false, label);
          assert.equal(page.bookingRetryAvailable, false, label);
          assert.equal(page.showBookingPay, rows.website_entitlements === null, label);
        }
      assert.ok(
        state.calls.every(
          ({ kind }) => !["billing", "google", "stripe", "forbidden"].includes(kind),
        ),
      );
    },
  );

  await run(
    "known Google selection/disconnect blockers survive independent pending/binding failures",
    async () => {
      for (const [label, change] of [
        [
          "missing connection",
          (rows) => {
            rows.calendar_connections = null;
          },
        ],
        [
          "missing account",
          (rows) => {
            rows.calendar_connections.pipedream_account_id = null;
          },
        ],
        [
          "missing selections",
          (rows) => {
            rows.calendar_selections = [];
          },
        ],
        [
          "unwritable destination",
          (rows) => {
            rows.calendar_selections[0].access_role = "reader";
          },
        ],
        [
          "wrong connection selections",
          (rows) => {
            rows.calendar_selections[0].connection_id = "obsolete";
          },
        ],
        [
          "multiple destinations",
          (rows) => {
            rows.calendar_selections.push({ ...rows.calendar_selections[0] });
          },
        ],
        ...["verification_reason", "reconnect_reason"].flatMap((column) =>
          [
            "contractor_disconnected",
            "provider_reauthorization_required",
            "calendar_permissions_changed",
            "calendar_write_blocked",
            "calendar_selection_invalid",
            "provider_configuration_error",
          ].map((reason) => [
            `${column}:${reason}`,
            (rows) => {
              rows.calendar_connections[column] = reason;
            },
          ]),
        ),
      ])
        for (const options of [
          { pending: { data: null, error: { code: "57014" } } },
          { errorTable: "pipedream_bindings" },
        ]) {
          const rows = fixture();
          change(rows);
          expectPublicContent();
          expectFacts(rows, options);
          expectPublicCutover();
          const page = await getPublic();
          assertPublicContent(page);
          assert.equal(page.liveBooking, false, label);
          assert.equal(page.bookingRetryAvailable, false, label);
          assert.equal(page.showBookingPay, false);
          assert.equal(page.showLeadForm, true);
        }
      for (const reason of [
        null,
        "temporary",
        "platform",
        "permissions",
        "configuration",
        "reauthorization",
      ]) {
        expectPublicContent();
        expectFacts(fixture(), {
          errorTable: "pipedream_bindings",
          pending: {
            data: {
              operationId: ids.draft,
              accountId: "apn_pending",
              connectionRevision: 7,
              configurationKey: "a".repeat(64),
              blockingCalendarIds: ["busy"],
              destinationCalendarId: "destination",
              reason,
              nextRetryAt: null,
            },
            error: null,
          },
        });
        expectPublicCutover();
        const page = await getPublic();
        assertPublicContent(page);
        assert.equal(page.liveBooking, false);
        assert.equal(
          page.bookingRetryAvailable,
          false,
          "known owner setup intent is not anonymous retry",
        );
      }
    },
  );

  await run(
    "unknown is retryable only without observed blockers; stale payment and grace remain recoverable",
    async () => {
      for (const options of [
        { errorTable: "website_entitlements" },
        { errorTable: "calendar_connections" },
        { errorTable: "calendar_selections" },
        { errorTable: "pipedream_bindings" },
        { pending: { data: null, error: { code: "57014" } } },
      ])
        for (const change of [
          () => {},
          (rows) => {
            rows.website_entitlements.state = "grace";
          },
          (rows) => {
            rows.stripe_connected_accounts.charges_enabled = false;
            rows.stripe_connected_accounts.last_verified_at = staleAt;
          },
          (rows) => {
            rows.calendar_connections.verification_reason = "provider_temporary_failure";
          },
        ]) {
          const rows = fixture();
          change(rows);
          expectPublicContent();
          expectFacts(rows, options);
          expectPublicCutover();
          const page = await getPublic();
          assertPublicContent(page);
          assert.equal(page.liveBooking, false);
          assert.equal(page.bookingRetryAvailable, true);
          assert.equal(page.showBookingPay, false);
        }
    },
  );

  await run(
    "R19 preview versions and drafts cannot admit or retry with healthy or unknown facts",
    async () => {
      for (const errorTable of [undefined, "calendar_connections", "website_entitlements"])
        for (const [site, version] of [
          [website, ids.preview],
          [{ ...website, status: "draft" }, ids.version],
        ]) {
          const deps = { version, preview: "fixture-owner-preview" };
          expectPublicContent(site, deps);
          expectFacts(fixture(), { site, errorTable });
          expectPublicCutover(cutover, site);
          const result = await getPublic(site, deps);
          assertPublicContent(result, site, version);
          assert.equal(result.liveBooking, false);
          assert.equal(result.bookingRetryAvailable, false);
          assert.equal(result.showDemoChrome, false);
        }
      const draft = { ...website, status: "draft", active_version_id: null };
      expectQuery(
        "websites",
        "id, status, active_version_id, onboarding_state, user_id, environment",
        [["eq", "id", ids.website]],
        { data: draft, error: null },
      );
      expect("preview", [ids.website, "invalid-preview"], false);
      await assert.rejects(
        () => getPublic(draft, { preview: "invalid-preview" }),
        (error) => error instanceof Response && error.status === 404,
      );
      await assert.rejects(
        () =>
          publicSite.loadPublicSite({ data: { websiteId: ids.website, version: "not-a-uuid" } }),
        { name: "ZodError" },
      );
    },
  );

  await run(
    "R19 paused and mismatched runtime gates deny retry even when the first read is unknown",
    async () => {
      for (const overrides of [
        { BOOKING_LIVE_ENABLED: "false" },
        { BOOKING_LIVE_ENABLED: "" },
        { BOOKING_LIVE_ENABLED: " true " },
        { BOOKING_WORKER_MODE: "off" },
        { BOOKING_WORKER_MODE: "drain" },
        { BOOKING_WORKER_MODE: "" },
        { BOOKING_WORKER_MODE: " active " },
        { BOOKING_WORKER_ENVIRONMENT: "live" },
        { BOOKING_WORKER_ENVIRONMENT: "" },
      ]) {
        process.env = { ...env, ...overrides };
        for (const options of [
          { errorTable: "calendar_connections" },
          { errorTable: "website_entitlements" },
          { pending: { data: null, error: { code: "57014" } } },
        ]) {
          expectPublicContent();
          expectFacts(fixture(), options);
          expectPublicCutover();
          const result = await getPublic();
          assertPublicContent(result);
          assert.equal(result.liveBooking, false);
          assert.equal(result.bookingRetryAvailable, false);
        }
      }
    },
  );

  await run(
    "R19 missing/disabled/wrong-contract cutover is known denial; DB read failure permits only retry",
    async () => {
      for (const errorTable of [undefined, "calendar_connections"])
        for (const [result, retry] of [
          [{ data: { status: "disabled", target_contract_version: 2 }, error: null }, false],
          [{ data: { status: "enabled", target_contract_version: 1 }, error: null }, false],
          [{ data: null, error: { code: "57014" } }, true],
          [new Error("Fixture cutover read rejected"), true],
          [{ data: null, error: null }, false],
        ]) {
          expectPublicContent();
          expectFacts(fixture(), { errorTable });
          if (!errorTable) expectAdmission();
          expectPublicCutover(result);
          const page = await getPublic();
          assertPublicContent(page);
          assert.equal(page.liveBooking, false);
          assert.equal(page.showBookingPay, false);
          assert.equal(page.showDemoChrome, false);
          assert.equal(page.bookingRetryAvailable, retry, JSON.stringify(result));
        }
    },
  );

  await run(
    "H6 cutover RPC error then healthy table retains contact and exposes scoped retry without admission",
    async () => {
      for (const [rpc, retry] of [
        [{ data: null, error: { code: "57014" } }, true],
        [{ data: true, error: { code: "57014" } }, true],
        [new Error("Fixture cutover RPC rejected"), true],
        [{ data: false, error: null }, false],
        [{ data: null, error: null }, true],
        [{ data: "true", error: null }, true],
        [{ data: {}, error: null }, true],
      ]) {
        expectPublicContent();
        expectFacts(fixture());
        expectAdmission(website, rpc);
        expectPublicCutover();
        const page = await getPublic();
        assertPublicContent(page);
        assert.equal(page.liveBooking, false);
        assert.equal(page.showBookingPay, false);
        assert.equal(page.showLeadForm, true);
        assert.equal(page.showBuyCta, false);
        assert.equal(page.showDemoChrome, false);
        assert.equal(page.bookingConfigurationPending, false);
        assert.equal(page.bookingRetryAvailable, retry);
      }
      expectPublicContent();
      expectFacts(fixture());
      expectAdmission();
      expectPublicCutover();
      const recovered = await getPublic();
      assertPublicContent(recovered);
      assert.equal(recovered.liveBooking, true);
      assert.equal(recovered.bookingRetryAvailable, false);
      assert.ok(
        state.calls.every(
          ({ kind, args }) =>
            !["google", "stripe", "forbidden"].includes(kind) &&
            (kind !== "rpc" || args[0] !== "check_public_booking_rate_limit"),
        ),
      );
    },
  );

  await run(
    "known cutover denial survives a later table outage, even when the RPC settles at its deadline",
    async () => {
      for (const tableResult of [
        cutover,
        { data: null, error: { code: "57014" } },
        new Error("Fixture table rejected"),
        { data: { status: "enabled", target_contract_version: 2 }, error: { code: "57014" } },
      ])
        for (const late of [false, true]) {
          expectPublicContent();
          expectFacts(fixture());
          expectAdmission(website, () => {
            if (late) state.now += 10_001;
            return { data: false, error: null };
          });
          expectPublicCutover(tableResult);
          const page = await getPublic();
          assertPublicContent(page);
          assert.equal(page.liveBooking, false);
          assert.equal(page.showBookingPay, false);
          assert.equal(page.bookingRetryAvailable, false);
          assert.equal(page.showLeadForm, true);
          state.now = now;
        }
      for (const tableResult of [
        { data: { status: "disabled", target_contract_version: 2 }, error: null },
        { data: { status: "enabled", target_contract_version: 1 }, error: null },
        { data: null, error: null },
      ]) {
        expectPublicContent();
        expectFacts(fixture());
        expectAdmission(website, { data: null, error: { code: "57014" } });
        expectPublicCutover(tableResult);
        const page = await getPublic();
        assertPublicContent(page);
        assert.equal(page.liveBooking, false);
        assert.equal(
          page.bookingRetryAvailable,
          false,
          "a later definite denial also beats earlier unknown",
        );
      }
    },
  );

  await run("independent cutover RPC outage never masks a fresh Stripe restriction", async () => {
    const rows = fixture();
    rows.calendar_connections.last_verified_at = staleAt;
    rows.stripe_connected_accounts.charges_enabled = false;
    for (const rpc of [
      { data: null, error: { code: "57014" } },
      new Error("Fixture cutover RPC rejected"),
    ]) {
      expectPublicContent();
      expectFacts(rows);
      expectAdmission(website, rpc);
      expectPublicCutover();
      const page = await getPublic();
      assertPublicContent(page);
      assert.equal(page.liveBooking, false);
      assert.equal(page.bookingRetryAvailable, false);
    }
  });

  await run(
    "unknown reads cannot enable retry for a wrong billing mode or invalid tenant environment",
    async () => {
      expectPublicContent();
      expectFacts(fixture());
      expect("billing", [], "live");
      expectPublicCutover({ data: null, error: { code: "57014" } });
      const mismatch = await getPublic();
      assertPublicContent(mismatch);
      assert.equal(mismatch.liveBooking, false);
      assert.equal(mismatch.bookingRetryAvailable, false);
      const site = { ...website, environment: "invalid" };
      process.env.BOOKING_WORKER_ENVIRONMENT = "invalid";
      expectPublicContent(site);
      expectFacts(fixture(), { site, errorTable: "website_entitlements" });
      expectPublicCutover(cutover, site);
      const invalid = await getPublic(site);
      assertPublicContent(invalid, site);
      assert.equal(invalid.liveBooking, false);
      assert.equal(invalid.bookingRetryAvailable, false);
    },
  );

  await run("R17/R19 late cutover success is unknown, not booking admission", async () => {
    expectPublicContent();
    expectFacts(fixture());
    expectAdmission();
    expectPublicCutover(() => {
      check(() => {
        const context = publicSite.workerProviderContext();
        assert.ok(context?.signal instanceof AbortSignal);
        assert.equal(context.settlementDeadlineAt, now + 5_000);
      });
      state.now += 5_001;
      return cutover;
    });
    const result = await getPublic();
    assertPublicContent(result);
    assert.equal(result.liveBooking, false);
    assert.equal(result.showBookingPay, false);
    assert.equal(result.showDemoChrome, false);
    assert.equal(result.bookingRetryAvailable, true);
  });

  console.log(
    `test-booking-page-isolation: ${passed} scenarios passed (actual validators/handlers/access/readers/loaders and component props; no DOM/browser/network/SQL execution)`,
  );
} finally {
  process.env = originalEnv;
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  delete globalThis.__bookingPageIsolation;
  for (const bundle of bundles) await bundle.cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
}
