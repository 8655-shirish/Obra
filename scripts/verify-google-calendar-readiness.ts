import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  googleCalendarConnectionStatus,
  projectGoogleCalendarReadiness,
  type GoogleCalendarConnection,
} from "../src/lib/google-calendar-readiness.ts";
import {
  isGoogleAccountEmail,
  googleAccountEmail,
  pickGoogleAccountForCompletion,
  pickWritableBookingCalendar,
} from "../src/lib/google-calendar-complete.ts";
const now = Date.parse("2026-08-27T12:00:00Z");
const fresh = "2026-08-27T11:55:00Z";
const destination = {
  active: true,
  blocks_availability: true,
  receives_bookings: true,
  access_role: "owner",
  permission_verified_at: fresh,
};
assert.deepEqual(
  projectGoogleCalendarReadiness({
    healthState: "healthy",
    lastVerifiedAt: fresh,
    selections: [destination],
    triggerState: "active",
    triggerLastHealthAt: fresh,
    now,
  }).reasons,
  [],
);
assert.equal(
  projectGoogleCalendarReadiness({
    healthState: "healthy",
    lastVerifiedAt: fresh,
    selections: [],
    triggerState: "active",
    triggerLastHealthAt: fresh,
    now,
  }).state,
  "restricted",
);
assert.deepEqual(
  projectGoogleCalendarReadiness({
    healthState: "healthy",
    lastVerifiedAt: fresh,
    selections: [],
    triggerState: "active",
    triggerLastHealthAt: fresh,
    now,
  }).reasons,
  ["google_no_readable_blocking_calendar", "google_writable_destination_missing"],
);
assert.deepEqual(
  projectGoogleCalendarReadiness({
    healthState: "degraded",
    lastVerifiedAt: fresh,
    selections: [destination],
    triggerState: "active",
    triggerLastHealthAt: fresh,
    now,
  }).reasons,
  ["google_connection_degraded"],
);
assert.equal(
  projectGoogleCalendarReadiness({
    healthState: "pending",
    lastVerifiedAt: fresh,
    selections: [destination],
    triggerState: "active",
    triggerLastHealthAt: fresh,
    now,
  }).state,
  "pending",
);
assert.ok(
  projectGoogleCalendarReadiness({
    healthState: "healthy",
    lastVerifiedAt: "2026-08-27T10:00:00Z",
    selections: [destination],
    triggerState: "active",
    triggerLastHealthAt: fresh,
    now,
  }).reasons.includes("google_verification_stale"),
);

const input = {
  healthState: "healthy" as const,
  lastVerifiedAt: fresh,
  selections: [destination],
  triggerState: "active",
  triggerLastHealthAt: fresh,
  now,
};
assert.equal(projectGoogleCalendarReadiness(input).selectionsConfigured, true);
assert.equal(
  projectGoogleCalendarReadiness({ ...input, selections: [] }).selectionsConfigured,
  false,
);
for (const permission_verified_at of [
  null,
  "invalid",
  "2026-08-27T11:44:59Z",
  "2026-08-27T12:02:00Z",
]) {
  const result = projectGoogleCalendarReadiness({
    ...input,
    selections: [{ ...destination, permission_verified_at }],
  });
  assert.equal(result.ready, false);
  assert.equal(
    result.selectionsConfigured,
    true,
    "timestamp expiry cannot erase saved selection completion",
  );
  assert.deepEqual(result.reasons, ["google_selection_permissions_stale"]);
}
assert.equal(
  projectGoogleCalendarReadiness({
    ...input,
    selections: [{ ...destination, permission_verified_at: "2026-08-27T11:45:00Z" }],
  }).ready,
  true,
  "the 15-minute inclusive freshness bound is unchanged",
);
for (const extra of [
  { ...destination, receives_bookings: false, permission_verified_at: "2026-08-27T11:00:00Z" },
  { ...destination, receives_bookings: false, access_role: null },
  { ...destination, blocks_availability: false, access_role: "reader" },
  destination,
]) {
  const result = projectGoogleCalendarReadiness({ ...input, selections: [destination, extra] });
  assert.equal(
    result.ready,
    false,
    "one valid calendar cannot mask an unsafe member of the full selection set",
  );
  assert.equal(result.selectionsConfigured, extra.permission_verified_at !== fresh);
}
assert.equal(
  projectGoogleCalendarReadiness({
    ...input,
    selections: [
      { ...destination, receives_bookings: false, access_role: "freeBusyReader" },
      { ...destination, blocks_availability: false, access_role: "writer" },
    ],
  }).ready,
  true,
  "the destination need not be a blocking calendar",
);
const connection: GoogleCalendarConnection = {
  connectionRevision: 4,
  accountId: "apn_saved",
  pendingSetup: null,
  configured: true,
  healthState: "healthy",
  reason: null,
  reconnectReason: null,
  lastVerifiedAt: fresh,
  nextRetryAt: "2026-08-27T12:05:00Z",
  triggerState: "active",
  lastHealthAt: fresh,
};
assert.equal(googleCalendarConnectionStatus(connection, true), "connected");
assert.equal(googleCalendarConnectionStatus(connection, false), "checking");
for (const patch of [
  {},
  { configured: false, healthState: null },
  { reconnectReason: "provider_reauthorization_required" },
  {
    pendingSetup: {
      configurationKey: "a".repeat(64),
      reason: "reauthorization" as const,
      nextRetryAt: null,
    },
  },
])
  assert.equal(
    googleCalendarConnectionStatus(
      { ...connection, ...patch, reason: "verification_unknown" },
      true,
    ),
    "unknown",
    "a failed observation is neither healthy nor evidence for new authorization",
  );
