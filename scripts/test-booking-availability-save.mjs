import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const websiteId = "11111111-1111-4111-8111-111111111111";
const profileId = "profile-fixture",
  authUserId = "auth-fixture";
const access = { mode: "contractor", profileId };
const privateData = "private-detail: customer@example.test; 123 Example Street";
const invalid = "INVALID_AVAILABILITY: Check appointment details, price, time zone, and hours.";
const generic =
  "Unable to save availability. Please try again. If this continues, contact support.";
const base = {
  websiteId,
  serviceRevision: null,
  scheduleRevision: null,
  service: {
    name: "Appointment",
    description: "Fixture visit",
    durationMinutes: 75,
    slotIntervalMinutes: 15,
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 20,
    minimumNoticeMinutes: 180,
    bookingHorizonDays: 45,
    locationType: "remote",
    locationInstructions: "Online",
    amountMinor: 12345,
  },
  timeZone: "America/New_York",
  intervals: [{ weekday: 2, localStart: "08:30", localEnd: "16:45", sortOrder: 0 }],
  overrides: [],
};
const ownerFilters = [
  ["eq", "profile_id", profileId],
  ["eq", "environment", "test"],
];
const entitlementFilters = [["eq", "website_id", websiteId], ...ownerFilters];
const dbError = (code, message = privateData) => ({
  code,
  message,
  details: privateData,
  hint: privateData,
});
const rpcLog = (code) => [
  [
    "error",
    "[saveBookingAvailability]",
    {
      operation: "save_shared_booking_availability",
      code,
    },
  ],
];
const state = { expected: [], unexpected: [], logs: [], pending: 0 };
const expect = (kind, args, value) => state.expected.push({ kind, args, value });

