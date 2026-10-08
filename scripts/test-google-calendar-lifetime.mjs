import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const scope = { profileId: "profile-test", environment: "test" };
const key = "google_calendar-new-or-updated-event-instant";
const state = {};
const trigger = (id = "dc_saved", overrides = {}) => ({
  id,
  componentId: "sc_fixture",
  componentKey: key,
  active: true,
  configuredProps: {
    googleCalendar: { authProvisionId: "apn_saved" },
    calendarIds: ["busy-a", "busy-b"],
    newOnly: false,
  },
  ...overrides,
});
const webhook = {
  id: "wh_saved",
  signingKey: "fixture-key",
  url: "https://example.test/webhook",
  updatedAt: new Date().toISOString(),
};
function reset() {
  Object.assign(state, {
    rpc: [],
    calls: [],
    errors: [],
    rejectRpc: null,
    falseRpc: null,
    failAt: null,
    failure: null,
    noClaim: false,
    workload: null,
    inventory: [],
    disconnect: null,
    probe: null,
    probeEvent: null,
    editBeforeDelete: false,
    loseInsertResponse: false,
    loseDeleteResponse: false,
    webhook: { ...webhook },
    observed: trigger(),
    definitionId: undefined,
    deployedComponentId: "sc_fixture",
    deployedTriggerId: "dc_new",
    account: {
      id: "apn_saved",
      healthy: true,
      dead: false,
      error: null,
      authorized_scopes: [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
    },
    calendars: [
      { id: "busy-a", accessRole: "reader" },
      { id: "busy-b", accessRole: "freeBusyReader" },
      { id: "destination", accessRole: "writer" },
    ],
    claim: {
      connection: {
        id: "connection-test",
        profile_id: scope.profileId,
        environment: scope.environment,
        pipedream_account_id: "apn_saved",
        connection_revision: 12,
        verification_reason: null,
      },
      selections: [
        { google_calendar_id: "busy-a", blocks_availability: true, receives_bookings: false },
        { google_calendar_id: "busy-b", blocks_availability: true, receives_bookings: false },
        { google_calendar_id: "destination", blocks_availability: false, receives_bookings: true },
      ],
      cleanup_only: false,
      binding: {
        id: "binding-test",
        profile_id: scope.profileId,
        environment: scope.environment,
        connection_id: "connection-test",
        pipedream_account_id: "apn_saved",
        configuration_revision: 12,
        component_key: key,
        component_version: "1.2.3",
        deployed_trigger_id: "dc_saved",
        webhook_id: "wh_saved",
        webhook_correlation_id: "correlation-test",
        trigger_state: "active",
        selected_calendar_ids: ["busy-a", "busy-b"],
        reconciliation_fencing_token: 8,
        reconciliation_lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
        deployment_operation_id: null,
        deployment_candidate_trigger_id: null,
        deployment_dispatched_at: null,
        deployment_receipt: {
          trigger_id: "dc_saved",
          component_id: "sc_fixture",
          component_key: key,
          component_version: "1.2.3",
          operation_id: "prior-successful-operation",
        },
        retired_deployment: null,
        retired_trigger_ids: [],
        pending_trigger_deletions: [],
      },
    },
  });
}
state.supabaseAdmin = {
  rpc(name, args) {
    state.rpc.push({ name, args: structuredClone(args) });
    return {
      async abortSignal(signal) {
        assert.ok(signal instanceof AbortSignal, "database calls must also be bounded");
        if (state.rejectRpc === name)
          return { data: null, error: { message: "PRIVATE database diagnostic" } };
        if (state.falseRpc === name) return { data: false, error: null };
        let data = true;
        if (name === "claim_saved_google_calendar_verification")
          data = state.noClaim ? null : structuredClone(state.claim);
        if (name === "claim_due_pipedream_bindings") {
          assert.equal(args.p_limit, 1);
          const claim = state.workload
            ? state.workload.bindings.find(
                (item) =>
                  !args.p_exclude_binding_ids.includes(item.binding.id) &&
                  (item.dueAt ?? 0) <= Date.now(),
              )
            : state.noClaim || args.p_exclude_binding_ids.includes(state.claim.binding.id)
              ? null
              : state.claim;
          data = claim ? [structuredClone(claim)] : [];
          if (claim) state.claim = structuredClone(claim);
          if (claim && state.workload?.timed) {
            state.claim.binding.reconciliation_lease_expires_at = new Date(
              Date.now() + args.p_lease_seconds * 1000,
            ).toISOString();
            data = [structuredClone(state.claim)];
          }
        }
        if (name === "claim_booking_provider_account_disconnect_v3") {
          data = state.workload
            ? (state.workload.disconnects.find(
                (item) =>
                  !args.p_exclude_ids.includes(item.id) &&
                  !item.completed &&
                  (item.dueAt ?? 0) <= Date.now(),
              ) ?? null)
            : state.disconnect;
          if (data && state.workload?.timed)
            data = { ...data, lease_expires_at: new Date(Date.now() + 90_000).toISOString() };
        }
        if (name === "claim_google_calendar_setup_probe") {
          if (state.workload)
            state.probe = structuredClone(
              state.workload.probes.find(
                (item) =>
                  !args.p_exclude_operation_ids.includes(item.id) &&
                  !item.completed &&
                  (item.dueAt ?? 0) <= Date.now(),
              ) ?? null,
            );
          if (state.probe && state.workload?.timed) {
            state.probe.lease_expires_at = new Date(Date.now() + 90_000).toISOString();
            state.probeEvent = state.workload.events.get(state.probe.probe_id) ?? null;
          }
          data = state.probe;
        }
        if (name === "record_pipedream_trigger_deployment_result") data = false;
        if (name === "authorize_google_calendar_setup_effect" && state.probe) {
          if (args.p_action === "insert") state.probe.probe_state = "insert_dispatched";
          if (args.p_action === "delete") state.probe.probe_state = "delete_dispatched";
        }
        if (name === "settle_google_calendar_setup_probe" && state.probe) {
          const previousState = state.probe.probe_state;
          if (args.p_probe_state) state.probe.probe_state = args.p_probe_state;
          if (args.p_write_verified) state.probe.write_verified_at = new Date().toISOString();
          if (
            args.p_write_verified &&
            args.p_probe_state === "absent" &&
            previousState === "delete_dispatched"
          )
            state.probe.probe_write_verified_at = new Date().toISOString();
          data = structuredClone(state.probe);
        }
        if (name === "record_google_calendar_setup_read" && state.probe)
          state.probe.read_verified_at = args.p_verified_at;
        if (name === "restart_google_calendar_setup_probe") {
          Object.assign(state.probe, {
            probe_id: "77777777-7777-4777-8777-777777777777",
            probe_account_id: state.probe.account_id,
            probe_calendar_id: state.probe.calendar_id,
            probe_state: "pending",
            write_verified_at: null,
            cleanup_only: false,
          });
          state.probeEvent = null;
          data = structuredClone(state.probe);
        }
        if (name === "reserve_pipedream_trigger_deployment") {
          state.claim.binding.deployment_operation_id ??= "operation-test";
          state.claim.binding.component_version = args.p_component_version;
          data = structuredClone(state.claim.binding);
        }
        if (name === "retire_pipedream_trigger") {
          const b = state.claim.binding;
          b.retired_trigger_ids.push(args.p_deployed_trigger_id);
          b.pending_trigger_deletions.push(args.p_deployed_trigger_id);
          b.deployed_trigger_id = null;
          b.webhook_id = null;
          b.deployment_candidate_trigger_id = null;
          b.deployment_receipt = null;
          b.deployment_operation_id = null;
          b.deployment_dispatched_at = null;
          data = structuredClone(b);
        }
        if (name === "begin_pipedream_trigger_deployment_effect")
          state.claim.binding.deployment_dispatched_at = new Date().toISOString();
        if (name === "adopt_pipedream_trigger_candidate") {
          state.claim.binding.deployment_candidate_trigger_id = args.p_deployed_trigger_id;
          if (args.p_component_id !== undefined) {
            assert.ok(
              state.calls.some(({ name }) => name === "deploy"),
              "only a deploy response can create a receipt",
            );
            assert.equal(
              args.p_deployment_operation_id,
              state.claim.binding.deployment_operation_id,
            );
            state.claim.binding.deployment_receipt = {
              trigger_id: args.p_deployed_trigger_id,
              component_id: args.p_component_id,
              component_key: key,
              component_version: state.claim.binding.component_version,
              operation_id: args.p_deployment_operation_id,
            };
          }
        }
        if (name === "complete_pipedream_stale_trigger_cleanup")
          state.claim.binding.pending_trigger_deletions =
            state.claim.binding.pending_trigger_deletions.filter(
              (id) => id !== args.p_deployed_trigger_id,
            );
        if (name === "fail_pipedream_binding_reconciliation") {
          state.claim.binding.trigger_state = "degraded";
          if (args.p_deployment_definitely_rejected)
            state.claim.binding.deployment_dispatched_at = null;
        }
        if (name === "apply_pipedream_trigger_projection") {
          Object.assign(state.claim.binding, {
            deployed_trigger_id: args.p_deployed_trigger_id,
            trigger_state: "active",
            deployment_candidate_trigger_id: null,
            deployment_operation_id: null,
            deployment_dispatched_at: null,
          });
          data = structuredClone(state.claim.binding);
        }
        if (state.workload) {
          const kind = {
            claim_booking_provider_account_disconnect_v3: "disconnect",
            claim_google_calendar_setup_probe: "probe",
            claim_due_pipedream_bindings: "binding",
          }[name];
          if (kind) {
            assert.equal(
              state.workload.inFlight.has(kind),
              false,
              "each class claims only after its preceding item's settlement",
            );
            state.workload.opportunities.push(kind);
            const item = kind === "binding" ? data[0]?.binding : data;
            if (item) {
              state.workload.claimed.push({ kind, id: item.id });
              state.workload.inFlight.set(kind, {
                kind,
                id: item.id,
                lease: args.p_lease_token,
                fence: kind === "binding" ? item.reconciliation_fencing_token : item.fencing_token,
                expiresAt: Date.parse(
                  kind === "binding" ? item.reconciliation_lease_expires_at : item.lease_expires_at,
                ),
              });
              assert.ok(state.workload.inFlight.size <= 3);
            }
          } else if (args.p_fencing_token !== undefined) {
            const current = [...state.workload.inFlight.values()].find(
              (item) => item.lease === args.p_lease_token,
            );
            assert.ok(current, "settlement has its own active class claim");
            assert.equal(args.p_fencing_token, current.fence);
            assert.ok(
              Date.now() < current.expiresAt,
              "no operation or settlement uses an expired claim",
            );
            if (
              [
                "complete_booking_provider_account_disconnect_v3",
                "fail_booking_provider_account_disconnect_v3",
                "persist_google_calendar_configuration",
                "apply_pipedream_trigger_projection",
                "fail_pipedream_binding_reconciliation",
              ].includes(name) ||
              (name === "settle_google_calendar_setup_probe" &&
                (!args.p_success ||
                  (!state.probe.configuration_current && args.p_probe_state === "absent")))
            ) {
              state.workload.settled.push(current.kind);
              state.workload.inFlight.delete(current.kind);
              if (state.workload.timed) {
                if (current.kind === "probe") {
                  const pending = state.workload.probes.find((item) => item.id === current.id);
                  Object.assign(pending, structuredClone(state.probe), {
                    completed: name === "persist_google_calendar_configuration",
                    dueAt: Date.now() + 60_000,
                  });
                  state.workload.events.set(
                    state.probe.probe_id,
                    structuredClone(state.probeEvent),
                  );
                } else if (current.kind === "disconnect") {
                  Object.assign(
                    state.workload.disconnects.find((item) => item.id === current.id),
                    {
                      completed: name === "complete_booking_provider_account_disconnect_v3",
                      dueAt: Date.now() + 60_000,
                    },
                  );
                } else {
                  const binding = state.workload.bindings.find(
                    (item) => item.binding.id === current.id,
                  );
                  if (name === "apply_pipedream_trigger_projection")
                    state.workload.verified.push({ id: current.id, at: Date.now() });
                  binding.dueAt =
                    Date.now() + (name === "apply_pipedream_trigger_projection" ? 600_000 : 60_000);
                }
              }
              state.workload.afterSettlement?.();
            }
          }
        }
        return { data, error: null };
      },
    };
  },
};
state.invoke = async (name, input) => {
  state.calls.push({ name, input });
  if (state.failAt === name) throw state.failure ?? new Error("PRIVATE provider diagnostic");
  if (state.workload?.delay) await state.workload.delay(name, input);
};

globalThis.__googleLifetime = state;
let bundle;
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
let networkCalls = 0;
try {
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("Network is forbidden in lifecycle tests");
  };
  console.error = (...args) => state.errors.push(args);
  bundle = await importWithMocks(
    path.resolve("src/lib/pipedream-trigger-reconciliation.server.ts"),
    {
      "@/integrations/supabase/client.server": `export const supabaseAdmin = globalThis.__googleLifetime.supabaseAdmin;`,
      "@/lib/auth/contractor-session.server": `export const getContractorAuthUserId = async () => 'owner-test';`,
      "@/lib/pipedream.server": `
      import { PipedreamError, PipedreamRequestError, isGoogleCalendarOneOffEvent, hasGoogleCalendarBookingScopes, withPipedreamDeadline as bounded, classifyPipedreamFailure as classify } from ${JSON.stringify(path.resolve("src/lib/pipedream.server.ts"))};
      import * as worker from '@/lib/worker-deadline.server';
      export { PipedreamError, PipedreamRequestError, isGoogleCalendarOneOffEvent, hasGoogleCalendarBookingScopes };
      const s = globalThis.__googleLifetime;
      s.worker = worker;
      s.RequestError = PipedreamRequestError;
      s.ProviderError = PipedreamError;
      export const classifyPipedreamFailure = (error) => error?.classification ?? classify(error);
      export const withPipedreamDeadline = async (deadlineAt, work, options) => {
        if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) throw new Error('deadline');
        s.deadline = deadlineAt;
        return bounded(deadlineAt, work, options);
      };
      export const pipedreamTriggerWebhookUrl = () => 'https://example.test/webhook';
      export const listGoogleAccounts = async (profileId, environment) => {
        await s.invoke('accounts', { profileId, environment }); return s.account ? [s.account] : [];
      };
      export const listGoogleCalendars = async (input) => { await s.invoke('calendars', input); return s.calendars; };
      export const verifyGoogleCalendarFreeBusy = async (input) => s.invoke('freebusy', input);
      export const verifyGoogleCalendarEventAccess = async (input) => s.invoke('event-access', input);
      export const getDeployedPipedreamTrigger = async (input) => {
        await s.invoke('trigger', input);
        if (!s.observed) throw new PipedreamRequestError(404, 'Pipedream deployed trigger lookup');
        return s.observed;
      };
      export const getPipedreamTriggerWebhook = async (input) => {
        await s.invoke('webhook', input);
        if (!s.webhook) throw new PipedreamRequestError(404, 'Pipedream webhook lookup');
        return s.webhook;
      };
      export const configurePipedreamTriggerWebhook = async (input) => {
        await s.invoke('configure', input);
        s.webhook = { id: 'wh_saved', signingKey: 'fixture-key', url: input.webhookUrl, updatedAt: new Date().toISOString() };
        return s.webhook;
      };
      export const listGoogleCalendarTriggers = async (input) => { await s.invoke('definitions', input); return [{ key: '${key}', version: '1.2.3' }]; };
      export const retrievePipedreamTrigger = async (input) => {
        await s.invoke('definition', input); return { ...input, id: s.definitionId, configurableProps: [
          { name: 'googleCalendar', type: 'app', app: 'google_calendar' },
          { name: 'calendarIds', type: 'string[]' }, { name: 'newOnly', type: 'boolean' },
        ] };
      };
      export const listDeployedPipedreamTriggers = async (input) => { await s.invoke('inventory', input); return s.inventory; };
      export const deployPipedreamTrigger = async (input) => {
        await s.invoke('deploy', input);
         return { id: s.deployedTriggerId, componentKey: null, componentId: s.deployedComponentId, active: true, configuredProps: input.configuredProps };
      };
      export const deletePipedreamTrigger = async (input) => s.invoke('delete-trigger', input);
      export const deletePipedreamAccount = async (input) => s.invoke('delete-account', input);
      export const verifyGoogleCalendarWrite = async (input) => s.invoke('write-probe', input);
      export const proxyGoogleCalendar = async (input) => {
        await s.invoke('proxy', input);
        if (input.method === 'POST') {
          await s.invoke('write-probe', input);
          s.probeEvent = { ...input.body, etag: '"fixture-v1"', status: 'confirmed' };
          if (s.loseInsertResponse) { s.loseInsertResponse=false; throw new Error('Lost INSERT response'); }
          return s.probeEvent;
        }
        if (input.method !== 'DELETE') {
          if (!s.probeEvent) throw new PipedreamRequestError(404, input.operation, 'notFound', 'google');
          return s.probeEvent;
        }
        if (s.editBeforeDelete) s.probeEvent.etag='"fixture-v2"';
        if (s.probeEvent && input.ifMatch !== s.probeEvent.etag) throw new PipedreamRequestError(412, input.operation, null, 'google');
        await s.invoke('delete-probe', input);
        s.probeEvent = { id: s.probeEvent?.id, status: 'cancelled' };
        if (s.loseDeleteResponse) { s.loseDeleteResponse=false; throw new Error('Lost DELETE response'); }
        return null;
      };
    `,
    },
  );
  const refresh = (allowRepair = false, extra = {}) =>
    bundle.subject.refreshSavedGoogleCalendar({
      ...scope,
      allowRepair,
      deadlineAt: Date.now() + 25_000,
      ...extra,
    });
  const mutationNames = new Set([
    "configure",
    "deploy",
    "delete-trigger",
    "delete-account",
    "write-probe",
    "proxy",
  ]);
  const assertNoProviderWrites = () =>
    assert.deepEqual(
      state.calls.filter(({ name }) => mutationNames.has(name)),
      [],
    );

  reset();
  assert.deepEqual(await refresh(), { checked: true });
  assert.deepEqual(
    state.calls.map(({ name }) => name),
    ["accounts", "calendars", "freebusy", "trigger", "definition", "webhook"],
  );
  assert.deepEqual(state.calls.find(({ name }) => name === "definition").input, {
    environment: "test",
    key,
    version: "1.2.3",
  });
  assert.deepEqual(state.calls[2].input.calendarIds, ["busy-a", "busy-b"]);
  assert.deepEqual(
    state.rpc.find(({ name }) => name === "mark_google_calendar_connection_verified").args
      .p_calendars,
    state.calendars.map((calendar) => ({ id: calendar.id, accessRole: calendar.accessRole })),
  );
  assert.equal(state.rpc[0].args.p_profile_id, scope.profileId);
  assert.equal(state.rpc[0].args.p_allow_repair, false);
  assertNoProviderWrites();
  console.log(
    "PASS: scoped public verifier reads the exact account, full blocking set and separate destination without writes",
  );

  reset();
  const ids = Array.from({ length: 121 }, (_, i) => `busy-${i}`);
  state.claim.selections = ids.map((id) => ({
    google_calendar_id: id,
    blocks_availability: true,
    receives_bookings: id === ids[0],
  }));
  state.calendars = ids.map((id) => ({ id, accessRole: "owner" }));
  state.claim.binding.selected_calendar_ids = ids;
  state.observed.configuredProps.calendarIds = ids;
  await refresh();
  assert.deepEqual(
    state.calls
      .filter(({ name }) => name === "freebusy")
      .map(({ input }) => input.calendarIds.length),
    [50, 50, 21],
  );
  assert.deepEqual(
    state.calls.filter(({ name }) => name === "freebusy").flatMap(({ input }) => input.calendarIds),
    ids,
  );
  console.log(
    "PASS: complete blocking verification is chunked to Google FreeBusy's 50-calendar boundary",
  );

  for (const classification of [
    "temporary",
    "platform",
    "configuration",
    "permissions",
    "reauthorization",
  ]) {
    reset();
    state.failAt = "calendars";
    state.failure = Object.assign(new Error("PRIVATE diagnostic with credentials"), {
      classification,
    });
    await assert.rejects(refresh, (error) => !error.message.includes("PRIVATE"));
    const health = state.rpc.find(
      ({ name }) => name === "mark_google_calendar_connection_unhealthy",
    );
    assert.equal(health.args.p_disconnected, classification === "reauthorization");
    assert.equal(state.rpc.at(-1).name, "fail_pipedream_binding_reconciliation");
    assertNoProviderWrites();
  }
  reset();
  state.account.dead = true;
  await assert.rejects(refresh);
  assert.equal(
    state.rpc.find(({ name }) => name === "mark_google_calendar_connection_unhealthy").args
      .p_disconnected,
    false,
  );
  console.log(
    "PASS: classified failures have safe reasons; unknown account health is not fabricated revocation",
  );

  reset();
  state.claim.binding.deployed_trigger_id = null;
  state.claim.binding.webhook_id = null;
  state.claim.binding.component_version = "pending";
  state.claim.binding.deployment_receipt = null;
  await assert.rejects(refresh, /trigger_missing/);
  assert.ok(state.rpc.some(({ name }) => name === "mark_google_calendar_connection_verified"));
  assertNoProviderWrites();
  reset();
  state.claim.binding.deployed_trigger_id = null;
  state.claim.binding.webhook_id = null;
  state.claim.binding.component_version = "pending";
  state.claim.binding.deployment_receipt = null;
  assert.deepEqual(await refresh(true), { checked: true });
  assert.equal(state.calls.filter(({ name }) => name === "deploy").length, 1);
  assert.ok(
    state.calls.findIndex(({ name }) => name === "accounts") <
      state.calls.findIndex(({ name }) => name === "deploy"),
  );
  const projection = state.rpc.find(
    ({ name }) => name === "apply_pipedream_trigger_projection",
  ).args;
  assert.equal(projection.p_component_version, "1.2.3");
  assert.equal(projection.p_observed_component_version, "1.2.3");
  assert.equal(projection.p_expected_connection_revision, 12);
  assert.equal(state.calls.filter(({ name }) => name === "write-probe").length, 0);
  assert.deepEqual(state.claim.binding.deployment_receipt, {
    trigger_id: "dc_new",
    component_id: "sc_fixture",
    component_key: key,
    component_version: "1.2.3",
    operation_id: "operation-test",
  });
  const durableReceipt = JSON.parse(JSON.stringify(state.claim.binding.deployment_receipt));
  state.observed = trigger("dc_new", { componentKey: null });
  state.claim.binding.webhook_id = "wh_saved";
  state.calls = [];
  state.rpc = [];
  await refresh();
  assertNoProviderWrites();
  assert.deepEqual(state.claim.binding.deployment_receipt, durableReceipt);
  console.log(
    "PASS: missing deployment verifies account independently and repairs only on an authorized repair claim",
  );

  reset();
  state.claim.binding.deployed_trigger_id = null;
  state.claim.binding.webhook_id = null;
  state.claim.binding.deployment_operation_id = "interrupted-operation";
  state.claim.binding.deployment_dispatched_at = "2026-01-01T00:00:00Z";
  state.claim.binding.deployment_receipt = null;
  state.definitionId = "sc_fixture";
  state.inventory = [trigger("dc_recovered")];
  await refresh(true);
  assert.equal(state.calls.filter(({ name }) => name === "deploy").length, 0);
  assert.equal(
    state.rpc.find(({ name }) => name === "adopt_pipedream_trigger_candidate").args
      .p_deployment_operation_id,
    "interrupted-operation",
  );
  reset();
  state.claim.binding.deployed_trigger_id = null;
  state.claim.binding.deployment_dispatched_at = "2026-01-01T00:00:00Z";
  await assert.rejects(() => refresh(true), /trigger_deployment_ambiguous/);
  assert.equal(state.calls.filter(({ name }) => name === "deploy").length, 0);
  reset();
  state.claim.binding.deployed_trigger_id = null;
  state.claim.binding.webhook_id = null;
  state.claim.binding.deployment_dispatched_at = "2026-01-01T00:00:00Z";
  state.inventory = [trigger("dc_wrong_component", { componentId: "sc_other_version" })];
  await assert.rejects(() => refresh(true), /trigger_deployment_ambiguous/);
  assert.equal(state.calls.filter(({ name }) => name === "deploy").length, 0);
  assert.equal(
    state.rpc.some(({ name }) => name === "adopt_pipedream_trigger_candidate"),
    false,
  );
  console.log(
    "PASS: expired deployment discovers the existing resource, never blindly repeats an ambiguous create",
  );

  for (const test of [
    {
      label: "machine auth rejection before create",
      error: Object.assign(
        new state.ProviderError(401, "Pipedream authentication", "invalid_client"),
        {
          requestOperation: "Pipedream trigger deployment",
          dispatched: false,
        },
      ),
      retry: true,
    },
    {
      label: "machine auth network failure before create",
      error: Object.assign(
        new state.ProviderError(0, "Pipedream authentication", "network_error"),
        {
          requestOperation: "Pipedream trigger deployment",
          dispatched: false,
        },
      ),
      retry: true,
    },
    ...[400, 401, 403, 404, 422, 429].map((status) => ({
      label: `attributable deploy ${status}`,
      error: new state.RequestError(status, "Pipedream trigger deployment"),
      retry: true,
    })),
    ...[408, 500, 502, 503, 504].map((status) => ({
      label: `ambiguous deploy ${status}`,
      error: new state.RequestError(status, "Pipedream trigger deployment"),
      retry: false,
    })),
    {
      label: "deploy response timeout",
      error: new state.RequestError(0, "Pipedream trigger deployment", "deadline_exceeded"),
      retry: false,
    },
    {
      label: "deploy network loss",
      error: new state.RequestError(0, "Pipedream trigger deployment", "network_error"),
      retry: false,
    },
    {
      label: "generic exception cannot assert not-sent deployment evidence",
      error: Object.assign(new Error("unattributed"), {
        dispatched: false,
        requestOperation: "Pipedream trigger deployment",
      }),
      retry: false,
    },
    {
      label: "another resource's not-sent evidence cannot clear deployment",
      error: Object.assign(
        new state.ProviderError(0, "Pipedream authentication", "network_error"),
        {
          dispatched: false,
          requestOperation: "Pipedream account discovery",
        },
      ),
      retry: false,
    },
  ]) {
    reset();
    state.claim.binding.deployed_trigger_id = null;
    state.claim.binding.webhook_id = null;
    state.failAt = "deploy";
    state.failure = test.error;
    await assert.rejects(() => refresh(true));
    const failed = state.rpc.at(-1);
    assert.equal(failed.name, "fail_pipedream_binding_reconciliation");
    assert.equal(failed.args.p_deployment_definitely_rejected, test.retry, test.label);
    assert.equal(state.claim.binding.deployment_dispatched_at === null, test.retry, test.label);
    const operationId = state.claim.binding.deployment_operation_id;
    state.failAt = null;
    state.calls = [];
    state.rpc = [];
    if (test.retry) {
      await refresh(true);
      assert.equal(state.calls.filter(({ name }) => name === "deploy").length, 1, test.label);
      assert.equal(
        state.rpc.find(({ name }) => name === "begin_pipedream_trigger_deployment_effect").args
          .p_deployment_operation_id,
        operationId,
        "definite rejection retries the same reserved operation",
      );
    } else {
      await assert.rejects(() => refresh(true), /trigger_deployment_ambiguous/);
      assert.equal(
        state.calls.some(({ name }) => name === "deploy"),
        false,
        test.label,
      );
    }
  }
  reset();
  state.claim.binding.deployed_trigger_id = null;
  state.claim.binding.deployment_dispatched_at = "2026-01-01T00:00:00Z";
  state.failAt = "inventory";
  state.failure = Object.assign(new Error("safe machine auth failure"), {
    operation: "Pipedream authentication",
    layer: "machine",
  });
  await assert.rejects(() => refresh(true));
  assert.equal(state.rpc.at(-1).args.p_deployment_definitely_rejected, false);
  assert.equal(state.claim.binding.deployment_dispatched_at, "2026-01-01T00:00:00Z");
  console.log(
    "PASS: only provably unsent/rejected creates clear dispatch; timeouts/5xx and later inventory auth failures preserve ambiguity",
  );

  reset();
  state.observed.componentKey = "wrong-component";
  await assert.rejects(refresh, /trigger_contract_mismatch/);
  assert.equal(state.rpc.at(-1).args.p_observed_trigger.componentKey, "wrong-component");
  assert.equal(state.claim.binding.component_key, key);
  reset();
  state.claim.binding.deployment_receipt = null;
  await assert.rejects(refresh, /trigger_contract_mismatch/);
  assertNoProviderWrites();
  await refresh(true);
  assert.equal(state.calls.filter(({ name }) => name === "deploy").length, 1);
  assert.equal(
    state.calls.find(({ name }) => name === "delete-trigger").input.triggerId,
    "dc_saved",
  );
  assert.equal(state.claim.binding.deployment_receipt.trigger_id, "dc_new");
  reset();
  state.claim.binding.deployment_receipt.component_id = "sc_wrong";
  await assert.rejects(refresh, /trigger_contract_mismatch/);
  assertNoProviderWrites();
  reset();
  state.observed.componentId = "sc_other_version";
  await assert.rejects(refresh, /trigger_contract_mismatch/);
  assert.equal(state.rpc.at(-1).args.p_observed_trigger.componentVersion, null);
  assertNoProviderWrites();
  reset();
  state.observed.componentKey = null;
  await refresh();
  assert.equal(state.rpc.at(-1).args.p_observed_component_key, key);
  assert.equal(state.rpc.at(-1).args.p_observed_component_version, "1.2.3");
  assertNoProviderWrites();
  reset();
  state.definitionId = "sc_fixture";
  state.claim.binding.deployed_trigger_id = null;
  state.claim.binding.deployment_receipt = null;
  state.deployedComponentId = "sc_wrong_deployment";
  await assert.rejects(() => refresh(true), /trigger_version_unverified/);
  assert.equal(
    state.rpc.some(({ name }) => name === "adopt_pipedream_trigger_candidate"),
    true,
  );
  assert.equal(
    state.rpc.some(({ name }) => name === "apply_pipedream_trigger_projection"),
    false,
  );
  assert.equal(state.claim.binding.deployment_candidate_trigger_id, "dc_new");
  assert.equal(state.claim.binding.deployment_receipt, null);
  assert.equal(state.claim.binding.trigger_state, "degraded");
  state.observed = trigger("dc_new", { componentId: "sc_wrong_deployment" });
  state.inventory = [state.observed];
  state.deployedComponentId = "sc_fixture";
  state.deployedTriggerId = "dc_repaired";
  state.calls = [];
  state.rpc = [];
  await refresh(true);
  assert.equal(
    state.rpc.find(({ name }) => name === "retire_pipedream_trigger").args.p_deployed_trigger_id,
    "dc_new",
  );
  assert.deepEqual(
    state.calls.filter(({ name }) => name === "delete-trigger").map(({ input }) => input.triggerId),
    ["dc_new"],
  );
  assert.ok(
    state.calls.findIndex(({ name }) => name === "delete-trigger") <
      state.calls.findIndex(({ name }) => name === "deploy"),
  );
  assert.equal(state.rpc.at(-1).args.p_deployed_trigger_id, "dc_repaired");
  assert.equal(state.claim.binding.trigger_state, "active");
  console.log(
    "PASS: ID-less definitions use persisted CREATE receipts; proofless old resources are replaced and contradictory IDs never become proof",
  );

  reset();
  state.observed.active = false;
  state.inventory = [trigger("dc_saved")];
  await refresh(true);
  const retirement = state.rpc.findIndex(({ name }) => name === "retire_pipedream_trigger");
  const cleanupAuthorization = state.rpc.findIndex(
    ({ name }) => name === "authorize_pipedream_trigger_cleanup",
  );
  assert.ok(retirement >= 0 && cleanupAuthorization > retirement);
  assert.equal(
    state.calls.find(({ name }) => name === "delete-trigger").input.triggerId,
    "dc_saved",
  );
  assert.equal(
    state.calls.filter(({ name }) => name === "deploy").length,
    1,
    "a retired candidate must not be reused",
  );
  reset();
  state.observed.active = false;
  state.falseRpc = "authorize_pipedream_trigger_cleanup";
  await assert.rejects(() => refresh(true), /could not be settled/);
  assert.equal(state.calls.filter(({ name }) => name === "delete-trigger").length, 0);
  console.log(
    "PASS: DELETE requires prior durable retirement and current authority; lost authority sends no DELETE",
  );

  for (const noWork of ["noClaim", "expired"]) {
    reset();
    if (noWork === "noClaim") state.noClaim = true;
    assert.deepEqual(
      await refresh(false, noWork === "expired" ? { deadlineAt: Date.now() - 1 } : {}),
      { checked: false },
    );
    assert.equal(state.calls.length, 0);
  }
  reset();
  state.rejectRpc = "claim_saved_google_calendar_verification";
  await assert.rejects(refresh, /could not be settled/);
  assert.equal(state.calls.length, 0);
  reset();
  state.failAt = "accounts";
  state.rejectRpc = "fail_pipedream_binding_reconciliation";
  await assert.rejects(
    () =>
      bundle.subject.reconcileDuePipedreamTriggers(1, {
        environment: "test",
        deadlineAt: Date.now() + 25_000,
      }),
    /could not be settled/,
  );
  console.log(
    "PASS: cooldown/deadline/indeterminate claims forbid provider work; failed RPC settlement fails the cron invocation",
  );

  reset();
  state.failAt = "accounts";
  const failed = await bundle.subject.reconcileDuePipedreamTriggers(1, {
    environment: "test",
    deadlineAt: Date.now() + 25_000,
  });
  assert.equal(failed.failed, 1);
  assert.equal(failed.success, false);
  assert.equal(failed.checked, 1);
  assert.equal(
    state.rpc.find(({ name }) => name === "claim_due_pipedream_bindings").args.p_environment,
    "test",
  );
  assert.equal(JSON.stringify(state.errors).includes("PRIVATE"), false);
  console.log(
    "PASS: cron claims one environment-scoped row just in time and returns truthful failure counters",
  );

  reset();
  state.disconnect = {
    id: "disconnect-old",
    profile_id: scope.profileId,
    environment: "test",
    provider_account_id: "apn_old",
    fencing_token: 5,
    state: "pending",
    lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
  };
  assert.deepEqual(
    await bundle.subject.resumeGoogleCalendarDisconnect({
      environment: "test",
      deadlineAt: Date.now() + 25_000,
    }),
    { checked: true, disconnected: true },
  );
  assert.equal(state.calls[0].input.accountId, "apn_old");
  assert.deepEqual(
    state.rpc.map(({ name }) => name),
    [
      "claim_booking_provider_account_disconnect_v3",
      "begin_booking_provider_account_disconnect_v3",
      "complete_booking_provider_account_disconnect_v3",
    ],
  );
  reset();
  state.disconnect = {
    id: "disconnect-old",
    profile_id: scope.profileId,
    environment: "test",
    provider_account_id: "apn_old",
    fencing_token: 5,
    state: "pending",
    lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
  };
  state.failAt = "delete-account";
  await assert.rejects(
    () =>
      bundle.subject.resumeGoogleCalendarDisconnect({
        environment: "test",
        deadlineAt: Date.now() + 25_000,
      }),
    /provider_disconnect_pending/,
  );
  assert.equal(state.rpc.at(-1).name, "fail_booking_provider_account_disconnect_v3");
  assert.equal(
    state.rpc.some(({ name }) => name === "complete_booking_provider_account_disconnect_v3"),
    false,
  );
  console.log(
    "PASS: explicit disconnect dispatches and settles only its durable identity; lost DELETE remains ambiguous",
  );

  reset();
  const operation = "66666666-6666-4666-8666-666666666666";
  state.probe = {
    id: operation,
    profile_id: scope.profileId,
    environment: "test",
    account_id: "apn_saved",
    calendar_id: "destination",
    connection_revision: 12,
    fencing_token: 3,
    lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
    probe_id: operation,
    probe_account_id: "apn_saved",
    probe_calendar_id: "destination",
    probe_state: "present",
    probe_started_at: new Date().toISOString(),
    probe_write_verified_at: null,
    write_verified_at: null,
    read_verified_at: new Date().toISOString(),
    calendars: [],
    configuration_current: false,
    purpose: "configuration",
    cleanup_only: true,
  };
  state.probeEvent = {
    id: `0b${operation.replaceAll("-", "")}`,
    status: "confirmed",
    visibility: "private",
    transparency: "transparent",
    summary: "Obra permission verification",
    description: "Temporary event created and removed automatically.",
    start: { dateTime: "2000-01-01T00:00:00.000Z" },
    end: { dateTime: "2000-01-01T00:01:00.000Z" },
    reminders: { useDefault: false },
    etag: '"fixture-v1"',
    extendedProperties: {
      private: { obraVerification: "true", obraVerificationOperationId: operation },
    },
  };
  const originalProbeEvent = structuredClone(state.probeEvent);
  let probeResult = await bundle.subject.reconcileDuePipedreamTriggers(1, {
    environment: "test",
    deadlineAt: Date.now() + 25_000,
  });
  assert.equal(probeResult.probes, 1);
  assert.equal(probeResult.failed, 0);
  assert.deepEqual(
    state.calls.filter(({ name }) => name === "proxy").map(({ input }) => input.method ?? "GET"),
    ["GET", "DELETE"],
  );
  assert.equal(state.calls.at(-1).input.target.searchParams.get("sendUpdates"), "none");
  assert.equal(state.calls.at(-1).input.ifMatch, '"fixture-v1"');
  assert.equal(
    state.rpc.at(-1).args.p_write_verified,
    false,
    "cleanup is not fresh write-capability evidence",
  );
  const cleanupProbe = { ...structuredClone(state.probe), probe_state: "present" };
  for (const cleanupOnly of [true, false]) {
    for (const drift of [
      { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=20"] },
      { recurrence: ["RDATE:20300102T120000Z"] },
      { recurringEventId: "contractor-series" },
      { originalStartTime: { dateTime: "2000-01-01T00:00:00Z" } },
      { endTimeUnspecified: true },
      { eventType: "outOfOffice" },
    ]) {
      reset();
      state.probe = {
        ...structuredClone(cleanupProbe),
        cleanup_only: cleanupOnly,
        configuration_current: !cleanupOnly,
      };
      state.probeEvent = { ...structuredClone(originalProbeEvent), ...drift };
      const before = structuredClone(state.probeEvent);
      const result = await bundle.subject.reconcileDuePipedreamTriggers(1, {
        environment: "test",
        deadlineAt: Date.now() + 25_000,
      });
      assert.equal(result.failed, 1);
      assert.deepEqual(
        state.calls
          .filter(({ name }) => name === "proxy")
          .map(({ input }) => input.method ?? "GET"),
        ["GET"],
        "actual setup cleanup/recovery rejects material one-off drift before DELETE",
      );
      assert.deepEqual(state.probeEvent, before);
      assert.equal(
        state.rpc.some(
          ({ name, args }) =>
            name === "authorize_google_calendar_setup_effect" && args.p_action === "delete",
        ),
        false,
      );
      assert.equal(
        state.rpc.some(({ name }) => name === "persist_google_calendar_configuration"),
        false,
      );
      assert.equal(state.rpc.at(-1).args.p_success, false);
      assert.equal(state.rpc.at(-1).args.p_reason, "configuration");
    }
  }
  console.log(
    "PASS: R6 actual setup cleanup/recovery preserves edited series and instances; zero DELETEs, real one-off predicate",
  );
  reset();
  state.probe = structuredClone(cleanupProbe);
  state.probeEvent = structuredClone(originalProbeEvent);
  state.editBeforeDelete = true;
  probeResult = await bundle.subject.reconcileDuePipedreamTriggers(1, {
    environment: "test",
    deadlineAt: Date.now() + 25_000,
  });
  assert.equal(probeResult.failed, 1);
  assert.equal(state.probeEvent.status, "confirmed");
  assert.equal(state.rpc.at(-1).args.p_success, false);
  console.log(
    "PASS: superseded probe DELETE carries the read ETag; a concurrent edit remains undeleted on 412",
  );
  reset();
  state.probe = structuredClone(cleanupProbe);
  state.probeEvent = { id: `0b${operation.replaceAll("-", "")}`, status: "cancelled" };
  probeResult = await bundle.subject.reconcileDuePipedreamTriggers(1, {
    environment: "test",
    deadlineAt: Date.now() + 25_000,
  });
  assert.equal(probeResult.failed, 0);
  assert.equal(state.calls.filter(({ input }) => input?.method === "DELETE").length, 0);
  reset();
  state.probe = structuredClone(cleanupProbe);
  state.probeEvent = {
    id: `0b${operation.replaceAll("-", "")}`,
    attendees: [{ email: "private@example.test" }],
  };
  probeResult = await bundle.subject.reconcileDuePipedreamTriggers(1, {
    environment: "test",
    deadlineAt: Date.now() + 25_000,
  });
  assert.equal(probeResult.failed, 1);
  assert.equal(state.calls.filter(({ input }) => input?.method === "DELETE").length, 0);
  assert.equal(state.rpc.at(-1).args.p_success, false);
  console.log(
    "PASS: expired setup cleanup uses its stable private identity, never INSERTs, and refuses unverified/attendee events",
  );
  reset();
  state.probe = {
    ...cleanupProbe,
    probe_state: "pending",
    cleanup_only: false,
    recovery: true,
    configuration_current: true,
  };
  state.failAt = "write-probe";
  probeResult = await bundle.subject.reconcileDuePipedreamTriggers(1, {
    environment: "test",
    deadlineAt: Date.now() + 25_000,
  });
  assert.equal(probeResult.failed, 1);
  assert.equal(state.rpc.at(-1).args.p_success, false);
  const interruptedIdentity = state.calls.find(({ name }) => name === "write-probe").input;
  state.failAt = null;
  state.calls = [];
  probeResult = await bundle.subject.reconcileDuePipedreamTriggers(1, {
    environment: "test",
    deadlineAt: Date.now() + 25_000,
  });
  assert.equal(probeResult.failed, 0);
  assert.deepEqual(
    state.calls.find(({ name }) => name === "write-probe").input,
    interruptedIdentity,
  );
  assert.equal(state.rpc.at(-1).name, "persist_google_calendar_configuration");
  state.calls = [];
  state.probe.write_verified_at = null;
  state.probe.probe_state = "present";
  state.probeEvent = { id: `0b${operation.replaceAll("-", "")}`, status: "cancelled" };
  probeResult = await bundle.subject.reconcileDuePipedreamTriggers(1, {
    environment: "test",
    deadlineAt: Date.now() + 25_000,
  });
  assert.equal(probeResult.failed, 0);
  assert.equal(
    state.calls.some(({ name }) => name === "write-probe"),
    true,
  );
  assert.equal(state.rpc.at(-1).name, "persist_google_calendar_configuration");
  for (const test of [
    { status: 410, reason: "deleted", layer: "google", success: true },
    { status: 410, reason: null, layer: "proxy", success: false },
    { status: 410, reason: "invalid_client", layer: "machine", success: false },
    { status: 410, reason: "insufficient_scope", layer: "proxy", success: false },
  ]) {
    reset();
    state.probe = { ...cleanupProbe, probe_state: "present", cleanup_only: true, recovery: true };
    state.failAt = "proxy";
    state.failure = new state.RequestError(
      test.status,
      "Google Calendar event lookup via Pipedream",
      test.reason,
      test.layer,
    );
    probeResult = await bundle.subject.reconcileDuePipedreamTriggers(1, {
      environment: "test",
      deadlineAt: Date.now() + 25_000,
    });
    assert.equal(probeResult.failed, test.success ? 0 : 1);
    assert.equal(
      state.calls.some(({ name }) => name === "write-probe"),
      false,
      "410 never attempts to INSERT the deleted probe ID",
    );
    assert.equal(state.rpc.at(-1).args.p_success, test.success);
    assert.equal(state.rpc.at(-1).args.p_write_verified, false);
    const read = state.calls.find(({ name }) => name === "proxy").input;
    assert.equal(read.accountId, cleanupProbe.account_id);
    assert.ok(read.target.pathname.endsWith(`/events/0b${operation.replaceAll("-", "")}`));
  }
  console.log(
    "PASS: interrupted owner setup resumes the same persisted event/operation identity and settles only after complete capability proof",
  );
  for (const fault of ["loseInsertResponse", "loseDeleteResponse", "persist-response"]) {
    reset();
    state.probe = {
      ...cleanupProbe,
      probe_state: "pending",
      cleanup_only: false,
      configuration_current: true,
    };
    if (fault === "persist-response") state.rejectRpc = "persist_google_calendar_configuration";
    else state[fault] = true;
    const run = () =>
      bundle.subject.reconcileDuePipedreamTriggers(1, {
        environment: "test",
        deadlineAt: Date.now() + 25_000,
      });
    if (fault === "persist-response") await assert.rejects(run, /could not be settled/);
    else assert.equal((await run()).failed, 1);
    const id = state.probe.probe_id;
    const writes = state.calls.filter(({ name }) => name === "write-probe").length;
    state.rejectRpc = null;
    assert.equal((await run()).failed, 0);
    assert.equal(state.probe.probe_id, id);
    assert.equal(
      state.calls.filter(({ name }) => name === "write-probe").length,
      writes,
      `${fault}: recovery reads the same effect and never INSERTs another private event`,
    );
    assert.equal(state.rpc.at(-1).name, "persist_google_calendar_configuration");
  }
  console.log(
    "PASS: lost INSERT, lost DELETE and interrupted persistence all resume through configuration commit",
  );

  for (const denied of ["insert", "delete", "read", "conflict"]) {
    reset();
    state.probe = {
      ...cleanupProbe,
      probe_state: "pending",
      cleanup_only: false,
      configuration_current: true,
    };
    state.failAt =
      denied === "delete" ? "delete-probe" : denied === "read" ? "proxy" : "write-probe";
    state.failure = new state.RequestError(
      denied === "conflict" ? 409 : 403,
      denied === "delete"
        ? "Google Calendar event deletion via Pipedream"
        : denied === "read"
          ? "Google Calendar event lookup via Pipedream"
          : "Google Calendar write verification via Pipedream",
      denied === "conflict" ? "event_conflict" : "insufficientPermissions",
      "google",
    );
    const outcome = await bundle.subject.reconcileDuePipedreamTriggers(1, {
      environment: "test",
      deadlineAt: Date.now() + 25_000,
    });
    assert.equal(outcome.failed, 1);
    const failure = state.rpc.at(-1).args;
    assert.equal(failure.p_denied_action, ["insert", "delete"].includes(denied) ? denied : null);
    assert.equal(failure.p_failure_observed_at !== null, ["insert", "delete"].includes(denied));
    assert.equal(failure.p_reason, denied === "conflict" ? "configuration" : "permissions");
  }
  console.log(
    "PASS: only actual setup INSERT/DELETE permission denials carry scoped capability evidence, never reads/conflicts",
  );

  for (const problem of [
    "scopes",
    "destination-role",
    "missing-calendar",
    "unhealthy",
    "unknown-scopes",
  ]) {
    reset();
    state.probe = {
      ...cleanupProbe,
      probe_state: "pending",
      cleanup_only: false,
      configuration_current: true,
      read_verified_at: null,
      calendars: state.calendars.map((calendar) => ({
        ...calendar,
        blocksAvailability: calendar.id !== "destination",
        receivesBookings: calendar.id === "destination",
      })),
    };
    if (problem === "scopes") state.account.authorized_scopes = [];
    if (problem === "unknown-scopes") delete state.account.authorized_scopes;
    if (problem === "unhealthy") state.account.healthy = false;
    if (problem === "missing-calendar")
      state.calendars = state.calendars.filter((calendar) => calendar.id !== "busy-a");
    if (problem === "destination-role")
      state.calendars.find((calendar) => calendar.id === "destination").accessRole = "reader";
    assert.equal(
      (
        await bundle.subject.reconcileDuePipedreamTriggers(1, {
          environment: "test",
          deadlineAt: Date.now() + 25_000,
        })
      ).failed,
      1,
    );
    assert.equal(
      state.rpc.at(-1).args.p_reason,
      ["unhealthy", "unknown-scopes"].includes(problem) ? "temporary" : "permissions",
    );
    assert.equal(state.rpc.at(-1).args.p_denied_action, null);
    assert.equal(
      state.calls.some(({ name }) => name === "write-probe" || name === "delete-probe"),
      false,
    );
  }
  console.log(
    "PASS: confirmed setup scope/calendar permission loss is actionable; unknown account health is not fabricated revocation",
  );

  function workload(disconnects, probes, bindings) {
    reset();
    state.workload = {
      disconnects: Array.from({ length: disconnects }, (_, i) => ({
        id: `disconnect-${i}`,
        profile_id: `disconnect-profile-${i}`,
        environment: "test",
        provider_account_id: `apn_disconnect_${i}`,
        fencing_token: 10 + i,
        state: "pending",
        lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
      })),
      probes: Array.from({ length: probes }, (_, i) => ({
        ...structuredClone(cleanupProbe),
        id: `probe-${i}`,
        fencing_token: 20 + i,
        probe_state: "pending",
      })),
      bindings: Array.from({ length: bindings }, (_, i) => ({
        ...structuredClone(state.claim),
        connection: {
          ...state.claim.connection,
          id: `connection-${i}`,
          profile_id: `profile-${i}`,
        },
        binding: {
          ...structuredClone(state.claim.binding),
          id: `binding-${i}`,
          connection_id: `connection-${i}`,
          profile_id: `profile-${i}`,
          reconciliation_fencing_token: 30 + i,
        },
      })),
      opportunities: [],
      claimed: [],
      settled: [],
      inFlight: new Map(),
    };
  }
  const maintain = (limit = 25, deadlineAt = Date.now() + 25_000) =>
    bundle.subject.reconcileDuePipedreamTriggers(limit, { environment: "test", deadlineAt });
  const emptyResult = {
    checked: 0,
    reconciled: 0,
    failed: 0,
    disconnects: 0,
    probes: 0,
    deadlineReached: false,
    success: true,
  };
  workload(0, 0, 0);
  assert.deepEqual(await maintain(), emptyResult);
  assert.deepEqual(state.workload.opportunities, ["disconnect", "probe", "binding"]);
  assert.equal(state.calls.length, 0);
  workload(30, 30, 30);
  assert.deepEqual(await maintain(25, Date.now() + 4_000), {
    ...emptyResult,
    deadlineReached: true,
    success: false,
  });
  assert.equal(state.rpc.length, 0);
  assert.equal(state.calls.length, 0);

  for (const failing of [null, "delete-account", "proxy", "accounts"]) {
    workload(30, 30, 30);
    state.failAt = failing;
    const result = await maintain();
    const counts = Object.fromEntries(
      ["disconnect", "probe", "binding"].map((kind) => [
        kind,
        state.workload.claimed.filter((item) => item.kind === kind).length,
      ]),
    );
    assert.deepEqual(
      counts,
      { disconnect: 9, probe: 8, binding: 8 },
      "fast outcomes cannot consume another class's initial share",
    );
    assert.deepEqual(
      state.workload.settled.toSorted(),
      state.workload.claimed.map(({ kind }) => kind).toSorted(),
    );
    assert.equal(state.workload.inFlight.size, 0);
    assert.equal(new Set(state.workload.claimed.map(({ id }) => id)).size, 25);
    assert.equal(result.checked, 25, "one shared item cap, not 25 per class");
    const failures =
      failing === "delete-account"
        ? counts.disconnect
        : failing === "proxy"
          ? counts.probe
          : failing === "accounts"
            ? counts.binding
            : 0;
    assert.deepEqual(result, {
      checked: 25,
      reconciled: 25 - failures,
      failed: failures,
      disconnects: failing === "delete-account" ? 0 : counts.disconnect,
      probes: counts.probe,
      deadlineReached: false,
      success: failures === 0,
    });
    assert.equal(
      state.rpc.filter(({ name }) => name === "apply_pipedream_trigger_projection").length,
      failing === "accounts" ? 0 : counts.binding,
      "due bindings keep an opportunity despite saturated disconnect/setup work or failures",
    );
    assert.equal(JSON.stringify(state.errors).includes("PRIVATE"), false);
    assert.equal(
      state.calls.some(({ name }) =>
        ["deploy", "configure", "delete-trigger", "write-probe", "delete-probe"].includes(name),
      ),
      false,
    );
    for (const [claimName, excludeKey, kind] of [
      ["claim_booking_provider_account_disconnect_v3", "p_exclude_ids", "disconnect"],
      ["claim_google_calendar_setup_probe", "p_exclude_operation_ids", "probe"],
      ["claim_due_pipedream_bindings", "p_exclude_binding_ids", "binding"],
    ]) {
      const claims = state.rpc.filter(({ name }) => name === claimName);
      claims.forEach(({ args }, i) => {
        assert.equal(args.p_environment, "test");
        assert.deepEqual(
          args[excludeKey],
          Array.from({ length: i }, (_, index) => `${kind}-${index}`),
        );
      });
    }
  }
  for (const kind of ["disconnect", "probe", "binding"]) {
    workload(
      kind === "disconnect" ? 30 : 0,
      kind === "probe" ? 30 : 0,
      kind === "binding" ? 30 : 0,
    );
    const result = await maintain();
    assert.equal(result.checked, 25, "empty classes cannot consume useful capacity");
    assert.equal(result.reconciled, 25);
    assert.equal(result.success, true);
    assert.deepEqual(
      state.workload.claimed.map((item) => item.kind),
      Array(25).fill(kind),
    );
  }
  workload(1, 1, 1);
  assert.equal((await maintain()).checked, 3);
  assert.equal(state.workload.inFlight.size, 0);
  console.log(
    "PASS: mixed work independently progresses after success/failure, excludes attempted identities, preserves per-class single-item fences and the shared 25-item cap",
  );

  const originalNow = Date.now;
  try {
    let now = originalNow();
    Date.now = () => now;
    workload(1, 1, 1);
    state.workload.afterSettlement = () => {
      now += 4_000;
    };
    const result = await maintain(25, now + 16_000);
    assert.deepEqual(result, {
      checked: 3,
      reconciled: 3,
      failed: 0,
      disconnects: 1,
      probes: 1,
      deadlineReached: true,
      success: false,
    });
    assert.deepEqual(
      state.workload.claimed.map(({ kind }) => kind),
      ["disconnect", "probe", "binding"],
    );
    assert.equal(state.workload.inFlight.size, 0);
    assert.equal(state.rpc.at(-1).name, "apply_pipedream_trigger_projection");
  } finally {
    Date.now = originalNow;
  }
  workload(30, 30, 30);
  state.rejectRpc = "claim_google_calendar_setup_probe";
  await assert.rejects(() => maintain(), /could not be settled/);
  assert.equal(state.workload.inFlight.size, 0, "a rejected sibling never detaches claimed work");
  assert.equal(
    state.workload.claimed.some(({ kind }) => kind === "probe"),
    false,
  );
  assert.ok(state.workload.claimed.length <= 2, "a lost claim stops new claims in every class");
  console.log(
    "PASS: empty/deadline sweeps do not lease ahead; deadline stops after settlement and indeterminate claims fail the invocation",
  );

  // Virtual provider latency, real reconciler/setup state machines and both
  // production deadline scopes. Advancing all pending reads together models
  // independent I/O rather than summing parallel work into a fake clock.
  const { setImmediate: yieldTurn } = await import("node:timers/promises");
  const pending = [];
  let clock = originalNow();
  const OriginalDate = Date;
  globalThis.Date = class extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return clock;
    }
  };
  try {
    for (const scenario of ["slow-setup", "fast-disconnect-failure"]) {
      workload(scenario === "slow-setup" ? 100 : 30, scenario === "slow-setup" ? 16 : 0, 48);
      Object.assign(state.workload, { timed: true, events: new Map(), verified: [] });
      state.workload.probes = state.workload.probes.map((probe, i) => ({
        ...probe,
        probe_id: `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`,
        profile_id: `setup-profile-${i}`,
        probe_state: "pending",
        cleanup_only: false,
        configuration_current: true,
        read_verified_at: null,
        calendars: state.calendars.map((calendar) => ({
          ...calendar,
          displayName: calendar.id,
          blocksAvailability: calendar.id !== "destination",
          receivesBookings: calendar.id === "destination",
        })),
      }));
      state.workload.delay = (name, input) => {
        const context = state.worker.workerProviderContext();
        assert.ok(
          context && state.worker.workerCanContinue(),
          "no provider call starts after its class work deadline",
        );
        if (scenario === "fast-disconnect-failure" && name === "delete-account")
          throw new state.RequestError(
            403,
            "Pipedream account deletion",
            "insufficient_scope",
            "pipedream",
          );
        const setup = input?.profileId?.startsWith("setup-profile-");
        const ms =
          name === "delete-account"
            ? 8_000
            : name === "proxy"
              ? 6_000
              : name === "event-access"
                ? 10_000
                : setup && ["accounts", "calendars", "freebusy"].includes(name)
                  ? 200
                  : !setup &&
                      [
                        "accounts",
                        "calendars",
                        "freebusy",
                        "trigger",
                        "definition",
                        "webhook",
                      ].includes(name)
                    ? 100
                    : 0;
        if (!ms) return;
        return new Promise((resolve, reject) =>
          pending.push({
            at: Math.min(clock + ms, context.deadlineAt),
            done: () =>
              clock + 1 > context.deadlineAt
                ? reject(new state.ProviderError(0, "Pipedream request", "deadline_exceeded"))
                : resolve(),
          }),
        );
      };
      for (let tick = 0; tick < 16; tick++) {
        const startedAt = clock;
        const verificationDue = state.workload.bindings.filter(
          (item) => (item.dueAt ?? 0) <= clock,
        ).length;
        const verifiedBefore = state.workload.verified.length;
        let done = false,
          outcome,
          failure;
        const call = state.worker.withWorkerDeadline(startedAt + 40_000, () =>
          maintain(25, startedAt + 40_000),
        );
        call.then(
          (value) => {
            outcome = value;
            done = true;
          },
          (error) => {
            failure = error;
            done = true;
          },
        );
        for (let guard = 0; !done && guard < 2_000; guard++) {
          await yieldTurn();
          if (!pending.length) continue;
          clock = Math.max(clock, Math.min(...pending.map((item) => item.at)));
          for (const item of pending.filter((item) => item.at <= clock)) {
            pending.splice(pending.indexOf(item), 1);
            item.done();
          }
        }
        assert.equal(done, true, "all class work must finish inside the invocation");
        if (failure) throw failure;
        assert.ok(outcome.checked <= 25);
        if (scenario === "fast-disconnect-failure" && verificationDue >= 8)
          assert.equal(
            outcome.checked,
            25,
            "unused setup share is lent instead of abandoning capacity",
          );
        assert.equal(state.workload.inFlight.size, 0, "no leased work left without settlement");
        assert.ok(clock <= startedAt + 40_000);
        assert.equal(pending.length, 0);
        if (verificationDue)
          assert.ok(
            state.workload.verified.length - verifiedBefore >= Math.min(8, verificationDue),
            "every tick preserves at least the verifier's initial eight-item opportunity",
          );
        if (tick === 0 && scenario === "slow-setup") {
          assert.ok(
            state.workload.verified.length >= 8,
            "8s disconnect plus 28.6s setup cannot suppress binding work",
          );
          assert.ok(state.workload.disconnects.some((item) => item.completed));
          assert.ok(
            state.workload.probes.some((item) => item.completed),
            "setup can finish without repeatedly aborting at a small fixed slice",
          );
        }
        clock = startedAt + 60_000;
      }
      for (const binding of state.workload.bindings) {
        const checks = state.workload.verified.filter((item) => item.id === binding.binding.id);
        assert.ok(
          checks.length >= 1,
          "every healthy binding receives unattended work under a sustained mixed backlog",
        );
        assert.ok(
          clock - checks.at(-1).at < 15 * 60_000,
          "mixed backlog cannot starve a healthy account through freshness expiry",
        );
        for (let i = 1; i < checks.length; i++)
          assert.ok(
            checks[i].at - checks[i - 1].at < 15 * 60_000,
            "each repeated verification stays within freshness",
          );
      }
      if (scenario === "slow-setup")
        assert.ok(
          state.workload.probes.every((item) => item.completed),
          "interrupted setup resumes the same private identity to persistence",
        );
      if (scenario === "slow-setup")
        assert.ok(state.workload.disconnects.filter((item) => item.completed).length >= 16);
      const inserted = state.calls
        .filter(({ name }) => name === "write-probe")
        .map(({ input }) => input.body.id);
      assert.equal(
        new Set(inserted).size,
        inserted.length,
        "continuation does not mint another probe after an interrupted cleanup",
      );
      console.log(
        `PASS: 16 minute ${scenario} run: at least eight due healthy checks per tick, 25 shared cap/40s bound; no expired claims, detached work or duplicate probes`,
      );
    }
  } finally {
    globalThis.Date = OriginalDate;
  }

  assert.equal(networkCalls, 0);
  console.log("test-google-calendar-lifetime: passed; zero network calls");
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  delete globalThis.__googleLifetime;
  await bundle?.cleanup();
}