assert.equal(
  googleCalendarConnectionStatus({ ...connection, triggerState: "degraded" }, false),
  "monitoring_repair",
);
assert.equal(
  googleCalendarConnectionStatus({ ...connection, triggerState: null }, false),
  "monitoring_repair",
);
assert.equal(
  googleCalendarConnectionStatus({ ...connection, configured: false }, false),
  "selection_required",
);
assert.equal(
  googleCalendarConnectionStatus(
    { ...connection, configured: false, healthState: "not_connected" },
    false,
  ),
  "not_connected",
);
for (const [reason, expected] of [
  ["provider_temporary_failure", "temporarily_unavailable"],
  ["provider_account_unhealthy", "temporarily_unavailable"],
  ["provider_account_missing", "temporarily_unavailable"],
  ["unknown_failure", "temporarily_unavailable"],
  ["provider_configuration_error", "service_issue"],
  ["calendar_permissions_changed", "access_issue"],
  ["calendar_write_blocked", "access_issue"],
  ["calendar_selection_invalid", "selection_required"],
  ["provider_reauthorization_required", "reconnect"],
  ["contractor_disconnected", "disconnected"],
  ["verification_stale", "checking"],
] as const) {
  assert.equal(
    googleCalendarConnectionStatus({ ...connection, healthState: "degraded", reason }, false),
    expected,
  );
  assert.equal(
    projectGoogleCalendarReadiness({ ...input, reason }).ready,
    false,
    "a persisted blocker overrides a healthy label",
  );
  if (reason !== "verification_stale")
    assert.equal(
      googleCalendarConnectionStatus(
        { ...connection, healthState: "disconnected", reconnectReason: reason },
        false,
      ),
      expected,
    );
}
assert.equal(
  googleCalendarConnectionStatus({ ...connection, healthState: "disconnected" }, false),
  "temporarily_unavailable",
  "legacy unhealthy/disconnected is not proof of revoked consent",
);
assert.equal(
  googleCalendarConnectionStatus(
    {
      ...connection,
      reason: "provider_temporary_failure",
      reconnectReason: "contractor_disconnected",
    },
    false,
  ),
  "disconnected",
  "explicit disconnect intent wins over transient evidence",
);