function take(kind, args) {
  const step = state.expected.shift();
  try {
    assert.ok(step, `Unexpected ${kind}`);
    // Only entitlement timestamps vary; every query method, column and filter is checked.
    if (kind === "query")
      args = args.map((call, i) =>
        call.map((value, j) => {
          const wanted = step.args[i]?.[j];
          if (!(wanted instanceof RegExp)) return value;
          assert.match(value, wanted);
          return wanted;
        }),
      );
    assert.deepEqual({ kind, args }, { kind: step.kind, args: step.args });
  } catch (error) {
    state.unexpected.push(error.message);
    throw error;
  }
  if (step.value instanceof Error) throw step.value;
  return step.value;
}
state.take = take;
state.db = {
  from(table) {
    const calls = [["from", table]];
    state.pending++;
    const query = new Proxy(
      {},
      {
        get(_target, method) {
          if (method === "then")
            return (resolve, reject) => {
              state.pending--;
              return Promise.resolve()
                .then(() => take("query", calls))
                .then(resolve, reject);
            };
          return (...args) => {
            calls.push([method, ...args]);
            return query;
          };
        },
      },
    );
    return query;
  },
  async rpc(name, args) {
    return take("rpc", [name, args]);
  },
};
function query(table, columns, filters, data, terminal = "maybeSingle") {
  expect(
    "query",
    [["from", table], ["select", columns], ...filters, ...(terminal ? [[terminal]] : [])],
    { data, error: null },
  );
}
function expectSave(
  data,
  { error = null, denied, mode = "contractor", session = authUserId, pro = true } = {},
) {
  expect(
    "websiteAccess",
    [websiteId],
    denied === "website" ? new Error("Forbidden") : { mode, profileId },
  );
  if (denied === "website" || mode !== "contractor") return;
  expect("profileAccess", [profileId], denied === "profile" ? new Error("Forbidden") : access);
  if (denied === "profile") return;
  expect("session", [], session);
  if (!session) return;
  query("websites", "environment", [["eq", "id", websiteId]], { environment: "test" }, "single");
  query(
    "website_entitlements",
    "id",
    [
      ...entitlementFilters,
      ["eq", "plan", "pro"],
      ["in", "state", ["active", "grace"]],
      ["not", "order_confirmed_at", "is", null],
      ["not", "effective_at", "is", null],
      ["lte", "effective_at", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/],
      ["or", /^ends_at\.is\.null,ends_at\.gt\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/],
    ],
    pro ? { id: "entitlement-fixture" } : null,
  );
  if (!pro) return;
  expect(
    "rpc",
    [
      "save_shared_booking_availability",
      {
        p_website_id: websiteId,
        p_profile_id: profileId,
        p_environment: "test",
        p_auth_user_id: authUserId,
        p_service_revision: data.serviceRevision,
        p_schedule_revision: data.scheduleRevision,
        p_service: {
          ...data.service,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
        },
        p_schedule: { timeZone: data.timeZone },
        p_intervals: data.intervals,
        p_overrides: data.overrides,
      },
    ],
    { data: null, error },
  );
}
function expectReload(serviceRevision, scheduleRevision, failure) {
  const entitlement = {
    plan: "pro",
    state: "active",
    booking_admission: true,
    order_confirmed_at: "2020-01-01T00:00:00Z",
    effective_at: "2020-01-01T00:00:00Z",
    ends_at: null,
  };
  const readiness = { canEnablePaidBooking: true };
  expect("websiteAccess", [websiteId], access);
  query(
    "websites",
    "id, user_id, environment, status",
    [["eq", "id", websiteId]],
    { id: websiteId, user_id: profileId, environment: "test", status: "live" },
    "single",
  );
  expect("profileAccess", [profileId], access);
  query(
    "profiles",
    "id, business_name, full_name",
    [["eq", "id", profileId]],
    { id: profileId, business_name: "Fixture business", full_name: "Fallback fixture" },
    "single",
  );
  query(
    "website_entitlements",
    "plan, state, booking_admission, order_confirmed_at, effective_at, ends_at",
    entitlementFilters,
    entitlement,
  );
  query("booking_services", "*", ownerFilters, {
    id: "service-fixture",
    revision: serviceRevision,
    name: "Reloaded appointment",
    description: "Fixture visit",
    duration_minutes: 75,
    slot_interval_minutes: 15,
    buffer_before_minutes: 10,
    buffer_after_minutes: 20,
    minimum_notice_minutes: 180,
    booking_horizon_days: 45,
    location_type: "remote",
    location_instructions: "Online",
    amount_minor: 12345,
  });
  expect(
    "readiness",
    {
      websiteId,
      profileId,
      environment: "test",
      isPublished: true,
      isActiveVersion: true,
    },
    failure ?? readiness,
  );
  if (failure) return;
  query("availability_schedules", "*", [...ownerFilters, ["eq", "service_id", "service-fixture"]], {
    id: "schedule-fixture",
    revision: scheduleRevision,
    time_zone: base.timeZone,
  });
  query(
    "availability_intervals",
    "weekday, local_start, local_end, sort_order",
    [
      ["eq", "schedule_id", "schedule-fixture"],
      ["order", "weekday"],
      ["order", "sort_order"],
    ],
    [{ weekday: 2, local_start: "08:30:00", local_end: "16:45:00", sort_order: 0 }],
    null,
  );
  query(
    "availability_overrides",
    "id,local_date,override_type,reason,availability_override_intervals(local_start,local_end,sort_order)",
    [
      ["eq", "schedule_id", "schedule-fixture"],
      ["order", "local_date"],
    ],
    [],
    null,
  );
  return {
    accessMode: "contractor",
    website: { id: websiteId, status: "live" },
    profile: { id: profileId, name: "Fixture business" },
    entitlement,
    readiness,
    configuration: {
      serviceRevision,
      scheduleRevision,
      service: {
        ...base.service,
        name: "Reloaded appointment",
        currency: "USD",
        paymentPolicy: "full_amount",
      },
      timeZone: base.timeZone,
      intervals: base.intervals,
      overrides: [],
    },
  };
}

const originalFetch = globalThis.fetch;
const originalConsole = Object.fromEntries(
  ["error", "warn", "log", "info", "debug"].map((key) => [key, console[key]]),
);
let bundle,
  networkCalls = 0,
  passed = 0,
  failed = 0;
