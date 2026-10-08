import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

if (process.argv.includes("--sql") || process.argv.includes("--sql-child")) {
  await testSqlHandoffs();
} else {
  const ids = {
    website: "11111111-1111-4111-8111-111111111111",
    profile: "22222222-2222-4222-8222-222222222222",
    connection: "33333333-3333-4333-8333-333333333333",
    operation: "66666666-6666-4666-8666-666666666666",
    account: "apn_completion",
    binding: "44444444-4444-4444-8444-444444444444",
    component: "sc_completion",
  };
  const componentKey = "google_calendar-new-or-updated-event-instant";
  const definition = {
    key: componentKey,
    name: "New Created or Updated Event (Instant)",
    version: "1.2.3",
    configurableProps: [
      { name: "googleCalendar", type: "app", app: "google_calendar" },
      { name: "calendarIds", type: "string[]" },
      { name: "newOnly", type: "boolean" },
    ],
  };
  const scope = "https://www.googleapis.com/auth/calendar";
  const defaultScopes = [`${scope}.events`, `${scope}.readonly`];
  const calendar = {
    id: "owner@example.test",
    summary: "Bookings",
    accessRole: "owner",
    timeZone: "UTC",
    primary: true,
  };
  const state = {};
  function reset(scopes = defaultScopes, environment = "test") {
    Object.assign(state, {
      scopes,
      environment,
      steps: [],
      connection: null,
      selections: [],
      binding: null,
      probe: null,
      failAt: null,
      forbidden: false,
      ownerOnly: false,
      blockedIdentity: false,
      calendars: [
        calendar,
        { id: "busy@example.test", summary: "Conflicts", accessRole: "reader", timeZone: "UTC" },
      ],
      persists: [],
      refreshes: [],
      freeBusy: [],
      probes: [],
      rpc: [],
      maintenance: false,
      maintenanceCalls: [],
      deployedComponentId: ids.component,
      definition: structuredClone(definition),
      cookie: ids.operation,
      pendingSetupKey: null,
      replacePendingDuringRead: false,
    });
  }
  state.call = (name) => {
    if (state.maintenance) {
      state.maintenanceCalls.push(name);
      return;
    }
    state.steps.push(name);
    if (state.failAt === name) throw new Error(`Safe failure at ${name}`);
  };
  state.authorize = (websiteId, provider, mutation) => {
    assert.equal(websiteId, ids.website);
    assert.equal(provider, "Google Calendar");
    if (state.forbidden || (mutation && state.ownerOnly)) throw new Error("Forbidden");
    return {
      profile: { id: ids.profile },
      website: { id: ids.website, environment: state.environment },
      authUserId: "owner-fixture",
      supabaseAdmin: state.supabaseAdmin,
    };
  };
  state.persist = async (input) => {
    state.call("persist");
    assert.equal(input.expectedRevision, state.probe.connection_revision);
    assert.equal(input.setupOperationId, ids.operation);
    assert.ok(Number.isFinite(Date.parse(input.verifiedAt)));
    assert.equal(input.pipedreamAccountId, ids.account);
    assert.equal(input.environment, state.environment);
    assert.equal(input.externalUserId, `obra:${state.environment}:${ids.profile}`);
    assert.equal(state.steps.includes("probe"), true);
    state.persists.push(input);
    state.connection = {
      id: ids.connection,
      pipedream_account_id: ids.account,
      connection_revision: input.expectedRevision + 1,
    };
    state.selections = input.calendars.map((selection) => ({
      google_calendar_id: selection.id,
      blocks_availability: selection.blocksAvailability,
      receives_bookings: selection.receivesBookings,
    }));
  };
  state.reserve = async (input) => {
    state.call("reserve-probe");
    if ((input.expectedSetupKey ?? null) !== state.pendingSetupKey)
      throw new Error("Stale pending setup key");
    state.reserved = input;
    assert.equal(input.expectedRevision, state.connection?.connection_revision ?? 0);
    state.probe = {
      id: ids.operation,
      connection_revision: state.connection?.connection_revision ?? 1,
    };
    return state.probe;
  };
  state.refresh = async (input, verify) => {
    state.call("refresh-saved");
    assert.deepEqual(
      {
        profileId: input.profileId,
        environment: input.environment,
        allowRepair: input.allowRepair,
      },
      { profileId: ids.profile, environment: state.environment, allowRepair: true },
    );
    assert.ok(input.deadlineAt > Date.now());
    state.refreshes.push(input);
    state.maintenance = true;
    try {
      return await verify(input);
    } finally {
      state.maintenance = false;
    }
  };
  state.maintenanceRpc = (name, args) => {
    if (name === "claim_saved_google_calendar_verification") {
      if (!state.connection) return null;
      state.binding ??= {
        id: ids.binding,
        profile_id: ids.profile,
        environment: state.environment,
        connection_id: ids.connection,
        pipedream_account_id: ids.account,
        configuration_revision: state.connection.connection_revision,
        component_key: componentKey,
        component_version: "pending",
        deployed_trigger_id: null,
        webhook_id: null,
        webhook_correlation_id: ids.operation,
        trigger_state: "not_deployed",
        selected_calendar_ids: state.selections
          .filter((s) => s.blocks_availability)
          .map((s) => s.google_calendar_id),
        reconciliation_fencing_token: 1,
        reconciliation_lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
        deployment_operation_id: null,
        deployment_candidate_trigger_id: null,
        deployment_dispatched_at: null,
        deployment_receipt: null,
        retired_trigger_ids: [],
        pending_trigger_deletions: [],
      };
      state.binding.reconciliation_lease_token = args.p_lease_token;
      state.binding.reconciliation_fencing_token++;
      return {
        connection: {
          ...state.connection,
          profile_id: ids.profile,
          environment: state.environment,
        },
        binding: structuredClone(state.binding),
        selections: state.selections,
        cleanup_only: false,
      };
    }
    if (name === "mark_google_calendar_connection_verified") return true;
    if (name === "reserve_pipedream_trigger_deployment") {
      Object.assign(state.binding, {
        component_version: args.p_component_version,
        deployment_operation_id: ids.operation,
      });
      return structuredClone(state.binding);
    }
    if (name === "begin_pipedream_trigger_deployment_effect") {
      Object.assign(state.binding, {
        deployment_dispatched_at: new Date().toISOString(),
        deployment_dispatch_lease_token: args.p_lease_token,
        deployment_dispatch_fencing_token: args.p_fencing_token,
      });
      return true;
    }
    if (name === "record_pipedream_trigger_deployment_result") return false;
    if (name === "claim_google_calendar_setup_probe") return null;
    if (name === "adopt_pipedream_trigger_candidate") {
      state.binding.deployment_candidate_trigger_id = args.p_deployed_trigger_id;
      if (args.p_component_id !== undefined) {
        assert.equal(args.p_lease_token, state.binding.deployment_dispatch_lease_token);
        assert.equal(args.p_fencing_token, state.binding.deployment_dispatch_fencing_token);
        assert.equal(args.p_deployment_operation_id, state.binding.deployment_operation_id);
        state.binding.deployment_receipt = {
          trigger_id: args.p_deployed_trigger_id,
          component_id: args.p_component_id,
          component_key: state.binding.component_key,
          component_version: state.binding.component_version,
          operation_id: args.p_deployment_operation_id,
        };
      }
      return true;
    }
    if (name === "apply_pipedream_trigger_projection") {
      assert.equal(state.binding.deployment_receipt.component_id, state.deployedComponentId);
      assert.equal(state.binding.deployment_receipt.trigger_id, args.p_deployed_trigger_id);
      assert.equal(args.p_observed_component_version, definition.version);
      Object.assign(state.binding, {
        trigger_state: "active",
        last_health_at: new Date().toISOString(),
        deployed_trigger_id: args.p_deployed_trigger_id,
        webhook_id: args.p_webhook_id,
        deployment_operation_id: null,
        deployment_candidate_trigger_id: null,
        deployment_dispatched_at: null,
      });
      return structuredClone(state.binding);
    }
    if (name === "fail_pipedream_binding_reconciliation") {
      state.binding.trigger_state = "degraded";
      return true;
    }
    throw new Error(`Unexpected maintenance RPC: ${name}`);
  };
  state.supabaseAdmin = {
    from(table) {
      const filters = {};
      const read = () => {
        assert.equal(filters.profile_id, ids.profile);
        assert.equal(filters.environment, state.environment);
        if (table === "calendar_connections")
          return {
            data:
              state.connection &&
              Object.entries(filters).every(
                ([key, value]) =>
                  !["pipedream_account_id", "connection_revision"].includes(key) ||
                  state.connection[key] === value,
              )
                ? state.connection
                : null,
            error: null,
          };
        if (table === "pipedream_bindings") return { data: state.binding, error: null };
        assert.equal(table, "calendar_selections");
        assert.equal(filters.connection_id, ids.connection);
        assert.equal(filters.active, true);
        return { data: state.selections, error: null };
      };
      return {
        select() {
          return this;
        },
        eq(name, value) {
          filters[name] = value;
          return this;
        },
        abortSignal(signal) {
          assert.ok(signal instanceof AbortSignal);
          return this;
        },
        async maybeSingle() {
          return read();
        },
        then(resolve, reject) {
          return Promise.resolve().then(read).then(resolve, reject);
        },
      };
    },
  };
  const originalFetch = globalThis.fetch;
  let bundle;
  let networkCalls = 0;
  try {
    globalThis.__googleCompletion = state;
    globalThis.fetch = async () => {
      networkCalls++;
      throw new Error("No network allowed");
    };
    const actualPipedream = JSON.stringify(path.resolve("src/lib/pipedream.server.ts"));
    const actualReconciliation = JSON.stringify(
      path.resolve("src/lib/pipedream-trigger-reconciliation.server.ts"),
    );
    state.definition = definition;
    bundle = await importWithMocks(path.resolve("src/lib/booking-provider.functions.ts"), {
      "@tanstack/react-start": `export function createServerFn() { return { validator(validate) { return {
      handler(handler) { return async ({data}) => handler({data: validate(data)}); }
    }; } }; }`,
      "@/integrations/supabase/client.server": `export const supabaseAdmin = globalThis.__googleCompletion.supabaseAdmin;`,
      "@/lib/auth/cookies.server": `export const getCookie=()=>globalThis.__googleCompletion.cookie;export const serializeCookie=(_,value)=>value;`,
      "@tanstack/react-start/server": `export const setResponseHeader=(_,value)=>{globalThis.__googleCompletion.cookie=value};`,
      "@/lib/provider-authorization.server": `
      const s = globalThis.__googleCompletion;
      export const providerMutationContext = (...args) => s.authorize(...args, true);
      export const providerOwnerContext = (...args) => s.authorize(...args, false);
      export const assertNoOtherActiveProWebsiteNeedsSharedProviders = async () => { if (s.shared) throw new Error('Shared provider in use'); };
      export const sharedProviderDisconnectEnabled = () => true;
      export const hasCurrentActiveConfirmedPro = async () => !s.ownerOnly;
    `,
      "@/lib/google-calendar-state.server": `
      const s = globalThis.__googleCompletion;
      export class GoogleCalendarStateError extends Error {}
      export const persistVerifiedGoogleCalendarConfiguration = (input) => s.persist(input);
      export const reserveGoogleCalendarSetupProbe = (input) => s.reserve(input);
      export const reconcileVerifiedGoogleCalendarConnection = async (input) => {
        s.call('negative-evidence'); s.rpc.push({name:'reconcile_google_calendar_connection',args:input});
        if(input.expectedRevision!==s.connection?.connection_revision)throw Error('Stale negative evidence');
        Object.assign(s.connection,{health_state:input.healthState,verification_reason:input.reason});
      };
      export const runGoogleCalendarSetupProbe = async (input) => {
        s.call('probe'); s.probes.push(input);
        await s.persist({...s.reserved, pipedreamAccountId:s.reserved.accountId, externalUserId:'obra:'+s.environment+':${ids.profile}',
          verifiedAt:s.reserved.readVerifiedAt, expectedRevision:input.probe.connection_revision,setupOperationId:input.probe.id});
        return {persisted:true,writeVerified:true};
      };
      export const requireGoogleCalendarSettlement = (value) => { if (!value) throw new Error('State settlement failed'); };
      export const googleCalendarLifetimeRpc = async (name, args) => {
        s.rpc.push({name,args});
        if (name === 'authorize_google_calendar_connect_start') { s.call('authorize-connect'); s.cookie=args.p_operation_id; return {id:args.p_operation_id}; }
        if (name === 'authorize_google_calendar_connect_completion') { s.call('authorize-completion'); return s.connection??{id:'${ids.connection}',connection_revision:0,pipedream_account_id:null}; }
        if (name === 'request_google_calendar_verification') { s.call('wake'); return true; }
        if (name === 'authorize_google_calendar_setup_read') {
          s.call('authorize-account');
          if(args.p_expected_revision!==(s.connection?.connection_revision??0)) throw new Error('Stale configuration revision');
          if((args.p_expected_setup_key??null)!==s.pendingSetupKey) throw new Error('Stale pending setup key');
          if (s.blockedIdentity) throw new Error('Disconnected provider identity'); return true;
        }
        if (name === 'reserve_booking_provider_account_disconnect_v3') { s.call('reserve-disconnect'); return 'disconnect-fixture'; }
        return s.maintenanceRpc(name, args);
      };
    `,
      "@/lib/pipedream-trigger-reconciliation.server": `
      import { refreshSavedGoogleCalendar as verify } from ${actualReconciliation};
      export const refreshSavedGoogleCalendar = (input) => globalThis.__googleCompletion.refresh(input, verify);
      export const resumeGoogleCalendarDisconnect = async (input) => {
        const s = globalThis.__googleCompletion; s.call('resume-disconnect'); s.disconnectInput=input;
        return { checked:true, disconnected:true };
      };
    `,
      "@/lib/pipedream.server": `
       export { hasGoogleCalendarBookingScopes, classifyPipedreamFailure, PipedreamError, PipedreamRequestError, isGoogleCalendarOneOffEvent } from ${actualPipedream};
      const s = globalThis.__googleCompletion;
      export const withPipedreamDeadline = async (deadlineAt, work) => { if (deadlineAt<=Date.now()) throw new Error('Deadline'); return work(); };
      export const pipedreamExternalUserId = (profileId, environment) => 'obra:'+environment+':'+profileId;
      export const listGoogleAccounts = async () => { s.call('accounts'); return [
        { id:'apn_retained', healthy:true, name:'previous@example.test', created_at:'2026-01-01T00:00:00Z', ...(s.scopes===undefined?{}:{authorized_scopes:s.scopes}) },
        { id:'${ids.account}', healthy:true, name:'${calendar.id}', created_at:'2026-02-01T00:00:00Z', ...(s.scopes===undefined?{}:{authorized_scopes:s.scopes}) },
      ]; };
      export const listGoogleCalendars = async () => { s.call('calendar-list'); return s.calendars; };
      export const verifyGoogleCalendarFreeBusy = async (input) => {
        s.call('freebusy'); s.freeBusy.push(input);
        if(s.replacePendingDuringRead) s.pendingSetupKey='b'.repeat(64);
      };
      export const createGoogleConnectLink = async () => { s.call('connect-link'); return {url:'https://example.test/connect'}; };
      export const listGoogleCalendarTriggers = async () => [s.definition];
      export const retrievePipedreamTrigger = async (input) => {
        s.call('pinned-definition');
        if (input.key !== s.definition.key || input.version !== s.definition.version) throw new Error('Wrong pinned definition');
        return s.definition;
      };
      export const listDeployedPipedreamTriggers = async () => [];
       export const deployPipedreamTrigger = async (input) => {
         if(input.key!==s.definition.key||input.version!==s.definition.version)throw new Error('Unpinned deployment');
         s.deployed={id:'dc_completion',componentId:s.deployedComponentId,componentKey:null,configuredProps:structuredClone(input.configuredProps),active:true};
         return structuredClone(s.deployed);
       };
      export const pipedreamTriggerWebhookUrl = () => 'https://example.test/webhook';
      export const configurePipedreamTriggerWebhook = async () => ({id:'wh_completion',signingKey:'fixture'});
      export const getPipedreamTriggerWebhook = async () => ({id:'wh_completion',url:pipedreamTriggerWebhookUrl(),signingKey:'fixture',updatedAt:new Date().toISOString()});
       export const getDeployedPipedreamTrigger = async () => structuredClone(s.deployed);
      export const deletePipedreamTrigger = async () => { throw new Error('Unexpected trigger deletion'); };
      export const deletePipedreamAccount = async () => { throw new Error('Unexpected account deletion'); };
    `,
    });
    const complete = () =>
      bundle.subject.completeGoogleCalendarConnection({ data: { websiteId: ids.website } });
    const save = () =>
      bundle.subject.saveGoogleCalendarSelection({
        data: {
          websiteId: ids.website,
          accountId: ids.account,
          expectedRevision: state.connection?.connection_revision ?? 0,
          blockingCalendarIds: ["busy@example.test"],
          destinationCalendarId: calendar.id,
        },
      });
    const expected = [
      "authorize-completion",
      "accounts",
      "authorize-account",
      "calendar-list",
      "freebusy",
      "reserve-probe",
      "probe",
      "persist",
      "refresh-saved",
    ];
    const accepted = [
      [defaultScopes, "test"],
      [defaultScopes, "live"],
      [[scope], "test"],
      ...["calendarlist", "calendarlist.readonly"].flatMap((list) =>
        ["freebusy", "events.freebusy"].map((busy) => [
          [`${scope}.events`, `${scope}.${list}`, `${scope}.${busy}`],
          "test",
        ]),
      ),
    ];
    for (const [scopes, environment] of accepted) {
      reset(scopes, environment);
      assert.deepEqual(await complete(), { completed: true });
      assert.deepEqual(state.steps, expected);
      assert.equal(state.binding.trigger_state, "active");
      assert.equal(state.persists.length, 1);
      assert.equal(state.persists[0].calendars.length, 1);
      assert.ok(state.maintenanceCalls.includes("pinned-definition"));
      assert.equal(state.definition.id, undefined);
      assert.deepEqual(state.binding.deployment_receipt, {
        trigger_id: "dc_completion",
        component_id: ids.component,
        component_key: componentKey,
        component_version: definition.version,
        operation_id: ids.operation,
      });
      const receipt = structuredClone(state.binding.deployment_receipt);
      const before = state.rpc.length;
      await bundle.subject.refreshGoogleCalendarConnection({ data: { websiteId: ids.website } });
      assert.deepEqual(state.binding.deployment_receipt, receipt);
      assert.equal(
        state.rpc
          .slice(before)
          .some(
            ({ name, args }) =>
              name === "adopt_pipedream_trigger_candidate" && args.p_component_id !== undefined,
          ),
        false,
        "subsequent verification consumes the saved receipt without recreating deployment proof",
      );
    }
    console.log(
      "PASS: completion keeps supported scopes/environment, persists after stable capability proof, and awaits shared repair",
    );

    reset();
    assert.deepEqual(await save(), { saved: true, triggerPending: true });
    assert.deepEqual(state.freeBusy[0].calendarIds, ["busy@example.test"]);
    assert.deepEqual(
      state.persists[0].calendars.map((selection) => [
        selection.id,
        selection.blocksAvailability,
        selection.receivesBookings,
      ]),
      [
        ["busy@example.test", true, false],
        [calendar.id, false, true],
      ],
    );
    assert.equal(state.refreshes.length, 0);
    console.log(
      "PASS: explicit selections retain the complete conflict set and separate destination without claiming trigger readiness",
    );
    for (const discover of [true, false]) {
      reset();
      state.connection = {
        id: ids.connection,
        pipedream_account_id: "apn_newer",
        connection_revision: 12,
      };
      const input = {
        websiteId: ids.website,
        accountId: ids.account,
        expectedRevision: 11,
        blockingCalendarIds: ["busy@example.test"],
        destinationCalendarId: calendar.id,
      };
      const action = discover
        ? bundle.subject.discoverGoogleCalendars
        : bundle.subject.saveGoogleCalendarSelection;
      await assert.rejects(() => action({ data: input }), /Stale configuration revision/);
      assert.deepEqual(state.steps, ["authorize-account"]);
      assert.equal(state.persists.length, 0);
      const { expectedRevision: _omitted, ...missingRevision } = input;
      await assert.rejects(() => action({ data: missingRevision }));
    }
    console.log(
      "PASS: discovery/save require the editor revision and reject stale views before provider calls",
    );
    const pendingInput = {
      websiteId: ids.website,
      accountId: ids.account,
      expectedRevision: 12,
      expectedSetupKey: "a".repeat(64),
      blockingCalendarIds: ["busy@example.test"],
      destinationCalendarId: calendar.id,
    };
    for (const action of [
      bundle.subject.discoverGoogleCalendars,
      bundle.subject.saveGoogleCalendarSelection,
    ]) {
      reset();
      state.connection = {
        id: ids.connection,
        pipedream_account_id: null,
        connection_revision: 12,
      };
      state.pendingSetupKey = "b".repeat(64);
      await assert.rejects(() => action({ data: pendingInput }), /Stale pending setup key/);
      assert.deepEqual(state.steps, ["authorize-account"]);
      assert.equal(state.persists.length, 0);
      await assert.rejects(
        () => action({ data: { ...pendingInput, expectedSetupKey: null } }),
        /Stale pending setup key/,
      );
    }
    reset();
    state.connection = { id: ids.connection, pipedream_account_id: null, connection_revision: 12 };
    state.pendingSetupKey = pendingInput.expectedSetupKey;
    state.replacePendingDuringRead = true;
    await assert.rejects(
      () => bundle.subject.saveGoogleCalendarSelection({ data: pendingInput }),
      /Stale pending setup key/,
    );
    assert.equal(state.probes.length, 0);
    assert.equal(state.persists.length, 0);
    reset();
    state.connection = { id: ids.connection, pipedream_account_id: null, connection_revision: 12 };
    state.pendingSetupKey = pendingInput.expectedSetupKey;
    assert.deepEqual(await bundle.subject.saveGoogleCalendarSelection({ data: pendingInput }), {
      saved: true,
      triggerPending: true,
    });
    assert.equal(state.reserved.expectedSetupKey, pendingInput.expectedSetupKey);
    console.log(
      "PASS: unobserved pending A/B collisions fail before providers and again at reservation; matching pending key is threaded end-to-end",
    );

    reset();
    state.connection = {
      id: ids.connection,
      pipedream_account_id: ids.account,
      connection_revision: 9,
    };
    state.selections = [
      { google_calendar_id: calendar.id, blocks_availability: false, receives_bookings: true },
      { google_calendar_id: "busy-a", blocks_availability: true, receives_bookings: false },
      { google_calendar_id: "busy-b", blocks_availability: true, receives_bookings: false },
    ];
    const saved = structuredClone(state.selections);
    state.calendars.push(
      { id: "busy-a", summary: "A", accessRole: "reader" },
      { id: "busy-b", summary: "B", accessRole: "reader" },
    );
    await complete();
    assert.deepEqual(state.steps, [
      "authorize-completion",
      "accounts",
      "authorize-account",
      "wake",
      "calendar-list",
      "freebusy",
      "reserve-probe",
      "probe",
      "persist",
      "refresh-saved",
    ]);
    assert.deepEqual(state.selections, saved);
    assert.equal(state.persists.length, 1);
    assert.equal(state.probes.length, 1);
    console.log(
      "PASS: same-account completion uses saved-config verification, never the completion picker to replace multi-calendar selections",
    );
    assert.equal(
      state.rpc.some(({ name }) => name === "request_google_calendar_verification"),
      true,
    );
    reset();
    state.cookie = null;
    await assert.rejects(complete, /Start Google Connect/);
    assert.equal(state.steps.length, 0);
    console.log(
      "PASS: completion requires the initiating browser's owner-scoped Connect operation",
    );
    reset();
    state.definition.id = ids.component;
    state.deployedComponentId = "sc_mismatched_version";
    await assert.rejects(complete, /trigger_version_unverified/);
    assert.equal(state.persists.length, 1, "desired calendars remain saved when monitoring fails");
    assert.equal(state.binding.trigger_state, "degraded");
    assert.equal(
      state.binding.deployment_candidate_trigger_id,
      "dc_completion",
      "completion retains the incompatible returned resource for fenced retirement",
    );
    assert.equal(
      state.rpc.some(({ name }) => name === "apply_pipedream_trigger_projection"),
      false,
    );
    console.log("PASS: completion cannot report readiness for a mismatched deployed component ID");
    reset();
    state.connection = {
      id: ids.connection,
      pipedream_account_id: null,
      connection_revision: 10,
      verification_reason: "contractor_disconnected",
      disconnected_at: "2026-09-10T00:00:00Z",
    };
    await assert.rejects(complete, /retained accounts are not selected automatically/);
    assert.deepEqual(state.steps, ["authorize-completion", "accounts"]);
    assert.equal(state.persists.length, 0);
    console.log(
      "PASS: a stale completion callback cannot resurrect a retained account after explicit disconnect",
    );

    for (const scopes of [
      undefined,
      [],
      [`${scope}.events`],
      [`${scope}.readonly`],
      [`${scope}.events`, `${scope}.freebusy`],
    ]) {
      for (const invoke of [complete, save]) {
        reset();
        state.scopes = scopes;
        await assert.rejects(
          invoke,
          scopes === undefined
            ? /permissions could not be verified\. Try again shortly/
            : /Reconnect Google Calendar and allow access/,
        );
        assert.deepEqual(
          state.steps,
          invoke === complete
            ? ["authorize-completion", "accounts"]
            : ["authorize-account", "accounts"],
        );
        assert.equal(state.probes.length, 0);
        assert.equal(state.persists.length, 0);
        assert.equal(state.refreshes.length, 0);
        assert.equal(state.connection, null);
        state.scopes = defaultScopes;
        await invoke();
        assert.equal(
          state.persists.length,
          1,
          "retry needs fresh evidence, not another Connect link",
        );
      }
    }
    for (const stage of expected) {
      reset();
      state.failAt = stage;
      await assert.rejects(complete, new RegExp(stage));
      assert.deepEqual(state.steps, expected.slice(0, expected.indexOf(stage) + 1));
    }
    console.log(
      "PASS: unknown scopes are retryable, known insufficient scopes request consent; neither saves/probes before fresh evidence",
    );

    reset();
    state.blockedIdentity = true;
    await assert.rejects(complete, /Disconnected provider identity/);
    assert.deepEqual(state.steps, ["authorize-completion", "accounts", "authorize-account"]);
    reset();
    state.blockedIdentity = true;
    await bundle.subject.startGoogleCalendarConnect({ data: { websiteId: ids.website } });
    assert.deepEqual(state.steps, ["authorize-connect", "connect-link"]);
    for (const fn of [
      bundle.subject.completeGoogleCalendarConnection,
      bundle.subject.configureGoogleCalendarTrigger,
    ]) {
      reset();
      state.ownerOnly = true;
      await assert.rejects(() => fn({ data: { websiteId: ids.website } }), /Forbidden/);
      assert.equal(state.steps.length, 0);
    }
    reset();
    state.forbidden = true;
    await assert.rejects(complete, /Forbidden/);
    assert.equal(state.steps.length, 0);
    console.log(
      "PASS: disconnected identity is blocked before Google calls, and owner/Pro authorization precedes setup",
    );
    reset();
    state.ownerOnly = true;
    assert.deepEqual(
      await bundle.subject.refreshGoogleCalendarConnection({ data: { websiteId: ids.website } }),
      { checked: false },
    );
    assert.deepEqual(state.steps, ["wake", "refresh-saved"]);
    reset();
    state.forbidden = true;
    await assert.rejects(
      () => bundle.subject.refreshGoogleCalendarConnection({ data: { websiteId: ids.website } }),
      /Forbidden/,
    );
    console.log(
      "PASS: servicing an existing saved connection needs its real owner, not a new Pro purchase",
    );

    reset();
    state.connection = {
      id: ids.connection,
      pipedream_account_id: ids.account,
      connection_revision: 9,
    };
    state.ownerOnly = true;
    assert.deepEqual(
      await bundle.subject.disconnectGoogleCalendar({ data: { websiteId: ids.website } }),
      { disconnected: true, pending: false },
    );
    assert.deepEqual(state.steps, ["reserve-disconnect", "resume-disconnect"]);
    assert.equal(state.rpc[0].args.p_expected_connection_revision, 9);
    assert.equal(state.disconnectInput.disconnectId, "disconnect-fixture");
    reset();
    state.shared = true;
    await assert.rejects(
      () => bundle.subject.disconnectGoogleCalendar({ data: { websiteId: ids.website } }),
      /Shared provider in use/,
    );
    state.shared = false;
    console.log(
      "PASS: owner disconnect retains shared-provider safety and resumes its exact reserved revision without requiring Pro",
    );
    assert.equal(networkCalls, 0);
    console.log("test-google-calendar-completion: passed; zero network calls");
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__googleCompletion;
    await bundle?.cleanup();
  }
}