assert.equal(isGoogleAccountEmail("owner@example.com"), true);
assert.equal(isGoogleAccountEmail("not-an-email"), false);
assert.equal(isGoogleAccountEmail(""), false);
assert.equal(isGoogleAccountEmail("  "), false);
assert.equal(
  googleAccountEmail({ external_id: "obra:live:profile", name: "owner@example.com" }),
  "owner@example.com",
);
assert.equal(
  googleAccountEmail({ external_id: "owner@example.com", name: "Google Calendar" }),
  "owner@example.com",
);
assert.equal(googleAccountEmail({ external_id: "obra:live:profile", name: "Google" }), null);
assert.equal(
  pickGoogleAccountForCompletion({
    accounts: [{ id: "apn_old", healthy: true, createdAt: "2026-01-01T00:00:00Z" }],
  })?.id,
  "apn_old",
);
assert.equal(
  pickGoogleAccountForCompletion({
    accounts: [
      { id: "apn_old", healthy: true, createdAt: "2026-01-01T00:00:00Z" },
      { id: "apn_new", healthy: true, createdAt: "2026-02-01T00:00:00Z" },
    ],
    persistedAccountId: "apn_old",
  })?.id,
  "apn_new",
);
assert.equal(
  pickGoogleAccountForCompletion({
    accounts: [
      { id: "apn_a", healthy: true },
      { id: "apn_b", healthy: true },
    ],
    persistedAccountId: "apn_a",
  })?.id,
  "apn_a",
);
assert.equal(
  pickGoogleAccountForCompletion({
    accounts: [
      { id: "apn_old", healthy: true, createdAt: "2026-01-01T00:00:00Z" },
      { id: "apn_new", healthy: true, createdAt: "2026-02-01T00:00:00Z" },
    ],
    persistedAccountId: "apn_new",
  })?.id,
  "apn_new",
  "completion retry must not select a retained older account",
);
assert.equal(
  pickWritableBookingCalendar({
    calendars: [
      { id: "work", accessRole: "owner" },
      { id: "primary", accessRole: "owner", primary: true },
    ],
    persistedCalendarId: "work",
    sameAccount: true,
  })?.id,
  "work",
);
assert.equal(
  pickWritableBookingCalendar({
    calendars: [
      { id: "work", accessRole: "owner" },
      { id: "primary", accessRole: "owner", primary: true },
    ],
    persistedCalendarId: "work",
    sameAccount: false,
  })?.id,
  "primary",
);
assert.equal(
  pickWritableBookingCalendar({
    calendars: [{ id: "owner@example.com", accessRole: "writer" }],
    sameAccount: false,
    accountEmail: "owner@example.com",
  })?.id,
  "owner@example.com",
);

