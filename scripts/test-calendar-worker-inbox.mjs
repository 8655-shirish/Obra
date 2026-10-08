import assert from "node:assert/strict";
import path from "node:path";
import { importWithMocks } from "./lib/import-with-mocks.mjs";

const now = Date.now();
const state = { calls: [], filters: [], rows: [], now, applyFailure: false, claimUnknown: false };
const event = (id, environment = "test") => ({
  id,
  payload: {
    id,
    type: "calendar.updated",
    environment,
    occurred_at: new Date(now).toISOString(),
    binding_id: "binding-fixture",
    account_id: "account-fixture",
    trigger_id: "trigger-fixture",
    correlation_id: "correlation-fixture",
  },
});
const originalNow = Date.now;
const originalFetch = globalThis.fetch;
Date.now = () => state.now;
globalThis.fetch = async () => {
  throw new Error("Network forbidden in calendar inbox unit test");
};
function builder(response) {
  return {
    abortSignal(signal) {
      this.signal = signal;
      return this;
    },
    then(resolve, reject) {
      assert.ok(this.signal instanceof AbortSignal);
      return Promise.resolve().then(response).then(resolve, reject);
    },
  };
}
const db = {
  from(name) {
    assert.equal(name, "provider_event_inbox");
    return {
      select() {
        return this;
      },
      eq(...args) {
        state.filters.push(args);
        return this;
      },
      in() {
        return this;
      },
      lte() {
        return this;
      },
      order() {
        return this;
      },
      limit(limit) {
        assert.ok(limit > 0 && limit <= 25);
        return builder(() => ({ data: state.rows.slice(0, limit), error: null }));
      },
    };
  },
  rpc(name, args) {
    return builder(() => {
      state.calls.push([name, args]);
      if (name === "claim_provider_event") {
        assert.equal(args.p_lease_seconds, 55);
        return state.claimUnknown
          ? { data: null, error: { code: "57014" } }
          : { data: 4, error: null };
      }
      if (name === "apply_pipedream_calendar_event") {
        assert.equal(args.p_fencing_token, 4);
        if (state.advanceAfterApply) state.now += 20_000;
        return { data: !state.applyFailure, error: null };
      }
      assert.equal(name, "complete_provider_event");
      assert.equal(args.p_succeeded, false);
      assert.equal(args.p_fencing_token, 4);
      return { data: true, error: null };
    });
  },
};
let bundle;
globalThis.__calendarInboxTest = db;
try {
  bundle = await importWithMocks(path.resolve("src/lib/pipedream-inbox-worker.server.ts"), {
    "@/integrations/supabase/client.server":
      "export const supabaseAdmin=globalThis.__calendarInboxTest;",
  });
  const run = () =>
    bundle.subject.processPipedreamCalendarInbox(5, {
      environment: "test",
      deadlineAt: now + 15_000,
    });
  state.rows = [event("good"), event("wrong-env", "live")];
  assert.deepEqual(await run(), { processed: 1, failed: 1, claimed: 2, deadlineExceeded: false });
  assert.ok(state.filters.some(([field, value]) => field === "environment" && value === "test"));
  assert.deepEqual(
    state.calls.map(([name]) => name),
    [
      "claim_provider_event",
      "apply_pipedream_calendar_event",
      "claim_provider_event",
      "complete_provider_event",
    ],
  );

  state.calls = [];
  state.rows = [event("not-applied")];
  state.applyFailure = true;
  assert.deepEqual(
    await run(),
    { processed: 0, failed: 1, claimed: 1, deadlineExceeded: false },
    "false settlement is not processed success",
  );
  state.calls = [];
  state.applyFailure = false;
  state.claimUnknown = true;
  await assert.rejects(run, /Unable to claim/);
  assert.equal(state.calls.length, 1, "unknown claim does not apply or settle a guessed fence");

  state.calls = [];
  state.claimUnknown = false;
  state.rows = [event("first"), event("second")];
  state.advanceAfterApply = true;
  assert.deepEqual(await run(), { processed: 1, failed: 0, claimed: 1, deadlineExceeded: true });
  assert.equal(
    state.calls.filter(([name]) => name === "claim_provider_event").length,
    1,
    "no next lease after deadline",
  );
  state.calls = [];
  assert.deepEqual(await run(), { processed: 0, failed: 0, claimed: 0, deadlineExceeded: true });
  assert.equal(state.calls.length, 0);
  console.log(
    "test-calendar-worker-inbox: passed (bounded environment-scoped inbox; DB transport stubs)",
  );
} finally {
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  delete globalThis.__calendarInboxTest;
  if (bundle) await bundle.cleanup();
}