async function run(name, body, logs = []) {
  Object.assign(state, { expected: [], unexpected: [], logs: [], pending: 0 });
  try {
    await body();
    // A reload catch must not hide a failing mock expectation.
    assert.deepEqual(state.unexpected, []);
    assert.equal(state.expected.length, 0, "all expected operations must execute");
    assert.equal(state.pending, 0, "queries must be awaited exactly once");
    assert.deepEqual(
      state.logs,
      logs,
      "diagnostics must contain only the operation and sanitized code",
    );
    assert.equal(networkCalls, 0, "no real provider or database requests");
    passed++;
    originalConsole.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    originalConsole.error(`FAIL: ${name}`, error);
  }
}
async function rejects(data, message) {
  await assert.rejects(
    () => bundle.subject.saveBookingAvailability({ data }),
    (error) => {
      assert.equal(error.name, "Error");
      assert.equal(error.message, message);
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(JSON.stringify(error), /private-detail|customer@example\.test/);
      return true;
    },
  );
}

try {
  globalThis.__bookingAvailabilitySaveTest = state;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Unexpected network request");
  };
  for (const key of Object.keys(originalConsole))
    console[key] = (...args) => state.logs.push([key, ...args]);
  bundle = await importWithMocks(path.resolve("src/lib/booking-setup.functions.ts"), {
    "@tanstack/react-start": `
      export function createServerFn() {
        return { validator(validate) {
          return { handler(handle) { return async ({ data }) => handle({ data: await validate(data) }); } };
        } };
      }
    `,
    "@/lib/jobs/access.server": `
      const s = globalThis.__bookingAvailabilitySaveTest;
      export const assertWebsiteWorkspaceAccess = async (id) => s.take("websiteAccess", [id]);
      export const assertProfileWorkspaceAccess = async (id) => s.take("profileAccess", [id]);
    `,
    "@/lib/auth/contractor-session.server": `
      export const getContractorAuthUserId = async () => globalThis.__bookingAvailabilitySaveTest.take("session", []);
    `,
    "@/integrations/supabase/client.server": `export const supabaseAdmin = globalThis.__bookingAvailabilitySaveTest.db;`,
    "@/lib/booking-readiness.server": `
      export const loadBookingReadinessFacts = async (input) => globalThis.__bookingAvailabilitySaveTest.take("readiness", input);
    `,
  });

  let saved;
  await run(
    "first save: null revisions, empty overrides, integer cents, authoritative reload",
    async () => {
      expectSave(base);
      const expected = expectReload(1, 1);
      const data = {
        ...structuredClone(base),
        timeZone: ` ${base.timeZone} `,
        service: { ...base.service, name: " Appointment ", ignored: privateData },
      };
      saved = await bundle.subject.saveBookingAvailability({ data });
      assert.deepEqual(saved, expected);
    },
  );
  await run("repeat save: returned revisions forwarded and refreshed", async () => {
    assert.ok(saved, "the first save must succeed");
    const data = { websiteId, ...structuredClone(saved.configuration) };
    expectSave({ ...data, service: { ...base.service, name: "Reloaded appointment" } });
    const expected = expectReload(2, 3);
    assert.deepEqual(await bundle.subject.saveBookingAvailability({ data }), expected);
  });

  const malformed = [
    ...[0, -1, Number.MAX_SAFE_INTEGER + 1, 12.5].map((amountMinor) => [
      `amount ${amountMinor}`,
      { service: { ...base.service, amountMinor } },
    ]),
    ["empty intervals", { intervals: [] }],
    ...[
      { localStart: "25:00" },
      { localEnd: "08:30" },
      { localEnd: "08:00" },
      { weekday: 7 },
      { sortOrder: 0.5 },
    ].map((patch) => [
      `interval ${JSON.stringify(patch)}`,
      { intervals: [{ ...base.intervals[0], ...patch }] },
    ]),
    ["duplicate interval order", { intervals: [base.intervals[0], base.intervals[0]] }],
    ["invalid IANA input", { timeZone: "Not/A_Time_Zone" }],
    [
      "custom override without hours",
      { overrides: [{ localDate: "2030-01-01", type: "custom_hours", intervals: [] }] },
    ],
  ];
  for (const [name, patch] of malformed)
    await run(`validation before access/RPC: ${name}`, async () => {
      await rejects({ ...structuredClone(base), ...patch }, invalid);
    });

  for (const [name, code, message, expected] of [
    [
      "internal ambiguous column",
      "42702",
      `column reference is ambiguous: ${privateData}`,
      generic,
    ],
    ["internal schema cache", "PGRST202", `Could not find the function: ${privateData}`, generic],
    ["unknown database code", "XX000", privateData, generic],
    ["unlisted class 22 code", "22000", privateData, generic],
    [
      "overlap",
      "23P01",
      privateData,
      "INVALID_AVAILABILITY: Availability windows overlap. Adjust your hours or date overrides.",
    ],
    [
      "database IANA validation",
      "P0001",
      "invalid time zone",
      "INVALID_AVAILABILITY: Enter a valid IANA time zone.",
    ],
    ["unrecognized time zone text", "P0001", `invalid time zone: ${privateData}`, generic],
    ...["22023", "22007", "22008", "22P02", "22003", "23514"].map((code) => [
      "known settings code",
      code,
      privateData,
      invalid,
    ]),
  ])
    await run(
      `${name}: ${code}`,
      async () => {
        expectSave(base, { error: dbError(code, message) });
        await rejects(base, expected);
      },
      rpcLog(code),
    );

  for (const kind of ["service", "schedule"])
    await run(
      `${kind} revision conflict: sentinel, input preserved, no retry/reload`,
      async () => {
        const data = {
          ...structuredClone(base),
          serviceRevision: 7,
          scheduleRevision: 11,
          overrides: [
            { localDate: "2030-01-01", type: "unavailable", reason: privateData, intervals: [] },
          ],
        };
        const before = structuredClone(data);
        expectSave(before, {
          error: dbError("P0001", `${kind} ReViSiOn CoNfLiCt: ${privateData}`),
        });
        await rejects(data, "REVISION_CONFLICT");
        assert.deepEqual(data, before);
      },
      rpcLog("P0001"),
    );

  for (const [name, options, message] of [
    ["website access denied", { denied: "website" }, "Forbidden"],
    ["profile access denied", { denied: "profile" }, "Forbidden"],
    ["impersonation", { mode: "admin" }, "Availability cannot be changed while impersonating"],
    ["absent session", { session: null }, "Unauthorized"],
    ["absent Pro", { pro: false }, "An active Pro entitlement is required for booking setup"],
  ])
    await run(`no save allowed: ${name}`, async () => {
      expectSave(base, options);
      await rejects(base, message);
    });

  await run(
    "successful RPC, failed reload: saved sentinel and no raw diagnostic data",
    async () => {
      expectSave(base);
      expectReload(
        1,
        1,
        Object.assign(new Error(privateData), { code: "42702", details: privateData }),
      );
      await rejects(base, "AVAILABILITY_SAVED_RELOAD_REQUIRED");
    },
    [["error", "[saveBookingAvailability]", { operation: "reload_setup_after_save" }]],
  );

  for (const [name, code] of [
    ["missing", undefined],
    ["null", null],
    ["numeric", 42702],
    ["object", { detail: privateData }],
    ["SQLSTATE with private suffix", `42702 ${privateData}`],
    ["PostgREST with private newline", `PGRST202\n${privateData}`],
    ["SQLSTATE with trailing newline", "42702\n"],
    ["PostgREST with trailing newline", "PGRST202\n"],
  ]) {
    await run(
      `untrusted code sanitized: ${name}`,
      async () => {
        expectSave(base, { error: dbError(code) });
        await rejects(base, generic);
      },
      rpcLog("unknown"),
    );
  }
  originalConsole.log(
    `${failed ? "FAIL" : "PASS"}: ${passed} passed, ${failed} failed; ${networkCalls} network calls`,
  );
  if (failed) process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  Object.assign(console, originalConsole);
  delete globalThis.__bookingAvailabilitySaveTest;
  await bundle?.cleanup();
}