// Exercise the real fact reader with only its DB boundary replaced; no network or SQL execution.
const verifiedAt = new Date(Date.now() - 60_000).toISOString();
const connectionRow = {
  id: "connection",
  connection_revision: 4,
  pipedream_account_id: "apn_saved",
  account_email: "owner@example.test",
  health_state: "healthy",
  verification_reason: null as string | null,
  reconnect_reason: null as string | null,
  last_verified_at: verifiedAt,
};
const selectionRow = {
  ...destination,
  connection_id: "connection",
  permission_verified_at: verifiedAt,
};
const bindingRow = {
  connection_id: "connection",
  pipedream_account_id: "apn_saved",
  trigger_state: "active",
  last_health_at: verifiedAt,
  reconciliation_due_at: new Date(Date.now() + 60_000).toISOString(),
};
const rows: Record<string, { data: unknown; error: { message: string } | null; count?: number }> = {
  website_entitlements: {
    data: {
      plan: "pro",
      state: "active",
      quote_admission: true,
      booking_admission: true,
      order_confirmed_at: verifiedAt,
      effective_at: verifiedAt,
      ends_at: null,
    },
    error: null,
  },
  booking_services: { data: { id: "service", active: true }, error: null },
  calendar_connections: { data: connectionRow, error: null },
  calendar_selections: { data: [selectionRow], error: null },
  pipedream_bindings: { data: bindingRow, error: null },
  stripe_connected_accounts: {
    data: {
      stripe_account_id: "acct_saved",
      onboarding_state: "ready",
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
      capabilities: { card_payments: "active" },
      requirements: { currently_due: [], past_due: [], pending_verification: [] },
      last_verified_at: verifiedAt,
    },
    error: null,
  },
  availability_schedules: { data: { id: "schedule", active: true }, error: null },
  availability_intervals: { data: null, count: 1, error: null },
};
const pendingSetupRpc: { data: unknown; error: { code: string; message: string } | null } = {
  data: null,
  error: null,
};
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
const queries: { table: string; columns: string; filters: [string, unknown][] }[] = [];
const globals = globalThis as typeof globalThis & { __googleReadinessDb?: unknown };
const previousDb = globals.__googleReadinessDb;
const previousFetch = globalThis.fetch;
globals.__googleReadinessDb = {
  rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "get_pending_google_calendar_setup");
    assert.deepEqual(args, {
      p_profile_id: "profile",
      p_environment: "test",
      p_expected_revision:
        (rows.calendar_connections.data as { connection_revision: number } | null)
          ?.connection_revision ?? 0,
    });
    rpcCalls.push({ name, args });
    return {
      abortSignal(signal: AbortSignal) {
        assert.ok(signal instanceof AbortSignal);
        assert.equal(signal.aborted, false);
        return Promise.resolve(structuredClone(pendingSetupRpc));
      },
    };
  },
  from(table: string) {
    assert.ok(rows[table], `Unexpected table ${table}`);
    const query = { table, columns: "", filters: [] as [string, unknown][] };
    queries.push(query);
    const result = Promise.resolve(rows[table]);
    const chain = {
      select(columns: string) {
        query.columns = columns;
        return chain;
      },
      eq(column: string, value: unknown) {
        query.filters.push([column, value]);
        return chain;
      },
      in(column: string, value: unknown) {
        query.filters.push([column, value]);
        return chain;
      },
      abortSignal(signal: AbortSignal) {
        assert.ok(signal instanceof AbortSignal);
        assert.equal(signal.aborted, false);
        return chain;
      },
      limit() {
        return chain;
      },
      maybeSingle() {
        return result;
      },
      then: result.then.bind(result),
    };
    return chain;
  },
};
globalThis.fetch = async () => {
  throw new Error("Network is forbidden in the readiness verifier");
};
try {
  const bundled = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/lib/booking-readiness.server.ts", import.meta.url)),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    plugins: [
      {
        name: "readiness-db-fixture",
        setup(api) {
          api.onResolve({ filter: /^@\/integrations\/supabase\/client\.server$/ }, () => ({
            path: "db",
            namespace: "readiness-fixture",
          }));
          api.onLoad({ filter: /.*/, namespace: "readiness-fixture" }, () => ({
            contents: "export const supabaseAdmin = globalThis.__googleReadinessDb;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const { loadBookingReadinessFacts, loadPendingGoogleCalendarSetup } = (await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  )) as typeof import("../src/lib/booking-readiness.server.ts");
  const scope = {
    websiteId: "website",
    profileId: "profile",
    environment: "test" as const,
    isPublished: true,
    isActiveVersion: true,
  };
  const loaded = await loadBookingReadinessFacts(scope);
  assert.deepEqual(rpcCalls, [
    {
      name: "get_pending_google_calendar_setup",
      args: { p_profile_id: "profile", p_environment: "test", p_expected_revision: 4 },
    },
  ]);
  assert.equal(loaded.bookingAdmission, true);
  assert.deepEqual(loaded.calendarConnection, {
    connectionRevision: 4,
    accountId: "apn_saved",
    pendingSetup: null,
    configured: true,
    healthState: "healthy",
    reason: null,
    reconnectReason: null,
    lastVerifiedAt: verifiedAt,
    nextRetryAt: bindingRow.reconciliation_due_at,
    triggerState: "active",
    lastHealthAt: verifiedAt,
  });
  assert.equal(loaded.calendarAccountEmail, "owner@example.test");
  for (const query of queries) {
    assert.ok(query.filters.some(([key, value]) => key === "profile_id" && value === "profile"));
    assert.ok(query.filters.some(([key, value]) => key === "environment" && value === "test"));
  }
  assert.ok(
    queries
      .find(({ table }) => table === "calendar_connections")
      ?.columns.includes("reconnect_reason"),
  );
  assert.ok(
    queries
      .find(({ table }) => table === "calendar_connections")
      ?.columns.includes("connection_revision"),
  );
  assert.ok(
    queries
      .find(({ table }) => table === "pipedream_bindings")
      ?.columns.includes("reconciliation_due_at"),
  );

  rows.calendar_selections.data = [
    { ...selectionRow, permission_verified_at: "2000-01-01T00:00:00Z" },
  ];
  const stale = await loadBookingReadinessFacts(scope);
  assert.equal(stale.calendarConnection.configured, true);
  assert.equal(stale.availability, "configured");
  assert.equal(stale.calendar, "restricted");
  assert.equal(stale.bookingAdmission, false);
  assert.equal(stale.firstIncompleteLabel, "Check Google Calendar status");
  assert.deepEqual(stale.reasonCodes, ["google_selection_permissions_stale"]);
  rows.calendar_selections.data = [selectionRow];

  connectionRow.health_state = "degraded";
  connectionRow.verification_reason = "provider_temporary_failure";
  const temporary = await loadBookingReadinessFacts(scope);
  assert.equal(temporary.calendarConnection.configured, true);
  assert.equal(temporary.calendarConnection.reason, "provider_temporary_failure");
  assert.equal(temporary.calendarConnection.reconnectReason, null);
  assert.equal(temporary.bookingAdmission, false);
  connectionRow.reconnect_reason = "contractor_disconnected";
  assert.equal(
    googleCalendarConnectionStatus(
      (await loadBookingReadinessFacts(scope)).calendarConnection,
      false,
    ),
    "disconnected",
  );
  connectionRow.health_state = "healthy";
  connectionRow.verification_reason = null;
  connectionRow.reconnect_reason = null;

  for (const key of ["connection_id", "pipedream_account_id"] as const) {
    rows.pipedream_bindings.data = { ...bindingRow, [key]: "superseded" };
    const mismatch = await loadBookingReadinessFacts(scope);
    assert.equal(mismatch.calendarConnection.configured, true);
    assert.equal(mismatch.calendarConnection.triggerState, null);
    assert.equal(mismatch.calendarConnection.nextRetryAt, null);
    assert.equal(mismatch.calendarConnection.lastHealthAt, null);
    assert.equal(mismatch.bookingAdmission, false);
  }
  rows.pipedream_bindings.data = bindingRow;
  for (const pipedream_account_id of ["apn_saved", "apn_replacement"]) {
    rows.calendar_connections.data = {
      ...connectionRow,
      connection_revision: 5,
      pipedream_account_id,
    };
    const changed = await loadBookingReadinessFacts(scope);
    assert.equal(changed.calendarConnection.connectionRevision, 5);
    assert.equal(changed.calendarConnection.accountId, pipedream_account_id);
  }
  rows.calendar_connections.data = connectionRow;
  rows.calendar_selections.data = [{ ...selectionRow, connection_id: "superseded" }];
  assert.equal((await loadBookingReadinessFacts(scope)).calendarConnection.configured, false);
  rows.calendar_selections.data = [selectionRow];
  for (const pipedream_account_id of [null, "", " "]) {
    rows.calendar_connections.data = { ...connectionRow, pipedream_account_id };
    const missingIdentity = await loadBookingReadinessFacts(scope);
    assert.equal(
      missingIdentity.calendarConnection.configured,
      false,
      "saved email is not account identity",
    );
    assert.equal(missingIdentity.bookingAdmission, false);
  }
  rows.calendar_connections.data = null;
  const absent = await loadBookingReadinessFacts(scope);
  assert.equal(absent.calendarConnection.connectionRevision, null);
  assert.equal(absent.calendarConnection.accountId, null);
  assert.equal(absent.bookingAdmission, false);

  const pendingConnection = {
    ...connectionRow,
    pipedream_account_id: null,
    account_email: null,
    health_state: "not_connected",
    setup_operation_id: "operation-a",
    setup_actor_auth_user_id: "owner",
    setup_account_id: "apn_pending",
    setup_expected_revision: 4,
    setup_calendar_id: "destination",
    setup_purpose: "configuration",
    setup_completed_at: null,
    setup_calendars: [
      { id: "conflicts-b", blocksAvailability: true, receivesBookings: false },
      { id: "conflicts-a", blocksAvailability: true, receivesBookings: false },
      { id: "destination", blocksAvailability: false, receivesBookings: true },
    ],
    setup_failure_reason: "permissions",
    setup_probe_account_id: "apn_pending",
    setup_probe_calendar_id: "destination",
    setup_retry_at: verifiedAt,
  };
  rows.calendar_connections.data = pendingConnection;
  rows.calendar_selections.data = [];
  rows.pipedream_bindings.data = null;
  const pendingProjection = {
    operationId: "operation-a",
    accountId: "apn_pending",
    connectionRevision: 4,
    configurationKey: "a".repeat(64),
    blockingCalendarIds: ["conflicts-b", "conflicts-a"],
    destinationCalendarId: "destination",
    reason: "permissions",
    nextRetryAt: verifiedAt,
  };
  pendingSetupRpc.data = pendingProjection;
  const pending = await loadBookingReadinessFacts(scope);
  assert.equal(pending.calendarConnection.configured, false);
  assert.equal(pending.calendarConnection.accountId, null);
  assert.equal(pending.calendarAccountEmail, null);
  assert.equal(pending.calendar, "pending");
  assert.equal(pending.bookingAdmission, false);
  assert.equal(pending.providerRefreshEligible, false);
  assert.equal(pending.firstIncompleteLabel, "Review Google Calendar setup");
  assert.ok(pending.reasonCodes.includes("google_setup_pending"));
  assert.equal(googleCalendarConnectionStatus(pending.calendarConnection, true), "access_issue");
  assert.deepEqual(Object.keys(pending.calendarConnection.pendingSetup!).sort(), [
    "configurationKey",
    "nextRetryAt",
    "reason",
  ]);
  const ownerPending = await loadPendingGoogleCalendarSetup({
    ...scope,
    connection: pendingConnection,
  });
  assert.deepEqual(ownerPending, {
    operationId: "operation-a",
    accountId: "apn_pending",
    connectionRevision: 4,
    configurationKey: pending.calendarConnection.pendingSetup!.configurationKey,
    blockingCalendarIds: ["conflicts-a", "conflicts-b"],
    destinationCalendarId: "destination",
    reason: "permissions",
    nextRetryAt: verifiedAt,
  });
  for (const [reason, expected] of [
    [null, "setup_pending"],
    ["temporary", "setup_pending"],
    ["platform", "service_issue"],
    ["reauthorization", "reconnect"],
    ["configuration", "selection_required"],
  ] as const) {
    assert.equal(
      googleCalendarConnectionStatus(
        {
          ...pending.calendarConnection,
          pendingSetup: { ...pending.calendarConnection.pendingSetup!, reason },
        },
        true,
      ),
      expected,
    );
  }
  // Authority moved into this service-only SQL snapshot; it must not be recreated
  // from client-readable profile/disconnect rows or stale fields on the input.
  const lifetimeSql = readFileSync(
    new URL("../supabase/migrations/20260910120000_google_calendar_lifetime.sql", import.meta.url),
    "utf8",
  );
  const pendingSql = lifetimeSql.match(
    /create function public\.get_pending_google_calendar_setup\([\s\S]*?end \$\$;/,
  )?.[0];
  const keySql = lifetimeSql.match(
    /create function public\.google_calendar_setup_configuration_key\([\s\S]*?end \$\$;/,
  )?.[0];
  assert.ok(pendingSql && keySql);
  for (const marker of [
    "coalesce(c.connection_revision,0)<>p_expected_revision",
    "c.setup_operation_id is null or c.setup_completed_at is not null or c.setup_purpose<>'configuration'",
    "c.setup_expected_revision is distinct from c.connection_revision",
    "nullif(btrim(c.setup_account_id),'') is null",
    "jsonb_array_length(c.setup_calendars) not between 1 and 251",
    "x->'blocksAvailability'='true'::jsonb",
    "x->>'id'=c.setup_calendar_id and x->'receivesBookings'='true'::jsonb",
    "count(distinct x->>'id')",
    "jsonb_typeof(x->'blocksAvailability') is distinct from 'boolean'",
    "jsonb_typeof(x->'receivesBookings') is distinct from 'boolean'",
    "configuration_key:=public.google_calendar_setup_configuration_key(c)",
    "if configuration_key is null then return null",
    "c.setup_probe_account_id=c.setup_account_id and c.setup_probe_calendar_id=c.setup_calendar_id",
  ])
    assert.ok(pendingSql.includes(marker), "missing pending setup authority: " + marker);
  for (const marker of [
    "p.auth_user_id=p_connection.setup_actor_auth_user_id",
    "p.id=p_connection.profile_id and p.environment=p_connection.environment",
    "d.profile_id=p_connection.profile_id",
    "d.environment=p_connection.environment",
    "d.provider_account_id=p_connection.setup_account_id and d.state in ('pending','completed')",
  ])
    assert.ok(keySql.includes(marker), "missing setup ownership/disconnect guard: " + marker);
  assert.ok(
    lifetimeSql.includes(
      "revoke all on function public.get_pending_google_calendar_setup(uuid,text,bigint) from public,anon,authenticated,service_role,booking_worker",
    ),
  );
  assert.ok(
    lifetimeSql.includes(
      "grant execute on function public.get_pending_google_calendar_setup(uuid,text,bigint) to service_role",
    ),
  );
  assert.doesNotMatch(pendingSql + keySql, /\b(?:insert into|update public\.|delete from)\b/i);
  const staleInput = {
    ...pendingConnection,
    setup_account_id: "apn_stale",
    setup_actor_auth_user_id: "not-owner",
  };
  assert.deepEqual(
    await loadPendingGoogleCalendarSetup({ ...scope, connection: staleInput }),
    ownerPending,
    "only the scoped SQL snapshot may supply current owner choices",
  );
  for (const patch of [
    { operationId: "" },
    { accountId: null },
    { connectionRevision: 3 },
    { configurationKey: "invalid" },
    { blockingCalendarIds: [] },
    { blockingCalendarIds: [true] },
    { destinationCalendarId: "" },
    { reason: "unclassified" },
    { nextRetryAt: 123 },
    { profileId: "unexpected-private-field" },
  ]) {
    pendingSetupRpc.data = { ...pendingProjection, ...patch };
    await assert.rejects(
      loadPendingGoogleCalendarSetup({ ...scope, connection: pendingConnection }),
      /Unable to load pending/,
    );
    const unknown = await loadBookingReadinessFacts(scope);
    assert.equal(unknown.plan, "pro");
    assert.equal(unknown.orderConfirmed, true);
    assert.equal(unknown.availability, "configured");
    assert.equal(unknown.bookingAdmission, false);
    assert.equal(unknown.providerRefreshEligible, false);
    assert.equal(unknown.calendarConnection.reason, "verification_unknown");
    assert.equal(googleCalendarConnectionStatus(unknown.calendarConnection, false), "unknown");
  }
  pendingSetupRpc.data = null;
  assert.equal(
    await loadPendingGoogleCalendarSetup({ ...scope, connection: pendingConnection }),
    null,
    "SQL-rejected owner intent cannot be resurrected from stale input fields",
  );
  assert.equal((await loadBookingReadinessFacts(scope)).bookingAdmission, false);
  assert.equal(
    queries.some(
      ({ table }) => table === "profiles" || table === "booking_provider_account_disconnects_v3",
    ),
    false,
  );
  pendingSetupRpc.data = { ...pendingProjection, reason: null };
  const cleanup = await loadPendingGoogleCalendarSetup({
    ...scope,
    connection: {
      ...pendingConnection,
      setup_probe_account_id: "apn_previous",
      setup_failure_reason: "reauthorization",
    },
  });
  assert.equal(cleanup?.reason, null, "superseded cleanup cannot blame the current account");
  assert.equal(cleanup?.accountId, "apn_pending");
  pendingSetupRpc.data = {
    ...pendingProjection,
    accountId: "apn_B",
    configurationKey: "b".repeat(64),
  };
  const changed = await loadPendingGoogleCalendarSetup({
    ...scope,
    connection: { ...pendingConnection, setup_account_id: "apn_B" },
  });
  assert.notEqual(changed?.configurationKey, ownerPending?.configurationKey);
  pendingSetupRpc.data = {
    ...pendingProjection,
    blockingCalendarIds: [...pendingProjection.blockingCalendarIds].reverse(),
  };
  const reordered = await loadPendingGoogleCalendarSetup({
    ...scope,
    connection: {
      ...pendingConnection,
      setup_calendars: [...pendingConnection.setup_calendars].reverse(),
    },
  });
  assert.equal(reordered?.configurationKey, ownerPending?.configurationKey);
  assert.deepEqual(reordered?.blockingCalendarIds, ownerPending?.blockingCalendarIds);
  pendingSetupRpc.error = { code: "40001", message: "fixture revision collision" };
  await assert.rejects(
    loadPendingGoogleCalendarSetup({ ...scope, connection: pendingConnection }),
    /Unable to load pending/,
  );
  rows.calendar_connections.data = connectionRow;
  rows.calendar_selections.data = [selectionRow];
  rows.pipedream_bindings.data = bindingRow;
  for (const plan of ["pro", "starter"])
    for (const code of ["40001", "42501", "57014"]) {
      const entitlement = rows.website_entitlements.data as { plan: string };
      entitlement.plan = plan;
      pendingSetupRpc.error = { code, message: "fixture pending read failed" };
      const start = queries.length;
      const unknown = await loadBookingReadinessFacts(scope);
      assert.equal(unknown.plan, plan);
      assert.equal(unknown.orderConfirmed, true);
      assert.equal(unknown.availability, "configured");
      assert.equal(unknown.payments, "ready");
      assert.equal(unknown.showLeadForm, true);
      assert.equal(unknown.showDemo, false);
      assert.equal(unknown.bookingAdmission, false);
      assert.equal(unknown.providerRefreshEligible, false);
      assert.equal(unknown.calendarConnection.configured, true);
      assert.equal(unknown.calendarConnection.connectionRevision, 4);
      assert.equal(unknown.calendarConnection.accountId, "apn_saved");
      assert.equal(unknown.calendarConnection.healthState, null);
      assert.equal(unknown.calendarConnection.reason, "verification_unknown");
      assert.equal(unknown.calendarAccountEmail, "owner@example.test");
      assert.equal(unknown.paymentDashboardAvailable, true);
      assert.equal(
        queries.slice(start).filter(({ table }) => table === "website_entitlements").length,
        1,
      );
      assert.ok(unknown.reasonCodes.includes("booking_readiness_unknown"));
    }
  (rows.website_entitlements.data as { plan: string }).plan = "pro";
  pendingSetupRpc.error = null;
  pendingSetupRpc.data = null;
  for (const table of ["calendar_connections", "calendar_selections", "pipedream_bindings"]) {
    rows[table].error = { message: "fixture optional read failure" };
    const unknown = await loadBookingReadinessFacts(scope);
    assert.equal(unknown.plan, "pro");
    assert.equal(unknown.orderConfirmed, true);
    assert.equal(unknown.availability, "configured");
    assert.equal(unknown.payments, "ready");
    assert.equal(unknown.bookingAdmission, false);
    assert.equal(unknown.providerRefreshEligible, false);
    assert.equal(unknown.calendarConnection.reason, "verification_unknown");
    assert.equal(unknown.calendarConnection.configured, table === "pipedream_bindings");
    rows[table].error = null;
  }
  for (const table of [
    "website_entitlements",
    "booking_services",
    "stripe_connected_accounts",
    "availability_schedules",
    "availability_intervals",
  ]) {
    rows[table].error = { message: "fixture checked read failure" };
    await assert.rejects(
      loadBookingReadinessFacts(scope),
      /Unable to load (booking|availability) readiness/,
    );
    rows[table].error = null;
  }
  assert.equal((await loadBookingReadinessFacts(scope)).bookingAdmission, true);
} finally {
  globalThis.fetch = previousFetch;
  if (previousDb === undefined) delete globals.__googleReadinessDb;
  else globals.__googleReadinessDb = previousDb;
}
console.log("verify-google-calendar-readiness: ok");