async function testSqlHandoffs() {
  const { spawnSync } = await import("node:child_process");
  const { randomUUID, createHash } = await import("node:crypto");
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const script = fileURLToPath(import.meta.url);
  assert.equal(path.resolve(process.cwd()), path.resolve(root));
  Error.stackTraceLimit = 0;
  if (!process.argv.includes("--sql-child")) {
    const source = await readFile(path.join(root, "scripts/test-db-bucket3-local.sh"), "utf8");
    const marker = "# Exercise actual RPC execution under the same managed safe-update setting";
    assert.equal(source.split(marker).length, 2);
    assert.ok(!root.includes("'"));
    // This handler regression owns Google/setup SQL through the capability boundary,
    // not the independently changing scheduler/bootstrap or notification migrations.
    const bootstrap = source
      .split(marker)[0]
      .replace(/^ROOT=.*$/m, `ROOT='${root}'`)
      .replace('  case "$name" in', '  case "$name" in\n    20260910133000_*) break ;;');
    const result = spawnSync("bash", ["-s"], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        NODE_DISABLE_COMPILE_CACHE: "1",
      },
      input: `${bootstrap}\nnode '${script}' --sql-child${process.argv.includes("--red-control") ? " --red-control" : ""}\n`,
      stdio: ["pipe", "inherit", "inherit"],
      timeout: 180_000,
    });
    assert.equal(result.status, 0, "Google handler/SQL handoff regressions failed");
    return;
  }
  assert.equal(process.env.PGHOST, "127.0.0.1");
  assert.equal(process.env.PGDATABASE, "postgres");
  assert.match(process.env.PGPORT ?? "", /^\d+$/);
  const databaseEnvironment = {
    PATH: process.env.PATH,
    LC_ALL: "C",
    PSQLRC: "/dev/null",
    PGHOST: "127.0.0.1",
    PGHOSTADDR: "127.0.0.1",
    PGPORT: process.env.PGPORT,
    PGDATABASE: "postgres",
    PGUSER: process.env.PGUSER,
    PGPASSFILE: "/dev/null",
    PGCONNECT_TIMEOUT: "3",
  };
  const literal = (value) => {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    return `'${(typeof value === "object" ? JSON.stringify(value) : value).replaceAll("'", "''")}'${typeof value === "object" ? "::jsonb" : ""}`;
  };
  function sql(input, role = "booking_test_owner") {
    const result = spawnSync(
      "psql",
      ["-X", "-w", "-Atq", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
      {
        env: databaseEnvironment,
        input: `set role ${role};set client_min_messages=warning;\n${input}`,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 15_000,
      },
    );
    if (result.status !== 0)
      throw Object.assign(new Error(result.stderr.trim()), {
        code: result.stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1],
      });
    return result.stdout.trim();
  }
  const json = (input, role) => JSON.parse(sql(input, role) || "null");
  assert.equal(
    sql(
      `select inet_server_addr()='127.0.0.1'::inet and inet_server_port()=${process.env.PGPORT}
    and current_database()='postgres' and current_setting('data_directory') like '%/obra-booking-pg.%'
    and not exists(select 1 from pg_extension where extname in ('pg_net','pg_cron'));`,
      "none",
    ),
    "t",
  );
  // Mirror Supabase's ordinary service SELECT/RLS behavior, never grant the private ledger.
  sql("alter role service_role bypassrls;", "none");
  sql(`grant select on public.profiles,public.websites,public.website_entitlements,
    public.calendar_connections,public.calendar_selections,public.pipedream_bindings to service_role;`);
  assert.equal(
    sql(
      "select has_table_privilege('service_role','public.booking_provider_account_disconnects_v3','SELECT');",
    ),
    "f",
  );
  assert.throws(
    () => sql("select id from public.booking_provider_account_disconnects_v3;", "service_role"),
    (error) => error.code === "42501",
  );

  // Negative control restores the two original defects only in this disposable
  // database/bundle. It cannot edit application source or affect another database.
  const redControl = process.argv.includes("--red-control");
  if (redControl) {
    const reserve = sql(
      "select pg_get_functiondef('public.reserve_google_calendar_setup_probe(uuid,text,uuid,text,text,bigint,uuid,jsonb,timestamptz,text,text,uuid,text)'::regprocedure);",
    );
    const begin = reserve.indexOf("    -- OAuth renews the captured intent;");
    const end = reserve.indexOf("\n  end if;\n  select * into b", begin);
    assert.ok(begin > 0 && end > begin);
    sql(reserve.slice(0, begin) + reserve.slice(end));
  }

  const state = {
    calls: [],
    events: new Map(),
    triggers: new Map(),
    webhooks: new Map(),
    deniedAction: null,
    sequence: 0,
  };
  function rpc(name, args, role = "service_role") {
    assert.match(name, /^[a-z_0-9]+$/);
    const call = `public.${name}(${Object.entries(args)
      .map(([key, value]) => {
        assert.match(key, /^p_[a-z_0-9]+$/);
        const encoded = key.startsWith("p_exclude_")
          ? `ARRAY[${value.map(literal).join(",")}]::uuid[]`
          : literal(value);
        return `${key}=>${encoded}`;
      })
      .join(",")})`;
    return json(
      name === "claim_due_pipedream_bindings"
        ? `select coalesce(jsonb_agg(x),'[]'::jsonb) from ${call} x;`
        : `select to_jsonb(${call});`,
      role,
    );
  }
  state.db = {
    rpc(name, args) {
      const result = async () => {
        state.calls.push({ type: "rpc", name, args });
        if (name === "get_pending_google_calendar_setup") {
          state.beforePendingRead?.();
          if (state.failPendingRead) return { data: null, error: { code: "40001" } };
          if (state.invalidPendingRead) return { data: {}, error: null };
          if (redControl) {
            try {
              sql("select id from public.booking_provider_account_disconnects_v3;", "service_role");
            } catch (error) {
              return { data: null, error: { code: error.code, message: error.message } };
            }
          }
        }
        try {
          await state.beforeRpc?.(name, args);
          return { data: rpc(name, args), error: null };
        } catch (error) {
          state.sqlErrors.push({ name, code: error.code });
          return { data: null, error: { code: error.code, message: error.message } };
        }
      };
      return {
        abortSignal: async () => result(),
        then: (resolve, reject) => Promise.resolve().then(result).then(resolve, reject),
      };
    },
    from(table) {
      assert.match(table, /^[a-z_0-9]+$/);
      let columns = "*",
        maximum = null;
      const filters = [];
      const read = (single = false) => {
        try {
          const rows = json(
            `select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from
            (select ${columns} from public.${table}${filters.length ? ` where ${filters.join(" and ")}` : ""}${maximum ? ` limit ${maximum}` : ""})r;`,
            "service_role",
          );
          return { data: single ? (rows[0] ?? null) : rows, error: null };
        } catch (error) {
          return { data: null, error: { code: error.code, message: error.message } };
        }
      };
      const chain = {
        select(value) {
          assert.match(value, /^[a-z_0-9,* ]+$/);
          columns = value;
          return chain;
        },
        eq(key, value) {
          assert.match(key, /^[a-z_0-9]+$/);
          filters.push(`${key}=${literal(value)}`);
          return chain;
        },
        neq(key, value) {
          assert.match(key, /^[a-z_0-9]+$/);
          filters.push(`${key}<>${literal(value)}`);
          return chain;
        },
        in(key, values) {
          assert.match(key, /^[a-z_0-9]+$/);
          filters.push(`${key} in (${values.map(literal).join(",")})`);
          return chain;
        },
        limit(value) {
          maximum = value;
          return chain;
        },
        abortSignal() {
          return chain;
        },
        single: async () => read(true),
        maybeSingle: async () => read(true),
        then: (resolve, reject) =>
          Promise.resolve()
            .then(() => read())
            .then(resolve, reject),
      };
      return chain;
    },
  };
  const previousFetch = globalThis.fetch;
  let bundle;
  let maintenanceBundle;
  globalThis.__googleSqlHandoffs = state;
  globalThis.fetch = async () => {
    throw new Error("External network is forbidden");
  };
  const failures = [];
  async function check(name, work) {
    try {
      await work();
      console.log(`PASS: ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`FAIL: ${name}: ${error.message}`);
    }
  }
  const connection = () =>
    json(
      `select to_jsonb(c) from public.calendar_connections c where profile_id=${literal(state.profile)};`,
    );
  const selections = () =>
    json(`select coalesce(jsonb_agg(jsonb_build_array(google_calendar_id,blocks_availability,receives_bookings) order by google_calendar_id),'[]')
    from public.calendar_selections where profile_id=${literal(state.profile)} and active;`);
  async function tenant(label, entitlementState = "active", environment = "test") {
    state.owner = randomUUID();
    state.profile = randomUUID();
    state.website = randomUUID();
    state.account = `apn_${label}`;
    state.calls = [];
    state.sqlErrors = [];
    state.beforeRpc = null;
    state.afterProviderRead = null;
    state.providerFailure = null;
    state.lastProviderError = null;
    state.deniedAction = null;
    state.headers = new Headers();
    state.request = new Request("https://example.test/user");
    state.beforePendingRead = null;
    state.failPendingRead = false;
    state.invalidPendingRead = false;
    state.accounts = [
      {
        id: state.account,
        name: `${label}@example.test`,
        healthy: true,
        created_at: "2026-01-01T00:00:00Z",
        authorized_scopes: [
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.readonly",
        ],
      },
    ];
    state.calendars = [
      { id: "primary", summary: "Primary", accessRole: "owner", primary: true },
      { id: "busy-a", summary: "Busy A", accessRole: "reader" },
      { id: "destination-a", summary: "Destination A", accessRole: "writer" },
      { id: "busy-b", summary: "Busy B", accessRole: "freeBusyReader" },
      { id: "destination-b", summary: "Destination B", accessRole: "writer" },
    ];
    sql(`insert into auth.users(id,email) values(${literal(state.owner)},'${label}@example.test');
      insert into public.profiles(id,auth_user_id,license_number,email,environment)values(${literal(state.profile)},${literal(state.owner)},'${label}','${label}@example.test',${literal(environment)});
      insert into public.websites(id,user_id,status,environment)values(${literal(state.website)},${literal(state.profile)},'draft',${literal(environment)});
      insert into public.website_entitlements(profile_id,website_id,environment,plan,state,effective_at,order_confirmed_at)
        values(${literal(state.profile)},${literal(state.website)},${literal(environment)},'pro',${literal(entitlementState)},clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 second');`);
  }
  const save = (which, key = null) =>
    bundle.subject.saveGoogleCalendarSelection({
      data: {
        websiteId: state.website,
        accountId: state.account,
        expectedRevision: connection()?.connection_revision ?? 0,
        expectedSetupKey: key,
        blockingCalendarIds: [`busy-${which}`],
        destinationCalendarId: `destination-${which}`,
      },
    });
  const start = async () => {
    await bundle.subject.startGoogleCalendarConnect({ data: { websiteId: state.website } });
    const cookie = state.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=lax/);
    assert.match(cookie, /Max-Age=900/);
    state.request = new Request("https://example.test/user", {
      headers: { cookie: cookie.split(";")[0] },
    });
    assert.equal(cookie.split(";")[0].split("=")[1], connection().connect_operation_id);
  };
  const complete = () =>
    bundle.subject.completeGoogleCalendarConnection({ data: { websiteId: state.website } });
  const load = () =>
    bundle.subject.loadGoogleCalendarConfiguration({ data: { websiteId: state.website } });
  try {
    const actualProvider = JSON.stringify(path.join(root, "src/lib/pipedream.server.ts"));
    const entry = path.join(root, "src/lib/booking-provider.functions.ts");
    const entryMocks = {};
    if (redControl) {
      const { transform } = await import("esbuild");
      const { createRequire } = await import("node:module");
      const source = await readFile(entry, "utf8");
      const capturedBranch = "if (current.connect_expected_setup_key) {";
      assert.equal(source.split(capturedBranch).length, 2);
      const changed = source
        .replace(capturedBranch, "if (false) {")
        .replace(
          'from "zod"',
          `from ${JSON.stringify(createRequire(import.meta.url).resolve("zod"))}`,
        );
      entryMocks[entry] = (await transform(changed, { loader: "ts", format: "esm" })).code;
    }
    const mocks = {
      ...entryMocks,
      "@tanstack/react-start": `export const createServerFn=()=>({validator:validate=>({handler:fn=>({data})=>fn({data:validate(data)})})});`,
      "@tanstack/react-start/server": `const s=globalThis.__googleSqlHandoffs;export const getRequest=()=>s.request;export const setResponseHeader=(name,value)=>s.headers.set(name,value);`,
      "@/lib/auth/contractor-session.server": `export const getContractorAuthUserId=async()=>globalThis.__googleSqlHandoffs.owner;`,
      "@/lib/jobs/access.server": `export const assertWebsiteWorkspaceAccess=async(id)=>{const s=globalThis.__googleSqlHandoffs;if(id!==s.website)throw Error('Foreign website');return {mode:'contractor',profileId:s.profile};};`,
      "@/integrations/supabase/client.server": `export const supabaseAdmin=globalThis.__googleSqlHandoffs.db;`,
      "@/lib/pipedream.server": `
        import {PipedreamError,PipedreamRequestError,isGoogleCalendarOneOffEvent,classifyPipedreamFailure,hasGoogleCalendarBookingScopes,withPipedreamDeadline} from ${actualProvider};
        export {PipedreamError,PipedreamRequestError,isGoogleCalendarOneOffEvent,classifyPipedreamFailure,hasGoogleCalendarBookingScopes,withPipedreamDeadline};
        const s=globalThis.__googleSqlHandoffs;
        export const createGoogleConnectLink=async()=>({url:'https://example.test/connect'});
        export const listGoogleAccounts=async()=>{s.calls.push({type:'accounts'});const result=structuredClone(s.accounts);await s.afterProviderRead?.('accounts');return result;};
        const failRead=async(stage,operation)=>{
          const failure=s.providerFailure;
          if(failure?.stage!==stage)return;
          const error=new PipedreamRequestError(failure.status??403,operation,failure.reason??'insufficientPermissions',failure.layer??'google');
          await s.afterProviderRead?.(stage);s.lastProviderError=error;throw error;
        };
        export const listGoogleCalendars=async()=>{s.calls.push({type:'calendar-list'});await failRead('calendars','Google Calendar list via Pipedream');const result=structuredClone(s.calendars);await s.afterProviderRead?.('calendars');return result;};
        export const verifyGoogleCalendarFreeBusy=async(input)=>{s.calls.push({type:'freebusy',...input});await failRead('freebusy','Google Calendar availability via Pipedream');};
        export const verifyGoogleCalendarEventAccess=async()=>{};
        export const proxyGoogleCalendar=async(input)=>{
          const key=input.accountId+':'+input.target.pathname;
          s.calls.push({type:'probe',method:input.method??'GET',accountId:input.accountId,path:input.target.pathname});
          if(input.method==='POST') {
            if(s.deniedAction==='insert')throw new PipedreamRequestError(403,input.operation,'insufficientPermissions','google');
            const event={...input.body,etag:'"fixture-etag"',status:'confirmed'};s.events.set(key+'/'+event.id,event);return structuredClone(event);
          }
          if(input.method==='DELETE') {s.events.set(key,{id:input.target.pathname.split('/').at(-1),status:'cancelled'});return null;}
          if(!s.events.has(key))throw new PipedreamRequestError(404,input.operation,'notFound','google');
          return structuredClone(s.events.get(key));
        };
        const definition={id:'sc_handoff',key:'google_calendar-new-or-updated-event-instant',version:'1.2.3',configurableProps:[
          {name:'googleCalendar',type:'app',app:'google_calendar'},{name:'calendarIds',type:'string[]'},{name:'newOnly',type:'boolean'}]};
        export const listGoogleCalendarTriggers=async()=>[definition],retrievePipedreamTrigger=async()=>definition;
        export const listDeployedPipedreamTriggers=async()=>[...s.triggers.values()];
        export const deployPipedreamTrigger=async(input)=>{const t={id:'dc_'+(++s.sequence),componentId:'sc_handoff',componentKey:definition.key,active:true,configuredProps:input.configuredProps};s.triggers.set(t.id,t);return t;};
        export const getDeployedPipedreamTrigger=async({triggerId})=>structuredClone(s.triggers.get(triggerId));
        export const deletePipedreamTrigger=async({triggerId})=>s.triggers.delete(triggerId);
        export const pipedreamTriggerWebhookUrl=({bindingId})=>'https://example.test/webhook/'+bindingId;
        export const configurePipedreamTriggerWebhook=async({triggerId,webhookUrl})=>{const w={id:'wh_'+triggerId,url:webhookUrl,signingKey:'fixture-key',updatedAt:new Date().toISOString()};s.webhooks.set(w.id,w);return w;};
        export const getPipedreamTriggerWebhook=async({webhookId})=>structuredClone(s.webhooks.get(webhookId));
        export const deletePipedreamAccount=async()=>{throw Error('No account DELETE permitted');};`,
    };
    bundle = await importWithMocks(entry, mocks);
    if (!redControl) {
      maintenanceBundle = await importWithMocks(
        path.join(root, "src/lib/pipedream-trigger-reconciliation.server.ts"),
        mocks,
      );
      for (const environment of ["test", "live"]) {
        for (const entitlementState of ["active", "grace"]) {
          await check(
            `H3 ${environment}/${entitlementState}: actual owner/save/Connect handlers and SQL agree`,
            async () => {
              await tenant(`h3_${environment}_${entitlementState}`, entitlementState, environment);
              assert.deepEqual(await save("a"), { saved: true, triggerPending: true });
              const saved = connection();
              assert.equal(saved.pipedream_account_id, state.account);
              assert.ok(saved.setup_completed_at);
              await start();
              assert.deepEqual(await complete(), { completed: true });
              assert.deepEqual(selections(), [
                ["busy-a", true, false],
                ["destination-a", false, true],
              ]);
              assert.equal(connection().connection_revision, saved.connection_revision);
              assert.ok(connection().connect_completed_at);
              assert.equal((await load()).canConfigure, true);
              assert.equal(
                sql(
                  `select state from public.website_entitlements where website_id=${literal(state.website)};`,
                ),
                entitlementState,
              );
              assert.deepEqual(state.sqlErrors, []);
              for (const name of [
                "authorize_google_calendar_connect_start",
                "authorize_google_calendar_connect_completion",
                "reserve_google_calendar_setup_probe",
              ]) {
                const calls = state.calls.filter((call) => call.name === name);
                assert.ok(calls.length > 0, name);
                assert.ok(
                  calls.every(
                    ({ args }) =>
                      args.p_actor_auth_user_id === state.owner &&
                      args.p_environment === environment,
                  ),
                );
              }
            },
          );
        }
      }
      await check(
        "H3 timestamp/state policy, owner, environment and Connect expiry remain enforced",
        async () => {
          await tenant("h3_authority", "grace");
          await start();
          const current = connection();
          const entitlement = json(
            `select to_jsonb(e) from public.website_entitlements e where website_id=${literal(state.website)};`,
          );
          const args = {
            p_profile_id: state.profile,
            p_environment: "test",
            p_actor_auth_user_id: state.owner,
            p_operation_id: current.connect_operation_id,
          };
          const fields = ["plan", "state", "order_confirmed_at", "effective_at", "ends_at"];
          for (const change of [
            ...["pending", "suspended", "cancelled", "expired"].map((value) => ({ state: value })),
            { plan: "starter" },
            { order_confirmed_at: null },
            { order_confirmed_at: new Date(Date.now() + 3_600_000).toISOString() },
            { order_confirmed_at: "-infinity" },
            { effective_at: null },
            { effective_at: new Date(Date.now() + 3_600_000).toISOString() },
            { effective_at: "-infinity" },
            { ends_at: new Date(Date.now() - 1_000).toISOString() },
            { ends_at: "infinity" },
          ]) {
            const changed = { ...entitlement, ...change };
            sql(
              `update public.website_entitlements set ${fields.map((field) => `${field}=${literal(changed[field])}`).join(",")} where website_id=${literal(state.website)};`,
            );
            const before = state.calls.length;
            for (const action of [start, complete, () => save("a")])
              await assert.rejects(action, /active confirmed Pro/);
            assert.equal(
              state.calls.length,
              before,
              "handler denies before any lifetime RPC/provider call",
            );
            for (const name of [
              "authorize_google_calendar_connect_start",
              "authorize_google_calendar_connect_completion",
            ])
              assert.throws(
                () => rpc(name, args),
                (error) => error.code === "42501",
              );
          }
          sql(
            `update public.website_entitlements set ${fields.map((field) => `${field}=${literal(entitlement[field])}`).join(",")} where website_id=${literal(state.website)};`,
          );
          for (const changed of [
            { p_actor_auth_user_id: randomUUID() },
            { p_environment: "live" },
          ]) {
            assert.throws(
              () => rpc("authorize_google_calendar_connect_start", { ...args, ...changed }),
              (error) => error.code === "42501",
            );
            assert.throws(
              () => rpc("authorize_google_calendar_connect_completion", { ...args, ...changed }),
              (error) => error.code === "42501",
            );
          }
          const owner = state.owner;
          state.owner = randomUUID();
          await assert.rejects(start, /Forbidden/);
          state.owner = owner;
          sql(
            `update public.calendar_connections set connect_expires_at=clock_timestamp() where id=${literal(current.id)};`,
          );
          const before = state.calls.length;
          await assert.rejects(complete, /could not be settled/);
          assert.deepEqual(
            state.calls.slice(before).map(({ name }) => name),
            ["authorize_google_calendar_connect_completion"],
          );
          assert.deepEqual(state.sqlErrors.at(-1), {
            name: "authorize_google_calendar_connect_completion",
            code: "40001",
          });
          assert.equal(connection().pipedream_account_id, null);
        },
      );
      for (const [actionName, target] of [
        ["start", "authorize_google_calendar_connect_start"],
        ["complete", "authorize_google_calendar_connect_completion"],
        ["save", "reserve_google_calendar_setup_probe"],
      ]) {
        await check(
          `H3 ${actionName}: SQL rechecks grace expiry after handler authorization`,
          async () => {
            await tenant(`h3_expiry_${actionName}`, "grace");
            if (actionName === "complete") await start();
            state.beforeRpc = (name) => {
              if (name !== target) return;
              state.beforeRpc = null;
              sql(
                `update public.website_entitlements set ends_at=clock_timestamp() where website_id=${literal(state.website)};`,
              );
            };
            await assert.rejects(
              actionName === "start"
                ? start
                : actionName === "complete"
                  ? complete
                  : () => save("a"),
              actionName === "start"
                ? /Active confirmed Pro authority required/
                : /could not be settled/,
            );
            assert.deepEqual(state.sqlErrors.at(-1), { name: target, code: "42501" });
            assert.ok(state.calls.some(({ name }) => name === target));
            assert.equal(
              state.calls.some(({ type }) => type === "probe"),
              false,
            );
            assert.equal(connection()?.pipedream_account_id ?? null, null);
            assert.deepEqual(selections(), []);
          },
        );
      }
      await check(
        "H4 unattended scope evidence settles temporarily/permissions and recovers through actual SQL",
        async () => {
          await tenant("h4_scheduled", "grace");
          await start();
          await complete();
          const healthy = connection();
          const savedSelections = selections();
          const granted = state.accounts[0].authorized_scopes;
          const effects = structuredClone([state.events, state.triggers, state.webhooks]);
          for (const scopes of [
            undefined,
            [],
            ["https://www.googleapis.com/auth/calendar.readonly"],
          ]) {
            if (scopes === undefined) delete state.accounts[0].authorized_scopes;
            else state.accounts[0].authorized_scopes = scopes;
            sql(
              `update public.pipedream_bindings set reconciliation_due_at=clock_timestamp() where connection_id=${literal(healthy.id)};`,
            );
            state.calls = [];
            const result = await maintenanceBundle.subject.reconcileDuePipedreamTriggers(1, {
              environment: "test",
              deadlineAt: Date.now() + 25_000,
            });
            assert.equal(result.checked, 1);
            assert.equal(result.failed, 1);
            assert.equal(result.success, false);
            const reason =
              scopes === undefined ? "provider_temporary_failure" : "calendar_permissions_changed";
            const failed = connection();
            assert.equal(failed.health_state, "degraded");
            assert.equal(failed.verification_reason, reason);
            assert.equal(failed.reconnect_reason, null);
            assert.equal(failed.connection_revision, healthy.connection_revision);
            assert.equal(failed.pipedream_account_id, healthy.pipedream_account_id);
            assert.equal(failed.last_verified_at, healthy.last_verified_at);
            assert.deepEqual(selections(), savedSelections);
            assert.equal(
              sql(`select reconciliation_reason=${literal(reason)} and reconciliation_due_at>clock_timestamp()
            and reconciliation_lease_token is null and deployed_trigger_id is not null and cardinality(pending_trigger_deletions)=0
            from public.pipedream_bindings where connection_id=${literal(healthy.id)};`),
              "t",
            );
            assert.deepEqual(
              state.calls.filter(({ type }) => type !== "rpc"),
              [{ type: "accounts" }],
            );
            assert.deepEqual([state.events, state.triggers, state.webhooks], effects);
          }
          state.accounts[0].authorized_scopes = granted;
          sql(
            `update public.pipedream_bindings set reconciliation_due_at=clock_timestamp() where connection_id=${literal(healthy.id)};`,
          );
          state.calls = [];
          const result = await maintenanceBundle.subject.reconcileDuePipedreamTriggers(1, {
            environment: "test",
            deadlineAt: Date.now() + 25_000,
          });
          assert.equal(result.reconciled, 1);
          assert.equal(result.success, true);
          assert.equal(connection().health_state, "healthy");
          assert.equal(connection().verification_reason, null);
          assert.equal(connection().connection_revision, healthy.connection_revision);
          assert.deepEqual(selections(), savedSelections);
          assert.deepEqual([state.events, state.triggers, state.webhooks], effects);
        },
      );
      for (const actionName of ["save", "complete"]) {
        for (const scopes of [undefined, []]) {
          await check(
            `H4 ${actionName}: ${scopes === undefined ? "unknown" : "known insufficient"} scopes fail closed without setup effects`,
            async () => {
              await tenant(`h4_${actionName}_${scopes === undefined ? "unknown" : "insufficient"}`);
              if (actionName === "complete") await start();
              const before = connection();
              const granted = state.accounts[0].authorized_scopes;
              if (scopes === undefined) delete state.accounts[0].authorized_scopes;
              else state.accounts[0].authorized_scopes = scopes;
              state.calls = [];
              const action = actionName === "complete" ? complete : () => save("a");
              await assert.rejects(
                action,
                scopes === undefined
                  ? /permissions could not be verified\. Try again shortly/
                  : /Reconnect Google Calendar and allow access/,
              );
              assert.deepEqual(connection(), before);
              assert.deepEqual(selections(), []);
              assert.deepEqual(
                state.calls.filter(({ type }) => type !== "rpc"),
                [{ type: "accounts" }],
              );
              assert.equal(
                state.calls.some(({ name }) => name === "reserve_google_calendar_setup_probe"),
                false,
              );
              state.accounts[0].authorized_scopes = granted;
              await action();
              assert.equal(connection().pipedream_account_id, state.account);
              assert.ok(connection().setup_completed_at);
            },
          );
        }
      }
      const admissionFixture = await readFile(
        path.join(root, "supabase/tests/booking-calendar-lifetime.sql"),
        "utf8",
      );
      const reserveFixture = admissionFixture.match(
        /create function pg_temp\.reserve_calendar_test\([\s\S]*?end \$\$;/,
      )?.[0];
      assert.ok(
        reserveFixture,
        "exercise existing actual admission authority, not a replacement gate",
      );
      const reserve = () =>
        json(`begin;${reserveFixture}
        select pg_temp.reserve_calendar_test(${literal(state.website)},((current_date+3)+time '10:00') at time zone 'UTC');rollback;`);
      async function bookable(label) {
        await tenant(label, "grace");
        await save("a");
        await start();
        await complete();
        // Only inert prerequisites are seeded. Calendar health comes from the
        // actual owner/setup/verifier transitions, never an admission mock.
        const version = randomUUID(),
          service = randomUUID(),
          schedule = randomUUID();
        sql(`insert into public.website_versions(id,website_id,version_number,config_json,variant_key,status)
          values(${literal(version)},${literal(state.website)},1,'{}','google-owner-denial','live');
          update public.websites set status='live',active_version_id=${literal(version)} where id=${literal(state.website)};
          update public.website_entitlements set booking_admission=true where website_id=${literal(state.website)};
          insert into public.booking_services(id,profile_id,environment,name,duration_minutes,amount_minor,currency,active)
            values(${literal(service)},${literal(state.profile)},'test','Owner evidence test',60,10000,'USD',true);
          insert into public.availability_schedules(id,profile_id,service_id,environment,time_zone,active)
            values(${literal(schedule)},${literal(state.profile)},${literal(service)},'test','UTC',true);
          insert into public.availability_intervals(schedule_id,profile_id,environment,weekday,local_start,local_end)
            select ${literal(schedule)},${literal(state.profile)},'test',n,'00:00','23:59' from generate_series(0,6)n;
          insert into public.stripe_connected_accounts(profile_id,environment,stripe_account_id,onboarding_state,charges_enabled,payouts_enabled,details_submitted,capabilities,requirements,last_verified_at)
            values(${literal(state.profile)},'test',${literal("acct_" + label)},'ready',true,true,true,
            '{"card_payments":"active"}','{"currently_due":[],"past_due":[],"pending_verification":[]}',clock_timestamp());`);
        const preflight = rpc("capture_booking_cutover_preflight_v3", {
          p_profile_id: state.profile,
          p_environment: "test",
        });
        rpc("prepare_booking_convergence_cutover", {
          p_profile_id: state.profile,
          p_environment: "test",
        });
        rpc("activate_booking_cutover_v3", { p_preflight_id: preflight });
        assert.ok(
          reserve().appointmentId,
          "healthy saved configuration admits a real SQL reservation",
        );
        // A subsequent reconnect has a fresh captured key, not the completed
        // operation's now-consumed setup key. Only advance its rate-limit clock.
        sql(
          `update public.calendar_connections set connect_started_at=connect_started_at-interval '31 seconds' where profile_id=${literal(state.profile)};`,
        );
        await start();
      }
      for (const actionName of ["save", "complete"]) {
        for (const evidence of [
          "scopes",
          "unknown-scopes",
          "destination-role",
          "missing-blocker",
        ]) {
          await check(
            `H4 saved ${actionName}/${evidence}: actual negative settlement immediately closes SQL admission`,
            async () => {
              await bookable(`negative_${actionName}_${evidence.replaceAll("-", "_")}`);
              const healthy = connection(),
                desired = selections();
              if (evidence === "scopes") state.accounts[0].authorized_scopes = [];
              if (evidence === "unknown-scopes") delete state.accounts[0].authorized_scopes;
              if (evidence === "destination-role")
                state.calendars.find((calendar) => calendar.id === "destination-a").accessRole =
                  "reader";
              if (evidence === "missing-blocker")
                state.calendars = state.calendars.filter((calendar) => calendar.id !== "busy-a");
              state.calls = [];
              await assert.rejects(actionName === "save" ? () => save("a") : complete);
              const denied = connection();
              assert.equal(denied.health_state, "degraded");
              assert.equal(
                denied.verification_reason,
                evidence === "unknown-scopes"
                  ? "provider_temporary_failure"
                  : "calendar_permissions_changed",
              );
              assert.equal(denied.reconnect_reason, null);
              assert.equal(denied.connection_revision, healthy.connection_revision);
              assert.equal(denied.pipedream_account_id, healthy.pipedream_account_id);
              assert.equal(denied.last_verified_at, healthy.last_verified_at);
              assert.ok(denied.availability_generation > healthy.availability_generation);
              assert.deepEqual(selections(), desired);
              assert.ok(
                state.calls.some(({ name }) => name === "reconcile_google_calendar_connection"),
              );
              assert.equal(
                state.calls.some(({ type }) => type === "probe"),
                false,
              );
              assert.throws(
                reserve,
                (error) =>
                  error.code === "P0001" &&
                  /calendar|booking readiness|booking is not/i.test(error.message),
              );
              assert.equal(
                sql(`select reconciliation_due_at<=clock_timestamp() and deployed_trigger_id is not null
              and cardinality(pending_trigger_deletions)=0 from public.pipedream_bindings where connection_id=${literal(healthy.id)};`),
                "t",
              );
              assert.equal((await load()).verificationReason, denied.verification_reason);
            },
          );
        }
      }
      for (const actionName of ["save", "complete"]) {
        for (const stage of ["calendars", "freebusy"]) {
          for (const evidence of [
            {
              label: "google-denial",
              layer: "google",
              status: 403,
              reason: "insufficientPermissions",
              denied: true,
            },
            {
              label: "proxy-403",
              layer: "proxy",
              status: 403,
              reason: "insufficientPermissions",
              denied: false,
            },
            {
              label: "machine-403",
              layer: "machine",
              status: 403,
              reason: "insufficientPermissions",
              denied: false,
            },
            {
              label: "proxy-401",
              layer: "proxy",
              status: 401,
              reason: "invalid_grant",
              denied: false,
            },
            {
              label: "google-401",
              layer: "google",
              status: 401,
              reason: "invalid_grant",
              denied: false,
            },
            {
              label: "google-unknown-403",
              layer: "google",
              status: 403,
              reason: "forbidden",
              denied: false,
            },
          ]) {
            await check(
              `H4 thrown ${actionName}/${stage}/${evidence.label}: exact provider classification reaches SQL admission`,
              async () => {
                await bookable(
                  `thrown_${actionName}_${stage}_${evidence.label.replaceAll("-", "_")}`,
                );
                const healthy = connection(),
                  desired = selections();
                state.providerFailure = { stage, ...evidence };
                state.calls = [];
                await assert.rejects(
                  actionName === "save" ? () => save("a") : complete,
                  (error) => error === state.lastProviderError,
                );
                const current = connection();
                assert.equal(current.health_state, evidence.denied ? "degraded" : "healthy");
                assert.equal(
                  current.verification_reason,
                  evidence.denied ? "calendar_permissions_changed" : null,
                );
                assert.equal(current.reconnect_reason, null);
                assert.equal(current.connection_revision, healthy.connection_revision);
                assert.equal(current.pipedream_account_id, healthy.pipedream_account_id);
                assert.equal(current.last_verified_at, healthy.last_verified_at);
                assert.deepEqual(selections(), desired);
                assert.equal(
                  state.calls.some(({ name }) => name === "reconcile_google_calendar_connection"),
                  evidence.denied,
                );
                assert.equal(
                  state.calls.some(({ type }) => type === "probe"),
                  false,
                );
                if (evidence.denied) assert.throws(reserve, (error) => error.code === "P0001");
                else
                  assert.ok(
                    reserve().appointmentId,
                    "unknown transport authorization cannot fabricate saved permission loss",
                  );
              },
            );
          }
        }
      }
      for (const target of [
        "saved-subset",
        "candidate-set",
        "mixed-set",
        "candidate-account",
        "stale-revision",
      ]) {
        await check(
          `H4 FreeBusy ${target}: batch denial requires frozen saved attribution`,
          async () => {
            await bookable(`freebusy_${target.replaceAll("-", "_")}`);
            let baseline = connection();
            if (target === "saved-subset") {
              await bundle.subject.saveGoogleCalendarSelection({
                data: {
                  websiteId: state.website,
                  accountId: state.account,
                  expectedRevision: baseline.connection_revision,
                  blockingCalendarIds: ["busy-a", "busy-b"],
                  destinationCalendarId: "destination-a",
                },
              });
              await bundle.subject.configureGoogleCalendarTrigger({
                data: { websiteId: state.website },
              });
              baseline = connection();
            }
            if (target === "candidate-account") {
              state.account = "apn_freebusy_candidate";
              state.accounts.push({ ...state.accounts[0], id: state.account });
            }
            state.providerFailure = { stage: "freebusy", layer: "google" };
            if (target === "stale-revision")
              state.afterProviderRead = async (stage) => {
                if (stage !== "freebusy") return;
                state.afterProviderRead = null;
                const failure = state.providerFailure;
                state.providerFailure = null;
                await save("b");
                await bundle.subject.configureGoogleCalendarTrigger({
                  data: { websiteId: state.website },
                });
                state.providerFailure = failure;
              };
            state.calls = [];
            await assert.rejects(
              () =>
                bundle.subject.saveGoogleCalendarSelection({
                  data: {
                    websiteId: state.website,
                    accountId: state.account,
                    expectedRevision: baseline.connection_revision,
                    blockingCalendarIds:
                      target === "candidate-set"
                        ? ["busy-b"]
                        : target === "mixed-set"
                          ? ["busy-a", "busy-b"]
                          : ["busy-a"],
                    destinationCalendarId: "destination-a",
                  },
                }),
              (error) => error === state.lastProviderError,
            );
            const attributed = target === "saved-subset";
            assert.equal(connection().health_state, attributed ? "degraded" : "healthy");
            assert.equal(
              state.calls.some(({ name }) => name === "reconcile_google_calendar_connection"),
              attributed,
            );
            if (attributed) assert.throws(reserve, (error) => error.code === "P0001");
            else assert.ok(reserve().appointmentId);
          },
        );
      }
      for (const target of ["candidate-account", "stale-revision"]) {
        await check(
          `H4 CalendarList ${target}: thrown denial cannot poison saved readiness`,
          async () => {
            await bookable(`list_${target.replaceAll("-", "_")}`);
            const baseline = connection();
            if (target === "candidate-account") {
              state.account = "apn_list_candidate";
              state.accounts.push({ ...state.accounts[0], id: state.account });
            }
            state.providerFailure = { stage: "calendars", layer: "google" };
            if (target === "stale-revision")
              state.afterProviderRead = async (stage) => {
                if (stage !== "calendars") return;
                state.afterProviderRead = null;
                const failure = state.providerFailure;
                state.providerFailure = null;
                await save("b");
                await bundle.subject.configureGoogleCalendarTrigger({
                  data: { websiteId: state.website },
                });
                state.providerFailure = failure;
              };
            state.calls = [];
            await assert.rejects(
              () =>
                bundle.subject.saveGoogleCalendarSelection({
                  data: {
                    websiteId: state.website,
                    accountId: state.account,
                    expectedRevision: baseline.connection_revision,
                    blockingCalendarIds: ["busy-a"],
                    destinationCalendarId: "destination-a",
                  },
                }),
              (error) => error === state.lastProviderError,
            );
            assert.equal(connection().health_state, "healthy");
            assert.equal(
              state.calls.some(({ name }) => name === "reconcile_google_calendar_connection"),
              false,
            );
            assert.ok(reserve().appointmentId);
          },
        );
      }
      for (const evidence of ["scopes", "candidate-role"]) {
        await check(
          `H4 unrelated ${evidence}: candidate denial cannot poison saved account/calendars`,
          async () => {
            await bookable(`candidate_${evidence.replaceAll("-", "_")}`);
            const healthy = connection();
            if (evidence === "scopes") {
              state.account = "apn_unrelated_candidate";
              state.accounts.push({
                ...state.accounts[0],
                id: state.account,
                authorized_scopes: [],
              });
            } else
              state.calendars.find((calendar) => calendar.id === "destination-b").accessRole =
                "reader";
            state.calls = [];
            await assert.rejects(() => save("b"));
            assert.deepEqual(connection(), healthy);
            assert.equal(
              state.calls.some(({ name }) => name === "reconcile_google_calendar_connection"),
              false,
            );
            assert.ok(reserve().appointmentId);
          },
        );
      }
      await check(
        "H4 pending candidate completion cannot attribute B's denied scopes to healthy saved A",
        async () => {
          await bookable("candidate_completion");
          const savedAccount = state.account;
          state.account = "apn_pending_denied_candidate";
          state.accounts.push({ ...state.accounts[0], id: state.account });
          state.deniedAction = "insert";
          await assert.rejects(() => save("b"), /setup is pending/);
          state.deniedAction = null;
          sql(
            `update public.calendar_connections set connect_started_at=connect_started_at-interval '31 seconds' where profile_id=${literal(state.profile)};`,
          );
          await start();
          state.accounts[1].authorized_scopes = [];
          const before = connection();
          state.calls = [];
          await assert.rejects(complete, /Reconnect Google Calendar and allow access/);
          assert.deepEqual(connection(), before);
          assert.equal(before.pipedream_account_id, savedAccount);
          assert.equal(before.health_state, "healthy");
          assert.equal(
            state.calls.some(({ name }) => name === "reconcile_google_calendar_connection"),
            false,
          );
          assert.equal(
            state.calls.some(({ type }) => type === "probe"),
            false,
          );
          assert.ok(reserve().appointmentId);
        },
      );
      for (const raceAt of ["provider", "settlement"]) {
        await check(
          `H4 stale owner ${raceAt}: frozen account/revision cannot degrade a replacement`,
          async () => {
            await bookable(`stale_${raceAt}`);
            const original = connection();
            const replacement = async () => {
              state.afterProviderRead = null;
              state.beforeRpc = null;
              const badScopes = state.accounts[0].authorized_scopes;
              state.accounts[0].authorized_scopes = [
                "https://www.googleapis.com/auth/calendar.events",
                "https://www.googleapis.com/auth/calendar.readonly",
              ];
              await save("b");
              await bundle.subject.configureGoogleCalendarTrigger({
                data: { websiteId: state.website },
              });
              state.accounts[0].authorized_scopes = badScopes;
            };
            state.accounts[0].authorized_scopes = [];
            if (raceAt === "provider") state.afterProviderRead = replacement;
            else {
              // Race exactly after the helper's matching saved-config read. The SQL
              // fence must reject rather than borrowing a newly fetched revision.
              state.beforeRpc = async (name) => {
                if (name !== "reconcile_google_calendar_connection") return;
                await replacement();
              };
            }
            state.calls = [];
            await assert.rejects(() => save("a"));
            assert.equal(connection().health_state, "healthy");
            assert.equal(connection().verification_reason, null);
            assert.equal(connection().connection_revision, original.connection_revision + 1);
            if (raceAt === "provider") {
              assert.equal(
                state.calls.some(({ name }) => name === "reconcile_google_calendar_connection"),
                false,
              );
            } else
              assert.deepEqual(state.sqlErrors.at(-1), {
                name: "reconcile_google_calendar_connection",
                code: "40001",
              });
            assert.ok(reserve().appointmentId);
          },
        );
      }
    }
    for (const existing of [false, true]) {
      await tenant(existing ? "handoff_saved" : "handoff_initial");
      if (existing) await save("a");
      state.deniedAction = "insert";
      await assert.rejects(() => save("b"), /setup is pending/);
      state.deniedAction = null;
      const pending = connection();
      const expected = [
        ["busy-b", true, false],
        ["destination-b", false, true],
      ];
      await check(
        `R1 actual owner handler reads pending ${existing ? "replacement" : "initial"} setup as service_role`,
        async () => {
          const config = await load();
          assert.equal(config.pendingSetup.accountId, state.account);
          assert.equal(config.pendingSetup.destinationCalendarId, "destination-b");
          assert.deepEqual(config.pendingSetup.blockingCalendarIds, ["busy-b"]);
          assert.equal(
            config.pendingSetup.configurationKey,
            createHash("sha256")
              .update(
                JSON.stringify([
                  pending.setup_operation_id,
                  state.account,
                  pending.connection_revision,
                  ["busy-b"],
                  "destination-b",
                ]),
              )
              .digest("hex"),
          );
          assert.equal(config.pendingSetup.reason, "permissions");
          assert.deepEqual(
            connection(),
            pending,
            "the pending read cannot change configuration, health, lease or attempt facts",
          );
          assert.equal(
            sql(
              "select has_table_privilege('service_role','public.booking_provider_account_disconnects_v3','SELECT');",
            ),
            "f",
          );
        },
      );
      await check(
        `R2 actual start/cookie/SQL completion preserves pending ${existing ? "replacement" : "initial"} choices`,
        async () => {
          await start();
          assert.equal(
            connection().connect_expected_setup_key,
            sql(
              `select public.google_calendar_setup_configuration_key(c) from public.calendar_connections c where id=${literal(pending.id)};`,
            ),
          );
          await complete();
          assert.deepEqual(selections(), expected);
          assert.equal(connection().setup_operation_id, pending.setup_operation_id);
          assert.ok(connection().setup_completed_at);
          assert.equal(connection().health_state, "healthy");
        },
      );
    }
    if (redControl) {
      assert.equal(
        failures.length,
        4,
        "both original defects must fail in initial and replacement setup",
      );
      console.log(
        "PASS: red controls reproduce R1/R2 failures without changing source or another database",
      );
      return;
    }
    await check(
      "R1 current SQL snapshot replaces stale pending choices without granting ledger SELECT",
      async () => {
        await tenant("handoff_snapshot");
        state.deniedAction = "insert";
        await assert.rejects(() => save("a"), /setup is pending/);
        state.deniedAction = null;
        const old = connection();
        const key = sql(
          `select public.google_calendar_setup_configuration_key(c) from public.calendar_connections c where id=${literal(old.id)};`,
        );
        state.beforePendingRead = () => {
          state.beforePendingRead = null;
          const lease = randomUUID();
          const probe = rpc("reserve_google_calendar_setup_probe", {
            p_profile_id: state.profile,
            p_environment: "test",
            p_actor_auth_user_id: state.owner,
            p_account_id: state.account,
            p_calendar_id: "destination-b",
            p_expected_revision: old.connection_revision,
            p_lease_token: lease,
            p_calendars: [
              {
                id: "busy-b",
                displayName: "B",
                accessRole: "reader",
                blocksAvailability: true,
                receivesBookings: false,
              },
              {
                id: "destination-b",
                displayName: "B",
                accessRole: "writer",
                blocksAvailability: false,
                receivesBookings: true,
              },
            ],
            p_read_verified_at: new Date().toISOString(),
            p_expected_setup_key: key,
          });
          rpc("settle_google_calendar_setup_probe", {
            p_profile_id: state.profile,
            p_environment: "test",
            p_operation_id: probe.id,
            p_lease_token: lease,
            p_fencing_token: probe.fencing_token,
            p_success: false,
            p_write_verified: false,
            p_reason: "temporary",
          });
        };
        const current = await load();
        assert.equal(current.pendingSetup.destinationCalendarId, "destination-b");
        assert.notEqual(current.pendingSetup.configurationKey, key);
        state.failPendingRead = true;
        await assert.rejects(load, /Unable to load pending Google Calendar setup/);
        state.failPendingRead = false;
        state.invalidPendingRead = true;
        await assert.rejects(load, /Unable to load pending Google Calendar setup/);
        state.invalidPendingRead = false;
        const originalOwner = state.owner;
        state.owner = randomUUID();
        await assert.rejects(load, /Forbidden/);
        state.owner = originalOwner;
        assert.throws(
          () =>
            rpc("get_pending_google_calendar_setup", {
              p_profile_id: state.profile,
              p_environment: "test",
              p_expected_revision: old.connection_revision - 1,
            }),
          (error) => error.code === "40001",
        );
        for (const role of ["anon", "authenticated", "booking_worker"])
          assert.throws(
            () =>
              rpc(
                "get_pending_google_calendar_setup",
                {
                  p_profile_id: state.profile,
                  p_environment: "test",
                  p_expected_revision: old.connection_revision,
                },
                role,
              ),
            (error) => error.code === "42501",
          );
        rpc("reserve_booking_provider_account_disconnect_v3", {
          p_profile_id: state.profile,
          p_environment: "test",
          p_provider_account_id: state.account,
          p_actor_auth_user_id: state.owner,
          p_expected_connection_revision: old.connection_revision,
        });
        assert.equal((await load()).pendingSetup, null);
      },
    );
    await check("R2 obsolete OAuth key cannot overwrite newer pending choices", async () => {
      await tenant("handoff_stale");
      state.deniedAction = "insert";
      await assert.rejects(() => save("a"), /setup is pending/);
      state.deniedAction = null;
      await start();
      const key = (await load()).pendingSetup.configurationKey;
      state.deniedAction = "insert";
      await assert.rejects(() => save("b", key), /setup is pending/);
      state.deniedAction = null;
      const calls = state.calls.filter((item) => item.type === "accounts").length;
      await assert.rejects(complete, /could not be settled/);
      assert.equal(state.calls.filter((item) => item.type === "accounts").length, calls);
      assert.equal(connection().setup_calendar_id, "destination-b");
      assert.equal(connection().setup_completed_at, null);
    });
    await check("R2 lost destination permission never falls back to writable primary", async () => {
      await tenant("handoff_permission");
      state.deniedAction = "insert";
      await assert.rejects(() => save("b"), /setup is pending/);
      state.deniedAction = null;
      await start();
      state.calendars.find((item) => item.id === "destination-b").accessRole = "reader";
      const writes = state.calls.filter(
        (item) => item.type === "probe" && item.method === "POST",
      ).length;
      await assert.rejects(complete, /Restore access to your chosen Google calendars/);
      assert.equal(connection().setup_calendar_id, "destination-b");
      assert.equal(
        state.calls.filter((item) => item.type === "probe" && item.method === "POST").length,
        writes,
      );
      state.calendars.find((item) => item.id === "destination-b").accessRole = "writer";
      state.calendars = state.calendars.filter((item) => item.id !== "primary");
      await complete();
      assert.deepEqual(selections(), [
        ["busy-b", true, false],
        ["destination-b", false, true],
      ]);
    });
    await check(
      "R2 captured account beats retained newer inventory; distinct new account needs explicit selection",
      async () => {
        await tenant("handoff_accounts");
        await save("a");
        state.deniedAction = "insert";
        await assert.rejects(() => save("b"), /setup is pending/);
        state.deniedAction = null;
        state.accounts.push({
          ...state.accounts[0],
          id: "apn_retained",
          created_at: "2026-02-01T00:00:00Z",
        });
        await start();
        await complete();
        assert.equal(connection().pipedream_account_id, state.account);
        assert.deepEqual(selections(), [
          ["busy-b", true, false],
          ["destination-b", false, true],
        ]);
        sql(
          `update public.calendar_connections set connect_started_at=connect_started_at-interval '31 seconds' where profile_id=${literal(state.profile)};`,
        );
        await start();
        state.accounts.push({
          ...state.accounts[0],
          id: "apn_explicit_new",
          created_at: new Date().toISOString(),
        });
        const before = selections();
        await assert.rejects(complete, /account selection needs review/);
        assert.deepEqual(selections(), before);
        state.account = "apn_explicit_new";
        await save("a");
        assert.equal(connection().pipedream_account_id, "apn_explicit_new");
        assert.deepEqual(selections(), [
          ["busy-a", true, false],
          ["destination-a", false, true],
        ]);
      },
    );
    await check(
      "R2 pending account B overrides saved account A without transferring B's choices to A",
      async () => {
        await tenant("handoff_pending_account");
        await save("a");
        state.account = "apn_pending_account_B";
        state.accounts.push({
          ...state.accounts[0],
          id: state.account,
          created_at: "2026-02-01T00:00:00Z",
        });
        state.deniedAction = "insert";
        await assert.rejects(() => save("b"), /setup is pending/);
        state.deniedAction = null;
        await start();
        assert.equal((await load()).pendingSetup.accountId, state.account);
        await complete();
        assert.equal(connection().pipedream_account_id, state.account);
        assert.deepEqual(selections(), [
          ["busy-b", true, false],
          ["destination-b", false, true],
        ]);
      },
    );
    await check(
      "R2 true first setup alone may choose primary; missing/wrong cookie cannot complete",
      async () => {
        await tenant("handoff_first");
        await assert.rejects(complete, /Start Google Connect/);
        await start();
        const request = state.request;
        state.request = new Request("https://example.test/user", {
          headers: { cookie: `obra_google_connect_${state.profile}_test=${randomUUID()}` },
        });
        await assert.rejects(complete, /could not be settled/);
        state.request = request;
        await complete();
        assert.deepEqual(selections(), [["primary", true, true]]);
      },
    );
    assert.deepEqual(failures, [], "actual handler/service-role SQL regressions");
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.__googleSqlHandoffs;
    await bundle?.cleanup();
    await maintenanceBundle?.cleanup();
  }
}
