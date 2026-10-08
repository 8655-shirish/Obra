import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const key = "google_calendar-new-or-updated-event-instant";
const prefix = "https://www.googleapis.com/auth/calendar";
const state = {};
state.supabaseAdmin = {
  rpc(name, args) {
    state.rpc.push({ name, args });
    return {
      async abortSignal() {
        if (
          name === "claim_booking_provider_account_disconnect_v3" ||
          name === "claim_google_calendar_setup_probe"
        )
          return { data: null, error: null };
        if (name === "claim_due_pipedream_bindings") return { data: [state.claim], error: null };
        return { data: true, error: null };
      },
    };
  },
};
const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
let bundle;
try {
  globalThis.__reconciliationErrors = state;
  globalThis.fetch = async () => {
    throw new Error("This test may not call the network");
  };
  console.error = (...args) => state.errors.push(args);
  const actual = JSON.stringify(path.resolve("src/lib/pipedream.server.ts"));
  bundle = await importWithMocks(
    path.resolve("src/lib/pipedream-trigger-reconciliation.server.ts"),
    {
      "@/integrations/supabase/client.server": `export const supabaseAdmin = globalThis.__reconciliationErrors.supabaseAdmin;`,
      "@/lib/auth/contractor-session.server": `export const getContractorAuthUserId = async () => 'owner-fixture';`,
      "@/lib/pipedream.server": `
      import { PipedreamError, PipedreamRequestError, isGoogleCalendarOneOffEvent, classifyPipedreamFailure, hasGoogleCalendarBookingScopes, withPipedreamDeadline } from ${actual};
      export { PipedreamError, PipedreamRequestError, isGoogleCalendarOneOffEvent, classifyPipedreamFailure, hasGoogleCalendarBookingScopes, withPipedreamDeadline };
      const s = globalThis.__reconciliationErrors;
      export const pipedreamTriggerWebhookUrl = () => 'https://example.test/webhook';
      export const listGoogleAccounts = async () => {
        s.accountsRead++;
        if (s.failAccount) throw new PipedreamRequestError(403, 'Pipedream account discovery', 'insufficient_scope', 'pipedream');
        return [s.account];
      };
      export const listGoogleCalendars = async () => { s.calendarsRead++; return [{ id:'primary', accessRole:'owner' }]; };
      export const verifyGoogleCalendarFreeBusy = async (input) => {
        s.reads.push(input);
        if (s.failure) throw new PipedreamRequestError(...s.failure);
      };
      export const getDeployedPipedreamTrigger = async () => ({ id:'dc_fixture', componentKey:'${key}', componentId:'sc_fixture', active:true,
        configuredProps:{googleCalendar:{authProvisionId:'apn_fixture'},calendarIds:['primary'],newOnly:false} });
      export const retrievePipedreamTrigger = async (input) => {
        s.definitions.push(input);
        return { id:s.definitionId, key:'${key}', version:'1.2.3', configurableProps:[] };
      };
      export const getPipedreamTriggerWebhook = async () => ({id:'wh_fixture',url:pipedreamTriggerWebhookUrl(),signingKey:'fixture',updatedAt:new Date().toISOString()});
      const forbidden = async () => { s.providerWrites++; throw new Error('Recurring verification must not write to the provider'); };
      export const configurePipedreamTriggerWebhook = forbidden;
      export const deletePipedreamTrigger = forbidden;
      export const deletePipedreamAccount = forbidden;
      export const deployPipedreamTrigger = forbidden;
      export const listDeployedPipedreamTriggers = forbidden;
      export const listGoogleCalendarTriggers = forbidden;
      export const verifyGoogleCalendarWrite = forbidden;
      export const verifyGoogleCalendarEventAccess = forbidden;
      export const proxyGoogleCalendar = forbidden;
    `,
    },
  );
  const cases = [
    {
      name: "temporary FreeBusy 503",
      failure: [503, "Google Calendar availability via Pipedream", null, "google"],
      reason: "provider_temporary_failure",
    },
    {
      name: "unknown proxy 401",
      failure: [401, "Google Calendar availability via Pipedream", "invalid_grant", "proxy"],
      reason: "provider_temporary_failure",
    },
    {
      name: "confirmed Google scope denial",
      failure: [
        403,
        "Google Calendar availability via Pipedream",
        "insufficientPermissions",
        "google",
      ],
      reason: "calendar_permissions_changed",
    },
    {
      name: "Pipedream project scope denial",
      failAccount: true,
      reason: "provider_platform_error",
    },
    {
      name: "account reports dead without a documented grant reason",
      account: { dead: true },
      reason: "provider_account_unhealthy",
    },
    {
      name: "missing scope metadata is temporary, not lost permission",
      scopes: undefined,
      reason: "provider_temporary_failure",
    },
    {
      name: "known empty scopes are permission loss",
      scopes: [],
      reason: "calendar_permissions_changed",
    },
    {
      name: "known read-only scopes cannot authorize booking writes",
      scopes: [`${prefix}.readonly`],
      reason: "calendar_permissions_changed",
    },
    {
      name: "missing CalendarList scope",
      scopes: [`${prefix}.events`, `${prefix}.freebusy`],
      reason: "calendar_permissions_changed",
    },
    { name: "all required reads succeed", success: true },
    {
      name: "ID-less pinned definition consumes the saved successful deployment receipt",
      definitionId: undefined,
      success: true,
    },
  ];
  for (const test of cases) {
    Object.assign(state, {
      rpc: [],
      reads: [],
      errors: [],
      accountsRead: 0,
      calendarsRead: 0,
      providerWrites: 0,
      failure: test.failure,
      failAccount: test.failAccount,
      definitions: [],
      definitionId: "definitionId" in test ? test.definitionId : "sc_fixture",
      account: {
        id: "apn_fixture",
        healthy: true,
        dead: false,
        error: null,
        ...("scopes" in test
          ? test.scopes === undefined
            ? {}
            : { authorized_scopes: test.scopes }
          : { authorized_scopes: [`${prefix}.events`, `${prefix}.readonly`] }),
        ...test.account,
      },
      claim: {
        connection: {
          id: "connection",
          profile_id: "profile",
          environment: "test",
          pipedream_account_id: "apn_fixture",
          connection_revision: 3,
        },
        binding: {
          id: "binding",
          profile_id: "profile",
          environment: "test",
          connection_id: "connection",
          pipedream_account_id: "apn_fixture",
          configuration_revision: 3,
          selected_calendar_ids: ["primary"],
          component_key: key,
          component_version: "1.2.3",
          deployed_trigger_id: "dc_fixture",
          webhook_id: "wh_fixture",
          webhook_correlation_id: "correlation",
          reconciliation_fencing_token: 7,
          reconciliation_lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
          deployment_operation_id: null,
          deployment_candidate_trigger_id: null,
          deployment_receipt: {
            trigger_id: "dc_fixture",
            component_id: "sc_fixture",
            component_key: key,
            component_version: "1.2.3",
            operation_id: "completed-deploy-operation",
          },
          pending_trigger_deletions: [],
          retired_trigger_ids: [],
        },
        selections: [
          { google_calendar_id: "primary", blocks_availability: true, receives_bookings: true },
        ],
        cleanup_only: false,
      },
    });
    const result = await bundle.subject.reconcileDuePipedreamTriggers(1, {
      environment: "test",
      deadlineAt: Date.now() + 25_000,
    });
    assert.equal(result.checked, 1, test.name);
    assert.equal(result.reconciled, test.success ? 1 : 0, test.name);
    assert.equal(result.failed, test.success ? 0 : 1, test.name);
    assert.equal(result.success, Boolean(test.success), test.name);
    assert.equal(state.providerWrites, 0, "classification must not start provider effects");
    assert.equal(state.accountsRead, 1);
    if ("scopes" in test) {
      assert.equal(state.calendarsRead, 0);
      assert.equal(state.reads.length, 0);
      assert.equal(
        state.rpc.some(({ name }) => name === "mark_google_calendar_connection_verified"),
        false,
        "unknown/insufficient scopes cannot renew successful readiness evidence",
      );
    }
    const health = state.rpc.find(
      ({ name }) => name === "mark_google_calendar_connection_unhealthy",
    );
    if (test.success) {
      assert.equal(health, undefined);
      assert.equal(state.rpc.at(-1).name, "apply_pipedream_trigger_projection");
      assert.deepEqual(state.definitions, [{ environment: "test", key, version: "1.2.3" }]);
      assert.equal(state.rpc.at(-1).args.p_observed_component_version, "1.2.3");
    } else {
      if (test.monitoring)
        assert.equal(
          health,
          undefined,
          "monitoring failure must not erase successful account verification",
        );
      else {
        assert.equal(health.args.p_reason, test.reason, test.name);
        assert.equal(
          health.args.p_disconnected,
          false,
          "status/grant prose alone cannot prove revocation",
        );
      }
      assert.equal(state.rpc.at(-1).name, "fail_pipedream_binding_reconciliation");
      assert.equal(state.rpc.at(-1).args.p_safe_error, test.reason);
    }
    const claim = state.rpc.find(({ name }) => name === "claim_due_pipedream_bindings");
    for (const { name, args } of state.rpc) {
      if (
        name.startsWith("mark_") ||
        name.startsWith("fail_") ||
        name === "apply_pipedream_trigger_projection"
      ) {
        assert.equal(args.p_lease_token, claim.args.p_lease_token);
        assert.equal(args.p_fencing_token, 7);
      }
    }
    console.log(`PASS: ${test.name}`);
  }
  console.log(
    "test-pipedream-reconciliation-errors: passed; actual sanitized classifier, zero network calls",
  );
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  delete globalThis.__reconciliationErrors;
  await bundle?.cleanup();
}
